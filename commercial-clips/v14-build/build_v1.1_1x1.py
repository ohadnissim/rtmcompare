#!/usr/bin/env python3.12
"""v1.1 1:1 native rebuild — center-crop 16:9 panels to 1:1 + 1:1-specific callouts."""
import os
import subprocess
from pathlib import Path

V14 = Path("/Users/ohadnissim/Claude/Compare/Compare App/commercial-clips/v14-build")
OUT_DIR = Path("/Users/ohadnissim/Claude/Compare/Compare App/commercial-clips")
W, H = 1080, 1080
FPS = 24
SRC_MASTER_AUDIO = OUT_DIR / "RTMcompare-v1.1-59s.mp4"

GRADE = (
    "curves=master='0/0 0.20/0.16 0.50/0.55 0.78/0.90 1/1',"
    "colorbalance=rs=0:gs=-.030:bs=-.010:rm=.05:gm=-.030:bm=-.06:rh=.07:gh=-.015:bh=-.05,"
    "eq=saturation=1.25:gamma=0.98:brightness=0.0"
)

PANELS_1x1 = [
    (1,  3.0, "v1.1-1x1-co-overview.png"),
    (2,  2.5, "v1.1-1x1-co-abplayer.png"),
    (3,  3.0, "v1.1-1x1-co-signature.png"),
    (11, 3.5, "v1.1-1x1-co-engineer.png"),
    (4,  3.5, "v1.1-1x1-co-soundcheck.png"),
    (5,  2.5, "v1.1-1x1-co-spectrum.png"),
    (6,  3.5, "v1.1-1x1-co-rtmprofile.png"),
    (7,  2.5, "v1.1-1x1-co-eqpreview.png"),
    (13, 3.0, "v1.1-1x1-co-export.png"),
    (12, 3.0, "v1.1-1x1-co-tonal.png"),
    (8,  2.5, "v1.1-1x1-co-breakdown.png"),
    (9,  3.0, "v1.1-1x1-co-distortion.png"),
    (10, 3.5, "v1.1-1x1-co-limiter.png"),
]


def run(cmd, label=""):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"FAIL {label}:", r.stderr[-1000:])
        return False
    return True


def compose_1x1_panel(idx, dur, callout):
    """Center-crop 16:9 base panel to 1:1 + overlay 1:1 callout."""
    src = V14 / f"v151-p{idx}-base.mp4"
    callout_path = V14 / callout
    out = V14 / f"v1.1-1x1-p{idx}.mp4"
    if out.exists() and out.stat().st_size > 100_000:
        return str(out)
    # Source is 4K 16:9 (3840x2160). Center-crop to 2160x2160, then scale to 1080x1080.
    vf_complex = (
        f"[0:v]crop=ih:ih:(iw-ih)/2:0,scale=1080:1080:flags=lanczos,setsar=1[panel];"
        f"[1:v]scale=1080:1080:flags=lanczos,format=rgba[co];"
        f"[panel][co]overlay=0:0:format=auto[v]"
    )
    cmd = [
        "ffmpeg", "-y", "-i", str(src),
        "-loop", "1", "-t", str(dur), "-i", str(callout_path),
        "-filter_complex", vf_complex, "-map", "[v]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "16",
        "-pix_fmt", "yuv420p", "-r", str(FPS), "-t", str(dur), "-an",
        str(out),
    ]
    return run(cmd, f"compose 1x1 p{idx}") and str(out)


def make_card(src_png, dst_mp4, dur, zs=1.00, ze=1.04):
    if Path(dst_mp4).exists() and Path(dst_mp4).stat().st_size > 50_000:
        return str(dst_mp4)
    frames = int(dur * FPS)
    OW, OH = W * 2, H * 2
    zoom_expr = f"({zs}+({ze}-{zs})*(0.5-0.5*cos(PI*n/{frames-1})))"
    vf = (
        f"scale={OW}:{OH}:force_original_aspect_ratio=increase:flags=lanczos,"
        f"crop={OW}:{OH},"
        f"crop=w='{OW}/{zoom_expr}':h='{OH}/{zoom_expr}':"
        f"x='(in_w-out_w)/2':y='(in_h-out_h)/2':exact=1,"
        f"scale={W}:{H}:flags=lanczos+accurate_rnd+full_chroma_int,"
        f"fps={FPS},setsar=1"
    )
    cmd = ["ffmpeg", "-y", "-loop", "1", "-i", str(src_png),
           "-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "16",
           "-pix_fmt", "yuv420p", "-r", str(FPS), "-t", str(dur), "-an", str(dst_mp4)]
    return run(cmd, f"card {Path(src_png).name}") and str(dst_mp4)


