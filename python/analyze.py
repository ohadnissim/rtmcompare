#!/usr/bin/env python3
"""
RTM Audio Comparison — Main entry point.

Usage: python analyze.py <file_a> <file_b> [--fast]

--fast: Frequency-band analysis only (~10 seconds)
Default: Hybrid mode — AI stems on a 30s chunk for kick/bass accuracy,
         frequency bands for everything else (~30-60 seconds)
"""

import sys
import os
import json
import logging
import tempfile
import shutil
import time
import uuid
from datetime import datetime, timezone

# Windows: the bundled embeddable Python uses a `_pth` file that does NOT
# auto-add the script's directory to sys.path, so neighbour modules
# (comparator, separator, etc.) won't import. Insert our own dir to
# make `from comparator import …` work on every platform.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np

# Optional-analyzer warnings go to stderr so the Electron bridge can
# surface them to the user.  Previously every optional step had a
# `try/except: pass` that silently dropped the whole analyser when its
# dependency was missing or its input was degenerate; the UI had no
# way to tell an absent-field from a failed-analysis.
_log = logging.getLogger("rtm.analyze")
if not _log.handlers:
    _h = logging.StreamHandler(sys.stderr)
    _h.setFormatter(logging.Formatter("[analyze] %(levelname)s %(message)s"))
    _log.addHandler(_h)
    _log.setLevel(logging.WARNING)

def _warn_optional(stage: str, err: BaseException) -> None:
    """Log a failed optional analyser with its stage name so users can
    tell what went missing from the result dict.  Also attaches the
    error into `_optional_failures` for the caller to include in the
    final result JSON when appropriate."""
    _log.warning("%s skipped: %s", stage, err)
    try:
        _optional_failures.append({"stage": stage, "error": str(err)[:300]})
    except Exception:
        pass

# Populated during the run; caller appends to `result["analysis_warnings"]`.
_optional_failures: list = []

def sanitize(obj):
    """Convert numpy types to Python natives for JSON serialization."""
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [sanitize(v) for v in obj]
    elif isinstance(obj, (np.integer,)):
        return int(obj)
    elif isinstance(obj, (np.floating,)):
        v = float(obj)
        if np.isnan(v) or np.isinf(v):
            return 0.0
        return round(v, 4)
    elif isinstance(obj, np.ndarray):
        return sanitize(obj.tolist())
    elif isinstance(obj, float):
        if np.isnan(obj) or np.isinf(obj):
            return 0.0
        return obj
    return obj

from comparator import run_fast_analysis


def _true_peak_db(file_path: str, sr: int = 44100) -> tuple:
    """
    ITU-R BS.1770-compliant true-peak + headroom using 4× polyphase oversampling.

    Returns (true_peak_dbTP, headroom_dBTP_below_0) as a pair of rounded floats.
    Measures per-channel and returns the worst case across L/R.
    """
    from scipy.signal import resample_poly
    import soundfile as sf
    try:
        data, file_sr = sf.read(file_path, dtype='float32')
        if data.ndim == 1:
            channels = [data]
        else:
            channels = [data[:, c] for c in range(min(2, data.shape[1]))]
        # 4× upsample and take max |sample|
        worst = 0.0
        for ch in channels:
            up = resample_poly(ch, 4, 1)
            worst = max(worst, float(np.max(np.abs(up))))
        tp_db = float(20 * np.log10(max(worst, 1e-10)))
        headroom = max(0.0, -tp_db)
        return round(tp_db, 1), round(headroom, 1)
    except Exception:
        # Fallback: plain sample peak
        import librosa as _lr2
        y, _ = _lr2.load(file_path, sr=sr, mono=True)
        peak = float(np.max(np.abs(y)))
        tp_db = float(20 * np.log10(max(peak, 1e-10)))
        return round(tp_db, 1), round(max(0.0, -tp_db), 1)
