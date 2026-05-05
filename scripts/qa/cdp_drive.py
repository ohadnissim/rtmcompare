#!/usr/bin/env python3
"""
RTM Suite — Chrome DevTools Protocol driver for bug-hunting.

Connects to an Electron renderer that was launched with
  --remote-debugging-port=9222
and drives it: run JS in the page, click elements by CSS selector,
capture screenshots, drain the console log.

Why this exists: Claude (the assistant) can't poke at an Electron
window directly.  But the renderer is a Chromium tab with CDP on,
and CDP is plain WebSocket JSON.  This script turns CDP into a small
CLI that bash can call.

Usage:

  scripts/qa/cdp_drive.py connect
      Dumps the list of targets + the WS URL for the main renderer.

  scripts/qa/cdp_drive.py eval '<js>'
      Run JS in the renderer; print JSON.  Example:
        eval 'document.title'
        eval 'window.location.hash'

  scripts/qa/cdp_drive.py click '<selector>'
      document.querySelector(sel).click()
      Returns true/false on whether an element was found.

  scripts/qa/cdp_drive.py text '<selector>'
      Return innerText of an element.

  scripts/qa/cdp_drive.py screenshot <out.png> [--full]
      Capture Page.captureScreenshot.  --full captures the entire
      scrollable area (Page.captureScreenshot with clip).

  scripts/qa/cdp_drive.py console [--clear]
      Drain the console message buffer.  Any error / warn / log
      emitted since the last `console` call prints here.

  scripts/qa/cdp_drive.py keys '<text>'
      Dispatch Input.dispatchKeyEvent sequences for raw keystrokes.
      Supports 'Escape', 'Tab', 'Enter', 'ArrowLeft', 'cmd+k', etc.

Connection state is cached in /tmp/rtm-cdp.state (WS URL + last
command id) so every invocation opens a fresh short-lived WS.
"""

from __future__ import annotations
import argparse
import base64
import json
import os
import sys
import time
import urllib.request
from typing import Any

try:
    import websocket  # type: ignore
except ImportError:
    print("websocket-client not installed.  Run:", file=sys.stderr)
    print("  ./python-bundle/python/bin/python3 -m pip install websocket-client",
          file=sys.stderr)
    sys.exit(2)


PORT = int(os.environ.get("RTM_CDP_PORT", "9222"))
STATE = "/tmp/rtm-cdp.state"
CONSOLE_LOG = "/tmp/rtm-cdp-console.log"


def _targets(port: int = PORT) -> list[dict]:
    """Hit http://localhost:<port>/json to list available targets."""
    with urllib.request.urlopen(f"http://localhost:{port}/json", timeout=3) as r:
        return json.loads(r.read().decode("utf-8"))


def _pick_main_target(targets: list[dict]) -> dict:
    """Pick the RTM renderer target.  Electron opens one or more pages;
    we want the main window's webview, which is type=page and has a
    non-devtools URL."""
    candidates = [t for t in targets
                  if t.get("type") == "page"
                  and "devtools://" not in t.get("url", "")]
    if not candidates:
        raise RuntimeError(f"No page targets found.  Targets: {targets}")
    # Prefer file:// or localhost — that's the renderer.  Fall back to first.
    for t in candidates:
        u = t.get("url", "")
        if u.startswith("file://") or "localhost" in u or u.startswith("app://"):
            return t
    return candidates[0]


class CDP:
    """One-shot CDP client — opens a WS, runs commands, closes."""
    def __init__(self, ws_url: str):
        self.ws_url = ws_url
        self.ws = websocket.create_connection(ws_url, timeout=8)
        self._id = 0

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()

    def _next_id(self) -> int:
        self._id += 1
        return self._id

    def send(self, method: str, params: dict | None = None) -> dict:
        """Send a command; block until its matching reply lands.
        CDP sends events mixed with replies; we filter by id."""
        cid = self._next_id()
        msg = {"id": cid, "method": method}
        if params is not None:
            msg["params"] = params
        self.ws.send(json.dumps(msg))
        # Drain until we see our id, buffering any unsolicited events.
        events: list[dict] = []
        deadline = time.time() + 8
        while time.time() < deadline:
            raw = self.ws.recv()
            try:
                data = json.loads(raw)
            except Exception:
                continue
            if data.get("id") == cid:
                if "error" in data:
                    raise RuntimeError(f"{method} failed: {data['error']}")
                # Save events we saw along the way for callers that want them.
                if events:
                    _append_events(events)
                return data.get("result", {})
            elif "method" in data:
                events.append(data)
        raise TimeoutError(f"No reply to {method} within 8 s")

    def drain_events(self, seconds: float = 0.4) -> list[dict]:
        """Collect all unsolicited events for a short window.  Used to
        pick up console messages after an action."""
        self.ws.settimeout(seconds)
        events: list[dict] = []
        try:
            while True:
                raw = self.ws.recv()
                try:
                    data = json.loads(raw)
                    if "method" in data:
                        events.append(data)
                except Exception:
                    continue
        except Exception:
            pass
        finally:
            self.ws.settimeout(8)
        return events