def xfade_concat(clips, output, overlap=0.3):
    durs = []
    for p in clips:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                            "-of", "default=noprint_wrappers=1:nokey=1", p],
                           capture_output=True, text=True)
        durs.append(float(r.stdout.strip()))
    inputs = []
    for p in clips:
        inputs += ["-i", p]
    chain = []
    for i in range(len(clips)):
        chain.append(f"[{i}:v]format=yuv420p,fps={FPS},setsar=1[v{i}]")
    cumulative = durs[0]
    prev = "[v0]"
    for i in range(1, len(clips)):
        offset = cumulative - overlap
        out_label = f"[t{i}]"
        chain.append(f"{prev}[v{i}]xfade=transition=fade:duration={overlap}:offset={offset:.3f}{out_label}")
        cumulative += durs[i] - overlap
        prev = out_label
    cmd = ["ffmpeg", "-y"] + inputs + [
        "-filter_complex", ";".join(chain),
        "-map", prev, "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", str(FPS), "-an", output]
    return run(cmd, "xfade") and cumulative


def build_1x1():
    print("=== Building v1.1 1:1 native ===")
    panel_clips = []
    for idx, dur, co in PANELS_1x1:
        clip = compose_1x1_panel(idx, dur, co)
        if not clip:
            return None
        panel_clips.append(clip)
        print(f"  ok p{idx}")
    brand = make_card(V14 / "v1.1-1x1-brand.png", V14 / "v1.1-1x1-brand.mp4", 2.5)
    manifesto = make_card(V14 / "v1.1-1x1-manifesto.png", V14 / "v1.1-1x1-manifesto.mp4", 3.5)
    cta = make_card(V14 / "v1.1-1x1-cta.png", V14 / "v1.1-1x1-cta.mp4", 5.0)
    print("  ok cards")
    timeline = [brand] + panel_clips + [manifesto, cta]
    base = V14 / "v1.1-1x1-base.mp4"
    final_dur = xfade_concat(timeline, str(base), 0.3)
    if not final_dur:
        return None
    print(f"  total: {final_dur:.2f}s")
    out_master = OUT_DIR / "RTMcompare-v1.1-igfeed-1x1-59s.mp4"
    cmd = [
        "ffmpeg", "-y", "-i", str(base), "-i", str(SRC_MASTER_AUDIO),
        "-filter_complex",
        f"[0:v]{GRADE}[v];[1:a]aresample=44100,aformat=channel_layouts=stereo[a]",
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", str(FPS), "-c:a", "aac", "-b:a", "256k",
        "-t", str(final_dur), "-shortest", str(out_master)]
    if not run(cmd, "1x1 master"):
        return None
    print(f"\nok {out_master.name} ({os.path.getsize(out_master)/1e6:.1f} MB)")
    return out_master


def derive_short(master, dur, out):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=noprint_wrappers=1:nokey=1", str(master)],
                       capture_output=True, text=True)
    full = float(r.stdout.strip())
    head_dur = dur - 8
    tail_start = full - 8
    cmd = ["ffmpeg", "-y", "-i", str(master),
           "-filter_complex",
           f"[0:v]trim=0:{head_dur},setpts=PTS-STARTPTS[v1];"
           f"[0:a]atrim=0:{head_dur},asetpts=PTS-STARTPTS[a1];"
           f"[0:v]trim={tail_start}:{full},setpts=PTS-STARTPTS[v2];"
           f"[0:a]atrim={tail_start}:{full},asetpts=PTS-STARTPTS[a2];"
           f"[v1][v2]concat=n=2:v=1:a=0[v];"
           f"[a1][a2]concat=n=2:v=0:a=1[a]",
           "-map", "[v]", "-map", "[a]",
           "-c:v", "libx264", "-preset", "slow", "-crf", "18",
           "-pix_fmt", "yuv420p", "-r", str(FPS),
           "-c:a", "aac", "-b:a", "256k", str(out)]
    return run(cmd, f"trim {dur}s")


def main():
    out_master = build_1x1()
    if not out_master:
        return
    print("\n=== Deriving 30s and 15s ===")
    derive_short(out_master, 30, OUT_DIR / "RTMcompare-v1.1-igfeed-1x1-30s.mp4")
    derive_short(out_master, 15, OUT_DIR / "RTMcompare-v1.1-igfeed-1x1-15s.mp4")
    print("\nALL 1:1 DELIVERABLES:")
    for f in sorted(OUT_DIR.glob("RTMcompare-v1.1-igfeed-1x1-*.mp4")):
        print(f"  {f.name} ({os.path.getsize(f)/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
