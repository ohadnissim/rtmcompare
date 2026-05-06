"""
Codec residual detector for AI instrumental analysis.

Idea:
- Round-trip the same audio through MP3 at 64kbps
- Compare original vs re-decoded signal in spectral and pseudo-MDCT domains
- AI-generated tracks often degrade less because they already carry codec-like
  constraints from the generator/neural vocoder path
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import librosa
import numpy as np
from scipy.fft import dct
from scipy.stats import wasserstein_distance


@dataclass
class CodecResidualResult:
    """Result from codec residual analysis."""

    score: float  # 0 = likely human, 1 = likely AI
    confidence: float
    mean_spectral_residual: float
    mean_mdct_shift: float
    low_degradation_score: float
    residual_consistency: float
    mdct_consistency: float
    primary_codec: str = "mp3_64k"
    degradation_ratio: float = 0.0
    log_spectral_distance_db: float = 0.0
    mid_high_degradation_ratio: float = 0.0
    high_band_loss_ratio: float = 0.0
    original_high_band_energy_ratio: float = 0.0
    codec_metrics: Dict[str, Dict[str, float]] = field(default_factory=dict)
    successful_codecs: List[str] = field(default_factory=list)
    anomalies: List[str] = field(default_factory=list)


class CodecResidualDetector:
    """
    Detect AI traits from codec round-trip residual behavior.

    The detector re-encodes audio through MP3 at 64kbps and measures:
    1) spectral difference after round-trip normalized by original energy
    2) mid/high-band damage where human recordings usually lose more content
    3) pseudo-MDCT coefficient distribution shift as a weak supporting metric

    The score is intentionally driven by the normalized spectral degradation
    ratio: low degradation -> AI-like, high degradation -> human-like.
    """

    def __init__(
        self,
        sr: int = 44100,
        max_duration: float = 90.0,
        n_fft: int = 4096,
        hop_length: int = 512,
        mdct_frame: int = 2048,
        mdct_hop: int = 1024,
        mdct_stride: int = 2,
        mdct_sample_limit: int = 120000,
    ):
        self.sr = max(44100, int(sr))
        self.max_duration = float(max_duration)
        self.n_fft = int(n_fft)
        self.hop_length = int(hop_length)
        self.mdct_frame = int(mdct_frame)
        self.mdct_hop = int(mdct_hop)
        self.mdct_stride = max(1, int(mdct_stride))
        self.mdct_sample_limit = int(mdct_sample_limit)

        # Research path: MP3 64kbps round-trip. Older versions averaged several
        # codecs and used thresholds that saturated at 1.0 for almost every file.
        # Keep the list shape so result payloads still expose codec_metrics.
        self.codec_configs: List[Tuple[str, str, List[str]]] = [
            ("mp3_64k", "mp3", ["-c:a", "libmp3lame", "-b:a", "64k"]),
        ]

    def analyze(self, audio_path: str) -> CodecResidualResult:
        """Run codec round-trip residual analysis."""

        if shutil.which("ffmpeg") is None:
            return CodecResidualResult(
                score=0.5,
                confidence=0.0,
                mean_spectral_residual=0.0,
                mean_mdct_shift=0.0,
                low_degradation_score=0.5,
                residual_consistency=0.5,
                mdct_consistency=0.5,
                anomalies=["ffmpeg is unavailable; codec residual analysis skipped"],
            )

        y_orig, _ = librosa.load(
            audio_path,
            sr=self.sr,
            mono=True,
            duration=self.max_duration if self.max_duration > 0 else None,
        )

        if y_orig.size == 0:
            return CodecResidualResult(
                score=0.5,
                confidence=0.0,
                mean_spectral_residual=0.0,
                mean_mdct_shift=0.0,
                low_degradation_score=0.5,
                residual_consistency=0.5,
                mdct_consistency=0.5,
                anomalies=["Audio appears empty; codec residual analysis skipped"],
            )

        codec_metrics: Dict[str, Dict[str, float]] = {}
        residual_values: List[float] = []
        mdct_values: List[float] = []
        log_distance_values: List[float] = []
        mid_high_values: List[float] = []
        high_loss_values: List[float] = []
        high_energy_values: List[float] = []
        successful: List[str] = []

        with tempfile.TemporaryDirectory(prefix="aivshu_codec_") as tmp_dir:
            for codec_name, extension, codec_args in self.codec_configs:
                decoded = self._codec_roundtrip(
                    audio_path=audio_path,
                    tmp_dir=tmp_dir,
                    codec_name=codec_name,
                    extension=extension,
                    codec_args=codec_args,
                )
                if decoded is None or decoded.size == 0:
                    continue

                min_len = min(y_orig.size, decoded.size)
                if min_len < self.n_fft:
                    continue

                orig_aligned = y_orig[:min_len]
                dec_aligned = decoded[:min_len]

                spectral_metrics = self._spectral_residual_metrics(orig_aligned, dec_aligned)
                mdct_shift = self._mdct_distribution_shift(orig_aligned, dec_aligned)

                metric_row = {
                    "spectral_residual": float(spectral_metrics["residual_ratio"]),
                    "degradation_ratio": float(spectral_metrics["residual_ratio"]),
                    "log_spectral_distance_db": float(spectral_metrics["log_spectral_distance_db"]),
                    "mid_high_degradation_ratio": float(spectral_metrics["mid_high_degradation_ratio"]),
                    "high_band_loss_ratio": float(spectral_metrics["high_band_loss_ratio"]),
                    "original_high_band_energy_ratio": float(spectral_metrics["original_high_band_energy_ratio"]),
                    "residual_low": float(spectral_metrics["band_low"]),
                    "residual_mid": float(spectral_metrics["band_mid"]),
                    "residual_high": float(spectral_metrics["band_high"]),
                    "mdct_shift": float(mdct_shift),
                }

                codec_metrics[codec_name] = metric_row
                residual_values.append(metric_row["spectral_residual"])
                mdct_values.append(metric_row["mdct_shift"])
                log_distance_values.append(metric_row["log_spectral_distance_db"])
                mid_high_values.append(metric_row["mid_high_degradation_ratio"])
                high_loss_values.append(metric_row["high_band_loss_ratio"])
                high_energy_values.append(metric_row["original_high_band_energy_ratio"])
                successful.append(codec_name)

        if not residual_values:
            return CodecResidualResult(
                score=0.5,
                confidence=0.0,
                mean_spectral_residual=0.0,
                mean_mdct_shift=0.0,
                low_degradation_score=0.5,
                residual_consistency=0.5,
                mdct_consistency=0.5,
                codec_metrics=codec_metrics,
                successful_codecs=successful,
                anomalies=["No codec round-trips succeeded"],
            )

        mean_residual = float(np.mean(residual_values))
        mean_mdct = float(np.mean(mdct_values))
        mean_log_distance = float(np.mean(log_distance_values)) if log_distance_values else 0.0
        mean_mid_high = float(np.mean(mid_high_values)) if mid_high_values else 0.0
        mean_high_loss = float(np.mean(high_loss_values)) if high_loss_values else 0.0
        mean_high_energy = float(np.mean(high_energy_values)) if high_energy_values else 0.0

        residual_std = float(np.std(residual_values)) if len(residual_values) > 1 else 0.0
        mdct_std = float(np.std(mdct_values)) if len(mdct_values) > 1 else 0.0

        # The old 0.06/0.22 thresholds were two orders of magnitude too high
        # for MP3 round-trip spectral ratios, which caused every normal track to
        # clip to 1.0. These logistic calibrations keep low degradation AI-like
        # without hard-saturating most real files.
        residual_component = self._logistic_inverse(mean_residual, center=0.0055, width=0.0020)
        mid_high_component = self._logistic_inverse(mean_mid_high, center=0.0025, width=0.0018)
        log_component = self._logistic_inverse(mean_log_distance, center=2.6, width=1.0)
        mdct_component = self._logistic_inverse(mean_mdct, center=0.0040, width=0.0020)

        residual_consistency = self._inverse_scale(residual_std, low=0.002, high=0.018)
        mdct_consistency = self._inverse_scale(mdct_std, low=0.001, high=0.010)

        low_degradation_score = residual_component
        score = (
            0.70 * residual_component
            + 0.15 * mid_high_component
            + 0.10 * log_component
            + 0.05 * mdct_component
        )

        coverage = len(residual_values) / float(len(self.codec_configs))
        decisiveness = abs(score - 0.5) * 2.0
        agreement = 1.0 - min(
            np.std([residual_component, mid_high_component, log_component, mdct_component]) * 1.4,
            1.0,
        )
        spectral_richness = float(np.clip((mean_high_energy - 0.001) / 0.012, 0.0, 1.0))

        confidence = float(
            np.clip(
                0.25 * coverage
                + 0.30 * decisiveness
                + 0.25 * agreement
                + 0.20 * spectral_richness,
                0.0,
                1.0,
            )
        )

        anomalies = []
        if score > 0.62:
            anomalies.append(
                "MP3-64 round-trip causes low normalized spectral degradation "
                f"(ratio={mean_residual:.4f}, log_distance={mean_log_distance:.2f}dB)"
            )
        elif score < 0.38:
            anomalies.append(
                "MP3-64 round-trip causes stronger compression damage "
                f"(ratio={mean_residual:.4f}, high_loss={mean_high_loss:.4f})"
            )

        if mean_high_energy < 0.001 and score > 0.6:
            anomalies.append(
                "Original audio has very little 8-20kHz energy, reducing codec residual certainty"
            )

        if len(residual_values) >= 2 and residual_consistency > 0.7:
            anomalies.append(
                "Cross-codec degradation is unusually consistent "
                f"(std={residual_std:.3f})"
            )

        return CodecResidualResult(
            score=float(np.clip(score, 0.0, 1.0)),
            confidence=confidence,
            mean_spectral_residual=mean_residual,
            mean_mdct_shift=mean_mdct,
            low_degradation_score=float(np.clip(low_degradation_score, 0.0, 1.0)),
            residual_consistency=float(np.clip(residual_consistency, 0.0, 1.0)),
            mdct_consistency=float(np.clip(mdct_consistency, 0.0, 1.0)),
            primary_codec=successful[0] if successful else "mp3_64k",
            degradation_ratio=mean_residual,
            log_spectral_distance_db=mean_log_distance,
            mid_high_degradation_ratio=mean_mid_high,
            high_band_loss_ratio=mean_high_loss,
            original_high_band_energy_ratio=mean_high_energy,
            codec_metrics=codec_metrics,
            successful_codecs=successful,
            anomalies=anomalies,
        )

    def _codec_roundtrip(
        self,
        audio_path: str,
        tmp_dir: str,
        codec_name: str,
        extension: str,
        codec_args: List[str],
    ) -> Optional[np.ndarray]:
        """Encode with a codec and decode back to mono WAV at analysis SR."""

        encoded_path = f"{tmp_dir}/{codec_name}.{extension}"
        decoded_path = f"{tmp_dir}/{codec_name}_decoded.wav"

        encode_cmd = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            audio_path,
            "-vn",
        ]

        if self.max_duration > 0:
            encode_cmd.extend(["-t", f"{self.max_duration:.2f}"])

        encode_cmd.extend(codec_args)
        encode_cmd.append(encoded_path)

        if not self._run_ffmpeg(encode_cmd):
            return None

        decode_cmd = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            encoded_path,
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(self.sr),
            decoded_path,
        ]

        if not self._run_ffmpeg(decode_cmd):
            return None

        y_decoded, _ = librosa.load(decoded_path, sr=self.sr, mono=True)
        return y_decoded

    def _run_ffmpeg(self, cmd: List[str]) -> bool:
        """Run ffmpeg command safely."""
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,
                check=False,
            )
        except (subprocess.TimeoutExpired, OSError):
            return False
        return proc.returncode == 0

    def _spectral_residual_metrics(self, y_orig: np.ndarray, y_dec: np.ndarray) -> Dict[str, float]:
        """Compute normalized residual energy between original and round-trip audio."""

        spec_orig = np.abs(librosa.stft(y_orig, n_fft=self.n_fft, hop_length=self.hop_length))
        spec_dec = np.abs(librosa.stft(y_dec, n_fft=self.n_fft, hop_length=self.hop_length))

        min_frames = min(spec_orig.shape[1], spec_dec.shape[1])
        spec_orig = spec_orig[:, :min_frames]
        spec_dec = spec_dec[:, :min_frames]

        diff = spec_orig - spec_dec
        diff_power = diff * diff
        orig_power = spec_orig * spec_orig
        dec_power = spec_dec * spec_dec
        total_orig_energy = float(np.sum(orig_power) + 1e-10)
        residual_ratio = float(np.sum(diff_power) / total_orig_energy)

        freqs = librosa.fft_frequencies(sr=self.sr, n_fft=self.n_fft)

        def band_ratio(low_hz: float, high_hz: float) -> float:
            if high_hz <= low_hz:
                return 0.0
            mask = (freqs >= low_hz) & (freqs < high_hz)
            if not np.any(mask):
                return 0.0
            band_orig = spec_orig[mask]
            band_diff = diff_power[mask]
            return float(np.sum(band_diff) / (np.sum(band_orig * band_orig) + 1e-10))

        def band_diff_over_total(low_hz: float, high_hz: float) -> float:
            if high_hz <= low_hz:
                return 0.0
            mask = (freqs >= low_hz) & (freqs < high_hz)
            if not np.any(mask):
                return 0.0
            return float(np.sum(diff_power[mask]) / total_orig_energy)

        def band_loss_over_total(low_hz: float, high_hz: float) -> float:
            if high_hz <= low_hz:
                return 0.0
            mask = (freqs >= low_hz) & (freqs < high_hz)
            if not np.any(mask):
                return 0.0
            loss = np.maximum(orig_power[mask] - dec_power[mask], 0.0)
            return float(np.sum(loss) / total_orig_energy)

        def band_energy_share(low_hz: float, high_hz: float) -> float:
            if high_hz <= low_hz:
                return 0.0
            mask = (freqs >= low_hz) & (freqs < high_hz)
            if not np.any(mask):
                return 0.0
            return float(np.sum(orig_power[mask]) / total_orig_energy)

        nyquist = self.sr / 2.0
        band_high_max = min(20000.0, nyquist * 0.98)
        high_low = 8000.0
        high_max = min(20000.0, nyquist * 0.98)
        mid_high_max = min(16000.0, nyquist * 0.98)

        active_mask = spec_orig > (np.max(spec_orig) * 1e-4)
        if np.any(active_mask):
            ref = float(np.max(spec_orig) + 1e-8)
            db_orig = librosa.amplitude_to_db(spec_orig[active_mask] + 1e-8, ref=ref, top_db=90.0)
            db_dec = librosa.amplitude_to_db(spec_dec[active_mask] + 1e-8, ref=ref, top_db=90.0)
            log_distance = float(np.mean(np.abs(db_orig - db_dec)))
        else:
            log_distance = 0.0

        return {
            "residual_ratio": residual_ratio,
            "band_low": band_ratio(80.0, 4000.0),
            "band_mid": band_ratio(4000.0, 12000.0),
            "band_high": band_ratio(12000.0, band_high_max),
            "log_spectral_distance_db": log_distance,
            "mid_high_degradation_ratio": band_diff_over_total(4000.0, mid_high_max),
            "high_band_loss_ratio": band_loss_over_total(high_low, high_max),
            "original_high_band_energy_ratio": band_energy_share(high_low, high_max),
        }

    def _mdct_distribution_shift(self, y_orig: np.ndarray, y_dec: np.ndarray) -> float:
        """Approximate MDCT distribution drift between original and round-trip audio."""

        coeff_orig = self._mdct_magnitude_distribution(y_orig)
        coeff_dec = self._mdct_magnitude_distribution(y_dec)

        if coeff_orig.size < 64 or coeff_dec.size < 64:
            return 0.5

        # Normalize both distributions to reduce absolute loudness bias.
        scale_orig = np.percentile(coeff_orig, 90) + 1e-8
        scale_dec = np.percentile(coeff_dec, 90) + 1e-8
        coeff_orig = coeff_orig / scale_orig
        coeff_dec = coeff_dec / scale_dec

        std_ref = np.std(coeff_orig) + 1e-8
        wd = float(wasserstein_distance(coeff_orig, coeff_dec) / std_ref)

        quantiles = np.array([10, 25, 50, 75, 90], dtype=np.float64)
        q_orig = np.percentile(coeff_orig, quantiles)
        q_dec = np.percentile(coeff_dec, quantiles)
        q_range = float(max(q_orig[-1] - q_orig[0], 1e-6))
        q_shift = float(np.mean(np.abs(q_orig - q_dec)) / q_range)

        shift = 0.65 * wd + 0.35 * q_shift
        return float(np.clip(shift / 1.2, 0.0, 1.0))

    def _mdct_magnitude_distribution(self, y: np.ndarray) -> np.ndarray:
        """Compute pseudo-MDCT log-magnitude coefficient distribution."""

        frame = self.mdct_frame
        hop = self.mdct_hop
        if y.size < frame:
            y = np.pad(y, (0, frame - y.size))

        window = np.sin(np.pi * (np.arange(frame, dtype=np.float64) + 0.5) / frame)

        coeffs: List[np.ndarray] = []
        step = hop * self.mdct_stride

        for start in range(0, y.size - frame + 1, step):
            segment = y[start : start + frame]
            transformed = dct(segment * window, type=2, norm="ortho")
            half = transformed[: frame // 2]
            coeffs.append(np.log1p(np.abs(half)).astype(np.float64))

        if not coeffs:
            return np.array([], dtype=np.float64)

        merged = np.concatenate(coeffs)
        if merged.size > self.mdct_sample_limit:
            idx = np.linspace(0, merged.size - 1, num=self.mdct_sample_limit, dtype=int)
            merged = merged[idx]
        return merged

    @staticmethod
    def _inverse_scale(value: float, low: float, high: float) -> float:
        """Map lower values to higher scores (1 at <=low, 0 at >=high)."""
        if high <= low:
            return 0.5
        normalized = (float(value) - low) / (high - low)
        return float(np.clip(1.0 - normalized, 0.0, 1.0))

    @staticmethod
    def _logistic_inverse(value: float, center: float, width: float) -> float:
        """Smooth inverse mapping where lower metric values imply higher AI score."""
        if width <= 0:
            return 0.5
        z = np.clip((float(value) - center) / width, -60.0, 60.0)
        return float(1.0 / (1.0 + np.exp(z)))
