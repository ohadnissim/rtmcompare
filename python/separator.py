"""Stem separator — UAI BS-RoFormer 4-stem (state-of-the-art) with
Demucs htdemucs as a graceful fallback.

5.3.x: replaces the Demucs-only path. The new BS-RoFormer 4-stem
checkpoint (`models/bs_roformer_4stem_ep_17_sdr_9.6568.ckpt`) trained
by ZFTurbo on MUSDB18HQ scores SDR 9.66 — meaningfully better than
htdemucs (~7.0 SDR) at separating drums/bass/other/vocals in one pass.

Public API kept stable for RTM's analyze.py + masking.py callers:

    separate(audio_path, output_dir, progress_cb=None) -> dict[stem, wav_path]

Stem keys: vocals, drums, bass, other.

Fallback chain on any failure (model load, OOM, audio-separator wheel
missing, torch version mismatch): drop to UAI's cascade backend
(roformer-vocals + htdemucs-instrumentals), then to plain htdemucs,
then to RTM's pre-5.3 separator_demucs.py path. RTM's analyze pipeline
handles "no stems" gracefully — UI hides the masking + AI panels.
"""
from __future__ import annotations

import os
import pathlib
import sys
from typing import Callable, Dict, Optional

# ── Configure UAI's vendored runtime to find models in RTM's model-cache ──
# This MUST happen before any uai.* import that resolves model paths.
_RTM_PYTHON_DIR = pathlib.Path(__file__).resolve().parent
_RTM_ROOT = _RTM_PYTHON_DIR.parent
os.environ.setdefault(
    "RTM_UAI_APPLICATION_ROOT",
    str(_RTM_ROOT / "model-cache" / "uai_root"),
)
# Make the vendored UAI package importable.
if str(_RTM_PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(_RTM_PYTHON_DIR))

# ── CoreML / Apple Silicon acceleration ───────────────────────────────────────
# On arm64 macOS, pass device="mps" to UAI backends so they activate their
# built-in CoreML execution-provider path (sets onnx_execution_provider to
# ["CoreMLExecutionProvider"] when onnxruntime-coreml is installed).
# Delivers ~3–5× speedup over the CPU provider via GPU/ANE offload.
# Falls back silently to CPU if onnxruntime-coreml is not installed.
def _detect_uai_device() -> str:
    """Return 'mps' on arm64 macOS when CoreML is available, else 'cpu'."""
    if sys.platform != "darwin":
        return "cpu"
    try:
        if os.uname().machine != "arm64":
            return "cpu"
        import onnxruntime as _ort  # type: ignore
        if "CoreMLExecutionProvider" in _ort.get_available_providers():
            return "mps"
    except Exception:
        pass
    return "cpu"

_UAI_DEVICE = _detect_uai_device()


def separate(audio_path: str, output_dir: str,
             progress_cb: Optional[Callable[[str], None]] = None) -> Dict[str, str]:
    """Separate `audio_path` into per-stem WAVs in `output_dir`.

    Returns a mapping `{stem_name: wav_path}` with keys
    `vocals / drums / bass / other`.

    Tries BS-RoFormer 4-stem first (UAI default); falls through to
    cascade → plain demucs → legacy `separator_demucs.py`.
    """
    if progress_cb:
        progress_cb(f"Separating: {os.path.basename(audio_path)}")

    os.makedirs(output_dir, exist_ok=True)

    backends_to_try = ("mel_band_roformer_4stem", "bs_roformer_4stem", "cascade", "demucs")
    last_error: Optional[BaseException] = None
    for backend_name in backends_to_try:
        try:
            from uai.core.stem_backends import get_backend  # type: ignore
            if progress_cb:
                progress_cb(f"Loading {backend_name} backend…")
            backend = get_backend(backend_name, device=_UAI_DEVICE)
            if progress_cb:
                progress_cb("Processing…")
            stem_paths = backend.separate(audio_path, output_dir)
            # Normalise to canonical RTM keys. UAI's BS-RoFormer emits
            # exactly `vocals / drums / bass / other`; cascade emits the
            # same names; htdemucs emits the same. No remap needed.
            return {k: v for k, v in stem_paths.items()
                    if k in ("vocals", "drums", "bass", "other")}
        except Exception as err:  # noqa: BLE001
            last_error = err
            sys.stderr.write(
                f"[separator] {backend_name} backend failed: {err}\n"
            )
            continue

    # Last-resort: RTM's pre-5.3 demucs wrapper. Same public shape.
    sys.stderr.write(
        "[separator] all UAI backends failed; falling back to legacy "
        "separator_demucs.py\n"
    )
    try:
        from separator_demucs import separate as _legacy_separate  # type: ignore
        return _legacy_separate(audio_path, output_dir, progress_cb)
    except Exception as err:  # noqa: BLE001
        sys.stderr.write(f"[separator] legacy fallback also failed: {err}\n")
        if last_error is not None:
            raise last_error
        raise
