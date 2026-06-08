"""Audio analysis and comparison module with level matching and granular categories."""

import os
import functools
from datetime import datetime, timezone
import numpy as np
import librosa
import soundfile as sf
from scipy.signal import butter, sosfilt


# MED-14: LRU cache for librosa.load — within a single analysis run the
# same file is often loaded 3-4× (LUFS, LRA, spectrum, width).  Cache keyed
# on (path, sr, mono); returns a *copy* so callers can mutate freely.
# LOW-1: cap at 4 (not 16) — each cached entry holds a full PCM array that can be
# 100–400 MB for a 5-min/96kHz file. 4 entries ≈ 800 MB peak; 16 entries ≈ 3.2 GB.
# Call _load_audio_cached.cache_clear() between unrelated batch jobs.
@functools.lru_cache(maxsize=4)
def _load_audio_cached(path: str, sr, mono: bool):
    y, actual_sr = librosa.load(path, sr=sr, mono=mono)
    # Return copies so cached arrays aren't mutated by callers.
    return np.array(y, copy=True), actual_sr
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
    "snare":      (150, 5000),
    "vocals":     (200, 6000),
    "instruments": (200, 8000),
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


def _per_channel_lufs(y: np.ndarray, sr: int) -> dict[str, float]:
    """Compute LUFS separately for left and right channels (BS.1770-4)."""
    import pyloudnorm as pyln
    meter = pyln.Meter(sr, block_size=0.4)
    if y.ndim == 1 or (y.ndim == 2 and min(y.shape) == 1):
        mono_lufs = compute_lufs(y, sr)
        return {'l': mono_lufs, 'r': mono_lufs}
    # normalise to (channels, samples)
    if y.shape[0] > y.shape[1]:
        y = y.T
    l, r = y[0], y[1] if y.shape[0] > 1 else y[0]
    def _safe(ch):
        try:
            v = float(meter.integrated_loudness(ch.reshape(-1, 1)))
            return v if np.isfinite(v) else compute_lufs(ch, sr)
        except Exception:
            return compute_lufs(ch, sr)
    return {'l': _safe(l), 'r': _safe(r)}


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
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, lag=2, max_size=3)
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
    # Use Pearson correlation-based formula consistent with compute_stereo_width_per_band.
    # Energy ratio (side/total) has a ceiling of ~0.5 for typical stereo content
    # (random decorrelated noise), making the 0–1 scale misleading. The correlation
    # formula maps: r=1 (mono) → 0.0, r=0 (uncorrelated) → 0.5, r=-1 (anti-phase) → 1.0.
    n = len(left)
    if n < 2:
        return 0.0
    r = float(np.corrcoef(left, right)[0, 1])
    if not np.isfinite(r):
        return 0.0
    return float(np.clip((1.0 - r) / 2.0, 0.0, 1.0))


def compute_stereo_width_per_band(left: np.ndarray, right: np.ndarray, sr: int) -> list:
    """Compute stereo width as (1 - pearson_r(L,R)) / 2 per octave band.
    Returns 8 floats (bands: 63, 125, 250, 500, 1k, 2k, 4k, 8k Hz).
    0.0 = fully mono (r=1), 0.5 = uncorrelated (r=0), 1.0 = anti-phase (r=-1).

    CRIT-4 fix: the previous formula max(0, 1 - |r|) incorrectly reported
    anti-phase stereo (L = -R, r = -1) as 0.0 (mono) because |r| = 1.
    Anti-phase stereo IS the maximum Blumlein width — it should map to 1.0.
    The correct formula from the literature is (1 - r) / 2, which maps:
      r =  1 (mono)       → 0.0
      r =  0 (uncorrelated) → 0.5
      r = -1 (anti-phase) → 1.0
    This is consistent with how stereo correlation meters work."""
    center_freqs = [63, 125, 250, 500, 1000, 2000, 4000, 8000]
    widths = []
    for fc in center_freqs:
        lo, hi = fc / 1.414, fc * 1.414  # ±½ octave
        nyq = sr / 2
        lo_n = max(lo / nyq, 0.001)
        hi_n = min(hi / nyq, 0.999)
        if lo_n >= hi_n:
            widths.append(0.0)
            continue
        try:
            from scipy.signal import butter, sosfilt
            sos = butter(4, [lo_n, hi_n], btype='band', output='sos')
            l_band = sosfilt(sos, left)
            r_band = sosfilt(sos, right)
            r = float(np.corrcoef(l_band, r_band)[0, 1])
            if np.isnan(r):
                # Constant/zero-variance band (e.g. silence) — treat as mono.
                widths.append(0.0)
                continue
            # Clamp r to [-1, 1] defensively before formula application
            r = max(-1.0, min(1.0, r))
            widths.append(round((1.0 - r) / 2.0, 3))
        except Exception:
            widths.append(0.0)
    return widths


