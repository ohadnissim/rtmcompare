"""
Transfer-artefact detector.

Finds signs of tape-transfer / analogue-chain damage in a master:

  • Wow / flutter — slow (< 10 Hz) amplitude or pitch modulation from a
    worn tape transport. Detected via autocorrelation of the analytic-
    signal envelope in the 0.3–6 Hz range (wow) and 6–30 Hz (flutter).
  • Transport hum — low-subharmonic energy at 15 / 20 / 30 Hz (reel
    capstan / flywheel frequencies). Orthogonal to the existing 50/60 Hz
    mains-hum detector.
  • DC offset / drift — slow shift of the waveform mean off zero. A
    common symptom of AC-coupled converters done badly; also appears
    on old tape machines with worn erase heads.
  • Print-through — pre-echo at fixed delay (usually ~1 s on ¼″ tape
    at 15 ips). Detected by cross-correlating the signal with itself at
    the expected offset.

Status: SCAFFOLD. Signatures + stub implementation. Each detector
function returns (severity, detail_string, metric_number) so the
renderer can render a summary strip identical in shape to HumPanel.

See RTM Engineers/FEATURES/TRANSFER-ARTEFACT-DETECTOR.md for the full
DSP spec and references.
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass, asdict
from typing import Optional

try:
    import numpy as np
    import soundfile as sf
except ImportError:  # pragma: no cover
    np = None  # type: ignore
    sf = None  # type: ignore


@dataclass
class ArtefactFinding:
    kind: str                  # 'wow' | 'flutter' | 'transport_hum' | 'dc_drift' | 'print_through'
    severity: str              # 'none' | 'subtle' | 'audible'
    metric: float              # interpretation varies per kind
    detail: str                # human-readable description


@dataclass
class TransferArtefactResult:
    findings: list[ArtefactFinding]
    summary: str


def _envelope(x: "np.ndarray") -> "np.ndarray":
    """Hilbert envelope — magnitude of the analytic signal."""
    assert np is not None
    # Cheap ~envelope: full-wave rectify + low-pass via moving-average.
    # Real implementation would use scipy.signal.hilbert; kept light here
    # so the scaffold runs without scipy.
    rec = np.abs(x)
    window = max(1, int(len(x) * 0.001))
    kernel = np.ones(window, dtype=np.float32) / window
    return np.convolve(rec, kernel, mode="same")


def detect_wow_flutter(mono: "np.ndarray", sr: int) -> list[ArtefactFinding]:
    """Envelope AM analysis — wow: 0.3–6 Hz, flutter: 6–30 Hz. Returns
    one finding per band based on peak modulation depth."""
    if np is None:
        return []
    env = _envelope(mono)
    # Downsample envelope so the FFT grid lands near 1 Hz resolution.
    target_sr = 200
    step = max(1, sr // target_sr)
    env_ds = env[::step]
    env_sr = sr / step
    env_ds = env_ds - float(np.mean(env_ds))
    n = len(env_ds)
    if n < 256:
        return []
    win = np.hanning(n).astype(np.float32)
    spec = np.abs(np.fft.rfft(env_ds * win))
    freqs = np.fft.rfftfreq(n, d=1.0 / env_sr)
    if np.max(spec) <= 0:
        return []
    spec = spec / np.max(spec)
    def peak_in(lo: float, hi: float) -> tuple[float, float]:
        mask = (freqs >= lo) & (freqs <= hi)
        if not np.any(mask): return 0.0, 0.0
        sub = spec[mask]
        i = int(np.argmax(sub))
        return float(sub[i]), float(freqs[mask][i])
    wow_peak, wow_freq = peak_in(0.3, 6.0)
    flu_peak, flu_freq = peak_in(6.0, 30.0)

    def classify(peak: float) -> str:
        if peak > 0.35: return "audible"
        if peak > 0.12: return "subtle"
        return "none"
    out: list[ArtefactFinding] = []
    out.append(ArtefactFinding(
        kind="wow",
        severity=classify(wow_peak),
        metric=round(wow_peak, 3),
        detail=f"Dominant envelope modulation at {wow_freq:.2f} Hz — consistent with worn tape transport / pitch drift." if wow_peak > 0.12 else
               "No significant wow detected.",
    ))
    out.append(ArtefactFinding(
        kind="flutter",
        severity=classify(flu_peak),
        metric=round(flu_peak, 3),
        detail=f"Envelope modulation at {flu_freq:.2f} Hz — likely flutter (worn capstan / bearing)." if flu_peak > 0.12 else
               "No significant flutter detected.",
    ))
    return out


def detect_dc_drift(mono: "np.ndarray", sr: int) -> ArtefactFinding:
    """Compute DC offset per 1 s frame; flag if drift range > 0.5% FS."""
    if np is None:
        return ArtefactFinding("dc_drift", "none", 0.0, "numpy unavailable")
    frame = sr
    n = max(1, len(mono) // frame)
    means = np.array([float(np.mean(mono[i * frame : (i + 1) * frame])) for i in range(n)])
    drift = float(np.max(means) - np.min(means))
    if drift > 0.02:
        sev, note = "audible", f"DC drift range {drift*100:.2f}% FS — AC coupling gone wrong or worn erase head."
    elif drift > 0.005:
        sev, note = "subtle", f"Slight DC drift ({drift*100:.2f}% FS) — audible on extended fades."
    else:
        sev, note = "none", "DC centred; no transport / coupling drift detected."
    return ArtefactFinding("dc_drift", sev, round(drift, 5), note)


def detect_transport_hum(mono: "np.ndarray", sr: int) -> ArtefactFinding:
    """Quick spectral peak check at 15 / 20 / 30 Hz — classic tape
    transport / flywheel frequencies. Independent of the mains-hum
    detector which lives at 50 / 60 Hz."""
    if np is None:
        return ArtefactFinding("transport_hum", "none", 0.0, "numpy unavailable")
    # 4-second FFT window — picks up a clean fundamental.
    n = min(len(mono), sr * 4)
    x = mono[:n] - float(np.mean(mono[:n]))
    spec = np.abs(np.fft.rfft(x * np.hanning(n)))
    freqs = np.fft.rfftfreq(n, d=1.0 / sr)
    peaks = []
    for f0 in (15.0, 20.0, 30.0):
        mask = (freqs >= f0 - 1) & (freqs <= f0 + 1)
        if np.any(mask):
            peaks.append(float(np.max(spec[mask])))
    if not peaks:
        return ArtefactFinding("transport_hum", "none", 0.0, "No transport hum scan run.")
    peak = max(peaks)
    baseline = float(np.percentile(spec, 85)) + 1e-9
    ratio = peak / baseline
    if ratio > 6:
        return ArtefactFinding("transport_hum", "audible", round(ratio, 2),
                               f"Transport hum peak {ratio:.1f}× baseline at 15–30 Hz — tape flywheel / capstan.")
    if ratio > 2.5:
        return ArtefactFinding("transport_hum", "subtle", round(ratio, 2),
                               f"Mild 15–30 Hz energy ({ratio:.1f}× baseline).")
    return ArtefactFinding("transport_hum", "none", round(ratio, 2), "No transport hum detected.")


def detect_print_through(mono: "np.ndarray", sr: int, delay_sec: float = 1.0) -> ArtefactFinding:
    """Pre-echo detection: cross-correlate the first ~10 s with a shifted
    copy; print-through shows up as a broad correlation peak at the
    expected delay."""
    if np is None:
        return ArtefactFinding("print_through", "none", 0.0, "numpy unavailable")
    n_ref = min(len(mono), sr * 10)
    delay_samples = int(delay_sec * sr)
    if n_ref <= delay_samples:
        return ArtefactFinding("print_through", "none", 0.0, "File too short for print-through check.")
    ref = mono[:n_ref]
    shifted = np.concatenate([np.zeros(delay_samples), mono[: n_ref - delay_samples]])
    num = float(np.dot(ref, shifted))
    den = float(np.sqrt(np.dot(ref, ref) * np.dot(shifted, shifted))) + 1e-12
    corr = num / den
    if corr > 0.06:
        return ArtefactFinding("print_through", "audible", round(corr, 4),
                               f"Pre-echo correlation {corr:.3f} at {delay_sec:.1f}s — classic tape print-through.")
    if corr > 0.025:
        return ArtefactFinding("print_through", "subtle", round(corr, 4),
                               f"Weak pre-echo ({corr:.3f}) at {delay_sec:.1f}s delay.")
    return ArtefactFinding("print_through", "none", round(corr, 4), "No print-through correlation above noise floor.")


def analyse_transfer_artefacts(path: str) -> TransferArtefactResult:
    """Run every detector on the file and roll up a summary line.
    Failures (missing deps, short file, decode error) are surfaced as
    a single 'none' finding so the renderer can still render the card
    without branching."""
    if np is None or sf is None:
        return TransferArtefactResult(findings=[], summary="numpy / soundfile unavailable")
    try:
        data, sr = sf.read(path, dtype="float32")
    except Exception as e:
        return TransferArtefactResult(findings=[], summary=f"Could not decode file: {e}")
    mono = data.mean(axis=1) if data.ndim > 1 else data

    findings: list[ArtefactFinding] = []
    findings.extend(detect_wow_flutter(mono, sr))
    findings.append(detect_transport_hum(mono, sr))
    findings.append(detect_dc_drift(mono, sr))
    findings.append(detect_print_through(mono, sr))

    worst = "none"
    for f in findings:
        if f.severity == "audible":
            worst = "audible"; break
        if f.severity == "subtle" and worst == "none":
            worst = "subtle"
    summary = {
        "none":    "No transfer artefacts above the noise floor.",
        "subtle":  "Subtle transfer artefacts detected — likely audible on extended listening.",
        "audible": "Transfer artefacts audible — inspect the highlighted findings before delivery.",
    }[worst]
    return TransferArtefactResult(findings=findings, summary=summary)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: transfer_artefact_detector.py <file>"}))
        sys.exit(1)
    result = analyse_transfer_artefacts(sys.argv[1])
    print(json.dumps({"findings": [asdict(f) for f in result.findings], "summary": result.summary}))
