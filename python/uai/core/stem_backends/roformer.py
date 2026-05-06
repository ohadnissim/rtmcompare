"""BS-RoFormer stem-separation backend.

BS-RoFormer (Band-Split RoFormer) is a transformer-based vocal separator
that significantly outperforms Demucs on isolation cleanliness. We invoke
it via the ``audio_separator`` library, which manages model download and
ONNX/PyTorch inference behind a clean Python API.

The model produces two stems: ``vocals`` and ``instrumental``. Use
:class:`~core.stem_backends.cascade.CascadeBackend` if downstream code
also needs ``drums``/``bass``/``other``.
"""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
from pathlib import Path
from typing import Dict, Optional

from ._protocol import StemBackend


logger = logging.getLogger(__name__)


# Default checkpoint shipped by audio-separator. ~600 MB on first download;
# subsequent runs are instant from the on-disk cache.
DEFAULT_ROFORMER_MODEL = "model_bs_roformer_ep_317_sdr_12.9755.ckpt"


class BSRoformerBackend(StemBackend):
    """Wrap ``audio_separator.Separator`` for BS-RoFormer."""

    name = "roformer"

    def __init__(
        self,
        model_filename: str = DEFAULT_ROFORMER_MODEL,
        model_file_dir: Optional[str] = None,
        device: str = "cpu",
    ):
        self.model_filename = model_filename
        self.device = str(device or "cpu").strip().lower()
        # Default to the package's standard cache so model files are
        # shared between runs / between users on a build machine.
        self.model_file_dir = model_file_dir or os.environ.get(
            "AUDIO_SEPARATOR_MODELS_DIR",
            os.path.expanduser("~/.cache/audio-separator-models"),
        )
        self._separator = None  # type: ignore[assignment]

    # ------------------------------------------------------------------
    # Lazy model loading: instantiating Separator and load_model()
    # together can take 10-30s and ~1.5GB RAM on first call. Defer this
    # so importing the backend module is cheap.
    # ------------------------------------------------------------------
    def _ensure_loaded(self, output_dir: str):
        from audio_separator.separator import Separator  # type: ignore

        if self._separator is None:
            Path(self.model_file_dir).mkdir(parents=True, exist_ok=True)
            self._separator = Separator(
                model_file_dir=self.model_file_dir,
                output_dir=output_dir,
                output_format="WAV",
                # Default sample rate matches Demucs / WAV expectations
                # of the rest of the pipeline.
                sample_rate=44100,
                info_only=True,
            )
            self._configure_separator_device()
            self._separator.load_model(model_filename=self.model_filename)
        else:
            # Reuse loaded weights but redirect output to the requested dir.
            self._separator.output_dir = output_dir
            model_instance = getattr(self._separator, "model_instance", None)
            if model_instance is not None:
                model_instance.output_dir = output_dir

    def _configure_separator_device(self) -> None:
        """Force audio-separator onto the engine-selected device."""
        import torch

        separator = self._separator
        separator.torch_device_cpu = torch.device("cpu")
        separator.torch_device_mps = None
        separator.torch_device = separator.torch_device_cpu
        separator.onnx_execution_provider = ["CPUExecutionProvider"]

        if self.device == "cuda":
            separator.torch_device = torch.device("cuda")
            try:
                import onnxruntime as ort
                if "CUDAExecutionProvider" in ort.get_available_providers():
                    separator.onnx_execution_provider = ["CUDAExecutionProvider"]
            except Exception:
                pass
        elif self.device == "mps":
            separator.torch_device_mps = torch.device("mps")
            separator.torch_device = separator.torch_device_mps
            try:
                import onnxruntime as ort
                if "CoreMLExecutionProvider" in ort.get_available_providers():
                    separator.onnx_execution_provider = ["CoreMLExecutionProvider"]
            except Exception:
                pass

    def warm_up(self) -> None:
        """Load the separator weights without separating a track."""
        tmp_dir = tempfile.mkdtemp(prefix="aivshu_roformer_warm_")
        try:
            self._ensure_loaded(tmp_dir)
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    def separate(self, audio_path: str, out_dir: str) -> Dict[str, str]:
        try:
            self._ensure_loaded(out_dir)
        except Exception as exc:
            raise RuntimeError(f"Failed to initialize BS-RoFormer: {exc}") from exc

        try:
            output_files = self._separator.separate(audio_path)  # type: ignore[union-attr]
        except Exception as exc:
            raise RuntimeError(f"BS-RoFormer separation failed: {exc}") from exc

        if not output_files:
            raise RuntimeError("BS-RoFormer returned no output files")

        # audio-separator returns filenames *relative to* output_dir.
        resolved: Dict[str, str] = {}
        for fname in output_files:
            full_path = fname if os.path.isabs(fname) else str(Path(out_dir) / fname)
            stem_key = self._classify(full_path)
            if stem_key is not None:
                resolved[stem_key] = full_path

        if "vocals" not in resolved or "instrumental" not in resolved:
            raise RuntimeError(
                "BS-RoFormer output missing expected stems. "
                f"Got: {list(resolved.keys())} from {output_files}"
            )

        return resolved

    @staticmethod
    def _classify(path: str) -> Optional[str]:
        """Map an audio-separator filename to our canonical stem name.

        audio-separator names files like
        ``<input_stem>_(Vocals)_<model>.wav`` /
        ``<input_stem>_(Instrumental)_<model>.wav``.
        """
        lower = Path(path).name.lower()
        if "vocals" in lower:
            return "vocals"
        if "instrumental" in lower or "instrum" in lower or "no_vocals" in lower:
            return "instrumental"
        return None
