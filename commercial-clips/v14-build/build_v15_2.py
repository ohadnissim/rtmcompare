#!/usr/bin/env python3.12
"""v15.2 — Concept B "FREQUENCY ATTACK".

Counter-concept to v15.1 quiet luxury:
- Beat-locked staccato cuts (every 0.58s @ 103 BPM)
- Hard cuts, glitch flashes, speed ramps — no smooth Kling transitions
- Voice: OpenAI tts-1-hd "fable" (British prosecutor)
- Tagline: "Every frequency. On trial."
- Build: rapid pre-drop tease, kick-locked panel slams, one breath moment, final declaration
"""
import subprocess
from pathlib import Path
import os

V14 = Path("/Users/ohadnissim/Claude/Compare/Compare App/commercial-clips/v14-build")
NAR = Path("/tmp/v15b-narration")
AUDIO = "/Users/ohadnissim/Dropbox/Work/Mastered/JIGI - EP/Masters/M1.1/01 TOO HIGH (MAIN) M1 29-04-2026.wav"
AUDIO_OFFSET = 13.0
DRUM_DROP_REL = 10.95
OUT_DIR = Path("/Users/ohadnissim/Claude/Compare/Compare App/commercial-clips")
W, H, FPS = 1920, 1080, 24


def run(cmd, label=""):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"FAIL {label}:", r.stderr[-1500:])
        return False
    return True


def make_micro_clip(src_video, dst, start, dur, zoom=1.0):
    """Carve a tight micro-clip from a Seedance/Kling source."""
    cmd = ["ffmpeg", "-y", "-ss", str(start), "-i", str(src_video),
           "-t", str(dur),
           "-vf", (f"scale={W}:{H}:force_original_aspect_ratio=increase,"
                   f"crop={W}:{H},"
                   f"scale=iw*{zoom}:ih*{zoom}:flags=lanczos,"
                   f"crop={W}:{H},fps={FPS},setsar=1"),
           "-c:v", "libx264", "-preset", "medium", "-crf", "16",
           "-pix_fmt", "yuv420p", "-r", str(FPS), "-an", str(dst)]
    return run(cmd, f"micro {Path(dst).name}")


def make_still_motion(still, dst, dur, zs=1.05, ze=1.18):
    if Path(dst).exists():
        return str(dst)
    frames = max(int(dur * FPS), 1)
    z_expr = f"{zs}+({ze}-{zs})*on/{frames-1}" if frames > 1 else str(zs)
    cmd = ["ffmpeg", "-y", "-loop", "1", "-i", str(still),
           "-vf", (f"scale={W*2}:{H*2}:force_original_aspect_ratio=increase,"
                   f"crop={W*2}:{H*2},"
                   f"zoompan=z='{z_expr}':x='iw*0.5-(iw/zoom/2)':y='ih*0.5-(ih/zoom/2)':"
                   f"d={frames}:s={W}x{H}:fps={FPS}"),
           "-c:v", "libx264", "-preset", "medium", "-crf", "16",
           "-pix_fmt", "yuv420p", "-r", str(FPS), "-t", str(dur), "-an", str(dst)]
    if not run(cmd, f"still {Path(still).name}"):
        return None
    return str(dst)


def make_flash(dst, dur=0.08, color="white"):
    """White flash frame for glitch transitions."""
    if Path(dst).exists():
        return str(dst)
    color_hex = "0xFFFFFF" if color == "white" else "0xE6C882"  # gold flash alternative
    cmd = ["ffmpeg", "-y", "-f", "lavfi",
           "-i", f"color=c={color_hex}:s={W}x{H}:r={FPS}:d={dur}",
           "-c:v", "libx264", "-preset", "medium", "-crf", "16",
           "-pix_fmt", "yuv420p", str(dst)]
    return run(cmd, f"flash") and str(dst)


