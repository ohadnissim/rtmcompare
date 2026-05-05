#!/usr/bin/env python3.12
"""Build v15 conversion-focused recut + 4 lengths × 2 aspect ratios = 8 deliverables.

Adds:
- Hook frame at 0:00 ("Hear it through Spotify")
- Feature callouts overlaid on key panels (Sound Check Twin, Mastering Signature, RTMprofile, Distortion Check)
- CTA card with "@rtmaudio" + "Coming soon"
- Audio: TOO HIGH (MAIN) M1, starting at 0:13

Output:
- v15-master-16x9-90s/60s/30s/15s.mp4
- v15-igfeed-1x1-90s/60s/30s/15s.mp4
- v15-igstory-9x16-90s/60s/30s/15s.mp4
"""
import subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import os

V14 = Path("/Users/ohadnissim/Claude/Compare/Compare App/commercial-clips/v14-build")
AUDIO = "/Users/ohadnissim/Dropbox/Work/Mastered/JIGI - EP/Masters/M1.1/01 TOO HIGH (MAIN) M1 29-04-2026.wav"
AUDIO_OFFSET = 13.0   # start at 0:13 of source
OUT_DIR = Path("/Users/ohadnissim/Claude/Compare/Compare App/commercial-clips")
W, H, FPS = 1920, 1080, 24


def run(cmd, label=""):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"FAIL {label}:", r.stderr[-1500:])
        return False
    return True


def make_motion_from_still(src, dst, dur, zs=1.00, ze=1.06, xc=0.50, yc=0.50):
    if Path(dst).exists():
        return str(dst)
    frames = int(dur * FPS)
    z_expr = f"{zs}+({ze}-{zs})*on/{frames-1}"
    x_expr = f"iw*{xc}-(iw/zoom/2)"
    y_expr = f"ih*{yc}-(ih/zoom/2)"
    vf = (
        f"scale={W*2}:{H*2}:force_original_aspect_ratio=increase,"
        f"crop={W*2}:{H*2},"
        f"zoompan=z='{z_expr}':x='{x_expr}':y='{y_expr}':"
        f"d={frames}:s={W}x{H}:fps={FPS}"
    )
    cmd = [
        "ffmpeg", "-y", "-loop", "1", "-i", str(src),
        "-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "16",
        "-pix_fmt", "yuv420p", "-r", str(FPS), "-t", str(dur), "-an", str(dst),
    ]
    if not run(cmd, f"motion {Path(src).name}"):
        return None
    return str(dst)


def normalize(src_name, dur, dst_name, start=0):
    src = V14 / src_name
    dst = V14 / dst_name
    if dst.exists() and dst.stat().st_size > 100_000:
        return str(dst)
    cmd = [
        "ffmpeg", "-y", "-ss", str(start), "-i", str(src),
        "-t", str(dur),
        "-vf", f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS},setsar=1",
        "-c:v", "libx264", "-preset", "medium", "-crf", "16",
        "-pix_fmt", "yuv420p", "-r", str(FPS), "-an", str(dst),
    ]
    if not run(cmd, f"norm {src_name}"):
        return None
    return str(dst)


def overlay_callout(input_clip, overlay_png, output_clip, st, dur):
    """Composite a transparent callout PNG over a video clip with fade in/out."""
    # Get the input clip duration so we can constrain the output
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", input_clip],
        capture_output=True, text=True
    )
    clip_dur = float(probe.stdout.strip()) if probe.returncode == 0 else dur
    end = st + dur
    cmd = [
        "ffmpeg", "-y",
        "-i", input_clip,
        "-loop", "1", "-t", str(clip_dur), "-i", overlay_png,
        "-filter_complex",
        f"[1:v]format=rgba,fade=in:st={st}:d=0.4:alpha=1,"
        f"fade=out:st={end-0.4}:d=0.4:alpha=1[ov];"
        f"[0:v][ov]overlay=0:0:enable='between(t,{st},{end})'[v]",
        "-map", "[v]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "16",
        "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-t", str(clip_dur),
        "-an",
        output_clip,
    ]
    return run(cmd, f"overlay {Path(overlay_png).name}")


