"""
Generate visualization data for the frontend:
- Loudness over time (LUFS timeline)
- Phase correlation over time
- Waveform data (for visual display)
- Vectorscope points (L/R pairs)
- Spectrum data (31-band, stereo/mid/side)
"""

import numpy as np
import librosa
from scipy.signal import butter, sosfilt, welch as _welch


def generate_all_viz_data(path_a: str, path_b: str, sr: int | None = None, deep_scan: bool = False) -> dict:
    """Generate all visualization data from the original files.

    sr=None (default): load file A at its native sample rate; resample file B
    to match A's rate so both files share the same Nyquist and the band
    comparisons are apples-to-apples. Previously hardcoded to 44100, which
    stripped 48/96 kHz files of HF content above 22 kHz and caused phantom
    high-end EQ differences vs profiles built from the native-rate files.
    """

    # Load stereo — A at native rate, B resampled to A's rate for fair comparison
    y_a, sr = librosa.load(path_a, sr=sr, mono=False)
    y_b, _ = librosa.load(path_b, sr=sr, mono=False)

    if y_a.ndim == 1:
        y_a = np.stack([y_a, y_a])
    if y_b.ndim == 1:
        y_b = np.stack([y_b, y_b])

    min_len = min(y_a.shape[1], y_b.shape[1])
    y_a = y_a[:, :min_len]
    y_b = y_b[:, :min_len]

    # Quick RMS level match for fair visualization comparison
    rms_a = np.sqrt(np.mean(y_a ** 2))
    rms_b = np.sqrt(np.mean(y_b ** 2))
    if rms_b > 1e-10:
        y_b = y_b * (rms_a / rms_b)

    mono_a = librosa.to_mono(y_a)
    mono_b = librosa.to_mono(y_b)

    duration_sec = min_len / sr

    result = {
        "duration_sec": round(duration_sec, 1),
    }

    # Loudness over time
    result["lufs_over_time_a"] = compute_lufs_timeline(mono_a, sr)
    result["lufs_over_time_b"] = compute_lufs_timeline(mono_b, sr)

    # Phase correlation over time
    result["phase_over_time_a"] = compute_phase_timeline(y_a, sr)
    result["phase_over_time_b"] = compute_phase_timeline(y_b, sr)

    # Per-band static phase correlation (catches sub-band issues hidden in broadband)
    result["phase_bands_a"] = compute_phase_per_band(y_a, sr)
    result["phase_bands_b"] = compute_phase_per_band(y_b, sr)

    # Stereo timeline — width / correlation / balance over time.
    # Fast mode uses 1s windows, Deep Scan tightens to 0.5s for finer section detail.
    timeline_win = 0.5 if deep_scan else 1.0
    result["stereo_timeline_a"] = compute_stereo_timeline(y_a, sr, window_sec=timeline_win)
    result["stereo_timeline_b"] = compute_stereo_timeline(y_b, sr, window_sec=timeline_win)

    # Waveform data (downsampled for display)
    result["waveform_a"] = compute_waveform(mono_a, 200)
    result["waveform_b"] = compute_waveform(mono_b, 200)

    # Vectorscope points (reduced for smaller JSON)
    result["vectorscope_a"] = compute_vectorscope(y_a, 800)
    result["vectorscope_b"] = compute_vectorscope(y_b, 800)

    # 31-band spectrum (stereo, mid, side)
    spec = compute_spectrum_data(y_a, y_b, sr)
    result.update(spec)

    # Mono compatibility
    result["mono_compat"] = compute_mono_compat(y_a, y_b, sr)

    return result


def compute_lufs_timeline(y: np.ndarray, sr: int, window_sec: float = 3.0) -> list:
    """
    True short-term LUFS over time per ITU-R BS.1770-4 using pyloudnorm.
    3-second windows, 0.5-second hop (standard short-term LUFS definition).

    Falls back to K-weighted-approximate RMS if pyloudnorm fails on a chunk.
    """
    try:
        import pyloudnorm as pyln
    except Exception:
        pyln = None

    window = int(sr * window_sec)
    hop = int(sr * 0.5)
    lufs = []

    # pyloudnorm wants (samples, channels)
    if y.ndim == 1:
        data = y.reshape(-1, 1)
    else:
        data = y.T if y.shape[0] <= 2 else y.reshape(-1, 1)

    meter = pyln.Meter(sr, block_size=window_sec) if pyln is not None else None

    # `range(... len - window, hop)` drops the final valid window — for
    # a 30 s clip @ 44.1 kHz that's 54 windows produced when 55 fit.
    # `+ 1` lets the last window-aligned start index through.
    for i in range(0, len(data) - window + 1, hop):
        chunk = data[i:i + window]
        value = -70.0
        if meter is not None:
            try:
                v = meter.integrated_loudness(chunk)
                if not (np.isnan(v) or np.isinf(v)):
                    value = float(v)
            except Exception:
                pass
        if value == -70.0:
            # 5.3.1 honesty fix: pre-5.3 the fallback was
            # `20*log10(rms) - 0.691` which mimics the BS.1770 calibration
            # offset on a non-K-weighted RMS. That number isn't LUFS;
            # surfacing it as if it were misled callers. Now we just
            # leave the cell at -70 (the BS.1770 absolute floor) when
            # pyloudnorm couldn't integrate that window.
            pass
        lufs.append(round(value, 1))

    return lufs


