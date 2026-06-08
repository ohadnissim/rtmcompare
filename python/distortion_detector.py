"""
Distortion detection — STRICT mode.

Only flags real problems that would be audible:
- Clipping: consecutive samples at ceiling (not just occasional peaks)
- True peaks: significant inter-sample overs (not just 0.1 dB over)
- Over-limiting: large flat sections (not normal mastering compression)
- Harmonic distortion: significant new harmonics (not subtle saturation)
"""

import numpy as np
import librosa
from scipy.signal import resample_poly


def detect_distortion(path_a: str, path_b: str, sr: int = None) -> dict:
    """Analyze both files for distortion, strict thresholds."""
    y_a, _ = librosa.load(path_a, sr=sr, mono=False)
    y_b, _ = librosa.load(path_b, sr=sr, mono=False)

    if y_a.ndim == 1:
        y_a = np.stack([y_a, y_a])
    if y_b.ndim == 1:
        y_b = np.stack([y_b, y_b])

    min_len = min(y_a.shape[1], y_b.shape[1])
    y_a = y_a[:, :min_len]
    y_b = y_b[:, :min_len]

    mono_a = librosa.to_mono(y_a)
    mono_b = librosa.to_mono(y_b)

    clipping = detect_clipping(mono_a, mono_b, sr)
    # CRIT-9 fix: pass the stereo arrays so detect_true_peaks measures per-channel
    # (worst-case across L and R) as required by BS.1770-4 Annex 2.  The mono
    # downmix was averaging L+R which could miss a one-channel clip.
    true_peaks = detect_true_peaks(mono_a, mono_b, sr, stereo_a=y_a, stereo_b=y_b)
    limiting = detect_over_limiting(mono_a, mono_b, sr)
    harmonics = detect_harmonic_distortion(mono_a, mono_b, sr)

    # Build issues list — STRICT thresholds
    issues = []
    severity = "clean"

    # Clipping: only flag if there are MANY consecutive clipped samples
    new_clips = clipping["b_clip_count"] - clipping["a_clip_count"]
    if new_clips > 50:  # was 5 — way too sensitive
        issues.append(f"{new_clips} new clipped samples in File B")
        severity = "warning" if new_clips < 500 else "problem"

    # True peaks: only flag if significantly over 0 dBTP
    if true_peaks["b_true_peak_db"] > 0.5:  # was 0.0 — minor overs are normal
        issues.append(f"True peak at {true_peaks['b_true_peak_db']:.1f} dBTP — exceeds 0 dBTP")
        if severity == "clean":
            severity = "warning"

    # Over-limiting: only flag if really squashed
    if limiting["b_flat_pct"] > 5.0 and limiting["b_flat_pct"] > limiting["a_flat_pct"] + 3.0:
        issues.append(
            f"Over-limiting: {limiting['b_flat_pct']:.1f}% flat waveform (was {limiting['a_flat_pct']:.1f}%)"
        )
        if limiting["b_flat_pct"] > 10.0:
            severity = "problem"
        elif severity == "clean":
            severity = "warning"

    # 5.3.1: this is an HF-energy-ratio probe, not real THD. A bright
    # master can trip it without any harmonic distortion. We keep the
    # check (it does correlate with audible saturation in practice) but
    # the user-facing language no longer claims THD.
    if harmonics["hf_energy_ratio_increase_pct"] > 15.0:
        issues.append(
            f"High-frequency energy increased by {harmonics['hf_energy_ratio_increase_pct']:.1f}% — "
            f"could be saturation, exciter, or a brighter EQ. A/B against the source to confirm."
        )
        if severity == "clean":
            severity = "warning"

    if not issues:
        issues.append("No significant distortion detected — File B is clean")

    # Recommendations — only for real problems
    recommendations = []
    if new_clips > 50:
        recommendations.append("Pull back the limiter output ceiling by 0.3–0.5 dB to eliminate clipping")
    if true_peaks["b_true_peak_db"] > 0.5:
        recommendations.append("Enable true-peak limiting (set ceiling to -1.0 dBTP)")
    if limiting["b_flat_pct"] > 5.0:
        recommendations.append("Ease off the limiter — try less gain reduction or a slower release")
    if harmonics["hf_energy_ratio_increase_pct"] > 15.0:
        recommendations.append(
            "HF energy is up — could be saturator/exciter or just a brighter EQ. "
            "A/B against the source to tell which."
        )

    # Confidence — how strong is the evidence?  The panel review (Marek)
    # correctly flagged that THD-increase and flat-waveform % are crude
    # proxies: saturation is often intentional, brick-wall limiting
    # *should* have flat sections.  So we split severity from confidence
    # and let the UI down-weight low-confidence findings instead of
    # pretending the traffic light is authoritative.
    #   high   → direct evidence (actual clipped-sample runs, TP > 0.5 dB)
    #   medium → large flat % (strong hint but could be limiter-by-design)
    #   low    → THD-only flags (saturation is routinely intentional)
    if new_clips > 50 or true_peaks["b_true_peak_db"] > 0.5:
        confidence = "high"
    elif limiting["b_flat_pct"] > 5.0:
        confidence = "medium"
    elif harmonics["hf_energy_ratio_increase_pct"] > 15.0:
        confidence = "low"  # HF-ratio is the weakest proxy; brightness ≠ distortion
    else:
        confidence = "high"  # "clean" verdict is itself high-confidence

    return {
        "severity": severity,
        "confidence": confidence,
        "issues": issues,
        "recommendations": recommendations,
        "clipping": clipping,
        "true_peaks": true_peaks,
        "limiting": limiting,
        "harmonics": harmonics,
    }


