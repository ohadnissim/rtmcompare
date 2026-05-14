"""
Reference quality check with custom tonal analysis.

Uses a target curve derived from 75 real mastered tracks to measure
how far the reference deviates from a typical professional master.

This is NOT a target to mix to — it's a sanity check that tells you
"how does this file compare to a typical mastered track" so the user
can contextualize the results.
"""

import numpy as np
import librosa
from scipy.signal import butter, sosfilt


# ─── Harman-inspired neutral curve for music production ───────────────────────
# 31-band ISO center frequencies
FREQS = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
    200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
    2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
]

# Target curve: dB offset relative to 1kHz (= 0 dB)
# Designed for MUSIC PRODUCTION — what a well-balanced mix looks like
# across genres (pop, hip-hop, rock, electronic averaged together).
#
# Freq:  20   25   31   40   50   63   80  100  125  160
#       200  250  315  400  500  630  800   1k 1.25k 1.6k
#        2k 2.5k 3.15k 4k   5k 6.3k  8k  10k 12.5k 16k  20k
NEUTRAL_CURVE = [
    # Custom target curve derived from 75 mastered tracks
    # Reflects real-world mastering balance (not generic Harman)
    #  20    25   31.5   40    50    63    80   100   125   160
    -29.2, -13.1, -2.3, +4.9, +7.7, +7.4, +5.6, +4.9, +4.3, +3.3,
    # 200   250   315   400   500   630   800   1k  1.25k  1.6k
    +3.5, +3.5, +3.1, +2.9, +3.1, +2.7, +1.6, +0.0, -1.0, -0.9,
    #  2k  2.5k 3.15k   4k    5k  6.3k   8k   10k 12.5k  16k   20k
    -2.5, -3.6, -4.6, -5.8, -7.0, -6.2, -6.2, -6.7, -9.2, -15.3, -24.5,
]

# How much deviation per band before it's "notable" vs "extreme"
# Lower = stricter. These account for genre variation.
TOLERANCE_NOTABLE = 4.0  # dB — "your mix is a bit bass-heavy"
TOLERANCE_EXTREME = 8.0  # dB — "this is way off neutral"


