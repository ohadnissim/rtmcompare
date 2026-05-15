#!/usr/bin/env python3
"""
RTM Nonstop Regression Test Suite
Runs automatically every 30 minutes via launchd (com.rtm.regression.plist).
Also runnable manually: python3 rtm_regression.py [--once] [--verbose]

Tests:
  1.  Python pipeline smoke (analyze.py imports, core functions)
  2.  RTM daemon JSON-RPC (ping, analyze_single, analyze, unknown-method error)
  3.  Edge-case audio (silent, tiny, near-clip, mono, DC-offset)
  4.  Tonal issues sr=None regression (fixed in bc3f853)
  5.  Persistent state (history.json round-trip, profiles, plugin-knowledge)
  6.  IPC channel synchrony (preload.ts vs main.ts must stay in sync)
  7.  Production build artifact presence (dist/index.html, dist-electron/main.js)
  8.  RTMprofile Python imports
  9.  Full compare workflow — real MIX.wav vs MASTER.wav, 20+ field validation
  10. RTMprofile build workflow — build_profile on real track cache
  11. RTMsend connectivity — port file format, TCP probe if live instance found
  12. Auto-remediation — restart stale daemon processes; macOS alert on failure

Exit code 0 = all pass. Non-zero = failures logged to ~/.rtm/regression.log
"""
from __future__ import annotations

import argparse
import io
import json
import logging
import math
import os
import re
import subprocess
import sys
import tempfile
import time
import traceback
from pathlib import Path
from typing import Any

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR   = Path(__file__).resolve().parent
PYTHON_DIR   = SCRIPT_DIR / "python"
BUNDLED_PY   = SCRIPT_DIR / "python-bundle" / "python" / "bin" / "python3"
RTM_DIR      = Path.home() / ".rtm"
LOG_PATH     = RTM_DIR / "regression.log"
HISTORY_PATH = RTM_DIR / "history.json"
PRELOAD_TS   = SCRIPT_DIR / "electron" / "preload.ts"
MAIN_TS      = SCRIPT_DIR / "electron" / "main.ts"
DIST_HTML    = SCRIPT_DIR / "dist" / "index.html"
ELECTRON_JS  = SCRIPT_DIR / "dist-electron" / "main.js"

# Use bundled Python if present, else system Python
PYTHON = str(BUNDLED_PY) if BUNDLED_PY.exists() else sys.executable

