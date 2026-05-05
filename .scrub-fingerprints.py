"""
One-shot scrubber: removes panel-review fingerprints from the codebase.

Targets:
  • Single-line comments whose primary purpose is a review reference
    ("// Panel ask: X", "// Nils's sign-off polish: ...").
  • JSDoc / block-comment paragraphs containing a review reference.
  • Inline aside fragments inside larger comments — the fragment is
    deleted, the surrounding comment kept.
  • UI-visible title attrs that mention panel names.

What we keep:
  • The actual technical rationale that happens to sit next to a review
    reference.  We only remove the "who asked for this" signature, not
    the "why this code is here" explanation.
"""

from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "src"

# ── Patterns we rewrite ────────────────────────────────────────────────

# Aside-style sentences that name reviewers — delete the whole sentence.
ASIDE_SENTENCE_RE = re.compile(
    r"""
    (?:                              # sentence opener
        Panel[ -]ask[s]?            # "Panel ask", "Panel asks"
      | panel[ -]ask[s]?
      | Final[ -]panel[ -]ask
      | final[ -]panel[ -]ask
      | Panel[ -]verdict
      | panel[ -]verdict
      | Panel[ -]review
      | panel[ -]review
      | Sign[ -]off\ polish
      | sign[ -]off\ polish
      | Grammy[ -]ME
    )
    [^.]*?                           # body of the sentence
    \.                               # terminating period
    """,
    re.VERBOSE,
)

# "X's sign-off polish" / "X's ask" / "X-tier mixer" etc, where X is one
# of our persona names.  Delete these sentences entirely.
PERSONA_NAMES = (
    r"(?:Emilia|Nils|Chris\s+Lord[- ]?Alge|Dvori|Francesca|Ziv|Tyler|"
    r"Karen\s+B|Roberto|Simone|Joaquin|Nina\s+K|Dmitri|Ariel|Omar|"
    r"Prof\.\s+Raanan|Jonas|Eli|Hiroshi|Dani)"
)
PERSONA_SENTENCE_RE = re.compile(
    rf"""
    (?:                              # sentence opener
        {PERSONA_NAMES}'s             # possessive
      | {PERSONA_NAMES}\s+(?:asked|said|wanted|called|named|flagged|ask)
      | \(                             # parenthetical "(Panel ask: X)"
          [^)]*?{PERSONA_NAMES}[^)]*
        \)
      | —\s*{PERSONA_NAMES}\b          # em-dash credit "— Ariel"
    )
    [^.]*?\.                         # ...rest of sentence
    """,
    re.VERBOSE,
)

# Trailing "(Panel ask / ...X...)" inline attributions — strip them.
PARENTHETICAL_ASK_RE = re.compile(
    rf"""
    \s*\(
        [^)]*?(?:Panel\s+ask|panel\s+ask|Final[ -]panel[ -]ask|
                 Final\s+panel|sign[ -]off\s+polish|
                 {PERSONA_NAMES})[^)]*?
    \)
    """,
    re.VERBOSE,
)

# Round-numbered asks: "Panel ask (round 3):" -> delete
ROUND_ASK_RE = re.compile(
    r"""
    Panel\s+ask\s*\(round\s+\d+\)\s*:[^.\n]*\.?
    """,
    re.VERBOSE,
)

# Tidy-ups: collapse double spaces, blank lines with only `//` or ` * `
DOUBLE_SPACE_RE = re.compile(r"  +")
EMPTY_LINE_COMMENT_RE = re.compile(r"^(\s*)(//|\*)\s*$")


def scrub(text: str) -> str:
    out = text
    out = ROUND_ASK_RE.sub("", out)
    out = PARENTHETICAL_ASK_RE.sub("", out)
    out = PERSONA_SENTENCE_RE.sub("", out)
    out = ASIDE_SENTENCE_RE.sub("", out)
    # Normalise residual whitespace
    lines = out.splitlines(keepends=True)
    new_lines = []
    prev_empty_comment = False
    for ln in lines:
        # collapse multi-space
        clean_core = DOUBLE_SPACE_RE.sub(" ", ln.rstrip("\n"))
        # drop orphan blank comment lines (`//`, ` * `)
        if EMPTY_LINE_COMMENT_RE.match(clean_core):
            if prev_empty_comment:
                continue  # dedup
            prev_empty_comment = True
        else:
            prev_empty_comment = False
        new_lines.append(clean_core + ("\n" if ln.endswith("\n") else ""))
    return "".join(new_lines)


def process_file(p: Path) -> bool:
    """Returns True if the file was modified."""
    try:
        original = p.read_text(encoding="utf-8")
    except Exception:
        return False
    scrubbed = scrub(original)
    if scrubbed == original:
        return False
    p.write_text(scrubbed, encoding="utf-8")
    return True


def main():
    targets = []
    for ext in ("*.tsx", "*.ts", "*.py"):
        targets.extend(ROOT.rglob(ext))
    changed = 0
    for p in targets:
        if "/node_modules/" in str(p) or "/python-bundle/" in str(p):
            continue
        if process_file(p):
            changed += 1
            print(f"  scrubbed: {p.relative_to(ROOT)}")
    print(f"\n{changed} files modified.")


if __name__ == "__main__":
    main()
