#!/usr/bin/env python3
"""Console Didone pitch deck — Instagram Story slides for RTM.

5.2.4 rewrite: aligned with .rtm-design/philosophy.md and the v5.2
shell aesthetic. Replaces the v4 deck (orange/sage/blue/red/purple
palette, rounded-2xl cards, centred-stack heroes) with:
  - ink + cream + sand-secondary + sand-muted + ONE gold gesture
  - Instrument Serif for hero numerals and the wordmark
  - Outfit (or system sans) for body
  - sharp 2px corners, asymmetric layouts, generous space

Run: python3 promo/generate_slides.py
Outputs slide_1…slide_6 PNGs into the same directory.
"""

from PIL import Image, ImageDraw, ImageFont
import os
import glob

# ── Canvas ──────────────────────────────────────────────────────────
W, H = 1080, 1920  # Instagram Story
OUT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(OUT_DIR)

# ── Console Didone palette ─────────────────────────────────────────
# Hex values mirror src/styles.css @theme tokens. Keep this list
# canonical; never introduce a colour outside it.
INK             = (14,  13,  11)   # --color-bg-app · sand-950
PANEL           = (30,  28,  24)   # sand-700 ish
CREAM           = (235, 231, 224)  # --color-text-primary · sand-100
SAND_SECONDARY  = (214, 209, 198)  # --color-text-secondary · sand-200
SAND_MUTED      = (141, 134, 123)  # --color-text-muted · sand-400
SAND_DIM        = (87,  83,  78)   # --color-text-dim · sand-500
GOLD            = (208, 176, 102)  # --color-accent · terra
WARM_RED        = (201, 103, 101)  # --color-violation · warm-red

# ── Fonts ───────────────────────────────────────────────────────────
# Try Instrument Serif locally (shipped with releases under
# release/v5.2.4/fonts/), then fall back through Georgia and the
# default. Outfit isn't bundled here, so body falls through to
# HelveticaNeue / system sans.
def _candidate_paths(filenames):
    candidates = []
    for fname in filenames:
        candidates += glob.glob(os.path.join(REPO_ROOT, 'release', '*', 'fonts', fname))
    candidates += [
        '/System/Library/Fonts/Supplemental/Georgia.ttf',
        '/System/Library/Fonts/HelveticaNeue.ttc',
        '/System/Library/Fonts/Helvetica.ttc',
    ]
    return candidates


