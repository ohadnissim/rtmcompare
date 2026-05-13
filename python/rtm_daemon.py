#!/usr/bin/env python3
"""
RTM Daemon — persistent JSON-RPC worker for RTMcompare v7.5.5+

Eliminates the ~13 s cold-start penalty (Python import ~5 s + ONNX model
load ~8 s) by keeping the interpreter and BS-RoFormer model resident in
memory across multiple analysis requests.

USAGE
-----
Daemon mode (started by Electron):
    python rtm_daemon.py --daemon

Legacy subprocess mode (unchanged from analyze.py contract):
    python rtm_daemon.py <file_a> <file_b> [--fast] [--profile=<id>]

JSON-RPC PROTOCOL (newline-delimited, stdin → stdout)
------------------------------------------------------
Request:
    {"id": "uuid", "method": "analyze",        "params": {"file_a": "...", "file_b": "...", "fast": true, "profile": ""}}
    {"id": "uuid", "method": "analyze_single", "params": {"file": "..."}}
    {"id": "uuid", "method": "ping"}
    {"id": "uuid", "method": "shutdown"}

Response (always one line on stdout):
    {"id": "uuid", "result": {...}}
    {"id": "uuid", "error": "human-readable message"}

Progress (stderr, mirrors the existing subprocess pattern):
    {"type": "progress", "id": "uuid", "message": "..."}

THREAD SAFETY
-------------
Requests are dispatched to a ThreadPoolExecutor (max 4 workers).
ONNX Runtime inference is serialized via a per-session lock because
OrtSession is NOT thread-safe for concurrent Run() calls on the same
session object.  The lock lives on the separator module's global session
so concurrent analyses queue rather than crash.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor, Future
from typing import Any

# ── path bootstrap (same as analyze.py) ───────────────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

_log = logging.getLogger("rtm.daemon")
if not _log.handlers:
    _h = logging.StreamHandler(sys.stderr)
    _h.setFormatter(logging.Formatter("[rtm-daemon] %(levelname)s %(message)s"))
    _log.addHandler(_h)
    _log.setLevel(logging.INFO)

# ── stdout/stdin I/O lock — serialises the write side only ────────────────────
_stdout_lock = threading.Lock()
_stdin_lock = threading.Lock()

# ── per-analysis serialisation lock ──────────────────────────────────────────
# analyze.main() mutates sys.stdout, sys.argv, and the analyze module's
# progress callback — all global state.  Under ThreadPoolExecutor concurrent
# calls race on these globals producing empty/crossed JSON responses.
# This lock serialises the entire redirect+call+restore block so only one
# analysis runs at a time (ONNX inference is already serialised independently).
_analyze_lock = threading.Lock()


def _write_line(obj: dict) -> None:
    """Write a JSON object as a single newline-terminated line to stdout."""
    line = json.dumps(obj, separators=(",", ":"))
    with _stdout_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def _progress(request_id: str, message: str) -> None:
    """Emit a progress message to stderr (mirrors analyze.py pattern)."""
    line = json.dumps({"type": "progress", "id": request_id, "message": message},
                      separators=(",", ":"))
    sys.stderr.write(line + "\n")
    sys.stderr.flush()


# ── lazy heavy imports — loaded once at daemon startup ────────────────────────

_models_loaded = False
_models_lock = threading.Lock()

# These are populated during _load_models() and reused by all requests.
# The separator module holds the ONNX session as a module-level singleton;
# we add a lock around its inference entry-point below.
_separator_module: Any = None
_analyze_main: Any = None   # analyze.main callable (for --daemon passthrough)

# Per-session inference lock.  The separator's separate() function acquires
# this before calling session.run() so concurrent requests serialise model
# inference rather than racing on a shared OrtSession.
_inference_lock = threading.Lock()


def _load_models() -> None:
    """Load all ONNX models once.  Called in __main__ before the request loop."""
    global _models_loaded, _separator_module

    with _models_lock:
        if _models_loaded:
            return

        _log.info("Loading Python modules…")
        t0 = time.monotonic()

        # Import all heavy modules — this is where the ~5 s Python startup
        # cost is paid (numpy, librosa, soundfile, scipy, onnxruntime).
        import numpy  # noqa: F401
        import librosa  # noqa: F401
        import soundfile  # noqa: F401

        _log.info("Core modules imported (%.1f s)", time.monotonic() - t0)

        # Import separator — triggers ONNX session creation (~8 s for
        # BS-RoFormer ~800 MB).  The session is held as a module-level
        # singleton inside separator.py.
        t1 = time.monotonic()
        try:
            import separator as _sep_mod
            _separator_module = _sep_mod
            # Warm up: call a dummy-path separate() to trigger any
            # lazy-init inside the module.  Errors here are non-fatal.
            _log.info("separator module imported (%.1f s)", time.monotonic() - t1)
        except Exception as exc:
            _log.warning("separator import failed (%s) — deep-scan disabled", exc)

        # Import the core pipeline modules so they're warm in sys.modules.
        try:
            import comparator  # noqa: F401
            import click_detector  # noqa: F401
            import distortion_detector  # noqa: F401
            import visualizations  # noqa: F401
            import tonal_issues  # noqa: F401
            import reference_check  # noqa: F401
            import adm_parser  # noqa: F401
            import atmos_comparator  # noqa: F401
            import engineer_profile  # noqa: F401
            import metadata_reader  # noqa: F401
            import hum_detector  # noqa: F401
            import transient_density  # noqa: F401
            import waveform_diff  # noqa: F401
            import dialog_gate  # noqa: F401
            import limiter_artefacts  # noqa: F401
            import specs  # noqa: F401
        except Exception as exc:
            _log.warning("Some pipeline modules failed to import: %s", exc)

        _models_loaded = True
        _log.info("All models loaded in %.1f s total", time.monotonic() - t0)


# ── patch separator to serialise inference ────────────────────────────────────

def _patch_separator_for_thread_safety() -> None:
    """
    Wrap separator.separate() so concurrent calls queue on _inference_lock.
    This makes ONNX RT safe under ThreadPoolExecutor without modifying
    separator.py itself.
    """
    if _separator_module is None:
        return

    original_separate = getattr(_separator_module, "separate", None)
    if original_separate is None:
        return

    def _locked_separate(*args, **kwargs):
        with _inference_lock:
            return original_separate(*args, **kwargs)

    _separator_module.separate = _locked_separate
    _log.info("separator.separate() patched with inference lock")


# ── request handlers ──────────────────────────────────────────────────────────

def _handle_ping(request_id: str, _params: dict) -> dict:
    return {"id": request_id, "result": {"pong": True, "models_loaded": _models_loaded}}


def _handle_analyze(request_id: str, params: dict) -> dict:
    """
    Full two-file comparison — equivalent to analyze.main() but called
    in-process without subprocess overhead.
    """
    file_a = params.get("file_a", "")
    file_b = params.get("file_b", "")
    fast = bool(params.get("fast", True))
    profile_id = params.get("profile", "")

    if not file_a or not file_b:
        return {"id": request_id, "error": "analyze requires file_a and file_b params"}

    def progress_cb(msg: str) -> None:
        _progress(request_id, msg)

    # Re-use the full analyze pipeline by temporarily redirecting stdout
    # and argv so analyze.main() outputs its JSON to a buffer rather than
    # the real stdout (which we own for JSON-RPC).
    import io
    import analyze as _analyze_mod

    # _analyze_lock serialises this entire block so concurrent requests
    # cannot race on sys.stdout / sys.argv / _analyze_mod.progress.
    with _analyze_lock:
        # Reset the per-run optional-failures accumulator (module-level list).
        _analyze_mod._optional_failures.clear()

        # Monkeypatch progress() to route through our per-request progress_cb.
        _orig_progress = _analyze_mod.progress
        _analyze_mod.progress = progress_cb

        # Redirect stdout so analyze.main()'s print() goes to our buffer.
        _orig_stdout = sys.stdout
        _buf = io.StringIO()
        sys.stdout = _buf

        # Fake argv so main() picks up our params.
        _orig_argv = sys.argv[:]
        sys.argv = ["analyze.py", file_a, file_b]
        if fast:
            sys.argv.append("--fast")
        sys.argv.append(f"--profile={profile_id}")

        try:
            _analyze_mod.main()
            output = _buf.getvalue().strip()
            result_obj = json.loads(output)
            if "error" in result_obj:
                return {"id": request_id, "error": result_obj["error"]}
            return {"id": request_id, "result": result_obj}
        except SystemExit as exc:
            # analyze.main() calls sys.exit(1) on fatal errors; the last print
            # before exit is the JSON error — capture it.
            output = _buf.getvalue().strip()
            try:
                err_obj = json.loads(output)
                return {"id": request_id, "error": err_obj.get("error", f"exit {exc.code}")}
            except Exception:
                return {"id": request_id, "error": f"analysis exited with code {exc.code}"}
        except Exception as exc:
            tb = traceback.format_exc()
            _log.error("analyze handler exception:\n%s", tb)
            return {"id": request_id, "error": str(exc)}
        finally:
            sys.stdout = _orig_stdout
            sys.argv = _orig_argv
            _analyze_mod.progress = _orig_progress


def _handle_analyze_single(request_id: str, params: dict) -> dict:
    """
    Single-file reference analysis — passes file as both A and B.
    """
    file_path = params.get("file", "")
    if not file_path:
        return {"id": request_id, "error": "analyze_single requires a 'file' param"}
    return _handle_analyze(request_id, {
        "file_a": file_path,
        "file_b": file_path,
        "fast": params.get("fast", True),
        "profile": params.get("profile", ""),
    })


_DISPATCH: dict[str, Any] = {
    "ping":           _handle_ping,
    "analyze":        _handle_analyze,
    "analyze_single": _handle_analyze_single,
}

# ── main request loop ─────────────────────────────────────────────────────────

_shutdown_event = threading.Event()


def _dispatch_request(line: str) -> None:
    """Parse one JSON-RPC line and dispatch it; write result to stdout."""
    request_id = "unknown"
    try:
        req = json.loads(line)
        request_id = req.get("id", str(uuid.uuid4()))
        method = req.get("method", "")
        params = req.get("params") or {}
    except json.JSONDecodeError as exc:
        _write_line({"id": request_id, "error": f"JSON parse error: {exc}"})
        return

    if method == "shutdown":
        _write_line({"id": request_id, "result": {"bye": True}})
        _shutdown_event.set()
        return

    handler = _DISPATCH.get(method)
    if handler is None:
        _write_line({"id": request_id, "error": f"unknown method: {method!r}"})
        return

    try:
        response = handler(request_id, params)
    except Exception as exc:
        tb = traceback.format_exc()
        _log.error("Unhandled exception in handler %s:\n%s", method, tb)
        response = {"id": request_id, "error": str(exc)}

    _write_line(response)


def run_daemon() -> None:
    """
    Main daemon loop.

    Reads newline-delimited JSON from stdin, dispatches each request in a
    thread-pool worker, writes JSON responses to stdout.  Concurrent requests
    are allowed (up to MAX_WORKERS), but ONNX inference is serialised by the
    lock installed in _patch_separator_for_thread_safety().
    """
    MAX_WORKERS = 4

    # Signal ready — Electron watches for this line on stderr.
    sys.stderr.write('{"type":"ready","message":"RTM daemon ready"}\n')
    sys.stderr.flush()

    pending: dict[str, Future] = {}

    with ThreadPoolExecutor(max_workers=MAX_WORKERS, thread_name_prefix="rtm-worker") as pool:
        for raw_line in sys.stdin:
            if _shutdown_event.is_set():
                break

            line = raw_line.strip()
            if not line:
                continue

            # Submit to thread pool; don't block the read loop.
            future = pool.submit(_dispatch_request, line)
            # Track futures for graceful shutdown (pool.shutdown(wait=True) handles it).
            req_id = line[:64]  # rough key for logging only
            pending[req_id] = future

            # Prune completed futures to keep dict small.
            done_keys = [k for k, f in pending.items() if f.done()]
            for k in done_keys:
                del pending[k]

        # Wait for in-flight requests before exiting.
        _log.info("Shutdown requested — waiting for %d in-flight requests…", len(pending))

    _log.info("RTM daemon exited cleanly")


# ── entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    """
    Dual-mode entry point:

      --daemon          → load models, run JSON-RPC loop
      <file_a> <file_b> → legacy analyze.py subprocess contract
    """
    args = sys.argv[1:]

    if "--daemon" in args:
        # ── Daemon mode ───────────────────────────────────────────────────────
        _log.info("Starting RTM daemon (pid %d)…", os.getpid())
        _load_models()
        _patch_separator_for_thread_safety()
        run_daemon()
    else:
        # ── Legacy subprocess mode — delegate to analyze.main() ──────────────
        # This preserves 100% backward compatibility: the daemon binary can
        # be called exactly like analyze.py from any existing code path.
        import analyze as _analyze_mod
        _analyze_mod.main()


if __name__ == "__main__":
    main()
