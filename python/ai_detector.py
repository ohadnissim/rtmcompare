"""
AI-generated music detector (v4.1 rebuild).

This detector is intentionally heuristic. The output is a risk index, not a
forensic probability. A provisional isotonic mapping is loaded for QA and
monitoring, but `probability` remains an alias of `risk_score_raw` until a
proper labelled corpus is used for calibration.
"""

from __future__ import annotations

import glob
import json
import math
import os
import warnings
from datetime import datetime, timezone

import librosa
import numpy as np
from scipy.signal import butter, find_peaks, sosfilt

# Silence known cosmetic warning paths in librosa pitch utilities.
warnings.filterwarnings(
    "ignore",
    message="Trying to estimate tuning from empty frequency set",
    category=UserWarning,
)


_CALIBRATION_FILE = os.path.join(os.path.dirname(__file__), "ai_detector_calibration_v4_1.json")


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return float(max(lo, min(hi, value)))


def _sigmoid(x: float) -> float:
    return float(1.0 / (1.0 + math.exp(-x)))


def _safe_round(value: float, ndigits: int = 3) -> float:
    if value is None or not np.isfinite(value):
        return 0.0
    return round(float(value), ndigits)


def _moving_minimum(x: np.ndarray, win: int) -> np.ndarray:
    if x.size == 0:
        return x
    win = max(3, int(win))
    if win % 2 == 0:
        win += 1
    if x.size <= win:
        return np.full_like(x, float(np.min(x)))

    pad = win // 2
    xp = np.pad(x, (pad, pad), mode="edge")
    out = np.empty_like(x)
    for i in range(x.size):
        out[i] = np.min(xp[i : i + win])
    return out


def _normalized_mad(x: np.ndarray, denom_floor: float = 1e-6) -> float:
    if x.size < 2:
        return 1.0
    med = float(np.median(x))
    mad = float(np.median(np.abs(x - med)))
    denom = max(abs(med), denom_floor)
    return float((1.4826 * mad) / denom)


def _robust_std(x: np.ndarray) -> float:
    if x.size < 2:
        return 0.0
    med = float(np.median(x))
    mad = float(np.median(np.abs(x - med)))
    return float(1.4826 * mad)


def _probe(score: float, reliability: float, reason: str, **extra) -> dict:
    out = {
        "score": _safe_round(_clamp(score), 3),
        "reliability": _safe_round(_clamp(reliability), 3),
        "reason": reason,
        "detail": reason,
    }
    out.update(extra)
    return out


def _safe_corrcoef(a: np.ndarray, b: np.ndarray) -> float:
    if a.size < 2 or b.size < 2:
        return float("nan")
    with np.errstate(invalid="ignore", divide="ignore"):
        c = np.corrcoef(a, b)[0, 1]
    return float(c)


def _load_calibration_curve() -> dict:
    default_curve = {
        "version": "ai-detector-v4.1-provisional",
        "generated_at": None,
        "method": "isotonic_regression_pava",
        "deployment_ready": False,
        "training_note": (
            "No calibration file found; using identity fallback. "
            "A labelled corpus is required for deployment-grade calibration."
        ),
        "sample_count": 0,
        "x": [0.0, 1.0],
        "y": [0.0, 1.0],
    }

    try:
        with open(_CALIBRATION_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
        x = np.asarray(raw.get("x", []), dtype=float)
        y = np.asarray(raw.get("y", []), dtype=float)
        if x.size < 2 or y.size < 2 or x.size != y.size:
            return default_curve
        order = np.argsort(x)
        x = x[order]
        y = y[order]
        y = np.maximum.accumulate(y)
        if not np.isfinite(x).all() or not np.isfinite(y).all():
            return default_curve
        if x[0] > 0.0:
            x = np.insert(x, 0, 0.0)
            y = np.insert(y, 0, y[0])
        if x[-1] < 1.0:
            x = np.append(x, 1.0)
            y = np.append(y, y[-1])

        return {
            "version": str(raw.get("version") or default_curve["version"]),
            "generated_at": raw.get("generated_at"),
            "method": str(raw.get("method") or default_curve["method"]),
            "deployment_ready": bool(raw.get("deployment_ready", False)),
            "training_note": str(raw.get("training_note") or default_curve["training_note"]),
            "sample_count": int(raw.get("sample_count", len(x))),
            "x": [float(v) for v in x],
            "y": [float(v) for v in y],
        }
    except Exception:
        return default_curve


def _apply_calibration(raw_score: float) -> float:
    x = np.asarray(_CALIBRATION.get("x", [0.0, 1.0]), dtype=float)
    y = np.asarray(_CALIBRATION.get("y", [0.0, 1.0]), dtype=float)
    if x.size < 2 or y.size < 2:
        return _clamp(raw_score)
    return _clamp(float(np.interp(_clamp(raw_score), x, y)))


_CALIBRATION = _load_calibration_curve()


def _build_mix_context(y: np.ndarray, sr: int) -> dict:
    ctx = {
        "sr": sr,
        "harmonic": None,
        "percussive": None,
        "percussive_ratio": 0.0,
    }
    try:
        harmonic, percussive = librosa.effects.hpss(y)
        total_energy = float(np.mean(np.square(y)) + 1e-9)
        percussive_ratio = float(np.mean(np.square(percussive)) / total_energy)
        ctx.update(
            {
                "harmonic": harmonic,
                "percussive": percussive,
                "percussive_ratio": percussive_ratio,
            }
        )
    except Exception:
        pass
    return ctx


def _check_spectral_ceiling(y: np.ndarray, sr: int, context: dict | None = None) -> dict:
    """
    Architecture-aware periodic-peak detector in high-frequency residual.
    Replaces fixed 18kHz cutoff logic.
    """
    n_fft = 4096
    hop = 1024
    S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop))
    if S.size == 0:
        return _probe(0.0, 0.0, "Insufficient signal for spectral profile")

    S_db = librosa.amplitude_to_db(S + 1e-9, ref=np.max)
    avg = np.mean(S_db, axis=1)
    freq = librosa.fft_frequencies(sr=sr, n_fft=n_fft)

    hi = min(16000.0, (sr / 2.0) - 500.0)
    band = (freq >= 5000.0) & (freq <= hi)
    if np.sum(band) < 32:
        return _probe(0.0, 0.0, "Sample rate too low for high-frequency periodicity check")

    x = avg[band]
    baseline = _moving_minimum(x, win=21)
    resid = x - baseline

    peaks, props = find_peaks(resid, prominence=1.5, distance=3)
    if peaks.size < 4:
        rel = _clamp((peaks.size / 4.0) * (1.0 if sr >= 32000 else 0.7))
        return _probe(
            0.0,
            rel,
            f"No stable periodic HF peak structure (peaks={int(peaks.size)})",
            peak_count=int(peaks.size),
        )

    spacing = np.diff(peaks).astype(float)
    periodicity = 1.0 - _clamp(_normalized_mad(spacing), 0.0, 1.0)
    peak_energy = float(np.mean(resid[peaks]))
    strength = _clamp((peak_energy - 1.0) / 3.0)

    raw = _sigmoid((1.4 * periodicity) + (0.3 * peak_energy) - 1.2)
    score = raw * strength

    rel = _clamp(min(1.0, peaks.size / 14.0) * (1.0 if sr >= 32000 else 0.75))

    if score >= 0.55:
        reason = (
            f"Periodic HF peak lattice detected (periodicity={periodicity:.2f}, "
            f"peak_strength={peak_energy:.2f} dB)"
        )
    elif score >= 0.25:
        reason = (
            f"Some HF periodic peak structure (periodicity={periodicity:.2f}, "
            f"peak_strength={peak_energy:.2f} dB)"
        )
    else:
        reason = (
            f"HF residual lacks strong periodic architecture peaks "
            f"(periodicity={periodicity:.2f}, peak_strength={peak_energy:.2f} dB)"
        )

    return _probe(
        score,
        rel,
        reason,
        peak_count=int(peaks.size),
        peak_periodicity=_safe_round(periodicity, 3),
        peak_strength_db=_safe_round(peak_energy, 3),
    )


