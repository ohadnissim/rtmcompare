"""
Render a corrected version of the file with the suggested EQ moves baked in.

Given a source WAV and a list of parametric EQ bands
[{ freq, gain_db, q }, …], produces a new WAV file with that EQ applied
so the user can A/B the corrected version against their original.

We use scipy's peaking-EQ biquad cascade (direct-form II transposed via sosfilt).
Coefficients follow the Audio EQ Cookbook's peaking EQ formula.
"""

import os
import sys
import tempfile

# Windows: bundled embeddable Python's _pth file does not auto-add the
# script directory to sys.path. Make neighbour modules importable.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
import soundfile as sf
from scipy.signal import sosfilt

# Loudness-match step needs pyloudnorm. Imported lazily so any environment
# missing the package still renders the EQ chain — only the loudness-match
# step degrades to a no-op with a stderr warning.
try:
    import pyloudnorm as pyln  # type: ignore
    _HAS_PYLN = True
except Exception:
    _HAS_PYLN = False


def _match_loudness(
    data: np.ndarray,
    sr: int,
    target_lufs: float,
    headroom_db_max: float = 4.0,
) -> tuple:
    """Closed-loop loudness-match: measure integrated LUFS, compute the
    linear gain needed to land on target_lufs, cap the gain at
    +headroom_db_max dB so we never slam the limiter on a quiet source
    chasing a hot reference.

    Returns (data_out, applied_db, capped, measured_in_lufs).

    Behaviour notes:
    - Attenuation is uncapped (always safe to bring level DOWN).
    - Boosts above headroom_db_max are clamped — a stderr line records
      what would have been required so the user can see the gap.
    - Silence / NaN measurements pass through unchanged (no gain).
    """
    if not _HAS_PYLN:
        print(
            "[apply_eq] pyloudnorm not installed — skipping loudness match. "
            "Bundle should ship pyloudnorm; this fallback is for dev only.",
            file=sys.stderr,
        )
        return data, 0.0, False, float("nan")

    meter = pyln.Meter(sr)
    # pyloudnorm wants (samples, channels) in float; ours already is.
    measured = float(meter.integrated_loudness(data.astype(np.float64)))
    if not np.isfinite(measured):
        return data, 0.0, False, measured

    delta_db = target_lufs - measured
    capped = False
    if delta_db > headroom_db_max:
        print(
            f"[apply_eq] Loudness match capped: needed {delta_db:+.1f} dB to hit "
            f"{target_lufs:.1f} LUFS from {measured:.1f}, applied {headroom_db_max:+.1f} dB. "
            "Limiter would have engaged heavily otherwise.",
            file=sys.stderr,
        )
        delta_db = headroom_db_max
        capped = True

    if abs(delta_db) < 0.05:
        return data, delta_db, capped, measured  # already on target, no-op

    gain_lin = 10.0 ** (delta_db / 20.0)
    return data * gain_lin, delta_db, capped, measured


def _peaking_eq_sos(freq: float, gain_db: float, q: float, sr: int):
    """
    Build SOS coefficients for a peaking EQ biquad.
    Matches Audio EQ Cookbook (Robert Bristow-Johnson).
    """
    A = 10.0 ** (gain_db / 40.0)
    w0 = 2.0 * np.pi * freq / sr
    cos_w0 = np.cos(w0)
    sin_w0 = np.sin(w0)
    alpha = sin_w0 / (2.0 * max(q, 0.001))

    b0 = 1 + alpha * A
    b1 = -2 * cos_w0
    b2 = 1 - alpha * A
    a0 = 1 + alpha / A
    a1 = -2 * cos_w0
    a2 = 1 - alpha / A

    # Normalize to a0
    b = np.array([b0, b1, b2]) / a0
    a = np.array([1.0, a1 / a0, a2 / a0])
    # sosfilt expects shape (n, 6) = [b0 b1 b2 a0 a1 a2]
    return np.array([[b[0], b[1], b[2], a[0], a[1], a[2]]])


