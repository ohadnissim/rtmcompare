"""
Embedding Detector for AI Music Detection.

Uses CLAP (Contrastive Language-Audio Pretraining) audio embeddings as a
generator-invariant timbre fingerprint, then compares each new track's
embedding against a reference bank of known-human and known-AI tracks via
nearest-neighbor distance ratio.

Hypothesis: even when AI generators (e.g. Suno v5.5) hide their classic
spectral artifacts, their high-level timbre still lives in a different
region of CLAP embedding space than real recordings.

Score = sigmoid(K * (d_human - d_ai))
  - d_ai close (small)  -> score near 1 (AI)
  - d_human close       -> score near 0 (human)
"""

from __future__ import annotations

import logging
import math
import random
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

import numpy as np

logger = logging.getLogger(__name__)


# Optional heavy deps -- guarded so the detector can degrade gracefully.
try:
    import librosa  # type: ignore

    LIBROSA_AVAILABLE = True
except Exception:  # pragma: no cover
    LIBROSA_AVAILABLE = False

try:
    import torch  # type: ignore

    TORCH_AVAILABLE = True
except Exception:  # pragma: no cover
    TORCH_AVAILABLE = False

try:
    from transformers import (  # type: ignore
        ClapModel,
        ClapProcessor,
        __version__ as TRANSFORMERS_VERSION,
    )

    CLAP_AVAILABLE = True
except Exception:  # pragma: no cover
    TRANSFORMERS_VERSION = "0"
    CLAP_AVAILABLE = False


@dataclass
class CLAPResult:
    """Raw CLAP embedding wrapper (kept for API symmetry with other detectors)."""

    embedding: np.ndarray
    dim: int = 0
    model_loaded: bool = False


@dataclass
class EmbeddingResult:
    """Result from the embedding (CLAP nearest-neighbor) detector."""

    score: float  # 0 = human, 1 = AI
    confidence: float
    nearest_human_distance: float = 0.0
    nearest_ai_distance: float = 0.0
    anomalies: List[str] = field(default_factory=list)
    model_loaded: bool = False
    bank_size: int = 0
    embedding_dim: int = 0


