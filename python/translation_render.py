"""
Translation-check render — apply a playback-environment simulation to
a 30-second window of a master and encode the result to AAC 256 kbps so
the engineer can audition what the master will sound like through:

  - phone_speaker · modern phone driver
  - earbuds       · consumer earbuds (AirPods-ish)
  - club_pa       · house-system PA with mono-sum sub
  - car_cabin     · generic mid-class consumer car cabin

This is its own pipeline, separate from `encoded_preview.py` (which
models platform-streaming normalisation). Translation check skips
platform normalisation entirely — it tells you what the MIX sounds
like in that environment, not what each streaming platform serves.

Usage (called via the Electron `translation-render` IPC):

    python3 translation_render.py <input.wav> <output.m4a> <env_id> [start_sec]

Produces a JSON object on stdout:
    {"ok": true, "path": "...", "env_id": "phone_speaker",
     "lost_lf_db": <float>, "presence_change_db": <float>,
     "window_start_sec": <int>, "window_duration_sec": 30}

`lost_lf_db` and `presence_change_db` are simple before/after RMS
deltas on the LF (<200 Hz) and presence (1.5-5 kHz) bands so the UI
can show a one-line insight without a full visualization.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile

# Windows: bundled embeddable Python's _pth file does not auto-add the
# script directory to sys.path. Make neighbour modules importable.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import numpy as np
    import soundfile as sf
except ImportError:  # pragma: no cover
    np = None
    sf = None

from playback_env import apply_playback_env, ENVS, ENV_DESCRIPTIONS
from encoded_preview import (
    _resolve_aac_encoder,
    _find_loudest_window,
)


def _band_rms_db(y: "np.ndarray", sr: int, lo: float, hi: float) -> float:
    """Crude band-energy in dB (RMS over the LF or presence band) so we
    can produce a single-number before/after delta the UI can show
    without a heatmap."""
    from scipy.signal import butter, sosfilt
    nyq = sr / 2
    sos = butter(4, [lo / nyq, min(hi, nyq - 1) / nyq], btype="band", output="sos")
    if y.ndim > 1:
        mono = np.mean(y, axis=1)
    else:
        mono = y
    band = sosfilt(sos, mono)
    rms = float(np.sqrt(np.mean(band * band) + 1e-12))
    return 20.0 * float(np.log10(max(rms, 1e-10)))


def render_translation(src_path: str, out_path: str, env_id: str,
                        window_start_sec: float | None = None,
                        window_sec: float = 30.0) -> dict:
    if np is None or sf is None:
        return {"ok": False, "error": "numpy / soundfile not available"}

    if env_id not in ENVS:
        return {"ok": False, "error": f"unknown env_id '{env_id}'. valid: {sorted(ENVS.keys())}"}

    encoder = _resolve_aac_encoder()
    if encoder is None:
        return {"ok": False, "error": (
            "No AAC encoder available. macOS afconvert is built-in; on "
            "Windows the bundled python-bundle-win/ffmpeg/ffmpeg.exe is "
            "used. If neither resolves, the renderer surfaces a `render ✕` "
            "chip in the platform row."
        )}

    data, sr = sf.read(src_path, dtype="float32")
    if window_start_sec is not None and window_start_sec >= 0:
        start = max(0, min(len(data) - int(window_sec * sr), int(window_start_sec * sr)))
    else:
        start = _find_loudest_window(data, sr, window_sec=window_sec)
    end = min(len(data), start + int(window_sec * sr))
    window = data[start:end].copy()

    # Before-state band energies (for the UI's one-line insight)
    lf_before  = _band_rms_db(window, sr, 30.0, 200.0)
    pres_before = _band_rms_db(window, sr, 1500.0, 5000.0)

    # Apply the playback-env transform. 5.3.1: returns (samples, info).
    transformed, env_info = apply_playback_env(window, sr, env_id)

    lf_after  = _band_rms_db(transformed, sr, 30.0, 200.0)
    pres_after = _band_rms_db(transformed, sr, 1500.0, 5000.0)

    lost_lf_db = round(lf_after - lf_before, 1)        # negative = lost low-end
    presence_change_db = round(pres_after - pres_before, 1)

    # Encode to AAC 256 kbps via the resolved encoder.
    # 5.3.1: write a 32-bit float WAV (PCM_16 was the source of audible
    # quantization noise on top of the saturated content). The AAC
    # encoder downconverts internally with proper dither.
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_wav = tmp.name
    try:
        sf.write(tmp_wav, transformed, sr, subtype="FLOAT")
        kind, binary = encoder
        if kind == "afconvert":
            cmd = [
                binary,
                "-f", "m4af",
                "-d", "aac",
                "-b", "256000",
                tmp_wav, out_path,
            ]
        else:  # ffmpeg
            cmd = [
                binary, "-y",
                "-i", tmp_wav,
                "-c:a", "aac",
                "-b:a", "256k",
                "-movflags", "+faststart",
                out_path,
            ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            return {"ok": False, "error": f"encoder exit {proc.returncode}: {proc.stderr[-400:]}"}
    finally:
        try:
            os.unlink(tmp_wav)
        except Exception:
            pass

    return {
        "ok": True,
        "path": out_path,
        "env_id": env_id,
        "env_label": ENV_DESCRIPTIONS.get(env_id, env_id),
        "lost_lf_db": lost_lf_db,
        "presence_change_db": presence_change_db,
        "window_start_sec": round(start / sr, 3),
        "window_duration_sec": window_sec,
        # 5.3.1: surface chain headroom + saturator state so the UI
        # can warn the user if the simulation pushed signal hard.
        "headroom_db_applied": env_info.get("headroom_db_applied"),
        "peak_dbfs_post_chain": env_info.get("peak_dbfs_post_chain"),
        "saturator_engaged": env_info.get("saturator_engaged"),
    }


def _main(argv: list[str]) -> int:
    if len(argv) < 4:
        sys.stderr.write(
            "usage: translation_render.py <input> <output> <env_id> [start_sec]\n"
        )
        return 2
    src, out, env_id = argv[1], argv[2], argv[3]
    start_arg: float | None = None
    if len(argv) >= 5 and argv[4]:
        try:
            start_arg = float(argv[4])
        except ValueError:
            start_arg = None
    result = render_translation(src, out, env_id, window_start_sec=start_arg)
    sys.stdout.write(json.dumps(result))
    sys.stdout.write("\n")
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(_main(sys.argv))
