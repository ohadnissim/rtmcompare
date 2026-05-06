"""
Lightweight per-file analyser for batch / album mode.

The main `analyze.py` pipeline runs full 2-file comparison (Demucs stems,
spectrum overlays, masking, waveform diff, etc.) — overkill and slow for
checking that a 12-track album is consistent before delivery. This module
does just the numbers label ops and mastering engineers actually need to
triage a folder of masters:

  • Integrated LUFS (ITU-R BS.1770)
  • True-peak (4× oversampled)
  • LRA (loudness range)
  • Length (seconds, ms precision)
  • Sample rate + bit depth
  • ISRC / UPC / title / artist (from BWF bext, iXML, LIST-INFO, or ID3v2)
  • Clipping sample count
  • Mono-compatibility risk (single number)

Runs ~5-10× faster than the comparison pipeline per file, so a 12-track
album takes <30 s. Output is one JSON object per file, streamed to stdout
as NDJSON so the renderer can build the table progressively.

Usage:
    python3 batch_analyze.py file1.wav file2.wav ...

The `analyze_single_file()` function is also importable so other scripts
can reuse the analyser without re-forking a subprocess.
"""

import json
import os
import sys
import time
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

# Windows: bundled embeddable Python's _pth file does not auto-add the
# script directory to sys.path. Make neighbour modules importable.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import soundfile as sf
import numpy as np
import pyloudnorm as pyln

sys.path.insert(0, os.path.dirname(__file__))
from metadata_reader import read_metadata, read_delivery_fields
from specs import SPECS_VERSION, to_json as _specs_to_json


def _spec_versions() -> dict:
    return {
        "version": SPECS_VERSION,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "specs": _specs_to_json(),
    }


def _true_peak_4x(signal: np.ndarray, sr: int) -> float:
    """Estimate true peak in dBTP via 4× polyphase oversampling."""
    try:
        from scipy.signal import resample_poly
        up = resample_poly(signal, 4, 1)
        peak = float(np.max(np.abs(up)))
    except Exception:
        peak = float(np.max(np.abs(signal)))
    if peak <= 0:
        return -120.0
    return float(20.0 * np.log10(peak))


def _clip_count(signal: np.ndarray, threshold: float = 0.9999) -> int:
    """Samples at or above 0 dBFS — strong clipping signature."""
    return int(np.sum(np.abs(signal) >= threshold))


# 31 ISO 1/3-octave centre frequencies — the standard spectrum grid used
# everywhere else in RTM (Match tab, Engineer Tips, reference-check). Sharing
# the bands lets Cohort Mode's distance calc line up cleanly with whatever
# reference spectrum the user already has elsewhere in the app.
_THIRD_OCT_CENTRES = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500,
    630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300,
    8000, 10000, 12500, 16000, 20000,
]