class EmbeddingDetector:
    """
    CLAP nearest-neighbor AI/human classifier.

    On first init, builds a reference bank of CLAP audio embeddings from
    `data/ai/` and `data/human/`. On subsequent inits the bank is loaded
    from disk so the model + bank are not rebuilt.

    Usage:
        detector = EmbeddingDetector()
        result = detector.analyze("song.wav")
    """

    DEFAULT_K: float = 2.0
    DEFAULT_SR: int = 48000  # CLAP standard
    BANK_PER_CLASS: int = 100
    BANK_PER_CLASS_FALLBACK: int = 50
    MAX_BUILD_SECONDS: float = 30 * 60.0
    MIN_FILE_BYTES: int = 1 * 1024 * 1024  # 1 MB
    MIN_DURATION_S: float = 10.0
    MAX_INFERENCE_S: float = 10.0  # how much audio we feed CLAP per track

    def __init__(
        self,
        model_path: str = "models/clap_bank.npz",
        clap_model: str = "laion/clap-htsat-fused",
        device: str = "cpu",
    ):
        self.model_path = Path(model_path)
        self.clap_model_name = clap_model
        self.k_sensitivity = self.DEFAULT_K
        self._requested_device = str(device or "cpu").strip().lower()
        self._device = "cpu"
        self._processor_audio_kw = self._resolve_processor_audio_kw()

        self.model = None
        self.processor = None
        self.model_loaded = False
        self.load_error: Optional[str] = None

        self.bank_embeddings: Optional[np.ndarray] = None
        self.bank_labels: Optional[np.ndarray] = None  # 0 = human, 1 = ai
        self.embedding_dim: int = 0

        # 1) Try to load CLAP. If we cannot, run as a no-op detector.
        if not (CLAP_AVAILABLE and TORCH_AVAILABLE and LIBROSA_AVAILABLE):
            self.load_error = "CLAP/torch/librosa not installed"
            logger.warning("EmbeddingDetector disabled: %s", self.load_error)
            return

        try:
            self._load_clap()
        except Exception as exc:  # pragma: no cover - depends on network state
            self.load_error = f"CLAP load failed: {exc}"
            logger.warning("EmbeddingDetector disabled: %s", self.load_error)
            return

        # 2) Load or build the reference bank.
        try:
            if self.model_path.exists():
                self._load_bank()
            else:
                self._build_bank()
        except Exception as exc:
            self.load_error = f"Bank init failed: {exc}"
            logger.warning("EmbeddingDetector disabled: %s", self.load_error)
            self.bank_embeddings = None
            self.bank_labels = None

    @property
    def device(self) -> str:
        """Actual runtime device used by the CLAP model."""
        return self._device

    # ------------------------------------------------------------------
    # Model + bank lifecycle
    # ------------------------------------------------------------------

    @staticmethod
    def _version_tuple(version: str) -> tuple[int, int]:
        parts = []
        for raw in str(version).split(".")[:2]:
            digits = "".join(ch for ch in raw if ch.isdigit())
            parts.append(int(digits or 0))
        while len(parts) < 2:
            parts.append(0)
        return (parts[0], parts[1])

    def _resolve_processor_audio_kw(self) -> str:
        """Choose the CLAP processor audio keyword for this transformers build."""
        # transformers 4.x CLAP processors expose `audios=`, while the generic
        # processor interface in transformers 5.x moved to `audio=`.
        return "audio" if self._version_tuple(TRANSFORMERS_VERSION) >= (5, 0) else "audios"

    def _can_attempt_device(self, device: str) -> bool:
        if device == "cpu":
            return False
        if device == "cuda":
            try:
                return bool(torch.cuda.is_available())
            except Exception:
                return False
        if device == "mps":
            try:
                return bool(torch.backends.mps.is_available())
            except Exception:
                return False
        return True

    def _move_model_to_device(self) -> None:
        if self.model is None:
            return
        requested = self._requested_device
        if requested == "cpu":
            self._device = "cpu"
            return
        if not self._can_attempt_device(requested):
            logger.warning(
                "EmbeddingDetector requested %s, but torch reports it is "
                "unavailable; using CPU",
                requested,
            )
            self._device = "cpu"
            return
        try:
            moved = self.model.to(requested)
            if moved is not None:
                self.model = moved
            self._device = requested
        except Exception as exc:
            logger.warning(
                "EmbeddingDetector failed to move CLAP model to %s, "
                "falling back to CPU: %s",
                requested,
                exc,
            )
            try:
                moved = self.model.to("cpu")
                if moved is not None:
                    self.model = moved
            except Exception:
                pass
            self._device = "cpu"

    def _load_clap(self) -> None:
        """Load CLAP model + processor from HF (cached after first call)."""
        logger.info("Loading CLAP model %s", self.clap_model_name)
        self.model = ClapModel.from_pretrained(self.clap_model_name)
        self._move_model_to_device()
        self.processor = ClapProcessor.from_pretrained(self.clap_model_name)
        self.model.eval()
        self.model_loaded = True

    def _load_bank(self) -> None:
        """Load reference bank embeddings from .npz."""
        data = np.load(str(self.model_path))
        self.bank_embeddings = data["embeddings"].astype(np.float32)
        self.bank_labels = data["labels"].astype(np.int64)
        self.embedding_dim = int(self.bank_embeddings.shape[1])
        logger.info(
            "Loaded CLAP bank: %d embeddings (%d-dim) from %s",
            self.bank_embeddings.shape[0],
            self.embedding_dim,
            self.model_path,
        )

    def _build_bank(self) -> None:
        """Build the reference bank by sampling AI + human tracks."""
        ai_dir = Path("data/ai")
        human_dir = Path("data/human")

        if not ai_dir.is_dir() or not human_dir.is_dir():
            raise RuntimeError(
                f"Cannot build bank: missing {ai_dir} or {human_dir}"
            )

        per_class = self.BANK_PER_CLASS
        start = time.time()

        ai_files = self._candidate_files(ai_dir)
        human_files = self._candidate_files(human_dir)
        if not ai_files or not human_files:
            raise RuntimeError("No suitable audio files found for bank build")

        rng = random.Random(20250429)
        rng.shuffle(ai_files)
        rng.shuffle(human_files)

        embeddings: List[np.ndarray] = []
        labels: List[int] = []

        def _ingest(files: List[Path], label: int, target: int) -> int:
            taken = 0
            for path in files:
                if taken >= target:
                    break
                if (time.time() - start) > self.MAX_BUILD_SECONDS:
                    logger.warning(
                        "Bank build exceeded %.0fs budget; stopping early",
                        self.MAX_BUILD_SECONDS,
                    )
                    return taken
                try:
                    emb = self._embed_audio_file(str(path))
                except Exception as exc:
                    logger.debug("Skip %s: %s", path, exc)
                    continue
                if emb is None or emb.size == 0:
                    continue
                embeddings.append(emb.astype(np.float32))
                labels.append(label)
                taken += 1
                if taken % 10 == 0:
                    logger.info(
                        "Bank progress: %d/%d label=%d (%.1fs elapsed)",
                        taken,
                        target,
                        label,
                        time.time() - start,
                    )
            return taken

        ai_taken = _ingest(ai_files, label=1, target=per_class)
        human_taken = _ingest(human_files, label=0, target=per_class)

        # If we ran short on time, retry with the smaller fallback target.
        if (
            ai_taken < self.BANK_PER_CLASS_FALLBACK
            or human_taken < self.BANK_PER_CLASS_FALLBACK
        ) and (time.time() - start) > self.MAX_BUILD_SECONDS:
            logger.warning(
                "Bank build undersized (ai=%d human=%d) after time budget",
                ai_taken,
                human_taken,
            )

        if not embeddings:
            raise RuntimeError("Bank build produced zero embeddings")

        emb_arr = np.stack(embeddings, axis=0).astype(np.float32)
        lbl_arr = np.asarray(labels, dtype=np.int64)

        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        np.savez(
            str(self.model_path),
            embeddings=emb_arr,
            labels=lbl_arr,
        )

        self.bank_embeddings = emb_arr
        self.bank_labels = lbl_arr
        self.embedding_dim = int(emb_arr.shape[1])

        logger.info(
            "Built CLAP bank: %d embeddings (ai=%d human=%d) in %.1fs -> %s",
            emb_arr.shape[0],
            int((lbl_arr == 1).sum()),
            int((lbl_arr == 0).sum()),
            time.time() - start,
            self.model_path,
        )

    def _candidate_files(self, root: Path) -> List[Path]:
        """Collect audio files >= 1 MB and >= 10 s, recursively."""
        exts = {".wav", ".mp3", ".flac", ".m4a", ".ogg", ".aac", ".aiff", ".aif"}
        out: List[Path] = []
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix.lower() not in exts:
                continue
            try:
                if path.stat().st_size < self.MIN_FILE_BYTES:
                    continue
            except OSError:
                continue
            out.append(path)
        return out

    # ------------------------------------------------------------------
    # Embedding extraction
    # ------------------------------------------------------------------

    def _load_audio_for_clap(self, audio_path: str) -> Optional[np.ndarray]:
        """Load audio at 48 kHz mono, capped at MAX_INFERENCE_S."""
        max_samples = int(self.MAX_INFERENCE_S * self.DEFAULT_SR)
        try:
            y, _ = librosa.load(
                audio_path,
                sr=self.DEFAULT_SR,
                mono=True,
                duration=self.MAX_INFERENCE_S,
            )
        except Exception as exc:
            logger.debug("librosa.load failed for %s: %s", audio_path, exc)
            return None

        if y is None or y.size == 0:
            return None
        if y.shape[0] > max_samples:
            y = y[:max_samples]
        # CLAP processor handles padding internally; just enforce minimum length.
        if y.shape[0] < self.DEFAULT_SR:
            return None
        return y.astype(np.float32)

    def _processor_inputs(self, y: np.ndarray):
        kwargs = {
            "sampling_rate": self.DEFAULT_SR,
            "return_tensors": "pt",
        }
        preferred = self._processor_audio_kw
        fallback = "audios" if preferred == "audio" else "audio"
        last_exc: Optional[Exception] = None
        for audio_kw in (preferred, fallback):
            try:
                return self.processor(**{audio_kw: y, **kwargs})
            except TypeError as exc:
                last_exc = exc
                continue
        if last_exc is not None:
            raise last_exc
        raise RuntimeError("CLAP processor did not return inputs")

    def _move_inputs_to_device(self, inputs):
        if self.device == "cpu":
            return inputs
        if hasattr(inputs, "to"):
            return inputs.to(self.device)
        return {
            key: value.to(self.device) if hasattr(value, "to") else value
            for key, value in dict(inputs).items()
        }

    def _embed_audio_file(self, audio_path: str) -> Optional[np.ndarray]:
        """Return a single-track L2-normalized CLAP audio embedding."""
        if not self.model_loaded:
            return None

        # Skip too-short files up front so we don't waste CLAP compute on them.
        try:
            duration = librosa.get_duration(path=audio_path)
            if duration < self.MIN_DURATION_S:
                return None
        except Exception:
            pass

        y = self._load_audio_for_clap(audio_path)
        if y is None:
            return None

        with torch.no_grad():
            inputs = self._processor_inputs(y)
            inputs = self._move_inputs_to_device(inputs)
            features = self.model.get_audio_features(**inputs)
            # transformers >=5 returns a model-output object whose
            # pooler_output is the 512-dim audio embedding; older versions
            # return the tensor directly.
            if hasattr(features, "pooler_output") and features.pooler_output is not None:
                tensor = features.pooler_output
            elif isinstance(features, torch.Tensor):
                tensor = features
            elif hasattr(features, "last_hidden_state"):
                tensor = features.last_hidden_state.mean(dim=tuple(range(2, features.last_hidden_state.dim())))
            else:
                raise RuntimeError(
                    f"Unexpected CLAP output type: {type(features).__name__}"
                )
            emb = tensor.cpu().numpy().squeeze(0)

        norm = np.linalg.norm(emb) + 1e-8
        return (emb / norm).astype(np.float32)

    # ------------------------------------------------------------------
    # Inference
    # ------------------------------------------------------------------

    def _no_op_result(self, message: str) -> EmbeddingResult:
        return EmbeddingResult(
            score=0.5,
            confidence=0.0,
            nearest_human_distance=0.0,
            nearest_ai_distance=0.0,
            anomalies=[message],
            model_loaded=self.model_loaded,
            bank_size=int(self.bank_embeddings.shape[0])
            if self.bank_embeddings is not None
            else 0,
            embedding_dim=self.embedding_dim,
        )

    def score(self, audio_path: str) -> float:
        """Compatibility wrapper returning only the CLAP detector score."""
        return float(self.analyze(audio_path).score)

    def analyze(self, audio_path: str) -> EmbeddingResult:
        """Score an audio file by CLAP nearest-neighbor distance ratio."""

        if self.load_error or not self.model_loaded:
            return self._no_op_result(
                f"embedding detector unavailable: {self.load_error or 'unknown'}"
            )
        if self.bank_embeddings is None or self.bank_labels is None:
            return self._no_op_result("reference bank not loaded")

        try:
            emb = self._embed_audio_file(audio_path)
        except Exception as exc:
            logger.warning("CLAP inference failed for %s: %s", audio_path, exc)
            return self._no_op_result(f"CLAP inference failed: {exc}")

        if emb is None:
            return self._no_op_result(
                "audio too short or unreadable for CLAP embedding"
            )

        # Cosine distance via L2-normalized vectors: d = 1 - cos_sim
        bank = self.bank_embeddings
        labels = self.bank_labels
        # Cosine similarity since both sides are L2-normalized in build/load path.
        bank_norms = np.linalg.norm(bank, axis=1, keepdims=True) + 1e-8
        bank_unit = bank / bank_norms
        sims = bank_unit @ emb  # emb already unit-norm
        dists = 1.0 - sims  # in [0, 2]

        human_mask = labels == 0
        ai_mask = labels == 1
        if not human_mask.any() or not ai_mask.any():
            return self._no_op_result("reference bank missing a class")

        d_human = float(dists[human_mask].min())
        d_ai = float(dists[ai_mask].min())

        # Score: sigmoid(K * (d_human - d_ai))
        # d_ai small (close to AI cluster) -> argument positive -> score -> 1
        delta = d_human - d_ai
        score = 1.0 / (1.0 + math.exp(-self.k_sensitivity * delta))
        score = float(np.clip(score, 0.0, 1.0))

        # Confidence from nearest-neighbor agreement (k=10) + decisiveness.
        k = min(10, dists.shape[0])
        nearest_idx = np.argsort(dists)[:k]
        nearest_labels = labels[nearest_idx]
        majority = 1 if score >= 0.5 else 0
        agreement = float(np.mean(nearest_labels == majority))
        decisiveness = float(min(abs(delta) * 5.0, 1.0))
        confidence = float(np.clip(0.6 * agreement + 0.4 * decisiveness, 0.0, 1.0))

        anomalies: List[str] = []
        if d_ai < d_human:
            anomalies.append(
                f"embedding closer to AI cluster (d_ai={d_ai:.3f} < d_human={d_human:.3f})"
            )
        else:
            anomalies.append(
                f"embedding closer to human cluster (d_human={d_human:.3f} < d_ai={d_ai:.3f})"
            )
        if abs(delta) < 0.01:
            anomalies.append("embedding is borderline between clusters")

        return EmbeddingResult(
            score=score,
            confidence=confidence,
            nearest_human_distance=d_human,
            nearest_ai_distance=d_ai,
            anomalies=anomalies,
            model_loaded=True,
            bank_size=int(bank.shape[0]),
            embedding_dim=self.embedding_dim,
        )
