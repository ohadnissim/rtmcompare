"""
Dolby Atmos QC / Compatibility Checker.

Verifies that an Atmos file meets Dolby delivery specifications for
music distribution (Apple Music, Tidal, Amazon Music, etc.).

Key specs checked:
- Integrated loudness: <= -18 LUFS
- True peak: <= -1.0 dBTP (all channels)
- Sample rate: 48 kHz
- Bit depth: 24-bit
- Channel layout: 7.1.4 bed (or acceptable variants)
- Dead/silent channels
- Height channel usage
- LFE content and frequency limits
- Surround balance (L/R symmetry)
- Downmix loudness range
"""

import numpy as np
import soundfile as sf

from comparator import compute_lufs, bandpass

try:
    import soxr as _soxr_atmos
    _ATMOS_HAVE_SOXR = True
except ImportError:
    from scipy.signal import resample_poly as _atmos_resample_poly
    _ATMOS_HAVE_SOXR = False
from adm_parser import get_channel_index, get_group_indices, CHANNEL_GROUPS

ATMOS_REQUIRED_SR = 48000
MIN_SUPPORTED_SR = 44100

# ─── Dolby specs ─────────────────────────────────────────────────────────────

SPECS = {
    "max_integrated_lufs": -18.0,
    "warn_integrated_lufs": -16.0,
    "max_true_peak_dbtp": -1.0,
    "warn_true_peak_dbtp": -0.5,
    "required_sample_rate": ATMOS_REQUIRED_SR,
    "required_bit_depth": 24,
    "dead_channel_threshold_db": -60.0,
    "height_ratio_min": 0.03,
    "height_ratio_warn": 0.01,
    "surround_balance_max_db": 2.0,
    "surround_balance_warn_db": 4.0,
    "lfe_high_freq_cutoff": 120,
    "downmix_min_lufs": -31.0,
    "downmix_max_lufs": -5.0,
    "phase_correlation_min": 0.0,
    "phase_correlation_warn": 0.3,
}


# ─── Measurement helpers ─────────────────────────────────────────────────────

def _true_peak_db(signal, sr: int = ATMOS_REQUIRED_SR, oversample=4):
    """Compute true peak in dBTP using 4× oversampling per BS.1770-4 Annex 2.
    Uses soxr HQ when available (±0.02 dBTP); falls back to resample_poly."""
    if len(signal) == 0:
        return -200.0
    if _ATMOS_HAVE_SOXR:
        up = _soxr_atmos.resample(signal.astype(np.float64), sr, sr * oversample, quality='HQ')
    else:
        up = _atmos_resample_poly(signal, oversample, 1)
    peak = float(np.max(np.abs(up)))
    if peak < 1e-10:
        return -200.0
    return float(20 * np.log10(peak))


def _rms_db(signal):
    """Compute RMS level in dB."""
    if len(signal) == 0:
        return -200.0
    rms = np.sqrt(np.mean(signal ** 2))
    if rms < 1e-10:
        return -200.0
    return float(20 * np.log10(rms))


def _phase_correlation(left, right):
    """Compute phase correlation between two signals. -1 to +1."""
    min_len = min(len(left), len(right))
    l, r = left[:min_len], right[:min_len]
    denom = np.sqrt(np.sum(l ** 2) * np.sum(r ** 2))
    if denom < 1e-10:
        return 0.0
    return float(np.sum(l * r) / denom)


# ─── Main QC function ────────────────────────────────────────────────────────

