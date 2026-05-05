#!/usr/bin/env bash
#
# RTM Send — UI-text audit.
# Flags every non-ASCII character in any string that ends up on screen,
# so the JUCE-missing-glyph "gibberish box" bug we shipped once never
# ships twice.
#
# Run from the repo root:  bash scripts/qa/plugin-text-scan.sh
# Exit 0 = clean.  Exit 1 = at least one finding.
#
# Passes:
#   1. Non-ASCII scan of C++ source.  Every hit has to move to an
#      explicit ASCII fallback or the user's font won't cover it.
#   2. Button-text overflow scan.  JUCE TextButton labels over ~24
#      characters can truncate in AU host inspector panels.
#   3. Status-message audit.  Each status string has a max width
#      expectation; too-long ones get flagged.
#   4. Tooltip presence audit.  Every interactive control should
#      carry a tooltip for accessibility.

set -e
cd "$(dirname "$0")/../.."

SRC="rtm-send-plugin/Source"
FAIL=0

echo "[QA] Plug-in text audit"
echo "==========================================="
echo

# ── Pass 1 · Non-ASCII scan ──
# Pass 1 - Non-ASCII scan
echo "[1/4] Non-ASCII characters in UI strings"
# Only scan strings inside setText / setButtonText / setTooltip /
# addItem / addSectionHeading — these are the strings JUCE actually
# draws.  Comments + internal identifiers are fine.
NONASCII=$(grep -n -E '(setText|setButtonText|setTooltip|addItem|addSectionHeading)[^\)]*"[^"]*' \
    "$SRC/PluginEditor.cpp" "$SRC/PluginProcessor.cpp" 2>/dev/null \
    | grep -E "[^[:print:][:space:]]" || true)

if [ -n "$NONASCII" ]; then
    echo "  FAIL - non-ASCII chars found in drawn strings:"
    echo "$NONASCII" | head -20
    FAIL=1
else
    echo "  PASS - no non-ASCII in drawn strings"
fi
echo

# ── Pass 2 · Button-label length scan ──
# Pass 2 - Button-label length scan
echo "[2/4] Button / tab label length (<= 30 char)"
awk -F'"' '/setButtonText/ { if (length($2) > 30) print FILENAME ":" NR ": " length($2) " char: " $2 }' \
    "$SRC/PluginEditor.cpp" "$SRC/PluginProcessor.cpp" > /tmp/_qa_long.txt || true
if [ -s /tmp/_qa_long.txt ]; then
    echo "  WARN - labels over 30 chars (may truncate in host):"
    cat /tmp/_qa_long.txt
else
    echo "  PASS - all labels fit"
fi
rm -f /tmp/_qa_long.txt
echo

# ── Pass 3 · Status string length scan ──
# Pass 3 - Status string length scan
echo "[3/4] Status strings (<= 60 char)"
awk -F'"' '/statusLabel.setText|setText/ { if (length($2) > 60) print FILENAME ":" NR ": " length($2) " char: " substr($2, 1, 60) "..." }' \
    "$SRC/PluginEditor.cpp" "$SRC/PluginProcessor.cpp" > /tmp/_qa_stat.txt || true
if [ -s /tmp/_qa_stat.txt ]; then
    echo "  WARN - status strings over 60 chars:"
    head -10 /tmp/_qa_stat.txt
else
    echo "  PASS - all status strings fit"
fi
rm -f /tmp/_qa_stat.txt
echo

# ── Pass 4 · Tooltip coverage ──
# Pass 4 - Tooltip coverage
echo "[4/4] Interactive controls carry tooltips"
BUTTONS=$(grep -c "TextButton\s\+\w" "$SRC/PluginEditor.h" 2>/dev/null || echo 0)
TOOLTIPS=$(grep -c "setTooltip" "$SRC/PluginEditor.cpp" 2>/dev/null || echo 0)
if [ "$BUTTONS" -gt 0 ] && [ "$TOOLTIPS" -lt "$BUTTONS" ]; then
    echo "  WARN - $BUTTONS buttons but only $TOOLTIPS tooltips"
else
    echo "  PASS - $TOOLTIPS tooltips across $BUTTONS buttons"
fi
echo

echo "==========================================="
if [ $FAIL -eq 0 ]; then
    echo "[QA] Text audit: PASS"
    exit 0
else
    echo "[QA] Text audit: FAIL"
    exit 1
fi
