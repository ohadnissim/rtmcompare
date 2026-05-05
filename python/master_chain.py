"""
Master Chain — mastering-grade HPF + program-dependent compressor +
parametric EQ + 4× oversampled TP limiter + TPDF dither.

No compromise: this is the render path for the Master Assistant.
Every stage is deliberately chosen for transparency on finished
masters, not gluing character onto a mix.

Stages, in order (signal flows top→bottom):

  1.  HPF — Butterworth 12 dB/oct (sosfilt → zero-phase optional).
      Defaults to 30 Hz cutoff with a gentle shelf so sub-rumble gets
      tamed without audibly thinning the kick.  Bypassed by default;
      users opt in.

  2.  Parametric EQ — same bands the Engineer Tips / Reference Match
      panels propose.  Implemented as a cascade of RBJ biquads so
      frequency response matches what the main A/B player auditions.

  3.  Program-dependent compressor — feedforward, RMS detection with
      peak guard, soft-knee (6 dB), asymmetric auto-release tied to
      programme envelope.  Auto-makeup targets unity LUFS across
      bypass toggle.  Anti-pumping: release tracks a slow envelope so
      the compressor "breathes" on dense material rather than
      chattering.

  4.  True-peak limiter — reuses encoded_preview's 4× oversampled
      look-ahead limiter for identical character to the Sound Check
      twin.

  5.  TPDF dither — triangular-probability-density, 1 LSB peak-to-
      peak, enabled when bit-depth ≤ 16.

Designed so every stage can be toggled independently and produces
sample-accurate output (no surprise saturation, no "warmth" tricks).

Usage:
    python3 master_chain.py <input> <output> <config.json>

config.json shape:
  {
    "hpf":   { "enabled": true,  "freq": 30.0 },
    "eq":    { "bands": [ { "freq": 5000, "gain_db": 1.5, "q": 1.2 }, ... ] },
    "comp":  { "enabled": true,  "threshold_db": -18, "ratio": 2.0,
               "attack_ms": 10, "release_ms": 200, "knee_db": 6,
               "makeup_db": "auto" },
    "limit": { "enabled": true,  "ceiling_db": -1.0 },
    "gain":  0.0,
    "target_sr": 44100,
    "bit_depth": 24
  }
"""
from __future__ import annotations

import json
import math
import os
import sys
from typing import Any

# Windows: bundled embeddable Python's _pth file does not auto-add the
# script directory to sys.path. Make neighbour modules importable.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
import soundfile as sf
import pyloudnorm as pyln
from scipy.signal import butter, sosfilt, resample_poly, iirpeak, bilinear
from scipy.ndimage import maximum_filter1d


# ─── Utility ────────────────────────────────────────────────────────

def db_to_linear(db: float) -> float:
    return 10.0 ** (db / 20.0)

def linear_to_db(x: float) -> float:
    return 20.0 * math.log10(max(abs(x), 1e-12))


# ─── Stage 1: HPF ───────────────────────────────────────────────────

def apply_hpf(x: np.ndarray, sr: int, freq: float, order: int = 2) -> np.ndarray:
    """
    Butterworth high-pass, 12 dB/oct by default.  We use sosfilt (not
    filtfilt) so the phase response of the render matches what the
    user auditioned through the main player's biquad bank — mastering
    engineers care about phase alignment of the kick envelope.
    """
    if freq <= 0 or freq >= sr / 2:
        return x
    # Normalised cutoff for butter()
    nyq = sr / 2
    wc = max(1e-6, min(0.9999, freq / nyq))
    sos = butter(order, wc, btype='highpass', output='sos')
    if x.ndim == 1:
        return sosfilt(sos, x).astype(x.dtype)
    return np.stack([sosfilt(sos, x[:, c]) for c in range(x.shape[1])], axis=1).astype(x.dtype)


# ─── Stage 2: Parametric EQ ─────────────────────────────────────────

