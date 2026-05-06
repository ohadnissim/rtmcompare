#!/usr/bin/env python3
"""Console Didone 15-second reel — RTMcompare commercial.

Zero AI generation. Pure procedural typography rendered with PIL using
the bundled Instrument Serif TTF, plus a real screenshot from the app
for the product moment. Stitched to MP4 via ffmpeg.

Output: promo/RTMcompare-Reel-15s.mp4 (1080×1920, 30fps, 15s).

Audio: scored separately by Ohad. This master cut has no audio track.

Storyboard:
  0–2s   Title card  : "RTMaudio presents — RTMcompare"
  2–4s   Hook        : "You're going to miss something."
  4–6s   Catch #1    : Mix engineer — mix vs demo
  6–8s   Catch #2    : Mastering engineer — master vs mix
  8–10s  Catch #3    : Producer — demo vs mix
  10–12s Product     : Real EQ-recommendations panel screenshot
  12–15s Close       : RTMcompare · Coming Soon · @rtmaudio (3s — drives the CTA)

Run:  python3 promo/generate_reel.py
"""

from __future__ import annotations
import os, sys, subprocess, shutil, math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# ── Paths ──────────────────────────────────────────────────────────
HERE = Path(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = HERE.parent
FONT_DIR = REPO_ROOT / 'release' / 'v5.2.4' / 'fonts'
SCREENSHOT_DIR = REPO_ROOT / 'website-screenshots'
TMP_DIR = HERE / '.reel-frames'
OUT_PATH = HERE / 'RTMcompare-Reel-15s.mp4'

# ── Canvas + timing ────────────────────────────────────────────────
W, H = 1080, 1920
FPS = 30
DURATION = 15
TOTAL_FRAMES = FPS * DURATION

# ── Console Didone palette (RGBA) ─────────────────────────────────
INK            = (14,  13,  11,  255)
CREAM          = (235, 231, 224, 255)
SAND_SECONDARY = (214, 209, 198, 255)
SAND_MUTED     = (141, 134, 123, 255)
SAND_DIM       = (106, 100,  89, 255)
GOLD           = (208, 176, 102, 255)

# ── Fonts ──────────────────────────────────────────────────────────
SERIF_PATH        = FONT_DIR / 'InstrumentSerif-Regular.ttf'
SERIF_ITALIC_PATH = FONT_DIR / 'InstrumentSerif-Italic.ttf'
SANS_PATH         = FONT_DIR / 'InstrumentSans-Regular.ttf'

def font(path: Path, size: int):
    return ImageFont.truetype(str(path), size)

# ── Easing ─────────────────────────────────────────────────────────
def ease_in_out(t: float) -> float:
    """Cubic ease-in-out, t ∈ [0, 1] → [0, 1]."""
    return 3*t*t - 2*t*t*t if t < 1 else 1.0

def fade_alpha(local_frame: int, total_frames: int, fade_frames: int = 9) -> float:
    """Fade-in over fade_frames, hold, fade-out over fade_frames."""
    if local_frame < fade_frames:
        return ease_in_out(local_frame / fade_frames)
    if local_frame > total_frames - fade_frames:
        out_t = (total_frames - local_frame) / fade_frames
        return ease_in_out(max(0.0, out_t))
    return 1.0

def apply_alpha(rgba: tuple, alpha: float) -> tuple:
    return (rgba[0], rgba[1], rgba[2], int(rgba[3] * alpha))

# ── Drawing primitives ────────────────────────────────────────────
def fill_bg(img: Image.Image):
    ImageDraw.Draw(img).rectangle((0, 0, W, H), fill=INK)

def text_centered(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont,
                  y: int, fill: tuple):
    """Draw text centred horizontally at y."""
    bbox = draw.textbbox((0, 0), text, font=fnt)
    w = bbox[2] - bbox[0]
    draw.text(((W - w) // 2 - bbox[0], y), text, fill=fill, font=fnt)

def text_centered_two_color(draw: ImageDraw.ImageDraw, parts: list,
                            fnt: ImageFont.FreeTypeFont, y: int, alpha: float):
    """Draw a line composed of (text, color) parts, centred.
    Allows one mid-line gold accent."""
    # measure total width
    total_w = 0
    measured = []
    for text, col in parts:
        bbox = draw.textbbox((0, 0), text, font=fnt)
        w = bbox[2] - bbox[0]
        measured.append((text, col, w, bbox[0]))
        total_w += w
    cursor_x = (W - total_w) // 2
    for text, col, w, lead in measured:
        col_a = apply_alpha(col, alpha)
        draw.text((cursor_x - lead, y), text, fill=col_a, font=fnt)
        cursor_x += w

def gold_diamond(draw: ImageDraw.ImageDraw, cx: int, cy: int, size: int, alpha: float):
    pts = [(cx, cy - size), (cx + size, cy), (cx, cy + size), (cx - size, cy)]
    draw.polygon(pts, fill=apply_alpha(GOLD, alpha))

def corner_ticks(draw: ImageDraw.ImageDraw, alpha: float = 0.35,
                 inset: int = 70, length: int = 50, weight: int = 2):
    col = (SAND_DIM[0], SAND_DIM[1], SAND_DIM[2], int(255 * alpha))
    # top-left
    draw.rectangle((inset, inset, inset + length, inset + weight), fill=col)
    draw.rectangle((inset, inset, inset + weight, inset + length), fill=col)
    # top-right
    draw.rectangle((W - inset - length, inset, W - inset, inset + weight), fill=col)
    draw.rectangle((W - inset - weight, inset, W - inset, inset + length), fill=col)
    # bottom-left
    draw.rectangle((inset, H - inset - weight, inset + length, H - inset), fill=col)
    draw.rectangle((inset, H - inset - length, inset + weight, H - inset), fill=col)
    # bottom-right
    draw.rectangle((W - inset - length, H - inset - weight, W - inset, H - inset), fill=col)
    draw.rectangle((W - inset - weight, H - inset - length, W - inset, H - inset), fill=col)

# ── Segment renderers ─────────────────────────────────────────────
def render_hook(local_f: int, total_f: int) -> Image.Image:
    """2–4s: 'You're going to miss something.' — italic Didone hook."""
    img = Image.new('RGBA', (W, H), INK)
    draw = ImageDraw.Draw(img)
    a = fade_alpha(local_f, total_f, fade_frames=10)
    corner_ticks(draw, alpha=0.30 * a)
    fnt = font(SERIF_ITALIC_PATH, 110)
    text_centered(draw, "You're going to", fnt, H // 2 - 130, apply_alpha(SAND_SECONDARY, a))
    text_centered(draw, "miss something.", fnt, H // 2 + 0,   apply_alpha(CREAM, a))
    return img


def render_title_card(local_f: int, total_f: int) -> Image.Image:
    """0–2s: 'RTMaudio presents — RTMcompare' — film-opener title card.

    Tracked-caps eyebrow on top, big Didone wordmark below, gold
    diamond on a tick rule between them.  Same vocabulary as the
    cover-page treatment from the empty state."""
    img = Image.new('RGBA', (W, H), INK)
    draw = ImageDraw.Draw(img)
    a = fade_alpha(local_f, total_f, fade_frames=12)
    corner_ticks(draw, alpha=0.40 * a)

    # Eyebrow — RTMAUDIO PRESENTS, tracked-caps
    fnt_eyebrow = font(SANS_PATH, 32)
    eyebrow = 'RTMAUDIO PRESENTS'
    chars = list(eyebrow)
    char_widths = []
    for ch in chars:
        b = draw.textbbox((0, 0), ch, font=fnt_eyebrow)
        char_widths.append(b[2] - b[0])
    tracking = 0.22
    advance = fnt_eyebrow.size * tracking
    total_w = sum(char_widths) + advance * (len(chars) - 1)
    cursor = (W - total_w) // 2
    eb_y = H // 2 - 320
    for ch, cw in zip(chars, char_widths):
        draw.text((cursor, eb_y), ch, fill=apply_alpha(SAND_MUTED, a), font=fnt_eyebrow)
        cursor += cw + advance

    # Tick rule with gold diamond between eyebrow and wordmark
    rule_y = H // 2 - 230
    rule_w = 480
    rule_x_start = (W - rule_w) // 2
    rule_mid = W // 2
    rule_col = (CREAM[0], CREAM[1], CREAM[2], int(255 * 0.80 * a))
    draw.rectangle((rule_x_start, rule_y, rule_mid - 14, rule_y + 2), fill=rule_col)
    draw.rectangle((rule_mid + 14, rule_y, rule_x_start + rule_w, rule_y + 2), fill=rule_col)
    gold_diamond(draw, rule_mid, rule_y + 1, 9, a)

    # Wordmark — RTMcompare, large Instrument Serif cream
    fnt_wm = font(SERIF_PATH, 168)
    text_centered(draw, 'RTMcompare', fnt_wm, H // 2 - 80, apply_alpha(CREAM, a))
    return img

def render_catch(local_f: int, total_f: int, lines: list) -> Image.Image:
    """A catch frame — italic Didone, last line accent in gold.

    `lines` is a list of (text, color) tuples — one per line, centred."""
    img = Image.new('RGBA', (W, H), INK)
    draw = ImageDraw.Draw(img)
    a = fade_alpha(local_f, total_f, fade_frames=9)
    corner_ticks(draw, alpha=0.30 * a)

    fnt = font(SERIF_ITALIC_PATH, 92)
    line_height = 130
    n_lines = len(lines)
    block_h = (n_lines - 1) * line_height
    y_start = (H - block_h) // 2 - 50
    for i, line in enumerate(lines):
        if isinstance(line, str):
            text_centered(draw, line, fnt, y_start + i * line_height,
                          apply_alpha(CREAM, a))
        elif isinstance(line, tuple):
            text, col = line
            text_centered(draw, text, fnt, y_start + i * line_height,
                          apply_alpha(col, a))
        elif isinstance(line, list):
            text_centered_two_color(draw, line, fnt,
                                    y_start + i * line_height, a)
    return img

def render_product_moment(local_f: int, total_f: int) -> Image.Image:
    """10–12s: real EQ-recommendations screenshot, vertical crop."""
    img = Image.new('RGBA', (W, H), INK)
    a = fade_alpha(local_f, total_f, fade_frames=9)

    # Load the recommendations screenshot
    src = Image.open(SCREENSHOT_DIR / '08-eq-match.png').convert('RGBA')
    # The recommendations panel sits in the centre. Crop a vertical slice
    # showing the title + first 4-5 recommendation rows.
    sw, sh = src.size  # 3200 × 1890
    # Estimated bounds of the recommendations panel (centre column, full vertical)
    crop_x0 = int(sw * 0.18)
    crop_x1 = int(sw * 0.82)
    crop_y0 = int(sh * 0.12)
    crop_y1 = int(sh * 0.92)
    cropped = src.crop((crop_x0, crop_y0, crop_x1, crop_y1))
    # Scale to fit width with ink top/bottom letterbox
    cw, ch = cropped.size
    target_w = int(W * 0.92)
    scale = target_w / cw
    target_h = int(ch * scale)
    cropped = cropped.resize((target_w, target_h), Image.LANCZOS)
    # Composite centered with alpha fade
    if a < 1.0:
        # darken for fade
        overlay = Image.new('RGBA', cropped.size, (*INK[:3], int(255 * (1 - a))))
        cropped = Image.alpha_composite(cropped, overlay)
    paste_x = (W - target_w) // 2
    paste_y = (H - target_h) // 2 - 80
    img.paste(cropped, (paste_x, paste_y), cropped)

    # Caption overlay below
    draw = ImageDraw.Draw(img)
    fnt_tag = font(SANS_PATH, 28)
    draw.text((W // 2 - 320, paste_y + target_h + 60),
              'WHAT THE APP LISTS BACK',
              fill=apply_alpha(SAND_MUTED, a), font=fnt_tag)
    return img

def render_pivot(local_f: int, total_f: int) -> Image.Image:
    """12–13s: 'Catch it before they do.' — italic Didone."""
    img = Image.new('RGBA', (W, H), INK)
    draw = ImageDraw.Draw(img)
    a = fade_alpha(local_f, total_f, fade_frames=6)
    corner_ticks(draw, alpha=0.30 * a)
    fnt = font(SERIF_ITALIC_PATH, 110)
    text_centered(draw, "Catch it before",     fnt, H // 2 - 130, apply_alpha(SAND_SECONDARY, a))
    text_centered(draw, "they do.",            fnt, H // 2 + 0,   apply_alpha(CREAM, a))
    return img

def render_close(local_f: int, total_f: int) -> Image.Image:
    """12–15s: RTMcompare wordmark + tick rule + 'Coming Soon' italic +
    @rtmaudio handle. The CTA-driving close."""
    img = Image.new('RGBA', (W, H), INK)
    draw = ImageDraw.Draw(img)
    a = fade_alpha(local_f, total_f, fade_frames=15)
    corner_ticks(draw, alpha=0.40 * a)

    # Wordmark in Instrument Serif — slightly smaller than title card so
    # the close doesn't compete with the opener visually
    fnt_wm = font(SERIF_PATH, 144)
    text_centered(draw, 'RTMcompare', fnt_wm, H // 2 - 240, apply_alpha(CREAM, a))

    # Tick rule with gold diamond beneath
    rule_y = H // 2 - 80
    rule_w = 460
    rule_x_start = (W - rule_w) // 2
    rule_mid = W // 2
    rule_col = (CREAM[0], CREAM[1], CREAM[2], int(255 * 0.85 * a))
    draw.rectangle((rule_x_start, rule_y, rule_mid - 14, rule_y + 2), fill=rule_col)
    draw.rectangle((rule_mid + 14, rule_y, rule_x_start + rule_w, rule_y + 2), fill=rule_col)
    gold_diamond(draw, rule_mid, rule_y + 1, 9, a)

    # "Coming Soon" — italic Didone, the CTA
    fnt_cta = font(SERIF_ITALIC_PATH, 72)
    text_centered(draw, 'Coming Soon', fnt_cta, H // 2 + 0,
                  apply_alpha(SAND_SECONDARY, a))

    # @rtmaudio handle — tracked-caps small below
    fnt_handle = font(SANS_PATH, 32)
    handle = '@RTMAUDIO'
    chars = list(handle)
    char_widths = []
    for ch in chars:
        b = draw.textbbox((0, 0), ch, font=fnt_handle)
        char_widths.append(b[2] - b[0])
    tracking = 0.20
    advance = fnt_handle.size * tracking
    total_w = sum(char_widths) + advance * (len(chars) - 1)
    cursor = (W - total_w) // 2
    handle_y = H // 2 + 160
    for ch, cw in zip(chars, char_widths):
        draw.text((cursor, handle_y), ch,
                  fill=apply_alpha(GOLD, a), font=fnt_handle)
        cursor += cw + advance

    # Platform strip — tracked-caps at the bottom
    fnt_plat = font(SANS_PATH, 24)
    plat = 'macOS · WINDOWS · LOCAL-FIRST'
    chars = list(plat.upper())
    char_widths = []
    for ch in chars:
        b = draw.textbbox((0, 0), ch, font=fnt_plat)
        char_widths.append(b[2] - b[0])
    tracking = 0.18
    advance = fnt_plat.size * tracking
    total_w = sum(char_widths) + advance * (len(chars) - 1)
    cursor = (W - total_w) // 2
    for ch, cw in zip(chars, char_widths):
        draw.text((cursor, H // 2 + 280), ch,
                  fill=apply_alpha(SAND_MUTED, a), font=fnt_plat)
        cursor += cw + advance
    return img

# ── Frame dispatcher ──────────────────────────────────────────────
def frame_at(global_f: int) -> Image.Image:
    """Return the frame for the given absolute frame index."""
    sec = global_f / FPS

    # Title card · 0–2s
    if sec < 2:
        return render_title_card(global_f, FPS * 2)

    # Hook · 2–4s
    if sec < 4:
        local = global_f - FPS * 2
        return render_hook(local, FPS * 2)

    # Catch 1 — Mix engineer (mix vs demo) · 4–6s
    if sec < 6:
        local = global_f - FPS * 4
        return render_catch(local, FPS * 2, [
            "Demo had a tighter low-mid.",
            "This revision adds",
            [('+2.1 dB at 250 Hz.', GOLD)],
        ])

    # Catch 2 — Mastering engineer (master vs mix) · 6–8s
    if sec < 8:
        local = global_f - FPS * 6
        return render_catch(local, FPS * 2, [
            "Master added",
            [('+1.2 dB at 8 kHz', GOLD)],
            "that wasn't in the mix.",
        ])

    # Catch 3 — Producer (demo vs mix) · 8–10s
    if sec < 10:
        local = global_f - FPS * 8
        return render_catch(local, FPS * 2, [
            "Demo had the drums up.",
            "Mix has them buried",
            [('by 2 dB.', GOLD)],
        ])

    # Product moment · 10–12s
    if sec < 12:
        local = global_f - FPS * 10
        return render_product_moment(local, FPS * 2)

    # Close · 12–15s (3 seconds — drives the CTA)
    local = global_f - FPS * 12
    return render_close(local, FPS * 3)

# ── Main render ───────────────────────────────────────────────────
def main():
    if TMP_DIR.exists():
        shutil.rmtree(TMP_DIR)
    TMP_DIR.mkdir(parents=True)

    print(f'Rendering {TOTAL_FRAMES} frames at {W}×{H} / {FPS}fps...')
    for f in range(TOTAL_FRAMES):
        img = frame_at(f).convert('RGB')
        img.save(TMP_DIR / f'frame_{f:04d}.png', 'PNG')
        if f % 30 == 0:
            sec = f / FPS
            print(f'  {sec:5.1f}s  ({f+1}/{TOTAL_FRAMES})')

    print(f'\nStitching to MP4 via ffmpeg...')
    cmd = [
        'ffmpeg', '-y',
        '-framerate', str(FPS),
        '-i', str(TMP_DIR / 'frame_%04d.png'),
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-crf', '17',                # near-lossless
        '-preset', 'slow',
        '-movflags', '+faststart',
        str(OUT_PATH),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    # Cleanup
    shutil.rmtree(TMP_DIR)

    out_mb = OUT_PATH.stat().st_size / (1024 * 1024)
    print(f'\n  → {OUT_PATH.relative_to(REPO_ROOT)}  ({out_mb:.1f} MB, {DURATION}s, {W}×{H})')


if __name__ == '__main__':
    main()
