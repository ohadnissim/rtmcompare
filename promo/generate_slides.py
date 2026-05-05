#!/usr/bin/env python3
"""Generate Instagram Story slides for RTM promo."""

from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1080, 1920
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# Colors
BG = (20, 19, 19)
BG_CARD = (30, 29, 28)
TERRA = (224, 122, 79)
SAGE = (110, 197, 119)
BLUE = (107, 140, 187)
CREAM = (245, 245, 244)
MID = (168, 162, 158)
DIM = (87, 83, 78)
RED = (224, 90, 90)
PURPLE = (168, 85, 247)

def get_font(size, bold=False):
    """Try to load Inter or Helvetica."""
    paths = [
        '/System/Library/Fonts/HelveticaNeue.ttc',
        '/System/Library/Fonts/Helvetica.ttc',
        '/System/Library/Fonts/SFPro.ttf',
    ]
    for p in paths:
        try:
            return ImageFont.truetype(p, size, index=1 if bold else 0)
        except:
            try:
                return ImageFont.truetype(p, size)
            except:
                continue
    return ImageFont.load_default()

def rounded_rect(draw, xy, radius, fill=None, outline=None, width=1):
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)

def draw_metric_box(draw, x, y, w, h, label, value, color=TERRA):
    rounded_rect(draw, (x, y, x+w, y+h), 16, fill=(48, 44, 39))
    font_sm = get_font(22)
    font_lg = get_font(36, bold=True)
    # Label
    bbox = draw.textbbox((0, 0), label, font=font_sm)
    tw = bbox[2] - bbox[0]
    draw.text((x + (w - tw) // 2, y + 18), label, fill=DIM, font=font_sm)
    # Value
    bbox = draw.textbbox((0, 0), value, font=font_lg)
    tw = bbox[2] - bbox[0]
    draw.text((x + (w - tw) // 2, y + 50), value, fill=color, font=font_lg)

def draw_category_card(draw, x, y, w, h, icon, name, diff, insight, color):
    rounded_rect(draw, (x, y, x+w, y+h), 14, fill=color + (25,))
    font = get_font(24, bold=True)
    font_sm = get_font(18)
    font_xs = get_font(16)

    # Icon + name
    draw.text((x + 16, y + 14), icon, fill=color, font=font)
    draw.text((x + 46, y + 14), name, fill=CREAM, font=font)

    # Diff badge
    diff_text = f"{diff}" if diff.startswith('=') else f"{diff} dB"
    badge_color = SAGE if diff.startswith('=') else (TERRA if diff.startswith('+') else BLUE)
    draw.text((x + w - 90, y + 16), diff_text, fill=badge_color, font=font_sm)

    # Insight
    draw.text((x + 16, y + 50), insight[:50], fill=MID, font=font_xs)

def draw_bar(draw, x, y, w, h, pct, color, bg=(48, 44, 39)):
    rounded_rect(draw, (x, y, x+w, y+h), h//2, fill=bg)
    bar_w = max(4, int(w * pct))
    rounded_rect(draw, (x, y, x+bar_w, y+h), h//2, fill=color)


# ─── SLIDE 1: What is RTM ─────────────────────────────────────────────────────
def slide_1():
    img = Image.new('RGB', (W, H), BG)
    draw = ImageDraw.Draw(img)

    # RTM logo
    font_logo = get_font(120, bold=True)
    font_sub = get_font(28)
    font_desc = get_font(24)

    # Center content
    cy = H // 2 - 100

    # Logo
    bbox = draw.textbbox((0, 0), "RTM", font=font_logo)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) // 2, cy), "RTM", fill=TERRA, font=font_logo)

    # Subtitle
    text = "COMPARE"
    bbox = draw.textbbox((0, 0), text, font=font_sub)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) // 2, cy + 140), text, fill=DIM, font=font_sub)

    # Description
    lines = [
        "The audio comparison tool",
        "for mixing & mastering engineers.",
        "",
        "Drop two files. See what changed.",
        "Level-matched. AI-powered.",
    ]
    y = cy + 240
    for line in lines:
        if line == "":
            y += 20
            continue
        bbox = draw.textbbox((0, 0), line, font=font_desc)
        tw = bbox[2] - bbox[0]
        draw.text(((W - tw) // 2, y), line, fill=MID, font=font_desc)
        y += 40

    # Bottom tag
    font_tag = get_font(18)
    tag = "Available now for macOS"
    bbox = draw.textbbox((0, 0), tag, font=font_tag)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) // 2, H - 120), tag, fill=DIM, font=font_tag)

    img.save(os.path.join(OUT_DIR, 'slide_1_what_is_rtm.png'))
    print("Slide 1 saved")


# ─── SLIDE 2: Overview & Level Matching ────────────────────────────────────────
def slide_2():
    img = Image.new('RGB', (W, H), BG)
    draw = ImageDraw.Draw(img)

    font_title = get_font(42, bold=True)
    font_sub = get_font(22)
    font_sm = get_font(18)

    y = 100
    draw.text((60, y), "Level-Matched Comparison", fill=CREAM, font=font_title)
    y += 60
    draw.text((60, y), "Compares balance, not volume", fill=MID, font=font_sub)

    # Level match badge
    y += 80
    rounded_rect(draw, (100, y, W-100, y+50), 25, fill=(110, 197, 119, 20), outline=SAGE)
    badge_text = "Level-matched (6.4 dB applied)"
    bbox = draw.textbbox((0, 0), badge_text, font=font_sm)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) // 2, y + 14), badge_text, fill=SAGE, font=font_sm)

    # Metric boxes
    y += 100
    bw = 220
    gap = 30
    start_x = (W - (4 * bw + 3 * gap)) // 2
    metrics = [
        ("LOUDNESS", "+6.4 dB"),
        ("WIDTH", "Wider"),
        ("DYNAMICS", "Compressed"),
        ("TRUE PEAK", "-0.2 dBTP"),
    ]
    for i, (label, value) in enumerate(metrics):
        draw_metric_box(draw, start_x + i * (bw + gap), y, bw, 95, label, value)

    # Insights
    y += 150
    insights = [
        "File B is 6.4 dB louder overall",
        "Analysis is level-matched — differences reflect balance",
        "File B has a wider stereo image",
        "Traded some dynamic range for density",
        "Biggest changes: vocals, sub, instruments",
    ]
    for line in insights:
        draw.text((80, y), f"  {line}", fill=MID, font=font_sm)
        y += 35

    # Waveform mockup
    y += 40
    draw.text((60, y), "Waveform Comparison", fill=CREAM, font=get_font(28, bold=True))
    y += 50
    rounded_rect(draw, (60, y, W-60, y+140), 12, fill=BG_CARD)
    # Draw some waveform bars
    import random
    random.seed(42)
    for i in range(120):
        h_a = random.randint(5, 60)
        h_b = random.randint(5, 70)
        x = 70 + i * 7.5
        # File A (blue)
        draw.rectangle((x, y+70-h_a, x+3, y+70+h_a), fill=BLUE + (100,))
        # File B (terra)
        draw.rectangle((x+3, y+70-h_b, x+6, y+70+h_b), fill=TERRA + (80,))

    # Legend
    y += 160
    draw.rectangle((80, y+4, 100, y+12), fill=BLUE)
    draw.text((110, y), "Reference", fill=MID, font=font_sm)
    draw.rectangle((250, y+4, 270, y+12), fill=TERRA)
    draw.text((280, y), "Compare", fill=MID, font=font_sm)

    # Bottom
    y += 60
    draw.text((60, y), "Loudness Over Time", fill=CREAM, font=get_font(28, bold=True))
    y += 50
    rounded_rect(draw, (60, y, W-60, y+200), 12, fill=BG_CARD)
    # Draw loudness curves
    import math
    for i in range(200):
        x = 70 + i * 4.5
        v_a = -14 + 3 * math.sin(i * 0.05) + 1.5 * math.sin(i * 0.12)
        v_b = -11 + 2.5 * math.sin(i * 0.05 + 0.3) + 1.2 * math.sin(i * 0.12)
        ya = y + 100 - int((v_a + 20) * 8)
        yb = y + 100 - int((v_b + 20) * 8)
        if i > 0:
            draw.line((prev_xa, prev_ya, x, ya), fill=BLUE + (150,), width=2)
            draw.line((prev_xb, prev_yb, x, yb), fill=TERRA + (200,), width=2)
        prev_xa, prev_ya = x, ya
        prev_xb, prev_yb = x, yb

    img.save(os.path.join(OUT_DIR, 'slide_2_overview.png'))
    print("Slide 2 saved")


# ─── SLIDE 3: Per-Element Breakdown ───────────────────────────────────────────
def slide_3():
    img = Image.new('RGB', (W, H), BG)
    draw = ImageDraw.Draw(img)

    font_title = get_font(42, bold=True)
    font_sub = get_font(22)

    y = 100
    draw.text((60, y), "10-Category Breakdown", fill=CREAM, font=font_title)
    y += 60
    draw.text((60, y), "Every element analyzed individually", fill=MID, font=font_sub)

    y += 80
    categories = [
        ("⬤", "Kick", "-2.2", "Quieter — sits more in background", RED),
        ("◎", "Snare", "+2.0", "More prominent — crispier snap", TERRA),
        ("〰", "Sub", "-2.6", "Less sub energy", PURPLE),
        ("♪", "Bass", "-0.3", "Similar — tighter, more controlled", BLUE),
        ("🎤", "Vocals", "+3.5", "More upfront and present", TERRA),
        ("🎹", "Instruments", "+2.4", "Louder — wider stereo spread", SAGE),
        ("☀", "Brightness", "+2.4", "Noticeably brighter", (234, 179, 8)),
        ("✦", "Air", "-0.7", "Slightly rolled off on top", (6, 182, 212)),
        ("↔", "Wideness", "+0.0", "A bit more stereo width", PURPLE),
        ("⚡", "Punch", "+0.2", "Similar — more compressed", RED),
    ]

    card_w = (W - 140) // 2
    card_h = 80
    gap = 12

    for i, (icon, name, diff, insight, color) in enumerate(categories):
        col = i % 2
        row = i // 2
        cx = 60 + col * (card_w + 20)
        cy = y + row * (card_h + gap)
        draw_category_card(draw, cx, cy, card_w, card_h, icon, name, diff, insight, color)

    # Tonal issues section
    y += 5 * (card_h + gap) + 40
    draw.text((60, y), "Tonal Issues Detected", fill=CREAM, font=get_font(28, bold=True))
    y += 50

    issues = [
        ("Muddiness", "+2.3 dB", "200-500 Hz — instruments blend together"),
        ("Boxiness", "+3.9 dB", "300-700 Hz — honky, nasal quality"),
        ("Harshness", "+2.1 dB", "2-5 kHz — ear-fatiguing presence"),
    ]

    font_issue = get_font(22, bold=True)
    font_detail = get_font(16)

    for name, diff, desc in issues:
        rounded_rect(draw, (60, y, W-60, y+70), 10, fill=(224, 122, 79, 15))
        draw.line((60, y, 60, y+70), fill=TERRA, width=3)
        draw.text((80, y + 10), name, fill=CREAM, font=font_issue)
        draw.text((80, y + 38), desc, fill=MID, font=font_detail)
        draw.text((W - 160, y + 12), diff, fill=TERRA, font=font_issue)
        y += 85

    img.save(os.path.join(OUT_DIR, 'slide_3_breakdown.png'))
    print("Slide 3 saved")


# ─── SLIDE 4: A/B Player & Stems ─────────────────────────────────────────────
def slide_4():
    img = Image.new('RGB', (W, H), BG)
    draw = ImageDraw.Draw(img)

    font_title = get_font(42, bold=True)
    font_sub = get_font(22)
    font_sm = get_font(18)
    font_key = get_font(16)

    y = 100
    draw.text((60, y), "A/B Player", fill=CREAM, font=font_title)
    y += 60
    draw.text((60, y), "Instant switching, level-matched", fill=MID, font=font_sub)

    # Player mockup
    y += 80
    rounded_rect(draw, (40, y, W-40, y+580), 20, fill=BG_CARD, outline=(51, 48, 44))

    # Tabs
    ty = y + 20
    rounded_rect(draw, (60, ty, 200, ty+40), 8, fill=(51, 48, 44))
    draw.text((80, ty + 8), "Full Mix", fill=DIM, font=font_sm)
    rounded_rect(draw, (210, ty, 330, ty+40), 8, fill=(224, 122, 79, 40))
    draw.text((230, ty + 8), "Stems", fill=TERRA, font=font_sm)

    # Stem buttons
    ty += 55
    stems = [("Drums", RED), ("Bass", BLUE), ("Vocals", TERRA), ("Other", PURPLE)]
    sx = 60
    for name, color in stems:
        sw = 130
        rounded_rect(draw, (sx, ty, sx+sw, ty+38), 8, fill=color + (40,))
        draw.text((sx + 15, ty + 8), name, fill=color, font=font_sm)
        sx += sw + 12

    # A/B buttons
    ty += 60
    rounded_rect(draw, (60, ty, W//2-10, ty+50), 10, fill=(107, 140, 187, 50), outline=BLUE)
    draw.text((100, ty + 12), "A — Demo", fill=BLUE, font=font_sub)

    # Flip button
    rounded_rect(draw, (W//2-5, ty+5, W//2+45, ty+45), 8, fill=(224, 122, 79, 30), outline=TERRA)
    draw.text((W//2+10, ty+12), "↕", fill=TERRA, font=font_sub)

    rounded_rect(draw, (W//2+55, ty, W-60, ty+50), 10, fill=(51, 48, 44))
    draw.text((W//2+95, ty + 12), "B — Mix", fill=DIM, font=font_sub)

    # Waveform
    ty += 75
    rounded_rect(draw, (60, ty, W-60, ty+100), 10, fill=(30, 29, 28))
    import random
    random.seed(123)
    for i in range(110):
        h = random.randint(3, 45)
        x = 70 + i * 8.3
        pct = i / 110
        opacity = 220 if pct < 0.4 else 60
        draw.rectangle((x, ty+50-h, x+5, ty+50+h), fill=TERRA + (opacity,))
    # Playhead
    draw.line((70 + int(0.4 * 110 * 8.3), ty, 70 + int(0.4 * 110 * 8.3), ty+100), fill=(255,255,255), width=2)

    # Transport
    ty += 115
    # Play button
    draw.ellipse((60, ty, 105, ty+45), fill=(51, 48, 44))
    draw.polygon([(78, ty+10), (78, ty+35), (98, ty+22)], fill=(255,255,255))

    # Loop button
    draw.ellipse((115, ty+3, 155, ty+43), fill=(224, 122, 79, 40))
    draw.text((125, ty+10), "↻", fill=TERRA, font=font_sub)

    # Mono button
    rounded_rect(draw, (165, ty+3, 235, ty+43), 20, fill=(51, 48, 44))
    draw.text((175, ty+10), "MONO", fill=DIM, font=font_key)

    draw.text((250, ty+12), "1:09 / 2:43", fill=DIM, font=font_sm)

    # Loop badge
    ty += 55
    rounded_rect(draw, (60, ty, 350, ty+30), 15, fill=(224, 122, 79, 30))
    draw.text((80, ty + 5), "Loop: 0:45 — 1:12", fill=TERRA, font=font_sm)

    # Keyboard shortcuts
    ty += 50
    shortcuts = "Space play · A B switch · ← → scrub · M mono · L loop"
    draw.text((60, ty), shortcuts, fill=DIM, font=font_key)

    # Features list
    ty += 80
    features = [
        "Instant A/B switching mid-playback",
        "Loop any section by dragging",
        "Mono check for phone compatibility",
        "Solo individual AI-separated stems",
        "Level-matched — fair comparison every time",
    ]
    for feat in features:
        draw.text((80, ty), f"→  {feat}", fill=MID, font=font_sm)
        ty += 35

    img.save(os.path.join(OUT_DIR, 'slide_4_ab_player.png'))
    print("Slide 4 saved")


# ─── SLIDE 5: Spectrum & Stereo ──────────────────────────────────────────────
def slide_5():
    img = Image.new('RGB', (W, H), BG)
    draw = ImageDraw.Draw(img)

    font_title = get_font(42, bold=True)
    font_sub = get_font(22)
    font_sm = get_font(18)

    y = 100
    draw.text((60, y), "Spectrum & Stereo", fill=CREAM, font=font_title)
    y += 60
    draw.text((60, y), "See exactly where the EQ changed", fill=MID, font=font_sub)

    # Spectrum mockup
    y += 80
    rounded_rect(draw, (40, y, W-40, y+350), 16, fill=BG_CARD, outline=(51, 48, 44))

    # Tabs
    ty = y + 15
    for i, (name, active) in enumerate([("Stereo", True), ("Mid", False), ("Side", False)]):
        tx = 60 + i * 140
        if active:
            rounded_rect(draw, (tx, ty, tx+120, ty+35), 8, fill=(224, 122, 79, 30))
            draw.text((tx+20, ty+7), name, fill=TERRA, font=font_sm)
        else:
            draw.text((tx+20, ty+7), name, fill=DIM, font=font_sm)

    # Spectrum curves
    import math
    graph_y = y + 65
    graph_h = 220
    for i in range(200):
        x = 60 + i * 4.5
        # File A curve (blue)
        va = graph_h * 0.7 - (graph_h * 0.5 * math.exp(-((i-40)**2)/800) + graph_h * 0.15 * math.sin(i*0.05))
        # File B curve (terra) — brighter
        vb = va - 15 + (i/200) * 30
        ya = graph_y + int(va)
        yb = graph_y + int(vb)
        if i > 0:
            draw.line((prev_xa, prev_ya, x, ya), fill=BLUE + (150,), width=2)
            draw.line((prev_xb, prev_yb, x, yb), fill=TERRA + (200,), width=2)
        prev_xa, prev_ya = x, ya
        prev_xb, prev_yb = x, yb

    # Freq labels
    freqs = ["20", "80", "200", "500", "1k", "2k", "5k", "10k", "20k"]
    for i, f in enumerate(freqs):
        x = 60 + int(i / (len(freqs)-1) * 900)
        draw.text((x, y + 300), f, fill=DIM, font=get_font(14))

    # Diff badges
    y += 365
    badges = ["+3.0 dB @ 6.3k", "+3.0 dB @ 10k", "+2.5 dB @ 12.5k"]
    bx = 60
    for badge in badges:
        rounded_rect(draw, (bx, y, bx+180, y+30), 15, fill=(52, 211, 153, 25))
        draw.text((bx+12, y+5), badge, fill=SAGE, font=font_sm)
        bx += 200

    # Mono compatibility
    y += 70
    draw.text((60, y), "Mono Compatibility", fill=CREAM, font=get_font(28, bold=True))
    y += 50
    rounded_rect(draw, (60, y, W-60, y+120), 12, fill=BG_CARD)

    # Reference
    draw.text((80, y+15), "Reference", fill=BLUE, font=font_sm)
    draw.text((300, y+15), "Excellent", fill=SAGE, font=get_font(20, bold=True))
    draw_bar(draw, 80, y+45, 400, 12, 0.92, BLUE)
    draw.text((500, y+42), "Corr: 0.92 · Loss: 4.2%", fill=DIM, font=get_font(14))

    # Compare
    draw.text((80, y+70), "Compare", fill=TERRA, font=font_sm)
    draw.text((300, y+70), "Acceptable", fill=TERRA, font=get_font(20, bold=True))
    draw_bar(draw, 80, y+98, 400, 12, 0.78, TERRA)
    draw.text((500, y+95), "Corr: 0.78 · Loss: 12.8%", fill=DIM, font=get_font(14))

    # Phase + Vectorscope mention
    y += 160
    features = [
        "Stereo / Mid / Side spectrum views",
        "Phase correlation over time",
        "Stereo vectorscope",
        "Mono compatibility check",
        "Streaming platform targets (Spotify, Apple, etc.)",
    ]
    for feat in features:
        draw.text((80, y), f"→  {feat}", fill=MID, font=font_sm)
        y += 35

    img.save(os.path.join(OUT_DIR, 'slide_5_spectrum.png'))
    print("Slide 5 saved")


# ─── SLIDE 6: Reference Analysis & Key ───────────────────────────────────────
def slide_6():
    img = Image.new('RGB', (W, H), BG)
    draw = ImageDraw.Draw(img)

    font_title = get_font(42, bold=True)
    font_sub = get_font(22)
    font_sm = get_font(18)
    font_lg = get_font(60, bold=True)

    y = 100
    draw.text((60, y), "Reference Analysis", fill=CREAM, font=font_title)
    y += 60
    draw.text((60, y), "Know your starting point", fill=MID, font=font_sub)

    # Song info boxes
    y += 80
    bw = 150
    gap = 20
    sx = (W - (6*bw + 5*gap)) // 2
    info = [
        ("BPM", "128.0", CREAM),
        ("KEY", "A minor", CREAM),
        ("LUFS", "-18.3", CREAM),
        ("DR", "16.0 dB", CREAM),
        ("STEREO", "0.88", CREAM),
        ("CLIPS", "None", SAGE),
    ]
    for i, (label, val, color) in enumerate(info):
        x = sx + i * (bw + gap)
        rounded_rect(draw, (x, y, x+bw, y+85), 10, fill=(48, 44, 39))
        font_label = get_font(14)
        bbox = draw.textbbox((0, 0), label, font=font_label)
        tw = bbox[2] - bbox[0]
        draw.text((x + (bw-tw)//2, y+12), label, fill=DIM, font=font_label)
        font_val = get_font(22, bold=True)
        bbox = draw.textbbox((0, 0), val, font=font_val)
        tw = bbox[2] - bbox[0]
        draw.text((x + (bw-tw)//2, y+40), val, fill=color, font=font_val)

    # Tonal character
    y += 120
    draw.text((60, y), "Tonal Character", fill=CREAM, font=get_font(28, bold=True))
    draw.text((400, y+5), "Dark and warm", fill=TERRA, font=font_sm)

    # Harman curve mockup
    y += 50
    rounded_rect(draw, (40, y, W-40, y+250), 12, fill=BG_CARD)

    import math
    for i in range(200):
        x = 60 + i * 4.5
        # Neutral (green dashed)
        vn = 125 - 20 * math.exp(-((i-30)**2)/400) + (i/200) * 40
        # Measured (terra)
        vm = vn - 30 + 40 * math.exp(-((i-25)**2)/300) + (i/200) * 50
        yn = y + int(vn)
        ym = y + int(vm)
        if i > 0 and i % 3 == 0:
            draw.line((prev_xn, prev_yn, x, yn), fill=SAGE + (100,), width=1)
        if i > 0:
            draw.line((prev_xm, prev_ym, x, ym), fill=TERRA + (200,), width=2)
        prev_xn, prev_yn = x, yn
        prev_xm, prev_ym = x, ym

    # Key frequencies
    y += 290
    draw.text((60, y), "Key Frequencies — A minor", fill=CREAM, font=get_font(28, bold=True))
    y += 50

    # Frequency ruler
    rounded_rect(draw, (40, y, W-40, y+80), 12, fill=BG_CARD)

    # Harmonic markers
    import math
    harmonics = [55, 110, 220, 440, 880, 1320, 1760, 2200, 3520, 7040]
    labels = ["-3oct", "-2oct", "-1oct", "ROOT", "+1oct", "3x", "+2oct", "5x", "+3oct", "+4oct"]
    colors_h = [BLUE, BLUE, BLUE, TERRA, BLUE, SAGE, BLUE, SAGE, BLUE, BLUE]

    for freq, label, color in zip(harmonics, labels, colors_h):
        log_pos = (math.log10(freq) - math.log10(20)) / (math.log10(20000) - math.log10(20))
        x = 50 + int(log_pos * (W - 100))
        is_root = "ROOT" in label
        h = 60 if is_root else 40 if "oct" in label else 25
        w = 3 if is_root else 2
        draw.rectangle((x, y+40-h//2, x+w, y+40+h//2), fill=color + (200 if is_root else 120,))
        if is_root or "oct" in label:
            f_text = f"{freq}" if freq < 1000 else f"{freq/1000:.1f}k"
            draw.text((x-10, y+2), f_text, fill=color, font=get_font(11))

    # Harmonic pills
    y += 100
    hx = 60
    for freq, label in zip(harmonics, labels):
        f_text = f"{freq}" if freq < 1000 else f"{freq/1000:.1f}k"
        is_root = "ROOT" in label
        color = TERRA if is_root else BLUE if "oct" in label else SAGE
        text = f"{f_text} Hz {label}"
        rounded_rect(draw, (hx, y, hx+120, y+28), 6, fill=color + (30,))
        draw.text((hx+8, y+4), text, fill=color, font=get_font(13))
        hx += 130
        if hx > W - 150:
            hx = 60
            y += 36

    # Bottom features
    y += 70
    features = [
        "BPM & key detection",
        "Harman-inspired tonal curve",
        "All harmonics mapped",
        "Analyze reference before you start mixing",
    ]
    for feat in features:
        draw.text((80, y), f"→  {feat}", fill=MID, font=font_sm)
        y += 35

    img.save(os.path.join(OUT_DIR, 'slide_6_reference.png'))
    print("Slide 6 saved")


# Generate all slides
if __name__ == '__main__':
    os.makedirs(OUT_DIR, exist_ok=True)
    slide_1()
    slide_2()
    slide_3()
    slide_4()
    slide_5()
    slide_6()
    print(f"\nAll slides saved to {OUT_DIR}")