def compute_stereo_timeline(y_stereo: np.ndarray, sr: int, window_sec: float = 1.0) -> dict:
    """
    Section-by-section stereo image. For each 1s window, returns:
      - width:       side-energy / (mid+side) ratio (0 = mono, 1 = fully wide)
      - correlation: L/R correlation
      - balance:     L vs R RMS balance (-1 left, +1 right)

    Surfaces section-level stereo changes (e.g. drop gets wider, bridge gets narrower).
    """
    left = y_stereo[0]
    right = y_stereo[1]
    window = int(sr * window_sec)
    if window < 2 or len(left) < window:
        return {"width": [], "correlation": [], "balance": []}
    hop = max(1, window // 2)
    widths, corrs, balances = [], [], []
    for i in range(0, len(left) - window + 1, hop):
        lc = left[i:i+window]
        rc = right[i:i+window]
        mid = lc + rc
        side = lc - rc
        me = float(np.mean(mid ** 2))
        se = float(np.mean(side ** 2))
        total = me + se
        widths.append(round(se / total, 3) if total > 1e-12 else 0.0)

        denom = float(np.sqrt(np.sum(lc ** 2) * np.sum(rc ** 2)))
        if denom > 1e-12:
            corrs.append(round(float(np.sum(lc * rc) / denom), 3))
        else:
            corrs.append(1.0)

        l_rms = float(np.sqrt(np.mean(lc ** 2)))
        r_rms = float(np.sqrt(np.mean(rc ** 2)))
        if l_rms + r_rms > 1e-10:
            balances.append(round((r_rms - l_rms) / (l_rms + r_rms), 3))
        else:
            balances.append(0.0)
    return {"width": widths, "correlation": corrs, "balance": balances}


def compute_phase_per_band(y_stereo: np.ndarray, sr: int) -> list:
    """
    Per-band L/R correlation — catches broadband correlation > 0.9 hiding
    sub-band cancellation (wide bass = -0.3 correlation, air = +0.95).

    Bands match mono-compat bands so the two panels tell a consistent story.
    """
    from scipy.signal import butter, sosfilt
    bands = [
        {"name": "Sub",     "low": 20,   "high": 80},
        {"name": "Bass",    "low": 80,   "high": 250},
        {"name": "Low Mid", "low": 250,  "high": 800},
        {"name": "Mid",     "low": 800,  "high": 3000},
        {"name": "Upper",   "low": 3000, "high": 6000},
        {"name": "Air",     "low": 6000, "high": 16000},
    ]
    left = y_stereo[0]
    right = y_stereo[1]
    nyq = sr / 2
    out = []
    for b in bands:
        low_n = max(b["low"] / nyq, 0.001)
        high_n = min(b["high"] / nyq, 0.999)
        if low_n >= high_n:
            out.append({"name": b["name"], "correlation": 1.0, "freq_range": f"{b['low']}-{b['high']} Hz"})
            continue
        sos = butter(4, [low_n, high_n], btype='band', output='sos')
        lf = sosfilt(sos, left)
        rf = sosfilt(sos, right)
        denom = float(np.sqrt(np.sum(lf ** 2) * np.sum(rf ** 2)))
        corr = float(np.sum(lf * rf) / denom) if denom > 1e-12 else 1.0
        out.append({
            "name": b["name"],
            "freq_range": f"{b['low']}-{b['high'] if b['high'] < 1000 else str(b['high']//1000) + 'k'} Hz",
            "correlation": round(corr, 3),
        })
    return out


def compute_phase_timeline(y_stereo: np.ndarray, sr: int, window_sec: float = 0.5) -> list:
    """Compute L/R phase correlation over time."""
    left = y_stereo[0]
    right = y_stereo[1]
    window = int(sr * window_sec)
    hop = window // 2
    corr = []

    for i in range(0, len(left) - window, hop):
        l_chunk = left[i:i + window]
        r_chunk = right[i:i + window]

        l_energy = np.sum(l_chunk ** 2)
        r_energy = np.sum(r_chunk ** 2)
        cross = np.sum(l_chunk * r_chunk)

        denom = np.sqrt(l_energy * r_energy)
        if denom < 1e-10:
            corr.append(1.0)
        else:
            corr.append(round(float(cross / denom), 3))

    return corr


def compute_waveform(y: np.ndarray, bars: int) -> list:
    """
    Downsample audio to N RMS-per-bar values for waveform display.

    Uses RMS (not mean-abs) — more perceptually accurate: drops in RMS envelope
    track the actual loudness envelope, whereas mean-abs over-emphasises
    transients and under-represents sustained content.
    """
    block_size = max(1, len(y) // bars)
    waveform = []
    for i in range(bars):
        start = i * block_size
        end = min(start + block_size, len(y))
        chunk = y[start:end]
        if len(chunk) == 0:
            waveform.append(0.0)
        else:
            waveform.append(float(np.sqrt(np.mean(chunk.astype(np.float64) ** 2))))

    max_val = max(waveform) if waveform else 1.0
    if max_val > 0:
        waveform = [round(v / max_val, 3) for v in waveform]
    return waveform


def compute_vectorscope(y_stereo: np.ndarray, num_points: int) -> list:
    """Sample L/R pairs for vectorscope display."""
    left = y_stereo[0]
    right = y_stereo[1]
    step = max(1, len(left) // num_points)

    points = []
    for i in range(0, len(left), step):
        if len(points) >= num_points:
            break
        points.append({
            "l": round(float(left[i]), 4),
            "r": round(float(right[i]), 4),
        })

    return points


def compute_spectrum_data(y_a: np.ndarray, y_b: np.ndarray, sr: int) -> dict:
    """Compute 31-band spectrum for stereo, mid, and side channels."""

    # ISO 31-band center frequencies
    freqs = [
        20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
        200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
        2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
    ]

    mono_a = librosa.to_mono(y_a)
    mono_b = librosa.to_mono(y_b)

    # Mid/Side — unscaled (L+R / L-R), consistent with compute_stereo_width,
    # compute_stereo_timeline, and build_profile._stereo_width throughout the
    # codebase. Absolute level cancels in band_spectrum's mean-centring step.
    mid_a = y_a[0] + y_a[1]
    side_a = y_a[0] - y_a[1]
    mid_b = y_b[0] + y_b[1]
    side_b = y_b[0] - y_b[1]

    return {
        "spectrum_a": band_spectrum(mono_a, sr, freqs),
        "spectrum_b": band_spectrum(mono_b, sr, freqs),
        "mid_spectrum_a": band_spectrum(mid_a, sr, freqs),
        "mid_spectrum_b": band_spectrum(mid_b, sr, freqs),
        "side_spectrum_a": band_spectrum(side_a, sr, freqs),
        "side_spectrum_b": band_spectrum(side_b, sr, freqs),
    }


def band_spectrum(y: np.ndarray, sr: int, center_freqs: list) -> list:
    """Compute mean-centred level in dB for each 1/3-octave band via Welch PSD.

    7.6.2 fix: replaced Butterworth IIR-RMS with Welch PSD (nperseg=min(8192,N),
    noverlap=N//2, average='median') to match engineer_profile.compute_spectrum()
    and build_profile._third_octave_curve() exactly. The previous IIR approach
    produced systematically different spectral shapes vs the Welch-computed
    profile target curves, so the EQ tab and engineer tips showed contradictory
    tonal curves for the same file. Both now use the same PSD computation.

    Out-of-Nyquist bands return -90 dB (same floor as engineer_profile).
    Mean-centring uses nanmean so NaN/out-of-Nyquist bands don't bias the
    centre of mass, matching build_profile.py:248 behaviour.
    """
    nyq = sr / 2

    # Welch PSD — identical parameters to engineer_profile.compute_spectrum
    n_fft = min(8192, len(y))
    if n_fft < 64:
        return [-90.0] * len(center_freqs)
    f, psd = _welch(y, fs=sr, nperseg=n_fft, noverlap=n_fft // 2, average="median")
    psd = np.maximum(psd, 1e-20)

    raw = []
    for freq in center_freqs:
        low = freq / (2 ** (1 / 6))
        high = freq * (2 ** (1 / 6))
        if high > nyq:
            raw.append(float('nan'))  # out-of-Nyquist — excluded from mean
            continue
        mask = (f >= low) & (f <= high)
        if not np.any(mask):
            raw.append(float('nan'))
            continue
        band_power = float(np.mean(psd[mask]))
        raw.append(round(10.0 * np.log10(max(band_power, 1e-20)), 1))

    # Mean-centre over finite (in-Nyquist) bands only — matches engineer_profile.
    arr = np.array(raw, dtype=np.float64)
    finite_mean = float(np.nanmean(arr)) if np.any(np.isfinite(arr)) else 0.0
    centred = arr - finite_mean
    return [round(float(v), 1) if np.isfinite(v) else -90.0 for v in centred]


# Bands ordered by perceptual impact when mono-collapsed.
# Low end cancellation is catastrophic (bass/kick disappear on phone speakers);
# Air-band cancellation is subtle ("vertigo" / comb-filter shimmer).
MONO_BANDS = [
    {"name": "Sub",      "low": 20,    "high": 80,    "impact": 5.0, "note": "Bass energy on small speakers"},
    {"name": "Bass",     "low": 80,    "high": 250,   "impact": 4.0, "note": "Kick/bass body on phone speakers"},
    {"name": "Low Mid",  "low": 250,   "high": 800,   "impact": 3.0, "note": "Warmth & vocal body"},
    {"name": "Mid",      "low": 800,   "high": 3000,  "impact": 2.5, "note": "Vocal presence"},
    {"name": "Upper",    "low": 3000,  "high": 6000,  "impact": 1.5, "note": "Presence & intelligibility"},
    {"name": "Air",      "low": 6000,  "high": 16000, "impact": 0.8, "note": "Shimmer / 'vertigo' on collapse"},
]


def _band_stats(left: np.ndarray, right: np.ndarray, sr: int, low: float, high: float) -> tuple:
    """Return (correlation, mono_loss_pct) for one band."""
    from scipy.signal import butter, sosfilt
    nyq = sr / 2
    low_n = max(low / nyq, 0.001)
    high_n = min(high / nyq, 0.999)
    if low_n >= high_n:
        return 1.0, 0.0
    sos = butter(4, [low_n, high_n], btype='band', output='sos')
    lf = sosfilt(sos, left)
    rf = sosfilt(sos, right)

    denom = np.sqrt(np.sum(lf**2) * np.sum(rf**2))
    if denom < 1e-12:
        return 1.0, 0.0
    corr = float(np.sum(lf * rf) / denom)

    stereo_rms = np.sqrt(np.mean(lf**2 + rf**2) / 2)
    mono = (lf + rf) / 2
    mono_rms = np.sqrt(np.mean(mono**2))
    if stereo_rms < 1e-10:
        return corr, 0.0
    loss = max(0.0, (1.0 - mono_rms / stereo_rms)) * 100.0
    return corr, loss


def _per_band(y_stereo: np.ndarray, sr: int) -> list:
    left = y_stereo[0]
    right = y_stereo[1]
    bands = []
    for b in MONO_BANDS:
        corr, loss = _band_stats(left, right, sr, b["low"], b["high"])
        # Risk must separate phase CANCELLATION from plain DECORRELATION.
        #
        # Phase cancellation (corr < 0):
        #   signal content literally disappears when L+R are summed.
        #   This is the real "my kick vanished on a phone speaker" failure
        #   mode.  Risk scales with both the magnitude of the loss and
        #   how negative the correlation is.
        #
        # Decorrelation (corr >= 0):
        #   naturally wide stereo content — cymbals, reverb tails, room
        #   mics, chorus.  When summed to mono the mix drops ~3 dB (=
        #   ~30% apparent "loss") but nothing cancels and nothing goes
        #   missing.  The listener hears it as slightly drier / less
        #   spacious, not damaged.  This band was getting flagged as
        #   "High Risk" under the old formula — the beta feedback was
        #   right.
        #
        # New rule: phase_penalty = max(0, -corr - DEADBAND).  When
        # correlation is non-negative the penalty is zero; cancellation-
        # driven loss only shows up when L and R are actually opposing.
        # The 0.05 deadband absorbs the residual negative correlation
        # noise that decorrelated stereo (independent L/R noise, wide
        # synthesised pads) statistically produces — which would
        # otherwise score tiny non-zero risk on perfectly mono-safe
        # material.  Anti-phase content (corr ≤ -0.5) still scores
        # strongly.  Test fixtures: independent pink-noise L/R drops
        # from total risk 1.7 → 0.0; anti-phase 60 Hz bass stays at
        # full ~1500+ risk in the sub band.
        DEADBAND = 0.05
        phase_penalty = max(0.0, -corr - DEADBAND)  # 0..(1-DEADBAND)
        risk = phase_penalty * loss * b["impact"]
        bands.append({
            "name": b["name"],
            "freq_range": f"{b['low']}-{b['high'] if b['high'] < 1000 else str(b['high']//1000) + 'k'} Hz",
            "impact": b["impact"],
            "note": b["note"],
            "correlation": round(corr, 3),
            "loss_pct": round(loss, 1),
            "risk": round(risk, 1),
        })
    return bands


def compute_mono_compat(y_a: np.ndarray, y_b: np.ndarray, sr: int) -> dict:
    """Compute mono compatibility for both files — broadband + per-band."""
    def calc(y_stereo):
        left = y_stereo[0]
        right = y_stereo[1]
        # 5.3.1 honesty fix: pre-5.3 we did `corr = num / max(denom, 1e-10)`,
        # which when both channels are tiny but coherent (e.g. quiet
        # tonal noise floor) would divide by 1e-10 and produce huge
        # correlation values like r=2374.5. The right thing is to
        # treat sub-floor signals as undefined-correlation = 0
        # (mono-safe by convention; phase isn't meaningful below the
        # measurement floor anyway).
        denom = float(np.sqrt(np.sum(left**2) * np.sum(right**2)))
        if denom < 1e-9:  # below measurement floor — undefined
            corr = 0.0
        else:
            corr = float(np.clip(np.sum(left * right) / denom, -1.0, 1.0))
        stereo_rms = float(np.sqrt(np.mean(left**2 + right**2) / 2))
        mono = (left + right) / 2
        mono_rms = float(np.sqrt(np.mean(mono**2)))
        if stereo_rms < 1e-9:
            loss = 0.0
        else:
            loss = max(0.0, (1.0 - mono_rms / stereo_rms)) * 100.0
        return round(corr, 3), round(loss, 1)

    corr_a, loss_a = calc(y_a)
    corr_b, loss_b = calc(y_b)

    bands_a = _per_band(y_a, sr)
    bands_b = _per_band(y_b, sr)

    # Weighted overall risk (low bands weighted higher)
    risk_a = round(sum(b["risk"] for b in bands_a), 1)
    risk_b = round(sum(b["risk"] for b in bands_b), 1)

    # Find the worst band for B — only bands with actual phase-cancellation
    # risk qualify.  A decorrelated band (corr >= 0) has loss_pct > 0 but
    # risk == 0, so it won't be flagged.
    worst_b = max(bands_b, key=lambda b: b["risk"])

    if worst_b["risk"] > 20 and worst_b["name"] in ("Sub", "Bass"):
        insight = (f"{worst_b['name']} ({worst_b['freq_range']}) phase-cancels in mono "
                   f"(correlation {worst_b['correlation']:+.2f}) — bass may vanish on phone "
                   f"speakers. Check mono compatibility of low-end stereo processing.")
    elif worst_b["risk"] > 20:
        insight = (f"{worst_b['name']} band shows phase cancellation "
                   f"(correlation {worst_b['correlation']:+.2f}) — "
                   f"{worst_b['note'].lower()}.")
    elif risk_b > risk_a + 15:
        insight = (f"File B shows more mono cancellation overall (weighted risk "
                   f"{risk_b} vs {risk_a}).  Stereo widening is eating energy when summed.")
    elif risk_b < risk_a - 15:
        insight = (f"File B is more mono-compatible (risk {risk_b} vs {risk_a}).  "
                   f"Tighter low-end translates better.")
    elif risk_b < 10:
        insight = ("Mono-compatible — the L/R channels sum cleanly to mono without "
                   "phase cancellation in any perceptually important band.")
    else:
        insight = f"Similar mono compatibility — weighted risk {risk_a} vs {risk_b}."

    return {
        "correlation_a": corr_a,
        "correlation_b": corr_b,
        "mono_loss_a_pct": loss_a,
        "mono_loss_b_pct": loss_b,
        "bands_a": bands_a,
        "bands_b": bands_b,
        "risk_a": risk_a,
        "risk_b": risk_b,
        "insight": insight,
    }
