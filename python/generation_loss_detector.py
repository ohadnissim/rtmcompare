"""
Generation-loss detector — finds signs that a "master" has already been
through a lossy codec round-trip (AAC / MP3 → decode → re-render).
Important for archival reissues and for catching a subtle engineer
mistake (delivering a codec-decoded WAV as the master).

Three heuristics:

  1. Brick-wall cutoff — lossy codecs usually drop everything above
     16–20 kHz. A master that falls off a cliff near those frequencies
     with no natural roll-off is suspicious.
  2. AAC frame-stride artefacts — AAC LC operates with a 1024-sample
     hop between long-window frames (the MDCT length itself is 2048
     with 50% overlap). Residual energy patterns that align to that
     1024-sample stride survive decode and reveal prior AAC encoding.
     Checked via autocorrelation of the high-frequency envelope at
     the 1024-sample frame stride. (Pre-5.3.1 docstring called this
     the "MDCT period" — that was technically wrong; the period in
     question is the frame stride. The math is unchanged.)
  3. Pre-echo / transient smear — AAC's psychoacoustic model introduces
     a pre-echo before loud transients. We look for this by comparing
     pre-transient RMS against a clean reference window.

Status: SCAFFOLD. See RTM Engineers/FEATURES/GENERATION-LOSS-DETECTOR.md
for the full DSP spec + reference literature.
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass, asdict

try:
    import numpy as np
    import soundfile as sf
except ImportError:
    np = None  # type: ignore
    sf = None  # type: ignore


@dataclass
class GenerationLossCheck:
    name: str
    score: float           # 0 = no evidence, 1 = strong evidence
    detail: str


@dataclass
class GenerationLossResult:
    probability: float     # 0..1 — aggregate across checks
    verdict: str           # 'likely_lossless' | 'suspect' | 'likely_prior_lossy'
    checks: list[GenerationLossCheck]
    summary: str


def _cutoff_frequency(mono: "np.ndarray", sr: int) -> float:
    """Estimate the -40 dB cutoff frequency. Brick-wall lossy files
    cluster at ~16 / ~19 / ~22 kHz depending on bitrate."""
    assert np is not None
    n = min(len(mono), sr * 5)
    x = mono[:n] - float(np.mean(mono[:n]))
    spec = np.abs(np.fft.rfft(x * np.hanning(n)))
    if float(np.max(spec)) <= 0: return float(sr / 2)
    spec_db = 20 * np.log10(spec / float(np.max(spec)) + 1e-12)
    freqs = np.fft.rfftfreq(n, d=1.0 / sr)
    # Find the highest frequency where energy is still above -40 dB.
    mask = spec_db > -40
    if not np.any(mask): return 0.0
    return float(np.max(freqs[mask]))


def check_brickwall(mono: "np.ndarray", sr: int) -> GenerationLossCheck:
    cutoff = _cutoff_frequency(mono, sr)
    # Clusters: 15.75–16.2 kHz (AAC 128k / MP3 128k), 19–19.6 kHz (AAC
    # 192k / MP3 320k), 21.5–22 kHz (AAC 320k).
    clusters = [
        (15.5e3, 16.5e3, 'AAC / MP3 at ~128 kbps'),
        (18.8e3, 19.8e3, 'AAC / MP3 at ~192–256 kbps'),
        (21.0e3, 22.2e3, 'AAC at ~320 kbps'),
    ]
    for lo, hi, label in clusters:
        if lo <= cutoff <= hi:
            return GenerationLossCheck(
                name="brickwall_cutoff",
                score=0.75,
                detail=f"Energy cliff at {cutoff/1000:.1f} kHz — matches {label}. Suspect prior lossy encode.",
            )
    if cutoff < sr / 2 * 0.93:
        return GenerationLossCheck(
            name="brickwall_cutoff",
            score=0.35,
            detail=f"Cutoff at {cutoff/1000:.1f} kHz — lower than expected for LPCM, mild suspicion.",
        )
    return GenerationLossCheck(
        name="brickwall_cutoff",
        score=0.0,
        detail=f"Cutoff at {cutoff/1000:.1f} kHz — consistent with LPCM source.",
    )


def check_mdct_periodicity(mono: "np.ndarray", sr: int) -> GenerationLossCheck:
    """Autocorrelation of the high-pass envelope at the AAC LC
    1024-sample frame stride. Lossy files show a subtle but persistent
    peak; lossless files decorrelate.

    5.3.1 honesty fix: the function name and docstring used to call
    this an "MDCT period" autocorr, which conflated the AAC LC long-
    window MDCT length (2048) with the inter-frame stride (1024). The
    math probes 1024 samples, which is the AAC LC frame stride, not
    the MDCT length. Detection still works (HF residue does have
    1024-sample structure post-IMDCT); we just describe it correctly.
    """
    if np is None:
        return GenerationLossCheck("aac_frame_stride_periodicity", 0.0, "numpy unavailable")
    # HPF 8 kHz to isolate where codec artefacts live.
    fft = np.fft.rfft(mono[: sr * 3] if len(mono) >= sr * 3 else mono)
    freqs = np.fft.rfftfreq(len(mono[: sr * 3] if len(mono) >= sr * 3 else mono), d=1.0 / sr)
    fft[freqs < 8000] = 0
    hp = np.fft.irfft(fft)
    env = np.abs(hp)
    env = env - float(np.mean(env))
    n = min(len(env), 8192)
    if n < 4096:
        return GenerationLossCheck("aac_frame_stride_periodicity", 0.0,
                                   "Too short for codec-frame check.")
    period = 1024  # AAC LC frame stride (samples)
    a = env[: n - period]
    b = env[period: n]
    denom = float(np.sqrt(np.dot(a, a) * np.dot(b, b))) + 1e-12
    corr = float(np.dot(a, b)) / denom
    if corr > 0.25:
        return GenerationLossCheck("aac_frame_stride_periodicity", 0.6,
                                   f"High-band envelope correlates at the AAC LC 1024-sample frame stride ({corr:.2f}) — lossy codec signature.")
    if corr > 0.12:
        return GenerationLossCheck("aac_frame_stride_periodicity", 0.3,
                                   f"Weak periodicity at the AAC frame stride ({corr:.2f}) — inconclusive.")
    return GenerationLossCheck("aac_frame_stride_periodicity", 0.0,
                               f"No AAC-frame-stride correlation ({corr:.2f}).")


def analyse_generation_loss(path: str) -> GenerationLossResult:
    if np is None or sf is None:
        return GenerationLossResult(
            probability=0.0, verdict="likely_lossless",
            checks=[], summary="numpy / soundfile unavailable — skipped.",
        )
    try:
        data, sr = sf.read(path, dtype="float32")
    except Exception as e:
        return GenerationLossResult(0.0, "likely_lossless", [],
                                    f"Could not decode file: {e}")
    mono = data.mean(axis=1) if data.ndim > 1 else data
    checks = [
        check_brickwall(mono, sr),
        check_mdct_periodicity(mono, sr),
    ]
    avg = sum(c.score for c in checks) / max(len(checks), 1)
    if avg >= 0.55:
        verdict, summary = "likely_prior_lossy", "Multiple signs this file was previously lossy-encoded. Source a true LPCM master."
    elif avg >= 0.30:
        verdict, summary = "suspect", "Weak evidence of prior lossy encoding — inspect the brick-wall region and MDCT correlation."
    else:
        verdict, summary = "likely_lossless", "No evidence of prior codec encoding. File looks like clean LPCM."
    return GenerationLossResult(
        probability=round(avg, 3),
        verdict=verdict,
        checks=checks,
        summary=summary,
    )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: generation_loss_detector.py <file>"}))
        sys.exit(1)
    r = analyse_generation_loss(sys.argv[1])
    print(json.dumps({
        "probability": r.probability, "verdict": r.verdict,
        "checks": [asdict(c) for c in r.checks], "summary": r.summary,
    }))
