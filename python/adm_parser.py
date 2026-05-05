"""
ADM BWF (Audio Definition Model / Broadcast Wave Format) parser.

Reads multichannel WAV files with embedded ADM XML metadata (axml chunk).
Supports 7.1.4, 7.1.2, 5.1.4, 5.1 bed layouts commonly used in Dolby Atmos music.
"""

import struct
import xml.etree.ElementTree as ET
from typing import Optional, List, Dict
import soundfile as sf
import numpy as np


# ─── Standard channel layouts ────────────────────────────────────────────────

# ITU/Dolby channel ordering for common bed configurations
CHANNEL_LAYOUTS = {
    # 7.1.4 (12 channels) — most common Atmos music layout
    12: {
        "name": "7.1.4",
        "channels": [
            {"index": 0,  "id": "L",   "label": "Left",              "azimuth": 30,   "elevation": 0},
            {"index": 1,  "id": "R",   "label": "Right",             "azimuth": -30,  "elevation": 0},
            {"index": 2,  "id": "C",   "label": "Center",            "azimuth": 0,    "elevation": 0},
            {"index": 3,  "id": "LFE", "label": "LFE",               "azimuth": 0,    "elevation": -30},
            {"index": 4,  "id": "Ls",  "label": "Left Surround",     "azimuth": 110,  "elevation": 0},
            {"index": 5,  "id": "Rs",  "label": "Right Surround",    "azimuth": -110, "elevation": 0},
            {"index": 6,  "id": "Lrs", "label": "Left Rear",         "azimuth": 150,  "elevation": 0},
            {"index": 7,  "id": "Rrs", "label": "Right Rear",        "azimuth": -150, "elevation": 0},
            {"index": 8,  "id": "Ltf", "label": "Left Top Front",    "azimuth": 30,   "elevation": 35},
            {"index": 9,  "id": "Rtf", "label": "Right Top Front",   "azimuth": -30,  "elevation": 35},
            {"index": 10, "id": "Ltr", "label": "Left Top Rear",     "azimuth": 150,  "elevation": 35},
            {"index": 11, "id": "Rtr", "label": "Right Top Rear",    "azimuth": -150, "elevation": 35},
        ],
    },
    # 7.1.2 (10 channels)
    10: {
        "name": "7.1.2",
        "channels": [
            {"index": 0,  "id": "L",   "label": "Left",              "azimuth": 30,   "elevation": 0},
            {"index": 1,  "id": "R",   "label": "Right",             "azimuth": -30,  "elevation": 0},
            {"index": 2,  "id": "C",   "label": "Center",            "azimuth": 0,    "elevation": 0},
            {"index": 3,  "id": "LFE", "label": "LFE",               "azimuth": 0,    "elevation": -30},
            {"index": 4,  "id": "Ls",  "label": "Left Surround",     "azimuth": 110,  "elevation": 0},
            {"index": 5,  "id": "Rs",  "label": "Right Surround",    "azimuth": -110, "elevation": 0},
            {"index": 6,  "id": "Lrs", "label": "Left Rear",         "azimuth": 150,  "elevation": 0},
            {"index": 7,  "id": "Rrs", "label": "Right Rear",        "azimuth": -150, "elevation": 0},
            {"index": 8,  "id": "Ltf", "label": "Left Top Front",    "azimuth": 30,   "elevation": 35},
            {"index": 9,  "id": "Rtf", "label": "Right Top Front",   "azimuth": -30,  "elevation": 35},
        ],
    },
    # 5.1.4 (10 channels — different from 7.1.2)
    # Note: 5.1.4 and 7.1.2 both have 10 channels; ADM metadata differentiates them
    # We default to 7.1.2 for 10 channels and let ADM metadata override if present

    # 5.1 (6 channels)
    6: {
        "name": "5.1",
        "channels": [
            {"index": 0, "id": "L",   "label": "Left",           "azimuth": 30,   "elevation": 0},
            {"index": 1, "id": "R",   "label": "Right",          "azimuth": -30,  "elevation": 0},
            {"index": 2, "id": "C",   "label": "Center",         "azimuth": 0,    "elevation": 0},
            {"index": 3, "id": "LFE", "label": "LFE",            "azimuth": 0,    "elevation": -30},
            {"index": 4, "id": "Ls",  "label": "Left Surround",  "azimuth": 110,  "elevation": 0},
            {"index": 5, "id": "Rs",  "label": "Right Surround", "azimuth": -110, "elevation": 0},
        ],
    },
    # 7.1 (8 channels)
    8: {
        "name": "7.1",
        "channels": [
            {"index": 0, "id": "L",   "label": "Left",              "azimuth": 30,   "elevation": 0},
            {"index": 1, "id": "R",   "label": "Right",             "azimuth": -30,  "elevation": 0},
            {"index": 2, "id": "C",   "label": "Center",            "azimuth": 0,    "elevation": 0},
            {"index": 3, "id": "LFE", "label": "LFE",               "azimuth": 0,    "elevation": -30},
            {"index": 4, "id": "Ls",  "label": "Left Surround",     "azimuth": 110,  "elevation": 0},
            {"index": 5, "id": "Rs",  "label": "Right Surround",    "azimuth": -110, "elevation": 0},
            {"index": 6, "id": "Lrs", "label": "Left Rear",         "azimuth": 150,  "elevation": 0},
            {"index": 7, "id": "Rrs", "label": "Right Rear",        "azimuth": -150, "elevation": 0},
        ],
    },
}

