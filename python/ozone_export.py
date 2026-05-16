"""
ozone_export.py — Generate iZotope Ozone 9/10/11/12 compatible XML preset files
from RTMcompare mastering-delta analysis data.

Format: OzoneMS XML (the full-chain preset format used by Ozone 9+).
All module sections are included; inactive ones have Enabled="0".

The schema was reverse-engineered from factory presets at:
  /Library/Application Support/iZotope/Ozone 12 */Presets/

Key parameter mappings:
  EQ       : Band N Frequency (Hz), Band N Gain (dB), Band N Q, Band N Shape (2=Bell)
  Maximizer: Threshold (input dBTP), Margin (output ceiling dBTP), Mode (3=IRC4),
             Character (0=transparent, 10=aggressive)
  Imager   : Num Bands, Crossover Cutoff N (Hz), Band N Width Percent (-100 to +100)
  Dynamics : Band N Comp Threshold (dBFS), Band N Comp Ratio, Band N Comp Attack (ms),
             Band N Comp Release (ms), Band N Comp Soft Knee (0-10), Num Bands (1)
"""

import time
from xml.etree import ElementTree as ET


# ─── Module-level XML helpers ─────────────────────────────────────────────────

def _param(parent: ET.Element, element_id: str, param_id: str, value: float | int | str) -> None:
    attrib = {"ElementID": element_id, "ParamID": param_id}
    if isinstance(value, float):
        attrib["Value"] = f"{value:.8f}"
    else:
        attrib["Value"] = str(value)
    ET.SubElement(parent, "Param", attrib)


def _extra(parent: ET.Element, element_id: str, data: str = "") -> None:
    ET.SubElement(parent, "ExtraBytes", {"ElementID": element_id, "Data": data})


def _disabled_module(root: ET.Element, tag: str, element_id: str) -> None:
    el = ET.SubElement(root, tag, {"Enabled": "0"})
    _extra(el, element_id)


# ─── Module builders ──────────────────────────────────────────────────────────

def _build_eq(root: ET.Element, bands: list[dict]) -> None:
    """
    bands: list of { freq: Hz, gain_db: float, q: float }
    Ozone EQ band shape 2 = Bell/Peak (standard).
    Ozone band numbering starts at 1. Low bands are placed at lower band numbers.
    """
    eq = ET.SubElement(root, "EQ", {"Enabled": "1"})
    for i, band in enumerate(bands[:8], start=1):  # Ozone supports up to 8 bands
        eid = "Equalizer"
        _param(eq, eid, f"Band {i} Enable", 1)
        _param(eq, eid, f"Band {i} Visible", 1)
        _param(eq, eid, f"Band {i} Shape", 2)       # Bell
        _param(eq, eid, f"Band {i} Frequency", float(band["freq"]))
        _param(eq, eid, f"Band {i} Gain", float(band["gain_db"]))
        _param(eq, eid, f"Band {i} Q", float(band.get("q", 1.4)))
    _extra(eq, "Equalizer")


def _build_eq_disabled(root: ET.Element) -> None:
    eq = ET.SubElement(root, "EQ", {"Enabled": "0"})
    _extra(eq, "Equalizer")


def _build_maximizer(root: ET.Element, threshold: float, margin: float,
                     mode: int = 3, character: float = 3.0) -> None:
    """
    threshold: input threshold in dBTP (typically margin - GR, e.g. -3.0)
    margin   : output ceiling in dBTP (typically -1.0 or -2.0)
    mode     : 3 = IRC4 (most transparent), 0 = IRC1
    character: 0-10, lower = more transparent
    """
    mx = ET.SubElement(root, "Maximizer", {"Enabled": "1"})
    _param(mx, "Maximizer", "Mode", mode)
    _param(mx, "Maximizer", "Threshold", float(threshold))
    _param(mx, "Maximizer", "Margin", float(margin))
    _param(mx, "Maximizer", "Character", float(character))
    _param(mx, "Maximizer", "Spectral Shaping Style", 2)
    _extra(mx, "Maximizer")


def _build_maximizer_disabled(root: ET.Element) -> None:
    mx = ET.SubElement(root, "Maximizer", {"Enabled": "0"})
    _extra(mx, "Maximizer")


