"""
Masking overlap detection — finds frequency regions where TWO sources have
simultaneously high energy, potentially masking each other.

When AI stems are available (Deep Scan), we compare per-stem spectra pairwise
to highlight classic problems:
    - Kick vs Bass in 60-120 Hz
    - Vocal vs Other in 200-500 Hz (vocal body vs instrument low-mids)
    - Snare vs Vocal in 2-5 kHz (presence fight)
    - Cymbals vs Vocal in 6-10 kHz (brilliance fight)

Without stems, we fall back to static spectrum balance flags.
"""

import os
import numpy as np
import librosa
from scipy.signal import butter, sosfilt

# LOW-9: "both loud" threshold — the minimum mix-normalised band energy (dBFS)
# for a stem to count as "loud" in the masking check. Exposed as a module
# constant so genre-specific callers can override (e.g. EDM tracks are louder
# and may need -12 dB; orchestral stems may need -24 dB).
MASKING_BOTH_LOUD_THRESHOLD_DB: float = -18.0


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


def analyze_masking(stems_dir: str = None, file_path: str = None, sr: int = None) -> dict:
    """
    Analyse masking overlaps.

    If `stems_dir` is provided and contains Demucs-separated stems, run pairwise
    masking between vocals/drums/bass/other. Otherwise return a coarse analysis
    from the full-mix spectrum in `file_path`.
    """
    overlaps = []

    if stems_dir and os.path.isdir(stems_dir):
        # Locate the actual stem files. Two layouts to support:
        #   (a) flat:  stems_dir/vocals.wav (BS-RoFormer 4-stem default)
        #   (b) nested: stems_dir/<basename>/vocals.wav (legacy Demucs)
        # Per the audit: pre-fix this loop only walked subdirs, so when
        # the primary BS-RoFormer backend was used (flat layout), the
        # `subs == []` short-circuit silently skipped stem-based masking
        # and the call fell through to the coarse full-mix BANDS path.
        # Engineers using Deep Scan never saw real per-stem masking.
        candidates = []
        # (a) flat — same dir as stems_dir
        if all(os.path.exists(os.path.join(stems_dir, f"{n}.wav"))
               for n in ("vocals", "drums", "bass", "other")):
            candidates.append(stems_dir)
        # (b) nested — newest subdir wins
        subs = [d for d in os.listdir(stems_dir) if os.path.isdir(os.path.join(stems_dir, d))]
        for sub in sorted(subs, key=lambda s: os.path.getmtime(os.path.join(stems_dir, s)), reverse=True):
            sub_path = os.path.join(stems_dir, sub)
            if all(os.path.exists(os.path.join(sub_path, f"{n}.wav"))
                   for n in ("vocals", "drums", "bass", "other")):
                candidates.append(sub_path)

        if candidates:
            stem_dir = candidates[0]
            stems = {}
            for name in ("vocals", "drums", "bass", "other"):
                p = os.path.join(stem_dir, f"{name}.wav")
                if os.path.exists(p):
                    try:
                        y, _ = librosa.load(p, sr=sr, mono=True)
                        stems[name] = y
                    except Exception:
                        pass

            if stems:
                # Pairs to check
                PAIRS = [
                    ("kick_vs_bass", "drums", "bass",
                        (40, 120), "Kick fundamental fights bass"),
                    ("vocal_vs_bass", "vocals", "bass",
                        (100, 250), "Vocal low fights bass fundamental"),
                    ("vocal_vs_other", "vocals", "other",
                        (200, 600), "Vocal body fights instrument low-mids"),
                    ("vocal_vs_drums", "vocals", "drums",
                        (2000, 5000), "Vocal presence fights snare crack / hi-hat"),
                    ("vocal_vs_cymbals", "vocals", "drums",
                        (6000, 10000), "Vocal air fights cymbal shimmer"),
                ]
                # 5.3.1 honesty fix: pre-5.3 we normalised every stem to
                # the SAME unity RMS before measuring per-band overlap.
                # That destroyed the very level information masking is
                # supposed to measure — a quiet pad mostly buried in the
                # mix would read identically to a loud pad up front,
                # because both end up at unity RMS post-norm. Now we
                # measure per-band level relative to the FULL MIX's
                # overall RMS, so a stem's actual contribution to the
                # mix is preserved. This makes "vocals fight bass at
                # 200 Hz" mean what an engineer expects.
                # 5.7.x audit fix: the mix RMS is sqrt(mean(actual_mix²))
                # where actual_mix = sum of stems. Pre-fix this divided
                # by N_stems INSIDE the sqrt, computing the average of
                # per-stem mean-energy instead of the energy of the
                # actual sum. For 4 musically uncorrelated stems that
                # under-estimated the real mix RMS by a factor of ~2,
                # inflating each stem's normalised level by 3–6 dB and
                # tripping `both_loud > -18 dB` on stems that aren't
                # actually loud in the final mix.
                # Use the shortest length to be safe (stems can disagree
                # by 1-2 samples after separator round-trips).
                _min_len = min(v.shape[0] for v in stems.values())
                _actual_mix = sum(v.astype(np.float64)[:_min_len] for v in stems.values())
                mix_rms = max(1e-10, float(np.sqrt(np.mean(_actual_mix ** 2))))
                normed = {
                    k: v.astype(np.float64) / mix_rms
                    for k, v in stems.items()
                }

                for kind, a, b, (lo, hi), desc in PAIRS:
                    if a not in normed or b not in normed:
                        continue
                    db_a = _band_rms_db(normed[a], sr, lo, hi)
                    db_b = _band_rms_db(normed[b], sr, lo, hi)
                    # Masking intensity: both loud AND close-level. The closer
                    # they are in dB, the more they fight (can't duck each
                    # other). With the new normalisation, "loud" now means
                    # "loud in the mix," not "loud after per-stem normalise."
                    both_loud = min(db_a, db_b) > MASKING_BOTH_LOUD_THRESHOLD_DB
                    closeness = 6 - abs(db_a - db_b)  # 6 dB diff → 0 masking
                    severity_score = max(0.0, closeness) * (1 if both_loud else 0.3)

                    if severity_score > 3:
                        sev = "high"
                    elif severity_score > 1.5:
                        sev = "medium"
                    elif severity_score > 0.5:
                        sev = "low"
                    else:
                        continue

                    overlaps.append({
                        "pair": f"{a} ↔ {b}",
                        "freq_range": f"{lo}-{hi if hi < 1000 else str(hi//1000) + 'k'} Hz",
                        "severity": sev,
                        "description": desc,
                        "level_a": round(db_a, 1),
                        "level_b": round(db_b, 1),
                        "tip": _mask_tip(kind, a, b),
                    })

    # Fallback — full-mix spectrum band energy
    if not overlaps and file_path and os.path.exists(file_path):
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
        "stem_based": bool(stems_dir and overlaps and overlaps[0].get("pair", "").find("↔") > -1),
    }


def _mask_tip(kind: str, a: str, b: str) -> str:
    tips = {
        "kick_vs_bass":    "Side-chain bass to kick, or HPF bass below 80 Hz and let the kick own the sub.",
        "vocal_vs_bass":   "EQ a dip around 150–200 Hz on the bass when vocals are present, or HPF vocal at 100 Hz.",
        "vocal_vs_other":  "Narrow cut around 300–500 Hz on `other` stem to carve vocal body space.",
        "vocal_vs_drums":  "Dip 2–4 kHz on drums bus during vocal phrases, or de-ess/tame vocal sibilance.",
        "vocal_vs_cymbals":"Gentle 6–10 kHz shelf cut on cymbals, or boost vocal air slightly to stand above shimmer.",
    }
    return tips.get(kind, "")
