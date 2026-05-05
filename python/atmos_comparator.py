"""
Atmos-specific comparison module.

Compares a stereo mix against a multichannel (Atmos/surround) file.
Computes channel energy, height ratio, center extraction, LFE analysis,
surround balance, and downmix delta.
"""

import numpy as np
import librosa
import soundfile as sf
from scipy.signal import butter, sosfilt

from adm_parser import (
    detect_format, get_channel_index, get_group_indices,
    get_channel_ids, CHANNEL_GROUPS, validate_adm,
)
from comparator import (
    run_fast_analysis, level_match, compute_lufs,
    compute_stereo_width, compute_pan, compute_dynamic_range,
    compute_punch, bandpass, analyze_category,
    generate_category_insight, generate_overall_insights,
    generate_recommendations,
)


# ─── ITU-R BS.775 downmix coefficients ──────────────────────────────────────

# Standard stereo downmix from surround/Atmos
# L_out = L + 0.707*C + 0.707*Ls + 0.5*Lrs + 0.707*Ltf + 0.5*Ltr
# R_out = R + 0.707*C + 0.707*Rs + 0.5*Rrs + 0.707*Rtf + 0.5*Rtr

DOWNMIX_COEFFS = {
    "L":   (1.0,   0.0),    # (left_gain, right_gain)
    "R":   (0.0,   1.0),
    "C":   (0.707, 0.707),
    "LFE": (0.0,   0.0),    # LFE excluded from downmix (standard practice)
    "Ls":  (0.707, 0.0),
    "Rs":  (0.0,   0.707),
    "Lrs": (0.5,   0.0),
    "Rrs": (0.0,   0.5),
    "Ltf": (0.707, 0.0),
    "Rtf": (0.0,   0.707),
    "Ltr": (0.5,   0.0),
    "Rtr": (0.0,   0.5),
}


# ─── Audio loading ───────────────────────────────────────────────────────────

def load_multichannel(file_path: str, sr: int = 44100, max_channels: int = 0):
    """
    Load a multichannel audio file preserving all channels (or up to max_channels).
    Returns (audio_array, sample_rate) where audio_array shape is (channels, samples).

    For large Atmos renders (e.g., 62 channels), set max_channels=12 to load
    only the 7.1.4 bed and avoid excessive memory usage.
    """
    info = sf.info(file_path)
    total_channels = info.channels

    if max_channels > 0 and total_channels > max_channels:
        # Read only the first N channels to save memory
        # soundfile doesn't support partial channel reads, so we read all and slice
        # For very large files, read in chunks
        frames = info.frames
        chunk_size = min(frames, sr * 30)  # 30 sec chunks max
        chunks = []
        start = 0
        while start < frames:
            end = min(start + chunk_size, frames)
            data, _ = sf.read(file_path, start=start, stop=end, dtype='float32')
            if data.ndim == 1:
                data = data[:, np.newaxis]
            chunks.append(data[:, :max_channels])
            start = end
        data = np.concatenate(chunks, axis=0)
    else:
        data, _ = sf.read(file_path, dtype='float32')

    # soundfile returns (samples, channels) — transpose to (channels, samples)
    if data.ndim == 1:
        data = data[np.newaxis, :]  # mono → (1, samples)
    else:
        data = data.T  # (samples, channels) → (channels, samples)

    # Resample if needed
    file_sr = info.samplerate
    if file_sr != sr:
        resampled = []
        for ch in range(data.shape[0]):
            resampled.append(librosa.resample(data[ch], orig_sr=file_sr, target_sr=sr))
        data = np.array(resampled)

    return data, sr


def downmix_to_stereo(multichannel: np.ndarray, layout: dict) -> np.ndarray:
    """
    Downmix multichannel audio to stereo using ITU-R BS.775 coefficients.
    Bed channels use standard coefficients. Object channels (Obj*) are
    panned center at a reduced level (standard Atmos fallback).
    Returns shape (2, samples).
    """
    n_samples = multichannel.shape[1]
    n_channels = multichannel.shape[0]
    stereo = np.zeros((2, n_samples), dtype=np.float64)

    # Track which channel indices are handled by the layout
    handled_indices = set()

    for ch_def in layout["channels"]:
        idx = ch_def["index"]
        ch_id = ch_def["id"]
        if idx >= n_channels:
            continue
        handled_indices.add(idx)

        if ch_id.startswith("Obj"):
            # Object channels: pan to center at reduced level
            # Objects without position data get phantom center at -3 dB
            stereo[0] += multichannel[idx] * 0.707
            stereo[1] += multichannel[idx] * 0.707
        else:
            coeffs = DOWNMIX_COEFFS.get(ch_id, (0.0, 0.0))
            if coeffs[0] != 0:
                stereo[0] += multichannel[idx] * coeffs[0]
            if coeffs[1] != 0:
                stereo[1] += multichannel[idx] * coeffs[1]

    # Any remaining channels not in layout (extra objects) also go center
    for idx in range(n_channels):
        if idx not in handled_indices:
            stereo[0] += multichannel[idx] * 0.707
            stereo[1] += multichannel[idx] * 0.707

    # Normalize to prevent clipping
    peak = np.max(np.abs(stereo))
    if peak > 1.0:
        stereo /= peak

    return stereo.astype(np.float32)


# ─── Speaker render (fold objects into 7.1.4) ───────────────────────────────

# Mapping from each bed speaker to its (left_gain, right_gain) for stereo downmix
# Used to determine which speaker an object is closest to
SPEAKER_POSITIONS_DEG = {
    "L": 30, "R": -30, "C": 0, "LFE": 0,
    "Ls": 110, "Rs": -110, "Lrs": 150, "Rrs": -150,
    "Ltf": 30, "Rtf": -30, "Ltr": 150, "Rtr": -150,
}