def _compute_31band_spectrum(data: np.ndarray, sr: int, window_sec: float = 30.0) -> list[float]:
    """
    31-band 1/3-octave magnitude spectrum, dB relative to the peak band.

    Cheap and deterministic — one FFT over a central window of ≤ 30 s.
    Returns 31 floats, peak-normalised to 0 dB so cross-file comparisons
    in Cohort Mode aren't dominated by absolute loudness differences.
    Null out-of-range bands get a very low floor (−60 dB) so they still
    contribute a consistent shape.
    """
    # Mono sum (preserves spectral shape without phase cancellation gotchas).
    if data.ndim > 1 and data.shape[1] > 1:
        mono = np.mean(data[:, :2], axis=1)
    else:
        mono = data[:, 0] if data.ndim > 1 else data

    n_samples = mono.shape[0]
    if n_samples <= sr:
        return [-60.0] * 31

    # Central window — skips intros/outros and any head/tail silence.
    win = min(int(window_sec * sr), n_samples)
    start = max(0, (n_samples - win) // 2)
    seg = mono[start:start + win].astype(np.float64)

    # FFT magnitude.
    n_fft = 1 << (int(np.ceil(np.log2(len(seg)))) + 0)
    fft = np.fft.rfft(seg * np.hanning(len(seg)), n=n_fft)
    freqs = np.fft.rfftfreq(n_fft, d=1.0 / sr)
    mag = np.abs(fft)

    # 1/3-octave band energies — integrate magnitude² inside each band.
    ratio = 2.0 ** (1.0 / 6.0)  # ±1/6 octave around centre
    bands = np.empty(31, dtype=np.float64)
    for i, fc in enumerate(_THIRD_OCT_CENTRES):
        lo, hi = fc / ratio, fc * ratio
        mask = (freqs >= lo) & (freqs < hi)
        if not mask.any():
            bands[i] = 1e-12
        else:
            bands[i] = float(np.sum(mag[mask] ** 2))

    # Convert to dB, peak-normalise.
    peak = float(np.max(bands))
    if peak <= 0:
        return [-60.0] * 31
    db = 10.0 * np.log10(bands / peak)
    # Floor at −60 dB so very quiet bands don't make the UI heatmap noisy.
    db = np.maximum(db, -60.0)
    return [round(float(v), 1) for v in db]


def analyze_single_file(path: str) -> dict:
    """
    Return the batch summary dict for one audio file. Never raises —
    on failure, the `error` field is set and other fields are None.
    """
    t0 = time.time()
    base = os.path.basename(path)
    out = {
        "path": path,
        "filename": base,
        "analysed_sec": None,
        "error": None,
        # Measurements
        "lufs_i": None,
        "true_peak_dbtp": None,
        "lra": None,
        "duration_sec": None,
        "sample_rate": None,
        "bit_depth": None,
        "channels": None,
        "clipped_samples": None,
        "mono_compat_loss_pct": None,
        # 31-band 1/3-octave spectrum (dB, relative to peak) — enables
        # Cohort Mode's reference-distance + class-wide drift heatmap.
        # None when spectrum computation failed or the file is too short.
        "spectrum": None,
        # Metadata
        "isrc": None,
        "upc": None,
        "title": None,
        "artist": None,
        "album": None,
        "track_number": None,
        # DMR v1 fields — Explicit / P-line / C-line. null when the file
        # doesn't assert a value; DMR treats null as "can't diff this side".
        "explicit": None,
        "p_line": None,
        "c_line": None,
        "spec_versions": _spec_versions(),
    }
    try:
        # Delivery-relevant fields (flat shape — union of BWF bext + iXML +
        # LIST-INFO + ID3v2). Used by DMR reconciliation against manifests.
        try:
            fields = read_delivery_fields(path) or {}
            out["isrc"] = fields.get("isrc") or out["isrc"]
            out["upc"] = fields.get("upc") or out["upc"]
            out["title"] = fields.get("title") or out["title"]
            out["artist"] = fields.get("artist") or out["artist"]
            out["album"] = fields.get("album") or out["album"]
            out["track_number"] = fields.get("track") or out["track_number"]
            out["explicit"] = fields.get("explicit")
            out["p_line"] = fields.get("p_line")
            out["c_line"] = fields.get("c_line")
        except Exception:
            pass

        # Read audio — always 2-d (samples, channels). soundfile handles
        # WAV / FLAC / AIFF / OGG natively; MP3 support depends on build.
        data, sr = sf.read(path, always_2d=True, dtype="float32")
        if data.ndim == 1:
            data = data.reshape(-1, 1)
        out["sample_rate"] = int(sr)
        out["channels"] = int(data.shape[1])
        out["duration_sec"] = round(data.shape[0] / float(sr), 3)

        # Bit depth — soundfile reports the native subtype; map to bits.
        try:
            info = sf.info(path)
            st = (info.subtype or "").upper()
            depth_map = {
                "PCM_S8": 8, "PCM_U8": 8, "PCM_16": 16, "PCM_24": 24,
                "PCM_32": 32, "FLOAT": 32, "DOUBLE": 64,
            }
            out["bit_depth"] = depth_map.get(st, None)
        except Exception:
            pass

        # Integrated LUFS + LRA via pyloudnorm.
        # 5.3.1 multichannel correctness: pyloudnorm itself implements
        # BS.1770-4 channel weights (L=R=C=1.0, Ls=Rs=1.41, LFE=0).
        # Pre-5.3 we forced `data[:, :2]` for >2-ch — that silently
        # threw away the centre and surround channels, under-reporting
        # LUFS on 5.1 / 7.1 / Atmos beds. Pass the full channel set
        # through and let pyloudnorm do BS.1770. Loud-spec outputs
        # >5.1 are still uncommon but should be measured honestly.
        meter = pyln.Meter(sr)
        lufs_input = data
        try:
            out["lufs_i"] = round(float(meter.integrated_loudness(lufs_input)), 2)
        except Exception:
            out["lufs_i"] = None
        # LRA per BS.1770-4 / EBU R128. pyloudnorm exposes
        # `Meter.loudness_range(data)` (correct gated LRA). If for
        # some reason that fails, we fall back to a comparator-style
        # approximation that still uses pyloudnorm internally.
        # 5.3.1 fix: pre-5.3 the fallback called `meter.integrated_loudness`
        # per 3 s window and took p95-p10 — that's a percentile of
        # *integrated* values, NOT short-term, so the spread was
        # mis-defined. Now we route through the proper LRA call and,
        # if that's unavailable, skip rather than emit a wrong number.
        try:
            out["lra"] = round(float(meter.loudness_range(lufs_input)), 2)
        except Exception:
            # Honest fallback: leave LRA missing rather than report a
            # wrong number. The UI shows "—" in that cell.
            out["lra"] = None

        # True peak per channel, take the max.
        tp = -120.0
        for ch in range(data.shape[1]):
            tp = max(tp, _true_peak_4x(data[:, ch], sr))
        out["true_peak_dbtp"] = round(tp, 2)

        # Clipping sample count (all channels).
        out["clipped_samples"] = int(np.sum(np.abs(data) >= 0.9999))

        # Mono-compat risk — mean-sum vs L+R RMS delta, % of energy lost.
        if data.shape[1] >= 2:
            L = data[:, 0].astype(np.float64)
            R = data[:, 1].astype(np.float64)
            stereo_rms = np.sqrt(np.mean((L * L + R * R) / 2.0) + 1e-12)
            mono_rms = np.sqrt(np.mean(((L + R) * 0.5) ** 2) + 1e-12)
            loss = max(0.0, min(1.0, 1.0 - (mono_rms / stereo_rms)))
            out["mono_compat_loss_pct"] = round(float(loss * 100.0), 1)
        else:
            out["mono_compat_loss_pct"] = 0.0

        # 31-band 1/3-octave spectrum (dB relative to peak). Cheap to
        # compute — one FFT over a 30 s central window. Powers Cohort
        # Mode's distance-from-reference column + class-wide drift heatmap.
        try:
            out["spectrum"] = _compute_31band_spectrum(data, sr)
        except Exception:
            pass

        out["analysed_sec"] = round(time.time() - t0, 2)
    except Exception as e:
        out["error"] = str(e)
    return out


def _emit_progress(kind: str, **extra):
    """Progress line on stderr — same NDJSON convention as analyze.py."""
    try:
        sys.stderr.write(json.dumps({"type": kind, **extra}) + "\n")
        sys.stderr.flush()
    except Exception:
        pass


def _run_deep_for_file(path: str, profile: str = "ohad", timeout_sec: int = 180) -> dict:
    """
    Run the full single-file pipeline (analyze.py with A==B == ref-only
    mode) as a subprocess and return the parsed JSON result. Returns
    {"__error": "..."} on failure so callers can still produce a partial
    result without aborting the whole batch.

    Uses --fast so the heavy 2-file branches (Demucs, waveform diff,
    masking) stay off — we want single-file deep-analysis data only.
    """
    script = os.path.join(os.path.dirname(__file__), "analyze.py")
    cmd = [sys.executable, script, path, path, "--fast", f"--profile={profile}"]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "")[-500:]
            return {"__error": f"exit {proc.returncode}: {err.strip()}"}
        try:
            return json.loads(proc.stdout)
        except Exception as e:
            return {"__error": f"parse error: {e}"}
    except subprocess.TimeoutExpired:
        return {"__error": f"timed out after {timeout_sec}s"}
    except Exception as e:
        return {"__error": str(e)}


