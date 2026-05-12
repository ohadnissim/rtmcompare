"""Audio analysis and comparison module with level matching and granular categories."""

import os
from datetime import datetime, timezone
import numpy as np
import librosa
import soundfile as sf
from scipy.signal import butter, sosfilt
from specs import SPECS, SPECS_VERSION, to_json as _specs_to_json


def _stamp_spec_versions(result: dict) -> dict:
    result["spec_versions"] = {
        "version": SPECS_VERSION,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "specs": _specs_to_json(),
    }
    return result


# ─── Frequency band definitions ───────────────────────────────────────────────
BANDS = {
    "sub":        (20, 80),
    "kick":       (50, 150),
    "bass":       (80, 300),
    "snare":      (150, 5000),    # analyzed from drums stem
    "vocals":     (200, 6000),    # analyzed from vocals stem
    "instruments": (200, 8000),   # analyzed from other stem
    "brightness": (3000, 10000),
    "air":        (10000, 20000),
}


# ─── Level matching ───────────────────────────────────────────────────────────

def compute_lufs(y: np.ndarray, sr: int) -> float:
    """
    Integrated loudness per ITU-R BS.1770-4.
    Uses pyloudnorm for accurate, industry-standard measurement.
    Accepts mono (1D), stereo (2, samples) or (samples, 2).
    """
    import pyloudnorm as pyln

    # Ensure (samples, channels) format for pyloudnorm
    if y.ndim == 1:
        data = y.reshape(-1, 1)
    elif y.shape[0] == 2 and y.shape[1] > 2:
        data = y.T  # (2, samples) -> (samples, 2)
    elif y.shape[1] <= 2:
        data = y  # already (samples, channels)
    else:
        data = y.reshape(-1, 1)

    try:
        meter = pyln.Meter(sr)
        loudness = meter.integrated_loudness(data)
        if loudness == float('-inf') or np.isnan(loudness):
            return -70.0
        return float(loudness)
    except Exception as e:
        # 5.3.1 honesty fix: pre-5.3 we returned an RMS estimate with a
        # `-0.691` constant tacked on, which made the value LOOK like a
        # BS.1770 LUFS reading even though it wasn't. The number then
        # flowed into the UI alongside real LUFS-I figures, with no way
        # for the caller (or the engineer) to tell which was which.
        # Now we log loudly and return the BS.1770 absolute floor —
        # UI can render this as "—" / "below floor" rather than a
        # plausible-but-wrong number.
        import logging as _lg, sys as _sys
        _lg.getLogger(__name__).warning(
            "[comparator] integrated_loudness failed (%s) — returning -70 LUFS floor.", e
        )
        _sys.stderr.write(
            f"[comparator] integrated_loudness failed: {e} — returning -70 floor (no RMS substitute).\n"
        )
        return -70.0


def _high_shelf(freq, gain_db, sr):
    """Simple high-shelf filter coefficients."""
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * freq / sr
    alpha = np.sin(w0) / 2 * np.sqrt(2)

    b0 = A * ((A + 1) + (A - 1) * np.cos(w0) + 2 * np.sqrt(A) * alpha)
    b1 = -2 * A * ((A - 1) + (A + 1) * np.cos(w0))
    b2 = A * ((A + 1) + (A - 1) * np.cos(w0) - 2 * np.sqrt(A) * alpha)
    a0 = (A + 1) - (A - 1) * np.cos(w0) + 2 * np.sqrt(A) * alpha
    a1 = 2 * ((A - 1) - (A + 1) * np.cos(w0))
    a2 = (A + 1) - (A - 1) * np.cos(w0) - 2 * np.sqrt(A) * alpha

    return np.array([b0, b1, b2]) / a0, np.array([a0, a1, a2]) / a0


def level_match(y_a: np.ndarray, y_b: np.ndarray, sr: int):
    """
    Level-match file B to file A using LUFS.
    Returns (y_a, y_b_matched, gain_applied_db).
    """
    mono_a = librosa.to_mono(y_a) if y_a.ndim > 1 else y_a
    mono_b = librosa.to_mono(y_b) if y_b.ndim > 1 else y_b

    lufs_a = compute_lufs(y_a, sr)
    lufs_b = compute_lufs(y_b, sr)
    diff = lufs_a - lufs_b  # how much to boost/cut B

    gain_linear = 10 ** (diff / 20)
    y_b_matched = y_b * gain_linear

    return y_a, y_b_matched, round(diff, 2)


# ─── Band isolation ───────────────────────────────────────────────────────────

def bandpass(y: np.ndarray, sr: int, low: float, high: float) -> np.ndarray:
    """Apply bandpass filter to isolate a frequency range."""
    nyq = sr / 2
    low_n = max(low / nyq, 0.001)
    high_n = min(high / nyq, 0.999)
    if low_n >= high_n:
        return np.zeros_like(y)
    sos = butter(4, [low_n, high_n], btype='band', output='sos')
    return sosfilt(sos, y)


def band_rms_db(y: np.ndarray, sr: int, low: float, high: float) -> float:
    """Get RMS level in dB for a specific frequency band."""
    filtered = bandpass(y, sr, low, high)
    rms = np.sqrt(np.mean(filtered ** 2))
    if rms < 1e-10:
        return -70.0
    return float(20 * np.log10(rms))


# ─── Transient / Punch analysis ──────────────────────────────────────────────

def compute_punch(y: np.ndarray, sr: int) -> float:
    """
    Measure 'punch' — ratio of transient energy to sustain.
    Higher = punchier (more transient snap).
    """
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    if len(onset_env) < 2:
        return 0.0
    # Punch = peak transient strength relative to mean
    peak = np.percentile(onset_env, 95)
    mean = np.mean(onset_env)
    if mean < 1e-10:
        return 0.0
    return float(peak / mean)


# ─── Stereo analysis ─────────────────────────────────────────────────────────

def compute_stereo_width(left: np.ndarray, right: np.ndarray) -> float:
    """Compute stereo width. 0=mono, 1=fully wide."""
    if len(left) == 0:
        return 0.0
    mid = left + right
    side = left - right
    mid_energy = np.mean(mid ** 2)
    side_energy = np.mean(side ** 2)
    total = mid_energy + side_energy
    if total < 1e-10:
        return 0.0
    return float(side_energy / total)


def _bs1770_k_weight(y_samples: np.ndarray, sr: int) -> np.ndarray:
    """Apply ITU-R BS.1770-4 K-weighting (pre-filter + RLB) per channel.

    Returns the K-weighted signal in the same shape as input. Used for
    a proper short-term / momentary loudness measurement that doesn't
    inherit the BS.1770 gating that `pyln.Meter.integrated_loudness`
    applies (we want EBU R128 Tech 3341 S/M, not a gated mean).

    Biquad coefficients are the standard BS.1770-4 reference (1681.97 Hz
    pre-shelf + 38.13 Hz RLB high-pass), pre-warped at the source sample
    rate. pyloudnorm uses the same numbers internally.
    """
    from scipy.signal import lfilter
    # Pre-filter (stage 1): high-shelf, fc=1681.97 Hz, gain≈+4 dB
    f0 = 1681.97
    G_db = 3.999843853973347
    Q = 0.7071752369554196
    K = np.tan(np.pi * f0 / sr)
    Vh = 10 ** (G_db / 20.0)
    Vb = Vh ** 0.4996667741545416
    a0_pre = 1.0 + K / Q + K * K
    pre_b = np.array([
        (Vh + Vb * K / Q + K * K) / a0_pre,
        2.0 * (K * K - Vh) / a0_pre,
        (Vh - Vb * K / Q + K * K) / a0_pre,
    ])
    pre_a = np.array([
        1.0,
        2.0 * (K * K - 1.0) / a0_pre,
        (1.0 - K / Q + K * K) / a0_pre,
    ])
    # RLB (stage 2): high-pass, fc=38.13 Hz, Q≈0.5
    f0r = 38.13547087613982
    Qr  = 0.5003270373253953
    Kr = np.tan(np.pi * f0r / sr)
    a0_rlb = 1.0 + Kr / Qr + Kr * Kr
    rlb_b = np.array([
        1.0 / a0_rlb,
        -2.0 / a0_rlb,
        1.0 / a0_rlb,
    ])
    rlb_a = np.array([
        1.0,
        2.0 * (Kr * Kr - 1.0) / a0_rlb,
        (1.0 - Kr / Qr + Kr * Kr) / a0_rlb,
    ])
    if y_samples.ndim == 1:
        out = lfilter(pre_b, pre_a, y_samples)
        out = lfilter(rlb_b, rlb_a, out)
        return out
    # (samples, channels)
    cols = []
    for ch in range(y_samples.shape[1]):
        s = lfilter(pre_b, pre_a, y_samples[:, ch])
        s = lfilter(rlb_b, rlb_a, s)
        cols.append(s)
    return np.stack(cols, axis=1)