def detect_distortion_single(path: str, sr: int = None) -> dict:
    """Analyze a single file for distortion (for reference-only scan)."""
    y, _ = librosa.load(path, sr=sr, mono=True)

    # Clipping — only count runs of 3+ consecutive samples at ceiling
    clip_count = _count_clip_regions(y, threshold=0.9995, min_consecutive=3)
    clip_pct = round(clip_count / max(len(y), 1) * 100, 4)

    # True peak via 4× oversampling per BS.1770-4 Annex 2. Use soxr when
    # available (±0.02 dBTP); fall back to resample_poly.
    try:
        import soxr as _soxr_dd
        up = _soxr_dd.resample(y.astype(np.float64), sr or 44100, (sr or 44100) * 4, quality='HQ')
    except ImportError:
        up = resample_poly(y, 4, 1)
    true_peak_db = round(float(20 * np.log10(max(np.max(np.abs(up)), 1e-10))), 1)
    over_count = int(np.sum(np.abs(up) > 1.0))
    try:
        from rtm_fast import true_peak_dbtp as _fast_tp
        fast_tp = _fast_tp(y)
        # The scipy-vs-rtm_fast cross-check is a developer instrument:
        # we only care about drift in the delivery-relevant range
        # (signals near 0 dBTP, where a 0.5 dB error matters for
        # streaming preview / TP-over alarms). On near-silence and
        # heavily attenuated signals (anti-phase, mono-summed, etc.),
        # rtm_fast's lack of an `1e-10` floor returns -inf where scipy
        # returns -200, producing noise that is not actionable.
        # Only emit when:
        #   • RTM_DEBUG_TP_DRIFT is set (developer opt-in), OR
        #   • both estimates land in delivery range (above -30 dBTP)
        #     AND drift exceeds 0.5 dB.
        import os as _os
        debug_tp = _os.environ.get("RTM_DEBUG_TP_DRIFT") == "1"
        drifted = np.isfinite(fast_tp) and abs(fast_tp - true_peak_db) > 0.5
        if drifted and debug_tp:
            import sys as _sys
            _sys.stderr.write(
                f"[distortion_detector] TP drift: scipy={true_peak_db:.2f} "
                f"fast={fast_tp:.2f} dBTP (investigate if this persists)\n"
            )
    except Exception:
        # rtm_fast is optional — a dev environment without numba will
        # still work, just without the fast-path cross-check.
        pass

    # Over-limiting
    flat_samples = count_flat_sections(y, sr)
    flat_pct = round(flat_samples / max(len(y), 1) * 100, 2)

    # Build result
    issues = []
    severity = "clean"

    if clip_count > 50:
        issues.append(f"{clip_count} clipped samples detected")
        severity = "warning" if clip_count < 500 else "problem"

    if true_peak_db > 0.0:
        issues.append(f"True peak at {true_peak_db} dBTP — exceeds 0 dBTP")
        if severity == "clean":
            severity = "warning"

    if flat_pct > 5.0:
        issues.append(f"Over-limiting: {flat_pct:.1f}% flat waveform")
        if flat_pct > 10.0:
            severity = "problem"
        elif severity == "clean":
            severity = "warning"

    if not issues:
        issues.append("No distortion detected — file is clean")

    recommendations = []
    if clip_count > 50:
        recommendations.append("Pull back the limiter ceiling by 0.3–0.5 dB")
    if true_peak_db > 0.0:
        recommendations.append("Enable true-peak limiting (set ceiling to -1.0 dBTP)")
    if flat_pct > 5.0:
        recommendations.append("Ease off the limiter — less gain reduction or slower release")

    # Same confidence rubric as the comparative path — see detect_distortion.
    if clip_count > 50 or true_peak_db > 0.5:
        confidence = "high"
    elif flat_pct > 5.0:
        confidence = "medium"
    else:
        confidence = "high"

    return {
        "severity": severity,
        "confidence": confidence,
        "issues": issues,
        "recommendations": recommendations,
        "clipping": {
            "a_clip_count": 0, "b_clip_count": clip_count,
            "a_clip_pct": 0, "b_clip_pct": clip_pct,
        },
        "true_peaks": {
            "a_true_peak_db": 0, "b_true_peak_db": true_peak_db,
            "a_over_count": 0, "b_over_count": over_count,
        },
        "limiting": {
            "a_flat_pct": 0, "b_flat_pct": flat_pct,
        },
        "harmonics": {
            "thd_increase_pct": 0,
        },
    }


