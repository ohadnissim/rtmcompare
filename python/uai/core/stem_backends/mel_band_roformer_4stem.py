"""Mel-Band RoFormer 4-stem separation backend.

This backend runs the Aname-Tommy Mel-Band RoFormer checkpoint that emits
``drums``, ``bass``, ``other``, and ``vocals`` in one pass. It uses
``audio_separator`` for inference, but supplies the local checkpoint and YAML
config directly so the model does not need to appear in audio-separator's
bundled UVR model index.

SDR ~10.5 (MUSDB18HQ) vs BS-RoFormer's SDR 9.66.
"""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path
from typing import Callable, Dict, Optional, Tuple, Type

from ._protocol import StemBackend


logger = logging.getLogger(__name__)


MEL_BAND_ROFORMER_4STEM_MODEL_FILENAME = "mel_band_roformer_4stem_ep_0_sdr_10.5475.ckpt"
MEL_BAND_ROFORMER_4STEM_CONFIG_FILENAME = "mel_band_roformer_4stem_ep_0_sdr_10.5475.yaml"
MEL_BAND_ROFORMER_4STEM_SOURCE_MODEL_FILENAME = "mel_band_roformer_4stems_large_ver1.ckpt"
MEL_BAND_ROFORMER_4STEM_MODEL_URL = (
    "https://huggingface.co/Aname-Tommy/melbandroformer4stems/resolve/main/"
    "mel_band_roformer_4stems_large_ver1.ckpt"
)
MEL_BAND_ROFORMER_4STEM_CONFIG_URL = (
    "https://huggingface.co/Aname-Tommy/melbandroformer4stems/resolve/main/"
    "config_large.yaml"
)
EXPECTED_4STEM_STEMS = ("drums", "bass", "other", "vocals")

# SHA-256 digests of official model assets.  When a digest is present here
# the downloader verifies the file after each download and raises
# RuntimeError on mismatch — preventing silently corrupt checkpoints.
# Leave as None to skip verification for a URL.
_ASSET_SHA256: Dict[str, Optional[str]] = {
    MEL_BAND_ROFORMER_4STEM_MODEL_URL: None,   # fill in once hash is confirmed
    MEL_BAND_ROFORMER_4STEM_CONFIG_URL: None,  # fill in once hash is confirmed
}


def _default_model_dir() -> str:
    # Honour RTM_UAI_APPLICATION_ROOT so the Mel-Band RoFormer ckpt
    # resolves under model-cache/uai_root/models/ (the canonical
    # location used by separator.py + electron-builder extraResources).
    # Falls back to the in-package layout for upstream-style installs.
    env_root = os.environ.get("RTM_UAI_APPLICATION_ROOT")
    if env_root:
        return str(Path(env_root) / "models")
    return str(Path(__file__).resolve().parents[2] / "models")