def compute_short_term_max(y: np.ndarray, sr: int) -> float:
    """
    Compute maximum short-term loudness (3 s sliding window) per
    EBU R128 Tech 3341 §3 — K-weighted mean-square over the 3 s window,
    NO gating. Scans every 1 s for the loudest 3 s block.

    5.3.1 fix: pre-5.3 we called `meter.integrated_loudness(block)` per
    window, which applies BS.1770 absolute + relative gates designed
    for the integrated metric. On a near-silent window the absolute
    gate truncates to -inf, which then gets clamped to -70 — the
    answer is approximately right on busy material but wrong on
    sparse music. The corrected math here matches Tech 3341.
    """
    # Ensure (samples, channels) format
    if y.ndim == 1:
        data = y.reshape(-1, 1)
    elif y.shape[0] == 2 and y.shape[1] > 2:
        data = y.T
    elif y.shape[1] <= 2:
        data = y
    else:
        data = y.reshape(-1, 1)

    try:
        kw = _bs1770_k_weight(data, sr)
        block_samples = int(sr * 3.0)
        hop = int(sr * 1.0)
        max_st = -70.0

        # BS.1770-4 channel weights: L=R=C=1.0, Ls=Rs=1.41, LFE=0.
        ch_weights_full = np.array([1.0, 1.0, 1.0, 1.41, 1.41])
        n_ch = min(kw.shape[1], len(ch_weights_full))
        ch_weights = ch_weights_full[:n_ch]

        # `... - block_samples + 1` keeps the final valid window in scope.
        for i in range(0, len(data) - block_samples + 1, hop):
            block = kw[i:i + block_samples, :n_ch]
            mean_sq = np.mean(block ** 2, axis=0)
            weighted = float(np.sum(mean_sq * ch_weights))
            if weighted <= 0:
                continue
            st = -0.691 + 10.0 * np.log10(weighted)
            if not np.isinf(st) and not np.isnan(st) and st > max_st:
                max_st = st

        return float(max_st)
    except Exception as e:
        import sys as _sys
        _sys.stderr.write(f"[comparator] short_term_max failed: {e}\n")
        return -70.0


def compute_pan(left: np.ndarray, right: np.ndarray) -> float:
    """Compute pan position. -1=full left, 0=center, 1=full right."""
    l_rms = np.sqrt(np.mean(left ** 2))
    r_rms = np.sqrt(np.mean(right ** 2))
    total = l_rms + r_rms
    if total < 1e-10:
        return 0.0
    return float((r_rms - l_rms) / total)


STREAMING_TARGETS = [
    # Display order for the streaming preview rows. Per-platform
    # normalization behaviour (target LUFS, TP ceiling, max boost) lives
    # in `python/specs.py`; both `streaming_preview` (here) and the
    # encoded-preview renderer read it directly from SPECS so the two
    # never drift. A platform "boosts" iff its spec has a positive
    # `max_boost_db` (currently only Spotify and Spotify Loud).
    {"name": "Spotify",      "spec_id": "spotify"},
    {"name": "Apple Music",  "spec_id": "apple_music"},
    {"name": "YouTube",      "spec_id": "youtube"},
    {"name": "Tidal",        "spec_id": "tidal"},
    {"name": "Amazon Music", "spec_id": "amazon_music"},
    {"name": "Deezer",       "spec_id": "deezer"},
    {"name": "SoundCloud",   "spec_id": "soundcloud"},
]


def streaming_preview(lufs: float, true_peak: float) -> list:
    """
    Return what the track would play at on each major streaming platform,
    given its integrated LUFS and true peak. Useful for mastering decisions:
    "my -8 LUFS master will be turned down 6 dB on Spotify — am I ok with that?"
    """
    out = []
    for p in STREAMING_TARGETS:
        targets = SPECS[p["spec_id"]].targets
        lufs_target = float(targets["lufs_i"])
        true_peak_target = float(targets["tp_dbtp"])
        # Single source of truth for how much the platform may boost a
        # quiet track. 0.0 (the default) = attenuate-only.
        max_boost = float(targets.get("max_boost_db", 0.0))
        if lufs > lufs_target:
            # Platform will attenuate to meet target
            delta = lufs_target - lufs
            played_lufs = lufs_target
            played_tp = true_peak + delta  # TP moves with gain
            action = "attenuated"
        elif max_boost > 0 and lufs < lufs_target - 2:
            # Quiet enough to boost, but the boost is capped at the
            # spec's max_boost_db — so a -25 LUFS track on Spotify
            # (target -14, cap +6) plays at -19, not -14.
            boost = min(lufs_target - lufs, max_boost)
            delta = boost
            played_lufs = lufs + boost
            played_tp = min(true_peak + boost, true_peak_target)  # limited
            action = "boosted"
        else:
            played_lufs = lufs
            played_tp = true_peak
            delta = 0.0
            action = "as-is"
        # Flag: will the platform's true-peak limiter kick in after attenuation/boost?
        tp_breach = played_tp > true_peak_target
        out.append({
            "name": p["name"],
            "played_lufs": round(played_lufs, 1),
            "played_tp": round(played_tp, 1),
            "delta_db": round(delta, 1),
            "action": action,
            "tp_breach": bool(tp_breach),
            "target_lufs": lufs_target,
            "target_tp": true_peak_target,
        })
    return out


MASTERING_BAND_FREQS = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
    200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
    2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
]


def _mastering_signature(spec_diff: list[float]) -> str:
    """8-hex-char fingerprint of the rounded 31-band per-band gain delta.
    Stable across noise: values are rounded to 0.5 dB before hashing."""
    import hashlib
    rounded = [round(v * 2) / 2 for v in spec_diff]
    payload = ",".join(f"{v:.1f}" for v in rounded).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:8]


def _band_edges(center_freq: float, sr: int) -> tuple[float, float] | None:
    nyq = sr / 2
    low = max(center_freq / (2 ** (1 / 6)), 10)
    high = min(center_freq * (2 ** (1 / 6)), nyq - 1)
    if low >= high:
        return None
    return low / nyq, high / nyq


def _bandpass_center(y: np.ndarray, sr: int, center_freq: float) -> np.ndarray:
    edges = _band_edges(center_freq, sr)
    if edges is None:
        return np.zeros_like(y)
    low_n, high_n = edges
    if low_n >= high_n or high_n >= 1.0:
        return np.zeros_like(y)
    sos = butter(2, [low_n, high_n], btype='band', output='sos')
    return sosfilt(sos, y)


def _third_octave_levels(y: np.ndarray, sr: int) -> list[float]:
    result = []
    for freq in MASTERING_BAND_FREQS:
        try:
            filtered = _bandpass_center(y, sr, freq)
            rms = np.sqrt(np.mean(filtered ** 2))
            db = 20 * np.log10(max(rms, 1e-10))
            result.append(round(float(db), 1))
        except Exception:
            result.append(-60.0)
    return result


def _third_octave_widths(y_stereo: np.ndarray, sr: int) -> list[float]:
    if y_stereo.ndim == 1:
        y_stereo = np.stack([y_stereo, y_stereo])
    widths = []
    for freq in MASTERING_BAND_FREQS:
        try:
            left = _bandpass_center(y_stereo[0], sr, freq)
            right = _bandpass_center(y_stereo[1], sr, freq)
            widths.append(round(compute_stereo_width(left, right), 3))
        except Exception:
            widths.append(0.0)
    return widths


def _true_peak_and_overs(y: np.ndarray) -> tuple[float, int]:
    from scipy.signal import resample_poly
    if y.ndim == 1:
        channels = [y]
    else:
        channels = [y[c] for c in range(min(2, y.shape[0]))]
    worst = 0.0
    events = 0
    for ch in channels:
        up = resample_poly(ch, 4, 1)
        abs_up = np.abs(up)
        worst = max(worst, float(np.max(abs_up)))
        over = abs_up > 1.0
        if over.any():
            events += int((np.diff(over.astype(np.int8), prepend=0) == 1).sum())
    tp_db = 20 * np.log10(max(worst, 1e-10))
    return round(float(tp_db), 1), events


def _crest_db(y: np.ndarray) -> float:
    mono = librosa.to_mono(y) if y.ndim > 1 else y
    rms = np.sqrt(np.mean(mono ** 2))
    peak = np.max(np.abs(mono))
    return float(20 * np.log10(max(peak, 1e-10)) - 20 * np.log10(max(rms, 1e-10)))


