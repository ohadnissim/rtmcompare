#!/usr/bin/env python3
"""
RTMprofile — build an engineer-style mastering profile from a corpus
of audio files.

Drops `N` audio files in. Produces a single JSON profile that loads
into RTMcompare's Match tab via `~/.rtm/profiles/<slug>.json`.

The output schema matches `python/profiles/<name>.json` in the
RTMcompare repo:

    {
      "name":              str,
      "role":              str,
      "description":       str,
      "sample_count":      int,
      "curve":             [31 floats]   ← third-octave dB, mean-centred
      "curve_mad":         [31 floats]   ← per-band median absolute deviation
      "lufs_avg":          float,
      "lufs_std":          float,
      "lufs_range":        [min, max],
      "dynamic_range_avg": float,
      "dynamic_range_std": float,
      "width_avg":         float,
      "width_std":         float,
      "peak_avg":          float
    }

(5.2.3: "genres" field removed — was decorative metadata that didn't
drive any downstream behaviour. The user-typed value lived in the JSON
but no consumer read it.)

Usage:
    python3 build_profile.py \
        --name "Engineer Name" --role "Mastering Engineer" \
        --out engineer-name.json \
        track1.wav track2.wav ...

The Electron wrapper (rtm-profile-app/electron/main.ts) calls this
script with the user's file list + metadata and reads the JSON back.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac as _hmac
import json
import math
import os as _os
import sys
import unicodedata as _ucd
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import lru_cache
from pathlib import Path
from threading import Lock
from typing import Any

# ── Track analysis cache ───────────────────────────────────────────────
#
# Content-addressed cache: ~/.rtm/tracks/<sha256>.json stores the
# per-file measurement dict keyed by the file's SHA-256. A cache hit
# skips the entire analysis pipeline (Welch PSD, LUFS, True Peak, etc.)
# for that file.
#
# Cache invalidation: the entry's `_cache_schema_version` field must match
# the current SCHEMA_VERSION. If the analysis algorithm changes (schema
# bump), old entries are silently ignored and rebuilt.
#
# Rebuild: 10-track Deep Scan profile (8 min cold) → 30 sec on rebuild
# if tracks are unchanged (cache hit for all 10 files).
#
# The cache directory is ~/.rtm/tracks/ and is created on first write.
# Disable with --no-cache flag (useful for benchmarking or debugging).

_TRACK_CACHE_VERSION = 4   # must match schema_version in aggregate()


def _track_cache_dir() -> Path:
    return Path.home() / ".rtm" / "tracks"


def _file_sha256(path: Path) -> str:
    """Compute SHA-256 of a file in 4 MB chunks. Fast on SSDs (~50 MB/s)."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(4 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def _cache_load(sha: str) -> dict[str, Any] | None:
    """Return cached measurement dict if present and schema matches, else None."""
    try:
        cache_path = _track_cache_dir() / f"{sha}.json"
        if not cache_path.exists():
            return None
        with open(cache_path, encoding="utf-8") as fh:
            entry = json.load(fh)
        if entry.get("_cache_schema_version") != _TRACK_CACHE_VERSION:
            return None  # stale — different algorithm
        return entry
    except Exception:
        return None


def _cache_store(sha: str, data: dict[str, Any]) -> None:
    """Write measurement dict to track cache. Silent on failure."""
    try:
        cache_dir = _track_cache_dir()
        cache_dir.mkdir(parents=True, exist_ok=True)
        entry = {**data, "_cache_schema_version": _TRACK_CACHE_VERSION}
        tmp = cache_dir / f"{sha}.json.tmp"
        tmp.write_text(json.dumps(entry, indent=2), encoding="utf-8")
        _os.replace(tmp, cache_dir / f"{sha}.json")
    except Exception:
        pass  # cache write failure is non-fatal

import numpy as np
import soundfile as sf
import pyloudnorm as pyln
# reinvention-fix (2026-05): True Peak uses soxr for 4× upsampling.
# scipy.signal.resample_poly introduces Gibbs ringing artefacts near intersample
# peaks, causing ±0.3-0.5 dBTP measurement error (violates BS.1770-4 Annex 2).
# soxr's high-quality FIR filter meets the standard's interpolation requirement.
# Falls back to resample_poly if soxr is absent in this bundle.
try:
    import soxr as _soxr
    _HAVE_SOXR = True
except ImportError:
    from scipy.signal import resample_poly as _resample_poly_fallback
    _HAVE_SOXR = False


# MED-8: cache pyloudnorm Meter instances — constructing one allocates
# K-weighting filter coefficients; doing it for every file in a 200-track
# corpus wastes ~0.5 s of CPU. Keyed on sample rate.
@lru_cache(maxsize=8)
def _get_meter(sr: int) -> pyln.Meter:
    return pyln.Meter(sr)


# ── Standard 31-band third-octave centre frequencies (ISO 266) ──
# Same set the RTMcompare analyser ships, so the profile's `curve`
# index N corresponds to the same band in both apps.
THIRD_OCTAVE_HZ: list[float] = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
    200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
    2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
]


def _to_mono(y: np.ndarray) -> np.ndarray:
    if y.ndim == 1:
        return y
    if y.shape[1] == 1:
        return y[:, 0]
    return np.mean(y, axis=1)


# ── Numerical-stability guards (5.7.1) ────────────────────────────────
#
# Audit Task 4: rather than letting bad inputs detonate deep inside DSP
# (Welch on zero-length, log10 of zero, etc.), reject upfront with a
# clear diagnostic. The caller (measure_file) treats a None as "skip
# this file" and aggregate() raises if no valid files survive.
MIN_SR = 22050
MAX_SR = 192000
MIN_SAMPLES = 2048    # ~46 ms at 44.1 k — anything shorter fails Welch anyway


def _validate_signal(data: np.ndarray, sr: int, path: str) -> tuple[np.ndarray, int, dict[str, Any]] | None:
    """Sanity-check `data, sr` before measurement. Returns
    `(data, sr, flags)` if usable, or None to skip. `flags` carries
    optional metadata tags (e.g. clip_warning) for downstream JSON.
    """
    flags: dict[str, Any] = {}

    # Zero-length / empty array — fast reject.
    if data is None or data.size == 0:
        sys.stderr.write(f"[skip] {path}: empty signal\n")
        return None

    # Zero-length per-channel after potential reshape.
    if data.ndim >= 1 and data.shape[0] < MIN_SAMPLES:
        sys.stderr.write(
            f"[skip] {path}: too short ({data.shape[0]} samples; need >= {MIN_SAMPLES})\n"
        )
        return None

    # Sample-rate sanity. Welch's nperseg + third-octave centres assume
    # a "normal" audio sr; <22 k breaks the high bands and >192 k is
    # almost certainly a corrupt header.
    if not isinstance(sr, (int, np.integer)) or sr < MIN_SR or sr > MAX_SR:
        sys.stderr.write(
            f"[skip] {path}: sample rate {sr} Hz out of range [{MIN_SR}, {MAX_SR}]\n"
        )
        return None

    # Replace NaN/Inf with zeros so downstream math doesn't silently
    # poison the cohort. A track that is mostly NaN will fail the LUFS
    # gate later anyway.
    if not np.all(np.isfinite(data)):
        n_bad = int(np.sum(~np.isfinite(data)))
        sys.stderr.write(
            f"[warn] {path}: {n_bad} non-finite samples replaced with 0\n"
        )
        data = np.nan_to_num(data, nan=0.0, posinf=0.0, neginf=0.0)

    # Clip detection: tag (don't reject). Threshold tightened from
    # 0.99999 to a slightly looser float-domain check so 24-bit fixed
    # masters near-but-not-at full scale don't trip a false alarm.
    abs_max = float(np.max(np.abs(data))) if data.size else 0.0
    if abs_max >= 0.99999:
        flags["clip_warning"] = True

    return data, int(sr), flags


def _peak_dbtp(y: np.ndarray) -> float:
    """4×-oversampled true-peak per BS.1770-4 Annex 2.

    reinvention-fix (2026-05): uses soxr when available for accurate FIR
    interpolation that meets the BS.1770-4 Annex 2 requirements (±0.02 dBTP
    tolerance). scipy.signal.resample_poly has ±0.3-0.5 dBTP error due to
    Gibbs ringing near intersample peaks.
    """
    def _upsample_channel(ch_data: np.ndarray, sr_in: int = 44100) -> np.ndarray:
        if _HAVE_SOXR:
            return _soxr.resample(ch_data, sr_in, sr_in * 4, quality='HQ')
        else:
            return _resample_poly_fallback(ch_data, 4, 1)

    if y.ndim > 1:
        peaks = []
        for ch in range(y.shape[1]):
            up = _upsample_channel(y[:, ch])
            peaks.append(float(np.max(np.abs(up))))
        peak = max(peaks)
    else:
        up = _upsample_channel(y)
        peak = float(np.max(np.abs(up)))
    if peak <= 0:
        return -200.0
    return 20.0 * math.log10(peak)


