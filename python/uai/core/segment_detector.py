"""
Segment-level AI Music Detector

Separates audio into stems (vocals, drums, bass, other) using a pluggable
backend (BS-RoFormer 4-stem by default, with cascade and htdemucs fallbacks),
then runs stem-specific temporal analysis on each stem independently.
This catches hybrid tracks where only some elements are AI-generated.
"""

import logging
import tempfile
import numpy as np
from pathlib import Path
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .ast_detector import ASTDetector
from .cnn_detector import CNNDetector
from .embedding_detector import EmbeddingDetector
from .fakeprint_detector import FakePrintDetector
from .fourier_detector import FourierDetector, FourierResult
from .highfreq_detector import HighFrequencyDetector
from .lofcz_detector import LofczDetector
from .phase_detector import PhaseDetector
from .spectral_detector import SpectralDetector, SpectralResult
from .stem_backends import default_backend, get_backend
from .stem_classifier import StemClassifier, StemClassifierResult


logger = logging.getLogger(__name__)


@dataclass
class StemResult:
    """Analysis result for a single audio stem."""
    name: str  # "vocals", "drums", "bass", "other"
    score: float  # 0 = human, 1 = AI
    confidence: float
    stem_classifier: Optional[StemClassifierResult] = None
    fourier: Optional[FourierResult] = None
    spectral: Optional[SpectralResult] = None
    anomalies: List[str] = field(default_factory=list)
    has_content: bool = True  # False if stem is mostly silent

    @property
    def verdict(self) -> str:
        if not self.has_content:
            return "No content"
        if self.score > 0.6:
            return "Likely AI"
        elif self.score < 0.4:
            return "Likely Human"
        return "Uncertain"

    @property
    def verdict_color(self) -> str:
        if not self.has_content:
            return "#666666"
        if self.score > 0.6:
            return "#FF4444"
        elif self.score < 0.4:
            return "#44BB44"
        return "#FFAA00"

    @property
    def emoji(self) -> str:
        if self.name == "vocals":
            return "\U0001F3A4"  # microphone
        elif self.name == "instrumental":
            return "\U0001F3B6"  # music notes
        elif self.name == "drums":
            return "\U0001F941"  # drum
        elif self.name == "bass":
            return "\U0001F3B8"  # guitar
        else:
            return "\U0001F3B9"  # piano/keys


@dataclass
class SegmentResult:
    """Full segment analysis result with per-stem breakdown."""
    overall_score: float
    overall_confidence: float
    stems: Dict[str, StemResult] = field(default_factory=dict)
    separation_method: str = "demucs"
    mix_verdict: str = ""
    summary: str = ""
    # Identifies which stem-separation backend produced the stems
    # (one of: "bs_roformer_4stem", "cascade", "roformer", "demucs").
    # Useful for downstream
    # auditing and for explaining model-version-specific behaviour.
    backend_used: str = "demucs"

    @property
    def has_ai_stems(self) -> bool:
        return any(s.score > 0.6 for s in self.stems.values() if s.has_content)

    @property
    def ai_stems(self) -> List[str]:
        return [s.name for s in self.stems.values() if s.score > 0.6 and s.has_content]

    @property
    def human_stems(self) -> List[str]:
        return [s.name for s in self.stems.values() if s.score < 0.4 and s.has_content]


