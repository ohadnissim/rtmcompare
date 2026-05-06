"""
Passive Watermark Verifier for UAI.

Three watermark formats are checked, none of which we generate ourselves.
This is a recall detector that uses ground-truth provenance signals
embedded by AI generators (or content-credentialing pipelines) into the
audio file. When any of them fires we are essentially certain the track
is AI-generated, which is why this detector gets a hard 1.0 score and is
weighted heavily in the ensemble when present.

Formats verified
----------------

1. C2PA Content Credentials. Coalition for Content Provenance and
   Authenticity manifest, embedded as JUMBF blocks in the audio container
   (or in a sidecar ``.c2pa`` file). Adobe Firefly, OpenAI, Microsoft and
   several other vendors embed C2PA manifests that explicitly declare
   ``c2pa.actions`` like ``c2pa.created`` with a ``digitalSourceType`` of
   ``trainedAlgorithmicMedia`` (i.e. AI-generated). We use the official
   ``c2pa`` library when available, otherwise fall back to scanning the
   raw bytes for the JUMBF magic + ``c2pa`` token (best-effort).

2. AudioSeal. Meta's open-source neural audio watermark
   (https://github.com/facebookresearch/audioseal). The pretrained
   detector consumes 16 kHz mono audio and emits a per-sample watermark
   probability tensor; we average it over the entire clip and treat
   means above 0.7 as a positive detection. The 16-bit message payload
   is ignored; we only care that a watermark is present.

3. Google SynthID for music. Google publicly deployed SynthID for
   Lyria-3 generated tracks but, as of 2026-04-29, the verifier API is
   not available to third parties. We keep a stub here so that when
   Google ships a public verifier we can drop it in without changing
   the ensemble integration. Until then this branch always returns
   ``synthid_present=False``.

Performance contract
--------------------
``analyze()`` MUST complete in well under a second on Mac CPU:
    - C2PA: ``c2pa.Reader`` is a thin wrapper over a Rust library; cold
      read of an MP3 with no manifest takes a few milliseconds.
    - AudioSeal: we run only the *detector* (not the generator) on the
      first ~10 s of audio at 16 kHz mono. On a 2024 MacBook Pro this is
      well under 200 ms. We don't load the generator unless explicitly
      asked to self-watermark for testing.
    - SynthID: no-op.

Graceful degradation
--------------------
The detector NEVER raises out of ``analyze()``. If a library fails to
import or load, the corresponding ``*_present`` flag stays False, the
``model_loaded`` flag for the AudioSeal sub-component goes False, and
we emit an anomaly string explaining why. The score in that case is
0.0 (no watermark observed → no positive evidence) rather than 0.5,
because absence of a watermark is the *expected* state for the vast
majority of inputs.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np

logger = logging.getLogger(__name__)


# ---- Optional heavy deps (guarded) -----------------------------------------

try:  # AudioSeal: Meta's open-source neural watermark
    from audioseal import AudioSeal  # type: ignore
    AUDIOSEAL_AVAILABLE = True
except Exception:  # pragma: no cover - import-time guard
    AUDIOSEAL_AVAILABLE = False

try:  # PyTorch needed for AudioSeal tensors
    import torch  # type: ignore
    TORCH_AVAILABLE = True
except Exception:  # pragma: no cover
    TORCH_AVAILABLE = False

try:  # C2PA: official Rust-backed Python bindings
    import c2pa  # type: ignore
    C2PA_AVAILABLE = True
except Exception:  # pragma: no cover
    C2PA_AVAILABLE = False


# ---- Result dataclass ------------------------------------------------------

@dataclass
class WatermarkResult:
    """Result from passive watermark verification.

    ``score`` is the AI-probability contribution this detector makes to the
    ensemble. Unlike the signal-domain detectors it is hard-thresholded:
    1.0 = at least one watermark fired confidently → essentially certain AI;
    0.5 = partial AudioSeal signal (mean prob in 0.4-0.7) → uncertain;
    0.0 = no watermark detected (the default state of nearly all inputs).
    """

    score: float = 0.0
    confidence: float = 0.0
    detected: List[str] = field(default_factory=list)
    watermark_strength: float = 0.0
    c2pa_present: bool = False
    c2pa_manifest: Optional[Dict] = None
    audioseal_present: bool = False
    synthid_present: bool = False
    model_loaded: bool = False
    anomalies: List[str] = field(default_factory=list)


# ---- Detector --------------------------------------------------------------

class WatermarkDetector:
    """Passive watermark verifier — never *embeds* anything, only reads.

    The constructor lazily loads the AudioSeal detector model. If
    AudioSeal isn't installed or fails to load, we still return a usable
    detector instance — every analyze() call will just skip the AudioSeal
    branch and rely on C2PA. ``model_loaded`` reflects whether at least
    *one* verifier (AudioSeal or C2PA) is functional.
    """

    # AudioSeal operates at 16 kHz mono and we only need a short window
    # to decide whether a watermark is present. Using 10 s keeps the
    # detector well under the 1 s wall-clock target on CPU.
    AUDIOSEAL_SR = 16000
    AUDIOSEAL_MAX_SECONDS = 10.0

    # Mean per-sample probability above this counts as a confident
    # AudioSeal hit. Below 0.4 = no signal. 0.4..0.7 = uncertain band.
    AUDIOSEAL_HIGH_THRESHOLD = 0.7
    AUDIOSEAL_LOW_THRESHOLD = 0.4

    def __init__(self) -> None:
        self._audioseal_detector = None
        self._audioseal_load_error: Optional[str] = None

        if AUDIOSEAL_AVAILABLE and TORCH_AVAILABLE:
            try:
                # Force CPU. On Mac the MPS backend works but torch warns
                # noisily for the weight_norm parameterizations AudioSeal
                # uses, and the speed gain is negligible for ~10s clips.
                self._audioseal_detector = AudioSeal.load_detector(
                    "audioseal_detector_16bits"
                )
                self._audioseal_detector.eval()
            except Exception as exc:  # noqa: BLE001 - graceful degrade
                self._audioseal_load_error = str(exc)[:200]
                logger.warning("AudioSeal detector load failed: %s", exc)
        else:
            self._audioseal_load_error = (
                "audioseal not installed" if not AUDIOSEAL_AVAILABLE
                else "torch not installed"
            )

        # We consider the verifier "model_loaded" if at least one of
        # AudioSeal or C2PA can run. SynthID is always unavailable (no
        # public verifier in 2026-04-29) so it doesn't contribute here.
        self.model_loaded = (
            self._audioseal_detector is not None
        ) or C2PA_AVAILABLE

    # ----------------------------------------------------------------- main

    def analyze(self, audio_path: str) -> WatermarkResult:
        """Verify watermarks in ``audio_path``. Never raises."""

        if not audio_path or not os.path.exists(audio_path):
            return WatermarkResult(
                score=0.0,
                confidence=0.0,
                model_loaded=self.model_loaded,
                anomalies=[f"watermark: file not found: {audio_path or '<empty>'}"],
            )

        anomalies: List[str] = []
        detected: List[str] = []

        # --- 1. C2PA Content Credentials ---------------------------------
        c2pa_present, c2pa_manifest, c2pa_label, c2pa_anom = self._check_c2pa(audio_path)
        if c2pa_anom:
            anomalies.extend(c2pa_anom)
        if c2pa_present:
            # ``c2pa_label`` includes the issuer when we can find it,
            # e.g. "c2pa-adobe" or "c2pa-openai". Falls back to "c2pa".
            detected.append(c2pa_label)

        # --- 2. AudioSeal --------------------------------------------------
        audioseal_present, audioseal_strength, audioseal_anom = self._check_audioseal(
            audio_path
        )
        if audioseal_anom:
            anomalies.extend(audioseal_anom)
        if audioseal_present:
            detected.append("audioseal")

        # --- 3. SynthID (stub) --------------------------------------------
        # No public verifier as of 2026-04-29. When Google ships one, plug
        # the call in here. We keep the slot so the ensemble code doesn't
        # need to change to start consuming SynthID hits later.
        synthid_present = False

        # --- Aggregate score ----------------------------------------------
        if c2pa_present or audioseal_strength >= self.AUDIOSEAL_HIGH_THRESHOLD or synthid_present:
            score = 1.0
            confidence = 0.95
        elif audioseal_strength >= self.AUDIOSEAL_LOW_THRESHOLD:
            # Partial AudioSeal signal — could be a degraded watermark
            # that survived re-encoding, or noise. Mark uncertain.
            score = 0.5
            confidence = 0.4
        else:
            # No watermark detected. This is the expected state for
            # almost all inputs; we contribute 0 to the ensemble.
            score = 0.0
            # Confidence stays 0 so the ensemble's confidence-weighting
            # collapses our contribution to nothing on the no-signal path.
            confidence = 0.0

        return WatermarkResult(
            score=score,
            confidence=confidence,
            detected=detected,
            watermark_strength=float(audioseal_strength),
            c2pa_present=c2pa_present,
            c2pa_manifest=c2pa_manifest,
            audioseal_present=audioseal_present,
            synthid_present=synthid_present,
            model_loaded=self.model_loaded,
            anomalies=anomalies,
        )

    # ---------------------------------------------------------------- C2PA

    def _check_c2pa(self, audio_path: str):
        """Return ``(present, manifest_dict, label, anomalies)``.

        Tries the official c2pa library first. If that's unavailable or
        the file format is unsupported, we still attempt a best-effort
        byte-scan for the JUMBF box header — this catches the case where
        someone has stuck a manifest into an unusual container.
        """
        anomalies: List[str] = []

        if C2PA_AVAILABLE:
            try:
                reader = c2pa.Reader(audio_path)
                manifest_json = reader.json()
                reader.close()
                if manifest_json and manifest_json.strip() not in ("", "{}", "null"):
                    parsed: Optional[Dict]
                    try:
                        parsed = json.loads(manifest_json)
                    except Exception:  # noqa: BLE001
                        parsed = {"raw": manifest_json}
                    label = self._c2pa_label_from_manifest(parsed)
                    return True, parsed, label, anomalies
                # Empty manifest is treated as no-manifest.
                return False, None, "", anomalies
            except Exception as exc:  # noqa: BLE001
                # The library raises C2paManifestNotFound for the common
                # "no JUMBF data found" case — that's the expected path
                # for nearly every input, so don't pollute anomalies with
                # it. Only surface other error classes.
                msg = str(exc)
                if "ManifestNotFound" in msg or "no JUMBF data found" in msg:
                    pass  # the expected "no watermark" path
                else:
                    anomalies.append(f"watermark: c2pa read error: {msg[:120]}")
                # Fall through to byte-scan in case the lib couldn't parse
                # an exotic container that still has JUMBF in it.

        # Best-effort fallback: scan the first ~256 KB for the JUMBF
        # signature. JUMBF boxes start with a 4-byte big-endian length,
        # then the ASCII type "jumb", and a C2PA box uses a "c2pa" label
        # in its description box. This is a recall-only check — false
        # positives (e.g. lyrics containing "c2pa") are extremely unlikely
        # but we still require the JUMBF magic to be present.
        try:
            with open(audio_path, "rb") as fh:
                head = fh.read(256 * 1024)
            if b"jumb" in head and b"c2pa" in head:
                return True, {"detected_via": "byte_scan"}, "c2pa", anomalies
        except Exception as exc:  # noqa: BLE001
            anomalies.append(f"watermark: byte-scan failed: {str(exc)[:80]}")

        return False, None, "", anomalies

    @staticmethod
    def _c2pa_label_from_manifest(manifest: Optional[Dict]) -> str:
        """Pick a friendly label like ``c2pa-adobe`` from a parsed manifest.

        We look at the ``claim_generator`` / ``claim_generator_info`` field
        in the active manifest; common values include ``"Adobe Firefly"``,
        ``"OpenAI"``, ``"Microsoft Designer"`` etc. Anything we don't
        recognize collapses to the generic ``c2pa`` label.
        """
        if not isinstance(manifest, dict):
            return "c2pa"
        try:
            active_label = manifest.get("active_manifest")
            manifests = manifest.get("manifests", {}) or {}
            active = manifests.get(active_label) if active_label else None
            if active is None and manifests:
                # Fall back to the first manifest if no active pointer.
                active = next(iter(manifests.values()))
            if not isinstance(active, dict):
                return "c2pa"

            # Newer manifests use ``claim_generator_info`` (a list); older
            # ones use the flat ``claim_generator`` string.
            generator_info = active.get("claim_generator_info") or []
            if isinstance(generator_info, list) and generator_info:
                name = str(generator_info[0].get("name", "")).lower()
            else:
                name = str(active.get("claim_generator", "")).lower()

            for token, label in (
                ("adobe", "c2pa-adobe"),
                ("firefly", "c2pa-adobe"),
                ("openai", "c2pa-openai"),
                ("anthropic", "c2pa-anthropic"),
                ("microsoft", "c2pa-microsoft"),
                ("google", "c2pa-google"),
                ("stability", "c2pa-stability"),
                ("midjourney", "c2pa-midjourney"),
                ("suno", "c2pa-suno"),
                ("udio", "c2pa-udio"),
            ):
                if token in name:
                    return label
        except Exception:  # noqa: BLE001
            pass
        return "c2pa"

    # ----------------------------------------------------------- AudioSeal

    def _check_audioseal(self, audio_path: str):
        """Return ``(present, mean_strength, anomalies)``.

        ``present`` is True iff the mean per-sample watermark probability
        exceeds ``AUDIOSEAL_HIGH_THRESHOLD``. Returning the raw mean lets
        the caller distinguish ``no signal`` (0.0) from ``faint signal``
        (0.4-0.7), which we forward to the ensemble as score=0.5.
        """
        anomalies: List[str] = []

        if self._audioseal_detector is None:
            if self._audioseal_load_error:
                anomalies.append(
                    f"watermark: audioseal unavailable ({self._audioseal_load_error})"
                )
            return False, 0.0, anomalies

        try:
            audio = self._load_audio_for_audioseal(audio_path)
            if audio is None:
                anomalies.append("watermark: audioseal — could not load audio")
                return False, 0.0, anomalies
        except Exception as exc:  # noqa: BLE001
            anomalies.append(f"watermark: audioseal load failed: {str(exc)[:120]}")
            return False, 0.0, anomalies

        try:
            with torch.no_grad():
                # detect_watermark returns a tuple (probability_tensor,
                # message_tensor). The probability tensor has shape
                # (B=1, 2, T) where index 1 is "watermark present" prob
                # per sample. We mean-reduce to a scalar.
                result, _message = self._audioseal_detector.detect_watermark(
                    audio, sample_rate=self.AUDIOSEAL_SR
                )
                # Older audioseal versions return a single tensor
                # (B, 2, T) whose channel 1 is the watermark prob; the
                # detect_watermark wrapper sometimes returns a single
                # scalar already. Handle both.
                if isinstance(result, torch.Tensor):
                    if result.ndim == 0:
                        mean_prob = float(result.item())
                    elif result.ndim == 3 and result.shape[1] >= 2:
                        mean_prob = float(result[:, 1, :].mean().item())
                    else:
                        mean_prob = float(result.mean().item())
                else:
                    mean_prob = float(result)
        except Exception as exc:  # noqa: BLE001
            anomalies.append(f"watermark: audioseal inference failed: {str(exc)[:120]}")
            return False, 0.0, anomalies

        # Clamp into [0, 1] to defend against numerical edge cases.
        mean_prob = max(0.0, min(1.0, mean_prob))
        present = mean_prob >= self.AUDIOSEAL_HIGH_THRESHOLD
        return present, mean_prob, anomalies

    def _load_audio_for_audioseal(self, audio_path: str):
        """Load the first ``AUDIOSEAL_MAX_SECONDS`` of audio at 16 kHz mono.

        Returns a ``torch.Tensor`` with shape ``(1, 1, T)`` ready to feed
        the AudioSeal detector. We try soundfile first (fast, no resample)
        and fall back to librosa for formats soundfile can't handle (mp3
        on some platforms).
        """
        if not TORCH_AVAILABLE:
            return None

        max_samples = int(self.AUDIOSEAL_SR * self.AUDIOSEAL_MAX_SECONDS)

        audio_np: Optional[np.ndarray] = None

        # Attempt 1: soundfile (handles wav/flac/ogg natively, sometimes
        # mp3 via libsndfile >= 1.1).
        try:
            import soundfile as sf  # type: ignore

            audio_np, sr = sf.read(audio_path, dtype="float32", always_2d=False)
            if audio_np.ndim > 1:
                # Stereo -> mono mean
                audio_np = audio_np.mean(axis=1)
            if sr != self.AUDIOSEAL_SR:
                # Use soxr if available (very fast), otherwise librosa.
                try:
                    import soxr  # type: ignore

                    audio_np = soxr.resample(audio_np, sr, self.AUDIOSEAL_SR)
                except Exception:
                    import librosa  # type: ignore

                    audio_np = librosa.resample(
                        audio_np, orig_sr=sr, target_sr=self.AUDIOSEAL_SR
                    )
        except Exception:
            audio_np = None

        # Attempt 2: librosa fallback (slower but handles MP3 reliably).
        if audio_np is None:
            try:
                import librosa  # type: ignore

                audio_np, _sr = librosa.load(
                    audio_path,
                    sr=self.AUDIOSEAL_SR,
                    mono=True,
                    duration=self.AUDIOSEAL_MAX_SECONDS,
                )
            except Exception:
                return None

        if audio_np is None or audio_np.size == 0:
            return None

        # Truncate to max window. We've already capped via librosa's
        # ``duration`` arg; this guards the soundfile path.
        if audio_np.shape[0] > max_samples:
            audio_np = audio_np[:max_samples]

        # AudioSeal expects (B, C, T). Mono -> single channel.
        tensor = torch.from_numpy(np.ascontiguousarray(audio_np, dtype=np.float32))
        return tensor.view(1, 1, -1)
