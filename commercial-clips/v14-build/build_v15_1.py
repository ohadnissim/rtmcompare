#!/usr/bin/env python3.12
"""v15.1 — Marketing-feedback recut.

Changes from v15:
- NO HOOK: starts directly with brand reveal (11s, ends on drum drop at 10.95s)
- Drum-drop sync: cut from brand → first panel ON the drum drop
- ALL 10 panels have description callouts (was 5/10 before)
- More panel zoom (zs 1.05 → ze 1.18) for text readability
- Aspect conversions FILL the frame (no letterbox):
  * 1:1 IG Feed: center-crop 16:9 → 1:1
  * 9:16 IG Story: panel center + persistent RTMcompare/CTA branding ribbons
- Premium narration via piper Ryan neural TTS (OpenAI quota exhausted)
- Music ducks to 25% during narration, swells back during transitions
"""
import subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import os

V14 = Path("/Users/ohadnissim/Claude/Compare/Compare App/commercial-clips/v14-build")
NAR = Path("/tmp/v15-narration")
NAR_PREFIX = "oai-"  # OpenAI onyx WAVs prefix
AUDIO = "/Users/ohadnissim/Dropbox/Work/Mastered/JIGI - EP/Masters/M1.1/01 TOO HIGH (MAIN) M1 29-04-2026.wav"
AUDIO_OFFSET = 36.0  # User: start song from 0:36
DRUM_DROP_REL = 0    # Already past drop at 0:36
OUT_DIR = Path("/Users/ohadnissim/Claude/Compare/Compare App/commercial-clips")
W, H, FPS = 1920, 1080, 24
# 4K output dimensions for master (panels rendered at 1080 then upscaled with lanczos + unsharp)
W4K, H4K = 3840, 2160


def run(cmd, label=""):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"FAIL {label}:", r.stderr[-1500:])
        return False
    return True


def make_motion(src, dst, dur, zs=1.00, ze=1.04, xc=0.50, yc=0.50):
    """Codex shimmer fix: 2x oversample → float crop → anti-aliased downscale.

    Pipeline:
    1. Scale source to 8K (7680x4320) ONCE — high-precision source
    2. Apply zoom via `crop` filter with FLOAT expressions (not zoompan's integer rounding)
    3. Downscale to 4K with `lanczos+accurate_rnd+full_chroma_int` — the 2x downscale
       acts as anti-alias filter, averaging per-frame text-edge jitter into smooth motion

    This eliminates the per-frame sub-pixel shimmer that zoompan creates on UI text.
    """
    if Path(dst).exists():
        return str(dst)
    frames = int(dur * FPS)
    OW, OH = W4K * 2, H4K * 2  # 7680x4320 oversample
    # Cosine ease zoom factor expression (uses frame number `n` in crop)
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
    if not run(cmd, f"motion {Path(src).name}"):
        return None
    return str(dst)


def normalize(src_name, dur, dst_name, start=0):
    src = V14 / src_name
    dst = V14 / dst_name
    if dst.exists() and dst.stat().st_size > 100_000:
        return str(dst)
    # Drop tmix (was contributing to the shimmer when combined with unsharp upscale).
    # Render directly at 4K.
    cmd = ["ffmpeg", "-y", "-ss", str(start), "-i", str(src),
           "-t", str(dur),
           "-vf", (f"scale={W4K}:{H4K}:force_original_aspect_ratio=increase:flags=lanczos,"
                   f"crop={W4K}:{H4K},"
                   f"fps={FPS},setsar=1"),
           "-c:v", "libx264", "-preset", "medium", "-crf", "16",
           "-pix_fmt", "yuv420p", "-r", str(FPS), "-an", str(dst)]
    if not run(cmd, f"norm {src_name}"):
        return None
    return str(dst)


