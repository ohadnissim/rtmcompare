#!/usr/bin/env python3
"""
RTMprofile — build an engineer-style mastering profile from a corpus
of audio files.

Drops `N` audio files in. Produces a single JSON profile that loads
into RTMcompare's Match tab via `~/.rtm/profiles/<slug>.json`.

The output schema matches `python/profiles/ohad.json` in the
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
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
import pyloudnorm as pyln
from scipy.signal import resample_poly


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
    return np.mean(y, axis=1)


def _peak_dbtp(y: np.ndarray) -> float:
    """4×-oversampled true-peak per BS.1770-4. Cheap version: scipy
    resample_poly + 20*log10. Channel-summed peak across the upsampled
    signal."""
    if y.ndim > 1:
        # Channel-wise resample and take max peak across channels
        peaks = []
        for ch in range(y.shape[1]):
            up = resample_poly(y[:, ch], 4, 1)
            peaks.append(float(np.max(np.abs(up))))
        peak = max(peaks)
    else:
        up = resample_poly(y, 4, 1)
        peak = float(np.max(np.abs(up)))
    if peak <= 0:
        return -200.0
    return 20.0 * math.log10(peak)


def _lufs_integrated(y: np.ndarray, sr: int) -> float:
    """Integrated LUFS via pyloudnorm. Returns -inf for digital silence."""
    meter = pyln.Meter(sr)
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
        meter = pyln.Meter(sr, block_size=3.0)
        if y.ndim == 1:
            data = y.reshape(-1, 1)
        else:
            data = y
        return float(meter.loudness_range(data))
    except Exception:
        # Older pyloudnorm or pathological input — return 0 rather
        # than a wrong number. The profile builder will still produce
        # a valid file; LRA just shows up as 0.
        return 0.0


def _third_octave_curve(y: np.ndarray, sr: int) -> list[float]:
    """31-band third-octave spectrum in dB (relative to RMS reference).
    Mean-centred so it represents tonal SHAPE, not absolute level."""
    mono = _to_mono(y)
    n_fft = 8192
    # Use Welch's method for a smooth spectrum
    from scipy.signal import welch
    f, psd = welch(mono, fs=sr, nperseg=n_fft, noverlap=n_fft // 2, average="median")
    psd = np.maximum(psd, 1e-20)

    band_levels: list[float] = []
    for centre in THIRD_OCTAVE_HZ:
        # Third-octave edges
        lower = centre / (2 ** (1 / 6))
        upper = centre * (2 ** (1 / 6))
        if upper > sr / 2:
            band_levels.append(-90.0)
            continue
        mask = (f >= lower) & (f <= upper)
        if not np.any(mask):
            band_levels.append(-90.0)
            continue
        band_power = float(np.mean(psd[mask]))
        band_levels.append(10.0 * math.log10(max(band_power, 1e-20)))

    # Mean-centre so the curve is shape-only (engineer fingerprint),
    # not affected by absolute level. Matches what RTMcompare's Match
    # tab compares against.
    arr = np.array(band_levels)
    centred = arr - np.mean(arr)
    return [round(float(v), 1) for v in centred]


def _crest_db(y: np.ndarray) -> float:
    """Crest factor in dB (peak / RMS). Higher = more dynamic."""
    mono = _to_mono(y)
    rms = float(np.sqrt(np.mean(mono * mono) + 1e-20))
    peak = float(np.max(np.abs(mono)) + 1e-20)
    return 20.0 * math.log10(peak / rms)


def _stereo_width(y: np.ndarray) -> float:
    """Mid/side-derived width estimate in 0..1.
       0 = mono, ~0.7 = wide stereo, > 1 = anti-phase / hyperwide."""
    if y.ndim < 2 or y.shape[1] < 2:
        return 0.0
    L = y[:, 0]
    R = y[:, 1]
    mid = 0.5 * (L + R)
    side = 0.5 * (L - R)
    rms_mid = float(np.sqrt(np.mean(mid * mid) + 1e-20))
    rms_side = float(np.sqrt(np.mean(side * side) + 1e-20))
    if rms_mid <= 0:
        return 0.0
    return round(rms_side / (rms_mid + rms_side), 3)


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


def _load_demucs():
    """Load htdemucs once. Probes the same model-cache locations the
    parent RTMcompare app uses so the bundled .pth gets picked up
    without a network fetch."""
    global _DEMUCS_MODEL, _DEMUCS_DEVICE
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

    # Make sibling RTMcompare's vendored model-cache discoverable so we
    # don't redownload 503 MB if it's already on disk. Look in:
    #   1) RTMprofile's own model-cache/uai_stems/models/  (preferred)
    #   2) RTMcompare's model-cache/uai_root/models/        (sibling app)
    #   3) Apple bundle at /Applications/RTMcompare.app/Contents/Resources/model-cache/uai_root/models/
    here = Path(__file__).resolve().parent.parent
    candidates = [
        here / "model-cache" / "uai_stems" / "models",
        here.parent / "model-cache" / "uai_root" / "models",
        Path("/Applications/RTMcompare.app/Contents/Resources/model-cache/uai_root/models"),
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
    here_python = Path(__file__).resolve().parent
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


def _measure_audio(data: np.ndarray, sr: int) -> dict[str, Any]:
    """Scalar + curve measurement on a single audio array. Reused for
    the whole-mix pass and for each stem in Deep Scan."""
    return {
        "lufs":     _lufs_integrated(data, sr),
        "lra":      _loudness_range(data, sr),
        "peak_db":  _peak_dbtp(data),
        "crest_db": _crest_db(data),
        "width":    _stereo_width(data),
        "curve":    _third_octave_curve(data, sr),
    }


# ── Per-file measurements ─────────────────────────────────────────────

def measure_file(path: Path, deep: bool = False) -> dict[str, Any] | None:
    try:
        data, sr = sf.read(str(path), dtype="float32")
    except Exception as e:
        sys.stderr.write(f"[skip] {path}: read failed ({e})\n")
        return None
    if data.size == 0:
        return None

    out: dict[str, Any] = _measure_audio(data, sr)

    if deep:
        try:
            stems, stem_sr = _separate_in_memory(data, sr)
        except Exception as e:
            # Don't fail the whole profile if Demucs trips on one file —
            # surface it in stderr and skip the per-stem block. The
            # whole-mix measurements above still land.
            sys.stderr.write(f"[deep-skip] {path}: demucs failed ({e})\n")
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
    crest_arr = np.array([m["crest_db"] for m in valid])
    width_arr = np.array([m["width"] for m in valid])
    peak_arr  = np.array([m["peak_db"] for m in valid])
    curves    = np.array([m["curve"]  for m in valid])
    curve_median = np.median(curves, axis=0)
    # Median Absolute Deviation — robust spread measure; doesn't blow up
    # on a single outlier track. One MAD ≈ 0.6745 σ for normal data.
    curve_mad = np.median(np.abs(curves - curve_median), axis=0)
    return {
        "curve":             [round(float(v), 1) for v in curve_median],
        "curve_mad":         [round(float(v), 1) for v in curve_mad],
        "lufs_avg":          round(float(np.mean(lufs_arr)), 1),
        "lufs_std":          round(float(np.std(lufs_arr)), 1),
        "lufs_range":        [round(float(np.min(lufs_arr)), 1), round(float(np.max(lufs_arr)), 1)],
        "dynamic_range_avg": round(float(np.mean(crest_arr)), 1),
        "dynamic_range_std": round(float(np.std(crest_arr)), 1),
        "width_avg":         round(float(np.mean(width_arr)), 3),
        "width_std":         round(float(np.std(width_arr)), 3),
        "peak_avg":          round(float(np.mean(peak_arr)), 1),
    }


def aggregate(per_file: list[dict[str, Any]],
              name: str, role: str,
              deep: bool = False) -> dict[str, Any]:
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
    valid = [
        m for m in per_file
        if m is not None and np.isfinite(m["lufs"]) and m.get("peak_db", -100) > -60
    ]
    if silent_skipped:
        print(
            f"[build_profile] skipped {silent_skipped} silent file(s) "
            f"(peak <= -60 dBFS — would inflate curve_mad)",
            file=sys.stderr,
        )
    if not valid:
        raise SystemExit("no valid measurements — every input file failed to read or was silent")

    # 5.3.0: explicit `schema_version`. Tolerant additive — readers
    # tolerate unknown fields and warn on a higher major. Stamp here
    # so every profile from this build forward carries the version.
    # 5.2.3: "genres" removed from the schema.
    profile: dict[str, Any] = {
        "schema_version":    1,
        "name":              name,
        "role":              role,
        "description":       f"{role} — {len(valid)}-track profile",
        "sample_count":      len(valid),
    }
    profile.update(_aggregate_scalar_block(valid))

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
            if len(stem_measurements) >= 2:
                stems_block[stem] = {
                    "sample_count": len(stem_measurements),
                    **_aggregate_scalar_block(stem_measurements),
                }
        if stems_block:
            profile["stems"] = stems_block
            profile["deep_scan"] = True

    return profile


# ── CLI entry ─────────────────────────────────────────────────────────

def _slugify(s: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "-" for c in s.lower()).strip("-")


def main() -> int:
    p = argparse.ArgumentParser(description="Build an RTMcompare engineer profile from a corpus.")
    p.add_argument("--name", required=True, help='Engineer name (e.g. "Ohad Nissim")')
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
    p.add_argument("files", nargs="+", help="Audio files to analyse")
    args = p.parse_args()

    # 5.2.3: --genres ignored if passed (back-compat shim only)
    if args.out:
        out_path = Path(args.out).expanduser()
    else:
        slug = _slugify(args.name) or "profile"
        out_path = Path.home() / ".rtm" / "profiles" / f"{slug}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    measurements: list[dict[str, Any] | None] = []
    total = len(args.files)
    for i, f in enumerate(args.files, 1):
        if args.progress:
            sys.stderr.write(json.dumps({
                "type": "progress",
                "i": i,
                "total": total,
                "file": f,
                "deep": bool(args.deep),
            }) + "\n")
            sys.stderr.flush()
        m = measure_file(Path(f).expanduser(), deep=args.deep)
        measurements.append(m)

    profile = aggregate(measurements, name=args.name, role=args.role,
                        deep=args.deep)
    out_path.write_text(json.dumps(profile, indent=2), encoding="utf-8")

    sys.stdout.write(json.dumps({
        "ok": True,
        "path": str(out_path),
        "sample_count": profile["sample_count"],
        "skipped": total - profile["sample_count"],
    }))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
