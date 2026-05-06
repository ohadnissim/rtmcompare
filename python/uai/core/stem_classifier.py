"""
Stem-specific detector focused on temporal micro-patterns.

Unlike the CNN detector, this module avoids CQT spectrograms and uses
time-domain and onset/pitch contour features designed to separate:
- AI-generated stems
- Demucs-separated human stems
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import librosa
import numpy as np


@dataclass
class StemClassifierResult:
    """Result from stem-specific temporal analysis."""

    score: float  # 0 = human-like, 1 = AI-like
    confidence: float
    stem_name: str
    feature_scores: Dict[str, float] = field(default_factory=dict)
    feature_details: Dict[str, dict] = field(default_factory=dict)
    anomalies: List[str] = field(default_factory=list)
    evidence_count: int = 0


class StemClassifier:
    """
    Stem-aware detector using time-domain and onset-based cues.

    Key analyses:
    - Drums: onset timing variance / grid-lock tightness
    - Vocals: pitch contour naturalness (stepwise vs smooth glide behavior)
    - All stems: transient attack shape symmetry/consistency
    """

    def __init__(
        self,
        sr: int = 22050,
        hop_length: int = 128,
        pitch_hop_length: int = 256,
        silence_rms: float = 1e-3,
    ):
        self.sr = sr
        self.hop_length = hop_length
        self.pitch_hop_length = pitch_hop_length
        self.silence_rms = silence_rms

    def analyze(self, stem_path: str, stem_name: Optional[str] = None) -> StemClassifierResult:
        """Analyze a stem file from disk."""
        y, sr = librosa.load(stem_path, sr=self.sr, mono=True)
        inferred = stem_name or self._infer_stem_name(stem_path)
        return self.analyze_array(y=y, sr=sr, stem_name=inferred)

    def analyze_array(self, y: np.ndarray, sr: int, stem_name: str) -> StemClassifierResult:
        """Analyze an in-memory stem waveform."""
        stem_key = self._normalize_stem_name(stem_name)

        if y.ndim > 1:
            y = librosa.to_mono(y)
        y = np.asarray(y, dtype=np.float32)

        if sr != self.sr:
            y = librosa.resample(y, orig_sr=sr, target_sr=self.sr)
            sr = self.sr

        rms = float(np.sqrt(np.mean(np.square(y)))) if y.size > 0 else 0.0
        if y.size == 0 or rms < self.silence_rms:
            return StemClassifierResult(
                score=0.5,
                confidence=0.0,
                stem_name=stem_key,
                anomalies=["Stem is nearly silent; insufficient temporal evidence"],
                evidence_count=0,
            )

        onset_env = librosa.onset.onset_strength(
            y=y,
            sr=sr,
            hop_length=self.hop_length,
            aggregate=np.median,
        )
        onset_frames = librosa.onset.onset_detect(
            onset_envelope=onset_env,
            sr=sr,
            hop_length=self.hop_length,
            backtrack=False,
            units="frames",
        )

        onset_times = librosa.frames_to_time(
            onset_frames,
            sr=sr,
            hop_length=self.hop_length,
        )
        onset_strengths = onset_env[onset_frames] if len(onset_frames) else np.array([], dtype=np.float32)
        onset_samples = librosa.frames_to_samples(onset_frames, hop_length=self.hop_length)

        feature_scores: Dict[str, float] = {}
        feature_details: Dict[str, dict] = {}
        anomalies: List[str] = []

        transient_score, transient_details, transient_anomalies = self._analyze_transient_attacks(
            y=y,
            sr=sr,
            onset_samples=onset_samples,
        )
        feature_scores["transient_attack_shape"] = transient_score
        feature_details["transient_attack_shape"] = transient_details
        anomalies.extend(transient_anomalies)

        branch_evidence_count = int(transient_details.get("events_used", 0))
        weights = {"transient_attack_shape": 1.0}

        if stem_key == "drums":
            timing_score, timing_details, timing_anomalies = self._analyze_drum_microtiming(
                onset_env=onset_env,
                onset_times=onset_times,
                onset_strengths=onset_strengths,
                sr=sr,
            )
            feature_scores["onset_timing_variance"] = timing_score
            feature_details["onset_timing_variance"] = timing_details
            anomalies.extend(timing_anomalies)

            branch_evidence_count = max(branch_evidence_count, int(timing_details.get("events_used", 0)))
            weights = {
                "onset_timing_variance": 0.60,
                "transient_attack_shape": 0.40,
            }

        elif stem_key == "vocals":
            pitch_score, pitch_details, pitch_anomalies = self._analyze_vocal_pitch_contour(
                y=y,
                sr=sr,
            )
            feature_scores["pitch_contour_naturalness"] = pitch_score
            feature_details["pitch_contour_naturalness"] = pitch_details
            anomalies.extend(pitch_anomalies)

            branch_evidence_count = max(branch_evidence_count, int(pitch_details.get("events_used", 0)))
            weights = {
                "pitch_contour_naturalness": 0.72,
                "transient_attack_shape": 0.28,
            }

        else:
            temporal_score, temporal_details, temporal_anomalies = self._analyze_general_microtiming(
                onset_times=onset_times,
                onset_strengths=onset_strengths,
            )
            feature_scores["onset_consistency"] = temporal_score
            feature_details["onset_consistency"] = temporal_details
            anomalies.extend(temporal_anomalies)

            branch_evidence_count = max(branch_evidence_count, int(temporal_details.get("events_used", 0)))
            weights = {
                "onset_consistency": 0.55,
                "transient_attack_shape": 0.45,
            }

        total_weight = float(sum(weights.values())) if weights else 1.0
        score = float(
            sum(weights.get(name, 0.0) * feature_scores.get(name, 0.5) for name in weights) / max(total_weight, 1e-8)
        )

        feature_vector = list(feature_scores.values())
        agreement = float(1.0 - np.std(feature_vector)) if len(feature_vector) > 1 else 0.55
        evidence = float(np.clip(branch_evidence_count / 45.0, 0.0, 1.0))
        decisiveness = float(abs(score - 0.5) * 2.0)
        confidence = float(np.clip(0.25 + 0.35 * evidence + 0.20 * agreement + 0.20 * decisiveness, 0, 1))

        return StemClassifierResult(
            score=float(np.clip(score, 0, 1)),
            confidence=confidence,
            stem_name=stem_key,
            feature_scores=feature_scores,
            feature_details=feature_details,
            anomalies=anomalies,
            evidence_count=branch_evidence_count,
        )

    def _analyze_drum_microtiming(
        self,
        onset_env: np.ndarray,
        onset_times: np.ndarray,
        onset_strengths: np.ndarray,
        sr: int,
    ) -> Tuple[float, dict, List[str]]:
        """Detect overly grid-locked drum timing (AI-like)."""
        if len(onset_times) < 8:
            return 0.5, {"events_used": len(onset_times)}, ["Not enough drum onsets for microtiming analysis"]

        try:
            _, beat_frames = librosa.beat.beat_track(
                onset_envelope=onset_env,
                sr=sr,
                hop_length=self.hop_length,
            )
            beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=self.hop_length)
        except Exception:
            beat_times = np.array([], dtype=np.float32)

        offsets = self._grid_offsets(onset_times=onset_times, beat_times=beat_times)
        if offsets.size < 6:
            return 0.5, {"events_used": int(offsets.size)}, ["Unable to build stable drum timing grid"]

        offset_ms = offsets * 1000.0
        timing_std_ms = float(np.std(offset_ms))
        timing_iqr_ms = float(np.percentile(offset_ms, 75) - np.percentile(offset_ms, 25))
        median_abs_offset_ms = float(np.median(np.abs(offset_ms)))
        offset_entropy = self._hist_entropy(offset_ms, bins=12, clip_range=(-60.0, 60.0))

        if onset_strengths.size >= 4:
            strength_cv = float(np.std(onset_strengths) / (np.mean(onset_strengths) + 1e-8))
        else:
            strength_cv = 0.5

        std_score = self._scale_inverse(timing_std_ms, low=5.5, high=23.0)
        iqr_score = self._scale_inverse(timing_iqr_ms, low=8.0, high=30.0)
        entropy_score = self._scale_inverse(offset_entropy, low=1.2, high=2.7)
        strength_score = self._scale_inverse(strength_cv, low=0.20, high=0.80)

        score = float(0.45 * std_score + 0.20 * iqr_score + 0.20 * entropy_score + 0.15 * strength_score)

        details = {
            "events_used": int(offsets.size),
            "timing_std_ms": timing_std_ms,
            "timing_iqr_ms": timing_iqr_ms,
            "median_abs_offset_ms": median_abs_offset_ms,
            "offset_entropy": float(offset_entropy),
            "onset_strength_cv": strength_cv,
        }

        anomalies = []
        if timing_std_ms < 9.0:
            anomalies.append(
                f"Drum onsets are extremely grid-locked (timing std {timing_std_ms:.1f}ms)"
            )
        if offset_entropy < 1.5:
            anomalies.append(
                f"Drum microtiming offsets have low entropy ({offset_entropy:.2f}), consistent with quantized timing"
            )
        if strength_cv < 0.25:
            anomalies.append(
                f"Drum onset strengths are unusually uniform (CV={strength_cv:.2f})"
            )

        return score, details, anomalies

    def _analyze_vocal_pitch_contour(self, y: np.ndarray, sr: int) -> Tuple[float, dict, List[str]]:
        """Measure vocal pitch naturalness; AI often shows stepped/quantized contours."""
        try:
            f0, voiced_flag, _ = librosa.pyin(
                y,
                fmin=librosa.note_to_hz("C2"),
                fmax=librosa.note_to_hz("C7"),
                sr=sr,
                frame_length=2048,
                hop_length=self.pitch_hop_length,
            )
        except Exception:
            return 0.5, {"events_used": 0}, ["Pitch tracker failed on vocals stem"]

        if f0 is None:
            return 0.5, {"events_used": 0}, ["Pitch tracker returned no vocal contour"]

        voiced_mask = np.isfinite(f0)
        if voiced_flag is not None:
            voiced_mask = voiced_mask & voiced_flag.astype(bool)

        if np.sum(voiced_mask) < 40:
            return 0.5, {"events_used": int(np.sum(voiced_mask))}, ["Insufficient voiced frames for pitch analysis"]

        midi = librosa.hz_to_midi(f0[voiced_mask]).astype(np.float32)
        midi = midi[np.isfinite(midi)]
        if midi.size < 40:
            return 0.5, {"events_used": int(midi.size)}, ["Pitch contour too sparse after filtering"]

        smooth = self._moving_average(midi, width=5)
        delta = np.diff(smooth)
        if delta.size < 8:
            return 0.5, {"events_used": int(midi.size)}, ["Pitch contour too short for derivative analysis"]

        abs_delta = np.abs(delta)
        quant_error = np.abs(smooth - np.round(smooth))

        quantized_ratio = float(np.mean(quant_error < 0.05))
        mean_quant_error = float(np.mean(quant_error))
        glide_ratio = float(np.mean((abs_delta >= 0.03) & (abs_delta <= 0.35)))
        step_ratio = float(np.mean(abs_delta > 0.55))
        frozen_ratio = float(np.mean(abs_delta < 0.015))

        trend = self._moving_average(smooth, width=15)
        residual = smooth - trend
        vibrato_std = float(np.std(residual))

        quantized_score = self._scale(quantized_ratio, low=0.45, high=0.92)
        low_glide_score = self._scale_inverse(glide_ratio, low=0.10, high=0.40)
        step_score = self._scale(step_ratio, low=0.08, high=0.50)
        frozen_score = self._scale(frozen_ratio, low=0.20, high=0.85)
        smoothness_score = self._scale_inverse(vibrato_std, low=0.03, high=0.20)

        score = float(
            0.18 * quantized_score
            + 0.32 * low_glide_score
            + 0.24 * step_score
            + 0.16 * frozen_score
            + 0.10 * smoothness_score
        )

        # Human autotune commonly keeps continuous correction curves.
        if glide_ratio > 0.27 and step_ratio < 0.18:
            score = max(0.0, score - 0.10)

        details = {
            "events_used": int(midi.size),
            "quantized_ratio": quantized_ratio,
            "mean_quant_error_semitones": mean_quant_error,
            "glide_ratio": glide_ratio,
            "step_ratio": step_ratio,
            "frozen_ratio": frozen_ratio,
            "vibrato_std_semitones": vibrato_std,
        }

        anomalies = []
        if quantized_ratio > 0.80 and glide_ratio < 0.15:
            anomalies.append(
                "Vocal pitch is heavily quantized with limited glide between notes"
            )
        if step_ratio > 0.35 and frozen_ratio > 0.55:
            anomalies.append(
                "Vocal contour alternates between flat holds and abrupt semitone jumps"
            )
        if vibrato_std < 0.04:
            anomalies.append(
                f"Vocal contour is unusually smooth (vibrato std {vibrato_std:.3f} semitones)"
            )

        return score, details, anomalies

    def _analyze_general_microtiming(
        self,
        onset_times: np.ndarray,
        onset_strengths: np.ndarray,
    ) -> Tuple[float, dict, List[str]]:
        """Temporal consistency fallback for non-drum/non-vocal stems."""
        if len(onset_times) < 6:
            return 0.5, {"events_used": len(onset_times)}, []

        ioi = np.diff(onset_times)
        ioi = ioi[(ioi > 0.03) & (ioi < 2.0)]
        if ioi.size < 4:
            return 0.5, {"events_used": int(ioi.size)}, []

        ioi_cv = float(np.std(ioi) / (np.mean(ioi) + 1e-8))
        ioi_mad_ms = float(np.median(np.abs(ioi - np.median(ioi))) * 1000.0)

        if onset_strengths.size >= 4:
            strength_cv = float(np.std(onset_strengths) / (np.mean(onset_strengths) + 1e-8))
        else:
            strength_cv = 0.5

        ioi_score = self._scale_inverse(ioi_cv, low=0.18, high=0.75)
        mad_score = self._scale_inverse(ioi_mad_ms, low=12.0, high=70.0)
        strength_score = self._scale_inverse(strength_cv, low=0.18, high=0.80)
        score = float(0.45 * ioi_score + 0.30 * mad_score + 0.25 * strength_score)

        details = {
            "events_used": int(ioi.size),
            "ioi_cv": ioi_cv,
            "ioi_mad_ms": ioi_mad_ms,
            "onset_strength_cv": strength_cv,
        }

        anomalies = []
        if ioi_cv < 0.22:
            anomalies.append(f"Onset intervals are unusually consistent (CV={ioi_cv:.2f})")

        return score, details, anomalies

    def _analyze_transient_attacks(
        self,
        y: np.ndarray,
        sr: int,
        onset_samples: np.ndarray,
    ) -> Tuple[float, dict, List[str]]:
        """Capture transient attack symmetry; AI stems tend to look overly clean/symmetric."""
        if onset_samples.size < 5:
            return 0.5, {"events_used": int(onset_samples.size)}, []

        pre = int(0.006 * sr)
        post = int(0.050 * sr)
        attack_search = int(0.020 * sr)
        post_probe = int(0.020 * sr)

        asym_values: List[float] = []
        attack_times_ms: List[float] = []

        abs_y = np.abs(y)
        n = len(abs_y)

        for onset in onset_samples:
            center = int(onset)
            start = max(0, center - pre)
            end = min(n, center + post)
            if end - start < int(0.015 * sr):
                continue

            segment = abs_y[start:end]
            center_local = center - start
            if center_local >= len(segment) - 2:
                continue

            pre_slice_start = max(0, center_local - max(1, pre // 2))
            pre_level = float(np.mean(segment[pre_slice_start:center_local + 1])) + 1e-8

            peak_end = min(len(segment), center_local + max(4, attack_search))
            if peak_end <= center_local + 1:
                continue

            rel_peak = int(np.argmax(segment[center_local:peak_end])) + center_local
            peak_level = float(segment[rel_peak])
            if peak_level < pre_level * 1.15:
                continue

            attack_time = max((rel_peak - center_local) / sr, 1.0 / sr)

            probe_idx = min(len(segment) - 1, rel_peak + max(3, post_probe))
            post_level = float(segment[probe_idx]) + 1e-8
            fall_time = max((probe_idx - rel_peak) / sr, 1.0 / sr)

            rise_slope = (peak_level - pre_level) / attack_time
            fall_slope = (peak_level - post_level) / fall_time

            ratio = abs(rise_slope) / (abs(fall_slope) + 1e-8)
            asymmetry = float(abs(np.log(ratio + 1e-8)))

            asym_values.append(asymmetry)
            attack_times_ms.append(float(attack_time * 1000.0))

        if len(asym_values) < 5:
            return 0.5, {"events_used": len(asym_values)}, []

        asym = np.asarray(asym_values, dtype=np.float32)
        attack_times_ms_arr = np.asarray(attack_times_ms, dtype=np.float32)

        mean_asym = float(np.mean(asym))
        std_asym = float(np.std(asym))
        attack_jitter_ms = float(np.std(attack_times_ms_arr))

        symmetry_score = self._scale_inverse(mean_asym, low=0.18, high=0.80)
        uniformity_score = self._scale_inverse(std_asym, low=0.08, high=0.35)
        attack_jitter_score = self._scale_inverse(attack_jitter_ms, low=0.7, high=4.5)
        score = float(0.50 * symmetry_score + 0.35 * uniformity_score + 0.15 * attack_jitter_score)

        details = {
            "events_used": int(len(asym_values)),
            "mean_asymmetry": mean_asym,
            "std_asymmetry": std_asym,
            "attack_time_jitter_ms": attack_jitter_ms,
        }

        anomalies = []
        if mean_asym < 0.28:
            anomalies.append(
                f"Transient attacks are unusually symmetric (mean asymmetry={mean_asym:.2f})"
            )
        if std_asym < 0.12:
            anomalies.append(
                f"Transient shapes show low variation (std asymmetry={std_asym:.2f})"
            )

        return score, details, anomalies

    def _grid_offsets(self, onset_times: np.ndarray, beat_times: np.ndarray) -> np.ndarray:
        """Signed onset offsets to nearest subdivision grid point."""
        grid = self._build_subdivision_grid(onset_times=onset_times, beat_times=beat_times)
        if grid.size < 2 or onset_times.size == 0:
            return np.array([], dtype=np.float32)

        idx = np.searchsorted(grid, onset_times)
        left_idx = np.clip(idx - 1, 0, len(grid) - 1)
        right_idx = np.clip(idx, 0, len(grid) - 1)

        left_diff = onset_times - grid[left_idx]
        right_diff = onset_times - grid[right_idx]
        use_left = np.abs(left_diff) <= np.abs(right_diff)
        offsets = np.where(use_left, left_diff, right_diff)
        return offsets.astype(np.float32)

    def _build_subdivision_grid(self, onset_times: np.ndarray, beat_times: np.ndarray) -> np.ndarray:
        """
        Build a timing grid from beat estimates.
        Falls back to onset median period if beat tracking is weak.
        """
        grid: List[float] = []

        if beat_times.size >= 3:
            for i in range(len(beat_times) - 1):
                start = float(beat_times[i])
                dt = float(beat_times[i + 1] - beat_times[i])
                if dt <= 0.15 or dt >= 1.5:
                    continue
                for frac in (0.0, 0.25, 0.50, 0.75):
                    grid.append(start + frac * dt)
            if len(grid) >= 8:
                return np.asarray(sorted(grid), dtype=np.float32)

        if onset_times.size < 3:
            return np.array([], dtype=np.float32)

        ioi = np.diff(onset_times)
        ioi = ioi[(ioi > 0.05) & (ioi < 2.0)]
        if ioi.size == 0:
            return np.array([], dtype=np.float32)

        period = float(np.median(ioi))
        period = float(np.clip(period, 0.20, 0.90))
        step = period / 4.0
        if step <= 0:
            return np.array([], dtype=np.float32)

        start = float(onset_times[0])
        stop = float(onset_times[-1] + step)
        return np.arange(start, stop, step, dtype=np.float32)

    def _infer_stem_name(self, stem_path: str) -> str:
        lower = stem_path.lower()
        for name in ("vocals", "drums", "bass", "other"):
            if name in lower:
                return name
        return "other"

    def _normalize_stem_name(self, stem_name: str) -> str:
        name = str(stem_name or "").lower().strip()
        if name in {"vocals", "drums", "bass", "other"}:
            return name
        if "vocal" in name:
            return "vocals"
        if "drum" in name:
            return "drums"
        if "bass" in name:
            return "bass"
        return "other"

    def _hist_entropy(self, values: np.ndarray, bins: int, clip_range: Tuple[float, float]) -> float:
        clipped = np.clip(values, clip_range[0], clip_range[1])
        counts, _ = np.histogram(clipped, bins=bins, range=clip_range)
        total = int(np.sum(counts))
        if total <= 0:
            return 0.0
        probs = counts[counts > 0] / float(total)
        return float(-np.sum(probs * np.log2(probs + 1e-12)))

    def _moving_average(self, values: np.ndarray, width: int) -> np.ndarray:
        if width <= 1 or values.size < width:
            return values.copy()
        kernel = np.ones(width, dtype=np.float32) / float(width)
        left = width // 2
        right = width - 1 - left
        padded = np.pad(values, (left, right), mode="edge")
        return np.convolve(padded, kernel, mode="valid").astype(np.float32)

    def _scale(self, value: float, low: float, high: float) -> float:
        if high <= low:
            return 0.5
        if value <= low:
            return 0.0
        if value >= high:
            return 1.0
        return float((value - low) / (high - low))

    def _scale_inverse(self, value: float, low: float, high: float) -> float:
        if high <= low:
            return 0.5
        if value <= low:
            return 1.0
        if value >= high:
            return 0.0
        return float(1.0 - (value - low) / (high - low))