def extract_settled_frame(sd_path, dst_path, t=4.5):
    """Extract a still frame from a Seedance clip at time t (where panel is fully revealed)."""
    if Path(dst_path).exists():
        return str(dst_path)
    cmd = ["ffmpeg", "-y", "-ss", str(t), "-i", str(sd_path),
           "-frames:v", "1", "-q:v", "2", str(dst_path)]
    if not run(cmd, f"extract {Path(sd_path).name}"):
        return None
    return str(dst_path)


def overlay_callout(input_clip, overlay_png, output_clip, st, dur):
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", input_clip],
        capture_output=True, text=True)
    clip_dur = float(probe.stdout.strip()) if probe.returncode == 0 else dur
    end = st + dur
    # Scale callout PNG (1920x1080) to 4K so it matches panel resolution natively.
    # This eliminates the 2-step text upscale that was causing shimmer.
    cmd = ["ffmpeg", "-y", "-i", input_clip,
           "-loop", "1", "-t", str(clip_dur), "-i", overlay_png,
           "-filter_complex",
           f"[1:v]scale={W4K}:{H4K}:flags=lanczos,format=rgba,"
           f"fade=in:st={st}:d=0.4:alpha=1,"
           f"fade=out:st={end-0.4}:d=0.4:alpha=1[ov];"
           f"[0:v][ov]overlay=0:0:enable='between(t,{st},{end})'[v]",
           "-map", "[v]", "-c:v", "libx264", "-preset", "medium", "-crf", "16",
           "-pix_fmt", "yuv420p", "-r", str(FPS), "-t", str(clip_dur), "-an",
           output_clip]
    return run(cmd, f"overlay {Path(overlay_png).name}")


# ============================================================
# Panels (all 10 with callouts)
# ============================================================
PANELS = [
    # (idx, dur, sd_clip, fallback_still, callout_png, narration_id)
    # Reverting to NB Pro 3D-treated panels (gold rim glass slabs in dark void) for premium feel.
    # The lifted grade pass brightens panel content for readability without losing the cinematic look.
    # Texts swapped: Overview shot shows A/B PLAYER callout, A/B shot shows OVERVIEW callout.
    (1,  3.0, None,  "nb-1.png",         "v15-co-abplayer.png",   "p1"),
    (2,  2.5, None,  "nb-2.png",         "v15-co-overview.png",   "p2"),
    (3,  3.0, None,  "nb-3.png",         "v15-co-signature.png",  "p3"),
    (11, 3.5, None,  "nb-engineer.png",  "v15-co-engineer.png",   "p11"),
    (4,  3.5, None,  "nb-4.png",         "v15-co-soundcheck.png", "p4"),
    (5,  2.5, None,  "nb-5.png",         "v15-co-spectrum.png",   "p5"),
    (6,  3.5, None,  "nb-6.png",         "v15-co-rtmprofile.png", "p6"),
    (7,  2.5, None,  "nb-7.png",         "v15-co-eqpreview.png",  "p7"),
    (13, 3.0, None,  "nb-export.png",    "v15-co-export.png",     "p13"),
    (12, 3.0, None,  "nb-tonal.png",     "v15-co-tonal.png",      "p12"),
    (8,  2.5, None,  "nb-8.png",         "v15-co-breakdown.png",  "p8"),
    (9,  3.0, None,  "nb-9.png",         "v15-co-distortion.png", "p9"),
    (10, 3.5, None,  "nb-10.png",        "v15-co-limiter.png",    "p10"),
]


def xfade_concat(clip_paths, output_path, overlap=0.7):
    """Concat clips with xfade crossfade transitions.
    Each transition removes `overlap` seconds. Result duration = sum(durations) - (n-1)*overlap."""
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
    # Pre-format every input
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
        "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-an",
        output_path,
    ]
    return run(cmd, "xfade concat") and cumulative


