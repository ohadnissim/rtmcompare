"""
Engineer profile system — "What would [Engineer] do?"

Loads a mastering engineer's profile (tonal curve, loudness, dynamics, width)
and generates specific mastering tips for a given file based on how that
engineer would approach it.
"""

import os
import json
import numpy as np
import librosa
from scipy.signal import butter, sosfilt
from comparator import compute_lufs, compute_stereo_width, compute_dynamic_range, compute_short_term_max, bandpass


PROFILES_DIR = os.path.join(os.path.dirname(__file__), 'profiles')
USER_PROFILES_DIR = os.path.join(os.path.expanduser('~'), '.rtm', 'profiles')


def _profile_dirs():
    """Return both profile directories, user-first so user profiles can shadow built-ins."""
    return [USER_PROFILES_DIR, PROFILES_DIR]


def _find_profile_path(profile_id: str):
    """Return the path to a profile JSON, checking user dir first, then built-in.
    Also accepts an absolute path for ad-hoc one-off loads."""
    if os.path.isabs(profile_id) and os.path.exists(profile_id):
        return profile_id
    for d in _profile_dirs():
        p = os.path.join(d, f"{profile_id}.json")
        if os.path.exists(p):
            return p
    return None

FREQS = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
    200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
    2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
]

FREQ_LABELS = [
    "20 Hz", "25 Hz", "31.5 Hz", "40 Hz", "50 Hz", "63 Hz", "80 Hz",
    "100 Hz", "125 Hz", "160 Hz", "200 Hz", "250 Hz", "315 Hz", "400 Hz",
    "500 Hz", "630 Hz", "800 Hz", "1 kHz", "1.25 kHz", "1.6 kHz",
    "2 kHz", "2.5 kHz", "3.15 kHz", "4 kHz", "5 kHz", "6.3 kHz",
    "8 kHz", "10 kHz", "12.5 kHz", "16 kHz", "20 kHz",
]

REGION_NAMES = {
    (0, 3): ("Sub", "20-40 Hz"),
    (3, 6): ("Low Bass", "40-63 Hz"),
    (6, 10): ("Bass", "80-160 Hz"),
    (10, 14): ("Low Mids", "200-400 Hz"),
    (14, 17): ("Mids", "500-800 Hz"),
    (17, 20): ("Upper Mids", "1-1.6 kHz"),
    (20, 23): ("Presence", "2-3.15 kHz"),
    (23, 26): ("Brilliance", "4-6.3 kHz"),
    (26, 29): ("Air", "8-12.5 kHz"),
    (29, 31): ("Ultra High", "16-20 kHz"),
}


def list_profiles():
    """List available engineer profiles from user dir and built-in dir."""
    profiles = []
    seen_ids = set()
    for d in _profile_dirs():
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith('.json'):
                continue
            profile_id = f.replace('.json', '')
            if profile_id in seen_ids:
                continue
            seen_ids.add(profile_id)
            try:
                with open(os.path.join(d, f)) as fh:
                    data = json.load(fh)
                    profiles.append({
                        "id": profile_id,
                        "name": data.get("name", profile_id),
                        "description": data.get("description", ""),
                        "sample_count": data.get("sample_count", 0),
                        "user_created": d == USER_PROFILES_DIR,
                    })
            except Exception:
                pass
    return profiles


def load_profile(profile_id):
    """Load an engineer profile by ID (user dir first, then built-in)."""
    path = _find_profile_path(profile_id)
    if not path:
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None


def compute_spectrum(y, sr):
    """Compute 31-band ISO spectrum in dB, normalized to 1kHz."""
    nyq = sr / 2
    levels = []
    for freq in FREQS:
        low = freq / (2 ** (1/6))
        high = freq * (2 ** (1/6))
        low_n = max(low / nyq, 0.001)
        high_n = min(high / nyq, 0.999)
        if low_n >= high_n:
            levels.append(-70.0)
            continue
        sos = butter(4, [low_n, high_n], btype='band', output='sos')
        filtered = sosfilt(sos, y)
        rms = np.sqrt(np.mean(filtered ** 2))
        levels.append(float(20 * np.log10(max(rms, 1e-10))))
    # Normalize to 1kHz
    ref = levels[17]
    return [l - ref for l in levels]


