"""
Limiter-artefact detector — surfaces the audible side effects of a
too-aggressive mastering chain that the generic distortion detector
misses.

Panel ask (Marek, mastering): "Sidechain / limiter artefacts are a real
QC blind spot.  Compression pump, ringing, inter-sample clip on the
limiter sidechain — catches things my ears might miss at 2am."

Three independent sub-detectors, each returning (score, evidence_text):

  1.  Pumping — envelope-correlation between kick transients and the
      rest of the programme.  A limiter pumping hard ducks the full
      mix on every kick hit; measured by cross-correlation of the
      low-band envelope (5-100 Hz) against the mid-band envelope
      (200-4000 Hz).  A healthy master has ~0.1 correlation; a pumping
      master hits 0.4+.

  2.  Inter-sample-over rate — 4× oversampled peak scan.  Counts
      samples where TP exceeds 0 dBFS.  Distinct from the overall TP
      number because we report the DENSITY (events per minute) — a
      single spike vs. constant clipping.

  3.  Ringing — detects high-frequency oscillation triggered by the
      limiter's attack.  We look for energy peaks in the 5-15 kHz
      band that appear within 2-5 ms of strong transients (kick / snare
      attacks).  The hallmark of a too-fast-attack brick-wall limiter
      is a burst of HF energy that correlates with the transient
      onset but has no musical source.

Returns a dict {severity, confidence, issues, recommendations,
pump_score, iso_over_per_min, ringing_events}.  Severity ladder:
clean < advisory < warning < problem.

The output dovetails with the AttentionList builder so hits surface
next to existing clicks / hum / distortion findings.
"""
from __future__ import annotations

import math

import numpy as np
import librosa
from scipy.signal import butter, sosfilt, resample_poly


def _sos(sr: int, lo: float, hi: float) -> np.ndarray:
    """Butterworth band-pass.  Caps to Nyquist so `lo=5, hi=100` works
    at both 44.1 k and 48 k without hand-tuning."""
    nyq = sr / 2
    lo_n = max(1e-5, lo / nyq)
    hi_n = min(0.999, hi / nyq)
    return butter(4, [lo_n, hi_n], btype='band', output='sos')


def _envelope(x: np.ndarray, sr: int, smooth_ms: float = 20.0) -> np.ndarray:
    """Rectified + smoothed amplitude envelope."""
    rect = np.abs(x)
    # Exponential moving average via one-pole filter
    alpha = math.exp(-1.0 / (sr * smooth_ms / 1000.0))
    env = np.empty_like(rect)
    env[0] = rect[0]
    for i in range(1, len(rect)):
        env[i] = alpha * env[i - 1] + (1 - alpha) * rect[i]
    return env


def detect_pumping(y_mono: np.ndarray, sr: int) -> tuple[float, list[str]]:
    """
    Return (pump_score 0-1, evidence strings).  pump_score > 0.3 is
    audible pumping; > 0.5 is obvious.
    """
    if len(y_mono) < sr * 3:
        return 0.0, []
    lo_sos = _sos(sr, 40, 120)
    mid_sos = _sos(sr, 300, 3000)
    low = sosfilt(lo_sos, y_mono)
    mid = sosfilt(mid_sos, y_mono)
    # Envelopes at 20 ms smoothing — catches kick pumps without
    # capturing micro-dynamics.
    low_env = _envelope(low, sr, smooth_ms=20.0)
    mid_env = _envelope(mid, sr, smooth_ms=20.0)
    # If the mix is silent in either band, no pumping can be detected.
    if low_env.std() < 1e-5 or mid_env.std() < 1e-5:
        return 0.0, []
    # When pumping, a kick hit (low energy spikes UP) drags the mid
    # band DOWN.  So we correlate (low_env) against (−d/dt mid_env)
    # for the hallmark "kick pulls down everything else" signature.
    diff_mid = np.diff(mid_env, prepend=mid_env[0])
    # Negative derivative of mid when kick spikes = pumping.
    corr = float(np.corrcoef(low_env, -diff_mid)[0, 1])
    if not np.isfinite(corr):
        corr = 0.0
    # Map correlation → severity.  Empirical: unpumped masters hit
    # ~0.05-0.15, lightly glued ~0.20-0.30, obviously pumped 0.40+.
    score = max(0.0, min(1.0, (corr - 0.15) / 0.35))
    evidence = []
    if score > 0.3:
        # 5.3.1 honesty fix: this metric flags low/mid envelope anti-
        # correlation, which an artefact-style limiter pump produces —
        # but kick-anchored EDM / hip-hop / drum-and-bass with creative
        # sidechain ducking ALSO produces this signature. The detector
        # cannot tell artefact pumping from intentional sidechain just
        # from the envelopes. Make that explicit so we don't flag a
        # House master's signature move as a defect.
        evidence.append(
            f'Low/mid envelope anti-correlation ({corr:.2f}) — could be limiter pumping, '
            f'or could be intentional sidechain on EDM / hip-hop / D&B. A/B in the player '
            f'against an unlimited reference to tell which.'
        )
    return score, evidence


def detect_intersample_overs(y_mono: np.ndarray, sr: int) -> tuple[int, float]:
    """
    Return (events_count, per_minute_rate) of inter-sample TP overs.
    We count "events" (distinct runs) not raw samples so multi-sample
    overs on a single transient count as one.
    """
    up = resample_poly(y_mono, 4, 1)
    over = np.abs(up) > 1.0
    if not over.any():
        return 0, 0.0
    # Count rising edges (start of over runs)
    edges = np.diff(over.astype(np.int8), prepend=0) == 1
    events = int(edges.sum())
    minutes = len(y_mono) / sr / 60.0
    rate = events / max(minutes, 1e-6)
    return events, round(rate, 2)