def _transient_density_mean(y: np.ndarray, sr: int) -> float | None:
    mono = librosa.to_mono(y) if y.ndim > 1 else y
    if len(mono) < sr:
        return None
    hop = 512
    onset_env = librosa.onset.onset_strength(y=mono, sr=sr, hop_length=hop)
    if len(onset_env) < 2:
        return None
    frames_per_sec = sr / hop
    total_secs = int(np.floor(len(mono) / sr))
    if total_secs <= 0:
        return None
    threshold = np.percentile(onset_env, 70) if len(onset_env) > 20 else 0
    densities = []
    for sec in range(total_secs):
        start = int(sec * frames_per_sec)
        end = int(min(len(onset_env), start + frames_per_sec))
        if end <= start:
            continue
        count = int(np.sum(onset_env[start:end] > threshold))
        densities.append(min(1.0, count / max(1, frames_per_sec / 2)))
    return float(np.mean(densities)) if densities else None


def _platform_key(name: str) -> str:
    return name.lower().replace("&", "and").replace(" ", "_").replace("-", "_")


def _attach_mastering_delta(result: dict, y_a: np.ndarray | None = None,
                            y_b: np.ndarray | None = None, sr: int = 44100,
                            file_a: str | None = None, file_b: str | None = None) -> dict:
    """Attach a mastering self-review delta to two-file compare results.
    Every field is best-effort so optional analyser failures do not break JSON."""
    try:
        if file_a and file_b and os.path.abspath(file_a) == os.path.abspath(file_b):
            return result
    except Exception:
        pass

    delta: dict = {}
    overall = result.get("overall") or {}
    broadband_gain = None
    tp_a = tp_b = None
    tp_overs_a = tp_overs_b = None

    try:
        broadband_gain = float(overall["lufs_b"]) - float(overall["lufs_a"])
        delta["broadband_gain_db"] = round(broadband_gain, 1)
    except Exception:
        pass

    try:
        delta["lra_delta"] = round(float(overall["dynamics_b"]) - float(overall["dynamics_a"]), 1)
    except Exception:
        pass

    try:
        # The Mastering-Delta tab answers "what changed between A and
        # B?" — broadband gain is already covered above; the per-band
        # series should answer the *tonal-shape* question, i.e. what
        # EQ move (if any) is on top of the broadband level change.
        # Subtracting the level-matched / normalised viz spectra
        # (`spectrum_a` and `spectrum_b`, both already published in
        # the result and already in dB-relative-to-band-peak form)
        # gives that shape directly. Subtracting raw third-octave
        # levels — what we used to do — duplicates broadband_gain_db
        # 31 times when A and B are flat-scaled clones of each other.
        spec_a = result.get("spectrum_a") or []
        spec_b = result.get("spectrum_b") or []
        if spec_a and spec_b and len(spec_a) == len(spec_b):
            # Use normalised viz spectra when already populated (deep
            # path / when generate_all_viz_data has run before us).
            per_band = [round(b - a, 1) for a, b in zip(spec_a, spec_b)]
        elif y_a is not None and y_b is not None:
            # Compute normalised per-band shape directly from audio so
            # the tonal-delta semantic holds even when this runs before
            # generate_all_viz_data populates result["spectrum_*"].
            # Each side is centred on its own mean band level so the
            # broadband gain (already in `broadband_gain_db`) is
            # removed from the per-band delta — leaving only the
            # tonal-shape change.
            levels_a = _third_octave_levels(librosa.to_mono(y_a) if y_a.ndim > 1 else y_a, sr)
            levels_b = _third_octave_levels(librosa.to_mono(y_b) if y_b.ndim > 1 else y_b, sr)
            mean_a = float(np.mean(levels_a)) if len(levels_a) else 0.0
            mean_b = float(np.mean(levels_b)) if len(levels_b) else 0.0
            norm_a = [v - mean_a for v in levels_a]
            norm_b = [v - mean_b for v in levels_b]
            per_band = [round(b - a, 1) for a, b in zip(norm_a, norm_b)]
        else:
            per_band = []
        if per_band:
            delta["per_band_gain_db"] = per_band
            delta["signature_hash"] = _mastering_signature(per_band)
    except Exception:
        pass

    try:
        if y_a is not None and y_b is not None:
            widths_a = _third_octave_widths(y_a, sr)
            widths_b = _third_octave_widths(y_b, sr)
            delta["stereo_width_change_per_band"] = [
                round(b - a, 3) for a, b in zip(widths_a, widths_b)
            ]
    except Exception:
        pass

    try:
        if y_a is not None and y_b is not None:
            tp_a, tp_overs_a = _true_peak_and_overs(y_a)
            tp_b, tp_overs_b = _true_peak_and_overs(y_b)
            delta["tp_overs_a"] = int(tp_overs_a)
            delta["tp_overs_b"] = int(tp_overs_b)
            delta["tp_overs_pulled_back"] = int(max(0, tp_overs_a - tp_overs_b))
    except Exception:
        pass

    try:
        headroom = result.get("headroom") or {}
        if tp_a is None and headroom.get("true_peak_a") is not None:
            tp_a = float(headroom["true_peak_a"])
        if tp_b is None and headroom.get("true_peak_b") is not None:
            tp_b = float(headroom["true_peak_b"])
        if tp_a is not None and tp_b is not None:
            st_a = overall.get("short_term_max_a")
            st_b = overall.get("short_term_max_b")
            if st_a is not None and st_b is not None:
                psr_a = tp_a - float(st_a)
                psr_b = tp_b - float(st_b)
                delta["psr_delta"] = round(psr_b - psr_a, 1)
            elif overall.get("plr_a") is not None and overall.get("plr_b") is not None:
                delta["psr_delta"] = round(float(overall["plr_b"]) - float(overall["plr_a"]), 1)
    except Exception:
        pass

    try:
        if y_a is not None and y_b is not None:
            crest_a = _crest_db(y_a)
            crest_b = _crest_db(y_b)
            crest_delta = round(crest_b - crest_a, 1)
            delta["rms_to_peak_delta"] = crest_delta
            delta["peak_to_rms_ratio_change"] = crest_delta
    except Exception:
        pass

    try:
        if y_a is not None and y_b is not None:
            dens_a = _transient_density_mean(y_a, sr)
            dens_b = _transient_density_mean(y_b, sr)
            if dens_a is not None and dens_b is not None and dens_a > 1e-6:
                delta["transient_density_change_pct"] = round(((dens_b - dens_a) / dens_a) * 100.0, 1)
    except Exception:
        pass

    try:
        if tp_a is not None and tp_b is not None and broadband_gain is not None:
            gain_reduction = max(0.0, (tp_a + broadband_gain) - tp_b)
            delta["estimated_gain_reduction_db"] = round(gain_reduction, 1)
            delta["limiter_aggressiveness"] = round(max(0.0, min(1.0, gain_reduction / 6.0)), 2)
    except Exception:
        pass

    try:
        preview = result.get("streaming_preview")
        if preview and preview.get("a") and preview.get("b"):
            rows_a = preview["a"]
            rows_b = preview["b"]
        elif tp_a is not None and tp_b is not None:
            rows_a = streaming_preview(float(overall["lufs_a"]), tp_a)
            rows_b = streaming_preview(float(overall["lufs_b"]), tp_b)
        else:
            rows_a = rows_b = []
        platform_gain = {}
        for row_a, row_b in zip(rows_a, rows_b):
            if row_a.get("name") != row_b.get("name"):
                continue
            platform_gain[_platform_key(row_a["name"])] = round(
                float(row_b["played_lufs"]) - float(row_a["played_lufs"]), 1
            )
        if platform_gain:
            delta["perceived_gain_per_platform"] = platform_gain
    except Exception:
        pass

    if delta:
        result["mastering_delta"] = delta
    return result


def compute_momentary_max(y: np.ndarray, sr: int) -> float:
    """
    EBU R128 momentary max — max K-weighted 400 ms LUFS block across the
    track per EBU R128 Tech 3341 §4. NO BS.1770 gating (gating is a
    property of the integrated metric, not M).

    5.3.1 fix: paired with compute_short_term_max — same wrong use of
    `integrated_loudness` per window pre-5.3.
    """
    try:
        if y.ndim == 1:
            data = y.reshape(-1, 1)
        elif y.shape[0] == 2 and y.shape[1] > 2:
            data = y.T
        elif y.shape[1] <= 2:
            data = y
        else:
            data = y.reshape(-1, 1)
        kw = _bs1770_k_weight(data, sr)
        block = int(sr * 0.4)
        hop = int(sr * 0.1)
        max_m = -70.0
        ch_weights_full = np.array([1.0, 1.0, 1.0, 1.41, 1.41])
        n_ch = min(kw.shape[1], len(ch_weights_full))
        ch_weights = ch_weights_full[:n_ch]
        for i in range(0, len(data) - block + 1, hop):
            seg = kw[i:i + block, :n_ch]
            mean_sq = np.mean(seg ** 2, axis=0)
            weighted = float(np.sum(mean_sq * ch_weights))
            if weighted <= 0:
                continue
            v = -0.691 + 10.0 * np.log10(weighted)
            if not (np.isnan(v) or np.isinf(v)) and v > max_m:
                max_m = float(v)
        return float(max_m)
    except Exception as e:
        import sys as _sys
        _sys.stderr.write(f"[comparator] momentary_max fallback: {e}\n")
        return -70.0


