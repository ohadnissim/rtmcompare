"""Render the v5.0.8 markdown docs to PDF in the FLOW Console-Didone style.

Extensions over v5.0.5/build_pdfs.py:
- Hero image on each cover (full-bleed top section for doc covers,
  split-screen left half for deck cover)
- "RTMcompare" branding instead of "RTM SUITE" in headers/footers
- v5.0.8 version stamps everywhere
- Drops PRICING-PAGE (not in this distribution)

Three docs, two layouts:
- MANUAL + FEATURES — A4 portrait, every H2 starts a new chapter
- PITCH-DECK — 16:9 landscape; cover is a split (image left / type right),
  body slides are cream paper with one-big-idea Didone headlines

Each slide in the deck is `## Slide N — Kicker` then `### Big headline`
then italic dek. The renderer parses that pattern into the slide layout.

Bundled fonts live in ./fonts/. Hero images in ./heroes/. WeasyPrint
reads them via @font-face and base_url respectively.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import markdown
from weasyprint import HTML, CSS

ROOT = Path(__file__).parent
FONT_DIR = ROOT / "fonts"
HERO_DIR = ROOT / "heroes"
MD_FILES = {
    "MANUAL":     ROOT / "MANUAL.md",
    "FEATURES":   ROOT / "FEATURES.md",
    "PITCH-DECK": ROOT / "PITCH-DECK.md",
    "CHANGELOG":  ROOT / "CHANGELOG.md",
}
HERO_IMAGES = {
    "MANUAL":     HERO_DIR / "hero-01-manual-cover.png",
    "FEATURES":   HERO_DIR / "hero-03-features-cover.png",
    "PITCH-DECK": HERO_DIR / "hero-05-deck-cover.png",
    "CHANGELOG":  HERO_DIR / "hero-02-manual-chapter.png",
}
VERSION = "5.5.0"

# ── Palette (FLOW Console-Didone) ─────────────────────────────────────
CREAM        = "#ebe4d5"
CREAM_CARD   = "#e2dacb"
BLACK        = "#0e0d0b"
INK          = "#1a1714"
DIM          = "#6b6558"
MUTED        = "#8d857a"
GOLD         = "#b09660"
GOLD_DARK    = "#8c7646"
RULE         = "#b8ad99"

# ── Cover meta ────────────────────────────────────────────────────────
DOC_META = {
    "MANUAL": dict(
        kicker="USER MANUAL",
        title="RTMcompare",
        sub="The toolkit that tells you, with numbers, whether the new master is actually better — and what every streaming platform is going to do to it on the way out.",
        meta=f"V{VERSION}",
        doc_label="USER MANUAL",
    ),
    "FEATURES": dict(
        kicker="FEATURES",
        title="RTMcompare",
        sub="The decision-support toolkit you wish you'd had on the last record.",
        meta=f"V{VERSION}",
        doc_label="FEATURES",
    ),
    "PITCH-DECK": dict(
        kicker="PITCH",
        title="RTM.",
        sub="Three apps. One local-only loop.",
        meta=f"V{VERSION}",
        doc_label="PITCH",
    ),
    "CHANGELOG": dict(
        kicker="CHANGELOG",
        title="RTMcompare",
        sub="Every change worth telling you about, newest first.",
        meta=f"V{VERSION}",
        doc_label="CHANGELOG",
    ),
}


# ── Font face declarations ────────────────────────────────────────────
def _font_face(name: str, file: str, weight: str = "400", style: str = "normal") -> str:
    return (
        f"@font-face {{ font-family: '{name}'; "
        f"src: url('file://{FONT_DIR / file}') format('truetype'); "
        f"font-weight: {weight}; font-style: {style}; }}\n"
    )


FONT_CSS = (
    _font_face("RTMSerif",  "InstrumentSerif-Regular.ttf")
    + _font_face("RTMSerif",  "InstrumentSerif-Italic.ttf",  style="italic")
    + _font_face("RTMSans",   "InstrumentSans-Regular.ttf")
    + _font_face("RTMSans",   "InstrumentSans-Bold.ttf",     weight="700")
    + _font_face("RTMMono",   "GeistMono-Regular.ttf")
    + _font_face("RTMMono",   "GeistMono-Bold.ttf",          weight="700")
)


# ── Cover HTML ────────────────────────────────────────────────────────
DOC_COVER = """
<section class="cover doc-cover">
  <figure class="cover-hero" style="background-image: url('file://{hero_path}');"></figure>
  <div class="cover-mast">
    <div class="cover-kicker">{kicker}</div>
    <div class="cover-title">{title}</div>
    <div class="cover-sub">{sub}</div>
    <div class="cover-rule-tiny"></div>
  </div>
  <div class="cover-foot">
    <div class="cover-foot-left">
      <div class="cover-foot-label">RELEASE</div>
      <div class="cover-foot-val">RTMcompare v{version}</div>
      <div class="cover-foot-val">macOS arm64 · Windows x64</div>
    </div>
    <div class="cover-foot-mid">
      <div class="cover-foot-label">SIGNED · NOTARIZED</div>
      <div class="cover-foot-val">Developer ID Application</div>
      <div class="cover-foot-val">Ohad Nissim (3RL52RHGT3)</div>
    </div>
    <div class="cover-foot-right">
      <div class="cover-foot-label">DOCUMENT</div>
      <div class="cover-foot-val">{doc_label}</div>
      <div class="cover-foot-val">v{version}</div>
    </div>
  </div>