def _check_spectral_smoothness(y: np.ndarray, sr: int, context: dict | None = None) -> dict:
    S = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=128, hop_length=512)
    if S.size == 0:
        return _probe(0.0, 0.0, "Insufficient signal for smoothness analysis")

    S_db = librosa.power_to_db(S + 1e-10, ref=np.max)
    spectral_diff = np.diff(S_db, axis=1)
    if spectral_diff.size == 0:
        return _probe(0.0, 0.0, "Too few frames for spectral smoothness")

    variation = float(np.mean(np.std(spectral_diff, axis=0)))
    frame_energy = np.mean(S, axis=0)
    active = float(np.mean(frame_energy > np.percentile(frame_energy, 30)))
    reliability = _clamp(active / 0.5)

    if variation < 0.9:
        score = 0.7
        reason = f"Very smooth spectral envelope ({variation:.2f})"
    elif variation < 1.3:
        score = 0.45
        reason = f"Smooth spectral envelope ({variation:.2f})"
    elif variation < 1.8:
        score = 0.2
        reason = f"Moderate spectral smoothness ({variation:.2f})"
    else:
        score = 0.0
        reason = f"Natural spectral variation ({variation:.2f})"

    return _probe(score, reliability, reason, variation=_safe_round(variation, 3))


def _check_phase_uniformity(y_stereo: np.ndarray, sr: int, context: dict | None = None) -> dict:
    """Diagnostic-only probe (weight 0 in aggregate)."""
    if y_stereo.ndim != 2 or y_stereo.shape[0] != 2:
        return _probe(0.0, 0.0, "Mono file - stereo phase diagnostic unavailable")

    left, right = y_stereo[0], y_stereo[1]
    if left.size < int(sr * 0.5):
        return _probe(0.0, 0.0, "Too short for stereo phase diagnostic")

    window = int(sr * 0.1)
    hop = max(1, window // 2)
    correlations = []
    for i in range(0, len(left) - window, hop):
        l_win = left[i : i + window]
        r_win = right[i : i + window]
        denom = float(np.sqrt(np.sum(l_win * l_win) * np.sum(r_win * r_win)))
        if denom > 1e-10:
            correlations.append(float(np.sum(l_win * r_win) / denom))

    if len(correlations) < 8:
        return _probe(0.0, 0.0, "Not enough stereo windows for phase diagnostic")

    corr = np.asarray(correlations, dtype=float)
    corr_std = float(np.std(corr))
    corr_mean = float(np.mean(corr))

    if corr_std < 0.02:
        score = 0.7
        reason = f"Extremely uniform stereo phase (std={corr_std:.3f})"
    elif corr_std < 0.04 and corr_mean > 0.95:
        score = 0.5
        reason = f"Very consistent stereo phase (std={corr_std:.3f}, mean={corr_mean:.2f})"
    elif corr_std < 0.04:
        score = 0.3
        reason = f"Low stereo phase variation (std={corr_std:.3f})"
    else:
        score = 0.0
        reason = f"Natural stereo phase variation (std={corr_std:.3f})"

    reliability = _clamp(len(correlations) / 120.0)
    return _probe(score, reliability, reason, phase_std=_safe_round(corr_std, 4))


def _check_timing_regularity(y: np.ndarray, sr: int, context: dict | None = None) -> dict:
    """Context-conditional: only reliable when percussive confidence is high."""
    percussive_ratio = 0.0
    if context is not None:
        percussive_ratio = float(context.get("percussive_ratio", 0.0))

    if percussive_ratio < 0.18:
        return _probe(
            0.0,
            0.0,
            f"Insufficient percussive content for timing probe (perc_ratio={percussive_ratio:.2f})",
            percussive_ratio=_safe_round(percussive_ratio, 3),
        )

    onset_frames = librosa.onset.onset_detect(y=y, sr=sr, units="frames", hop_length=512)
    if len(onset_frames) < 16:
        rel = _clamp((len(onset_frames) / 16.0) * 0.4)
        return _probe(0.0, rel, "Too few onsets for timing regularity")

    onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=512)
    ioi = np.diff(onset_times)
    ioi = ioi[(ioi > 0.05) & (ioi < 2.0)]
    if ioi.size < 10:
        rel = _clamp((ioi.size / 10.0) * 0.5)
        return _probe(0.0, rel, "Not enough rhythmic intervals")

    tempo = float(librosa.feature.tempo(y=y, sr=sr)[0])
    if tempo < 40.0:
        return _probe(0.0, 0.0, "No clear tempo for timing probe")

    beat_period = 60.0 / tempo
    subdivisions = [beat_period, beat_period / 2.0, beat_period / 4.0, beat_period / 3.0, beat_period / 6.0]

    residuals = []
    for interval in ioi:
        best = min(
            abs(interval - s * round(interval / s))
            for s in subdivisions
            if s > 0.01
        )
        residuals.append(best)

    residuals = np.asarray(residuals, dtype=float)
    jitter_ms = float(np.median(residuals) * 1000.0)
    spread_ms = float(_robust_std(residuals * 1000.0))

    if jitter_ms < 2.0:
        score = 0.55
        reason = f"Extremely precise timing ({jitter_ms:.1f}ms median jitter)"
    elif jitter_ms < 4.0:
        score = 0.3
        reason = f"Very tight timing ({jitter_ms:.1f}ms median jitter)"
    elif jitter_ms > 35.0:
        score = 0.4
        reason = f"Unusually unstable timing ({jitter_ms:.1f}ms median jitter)"
    else:
        score = 0.0
        reason = f"Natural timing ({jitter_ms:.1f}ms median jitter)"

    rel_onsets = _clamp((len(ioi) - 10.0) / 50.0)
    rel_perc = _clamp((percussive_ratio - 0.18) / 0.4)
    reliability = _clamp(0.25 + (0.75 * rel_onsets * rel_perc))

    return _probe(
        score,
        reliability,
        reason,
        tempo_bpm=_safe_round(tempo, 2),
        percussive_ratio=_safe_round(percussive_ratio, 3),
        jitter_ms=_safe_round(jitter_ms, 2),
        jitter_spread_ms=_safe_round(spread_ms, 2),
    )