def compute_plr(y: np.ndarray, sr: int) -> float | None:
    """
    Peak-to-Loudness Ratio (PLR) — dB difference between true-peak and
    integrated LUFS. Used alongside LRA to describe overall loudness headroom.

    Lower PLR = more crest-compressed / limited (smashed masters ~= 7-9 dB).
    Higher PLR = more transient headroom (dynamic mixes ~= 14-20 dB).

    Returns None for digital silence or otherwise non-finite LUFS — PLR
    is undefined when there's no audible content. Renderers treat None
    as "skip the row" (see AnalysisView / ClientReportButton null-guards).
    """
    try:
        # True peak is the max across all available channels — sampling
        # only the left channel under-reports stereo PLR by ~1 dB on
        # signals where the right channel is louder (e.g. independent
        # L/R noise).
        if y.ndim == 1:
            channels = [y]
        elif y.shape[0] <= 2:
            channels = [y[i] for i in range(y.shape[0])]
        else:
            channels = [y[:, i] for i in range(min(y.shape[1], 2))]

        # 5.7.x audit fix: use the scipy polyphase resample path instead
        # of rtm_fast's linear-interpolation kernel. The fast kernel is
        # 0.5 dB accurate against a sinc reference and shipped TP values
        # ~1 dB lower than the certification path used elsewhere in the
        # UI (e.g. _true_peak_and_overs at comparator.py:420). Two TP
        # readings in the same UI disagreed by 1 dB. PLR is computed
        # once per analysis, not on the hot DSP path, so the speed
        # difference is negligible.
        per_channel_tp = []
        for ch in channels:
            try:
                from scipy.signal import resample_poly
                up = resample_poly(ch, 4, 1)
                per_channel_tp.append(float(20 * np.log10(max(np.max(np.abs(up)), 1e-10))))
            except Exception:
                # Last-ditch raw peak; better than emitting -inf.
                peak = float(np.max(np.abs(ch))) if ch.size else 1e-10
                per_channel_tp.append(float(20 * np.log10(max(peak, 1e-10))))
        # Drop -inf entries so a single dead channel doesn't poison the max.
        finite_tps = [v for v in per_channel_tp if np.isfinite(v)]
        if not finite_tps:
            return None
        tp_db = max(finite_tps)

        lufs = compute_lufs(y, sr)
        if np.isinf(lufs) or np.isnan(lufs):
            # Silence / non-finite loudness — PLR is undefined here.
            return None
        return round(tp_db - lufs, 1)
    except Exception as e:
        import sys as _sys
        _sys.stderr.write(f"[comparator] compute_plr failed: {e}\n")
        return None


def compute_dynamic_range(y: np.ndarray, sr: int) -> float:
    """
    Compute Loudness Range (LRA) per EBU R128 using pyloudnorm.
    Accepts mono (1D) or stereo (2, samples) or (samples, 2).
    """
    import pyloudnorm as pyln

    # Ensure (samples, channels) format
    if y.ndim == 1:
        data = y.reshape(-1, 1)
    elif y.shape[0] == 2 and y.shape[1] > 2:
        data = y.T
    elif y.shape[1] <= 2:
        data = y
    else:
        data = y.reshape(-1, 1)

    try:
        meter = pyln.Meter(sr)
        lra = meter.loudness_range(data)
        if np.isnan(lra) or np.isinf(lra):
            return 0.0
        return float(lra)
    except Exception:
        # 5.7.x audit fix: K-weight the fallback per BS.1770 to match
        # the primary path's units. Pre-fix the fallback used raw RMS
        # percentiles, which on heavily HF-shifted material disagreed
        # with the primary by 2–4 LU and tripped the wrong "Over-
        # compressed / Very dynamic" tip when pyloudnorm hiccupped.
        # K-weighting (a high-shelf at ~1500 Hz) brings the units back
        # in line with EBU R128 even though the gating is approximate.
        mono = data[:, 0] if data.ndim > 1 else data
        # Approximate K-weighting: shelving filter pair from BS.1770-4.
        # Normalised coefficients for any sample rate via bilinear.
        from scipy.signal import lfilter
        # Stage 1 (high-shelf, fc=1681 Hz, +4 dB)
        b1 = [1.53512485958697, -2.69169618940638, 1.19839281085285]
        a1 = [1.0,             -1.69065929318241, 0.73248077421585]
        # Stage 2 (high-pass, fc=38 Hz)
        b2 = [1.0, -2.0, 1.0]
        a2 = [1.0, -1.99004745483398, 0.99007225036621]
        try:
            kw = lfilter(b1, a1, mono.astype(np.float64))
            kw = lfilter(b2, a2, kw)
        except Exception:
            kw = mono
        frame_length = int(sr * 0.4)
        hop_length = int(sr * 0.1)
        rms = librosa.feature.rms(y=kw, frame_length=frame_length, hop_length=hop_length)[0]
        rms_db = 20 * np.log10(np.maximum(rms, 1e-10))
        rms_db = rms_db[rms_db > -70]  # absolute gate, BS.1770
        if len(rms_db) < 10:
            return 0.0
        return float(np.percentile(rms_db, 95) - np.percentile(rms_db, 10))


# ─── Granular category analysis ──────────────────────────────────────────────

def analyze_category(name: str, mono_a: np.ndarray, mono_b: np.ndarray,
                     stereo_a: np.ndarray, stereo_b: np.ndarray,
                     sr: int) -> dict:
    """Analyze a single granular category."""

    # Level
    rms_a = np.sqrt(np.mean(mono_a ** 2))
    rms_b = np.sqrt(np.mean(mono_b ** 2))
    db_a = 20 * np.log10(max(rms_a, 1e-10))
    db_b = 20 * np.log10(max(rms_b, 1e-10))
    level_diff = db_b - db_a

    # Stereo width
    if stereo_a.ndim > 1 and stereo_a.shape[0] == 2:
        width_a = compute_stereo_width(stereo_a[0], stereo_a[1])
        width_b = compute_stereo_width(stereo_b[0], stereo_b[1])
        pan_a = compute_pan(stereo_a[0], stereo_a[1])
        pan_b = compute_pan(stereo_b[0], stereo_b[1])
    else:
        width_a = width_b = 0.0
        pan_a = pan_b = 0.0

    # Dynamics
    dr_a = compute_dynamic_range(mono_a, sr)
    dr_b = compute_dynamic_range(mono_b, sr)

    # Punch (transient energy)
    punch_a = compute_punch(mono_a, sr)
    punch_b = compute_punch(mono_b, sr)

    # Spectral centroid (brightness proxy)
    cent_a = float(np.mean(librosa.feature.spectral_centroid(y=mono_a, sr=sr))) if rms_a > 1e-6 else 0
    cent_b = float(np.mean(librosa.feature.spectral_centroid(y=mono_b, sr=sr))) if rms_b > 1e-6 else 0

    # Generate insight
    insight = generate_category_insight(
        name, level_diff, width_a, width_b, pan_a, pan_b,
        dr_a, dr_b, punch_a, punch_b, cent_a, cent_b
    )

    return {
        "name": name,
        "level_a": round(db_a, 1),
        "level_b": round(db_b, 1),
        "level_diff": round(level_diff, 1),
        "width_a": round(width_a, 3),
        "width_b": round(width_b, 3),
        "pan_a": round(pan_a, 3),
        "pan_b": round(pan_b, 3),
        "dynamics_a": round(dr_a, 1),
        "dynamics_b": round(dr_b, 1),
        "punch_a": round(punch_a, 2),
        "punch_b": round(punch_b, 2),
        "centroid_a": round(cent_a, 0),
        "centroid_b": round(cent_b, 0),
        "insight": insight,
    }


