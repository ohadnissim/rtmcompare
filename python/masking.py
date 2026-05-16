"""
Masking overlap detection — finds frequency regions where the full mix has
high energy density, flagging potential masking issues.
"""

import os
import numpy as np
import librosa
from scipy.signal import butter, sosfilt


BANDS = [
    {"name": "Sub / Kick body",     "low": 40,    "high": 80},
    {"name": "Bass fundamental",    "low": 80,    "high": 160},
    {"name": "Low-mid mud",         "low": 160,   "high": 400},
    {"name": "Vocal body / boxy",   "low": 300,   "high": 700},
    {"name": "Vocal presence",      "low": 1500,  "high": 4000},
    {"name": "Snare / cymbal edge", "low": 4000,  "high": 8000},
    {"name": "Air / sibilance",     "low": 8000,  "high": 14000},
]


def _band_rms_db(y: np.ndarray, sr: int, low: float, high: float) -> float:
    nyq = sr / 2
    low_n = max(low / nyq, 0.001)
    high_n = min(high / nyq, 0.999)
    if low_n >= high_n:
        return -90.0
    sos = butter(4, [low_n, high_n], btype='band', output='sos')
    filt = sosfilt(sos, y)
    rms = np.sqrt(np.mean(filt ** 2))
    return float(20 * np.log10(max(rms, 1e-10)))


def analyze_masking(file_path: str, sr: int = None) -> dict:
    """
    Analyse masking overlaps from the full-mix spectrum.

    Flags frequency bands where the mix has high energy density, suggesting
    potential masking between elements.
    """
    overlaps = []

    if file_path and os.path.exists(file_path):
        try:
            y, _ = librosa.load(file_path, sr=sr, mono=True)
            total_rms = np.sqrt(np.mean(y ** 2))
            for b in BANDS:
                db = _band_rms_db(y, sr, b["low"], b["high"])
                # If any band is within 3 dB of the loudest, the mix is
                # likely flat / dense in that region.
                db_rel = db - (20 * np.log10(max(total_rms, 1e-10)))
                if db_rel > -6:
                    overlaps.append({
                        "pair": b["name"],
                        "freq_range": f"{b['low']}-{b['high'] if b['high'] < 1000 else str(b['high']//1000) + 'k'} Hz",
                        "severity": "info",
                        "description": f"Dense in {b['name'].lower()} — consider checking whether elements can be tucked.",
                        "level_a": round(db, 1),
                        "level_b": round(db, 1),
                        "tip": "",
                    })
        except Exception:
            pass

    return {
        "overlaps": overlaps,
        "stem_based": False,
    }