</section>
"""

DECK_COVER = """
<section class="cover deck-cover">
  <figure class="deck-cover-hero" style="background-image: url('file://{hero_path}');"></figure>
  <div class="deck-cover-right">
    <div class="deck-cover-head">
      <div class="deck-cover-label">CONSOLE DIDONE</div>
      <div class="deck-cover-label-right">PITCH &middot; MMXXVI</div>
    </div>
    <div class="deck-cover-rule"></div>
    <div class="deck-cover-mast">
      <div class="deck-cover-title">{title}</div>
      <div class="deck-cover-sub">{sub}</div>
      <div class="deck-cover-rule-tiny"></div>
    </div>
    <div class="deck-cover-foot">
      <div class="deck-cover-foot-left">OHAD NISSIM</div>
      <div class="deck-cover-foot-right">DEVELOPER ID 3RL52RHGT3</div>
    </div>
  </div>
</section>
"""


# ── Base CSS — cream paper, ink body, Didone display ─────────────────
BASE_CSS = FONT_CSS + f"""
@page {{
  background: {CREAM};
  margin: 22mm 18mm 22mm 18mm;
  @top-left {{
    content: "RTMcompare";
    color: {INK};
    font-family: 'RTMMono', ui-monospace, monospace;
    font-size: 8pt;
    letter-spacing: 0.20em;
    margin-top: 8mm;
  }}
  @top-right {{
    content: counter(page, decimal-leading-zero) " / " counter(pages, decimal-leading-zero);
    color: {INK};
    font-family: 'RTMMono', ui-monospace, monospace;
    font-size: 8pt;
    letter-spacing: 0.20em;
    margin-top: 8mm;
  }}
  @bottom-left {{
    content: "RTMAUDIO.COM";
    color: {DIM};
    font-family: 'RTMMono', ui-monospace, monospace;
    font-size: 8pt;
    letter-spacing: 0.20em;
    margin-bottom: 8mm;
  }}
  @bottom-right {{
    content: var(--doc-footer);
    color: {DIM};
    font-family: 'RTMMono', ui-monospace, monospace;
    font-size: 8pt;
    letter-spacing: 0.20em;
    margin-bottom: 8mm;
  }}
}}
@page :first {{
  /* Cover gets no header / footer — it's the visual splash. */
  @top-left    {{ content: ""; }}
  @top-right   {{ content: ""; }}
  @bottom-left {{ content: ""; }}
  @bottom-right{{ content: ""; }}
  margin: 0;
}}

html {{ --doc-footer: "v{VERSION}"; }}
html, body {{
  background: {CREAM};
  color: {INK};
  font-family: 'RTMSerif', Georgia, "Times New Roman", serif;
  font-size: 11pt;
  line-height: 1.55;
  margin: 0;
}}