def format_time(seconds):
    mins = int(seconds // 60)
    secs = seconds % 60
    return f"{mins}:{secs:05.2f}"


def bandpass_rms_db(y, sr, low, high):
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
        return float(20 * np.log10(max(rms, 1e-10)))
    except:
        return -70.0


def estimate_tempo_drift(y: np.ndarray, sr: int) -> dict:
    """
    Returns a coarse tempo-over-time curve (seconds → BPM) and a drift score.

    Splits the track into ~30-second windows with 10-second overlap, runs
    librosa.beat.beat_track on each window, and reports median + range.

    Drift flag is set when the tempo range across windows exceeds 3 BPM —
    a useful signal when a mix was bounced from a tempo-mapped session.
    """
    try:
        total = len(y)
        if total < sr * 30:
            # Too short for drift analysis
            return {"timeline": [], "range_bpm": 0.0, "drift": False, "median_bpm": 0.0}
        win = sr * 30
        hop = sr * 10
        timeline = []
        tempos = []
        for start in range(0, total - win + 1, hop):
            seg = y[start:start + win]
            try:
                onset = librosa.onset.onset_strength(y=seg, sr=sr, hop_length=512, aggregate=np.median)
                t = librosa.beat.beat_track(onset_envelope=onset, sr=sr, hop_length=512)[0]
                t_val = float(t[0]) if hasattr(t, '__len__') and len(t) > 0 else float(t)
                if 40 < t_val < 300:
                    timeline.append({"time": round(start / sr, 1), "bpm": round(t_val, 1)})
                    tempos.append(t_val)
            except Exception:
                pass
        if not tempos:
            return {"timeline": [], "range_bpm": 0.0, "drift": False, "median_bpm": 0.0}
        tempos = np.asarray(tempos)
        # Normalise octave errors: if a value is ~half / ~double of the median,
        # snap it — common autocorrelation artefact on sparse sections.
        median_bpm = float(np.median(tempos))
        snapped = []
        for t in tempos:
            if median_bpm > 0 and abs(t * 2 - median_bpm) < abs(t - median_bpm):
                t = t * 2
            elif median_bpm > 0 and abs(t / 2 - median_bpm) < abs(t - median_bpm):
                t = t / 2
            snapped.append(t)
        snapped = np.asarray(snapped)
        range_bpm = float(np.max(snapped) - np.min(snapped))

        # ── P2 refinement: distinguish "real drift" from "one off window" ──
        # A single quiet/sparse section can autocorrelate poorly and produce a
        # spurious outlier. Only flag drift when the INTERQUARTILE range is
        # also > 2 BPM (i.e. the middle half of windows genuinely scatter),
        # AND more than 25% of windows are > 2 BPM from the median.
        median = float(np.median(snapped))
        q1, q3 = np.percentile(snapped, [25, 75])
        iqr_bpm = float(q3 - q1)
        pct_off = float(np.mean(np.abs(snapped - median) > 2.0))
        # Update timeline to reflect snapped values so the chart matches the median
        for i, t in enumerate(snapped):
            if i < len(timeline):
                timeline[i]["bpm"] = round(float(t), 1)

        drift_flag = range_bpm > 3.0 and iqr_bpm > 2.0 and pct_off > 0.25

        return {
            "timeline": timeline,
            "range_bpm": round(range_bpm, 1),
            "iqr_bpm": round(iqr_bpm, 1),
            "drift": drift_flag,
            "median_bpm": round(median, 1),
        }
    except Exception:
        return {"timeline": [], "range_bpm": 0.0, "drift": False, "median_bpm": 0.0}


def _estimate_bpm_robust(y: np.ndarray, sr: int) -> float:
    """
    Robust BPM estimation using multi-method consensus.

    Combines three signals and resolves octave errors:
      1. Onset-envelope autocorrelation tempogram (median across frames).
      2. Beat-tracker report (with dynamic programming).
      3. Inter-beat-interval median from detected beats.

    Resolves half/double errors by choosing the candidate in the musically
    plausible range (65-190 BPM) with the strongest onset-envelope support.
    """
    try:
        # Work on a middle section to avoid intros/outros skewing tempo
        total = len(y)
        if total > sr * 60:
            start = total // 4
            end = start + sr * 60  # 60s window from 25% mark
            y_use = y[start:end]
        else:
            y_use = y

        # Onset strength envelope — use a small hop for accuracy
        hop_length = 512
        onset_env = librosa.onset.onset_strength(y=y_use, sr=sr, hop_length=hop_length, aggregate=np.median)

        if len(onset_env) < 10 or np.max(onset_env) < 1e-6:
            return 0.0

        # Method 1: global tempo from beat_track
        try:
            tempo_bt, beats = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr, hop_length=hop_length)
            tempo_bt = float(tempo_bt[0]) if hasattr(tempo_bt, '__len__') and len(tempo_bt) > 0 else float(tempo_bt)
        except Exception:
            tempo_bt, beats = 0.0, np.array([])

        # Method 2: aggregate tempo from tempogram (median of per-frame estimates)
        try:
            per_frame = librosa.feature.tempo(onset_envelope=onset_env, sr=sr, hop_length=hop_length, aggregate=None)
            per_frame = np.asarray(per_frame).flatten()
            per_frame = per_frame[np.isfinite(per_frame) & (per_frame > 0)]
            tempo_tg = float(np.median(per_frame)) if len(per_frame) > 0 else 0.0
        except Exception:
            tempo_tg = 0.0

        # Method 3: inter-beat-interval median
        tempo_ibi = 0.0
        if len(beats) > 4:
            ibi = np.diff(beats) * hop_length / sr  # seconds between beats
            ibi = ibi[(ibi > 0.2) & (ibi < 1.2)]  # plausible range
            if len(ibi) > 2:
                tempo_ibi = 60.0 / float(np.median(ibi))

        candidates = [c for c in [tempo_bt, tempo_tg, tempo_ibi] if 30 < c < 300]
        if not candidates:
            return 0.0

        # Octave normalization: generate all /2, *2 variants, pick the one
        # in the musically plausible range with best onset correlation support.
        primary = float(np.median(candidates))

        # Build candidate set with octave variants
        variants = set()
        for c in candidates:
            for mult in [0.5, 1.0, 2.0]:
                v = c * mult
                if 60 < v < 200:
                    variants.add(round(v, 1))

        if not variants:
            return round(primary, 1)

        # Score each variant by how well its period matches the onset autocorrelation
        ac = librosa.autocorrelate(onset_env, max_size=int(sr * 2.0 / hop_length))
        ac = ac / (np.max(np.abs(ac)) + 1e-10)

        best_tempo = primary
        best_score = -1.0
        for bpm_cand in variants:
            period_frames = int(60.0 * sr / (bpm_cand * hop_length))
            if period_frames < 2 or period_frames >= len(ac):
                continue
            # Sum energy at the period and its first 2 harmonics
            score = ac[period_frames]
            if period_frames * 2 < len(ac):
                score += 0.5 * ac[period_frames * 2]
            # Prefer the 80-160 range (typical pop/hip-hop/rock)
            if 80 <= bpm_cand <= 160:
                score *= 1.15
            if score > best_score:
                best_score = float(score)
                best_tempo = bpm_cand

        return round(float(best_tempo), 1)

    except Exception:
        # Fallback to librosa default
        try:
            t = librosa.beat.beat_track(y=y, sr=sr)[0]
            return round(float(t[0]) if hasattr(t, '__len__') else float(t), 1)
        except Exception:
            return 0.0


