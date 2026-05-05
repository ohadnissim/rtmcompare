#!/usr/bin/env python3.12
"""Build RTMcompare commercial v14 — 90s with Cry Me A Rimshot.wav.

Strategy:
- Opener: PIL-rendered "RTM Audio presents RTMcompare" → Seedance breathing zoom
- 10 panels: NB Pro 3D treatments → Seedance motion clips (or ffmpeg zoompan fallback)
- Transitions: Kling 3.0 morphs between consecutive panels (where available)
- Closer: PIL-rendered "RTMcompare / Coming soon" → Seedance breathing zoom
- Audio: Cry Me A Rimshot.wav, 0-90s segment with 0.5s fade-in/out

Timeline (90s, BPM-aware cuts on Cry Me A Rimshot energy peaks at 52, 57, 67, 72, 75, 81, 87):
  0:00-0:06   Black build (audio fades in)
  0:06-0:14   Opener — typography breathing zoom (8s)
  0:14-0:20   Panel 1 — Overview (6s)
  0:20-0:26   Panel 2 — A/B Player closeup (6s)
  0:26-0:32   Panel 3 — Mastering Delta (6s)
  0:32-0:38   Panel 4 — Streaming Normalization (6s)
  0:38-0:44   Panel 5 — Frequency Spectrum (6s)
  0:44-0:50   Panel 6 — EQ Match (6s)
  0:50-0:56   Panel 7 — EQ Preview (6s)  [peak 52, 54, 57]
  0:56-1:02   Panel 8 — Tonal Breakdown (6s)  [peak 57, 67]
  1:02-1:10   Panel 9 — Quality/Distortion HERO (8s)  [peak 67, 72, 75]
  1:10-1:20   Panel 10 — Limiter Artifacts HERO (10s)  [peak 81, 84, 87]
  1:20-1:30   Closer — typography breathing zoom (10s)  [peak 89, fade to cool]
"""
import subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import os

V14 = Path("/Users/ohadnissim/Claude/Compare/Compare App/commercial-clips/v14-build")
AUDIO = "/Users/ohadnissim/Dropbox/My Stuff/New Album Idea/New Album Wav/05 - Cry Me A Rimshot.wav"
OUT = "/Users/ohadnissim/Claude/Compare/Compare App/commercial-clips/RTMcompare-commercial-v14.mp4"
W, H, FPS = 1920, 1080, 24

# Panel sources with Seedance preferred, fallback to NB Pro still + ffmpeg motion
PANELS = [
    # (idx, dur, label, sd_video_name, nb_still_name, raw_screenshot_name)
    (1,  5.0, "overview",      "sd-1-overview.mp4",     "nb-1.png",  "01-overview-top.png"),
    (2,  5.0, "ab-player",     "sd-2-ab-player.mp4",    "nb-2.png",  "22-ab-player-closeup.png"),
    (3,  5.0, "mastering",     "sd-3-mastering.mp4",    "nb-3.png",  "04-mastering-delta.png"),
    (4,  5.0, "streaming",     "sd-4-streaming.mp4",    "nb-4.png",  "06-streaming-normalization.png"),
    (5,  5.0, "spectrum",      "sd-5-spectrum.mp4",     "nb-5.png",  "08-frequency-spectrum.png"),
    (6,  5.0, "eq-match",      "sd-6-eq-match.mp4",     "nb-6.png",  "10-eq-match-top.png"),
    (7,  5.0, "eq-preview",    "sd-7-eq-preview.mp4",   "nb-7.png",  "19-eq-preview-scrolled.png"),
    (8,  5.0, "breakdown",     "sd-8-breakdown.mp4",    "nb-8.png",  "13-tonal-breakdown.png"),
    (9,  7.0, "quality",       "sd-9-quality.mp4",      "nb-9.png",  "16-quality-limiter.png"),
    (10, 8.0, "limiter",       "sd-10-limiter.mp4",     "nb-10.png", "20-limiter-detail.png"),
]

# Hero transition Kling clips: (insert_after_panel, kling_filename)
KLING_TRANSITIONS = [
    (1, "kl-1.mp4"),  # after overview (panel 1) — overview→ab-player
    (5, "kl-2.mp4"),  # after spectrum (panel 5) — spectrum→eq-match
    (9, "kl-3.mp4"),  # after quality (panel 9) — quality→limiter
]


def make_motion_from_still(src, dst, dur, zoom_start=1.00, zoom_end=1.06, x_frac=0.50, y_frac=0.50):
    if not src or not Path(src).exists():
        return None
    if Path(dst).exists():
        return str(dst)
    frames = int(dur * FPS)
    zoom_expr = f"{zoom_start}+({zoom_end}-{zoom_start})*on/{frames-1}"
    x_expr = f"iw*{x_frac}-(iw/zoom/2)"
    y_expr = f"ih*{y_frac}-(ih/zoom/2)"
    vf = (
        f"scale={W*2}:{H*2}:force_original_aspect_ratio=increase,"
        f"crop={W*2}:{H*2},"
        f"zoompan=z='{zoom_expr}':x='{x_expr}':y='{y_expr}':"
        f"d={frames}:s={W}x{H}:fps={FPS}"
    )
    cmd = [
        "ffmpeg", "-y", "-loop", "1", "-i", str(src),
        "-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "16",
        "-pix_fmt", "yuv420p", "-r", str(FPS), "-t", str(dur),
        "-an", str(dst),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"FAIL {src}:", r.stderr[-1000:])
        return None
    return str(dst)