/* ── Doc cover (cream, with hero image full-bleed top) ─────────────── */
.doc-cover {{
  page-break-after: always;
  height: 297mm;
  width: 210mm;
  background: {CREAM};
  display: flex;
  flex-direction: column;
  margin: 0;
}}
.cover-hero {{
  width: 210mm;
  height: 130mm;
  margin: 0;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  border-bottom: 1px solid {GOLD_DARK};
}}
.cover-mast {{
  margin: 14mm 18mm 0 18mm;
  flex-grow: 1;
}}
.cover-kicker {{
  font-family: 'RTMMono', ui-monospace, monospace;
  font-size: 9.5pt;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: {INK};
  margin: 0 0 12pt 0;
}}
.cover-title {{
  font-family: 'RTMSerif', Georgia, serif;
  font-size: 64pt;
  line-height: 1.0;
  letter-spacing: -0.02em;
  color: {GOLD};
  margin: 0;
}}
.cover-sub {{
  font-family: 'RTMSerif', Georgia, serif;
  font-style: italic;
  font-size: 14pt;
  line-height: 1.35;
  color: {INK};
  max-width: 80%;
  margin: 16pt 0 14pt 0;
}}
.cover-rule-tiny {{
  width: 38mm;
  border-top: 1px solid {GOLD_DARK};
  margin-bottom: 18pt;
}}
.cover-foot {{
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 14mm;
  padding: 12pt 18mm 18mm 18mm;
  border-top: 1px solid {RULE};
}}
.cover-foot-label {{
  font-family: 'RTMMono', ui-monospace, monospace;
  font-size: 8pt;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: {GOLD_DARK};
  margin-bottom: 4pt;
}}
.cover-foot-val {{
  font-family: 'RTMSans', ui-sans-serif, "Helvetica Neue", Arial, sans-serif;
  font-size: 9pt;
  color: {INK};
  line-height: 1.35;
}}

/* ── Body typography ──────────────────────────────────────────── */
h1, h2, h3, h4 {{
  color: {INK};
  page-break-after: avoid;
}}
h1 {{
  font-family: 'RTMSerif', Georgia, serif;
  font-size: 32pt;
  font-weight: normal;
  line-height: 1.05;
  letter-spacing: -0.005em;
  margin: 0 0 6pt 0;
  color: {INK};
}}
h2 {{
  font-family: 'RTMSerif', Georgia, serif;
  font-size: 22pt;
  font-weight: normal;
  letter-spacing: -0.005em;
  line-height: 1.1;
  margin: 28pt 0 6pt 0;
}}
h3 {{
  font-family: 'RTMMono', ui-monospace, monospace;
  font-size: 9pt;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: {GOLD_DARK};
  margin: 18pt 0 4pt 0;
  border-bottom: 1px solid {GOLD_DARK};
  padding-bottom: 3pt;
  display: inline-block;
}}
h4 {{
  font-family: 'RTMSans', sans-serif;
  font-size: 10.5pt;
  font-weight: 700;
  margin: 12pt 0 3pt 0;
}}

p {{ margin: 0 0 9pt 0; }}
em, i {{ color: {INK}; font-style: italic; }}
strong, b {{ color: {INK}; font-weight: 700; font-family: 'RTMSans', sans-serif; }}

