"""
Digital click / glitch detection — mastering-grade, conservative.

Distinguishes TRUE digital artifacts (DAC glitches, edit clicks, pops, dropouts)
from musical transients (drums, rim shots, consonants, snare hits).

Key insights:
 - True clicks are very short (< 3 ms of unusual content).
 - True clicks are SPECTRALLY FLAT (broadband, white-noise-like) whereas
   drum hits have colored/tonal spectra concentrated in low/mid bands.
 - True clicks appear as a sharp SAMPLE-LEVEL discontinuity in the high-pass
   residual that does not match the surrounding musical context.

We require *multiple independent* criteria to all agree before flagging,
so the detector errs strongly on the side of silence over false positives.
"""

import numpy as np
import librosa
from scipy.signal import butter, sosfilt


def detect_clicks(path_a: str, path_b: str, sr: int = 44100) -> list:
    """Detect digital clicks/glitches in File B (the compared file)."""
    return detect_clicks_single(path_b, sr)


def detect_clicks_single(path: str, sr: int = 44100) -> list:
    """Detect digital clicks AND glitches in a single file."""
    y, _ = librosa.load(path, sr=sr, mono=True)
    artifacts = find_artifacts(y, sr)

    # Dedupe within 80ms
    artifacts.sort(key=lambda c: c["time"])
    filtered = []
    for a in artifacts:
        if not filtered or (a["time"] - filtered[-1]["time"]) > 0.08:
            filtered.append(a)

    # Keep top 20 by severity
    if len(filtered) > 20:
        sev_order = {"high": 0, "medium": 1, "low": 2}
        filtered = sorted(filtered, key=lambda c: sev_order.get(c["severity"], 2))[:20]
        filtered.sort(key=lambda c: c["time"])

    for c in filtered:
        c.pop("ratio", None)
    return filtered


