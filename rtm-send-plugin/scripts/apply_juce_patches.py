#!/usr/bin/env python3
"""Apply RTM's forked-JUCE patches to a freshly-cloned stock JUCE tree.

P0-2: CI clones stock JUCE 8.0.12, which does NOT contain RTM's fixes — so
CI-built binaries silently reintroduce bugs that are fixed in the local tree
(most importantly the AAX/Pro-Tools white-screen: viewMovedToWindow must force
a repaint so the first paint fires once a real NSWindow exists).

This script is idempotent (safe to re-run) and SELF-VERIFYING: it exits non-zero
if any required fix is not present after patching, so the build fails LOUDLY
rather than silently shipping the bug.

Usage:  python3 apply_juce_patches.py <path-to-JUCE>
"""
import re
import sys
from pathlib import Path

# Each patch: (relative path in JUCE, human name, the marker that proves it's
# applied, a function that returns patched text or None if it couldn't apply).
PEER = "modules/juce_gui_basics/native/juce_NSViewComponentPeer_mac.mm"

REPAINT_MARKER = "getComponent().repaint();"

# Stock 8.0.12 form (flexible whitespace):
#     if (shouldSetVisible)
#         getComponent().setVisible (true);
STOCK_RE = re.compile(
    r"if \(shouldSetVisible\)\s*\n\s*getComponent\(\)\.setVisible \(true\);"
)
PATCHED_BLOCK = (
    "if (shouldSetVisible)\n"
    "            {\n"
    "                getComponent().setVisible (true);\n"
    "                // RTM fork: if the component was already marked visible (e.g. the\n"
    "                // AAX wrapper called setVisible before addToDesktop), setVisible is a\n"
    "                // no-op and no repaint is queued. Force one so the first paint fires\n"
    "                // now that we have a real window to draw into (fixes PT white-screen).\n"
    "                getComponent().repaint();\n"
    "            }"
)


def patch_peer(text: str):
    if REPAINT_MARKER in text:
        return text  # already patched (local fork or prior run)
    new, n = STOCK_RE.subn(PATCHED_BLOCK, text, count=1)
    return new if n == 1 else None


PATCHES = [(PEER, "viewMovedToWindow repaint (PT white-screen)", REPAINT_MARKER, patch_peer)]


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: apply_juce_patches.py <path-to-JUCE>", file=sys.stderr)
        return 2
    juce = Path(sys.argv[1])
    if not juce.is_dir():
        print(f"ERROR: JUCE dir not found: {juce}", file=sys.stderr)
        return 2

    failed = False
    for rel, name, marker, fn in PATCHES:
        f = juce / rel
        if not f.is_file():
            print(f"ERROR: missing JUCE file for patch '{name}': {f}", file=sys.stderr)
            failed = True
            continue
        text = f.read_text()
        out = fn(text)
        if out is None:
            print(f"ERROR: could not apply patch '{name}' — stock pattern not found in {rel}. "
                  f"JUCE version may have changed; update apply_juce_patches.py.", file=sys.stderr)
            failed = True
            continue
        if out != text:
            f.write_text(out)
        # hard verify
        if marker not in f.read_text():
            print(f"ERROR: verification FAILED for '{name}' — marker absent after patch.", file=sys.stderr)
            failed = True
        else:
            print(f"OK: '{name}' present in {rel}")

    if failed:
        print("JUCE PATCH GATE FAILED — refusing to build a binary missing RTM fixes.", file=sys.stderr)
        return 1
    print("All JUCE patches verified present.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
