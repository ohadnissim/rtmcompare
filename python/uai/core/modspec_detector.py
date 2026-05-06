"""
Modulation-spectrum (modspec) detector: reverb-aware AI-music head.

Why this exists
---------------
The lofcz fakeprint feature lives in the frequency-domain hull (1-8 kHz
spectral envelope). It captures vocoder-style smearing, but reverb tails
also smear the spectral hull and are mis-attributed as human-like.
Empirical ceiling on the v4 head, even after adversarial reverb
augmentation, is ~4% recall on reverberated-AI clips
(`evaluation/results/lofcz_v4_retrain/adversarial_retest_summary.json`,
`Reverb_medium = 0.04`).

Reverb has a structural signature in a different domain: the modulation
spectrum of the per-band envelope. A clean source has fast envelope
modulation (transient onsets in the 4-20 Hz range); a heavily
reverberated source has slow envelope decay (concentrated 0.5-4 Hz
energy, with smooth exponential roll-off at higher modulation rates).
This is what the speech-quality literature calls the "modulation transfer
function" of a room (Houtgast/Steeneken 1985).

We don't claim the modspec separates AI from human in isolation; it does
not. It adds a complementary signal that fires specifically on
reverberated audio (AI or human). Combined with lofcz it disambiguates
"spectral hull is smeared because it's reverberated" vs. "spectral hull
is smeared because it's a vocoder artefact". The fusion gain shows up on
reverberated-AI: lofcz_v4 flips human-leaning when reverb is added, but
lofcz + modspec stay AI.

Feature layout (44 dims)
------------------------
For audio resampled to 16 kHz mono, we:

1. Compute a 64-mel STFT (n_fft=1024, hop=256) -> mel-power matrix.
2. Group mel bands into **8 sub-bands** roughly logarithmic in centre frequency
   (octave bands from ~80 Hz to ~7 kHz) and average within each.
3. For each sub-band, take the time-axis power envelope, log-compress, and
   FFT. The modulation rate axis spans 0..62.5 Hz (Nyquist of the 125 Hz
   envelope sampling implied by hop=256). We focus on **0.5..20 Hz**, the
   range where reverb decay periodicity lives.
4. Bin the 0.5..20 Hz band into **5 modulation-rate bands**:
       0.5-2 Hz   (room rumble / late tail)
       2-4 Hz     (early decay)
       4-8 Hz     (envelope onsets, transient density)
       8-12 Hz    (rapid amplitude modulation, tremolo)
       12-20 Hz   (very rapid mod / roughness)
5. For each (sub-band x modulation-band) cell, compute log-mean energy.
   That gives 8 x 5 = 40 features.
6. Append 4 cross-band summaries:
       a) total low/high modulation-energy ratio (sum of bands 0-1 / 2-4),
       b) decay slope: log-energy regression slope over modulation freq axis,
       c) per-band energy std (frequency-axis flatness),
       d) early-vs-late envelope ratio (mean(0.5-4 Hz) / mean(8-20 Hz)).
   That gives 4 cross-band summaries -> total 44 dims.

The classifier is a small logistic regression (sklearn -> ONNX). Default
weights ship at `models/modspec/` and are loaded lazily; if the model dir
doesn't exist, `analyze()` returns `model_loaded=False` and the engine treats
the detector as inactive (weight=0). That keeps the detector *opt-in* and
non-regressing until trained.

Trainer pipeline
----------------
See `scripts/train_modspec.py` for the corpus build + LR fit. We train on:

  * AI corpus (suno + lyria + ElevenLabs)             label=1
  * AI corpus *with* synthetic reverb applied         label=1
  * Human corpus (FMA-medium random sample)           label=0
  * Human corpus *with* synthetic reverb applied      label=0

The dual-augmented training is the key trick: it teaches the head "reverb
adds a distinctive modspec signature, but does NOT change the AI vs human
verdict". Without the reverberated-human samples the head trivially fits
"reverb -> AI" and would crater the human-FPR.

Inference time
--------------
~150 ms per 90s clip on a single CPU core (mel-spectrogram + 8 small FFTs +
44-dim ONNX matmul). Negligible compared to lofcz.
"""
from __future__ import annotations

import json
import logging
import os
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

import numpy as np

from ._runtime import get_onnx_providers

try:
    import librosa
    LIBROSA_AVAILABLE = True
except Exception:  # pragma: no cover
    LIBROSA_AVAILABLE = False

try:
    import onnxruntime as ort
    ONNX_AVAILABLE = True
except Exception:  # pragma: no cover
    ONNX_AVAILABLE = False


logger = logging.getLogger(__name__)