/* The leading italic-after-H2 paragraph reads as a magazine dek. */
h2 + p > em:only-child,
h2 + p:first-of-type:has(> em:only-child) {{
  color: {DIM};
  font-style: italic;
  font-size: 13pt;
  line-height: 1.45;
  display: block;
  margin: 4pt 0 18pt 0;
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
li {{ margin-bottom: 4pt; }}

code {{
  font-family: 'RTMMono', ui-monospace, monospace;
  background: {CREAM_CARD};
  color: {INK};
  padding: 0.5pt 5pt;
  border-radius: 2pt;
  font-size: 9.5pt;
}}
pre {{
  font-family: 'RTMMono', ui-monospace, monospace;
  background: {CREAM_CARD};
  border: none;
  border-left: 2pt solid {GOLD_DARK};
  padding: 10pt 12pt;
  font-size: 9pt;
  line-height: 1.5;
  overflow-wrap: break-word;
  page-break-inside: avoid;
  margin: 8pt 0 16pt 0;
  color: {INK};
}}
pre code {{ background: transparent; padding: 0; }}

a {{ color: {GOLD_DARK}; text-decoration: none; border-bottom: 0.4pt solid {GOLD_DARK}; }}

table {{
  width: 100%;
  border-collapse: collapse;
  margin: 8pt 0 16pt 0;
  font-family: 'RTMSans', sans-serif;
  font-size: 9.8pt;
  page-break-inside: avoid;
  color: {INK};
}}
th, td {{
  text-align: left;
  padding: 6pt 9pt;
  border-bottom: 1px solid {RULE};
  vertical-align: top;
}}
th {{
  font-family: 'RTMMono', ui-monospace, monospace;
  color: {GOLD_DARK};
  font-weight: normal;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 8.5pt;
  border-bottom: 1px solid {GOLD_DARK};
}}

blockquote {{
  border-left: 2pt solid {GOLD_DARK};
  padding: 2pt 14pt;
  margin: 10pt 0 14pt 0;
  color: {INK};
  font-style: italic;
  font-size: 12pt;
  font-family: 'RTMSerif', Georgia, serif;
  page-break-inside: avoid;
}}
blockquote p {{ margin: 0 0 6pt 0; }}
"""


# ── Doc-mode CSS (manual + features) ──────────────────────────────────
DOC_CSS = f"""
@page {{ size: A4; }}

.doc-body h2 {{
  page-break-before: always;
  margin-top: 0;
  padding-top: 6mm;
  font-size: 30pt;
  letter-spacing: -0.01em;
  border-bottom: 1px solid {RULE};
  padding-bottom: 12pt;
  margin-bottom: 18pt;
}}
.doc-body h2:first-of-type {{ page-break-before: auto; }}
.doc-body p {{
  font-size: 11pt;
  line-height: 1.65;
}}
"""


# ── Deck-mode CSS — cover split (hero left / type right), slides cream ─
DECK_CSS = f"""
@page {{
  size: 297mm 188mm;
  margin: 14mm 22mm 14mm 22mm;
  background: {CREAM};
}}

@page deck-cover {{
  background: {BLACK};
  margin: 0;
  size: 297mm 188mm;
  @top-left    {{ content: ""; }}
  @top-right   {{ content: ""; }}
  @bottom-left {{ content: ""; }}
  @bottom-right{{ content: ""; }}
}}

.deck-cover {{
  page: deck-cover;
  page-break-after: always;
  height: 188mm;
  width: 297mm;
  margin: 0;
  background: {BLACK};
  color: {CREAM};
  display: flex;
  flex-direction: row;
}}
.deck-cover-hero {{
  width: 148mm;
  height: 188mm;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  border-right: 1px solid rgba(208,150,96,0.30);
}}
.deck-cover-right {{
  width: 149mm;
  height: 188mm;
  padding: 14mm 18mm;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: {BLACK};
  color: {CREAM};
}}
.deck-cover-head {{
  display: flex;
  justify-content: space-between;
  font-family: 'RTMMono', ui-monospace, monospace;
  font-size: 8pt;
  letter-spacing: 0.30em;
  color: {CREAM};
  text-transform: uppercase;
}}
.deck-cover-rule {{
  border-top: 1px solid rgba(235,228,213,0.30);
  margin-top: 4pt;
}}
.deck-cover-mast {{
  margin-top: 8mm;
}}
.deck-cover-title {{
  font-family: 'RTMSerif', Georgia, serif;
  font-size: 130pt;
  line-height: 0.92;
  letter-spacing: -0.03em;
  color: {GOLD};
  margin: 0;
}}
.deck-cover-sub {{
  font-family: 'RTMSerif', Georgia, serif;
  font-style: italic;
  font-size: 18pt;
  line-height: 1.3;
  color: {CREAM};
  margin: 18pt 0 14pt 0;
}}
.deck-cover-rule-tiny {{
  width: 36mm;
  border-top: 1px solid {GOLD};
}}
.deck-cover-foot {{
  display: flex;
  justify-content: space-between;
  font-family: 'RTMMono', ui-monospace, monospace;
  font-size: 8pt;
  letter-spacing: 0.30em;
  color: rgba(235,228,213,0.70);
  text-transform: uppercase;
  border-top: 1px solid rgba(235,228,213,0.20);
  padding-top: 10pt;
}}

/* Each slide: kicker + huge serif headline + italic dek. */
.slide {{
  page-break-before: always;
  height: 100%;
  padding-top: 18mm;
  display: flex;
  flex-direction: column;
}}
.slide-kicker {{
  font-family: 'RTMMono', ui-monospace, monospace;
  font-size: 9.5pt;
  letter-spacing: 0.30em;
  text-transform: uppercase;
  color: {GOLD_DARK};
  margin: 0 0 16pt 0;
  border-bottom: 1px solid {GOLD_DARK};
  padding-bottom: 3pt;
  display: inline-block;
}}
.slide-headline {{
  font-family: 'RTMSerif', Georgia, serif;
  font-size: 56pt;
  line-height: 1.02;
  letter-spacing: -0.015em;
  color: {INK};
  margin: 0 0 22pt 0;
  max-width: 95%;
}}
.slide-rule {{
  width: 40mm;
  border-top: 1px solid {GOLD_DARK};
  margin: 0 0 18pt 0;
}}
.slide-dek {{
  font-family: 'RTMSerif', Georgia, serif;
  font-style: italic;
  font-size: 16pt;
  line-height: 1.45;
  color: {INK};
  max-width: 75%;
  margin: 0;
}}
.slide-dek p {{ margin: 0 0 10pt 0; }}

.deck-body hr {{ display: none; }}
hr {{ display: none; }}
"""


# ── Markdown helpers ──────────────────────────────────────────────────
SLIDE_KICKER_RE = re.compile(
    r'<h2[^>]*>\s*Slide\s+(\d+)\s*[—\-]\s*(.+?)\s*</h2>',
    re.IGNORECASE,
)


_EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001F5FF"
    "\U0001F600-\U0001F64F"
    "\U0001F680-\U0001F6FF"
    "\U0001F700-\U0001F77F"
    "\U0001F780-\U0001F7FF"
    "\U0001F800-\U0001F8FF"
    "\U0001F900-\U0001F9FF"
    "\U0001FA00-\U0001FA6F"
    "\U0001FA70-\U0001FAFF"
    "]+",
    flags=re.UNICODE,
)


def render_md(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    text = _EMOJI_RE.sub("", text)
    return markdown.markdown(
        text,
        extensions=["extra", "sane_lists", "tables", "md_in_html"],
    )


def strip_first_h1(html: str) -> str:
    return re.sub(r'<h1[^>]*>.*?</h1>', '', html, count=1, flags=re.DOTALL)


def transform_deck(html: str) -> str:
    """Wrap each slide in <section class="slide"> with kicker / headline /
    dek built from `## Slide N — Kicker`, `### Headline`, and the first
    italic paragraph after the H3.
    """
    def repl_kicker(m: re.Match) -> str:
        kicker = m.group(2).strip()
        return (
            '__SLIDE_OPEN__'
            f'<div class="slide-kicker">{kicker}</div>'
        )
    transformed = SLIDE_KICKER_RE.sub(repl_kicker, html)
    parts = transformed.split('__SLIDE_OPEN__')
    if len(parts) <= 1:
        return html
    out: list[str] = []
    for body in parts[1:]:
        body = re.sub(
            r'<h3[^>]*>(.+?)</h3>',
            lambda mm: (
                f'<h1 class="slide-headline">{mm.group(1)}</h1>'
                '<div class="slide-rule"></div>'
            ),
            body, count=1, flags=re.DOTALL,
        )
        body = re.sub(
            r'<p>\s*<em>(.+?)</em>\s*</p>',
            lambda mm: f'<div class="slide-dek"><p>{mm.group(1)}</p></div>',
            body, count=1, flags=re.DOTALL,
        )
        out.append('<section class="slide">')
        out.append(body)
        out.append('</section>')
    return ''.join(out)


def build_html(doc_id: str, body_html: str) -> str:
    meta = dict(DOC_META[doc_id])
    meta["version"] = VERSION
    meta["hero_path"] = str(HERO_IMAGES[doc_id])
    is_deck = doc_id == "PITCH-DECK"
    if is_deck:
        cover = DECK_COVER.format(**meta)
        body_class = "deck-body"
    else:
        cover = DOC_COVER.format(**meta)
        body_class = "doc-body"
    footer_label = meta["doc_label"]
    inline_style = (
        f'<style>html {{ --doc-footer: "RTMcompare · {footer_label} · V{VERSION}"; }}</style>'
    )
    return f"""<!doctype html>
<html><head><meta charset="utf-8">{inline_style}</head>
<body>
{cover}
<div class="{body_class}">
{body_html}
</div>
</body></html>"""


# ── Render pipeline ───────────────────────────────────────────────────
def render(doc_id: str) -> Path:
    md_path = MD_FILES[doc_id]
    if not md_path.exists():
        raise SystemExit(f"missing source: {md_path}")
    body = render_md(md_path)
    body = strip_first_h1(body)
    if doc_id == "PITCH-DECK":
        body = transform_deck(body)
    full = build_html(doc_id, body)

    css_list = [CSS(string=BASE_CSS)]
    if doc_id == "PITCH-DECK":
        css_list.append(CSS(string=DECK_CSS))
    else:
        css_list.append(CSS(string=DOC_CSS))

    out = md_path.with_suffix(".pdf")
    HTML(string=full, base_url=str(ROOT)).write_pdf(
        target=str(out), stylesheets=css_list,
    )
    return out


def main() -> int:
    for doc_id in MD_FILES:
        out = render(doc_id)
        kb = out.stat().st_size // 1024
        print(f"  {doc_id:11s} -> {out.name}  ({kb} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
