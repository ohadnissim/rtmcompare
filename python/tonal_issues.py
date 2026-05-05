"""
Tonal issue detection — flags perceptual problems like
harshness, boominess, muddiness, sibilance, boxiness, thinness.

These are frequency-range characteristics that experienced engineers
listen for. We measure them objectively by comparing energy in
specific bands between File A and File B.
"""

import numpy as np
import librosa
from scipy.signal import butter, sosfilt


# Each issue: name, frequency range, description, and what to listen for
TONAL_CHECKS = [
    {
        "name": "Boominess",
        "low": 100, "high": 300,
        "threshold_increase": 1.0,
        "threshold_absolute": -12.0,
        "description": "Excess low-mid energy — sounds muddy and undefined on the low end",
        "fix": "Cut 2-3 dB around 150-250 Hz with a wide bell, or use a high-pass filter on non-bass instruments",
        "icon": "boom",
    },
    {
        "name": "Muddiness",
        "low": 200, "high": 500,
        "threshold_increase": 1.0,
        "threshold_absolute": -10.0,
        "description": "Buildup in the low-mids — lacks clarity, instruments blend together",
        "fix": "Cut around 300-400 Hz on competing instruments, or boost clarity around 2-3 kHz",
        "icon": "mud",
    },
    {
        "name": "Boxiness",
        "low": 300, "high": 700,
        "threshold_increase": 1.2,
        "threshold_absolute": -10.0,
        "description": "Sounds like it's in a cardboard box — honky, nasal quality",
        "fix": "Narrow cut around 400-600 Hz, check room treatment if recording",
        "icon": "box",
    },
    {
        "name": "Harshness",
        "low": 2000, "high": 5000,
        "threshold_increase": 1.0,
        "threshold_absolute": -12.0,
        "description": "Ear-fatiguing presence — makes you want to turn it down after a few minutes",
        "fix": "Dip 1-2 dB around 3-4 kHz, check if saturation or exciter is adding too much edge",
        "icon": "harsh",
    },
    {
        "name": "Sibilance",
        "low": 5000, "high": 9000,
        "threshold_increase": 1.2,
        "threshold_absolute": -15.0,
        "description": "Sharp S, T, and F sounds — especially noticeable on vocals",
        "fix": "Use a de-esser on the vocal bus, or make a narrow cut around 6-8 kHz",
        "icon": "sibilance",
    },
    {
        "name": "Thinness",
        "low": 60, "high": 200,
        "threshold_decrease": 1.0,
        "description": "Lacking body and warmth — sounds anemic, no weight",
        "fix": "Boost 1-2 dB with a low shelf around 100-150 Hz, check high-pass filter settings",
        "icon": "thin",
    },
    {
        "name": "Brightness Fatigue",
        "low": 8000, "high": 16000,
        "threshold_increase": 1.5,
        "threshold_absolute": -20.0,
        "description": "Too much top-end energy — sparkly at first but fatiguing over a full listen",
        "fix": "Pull back the high shelf above 8 kHz by 1-2 dB, or reduce exciter/aural enhancer",
        "icon": "bright",
    },
]


def bandpass_rms_db(y: np.ndarray, sr: int, low: float, high: float) -> float:
    """Get RMS level in dB for a frequency band."""
    nyq = sr / 2
    low_n = max(low / nyq, 0.001)
    high_n = min(high / nyq, 0.999)
    if low_n >= high_n:
        return -70.0
    try:
        sos = butter(3, [low_n, high_n], btype='band', output='sos')
        filtered = sosfilt(sos, y)
        rms = np.sqrt(np.mean(filtered ** 2))
        if rms < 1e-10:
            return -70.0
        return float(20 * np.log10(rms))
    except Exception:
        return -70.0


def detect_tonal_issues(path_a: str, path_b: str, sr: int = 44100) -> list:
    """
    Compare tonal characteristics between File A and File B.
    Returns a list of detected issues with severity, description, and fix.
    """
    y_a, _ = librosa.load(path_a, sr=sr, mono=True)
    y_b, _ = librosa.load(path_b, sr=sr, mono=True)

    min_len = min(len(y_a), len(y_b))
    y_a = y_a[:min_len]
    y_b = y_b[:min_len]

    # Level match — clamp the divisor so a near-silent File B doesn't
    # blow up into a huge gain scalar (at 1e-10 you can still multiply
    # a full-scale sample by 1e10 and NaN everything downstream).
    rms_a = float(np.sqrt(np.mean(y_a ** 2)))
    rms_b = float(np.sqrt(np.mean(y_b ** 2)))
    if rms_b > 1e-6:
        y_b = y_b * (rms_a / max(rms_b, 1e-6))

    issues = []

    for check in TONAL_CHECKS:
        level_a = bandpass_rms_db(y_a, sr, check["low"], check["high"])
        level_b = bandpass_rms_db(y_b, sr, check["low"], check["high"])
        diff = level_b - level_a

        detected = False
        severity = "info"
        detail = ""

        if "threshold_decrease" in check:
            # Thinness: flag when energy DECREASED
            if diff < -check["threshold_decrease"]:
                detected = True
                detail = f"{abs(diff):.1f} dB less energy in {check['low']}-{check['high']} Hz"
                severity = "warning" if abs(diff) > 3.0 else "info"
        else:
            # Everything else: flag when energy INCREASED
            threshold = check.get("threshold_increase", 2.0)
            if diff > threshold:
                detected = True
                detail = f"+{diff:.1f} dB in {check['low']}-{check['high']} Hz"
                severity = "warning" if diff > threshold + 2.0 else "info"

                # Check absolute level too
                abs_thresh = check.get("threshold_absolute", -15.0)
                if level_b > abs_thresh:
                    severity = "warning"

        if detected:
            issues.append({
                "name": check["name"],
                "severity": severity,
                "level_a": round(level_a, 1),
                "level_b": round(level_b, 1),
                "diff": round(diff, 1),
                "freq_range": f"{check['low']}-{check['high']} Hz",
                "description": check["description"],
                "fix": check["fix"],
                "detail": detail,
            })

    return issues