class SegmentDetector:
    """
    Separates audio into stems and analyzes each independently.

    Uses BS-RoFormer 4-stem separation by default to split audio into:
    - Vocals
    - Drums
    - Bass
    - Other (instruments, synths, etc.)

    Then runs a stem-specific detector focused on temporal micro-patterns:
    - Drum onset timing variance and grid-lock
    - Vocal pitch contour naturalness
    - Transient attack symmetry
    """

    # Memory threshold below which we refuse to spin up the heavier
    # Roformer/cascade backends and force a Demucs fallback. ~4GB headroom
    # is enough for htdemucs to run without thrashing on a 16GB Mac.
    _LOW_MEMORY_BYTES = 4 * 1024 ** 3
    _VALID_BACKENDS = (
        "bs_roformer_4stem",
        "bs_roformer_cascade",
        "cascade",
        "roformer",
        "demucs",
    )

    def __init__(
        self,
        sr: int = 22050,
        demucs_model: str = "htdemucs",
        cnn_model_path: str = None,
        ast_model_path: str = None,
        backend_name: str = default_backend,
        device: str = "cpu",
    ):
        """
        Args:
            sr: Sample rate for librosa loads when analysing stems.
            demucs_model: Model name passed to the legacy Demucs fallback.
                Used both for ``backend_name="demucs"`` and as the safe
                fallback when the requested backend fails.
            cnn_model_path / ast_model_path: Optional checkpoints for the
                spectrogram models used per-stem.
            backend_name: One of ``"bs_roformer_4stem"`` (default),
                ``"cascade"`` (Roformer vocals + htdemucs_ft
                drums/bass/other fallback), ``"roformer"`` (Roformer only,
                2 stems), or ``"demucs"`` (legacy subprocess fallback).
                Unknown values raise ``ValueError``.
            device: Runtime device to pass to GPU-eager stem backends.
        """
        if backend_name not in self._VALID_BACKENDS:
            raise ValueError(
                "backend_name must be one of "
                f"{'/'.join(self._VALID_BACKENDS)}, got {backend_name!r}"
            )

        self.sr = sr
        self.demucs_model = demucs_model
        self.backend_name = backend_name
        self.device = str(device or "cpu").strip().lower()
        self._backend_cache: Dict[tuple, object] = {}
        self.stem_classifier = StemClassifier(sr=sr)
        # CLAP embedding detector for per-stem timbre check (generator-invariant
        # signal that survives BS-RoFormer separation artifacts).
        try:
            self.embedding = EmbeddingDetector(device=self.device)
        except Exception as exc:
            logger.warning("Embedding detector init failed (per-stem CLAP disabled): %s", exc)
            self.embedding = None

        self.ast = (
            ASTDetector(model_path=ast_model_path, device=self.device)
            if ast_model_path else None
        )
        self.cnn = (
            CNNDetector(model_path=cnn_model_path, sr=sr, device=self.device)
            if cnn_model_path else None
        )

        # MoE lofcz (v1 + v2 specialists, max-aggregated) — same as engine.py
        from pathlib import Path as _Path
        _root = _Path(__file__).resolve().parent.parent
        _moe_dirs = [_root / "models/lofcz_v1_baseline", _root / "models/lofcz_v2"]
        if all(d.exists() for d in _moe_dirs):
            self.lofcz = LofczDetector(
                model_dirs=[str(d) for d in _moe_dirs],
                device=self.device,
            )
        else:
            self.lofcz = LofczDetector(device=self.device)
        self.highfreq = HighFrequencyDetector()
        self.phase = PhaseDetector()
        self.fakeprint = FakePrintDetector(sr=44100)

        self.fourier = FourierDetector(sr=sr)
        self.spectral = SpectralDetector(sr=sr)

    def warm_up(self) -> None:
        """Initialize reusable stem backends for batch-mode scoring."""
        try:
            backend = self._get_cached_backend(self.backend_name)
            warm_up = getattr(backend, "warm_up", None)
            if callable(warm_up):
                warm_up()
        except Exception as exc:
            logger.warning("SegmentDetector warm-up failed: %s", exc)

    def reset_per_track_state(self) -> None:
        """Keep backend weights loaded while giving child detectors a reset hook."""
        for detector in (
            self.embedding,
            self.ast,
            self.cnn,
            self.lofcz,
            self.highfreq,
            self.phase,
            self.fakeprint,
            self.fourier,
            self.spectral,
            self.stem_classifier,
        ):
            reset = getattr(detector, "reset_per_track_state", None)
            if callable(reset):
                reset()

    def _get_cached_backend(self, backend_name: str, **kwargs):
        """Return a reusable backend instance for this detector."""
        if backend_name == "demucs":
            kwargs.setdefault("model", self.demucs_model)
            kwargs.setdefault("four_stem", False)
        kwargs.setdefault("device", self.device)
        key = (
            backend_name,
            tuple(sorted((name, str(value)) for name, value in kwargs.items())),
        )
        if key not in self._backend_cache:
            self._backend_cache[key] = get_backend(backend_name, **kwargs)
        return self._backend_cache[key]

    def analyze(self, audio_path: str) -> SegmentResult:
        """
        Separate audio into stems and analyze each.

        Args:
            audio_path: Path to audio file

        Returns:
            SegmentResult with per-stem analysis
        """
        # Separate into stems
        stem_paths, backend_used = self._separate_stems(audio_path)

        stems = {}
        for stem_name, stem_path in stem_paths.items():
            stem_result = self._analyze_stem(stem_name, stem_path)
            stems[stem_name] = stem_result

        # Clean up temp files
        self._cleanup(stem_paths)

        # Calculate overall score
        active_stems = {k: v for k, v in stems.items() if v.has_content}

        if active_stems:
            # Prefer vocals when present; distribute the instrumental weight
            # across drums, bass, and other for 4-stem backends.
            stem_weights = {
                "vocals": 0.50,
                "instrumental": 0.50,
                # Fallback 4-stem weights
                "drums": 0.25,
                "bass": 0.20,
                "other": 0.20,
            }

            total_weight = sum(stem_weights.get(k, 0.25) for k in active_stems)
            overall_score = sum(
                (stem_weights.get(k, 0.25) / total_weight) * v.score
                for k, v in active_stems.items()
            )
            overall_confidence = sum(
                (stem_weights.get(k, 0.25) / total_weight) * v.confidence
                for k, v in active_stems.items()
            )
        else:
            overall_score = 0.5
            overall_confidence = 0.0

        result = SegmentResult(
            overall_score=float(np.clip(overall_score, 0, 1)),
            overall_confidence=float(overall_confidence),
            stems=stems,
            backend_used=backend_used,
            separation_method=backend_used,
        )

        # Generate summary
        result.mix_verdict = self._get_mix_verdict(result)
        result.summary = self._generate_summary(result)

        return result

    def _separate_stems(self, audio_path: str) -> tuple:
        """Separate ``audio_path`` into per-stem WAVs.

        Tries the configured backend first, transparently falling back to
        the legacy Demucs subprocess on any error (model load, OOM,
        ImportError, runtime crash). On a low-memory host the heavier
        Roformer / cascade backends are bypassed up front.

        Returns:
            ``(stem_paths, backend_used)`` where ``stem_paths`` maps stem
            name -> WAV path, and ``backend_used`` is the name of the
            backend that actually produced the stems. If everything
            fails the function falls back to ``{"mix": audio_path}`` and
            ``backend_used="none"``, mirroring the legacy behaviour.
        """
        requested = self.backend_name

        # Memory guard — drop heavy backends on tight machines.
        if requested in ("bs_roformer_4stem", "bs_roformer_cascade", "cascade", "roformer"):
            try:
                import psutil  # noqa: WPS433 — optional runtime dep
                available = psutil.virtual_memory().available
                if available < self._LOW_MEMORY_BYTES:
                    logger.warning(
                        "Low memory (%.1f GB available) — forcing demucs backend "
                        "instead of %s",
                        available / 1024 ** 3,
                        requested,
                    )
                    requested = "demucs"
            except ImportError:
                # psutil isn't installed; trust the caller and keep going.
                pass
            except Exception as exc:
                logger.debug("psutil memory probe failed (%s); ignoring", exc)

        # Try the requested backend, then fall back to the legacy cascade
        # before Demucs when the new unified BS-RoFormer model cannot load.
        if requested == "demucs":
            attempts = ["demucs"]
        elif requested in ("bs_roformer_4stem", "bs_roformer_cascade"):
            attempts = [requested, "cascade", "demucs"]
        elif requested == "cascade":
            attempts = ["cascade", "demucs"]
        else:
            attempts = [requested, "demucs"]
        last_error: Optional[Exception] = None

        for backend_name in attempts:
            tmp_dir = tempfile.mkdtemp(prefix="aivshu_stems_")
            try:
                kwargs = {}
                if backend_name == "demucs":
                    # Preserve legacy 2-stem behaviour for the standalone
                    # demucs path; the cascade configures its own demucs
                    # instance internally with four_stem=True.
                    kwargs["model"] = self.demucs_model
                    kwargs["four_stem"] = False
                kwargs["device"] = self.device

                backend = self._get_cached_backend(backend_name, **kwargs)
                stem_paths = backend.separate(audio_path, tmp_dir)
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "Stem backend %r failed: %s — %s",
                    backend_name,
                    type(exc).__name__,
                    exc,
                )
                # Best-effort cleanup of the failed attempt's scratch.
                self._wipe(tmp_dir)
                continue

            if not stem_paths:
                last_error = RuntimeError(
                    f"backend {backend_name!r} returned no stems"
                )
                logger.warning(
                    "Stem backend %r returned no stems; trying next", backend_name
                )
                self._wipe(tmp_dir)
                continue

            return stem_paths, backend_name

        # Nothing worked — fall back to whole-mix analysis exactly like
        # the legacy code did when Demucs was unavailable.
        if last_error is not None:
            logger.warning(
                "All stem backends failed; falling back to whole-mix analysis "
                "(last error: %s)",
                last_error,
            )
        return {"mix": audio_path}, "none"

    @staticmethod
    def _wipe(tmp_dir: str):
        import shutil
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass

    def _analyze_stem(self, stem_name: str, stem_path: str) -> StemResult:
        """Analyze a single audio stem."""
        import librosa

        # Check if stem has meaningful content
        y, sr = librosa.load(stem_path, sr=self.sr, mono=True)
        rms = np.sqrt(np.mean(y ** 2))

        # Raised from 0.001 to 0.003: BS-RoFormer leaves much less bleed
        # than Demucs, so the noise floor of an "empty" stem is genuinely
        # quieter and the old threshold under-rejected silent stems.
        if rms < 0.003:  # Essentially silent
            return StemResult(
                name=stem_name,
                score=0.5,
                confidence=0.0,
                has_content=False,
                anomalies=[f"{stem_name}: No significant content detected"],
            )

        anomalies = []
        # ------------------------------------------------------------------
        # Unified per-stem detection (super-upgrade v1.1.0)
        #
        # Run the strongest available detectors on EVERY stem (vocals, drums,
        # bass, other, instrumental). Previous logic had a critical hole:
        # the "vocals" branch only ran AST, and AST is fooled by Suno v5+/Udio
        # v3+ — meaning AI vocals mixed into real productions slipped through
        # the per-stem layer entirely.
        #
        # We use confidence-weighted fusion (weight = base_weight * |s-0.5|*2)
        # so detectors that return ~0.5 (no signal) contribute nothing instead
        # of dragging the score toward "uncertain."
        # ------------------------------------------------------------------
        per_detector: dict = {}

        # Lofcz — by far the most accurate detector empirically; run on EVERY stem
        try:
            lofcz_r = self.lofcz.analyze(stem_path)
            if lofcz_r.model_loaded:
                per_detector["lofcz"] = lofcz_r.score
                if lofcz_r.score > 0.65:
                    anomalies.append(f"{stem_name}: lofcz flags AI (score={lofcz_r.score:.2f})")
        except Exception as exc:
            logger.debug("Per-stem lofcz failed on %s: %s", stem_name, exc)

        # CLAP embedding — generator-invariant timbre check
        if self.embedding is not None:
            try:
                emb_r = self.embedding.analyze(stem_path)
                if emb_r.model_loaded and emb_r.confidence > 0.05:
                    per_detector["embedding"] = emb_r.score
                    if emb_r.score > 0.65:
                        anomalies.append(f"{stem_name}: CLAP embedding closer to AI cluster (score={emb_r.score:.2f})")
            except Exception as exc:
                logger.debug("Per-stem CLAP failed on %s: %s", stem_name, exc)

        # AST is intentionally NOT run on per-stem vocals.
        # Per Codex F audit (2026-04-29): AST is empirically fooled by Suno
        # v5+ vocals (scored 0.000 on v5.5 tracks; missed AI vocals on the
        # MAI Hebrew master). Lofcz + CLAP cover this stem better.
        # AST is retained at the full-track level only as a low-weight
        # brake on lofcz false-positives on heavily-mastered human tracks.

        # Signal-domain detectors — useful on instruments / production
        if stem_name in ("instrumental", "drums", "bass", "other"):
            try:
                hf_r = self.highfreq.analyze(stem_path)
                per_detector["highfreq"] = hf_r.score
                if hf_r.score > 0.65:
                    anomalies.append(f"{stem_name}: high-freq cutoff anomaly (score={hf_r.score:.2f})")
            except Exception:
                pass
            try:
                phase_r = self.phase.analyze(stem_path)
                per_detector["phase"] = phase_r.score
                if phase_r.score > 0.65:
                    anomalies.append(f"{stem_name}: phase coherence anomaly (score={phase_r.score:.2f})")
            except Exception:
                pass
            try:
                fp_r = self.fakeprint.analyze(stem_path)
                per_detector["fakeprint"] = fp_r.score
                if fp_r.score > 0.65:
                    anomalies.append(f"{stem_name}: fakeprint residue (score={fp_r.score:.2f})")
            except Exception:
                pass

        # Stem-class supplementary signal (for non-vocals only — adds genre/instrument cues)
        if stem_name not in ("vocals", "instrumental"):
            try:
                stem_r = self.stem_classifier.analyze_array(y=y, sr=sr, stem_name=stem_name)
                per_detector["stem_classifier"] = stem_r.score
                anomalies.extend(f"{stem_name}: {a}" for a in stem_r.anomalies)
            except Exception:
                pass

        # ------------------------------------------------------------------
        # Confidence-weighted fusion across whatever detectors fired.
        # base_weights reflect empirical reliability:
        #   lofcz dominates (0.50), CLAP embedding solid (0.20), AST (0.15)
        #   when present, signal detectors smaller because they're often fooled.
        # ------------------------------------------------------------------
        base_weights = {
            "lofcz": 0.55,        # was 0.50 — absorbed AST's per-stem weight
            "embedding": 0.25,    # was 0.20 — slight bump (CLAP is robust to v5+)
            "highfreq": 0.10,     # was 0.07
            "phase": 0.05,        # was 0.04
            "fakeprint": 0.03,    # was 0.02
            "stem_classifier": 0.02,
            # NOTE: "ast" intentionally absent — per Codex F audit, AST is
            # fooled by Suno v5+ vocals and adds 0 verdict flips at this scale.
        }

        weighted_sum = 0.0
        weight_total = 0.0
        for name, score in per_detector.items():
            base_w = base_weights.get(name, 0.05)
            confidence_w = abs(score - 0.5) * 2.0  # 0 = no signal, 1 = max
            eff_w = base_w * confidence_w
            weighted_sum += eff_w * score
            weight_total += eff_w

        if weight_total < 1e-9:
            # All detectors near 0.5 — true uncertainty
            combined_score = 0.5
            confidence = 0.0
        else:
            combined_score = weighted_sum / weight_total
            # Confidence = average detector confidence weighted by base weight
            confidence = min(1.0, weight_total / sum(
                base_weights.get(k, 0.05) for k in per_detector
            ))

        return StemResult(
            name=stem_name,
            score=float(np.clip(combined_score, 0, 1)),
            confidence=float(np.clip(confidence, 0, 1)),
            anomalies=anomalies,
            has_content=True,
        )

    def _get_mix_verdict(self, result: SegmentResult) -> str:
        """Determine the overall mix verdict."""
        ai_stems = result.ai_stems
        human_stems = result.human_stems

        if not ai_stems and not human_stems:
            return "Uncertain"
        elif ai_stems and not human_stems:
            return "Fully AI Generated"
        elif not ai_stems and human_stems:
            return "Fully Human Made"
        else:
            return "Hybrid (AI + Human)"

    def _generate_summary(self, result: SegmentResult) -> str:
        """Generate a human-readable summary."""
        lines = []

        lines.append(f"Mix Type: {result.mix_verdict}")
        lines.append("")

        for stem_name, stem in result.stems.items():
            emoji = stem.emoji
            lines.append(
                f"{emoji} {stem_name.title():10s} — "
                f"{stem.verdict} (score: {stem.score:.2f}, confidence: {stem.confidence:.0%})"
            )

        if result.ai_stems:
            lines.append("")
            lines.append(f"AI-detected stems: {', '.join(result.ai_stems)}")

        if result.human_stems:
            lines.append(f"Human-detected stems: {', '.join(result.human_stems)}")

        return "\n".join(lines)

    def _cleanup(self, stem_paths: Dict[str, str]):
        """Clean up temporary stem files."""
        import shutil

        # Find the parent temp directory
        for path in stem_paths.values():
            p = Path(path)
            # Walk up to find the aivshu_stems_ temp dir
            while p.parent != p:
                if p.name.startswith("aivshu_stems_"):
                    try:
                        shutil.rmtree(str(p))
                    except Exception:
                        pass
                    return
                p = p.parent