class MelBandRoformer4StemBackend(StemBackend):
    """Wrap ``audio_separator.Separator`` for Mel-Band RoFormer 4-stem output."""

    name = "mel_band_roformer_4stem"

    def __init__(
        self,
        model_filename: str = MEL_BAND_ROFORMER_4STEM_MODEL_FILENAME,
        config_filename: str = MEL_BAND_ROFORMER_4STEM_CONFIG_FILENAME,
        model_file_dir: Optional[str] = None,
        device: str = "cpu",
        download: bool = True,
        separator_cls: Optional[Type[object]] = None,
    ):
        self.model_filename = model_filename
        self.config_filename = config_filename
        self.device = str(device or "cpu").strip().lower()
        self.model_file_dir = model_file_dir or os.environ.get(
            "AIVSHU_MODELS_DIR",
            _default_model_dir(),
        )
        self.download = download
        self._separator_cls = separator_cls
        self._separator = None  # type: ignore[assignment]

    @property
    def model_path(self) -> Path:
        return Path(self.model_file_dir) / self.model_filename

    @property
    def config_path(self) -> Path:
        return Path(self.model_file_dir) / self.config_filename

    def _ensure_assets(self) -> None:
        Path(self.model_file_dir).mkdir(parents=True, exist_ok=True)

        if not self.model_path.exists():
            if not self.download:
                raise FileNotFoundError(f"Missing Mel-Band RoFormer checkpoint: {self.model_path}")
            logger.info("Downloading Mel-Band RoFormer 4-stem checkpoint to %s", self.model_path)
            self._download_file(
                MEL_BAND_ROFORMER_4STEM_MODEL_URL,
                self.model_path,
                expected_sha256=_ASSET_SHA256.get(MEL_BAND_ROFORMER_4STEM_MODEL_URL),
            )

        if not self.config_path.exists():
            if not self.download:
                raise FileNotFoundError(f"Missing Mel-Band RoFormer config: {self.config_path}")
            logger.info("Downloading Mel-Band RoFormer 4-stem config to %s", self.config_path)
            self._download_file(
                MEL_BAND_ROFORMER_4STEM_CONFIG_URL,
                self.config_path,
                expected_sha256=_ASSET_SHA256.get(MEL_BAND_ROFORMER_4STEM_CONFIG_URL),
            )

    @staticmethod
    def _download_file(
        url: str,
        destination: Path,
        progress_cb: Optional[Callable[[int, int], None]] = None,
        expected_sha256: Optional[str] = None,
    ) -> None:
        """Download *url* to *destination* with chunked progress and optional hash verification.

        Args:
            url: HTTPS URL of the asset to download.
            destination: Final file path (written atomically via .part file).
            progress_cb: Optional callback invoked as ``progress_cb(bytes_downloaded, total_bytes)``
                every ~1 MiB.  ``total_bytes`` is -1 if Content-Length is absent.
            expected_sha256: If supplied, the SHA-256 of the downloaded file is verified
                against this hex digest.  RuntimeError is raised on mismatch and the
                partial file is removed.
        """
        tmp_path = destination.with_suffix(destination.suffix + ".part")
        chunk_size = 1024 * 1024  # 1 MiB
        try:
            with urllib.request.urlopen(url, timeout=300) as response:
                total = int(response.headers.get("Content-Length", -1))
                downloaded = 0
                hasher = hashlib.sha256()

                with tmp_path.open("wb") as handle:
                    while True:
                        chunk = response.read(chunk_size)
                        if not chunk:
                            break
                        handle.write(chunk)
                        hasher.update(chunk)
                        downloaded += len(chunk)
                        if progress_cb is not None:
                            try:
                                progress_cb(downloaded, total)
                            except Exception:
                                pass  # never let a progress callback crash the download
                        # Emit a stderr tick so the daemon's log shows activity
                        if total > 0:
                            pct = downloaded * 100 // total
                            sys.stderr.write(
                                f"\r[mel_band_roformer4stem] Downloading … {pct}%   "
                            )
                        sys.stderr.flush()

            if total > 0:
                sys.stderr.write("\n")
                sys.stderr.flush()

            if expected_sha256 is not None:
                actual = hasher.hexdigest()
                if actual != expected_sha256.lower():
                    tmp_path.unlink(missing_ok=True)
                    raise RuntimeError(
                        f"SHA-256 mismatch for {destination.name}: "
                        f"expected {expected_sha256}, got {actual}. "
                        "File removed — please retry."
                    )

            tmp_path.replace(destination)
        except Exception:
            tmp_path.unlink(missing_ok=True)
            raise

    def _local_separator_class(self):
        if self._separator_cls is not None:
            base_cls = self._separator_cls
        else:
            from audio_separator.separator import Separator as base_cls  # type: ignore

        model_path = self.model_path
        config_path = self.config_path

        class LocalMelBandRoformerSeparator(base_cls):  # type: ignore[misc, valid-type]
            def download_model_files(self, model_filename):  # type: ignore[override]
                return (
                    Path(model_filename).name,
                    "MDXC",
                    "Roformer Model: Mel-Band RoFormer 4-stem",
                    str(model_path),
                    str(config_path),
                )

        return LocalMelBandRoformerSeparator

    def _ensure_loaded(self, output_dir: str):
        self._ensure_assets()

        if self._separator is None:
            separator_cls = self._local_separator_class()
            self._separator = separator_cls(
                model_file_dir=self.model_file_dir,
                output_dir=output_dir,
                output_format="WAV",
                sample_rate=44100,
                use_soundfile=True,
                info_only=True,
                mdxc_params={
                    "segment_size": 256,
                    "override_model_segment_size": False,
                    "batch_size": 1,
                    "overlap": 8,
                    "pitch_shift": 0,
                    "process_all_stems": True,
                },
            )
            self._configure_separator_device()
            self._separator.load_model(model_filename=self.model_filename)
        else:
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
        tmp_dir = tempfile.mkdtemp(prefix="aivshu_melband4_warm_")
        try:
            self._ensure_loaded(tmp_dir)
        except SystemExit as exc:
            raise RuntimeError(f"Failed to initialize Mel-Band RoFormer 4-stem: {exc}") from exc
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    def separate(self, audio_path: str, out_dir: str) -> Dict[str, str]:
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        try:
            self._ensure_loaded(out_dir)
        except SystemExit as exc:
            raise RuntimeError(f"Failed to initialize Mel-Band RoFormer 4-stem: {exc}") from exc
        except Exception as exc:
            raise RuntimeError(f"Failed to initialize Mel-Band RoFormer 4-stem: {exc}") from exc

        try:
            output_files = self._separator.separate(  # type: ignore[union-attr]
                audio_path,
                custom_output_names={stem: stem for stem in EXPECTED_4STEM_STEMS},
            )
        except SystemExit as exc:
            raise RuntimeError(f"Mel-Band RoFormer 4-stem separation failed: {exc}") from exc
        except Exception as exc:
            raise RuntimeError(f"Mel-Band RoFormer 4-stem separation failed: {exc}") from exc

        if not output_files:
            raise RuntimeError("Mel-Band RoFormer 4-stem returned no output files")

        resolved: Dict[str, str] = {}
        for fname in output_files:
            full_path = fname if os.path.isabs(fname) else str(Path(out_dir) / fname)
            stem_key = self._classify(full_path)
            if stem_key is not None and Path(full_path).exists():
                resolved[stem_key] = full_path

        missing = [stem for stem in EXPECTED_4STEM_STEMS if stem not in resolved]
        if missing:
            raise RuntimeError(
                "Mel-Band RoFormer 4-stem output missing expected stems. "
                f"Missing: {missing}; got: {list(resolved.keys())} from {output_files}"
            )

        return resolved

    @staticmethod
    def _classify(path: str) -> Optional[str]:
        lower = Path(path).name.lower()
        for stem in EXPECTED_4STEM_STEMS:
            if f"({stem})" in lower or lower == f"{stem}.wav" or lower.startswith(f"{stem}."):
                return stem
        return None
