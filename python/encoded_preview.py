"""
Encoded-Preview Audition — render an AAC 256 kbps preview of the
loudest window of an audio file at each DSP's normalisation gain, so
the engineer can hear what Apple / Spotify / Amazon listeners actually
get through the codec (not just the LPCM measurement).

Replaces the Apple Digital Masters Droplet / RoundTripAAC dependency —
one of the top asks from the mastering-engineer persona.

Status: SCAFFOLD. IPC + handler skeleton shipped; the ffmpeg render
itself is intentionally minimal so the reviewer can verify the shape
end-to-end before we commit to specific codec flags / metadata fields.

Implementation plan:
  1. Find the loudest 30 s window via 1 s-RMS scan (same trick as
     StreamingPreview's audition helper).
  2. Apply the DSP's normalisation gain to that window (dB → linear).
  3. Pipe to `ffmpeg -i - -c:a aac -b:a 256k -movflags +faststart`.
     Cache by (input path, dsp, loud-window offset) so repeat audition
     of the same DSP on the same file hits the cache.
  4. Return the output path to the renderer; the A/B player swaps it
     into the A-side buffer (A = encoded, B = source).

Usage:
    python3 encoded_preview.py <input.wav> <output.m4a> <dsp=apple|spotify|amazon|tidal|youtube>

The renderer calls this via a new Electron IPC (`encoded-preview-
render`) — see electron/main.ts and electron/preload.ts (TODO).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile

# Windows: bundled embeddable Python's _pth file does not auto-add the
# script directory to sys.path. Make neighbour modules (specs, etc.) importable.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import numpy as np
    import soundfile as sf
    from scipy.signal import resample_poly
    from scipy.ndimage import maximum_filter1d
except ImportError:  # pragma: no cover
    np = None  # type: ignore
    sf = None  # type: ignore
    resample_poly = None  # type: ignore
    maximum_filter1d = None  # type: ignore

from specs import SPECS


def _target_pair(spec_id: str) -> tuple[float, float]:
    targets = SPECS[spec_id].targets
    return float(targets["lufs_i"]), float(targets["tp_dbtp"])


# DSP normalisation gain table from python/specs.py. Key: DSP id. Value:
# (target_lufs, tp_ceiling). The renderer has already computed integrated
# LUFS; we apply the delta to target here.
_DSP_TARGETS: dict[str, tuple[float, float]] = {
    "apple": _target_pair("apple_music"),
    "spotify": _target_pair("spotify"),
    "spotifyLoud": _target_pair("spotify_loud"),
    "amazon": _target_pair("amazon_music"),
    "tidal": _target_pair("tidal"),
    "youtube": _target_pair("youtube"),
}

# Parallel lookup of DSP id → spec id, so we can pull the spec's
# normalisation policy fields (currently `max_boost_db`) without
# re-encoding the mapping in two places.
_DSP_SPEC_IDS: dict[str, str] = {
    "apple": "apple_music",
    "spotify": "spotify",
    "spotifyLoud": "spotify_loud",
    "amazon": "amazon_music",
    "tidal": "tidal",
    "youtube": "youtube",
}


def _db_to_linear(db: float) -> float:
    return 10.0 ** (db / 20.0)


def _resolve_aac_encoder() -> tuple[str, str] | None:
    """Pick the platform's preferred AAC encoder.

    Resolution order:
      1. macOS: /usr/bin/afconvert — built into every macOS, zero deps,
         Apple's own AAC encoder so the bitstream matches their ingest
         chain (which is the whole point of this preview).
      2. Windows: bundled ffmpeg.exe at
         Resources/python-bundle-win/ffmpeg/ffmpeg.exe (LGPL build,
         shipped with the portable so beta testers don't need to
         install ffmpeg themselves).
      3. Any platform: ffmpeg on PATH (homebrew / system install).

    Returns (kind, binary_path) where kind is "afconvert" or "ffmpeg",
    or None if no encoder is available — caller surfaces a `render ✕`
    chip in the streaming-preview UI instead of failing silently.
    """
    # 1. macOS native — afconvert
    if sys.platform == "darwin":
        afconvert = shutil.which("afconvert") or "/usr/bin/afconvert"
        if afconvert and os.path.exists(afconvert):
            return ("afconvert", afconvert)

    # 2. Windows bundled ffmpeg — Resources/python-bundle-win/ffmpeg/ffmpeg.exe
    #    encoded_preview.py lives in Resources/python/ in the packaged
    #    Electron app; one level up is Resources/, then into
    #    python-bundle-win/ffmpeg/ffmpeg.exe.
    if sys.platform == "win32":
        try:
            here = os.path.dirname(os.path.abspath(__file__))
            resources_dir = os.path.dirname(here)
            bundled = os.path.join(
                resources_dir, "python-bundle-win", "ffmpeg", "ffmpeg.exe"
            )
            if os.path.exists(bundled):
                return ("ffmpeg", bundled)
        except Exception:
            pass

    # 3. PATH fallback (any platform)
    ffmpeg = (
        shutil.which("ffmpeg")
        or shutil.which("/opt/homebrew/bin/ffmpeg")
        or shutil.which("/usr/local/bin/ffmpeg")
    )
    if ffmpeg:
        return ("ffmpeg", ffmpeg)
    return None


def _find_loudest_window(data: "np.ndarray", sr: int, window_sec: float = 30.0) -> int:
    """Return start sample offset of the highest-energy window_sec window.
    Cheap 1 s RMS step. Mirrors the JS implementation in
    src/components/StreamingPreview.tsx so A/B matches the streaming
    preview's audition window exactly.
    """
    assert np is not None
    if data.ndim > 1:
        mono = np.mean(data, axis=1)
    else:
        mono = data
    duration = len(mono) / float(sr)
    if duration <= window_sec:
        return 0
    frame = sr  # 1 s frames
    n_frames = int(len(mono) // frame)
    rms = np.zeros(n_frames, dtype=np.float32)
    for f in range(n_frames):
        seg = mono[f * frame : (f + 1) * frame]
        rms[f] = float(np.sqrt(np.mean(seg * seg) + 1e-12))
    peak = int(np.argmax(rms))
    start = max(0, int((peak - window_sec / 2.0) * sr))
    end = min(len(mono), start + int(window_sec * sr))
    if end - start < window_sec * sr:
        start = max(0, end - int(window_sec * sr))
    return start


def _tp_limit(window: "np.ndarray", sr: int, ceiling_db: float,
              lookahead_ms: float = 5.0, release_ms: float = 50.0,
              envelope_step_ms: float = 100.0) -> tuple["np.ndarray", list[float]]:
    """
    4×-oversampled look-ahead peak limiter — approximates the soft-knee
    TP limiters Apple / Spotify apply post-normalisation.

    Returns (limited_signal, gain_reduction_envelope).  The envelope is
    a list of dB-gain-reduction values, one per `envelope_step_ms`
    block, so the UI can render "where the limiter engaged" along the
    timeline (Streaming Delta Heatmap).  Negative dB = the limiter is
    pulling signal down; 0 dB = not engaged.
    """
    ceiling = _db_to_linear(ceiling_db)
    up = resample_poly(window, 4, 1, axis=0)
    up_sr = sr * 4
    abs_up = np.max(np.abs(up), axis=1) if up.ndim > 1 else np.abs(up)
    look = max(2, int(up_sr * lookahead_ms / 1000.0))
    rel  = max(2, int(up_sr * release_ms  / 1000.0))
    # Asymmetric sliding max: centred window of size (look + rel) gives
    # both peek-ahead and hold-behind behaviour in one cheap op.
    env = maximum_filter1d(abs_up, size=look + rel)
    gain = np.minimum(1.0, ceiling / (env + 1e-12))
    # One-pole smoothing on the gain so zipper artefacts don't leak
    # into the downsampled output.  Smooth the *rising* edge (release)
    # so the limiter "opens back up" gradually; keep the attack instant
    # so peaks are actually caught.
    smoothed = np.empty_like(gain)
    smoothed[0] = gain[0]
    alpha_rel = float(np.exp(-1.0 / (up_sr * release_ms / 1000.0)))
    for i in range(1, len(gain)):
        smoothed[i] = min(gain[i], alpha_rel * smoothed[i-1] + (1 - alpha_rel) * gain[i])

    # Downsample the gain envelope to `envelope_step_ms` blocks for the
    # heatmap — we only need a visual resolution, not sample-accurate
    # reduction.  Take the *minimum* gain per block (= worst-case
    # reduction) so short spikes aren't averaged away.
    step_samples_up = max(1, int(up_sr * envelope_step_ms / 1000.0))
    gr_envelope_db: list[float] = []
    for i in range(0, len(smoothed), step_samples_up):
        block = smoothed[i:i + step_samples_up]
        if block.size == 0:
            continue
        min_gain = float(np.min(block))
        # Gain is ≤ 1; log gives ≤ 0 dB (= reduction).  0 = no reduction.
        gr_db = 20 * np.log10(max(min_gain, 1e-9))
        gr_envelope_db.append(round(gr_db, 2))

    if up.ndim > 1:
        up = up * smoothed[:, None]
    else:
        up = up * smoothed
    return resample_poly(up, 1, 4, axis=0), gr_envelope_db


def render_encoded_preview(
    src_path: str,
    out_path: str,
    dsp: str = "apple",
    integrated_lufs: float | None = None,
    window_sec: float = 30.0,
    window_start_sec: float | None = None,
) -> dict:
    """
    Render what each DSP *actually plays*: a full chain of
    (normalisation gain → true-peak limiter → AAC 256 k encode), not
    just the gain-staged LPCM we already audition in the browser.

    The reason this is a competitive edge: every other tool previews
    "your master at −5 dB."  We preview "what Apple's pipeline hands
    the user's earbuds."  Apple's TP limiter + 256 kb/s AAC codec
    introduces subtle character (pumping on hot transients, pre-echo
    on sharp stops, top-end smear) that's invisible until the file's
    out the door — and baked in, once it's through their pipeline.

    `integrated_lufs` — the file's integrated LUFS, already computed
    in the batch pass.  If omitted, assumes no gain (delta = 0), which
    is only useful as a codec-only audition.
    """
    if np is None or sf is None or resample_poly is None:
        return {"ok": False, "error": "numpy / soundfile / scipy not available in this Python environment"}
    if dsp not in _DSP_TARGETS:
        return {"ok": False, "error": f"unknown DSP id '{dsp}'"}
    # Encoder selection — prefer the platform's built-in tool so the
    # app works on a clean machine without Homebrew / ffmpeg installed.
    #   • macOS: afconvert (ships with every macOS, no install needed)
    #   • Windows/Linux: fall back to ffmpeg
    # We resolve to a concrete (encoder_kind, binary_path) pair here so
    # the actual encode call below can pick its arg layout per kind.
    encoder = _resolve_aac_encoder()
    if encoder is None:
        return {
            "ok": False,
            "error": (
                "No AAC encoder available. On macOS this should never "
                "happen (afconvert is built-in) — please file a bug. "
                "On Windows / Linux install ffmpeg."
            ),
        }

    target_lufs, tp_ceiling = _DSP_TARGETS[dsp]
    # Per-platform normalization policy (boost vs attenuate-only, and
    # the boost cap) lives in python/specs.py — the same source the
    # comparator's `streaming_preview` reads. Centralising means the
    # Mastering-Delta tab and the Sound Check twin agree on what each
    # platform does to a given master, instead of disagreeing on Apple
    # boost behaviour as before.
    spec = SPECS.get(_DSP_SPEC_IDS[dsp])
    max_boost = float(spec.targets.get("max_boost_db", 0.0)) if spec else 0.0
    raw_delta = 0.0
    if integrated_lufs is not None:
        raw_delta = target_lufs - integrated_lufs
    if raw_delta > 0:
        # Quiet master: boost is capped at the platform's max_boost_db
        # (0.0 for attenuate-only platforms — Apple, Tidal, YouTube,
        # Amazon, Deezer, SoundCloud).
        gain_db = min(raw_delta, max_boost)
    else:
        # Loud master: always attenuate to target.
        gain_db = raw_delta
    gain = _db_to_linear(gain_db)

    # Load + window.  When the caller passes window_start_sec we honour
    # it (panel ask: post-rock / ambient producers whose loudest 30s
    # isn't representative — let them pick any start point).  Otherwise
    # auto-detect the loudest 30 s window, same as before.
    data, sr = sf.read(src_path, dtype="float32")
    if window_start_sec is not None and window_start_sec >= 0:
        start = max(0, min(len(data) - int(window_sec * sr), int(window_start_sec * sr)))
    else:
        start = _find_loudest_window(data, sr, window_sec=window_sec)
    end = min(len(data), start + int(window_sec * sr))
    window = data[start:end].copy()
    window *= gain

    # Real TP limiter — 4× oversampled, lookahead-smoothed.  Replaces
    # the old hard-clip at −0.5 dBFS, which was incorrect for any
    # serious "what will Apple do" claim.  We also grab the per-block
    # gain-reduction envelope so the UI can render a Streaming Delta
    # Heatmap — red where the DSP's limiter engaged, quiet elsewhere.
    window, gr_envelope_db = _tp_limit(window, sr, ceiling_db=tp_ceiling)

    # Worst-case gain reduction across the window, for the summary
    # "Apple's limiter engaged by X dB on your loudest passage."
    worst_gr_db = min(gr_envelope_db) if gr_envelope_db else 0.0

    # Measure the post-limit peak so the UI can also show final level.
    with np.errstate(divide="ignore"):
        post_peak_lin = float(np.max(np.abs(window))) if window.size else 0.0
        post_peak_db  = float(20 * np.log10(post_peak_lin + 1e-12))

    # Write window to temp WAV, encode to AAC 256 k via the resolved
    # encoder (afconvert on macOS, ffmpeg on Windows / Linux).
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_wav = tmp.name
    try:
        # afconvert needs PCM_16 input (won't read FLOAT WAVs reliably);
        # ffmpeg reads anything. Convert to int16 here and trust the
        # surrounding TP limiter to keep us under 0 dBFS.
        sf.write(tmp_wav, window, sr, subtype="PCM_16")
        kind, binary = encoder
        if kind == "afconvert":
            cmd = [
                binary,
                "-f", "m4af",       # MPEG-4 Audio (.m4a) container
                "-d", "aac",        # AAC-LC codec
                "-b", "256000",     # 256 kbps target bitrate
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
            tail = (proc.stderr or proc.stdout or "")[-400:]
            return {"ok": False, "error": f"{kind} exit {proc.returncode}: {tail}"}
    finally:
        try: os.remove(tmp_wav)
        except OSError: pass
    return {
        "ok": True, "path": out_path,
        "dsp": dsp, "gain_db": round(gain_db, 2),
        "target_lufs": target_lufs, "tp_ceiling": tp_ceiling,
        "post_limiter_peak_db": round(post_peak_db, 2),
        "worst_gr_db": round(worst_gr_db, 2),
        "gr_envelope_db": gr_envelope_db,
        "gr_envelope_step_ms": 100,
        "window_start_sec": start / float(sr),
        "window_duration_sec": window_sec,
    }


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "usage: encoded_preview.py <input> <output> [dsp] [integrated_lufs]"}))
        sys.exit(1)
    src = sys.argv[1]
    out = sys.argv[2]
    dsp = sys.argv[3] if len(sys.argv) > 3 else "apple"
    # Accept empty-string placeholders for optional numeric positional
    # args so the CLI can be called with `... dsp '' start_sec`.
    lufs_arg = sys.argv[4] if len(sys.argv) > 4 else ''
    lufs = float(lufs_arg) if lufs_arg not in ('', 'null', 'None') else None
    start_arg = sys.argv[5] if len(sys.argv) > 5 else ''
    start_sec = float(start_arg) if start_arg not in ('', 'null', 'None') else None
    print(json.dumps(render_encoded_preview(src, out, dsp=dsp, integrated_lufs=lufs, window_start_sec=start_sec)))