def _build_imager(root: ET.Element, num_bands: int, crossover_hz: float,
                  band_widths: list[float]) -> None:
    """
    num_bands   : number of active crossover bands (1 = single-band, 2 = low/high split)
    crossover_hz: frequency separating band 1 from band 2
    band_widths : list of width percentages per band (-100=mono, 0=unchanged, +100=wider)
    """
    img = ET.SubElement(root, "Imager", {"Enabled": "1"})
    eid = "Stereo Imager"
    _param(img, eid, "Num Bands", num_bands)
    _param(img, eid, "Crossover Cutoff 1", float(crossover_hz))
    _param(img, eid, "Crossover Cutoff 2", 4000.0)   # inactive band 3 boundary
    _param(img, eid, "Crossover Cutoff 3", 12000.0)  # inactive band 4 boundary
    for i, w in enumerate(band_widths[:4], start=1):
        _param(img, eid, f"Band {i} Width Percent", float(w))
        _param(img, eid, f"Band {i} Active", 1)
    # Fill remaining bands with 0 (no change)
    for i in range(len(band_widths) + 1, 5):
        _param(img, eid, f"Band {i} Width Percent", 0.0)
        _param(img, eid, f"Band {i} Active", 0)
    _extra(img, eid)


def _build_imager_disabled(root: ET.Element) -> None:
    img = ET.SubElement(root, "Imager", {"Enabled": "0"})
    _extra(img, "Stereo Imager")


def _build_dynamics(root: ET.Element, threshold: float, ratio: float,
                    attack_ms: float, release_ms: float, knee: float = 3.0) -> None:
    """Single-band master bus compressor settings."""
    dyn = ET.SubElement(root, "Dynamics", {"Enabled": "1"})
    eid = "Dynamics"
    _param(dyn, eid, "Num Bands", 1)
    _param(dyn, eid, "Detection Method", 2)  # True Peak
    _param(dyn, eid, "Auto Gain Compensation", 1)
    _param(dyn, eid, "Lookahead", 0.0)
    _param(dyn, eid, "Band 1 Comp Threshold", float(threshold))
    _param(dyn, eid, "Band 1 Comp Ratio", float(ratio))
    _param(dyn, eid, "Band 1 Comp Attack", float(attack_ms))
    _param(dyn, eid, "Band 1 Comp Release", float(release_ms))
    _param(dyn, eid, "Band 1 Comp Soft Knee", float(knee))
    _param(dyn, eid, "Band 1 Gain", 0.5)       # unity (Ozone normalises to 0.5)
    _param(dyn, eid, "Band 1 Mix", 100.0)       # 100% wet
    _extra(dyn, eid)


def _build_dynamics_disabled(root: ET.Element) -> None:
    dyn = ET.SubElement(root, "Dynamics", {"Enabled": "0"})
    _extra(dyn, "Dynamics")


# ─── Top-level preset builder ─────────────────────────────────────────────────

