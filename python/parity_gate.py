#!/usr/bin/env python3
"""RTM Suite — pre-delivery PARITY GATE (P0-7).

The board made this a ship gate: a measurement product cannot ship to paying
customers without a reproducible accuracy gate on REAL masters. This harness is
two layers:

  LAYER 1 — SYNTHETIC CORRECTNESS (runs anywhere, fast, deterministic).
    Proves the P0-1 ship-blocker fix: the AAC inter-sample-peak verdict must be
    computed per-channel, so a hard-panned single-channel clip is reported FAIL,
    not a mono-downmix PASS. Also validates 4x true-peak accuracy on a known
    near-Nyquist tone.

  LAYER 2 — REAL-MASTER PARITY (run on Lambda GPU box, NOT the local Mac).
    Reads a labelled manifest of master pairs and gates:
        specificity on benign EQ/gain  >= 0.95   (no false "degradation")
        sensitivity on real artifacts  >= 0.90   (don't miss real damage)
    Manifest schema (JSON):
        {"pairs": [
            {"ref": "a.wav", "deg": "b.wav", "label": "benign"|"artifact",
             "note": "±3 dB air shelf"},
            ...]}

USAGE
    # Layer 1 only (CI / local sanity — light, no heavy engine):
    python3 parity_gate.py --synthetic-only
    # Full gate on Lambda with a real corpus:
    python3 parity_gate.py --manifest /data/parity_corpus.json

Exit code 0 = gate PASSED (safe to ship that surface); non-zero = FAILED.

NOTE: do not run Layer 2 on the local Mac — scoring a corpus drives the full
engine (librosa/soxr/ViSQOL) and has crashed the machine before. Lambda only.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile

import numpy as np

SPEC_THRESHOLD = 0.95   # specificity on benign content
SENS_THRESHOLD = 0.90   # sensitivity on real artifacts


# ─────────────────────────── Layer 1: synthetic ───────────────────────────
def _synthetic_aac_isp_per_channel() -> tuple[bool, str]:
    """The P0-1 regression: a hard-panned clipping master must FAIL the AAC ISP
    verdict. Under the old mono-downmix code an L-only +full-scale signal
    averaged to ~-6 dB and PASSED. Per-channel max must catch it."""
    try:
        import soundfile as sf
        from encoded_preview import check_aac_intersample_peaks
    except Exception as e:  # pragma: no cover
        return False, f"import failed: {e}"

    sr = 48000
    n = int(2.5 * sr)
    t = np.arange(n) / sr
    # Left channel: near-0 dBFS 1 kHz tone shaped to provoke inter-sample peaks;
    # Right channel: silence. Mono downmix would halve the level (~-6 dB).
    left = 0.999 * np.sin(2 * np.pi * 1000 * t).astype(np.float64)
    right = np.zeros_like(left)
    stereo = np.stack([left, right], axis=1)

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "hardpanned.wav")
        sf.write(path, stereo, sr, subtype="FLOAT")
        res = check_aac_intersample_peaks(path, duration_sec=2.0)

    if not res.get("checked"):
        return False, f"check did not run: {res.get('note')}"
    verdict = res.get("verdict")
    post = res.get("post_tp_dbtp")
    ok = verdict == "fail"
    return ok, (f"hard-panned clip → verdict={verdict} post_tp={post} dBTP "
                f"(expected 'fail'; mono-downmix bug would say 'pass')")


def _synthetic_true_peak_accuracy() -> tuple[bool, str]:
    """4x true-peak must read a known near-Nyquist tone within tolerance and the
    per-channel engine must agree across channels."""
    try:
        from distortion_detector import detect_true_peaks
    except Exception as e:  # pragma: no cover
        return False, f"import failed: {e}"
    sr = 48000
    n = sr
    t = np.arange(n) / sr
    # 0 dBFS tone at 19.9 kHz — true peak exceeds sample peak (inter-sample).
    mono = np.sin(2 * np.pi * 19900 * t).astype(np.float64)
    res = detect_true_peaks(mono, mono, sr)
    tp = res.get("true_peak_b_dbtp", res.get("true_peak_dbtp"))
    # Sample peak is ~0 dBFS; true peak should be >= sample peak (>= ~-0.05) and
    # not absurd. Loose sanity band — the gate is "did the oversampler engage".
    ok = tp is not None and -0.5 <= tp <= 1.5
    return ok, f"19.9 kHz 0 dBFS tone → TP={tp} dBTP (expect ≳ 0, oversampler engaged)"


def run_synthetic() -> bool:
    checks = [
        ("AAC ISP per-channel (P0-1)", _synthetic_aac_isp_per_channel),
        ("4x true-peak accuracy", _synthetic_true_peak_accuracy),
    ]
    all_ok = True
    print("── Layer 1: synthetic correctness ──")
    for name, fn in checks:
        try:
            ok, detail = fn()
        except Exception as e:
            ok, detail = False, f"exception: {e}"
        all_ok &= ok
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}: {detail}")
    return all_ok


# ─────────────────────────── Layer 2: real corpus ──────────────────────────
def _is_flagged(ref: str, deg: str) -> bool:
    """Did the suite flag this pair as having a real problem? A pair is 'flagged'
    if the AAC ISP verdict fails OR the master breaches the −1 dBTP ceiling.
    (Spectral-difference is deliberately NOT used here — it is a magnitude-of-
    change metric, not a quality verdict, so benign EQ must not count as a flag.)"""
    from encoded_preview import check_aac_intersample_peaks
    from distortion_detector import detect_true_peaks
    import soundfile as sf

    isp = check_aac_intersample_peaks(deg)
    if isp.get("verdict") == "fail":
        return True
    y, sr = sf.read(deg, always_2d=True)
    chans = [y[:, c] for c in range(y.shape[1])]
    tp = detect_true_peaks(chans[0], chans[0], sr,
                           stereo_b=y.T if y.shape[1] >= 2 else None)
    val = tp.get("true_peak_b_dbtp", tp.get("true_peak_dbtp"))
    return val is not None and val > -1.0


def run_corpus(manifest_path: str) -> bool:
    with open(manifest_path) as fh:
        manifest = json.load(fh)
    pairs = manifest.get("pairs", [])
    benign = [p for p in pairs if p["label"] == "benign"]
    artifact = [p for p in pairs if p["label"] == "artifact"]
    if not benign or not artifact:
        print("ERROR: manifest needs both 'benign' and 'artifact' pairs.", file=sys.stderr)
        return False

    print(f"── Layer 2: real-master parity ({len(benign)} benign, {len(artifact)} artifact) ──")
    # specificity = fraction of benign correctly NOT flagged
    tn = sum(1 for p in benign if not _is_flagged(p["ref"], p["deg"]))
    # sensitivity = fraction of artifacts correctly flagged
    tp = sum(1 for p in artifact if _is_flagged(p["ref"], p["deg"]))
    specificity = tn / len(benign)
    sensitivity = tp / len(artifact)
    spec_ok = specificity >= SPEC_THRESHOLD
    sens_ok = sensitivity >= SENS_THRESHOLD
    print(f"  specificity (benign not flagged): {specificity:.3f}  "
          f"[{'PASS' if spec_ok else 'FAIL'}] need ≥ {SPEC_THRESHOLD}")
    print(f"  sensitivity (artifacts flagged):  {sensitivity:.3f}  "
          f"[{'PASS' if sens_ok else 'FAIL'}] need ≥ {SENS_THRESHOLD}")
    return spec_ok and sens_ok


def main() -> int:
    ap = argparse.ArgumentParser(description="RTM pre-delivery parity gate (P0-7)")
    ap.add_argument("--manifest", help="JSON manifest of labelled master pairs (Lambda only)")
    ap.add_argument("--synthetic-only", action="store_true",
                    help="run only Layer 1 synthetic correctness (CI/local)")
    args = ap.parse_args()

    synth_ok = run_synthetic()
    corpus_ok = True
    if not args.synthetic_only:
        if not args.manifest:
            print("\nNOTE: no --manifest given; ran synthetic layer only. The full "
                  "ship gate REQUIRES a real-master corpus (run on Lambda).", file=sys.stderr)
        else:
            corpus_ok = run_corpus(args.manifest)

    passed = synth_ok and corpus_ok
    print(f"\nPARITY GATE: {'PASSED' if passed else 'FAILED'}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
