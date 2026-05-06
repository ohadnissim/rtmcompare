"""
lofcz AI Music Detector: 99.88% accuracy pretrained model.

Uses spectral fakeprint extraction (lower-hull subtraction in 1-8kHz)
fed into a logistic regression ONNX model.

Based on: https://github.com/lofcz/ai-music-detector
Model: https://huggingface.co/lofcz/ai-music-detector

Post-hoc calibration
--------------------
The raw ONNX output is calibrated for Suno v3-era tracks (clean ~0.7 on AI,
low scores on human) but saturates near 1.0 for Suno v5.5 and other modern
generators, which makes the 0.5 decision boundary distribution-dependent.

If ``models/lofcz_calibration.json`` exists, ``LofczDetector`` loads it on
construction and applies the mapping to the raw ONNX probability before
returning. The original probability is preserved as ``LofczResult.raw_score``
for debugging. Calibration parameters are produced by
``scripts/calibrate_lofcz.py`` and currently support two methods:

* ``sigmoid``: Platt scaling, ``p_cal = 1 / (1 + exp(A * raw + B))``
* ``isotonic``: piecewise-linear isotonic regression with knots ``(x, y)``

If the file is missing or malformed, behaviour is identical to the
uncalibrated detector (raw score is returned and ``raw_score`` mirrors it).

Mixture-of-Experts (MoE) plumbing
---------------------------------
``LofczDetector`` can be constructed in two modes:

* Single-head (default, legacy): pass nothing, or pass ``model_dir=...``.
  Output is byte-identical to the original implementation.
* Multi-head: pass ``model_dirs=[dir_a, dir_b, ...]``. Each dir is loaded
  as an independent ONNX session with its own optional Platt/isotonic
  calibration (read from ``<head_dir>/calibration.json`` if present, else the
  legacy ``models/lofcz_calibration.json``). The expensive fakeprint vector is
  computed exactly ONCE per audio file and broadcast to every head; only the
  cheap ONNX matmul + per-head calibration is repeated.

Aggregation across heads is confidence-weighted soft voting: each head's
calibrated probability ``p_i`` is weighted by ``|p_i - 0.5|``, so a head
close to the decision boundary contributes almost nothing while a
confidently-AI (or confidently-human) head dominates. If every head outputs
exactly 0.5 the final score is 0.5 (no signal). With a single head this
collapses to ``final_p = p_0`` (the legacy behaviour), verified by the
smoke test.
"""

import json
import logging
import math
import numpy as np
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Union

import torch
import torchaudio
import soxr
from scipy import interpolate

from ._runtime import (
    ModelIntegrityError,
    file_sha256,
    get_onnx_providers,
    resolve_model_path,
)

try:
    import onnxruntime as ort
    ONNX_AVAILABLE = True
except ImportError:
    ONNX_AVAILABLE = False


logger = logging.getLogger(__name__)


@dataclass
class LofczResult:
    score: float  # 0 = human, 1 = AI (calibrated, aggregated when multi-head)
    confidence: float
    model_loaded: bool
    fakeprint_energy: float = 0.0
    raw_score: float = 0.5  # Uncalibrated ONNX probability (first head if multi-head).
    # MoE additions — defaulted so existing single-head callers don't crash.
    head_scores: Dict[str, float] = field(default_factory=dict)
    head_count: int = 0


class _LofczHead:
    """One ONNX session + its own calibration. Internal helper for MoE."""

    __slots__ = ("name", "model_dir", "ort_session", "calibration")

    def __init__(
        self,
        name: str,
        model_dir: Path,
        ort_session: "ort.InferenceSession",
        calibration: Optional[dict],
    ) -> None:
        self.name = name
        self.model_dir = model_dir
        self.ort_session = ort_session
        self.calibration = calibration


