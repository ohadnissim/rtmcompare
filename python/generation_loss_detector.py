"""
Generation-loss detector — finds signs that a "master" has already been
through a lossy codec round-trip (AAC / MP3 → decode → re-render).
Important for archival reissues and for catching a subtle engineer
mistake (delivering a codec-decoded WAV as the master).

Three heuristics:

  1. Brick-wall cutoff — lossy codecs usually drop everything above
     16–20 kHz. A master that falls off a cliff near those frequencies
     with no natural roll-off is suspicious.
  2. AAC frame-stride artefacts — AAC LC operates with a 1024-sample
     hop between long-window frames (the MDCT length itself is 2048
     with 50% overlap). Residual energy patterns that align to that
     1024-sample stride survive decode and reveal prior AAC encoding.
     Checked via autocorrelation of the high-frequency envelope at
     the 1024-sample frame stride. (Pre-5.3.1 docstring called this
     the "MDCT period" — that was technically wrong; the period in
     question is the frame stride. The math is unchanged.)
  3. Pre-echo / transient smear — AAC's psychoacoustic model introduces
     a pre-echo before loud transients. We look for this by comparing
     pre-transient RMS against a clean reference window.

Status: SCAFFOLD. See RTM Engineers/FEATURES/GENERATION-LOSS-DETECTOR.md
for the full DSP spec + reference literature.
"""
from __future__ import annotations

import json
import math
import os
import sys
import threading
from dataclasses import dataclass, asdict

try:
    import numpy as np
    import soundfile as sf
except ImportError:
    np = None  # type: ignore
    sf = None  # type: ignore

# ── ArtifactNet ONNX session singleton ────────────────────────────────────────
# Creating an ort.InferenceSession is expensive (~8 s for large models).
# We cache the session and the model path it was loaded from so that
# repeated calls within a daemon session pay only the first-load cost.
_artifactnet_session: "object | None" = None
_artifactnet_model_path: str | None = None
_artifactnet_lock = threading.Lock()

# ── ArtifactNet mel filterbank — computed once at import time ────────────────
# Parameters are fixed constants (n_fft=1024, n_mels=128, target_sr=16000).
# Building the filterbank inside check_artifactnet() pays O(n_mels²) cost on
# every inference call; hoisting it here makes that a one-time import cost.
_MEL_FB: "np.ndarray | None" = None  # shape (128, 513) — lazy-initialised below


def _build_mel_filterbank() -> "np.ndarray":
    """Return the (n_mels, n_fft//2+1) triangular mel filterbank for ArtifactNet."""
    assert np is not None
    n_fft, n_mels, target_sr = 1024, 128, 16000
    f_min, f_max = 20.0, target_sr / 2.0
    mel_min = 2595 * np.log10(1 + f_min / 700)
    mel_max = 2595 * np.log10(1 + f_max / 700)
    mel_points = np.linspace(mel_min, mel_max, n_mels + 2)
    freq_points = 700 * (10 ** (mel_points / 2595) - 1)
    bin_points = np.floor((n_fft + 1) * freq_points / target_sr).astype(int)
    n_bins = n_fft // 2 + 1
    fb = np.zeros((n_mels, n_bins))
    for m in range(1, n_mels + 1):
        for k in range(bin_points[m - 1], bin_points[m]):
            if k < n_bins:
                fb[m - 1, k] = (k - bin_points[m - 1]) / max(bin_points[m] - bin_points[m - 1], 1)
        for k in range(bin_points[m], bin_points[m + 1]):
            if k < n_bins:
                fb[m - 1, k] = (bin_points[m + 1] - k) / max(bin_points[m + 1] - bin_points[m], 1)
    return fb


@dataclass
class GenerationLossCheck:
    name: str
    score: float           # 0 = no evidence, 1 = strong evidence
    detail: str


@dataclass
class GenerationLossResult:
    probability: float     # 0..1 — aggregate across checks
    verdict: str           # 'likely_lossless' | 'suspect' | 'likely_prior_lossy'
    checks: list[GenerationLossCheck]
    summary: str


