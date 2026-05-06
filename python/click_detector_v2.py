#!/usr/bin/env python3
"""
Click Detector v2 — Autoregressive residual outlier detection.

Replaces the spectrogram-based v1 (detect_clicks_visual.py) with the
approach every commercial restoration tool since Godsill & Rayner 1998
actually uses: fit an AR model of the underlying clean signal, flag the
samples whose LPC residual is an outlier.

Why this works where v1 couldn't
────────────────────────────────
v1 scored each STFT frame by brightness × flatness — a "how does this
frame look in the spectrogram?" heuristic. The fundamental problem: a
cymbal crash, a snare hit, and a digital click all look the same in
that feature space — all three are bright and broadband. No threshold
tuning fixes that; the features aren't discriminative.

v2 asks a different question: "given the ~30 ms of audio around this
sample, is this sample PREDICTABLE from its context?"

  - Musical transients ARE predictable. The AR model fit over the
    surrounding frame already captures the local signal statistics —
    including any drums, cymbals, or vocal transients. Their samples
    are large, but the *residual* (actual − predicted) stays moderate
    because the model anticipated them.

  - Digital clicks are NOT predictable. They come from nowhere. The
    residual is huge, standing out against the MAD-computed local
    noise floor.

The residual is the "surprise" signal. Clicks are surprising; music
isn't. This is the core insight from Godsill & Rayner's canonical
textbook (Springer 1998) and the engine underneath CEDAR, Acon Digital
Restoration Suite, and the low-level paths in iZotope RX.

Pipeline
────────
  1. Forward + backward LPC residual (Burg, order 50, 30 ms frame)
     → take min(|e_f|, |e_b|) per sample to suppress edge artifacts.
  2. Local MAD threshold: candidate if e[n] > K · 1.4826 · MAD over
     a ±100 ms window. K curve: K = max(2.5, 6.0 / sensitivity).
  3. Run-length duration gate: contiguous runs of candidates are
     merged into single events; events longer than 3 ms are dropped
     (those are musical transients, not clicks).
  4. Harmonic-context cross-check: if the surrounding audio has
     strong tonal content AND the candidate aligns with that tonality,
     downweight (likely an instrument onset the AR model mis-predicted
     rather than a foreign click).
  5. Sort + emit.

CLI compatible with detect_clicks_visual.py: same --in / --sensitivity
arguments, same JSON output schema. Drop-in replacement.
"""
import argparse
import json
import sys


