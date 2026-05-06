"""Spectral brick-wall filter signature detection.

The engine uses this as a routing guard for content that has been passed
through destructive EQ filters before scoring. It is intentionally pure
signal processing: no model weights, no GPU, and fail-open on degenerate
audio.
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

import numpy as np


_EMPTY_SIGNATURE: Dict[str, Any] = {
    "low_pass_detected": False,
    "low_pass_cutoff_hz": None,
    "high_pass_detected": False,
    "high_pass_cutoff_hz": None,
    "is_brick_wall": False,
}


def _empty_signature() -> Dict[str, Any]:
    return dict(_EMPTY_SIGNATURE)


def _as_mono_float(audio: np.ndarray) -> np.ndarray:
    arr = np.asarray(audio, dtype=np.float32)
    if arr.ndim == 0:
        return np.asarray([], dtype=np.float32)
    if arr.ndim > 1:
        # Accept both librosa-style (channels, samples) and soundfile-style
        # (samples, channels) layouts.
        if arr.shape[0] <= arr.shape[-1]:
            arr = np.mean(arr, axis=0)
        else:
            arr = np.mean(arr, axis=-1)
    arr = np.ravel(arr)
    return arr[np.isfinite(arr)]


def _smooth_db(db: np.ndarray, bin_hz: float) -> np.ndarray:
    from scipy.ndimage import median_filter, uniform_filter1d

    median_bins = max(3, int(round(121.0 / max(bin_hz, 1e-6))) | 1)
    mean_bins = max(3, int(round(121.0 / max(bin_hz, 1e-6))))
    smoothed = median_filter(db, size=median_bins, mode="nearest")
    return uniform_filter1d(smoothed, size=mean_bins, mode="nearest")


def _spectral_profile(
    audio: np.ndarray,
    sr: int,
    *,
    max_duration_sec: float = 30.0,
) -> Optional[Tuple[np.ndarray, np.ndarray]]:
    import librosa

    if sr <= 0:
        return None
    y = _as_mono_float(audio)
    min_samples = max(512, int(float(sr) * 0.25))
    if y.size < min_samples:
        return None
    max_samples = int(float(sr) * max_duration_sec)
    if max_samples > 0 and y.size > max_samples:
        y = y[:max_samples]
    peak = float(np.max(np.abs(y))) if y.size else 0.0
    if peak <= 1e-8:
        return None
    y = y / (peak + 1e-12)

    n_fft = 4096 if sr <= 24000 else 8192
    if y.size < n_fft:
        n_fft = 2 ** int(np.floor(np.log2(max(512, y.size))))
    hop = max(128, n_fft // 4)
    spec = np.abs(
        librosa.stft(
            y,
            n_fft=n_fft,
            hop_length=hop,
            window="hann",
            center=True,
        )
    ) ** 2
    if spec.size == 0:
        return None
    power = np.mean(spec, axis=1) + 1e-14
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    db = 10.0 * np.log10(power)
    db = db - float(np.nanmax(db))
    if freqs.size < 2:
        return None
    return freqs, _smooth_db(db, float(freqs[1] - freqs[0]))


def _band_median(freqs: np.ndarray, db: np.ndarray, low_hz: float, high_hz: float) -> float:
    if high_hz <= low_hz:
        return float("nan")
    mask = (freqs >= low_hz) & (freqs <= high_hz)
    if not np.any(mask):
        return float("nan")
    values = db[mask]
    values = values[np.isfinite(values)]
    if values.size == 0:
        return float("nan")
    return float(np.median(values))


def _detect_high_pass(freqs: np.ndarray, db: np.ndarray) -> Tuple[bool, Optional[float], bool]:
    nyquist = float(freqs[-1])
    if nyquist < 6000.0:
        return False, None, False

    high_start = min(nyquist - 800.0, max(4200.0, nyquist * 0.35))
    high_mask = (freqs >= high_start) & (freqs <= nyquist - 800.0)
    low_mask = (freqs >= 200.0) & (freqs <= min(3500.0, nyquist * 0.30))
    mid_mask = (freqs >= 1000.0) & (freqs <= min(4500.0, nyquist * 0.45))
    if not np.any(high_mask) or not np.any(low_mask):
        return False, None, False

    high_ref = float(np.percentile(db[high_mask], 85))
    low_ref = float(np.median(db[low_mask]))
    mid_ref = float(np.median(db[mid_mask])) if np.any(mid_mask) else low_ref
    # Conservative stop-band reference: if mids still have energy, this is
    # natural sparse bass rather than a destructive high-pass.
    stop_ref = max(low_ref, mid_ref)
    global_attenuation = high_ref - stop_ref

    threshold = high_ref - 4.0
    start_idx = int(np.searchsorted(freqs, max(3500.0, nyquist * 0.25)))
    end_idx = int(np.searchsorted(freqs, nyquist - 500.0))
    cutoff_hz: Optional[float] = None
    for idx in range(start_idx, end_idx):
        if db[idx] < threshold:
            continue
        previous = _band_median(
            freqs,
            db,
            max(100.0, float(freqs[idx]) - 3500.0),
            max(150.0, float(freqs[idx]) - 900.0),
        )
        if np.isfinite(previous) and high_ref - previous >= 20.0:
            cutoff_hz = float(freqs[idx])
            break

    if cutoff_hz is None and global_attenuation >= 20.0 and end_idx > start_idx:
        # Some KTH HP-8k tracks have sparse treble after the cutoff, so the
        # local transition is weaker than the global stop/pass discontinuity.
        # Use the strongest upper-band point as a fail-soft cutoff estimate.
        cutoff_hz = float(freqs[start_idx + int(np.argmax(db[start_idx:end_idx]))])

    if cutoff_hz is None:
        return False, None, False

    stop_center = max(250.0, cutoff_hz / 2.0)
    pass_center = min(nyquist - 500.0, max(cutoff_hz + 500.0, cutoff_hz * 1.12))
    stop_db = _band_median(freqs, db, max(80.0, stop_center * 0.8), stop_center * 1.2)
    pass_db = _band_median(
        freqs,
        db,
        max(cutoff_hz, pass_center * 0.9),
        min(nyquist - 200.0, pass_center * 1.1),
    )
    if np.isfinite(stop_db) and np.isfinite(pass_db):
        attenuation = pass_db - stop_db
        octaves = np.log2(max(pass_center, 1.0) / max(stop_center, 1.0))
        slope_db_per_oct = attenuation / max(float(octaves), 1e-6)
    else:
        attenuation = global_attenuation
        slope_db_per_oct = global_attenuation

    sharp_local = global_attenuation >= 22.0 and attenuation >= 17.0 and slope_db_per_oct >= 14.0
    sharp_global = global_attenuation >= 35.0 and attenuation >= 10.0 and slope_db_per_oct >= 10.0
    detected = cutoff_hz > 3500.0 and (sharp_local or sharp_global)
    brick_wall = bool(detected and (slope_db_per_oct > 24.0 or global_attenuation > 30.0))
    return bool(detected), float(cutoff_hz) if detected else None, brick_wall


def _detect_low_pass(freqs: np.ndarray, db: np.ndarray) -> Tuple[bool, Optional[float], bool]:
    nyquist = float(freqs[-1])
    max_cutoff = min(4000.0, nyquist - 1500.0)
    min_cutoff = 250.0
    if max_cutoff <= min_cutoff:
        return False, None, False

    best: Optional[Tuple[float, float, float, float]] = None
    for cutoff in np.linspace(min_cutoff, max_cutoff, 240):
        pass_db = _band_median(freqs, db, max(80.0, cutoff - 1000.0), max(120.0, cutoff - 150.0))
        stop_db = _band_median(freqs, db, cutoff + 250.0, min(nyquist - 200.0, cutoff + 2250.0))
        near_left = _band_median(freqs, db, max(80.0, cutoff - 300.0), max(120.0, cutoff - 50.0))
        near_right = _band_median(freqs, db, cutoff + 50.0, min(nyquist - 100.0, cutoff + 450.0))
        if not all(np.isfinite(v) for v in (pass_db, stop_db, near_left, near_right)):
            continue
        sustained = pass_db - stop_db
        local = near_left - near_right
        rank = sustained + 0.5 * local
        if best is None or rank > best[0]:
            best = (float(rank), float(cutoff), float(sustained), float(local))

    if best is None:
        return False, None, False

    _, cutoff_hz, sustained, local = best
    stop_center = min(nyquist - 200.0, cutoff_hz + 1200.0)
    pass_center = max(100.0, cutoff_hz / 2.0)
    octaves = np.log2(stop_center / max(pass_center, 1.0))
    slope_db_per_oct = sustained / max(float(octaves), 1e-6)
    detected = sustained >= 28.0 and local >= 10.0 and slope_db_per_oct >= 18.0
    brick_wall = bool(detected and (slope_db_per_oct > 24.0 or sustained > 36.0))
    return bool(detected), float(cutoff_hz) if detected else None, brick_wall


def detect_filter_signature(audio: np.ndarray, sr: int) -> Dict[str, Any]:
    """Detect destructive high-pass or low-pass spectral discontinuities.

    Returns a stable dictionary with the public keys requested by the
    validation harness. The detector is calibrated for obviously destructive
    filters (KTH HP-8k / LP-1k style) and intentionally ignores ordinary
    codec or mastering rolloff in the upper air band.
    """

    profile = _spectral_profile(audio, int(sr))
    if profile is None:
        return _empty_signature()
    freqs, db = profile

    hp_detected, hp_cutoff, hp_brick = _detect_high_pass(freqs, db)
    lp_detected, lp_cutoff, lp_brick = _detect_low_pass(freqs, db)
    return {
        "low_pass_detected": bool(lp_detected),
        "low_pass_cutoff_hz": lp_cutoff,
        "high_pass_detected": bool(hp_detected),
        "high_pass_cutoff_hz": hp_cutoff,
        "is_brick_wall": bool(hp_brick or lp_brick),
    }
