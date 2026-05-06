"""
CNN Detector for AI Music Detection

Lightweight MobileNet-style CNN that classifies CQT spectrograms
as AI-generated or human-performed. Supports multi-class generator
attribution and full-song multi-window analysis.

Supports:
- PyTorch inference (when training or using .pt weights)
- ONNX inference (for production/offline deployment)
- Untrained mode (returns neutral score with warning)
"""

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import librosa
import numpy as np

from ._runtime import file_sha256, get_onnx_providers

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F

    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False

try:
    import onnxruntime as ort

    ONNX_AVAILABLE = True
except ImportError:
    ONNX_AVAILABLE = False


logger = logging.getLogger(__name__)


CLASS_NAMES = [
    "human",
    "suno",
    "udio",
    "musicgen",
    "stable_audio",
    "unknown_ai",
    "google_lyria_3",  # added 2026-04-29 for v1.2 retrain — new generator class
]


@dataclass
class CNNResult:
    """Result from CNN detector."""

    score: float  # 0 = human, 1 = AI
    confidence: float
    model_loaded: bool
    model_type: str  # "pytorch", "onnx", or "none"
    spectrogram: Optional[np.ndarray] = None
    aggregate_scores: Dict[str, float] = field(default_factory=dict)
    window_scores: List[float] = field(default_factory=list)
    window_starts: List[float] = field(default_factory=list)
    window_duration: float = 10.0
    class_names: List[str] = field(default_factory=lambda: list(CLASS_NAMES))
    generator_probabilities: Dict[str, float] = field(default_factory=dict)
    predicted_generator: str = "unknown"
    window_generators: List[str] = field(default_factory=list)
    window_generator_probabilities: List[Dict[str, float]] = field(default_factory=list)


# --- PyTorch Model Definition -------------------------------------------------

if TORCH_AVAILABLE:

    class DepthwiseSeparableConv(nn.Module):
        """Efficient convolution used in MobileNet."""

        def __init__(self, in_ch, out_ch, stride=1):
            super().__init__()
            self.depthwise = nn.Conv2d(
                in_ch,
                in_ch,
                3,
                stride=stride,
                padding=1,
                groups=in_ch,
                bias=False,
            )
            self.bn1 = nn.BatchNorm2d(in_ch)
            self.pointwise = nn.Conv2d(in_ch, out_ch, 1, bias=False)
            self.bn2 = nn.BatchNorm2d(out_ch)

        def forward(self, x):
            x = F.relu(self.bn1(self.depthwise(x)))
            x = F.relu(self.bn2(self.pointwise(x)))
            return x


    class MusicCNN(nn.Module):
        """
        Lightweight CNN for AI music detection on CQT spectrograms.
        ~3-5MB model, fast CPU inference.
        """

        def __init__(self, n_classes: int = len(CLASS_NAMES)):
            super().__init__()

            # Initial conv
            self.conv1 = nn.Sequential(
                nn.Conv2d(1, 32, 3, stride=2, padding=1, bias=False),
                nn.BatchNorm2d(32),
                nn.ReLU(inplace=True),
            )

            # Depthwise separable blocks (MobileNet-style)
            self.features = nn.Sequential(
                DepthwiseSeparableConv(32, 64, stride=1),
                DepthwiseSeparableConv(64, 128, stride=2),
                DepthwiseSeparableConv(128, 128, stride=1),
                DepthwiseSeparableConv(128, 256, stride=2),
                DepthwiseSeparableConv(256, 256, stride=1),
                DepthwiseSeparableConv(256, 512, stride=2),
                # Extra depth for better feature extraction
                DepthwiseSeparableConv(512, 512, stride=1),
                DepthwiseSeparableConv(512, 512, stride=1),
            )

            # Classifier
            self.classifier = nn.Sequential(
                nn.AdaptiveAvgPool2d(1),
                nn.Flatten(),
                nn.Dropout(0.3),
                nn.Linear(512, 128),
                nn.ReLU(inplace=True),
                nn.Dropout(0.2),
                nn.Linear(128, n_classes),
            )

        def forward(self, x):
            x = self.conv1(x)
            x = self.features(x)
            x = self.classifier(x)
            return x


