"""
Playback-environment simulations.

Apply a frequency-shaped EQ + soft-clipping chain to a 30-second window
so the engineer can audition what the master will sound like through:

  - phone_speaker  · HP 250 Hz / LP 12 kHz / +4 dB presence @ 3.5 kHz / soft clip
  - earbuds        · AirPods-ish FR (HP 60, mid dip, +3 dB @ 5 kHz, slight HF roll)
  - club_pa        · HP 30 / mono-sum below 100 Hz / +4 dB @ 80 / soft sub limit
  - car_cabin      · cabin EQ (+3 dB @ 80, dip @ 1.5 kHz, mild stereo crossfeed)

Each is a biquad filter chain only (no impulse-response convolution) — small,
fast, ships in v5.0.4 without dragging in any IR licensing. IR-based versions
of these are on the v5.x roadmap.

The encoded-preview pipeline calls `apply_playback_env(window, sr, env_id)`
right after the platform's normalisation gain and before the AAC encoder.
"""
from __future__ import annotations

import os
import numpy as np
from scipy.signal import butter, sosfilt, sosfilt_zi, iirpeak, lfilter


# ── Biquad helpers ──────────────────────────────────────────────────────

def _butter_hp(y: np.ndarray, sr: int, cutoff_hz: float, order: int = 4) -> np.ndarray:
    """High-pass Butterworth, applied per channel."""
    sos = butter(order, cutoff_hz / (sr / 2), btype="highpass", output="sos")
    if y.ndim == 1:
        return sosfilt(sos, y)
    return np.stack([sosfilt(sos, y[:, ch]) for ch in range(y.shape[1])], axis=1)


def _butter_lp(y: np.ndarray, sr: int, cutoff_hz: float, order: int = 4) -> np.ndarray:
    sos = butter(order, cutoff_hz / (sr / 2), btype="lowpass", output="sos")
    if y.ndim == 1:
        return sosfilt(sos, y)
    return np.stack([sosfilt(sos, y[:, ch]) for ch in range(y.shape[1])], axis=1)


def _peaking_eq(y: np.ndarray, sr: int, freq_hz: float, gain_db: float, q: float = 1.0) -> np.ndarray:
    """Single peaking-EQ biquad (Audio EQ Cookbook). Positive gain_db boosts,
    negative cuts. Applied per channel."""
    A = 10 ** (gain_db / 40.0)
    w0 = 2 * np.pi * freq_hz / sr
    alpha = np.sin(w0) / (2 * q)
    cos_w0 = np.cos(w0)
    b0 = 1 + alpha * A
    b1 = -2 * cos_w0
    b2 = 1 - alpha * A
    a0 = 1 + alpha / A
    a1 = -2 * cos_w0
    a2 = 1 - alpha / A
    b = np.array([b0, b1, b2]) / a0
    a = np.array([a0, a1, a2]) / a0
    if y.ndim == 1:
        return lfilter(b, a, y)
    return np.stack([lfilter(b, a, y[:, ch]) for ch in range(y.shape[1])], axis=1)


def _soft_clip(y: np.ndarray, threshold_lin: float = 0.85) -> np.ndarray:
    """Soft saturation: linear below threshold, tanh-asymptotic to ±1.0 above.
    Models a small-speaker driver overload, NOT a mastering limiter.

    5.3.1 fix: pre-5.3 implementation was `tanh(y/threshold) * threshold`,
    which compresses ALL signal (tanh is non-linear at small inputs too)
    instead of passing low-level content through cleanly. That manifested
    as a thin / fizzy overall sound on the Translation Check renders even
    when the master was nowhere near the threshold. The piecewise form
    below actually does what the old comment claimed."""
    sign = np.sign(y)
    absy = np.abs(y)
    out = np.empty_like(y)
    below = absy <= threshold_lin
    above = ~below
    out[below] = y[below]
    knee = max(1e-6, 1.0 - threshold_lin)
    x = (absy[above] - threshold_lin) / knee
    out[above] = sign[above] * (threshold_lin + (1.0 - threshold_lin) * np.tanh(x))
    return out