def make_black(dst, dur):
    if Path(dst).exists():
        return str(dst)
    cmd = ["ffmpeg", "-y", "-f", "lavfi",
           "-i", f"color=c=0x050403:s={W}x{H}:r={FPS}:d={dur}",
           "-c:v", "libx264", "-preset", "medium", "-crf", "18",
           "-pix_fmt", "yuv420p", str(dst)]
    return run(cmd, "black") and str(dst)


def overlay_text(input_clip, overlay_png, output_clip, st, dur):
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", input_clip],
        capture_output=True, text=True)
    clip_dur = float(probe.stdout.strip()) if probe.returncode == 0 else dur
    end = st + dur
    cmd = ["ffmpeg", "-y", "-i", input_clip,
           "-loop", "1", "-t", str(clip_dur), "-i", overlay_png,
           "-filter_complex",
           f"[1:v]format=rgba,fade=in:st={st}:d=0.2:alpha=1,"
           f"fade=out:st={end-0.2}:d=0.2:alpha=1[ov];"
           f"[0:v][ov]overlay=0:0:enable='between(t,{st},{end})'[v]",
           "-map", "[v]", "-c:v", "libx264", "-preset", "medium", "-crf", "16",
           "-pix_fmt", "yuv420p", "-r", str(FPS), "-t", str(clip_dur), "-an",
           output_clip]
    return run(cmd, f"text {Path(overlay_png).name}")


# Source assets
SEEDANCE_CLIPS = {
    1:  "sd-1-overview.mp4",
    2:  "sd-2-ab-player.mp4",
    3:  "sd-3-mastering.mp4",
    4:  "sd-4-streaming.mp4",
    5:  "sd-5-spectrum.mp4",
    6:  "sd-6-eq-match.mp4",
    8:  "sd-8-breakdown.mp4",
    9:  "sd-9-quality.mp4",
    10: "sd-10-limiter.mp4",
}
NB_STILLS = {i: f"nb-{i}.png" for i in range(1, 11)}

BPM_BEAT = 60.0 / 103.0   # 0.5825s

CALLOUTS = {
    1:  ("v15-co-overview.png",   "OVERALL SUMMARY"),
    2:  ("v15-co-abplayer.png",   "A / B PLAYER"),
    3:  ("v15-co-signature.png",  "MASTERING SIGNATURE"),
    4:  ("v15-co-soundcheck.png", "SOUND CHECK TWIN"),
    5:  ("v15-co-spectrum.png",   "FREQUENCY SPECTRUM"),
    6:  ("v15-co-rtmprofile.png", "RTMPROFILE"),
    7:  ("v15-co-eqpreview.png",  "EQ PREVIEW"),
    8:  ("v15-co-breakdown.png",  "TONAL ISSUES"),
    9:  ("v15-co-distortion.png", "DISTORTION CHECK"),
    10: ("v15-co-limiter.png",    "LIMITER ARTEFACTS"),
}


def panel_clip(idx, dur, sub_start=0, with_callout=True):
    """Make a panel clip with optional callout and configurable subset."""
    out = V14 / f"v152-p{idx}-{int(dur*100):04d}.mp4"
    if out.exists() and out.stat().st_size > 50_000:
        return str(out)
    if idx in SEEDANCE_CLIPS:
        src = V14 / SEEDANCE_CLIPS[idx]
        # Use Seedance clip with sub_start offset
        base = V14 / f"v152-p{idx}-base-{int(dur*100):04d}.mp4"
        make_micro_clip(str(src), str(base), sub_start, dur, zoom=1.10)
    else:
        # zoompan from NB still
        base = V14 / f"v152-p{idx}-base-{int(dur*100):04d}.mp4"
        make_still_motion(str(V14 / NB_STILLS[idx]), str(base), dur, zs=1.05, ze=1.20)

    if with_callout and idx in CALLOUTS:
        co = V14 / CALLOUTS[idx][0]
        overlay_text(str(base), str(co), str(out), st=0.1, dur=max(0.5, dur - 0.4))
    else:
        cmd = ["ffmpeg", "-y", "-i", str(base), "-c", "copy", str(out)]
        run(cmd, f"copy p{idx}")
    return str(out)


