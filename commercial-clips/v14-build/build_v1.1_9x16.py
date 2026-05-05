#!/usr/bin/env python3.12
"""v1.1 9:16 native rebuild — AD prescribed portrait composition.

Approach:
- Take v151-pN-base.mp4 (no-callout 16:9 4K panels)
- Scale to 1080x608 (fit 1080 width)
- Center in 1080x1920 black canvas, panel sits at y=480-1088 (upper-mid)
- Overlay v1.1-9x16-co-*.png portrait callouts (eyebrow top, body bottom)
- Concat with portrait brand/manifesto/CTA cards
- Mix existing v151 audio (already with narration + music)
- Apply same warm-gold grade
"""
import os
import subprocess
from pathlib import Path

V14 = Path("/Users/ohadnissim/Claude/Compare/Compare App/commercial-clips/v14-build")
OUT_DIR = Path("/Users/ohadnissim/Claude/Compare/Compare App/commercial-clips")
W, H = 1080, 1920
FPS = 24

# v151 audio (already mixed: narration + music) — extract from existing master
SRC_MASTER_AUDIO = OUT_DIR / "RTMcompare-v1.1-59s.mp4"

# AD warm-gold grade (same as v1.1 16:9 master)
GRADE = (
    "curves=master='0/0 0.20/0.16 0.50/0.55 0.78/0.90 1/1',"
    "colorbalance=rs=0:gs=-.030:bs=-.010:rm=.05:gm=-.030:bm=-.06:rh=.07:gh=-.015:bh=-.05,"
    "eq=saturation=1.25:gamma=0.98:brightness=0.0"
)

# v15.1 panel order with portrait callouts and durations
# (panel_idx, duration_s, callout_png)
PANELS_9x16 = [
    (1,  3.0, "v1.1-9x16-co-overview.png"),
    (2,  2.5, "v1.1-9x16-co-abplayer.png"),
    (3,  3.0, "v1.1-9x16-co-signature.png"),
    (11, 3.5, "v1.1-9x16-co-engineer.png"),
    (4,  3.5, "v1.1-9x16-co-soundcheck.png"),
    (5,  2.5, "v1.1-9x16-co-spectrum.png"),
    (6,  3.5, "v1.1-9x16-co-rtmprofile.png"),
    (7,  2.5, "v1.1-9x16-co-eqpreview.png"),
    (13, 3.0, "v1.1-9x16-co-export.png"),
    (12, 3.0, "v1.1-9x16-co-tonal.png"),
    (8,  2.5, "v1.1-9x16-co-breakdown.png"),
    (9,  3.0, "v1.1-9x16-co-distortion.png"),
    (10, 3.5, "v1.1-9x16-co-limiter.png"),
]


def run(cmd, label=""):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"FAIL {label}:", r.stderr[-1500:])
        return False
    return True


def compose_9x16_panel(idx, dur, callout):
    """Take v151-pN-base.mp4 (16:9, no callout), compose into 1080x1920 with portrait callout."""
    src = V14 / f"v151-p{idx}-base.mp4"
    callout_path = V14 / callout
    out = V14 / f"v1.1-9x16-p{idx}.mp4"
    if out.exists() and out.stat().st_size > 100_000:
        return str(out)

    # Filter:
    # 1. Scale 16:9 source (3840x2160) to 1080x608 (fit 1080 width, preserve 16:9 ratio)
    # 2. Pad to 1080x1920 with black, position panel centered horizontally at y=480
    # 3. Overlay portrait callout PNG (already 1080x1920)
    vf_complex = (
        f"[0:v]scale=1080:608:flags=lanczos,setsar=1[panel];"
        f"[1:v]scale=1080:1920:flags=lanczos,format=rgba[co];"
        # Black canvas 1080x1920
        f"color=c=black:s=1080x1920:r={FPS}:d={dur}[bg];"
        f"[bg][panel]overlay=x=0:y=480:eof_action=pass[bg2];"
        f"[bg2][co]overlay=0:0:format=auto[v]"
    )
    cmd = [
        "ffmpeg", "-y",
        "-i", str(src),
        "-loop", "1", "-t", str(dur), "-i", str(callout_path),
        "-filter_complex", vf_complex,
        "-map", "[v]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "16",
        "-pix_fmt", "yuv420p", "-r", str(FPS), "-t", str(dur), "-an",
        str(out),
    ]
    if not run(cmd, f"compose p{idx}"):
        return None
    return str(out)


def make_card(src_png, dst_mp4, dur, zs=1.00, ze=1.04):
    """Static portrait card with subtle ease-in zoom motion."""
    if Path(dst_mp4).exists() and Path(dst_mp4).stat().st_size > 50_000:
        return str(dst_mp4)
    frames = int(dur * FPS)
    OW, OH = W * 2, H * 2  # 2160x3840 oversample for shimmer-free zoom
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


