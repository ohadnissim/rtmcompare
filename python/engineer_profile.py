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
    # 5.7.x audit fix: extended Ultra High from (29, 31) to (28, 31)
    # so it averages 3 bands instead of 2. Combined with the 1-octave
    # Hann smoothing the prior 2-band region was effectively
    # one-band-of-evidence — a single 16 kHz spike on the candidate
    # could swing the whole Ultra High recommendation. Three bands
    # gives the median some room to breathe.
    (28, 31): ("Ultra High", "12.5-20 kHz"),
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
    """Compute 31-band ISO spectrum in dB, mean-centred across the 31 bands.

    5.2.1 fix (Austin Seltzer beta-tester report): the previous "normalize
    to 1 kHz band" anchor produced phantom 3–6 dB diffs vs RTMprofile-built
    target curves, because RTMprofile mean-centres each per-track curve
    (`rtm-profile-app/python/build_profile.py:165`). Using two different
    anchor points made the entire candidate spectrum read several dB
    hotter (or colder) than the target — the K-pop "smile curve" sits
    well below the broadband mean at 1 kHz, so 1 kHz-anchoring of a
    finished pro mix vs a mean-centred profile generated +14 dB low-end
    "boost" recommendations even when the candidate's tonal shape was
    already a perfect cohort match. Switching the candidate to mean-
    centring brings both axes onto the same reference and the diff
    becomes a true tonal-shape delta.
    """
    # 5.3.1 hardening: guard against silent/NaN/all-DC inputs. Pre-5.3
    # a digital-silence file produced 31 × -90 dB → mean-centred to 31
    # zeros → match score read 50/100 tonal, falsely perfect. Now we
    # detect "no usable signal" up front and return None so callers
    # can short-circuit the match score and the EQ proposer.
    if not isinstance(y, np.ndarray) or y.size == 0:
        return None
    if not np.all(np.isfinite(y)):
        # Replace any NaN/Inf with zero so the per-band filter doesn't
        # propagate garbage. Useful for edge-case loaders.
        y = np.nan_to_num(y, nan=0.0, posinf=0.0, neginf=0.0)
    overall_rms = float(np.sqrt(np.mean(y * y)))
    # 5.7.x audit fix: was 1e-5 (-100 dBFS) — too aggressive. Real
    # quiet content (a fade-out tail, an ambient/film stem, a -70 LUFS
    # broadcast bed) reads above -100 dBFS but well below this floor
    # and silently dropped to None, killing the tonal score. BS.1770
    # uses -70 LUFS as its absolute gate; 1e-7 (~ -140 dBFS) is the
    # numeric-stability floor. Anything between those gets analysed.
    if overall_rms < 1e-7:
        return None

    nyq = sr / 2
    levels = []
    for freq in FREQS:
        low = freq / (2 ** (1/6))
        high = freq * (2 ** (1/6))
        low_n = max(low / nyq, 0.001)
        high_n = min(high / nyq, 0.999)
        if low_n >= high_n:
            levels.append(-90.0)  # match build_profile.py floor
            continue
        sos = butter(4, [low_n, high_n], btype='band', output='sos')
        filtered = sosfilt(sos, y)
        rms = float(np.sqrt(np.mean(filtered ** 2)))
        if not np.isfinite(rms) or rms <= 0:
            levels.append(-90.0)
            continue
        levels.append(float(20 * np.log10(max(rms, 1e-10))))
    arr = np.asarray(levels, dtype=np.float64)
    arr = np.nan_to_num(arr, nan=-90.0, posinf=0.0, neginf=-90.0)
    centred = arr - float(np.mean(arr))
    return list(centred)


