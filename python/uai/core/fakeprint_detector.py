"""
FakePrint detector following Deezer's ISMIR 2025 public reference code.

Reference implementation:
https://github.com/deezer/ismir25-ai-music-detector/blob/main/compute_fakeprints.py
"""

from dataclasses import dataclass, field
from typing import Optional

import librosa
import numpy as np
from scipy import interpolate, signal


@dataclass
class FakePrintResult:
    """Result from FakePrint analysis."""

    score: float  # 0 = likely human, 1 = likely AI
    confidence: float
    residue_energy: float
    residue_p95: float
    periodicity_score: float = 0.0
    fakeprint_vector: Optional[np.ndarray] = None
    frequencies: Optional[np.ndarray] = None
    avg_power_db: Optional[np.ndarray] = None
    lower_hull_db: Optional[np.ndarray] = None
    residues_db: Optional[np.ndarray] = None
    periodicity_spectrum: Optional[np.ndarray] = None
    periodicity_peak_bins: list = field(default_factory=list)
    anomalies: list = field(default_factory=list)


class FakePrintDetector:
    """
    Training-free FakePrint detector.

    Implements the "fakeprint" extraction path from Deezer's public code:
    - high-resolution spectrogram
    - average log-power spectrum
    - lower hull interpolation from local minima
    - residue profile as fakeprint vector
    """

    def __init__(
        self,
        sr: int = 44100,
        n_fft: int = 32768,
        hop_length: Optional[int] = None,
        fmin: float = 5000.0,
        fmax: float = 16000.0,
        hull_area: int = 10,
        min_hull_db: float = -45.0,
        residue_clip_db: float = 5.0,
        peak_sigma: float = 1.5,
    ):
        self.sr = sr
        self.n_fft = n_fft
        self.hop_length = hop_length if hop_length is not None else (n_fft // 2)
        self.fmin = float(fmin)
        self.fmax = float(fmax)
        self.hull_area = max(3, int(hull_area))
        self.min_hull_db = float(min_hull_db)
        self.residue_clip_db = float(residue_clip_db)
        self.peak_sigma = float(peak_sigma)

    def _lower_hull(self, values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """
        Deezer-style lower-hull control points:
        collect local minima in sliding windows (`area`) and interpolate later.
        """
        if values.size == 0:
            return np.array([], dtype=int), np.array([], dtype=float)
        if values.size == 1:
            return np.array([0], dtype=int), values.astype(np.float64)

        area = min(self.hull_area, values.size)
        idx = []
        hull = []
        seen = set()

        for i in range(values.size - area + 1):
            patch = values[i : i + area]
            rel_idx = int(np.argmin(patch))
            abs_idx = rel_idx + i
            if abs_idx in seen:
                continue
            seen.add(abs_idx)
            idx.append(abs_idx)
            hull.append(float(patch[rel_idx]))

        if not idx:
            idx = [0, values.size - 1]
            hull = [float(values[0]), float(values[-1])]
        else:
            if idx[0] != 0:
                idx.insert(0, 0)
                hull.insert(0, float(values[0]))
            if idx[-1] != values.size - 1:
                idx.append(values.size - 1)
                hull.append(float(values[-1]))

        return np.asarray(idx, dtype=int), np.asarray(hull, dtype=np.float64)

    def _curve_profile(
        self,
        frequencies: np.ndarray,
        avg_power_db: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """Replicates Deezer's `curve_profile` and `max_normalise` extraction."""
        mask = (frequencies > self.fmin) & (frequencies < self.fmax)

        if not np.any(mask):
            # Fallback to full band if the requested range is invalid for the SR.
            x_band = frequencies
            c_band = avg_power_db
        else:
            x_band = frequencies[mask]
            c_band = avg_power_db[mask]

        hull_idx, hull_vals = self._lower_hull(c_band)

        interp_kind = "quadratic" if hull_idx.size >= 3 else "linear"
        low_hull_curve = interpolate.interp1d(
            x_band[hull_idx],
            hull_vals,
            kind=interp_kind,
            fill_value="extrapolate",
        )(x_band)
        low_hull_curve = np.clip(low_hull_curve, self.min_hull_db, None)

        residues_db = np.clip(c_band - low_hull_curve, 0.0, None)

        fp_curve = np.clip(residues_db, 0.0, self.residue_clip_db)
        fakeprint_vector = fp_curve / (1e-6 + np.max(fp_curve))

        return x_band, c_band, low_hull_curve, residues_db, fakeprint_vector

    def _periodicity_score(self, fakeprint_vector: np.ndarray) -> tuple[float, np.ndarray, np.ndarray]:
        """
        Score periodic structure in the residue profile.
        AI generators tend to produce quasi-regular residue patterns.
        """
        if fakeprint_vector.size < 16:
            return 0.0, np.array([]), np.array([])

        centered = fakeprint_vector.astype(np.float64) - float(np.mean(fakeprint_vector))
        periodicity_spectrum = np.abs(np.fft.rfft(centered))
        if periodicity_spectrum.size <= 2:
            return 0.0, np.array([]), periodicity_spectrum

        periodicity_spectrum = periodicity_spectrum[1:]  # remove DC
        max_val = float(np.max(periodicity_spectrum))
        if max_val <= 1e-12:
            return 0.0, np.array([]), periodicity_spectrum

        periodicity_spectrum = periodicity_spectrum / max_val
        threshold = float(np.mean(periodicity_spectrum) + self.peak_sigma * np.std(periodicity_spectrum))

        peaks, props = signal.find_peaks(
            periodicity_spectrum,
            height=threshold,
            prominence=0.05,
            distance=2,
        )
        if peaks.size == 0:
            return 0.0, peaks, periodicity_spectrum

        peak_magnitudes = props.get("peak_heights", periodicity_spectrum[peaks])
        peak_count_factor = min(float(peaks.size) / 10.0, 1.0)
        peak_strength = float(np.clip(np.mean(peak_magnitudes), 0.0, 1.0))

        if peaks.size >= 3:
            spacing = np.diff(peaks)
            spacing_cv = float(np.std(spacing) / (np.mean(spacing) + 1e-8))
            spacing_score = float(np.clip(1.0 - spacing_cv, 0.0, 1.0))
        else:
            spacing_score = 0.0

        periodicity = np.clip(
            0.45 * peak_count_factor + 0.35 * peak_strength + 0.20 * spacing_score,
            0.0,
            1.0,
        )
        return float(periodicity), peaks, periodicity_spectrum

    def analyze(self, audio_path: str) -> FakePrintResult:
        """Run Deezer-style fakeprint extraction + periodic-residue scoring."""
        y, sr = librosa.load(audio_path, sr=self.sr, mono=True)
        if y.size == 0:
            return FakePrintResult(
                score=0.5,
                confidence=0.0,
                residue_energy=0.0,
                residue_p95=0.0,
                anomalies=["Audio appears empty; FakePrint skipped"],
            )

        if y.size < self.n_fft:
            y = np.pad(y, (0, self.n_fft - y.size))

        spec = librosa.stft(
            y,
            n_fft=self.n_fft,
            hop_length=self.hop_length,
            win_length=self.n_fft,
            window="hann",
        )

        power = np.abs(spec) ** 2
        power_db = 10.0 * np.log10(np.clip(power, 1e-10, 1e6))
        avg_power_db_full = np.mean(power_db, axis=1)
        freqs_full = np.linspace(0.0, sr / 2.0, num=avg_power_db_full.size, dtype=np.float64)

        freqs, avg_power_db, lower_hull_db, residues_db, fakeprint_vector = self._curve_profile(
            frequencies=freqs_full,
            avg_power_db=avg_power_db_full,
        )

        residue_energy = float(np.mean(residues_db))
        residue_p95 = float(np.percentile(residues_db, 95))
        clipped_energy_norm = float(
            np.mean(np.clip(residues_db, 0.0, self.residue_clip_db)) / max(self.residue_clip_db, 1e-6)
        )

        periodicity, peak_bins, periodicity_spectrum = self._periodicity_score(fakeprint_vector)

        # Final score: prioritize periodic residue evidence, then residue energy.
        p95_norm = float(np.clip(residue_p95 / (2.0 * max(self.residue_clip_db, 1e-6)), 0.0, 1.0))
        score = float(np.clip(0.55 * periodicity + 0.35 * clipped_energy_norm + 0.10 * p95_norm, 0.0, 1.0))

        confidence = float(
            np.clip(
                0.55 * abs(score - 0.5) * 2.0
                + 0.25 * periodicity
                + 0.20 * min(len(peak_bins) / 8.0, 1.0),
                0.0,
                1.0,
            )
        )

        anomalies = []
        if periodicity > 0.55 and len(peak_bins) >= 3:
            anomalies.append(
                "FakePrint periodic residue pattern detected "
                f"(periodicity={periodicity:.2f}, peaks={len(peak_bins)})"
            )
        if score > 0.6:
            anomalies.append(
                f"FakePrint residue energy high ({residue_energy:.2f}dB, p95={residue_p95:.2f}dB)"
            )
        elif score < 0.4 and periodicity < 0.35:
            anomalies.append(
                "FakePrint residue appears weak/non-periodic "
                f"(energy={residue_energy:.2f}dB, periodicity={periodicity:.2f})"
            )

        return FakePrintResult(
            score=score,
            confidence=confidence,
            residue_energy=residue_energy,
            residue_p95=residue_p95,
            periodicity_score=periodicity,
            fakeprint_vector=fakeprint_vector,
            frequencies=freqs,
            avg_power_db=avg_power_db,
            lower_hull_db=lower_hull_db,
            residues_db=residues_db,
            periodicity_spectrum=periodicity_spectrum,
            periodicity_peak_bins=peak_bins.astype(int).tolist(),
            anomalies=anomalies,
        )