def _lufs_integrated(y: np.ndarray, sr: int) -> float:
    """Integrated LUFS via pyloudnorm. Returns -inf for digital silence."""
    meter = _get_meter(sr)
    if y.ndim == 1:
        data = y.reshape(-1, 1)
    else:
        # pyloudnorm wants (samples, channels); soundfile returns that already.
        data = y
    try:
        return float(meter.integrated_loudness(data))
    except Exception:
        return float("-inf")


def _loudness_range(y: np.ndarray, sr: int) -> float:
    """Loudness range (LRA, in LU) per BS.1770-4 / EBU R128.

    5.3.1 fix: pre-5.3 this hand-rolled p95-p10 of `integrated_loudness`
    per 3 s window — but `integrated_loudness` is itself the gated
    integrated metric (BS.1770 §5), NOT short-term. So the percentile
    range was over the wrong distribution. Now we use pyloudnorm's
    proper `loudness_range` method (BS.1770-4 §B.2). Returns 0.0 if
    pyloudnorm is too old to expose it.
    """
    try:
        # 5.7.x correctness fix: drop the `block_size=3.0` argument.
        # Per BS.1770-4 §B.2, LRA is computed from 400 ms momentary
        # blocks with internal short-term gating. Forcing block_size=3.0
        # made pyloudnorm meter every 3 s, producing values ~30–40%
        # smaller than every other R128 meter. Audit CRITICAL #2.
        meter = _get_meter(sr)
        # 5.7.x: pyloudnorm < 0.1.1 raises on (N,1) shaped mono.
        # Squeeze (N,1) → 1-D so older versions don't blow up.
        data = y.squeeze() if y.ndim == 2 and y.shape[1] == 1 else y
        return float(meter.loudness_range(data))
    except Exception:
        # Older pyloudnorm or pathological input — NaN so _safe_median
        # skips this track rather than dragging the cohort to 0 LU.
        return float('nan')


