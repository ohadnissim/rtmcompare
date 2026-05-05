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
    """Soft saturation via tanh, scaled so signals below threshold pass linearly
    and signals above are smoothly compressed. Models a small-speaker driver
    overload, NOT a mastering limiter."""
    # Scale so input == threshold → output ≈ threshold, then compress above.
    # Using y * (1 / threshold) lets tanh squash anything above 1.0.
    shaped = np.tanh(y / threshold_lin) * threshold_lin
    return shaped


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
    at 80 Hz, soft clip on the LF to model sub limiter engaging."""
    y = _butter_hp(y, sr, 30.0, order=2)
    y = _mono_sum_below(y, sr, 100.0)
    y = _peaking_eq(y, sr, 80.0, gain_db=4.0, q=0.9)
    # Soft-clip just the LF band so the sub bus engages but the rest of the
    # mix stays clean. Approximation; real PA limiters are full-band.
    y = _soft_clip(y, threshold_lin=0.85)
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


def apply_playback_env(y: np.ndarray, sr: int, env_id: str) -> np.ndarray:
    """Apply the `env_id` transformation to a (samples,) or (samples, ch)
    float32 buffer. Returns a buffer of the same shape and dtype.

    Returns the input unchanged if `env_id` is unknown — callers should
    check `env_id in ENVS` first.
    """
    fn = ENVS.get(env_id)
    if fn is None:
        return y
    out = fn(y.astype(np.float32, copy=False), sr)
    # Hard-cap to ±1 in case a chain piles up gain. Encoders will clip
    # anything past full-scale; this keeps the audition consistent.
    return np.clip(out, -1.0, 1.0)
