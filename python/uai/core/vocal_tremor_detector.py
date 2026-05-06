"""Vocal micro-tremor detector for the six-head MoE consensus.

The detector measures short-rate F0 wobble in the 4-10 Hz band. Human
vocal takes usually show small, irregular pitch micro-motion; generated
vocals often stay too smooth or express a mechanically regular vibrato.
"""

from __future__ import annotations

import logging
import shutil
import tempfile
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

import numpy as np
from scipy import signal

try:
    import librosa
    LIBROSA_AVAILABLE = True
except Exception:  # pragma: no cover - dependency-gated fallback
    LIBROSA_AVAILABLE = False


logger = logging.getLogger(__name__)


@dataclass
class VocalTremorResult:
    """Result from vocal F0 micro-tremor analysis."""

    score: float
    confidence: float
    features: Dict[str, float] = field(default_factory=dict)
    model_loaded: bool = True
    anomalies: list[str] = field(default_factory=list)

    def __getitem__(self, key: str) -> Any:
        return getattr(self, key)

    def get(self, key: str, default: Any = None) -> Any:
        return getattr(self, key, default)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "score": self.score,
            "confidence": self.confidence,
            "features": dict(self.features),
            "model_loaded": self.model_loaded,
            "anomalies": list(self.anomalies),
        }