def _third_octave_curve(y: np.ndarray, sr: int) -> list[float]:
    """31-band third-octave spectrum in dB (relative to RMS reference).
    Mean-centred so it represents tonal SHAPE, not absolute level.

    5.7.x audit fixes:
      - nperseg capped to signal length so very short files (<0.2 s)
        don't produce a degenerate one-bin Welch PSD.
      - Out-of-Nyquist bands return NaN instead of -90.0 so cohort
        aggregation can use np.nanmedian (mixed-sample-rate corpora
        used to skew the median toward -90 dB at 16/20 kHz when even
        one 44.1 k file was present alongside 96 k files).
    """
    mono = _to_mono(y)
    # All-zero / all-NaN frame — the Welch PSD would be uniformly tiny
    # and the resulting curve would centre to all zeros, which is not
    # informative. Return all-NaN so cohort aggregation skips this file.
    if mono.size == 0 or not np.any(np.isfinite(mono)) or float(np.max(np.abs(mono))) == 0.0:
        return [float('nan')] * len(THIRD_OCTAVE_HZ)
    # Cap nperseg to signal length — Welch warns + truncates internally,
    # but the resulting PSD is too coarse to populate third-octave masks
    # above ~3 kHz. Better to use a smaller window and accept reduced
    # frequency resolution than to let scipy silently degrade.
    # MED-7: normalize n_fft to sample rate so files at 96 kHz use a
    # larger window (matching their higher Nyquist) and produce the same
    # frequency resolution as 44.1 kHz files — otherwise a 44.1 k file
    # gets 8192/44100 ≈ 186 ms resolution while a 96 k file gets only
    # 8192/96000 ≈ 85 ms, making the two PSDs incomparable.
    n_fft = min(round(8192 * sr / 44100), len(mono))
    if n_fft < 64:
        # Shorter than ~1.5 ms at 44.1k — refuse to analyse.
        return [float('nan')] * len(THIRD_OCTAVE_HZ)
    # Use Welch's method for a smooth spectrum
    from scipy.signal import welch
    f, psd = welch(mono, fs=sr, nperseg=n_fft, noverlap=n_fft // 2, window='flattop', average="median")
    psd = np.maximum(psd, 1e-20)

    band_levels: list[float] = []
    for centre in THIRD_OCTAVE_HZ:
        # Third-octave edges
        lower = centre / (2 ** (1 / 6))
        upper = centre * (2 ** (1 / 6))
        if upper > sr / 2:
            # NaN — caller's nanmedian will skip this file's contribution
            # in cohort aggregation rather than averaging in -90 dB.
            band_levels.append(float('nan'))
            continue
        mask = (f >= lower) & (f <= upper)
        if not np.any(mask):
            band_levels.append(float('nan'))
            continue
        band_power = float(np.mean(psd[mask]))
        band_levels.append(10.0 * math.log10(max(band_power, 1e-20)))

    # Mean-centre so the curve is shape-only (engineer fingerprint),
    # not affected by absolute level. Matches what RTMcompare's Match
    # tab compares against. Use nanmean so out-of-Nyquist bands don't
    # corrupt the centring.
    arr = np.array(band_levels)
    finite_mean = float(np.nanmean(arr)) if np.any(np.isfinite(arr)) else 0.0
    centred = arr - finite_mean
    # Round but preserve NaN markers so cohort aggregation can skip
    # them — JSON serialisation handles NaN via float; downstream
    # aggregator below uses np.nanmedian.
    return [round(float(v), 1) if np.isfinite(v) else float('nan') for v in centred]


def _crest_db(y: np.ndarray) -> float:
    """Crest factor in dB (peak / RMS). Higher = more dynamic."""
    mono = _to_mono(y)
    if mono.size == 0 or not np.any(np.isfinite(mono)):
        return 0.0
    rms = float(np.sqrt(np.mean(mono * mono) + 1e-20))
    peak = float(np.max(np.abs(mono)) + 1e-20)
    if rms <= 1e-20 or peak <= 1e-20:
        return 0.0
    return 20.0 * math.log10(peak / rms)


def _stereo_width(y: np.ndarray) -> float:
    """Mid/side-derived width estimate in 0..1.
       0 = mono, 1 = fully anti-phase / hyperwide.

    7.6.1 fix: switched from RMS ratio (sqrt(S)/(sqrt(M)+sqrt(S))) to
    power ratio (S/(M+S)) to match comparator.compute_stereo_width exactly.
    The two formulas give systematically different values for the same signal
    (e.g. RMS → 0.27, power → 0.12 for a typical wide stereo track).
    Because engineer_profile.generate_tips uses compute_stereo_width for the
    candidate while the profile stores _stereo_width, every width comparison
    and the width component of the match score were comparing apples to
    oranges. Aligning the formulas eliminates phantom "make it wider" tips.

    NOTE: existing profiles will need a rebuild to get width_avg on the new
    scale. Regenerate any custom profiles via RTMprofile after upgrading.
    """
    if y.ndim < 2 or y.shape[1] < 2:
        return 0.0
    L = y[:, 0]
    R = y[:, 1]
    mid = L + R
    side = L - R
    mid_energy = float(np.mean(mid * mid))
    side_energy = float(np.mean(side * side))
    total = mid_energy + side_energy
    if total < 1e-10:
        return 0.0
    return round(side_energy / total, 3)


# ── Demucs separation (Deep Scan) ─────────────────────────────────────
#
# Lazy-load Demucs only when the user actually opts in to Deep Scan —
# the import + model load adds ~2 GB resident memory and ~5 s startup
# cost, which we don't want to pay for the standard scalar-only build.
#
# Produces stems entirely in memory (no .wav files on disk). Each stem
# comes back as a (samples, channels) float32 array at the model's
# native sample rate so the downstream measurement code can reuse the
# scalar functions unchanged.
_DEMUCS_MODEL = None
_DEMUCS_DEVICE = None
_STEM_NAMES = ("drums", "bass", "other", "vocals")
_DEMUCS_LOAD_LOCK = Lock()


def _load_demucs():
    """Load htdemucs once. Probes the same model-cache locations the
    parent RTMcompare app uses so the bundled .pth gets picked up
    without a network fetch. Thread-safe via _DEMUCS_LOAD_LOCK."""
    global _DEMUCS_MODEL, _DEMUCS_DEVICE
    if _DEMUCS_MODEL is not None:
        return _DEMUCS_MODEL, _DEMUCS_DEVICE
    with _DEMUCS_LOAD_LOCK:
        # Double-checked locking: another thread may have loaded while we waited.
        if _DEMUCS_MODEL is not None:
            return _DEMUCS_MODEL, _DEMUCS_DEVICE

        import os as _os
        # Look for a bundled Torch hub cache: dev tree, app bundle, or
        # RTMcompare's installed Resources/.
        here = Path(__file__).resolve().parent.parent
        candidates = [
            here / "model-cache",
            here.parent / "model-cache",
            Path("/Applications/RTMcompare.app/Contents/Resources/model-cache"),
        ]
        for base in candidates:
            if (base / "torch" / "hub" / "checkpoints").is_dir():
                _os.environ["TORCH_HOME"] = str(base / "torch")
                break

        import torch
        from demucs.pretrained import get_model as _get_model

        _DEMUCS_DEVICE = torch.device("cpu")  # MPS works but eats RAM; CPU is steady
        _DEMUCS_MODEL = _get_model("htdemucs")
        _DEMUCS_MODEL.to(_DEMUCS_DEVICE)
        _DEMUCS_MODEL.eval()
        return _DEMUCS_MODEL, _DEMUCS_DEVICE


def _separate_in_memory(data: np.ndarray, sr: int) -> tuple[dict[str, np.ndarray], int]:
    """Separate `data` into 4 stems. Returns `(stem_dict, model_sr)`.

    5.3.x: now defaults to UAI's BS-RoFormer 4-stem (SDR 9.66 on
    MUSDB18HQ; meaningfully cleaner than htdemucs ~7.0 SDR).
    Falls back to htdemucs if BS-RoFormer isn't available (no
    audio-separator wheel, no model file, OOM, etc.) so the profile
    builder still produces a result on machines that haven't received
    the new dep yet.
    """
    try:
        return _separate_with_bs_roformer(data, sr)
    except Exception as err:  # noqa: BLE001
        sys.stderr.write(
            f"[build_profile] BS-RoFormer unavailable, falling back to htdemucs: {err}\n"
        )
        return _separate_with_demucs(data, sr)


def _separate_with_bs_roformer(data: np.ndarray, sr: int) -> tuple[dict[str, np.ndarray], int]:
    """BS-RoFormer 4-stem separation via the vendored UAI backend.

    Writes the input as a tmp WAV, calls
    `uai_stems.get_backend("bs_roformer_4stem").separate(...)`, then
    reads each stem WAV back into a `(samples, channels)` float32 array.
    """
    import os as _os
    import tempfile
    import soundfile as sf
    import librosa

    # 5.4.2 audit fix (HIGH): pre-5.4.2 the second candidate was
    # `here.parent / "model-cache" / "uai_root" / "models"`. In dev
    # (`Compare App/rtm-profile-app/python/build_profile.py`) `here`
    # resolves to `Compare App/rtm-profile-app/`, so `here.parent` is
    # `Compare App/` and the path correctly hits RTMcompare's sibling
    # cache. But in production, the install layout is
    # `<app>/Contents/Resources/python/build_profile.py`, so `here`
    # resolves to `<app>/Contents/Resources/` and `here.parent` is
    # `<app>/Contents/` — Electron's Frameworks/ directory, NOT a
    # model dir. Standalone production installs would silently miss
    # the sibling-cache hit and pay the 503 MB download every time.
    #
    # Fix: walk up to 3 levels searching for `model-cache/uai_root/
    # models/` or `model-cache/uai_stems/models/`. In dev this finds
    # the sibling cache up at `Compare App/`; in production it
    # finds nothing (no walking-up matches inside .app bundles), and
    # we fall through to the canonical `/Applications/RTMcompare.app/
    # ...` path or the first-run download.
    here = Path(__file__).resolve().parent.parent
    here_python = Path(__file__).resolve().parent
    # 5.7.x audit fix: only generate walked_up paths for directories
    # that ALREADY EXIST. Pre-fix, the loop appended candidate paths
    # like `<random_sibling>/model-cache/uai_stems/models/` and the
    # later `mkdir(parents=True)` would create that directory tree
    # in unrelated locations on disk (e.g. installing into
    # ~/Applications/RTMprofile.app spawned ~/Applications/model-cache/
    # on first deep-scan). We never want to create new model-cache
    # dirs while searching — only consume existing ones.
    walked_up = []
    cur = here
    for _ in range(4):
        candidate_root = cur / "model-cache"
        if candidate_root.is_dir():
            walked_up.append(candidate_root / "uai_root" / "models")
            walked_up.append(candidate_root / "uai_stems" / "models")
        if cur.parent == cur:
            break
        cur = cur.parent
    candidates = [
        here / "model-cache" / "uai_stems" / "models",  # RTMprofile's own cache
        *walked_up,                                     # dev sibling-app cache (verified to exist)
        Path("/Applications/RTMcompare.app/Contents/Resources/model-cache/uai_root/models"),
        Path("/Applications/RTMcompare.app/Contents/Resources/model-cache/uai_stems/models"),
        Path.home() / "Library" / "Caches" / "RTMprofile" / "uai_models",  # canonical user-writable
        Path.home() / ".cache" / "audio-separator",     # audio-separator's default
    ]
    model_dir = None
    for base in candidates:
        if (base / "bs_roformer_4stem_ep_17_sdr_9.6568.ckpt").exists():
            model_dir = str(base)
            break
    # If we didn't find it, the backend will download into the first
    # writable candidate (its own cache dir). Avoids redownloading.
    if model_dir is None:
        first = candidates[0]
        first.mkdir(parents=True, exist_ok=True)
        model_dir = str(first)
    _os.environ["AIVSHU_MODELS_DIR"] = model_dir

    # Make the vendored slim subset importable.
    if str(here_python) not in sys.path:
        sys.path.insert(0, str(here_python))
    from uai_stems import get_backend  # type: ignore

    # The backend takes a file path. Render `data` to a tmp WAV at its
    # native sr, then read stems back into the (samples, channels)
    # float32 shape the rest of build_profile expects.
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_in = Path(tmpdir) / "input.wav"
        # data is (samples, channels) float32 — write it through.
        sf.write(str(tmp_in), data, sr, subtype="FLOAT")

        backend = get_backend("bs_roformer_4stem")
        stem_paths = backend.separate(str(tmp_in), tmpdir)

        stems: dict[str, np.ndarray] = {}
        target_sr: int | None = None
        for name in _STEM_NAMES:
            wav_path = stem_paths.get(name)
            if not wav_path:
                continue
            stem_data, stem_sr = sf.read(wav_path, dtype="float32", always_2d=True)
            if target_sr is None:
                target_sr = int(stem_sr)
            elif stem_sr != target_sr:
                stem_data = np.stack([
                    librosa.resample(stem_data[:, c], orig_sr=stem_sr, target_sr=target_sr)
                    for c in range(stem_data.shape[1])
                ], axis=1).astype(np.float32, copy=False)
            stems[name] = stem_data.astype(np.float32, copy=False)

        if not stems or target_sr is None:
            raise RuntimeError("BS-RoFormer returned no stems")
        return stems, int(target_sr)


def _separate_with_demucs(data: np.ndarray, sr: int) -> tuple[dict[str, np.ndarray], int]:
    """Fallback htdemucs path — pre-5.3 implementation, kept verbatim."""
    import torch
    import librosa
    from demucs.apply import apply_model

    model, device = _load_demucs()
    target_sr = int(model.samplerate)

    # Demucs wants (channels, samples) at its native sr.
    if data.ndim == 1:
        wav = np.stack([data, data], axis=0)
    else:
        wav = data.T  # -> (channels, samples)

    if sr != target_sr:
        wav = np.stack(
            [librosa.resample(ch.astype(np.float32), orig_sr=sr, target_sr=target_sr)
             for ch in wav]
        )

    # Pad to stereo if mono (Demucs is stereo-only).
    if wav.shape[0] == 1:
        wav = np.concatenate([wav, wav], axis=0)

    tensor = torch.tensor(wav, dtype=torch.float32).unsqueeze(0).to(device)
    with torch.no_grad():
        sources = apply_model(model, tensor, device=device, progress=False)
    sources = sources.squeeze(0).cpu().numpy()  # (4, channels, samples)

    stems: dict[str, np.ndarray] = {}
    for i, name in enumerate(_STEM_NAMES):
        stems[name] = sources[i].T.astype(np.float32, copy=False)  # (samples, channels)
    return stems, target_sr


def _lufs_m_swing(y: np.ndarray, sr: int) -> float:
    """LUFS-S (3-second) window swing — macro-dynamic arc. Higher = more variation."""
    try:
        meter = _get_meter(sr)
        data = y.squeeze() if y.ndim == 2 and y.shape[1] == 1 else y
        block_size = 3.0
        hop = 1.0
        hop_samples = int(hop * sr)
        block_samples = int(block_size * sr)
        if data.ndim == 1:
            data = data.reshape(-1, 1)
        total_samples = data.shape[0]
        if total_samples < block_samples:
            return float('nan')
        blocks = []
        pos = 0
        while pos + block_samples <= total_samples:
            block = data[pos:pos + block_samples]
            try:
                val = float(meter.integrated_loudness(block))
                if np.isfinite(val) and val > -70:
                    blocks.append(val)
            except Exception:
                pass
            pos += hop_samples
        if len(blocks) < 2:
            return float('nan')
        return round(float(max(blocks) - min(blocks)), 1)
    except Exception:
        return float('nan')


def _stereo_width_curve(y: np.ndarray, sr: int) -> list[float]:
    """Per-band M/S stereo width (31 ISO-266 bands). Returns 0..1 per band."""
    if y.ndim < 2 or y.shape[1] < 2:
        return [0.0] * len(THIRD_OCTAVE_HZ)
    L = y[:, 0].astype(np.float64)
    R = y[:, 1].astype(np.float64)
    mid = (L + R) / np.sqrt(2)   # normalized M
    side = (L - R) / np.sqrt(2)  # normalized S

    from scipy.signal import welch as _welch
    n_fft = min(round(8192 * sr / 44100), len(mid))
    if n_fft < 64:
        return [float('nan')] * len(THIRD_OCTAVE_HZ)

    f_m, psd_m = _welch(mid, fs=sr, nperseg=n_fft, noverlap=n_fft // 2, average="median")
    f_s, psd_s = _welch(side, fs=sr, nperseg=n_fft, noverlap=n_fft // 2, average="median")

    width_bands = []
    for centre in THIRD_OCTAVE_HZ:
        lower = centre / (2 ** (1 / 6))
        upper = centre * (2 ** (1 / 6))
        if upper > sr / 2:
            width_bands.append(float('nan'))
            continue
        mask = (f_m >= lower) & (f_m <= upper)
        if not np.any(mask):
            width_bands.append(float('nan'))
            continue
        m_power = float(np.mean(psd_m[mask]))
        s_power = float(np.mean(psd_s[mask]))
        total = m_power + s_power
        if total < 1e-20:
            width_bands.append(0.0)
        else:
            width_bands.append(round(s_power / total, 3))
    return width_bands


def _measure_audio(data: np.ndarray, sr: int) -> dict[str, Any]:
    """Scalar + curve measurement on a single audio array. Reused for
    the whole-mix pass and for each stem in Deep Scan."""
    return {
        "lufs":          _lufs_integrated(data, sr),
        "lra":           _loudness_range(data, sr),
        "peak_db":       _peak_dbtp(data),
        "crest_db":      _crest_db(data),
        "width":         _stereo_width(data),
        "curve":         _third_octave_curve(data, sr),
        "lufs_m_swing":  _lufs_m_swing(data, sr),
        "width_curve":   _stereo_width_curve(data, sr),
    }


# ── Per-file measurements ─────────────────────────────────────────────

def measure_file(path: Path, deep: bool = False, use_cache: bool = True) -> dict[str, Any] | None:
    # ── Cache lookup (non-deep only — stem separation results aren't cached
    # because they are 4× larger and invalidation is harder to reason about) ──
    sha: str | None = None
    if use_cache and not deep:
        try:
            sha = _file_sha256(path)
            cached = _cache_load(sha)
            if cached is not None:
                # Restore _source_path to the current (possibly moved) path
                cached["_source_path"] = str(path)
                sys.stderr.write(f"[cache-hit] {Path(path).name}\n")
                return cached
        except Exception:
            sha = None  # hashing failed — proceed without cache

    try:
        data, sr = sf.read(str(path), dtype="float32")
    except Exception as e:
        sys.stderr.write(f"[skip] {path}: read failed ({e})\n")
        return None

    # 5.7.1 audit Task 4: validate up-front instead of crashing in DSP.
    validated = _validate_signal(data, sr, str(path))
    if validated is None:
        return None
    data, sr, flags = validated

    out: dict[str, Any] = _measure_audio(data, sr)
    # EBU R128: LRA is unreliable on short tracks (< 90s of audio).
    # Tag but don't reject — the per-file dict gets lra_reliable=False
    # and the aggregate counts reliable tracks separately.
    duration_s = data.shape[0] / sr if data.ndim >= 1 else 0
    if duration_s < 90:
        out["lra_reliable"] = False
    # Carry forward any signal-level flags (clip_warning) into the
    # per-file dict — aggregated upward by aggregate() into the
    # profile's "warnings" list so the consumer can show them.
    out["_source_path"] = str(path)
    if flags:
        out["_flags"] = flags

    # ── Cache write (non-deep only, after all scalar measurements done) ──
    if use_cache and not deep and sha is not None:
        _cache_store(sha, out)

    if deep:
        try:
            stems, stem_sr = _separate_in_memory(data, sr)
        except Exception as e:
            # Don't fail the whole profile if Demucs trips on one file —
            # surface it in stderr and skip the per-stem block. The
            # whole-mix measurements above still land.
            sys.stderr.write(f"[deep-skip] {path}: stem separation failed ({e})\n")
        else:
            stem_meas: dict[str, Any] = {}
            for name, stem_audio in stems.items():
                # Skip silent/empty stems (rare but possible — instrumental
                # tracks have ~empty vocals).
                rms = float(np.sqrt(np.mean(stem_audio.astype(np.float32) ** 2) + 1e-20))
                if rms < 1e-5:
                    continue
                stem_meas[name] = _measure_audio(stem_audio, stem_sr)
            if stem_meas:
                out["stems"] = stem_meas

    return out


# ── Aggregator ────────────────────────────────────────────────────────

def _aggregate_scalar_block(valid: list[dict[str, Any]]) -> dict[str, Any]:
    """Common stats block — used both for the whole-mix profile and for
    each per-stem profile when Deep Scan is on.

    Profile schema 1.1.0 (May 2026): adds `curve_mad` — per-band median
    absolute deviation across the cohort. Lets the Engineer-Tips EQ
    derivation widen its "no move" dead-zone whenever the candidate
    sits inside the cohort's natural variance, instead of pushing the
    candidate toward the median regardless of cohort spread (Austin
    Seltzer beta-tester report: a finished K-pop mix against a 15-track
    K-pop profile was getting +14 dB recommendations because the cohort
    spread wasn't being respected).
    """
    lufs_arr = np.array([m["lufs"] for m in valid])
    # 5.7.x correctness fix: dynamic_range_avg must be LRA (BS.1770 LU),
    # not crest factor (peak/RMS dB). RTMcompare's engineer_profile.py
    # compares the candidate's LRA against this field and emits "Over-
    # compressed" / "Very dynamic" tips at ±2/4 LU thresholds. Pre-fix
    # the profile shipped crest factor (8–18 dB range) where the
    # consumer expected LRA (4–9 LU range), so every analysis vs a
    # custom RTMprofile-built profile fired phantom dynamics tips.
    # Audit CRITICAL #1.
    lra_arr          = np.array([m["lra"] for m in valid])
    crest_arr        = np.array([m["crest_db"] for m in valid])
    width_arr        = np.array([m["width"] for m in valid])
    peak_arr         = np.array([m["peak_db"] for m in valid])
    lufs_m_swing_arr = np.array([m.get("lufs_m_swing", float("nan")) for m in valid])
    curves           = np.array([m["curve"]  for m in valid])
    # 5.7.x audit fix: nanmedian instead of median. Per-track curves
    # now mark out-of-Nyquist bands with NaN (mixed-sr corpus) — so a
    # 16/20 kHz band median across 4×96k + 1×44.1k previously skewed
    # toward -90 dB; nanmedian skips the 44.1 k file's missing bands.
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="All-NaN slice encountered", category=RuntimeWarning)
        curve_median = np.nanmedian(curves, axis=0)
    # 5.7.x audit fix: gate curve_mad on cohort size. With a single
    # track, MAD collapses to all zeros, defeating RTMcompare's
    # variance-aware EQ dead-zone (engineer_profile.py:_compute_eq_filters).
    # Require ≥3 tracks before publishing curve_mad; below that, omit
    # the field entirely (the consumer already handles missing curve_mad
    # by falling back to the legacy 1 dB threshold).
    if len(valid) >= 3:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message="All-NaN slice encountered", category=RuntimeWarning)
            curve_mad = np.nanmedian(np.abs(curves - curve_median), axis=0)
        # Identical cohort (all curves equal) -> MAD all zeros which is
        # legitimate; round and ship. NaN can leak in only if a band is
        # NaN in *every* track, in which case 0.0 is the safe fallback.
        curve_mad_field = [round(float(v), 1) if np.isfinite(v) else 0.0 for v in curve_mad]
    else:
        curve_mad_field = None  # omitted from output dict — see below

    # 5.7.1 audit Task 4: guard mean/std against single-element NaN
    # propagation. With one valid file, np.std is 0.0; with all-identical
    # files, std is also 0.0. Both are acceptable and we round through.
    # The risk is when LRA is reported as NaN (very short / silent
    # segments inside pyloudnorm) — strip those before stats.
    # reinvention-fix: use median for scalar loudness/dynamics targets so
    # outlier sessions (accidental re-encodes, silence files) don't bias
    # the profile. Spectral curve shapes still use mean/nanmean elsewhere.
    def _safe_mean(arr: np.ndarray, default: float = 0.0) -> float:
        finite = arr[np.isfinite(arr)]
        if finite.size == 0:
            return default
        return float(np.mean(finite))

    def _safe_median(arr: np.ndarray, default: float = 0.0) -> float:
        finite = arr[np.isfinite(arr)]
        if finite.size == 0:
            return default
        return float(np.median(finite))

    def _safe_mad(arr: np.ndarray) -> float:
        """Median absolute deviation around the median — the correct spread
        metric when the center is also a median (as _safe_median is).
        Using std (around the mean) when the target is the median creates a
        systematic inconsistency: the spread includes the mean→median
        offset, making the dead-zone in engineer_profile's EQ derivation
        asymmetric. CRIT-7 fix.
        """
        finite = arr[np.isfinite(arr)]
        if finite.size <= 1:
            return 0.0
        return float(np.median(np.abs(finite - np.median(finite))))

    def _safe_minmax(arr: np.ndarray, default: float = 0.0) -> tuple[float, float]:
        finite = arr[np.isfinite(arr)]
        if finite.size == 0:
            return default, default
        return float(np.min(finite)), float(np.max(finite))

    lufs_min, lufs_max = _safe_minmax(lufs_arr)

    out: dict[str, Any] = {
        # MED-6: use -90.0 (not 0.0) for out-of-Nyquist bands so the
        # profile floor matches engineer_profile.py's -90.0 sentinel.
        # Using 0.0 created phantom +90 dB tips for missing high-freq bands.
        "curve":             [round(float(v), 1) if np.isfinite(v) else -90.0 for v in curve_median],
        "lufs_avg":          round(_safe_median(lufs_arr), 1),
        "lufs_std":          round(_safe_mad(lufs_arr), 1),    # CRIT-7: MAD matches median center
        "lufs_range":        [round(lufs_min, 1), round(lufs_max, 1)],
        # LRA in LU — the unit RTMcompare expects.
        "dynamic_range_avg": round(_safe_median(lra_arr), 1),
        "dynamic_range_std": round(_safe_mad(lra_arr), 1),     # CRIT-7
        # Crest factor kept as a separate field for diagnostic purposes;
        # not consumed by RTMcompare's tip thresholds.
        "crest_factor_avg":  round(_safe_mean(crest_arr), 1),
        "crest_factor_std":  round(_safe_mad(crest_arr), 1),   # CRIT-7
        "width_avg":         round(_safe_median(width_arr), 3),
        "width_std":         round(_safe_mad(width_arr), 3),   # CRIT-7
        "peak_avg":          round(_safe_median(peak_arr), 1),
        # PLR: Perceived Loudness Range = TruePeak_dBTP − LUFS_I
        "plr_avg":           round(_safe_median(peak_arr - lufs_arr), 1),
        "plr_std":           round(_safe_mad(peak_arr - lufs_arr), 1),
        # LUFS-M swing: macro-dynamic arc across short-term windows
        "lufs_m_swing_avg":  round(_safe_median(lufs_m_swing_arr), 1),
        "lufs_m_swing_std":  round(_safe_mad(lufs_m_swing_arr), 1),
        # LRA reliability: how many tracks had ≥90s duration
        "lra_reliable_count": sum(1 for m in valid if m.get("lra_reliable", True)),
    }
    # LUFS histogram: 100 bins from -80 to 0 LUFS
    _lufs_finite = lufs_arr[np.isfinite(lufs_arr)]
    if _lufs_finite.size > 0:
        _lufs_hist, _ = np.histogram(_lufs_finite, bins=np.linspace(-80, 0, 101))
        out["lufs_histogram"] = _lufs_hist.tolist()
        out["lufs_histogram_bins"] = [-80.0, 0.0, 100]
    if curve_mad_field is not None:
        out["curve_mad"] = curve_mad_field
    # Per-band M/S width curve: nanmedian across tracks
    width_curves = np.array([m.get("width_curve", [float('nan')] * len(THIRD_OCTAVE_HZ)) for m in valid])
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="All-NaN slice encountered", category=RuntimeWarning)
        width_curve_median = np.nanmedian(width_curves, axis=0)
    out["width_curve"] = [round(float(v), 3) if np.isfinite(v) else None for v in width_curve_median]
    return out