def _cutoff_frequency(mono: "np.ndarray", sr: int) -> float:
    """Estimate the -40 dB cutoff frequency. Brick-wall lossy files
    cluster at ~16 / ~19 / ~22 kHz depending on bitrate."""
    assert np is not None
    n = min(len(mono), sr * 5)
    if n < 64:  # PY-1: too short / silent file — skip rather than crash on np.hanning(0)
        return float(sr / 2)
    x = mono[:n] - float(np.mean(mono[:n]))
    spec = np.abs(np.fft.rfft(x * np.hanning(n)))
    if float(np.max(spec)) <= 0: return float(sr / 2)
    spec_db = 20 * np.log10(spec / float(np.max(spec)) + 1e-12)
    freqs = np.fft.rfftfreq(n, d=1.0 / sr)
    # Find the highest frequency where energy is still above -40 dB.
    mask = spec_db > -40
    if not np.any(mask): return 0.0
    return float(np.max(freqs[mask]))


def check_brickwall(mono: "np.ndarray", sr: int) -> GenerationLossCheck:
    cutoff = _cutoff_frequency(mono, sr)
    # Clusters: 15.75–16.2 kHz (AAC 128k / MP3 128k), 19–19.6 kHz (AAC
    # 192k / MP3 320k), 21.5–22 kHz (AAC 320k).
    clusters = [
        (15.5e3, 16.5e3, 'AAC / MP3 at ~128 kbps'),
        (18.8e3, 19.8e3, 'AAC / MP3 at ~192–256 kbps'),
        (21.0e3, 22.2e3, 'AAC at ~320 kbps'),
    ]
    for lo, hi, label in clusters:
        if lo <= cutoff <= hi:
            return GenerationLossCheck(
                name="brickwall_cutoff",
                score=0.75,
                detail=f"Energy cliff at {cutoff/1000:.1f} kHz — matches {label}. Suspect prior lossy encode.",
            )
    if cutoff < sr / 2 * 0.93:
        return GenerationLossCheck(
            name="brickwall_cutoff",
            score=0.35,
            detail=f"Cutoff at {cutoff/1000:.1f} kHz — lower than expected for LPCM, mild suspicion.",
        )
    return GenerationLossCheck(
        name="brickwall_cutoff",
        score=0.0,
        detail=f"Cutoff at {cutoff/1000:.1f} kHz — consistent with LPCM source.",
    )


def check_mdct_periodicity(mono: "np.ndarray", sr: int) -> GenerationLossCheck:
    """Autocorrelation of the high-pass envelope at the AAC LC
    1024-sample frame stride. Lossy files show a subtle but persistent
    peak; lossless files decorrelate.

    5.3.1 honesty fix: the function name and docstring used to call
    this an "MDCT period" autocorr, which conflated the AAC LC long-
    window MDCT length (2048) with the inter-frame stride (1024). The
    math probes 1024 samples, which is the AAC LC frame stride, not
    the MDCT length. Detection still works (HF residue does have
    1024-sample structure post-IMDCT); we just describe it correctly.
    """
    if np is None:
        return GenerationLossCheck("aac_frame_stride_periodicity", 0.0, "numpy unavailable")
    # HPF 8 kHz to isolate where codec artefacts live.
    fft = np.fft.rfft(mono[: sr * 3] if len(mono) >= sr * 3 else mono)
    freqs = np.fft.rfftfreq(len(mono[: sr * 3] if len(mono) >= sr * 3 else mono), d=1.0 / sr)
    fft[freqs < 8000] = 0
    hp = np.fft.irfft(fft)
    env = np.abs(hp)
    env = env - float(np.mean(env))
    n = min(len(env), 8192)
    if n < 4096:
        return GenerationLossCheck("aac_frame_stride_periodicity", 0.0,
                                   "Too short for codec-frame check.")
    period = 1024  # AAC LC frame stride (samples)
    a = env[: n - period]
    b = env[period: n]
    denom = float(np.sqrt(np.dot(a, a) * np.dot(b, b))) + 1e-12
    corr = float(np.dot(a, b)) / denom
    if corr > 0.25:
        return GenerationLossCheck("aac_frame_stride_periodicity", 0.6,
                                   f"High-band envelope correlates at the AAC LC 1024-sample frame stride ({corr:.2f}) — lossy codec signature.")
    if corr > 0.12:
        return GenerationLossCheck("aac_frame_stride_periodicity", 0.3,
                                   f"Weak periodicity at the AAC frame stride ({corr:.2f}) — inconclusive.")
    return GenerationLossCheck("aac_frame_stride_periodicity", 0.0,
                               f"No AAC-frame-stride correlation ({corr:.2f}).")


