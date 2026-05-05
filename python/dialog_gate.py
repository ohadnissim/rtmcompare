"""
Dialog-gated LUFS — speech-only integrated loudness for broadcast /
post-production deliverables.

Why this exists
───────────────
Panel feedback (Jonas, broadcast engineer): Netflix, ATSC A/85 (CALM Act),
and EBU R128 for dialog-heavy content measure the integrated target
against *foreground speech only*, not the full programme.  A music-
heavy mix can sit at −27 LUFS integrated and still fail Netflix QC
because the dialog sits at −20 LKFS.

What we do
──────────
We don't embed a full ML voice-activity-detection model (too heavy
for a bundled Python env).  Instead we use a pragmatic two-cue gate
that works on any file with recognisable speech:

  1. Spectral-shape test — speech sits in 250-4000 Hz; we accept a
     block only when that band holds > 55 % of the block's total
     energy AND the spectral centroid lands inside 500-2500 Hz.
  2. Temporal-envelope test — speech has a distinctive 4-8 Hz
     syllabic rhythm.  We compute the envelope's modulation spectrum
     and require meaningful energy in that band.

Blocks passing BOTH cues are considered "dialog"; we integrate LUFS
over just those blocks using pyloudnorm's gating-compatible mean.

This is NOT a certified dialog gate — we emit a `confidence` field
("high" / "medium" / "low") driven by the speech-percentage we found
so the UI can down-weight results on a 100 % music track (where the
gate is extrapolating from almost nothing).

Returns None when the file contains no detectable speech (pure music),
so the UI cleanly hides the "Dialog LUFS" row rather than showing a
nonsensical number.
"""
from __future__ import annotations

import numpy as np

# pyloudnorm is already a runtime dep (batch_analyze.py imports it).
import pyloudnorm as pyln


_BLOCK_SEC = 1.0   # 1-second analysis blocks — short enough to bracket
                   # a spoken word but long enough to stabilise FFT.
_MIN_SPEECH_PCT = 2.0  # below this we call it "no dialog detected".


def _spectral_speech_score(block: np.ndarray, sr: int) -> tuple[bool, float]:
    """
    Test a 1-second mono block for speech-like spectral shape.
    Returns (is_speech_like, centroid_hz).
    """
    if len(block) < 512:
        return False, 0.0
    # Use a light window to tame spectral leakage.
    win = np.hanning(len(block))
    spec = np.abs(np.fft.rfft(block * win))
    freqs = np.fft.rfftfreq(len(block), 1 / sr)
    if spec.sum() <= 1e-9:
        return False, 0.0

    # Speech band energy — use 250-4000 Hz (covers F0 + first formant).
    speech_band = (freqs >= 250) & (freqs <= 4000)
    speech_energy = spec[speech_band].sum()
    total_energy = spec.sum()
    speech_pct = float(speech_energy / total_energy)

    # Spectral centroid — speech centroid usually lands 500-2500 Hz.
    centroid = float((spec * freqs).sum() / (spec.sum() + 1e-9))

    spectral_ok = speech_pct > 0.55 and 500 <= centroid <= 2500
    return spectral_ok, centroid