class CNNDetector:
    """
    CNN-based AI music detector operating on CQT spectrograms.

    Usage:
        detector = CNNDetector(model_path="models/music_cnn.onnx")
        result = detector.analyze("song.mp3")
    """

    def __init__(
        self,
        model_path: Optional[str] = None,
        sr: int = 22050,
        duration: float = 10.0,
        window_hop: float = 5.0,
        n_bins: int = 84,
        hop_length: int = 512,
        img_size: int = 224,
        class_names: Optional[List[str]] = None,
        device: str = "cpu",
    ):
        self.sr = sr
        self.duration = duration
        self.window_hop = window_hop
        self.n_bins = n_bins
        self.hop_length = hop_length
        self.img_size = img_size
        self.device = str(device or "cpu").strip().lower()
        self.model_type = "none"
        self.model = None
        self.ort_session = None
        self.providers: List[str] = []
        self.model_loaded = False
        self.model_path: Optional[str] = None
        self.model_sha256: Optional[str] = None
        self.load_error: Optional[str] = None

        self.class_names = list(class_names) if class_names else list(CLASS_NAMES)
        self.num_classes = len(self.class_names)
        self.human_index = self.class_names.index("human") if "human" in self.class_names else 0

        if model_path:
            if Path(model_path).exists():
                self._load_model(model_path)
            else:
                self.load_error = f"CNN model path does not exist: {model_path}"
                logger.warning("%s", self.load_error)

    def _class_names_for_output_dim(self, n_classes: int) -> List[str]:
        """Build class names for a loaded model's output dimensionality."""
        if n_classes == len(CLASS_NAMES):
            return list(CLASS_NAMES)
        if n_classes == 2:
            return ["human", "unknown_ai"]

        names = [f"class_{i}" for i in range(n_classes)]
        if n_classes > 0:
            names[0] = "human"
        return names

    def _apply_output_dim(self, n_classes: int):
        self.num_classes = int(n_classes)
        self.class_names = self._class_names_for_output_dim(self.num_classes)
        self.human_index = self.class_names.index("human") if "human" in self.class_names else 0

    def _infer_num_classes_from_state_dict(self, state_dict: dict) -> int:
        """Infer class count from final linear layer."""
        keys = [
            "classifier.6.weight",
            "classifier.6.bias",
        ]
        for key in keys:
            if key in state_dict:
                value = state_dict[key]
                if hasattr(value, "shape") and len(value.shape) >= 1:
                    return int(value.shape[0])
        return len(self.class_names)

    def _infer_onnx_num_classes(self) -> Optional[int]:
        """Infer output class count from ONNX graph metadata."""
        if not self.ort_session:
            return None
        try:
            output_meta = self.ort_session.get_outputs()[0]
            shape = output_meta.shape
            if shape and len(shape) >= 2 and isinstance(shape[-1], int):
                return int(shape[-1])
        except Exception:
            pass
        return None

    def _load_model(self, model_path: str):
        """Load model from .pt (PyTorch) or .onnx file."""
        path = Path(model_path).resolve()

        try:
            if path.suffix == ".onnx" and ONNX_AVAILABLE:
                providers = get_onnx_providers(self.device)
                self.ort_session = ort.InferenceSession(
                    str(path), providers=providers
                )
                self.providers = list(self.ort_session.get_providers())
                self.model_type = "onnx"

                n_classes = self._infer_onnx_num_classes()
                if n_classes is not None:
                    self._apply_output_dim(n_classes)
                self._assert_finite_forward()

            elif path.suffix in (".pt", ".pth") and TORCH_AVAILABLE:
                state = torch.load(str(path), map_location="cpu", weights_only=True)
                n_classes = self._infer_num_classes_from_state_dict(state)
                self.model = MusicCNN(n_classes=n_classes)
                self.model.load_state_dict(state)
                self.model.eval()
                self.model_type = "pytorch"
                self._apply_output_dim(n_classes)
                self._assert_finite_forward()
            else:
                raise RuntimeError(
                    f"unsupported CNN model format or runtime unavailable: {path}"
                )
        except Exception as exc:
            self.load_error = f"CNN model load failed for {path}: {exc}"
            logger.warning("%s", self.load_error)
            self.model_type = "none"
            self.model = None
            self.ort_session = None
            self.providers = []
            self.model_loaded = False
            self.model_path = None
            self.model_sha256 = None
            return

        self.model_loaded = True
        self.model_path = str(path)
        self.model_sha256 = file_sha256(path)
        self.load_error = None

    def _assert_finite_forward(self) -> None:
        """Validate that the loaded model can run a finite dummy inference."""
        sample = np.random.default_rng(20260503).random(
            (1, 1, self.img_size, self.img_size),
            dtype=np.float32,
        )
        logits = self._infer_logits_batch(sample)
        if not np.isfinite(logits).all():
            raise RuntimeError("random forward pass returned non-finite output")

    def _waveform_to_cqt(self, y: np.ndarray, sr: int, window_duration: float) -> np.ndarray:
        """Convert waveform window to normalized CQT spectrogram image (H, W)."""
        target_samples = int(window_duration * sr)
        if len(y) < target_samples:
            y = np.pad(y, (0, target_samples - len(y)))
        elif len(y) > target_samples:
            y = y[:target_samples]

        # Compute CQT
        cqt = np.abs(
            librosa.cqt(
                y,
                sr=sr,
                hop_length=self.hop_length,
                n_bins=self.n_bins,
                bins_per_octave=12,
            )
        )

        # Convert to dB
        cqt_db = librosa.amplitude_to_db(cqt, ref=np.max)

        # Resize to img_size x img_size
        from scipy.ndimage import zoom

        h, w = cqt_db.shape
        cqt_resized = zoom(cqt_db, (self.img_size / h, self.img_size / w), order=1)

        # Normalize to [0, 1]
        cqt_norm = (cqt_resized - cqt_resized.min()) / (
            cqt_resized.max() - cqt_resized.min() + 1e-8
        )

        return cqt_norm.astype(np.float32)

    def _window_starts(
        self,
        total_samples: int,
        window_samples: int,
        hop_samples: int,
    ) -> List[int]:
        """Generate window start samples; pad tail windows to cover full song."""
        if total_samples <= 0 or window_samples <= 0:
            return [0]
        if total_samples <= window_samples:
            return [0]
        starts = list(range(0, total_samples, max(1, hop_samples)))
        if not starts:
            starts = [0]
        return starts

    def _build_window_batch(
        self,
        y: np.ndarray,
        sr: int,
        window_duration: float,
        hop_duration: float,
    ) -> Tuple[np.ndarray, List[float]]:
        """Build CQT batch for sliding windows across full audio."""
        window_samples = max(1, int(window_duration * sr))
        hop_samples = max(1, int(hop_duration * sr))
        starts = self._window_starts(len(y), window_samples, hop_samples)

        spectrograms = []
        start_seconds = []

        for start in starts:
            end = start + window_samples
            chunk = y[start:end]
            spec = self._waveform_to_cqt(chunk, sr, window_duration)
            spectrograms.append(spec)
            start_seconds.append(float(start / sr))

        batch = np.stack(spectrograms, axis=0)
        return batch, start_seconds

    def _infer_logits_batch(self, input_batch: np.ndarray) -> np.ndarray:
        """Run batch inference and return logits with shape (N, C)."""
        if self.model_type == "onnx":
            input_name = self.ort_session.get_inputs()[0].name
            outputs = self.ort_session.run(None, {input_name: input_batch})
            return np.asarray(outputs[0], dtype=np.float32)

        if self.model_type == "pytorch":
            with torch.no_grad():
                tensor = torch.from_numpy(input_batch)
                logits = self.model(tensor).cpu().numpy()
            return logits.astype(np.float32)

        raise RuntimeError("No model loaded")

    def _softmax(self, logits: np.ndarray) -> np.ndarray:
        logits = logits - np.max(logits, axis=1, keepdims=True)
        exp_logits = np.exp(logits)
        return exp_logits / (np.sum(exp_logits, axis=1, keepdims=True) + 1e-8)

    def _ai_probabilities(self, probs: np.ndarray) -> np.ndarray:
        """Convert class probabilities to binary AI probabilities."""
        if probs.shape[1] == 2:
            return probs[:, 1]

        human_idx = self.human_index if self.human_index < probs.shape[1] else 0
        return 1.0 - probs[:, human_idx]

    def _prob_vector_to_dict(self, prob_vector: np.ndarray) -> Dict[str, float]:
        names = self._class_names_for_output_dim(len(prob_vector))
        return {name: float(prob_vector[i]) for i, name in enumerate(names)}

    def analyze_array(
        self,
        y: np.ndarray,
        sr: int,
        window_duration: Optional[float] = None,
        hop_duration: Optional[float] = None,
    ) -> Dict[str, object]:
        """
        Analyze an in-memory waveform with sliding windows.

        Returns a dictionary with per-window AI scores, class probabilities,
        and aggregate statistics.
        """
        if y.ndim > 1:
            y = librosa.to_mono(y)
        y = np.asarray(y, dtype=np.float32)

        if sr != self.sr:
            y = librosa.resample(y, orig_sr=sr, target_sr=self.sr)
            sr = self.sr

        window_duration = float(window_duration or self.duration)
        hop_duration = float(hop_duration or self.window_hop)

        spectrogram_batch, start_seconds = self._build_window_batch(
            y,
            sr,
            window_duration,
            hop_duration,
        )

        # Input shape: (N, 1, H, W)
        input_batch = spectrogram_batch[:, np.newaxis, :, :].astype(np.float32)

        if not self.model_loaded:
            neutral_scores = [0.5] * len(start_seconds)
            aggregate = {
                "mean": 0.5,
                "max": 0.5,
                "p75": 0.5,
                "blended": 0.5,
            }
            window_probs = [{"human": 0.5, "unknown_ai": 0.5} for _ in start_seconds]
            return {
                "aggregate": aggregate,
                "window_scores": neutral_scores,
                "window_starts": start_seconds,
                "window_generators": ["unknown"] * len(start_seconds),
                "window_generator_probabilities": window_probs,
                "generator_probabilities": {"human": 0.5, "unknown_ai": 0.5},
                "predicted_generator": "unknown",
                "spectrograms": spectrogram_batch,
                "confidence": 0.0,
            }

        logits = self._infer_logits_batch(input_batch)
        probs = self._softmax(logits)
        ai_probs = self._ai_probabilities(probs)

        mean_score = float(np.mean(ai_probs))
        max_score = float(np.max(ai_probs))
        p75_score = float(np.percentile(ai_probs, 75))
        blended_score = float(np.mean([mean_score, max_score, p75_score]))

        aggregate = {
            "mean": mean_score,
            "max": max_score,
            "p75": p75_score,
            "blended": blended_score,
        }

        avg_class_probs = np.mean(probs, axis=0)
        generator_probabilities = self._prob_vector_to_dict(avg_class_probs)

        class_names = self._class_names_for_output_dim(probs.shape[1])
        top_class_idx = int(np.argmax(avg_class_probs))
        predicted_generator = class_names[top_class_idx]

        window_top_idx = np.argmax(probs, axis=1)
        window_generators = [class_names[int(i)] for i in window_top_idx]
        window_generator_probabilities = [self._prob_vector_to_dict(p) for p in probs]

        dominance = float(np.mean(np.max(probs, axis=1)))
        stability = float(1.0 - min(np.std(ai_probs) * 2.0, 1.0))
        decisiveness = float(abs(blended_score - 0.5) * 2.0)
        confidence = float(np.clip(0.4 * dominance + 0.35 * stability + 0.25 * decisiveness, 0, 1))

        return {
            "aggregate": aggregate,
            "window_scores": ai_probs.astype(float).tolist(),
            "window_starts": start_seconds,
            "window_generators": window_generators,
            "window_generator_probabilities": window_generator_probabilities,
            "generator_probabilities": generator_probabilities,
            "predicted_generator": predicted_generator,
            "spectrograms": spectrogram_batch,
            "confidence": confidence,
        }

    def analyze(self, audio_path: str) -> CNNResult:
        """
        Analyze audio file using sliding-window CNN over the full song.

        Uses 10s windows every 5s by default, batch inference, and aggregates
        with mean + max + 75th percentile statistics.
        """
        y, sr = librosa.load(audio_path, sr=self.sr, mono=True)
        analysis = self.analyze_array(y, sr=sr)

        first_spec = None
        if analysis["spectrograms"] is not None and len(analysis["spectrograms"]) > 0:
            first_spec = analysis["spectrograms"][0]

        return CNNResult(
            score=float(analysis["aggregate"]["blended"]),
            confidence=float(analysis["confidence"]),
            model_loaded=self.model_loaded,
            model_type=self.model_type,
            spectrogram=first_spec,
            aggregate_scores=dict(analysis["aggregate"]),
            window_scores=list(analysis["window_scores"]),
            window_starts=list(analysis["window_starts"]),
            window_duration=float(self.duration),
            class_names=list(self.class_names),
            generator_probabilities=dict(analysis["generator_probabilities"]),
            predicted_generator=str(analysis["predicted_generator"]),
            window_generators=list(analysis["window_generators"]),
            window_generator_probabilities=list(analysis["window_generator_probabilities"]),
        )

    def export_onnx(
        self,
        pytorch_model_path: str,
        output_path: str = "models/music_cnn.onnx",
    ):
        """Export a trained PyTorch model to ONNX format."""
        if not TORCH_AVAILABLE:
            raise RuntimeError("PyTorch required for ONNX export")

        state = torch.load(pytorch_model_path, map_location="cpu", weights_only=True)
        n_classes = self._infer_num_classes_from_state_dict(state)

        model = MusicCNN(n_classes=n_classes)
        model.load_state_dict(state)
        model.eval()

        dummy = torch.randn(1, 1, self.img_size, self.img_size)
        torch.onnx.export(
            model,
            dummy,
            output_path,
            input_names=["spectrogram"],
            output_names=["logits"],
            dynamic_axes={"spectrogram": {0: "batch"}, "logits": {0: "batch"}},
            opset_version=14,
        )
        logger.info("Exported ONNX model to %s", output_path)