# 8 octave-spaced sub-bands over a 64-mel basis (16 kHz audio, fmin=80, fmax=7500).
# Each tuple is (mel_lo_idx_inclusive, mel_hi_idx_exclusive). Total covers all 64 mel bins.
SUBBAND_BINS: List[tuple] = [
    (0, 8),    # ~80-160 Hz
    (8, 16),   # ~160-320 Hz
    (16, 24),  # ~320-640 Hz
    (24, 32),  # ~640-1280 Hz
    (32, 40),  # ~1280-2300 Hz
    (40, 48),  # ~2300-3700 Hz
    (48, 56),  # ~3700-5300 Hz
    (56, 64),  # ~5300-7500 Hz
]

# 5 modulation-rate bands (Hz)
MOD_BANDS_HZ: List[tuple] = [
    (0.5, 2.0),
    (2.0, 4.0),
    (4.0, 8.0),
    (8.0, 12.0),
    (12.0, 20.0),
]

N_FEATURES = len(SUBBAND_BINS) * len(MOD_BANDS_HZ) + 4  # 8*5 + 4 = 44


@dataclass
class ModspecResult:
    score: float                # 0=human, 1=AI
    confidence: float
    model_loaded: bool
    raw_score: float = 0.5
    feature_vector: Optional[np.ndarray] = None
    mod_low_high_ratio: float = 0.0
    decay_slope: float = 0.0
    early_late_ratio: float = 0.0
    notes: Optional[List[str]] = None


def _load_audio_mono_16k(path: str, max_seconds: float = 90.0) -> Optional[np.ndarray]:
    """Load audio as mono float32 at 16 kHz, capped at `max_seconds`."""
    if not LIBROSA_AVAILABLE:
        return None
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            y, _ = librosa.load(
                path, sr=16000, mono=True,
                duration=max_seconds if max_seconds > 0 else None,
            )
        if y is None or y.size == 0:
            return None
        return y.astype(np.float32, copy=False)
    except Exception as exc:
        logger.warning("modspec: failed to load %s: %s", path, exc)
        return None