def _compute_ms_tips(y_stereo, sr):
    """
    Compare mid (L+R) vs side (L-R) spectra and flag obvious mastering
    moves: side too loud in the bass (→ sum bass to mono), side too quiet
    in the air (→ widen reverbs/cymbals), mid heavy vocal band, etc.

    Returns a list of structured tips that slot into the engineer-tips list.
    """
    tips = []
    try:
        if y_stereo.ndim < 2 or y_stereo.shape[0] != 2:
            return tips
        mid  = (y_stereo[0] + y_stereo[1]) / 2.0
        side = (y_stereo[0] - y_stereo[1]) / 2.0

        mid_spec  = compute_spectrum(mid, sr)   # normalised to 1kHz of mid
        side_spec = compute_spectrum(side, sr)  # normalised to 1kHz of side

        # Side-over-mid differential, averaged by region
        # (this is not a perfect M/S analysis — we're asking: is the side
        #  channel carrying too much / too little compared to a typical
        #  well-balanced master, in each region?)
        regions = [
            (0, 6,   "Sub/Bass",    "20-80 Hz",     -10, None,  "side_bass_high",
             "Too much sub/bass energy in the SIDE channel — bass will cancel on phones/clubs",
             "Use a stereo imager or Elliptical EQ to mono-ise below 120 Hz"),
            (6, 10,  "Bass",        "80-200 Hz",    -8,  None,  "side_bass_mid_high",
             "Side channel is hot in bass range — possible mono-collapse issues",
             "Narrow the stereo image below 200 Hz (Ozone Imager, Brainworx, or any M/S tool)"),
            (10, 14, "Low Mids",    "200-500 Hz",   None, None, None, "", ""),
            (14, 18, "Mids",        "500-1.6k Hz",  None, None, None, "", ""),
            (18, 23, "Presence",    "1.6-4k Hz",   None, None, None, "", ""),
            (23, 27, "Brilliance",  "4-10k Hz",    None, None, None, "", ""),
            (27, 31, "Air",         "10-20k Hz",   None, -14,   "side_air_low",
             "Side channel is dull in the air band — cymbals/reverbs lack stereo spark",
             "Subtle high-shelf boost on the SIDE channel above 8 kHz, or add a stereo exciter"),
        ]
        for start, end, name, fr, side_hi, side_lo, kind, tip_msg, detail in regions:
            if not kind:
                continue
            avg_side = float(np.mean(side_spec[start:min(end, len(side_spec))]))
            avg_mid  = float(np.mean(mid_spec[start:min(end, len(mid_spec))]))
            if kind.startswith("side_bass"):
                # Flag when the side band sits above this threshold AND is
                # close to / louder than the mid band
                if avg_side > side_hi and (avg_side - avg_mid) > -3:
                    tips.append({
                        "category": f"M/S — {name}",
                        "priority": "medium",
                        "tip": tip_msg,
                        "detail": detail,
                    })
            elif kind == "side_air_low":
                if avg_side < side_lo and (avg_mid - avg_side) > 6:
                    tips.append({
                        "category": f"M/S — {name}",
                        "priority": "low",
                        "tip": tip_msg,
                        "detail": detail,
                    })
    except Exception:
        pass
    return tips