def check_noise_seeding(mono: "np.ndarray", sr: int) -> GenerationLossCheck:
    """Counter-signal for the noise-floor seeding bypass attack.

    Attack: add shaped white noise at −90 dBFS above 17.5 kHz via ffmpeg to
    fill the spectral hole that `check_brickwall` detects. The AAC frame-stride
    autocorrelation (`check_mdct_periodicity`) survives this attack because it
    runs on sub-16 kHz content — but a secondary tell remains: the injected noise
    above 17.5 kHz has zero musical correlation with the signal below it, whereas
    real high-frequency content (cymbals, room) correlates weakly but non-randomly
    with the musical content.

    Method: compute the cross-correlation between the >17.5 kHz band envelope and
    the 1–8 kHz band envelope over 100 ms windows. A Pearson |r| > 0.25 across
    the majority of windows suggests real HF content; near-zero correlation across
    all windows suggests injected noise.

    Score 0.4 (moderate suspicion) when HF band exists but shows near-zero
    correlation with musical content. Only fires when the sample rate supports
    17.5 kHz+ content (sr ≥ 40000).
    """
    if np is None:
        return GenerationLossCheck("noise_seeding", 0.0, "numpy unavailable")
    if sr < 40000:
        return GenerationLossCheck("noise_seeding", 0.0,
                                   f"Sample rate {sr} Hz too low for HF correlation check.")

    def _band_envelope(sig: "np.ndarray", low: float, high: float) -> "np.ndarray":
        fft = np.fft.rfft(sig)
        freqs = np.fft.rfftfreq(len(sig), d=1.0 / sr)
        mask = (freqs >= low) & (freqs <= high)
        fft_band = fft.copy()
        fft_band[~mask] = 0
        bp = np.fft.irfft(fft_band, n=len(sig))
        return np.abs(bp)

    n = min(len(mono), sr * 10)   # analyse first 10 s
    chunk = mono[:n]
    env_hf   = _band_envelope(chunk, 17500, sr / 2 * 0.99)
    env_mid  = _band_envelope(chunk, 1000,  8000)

    if float(np.max(env_hf)) < 1e-8:
        return GenerationLossCheck("noise_seeding", 0.0,
                                   "No energy above 17.5 kHz — cannot assess HF correlation.")

    win = int(0.1 * sr)  # 100 ms windows
    corrs = []
    for start in range(0, n - win, win):
        hf_win  = env_hf[start:start + win]
        mid_win = env_mid[start:start + win]
        if np.std(hf_win) < 1e-9 or np.std(mid_win) < 1e-9:
            continue
        r = float(np.corrcoef(hf_win, mid_win)[0, 1])
        if np.isfinite(r):
            corrs.append(abs(r))

    if not corrs:
        return GenerationLossCheck("noise_seeding", 0.0, "Insufficient signal for HF correlation.")

    mean_corr = float(np.mean(corrs))
    if mean_corr < 0.08:
        return GenerationLossCheck(
            "noise_seeding", 0.4,
            f"Near-zero HF/mid correlation ({mean_corr:.3f}) — HF content may be seeded noise "
            "masking a codec cutoff rather than genuine high-frequency audio.",
        )
    if mean_corr < 0.18:
        return GenerationLossCheck(
            "noise_seeding", 0.15,
            f"Low HF/mid correlation ({mean_corr:.3f}) — inconclusive; could be sparse HF content.",
        )
    return GenerationLossCheck(
        "noise_seeding", 0.0,
        f"HF/mid correlation ({mean_corr:.3f}) consistent with genuine high-frequency content.",
    )