def build_master_90s():
    """Build the 90s 16:9 master — opens directly with brand reveal (no hook)."""
    print("\n=== Building 90s master (no hook) ===")

    # Brand reveal extended to 8s (replacing hook+brand split)
    make_motion_from_still(str(V14 / "v15-brand.png"),
                           str(V14 / "v15-brand-8s.mp4"),
                           dur=8.0, zs=1.00, ze=1.10)
    make_motion_from_still(str(V14 / "v15-cta.png"),
                           str(V14 / "v15-cta-motion.mp4"),
                           dur=14.0, zs=1.00, ze=1.06)

    # 2. Take Seedance panels + apply callout overlays where needed
    # Original durations: sd-1 6s, sd-2 6s, sd-3 6s, sd-4 6s, sd-5 6s, sd-6 6s, sd-7 (zoompan) 6s, sd-8 6s, sd-9 8s, sd-10 8s
    # We'll trim to: 6/6/6/6/5/5/5/5/7/8 = 59s

    panel_durs = [6, 6, 6, 6, 5, 5, 5, 5, 7, 8]
    panel_files = [
        ("sd-1-overview.mp4",     None,                            None),
        ("sd-2-ab-player.mp4",    None,                            None),
        ("sd-3-mastering.mp4",    "v15-co-signature.png",           "MASTERING SIGNATURE"),
        ("sd-4-streaming.mp4",    "v15-co-soundcheck.png",          "SOUND CHECK TWIN"),
        ("sd-5-spectrum.mp4",     "v15-co-spectrum.png",            "FREQUENCY SPECTRUM"),
        ("sd-6-eq-match.mp4",     "v15-co-rtmprofile.png",          "RTMPROFILE"),
        # Panel 7 (eq-preview): zoompan from nb-7.png
        (None,                    None,                            None),  # handled separately
        ("sd-8-breakdown.mp4",    None,                            None),
        ("sd-9-quality.mp4",      "v15-co-distortion.png",          "DISTORTION CHECK"),
        ("sd-10-limiter.mp4",     None,                            None),
    ]

    # Generate panel 7 motion from nb-7.png (since Seedance NSFW-flagged)
    make_motion_from_still(str(V14 / "nb-7.png"),
                           str(V14 / "p7-motion.mp4"),
                           dur=5.0, zs=1.00, ze=1.07)

    # Build each panel clip with optional callout
    panel_outs = []
    for i, (src, callout_png, _label) in enumerate(panel_files):
        idx = i + 1
        dur = panel_durs[i]
        out = V14 / f"v15-p{idx}.mp4"

        if src is None:
            # Panel 7 — zoompan motion already built
            normalized = normalize("p7-motion.mp4", dur, f"v15-p{idx}-norm.mp4")
        else:
            normalized = normalize(src, dur, f"v15-p{idx}-norm.mp4")

        if callout_png:
            # Apply callout overlay
            overlay_callout(normalized, str(V14 / callout_png), str(out),
                           st=1.5, dur=dur - 2.0)
        else:
            # Just copy
            cmd = ["ffmpeg", "-y", "-i", normalized, "-c", "copy", str(out)]
            run(cmd, f"copy {idx}")
        panel_outs.append(str(out))
        print(f"  ✓ panel {idx}")

    # 3. Normalize Kling transitions
    kling_outs = []
    for i, kl_name in enumerate(["kl-1.mp4", "kl-2.mp4", "kl-3.mp4"], start=1):
        out = normalize(kl_name, 3.0, f"v15-kl{i}.mp4", start=0.3)
        kling_outs.append(out)

    # 4. Build master timeline (90s, no hook — brand reveal is now the opener)
    # Timeline:
    #  0-8    brand reveal (8s)  ← extended, replaces hook+brand split
    #  8-14   p1 (6s)
    # 14-17   kl1 (3s)
    # 17-23   p2 (6s)
    # 23-29   p3 (6s)
    # 29-35   p4 (6s)
    # 35-40   p5 (5s)
    # 40-43   kl2 (3s)
    # 43-48   p6 (5s)
    # 48-53   p7 (5s)
    # 53-58   p8 (5s)
    # 58-65   p9 (7s)
    # 65-68   kl3 (3s)
    # 68-76   p10 (8s)
    # 76-90   cta (14s)
    timeline_90 = [
        str(V14 / "v15-brand-8s.mp4"),
        panel_outs[0],
        kling_outs[0],
        panel_outs[1],
        panel_outs[2],
        panel_outs[3],
        panel_outs[4],
        kling_outs[1],
        panel_outs[5],
        panel_outs[6],
        panel_outs[7],
        panel_outs[8],
        kling_outs[2],
        panel_outs[9],
        str(V14 / "v15-cta-motion.mp4"),
    ]
    return timeline_90, panel_outs, kling_outs


def concat_with_audio(timeline, audio_offset, dur, out_path):
    """Concat clips and mux with audio segment."""
    concat_list = V14 / f"concat-{Path(out_path).stem}.txt"
    concat_list.write_text("".join(f"file '{p}'\n" for p in timeline))
    base = V14 / f"v15-base-{Path(out_path).stem}.mp4"
    cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list),
           "-c", "copy", str(base)]
    if not run(cmd, "concat"):
        return False

    # Add audio with fade
    fade_out_start = max(0, dur - 1.5)
    cmd = [
        "ffmpeg", "-y", "-i", str(base),
        "-ss", str(audio_offset), "-t", str(dur), "-i", AUDIO,
        "-filter_complex",
        f"[1:a]afade=t=in:st=0:d=0.6,afade=t=out:st={fade_out_start}:d=1.5[a]",
        "-map", "0:v", "-map", "[a]",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-c:a", "aac", "-b:a", "256k",
        "-t", str(dur), "-shortest",
        str(out_path),
    ]
    return run(cmd, f"final {Path(out_path).name}")


