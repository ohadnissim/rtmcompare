"""
Spectral Feature Detector for AI Music Detection

Analyzes audio features that differ statistically between AI-generated
and human-performed music. Uses librosa for feature extraction and
compares against known distributions.

No ML training needed — uses statistical thresholds derived from research.
"""

import numpy as np
import librosa
from dataclasses import dataclass, field
from typing import Dict, List


@dataclass
class SpectralResult:
    """Result from spectral feature analysis."""
    score: float  # 0 = definitely human, 1 = definitely AI
    confidence: float
    feature_scores: Dict[str, float] = field(default_factory=dict)
    feature_details: Dict[str, dict] = field(default_factory=dict)
    anomalies: List[str] = field(default_factory=list)


class SpectralDetector:
    """
    Detects AI-generated music through spectral feature analysis.

    Analyzes multiple audio features known to differ between AI and human music:
    - Spectral Flatness: AI tends toward more uniform spectral distribution
    - Spectral Rolloff: Where most energy lives in the spectrum
    - MFCC statistics: Timbral characteristics and their variation
    - Zero Crossing Rate: Temporal texture of the signal
    - Tempo consistency: AI often has unnaturally consistent tempo
    - Dynamic range: AI tends to have compressed dynamics
    """

    def __init__(self, sr: int = 22050, hop_length: int = 512):
        self.sr = sr
        self.hop_length = hop_length

        # Reference statistics derived from research on AI vs human music
        # These are approximate thresholds — a trained model would be more precise
        self.reference = {
            "spectral_flatness": {
                "ai_range": (0.02, 0.15),   # AI tends toward moderate flatness
                "human_range": (0.005, 0.25), # Human has wider variation
                "ai_std_typical": 0.02,       # AI has less variation over time
                "human_std_typical": 0.06,
            },
            "spectral_rolloff": {
                "ai_typical_hz": 6000,    # AI often concentrated in mid frequencies
                "human_typical_hz": 8000, # Human spreads more broadly
            },
            "dynamic_range_db": {
                "ai_typical": (6, 15),     # AI tends toward compressed dynamics
                "human_typical": (12, 40), # Human has wider dynamic range
            },
            "tempo_consistency": {
                "ai_typical_std": 0.5,   # AI: very consistent tempo
                "human_typical_std": 3.0, # Human: natural tempo variation
            },
        }

    def analyze(self, audio_path: str) -> SpectralResult:
        """Analyze audio file for AI-indicative spectral features."""
        y, sr = librosa.load(audio_path, sr=self.sr, mono=True)

        feature_scores = {}
        feature_details = {}
        anomalies = []

        # 1. Spectral Flatness
        sf_score, sf_details, sf_anomalies = self._analyze_spectral_flatness(y)
        feature_scores["spectral_flatness"] = sf_score
        feature_details["spectral_flatness"] = sf_details
        anomalies.extend(sf_anomalies)

        # 2. Spectral Rolloff
        sr_score, sr_details, sr_anomalies = self._analyze_spectral_rolloff(y)
        feature_scores["spectral_rolloff"] = sr_score
        feature_details["spectral_rolloff"] = sr_details
        anomalies.extend(sr_anomalies)

        # 3. MFCC analysis
        mfcc_score, mfcc_details, mfcc_anomalies = self._analyze_mfcc(y)
        feature_scores["mfcc"] = mfcc_score
        feature_details["mfcc"] = mfcc_details
        anomalies.extend(mfcc_anomalies)

        # 4. Dynamic range
        dr_score, dr_details, dr_anomalies = self._analyze_dynamic_range(y)
        feature_scores["dynamic_range"] = dr_score
        feature_details["dynamic_range"] = dr_details
        anomalies.extend(dr_anomalies)

        # 5. Tempo consistency
        tc_score, tc_details, tc_anomalies = self._analyze_tempo_consistency(y)
        feature_scores["tempo_consistency"] = tc_score
        feature_details["tempo_consistency"] = tc_details
        anomalies.extend(tc_anomalies)

        # 6. Zero Crossing Rate consistency
        zcr_score, zcr_details, zcr_anomalies = self._analyze_zcr(y)
        feature_scores["zcr_consistency"] = zcr_score
        feature_details["zcr_consistency"] = zcr_details
        anomalies.extend(zcr_anomalies)

        # 7. Spectral bandwidth consistency
        bw_score, bw_details, bw_anomalies = self._analyze_bandwidth_consistency(y)
        feature_scores["bandwidth_consistency"] = bw_score
        feature_details["bandwidth_consistency"] = bw_details
        anomalies.extend(bw_anomalies)

        # Combined score (weighted)
        weights = {
            "spectral_flatness": 0.15,
            "spectral_rolloff": 0.10,
            "mfcc": 0.25,
            "dynamic_range": 0.15,
            "tempo_consistency": 0.15,
            "zcr_consistency": 0.10,
            "bandwidth_consistency": 0.10,
        }

        combined = sum(
            weights[k] * feature_scores[k] for k in weights
        )

        # Confidence based on feature agreement
        scores = list(feature_scores.values())
        score_std = np.std(scores)
        confidence = max(0.3, 1.0 - score_std)

        return SpectralResult(
            score=float(np.clip(combined, 0, 1)),
            confidence=float(confidence),
            feature_scores=feature_scores,
            feature_details=feature_details,
            anomalies=anomalies,
        )

    def _analyze_spectral_flatness(self, y: np.ndarray):
        """
        Spectral flatness (Wiener entropy): ratio of geometric to arithmetic mean
        of the power spectrum. AI music tends to have more uniform spectral energy.
        """
        flatness = librosa.feature.spectral_flatness(y=y, hop_length=self.hop_length)[0]

        mean_flatness = float(np.mean(flatness))
        std_flatness = float(np.std(flatness))

        ref = self.reference["spectral_flatness"]

        # AI indicator: low temporal variation in flatness
        # (AI generates consistently, humans have natural variation)
        variation_ratio = std_flatness / (ref["human_std_typical"] + 1e-8)
        if variation_ratio < 0.5:
            score = 0.8  # Very consistent = likely AI
        elif variation_ratio < 0.8:
            score = 0.5
        else:
            score = 0.2  # Natural variation = likely human

        details = {
            "mean": mean_flatness,
            "std": std_flatness,
            "variation_ratio": variation_ratio,
        }

        anomalies = []
        if score > 0.6:
            anomalies.append(
                f"Spectral flatness is unusually consistent (std={std_flatness:.4f}), "
                f"typical of AI-generated audio"
            )

        return score, details, anomalies

    def _analyze_spectral_rolloff(self, y: np.ndarray):
        """
        Spectral rolloff: frequency below which 85% of spectral energy lies.
        AI models often concentrate energy in a narrower band.
        """
        rolloff = librosa.feature.spectral_rolloff(
            y=y, sr=self.sr, hop_length=self.hop_length, roll_percent=0.85
        )[0]

        mean_rolloff = float(np.mean(rolloff))
        std_rolloff = float(np.std(rolloff))

        # AI tends to have lower and more consistent rolloff
        ref = self.reference["spectral_rolloff"]

        rolloff_score = 0.0
        if mean_rolloff < ref["ai_typical_hz"]:
            rolloff_score += 0.4
        if std_rolloff < 500:  # Very consistent rolloff
            rolloff_score += 0.4
        else:
            rolloff_score += 0.1

        details = {
            "mean_hz": mean_rolloff,
            "std_hz": std_rolloff,
        }

        anomalies = []
        if rolloff_score > 0.6:
            anomalies.append(
                f"Spectral rolloff concentrated at {mean_rolloff:.0f}Hz "
                f"with low variation ({std_rolloff:.0f}Hz std)"
            )

        return float(np.clip(rolloff_score, 0, 1)), details, anomalies

    def _analyze_mfcc(self, y: np.ndarray):
        """
        MFCC (Mel-Frequency Cepstral Coefficients) analysis.
        AI music tends to have less variation in timbral characteristics
        over time — the texture is "too smooth".
        """
        mfccs = librosa.feature.mfcc(y=y, sr=self.sr, n_mfcc=20, hop_length=self.hop_length)

        # Temporal variation of each coefficient
        mfcc_stds = np.std(mfccs, axis=1)

        # AI indicator: low temporal variation across MFCCs
        # (timbre stays too consistent)
        avg_temporal_variation = float(np.mean(mfcc_stds[1:]))  # Skip MFCC0 (energy)

        # Delta MFCCs (rate of change)
        mfcc_delta = librosa.feature.delta(mfccs)
        avg_delta_magnitude = float(np.mean(np.abs(mfcc_delta)))

        # Low variation + low delta = AI-like (too smooth)
        if avg_temporal_variation < 10:
            variation_score = 0.8
        elif avg_temporal_variation < 20:
            variation_score = 0.5
        else:
            variation_score = 0.2

        if avg_delta_magnitude < 3:
            delta_score = 0.7
        elif avg_delta_magnitude < 6:
            delta_score = 0.4
        else:
            delta_score = 0.2

        score = 0.6 * variation_score + 0.4 * delta_score

        # Inter-coefficient correlation (AI tends to have more correlated MFCCs)
        mfcc_corr = np.corrcoef(mfccs[1:6])  # Top 5 non-energy coefficients
        avg_corr = float(np.mean(np.abs(mfcc_corr[np.triu_indices(5, k=1)])))
        if avg_corr > 0.7:
            score = min(1.0, score + 0.15)

        details = {
            "avg_temporal_variation": avg_temporal_variation,
            "avg_delta_magnitude": avg_delta_magnitude,
            "inter_coefficient_correlation": avg_corr,
            "mfcc_means": np.mean(mfccs, axis=1).tolist(),
            "mfcc_stds": mfcc_stds.tolist(),
        }

        anomalies = []
        if score > 0.6:
            anomalies.append(
                f"MFCC analysis shows unusually consistent timbre "
                f"(variation={avg_temporal_variation:.1f}, delta={avg_delta_magnitude:.1f})"
            )

        return float(np.clip(score, 0, 1)), details, anomalies

    def _analyze_dynamic_range(self, y: np.ndarray):
        """
        Dynamic range analysis. AI-generated music tends to have
        compressed dynamics compared to human performances.
        """
        # RMS energy over time
        rms = librosa.feature.rms(y=y, hop_length=self.hop_length)[0]
        rms_db = librosa.amplitude_to_db(rms + 1e-10)

        dynamic_range = float(np.percentile(rms_db, 95) - np.percentile(rms_db, 5))

        ref = self.reference["dynamic_range_db"]

        if dynamic_range < ref["ai_typical"][0]:
            score = 0.9  # Extremely compressed
        elif dynamic_range < ref["ai_typical"][1]:
            score = 0.6  # Somewhat compressed (AI range)
        elif dynamic_range < ref["human_typical"][1]:
            score = 0.3  # Normal range
        else:
            score = 0.1  # Wide dynamics = likely human

        details = {
            "dynamic_range_db": dynamic_range,
            "rms_mean_db": float(np.mean(rms_db)),
            "rms_std_db": float(np.std(rms_db)),
        }

        anomalies = []
        if score > 0.5:
            anomalies.append(
                f"Limited dynamic range ({dynamic_range:.1f}dB), "
                f"typical of AI-generated audio"
            )

        return float(score), details, anomalies

    def _analyze_tempo_consistency(self, y: np.ndarray):
        """
        Tempo consistency analysis. AI-generated music often has
        machine-perfect tempo with no natural human timing variation.
        """
        # Beat tracking
        tempo, beats = librosa.beat.beat_track(y=y, sr=self.sr, hop_length=self.hop_length)

        if len(beats) < 4:
            return 0.5, {"tempo": float(np.mean(tempo)) if hasattr(tempo, '__len__') else float(tempo), "beat_count": len(beats)}, []

        # Inter-beat intervals
        beat_times = librosa.frames_to_time(beats, sr=self.sr, hop_length=self.hop_length)
        ibis = np.diff(beat_times)

        if len(ibis) < 2:
            return 0.5, {"tempo": float(np.mean(tempo)) if hasattr(tempo, '__len__') else float(tempo)}, []

        # Coefficient of variation of inter-beat intervals
        ibi_cv = float(np.std(ibis) / (np.mean(ibis) + 1e-8))
        ibi_std_ms = float(np.std(ibis) * 1000)  # in milliseconds

        ref = self.reference["tempo_consistency"]

        # Very low variation = AI (machine-perfect timing)
        if ibi_std_ms < ref["ai_typical_std"]:
            score = 0.85
        elif ibi_std_ms < 2.0:
            score = 0.6
        elif ibi_std_ms < ref["human_typical_std"]:
            score = 0.4
        else:
            score = 0.15  # Natural timing variation

        tempo_val = float(np.mean(tempo)) if hasattr(tempo, '__len__') else float(tempo)

        details = {
            "tempo_bpm": tempo_val,
            "beat_count": len(beats),
            "ibi_mean_ms": float(np.mean(ibis) * 1000),
            "ibi_std_ms": ibi_std_ms,
            "ibi_cv": ibi_cv,
        }

        anomalies = []
        if score > 0.5:
            anomalies.append(
                f"Tempo is unusually consistent (IBI std={ibi_std_ms:.1f}ms), "
                f"suggesting machine-generated timing"
            )

        return float(score), details, anomalies

    def _analyze_zcr(self, y: np.ndarray):
        """
        Zero Crossing Rate consistency. AI music tends to have
        more uniform ZCR across segments.
        """
        zcr = librosa.feature.zero_crossing_rate(y, hop_length=self.hop_length)[0]

        mean_zcr = float(np.mean(zcr))
        std_zcr = float(np.std(zcr))
        cv_zcr = std_zcr / (mean_zcr + 1e-8)

        # Low coefficient of variation = unnaturally consistent
        if cv_zcr < 0.3:
            score = 0.7
        elif cv_zcr < 0.6:
            score = 0.4
        else:
            score = 0.2

        details = {
            "mean": mean_zcr,
            "std": std_zcr,
            "cv": cv_zcr,
        }

        anomalies = []
        if score > 0.5:
            anomalies.append(
                f"Zero crossing rate is unusually consistent (CV={cv_zcr:.2f})"
            )

        return float(score), details, anomalies

    def _analyze_bandwidth_consistency(self, y: np.ndarray):
        """
        Spectral bandwidth consistency. AI models often produce
        audio with unnaturally consistent spectral width.
        """
        bandwidth = librosa.feature.spectral_bandwidth(
            y=y, sr=self.sr, hop_length=self.hop_length
        )[0]

        mean_bw = float(np.mean(bandwidth))
        std_bw = float(np.std(bandwidth))
        cv_bw = std_bw / (mean_bw + 1e-8)

        if cv_bw < 0.15:
            score = 0.75
        elif cv_bw < 0.3:
            score = 0.45
        else:
            score = 0.2

        details = {
            "mean_hz": mean_bw,
            "std_hz": std_bw,
            "cv": cv_bw,
        }

        anomalies = []
        if score > 0.5:
            anomalies.append(
                f"Spectral bandwidth is unusually consistent (CV={cv_bw:.2f})"
            )

        return float(score), details, anomalies
