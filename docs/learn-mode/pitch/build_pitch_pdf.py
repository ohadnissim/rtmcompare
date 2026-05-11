"""Render RTMcompare Learn Mode school pitch deck to PDF.

Renders only SCHOOL-PITCH.md → SCHOOL-PITCH.pdf.

Visual identity matched to the RTMcompare app exactly:

  Background   #0e0d0b   (app --color-bg-app)
  Panel        #1e1c18   (app --color-bg-panel)
  Subtle       #2a2722
  Rule         #3e3a33
  Sand 100     #ebe7e0   primary text    (app --color-sand-100)
  Sand 200     #d6d1c6   strong body
  Sand 300     #b5afa4   body            (app --color-sand-300)
  Sand 400     #8d867b   secondary       (app --color-sand-400)
  Sand 500     #6a6459   dim             (app --color-sand-500)
  Gold         #d0b066   accent          (app --color-terra)
  Gold dim     #a88d45   (app --color-terra-dark)

Font roles (matching app CSS exactly):
  Display h1/h2   Instrument Serif — "the Console-Didone display face"
  h3 + body       Instrument Sans  — "h3 stays sans for utility headings"
  Code / labels   Geist Mono       — metrics, filenames, data

No images. No hero art. Pure typography.

Usage:
    python3 build_pitch_pdf.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import markdown
from weasyprint import HTML, CSS

ROOT     = Path(__file__).parent
FONT_DIR = ROOT / "fonts"
MD_FILE  = ROOT / "SCHOOL-PITCH.md"
OUT_FILE = ROOT / "SCHOOL-PITCH.pdf"

# ── Palette — exact app tokens ────────────────────────────────────────
BG       = "#0e0d0b"
PANEL    = "#1e1c18"
SUBTLE   = "#2a2722"
RULE     = "#3e3a33"
S100     = "#ebe7e0"   # primary text
S200     = "#d6d1c6"   # strong body
S300     = "#b5afa4"   # body
S400     = "#8d867b"   # secondary
S500     = "#6a6459"   # dim
GOLD     = "#d0b066"   # terra
GOLD_DIM = "#a88d45"   # terra-dark


# ── Font CSS ──────────────────────────────────────────────────────────
def _ff(name, file, weight="400", style="normal"):
    return (
        f"@font-face{{font-family:'{name}';"
        f"src:url('file://{FONT_DIR/file}') format('truetype');"
        f"font-weight:{weight};font-style:{style};}}\n"
    )

FONT_CSS = (
    _ff("RTMSerif", "InstrumentSerif-Regular.ttf")
    + _ff("RTMSerif", "InstrumentSerif-Italic.ttf",  style="italic")
    + _ff("RTMSans",  "InstrumentSans-Regular.ttf")
    + _ff("RTMSans",  "InstrumentSans-Bold.ttf",      weight="700")
    + _ff("RTMMono",  "GeistMono-Regular.ttf")
    + _ff("RTMMono",  "GeistMono-Bold.ttf",            weight="700")
)


# ── Cover HTML ────────────────────────────────────────────────────────
PITCH_COVER = """\
<section class="cover deck-cover">
  <div class="cv-eyebrow">RTM AUDIO &nbsp;·&nbsp; LEARN MODE &nbsp;·&nbsp; FOR SCHOOLS &amp; UNIVERSITIES</div>
  <div class="cv-rule-top"></div>
  <div class="cv-spacer-top"></div>
  <div class="cv-title">RTMcompare\nLearn Mode</div>
  <div class="cv-sub">A grading tool built for the mixing room.\nObjective rubric. Blind test. Canvas-ready grades.</div>
  <div class="cv-spacer-bot"></div>
  <div class="cv-rule-bot"></div>
  <div class="cv-foot">
    <span>RTMAUDIO.COM</span>
    <span>SIGNED &amp; NOTARIZED &nbsp;·&nbsp; DEVELOPER ID APPLICATION</span>
    <span>macOS arm64 &nbsp;+&nbsp; Intel &nbsp;·&nbsp; Windows 10/11</span>
  </div>
</section>
"""


# ── Base CSS ──────────────────────────────────────────────────────────
BASE_CSS = FONT_CSS + f"""
/* ─ Page shell ──────────────────────────────────────────────────── */
@page {{
  background: {BG};
  margin: 0;
  @top-left    {{ content: ""; }}
  @top-right   {{ content: ""; }}
  @bottom-left {{ content: ""; }}
  @bottom-right{{ content: ""; }}
}}
@page :first {{
  background: {BG};
  margin: 0;
}}

html, body {{
  background: {BG};
  color: {S300};
  font-family: 'RTMSans', 'Helvetica Neue', Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.65;
  margin: 0;
}}

