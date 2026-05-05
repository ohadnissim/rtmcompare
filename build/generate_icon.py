#!/usr/bin/env python3
"""
Generate the premium app icon for RTM Suite.

Design language — Bottega Veneta quiet-luxury:
  • Deep warm-black rounded-square tile (obsidian + subtle gold vignette)
  • Minimal gold sigil — two audio waveforms meeting at a central node,
    suggesting A-vs-B comparison. Now wrapped in a thin concentric
    outer arc + chapter marks at 12 / 3 / 6 / 9 — the "suite" motif,
    implying multiple tools orbiting the core compare engine.
  • Inner bevel + soft highlight at top edge for "physical" feel.
  • No logotype — pure sigil, reads at 16×16 through 1024×1024.
"""

import math
import os
from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
RADIUS = int(SIZE * 0.22)   # rounded-square corner radius — iOS-style but slightly tighter

GOLD = (208, 176, 102, 255)        # #d0b066 primary accent
GOLD_DIM = (168, 141, 69, 255)     # deeper gold
WARM_BLACK = (22, 20, 17, 255)     # #161411
DEEP_BLACK = (11, 10, 8, 255)      # #0b0a08
HIGHLIGHT = (45, 40, 32, 255)      # warm highlight at top edge


def rounded_square_mask(size, radius):
    """Return an alpha mask (L-mode image) for a rounded square."""
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return m


def radial_gradient(size, inner_color, outer_color, center=None, radius=None):
    """Create a radial gradient by sampling distance from center."""
    if center is None:
        center = (size // 2, size // 2)
    if radius is None:
        radius = size * 0.6
    img = Image.new('RGBA', (size, size), outer_color)
    px = img.load()
    cx, cy = center
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - cx, y - cy)
            t = min(1.0, d / radius)
            # ease-out curve
            t = t * t
            r = int(inner_color[0] * (1 - t) + outer_color[0] * t)
            g = int(inner_color[1] * (1 - t) + outer_color[1] * t)
            b = int(inner_color[2] * (1 - t) + outer_color[2] * t)
            a = int(inner_color[3] * (1 - t) + outer_color[3] * t)
            px[x, y] = (r, g, b, a)
    return img


def linear_gradient_vertical(size, top_color, bottom_color):
    img = Image.new('RGBA', (size, size))
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        r = int(top_color[0] * (1 - t) + bottom_color[0] * t)
        g = int(top_color[1] * (1 - t) + bottom_color[1] * t)
        b = int(top_color[2] * (1 - t) + bottom_color[2] * t)
        a = int(top_color[3] * (1 - t) + bottom_color[3] * t)
        for x in range(size):
            px[x, y] = (r, g, b, a)
    return img