def run_full_analysis(stems_a: dict, stems_b: dict, sr: int = 44100) -> dict:
    """
    Run the full granular analysis pipeline.
    1. Load all stems
    2. Level-match the full mix
    3. Apply same gain to individual stems
    4. Extract granular categories from stems + frequency bands
    """
    # Load all stems
    loaded_a = {}
    loaded_b = {}
    for stem_name in ["vocals", "drums", "bass", "other"]:
        if stem_name in stems_a and stem_name in stems_b:
            ya, _ = librosa.load(stems_a[stem_name], sr=sr, mono=False)
            yb, _ = librosa.load(stems_b[stem_name], sr=sr, mono=False)
            if ya.ndim == 1:
                ya = np.stack([ya, ya])
            if yb.ndim == 1:
                yb = np.stack([yb, yb])
            # Trim to same length
            min_len = min(ya.shape[1], yb.shape[1])
            loaded_a[stem_name] = ya[:, :min_len]
            loaded_b[stem_name] = yb[:, :min_len]

    # Reconstruct full mix.
    # 5.7.x audit fix: trim across BOTH stem dicts. Pre-fix, min_len
    # was computed only over loaded_a, then loaded_b was sliced to
    # the same length. That works today because per-pair trim above
    # already aligned A and B per stem, but if a future caller ever
    # populated loaded_a/loaded_b independently with mismatched
    # lengths, mix_b's slice could exceed an actual stem's length
    # and silently raise IndexError. Belt-and-braces: take the
    # global min across all stems on both sides.
    min_len = min(
        s.shape[1]
        for d in (loaded_a, loaded_b)
        for s in d.values()
    )
    mix_a = sum(s[:, :min_len] for s in loaded_a.values())
    mix_b = sum(s[:, :min_len] for s in loaded_b.values())

    # Level match using the full mix
    _, mix_b_matched, gain_applied = level_match(mix_a, mix_b, sr)
    gain_linear = 10 ** (gain_applied / 20) if gain_applied != 0 else 1.0

    # Apply same gain to all B stems
    matched_b = {}
    for name, stem in loaded_b.items():
        matched_b[name] = stem * gain_linear

    # ─── Extract granular categories ──────────────────────────────────────

    mono_a = {k: librosa.to_mono(v) for k, v in loaded_a.items()}
    mono_b = {k: librosa.to_mono(v) for k, v in matched_b.items()}

    categories = []

    # Kick — low end of drums stem
    if "drums" in mono_a:
        kick_a = bandpass(mono_a["drums"], sr, 50, 150)
        kick_b = bandpass(mono_b["drums"], sr, 50, 150)
        categories.append(analyze_category(
            "Kick", kick_a, kick_b,
            loaded_a["drums"], matched_b["drums"], sr
        ))

    # Snare — mid frequencies of drums stem
    if "drums" in mono_a:
        snare_a = bandpass(mono_a["drums"], sr, 150, 5000)
        snare_b = bandpass(mono_b["drums"], sr, 150, 5000)
        categories.append(analyze_category(
            "Snare", snare_a, snare_b,
            loaded_a["drums"], matched_b["drums"], sr
        ))

    # Sub — sub bass from bass stem
    if "bass" in mono_a:
        sub_a = bandpass(mono_a["bass"], sr, 20, 80)
        sub_b = bandpass(mono_b["bass"], sr, 20, 80)
        categories.append(analyze_category(
            "Sub", sub_a, sub_b,
            loaded_a["bass"], matched_b["bass"], sr
        ))

    # Bass — upper bass from bass stem
    if "bass" in mono_a:
        bass_a = bandpass(mono_a["bass"], sr, 80, 300)
        bass_b = bandpass(mono_b["bass"], sr, 80, 300)
        categories.append(analyze_category(
            "Bass", bass_a, bass_b,
            loaded_a["bass"], matched_b["bass"], sr
        ))

    # Vocals — full vocals stem
    if "vocals" in mono_a:
        categories.append(analyze_category(
            "Vocals", mono_a["vocals"], mono_b["vocals"],
            loaded_a["vocals"], matched_b["vocals"], sr
        ))

    # Instruments — other stem
    if "other" in mono_a:
        categories.append(analyze_category(
            "Instruments", mono_a["other"], mono_b["other"],
            loaded_a["other"], matched_b["other"], sr
        ))

    # Brightness — 3-10kHz of full mix
    mix_mono_a = librosa.to_mono(mix_a)
    mix_mono_b = librosa.to_mono(mix_b_matched)
    bright_a = bandpass(mix_mono_a, sr, 3000, 10000)
    bright_b = bandpass(mix_mono_b, sr, 3000, 10000)
    categories.append(analyze_category(
        "Brightness", bright_a, bright_b,
        mix_a, mix_b_matched, sr
    ))

    # Air — 10-20kHz of full mix
    air_a = bandpass(mix_mono_a, sr, 10000, 20000)
    air_b = bandpass(mix_mono_b, sr, 10000, 20000)
    categories.append(analyze_category(
        "Air", air_a, air_b,
        mix_a, mix_b_matched, sr
    ))

    # Wideness — stereo analysis of full mix
    width_a = compute_stereo_width(mix_a[0], mix_a[1])
    width_b = compute_stereo_width(mix_b_matched[0], mix_b_matched[1])
    categories.append(analyze_category(
        "Wideness", mix_mono_a, mix_mono_b,
        mix_a, mix_b_matched, sr
    ))

    # Punch — transient analysis on drums
    if "drums" in mono_a:
        categories.append(analyze_category(
            "Punch", mono_a["drums"], mono_b["drums"],
            loaded_a["drums"], matched_b["drums"], sr
        ))

    # ─── Overall summary ──────────────────────────────────────────────────
    overall_lufs_a = compute_lufs(mix_a, sr)
    overall_lufs_b_original = compute_lufs(mix_b, sr)
    overall_width_a = compute_stereo_width(mix_a[0], mix_a[1])
    overall_width_b = compute_stereo_width(mix_b[0], mix_b[1])
    overall_dr_a = compute_dynamic_range(mix_mono_a, sr)
    overall_dr_b = compute_dynamic_range(librosa.to_mono(mix_b), sr)

    overall_insights = generate_overall_insights(
        overall_lufs_a, overall_lufs_b_original, gain_applied,
        overall_width_a, overall_width_b,
        overall_dr_a, overall_dr_b,
        categories
    )

    # ─── Recommendations ────────────────────────────────────────────────
    recommendations = generate_recommendations(categories, gain_applied,
        overall_width_a, overall_width_b, overall_dr_a, overall_dr_b)

    result = {
        "level_matched": True,
        "gain_applied_db": gain_applied,
        "categories": [c for c in categories],
        "recommendations": recommendations,
        "overall": {
            "lufs_a": round(overall_lufs_a, 1),
            "lufs_b": round(overall_lufs_b_original, 1),
            "loudness_diff": round(overall_lufs_b_original - overall_lufs_a, 1),
            "width_a": round(overall_width_a, 3),
            "width_b": round(overall_width_b, 3),
            "dynamics_a": round(overall_dr_a, 1),
            "dynamics_b": round(overall_dr_b, 1),
            "insights": overall_insights,
        }
    }
    _attach_mastering_delta(result, mix_a, mix_b, sr=sr)
    return _stamp_spec_versions(result)


# ─── Insight generation ──────────────────────────────────────────────────────