def build_voice_track(timeline, total_dur, out_wav):
    inputs = []
    filters = []
    for i, (vo_id, st) in enumerate(timeline):
        vo = NAR / f"oai-{vo_id}.wav"
        if not vo.exists():
            print(f"missing {vo}")
            continue
        inputs += ["-i", str(vo)]
        delay_ms = int(st * 1000)
        filters.append(f"[{i}:a]aresample=44100,aformat=channel_layouts=stereo,adelay={delay_ms}|{delay_ms}[v{i}]")
    if not filters: return False
    n = len(filters)
    mix = "".join(f"[v{i}]" for i in range(n))
    full = ";".join(filters) + (f";{mix}amix=inputs={n}:duration=longest:dropout_transition=0:normalize=0,"
                                f"apad,atrim=0:{total_dur},aresample=44100[a]")
    cmd = ["ffmpeg", "-y"] + inputs + ["-filter_complex", full, "-map", "[a]",
                                       "-c:a", "pcm_s16le", out_wav]
    return run(cmd, "voice mix")


# ==========================================================
# 90s build
# ==========================================================
def build_90():
    print("\n=== Concept B 90s ===")
    # Pre-drop (0-11s): black-and-flash teaser
    black1 = make_black(str(V14 / "v152-black1.mp4"), 1.5)
    # Brand text reveal (1.5-4s)
    brand_in = make_still_motion(str(V14 / "v15-brand.png"), str(V14 / "v152-brand-2.5s.mp4"), 2.5, 1.00, 1.05)
    flash1 = make_flash(str(V14 / "v152-flash-fast.mp4"), 0.07)
    # 4-11s: tease cuts using NB stills 1, 5, 4, 9
    tease_p1 = panel_clip(1, 1.5, sub_start=0.5, with_callout=False)
    tease_p5 = panel_clip(5, 1.5, sub_start=1.0, with_callout=False)
    tease_p9 = panel_clip(9, 1.5, sub_start=1.5, with_callout=False)
    tease_p4 = panel_clip(4, 1.0, sub_start=2.0, with_callout=False)

    # Drum drop (11s) — kick-locked panel slams
    # Each beat = 0.5825s. Use 1-beat cuts for staccato.
    beat = BPM_BEAT
    # 11-30: 6 short panel cuts with VO snippets
    p1_a = panel_clip(1, beat*1.5, sub_start=0)
    p3_a = panel_clip(3, beat*2, sub_start=1.0)
    p2_a = panel_clip(2, beat*2, sub_start=2.0)
    p5_a = panel_clip(5, beat*1.5, sub_start=1.5)
    p9_a = panel_clip(9, beat*2, sub_start=2.5)
    p10_a = panel_clip(10, beat*2, sub_start=2.0)

    # 30-42 BREATH: slow Seedance shot — use sd-1 full
    breath = panel_clip(1, 12.0, sub_start=0, with_callout=False)

    # 42-54: rapid panel grid burst
    p4_b = panel_clip(4, beat*2.5, sub_start=0.5)
    p5_b = panel_clip(5, beat*2, sub_start=1.0)
    p3_b = panel_clip(3, beat*2.5, sub_start=2.0)
    p6_b = panel_clip(6, beat*2, sub_start=1.5)
    p8_b = panel_clip(8, beat*2.5, sub_start=2.0)

    # 54-68: metrics burst — fast panel cuts
    p7 = panel_clip(7, beat*3, sub_start=0)
    p9_c = panel_clip(9, beat*3, sub_start=1.5)
    p10_c = panel_clip(10, beat*3, sub_start=3.0)

    # 68-78: ramp + black + final declaration
    final_panel = panel_clip(1, 6.0, sub_start=2.0, with_callout=False)
    ramp_black = make_black(str(V14 / "v152-black2.mp4"), 4.0)

    # 78-90: CTA
    cta = make_still_motion(str(V14 / "v15-cta.png"), str(V14 / "v152-cta-12s.mp4"), 12.0, 1.00, 1.05)

    # Build timeline with intro flashes
    timeline = [
        black1,                # 0-1.5
        brand_in,              # 1.5-4
        flash1,                # 4-4.07
        tease_p1,              # 4.07-5.57
        flash1,
        tease_p5,              # 5.64-7.14
        flash1,
        tease_p9,              # 7.21-8.71
        flash1,
        tease_p4,              # 8.78-9.78
        # gap to drop at 11s
        make_black(str(V14 / "v152-black-tease.mp4"), 1.15),
        # DROP at 11s — staccato panel slams
        p1_a, p3_a, p2_a, p5_a, p9_a, p10_a,   # ~10s span
        breath,                # 12s breath
        p4_b, p5_b, p3_b, p6_b, p8_b,           # ~12s span
        p7, p9_c, p10_c,                         # ~5.25s span
        final_panel,                             # 6s
        ramp_black,                              # 4s
        cta,                                     # 12s
    ]

    # Concat
    concat = V14 / "concat-v152-90.txt"
    concat.write_text("".join(f"file '{p}'\n" for p in timeline))
    base = V14 / "v152-base-90.mp4"
    cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat),
           "-c", "copy", str(base)]
    if not run(cmd, "concat 90"): return None

    # Voice timing — kick-locked
    voice_timing = [
        ("intro_90",    1.8),    # "Every master lies." during brand text
        ("predrop_90",  4.5),    # "Until you measure it." during tease cuts
        ("twelve_90",   7.5),    # "Twelve metrics. One verdict."
        # DROP at 11s — silence here
        ("tp_90",       12.5),   # "True peak."
        ("crest_90",    14.5),   # "Crest factor."
        ("phase_90",    16.5),   # "Phase. Exposed."
        ("compare_90",  19.0),   # "Compare two masters. Side by side. In real time."
        ("studios_90",  31.0),   # During breath shot
        ("pocket_90",   38.0),   # End of breath
        ("metrics_90",  44.0),   # Over rapid burst
        ("guess_90",    68.5),   # During ramp/black
        ("know_90",     71.5),
        ("cta_90b",     79.5),   # On CTA
    ]
    voice = V14 / "v152-voice-90.wav"
    build_voice_track(voice_timing, 90.0, str(voice))

    # Mix
    out = OUT_DIR / "RTMcompare-v15.2-90s.mp4"
    cmd = ["ffmpeg", "-y", "-i", str(base),
           "-ss", str(AUDIO_OFFSET), "-t", "90", "-i", AUDIO,
           "-i", str(voice),
           "-filter_complex",
           "[1:a]aresample=44100,aformat=channel_layouts=stereo,volume=0.95,"
           "afade=t=in:st=0:d=0.4,afade=t=out:st=88:d=2.0[music];"
           "[2:a]aresample=44100,aformat=channel_layouts=stereo,volume=1.7,asplit=2[v1][v2];"
           "[music][v1]sidechaincompress=threshold=0.04:ratio=10:attack=30:release=350:makeup=2[duck];"
           "[duck][v2]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]",
           "-map", "0:v", "-map", "[a]",
           "-c:v", "libx264", "-preset", "slow", "-crf", "18",
           "-pix_fmt", "yuv420p", "-r", str(FPS),
           "-c:a", "aac", "-b:a", "256k", "-t", "90", "-shortest", str(out)]
    if not run(cmd, "final 90"): return None
    print(f"  ✓ {out.name} ({os.path.getsize(out)/1e6:.1f} MB)")
    return out