def make_shorter_cut(timeline_90, panels, klings, cta_dur, dur, out_path):
    """Build a shorter cut by selecting a subset of panels."""
    if dur == 60:
        # NO HOOK. Brand 4s + p1 4 + p4 5 + p3 5 + p5 5 + p6 5 + p9 6 + kl3 3 + p10 8 + cta 15 = 60
        timeline = []
        make_motion_from_still(str(V14 / "v15-brand.png"), str(V14 / "v15-brand-4s.mp4"), 4.0, 1.00, 1.07)
        make_motion_from_still(str(V14 / "v15-cta.png"), str(V14 / "v15-cta-15s.mp4"), 15.0, 1.00, 1.07)
        # Trim panels
        norm_p1_4 = normalize("sd-1-overview.mp4", 4.0, "v15-60-p1.mp4")
        norm_p4_5 = normalize("sd-4-streaming.mp4", 5.0, "v15-60-p4-norm.mp4")
        norm_p3_5 = normalize("sd-3-mastering.mp4", 5.0, "v15-60-p3-norm.mp4")
        norm_p5_5 = normalize("sd-5-spectrum.mp4", 5.0, "v15-60-p5-norm.mp4")
        norm_p6_5 = normalize("sd-6-eq-match.mp4", 5.0, "v15-60-p6-norm.mp4")
        norm_p9_6 = normalize("sd-9-quality.mp4", 6.0, "v15-60-p9-norm.mp4")
        norm_p10_8 = normalize("sd-10-limiter.mp4", 8.0, "v15-60-p10.mp4")
        norm_kl3 = normalize("kl-3.mp4", 3.0, "v15-60-kl3.mp4", start=0.3)
        # Apply callouts
        out_p4 = V14 / "v15-60-p4.mp4"
        overlay_callout(norm_p4_5, str(V14 / "v15-co-soundcheck.png"), str(out_p4), st=0.8, dur=3.5)
        out_p3 = V14 / "v15-60-p3.mp4"
        overlay_callout(norm_p3_5, str(V14 / "v15-co-signature.png"), str(out_p3), st=0.8, dur=3.5)
        out_p5 = V14 / "v15-60-p5.mp4"
        overlay_callout(norm_p5_5, str(V14 / "v15-co-spectrum.png"), str(out_p5), st=0.8, dur=3.5)
        out_p6 = V14 / "v15-60-p6.mp4"
        overlay_callout(norm_p6_5, str(V14 / "v15-co-rtmprofile.png"), str(out_p6), st=0.8, dur=3.5)
        out_p9 = V14 / "v15-60-p9.mp4"
        overlay_callout(norm_p9_6, str(V14 / "v15-co-distortion.png"), str(out_p9), st=0.8, dur=4.0)
        timeline = [
            str(V14 / "v15-brand-4s.mp4"),
            norm_p1_4,
            str(out_p4),
            str(out_p3),
            str(out_p5),
            str(out_p6),
            str(out_p9),
            norm_kl3,
            norm_p10_8,
            str(V14 / "v15-cta-15s.mp4"),
        ]
        return concat_with_audio(timeline, AUDIO_OFFSET, 60.0, out_path)

    elif dur == 30:
        # NO HOOK. Brand 3s + p4 5 + p9 5 + p10 5 + p5 4 + cta 8 = 30
        make_motion_from_still(str(V14 / "v15-brand.png"), str(V14 / "v15-brand-3s.mp4"), 3.0, 1.00, 1.05)
        make_motion_from_still(str(V14 / "v15-cta.png"), str(V14 / "v15-cta-9s.mp4"), 9.0, 1.00, 1.07)
        norm_p4_5 = normalize("sd-4-streaming.mp4", 5.0, "v15-30-p4-norm.mp4")
        norm_p9_5 = normalize("sd-9-quality.mp4", 5.0, "v15-30-p9-norm.mp4")
        norm_p10_5 = normalize("sd-10-limiter.mp4", 5.0, "v15-30-p10.mp4")
        norm_p5_4 = normalize("sd-5-spectrum.mp4", 4.0, "v15-30-p5.mp4")
        out_p4 = V14 / "v15-30-p4.mp4"
        overlay_callout(norm_p4_5, str(V14 / "v15-co-soundcheck.png"), str(out_p4), st=0.5, dur=4.0)
        out_p9 = V14 / "v15-30-p9.mp4"
        overlay_callout(norm_p9_5, str(V14 / "v15-co-distortion.png"), str(out_p9), st=0.5, dur=4.0)
        # 30s update: brand 3s + p4 5 + p9 5 + p10 5 + p5 4 + cta 8 = 30
        make_motion_from_still(str(V14 / "v15-cta.png"), str(V14 / "v15-cta-8s.mp4"), 8.0, 1.00, 1.07)
        timeline = [
            str(V14 / "v15-brand-3s.mp4"),
            str(out_p4),
            str(out_p9),
            norm_p10_5,
            norm_p5_4,
            str(V14 / "v15-cta-8s.mp4"),
        ]
        return concat_with_audio(timeline, AUDIO_OFFSET + 35.0, 30.0, out_path)  # use hot section

    elif dur == 15:
        # NO HOOK. Brand 2s + p4 5 + p10 4 + cta 4 = 15
        make_motion_from_still(str(V14 / "v15-brand.png"), str(V14 / "v15-brand-2s.mp4"), 2.0, 1.00, 1.03)
        make_motion_from_still(str(V14 / "v15-cta.png"), str(V14 / "v15-cta-4s.mp4"), 4.0, 1.00, 1.05)
        norm_p4_5 = normalize("sd-4-streaming.mp4", 5.0, "v15-15-p4-norm.mp4")
        norm_p10_4 = normalize("sd-10-limiter.mp4", 4.0, "v15-15-p10.mp4")
        out_p4 = V14 / "v15-15-p4.mp4"
        overlay_callout(norm_p4_5, str(V14 / "v15-co-soundcheck.png"), str(out_p4), st=0.5, dur=4.0)
        timeline = [
            str(V14 / "v15-brand-2s.mp4"),
            str(out_p4),
            norm_p10_4,
            str(V14 / "v15-cta-4s.mp4"),
        ]
        return concat_with_audio(timeline, AUDIO_OFFSET + 47.0, 15.0, out_path)  # punchier section


