"""
RTM Suite — IG feed square teaser (1080×1080).

Design philosophy: CONSOLE DIDONE — Monocle / Bottega Veneta editorial
restraint + mastering-console hush.  Asymmetric serif block, single-gold
emphasis, meticulous RTM mark anchor, architectural rules as quiet
registration vocabulary.
"""

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

# ── constants ───────────────────────────────────────────────────────
FONT_DIR = Path(
    "/Users/ohadnissim/Library/Application Support/Claude/"
    "local-agent-mode-sessions/skills-plugin/"
    "9b52d7ff-e86f-4067-a72d-b87451f5203e/"
    "ff47e6f2-1a97-4768-a95d-227868d54f9a/skills/canvas-design/canvas-fonts"
)

OUT = Path(__file__).parent / "rtm-teaser.png"

W = H = 1080
BG = (10, 10, 10)           # near-total black — #0a0a0a
CREAM = (235, 231, 224)     # #ebe7e0
GOLD = (208, 176, 102)      # #d0b066
DIM = (100, 94, 83)         # muted sand for micro type — restrained

# ── fonts ───────────────────────────────────────────────────────────
def F(name, sz):
    return ImageFont.truetype(str(FONT_DIR / name), sz)

# Head serif — InstrumentSerif is the modern editorial-magazine choice
# (Type Network / Monocle-adjacent).  Using its italic for ONE accent
# word multiplies drama without adding a second colour.
serif_roman   = F("InstrumentSerif-Regular.ttf", 128)
serif_italic  = F("InstrumentSerif-Italic.ttf",  128)

# Kicker / signature — a narrow sans with wide tracking.  Slightly
# enlarged from v1 to establish a firmer three-tier hierarchy
# (kicker · headline · caption) without becoming a subheadline itself.
sans_kicker   = F("InstrumentSans-Regular.ttf", 20)
sans_caption  = F("InstrumentSans-Regular.ttf", 15)

# Logo lockup — geometric sans display for "RTM" (matches the user's
# reference badge); InstrumentSans caps for "AUDIO" below the rule.
# BigShoulders-Regular (not Bold) reads as refined-industrial instead
# of heavy-industrial — the reference mark is confident, not stocky.
logo_rtm      = F("BigShoulders-Regular.ttf", 64)
logo_audio    = F("InstrumentSans-Regular.ttf", 13)


# ── helpers ─────────────────────────────────────────────────────────
def draw_tracked(draw, xy, text, font, fill, tracking_px):
    """Draw text with manually-inserted letter-spacing (Pillow has no
    native tracking).  Returns the total drawn width so the caller can
    position subsequent elements."""
    x, y = xy
    total = 0
    for i, ch in enumerate(text):
        draw.text((x + total, y), ch, font=font, fill=fill)
        w = draw.textlength(ch, font=font)
        total += w + (tracking_px if i < len(text) - 1 else 0)
    return total


def measure_tracked(draw, text, font, tracking_px):
    total = 0
    for i, ch in enumerate(text):
        total += draw.textlength(ch, font=font)
        if i < len(text) - 1:
            total += tracking_px
    return total


# ── canvas ──────────────────────────────────────────────────────────
img = Image.new("RGB", (W, H), BG)
d   = ImageDraw.Draw(img)

# ── 1. Top-left kicker: "RTM SUITE" tracked small-caps ──────────────
# Micro signature that declares the product without shouting.  Sits on
# the top margin with generous whitespace.  Rule above (not below) the
# kicker — it reads as a masthead bar rather than an underline, which
# matches the editorial-broadsheet vocabulary in the philosophy.
MARGIN_L = 108
MARGIN_T = 108
RULE_WIDTH = 48  # shared rule length — rhyme with footer rule

kicker = "RTM SUITE"
# Masthead rule — 1 px, flush-left at the top margin.
d.rectangle(
    [MARGIN_L, MARGIN_T, MARGIN_L + RULE_WIDTH, MARGIN_T + 1],
    fill=DIM,
)
draw_tracked(
    d,
    (MARGIN_L, MARGIN_T + 14),
    kicker,
    sans_kicker,
    DIM,
    tracking_px=5,
)

# ── 2. Main headline block — 4-line serif stack ─────────────────────
#
#   Hear what
#   Spotify hears.
#   Before Spotify     ← "Before" in gold (single-emphasis rule)
#   hears it.
#
# Left-aligned, asymmetric, generous leading, filling the vertical
# centre band.  Display size chosen so the longest line ("Before
# Spotify") fits inside the 864-px live-area without hyphenation.

headline_x = MARGIN_L
headline_y = 300
leading = 138  # line-to-line step — ~1.08× cap height; tight enough to
               # let the 4-line block read as a single architectural
               # mass, loose enough to breathe between lines

lines = [
    ("Hear what",       None),
    ("Spotify hears.",  None),
    ("Before Spotify",  "Before"),  # "Before" is the gold word
    ("hears it.",       None),
]

for i, (line, gold_word) in enumerate(lines):
    y = headline_y + i * leading

    if gold_word:
        # Split the line at the gold word so the remainder stays cream.
        before, _, after = line.partition(gold_word)
        x = headline_x

        if before:
            d.text((x, y), before, font=serif_roman, fill=CREAM)
            x += d.textlength(before, font=serif_roman)

        d.text((x, y), gold_word, font=serif_roman, fill=GOLD)
        x += d.textlength(gold_word, font=serif_roman)

        if after:
            d.text((x, y), after, font=serif_roman, fill=CREAM)
    else:
        d.text((headline_x, y), line, font=serif_roman, fill=CREAM)