def generate_icon(size=1024):
    """Build the RTM icon at `size` pixels."""
    s = size

    # Base layer: warm vertical gradient
    base = linear_gradient_vertical(s, HIGHLIGHT, DEEP_BLACK)

    # Radial vignette from a slightly above-center gold source — gives the
    # illusion of a soft spotlight, core luxury design trick.
    vignette = radial_gradient(
        s,
        inner_color=(55, 44, 25, 255),   # warm glow
        outer_color=(0, 0, 0, 0),
        center=(s // 2, int(s * 0.42)),
        radius=s * 0.7,
    )
    base = Image.alpha_composite(base, vignette)

    # ── Sigil: two opposing waveforms meeting at a center dot ──
    sigil = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(sigil)

    # Waveform parameters
    cx = s / 2
    cy = s / 2
    sigil_w = s * 0.58             # total horizontal reach
    amp = s * 0.17                 # vertical amplitude
    stroke = max(4, int(s * 0.013))

    left_start = cx - sigil_w / 2
    right_end = cx + sigil_w / 2

    # Two mirrored half-waveforms
    def half_wave(x_start, x_end, direction, color):
        """direction: +1 for wave going up, -1 for down."""
        points = []
        steps = 220
        for i in range(steps + 1):
            t = i / steps
            x = x_start + t * (x_end - x_start)
            # Damped oscillation that decays toward the center
            env = 1 - t if x_end > x_start else t
            # 3 bumps with decreasing amplitude as we approach center
            phase = t * math.pi * 3.5
            y = cy + direction * amp * env * math.sin(phase)
            points.append((x, y))
        # Draw as a smooth polyline using small circles to approximate stroke
        for i in range(len(points) - 1):
            d.line([points[i], points[i + 1]], fill=color, width=stroke)

    # Upper wave (lead side, gold) — from left toward center
    half_wave(left_start, cx, -1, GOLD)
    # Lower wave (echo side, dimmer gold) — from center to right
    half_wave(cx, right_end, 1, GOLD_DIM)

    # Center node — a solid gold dot with a thin ring
    node_r = s * 0.035
    ring_r = s * 0.058
    d.ellipse((cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r),
              outline=GOLD, width=max(2, stroke // 2))
    d.ellipse((cx - node_r, cy - node_r, cx + node_r, cy + node_r),
              fill=GOLD)

    # ── Suite motif ── very thin concentric outer arc encircling the
    # sigil — hints at the multiple tools in the Suite without competing
    # with the core comparison mark. Broken at 12/6 o'clock so the arc
    # feels incomplete (a stamp, not a ring). Chapter-mark notches at
    # 3 and 9 o'clock.
    suite_r = s * 0.365
    suite_stroke = max(2, int(s * 0.0045))
    # Upper arc — from 200° to 340° (sweep across the top)
    d.arc((cx - suite_r, cy - suite_r, cx + suite_r, cy + suite_r),
          start=200, end=340, fill=(208, 176, 102, 170), width=suite_stroke)
    # Lower arc — from 20° to 160°
    d.arc((cx - suite_r, cy - suite_r, cx + suite_r, cy + suite_r),
          start=20, end=160, fill=(168, 141, 69, 140), width=suite_stroke)
    # Chapter notches at 3 o'clock and 9 o'clock
    notch_len = s * 0.018
    d.line([(cx - suite_r - notch_len, cy), (cx - suite_r + notch_len, cy)],
           fill=GOLD, width=suite_stroke)
    d.line([(cx + suite_r - notch_len, cy), (cx + suite_r + notch_len, cy)],
           fill=GOLD, width=suite_stroke)

    # Subtle glow on the node
    glow = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((cx - node_r * 4, cy - node_r * 4, cx + node_r * 4, cy + node_r * 4),
               fill=(208, 176, 102, 70))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=s * 0.03))
    base = Image.alpha_composite(base, glow)
    base = Image.alpha_composite(base, sigil)

    # Top-edge inner highlight — a thin warm ring inside the rounded rect
    # that gives the card the feel of rising toward the light.
    highlight = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    hd = ImageDraw.Draw(highlight)
    inset = int(s * 0.015)
    hd.rounded_rectangle(
        (inset, inset, s - 1 - inset, s - 1 - inset),
        radius=RADIUS - inset,
        outline=(255, 220, 170, 60),
        width=max(1, int(s * 0.004)),
    )
    # Only keep the top-half highlight (fade the bottom)
    mask = linear_gradient_vertical(s, (255, 255, 255, 255), (0, 0, 0, 0))
    highlight.putalpha(Image.eval(highlight.split()[3], lambda v: v).point(lambda x: x))  # no-op
    base = Image.alpha_composite(base, highlight)

    # Bottom shadow — gives the card weight
    shadow = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rectangle((0, int(s * 0.72), s, s), fill=(0, 0, 0, 60))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=s * 0.04))
    base = Image.alpha_composite(base, shadow)

    # Apply rounded-square mask for the final shape
    mask = rounded_square_mask(s, RADIUS)
    final = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    final.paste(base, (0, 0), mask)

    return final


def make_iconset(source, outdir):
    """Generate an .iconset directory with all the sizes macOS wants."""
    sizes = [
        (16, 1), (16, 2),
        (32, 1), (32, 2),
        (128, 1), (128, 2),
        (256, 1), (256, 2),
        (512, 1), (512, 2),
    ]
    os.makedirs(outdir, exist_ok=True)
    for base, scale in sizes:
        px = base * scale
        suffix = '' if scale == 1 else '@2x'
        img = source.resize((px, px), Image.LANCZOS)
        img.save(os.path.join(outdir, f'icon_{base}x{base}{suffix}.png'))


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    icon = generate_icon(1024)
    png_path = os.path.join(here, 'icon.png')
    icon.save(png_path)
    print(f'Wrote {png_path}')

    iconset_dir = os.path.join(here, 'icon.iconset')
    # Clean existing
    if os.path.isdir(iconset_dir):
        for f in os.listdir(iconset_dir):
            os.remove(os.path.join(iconset_dir, f))
    make_iconset(icon, iconset_dir)
    print(f'Wrote iconset to {iconset_dir}')
    print('Next: run `iconutil -c icns build/icon.iconset -o build/icon.icns`')
