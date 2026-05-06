"""
Onset micro-timing detector.

AI drums and generated instrumentals often place transients very close to a
subdivision grid. Human performances usually keep the same musical grid, but
their onset offsets and inter-onset intervals have more natural variance.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Sequence

import librosa
import numpy as np
from scipy import stats


@dataclass
class OnsetTimingResult:
    """Result from onset micro-timing analysis."""

    score: float  # 0 = human-like timing, 1 = AI-like grid timing
    confidence: float
    onset_count: int
    tempo_bpm: float
    timing_std_ms: float
    timing_iqr_ms: float
    median_abs_offset_ms: float
    grid_snap_ratio: float
    offset_entropy: float
    ioi_cv: float
    ioi_mad_ms: float
    ioi_lognormal_ks: float
    ioi_normal_ks: float
    ioi_uniform_ks: float
    grid_lock_score: float
    ioi_regularity_score: float
    distribution_score: float
    onset_strength_uniformity_score: float
    anomalies: List[str] = field(default_factory=list)


class OnsetTimingDetector:
    """
    Detect overly quantized onset timing.

    The detector focuses on the percussive component of the mix, estimates a
    beat/subdivision grid, then scores how tightly detected onsets snap to that
    grid. It also compares inter-onset interval distributions against fitted
    log-normal, normal, and uniform distributions.
    """

    def __init__(
        self,
        sr: int = 22050,
        max_duration: float = 90.0,
        hop_length: int = 128,
        min_onsets: int = 12,
        max_onsets: int = 600,
        grid_subdivisions: Sequence[int] = (3, 4),
    ):
        self.sr = int(sr)
        self.max_duration = float(max_duration)
        self.hop_length = int(hop_length)
        self.min_onsets = int(min_onsets)
        self.max_onsets = int(max_onsets)
        self.grid_subdivisions = tuple(int(s) for s in grid_subdivisions if int(s) > 1)

    def analyze(self, audio_path: str) -> OnsetTimingResult:
        """Analyze onset micro-timing and return an AI-likelihood score."""

        y, sr = librosa.load(
            audio_path,
            sr=self.sr,
            mono=True,
            duration=self.max_duration if self.max_duration > 0 else None,
        )

        if y.size == 0:
            return self._neutral("Audio appears empty; onset timing analysis skipped")

        onset_source = self._percussive_source(y)
        onset_env = librosa.onset.onset_strength(
            y=onset_source,
            sr=sr,
            hop_length=self.hop_length,
            aggregate=np.median,
            detrend=False,
        )

        onset_frames = librosa.onset.onset_detect(
            onset_envelope=onset_env,
            sr=sr,
            hop_length=self.hop_length,
            backtrack=False,
            units="frames",
        )

        if onset_frames.size == 0:
            return self._neutral("No clear onsets detected")

        onset_strengths = onset_env[onset_frames].astype(np.float32)
        onset_frames, onset_strengths = self._limit_onsets(onset_frames, onset_strengths)
        onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=self.hop_length)

        if onset_times.size < self.min_onsets:
            result = self._neutral("Not enough onsets for micro-timing analysis")
            result.onset_count = int(onset_times.size)
            return result

        tempo_bpm, beat_times = self._beat_grid(onset_env, sr)
        grid = self._build_subdivision_grid(beat_times)
        if grid.size < 4:
            grid, fallback_tempo = self._fallback_subdivision_grid(onset_times)
            if tempo_bpm <= 0:
                tempo_bpm = fallback_tempo

        offsets = self._grid_offsets(onset_times=onset_times, grid=grid)
        if offsets.size and float(np.median(np.abs(offsets))) > 0.070:
            fallback_grid, fallback_tempo = self._fallback_subdivision_grid(onset_times)
            fallback_offsets = self._grid_offsets(onset_times=onset_times, grid=fallback_grid)
            if fallback_offsets.size >= offsets.size * 0.75:
                grid = fallback_grid
                offsets = fallback_offsets
                if fallback_tempo > 0:
                    tempo_bpm = fallback_tempo

        if offsets.size < max(8, self.min_onsets // 2):
            result = self._neutral("Unable to build stable onset timing grid")
            result.onset_count = int(onset_times.size)
            result.tempo_bpm = tempo_bpm
            return result

        offset_ms = offsets * 1000.0
        # Remove constant detector/beat-tracker latency. Micro-timing evidence is
        # in the spread of offsets around the grid, not in a fixed phase shift.
        centered_offset_ms = offset_ms - float(np.median(offset_ms))
        abs_offset_ms = np.abs(centered_offset_ms)

        timing_std_ms = float(np.std(centered_offset_ms))
        timing_iqr_ms = float(np.percentile(centered_offset_ms, 75) - np.percentile(centered_offset_ms, 25))
        median_abs_offset_ms = float(np.median(abs_offset_ms))
        grid_snap_ratio = float(np.mean(abs_offset_ms <= 8.0))
        offset_entropy = self._hist_entropy(centered_offset_ms, bins=16, clip_range=(-70.0, 70.0))

        ioi_metrics = self._ioi_metrics(onset_times)
        strength_cv = self._coefficient_of_variation(onset_strengths)

        std_score = self._scale_inverse(timing_std_ms, low=6.0, high=28.0)
        iqr_score = self._scale_inverse(timing_iqr_ms, low=8.0, high=38.0)
        snap_score = self._scale(grid_snap_ratio, low=0.45, high=0.85)
        entropy_score = self._scale_inverse(offset_entropy, low=1.4, high=3.4)
        grid_lock_score = float(
            0.35 * std_score
            + 0.25 * iqr_score
            + 0.25 * snap_score
            + 0.15 * entropy_score
        )

        ioi_cv_score = self._scale_inverse(ioi_metrics["ioi_cv"], low=0.14, high=0.70)
        ioi_mad_score = self._scale_inverse(ioi_metrics["ioi_mad_ms"], low=10.0, high=85.0)
        ioi_regularity_score = float(0.60 * ioi_cv_score + 0.40 * ioi_mad_score)

        distribution_score = self._distribution_score(
            lognormal_ks=ioi_metrics["ioi_lognormal_ks"],
            normal_ks=ioi_metrics["ioi_normal_ks"],
            uniform_ks=ioi_metrics["ioi_uniform_ks"],
            event_count=ioi_metrics["events_used"],
        )

        strength_uniformity_score = self._scale_inverse(strength_cv, low=0.25, high=0.90)

        score = float(
            0.70 * grid_lock_score
            + 0.10 * ioi_regularity_score
            + 0.15 * distribution_score
            + 0.05 * strength_uniformity_score
        )

        components = np.array(
            [grid_lock_score, ioi_regularity_score, distribution_score, strength_uniformity_score],
            dtype=np.float32,
        )
        agreement = float(1.0 - min(np.std(components) * 1.4, 1.0))
        evidence = float(np.clip((offsets.size - self.min_onsets) / 90.0, 0.0, 1.0))
        beat_evidence = float(np.clip(beat_times.size / 12.0, 0.0, 1.0))
        decisiveness = float(abs(score - 0.5) * 2.0)
        confidence = float(
            np.clip(
                0.15
                + 0.30 * evidence
                + 0.20 * beat_evidence
                + 0.20 * agreement
                + 0.15 * decisiveness,
                0.0,
                1.0,
            )
        )

        anomalies: List[str] = []
        if timing_std_ms < 10.0 and grid_snap_ratio > 0.60:
            anomalies.append(
                f"Onsets are tightly grid-locked (std={timing_std_ms:.1f}ms, snap={grid_snap_ratio:.0%})"
            )
        if ioi_metrics["ioi_cv"] < 0.18 and ioi_metrics["events_used"] >= 12:
            anomalies.append(
                f"Inter-onset intervals are unusually regular (CV={ioi_metrics['ioi_cv']:.2f})"
            )
        if distribution_score > 0.65 and ioi_metrics["events_used"] >= 12:
            anomalies.append(
                "Inter-onset interval distribution fits normal/uniform timing better than log-normal timing"
            )
        if strength_cv < 0.28:
            anomalies.append(f"Onset strengths are unusually uniform (CV={strength_cv:.2f})")

        return OnsetTimingResult(
            score=float(np.clip(score, 0.0, 1.0)),
            confidence=confidence,
            onset_count=int(onset_times.size),
            tempo_bpm=tempo_bpm,
            timing_std_ms=timing_std_ms,
            timing_iqr_ms=timing_iqr_ms,
            median_abs_offset_ms=median_abs_offset_ms,
            grid_snap_ratio=grid_snap_ratio,
            offset_entropy=offset_entropy,
            ioi_cv=float(ioi_metrics["ioi_cv"]),
            ioi_mad_ms=float(ioi_metrics["ioi_mad_ms"]),
            ioi_lognormal_ks=float(ioi_metrics["ioi_lognormal_ks"]),
            ioi_normal_ks=float(ioi_metrics["ioi_normal_ks"]),
            ioi_uniform_ks=float(ioi_metrics["ioi_uniform_ks"]),
            grid_lock_score=grid_lock_score,
            ioi_regularity_score=ioi_regularity_score,
            distribution_score=distribution_score,
            onset_strength_uniformity_score=strength_uniformity_score,
            anomalies=anomalies,
        )

    def _neutral(self, reason: str) -> OnsetTimingResult:
        return OnsetTimingResult(
            score=0.5,
            confidence=0.0,
            onset_count=0,
            tempo_bpm=0.0,
            timing_std_ms=0.0,
            timing_iqr_ms=0.0,
            median_abs_offset_ms=0.0,
            grid_snap_ratio=0.0,
            offset_entropy=0.0,
            ioi_cv=0.0,
            ioi_mad_ms=0.0,
            ioi_lognormal_ks=0.5,
            ioi_normal_ks=0.5,
            ioi_uniform_ks=0.5,
            grid_lock_score=0.5,
            ioi_regularity_score=0.5,
            distribution_score=0.5,
            onset_strength_uniformity_score=0.5,
            anomalies=[reason],
        )

    def _percussive_source(self, y: np.ndarray) -> np.ndarray:
        """Use HPSS percussive audio when it has enough energy."""
        try:
            _, percussive = librosa.effects.hpss(y)
        except Exception:
            return y

        y_rms = self._rms(y)
        p_rms = self._rms(percussive)
        if p_rms > max(1e-5, y_rms * 0.08):
            return percussive.astype(np.float32)
        return y

    def _limit_onsets(
        self,
        onset_frames: np.ndarray,
        onset_strengths: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray]:
        if onset_frames.size <= self.max_onsets:
            return onset_frames, onset_strengths

        strongest = np.argsort(onset_strengths)[-self.max_onsets :]
        strongest = np.sort(strongest)
        return onset_frames[strongest], onset_strengths[strongest]

    def _beat_grid(self, onset_env: np.ndarray, sr: int) -> tuple[float, np.ndarray]:
        try:
            tempo, beat_frames = librosa.beat.beat_track(
                onset_envelope=onset_env,
                sr=sr,
                hop_length=self.hop_length,
            )
            tempo_arr = np.asarray(tempo).reshape(-1)
            tempo_bpm = float(tempo_arr[0]) if tempo_arr.size else 0.0
            beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=self.hop_length)
        except Exception:
            tempo_bpm = 0.0
            beat_times = np.array([], dtype=np.float32)

        return tempo_bpm, beat_times.astype(np.float32)

    def _grid_offsets(self, onset_times: np.ndarray, grid: np.ndarray) -> np.ndarray:
        if grid.size < 4:
            return np.array([], dtype=np.float32)

        valid_onsets = onset_times[(onset_times >= grid[0]) & (onset_times <= grid[-1])]
        if valid_onsets.size == 0:
            return np.array([], dtype=np.float32)

        idx = np.searchsorted(grid, valid_onsets)
        left_idx = np.clip(idx - 1, 0, grid.size - 1)
        right_idx = np.clip(idx, 0, grid.size - 1)

        left_diff = valid_onsets - grid[left_idx]
        right_diff = valid_onsets - grid[right_idx]
        use_left = np.abs(left_diff) <= np.abs(right_diff)
        offsets = np.where(use_left, left_diff, right_diff)
        return offsets.astype(np.float32)

    def _build_subdivision_grid(self, beat_times: np.ndarray) -> np.ndarray:
        if beat_times.size < 3:
            return np.array([], dtype=np.float32)

        grid: List[float] = []
        for i in range(beat_times.size - 1):
            start = float(beat_times[i])
            dt = float(beat_times[i + 1] - beat_times[i])
            if dt < 0.18 or dt > 1.6:
                continue
            for subdivision in self.grid_subdivisions:
                for step in range(subdivision):
                    grid.append(start + (step / float(subdivision)) * dt)

        if not grid:
            return np.array([], dtype=np.float32)
        return np.asarray(sorted(set(round(v, 6) for v in grid)), dtype=np.float32)

    def _fallback_subdivision_grid(self, onset_times: np.ndarray) -> tuple[np.ndarray, float]:
        """Build a conservative grid from onset intervals when beat tracking fails."""
        if onset_times.size < self.min_onsets:
            return np.array([], dtype=np.float32), 0.0

        ioi = np.diff(onset_times)
        ioi = ioi[(ioi >= 0.055) & (ioi <= 1.2)]
        if ioi.size < 6:
            return np.array([], dtype=np.float32), 0.0

        base_values = np.percentile(ioi, [20, 35, 50, 65, 80])
        candidate_steps = set()
        for base in base_values:
            for div in (1, 2, 3, 4):
                step = float(base) / float(div)
                if 0.055 <= step <= 0.35:
                    candidate_steps.add(round(step, 5))

        if not candidate_steps:
            return np.array([], dtype=np.float32), 0.0

        best_grid = np.array([], dtype=np.float32)
        best_step = 0.0
        best_error = float("inf")
        start = float(onset_times[0])
        stop = float(onset_times[-1])

        for step in sorted(candidate_steps):
            grid = np.arange(start - 2.0 * step, stop + 2.0 * step, step, dtype=np.float32)
            offsets = self._offsets_to_grid(onset_times, grid)
            if offsets.size == 0:
                continue
            abs_offsets = np.abs(offsets)
            median_error = float(np.median(abs_offsets))
            small_step_penalty = max(0.0, 0.080 - step) * 0.25
            error = median_error + small_step_penalty
            if error < best_error:
                best_error = error
                best_grid = grid
                best_step = float(step)

        if best_grid.size < 4:
            return np.array([], dtype=np.float32), 0.0

        beat_period = best_step * 4.0
        tempo_bpm = 60.0 / beat_period if beat_period > 0 else 0.0
        return best_grid.astype(np.float32), float(tempo_bpm)

    @staticmethod
    def _offsets_to_grid(onset_times: np.ndarray, grid: np.ndarray) -> np.ndarray:
        if grid.size < 2 or onset_times.size == 0:
            return np.array([], dtype=np.float32)

        idx = np.searchsorted(grid, onset_times)
        left_idx = np.clip(idx - 1, 0, grid.size - 1)
        right_idx = np.clip(idx, 0, grid.size - 1)

        left_diff = onset_times - grid[left_idx]
        right_diff = onset_times - grid[right_idx]
        use_left = np.abs(left_diff) <= np.abs(right_diff)
        return np.where(use_left, left_diff, right_diff).astype(np.float32)

    def _ioi_metrics(self, onset_times: np.ndarray) -> dict:
        ioi = np.diff(onset_times)
        ioi = ioi[(ioi >= 0.035) & (ioi <= 1.8)]
        if ioi.size < 6:
            return {
                "events_used": int(ioi.size),
                "ioi_cv": 0.5,
                "ioi_mad_ms": 50.0,
                "ioi_lognormal_ks": 0.5,
                "ioi_normal_ks": 0.5,
                "ioi_uniform_ks": 0.5,
            }

        ioi = ioi.astype(np.float64)
        ioi_cv = self._coefficient_of_variation(ioi)
        ioi_mad_ms = float(np.median(np.abs(ioi - np.median(ioi))) * 1000.0)
        lognormal_ks, normal_ks, uniform_ks = self._distribution_ks(ioi)

        return {
            "events_used": int(ioi.size),
            "ioi_cv": float(ioi_cv),
            "ioi_mad_ms": ioi_mad_ms,
            "ioi_lognormal_ks": lognormal_ks,
            "ioi_normal_ks": normal_ks,
            "ioi_uniform_ks": uniform_ks,
        }

    def _distribution_ks(self, ioi: np.ndarray) -> tuple[float, float, float]:
        try:
            shape, loc, scale = stats.lognorm.fit(ioi, floc=0.0)
            lognormal_ks = float(stats.kstest(ioi, "lognorm", args=(shape, loc, scale)).statistic)
        except Exception:
            lognormal_ks = 0.5

        try:
            mean = float(np.mean(ioi))
            std = float(np.std(ioi) + 1e-8)
            normal_ks = float(stats.kstest(ioi, "norm", args=(mean, std)).statistic)
        except Exception:
            normal_ks = 0.5

        try:
            low = float(np.min(ioi))
            width = float(np.max(ioi) - low + 1e-8)
            uniform_ks = float(stats.kstest(ioi, "uniform", args=(low, width)).statistic)
        except Exception:
            uniform_ks = 0.5

        return lognormal_ks, normal_ks, uniform_ks

    def _distribution_score(
        self,
        lognormal_ks: float,
        normal_ks: float,
        uniform_ks: float,
        event_count: int,
    ) -> float:
        if event_count < 12:
            return 0.5
        best_ai_like = min(normal_ks, uniform_ks)
        lognormal_advantage = best_ai_like - lognormal_ks
        return self._scale(-lognormal_advantage, low=-0.06, high=0.12)

    @staticmethod
    def _hist_entropy(values: np.ndarray, bins: int, clip_range: tuple[float, float]) -> float:
        clipped = np.clip(values, clip_range[0], clip_range[1])
        counts, _ = np.histogram(clipped, bins=bins, range=clip_range)
        total = int(np.sum(counts))
        if total <= 0:
            return 0.0
        probs = counts[counts > 0] / float(total)
        return float(-np.sum(probs * np.log2(probs + 1e-12)))

    @staticmethod
    def _coefficient_of_variation(values: np.ndarray) -> float:
        if values.size == 0:
            return 0.5
        return float(np.std(values) / (np.mean(values) + 1e-8))

    @staticmethod
    def _rms(y: np.ndarray) -> float:
        if y.size == 0:
            return 0.0
        return float(np.sqrt(np.mean(np.square(y))))

    @staticmethod
    def _scale(value: float, low: float, high: float) -> float:
        if high <= low:
            return 0.5
        if value <= low:
            return 0.0
        if value >= high:
            return 1.0
        return float((value - low) / (high - low))

    @staticmethod
    def _scale_inverse(value: float, low: float, high: float) -> float:
        if high <= low:
            return 0.5
        if value <= low:
            return 1.0
        if value >= high:
            return 0.0
        return float(1.0 - (value - low) / (high - low))