def to_aspect(input_path, aspect, output_path):
    """Re-encode 16:9 video to 1:1 (1080x1080) or 9:16 (1080x1920)."""
    if aspect == "1:1":
        # 1080x1080: scale 16:9 to 1080w → 607h, center vertically
        vf = (
            f"[0:v]scale=1080:-2,pad=1080:1080:0:(1080-ih)/2:color=0x050403[v]"
        )
        outsize = "1080x1080"
    elif aspect == "9:16":
        # 1080x1920: scale 16:9 to 1080w → 607h, center vertically
        vf = (
            f"[0:v]scale=1080:-2,pad=1080:1920:0:(1920-ih)/2:color=0x050403[v]"
        )
        outsize = "1080x1920"
    else:
        return False
    cmd = [
        "ffmpeg", "-y", "-i", input_path,
        "-filter_complex", vf,
        "-map", "[v]", "-map", "0:a",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-c:a", "copy",
        output_path,
    ]
    return run(cmd, f"aspect {aspect}")


def main():
    # Build 90s master
    timeline_90, panels, klings = build_master_90s()
    out_90 = OUT_DIR / "RTMcompare-v15-90s.mp4"
    if not concat_with_audio(timeline_90, AUDIO_OFFSET, 90.0, out_90):
        print("90s build failed")
        return False
    print(f"\n✓ 90s master: {out_90}")

    # Build 60s, 30s, 15s
    out_60 = OUT_DIR / "RTMcompare-v15-60s.mp4"
    out_30 = OUT_DIR / "RTMcompare-v15-30s.mp4"
    out_15 = OUT_DIR / "RTMcompare-v15-15s.mp4"
    make_shorter_cut(timeline_90, panels, klings, 14.0, 60.0, str(out_60))
    print(f"✓ 60s: {out_60}")
    make_shorter_cut(timeline_90, panels, klings, 14.0, 30.0, str(out_30))
    print(f"✓ 30s: {out_30}")
    make_shorter_cut(timeline_90, panels, klings, 14.0, 15.0, str(out_15))
    print(f"✓ 15s: {out_15}")

    # Generate aspect ratio variants
    print("\n=== Aspect ratio variants ===")
    for src, base in [(out_90, "90s"), (out_60, "60s"), (out_30, "30s"), (out_15, "15s")]:
        for aspect, label in [("1:1", "igfeed"), ("9:16", "igstory")]:
            ext = "1x1" if aspect == "1:1" else "9x16"
            out = OUT_DIR / f"RTMcompare-v15-{label}-{ext}-{base}.mp4"
            to_aspect(str(src), aspect, str(out))
            print(f"  ✓ {out.name}")

    print("\nALL DELIVERABLES:")
    for f in sorted(OUT_DIR.glob("RTMcompare-v15-*.mp4")):
        print(f"  {f.name} ({os.path.getsize(f)/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