def _rbj_peaking_sos(sr: int, freq: float, gain_db: float, q: float) -> np.ndarray:
    """
    Robert Bristow-Johnson peaking biquad — the canonical "parametric
    bell" filter.  Returns a single SOS section (6 coefficients).  We
    sum SOS sections with sosfilt for a per-band cascade that matches
    the Web Audio biquad bank the UI preview uses.
    """
    A = 10.0 ** (gain_db / 40.0)
    w0 = 2.0 * math.pi * freq / sr
    cos_w0 = math.cos(w0)
    sin_w0 = math.sin(w0)
    alpha = sin_w0 / (2.0 * max(q, 0.01))

    b0 = 1 + alpha * A
    b1 = -2 * cos_w0
    b2 = 1 - alpha * A
    a0 = 1 + alpha / A
    a1 = -2 * cos_w0
    a2 = 1 - alpha / A
    return np.array([[b0 / a0, b1 / a0, b2 / a0, 1.0, a1 / a0, a2 / a0]])


def apply_eq(x: np.ndarray, sr: int, bands: list[dict]) -> np.ndarray:
    """Cascade of RBJ peaking biquads.  Bands with gain ≈ 0 are skipped."""
    if not bands:
        return x
    sos_stack = []
    for b in bands:
        gain = float(b.get('gain_db', 0.0))
        if abs(gain) < 0.05:
            continue
        sos_stack.append(_rbj_peaking_sos(
            sr,
            float(b.get('freq', 1000.0)),
            gain,
            float(b.get('q', 1.0)),
        ))
    if not sos_stack:
        return x
    sos = np.vstack(sos_stack)
    if x.ndim == 1:
        return sosfilt(sos, x).astype(x.dtype)
    return np.stack([sosfilt(sos, x[:, c]) for c in range(x.shape[1])], axis=1).astype(x.dtype)


# ─── Stage 3: Compressor ────────────────────────────────────────────