def _check_dynamic_flatness(y: np.ndarray, sr: int, context: dict | None = None) -> dict:
    """Context-conditional thresholds with loudness-profile awareness."""
    rms = librosa.feature.rms(y=y, frame_length=sr, hop_length=max(1, sr // 2))[0]
    rms_db = 20.0 * np.log10(np.maximum(rms, 1e-10))
    rms_db = rms_db[rms_db > -55.0]

    if rms_db.size < 8:
        rel = _clamp((rms_db.size / 8.0) * 0.5)
        return _probe(0.0, rel, "Too short for dynamics context probe")

    dynamic_range = float(np.percentile(rms_db, 95) - np.percentile(rms_db, 5))
    rms_std = float(np.std(rms_db))
    lufs_proxy = float(np.percentile(rms_db, 90))

    loud_master = lufs_proxy > -10.0
    if loud_master:
        # More lenient on modern loud masters.
        severe_std, severe_rng = 1.0, 2.8
        mild_std, mild_rng = 1.4, 4.0
        reliability_base = 0.45
    else:
        severe_std, severe_rng = 1.4, 4.0
        mild_std, mild_rng = 1.9, 6.0
        reliability_base = 0.8

    if rms_std < severe_std and dynamic_range < severe_rng:
        score = 0.5
        reason = f"Very flat dynamics (range={dynamic_range:.1f} dB, std={rms_std:.1f})"
    elif rms_std < mild_std and dynamic_range < mild_rng:
        score = 0.25
        reason = f"Somewhat flat dynamics (range={dynamic_range:.1f} dB, std={rms_std:.1f})"
    else:
        score = 0.0
        reason = f"Dynamics within expected context (range={dynamic_range:.1f} dB, std={rms_std:.1f})"

    coverage = _clamp((rms_db.size - 8.0) / 20.0)
    reliability = _clamp(reliability_base * (0.5 + 0.5 * coverage))

    return _probe(
        score,
        reliability,
        reason,
        loud_master=loud_master,
        lufs_proxy_db=_safe_round(lufs_proxy, 2),
        dynamic_range_db=_safe_round(dynamic_range, 2),
    )


def _check_transient_uniformity(y: np.ndarray, sr: int, context: dict | None = None) -> dict:
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=512)
    onset_frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=512)

    if len(onset_frames) < 10:
        rel = _clamp((len(onset_frames) / 10.0) * 0.4)
        return _probe(0.0, rel, "Too few transients")

    shape_len = max(4, int(sr * 0.02 / 512))
    shapes = []
    for frame in onset_frames:
        start = max(0, frame - shape_len // 2)
        end = min(len(onset_env), start + shape_len)
        if end - start < shape_len // 2:
            continue
        shape = onset_env[start:end]
        peak = np.max(np.abs(shape))
        if peak > 0:
            normalized = shape / peak
            if len(normalized) >= shape_len // 2:
                shapes.append(normalized[:shape_len])

    if len(shapes) < 8:
        rel = _clamp((len(shapes) / 8.0) * 0.5)
        return _probe(0.0, rel, "Not enough transient shapes")

    max_len = max(len(s) for s in shapes)
    padded = [np.pad(s, (0, max_len - len(s))) for s in shapes]

    correlations = []
    cap = min(len(padded), 25)
    for i in range(cap):
        for j in range(i + 1, cap):
            corr = _safe_corrcoef(padded[i], padded[j])
            if np.isfinite(corr):
                correlations.append(corr)

    if not correlations:
        return _probe(0.0, 0.0, "Could not compare transients")

    mean_corr = float(np.mean(correlations))
    if mean_corr > 0.85:
        score = 0.65
        reason = f"Very uniform transients (corr={mean_corr:.2f})"
    elif mean_corr > 0.80:
        score = 0.3
        reason = f"Somewhat uniform transients (corr={mean_corr:.2f})"
    else:
        score = 0.0
        reason = f"Natural transient variation (corr={mean_corr:.2f})"

    reliability = _clamp(min(1.0, len(correlations) / 120.0))
    return _probe(score, reliability, reason, mean_correlation=_safe_round(mean_corr, 3))


def _check_residual_coherence(y: np.ndarray, sr: int, context: dict | None = None) -> dict:
    """HPSS residual coherence drift (replacement for chroma harmonic regularity)."""
    harmonic = None
    percussive = None
    if context is not None:
        harmonic = context.get("harmonic")
        percussive = context.get("percussive")

    if harmonic is None or percussive is None:
        try:
            harmonic, percussive = librosa.effects.hpss(y)
        except Exception:
            return _probe(0.0, 0.0, "HPSS decomposition unavailable")

    h_env = librosa.feature.rms(y=harmonic, frame_length=2048, hop_length=512)[0]
    p_env = librosa.feature.rms(y=percussive, frame_length=2048, hop_length=512)[0]
    n = min(h_env.size, p_env.size)
    if n < 96:
        rel = _clamp((n / 96.0) * 0.5)
        return _probe(0.0, rel, "Insufficient frames for residual coherence")

    h_env = h_env[:n]
    p_env = p_env[:n]

    win = 64
    hop = 16
    rolling = []
    for i in range(0, n - win + 1, hop):
        c = _safe_corrcoef(h_env[i : i + win], p_env[i : i + win])
        if np.isfinite(c):
            rolling.append(c)

    if len(rolling) < 6:
        rel = _clamp((len(rolling) / 6.0) * 0.5)
        return _probe(0.0, rel, "Could not estimate stable residual coherence")

    rc = np.asarray(rolling, dtype=float)
    coh_std = float(_robust_std(rc))
    coh_mean_abs = float(np.mean(np.abs(rc)))

    stability = _clamp((0.16 - coh_std) / 0.16)
    coupling = _clamp((coh_mean_abs - 0.15) / 0.45)
    score = stability * coupling

    if score >= 0.5:
        reason = f"Stable harmonic/percussive coherence drift (std={coh_std:.3f})"
    elif score >= 0.2:
        reason = f"Moderately stable residual coherence (std={coh_std:.3f})"
    else:
        reason = f"Residual coherence variation appears natural (std={coh_std:.3f})"

    reliability = _clamp(min(1.0, len(rolling) / 24.0))
    return _probe(
        score,
        reliability,
        reason,
        coherence_std=_safe_round(coh_std, 4),
        coherence_mean_abs=_safe_round(coh_mean_abs, 4),
    )


def _estimate_vocal_activity(y: np.ndarray, sr: int) -> dict:
    nyq = max(sr / 2.0, 1.0)
    low_n = max(300.0 / nyq, 0.001)
    high_n = min(3400.0 / nyq, 0.999)
    sos = butter(4, [low_n, high_n], btype="band", output="sos")
    vocal_band = sosfilt(sos, y)

    frame_length = 2048
    hop = 512
    rms_vocal = librosa.feature.rms(y=vocal_band, frame_length=frame_length, hop_length=hop)[0]
    rms_full = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop)[0]
    zcr = librosa.feature.zero_crossing_rate(vocal_band, frame_length=frame_length, hop_length=hop)[0]

    n = min(rms_vocal.size, rms_full.size, zcr.size)
    if n == 0:
        return {
            "activity": 0.0,
            "vocal_band": vocal_band,
            "mask": np.zeros(0, dtype=bool),
            "sample_mask": np.zeros_like(y, dtype=bool),
            "frame_length": frame_length,
            "hop": hop,
        }

    rms_vocal = rms_vocal[:n]
    rms_full = rms_full[:n]
    zcr = zcr[:n]

    ratio = rms_vocal / (rms_full + 1e-9)
    energy_floor = float(np.percentile(rms_vocal, 60) * 0.5)

    mask = (
        (rms_vocal > max(energy_floor, 1e-6))
        & (ratio > 0.18)
        & (zcr > 0.01)
        & (zcr < 0.28)
    )

    sample_mask = np.zeros_like(y, dtype=bool)
    voiced_frames = np.where(mask)[0]
    for f in voiced_frames:
        start = int(f * hop)
        end = min(sample_mask.size, start + frame_length)
        sample_mask[start:end] = True

    activity = float(np.mean(mask)) if mask.size else 0.0

    return {
        "activity": activity,
        "vocal_band": vocal_band,
        "mask": mask,
        "sample_mask": sample_mask,
        "frame_length": frame_length,
        "hop": hop,
    }