def main(paths, deep: bool = False, deep_workers: int = 0):
    """
    Run lightweight batch analysis. When `deep=True`, also kick off full
    single-file deep analyses in parallel (subprocesses) so the album
    lands in the batch view with every track already cached — users
    traded a longer scan for instant tab switches.
    """
    total = len(paths)
    # Compute lightweight per-song measurements serially — it's already
    # fast (~1-2 s each) and running them in parallel saves little while
    # complicating progress reporting.
    results = []
    for i, p in enumerate(paths):
        _emit_progress(
            "progress",
            message=f"Scanning {i + 1}/{total} · {os.path.basename(p)}",
            index=i,
            total=total,
        )
        results.append(analyze_single_file(p))

    if not deep:
        print(json.dumps({"results": results, "spec_versions": _spec_versions()}))
        return

    # Deep pass — parallel subprocesses of analyze.py per song. Bounded
    # at 4 concurrent workers by default (or cpu_count if smaller) so we
    # don't over-subscribe on small laptops. Each subprocess is ~15–25 s
    # of Python+NumPy+scipy work, so we want multiple in flight at once.
    if deep_workers <= 0:
        try:
            cpu = os.cpu_count() or 2
        except Exception:
            cpu = 2
        deep_workers = max(1, min(4, cpu))
    _emit_progress(
        "progress",
        message=f"Deep analysis · running {deep_workers} in parallel across {total} tracks",
        index=0,
        total=total,
        phase="deep_start",
    )
    deep_results: dict = {}
    completed = 0
    with ThreadPoolExecutor(max_workers=deep_workers) as ex:
        future_to_path = {ex.submit(_run_deep_for_file, p): p for p in paths}
        for fut in as_completed(future_to_path):
            p = future_to_path[fut]
            completed += 1
            try:
                res = fut.result()
            except Exception as e:
                # Keep a consistent error envelope so the renderer can
                # branch on `deep[path].error` without crashing when it
                # tries to read `.overall` on an error row.  Both keys
                # are set so legacy callers checking `__error` still
                # work; new callers use `error`.
                res = {
                    "error": str(e)[:500],
                    "__error": str(e)[:500],
                    "path": p,
                }
            # Guard against worker returning a dict-shaped error too —
            # _run_deep_for_file sometimes reports `{"__error": ...}`
            # without raising.  Normalise to the same envelope.
            if isinstance(res, dict) and "__error" in res and "error" not in res:
                res["error"] = res["__error"]
            deep_results[p] = res
            _emit_progress(
                "progress",
                message=f"Deep analysis · {completed}/{total} · {os.path.basename(p)}",
                index=completed - 1,
                total=total,
                phase="deep_file_done",
                path=p,
            )
    print(json.dumps({"results": results, "deep": deep_results, "spec_versions": _spec_versions()}))


def _parse_argv(argv):
    """Tiny arg parser — keeps backward compat. Positional args are file
    paths; recognised flags: --deep (bool), --deep-workers=N."""
    deep = False
    deep_workers = 0
    paths = []
    for arg in argv:
        if arg == "--deep":
            deep = True
        elif arg.startswith("--deep-workers="):
            try:
                deep_workers = int(arg.split("=", 1)[1])
            except Exception:
                pass
        elif arg.startswith("--"):
            # Unknown flag — ignore rather than crashing, lets older
            # callers keep working if we add more flags later.
            continue
        else:
            paths.append(arg)
    return paths, deep, deep_workers


if __name__ == "__main__":
    paths, deep, deep_workers = _parse_argv(sys.argv[1:])
    if not paths:
        print(json.dumps({"error": "No files provided"}))
        sys.exit(1)
    main(paths, deep=deep, deep_workers=deep_workers)
