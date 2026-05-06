#!/usr/bin/env python3
"""Console Didone PDFs — Manual, Features, Pitch.

5.3 rewrite: new voice. Same visual spine (Console Didone — Instrument
Serif on ink, single antique-gold gesture per page), much warmer copy.
Magazine-feature register, opinionated, names specific things, no
corporate distance. Mirrors the microcopy already in the app.

Three audiences addressed throughout — mixing engineers, mastering
engineers, music producers — never gendered, never hedged.

Outputs:
  RTMcompare-Manual.pdf     · US Letter portrait
  RTMcompare-Features.pdf   · US Letter portrait
  RTMcompare-Pitch.pdf      · 16:9 landscape

Run:  python3 promo/generate_pdfs.py
"""

from __future__ import annotations
import os, sys
from pathlib import Path

from reportlab.pdfgen import canvas
from reportlab.lib.colors import Color, HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ── Paths ──────────────────────────────────────────────────────────
HERE = Path(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = HERE.parent
FONT_DIR = REPO_ROOT / 'release' / 'v5.5.0' / 'fonts'

# ── Console Didone palette ─────────────────────────────────────────
INK            = HexColor('#0e0d0b')
PANEL          = HexColor('#1e1c18')
CREAM          = HexColor('#ebe7e0')
SAND_SECONDARY = HexColor('#d6d1c6')
SAND_MUTED     = HexColor('#8d867b')
SAND_DIM       = HexColor('#6a6459')
GOLD           = HexColor('#d0b066')
WARM_RED       = HexColor('#c96765')

# ── Page sizes ─────────────────────────────────────────────────────
LETTER_W, LETTER_H = 612.0, 792.0          # US Letter portrait
SLIDE_W,  SLIDE_H  = 1920.0, 1080.0        # 16:9 landscape

# ── Font registration ──────────────────────────────────────────────
def _try_register(name: str, file: str) -> str:
    path = FONT_DIR / file
    if path.exists():
        try:
            pdfmetrics.registerFont(TTFont(name, str(path)))
            return name
        except Exception as e:
            print(f'[warn] {name}: {e}', file=sys.stderr)
    return ''

SERIF        = _try_register('InstrumentSerif',       'InstrumentSerif-Regular.ttf') or 'Times-Roman'
SERIF_ITALIC = _try_register('InstrumentSerifItalic', 'InstrumentSerif-Italic.ttf')  or 'Times-Italic'
SANS         = _try_register('InstrumentSans',        'InstrumentSans-Regular.ttf')  or 'Helvetica'
SANS_BOLD    = _try_register('InstrumentSansBold',    'InstrumentSans-Bold.ttf')     or 'Helvetica-Bold'
MONO         = _try_register('GeistMono',             'GeistMono-Regular.ttf')       or 'Courier'

# ── Drawing primitives ─────────────────────────────────────────────
def fill_bg(c, w, h, color=INK):
    c.setFillColor(color)
    c.rect(0, 0, w, h, fill=1, stroke=0)

def gold_rule(c, x, y, w, weight=0.6):
    c.setStrokeColor(GOLD)
    c.setLineWidth(weight)
    c.line(x, y, x + w, y)

def thin_rule(c, x, y, w, color=SAND_DIM, opacity=0.30):
    r, g, b, _ = color.rgba()
    c.setStrokeColor(Color(r, g, b, alpha=opacity))
    c.setLineWidth(0.5)
    c.line(x, y, x + w, y)

def tracked_caps(c, x, y, text, font, size, fill, tracking=0.16):
    c.setFillColor(fill)
    c.setFont(font, size)
    cursor = x
    for ch in text.upper():
        c.drawString(cursor, y, ch)
        cursor += c.stringWidth(ch, font, size) + size * tracking

def text_block(c, x, y, lines, font, size, fill, leading=None):
    leading = leading if leading is not None else size * 1.45
    c.setFillColor(fill)
    c.setFont(font, size)
    cy = y
    for line in lines:
        c.drawString(x, cy, line)
        cy -= leading
    return cy + leading

def colophon(c, w, y, parts):
    text = '   ·   '.join(parts).upper()
    font = SANS
    size = 6.5
    width = c.stringWidth(text, font, size) * 1.18
    cursor = (w - width) / 2.0
    c.setFillColor(SAND_DIM)
    c.setFont(font, size)
    for ch in text:
        c.drawString(cursor, y, ch)
        cursor += c.stringWidth(ch, font, size) + size * 0.18

def wordmark(c, x, y, size, fill=CREAM):
    c.setFillColor(fill)
    c.setFont(SERIF, size)
    c.drawString(x, y, 'RTMcompare')

def corner_ticks(c, w, h, inset=42, length=22, weight=0.6, color=SAND_DIM, opacity=0.35):
    """Four L-shaped corner marks — fine-printing vocabulary from the icons."""
    r, g, b, _ = color.rgba()
    c.setStrokeColor(Color(r, g, b, alpha=opacity))
    c.setLineWidth(weight)
    # top-left
    c.line(inset, h - inset, inset + length, h - inset)
    c.line(inset, h - inset, inset, h - inset - length)
    # top-right
    c.line(w - inset, h - inset, w - inset - length, h - inset)
    c.line(w - inset, h - inset, w - inset, h - inset - length)
    # bottom-left
    c.line(inset, inset, inset + length, inset)
    c.line(inset, inset, inset, inset + length)
    # bottom-right
    c.line(w - inset, inset, w - inset - length, inset)
    c.line(w - inset, inset, w - inset, inset + length)

def diamond(c, cx, cy, size, fill=GOLD):
    """Small gold diamond — the single chromatic gesture, mirrors the icon mark."""
    c.setFillColor(fill)
    p = c.beginPath()
    p.moveTo(cx, cy - size)
    p.lineTo(cx + size, cy)
    p.lineTo(cx, cy + size)
    p.lineTo(cx - size, cy)
    p.close()
    c.drawPath(p, fill=1, stroke=0)


# ──────────────────────────────────────────────────────────────────────
#  MANUAL
# ──────────────────────────────────────────────────────────────────────
def build_manual(path):
    c = canvas.Canvas(str(path), pagesize=(LETTER_W, LETTER_H))
    c.setTitle('RTMcompare — User Manual')
    c.setAuthor('Ohad Nissim')
    c.setSubject('RTMcompare 5.5 user manual')

    margin = 60.0
    body_w = LETTER_W - 2 * margin

    def new_page():
        c.showPage()
        fill_bg(c, LETTER_W, LETTER_H)
        corner_ticks(c, LETTER_W, LETTER_H)
        colophon(c, LETTER_W, 28, ['RTMcompare', 'v5.5', 'A user manual', 'Local-first'])

    def chapter_head(eyebrow, title):
        tracked_caps(c, margin, LETTER_H - 110, eyebrow, SANS, 8, SAND_MUTED, tracking=0.22)
        c.setFillColor(CREAM); c.setFont(SERIF, 38)
        c.drawString(margin, LETTER_H - 162, title)
        gold_rule(c, margin, LETTER_H - 182, 110)
        return LETTER_H - 222  # cursor for first body line

    # ── Cover ──
    fill_bg(c, LETTER_W, LETTER_H)
    corner_ticks(c, LETTER_W, LETTER_H)

    tracked_caps(c, margin, LETTER_H - 110, 'A USER MANUAL · EDITION 5.5',
                 SANS, 8.5, SAND_MUTED, tracking=0.22)

    # Wordmark
    wordmark(c, margin, LETTER_H - 240, 84)

    # Single gold diamond on a tick rule, like the icon
    rule_y = LETTER_H - 268
    rule_x_start = margin
    rule_x_end = margin + body_w * 0.46
    rule_mid = (rule_x_start + rule_x_end) / 2
    c.setStrokeColor(Color(*CREAM.rgb(), alpha=0.85))
    c.setLineWidth(0.6)
    c.line(rule_x_start, rule_y, rule_mid - 6, rule_y)
    c.line(rule_mid + 6, rule_y, rule_x_end, rule_y)
    diamond(c, rule_mid, rule_y, 4)

    # Italic kicker — the canonical tagline
    c.setFillColor(SAND_SECONDARY)
    c.setFont(SERIF_ITALIC, 28)
    c.drawString(margin, LETTER_H - 320, 'Hear what Spotify hears.')
    # Second line with "Before" in gold
    c.setFillColor(GOLD)
    c.drawString(margin, LETTER_H - 360, 'Before')
    before_w = c.stringWidth('Before', SERIF_ITALIC, 28)
    c.setFillColor(SAND_SECONDARY)
    c.drawString(margin + before_w + 8, LETTER_H - 360, 'Spotify hears it.')

    # Body intro
    text_block(c, margin, LETTER_H - 460,
               ["This is a manual. Not a brochure, not a sales deck — the actual",
                "instructions for how to live inside the app.",
                "",
                "RTMcompare is for mixing engineers chasing the next revision,",
                "mastering engineers shipping to streaming, and producers who want",
                "to know what their bounce will sound like once the platforms",
                "have had their way with it. Same tool for all three. Different",
                "starting screens depending on what you drop in.",
                "",
                "Read it linearly or skip to the surface you're using. Chapters",
                "are short. Nobody asked for a textbook."],
               SANS, 11.5, SAND_SECONDARY, leading=18)

    colophon(c, LETTER_W, 60, ['RTMcompare', 'v5.5.2', 'Apple Silicon', 'macOS 12+'])

    # ── 1 · Install ──
    new_page()
    y = chapter_head('CHAPTER ONE', 'How to install this thing.')
    text_block(c, margin, y,
               ["Drag RTMcompare.app from the DMG into your Applications folder.",
                "macOS will hesitate the first time you open it — right-click → Open,",
                "click \"Open\" again on the Gatekeeper dialog, and from then on it's",
                "a normal app.",
                "",
                "On first launch you meet the cover screen — a Didone wordmark,",
                "one line of instruction, one drop frame. Drag two audio files in",
                "and you're analyzing.",
                "",
                "There's no installer wizard. No license server. No telemetry.",
                "The only network call this app makes is for opt-in DSP delivery-",
                "status fetches, and only outbound, with credentials in the macOS",
                "Keychain. Otherwise it's a closed loop on your machine."],
               SANS, 11.5, SAND_SECONDARY, leading=18)

    text_block(c, margin, LETTER_H - 540,
               ["Disk:    ~1.5 GB (app + bundled Python 3.11 + BS-RoFormer ckpt)",
                "RAM:     8 GB minimum, 16 GB recommended for stem separation",
                "Audio:   WAV, FLAC, AIFF, MP3, OGG, M4A, ADM BWF"],
               MONO, 10, SAND_MUTED, leading=15)

    # ── 2 · Compare ──
    new_page()
    y = chapter_head('CHAPTER TWO', 'Comparing two files.')
    text_block(c, margin, y,
               ["This is the surface most people opened the app to find.",
                "",
                "Drop the reference into the left slot. Drop the file you're",
                "evaluating into the right. Pick a delivery target from the",
                "header chips — Music, Full, Bcast, Netflix, Post — that single",
                "gold pill is the lens every measurement after this gets read",
                "through. Hit Compare.",
                "",
                "Both files are level-matched to −18 LUFS integrated before",
                "you hear a single sample. That's the whole point. Loud doesn't",
                "fake good when both files are at the same target. The version",
                "you think is better is just louder, until it isn't.",
                "",
                "When the analysis lands, the instrument row above the tabs",
                "shows the four numbers that decide whether your file ships:",
                "LUFS-I, true peak, LRA, mono-compat. Each tab opens with a",
                "Didone verdict at the top — the headline number for that surface",
                "— then the panels you came for sit beneath."],
               SANS, 11.5, SAND_SECONDARY, leading=18)
    # Italic standfirst at the bottom
    c.setFillColor(GOLD); c.setFont(SERIF_ITALIC, 14)
    c.drawString(margin, 100, "For: mixing engineers, mastering engineers, producers comparing their bounce to a hit.")

    # ── 3 · Single-file QC ──
    new_page()
    y = chapter_head('CHAPTER THREE', 'When you only have one file.')
    text_block(c, margin, y,
               ["Sometimes there's no reference. The file is the file, and you",
                "want to know whether it's ready.",
                "",
                "Drop one audio file in. Click \"Analyze Reference Only.\" The",
                "single-file QC pass reads the master clinically and tells you",
                "what it found:",
                "",
                "  •  Click and glitch timeline, with click-to-transport jump",
                "     so you can audition every defect in seconds.",
                "  •  Distortion detection — clipping, ISR, harmonic — with",
                "     the offending frequency band named.",
                "  •  Mains hum and harmonics. 50 / 60 Hz fundamental plus",
                "     the 3rd, 5th, 7th. Catches grounding issues you never",
                "     thought to listen for.",
                "  •  Transfer-artefact detection for analog-sourced masters:",
                "     wow, flutter, DC drift, tape transport, print-through.",
                "  •  Generation-loss detection. If your file came from",
                "     somewhere with a lossy ancestor (a stem you got back",
                "     from a producer in MP3, say), you'll see it here.",
                "  •  Key, BPM, harmonic ladder. For sync pitching.",
                "  •  Mono-compat as a per-band waterfall, not a scalar.",
                "     You see exactly where the mono fold collapses."],
               SANS, 11.5, SAND_SECONDARY, leading=18)
    c.setFillColor(GOLD); c.setFont(SERIF_ITALIC, 14)
    c.drawString(margin, 100, "For: anyone with one file and a deadline.")

    # ── 4 · Album batch ──
    new_page()
    y = chapter_head('CHAPTER FOUR', 'Walking an album.')
    text_block(c, margin, y,
               ["Drop a folder. Get a sortable table — LUFS, true peak, LRA,",
                "ISRC, duration, sample rate, bit depth, with outliers",
                "highlighted automatically.",
                "",
                "Click any row to drop into a single song tab. Step through the",
                "album with the arrow keys. Each song gets lazy deep analysis;",
                "results cache across rotations so you only pay the cost once.",
                "",
                "Cohort Mode promotes any track or external file as the",
                "reference. A per-track distance heatmap across 31 bands shows",
                "which songs stray most. Sort by drift, find the outlier, fix",
                "the outlier, ship the album. That's the loop.",
                "",
                "Save the session as a .rtmalbum.json — every analysis, every",
                "note, the A/B reference, the cohort ref, the delivery manifest",
                "state. Re-open it in a year and pick up exactly where you",
                "stopped. Useful when a label comes back asking you to remaster",
                "a 2024 EP for a vinyl press."],
               SANS, 11.5, SAND_SECONDARY, leading=18)
    c.setFillColor(GOLD); c.setFont(SERIF_ITALIC, 14)
    c.drawString(margin, 100, "For: mastering engineers shipping albums, producers auditing their catalogue.")

    # ── 5 · DMR ──
    new_page()
    y = chapter_head('CHAPTER FIVE', 'How Apple cancels deliveries.')
    text_block(c, margin, y,
               ["Apple cancels deliveries on punctuation. \"Feat.\" vs \"feat.\"",
                "is enough — they auto-reject the manifest, the distributor",
                "kicks it back to you at midnight, and the release date slips.",
                "",
                "Spotify rejects duplicate ISRCs without warning. Anyone who",
                "ships catalogue knows the feeling of a release going \"live\"",
                "with three of the four tracks because one ISRC collided",
                "silently with something from 2019.",
                "",
                "The Delivery Manifest Reconciler is the surface that catches",
                "this before the email arrives. Drop the distributor's CSV or",
                "DDEX ERN 4.3 XML onto the panel inside album batch. RTMcompare",
                "three-way-diffs the audio-embedded metadata, the manifest,",
                "and the album's internal ISRC set, and surfaces every blocker:",
                "",
                "  •  Title-casing drift",
                "  •  ISRC collisions inside the album",
                "  •  ISRC reuse from prior releases (cross-session history",
                "     at ~/.rtm/isrc-history.json)",
                "  •  Duration mismatches between audio and manifest",
                "  •  Missing rows on either side",
                "  •  P-line / C-line drift",
                "",
                "Resolve each. Export Ship-Ready PDF and Corrected CSV. Attach",
                "both to the delivery ticket. Your distributor can re-ingest",
                "the CSV directly."],
               SANS, 11.5, SAND_SECONDARY, leading=18)
    c.setFillColor(GOLD); c.setFont(SERIF_ITALIC, 14)
    c.drawString(margin, 100, "For: label ops. Skip if you're not.")

    # ── 6 · Atmos ──
    new_page()
    y = chapter_head('CHAPTER SIX', 'Immersive and Dolby Atmos.')
    text_block(c, margin, y,
               ["Drop an ADM BWF file in. RTMcompare parses bed and objects,",
                "reads the trajectories, runs an early-warning binaural-",
                "headroom estimate (ILD downmix — no HRTF render), and QCs",
                "the stereo downmix against the immersive master.",
                "",
                "Atmos Preflight runs the hard-checks Apple actually enforces:",
                "object count must be at most 118, LFE has to route, bed layout",
                "must be 7.1.2 or 5.1.4, sample rate 48 kHz, bit depth at least",
                "24. Failures gate delivery. Fix before you press send.",
                "",
                "Per-object anomaly detection flags hot, silent, static, or",
                "dark objects. Most of the time the source is a mix mistake,",
                "not artistic intent. The flag points you at the channel; you",
                "make the call about whether to fix or whether the producer",
                "really did mean to put a 6 kHz tone on object 47."],
               SANS, 11.5, SAND_SECONDARY, leading=18)
    c.setFillColor(GOLD); c.setFont(SERIF_ITALIC, 14)
    c.drawString(margin, 100, "For: immersive mix supervisors. Skippable for everyone else.")

    # ── 7 · Companions ──
    new_page()
    y = chapter_head('CHAPTER SEVEN', 'The two companion apps.')
    c.setFillColor(CREAM); c.setFont(SERIF_ITALIC, 24)
    c.drawString(margin, y, 'RTMprofile')
    text_block(c, margin, y - 30,
               ["Feed it five-plus of your finished masters. RTMprofile learns",
                "the spectral and dynamic fingerprint of your work and saves it",
                "as a JSON profile. Load that profile into RTMcompare's Match",
                "tab and any new mix can be graded against your own sound, with",
                "concrete EQ moves to close the gap.",
                "",
                "Useful if you're an engineer building a signature, or a",
                "producer who wants their EP to sound consistent."],
               SANS, 11.5, SAND_SECONDARY, leading=18)

    c.setFillColor(CREAM); c.setFont(SERIF_ITALIC, 24)
    c.drawString(margin, y - 200, 'RTMsend')
    text_block(c, margin, y - 230,
               ["A VST3 / AU plugin. Sits on a bus in Wavelab, Logic, Pro Tools,",
                "Studio One, or any DAW that hosts AU/VST3.",
                "",
                "One button sends the buffer to RTMcompare's Single, Compare-B,",
                "or Album surface. No export dialog, no render queue. ARA-aware",
                "on hosts that support it; ring-buffers the last N seconds",
                "otherwise.",
                "",
                "Useful when you're mid-mix and need to QC something now,",
                "without breaking flow to bounce a file."],
               SANS, 11.5, SAND_SECONDARY, leading=18)

    # ── 8 · Reference ──
    new_page()
    y = chapter_head('REFERENCE', 'Keyboard shortcuts.')
    shortcuts = [
        ('Space',          'Play / pause the active transport'),
        ('A · B · X',      'Switch A · Switch B · Flip (ABPlayer)'),
        ('← · →',          'Previous / next song (song tab)'),
        ('1 – 9',          'Jump to tab N (Compare view)'),
        ('M',              'Mono listen mode'),
        ('S',              'Solo each side'),
        ('L',              'Toggle loop'),
        ('⌘ K  ·  /',      'Command palette · Song quick-switch · Search'),
        ('⌘ E  ·  ⌘ ⇧ E',  'Export EQ (FabFilter Pro-Q text) · Apply EQ + bounce'),
        ('?',              'This shortcut legend, on screen'),
        ('⌘ N',            'New comparison (results screens)'),
    ]
    y_row = y
    for keys, action in shortcuts:
        c.setFillColor(CREAM); c.setFont(MONO, 10)
        c.drawString(margin, y_row, keys)
        c.setFillColor(SAND_SECONDARY); c.setFont(SANS, 10.5)
        c.drawString(margin + 130, y_row, action)
        thin_rule(c, margin, y_row - 6, body_w, color=SAND_DIM, opacity=0.18)
        y_row -= 26

    c.setFillColor(CREAM); c.setFont(SERIF, 24)
    c.drawString(margin, y_row - 30, 'Privacy.')
    text_block(c, margin, y_row - 60,
               ["Every analysis, every render, every metadata read happens on",
                "your machine. No audio leaves the device. The only network path",
                "the app opens is opt-in delivery-status fetching from the",
                "DSPs you've authorised — outbound, read-only, credentials in",
                "the macOS Keychain via safeStorage."],
               SANS, 10.5, SAND_SECONDARY, leading=16)

    c.save()
    print(f'  → {Path(path).name}')


# ──────────────────────────────────────────────────────────────────────
#  FEATURES
# ──────────────────────────────────────────────────────────────────────
def build_features(path):
    c = canvas.Canvas(str(path), pagesize=(LETTER_W, LETTER_H))
    c.setTitle('RTMcompare — Features')
    c.setAuthor('Ohad Nissim')
    c.setSubject('RTMcompare 5.5 feature reference')

    margin = 60.0
    body_w = LETTER_W - 2 * margin

    def new_page():
        c.showPage()
        fill_bg(c, LETTER_W, LETTER_H)
        corner_ticks(c, LETTER_W, LETTER_H)
        colophon(c, LETTER_W, 28, ['RTMcompare', 'v5.5', 'Features', 'Local-first'])

    def section_heading(eyebrow, title, standfirst=None, y=LETTER_H - 110):
        tracked_caps(c, margin, y, eyebrow, SANS, 8, SAND_MUTED, tracking=0.22)
        c.setFillColor(CREAM); c.setFont(SERIF, 32)
        c.drawString(margin, y - 50, title)
        gold_rule(c, margin, y - 68, 110)
        if standfirst:
            c.setFillColor(SAND_SECONDARY); c.setFont(SERIF_ITALIC, 14)
            # word wrap standfirst
            words = standfirst.split()
            line, line_y = '', y - 96
            max_w = body_w
            for w in words:
                trial = (line + ' ' + w).strip()
                if c.stringWidth(trial, SERIF_ITALIC, 14) > max_w:
                    c.drawString(margin, line_y, line)
                    line, line_y = w, line_y - 22
                else:
                    line = trial
            if line:
                c.drawString(margin, line_y, line)
            return line_y - 40
        return y - 130

    def feature_row(y, label, blurb):
        c.setFillColor(CREAM); c.setFont(SANS_BOLD, 10.5)
        c.drawString(margin, y, label)
        c.setFillColor(SAND_SECONDARY); c.setFont(SANS, 10)
        words = blurb.split()
        line, line_y = '', y - 16
        for w in words:
            trial = (line + ' ' + w).strip()
            if c.stringWidth(trial, SANS, 10) > body_w:
                c.drawString(margin, line_y, line)
                line, line_y = w, line_y - 14
            else:
                line = trial
        if line:
            c.drawString(margin, line_y, line)
        thin_rule(c, margin, line_y - 10, body_w, color=SAND_DIM, opacity=0.16)
        return line_y - 28

    # ── Cover ──
    fill_bg(c, LETTER_W, LETTER_H)
    corner_ticks(c, LETTER_W, LETTER_H)
    tracked_caps(c, margin, LETTER_H - 110, 'WHAT\'S IN THE BOX · v5.5',
                 SANS, 8.5, SAND_MUTED, tracking=0.22)
    wordmark(c, margin, LETTER_H - 240, 84)

    rule_y = LETTER_H - 268
    rule_x_start = margin
    rule_x_end = margin + body_w * 0.46
    rule_mid = (rule_x_start + rule_x_end) / 2
    c.setStrokeColor(Color(*CREAM.rgb(), alpha=0.85))
    c.setLineWidth(0.6)
    c.line(rule_x_start, rule_y, rule_mid - 6, rule_y)
    c.line(rule_mid + 6, rule_y, rule_x_end, rule_y)
    diamond(c, rule_mid, rule_y, 4)

    c.setFillColor(SAND_SECONDARY); c.setFont(SERIF_ITALIC, 22)
    c.drawString(margin, LETTER_H - 320, 'Ten surfaces, one master volume.')

    text_block(c, margin, LETTER_H - 410,
               ["A surface-by-surface reference. Each row in this document",
                "is a real feature in the build you can install today — no",
                "marketing rounding-up, no \"coming soon.\" If it's listed here,",
                "you can reach it from the app right now.",
                "",
                "Use this when: you're trying to remember which panel does",
                "the per-band masking, or you're evaluating the tool against a",
                "spec, or you want to know what a feature is for in one line",
                "before you click into it."],
               SANS, 11.5, SAND_SECONDARY, leading=18)

    colophon(c, LETTER_W, 60, ['RTMcompare', 'v5.5.2', 'Features', '10 surfaces'])

    # ── A/B Compare ──
    new_page()
    y = section_heading('SURFACE ONE', 'A/B Compare.',
                        'The flagship. Drop two files, level-matched. Every measurable difference between them, surfaced.')
    rows = [
        ('Level-matched playback', "Both files normalised to −18 LUFS integrated before audition. Loud doesn't fake good."),
        ('LUFS-I, TP, LRA, MONO', "The four delivery numbers, surfaced in the instrument row at the top of every screen."),
        ('Per-band masking', 'BS-RoFormer 4-stem separation (SDR 9.66) reveals where vocals, drums, bass, other lose energy. Per-band, not whole-mix.'),
        ('Phase correlation over time', 'Full-track plot plus per-band phase ribbon. Catches phase issues scalar correlation hides.'),
        ('Vectorscope', 'XY mid/side scope with peak-hold. Width and centre-energy at a glance.'),
        ('Streaming-normalisation preview', 'Spotify, Apple, Amazon, Tidal, YouTube. Hear exactly how each platform will play your master.'),
        ('Inter-sample peak meter', '4× oversampled true-peak detection (BS.1770-4). The Apply-and-bounce limiter steps to 16× polyphase Kaiser internally for sub-0.05 dB ceiling accuracy on the rendered master.'),
        ('AAC encode preview', "Render through Apple's AAC encoder, A/B against the source."),
        ('Engineer-profile matching', 'Serban Ghenea, Chris Lord-Alge, your own (built with RTMprofile). Match-score plus concrete EQ moves.'),
        ('EQ-move export', 'FabFilter Pro-Q text, CSV, JSON. Or apply-and-bounce a corrected master WAV in one click.'),
    ]
    for label, blurb in rows:
        y = feature_row(y, label, blurb)

    # ── Single-File QC ──
    new_page()
    y = section_heading('SURFACE TWO', 'Single-File QC.',
                        'Drop one file. Get a deep clinical pass. For when there is no reference, only the file and a deadline.')
    rows = [
        ('Click + glitch timeline', 'FLOW v2 LPC-residual detector. Peaks plotted with click-to-transport jump. Drum-friendly — no more snare false positives.'),
        ('Distortion detection', 'Clipping, ISR, harmonic. Severity rating. Frequency band where it sits.'),
        ('Mains hum + harmonics', '50 / 60 Hz fundamental plus 3rd, 5th, 7th. Catches grounding problems you never thought to listen for.'),
        ('Transfer-artefact detection', 'Wow, flutter, DC drift, tape transport, print-through. For analog-sourced masters.'),
        ('Generation-loss detection', 'Prior AAC or MP3 encoding fingerprints. Surfaces lossy ancestors.'),
        ('Key, BPM, harmonic ladder', 'For sync pitching and metadata.'),
        ('Mono-compat waterfall', 'Per band, not just a scalar. See exactly where the mono fold collapses.'),
        ('Stereo image + phase bands', 'Image width and per-band phase, side by side.'),
    ]
    for label, blurb in rows:
        y = feature_row(y, label, blurb)

    # ── Album Batch + Cohort ──
    new_page()
    y = section_heading('SURFACE THREE & FOUR', 'Album Batch + Cohort.',
                        'A folder in. A sortable table out. Drift detection across the album.')
    rows = [
        ('Sortable overview table', 'LUFS, true peak, LRA, ISRC, duration, sample rate, bit depth, outlier flags.'),
        ('One rotating song tab', '← → to step through. Lazy deep analysis cached across rotations.'),
        ('Per-song + album notes', 'Embedded in every PDF export. Travels with the file.'),
        ('.rtmalbum.json sessions', "Save and load every analysis, every note, the A/B ref, cohort ref, DMR state. Re-open in a year and pick up exactly where you stopped."),
        ('Cohort heatmap', 'Per-track distance across 31 bands. Sort by drift to find the outliers.'),
        ('RMS distance column', 'A single ranked metric for class-wide consistency.'),
    ]
    for label, blurb in rows:
        y = feature_row(y, label, blurb)

    # ── DMR + Atmos ──
    new_page()
    y = section_heading('SURFACE FIVE & SIX', 'Delivery Manifest + Atmos.',
                        'The boring stuff that saves you the midnight Apple rejection. Plus the immersive corner for ADM BWF work.')
    rows = [
        ('Three-way diff', 'Audio-embedded metadata ↔ distributor manifest ↔ batch-internal ISRC set.'),
        ('Title-casing drift', 'Feat. vs feat. is enough for Apple to auto-cancel. Surfaced as a blocker.'),
        ('ISRC collisions + reuse', 'Across the album AND across prior releases (history at ~/.rtm/isrc-history.json).'),
        ('Duration mismatches', 'Between audio file and manifest.'),
        ('Missing rows on either side', 'Surfaces orphans audio-side or manifest-side.'),
        ('P-line / C-line check', 'Copyright string drift.'),
        ('Ship-Ready PDF + Corrected CSV', 'Attach to the delivery ticket. The distributor can re-ingest the CSV.'),
        ('ADM BWF parsing', 'Bed, objects, trajectories, channel mapping.'),
        ('Binaural-headroom estimate', 'Early-warning ILD downmix (no HRTF). Apple\'s Atmos guideline is < −1 dBTP on their renderer\'s binaural deliverable; this is a fast sanity-check, not a substitute.'),
        ('Atmos Preflight hard-checks', 'Object count ≤ 118, LFE routing, bed layout, SR = 48 kHz, BD ≥ 24.'),
        ('Per-object anomaly detection', 'Hot, silent, static, dark objects. Usually mix mistakes, occasionally artistic intent.'),
    ]
    for label, blurb in rows:
        y = feature_row(y, label, blurb)

    # ── Quality / Player / Triage / Shell / Companions ──
    new_page()
    y = section_heading('SURFACE SEVEN THROUGH TEN', 'Verdict surfaces and visual chrome.',
                        'How RTMcompare tells you what to change, plays files back, and gates delivery.')
    rows = [
        ('Engineer-target curves', 'Match-score against the chosen engineer profile.'),
        ('Concrete EQ moves', 'Frequency, gain, Q. Exportable.'),
        ('Apply-and-bounce', 'One click. Corrected WAV in your render folder.'),
        ('A/B Player everywhere', 'Same engine, same shortcuts. B tracks active context. A is whatever you picked.'),
        ('Live TP meter', 'Instantaneous and 2-second peak-hold on the transport.'),
        ('Triage Mode (optional)', 'Ready-to-Deliver verdict, Attention list, per-DSP spec profile.'),
        ('Header palette + shortcuts (5.5)', 'Reference dropdown · "+ New analysis" · Search palette (⌘K) · keyboard-shortcut sheet (?) — all in the header. Sticky Advanced QC across sessions.'),
        ('EQ Preview level-match pill', 'A/B the EQ tweak with and without level-matching in one click. The pill is on the panel, not buried in the gear-icon menu.'),
        ('Console Didone Shell', 'Two-row header, Didone instrument metrics, cover-state empty screen, single gold per screen.'),
        ('v1 Classic shell', 'localStorage[rtm-shell] = v1 returns the v5.1.x markup byte-for-byte if you want it back.'),
        ('RTMprofile companion', 'Standalone app. Builds your engineer profile from 5+ finished masters.'),
        ('RTMsend companion', 'VST3 / AU plugin. One-button bridge from your DAW into RTMcompare. ARA-aware.'),
    ]
    for label, blurb in rows:
        y = feature_row(y, label, blurb)

    # ── Closing ──
    new_page()
    y = section_heading('COLOPHON', 'What this is built on.',
                        'The stack underneath, named explicitly because the credit matters.')
    text_block(c, margin, y - 10,
               ['Electron · React 19 · TypeScript · Tailwind v4 · Vite',
                'Python 3.11 · NumPy · SciPy · librosa · pyloudnorm',
                'BS-RoFormer 4-stem (audio-separator) · Demucs (fallback)',
                'JUCE 7 (RTMsend) · electron-builder · electron-rebuild'],
               MONO, 10.5, SAND_SECONDARY, leading=20)
    text_block(c, margin, y - 110,
               ["Wordmark and hero numerals set in Instrument Serif. Body and",
                "labels in Instrument Sans. Tabular data in Geist Mono. The",
                "single antique-gold accent is reserved for one element per",
                "screen — the active delivery-target chip, the verdict-violation",
                "flag, or the icon mark. Never two at once."],
               SANS, 11, SAND_SECONDARY, leading=18)

    c.save()
    print(f'  → {Path(path).name}')


# ──────────────────────────────────────────────────────────────────────
#  PITCH DECK
# ──────────────────────────────────────────────────────────────────────
def build_pitch(path):
    c = canvas.Canvas(str(path), pagesize=(SLIDE_W, SLIDE_H))
    c.setTitle('RTMcompare — Pitch')
    c.setAuthor('Ohad Nissim')
    c.setSubject('RTMcompare 5.5 pitch deck')

    margin = 120.0
    SLIDE_TOTAL = 11
    PLATFORM_STRIP = 'macOS · WINDOWS · LOCAL-FIRST'

    def slide_chrome(slide_no):
        corner_ticks(c, SLIDE_W, SLIDE_H, inset=80, length=40)
        tracked_caps(c, SLIDE_W - margin - 100, SLIDE_H - 80,
                     f'{slide_no:02d} / {SLIDE_TOTAL:02d}',
                     SANS, 11, SAND_DIM, tracking=0.22)
        colophon(c, SLIDE_W, 60, ['RTMcompare', 'v5.5', 'Pitch', 'macOS + Windows'])

    def tagline(y_first, size=56):
        """The canonical italic tagline, with 'Before' in gold."""
        c.setFillColor(SAND_SECONDARY); c.setFont(SERIF_ITALIC, size)
        c.drawString(margin, y_first, 'Hear what Spotify hears.')
        c.setFillColor(GOLD); c.setFont(SERIF_ITALIC, size)
        c.drawString(margin, y_first - int(size * 1.25), 'Before')
        before_w = c.stringWidth('Before', SERIF_ITALIC, size)
        c.setFillColor(SAND_SECONDARY); c.setFont(SERIF_ITALIC, size)
        c.drawString(margin + before_w + 20, y_first - int(size * 1.25),
                     'Spotify hears it.')

    # ─────────────────────────────────────────────────────────────────
    # 1 · Cover — the tagline, hard.
    # ─────────────────────────────────────────────────────────────────
    fill_bg(c, SLIDE_W, SLIDE_H)
    tracked_caps(c, margin, SLIDE_H - 240,
                 'MASTERING-GRADE AUDIO COMPARISON & QC',
                 SANS, 18, SAND_MUTED, tracking=0.22)
    wordmark(c, margin, SLIDE_H - 530, 220)

    rule_y = SLIDE_H - 580
    rule_w = 1100
    rule_mid = margin + rule_w / 2
    c.setStrokeColor(Color(*CREAM.rgb(), alpha=0.85))
    c.setLineWidth(0.9)
    c.line(margin, rule_y, rule_mid - 12, rule_y)
    c.line(rule_mid + 12, rule_y, margin + rule_w, rule_y)
    diamond(c, rule_mid, rule_y, 8)

    tagline(SLIDE_H - 660)

    tracked_caps(c, margin, 200, PLATFORM_STRIP,
                 SANS, 14, SAND_MUTED, tracking=0.22)
    slide_chrome(1)

    # ─────────────────────────────────────────────────────────────────
    # 2 · Problem — broader, names mix / master / producer pain.
    # ─────────────────────────────────────────────────────────────────
    c.showPage(); fill_bg(c, SLIDE_W, SLIDE_H)
    tracked_caps(c, margin, SLIDE_H - 200, 'THE FRICTION POINTS',
                 SANS, 14, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF_ITALIC, 60)
    headlines = [
        "Your mix translates differently on every system.",
        "Your master goes 6 dB quieter once Spotify is done with it.",
        "Your bounce has a 6 kHz tone you didn't notice until a producer flagged it.",
        "Your delivery gets cancelled because of a comma in a track title.",
        "",
        "Nobody tells you why until the email arrives at midnight.",
    ]
    y = SLIDE_H - 320
    for line in headlines:
        if line == '':
            y -= 50
            continue
        c.drawString(margin, y, line)
        y -= 90
    slide_chrome(2)

    # ─────────────────────────────────────────────────────────────────
    # 3 · Positioning — three doors in.
    # ─────────────────────────────────────────────────────────────────
    c.showPage(); fill_bg(c, SLIDE_W, SLIDE_H)
    tracked_caps(c, margin, SLIDE_H - 200, 'WHAT IT IS',
                 SANS, 14, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF, 100)
    c.drawString(margin, SLIDE_H - 340, 'A desktop tool')
    c.drawString(margin, SLIDE_H - 460, 'for engineers and producers')
    c.drawString(margin, SLIDE_H - 580, 'who care what the platforms do')
    c.drawString(margin, SLIDE_H - 700, 'to their work.')
    gold_rule(c, margin, SLIDE_H - 740, 320, weight=0.9)
    c.setFillColor(SAND_SECONDARY); c.setFont(SERIF_ITALIC, 30)
    c.drawString(margin, SLIDE_H - 800,
                 'Mixing engineers comparing revisions. Mastering engineers shipping deliveries.')
    c.drawString(margin, SLIDE_H - 850,
                 'Producers checking bounces. Same tool, three doors in.')
    slide_chrome(3)

    # ─────────────────────────────────────────────────────────────────
    # 4 · The breadth — what the app actually does. Three-column scan.
    # ─────────────────────────────────────────────────────────────────
    c.showPage(); fill_bg(c, SLIDE_W, SLIDE_H)
    tracked_caps(c, margin, SLIDE_H - 200, 'WHAT RTMCOMPARE ACTUALLY DOES',
                 SANS, 14, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF_ITALIC, 56)
    c.drawString(margin, SLIDE_H - 290,
                 'Ten surfaces. One file or two or a folder.')

    # Three columns, each with a short heading and a bullet list
    col_w = (SLIDE_W - 2 * margin - 80) / 3
    col_x = [margin, margin + col_w + 40, margin + 2 * (col_w + 40)]
    col_y_top = SLIDE_H - 420

    columns = [
        ('COMPARE TWO FILES', [
            'Level-matched playback to −18 LUFS',
            'Per-band masking via BS-RoFormer 4-stem',
            'Phase correlation per band + over time',
            'Vectorscope with peak-hold',
            'Inter-sample peak meter (4× oversampled, BS.1770-4)',
            'Streaming-normalisation preview · 7 platforms',
            'Engineer-profile match · concrete EQ moves',
            'Apply-and-bounce a corrected master',
        ]),
        ('QC ONE FILE', [
            'FLOW v2 click + glitch timeline · drum-friendly',
            'Distortion: clipping, ISR, harmonic',
            'Mains hum + 3rd / 5th / 7th harmonics',
            'Tape transfer artefacts: wow, flutter, drift',
            'Generation-loss detection (lossy ancestors)',
            'Key, BPM, harmonic ladder',
            'Mono-compat waterfall · per band, not scalar',
            'Stereo image + per-band phase',
        ]),
        ('SHIP A FOLDER', [
            'Sortable batch table · LUFS, TP, LRA, ISRC',
            'Cohort heatmap · per-track 31-band drift',
            '.rtmalbum.json sessions · re-open in a year',
            'Delivery Manifest 3-way diff',
            'Atmos Preflight · object count, LFE, layout',
            'Per-object anomaly detection',
            'Ship-Ready PDF + Corrected CSV exports',
            'Translation Check · phone, earbuds, club, car',
        ]),
    ]
    for i, (heading, items) in enumerate(columns):
        x = col_x[i]
        tracked_caps(c, x, col_y_top, heading, SANS, 13, GOLD if i == 0 else SAND_MUTED,
                     tracking=0.20)
        gold_rule(c, x, col_y_top - 18, 60) if i == 0 else thin_rule(
            c, x, col_y_top - 18, 60, color=SAND_DIM, opacity=0.35)
        ix_y = col_y_top - 60
        c.setFillColor(SAND_SECONDARY); c.setFont(SANS, 17)
        for item in items:
            c.drawString(x, ix_y, item)
            ix_y -= 36
    slide_chrome(4)

    # ─────────────────────────────────────────────────────────────────
    # 5 · A/B Compare — fixed layout, file labels above the value
    #     so the bottom italic line doesn't collide.
    # ─────────────────────────────────────────────────────────────────
    c.showPage(); fill_bg(c, SLIDE_W, SLIDE_H)
    tracked_caps(c, margin, SLIDE_H - 200, 'A/B COMPARE · LEVEL-MATCHED',
                 SANS, 14, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF, 56)
    c.drawString(margin, SLIDE_H - 270,
                 'Both files normalised to −18 LUFS before audition.')

    col_w = (SLIDE_W - 2 * margin - 80) / 2
    col_y = SLIDE_H - 460

    # A column — labels stacked above the big number
    tracked_caps(c, margin, col_y, 'A · REFERENCE', SANS, 14, SAND_MUTED, tracking=0.20)
    c.setFillColor(SAND_MUTED); c.setFont(MONO, 22)
    c.drawString(margin, col_y - 36, 'reference.wav')
    c.setFillColor(CREAM); c.setFont(SERIF, 220)
    c.drawString(margin, col_y - 280, '−9.9')
    c.setFillColor(SAND_MUTED); c.setFont(SERIF, 36)
    c.drawString(margin + 380, col_y - 280, 'LUFS')

    # vertical divider
    c.setStrokeColor(Color(*SAND_DIM.rgb(), alpha=0.4))
    c.setLineWidth(0.5)
    c.line(margin + col_w + 40, col_y + 30, margin + col_w + 40, col_y - 320)

    # B column — gold rule, same stacked layout
    bx = margin + col_w + 80
    tracked_caps(c, bx, col_y, 'B · YOUR MIX', SANS, 14, SAND_MUTED, tracking=0.20)
    c.setFillColor(SAND_MUTED); c.setFont(MONO, 22)
    c.drawString(bx, col_y - 36, 'rev_4_final_v2.wav')
    c.setFillColor(CREAM); c.setFont(SERIF, 220)
    c.drawString(bx, col_y - 280, '−7.1')
    c.setFillColor(SAND_MUTED); c.setFont(SERIF, 36)
    c.drawString(bx + 380, col_y - 280, 'LUFS')
    gold_rule(c, bx, col_y - 296, 280)

    # Italic kicker — moved well below the columns to avoid collision
    c.setFillColor(SAND_SECONDARY); c.setFont(SERIF_ITALIC, 36)
    c.drawString(margin, 220,
                 'B is 2.8 LU louder. Levels matched, the panels show what changed besides volume.')
    slide_chrome(5)

    # ─────────────────────────────────────────────────────────────────
    # 6 · Per-band masking spotlight — what makes Compare different
    #     from a meter. AI stem separation as the differentiator.
    # ─────────────────────────────────────────────────────────────────
    c.showPage(); fill_bg(c, SLIDE_W, SLIDE_H)
    tracked_caps(c, margin, SLIDE_H - 200, 'WHY THIS ISN\'T JUST ANOTHER METER',
                 SANS, 14, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF_ITALIC, 84)
    c.drawString(margin, SLIDE_H - 320, "Per-band masking via")
    c.drawString(margin, SLIDE_H - 410, "BS-RoFormer 4-stem.")
    gold_rule(c, margin, SLIDE_H - 450, 320)
    text_block(c, margin, SLIDE_H - 530,
               ["BS-RoFormer splits both files into vocals, drums, bass, other —",
                "SDR 9.66, up from ~7.5 with Demucs. RTMcompare measures",
                "per-band energy loss across 31 bands, per stem. So when your",
                "master sums and the vocals lose 3.2 dB at 2 kHz to drum bus",
                "competition, you see exactly that — not just \"the mid is different.\""],
               SANS, 26, SAND_SECONDARY, leading=42)
    c.setFillColor(GOLD); c.setFont(SERIF_ITALIC, 32)
    c.drawString(margin, 240,
                 "The thing other compare tools don't have.")
    slide_chrome(6)

    # ─────────────────────────────────────────────────────────────────
    # 7 · Single-file QC spotlight — clinical pass when no reference.
    # ─────────────────────────────────────────────────────────────────
    c.showPage(); fill_bg(c, SLIDE_W, SLIDE_H)
    tracked_caps(c, margin, SLIDE_H - 200, 'WHEN YOU ONLY HAVE ONE FILE',
                 SANS, 14, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF_ITALIC, 84)
    c.drawString(margin, SLIDE_H - 320, "Drop one file in.")
    c.drawString(margin, SLIDE_H - 410, "We tell you what's wrong.")
    gold_rule(c, margin, SLIDE_H - 450, 320)

    # Two-column body
    qc_left = [
        "Click & glitch timeline",
        "Distortion · clipping, ISR, harmonic",
        "Mains hum + harmonics",
        "Tape artefacts · wow, flutter, drift",
    ]
    qc_right = [
        "Generation-loss · finds lossy ancestors",
        "Key, BPM, harmonic ladder",
        "Mono-compat waterfall · per band",
        "Stereo image + per-band phase",
    ]
    col2_x = margin + 600
    y_start = SLIDE_H - 540
    c.setFillColor(SAND_SECONDARY); c.setFont(SANS, 22)
    for i, item in enumerate(qc_left):
        c.drawString(margin, y_start - i * 50, '·  ' + item)
    for i, item in enumerate(qc_right):
        c.drawString(col2_x, y_start - i * 50, '·  ' + item)
    c.setFillColor(GOLD); c.setFont(SERIF_ITALIC, 30)
    c.drawString(margin, 240,
                 "For when there's no reference, only the file and a deadline.")
    slide_chrome(7)

    # ─────────────────────────────────────────────────────────────────
    # 8 · Engineer-profile matching — RTMprofile + apply-and-bounce
    # ─────────────────────────────────────────────────────────────────
    c.showPage(); fill_bg(c, SLIDE_W, SLIDE_H)
    tracked_caps(c, margin, SLIDE_H - 200, 'PROFILE MATCHING',
                 SANS, 14, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF_ITALIC, 84)
    c.drawString(margin, SLIDE_H - 320, "Match against an engineer.")
    c.drawString(margin, SLIDE_H - 410, "Or yourself.")
    gold_rule(c, margin, SLIDE_H - 450, 320)
    text_block(c, margin, SLIDE_H - 530,
               ["Bundled profiles: Serban Ghenea, Chris Lord-Alge,",
                "Tom Coyne, Bob Ludwig. Or build your own with RTMprofile",
                "from 5+ of your finished masters.",
                "",
                "RTMcompare returns a match-score plus concrete EQ moves —",
                "frequency, gain, Q. Apply-and-bounce produces the corrected",
                "master in one click. No re-do."],
               SANS, 26, SAND_SECONDARY, leading=42)
    slide_chrome(8)

    # ─────────────────────────────────────────────────────────────────
    # 9 · Specialty surfaces — DMR + Atmos, both compressed.
    # ─────────────────────────────────────────────────────────────────
    c.showPage(); fill_bg(c, SLIDE_W, SLIDE_H)
    tracked_caps(c, margin, SLIDE_H - 200, 'SPECIALTY SURFACES',
                 SANS, 14, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF_ITALIC, 60)
    c.drawString(margin, SLIDE_H - 290,
                 'Two surfaces you only use if they\'re for you.')

    # DMR side
    c.setFillColor(CREAM); c.setFont(SERIF_ITALIC, 56)
    c.drawString(margin, SLIDE_H - 410, "Delivery Manifest")
    text_block(c, margin, SLIDE_H - 470,
               ["Apple cancels deliveries on punctuation. Spotify rejects",
                "duplicate ISRCs without warning. DMR three-way-diffs your",
                "audio, the manifest, and the album's ISRC set. Catches",
                "every reason a release gets bounced. Exports Ship-Ready",
                "PDF + Corrected CSV the distributor can re-ingest.",
                "",
                "For label ops."],
               SANS, 18, SAND_SECONDARY, leading=28)

    # Atmos side
    atmos_x = margin + 950
    c.setFillColor(CREAM); c.setFont(SERIF_ITALIC, 56)
    c.drawString(atmos_x, SLIDE_H - 410, "Dolby Atmos")
    text_block(c, atmos_x, SLIDE_H - 470,
               ["ADM BWF native. Bed and objects parsed, binaural-",
                "headroom estimated (ILD downmix), stereo downmix QC'd",
                "against the immersive master.",
                "Atmos Preflight runs Apple's hard-checks (object count ≤ 118,",
                "LFE routing, bed layout, SR = 48 kHz). Per-object anomaly",
                "detection flags hot, silent, static, dark objects.",
                "",
                "For immersive mix supervisors."],
               SANS, 18, SAND_SECONDARY, leading=28)
    slide_chrome(9)

    # ─────────────────────────────────────────────────────────────────
    # 10 · Companion apps — RTMprofile + RTMsend, two paragraphs.
    # ─────────────────────────────────────────────────────────────────
    c.showPage(); fill_bg(c, SLIDE_W, SLIDE_H)
    tracked_caps(c, margin, SLIDE_H - 200, 'TWO COMPANION APPS',
                 SANS, 14, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF_ITALIC, 84)
    c.drawString(margin, SLIDE_H - 360, 'RTMprofile')
    text_block(c, margin, SLIDE_H - 420,
               ['Feed it 5+ finished masters. It learns your sound and saves a',
                "fingerprint that loads into RTMcompare's Match tab. Or grade",
                "any new mix against an engineer profile already on disk."],
               SANS, 24, SAND_SECONDARY, leading=38)

    c.setFillColor(CREAM); c.setFont(SERIF_ITALIC, 84)
    c.drawString(margin, SLIDE_H - 640, 'RTMsend')
    text_block(c, margin, SLIDE_H - 700,
               ['VST3 / AU plugin. Sits on a bus in Wavelab, Logic, Pro Tools,',
                'Studio One. One button sends the buffer to RTMcompare\'s Single,',
                'Compare-B, or Album surface. ARA-aware on hosts that support it.'],
               SANS, 24, SAND_SECONDARY, leading=38)
    slide_chrome(10)

    # ─────────────────────────────────────────────────────────────────
    # 11 · Closing — privacy + tagline echo + platform strip
    # ─────────────────────────────────────────────────────────────────
    c.showPage(); fill_bg(c, SLIDE_W, SLIDE_H)
    tracked_caps(c, margin, SLIDE_H - 200, 'YOUR FILES STAY ON YOUR MACHINE',
                 SANS, 14, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF_ITALIC, 50)
    c.drawString(margin, SLIDE_H - 290, "Local-first. No cloud round-trip.")

    wordmark(c, margin, SLIDE_H - 510, 180)

    rule_y = SLIDE_H - 560
    rule_w = 1100
    rule_mid = margin + rule_w / 2
    c.setStrokeColor(Color(*CREAM.rgb(), alpha=0.85))
    c.setLineWidth(0.9)
    c.line(margin, rule_y, rule_mid - 12, rule_y)
    c.line(rule_mid + 12, rule_y, margin + rule_w, rule_y)
    diamond(c, rule_mid, rule_y, 8)

    tagline(SLIDE_H - 640, size=50)

    tracked_caps(c, margin, 240, PLATFORM_STRIP + ' · 5.5',
                 SANS, 16, SAND_MUTED, tracking=0.22)
    slide_chrome(11)

    c.save()
    print(f'  → {Path(path).name}')


# ──────────────────────────────────────────────────────────────────────
#  CHANGELOG
# ──────────────────────────────────────────────────────────────────────
def build_changelog(path):
    c = canvas.Canvas(str(path), pagesize=(LETTER_W, LETTER_H))
    c.setTitle('RTMcompare — Changelog')
    c.setAuthor('Ohad Nissim')
    c.setSubject('RTMcompare 5.5 changelog')

    margin = 60.0
    body_w = LETTER_W - 2 * margin

    def new_page():
        c.showPage()
        fill_bg(c, LETTER_W, LETTER_H)
        corner_ticks(c, LETTER_W, LETTER_H)
        colophon(c, LETTER_W, 28, ['RTMcompare', 'v5.5', 'Changelog', 'Local-first'])

    def section_heading(eyebrow, title, standfirst=None, y=LETTER_H - 110):
        tracked_caps(c, margin, y, eyebrow, SANS, 8, SAND_MUTED, tracking=0.22)
        c.setFillColor(CREAM); c.setFont(SERIF, 32)
        c.drawString(margin, y - 50, title)
        gold_rule(c, margin, y - 68, 110)
        if standfirst:
            c.setFillColor(SAND_SECONDARY); c.setFont(SERIF_ITALIC, 14)
            words = standfirst.split()
            line, line_y = '', y - 96
            for w in words:
                trial = (line + ' ' + w).strip()
                if c.stringWidth(trial, SERIF_ITALIC, 14) > body_w:
                    c.drawString(margin, line_y, line)
                    line, line_y = w, line_y - 22
                else:
                    line = trial
            if line:
                c.drawString(margin, line_y, line)
            return line_y - 40
        return y - 130

    def change_row(y, label, blurb):
        c.setFillColor(CREAM); c.setFont(SANS_BOLD, 10.5)
        c.drawString(margin, y, label)
        c.setFillColor(SAND_SECONDARY); c.setFont(SANS, 10)
        words = blurb.split()
        line, line_y = '', y - 16
        for w in words:
            trial = (line + ' ' + w).strip()
            if c.stringWidth(trial, SANS, 10) > body_w:
                c.drawString(margin, line_y, line)
                line, line_y = w, line_y - 14
            else:
                line = trial
        if line:
            c.drawString(margin, line_y, line)
        thin_rule(c, margin, line_y - 10, body_w, color=SAND_DIM, opacity=0.16)
        return line_y - 28

    # ── Cover ──
    fill_bg(c, LETTER_W, LETTER_H)
    corner_ticks(c, LETTER_W, LETTER_H)
    tracked_caps(c, margin, LETTER_H - 110, 'A CHANGELOG · EDITION 5.5',
                 SANS, 8.5, SAND_MUTED, tracking=0.22)
    wordmark(c, margin, LETTER_H - 240, 84)

    rule_y = LETTER_H - 268
    rule_x_end = margin + body_w * 0.46
    rule_mid = (margin + rule_x_end) / 2
    c.setStrokeColor(Color(*CREAM.rgb(), alpha=0.85))
    c.setLineWidth(0.6)
    c.line(margin, rule_y, rule_mid - 6, rule_y)
    c.line(rule_mid + 6, rule_y, rule_x_end, rule_y)
    diamond(c, rule_mid, rule_y, 4)

    c.setFillColor(SAND_SECONDARY); c.setFont(SERIF_ITALIC, 22)
    c.drawString(margin, LETTER_H - 320, 'Every change worth telling you about.')
    c.setFillColor(GOLD); c.setFont(SERIF_ITALIC, 22)
    c.drawString(margin, LETTER_H - 352, 'Newest')
    c.setFillColor(SAND_SECONDARY)
    nw = c.stringWidth('Newest', SERIF_ITALIC, 22)
    c.drawString(margin + nw + 8, LETTER_H - 352, 'first.')

    text_block(c, margin, LETTER_H - 450,
               ["This is the receipt. Not a press release — the actual list of",
                "what changed and why. If you skipped a few releases and want",
                "to know what's different now, start here.",
                "",
                "5.5.0 is the big one: a fresh coat of paint on the UI, a",
                "rewritten click detector, a state-of-the-art stem separator,",
                "and one big subtraction (the AI panel)."],
               SANS, 11.5, SAND_SECONDARY, leading=18)

    colophon(c, LETTER_W, 60, ['RTMcompare', 'v5.5.2', 'Changelog', 'May 2026'])

    # ── 5.5.2 — Solo-in-place ──
    new_page()
    y = section_heading('5.5.2 — TUNED UP', 'Solo-in-place on EQ Preview.',
                        'A small new control on every band row. Click S to solo that band — the others stay in the chain at 0 dB.')
    text_block(c, margin, y,
               ["Each band on the EQ Preview now has a tiny `S` toggle to its",
                "right. Click it and only that band contributes gain; every",
                "other band stays in the biquad chain at 0 dB so the chain",
                "length, the Qs, and the frequency positions are preserved.",
                "That's the \"in place\" part — the band keeps its slot.",
                "",
                "Click S again on the same row, click S on a different row, or",
                "press `Esc` from anywhere on the panel to clear.",
                "",
                "Useful when you're trying to hear what one specific EQ move",
                "is doing without the others colouring the result."],
               SANS, 11.5, SAND_SECONDARY, leading=18)

    # ── 5.5.1 — point fix ──
    new_page()
    y = section_heading('5.5.1 — POINT FIX', 'The "?" button works now.',
                        'A one-liner shipped on top of 5.5.0 to fix the click route on the new shortcut-help button.')
    text_block(c, margin, y,
               ["The `?` button in the header dispatched a custom event",
                "(`rtm-toggle-shortcuts`) that nothing was listening for, so",
                "clicking it did nothing. Pressing the `?` key still toggled",
                "the shortcuts panel correctly — only the click route was broken.",
                "",
                "ShortcutHelp.tsx now subscribes to the custom event in addition",
                "to its keyboard handler. Both routes work.",
                "",
                "If you're on 5.5.0 and only ever press `?` instead of clicking,",
                "you don't need this update."],
               SANS, 11.5, SAND_SECONDARY, leading=18)

    # ── 5.5.0 — Design bump ──
    new_page()
    y = section_heading('5.5.0 — RELEASE NOTES', 'Design bump.',
                        'A hard look at the UI. The bits that got in your way are gone.')
    rows = [
        ('Reference history dropdown',
         'Starred refs and recent picks live in a compact menu on the main page instead of a wall of names. Click, scroll, pick, go.'),
        ('"+ New analysis" in the header',
         'Reset and start fresh from anywhere — no more hunting through the menu.'),
        ('Search palette (⌘K)',
         'Jump to anything, fast. New header button to summon it.'),
        ('Keyboard-shortcut sheet (?)',
         'All the hotkeys, one tap away. Header button.'),
        ('"Level matched" pill on EQ Preview',
         'A/B-ing the EQ tweak with and without level-matching used to take three clicks. Now it\'s one. Pill on the panel, not buried in a gear-icon menu.'),
        ('Sticky Advanced QC',
         'Open it once, it stays open across sessions. No more re-toggling every time you launch the app.'),
        ('Quieter single-file & folder scans',
         'Removed the Ceiling and ADM warnings that fired on every non-Atmos file — they were noise, not signal.'),
    ]
    for label, blurb in rows:
        y = change_row(y, label, blurb)

    # ── 5.5.0 — Click detector ──
    new_page()
    y = section_heading('5.5.0 — UNDER THE HOOD', 'Click & glitch detector — drum-friendly.',
                        'The v1 click detector flagged every snare hit. Replaced it with FLOW v2 (LPC residual, Godsill & Rayner 1998).')
    rows = [
        ('No more drum false positives',
         'Tuned to FLOW\'s strict production default (sensitivity 1.0, K = max(6, 12/sens) = 12). The drums you put there on purpose stay un-flagged.'),
        ('Better severity ranking',
         'The top-20 list now sorts by severity then ratio, so the worst offenders surface first.'),
        ('Cleaner deduplication',
         'Removed the redundant 80 ms double-dedupe that was hiding adjacent real clicks.'),
    ]
    for label, blurb in rows:
        y = change_row(y, label, blurb)

    # ── 5.5.0 — Stem separator ──
    new_page()
    y = section_heading('5.5.0 — UNDER THE HOOD', 'Stem separator — BS-RoFormer.',
                        'Quiet but big. The Demucs-only separator from earlier 5.x has been replaced with BS-RoFormer 4-stem.')
    rows = [
        ('SDR 9.66 on MUSDB18HQ',
         'Up from ~7.5 with Demucs. Cleaner stems = more reliable downstream analysis (Match tab, EQ Preview level-match, masking).'),
        ('Auto-falls-back to Demucs',
         'If BS-RoFormer can\'t load on a given machine, the pipeline drops back to Demucs. Older bundles and edge cases keep working.'),
    ]
    for label, blurb in rows:
        y = change_row(y, label, blurb)

    # ── 5.5.0 — AI removal ──
    new_page()
    y = section_heading('5.5.0 — REMOVED', 'AI detection.',
                        'We were going to ship UAI\'s 24-detector calibrated ensemble (F1 0.998 on Lambda validation). It works beautifully — but we pulled it.')
    text_block(c, margin, y,
               ["The full strict engine would have added ~1.1 GB of model weights",
                "to the bundle (BS-RoFormer ckpt + CLAP audio embeddings + ONNX",
                "detectors + calibration heads) for one optional feature most",
                "engineers don't act on day-to-day. The math:",
                "",
                "  • CLAP weights — 589 MB",
                "  • UAI ONNX detectors — 46 MB",
                "  • BS-RoFormer ckpt (also used by separator) — 503 MB",
                "  • Calibration heads — < 1 MB",
                "",
                "We're keeping BS-RoFormer (it powers stem separation everywhere",
                "in the app) and dropping the rest. The bundle gets ~840 MB",
                "lighter. May revisit AI detection as a separate opt-in download.",
                "",
                "If you relied on the AI panel, sit on 5.4.0 for now or shout."],
               SANS, 11.5, SAND_SECONDARY, leading=18)

    # ── 5.5.0 — Build & deploy ──
    new_page()
    y = section_heading('5.5.0 — BUILD & DEPLOY', 'Smaller, cleaner bundle.',
                        'The Mac DMG drops nearly a gigabyte. The Windows zip finally ships with the separator weights it was missing in 5.4.0.')
    rows = [
        ('Mac DMG: −836 MB',
         'python-bundle dropped 200 MB (xgboost / transformers / huggingface_hub / libomp out). model-cache dropped 636 MB (CLAP + UAI ONNX + calibration heads out).'),
        ('Windows zip — finally complete',
         '5.4.0\'s Win bundle silently shipped without the BS-RoFormer ckpt — stem separation didn\'t work at all on Windows. The Win CI now pre-downloads the 503 MB ckpt + yaml into model-cache before electron-builder runs.'),
        ('Win CI cache key v3-uai → v5-stems-only',
         'Forces a clean rebuild without the AI deps. Saves ~3 min on cache hits going forward.'),
        ('RTMprofile production model-cache discovery',
         'Standalone RTMprofile.app now walks up the bundle to find model-cache/ correctly — no more "model not found" on first launch from /Applications.'),
        ('24 audit fixes',
         'Mostly cosmetics, a couple of real wiring bugs caught during the pre-flight pass.'),
    ]
    for label, blurb in rows:
        y = change_row(y, label, blurb)

    # ── Older versions ──
    new_page()
    y = section_heading('OLDER RELEASES', 'How we got here.',
                        'The shorter version of every release before this one.')
    rows = [
        ('5.4.0', 'UAI integration kickoff. BS-RoFormer 4-stem + 24-detector ensemble landed, but shipped without the strict engine deps so the panel ran in validation mode in production. Click detector v2 first cut. 24 audit fixes.'),
        ('5.3.0', 'Vendored the UAI detector runtime (modspec, lofcz, CNN, AST). First pass at the calibrated ensemble. Mac signing/notarization automation.'),
        ('5.2.x', 'Windows bundle reached parity with Mac (added librosa/numba/demucs/julius/openunmix). Atmos pipeline polish. Pitch deck refresh.'),
        ('5.1.x', 'First Windows release. EBU R128 fixes. Album batch view.'),
        ('5.0.x', 'Initial 5.x line — A/B compare, single-file QC, Atmos, the whole bundle structure.'),
    ]
    for label, blurb in rows:
        y = change_row(y, label, blurb)

    c.save()
    print(f'  → {path}')


# ──────────────────────────────────────────────────────────────────────
#  Driver
# ──────────────────────────────────────────────────────────────────────
def main():
    # 5.5.x: route output to the canonical release/v5.5.0/ folder so
    # build_suite_dmg.sh + the Win CI doc-copy step pick the new-look
    # PDFs up directly. Names match what those scripts already expect.
    # Point fixes (5.5.1+) refresh in place — fonts + heroes are shared.
    out = REPO_ROOT / 'release' / 'v5.5.0'
    out.mkdir(parents=True, exist_ok=True)
    print(f'Generating Console Didone PDFs (5.5 voice) into {out}/')
    build_manual(out / 'MANUAL.pdf')
    build_features(out / 'FEATURES.pdf')
    build_pitch(out / 'PITCH-DECK.pdf')
    build_changelog(out / 'CHANGELOG.pdf')
    # Refresh the promo/ copies too so the website + reels stay in sync.
    build_manual(HERE / 'RTMcompare-Manual.pdf')
    build_features(HERE / 'RTMcompare-Features.pdf')
    build_pitch(HERE / 'RTMcompare-Pitch.pdf')
    build_changelog(HERE / 'RTMcompare-Changelog.pdf')
    print('Done.')


if __name__ == '__main__':
    main()
