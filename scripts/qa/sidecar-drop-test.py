#!/usr/bin/env python3
"""
RTM Send — synthetic drop test.

Writes a tiny WAV + sidecar JSON + .ready marker into ~/.rtm/incoming/
the same way the plug-in does, with every supported route value.
Lets a developer verify that RTM Suite's receiver:

  • picks up the .ready marker (watcher fires)
  • parses the sidecar (route / daw / session_name / region_*)
  • routes correctly:
      route=single   → single-file analyse triggers automatically
      route=compareB → File B slot + compare analyse triggers
      route=batch    → added to album batch (v4.1+)

This script only writes the files; a human runs RTM Suite and watches
for the expected behaviour.  Combined with an auto-analyse assertion
in the app it becomes a full integration check.

Usage:
    python3 scripts/qa/sidecar-drop-test.py --route single
    python3 scripts/qa/sidecar-drop-test.py --route compareB
    python3 scripts/qa/sidecar-drop-test.py --route batch
    python3 scripts/qa/sidecar-drop-test.py --all
"""
from __future__ import annotations
import argparse
import json
import os
import struct
import sys
import time
import wave
from pathlib import Path

INCOMING = Path.home() / ".rtm" / "incoming"
SAMPLE_RATE = 44100
DURATION_S = 3.0
CHANNELS = 2


def synth_wav(path: Path) -> None:
    """3 s of quiet pink noise stereo so the analyser has something to chew on."""
    import random
    n = int(SAMPLE_RATE * DURATION_S)
    rng = random.Random(42)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(CHANNELS)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for _ in range(n):
            for _ in range(CHANNELS):
                # -24 dBFS rough — loud enough to measure, quiet enough to not surprise
                s = int(rng.gauss(0, 1) * 0.08 * 32767)
                s = max(-32768, min(32767, s))
                frames += struct.pack("<h", s)
        w.writeframes(bytes(frames))


def write_drop(route: str, label: str) -> Path:
    INCOMING.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    stem = f"{ts}-qa-{label}"
    wav = INCOMING / f"{stem}.wav"
    sidecar = INCOMING / f"{stem}.rtm.json"
    ready = INCOMING / f"{stem}.ready"

    synth_wav(wav)

    sidecar.write_text(json.dumps({
        "route": route,
        "session_name": f"QA test - {label}",
        "daw": "QA harness",
        "sample_rate": SAMPLE_RATE,
        "channels": CHANNELS,
        "duration_sec": DURATION_S,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "ring",
        "region_name": f"synthetic-{label}",
        "region_start_sec": 0.0,
        "region_end_sec": DURATION_S,
        "region_source_name": "qa-harness",
    }, indent=2))

    # atomic write of .ready to trigger the watcher
    ready.write_text(stem)
    return wav


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--route", choices=["single", "compareB", "batch"],
                    help="Which route hint to write into the sidecar")
    ap.add_argument("--all", action="store_true",
                    help="Write one drop for each supported route")
    args = ap.parse_args()

    if not args.all and not args.route:
        ap.print_help()
        sys.exit(2)

    print(f"Dropping synthetic audio into {INCOMING}")
    if args.all:
        for r in ("single", "compareB", "batch"):
            p = write_drop(r, r)
            print(f"  + {r:<9s} -> {p.name}")
            time.sleep(0.3)   # space them slightly so the chip ordering is obvious
    else:
        p = write_drop(args.route, args.route)
        print(f"  + {args.route} -> {p.name}")

    print()
    print("Now open RTM Suite and confirm:")
    print("  route=single   -> auto-loads into File A and analysis starts")
    print("  route=compareB -> loads into File B if A exists, or to A if A empty")
    print("  route=batch    -> adds to album batch surface (v4.1+)")


if __name__ == "__main__":
    main()
