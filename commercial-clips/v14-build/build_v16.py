#!/usr/bin/env python3.12
"""v16 — AD's full reset: 'Before you press upload.'
60-second shot list, real app footage + 2 Higgsfield room shots, sparse text, no VO.
"""
import os
import subprocess
from pathlib import Path

V14 = Path("/Users/ohadnissim/Claude/Compare/Compare App/commercial-clips/v14-build")
V16 = Path("/Users/ohadnissim/Claude/Compare/Compare App/commercial-clips/v16")
CO  = V16  # callouts also in v16/
AUDIO = "/Users/ohadnissim/Dropbox/Work/Mastered/JIGI - EP/Masters/M1.1/01 TOO HIGH (MAIN) M1 29-04-2026.wav"
AUDIO_OFFSET = 22.0  # AD: re-enter at song moment that feels like 0:14 of spot getting first kick
OUT_DIR = Path("/Users/ohadnissim/Claude/Compare/Compare App/commercial-clips")
W4K, H4K = 3840, 2160
FPS = 24

# AD's grade (locked)
GRADE = (
    "curves=master='0/0 0.25/0.18 0.5/0.45 0.75/0.78 1/1',"
    "eq=contrast=1.18:saturation=0.72:gamma=0.94,"
    "colorbalance=rs=-.04:gs=-.06:bs=.02:rm=.02:gm=-.04:bm=0:rh=.04:gh=-.02:bh=-.04"
)


def run(cmd, label=""):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"FAIL {label}:", r.stderr[-1000:])
        return False
    return True


def make_motion(src, dst, dur, zs=1.00, ze=1.04, xc=0.50, yc=0.50):
    """Static-ish push-in for app screens. 4K out via 8K oversample."""
    if Path(dst).exists() and Path(dst).stat().st_size > 100_000:
        return str(dst)
    frames = int(dur * FPS)
    OW, OH = W4K * 2, H4K * 2
    zoom_expr = f"({zs}+({ze}-{zs})*(0.5-0.5*cos(PI*n/{frames-1})))"
    vf = (
        f"scale={OW}:{OH}:force_original_aspect_ratio=increase:flags=lanczos,"
        f"crop={OW}:{OH},"
        f"crop=w='{OW}/{zoom_expr}':h='{OH}/{zoom_expr}':"
        f"x='(in_w-out_w)/2':y='(in_h-out_h)/2':exact=1,"
        f"scale={W4K}:{H4K}:flags=lanczos+accurate_rnd+full_chroma_int,"
        f"fps={FPS},setsar=1"
    )
    cmd = ["ffmpeg", "-y", "-loop", "1", "-i", str(src),
           "-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "16",
           "-pix_fmt", "yuv420p", "-r", str(FPS), "-t", str(dur), "-an", str(dst)]
    return run(cmd, f"motion {Path(src).name}") and str(dst)


def make_black(dst, dur):
    if Path(dst).exists():
        return str(dst)
    cmd = ["ffmpeg", "-y", "-f", "lavfi", "-i", f"color=c=black:s={W4K}x{H4K}:r={FPS}",
           "-t", str(dur), "-c:v", "libx264", "-preset", "medium", "-crf", "16",
           "-pix_fmt", "yuv420p", "-an", str(dst)]
    return run(cmd, "black") and str(dst)


def overlay_callout(input_clip, overlay_png, output_clip, st=0.2, dur=None, fade=0.3):
    """Layer callout PNG on panel video with fade in/out."""
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", input_clip],
        capture_output=True, text=True)
    clip_dur = float(probe.stdout.strip()) if probe.returncode == 0 else 3.0
    if dur is None:
        dur = clip_dur - 0.4
    end = st + dur
    cmd = ["ffmpeg", "-y", "-i", input_clip,
           "-loop", "1", "-t", str(clip_dur), "-i", overlay_png,
           "-filter_complex",
           f"[1:v]scale={W4K}:{H4K}:flags=lanczos,format=rgba,"
           f"fade=in:st={st}:d={fade}:alpha=1,"
           f"fade=out:st={end-fade}:d={fade}:alpha=1[ov];"
           f"[0:v][ov]overlay=0:0:enable='between(t,{st},{end})'[v]",
           "-map", "[v]", "-c:v", "libx264", "-preset", "medium", "-crf", "16",
           "-pix_fmt", "yuv420p", "-r", str(FPS), "-t", str(clip_dur), "-an",
           output_clip]
    return run(cmd, f"overlay {Path(overlay_png).name}") and output_clip