def _check_vocal_naturalness(y: np.ndarray, sr: int) -> dict:
    """
    Vocal naturalness with front VAD gate.

    Returns a reliability-aware result; if vocal activity is low this probe
    returns reliability=0 and does not contribute to aggregation.
    """
    vad = _estimate_vocal_activity(y, sr)
    activity = float(vad["activity"])

    if activity < 0.12:
        reason = f"Insufficient vocal activity for vocal probe (activity={activity:.2f})"
        return _probe(
            0.0,
            0.0,
            reason,
            probes_run=0,
            probes_total=8,
            probe_failures=[],
            vocal_activity=_safe_round(activity, 3),
        )

    vocal_band = vad["vocal_band"]
    sample_mask = vad["sample_mask"]
    if np.sum(sample_mask) > int(sr * 2):
        y_focus = vocal_band[sample_mask]
    else:
        y_focus = vocal_band

    score = 0.0
    details = []
    probe_failures = []
    probes_total = 8
    probes_run = 0
    nyq = max(sr / 2.0, 1.0)

    # 1. Sub-band correlation.
    try:
        bands = [(300, 1000), (1000, 3000), (3000, 6000)]
        band_envs = []
        for lo, hi in bands:
            lo_n = max(lo / nyq, 0.001)
            hi_n = min(hi / nyq, 0.999)
            if lo_n >= hi_n:
                continue
            bsos = butter(4, [lo_n, hi_n], btype="band", output="sos")
            filtered = sosfilt(bsos, y_focus)
            env = librosa.feature.rms(y=filtered, frame_length=2048, hop_length=512)[0]
            band_envs.append(env)

        if len(band_envs) == 3:
            min_len = min(len(e) for e in band_envs)
            if min_len > 10:
                band_envs = [e[:min_len] for e in band_envs]
                corr_low_high = _safe_corrcoef(band_envs[0], band_envs[2])
                if np.isfinite(corr_low_high):
                    if corr_low_high > 0.55:
                        score += 0.25
                        details.append(f"high sub-band correlation ({corr_low_high:.2f})")
                    elif corr_low_high > 0.45:
                        score += 0.1
                        details.append(f"elevated sub-band correlation ({corr_low_high:.2f})")
        probes_run += 1
    except Exception as e:
        probe_failures.append(("sub_band_correlation", str(e)))

    # 2. ZCR variation.
    try:
        zcr = librosa.feature.zero_crossing_rate(y_focus, frame_length=2048, hop_length=512)[0]
        if zcr.size > 10:
            zcr_mean = float(np.mean(zcr))
            if zcr_mean > 0:
                zcr_variation = float(np.std(zcr) / zcr_mean)
                if zcr_variation > 0.75:
                    score += 0.25
                    details.append(f"high ZCR variation ({zcr_variation:.2f})")
                elif zcr_variation > 0.60:
                    score += 0.1
                    details.append(f"elevated ZCR variation ({zcr_variation:.2f})")
        probes_run += 1
    except Exception as e:
        probe_failures.append(("zcr_variation", str(e)))

    # 3. MFCC delta patterns.
    try:
        mfccs = librosa.feature.mfcc(y=y_focus, sr=sr, n_mfcc=13, hop_length=512)
        mfcc_delta = librosa.feature.delta(mfccs)
        delta_std = float(np.mean(np.std(mfcc_delta, axis=1)))
        if delta_std > 3.5:
            score += 0.2
            details.append(f"high MFCC delta ({delta_std:.1f})")
        elif delta_std < 1.5:
            score += 0.2
            details.append(f"low MFCC delta ({delta_std:.1f})")
        probes_run += 1
    except Exception as e:
        probe_failures.append(("mfcc_delta", str(e)))

    # 4. Pitch quantization pattern.
    try:
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message="Trying to estimate tuning from empty frequency set",
                category=UserWarning,
            )
            pitches, mags = librosa.piptrack(
                y=y_focus,
                sr=sr,
                hop_length=256,
                fmin=80,
                fmax=600,
            )

        pitch_track = []
        for t in range(pitches.shape[1]):
            idx = int(mags[:, t].argmax())
            if mags[idx, t] > 0.05:
                pitch_track.append(float(pitches[idx, t]))

        voiced = np.asarray([p for p in pitch_track if p > 0.0], dtype=float)
        if voiced.size > 100:
            median_pitch = float(np.median(voiced))
            cents = 1200.0 * np.log2(np.maximum(voiced, 1e-9) / max(median_pitch, 1e-9))
            cents_from_semitone = np.abs(cents) % 100.0
            cents_from_semitone = np.minimum(cents_from_semitone, 100.0 - cents_from_semitone)
            pct_within_10 = float(np.mean(cents_from_semitone < 10.0) * 100.0)
            if pct_within_10 < 20.0:
                score += 0.2
                details.append(f"low pitch quantization ({pct_within_10:.0f}% within 10c)")
            elif pct_within_10 < 25.0:
                score += 0.1
                details.append(f"loose pitch centering ({pct_within_10:.0f}% within 10c)")
        probes_run += 1
    except Exception as e:
        probe_failures.append(("pitch_quantization", str(e)))

    # 5. Formant consistency proxy.
    try:
        S = np.abs(librosa.stft(y_focus, n_fft=2048, hop_length=512))
        if S.size > 0:
            S_norm = S / (np.max(S, axis=0, keepdims=True) + 1e-10)
            shape_diff = np.diff(S_norm, axis=1)
            formant_var = float(np.mean(np.std(shape_diff, axis=0)))
            if formant_var < 0.02:
                score += 0.2
                details.append(f"very consistent formants ({formant_var:.3f})")
            elif formant_var < 0.035:
                score += 0.1
                details.append(f"consistent formants ({formant_var:.3f})")
        probes_run += 1
    except Exception as e:
        probe_failures.append(("formant_consistency", str(e)))

    # 6. Spectral centroid variation.
    try:
        cent = librosa.feature.spectral_centroid(y=y_focus, sr=sr, hop_length=512)[0]
        cent = cent[cent > 100]
        if cent.size > 20:
            cent_var = float(np.std(cent) / np.mean(cent))
            if cent_var < 0.22:
                score += 0.25
                details.append(f"very low brightness variation ({cent_var:.2f})")
            elif cent_var < 0.30:
                score += 0.1
                details.append(f"low brightness variation ({cent_var:.2f})")
        probes_run += 1
    except Exception as e:
        probe_failures.append(("spectral_centroid", str(e)))

    # 7. Spectral bandwidth variation.
    try:
        bw = librosa.feature.spectral_bandwidth(y=y_focus, sr=sr, hop_length=512)[0]
        bw = bw[bw > 100]
        if bw.size > 20:
            bw_var = float(np.std(bw) / np.mean(bw))
            if bw_var < 0.15:
                score += 0.35
                details.append(f"very consistent bandwidth ({bw_var:.2f})")
            elif bw_var < 0.22:
                score += 0.2
                details.append(f"consistent bandwidth ({bw_var:.2f})")
            elif bw_var < 0.28:
                score += 0.1
                details.append(f"somewhat consistent bandwidth ({bw_var:.2f})")
        probes_run += 1
    except Exception as e:
        probe_failures.append(("spectral_bandwidth", str(e)))

    # 8. Breath/noise gap transitions.
    try:
        rms = librosa.feature.rms(y=y_focus, frame_length=2048, hop_length=512)[0]
        if rms.size > 5:
            rms_db = 20.0 * np.log10(np.maximum(rms, 1e-10))
            rms_diff = np.abs(np.diff(rms_db))
            sharp_transitions = float(np.sum(rms_diff > 15.0) / max(len(rms_diff), 1))
            if sharp_transitions > 0.06:
                score += 0.1
                details.append(f"sharp dynamic transitions ({sharp_transitions:.2%})")
        probes_run += 1
    except Exception as e:
        probe_failures.append(("breath_noise", str(e)))

    score = min(1.0, score)
    coverage = (probes_run / probes_total) if probes_total > 0 else 0.0
    activity_rel = _clamp((activity - 0.12) / 0.3)
    reliability = _clamp(coverage * activity_rel)

    if not details:
        reason = "Vocal characteristics appear natural"
    elif score <= 0.3:
        reason = "Minor vocal indicators; likely processing/autotune rather than AI"
    else:
        reason = "AI-like vocal indicators: " + ", ".join(details)

    return _probe(
        score,
        reliability,
        reason,
        probes_run=probes_run,
        probes_total=probes_total,
        probe_failures=probe_failures,
        vocal_activity=_safe_round(activity, 3),
    )


