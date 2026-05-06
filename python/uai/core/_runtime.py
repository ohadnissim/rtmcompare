"""Runtime configuration and model integrity checks.

5.3.x RTM vendor patch: application_root() now honours the env var
RTM_UAI_APPLICATION_ROOT so RTM can point UAI at its own model-cache
directory without forcing a UAI-shaped source tree. The RTM adapter
shims (`python/separator.py`, `python/ai_detector.py`) set this var
on import.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional


logger = logging.getLogger(__name__)


class ModelIntegrityError(RuntimeError):
    """Raised when a bundled model does not match its expected digest."""


@dataclass(frozen=True)
class ModelSpec:
    """Opaque model location and expected SHA-256 digest."""

    key: str
    encoded_parts: tuple[str, ...]
    sha256: str
    required: bool = False


_MODEL_SPECS: Dict[str, ModelSpec] = {
    "cnn": ModelSpec(
        key="cnn",
        encoded_parts=("bW9kZWxz", "bXVzaWNfY25uLm9ubng="),
        # Production CNN is the 7-class generator-attribution ONNX. The older
        # six-class baseline remains on disk as music_cnn_v1_1_baseline.onnx.
        sha256="2e01ee39ecd62d9e489fb5b174d19eaf9eddaa483ccbc9a22380bf80b8af32b8",
    ),
    "ast": ModelSpec(
        key="ast",
        encoded_parts=("bW9kZWxz", "bXVzaWNfYXN0Lm9ubng="),
        sha256="874df5f72cc9998af9a7f3d7ca8714d3734224539ed065bc53b8b630e7e6181c",
    ),
    "lofcz": ModelSpec(
        key="lofcz",
        encoded_parts=("bW9kZWxz", "bG9mY3o=", "YWlfbXVzaWNfZGV0ZWN0b3Iub25ueA=="),
        sha256="af7a75c6ed457bc5b6941c8bc76aa06a66d48de40db944b761ed2bebfc0fbbd3",
    ),
}


def application_root(root: Optional[Path | str] = None) -> Path:
    """Return the directory used for runtime assets.

    Resolution order:
      1. Explicit `root=` argument (highest priority).
      2. Env var `RTM_UAI_APPLICATION_ROOT` — set by RTM's adapter shims.
         Points at the directory whose `models/` subdirectory contains
         the vendored UAI model files.
      3. PyInstaller-frozen executable (legacy UAI desktop app path).
      4. The vendored Python tree itself (`python/uai/`) — only useful
         for dev runs where models live alongside the source.
    """
    if root is not None:
        return Path(root).resolve()
    env_root = os.environ.get("RTM_UAI_APPLICATION_ROOT")
    if env_root:
        return Path(env_root).resolve()
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


def _decode_path(parts: tuple[str, ...]) -> Path:
    decoded = [base64.b64decode(part).decode("utf-8") for part in parts]
    return Path(*decoded)


def file_sha256(path: Path) -> str:
    """Calculate the SHA-256 digest for a file."""

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def get_onnx_providers(device: str) -> list[str]:
    """Return ONNX Runtime providers for the requested runtime device.

    CUDA is opt-in and only used when the installed ONNX Runtime wheel
    actually exposes ``CUDAExecutionProvider``. CPU remains the fallback for
    Mac MPS, CPU requests, and CUDA requests on CPU-only installations.
    """
    normalized = str(device or "cpu").strip().lower()
    cpu_providers = ["CPUExecutionProvider"]
    if normalized != "cuda":
        return cpu_providers

    try:
        import onnxruntime as ort  # noqa: WPS433 - optional runtime dependency
        available = list(ort.get_available_providers())
    except Exception as exc:
        logger.warning(
            "CUDA ONNX provider requested, but ONNX Runtime providers could "
            "not be inspected (%s); falling back to CPUExecutionProvider",
            exc,
        )
        return cpu_providers

    if "CUDAExecutionProvider" in available:
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]

    logger.warning(
        "CUDA ONNX provider requested, but CUDAExecutionProvider is not "
        "available from ONNX Runtime providers %s; falling back to "
        "CPUExecutionProvider",
        available,
    )
    return cpu_providers


def resolve_model_path(
    key: str,
    root: Optional[Path | str] = None,
    verify: bool = True,
) -> Optional[Path]:
    """Resolve and optionally verify a configured model path."""

    spec = _MODEL_SPECS[key]
    path = application_root(root) / _decode_path(spec.encoded_parts)
    if not path.exists():
        return None

    if verify:
        actual = file_sha256(path)
        if actual.lower() != spec.sha256.lower():
            raise ModelIntegrityError(
                f"Model integrity check failed for {spec.key}: expected {spec.sha256}, got {actual}"
            )
    return path


def runtime_model_paths(root: Optional[Path | str] = None) -> Dict[str, Optional[Path]]:
    """Return verified runtime model paths keyed by model role."""

    paths: Dict[str, Optional[Path]] = {}
    for key in _MODEL_SPECS:
        paths[key] = resolve_model_path(key, root=root, verify=True)
    return paths
