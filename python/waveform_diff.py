"""
Time-localised spectrum diff between two files — fuels the
"where in the track does my mix diverge?" heatmap.

Splits both files into ~2-second windows, computes log-mag spectra per
window, and returns an MxN grid of dB differences (B − A) where
  M = number of frequency bands (31-band ISO),
  N = number of time windows.

The UI renders this as a heatmap: warm colour = B is louder than A in
that band/time, cool colour = quieter.
"""

import numpy as np
import librosa
from scipy.signal import butter, sosfilt


FREQS = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
    200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
    2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
]


def compute(path_a: str, path_b: str, sr: int = None, window_sec: float = 2.0) -> dict:
    try:
        ya, _ = librosa.load(path_a, sr=sr, mono=True)
        yb, _ = librosa.load(path_b, sr=sr, mono=True)

        # Level-match by RMS so the heatmap shows tonal differences, not volume.
        rms_a = float(np.sqrt(np.mean(ya ** 2)))
        rms_b = float(np.sqrt(np.mean(yb ** 2)))
        if rms_b > 1e-10:
            yb = yb * (rms_a / rms_b)

        # Trim to shared length
        n = min(len(ya), len(yb))
        ya = ya[:n]
        yb = yb[:n]
        duration = n / sr

        win = int(sr * window_sec)
        hop = win
        time_bins = max(1, (n - win) // hop + 1)
        # Cap to keep JSON small — around 120 time bins max
        if time_bins > 120:
            hop = (n - win) // 120
            time_bins = 120

        # Pre-build per-band sos filters once
        nyq = sr / 2
        filters = []
        for f in FREQS:
            low = f / (2 ** (1/6))
            high = f * (2 ** (1/6))
            low_n = max(low / nyq, 0.001)
            high_n = min(high / nyq, 0.999)
            if low_n >= high_n:
                filters.append(None)
                continue
            filters.append(butter(4, [low_n, high_n], btype='band', output='sos'))

        diff_grid = []
        timeline = []
        for ti in range(time_bins):
            s = ti * hop
            e = s + win
            if e > n:
                break
            seg_a = ya[s:e]
            seg_b = yb[s:e]
            row = []
            for fi, sos in enumerate(filters):
                if sos is None:
                    row.append(0.0)
                    continue
                fa = sosfilt(sos, seg_a)
                fb = sosfilt(sos, seg_b)
                rms_a = float(np.sqrt(np.mean(fa ** 2)))
                rms_b = float(np.sqrt(np.mean(fb ** 2)))
                db_a = 20 * np.log10(max(rms_a, 1e-10))
                db_b = 20 * np.log10(max(rms_b, 1e-10))
                row.append(round(db_b - db_a, 1))
            diff_grid.append(row)
            timeline.append(round(s / sr, 1))

        # Find hotspots — top N cells with largest |diff|
        flat = []
        for ti, row in enumerate(diff_grid):
            for fi, v in enumerate(row):
                flat.append((abs(v), v, ti, fi))
        flat.sort(reverse=True)
        hotspots = []
        for absv, v, ti, fi in flat[:12]:
            if absv < 3.0:
                continue
            freq_hz = FREQS[fi] if fi < len(FREQS) else 0
            t_sec = timeline[ti] if ti < len(timeline) else 0
            hotspots.append({
                "time_sec": t_sec,
                "freq_hz": freq_hz,
                "diff_db": v,
            })

        return {
            "freqs": FREQS,
            "timeline": timeline,
            "window_sec": window_sec,
            "grid": diff_grid,             # [time][freq] → dB diff (B − A)
            "hotspots": hotspots,
            "duration_sec": round(duration, 1),
        }
    except Exception as e:
        return {
            "freqs": FREQS, "timeline": [], "window_sec": window_sec,
            "grid": [], "hotspots": [], "duration_sec": 0.0,
            "error": str(e),
        }