def _check_spectral_artifacts(y: np.ndarray, sr: int, context: dict | None = None) -> dict:
    """
    Comb-periodicity detector with cross-section stability.
    Replaces derivative zero-crossing internals.
    """
    n_fft = 4096
    hop = 1024
    S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop))
    if S.size == 0:
        return _probe(0.0, 0.0, "Insufficient signal for spectral artifact probe")

    S_db = librosa.amplitude_to_db(S + 1e-9, ref=np.max)
    freq = librosa.fft_frequencies(sr=sr, n_fft=n_fft)

    hi = min(16000.0, (sr / 2.0) - 500.0)
    band = (freq >= 4500.0) & (freq <= hi)
    if np.sum(band) < 32:
        return _probe(0.0, 0.0, "Sample rate too low for comb periodicity analysis")

    S_band = S_db[band, :]
    n_sections = 6
    if S_band.shape[1] < n_sections * 4:
        return _probe(0.0, 0.0, "Too few frames for section stability analysis")

    sections = np.array_split(np.arange(S_band.shape[1]), n_sections)
    section_scores = []
    section_median_spacing = []
    section_peak_counts = []

    for sec_idx in sections:
        sec = S_band[:, sec_idx]
        profile = np.mean(sec, axis=1)
        resid = profile - _moving_minimum(profile, win=21)
        peaks, _ = find_peaks(resid, prominence=1.2, distance=2)

        section_peak_counts.append(int(peaks.size))
        if peaks.size < 5:
            continue

        spacing = np.diff(peaks).astype(float)
        periodicity = 1.0 - _clamp(_normalized_mad(spacing), 0.0, 1.0)
        strength = float(np.mean(resid[peaks]))

        periodic_term = _clamp((periodicity - 0.50) / 0.50)
        strength_term = _clamp((strength - 1.0) / 3.0)
        sec_score = periodic_term * strength_term

        section_scores.append(sec_score)
        section_median_spacing.append(float(np.median(spacing)))

    valid_sections = len(section_scores)
    if valid_sections == 0:
        rel = _clamp((np.mean(section_peak_counts) / 8.0) * 0.25) if section_peak_counts else 0.0
        return _probe(0.0, rel, "No stable comb-like periodicity detected across sections")

    comb_periodicity = float(np.median(section_scores))
    if len(section_median_spacing) >= 2:
        stability = 1.0 - _clamp(_normalized_mad(np.asarray(section_median_spacing), denom_floor=1.0), 0.0, 1.0)
    else:
        stability = 0.0

    score = _clamp((0.7 * comb_periodicity) + (0.3 * stability * comb_periodicity))

    avg_peaks = float(np.mean(section_peak_counts)) if section_peak_counts else 0.0
    rel_sections = _clamp(valid_sections / n_sections)
    rel_peaks = _clamp(avg_peaks / 10.0)
    reliability = _clamp(rel_sections * rel_peaks)

    if score >= 0.5:
        reason = (
            f"Stable comb periodicity across sections (comb={comb_periodicity:.2f}, "
            f"stability={stability:.2f})"
        )
    elif score >= 0.2:
        reason = (
            f"Some comb-like periodicity observed (comb={comb_periodicity:.2f}, "
            f"stability={stability:.2f})"
        )
    else:
        reason = (
            f"No strong comb-periodic artifact pattern (comb={comb_periodicity:.2f}, "
            f"stability={stability:.2f})"
        )

    return _probe(
        score,
        reliability,
        reason,
        valid_sections=valid_sections,
        section_count=n_sections,
        comb_periodicity=_safe_round(comb_periodicity, 3),
        cross_section_stability=_safe_round(stability, 3),
    )