def generate_ozone_preset(
    mastering_delta: dict,
    track_name: str = "",
    include_eq: bool = True,
    include_dynamics: bool = True,
    include_imager: bool = True,
    include_maximizer: bool = True,
) -> str:
    """
    Generate an OzoneMS XML preset string from RTMcompare mastering-delta data.

    Args:
        mastering_delta: The `mastering_delta` dict from comparator.py output.
        track_name     : Used in the Comments attribute of the preset.
        include_*      : Toggle individual modules.

    Returns:
        UTF-8 XML string. Save as '<name>.xml' in:
        ~/Documents/iZotope/Ozone [version]/User Presets/
    """
    chain = mastering_delta.get("chain_recommendations") or {}
    eq_match = mastering_delta.get("eq_match") or {}
    eq_bands = eq_match.get("bands") or []

    ts = int(time.time())
    comment = f"RTMcompare — {track_name}" if track_name else "RTMcompare generated preset"
    root = ET.Element("OzoneMS", {
        "PresetVer": "4",
        "PluginVer": "120000",
        "PluginBuild": "0",
        "Comments": comment,
        "LastModified": str(ts),
    })

    # ── Clarity (disabled) ──────────────────────────────────────
    _disabled_module(root, "Clarity", "Clarity")

    # ── DynamicEQ (disabled) ────────────────────────────────────
    _disabled_module(root, "DynamicEQ", "Dynamic EQ")

    # ── Dynamics ────────────────────────────────────────────────
    comp = chain.get("compression")
    if include_dynamics and comp and comp.get("severity") not in ("none", None):
        # Parse hints into numeric values
        ratio_map = {
            "1.5:1–2:1": 1.75, "2:1 or less": 1.75, "2:1–3:1": 2.5, "3:1–4:1": 3.5
        }
        attack_map = {"10–30 ms": 20.0, "20–50 ms": 35.0, "40–80 ms": 60.0}
        release_map = {"100–200 ms": 150.0, "150–300 ms": 200.0, "200–400 ms": 300.0}
        ratio = 2.0
        for k, v in ratio_map.items():
            if k in (comp.get("ratio_hint") or ""):
                ratio = v
                break
        attack = 30.0
        for k, v in attack_map.items():
            if k in (comp.get("attack_hint") or ""):
                attack = v
                break
        release = 200.0
        for k, v in release_map.items():
            if k in (comp.get("release_hint") or ""):
                release = v
                break
        # Threshold: aim for -20 dBFS (safe glue compression starting point)
        _build_dynamics(root, threshold=-20.0, ratio=ratio,
                        attack_ms=attack, release_ms=release, knee=4.0)
    else:
        _build_dynamics_disabled(root)

    # ── EQ ──────────────────────────────────────────────────────
    if include_eq and eq_bands:
        _build_eq(root, eq_bands)
    else:
        _build_eq_disabled(root)

    # ── EQ2 (post-EQ, disabled) ─────────────────────────────────
    _disabled_module(root, "EQ2", "Post Equalizer")

    # ── Exciter (disabled) ──────────────────────────────────────
    _disabled_module(root, "Exciter", "Exciter")

    # ── Global block ────────────────────────────────────────────
    glob = ET.SubElement(root, "Global", {"Enabled": "0"})
    _extra(glob, "ElementChain", "")
    _extra(glob, "Global", "")

    # ── Imager ──────────────────────────────────────────────────
    stereo = chain.get("stereo")
    if include_imager and stereo:
        oz = stereo.get("ozone") or {}
        num_bands = oz.get("num_bands", 2)
        xover = oz.get("crossover_hz", 120.0)
        band_widths = [
            oz.get("band1_width_pct", 0.0),
            oz.get("band2_width_pct", 0.0),
        ]
        _build_imager(root, num_bands=num_bands, crossover_hz=xover,
                      band_widths=band_widths)
    else:
        _build_imager_disabled(root)

    # ── Impact (disabled) ───────────────────────────────────────
    _disabled_module(root, "Impact", "Impact")

    # ── LowEndFocus (disabled) ──────────────────────────────────
    _disabled_module(root, "LowEndFocus", "Low End Focus")

    # ── MasterRebalance (disabled) ──────────────────────────────
    _disabled_module(root, "MasterRebalance", "Master Rebalance")

    # ── MatchEQ (disabled) ──────────────────────────────────────
    match_eq = ET.SubElement(root, "MatchEQ", {"Enabled": "0"})
    _extra(match_eq, "Match Equalizer")
    _extra(match_eq, "Snapshot")

    # ── Maximizer ───────────────────────────────────────────────
    lim = chain.get("limiter")
    if include_maximizer and lim:
        oz_lim = lim.get("ozone") or {}
        _build_maximizer(
            root,
            threshold=oz_lim.get("threshold", -3.0),
            margin=oz_lim.get("margin", -1.0),
            mode=oz_lim.get("mode", 3),
            character=oz_lim.get("character", 3.0),
        )
    else:
        _build_maximizer_disabled(root)

    # ── Meters (disabled) ───────────────────────────────────────
    ET.SubElement(root, "Meters", {"Enabled": "0"})

    # ── SpectralShaper, Stabilizer (disabled) ───────────────────
    _disabled_module(root, "SpectralShaper", "Spectral Shaper")
    _disabled_module(root, "Stabilizer", "Stabilizer")

    # ── VintageCompressor, VintageEQ, VintageLimiter, VintageTape (disabled) ──
    _disabled_module(root, "VintageCompressor", "Vintage Compressor")
    _disabled_module(root, "VintageEQ", "Vintage EQ")
    _disabled_module(root, "VintageLimiter", "Vintage Limiter")
    _disabled_module(root, "VintageTape", "Vintage Tape")

    # Serialise
    ET.indent(root, space="    ")
    return '<?xml version="1.0" standalone="yes" ?>\n' + ET.tostring(root, encoding="unicode")