# ==========================================================
# 30s build (compressed Concept B)
# ==========================================================
def build_30():
    print("\n=== Concept B 30s ===")
    black1 = make_black(str(V14 / "v152-black1-30.mp4"), 0.5)
    brand_in = make_still_motion(str(V14 / "v15-brand.png"), str(V14 / "v152-brand-2s-30.mp4"), 2.0, 1.00, 1.05)
    flash1 = make_flash(str(V14 / "v152-flash-fast.mp4"), 0.07)
    # Tease (2.5-5s)
    tease_p4 = panel_clip(4, 1.2, sub_start=2.0, with_callout=False)
    # DROP at ~5s
    beat = BPM_BEAT
    # 5-22: hot cuts
    p1 = panel_clip(1, beat*2, sub_start=1)
    p4 = panel_clip(4, beat*2, sub_start=1)
    p9 = panel_clip(9, beat*2, sub_start=1)
    p3 = panel_clip(3, beat*2, sub_start=2)
    p10 = panel_clip(10, beat*2, sub_start=2)
    p5 = panel_clip(5, beat*2, sub_start=1)
    p6 = panel_clip(6, beat*2, sub_start=2)
    breath = panel_clip(2, 3.0, sub_start=1, with_callout=False)
    # 22-30 CTA + ramp
    cta = make_still_motion(str(V14 / "v15-cta.png"), str(V14 / "v152-cta-8s-30.mp4"), 8.0, 1.00, 1.05)

    timeline = [
        black1, brand_in, flash1, tease_p4,
        flash1, p1, flash1, p4, flash1, p9, flash1, p3, flash1, p10, flash1, p5, flash1, p6,
        breath, cta,
    ]
    concat = V14 / "concat-v152-30.txt"
    concat.write_text("".join(f"file '{p}'\n" for p in timeline))
    base = V14 / "v152-base-30.mp4"
    cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", str(base)]
    if not run(cmd, "concat 30"): return None

    voice_timing = [
        ("intro_90", 0.8),
        ("predrop_90", 3.2),
        ("tp_90", 6.0),
        ("phase_90", 8.0),
        ("compare_90", 10.5),
        ("guess_90", 19.0),
        ("know_90", 20.8),
        ("cta_90b", 22.5),
    ]
    voice = V14 / "v152-voice-30.wav"
    build_voice_track(voice_timing, 30.0, str(voice))

    out = OUT_DIR / "RTMcompare-v15.2-30s.mp4"
    cmd = ["ffmpeg", "-y", "-i", str(base),
           "-ss", str(AUDIO_OFFSET + 35), "-t", "30", "-i", AUDIO,
           "-i", str(voice),
           "-filter_complex",
           "[1:a]aresample=44100,aformat=channel_layouts=stereo,volume=0.95,"
           "afade=t=in:st=0:d=0.3,afade=t=out:st=28:d=1.0[music];"
           "[2:a]aresample=44100,aformat=channel_layouts=stereo,volume=1.7,asplit=2[v1][v2];"
           "[music][v1]sidechaincompress=threshold=0.04:ratio=10:attack=30:release=350:makeup=2[duck];"
           "[duck][v2]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]",
           "-map", "0:v", "-map", "[a]",
           "-c:v", "libx264", "-preset", "slow", "-crf", "18",
           "-pix_fmt", "yuv420p", "-r", str(FPS),
           "-c:a", "aac", "-b:a", "256k", "-t", "30", "-shortest", str(out)]
    if not run(cmd, "final 30"): return None
    print(f"  ✓ {out.name} ({os.path.getsize(out)/1e6:.1f} MB)")
    return out