def _combine_probes(probes: list[tuple[dict, float]]) -> tuple[float, float]:
    total = 0.0
    denom = 0.0
    for probe, w in probes:
        rel = float(probe.get("reliability", 0.0))
        score = float(probe.get("score", 0.0))
        total += score * w * rel
        denom += w * rel
    if denom <= 0:
        return 0.0, 0.0
    return total / denom, _clamp(denom / max(sum(w for _, w in probes), 1e-9))


def _check_stem(stem_audio: np.ndarray, sr: int, stem_name: str) -> dict:
    if stem_audio is None or len(stem_audio) == 0:
        return _probe(0.0, 0.0, f"No {stem_name} stem available")

    y = (
        stem_audio
        if stem_audio.ndim == 1
        else librosa.to_mono(stem_audio)
        if stem_audio.ndim == 2
        else stem_audio
    )

    ctx = _build_mix_context(y, sr)
    details = []

    if stem_name == "vocals":
        vocal = _check_vocal_naturalness(y, sr)
        smooth = _check_spectral_smoothness(y, sr, ctx)
        probes = [(vocal, 1.0), (smooth, 0.4)]

        if vocal["score"] > 0.1:
            details.append(f"vocal: {vocal['detail']}")
        if smooth["score"] > 0.2:
            details.append(f"spectrum: {smooth['detail']}")

    elif stem_name == "drums":
        trans = _check_transient_uniformity(y, sr, ctx)
        timing = _check_timing_regularity(y, sr, ctx)
        probes = [(trans, 1.0), (timing, 0.8)]

        if trans["score"] > 0.15:
            details.append(f"transients: {trans['detail']}")
        if timing["score"] > 0.15:
            details.append(f"timing: {timing['detail']}")

    else:
        artifacts = _check_spectral_artifacts(y, sr, ctx)
        residual = _check_residual_coherence(y, sr, ctx)
        probes = [(artifacts, 1.0), (residual, 0.7)]

        if artifacts["score"] > 0.15:
            details.append(f"artifacts: {artifacts['detail']}")
        if residual["score"] > 0.15:
            details.append(f"residual: {residual['detail']}")

    score, coverage = _combine_probes(probes)
    reliability = _clamp(float(np.mean([p.get("reliability", 0.0) for p, _ in probes])) * coverage)

    if details:
        reason = "; ".join(details)
    else:
        reason = f"{stem_name.capitalize()} stem appears natural"

    return _probe(score, reliability, reason)