# Per-environment max boost in dB. Used by `apply_playback_env` to pre-
# attenuate the input so the EQ chain has somewhere to live without
# slamming through 0 dBFS. A modern master sits at -1 dBFS or hotter;
# any positive peak EQ would blow it past full-scale.
_ENV_MAX_BOOST_DB = {
    "phone_speaker": 4.0,
    "earbuds":       3.0,
    "club_pa":       4.0,
    "car_cabin":     2.5,
}
_HEADROOM_SAFETY_DB = 1.5  # extra margin on top of max boost


def _final_saturator(y: np.ndarray, threshold_lin: float = 0.95) -> np.ndarray:
    """Final-stage safety saturator. Passes < threshold linearly, soft-clips
    above so the chain never produces a literal hard clip. Not a TP limiter;
    it's a last-resort guard against per-env chain math piling up gain."""
    return _soft_clip(y, threshold_lin)


def _mono_sum_below(y: np.ndarray, sr: int, crossover_hz: float) -> np.ndarray:
    """Take the LF content (below `crossover_hz`) and replace L+R below that
    crossover with their average — models PA stacks where the sub bus is
    summed mono. Above the crossover, stereo content is preserved."""
    if y.ndim == 1:
        return y  # already mono
    sos = butter(4, crossover_hz / (sr / 2), btype="lowpass", output="sos")
    # LF content per channel, then averaged
    lf_l = sosfilt(sos, y[:, 0])
    lf_r = sosfilt(sos, y[:, 1])
    lf_mono = 0.5 * (lf_l + lf_r)
    # HF content per channel (original minus LF)
    hf_l = y[:, 0] - lf_l
    hf_r = y[:, 1] - lf_r
    return np.stack([hf_l + lf_mono, hf_r + lf_mono], axis=1)


# ── IR-based convolution ───────────────────────────────────────────────

_IR_DIR = os.path.expanduser("~/.rtm/playback-irs")
_IR_WET = 0.85
_IR_DRY = 0.15
_IR_MAX_DURATION_S = 5.0


def _convolve_with_ir(y: np.ndarray, sr: int, env_id: str) -> np.ndarray | None:
    """Convolve `y` with a user-supplied IR file for `env_id`, if available.

    IR directory: ~/.rtm/playback-irs/
    Drop your own phone_speaker.wav, earbuds.wav, club_pa.wav, or
    car_cabin.wav IR files here to enable convolution-based simulation.
    The directory is created on first run if it does not already exist.

    Rules:
    - Looks for  ~/.rtm/playback-irs/<env_id>.wav
    - Only uses IRs shorter than 5 seconds to keep latency/memory sane.
    - Resamples the IR to match `sr` before convolution.
    - Mixes wet/dry at 0.85/0.15 (wet dominates; dry preserves transient attack).

    Returns the processed signal (same shape as `y`), or None if no valid IR
    was found — the caller falls back to the biquad chain in that case.
    """
    import os as _os
    _os.makedirs(_IR_DIR, exist_ok=True)

    ir_path = _os.path.join(_IR_DIR, f"{env_id}.wav")
    if not _os.path.isfile(ir_path):
        return None

    try:
        import soundfile as _sf
        import librosa as _librosa
        from scipy.signal import fftconvolve as _fftconv

        ir_raw, ir_sr = _sf.read(ir_path, always_2d=False)
        ir_mono = ir_raw.mean(axis=1) if ir_raw.ndim == 2 else ir_raw
        ir_mono = ir_mono.astype(np.float32)

        # Duration guard
        if len(ir_mono) / ir_sr > _IR_MAX_DURATION_S:
            return None

        # Resample IR to signal's SR if needed
        if ir_sr != sr:
            ir_mono = _librosa.resample(ir_mono, orig_sr=ir_sr, target_sr=sr)

        # Normalise IR peak to 1.0 so its amplitude doesn't change the mix level
        peak = float(np.max(np.abs(ir_mono)))
        if peak > 1e-10:
            ir_mono /= peak

        # Apply convolution per channel
        if y.ndim == 1:
            wet = _fftconv(y, ir_mono, mode="full")[: len(y)].astype(np.float32)
            out = _IR_WET * wet + _IR_DRY * y
        else:
            channels = []
            for ch in range(y.shape[1]):
                wet_ch = _fftconv(y[:, ch], ir_mono, mode="full")[: y.shape[0]].astype(np.float32)
                channels.append(_IR_WET * wet_ch + _IR_DRY * y[:, ch])
            out = np.stack(channels, axis=1)

        return out.astype(np.float32)
    except Exception:
        return None


