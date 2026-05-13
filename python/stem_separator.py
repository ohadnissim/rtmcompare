"""
Stem separator — thin wrapper that tries BS-RoFormer first, falls back to Demucs.

BS-RoFormer (SDR 9.6568 on MUSDB18) is the default.  Demucs htdemucs is the
fallback for environments where audio_separator is not available or the ckpt is
missing.

Usage:
    stems_dir = separate_stems(audio_path, output_dir)
    # Returns path to directory containing vocals.wav, drums.wav, bass.wav, other.wav

Implementation note
-------------------
The heavy lifting is done by ``separator.py``, which already runs the full
four-tier fallback chain:

    mel_band_roformer_4stem → bs_roformer_4stem → cascade → demucs → legacy

This module exposes a ``separate_stems(audio_path, output_dir) -> str | None``
interface (as requested) by delegating to ``separator.separate`` and returning
the ``output_dir`` on success.  The ``MODEL_DIR``, ``BS_ROFORMER_CKPT``, and
``BS_ROFORMER_YAML`` constants are exposed for callers that want to inspect the
model cache location (e.g., build scripts, smoke tests).
"""

from __future__ import annotations

import os
import logging
import pathlib
import sys
from typing import Optional

logger = logging.getLogger(__name__)

# ── Model-cache location ──────────────────────────────────────────────────────
# Canonical path used by separator.py and electron-builder extraResources.
# On macOS app bundles the Resources/ layout mirrors this via RTM_UAI_APPLICATION_ROOT.
_PYTHON_DIR = pathlib.Path(__file__).resolve().parent
_RTM_ROOT = _PYTHON_DIR.parent

MODEL_DIR: str = os.path.abspath(
    str(_RTM_ROOT / "model-cache" / "uai_root" / "models")
)

BS_ROFORMER_CKPT = "bs_roformer_4stem_ep_17_sdr_9.6568.ckpt"
BS_ROFORMER_YAML = "bs_roformer_4stem_ep_17_sdr_9.6568.yaml"

# ── Ensure RTM_UAI_APPLICATION_ROOT is set before importing separator ─────────
# separator.py sets this via os.environ.setdefault, but if stem_separator is
# imported first we set it here so all downstream UAI imports agree.
os.environ.setdefault(
    "RTM_UAI_APPLICATION_ROOT",
    str(_RTM_ROOT / "model-cache" / "uai_root"),
)
# Make the python/ dir importable (separator.py expects this).
if str(_PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(_PYTHON_DIR))


def separate_stems(audio_path: str, output_dir: str) -> Optional[str]:
    """Separate *audio_path* into 4 stems written under *output_dir*.

    Tries BS-RoFormer first (higher quality, SDR 9.66 dB) via the full UAI
    backend stack, then falls back to Demucs htdemucs.

    Returns *output_dir* on success (the directory will contain
    ``vocals.wav``, ``drums.wav``, ``bass.wav``, ``other.wav``), or
    ``None`` if every backend failed.

    Note: the returned path is *output_dir* for BS-RoFormer / cascade
    backends (flat layout), and a *subdirectory* of *output_dir* for the
    legacy Demucs backend (nested layout).  ``masking.py`` handles both.
    """
    try:
        from separator import separate  # type: ignore
    except ImportError:
        logger.error(
            "stem_separator: could not import separator.py — "
            "ensure the python/ directory is on sys.path"
        )
        return None

    try:
        stem_paths = separate(audio_path, output_dir)
        if stem_paths:
            # Determine the common directory of the returned paths.
            # BS-RoFormer / cascade → all files land in output_dir (flat).
            # Legacy Demucs → they land in output_dir/<basename>/ (nested).
            dirs = {os.path.dirname(p) for p in stem_paths.values()}
            result_dir = dirs.pop() if len(dirs) == 1 else output_dir
            logger.info("Stem separation complete → %s", result_dir)
            return result_dir
        return None
    except Exception as exc:
        logger.error("Stem separation failed: %s", exc)
        return None