# ── 3. Bottom-right RTM logo mark ───────────────────────────────────
#
#   ┌╴                  ╶┐
#   │                    │
#   │        RTM         │   ← gold serif caps
#   │    ─────◆─────     │   ← thin gold rule with diamond midpoint
#   │       AUDIO        │   ← white tracked caps
#   │                    │
#   └╴                  ╶┘
#
# Recreated from the user's reference image.  Corner ticks + thin 1-px
# outer frame + interior typographic lockup.  Sits at bottom-right as
# signature anchor.

BOX_SIZE = 188
BOX_R = W - MARGIN_L
BOX_B = H - 108
BOX_L = BOX_R - BOX_SIZE
BOX_T = BOX_B - BOX_SIZE

# Outer hairline frame — 1 px, low-chroma gold so it reads as a
# deliberate registration frame rather than a button outline.
FRAME_COLOR = (78, 66, 38)
d.rectangle([BOX_L, BOX_T, BOX_R, BOX_B], outline=FRAME_COLOR, width=1)

# Corner ticks — classic registration-mark vocabulary.  Each corner
# has a short horizontal + vertical gold stroke extending outward from
# the frame.  Four crosses total, placed with the care of a colophon.
TICK_LEN = 12
TICK_OFF = 2    # breathing gap between frame and tick so the cross
                # reads as "+"-shaped rather than continuous with frame.
for (cx, cy, hx_sign, vy_sign) in [
    (BOX_L, BOX_T, -1, -1),
    (BOX_R, BOX_T, +1, -1),
    (BOX_L, BOX_B, -1, +1),
    (BOX_R, BOX_B, +1, +1),
]:
    # outward horizontal stroke
    d.line(
        [
            (cx + hx_sign * TICK_OFF, cy),
            (cx + hx_sign * (TICK_OFF + TICK_LEN), cy),
        ],
        fill=GOLD, width=1,
    )
    # outward vertical stroke
    d.line(
        [
            (cx, cy + vy_sign * TICK_OFF),
            (cx, cy + vy_sign * (TICK_OFF + TICK_LEN)),
        ],
        fill=GOLD, width=1,
    )

# ── interior lockup: RTM / rule + diamond / AUDIO ───────────────────
#
# The three elements are laid out as a vertical stack, optically
# balanced inside the box (optical, not geometric centre — the rule
# should sit a touch above the box's mid-line so "RTM" feels seated
# rather than floating).
cx = (BOX_L + BOX_R) / 2

# 1. RTM — gold caps, centred above the rule.  Position by cap-height
#    rather than font metric so the visual baseline is precise.
rtm_txt = "RTM"
rtm_bbox = d.textbbox((0, 0), rtm_txt, font=logo_rtm)
rtm_w = rtm_bbox[2] - rtm_bbox[0]
rtm_h = rtm_bbox[3] - rtm_bbox[1]
rule_y = BOX_T + BOX_SIZE / 2 + 2       # slight drop below centre
rtm_y  = rule_y - 22 - rtm_h - rtm_bbox[1]
d.text(
    (cx - rtm_w / 2 - rtm_bbox[0], rtm_y),
    rtm_txt, font=logo_rtm, fill=GOLD,
)

# 2. Rule with diamond — thin gold line bisected by a rotated square.
#    Rule spans nearly the full interior width (leaves ~22 px margin
#    each side) and cleanly flanks the diamond with equal gaps.
RULE_INSET = 22
rule_l = BOX_L + RULE_INSET
rule_r = BOX_R - RULE_INSET
diamond_half = 4
rule_gap = 9     # gap each side of the diamond

d.line(
    [(rule_l, rule_y), (cx - diamond_half - rule_gap, rule_y)],
    fill=GOLD, width=1,
)
d.line(
    [(cx + diamond_half + rule_gap, rule_y), (rule_r, rule_y)],
    fill=GOLD, width=1,
)
d.polygon(
    [
        (cx, rule_y - diamond_half),
        (cx + diamond_half, rule_y),
        (cx, rule_y + diamond_half),
        (cx - diamond_half, rule_y),
    ],
    fill=GOLD,
)

# 3. AUDIO — cream, tracked caps, centred below the rule.  Tracking
#    pulled a touch tighter than kicker tracking so the word reads as
#    a unit rather than four loose letters.
audio_txt = "AUDIO"
audio_tracking = 3
audio_w = measure_tracked(d, audio_txt, logo_audio, audio_tracking)
audio_y = rule_y + 18
draw_tracked(
    d,
    (cx - audio_w / 2, audio_y),
    audio_txt,
    logo_audio,
    CREAM,
    tracking_px=audio_tracking,
)

# ── 4. Bottom-left caption — whisper-quiet engineer signal ──────────
# Single short phrase, tracked small caps, anchored at the bottom
# margin aligned with the headline's x-axis.  Acts as a colophon, not
# a subheadline.  Rule above the caption, identical length to the
# masthead rule at the top-left — the two rules rhyme across the
# composition and implicitly frame the headline block.
footer = "ENGINEER · QC · DELIVERY"
FOOTER_Y = H - 132
d.rectangle(
    [MARGIN_L, FOOTER_Y - 14, MARGIN_L + RULE_WIDTH, FOOTER_Y - 13],
    fill=DIM,
)
draw_tracked(d, (MARGIN_L, FOOTER_Y), footer, sans_caption, DIM, tracking_px=3)

# ── save ────────────────────────────────────────────────────────────
img.save(OUT, "PNG", optimize=True)
print(f"Wrote {OUT}  {img.size}")