def compute_modspec_features(y: np.ndarray, sr: int = 16000) -> np.ndarray:
    """Compute the 44-dim modulation-spectrum feature vector.

    Returns float32 vector of shape (N_FEATURES,). On any failure or empty
    input returns zeros (so callers can detect a no-signal case via
    `np.linalg.norm(v) < 1e-8`).

    This function is exported for the trainer + tests; the detector class
    just wraps it.
    """
    if y is None or y.size < sr:
        return np.zeros(N_FEATURES, dtype=np.float32)

    try:
        n_fft = 1024
        hop_length = 256
        # 64 mel bands, 80-7500 Hz over 16 kHz audio -> covers the meaningful
        # spectral envelope range. We use power=2.0 mels since envelope energy
        # is what reverb modulates.
        mel = librosa.feature.melspectrogram(
            y=y, sr=sr, n_fft=n_fft, hop_length=hop_length,
            n_mels=64, fmin=80.0, fmax=7500.0, power=2.0,
        )  # shape (64, T)
        log_mel = np.log1p(mel + 1e-10).astype(np.float32)
    except Exception as exc:
        logger.warning("modspec: melspectrogram failed: %s", exc)
        return np.zeros(N_FEATURES, dtype=np.float32)

    if log_mel.shape[1] < 32:
        return np.zeros(N_FEATURES, dtype=np.float32)

    # Envelope sampling rate (frames per second)
    env_sr = sr / hop_length  # = 62.5 Hz for sr=16k, hop=256
    # Per-frame envelope power per sub-band
    # Build (n_subbands, T) matrix.
    n_sub = len(SUBBAND_BINS)
    sb_env = np.empty((n_sub, log_mel.shape[1]), dtype=np.float32)
    for i, (lo, hi) in enumerate(SUBBAND_BINS):
        sb_env[i] = log_mel[lo:hi].mean(axis=0)

    # Detrend per sub-band so the FFT isn't dominated by DC (the per-band
    # average level). We subtract the mean envelope; we DON'T normalize amp
    # because absolute envelope-modulation energy is itself diagnostic
    # (heavily-reverberated tracks have larger absolute low-freq mod energy).
    sb_env_det = sb_env - sb_env.mean(axis=1, keepdims=True)

    # FFT along time axis.
    T = sb_env_det.shape[1]
    n_fft_mod = 1 << int(np.ceil(np.log2(max(T, 2))))  # next pow2
    spec = np.fft.rfft(sb_env_det, n=n_fft_mod, axis=1)
    mag = np.abs(spec).astype(np.float32)  # (n_sub, n_fft_mod//2 + 1)
    freqs = np.fft.rfftfreq(n_fft_mod, d=1.0 / env_sr)  # Hz

    # Per (sub-band x mod-band) log-mean magnitude.
    feats = np.zeros((n_sub, len(MOD_BANDS_HZ)), dtype=np.float32)
    for j, (f_lo, f_hi) in enumerate(MOD_BANDS_HZ):
        mask = (freqs >= f_lo) & (freqs < f_hi)
        if not mask.any():
            continue
        # log of mean energy in that mod band, per sub-band
        feats[:, j] = np.log(mag[:, mask].mean(axis=1) + 1e-10)

    flat = feats.reshape(-1).astype(np.float32)

    # Cross-band summaries
    # 1) low/high modulation-energy ratio: sum mod-bands 0-1 vs 2-4 (log-domain
    #    -> use mean and take exp of difference, but we keep it as a *delta*
    #    in log-domain which is a stable feature).
    low_mask = (freqs >= 0.5) & (freqs < 4.0)
    high_mask = (freqs >= 8.0) & (freqs < 20.0)
    if low_mask.any() and high_mask.any():
        mod_low = float(np.log(mag[:, low_mask].mean() + 1e-10))
        mod_high = float(np.log(mag[:, high_mask].mean() + 1e-10))
        low_high_ratio = mod_low - mod_high  # log-ratio
    else:
        low_high_ratio = 0.0

    # 2) decay slope: regression of log-energy vs log-freq over 0.5..20 Hz.
    #    Reverb -> steeper slope (more LF dominance).
    slope_mask = (freqs >= 0.5) & (freqs < 20.0)
    if slope_mask.sum() >= 3:
        f_slope = freqs[slope_mask]
        e_slope = np.log(mag[:, slope_mask].mean(axis=0) + 1e-10)
        # log-log regression
        x = np.log(f_slope + 1e-3)
        slope = float(np.polyfit(x, e_slope, 1)[0])
    else:
        slope = 0.0

    # 3) per-band energy std (frequency-axis flatness over sub-bands).
    band_energy = mag[:, slope_mask].mean(axis=1) if slope_mask.any() else np.ones(n_sub)
    flatness = float(np.log(band_energy + 1e-10).std())

    # 4) early-vs-late ratio: 0.5-4 Hz vs 8-20 Hz on the *summed* sub-band axis.
    early_mask = (freqs >= 0.5) & (freqs < 4.0)
    late_mask = (freqs >= 8.0) & (freqs < 20.0)
    early = float(np.log(mag.sum(axis=0)[early_mask].mean() + 1e-10)) if early_mask.any() else 0.0
    late = float(np.log(mag.sum(axis=0)[late_mask].mean() + 1e-10)) if late_mask.any() else 0.0
    early_late = early - late

    summaries = np.array(
        [low_high_ratio, slope, flatness, early_late], dtype=np.float32
    )

    out = np.concatenate([flat, summaries]).astype(np.float32)
    if out.shape[0] != N_FEATURES:
        # Defensive: should never happen given fixed band counts.
        return np.zeros(N_FEATURES, dtype=np.float32)
    return out