def render_to_speakers(multichannel: np.ndarray, layout: dict) -> tuple:
    """
    Render all channels (bed + objects) into a 7.1.4 speaker layout.
    Objects without position data are panned to L/R phantom center.

    Returns:
        (rendered, rendered_layout) where rendered is (12, samples) and
        rendered_layout is the 7.1.4 layout dict.
    """
    from adm_parser import CHANNEL_LAYOUTS

    bed_layout = CHANNEL_LAYOUTS[12]  # 7.1.4
    n_speakers = 12
    n_samples = multichannel.shape[1]
    rendered = np.zeros((n_speakers, n_samples), dtype=np.float64)

    bed_count = layout.get("bed_channels", min(12, multichannel.shape[0]))

    # Copy bed channels directly
    for i in range(min(bed_count, n_speakers, multichannel.shape[0])):
        rendered[i] += multichannel[i]

    # Fold objects into L and R (phantom center) — standard fallback
    # when no position data is available
    l_idx = 0  # L speaker
    r_idx = 1  # R speaker
    for idx in range(bed_count, multichannel.shape[0]):
        rendered[l_idx] += multichannel[idx] * 0.707
        rendered[r_idx] += multichannel[idx] * 0.707

    return rendered.astype(np.float32), bed_layout


# ─── Atmos-specific metrics ─────────────────────────────────────────────────

def compute_channel_energy(multichannel: np.ndarray, layout: dict) -> list:
    """
    Compute RMS energy per channel in dB.
    Returns list of {channel, label, level_db, group}.
    """
    results = []

    for ch_def in layout["channels"]:
        idx = ch_def["index"]
        if idx >= multichannel.shape[0]:
            continue

        rms = np.sqrt(np.mean(multichannel[idx] ** 2))
        level_db = float(20 * np.log10(max(rms, 1e-10)))

        # Determine group
        ch_id = ch_def["id"]
        if ch_id in CHANNEL_GROUPS["height"]:
            group = "height"
        elif ch_id in CHANNEL_GROUPS["lfe"]:
            group = "lfe"
        else:
            group = "ear_level"

        results.append({
            "channel": ch_id,
            "label": ch_def["label"],
            "level_db": round(level_db, 1),
            "group": group,
            "azimuth": ch_def.get("azimuth", 0),
            "elevation": ch_def.get("elevation", 0),
        })

    return results


def compute_height_ratio(multichannel: np.ndarray, layout: dict) -> float:
    """
    Compute the ratio of energy in height channels vs total.
    Returns 0.0 (no height content) to 1.0 (all content in height).
    """
    height_indices = get_group_indices(layout, "height")
    if not height_indices:
        return 0.0

    # Exclude LFE from total (it skews the ratio)
    lfe_indices = get_group_indices(layout, "lfe")
    all_indices = [ch["index"] for ch in layout["channels"]
                   if ch["index"] not in lfe_indices and ch["index"] < multichannel.shape[0]]

    height_energy = sum(
        np.mean(multichannel[i] ** 2)
        for i in height_indices if i < multichannel.shape[0]
    )
    total_energy = sum(
        np.mean(multichannel[i] ** 2)
        for i in all_indices
    )

    if total_energy < 1e-10:
        return 0.0

    return float(height_energy / total_energy)


def compute_center_extraction(stereo: np.ndarray, multichannel: np.ndarray,
                               layout: dict) -> float:
    """
    Compute correlation between Atmos center channel and stereo mid signal.
    High correlation = vocals/dialog were cleanly extracted to center.
    Returns -1 to 1 (1 = perfect correlation).
    """
    c_idx = get_channel_index(layout, "C")
    if c_idx is None or c_idx >= multichannel.shape[0]:
        return 0.0

    center = multichannel[c_idx]
    mid = (stereo[0] + stereo[1]) / 2.0

    # Trim to same length
    min_len = min(len(center), len(mid))
    center = center[:min_len]
    mid = mid[:min_len]

    # Pearson correlation
    c_centered = center - np.mean(center)
    m_centered = mid - np.mean(mid)

    denom = np.sqrt(np.sum(c_centered ** 2) * np.sum(m_centered ** 2))
    if denom < 1e-10:
        return 0.0

    return float(np.sum(c_centered * m_centered) / denom)


