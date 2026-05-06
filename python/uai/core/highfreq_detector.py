"""
High-frequency cutoff detector for AI instrumental analysis.

Detects brick-wall high-frequency behavior often seen in synthetic generators:
- sharp cutoff around ~16-18kHz
- large energy drop from 15-17kHz to 17-20kHz
- steep negative spectral gradients in the high band
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

import librosa
import numpy as np
from scipy import signal


@dataclass
class HighFreqResult:
    """Result from high-frequency cutoff analysis."""

    score: float  # 0 = likely human, 1 = likely AI
    confidence: float
    cutoff_frequency_hz: float
    steepest_gradient_db_per_khz: float
    rolloff_slope_db_per_khz: float
    band_energy_15_17_db: float
    band_energy_17_20_db: float
    band_energy_ratio_db: float
    sharp_cutoff_detected: bool
    frequencies: Optional[np.ndarray] = None
    spectrum_db: Optional[np.ndarray] = None
    smoothed_spectrum_db: Optional[np.ndarray] = None
    anomalies: List[str] = field(default_factory=list)


class HighFrequencyDetector:
    """
    Detect unnatural high-frequency cliffs in audio spectra.

    This detector requires high sample rate loading (44.1kHz+), then computes
    high-band energy ratios and the steepest high-frequency spectral gradient.
    """

    def __init__(
        self,
        sr: int = 48000,
        max_duration: float = 90.0,
        n_fft: int = 16384,
        hop_length: int = 1024,
        smoothing_window: int = 41,
    ):
        self.sr = 48000 if int(sr) >= 48000 else 44100
        self.max_duration = float(max_duration)
        self.n_fft = int(n_fft)
        self.hop_length = int(hop_length)
        self.smoothing_window = int(smoothing_window)

    def analyze(self, audio_path: str) -> HighFreqResult:
        """Analyze high-frequency cutoff behavior and return AI-likelihood score."""

        y, sr = librosa.load(
            audio_path,
            sr=self.sr,
            mono=True,
            duration=self.max_duration if self.max_duration > 0 else None,
        )

        if y.size == 0:
            return HighFreqResult(
                score=0.5,
                confidence=0.0,
                cutoff_frequency_hz=0.0,
                steepest_gradient_db_per_khz=0.0,
                rolloff_slope_db_per_khz=0.0,
                band_energy_15_17_db=-120.0,
                band_energy_17_20_db=-120.0,
                band_energy_ratio_db=0.0,
                sharp_cutoff_detected=False,
                anomalies=["Audio appears empty; high-frequency detector skipped"],
            )

        nyquist = sr / 2.0
        if nyquist < 20000.0:
            return HighFreqResult(
                score=0.5,
                confidence=0.1,
                cutoff_frequency_hz=nyquist,
                steepest_gradient_db_per_khz=0.0,
                rolloff_slope_db_per_khz=0.0,
                band_energy_15_17_db=-120.0,
                band_energy_17_20_db=-120.0,
                band_energy_ratio_db=0.0,
                sharp_cutoff_detected=False,
                anomalies=[f"Nyquist ({nyquist:.0f}Hz) is too low for 20kHz analysis"],
            )

        spec = np.abs(librosa.stft(y, n_fft=self.n_fft, hop_length=self.hop_length)) ** 2
        avg_power = np.mean(spec, axis=1)
        freqs = librosa.fft_frequencies(sr=sr, n_fft=self.n_fft)

        spectrum_db = librosa.power_to_db(avg_power + 1e-12)
        smoothed_db = self._smooth_spectrum(spectrum_db)

        band_15_17 = self._band_mean_db(freqs, smoothed_db, 15000.0, min(17000.0, nyquist * 0.98))
        band_17_20 = self._band_mean_db(freqs, smoothed_db, 17000.0, min(20000.0, nyquist * 0.98))
        band_ratio = float(band_15_17 - band_17_20)

        gradient = np.gradient(smoothed_db, freqs + 1e-8) * 1000.0  # dB/kHz
        focus_mask = (freqs >= 14000.0) & (freqs <= min(20500.0, nyquist * 0.98))

        if np.any(focus_mask):
            grad_focus = gradient[focus_mask]
            freq_focus = freqs[focus_mask]
            min_idx = int(np.argmin(grad_focus))
            steepest_grad = float(grad_focus[min_idx])
            cutoff_hz = float(freq_focus[min_idx])

            x = freq_focus / 1000.0
            y_fit = smoothed_db[focus_mask]
            if x.size >= 2:
                rolloff_slope = float(np.polyfit(x, y_fit, 1)[0])
            else:
                rolloff_slope = 0.0
        else:
            steepest_grad = 0.0
            cutoff_hz = 0.0
            rolloff_slope = 0.0

        ratio_score = float(np.clip((band_ratio - 6.0) / 18.0, 0.0, 1.0))
        steep_score = float(np.clip((abs(steepest_grad) - 8.0) / 22.0, 0.0, 1.0))
        cutoff_score = self._cutoff_score(cutoff_hz)

        score = 0.40 * steep_score + 0.35 * cutoff_score + 0.25 * ratio_score

        sharp_cutoff = bool(
            cutoff_hz > 0.0
            and cutoff_hz < 19000.0
            and abs(steepest_grad) > 14.0
            and band_ratio > 8.0
        )

        # Confidence down-weights low HF material where cutoff estimates are noisy.
        hf_presence = self._band_mean_db(freqs, smoothed_db, 10000.0, min(15000.0, nyquist * 0.98))
        hf_presence_score = float(np.clip((hf_presence + 85.0) / 35.0, 0.0, 1.0))
        decisiveness = abs(score - 0.5) * 2.0
        confidence = float(np.clip(0.45 * decisiveness + 0.35 * hf_presence_score + 0.20 * (1.0 if cutoff_hz > 0 else 0.0), 0.0, 1.0))

        anomalies: List[str] = []
        if sharp_cutoff:
            anomalies.append(
                "Sharp high-frequency cutoff detected "
                f"(~{cutoff_hz:.0f}Hz, gradient={steepest_grad:.1f}dB/kHz)"
            )
        if band_ratio > 10.0:
            anomalies.append(
                "High-band energy cliff: 15-17kHz exceeds 17-20kHz by "
                f"{band_ratio:.1f}dB"
            )

        return HighFreqResult(
            score=float(np.clip(score, 0.0, 1.0)),
            confidence=confidence,
            cutoff_frequency_hz=cutoff_hz,
            steepest_gradient_db_per_khz=steepest_grad,
            rolloff_slope_db_per_khz=rolloff_slope,
            band_energy_15_17_db=float(band_15_17),
            band_energy_17_20_db=float(band_17_20),
            band_energy_ratio_db=band_ratio,
            sharp_cutoff_detected=sharp_cutoff,
            frequencies=freqs,
            spectrum_db=spectrum_db,
            smoothed_spectrum_db=smoothed_db,
            anomalies=anomalies,
        )

    def _smooth_spectrum(self, spectrum_db: np.ndarray) -> np.ndarray:
        """Smooth the mean spectrum to stabilize gradient-based cutoff detection."""

        window = self.smoothing_window
        if spectrum_db.size < 9:
            return spectrum_db.astype(np.float64)

        if window >= spectrum_db.size:
            window = spectrum_db.size - 1
        if window % 2 == 0:
            window -= 1
        if window < 7:
            window = 7
        if window >= spectrum_db.size:
            window = spectrum_db.size - 1 if spectrum_db.size % 2 == 0 else spectrum_db.size

        try:
            return signal.savgol_filter(spectrum_db.astype(np.float64), window_length=window, polyorder=3)
        except ValueError:
            return spectrum_db.astype(np.float64)

    @staticmethod
    def _band_mean_db(freqs: np.ndarray, spec_db: np.ndarray, low_hz: float, high_hz: float) -> float:
        """Mean dB level in a frequency band."""

        if high_hz <= low_hz:
            return -120.0
        mask = (freqs >= low_hz) & (freqs < high_hz)
        if not np.any(mask):
            return -120.0
        return float(np.mean(spec_db[mask]))

    @staticmethod
    def _cutoff_score(cutoff_hz: float) -> float:
        """Map detected cutoff frequency to AI-likelihood contribution."""

        if cutoff_hz <= 0:
            return 0.3
        if cutoff_hz < 16000.0:
            return 0.98
        if cutoff_hz < 17000.0:
            return 0.90
        if cutoff_hz < 18000.0:
            return 0.75
        if cutoff_hz < 19000.0:
            return 0.55
        if cutoff_hz < 20000.0:
            return 0.30
        return 0.12