def aggregate(per_file: list[dict[str, Any]],
              name: str, role: str,
              deep: bool = False,
              target_min_version: str | None = None,
              target_max_version: str | None = None,
              target_fingerprint: str | None = None,
              target_plugin: dict[str, Any] | None = None) -> dict[str, Any]:
    # 5.2.2 (audit P2): finite-LUFS alone isn't enough. A digital-silence
    # file passes pyloudnorm's gate at ~-70 LUFS and finite — but its
    # spectrum is noise floor and pulls `curve_mad` toward garbage,
    # widening the cohort spread fed into the Austin Seltzer fix and
    # making downstream EQ recommendations under-fire. Require a real
    # peak above -60 dBFS.
    silent_skipped = sum(
        1 for m in per_file
        if m is not None and np.isfinite(m["lufs"]) and m.get("peak_db", -100) <= -60
    )
    # 7.6.1 fix: reject files with True Peak > 0 dBTP. These have actual
    # inter-sample overs (not just a near-0 dBTP limited master — a properly
    # limited master sits at -0.1 to -0.3 dBTP). Clipped/overloaded files
    # produce a distorted spectral curve that corrupts the cohort median,
    # especially above 2 kHz where inter-sample distortion harmonics land.
    # The old behaviour (tag-only, include in cohort) was a regression from
    # 5.7.x audit. Files with peak_db exactly 0.0 are flagged as suspicious
    # (exactly at ceiling — typical of export-to-0 presets without limiting)
    # and also excluded.
    clipped_skipped = sum(
        1 for m in per_file
        if m is not None and np.isfinite(m["lufs"]) and m.get("peak_db", -100) >= 0.0
    )
    valid = [
        m for m in per_file
        if m is not None
        and np.isfinite(m["lufs"])
        and m.get("peak_db", -100) > -60
        and m.get("peak_db", 0) < 0.0   # exclude True Peak overs
    ]
    if silent_skipped:
        print(
            f"[build_profile] skipped {silent_skipped} silent file(s) "
            f"(peak ≤ -60 dBFS — would inflate curve_mad)",
            file=sys.stderr,
        )
    if clipped_skipped:
        print(
            f"[build_profile] skipped {clipped_skipped} clipped/over file(s) "
            f"(True Peak ≥ 0 dBTP — distorted spectral shape excluded from cohort)",
            file=sys.stderr,
        )
    # 7.6.1: warn when fewer than 5 valid tracks — profile will be statistically
    # fragile (curve_mad omitted below 3, single-track profile has std=0 everywhere).
    if 0 < len(valid) < 5:
        print(
            f"[build_profile] WARNING: only {len(valid)} valid track(s). "
            f"5+ tracks recommended for a reliable tonal median. "
            f"curve_mad {'will be omitted' if len(valid) < 3 else 'may not reflect true cohort spread'}.",
            file=sys.stderr,
        )
    if not valid:
        raise SystemExit("no valid measurements — every input file failed to read or was silent")

    # schema_version 4 (this release).
    # Changes from v3:
    #   - Welch PSD now uses flat-top window for better amplitude accuracy.
    #   - New fields: plr_avg/std, lufs_m_swing_avg/std, lra_reliable_count,
    #     lufs_histogram, lufs_histogram_bins, width_curve,
    #     cohort_distinctiveness, hmac.
    #   - Per-file lra_reliable flag for tracks < 90s.
    # v3 readers will silently load v4 profiles (unknown keys ignored).
    profile: dict[str, Any] = {
        "schema_version":    4,
        "name":              name,
        "role":              role,
        "description":       f"{role} — {len(valid)}-track profile",
        "sample_count":      len(valid),
    }
    if target_min_version:
        profile["min_version"] = target_min_version
    if target_max_version:
        profile["max_version"] = target_max_version
    if target_fingerprint:
        profile["target_fingerprint"] = target_fingerprint
    if target_plugin:
        profile["target_plugin"] = target_plugin

    # Surface clip warnings collected from the per-file pass. We only
    # report file basenames, never absolute paths, so the saved profile
    # doesn't leak the user's filesystem layout to anyone they share it
    # with. Audit Task 4.
    clipped = [
        Path(m["_source_path"]).name
        for m in valid
        if isinstance(m.get("_flags"), dict)
        and m["_flags"].get("clip_warning")
        and m.get("_source_path")
    ]
    if clipped:
        profile["warnings"] = {"clipped_files": clipped}

    profile.update(_aggregate_scalar_block(valid))

    # 7.6.1: outlier detection — flag tracks whose tonal curve deviates
    # significantly from the cohort median. One genre-mismatched track
    # (e.g. a bright classical recording in a dark hip-hop profile) can
    # silently skew the median by several dB without any warning.
    # Threshold: per-band RMS deviation > 6 dB from the cohort median
    # curve. At 6 dB a track is tonally a full genre away from the rest;
    # at 3–4 dB it's within normal cohort spread for a single style.
    if len(valid) >= 3:
        cohort_curve = np.array(profile["curve"], dtype=np.float64)
        outlier_files: list[str] = []
        for m in valid:
            file_curve = np.array(m["curve"], dtype=np.float64)
            # use nanmean so out-of-Nyquist NaN bands don't inflate the diff
            finite_mask = np.isfinite(file_curve) & np.isfinite(cohort_curve)
            if np.sum(finite_mask) > 0:
                rms_dev = float(np.sqrt(np.mean((file_curve[finite_mask] - cohort_curve[finite_mask]) ** 2)))
                if rms_dev > 6.0:
                    name_hint = Path(m["_source_path"]).name if m.get("_source_path") else "unknown"
                    outlier_files.append(f"{name_hint} (±{rms_dev:.1f} dB)")
        if outlier_files:
            print(
                f"[build_profile] WARNING: {len(outlier_files)} potential outlier track(s) "
                f"detected (>6 dB RMS deviation from cohort median):\n"
                + "\n".join(f"  {f}" for f in outlier_files)
                + "\nConsider removing these tracks and rebuilding for a tighter profile.",
                file=sys.stderr,
            )
            existing_warnings = profile.get("warnings", {})
            existing_warnings["outlier_files"] = [f.split(" (")[0] for f in outlier_files]
            profile["warnings"] = existing_warnings

    # Cohort distinctiveness: ratio of spread to signal. Low values mean
    # the cohort is "average" — doesn't represent a distinctive engineer style.
    curve_arr = np.array(profile.get("curve", [0] * 31))
    curve_mad_arr = np.array(profile.get("curve_mad", [0] * 31))
    finite_mask = np.isfinite(curve_arr) & np.isfinite(curve_mad_arr) & (np.abs(curve_arr) > 0.01)
    if np.sum(finite_mask) > 0:
        distinctiveness = float(
            np.mean(curve_mad_arr[finite_mask]) / np.mean(np.abs(curve_arr[finite_mask]) + 0.01)
        )
        profile["cohort_distinctiveness"] = round(distinctiveness, 3)
        if distinctiveness < 0.1:
            print(
                "[build_profile] NOTE: cohort_distinctiveness is low — "
                "this profile may not represent a distinctive style.",
                file=sys.stderr,
            )

    if deep:
        # Aggregate per-stem. Each stem rolls up across only the files
        # that produced a measurement for it (silent vocals on an
        # instrumental track drop out).
        stems_block: dict[str, Any] = {}
        for stem in _STEM_NAMES:
            stem_measurements = [
                m["stems"][stem] for m in valid
                if "stems" in m and stem in m["stems"]
                and np.isfinite(m["stems"][stem]["lufs"])
            ]
            # 5.7.x audit fix: was `>= 2` — but with two samples MAD is
            # |x1−median| ≈ |x2−median| ≈ half the inter-track distance,
            # i.e. half random noise. Raise to ≥4 so cohort spread has
            # statistical meaning. Below that, the per-stem block is
            # omitted; downstream stem-aware tips just don't fire for
            # under-sampled stems.
            if len(stem_measurements) >= 4:
                stems_block[stem] = {
                    "sample_count": len(stem_measurements),
                    **_aggregate_scalar_block(stem_measurements),
                }
        if stems_block:
            profile["stems"] = stems_block
            profile["deep_scan"] = True

            # Masking index between vocals and other (instrument) stems.
            # Cross-correlation of per-band spectral power curves. Higher = more masking.
            if "vocals" in stems_block and "other" in stems_block:
                vocal_curves = [
                    m["stems"]["vocals"]["curve"]
                    for m in valid
                    if "stems" in m and "vocals" in m["stems"]
                ]
                other_curves = [
                    m["stems"]["other"]["curve"]
                    for m in valid
                    if "stems" in m and "other" in m["stems"]
                ]
                if vocal_curves and other_curves and len(vocal_curves) == len(other_curves):
                    correlations = []
                    for ca, cb in zip(vocal_curves, other_curves):
                        a = np.array(ca, dtype=np.float64)
                        b = np.array(cb, dtype=np.float64)
                        mask = np.isfinite(a) & np.isfinite(b)
                        if np.sum(mask) < 5:
                            continue
                        a, b = a[mask], b[mask]
                        a = (a - a.mean()) / (a.std() + 1e-10)
                        b = (b - b.mean()) / (b.std() + 1e-10)
                        correlations.append(float(np.dot(a, b) / len(a)))
                    if correlations:
                        profile["masking_index_vocals_other"] = round(float(np.median(correlations)), 3)

    # HMAC-SHA256 integrity field — NOT for secrecy, for tamper detection.
    # Key is profile name + schema_version so a hand-edited or corrupted
    # profile (wrong name, wrong schema) fails the check.
    profile_bytes = json.dumps(
        {k: v for k, v in sorted(profile.items()) if k != "hmac"},
        sort_keys=True, separators=(',', ':')
    ).encode()
    hmac_key = f"rtmprofile-v{profile['schema_version']}-{name}".encode()
    profile["hmac"] = _hmac.new(hmac_key, profile_bytes, hashlib.sha256).hexdigest()

    return profile