def detect_clipping(mono_a: np.ndarray, mono_b: np.ndarray,
                    sr: int, threshold: float = 0.9995) -> dict:
    """
    Count clipped regions — 3+ consecutive samples at the digital ceiling.
    Single samples near the ceiling are normal for mastered music.
    """
    a_clips = _count_clip_regions(mono_a, threshold)
    b_clips = _count_clip_regions(mono_b, threshold)

    return {
        "a_clip_count": a_clips,
        "b_clip_count": b_clips,
        "a_clip_pct": round(a_clips / max(len(mono_a), 1) * 100, 4),
        "b_clip_pct": round(b_clips / max(len(mono_b), 1) * 100, 4),
    }


def _count_clip_regions(y, threshold=0.9995, min_consecutive=3):
    """Count samples in clipped regions (3+ consecutive at ceiling)."""
    above = np.abs(y) >= threshold
    count = 0
    run = 0
    for i in range(len(above)):
        if above[i]:
            run += 1
        else:
            if run >= min_consecutive:
                count += run
            run = 0
    if run >= min_consecutive:
        count += run
    return count


def detect_true_peaks(mono_a: np.ndarray, mono_b: np.ndarray,
                      sr: int, oversample: int = 4,
                      stereo_a: np.ndarray | None = None,
                      stereo_b: np.ndarray | None = None) -> dict:
    """Detect inter-sample peaks by 4× polyphase oversampling.

    CRIT-9 fix: BS.1770-4 Annex 2 requires per-channel true peak then
    worst-case across channels.  The previous implementation measured only
    the mono downmix, which averages L+R and can miss a one-channel clip
    (e.g. a limiter hitting only one side, or a mid/side asymmetry).
    When stereo arrays are supplied they are preferred; otherwise we fall
    back to the passed mono signal (backwards-compatible for single-channel
    material or callers that only have mono data available).
    """
    def _oversample(ch: np.ndarray) -> np.ndarray:
        """Oversample one channel. soxr HQ (±0.02 dBTP) is the primary path —
        the suite-wide TP engine; resample_poly only as fallback. (Previously
        this used resample_poly unconditionally, which the codebase itself
        condemns for ±0.3–0.5 dBTP Gibbs overread and disagreed with the soxr
        paths elsewhere by up to 0.5 dB — inside the flag threshold.)"""
        try:
            import soxr
            return soxr.resample(ch.astype(np.float64), sr or 44100,
                                 (sr or 44100) * oversample, quality='HQ')
        except Exception:
            return resample_poly(ch.astype(np.float64), oversample, 1)

    def _tp_db(arrays: list[np.ndarray]) -> tuple[float, int]:
        """Worst-case true peak dBTP + over-count across a list of channels."""
        worst_amp = 0.0
        over_cnt = 0
        for ch in arrays:
            up = _oversample(ch)
            worst_amp = max(worst_amp, float(np.max(np.abs(up))))
            over_cnt += int(np.sum(np.abs(up) > 1.0))
        return float(20 * np.log10(max(worst_amp, 1e-10))), over_cnt

    channels_a: list[np.ndarray]
    channels_b: list[np.ndarray]
    if stereo_a is not None and stereo_a.ndim == 2 and stereo_a.shape[0] >= 2:
        channels_a = [stereo_a[c] for c in range(stereo_a.shape[0])]
    else:
        channels_a = [mono_a]
    if stereo_b is not None and stereo_b.ndim == 2 and stereo_b.shape[0] >= 2:
        channels_b = [stereo_b[c] for c in range(stereo_b.shape[0])]
    else:
        channels_b = [mono_b]

    tp_a, over_a = _tp_db(channels_a)
    tp_b, over_b = _tp_db(channels_b)

    return {
        "a_true_peak_db": round(tp_a, 1),
        "b_true_peak_db": round(tp_b, 1),
        "a_over_count": over_a,
        "b_over_count": over_b,
    }


