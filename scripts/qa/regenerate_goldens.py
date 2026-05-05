#!/usr/bin/env python3
"""
Regenerate the /tmp/rtm-qa-golden corpus.

10 deterministic synthetic test signals + 1 matched-pair sibling, used by
the bench harness, the AI-detector calibration, and the per-stage QA
appendices.  macOS clears /tmp between sessions, so we keep this script
around to rebuild the corpus on demand.

Names (must match what scripts/qa/ai_detector_bench.py and the bench
spec expect):

  01_sine1k_m20_stereo.wav         1 kHz sine, stereo identical, -20 dBFS
  02_antiphase_60hz.wav            60 Hz, L = +sin, R = -sin
  03_pink_independent_lr.wav       independent pink noise L / R
  04_white_noise_m14lufs.wav       white noise calibrated to -14 LUFS
  05_clipped_sine.wav              hard-clipped sine (TP > 0 dBTP)
  06_silence_30s.wav               30 s digital silence
  07_click_120bpm.wav              metronome at 120 BPM
  08_sine1k_lfo4hz_pm6db.wav       1 kHz with 4 Hz amplitude LFO ±6 dB
  09_rough_mix.wav                 sum of sine + sub + click + noise
  09_rough_mix_m05db.wav           same as 09 but exactly -0.5 dB (pair)
  10_synthetic_song_stem.wav       30 s 'song stem' substitute
"""
from __future__ import annotations
from pathlib import Path
import numpy as np
import soundfile as sf

OUT = Path("/tmp/rtm-qa-golden")
SR = 44100
DUR = 30.0  # seconds — long enough for LRA / momentary loudness windows
N = int(SR * DUR)
T = np.arange(N) / SR


def write(name: str, audio: np.ndarray) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    if audio.ndim == 1:
        audio = np.column_stack([audio, audio])
    if audio.shape[1] != 2 and audio.shape[0] == 2:
        audio = audio.T
    sf.write(str(OUT / name), audio.astype(np.float32), SR)
    peak = float(np.max(np.abs(audio)))
    print(f"  {name:36}  shape={audio.shape}  peak={peak:.4f}")


def db_to_lin(db):
    """Accept scalar OR ndarray — sample 08 needs the vector form."""
    return np.power(10.0, np.asarray(db) / 20.0)


def main() -> None:
    rng = np.random.default_rng(20260426)

    # 01 — 1 kHz sine, stereo identical, -20 dBFS
    sig = db_to_lin(-20) * np.sin(2 * np.pi * 1000 * T)
    write("01_sine1k_m20_stereo.wav", np.column_stack([sig, sig]))

    # 02 — anti-phase 60 Hz bass
    bass = 0.5 * np.sin(2 * np.pi * 60 * T)
    write("02_antiphase_60hz.wav", np.column_stack([bass, -bass]))

    # 03 — independent pink-ish noise L / R
    def pink(rng: np.random.Generator) -> np.ndarray:
        white = rng.standard_normal(N).astype(np.float32)
        # cumulative-sum trick gives a rough pink-tilt
        b = np.cumsum(white) * 0.0008
        return np.clip(b, -0.6, 0.6)
    L = pink(rng)
    R = pink(np.random.default_rng(20260427))
    write("03_pink_independent_lr.wav", np.column_stack([L, R]))

    # 04 — white noise calibrated to ~ -14 LUFS.  Pure white at RMS ~ -14
    # dBFS lands at ~ -14.5 LUFS once K-weighted; close enough for the
    # round-trip tolerance.
    target_rms_lin = db_to_lin(-14)
    white = rng.standard_normal(N).astype(np.float32)
    white *= target_rms_lin / np.sqrt(np.mean(white ** 2))
    white = np.clip(white, -0.99, 0.99)
    write("04_white_noise_m14lufs.wav", np.column_stack([white, white]))

    # 05 — clipped sine, TP > 0 dBTP
    over = 1.6 * np.sin(2 * np.pi * 1000 * T)
    clipped = np.clip(over, -1.0, 1.0)
    write("05_clipped_sine.wav", np.column_stack([clipped, clipped]))

    # 06 — silence
    write("06_silence_30s.wav", np.zeros((N, 2), dtype=np.float32))

    # 07 — 120 BPM click track.  Click every 0.5 s, 5 ms half-sine.
    click_period = SR // 2
    click_len = int(SR * 0.005)
    click = (np.sin(np.linspace(0, np.pi, click_len)) * 0.7).astype(np.float32)
    track = np.zeros(N, dtype=np.float32)
    pos = 0
    while pos + click_len < N:
        track[pos:pos + click_len] = click
        pos += click_period
    write("07_click_120bpm.wav", np.column_stack([track, track]))

    # 08 — 1 kHz sine with 4 Hz LFO ±6 dB
    base = np.sin(2 * np.pi * 1000 * T)
    lfo = 0.5 * (1 + np.sin(2 * np.pi * 4 * T))   # 0..1
    # Map 0..1 to db -6..0 about a -3 dB carrier
    db_envelope = -3 + 3 * lfo - 3 * (1 - lfo)
    gain = db_to_lin(db_envelope)
    sig = (db_to_lin(-12) * gain * base).astype(np.float32)
    write("08_sine1k_lfo4hz_pm6db.wav", np.column_stack([sig, sig]))

    # 09 — rough mix: sum of sub + tone + click + noise
    sub = 0.20 * np.sin(2 * np.pi * 80 * T)
    tone = 0.18 * np.sin(2 * np.pi * 1500 * T)
    perc = np.zeros(N, dtype=np.float32)
    pos = 0
    pulse_len = int(SR * 0.08)
    pulse = (np.exp(-np.linspace(0, 5, pulse_len)) * 0.4).astype(np.float32)
    while pos + pulse_len < N:
        perc[pos:pos + pulse_len] = pulse * np.sin(2 * np.pi * 200 * np.linspace(0, pulse_len / SR, pulse_len))
        pos += SR // 2
    noise = 0.04 * rng.standard_normal(N).astype(np.float32)
    rough = sub + tone + perc + noise
    rough_l = rough
    rough_r = sub + tone + perc * 0.92 + 0.04 * np.random.default_rng(20260428).standard_normal(N).astype(np.float32)
    write("09_rough_mix.wav", np.column_stack([rough_l, rough_r]))

    # 09b — same minus 0.5 dB exactly
    write(
        "09_rough_mix_m05db.wav",
        np.column_stack([rough_l, rough_r]) * db_to_lin(-0.5),
    )

    # 10 — synthetic 'song stem': sum of bass + mid + air
    bass = 0.18 * np.sin(2 * np.pi * 110 * T)
    mid = 0.12 * np.sin(2 * np.pi * 880 * T) * (0.6 + 0.4 * np.sin(2 * np.pi * 0.5 * T))
    air = 0.05 * rng.standard_normal(N).astype(np.float32)
    stem = (bass + mid + air).astype(np.float32)
    write("10_synthetic_song_stem.wav", np.column_stack([stem, stem]))

    print(f"\nWrote {len(list(OUT.glob('*.wav')))} files to {OUT}")


if __name__ == "__main__":
    main()