def check_atmos_qc(file_path, multichannel, layout, sr=MIN_SUPPORTED_SR,
                     downmix_stereo=None, format_info=None):
    """
    Run Dolby Atmos QC checks on a multichannel file.

    Args:
        file_path: path to the original Atmos file
        multichannel: numpy array (channels, samples) — bed channels
        layout: channel layout dict from adm_parser
        sr: sample rate of the multichannel array
        downmix_stereo: optional stereo downmix (2, samples) for downmix loudness check
        format_info: dict from detect_format() with original file info

    Returns:
        dict with status, summary, score, specs, checks, channel_stats
    """
    checks = []
    info = sf.info(file_path) if format_info is None else None
    native_sr = format_info["samplerate"] if format_info else (info.samplerate if info else sr)
    native_channels = format_info["channels"] if format_info else (info.channels if info else multichannel.shape[0])
    duration = format_info["duration"] if format_info else (info.duration if info else multichannel.shape[1] / sr)

    # Determine bit depth from subtype
    if info is None and format_info is None:
        bit_depth = 24  # assume
    else:
        subtype = ""
        try:
            subtype = sf.info(file_path).subtype
        except Exception:
            pass
        if "24" in subtype:
            bit_depth = 24
        elif "16" in subtype:
            bit_depth = 16
        elif "32" in subtype:
            bit_depth = 32
        else:
            bit_depth = 24  # default assumption for Atmos

    bed_count = layout.get("bed_channels", len(layout.get("channels", [])))
    object_count = layout.get("object_channels", max(0, native_channels - bed_count))

    # ─── 1. Sample Rate ──────────────────────────────────────────────────
    if native_sr == SPECS["required_sample_rate"]:
        checks.append({
            "name": "Sample Rate",
            "status": "pass",
            "value": f"{native_sr} Hz",
            "target": f"{SPECS['required_sample_rate']} Hz",
            "message": "Sample rate meets Dolby Atmos spec.",
            "suggestion": "",
        })
    else:
        checks.append({
            "name": "Sample Rate",
            "status": "fail",
            "value": f"{native_sr} Hz",
            "target": f"{SPECS['required_sample_rate']} Hz",
            "message": f"Sample rate is {native_sr} Hz — Dolby Atmos requires 48 kHz.",
            "suggestion": "Resample to 48 kHz before delivery. Use high-quality SRC (e.g., iZotope RX, SoX).",
        })

    # ─── 2. Bit Depth ────────────────────────────────────────────────────
    if bit_depth >= 24:
        checks.append({
            "name": "Bit Depth",
            "status": "pass",
            "value": f"{bit_depth}-bit",
            "target": "24-bit",
            "message": "Bit depth meets Dolby Atmos spec.",
            "suggestion": "",
        })
    elif bit_depth == 16:
        checks.append({
            "name": "Bit Depth",
            "status": "warning",
            "value": "16-bit",
            "target": "24-bit",
            "message": "File is 16-bit — Dolby Atmos recommends 24-bit for optimal quality.",
            "suggestion": "Re-export from your DAW at 24-bit. Don't just convert — re-render from the session.",
        })
    else:
        checks.append({
            "name": "Bit Depth",
            "status": "fail",
            "value": f"{bit_depth}-bit",
            "target": "24-bit",
            "message": f"Unexpected bit depth: {bit_depth}-bit.",
            "suggestion": "Re-export at 24-bit PCM.",
        })

    # ─── 3. Channel Layout ───────────────────────────────────────────────
    layout_name = layout.get("name", "unknown")
    if bed_count >= 12:
        checks.append({
            "name": "Bed Layout",
            "status": "pass",
            "value": f"{layout_name} ({native_channels}ch total)",
            "target": "7.1.4 bed (12ch minimum)",
            "message": f"Bed layout: {layout_name} with {object_count} objects.",
            "suggestion": "",
        })
    elif bed_count >= 6:
        checks.append({
            "name": "Bed Layout",
            "status": "warning",
            "value": f"{layout_name} ({native_channels}ch)",
            "target": "7.1.4 bed (12ch)",
            "message": f"Bed is {layout_name} — fewer than 12 channels. Full 7.1.4 recommended for music.",
            "suggestion": "Consider using a 7.1.4 bed for full Atmos immersion.",
        })
    else:
        checks.append({
            "name": "Bed Layout",
            "status": "fail",
            "value": f"{native_channels}ch",
            "target": "7.1.4 bed (12ch)",
            "message": f"Only {native_channels} channels — not a valid Atmos layout.",
            "suggestion": "Atmos music requires at least a 5.1 bed (6ch). Re-render from Dolby Atmos Renderer.",
        })

    # ─── 4. Integrated Loudness ────────────────────────────────────────
    # Measure BOTH: original Atmos bed and rendered downmix
    from atmos_comparator import downmix_to_stereo

    # A) Original Atmos — L/R bed channels
    l_idx = get_channel_index(layout, "L")
    r_idx = get_channel_index(layout, "R")
    if l_idx is not None and r_idx is not None and l_idx < multichannel.shape[0] and r_idx < multichannel.shape[0]:
        atmos_lufs = compute_lufs(np.stack([multichannel[l_idx], multichannel[r_idx]]).T, sr)
    else:
        atmos_lufs = -70.0

    # A) Original Atmos — true peak across bed channels
    atmos_tp = -200.0
    atmos_tp_ch = "N/A"
    bed_limit = min(layout.get("bed_channels", 12), multichannel.shape[0], 12)
    for idx in range(bed_limit):
        rms = np.sqrt(np.mean(multichannel[idx] ** 2))
        if rms < 1e-6:
            continue
        tp = _true_peak_db(multichannel[idx])
        if tp > atmos_tp:
            atmos_tp = tp
            ch_def = next((c for c in layout.get("channels", []) if c["index"] == idx), None)
            atmos_tp_ch = ch_def["id"] if ch_def else f"Ch{idx+1}"

    # B) Rendered downmix
    quick_downmix = downmix_to_stereo(multichannel, layout)
    integrated_lufs = compute_lufs(quick_downmix.T, sr)

    if integrated_lufs <= SPECS["max_integrated_lufs"]:
        checks.append({
            "name": "Downmix Loudness",
            "status": "pass",
            "value": f"{integrated_lufs:.1f} LUFS",
            "target": f"<= {SPECS['max_integrated_lufs']:.0f} LUFS",
            "message": f"Loudness is {integrated_lufs:.1f} LUFS — within Dolby spec.",
            "suggestion": "",
        })
    elif integrated_lufs <= SPECS["warn_integrated_lufs"]:
        checks.append({
            "name": "Downmix Loudness",
            "status": "warning",
            "value": f"{integrated_lufs:.1f} LUFS",
            "target": f"<= {SPECS['max_integrated_lufs']:.0f} LUFS",
            "message": f"Loudness is {integrated_lufs:.1f} LUFS — close to the -18 LUFS limit.",
            "suggestion": "Consider reducing overall level slightly. Platforms may apply limiting.",
        })
    else:
        checks.append({
            "name": "Downmix Loudness",
            "status": "fail",
            "value": f"{integrated_lufs:.1f} LUFS",
            "target": f"<= {SPECS['max_integrated_lufs']:.0f} LUFS",
            "message": f"Loudness is {integrated_lufs:.1f} LUFS — exceeds the -18 LUFS maximum.",
            "suggestion": f"Reduce overall level by at least {integrated_lufs - SPECS['max_integrated_lufs']:.1f} dB. Atmos music should target -18 LUFS or below.",
        })

    # ─── 5. True Peak (rendered downmix) ────────────────────────────────
    worst_tp = max(_true_peak_db(quick_downmix[0]), _true_peak_db(quick_downmix[1]))
    worst_tp_channel = "rendered downmix"

    # Add Atmos bed readings as separate checks
    checks.append({
        "name": "Atmos Bed LUFS",
        "status": "pass",
        "value": f"{atmos_lufs:.1f} LUFS",
        "target": "Informational",
        "message": f"Original Atmos bed L/R loudness: {atmos_lufs:.1f} LUFS",
        "suggestion": "",
    })
    checks.append({
        "name": "Atmos Bed True Peak",
        "status": "pass" if atmos_tp <= -1.0 else "warning",
        "value": f"{atmos_tp:.1f} dBTP ({atmos_tp_ch})",
        "target": "<= -1.0 dBTP",
        "message": f"Loudest bed channel: {atmos_tp:.1f} dBTP on {atmos_tp_ch}",
        "suggestion": "" if atmos_tp <= -1.0 else "Bed channel exceeds -1.0 dBTP — may clip on some playback systems.",
    })

    if worst_tp <= SPECS["max_true_peak_dbtp"]:
        checks.append({
            "name": "Downmix True Peak",
            "status": "pass",
            "value": f"{worst_tp:.1f} dBTP ({worst_tp_channel})",
            "target": f"<= {SPECS['max_true_peak_dbtp']:.1f} dBTP",
            "message": f"True peak is {worst_tp:.1f} dBTP — within spec.",
            "suggestion": "",
        })
    elif worst_tp <= SPECS["warn_true_peak_dbtp"]:
        checks.append({
            "name": "Downmix True Peak",
            "status": "warning",
            "value": f"{worst_tp:.1f} dBTP ({worst_tp_channel})",
            "target": f"<= {SPECS['max_true_peak_dbtp']:.1f} dBTP",
            "message": f"True peak is {worst_tp:.1f} dBTP on {worst_tp_channel} — close to the -1.0 dBTP limit.",
            "suggestion": "Apply a true peak limiter set to -1.0 dBTP on the master output.",
        })
    else:
        checks.append({
            "name": "Downmix True Peak",
            "status": "fail",
            "value": f"{worst_tp:.1f} dBTP ({worst_tp_channel})",
            "target": f"<= {SPECS['max_true_peak_dbtp']:.1f} dBTP",
            "message": f"True peak exceeds limit at {worst_tp:.1f} dBTP on {worst_tp_channel}.",
            "suggestion": f"Apply a true peak limiter (ceiling -1.0 dBTP). Channel {worst_tp_channel} is {worst_tp - SPECS['max_true_peak_dbtp']:.1f} dB over.",
        })

    # ─── 6. Dead/Silent Channels ─────────────────────────────────────────
    silent_channels = []
    active_channels = []
    channel_levels = {}
    for ch in layout.get("channels", []):
        if ch["index"] >= multichannel.shape[0]:
            continue
        if ch["id"].startswith("Obj"):
            continue  # skip objects
        level = _rms_db(multichannel[ch["index"]])
        channel_levels[ch["id"]] = level
        if level < SPECS["dead_channel_threshold_db"]:
            silent_channels.append(ch["id"])
        else:
            active_channels.append(ch["id"])

    # Don't count LFE or height as "must have content" — they're optional
    required_channels = {"L", "R"}
    missing_required = [ch for ch in required_channels if ch in silent_channels]

    if not missing_required and len(silent_channels) <= 2:
        status = "pass" if len(silent_channels) == 0 else "warning"
        checks.append({
            "name": "Channel Activity",
            "status": status,
            "value": f"{len(active_channels)} active, {len(silent_channels)} silent",
            "target": "All bed channels active",
            "message": f"Silent channels: {', '.join(silent_channels)}" if silent_channels else "All bed channels have content.",
            "suggestion": "Consider adding content to silent channels for a more immersive experience." if silent_channels else "",
        })
    elif missing_required:
        checks.append({
            "name": "Channel Activity",
            "status": "fail",
            "value": f"{len(active_channels)} active, {len(silent_channels)} silent",
            "target": "L/R must have content",
            "message": f"L/R channels are silent! Missing: {', '.join(silent_channels)}.",
            "suggestion": "Essential channels (L, R) must contain audio. Re-check your Atmos render.",
        })
    else:
        # Many silent bed channels but L/R are fine — likely object-based mix
        checks.append({
            "name": "Channel Activity",
            "status": "warning",
            "value": f"{len(active_channels)} active, {len(silent_channels)} silent",
            "target": "All bed channels active",
            "message": f"Silent bed channels: {', '.join(silent_channels)}. Content may be in audio objects instead.",
            "suggestion": "This is common for object-heavy mixes. Verify that surround/height content is carried by objects and renders correctly on all playback systems.",
        })

    # ─── 7. Height Channel Usage ─────────────────────────────────────────
    height_ids = CHANNEL_GROUPS.get("height", [])
    height_levels = {ch_id: channel_levels.get(ch_id, -200) for ch_id in height_ids}
    active_height = [ch_id for ch_id, lvl in height_levels.items() if lvl > -40]

    # Compute height energy ratio from the loaded multichannel data
    height_indices = get_group_indices(layout, "height")
    all_non_lfe = [ch["index"] for ch in layout.get("channels", [])
                   if ch["id"] not in CHANNEL_GROUPS["lfe"]
                   and ch["index"] < multichannel.shape[0]
                   and not ch["id"].startswith("Obj")]
    height_energy = sum(np.mean(multichannel[i] ** 2) for i in height_indices if i < multichannel.shape[0])
    total_energy = sum(np.mean(multichannel[i] ** 2) for i in all_non_lfe) if all_non_lfe else 1e-10
    height_ratio = float(height_energy / max(total_energy, 1e-10))

    if height_ratio >= SPECS["height_ratio_min"]:
        checks.append({
            "name": "Height Usage",
            "status": "pass",
            "value": f"{height_ratio*100:.1f}% ({len(active_height)} active)",
            "target": f"> {SPECS['height_ratio_min']*100:.0f}% energy in height",
            "message": f"Height channels carry {height_ratio*100:.1f}% of energy — good spatial use.",
            "suggestion": "",
        })
    elif height_ratio >= SPECS["height_ratio_warn"]:
        checks.append({
            "name": "Height Usage",
            "status": "warning",
            "value": f"{height_ratio*100:.1f}%",
            "target": f"> {SPECS['height_ratio_min']*100:.0f}%",
            "message": f"Height channels have only {height_ratio*100:.1f}% of energy — minimal spatial height.",
            "suggestion": "Consider sending reverb returns, ambient elements, or pad layers to height channels.",
        })
    else:
        checks.append({
            "name": "Height Usage",
            "status": "fail" if not active_height else "warning",
            "value": f"{height_ratio*100:.2f}%",
            "target": f"> {SPECS['height_ratio_min']*100:.0f}%",
            "message": "Height channels are essentially empty — this doesn't utilize the Atmos format.",
            "suggestion": "Send reverbs, ambient textures, or synth pads to height speakers. Without height content, consider delivering as 7.1 instead.",
        })

    # ─── 8. LFE Check ────────────────────────────────────────────────────
    lfe_idx = get_channel_index(layout, "LFE")
    if lfe_idx is not None and lfe_idx < multichannel.shape[0]:
        lfe_signal = multichannel[lfe_idx]
        lfe_level = _rms_db(lfe_signal)
        lfe_has_content = lfe_level > -40

        # Check for high-frequency content
        lfe_hf = bandpass(lfe_signal, sr, SPECS["lfe_high_freq_cutoff"], min(sr // 2 - 1, 20000))
        lfe_hf_level = _rms_db(lfe_hf)

        # LFE true peak
        lfe_tp = _true_peak_db(lfe_signal)

        if lfe_has_content and lfe_hf_level < lfe_level - 20:
            lfe_status = "pass"
            lfe_msg = f"LFE at {lfe_level:.1f} dB — clean low-frequency content."
            lfe_sug = ""
        elif lfe_has_content:
            lfe_status = "warning"
            lfe_msg = f"LFE has high-frequency content ({lfe_hf_level:.1f} dB above {SPECS['lfe_high_freq_cutoff']} Hz)."
            lfe_sug = f"Apply a low-pass filter at {SPECS['lfe_high_freq_cutoff']} Hz on the LFE channel."
        else:
            lfe_status = "warning"
            lfe_msg = "LFE channel is empty or very quiet."
            lfe_sug = "Consider routing sub-bass content to the LFE channel for systems with dedicated subwoofers."

        checks.append({
            "name": "LFE Channel",
            "status": lfe_status,
            "value": f"{lfe_level:.1f} dB" if lfe_has_content else "Empty",
            "target": f"Active, < {SPECS['lfe_high_freq_cutoff']} Hz",
            "message": lfe_msg,
            "suggestion": lfe_sug,
        })

        # LFE true peak
        if lfe_tp > SPECS["max_true_peak_dbtp"]:
            checks.append({
                "name": "LFE True Peak",
                "status": "fail",
                "value": f"{lfe_tp:.1f} dBTP",
                "target": f"<= {SPECS['max_true_peak_dbtp']:.1f} dBTP",
                "message": f"LFE true peak exceeds limit at {lfe_tp:.1f} dBTP.",
                "suggestion": "Apply a limiter to the LFE channel.",
            })

    # ─── 9. Surround Balance ─────────────────────────────────────────────
    ls_level = channel_levels.get("Ls", -200)
    rs_level = channel_levels.get("Rs", -200)
    lrs_level = channel_levels.get("Lrs", -200)
    rrs_level = channel_levels.get("Rrs", -200)

    lr_diff = abs(ls_level - rs_level) if ls_level > -60 and rs_level > -60 else 0
    rear_diff = abs(lrs_level - rrs_level) if lrs_level > -60 and rrs_level > -60 else 0
    max_imbalance = max(lr_diff, rear_diff)

    if max_imbalance <= SPECS["surround_balance_max_db"]:
        checks.append({
            "name": "Surround Balance",
            "status": "pass",
            "value": f"{max_imbalance:.1f} dB imbalance",
            "target": f"<= {SPECS['surround_balance_max_db']:.0f} dB L/R difference",
            "message": "Surround channels are well balanced.",
            "suggestion": "",
        })
    elif max_imbalance <= SPECS["surround_balance_warn_db"]:
        checks.append({
            "name": "Surround Balance",
            "status": "warning",
            "value": f"{max_imbalance:.1f} dB imbalance",
            "target": f"<= {SPECS['surround_balance_max_db']:.0f} dB",
            "message": f"Surround channels have {max_imbalance:.1f} dB L/R imbalance.",
            "suggestion": "Check surround panning — ensure intentional asymmetry or rebalance.",
        })
    else:
        checks.append({
            "name": "Surround Balance",
            "status": "fail",
            "value": f"{max_imbalance:.1f} dB imbalance",
            "target": f"<= {SPECS['surround_balance_max_db']:.0f} dB",
            "message": f"Surround channels are severely imbalanced ({max_imbalance:.1f} dB).",
            "suggestion": "Large L/R differences in surround channels will sound unbalanced. Rebalance in your Atmos session.",
        })

    # ─── 10. L/R Phase Correlation ───────────────────────────────────────
    l_idx = get_channel_index(layout, "L")
    r_idx = get_channel_index(layout, "R")
    if l_idx is not None and r_idx is not None and l_idx < multichannel.shape[0] and r_idx < multichannel.shape[0]:
        phase_corr = _phase_correlation(multichannel[l_idx], multichannel[r_idx])

        if phase_corr >= SPECS["phase_correlation_warn"]:
            checks.append({
                "name": "L/R Phase",
                "status": "pass",
                "value": f"{phase_corr:.2f}",
                "target": f"> {SPECS['phase_correlation_warn']:.1f}",
                "message": f"L/R correlation is {phase_corr:.2f} — good mono compatibility.",
                "suggestion": "",
            })
        elif phase_corr >= SPECS["phase_correlation_min"]:
            checks.append({
                "name": "L/R Phase",
                "status": "warning",
                "value": f"{phase_corr:.2f}",
                "target": f"> {SPECS['phase_correlation_warn']:.1f}",
                "message": f"L/R correlation is low ({phase_corr:.2f}) — may lose content in mono/stereo downmix.",
                "suggestion": "Check for excessive stereo widening or out-of-phase processing on L/R bed.",
            })
        else:
            checks.append({
                "name": "L/R Phase",
                "status": "fail",
                "value": f"{phase_corr:.2f}",
                "target": f"> {SPECS['phase_correlation_min']:.1f}",
                "message": f"L/R are out of phase ({phase_corr:.2f}) — will cancel in mono/stereo downmix!",
                "suggestion": "Check for polarity inversions on L or R bed channels. This will cause major issues on stereo playback.",
            })

    # ─── 11. Downmix Loudness ────────────────────────────────────────────
    if downmix_stereo is not None:
        downmix_mono = (downmix_stereo[0] + downmix_stereo[1]) / 2.0
        downmix_lufs = compute_lufs(downmix_mono, sr)

        if SPECS["downmix_min_lufs"] <= downmix_lufs <= SPECS["downmix_max_lufs"]:
            checks.append({
                "name": "Downmix Loudness",
                "status": "pass",
                "value": f"{downmix_lufs:.1f} LUFS",
                "target": f"{SPECS['downmix_min_lufs']:.0f} to {SPECS['downmix_max_lufs']:.0f} LUFS",
                "message": f"Stereo downmix is {downmix_lufs:.1f} LUFS — within Apple Music range.",
                "suggestion": "",
            })
        else:
            checks.append({
                "name": "Downmix Loudness",
                "status": "warning",
                "value": f"{downmix_lufs:.1f} LUFS",
                "target": f"{SPECS['downmix_min_lufs']:.0f} to {SPECS['downmix_max_lufs']:.0f} LUFS",
                "message": f"Stereo downmix is {downmix_lufs:.1f} LUFS — outside Apple Music range.",
                "suggestion": "Verify that the stereo fold-down plays at an acceptable level on headphones and speakers.",
            })

    # ─── Compute overall status and score ─────────────────────────────────
    fail_count = sum(1 for c in checks if c["status"] == "fail")
    warn_count = sum(1 for c in checks if c["status"] == "warning")
    pass_count = sum(1 for c in checks if c["status"] == "pass")
    total = len(checks)

    if fail_count > 0:
        status = "fail"
    elif warn_count > 0:
        status = "warning"
    else:
        status = "pass"

    # Score: 100 base, -15 per fail, -5 per warning
    score = max(0, min(100, 100 - (fail_count * 15) - (warn_count * 5)))

    # Summary
    if status == "pass":
        summary = f"All {total} Dolby Atmos checks passed. File is ready for delivery."
    elif status == "warning":
        summary = f"{warn_count} warning{'s' if warn_count > 1 else ''} found — review before delivery."
    else:
        summary = f"{fail_count} issue{'s' if fail_count > 1 else ''} must be fixed before delivery."

    # Channel stats
    loudest = max(channel_levels.items(), key=lambda x: x[1]) if channel_levels else ("N/A", -200)
    active_levels = {k: v for k, v in channel_levels.items() if v > SPECS["dead_channel_threshold_db"]}
    quietest = min(active_levels.items(), key=lambda x: x[1]) if active_levels else ("N/A", -200)

    return {
        "status": status,
        "summary": summary,
        "score": score,
        "specs": {
            "loudness_lufs": round(integrated_lufs, 1),
            "true_peak_dbtp": round(worst_tp, 1),
            "atmos_bed_lufs": round(atmos_lufs, 1),
            "atmos_bed_tp": round(atmos_tp, 1),
            "sample_rate": native_sr,
            "bit_depth": bit_depth,
            "channel_count": native_channels,
            "layout": layout_name,
            "duration_sec": round(duration, 1),
        },
        "checks": checks,
        "channel_stats": {
            "active_channels": len(active_channels),
            "silent_channels": silent_channels,
            "loudest_channel": loudest[0],
            "quietest_active": quietest[0],
        },
    }


# ─── Missing Element Detection ───────────────────────────────────────────────

# Thresholds for detecting missing/reduced elements
MISSING_THRESHOLD_DB = -8.0    # > 8 dB quieter = likely missing
REDUCED_THRESHOLD_DB = -4.0    # > 4 dB quieter = significantly reduced

# Human-readable descriptions for each category
ELEMENT_DESCRIPTIONS = {
    "Kick":        "kick drum",
    "Snare":       "snare drum",
    "Sub":         "sub bass",
    "Bass":        "bass",
    "Vocals":      "vocals",
    "Instruments": "instruments (keys/guitars/synths)",
    "Brightness":  "high-mid presence (3-10 kHz)",
    "Air":         "top-end air (10-20 kHz)",
    "Wideness":    "stereo width",
    "Punch":       "transient punch",
}


def detect_missing_elements(categories):
    """
    Detect elements that are significantly quieter or missing in the Atmos
    downmix compared to the original stereo mix.

    Uses the per-category level_diff from the stereo vs downmix comparison.
    A large negative level_diff means that element is quieter in the Atmos downmix.

    Args:
        categories: list of category dicts from run_fast_analysis
                    (each has 'name', 'level_diff', 'width_a', 'width_b', etc.)

    Returns:
        list of missing/reduced element dicts with severity, message, suggestion
    """
    results = []

    for cat in categories:
        name = cat.get("name", "")
        diff = cat.get("level_diff", 0)
        desc = ELEMENT_DESCRIPTIONS.get(name, name.lower())

        # Only flag elements that are quieter in the Atmos downmix (negative diff)
        if diff <= MISSING_THRESHOLD_DB:
            results.append({
                "name": name,
                "severity": "missing",
                "diff_db": round(diff, 1),
                "message": f"{name} is {abs(diff):.1f} dB quieter in the Atmos downmix — the {desc} may be missing or severely reduced in the Atmos mix.",
                "suggestion": f"Check your Atmos session — the {desc} may not be routed to any bed channel or object. Verify it plays correctly in the Dolby Renderer.",
            })
        elif diff <= REDUCED_THRESHOLD_DB:
            results.append({
                "name": name,
                "severity": "reduced",
                "diff_db": round(diff, 1),
                "message": f"{name} is {abs(diff):.1f} dB quieter in the Atmos downmix — the {desc} is noticeably reduced compared to stereo.",
                "suggestion": f"The {desc} loses level in the stereo downmix. This may be intentional (spatial spread), but verify it sounds balanced on stereo playback devices.",
            })

        # Also flag elements that are significantly louder (could indicate routing issues)
        elif diff >= 8.0:
            results.append({
                "name": name,
                "severity": "reduced",  # use "reduced" severity for UI (warning level)
                "diff_db": round(diff, 1),
                "message": f"{name} is {diff:.1f} dB louder in the Atmos downmix — the {desc} may be double-routed or over-amplified.",
                "suggestion": f"Check if the {desc} is accidentally routed to multiple bed channels or objects, causing summing when folded to stereo.",
            })

    return results
