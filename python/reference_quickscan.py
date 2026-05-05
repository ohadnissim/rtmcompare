"""
Reference Library quick-scan — lightweight analysis designed for adding
a reference track to the library.

Why not reuse analyze.py?  The full single-file pass takes 2-4 seconds
per track because it runs click / distortion / hum / transient / masking
/ AI detection / tonal-issues — expensive work that doesn't help the
library.  The library only needs what the UI surfaces: LUFS-I, TP, LRA,
duration, spectrum curve (31-band), BPM/key when available, genre
fingerprint, tags (which the user sets, not us).

This module loads the file once, runs the small subset, returns the
result as a dict ready to JSON-serialise into the index file.

Runtime target: < 1 s per track on a ~5 min master.

Usage:
    python3 reference_quickscan.py <path>
    # emits a single JSON line on stdout
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

# Windows: bundled embeddable Python's _pth file does not auto-add the
# script directory to sys.path. Make neighbour modules importable.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
import librosa
import soundfile as sf
import pyloudnorm as pyln
from scipy.signal import resample_poly

# Reference Library entries are persisted in `~/.rtm/references.json`.
# Stamp the spec-pack version so SpecDriftBadge can detect when an
# entry was scanned against an older spec snapshot — same contract as
# `python/batch_analyze.py:46-51` and `python/analyze.py`'s main result.
sys.path.insert(0, os.path.dirname(__file__))
try:
    from specs import SPECS_VERSION, to_json as _specs_to_json  # type: ignore
except Exception:
    SPECS_VERSION = None
    _specs_to_json = None  # type: ignore


def _spec_versions() -> dict | None:
    if SPECS_VERSION is None or _specs_to_json is None:
        return None
    try:
        return {
            "version": SPECS_VERSION,
            "evaluated_at": datetime.now(timezone.utc).isoformat(),
            "specs": _specs_to_json(),
        }
    except Exception:
        return None


# 31-band 1/3-octave centres (20 Hz → 20 kHz).  Matches dspProfiles and
# SpectrumOverlay's FREQ_LABELS so the library's spectrum thumbnails
# stack against the analysis spectrum without a rebin.
_THIRD_OCTAVE_CENTRES_HZ = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
    200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
    2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
]


def _third_octave_spectrum(mono: np.ndarray, sr: int) -> list[float]:
    """31-band spectrum in dB relative to the band peak.  Negative dB
    values; 0 dB = the loudest band.  Exactly the shape AnalysisResult
    ships, so Reference Library rows can be compared like-for-like in
    the spectrum overlay.
    """
    n_fft = 8192
    win = int(n_fft)
    # Use a central 20-second window — enough for stable averaging
    # without spending a second on librosa.stft for full tracks.
    start = max(0, len(mono) // 2 - 10 * sr)
    end = min(len(mono), start + 20 * sr)
    seg = mono[start:end]
    if len(seg) < win:
        seg = np.pad(seg, (0, win - len(seg)))
    stft = np.abs(librosa.stft(seg, n_fft=n_fft, hop_length=n_fft // 2, window="hann"))
    avg = np.mean(stft, axis=1)  # (freq,)
    fft_freqs = np.linspace(0, sr / 2, len(avg))

    bands: list[float] = []
    for i, centre in enumerate(_THIRD_OCTAVE_CENTRES_HZ):
        # Third-octave bounds: 2^(±1/6) around the centre.
        f_lo = centre * 2 ** (-1 / 6)
        f_hi = centre * 2 ** (1 / 6)
        mask = (fft_freqs >= f_lo) & (fft_freqs < f_hi)
        energy = float(np.sum(avg[mask] ** 2))
        bands.append(energy)
    peak = max(bands) if bands else 1.0
    if peak <= 0:
        return [0.0] * len(bands)
    return [round(10.0 * np.log10((b + 1e-12) / peak), 1) for b in bands]


def _true_peak_db(mono: np.ndarray, sr: int) -> float:
    up = resample_poly(mono, 4, 1)
    peak = float(np.max(np.abs(up)) + 1e-12)
    return round(20.0 * np.log10(peak), 2)


def _bpm_key(mono: np.ndarray, sr: int) -> tuple[float | None, str | None]:
    """Cheap BPM + key probe — skip when file is too short to be useful."""
    if len(mono) < sr * 10:
        return None, None
    try:
        tempo, _ = librosa.beat.beat_track(y=mono, sr=sr)
        if isinstance(tempo, np.ndarray):
            tempo = float(tempo.item()) if tempo.size == 1 else float(tempo.mean())
        else:
            tempo = float(tempo)
        bpm = round(tempo, 1) if tempo > 0 else None
    except Exception:
        bpm = None
    try:
        # Chroma-based key estimation — cheap, reasonable on tonal music.
        chroma = librosa.feature.chroma_cens(y=mono[:sr * 60], sr=sr)
        avg = chroma.mean(axis=1)
        idx = int(np.argmax(avg))
        key_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
        key = key_names[idx]
    except Exception:
        key = None
    return bpm, key


def quickscan(path: str) -> dict:
    """Run the library's lightweight pass on one file.  Returns a dict
    shaped for the ~/.rtm/references.json index.  Every field except
    `path`, `filename`, `added_at` is optional — if analysis fails
    mid-way we emit what we have and flag `error`.
    """
    try:
        data, sr = sf.read(path, dtype="float32")
        if data.ndim > 1:
            mono = np.mean(data, axis=1)
        else:
            mono = data.copy()
    except Exception as e:
        return {"error": f"read failed: {e}"}

    out: dict = {
        "sample_rate": int(sr),
        "channels": int(data.ndim if data.ndim == 1 else data.shape[1]),
        "duration_sec": round(len(mono) / float(sr), 2),
    }

    # LUFS-I + LRA via pyloudnorm.  Stereo-aware when we have stereo.
    try:
        meter = pyln.Meter(sr)
        if data.ndim == 1:
            lufs_input = data[:, None]
        else:
            lufs_input = data[:, :2] if data.shape[1] > 2 else data
        out["lufs_i"] = round(float(meter.integrated_loudness(lufs_input)), 2)
    except Exception:
        out["lufs_i"] = None
    try:
        # LRA: pyloudnorm 0.1.1+ has a `loudness_range` helper; if not,
        # skip.  Not a blocker for library inclusion.
        if hasattr(meter, "loudness_range"):
            out["lra"] = round(float(meter.loudness_range(lufs_input)), 2)
    except Exception:
        pass

    out["true_peak_dbtp"] = _true_peak_db(mono, sr)
    out["spectrum"] = _third_octave_spectrum(mono, sr)

    bpm, key = _bpm_key(mono, sr)
    if bpm is not None: out["bpm"] = bpm
    if key is not None: out["key"] = key

    sv = _spec_versions()
    if sv is not None:
        out["spec_versions"] = sv

    return out


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: reference_quickscan.py <path>"}))
        sys.exit(1)
    print(json.dumps(quickscan(sys.argv[1])))