# ── Per-environment chains ─────────────────────────────────────────────

def _phone_speaker(y: np.ndarray, sr: int) -> np.ndarray:
    """Modern phone speaker: tiny driver, ~250 Hz hard low cut, ~12 kHz
    soft top, presence push at 3.5 kHz where consonants live, soft clip
    above moderate level."""
    y = _butter_hp(y, sr, 250.0, order=4)
    y = _butter_lp(y, sr, 12000.0, order=4)
    y = _peaking_eq(y, sr, 3500.0, gain_db=4.0, q=1.5)
    y = _peaking_eq(y, sr, 250.0, gain_db=-3.0, q=1.0)  # body suckout right above the HP
    y = _soft_clip(y, threshold_lin=0.7)
    return y


def _earbuds(y: np.ndarray, sr: int) -> np.ndarray:
    """AirPods-ish: gentle 60 Hz HP (no real sub), slight 200 Hz dip, +3 dB
    presence at 5 kHz, mild rolloff above 14 kHz. AutoEq curves vary per
    model — this is a safe-middle approximation, not a specific device."""
    y = _butter_hp(y, sr, 60.0, order=2)
    y = _peaking_eq(y, sr, 200.0, gain_db=-2.0, q=0.8)
    y = _peaking_eq(y, sr, 5000.0, gain_db=3.0, q=1.0)
    y = _butter_lp(y, sr, 14000.0, order=2)
    return y


def _club_pa(y: np.ndarray, sr: int) -> np.ndarray:
    """House-system PA: 30 Hz HP (subsonic safety), L+R summed mono below
    100 Hz (models the mono sub bus on every club system), +4 dB sub bump
    at 80 Hz, soft-clip on the LF band only (models sub-limiter engaging
    without crushing the full-band mix)."""
    y = _butter_hp(y, sr, 30.0, order=2)
    y = _mono_sum_below(y, sr, 100.0)
    y = _peaking_eq(y, sr, 80.0, gain_db=4.0, q=0.9)
    # 5.3.1 fix: pre-5.3 the soft-clip ran full-band despite the comment.
    # Now we band-split: <120 Hz gets the saturator, the rest passes
    # clean. Matches the documented behaviour and stops upper-mid
    # content from picking up tanh harmonics it shouldn't.
    if y.ndim == 1:
        sos = butter(4, 120.0 / (sr / 2), btype="lowpass", output="sos")
        lf = sosfilt(sos, y)
        hf = y - lf
        y = _soft_clip(lf, threshold_lin=0.85) + hf
    else:
        sos = butter(4, 120.0 / (sr / 2), btype="lowpass", output="sos")
        lf = np.stack([sosfilt(sos, y[:, ch]) for ch in range(y.shape[1])], axis=1)
        hf = y - lf
        y = _soft_clip(lf, threshold_lin=0.85) + hf
    return y


def _car_cabin(y: np.ndarray, sr: int) -> np.ndarray:
    """Generic mid-class consumer car cabin (no specific make/model — cars
    vary too much for a single canonical sim per codex consult). Cabin
    bass bump at 80 Hz, +1.5 dB, dip at 1.5 kHz from upholstery absorption,
    mild HF roll above 10 kHz."""
    y = _peaking_eq(y, sr, 80.0, gain_db=2.5, q=0.8)
    y = _peaking_eq(y, sr, 1500.0, gain_db=-2.0, q=1.2)
    y = _butter_lp(y, sr, 10000.0, order=2)
    # Mild stereo crossfeed (5%) — cabin walls do this naturally.
    if y.ndim == 2:
        L = y[:, 0]
        R = y[:, 1]
        crossfeed = 0.05
        y = np.stack([
            L * (1 - crossfeed) + R * crossfeed,
            R * (1 - crossfeed) + L * crossfeed,
        ], axis=1)
    return y