def find_artifacts(y: np.ndarray, sr: int) -> list:
    """
    Find true digital artifacts using a strict multi-criteria detector.

    A candidate is only flagged if ALL of the following hold:
      1. Extreme sample-level discontinuity (>> local derivative norm).
      2. Very short duration (<= 3 ms of anomalous samples).
      3. High spectral flatness in a tight window around the event
         (flat / white-noise-like, NOT tonal like a drum hit).
      4. High-frequency residual (>5 kHz) spikes well above the
         surrounding HF floor — musical transients concentrate energy
         in low/mid bands.
    """
    if len(y) < sr * 0.5:
        return []

    artifacts = []

    # ── Step 1: High-pass residual ──────────────────────────────────────────
    # True clicks carry significant energy above 5 kHz. Drum hits decay quickly
    # in HF, whereas a click is a near-Dirac-like impulse → uniform HF energy.
    nyq = sr / 2
    sos_hp = butter(4, 5000 / nyq, btype='highpass', output='sos')
    hp = sosfilt(sos_hp, y)
    abs_hp = np.abs(hp)

    # Rolling RMS of HP residual (short window)
    win = max(8, int(sr * 0.0005))  # 0.5 ms
    # Use cumulative-sum for fast rolling RMS
    hp2 = hp * hp
    csum = np.concatenate(([0.0], np.cumsum(hp2, dtype=np.float64)))
    def rolling_rms(center: int, half: int) -> float:
        a = max(0, center - half)
        b = min(len(hp2), center + half + 1)
        n = b - a
        if n <= 0:
            return 0.0
        return float(np.sqrt((csum[b] - csum[a]) / n))

    # Global HF noise floor (for baseline comparison)
    global_hf_rms = float(np.sqrt(np.mean(hp2) + 1e-20))
    if global_hf_rms < 1e-8:
        return []

    # ── Step 2: Find HP peaks that exceed the local floor by a large factor ──
    # Step through the signal and look at HP peaks
    # Require peak > 30x the MEDIAN HP RMS in surrounding 200ms
    ctx_half = int(sr * 0.1)  # 100ms each side
    min_gap = int(sr * 0.08)  # 80ms between detections
    last_idx = -min_gap

    # Sample stride — check every 0.5ms
    step = max(1, int(sr * 0.0005))

    # Pre-compute absolute of the full signal
    abs_y = np.abs(y)

    for i in range(ctx_half, len(y) - ctx_half, step):
        peak_hp = abs_hp[i]
        if peak_hp < 0.005:
            continue
        if (i - last_idx) < min_gap:
            continue

        # Local HP RMS excluding the spike itself (5ms guard band)
        guard = int(sr * 0.0025)
        before = hp2[max(0, i - ctx_half):max(0, i - guard)]
        after = hp2[min(len(hp2), i + guard):min(len(hp2), i + ctx_half)]
        if len(before) < 10 or len(after) < 10:
            continue
        local_hf = float(np.sqrt((np.sum(before) + np.sum(after)) / (len(before) + len(after)) + 1e-20))
        if local_hf < 1e-8:
            continue

        hf_ratio = peak_hp / local_hf
        if hf_ratio < 15.0:  # Require strong HF burst
            continue

        # ── Step 3: Duration check ──────────────────────────────────────────
        # Count contiguous samples where HP envelope is above half-peak.
        # A digital click / pop is narrow (≤ 3 ms). Drum hits are broader in HF.
        thresh = peak_hp * 0.5
        left = i
        while left > 0 and abs_hp[left] > thresh and (i - left) < int(sr * 0.02):
            left -= 1
        right = i
        while right < len(abs_hp) - 1 and abs_hp[right] > thresh and (right - i) < int(sr * 0.02):
            right += 1
        duration_ms = (right - left) * 1000.0 / sr
        if duration_ms > 4.0:
            continue  # Too long — musical transient, not a click

        # ── Step 4: Spectral flatness check ─────────────────────────────────
        # A true digital click has high spectral flatness (broadband /
        # white-noise-like). Drum hits are tonal / colored: snare ≈ 150–4k Hz,
        # kick ≈ 50–200 Hz, rim ≈ 800–2k Hz.
        seg_half = int(sr * 0.002)  # 2ms either side → 4ms window
        a = max(0, i - seg_half)
        b = min(len(y), i + seg_half)
        seg = y[a:b]
        if len(seg) < 32:
            continue
        # Pad to power of 2 for FFT
        n_fft = 256
        if len(seg) < n_fft:
            seg_p = np.pad(seg, (0, n_fft - len(seg)))
        else:
            seg_p = seg[:n_fft]
        flatness = _spectral_flatness(seg_p)
        # Tightened from 0.35 → 0.50 after drum / rim-shot / consonant false positives.
        # True digital clicks are near-white-noise (flatness > 0.5); drum hits and
        # sibilance are coloured spectra (flatness < 0.5).
        if flatness < 0.50:
            continue

        # Extra drum-defeat: if the HF burst is immediately FOLLOWED by a sustained
        # mid-band tail (classic snare / clap decay), it's not a click. Check
        # 15 ms after the event for sustained mid-band energy.
        tail_start = min(len(y), i + int(sr * 0.005))
        tail_end = min(len(y), i + int(sr * 0.020))
        if tail_end - tail_start > 32:
            tail = y[tail_start:tail_end]
            tail_flatness = _spectral_flatness(tail[:min(256, len(tail))])
            tail_rms = float(np.sqrt(np.mean(tail ** 2)))
            if tail_flatness < 0.25 and tail_rms > peak_hp * 0.3:
                # Sustained tonal tail → drum / snare / clap, not a click.
                continue

        # ── Step 5: sample-level derivative sanity check ────────────────────
        if i > 1 and i < len(y) - 1:
            d1 = abs(float(y[i]) - float(y[i - 1]))
            d2 = abs(float(y[i + 1]) - float(y[i]))
            # Use the LARGER of the two adjacent steps.
            step_size = max(d1, d2)
            # Context derivative
            d_win = 64
            ctx = np.abs(np.diff(y[max(0, i - d_win):min(len(y), i + d_win)]))
            if len(ctx) < 10:
                continue
            ctx_med = float(np.median(ctx) + 1e-10)
            if step_size / ctx_med < 6.0:
                continue

        # ── Passed all gates — record ───────────────────────────────────────
        last_idx = i
        t = float(i / sr)
        peak_full = float(np.max(abs_y[max(0, i - seg_half):min(len(y), i + seg_half)]))
        energy_db = float(20 * np.log10(max(peak_full, 1e-10)))
        if hf_ratio > 40 and flatness > 0.55:
            severity = "high"
        elif hf_ratio > 25:
            severity = "medium"
        else:
            severity = "low"

        artifacts.append({
            "time": round(t, 3),
            "time_formatted": format_time(t),
            "severity": severity,
            "energy_db": round(energy_db, 1),
            "ratio": round(float(hf_ratio), 1),
            "description": _describe(severity, t, hf_ratio, duration_ms, flatness),
        })

    return artifacts


def _spectral_flatness(x: np.ndarray) -> float:
    """
    Geometric mean / arithmetic mean of the magnitude spectrum.
    1.0 = pure white noise, 0.0 = pure tone.
    """
    spec = np.abs(np.fft.rfft(x))
    spec = spec[1:]  # drop DC
    if len(spec) == 0:
        return 0.0
    # Floor to avoid log(0)
    spec = np.maximum(spec, 1e-12)
    geo = float(np.exp(np.mean(np.log(spec))))
    arith = float(np.mean(spec))
    if arith < 1e-12:
        return 0.0
    return min(1.0, geo / arith)


def _describe(severity: str, t: float, ratio: float, duration_ms: float, flatness: float) -> str:
    ts = format_time(t)
    if severity == "high":
        return (f"Digital click at {ts} — {ratio:.0f}× HF spike, {duration_ms:.1f} ms, "
                f"flatness {flatness:.2f}. Very likely audible.")
    if severity == "medium":
        return (f"Click/pop at {ts} — {ratio:.0f}× HF spike, {duration_ms:.1f} ms. "
                f"Likely audible on monitors.")
    return (f"Minor click at {ts} — {ratio:.0f}× HF spike, {duration_ms:.1f} ms. "
            f"May only be audible at high volume.")


def format_time(seconds: float) -> str:
    mins = int(seconds // 60)
    secs = seconds % 60
    return f"{mins}:{secs:05.2f}"
