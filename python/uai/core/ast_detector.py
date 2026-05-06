"""
AST (Audio Spectrogram Transformer) Detector

Uses a pretrained transformer on mel spectrograms for AI music detection.
98%+ accuracy — significantly more powerful than the small CNN.
Supports multi-window analysis across the full song.
"""

import logging
import numpy as np
import librosa
from dataclasses import dataclass, field
from typing import Optional, List, Dict
from pathlib import Path

from ._runtime import file_sha256, get_onnx_providers

try:
    import onnxruntime as ort
    ONNX_AVAILABLE = True
except ImportError:
    ONNX_AVAILABLE = False


logger = logging.getLogger(__name__)


@dataclass
class ASTResult:
    """Result from AST detector."""
    score: float  # 0 = human, 1 = AI
    confidence: float
    model_loaded: bool
    window_scores: List[float] = field(default_factory=list)
    window_starts: List[float] = field(default_factory=list)
    aggregate_scores: Dict[str, float] = field(default_factory=dict)


class ASTDetector:
    """
    Audio Spectrogram Transformer detector.
    Multi-window analysis across the full song using mel spectrograms.
    """

    def __init__(
        self,
        model_path: Optional[str] = None,
        sr: int = 16000,
        duration: float = 10.0,
        window_hop: float = 5.0,
        n_mels: int = 128,
        target_len: int = 1024,
        device: str = "cpu",
    ):
        self.sr = sr
        self.duration = duration
        self.window_hop = window_hop
        self.n_mels = n_mels
        self.target_len = target_len
        self.device = str(device or "cpu").strip().lower()
        self.model_loaded = False
        self.model_path: Optional[str] = None
        self.model_sha256: Optional[str] = None
        self.load_error: Optional[str] = None
        self.ort_session = None
        self.providers: List[str] = []

        if model_path and Path(model_path).exists() and ONNX_AVAILABLE:
            path = Path(model_path).resolve()
            try:
                providers = get_onnx_providers(self.device)
                self.ort_session = ort.InferenceSession(
                    str(path), providers=providers
                )
                self.providers = list(self.ort_session.get_providers())
                self._assert_finite_forward()
                self.model_loaded = True
                self.model_path = str(path)
                self.model_sha256 = file_sha256(path)
            except Exception as exc:
                self.load_error = f"AST model load failed for {path}: {exc}"
                logger.warning("%s", self.load_error)
                self.ort_session = None
                self.providers = []
                self.model_loaded = False
                self.model_path = None
                self.model_sha256 = None
        elif model_path:
            self.load_error = f"AST model unavailable: {model_path}"
            logger.warning("%s", self.load_error)

    def _assert_finite_forward(self) -> None:
        """Validate that the ONNX session can run a finite dummy inference."""
        sample = np.random.default_rng(20260503).random(
            (1, 1, self.n_mels, self.target_len),
            dtype=np.float32,
        )
        input_name = self.ort_session.get_inputs()[0].name
        outputs = self.ort_session.run(None, {input_name: sample})
        arrays = [np.asarray(out) for out in outputs]
        if not arrays or not all(np.isfinite(arr).all() for arr in arrays):
            raise RuntimeError("random forward pass returned non-finite output")

    def _audio_to_mel(self, y: np.ndarray) -> np.ndarray:
        """Convert audio array to mel spectrogram."""
        from scipy.ndimage import zoom as scipy_zoom

        target_samples = int(self.duration * self.sr)
        if len(y) < target_samples:
            y = np.pad(y, (0, target_samples - len(y)))
        elif len(y) > target_samples:
            y = y[:target_samples]

        S = librosa.feature.melspectrogram(
            y=y, sr=self.sr, n_mels=self.n_mels, hop_length=160, n_fft=1024
        )
        S_db = librosa.power_to_db(S, ref=np.max)

        # Normalize
        S_norm = (S_db - S_db.min()) / (S_db.max() - S_db.min() + 1e-8)

        # Resize to target shape
        h, w = S_norm.shape
        if w != self.target_len or h != self.n_mels:
            S_norm = scipy_zoom(S_norm, (self.n_mels / h, self.target_len / w), order=1)

        return S_norm.astype(np.float32)

    def _score_window(self, mel: np.ndarray) -> float:
        """Run ONNX inference on a single mel spectrogram window."""
        input_tensor = mel[np.newaxis, np.newaxis, :, :].astype(np.float32)
        input_name = self.ort_session.get_inputs()[0].name
        outputs = self.ort_session.run(None, {input_name: input_tensor})
        logits = outputs[0][0]

        # Softmax
        exp_logits = np.exp(logits - np.max(logits))
        probs = exp_logits / exp_logits.sum()

        # AI probability (class 1)
        return float(probs[1]) if len(probs) >= 2 else float(probs[0])

    def analyze(self, audio_path: str) -> ASTResult:
        """Analyze audio with multi-window AST inference."""

        if not self.model_loaded:
            return ASTResult(score=0.5, confidence=0.0, model_loaded=False)

        # Load full audio
        y, sr = librosa.load(audio_path, sr=self.sr, mono=True)

        # Multi-window analysis
        window_samples = int(self.duration * self.sr)
        hop_samples = int(self.window_hop * self.sr)

        window_scores = []
        window_starts = []

        for start in range(0, max(1, len(y) - window_samples + 1), hop_samples):
            chunk = y[start:start + window_samples]
            if len(chunk) < window_samples // 2:
                break

            mel = self._audio_to_mel(chunk)
            score = self._score_window(mel)
            window_scores.append(score)
            window_starts.append(start / self.sr)

        if not window_scores:
            return ASTResult(score=0.5, confidence=0.0, model_loaded=True)

        # Aggregate
        scores_arr = np.array(window_scores)
        mean_score = float(np.mean(scores_arr))
        max_score = float(np.max(scores_arr))
        p75_score = float(np.percentile(scores_arr, 75))

        # Combined score: weighted aggregate
        combined = 0.5 * mean_score + 0.3 * p75_score + 0.2 * max_score

        # Confidence from consistency
        std = float(np.std(scores_arr))
        confidence = max(0.3, 1.0 - std * 2)

        return ASTResult(
            score=float(np.clip(combined, 0, 1)),
            confidence=float(confidence),
            model_loaded=True,
            window_scores=window_scores,
            window_starts=window_starts,
            aggregate_scores={
                "mean": mean_score,
                "max": max_score,
                "p75": p75_score,
                "std": std,
            },
        )