# ── Public dispatch ────────────────────────────────────────────────────

ENVS = {
    "phone_speaker": _phone_speaker,
    "earbuds":       _earbuds,
    "club_pa":       _club_pa,
    "car_cabin":     _car_cabin,
}


# Engineer-facing one-line description per env, surfaced in the UI tooltip.
ENV_DESCRIPTIONS = {
    "phone_speaker": "How your master sounds on a modern phone speaker — sub disappears, presence range dominates.",
    "earbuds":       "AirPods-style consumer earbuds — no real sub below 60 Hz, presence-shifted vocals, side-field collapse.",
    "club_pa":       "House-system PA — sub bus summed mono below 100 Hz; stereo bass cancels, kick triggers limiter.",
    "car_cabin":     "Generic consumer car cabin — bass bump from cabin resonance, midrange suckout from upholstery.",
}


def apply_playback_env(y: np.ndarray, sr: int, env_id: str):
    """Apply the `env_id` transformation to a (samples,) or (samples, ch)
    float32 buffer. Returns `(out, info)` where `out` is the transformed
    buffer (same shape) and `info` is a dict the caller can surface.

    5.3.1 fix — pre-5.3 this function did `np.clip(out, -1, 1)` at the
    end, which produced literal hard digital clipping (square-wave odd
    harmonics, smeared by the AAC encoder into audible distortion) on
    any chain whose peak EQ pushed a near-0-dBFS master past full-scale.
    Fixed three ways:
      1. Pre-attenuate the input by the env's max-boost + 1.5 dB safety
         BEFORE the chain. Audition is quieter than the master; it's a
         simulation, not a final master, so quieter is fine.
      2. `_soft_clip` math actually passes linearly below threshold now
         (was tanh-everywhere; thinned the whole signal).
      3. Final stage is `_final_saturator` (soft-knee), never `np.clip`.
    `info` reports `peak_dbfs_post_chain`, `headroom_db_applied`,
    `saturator_engaged` so the UI can warn if the simulation drove the
    signal hard.

    Returns `(input unchanged, default-info)` if `env_id` is unknown —
    callers should check `env_id in ENVS` first.
    """
    fn = ENVS.get(env_id)
    if fn is None:
        return y, {
            "headroom_db_applied": 0.0,
            "peak_dbfs_post_chain": None,
            "saturator_engaged": False,
            "env_id": env_id,
        }
    boost_db = _ENV_MAX_BOOST_DB.get(env_id, 6.0)
    headroom_db = boost_db + _HEADROOM_SAFETY_DB
    pre_atten = float(10.0 ** (-headroom_db / 20.0))

    y_in = (y.astype(np.float32, copy=False) * pre_atten).astype(np.float32, copy=False)

    # Try IR convolution first; fall back to biquad chain if no IR is available.
    ir_out = _convolve_with_ir(y_in, sr, env_id)
    out = ir_out if ir_out is not None else fn(y_in, sr)

    peak_lin = float(np.max(np.abs(out))) if out.size else 0.0
    peak_dbfs = 20.0 * float(np.log10(max(peak_lin, 1e-10)))

    sat_engaged = peak_lin > 0.95
    if sat_engaged:
        out = _final_saturator(out, threshold_lin=0.95)
        peak_lin = float(np.max(np.abs(out))) if out.size else 0.0
        peak_dbfs = 20.0 * float(np.log10(max(peak_lin, 1e-10)))

    info = {
        "headroom_db_applied": round(headroom_db, 2),
        "peak_dbfs_post_chain": round(peak_dbfs, 2),
        "saturator_engaged": bool(sat_engaged),
        "env_id": env_id,
    }
    return out.astype(np.float32, copy=False), info
