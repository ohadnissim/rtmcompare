"""
Fourier-based AI Music Detector

Based on the Deezer ISMIR 2025 Best Paper finding that deconvolution modules
in generative models produce systematic "checkerboard" spectral artifacts.
These are periodic peaks in the frequency domain caused by the model architecture,
not the training data — making them a reliable, training-free signal.

No ML training needed — pure signal processing.
"""

from dataclasses import dataclass, field
from typing import Optional

import librosa
import numpy as np
from scipy import signal
from scipy.fft import fft, fftfreq


@dataclass
class FourierResult:
    """Result from Fourier artifact analysis."""

    score: float  # 0 = definitely human, 1 = definitely AI
    confidence: float  # How confident we are in the score
    artifacts_found: list = field(default_factory=list)
    artifact_frequencies: list = field(default_factory=list)
    artifact_magnitudes: list = field(default_factory=list)
    fft_frequencies: Optional[np.ndarray] = None
    fft_magnitudes: Optional[np.ndarray] = None
    highfreq_dropoff_hz: float = 0.0
    highfreq_score: float = 0.0

    def __post_init__(self):
        if self.artifacts_found is None:
            self.artifacts_found = []
        if self.artifact_frequencies is None:
            self.artifact_frequencies = []
        if self.artifact_magnitudes is None:
            self.artifact_magnitudes = []