from click_detector import detect_clicks, detect_clicks_single
from distortion_detector import detect_distortion, detect_distortion_single
from visualizations import generate_all_viz_data
from tonal_issues import detect_tonal_issues
from reference_check import check_reference
from adm_parser import detect_format, validate_adm
from atmos_comparator import run_atmos_comparison, run_atmos_solo
from engineer_profile import generate_tips, list_profiles
from metadata_reader import read_metadata
from hum_detector import detect_hum
from transient_density import analyse as analyse_transient_density
from waveform_diff import compute as compute_waveform_diff
from dialog_gate import detect_dialog_lufs
from limiter_artefacts import analyse as analyse_limiter_artefacts
from specs import SPECS_VERSION, to_json as _specs_to_json


def progress(msg: str):
    print(json.dumps({"type": "progress", "message": msg}), file=sys.stderr, flush=True)


def _stamp_spec_versions(result: dict) -> dict:
    result["spec_versions"] = {
        "version": SPECS_VERSION,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "specs": _specs_to_json(),
    }
    return result


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python analyze.py <file_a> <file_b> [--fast]"}))
        sys.exit(1)

    file_a = sys.argv[1]
    file_b = sys.argv[2]
    fast_mode = "--fast" in sys.argv

    # Parse profile
    profile_id = "ohad"
    for arg in sys.argv:
        if arg.startswith("--profile="):
            profile_id = arg.split("=", 1)[1]

    if not os.path.exists(file_a):
        print(json.dumps({"error": f"File not found: {file_a}"}))
        sys.exit(1)
    if not os.path.exists(file_b):
        print(json.dumps({"error": f"File not found: {file_b}"}))
        sys.exit(1)

    # File compatibility checks
    import soundfile as sf
    import librosa as _lr
    info_a = sf.info(file_a)
    info_b = sf.info(file_b)
    file_warnings = []

    if info_a.samplerate != info_b.samplerate:
        file_warnings.append({
            "type": "sample_rate",
            "message": f"Different sample rates: {info_a.samplerate} Hz vs {info_b.samplerate} Hz. Files will be resampled for comparison — minor accuracy impact.",
        })

    len_diff_pct = abs(info_a.duration - info_b.duration) / max(info_a.duration, 0.1) * 100
    if len_diff_pct > 5:
        file_warnings.append({
            "type": "length",
            "message": f"File lengths differ by {len_diff_pct:.0f}% ({info_a.duration:.1f}s vs {info_b.duration:.1f}s). Analysis uses the shorter duration — tail differences will be missed.",
        })

    # ─── Detect multichannel / Atmos files ─────────────────────────────
    format_a = detect_format(file_a)
    format_b = detect_format(file_b)

    # Determine if this is a stereo vs Atmos comparison OR a solo Atmos analysis
    is_atmos_comparison = False
    is_atmos_solo = False
    file_stereo = None
    file_atmos = None
    atmos_format = None

    is_ref_only_path = os.path.abspath(file_a) == os.path.abspath(file_b)

    if is_ref_only_path and format_a["is_multichannel"]:
        # Single multichannel file — run Atmos-solo analysis (no stereo ref).
        is_atmos_solo = True
        file_atmos = file_a
        atmos_format = format_a
    elif format_a["is_multichannel"] and not format_b["is_multichannel"]:
        # File A is multichannel, File B is stereo — swap so stereo is always A
        is_atmos_comparison = True
        file_stereo = file_b
        file_atmos = file_a
        atmos_format = format_a
    elif format_b["is_multichannel"] and not format_a["is_multichannel"]:
        # File A is stereo, File B is multichannel — normal
        is_atmos_comparison = True
        file_stereo = file_a
        file_atmos = file_b
        atmos_format = format_b
    elif format_a["is_multichannel"] and format_b["is_multichannel"]:
        file_warnings.append({
            "type": "multichannel",
            "message": "Both files are multichannel. Comparing their stereo downmixes.",
        })

    # ─── Atmos SOLO path (single multichannel file) ────────────────────
    if is_atmos_solo:
        progress(f"Detected {atmos_format['channel_layout']['name']} — running Atmos solo analysis...")
        try:
            result = run_atmos_solo(file_atmos, atmos_format, progress_cb=progress)
            result["file_warnings"] = file_warnings

            # Reference check + visualizations on the downmix
            downmix_path = result.get("atmos_downmix_path", file_atmos)
            progress("Checking reference quality on downmix...")
            result["reference_check"] = check_reference(downmix_path)

            # True peak / headroom from downmix (4× oversampled per ITU-R BS.1770)
            true_peak, headroom = _true_peak_db(downmix_path)
            result["headroom"] = {"a": headroom, "b": headroom, "true_peak_a": true_peak, "true_peak_b": true_peak}

            progress("Scanning for digital clicks on downmix...")
            result["clicks"] = detect_clicks_single(downmix_path)

            progress("Checking for distortion on downmix...")
            result["distortion"] = detect_distortion_single(downmix_path)

            progress("Checking tonal balance on downmix...")
            result["tonal_issues"] = detect_tonal_issues(downmix_path, downmix_path)

            progress("Generating visualizations on downmix...")
            result.update(generate_all_viz_data(downmix_path, downmix_path))

            # Engineer tips on the downmix (treat it as master)
            progress("Generating engineer tips on downmix...")
            try:
                result["engineer_tips"] = generate_tips(downmix_path, downmix_path, profile_id=profile_id)
            except Exception:
                pass

            _stamp_spec_versions(result)
            progress("Done!")
            print(json.dumps(sanitize(result)))
            return
        except Exception as e:
            print(json.dumps({"error": f"Atmos solo analysis failed: {str(e)}"}))
            sys.exit(1)

    # ─── Atmos comparison path ─────────────────────────────────────────
    if is_atmos_comparison:
        progress(f"Detected {atmos_format['channel_layout']['name']} multichannel file — running Stereo vs Atmos comparison...")

        try:
            result = run_atmos_comparison(
                file_stereo, file_atmos, atmos_format,
                progress_cb=progress,
            )

            # Reference check on the stereo file
            progress("Checking reference quality...")
            result["reference_check"] = check_reference(file_stereo)
            result["file_warnings"] = file_warnings



            # Headroom / true-peak from stereo file (4× oversampled per BS.1770)
            true_peak, headroom = _true_peak_db(file_stereo)
            result["headroom"] = {
                "a": headroom, "b": headroom,
                "true_peak_a": true_peak, "true_peak_b": true_peak,
            }

            # Run quality checks on the downmix
            downmix_path = result.get("atmos_downmix_path", file_atmos)
            progress("Scanning for digital clicks...")
            result["clicks"] = detect_clicks(file_stereo, downmix_path)

            progress("Checking for distortion...")
            result["distortion"] = detect_distortion(file_stereo, downmix_path)

            progress("Checking tonal balance...")
            result["tonal_issues"] = detect_tonal_issues(file_stereo, downmix_path)

            progress("Generating visualizations...")
            result.update(generate_all_viz_data(file_stereo, downmix_path))

            _stamp_spec_versions(result)
            progress("Done!")
            print(json.dumps(sanitize(result)))
            return

        except Exception as e:
            print(json.dumps({"error": f"Atmos comparison failed: {str(e)}"}))
            sys.exit(1)

    # Headroom / true peak for both files — ITU-R BS.1770, 4× oversampled, stereo-aware
    true_peak_a, headroom_a = _true_peak_db(file_a)
    true_peak_b, headroom_b = _true_peak_db(file_b)

    tmp_dir = tempfile.mkdtemp(prefix="rtm_")

    # CRIT-16: use a per-analysis subdirectory so concurrent analyses don't
    # stomp each other's stems. Each run gets a unique ID; old runs (>2 h)
    # are pruned rather than deleting everything at startup.
    _stems_root = os.path.join(os.path.expanduser("~"), ".rtm", "stems")
    os.makedirs(_stems_root, exist_ok=True)
    stems_dir = os.path.join(_stems_root, f"run_{uuid.uuid4().hex[:8]}")
    os.makedirs(stems_dir, exist_ok=True)
    # Prune stale runs older than 2 h
    _prune_cutoff = time.time() - 7200
    for _entry in os.listdir(_stems_root):
        _p = os.path.join(_stems_root, _entry)
        if os.path.isdir(_p) and _p != stems_dir:
            try:
                if os.path.getmtime(_p) < _prune_cutoff:
                    shutil.rmtree(_p, ignore_errors=True)
            except OSError:
                pass

    try:
        # Check reference quality first
        progress("Checking reference quality...")
        result_ref_check = check_reference(file_a)

        if fast_mode:
            progress("Analyzing (fast mode)...")
            result = run_fast_analysis(file_a, file_b)
        else:
            # Hybrid: AI on a 30s chunk for kick/bass, fast for everything else
            # Use persistent stems_dir so stems survive for playback
            from comparator import run_hybrid_analysis
            progress("Running hybrid analysis...")
            result = run_hybrid_analysis(file_a, file_b, stems_dir, progress_cb=progress)

        result["reference_check"] = result_ref_check
        # Genre for both files — pulled out of reference_check so the UI can
        # show a side-by-side read on the compare view. check_reference is
        # slow but already runs once; we add a second pass for file B in
        # 2-file mode. For ref-only we mirror file A into both slots so the
        # same panel renders.
        # 5.2.3 (beta-tester report): genre auto-detection removed.
        # The classifier produced false readings on real-world masters
        # ("Hip-Hop" on a folk track, etc.) and nothing downstream
        # acted on the value. Saved a Python pass on every analyse.
        result["file_warnings"] = file_warnings
        result["headroom"] = {
            "a": headroom_a,
            "b": headroom_b,
            "true_peak_a": true_peak_a,
            "true_peak_b": true_peak_b,
        }

        # Use single-file detection when ref-only (file_a == file_b)
        is_ref_only = is_ref_only_path

        progress("Scanning for digital clicks...")
        result["clicks"] = detect_clicks_single(file_a) if is_ref_only else detect_clicks(file_a, file_b)

        progress("Checking for distortion...")
        result["distortion"] = detect_distortion_single(file_a) if is_ref_only else detect_distortion(file_a, file_b)

        progress("Checking tonal balance...")
        result["tonal_issues"] = detect_tonal_issues(file_a, file_b)

        progress("Generating visualizations...")
        result.update(generate_all_viz_data(file_a, file_b, deep_scan=not fast_mode))

        # Masking (deep scan uses stems; fast mode falls back to full-mix
        # density). AI detection was removed in 5.5.0 — the bundle would
        # have shipped 1.1 GB of model weights for it.
        try:
            from masking import analyze_masking
            if not fast_mode:
                progress("Analysing masking between stems...")
                # MED-11: pass stems_b explicitly so masking never relies on
                # mtime ordering to pick between stems_a and stems_b.
                stems_b_for_masking = os.path.join(stems_dir, "stems_b")
                _msk_dir = stems_b_for_masking if os.path.isdir(stems_b_for_masking) else stems_dir
                result["masking"] = analyze_masking(stems_dir=_msk_dir, file_path=file_b)
            else:
                result["masking"] = analyze_masking(file_path=file_b)
        except Exception as e:
            _warn_optional("masking", e)

        # Streaming normalization preview — what A and B will play at on
        # major platforms (Spotify / Apple / YouTube / Tidal / etc.)
        try:
            from comparator import streaming_preview
            result["streaming_preview"] = {
                "a": streaming_preview(result["overall"]["lufs_a"], true_peak_a),
                "b": streaming_preview(result["overall"]["lufs_b"], true_peak_b),
            }
        except Exception as e:
            _warn_optional("streaming_preview", e)

        # Load a mono chunk of file B once so the new detectors can re-use it
        try:
            import librosa as _lr_new
            mono_b_full, _ = _lr_new.load(file_b, sr=44100, mono=True)
            mono_a_full, _ = _lr_new.load(file_a, sr=44100, mono=True) if not is_ref_only else (mono_b_full, 44100)
        except Exception as e:
            _warn_optional("mono-reload (blocks hum/dialog/limiter/transient)", e)
            mono_b_full = None
            mono_a_full = None

        # Per-file durations — important for sync briefs, Atmos delivery, and
        # any A/B where length differences (e.g. a radio edit vs full mix) need
        # to be obvious to the user.
        try:
            # 3-decimal precision (1 ms) — matters for Atmos / broadcast /
            # OTT delivery where slot fits and frame counts are exact.
            if mono_a_full is not None:
                result["duration_sec_a"] = round(len(mono_a_full) / 44100.0, 3)
            if mono_b_full is not None:
                result["duration_sec_b"] = round(len(mono_b_full) / 44100.0, 3)
            # Keep top-level duration_sec aligned with file A when comparing
            # (so legacy time-axis components stay consistent), or set it from
            # whichever side we have.
            if "duration_sec" not in result or not result.get("duration_sec"):
                result["duration_sec"] = result.get("duration_sec_a") or result.get("duration_sec_b")
        except Exception as e:
            _warn_optional("duration_sec", e)

        # (mood / emotion detection removed in v4.0: the rule-based fingerprint
        #  was too unreliable to surface to engineers, and rebuilding it with an
        #  ML model was out of scope.  If we ever revisit, the analyser lived
        #  at python/mood_detector.py — deleted alongside this block.)

        # Hum / buzz detection (on file B — that's the file under scrutiny)
        try:
            if mono_b_full is not None:
                result["hum"] = detect_hum(mono_b_full, 44100)
        except Exception as e:
            _warn_optional("hum_detection", e)

        # Dialog-gated LUFS — measures speech-only integrated loudness.
        # Silent on pure-music tracks (returns None → UI hides the row).
        # Netflix / ATSC A/85 QC anchors here, not the full-programme
        # integrated number.
        try:
            if mono_b_full is not None:
                dialog = detect_dialog_lufs(mono_b_full, 44100)
                if dialog is not None:
                    result["dialog_gate"] = dialog
        except Exception as e:
            _warn_optional("dialog_gate", e)

        # Limiter-artefact detector — catches pumping, inter-sample
        # clipping, and brick-wall ringing that the generic distortion
        # detector misses.  Panel ask (Marek, mastering).
        try:
            if mono_b_full is not None:
                result["limiter_artefacts"] = analyse_limiter_artefacts(mono_b_full, 44100)
        except Exception as e:
            _warn_optional("limiter_artefacts", e)

        # Transient density + section timeline
        try:
            if mono_b_full is not None:
                duration = result.get("duration_sec") or (len(mono_b_full) / 44100)
                result["transient_density"] = analyse_transient_density(mono_b_full, 44100, duration_sec=duration)
        except Exception as e:
            _warn_optional("transient_density", e)

        # Waveform / spectrum diff heatmap (only meaningful when comparing)
        if not is_ref_only:
            try:
                result["waveform_diff"] = compute_waveform_diff(file_a, file_b)
            except Exception as e:
                _warn_optional("waveform_diff", e)

        # BEXT / iXML metadata (only meaningful for WAV/BWF)
        try:
            meta_a = read_metadata(file_a)
            meta_b = read_metadata(file_b)
            if meta_a or meta_b:
                result["metadata"] = {"a": meta_a, "b": meta_b}
        except Exception as e:
            _warn_optional("metadata_reader", e)

        # Engineer tips — "What would [Engineer] do?"
        progress("Generating engineer tips...")
        result["engineer_tips"] = generate_tips(file_b, file_a, profile_id=profile_id)

        # Surface every optional-analyser failure into the result so
        # the UI can tell "masking disabled on purpose" from "masking
        # blew up silently".  Empty list is fine; downstream panels
        # check `analysis_warnings.find(w => w.stage === "masking")`.
        if _optional_failures:
            result["analysis_warnings"] = list(_optional_failures)

        _stamp_spec_versions(result)
        progress("Done!")
        print(json.dumps(sanitize(result)))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    finally:
        # Only clean the temp dir, NOT the stems dir
        try:
            shutil.rmtree(tmp_dir)
        except Exception:
            pass


if __name__ == "__main__":
    main()