# Channel groups for analysis
CHANNEL_GROUPS = {
    "ear_level": ["L", "R", "C", "Ls", "Rs", "Lrs", "Rrs"],
    "height":    ["Ltf", "Rtf", "Ltr", "Rtr"],
    "lfe":       ["LFE"],
    "left":      ["L", "Ls", "Lrs", "Ltf", "Ltr"],
    "right":     ["R", "Rs", "Rrs", "Rtf", "Rtr"],
    "front":     ["L", "R", "C", "Ltf", "Rtf"],
    "rear":      ["Ls", "Rs", "Lrs", "Rrs", "Ltr", "Rtr"],
    "surround":  ["Ls", "Rs", "Lrs", "Rrs"],
}


# ─── Format detection ────────────────────────────────────────────────────────

def detect_format(file_path: str) -> dict:
    """
    Detect audio file format and check for ADM BWF metadata.

    Returns:
        {
            "channels": int,
            "samplerate": int,
            "is_multichannel": bool,
            "is_atmos": bool,
            "channel_layout": dict or None,
            "adm_metadata": dict or None,
        }
    """
    info = sf.info(file_path)
    result = {
        "channels": info.channels,
        "samplerate": info.samplerate,
        "duration": info.duration,
        "is_multichannel": info.channels > 2,
        "is_atmos": False,
        "channel_layout": None,
        "adm_metadata": None,
    }

    if not result["is_multichannel"]:
        return result

    # Try to parse ADM BWF metadata
    adm = _read_axml_chunk(file_path)
    if adm is not None:
        result["is_atmos"] = True
        result["adm_metadata"] = adm

    # Assign channel layout based on channel count (or ADM if available)
    if info.channels in CHANNEL_LAYOUTS:
        result["channel_layout"] = CHANNEL_LAYOUTS[info.channels]
    elif info.channels >= 12:
        # Common Atmos render: first 12 channels are the 7.1.4 bed,
        # remaining channels are audio objects.
        # This is the standard Dolby Renderer output format.
        bed = CHANNEL_LAYOUTS[12]  # 7.1.4
        object_count = info.channels - 12
        obj_channels = [
            {"index": 12 + i, "id": f"Obj{i+1}", "label": f"Object {i+1}",
             "azimuth": 0, "elevation": 0}
            for i in range(object_count)
        ]
        result["is_atmos"] = True
        result["channel_layout"] = {
            "name": f"7.1.4 + {object_count} objects",
            "channels": bed["channels"] + obj_channels,
            "bed_channels": 12,
            "object_channels": object_count,
        }
    else:
        # Unknown layout — create a generic one
        result["channel_layout"] = {
            "name": f"{info.channels}ch",
            "channels": [
                {"index": i, "id": f"Ch{i+1}", "label": f"Channel {i+1}",
                 "azimuth": 0, "elevation": 0}
                for i in range(info.channels)
            ],
        }

    return result


# ─── ADM XML parsing ─────────────────────────────────────────────────────────