def _syllabic_rhythm_score(block: np.ndarray, sr: int) -> bool:
    """
    Check for 4-8 Hz modulation in the amplitude envelope — speech's
    syllabic rhythm.  A steady music note has no such modulation; a
    drum kit's modulation spans a much broader band.
    """
    # Envelope = absolute-value low-passed to ~20 Hz.
    env = np.abs(block)
    # Decimate to ~200 Hz for the modulation FFT (syllables run 2-10 Hz).
    decim = max(1, sr // 200)
    env = env[::decim]
    if len(env) < 32:
        return False
    env = env - env.mean()
    mod_spec = np.abs(np.fft.rfft(env * np.hanning(len(env))))
    mod_freqs = np.fft.rfftfreq(len(env), decim / sr)

    band = (mod_freqs >= 3) & (mod_freqs <= 9)
    if mod_spec.sum() <= 1e-9:
        return False
    band_pct = float(mod_spec[band].sum() / mod_spec.sum())
    return band_pct > 0.22  # tuned empirically against speech vs. music.


def detect_dialog_lufs(y_mono: np.ndarray, sr: int) -> dict | None:
    """
    Gate the mono signal to speech-like blocks and integrate LUFS over
    just those blocks using pyloudnorm.

    Returns {lufs_i, speech_pct, confidence} or None when no speech
    was found or the file is too short to analyse.
    """
    if y_mono.ndim != 1:
        y_mono = y_mono.reshape(-1)
    if sr < 8000:  # pyloudnorm minimum.
        return None
    block_n = int(_BLOCK_SEC * sr)
    if len(y_mono) < block_n * 3:
        return None

    speech_mask: list[bool] = []
    # Step through the signal in non-overlapping blocks.
    for start in range(0, len(y_mono) - block_n + 1, block_n):
        block = y_mono[start:start + block_n]
        # Skip silent blocks — speech is never < -60 dBFS RMS.
        rms = float(np.sqrt((block ** 2).mean() + 1e-12))
        if rms < 10 ** (-60 / 20):
            speech_mask.append(False)
            continue
        spec_ok, _ = _spectral_speech_score(block, sr)
        if not spec_ok:
            speech_mask.append(False)
            continue
        rhythm_ok = _syllabic_rhythm_score(block, sr)
        speech_mask.append(rhythm_ok)

    total_blocks = len(speech_mask)
    speech_blocks = int(sum(speech_mask))
    speech_pct = round(100.0 * speech_blocks / max(total_blocks, 1), 1)

    if speech_pct < _MIN_SPEECH_PCT:
        # Panel ask (broadcast mixer): "don't silently return None —
        # give me a low-confidence flag so I know the detector ran."
        # We return a result with confidence="none" and no LUFS so the
        # UI can show "No dialog detected" explicitly rather than
        # hiding the row.
        return {
            "lufs_i": None,
            "speech_pct": speech_pct,
            "confidence": "none",
            "note": "No dialog detected — track plays as music / instrumental. Netflix / ATSC A-85 speech-anchored targets don't apply.",
        }

    # Concatenate the speech blocks and integrate with pyloudnorm.
    # pyloudnorm already applies ITU-R BS.1770 gating on top of what we
    # feed it, which is exactly what we want — we're just restricting
    # the *input* to speech-like blocks first.
    speech_chunks: list[np.ndarray] = []
    for i, keep in enumerate(speech_mask):
        if not keep:
            continue
        start = i * block_n
        end = start + block_n
        speech_chunks.append(y_mono[start:end])
    concatenated = np.concatenate(speech_chunks) if speech_chunks else np.zeros(0)
    if len(concatenated) < block_n * 2:
        # pyloudnorm needs at least a few blocks to gate-integrate.
        return {
            "lufs_i": None,
            "speech_pct": speech_pct,
            "confidence": "insufficient",
            "note": ("Only " + str(len(concatenated) // block_n) + " speech blocks — "
                     "need at least 2 for BS.1770 gate-integration."),
        }

    meter = pyln.Meter(sr)
    try:
        # pyloudnorm wants (samples, channels); feed mono as (samples, 1).
        lufs = float(meter.integrated_loudness(concatenated[:, None] if concatenated.ndim == 1 else concatenated))
    except Exception as e:
        # Surface the failure to the UI instead of silently hiding it —
        # a broadcast mixer needs to know the detector ran and broke,
        # not that it couldn't decide.
        return {
            "lufs_i": None,
            "speech_pct": speech_pct,
            "confidence": "error",
            "note": f"pyloudnorm failed: {e}",
        }

    # Confidence based on how much speech we saw — the less we saw, the
    # more the integrated number is extrapolated from a small sample.
    if speech_pct >= 30:
        confidence = "high"
    elif speech_pct >= 10:
        confidence = "medium"
    else:
        confidence = "low"

    return {
        "lufs_i": round(lufs, 2),
        "speech_pct": speech_pct,
        "confidence": confidence,
    }