def generate_category_insight(
    name: str, level_diff: float,
    width_a: float, width_b: float,
    pan_a: float, pan_b: float,
    dr_a: float, dr_b: float,
    punch_a: float, punch_b: float,
    cent_a: float, cent_b: float,
) -> str:
    """Generate a single human-readable insight for a category."""

    parts = []

    # Category-specific wording
    if name == "Kick":
        if abs(level_diff) > 1.5:
            parts.append(f"{'Louder' if level_diff > 0 else 'Quieter'} kick in File B — {'hits harder' if level_diff > 0 else 'sits more in the background'}")
        elif abs(level_diff) > 0.5:
            parts.append(f"Kick is {'slightly louder' if level_diff > 0 else 'slightly softer'}")
        else:
            parts.append("Kick level is very similar")

        punch_diff = punch_b - punch_a
        if abs(punch_diff) > 0.3:
            parts.append(f"{'punchier' if punch_diff > 0 else 'rounder/softer'} attack")

    elif name == "Snare":
        if abs(level_diff) > 1.5:
            parts.append(f"Snare is {'more prominent' if level_diff > 0 else 'pulled back'} in File B")
        elif abs(level_diff) > 0.5:
            parts.append(f"Snare {'pops a bit more' if level_diff > 0 else 'is a touch quieter'}")
        else:
            parts.append("Snare sits at a similar level")

        if cent_a > 0 and cent_b > 0:
            bright_pct = (cent_b - cent_a) / max(cent_a, 1) * 100
            if abs(bright_pct) > 8:
                parts.append(f"{'crispier snap' if bright_pct > 0 else 'warmer tone'}")

    elif name == "Sub":
        if abs(level_diff) > 1.5:
            parts.append(f"{'More' if level_diff > 0 else 'Less'} sub energy in File B")
        elif abs(level_diff) > 0.5:
            parts.append(f"Sub is {'slightly boosted' if level_diff > 0 else 'slightly reduced'}")
        else:
            parts.append("Sub bass energy is similar")

    elif name == "Bass":
        if abs(level_diff) > 1.5:
            parts.append(f"Bass body is {'fuller and louder' if level_diff > 0 else 'thinner'} in File B")
        elif abs(level_diff) > 0.5:
            parts.append(f"Bass is {'a touch warmer' if level_diff > 0 else 'a bit leaner'}")
        else:
            parts.append("Bass body is similar in both versions")

        dr_diff = dr_b - dr_a
        if abs(dr_diff) > 1.5:
            parts.append(f"{'tighter and more controlled' if dr_diff < 0 else 'more dynamic movement'}")

    elif name == "Vocals":
        if abs(level_diff) > 1.5:
            parts.append(f"Vocals are {'more upfront and present' if level_diff > 0 else 'sitting further back in the mix'}")
        elif abs(level_diff) > 0.5:
            parts.append(f"Vocals are {'a touch more forward' if level_diff > 0 else 'slightly more tucked in'}")
        else:
            parts.append("Vocal level is well matched between both versions")

        width_diff = width_b - width_a
        if abs(width_diff) > 0.05:
            parts.append(f"{'wider spread, more stereo processing' if width_diff > 0 else 'tighter, more centered'}")

    elif name == "Instruments":
        if abs(level_diff) > 1.5:
            parts.append(f"Keys/guitars/synths are {'louder' if level_diff > 0 else 'quieter'} in File B")
        elif abs(level_diff) > 0.5:
            parts.append(f"Instruments are {'slightly more present' if level_diff > 0 else 'slightly recessed'}")
        else:
            parts.append("Instrument balance is similar")

        width_diff = width_b - width_a
        if abs(width_diff) > 0.05:
            parts.append(f"{'wider stereo spread' if width_diff > 0 else 'narrower image'}")

    elif name == "Brightness":
        if abs(level_diff) > 1.5:
            parts.append(f"File B is {'noticeably brighter — more presence and edge' if level_diff > 0 else 'darker and smoother'}")
        elif abs(level_diff) > 0.5:
            parts.append(f"{'Slightly brighter' if level_diff > 0 else 'Slightly warmer'} in the upper mids and highs")
        else:
            parts.append("Similar brightness and tonal character")

    elif name == "Air":
        if abs(level_diff) > 1.5:
            parts.append(f"{'More air and sparkle on top' if level_diff > 0 else 'Less top-end shimmer'} in File B")
        elif abs(level_diff) > 0.5:
            parts.append(f"{'A touch more open and airy' if level_diff > 0 else 'Slightly more rolled off up top'}")
        else:
            parts.append("Top-end air is similar")

    elif name == "Wideness":
        width_diff = width_b - width_a
        if abs(width_diff) > 0.08:
            parts.append(f"File B is {'noticeably wider — more spread and dimension' if width_diff > 0 else 'narrower — more focused and centered'}")
        elif abs(width_diff) > 0.03:
            parts.append(f"{'A bit more stereo width' if width_diff > 0 else 'Slightly tighter stereo image'}")
        else:
            parts.append("Stereo width is very similar")

    elif name == "Punch":
        punch_diff = punch_b - punch_a
        if abs(punch_diff) > 0.5:
            parts.append(f"{'More punch and transient snap' if punch_diff > 0 else 'Softer, more rounded transients'} in File B")
        elif abs(punch_diff) > 0.2:
            parts.append(f"{'Slightly punchier attack' if punch_diff > 0 else 'Slightly softer hit'}")
        else:
            parts.append("Transient punch is similar")

        dr_diff = dr_b - dr_a
        if abs(dr_diff) > 1.5:
            parts.append(f"{'more dynamic range' if dr_diff > 0 else 'more compressed/glued'}")

    return " — ".join(parts) if parts else "Similar between both versions"


def generate_overall_insights(
    lufs_a, lufs_b, gain_applied,
    width_a, width_b,
    dr_a, dr_b,
    categories,
) -> list:
    """Generate overall summary insights."""
    insights = []
    loudness_diff = lufs_b - lufs_a

    if abs(loudness_diff) > 0.5:
        insights.append(
            f"File B is {abs(loudness_diff):.1f} dB {'louder' if loudness_diff > 0 else 'quieter'} overall"
        )
    insights.append(
        f"Analysis is level-matched ({abs(gain_applied):.1f} dB applied) so differences reflect balance, not volume"
    )

    width_diff = width_b - width_a
    if abs(width_diff) > 0.03:
        insights.append(
            f"File B has a {'wider' if width_diff > 0 else 'narrower'} stereo image overall"
        )

    dr_diff = dr_b - dr_a
    if abs(dr_diff) > 1.0:
        if dr_diff < 0:
            insights.append("File B is more compressed — traded some dynamic range for density")
        else:
            insights.append("File B is more dynamic — less compression applied")

    # Find biggest differences
    biggest = sorted(categories, key=lambda c: abs(c["level_diff"]), reverse=True)
    top = [c for c in biggest[:3] if abs(c["level_diff"]) > 0.5]
    if top:
        names = [c["name"].lower() for c in top]
        insights.append(
            f"Biggest balance changes: {', '.join(names)}"
        )

    return insights