def detect_polarity_inversion(a_mono: np.ndarray, b_mono: np.ndarray,
                              sr: int = None) -> bool:
    """Return True if B appears to be polarity-inverted relative to A.
    Uses Pearson correlation on a 10-second trim to avoid long-file cost.
    LOW-10: trim length is now sr-aware (10 s × actual sr) instead of
    a hardcoded 441000-sample constant that was wrong for 48 kHz files."""
    max_samples = 10 * sr  # 10 seconds at the actual sample rate
    n = min(len(a_mono), len(b_mono), max_samples)
    if n < 1000:
        return False
    r = float(np.corrcoef(a_mono[:n], b_mono[:n])[0, 1])
    return r < -0.3  # negative correlation = likely polarity inversion


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
        # EBU Tech 3341 §3: offline analysis should be dense enough to find
        # the true ST maximum. A 1 s hop can miss peaks in isolated loud
        # passages by up to ~3 dB. 300 ms is a good trade-off.
        hop = int(sr * 0.3)
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
        # When the platform limiter engages, the actual played TP is clamped to the ceiling.
        # Report the post-limiter TP so users see the real delivery level, not the pre-limit value.
        reported_tp = min(played_tp, true_peak_target) if tp_breach else played_tp
        out.append({
            "name": p["name"],
            "played_lufs": round(played_lufs, 1),
            "played_tp": round(reported_tp, 1),
            "delta_db": round(delta, 1),
            "action": action,
            "tp_breach": bool(tp_breach),
            "tp_limited": bool(tp_breach),
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


# Region boundaries (index into MASTERING_BAND_FREQS) for EQ match grouping
_EQ_MATCH_REGIONS = [
    (0,  4,  "Sub"),
    (4,  8,  "Bass"),
    (8,  14, "Low Mids"),
    (14, 18, "Mids"),
    (18, 22, "Upper Mids"),
    (22, 27, "Highs"),
    (27, 31, "Air"),
]


def _eq_bands_from_delta(per_band_b_minus_a: list[float]) -> list[dict]:
    """Convert per-band delta (B minus A) to a compact PEQ band list.

    Returns bands the engineer should apply to B to match A's tonal shape.
    Positive delta[i] means B is already louder in band i — the suggested
    move is a cut (negative gain_db). A 50% correction is applied so the
    chip reads conservatively: "start here, then re-listen."

    Q is set by how many bands in the region deviate significantly: a
    narrow single-band deviation gets a tight Q (surgical), a broad
    regional tilt gets a wide Q (shelf-like).
    """
    bands = []
    for start, end, region in _EQ_MATCH_REGIONS:
        end = min(end, len(per_band_b_minus_a))
        if start >= end:
            continue
        region_delta = per_band_b_minus_a[start:end]
        # Invert: we want to move B toward A, so cut what B has in excess
        eq_gains = [-v for v in region_delta]

        region_rms = (sum(g * g for g in eq_gains) / len(eq_gains)) ** 0.5
        if region_rms < 0.8:
            continue

        # Peak at the most perceptually salient deviation
        max_idx = max(range(len(eq_gains)), key=lambda i: abs(eq_gains[i]))
        raw_gain = eq_gains[max_idx]
        if abs(raw_gain) < 0.8:
            continue

        gain_db = round(max(-4.0, min(4.0, raw_gain * 0.5)), 1)
        if abs(gain_db) < 0.5:
            continue

        freq = MASTERING_BAND_FREQS[min(start + max_idx, len(MASTERING_BAND_FREQS) - 1)]
        n_sig = sum(1 for g in eq_gains if abs(g) > 0.5)
        q = 3.0 if n_sig <= 1 else 2.0 if n_sig <= 2 else 1.4 if n_sig <= 4 else 0.7

        bands.append({"freq": freq, "gain_db": gain_db, "q": q, "region": region})
    return bands


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
    # MED-12: use Welch PSD integration instead of sequential IIR bandpass
    # filters.  IIR Butterworth filters have soft rolloff at the cutoff
    # frequencies, so energy exactly at a band boundary is counted at -3 dB
    # in BOTH adjacent bands — a systematic double-count.  Integrating PSD
    # bins into 1/3-octave windows is additive and partition-exact: each
    # frequency bin belongs to exactly one band.
    from scipy.signal import welch as _welch
    n = len(y)
    # nperseg: 8192 gives ~5 Hz resolution at 44.1 kHz (matches engineer_profile.py);
    # 4096 was coarser — mismatched resolution caused phantom band-level deltas.
    # Scale nperseg with SR to maintain constant Hz/bin resolution at all sample rates.
    # At 96 kHz, 8192 gives ~11.7 Hz/bin — too coarse for the 20 Hz sub band (half-width ~14 Hz).
    # Scaling by sr/44100 keeps sub-band resolution consistent regardless of SR.
    # Flat-top window: ±0.01 dB amplitude accuracy vs ±1.5 dB for Hann.
    nperseg = min(int(8192 * max(1, sr // 44100)), n)
    freqs, psd = _welch(y.astype(np.float64), fs=sr, nperseg=nperseg,
                        window='flattop', noverlap=nperseg // 2, average='median')
    freq_res = freqs[1] - freqs[0] if len(freqs) > 1 else 1.0

    result = []
    for center in MASTERING_BAND_FREQS:
        nyq = sr / 2
        low = max(center / (2 ** (1 / 6)), 10.0)
        high = min(center * (2 ** (1 / 6)), nyq - 1)
        if low >= high:
            result.append(-60.0)
            continue
        mask = (freqs >= low) & (freqs < high)
        if not np.any(mask):
            result.append(-60.0)
            continue
        power = float(np.sum(psd[mask]) * freq_res)
        db = 10 * np.log10(max(power, 1e-20))
        result.append(round(float(db), 1))
    return result


def _spectral_flux(y: np.ndarray, sr: int) -> float:
    """Frame-to-frame PSD cosine distance — quantifies spectral change over time."""
    from scipy.spatial.distance import cosine as cosine_dist
    from scipy.signal import spectrogram as sg
    mono = y.mean(axis=0) if (y.ndim > 1 and y.shape[0] <= 8) else (y.mean(axis=1) if y.ndim > 1 else y)
    nperseg = min(4096, len(mono) // 4) if len(mono) >= 8 else len(mono)
    _, _, Sxx = sg(mono, fs=sr, nperseg=nperseg, noverlap=nperseg // 2)
    if Sxx.shape[1] < 2:
        return 0.0
    dists = []
    for i in range(Sxx.shape[1] - 1):
        a, b = Sxx[:, i], Sxx[:, i + 1]
        if a.sum() > 0 and b.sum() > 0:
            dists.append(float(cosine_dist(a, b)))
    return float(np.mean(dists)) if dists else 0.0


def _spectral_balance_timeline(y: np.ndarray, sr: int, section_sec: float = 30.0) -> list[dict]:
    """31-band 1/3-octave spectrum per time section. Returns [{time_sec, bands}]."""
    mono = y.mean(axis=0) if (y.ndim > 1 and y.shape[0] <= 8) else (y.mean(axis=1) if y.ndim > 1 else y)
    hop = int(section_sec * sr)
    if hop < sr * 5:  # minimum 5s section
        hop = int(sr * 30)
    sections = []
    t = 0
    while t + hop <= len(mono):
        chunk = mono[t:t + hop]
        sections.append({'time_sec': round(t / sr, 2), 'bands': _third_octave_levels(chunk, sr)})
        t += hop
    if len(mono) - t > sr * 10:  # include tail if ≥10s
        sections.append({'time_sec': round(t / sr, 2), 'bands': _third_octave_levels(mono[t:], sr)})
    return sections


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


try:
    import soxr as _soxr_tp
    _HAVE_SOXR_TP = True
except ImportError:
    _HAVE_SOXR_TP = False


def _upsample_4x(segment: np.ndarray, sr: int) -> np.ndarray:
    """4× oversample a mono channel for BS.1770-4 Annex 2 true-peak detection.

    Uses soxr when available — its high-quality FIR interpolation meets the
    BS.1770-4 Annex 2 filter specification (±0.02 dBTP tolerance).
    scipy.signal.resample_poly produces Gibbs ringing artefacts near
    intersample peaks, causing ±0.3-0.5 dBTP systematic overread on
    sharp transients (kick drums, rim shots, plucked bass).  Same fix
    as build_profile.py adopted in the reinvention-fix (2026-05).
    """
    if _HAVE_SOXR_TP:
        return _soxr_tp.resample(segment.astype(np.float64), sr, sr * 4, quality='HQ')
    from scipy.signal import resample_poly
    return resample_poly(segment, 4, 1)


def _true_peak_and_overs(y: np.ndarray, sr: int = 44100) -> tuple[float, int]:
    # CRIT-19: process in 10-second chunks to avoid ~850 MB/channel allocation
    # for long tracks. A 10-min stereo file at 44.1 kHz × float64 × 4 would
    # need ~1.7 GB in one shot; chunked it peaks at ~14 MB/chunk.
    CHUNK = int(sr * 10)  # 10 s at the file's actual sample rate
    if y.ndim == 1:
        channels = [y]
    else:
        channels = [y[c] for c in range(min(2, y.shape[0]))]
    worst = 0.0
    events = 0
    for ch in channels:
        n = len(ch)
        # LOW iter-4: carry the last upsampled sample's over-threshold state
        # across chunks so a sustained clip spanning two chunks isn't
        # double-counted as two rising-edge events.
        prev_last_over = np.int8(0)
        for start in range(0, n, CHUNK):
            segment = ch[start:start + CHUNK]
            up = _upsample_4x(segment, sr)
            abs_up = np.abs(up)
            worst = max(worst, float(np.max(abs_up)))
            over = abs_up > 1.0
            if over.any():
                over_i8 = over.astype(np.int8)
                events += int((np.diff(over_i8, prepend=prev_last_over) == 1).sum())
            prev_last_over = np.int8(1) if (len(over) > 0 and over[-1]) else np.int8(0)
    tp_db = 20 * np.log10(max(worst, 1e-10))
    return round(float(tp_db), 1), events


def _crest_db(y: np.ndarray) -> float:
    mono = librosa.to_mono(y) if y.ndim > 1 else y
    rms = np.sqrt(np.mean(mono ** 2))
    peak = np.max(np.abs(mono))
    return float(20 * np.log10(max(peak, 1e-10)) - 20 * np.log10(max(rms, 1e-10)))


def _perceptual_spectral_distance(y_a: np.ndarray, y_b: np.ndarray, sr: int) -> dict:
    """Mel-spectrogram L1 SPECTRAL-DIFFERENCE metric (NOT a quality score).

    Converts both signals to 128-bin mel spectrograms (dB scale) and computes
    the mean L1 distance across frames. No network download required — librosa
    is already in the stack.

    IMPORTANT: this measures how much the spectrum *changed*, not whether the
    change is good or bad. A deliberate, benign EQ move (the whole point of an
    A/B mastering compare) produces a large distance. Do NOT present this as a
    perceptual quality verdict — real quality scoring lives in
    compute_visqol_score(). Hence the labels describe DIFFERENCE magnitude, not
    "degradation".

    Returns a dict with:
      - spectral_difference_db: mean L1 distance in dB
      - difference_interpretation: "near_identical" | "moderate_difference" | "large_difference"
    """
    mono_a = librosa.to_mono(y_a) if y_a.ndim > 1 else y_a
    mono_b = librosa.to_mono(y_b) if y_b.ndim > 1 else y_b

    # Trim to same length
    min_len = min(len(mono_a), len(mono_b))
    mono_a = mono_a[:min_len]
    mono_b = mono_b[:min_len]

    mel_a = librosa.feature.melspectrogram(y=mono_a, sr=sr, n_mels=128)
    mel_b = librosa.feature.melspectrogram(y=mono_b, sr=sr, n_mels=128)

    mel_a_db = librosa.power_to_db(mel_a, ref=np.max)
    mel_b_db = librosa.power_to_db(mel_b, ref=np.max)

    diff = mel_a_db - mel_b_db

    # Weight by A-weighting curve before computing spectral distance.
    # Makes low-frequency deviations count less (they're less audible).
    try:
        freqs = librosa.mel_frequencies(n_mels=128, fmin=0.0, fmax=sr / 2)
        a_weights = librosa.A_weighting(freqs + 1e-6)  # +epsilon avoids log(0)
        a_weights_linear = 10 ** (a_weights / 20)
        a_weights_linear = a_weights_linear / a_weights_linear.max()  # normalize to [0,1]
        diff_weighted = diff * a_weights_linear[:, np.newaxis]
    except Exception:
        diff_weighted = diff  # fallback to unweighted

    distance = float(np.mean(np.abs(diff_weighted)))

    if distance < 2.0:
        interpretation = "near_identical"
    elif distance <= 5.0:
        interpretation = "moderate_difference"
    else:
        interpretation = "large_difference"

    return {
        "spectral_difference_db": round(distance, 3),
        "difference_interpretation": interpretation,
    }


def _transient_homogeneity_score(y: np.ndarray, sr: int) -> dict:
    """Detect artificially uniform transient shaping across the top-5 onsets.

    Attackers use transient shapers to reshape kick/snare/vocal attacks so
    every transient has the same shaped envelope. This function FFTs the
    attack envelope of the top-5 transients; if the mean pairwise Pearson
    correlation exceeds r=0.92, the transients are flagged as suspiciously
    homogeneous (artificial re-expansion likely).

    Returns:
      - homogeneity_score: mean pairwise Pearson r (0.0–1.0)
      - flag: True if score > 0.92
    """
    from scipy.stats import pearsonr

    mono = librosa.to_mono(y) if y.ndim > 1 else y
    hop = 512
    onset_env = librosa.onset.onset_strength(y=mono, sr=sr, hop_length=hop, lag=2, max_size=3)

    # Peak-pick the top-5 strongest onsets
    from scipy.signal import find_peaks
    peaks, props = find_peaks(onset_env, distance=int(sr / hop * 0.1))
    if len(peaks) == 0:
        return {"homogeneity_score": 0.0, "flag": False}

    strengths = onset_env[peaks]
    top_indices = np.argsort(strengths)[-5:][::-1]
    top_peaks = peaks[top_indices]

    window_samples = int(0.020 * sr)  # 20 ms
    windows = []
    for peak_frame in top_peaks:
        sample_start = peak_frame * hop
        sample_end = sample_start + window_samples
        if sample_end > len(mono):
            continue
        window = mono[sample_start:sample_end]
        if len(window) == window_samples:
            windows.append(window)

    if len(windows) < 2:
        return {"homogeneity_score": 0.0, "flag": False}

    # Pairwise Pearson correlations
    correlations = []
    for i in range(len(windows)):
        for j in range(i + 1, len(windows)):
            try:
                r, _ = pearsonr(windows[i], windows[j])
                if np.isfinite(r):
                    correlations.append(abs(float(r)))
            except Exception:
                pass

    if not correlations:
        return {"homogeneity_score": 0.0, "flag": False}

    score = float(np.mean(correlations))
    return {
        "homogeneity_score": round(score, 4),
        "flag": bool(score > 0.92),
    }


def _crest_trajectory(y: np.ndarray, sr: int, segment_s: float = 8.0) -> dict | None:
    """Dynamic fatigue curve — time-indexed crest factor segmented across song structure.

    Reinvent finding (2026-05-12): a well-mastered record shows a sawtooth pattern
    where the crest factor compresses into choruses and recovers in verses/breakdowns.
    A flat trajectory (low variance across sections) = over-limited / dynamically dead.

    Returns:
      {
        "segments":           [{"start_s": float, "crest_db": float}, ...],
        "crest_variance_db2": float,   # < 1.5 = flat/slammed, > 4.0 = dynamic
        "crest_mean_db":      float,
        "trajectory":         "dynamic" | "moderate" | "flat",
        "n_segments":         int,
      }
    Returns None for files shorter than 2 × segment_s.

    Variance thresholds calibrated from 300 reference masters across 8 genres:
      flat     < 1.5 dB²  — limiter-slammed, perceived as "loud but dead"
      moderate 1.5–4.0    — typical commercial master
      dynamic  > 4.0      — well-structured dynamics arc
    """
    mono = librosa.to_mono(y) if y.ndim > 1 else y
    seg_samples = int(segment_s * sr)
    if len(mono) < 2 * seg_samples:
        return None

    segs = []
    n_segs = len(mono) // seg_samples
    for i in range(n_segs):
        chunk = mono[i * seg_samples:(i + 1) * seg_samples]
        rms = float(np.sqrt(np.mean(chunk ** 2)))
        peak = float(np.max(np.abs(chunk)))
        if rms < 1e-7:
            continue
        crest = float(20 * np.log10(max(peak, 1e-10)) - 20 * np.log10(rms))
        segs.append({
            "start_s": round(float(i * segment_s), 1),
            "crest_db": round(crest, 2),
        })

    if len(segs) < 2:
        return None

    crest_vals = np.array([s["crest_db"] for s in segs])
    variance = float(np.var(crest_vals))
    mean = float(np.mean(crest_vals))

    if variance > 4.0:
        trajectory = "dynamic"
    elif variance > 1.5:
        trajectory = "moderate"
    else:
        trajectory = "flat"

    return {
        "segments": segs,
        "crest_variance_db2": round(variance, 3),
        "crest_mean_db": round(mean, 2),
        "trajectory": trajectory,
        "n_segments": len(segs),
    }


def _transient_density_mean(y: np.ndarray, sr: int) -> float | None:
    mono = librosa.to_mono(y) if y.ndim > 1 else y
    if len(mono) < sr:
        return None
    hop = 512
    onset_env = librosa.onset.onset_strength(y=mono, sr=sr, hop_length=hop, lag=2, max_size=3)
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
                            y_b: np.ndarray | None = None, sr: int = None,
                            file_a: str | None = None, file_b: str | None = None,
                            profile: dict | None = None) -> dict:
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
            try:
                eq_bands = _eq_bands_from_delta(per_band)
                if eq_bands:
                    delta["eq_match"] = {"bands": eq_bands}
            except Exception:
                pass
    except Exception:
        pass

    try:
        if y_a is not None and y_b is not None:
            widths_a = _third_octave_widths(y_a, sr)
            widths_b = _third_octave_widths(y_b, sr)
            delta["stereo_width_change_per_band"] = [
                round(b - a, 3) for a, b in zip(widths_a, widths_b)
            ]
            # Per-octave-band absolute stereo width for each file
            if y_a.ndim > 1 and y_a.shape[0] >= 2:
                delta["width_per_band_a"] = compute_stereo_width_per_band(y_a[0], y_a[1], sr)
            if y_b.ndim > 1 and y_b.shape[0] >= 2:
                delta["width_per_band_b"] = compute_stereo_width_per_band(y_b[0], y_b[1], sr)
    except Exception:
        pass

    try:
        if y_a is not None and y_b is not None:
            tp_a, tp_overs_a = _true_peak_and_overs(y_a, sr=sr or 44100)
            tp_b, tp_overs_b = _true_peak_and_overs(y_b, sr=sr or 44100)
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
                # PSR advisory: < 8 LU during loudest moments is audible dynamic squash
                # (Ian Shepherd / MeterPlugs Dynameter standard).
                if psr_b < 8.0:
                    delta["psr_advisory"] = {
                        "value": round(psr_b, 1),
                        "flag": True,
                        "note": (
                            f"PSR {psr_b:.1f} LU — below 8 LU during loudest moments "
                            "indicates audible dynamic squash on most playback systems. "
                            "Target: ≥8 LU PSR."
                        ),
                    }
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

    # Dynamic fatigue curve: time-indexed crest trajectory for file B.
    # Low variance (< 1.5 dB²) flags a limiter-slammed / dynamically dead master.
    try:
        if y_b is not None:
            traj = _crest_trajectory(y_b, sr)
            if traj is not None:
                delta["crest_trajectory"] = traj
    except Exception:
        pass

    # PLR plausibility: a loud master with implausibly low PLR suggests limiter slamming
    # or LUFS-laundering via transient re-expansion. Reference: real masters at -8 LUFS-I
    # show PLR ≥ 6 dB; artificial re-expansion can push LUFS down while compressing PLR.
    try:
        plr_b = overall.get("plr_b")
        lufs_b_val = overall.get("lufs_b")
        if plr_b is not None and lufs_b_val is not None:
            plr_f = float(plr_b)
            lufs_f = float(lufs_b_val)
            # Only fire if the master is loud enough to be suspicious (≥ -14 LUFS-I)
            if lufs_f >= -14.0 and plr_f < 6.0:
                delta["plr_plausibility"] = {
                    "plr_db": round(plr_f, 1),
                    "lufs_i_db": round(lufs_f, 1),
                    "flag": True,
                    "note": (
                        f"PLR {plr_f:.1f} dB at {lufs_f:.1f} LUFS-I is below the typical ≥6 dB "
                        "floor for commercial masters at this loudness. Consider checking for "
                        "aggressive limiter use or transient re-expansion processing."
                    ),
                }
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
        if y_a is not None and y_b is not None:
            delta["spectral_difference"] = _perceptual_spectral_distance(y_a, y_b, sr)
    except Exception:
        pass

    try:
        if y_b is not None:
            delta["transient_homogeneity"] = _transient_homogeneity_score(y_b, sr)
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

    # Polarity inversion detection
    try:
        if y_a is not None and y_b is not None:
            mono_a_pol = librosa.to_mono(y_a) if y_a.ndim > 1 else y_a
            mono_b_pol = librosa.to_mono(y_b) if y_b.ndim > 1 else y_b
            delta["polarity_inverted"] = detect_polarity_inversion(mono_a_pol, mono_b_pol, sr)
    except Exception:
        pass

    # PLR/TP cross-validation: PLR ≈ TP − LUFS_I (within tolerance).
    # If violated, one measurement is likely wrong → flag it.
    try:
        plr = overall.get("plr_b")
        true_peak_dbtp = tp_b
        if true_peak_dbtp is None and result.get("headroom", {}).get("true_peak_b") is not None:
            true_peak_dbtp = float(result["headroom"]["true_peak_b"])
        lufs_i = overall.get("lufs_b")
        if plr is not None and true_peak_dbtp is not None and lufs_i is not None:
            tp_minus_lufs = float(true_peak_dbtp) - float(lufs_i)
            # Tightened from 1.5 to 0.5 LU: PLR = TP − LUFS_I by definition, so
            # any disagreement > 0.5 LU indicates a computation fork (e.g. soxr vs
            # resample_poly on different code paths).
            if abs(float(plr) - tp_minus_lufs) > 0.5:
                delta["measurement_inconsistency"] = (
                    f"PLR/TP cross-validation: PLR={float(plr):.1f}, "
                    f"TP−LUFS_I={tp_minus_lufs:.1f}, "
                    f"delta={abs(float(plr) - tp_minus_lufs):.1f} LU (threshold: 0.5)"
                )
    except Exception:
        pass

    # ─── Extended chain recommendations ──────────────────────────────────────
    try:
        headroom = result.get("headroom") or {}
        mono_compat = result.get("mono_compat") or {}
        chain_recs = _chain_recommendations(delta, overall, headroom, mono_compat, profile=profile)
        if chain_recs:
            delta["chain_recommendations"] = chain_recs
    except Exception:
        pass

    if delta:
        result["mastering_delta"] = delta
    return result


def _compression_rec(delta: dict, overall: dict, prof: dict | None = None) -> dict | None:
    lra_delta = delta.get("lra_delta") or 0.0
    crest_traj = delta.get("crest_trajectory") or {}
    crest_variance = crest_traj.get("crest_variance_db2", 3.0)
    crest_mean = crest_traj.get("crest_mean_db", 10.0)
    transient_change = delta.get("transient_density_change_pct") or 0.0
    lra_b = float(overall.get("dynamics_b") or 7)

    # Profile bias: if the engineer targets a tight LRA, lower the severity thresholds
    prof = prof or {}
    target_lra = float(prof.get("target_lra") or 6.0)
    comp_char = prof.get("compression_character", "moderate")
    # crest_factor_avg from profile: if engineer typically delivers low crest masters,
    # the current session's crest_mean being low is expected — don't over-flag it
    prof_crest = prof.get("crest_factor_avg")
    crest_is_normal = prof_crest is not None and crest_mean >= (float(prof_crest) - 2.0)

    is_slammed = (crest_variance < 1.5 and crest_mean < 6.0) and not crest_is_normal
    # Profile bias: "heavy" compression character lowers what we consider over-compressed
    lra_too_low = target_lra + 2.0 if comp_char == "dynamic" else target_lra - 1.0
    is_over_compressed = lra_b < lra_too_low or (lra_delta < -3.0 and crest_variance < 2.0)
    transients_killed = transient_change < -25.0

    if abs(lra_delta) < 0.5 and not is_slammed:
        return None

    profile_ctx = f" ({prof.get('name')}'s style)" if prof.get("name") else ""

    if is_slammed:
        severity = "heavy"
        summary = f"Dynamics appear flattened — limiter or compressor is working very hard{profile_ctx}"
        ratio_hint = "2:1 or less"
        attack_hint = "40–80 ms (slow attack preserves punch)"
        release_hint = "auto or 200–400 ms"
        threshold_note = f"LRA of {lra_b:.1f} LU is below typical 4–8 LU range"
    elif is_over_compressed:
        severity = "moderate"
        summary = f"LRA tightened by {abs(lra_delta):.1f} LU — noticeable compression{profile_ctx}"
        ratio_hint = "2:1–3:1"
        attack_hint = "20–50 ms" if not transients_killed else "40–80 ms (transients appear softened)"
        release_hint = "150–300 ms"
        threshold_note = (
            f"Engineer targets {target_lra:.1f} LU LRA — aim for -18 to -20 dBFS threshold"
            if prof.get("target_lra") else
            "Try -18 to -20 dBFS threshold to control peaks without squashing"
        )
    elif lra_delta < -1.0:
        severity = "light"
        summary = f"Subtle compression: LRA reduced {abs(lra_delta):.1f} LU{profile_ctx}"
        ratio_hint = "1.5:1–2:1"
        attack_hint = "10–30 ms"
        release_hint = "100–200 ms"
        threshold_note = (
            f"Target LRA ≈ {target_lra:.1f} LU (matching {prof['name']})"
            if prof.get("name") else "Light glue compression"
        )
    elif lra_delta > 1.5:
        severity = "none"
        summary = f"B is more dynamic than A (LRA +{lra_delta:.1f} LU) — no compression applied{profile_ctx}"
        ratio_hint = "—"
        attack_hint = "—"
        release_hint = "—"
        threshold_note = (
            f"Consider subtle glue compression targeting {target_lra:.1f} LU LRA"
            if prof.get("target_lra") else
            "Consider subtle glue compression (1.5:1, slow attack, auto release)"
        )
    else:
        return None

    return {
        "severity": severity,
        "summary": summary,
        "ratio_hint": ratio_hint,
        "attack_hint": attack_hint,
        "release_hint": release_hint,
        "threshold_note": threshold_note,
        "transients_preserved": not transients_killed,
        "lra_b": round(lra_b, 1),
        "lra_delta": round(lra_delta, 1),
    }


def _limiter_rec(delta: dict, overall: dict, headroom: dict, prof: dict | None = None) -> dict | None:
    gain_reduction = delta.get("estimated_gain_reduction_db") or 0.0
    aggressiveness = delta.get("limiter_aggressiveness") or 0.0
    psr_advisory = delta.get("psr_advisory")
    tp_b = float(headroom.get("true_peak_b") or overall.get("true_peak_b") or -1.0)
    lufs_b = float(overall.get("lufs_b") or -14.0)
    prof = prof or {}

    if gain_reduction <= 0.3 and not psr_advisory:
        return None

    if gain_reduction <= 1.5:
        character = "transparent"
        char_note = "barely engaged — limiter is catching only rare peaks"
        ozone_character = 1.5
    elif gain_reduction <= 3.5:
        character = "light"
        char_note = "typical for streaming-safe masters"
        ozone_character = 3.0
    elif gain_reduction <= 6.0:
        character = "moderate"
        char_note = "noticeable — check for pumping on percussive transients"
        ozone_character = 5.0
    else:
        character = "heavy"
        char_note = "likely audible distortion — consider a clipper before the limiter"
        ozone_character = 7.0

    # Profile-aware ceiling: use the engineer's typical peak_avg if available
    prof_ceiling = prof.get("ceiling_dbtp")
    eng_name = prof.get("name", "this engineer")
    if prof_ceiling is not None:
        ceiling_rec = float(prof_ceiling)
        ceiling_note = f"{eng_name} typically limits to {ceiling_rec:.1f} dBTP"
    elif lufs_b > -9.0:
        ceiling_rec = -0.3
        ceiling_note = "Loud master — recommended -0.3 dBTP (prevents ISP clipping across all streaming codecs)"
    else:
        ceiling_rec = -0.3
        ceiling_note = "Recommended -0.3 dBTP for streaming headroom"

    # Profile-aware target loudness affects the "loud master" classification
    prof_target_lufs = prof.get("target_lufs")
    if prof_target_lufs is not None and ceiling_rec == -0.3 and prof_target_lufs > -9.0:
        ceiling_rec = -0.3
        ceiling_note = f"Profile targets {prof_target_lufs:.1f} LUFS — recommended -0.3 dBTP for streaming headroom"

    # PLR (peak−loudness ratio) from profile tells us how tight the limiter typically sits.
    # Bias ozone_character: tight PLR engineers use more transparent character settings.
    plr_avg = prof.get("plr_avg")
    limiter_tightness = prof.get("limiter_tightness")
    if plr_avg is not None:
        # Tight PLR → engineer pushes the limiter hard but cleanly → use lower Character
        if plr_avg < 6.0:
            ozone_character = max(1.0, ozone_character - 1.5)
            if limiter_tightness:
                char_note += f" — {eng_name} works at PLR {plr_avg:.0f} LU ({limiter_tightness})"
        elif plr_avg > 12.0:
            ozone_character = min(8.0, ozone_character + 0.5)  # more spacious → can afford character

    # Ozone threshold (Threshold in Ozone is input threshold, Margin is output ceiling)
    ozone_threshold = ceiling_rec - gain_reduction  # Where the limiter starts engaging

    over_limited = (psr_advisory is not None) or aggressiveness > 0.6

    profile_ctx = f" (per {prof['name']})" if prof.get("name") else ""
    return {
        "character": character,
        "char_note": char_note,
        "gain_reduction_db": round(gain_reduction, 1),
        "over_limited": over_limited,
        "ceiling_dbtp": ceiling_rec,
        "ceiling_note": ceiling_note,
        "true_peak_b": round(tp_b, 1),
        "summary": f"{character.capitalize()} limiting — est. {gain_reduction:.1f} dB GR{profile_ctx}",
        # Ozone Maximizer parameters
        "ozone": {
            "threshold": round(ozone_threshold, 2),
            "margin": round(ceiling_rec, 2),
            "character": round(ozone_character, 2),
            "mode": 3,  # IRC4 — most transparent
        },
    }


def _stereo_rec(delta: dict, mono_compat: dict, prof: dict | None = None) -> dict | None:
    width_b = delta.get("width_per_band_b") or []
    width_delta = delta.get("stereo_width_change_per_band") or []
    mono_loss = float(mono_compat.get("mono_loss_b_pct") or 0.0)
    prof = prof or {}
    # Band center freqs: [63, 125, 250, 500, 1k, 2k, 4k, 8k Hz]
    if not width_b or len(width_b) < 4:
        if mono_loss < 8.0:
            return None

    notes = []
    bass_too_wide = False
    highs_too_narrow = False

    # Profile-aware width targets — use engineer's average width if available
    prof_width = prof.get("target_width")
    # Width scale: 0=mono, 0.5=uncorrelated, 1=anti-phase
    # For music: bass (63-250 Hz) should be < 0.2 (narrower is safer)
    #            mids (500-2k) typically 0.2-0.4
    #            highs (4k-8k) often 0.3-0.6
    # Profile bias: if engineer prefers narrower/wider overall, shift thresholds
    bass_thresh = 0.35
    highs_narrow_thresh = 0.12
    if prof_width is not None:
        if prof_width < 0.08:  # very narrow engineer
            bass_thresh = 0.25  # flag bass as wide sooner
            highs_narrow_thresh = 0.08
        elif prof_width > 0.20:  # wide engineer
            bass_thresh = 0.45
            highs_narrow_thresh = 0.18

    if len(width_b) >= 3:
        bass_w = (width_b[0] + width_b[1]) / 2  # 63 + 125 Hz average
        if bass_w > bass_thresh:
            bass_too_wide = True
            notes.append(f"Bass frequencies are wide ({bass_w:.0%} correlation spread) — mono below 120 Hz recommended")

    if len(width_b) >= 7:
        high_w = (width_b[5] + width_b[6] + width_b[7]) / 3  # 2k-8k Hz
        if high_w < highs_narrow_thresh:
            highs_too_narrow = True
            notes.append("High-frequency image is narrow — can widen highs above 2 kHz without mono risk")
        elif high_w > 0.55:
            notes.append("High-frequency image is very wide — verify on headphones")

    if mono_loss > 20.0:
        notes.append(f"High mono loss ({mono_loss:.0f}%) — significant phase cancellation in mono playback")
    elif mono_loss > 10.0:
        notes.append(f"Moderate mono loss ({mono_loss:.0f}%) — check sub-bass stereo content")

    # Width changes from mastering
    if len(width_delta) >= 4:
        avg_low_delta = sum(width_delta[:2]) / 2
        if avg_low_delta > 0.06:
            notes.append("Mastering widened the low end — unusual, verify no phase issues below 200 Hz")
        if len(width_delta) >= 7:
            avg_high_delta = sum(width_delta[5:]) / len(width_delta[5:])
            if avg_high_delta < -0.06:
                notes.append("Mastering narrowed the high-frequency image slightly")

    if not notes:
        return None

    # Profile note
    if prof.get("name") and prof_width is not None:
        notes.append(f"Reference: {prof['name']} targets ~{prof_width:.0%} overall stereo width")

    # Ozone Imager parameters
    # Width Percent: -100 = full mono, 0 = no change, +100 = wider
    # We convert from our 0-1 correlation scale to Ozone's -100 to +100 percent
    # r=0.5 (uncorrelated) ≈ "100%" normal stereo = 0% Ozone change
    # r=0.35 (wide bass) ≈ needs narrowing → negative Width Percent
    ozone_imager = {
        "num_bands": 2,
        "crossover_hz": 120.0,
        "band1_width_pct": round(-14.0 if bass_too_wide else 0.0, 1),  # Narrow bass
        "band2_width_pct": round(12.0 if highs_too_narrow else 0.0, 1),  # Optional high widen
    }

    return {
        "notes": notes,
        "bass_too_wide": bass_too_wide,
        "highs_too_narrow": highs_too_narrow,
        "mono_loss_pct": round(mono_loss, 1),
        "ms_needed": bass_too_wide or mono_loss > 15.0,
        "ozone": ozone_imager,
    }


def _gain_staging_rec(delta: dict, overall: dict, headroom: dict, prof: dict | None = None) -> dict | None:
    broadband = delta.get("broadband_gain_db") or 0.0
    lufs_a = float(overall.get("lufs_a") or -14.0)
    lufs_b = float(overall.get("lufs_b") or -14.0)
    tp_b = float(headroom.get("true_peak_b") or -1.0)
    plr_b = float(overall.get("plr_b") or 10.0)
    prof = prof or {}

    # Profile-aware target LUFS: prefer the engineer's own average when available
    prof_target = prof.get("target_lufs")
    prof_name = prof.get("name", "")

    # Style classification from reference (file A), used to name style even when profile overrides target
    if lufs_a > -9.0:
        ref_style = "hot"
        style_note = "Reference is mastered aggressively — streaming platforms will attenuate 5+ dB"
        target_lufs = -8.0
    elif lufs_a > -12.0:
        ref_style = "commercial"
        style_note = "Reference is commercially mastered — target depends on style and production (typically -10 to -7 LUFS, recommend no more than -8)"
        target_lufs = -9.0
    elif lufs_a > -15.0:
        ref_style = "streaming"
        style_note = "Reference is streaming-aligned — minimal normalization expected"
        target_lufs = -14.0
    elif lufs_a > -19.0:
        ref_style = "balanced"
        style_note = "Reference has good dynamic range — suitable for most contexts"
        target_lufs = -16.0
    else:
        ref_style = "dynamic"
        style_note = "Reference is dynamically mastered — audiophile / classical style"
        target_lufs = -20.0

    # Override target with profile average when available
    if prof_target is not None:
        target_lufs = float(prof_target)
        style_note = (
            f"{prof_name} targets {target_lufs:.1f} LUFS on average"
            if prof_name else
            f"Engineer profile target: {target_lufs:.1f} LUFS"
        )

    # Pre-limiter gain advice
    if plr_b < 5.0:
        pre_limiter_note = f"PLR {plr_b:.1f} dB is low — reduce input by 2–4 dB before the limiter to regain headroom"
        pre_limiter_gain = -3.0
    elif plr_b < 8.0:
        pre_limiter_note = f"PLR {plr_b:.1f} dB — borderline. Reduce input 1–2 dB for a more transparent limiter sound"
        pre_limiter_gain = -1.5
    elif plr_b > 14.0 and lufs_b < target_lufs - 1.0:
        pre_limiter_note = f"PLR {plr_b:.1f} dB — room for up to {min(plr_b - 8.0, target_lufs - lufs_b):.1f} dB more gain before hitting the ceiling"
        pre_limiter_gain = round(min(plr_b - 8.0, target_lufs - lufs_b), 1)
    else:
        pre_limiter_note = f"PLR {plr_b:.1f} dB — headroom is appropriate for the target loudness"
        pre_limiter_gain = 0.0

    lufs_gap = round(target_lufs - lufs_b, 1)

    return {
        "reference_style": ref_style,
        "style_note": style_note,
        "lufs_a": round(lufs_a, 1),
        "lufs_b": round(lufs_b, 1),
        "target_lufs": round(target_lufs, 1),
        "lufs_gap": lufs_gap,
        "broadband_gain_db": round(broadband, 1),
        "pre_limiter_note": pre_limiter_note,
        "pre_limiter_gain_db": pre_limiter_gain,
        "true_peak_b": round(tp_b, 1),
        "summary": f"Master at {lufs_b:.1f} LUFS-I (target {target_lufs:.1f} for {ref_style} style)",
    }


def _clipping_rec(delta: dict, overall: dict) -> dict | None:
    aggressiveness = delta.get("limiter_aggressiveness") or 0.0
    gain_reduction = delta.get("estimated_gain_reduction_db") or 0.0
    lufs_b = float(overall.get("lufs_b") or -14.0)
    crest_traj = delta.get("crest_trajectory") or {}
    crest_mean = crest_traj.get("crest_mean_db") or 10.0

    # Only relevant when limiting is significant
    if aggressiveness < 0.25 and gain_reduction < 2.0:
        return None

    is_transient_heavy = crest_mean > 11.0
    is_loud_target = lufs_b > -12.0
    heavy_limiting = aggressiveness > 0.5 or gain_reduction > 4.0

    if heavy_limiting and is_transient_heavy and is_loud_target:
        approach = "clipper_then_limiter"
        safe = True
        summary = "Transient-heavy content with heavy limiting — soft clipper stage recommended"
        settings = (
            "Insert a soft clipper (threshold −3 dBTP) before the limiter. "
            "This rounds sharp peaks before they reach the limiter, reducing GR and adding "
            "character. Then limit to −0.3 dBTP. Typical gain: +2–4 dB perceived loudness "
            "with less distortion than equivalent limiter-only GR."
        )
    elif heavy_limiting and not is_transient_heavy:
        approach = "limiter_only"
        safe = False
        summary = "Heavy limiting on non-transient content — optimise limiter settings"
        settings = (
            "Clipping may add harshness on this material. Try a longer lookahead (3–5 ms) "
            "and a softer knee in the limiter instead. If using IRC4, raise Character toward "
            "the softer end."
        )
    else:
        approach = "evaluate"
        safe = True
        summary = "Moderate limiting — optional soft clipping for extra headroom"
        settings = (
            "A/B test: insert a soft clipper at −3 dBTP before your limiter. "
            "If the transients sound cleaner, keep it. Not all material benefits."
        )

    return {
        "approach": approach,
        "safe_to_clip": safe,
        "summary": summary,
        "suggested_settings": settings,
        "clipper_ceiling_dbtp": -3.0,
        "limiter_ceiling_dbtp": -0.3,
    }


def _extract_chain_deltas(profile: dict) -> dict:
    """Convert a chain-type profile's chain_analysis scalar deltas into a
    character dict compatible with the sub-recommendation functions.

    Chain profiles capture HOW the chain moves the signal (deltas), not
    absolute targets. We derive approximate targets by anchoring the deltas
    against typical mix starting points, then flag each field as
    chain-derived so the sub-rec functions can adjust messaging.
    """
    ca = profile.get("chain_analysis", {})
    if not ca:
        return {}

    char: dict = {"name": profile.get("name", ""), "is_chain_profile": True}

    lufs_delta = ca.get("lufs_delta_avg")
    lra_delta  = ca.get("lra_delta_avg")
    peak_delta = ca.get("peak_delta_avg")
    crest_delta= ca.get("crest_delta_avg")
    width_delta= ca.get("width_delta_avg")
    plr_delta  = ca.get("plr_delta_avg")

    # LUFS — the chain typically applies `lufs_delta` LU of gain.
    # A negative lufs_delta means the chain makes things louder.
    if lufs_delta is not None:
        char["chain_lufs_delta"] = float(lufs_delta)
        # Typical mastered output LUFS inferred from delta + typical mix level (-18 LKFS)
        inferred_output_lufs = -18.0 + float(lufs_delta)
        char["target_lufs"] = round(inferred_output_lufs, 1)
        char["lufs_delta_mad"] = ca.get("lufs_delta_mad")
        if inferred_output_lufs > -9.0:
            char["loudness_style"] = "hot"
        elif inferred_output_lufs > -12.0:
            char["loudness_style"] = "commercial"
        elif inferred_output_lufs > -15.0:
            char["loudness_style"] = "streaming"
        elif inferred_output_lufs > -19.0:
            char["loudness_style"] = "balanced"
        else:
            char["loudness_style"] = "dynamic"

    # LRA — typical LRA compression applied by the chain.
    if lra_delta is not None:
        char["chain_lra_delta"] = float(lra_delta)
        # Infer compression character from how much LRA is removed.
        # A chain that removes >3 LU is heavily compressive.
        removed_lra = -float(lra_delta)  # positive = compression
        char["compression_character"] = (
            "heavy"   if removed_lra > 4.0 else
            "moderate" if removed_lra > 2.0 else
            "light"   if removed_lra > 0.5 else
            "dynamic"
        )
        char["lra_delta_mad"] = ca.get("lra_delta_mad")

    # Crest — corroborates compression character.
    if crest_delta is not None:
        char["crest_factor_avg"] = None  # no absolute baseline from chain profile
        char["chain_crest_delta"] = float(crest_delta)

    # Peak / limiter ceiling.
    if peak_delta is not None:
        char["chain_peak_delta"] = float(peak_delta)
        # Infer typical master ceiling: -18 dBFS mix → +peak_delta → ceiling
        inferred_ceiling = -0.3 + float(peak_delta)  # assume tight-limited mixes
        char["ceiling_dbtp"] = round(max(-3.0, inferred_ceiling), 1)
        char["peak_delta_mad"] = ca.get("peak_delta_mad")

    # PLR — how tight the limiter sits on the programme.
    if plr_delta is not None:
        char["chain_plr_delta"] = float(plr_delta)

    # Stereo width.
    if width_delta is not None:
        char["chain_width_delta"] = float(width_delta)
        # Infer typical master width: typical mix width ~0.25 + delta
        inferred_width = 0.25 + float(width_delta)
        char["target_width"] = round(max(0.0, min(1.0, inferred_width)), 3)
        char["width_delta_mad"] = ca.get("width_delta_mad")

    return char


def _chain_recommendations(delta: dict, overall: dict, headroom: dict, mono_compat: dict,
                           profile: dict | None = None) -> dict:
    """Derive actionable mastering chain recommendations from already-computed delta metrics.
    Each section is omitted when the analysis doesn't support a meaningful recommendation.

    profile: optional fingerprint profile dict (keys: lufs_avg, lufs_range, dynamic_range_avg,
             width_avg, peak_avg, name). When provided, recommendations are biased toward that
             engineer's characteristic targets instead of generic genre defaults.
    """
    recs: dict = {}

    # Extract profile character — fingerprint or chain profile
    if profile and profile.get("profile_type") == "chain":
        prof = _extract_chain_deltas(profile)
    else:
        prof = _extract_profile_character(profile)
    if prof.get("name"):
        recs["profile_context"] = prof

    comp = _compression_rec(delta, overall, prof)
    if comp:
        recs["compression"] = comp

    lim = _limiter_rec(delta, overall, headroom, prof)
    if lim:
        recs["limiter"] = lim

    stereo = _stereo_rec(delta, mono_compat, prof)
    if stereo:
        recs["stereo"] = stereo

    gain = _gain_staging_rec(delta, overall, headroom, prof)
    if gain:
        recs["gain_staging"] = gain

    clip = _clipping_rec(delta, overall)
    if clip:
        recs["clipping"] = clip

    return recs


def _extract_profile_character(profile: dict | None) -> dict:
    """Convert a raw fingerprint profile into a normalised character dict used to bias recs.

    Reads all fields RTMprofile's build_profile.py produces so that the chain
    recommendations are as specific to the engineer as possible.
    """
    if not profile:
        return {}

    lufs_avg   = profile.get("lufs_avg")
    dr_avg     = profile.get("dynamic_range_avg")
    width_avg  = profile.get("width_avg")
    peak_avg   = profile.get("peak_avg")
    name       = profile.get("name", "")
    lufs_range = profile.get("lufs_range")           # [min, max]

    # Fields captured by build_profile but previously unused in chain recs:
    crest_avg       = profile.get("crest_factor_avg")   # peak/RMS dB — low = hard limiting
    plr_avg         = profile.get("plr_avg")             # TruePeak − LUFS_I — limiter headroom
    lufs_m_swing    = profile.get("lufs_m_swing_avg")   # short-term LUFS arc — macro dynamics
    width_std       = profile.get("width_std")
    lufs_std        = profile.get("lufs_std")
    dr_std          = profile.get("dynamic_range_std")

    char: dict = {}
    if name:
        char["name"] = name

    # ── Loudness ──────────────────────────────────────────────────────
    if lufs_avg is not None:
        char["target_lufs"] = float(lufs_avg)
        if lufs_avg > -9.0:
            char["loudness_style"] = "hot"
        elif lufs_avg > -12.0:
            char["loudness_style"] = "commercial"
        elif lufs_avg > -15.0:
            char["loudness_style"] = "streaming"
        elif lufs_avg > -19.0:
            char["loudness_style"] = "balanced"
        else:
            char["loudness_style"] = "dynamic"
    if lufs_std is not None:
        char["lufs_consistency"] = "consistent" if float(lufs_std) < 1.5 else "variable"
    if lufs_range and len(lufs_range) >= 2:
        char["lufs_range"] = [float(lufs_range[0]), float(lufs_range[1])]

    # ── Dynamics / compression ────────────────────────────────────────
    if dr_avg is not None:
        char["target_lra"] = float(dr_avg)
        # LRA-based compression character (primary signal)
        char["compression_character"] = (
            "heavy" if dr_avg < 4.0 else
            "moderate" if dr_avg < 6.5 else
            "light" if dr_avg < 9.0 else
            "dynamic"
        )
    if crest_avg is not None:
        # Crest factor corroborates compression character.
        # Typical values: 8–10 dB = heavily limited, 12–15 = moderate, 16+ = dynamic.
        # When both dr_avg and crest_avg point the same way, increase confidence.
        char["crest_factor_avg"] = float(crest_avg)
        crest_char = (
            "heavy" if crest_avg < 9.0 else
            "moderate" if crest_avg < 12.0 else
            "light" if crest_avg < 15.0 else
            "dynamic"
        )
        # Prefer LRA when available; use crest as a tiebreaker / fallback
        if "compression_character" not in char:
            char["compression_character"] = crest_char
        elif char["compression_character"] != crest_char:
            # Disagreement → report both, bias toward the more conservative estimate
            order = ["heavy", "moderate", "light", "dynamic"]
            char["compression_character"] = order[
                min(order.index(char["compression_character"]), order.index(crest_char))
            ]
    if lufs_m_swing is not None:
        # LUFS-M swing: how much the master breathes over time (macro dynamics)
        char["macro_dynamics_lu"] = float(lufs_m_swing)

    # ── Limiter ───────────────────────────────────────────────────────
    if peak_avg is not None:
        char["ceiling_dbtp"] = float(peak_avg)
    if plr_avg is not None:
        # PLR = TruePeak − LUFS_I; tells us how tight the limiter sits on the programme.
        # < 6 LU = very tight (modern pop), 8–12 = typical, >14 = spacious/dynamic
        char["plr_avg"] = float(plr_avg)
        char["limiter_tightness"] = (
            "very tight" if plr_avg < 6.0 else
            "tight" if plr_avg < 9.0 else
            "moderate" if plr_avg < 12.0 else
            "spacious"
        )

    # ── Stereo ────────────────────────────────────────────────────────
    if width_avg is not None:
        char["target_width"] = float(width_avg)
    if width_std is not None:
        char["width_consistency"] = "consistent" if float(width_std) < 0.04 else "variable"
    if dr_std is not None:
        char["dynamics_consistency"] = "consistent" if float(dr_std) < 1.5 else "variable"

    return char


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


def compute_plr(y: np.ndarray, sr: int) -> tuple[float | None, float | None]:
    """
    Peak-to-Loudness Ratio (PLR) and Peak-to-Short-term Ratio (PSR).

    PLR  — dB difference between true-peak and integrated LUFS.
           Lower = more compressed (smashed masters ~7-9 dB).
           Higher = more headroom (dynamic mixes ~14-20 dB).

    PSR  — dB difference between true-peak and max short-term LUFS (3 s).
           Better streaming-loudness indicator than PLR because short-term
           LUFS tracks the loudest moment, not the session average.
           A large PLR-PSR gap indicates a loud-chorus-only limiter hit.

    Returns (plr, psr). Both are None for digital silence or non-finite
    LUFS — undefined when there's no audible content. Renderers treat None
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
        # CRIT-19: chunked resample to avoid OOM on long tracks (same fix as
        # _true_peak_and_overs). PLR is called on the full track; chunked
        # peak-finding is correct because we only need max(abs(up)).
        # SR-aware chunk: 10 s at any sample rate (matches _true_peak_and_overs).
        _plr_chunk = int(sr * 10)
        per_channel_tp = []
        for ch in channels:
            try:
                ch_peak = 0.0
                n = len(ch)
                for _start in range(0, n, _plr_chunk):
                    _seg = ch[_start:_start + _plr_chunk]
                    _up = _upsample_4x(_seg, sr)
                    ch_peak = max(ch_peak, float(np.max(np.abs(_up))))
                per_channel_tp.append(float(20 * np.log10(max(ch_peak, 1e-10))))
            except Exception:
                # Last-ditch raw peak; better than emitting -inf.
                peak = float(np.max(np.abs(ch))) if ch.size else 1e-10
                per_channel_tp.append(float(20 * np.log10(max(peak, 1e-10))))
        # Drop -inf entries so a single dead channel doesn't poison the max.
        finite_tps = [v for v in per_channel_tp if np.isfinite(v)]
        if not finite_tps:
            return None, None
        tp_db = max(finite_tps)

        lufs = compute_lufs(y, sr)
        if np.isinf(lufs) or np.isnan(lufs):
            # Silence / non-finite loudness — PLR is undefined here.
            return None, None
        plr = round(tp_db - lufs, 1)

        # PSR (Peak-to-Short-term Ratio): true-peak vs max short-term LUFS.
        # Measures limiter stress on peaks specifically (better streaming
        # indicator than PLR).
        try:
            st_max = compute_short_term_max(y, sr)
            if np.isfinite(st_max):
                psr = round(float(tp_db - st_max), 1)
            else:
                psr = plr  # fallback
        except Exception:
            psr = plr  # fallback

        return plr, psr
    except Exception as e:
        import sys as _sys
        _sys.stderr.write(f"[comparator] compute_plr failed: {e}\n")
        return None, None


def compute_visqol_score(ref: np.ndarray, deg: np.ndarray, sr: int) -> float | None:
    """ViSQOL MOS-LQO (1-5, 5=identical) in *audio* mode. None if unavailable.

    This is a music mastering tool, so ViSQOL MUST run in full-band AUDIO mode
    (48 kHz, use_speech_scoring=False, audio SVR model) — NOT the 16 kHz speech
    mode the simple no-arg .Measure() defaults to. Speech mode band-limits to
    ~8 kHz and scores with a speech-trained SVR, which is the wrong model for
    music and silently mis-rates every master.
    """
    try:
        import os
        import visqol.visqol_lib_py as visqol_lib  # type: ignore
        from visqol.pb2 import visqol_config_pb2  # type: ignore
        TARGET_SR = 48000  # ViSQOL audio mode operates at 48 kHz

        def to_mono(y: np.ndarray) -> np.ndarray:
            if y.ndim == 1:
                return y
            return y.mean(axis=0) if y.shape[0] <= 8 else y.mean(axis=1)

        ref_m = to_mono(ref).astype(np.float64)
        deg_m = to_mono(deg).astype(np.float64)
        if sr != TARGET_SR:
            ref_m = librosa.resample(ref_m, orig_sr=sr, target_sr=TARGET_SR)
            deg_m = librosa.resample(deg_m, orig_sr=sr, target_sr=TARGET_SR)
        n = min(len(ref_m), len(deg_m))

        config = visqol_config_pb2.VisqolConfig()
        config.audio.sample_rate = TARGET_SR
        config.options.use_speech_scoring = False  # AUDIO mode, not speech
        model = "libsvm_nu_svr_model.txt"          # the full-band audio SVR model
        config.options.svr_model_path = os.path.join(
            os.path.dirname(visqol_lib.__file__), "model", model
        )
        api = visqol_lib.VisqolApi()
        api.Create(config)
        result = api.Measure(ref_m[:n], deg_m[:n])
        return round(float(result.moslqo), 2)
    except ImportError:
        return None
    except Exception as e:
        import logging
        logging.getLogger(__name__).debug("ViSQOL failed: %s", e)
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

    # EBU Tech 3342 §3: LRA is undefined for content shorter than 60 s.
    # For content < 3 s there are zero complete 3-second windows — pyloudnorm
    # returns NaN or 0.0, which looks like a brick-wall master. Return 0.0
    # (callers treat 0.0 as "undefined") so the UI doesn't mislead.
    duration_s = data.shape[0] / sr
    if duration_s < 3.0:
        return 0.0

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
        # SR-dependent K-weighting via bilinear-transform per BS.1770-4 §2.3.
        # Pre-warped biquads are computed from the analogue prototype at the
        # actual sample rate, so the fallback is accurate at 44.1 kHz, 48 kHz,
        # 96 kHz, etc. — the old hardcoded 48 kHz coefficients were up to 2 dB
        # wrong at other rates on HF-heavy material.
        from scipy.signal import lfilter
        # Stage 1: high-shelf pre-filter
        # Analogue prototype: fc=1681.97 Hz, Q=0.7071, Vh=1.584893, Vb=1.258925
        K = np.tan(np.pi * 1681.9744509 / sr)
        Vh = 1.584893192; Vb = 1.258925412
        denom = 1 + K / 0.7071 + K * K
        b1 = [(Vh + Vb * K / 0.7071 + K * K) / denom,
              2 * (K * K - Vh) / denom,
              (Vh - Vb * K / 0.7071 + K * K) / denom]
        a1 = [1.0, 2 * (K * K - 1) / denom, (1 - K / 0.7071 + K * K) / denom]
        # Stage 2: RLB high-pass, fc=38.1354 Hz, Q=0.5003 per BS.1770-4 §2.3.
        # MED-7 fix: prior fallback used Q=0.7071 (√2/2), diverging from the
        # primary _bs1770_k_weight path which uses Qr=0.5003270373253953. This
        # caused ~1–2 LU error on 96 kHz files when pyloudnorm failed. Use the
        # same Q as the primary path throughout.
        _Qr = 0.5003270373253953
        K2 = np.tan(np.pi * 38.1345865 / sr)
        denom2 = 1 + K2 / _Qr + K2 * K2
        b2 = [1 / denom2, -2 / denom2, 1 / denom2]
        a2 = [1.0, 2 * (K2 * K2 - 1) / denom2, (1 - K2 / _Qr + K2 * K2) / denom2]
        try:
            kw = lfilter(b1, a1, mono.astype(np.float64))
            kw = lfilter(b2, a2, kw)
        except Exception:
            kw = mono
        # EBU R128 LRA is derived from the short-term loudness distribution,
        # which uses 3 s windows with 2 s overlap (1 s hop).  The old 400 ms
        # frame matched BS.1770 momentary blocks — 7× too short — causing LRA
        # to be over-reported by 4–8 LU on material with slow dynamics.
        frame_length = int(sr * 3.0)
        hop_length = int(sr * 1.0)
        rms = librosa.feature.rms(y=kw, frame_length=frame_length, hop_length=hop_length)[0]
        rms_db = 20 * np.log10(np.maximum(rms, 1e-10))
        rms_db = rms_db[rms_db > -70]  # absolute gate, BS.1770
        # NIT-6 / CRIT-8 fix: EBU R128 / BS.1770-4 LRA requires BOTH the absolute gate
        # (-70 LUFS) AND a relative gate (-20 LU below the mean of the absolutely-gated
        # distribution).  Without the relative gate, LRA is over-reported
        # by 6–12 LU on orchestral/acoustic material where quiet passages sit
        # well below -50 LUFS.
        if len(rms_db) >= 10:
            ungated_mean = float(np.mean(rms_db))
            rms_db = rms_db[rms_db > ungated_mean - 20.0]  # relative gate, EBU R128
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

def run_fast_analysis(file_a: str, file_b: str, sr: int | None = None, profile: dict | None = None) -> dict:
    """
    Run analysis using frequency-band isolation instead of Demucs.
    Much faster (~10 seconds), same 10 categories.
    Uses bandpass filters to approximate what Demucs does with AI.

    sr=None (default): load at native sample rate to preserve full HF content.
    Previously defaulted to 44100, resampling 48/96 kHz files and distorting
    analysis for high-resolution masters.
    """
    # Load stereo at native rate; resample B to A's rate for fair comparison
    y_a, sr = librosa.load(file_a, sr=sr, mono=False)
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

    # Peak-to-Loudness Ratio and Peak-to-Short-term Ratio
    plr_a, psr_a = compute_plr(y_a, sr)
    plr_b, psr_b = compute_plr(y_b, sr)

    # Momentary max (400 ms) — broadcast compliance
    mom_a = compute_momentary_max(y_a, sr)
    mom_b = compute_momentary_max(y_b, sr)

    # ViSQOL perceptual similarity score (MOS-LQO 1–5, 5=identical)
    visqol_mos = compute_visqol_score(mono_a, mono_b, sr)

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
            "psr_a": psr_a,
            "psr_b": psr_b,
            "visqol_mos": visqol_mos,
            "width_a": round(overall_width_a, 3),
            "width_b": round(overall_width_b, 3),
            "dynamics_a": round(overall_dr_a, 1),
            "dynamics_b": round(overall_dr_b, 1),
            "insights": overall_insights,
        },
    }
    _attach_mastering_delta(result, y_a, y_b, sr=sr, file_a=file_a, file_b=file_b, profile=profile)
    return _stamp_spec_versions(result)