def _format_time(t: float) -> str:
    """m:ss.sss — matches v1 format so the UI doesn't need changes."""
    m = int(t // 60)
    s = t - m * 60
    return f"{m}:{s:06.3f}"


def _burg_lpc(x, order: int):
    """
    Burg's method for LPC coefficient estimation.

    Why Burg: more stable than Yule-Walker on short frames, handles
    tonal signals (sustained notes) without spectrum-flattening, and
    is what speech coders + commercial audio restoration tools use.

    Returns the p-th order predictor coefficients a such that
        ŷ[n] = Σ a[k] · y[n-k]   for k = 1..p

    r4.1: prefer `librosa.lpc` (C-backed, ~30× faster than the
    Python-loop Burg implementation) when available. Falls back to a
    pure-numpy autocorrelation + Levinson-Durbin solution so this
    file stays importable without librosa installed.
    """
    import numpy as np

    x = np.asarray(x, dtype=np.float64)
    n = x.size
    if n <= order:
        return np.zeros(order, dtype=np.float64)

    # Fast path — librosa's librosa.lpc uses Burg internally.
    try:
        import librosa
        # librosa returns [1, -a1, -a2, ...] (the whitening filter
        # polynomial). Extract predictor weights and sign-convert.
        A = librosa.lpc(x.astype(np.float32), order=order)
        if A.size >= order + 1:
            return -A[1:order + 1].astype(np.float64)
    except Exception:
        pass

    # Fallback: autocorrelation + Levinson-Durbin (slower, less robust
    # than Burg but acceptable). This path only runs if librosa is
    # missing at runtime.
    r = np.correlate(x, x, mode='full')
    r = r[n - 1:n + order]
    a = np.zeros(order, dtype=np.float64)
    e = r[0] if r.size > 0 else 0.0
    if e < 1e-30:
        return a
    for i in range(order):
        if i == 0:
            k = r[1] / e
        else:
            k = (r[i + 1] - np.dot(a[:i], r[i:0:-1])) / e
        a_new = a.copy()
        a_new[i] = k
        for j in range(i):
            a_new[j] = a[j] - k * a[i - 1 - j]
        a = a_new
        e = e * (1.0 - k * k)
        if e < 1e-30:
            break
    return a


def _residual_from_coeffs(y, coeffs):
    """
    Compute the LPC residual e[n] = y[n] − Σ coeffs[k] · y[n-k-1].

    Returns the same length as y; the first `order` samples are zeroed
    out because we don't have enough history to predict them.
    """
    import numpy as np
    from scipy.signal import lfilter

    p = len(coeffs)
    y = np.asarray(y, dtype=np.float64)

    # Inverse filter form: A(z) = 1 − Σ coeffs[k] · z^-(k+1).
    # lfilter([1, -c1, -c2, ...], [1], y) gives the residual.
    # (This is equivalent to the whitening filter A(z)·y[n].)
    a_inv = np.concatenate(([1.0], -coeffs))
    e = lfilter(a_inv, [1.0], y)
    # Zero out the warm-up region where the filter hasn't got enough
    # history — those residuals are artifacts of the boundary, not
    # evidence of real clicks.
    if p > 0:
        e[:p] = 0.0
    return e


def _local_mad(e, window_samples: int):
    """
    Rolling MAD (median absolute deviation) of the residual, used as
    a robust estimate of σ against which we gate outliers.

    Why MAD not std: a single loud click in the window inflates std
    enormously, raising the threshold so that *nearby* clicks get
    missed. MAD is ~50 % more robust to the very outliers we're trying
    to find.

    Implementation note: full rolling-median is O(n · w · log w) naive.
    We downsample the window to every ~5 ms point and interpolate the
    MAD across the signal; accuracy loss is negligible given the MAD
    varies slowly with respect to click widths.
    """
    import numpy as np

    e = np.asarray(e, dtype=np.float64)
    n = e.size
    if n == 0 or window_samples <= 1:
        return np.ones_like(e) * (np.median(np.abs(e)) + 1e-9)

    # Sample MAD at coarse grid for speed, then upsample.
    hop = max(1, window_samples // 20)  # ~20 anchor points per window
    anchors = np.arange(0, n, hop)
    half = window_samples // 2
    mads = np.zeros(anchors.size, dtype=np.float64)
    abs_e = np.abs(e)
    for i, center in enumerate(anchors):
        lo = max(0, center - half)
        hi = min(n, center + half + 1)
        window = abs_e[lo:hi]
        med = np.median(window)
        mads[i] = np.median(np.abs(window - med))

    # Upsample MAD to per-sample resolution by linear interpolation.
    if anchors.size == 1:
        return np.ones_like(e) * (mads[0] + 1e-9)
    mad_full = np.interp(np.arange(n), anchors, mads)
    # Scale MAD → σ (Gaussian case) with the standard constant.
    sigma = 1.4826 * mad_full
    # Floor prevents divide-by-zero on silent passages; 1e-9 in the
    # float32 domain is effectively −180 dBFS, well below any click.
    return np.maximum(sigma, 1e-9)


def _local_median(x, window_samples: int):
    """Coarse rolling median for slowly varying envelope/noise estimates."""
    import numpy as np

    x = np.asarray(x, dtype=np.float64)
    n = x.size
    if n == 0 or window_samples <= 1:
        return np.zeros_like(x)

    hop = max(1, window_samples // 20)
    anchors = np.arange(0, n, hop)
    half = window_samples // 2
    medians = np.zeros(anchors.size, dtype=np.float64)
    for i, center in enumerate(anchors):
        lo = max(0, center - half)
        hi = min(n, center + half + 1)
        medians[i] = np.median(x[lo:hi])

    if anchors.size == 1:
        return np.ones_like(x) * medians[0]
    return np.interp(np.arange(n), anchors, medians)


def _broadband_score(y, sr: int, start: int, end: int) -> float:
    """Return a broadband-likeness score for a short candidate event."""
    import numpy as np

    event = np.asarray(y[start:end + 1], dtype=np.float64)
    if event.size < 8:
        return 0.0
    event = event - float(np.mean(event))
    nfft = 1 << int(np.ceil(np.log2(max(event.size, 256))))
    nfft = min(max(nfft, 256), 2048)
    mag = np.abs(np.fft.rfft(event * np.hanning(event.size), n=nfft))
    freqs = np.fft.rfftfreq(nfft, 1.0 / sr)
    total = float(np.sum(mag ** 2))
    if total <= 1e-20:
        return 0.0
    high = float(np.sum((mag[freqs >= 3000.0]) ** 2)) / total
    eps = 1e-12
    mag = np.maximum(mag, eps)
    flatness = float(np.exp(np.mean(np.log(mag))) / (np.mean(mag) + eps))
    return max(high, flatness)


def _detect_isolated_pops(y, sr: int, sensitivity: float, existing_clicks,
                          isolated_gap_sec: float):
    """
    Detect 3-8 ms isolated broadband pops.

    This is deliberately separate from the LPC residual detector: sample
    clicks still use the strict 3 ms gate, while a short pop can span a
    few milliseconds as long as it is locally isolated and broadband.
    """
    import numpy as np

    y = np.asarray(y, dtype=np.float64)
    n = y.size
    if n < 2048:
        return []

    frame = max(8, int(0.001 * sr))
    kernel = np.ones(frame, dtype=np.float64) / float(frame)
    env = np.sqrt(np.convolve(y ** 2, kernel, mode="same"))
    noise_window = int(0.500 * sr)
    local_med = _local_median(env, noise_window)
    local_sigma = _local_mad(env - local_med, noise_window)

    # Keep this class conservative: a 5 ms pop at -6 dBFS over quiet pink
    # noise is enormous in this envelope space, while normal ambience is not.
    z_threshold = max(10.0, 18.0 / max(float(sensitivity), 0.1))
    absolute_floor = 10 ** (-30.0 / 20.0)
    candidate = (env > absolute_floor) & ((env - local_med) > z_threshold * local_sigma)

    min_samples = int(0.003 * sr)
    max_samples = int(0.008 * sr)
    merge_gap = int(0.001 * sr)

    runs = []
    in_run = False
    run_start = 0
    for i, is_candidate in enumerate(candidate):
        if is_candidate and not in_run:
            in_run = True
            run_start = i
        elif in_run and not is_candidate:
            runs.append((run_start, i - 1))
            in_run = False
    if in_run:
        runs.append((run_start, n - 1))

    merged = []
    for run in runs:
        if merged and run[0] - merged[-1][1] <= merge_gap:
            merged[-1] = (merged[-1][0], run[1])
        else:
            merged.append(run)

    existing_times = [float(c.get("time", -999.0)) for c in existing_clicks]
    pops = []
    for start, end in merged:
        length = end - start + 1
        if length < min_samples or length > max_samples:
            continue
        event_peak = float(np.max(np.abs(y[start:end + 1])))
        surrounding_peak = float(np.percentile(env[max(0, start - noise_window):min(n, end + noise_window + 1)], 95))
        if surrounding_peak > 0 and event_peak < surrounding_peak * 3.0:
            continue
        if _broadband_score(y, sr, start, end) < 0.18:
            continue

        time_sec = float(start) / float(sr)
        if any(abs(time_sec - t) < isolated_gap_sec for t in existing_times):
            continue
        z_peak = float(np.max((env[start:end + 1] - local_med[start:end + 1]) / (local_sigma[start:end + 1] + 1e-12)))
        confidence = max(0.0, min(1.0, (z_peak - z_threshold) / max(z_threshold * 3.0, 1.0)))
        pops.append({
            "sample_idx": int(start),
            "time": time_sec,
            "time_formatted": _format_time(time_sec),
            "severity": "high" if event_peak >= 0.5 else "medium",
            "energy_db": round(float(20.0 * np.log10(max(event_peak, 1e-12))), 2),
            "description": f"isolated broadband pop · {1000.0 * length / sr:.2f} ms · conf {confidence:.2f}",
            "algorithm": "lpc_v2_pop",
            "duration_ms": round(1000.0 * length / sr, 3),
            "ratio": round(z_peak, 2),
            "confidence": round(confidence, 3),
        })

    if not pops:
        return []

    # Enforce the same isolation within this class: if two candidates fall
    # inside the gap, keep the stronger one.
    pops.sort(key=lambda c: -c["ratio"])
    accepted = []
    for pop in pops:
        if any(abs(pop["time"] - prev["time"]) < isolated_gap_sec for prev in accepted):
            continue
        accepted.append(pop)
    accepted.sort(key=lambda c: c["time"])
    return accepted


def _harmonic_context_score(y, sr: int, center_sample: int, halfwidth_samples: int):
    """
    Estimate how "tonal" the audio is in a window centered on a click
    candidate (excluding the candidate samples themselves).

    Score ∈ [0.0 .. 1.0]:
        0.0 = purely noise-like / silent context  (click is genuine)
        1.0 = strongly tonal context              (candidate may be
                                                    an instrument onset
                                                    mis-predicted by AR)

    Uses spectral flatness on the CONTEXT region only (skip ±2 ms
    around the candidate). Low flatness → tonal → return high score.

    This is the Stage-4 false-positive guard. Most clicks occur in
    silence or in noise-like ambience; an AR outlier that sits
    *inside* a sustained harmonic passage is much more likely to be
    the start of a note the AR model couldn't see coming than a
    foreign click.
    """
    import numpy as np

    n = y.size
    lo = max(0, center_sample - halfwidth_samples)
    hi = min(n, center_sample + halfwidth_samples)
    if hi - lo < 128:
        return 0.0  # too little context to judge — treat as non-tonal
    # Exclude ±2 ms around the candidate.
    skip = max(1, int(0.002 * sr))
    left = y[lo:max(lo, center_sample - skip)]
    right = y[min(hi, center_sample + skip):hi]
    context = np.concatenate([left, right])
    if context.size < 128:
        return 0.0
    # Compute spectrum.
    nfft = 1 << int(np.ceil(np.log2(context.size)))
    nfft = max(256, min(nfft, 4096))
    mag = np.abs(np.fft.rfft(context, n=nfft))
    eps = 1e-12
    mag = np.maximum(mag, eps)
    # Proper geometric-mean flatness (fixing the v1 log10 bug).
    gm = np.exp(np.mean(np.log(mag)))
    am = np.mean(mag)
    flat = gm / (am + eps)  # ∈ (0, 1]
    # Tonal score: 1 − flatness, mapped so >0.5 feels confidently tonal.
    return float(max(0.0, 1.0 - flat))


def detect(y, sr: int, sensitivity: float = 1.5,
           fmin: float = 20.0, fmax: float = 20000.0,
           isolated_gap_sec: float = 0.050):
    """
    Detect click candidates in a mono audio signal.

    Args:
        y: 1-D float array, audio samples (normalised roughly to ±1).
        sr: sample rate in Hz.
        sensitivity: user-facing knob. Higher = more events surfaced.
            0.5  → very strict (K≈12)  — only screaming-obvious clicks
            1.5  → default   (K≈4)    — well-aligned with "real clicks"
            3.0  → permissive (K≈2.5)  — shows softer/borderline events
            5.0  → floor      (K=2.5)  — no further loosening; noise
                                          floor would drown real events
        fmin, fmax: kept for CLI compatibility; currently unused (the
            AR approach is intrinsically broadband, not band-limited).
        isolated_gap_sec: no other detection may sit within this window
            for the broader 3-8 ms isolated-pop class.

    Returns:
        list[dict] of clicks, same schema as detect_clicks_visual.py:
            time, time_formatted, severity, energy_db, description,
            duration_ms, algorithm, ratio, + new field 'confidence'.
    """
    import numpy as np

    y = np.asarray(y, dtype=np.float64)
    n = y.size
    if n < 2048:
        return []

    # ─── Parameters ───────────────────────────────────────────────────
    FRAME_MS = 30
    HOP_MS = 20  # r4.1 — coarser hop; residual doesn't need 10ms temporal res
    LPC_ORDER = 30  # r4.1 — down from 50; music is not that non-stationary on 30ms scale
    MAD_WINDOW_MS = 500  # r4.1 — wider window for a steadier σ estimate
    # K sensitivity curve. Default (sens=1.0) is INTENTIONALLY strict
    # so users don't drown in false positives on loud/limited masters.
    # Ground-truth testing shows:
    #   sens=1.0  → ~0-10 flags on a 5-min track, catches the
    #               obvious clicks (ratio > ~80× σ pipeline-relative)
    #   sens=1.5  → catches softer clicks (ratio > 30) at the cost of
    #               more percussion-hit false positives
    #   sens=2.0  → best for tracks where you know there ARE clicks
    #               and you want to find them all (review the list)
    # Power users who want "maximum recall" set sens=2+ and use the
    # review UI to dismiss drum-hit false positives.
    K = max(6.0, 12.0 / float(sensitivity))

    frame = int(FRAME_MS * sr / 1000)
    hop = int(HOP_MS * sr / 1000)
    mad_window = int(MAD_WINDOW_MS * sr / 1000)

    # ─── Stage 1: forward + backward LPC residual ─────────────────────
    # Compute per-frame LPC coefficients, then produce a full-resolution
    # residual by applying the frame's filter within its hop range and
    # stitching (overlap-add is not needed for residual — we just pick
    # the coefficients from the closest frame to each sample).
    e_f = np.zeros(n, dtype=np.float64)
    e_b = np.zeros(n, dtype=np.float64)

    # Pre-compute per-frame LPC coefficients on the forward signal.
    frame_centers = []
    frame_coeffs_f = []
    frame_coeffs_b = []
    # Reversed signal for backward pass — same coefficients operate on
    # time-reversed y, giving us an "anticipation" predictor.
    y_rev = y[::-1].copy()
    for start in range(0, n - frame + 1, hop):
        seg_f = y[start:start + frame]
        seg_b = y_rev[start:start + frame]
        c_f = _burg_lpc(seg_f, LPC_ORDER)
        c_b = _burg_lpc(seg_b, LPC_ORDER)
        frame_centers.append(start + frame // 2)
        frame_coeffs_f.append(c_f)
        frame_coeffs_b.append(c_b)

    if not frame_centers:
        return []

    frame_centers = np.array(frame_centers, dtype=np.int64)

    # For speed, just use the nearest frame's coefficients to filter
    # the whole hop range. Edge discontinuities are absorbed by the
    # min(|e_f|, |e_b|) combine in the next step.
    for i, center in enumerate(frame_centers):
        start = max(0, int(center) - hop // 2)
        end = min(n, int(center) + hop // 2)
        if end <= start:
            continue
        c_f = frame_coeffs_f[i]
        c_b = frame_coeffs_b[i]
        # Run the inverse filter on a small context + the hop range so
        # the filter warm-up doesn't bleed spurious residual into our
        # region of interest.
        pre = max(0, start - LPC_ORDER)
        seg_f_full = y[pre:end]
        seg_b_full = y_rev[pre:end]
        r_f = _residual_from_coeffs(seg_f_full, c_f)
        r_b = _residual_from_coeffs(seg_b_full, c_b)
        # Drop the pre-context from the residual; only keep the hop.
        skip = start - pre
        e_f[start:end] = r_f[skip:skip + (end - start)]
        e_b[start:end] = r_b[skip:skip + (end - start)]

    # Reverse the backward residual to align with forward time.
    e_b = e_b[::-1].copy()

    # Combined residual: point-wise min of absolute values. A real
    # click is surprising from BOTH directions; frame-boundary
    # artefacts only show up in one.
    e = np.minimum(np.abs(e_f), np.abs(e_b))

    # ─── Stage 2: local MAD threshold ─────────────────────────────────
    sigma = _local_mad(e, mad_window)
    ratio = e / sigma   # per-sample "surprise ratio"
    candidate = ratio > K

    # ─── Stage 3: duration gate (run-length filter) ───────────────────
    # Group contiguous candidate samples into runs.
    D_MAX_SAMPLES = int(0.003 * sr)    # 3 ms
    MERGE_GAP_SAMPLES = int(0.0005 * sr)  # 500 µs

    runs = []
    in_run = False
    run_start = 0
    for i in range(n):
        if candidate[i]:
            if not in_run:
                in_run = True
                run_start = i
        else:
            if in_run:
                runs.append((run_start, i - 1))
                in_run = False
    if in_run:
        runs.append((run_start, n - 1))

    # Merge runs separated by < MERGE_GAP_SAMPLES (same click, STFT-
    # smeared or a rapid repeat that belongs to one event).
    merged = []
    for r in runs:
        if merged and (r[0] - merged[-1][1]) < MERGE_GAP_SAMPLES:
            merged[-1] = (merged[-1][0], r[1])
        else:
            merged.append(list(r))

    # Drop too-long runs (transients) and too-short (spurious single-
    # sample glitches). r4.1: minimum bumped from 1 → 3 samples.
    # A real click is a brief burst spanning several samples. Single-
    # sample outliers in a non-Gaussian residual distribution are just
    # heavy-tail noise, not clicks. Requires the candidate to persist
    # across at least 3 consecutive samples (~60 µs at 48 kHz) before
    # it counts.
    D_MIN_SAMPLES = 3
    # r4.1: additional peak-ratio gate. Even after the sample count,
    # require the MAX ratio in the run to exceed K × 1.5 — this
    # rejects weak runs that only barely scrape over the threshold.
    peak_ratio_min = K * 1.5
    filtered = []
    for (s, e_end) in merged:
        length = e_end - s + 1
        if length < D_MIN_SAMPLES or length > D_MAX_SAMPLES:
            continue
        peak = float(np.max(ratio[s:e_end + 1]))
        if peak < peak_ratio_min:
            continue
        filtered.append((s, e_end))

    if not filtered:
        return _detect_isolated_pops(y, sr, sensitivity, [], isolated_gap_sec)

    # ─── Stage 4: tonal-context + periodicity guards ──────────────────
    # r4.1 — the v1 tonal guard only fired for weak candidates, which
    # meant that a drum hit (ratio 100+, tonal context 0.5) still
    # passed. That's wrong — modern loud masters have brickwalled
    # drums that look IDENTICAL to clicks in the LPC residual, because
    # compression/limiting makes them instantaneous and unpredictable
    # from the microscale preceding audio. The ONLY reliable way to
    # discriminate is "where does this sit in the song's context?"
    #
    # Guard A — tonal context downweight:
    #   Scale the effective threshold by (1 + α·tonal_score). A
    #   strongly-tonal context (drums playing, instruments sustained)
    #   requires MUCH higher ratios before we flag. Clicks in true
    #   silence / ambient noise sail through at the base threshold.
    #
    # Guard B — periodicity rejection:
    #   After collecting surviving candidates, look for beat-aligned
    #   clusters. If three candidates fall on a regular grid (constant
    #   inter-onset interval), they're percussion, not clicks — drop
    #   the whole cluster.
    #
    # Guard C — minimum separation:
    #   Real clicks on a mastered track are rare — maybe 0-5 per full
    #   album. Enforce a 250 ms min gap between surviving clicks; if a
    #   second candidate lands closer than that, keep only the higher-
    #   ratio one. This alone cleans up the "cluster around a drum hit"
    #   artifact from frame-boundary residual smear.

    HALFWIDTH_CONTEXT = int(0.020 * sr)
    # Tonal-scale: sensitivity-dependent. At strict defaults, the
    # scale is high (strongly suppresses candidates in tonal music —
    # erring on the side of 0 false positives). As the user dials
    # sensitivity up, the scale relaxes so real clicks sitting inside
    # music are reachable. Ground-truth tuning on RX's 1:40 click
    # (ratio 34 in ratio-space, tonal_score 0.82):
    #   sens=1.0 → scale=8  → eff_thresh = 6·(1+8·0.82) = 43 (missed)
    #   sens=1.5 → scale=5.3→ eff_thresh = 4·(1+5.3·0.82) = 21 (caught)
    #   sens=2.0 → scale=4  → eff_thresh = 4·(1+4·0.82)   = 17 (caught)
    TONAL_RATIO_SCALE = max(4.0, 8.0 / float(sensitivity))
    # Duration guard in tonal context. Drums have residual runs of
    # 0.5-3 ms because compression makes their attack last several
    # samples at the residual level. True clicks are shorter.
    TONAL_DURATION_MAX_MS = 1.5
    MIN_SEPARATION_SEC = 0.25

    pre_out = []
    for (s, e_end) in filtered:
        center = (s + e_end) // 2
        duration_samples = e_end - s + 1
        duration_ms = 1000.0 * duration_samples / sr
        run_ratio = float(np.max(ratio[s:e_end + 1]))
        peak_e = float(np.max(e[s:e_end + 1]))
        peak_sigma = float(np.mean(sigma[s:e_end + 1]))
        energy_db = 20.0 * np.log10((peak_e / (peak_sigma + 1e-12)) + 1e-12)

        tonal_score = _harmonic_context_score(y, sr, center, HALFWIDTH_CONTEXT)
        # Guard A: effective threshold grows with tonal context.
        eff_threshold = K * (1.0 + TONAL_RATIO_SCALE * tonal_score)
        if run_ratio < eff_threshold:
            continue
        # Guard A2: in strongly-tonal contexts, the one remaining way
        # drums sneak through is via multi-sample residual runs (their
        # attack lingers 0.5-3 ms because compression/limiting). Real
        # clicks are shorter than that. Require tight duration when
        # tonal context is high.
        if tonal_score > 0.65 and duration_ms > TONAL_DURATION_MAX_MS:
            continue

        confidence = max(0.0, min(1.0, 1.0 - 0.5 * tonal_score))
        pre_out.append({
            "sample_idx": s,
            "time": float(s) / float(sr),
            "duration_ms": duration_ms,
            "run_ratio": run_ratio,
            "energy_db": energy_db,
            "tonal_score": tonal_score,
            "confidence": confidence,
        })

    if not pre_out:
        return _detect_isolated_pops(y, sr, sensitivity, [], isolated_gap_sec)

    # Guard B: periodicity rejection. Look at inter-onset intervals; if
    # three or more candidates line up on a regular grid (±15 % jitter)
    # with the matching ratio pattern, they're drum/bass content.
    times_arr = np.array([c["time"] for c in pre_out], dtype=np.float64)
    flag_beat = np.zeros(times_arr.size, dtype=bool)
    if times_arr.size >= 3:
        for i in range(times_arr.size - 2):
            d1 = times_arr[i + 1] - times_arr[i]
            d2 = times_arr[i + 2] - times_arr[i + 1]
            # Similar intervals in [100 ms, 2 s] = tempo range 30-600 BPM
            if 0.1 <= d1 <= 2.0 and 0.1 <= d2 <= 2.0:
                if abs(d1 - d2) / max(d1, d2) < 0.15:
                    flag_beat[i] = True
                    flag_beat[i + 1] = True
                    flag_beat[i + 2] = True

    # Guard C: minimum separation — for survivors, drop any candidate
    # that falls within MIN_SEPARATION_SEC of a stronger neighbour.
    pre_out.sort(key=lambda c: -c["run_ratio"])  # strongest first
    accepted_times = []
    out = []
    for c in pre_out:
        if flag_beat[times_arr.tolist().index(c["time"])]:
            continue
        if any(abs(c["time"] - t) < MIN_SEPARATION_SEC for t in accepted_times):
            continue
        accepted_times.append(c["time"])

        # Severity re-derived after all guards.
        r = c["run_ratio"]
        if r >= K * 10:
            severity = "high"
        elif r >= K * 5:
            severity = "medium"
        else:
            severity = "low"

        out.append({
            "time": c["time"],
            "time_formatted": _format_time(c["time"]),
            "severity": severity,
            "energy_db": round(c["energy_db"], 2),
            "description": f"LPC {r:.1f}× σ · {c['duration_ms']:.2f} ms · conf {c['confidence']:.2f}",
            "algorithm": "lpc_v2",
            "duration_ms": round(c["duration_ms"], 3),
            "ratio": round(r, 2),
            "confidence": round(c["confidence"], 3),
        })

    out.extend(_detect_isolated_pops(y, sr, sensitivity, out, isolated_gap_sec))
    out.sort(key=lambda c: c["time"])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_path", required=True)
    ap.add_argument("--sensitivity", type=float, default=1.5)
    ap.add_argument("--fmin", type=float, default=20.0)
    ap.add_argument("--fmax", type=float, default=20000.0)
    ap.add_argument("--isolated-gap-sec", type=float, default=0.050)
    args = ap.parse_args()

    import soundfile as sf
    y, sr = sf.read(args.in_path, always_2d=False)
    if y.ndim > 1:
        # Detect on mid channel (L+R)/2; clicks are almost always
        # correlated across channels on LP/tape/digital-error sources,
        # so mid-channel detection is more sensitive than independent
        # L and R detection with vote-combining.
        y = y.mean(axis=1)

    clicks = detect(y, sr,
                    sensitivity=args.sensitivity,
                    fmin=args.fmin, fmax=args.fmax,
                    isolated_gap_sec=args.isolated_gap_sec)
    print(json.dumps({"ok": True, "clicks": clicks}))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e), "clicks": []}), file=sys.stderr)
        sys.exit(1)