def generate_recommendations(categories, gain_applied,
                              width_a, width_b, dr_a, dr_b) -> list:
    """
    Generate actionable recommendations for making File B closer to File A's
    style/balance while keeping the improvements File B brought.
    """
    recs = []
    cat_map = {c["name"]: c for c in categories}

    # --- Per-category recommendations ---

    # Kick
    kick = cat_map.get("Kick")
    if kick:
        diff = kick["level_diff"]
        if abs(diff) > 1.5:
            if diff > 0:
                recs.append({
                    "priority": "high",
                    "area": "Kick",
                    "action": f"Kick is {abs(diff):.1f} dB louder in File B. Pull it back ~{abs(diff):.0f} dB to match File A's balance, or meet halfway if you like the extra weight."
                })
            else:
                recs.append({
                    "priority": "high",
                    "area": "Kick",
                    "action": f"Kick lost {abs(diff):.1f} dB in File B. Boost it back or use a gentle low-shelf around 80-100 Hz to restore the thump."
                })
        punch_diff = kick["punch_b"] - kick["punch_a"]
        if abs(punch_diff) > 0.5 and abs(diff) <= 1.5:
            if punch_diff > 0:
                recs.append({
                    "priority": "low",
                    "area": "Kick",
                    "action": "Kick is punchier in File B — good improvement. Keep it if it works in context."
                })
            else:
                recs.append({
                    "priority": "medium",
                    "area": "Kick",
                    "action": "Kick lost some punch. Try a faster attack on the compressor or add a transient shaper to restore the snap."
                })

    # Snare
    snare = cat_map.get("Snare")
    if snare:
        diff = snare["level_diff"]
        if abs(diff) > 1.5:
            direction = "louder" if diff > 0 else "quieter"
            fix = "pull it back slightly" if diff > 0 else "boost it a touch"
            recs.append({
                "priority": "high",
                "area": "Snare",
                "action": f"Snare is {abs(diff):.1f} dB {direction} in File B. {fix.capitalize()} to match File A's snare presence, or split the difference."
            })
        if snare["centroid_b"] > 0 and snare["centroid_a"] > 0:
            bright_pct = (snare["centroid_b"] - snare["centroid_a"]) / max(snare["centroid_a"], 1) * 100
            if bright_pct > 12:
                recs.append({
                    "priority": "low",
                    "area": "Snare",
                    "action": "Snare is noticeably brighter in File B. If it sounds harsh, tame it with a gentle cut around 3-5 kHz."
                })

    # Sub
    sub = cat_map.get("Sub")
    if sub and abs(sub["level_diff"]) > 1.5:
        diff = sub["level_diff"]
        if diff > 0:
            recs.append({
                "priority": "medium",
                "area": "Sub",
                "action": f"Sub bass is {abs(diff):.1f} dB hotter in File B. Check on different playback systems — might be too much on big speakers. Consider pulling back 1-2 dB below 60 Hz."
            })
        else:
            recs.append({
                "priority": "medium",
                "area": "Sub",
                "action": f"Sub bass dropped {abs(diff):.1f} dB. If the low end feels thin, add a subtle low-shelf boost below 60 Hz to restore the foundation."
            })

    # Bass
    bass = cat_map.get("Bass")
    if bass:
        diff = bass["level_diff"]
        dr_diff = bass["dynamics_b"] - bass["dynamics_a"]
        if abs(diff) > 1.5:
            recs.append({
                "priority": "high",
                "area": "Bass",
                "action": f"Bass body is {abs(diff):.1f} dB {'louder' if diff > 0 else 'quieter'}. Adjust bass fader or use a bell around 100-200 Hz to fine-tune the body."
            })
        if dr_diff < -2.0:
            recs.append({
                "priority": "low",
                "area": "Bass",
                "action": "Bass is tighter in File B — good for most genres. If it sounds too controlled, ease off the compressor ratio slightly."
            })

    # Vocals
    vocals = cat_map.get("Vocals")
    if vocals:
        diff = vocals["level_diff"]
        width_diff = vocals["width_b"] - vocals["width_a"]
        if abs(diff) > 1.5:
            if diff > 0:
                recs.append({
                    "priority": "high",
                    "area": "Vocals",
                    "action": f"Vocals are {abs(diff):.1f} dB louder in File B. If they're poking out too much, pull back ~{abs(diff)/2:.1f} dB — you want them present but not fighting the instruments."
                })
            else:
                recs.append({
                    "priority": "high",
                    "area": "Vocals",
                    "action": f"Vocals dropped {abs(diff):.1f} dB — they might be getting buried. Push them up and consider a touch of 2-4 kHz presence boost."
                })
        elif abs(diff) > 0.5:
            recs.append({
                "priority": "medium",
                "area": "Vocals",
                "action": f"Vocals are {'slightly more forward' if diff > 0 else 'slightly tucked'} in File B — this is a subtle change, trust your ears on whether it works for the song."
            })
        if abs(width_diff) > 0.08:
            if width_diff > 0:
                recs.append({
                    "priority": "low",
                    "area": "Vocals",
                    "action": "Vocals are wider in File B. If it sounds too spread, reduce stereo widening/chorus. If it sounds good, keep it — wider vocals can add intimacy."
                })

    # Instruments
    instruments = cat_map.get("Instruments")
    if instruments and abs(instruments["level_diff"]) > 1.5:
        diff = instruments["level_diff"]
        recs.append({
            "priority": "medium",
            "area": "Instruments",
            "action": f"Keys/guitars/synths are {abs(diff):.1f} dB {'louder' if diff > 0 else 'quieter'} in File B. Adjust the instrument bus to sit between the two versions."
        })

    # Brightness
    brightness = cat_map.get("Brightness")
    if brightness and abs(brightness["level_diff"]) > 1.5:
        diff = brightness["level_diff"]
        if diff > 0:
            recs.append({
                "priority": "medium",
                "area": "Brightness",
                "action": f"File B is {abs(diff):.1f} dB brighter in the 3-10 kHz range. If it sounds harsh or fatiguing, pull back the high shelf or dip around 4-6 kHz. If it sounds exciting, keep it."
            })
        else:
            recs.append({
                "priority": "medium",
                "area": "Brightness",
                "action": f"File B lost {abs(diff):.1f} dB of brightness. Add a gentle high shelf around 5 kHz to restore presence without making it harsh."
            })

    # Air
    air = cat_map.get("Air")
    if air and abs(air["level_diff"]) > 1.5:
        diff = air["level_diff"]
        if diff > 0:
            recs.append({
                "priority": "low",
                "area": "Air",
                "action": "More top-end air in File B — this usually sounds good and open. Keep it unless it's adding sibilance or hiss."
            })
        else:
            recs.append({
                "priority": "medium",
                "area": "Air",
                "action": "File B lost some air up top. A subtle high-shelf boost above 10 kHz can bring back the sparkle without affecting the body of the mix."
            })

    # Wideness
    wideness = cat_map.get("Wideness")
    if wideness:
        w_diff = wideness["width_b"] - wideness["width_a"]
        if abs(w_diff) > 0.08:
            if w_diff > 0:
                recs.append({
                    "priority": "medium",
                    "area": "Wideness",
                    "action": "File B is noticeably wider. Check mono compatibility — if it collapses, reduce the stereo enhancement. If mono sounds fine, the width is a win."
                })
            else:
                recs.append({
                    "priority": "medium",
                    "area": "Wideness",
                    "action": "File B is narrower than File A. If the mix feels claustrophobic, add subtle stereo widening on the bus or widen the reverbs/delays."
                })

    # Punch
    punch = cat_map.get("Punch")
    if punch:
        p_diff = punch["punch_b"] - punch["punch_a"]
        if abs(p_diff) > 0.5:
            if p_diff > 0:
                recs.append({
                    "priority": "low",
                    "area": "Punch",
                    "action": "More transient punch in File B — this is usually desirable. Keep it, but check it doesn't cause clipping on the master bus."
                })
            else:
                recs.append({
                    "priority": "medium",
                    "area": "Punch",
                    "action": "Lost some transient punch in File B. Check limiter settings — a slower attack time will let more transients through. A transient shaper on the drum bus can also help."
                })

    # Overall dynamics
    dr_diff = dr_b - dr_a
    if abs(dr_diff) > 2.0:
        if dr_diff < 0:
            recs.append({
                "priority": "medium",
                "area": "Dynamics",
                "action": f"File B lost {abs(dr_diff):.1f} dB of dynamic range. If it sounds flat or lifeless, ease off the master limiter or bus compressor. A good master should be loud but still breathe."
            })
        else:
            recs.append({
                "priority": "low",
                "area": "Dynamics",
                "action": "File B is more dynamic — nice. If it needs to compete on loudness, you can push the limiter a touch harder, but don't sacrifice the dynamics."
            })

    # If very few recommendations, add a positive note
    if len(recs) <= 1:
        recs.append({
            "priority": "low",
            "area": "Overall",
            "action": "File B is very close to File A in balance and character. Only minor tweaks needed — trust your ears for the final call."
        })

    # Sort by priority
    priority_order = {"high": 0, "medium": 1, "low": 2}
    recs.sort(key=lambda r: priority_order.get(r["priority"], 1))

    return recs


# ─── Fast analysis (no Demucs) ────────────────────────────────────────────────

def run_fast_analysis(file_a: str, file_b: str, sr: int = 44100) -> dict:
    """
    Run analysis using frequency-band isolation instead of Demucs.
    Much faster (~10 seconds), same 10 categories.
    Uses bandpass filters to approximate what Demucs does with AI.
    """
    # Load stereo
    y_a, _ = librosa.load(file_a, sr=sr, mono=False)
    y_b, _ = librosa.load(file_b, sr=sr, mono=False)

    if y_a.ndim == 1:
        y_a = np.stack([y_a, y_a])
    if y_b.ndim == 1:
        y_b = np.stack([y_b, y_b])

    min_len = min(y_a.shape[1], y_b.shape[1])
    y_a = y_a[:, :min_len]
    y_b = y_b[:, :min_len]

    # Level match
    _, y_b_matched, gain_applied = level_match(y_a, y_b, sr)
    gain_linear = 10 ** (gain_applied / 20) if gain_applied != 0 else 1.0

    mono_a = librosa.to_mono(y_a)
    mono_b = librosa.to_mono(y_b_matched)

    categories = []

    # Frequency band definitions for each category
    band_defs = [
        ("Kick",        50,   150,  True),
        ("Snare",       150,  5000, True),
        ("Sub",         20,   80,   False),
        ("Bass",        80,   300,  False),
        ("Vocals",      300,  4000, True),
        ("Instruments", 1000, 8000, True),
        ("Brightness",  3000, 10000, True),
        ("Air",         10000, 20000, True),
        ("Wideness",    20,   20000, True),  # Full range for width
        ("Punch",       50,   5000, True),   # Transient range
    ]

    for name, low, high, use_stereo in band_defs:
        band_a = bandpass(mono_a, sr, low, high)
        band_b = bandpass(mono_b, sr, low, high)

        if use_stereo:
            stereo_a = np.stack([
                bandpass(y_a[0], sr, low, high),
                bandpass(y_a[1], sr, low, high),
            ])
            stereo_b = np.stack([
                bandpass(y_b_matched[0], sr, low, high),
                bandpass(y_b_matched[1], sr, low, high),
            ])
        else:
            stereo_a = y_a
            stereo_b = y_b_matched

        cat = analyze_category(name, band_a, band_b, stereo_a, stereo_b, sr)
        categories.append(cat)

    # Overall
    overall_lufs_a = compute_lufs(y_a, sr)
    overall_lufs_b_orig = compute_lufs(y_b, sr)
    overall_width_a = compute_stereo_width(y_a[0], y_a[1])
    overall_width_b = compute_stereo_width(y_b[0], y_b[1])
    overall_dr_a = compute_dynamic_range(mono_a, sr)
    overall_dr_b = compute_dynamic_range(librosa.to_mono(y_b), sr)

    overall_insights = generate_overall_insights(
        overall_lufs_a, overall_lufs_b_orig, gain_applied,
        overall_width_a, overall_width_b,
        overall_dr_a, overall_dr_b,
        categories
    )

    recommendations = generate_recommendations(
        categories, gain_applied,
        overall_width_a, overall_width_b,
        overall_dr_a, overall_dr_b
    )

    # Short-term max loudness
    st_max_a = compute_short_term_max(y_a, sr)
    st_max_b = compute_short_term_max(y_b, sr)

    # Peak-to-Loudness Ratio (dB headroom above integrated LUFS)
    plr_a = compute_plr(y_a, sr)
    plr_b = compute_plr(y_b, sr)

    # Momentary max (400 ms) — broadcast compliance
    mom_a = compute_momentary_max(y_a, sr)
    mom_b = compute_momentary_max(y_b, sr)

    result = {
        "level_matched": True,
        "gain_applied_db": gain_applied,
        "categories": categories,
        "recommendations": recommendations,
        "overall": {
            "lufs_a": round(overall_lufs_a, 1),
            "lufs_b": round(overall_lufs_b_orig, 1),
            "loudness_diff": round(overall_lufs_b_orig - overall_lufs_a, 1),
            "short_term_max_a": round(st_max_a, 1),
            "short_term_max_b": round(st_max_b, 1),
            "momentary_max_a": round(mom_a, 1),
            "momentary_max_b": round(mom_b, 1),
            "plr_a": plr_a,
            "plr_b": plr_b,
            "width_a": round(overall_width_a, 3),
            "width_b": round(overall_width_b, 3),
            "dynamics_a": round(overall_dr_a, 1),
            "dynamics_b": round(overall_dr_b, 1),
            "insights": overall_insights,
        },
    }
    _attach_mastering_delta(result, y_a, y_b, sr=sr, file_a=file_a, file_b=file_b)
    return _stamp_spec_versions(result)