def xfade_concat(clip_paths, output_path, overlap=0.3):
    """Concat with xfade transitions."""
    durs = []
    for p in clip_paths:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                           "-of", "default=noprint_wrappers=1:nokey=1", p],
                          capture_output=True, text=True)
        durs.append(float(r.stdout.strip()))

    inputs = []
    for p in clip_paths:
        inputs += ["-i", p]

    chain = []
    for i in range(len(clip_paths)):
        chain.append(f"[{i}:v]format=yuv420p,fps={FPS},setsar=1[v{i}]")

    cumulative = durs[0]
    prev_label = "[v0]"
    for i in range(1, len(clip_paths)):
        offset = cumulative - overlap
        out_label = f"[t{i}]"
        chain.append(f"{prev_label}[v{i}]xfade=transition=fade:duration={overlap}:offset={offset:.3f}{out_label}")
        cumulative += durs[i] - overlap
        prev_label = out_label

    fc = ";".join(chain)
    cmd = ["ffmpeg", "-y"] + inputs + [
        "-filter_complex", fc,
        "-map", prev_label,
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", str(FPS), "-an", output_path,
    ]
    return run(cmd, "xfade concat") and cumulative


def build_master_9x16():
    print("=== Building v1.1 9:16 native (portrait) ===")

    # Build all panels
    panel_clips = []
    for idx, dur, callout in PANELS_9x16:
        clip = compose_9x16_panel(idx, dur, callout)
        if not clip:
            print(f"FAIL on p{idx}")
            return False
        panel_clips.append(clip)
        print(f"  ok p{idx} ({dur}s)")

    # Build cards (brand 2.5s, manifesto 3.5s, cta 5s)
    brand = make_card(V14 / "v1.1-9x16-brand.png", V14 / "v1.1-9x16-brand.mp4", 2.5)
    manifesto = make_card(V14 / "v1.1-9x16-manifesto.png", V14 / "v1.1-9x16-manifesto.mp4", 3.5)
    cta = make_card(V14 / "v1.1-9x16-cta.png", V14 / "v1.1-9x16-cta.mp4", 5.0)
    print("  ok cards (brand/manifesto/cta)")

    # Timeline: brand + 13 panels + manifesto + cta
    timeline = [brand] + panel_clips + [manifesto, cta]
    base = V14 / "v1.1-9x16-base.mp4"
    final_dur = xfade_concat(timeline, str(base), overlap=0.3)
    if not final_dur:
        return False
    print(f"  total duration: {final_dur:.2f}s")

    # Final master: apply grade + mix audio from existing v1.1-59s master
    out_master = OUT_DIR / "RTMcompare-v1.1-igstory-9x16-59s.mp4"
    cmd = [
        "ffmpeg", "-y",
        "-i", str(base),
        "-i", str(SRC_MASTER_AUDIO),
        "-filter_complex",
        f"[0:v]{GRADE}[v];[1:a]aresample=44100,aformat=channel_layouts=stereo[a]",
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-c:a", "aac", "-b:a", "256k",
        "-t", str(final_dur), "-shortest",
        str(out_master),
    ]
    if not run(cmd, "final 9x16 master"):
        return False
    print(f"\nok {out_master.name} ({os.path.getsize(out_master)/1e6:.1f} MB)")
    return out_master


def derive_short(master_path, dur, out_path):
    """Trim 9:16 master to shorter cut (keep brand + key panels + cta)."""
    # 30s: brand 2.5 + p1 3 + p4 3.5 + p3 3 + p6 3.5 + p9 3 + p10 3.5 + cta 5 + xfades = ~28-30s
    # Simpler: just trim the master from middle + keep brand head + cta tail
    # Actually for 30s and 15s, just take a head-trim of master and add cta
    # But that's not great. Let's just trim from the master time-wise.
    # Get master duration
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=noprint_wrappers=1:nokey=1", str(master_path)],
                       capture_output=True, text=True)
    full = float(r.stdout.strip())
    # Trim: head 0-X then last 8s (manifesto+cta)
    head_dur = dur - 8
    tail_start = full - 8
    # ffmpeg trim+concat via filter_complex
    cmd = [
        "ffmpeg", "-y",
        "-i", str(master_path),
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
        "-c:a", "aac", "-b:a", "256k",
        str(out_path),
    ]
    return run(cmd, f"trim {dur}s")


def main():
    out_master = build_master_9x16()
    if not out_master:
        return

    # Derive shorter cuts via simple trim+concat (head + tail)
    print("\n=== Deriving 30s and 15s cuts ===")
    derive_short(out_master, 30, OUT_DIR / "RTMcompare-v1.1-igstory-9x16-30s.mp4")
    derive_short(out_master, 15, OUT_DIR / "RTMcompare-v1.1-igstory-9x16-15s.mp4")

    print("\nALL 9:16 DELIVERABLES:")
    for f in sorted(OUT_DIR.glob("RTMcompare-v1.1-igstory-9x16-*.mp4")):
        print(f"  {f.name} ({os.path.getsize(f)/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