/* ─ Cover ────────────────────────────────────────────────────────── */
.cover {{
  page-break-after: always;
  width: 297mm;
  height: 188mm;
  margin: 0;
  padding: 14mm 22mm 14mm 22mm;
  box-sizing: border-box;
  background: {BG};
  display: flex;
  flex-direction: column;
}}
.cv-eyebrow {{
  font-family: 'RTMMono', monospace;
  font-size: 7.5pt;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: {S500};
}}
.cv-rule-top {{
  margin-top: 8pt;
  border-top: 1px solid {GOLD};
  width: 100%;
}}
.cv-spacer-top {{ flex: 1.2; }}
.cv-title {{
  font-family: 'RTMSerif', Georgia, serif;
  font-size: 72pt;
  line-height: 0.95;
  letter-spacing: -0.02em;
  color: {S100};
  margin: 0 0 18pt 0;
  white-space: pre-line;
}}
.cv-sub {{
  font-family: 'RTMSerif', Georgia, serif;
  font-style: italic;
  font-size: 14pt;
  line-height: 1.4;
  color: {S400};
  white-space: pre-line;
  margin: 0;
}}
.cv-spacer-bot {{ flex: 1.8; }}
.cv-rule-bot {{
  border-top: 1px solid {RULE};
  width: 100%;
  margin-bottom: 10pt;
}}
.cv-foot {{
  display: flex;
  justify-content: space-between;
  font-family: 'RTMMono', monospace;
  font-size: 7pt;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: {S500};
}}

/* ─ Headings ─────────────────────────────────────────────────────── */
h1, h2 {{
  font-family: 'RTMSerif', Georgia, serif;
  font-weight: 400;
  letter-spacing: -0.005em;
  color: {S100};
  page-break-after: avoid;
}}
h1 {{
  font-size: 30pt;
  line-height: 1.05;
  letter-spacing: -0.01em;
  margin: 0 0 8pt 0;
}}
h2 {{
  font-size: 22pt;
  line-height: 1.1;
  margin: 26pt 0 6pt 0;
}}
h3 {{
  font-family: 'RTMSans', sans-serif;
  font-weight: 700;
  font-size: 8pt;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: {GOLD};
  margin: 22pt 0 6pt 0;
  padding-bottom: 4pt;
  border-bottom: 1px solid {RULE};
}}
h4 {{
  font-family: 'RTMSans', sans-serif;
  font-weight: 700;
  font-size: 10pt;
  color: {S200};
  letter-spacing: 0.01em;
  margin: 14pt 0 4pt 0;
}}

p {{ margin: 0 0 9pt 0; }}
em, i {{
  font-family: 'RTMSerif', Georgia, serif;
  font-style: italic;
  color: {S400};
}}
strong, b {{ color: {S200}; font-weight: 700; }}

/* Italic-only paragraph after H2 = chapter dek */
h2 + p > em:only-child {{
  display: block;
  font-family: 'RTMSerif', Georgia, serif;
  font-style: italic;
  font-size: 13pt;
  line-height: 1.5;
  color: {S500};
  margin: 4pt 0 22pt 0;
}}

hr {{
  border: none;
  border-top: 1px solid {RULE};
  margin: 22pt 0;
}}
ul, ol {{
  padding-left: 18pt;
  margin: 0 0 12pt 0;
}}
li {{ margin-bottom: 4pt; line-height: 1.6; }}

code {{
  font-family: 'RTMMono', monospace;
  background: {PANEL};
  color: {GOLD};
  padding: 1pt 5pt;
  border-radius: 2pt;
  font-size: 8.5pt;
}}
pre {{
  font-family: 'RTMMono', monospace;
  background: {PANEL};
  border-left: 2pt solid {RULE};
  padding: 10pt 12pt;
  font-size: 8.5pt;
  line-height: 1.55;
  page-break-inside: avoid;
  margin: 8pt 0 14pt 0;
  color: {S300};
}}
pre code {{ background: transparent; padding: 0; color: {S300}; }}

a {{ color: {GOLD}; text-decoration: none; border-bottom: 0.5pt solid {RULE}; }}

table {{
  width: 100%;
  border-collapse: collapse;
  margin: 6pt 0 18pt 0;
  font-family: 'RTMSans', sans-serif;
  font-size: 9.5pt;
  page-break-inside: avoid;
}}
th, td {{
  text-align: left;
  padding: 5pt 10pt;
  border-bottom: 1px solid {RULE};
  vertical-align: top;
}}
th {{
  font-family: 'RTMMono', monospace;
  font-size: 7.5pt;
  font-weight: 400;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: {GOLD};
  background: {PANEL};
  border-bottom: 1px solid {GOLD_DIM};
}}
td {{ color: {S300}; }}
tr:nth-child(even) td {{ background: {SUBTLE}; }}

blockquote {{
  border-left: 2pt solid {GOLD};
  padding: 4pt 14pt;
  margin: 14pt 0 18pt 0;
  background: {SUBTLE};
  page-break-inside: avoid;
}}
blockquote p {{
  font-family: 'RTMSerif', Georgia, serif;
  font-style: italic;
  font-size: 12pt;
  line-height: 1.55;
  color: {S400};
  margin: 0 0 4pt 0;
}}
"""


# ── Deck CSS ──────────────────────────────────────────────────────────
DECK_CSS = f"""
@page {{
  size: 297mm 188mm;
  margin: 0;
  background: {BG};
}}
@page :first {{
  background: {BG};
  margin: 0;
  @top-left    {{ content: ""; }}
  @top-right   {{ content: ""; }}
  @bottom-left {{ content: ""; }}
  @bottom-right{{ content: ""; }}
}}

