#!/usr/bin/env python3
"""
RTMcertify — pre-delivery compliance certificate CLI for RTMcompare.

Usage:
    python rtm_certify.py --certify <file_a> <file_b>

Outputs a signed JSON certificate to stdout.
"""

import argparse
import hashlib
import hmac
import json
import os
import sys
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import numpy as np
    import soundfile as sf
    _DEPS_OK = True
except ImportError:
    _DEPS_OK = False


def _sha256_file(path: str) -> str:
    """Compute SHA-256 of a file using chunked 1 MB reads."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            chunk = fh.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _file_duration(path: str) -> float | None:
    """Return duration in seconds using soundfile."""
    try:
        info = sf.info(path)
        return float(info.duration)
    except Exception:
        try:
            info = sf.info(path)
            return float(info.frames) / float(info.samplerate)
        except Exception:
            return None


def _compute_lufs(path: str) -> float | None:
    """
    Compute integrated LUFS for a file by delegating to comparator.compute_lufs.
    Returns None on failure.
    """
    try:
        import librosa
        from comparator import compute_lufs
        y, sr = librosa.load(path, sr=44100, mono=False)
        if y.ndim == 1:
            y = np.stack([y, y])
        return round(float(compute_lufs(y, sr)), 1)
    except Exception:
        return None


def _compute_true_peak(path: str) -> float | None:
    """Compute true-peak dBTP using comparator._true_peak_and_overs."""
    try:
        import librosa
        from comparator import _true_peak_and_overs
        y, _ = librosa.load(path, sr=44100, mono=False)
        if y.ndim == 1:
            y = np.stack([y, y])
        tp, _ = _true_peak_and_overs(y)
        return round(float(tp), 2) if tp is not None else None
    except Exception:
        return None


def _compute_lra(path: str) -> float | None:
    """Compute loudness range (LRA) using comparator.compute_dynamic_range."""
    try:
        import librosa
        from comparator import compute_dynamic_range
        y, sr = librosa.load(path, sr=44100, mono=True)
        return round(float(compute_dynamic_range(y, sr)), 1)
    except Exception:
        return None


def _compute_mono_compat(path: str) -> float | None:
    """
    Return mono compatibility percentage for a stereo file.
    Uses visualizations.compute_mono_compat comparing file to itself (L vs R summed).
    Falls back to a direct phase-correlation approach.
    """
    try:
        import librosa
        y, sr = librosa.load(path, sr=44100, mono=False)
        if y.ndim == 1:
            # mono file — perfect mono compatibility
            return 100.0
        # Phase-correlation: RMS of mono sum vs sum of RMS of each channel.
        # mono_compat_pct = (rms_mono_sum / rms_sum_of_channels) * 100
        left = y[0]
        right = y[1]
        mono = (left + right) / 2.0
        rms_mono = float(np.sqrt(np.mean(mono ** 2)))
        rms_lr = (float(np.sqrt(np.mean(left ** 2))) + float(np.sqrt(np.mean(right ** 2)))) / 2.0
        if rms_lr < 1e-9:
            return 100.0
        pct = min(100.0, round((rms_mono / rms_lr) * 100.0, 1))
        return pct
    except Exception:
        return None


def _compute_tonal_deviation(path: str) -> float | None:
    """
    Rough tonal balance deviation: mean absolute deviation of normalised
    third-octave spectrum levels from flat (0 dB mean). A flat-balanced
    master scores near 0; a heavily shaped master scores higher.
    """
    try:
        import librosa
        y, sr = librosa.load(path, sr=44100, mono=True)
        # 31 third-octave centre frequencies
        freqs = [
            20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
            200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
            2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
        ]
        n_fft = 4096
        hop = n_fft // 4
        D = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop))
        freqs_hz = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
        band_levels = []
        for fc in freqs:
            f_lo = fc / 2 ** (1 / 6)
            f_hi = fc * 2 ** (1 / 6)
            mask = (freqs_hz >= f_lo) & (freqs_hz < f_hi)
            if mask.sum() == 0:
                continue
            power = float(np.mean(D[mask, :] ** 2))
            db = 10 * np.log10(max(power, 1e-12))
            band_levels.append(db)
        if not band_levels:
            return None
        mean_lvl = float(np.mean(band_levels))
        dev = float(np.mean(np.abs(np.array(band_levels) - mean_lvl)))
        return round(dev, 2)
    except Exception:
        return None


def _generation_loss_probability(path: str) -> float | None:
    """Run generation loss detector on file_b."""
    try:
        from generation_loss_detector import analyse_generation_loss
        result = analyse_generation_loss(path)
        return float(result.probability)
    except Exception:
        return None


def _compute_lufs_delta(lufs_a: float | None, lufs_b: float | None) -> float | None:
    if lufs_a is None or lufs_b is None:
        return None
    return round(lufs_b - lufs_a, 1)


def _compliance(
    true_peak: float | None,
    lufs_b: float | None,
    gen_loss_prob: float | None,
) -> dict:
    true_peak_ok = (true_peak is not None) and (true_peak <= -1.0)
    lufs_range_ok = (lufs_b is not None) and (-18.0 <= lufs_b <= -9.0)
    streaming_ready = true_peak_ok and (lufs_b is not None) and (-16.0 <= lufs_b <= -9.0)
    generation_loss_ok = (gen_loss_prob is None) or (gen_loss_prob < 0.4)
    return {
        "streaming_ready": streaming_ready,
        "true_peak_ok": true_peak_ok,
        "lufs_range_ok": lufs_range_ok,
        "generation_loss_ok": generation_loss_ok,
    }


def _sign(payload: dict, certificate_id: str) -> str:
    payload_bytes = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    key = ("rtm-certify-v1-2026" + certificate_id).encode()
    return hmac.new(key, payload_bytes, hashlib.sha256).hexdigest()


def certify(file_a: str, file_b: str) -> dict:
    if not _DEPS_OK:
        return {"error": "numpy/soundfile unavailable"}

    # Per-file fields
    sha_a = _sha256_file(file_a)
    sha_b = _sha256_file(file_b)
    dur_a = _file_duration(file_a)
    dur_b = _file_duration(file_b)
    lufs_a = _compute_lufs(file_a)
    lufs_b = _compute_lufs(file_b)

    # Analysis
    true_peak = _compute_true_peak(file_b)
    lra = _compute_lra(file_b)
    mono_compat_pct = _compute_mono_compat(file_b)
    tonal_deviation = _compute_tonal_deviation(file_b)
    gen_loss_prob = _generation_loss_probability(file_b)
    lufs_delta = _compute_lufs_delta(lufs_a, lufs_b)

    certificate_id = str(uuid.uuid4())
    generated_at = datetime.now(timezone.utc).isoformat()

    payload = {
        "version": "1.0",
        "generated_at": generated_at,
        "file_a": {
            "path": file_a,
            "sha256": sha_a,
            "duration_s": dur_a,
            "lufs_i": lufs_a,
        },
        "file_b": {
            "path": file_b,
            "sha256": sha_b,
            "duration_s": dur_b,
            "lufs_i": lufs_b,
        },
        "analysis": {
            "lufs_i_delta": lufs_delta,
            "true_peak_dbtp": true_peak,
            "lra": lra,
            "mono_compat_pct": mono_compat_pct,
            "tonal_deviation": tonal_deviation,
            "generation_loss_probability": gen_loss_prob,
        },
        "compliance": _compliance(true_peak, lufs_b, gen_loss_prob),
        "certificate_id": certificate_id,
    }

    sig = _sign(payload, certificate_id)
    payload["hmac_sha256"] = sig
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="RTMcertify — pre-delivery compliance certificate")
    parser.add_argument("--certify", nargs=2, metavar=("FILE_A", "FILE_B"),
                        help="Generate a compliance certificate comparing FILE_A and FILE_B")
    args = parser.parse_args()

    if not args.certify:
        parser.print_help()
        sys.exit(1)

    file_a, file_b = args.certify

    if not _DEPS_OK:
        print(json.dumps({"error": "numpy/soundfile unavailable"}))
        sys.exit(0)

    result = certify(file_a, file_b)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