# ── CLI entry ─────────────────────────────────────────────────────────

def _slugify(s: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "-" for c in s.lower()).strip("-")


# ── Chain-pair matching helpers ───────────────────────────────────────────────

import re as _re

# Tokens that mark a file as a master (but not a mix).
# Pattern: word boundary + M + digits (+ optional .digits), NOT preceded by "IX"
# so "MIX3" is not matched but "M1", "M1.1", "M2" are.
_MASTER_VER_RE = _re.compile(r'\bM(\d+(?:\.\d+)?)\b(?!\s*IX)', _re.IGNORECASE)
# Tokens that mark a file as a mix.
_MIX_VER_RE    = _re.compile(r'\bMIX\s*\d*\b', _re.IGNORECASE)

# Noise tokens to strip when extracting a canonical song title.
_NOISE_RE = _re.compile(
    r'''
    ^\d{1,3}\s*[-._]?\s*   |  # leading track number: "01 ", "01 - ", "01.", "01-", "01_"
    \(\s*MAIN\s*\)         |  # version tags in parens
    \(\s*INST(?:RUMENTAL)?\s*\) |
    \(\s*RADIO\s*\)        |
    \(\s*EXPLICIT\s*\)     |
    \(\s*CLEAN\s*\)        |
    \(\s*FINAL\s*\)        |
    \b(FINAL|FINEL|ROUGH|FLAT|STEMS?|INST|RADIO|MAIN|CLEAN|EXPLICIT|V\d+)\b |
    \bM\d+(?:\.\d+)?\b     |  # master version "M1" "M1.1"
    \bMIX\s*\d*\b          |  # mix version "MIX3"
    \d{2}-\d{2}-\d{4}      |  # date "29-04-2026"
    \d{4}-\d{2}-\d{2}      |  # date "2026-04-29"
    \s{2,}                    # collapse runs of spaces
    ''',
    _re.IGNORECASE | _re.VERBOSE,
)