class ModspecDetector:
    """Detector that wraps the modspec feature + a trained LR head.

    Initialization is lazy and tolerant: missing model files do NOT raise;
    instead `analyze()` returns `model_loaded=False` and a neutral 0.5 score.
    The engine then assigns weight=0 (we gate on `result.model_loaded`).
    """

    def __init__(
        self,
        model_dir: Optional[str] = None,
        sr: int = 16000,
        max_seconds: float = 90.0,
        device: str = "cpu",
    ):
        self.sr = int(sr)
        self.max_seconds = float(max_seconds)
        self.device = str(device or "cpu").strip().lower()
        self._session: Optional["ort.InferenceSession"] = None
        self._weights: Optional[np.ndarray] = None
        self._bias: Optional[np.ndarray] = None
        self._calibration: Optional[dict] = None
        self.model_loaded = False
        self.input_name: Optional[str] = None
        self.feature_dim = N_FEATURES
        self.providers: List[str] = []

        if model_dir is None:
            here = Path(__file__).resolve().parent.parent
            model_dir = str(here / "models" / "modspec")
        self.model_dir = Path(model_dir)
        self._try_load()

    # ------------------------------------------------------------------ load
    def _try_load(self) -> None:
        if not self.model_dir.exists():
            logger.info("modspec: model dir not present (%s); detector inactive",
                        self.model_dir)
            return

        weights_path = self.model_dir / "weights.npz"
        onnx_path = self.model_dir / "modspec.onnx"
        cal_path = self.model_dir / "calibration.json"

        if not weights_path.exists() and not onnx_path.exists():
            logger.info("modspec: no weights at %s; detector inactive", self.model_dir)
            return

        try:
            if onnx_path.exists() and ONNX_AVAILABLE:
                providers = get_onnx_providers(self.device)
                self._session = ort.InferenceSession(
                    str(onnx_path), providers=providers
                )
                self.providers = list(self._session.get_providers())
                self.input_name = self._session.get_inputs()[0].name
                logger.info("modspec: loaded ONNX from %s", onnx_path)
            elif weights_path.exists():
                w = np.load(weights_path)
                self._weights = w["weights"].astype(np.float32)
                self._bias = w["bias"].astype(np.float32)
                logger.info(
                    "modspec: loaded numpy weights from %s (W=%s, b=%s)",
                    weights_path, self._weights.shape, self._bias.shape,
                )
            else:
                return

            if cal_path.exists():
                self._calibration = json.loads(cal_path.read_text())
            self.model_loaded = True
        except Exception as exc:
            logger.warning("modspec: load failed: %s", exc)
            self._session = None
            self._weights = None
            self.providers = []
            self.model_loaded = False

    # --------------------------------------------------------------- analyze
    def analyze(self, audio_path: str) -> ModspecResult:
        if not LIBROSA_AVAILABLE:
            return ModspecResult(
                score=0.5, confidence=0.0, model_loaded=False,
                notes=["librosa unavailable"],
            )

        if not self.model_loaded:
            return ModspecResult(
                score=0.5, confidence=0.0, model_loaded=False,
                notes=["modspec model not loaded"],
            )

        y = _load_audio_mono_16k(audio_path, max_seconds=self.max_seconds)
        if y is None:
            return ModspecResult(
                score=0.5, confidence=0.0, model_loaded=True,
                notes=["audio load failed"],
            )

        feats = compute_modspec_features(y, sr=self.sr)
        if not np.isfinite(feats).all() or float(np.linalg.norm(feats)) < 1e-8:
            return ModspecResult(
                score=0.5, confidence=0.0, model_loaded=True,
                feature_vector=feats,
                notes=["empty or non-finite feature vector"],
            )

        # Inference
        try:
            if self._session is not None:
                in_arr = feats.reshape(1, -1).astype(np.float32)
                outs = self._session.run(None, {self.input_name: in_arr})
                # Look for a probability output: skl2onnx with zipmap=False
                # returns [labels, probabilities]; keep last 2-D output.
                prob_arr = None
                for o in outs:
                    arr = np.asarray(o)
                    if arr.ndim == 2 and arr.shape[1] == 2:
                        prob_arr = arr
                        break
                if prob_arr is None:
                    # Fallback: take last array
                    prob_arr = np.asarray(outs[-1]).reshape(1, -1)
                raw = float(prob_arr[0, -1])
            else:
                # numpy fallback (LR weights & bias)
                logits = feats @ self._weights.reshape(-1, 1) + self._bias
                raw = float(1.0 / (1.0 + np.exp(-logits.item())))
        except Exception as exc:
            logger.warning("modspec: inference failed: %s", exc)
            return ModspecResult(
                score=0.5, confidence=0.0, model_loaded=True,
                feature_vector=feats,
                notes=[f"inference failed: {exc}"],
            )

        score = self._calibrate(raw)
        score = float(np.clip(score, 0.0, 1.0))
        confidence = float(min(1.0, abs(score - 0.5) * 2.0))

        # Extract a few diagnostics from the feature vector.
        # Layout: [40 cells (8 sub * 5 mod) | low_high_ratio | slope | flatness | early_late]
        low_high_ratio = float(feats[40])
        slope = float(feats[41])
        early_late = float(feats[43])

        return ModspecResult(
            score=score,
            confidence=confidence,
            model_loaded=True,
            raw_score=raw,
            feature_vector=feats,
            mod_low_high_ratio=low_high_ratio,
            decay_slope=slope,
            early_late_ratio=early_late,
            notes=None,
        )

    # ------------------------------------------------------------ calibration
    def _calibrate(self, raw: float) -> float:
        if not self._calibration:
            return raw
        method = self._calibration.get("method")
        if method == "sigmoid":
            A = float(self._calibration.get("A", 1.0))
            B = float(self._calibration.get("B", 0.0))
            x = float(np.clip(A * raw + B, -50.0, 50.0))
            return 1.0 / (1.0 + float(np.exp(x)))
        if method == "isotonic":
            xs = self._calibration.get("xs", [])
            ys = self._calibration.get("ys", [])
            if len(xs) >= 2 and len(ys) == len(xs):
                return float(np.interp(raw, xs, ys))
        return raw


__all__ = [
    "ModspecResult",
    "ModspecDetector",
    "compute_modspec_features",
    "N_FEATURES",
    "SUBBAND_BINS",
    "MOD_BANDS_HZ",
]
