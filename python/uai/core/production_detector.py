"""Production and mastering detector for AI-assisted mix-bus signatures."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Tuple

import librosa
import numpy as np
import soundfile as sf
from scipy.ndimage import gaussian_filter1d
from scipy.signal import find_peaks


logger = logging.getLogger(__name__)


@dataclass
class ProductionResult:
    """Production analysis result.

    score is 0..1, where 1 means the production/mastering looks AI-assisted.
    """

    score: float
    confidence: float
    features: Dict[str, Any] = field(default_factory=dict)
    reasons: List[str] = field(default_factory=list)


class ProductionDetector:
    """Analyze mix-bus dynamics, EQ shape, and neural-codec artifact cues."""

    def __init__(
        self,
        sr: int = 44100,
        n_fft: int = 4096,
        hop_length: int = 1024,
        silence_rms: float = 1e-4,
    ):
        self.sr = sr
        self.n_fft = n_fft
        self.hop_length = hop_length
        self.silence_rms = silence_rms

    def analyze(self, audio_path: str) -> ProductionResult:
        """Run production analysis on a full mix or production stem."""
        if not audio_path or not Path(audio_path).exists():
            return ProductionResult(
                score=0.5,
                confidence=0.0,
                features={"error": "file_not_found"},
                reasons=["Production analysis skipped because the audio file was not found"],
            )

        try:
            y, sr = self._load_audio(audio_path)
        except Exception as exc:
            logger.warning("Production audio load failed: %s", exc)
            return ProductionResult(
                score=0.5,
                confidence=0.0,
                features={"error": str(exc)[:500]},
                reasons=[f"Production analysis could not read the audio: {str(exc)[:120]}"],
            )

        if y.size == 0:
            return ProductionResult(
                score=0.5,
                confidence=0.0,
                features={"duration_seconds": 0.0},
                reasons=["Production analysis skipped because the audio is empty"],
            )

        mono = np.mean(y, axis=0) if y.ndim == 2 else y
        rms = float(np.sqrt(np.mean(np.square(mono)))) if mono.size else 0.0
        duration = float(mono.size / max(sr, 1))
        if duration < 2.0 or rms < self.silence_rms:
            return ProductionResult(
                score=0.5,
                confidence=0.0,
                features={"duration_seconds": duration, "rms": rms},
                reasons=["Production analysis needs at least two seconds of non-silent audio"],
            )

        stft_mag = np.abs(
            librosa.stft(
                mono,
                n_fft=self.n_fft,
                hop_length=self.hop_length,
                window="hann",
                center=True,
            )
        )
        freqs = librosa.fft_frequencies(sr=sr, n_fft=self.n_fft)

        dynamics_score, dynamics_features, dynamics_reasons = self._score_over_compression(mono, sr)
        eq_score, eq_features, eq_reasons = self._score_ai_eq_curve(stft_mag, freqs)
        codec_score, codec_features, codec_reasons = self._score_neural_codec_artifacts(stft_mag, freqs)
        stereo_score, stereo_features, stereo_reasons = self._score_stereo_bus(y, sr)

        features = {
            "duration_seconds": duration,
            "rms": rms,
            "over_compressed_dynamics": dynamics_features,
            "ai_typical_eq_curve": eq_features,
            "neural_codec_artifacts": codec_features,
            "stereo_mix_bus": stereo_features,
        }

        scores = {
            "over_compressed_dynamics": dynamics_score,
            "ai_typical_eq_curve": eq_score,
            "neural_codec_artifacts": codec_score,
            "stereo_mix_bus": stereo_score,
        }
        weights = {
            "over_compressed_dynamics": 0.38,
            "ai_typical_eq_curve": 0.27,
            "neural_codec_artifacts": 0.25,
            "stereo_mix_bus": 0.10,
        }
        score = float(sum(scores[name] * weights[name] for name in weights) / sum(weights.values()))

        reasons: List[str] = []
        reasons.extend(dynamics_reasons)
        reasons.extend(eq_reasons)
        reasons.extend(codec_reasons)
        reasons.extend(stereo_reasons)
        if not reasons:
            if score < 0.4:
                reasons.append("Mix-bus dynamics, EQ shape, and artifact profile look broadly human-mastered")
            elif score > 0.6:
                reasons.append("Production shows multiple AI-assisted mastering or neural processing cues")
            else:
                reasons.append("Production evidence is mixed; no single mix-bus cue dominates")

        confidence = self._confidence(duration=duration, scores=list(scores.values()), reason_count=len(reasons))
        return ProductionResult(
            score=float(np.clip(score, 0.0, 1.0)),
            confidence=confidence,
            features=features,
            reasons=self._dedupe_reasons(reasons),
        )

    def _load_audio(self, audio_path: str) -> Tuple[np.ndarray, int]:
        data, sr = sf.read(audio_path, always_2d=True, dtype="float32")
        if data.shape[0] == 0:
            return np.array([], dtype=np.float32), self.sr

        y = data.T
        if y.shape[0] == 1:
            y = y[0]

        if sr != self.sr:
            if y.ndim == 1:
                y = librosa.resample(y, orig_sr=sr, target_sr=self.sr)
            else:
                y = np.vstack([librosa.resample(channel, orig_sr=sr, target_sr=self.sr) for channel in y])
            sr = self.sr

        return np.asarray(y, dtype=np.float32), sr

    def _score_over_compression(self, y: np.ndarray, sr: int) -> Tuple[float, dict, List[str]]:
        frame_length = int(min(max(2048, sr // 10), max(len(y), 2048)))
        hop_length = max(512, frame_length // 4)
        rms_frames = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length, center=True)[0]
        rms_db = librosa.amplitude_to_db(np.maximum(rms_frames, 1e-8), ref=1.0)
        peak = float(np.max(np.abs(y)) + 1e-8)
        global_rms = float(np.sqrt(np.mean(np.square(y))) + 1e-8)
        crest_factor_db = 20.0 * np.log10(peak / global_rms)
        dynamic_range_db = float(np.percentile(rms_db, 95) - np.percentile(rms_db, 10))
        short_term_std_db = float(np.std(rms_db))
        loud_frame_ratio = float(np.mean(rms_db > (np.percentile(rms_db, 95) - 1.5)))

        dynamic_score = 1.0 - _scale(dynamic_range_db, low=4.0, high=14.0)
        crest_score = 1.0 - _scale(crest_factor_db, low=7.0, high=16.0)
        variance_score = 1.0 - _scale(short_term_std_db, low=2.0, high=8.0)
        limiter_score = _scale(loud_frame_ratio, low=0.14, high=0.42)
        score = float(np.clip(0.36 * dynamic_score + 0.29 * crest_score + 0.22 * variance_score + 0.13 * limiter_score, 0, 1))

        features = {
            "score": score,
            "dynamic_range_db": dynamic_range_db,
            "crest_factor_db": crest_factor_db,
            "short_term_rms_std_db": short_term_std_db,
            "loud_frame_ratio": loud_frame_ratio,
        }

        reasons = []
        if dynamic_range_db < 5.5:
            reasons.append(f"Mix dynamics are very compressed (frame dynamic range {dynamic_range_db:.1f} dB)")
        if crest_factor_db < 8.5:
            reasons.append(f"Low crest factor suggests heavy limiting ({crest_factor_db:.1f} dB)")
        if short_term_std_db < 2.3 and dynamic_range_db < 7.0:
            reasons.append("Short-term loudness stays unusually uniform across the mix")
        return score, features, reasons

    def _score_ai_eq_curve(self, stft_mag: np.ndarray, freqs: np.ndarray) -> Tuple[float, dict, List[str]]:
        power = np.square(stft_mag) + 1e-12
        mean_power = np.mean(power, axis=1)
        mean_db = librosa.power_to_db(mean_power, ref=np.max)
        smooth_db = gaussian_filter1d(mean_db, sigma=4)
        residual = mean_db - smooth_db

        useful = (freqs >= 80.0) & (freqs <= min(18000.0, freqs[-1]))
        residual_std_db = float(np.std(residual[useful])) if np.any(useful) else 0.0
        curve_smoothness = 1.0 - _scale(residual_std_db, low=1.1, high=5.5)

        bands = {
            "sub": (20, 60),
            "bass": (60, 250),
            "low_mid": (250, 500),
            "mid": (500, 2000),
            "presence": (2000, 6000),
            "brilliance": (6000, 12000),
            "air": (12000, 20000),
        }
        band_db = {}
        for name, (low, high) in bands.items():
            mask = (freqs >= low) & (freqs < high)
            if not np.any(mask):
                band_db[name] = -120.0
                continue
            band_db[name] = float(10.0 * np.log10(np.mean(mean_power[mask]) + 1e-12))

        band_values = np.asarray([v for v in band_db.values() if v > -110], dtype=np.float32)
        band_spread_db = float(np.percentile(band_values, 90) - np.percentile(band_values, 10)) if band_values.size else 0.0
        band_balance_score = 1.0 - _scale(band_spread_db, low=10.0, high=32.0)
        low_mid_scoop_db = float(((band_db["bass"] + band_db["presence"]) / 2.0) - band_db["low_mid"])
        high_shelf_gap_db = float(band_db["brilliance"] - band_db["air"])
        scoop_score = _scale(low_mid_scoop_db, low=3.0, high=10.0)
        air_rolloff_score = _scale(high_shelf_gap_db, low=8.0, high=24.0)

        score = float(np.clip(0.38 * curve_smoothness + 0.25 * band_balance_score + 0.22 * scoop_score + 0.15 * air_rolloff_score, 0, 1))
        features = {
            "score": score,
            "spectral_curve_residual_std_db": residual_std_db,
            "spectral_curve_smoothness": curve_smoothness,
            "band_energy_db": band_db,
            "band_spread_db": band_spread_db,
            "low_mid_scoop_db": low_mid_scoop_db,
            "brilliance_to_air_gap_db": high_shelf_gap_db,
        }

        reasons = []
        if residual_std_db < 1.4 and band_spread_db < 14.0:
            reasons.append("Average EQ curve is unusually smooth and evenly balanced")
        if low_mid_scoop_db > 7.0:
            reasons.append(f"EQ profile has an exaggerated low-mid scoop ({low_mid_scoop_db:.1f} dB)")
        if high_shelf_gap_db > 18.0:
            reasons.append(f"Top-end rolloff resembles neural or codec-shaped mastering ({high_shelf_gap_db:.1f} dB gap)")
        return score, features, reasons

    def _score_neural_codec_artifacts(self, stft_mag: np.ndarray, freqs: np.ndarray) -> Tuple[float, dict, List[str]]:
        power = np.square(stft_mag) + 1e-12
        db = librosa.power_to_db(power, ref=np.max)
        high_mask = (freqs >= 6000.0) & (freqs <= min(18000.0, freqs[-1]))
        mid_mask = (freqs >= 800.0) & (freqs < 6000.0)

        if not np.any(high_mask) or not np.any(mid_mask):
            return 0.5, {"score": 0.5, "reason": "insufficient_bandwidth"}, []

        high = db[high_mask, :]
        mid = db[mid_mask, :]
        high_mean = float(np.mean(high))
        mid_mean = float(np.mean(mid))
        high_to_mid_gap_db = mid_mean - high_mean

        high_flux = np.mean(np.abs(np.diff(high, axis=1)), axis=0) if high.shape[1] > 1 else np.array([0.0])
        mid_flux = np.mean(np.abs(np.diff(mid, axis=1)), axis=0) if mid.shape[1] > 1 else np.array([0.0])
        flux_ratio = float((np.mean(high_flux) + 1e-8) / (np.mean(mid_flux) + 1e-8))
        high_noise_stability = 1.0 - _scale(float(np.std(np.mean(high, axis=0))), low=2.0, high=8.0)

        mean_db = np.mean(db, axis=1)
        smooth_db = gaussian_filter1d(mean_db, sigma=8)
        residual = mean_db - smooth_db
        high_residual = residual[high_mask]
        peaks, properties = find_peaks(high_residual, height=2.5, distance=3)
        peak_density_per_khz = float(len(peaks) / max((freqs[high_mask][-1] - freqs[high_mask][0]) / 1000.0, 1e-8))
        peak_height_mean = float(np.mean(properties.get("peak_heights", [0.0]))) if len(peaks) else 0.0

        flux_score = _scale(flux_ratio, low=1.25, high=2.4)
        stability_score = high_noise_stability
        peak_score = _scale(peak_density_per_khz, low=0.6, high=2.8)
        gap_score = _scale(high_to_mid_gap_db, low=18.0, high=36.0)
        score = float(np.clip(0.33 * flux_score + 0.26 * stability_score + 0.24 * peak_score + 0.17 * gap_score, 0, 1))

        features = {
            "score": score,
            "high_to_mid_energy_gap_db": high_to_mid_gap_db,
            "high_to_mid_flux_ratio": flux_ratio,
            "high_band_noise_stability": high_noise_stability,
            "narrowband_peak_density_per_khz": peak_density_per_khz,
            "narrowband_peak_height_mean_db": peak_height_mean,
        }

        reasons = []
        if flux_ratio > 2.0 and high_noise_stability > 0.65:
            reasons.append("High-band texture shows stable, shimmering changes associated with neural-codec residue")
        if peak_density_per_khz > 2.0 and peak_height_mean > 3.0:
            reasons.append("Narrow high-frequency peaks suggest neural or codec artifact residue on the mix bus")
        if high_to_mid_gap_db > 30.0:
            reasons.append(f"High-band energy is strongly suppressed relative to mids ({high_to_mid_gap_db:.1f} dB)")
        return score, features, reasons

    def _score_stereo_bus(self, y: np.ndarray, sr: int) -> Tuple[float, dict, List[str]]:
        if y.ndim != 2 or y.shape[0] < 2:
            return 0.5, {"score": 0.5, "stereo_present": False}, []

        left = y[0]
        right = y[1]
        min_len = min(left.size, right.size)
        if min_len < sr:
            return 0.5, {"score": 0.5, "stereo_present": True, "reason": "short_audio"}, []

        left = left[:min_len]
        right = right[:min_len]
        corr = float(np.corrcoef(left, right)[0, 1]) if np.std(left) > 1e-8 and np.std(right) > 1e-8 else 1.0
        mid = (left + right) * 0.5
        side = (left - right) * 0.5
        mid_rms = float(np.sqrt(np.mean(np.square(mid))) + 1e-8)
        side_rms = float(np.sqrt(np.mean(np.square(side))) + 1e-8)
        side_ratio_db = 20.0 * np.log10(side_rms / mid_rms)

        mono_score = _scale(corr, low=0.92, high=0.995)
        side_score = 1.0 - _scale(side_ratio_db, low=-22.0, high=-9.0)
        score = float(np.clip(0.58 * mono_score + 0.42 * side_score, 0, 1))
        features = {
            "score": score,
            "stereo_present": True,
            "left_right_correlation": corr,
            "side_to_mid_ratio_db": side_ratio_db,
        }

        reasons = []
        if corr > 0.985 and side_ratio_db < -18.0:
            reasons.append("Stereo bus is unusually narrow and highly correlated")
        return score, features, reasons

    def _confidence(self, duration: float, scores: List[float], reason_count: int) -> float:
        duration_evidence = _scale(duration, low=8.0, high=80.0)
        score_array = np.asarray(scores, dtype=np.float32)
        decisiveness = float(abs(np.mean(score_array) - 0.5) * 2.0)
        agreement = float(1.0 - min(np.std(score_array) * 1.7, 1.0))
        evidence_count = _scale(reason_count, low=1.0, high=4.0)
        confidence = 0.36 * duration_evidence + 0.24 * agreement + 0.22 * decisiveness + 0.18 * evidence_count
        return float(np.clip(confidence, 0.0, 0.92))

    def _dedupe_reasons(self, reasons: List[str]) -> List[str]:
        deduped = []
        seen = set()
        for reason in reasons:
            if reason in seen:
                continue
            seen.add(reason)
            deduped.append(reason)
        return deduped


def _scale(value: float, low: float, high: float) -> float:
    if high == low:
        return 0.0
    return float(np.clip((float(value) - low) / (high - low), 0.0, 1.0))