def _canonical_title(filename: str) -> str:
    """Strip track numbers, version tags, dates and extension → comparable title."""
    stem = Path(filename).stem
    # Normalise underscores/hyphens used as word separators before any regex work.
    stem = stem.replace('_', ' ').replace('-', ' ')
    title = _NOISE_RE.sub(' ', stem).strip().upper()
    # Collapse interior whitespace one more time after substitutions.
    title = _re.sub(r'\s+', ' ', title).strip()
    return title


def _word_overlap(a: str, b: str) -> float:
    """Similarity between two canonical titles — 0..1.

    Uses the max of:
    - Jaccard on word sets (good for same-length titles)
    - Overlap coefficient (intersection / min size) — good when one title
      is a subset of the other, e.g. mix "TOO HIGH" vs master "TOO HIGH BOUNCE"
    - SequenceMatcher ratio — catches reordered words / partial matches
    """
    import difflib as _dl
    wa = set(a.split())
    wb = set(b.split())
    if not wa or not wb:
        return 0.0
    jaccard = len(wa & wb) / len(wa | wb)
    overlap = len(wa & wb) / min(len(wa), len(wb))
    seq = _dl.SequenceMatcher(None, a, b).ratio()
    return max(jaccard, overlap, seq)


def _match_mix_to_master(
    mix_path: str,
    master_paths: list[str],
    threshold: float = 0.4,
) -> str | None:
    """Return the best-matching master path for `mix_path`, or None if below threshold."""
    mix_title = _canonical_title(mix_path)
    best_score, best_path = 0.0, None
    for mp in master_paths:
        mt = _canonical_title(mp)
        score = _word_overlap(mix_title, mt)

        if score > best_score:
            best_score, best_path = score, mp
    if best_score >= threshold:
        return best_path
    return None


