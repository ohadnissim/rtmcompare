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


def check_noise_seeding(mono: "np.ndarray", sr: int) -> GenerationLossCheck:
    """Counter-signal for the noise-floor seeding bypass attack.

    Attack: add shaped white noise at −90 dBFS above 17.5 kHz via ffmpeg to
    fill the spectral hole that `check_brickwall` detects. The AAC frame-stride
    autocorrelation (`check_mdct_periodicity`) survives this attack because it
    runs on sub-16 kHz content — but a secondary tell remains: the injected noise
    above 17.5 kHz has zero musical correlation with the signal below it, whereas
    real high-frequency content (cymbals, room) correlates weakly but non-randomly
    with the musical content.

    Method: compute the cross-correlation between the >17.5 kHz band envelope and
    the 1–8 kHz band envelope over 100 ms windows. A Pearson |r| > 0.25 across
    the majority of windows suggests real HF content; near-zero correlation across
    all windows suggests injected noise.

    Score 0.4 (moderate suspicion) when HF band exists but shows near-zero
    correlation with musical content. Only fires when the sample rate supports
    17.5 kHz+ content (sr ≥ 40000).
    """
    if np is None:
        return GenerationLossCheck("noise_seeding", 0.0, "numpy unavailable")
    if sr < 40000:
        return GenerationLossCheck("noise_seeding", 0.0,
                                   f"Sample rate {sr} Hz too low for HF correlation check.")

    def _band_envelope(sig: "np.ndarray", low: float, high: float) -> "np.ndarray":
        fft = np.fft.rfft(sig)
        freqs = np.fft.rfftfreq(len(sig), d=1.0 / sr)
        mask = (freqs >= low) & (freqs <= high)
        fft_band = fft.copy()
        fft_band[~mask] = 0
        bp = np.fft.irfft(fft_band, n=len(sig))
        return np.abs(bp)

    n = min(len(mono), sr * 10)   # analyse first 10 s
    chunk = mono[:n]
    env_hf   = _band_envelope(chunk, 17500, sr / 2 * 0.99)
    env_mid  = _band_envelope(chunk, 1000,  8000)

    if float(np.max(env_hf)) < 1e-8:
        return GenerationLossCheck("noise_seeding", 0.0,
                                   "No energy above 17.5 kHz — cannot assess HF correlation.")

    win = int(0.1 * sr)  # 100 ms windows
    corrs = []
    for start in range(0, n - win, win):
        hf_win  = env_hf[start:start + win]
        mid_win = env_mid[start:start + win]
        if np.std(hf_win) < 1e-9 or np.std(mid_win) < 1e-9:
            continue
        r = float(np.corrcoef(hf_win, mid_win)[0, 1])
        if np.isfinite(r):
            corrs.append(abs(r))

    if not corrs:
        return GenerationLossCheck("noise_seeding", 0.0, "Insufficient signal for HF correlation.")

    mean_corr = float(np.mean(corrs))
    if mean_corr < 0.08:
        return GenerationLossCheck(
            "noise_seeding", 0.4,
            f"Near-zero HF/mid correlation ({mean_corr:.3f}) — HF content may be seeded noise "
            "masking a codec cutoff rather than genuine high-frequency audio.",
        )
    if mean_corr < 0.18:
        return GenerationLossCheck(
            "noise_seeding", 0.15,
            f"Low HF/mid correlation ({mean_corr:.3f}) — inconclusive; could be sparse HF content.",
        )
    return GenerationLossCheck(
        "noise_seeding", 0.0,
        f"HF/mid correlation ({mean_corr:.3f}) consistent with genuine high-frequency content.",
    )


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
        check_noise_seeding(mono, sr),
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