def _compute_confidence(checks: list[dict]) -> tuple[float, float, float]:
    weighted_budget = 0.0
    weighted_covered = 0.0
    score_samples = []
    score_weights = []

    for c in checks:
        w = float(c.get("weight", 0.0))
        rel = float(c.get("reliability", 0.0))
        score = float(c.get("score", 0.0))

        if w <= 0.0:
            continue
        weighted_budget += w
        weighted_covered += w * rel

        if rel > 0.05:
            score_samples.append(score)
            score_weights.append(max(1e-9, w * rel))

    coverage = weighted_covered / weighted_budget if weighted_budget > 0 else 0.0

    if len(score_samples) < 2:
        agreement = 0.45 if score_samples else 0.0
    else:
        arr = np.asarray(score_samples, dtype=float)
        w = np.asarray(score_weights, dtype=float)
        mean = float(np.average(arr, weights=w))
        var = float(np.average((arr - mean) ** 2, weights=w))
        std = math.sqrt(max(var, 0.0))
        agreement = _clamp(1.0 - (std / 0.35))

    confidence = _clamp(coverage * agreement)
    return confidence, coverage, agreement


def _confidence_band(confidence: float) -> str:
    if confidence < 0.35:
        return "low"
    if confidence < 0.7:
        return "medium"
    return "high"


