"""
Hum / buzz / 50-60 Hz detector.

Scans the FFT for sustained energy at 50 Hz or 60 Hz (AC mains frequencies)
and their first 3 harmonics. A confirmed hum is a narrow, stable peak that
persists across time — not a transient tonal element.

When detected, outputs a notch-filter preset the user can copy into Pro-Q
or similar: { freq, Q, depth_db } per offending harmonic.
"""

import numpy as np
import librosa


MAINS_CANDIDATES = [50.0, 60.0]
HARMONIC_MULTIPLES = [1, 2, 3, 4]          # fundamental + 3 harmonics
NARROWBAND_BW_HZ = 1.5                     # ± Hz around the candidate
SIDEBAND_BW_HZ = 8.0                       # sideband used to compute peak-vs-floor
MIN_PROMINENCE_DB = 8.0                    # peak must be this much above sideband
MIN_TIME_COVERAGE = 0.60                   # and present in at least 60% of frames


def detect_hum(y: np.ndarray, sr: int) -> dict:
    """
    Returns:
      {
        "mains": 50 | 60 | 0,
        "harmonics": [{ freq, prominence_db, coverage }],
        "notch_preset": [{ freq, q, gain_db }],
        "severity": "none" | "subtle" | "audible",
        "summary": "…",
      }
    """
    try:
        # Use first 30 seconds for speed — hum doesn't change mid-track
        if len(y) > sr * 30:
            y_use = y[: sr * 30]
        else:
            y_use = y

        # 5.3.1 fix: long FFT for narrow-band resolution. Pre-5.3 used
        # n_fft=8192 (≈5.4 Hz bins at 44.1k), which is the same bin
        # width as the NARROWBAND_BW_HZ=1.5 search half-width — meaning
        # 50 Hz and 60 Hz could fall in the SAME bin and the detector
        # couldn't actually distinguish them. Bumped to 16384 → ~2.7 Hz
        # bins at 44.1k and ~1.35 Hz at 88/96k, comfortably resolvable.
        n_fft = 16384 if sr <= 48000 else 32768
        hop = n_fft // 4
        S = np.abs(librosa.stft(y_use, n_fft=n_fft, hop_length=hop))
        if S.shape[1] < 4:
            return _empty_result()

        freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)

        def band_mask(center, bw):
            return (freqs >= center - bw) & (freqs < center + bw)

        # For each mains candidate, evaluate fundamental + harmonics coverage
        best = {"mains": 0, "harmonics": [], "score": 0.0}

        for mains in MAINS_CANDIDATES:
            if mains * 4 > sr / 2:
                continue
            total_score = 0.0
            harmonic_hits = []

            for mult in HARMONIC_MULTIPLES:
                cfreq = mains * mult
                if cfreq > sr / 2 - SIDEBAND_BW_HZ:
                    continue

                narrow = band_mask(cfreq, NARROWBAND_BW_HZ)
                side_lo = band_mask(cfreq - (NARROWBAND_BW_HZ + SIDEBAND_BW_HZ), SIDEBAND_BW_HZ)
                side_hi = band_mask(cfreq + (NARROWBAND_BW_HZ + SIDEBAND_BW_HZ), SIDEBAND_BW_HZ)

                if not narrow.any() or not (side_lo.any() or side_hi.any()):
                    continue

                # Per-frame peak-vs-floor
                narrow_peak = np.max(S[narrow, :], axis=0) + 1e-12
                sideband = np.concatenate([S[side_lo, :], S[side_hi, :]], axis=0)
                sideband_floor = np.maximum(np.mean(sideband, axis=0), 1e-12)
                prominence_db = 20 * np.log10(narrow_peak / sideband_floor)

                coverage = float(np.mean(prominence_db > MIN_PROMINENCE_DB))
                median_prom = float(np.median(prominence_db))

                if coverage >= MIN_TIME_COVERAGE and median_prom > MIN_PROMINENCE_DB:
                    harmonic_hits.append({
                        "freq": round(float(cfreq), 1),
                        "prominence_db": round(median_prom, 1),
                        "coverage": round(coverage, 2),
                    })
                    # Score weights the fundamental heaviest
                    weight = 1.0 / mult
                    total_score += median_prom * coverage * weight

            if total_score > best["score"]:
                best = {
                    "mains": int(mains),
                    "harmonics": harmonic_hits,
                    "score": total_score,
                }

        if not best["harmonics"]:
            return _empty_result()

        # Build notch preset (Q ≈ 30-40 for surgical hum removal)
        notch_preset = []
        for h in best["harmonics"]:
            # Deeper notch for stronger hum, clamped for safety
            depth = -min(18.0, max(6.0, h["prominence_db"] * 0.6))
            notch_preset.append({
                "freq": h["freq"],
                "q": 30.0,
                "gain_db": round(depth, 1),
            })

        # Severity heuristic
        top_prom = max(h["prominence_db"] for h in best["harmonics"])
        if top_prom > 20:
            severity = "audible"
        elif top_prom > 12:
            severity = "subtle"
        else:
            severity = "none"

        summary = (
            f"{best['mains']} Hz mains hum detected — fundamental + {len(best['harmonics']) - 1} harmonic(s). "
            f"{severity.capitalize()}. Use the notch preset to remove."
            if severity != "none"
            else f"Possible {best['mains']} Hz component but below audibility threshold."
        )

        return {
            "mains": best["mains"],
            "harmonics": best["harmonics"],
            "notch_preset": notch_preset,
            "severity": severity,
            "summary": summary,
        }

    except Exception as e:
        return _empty_result(error=str(e))


def _empty_result(error: str = "") -> dict:
    r = {
        "mains": 0,
        "harmonics": [],
        "notch_preset": [],
        "severity": "none",
        "summary": "No mains hum detected.",
    }
    if error:
        r["error"] = error
    return r