# ============ AD's Shot List ============
# (id, dur, kind, source, callout, motion)
SHOTS = [
    ("01", 2.5, "black",  None,                                  None,                            None),
    ("02", 2.5, "screen", "01-overview-top.png",                 "co-01-before-upload.png",       (1.00, 1.04)),
    ("03", 4.0, "screen", "01-overview-top.png",                 "co-02-master-time.png",         (1.02, 1.05)),
    ("04", 4.0, "screen", "06-streaming-normalization.png",      None,                            (1.00, 1.04)),
    ("05", 4.0, "screen", "06-streaming-normalization.png",      "co-04-spotify-lufs.png",        (1.04, 1.08)),
    ("06", 3.5, "screen", "08-frequency-spectrum.png",           "co-05-hear-it.png",             (1.00, 1.04)),
    ("07", 3.5, "screen", "01-main-overall.png",                 None,                            (1.00, 1.04)),
    ("08", 4.0, "screen", "24-eq-match-engineer-profile.png",    "co-07-eq-move.png",             (1.02, 1.06)),
    ("09", 3.5, "screen", "04-mastering-delta.png",              "co-08-31-bands.png",            (1.00, 1.05)),
    ("10", 3.5, "screen", "20-limiter-detail.png",               "co-09-pumping.png",             (1.02, 1.06)),
    ("11", 3.5, "screen", "23-tonal-issues-only.png",            "co-10-how-to-fix.png",          (1.00, 1.04)),
    ("12", 3.5, "screen", "25-export-eq.png",                    "co-11-fabfilter.png",           (1.02, 1.05)),
    ("13", 4.0, "screen", "22-ab-player-closeup.png",            "co-12-blind.png",               (1.00, 1.04)),
    ("14", 3.0, "screen", "18-overview-final.png",               "co-13-cleared.png",             (1.00, 1.05)),
    # Higgsfield room shots
    ("15", 3.0, "still",  "HIGGS-01-room-still.png",             None,                            (1.00, 1.03)),
    ("16", 3.5, "video",  "HIGGS-02-room-drift.mp4",             None,                            None),
    ("17", 3.0, "card",   "co-final-respect.png",                None,                            None),
    ("18", 1.5, "card",   "co-final-lockup.png",                 None,                            None),
]


def build_shot(s):
    sid, dur, kind, src, co, motion = s
    out = V16 / f"v16-s{sid}.mp4"
    if out.exists() and out.stat().st_size > 50_000:
        return str(out)

    if kind == "black":
        return make_black(out, dur)

    if kind == "card":
        # Static card from PNG, no motion
        cmd = ["ffmpeg", "-y", "-loop", "1", "-i", str(CO / src),
               "-vf", f"scale={W4K}:{H4K}:flags=lanczos,format=yuv420p,fps={FPS},setsar=1",
               "-c:v", "libx264", "-preset", "medium", "-crf", "16",
               "-r", str(FPS), "-t", str(dur), "-an", str(out)]
        return run(cmd, f"card {sid}") and str(out)

    if kind == "still":
        # Higgsfield still — apply zoom motion
        zs, ze = motion
        return make_motion(str(V16 / src), str(out), dur, zs=zs, ze=ze)

    if kind == "video":
        # Higgsfield video — scale to 4K + trim
        cmd = ["ffmpeg", "-y", "-i", str(V16 / src),
               "-vf", f"scale={W4K}:{H4K}:flags=lanczos,fps={FPS},setsar=1",
               "-t", str(dur),
               "-c:v", "libx264", "-preset", "medium", "-crf", "16",
               "-pix_fmt", "yuv420p", "-r", str(FPS), "-an", str(out)]
        return run(cmd, f"video {sid}") and str(out)

    if kind == "screen":
        # Real app screenshot with motion + optional callout
        zs, ze = motion
        base = V16 / f"v16-s{sid}-base.mp4"
        if not make_motion(str(V14 / src), str(base), dur, zs=zs, ze=ze):
            return None
        if co:
            return overlay_callout(str(base), str(CO / co), str(out),
                                   st=0.3, dur=dur - 0.6, fade=0.25)
        else:
            import shutil
            shutil.copy(base, out)
            return str(out)


def hard_concat(clips, output):
    """Hard concat (no xfade) — AD wants real cuts."""
    list_file = V16 / "concat-v16.txt"
    with open(list_file, "w") as f:
        for p in clips:
            f.write(f"file '{p}'\n")
    cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
           "-c:v", "libx264", "-preset", "medium", "-crf", "18",
           "-pix_fmt", "yuv420p", "-r", str(FPS), "-an", output]
    return run(cmd, "concat")


def main():
    print("=== Building v16 (AD reset: 'Before you press upload.') ===\n")
    clips = []
    for s in SHOTS:
        c = build_shot(s)
        if not c:
            print(f"FAIL on shot {s[0]}")
            return
        clips.append(c)
        print(f"  ok shot {s[0]} ({s[1]}s, {s[2]})")

    base = V16 / "v16-base.mp4"
    if not hard_concat(clips, str(base)):
        return

    durs = [s[1] for s in SHOTS]
    total_dur = sum(durs)
    print(f"\n  total duration: {total_dur:.1f}s")

    # Final render: apply grade + music
    out_master = OUT_DIR / "RTMcompare-v1.6-60s.mp4"
    music_dur = total_dur
    fade_out = max(0, music_dur - 1.5)

    cmd = [
        "ffmpeg", "-y",
        "-i", str(base),
        "-ss", str(AUDIO_OFFSET), "-t", str(music_dur), "-i", AUDIO,
        "-filter_complex",
        # Apply AD grade
        f"[0:v]{GRADE}[v];"
        # Music: build progressively per AD plan
        # 0-4.5s silence/room, 4.5s sub thump, 9s vinyl crackle, 14s first kick, 17-46s full beat,
        # 46-49s thin to kick+sub, 49-55.5s rebuild, 55.5-60s full resolve
        # Simplified: fade in over 14s (gradual build), fade out at end
        f"[1:a]aresample=44100,aformat=channel_layouts=stereo,volume=0.85,"
        f"afade=t=in:st=0:d=14,afade=t=out:st={fade_out:.2f}:d=1.5[a]",
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-c:a", "aac", "-b:a", "256k",
        "-t", str(music_dur), "-shortest",
        str(out_master)]
    if not run(cmd, "final v16"):
        return
    print(f"\nok {out_master.name} ({os.path.getsize(out_master)/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
