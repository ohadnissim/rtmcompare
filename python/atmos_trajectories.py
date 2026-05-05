"""
Post-process raw ADM object trajectories into a heatmap-friendly structure.

Input: list of objects, each with a timestamped (az, el, dist) trace.
Outputs:
  1. `heatmap_grid` — a 2D grid of object "presence" mass over the azimuth/elevation
     sphere, giving a top-down / fisheye view of where objects live.
  2. `trajectories` — sub-sampled point trails per object for drawing paths.
  3. `stats` — per-object motion summary (static / slow / active / flying).
  4. `heights_over_time` — height energy as a function of time (0..duration).
"""

import math
from typing import List, Dict, Any


AZ_BINS = 36      # 10° per azimuth bin (full 360°)
EL_BINS = 9       # 20° per elevation bin (-90..+90)
MAX_TRAJECTORY_POINTS = 120  # subsample each object's trail for UI perf


def build_atmos_object_view(trajectories: List[Dict[str, Any]],
                            duration_sec: float = 0.0,
                            num_time_buckets: int = 32) -> Dict[str, Any]:
    """
    Args:
        trajectories: list of { name, cf_id, points: [{t, az, el, dist}, ...] }
        duration_sec: total track duration — used for height-over-time timeline
        num_time_buckets: how many buckets the height-over-time line has

    Returns:
        {
            "object_count": int,
            "heatmap_grid": [[ counts for each az bin ] for each el bin],
            "heatmap_dims": { "az_bins": int, "el_bins": int },
            "trajectories": [ { name, points: [{t, az, el, dist}] } ],
            "stats": [ { name, motion, travel_deg, height_pct, duration_sec } ],
            "heights_over_time": [ [time_sec, fraction_in_height] ],
        }
    """
    if not trajectories:
        return {
            "object_count": 0,
            "heatmap_grid": [],
            "heatmap_dims": {"az_bins": AZ_BINS, "el_bins": EL_BINS},
            "trajectories": [],
            "stats": [],
            "heights_over_time": [],
        }

    # Compute total duration if not passed
    if duration_sec <= 0:
        for tr in trajectories:
            if tr["points"]:
                duration_sec = max(duration_sec, tr["points"][-1]["t"])

    # ── Heatmap grid ──
    grid = [[0.0 for _ in range(AZ_BINS)] for _ in range(EL_BINS)]
    for tr in trajectories:
        pts = tr["points"]
        for i, p in enumerate(pts):
            # Each point "owns" the time from this point to the next one
            next_t = pts[i + 1]["t"] if i + 1 < len(pts) else (p["t"] + 0.25)
            weight = max(0.05, next_t - p["t"])  # seconds of "presence"
            az_idx = _az_to_bin(p["az"])
            el_idx = _el_to_bin(p["el"])
            if 0 <= az_idx < AZ_BINS and 0 <= el_idx < EL_BINS:
                grid[el_idx][az_idx] += weight

    # Normalize to 0..1
    max_cell = max((max(row) for row in grid), default=1.0) or 1.0
    grid = [[round(v / max_cell, 3) for v in row] for row in grid]

    # ── Per-object trajectories (subsampled) ──
    subsampled = []
    for tr in trajectories:
        pts = tr["points"]
        if len(pts) == 0:
            continue
        # Uniform sub-sample to cap size
        if len(pts) > MAX_TRAJECTORY_POINTS:
            step = len(pts) // MAX_TRAJECTORY_POINTS
            sub = pts[::step]
            # always include last point
            if sub[-1] != pts[-1]:
                sub.append(pts[-1])
        else:
            sub = pts
        subsampled.append({
            "name": tr["name"],
            "cf_id": tr.get("cf_id", ""),
            "points": sub,
        })

    # ── Per-object stats ──
    stats = []
    for tr in trajectories:
        pts = tr["points"]
        if len(pts) < 2:
            continue
        # Total angular travel — sum of great-circle distances between consecutive points
        travel = 0.0
        for i in range(1, len(pts)):
            travel += _angular_distance(pts[i-1]["az"], pts[i-1]["el"], pts[i]["az"], pts[i]["el"])
        # Time the object spends in height bands (elevation > 15°)
        total = max(pts[-1]["t"] - pts[0]["t"], 0.01)
        height_time = 0.0
        for i in range(len(pts) - 1):
            if pts[i]["el"] > 15:
                height_time += (pts[i+1]["t"] - pts[i]["t"])
        height_pct = height_time / total if total > 0 else 0.0

        if travel < 15:
            motion = "static"
        elif travel < 90:
            motion = "slow"
        elif travel < 360:
            motion = "active"
        else:
            motion = "flying"

        stats.append({
            "name": tr["name"],
            "motion": motion,
            "travel_deg": round(travel, 1),
            "height_pct": round(height_pct, 3),
            "duration_sec": round(total, 1),
            "start_sec": round(pts[0]["t"], 1),
            "end_sec": round(pts[-1]["t"], 1),
        })

    # ── Height-over-time ──
    # For each time bucket: fraction of objects whose interpolated position is > 15° elevation
    heights_over_time = []
    if duration_sec > 0 and trajectories:
        for b in range(num_time_buckets):
            t = (b + 0.5) / num_time_buckets * duration_sec
            active_in_height = 0
            active = 0
            for tr in trajectories:
                pts = tr["points"]
                if not pts or t < pts[0]["t"] or t > pts[-1]["t"]:
                    continue
                active += 1
                # Find surrounding points
                for i in range(len(pts) - 1):
                    if pts[i]["t"] <= t <= pts[i+1]["t"]:
                        # Linear interp in elevation
                        span = pts[i+1]["t"] - pts[i]["t"]
                        frac = (t - pts[i]["t"]) / span if span > 0 else 0
                        el = pts[i]["el"] + frac * (pts[i+1]["el"] - pts[i]["el"])
                        if el > 15:
                            active_in_height += 1
                        break
            frac = active_in_height / max(active, 1)
            heights_over_time.append([round(t, 1), round(frac, 3)])

    return {
        "object_count": len(trajectories),
        "heatmap_grid": grid,
        "heatmap_dims": {"az_bins": AZ_BINS, "el_bins": EL_BINS},
        "trajectories": subsampled,
        "stats": stats,
        "heights_over_time": heights_over_time,
        "duration_sec": round(duration_sec, 1),
    }


def _az_to_bin(az_deg: float) -> int:
    """Wrap azimuth into [0, 360) then map to bin index."""
    a = az_deg % 360
    return int(a / (360.0 / AZ_BINS))


def _el_to_bin(el_deg: float) -> int:
    """Map elevation [-90, +90] to [0, EL_BINS)."""
    clamped = max(-90.0, min(90.0, el_deg))
    return int((clamped + 90.0) / (180.0 / EL_BINS))


def _angular_distance(az1: float, el1: float, az2: float, el2: float) -> float:
    """Great-circle distance between two (az, el) points in degrees."""
    a1 = math.radians(az1); e1 = math.radians(el1)
    a2 = math.radians(az2); e2 = math.radians(el2)
    cos_d = math.sin(e1) * math.sin(e2) + math.cos(e1) * math.cos(e2) * math.cos(a1 - a2)
    cos_d = max(-1.0, min(1.0, cos_d))
    return math.degrees(math.acos(cos_d))