def detect_ai(file_path: str, sr: int = 44100, stems_dir: str | None = None) -> dict:
    """
    Reliability-aware AI music detection.

    Backward compatibility:
    - `probability` is preserved and equals `risk_score_raw`.
    - `score` and `detail` are present for legacy renderers.
    - Per-check `detail` is preserved; `reason`/`reliability` are added.
    """
    # Load audio.
    y_stereo, _ = librosa.load(file_path, sr=sr, mono=False)
    if y_stereo.ndim == 1:
        y_stereo = np.stack([y_stereo, y_stereo])

    y_mono = librosa.to_mono(y_stereo)

    # Representative middle section.
    duration = len(y_mono) / sr
    if duration > 45:
        start = int(sr * max(0, (duration / 2) - 15))
        end = int(sr * min(duration, (duration / 2) + 15))
        y_mono = y_mono[start:end]
        y_stereo = y_stereo[:, start:end]

    mix_ctx = _build_mix_context(y_mono, sr)

    stems = {}
    if stems_dir:
        for stem_name in ["vocals", "drums", "bass", "other"]:
            patterns = [
                os.path.join(stems_dir, "**", f"{stem_name}.wav"),
                os.path.join(stems_dir, f"*{stem_name}*.wav"),
            ]
            for pattern in patterns:
                matches = glob.glob(pattern, recursive=True)
                if not matches:
                    continue
                try:
                    stem_audio, _ = librosa.load(matches[0], sr=sr, mono=True)
                    if duration > 45 and len(stem_audio) > end:
                        stem_audio = stem_audio[start:end]
                    stems[stem_name] = stem_audio
                except Exception:
                    pass
                break

    # Recommendation 16 no-stem defaults.
    no_stem_weights = {
        "Spectral Ceiling": 0.4,
        "Spectral Smoothness": 0.3,
        "Stereo Phase": 0.0,
        "Micro-Timing": 0.4,
        "Dynamic Flatness": 0.3,
        "Residual Coherence": 0.4,
        "Spectral Artifacts": 1.2,
        "Vocal Naturalness (mix)": 0.8,
    }

    mix_weights = {
        "Spectral Ceiling": 0.5,
        "Spectral Smoothness": 0.3,
        "Stereo Phase": 0.0,
        "Micro-Timing": 0.4,
        "Dynamic Flatness": 0.3,
        "Residual Coherence": 0.4,
        "Spectral Artifacts": 1.1,
    }

    if not stems:
        mix_weights = {k: v for k, v in no_stem_weights.items() if k != "Vocal Naturalness (mix)"}

    checks_config = [
        ("Spectral Ceiling", _check_spectral_ceiling, y_mono, mix_weights["Spectral Ceiling"]),
        ("Spectral Smoothness", _check_spectral_smoothness, y_mono, mix_weights["Spectral Smoothness"]),
        ("Stereo Phase", _check_phase_uniformity, y_stereo, mix_weights["Stereo Phase"]),
        ("Micro-Timing", _check_timing_regularity, y_mono, mix_weights["Micro-Timing"]),
        ("Dynamic Flatness", _check_dynamic_flatness, y_mono, mix_weights["Dynamic Flatness"]),
        ("Residual Coherence", _check_residual_coherence, y_mono, mix_weights["Residual Coherence"]),
        ("Spectral Artifacts", _check_spectral_artifacts, y_mono, mix_weights["Spectral Artifacts"]),
    ]

    checks: list[dict] = []
    weighted_sum = 0.0
    total_weight = 0.0

    for name, func, audio, weight in checks_config:
        try:
            result = func(audio, sr, mix_ctx)
        except Exception as e:
            result = _probe(0.0, 0.0, f"Analysis failed: {str(e)}")

        rel = float(result.get("reliability", 0.0))
        score = float(result.get("score", 0.0))

        checks.append(
            {
                "name": name,
                "score": _safe_round(score, 3),
                "weight": _safe_round(weight, 3),
                "reliability": _safe_round(rel, 3),
                "reason": result.get("reason") or result.get("detail") or "",
                "detail": result.get("detail") or result.get("reason") or "",
                "effective_weight": _safe_round(weight * rel, 3),
            }
        )

        # Preserve probe metadata used by UI diagnostics.
        for key in ["probes_run", "probes_total", "probe_failures", "vocal_activity"]:
            if key in result:
                checks[-1][key] = result[key]

        if weight > 0:
            weighted_sum += score * weight * rel
            total_weight += weight * rel

    stem_weights = {"vocals": 1.8, "drums": 1.2, "bass": 0.9, "other": 0.9}
    stem_verdicts = []

    for stem_name, weight in stem_weights.items():
        if stem_name not in stems:
            continue

        try:
            result = _check_stem(stems[stem_name], sr, stem_name)
        except Exception as e:
            result = _probe(0.0, 0.0, f"Analysis failed: {str(e)}")

        rel = float(result.get("reliability", 0.0))
        score = float(result.get("score", 0.0))
        effective = score * rel

        display_name = f"{stem_name.capitalize()} Stem"
        checks.append(
            {
                "name": display_name,
                "score": _safe_round(score, 3),
                "weight": _safe_round(weight, 3),
                "reliability": _safe_round(rel, 3),
                "reason": result.get("reason") or result.get("detail") or "",
                "detail": result.get("detail") or result.get("reason") or "",
                "effective_weight": _safe_round(weight * rel, 3),
            }
        )

        weighted_sum += score * weight * rel
        total_weight += weight * rel

        if effective >= 0.45:
            stem_verdict = "likely_ai"
        elif effective >= 0.2:
            stem_verdict = "uncertain"
        else:
            stem_verdict = "likely_human"

        stem_verdicts.append(
            {
                "stem": stem_name,
                "verdict": stem_verdict,
                "score": _safe_round(score, 3),
                "reliability": _safe_round(rel, 3),
                "detail": result.get("detail") or result.get("reason") or "",
            }
        )

    if "vocals" not in stems:
        try:
            vocal = _check_vocal_naturalness(y_mono, sr)
        except Exception as e:
            vocal = _probe(0.0, 0.0, f"Analysis failed: {str(e)}")

        v_weight = no_stem_weights["Vocal Naturalness (mix)"]
        v_rel = float(vocal.get("reliability", 0.0))
        v_score = float(vocal.get("score", 0.0))
        v_effective = v_score * v_rel

        checks.append(
            {
                "name": "Vocal Naturalness (mix)",
                "score": _safe_round(v_score, 3),
                "weight": _safe_round(v_weight, 3),
                "reliability": _safe_round(v_rel, 3),
                "reason": vocal.get("reason") or vocal.get("detail") or "",
                "detail": vocal.get("detail") or vocal.get("reason") or "",
                "effective_weight": _safe_round(v_weight * v_rel, 3),
                "probes_run": vocal.get("probes_run"),
                "probes_total": vocal.get("probes_total"),
                "probe_failures": vocal.get("probe_failures", []),
                "vocal_activity": vocal.get("vocal_activity"),
            }
        )

        weighted_sum += v_score * v_weight * v_rel
        total_weight += v_weight * v_rel

        if v_effective >= 0.45:
            stem_verdict = "likely_ai"
        elif v_effective >= 0.2:
            stem_verdict = "uncertain"
        else:
            stem_verdict = "likely_human"

        stem_verdicts.append(
            {
                "stem": "vocal naturalness",
                "verdict": stem_verdict,
                "score": _safe_round(v_score, 3),
                "reliability": _safe_round(v_rel, 3),
                "detail": vocal.get("detail") or vocal.get("reason") or "",
            }
        )

    risk_score_raw = (weighted_sum / total_weight) if total_weight > 0 else 0.0
    risk_score_raw = _clamp(risk_score_raw)
    risk_score_calibrated = _apply_calibration(risk_score_raw)

    confidence, coverage, agreement = _compute_confidence(checks)
    confidence_band = _confidence_band(confidence)

    max_stem_effective = 0.0
    max_stem_name = ""
    for sv in stem_verdicts:
        s = float(sv.get("score", 0.0))
        r = float(sv.get("reliability", 0.0))
        eff = s * r
        if eff > max_stem_effective:
            max_stem_effective = eff
            max_stem_name = str(sv.get("stem") or "")

    if confidence < 0.35:
        verdict = "unknown"
        summary = (
            "Evidence is too weak or conflicting for a firm call; "
            "treat this as low-confidence triage."
        )
    elif risk_score_raw >= 0.70:
        verdict = "likely_ai"
        summary = "Multiple probes align on AI-like patterns with usable confidence."
    elif max_stem_effective >= 0.45 and confidence >= 0.45:
        verdict = "likely_ai"
        summary = (
            "Strong channel-level AI-like evidence is present; "
            "manual confirmation recommended."
        )
    elif risk_score_raw >= 0.35:
        verdict = "uncertain"
        summary = "Mixed evidence; manual review recommended."
    elif max_stem_effective >= 0.20 and confidence >= 0.45:
        verdict = "uncertain"
        if max_stem_name:
            summary = (
                f"Channel-level probe flagged AI-like cues ({max_stem_name}); "
                "manual review recommended."
            )
        else:
            summary = "Channel-level probe flagged AI-like cues; manual review recommended."
    else:
        verdict = "likely_human"
        summary = "No strong AI indicators under current heuristic checks."

    # Keep a compact top-contributor summary for debugging and reports.
    contrib = []
    for c in checks:
        w = float(c.get("weight", 0.0))
        rel = float(c.get("reliability", 0.0))
        s = float(c.get("score", 0.0))
        eff = w * rel * s
        if w > 0 and eff > 0:
            contrib.append((eff, c["name"], s, rel))
    contrib.sort(reverse=True)

    if contrib:
        top = ", ".join(
            f"{name} (score={s:.2f}, rel={r:.2f})" for _, name, s, r in contrib[:3]
        )
        detail = f"{summary} Top contributing probes: {top}."
    else:
        detail = summary

    return {
        "score": _safe_round(risk_score_raw, 3),
        "detail": detail,
        "risk_score_raw": _safe_round(risk_score_raw, 3),
        "risk_score_calibrated": _safe_round(risk_score_calibrated, 3),
        "probability": _safe_round(risk_score_raw, 3),
        "probability_calibrated": False,
        "verdict": verdict,
        "summary": summary,
        "confidence": _safe_round(confidence, 3),
        "confidence_band": confidence_band,
        "confidence_components": {
            "coverage": _safe_round(coverage, 3),
            "agreement": _safe_round(agreement, 3),
        },
        "channel_evidence": {
            "max_stem_effective": _safe_round(max_stem_effective, 3),
            "max_stem_name": max_stem_name,
        },
        "calibration": {
            "version": _CALIBRATION.get("version"),
            "generated_at": _CALIBRATION.get("generated_at"),
            "deployment_ready": bool(_CALIBRATION.get("deployment_ready", False)),
            "sample_count": int(_CALIBRATION.get("sample_count", 0)),
            "training_note": _CALIBRATION.get("training_note"),
            "runtime_note": (
                "Probability alias remains raw risk until calibration is retrained "
                "on a labelled real-world corpus."
            ),
            "evaluated_at": datetime.now(timezone.utc).isoformat(),
        },
        "checks": checks,
        "stem_verdicts": stem_verdicts,
    }