def _compute_chain_analysis_multi(
    mix_paths: list[str],
    master_paths: list[str],
    progress: bool = False,
) -> dict[str, Any] | None:
    """
    For each mix file, find its matching master in `master_paths`, compute the
    per-band spectral delta (master − mix), then aggregate across all pairs:
      - eq_curve  : nanmedian of per-pair deltas (robust centre estimate)
      - eq_mad    : per-band median absolute deviation (confidence measure;
                    low = consistent chain, high = material-dependent)
      - pairs     : list of {"mix", "master", "delta"} for transparency
      - pair_count: number of successfully matched + measured pairs

    Returns None if no pairs could be computed.
    """
    pairs_data: list[dict[str, Any]] = []

    for mix_p in mix_paths:
        matched_master = _match_mix_to_master(mix_p, master_paths)
        mix_title = _canonical_title(mix_p)
        master_title = _canonical_title(matched_master) if matched_master else "?"
        if matched_master is None:
            if progress:
                sys.stderr.write(
                    f"[chain] No master match for mix '{Path(mix_p).name}' "
                    f"(title: '{mix_title}') — skipping\n"
                )
            continue

        if progress:
            sys.stderr.write(
                f"[chain] Pair: '{Path(mix_p).name}' ↔ '{Path(matched_master).name}' "
                f"(overlap: '{mix_title}' ↔ '{master_title}')\n"
            )

        try:
            mix_data, mix_sr = sf.read(str(Path(mix_p).expanduser()), dtype="float32")
            mas_data, mas_sr = sf.read(str(Path(matched_master).expanduser()), dtype="float32")
            vm = _validate_signal(mix_data, mix_sr, mix_p)
            va = _validate_signal(mas_data, mas_sr, matched_master)
            if vm is None or va is None:
                continue
            mix_data, mix_sr, _ = vm
            mas_data, mas_sr, _ = va
            mix_curve = _third_octave_curve(mix_data, mix_sr)
            mas_curve = _third_octave_curve(mas_data, mas_sr)
            if len(mix_curve) == len(mas_curve) == 31:
                delta = [
                    round(float(mc) - float(xc), 2)
                    if isinstance(mc, (int, float)) and isinstance(xc, (int, float))
                       and not (math.isnan(mc) or math.isnan(xc))
                    else None
                    for mc, xc in zip(mas_curve, mix_curve)
                ]
                pairs_data.append({
                    "mix":    Path(mix_p).name,
                    "master": Path(matched_master).name,
                    "delta":  delta,
                })
        except Exception as e:
            sys.stderr.write(f"[chain] Error measuring pair for '{Path(mix_p).name}': {e}\n")

    if not pairs_data:
        return None

    # Aggregate: median + MAD across pairs, band by band.
    n_bands = 31
    band_values: list[list[float]] = [[] for _ in range(n_bands)]
    for pd_ in pairs_data:
        for i, v in enumerate(pd_["delta"]):
            if v is not None:
                band_values[i].append(v)

    eq_curve: list[float | None] = []
    eq_mad:   list[float | None] = []
    for vals in band_values:
        if len(vals) >= 1:
            med = float(np.nanmedian(vals))
            mad = float(np.nanmedian([abs(v - med) for v in vals]))
            eq_curve.append(round(med, 2))
            eq_mad.append(round(mad, 2))
        else:
            eq_curve.append(None)
            eq_mad.append(None)

    return {
        "type":       "multi_pair_spectral_diff",
        "label":      "Chain Analysis",
        "eq_curve":   eq_curve,
        "eq_mad":     eq_mad,
        "pair_count": len(pairs_data),
        "pairs":      [{"mix": p["mix"], "master": p["master"]} for p in pairs_data],
        "note": (
            "Spectral delta aggregated across mix/master pairs. "
            "eq_curve = median per-band lift applied by your mastering chain. "
            "eq_mad = spread (low = consistent chain, high = material-dependent)."
        ),
    }