def _read_axml_chunk(file_path: str) -> Optional[dict]:
    """
    Read the 'axml' RIFF chunk from a BWF file.
    Returns parsed ADM metadata dict, or None if no axml chunk found.
    """
    try:
        with open(file_path, 'rb') as f:
            # Read RIFF header
            riff_id = f.read(4)
            if riff_id != b'RIFF':
                return None

            file_size = struct.unpack('<I', f.read(4))[0]
            wave_id = f.read(4)
            if wave_id != b'WAVE':
                return None

            # Walk chunks looking for 'axml'
            # Note: axml is often AFTER the data chunk, so we must scan the full file
            pos = 12  # after RIFF header
            end = file_size + 8

            while pos < end:
                f.seek(pos)
                chunk_id = f.read(4)
                if len(chunk_id) < 4:
                    break

                chunk_size_data = f.read(4)
                if len(chunk_size_data) < 4:
                    break

                chunk_size = struct.unpack('<I', chunk_size_data)[0]

                if chunk_id == b'axml':
                    xml_data = f.read(chunk_size)
                    return _parse_adm_xml(xml_data.decode('utf-8', errors='replace'))

                # Move to next chunk (chunks are 2-byte aligned)
                pos += 8 + chunk_size
                if chunk_size % 2 != 0:
                    pos += 1

    except Exception:
        pass

    return None


def _parse_adm_xml(xml_str: str) -> dict:
    """Parse ADM XML metadata into a structured dict."""
    result = {
        "programme_name": None,
        "content_count": 0,
        "object_count": 0,
        "channel_formats": [],
        "object_trajectories": [],  # [{ name, track, points: [{t, az, el, dist}] }]
    }

    try:
        # ADM XML uses namespaces (ebuCore, itu, adm) — strip them all for easy parsing
        import re
        xml_clean = re.sub(r'\sxmlns[^"]*"[^"]*"', '', xml_str)  # remove xmlns declarations
        xml_clean = re.sub(r'<(/?)[\w]+:', r'<\1', xml_clean)     # remove namespace prefixes
        xml_clean = re.sub(r'\sxsi:[^"]*"[^"]*"', '', xml_clean)  # remove xsi attributes

        root = ET.fromstring(xml_clean)

        # Programme name
        for prog in root.iter('audioProgramme'):
            name = prog.get('audioProgrammeName', '')
            if name:
                result["programme_name"] = name
                break

        # Count content elements
        result["content_count"] = len(list(root.iter('audioContent')))

        # Count object elements
        result["object_count"] = len(list(root.iter('audioObject')))

        # Parse channel formats for speaker labels
        for cf in root.iter('audioChannelFormat'):
            cf_name = cf.get('audioChannelFormatName', '')
            cf_id = cf.get('audioChannelFormatID', '')
            result["channel_formats"].append({
                "name": cf_name,
                "id": cf_id,
            })

        # ── Object trajectories ──
        # ADM object positions live in audioBlockFormat elements nested inside
        # audioChannelFormat elements that belong to *object* type (typeDefinition="Objects").
        # Each block has:
        #   <audioBlockFormat rtime="00:00:00.000" duration="00:00:00.250">
        #     <position coordinate="azimuth">-30</position>
        #     <position coordinate="elevation">0</position>
        #     <position coordinate="distance">1.0</position>
        #   </audioBlockFormat>
        # …OR in cartesian form:
        #   <position coordinate="X">0.5</position>
        #   <position coordinate="Y">-0.3</position>
        #   <position coordinate="Z">0.2</position>

        # Build channelFormat → type map (so we only extract Object-type formats)
        object_cf_ids = set()
        for cf in root.iter('audioChannelFormat'):
            type_def = cf.get('typeDefinition', '') or cf.get('typeLabel', '')
            if type_def.lower() == 'objects':
                object_cf_ids.add(cf.get('audioChannelFormatID', ''))

        # Channel-format → object-name lookup via audioPackFormat / audioObject chain
        # We use a simple heuristic: if audioObject references an audioPackFormat that
        # contains the channel-format, the object's name becomes the trajectory label.
        # When that chain is too complex to parse reliably we fall back to channel-format name.
        object_name_for_cf: dict = {}
        pack_to_cf: dict = {}
        # audioPackFormat → list of audioChannelFormat IDs
        for pack in root.iter('audioPackFormat'):
            pid = pack.get('audioPackFormatID', '')
            cf_ids = [el.text for el in pack.iter('audioChannelFormatIDRef') if el.text]
            pack_to_cf[pid] = cf_ids
        # audioObject → audioPackFormatIDRef
        object_to_pack: dict = {}
        for obj in root.iter('audioObject'):
            oid = obj.get('audioObjectID', '')
            oname = obj.get('audioObjectName', '') or oid
            pack_refs = [el.text for el in obj.iter('audioPackFormatIDRef') if el.text]
            object_to_pack[oid] = (oname, pack_refs)
        # Walk back: for each object, find its channel-formats and set name mapping
        for oid, (oname, pack_refs) in object_to_pack.items():
            for pid in pack_refs:
                for cfid in pack_to_cf.get(pid, []):
                    if cfid in object_cf_ids:
                        object_name_for_cf[cfid] = oname

        # Now extract trajectories per object-type channel format
        trajectories = []
        for cf in root.iter('audioChannelFormat'):
            cf_id = cf.get('audioChannelFormatID', '')
            if cf_id not in object_cf_ids:
                continue
            obj_name = object_name_for_cf.get(cf_id) or cf.get('audioChannelFormatName', cf_id)
            points = []
            for block in cf.iter('audioBlockFormat'):
                rtime_str = block.get('rtime', '00:00:00.000')
                t_sec = _hms_to_seconds(rtime_str)
                # Default spherical (az/el/dist) missing → (0, 0, 1)
                az, el, dist = 0.0, 0.0, 1.0
                cart = {'X': None, 'Y': None, 'Z': None}
                any_coord = False
                for pos in block.iter('position'):
                    coord = (pos.get('coordinate') or '').lower()
                    try:
                        val = float(pos.text.strip())
                    except Exception:
                        continue
                    any_coord = True
                    if coord == 'azimuth':
                        az = val
                    elif coord == 'elevation':
                        el = val
                    elif coord == 'distance':
                        dist = val
                    elif coord in ('x', 'y', 'z'):
                        cart[coord.upper()] = val
                # Convert cartesian → spherical if we got XYZ instead
                if not any_coord:
                    continue
                if cart['X'] is not None and cart['Y'] is not None:
                    x = cart['X'] or 0.0
                    y = cart['Y'] or 0.0
                    z = cart['Z'] or 0.0
                    import math
                    dist = math.sqrt(x*x + y*y + z*z)
                    if dist > 1e-6:
                        # Dolby cartesian convention: X right, Y front, Z up
                        az = math.degrees(math.atan2(-x, y))  # 0 = front, + to left
                        el = math.degrees(math.asin(max(-1, min(1, z / dist))))
                points.append({
                    "t": round(t_sec, 3),
                    "az": round(az, 1),
                    "el": round(el, 1),
                    "dist": round(dist, 2),
                })
            if points:
                trajectories.append({
                    "name": obj_name,
                    "cf_id": cf_id,
                    "points": points,
                })

        result["object_trajectories"] = trajectories

    except ET.ParseError:
        pass

    return result