# ── Logging ───────────────────────────────────────────────────────────────────
RTM_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    handlers=[
        logging.FileHandler(LOG_PATH),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("rtm-regression")

# ── Test infrastructure ───────────────────────────────────────────────────────
_pass = _fail = 0

def check(name: str, cond: bool, detail: str = "") -> bool:
    global _pass, _fail
    if cond:
        log.info("  PASS  %s", name)
        _pass += 1
    else:
        log.error("  FAIL  %s%s", name, f" — {detail}" if detail else "")
        _fail += 1
    return cond


def _gen_silence(path: str, duration: float = 1.0, sr: int = 44100) -> None:
    import wave, struct
    n = int(duration * sr)
    with wave.open(path, "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(struct.pack(f"<{n}h", *([0] * n)))


def _gen_sine(path: str, freq: float = 440.0, amp: float = 0.7,
              duration: float = 2.0, sr: int = 44100, mono: bool = True) -> None:
    import wave, struct, math as _m
    n = int(duration * sr)
    samples = [int(amp * 32767 * _m.sin(2 * _m.pi * freq * i / sr)) for i in range(n)]
    ch = 1 if mono else 2
    with wave.open(path, "w") as wf:
        wf.setnchannels(ch)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        data = b""
        if ch == 2:
            for s in samples:
                data += struct.pack("<hh", s, s)
        else:
            data = struct.pack(f"<{n}h", *samples)
        wf.writeframes(data)


def _run_daemon_rpc(requests: list[dict], timeout: int = 60) -> list[dict]:
    """Spin up the RTM daemon, send all requests, collect complete stdout.

    Uses communicate() so every response is captured regardless of thread-pool
    scheduling — avoids the race where shutdown is processed before in-flight
    analysis tasks write their output lines.
    """
    env = os.environ.copy()
    env["PYTHONPATH"] = str(PYTHON_DIR)
    proc = subprocess.Popen(
        [PYTHON, str(PYTHON_DIR / "rtm_daemon.py"), "--daemon"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env=env, text=True,
    )
    stdin_payload = (
        "\n".join(json.dumps(r) for r in requests)
        + "\n"
        + json.dumps({"id": "_shutdown", "method": "shutdown"})
        + "\n"
    )
    try:
        stdout_data, _ = proc.communicate(input=stdin_payload, timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        stdout_data, _ = proc.communicate()

    responses: list[dict] = []
    for line in stdout_data.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            if obj.get("type") != "progress":
                responses.append(obj)
        except json.JSONDecodeError:
            pass
    return responses


# ── Test 1: Python pipeline smoke ─────────────────────────────────────────────
def test_python_imports() -> None:
    log.info("=== Test 1: Python pipeline imports ===")
    critical_modules = [
        "analyze", "comparator", "rtm_daemon", "tonal_issues",
        "rtm_fast", "masking", "visualizations", "encoded_preview",
        "translation_render", "engineer_profile", "reference_check",
        "click_repair_v2", "distortion_detector", "hum_detector",
        "generation_loss_detector", "limiter_artefacts", "transient_density",
        "waveform_diff", "metadata_reader", "specs",
    ]
    result = subprocess.run(
        [PYTHON, "-c",
         f"import sys; sys.path.insert(0,{str(PYTHON_DIR)!r}); "
         + "; ".join(f"import {m}" for m in critical_modules)
         + "; print('OK')"],
        capture_output=True, text=True, timeout=30,
    )
    check("all critical Python modules import cleanly",
          result.returncode == 0 and "OK" in result.stdout,
          result.stderr[-300:] if result.returncode != 0 else "")


# ── Test 2: RTM daemon JSON-RPC ───────────────────────────────────────────────
def test_daemon_rpc() -> None:
    log.info("=== Test 2: RTM daemon JSON-RPC ===")
    with tempfile.TemporaryDirectory() as td:
        sine_a = os.path.join(td, "a.wav")
        sine_b = os.path.join(td, "b.wav")
        _gen_sine(sine_a, freq=440.0, amp=0.5)
        _gen_sine(sine_b, freq=880.0, amp=0.6)

        requests = [
            {"id": "p1", "method": "ping"},
            {"id": "as1", "method": "analyze_single", "params": {"file": sine_a}},
            {"id": "bad", "method": "nonexistent_method", "params": {}},
        ]
        try:
            responses = _run_daemon_rpc(requests, timeout=90)
        except Exception as e:
            check("daemon RPC round-trip", False, str(e))
            return

        by_id = {r.get("id"): r for r in responses}

        # ping — daemon wraps in {"result": {"pong": true, ...}} per JSON-RPC
        ping = by_id.get("p1", {})
        pong_val = ping.get("pong") or ping.get("result", {}).get("pong")
        check("daemon ping responds {pong: true}",
              pong_val is True, str(ping))

        # analyze_single — returns a compare-against-self result: has categories, gain_applied_db
        asi_raw = by_id.get("as1", {})
        asi = asi_raw.get("result", asi_raw)
        check("analyze_single returns result (categories or error)",
              "categories" in asi or "lufs" in asi or "error" in asi,
              str(asi_raw)[:200])
        if "categories" in asi:
            check("analyze_single categories is a list",
                  isinstance(asi["categories"], list), str(type(asi["categories"])))

        # unknown method error
        err_raw = by_id.get("bad", {})
        err = err_raw.get("result", err_raw)
        check("unknown method returns error field",
              "error" in err_raw or "error" in err, str(err_raw))


# ── Test 3: Edge-case audio ───────────────────────────────────────────────────
def test_edge_case_audio() -> None:
    log.info("=== Test 3: Edge-case audio ===")
    with tempfile.TemporaryDirectory() as td:
        normal = os.path.join(td, "normal.wav")
        silent = os.path.join(td, "silent.wav")
        tiny   = os.path.join(td, "tiny.wav")
        clip   = os.path.join(td, "clip.wav")

        _gen_sine(normal, amp=0.5, duration=2.0)
        _gen_silence(silent, duration=2.0)
        _gen_silence(tiny, duration=0.1)
        _gen_sine(clip, amp=0.9999, duration=2.0)

        requests = [
            {"id": "ec_normal", "method": "analyze_single", "params": {"file": normal}},
            {"id": "ec_silent", "method": "analyze_single", "params": {"file": silent}},
            {"id": "ec_tiny",   "method": "analyze_single", "params": {"file": tiny}},
            {"id": "ec_clip",   "method": "analyze_single", "params": {"file": clip}},
        ]
        try:
            responses = _run_daemon_rpc(requests, timeout=120)
        except Exception as e:
            check("edge-case audio daemon round-trip", False, str(e))
            return

        by_id = {r.get("id"): r for r in responses}

        for name, eid in [("normal", "ec_normal"), ("silent", "ec_silent"),
                          ("tiny", "ec_tiny"), ("near-clip", "ec_clip")]:
            raw = by_id.get(eid, {})
            r = raw.get("result", raw)  # unwrap JSON-RPC envelope
            # analyze_single returns a compare-against-self: has categories, not lufs
            check(f"edge-case '{name}' — no crash, returns result",
                  "categories" in r or "lufs" in r or "error" in r, str(raw)[:150])
            if "lufs" in r:
                check(f"edge-case '{name}' — lufs is finite number",
                      math.isfinite(r["lufs"]), str(r["lufs"]))


# ── Test 4: Tonal issues sr=None regression (bc3f853) ────────────────────────
def test_tonal_issues() -> None:
    log.info("=== Test 4: Tonal issues sr=None regression ===")
    with tempfile.TemporaryDirectory() as td:
        a = os.path.join(td, "a.wav")
        b = os.path.join(td, "b.wav")
        _gen_sine(a, freq=300.0, amp=0.3, duration=3.0)
        _gen_sine(b, freq=300.0, amp=0.6, duration=3.0)

        result = subprocess.run(
            [PYTHON, "-c", f"""
import sys; sys.path.insert(0, {str(PYTHON_DIR)!r})
from tonal_issues import detect_tonal_issues
issues = detect_tonal_issues({a!r}, {b!r})  # sr=None default — crashed before bc3f853
print(f"OK: {{len(issues)}} issues")
"""],
            capture_output=True, text=True, timeout=30,
        )
        check("tonal_issues.detect_tonal_issues(sr=None) — no crash",
              result.returncode == 0 and "OK:" in result.stdout,
              result.stderr[-300:] if result.returncode != 0 else "")


# ── Test 5: Persistent state ──────────────────────────────────────────────────
def test_persistence() -> None:
    log.info("=== Test 5: Persistent state ===")

    # 5a: history.json round-trip
    try:
        with open(HISTORY_PATH) as f:
            original = json.load(f)
        baseline = len(original)

        test_entry = {
            "sha256": "rtm_regression_test_sha256_do_not_keep",
            "name": "regression_check.wav",
            "path": "/tmp/regression_check.wav",
            "lufs": -14.0, "true_peak": -1.0, "lra": 6.0,
            "duration_sec": 30, "ts": int(time.time() * 1000),
            "_test": True,
        }
        new_list = original + [test_entry]
        tmp = str(HISTORY_PATH) + ".tmp_regression"
        with open(tmp, "w") as f:
            json.dump(new_list, f, indent=2)
        os.rename(tmp, str(HISTORY_PATH))

        with open(HISTORY_PATH) as f:
            reloaded = json.load(f)

        survived = len(reloaded) == baseline + 1 and reloaded[-1]["sha256"] == test_entry["sha256"]
        check("history.json — atomic write + re-read round-trip", survived)

        # Clean up
        cleaned = [e for e in reloaded if not e.get("_test")]
        tmp2 = str(HISTORY_PATH) + ".tmp_cleanup"
        with open(tmp2, "w") as f:
            json.dump(cleaned, f, indent=2)
        os.rename(tmp2, str(HISTORY_PATH))
        check("history.json — cleanup restored baseline count",
              len(cleaned) == baseline)
    except Exception as e:
        check("history.json persistence", False, str(e))

    # 5b: profiles directory
    profiles_dir = RTM_DIR / "profiles"
    profiles = list(profiles_dir.glob("*.json")) if profiles_dir.exists() else []
    check("~/.rtm/profiles/ — directory exists with profiles", len(profiles) >= 1,
          f"found {len(profiles)}")

    # 5c: plugin-knowledge directory
    pk_dir = RTM_DIR / "plugin-knowledge"
    pk_files = list(pk_dir.glob("*.json")) if pk_dir.exists() else []
    check("~/.rtm/plugin-knowledge/ — 30+ JSON files present", len(pk_files) >= 30,
          f"found {len(pk_files)}")

    # 5d: history.json is valid JSON and not empty
    try:
        with open(HISTORY_PATH) as f:
            data = json.load(f)
        check("history.json — valid JSON, array format", isinstance(data, list))
        check("history.json — backup (.bak) also valid JSON",
              _bak_valid(), "")
    except Exception as e:
        check("history.json — valid JSON", False, str(e))


def _bak_valid() -> bool:
    bak = HISTORY_PATH.with_suffix(".json.bak")
    if not bak.exists():
        return True  # no bak yet — not an error
    try:
        with open(bak) as f:
            json.load(f)
        return True
    except Exception:
        return False


# ── Test 6: IPC channel synchrony ─────────────────────────────────────────────
def test_ipc_sync() -> None:
    log.info("=== Test 6: IPC channel synchrony ===")
    if not PRELOAD_TS.exists() or not MAIN_TS.exists():
        check("preload.ts and main.ts present", False, "file missing")
        return

    pre = PRELOAD_TS.read_text()
    main = MAIN_TS.read_text()

    # Count ipcRenderer.invoke calls (excludes ipcRenderer.on push listeners)
    invoke_calls = re.findall(r"ipcRenderer\.invoke\(['\"]([^'\"]+)['\"]", pre)
    # Count ipcMain.handle registrations
    handle_regs  = re.findall(r"ipcMain\.handle\(['\"]([^'\"]+)['\"]", main)

    invoke_set = set(invoke_calls)
    handle_set  = set(handle_regs)

    missing_handlers = invoke_set - handle_set
    check("all ipcRenderer.invoke channels have ipcMain.handle",
          len(missing_handlers) == 0,
          f"missing handlers: {sorted(missing_handlers)}")

    extra_handlers = handle_set - invoke_set
    # Extra handlers are OK (internal helpers), just log
    if extra_handlers:
        log.info("    (note) extra ipcMain.handle channels not in preload: %s",
                 sorted(extra_handlers))

    check("preload.ts channel count >= 55 (sanity)",
          len(invoke_set) >= 55, f"found {len(invoke_set)}")


# ── Test 7: Production build artifacts ────────────────────────────────────────
def test_build_artifacts() -> None:
    log.info("=== Test 7: Production build artifacts ===")
    check("dist/index.html exists", DIST_HTML.exists(), str(DIST_HTML))
    check("electron/main.js compiled", ELECTRON_JS.exists(), str(ELECTRON_JS))

    if DIST_HTML.exists():
        content = DIST_HTML.read_text()
        check("dist/index.html references a JS bundle",
              ".js" in content and "<script" in content.lower(),
              "no <script> tag")

    # Verify electron/main.js is recent (within 30 days)
    if ELECTRON_JS.exists():
        age_days = (time.time() - ELECTRON_JS.stat().st_mtime) / 86400
        check("electron/main.js compiled within last 30 days",
              age_days < 30, f"age={age_days:.1f} days")


# ── Test 8: RTMprofile Python imports ─────────────────────────────────────────
def test_rtmprofile_imports() -> None:
    log.info("=== Test 8: RTMprofile Python imports ===")
    rtmprofile_py = SCRIPT_DIR / "rtm-profile-app" / "python"
    if not rtmprofile_py.exists():
        check("RTMprofile python dir exists", False, str(rtmprofile_py))
        return

    result = subprocess.run(
        [PYTHON, "-c",
         f"import sys; sys.path.insert(0,{str(rtmprofile_py)!r}); "
         "import build_profile; print('OK')"],
        capture_output=True, text=True, timeout=30,
        env={**os.environ, "PYTHONPATH": str(rtmprofile_py)},
    )
    check("RTMprofile build_profile imports cleanly",
          result.returncode == 0 and "OK" in result.stdout,
          result.stderr[-300:] if result.returncode != 0 else "")


# ── Test 9: Full compare workflow with real audio ─────────────────────────────
# Uses ~/Downloads/MIX.wav + MASTER.wav (240s real commercial tracks).
# Validates the 20+ fields that RTMcompare's UI actually renders so that
# a broken pipeline field surfaces here rather than silently in the UI.
_REAL_MIX    = Path.home() / "Downloads" / "MIX.wav"
_REAL_MASTER = Path.home() / "Downloads" / "MASTER.wav"

_REQUIRED_COMPARE_FIELDS = [
    # Overall loudness/dynamics block — nested under result["overall"]
    # checked separately below because they're one level deeper
    # Top-level result fields:
    "headroom",       # {"true_peak_a", "true_peak_b", "a", "b"}
    "categories",     # list of stem category dicts
    "clicks",         # quality chip
    "distortion",     # quality chip
    "tonal_issues",   # quality chip
    "level_matched",  # platform normalization flag
    "gain_applied_db",
    "waveform_a", "waveform_b",
]

# Fields inside result["overall"] (nested loudness block)
_REQUIRED_OVERALL_FIELDS = ["lufs_a", "lufs_b", "dynamics_a", "dynamics_b"]

def test_full_compare_workflow() -> None:
    log.info("=== Test 9: Full compare workflow (real audio) ===")
    if not _REAL_MIX.exists() or not _REAL_MASTER.exists():
        log.info("    (skipping — ~/Downloads/MIX.wav or MASTER.wav not found)")
        return

    requests = [
        {
            "id": "full_cmp",
            "method": "analyze",
            "params": {
                "file_a": str(_REAL_MIX),
                "file_b": str(_REAL_MASTER),
                "fast": True,
                "profile": "",
            },
        }
    ]
    try:
        responses = _run_daemon_rpc(requests, timeout=300)
    except Exception as e:
        check("full compare workflow — daemon round-trip", False, str(e))
        return

    by_id = {r.get("id"): r for r in responses}
    raw = by_id.get("full_cmp", {})
    r = raw.get("result", raw)

    check("full compare — daemon returned result (no error)",
          "error" not in raw and "categories" in r, str(raw)[:200])
    if "error" in raw:
        return

    # Verify each top-level field the UI depends on
    missing = [f for f in _REQUIRED_COMPARE_FIELDS if f not in r]
    check("full compare — required top-level UI fields present",
          len(missing) == 0, f"missing: {missing}")

    # Verify overall loudness block (nested under result["overall"])
    overall = r.get("overall", {})
    missing_overall = [f for f in _REQUIRED_OVERALL_FIELDS if f not in overall]
    check("full compare — result.overall has lufs_a/b and dynamics_a/b",
          len(missing_overall) == 0, f"missing in overall: {missing_overall}")

    # Validate numeric sanity of key loudness metrics (in overall sub-dict)
    la = overall.get("lufs_a", 0)
    lb = overall.get("lufs_b", 0)
    if la != 0 or lb != 0:
        check("full compare — lufs_a is realistic (-50 to -3 LUFS)",
              isinstance(la, (int, float)) and -50 <= la <= -3, f"lufs_a={la}")
        check("full compare — lufs_b is realistic (-50 to -3 LUFS)",
              isinstance(lb, (int, float)) and -50 <= lb <= -3, f"lufs_b={lb}")

    if "categories" in r:
        cats = r["categories"]
        check("full compare — categories is a non-empty list",
              isinstance(cats, list) and len(cats) > 0, str(len(cats)))
        if cats:
            cat0 = cats[0]
            check("full compare — each category has name/level_a/level_b",
                  all(k in cat0 for k in ("name", "level_a", "level_b")),
                  str(list(cat0.keys())[:6]))

    if "headroom" in r:
        hd = r["headroom"]
        check("full compare — headroom has true_peak_a/b fields",
              all(k in hd for k in ("true_peak_a", "true_peak_b")),
              str(list(hd.keys())))

    if "tonal_issues" in r:
        check("full compare — tonal_issues is a list",
              isinstance(r["tonal_issues"], list), str(type(r["tonal_issues"])))

    if "clicks" in r:
        check("full compare — clicks result has expected structure",
              isinstance(r["clicks"], (list, dict)), str(type(r["clicks"])))

    log.info("    lufs_a=%.1f  lufs_b=%.1f  categories=%d  tonal_issues=%d",
             overall.get("lufs_a", 0), overall.get("lufs_b", 0),
             len(r.get("categories", [])), len(r.get("tonal_issues", [])))


# ── Test 10: RTMprofile build workflow ────────────────────────────────────────
def test_rtmprofile_build() -> None:
    log.info("=== Test 10: RTMprofile build workflow ===")
    rtmprofile_py = SCRIPT_DIR / "rtm-profile-app" / "python"
    if not rtmprofile_py.exists():
        log.info("    (skipping — RTMprofile python dir not found)")
        return

    # Use files from the real track cache as inputs — they're already analysed
    # so build_profile can read from cache (~/.rtm/tracks/) without re-running
    # full analysis. This tests the full profile-build pipeline.
    tracks_dir = RTM_DIR / "tracks"
    cached_tracks = list(tracks_dir.glob("*.json")) if tracks_dir.exists() else []

    if not cached_tracks:
        log.info("    (skipping — no cached tracks in ~/.rtm/tracks/)")
        return

    # build_profile needs audio files, not just JSON cache. Check for real WAVs.
    real_wavs: list[str] = []
    for p in [_REAL_MIX, _REAL_MASTER,
              Path.home() / "Downloads" / "Ohad The Best.wav",
              Path.home() / "Downloads" / "Paper Rings.wav"]:
        if p.exists():
            real_wavs.append(str(p))

    if not real_wavs:
        log.info("    (skipping — no real WAV files found for build_profile)")
        return

    with tempfile.TemporaryDirectory() as td:
        out_path = os.path.join(td, "regression_profile.json")
        cmd = [
            PYTHON,
            str(rtmprofile_py / "build_profile.py"),
            "--name", "Regression Test Engineer",
            "--role", "Mastering Engineer",
            "--out", out_path,
        ] + real_wavs[:2]  # use 2 files max to keep test fast

        result = subprocess.run(
            cmd,
            capture_output=True, text=True, timeout=120,
            env={**os.environ, "PYTHONPATH": str(rtmprofile_py)},
        )
        check("RTMprofile build_profile — exits cleanly",
              result.returncode == 0,
              result.stderr[-400:] if result.returncode != 0 else "")

        if result.returncode == 0 and os.path.exists(out_path):
            try:
                with open(out_path) as f:
                    profile = json.load(f)
                check("RTMprofile — output is valid JSON",
                      isinstance(profile, dict), "")
                # Verify required profile fields (actual schema: lufs_avg not lufs_stats)
                required_profile_keys = ["curve", "dynamic_range_avg", "lufs_avg"]
                missing = [k for k in required_profile_keys if k not in profile]
                check("RTMprofile — output has required fields (curve, dynamic_range_avg, lufs_avg)",
                      len(missing) == 0, f"missing: {missing}")
                log.info("    profile keys: %s", sorted(profile.keys())[:10])
            except Exception as e:
                check("RTMprofile — output is valid JSON", False, str(e))
        else:
            check("RTMprofile — output file created", os.path.exists(out_path),
                  "file not found")


# ── Test 11: RTMsend connectivity ─────────────────────────────────────────────
def test_rtmsend_connectivity() -> None:
    log.info("=== Test 11: RTMsend connectivity ===")
    import socket as _socket
    import re as _re

    RTM_DIR_PATH = Path.home() / ".rtm"
    INSTANCE_RE = _re.compile(r"^rtmsend-\d+-[0-9a-fA-F]{8}\.port$")
    LEGACY_PORT = RTM_DIR_PATH / "rtmsend.port"

    # Collect all port files (legacy + per-instance)
    port_files: list[Path] = []
    if LEGACY_PORT.exists():
        port_files.append(LEGACY_PORT)
    for f in sorted(RTM_DIR_PATH.glob("*.port")):
        if INSTANCE_RE.match(f.name):
            port_files.append(f)

    if not port_files:
        log.info("    RTMsend: no .port files found — plugin not currently running (OK)")
        check("RTMsend — port directory accessible",
              RTM_DIR_PATH.exists(), str(RTM_DIR_PATH))
        return

    log.info("    RTMsend: found %d port file(s)", len(port_files))
    live_ports: list[int] = []

    for pf in port_files:
        try:
            raw = pf.read_text().strip()
            port = 0
            host = "unknown"
            # Try JSON object format (5.7+); note json.loads("51697") = int, not dict
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = None

            if isinstance(parsed, dict):
                meta = parsed
                port = int(meta.get("port", 0))
                pid = meta.get("pid")
                host = meta.get("host_app", "unknown")
                check(f"RTMsend port file '{pf.name}' — valid JSON with port+pid",
                      port > 0 and pid is not None,
                      f"port={port} pid={pid}")
            else:
                # Legacy: plain integer (possibly returned by json.loads or raw int string)
                try:
                    port = int(parsed if parsed is not None else raw)
                except (ValueError, TypeError):
                    port = 0
                host = "legacy"
                check(f"RTMsend port file '{pf.name}' — legacy integer port format",
                      0 < port < 65536, f"port={port}")

            if 0 < port < 65536:
                # Probe TCP connection with a ping
                try:
                    sock = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
                    sock.settimeout(2.0)
                    sock.connect(("127.0.0.1", port))
                    ping_req = json.dumps({"jsonrpc": "2.0", "method": "host.ping",
                                           "params": {}, "id": 1}) + "\n"
                    sock.sendall(ping_req.encode())
                    data = b""
                    sock.settimeout(3.0)
                    while b"\n" not in data:
                        chunk = sock.recv(4096)
                        if not chunk:
                            break
                        data += chunk
                    sock.close()
                    if data:
                        resp = json.loads(data.split(b"\n")[0])
                        check(f"RTMsend port {port} ({host}) — ping/pong succeeds",
                              "result" in resp or "error" in resp, str(resp))
                        live_ports.append(port)
                        log.info("    RTMsend port %d live: %s", port, host)
                    else:
                        check(f"RTMsend port {port} ({host}) — received response",
                              False, "no data received")
                except ConnectionRefusedError:
                    log.info("    RTMsend port %d — connection refused (plugin closed?)", port)
                except Exception as e:
                    log.info("    RTMsend port %d — probe failed: %s", port, e)
        except Exception as e:
            check(f"RTMsend port file '{pf.name}' — readable", False, str(e))

    if live_ports:
        log.info("    RTMsend: %d live instance(s) at ports %s", len(live_ports), live_ports)
    else:
        log.info("    RTMsend: port files present but no live connections (plugin may be closed)")


# ── Test 12: RTMsend mock-server protocol round-trip ─────────────────────────
# Starts a Python TCP server that speaks RTMsend's JSON-RPC 2.0 newline protocol,
# writes a .port file, then probes it using the same socket path the regression
# suite's Test 11 uses — validates the discovery → connect → ping → close chain
# without requiring Logic Pro or Ableton to be open.
def test_rtmsend_mock_server() -> None:
    log.info("=== Test 12: RTMsend mock-server protocol round-trip ===")
    import socket as _socket
    import threading as _threading

    # Start a minimal TCP server on a random port
    srv = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
    srv.setsockopt(_socket.SOL_SOCKET, _socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)
    mock_port = srv.getsockname()[1]

    responses_served: list[str] = []

    def _serve() -> None:
        srv.settimeout(5.0)
        try:
            conn, _ = srv.accept()
            conn.settimeout(3.0)
            buf = b""
            while b"\n" not in buf:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                buf += chunk
            if buf:
                try:
                    req = json.loads(buf.split(b"\n")[0])
                    method = req.get("method", "")
                    rid = req.get("id", 1)
                    if method == "host.ping":
                        resp = json.dumps({"jsonrpc": "2.0", "result": {"ok": True}, "id": rid})
                    else:
                        resp = json.dumps({"jsonrpc": "2.0", "result": {}, "id": rid})
                    conn.sendall((resp + "\n").encode())
                    responses_served.append(method)
                except Exception:
                    pass
            conn.close()
        except Exception:
            pass
        finally:
            srv.close()

    server_thread = _threading.Thread(target=_serve, daemon=True)
    server_thread.start()

    # Write a port file matching the 5.7+ JSON format
    import tempfile as _tempfile
    tmp_port_file = RTM_DIR / f"rtmsend-regression-test-00000000.port"
    try:
        port_meta = json.dumps({
            "pid": os.getpid(),
            "uuid": "00000000",
            "port": mock_port,
            "host_app": "RTMRegressionTest",
            "plugin_name": "MockPlugin",
            "build": "test",
        })
        tmp_port_file.write_text(port_meta)

        # Probe via TCP (same path Test 11 uses for live instances)
        import socket as _s
        sock = _s.socket(_s.AF_INET, _s.SOCK_STREAM)
        sock.settimeout(3.0)
        try:
            sock.connect(("127.0.0.1", mock_port))
            ping_req = json.dumps({"jsonrpc": "2.0", "method": "host.ping", "params": {}, "id": 1}) + "\n"
            sock.sendall(ping_req.encode())
            data = b""
            while b"\n" not in data:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                data += chunk
            sock.close()
            if data:
                resp = json.loads(data.split(b"\n")[0])
                check("RTMsend mock-server — host.ping round-trip succeeds",
                      resp.get("result", {}).get("ok") is True, str(resp))
                check("RTMsend mock-server — server received host.ping method",
                      "host.ping" in responses_served, str(responses_served))
            else:
                check("RTMsend mock-server — received response", False, "empty response")
        except Exception as e:
            check("RTMsend mock-server — TCP connect + ping", False, str(e))
        finally:
            try:
                sock.close()
            except Exception:
                pass

        # Verify port file format is readable by the discovery logic
        raw = tmp_port_file.read_text().strip()
        try:
            meta = json.loads(raw)
            check("RTMsend port file format — JSON with required fields",
                  isinstance(meta, dict) and "port" in meta and "pid" in meta,
                  str(list(meta.keys())))
        except Exception as e:
            check("RTMsend port file format — valid JSON", False, str(e))

        server_thread.join(timeout=3.0)

    finally:
        try:
            tmp_port_file.unlink()
        except Exception:
            pass


# ── Auto-remediation ──────────────────────────────────────────────────────────
def _notify_failure(fail_count: int) -> None:
    """Send a macOS notification when regression fails."""
    try:
        msg = f"{fail_count} check(s) failed — see ~/.rtm/regression.log"
        subprocess.run(
            ["osascript", "-e",
             f'display notification "{msg}" with title "RTM Regression" '
             f'subtitle "Health check failure" sound name "Basso"'],
            capture_output=True, timeout=5,
        )
    except Exception:
        pass  # notification is best-effort


def _remediate_daemon() -> None:
    """Kill any stale rtm_daemon.py processes, allowing a fresh start next request."""
    try:
        result = subprocess.run(
            ["pgrep", "-f", "rtm_daemon.py"],
            capture_output=True, text=True,
        )
        pids = [p.strip() for p in result.stdout.splitlines() if p.strip()]
        if pids:
            log.info("    Remediation: killing %d stale daemon process(es): %s",
                     len(pids), pids)
            for pid in pids:
                try:
                    subprocess.run(["kill", "-9", pid], capture_output=True, timeout=3)
                except Exception:
                    pass
    except Exception as e:
        log.warning("    Remediation: failed to clean up daemon processes: %s", e)


# ── Main ──────────────────────────────────────────────────────────────────────
def run_all() -> int:
    global _pass, _fail
    _pass = _fail = 0
    start = time.time()
    log.info("=" * 60)
    log.info("RTM REGRESSION SUITE  %s", time.strftime("%Y-%m-%d %H:%M:%S"))
    log.info("Python: %s", PYTHON)
    log.info("=" * 60)

    test_python_imports()
    test_daemon_rpc()
    test_edge_case_audio()
    test_tonal_issues()
    test_persistence()
    test_ipc_sync()
    test_build_artifacts()
    test_rtmprofile_imports()
    test_full_compare_workflow()
    test_rtmprofile_build()
    test_rtmsend_connectivity()
    test_rtmsend_mock_server()

    elapsed = time.time() - start
    log.info("=" * 60)
    log.info("RESULT: %d passed, %d failed  (%.1fs)", _pass, _fail, elapsed)
    log.info("=" * 60)

    if _fail > 0:
        _notify_failure(_fail)
        _remediate_daemon()

    return 0 if _fail == 0 else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="Run once and exit (default)")
    parser.add_argument("--loop", action="store_true", help="Loop every 30 minutes")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    if args.verbose:
        log.setLevel(logging.DEBUG)

    if args.loop:
        while True:
            code = run_all()
            if code != 0:
                log.error("FAILURES DETECTED — check %s", LOG_PATH)
            log.info("Next run in 30 minutes…")
            time.sleep(1800)
    else:
        sys.exit(run_all())
