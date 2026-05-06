#!/usr/bin/env python3
"""Console Didone PDFs — Manual, Features, Pitch.

5.2.4: editorial PDFs aligned with the v5.2 shell aesthetic. Three
documents from one script:
  - RTMcompare-Manual.pdf   (US Letter portrait, ~10 pages)
  - RTMcompare-Features.pdf (US Letter portrait, ~7 pages)
  - RTMcompare-Pitch.pdf    (16:9 landscape, 10 slides)

Run:  python3 promo/generate_pdfs.py
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass

from reportlab.pdfgen import canvas
from reportlab.lib.colors import Color, HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ── Paths ──────────────────────────────────────────────────────────
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
FONT_DIR = os.path.join(REPO_ROOT, 'release', 'v5.3.0', 'fonts')

# ── Console Didone palette ─────────────────────────────────────────
INK            = HexColor('#0e0d0b')
PANEL          = HexColor('#1e1c18')
CREAM          = HexColor('#ebe7e0')
SAND_SECONDARY = HexColor('#d6d1c6')
SAND_MUTED     = HexColor('#8d867b')
SAND_DIM       = HexColor('#6a6459')
GOLD           = HexColor('#d0b066')
WARM_RED       = HexColor('#c96765')

# ── Page sizes (points; 1 pt = 1/72 inch) ──────────────────────────
LETTER_W, LETTER_H = 612.0, 792.0           # US Letter portrait
SLIDE_W,  SLIDE_H  = 1920.0, 1080.0         # 16:9 landscape, oversized for crispness

# ── Font registration ──────────────────────────────────────────────
# Use the TTFs already shipping in release/v5.3.0/fonts/. Fallbacks
# (Helvetica / Times / Courier) are reportlab built-ins; if a TTF is
# missing the script logs and continues with the closest substitute.
def _try_register(name: str, file: str) -> str:
    path = os.path.join(FONT_DIR, file)
    if os.path.exists(path):
        try:
            pdfmetrics.registerFont(TTFont(name, path))
            return name
        except Exception as e:
            print(f'[warn] {name}: {e}', file=sys.stderr)
    return ''


SERIF        = _try_register('InstrumentSerif',        'InstrumentSerif-Regular.ttf') or 'Times-Roman'
SERIF_ITALIC = _try_register('InstrumentSerifItalic',  'InstrumentSerif-Italic.ttf')  or 'Times-Italic'
SANS         = _try_register('InstrumentSans',         'InstrumentSans-Regular.ttf')  or 'Helvetica'
SANS_BOLD    = _try_register('InstrumentSansBold',     'InstrumentSans-Bold.ttf')     or 'Helvetica-Bold'
MONO         = _try_register('GeistMono',              'GeistMono-Regular.ttf')       or 'Courier'

# ── Drawing primitives ─────────────────────────────────────────────
def fill_bg(c: canvas.Canvas, w: float, h: float, color=INK):
    c.setFillColor(color)
    c.rect(0, 0, w, h, fill=1, stroke=0)


def gold_rule(c: canvas.Canvas, x: float, y: float, w: float, weight: float = 0.6):
    """The single chromatic gesture per page. 1px-feel hairline."""
    c.setStrokeColor(GOLD)
    c.setLineWidth(weight)
    c.line(x, y, x + w, y)


def thin_rule(c: canvas.Canvas, x: float, y: float, w: float, color=SAND_DIM,
              opacity: float = 0.30):
    """Sub-opacity hairline — for section dividers within a page."""
    r, g, b, _ = color.rgba()
    c.setStrokeColor(Color(r, g, b, alpha=opacity))
    c.setLineWidth(0.5)
    c.line(x, y, x + w, y)


def tracked_caps(c: canvas.Canvas, x: float, y: float, text: str,
                 font: str, size: float, fill, tracking: float = 0.16):
    """Letter-spaced all-caps. Reportlab has no native tracking, so
    we draw glyph-by-glyph and advance by the measured width plus a
    tracking factor proportional to font size."""
    c.setFillColor(fill)
    c.setFont(font, size)
    cursor = x
    for ch in text.upper():
        c.drawString(cursor, y, ch)
        adv = c.stringWidth(ch, font, size) + size * tracking
        cursor += adv


def text_block(c: canvas.Canvas, x: float, y: float, lines: list[str],
               font: str, size: float, fill, leading: float = None):
    leading = leading if leading is not None else size * 1.45
    c.setFillColor(fill)
    c.setFont(font, size)
    cy = y
    for line in lines:
        c.drawString(x, cy, line)
        cy -= leading
    return cy + leading  # baseline of last line


def colophon(c: canvas.Canvas, w: float, y: float, parts: list[str]):
    """Tracked all-caps centred bottom strip with three centre-dots."""
    text = '   ·   '.join(parts).upper()
    font = SANS
    size = 6.5
    width = c.stringWidth(text, font, size) * 1.18  # +18% for tracking
    cursor = (w - width) / 2.0
    c.setFillColor(SAND_DIM)
    c.setFont(font, size)
    for ch in text:
        c.drawString(cursor, y, ch)
        cursor += c.stringWidth(ch, font, size) + size * 0.18


def wordmark(c: canvas.Canvas, x: float, y: float, size: float, fill=CREAM):
    c.setFillColor(fill)
    c.setFont(SERIF, size)
    c.drawString(x, y, 'RTMcompare')


# ──────────────────────────────────────────────────────────────────────
#  MANUAL
# ──────────────────────────────────────────────────────────────────────
def build_manual(path: str):
    c = canvas.Canvas(path, pagesize=(LETTER_W, LETTER_H))
    c.setTitle('RTMcompare — User Manual')
    c.setAuthor('Ohad Nissim')
    c.setSubject('RTMcompare 5.2 user manual')

    margin = 60.0
    body_w = LETTER_W - 2 * margin

    def new_page():
        c.showPage()
        fill_bg(c, LETTER_W, LETTER_H)
        colophon(c, LETTER_W, 28, ['RTMcompare', 'v5.3.0', 'Manual', 'Internal license'])

    # ── Cover ──
    fill_bg(c, LETTER_W, LETTER_H)
    tracked_caps(c, margin, LETTER_H - 110, 'A USER MANUAL · EDITION 5.2',
                 SANS, 8.5, SAND_MUTED, tracking=0.20)
    wordmark(c, margin, LETTER_H - 230, 78)
    gold_rule(c, margin, LETTER_H - 248, body_w * 0.42)
    c.setFillColor(SAND_SECONDARY)
    c.setFont(SERIF_ITALIC, 18)
    c.drawString(margin, LETTER_H - 290,
                 'Pro mastering tools, minus the wall of jargon.')
    # Body intro
    text_block(c, margin, LETTER_H - 380,
               ['Hi. RTMcompare is the app that tells you what\'s wrong',
                'with your master before your client does — or worse,',
                'before the streaming service does it for you.',
                '',
                'Drop two files. We say what\'s different.',
                'Drop one file. We give it a full check-up.',
                'Drop a folder. We help you ship the album.',
                '',
                'Read this front to back, or skip to the bit you need.',
                'Chapters are short. Nobody asked for a textbook.'],
               SANS, 11.5, SAND_SECONDARY, leading=18)
    colophon(c, LETTER_W, 60, ['RTMcompare', 'v5.3.0', 'Apple Silicon', 'macOS 12+'])

    # ── 1 · Install ──
    new_page()
    tracked_caps(c, margin, LETTER_H - 110, 'CHAPTER ONE', SANS, 8, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF, 36)
    c.drawString(margin, LETTER_H - 160, 'Install and first launch.')
    gold_rule(c, margin, LETTER_H - 180, 110)
    text_block(c, margin, LETTER_H - 230,
               ['1. Open the DMG. Drag RTMcompare into Applications.',
                '2. Right-click → Open the first time. macOS calms down',
                '   after that. (Welcome to Gatekeeper, by the way.)',
                '3. The app opens to a single drop frame. Drag two audio',
                '   files in to start. That\'s the whole onboarding.',
                '',
                'No installer wizard, no license server, no telemetry,',
                'no cloud sign-in. The app phones home exactly zero',
                'times unless you opt in to live DSP delivery status —',
                'and even then it\'s read-only, with your credentials',
                'kept in the macOS Keychain. Your audio stays put.'],
               SANS, 11.5, SAND_SECONDARY, leading=18)
    text_block(c, margin, LETTER_H - 470,
               ['Disk: ~600 MB (app + bundled Python + Demucs cache).',
                'RAM: 8 GB minimum, 16 GB if you do stem separation.',
                'Audio: WAV, FLAC, AIFF, AIF, MP3, OGG, M4A, ADM BWF.'],
               MONO, 9.5, SAND_MUTED, leading=15)

    # ── 2 · Compare two files ──
    new_page()
    tracked_caps(c, margin, LETTER_H - 110, 'CHAPTER TWO', SANS, 8, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF, 36)
    c.drawString(margin, LETTER_H - 160, 'Compare two files.')
    gold_rule(c, margin, LETTER_H - 180, 110)
    text_block(c, margin, LETTER_H - 230,
               ['Compare is the one most people open first. Two files',
                'in, every measurable difference out, in plain English.',
                '',
                'Drag the reference into the left slot. Drag the mix',
                'you\'re working on into the right. Pick a delivery',
                'target from the chips up top — Music, Full Mix,',
                'Broadcast, Netflix, Post. That chip is the gold one;',
                'it tells the whole screen which yardstick to use.',
                '',
                'Click Compare. Both files level-match to −18 LUFS',
                'before you hear them, so a louder master can\'t fool',
                'your ears into thinking it\'s the better one. Analysis',
                'runs locally. Nothing uploads.',
                '',
                'When it lands, the strip across the top shows LUFS,',
                'TP, LRA, MONO with deltas. Each tab opens with a big',
                'headline number — the verdict for that lens — and',
                'then drills in. Click around. It won\'t bite.'],
               SANS, 11.5, SAND_SECONDARY, leading=18)

    # ── 3 · Single-file QC ──
    new_page()
    tracked_caps(c, margin, LETTER_H - 110, 'CHAPTER THREE', SANS, 8, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF, 36)
    c.drawString(margin, LETTER_H - 160, 'QC a single master.')
    gold_rule(c, margin, LETTER_H - 180, 110)
    text_block(c, margin, LETTER_H - 230,
               ['No reference? No problem. Drop one file in and hit',
                'Analyze Reference Only. The app reads it like a tech',
                'doing a thorough service appointment.',
                '',
                'Clicks and glitches plotted on a clickable timeline —',
                'tap any peak and playback jumps right to it. Distortion',
                '(clipping, inter-sample, harmonic) with the offending',
                'band named, not just a red blob. Mains hum at 50 or',
                '60 Hz plus harmonics, so a ground loop shows up at',
                'a glance. Limiter artefacts — pumping, intermodulation,',
                'stuck-fast release — flagged with a severity rating.',
                '',
                'Then the analog-tape rogue\'s gallery: wow, flutter,',
                'DC drift, tape transport rumble, print-through. And',
                'generation loss — the fingerprints of an MP3 or AAC',
                'encode hiding inside what someone called the original.',
                '',
                'Plus key, BPM, harmonic ladder. Mono fold per band',
                '(see exactly where the kick or vocal disappears),',
                'stereo image, and per-band phase. Everything you\'d',
                'normally check across four plug-ins, on one page.'],
               SANS, 11.5, SAND_SECONDARY, leading=18)

    # ── 4 · Album batch ──
    new_page()
    tracked_caps(c, margin, LETTER_H - 110, 'CHAPTER FOUR', SANS, 8, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF, 36)
    c.drawString(margin, LETTER_H - 160, 'Walk an album.')
    gold_rule(c, margin, LETTER_H - 180, 110)
    text_block(c, margin, LETTER_H - 230,
               ['Drop a folder. RTMcompare opens every audio file',
                'inside and gives you a sortable table — LUFS, TP, LRA,',
                'ISRC, duration, sample rate, bit depth — with outliers',
                'highlighted automatically. The whole album at a glance.',
                '',
                'Click any row to open that song in a tab. ← → flips',
                'between tracks. Deep analysis runs once per song and',
                'caches after, so flipping back is instant.',
                '',
                'Cohort Mode is the sneaky-good one. Pick any track',
                '(or an external file) as the reference, and the app',
                'shows a per-band heatmap of how far each song drifts',
                'from it. Sort by drift, find the outlier, fix it.',
                'Album consistency, solved.',
                '',
                'Save the whole session as a .rtmalbum.json — every',
                'analysis, every note, the references, the delivery',
                'state. Re-open it in a year, pick up where you left',
                'off. (Or hand it to the next engineer. They\'ll',
                'thank you.)'],
               SANS, 11.5, SAND_SECONDARY, leading=18)

    # ── 5 · Atmos ──
    # (Delivery Manifest Reconciler chapter removed in 5.3.0 — that
    # surface isn't in the renderer right now and shipping a manual
    # that documents missing features causes more support pain than
    # any time it saved. Coming back as its own surface in a future
    # release; no chapter pretends to ship it in the interim.)
    new_page()
    tracked_caps(c, margin, LETTER_H - 110, 'CHAPTER FIVE', SANS, 8, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF, 36)
    c.drawString(margin, LETTER_H - 160, 'Immersive and Dolby Atmos.')
    gold_rule(c, margin, LETTER_H - 180, 110)
    text_block(c, margin, LETTER_H - 230,
               ['Drop an ADM BWF file. RTMcompare reads the bed and',
                'objects, follows the trajectories, meters the binaural',
                'render, and QCs the stereo downmix against the',
                'immersive master. All four jobs, one panel.',
                '',
                'Atmos Preflight runs the hard checks Apple actually',
                'enforces: objects ≤ 118, LFE has to route, bed layout',
                '7.1.2 or 5.1.4, sample rate 48 kHz, bit depth at least',
                '24. Anything that fails gates the export. Better to',
                'find it here than in the rejection email.',
                '',
                'Per-object anomaly detection flags hot, silent, static,',
                'or dark objects — usually a mix mistake, not an',
                'artistic choice. The flag points at the channel; the',
                'engineer makes the call.'],
               SANS, 11.5, SAND_SECONDARY, leading=18)

    # ── 6 · Companions ──
    new_page()
    tracked_caps(c, margin, LETTER_H - 110, 'CHAPTER SIX', SANS, 8, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF, 36)
    c.drawString(margin, LETTER_H - 160, 'Companion tools.')
    gold_rule(c, margin, LETTER_H - 180, 110)
    c.setFillColor(CREAM); c.setFont(SERIF_ITALIC, 22)
    c.drawString(margin, LETTER_H - 230, 'RTMprofile')
    text_block(c, margin, LETTER_H - 260,
               ['Feed it 5+ of your finished masters. RTMprofile learns',
                'the spectral and dynamic shape of your sound — bass',
                'weight, midrange tilt, top air, dynamic range, the lot.',
                'It saves the result as a JSON profile that drops into',
                'RTMcompare\'s Match tab. Now any new mix can be graded',
                'against your own catalogue, with concrete EQ moves to',
                'close the gap. Your sound, made portable.'],
               SANS, 11.5, SAND_SECONDARY, leading=18)
    c.setFillColor(CREAM); c.setFont(SERIF_ITALIC, 22)
    c.drawString(margin, LETTER_H - 430, 'RTMsend')
    text_block(c, margin, LETTER_H - 460,
               ['VST3 / AU plugin. Sits on a bus in Wavelab, Logic,',
                'Pro Tools, Studio One — anything that hosts AU or',
                'VST3. One button sends what\'s playing into',
                'RTMcompare\'s Single, Compare-B, or Album surface.',
                'No export dialog. No render queue. ARA-aware where',
                'the host supports it; rolling last-N-seconds ring',
                'buffer everywhere else.'],
               SANS, 11.5, SAND_SECONDARY, leading=18)

    # ── 8 · Reference ──
    new_page()
    tracked_caps(c, margin, LETTER_H - 110, 'REFERENCE', SANS, 8, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF, 36)
    c.drawString(margin, LETTER_H - 160, 'Keyboard shortcuts.')
    gold_rule(c, margin, LETTER_H - 180, 110)
    shortcuts = [
        ('Space',          'Play / pause the active transport'),
        ('A · B · X',      'Switch A · Switch B · Flip (ABPlayer)'),
        ('← · →',          'Previous / next song (song tab)'),
        ('1–9',            'Jump to tab N (Compare view)'),
        ('M',              'Mono listen mode (ABPlayer)'),
        ('S',              'Solo each side (ABPlayer)'),
        ('L',              'Toggle loop'),
        ('⌘K · /',         'Command palette · Song quick-switch · Search'),
        ('⌘E · ⌘⇧E',       'Export EQ (FFP) · Apply EQ + bounce'),
        ('?',              'Keyboard-shortcut legend'),
        ('⌘N',             'New comparison (results screens)'),
    ]
    y_row = LETTER_H - 230
    for keys, action in shortcuts:
        c.setFillColor(CREAM); c.setFont(MONO, 10)
        c.drawString(margin, y_row, keys)
        c.setFillColor(SAND_SECONDARY); c.setFont(SANS, 10.5)
        c.drawString(margin + 130, y_row, action)
        thin_rule(c, margin, y_row - 6, body_w, color=SAND_DIM, opacity=0.18)
        y_row -= 26

    c.setFillColor(CREAM); c.setFont(SERIF, 22)
    c.drawString(margin, y_row - 30, 'Privacy.')
    text_block(c, margin, y_row - 60,
               ['Every analysis, every render, every metadata read —',
                'all on this device. Audio never leaves. The only',
                'network path the app opens is opt-in DSP delivery',
                'status: outbound, read-only, with credentials kept',
                'in the macOS Keychain via safeStorage. That\'s it.'],
               SANS, 10.5, SAND_SECONDARY, leading=16)

    c.save()
    print(f'  → {os.path.basename(path)}')


# ──────────────────────────────────────────────────────────────────────
#  FEATURES
# ──────────────────────────────────────────────────────────────────────
def build_features(path: str):
    c = canvas.Canvas(path, pagesize=(LETTER_W, LETTER_H))
    c.setTitle('RTMcompare — Features')
    c.setAuthor('Ohad Nissim')
    c.setSubject('RTMcompare 5.2 feature reference')

    margin = 60.0
    body_w = LETTER_W - 2 * margin

    def new_page():
        c.showPage()
        fill_bg(c, LETTER_W, LETTER_H)
        colophon(c, LETTER_W, 28, ['RTMcompare', 'v5.3.0', 'Features', 'Internal license'])

    def section_heading(c, eyebrow, title, sub=None, y=LETTER_H - 110):
        tracked_caps(c, margin, y, eyebrow, SANS, 8, SAND_MUTED, tracking=0.22)
        c.setFillColor(CREAM); c.setFont(SERIF, 32)
        c.drawString(margin, y - 50, title)
        gold_rule(c, margin, y - 68, 110)
        if sub:
            c.setFillColor(SAND_SECONDARY); c.setFont(SERIF_ITALIC, 14)
            c.drawString(margin, y - 92, sub)
        return y - 130

    def feature_row(c, y, label, blurb):
        c.setFillColor(CREAM); c.setFont(SANS_BOLD, 10.5)
        c.drawString(margin, y, label)
        c.setFillColor(SAND_SECONDARY); c.setFont(SANS, 10)
        # word-wrap blurb at body width
        max_w = body_w
        words = blurb.split()
        line, line_y = '', y - 16
        for w in words:
            trial = (line + ' ' + w).strip()
            if c.stringWidth(trial, SANS, 10) > max_w:
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
    tracked_caps(c, margin, LETTER_H - 110, 'A FEATURE REFERENCE · 5.2',
                 SANS, 8.5, SAND_MUTED, tracking=0.20)
    wordmark(c, margin, LETTER_H - 230, 78)
    gold_rule(c, margin, LETTER_H - 248, body_w * 0.42)
    c.setFillColor(SAND_SECONDARY); c.setFont(SERIF_ITALIC, 18)
    c.drawString(margin, LETTER_H - 290, 'Nine surfaces. One master volume.')
    text_block(c, margin, LETTER_H - 380,
               ['Every feature in RTMcompare 5.3.0, in plain language.',
                'No marketing rounding-up — if a row is here, the',
                'feature is in the build you can install today.',
                '',
                'Surface by surface. One feature per row. Skim it,',
                'tick the bits you care about, ignore the rest.'],
               SANS, 11.5, SAND_SECONDARY, leading=18)
    colophon(c, LETTER_W, 60, ['RTMcompare', 'v5.3.0', 'Features', '9 surfaces'])

    # ── A/B Compare ──
    new_page()
    y = section_heading(c, 'SURFACE ONE', 'A/B Compare.',
                        'Two files in. Every measurable difference out.')
    rows = [
        ('Level-matched playback', 'Both files normalise to −18 LUFS before you hear them. Loud doesn\'t get to fake good.'),
        ('LUFS-I, TP, LRA, MONO', 'The four numbers every delivery checks. Top of every screen, no digging.'),
        ('Per-band masking', 'Demucs AI splits the stems first, then we show where vocals, drums, bass and the rest lose energy — per band. Whole-mix masking misses the interesting stuff.'),
        ('Phase correlation over time', 'Full-track plot plus a per-band ribbon. Catches phase trouble that one big "+0.92" number sails past.'),
        ('Vectorscope', 'XY mid/side scope with peak-hold. Width and centre-energy at a glance.'),
        ('Streaming-normalisation preview', 'Spotify, Apple, Amazon, Tidal, YouTube — hear what your master sounds like AFTER each platform turns it down.'),
        ('Inter-sample peak meter', 'True-peak with 16× oversampling. Your DAW\'s master meter doesn\'t catch these. We do.'),
        ('AAC encode preview', 'Run your master through Apple\'s actual AAC encoder. Hear the lossy version against the original.'),
        ('Engineer-profile matching', 'Serban Ghenea, Chris Lord-Alge, or your own (built with RTMprofile from your finished work). Match score, plus the exact EQ moves to close the gap.'),
        ('EQ-move export', 'Export to FabFilter Pro-Q, CSV, or JSON. Or skip the EQ entirely — let RTMcompare bounce the corrected master itself in one click.'),
    ]
    for label, blurb in rows:
        y = feature_row(c, y, label, blurb)

    # ── Single-File QC ──
    new_page()
    y = section_heading(c, 'SURFACE TWO', 'Single-File QC.',
                        'Drop one file. Get a thorough check-up.')
    rows = [
        ('Click + glitch timeline', 'Every click and glitch plotted on a timeline. Click any peak — playback jumps right there. Audit a record in minutes.'),
        ('Distortion detection', 'Clipping, inter-sample, harmonic. Each one tagged with severity and the band it lives in. No red blobs.'),
        ('Mains hum + harmonics', '50 or 60 Hz fundamental, plus 3rd, 5th and 7th harmonics. Spots a ground loop in seconds.'),
        ('Limiter artefact detection', 'Pumping, intermodulation, stuck-fast release, pre-ring. Severity-rated. Tells you when the limiter is doing harm, not just work.'),
        ('Transfer-artefact detection', 'Wow, flutter, DC drift, tape transport, print-through. The whole analog-source rogue\'s gallery.'),
        ('Generation-loss detection', 'AAC or MP3 fingerprints hiding inside what someone called "the original." We see them.'),
        ('Key, BPM, harmonic ladder', 'For sync pitching and clean metadata. (No more guessing the BPM yourself.)'),
        ('Dialog gate metering', 'For post-produced and spoken-word masters: dialog presence detection and per-region loudness on the speech bands only.'),
        ('Mono-compat waterfall', 'Per band, not one big number. See exactly where the mono fold falls apart.'),
        ('Stereo image + phase bands', 'Width on one axis, per-band phase on the other. The whole stereo picture, side by side.'),
    ]
    for label, blurb in rows:
        y = feature_row(c, y, label, blurb)

    # ── Album Batch + Cohort ──
    new_page()
    y = section_heading(c, 'SURFACE THREE & FOUR', 'Album Batch + Cohort.',
                        'A folder in. A sortable table out. Drift detection across the album.')
    rows = [
        ('Sortable overview table', 'LUFS, TP, LRA, ISRC, duration, sample rate, bit depth — outliers flagged in red.'),
        ('One rotating song tab', '← → flips songs. Deep analysis runs once per song, then caches. No re-runs.'),
        ('Per-song + album notes', 'Notes embedded in every PDF export. They travel with the album.'),
        ('.rtmalbum.json sessions', 'One file holds every analysis, every note, every reference, the delivery state. Re-open it in a year.'),
        ('Cohort heatmap', '31-band distance per track. Sort by drift, find the song that doesn\'t belong.'),
        ('RMS distance column', 'One ranked number for "how consistent is this album." The honest answer.'),
    ]
    for label, blurb in rows:
        y = feature_row(c, y, label, blurb)

    # ── Atmos ──
    # (Delivery Manifest Reconciler removed in 5.3.0 — that surface
    # isn't currently in the renderer; coming back as its own surface
    # in a future release. No rows here pretend to ship it.)
    new_page()
    y = section_heading(c, 'SURFACE FIVE', 'Atmos and immersive.',
                        'Validates the immersive master before delivery.')
    rows = [
        ('ADM BWF parsing', 'Bed channels, objects, trajectories, layout. All four read.'),
        ('Binaural TP metering', 'Apple\'s Atmos delivery wants < −1 dBTP on the binaural render. We measure it.'),
        ('Atmos Preflight hard-checks', 'Objects ≤ 118, LFE routed, bed layout (7.1.2 or 5.1.4), 48 kHz, ≥ 24-bit. Anything fails, the export gates.'),
        ('Per-object anomaly detection', 'Hot, silent, static, or dark objects. Almost always a mix mistake, not an artistic choice.'),
        ('Stereo downmix QC', 'BS.775 fold-down compared against the immersive master. Catches downmix surprises before the platform does.'),
    ]
    for label, blurb in rows:
        y = feature_row(c, y, label, blurb)

    # ── Quality / Player / Triage / Shell / Companions ──
    new_page()
    y = section_heading(c, 'SURFACE SIX THROUGH NINE', 'Quality, Player, Triage, Shell.',
                        'The verdict surfaces and the visual chrome.')
    rows = [
        ('AI-generation detection', 'Per-stem ML fingerprint detection. Spots AI-generated audio hiding in a mix.'),
        ('Engineer-target curves', 'Match score against the engineer profile you picked.'),
        ('Concrete EQ moves', 'Frequency, gain, Q — for every move. Export, or apply.'),
        ('Apply-and-bounce', 'One click. The corrected WAV lands in your render folder.'),
        ('A/B Player everywhere', 'Same player, same shortcuts on every screen. Space to play, A/B to flip, X to swap.'),
        ('Live TP meter', 'Instant and 2-second peak-hold, right on the transport.'),
        ('Triage Mode (optional)', 'A Ready-to-Deliver verdict, an Attention list, per-platform spec checks. Toggle on when you want it, off when you don\'t.'),
        ('Console Didone Shell (5.2)', 'The new look: two-row header, big Didone numbers, one gold accent per screen.'),
        ('v1 Classic shell', 'Prefer the old look? localStorage[rtm-shell] = v1 brings back the 5.1.x layout, exactly.'),
        ('RTMprofile companion', 'Standalone app. 5+ finished masters in, your engineer profile out.'),
        ('RTMsend companion', 'VST3 / AU plugin. One button from your DAW into RTMcompare. ARA-aware where it counts.'),
    ]
    for label, blurb in rows:
        y = feature_row(c, y, label, blurb)

    # ── Closing ──
    new_page()
    y = section_heading(c, 'COLOPHON', 'Built on.', 'The stack underneath.')
    text_block(c, margin, y - 10,
               ['Electron · React 19 · TypeScript · Tailwind v4 · Vite',
                'Python 3.11 · NumPy · SciPy · librosa · pyloudnorm · Demucs',
                'JUCE 7 (RTMsend) · electron-builder · electron-rebuild'],
               MONO, 10.5, SAND_SECONDARY, leading=20)
    text_block(c, margin, y - 100,
               ['Wordmark and hero numerals set in Instrument Serif.',
                'Body and labels in Instrument Sans. Tabular data in',
                'Geist Mono. Single antique-gold accent reserved for',
                'the active delivery-target chip.'],
               SANS, 11, SAND_SECONDARY, leading=18)

    c.save()
    print(f'  → {os.path.basename(path)}')


# ──────────────────────────────────────────────────────────────────────
#  PITCH DECK
# ──────────────────────────────────────────────────────────────────────
def build_pitch(path: str):
    c = canvas.Canvas(path, pagesize=(SLIDE_W, SLIDE_H))
    c.setTitle('RTMcompare — Pitch')
    c.setAuthor('Ohad Nissim')
    c.setSubject('RTMcompare 5.2 pitch deck')

    margin = 120.0

    def slide_chrome(slide_no: int, slide_total: int):
        # Page-number eyebrow top-right + colophon bottom centre
        tracked_caps(c, SLIDE_W - margin - 80, SLIDE_H - 60,
                     f'{slide_no:02d} / {slide_total:02d}',
                     SANS, 9, SAND_DIM, tracking=0.18)
        colophon(c, SLIDE_W, 50, ['RTMcompare', 'v5.3.0', 'Pitch · 5.2', 'Internal'])

    SLIDE_TOTAL = 10

    # ── 1 · Cover ──
    fill_bg(c, SLIDE_W, SLIDE_H)
    tracked_caps(c, margin, SLIDE_H - 240, 'PRO AUDIO QC, MASTERING-GRADE',
                 SANS, 18, SAND_MUTED, tracking=0.22)
    wordmark(c, margin, SLIDE_H - 530, 220)
    gold_rule(c, margin, SLIDE_H - 565, 1100, weight=0.9)
    c.setFillColor(SAND_SECONDARY); c.setFont(SERIF_ITALIC, 44)
    c.drawString(margin, SLIDE_H - 640,
                 'Pro mastering tools, minus the wall of jargon.')
    tracked_caps(c, margin, 200, 'AVAILABLE FOR macOS · APPLE SILICON',
                 SANS, 14, SAND_MUTED, tracking=0.22)
    slide_chrome(1, SLIDE_TOTAL)

    # ── 2 · Problem ──
    c.showPage(); fill_bg(c, SLIDE_W, SLIDE_H)
    tracked_caps(c, margin, SLIDE_H - 200, 'THE PROBLEM',
                 SANS, 14, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF_ITALIC, 92)
    headlines = [
        'Mastering software has spent',
        'a decade adding more knobs.',
        '',
        'You still need three apps',
        'to ship one record.',
        '',
        'And nothing connects the room',
        'to the delivery email.',
    ]
    y = SLIDE_H - 320
    for line in headlines:
        c.drawString(margin, y, line)
        y -= 100
    slide_chrome(2, SLIDE_TOTAL)

    # ── 3 · Positioning ──
    c.showPage(); fill_bg(c, SLIDE_W, SLIDE_H)
    tracked_caps(c, margin, SLIDE_H - 200, 'WHAT WE BUILT',
                 SANS, 14, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF, 120)
    c.drawString(margin, SLIDE_H - 380, 'One desktop app')
    c.drawString(margin, SLIDE_H - 510, 'for the whole')
    c.drawString(margin, SLIDE_H - 640, 'pre-release run.')
    gold_rule(c, margin, SLIDE_H - 680, 320)
    c.setFillColor(SAND_SECONDARY); c.setFont(SERIF_ITALIC, 36)
    c.drawString(margin, SLIDE_H - 760,
                 'Local-first. No cloud round-trip. Built by an engineer, for engineers.')
    slide_chrome(3, SLIDE_TOTAL)

    # ── 4 · Hero metric ──
    c.showPage(); fill_bg(c, SLIDE_W, SLIDE_H)
    tracked_caps(c, margin, SLIDE_H - 200, 'OVERALL VERDICT',
                 SANS, 14, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF, 560)
    c.drawString(margin, SLIDE_H - 720, '−7.1')
    c.setFillColor(SAND_MUTED); c.setFont(SERIF, 110)
    c.drawString(margin + 1100, SLIDE_H - 720, 'LUFS')
    gold_rule(c, margin, SLIDE_H - 760, 480)
    c.setFillColor(SAND_SECONDARY); c.setFont(SERIF_ITALIC, 38)
    c.drawString(margin, SLIDE_H - 830,
                 'Two point eight louder than the reference, integrated.')
    slide_chrome(4, SLIDE_TOTAL)

    # ── 5 · A/B compare ──
    c.showPage(); fill_bg(c, SLIDE_W, SLIDE_H)
    tracked_caps(c, margin, SLIDE_H - 200, 'A/B COMPARE',
                 SANS, 14, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF, 56)
    c.drawString(margin, SLIDE_H - 270, 'Level-matched. Every difference, named.')
    # Two columns
    col_w = (SLIDE_W - 2 * margin - 80) / 2
    col_y = SLIDE_H - 460
    # A
    tracked_caps(c, margin, col_y, 'A · REFERENCE', SANS, 14, SAND_MUTED, tracking=0.20)
    c.setFillColor(CREAM); c.setFont(SERIF, 220)
    c.drawString(margin, col_y - 240, '−9.9')
    c.setFillColor(SAND_MUTED); c.setFont(MONO, 22)
    c.drawString(margin, col_y - 290, 'demo.wav')
    # vertical rule
    c.setStrokeColor(Color(*SAND_DIM.rgb(), alpha=0.4))
    c.setLineWidth(0.5)
    c.line(margin + col_w + 40, col_y + 30, margin + col_w + 40, col_y - 320)
    # B with gold rule
    bx = margin + col_w + 80
    tracked_caps(c, bx, col_y, 'B · MIX', SANS, 14, SAND_MUTED, tracking=0.20)
    c.setFillColor(CREAM); c.setFont(SERIF, 220)
    c.drawString(bx, col_y - 240, '−7.1')
    gold_rule(c, bx, col_y - 252, 280)
    c.setFillColor(SAND_MUTED); c.setFont(MONO, 22)
    c.drawString(bx, col_y - 290, 'mix.wav')
    # delta
    c.setFillColor(SAND_SECONDARY); c.setFont(SERIF_ITALIC, 40)
    c.drawString(margin, 320, 'B is 2.8 LU louder than A, integrated.')
    slide_chrome(5, SLIDE_TOTAL)

    # ── 6 · Single-File QC ──
    # (Replaces the DMR slide — DMR isn't in the renderer right now;
    # Single-File QC is the strongest unspoken-for surface in 5.3.0.)
    c.showPage(); fill_bg(c, SLIDE_W, SLIDE_H)
    tracked_caps(c, margin, SLIDE_H - 200, 'SINGLE-FILE QC',
                 SANS, 14, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF_ITALIC, 80)
    italic_lines = [
        'Drop one file. The whole',
        'service appointment.',
    ]
    y = SLIDE_H - 340
    for l in italic_lines:
        c.drawString(margin, y, l); y -= 100
    gold_rule(c, margin, y - 20, 320)
    text_block(c, margin, y - 100,
               ['Clicks and glitches plotted on a clickable timeline.',
                'Distortion (clipping, inter-sample, harmonic) named',
                'with the band it lives in. Mains hum at 50/60 Hz plus',
                'harmonics. Limiter artefacts (pumping, IM, stuck-fast).',
                'Generation loss — MP3/AAC fingerprints inside what',
                'someone called "the original."'],
               SANS, 28, SAND_SECONDARY, leading=44)
    slide_chrome(6, SLIDE_TOTAL)

    # ── 7 · Atmos ──
    c.showPage(); fill_bg(c, SLIDE_W, SLIDE_H)
    tracked_caps(c, margin, SLIDE_H - 200, 'DOLBY ATMOS',
                 SANS, 14, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF, 90)
    c.drawString(margin, SLIDE_H - 320, 'ADM BWF native.')
    c.drawString(margin, SLIDE_H - 420, 'Preflight gates delivery.')
    gold_rule(c, margin, SLIDE_H - 460, 320)
    text_block(c, margin, SLIDE_H - 540,
               ['Bed and objects, parsed. Binaural TP, metered. Stereo',
                'downmix, QC\'d. Apple\'s hard checks (objects ≤ 118,',
                'LFE routed, bed layout, 48 kHz, ≥ 24-bit) gate the',
                'export — fail any of them and you fix it before you',
                'send. Per-object anomaly detection flags hot, silent,',
                'static, or dark objects. Usually a mix mistake.'],
               SANS, 26, SAND_SECONDARY, leading=42)
    slide_chrome(7, SLIDE_TOTAL)

    # ── 8 · Companion apps ──
    c.showPage(); fill_bg(c, SLIDE_W, SLIDE_H)
    tracked_caps(c, margin, SLIDE_H - 200, 'COMPANION APPS',
                 SANS, 14, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF_ITALIC, 96)
    c.drawString(margin, SLIDE_H - 360, 'RTMprofile')
    text_block(c, margin, SLIDE_H - 420,
               ['Feed it 5+ finished masters. It learns your sound,',
                'saves it as a fingerprint, drops straight into',
                'RTMcompare\'s Match tab. Your catalogue, made portable.'],
               SANS, 24, SAND_SECONDARY, leading=38)
    c.setFillColor(CREAM); c.setFont(SERIF_ITALIC, 96)
    c.drawString(margin, SLIDE_H - 640, 'RTMsend')
    text_block(c, margin, SLIDE_H - 700,
               ['VST3 / AU plugin. One button from Wavelab, Logic,',
                'Pro Tools, Studio One — straight into RTMcompare.',
                'ARA-aware where the host supports it.'],
               SANS, 24, SAND_SECONDARY, leading=38)
    slide_chrome(8, SLIDE_TOTAL)

    # ── 9 · Privacy ──
    c.showPage(); fill_bg(c, SLIDE_W, SLIDE_H)
    tracked_caps(c, margin, SLIDE_H - 200, 'PRIVACY',
                 SANS, 14, SAND_MUTED, tracking=0.22)
    c.setFillColor(CREAM); c.setFont(SERIF, 110)
    c.drawString(margin, SLIDE_H - 360, 'No audio leaves')
    c.drawString(margin, SLIDE_H - 490, 'the machine.')
    gold_rule(c, margin, SLIDE_H - 530, 320)
    c.setFillColor(SAND_SECONDARY); c.setFont(SERIF_ITALIC, 36)
    text_block(c, margin, SLIDE_H - 620,
               ['Every analysis, every render, every metadata read —',
                'all on this device. The only network path the app',
                'opens is opt-in DSP delivery status: outbound only,',
                'read-only, with credentials kept in the macOS',
                'Keychain via safeStorage. That\'s the entire list.'],
               SANS, 26, SAND_SECONDARY, leading=42)
    slide_chrome(9, SLIDE_TOTAL)

    # ── 10 · Closing ──
    c.showPage(); fill_bg(c, SLIDE_W, SLIDE_H)
    wordmark(c, margin, SLIDE_H - 480, 180)
    gold_rule(c, margin, SLIDE_H - 510, 1100, weight=0.9)
    c.setFillColor(SAND_SECONDARY); c.setFont(SERIF_ITALIC, 50)
    c.drawString(margin, SLIDE_H - 590, 'Pro mastering tools, minus the wall of jargon.')
    tracked_caps(c, margin, 240, 'macOS · APPLE SILICON · LOCAL-FIRST · 5.3.0',
                 SANS, 16, SAND_MUTED, tracking=0.22)
    slide_chrome(10, SLIDE_TOTAL)

    c.save()
    print(f'  → {os.path.basename(path)}')


# ──────────────────────────────────────────────────────────────────────
#  Driver
# ──────────────────────────────────────────────────────────────────────
def main():
    out = lambda name: os.path.join(HERE, name)
    print('Generating Console Didone PDFs:')
    build_manual(out('RTMcompare-Manual.pdf'))
    build_features(out('RTMcompare-Features.pdf'))
    build_pitch(out('RTMcompare-Pitch.pdf'))
    print(f'\nAll PDFs written to {HERE}/')


if __name__ == '__main__':
    main()