def _hms_to_seconds(hms: str) -> float:
    """Convert 'HH:MM:SS.sss' or 'HH:MM:SS.sssss' to seconds."""
    try:
        parts = hms.strip().split(':')
        if len(parts) == 3:
            h, m, s = parts
            return int(h) * 3600 + int(m) * 60 + float(s)
        if len(parts) == 2:
            m, s = parts
            return int(m) * 60 + float(s)
        return float(parts[0])
    except Exception:
        return 0.0


# ─── Channel layout helpers ──────────────────────────────────────────────────

def get_channel_by_id(layout: dict, channel_id: str) -> Optional[dict]:
    """Get a channel definition by its ID (e.g., 'L', 'C', 'LFE')."""
    for ch in layout["channels"]:
        if ch["id"] == channel_id:
            return ch
    return None


def get_channel_index(layout: dict, channel_id: str) -> Optional[int]:
    """Get the array index for a channel by its ID."""
    ch = get_channel_by_id(layout, channel_id)
    return ch["index"] if ch else None


def get_group_indices(layout: dict, group_name: str) -> List[int]:
    """Get array indices for all channels in a group (e.g., 'height', 'lfe')."""
    group_ids = CHANNEL_GROUPS.get(group_name, [])
    indices = []
    for ch in layout["channels"]:
        if ch["id"] in group_ids:
            indices.append(ch["index"])
    return indices


def get_channel_ids(layout: dict) -> List[str]:
    """Get ordered list of channel IDs."""
    return [ch["id"] for ch in layout["channels"]]


# ─── ADM validation — beyond the AtmosPreflight warning ────────────
#
# Panel ask (Jonas, broadcast / post): "ADM only surfaces a warning.
# Netflix / Dolby Atmos QC requires *structural* validation —
# object cardinality, trajectory bounds, pack-format references,
# missing programme name."
#
# validate_adm returns typed issues with `severity` = 'block' | 'warn' |
# 'info'. The UI promotes blocks above the Atmos traffic light instead of
# stopping at the ADM-present / ADM-absent check.

APPLE_OBJECT_CAP = 118
NETFLIX_OBJECT_CAP = 128
AZIMUTH_RANGE = (-180, 180)
ELEVATION_RANGE = (-90, 90)
DISTANCE_RANGE = (0, 2)