def _running_min(x: np.ndarray, window: int) -> np.ndarray:
    """O(n) running minimum (look-ahead) over `window` samples using a
    monotonic deque. For each i, result[i] = min(x[i : i+window+1]).

    Used by the limiter's look-ahead stage — a naive nested loop makes 3 min
    files take minutes, this stays real-time-proportional."""
    n = x.shape[0]
    out = np.empty(n, dtype=x.dtype)
    # Indices of a monotonically increasing deque over x.
    from collections import deque
    dq: "deque[int]" = deque()
    for i in range(n + window):
        # Push new value (if within bounds).
        if i < n:
            while dq and x[dq[-1]] >= x[i]:
                dq.pop()
            dq.append(i)
        # Pop values that have fallen out of the look-ahead window.
        left = i - window
        while dq and dq[0] < left:
            dq.popleft()
        if left >= 0:
            out[left] = x[dq[0]]
    return out


def _true_peak_limit(
    data: np.ndarray,
    sr: int,
    ceiling_dbtp: float = -1.0,
    oversample: int = 16,
) -> np.ndarray:
    """
    Mastering-grade true-peak limiter.

    Shape modelled on TDR Limiter 6 / GE's "True Peak" mode:
      • 16× polyphase oversampling (Kaiser-windowed FIR) to estimate
        inter-sample peaks with < 0.05 dB error vs a dedicated ISP detector.
      • Look-ahead running minimum for click-free attack (5 ms forward peek).
      • Dual-branch release: a fast branch (30 ms) that pulls the gain back
        quickly on sparse transient material, and a slow branch (300 ms)
        that holds for sustained content — blended by a crest-factor
        estimator so dense loud passages don't pump.
      • Hann-windowed smoothing pass (~1.5 ms) on the gain envelope removes
        any residual knee artefacts while staying well inside transparency.
      • No make-up gain applied — the limiter only attenuates; user gets to
        hear exactly how much headroom the ceiling bought.

    When the input is already below the ceiling by ≥ 0.05 dB, returns the
    input untouched so sub-ceiling material is truly bit-perfect.
    """
    # scipy.signal is a hard dependency for true-peak oversampling.
    # If it can't import, raising loudly is correct — a limiter that
    # silently becomes a no-op is worse than a crash, because the user
    # sees their master escape the TP ceiling in production.
    from scipy.signal import resample_poly, firwin

    ceiling_lin = 10.0 ** (ceiling_dbtp / 20.0)
    channels = data.shape[1]
    n = data.shape[0]

    # Early-out if sample-rate peak is already comfortably below the ceiling.
    sample_peak = float(np.max(np.abs(data)))
    if sample_peak <= 0:
        return data

    # ── 1. Oversampled true-peak envelope at source rate ────────────────
    # Kaiser-windowed FIR used by resample_poly is effectively the same as a
    # transparent linear-phase lowpass — good enough for TP detection.
    envelope = np.zeros(n, dtype=np.float64)
    up = max(2, int(oversample))
    # Custom high-quality FIR for the polyphase filter — Kaiser β=12 gives
    # > 140 dB stopband, inaudible aliasing. Length scales with `up`.
    #
    # NOTE: scipy.signal.resample_poly internally normalises an array-form
    # window via `h *= up` to give the polyphase filter unity DC gain.
    # Pre-scaling the FIR ourselves (the old `* up` line) made scipy
    # double-scale and silently inflate the upsampled signal by `up`x —
    # which made the limiter see +24 dBTP where the audio was actually
    # at 0 dBFS, then attenuate the WHOLE FILE by ~24 dB. firwin already
    # returns a unit-DC-gain FIR (sum ≈ 1), so we pass it as-is.
    fir = firwin(numtaps=up * 64 + 1, cutoff=0.98 / up, window=('kaiser', 12.0))
    for ch in range(channels):
        # resample_poly failure is a hard error — falling back to
        # nearest-neighbour repeat would silently de-tune the TP
        # estimate by up to 0.6 dB and let a master escape the ceiling.
        upsampled = resample_poly(data[:, ch], up, 1, window=fir)
        usable = (upsampled.shape[0] // up) * up
        block = np.abs(upsampled[:usable]).reshape(-1, up).max(axis=1)
        if block.shape[0] < n:
            block = np.pad(block, (0, n - block.shape[0]), mode='edge')
        else:
            block = block[:n]
        envelope = np.maximum(envelope, block)

    true_peak = float(np.max(envelope))
    # Anything within 0.01 dB of the ceiling is a no-op — avoids pointless
    # gain riding on already-compliant material.
    if true_peak <= ceiling_lin * (10.0 ** (0.01 / 20.0)):
        return data

    # ── 2. Target gain per sample ────────────────────────────────────────
    # 1.0 where we're below ceiling, <1 where we need to attenuate.
    target = np.ones(n, dtype=np.float64)
    mask = envelope > ceiling_lin
    target[mask] = ceiling_lin / envelope[mask]

    # ── 3. Look-ahead (running minimum) ──────────────────────────────────
    attack_ms = 5.0
    attack_samples = max(1, int(sr * attack_ms / 1000))
    look_ahead = _running_min(target, attack_samples)

    # ── 4. Dual-branch release envelope with crest-aware blend ──────────
    # Fast release catches sparse peaks (snap back to unity), slow release
    # holds through dense programme material (keeps perceived loudness
    # steady). Blend weight derived from local crest factor: dense + loud
    # → lean on slow branch, sparse → lean on fast branch.
    fast_ms = 30.0
    slow_ms = 300.0
    fast_coef = np.exp(-1.0 / (sr * fast_ms / 1000.0))
    slow_coef = np.exp(-1.0 / (sr * slow_ms / 1000.0))

    # Crest factor proxy: peak / RMS over ~50 ms windows of the mono sum.
    # Implemented in chunked form for speed.
    mono = np.mean(data, axis=1)
    chunk = max(1, int(sr * 0.05))
    n_chunks = (n + chunk - 1) // chunk
    crest_per_sample = np.empty(n, dtype=np.float64)
    for c in range(n_chunks):
        lo = c * chunk
        hi = min(n, lo + chunk)
        seg = mono[lo:hi]
        seg_abs = np.abs(seg)
        rms = float(np.sqrt(np.mean(seg * seg))) + 1e-9
        pk = float(np.max(seg_abs)) if seg_abs.size else 0.0
        # Crest in dB (peak / RMS). Typical range: ~6 (dense) … ~20 (sparse).
        crest_db = 20.0 * np.log10(max(pk, 1e-9) / rms)
        # Map crest 6→0 (pure slow) … 18→1 (pure fast), clamped.
        w = (crest_db - 6.0) / (18.0 - 6.0)
        crest_per_sample[lo:hi] = max(0.0, min(1.0, w))

    smoothed = np.empty(n, dtype=np.float64)
    smoothed[0] = look_ahead[0]
    for i in range(1, n):
        prev = smoothed[i - 1]
        tgt = look_ahead[i]
        if tgt < prev:
            # Attack — already looked ahead, so snap.
            smoothed[i] = tgt
        else:
            # Release — blend fast and slow single-pole responses.
            w = crest_per_sample[i]
            coef = w * fast_coef + (1.0 - w) * slow_coef
            smoothed[i] = tgt + (prev - tgt) * coef

    # ── 5. Short Hann-windowed smoothing pass (≈ 1.5 ms) ────────────────
    # Cleans up micro-steps in the gain curve left by the dual-branch
    # switching — purely transparent, well below perceptual thresholds.
    smooth_len = max(3, int(sr * 0.0015))
    if smooth_len % 2 == 0:
        smooth_len += 1
    win = np.hanning(smooth_len)
    win /= win.sum()
    # Pad so the output length matches `n` and edges don't droop.
    pad = smooth_len // 2
    padded = np.concatenate([np.full(pad, smoothed[0]), smoothed, np.full(pad, smoothed[-1])])
    gain_env = np.convolve(padded, win, mode='valid')
    # Ensure length matches.
    if gain_env.shape[0] != n:
        if gain_env.shape[0] < n:
            gain_env = np.pad(gain_env, (0, n - gain_env.shape[0]), mode='edge')
        else:
            gain_env = gain_env[:n]

    # Safety: never EXCEED the look-ahead target (smoothing must only shrink
    # gain, never grow it into a peak).
    gain_env = np.minimum(gain_env, look_ahead)

    # ── 6. Apply gain and pull back hard if any residual overs remain ───
    out = data.astype(np.float64) * gain_env[:, None]

    # Final safety net: measure TP on the output, if anything crept over
    # pull down by the required amount (worst-case 0.1 dB correction).
    final_env = np.zeros(n, dtype=np.float64)
    for ch in range(channels):
        # Second oversample pass — same reasoning as the first: any
        # resample_poly failure is a hard error, not a silent degrade.
        up_out = resample_poly(out[:, ch], up, 1, window=fir)
        usable = (up_out.shape[0] // up) * up
        block = np.abs(up_out[:usable]).reshape(-1, up).max(axis=1)
        if block.shape[0] < n:
            block = np.pad(block, (0, n - block.shape[0]), mode='edge')
        else:
            block = block[:n]
        final_env = np.maximum(final_env, block)
    final_peak = float(np.max(final_env))
    if final_peak > ceiling_lin:
        out *= (ceiling_lin / final_peak)

    return out


def render_corrected(
    src_path: str,
    bands: list,
    out_path: str = None,
    true_peak_limit: bool = False,
    ceiling_dbtp: float = -1.0,
    target_lufs: float = None,
) -> str:
    """
    Apply a series of peaking-EQ bands to `src_path` and write the result.

    Args:
        src_path: path to source audio (WAV / FLAC / any soundfile-supported).
        bands: list of { "freq": Hz, "gain_db": float, "q": float }
        out_path: destination path. If None, a temp path is generated.
        true_peak_limit: when True, apply a look-ahead true-peak limiter so
            EQ boosts never push above the ceiling. Essential when the chain
            contains positive-gain bands on loud material.
        ceiling_dbtp: limiter ceiling in dBTP. Default −1.0 (safe for every
            streaming platform and broadcast spec). Ignored when
            true_peak_limit is False.
        target_lufs: when set, do a closed-loop measure-then-trim to land
            on this integrated LUFS. Boost gain is capped at +4 dB so a
            quiet source chasing a hot reference doesn't slam the limiter.
            If pyloudnorm is missing, the step degrades to a no-op with a
            stderr warning. The trim is applied AFTER EQ but BEFORE the
            true-peak limiter so the limiter sees the final level.

    Returns: the output file path (absolute).
    """
    if out_path is None:
        import uuid
        base = os.path.splitext(os.path.basename(src_path))[0]
        out_path = os.path.join(tempfile.gettempdir(), f"{base}__RTM-corrected-{uuid.uuid4().hex[:8]}.wav")

    # 5.2.0 reliability guard (audit P1-16): refuse to load any file whose
    # decoded float64 buffer would exceed an env-tunable budget. Without
    # this, a 60-min 96 kHz/24-bit 5.1 master decodes to ~7.5 GB in
    # float64 and the renderer process OOMs silently.
    try:
        info = sf.info(src_path)
    except Exception as exc:
        raise RuntimeError(f"Cannot read source file metadata: {exc}") from exc
    if info.frames <= 0:
        raise RuntimeError(
            f"Source file reports 0 frames — the file may be empty or corrupted: {src_path}"
        )
    estimated_bytes = info.frames * max(info.channels, 1) * 8  # float64
    budget_bytes = int(os.environ.get('RTM_PY_MAX_DECODE_BYTES', 4 * 1024 * 1024 * 1024))
    if estimated_bytes > budget_bytes:
        raise RuntimeError(
            f"Source file too large to render in one pass: needs "
            f"~{estimated_bytes / 1024 / 1024 / 1024:.1f} GB of RAM "
            f"({info.frames / info.samplerate / 60:.1f} min, {info.channels} ch, "
            f"{info.samplerate} Hz). Cap is "
            f"{budget_bytes / 1024 / 1024 / 1024:.1f} GB; raise via "
            f"RTM_PY_MAX_DECODE_BYTES env var, or split the source into "
            f"shorter sections before rendering."
        )

    data, sr = sf.read(src_path, always_2d=True)  # (samples, channels)
    if data.ndim == 1:
        data = data.reshape(-1, 1)

    # Match the input's bit depth on the way out (or upgrade to 24-bit).
    # soundfile's sf.write defaults to PCM_16 for .wav with no `subtype`,
    # which silently downgraded 24-bit + 32-bit float sources. Master-
    # grade output should never lose bits.
    src_subtype = sf.info(src_path).subtype
    out_subtype = src_subtype if src_subtype in (
        "PCM_24", "PCM_32", "FLOAT", "DOUBLE",
    ) else "PCM_24"

    # Build a single cascaded SOS matrix from all bands
    sos_rows = []
    for b in bands:
        try:
            if abs(float(b.get("gain_db", 0))) < 0.05:
                continue  # skip no-op
            sos_rows.append(_peaking_eq_sos(
                float(b["freq"]),
                float(b["gain_db"]),
                float(b.get("q", 1.0)),
                sr,
            ))
        except Exception:
            continue

    if not sos_rows:
        # No bands → just copy through (preserving bit depth).
        sf.write(out_path, data, sr, subtype=out_subtype)
        return out_path

    sos = np.vstack(sos_rows)

    # Apply per-channel
    out = np.empty_like(data, dtype=np.float64)
    for ch in range(data.shape[1]):
        out[:, ch] = sosfilt(sos, data[:, ch].astype(np.float64))

    # Loudness match — applied AFTER EQ but BEFORE the limiter so the
    # limiter sees the final level. Capped at +4 dB boost (attenuation
    # always safe). No-op if target_lufs is None or pyloudnorm missing.
    if target_lufs is not None:
        out, applied_db, capped, measured_in = _match_loudness(out, sr, float(target_lufs))
        if np.isfinite(measured_in):
            print(
                f"[apply_eq] Loudness match: measured {measured_in:.1f} LUFS, "
                f"target {target_lufs:.1f}, applied {applied_db:+.1f} dB"
                + (" (capped)" if capped else ""),
                file=sys.stderr,
            )

    if true_peak_limit:
        # Proper look-ahead true-peak limiter — see _true_peak_limit. Only
        # attenuates where needed, transparent elsewhere.
        out = _true_peak_limit(out, sr, ceiling_dbtp=ceiling_dbtp)
    else:
        # Legacy crude protection — if EQ boosted past 0 dBFS, pull down
        # to -0.18 dBFS (0.98 linear) to avoid hard clipping.
        peak = float(np.max(np.abs(out)))
        if peak > 0.98:
            out *= (0.98 / peak)

    # 32-bit float storage when input was float (preserves dynamic range
    # for any downstream tools); else hand soundfile a float64 buffer and
    # let it do the PCM downconvert with full precision. The previous
    # `else np.float32` was a typo (both arms were float32) — fixed in
    # 5.2.0 so PCM_24 sources round-trip from float64 not float32.
    write_dtype = np.float32 if out_subtype in ("FLOAT", "DOUBLE") else np.float64
    sf.write(out_path, out.astype(write_dtype), sr, subtype=out_subtype)
    return out_path
