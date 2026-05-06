"""
Temporal AI detector.

Splits audio into fixed 5-second chunks, runs CNN scoring per chunk,
and returns a time series of AI probabilities to expose mid-song changes.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional

import librosa
import numpy as np

from .cnn_detector import CNNDetector


@dataclass
class TemporalChunkResult:
    start_sec: float
    end_sec: float
    ai_score: float
    predicted_generator: str
    generator_probabilities: Dict[str, float] = field(default_factory=dict)


@dataclass
class TemporalResult:
    overall_score: float
    confidence: float
    chunk_duration: float
    chunks: List[TemporalChunkResult] = field(default_factory=list)
    ai_score_series: List[float] = field(default_factory=list)
    time_axis: List[float] = field(default_factory=list)
    transition_magnitudes: List[float] = field(default_factory=list)
    splice_candidates_sec: List[float] = field(default_factory=list)
    model_loaded: bool = False


class TemporalDetector:
    """Chunk-level temporal AI analysis for splice/mashup detection."""

    def __init__(
        self,
        cnn_model_path: Optional[str] = None,
        sr: int = 22050,
        chunk_duration: float = 5.0,
        device: str = "cpu",
    ):
        self.sr = sr
        self.chunk_duration = chunk_duration
        self.device = str(device or "cpu").strip().lower()
        self.cnn = CNNDetector(
            model_path=cnn_model_path,
            sr=sr,
            device=self.device,
        )

    def analyze(self, audio_path: str) -> TemporalResult:
        y, sr = librosa.load(audio_path, sr=self.sr, mono=True)

        analysis = self.cnn.analyze_array(
            y,
            sr=sr,
            window_duration=self.chunk_duration,
            hop_duration=self.chunk_duration,
        )

        starts = list(analysis["window_starts"])
        scores = list(analysis["window_scores"])
        generators = list(analysis["window_generators"])
        probs = list(analysis["window_generator_probabilities"])

        chunks = []
        for i, start in enumerate(starts):
            chunks.append(
                TemporalChunkResult(
                    start_sec=float(start),
                    end_sec=float(start + self.chunk_duration),
                    ai_score=float(scores[i]),
                    predicted_generator=str(generators[i]),
                    generator_probabilities=dict(probs[i]),
                )
            )

        transitions = np.abs(np.diff(scores)).astype(float).tolist() if len(scores) > 1 else []

        # Mark abrupt shifts as potential splice boundaries.
        splice_threshold = 0.35
        splice_candidates = [
            float(starts[i + 1])
            for i, delta in enumerate(transitions)
            if delta >= splice_threshold
        ]

        mean_score = float(np.mean(scores)) if scores else 0.5
        max_score = float(np.max(scores)) if scores else 0.5
        p75_score = float(np.percentile(scores, 75)) if scores else 0.5
        overall_score = float(np.mean([mean_score, max_score, p75_score]))

        if len(scores) > 1:
            stability = float(1.0 - min(np.std(scores) * 2.0, 1.0))
        else:
            stability = 0.5
        decisiveness = float(abs(overall_score - 0.5) * 2.0)
        confidence = float(np.clip(0.55 * stability + 0.45 * decisiveness, 0, 1))

        return TemporalResult(
            overall_score=overall_score,
            confidence=confidence,
            chunk_duration=self.chunk_duration,
            chunks=chunks,
            ai_score_series=[float(s) for s in scores],
            time_axis=[float(t) for t in starts],
            transition_magnitudes=transitions,
            splice_candidates_sec=splice_candidates,
            model_loaded=self.cnn.model_type != "none",
        )
