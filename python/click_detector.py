"""
Click detector — public API kept stable; v2 LPC-residual under the hood.

5.3.x: replaced the v1 multi-criteria heuristic with the v2 LPC-residual
detector vendored from FLOW (Godsill & Rayner 1998, the algorithm that
CEDAR / iZotope RX / Acon Digital use). v1 misclassified snare/cymbal/
consonant transients as clicks because its features (HF energy + spectral
flatness) aren't discriminative — drum hits and digital glitches both
look bright + broadband. v2 asks "is this sample predictable from its
context?" — musical transients ARE (LPC anticipates them), digital
clicks AREN'T (residual blows up).

Numbers from FLOW's ground-truth corpus at default sensitivity:
  - TOO HIGH:        20 → 0  (all-FP → clean)
  - BAYONIKAL:       31 → 0  (mostly drum FPs → clean)
  - BABILON:         15 → 2
  - 13-track album:  92 → 25 (~73 % quieter)

This module preserves the v1 public API (`detect_clicks` /
`detect_clicks_single`) so callers in analyze.py don't change. The v1
implementation lives in `click_detector_v1.py` and is used as a
graceful fallback if v2 raises.
"""
from __future__ import annotations

import numpy as np
import librosa


def detect_clicks(path_a: str, path_b: str, sr: int = 44100) -> list:
    """Detect digital clicks/glitches in File B (the compared file)."""
    return detect_clicks_single(path_b, sr)


def detect_clicks_single(path: str, sr: int = 44100) -> list:
    """Detect digital clicks AND glitches in a single file.

    Tries v2 (LPC-residual, Godsill & Rayner 1998) first; falls back to
    v1 (multi-criteria HF-ratio heuristic) if v2 raises for any reason
    (numerical issue on degenerate input, missing scipy feature, etc.).
    """
    try:
        return _detect_v2(path, sr)
    except Exception as exc:  # noqa: BLE001 — we genuinely want any failure to fall through
        import sys
        sys.stderr.write(f"[click_detector] v2 fallback to v1 ({exc})\n")
        try:
            from click_detector_v1 import detect_clicks_single as _v1
            return _v1(path, sr)
        except Exception as exc2:  # noqa: BLE001
            sys.stderr.write(f"[click_detector] v1 also failed: {exc2}\n")
            return []


def _detect_v2(path: str, sr: int) -> list:
    """v2 LPC-residual path. Loads mono, runs `click_detector_v2.detect`,
    normalises the output to the v1 schema the existing UI expects."""
    from click_detector_v2 import detect as _v2_detect

    y, sr_load = librosa.load(path, sr=sr, mono=True)
    if y.size < 2048:
        return []

    # 5.4.1 fix: sensitivity 1.0 is FLOW's intentionally-strict
    # production default (K = max(6, 12/sens) = 12 at sens=1.0). The
    # v2 docstring at the top of `detect()` claimed "1.5 = default" but
    # that contradicted FLOW's own ground-truth handoff
    # (docs/CLICK_DETECTOR_V2_HANDOFF.md): at sens=1.0 TOO HIGH and
    # BAYONIKAL DREAMS produce 0 flags; at sens=1.5 the same masters
    # report 10 flags — the difference is drum FPs. Pre-5.4.1 we had
    # sens=1.5 baked in here and engineers saw drum hits flagged as
    # clicks. Production wants the strict default.
    #
    # If the user wants to surface borderline events on a track they
    # KNOW has issues, the DeclickPanel exposes the sensitivity knob
    # directly — that's the right place for "review mode," not the
    # analyze-time pass.
    raw = _v2_detect(y, sr_load, sensitivity=1.0)

    # v2 returns a richer schema; normalise to what the UI consumes.
    # v1 fields the UI reads: time, time_formatted, severity, energy_db,
    #   description, duration_ms, algorithm. v2 emits all of these +
    #   `confidence`, `ratio` — keep those as bonus fields the UI can
    #   start consuming progressively.
    normalised: list[dict] = []
    for ev in raw:
        normalised.append({
            "time": float(ev.get("time", 0.0)),
            "time_formatted": ev.get("time_formatted", ""),
            "severity": ev.get("severity", "low"),
            "energy_db": float(ev.get("energy_db", -60.0)) if ev.get("energy_db") is not None else None,
            "description": ev.get("description", ""),
            "duration_ms": float(ev.get("duration_ms", 0.0)) if ev.get("duration_ms") is not None else None,
            "algorithm": ev.get("algorithm", "lpc_residual_v2"),
            "confidence": ev.get("confidence"),
            "ratio": ev.get("ratio"),
        })

    # 5.4.1 fix: dropped the v1-style 80 ms time-first dedupe. v2 already
    # applies a `MIN_SEPARATION_SEC = 0.25` ratio-first dedupe internally
    # — the additional adapter pass was time-first and would silently
    # drop a real click if a drum FP preceded it within 80 ms (drum
    # cluster wins, real click loses). With the strict sens=1.0 default
    # the FP rate is low enough that v2's own dedupe is sufficient.
    normalised.sort(key=lambda c: c["time"])

    # Soft cap at 20 events for UI sanity. Sort by (severity, -ratio)
    # so within a severity tier the highest-residual events win the cap
    # rather than whichever happened to come first — pre-5.4.1 the cap
    # was severity-only and would amplify drum FPs that all share
    # severity="high" while pushing genuine "low"-severity real clicks
    # out of the result.
    if len(normalised) > 20:
        sev_order = {"high": 0, "medium": 1, "low": 2}
        normalised.sort(
            key=lambda c: (sev_order.get(c.get("severity", "low"), 2),
                           -float(c.get("ratio") or 0.0))
        )
        deduped = normalised[:20]
        deduped.sort(key=lambda c: c["time"])
    else:
        deduped = normalised

    # Strip `ratio` from the public list to match v1 (kept above only
    # for ranking). `confidence` is preserved as a bonus.
    for ev in deduped:
        ev.pop("ratio", None)
    return deduped