class VocalTremorDetector:
    """Detect synthetic vocal smoothness or over-regular vibrato."""

    def __init__(
        self,
        device: str = "cpu",
        frame_rate_hz: float = 100.0,
        max_duration_sec: float = 45.0,
        fmin_hz: float = 200.0,
        fmax_hz: float = 800.0,
    ) -> None:
        self.device = str(device or "cpu").strip().lower()
        self.frame_rate_hz = float(frame_rate_hz)
        self.max_duration_sec = float(max_duration_sec)
        self.fmin_hz = float(fmin_hz)
        self.fmax_hz = float(fmax_hz)
        self.model_loaded = bool(LIBROSA_AVAILABLE)

    def reset_per_track_state(self) -> None:
        """Compatibility hook for long-running batch workers."""
        return None

    def analyze(
        self,
        audio: Any,
        sr: Optional[int] = None,
        *,
        audio_path: Optional[str] = None,
        vocals_path: Optional[str] = None,
        try_demucs: bool = False,
    ) -> VocalTremorResult:
        """Analyze an audio array or path and return an AI-likelihood score.

        Parameters
        ----------
        audio:
            Either an in-memory waveform or a path. Stereo arrays may be
            channel-first or channel-last.
        sr:
            Sample rate for in-memory arrays.
        audio_path / vocals_path:
            Optional paths used by the engine. ``vocals_path`` wins when
            supplied. ``try_demucs`` keeps the Demucs path explicit so Mac CPU
            validation can use the cheap harmonic fallback without spawning a
            separator.
        """
        if not self.model_loaded:
            return self._neutral("librosa unavailable", model_loaded=False)

        try:
            y, used_sr, source = self._resolve_vocal_signal(
                audio,
                sr,
                audio_path=audio_path,
                vocals_path=vocals_path,
                try_demucs=try_demucs,
            )
        except Exception as exc:
            logger.warning("vocal tremor: vocal extraction failed: %s", exc)
            return self._neutral("vocal extraction failed")

        if y is None or y.size == 0 or used_sr <= 0:
            return self._neutral("no usable vocal signal")

        y = np.asarray(y, dtype=np.float32)
        max_samples = int(max(1.0, self.max_duration_sec) * used_sr)
        if y.size > max_samples:
            y = y[:max_samples]

        y = self._normalize(y)
        if y.size < int(0.75 * used_sr) or float(np.sqrt(np.mean(y * y))) < 1e-5:
            return self._neutral("insufficient voiced energy")

        try:
            f0 = self._track_pitch(y, used_sr)
        except Exception as exc:
            logger.debug("vocal tremor: pYIN failed: %s", exc)
            return self._neutral("pitch tracking failed")

        valid = np.isfinite(f0) & (f0 > 0)
        voiced_fraction = float(np.mean(valid)) if f0.size else 0.0
        if f0.size < 20 or np.sum(valid) < 20 or voiced_fraction < 0.20:
            return self._neutral("too few voiced frames")

        f0_interp = self._interpolate_f0(f0, valid)
        features = self._tremor_features(f0_interp, voiced_fraction)
        features["source"] = 1.0 if source == "vocals" else 0.0

        score = self._score_from_features(features)
        confidence = self._confidence_from_features(features)
        return VocalTremorResult(
            score=float(np.clip(score, 0.0, 1.0)),
            confidence=float(np.clip(confidence, 0.0, 1.0)),
            features=features,
            model_loaded=True,
        )

    def _resolve_vocal_signal(
        self,
        audio: Any,
        sr: Optional[int],
        *,
        audio_path: Optional[str],
        vocals_path: Optional[str],
        try_demucs: bool,
    ) -> tuple[np.ndarray, int, str]:
        if vocals_path:
            y, loaded_sr = librosa.load(vocals_path, sr=22050, mono=True)
            return self._fallback_vocal_approx(y, loaded_sr), int(loaded_sr), "vocals"

        path = audio_path if audio_path else (audio if isinstance(audio, str) else None)
        if path and try_demucs:
            demucs = self._try_demucs_vocals(str(path))
            if demucs is not None:
                return demucs[0], demucs[1], "vocals"

        if isinstance(audio, str):
            y, loaded_sr = librosa.load(audio, sr=22050, mono=True)
            return self._fallback_vocal_approx(y, loaded_sr), int(loaded_sr), "fallback"

        if sr is None:
            raise ValueError("sr is required when audio is an array")
        mono = self._to_mono(np.asarray(audio))
        return self._fallback_vocal_approx(mono, int(sr)), int(sr), "fallback"

    def _try_demucs_vocals(self, audio_path: str) -> Optional[tuple[np.ndarray, int]]:
        tmp = tempfile.mkdtemp(prefix="uai_vocal_tremor_demucs_")
        try:
            from .stem_backends.demucs import DemucsBackend

            backend = DemucsBackend(device=self.device, timeout=180)
            stems = backend.separate(audio_path, tmp)
            vocals = stems.get("vocals")
            if not vocals:
                return None
            y, sr = librosa.load(vocals, sr=22050, mono=True)
            return self._fallback_vocal_approx(y, int(sr)), int(sr)
        except Exception as exc:
            logger.debug("vocal tremor: Demucs unavailable, using fallback: %s", exc)
            return None
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    @staticmethod
    def _to_mono(audio: np.ndarray) -> np.ndarray:
        arr = np.asarray(audio, dtype=np.float32)
        if arr.ndim == 1:
            return arr
        if arr.ndim != 2:
            return np.ravel(arr).astype(np.float32)
        if arr.shape[0] <= 8 and arr.shape[0] < arr.shape[1]:
            return np.mean(arr, axis=0, dtype=np.float32)
        if arr.shape[1] <= 8:
            return np.mean(arr, axis=1, dtype=np.float32)
        return np.mean(arr, axis=0, dtype=np.float32)

    def _fallback_vocal_approx(self, y: np.ndarray, sr: int) -> np.ndarray:
        mono = self._to_mono(y)
        try:
            harmonic = librosa.effects.harmonic(mono)
        except Exception:
            harmonic = mono
        return self._bandpass(harmonic, sr, self.fmin_hz, self.fmax_hz).astype(np.float32)

    @staticmethod
    def _normalize(y: np.ndarray) -> np.ndarray:
        y = np.asarray(y, dtype=np.float32)
        y = y - float(np.mean(y))
        peak = float(np.max(np.abs(y))) if y.size else 0.0
        if peak > 0:
            y = y / peak
        return y.astype(np.float32, copy=False)

    @staticmethod
    def _bandpass(y: np.ndarray, sr: int, low_hz: float, high_hz: float) -> np.ndarray:
        nyquist = sr * 0.5
        low = max(0.1, min(float(low_hz), nyquist * 0.90))
        high = max(low * 1.1, min(float(high_hz), nyquist * 0.98))
        if high <= low:
            return np.asarray(y, dtype=np.float32)
        sos = signal.butter(4, [low / nyquist, high / nyquist], btype="bandpass", output="sos")
        if y.size > 128:
            return signal.sosfiltfilt(sos, y).astype(np.float32)
        return signal.sosfilt(sos, y).astype(np.float32)

    def _track_pitch(self, y: np.ndarray, sr: int) -> np.ndarray:
        hop_length = max(1, int(round(sr / self.frame_rate_hz)))
        f0, _, _ = librosa.pyin(
            y,
            fmin=self.fmin_hz,
            fmax=min(self.fmax_hz, sr * 0.45),
            sr=sr,
            frame_length=2048,
            hop_length=hop_length,
        )
        return np.asarray(f0, dtype=np.float64)

    @staticmethod
    def _interpolate_f0(f0: np.ndarray, valid: np.ndarray) -> np.ndarray:
        idx = np.arange(f0.size, dtype=np.float64)
        return np.interp(idx, idx[valid], f0[valid]).astype(np.float64)

    def _tremor_features(self, f0: np.ndarray, voiced_fraction: float) -> Dict[str, float]:
        median_f0 = float(np.median(f0))
        centered = f0 - median_f0
        tremor = self._bandpass(centered, int(round(self.frame_rate_hz)), 4.0, 10.0)
        tremor_rms = float(np.sqrt(np.mean(tremor.astype(np.float64) ** 2)))
        tremor_pct = tremor_rms / max(median_f0, 1e-6)
        regularity = self._autocorr_regularity(tremor)
        spectral_entropy = self._tremor_entropy(tremor)
        contour_smoothness = float(np.clip(1.0 - (np.std(np.diff(f0)) / max(median_f0 * 0.01, 1e-6)), 0.0, 1.0))
        return {
            "median_f0_hz": median_f0,
            "voiced_fraction": float(voiced_fraction),
            "tremor_rms_hz": tremor_rms,
            "tremor_pct": float(tremor_pct),
            "tremor_regularity": float(regularity),
            "tremor_entropy": float(spectral_entropy),
            "contour_smoothness": contour_smoothness,
        }

    def _autocorr_regularity(self, tremor: np.ndarray) -> float:
        x = np.asarray(tremor, dtype=np.float64)
        x = x - float(np.mean(x))
        denom = float(np.dot(x, x))
        if denom <= 1e-12:
            return 0.0
        ac = np.correlate(x, x, mode="full")[x.size - 1:] / denom
        min_lag = max(1, int(round(self.frame_rate_hz / 10.0)))
        max_lag = min(ac.size - 1, int(round(self.frame_rate_hz / 4.0)))
        if max_lag <= min_lag:
            return 0.0
        return float(np.clip(np.max(ac[min_lag:max_lag + 1]), 0.0, 1.0))

    def _tremor_entropy(self, tremor: np.ndarray) -> float:
        x = np.asarray(tremor, dtype=np.float64)
        if x.size < 8:
            return 0.0
        freqs, power = signal.welch(x, fs=self.frame_rate_hz, nperseg=min(256, x.size))
        mask = (freqs >= 4.0) & (freqs <= 10.0)
        band = np.asarray(power[mask], dtype=np.float64)
        total = float(np.sum(band))
        if total <= 1e-12 or band.size < 2:
            return 0.0
        p = band / total
        entropy = -float(np.sum(p * np.log2(p + 1e-12))) / float(np.log2(band.size))
        return float(np.clip(entropy, 0.0, 1.0))

    @staticmethod
    def _score_from_features(features: Dict[str, float]) -> float:
        tremor_pct = float(features.get("tremor_pct", 0.0))
        regularity = float(features.get("tremor_regularity", 0.0))
        entropy = float(features.get("tremor_entropy", 0.0))
        smoothness = float(features.get("contour_smoothness", 0.0))

        low_tremor_ai = float(np.clip((0.005 - tremor_pct) / 0.003, 0.0, 1.0))
        excessive_tremor_ai = float(np.clip((tremor_pct - 0.030) / 0.020, 0.0, 1.0))
        regular_ai = float(np.clip((regularity - 0.76) / 0.18, 0.0, 1.0))
        low_entropy_ai = float(np.clip((0.45 - entropy) / 0.35, 0.0, 1.0))
        smooth_ai = float(np.clip((smoothness - 0.85) / 0.15, 0.0, 1.0))

        return float(np.clip(
            0.62 * low_tremor_ai
            + 0.25 * max(regular_ai, low_entropy_ai * regular_ai)
            + 0.08 * smooth_ai
            + 0.20 * excessive_tremor_ai,
            0.0,
            1.0,
        ))

    @staticmethod
    def _confidence_from_features(features: Dict[str, float]) -> float:
        voiced = float(features.get("voiced_fraction", 0.0))
        tremor_pct = float(features.get("tremor_pct", 0.0))
        decisive = max(
            abs(tremor_pct - 0.012) / 0.018,
            abs(float(features.get("tremor_regularity", 0.5)) - 0.65),
        )
        return float(np.clip(0.20 + 0.55 * voiced + 0.25 * decisive, 0.1, 0.95))

    @staticmethod
    def _neutral(reason: str, model_loaded: bool = True) -> VocalTremorResult:
        return VocalTremorResult(
            score=0.5,
            confidence=0.1,
            features={"reason": 0.0},
            model_loaded=model_loaded,
            anomalies=[reason],
        )