def check_vibrato_periodicity(mono: "np.ndarray", sr: int) -> GenerationLossCheck:
    """Vibrato periodicity counter-signal.

    Real vibrato (from singers, violinists, guitarists) has clean sub-10Hz
    periodicity. Lossy codecs slightly quantize pitch trajectories, leaving
    a characteristic irregularity: the pitch deviation autocorrelation at
    typical vibrato periods (5–8 Hz = 125–200 ms) is weaker in codec-decoded
    audio than in lossless originals.

    Method:
    1. Extract pitch via YIN algorithm (no librosa dep — pure numpy).
    2. Compute pitch deviation from 200ms median (removes absolute pitch).
    3. Autocorrelate the deviation at lags 100–250ms (vibrato period range).
    4. High peak = clean periodicity = lossless.
       Low/noisy autocorr = codec distortion of pitch trajectory.

    Only fires on signals with detected periodic content (voiced sections).
    Score 0.25 (mild suspicion) when max autocorr < 0.35 on a signal that
    DOES have pitched content.
    """
    if np is None:
        return GenerationLossCheck("vibrato_periodicity", 0.0, "numpy unavailable")
    try:
        # Analyse first 15 s
        n = min(len(mono), int(sr * 15))
        chunk = mono[:n].astype(np.float64)

        # YIN pitch estimation (simplified — frame-based autocorrelation)
        frame_size = int(sr * 0.04)   # 40 ms frames
        hop = int(sr * 0.01)          # 10 ms hop
        min_period = int(sr / 800)    # 800 Hz upper bound
        max_period = int(sr / 60)     # 60 Hz lower bound

        if max_period <= min_period or frame_size < max_period * 2:
            return GenerationLossCheck("vibrato_periodicity", 0.0,
                                       "Audio too short or sample rate too low for vibrato check.")

        pitches = []
        # Pre-compute FFT size for autocorrelation (reused every frame)
        _fft_size = 1 << (frame_size.bit_length() + 1)  # next power-of-2 >= 2*frame_size
        _taus = np.arange(max_period)

        for start in range(0, n - frame_size, hop):
            frame = chunk[start:start + frame_size]

            # ── Vectorized YIN difference function (step 2) ──────────────────
            # d[tau] = ||frame[:N-tau] - frame[tau:]||^2
            #        = E_fwd[tau] + E_bwd[tau] - 2 * r[tau]
            # where r[tau] is the unbiased autocorrelation at lag tau,
            # computed in O(N log N) via FFT instead of O(N·max_period).
            sqr = frame ** 2
            cum_sqr = np.empty(frame_size + 1)
            cum_sqr[0] = 0.0
            np.cumsum(sqr, out=cum_sqr[1:])

            # Autocorrelation at lags 0..max_period-1 via FFT
            F = np.fft.rfft(frame, n=_fft_size)
            r_full = np.fft.irfft(F * np.conj(F))[:max_period].real

            e_fwd = cum_sqr[frame_size - _taus]   # sum x[0..N-tau-1]^2
            e_bwd = cum_sqr[frame_size] - cum_sqr[_taus]  # sum x[tau..N-1]^2
            d = e_fwd + e_bwd - 2.0 * r_full
            d = np.maximum(d, 0.0)  # numerical noise can produce tiny negatives
            d[0] = 0.0  # tau=0: d is always 0

            # ── Vectorized CMND (step 3) ──────────────────────────────────────
            # cmnd[0] = 1; cmnd[tau] = d[tau] * tau / cumsum(d)[tau]
            d_cumsum = np.cumsum(d)
            cmnd = np.ones(max_period)
            valid = d_cumsum[1:] > 1e-12
            cmnd[1:][valid] = d[1:][valid] * np.arange(1, max_period)[valid] / d_cumsum[1:][valid]

            # ── Find first minimum below threshold 0.1 ────────────────────────
            window_cmnd = cmnd[min_period:max_period - 1]
            is_min = (
                (window_cmnd < 0.1)
                & (window_cmnd < cmnd[min_period - 1:max_period - 2])
                & (window_cmnd < cmnd[min_period + 1:max_period])
            )
            indices = np.nonzero(is_min)[0]
            if indices.size > 0:
                tau = min_period + int(indices[0])
                pitches.append(float(sr) / tau)
            else:
                pitches.append(0.0)  # unvoiced

        voiced = [p for p in pitches if p > 0]
        if len(voiced) < len(pitches) * 0.3:
            # Less than 30% voiced frames — not a pitched instrument, skip
            return GenerationLossCheck("vibrato_periodicity", 0.0,
                                       f"Insufficient pitched content ({len(voiced)}/{len(pitches)} voiced frames).")

        # Pitch deviation from local median (200 ms = 20 hop frames)
        pitch_arr = np.array(pitches, dtype=np.float64)
        window = 20
        deviation = np.zeros_like(pitch_arr)
        for i in range(len(pitch_arr)):
            lo = max(0, i - window // 2)
            hi = min(len(pitch_arr), i + window // 2)
            local_median = float(np.median(pitch_arr[lo:hi]))
            if local_median > 0:
                deviation[i] = pitch_arr[i] - local_median

        # Only voiced deviation
        voiced_dev = deviation[pitch_arr > 0]
        if len(voiced_dev) < 20:
            return GenerationLossCheck("vibrato_periodicity", 0.0, "Too few voiced frames for vibrato check.")

        # Autocorrelation of deviation at lags 100–250 ms
        lag_min = int(0.10 / 0.01)  # 100 ms / 10 ms hop
        lag_max = int(0.25 / 0.01)  # 250 ms / 10 ms hop
        lag_max = min(lag_max, len(voiced_dev) // 2)
        if lag_max <= lag_min:
            return GenerationLossCheck("vibrato_periodicity", 0.0, "Signal too short for vibrato lag window.")

        mean_dev = float(np.mean(voiced_dev))
        centered = voiced_dev - mean_dev
        var = float(np.dot(centered, centered))
        if var < 1e-10:
            return GenerationLossCheck("vibrato_periodicity", 0.0, "Flat pitch deviation — no vibrato detected.")

        autocorrs = []
        for lag in range(lag_min, lag_max):
            a = centered[:len(centered) - lag]
            b = centered[lag:]
            autocorrs.append(float(np.dot(a, b)) / var)

        max_ac = float(max(autocorrs)) if autocorrs else 0.0

        if max_ac < 0.35:
            return GenerationLossCheck(
                "vibrato_periodicity",
                0.25,
                f"Vibrato autocorr {max_ac:.2f} below 0.35 — pitch periodicity disrupted, "
                "consistent with lossy codec quantisation of MDCT coefficients.",
            )
        return GenerationLossCheck(
            "vibrato_periodicity",
            0.0,
            f"Vibrato autocorr {max_ac:.2f} — clean pitch periodicity, consistent with lossless source.",
        )
    except Exception as e:
        return GenerationLossCheck("vibrato_periodicity", 0.0, f"Vibrato check failed: {e}")


def check_artifactnet(mono: "np.ndarray", sr: int) -> "GenerationLossCheck | None":
    """Run ArtifactNet ONNX inference if the model is available.

    Model path: ~/.rtm/models/artifactnet.onnx
    If the model file is not present, returns None (caller falls back to heuristics).

    ArtifactNet expects:
      - 16 kHz mono float32
      - mel-spectrogram input: 128 mel bins, hop=256, window=1024
      - Input tensor shape: (1, 1, 128, T) where T = ceil(n_frames)
      - Output: probability of artifact (0..1)

    We resample to 16 kHz if needed, compute the mel-spectrogram via
    numpy/scipy (no librosa dep), run ONNX inference, and return a
    GenerationLossCheck with score = artifact_probability.
    """
    if np is None:
        return None
    model_path = os.path.expanduser("~/.rtm/models/artifactnet.onnx")
    if not os.path.exists(model_path):
        return None
    try:
        import onnxruntime as ort  # type: ignore
        # Reuse the module-level singleton session; create it once under a lock.
        global _artifactnet_session, _artifactnet_model_path
        with _artifactnet_lock:
            if _artifactnet_session is None or _artifactnet_model_path != model_path:
                old = _artifactnet_session
                _artifactnet_session = None
                del old
                _artifactnet_session = ort.InferenceSession(
                    model_path, providers=["CPUExecutionProvider"]
                )
                _artifactnet_model_path = model_path
            sess = _artifactnet_session

        # Resample to 16 kHz using linear interpolation (no librosa)
        target_sr = 16000
        if sr != target_sr:
            n_out = int(len(mono) * target_sr / sr)
            indices = np.linspace(0, len(mono) - 1, n_out)
            mono_16k = np.interp(indices, np.arange(len(mono)), mono).astype(np.float32)
        else:
            mono_16k = mono.astype(np.float32)

        # Clip to first 10 s for speed
        max_samples = target_sr * 10
        chunk = mono_16k[:max_samples]

        # Mel-spectrogram via STFT (pure numpy, no librosa)
        n_fft = 1024
        hop = 256
        n_mels = 128

        # STFT frames
        frames = []
        for start in range(0, len(chunk) - n_fft, hop):
            frame = chunk[start:start + n_fft] * np.hanning(n_fft)
            frames.append(np.abs(np.fft.rfft(frame)))
        if not frames:
            return None
        S = np.stack(frames, axis=1)  # (n_fft//2+1, T)

        # Mel filterbank — use module-level cache; build once on first call.
        global _MEL_FB
        if _MEL_FB is None:
            _MEL_FB = _build_mel_filterbank()
        mel_fb = _MEL_FB

        mel_S = mel_fb @ S  # (n_mels, T)
        mel_S = np.log(mel_S + 1e-9).astype(np.float32)
        # Input tensor: (1, 1, n_mels, T)
        inp = mel_S[np.newaxis, np.newaxis, :, :]

        # Run inference
        input_name = sess.get_inputs()[0].name
        output = sess.run(None, {input_name: inp})[0]
        prob = float(1.0 / (1.0 + np.exp(-float(output.ravel()[0]))))

        if prob >= 0.6:
            return GenerationLossCheck(
                "artifactnet",
                round(prob, 3),
                f"ArtifactNet: {prob:.1%} artifact probability — strong evidence of prior lossy encoding or AI processing.",
            )
        if prob >= 0.3:
            return GenerationLossCheck(
                "artifactnet",
                round(prob * 0.7, 3),  # scale down for intermediate range
                f"ArtifactNet: {prob:.1%} artifact probability — inconclusive.",
            )
        return GenerationLossCheck(
            "artifactnet",
            0.0,
            f"ArtifactNet: {prob:.1%} artifact probability — no artifacts detected.",
        )
    except Exception as e:
        # Model present but inference failed — log and return None so heuristics run
        import sys
        sys.stderr.write(f"[generation_loss] ArtifactNet inference failed: {e}\n")
        return None


def analyse_generation_loss(path: str) -> GenerationLossResult:
    if np is None or sf is None:
        return GenerationLossResult(
            probability=0.0, verdict="likely_lossless",
            checks=[], summary="numpy / soundfile unavailable — skipped.",
        )
    try:
        data, sr = sf.read(path, dtype="float32")
    except Exception as e:
        return GenerationLossResult(0.0, "likely_lossless", [],
                                    f"Could not decode file: {e}")
    mono = data.mean(axis=1) if data.ndim > 1 else data
    # Try ArtifactNet ONNX model first (F1=0.983 when model is present).
    # Falls back to 3-heuristic approach when model not available.
    artifactnet_result = check_artifactnet(mono, sr)
    if artifactnet_result is not None:
        checks = [artifactnet_result]
    else:
        checks = [
            check_brickwall(mono, sr),
            check_mdct_periodicity(mono, sr),
            check_noise_seeding(mono, sr),
            check_vibrato_periodicity(mono, sr),
        ]
    avg = sum(c.score for c in checks) / max(len(checks), 1)
    if avg >= 0.55:
        verdict, summary = "likely_prior_lossy", "Multiple signs this file was previously lossy-encoded. Source a true LPCM master."
    elif avg >= 0.30:
        verdict, summary = "suspect", "Weak evidence of prior lossy encoding — inspect the brick-wall region and MDCT correlation."
    else:
        verdict, summary = "likely_lossless", "No evidence of prior codec encoding. File looks like clean LPCM."
    return GenerationLossResult(
        probability=round(avg, 3),
        verdict=verdict,
        checks=checks,
        summary=summary,
    )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: generation_loss_detector.py <file>"}))
        sys.exit(1)
    r = analyse_generation_loss(sys.argv[1])
    prob = r.probability if math.isfinite(r.probability) else 0.0
    print(json.dumps({
        "probability": prob, "verdict": r.verdict,
        "checks": [{"name": c.name, "score": c.score if math.isfinite(c.score) else 0.0, "note": c.note} for c in r.checks],
        "summary": r.summary,
    }))
