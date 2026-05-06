"""
Stereo phase anomaly detector for AI instrumental analysis.

Analyzes stereo phase coherence and phase entropy in high-frequency bands.
AI-generated content often collapses into either hyper-coherent or incoherent
phase behavior, especially above ~4kHz.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import librosa
import numpy as np
from scipy import signal


@dataclass
class PhaseResult:
    """Result from stereo phase analysis."""

    score: float  # 0 = likely human, 1 = likely AI
    confidence: float
    stereo_present: bool
    mean_coherence: float
    mean_entropy: float
    coherence_entropy_corr: float
    scatter_score: float
    extreme_band_count: int
    band_metrics: Dict[str, Dict[str, float]] = field(default_factory=dict)
    anomalies: List[str] = field(default_factory=list)


class PhaseDetector:
    """
    Detect AI artifacts via stereo phase behavior across high-frequency bands.

    Per band:
    - Instantaneous phase via Hilbert transform
    - Inter-channel phase coherence (PLV)
    - Phase entropy

    AI anomaly patterns:
    - Hyper coherence + very low entropy (phase-locked synthetic stereo)
    - Very low coherence + very high entropy (decorrelated pseudo-stereo)
    """

    def __init__(
        self,
        sr: int = 44100,
        max_duration: float = 90.0,
        phase_bins: int = 48,
        filter_order: int = 4,
    ):
        self.sr = max(44100, int(sr))
        self.max_duration = float(max_duration)
        self.phase_bins = int(phase_bins)
        self.filter_order = int(filter_order)

        self.bands: List[Tuple[float, float]] = [
            (4000.0, 6000.0),
            (6000.0, 8000.0),
            (8000.0, 11000.0),
            (11000.0, 14000.0),
            (14000.0, 17000.0),
            (17000.0, 20000.0),
        ]

    def analyze(self, audio_path: str) -> PhaseResult:
        """Analyze stereo phase coherence/entropy anomalies."""

        y, _ = librosa.load(
            audio_path,
            sr=self.sr,
            mono=False,
            duration=self.max_duration if self.max_duration > 0 else None,
        )

        if y.ndim == 1:
            return PhaseResult(
                score=0.5,
                confidence=0.0,
                stereo_present=False,
                mean_coherence=0.0,
                mean_entropy=0.0,
                coherence_entropy_corr=0.0,
                scatter_score=0.5,
                extreme_band_count=0,
                anomalies=["Mono audio; stereo phase analysis skipped"],
            )

        if y.shape[0] < 2:
            return PhaseResult(
                score=0.5,
                confidence=0.0,
                stereo_present=False,
                mean_coherence=0.0,
                mean_entropy=0.0,
                coherence_entropy_corr=0.0,
                scatter_score=0.5,
                extreme_band_count=0,
                anomalies=["Insufficient channels for stereo phase analysis"],
            )

        left = y[0].astype(np.float64)
        right = y[1].astype(np.float64)

        band_metrics: Dict[str, Dict[str, float]] = {}
        coherence_values: List[float] = []
        entropy_values: List[float] = []
        band_anomaly_values: List[float] = []

        nyquist = self.sr / 2.0

        for low, high in self.bands:
            band_high = min(high, nyquist * 0.98)
            if band_high <= low * 1.01:
                continue

            left_band = self._bandpass(left, low, band_high)
            right_band = self._bandpass(right, low, band_high)
            if left_band is None or right_band is None:
                continue

            # Ignore near-silent bands.
            energy_l = float(np.sqrt(np.mean(left_band * left_band) + 1e-12))
            energy_r = float(np.sqrt(np.mean(right_band * right_band) + 1e-12))
            if max(energy_l, energy_r) < 1e-5:
                continue

            left_phase = np.angle(signal.hilbert(left_band))
            right_phase = np.angle(signal.hilbert(right_band))
            phase_diff = np.angle(np.exp(1j * (left_phase - right_phase)))

            coherence = float(np.abs(np.mean(np.exp(1j * phase_diff))))
            entropy = float(self._phase_entropy(phase_diff))

            band_key = f"{int(low)}-{int(band_high)}Hz"
            band_metrics[band_key] = {
                "coherence": coherence,
                "entropy": entropy,
                "rms_left": energy_l,
                "rms_right": energy_r,
            }

            coherence_values.append(coherence)
            entropy_values.append(entropy)
            band_anomaly_values.append(self._band_anomaly_score(coherence, entropy))

        if len(coherence_values) < 2:
            return PhaseResult(
                score=0.5,
                confidence=0.1,
                stereo_present=True,
                mean_coherence=0.0,
                mean_entropy=0.0,
                coherence_entropy_corr=0.0,
                scatter_score=0.5,
                extreme_band_count=0,
                band_metrics=band_metrics,
                anomalies=["Not enough high-frequency stereo content for phase analysis"],
            )

        coh = np.array(coherence_values, dtype=np.float64)
        ent = np.array(entropy_values, dtype=np.float64)

        mean_coherence = float(np.mean(coh))
        mean_entropy = float(np.mean(ent))

        # Deviation from broad human-like centroid in (coherence, entropy) space.
        deviation = np.sqrt(((coh - 0.58) / 0.22) ** 2 + ((ent - 0.62) / 0.18) ** 2)
        deviation_score = float(np.clip(np.mean(deviation) / 2.4, 0.0, 1.0))

        hyper_mask = (coh > 0.90) & (ent < 0.35)
        incoherent_mask = (coh < 0.20) & (ent > 0.85)
        extreme_count = int(np.sum(hyper_mask) + np.sum(incoherent_mask))
        extreme_score = float(np.clip(extreme_count / 2.0, 0.0, 1.0))

        coh_std = float(np.std(coh))
        ent_std = float(np.std(ent))
        scatter_score = 0.5 * self._spread_anomaly(coh_std, low=0.05, high=0.30) + 0.5 * self._spread_anomaly(ent_std, low=0.05, high=0.26)

        if len(coh) >= 3:
            corr = float(np.corrcoef(coh, ent)[0, 1])
            if not np.isfinite(corr):
                corr = 0.0
        else:
            corr = 0.0

        relation_score = float(np.clip(abs(corr + 0.45) / 1.45, 0.0, 1.0))

        score = (
            0.45 * deviation_score
            + 0.25 * extreme_score
            + 0.20 * scatter_score
            + 0.10 * relation_score
        )

        coverage = len(coh) / float(len(self.bands))
        decisiveness = abs(score - 0.5) * 2.0
        band_agreement = 1.0 - min(np.std(band_anomaly_values) * 1.8, 1.0)
        confidence = float(np.clip(0.45 * coverage + 0.30 * decisiveness + 0.25 * band_agreement, 0.0, 1.0))

        anomalies: List[str] = []
        if extreme_count > 0:
            anomalies.append(
                "Stereo phase extremes detected in high bands "
                f"(hyper/incoherent bands={extreme_count})"
            )
        if score > 0.62:
            anomalies.append(
                "Phase coherence/entropy pattern deviates from natural stereo "
                f"(coh={mean_coherence:.2f}, entropy={mean_entropy:.2f})"
            )

        return PhaseResult(
            score=float(np.clip(score, 0.0, 1.0)),
            confidence=confidence,
            stereo_present=True,
            mean_coherence=mean_coherence,
            mean_entropy=mean_entropy,
            coherence_entropy_corr=corr,
            scatter_score=float(np.clip(scatter_score, 0.0, 1.0)),
            extreme_band_count=extreme_count,
            band_metrics=band_metrics,
            anomalies=anomalies,
        )

    def _bandpass(self, y: np.ndarray, low_hz: float, high_hz: float) -> Optional[np.ndarray]:
        """Band-pass filter helper for phase analysis."""

        nyquist = self.sr / 2.0
        low = max(20.0, float(low_hz))
        high = min(float(high_hz), nyquist * 0.98)
        if high <= low * 1.01:
            return None

        sos = signal.butter(
            self.filter_order,
            [low / nyquist, high / nyquist],
            btype="bandpass",
            output="sos",
        )

        try:
            return signal.sosfiltfilt(sos, y)
        except ValueError:
            # Very short clips may fail with filtfilt padding.
            return signal.sosfilt(sos, y)

    def _phase_entropy(self, phase_diff: np.ndarray) -> float:
        """Normalized Shannon entropy of phase-difference histogram."""

        hist, _ = np.histogram(
            phase_diff,
            bins=self.phase_bins,
            range=(-np.pi, np.pi),
            density=False,
        )
        total = float(np.sum(hist))
        if total <= 0:
            return 0.0

        probs = hist.astype(np.float64) / total
        probs = probs[probs > 0]
        if probs.size == 0:
            return 0.0

        entropy = -np.sum(probs * np.log(probs + 1e-12))
        return float(entropy / np.log(self.phase_bins))

    @staticmethod
    def _band_anomaly_score(coherence: float, entropy: float) -> float:
        """Per-band anomaly score in coherence-entropy space."""

        dev = np.sqrt(((coherence - 0.58) / 0.22) ** 2 + ((entropy - 0.62) / 0.18) ** 2)
        dev_score = float(np.clip(dev / 2.4, 0.0, 1.0))

        extreme = 0.0
        if coherence > 0.90 and entropy < 0.35:
            extreme = 1.0
        elif coherence < 0.20 and entropy > 0.85:
            extreme = 1.0

        return float(np.clip(0.7 * dev_score + 0.3 * extreme, 0.0, 1.0))

    @staticmethod
    def _spread_anomaly(value: float, low: float, high: float) -> float:
        """Flag both too-little and too-much spread as anomalous."""

        if value < low:
            return float(np.clip((low - value) / max(low, 1e-8), 0.0, 1.0))
        if value > high:
            return float(np.clip((value - high) / max(0.5 - high, 1e-8), 0.0, 1.0))
        return 0.0