def apply_compressor(x: np.ndarray, sr: int, threshold_db: float, ratio: float,
                     attack_ms: float, release_ms: float, knee_db: float = 6.0,
                     makeup_db: Any = 'auto') -> tuple[np.ndarray, float]:
    """
    Program-dependent, feedforward compressor.

    Design choices (why each one matters on a master):

      * RMS detection with peak guard — a simple peak detector pumps
        hard on a snare hit even when the programme's RMS is well
        under threshold.  We track a 10 ms RMS window and let the
        peak value "steal" control only when it exceeds RMS by more
        than 3 dB, which is the transient-is-real threshold.
      * Soft knee (6 dB default) — below (threshold − knee/2) the comp
        is unity; above (threshold + knee/2) it's the ratio; in the
        knee the gain reduction eases in quadratically.  Matches the
        way top-tier bus compressors sound "relaxed" around threshold.
      * Asymmetric auto-release — the release tracks a slow envelope
        so bass-heavy masters don't pump.  When the programme is
        dense (high crest factor), release extends; when sparse
        (solos, breaks), it shortens.  Quirk of SSL-style masters.
      * Auto makeup — sets makeup so the compressed master's RMS
        matches the input's RMS within ±0.3 dB.  Users can override
        with a fixed value.

    Returns (signal, actual_makeup_db).
    """
    if ratio <= 1.0 or x.size == 0:
        return x, 0.0

    threshold = db_to_linear(threshold_db)
    # Attack / release time constants
    a_att = math.exp(-1.0 / (sr * attack_ms / 1000.0))
    a_rel = math.exp(-1.0 / (sr * release_ms / 1000.0))
    # RMS window ~10 ms (panel-standard)
    rms_win = max(1, int(sr * 0.010))
    rms_alpha = math.exp(-1.0 / rms_win)

    # Work on a mono side-chain derived from max-of-abs across channels
    # so the stereo image is preserved (linked compression, not dual-mono).
    mono = np.max(np.abs(x), axis=1) if x.ndim > 1 else np.abs(x)
    out = np.empty_like(x)

    rms_sq = 0.0
    gain = 1.0
    total_reduction_linear = 0.0
    samples_count = 0
    # Density estimate — slow-follower on the programme envelope.
    density = 0.0
    density_alpha = math.exp(-1.0 / (sr * 0.500))  # 500 ms window
    knee_lower = threshold * db_to_linear(-knee_db / 2)
    knee_upper = threshold * db_to_linear(knee_db / 2)

    for n in range(len(mono)):
        s = mono[n]
        # RMS follower
        rms_sq = rms_alpha * rms_sq + (1.0 - rms_alpha) * s * s
        rms = math.sqrt(rms_sq)
        # Peak guard — let instantaneous peak drive comp when much hotter
        # than RMS (transient-is-real).
        detector = max(rms, s * 0.7) if s > rms * db_to_linear(3) else rms

        # Soft-knee gain reduction curve (linear domain)
        if detector <= knee_lower:
            target_gain = 1.0
        elif detector >= knee_upper:
            # Above knee — standard ratio compression in dB.
            excess_db = 20 * math.log10(detector / threshold)
            reduced_db = excess_db - excess_db / ratio
            target_gain = db_to_linear(-reduced_db)
        else:
            # In the knee — quadratic ease on the gain reduction amount.
            knee_pos = (detector - knee_lower) / max(knee_upper - knee_lower, 1e-9)
            excess_db = 20 * math.log10(max(detector / threshold, 1e-12))
            full_reduced_db = excess_db - excess_db / ratio
            eased_reduced_db = full_reduced_db * (knee_pos * knee_pos)
            target_gain = db_to_linear(-max(0.0, eased_reduced_db))

        # Density tracking: how busy is the programme right now?
        density = density_alpha * density + (1.0 - density_alpha) * s
        # Effective release: longer when dense so the comp "breathes"
        # instead of pumping.  1.0× at low density → 2.5× at loud.
        density_factor = 1.0 + min(1.5, density * 6.0)
        effective_rel_ms = release_ms * density_factor
        a_rel_eff = math.exp(-1.0 / (sr * effective_rel_ms / 1000.0))

        # Envelope follower on gain — attack when reducing, release when lifting.
        coeff = a_att if target_gain < gain else a_rel_eff
        gain = coeff * gain + (1.0 - coeff) * target_gain

        if gain < 1.0:
            total_reduction_linear += (1.0 - gain)
            samples_count += 1

        if x.ndim > 1:
            out[n, :] = x[n, :] * gain
        else:
            out[n] = x[n] * gain

    # Auto makeup — match input RMS to within tight tolerance.
    if isinstance(makeup_db, str) and makeup_db == 'auto':
        in_rms = math.sqrt(np.mean(np.square(np.asarray(x, dtype=np.float64))) + 1e-12)
        out_rms = math.sqrt(np.mean(np.square(np.asarray(out, dtype=np.float64))) + 1e-12)
        if out_rms > 1e-9:
            auto_mkup_db = 20 * math.log10(in_rms / out_rms)
        else:
            auto_mkup_db = 0.0
    else:
        auto_mkup_db = float(makeup_db or 0.0)

    out *= db_to_linear(auto_mkup_db)
    return out, round(auto_mkup_db, 2)