/* Deck cover — 16:9 */
.deck-cover {{
  width: 297mm !important;
  height: 188mm !important;
}}
.deck-cover .cv-title {{
  font-size: 72pt;
  line-height: 0.92;
  white-space: pre-line;
}}
.deck-cover .cv-sub {{
  font-size: 14pt;
  white-space: pre-line;
}}

/* Individual slides */
.slide {{
  page-break-before: always;
  height: 188mm;
  width: 297mm;
  margin: 0;
  padding: 14mm 22mm 14mm 22mm;
  box-sizing: border-box;
  background: {BG};
  display: flex;
  flex-direction: column;
  border-top: 1px solid {GOLD};
}}
.slide-kicker {{
  font-family: 'RTMMono', monospace;
  font-size: 8pt;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  color: {S500};
  margin: 0 0 12pt 0;
}}
h1.slide-headline {{
  font-family: 'RTMSerif', Georgia, serif;
  font-size: 46pt;
  line-height: 1.04;
  letter-spacing: -0.015em;
  color: {S100};
  font-weight: 400;
  margin: 0 0 0 0;
  max-width: 85%;
}}
.slide-rule {{
  width: 32mm;
  border-top: 1px solid {GOLD_DIM};
  margin: 12pt 0 12pt 0;
}}
.slide-dek {{
  font-family: 'RTMSerif', Georgia, serif;
  font-style: italic;
  font-size: 13pt;
  line-height: 1.45;
  color: {S500};
  max-width: 65%;
  margin: 0 0 14pt 0;
}}
.slide-dek p {{ margin: 0 0 6pt 0; color: {S500}; }}
.slide ul {{
  font-family: 'RTMSans', sans-serif;
  font-size: 10pt;
  color: {S400};
  margin: 0;
  padding-left: 16pt;
  line-height: 1.55;
}}
.slide ol {{
  font-family: 'RTMSans', sans-serif;
  font-size: 10pt;
  color: {S400};
  margin: 0;
  padding-left: 16pt;
  line-height: 1.55;
}}
.slide li {{ margin-bottom: 3pt; }}
.slide h4 {{
  font-family: 'RTMSans', sans-serif;
  font-weight: 700;
  font-size: 9pt;
  color: {GOLD};
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin: 12pt 0 4pt 0;
}}

.deck-body hr {{ display: none; }}
hr {{ display: none; }}
"""


# ── Markdown helpers ──────────────────────────────────────────────────
SLIDE_RE = re.compile(
    r'<h2[^>]*>\s*Slide\s+\d+\s*[—\-]\s*(.+?)\s*</h2>',
    re.IGNORECASE,
)
_EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001FAFF"
    "]+",
    flags=re.UNICODE,
)


def render_md(path: Path) -> str:
    text = _EMOJI_RE.sub("", path.read_text(encoding="utf-8"))
    return markdown.markdown(
        text,
        extensions=["extra", "sane_lists", "tables", "md_in_html"],
    )


def strip_first_h1(html: str) -> str:
    return re.sub(r'<h1[^>]*>.*?</h1>', '', html, count=1, flags=re.DOTALL)


def transform_deck(html: str) -> str:
    def repl(m: re.Match) -> str:
        return f'__SLIDE__<div class="slide-kicker">{m.group(1).strip()}</div>'

    html = SLIDE_RE.sub(repl, html)
    parts = html.split('__SLIDE__')
    if len(parts) <= 1:
        return html

    out: list[str] = []
    for body in parts[1:]:
        body = re.sub(
            r'<h3[^>]*>(.+?)</h3>',
            lambda m: f'<h1 class="slide-headline">{m.group(1)}</h1><div class="slide-rule"></div>',
            body, count=1, flags=re.DOTALL,
        )
        body = re.sub(
            r'<p>\s*<em>(.+?)</em>\s*</p>',
            lambda m: f'<div class="slide-dek"><p>{m.group(1)}</p></div>',
            body, count=1, flags=re.DOTALL,
        )
        out.append(f'<section class="slide">{body}</section>')
    return ''.join(out)


def build_html(body_html: str) -> str:
    style = f'<style>html{{--doc-footer:"RTMcompare · LEARN MODE";}}</style>'
    return (
        f'<!doctype html><html><head><meta charset="utf-8">{style}</head>'
        f'<body>{PITCH_COVER}<div class="deck-body">{body_html}</div></body></html>'
    )


# ── Render ────────────────────────────────────────────────────────────
def render() -> Path:
    if not MD_FILE.exists():
        raise SystemExit(f"missing: {MD_FILE}")
    body = strip_first_h1(render_md(MD_FILE))
    body = transform_deck(body)
    full = build_html(body)
    css = [CSS(string=BASE_CSS), CSS(string=DECK_CSS)]
    HTML(string=full, base_url=str(ROOT)).write_pdf(str(OUT_FILE), stylesheets=css)
    return OUT_FILE


def main() -> int:
    out = render()
    print(f"  SCHOOL-PITCH -> {out.name}  ({out.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