def detect_limiter_ringing(y_mono: np.ndarray, sr: int) -> tuple[int, list[str]]:
    """
    Count audible HF ringing events.  Approach: find strong transients
    via onset strength on the broadband signal, then look 2-5 ms after
    each onset for a burst of energy in the 6-14 kHz band that's
    disproportionate to the broadband onset.  Classic brick-wall-
    attack signature.
    """
    if len(y_mono) < sr * 2:
        return 0, []
    # Onset strength
    onsets = librosa.onset.onset_strength(y=y_mono, sr=sr)
    # Onsets run at ~86 Hz (default hop 512 at sr 44.1k); convert
    # onset frame → sample index for the probe.
    hop = 512
    strong_onsets = np.where(onsets > np.percentile(onsets, 90))[0]
    if len(strong_onsets) == 0:
        return 0, []
    hf_sos = _sos(sr, 6000, 14000)
    hf = sosfilt(hf_sos, y_mono)
    hf_env = _envelope(hf, sr, smooth_ms=3.0)

    ring_count = 0
    window_start_offset = int(sr * 0.002)   # 2 ms after onset
    window_end_offset   = int(sr * 0.006)   # 6 ms after onset
    baseline_len        = int(sr * 0.020)   # 20 ms preceding

    for frame_idx in strong_onsets:
        sample = frame_idx * hop
        ws = sample + window_start_offset
        we = min(len(hf_env), sample + window_end_offset)
        bs = max(0, sample - baseline_len)
        be = sample
        if we - ws < 16 or be - bs < 16:
            continue
        # Energy ratio: post-onset HF vs. pre-onset HF baseline.
        # Ringing = sharp HF spike with no pre-transient HF.
        post = hf_env[ws:we].mean()
        pre  = hf_env[bs:be].mean()
        # Clamp the denominator so an all-silent pre-window doesn't
        # make post/pre explode on a tiny post value.  Require post
        # to be above the same floor before calling it ringing.
        pre_floor = max(pre, 1e-6)
        if post > 0.02 and (post / pre_floor) > 6:
            ring_count += 1

    evidence = []
    if ring_count > 5:
        evidence.append(f'Limiter ringing — {ring_count} transient events with unnatural HF burst. Attack is too fast or ceiling is too aggressive.')
    return ring_count, evidence


def analyse(y_mono: np.ndarray, sr: int) -> dict:
    """Run all three sub-detectors and roll up severity."""
    pump_score, pump_ev = detect_pumping(y_mono, sr)
    iso_count, iso_rate = detect_intersample_overs(y_mono, sr)
    ring_count, ring_ev = detect_limiter_ringing(y_mono, sr)

    issues: list[str] = []
    recs:   list[str] = []
    severity = 'clean'

    issues.extend(pump_ev)
    issues.extend(ring_ev)

    if iso_count > 0:
        issues.append(f'{iso_count} inter-sample peak over-events ({iso_rate} /min). Files will clip on conversion.')
        if iso_rate > 5:
            severity = 'problem'
            recs.append('Enable true-peak limiting at −1 dBTP ceiling before bounce.')
        elif iso_rate > 0.5:
            severity = max_severity(severity, 'warning')
            recs.append('Consider true-peak limiting — a few inter-sample overs will clip on D-to-A.')

    if pump_score > 0.5:
        # Don't escalate to "problem" without confirming it's an
        # artefact, not an intentional creative move. Strong anti-
        # correlation is normal in EDM/trap/D&B.
        severity = max_severity(severity, 'warning')
        recs.append(
            'Strong low/mid envelope ducking detected. If unintentional, '
            'pull the limiter back 1–2 dB or lengthen attack. If this is '
            'a sidechain move, ignore.'
        )
    elif pump_score > 0.3:
        severity = max_severity(severity, 'warning')
        recs.append(
            'Borderline ducking — check in the A/B player with EQ bypassed. '
            'Could be limiter pumping or intentional sidechain.'
        )

    if ring_count > 15:
        severity = 'problem'
        recs.append('Limiter attack is too fast — switch to a slower attack (3-5 ms) or use a clipper stage before the limiter.')
    elif ring_count > 5:
        severity = max_severity(severity, 'warning')
        recs.append('HF ringing on transients — consider a soft-knee or look-ahead limiter.')

    if not issues:
        issues.append('No limiter artefacts detected.')

    # Confidence: how many cross-checks corroborate each other?
    #   2+ sub-detectors fire     -> high   (two independent signals)
    #   1 sub-detector fires       -> medium (isolated signal, could be
    #                                        a threshold artefact)
    #   0 fire and severity=clean  -> high   (all three agree: clean)
    #   0 fire but something else  -> low    (unusual state; don't bluff)
    # Fixes a long-standing inversion where 0-fired was reported as
    # 'high' even when no detector actually contributed a signal.
    fired = sum(1 for v in (pump_score > 0.3, iso_rate > 0.5, ring_count > 5) if v)
    if fired >= 2:
        confidence = 'high'
    elif fired == 1:
        confidence = 'medium'
    elif severity == 'clean':
        confidence = 'high'
    else:
        confidence = 'low'

    return {
        'severity': severity,
        'confidence': confidence,
        'issues': issues,
        'recommendations': recs,
        'pump_score': round(pump_score, 2),
        'intersample_over_count': iso_count,
        'intersample_over_per_min': iso_rate,
        'ringing_events': ring_count,
    }


def max_severity(a: str, b: str) -> str:
    order = {'clean': 0, 'advisory': 1, 'warning': 2, 'problem': 3}
    return a if order.get(a, 0) >= order.get(b, 0) else b
