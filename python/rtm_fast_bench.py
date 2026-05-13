"""Benchmark harness comparing rtm_fast's native kernels against
pure-numpy + pyloudnorm reference implementations.

Run:
    ./python-bundle/python/bin/python3 python/rtm_fast_bench.py
"""
import os
import time
import numpy as np


def _bench(label, fn, *args, iters=5, warmup=2):
    # Warm-up triggers numba JIT on first call (amortised across iters)
    for _ in range(warmup):
        fn(*args)
    t0 = time.perf_counter()
    for _ in range(iters):
        res = fn(*args)
    elapsed = (time.perf_counter() - t0) / iters
    return elapsed, res


def main():
    # NIT-11: 44100 is the benchmark-only sample rate — intentionally fixed
    # so timing comparisons between runs are reproducible. Production paths
    # use sr=None (native) via librosa.load.
    sr = 44100
    # 60 seconds of synthetic stereo at full sample-rate
    n = sr * 60
    rng = np.random.default_rng(42)
    mono = rng.standard_normal(n).astype(np.float64) * 0.2
    # Force one clip for the clip-counter
    mono[sr // 2] = 1.0

    # ── Reference (pure numpy) ──────────────────────────────────────────
    def ref_peak_rms(x):
        peak = float(np.abs(x).max())
        rms = float(np.sqrt(np.mean(x * x)))
        clips = int(np.count_nonzero(np.abs(x) >= 0.999969482421875))
        return peak, rms, clips

    def ref_true_peak(x):
        import scipy.signal as sig
        up = sig.resample_poly(x, 4, 1)
        peak = float(np.abs(up).max())
        return 20.0 * np.log10(peak) if peak > 0 else -np.inf

    def ref_momentary(x, sr, block_ms=400):
        block = int(sr * block_ms / 1000)
        hop = block // 4
        starts = np.arange(0, x.size - block + 1, hop)
        out = np.empty(starts.size)
        for i, s in enumerate(starts):
            ms = float(np.mean(x[s : s + block] ** 2))
            out[i] = -70.0 if ms <= 1e-20 else 10.0 * np.log10(ms) - 0.691
        return out

    # ── Imports under test ──────────────────────────────────────────────
    from rtm_fast import peak_rms_pass, true_peak_dbtp, momentary_lufs_timeline

    print(f"\n{'Kernel':<30} {'rtm_fast':>12} {'reference':>12} {'speedup':>10}")
    print("-" * 70)

    # peak + rms + clips
    t_fast, r_fast = _bench("peak_rms_pass", peak_rms_pass, mono)
    t_ref, r_ref = _bench("ref peak+rms+clips", ref_peak_rms, mono)
    print(f"{'peak + rms + clips':<30} {t_fast*1000:>10.2f} ms {t_ref*1000:>10.2f} ms {t_ref/t_fast:>8.1f}x")
    assert abs(r_fast[0] - r_ref[0]) < 1e-9, r_fast
    assert abs(r_fast[1] - r_ref[1]) < 1e-9, r_fast
    assert r_fast[2] == r_ref[2], r_fast

    # true-peak
    t_fast, r_fast = _bench("true_peak_dbtp", true_peak_dbtp, mono)
    t_ref, r_ref = _bench("ref scipy true-peak", ref_true_peak, mono)
    print(f"{'true-peak (4x oversample)':<30} {t_fast*1000:>10.2f} ms {t_ref*1000:>10.2f} ms {t_ref/t_fast:>8.1f}x")
    # rtm_fast is the linear-interp approximation; reference is sinc-resample.
    # Tolerance 0.5 dB — that's the documented accuracy budget.
    assert abs(r_fast - r_ref) < 0.5, f"TP mismatch: fast={r_fast} ref={r_ref}"

    # momentary LUFS timeline
    t_fast, r_fast = _bench("momentary_lufs", momentary_lufs_timeline, mono, sr)
    t_ref, r_ref = _bench("ref momentary_lufs", ref_momentary, mono, sr)
    print(f"{'momentary LUFS (400 ms)':<30} {t_fast*1000:>10.2f} ms {t_ref*1000:>10.2f} ms {t_ref/t_fast:>8.1f}x")
    assert r_fast.shape == r_ref.shape
    assert np.allclose(r_fast, r_ref, atol=0.01)

    print()
    print("All correctness asserts passed.")


if __name__ == "__main__":
    main()
