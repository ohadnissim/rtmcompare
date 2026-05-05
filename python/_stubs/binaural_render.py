"""
Binaural render — produce an Apple-Spatial-Audio-compatible binaural
mix of an Atmos ADM BWF file so the engineer can audition what Apple
Spatial Audio listeners on headphones will actually hear.

Status: SCAFFOLD. Real HRTF convolution requires shipping an HRTF
impulse-response set (MIT KEMAR or CIPIC) and a proper ambisonic
decoder. This file defines the entry point + contract; the heavy
lifting (ADM parse → per-object spatial panner → HRTF convolution →
stereo bounce) is the v1 implementation work.

See RTM Engineers/FEATURES/BINAURAL-AUDITION.md for the full plan
including HRTF sourcing, Dolby Near/Mid/Far metadata handling, and
why this is "scaffold only" for now.
"""
from __future__ import annotations

import json
import sys


def render_binaural(adm_path: str, out_path: str, distance: str = "mid") -> dict:
    """Render the ADM BWF file at `adm_path` to a stereo binaural WAV
    at `out_path` using Apple's Near/Mid/Far distance profile.

    v0 stub — returns an error indicating the feature isn't wired yet
    so the renderer can surface a clean "not available" state instead
    of crashing.
    """
    if distance not in ("near", "mid", "far"):
        return {"ok": False, "error": f"unknown distance profile '{distance}'"}
    return {
        "ok": False,
        "error": "Binaural render not implemented in this build. Requires HRTF impulse-response set + ADM spatial-pan decoder. See RTM Engineers/FEATURES/BINAURAL-AUDITION.md for the implementation plan.",
        "adm_path": adm_path,
        "out_path": out_path,
        "distance": distance,
    }


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "usage: binaural_render.py <input.adm.wav> <output.wav> [near|mid|far]"}))
        sys.exit(1)
    src = sys.argv[1]
    out = sys.argv[2]
    dist = sys.argv[3] if len(sys.argv) > 3 else "mid"
    print(json.dumps(render_binaural(src, out, dist)))