def generate_tips(file_b_path, file_a_path, profile_id="ohad", sr=44100):
    """
    Generate "What would [Engineer] do?" tips.

    Analyzes file_b (the compare file) against the engineer's profile,
    taking into account file_a (the reference) as context.

    Returns:
        {
            "engineer": str,
            "tips": [{ "category": str, "priority": str, "tip": str, "detail": str }],
            "tonal_diff": [{ "region": str, "freq_range": str, "diff_db": float, "direction": str }],
            "summary": str,
        }
    """
    profile = load_profile(profile_id)
    if not profile:
        return {"engineer": profile_id, "tips": [], "tonal_diff": [], "summary": "Profile not found."}

    engineer_name = profile.get("name", profile_id)
    curve = profile["curve"]

    # Load file B (the compare/master file)
    y_b, _ = librosa.load(file_b_path, sr=sr, mono=False)
    if y_b.ndim == 1:
        y_b = np.stack([y_b, y_b])
    mono_b = librosa.to_mono(y_b)

    # Load file A (reference/mix) for context
    y_a, _ = librosa.load(file_a_path, sr=sr, mono=False)
    if y_a.ndim == 1:
        y_a = np.stack([y_a, y_a])
    mono_a = librosa.to_mono(y_a)

    # Compute file B metrics
    spec_b = compute_spectrum(mono_b, sr)
    lufs_b = compute_lufs(y_b, sr)
    dr_b = compute_dynamic_range(y_b, sr)
    width_b = compute_stereo_width(y_b[0], y_b[1])
    # True peak with 4x oversampling
    from scipy.signal import resample_poly
    up_l = resample_poly(y_b[0] if y_b.ndim > 1 else y_b, 4, 1)
    up_r = resample_poly(y_b[1] if y_b.ndim > 1 and y_b.shape[0] > 1 else y_b, 4, 1)
    peak_b = float(20 * np.log10(max(np.max(np.abs(up_l)), np.max(np.abs(up_r)), 1e-10)))
    st_max_b = compute_short_term_max(y_b, sr)

    # Compute file A metrics for context
    spec_a = compute_spectrum(mono_a, sr)
    lufs_a = compute_lufs(y_a, sr)

    tips = []
    tonal_diffs = []

    # ─── Dynamic range tips ──────────────────────────────────────────
    # Measured as EBU R128 LRA (Loudness Range) in LU.
    target_dr = profile["dynamic_range_avg"]
    dr_diff = dr_b - target_dr

    if dr_diff < -4:
        tips.append({
            "category": "Dynamics",
            "priority": "high",
            "tip": f"Over-compressed — your LRA is {dr_b:.1f} LU, {engineer_name} averages {target_dr:.1f} LU",
            "detail": "Ease off the compressor/limiter. Let transients breathe — modern masters usually live between 5–8 LU.",
        })
    elif dr_diff > 4:
        tips.append({
            "category": "Dynamics",
            "priority": "medium",
            "tip": f"Very dynamic — your LRA is {dr_b:.1f} LU, {engineer_name} averages {target_dr:.1f} LU",
            "detail": "This may be intentional, but some gentle bus compression (1–2 dB GR) can add glue.",
        })
    elif abs(dr_diff) > 2:
        direction = "tighter" if dr_diff < 0 else "more open"
        tips.append({
            "category": "Dynamics",
            "priority": "low",
            "tip": f"Dynamics are {direction} than typical — {dr_b:.1f} LU vs {target_dr:.1f} LU target",
            "detail": f"Not far off. {'A touch less limiting' if dr_diff < 0 else 'A touch of compression'} would bring it closer.",
        })

    # ─── Stereo width tips ───────────────────────────────────────────
    target_width = profile["width_avg"]
    width_diff = width_b - target_width

    # Turn the raw side/total ratio into language the reader can actually use.
    def _describe_width(w):
        if w < 0.03: return "near-mono"
        if w < 0.08: return "tight"
        if w < 0.15: return "balanced"
        if w < 0.25: return "wide"
        if w < 0.40: return "very wide"
        return "extreme (side-channel heavy)"

    desc_b = _describe_width(width_b)
    desc_target = _describe_width(target_width)

    if width_diff < -0.05:
        tips.append({
            "category": "Stereo Width",
            "priority": "medium",
            "tip": f"Narrower than target — your mix reads as {desc_b}, {engineer_name} averages {desc_target}",
            "detail": "Consider subtle stereo widening on the mix bus, or widen specific elements (reverbs, synth pads). Avoid widening the low end.",
        })
    elif width_diff > 0.08:
        tips.append({
            "category": "Stereo Width",
            "priority": "medium",
            "tip": f"Wider than target — your mix reads as {desc_b}, {engineer_name} averages {desc_target}",
            "detail": "Check mono compatibility. Very wide masters lose energy on phone speakers and in clubs. Tighten low-mid widening first.",
        })


    # ─── Tonal balance tips (per region) ─────────────────────────────
    # Pre-compute the parametric EQ filters so we can quote freq + Q directly
    # in the tip text — readers shouldn't have to cross-reference a chart to
    # know "what Q" the suggestion implies.
    pre_filters = _compute_eq_filters(spec_b, curve)
    filter_by_region = {f["region"]: f for f in pre_filters}

    def _fmt_freq(hz):
        if hz >= 1000:
            return f"{hz/1000:.1f} kHz".replace(".0 kHz", " kHz")
        return f"{int(hz)} Hz"

    for (start, end), (region_name, freq_range) in REGION_NAMES.items():
        if start >= len(spec_b) or start >= len(curve):
            continue
        avg_file = np.mean(spec_b[start:end])
        avg_target = np.mean(curve[start:end])
        diff = avg_file - avg_target

        if abs(diff) > 1.5:
            tonal_diffs.append({
                "region": region_name,
                "freq_range": freq_range,
                "diff_db": round(float(diff), 1),
                "direction": "above" if diff > 0 else "below",
            })

        # Build the move-string with exact center freq + Q from the filter we'd apply.
        filt = filter_by_region.get(region_name)
        move_str = ""
        if filt:
            q_val = filt["q"]
            q_note = filt.get("q_note", "")
            move_str = f" at {_fmt_freq(filt['freq'])}, Q {q_val:.1f}" + (f" ({q_note})" if q_note else "")

        if abs(diff) > 3:
            direction = "boost" if diff < 0 else "cut"
            suggested_db = abs(diff) / 2
            tips.append({
                "category": f"EQ — {region_name}",
                "priority": "high" if abs(diff) > 5 else "medium",
                "tip": f"{region_name} ({freq_range}) is {abs(diff):.1f} dB {'hot' if diff > 0 else 'light'} — "
                       f"consider a {suggested_db:.1f} dB {direction}{move_str}",
                "detail": f"Compared to {engineer_name}'s curve, the {freq_range} range needs {'taming' if diff > 0 else 'a lift'}." +
                          (f" Suggested EQ: {direction} {suggested_db:.1f} dB at {_fmt_freq(filt['freq'])} with Q {filt['q']:.1f}." if filt else ""),
                "eq_move": filt,  # machine-readable form for the UI
            })
        elif abs(diff) > 1.5:
            direction = "cut" if diff > 0 else "boost"
            suggested_db = abs(diff) / 2
            tips.append({
                "category": f"EQ — {region_name}",
                "priority": "low",
                "tip": f"{region_name} ({freq_range}) is {abs(diff):.1f} dB {'above' if diff > 0 else 'below'} target"
                       + (f" — gentle {suggested_db:.1f} dB {direction}{move_str}" if filt else ""),
                "detail": f"Minor — a gentle {direction} of {suggested_db:.1f} dB would bring it closer to {engineer_name}'s balance." +
                          (f" Suggested EQ: {direction} {suggested_db:.1f} dB at {_fmt_freq(filt['freq'])} with Q {filt['q']:.1f}." if filt else ""),
                "eq_move": filt,
            })

    # ─── M/S diagnostic tips (stereo-specific) ───────────────────────
    try:
        ms_tips = _compute_ms_tips(y_b, sr)
        tips.extend(ms_tips)
    except Exception:
        pass

    # ─── Sort tips by priority ───────────────────────────────────────
    priority_order = {"high": 0, "medium": 1, "low": 2}
    tips.sort(key=lambda t: priority_order.get(t["priority"], 2))

    # ─── Summary ─────────────────────────────────────────────────────
    high_count = sum(1 for t in tips if t["priority"] == "high")
    med_count = sum(1 for t in tips if t["priority"] == "medium")

    if high_count == 0 and med_count == 0:
        summary = f"This file is already very close to {engineer_name}'s style. Minor tweaks at most."
    elif high_count == 0:
        summary = f"Good shape overall. A few adjustments would bring it closer to {engineer_name}'s signature sound."
    else:
        areas = list(set(t["category"].split(" — ")[0] for t in tips if t["priority"] == "high"))
        summary = f"Focus on {', '.join(areas[:3])}. {high_count} key adjustment{'s' if high_count > 1 else ''} to match {engineer_name}'s approach."

    return {
        "engineer": engineer_name,
        "profile_id": profile_id,
        "tips": tips,
        "tonal_diff": tonal_diffs,
        "summary": summary,
        "file_stats": {
            "lufs": round(lufs_b, 1),
            "short_term_max": round(st_max_b, 1),
            "true_peak": round(peak_b, 1),
            "dynamic_range": round(dr_b, 1),
            "width": round(float(width_b), 3),
        },
        "target_stats": {
            "lufs": profile["lufs_avg"],
            "dynamic_range": profile["dynamic_range_avg"],
            "width": profile["width_avg"],
        },
        "spectrum_file": [round(v, 1) for v in spec_b],
        "spectrum_target": [round(v, 1) for v in curve],
        "spectrum_corrected": [round(float(spec_b[i] - (spec_b[i] - curve[i]) * 0.6), 1) for i in range(len(spec_b))],
        "freqs": FREQ_LABELS,
        "eq_filters": _compute_eq_filters(spec_b, curve),
        "match_score": _compute_match_score(spec_b, curve, lufs_b, dr_b, width_b, profile),
    }