def main() -> int:
    p = argparse.ArgumentParser(description="Build an RTMcompare engineer profile from a corpus.")
    p.add_argument("--name", required=True, help='Engineer name (e.g. "Your Name")')
    p.add_argument("--role", default="Mastering Engineer", help="Role (default: Mastering Engineer)")
    # 5.2.3: --genres deprecated. Accepted for back-compat (older Electron
    # wrappers still pass it) but its value is ignored.
    p.add_argument("--genres", default="", help=argparse.SUPPRESS)
    p.add_argument("--out", default="", help="Output JSON path. Default: ~/.rtm/profiles/<slug>.json")
    p.add_argument("--progress", action="store_true",
                   help="Emit JSON progress lines on stderr (used by the Electron wrapper).")
    p.add_argument("--deep", action="store_true",
                   help="Deep Scan: also separate each track via Demucs and "
                        "build per-stem profiles (vocals/drums/bass/other). "
                        "Adds ~30s-2min per track on M-series CPU.")
    # 5.7.1 schema-v2 metadata. All four are optional; when absent the
    # consumer (RTMcompare bridge) treats the profile as unbounded /
    # generic, matching pre-v2 behaviour.
    p.add_argument("--target-min-version", default="",
                   help="Lowest RTMcompare/plugin version this profile targets (semver).")
    p.add_argument("--target-max-version", default="",
                   help="Highest RTMcompare/plugin version this profile targets (semver).")
    p.add_argument("--target-fingerprint", default="",
                   help="sha256 hex of '<format>|<plugin uid>|<plugin version>|<param count>' "
                        "for the targeted plugin. Lets RTMcompare detect plugin-version drift.")
    p.add_argument("--target-plugin-json", default="",
                   help="Path to a JSON file describing the target plugin: "
                        '{"name":"…","format":"vst3|au","uid":"…","param_count":<int>}')
    p.add_argument("files", nargs="+", help="Audio files to analyse")
    p.add_argument("--no-cache", action="store_true",
                   help="Disable content-addressed track analysis cache (~/.rtm/tracks/). "
                        "Use when benchmarking or diagnosing cache-related issues.")
    p.add_argument("--chain-reference", default="",
                   help="(Legacy) Path to a single dry mix file for chain analysis. "
                        "Prefer --chain-mixes for multi-pair analysis.")
    p.add_argument("--chain-mixes", nargs="*", default=[],
                   help="One or more pre-master mix files. RTMprofile matches each mix "
                        "to a master in the corpus by title, computes per-pair spectral "
                        "deltas, and aggregates them to a chain_analysis curve with "
                        "confidence (MAD). More pairs = more accurate chain signature.")
    args = p.parse_args()

    # Parse + validate the optional plugin descriptor.
    target_plugin: dict[str, Any] | None = None
    if args.target_plugin_json:
        try:
            with open(Path(args.target_plugin_json).expanduser(), encoding="utf-8") as fh:
                raw = json.load(fh)
            if not isinstance(raw, dict):
                raise ValueError("not a JSON object")
            # Whitelist + coerce the four expected keys; ignore extras.
            target_plugin = {}
            if "name" in raw:
                target_plugin["name"] = str(raw["name"])[:120]
            if "format" in raw:
                fmt = str(raw["format"]).lower()
                if fmt not in ("vst3", "au", "aax", "vst"):
                    sys.stderr.write(f"[warn] target_plugin.format '{fmt}' is unusual; passing through.\n")
                target_plugin["format"] = fmt
            if "uid" in raw:
                target_plugin["uid"] = str(raw["uid"])[:120]
            if "param_count" in raw:
                try:
                    target_plugin["param_count"] = int(raw["param_count"])
                except (TypeError, ValueError):
                    sys.stderr.write("[warn] target_plugin.param_count not an int; dropping.\n")
            if not target_plugin:
                target_plugin = None
        except Exception as e:
            sys.stderr.write(f"[warn] couldn't read --target-plugin-json: {e}\n")
            target_plugin = None

    # Optional chain analysis — prefer multi-pair (--chain-mixes) over legacy single-file.
    chain_mixes: list[str] = [f.strip() for f in (args.chain_mixes or []) if f.strip()]
    chain_reference: str | None = args.chain_reference.strip() or None

    # 5.2.3: --genres ignored if passed (back-compat shim only)
    if args.out:
        out_path = Path(args.out).expanduser()
    else:
        slug = _slugify(args.name) or "profile"
        out_path = Path.home() / ".rtm" / "profiles" / f"{slug}.json"
    # 5.7.1 audit Task 5: surface clearer error if the target dir is
    # not writable rather than letting Python raise PermissionError
    # mid-write. We try to mkdir up-front and translate failure into
    # the same SystemExit shape the rest of the script uses.
    try:
        out_path.parent.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        raise SystemExit(
            f"output directory not writable: {out_path.parent} ({e})"
        )
    # Probe writability — on Windows a read-only flag on the dir gives
    # a non-OSError success on mkdir but fails on open(). Test a tmp.
    try:
        probe = out_path.parent / ".rtmprofile-write-probe"
        probe.write_text("", encoding="utf-8")
        probe.unlink()
    except OSError as e:
        raise SystemExit(
            f"cannot write to {out_path.parent} — check folder permissions ({e})"
        )

    measurements: list[dict[str, Any] | None] = []
    total = len(args.files)
    # 5.7.1 audit Task 5: normalise to NFC on macOS. HFS+/APFS may store
    # filenames in NFD (decomposed) form ("café" -> "café"); the
    # renderer / shell may pass NFC. soundfile/libsndfile resolve both
    # in practice, but downstream string comparisons (e.g. logging
    # against the input path) drift. Coerce to NFC for stable display.
    files_norm = [
        _ucd.normalize("NFC", f) if isinstance(f, str) else f
        for f in args.files
    ]

    # Parallel file processing.
    # - Non-deep: threads work well (numpy/soundfile release the GIL; I/O is
    #   the bottleneck on most machines). Cap at 4 workers to avoid thrashing
    #   a spinning disk; SSDs benefit more.
    # - Deep scan: stem separation (BS-RoFormer / Demucs) is heavy CPU/GPU.
    #   Threads still help if the model runs on GPU (CUDA allows concurrent
    #   streams) and avoid multi-process pickling complexity. Cap at 2 workers
    #   for deep to prevent OOM on consumer hardware.
    max_workers = 2 if args.deep else min(4, total)

    # Thread-safe progress counter and stderr lock.
    _progress_lock = Lock()
    _completed = [0]  # mutable int in a list so the closure can mutate it

    def _measure_one(idx_f):
        idx, f_norm = idx_f
        if args.progress and args.deep:
            # Emit a "starting" event immediately so the UI shows activity
            # during the long stem-separation phase (30s-2min per file).
            with _progress_lock:
                sys.stderr.write(json.dumps({
                    "type": "progress_start",
                    "i": _completed[0],
                    "total": total,
                    "file": f_norm,
                    "stage": "separating",
                }) + "\n")
                sys.stderr.flush()
        result = measure_file(Path(f_norm).expanduser(), deep=args.deep,
                              use_cache=not args.no_cache)
        if args.progress:
            with _progress_lock:
                _completed[0] += 1
                sys.stderr.write(json.dumps({
                    "type": "progress",
                    "i": _completed[0],
                    "total": total,
                    "file": f_norm,
                    "deep": bool(args.deep),
                }) + "\n")
                sys.stderr.flush()
        return idx, result

    if max_workers > 1 and total > 1:
        results_map: dict[int, "dict[str, Any] | None"] = {}
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {
                pool.submit(_measure_one, (i, f)): i
                for i, f in enumerate(files_norm)
            }
            for fut in as_completed(futures):
                idx, m = fut.result()
                results_map[idx] = m
        measurements = [results_map[i] for i in range(total)]
    else:
        for i, f_norm in enumerate(files_norm):
            _, m = _measure_one((i, f_norm))
            measurements.append(m)

    profile = aggregate(
        measurements,
        name=args.name,
        role=args.role,
        deep=args.deep,
        target_min_version=args.target_min_version or None,
        target_max_version=args.target_max_version or None,
        target_fingerprint=args.target_fingerprint or None,
        target_plugin=target_plugin,
    )
    chain_out_path: Path | None = None

    if chain_mixes:
        # Multi-pair chain analysis → write a separate *-chain.json file.
        chain_result = _compute_chain_analysis_multi(
            mix_paths=chain_mixes,
            master_paths=files_norm,
            progress=args.progress,
        )
        if chain_result:
            sys.stderr.write(
                f"[chain] Multi-pair chain analysis: {chain_result['pair_count']} pair(s) matched and measured.\n"
            )
            chain_profile = {
                "schema_version": profile["schema_version"],
                "profile_type": "chain",
                "name": profile["name"],
                "role": profile.get("role", ""),
                "description": f"{profile.get('role', 'Mastering Engineer')} — chain delta from {chain_result['pair_count']} pair(s)",
                "chain_analysis": chain_result,
                "hmac": "",  # filled below
            }
            # Derive chain output path: same dir, same slug + "-chain"
            chain_out_path = out_path.with_name(out_path.stem + "-chain" + out_path.suffix)
            # HMAC for chain profile
            _hmac_key = b"rtm-profile-v1"
            chain_hmac_payload = json.dumps(
                {k: v for k, v in chain_profile.items() if k != "hmac"},
                sort_keys=True, separators=(",", ":"),
            ).encode()
            chain_profile["hmac"] = __import__("hmac").new(
                _hmac_key, chain_hmac_payload, "sha256"
            ).hexdigest()
            tmp_chain = chain_out_path.with_suffix(chain_out_path.suffix + ".tmp")
            try:
                tmp_chain.write_text(json.dumps(chain_profile, indent=2), encoding="utf-8")
                _os.replace(tmp_chain, chain_out_path)
            except Exception:
                try:
                    tmp_chain.unlink(missing_ok=True)
                except OSError:
                    pass
                raise
        else:
            sys.stderr.write("[chain] Warning: no mix/master pairs could be matched — chain file not written.\n")

    # 5.7.x audit fix: atomic write for the fingerprint profile.
    profile["profile_type"] = "fingerprint"
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
    try:
        tmp_path.write_text(json.dumps(profile, indent=2), encoding="utf-8")
        _os.replace(tmp_path, out_path)
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise

    result: dict = {
        "ok": True,
        "path": str(out_path),
        "sample_count": profile["sample_count"],
        "skipped": total - profile["sample_count"],
    }
    if chain_out_path is not None:
        result["chain_path"] = str(chain_out_path)
        result["chain_pair_count"] = chain_result["pair_count"] if chain_result else 0  # type: ignore[possibly-undefined]
    sys.stdout.write(json.dumps(result))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