class FourierDetector:
    """
    Detects AI-generated music by analyzing frequency-domain artifacts.

    Two main detection methods:
    1. Checkerboard artifact detection — periodic spectral peaks caused by
       transposed-convolution upsampling.
    2. High-frequency dropoff analysis — many generators show sharp energy
       cliffs above ~16kHz.
    """

    def __init__(
        self,
        sr: int = 22050,
        highfreq_sr: int = 44100,
        n_fft: int = 4096,
        hop_length: int = 512,
        artifact_threshold: float = 2.5,
        highfreq_cutoff: float = 16000.0,
        min_artifact_peaks: int = 3,
    ):
        self.sr = sr
        self.highfreq_sr = highfreq_sr
        self.n_fft = n_fft
        self.hop_length = hop_length
        self.artifact_threshold = artifact_threshold
        self.highfreq_cutoff = highfreq_cutoff
        self.min_artifact_peaks = min_artifact_peaks

    def analyze(self, audio_path: str) -> FourierResult:
        """
        Analyze an audio file for AI generation artifacts.

        Loads audio twice intentionally:
        - checkerboard pass at `self.sr` (fast and stable)
        - high-frequency pass at `self.highfreq_sr` to preserve >16kHz content
        """
        # Checkerboard analysis pass
        y_checker, sr_checker = librosa.load(audio_path, sr=self.sr, mono=True)

        # High-frequency analysis pass (fixes Nyquist bug for 16kHz detection)
        target_hf_sr = max(self.highfreq_sr, int(self.highfreq_cutoff * 2 + 1000))
        y_hf, sr_hf = librosa.load(audio_path, sr=target_hf_sr, mono=True)

        checkerboard_result = self._detect_checkerboard_artifacts(y_checker, sr_checker)
        highfreq_result = self._detect_highfreq_dropoff(y_hf, sr_hf)

        # Combine scores
        # Checkerboard is the stronger signal (architecturally inherent)
        combined_score = 0.65 * checkerboard_result["score"] + 0.35 * highfreq_result["score"]

        # Confidence is higher when both detectors agree
        agreement = 1.0 - abs(checkerboard_result["score"] - highfreq_result["score"])
        confidence = 0.5 + 0.5 * agreement

        artifacts_found = checkerboard_result["artifacts"] + highfreq_result["artifacts"]

        return FourierResult(
            score=float(np.clip(combined_score, 0, 1)),
            confidence=float(confidence),
            artifacts_found=artifacts_found,
            artifact_frequencies=checkerboard_result["peak_frequencies"],
            artifact_magnitudes=checkerboard_result["peak_magnitudes"],
            fft_frequencies=checkerboard_result["fft_freqs"],
            fft_magnitudes=checkerboard_result["fft_mags"],
            highfreq_dropoff_hz=highfreq_result["dropoff_hz"],
            highfreq_score=highfreq_result["score"],
        )

    def _detect_checkerboard_artifacts(self, y: np.ndarray, sr: int) -> dict:
        """
        Detect periodic spectral peaks caused by deconvolution layers.

        The key insight from Deezer's paper: neural audio generators use
        transposed convolutions for upsampling, which can create periodic
        artifacts in the spectral envelope.
        """
        # Compute STFT magnitude
        spec = np.abs(librosa.stft(y, n_fft=self.n_fft, hop_length=self.hop_length))

        # Average spectral envelope across time
        spectral_envelope = np.mean(spec, axis=1)

        # Compute "spectrum of the spectrum" to reveal periodicity
        log_envelope = np.log1p(spectral_envelope)
        log_envelope = log_envelope - np.mean(log_envelope)

        n = len(log_envelope)
        envelope_fft = np.abs(fft(log_envelope))[: n // 2]
        envelope_freqs = fftfreq(n, d=1.0)[: n // 2]

        if np.max(envelope_fft) > 0:
            envelope_fft_norm = envelope_fft / np.max(envelope_fft)
        else:
            envelope_fft_norm = envelope_fft

        mean_level = np.mean(envelope_fft_norm)
        std_level = np.std(envelope_fft_norm)
        threshold = mean_level + self.artifact_threshold * std_level

        peaks, _ = signal.find_peaks(
            envelope_fft_norm,
            height=threshold,
            distance=3,
            prominence=0.05,
        )

        periodic_score = 0.0
        peak_frequencies = []
        peak_magnitudes = []

        if len(peaks) >= self.min_artifact_peaks:
            peak_frequencies = envelope_freqs[peaks].tolist()
            peak_magnitudes = envelope_fft_norm[peaks].tolist()

            if len(peaks) >= 3:
                spacings = np.diff(peaks)
                spacing_cv = np.std(spacings) / (np.mean(spacings) + 1e-8)
                periodic_score = np.clip(1.0 - spacing_cv, 0, 1)

                peak_count_factor = min(len(peaks) / 10.0, 1.0)
                avg_magnitude = np.mean(peak_magnitudes)
                periodic_score *= peak_count_factor * (0.5 + avg_magnitude)

        artifacts = []
        if periodic_score > 0.3:
            artifacts.append(
                f"Checkerboard artifacts: {len(peaks)} periodic spectral peaks detected "
                f"(periodicity score: {periodic_score:.2f})"
            )

        return {
            "score": float(np.clip(periodic_score, 0, 1)),
            "artifacts": artifacts,
            "peak_frequencies": peak_frequencies,
            "peak_magnitudes": peak_magnitudes,
            "fft_freqs": envelope_freqs,
            "fft_mags": envelope_fft_norm,
            "num_peaks": len(peaks),
        }

    def _detect_highfreq_dropoff(self, y: np.ndarray, sr: int) -> dict:
        """
        Detect unnatural high-frequency energy dropoff.

        Uses a dedicated high-sample-rate pass so 16kHz+ content is observable.
        """
        nyquist = sr / 2.0
        if nyquist <= self.highfreq_cutoff:
            # This should not happen with the highfreq_sr pass, but keep guardrail.
            return {
                "score": 0.3,
                "dropoff_hz": float(nyquist),
                "band_energies": {},
                "dropoff_db": 0.0,
                "artifacts": [
                    (
                        f"High-frequency analysis limited by sample rate "
                        f"(Nyquist={nyquist:.0f}Hz)."
                    )
                ],
            }

        n_fft_hf = 8192
        spec = np.abs(librosa.stft(y, n_fft=n_fft_hf, hop_length=self.hop_length))
        freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft_hf)

        # Average power spectrum
        power = np.mean(spec**2, axis=1)
        power_db = librosa.power_to_db(power + 1e-10)

        air_low = min(16000.0, nyquist * 0.98)
        presence_high = min(16000.0, nyquist)

        bands = [
            (0, 4000, "low"),
            (4000, 8000, "mid"),
            (8000, 12000, "upper_mid"),
            (12000, presence_high, "presence"),
            (air_low, nyquist, "air"),
        ]

        band_energies = {}
        for low, high, name in bands:
            if high <= low:
                band_energies[name] = -100.0
                continue
            mask = (freqs >= low) & (freqs < high)
            if np.any(mask):
                band_energies[name] = float(np.mean(power_db[mask]))
            else:
                band_energies[name] = -100.0

        # Compare "air" to "presence"
        if band_energies["presence"] > -80:
            dropoff = band_energies["presence"] - band_energies["air"]
            if dropoff > 40:
                hf_score = 0.9
            elif dropoff > 30:
                hf_score = 0.7
            elif dropoff > 20:
                hf_score = 0.4
            else:
                hf_score = 0.1
        else:
            hf_score = 0.3
            dropoff = 0.0

        dropoff_hz = self.highfreq_cutoff
        inband_mask = (freqs > 1000) & (freqs < min(10000, nyquist))
        if np.any(inband_mask):
            avg_energy = np.mean(power_db[inband_mask])
            dropoff_mask = power_db < (avg_energy - 30)
            dropoff_indices = np.where(dropoff_mask & (freqs > 10000))[0]
            if len(dropoff_indices) > 0:
                dropoff_hz = float(freqs[dropoff_indices[0]])

        artifacts = []
        if hf_score > 0.5:
            artifacts.append(
                f"High-frequency dropoff at ~{dropoff_hz:.0f}Hz "
                f"({dropoff:.1f}dB drop, typical of AI-generated audio)"
            )

        return {
            "score": float(hf_score),
            "dropoff_hz": float(dropoff_hz),
            "band_energies": band_energies,
            "dropoff_db": float(dropoff),
            "artifacts": artifacts,
        }