def validate_adm(adm: dict, target: str = 'apple') -> list[dict]:
    """
    Validate a parsed ADM metadata dict against delivery rules.

    Returns a list of issues with shape:
        { "severity": "block" | "warn" | "info",
          "code": str, "message": str,
          "field": str (optional) }

    Targets:
      * 'apple'   — Apple Music Atmos (object cap 118)
      * 'netflix' — Netflix 5.1.4 / 7.1.4 Atmos QC
      * 'generic' — general Dolby Atmos Master spec
    """
    issues: list[dict] = []
    if not isinstance(adm, dict):
        return [{"severity": "block", "code": "no-adm", "message": "No ADM metadata present — file cannot be routed as Atmos at ingest."}]

    # 1. Programme name required.
    if not adm.get("programme_name"):
        issues.append({
            "severity": "warn", "code": "no-programme-name",
            "message": "audioProgrammeName is empty — re-export from the Dolby Renderer with a programme name set.",
        })

    # 2. Object count vs. platform cap.
    obj_count = int(adm.get("object_count") or 0)
    cap = APPLE_OBJECT_CAP if target == 'apple' else NETFLIX_OBJECT_CAP
    if obj_count > cap:
        issues.append({
            "severity": "block", "code": "object-cap",
            "message": f"{obj_count} audio objects — {target.title()} caps Atmos deliveries at {cap}. DSP will auto-reject or silently collapse objects.",
            "field": "object_count",
        })
    elif obj_count > cap - 10:
        issues.append({
            "severity": "warn", "code": "object-cap-close",
            "message": f"{obj_count} audio objects — within 10 of the {cap}-cap. Leave headroom; downstream re-spatialisation may add objects.",
            "field": "object_count",
        })

    # 3. Channel-format coverage — every bed channel in the layout
    #    should have a matching channelFormat entry.
    if obj_count == 0 and int(adm.get("content_count") or 0) == 0:
        issues.append({
            "severity": "block", "code": "empty-adm",
            "message": "ADM declares no audioContent and no audioObjects — the file is multichannel PCM with no routing metadata. Re-export from the Dolby Renderer.",
        })

    # 4. Trajectory bounds.  The parser already extracts polar points;
    #    any azimuth outside [-180, 180], elevation outside [-90, 90]
    #    or distance outside [0, 2] is invalid per ITU-R BS.2076.
    out_of_range_count = 0
    invalid_points_example: str | None = None
    trajectories = adm.get("object_trajectories") or []
    for traj in trajectories:
        for p in (traj.get("points") or []):
            az = p.get("az")
            el = p.get("el")
            dist = p.get("dist")
            bad = False
            if az is not None and not (AZIMUTH_RANGE[0] <= float(az) <= AZIMUTH_RANGE[1]):
                bad = True
            if el is not None and not (ELEVATION_RANGE[0] <= float(el) <= ELEVATION_RANGE[1]):
                bad = True
            if dist is not None and not (DISTANCE_RANGE[0] <= float(dist) <= DISTANCE_RANGE[1]):
                bad = True
            if bad:
                out_of_range_count += 1
                if invalid_points_example is None:
                    invalid_points_example = f'{traj.get("name", "object")} @ {p.get("t", "?")} az={az} el={el} dist={dist}'
    if out_of_range_count > 0:
        issues.append({
            "severity": "block", "code": "trajectory-out-of-range",
            "message": f"{out_of_range_count} object trajectory point(s) outside ITU-R BS.2076 bounds. Example: {invalid_points_example}. Re-render from Dolby — these would be clamped.",
            "field": "object_trajectories",
        })

    # 5. Objects declared but no trajectory points.
    zero_traj_objects = [t.get("name", "object") for t in trajectories if not t.get("points")]
    if zero_traj_objects:
        issues.append({
            "severity": "warn", "code": "static-object",
            "message": f"{len(zero_traj_objects)} object(s) have no trajectory points — they'll play at a fixed position. Intentional? ({', '.join(zero_traj_objects[:4])}{'…' if len(zero_traj_objects) > 4 else ''})",
            "field": "object_trajectories",
        })

    # 6. Missing channel formats vs. bed expectations.
    channel_formats = adm.get("channel_formats") or []
    if len(channel_formats) == 0:
        issues.append({
            "severity": "warn", "code": "no-channel-formats",
            "message": "No audioChannelFormat elements — channel routing is undefined. Likely a minimal / broken ADM export.",
        })

    return issues