def detect_over_limiting(mono_a: np.ndarray, mono_b: np.ndarray,
                         sr: int) -> dict:
    """Detect flat-top waveforms from heavy limiting."""
    flat_a = count_flat_sections(mono_a, sr)
    flat_b = count_flat_sections(mono_b, sr)
    total = max(len(mono_a), 1)

    return {
        "a_flat_samples": flat_a,
        "b_flat_samples": flat_b,
        "a_flat_pct": round(flat_a / total * 100, 2),
        "b_flat_pct": round(flat_b / total * 100, 2),
    }


def count_flat_sections(y: np.ndarray, sr: int) -> int:
    """Count samples in flat (over-limited) sections.
    A flat section: 3+ consecutive samples with nearly identical values
    AND near the peak level of the signal."""
    if len(y) == 0:
        return 0
    peak = np.max(np.abs(y))
    if peak < 0.1:
        return 0

    high_thresh = peak * 0.98  # must be very near peak
    flat_count = 0
    window = max(1, int(sr * 0.001))  # MED-13: 1ms window (was 2ms — too coarse for modern limiters)

    for i in range(0, len(y) - window, window):
        chunk = y[i:i + window]
        abs_chunk = np.abs(chunk)

        # Must be near peak AND have very low variance
        if np.mean(abs_chunk) < high_thresh:
            continue
        if np.var(chunk) > 0.0001:  # tighter than before (was 0.001)
            continue

        flat_count += window

    return flat_count


def detect_harmonic_distortion(mono_a: np.ndarray, mono_b: np.ndarray,
                               sr: int) -> dict:
    """Estimate THD increase comparing upper harmonics."""
    start = len(mono_a) // 4
    end = start + min(sr * 5, len(mono_a) // 2)
    a_seg = mono_a[start:end]
    b_seg = mono_b[start:end]

    n_fft = 4096
    spec_a = np.abs(librosa.stft(a_seg, n_fft=n_fft))
    spec_b = np.abs(librosa.stft(b_seg, n_fft=n_fft))

    avg_a = np.mean(spec_a, axis=1)
    avg_b = np.mean(spec_b, axis=1)

    avg_a = avg_a / (np.max(avg_a) + 1e-10)
    avg_b = avg_b / (np.max(avg_b) + 1e-10)

    # 5.3.1 honesty fix: this is HF energy ratio of the upper-quarter
    # spectrum — NOT THD. Pre-5.3 we labelled it `thd_increase_pct`
    # and the UI strings called it "harmonic distortion" — both lies.
    # A bright master with a tilted EQ would trip this ratio without
    # any actual harmonic distortion present. Renamed; both the old
    # and new key names are emitted for one release so the UI doesn't
    # break.
    upper_start = len(avg_a) * 3 // 4
    high_a = np.mean(avg_a[upper_start:])
    high_b = np.mean(avg_b[upper_start:])

    hf_ratio_increase = max(0, (high_b - high_a) / max(high_a, 1e-10) * 100)

    return {
        "a_high_energy": round(float(high_a), 4),
        "b_high_energy": round(float(high_b), 4),
        # New canonical key. Honest name for what's measured: ratio of
        # upper-quarter HF energy in B vs A, in percent.
        "hf_energy_ratio_increase_pct": round(float(hf_ratio_increase), 1),
        # MED-15: removed thd_increase_pct legacy alias — was misleading
        # (this is HF energy ratio, not THD). Callers should use
        # hf_energy_ratio_increase_pct.
    }