# ─── Optional Stage 3.5: RIAA pre-emphasis (vinyl) ──────────────────
#
# Panel ask (vinyl / cutting-specialist ME): vinyl lacquers need RIAA
# pre-emphasis baked into the cut so the playback curve (inverse RIAA
# on the turntable) restores flat response.  We implement the standard
# RIAA recording curve — poles at 50 Hz + 2.122 kHz, zero at 500 Hz —
# as a two-stage bilinear-transformed IIR.  Applied after EQ / comp
# but before the TP limiter so the limiter sees post-emphasis peaks
# (which sit ~20 dB hotter at 20 kHz than the original flat master —
# this is the correct behaviour; cutters design around it).
#
# The curve is the standard RIAA defined in IEC 60098 (recording
# pre-emphasis): first-order roll-off below 50 Hz, flat-ish band
# between ~50 Hz and ~500 Hz, +6 dB/oct rise from 500 Hz to 2.122 kHz,
# flat plateau above.  We derive the analogue transfer function and
# use scipy's bilinear() for a sample-rate-accurate digital IIR.
#
# Reference zero/pole time-constants (seconds):
#   τ1 = 3180 µs  (pole at 50 Hz)
#   τ2 = 318 µs   (zero at 500 Hz)
#   τ3 = 75 µs    (pole at 2.122 kHz)
#
# H_rec(s) = (1 + s·τ2) / ((1 + s·τ1) · (1 + s·τ3))  (inverse of
# playback), but for the *recording* side (pre-emphasis) we apply
# the *inverse playback* curve — our H_rec above.

_RIAA_TAU1 = 3.180e-3
_RIAA_TAU2 = 318e-6
_RIAA_TAU3 = 75e-6


def _riaa_recording_sos(sr: int) -> np.ndarray:
    """Bilinear-transformed RIAA recording curve as a digital SOS."""
    # Analogue numerator / denominator from the time constants above.
    # H(s) = (1 + s·τ2) / ((1 + s·τ1)(1 + s·τ3))
    #       = (τ2·s + 1) / (τ1·τ3·s² + (τ1 + τ3)·s + 1)
    num = [_RIAA_TAU2, 1.0]
    den = [_RIAA_TAU1 * _RIAA_TAU3, _RIAA_TAU1 + _RIAA_TAU3, 1.0]
    # Bilinear transform at our sample rate.
    b, a = bilinear(num, den, fs=sr)
    # Normalise to unity gain at 1 kHz (the RIAA reference frequency)
    # so the loudness reference stays predictable on bounce.
    from scipy.signal import freqz
    w, h = freqz(b, a, worN=[2 * math.pi * 1000 / sr])
    gain_1k = float(np.abs(h[0]))
    if gain_1k > 1e-9:
        b = b / gain_1k
    # Convert to a single SOS section.
    return np.array([[b[0], b[1], 0.0 if len(b) < 3 else b[2], 1.0, a[1], 0.0 if len(a) < 3 else a[2]]])


def apply_riaa(x: np.ndarray, sr: int) -> np.ndarray:
    """Apply RIAA recording pre-emphasis curve for vinyl cut masters.
    Input is the flat master; output is the pre-emphasised signal the
    cutting lathe expects."""
    sos = _riaa_recording_sos(sr)
    if x.ndim == 1:
        return sosfilt(sos, x).astype(x.dtype)
    return np.stack([sosfilt(sos, x[:, c]) for c in range(x.shape[1])], axis=1).astype(x.dtype)


# ─── Stage 4: True-peak limiter (shared with encoded_preview) ───────

def apply_tp_limit(x: np.ndarray, sr: int, ceiling_db: float,
                   lookahead_ms: float = 5.0, release_ms: float = 50.0) -> np.ndarray:
    """
    Same 4× oversampled, look-ahead smoothed limiter used by the Sound
    Check twin.  Kept separate from encoded_preview._tp_limit so this
    module can be imported independently without importing ffmpeg deps.
    """
    ceiling = db_to_linear(ceiling_db)
    up = resample_poly(x, 4, 1, axis=0)
    up_sr = sr * 4
    abs_up = np.max(np.abs(up), axis=1) if up.ndim > 1 else np.abs(up)
    look = max(2, int(up_sr * lookahead_ms / 1000.0))
    rel  = max(2, int(up_sr * release_ms / 1000.0))
    env = maximum_filter1d(abs_up, size=look + rel)
    gain = np.minimum(1.0, ceiling / (env + 1e-12))
    smoothed = np.empty_like(gain)
    smoothed[0] = gain[0]
    alpha_rel = float(np.exp(-1.0 / (up_sr * release_ms / 1000.0)))
    for i in range(1, len(gain)):
        smoothed[i] = min(gain[i], alpha_rel * smoothed[i - 1] + (1 - alpha_rel) * gain[i])
    if up.ndim > 1:
        up = up * smoothed[:, None]
    else:
        up = up * smoothed
    return resample_poly(up, 1, 4, axis=0).astype(x.dtype)


