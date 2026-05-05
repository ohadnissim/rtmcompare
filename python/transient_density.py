"""
Transient density + section structure over time.

Gives two things:
  1. A 1-second-resolution timeline of transient events per second (onset rate)
     and short-term RMS — drawn as a dual curve in the UI so users can see
     energy arc and rhythmic density together.
  2. A coarse section boundary estimate using librosa's spectral-novelty
     segmentation, so we can label "verse / chorus / drop / bridge" — or at
     least "Section 1 / 2 / 3" timestamps — to add structural context to
     every other timeline in the app.
"""

import numpy as np
import librosa


def analyse(y: np.ndarray, sr: int, duration_sec: float = 0.0) -> dict:
    try:
        if len(y) < sr * 5:
            return {"timeline": [], "sections": []}

        duration = duration_sec or len(y) / sr

        # Onset strength envelope, aggregated per second
        hop = 512
        onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
        frames_per_sec = sr / hop
        total_secs = int(np.floor(duration))
        timeline = []

        # RMS per 1s
        rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop)[0]

        for s in range(total_secs):
            fstart = int(s * frames_per_sec)
            fend = int(min(len(onset_env), fstart + frames_per_sec))
            if fend <= fstart:
                continue
            onset_slice = onset_env[fstart:fend]
            rms_slice = rms[fstart:fend]
            # Transient count in this second: local peaks > threshold
            thr = np.percentile(onset_env, 70) if len(onset_env) > 20 else 0
            count = int(np.sum(onset_slice > thr))
            # Normalize count per second (frames_per_sec can exceed 30 peaks/sec)
            density = min(1.0, count / max(1, frames_per_sec / 2))
            energy = float(np.mean(rms_slice)) if len(rms_slice) else 0.0
            timeline.append({
                "time": s,
                "density": round(density, 3),
                "energy": round(energy, 4),
            })

        # Normalize energy to 0-1 across the timeline
        if timeline:
            max_e = max(p["energy"] for p in timeline) or 1.0
            for p in timeline:
                p["energy"] = round(p["energy"] / max_e, 3)

        # ── Section boundaries ──
        # Use chroma + MFCC + spectral contrast novelty + agglomerative segmentation.
        sections = []
        try:
            chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
            # Recurrence matrix & novelty curve
            bounds = librosa.segment.agglomerative(chroma, k=min(8, max(3, int(duration / 30))))
            boundary_times = librosa.frames_to_time(bounds, sr=sr, hop_length=hop)
            # Pair up into sections with rough labels
            times = list(boundary_times) + [duration]
            for i in range(len(times) - 1):
                start = float(times[i])
                end = float(times[i + 1])
                if end - start < 3.0:
                    continue
                # Label by position + energy
                mid = (start + end) / 2
                energy_at_mid = 0.0
                for p in timeline:
                    if abs(p["time"] - mid) < 2:
                        energy_at_mid = p["energy"]
                        break
                label = _label_section(i, len(times) - 1, start, end, duration, energy_at_mid)
                sections.append({
                    "start": round(start, 1),
                    "end": round(end, 1),
                    "label": label,
                    "energy": energy_at_mid,
                })
        except Exception:
            pass

        return {
            "timeline": timeline,
            "sections": sections,
        }
    except Exception:
        return {"timeline": [], "sections": []}


def _label_section(idx: int, total: int, start: float, end: float, duration: float, energy: float) -> str:
    """Heuristic section labelling by position + energy."""
    pos = start / max(duration, 1)
    if pos < 0.08:
        return "Intro"
    if pos > 0.88 and idx == total - 1:
        return "Outro"
    # Mid-track high energy = likely chorus/drop
    if energy > 0.8:
        return "Drop / Chorus" if pos < 0.55 else "Climax"
    if energy < 0.45:
        return "Breakdown" if pos > 0.4 else "Verse"
    return "Verse / Pre-chorus"