def build_panel_clip(idx, dur, sd, fallback, callout):
    """Build a single panel clip with UNIFIED motion (per codex advice).

    Strategy: Extract a settled frame from each Seedance clip (panel fully revealed,
    no camera motion happening) and apply identical zoompan push-in to ALL panels.
    This gives the FabFilter/Ozone move — panel locked, you drift toward it.
    """
    # Step 1: get a "settled" still — either from Seedance settled frame OR fallback NB Pro still
    settled_png = V14 / f"settled-p{idx}.png"
    if sd and (V14 / sd).exists() and (V14 / sd).stat().st_size > 100_000:
        # Extract frame at 4.5s (panel fully revealed, camera settled)
        extract_settled_frame(str(V14 / sd), str(settled_png), t=4.5)
    else:
        # Use NB Pro still directly
        import shutil
        shutil.copy(V14 / fallback, settled_png)

    # Step 2: Eased push-in. Vary zoom amount slightly per panel (codex advice:
    # makes it feel intentional not robotic). Heavier panels (lots of text/data)
    # get smaller push to keep readable; cleaner panels get more zoom.
    zoom_map = {
        # idx: (zs, ze)
        1:  (1.04, 1.07), 2: (1.04, 1.07), 3: (1.04, 1.06),  # text-dense
        11: (1.05, 1.085),                                    # engineer profile
        4:  (1.04, 1.07), 5: (1.04, 1.07), 6: (1.04, 1.06),  # text-dense
        7:  (1.05, 1.08), 13: (1.05, 1.08),                  # cleaner
        12: (1.05, 1.085), 8: (1.04, 1.06),                  # tonal+breakdown text-dense
        9:  (1.04, 1.06), 10: (1.04, 1.06),                  # quality+limiter text-dense
    }
    zs, ze = zoom_map.get(idx, (1.04, 1.07))
    base = make_motion(str(settled_png), str(V14 / f"v151-p{idx}-base.mp4"),
                      dur, zs=zs, ze=ze, xc=0.50, yc=0.50)
    out = V14 / f"v151-p{idx}-final.mp4"
    overlay_callout(base, str(V14 / callout), str(out), st=0.3, dur=dur - 0.6)
    return str(out)


# ============================================================
# Build narration WAV with timing and music duck
# ============================================================
def build_narration_track(timeline, total_dur, out_wav):
    """Concat narration clips at the right times, output single WAV at total_dur length."""
    # timeline = [(narration_id, start_time)] — id maps to oai-{id}.wav
    inputs = []
    filters = []
    for i, (vo_id, st) in enumerate(timeline):
        vo = NAR / f"{NAR_PREFIX}{vo_id}.wav"
        if not vo.exists():
            print(f"missing {vo}")
            continue
        inputs += ["-i", str(vo)]
        delay_ms = int(st * 1000)
        # Force stereo for ducking compatibility
        filters.append(f"[{i}:a]aresample=44100,aformat=channel_layouts=stereo,adelay={delay_ms}|{delay_ms}[v{i}]")
    if not filters:
        return False
    n = len(filters)
    mix_inputs = "".join(f"[v{i}]" for i in range(n))
    full_filter = (";".join(filters) +
                  f";{mix_inputs}amix=inputs={n}:duration=longest:dropout_transition=0:normalize=0,"
                  f"apad,atrim=0:{total_dur},aresample=44100[a]")
    cmd = ["ffmpeg", "-y"] + inputs + [
        "-filter_complex", full_filter,
        "-map", "[a]",
        "-c:a", "pcm_s16le",
        out_wav,
    ]
    return run(cmd, "narration mix")