class LofczDetector:
    """
    Pretrained AI music detector from lofcz (99.88% accuracy).
    Extracts spectral fakeprint vector and classifies via ONNX logistic regression.

    Two construction modes:
    * ``LofczDetector()`` or ``LofczDetector(model_dir=...)`` — single head
      (legacy). Behaviour is identical to the pre-MoE implementation.
    * ``LofczDetector(model_dirs=[...])`` — multi-head MoE. Heads run on the
      same fakeprint vector and are aggregated via the operator-configurable
      mode set by ``aggregator_mode``. ``model_dir`` is ignored when
      ``model_dirs`` is given.

    Patent Claim 4 (aggregator-agnostic ensembling) is deployed through the
    ``aggregator_mode`` parameter. Five runtime-switchable modes are
    supported, with no head retraining required:

    * ``"soft_vote"`` (default): confidence-weighted soft vote
      ``Σ(p_i × |p_i − 0.5|) / Σ|p_i − 0.5|`` plus the v4-augmented-pinned
      promotion override. This is the production default and preserves
      byte-identical behaviour relative to the pre-Claim-4-deployment code.
    * ``"max"``: ``max(probs)`` across heads.
    * ``"mean"``: arithmetic mean across heads.
    * ``"top_k_mean"``: arithmetic mean of the top-``k`` probabilities;
      ``k`` defaults to ``ceil(n_heads / 2)`` when not specified.
    * ``"max_with_std_penalty"``: ``max(probs) − alpha × std(probs)`` where
      ``alpha`` defaults to ``0.5``.

    The v4-pin promotion path is intentionally restricted to ``"soft_vote"``;
    the other modes apply their pure mathematical reduction without
    overrides. Invalid mode names raise ``ValueError`` at construction time.
    """

    AGGREGATOR_MODES = (
        "soft_vote",
        "max",
        "mean",
        "top_k_mean",
        "max_with_std_penalty",
    )

    def __init__(
        self,
        model_dir: Optional[str] = None,
        model_dirs: Optional[List[Union[str, Path]]] = None,
        aggregator_mode: str = "soft_vote",
        top_k: Optional[int] = None,
        std_penalty_alpha: float = 0.5,
        device: str = "cpu",
    ):
        self.device = str(device or "cpu").strip().lower()
        # ---- Aggregator-mode configuration (Patent Claim 4 deployment) ------
        if aggregator_mode not in self.AGGREGATOR_MODES:
            raise ValueError(
                f"aggregator_mode must be one of {self.AGGREGATOR_MODES!r}, "
                f"got {aggregator_mode!r}"
            )
        self.aggregator_mode = aggregator_mode
        if top_k is not None:
            top_k_int = int(top_k)
            if top_k_int < 1:
                raise ValueError(
                    f"top_k must be a positive integer when given, got {top_k!r}"
                )
            self.top_k = top_k_int
        else:
            self.top_k = None
        self.std_penalty_alpha = float(std_penalty_alpha)

        # ---- Decide which directories to load -------------------------------
        # MoE path takes precedence over the legacy single-dir path. When
        # neither is given we fall back to the runtime-resolved default
        # (``models/lofcz/``), preserving original behaviour bit-for-bit.
        if model_dirs is not None:
            head_dirs: List[Path] = [Path(d) for d in model_dirs]
        elif model_dir is not None:
            head_dirs = [Path(model_dir)]
        else:
            try:
                configured_model = resolve_model_path("lofcz")
            except ModelIntegrityError as exc:
                logger.error("%s", exc)
                configured_model = None
            default_dir = (
                configured_model.parent if configured_model
                else Path("models") / "lofcz"
            )
            head_dirs = [default_dir]

        # First head's dir is exposed as ``self.model_dir`` to keep any
        # external introspection (tests, logging) working unchanged.
        self.model_dir = head_dirs[0]

        # Preprocessing params (fakeprint is computed ONCE for all heads).
        self.sr = 16000
        self.n_fft = 8192
        self.freq_min = 1000
        self.freq_max = 8000
        self.hull_area = 10
        self.max_db = 5
        self.min_db = -45
        self.n_features = 3585
        self.max_duration_seconds = 180
        self.stft_transformer = torchaudio.transforms.Spectrogram(
            n_fft=self.n_fft,
            power=2,
        )

        # ---- Load each head -------------------------------------------------
        self._heads: List[_LofczHead] = []
        for hd in head_dirs:
            head = self._load_head(hd)
            if head is not None:
                self._heads.append(head)

        # Legacy attributes — first head's session is exposed as
        # ``self.ort_session`` so any code that pokes at it directly still
        # works. ``model_loaded`` is True iff at least one head loaded.
        self.model_loaded = bool(self._heads)
        self.ort_session = self._heads[0].ort_session if self._heads else None
        self._calibration = self._heads[0].calibration if self._heads else None
        self._head_records = [self._head_record(head) for head in self._heads]

    @property
    def providers(self) -> List[str]:
        """Actual ONNX Runtime providers used by the loaded lofcz sessions."""
        if not self._heads:
            return []
        return list(self._heads[0].ort_session.get_providers())

    # ------------------------------------------------------------------ heads

    @property
    def heads(self) -> List[dict]:
        """Structured metadata for each loaded MoE head."""
        return [dict(record) for record in self._head_records]

    @property
    def head_paths(self) -> List[dict]:
        """Compatibility alias for external head introspection."""
        return self.heads

    @staticmethod
    def _calibration_type(calibration: Optional[dict]) -> Optional[str]:
        if not calibration:
            return None
        return str(calibration.get("method", "unknown"))

    def _head_record(self, head: _LofczHead) -> dict:
        onnx_path = head.model_dir / "ai_music_detector.onnx"
        return {
            "name": str(head.name),
            "sha256": file_sha256(onnx_path) if onnx_path.exists() else None,
            "path": str(head.model_dir),
            "calibration_type": self._calibration_type(head.calibration),
        }

    def _load_head(self, head_dir: Path) -> Optional[_LofczHead]:
        """Load one ONNX session + calibration. Returns None on failure."""
        onnx_path = head_dir / "ai_music_detector.onnx"
        if not onnx_path.exists() or not ONNX_AVAILABLE:
            logger.warning("lofcz head %s: ONNX missing or runtime unavailable", head_dir)
            return None
        try:
            providers = get_onnx_providers(self.device)
            session = ort.InferenceSession(
                str(onnx_path), providers=providers
            )
        except Exception as exc:
            logger.warning("lofcz head %s load failed: %s", head_dir, exc)
            return None

        calibration = self._load_calibration(head_dir)
        # Head name = directory basename, e.g. "lofcz", "lofcz_v1_baseline".
        return _LofczHead(
            name=head_dir.name,
            model_dir=head_dir,
            ort_session=session,
            calibration=calibration,
        )

    @staticmethod
    def _load_calibration(head_dir: Path) -> Optional[dict]:
        """Look for <head_dir>/calibration.json first, then the legacy global file."""
        candidates = [
            head_dir / "calibration.json",
            Path("models") / "lofcz_calibration.json",
        ]
        for path in candidates:
            if not path.exists():
                continue
            try:
                with path.open("r") as fh:
                    payload = json.load(fh)
                method = payload.get("method")
                if method == "sigmoid" and {"A", "B"} <= payload.keys():
                    return {
                        "method": "sigmoid",
                        "A": float(payload["A"]),
                        "B": float(payload["B"]),
                    }
                if method == "isotonic" and {"x", "y"} <= payload.keys():
                    xs = np.asarray(payload["x"], dtype=np.float64)
                    ys = np.asarray(payload["y"], dtype=np.float64)
                    if xs.size >= 2 and xs.size == ys.size:
                        order = np.argsort(xs)
                        return {
                            "method": "isotonic",
                            "x": xs[order],
                            "y": ys[order],
                        }
                    logger.warning("lofcz calibration %s: malformed isotonic table.", path)
                else:
                    logger.warning("lofcz calibration %s: unknown/incomplete payload.", path)
            except Exception as exc:  # noqa: BLE001
                logger.warning("lofcz calibration load %s failed: %s", path, exc)
        return None

    @staticmethod
    def _apply_calibration_static(calibration: Optional[dict], raw: float) -> float:
        """Map a raw ONNX probability to the calibrated probability for a given head."""
        if calibration is None:
            return float(raw)
        method = calibration["method"]
        if method == "sigmoid":
            A = calibration["A"]
            B = calibration["B"]
            # Clamp the linear term to avoid numpy overflow warnings on
            # extreme raws; sigmoid saturates well before we hit those.
            z = float(np.clip(A * raw + B, -50.0, 50.0))
            return float(1.0 / (1.0 + np.exp(z)))
        if method == "isotonic":
            xs = calibration["x"]
            ys = calibration["y"]
            return float(np.clip(np.interp(float(raw), xs, ys), 0.0, 1.0))
        return float(raw)

    def _apply_calibration(self, raw: float) -> float:
        """Backward-compatible wrapper: applies the *first* head's calibration."""
        return self._apply_calibration_static(self._calibration, raw)

    # ------------------------------------------------------------- audio path

    def _load_audio(self, audio_path: str) -> np.ndarray:
        """Load audio, resample to 16kHz. Uses soundfile with librosa fallback."""
        try:
            import soundfile as sf
            audio_np, sr = sf.read(audio_path, dtype="float32")
        except Exception:
            import librosa
            audio_np, sr = librosa.load(audio_path, sr=None, mono=False)
            audio_np = audio_np.T if audio_np.ndim > 1 else audio_np

        if audio_np.ndim == 1:
            audio_np = audio_np[:, None]

        if sr != self.sr:
            audio_np = soxr.resample(audio_np, sr, self.sr)

        max_samples = self.sr * self.max_duration_seconds
        audio_np = audio_np[:max_samples]

        if audio_np.shape[0] < self.n_fft:
            audio_np = np.pad(
                audio_np,
                ((0, self.n_fft - audio_np.shape[0]), (0, 0)),
                mode="constant",
            )

        return audio_np.astype(np.float32, copy=False)

    def _lower_hull(self, values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """
        Upstream lower hull: collect minima from each sliding window, then
        interpolate those control points. This is not morphological erosion.
        """
        idx = []
        hull = []

        for i in range(len(values) - self.hull_area + 1):
            patch = values[i : i + self.hull_area]
            rel_idx = int(np.argmin(patch))
            abs_idx = rel_idx + i
            if abs_idx not in idx:
                idx.append(abs_idx)
                hull.append(float(patch[rel_idx]))

        if not idx:
            return (
                np.array([0, len(values) - 1], dtype=np.int64),
                np.array([values[0], values[-1]], dtype=np.float64),
            )

        if idx[0] != 0:
            idx.insert(0, 0)
            hull.insert(0, float(values[0]))

        if idx[-1] != len(values) - 1:
            idx.append(len(values) - 1)
            hull.append(float(values[-1]))

        return np.array(idx, dtype=np.int64), np.array(hull, dtype=np.float64)

    def _compute_fakeprint(self, y: np.ndarray) -> np.ndarray:
        """
        Extract the 3585-feature spectral fakeprint vector.

        Process:
        1. Compute torchaudio power spectrogram
        2. Convert every power bin to dB
        3. Average dB over channels and time
        4. Isolate the 1-8 kHz band
        5. Subtract the interpolated lower hull
        6. Clip residue to 0-5 dB and max-normalize
        """
        with torch.no_grad():
            stft = self.stft_transformer(torch.Tensor(y.T)).numpy()

        stft_db = 10.0 * np.log10(np.clip(stft, 1e-10, 1e6))
        avg_power_db = np.mean(stft_db, axis=(0, 2))

        freqs = np.linspace(0.0, self.sr / 2.0, num=len(avg_power_db))

        # The lofcz model declares 3585 inputs; with 8192 FFT at 16 kHz that
        # corresponds exactly to inclusive 1000 Hz and 8000 Hz boundary bins.
        mask = (freqs >= self.freq_min) & (freqs <= self.freq_max)
        band_freqs = freqs[mask]
        band_db = avg_power_db[mask]

        hull_idx, hull_vals = self._lower_hull(band_db)
        interp_kind = "quadratic" if hull_idx.size >= 3 else "linear"
        lower_hull_curve = interpolate.interp1d(
            band_freqs[hull_idx],
            hull_vals,
            kind=interp_kind,
        )(band_freqs)
        lower_hull_curve = np.clip(lower_hull_curve, self.min_db, None)

        residue = np.clip(band_db - lower_hull_curve, 0.0, None)
        residue = np.clip(residue, 0.0, self.max_db)
        residue = residue / (1e-6 + np.max(residue))

        # Ensure correct feature count
        if len(residue) < self.n_features:
            residue = np.pad(residue, (0, self.n_features - len(residue)))
        elif len(residue) > self.n_features:
            residue = residue[:self.n_features]

        return residue.astype(np.float32)

    # ------------------------------------------------------------ aggregation

    # Augmented head names used by the v4-pin promotion override
    # (soft-vote mode only). Production loads ``lofcz_v4`` directly;
    # ``lofcz_v2`` remains accepted only for older branch compatibility.
    _AUGMENTED_HEAD_NAMES = ("lofcz_v4", "lofcz_v2")
    _V4_TRIGGER_AI = 0.50          # v4 must be > this
    _LEGACY_TRIGGER_HUMAN = 0.20   # every other head must be < this

    def _aggregate(
        self,
        probs: List[float],
        head_calibrated: Dict[str, float],
    ) -> float:
        """Dispatch to the configured aggregator mode (Patent Claim 4).

        Returns the aggregated AI probability in [0, 1] before final
        clipping in ``analyze()``. Five modes are supported:

        * ``soft_vote``: confidence-weighted soft vote with v4-pin override
        * ``max``: maximum across heads
        * ``mean``: arithmetic mean across heads
        * ``top_k_mean``: mean of the top-k probabilities (k =
          ``ceil(n_heads / 2)`` by default)
        * ``max_with_std_penalty``: ``max(probs) − alpha × std(probs)``

        The v4-pin promotion override is intentionally restricted to
        ``soft_vote`` so the other modes apply their pure mathematical
        reduction without surprise overrides.
        """
        # ``getattr`` fallback keeps thin-detector test fixtures working when
        # they bypass ``__init__`` via ``__new__`` (existing batch-2 tests).
        mode = getattr(self, "aggregator_mode", "soft_vote")
        if mode == "soft_vote":
            return self._aggregate_soft_vote(probs, head_calibrated)
        if mode == "max":
            return float(np.max(np.asarray(probs, dtype=np.float64)))
        if mode == "mean":
            return float(np.mean(np.asarray(probs, dtype=np.float64)))
        if mode == "top_k_mean":
            return self._aggregate_top_k_mean(probs)
        if mode == "max_with_std_penalty":
            return self._aggregate_max_with_std_penalty(probs)
        # Unreachable: __init__ rejected unknown modes.
        raise ValueError(f"Unknown aggregator_mode: {mode!r}")

    def _aggregate_soft_vote(
        self,
        probs: List[float],
        head_calibrated: Dict[str, float],
    ) -> float:
        """Confidence-weighted soft vote with v4-augmented-pin promotion.

        Default rule: each calibrated probability ``p_i`` is weighted by
        ``|p_i − 0.5|``, so confidently-human cancels confidently-AI on
        genuine disagreement while a single confident head dominates an
        indifferent one. With the 4-head MoE, soft-vote on un-attacked AI
        is dominated by ``v3_legacy`` (high-recall baseline ~98%).

        v4-augmented-pin promotion: an augmented v4 head was trained with
        pitch +/-1/+2/-2, stretch +/-5%, reverb+medium augmentations. On
        adversarial-transformed AI, the un-augmented heads collapse to
        ~0 because the lofcz fakeprint vector shifts under those
        operations. Confidence-weighted soft vote drowns v4. We promote
        v4 directly when (a) v4 score > 0.50 and (b) every other head <
        0.20, which means v3_legacy must agree with the others that this
        looks human, a much stronger signal than the 2-legacy-head
        version. When all heads are exactly 0.5 (no signal), we fall
        back to 0.5.
        """
        weights = np.array([abs(p - 0.5) for p in probs], dtype=np.float64)
        if float(weights.sum()) > 1e-9:
            aggregated = float(
                np.sum(np.array(probs, dtype=np.float64) * weights)
                / float(weights.sum())
            )
        else:
            aggregated = float(np.mean(probs))

        # v4-augmented-pinned promotion (overrides soft-vote when the
        # strict trigger fires). The augmented head is identified by name.
        aug_head = None
        for name in self._AUGMENTED_HEAD_NAMES:
            if name in head_calibrated:
                aug_head = name
                break
        if (
            aug_head is not None
            and len(head_calibrated) >= 2
            and head_calibrated[aug_head] > self._V4_TRIGGER_AI
        ):
            legacy_scores = [
                v for k, v in head_calibrated.items() if k != aug_head
            ]
            if all(p < self._LEGACY_TRIGGER_HUMAN for p in legacy_scores):
                aggregated = float(head_calibrated[aug_head])
        return aggregated

    def _aggregate_top_k_mean(self, probs: List[float]) -> float:
        """Mean of the top-k probabilities. Default k = ceil(n_heads / 2)."""
        n = len(probs)
        top_k = getattr(self, "top_k", None)
        if top_k is None:
            k = max(1, math.ceil(n / 2))
        else:
            k = max(1, min(int(top_k), n))
        sorted_desc = np.sort(np.asarray(probs, dtype=np.float64))[::-1]
        return float(np.mean(sorted_desc[:k]))

    def _aggregate_max_with_std_penalty(self, probs: List[float]) -> float:
        """``max(probs) - alpha * std(probs)`` with configurable alpha.

        Single-head input collapses to the head's score (std == 0).
        """
        arr = np.asarray(probs, dtype=np.float64)
        alpha = float(getattr(self, "std_penalty_alpha", 0.5))
        return float(np.max(arr) - alpha * np.std(arr))

    # ------------------------------------------------------------- inference

    @staticmethod
    def _run_onnx(session: "ort.InferenceSession", fakeprint_input: np.ndarray) -> float:
        """Run a single ONNX session on the (already-batched) fakeprint.

        Handles two ONNX export shapes:
        * sklearn-style: ``outputs == [labels, probabilities]`` where the
          probability tensor has shape ``(1, 2)`` ``[real, ai]``.
        * single-tensor: ``outputs == [probabilities]`` with shape ``(1, 2)``,
          ``(1, 1)``, or ``(1,)``.
        We pick whichever output is float and 2-D — that's the probability
        matrix in both export styles.
        """
        input_name = session.get_inputs()[0].name
        outputs = session.run(None, {input_name: fakeprint_input})

        # Pick the float, 2-D probability tensor (skips the int64 label output
        # that sklearn-exported ONNX models emit as outputs[0]).
        result = None
        for o in outputs:
            if np.issubdtype(o.dtype, np.floating) and o.ndim == 2:
                result = o
                break
        if result is None:
            result = outputs[0]

        if result.ndim == 2 and result.shape[-1] == 2:
            ai_prob = float(result[0, 1])  # [real_prob, ai_prob]
        elif result.ndim == 2 and result.shape[-1] == 1:
            ai_prob = float(result[0, 0])  # single-output sigmoid
        elif result.ndim == 1:
            ai_prob = float(result[0])
        else:
            ai_prob = float(np.asarray(result).flatten()[-1])
        return float(np.clip(ai_prob, 0.0, 1.0))

    def analyze(self, audio_path: str) -> LofczResult:
        """Analyze audio file using lofcz pretrained model.

        Returns a :class:`LofczResult` whose ``score`` is the calibrated AI
        probability (or, in multi-head mode, the confidence-weighted soft vote
        across heads). ``raw_score`` always carries the uncalibrated value of
        the FIRST head for debugging and downstream rollback.
        """

        if not self.model_loaded or not self._heads:
            return LofczResult(
                score=0.5,
                confidence=0.0,
                model_loaded=False,
                raw_score=0.5,
                head_scores={},
                head_count=0,
            )

        try:
            # Load + featurize ONCE for all heads (the slow part).
            y = self._load_audio(audio_path)
            fakeprint = self._compute_fakeprint(y)
            fakeprint_energy = float(np.mean(np.abs(fakeprint)))
            fakeprint_input = fakeprint.reshape(1, -1)

            # Run every head on the same fakeprint vector.
            head_raw: Dict[str, float] = {}
            head_calibrated: Dict[str, float] = {}
            for head in self._heads:
                raw = self._run_onnx(head.ort_session, fakeprint_input)
                cal = float(np.clip(
                    self._apply_calibration_static(head.calibration, raw),
                    0.0, 1.0,
                ))
                head_raw[head.name] = raw
                head_calibrated[head.name] = cal

            # ---- Aggregation: operator-configurable mode (Patent Claim 4) --
            # Five modes are dispatched here. The "soft_vote" path is the
            # production default and preserves byte-identical behaviour with
            # the v4-augmented-pinned promotion override. The other four
            # modes apply their pure mathematical reduction without overrides.
            probs = list(head_calibrated.values())
            if probs:
                aggregated = self._aggregate(probs, head_calibrated)
            else:
                aggregated = 0.5
            aggregated = float(np.clip(aggregated, 0.0, 1.0))

            # Mean per-head confidence, scaled to [0, 1]. With a single head
            # this collapses to ``|p - 0.5| * 2``, matching the legacy formula.
            # (After the max-aggregation switch the old `weights` array was
            # removed; recompute |p − 0.5| inline so we stay self-contained.)
            head_confidences = [abs(p - 0.5) for p in probs]
            mean_conf = (sum(head_confidences) / len(head_confidences)) * 2 if head_confidences else 0.0
            mean_conf = float(np.clip(mean_conf, 0.0, 1.0))

            # raw_score keeps the FIRST head's raw probability for parity
            # with pre-MoE callers / debug dashboards.
            first_head_name = self._heads[0].name
            first_raw = head_raw[first_head_name]

            return LofczResult(
                score=aggregated,
                confidence=mean_conf,
                model_loaded=True,
                fakeprint_energy=fakeprint_energy,
                raw_score=first_raw,
                head_scores=head_calibrated,
                head_count=len(self._heads),
            )

        except Exception as exc:
            logger.warning("lofcz analysis failed: %s", exc)
            return LofczResult(
                score=0.5,
                confidence=0.0,
                model_loaded=True,
                raw_score=0.5,
                head_scores={},
                head_count=0,
            )
