"""Stereo-imaging realism detector for the six-head MoE consensus.

The detector compares physical stereo cues against a human-recording
reference profile: frequency-dependent interchannel coherence, mid/side
width, and phase scatter. Scores are AI-likelihood probabilities where
1.0 means synthetic or over-regular stereo imaging.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

import numpy as np

try:
    import librosa
    LIBROSA_AVAILABLE = True
except Exception:  # pragma: no cover - dependency-gated fallback
    LIBROSA_AVAILABLE = False


logger = logging.getLogger(__name__)


STEREO_BAND_CENTERS_HZ = (250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0)


@dataclass
class StereoRealismResult:
    """Result from stereo imaging realism analysis."""

    score: float
    confidence: float
    features: Dict[str, float] = field(default_factory=dict)
    model_loaded: bool = True
    stereo_present: bool = True
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
            "stereo_present": self.stereo_present,
            "anomalies": list(self.anomalies),
        }


class StereoRealismDetector:
    """Detect implausibly synthetic stereo imaging across frequency bands."""

    def __init__(
        self,
        device: str = "cpu",
        reference_path: Optional[str | Path] = None,
        max_duration_sec: float = 60.0,
        sr: int = 44100,
    ) -> None:
        self.device = str(device or "cpu").strip().lower()
        self.sr = int(sr)
        self.max_duration_sec = float(max_duration_sec)
        if reference_path is None:
            root = Path(__file__).resolve().parent.parent
            reference_path = root / "models" / "stereo_reference_v1.json"
        self.reference_path = Path(reference_path)
        self.reference = self._load_reference(self.reference_path)
        self.model_loaded = bool(LIBROSA_AVAILABLE and self.reference)

    def reset_per_track_state(self) -> None:
        """Compatibility hook for long-running batch workers."""
        return None

    def analyze(self, audio: Any, sr: Optional[int] = None) -> StereoRealismResult:
        """Analyze stereo audio from an array or path."""
        if not LIBROSA_AVAILABLE:
            return self._neutral("librosa unavailable", model_loaded=False)
        if not self.reference:
            logger.warning("stereo realism reference missing: %s", self.reference_path)
            return self._neutral("stereo reference file missing", model_loaded=False)

        try:
            stereo, used_sr = self._load_stereo(audio, sr)
        except Exception as exc:
            logger.warning("stereo realism: audio load failed: %s", exc)
            return self._neutral("audio load failed")

        if stereo is None or stereo.ndim != 2 or stereo.shape[0] < 2:
            return self._neutral("mono audio; stereo realism skipped", stereo_present=False)

        left = np.asarray(stereo[0], dtype=np.float32)
        right = np.asarray(stereo[1], dtype=np.float32)
        if left.size < int(0.5 * used_sr) or right.size != left.size:
            return self._neutral("insufficient stereo samples", stereo_present=True)

        features = self.compute_features(stereo[:2], used_sr)
        if not features:
            return self._neutral("not enough stereo-band energy", stereo_present=True)

        score, confidence = self._score_features(features)
        return StereoRealismResult(
            score=float(np.clip(score, 0.0, 1.0)),
            confidence=float(np.clip(confidence, 0.0, 1.0)),
            features=features,
            model_loaded=True,
            stereo_present=True,
        )

    def _load_reference(self, path: Path) -> Optional[Dict[str, Any]]:
        try:
            with path.open("r", encoding="utf-8") as handle:
                data = json.load(handle)
            mean = data.get("mean")
            std = data.get("std")
            if not isinstance(mean, dict) or not isinstance(std, dict):
                raise ValueError("reference JSON must contain mean/std objects")
            return data
        except FileNotFoundError:
            logger.warning("stereo realism reference file not found: %s", path)
            return None
        except Exception as exc:
            logger.warning("stereo realism reference failed to load: %s", exc)
            return None

    def _load_stereo(self, audio: Any, sr: Optional[int]) -> tuple[Optional[np.ndarray], int]:
        if isinstance(audio, str):
            y, loaded_sr = librosa.load(
                audio,
                sr=self.sr,
                mono=False,
                duration=self.max_duration_sec if self.max_duration_sec > 0 else None,
            )
            stereo = self._to_channel_first(y)
            return stereo, int(loaded_sr)

        if sr is None:
            raise ValueError("sr is required when audio is an array")
        stereo = self._to_channel_first(np.asarray(audio))
        if stereo is not None and int(sr) != self.sr:
            stereo = librosa.resample(stereo, orig_sr=int(sr), target_sr=self.sr, axis=-1)
            return stereo.astype(np.float32, copy=False), self.sr
        return stereo, int(sr)

    @staticmethod
    def _to_channel_first(audio: np.ndarray) -> Optional[np.ndarray]:
        arr = np.asarray(audio, dtype=np.float32)
        if arr.ndim == 1:
            return None
        if arr.ndim != 2:
            arr = np.squeeze(arr)
            if arr.ndim != 2:
                return None
        if arr.shape[0] >= 2 and arr.shape[0] <= 8 and arr.shape[0] < arr.shape[1]:
            return arr
        if arr.shape[1] >= 2 and arr.shape[1] <= 8:
            return arr.T
        return None

    @classmethod
    def compute_features(cls, stereo: np.ndarray, sr: int) -> Dict[str, float]:
        """Compute stereo realism features independent of the reference file."""
        arr = cls._to_channel_first(stereo)
        if arr is None or arr.shape[0] < 2:
            return {}
        left = np.asarray(arr[0], dtype=np.float64)
        right = np.asarray(arr[1], dtype=np.float64)
        n = min(left.size, right.size)
        if n < 2048:
            return {}
        left = left[:n] - float(np.mean(left[:n]))
        right = right[:n] - float(np.mean(right[:n]))
        if max(float(np.sqrt(np.mean(left * left))), float(np.sqrt(np.mean(right * right)))) < 1e-7:
            return {}

        n_fft = 4096 if sr >= 32000 else 2048
        hop = n_fft // 4
        stft_l = librosa.stft(left.astype(np.float32), n_fft=n_fft, hop_length=hop, center=False)
        stft_r = librosa.stft(right.astype(np.float32), n_fft=n_fft, hop_length=hop, center=False)
        freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
        if stft_l.size == 0 or stft_r.size == 0:
            return {}

        mid = 0.5 * (stft_l + stft_r)
        side = 0.5 * (stft_l - stft_r)
        band_features: Dict[str, float] = {}
        coherences = []
        widths = []
        scatters = []
        centers = []

        for center in STEREO_BAND_CENTERS_HZ:
            low = center / np.sqrt(2.0)
            high = center * np.sqrt(2.0)
            if low >= sr * 0.49:
                continue
            high = min(high, sr * 0.49)
            mask = (freqs >= low) & (freqs < high)
            if not np.any(mask):
                continue

            l_band = stft_l[mask, :]
            r_band = stft_r[mask, :]
            m_band = mid[mask, :]
            s_band = side[mask, :]
            p_l = float(np.mean(np.abs(l_band) ** 2))
            p_r = float(np.mean(np.abs(r_band) ** 2))
            if max(p_l, p_r) < 1e-12:
                continue

            cross = np.mean(l_band * np.conj(r_band))
            coherence = float(np.abs(cross) / np.sqrt(max(p_l * p_r, 1e-18)))
            p_m = float(np.mean(np.abs(m_band) ** 2))
            p_s = float(np.mean(np.abs(s_band) ** 2))
            width = float(p_s / max(p_m + p_s, 1e-12))
            phase_diff = np.angle(l_band * np.conj(r_band))
            scatter = float(1.0 - np.abs(np.mean(np.exp(1j * phase_diff))))

            key = f"{int(center)}hz"
            band_features[f"coherence_{key}"] = float(np.clip(coherence, 0.0, 1.0))
            band_features[f"width_{key}"] = float(np.clip(width, 0.0, 1.0))
            band_features[f"phase_scatter_{key}"] = float(np.clip(scatter, 0.0, 1.0))
            coherences.append(band_features[f"coherence_{key}"])
            widths.append(band_features[f"width_{key}"])
            scatters.append(band_features[f"phase_scatter_{key}"])
            centers.append(float(center))

        if len(coherences) < 3:
            return band_features

        coh = np.asarray(coherences, dtype=np.float64)
        wid = np.asarray(widths, dtype=np.float64)
        sca = np.asarray(scatters, dtype=np.float64)
        log_centers = np.log2(np.asarray(centers, dtype=np.float64))
        width_slope = float(np.polyfit(log_centers, wid, 1)[0]) if len(wid) >= 2 else 0.0
        high_mask = np.asarray(centers) >= 4000.0
        if not np.any(high_mask):
            high_mask = np.ones_like(coh, dtype=bool)

        band_features.update({
            "mean_coherence": float(np.mean(coh)),
            "std_coherence": float(np.std(coh)),
            "high_band_coherence": float(np.mean(coh[high_mask])),
            "mean_width": float(np.mean(wid)),
            "std_width": float(np.std(wid)),
            "high_band_width": float(np.mean(wid[high_mask])),
            "width_slope": width_slope,
            "mean_phase_scatter": float(np.mean(sca)),
            "std_phase_scatter": float(np.std(sca)),
            "high_band_phase_scatter": float(np.mean(sca[high_mask])),
            "band_count": float(len(coh)),
        })
        return band_features

    @staticmethod
    def reference_feature_names() -> tuple[str, ...]:
        return (
            "mean_coherence",
            "std_coherence",
            "high_band_coherence",
            "mean_width",
            "std_width",
            "high_band_width",
            "width_slope",
            "mean_phase_scatter",
            "std_phase_scatter",
            "high_band_phase_scatter",
        )

    def _score_features(self, features: Dict[str, float]) -> tuple[float, float]:
        ref_mean = self.reference.get("mean", {}) if self.reference else {}
        ref_std = self.reference.get("std", {}) if self.reference else {}

        z_values = []
        for name in self.reference_feature_names():
            if name not in features or name not in ref_mean:
                continue
            std = max(float(ref_std.get(name, 0.0)), 0.03)
            z_values.append(abs(float(features[name]) - float(ref_mean[name])) / std)

        distance = float(np.mean(z_values)) if z_values else 0.0
        distance_ai = float(1.0 / (1.0 + np.exp(-(distance - 1.8))))

        mean_coh = float(features.get("mean_coherence", 0.5))
        high_coh = float(features.get("high_band_coherence", mean_coh))
        mean_width = float(features.get("mean_width", 0.0))
        std_width = float(features.get("std_width", 0.0))
        phase_scatter = float(features.get("mean_phase_scatter", 0.0))
        width_slope = abs(float(features.get("width_slope", 0.0)))

        mono_like_ai = float(np.clip((mean_coh - 0.94) / 0.05, 0.0, 1.0)) * float(np.clip((0.08 - mean_width) / 0.08, 0.0, 1.0))
        uniform_width_ai = float(np.clip((0.045 - std_width) / 0.045, 0.0, 1.0)) * float(np.clip((0.025 - width_slope) / 0.025, 0.0, 1.0))
        hyper_placed_ai = float(np.clip((high_coh - 0.88) / 0.10, 0.0, 1.0)) * float(np.clip((0.25 - phase_scatter) / 0.25, 0.0, 1.0))

        natural_decorrelation = (
            high_coh < 0.55
            and phase_scatter > 0.45
            and mean_width > 0.18
        )

        score = max(
            0.78 * mono_like_ai,
            0.65 * hyper_placed_ai,
            0.70 * uniform_width_ai,
            0.55 * distance_ai,
        )
        if natural_decorrelation:
            score *= 0.35

        confidence = 0.18 + 0.45 * min(distance / 3.0, 1.0) + 0.25 * max(mono_like_ai, hyper_placed_ai, uniform_width_ai)
        if natural_decorrelation:
            confidence = max(confidence, 0.45)
        return float(np.clip(score, 0.0, 1.0)), float(np.clip(confidence, 0.1, 0.95))

    @staticmethod
    def aggregate_reference(features: Iterable[Dict[str, float]]) -> Dict[str, Dict[str, float]]:
        rows = [row for row in features if row]
        names = StereoRealismDetector.reference_feature_names()
        mean: Dict[str, float] = {}
        std: Dict[str, float] = {}
        for name in names:
            values = np.asarray([float(row[name]) for row in rows if name in row], dtype=np.float64)
            if values.size == 0:
                mean[name] = 0.0
                std[name] = 1.0
            else:
                mean[name] = float(np.mean(values))
                std[name] = float(max(np.std(values), 0.03))
        return {"mean": mean, "std": std}

    @staticmethod
    def _neutral(
        reason: str,
        *,
        model_loaded: bool = True,
        stereo_present: bool = True,
    ) -> StereoRealismResult:
        return StereoRealismResult(
            score=0.5,
            confidence=0.1,
            features={"reason": 0.0},
            model_loaded=model_loaded,
            stereo_present=stereo_present,
            anomalies=[reason],
        )