# ==========================================================
# Aspect conversions (same as Concept A)
# ==========================================================
def to_aspect(src, aspect, dst):
    if aspect == "1:1":
        vf = "[0:v]crop=1080:1080:(iw-1080)/2:0,setsar=1[v]"
    else:
        # 9:16 with branding ribbons
        from PIL import Image, ImageDraw, ImageFont
        FONTS_DIR = "/Users/ohadnissim/Claude/Compare/Compare App/release/v5.0.5/fonts"
        if not Path("/tmp/v152-brand-top.png").exists():
            top = Image.new("RGBA", (1080, 600), (0, 0, 0, 0))
            d = ImageDraw.Draw(top)
            font = ImageFont.truetype(f"{FONTS_DIR}/InstrumentSerif-Italic.ttf", 84)
            sf = ImageFont.truetype(f"{FONTS_DIR}/InstrumentSerif-Regular.ttf", 28)
            t = "RTMcompare"
            bb = d.textbbox((0, 0), t, font=font); tw = bb[2] - bb[0]
            d.text(((1080 - tw)//2 + 2, 350), t, font=font, fill=(0,0,0,200))
            d.text(((1080 - tw)//2, 348), t, font=font, fill=(230, 200, 130, 255))
            l = "Every frequency. On trial."
            bb = d.textbbox((0, 0), l, font=sf); tw = bb[2] - bb[0]
            d.text(((1080 - tw)//2, 460), l, font=sf, fill=(245, 240, 225, 200))
            top.save("/tmp/v152-brand-top.png")
            bot = Image.new("RGBA", (1080, 600), (0, 0, 0, 0))
            d = ImageDraw.Draw(bot)
            cta = "@rtmaudio"
            f2 = ImageFont.truetype(f"{FONTS_DIR}/InstrumentSerif-Italic.ttf", 60)
            bb = d.textbbox((0, 0), cta, font=f2); tw = bb[2] - bb[0]
            d.text(((1080 - tw)//2 + 2, 132), cta, font=f2, fill=(0,0,0,200))
            d.text(((1080 - tw)//2, 130), cta, font=f2, fill=(230, 200, 130, 255))
            sub = "Coming soon"
            bb = d.textbbox((0, 0), sub, font=sf); tw = bb[2] - bb[0]
            d.text(((1080 - tw)//2, 220), sub, font=sf, fill=(245, 240, 225, 200))
            bot.save("/tmp/v152-brand-bot.png")
        vf = (
            "[0:v]scale=1080:-2,setsar=1[panel];"
            f"color=c=0x050403:s=1080x1920:r={FPS}[bg];"
            "[bg][panel]overlay=0:(1920-h)/2[base];"
            "[1:v]scale=1080:600[top];"
            "[2:v]scale=1080:600[bot];"
            "[base][top]overlay=0:0[wt];"
            "[wt][bot]overlay=0:1320[v]"
        )

    if aspect == "1:1":
        cmd = ["ffmpeg", "-y", "-i", src, "-filter_complex", vf,
               "-map", "[v]", "-map", "0:a",
               "-c:v", "libx264", "-preset", "slow", "-crf", "18",
               "-pix_fmt", "yuv420p", "-r", str(FPS), "-c:a", "copy", dst]
    else:
        probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                              "format=duration", "-of",
                              "default=noprint_wrappers=1:nokey=1", src],
                             capture_output=True, text=True)
        dur = probe.stdout.strip() if probe.returncode == 0 else "90"
        cmd = ["ffmpeg", "-y", "-i", src,
               "-loop", "1", "-i", "/tmp/v152-brand-top.png",
               "-loop", "1", "-i", "/tmp/v152-brand-bot.png",
               "-filter_complex", vf,
               "-map", "[v]", "-map", "0:a",
               "-c:v", "libx264", "-preset", "slow", "-crf", "18",
               "-pix_fmt", "yuv420p", "-r", str(FPS),
               "-c:a", "copy", "-t", str(dur), dst]
    return run(cmd, f"aspect {aspect}")


def main():
    out_90 = build_90()
    out_30 = build_30()
    if out_90:
        for aspect, label in [("1:1", "igfeed"), ("9:16", "igstory")]:
            ext = "1x1" if aspect == "1:1" else "9x16"
            to_aspect(str(out_90), aspect, str(OUT_DIR / f"RTMcompare-v15.2-{label}-{ext}-90s.mp4"))
    if out_30:
        for aspect, label in [("1:1", "igfeed"), ("9:16", "igstory")]:
            ext = "1x1" if aspect == "1:1" else "9x16"
            to_aspect(str(out_30), aspect, str(OUT_DIR / f"RTMcompare-v15.2-{label}-{ext}-30s.mp4"))

    print("\nALL CONCEPT B DELIVERABLES:")
    for f in sorted(OUT_DIR.glob("RTMcompare-v15.2-*.mp4")):
        print(f"  {f.name} ({os.path.getsize(f)/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