def _compute_eq_filters(spec_file, spec_target):
    """
    Compute parametric EQ filter bands to move file toward target.

    Q is chosen based on the *width* of the deviation — a narrow, pointy
    deviation (single band jumps while neighbours are fine) gets a tight Q;
    a broad tilt across the region gets a wide Q. This mirrors how mastering
    engineers actually cut / boost — tight for resonances, wide for tonal shifts.

    Returns list of {freq, gain_db, q, region, q_note} for BiquadFilterNode.
    """
    filters = []
    arr = np.asarray(spec_file)
    tgt = np.asarray(spec_target)

    for (start, end), (region_name, freq_range) in REGION_NAMES.items():
        if start >= len(arr) or start >= len(tgt):
            continue
        region_end = min(end, len(arr), len(tgt))
        avg_file = float(np.mean(arr[start:region_end]))
        avg_target = float(np.mean(tgt[start:region_end]))
        diff = avg_target - avg_file  # positive = need boost, negative = need cut

        if abs(diff) < 1.0:
            continue

        # Find the band within the region with the most extreme deviation
        # → use that as the center frequency, not the region center.
        band_diffs = tgt[start:region_end] - arr[start:region_end]
        if len(band_diffs) == 0:
            continue
        peak_idx_local = int(np.argmax(np.abs(band_diffs)))
        peak_idx = start + peak_idx_local
        freq = FREQS[min(peak_idx, len(FREQS) - 1)]

        # Apply 60% of the correction (don't over-correct)
        gain = round(diff * 0.6, 1)

        # ── Q selection — based on how localised the deviation is ────────
        # Compute how "pointy" the peak band is vs its neighbours.
        peak_abs = abs(band_diffs[peak_idx_local])
        # Average of adjacent band diffs (excluding the peak itself)
        neighbours = []
        if peak_idx_local > 0:
            neighbours.append(abs(band_diffs[peak_idx_local - 1]))
        if peak_idx_local < len(band_diffs) - 1:
            neighbours.append(abs(band_diffs[peak_idx_local + 1]))
        neighbour_avg = float(np.mean(neighbours)) if neighbours else peak_abs
        sharpness = peak_abs / max(neighbour_avg, 0.1)  # 1.0 = broad tilt, >2 = narrow peak

        # Base Q by frequency (mastering convention: wider Q at low, tighter at high)
        if freq < 120:
            base_q = 0.7
        elif freq < 400:
            base_q = 0.9
        elif freq < 2000:
            base_q = 1.1
        elif freq < 6000:
            base_q = 1.4
        else:
            base_q = 1.8

        # Modulate by sharpness
        if sharpness > 2.5:
            q = round(base_q * 1.8, 1)  # tight surgical cut/boost
            q_note = "narrow — surgical"
        elif sharpness > 1.5:
            q = round(base_q * 1.3, 1)
            q_note = "moderate"
        else:
            q = round(base_q * 0.8, 1)  # broad tonal shift
            q_note = "wide — tonal shift"

        # Safety clamps
        q = max(0.3, min(q, 4.0))

        filters.append({
            "freq": freq,
            "gain_db": gain,
            "q": q,
            "q_note": q_note,
            "region": region_name,
        })

    return filters


def _compute_match_score(spec_file, spec_target, lufs, dr, width, profile):
    """
    Compute 0-100 score of how close the file is to the engineer's profile.
    """
    # Tonal match (0-50 points)
    tonal_diffs = [abs(spec_file[i] - spec_target[i]) for i in range(min(len(spec_file), len(spec_target))) if spec_file[i] > -50]
    avg_tonal_diff = np.mean(tonal_diffs) if tonal_diffs else 0
    tonal_score = max(0, 50 - avg_tonal_diff * 5)

    # Loudness match (0-20 points)
    lufs_diff = abs(lufs - profile["lufs_avg"])
    lufs_score = max(0, 20 - lufs_diff * 5)

    # Dynamic range match (0-15 points)
    dr_diff = abs(dr - profile["dynamic_range_avg"])
    dr_score = max(0, 15 - dr_diff * 2)

    # Width match (0-15 points)
    width_diff = abs(float(width) - profile["width_avg"])
    width_score = max(0, 15 - width_diff * 100)

    total = round(tonal_score + lufs_score + dr_score + width_score)
    return min(100, max(0, total))