# ─── Hybrid analysis (AI chunk + fast) ───────────────────────────────────────

def run_hybrid_analysis(file_a: str, file_b: str, tmp_dir: str,
                        sr: int = 44100, chunk_sec: float = 30.0,
                        progress_cb=None) -> dict:
    """
    Hybrid mode:
    1. Find the loudest 30-second chunk (usually chorus)
    2. Run Demucs AI separation on JUST that chunk — get accurate kick/bass/drums
    3. Run frequency-band analysis on the full song for everything else
    4. Merge: use AI results for Kick, Snare, Sub, Bass; fast results for the rest

    ~30-60 seconds instead of 10+ minutes.
    """
    if progress_cb:
        progress_cb("Loading audio...")

    # Load full files
    y_a_full, _ = librosa.load(file_a, sr=sr, mono=False)
    y_b_full, _ = librosa.load(file_b, sr=sr, mono=False)

    if y_a_full.ndim == 1:
        y_a_full = np.stack([y_a_full, y_a_full])
    if y_b_full.ndim == 1:
        y_b_full = np.stack([y_b_full, y_b_full])

    min_len = min(y_a_full.shape[1], y_b_full.shape[1])
    y_a_full = y_a_full[:, :min_len]
    y_b_full = y_b_full[:, :min_len]

    # Find loudest 30s chunk
    if progress_cb:
        progress_cb("Finding loudest section...")

    chunk_samples = int(sr * chunk_sec)
    mono_a = librosa.to_mono(y_a_full)

    if len(mono_a) <= chunk_samples:
        # Song is shorter than chunk — just use the whole thing
        start = 0
    else:
        # Sliding window RMS to find loudest section
        hop = sr * 5  # check every 5 seconds
        best_rms = 0
        start = 0
        for i in range(0, len(mono_a) - chunk_samples, hop):
            rms = np.sqrt(np.mean(mono_a[i:i + chunk_samples] ** 2))
            if rms > best_rms:
                best_rms = rms
                start = i

    end = min(start + chunk_samples, min_len)

    if progress_cb:
        time_start = start / sr
        time_end = end / sr
        progress_cb(f"Analyzing loudest section ({time_start:.0f}s - {time_end:.0f}s)...")

    # Extract chunks and save as temp WAVs
    chunk_a = y_a_full[:, start:end]
    chunk_b = y_b_full[:, start:end]

    chunk_a_path = os.path.join(tmp_dir, "chunk_a.wav")
    chunk_b_path = os.path.join(tmp_dir, "chunk_b.wav")
    sf.write(chunk_a_path, chunk_a.T, sr)
    sf.write(chunk_b_path, chunk_b.T, sr)

    # Run separator on the short chunks. CRITICAL: route into per-file
    # output subdirectories. The default BS-RoFormer backend writes
    # stems flat (vocals.wav / drums.wav / bass.wav / other.wav), so
    # back-to-back calls with the same out_dir silently overwrite the
    # first file's stems with the second's — Deep Scan then compares
    # file-B-stems-vs-file-B-stems and reports "perfect match" on
    # tracks that aren't. Per the audit's CRITICAL #1 finding.
    from separator import separate

    stems_a_dir = os.path.join(tmp_dir, "stems_a")
    stems_b_dir = os.path.join(tmp_dir, "stems_b")
    os.makedirs(stems_a_dir, exist_ok=True)
    os.makedirs(stems_b_dir, exist_ok=True)

    if progress_cb:
        progress_cb("AI separating chunk (File A)...")
    stems_a = separate(chunk_a_path, stems_a_dir, progress_cb=progress_cb)

    if progress_cb:
        progress_cb("AI separating chunk (File B)...")
    stems_b = separate(chunk_b_path, stems_b_dir, progress_cb=progress_cb)

    # Analyze AI-separated stems for low-end categories
    if progress_cb:
        progress_cb("Analyzing AI stems...")

    # Level match the chunks
    _, chunk_b_matched, gain_applied = level_match(chunk_a, chunk_b, sr)
    gain_linear = 10 ** (gain_applied / 20) if gain_applied != 0 else 1.0

    ai_categories = {}
    for stem_name in ["drums", "bass"]:
        if stem_name in stems_a and stem_name in stems_b:
            ya, _ = librosa.load(stems_a[stem_name], sr=sr, mono=False)
            yb, _ = librosa.load(stems_b[stem_name], sr=sr, mono=False)
            if ya.ndim == 1:
                ya = np.stack([ya, ya])
            if yb.ndim == 1:
                yb = np.stack([yb, yb])
            ml = min(ya.shape[1], yb.shape[1])
            ya = ya[:, :ml]
            yb = yb[:, :ml] * gain_linear

            mono_sa = librosa.to_mono(ya)
            mono_sb = librosa.to_mono(yb)

            if stem_name == "drums":
                # Kick from drums
                kick_a = bandpass(mono_sa, sr, 50, 150)
                kick_b = bandpass(mono_sb, sr, 50, 150)
                ai_categories["Kick"] = analyze_category("Kick", kick_a, kick_b, ya, yb, sr)

                # Snare from drums
                snare_a = bandpass(mono_sa, sr, 150, 5000)
                snare_b = bandpass(mono_sb, sr, 150, 5000)
                ai_categories["Snare"] = analyze_category("Snare", snare_a, snare_b, ya, yb, sr)

            elif stem_name == "bass":
                # Sub from bass
                sub_a = bandpass(mono_sa, sr, 20, 80)
                sub_b = bandpass(mono_sb, sr, 20, 80)
                ai_categories["Sub"] = analyze_category("Sub", sub_a, sub_b, ya, yb, sr)

                # Bass body from bass
                bass_a = bandpass(mono_sa, sr, 80, 300)
                bass_b = bandpass(mono_sb, sr, 80, 300)
                ai_categories["Bass"] = analyze_category("Bass", bass_a, bass_b, ya, yb, sr)

    # Now run fast analysis on the full song for the remaining categories
    if progress_cb:
        progress_cb("Running frequency analysis on full song...")
    fast_result = run_fast_analysis(file_a, file_b, sr=sr)

    # Merge: replace Kick, Snare, Sub, Bass with AI versions
    merged_categories = []
    for cat in fast_result["categories"]:
        if cat["name"] in ai_categories:
            merged_categories.append(ai_categories[cat["name"]])
        else:
            merged_categories.append(cat)

    fast_result["categories"] = merged_categories

    # Update insights to note hybrid mode
    fast_result["overall"]["insights"].insert(0,
        "Hybrid analysis: AI stem separation for kick/snare/bass/sub, frequency bands for the rest"
    )

    # Include stem paths for the A/B player stem listening feature
    fast_result["stems"] = {
        "a": {name: path for name, path in stems_a.items()},
        "b": {name: path for name, path in stems_b.items()},
    }

    return _stamp_spec_versions(fast_result)