# ============================================================
# Build the master 90s with audio ducking
# ============================================================
def build_90s():
    """Now actually builds 59s — shorter brand + faster pacing per user request."""
    print("\n=== Building v15.1 master (59s, faster pace) ===")

    # Brand reveal — 2.5s (compressed from 4s, beats IG autoswipe cliff)
    make_motion(str(V14 / "v15-brand.png"), str(V14 / "v151-brand.mp4"),
                dur=2.5, zs=1.00, ze=1.04)
    # Manifesto slide — "Respect the Mix." power line, 3.5s
    make_motion(str(V14 / "v15-manifesto.png"), str(V14 / "v151-manifesto.mp4"),
                dur=3.5, zs=1.00, ze=1.05)
    # CTA — RTMcompare / Almost here / @rtmaudio, 5s
    make_motion(str(V14 / "v15-cta.png"), str(V14 / "v151-cta.mp4"),
                dur=5.0, zs=1.00, ze=1.05)

    # Build all 10 panels with callouts
    panel_outs = []
    for cfg in PANELS:
        out = build_panel_clip(*cfg[:5])
        panel_outs.append(out)
        print(f"  ✓ p{cfg[0]} ({cfg[1]}s)")

    # Normalize Kling transitions — 2s each (was 3s) for faster pacing
    kl1 = normalize("kl-1.mp4", 2.0, "v151-kl1.mp4", start=0.5)
    kl2 = normalize("kl-2.mp4", 2.0, "v151-kl2.mp4", start=0.5)
    kl3 = normalize("kl-3.mp4", 2.0, "v151-kl3.mp4", start=0.5)

    # Timeline — Overview FIRST, A/B Player SECOND
    # panel_outs order matches PANELS: [p_overview, p_abplayer, p_mastering, p_engineer,
    #                                    p_streaming, p_spectrum, p_eqmatch, p_eqpreview,
    #                                    p_export, p_tonal, p_breakdown, p_quality, p_limiter]
    timeline = [
        str(V14 / "v151-brand.mp4"),         # brand reveal
        panel_outs[0],                       # Overview (FIRST)
        kl1,                                 # kling1
        panel_outs[1],                       # A/B Player (SECOND)
        panel_outs[2],                       # Mastering Delta
        panel_outs[3],                       # Engineer Profile
        panel_outs[4],                       # Streaming Preview (+1s)
        panel_outs[5],                       # Frequency Spectrum
        kl2,                                 # kling2
        panel_outs[6],                       # EQ Match
        panel_outs[7],                       # EQ Preview
        panel_outs[8],                       # Export EQ
        panel_outs[9],                       # Tonal Issues
        panel_outs[10],                      # Per-Element
        panel_outs[11],                      # Quality Control
        kl3,                                 # kling3
        panel_outs[12],                      # Confidence Check
        str(V14 / "v151-manifesto.mp4"),     # manifesto
        str(V14 / "v151-cta.mp4"),           # CTA
    ]

    # XFADE chain (smooth transitions between every clip — fixes stuttering)
    base = V14 / "v151-base-90.mp4"
    final_dur = xfade_concat(timeline, str(base), overlap=0.3)
    if not final_dur: return False
    print(f"  xfade total duration: {final_dur:.2f}s")

    # Build narration track — narration timing aligned to panel starts
    # Codex-refined narration timing (90s variant). Voice files are oai-{id}_90.wav
    narration_timing = [
        ("brand_90", 5.0),   # leaves intro music 0-5s, VO 5-7.5s, drum drop at 11s
        ("p1_90", 12.0),     # p1 starts at 11s
        ("p2_90", 21.0),     # p2 at 20s
        ("p3_90", 26.0),     # p3 at 25s
        ("p4_90", 31.0),
        ("p5_90", 36.0),
        ("p6_90", 44.0),     # after kling2 at 40-43
        ("p7_90", 49.0),
        ("p8_90", 54.0),
        ("p9_90", 59.0),
        ("p10_90", 69.0),    # after kling3 at 65-68
        ("cta_90", 79.0),    # cta starts at 78s
    ]
    voice_track = V14 / "v151-voice-90.wav"
    build_narration_track(narration_timing, 90.0, str(voice_track))

    # Music starts at user-specified 0:36 of song. Final pass adds unified grade
    # + film grain + persistent @rtmaudio watermark (bottom-right, ~30% opacity)
    out_90 = OUT_DIR / "RTMcompare-v15.1-59s.mp4"
    audio_off = AUDIO_OFFSET
    music_dur = max(final_dur, 1.0)
    fade_out_st = max(0, music_dur - 1.5)
    # SHARPER MASTER: upscale 1080→4K with lanczos + unsharp filter, lower CRF for higher quality
    # Watermark scales 2x to keep proportional position
    # Pipeline now runs at 4K natively — no upscale needed in grade.
    # Drop unsharp (was amplifying sub-pixel motion to visible shimmer).
    # Drop noise grain (compounds with motion to create flicker).
    # LIFTED grade: panels now read clearly. Was crushing blacks too hard (0.25→0.18).
    # New curve LIFTS shadows + midtones + highlights so panel content reads cleanly:
    #   0.20→0.28 (lift shadows = readable UI text)
    #   0.50→0.62 (lift midtones = brighter panels)
    #   0.75→0.88 (boost highlights = punchy gold)
    # Saturation up to 1.05 (gold elements pop more).
    # Slight gamma lift via eq for overall brightness.
    grade = (
        "curves=master='0/0 0.20/0.28 0.50/0.62 0.75/0.88 1/1',"
        "colorbalance=rs=.02:gs=-.01:bs=-.04:rm=.04:gm=.01:bm=-.06:rh=.05:bh=-.02,"
        "eq=saturation=1.05:gamma=1.08:brightness=0.03"
    )
    cmd = [
        "ffmpeg", "-y", "-i", str(base),
        "-ss", str(audio_off), "-t", str(music_dur), "-i", AUDIO,
        "-loop", "1", "-t", str(music_dur), "-i", str(V14 / "v15-watermark.png"),
        "-filter_complex",
        f"[0:v]{grade}[graded];"
        f"[2:v]scale={W4K}:{H4K}:flags=lanczos[wm];"
        f"[graded][wm]overlay=0:0[v];"
        f"[1:a]aresample=44100,aformat=channel_layouts=stereo,volume=1.0,"
        f"afade=t=in:st=0:d=0.3,afade=t=out:st={fade_out_st:.2f}:d=1.5[a]",
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-c:a", "aac", "-b:a", "256k",
        "-t", str(music_dur), "-shortest",
        str(out_90),
    ]
    if not run(cmd, "final 90"):
        return False
    print(f"\n✓ {out_90.name} ({os.path.getsize(out_90)/1e6:.1f} MB)")
    return out_90, panel_outs, [kl1, kl2, kl3]