def _append_events(events: list[dict]) -> None:
    """Append console-related events to our local log so multiple
    CLI invocations can share one rolling tail."""
    relevant = [e for e in events
                if e.get("method") in ("Runtime.consoleAPICalled",
                                       "Runtime.exceptionThrown",
                                       "Log.entryAdded")]
    if not relevant:
        return
    with open(CONSOLE_LOG, "a") as f:
        for ev in relevant:
            f.write(json.dumps(ev) + "\n")


# ── CLI commands ─────────────────────────────────────────────────────
def _open_cdp() -> CDP:
    """Open a CDP session against the main window."""
    if os.path.exists(STATE):
        try:
            with open(STATE) as f:
                ws_url = f.read().strip()
            return CDP(ws_url)
        except Exception:
            try:
                os.remove(STATE)
            except Exception:
                pass
    # Fresh discovery
    ts = _targets()
    t = _pick_main_target(ts)
    ws_url = t["webSocketDebuggerUrl"]
    with open(STATE, "w") as f:
        f.write(ws_url)
    c = CDP(ws_url)
    # Enable domains we need for console + screenshots
    c.send("Runtime.enable")
    c.send("Page.enable")
    c.send("Log.enable")
    return c


def cmd_connect(args):
    targets = _targets()
    print(f"Found {len(targets)} target(s) on :{PORT}")
    for i, t in enumerate(targets):
        print(f"  [{i}] type={t.get('type')}  url={t.get('url', '')[:80]}")
    if targets:
        main = _pick_main_target(targets)
        print(f"\nMain renderer: {main.get('url')}")
        print(f"WS URL: {main.get('webSocketDebuggerUrl')}")
        # Cache + open once to verify
        with open(STATE, "w") as f:
            f.write(main["webSocketDebuggerUrl"])
        with _open_cdp() as c:
            print("Connection OK.")


def cmd_eval(args):
    with _open_cdp() as c:
        r = c.send("Runtime.evaluate", {
            "expression": args.expr,
            "returnByValue": True,
            "awaitPromise": True,
        })
        evs = c.drain_events(0.2)
        _append_events(evs)
        if "exceptionDetails" in r:
            print("EXCEPTION:", json.dumps(r["exceptionDetails"], indent=2))
            sys.exit(1)
        val = r.get("result", {}).get("value")
        if isinstance(val, (dict, list)):
            print(json.dumps(val, indent=2, default=str))
        else:
            print(val)


def cmd_click(args):
    expr = f"""(() => {{
      const el = document.querySelector({json.dumps(args.selector)});
      if (!el) return {{ found: false }};
      el.scrollIntoView({{ block: 'center' }});
      el.click();
      return {{ found: true, text: (el.innerText || '').slice(0, 80) }};
    }})()"""
    with _open_cdp() as c:
        r = c.send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        evs = c.drain_events(0.5)
        _append_events(evs)
        print(json.dumps(r.get("result", {}).get("value"), indent=2))


def cmd_text(args):
    expr = f"""(() => {{
      const el = document.querySelector({json.dumps(args.selector)});
      if (!el) return null;
      return {{ text: el.innerText || '', html: el.outerHTML.slice(0, 300) }};
    }})()"""
    with _open_cdp() as c:
        r = c.send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        print(json.dumps(r.get("result", {}).get("value"), indent=2))


def cmd_screenshot(args):
    with _open_cdp() as c:
        params = {"format": "png"}
        if args.full:
            # Measure the content box and capture that.
            r = c.send("Page.getLayoutMetrics")
            cs = r["contentSize"]
            params["clip"] = {
                "x": 0, "y": 0,
                "width": cs["width"], "height": cs["height"],
                "scale": 1,
            }
            params["captureBeyondViewport"] = True
        r = c.send("Page.captureScreenshot", params)
        png = base64.b64decode(r["data"])
        with open(args.out, "wb") as f:
            f.write(png)
        print(f"Wrote {args.out} ({len(png)} bytes)")