def compute_lfe_analysis(multichannel: np.ndarray, layout: dict,
                          sr: int = 44100) -> dict:
    """
    Analyze the LFE channel.
    Returns level, whether it has content, and high-frequency warnings.
    """
    lfe_idx = get_channel_index(layout, "LFE")
    if lfe_idx is None or lfe_idx >= multichannel.shape[0]:
        return {
            "level_db": -70.0,
            "has_content": False,
            "high_freq_warning": False,
            "high_freq_energy_db": -70.0,
        }

    lfe = multichannel[lfe_idx]
    rms = np.sqrt(np.mean(lfe ** 2))
    level_db = float(20 * np.log10(max(rms, 1e-10)))
    has_content = level_db > -40.0  # -40 dB threshold for "has content"

    # Check for content above 120 Hz (LFE should be low-pass filtered)
    high_freq = bandpass(lfe, sr, 120, min(sr // 2 - 1, 20000))
    hf_rms = np.sqrt(np.mean(high_freq ** 2))
    hf_db = float(20 * np.log10(max(hf_rms, 1e-10)))

    # Warning if high-freq content is within 20 dB of LFE level
    high_freq_warning = has_content and (hf_db > level_db - 20)

    return {
        "level_db": round(level_db, 1),
        "has_content": has_content,
        "high_freq_warning": high_freq_warning,
        "high_freq_energy_db": round(hf_db, 1),
    }


def compute_surround_balance(multichannel: np.ndarray, layout: dict) -> dict:
    """
    Check left/right symmetry of surround channels.
    """
    def _rms_db(idx):
        if idx is None or idx >= multichannel.shape[0]:
            return -70.0
        rms = np.sqrt(np.mean(multichannel[idx] ** 2))
        return float(20 * np.log10(max(rms, 1e-10)))

    ls_idx = get_channel_index(layout, "Ls")
    rs_idx = get_channel_index(layout, "Rs")
    lrs_idx = get_channel_index(layout, "Lrs")
    rrs_idx = get_channel_index(layout, "Rrs")

    ls_db = _rms_db(ls_idx)
    rs_db = _rms_db(rs_idx)
    lrs_db = _rms_db(lrs_idx)
    rrs_db = _rms_db(rrs_idx)

    lr_diff = abs(ls_db - rs_db) if ls_idx is not None and rs_idx is not None else 0.0
    rear_lr_diff = abs(lrs_db - rrs_db) if lrs_idx is not None and rrs_idx is not None else 0.0

    # Consider balanced if within 2 dB
    balanced = lr_diff < 2.0 and rear_lr_diff < 2.0

    return {
        "ls_db": round(ls_db, 1),
        "rs_db": round(rs_db, 1),
        "lrs_db": round(lrs_db, 1),
        "rrs_db": round(rrs_db, 1),
        "lr_diff_db": round(lr_diff, 1),
        "rear_lr_diff_db": round(rear_lr_diff, 1),
        "balanced": balanced,
    }


def compute_downmix_delta(stereo_original: np.ndarray, atmos_downmix: np.ndarray,
                           sr: int = 44100) -> dict:
    """
    Compare the original stereo mix against the Atmos stereo downmix.
    Level-matches first, then shows per-band tonal differences.
    """
    # Trim to same length
    min_len = min(stereo_original.shape[1], atmos_downmix.shape[1])
    orig = stereo_original[:, :min_len]
    dmix = atmos_downmix[:, :min_len]

    # Level-match the downmix to the stereo original
    _, dmix_matched, gain_applied = level_match(orig, dmix, sr)

    mono_orig = (orig[0] + orig[1]) / 2.0
    mono_dmix = (dmix_matched[0] + dmix_matched[1]) / 2.0

    # Per-category band comparison
    band_defs = [
        ("Sub",         20,   80),
        ("Bass",        80,   300),
        ("Low Mids",    300,  1000),
        ("Mids",        1000, 4000),
        ("Presence",    4000, 8000),
        ("Brightness",  8000, 12000),
        ("Air",         12000, 20000),
    ]

    categories = []
    for name, low, high in band_defs:
        band_orig = bandpass(mono_orig, sr, low, high)
        band_dmix = bandpass(mono_dmix, sr, low, high)

        rms_orig = np.sqrt(np.mean(band_orig ** 2))
        rms_dmix = np.sqrt(np.mean(band_dmix ** 2))

        db_orig = 20 * np.log10(max(rms_orig, 1e-10))
        db_dmix = 20 * np.log10(max(rms_dmix, 1e-10))

        categories.append({
            "name": name,
            "diff_db": round(float(db_dmix - db_orig), 1),
        })

    # Overall difference
    overall_rms_orig = np.sqrt(np.mean(mono_orig ** 2))
    overall_rms_dmix = np.sqrt(np.mean(mono_dmix ** 2))
    overall_db_orig = 20 * np.log10(max(overall_rms_orig, 1e-10))
    overall_db_dmix = 20 * np.log10(max(overall_rms_dmix, 1e-10))
    overall_diff = float(overall_db_dmix - overall_db_orig)

    # Generate insight
    big_diffs = [c for c in categories if abs(c["diff_db"]) > 1.0]
    if not big_diffs:
        insight = f"Level-matched comparison ({abs(gain_applied):.1f} dB applied). The Atmos downmix closely matches the original stereo mix across all frequency bands."
    else:
        parts = []
        for c in big_diffs:
            direction = "louder" if c["diff_db"] > 0 else "quieter"
            parts.append(f"{c['name']} is {abs(c['diff_db']):.1f} dB {direction}")
        insight = f"Level-matched ({abs(gain_applied):.1f} dB applied). Tonal differences: {'; '.join(parts)}."

    return {
        "categories": categories,
        "overall_diff_db": round(overall_diff, 1),
        "gain_applied_db": round(gain_applied, 1),
        "insight": insight,
    }


# ─── ADM channel content analysis ────────────────────────────────────────────

def _analyze_adm_channels(multichannel: np.ndarray, layout: dict, sr: int) -> list:
    """
    Analyze what content each ADM channel carries.
    Returns a list of per-channel info dicts (level, spectral centroid, description).
    This is supplementary info — NOT a comparison against stereo.
    """
    # Channel role descriptions
    ROLE_MAP = {
        "L": "Left front", "R": "Right front", "C": "Center (vocals/dialog)",
        "LFE": "Subwoofer", "Ls": "Left surround", "Rs": "Right surround",
        "Lrs": "Left rear surround", "Rrs": "Right rear surround",
        "Ltf": "Left top front (height)", "Rtf": "Right top front (height)",
        "Ltr": "Left top rear (height)", "Rtr": "Right top rear (height)",
    }

    results = []
    for ch_def in layout.get("channels", []):
        idx = ch_def["index"]
        ch_id = ch_def["id"]
        if idx >= multichannel.shape[0] or ch_id.startswith("Obj"):
            continue

        signal = multichannel[idx]
        rms = np.sqrt(np.mean(signal ** 2))
        level_db = float(20 * np.log10(max(rms, 1e-10)))
        is_active = level_db > -50

        # Spectral centroid (what frequency range dominates)
        centroid = 0.0
        if is_active:
            try:
                centroid = float(np.mean(librosa.feature.spectral_centroid(y=signal, sr=sr)))
            except Exception:
                pass

        # Dynamic range
        dr = compute_dynamic_range(signal, sr) if is_active else 0.0

        # Describe content
        role = ROLE_MAP.get(ch_id, ch_def.get("label", ch_id))
        if not is_active:
            description = f"{role} — silent"
        elif ch_id == "LFE":
            description = f"{role} — {level_db:.1f} dB"
        elif centroid > 4000:
            description = f"{role} — bright content ({centroid:.0f} Hz centroid)"
        elif centroid > 1000:
            description = f"{role} — mid-range content ({centroid:.0f} Hz centroid)"
        elif centroid > 200:
            description = f"{role} — low-mid content ({centroid:.0f} Hz centroid)"
        else:
            description = f"{role} — bass content ({centroid:.0f} Hz centroid)"

        results.append({
            "channel": ch_id,
            "label": ch_def.get("label", ch_id),
            "role": role,
            "level_db": round(level_db, 1),
            "centroid_hz": round(centroid, 0),
            "dynamic_range_db": round(dr, 1),
            "is_active": is_active,
            "description": description,
        })

    return results


# ─── Main Atmos comparison ──────────────────────────────────────────────────

def run_atmos_comparison(file_stereo: str, file_atmos: str,
                          format_info: dict, sr: int = 44100,
                          progress_cb=None) -> dict:
    """
    Run full stereo vs Atmos comparison.

    1. Load stereo file normally
    2. Load Atmos file preserving all channels
    3. Downmix Atmos to stereo
    4. Run standard stereo comparison (original vs downmix)
    5. Compute Atmos-specific metrics

    Returns extended AnalysisResult dict with 'atmos' and 'comparison_mode' keys.
    """
    layout = format_info["channel_layout"]
    adm = format_info.get("adm_metadata")

    if progress_cb:
        progress_cb("Loading multichannel audio...")

    total_channels = format_info["channels"]
    native_sr = format_info.get("samplerate", sr)

    # Strategy: load at native sample rate, downmix, THEN resample
    # This avoids resampling 62 channels individually (saves huge memory + time)
    if progress_cb:
        progress_cb(f"Loading {total_channels} channels at {native_sr} Hz...")

    multichannel_native, _ = load_multichannel(file_atmos, sr=native_sr, max_channels=0)

    # Build full layout (bed + objects) for downmix
    full_layout = layout

    # Build analysis layout for the bed channels only (first 12 for 7.1.4)
    bed_count = layout.get("bed_channels", min(len(layout["channels"]), total_channels))
    analysis_layout = {
        "name": layout["name"],
        "channels": [ch for ch in layout["channels"] if ch["index"] < bed_count],
    }

    if progress_cb:
        progress_cb(f"Loaded {total_channels} channels ({layout['name']})")

    # ─── Run Dolby QC on original file (native SR, before any processing) ──
    if progress_cb:
        progress_cb("Running Dolby Atmos QC on original file...")

    from atmos_qc import check_atmos_qc, detect_missing_elements
    atmos_qc_result = check_atmos_qc(
        file_path=file_atmos,
        multichannel=multichannel_native,  # ALL channels for accurate loudness/TP
        layout=layout,                     # full layout including objects
        sr=native_sr,
        downmix_stereo=None,
        format_info=format_info,
    )

    if progress_cb:
        progress_cb("Creating stereo downmix...")

    # Downmix ALL channels (bed + objects) at native sample rate
    atmos_downmix_native = downmix_to_stereo(multichannel_native, full_layout)

    # Now resample just the stereo downmix (2 channels instead of 62)
    if native_sr != sr:
        if progress_cb:
            progress_cb(f"Resampling downmix {native_sr} -> {sr} Hz...")
        atmos_downmix = np.array([
            librosa.resample(atmos_downmix_native[ch], orig_sr=native_sr, target_sr=sr)
            for ch in range(2)
        ])
    else:
        atmos_downmix = atmos_downmix_native

    # Prepare spatial analysis data
    # Two modes:
    #   WITH ADM metadata: all channels are properly mapped — use as-is
    #   WITHOUT ADM (flat print): use bed channels only, report object energy separately
    has_adm = adm is not None
    bed_count_actual = layout.get("bed_channels", min(len(layout.get("channels", [])), total_channels))
    has_objects = total_channels > bed_count_actual

    if has_adm or not has_objects:
        # ADM file or pure bed — all channels are meaningful for spatial analysis
        if progress_cb:
            progress_cb("Preparing spatial analysis...")
        spatial_native = multichannel_native[:min(multichannel_native.shape[0], 12)]
        from adm_parser import CHANNEL_LAYOUTS
        n_spatial = spatial_native.shape[0]
        if n_spatial in CHANNEL_LAYOUTS:
            spatial_layout = CHANNEL_LAYOUTS[n_spatial]
        else:
            spatial_layout = {"name": layout["name"], "channels": [ch for ch in layout["channels"] if ch["index"] < n_spatial]}
        object_energy_db = None
    else:
        # Flat print with objects — show bed only, compute object energy
        if progress_cb:
            progress_cb("Analyzing bed channels (object positions unknown)...")
        spatial_native = multichannel_native[:bed_count_actual]
        from adm_parser import CHANNEL_LAYOUTS
        spatial_layout = CHANNEL_LAYOUTS.get(bed_count_actual, {
            "name": f"{bed_count_actual}ch bed",
            "channels": [ch for ch in layout["channels"] if ch["index"] < bed_count_actual],
        })
        # Compute total object energy
        obj_channels = multichannel_native[bed_count_actual:]
        if obj_channels.shape[0] > 0:
            obj_rms = np.sqrt(np.mean(np.sum(obj_channels ** 2, axis=0)))
            object_energy_db = round(float(20 * np.log10(max(obj_rms, 1e-10))), 1)
        else:
            object_energy_db = None

    del multichannel_native  # free memory

    if native_sr != sr:
        if progress_cb:
            progress_cb(f"Resampling for spatial analysis...")
        multichannel = np.array([
            librosa.resample(spatial_native[ch], orig_sr=native_sr, target_sr=sr)
            for ch in range(spatial_native.shape[0])
        ])
        del spatial_native
    else:
        multichannel = spatial_native

    analysis_layout = {
        "name": layout["name"],
        "channels": spatial_layout["channels"],
    }

    # Load stereo original
    stereo_orig, _ = sf.read(file_stereo, dtype='float32')
    if stereo_orig.ndim == 1:
        stereo_orig = np.stack([stereo_orig, stereo_orig])
    else:
        stereo_orig = stereo_orig.T
    # Resample if needed
    file_sr = sf.info(file_stereo).samplerate
    if file_sr != sr:
        stereo_orig = np.array([
            librosa.resample(stereo_orig[ch], orig_sr=file_sr, target_sr=sr)
            for ch in range(stereo_orig.shape[0])
        ])
    # Ensure stereo
    if stereo_orig.shape[0] == 1:
        stereo_orig = np.stack([stereo_orig[0], stereo_orig[0]])
    elif stereo_orig.shape[0] > 2:
        stereo_orig = stereo_orig[:2]

    # Save downmix to temp file for playback and standard analysis
    import tempfile
    import os
    downmix_path = os.path.join(tempfile.gettempdir(), "rtm_atmos_downmix.wav")
    sf.write(downmix_path, atmos_downmix.T, sr)

    if progress_cb:
        progress_cb("Comparing stereo vs Atmos...")

    # Main comparison: always stereo vs level-matched downmix
    # This gives accurate tonal/level differences (what changes when folded to stereo)
    if progress_cb:
        progress_cb("Comparing stereo vs Atmos downmix...")
    result = run_fast_analysis(file_stereo, downmix_path, sr=sr)

    # ADM channel breakdown: supplementary info about what each channel contains
    if has_adm or not has_objects:
        if progress_cb:
            progress_cb("Analyzing Atmos channel content...")
        result["atmos_channels"] = _analyze_adm_channels(multichannel, analysis_layout, sr)

    if progress_cb:
        progress_cb("Computing Atmos spatial metrics...")

    # Compute Atmos-specific metrics (use analysis_layout which matches loaded channels)
    channel_energy = compute_channel_energy(multichannel, analysis_layout)
    height_ratio = compute_height_ratio(multichannel, analysis_layout)
    center_extraction = compute_center_extraction(stereo_orig, multichannel, analysis_layout)
    lfe = compute_lfe_analysis(multichannel, analysis_layout, sr)
    surround_balance = compute_surround_balance(multichannel, analysis_layout)
    downmix_delta = compute_downmix_delta(stereo_orig, atmos_downmix, sr)

    # Add Atmos data to result
    result["comparison_mode"] = "stereo_vs_atmos"
    result["atmos_downmix_path"] = downmix_path
    object_count = layout.get("object_channels", 0)
    if adm and adm.get("object_count", 0) > object_count:
        object_count = adm["object_count"]

    # Object trajectory view (only present when ADM carries per-object position)
    object_view = None
    try:
        from atmos_trajectories import build_atmos_object_view
        traj = (adm or {}).get("object_trajectories", []) if adm else []
        if traj:
            object_view = build_atmos_object_view(traj, duration_sec=float(format_info.get("duration", 0) or 0))
    except Exception:
        object_view = None

    result["atmos"] = {
        "channel_count": format_info["channels"],  # total channels in file
        "channel_layout": layout["name"],
        "programme_name": adm.get("programme_name") if adm else None,
        "object_count": object_count,
        "has_adm": has_adm,
        "object_energy_db": object_energy_db,  # None if no objects or has ADM
        "channel_energy": channel_energy,
        "height_ratio": round(float(height_ratio), 3),
        "center_extraction": round(float(center_extraction), 3),
        "lfe": lfe,
        "surround_balance": surround_balance,
        "downmix_delta": downmix_delta,
    }
    # Put the object view at the top level so it appears in both solo and comparison paths
    if object_view:
        result["atmos_object_view"] = object_view

    # Add downmix loudness check to the QC result (needs the downmix)
    from comparator import compute_lufs as _compute_lufs
    downmix_mono = (atmos_downmix[0] + atmos_downmix[1]) / 2.0
    downmix_lufs = _compute_lufs(downmix_mono, sr)
    _dmx_min, _dmx_max = -31.0, -5.0
    if _dmx_min <= downmix_lufs <= _dmx_max:
        atmos_qc_result["checks"].append({
            "name": "Downmix Loudness",
            "status": "pass",
            "value": f"{downmix_lufs:.1f} LUFS",
            "target": f"{_dmx_min:.0f} to {_dmx_max:.0f} LUFS",
            "message": f"Stereo downmix is {downmix_lufs:.1f} LUFS — within Apple Music range.",
            "suggestion": "",
        })
    else:
        atmos_qc_result["checks"].append({
            "name": "Downmix Loudness",
            "status": "warning",
            "value": f"{downmix_lufs:.1f} LUFS",
            "target": f"{_dmx_min:.0f} to {_dmx_max:.0f} LUFS",
            "message": f"Stereo downmix is {downmix_lufs:.1f} LUFS — outside Apple Music range.",
            "suggestion": "Verify that the stereo fold-down plays at an acceptable level on headphones and speakers.",
        })
        atmos_qc_result["score"] = max(0, atmos_qc_result["score"] - 5)
        if atmos_qc_result["status"] == "pass":
            atmos_qc_result["status"] = "warning"
            atmos_qc_result["summary"] = "1 warning found — review before delivery."

    # Add missing element checks (needs category comparison data)
    missing = detect_missing_elements(result.get("categories", []))
    for elem in missing:
        if elem["severity"] == "missing":
            atmos_qc_result["checks"].append({
                "name": f"Missing: {elem['name']}",
                "status": "fail",
                "value": f"{elem['diff_db']:+.1f} dB",
                "target": "Within 3 dB of stereo",
                "message": elem["message"],
                "suggestion": elem["suggestion"],
            })
            atmos_qc_result["score"] = max(0, atmos_qc_result["score"] - 15)
            atmos_qc_result["status"] = "fail"
        elif elem["severity"] == "reduced":
            atmos_qc_result["checks"].append({
                "name": f"Reduced: {elem['name']}",
                "status": "warning",
                "value": f"{elem['diff_db']:+.1f} dB",
                "target": "Within 3 dB of stereo",
                "message": elem["message"],
                "suggestion": elem["suggestion"],
            })
            atmos_qc_result["score"] = max(0, atmos_qc_result["score"] - 5)
            if atmos_qc_result["status"] == "pass":
                atmos_qc_result["status"] = "warning"

    # Recompute summary after adding downmix + missing checks
    fail_count = sum(1 for c in atmos_qc_result["checks"] if c["status"] == "fail")
    warn_count = sum(1 for c in atmos_qc_result["checks"] if c["status"] == "warning")
    total = len(atmos_qc_result["checks"])
    if fail_count > 0:
        atmos_qc_result["summary"] = f"{fail_count} issue{'s' if fail_count > 1 else ''} must be fixed before delivery."
    elif warn_count > 0:
        atmos_qc_result["summary"] = f"{warn_count} warning{'s' if warn_count > 1 else ''} found — review before delivery."
    else:
        atmos_qc_result["summary"] = f"All {total} Dolby Atmos checks passed. File is ready for delivery."

    result["atmos_qc"] = atmos_qc_result

    # Detect missing/reduced elements for the dedicated panel
    result["atmos"]["missing_elements"] = detect_missing_elements(
        result.get("categories", [])
    )

    # ADM structural validation — beyond the preflight warning.  Emits
    # typed issues (block / warn / info) that AtmosPreflightPanel
    # promotes into the top-level traffic light instead of the user
    # discovering them after ingest.  Panel ask (Jonas, broadcast).
    try:
        adm_for_validation = format_info.get("adm_metadata")
        if adm_for_validation:
            result["adm_validation"] = validate_adm(adm_for_validation, target='apple')
    except Exception as _e:
        result["adm_validation"] = [{"severity": "warn", "code": "validation-error", "message": f"ADM validation failed: {_e}"}]

    return result


def estimate_binaural_tp(multichannel: np.ndarray, layout: dict, sr: int) -> dict:
    """
    Estimate binaural stereo downmix true-peak using a simple HRTF-less model:
    folds bed channels into L/R with mild delay-based decorrelation for sides
    and rears (models the primary ILD cue). This is NOT a full HRTF render,
    but it's a good early-warning for Atmos renders that will over on binaural
    headphone playback.

    Returns {true_peak_db, headroom_db, method}.
    """
    import numpy as _np
    from scipy.signal import resample_poly

    from adm_parser import get_channel_index

    def _ch(name):
        idx = get_channel_index(layout, name)
        return multichannel[idx] if idx is not None and idx < multichannel.shape[0] else None

    # Bed channels (fall back to None if missing)
    L   = _ch("L");   R   = _ch("R")
    C   = _ch("C");   LFE = _ch("LFE")
    Ls  = _ch("Ls");  Rs  = _ch("Rs")
    Lrs = _ch("Lrs"); Rrs = _ch("Rrs")
    Ltf = _ch("Ltf"); Rtf = _ch("Rtf")
    Ltr = _ch("Ltr"); Rtr = _ch("Rtr")

    # Binaural coefficients — approximation favouring ipsilateral ear
    # LFE is routed at -10 dB (bass-heavy phones can over on it)
    def z(x):
        return _np.zeros_like(multichannel[0]) if x is None else x

    left = (
        1.0   * z(L) +
        0.707 * z(C) +
        0.60  * z(Ls) +
        0.35  * z(Rs)  +   # contralateral bleed
        0.40  * z(Lrs) +
        0.25  * z(Rrs) +
        0.75  * z(Ltf) +
        0.50  * z(Ltr) +
        0.31  * z(LFE)
    )
    right = (
        1.0   * z(R) +
        0.707 * z(C) +
        0.60  * z(Rs) +
        0.35  * z(Ls) +
        0.40  * z(Rrs) +
        0.25  * z(Lrs) +
        0.75  * z(Rtf) +
        0.50  * z(Rtr) +
        0.31  * z(LFE)
    )

    # 4× oversampled true-peak
    worst = 0.0
    for ch in (left, right):
        up = resample_poly(ch, 4, 1)
        worst = max(worst, float(_np.max(_np.abs(up))))
    tp_db = float(20 * _np.log10(max(worst, 1e-10)))
    return {
        "true_peak_db": round(tp_db, 1),
        "headroom_db": round(max(0.0, -tp_db), 1),
        "method": "approx-ILD (no HRTF)",
    }


def run_atmos_solo(file_atmos: str, format_info: dict, sr: int = 44100,
                   progress_cb=None) -> dict:
    """
    Solo Atmos analysis — runs the full Atmos QC and spatial metrics on a
    single multichannel file, without any stereo comparison.

    Used when the user drops a single ADM BWF / multichannel file for
    reference-only QC. Returns a result dict shaped like run_atmos_comparison
    but with `comparison_mode = 'atmos_solo'` so the UI hides stereo-specific
    panels.
    """
    import tempfile, os

    layout = format_info["channel_layout"]
    adm = format_info.get("adm_metadata")
    total_channels = format_info["channels"]
    native_sr = format_info.get("samplerate", sr)

    if progress_cb:
        progress_cb(f"Loading {total_channels} channels at {native_sr} Hz...")

    multichannel_native, _ = load_multichannel(file_atmos, sr=native_sr, max_channels=0)

    bed_count = layout.get("bed_channels", min(len(layout["channels"]), total_channels))
    analysis_layout = {
        "name": layout["name"],
        "channels": [ch for ch in layout["channels"] if ch["index"] < bed_count],
    }

    # Dolby QC on original file (native SR)
    if progress_cb:
        progress_cb("Running Dolby Atmos QC...")
    from atmos_qc import check_atmos_qc
    atmos_qc_result = check_atmos_qc(
        file_path=file_atmos,
        multichannel=multichannel_native,
        layout=layout,
        sr=native_sr,
        downmix_stereo=None,
        format_info=format_info,
    )

    # Downmix → stereo for spectrum / playback
    if progress_cb:
        progress_cb("Creating stereo downmix...")
    atmos_downmix_native = downmix_to_stereo(multichannel_native, layout)
    if native_sr != sr:
        atmos_downmix = np.array([
            librosa.resample(atmos_downmix_native[ch], orig_sr=native_sr, target_sr=sr)
            for ch in range(2)
        ])
    else:
        atmos_downmix = atmos_downmix_native

    # Save downmix for playback
    downmix_path = os.path.join(tempfile.gettempdir(), "rtm_atmos_downmix_solo.wav")
    sf.write(downmix_path, atmos_downmix.T, sr)

    # Spatial analysis (bed only for objects-flat prints)
    has_adm = adm is not None
    has_objects = total_channels > bed_count
    if has_adm or not has_objects:
        spatial_native = multichannel_native[:min(multichannel_native.shape[0], 12)]
        from adm_parser import CHANNEL_LAYOUTS
        n_spatial = spatial_native.shape[0]
        spatial_layout = CHANNEL_LAYOUTS.get(n_spatial, {
            "name": layout["name"],
            "channels": [ch for ch in layout["channels"] if ch["index"] < n_spatial],
        })
        object_energy_db = None
    else:
        spatial_native = multichannel_native[:bed_count]
        from adm_parser import CHANNEL_LAYOUTS
        spatial_layout = CHANNEL_LAYOUTS.get(bed_count, {
            "name": f"{bed_count}ch bed",
            "channels": [ch for ch in layout["channels"] if ch["index"] < bed_count],
        })
        obj_channels = multichannel_native[bed_count:]
        obj_rms = np.sqrt(np.mean(np.sum(obj_channels ** 2, axis=0))) if obj_channels.shape[0] > 0 else 0.0
        object_energy_db = round(float(20 * np.log10(max(obj_rms, 1e-10))), 1) if obj_rms > 0 else None

    del multichannel_native

    # Resample spatial channels if needed
    if native_sr != sr:
        multichannel = np.array([
            librosa.resample(spatial_native[ch], orig_sr=native_sr, target_sr=sr)
            for ch in range(spatial_native.shape[0])
        ])
        del spatial_native
    else:
        multichannel = spatial_native

    analysis_layout = {"name": layout["name"], "channels": spatial_layout["channels"]}

    if progress_cb:
        progress_cb("Computing Atmos spatial metrics...")

    channel_energy = compute_channel_energy(multichannel, analysis_layout)
    height_ratio = compute_height_ratio(multichannel, analysis_layout)
    lfe = compute_lfe_analysis(multichannel, analysis_layout, sr)
    surround_balance = compute_surround_balance(multichannel, analysis_layout)

    # Channel breakdown
    atmos_channels = None
    if has_adm or not has_objects:
        atmos_channels = _analyze_adm_channels(multichannel, analysis_layout, sr)

    object_count = layout.get("object_channels", 0)
    if adm and adm.get("object_count", 0) > object_count:
        object_count = adm["object_count"]

    # Downmix loudness into QC
    from comparator import compute_lufs as _compute_lufs
    downmix_mono = (atmos_downmix[0] + atmos_downmix[1]) / 2.0
    downmix_lufs = _compute_lufs(downmix_mono, sr)
    dmx_min, dmx_max = -31.0, -5.0
    if dmx_min <= downmix_lufs <= dmx_max:
        atmos_qc_result["checks"].append({
            "name": "Downmix Loudness",
            "status": "pass",
            "value": f"{downmix_lufs:.1f} LUFS",
            "target": f"{dmx_min:.0f} to {dmx_max:.0f} LUFS",
            "message": f"Stereo downmix is {downmix_lufs:.1f} LUFS — within Apple Music range.",
            "suggestion": "",
        })
    else:
        atmos_qc_result["checks"].append({
            "name": "Downmix Loudness",
            "status": "warning",
            "value": f"{downmix_lufs:.1f} LUFS",
            "target": f"{dmx_min:.0f} to {dmx_max:.0f} LUFS",
            "message": f"Stereo downmix is {downmix_lufs:.1f} LUFS — outside Apple Music range.",
            "suggestion": "Verify the stereo fold-down is acceptable on headphones and speakers.",
        })
        atmos_qc_result["score"] = max(0, atmos_qc_result["score"] - 5)
        if atmos_qc_result["status"] == "pass":
            atmos_qc_result["status"] = "warning"

    # Re-summarise
    fail_count = sum(1 for c in atmos_qc_result["checks"] if c["status"] == "fail")
    warn_count = sum(1 for c in atmos_qc_result["checks"] if c["status"] == "warning")
    total = len(atmos_qc_result["checks"])
    if fail_count > 0:
        atmos_qc_result["summary"] = f"{fail_count} issue{'s' if fail_count > 1 else ''} must be fixed before delivery."
    elif warn_count > 0:
        atmos_qc_result["summary"] = f"{warn_count} warning{'s' if warn_count > 1 else ''} found — review before delivery."
    else:
        atmos_qc_result["summary"] = f"All {total} Dolby Atmos checks passed. File is ready for delivery."

    # ── Binaural headphone TP (early-warning) ──────────────────────────────
    try:
        binaural = estimate_binaural_tp(multichannel, analysis_layout, sr)
        if binaural["true_peak_db"] > -1.0:
            atmos_qc_result["checks"].append({
                "name": "Binaural Headphone TP",
                "status": "warning" if binaural["true_peak_db"] > -0.5 else "pass",
                "value": f"{binaural['true_peak_db']:.1f} dBTP",
                "target": "≤ -1.0 dBTP recommended for binaural playback",
                "message": f"Approximate binaural downmix TP is {binaural['true_peak_db']:.1f} dBTP.",
                "suggestion": "Headphone binaural renderers can peak 1–2 dB above the stereo downmix; consider more TP headroom.",
            })
    except Exception:
        binaural = None

    # ── Summary metrics for the Overview tab.
    # We populate an "overall" block shaped like run_fast_analysis so the UI
    # doesn't crash on missing keys. A and B both show the Atmos / downmix
    # numbers (there is no stereo reference in solo mode).
    try:
        from comparator import compute_stereo_width, compute_short_term_max, compute_plr, compute_dynamic_range
        dmx_width = compute_stereo_width(atmos_downmix[0], atmos_downmix[1])
        dmx_st_max = compute_short_term_max(atmos_downmix, sr)
        dmx_dr = compute_dynamic_range(atmos_downmix, sr)
        dmx_plr = compute_plr(atmos_downmix, sr)
    except Exception:
        dmx_width = 0.0
        dmx_st_max = -70.0
        dmx_dr = 0.0
        dmx_plr = 0.0

    # ── Object trajectories (if ADM metadata includes per-object position data) ──
    object_view = None
    try:
        from atmos_trajectories import build_atmos_object_view
        traj = (adm or {}).get("object_trajectories", []) if adm else []
        if traj:
            object_view = build_atmos_object_view(traj, duration_sec=float(format_info.get("duration", 0) or 0))
    except Exception:
        object_view = None

    return {
        "comparison_mode": "atmos_solo",
        "level_matched": False,
        "gain_applied_db": 0.0,
        "categories": [],
        "recommendations": [],
        "atmos_downmix_path": downmix_path,
        "atmos_channels": atmos_channels or [],
        "atmos_object_view": object_view,
        "overall": {
            "lufs_a": round(downmix_lufs, 1),
            "lufs_b": round(downmix_lufs, 1),
            "loudness_diff": 0.0,
            "short_term_max_a": round(dmx_st_max, 1),
            "short_term_max_b": round(dmx_st_max, 1),
            "plr_a": dmx_plr,
            "plr_b": dmx_plr,
            "width_a": round(float(dmx_width), 3),
            "width_b": round(float(dmx_width), 3),
            "dynamics_a": round(dmx_dr, 1),
            "dynamics_b": round(dmx_dr, 1),
            "insights": [
                f"Atmos solo analysis — {total_channels}ch {layout['name']}. Downmix is {downmix_lufs:.1f} LUFS, TP " + (
                    f"{binaural['true_peak_db']:.1f} dBTP (binaural approx)" if binaural else "measured separately"
                ) + ".",
            ],
        },
        "atmos": {
            "channel_count": total_channels,
            "channel_layout": layout["name"],
            "programme_name": adm.get("programme_name") if adm else None,
            "object_count": object_count,
            "has_adm": has_adm,
            "object_energy_db": object_energy_db,
            "channel_energy": channel_energy,
            "height_ratio": round(float(height_ratio), 3),
            "center_extraction": 0.0,
            "lfe": lfe,
            "surround_balance": surround_balance,
            "binaural_tp": binaural,
            "atmos_lufs": round(downmix_lufs, 1),       # For Atmos tab display
            "downmix_lufs": round(downmix_lufs, 1),
            "downmix_delta": {"categories": [], "overall_diff_db": 0.0, "insight": "Solo analysis — no stereo master to compare."},
        },
        "atmos_qc": atmos_qc_result,
        # ADM structural validation — object cap, trajectory bounds,
        # programme name, channel-format coverage.  Promoted above the
        # preflight traffic light.
        "adm_validation": (validate_adm(adm, target='apple') if adm else []),
    }
