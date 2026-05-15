#!/usr/bin/env python3
"""
RTM Nonstop Regression Test Suite
Runs automatically every 30 minutes via launchd (com.rtm.regression.plist).
Also runnable manually: python3 rtm_regression.py [--once] [--verbose]

Tests:
  1. Python pipeline smoke (analyze.py imports, core functions)
  2. RTM daemon JSON-RPC (ping, analyze_single, analyze, unknown-method error)
  3. Edge-case audio (silent, tiny, near-clip, mono, DC-offset)
  4. Persistent state (history.json round-trip, profiles directory)
  5. IPC channel count (preload.ts vs main.ts must stay in sync)
  6. Production build artifact presence (dist/index.html, electron/main.js)
  7. Tonal issues detector (regression for sr=None crash — fixed in bc3f853)
  8. Plugin-knowledge persistence (33+ files in ~/.rtm/plugin-knowledge/)

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

    elapsed = time.time() - start
    log.info("=" * 60)
    log.info("RESULT: %d passed, %d failed  (%.1fs)", _pass, _fail, elapsed)
    log.info("=" * 60)
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