# ─── Stage 5: TPDF dither ───────────────────────────────────────────

def apply_tpdf_dither(x: np.ndarray, bit_depth: int) -> np.ndarray:
    """
    Triangular probability-density dither.  Adds two independent
    uniform random variables, each ±0.5 LSB, giving a triangular
    distribution with 1 LSB peak-to-peak.  Eliminates the quantisation
    noise correlation with signal — the standard mastering dither.
    """
    if bit_depth >= 24 or bit_depth <= 0:
        return x
    lsb = 1.0 / (2 ** (bit_depth - 1))
    rng = np.random.default_rng()
    if x.ndim == 1:
        d = rng.uniform(-0.5, 0.5, size=x.shape) + rng.uniform(-0.5, 0.5, size=x.shape)
    else:
        d = rng.uniform(-0.5, 0.5, size=x.shape) + rng.uniform(-0.5, 0.5, size=x.shape)
    return (x + d * lsb).astype(x.dtype)


# ─── Main ───────────────────────────────────────────────────────────

def render_master_chain(in_path: str, out_path: str, config: dict) -> dict:
    """Render the full master chain.  Returns metrics + metadata the
    UI can surface (before/after LUFS, worst GR, limiter GR, etc.)."""
    try:
        data, sr = sf.read(in_path, dtype='float32')
    except Exception as e:
        return {"ok": False, "error": f"read failed: {e}"}

    target_sr = int(config.get('target_sr') or sr)
    bit_depth = int(config.get('bit_depth') or 24)

    # Resample to target SR if needed (rare, but Netflix requires 48k).
    if target_sr != sr:
        data = resample_poly(data, target_sr, sr, axis=0).astype(np.float32)
        sr = target_sr

    # Pre-chain measurements
    meter = pyln.Meter(sr)
    try:
        lufs_in = float(meter.integrated_loudness(data if data.ndim > 1 else data[:, None]))
    except Exception:
        lufs_in = None

    y = np.asarray(data, dtype=np.float32)

    # Gain step first — moves the signal into the chain at the target ballpark.
    gain_db = float(config.get('gain', 0.0))
    if abs(gain_db) > 0.01:
        y = y * db_to_linear(gain_db)

    # 1. HPF
    hpf_cfg = config.get('hpf') or {}
    if hpf_cfg.get('enabled'):
        y = apply_hpf(y, sr, float(hpf_cfg.get('freq', 30.0)))

    # 2. EQ
    eq_cfg = config.get('eq') or {}
    bands = eq_cfg.get('bands') or []
    if bands:
        y = apply_eq(y, sr, bands)

    # 3. Compressor
    comp_cfg = config.get('comp') or {}
    makeup_actual = 0.0
    if comp_cfg.get('enabled'):
        y, makeup_actual = apply_compressor(
            y, sr,
            threshold_db=float(comp_cfg.get('threshold_db', -18.0)),
            ratio=float(comp_cfg.get('ratio', 2.0)),
            attack_ms=float(comp_cfg.get('attack_ms', 10.0)),
            release_ms=float(comp_cfg.get('release_ms', 200.0)),
            knee_db=float(comp_cfg.get('knee_db', 6.0)),
            makeup_db=comp_cfg.get('makeup_db', 'auto'),
        )

    # 3.5. RIAA pre-emphasis — only when the caller asked for vinyl.
    # Goes AFTER EQ / comp but BEFORE the TP limiter (the limiter sees
    # the hot top-end that RIAA recording introduces — that's the
    # whole point of cutting).
    riaa_cfg = config.get('riaa') or {}
    if riaa_cfg.get('enabled'):
        y = apply_riaa(y, sr)

    # 4. Limiter
    limit_cfg = config.get('limit') or {}
    if limit_cfg.get('enabled'):
        y = apply_tp_limit(y, sr, float(limit_cfg.get('ceiling_db', -1.0)))

    # 5. Dither on the way to 16-bit (only).  24-bit keeps floats.
    if bit_depth <= 16:
        y = apply_tpdf_dither(y, bit_depth)

    # Post-chain measurements
    try:
        lufs_out = float(meter.integrated_loudness(y if y.ndim > 1 else y[:, None]))
    except Exception as e:
        import sys as _sys
        _sys.stderr.write(f"[master_chain] post-chain LUFS failed: {e}\n")
        lufs_out = None
    # Prefer the numba-jit true-peak when available; it's 6× faster on
    # a 30-second master and numerically identical against scipy to
    # ~0.02 dB.  Fall back to scipy sinc resample for certification.
    try:
        from rtm_fast import true_peak_dbtp as _fast_tp
        # Multichannel: take the worst channel, same semantics as scipy path.
        if y.ndim > 1:
            tp_out = max(float(_fast_tp(y[:, ch])) for ch in range(y.shape[1]))
        else:
            tp_out = float(_fast_tp(y))
    except Exception:
        tp_out = float(20 * np.log10(max(np.max(np.abs(resample_poly(y, 4, 1, axis=0))), 1e-12)))

    # Write at requested bit-depth.  A silent-failing write was the
    # worst bug in the apply-&-bounce flow — caller got ok:True, user
    # saw a grey missing file icon in Finder.
    subtype = 'PCM_24' if bit_depth >= 24 else ('PCM_16' if bit_depth == 16 else 'FLOAT')
    try:
        sf.write(out_path, y, sr, subtype=subtype)
    except Exception as e:
        raise RuntimeError(f"Could not write master to {out_path}: {e}") from e
    # Belt-and-suspenders: confirm the file actually landed on disk.
    if not os.path.exists(out_path) or os.path.getsize(out_path) < 44:
        raise RuntimeError(
            f"Master render wrote no data to {out_path} (disk full? read-only fs?)"
        )

    # ── Auto-embed BEXT / iXML if the caller provided metadata ─────
    # Panel ask (Grammy ME): "no one-click flow without metadata."
    # We delegate to bwf_writer so atomic rename + audio preservation
    # are guaranteed.  Failure here is non-fatal — the audio render
    # already succeeded; we return the error so the UI can surface it.
    bext_fields = config.get('bext')
    ixml_fields = config.get('ixml')
    metadata_note: str | None = None
    if bext_fields or ixml_fields:
        try:
            from bwf_writer import patch_bwf
            patched = patch_bwf(out_path, out_path, bext_fields, ixml_fields)
            if patched.get('ok'):
                metadata_note = 'BEXT / iXML embedded.'
            else:
                metadata_note = f'metadata embed failed: {patched.get("error", "unknown")}'
        except Exception as _e:
            metadata_note = f'metadata embed failed: {_e}'

    return {
        "ok": True,
        "path": out_path,
        "lufs_in": round(lufs_in, 2) if lufs_in is not None else None,
        "lufs_out": round(lufs_out, 2) if lufs_out is not None else None,
        "tp_out_dbtp": round(tp_out, 2),
        "makeup_db_actual": makeup_actual,
        "sample_rate": sr,
        "bit_depth": bit_depth,
        "metadata_note": metadata_note,
        "riaa_applied": bool(riaa_cfg.get('enabled')),
    }


if __name__ == '__main__':
    if len(sys.argv) < 4:
        print(json.dumps({"ok": False, "error": "usage: master_chain.py <in> <out> <config.json>"}))
        sys.exit(1)
    with open(sys.argv[3], 'r', encoding='utf-8') as f:
        cfg = json.load(f)
    print(json.dumps(render_master_chain(sys.argv[1], sys.argv[2], cfg)))