def cmd_console(args):
    # Pull any events currently queued so the log is up to date.
    try:
        with _open_cdp() as c:
            evs = c.drain_events(0.3)
            _append_events(evs)
    except Exception as e:
        print(f"(warn: couldn't open CDP: {e})", file=sys.stderr)

    if args.clear:
        if os.path.exists(CONSOLE_LOG):
            os.remove(CONSOLE_LOG)
        print("(cleared)")
        return

    if not os.path.exists(CONSOLE_LOG):
        print("(no console entries yet)")
        return

    with open(CONSOLE_LOG) as f:
        lines = f.readlines()

    # Filter by severity if requested
    def severity(ev_line: str) -> str:
        try:
            ev = json.loads(ev_line)
        except Exception:
            return "unknown"
        method = ev.get("method", "")
        if method == "Runtime.exceptionThrown":
            return "error"
        if method == "Runtime.consoleAPICalled":
            return ev.get("params", {}).get("type", "log")
        if method == "Log.entryAdded":
            return ev.get("params", {}).get("entry", {}).get("level", "info")
        return "unknown"

    want = set(args.levels.split(",")) if args.levels else None
    for line in lines[-args.tail:]:
        sev = severity(line)
        if want and sev not in want:
            continue
        ev = json.loads(line)
        method = ev.get("method", "")
        if method == "Runtime.consoleAPICalled":
            p = ev["params"]
            args_str = " ".join(
                str(a.get("value") or a.get("description") or "")
                for a in p.get("args", []))
            print(f"[{sev:>5}] {args_str}")
        elif method == "Runtime.exceptionThrown":
            ed = ev["params"]["exceptionDetails"]
            msg = ed.get("exception", {}).get("description") or ed.get("text", "")
            print(f"[EXCEPTION] {msg}")
        elif method == "Log.entryAdded":
            entry = ev["params"]["entry"]
            print(f"[{sev:>5}] {entry.get('text', '')}")


def cmd_keys(args):
    """Dispatch a sequence of key presses.  Supports plain 'a', chords
    like 'cmd+k', named keys 'Escape' / 'Tab' / 'Enter' / 'ArrowLeft'."""
    # Named key map — CDP expects the `key`, `code`, and often `text`.
    NAMED = {
        "Escape":    {"key": "Escape",    "code": "Escape"},
        "Enter":     {"key": "Enter",     "code": "Enter",    "text": "\r"},
        "Tab":       {"key": "Tab",       "code": "Tab"},
        "Backspace": {"key": "Backspace", "code": "Backspace"},
        "ArrowLeft": {"key": "ArrowLeft", "code": "ArrowLeft"},
        "ArrowRight":{"key": "ArrowRight","code": "ArrowRight"},
        "ArrowUp":   {"key": "ArrowUp",   "code": "ArrowUp"},
        "ArrowDown": {"key": "ArrowDown", "code": "ArrowDown"},
        "Space":     {"key": " ",         "code": "Space",    "text": " "},
    }

    def dispatch(c: CDP, key_spec: dict, modifiers: int = 0):
        base = {"modifiers": modifiers}
        base.update(key_spec)
        c.send("Input.dispatchKeyEvent", {"type": "keyDown", **base})
        # Optionally send a char event for text-producing keys
        if "text" in key_spec:
            c.send("Input.dispatchKeyEvent", {
                "type": "char",
                "text": key_spec["text"],
                "modifiers": modifiers,
            })
        c.send("Input.dispatchKeyEvent", {"type": "keyUp", **base})

    MOD_BITS = {"shift": 8, "ctrl": 2, "cmd": 4, "alt": 1, "meta": 4}

    with _open_cdp() as c:
        for chord in args.sequence:
            parts = chord.split("+")
            mods = 0
            base = parts[-1]
            for m in parts[:-1]:
                mods |= MOD_BITS.get(m.lower(), 0)
            if base in NAMED:
                dispatch(c, NAMED[base], mods)
            elif len(base) == 1:
                dispatch(c, {"key": base, "code": f"Key{base.upper()}", "text": base}, mods)
            else:
                print(f"(warn: unknown key {base!r})", file=sys.stderr)


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("connect")

    p_eval = sub.add_parser("eval"); p_eval.add_argument("expr")
    p_click = sub.add_parser("click"); p_click.add_argument("selector")
    p_text = sub.add_parser("text"); p_text.add_argument("selector")

    p_shot = sub.add_parser("screenshot")
    p_shot.add_argument("out")
    p_shot.add_argument("--full", action="store_true")

    p_con = sub.add_parser("console")
    p_con.add_argument("--clear", action="store_true")
    p_con.add_argument("--tail", type=int, default=50)
    p_con.add_argument("--levels", default=None,
                       help="comma-sep: error,warning,log,info,debug")

    p_keys = sub.add_parser("keys")
    p_keys.add_argument("sequence", nargs="+",
                        help="key specs like 'cmd+k', 'Escape', 'a'")

    args = p.parse_args()
    globals()["cmd_" + args.cmd](args)


if __name__ == "__main__":
    main()