def serif(size):
    """Instrument Serif Regular → Georgia → default."""
    for p in _candidate_paths(['InstrumentSerif-Regular.ttf']):
        try:
            return ImageFont.truetype(p, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def serif_italic(size):
    """Instrument Serif Italic → Georgia Italic → default."""
    for p in _candidate_paths(['InstrumentSerif-Italic.ttf', 'Georgia Italic.ttf']):
        try:
            return ImageFont.truetype(p, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def sans(size):
    """System sans, regular weight."""
    paths = [
        '/System/Library/Fonts/HelveticaNeue.ttc',
        '/System/Library/Fonts/Helvetica.ttc',
    ]
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def mono(size):
    """JetBrains Mono → Menlo → default."""
    paths = [
        '/System/Library/Fonts/Menlo.ttc',
        '/System/Library/Fonts/SFMono-Regular.otf',
    ]
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


# ── Drawing primitives ─────────────────────────────────────────────
def text_w(draw, txt, font):
    """Measured width for centring."""
    bbox = draw.textbbox((0, 0), txt, font=font)
    return bbox[2] - bbox[0]


def tracked_caps(draw, x, y, txt, font, fill, tracking_em=0.16):
    """Draw all-caps with positive letter-spacing.

    PIL has no native letter-spacing — we paint glyph by glyph and
    advance by base-width + tracking. Used for eyebrows and the
    colophon line.
    """
    upper = txt.upper()
    cursor = x
    for ch in upper:
        draw.text((cursor, y), ch, fill=fill, font=font)
        bbox = draw.textbbox((0, 0), ch, font=font)
        cw = bbox[2] - bbox[0]
        cursor += cw + int(font.size * tracking_em)
    return cursor - x  # total advance


def thin_rule(draw, x1, y, x2, fill=SAND_DIM, alpha=80):
    """1px horizontal rule, drawn as a sub-opacity line. Alpha approximated
    by mixing toward INK since PIL's draw doesn't take RGBA on RGB images.
    """
    blended = tuple(int((c * alpha + INK[i] * (255 - alpha)) / 255) for i, c in enumerate(fill))
    draw.line([(x1, y), (x2, y)], fill=blended, width=1)


def colophon(draw, y_centre, version='v5.2.4', date='2026-05-06', license='Internal license'):
    """The bottom-margin colophon. Three centre-dots between segments,
    tracked all-caps, sand-dim. Decorative — read as a quarterly's
    masthead, not a copyright line.
    """
    parts = ['RTMcompare', version, f'build {date}', license]
    text = '   ·   '.join(parts).upper()
    f = sans(15)
    w = text_w(draw, text, f)
    # Tracked manually for the dots-and-spaces rhythm.
    tracked_caps(draw, (W - w) // 2 - int(f.size * 0.12 * len(text) * 0.4),
                 y_centre, '   ·   '.join(parts), f, SAND_DIM, tracking_em=0.16)


# ── SLIDE 1 — Cover ────────────────────────────────────────────────
# Asymmetric magazine cover. Wordmark sits ~38% from top (above optical
# centre), eyebrow above it. Lower zone holds a single tracked-caps
# line and the colophon. Single antique gold gesture: a 1px rule the
# wordmark sits over.
def slide_1():
    img = Image.new('RGB', (W, H), INK)
    draw = ImageDraw.Draw(img)

    # Eyebrow
    f_eyebrow = sans(28)
    eyebrow = 'PRO AUDIO QC, MASTERING-GRADE'
    tracked_caps(draw, 80, int(H * 0.30), eyebrow, f_eyebrow, SAND_MUTED)

    # Wordmark — Instrument Serif at ~280px
    f_wordmark = serif(280)
    wordmark = 'RTMcompare'
    draw.text((80, int(H * 0.34)), wordmark, fill=CREAM, font=f_wordmark)

    # Single gold rule under the wordmark — the one chromatic gesture.
    rule_y = int(H * 0.34) + 280 + 24
    draw.line([(80, rule_y), (W - 80, rule_y)], fill=GOLD, width=1)

    # Italic display kicker
    f_kicker = serif_italic(56)
    kicker = 'A/B compare. Single-file QC. Album batch. Atmos.'
    draw.text((80, rule_y + 40), kicker, fill=SAND_SECONDARY, font=f_kicker)

    # Bottom — directive imperative, not marketing
    f_imperative = sans(36)
    tracked_caps(draw, 80, int(H * 0.86), 'Drop two files to begin.',
                 f_imperative, CREAM, tracking_em=0.10)

    # Colophon
    colophon(draw, H - 70)

    img.save(os.path.join(OUT_DIR, 'slide_1_cover.png'))
    print('slide 1 — cover')


# ── SLIDE 2 — Hero metric ──────────────────────────────────────────
# A single Didone numeral fills 40% of the vertical axis. Eyebrow
# above. Italic display caption beneath. Operatic ratio: hero to
# caption like a lead vocal to a printed note.
def slide_2():
    img = Image.new('RGB', (W, H), INK)
    draw = ImageDraw.Draw(img)

    # Eyebrow
    tracked_caps(draw, 80, 320, 'OVERALL VERDICT', sans(28), SAND_MUTED)

    # Hero numeral — −7.1 (LUFS-I example)
    f_hero = serif(680)
    hero = '−7.1'
    draw.text((80, 380), hero, fill=CREAM, font=f_hero)

    # Unit, set quietly to the right, baseline-aligned with the hero
    f_unit = serif(120)
    draw.text((80 + text_w(draw, hero, f_hero) + 24, 380 + 360),
              'LUFS', fill=SAND_MUTED, font=f_unit)

    # Italic display caption
    f_caption = serif_italic(54)
    caption = 'Two point eight louder than the reference, integrated.'
    draw.text((80, 1300), caption, fill=SAND_SECONDARY, font=f_caption)

    # Quiet metadata strip — three columns of supporting numbers
    metadata = [('TP', '1.4 dBTP'), ('LRA', '2.2 LU'), ('MONO', '0')]
    f_meta_label = sans(22)
    f_meta_value = mono(34)
    col_w = (W - 160) // 3
    y_meta = 1500
    for i, (label, value) in enumerate(metadata):
        x = 80 + i * col_w
        tracked_caps(draw, x, y_meta, label, f_meta_label, SAND_MUTED)
        draw.text((x, y_meta + 36), value, fill=CREAM, font=f_meta_value)

    colophon(draw, H - 70)

    img.save(os.path.join(OUT_DIR, 'slide_2_hero_metric.png'))
    print('slide 2 — hero metric')


# ── SLIDE 3 — A/B compare frame ────────────────────────────────────
# Two columns, asymmetric weights — the active "B" column gets the
# gold underline. Each column: file label + LUFS value in Didone +
# the single delivery delta beneath.
def slide_3():
    img = Image.new('RGB', (W, H), INK)
    draw = ImageDraw.Draw(img)

    tracked_caps(draw, 80, 280, 'LEVEL-MATCHED COMPARISON', sans(28), SAND_MUTED)

    f_method = serif_italic(48)
    draw.text((80, 340), 'Both files normalised to −18 LUFS before audition.',
              fill=SAND_SECONDARY, font=f_method)

    # A column
    col_x_a = 80
    col_y = 600
    tracked_caps(draw, col_x_a, col_y, 'A · REFERENCE', sans(24), SAND_MUTED)
    draw.text((col_x_a, col_y + 50), '−9.9', fill=CREAM, font=serif(280))
    draw.text((col_x_a, col_y + 360), 'demo.wav', fill=SAND_MUTED, font=mono(28))

    # Vertical thin rule between columns
    sep_x = W // 2
    draw.line([(sep_x, col_y - 20), (sep_x, col_y + 420)], fill=SAND_DIM, width=1)

    # B column — active, gets the single gold underline
    col_x_b = sep_x + 60
    tracked_caps(draw, col_x_b, col_y, 'B · MIX', sans(24), SAND_MUTED)
    draw.text((col_x_b, col_y + 50), '−7.1', fill=CREAM, font=serif(280))
    draw.text((col_x_b, col_y + 360), 'mix.wav', fill=SAND_MUTED, font=mono(28))
    # Gold rule beneath the active value
    draw.line([(col_x_b, col_y + 50 + 280 + 18),
               (col_x_b + 360, col_y + 50 + 280 + 18)], fill=GOLD, width=1)

    # Delta line
    f_delta = serif_italic(60)
    draw.text((80, 1280), 'B is 2.8 LU louder than A, integrated.',
              fill=SAND_SECONDARY, font=f_delta)

    # Spec context
    f_ctx = sans(26)
    tracked_caps(draw, 80, 1450, 'APPLE MUSIC TARGET: −16 LUFS    ·    SPOTIFY TARGET: −14 LUFS',
                 f_ctx, SAND_DIM, tracking_em=0.14)

    colophon(draw, H - 70)

    img.save(os.path.join(OUT_DIR, 'slide_3_ab_frame.png'))
    print('slide 3 — A/B frame')


# ── SLIDE 4 — Feature spotlight ────────────────────────────────────
# Single feature per slide. One italic display headline that does
# the heavy lifting. Supporting body in body sans, sand-secondary.
# No icon. No card. Generous space.
def slide_4():
    img = Image.new('RGB', (W, H), INK)
    draw = ImageDraw.Draw(img)

    tracked_caps(draw, 80, 320, 'DELIVERY MANIFEST RECONCILER', sans(28), SAND_MUTED)

    # Italic display headline — runs across multiple lines as a
    # single editorial statement
    f_head = serif_italic(96)
    headline_lines = [
        'Three-way diff',
        'between audio,',
        'manifest, and the',
        'album\'s ISRC set.',
    ]
    y = 480
    for line in headline_lines:
        draw.text((80, y), line, fill=CREAM, font=f_head)
        y += 110

    # Supporting body — one quiet paragraph
    f_body = sans(34)
    body_lines = [
        'Catches title-casing drift (Apple cancels delivery on',
        '"Feat." vs "feat."), ISRC collisions, ISRC reuse from',
        'a prior release, duration mismatches, and missing rows',
        'on either side. Exports a Ship-Ready PDF and a',
        'Corrected CSV the distributor can re-ingest.',
    ]
    y = 1180
    for line in body_lines:
        draw.text((80, y), line, fill=SAND_SECONDARY, font=f_body)
        y += 56

    # Bottom marker
    tracked_caps(draw, 80, H - 200, 'FOR LABEL OPS · SHIPS WITH 5.2',
                 sans(24), SAND_MUTED, tracking_em=0.18)

    colophon(draw, H - 70)

    img.save(os.path.join(OUT_DIR, 'slide_4_dmr.png'))
    print('slide 4 — DMR feature')


# ── SLIDE 5 — Verdict (single-line, full-frame) ────────────────────
# A pass / hold / block verdict. Hero word in Didone fills the upper
# half. Spec line beneath. Used for the per-DSP triage workflow.
def slide_5():
    img = Image.new('RGB', (W, H), INK)
    draw = ImageDraw.Draw(img)

    tracked_caps(draw, 80, 320, 'NETFLIX DELIVERY · TRIAGE', sans(28), SAND_MUTED)

    # Hero verdict
    f_verdict = serif(340)
    draw.text((80, 480), 'PASS', fill=CREAM, font=f_verdict)

    # Single gold rule below the verdict — the chromatic gesture
    rule_y = 480 + 340 + 24
    draw.line([(80, rule_y), (80 + 280, rule_y)], fill=GOLD, width=1)

    # Spec details — one numeric column
    f_label = sans(22)
    f_value = mono(36)
    rows = [
        ('DIALOG ANCHOR', '−27.0 LKFS'),
        ('TRUE PEAK',     '−2.3 dBTP'),
        ('CHANNEL LAYOUT', 'STEREO + 5.1 M&E'),
        ('CODEC',         'PCM, 24/48'),
    ]
    y = rule_y + 80
    for label, value in rows:
        tracked_caps(draw, 80, y, label, f_label, SAND_MUTED)
        draw.text((W - 80 - text_w(draw, value, f_value), y - 4),
                  value, fill=CREAM, font=f_value)
        thin_rule(draw, 80, y + 60, W - 80, fill=SAND_DIM, alpha=140)
        y += 100

    # Italic display caption
    f_caption = serif_italic(48)
    draw.text((80, H - 280), 'Within Netflix\'s spec on every measurement.',
              fill=SAND_SECONDARY, font=f_caption)

    colophon(draw, H - 70)

    img.save(os.path.join(OUT_DIR, 'slide_5_verdict.png'))
    print('slide 5 — verdict')


# ── SLIDE 6 — Closing ──────────────────────────────────────────────
# Mirrors slide 1 but quieter. Wordmark smaller, more space, single
# imperative line, contact / where-to-find. The colophon does the
# weight-bearing work.
def slide_6():
    img = Image.new('RGB', (W, H), INK)
    draw = ImageDraw.Draw(img)

    # Centred wordmark — smaller this time
    f_wordmark = serif(180)
    wordmark = 'RTMcompare'
    draw.text(((W - text_w(draw, wordmark, f_wordmark)) // 2, int(H * 0.36)),
              wordmark, fill=CREAM, font=f_wordmark)

    # Italic display tagline
    f_tag = serif_italic(54)
    tag = 'A console, with a magazine\'s discipline.'
    draw.text(((W - text_w(draw, tag, f_tag)) // 2, int(H * 0.36) + 200),
              tag, fill=SAND_SECONDARY, font=f_tag)

    # Single gold rule, short, centred — the final chromatic gesture
    rule_w = 120
    rule_y = int(H * 0.36) + 320
    draw.line([((W - rule_w) // 2, rule_y), ((W + rule_w) // 2, rule_y)],
              fill=GOLD, width=1)

    # Where to find
    f_where = sans(28)
    where = 'AVAILABLE FOR macOS · APPLE SILICON'
    tracked_caps(draw, (W - text_w(draw, where, f_where)) // 2, int(H * 0.66),
                 where, f_where, SAND_MUTED, tracking_em=0.18)

    colophon(draw, H - 70)

    img.save(os.path.join(OUT_DIR, 'slide_6_closing.png'))
    print('slide 6 — closing')


# ── Driver ──────────────────────────────────────────────────────────
if __name__ == '__main__':
    slide_1()
    slide_2()
    slide_3()
    slide_4()
    slide_5()
    slide_6()
    print(f'\nAll slides written to {OUT_DIR}/')