def check_reference(path: str, sr: int = None) -> dict:
    """
    Full reference quality check including Harman-inspired tonal analysis.
    """
    y, sr = librosa.load(path, sr=sr, mono=False)
    if y.ndim == 1:
        y = np.stack([y, y])

    mono = librosa.to_mono(y)
    warnings = []

    # ─── Basic checks ─────────────────────────────────────────────────────

    # Level — use proper ITU-R BS.1770 LUFS measurement
    from comparator import compute_lufs
    lufs = compute_lufs(y, sr)

    if lufs < -24:
        warnings.append({
            "type": "level",
            "severity": "warning",
            "message": f"Reference is very quiet ({lufs:.1f} LUFS) — might be an unfinished rough or demo with low gain staging.",
            "suggestion": "Consider normalizing or using a louder version for a more meaningful comparison.",
        })
    elif lufs > -6:
        warnings.append({
            "type": "level",
            "severity": "warning",
            "message": f"Reference is extremely hot ({lufs:.1f} LUFS) — might already be heavily limited.",
            "suggestion": "Comparing two limited files may not show meaningful differences.",
        })

    # ── Clipping — unified threshold with distortion_detector ──────────────
    # Count a clipped REGION only when 3+ consecutive samples sit at ceiling
    # (≥ 0.9995). This eliminates single-sample spikes from DSP headroom and
    # matches the distortion_detector definition so both panels agree.
    clip_mask = np.abs(mono) >= 0.9995
    clip_regions = []

    if int(np.sum(clip_mask)) > 0:
        in_clip = False
        region_start = 0
        run_len = 0
        min_gap = int(sr * 0.05)
        last_end = 0

        for i in range(len(clip_mask)):
            if clip_mask[i]:
                if not in_clip:
                    region_start = i
                    run_len = 1
                    in_clip = True
                else:
                    run_len += 1
            elif in_clip:
                in_clip = False
                if run_len >= 3:
                    start_time = region_start / sr
                    end_time = i / sr
                    samples = run_len
                    if clip_regions and (region_start - last_end) < min_gap:
                        clip_regions[-1]["end"] = round(end_time, 3)
                        clip_regions[-1]["end_formatted"] = format_time(end_time)
                        clip_regions[-1]["samples"] += samples
                    else:
                        clip_regions.append({
                            "start": round(start_time, 3),
                            "end": round(end_time, 3),
                            "start_formatted": format_time(start_time),
                            "end_formatted": format_time(end_time),
                            "samples": samples,
                        })
                    last_end = i
                run_len = 0
        clip_regions.sort(key=lambda r: r["samples"], reverse=True)
        clip_regions = clip_regions[:30]
        clip_regions.sort(key=lambda r: r["start"])

    # Clip count = total samples inside confirmed regions
    clip_count = sum(r["samples"] for r in clip_regions)

    if clip_count > 100:
        warnings.append({
            "type": "clipping",
            "severity": "warning",
            "message": f"Reference has {clip_count} clipped samples in {len(clip_regions)} regions.",
            "suggestion": "Distortion analysis may reflect issues already present in the reference.",
        })

    # Stereo
    left, right = y[0], y[1]
    denom = float(np.sqrt(np.sum(left**2) * np.sum(right**2)))
    # 5.3.1 honesty fix: undefined correlation when energy is sub-floor.
    if denom < 1e-9:
        correlation = 0.0
    else:
        correlation = float(np.clip(np.sum(left * right) / denom, -1.0, 1.0))

    if correlation > 0.99:
        warnings.append({
            "type": "stereo",
            "severity": "info",
            "message": "Reference is essentially mono (L/R correlation > 0.99).",
            "suggestion": "Stereo width and panning comparisons won't be meaningful.",
        })
    elif correlation < 0.3:
        warnings.append({
            "type": "stereo",
            "severity": "warning",
            "message": f"Very wide stereo image (correlation {correlation:.2f}) — possible phase issues.",
            "suggestion": "Check the reference in mono — if it sounds thin, there may be phase cancellation.",
        })

    # Dynamic range — use pyloudnorm LRA (EBU R128)
    from comparator import compute_dynamic_range
    dynamic_range = compute_dynamic_range(y, sr)

    if dynamic_range > 0:
        if dynamic_range < 2:
            warnings.append({
                "type": "dynamics",
                "severity": "warning",
                "message": f"Very low loudness range ({dynamic_range:.1f} LU) — heavily compressed.",
                "suggestion": "Dynamics comparisons may not show much.",
            })
        elif dynamic_range > 15:
            warnings.append({
                "type": "dynamics",
                "severity": "info",
                "message": f"Very high loudness range ({dynamic_range:.1f} LU) — could be a raw recording.",
                "suggestion": "Expect large compression differences vs a mixed/mastered file.",
            })

    # ─── Harman tonal analysis ────────────────────────────────────────────

    # Measure each band
    measured = []
    for i, freq in enumerate(FREQS):
        low = freq / (2 ** (1/6))
        high = freq * (2 ** (1/6))
        level = bandpass_rms_db(mono, sr, low, high)
        measured.append(level)

    # Normalize: set 1 kHz as 0 dB reference (band index 17)
    ref_level = measured[17] if measured[17] > -60 else -20
    measured_norm = [m - ref_level for m in measured]

    # Compare against neutral curve
    deviations = []
    for i in range(len(FREQS)):
        if measured[i] < -55:  # skip dead bands
            deviations.append(0.0)
            continue
        dev = measured_norm[i] - NEUTRAL_CURVE[i]
        deviations.append(round(dev, 1))

    # Identify notable deviations
    tonal_notes = []
    regions = [
        ("Sub bass", 0, 6, "20-80 Hz"),
        ("Bass", 6, 10, "80-200 Hz"),
        ("Low mids", 10, 14, "200-500 Hz"),
        ("Mids", 14, 18, "500-1.6k Hz"),
        ("Presence", 18, 23, "1.6-4k Hz"),
        ("Brilliance", 23, 27, "4-10k Hz"),
        ("Air", 27, 31, "10-20k Hz"),
    ]

    for name, start, end, freq_range in regions:
        region_devs = deviations[start:end]
        if not region_devs:
            continue
        avg_dev = np.mean(region_devs)

        if abs(avg_dev) > TOLERANCE_EXTREME:
            tonal_notes.append({
                "region": name,
                "freq_range": freq_range,
                "deviation": round(float(avg_dev), 1),
                "severity": "extreme",
                "description": f"{name} is {abs(avg_dev):.1f} dB {'above' if avg_dev > 0 else 'below'} target",
            })
        elif abs(avg_dev) > TOLERANCE_NOTABLE:
            tonal_notes.append({
                "region": name,
                "freq_range": freq_range,
                "deviation": round(float(avg_dev), 1),
                "severity": "notable",
                "description": f"{name} is {abs(avg_dev):.1f} dB {'above' if avg_dev > 0 else 'below'} target — {'more present' if avg_dev > 0 else 'more recessed'} than a typical balanced mix",
            })

    # Overall tonal character
    low_avg = np.mean(deviations[0:10])
    mid_avg = np.mean(deviations[10:20])
    high_avg = np.mean(deviations[20:31])

    if low_avg > 3 and high_avg < -3:
        character = "Dark and warm — heavy low end, rolled-off highs"
    elif low_avg < -3 and high_avg > 3:
        character = "Bright and thin — light low end, boosted highs"
    elif low_avg > 3 and high_avg > 3:
        character = "Scooped mids — V-shaped curve with boosted lows and highs"
    elif low_avg < -3 and high_avg < -3:
        character = "Mid-forward — prominent mids, recessed lows and highs"
    elif abs(low_avg) < 2 and abs(mid_avg) < 2 and abs(high_avg) < 2:
        character = "Well-balanced — close to target across the spectrum"
    else:
        parts = []
        if low_avg > 2: parts.append("bass-heavy")
        elif low_avg < -2: parts.append("light on bass")
        if high_avg > 2: parts.append("bright")
        elif high_avg < -2: parts.append("dark")
        character = " and ".join(parts).capitalize() if parts else "Fairly balanced"

    # Add tonal warnings — softer wording, these are common in demos
    for note in tonal_notes:
        if note["severity"] == "extreme":
            warnings.append({
                "type": "tonal",
                "severity": "info",
                "message": note["description"],
                "suggestion": f"The {note['region'].lower()} ({note['freq_range']}) deviates from the target curve.",
            })

    # Overall status — only hard issues (clipping, level, stereo) count as warnings
    # Tonal deviations are info-level since demos are expected to be rough
    warning_count = len([w for w in warnings if w["severity"] == "warning"])
    if warning_count >= 3:
        status = "poor"
        summary = "The reference has several technical issues that may affect comparison accuracy."
    elif warning_count >= 1:
        status = "fair"
        summary = "The reference has some issues — results are still useful but take flagged areas with a grain of salt."
    else:
        status = "good"
        summary = "Reference quality looks good."

    # ─── BPM, Key and Genre detection ──────────────────────────────────────
    # BPM — robust tempo estimation using multi-method consensus
    bpm = _estimate_bpm_robust(mono, sr)

    # Tempo drift over time (flags variable-tempo or live-recorded tracks)
    tempo_drift = estimate_tempo_drift(mono, sr)

    # Reconcile: drift analysis uses sliding windows with octave-snapping, so its
    # median is MORE reliable than the single-pass estimate. We now ALWAYS prefer
    # the drift median when it's available (fixes the half-time hip-hop case
    # where single-pass reports 140 but the true tempo is 70).
    if tempo_drift and tempo_drift.get("median_bpm", 0) and 40 < tempo_drift["median_bpm"] < 250:
        drift_bpm = tempo_drift["median_bpm"]
        # If the single-pass is exactly ~2× or ~0.5× the drift median, prefer drift.
        # Otherwise if they disagree by > 2 BPM, also prefer drift.
        if (abs(drift_bpm * 2 - bpm) < 3 or
            abs(drift_bpm / 2 - bpm) < 3 or
            abs(drift_bpm - bpm) > 2):
            bpm = drift_bpm

    # 5.2.3 (beta-tester report): genre auto-detection removed because
    # `_estimate_genre` produced false readings on real-world masters
    # ("Hip-Hop" on a folk track, "EDM" on a singer-songwriter cut), and
    # nothing downstream acted on the value. 5.2.4: function definition
    # also deleted from this file. Whole feature gone.

    # ── Key detection using Krumhansl-Schmuckler key-profile correlation ──
    # This is the standard method used by Sonic Visualiser / Mixed In Key:
    # correlate the chroma vector against 24 key templates (12 major + 12 minor)
    # and pick the highest-correlating one. Also returns a confidence score
    # based on the margin between best and second-best match.
    chroma = librosa.feature.chroma_cqt(y=mono, sr=sr)
    chroma_avg = np.mean(chroma, axis=1)

    note_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    note_freqs = [261.63, 277.18, 293.66, 311.13, 329.63, 349.23, 369.99, 392.00, 415.30, 440.00, 466.16, 493.88]

    # Krumhansl-Kessler key profiles (empirical listener data, normalised)
    KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

    # Rotate profiles across all 12 tonic positions, correlate with observed chroma
    scores = []  # list of (corr, key_name, root_idx, mode)
    for rot in range(12):
        maj = np.roll(KK_MAJOR, rot)
        min_ = np.roll(KK_MINOR, rot)
        corr_maj = float(np.corrcoef(chroma_avg, maj)[0, 1]) if np.std(chroma_avg) > 0 else 0.0
        corr_min = float(np.corrcoef(chroma_avg, min_)[0, 1]) if np.std(chroma_avg) > 0 else 0.0
        scores.append((corr_maj, f"{note_names[rot]} major", rot, "major"))
        scores.append((corr_min, f"{note_names[rot]} minor", rot, "minor"))

    scores.sort(key=lambda x: x[0], reverse=True)
    best_corr, key_name, root_idx, scale = scores[0][0], scores[0][1], scores[0][2], scores[0][3]
    second_corr = scores[1][0]

    # Confidence = margin between best and second-best, scaled 0–1
    # Typical "clear" key: margin ≥ 0.08. "Ambiguous": margin < 0.04.
    margin = max(0.0, best_corr - second_corr)
    key_confidence = round(min(1.0, margin * 12.0) if best_corr > 0 else 0.0, 2)

    root_note = note_names[root_idx]
    root_freq = note_freqs[root_idx]
    key_freq = round(root_freq, 1)

    # Also expose the top 3 alternate key candidates — useful on modal/ambiguous tracks
    alt_keys = [{"key": k[1], "score": round(k[0], 3)} for k in scores[1:4]]

    # Generate all harmonics and sub-harmonics within audible range
    # These are the frequencies that resonate with the song's key
    # Useful for knowing where to cut/boost on EQ
    harmonics = []

    # Sub-harmonics (divide by 2 going down)
    freq = root_freq
    while freq >= 20:
        harmonics.append(freq)
        freq /= 2

    # Harmonics (multiply by 2 going up, plus odd harmonics)
    freq = root_freq * 2
    while freq <= 20000:
        harmonics.append(freq)
        freq *= 2

    # Also add the 3rd and 5th harmonics (musically important)
    for mult in [3, 5, 6, 7]:
        f = root_freq * mult
        if 20 <= f <= 20000:
            harmonics.append(f)
        # Sub octaves of these
        f2 = f / 2
        if 20 <= f2 <= 20000:
            harmonics.append(f2)

    # Also add scale notes (major or minor) across octaves
    if scale == "minor":
        intervals = [0, 2, 3, 5, 7, 8, 10]  # natural minor
    else:
        intervals = [0, 2, 4, 5, 7, 9, 11]  # major

    scale_freqs = []
    for octave_shift in [-2, -1, 0, 1, 2, 3]:
        for interval in intervals:
            f = root_freq * (2 ** (octave_shift + interval / 12))
            if 20 <= f <= 20000:
                scale_freqs.append({
                    "freq": round(f, 1),
                    "note": note_names[(root_idx + interval) % 12],
                    "octave": 4 + octave_shift,
                })

    # Deduplicate and sort harmonics
    harmonics = sorted(set([round(h, 1) for h in harmonics]))

    # Label the harmonics
    harmonic_labels = []
    for h in harmonics:
        ratio = h / root_freq
        if abs(ratio - round(ratio)) < 0.01:
            r = int(round(ratio))
            if r == 1:
                label = "Root"
            elif r >= 2 and (r & (r - 1)) == 0:
                # Power of 2 = octave
                octaves = int(np.log2(r))
                label = f"+{octaves} oct"
            else:
                label = f"{r}x"
        elif abs(ratio - 0.5) < 0.01:
            label = "-1 oct"
        elif abs(ratio - 0.25) < 0.01:
            label = "-2 oct"
        elif abs(ratio - 0.125) < 0.01:
            label = "-3 oct"
        else:
            label = f"{ratio:.1f}x"

        harmonic_labels.append({
            "freq": h,
            "label": label,
            "is_root": abs(ratio - 1.0) < 0.01,
            "is_octave": abs(ratio - round(ratio)) < 0.01 and round(ratio) > 0 and (int(round(ratio)) & (int(round(ratio)) - 1)) == 0,
        })

    return {
        "status": status,
        "summary": summary,
        "warnings": warnings,
        "song_info": {
            "bpm": bpm,
            "tempo_drift": tempo_drift,
            "key": key_name,
            "key_confidence": key_confidence,
            "key_alternates": alt_keys,
            "key_freq": key_freq,
            "root_note": root_note,
            "harmonics": harmonic_labels,
            "scale_freqs": scale_freqs[:40],  # limit
            # 5.2.3: "genre" key removed (was unreliable, see comment near
            # the call site).
        },
        "stats": {
            "lufs": round(lufs, 1),
            "dynamic_range": round(dynamic_range, 1),
            "stereo_correlation": round(correlation, 2),
            "clip_count": clip_count,
            "clip_regions": clip_regions,
        },
        "tonal": {
            "character": character,
            "measured": [round(m, 1) for m in measured_norm],
            "neutral_curve": NEUTRAL_CURVE,
            "deviations": deviations,
            "notes": tonal_notes,
            "freqs": [str(f) if f < 1000 else f"{f/1000:.1f}k" for f in FREQS],
        },
    }