def normalize(src_name, dur, dst_name, start=0):
    src = V14 / src_name
    dst = V14 / dst_name
    cmd = [
        "ffmpeg", "-y", "-ss", str(start), "-i", str(src),
        "-t", str(dur),
        "-vf", f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS},setsar=1",
        "-c:v", "libx264", "-preset", "medium", "-crf", "16",
        "-pix_fmt", "yuv420p", "-r", str(FPS), "-an", str(dst),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"FAIL norm {src_name}:", r.stderr[-500:])
        return None
    return str(dst)


def pick_panel_clip(idx, sd_name, nb_name, raw_name, dur):
    """For each panel, try Seedance > NB Pro still+motion > raw screenshot+motion."""
    sd_p = V14 / sd_name
    if sd_p.exists() and sd_p.stat().st_size > 100_000:
        # Seedance available: just normalize/trim
        return normalize(sd_name, dur, f"p{idx}-final.mp4")

    # Fallback: NB Pro still > raw screenshot, with ffmpeg motion
    nb_p = V14 / nb_name
    src = nb_p if nb_p.exists() else V14 / raw_name
    return make_motion_from_still(str(src), str(V14 / f"p{idx}-final.mp4"), dur,
                                   zoom_start=1.00, zoom_end=1.07)


def main():
    print("=== Building v14 ===")
    # 1. Generate motion for opener + closer (typography frames)
    print("Opener/closer motion...")
    make_motion_from_still(str(V14 / "tx-opener.png"),
                           str(V14 / "opener-motion.mp4"),
                           dur=8.0, zoom_start=1.02, zoom_end=1.10, x_frac=0.50, y_frac=0.50)
    make_motion_from_still(str(V14 / "tx-closer.png"),
                           str(V14 / "closer-motion.mp4"),
                           dur=12.0, zoom_start=1.00, zoom_end=1.08, x_frac=0.50, y_frac=0.50)

    # 2. Build each panel clip
    print("Panel clips...")
    clip_paths = []
    for idx, dur, label, sd_n, nb_n, raw_n in PANELS:
        out = pick_panel_clip(idx, sd_n, nb_n, raw_n, dur)
        if not out:
            print(f"FAIL panel {idx}")
            return False
        clip_paths.append(out)
        print(f"  panel {idx} ({label}): {Path(out).name}")

    # 3. Generate black build-in segment (6s of black with subtle gold particle hint)
    print("Black build...")
    black = V14 / "black-build.mp4"
    cmd = [
        "ffmpeg", "-y", "-f", "lavfi", "-i", f"color=c=0x050403:s={W}x{H}:r={FPS}:d=6",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", str(black),
    ]
    subprocess.run(cmd, capture_output=True, check=True)

    # 4. Build timeline with Kling transitions inserted at hero moments
    # Hero transitions (insert AFTER these panel indices):
    # - kl-1.mp4 after panel 1 (overview→ab-player)
    # - kl-2.mp4 after panel 5 (spectrum→eq-match)
    # - kl-3.mp4 after panel 9 (quality→limiter)
    KLING_AFTER = {1: "kl-1.mp4", 5: "kl-2.mp4", 9: "kl-3.mp4"}

    # Normalize Kling clips that exist
    kling_clips = {}
    for after_idx, kl_name in KLING_AFTER.items():
        kl_src = V14 / kl_name
        if kl_src.exists() and kl_src.stat().st_size > 100_000:
            norm_kl = V14 / f"norm-{kl_name}"
            cmd = [
                "ffmpeg", "-y", "-ss", "0.3", "-i", str(kl_src),
                "-t", "3.0",
                "-vf", f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS},setsar=1",
                "-c:v", "libx264", "-preset", "medium", "-crf", "16",
                "-pix_fmt", "yuv420p", "-r", str(FPS), "-an",
                str(norm_kl),
            ]
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode == 0:
                kling_clips[after_idx] = str(norm_kl)
                print(f"  ✓ kling after panel {after_idx}: {norm_kl.name}")

    # Build timeline interleaving panels + Kling transitions
    timeline = [
        str(black),                       # 0:00-0:06
        str(V14 / "opener-motion.mp4"),   # 0:06-0:14 (8s)
    ]
    for i, clip_path in enumerate(clip_paths, start=1):
        timeline.append(clip_path)
        if i in kling_clips:
            timeline.append(kling_clips[i])
    timeline.append(str(V14 / "closer-motion.mp4"))   # closer (10s configured)

    # If we have all 3 Kling, total panel block = 8*5 + 7 + 8 + 9 (3 trans) = 64s
    # 6 (black) + 8 (opener) + 64 (panels+kling) + 10 (closer) = 88s. Pad closer to 12s.
    # If missing Kling, total shrinks by 3s each missing.

    print("Concat...")
    concat_list = V14 / "concat.txt"
    concat_list.write_text("".join(f"file '{p}'\n" for p in timeline))
    base = V14 / "v14-base.mp4"
    cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list),
           "-c", "copy", str(base)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("CONCAT FAIL:", r.stderr[-2000:])
        return False

    # 5. Add audio (0-90s of Cry Me A Rimshot, fade-in 1s, fade-out 2s)
    print("Audio + final encode...")
    cmd = [
        "ffmpeg", "-y", "-i", str(base),
        "-ss", "0", "-t", "90", "-i", AUDIO,
        "-filter_complex",
        "[1:a]afade=t=in:st=0:d=1.0,afade=t=out:st=88:d=2.0[a]",
        "-map", "0:v", "-map", "[a]",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-c:a", "aac", "-b:a", "256k",
        "-t", "90", "-shortest",
        OUT,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("FINAL FAIL:", r.stderr[-3000:])
        return False
    print(f"\n✓ Done: {OUT}")
    print(f"  Size: {os.path.getsize(OUT)/1e6:.1f} MB")
    return True


if __name__ == "__main__":
    main()