# ============================================================
# Aspect ratio conversions: FILL THE FRAME
# ============================================================
def to_aspect_fill(src_path, aspect, out_path, brand_top_png=None, brand_bottom_png=None):
    """
    1:1: scale to fit height + center-crop horizontally (lose void on sides)
    9:16: panel center + persistent branding ribbons (RTMcompare top, @rtmaudio bottom)
    """
    if aspect == "1:1":
        # Source is 4K (3840x2160). Center-crop to 2160x2160 (keep height, lose horizontal void).
        vf = "[0:v]crop=ih:ih:(iw-ih)/2:0,setsar=1[v]"
        cmd = ["ffmpeg", "-y", "-i", src_path,
               "-filter_complex", vf,
               "-map", "[v]", "-map", "0:a",
               "-c:v", "libx264", "-preset", "slow", "-crf", "18",
               "-pix_fmt", "yuv420p", "-r", str(FPS),
               "-c:a", "copy",
               out_path]
        return run(cmd, "1:1 fill")

    elif aspect == "9:16":
        # 1080x1920 with panel center + branding ribbons top/bottom.
        # 1) Pre-render persistent branding bars
        # 2) Compose: panel scaled to 1080 width centered vertically, brand top, cta bottom
        # Use overlay branding from PNGs (already created if available, else generate)
        if not brand_top_png or not Path(brand_top_png).exists():
            # Quick generate
            from PIL import Image, ImageDraw, ImageFont, ImageFilter
            FONTS_DIR = "/Users/ohadnissim/Claude/Compare/Compare App/release/v5.0.5/fonts"
            top = Image.new("RGBA", (1080, 600), (0, 0, 0, 0))
            d = ImageDraw.Draw(top)
            font = ImageFont.truetype(f"{FONTS_DIR}/InstrumentSerif-Italic.ttf", 84)
            small_font = ImageFont.truetype(f"{FONTS_DIR}/InstrumentSerif-Regular.ttf", 28)
            text = "RTMcompare"
            bb = d.textbbox((0, 0), text, font=font)
            tw = bb[2] - bb[0]
            x = (1080 - tw) // 2 - bb[0]
            d.text((x+2, 350), text, font=font, fill=(0,0,0,200))
            d.text((x, 348), text, font=font, fill=(230, 200, 130, 255))
            label = "RTM Audio"
            bb = d.textbbox((0, 0), label, font=small_font)
            tw = bb[2] - bb[0]
            d.text(((1080 - tw)//2, 460), label, font=small_font, fill=(245, 240, 225, 200))
            top.save("/tmp/v151-brand-top.png")
            brand_top_png = "/tmp/v151-brand-top.png"

            bot = Image.new("RGBA", (1080, 600), (0, 0, 0, 0))
            d = ImageDraw.Draw(bot)
            cta_text = "@rtmaudio"
            font2 = ImageFont.truetype(f"{FONTS_DIR}/InstrumentSerif-Italic.ttf", 60)
            bb = d.textbbox((0, 0), cta_text, font=font2)
            tw = bb[2] - bb[0]
            d.text(((1080 - tw)//2 + 2, 132), cta_text, font=font2, fill=(0,0,0,200))
            d.text(((1080 - tw)//2, 130), cta_text, font=font2, fill=(230, 200, 130, 255))
            sub = "Coming soon"
            bb = d.textbbox((0, 0), sub, font=small_font)
            tw = bb[2] - bb[0]
            d.text(((1080 - tw)//2, 220), sub, font=small_font, fill=(245, 240, 225, 200))
            bot.save("/tmp/v151-brand-bot.png")
            brand_bottom_png = "/tmp/v151-brand-bot.png"

        # 9:16 IG Story FULL-FRAME fill: scale 16:9 source to fit HEIGHT (3840),
        # then center-crop horizontally to 2160. Panel content (centered) stays intact;
        # outer void edges are cropped. No more black branding bars — full screen panel.
        # Watermark still visible bottom-right via the master pipeline.
        vf = (
            f"[0:v]scale=-2:3840:flags=lanczos,crop=2160:3840:(iw-2160)/2:0,setsar=1[v]"
        )
        cmd = ["ffmpeg", "-y", "-i", src_path,
               "-filter_complex", vf,
               "-map", "[v]", "-map", "0:a",
               "-c:v", "libx264", "-preset", "slow", "-crf", "18",
               "-pix_fmt", "yuv420p", "-r", str(FPS),
               "-c:a", "copy",
               "-t", str(probe_dur(src_path)),
               out_path]
        return run(cmd, "9:16 fill")


def probe_dur(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                       "format=duration", "-of",
                       "default=noprint_wrappers=1:nokey=1", path],
                      capture_output=True, text=True)
    return float(r.stdout.strip()) if r.returncode == 0 else 90.0


# ============================================================
# Build shorter cuts (60s, 30s, 15s) — same approach: brand reveal + panels + cta with narration
# ============================================================
def build_shorter(dur, out_path):
    print(f"\n=== Building v15.1 {dur}s ===")
    if dur == 60:
        # Brand 5s + p1 5 + p4 5 + p3 5 + p5 5 + p6 5 + kl 3 + p9 6 + p10 7 + cta 14 = 60
        make_motion(str(V14 / "v15-brand.png"), str(V14 / "v151-brand-5s.mp4"), 5.0, 1.00, 1.08)
        make_motion(str(V14 / "v15-cta.png"), str(V14 / "v151-cta-14s.mp4"), 14.0, 1.00, 1.06)
        # panel clips
        p1 = build_panel_clip(1, 5.0, "sd-1-overview.mp4", "nb-1.png", "v15-co-overview.png")
        p4 = build_panel_clip(4, 5.0, "sd-4-streaming.mp4", "nb-4.png", "v15-co-soundcheck.png")
        p3 = build_panel_clip(3, 5.0, "sd-3-mastering.mp4", "nb-3.png", "v15-co-signature.png")
        p5 = build_panel_clip(5, 5.0, "sd-5-spectrum.mp4", "nb-5.png", "v15-co-spectrum.png")
        p6 = build_panel_clip(6, 5.0, "sd-6-eq-match.mp4", "nb-6.png", "v15-co-rtmprofile.png")
        kl3 = normalize("kl-3.mp4", 3.0, "v151-kl3-3s.mp4", start=0.3)
        p9 = build_panel_clip(9, 6.0, "sd-9-quality.mp4", "nb-9.png", "v15-co-distortion.png")
        p10 = build_panel_clip(10, 7.0, "sd-10-limiter.mp4", "nb-10.png", "v15-co-limiter.png")
        timeline = [str(V14/"v151-brand-5s.mp4"), p1, p4, p3, p5, p6, kl3, p9, p10, str(V14/"v151-cta-14s.mp4")]
        narration = [
            ("brand_60", 0.3),
            ("p1_60", 5.5),  ("p4_60", 10.5), ("p2_60", 15.5),
            ("p6_60", 25.5), ("p10_60", 39.5),
            ("cta_60", 46.5),
        ]
        return _compile(timeline, narration, dur, out_path, AUDIO_OFFSET)

    elif dur == 30:
        # Brand 3s + p4 4 + p9 4 + p10 4 + p5 4 + p1 3 + cta 8 = 30
        make_motion(str(V14 / "v15-brand.png"), str(V14 / "v151-brand-3s.mp4"), 3.0, 1.00, 1.07)
        make_motion(str(V14 / "v15-cta.png"), str(V14 / "v151-cta-8s.mp4"), 8.0, 1.00, 1.06)
        p1 = build_panel_clip(1, 3.0, "sd-1-overview.mp4", "nb-1.png", "v15-co-overview.png")
        p4 = build_panel_clip(4, 4.0, "sd-4-streaming.mp4", "nb-4.png", "v15-co-soundcheck.png")
        p9 = build_panel_clip(9, 4.0, "sd-9-quality.mp4", "nb-9.png", "v15-co-distortion.png")
        p10 = build_panel_clip(10, 4.0, "sd-10-limiter.mp4", "nb-10.png", "v15-co-limiter.png")
        p5 = build_panel_clip(5, 4.0, "sd-5-spectrum.mp4", "nb-5.png", "v15-co-spectrum.png")
        timeline = [str(V14/"v151-brand-3s.mp4"), p4, p9, p10, p5, p1, str(V14/"v151-cta-8s.mp4")]
        narration = [
            ("brand_30", 0.2),
            ("p1_30", 11.4), ("p2_30", 15.4),
            ("p10_30", 19.4),
            ("cta_30", 22.4),
        ]
        return _compile(timeline, narration, dur, out_path, AUDIO_OFFSET + 20)

    elif dur == 15:
        # Brand 2s + p4 4 + p10 4 + cta 5 = 15
        make_motion(str(V14 / "v15-brand.png"), str(V14 / "v151-brand-2s.mp4"), 2.0, 1.00, 1.06)
        make_motion(str(V14 / "v15-cta.png"), str(V14 / "v151-cta-5s.mp4"), 5.0, 1.00, 1.06)
        p4 = build_panel_clip(4, 4.0, "sd-4-streaming.mp4", "nb-4.png", "v15-co-soundcheck.png")
        p10 = build_panel_clip(10, 4.0, "sd-10-limiter.mp4", "nb-10.png", "v15-co-limiter.png")
        timeline = [str(V14/"v151-brand-2s.mp4"), p4, p10, str(V14/"v151-cta-5s.mp4")]
        narration = [
            ("brand_15", 0.2),
            ("p1_15", 2.2),
            ("cta_15", 10.2),
        ]
        return _compile(timeline, narration, dur, out_path, AUDIO_OFFSET + 30)


def _compile(timeline, narration_timing, dur, out_path, audio_offset):
    """xfade-concat clips, mix with music."""
    base = V14 / f"v151-base-{int(dur)}.mp4"
    final_dur = xfade_concat(timeline, str(base), overlap=0.3)
    if not final_dur: return False

    voice = V14 / f"v151-voice-{int(dur)}.wav"
    build_narration_track(narration_timing, dur, str(voice))

    music_dur = max(final_dur, 1.0)
    fade_out = max(0, music_dur - 1.0)
    # Sharper short cuts: same upscale + unsharp + low CRF
    # Pipeline now runs at 4K natively — no upscale needed in grade.
    # Drop unsharp (was amplifying sub-pixel motion to visible shimmer).
    # Drop noise grain (compounds with motion to create flicker).
    # LIFTED grade: panels now read clearly. Was crushing blacks too hard (0.25→0.18).
    # New curve LIFTS shadows + midtones + highlights so panel content reads cleanly:
    #   0.20→0.28 (lift shadows = readable UI text)
    #   0.50→0.62 (lift midtones = brighter panels)
    #   0.75→0.88 (boost highlights = punchy gold)
    # Saturation up to 1.05 (gold elements pop more).
    # Slight gamma lift via eq for overall brightness.
    grade = (
        "curves=master='0/0 0.20/0.28 0.50/0.62 0.75/0.88 1/1',"
        "colorbalance=rs=.02:gs=-.01:bs=-.04:rm=.04:gm=.01:bm=-.06:rh=.05:bh=-.02,"
        "eq=saturation=1.05:gamma=1.08:brightness=0.03"
    )
    cmd = ["ffmpeg", "-y", "-i", str(base),
           "-ss", str(audio_offset), "-t", str(music_dur), "-i", AUDIO,
           "-loop", "1", "-t", str(music_dur), "-i", str(V14 / "v15-watermark.png"),
           "-filter_complex",
           f"[0:v]{grade}[graded];"
           f"[2:v]scale={W4K}:{H4K}:flags=lanczos[wm];"
           f"[graded][wm]overlay=0:0[v];"
           f"[1:a]aresample=44100,aformat=channel_layouts=stereo,volume=1.0,"
           f"afade=t=in:st=0:d=0.3,afade=t=out:st={fade_out:.2f}:d=1.0[a]",
           "-map", "[v]", "-map", "[a]",
           "-c:v", "libx264", "-preset", "slow", "-crf", "18",
           "-pix_fmt", "yuv420p", "-r", str(FPS),
           "-c:a", "aac", "-b:a", "256k",
           "-t", str(music_dur), "-shortest",
           str(out_path)]
    if not run(cmd, f"final {dur}"): return False
    print(f"  ✓ {out_path.name} ({os.path.getsize(out_path)/1e6:.1f} MB)")
    return out_path


def main():
    out_59, _, _ = build_90s()  # Now produces 59s
    out_30 = build_shorter(30, OUT_DIR / "RTMcompare-v15.1-30s.mp4")
    out_15 = build_shorter(15, OUT_DIR / "RTMcompare-v15.1-15s.mp4")

    # Aspect ratio variants — 3 lengths × 2 aspects = 6 + 3 native = 9 total
    print("\n=== Aspect ratio fills ===")
    for src, base in [(out_59, "59s"), (out_30, "30s"), (out_15, "15s")]:
        for aspect, label in [("1:1", "igfeed"), ("9:16", "igstory")]:
            ext = "1x1" if aspect == "1:1" else "9x16"
            out = OUT_DIR / f"RTMcompare-v15.1-{label}-{ext}-{base}.mp4"
            to_aspect_fill(str(src), aspect, str(out))
            print(f"  ✓ {out.name}")

    print("\nALL DELIVERABLES:")
    for f in sorted(OUT_DIR.glob("RTMcompare-v15.1-*.mp4")):
        print(f"  {f.name} ({os.path.getsize(f)/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