def _smooth_log_spectrum(spec, *, kernel_bands: int = 3):
    """Smooth a 31-band 1/3-octave spectrum across log-frequency neighbours.

    Mike's report (May 2026): hard-electronic / techno mixes with a tuned
    4-on-the-floor kick produce a constant, prominent 50 Hz fundamental
    in the candidate spectrum. The reference profile, averaged over 15+
    tracks in different keys, is naturally smooth in that region. The
    raw band-by-band diff therefore shows +5..+7 dB at the kick
    fundamental and the recommender suggests cutting it — which would
    destroy the genre's signature.

    Fix: convolve BOTH the candidate and the target with a symmetric
    Hann window in log-frequency (the 31 bands are 1/3-octave-spaced, so
    a 3-band window spans ~1 octave centred on each band). Same op on
    both sides preserves any genuine broad-band tonal imbalance but
    suppresses single-band tonal features that the reference can never
    match because it's already averaged.

    kernel_bands=1 → no-op
    kernel_bands=3 (default) → ~1-octave Hann smoothing
    kernel_bands=5 → ~1.7-octave smoothing (more aggressive)

    Reflective padding at the edges avoids attenuating the lowest /
    highest bands.
    """
    spec = np.asarray(spec, dtype=np.float64)
    if kernel_bands <= 1 or spec.size <= kernel_bands:
        return spec.copy()
    # Hann-shaped kernel, normalised to unity sum. For kernel_bands=3
    # the result post-normalisation is [0.25, 0.5, 0.25] — the classic
    # binomial 3-tap smoother — which is also what Savitzky-Golay
    # would over-fit AGAINST. Hann was chosen specifically because we
    # want the smoothing to ATTENUATE narrow peaks (kick fundamentals,
    # tonal resonances), not preserve them. Reflective padding avoids
    # attenuating band 0 (20 Hz) and band 30 (20 kHz). dB-domain
    # smoothing matches the dB-domain diff computation downstream;
    # switching to linear-power smoothing would create the same axis
    # mismatch documented at the 5.2.1 anchor fix above.
    kernel = np.hanning(kernel_bands + 2)[1:-1]  # drop the zero endpoints
    kernel = kernel / float(kernel.sum())
    pad = kernel_bands // 2
    padded = np.pad(spec, pad, mode='reflect')
    return np.convolve(padded, kernel, mode='valid')


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

        mid_spec  = compute_spectrum(mid, sr)   # mean-centred 31-band
        side_spec = compute_spectrum(side, sr)  # mean-centred 31-band
        if mid_spec is None or side_spec is None:
            # Silent / NaN inputs — nothing meaningful to derive.
            return tips

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

    # Compute file B metrics. compute_spectrum returns None for silent /
    # all-NaN inputs (5.3.1 hardening). Substitute a flat zero curve so
    # downstream consumers don't crash, but propagate a flag the match
    # score can use to short-circuit instead of giving silence a 50/100
    # tonal score.
    spec_b = compute_spectrum(mono_b, sr)
    spec_b_silent = spec_b is None
    if spec_b_silent:
        spec_b = [0.0] * 31
    lufs_b = compute_lufs(y_b, sr)
    dr_b = compute_dynamic_range(y_b, sr)
    width_b = compute_stereo_width(y_b[0], y_b[1])
    # True peak with 4x oversampling
    from scipy.signal import resample_poly
    up_l = resample_poly(y_b[0] if y_b.ndim > 1 else y_b, 4, 1)
    up_r = resample_poly(y_b[1] if y_b.ndim > 1 and y_b.shape[0] > 1 else y_b, 4, 1)
    peak_b = float(20 * np.log10(max(np.max(np.abs(up_l)), np.max(np.abs(up_r)), 1e-10)))
    st_max_b = compute_short_term_max(y_b, sr)

    # Compute file A metrics for context.
    spec_a = compute_spectrum(mono_a, sr)
    if spec_a is None:
        spec_a = [0.0] * 31
    lufs_a = compute_lufs(y_a, sr)

    # 5.7.0: smoothed copies of the candidate + reference spectra.
    # ALL diff-based reasoning downstream (tip text, tonal_diffs,
    # match score, eq_filters) operates on these so a tuned kick
    # fundamental (or any narrow tonal feature) doesn't read as a
    # broad-band imbalance against the averaged reference. The raw
    # `spec_b` / `curve` arrays are still used unchanged for the
    # chart payloads (`spectrum_file`, `spectrum_target`) so the
    # user sees the actual 1/3-octave reading; the smoothed copies
    # are exposed alongside as `spectrum_file_smoothed` /
    # `spectrum_target_smoothed` for optional UI overlay.
    spec_b_sm = list(_smooth_log_spectrum(np.asarray(spec_b), kernel_bands=3))
    curve_sm  = list(_smooth_log_spectrum(np.asarray(curve),  kernel_bands=3))

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

    # ─── Loudness tips ───────────────────────────────────────────────
    # Integrated LUFS vs cohort average. Tonal recommendations are
    # already level-independent (mean-centred curves), so this is purely
    # about target-loudness coaching: "your master is +2 LU louder than
    # the reference, ease the limiter" or "you're 3 LU quieter, push it".
    # Bands are intentionally tighter than DR because LUFS moves in
    # smaller steps — ±0.5/±1/±1.5 LU instead of ±2/±4 LU.
    target_lufs = profile["lufs_avg"]
    lufs_diff = lufs_b - target_lufs

    if abs(lufs_diff) > 1.5:
        direction = "louder" if lufs_diff > 0 else "quieter"
        action = (
            "Ease the limiter / lower the master gain — you're pushing harder than the reference."
            if lufs_diff > 0
            else "Push the master a bit harder (or drive the limiter slightly more) to land in the same loudness ballpark."
        )
        tips.append({
            "category": "Loudness",
            "priority": "high",
            "tip": f"{lufs_diff:+.1f} LU {direction} than target — {lufs_b:.1f} LUFS vs {target_lufs:.1f} LUFS",
            "detail": action,
        })
    elif abs(lufs_diff) > 1.0:
        direction = "louder" if lufs_diff > 0 else "quieter"
        tips.append({
            "category": "Loudness",
            "priority": "medium",
            "tip": f"{lufs_diff:+.1f} LU {direction} than target — {lufs_b:.1f} LUFS vs {target_lufs:.1f} LUFS",
            "detail": "Not huge, but noticeable in A/B. A small master-gain tweak gets you closer.",
        })
    elif abs(lufs_diff) > 0.5:
        direction = "louder" if lufs_diff > 0 else "quieter"
        tips.append({
            "category": "Loudness",
            "priority": "low",
            "tip": f"{lufs_diff:+.1f} LU {direction} than target — {lufs_b:.1f} LUFS vs {target_lufs:.1f} LUFS",
            "detail": "Within normal mastering tolerance. Worth a small adjustment if you're A/B-ing against the reference.",
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
    # 5.2.1: pass cohort per-band MAD when the profile was built with it
    # (RTMprofile 1.1.0+). Older profiles silently fall back to the
    # original 1 dB threshold inside _compute_eq_filters.
    curve_mad = profile.get("curve_mad") if isinstance(profile, dict) else None
    # _compute_eq_filters smooths internally; we pass raw spec_b/curve.
    # Tip text below uses the pre-smoothed spec_b_sm/curve_sm so the
    # numbers in the tip ("X dB hot") reconcile with the chart and
    # with the eq_filters move ("cut Y dB at Z Hz").
    pre_filters = _compute_eq_filters(spec_b, curve, target_curve_mad=curve_mad)
    filter_by_region = {f["region"]: f for f in pre_filters}

    def _fmt_freq(hz):
        if hz >= 1000:
            return f"{hz/1000:.1f} kHz".replace(".0 kHz", " kHz")
        return f"{int(hz)} Hz"

    for (start, end), (region_name, freq_range) in REGION_NAMES.items():
        if start >= len(spec_b_sm) or start >= len(curve_sm):
            continue
        avg_file = np.mean(spec_b_sm[start:end])
        avg_target = np.mean(curve_sm[start:end])
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

        # 5.7.x: take the suggested gain from the CAPPED `filt['gain_db']`
        # when available, so the tip text matches the chip the user
        # actually sees. The raw `abs(diff)/2` is uncapped — on a 12 dB
        # diff at 60 Hz, the filter cap clamps the chip to ±3 dB while
        # the prose said "consider a 6 dB cut". Audit HIGH #5: tip text
        # and chip have to agree. Fall back to raw if no filter exists.
        suggested_db_uncapped = abs(diff) / 2
        suggested_db = abs(filt["gain_db"]) if filt else suggested_db_uncapped

        if abs(diff) > 3:
            direction = "boost" if diff < 0 else "cut"
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
        # 5.7.0: also expose the smoothed contour the recommender actually
        # diffs against. The UI can overlay this so users understand why
        # a visible 5–7 dB spike at the kick fundamental produces no
        # surgical cut: the smoother sees that spike as a tonal feature
        # the averaged reference can't possibly match (different keys
        # across cohort tracks), and the recommender ignores it.
        "spectrum_file_smoothed": [round(float(v), 1) for v in spec_b_sm],
        "spectrum_target_smoothed": [round(float(v), 1) for v in curve_sm],
        "freqs": FREQ_LABELS,
        # 5.7.0: re-use the pre-computed pre_filters above (was a duplicate
        # call with identical arguments before — both paths smooth
        # internally so the result is identical, just save the work).
        "eq_filters": pre_filters,
        # Match score on smoothed spectra so the score doesn't penalise
        # tracks for narrow tonal features the reference can't match.
        "match_score": _safe_match_score(spec_b_sm, curve_sm, lufs_b, dr_b, width_b, profile, silent=spec_b_silent),
    }


def _compute_eq_filters(spec_file, spec_target, target_curve_mad=None):
    """
    Compute parametric EQ filter bands to move file toward target.

    Q is chosen based on the *width* of the deviation — a narrow, pointy
    deviation (single band jumps while neighbours are fine) gets a tight Q;
    a broad tilt across the region gets a wide Q. This mirrors how mastering
    engineers actually cut / boost — tight for resonances, wide for tonal shifts.

    Returns list of {freq, gain_db, q, region, q_note} for BiquadFilterNode.
    """
    filters = []

    # 5.7.0: log-frequency smoothing on BOTH spectra before the diff.
    # See _smooth_log_spectrum() docstring for the full motivation.
    # In short: a constant kick fundamental at, say, 50 Hz reads as a
    # narrow tonal feature in the candidate that the averaged reference
    # cannot have (because reference tracks are in different keys). A
    # 1-octave Hann smoothing on both sides makes narrow features blend
    # into their neighbours; broad-band tilt survives intact. Result:
    # tonal-imbalance recommendations remain accurate, but recommendations
    # driven by a single tuned tonal feature shrink to sensible levels.
    # The MAD curve gets the same treatment so the variance-aware
    # tolerance stays consistent with the smoothed spectra.
    arr = _smooth_log_spectrum(np.asarray(spec_file), kernel_bands=3)
    tgt = _smooth_log_spectrum(np.asarray(spec_target), kernel_bands=3)

    # 5.2.1 fix: optional cohort-spread (per-band MAD) lets us widen the
    # "no move" dead-zone whenever the candidate sits inside the cohort's
    # natural variance. When `target_curve_mad` is provided (RTMprofile
    # builds with curve_mad), we require the diff to exceed
    # max(1.0, 1.5 * region_mad) before firing a recommendation.
    # Without it (legacy profiles, single-track Match) we fall back to
    # the original 1 dB threshold.
    if target_curve_mad is not None:
        mad = _smooth_log_spectrum(np.asarray(target_curve_mad), kernel_bands=3)
    else:
        mad = None

    for (start, end), (region_name, freq_range) in REGION_NAMES.items():
        if start >= len(arr) or start >= len(tgt):
            continue
        region_end = min(end, len(arr), len(tgt))
        avg_file = float(np.mean(arr[start:region_end]))
        avg_target = float(np.mean(tgt[start:region_end]))
        diff = avg_target - avg_file  # positive = need boost, negative = need cut

        # Cohort-aware threshold. If the cohort's natural per-band spread
        # in this region is, say, ±2 dB MAD, we don't fire moves under
        # ~3 dB — the candidate is statistically "in the family" and a
        # recommendation would just push it toward the median for no
        # perceptual reason. Austin's report (May 2026) was the canonical
        # case: 14 dB recommendations on a finished K-pop mix that already
        # sat inside a 15-track K-pop cohort.
        if mad is not None and region_end > start:
            region_mad = float(np.mean(mad[start:region_end]))
            tol = max(1.0, 1.5 * region_mad)
        else:
            tol = 1.0
        if abs(diff) < tol:
            continue

        # Find the band within the region with the most extreme deviation
        # → use that as the center frequency, not the region center.
        band_diffs = tgt[start:region_end] - arr[start:region_end]
        if len(band_diffs) == 0:
            continue
        peak_idx_local = int(np.argmax(np.abs(band_diffs)))
        peak_idx = start + peak_idx_local
        freq = FREQS[min(peak_idx, len(FREQS) - 1)]

        # Apply 50% of the correction (don't over-correct).
        # Matches the prose in generate_tips() ("apply ~50% then re-listen")
        # and the conservative-mastering convention ("Subtractive First" — apply
        # half, listen, decide whether to push further). Was 60% historically
        # but the chip values then disagreed with the tip text by ~10–20%,
        # which read as a bug to users.
        gain = round(diff * 0.5, 1)

        # 5.2.1 cap (Austin beta-tester report): mirror the ±4 dB / ±3 dB
        # sub cap from `MatchReferenceEQPanel.deriveMatchBands` (frontend).
        # The frontend cap was added in 5.1.x but only protected the
        # spectrum-comparison path; the engineer-profile path was
        # uncapped, so a phantom 14 dB diff (from the pre-5.2.1 axis
        # mismatch) shipped uncapped to the user. Belt-and-suspenders:
        # even with the axis fix, no single peaking-EQ move on a finished
        # mix should ever exceed ±4 dB broadband / ±3 dB sub.
        cap = 3.0 if freq < 80 else 4.0
        gain = round(max(-cap, min(cap, gain)), 1)

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


def _compute_match_score(spec_file, spec_target, lufs, dr, width, profile, *, silent=False):
    """
    Compute 0-100 score of how close the file is to the engineer's profile.

    5.3.1 honesty fix: a silent or NaN input pre-5.3 produced a 50/100
    tonal score (because the empty `tonal_diffs` list short-circuited
    `np.mean` to 0). That looked like "perfect tonal match" in the UI.
    Now we accept an explicit `silent=True` flag so callers can return
    a 0/100 with a meaningful detail string.
    """
    if silent:
        return {
            "score": 0,
            "tonal_score": 0,
            "lufs_score": 0,
            "dr_score": 0,
            "width_score": 0,
            "detail": "Input has no usable signal (silent or below the measurement floor).",
        }
    # Tonal match (0-50 points)
    tonal_diffs = [abs(spec_file[i] - spec_target[i]) for i in range(min(len(spec_file), len(spec_target))) if spec_file[i] > -50]
    if not tonal_diffs:
        # Every band sits at-or-below the -50 floor → no real signal.
        return {
            "score": 0,
            "tonal_score": 0,
            "lufs_score": 0,
            "dr_score": 0,
            "width_score": 0,
            "detail": "Input is too quiet to compare — every band is below the −50 dB measurement floor.",
        }
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


def _safe_match_score(spec_file, spec_target, lufs, dr, width, profile, *, silent=False):
    """5.3.1 wrapper: returns a plain int 0..100 like before, but routes
    silent inputs through the structured dict to log a clearer detail.
    Public callers still see an int."""
    if silent:
        return 0
    res = _compute_match_score(spec_file, spec_target, lufs, dr, width, profile)
    if isinstance(res, dict):
        return int(res.get("score", 0))
    return int(res)
