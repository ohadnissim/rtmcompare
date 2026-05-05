#!/bin/bash
# Drives RTMcompare via cliclick to switch tabs and capture each view.
# Tabs: OVERVIEW=1, MASTERING DELTA=2, DELIVERY=3, STEREO&SPECTRUM=4,
#       EQ MATCH=5, BREAKDOWN=6, QUALITY=7

set -e
OUT="/Users/ohadnissim/Downloads/Compare App/commercial-clips/v14-build"
WIN_RECT="120,50,1600,945"

cap() {
  local name="$1"
  screencapture -R "$WIN_RECT" -o -t png "${OUT}/${name}.png"
  echo "  captured ${name}"
}

# Activate window
osascript -e 'tell application "RTMcompare" to activate'
sleep 0.8

press_tab() {
  # cliclick uses t: to type text; numeric keys aren't kp keys
  cliclick "t:$1"
  sleep 1.5
}

# Make sure focus is on app body, not a text input
cliclick c:800,500
sleep 0.5

# Tab 1 — OVERVIEW (Main + A/B Player + Overall Summary)
press_tab 1
cap "01-overview-top"
# scroll down to capture overall summary section
cliclick c:800,500 ; sleep 0.2
cliclick kp:page-down ; sleep 0.8
cap "02-overview-summary"
cliclick kp:page-down ; sleep 0.8
cap "03-overview-bottom"
# scroll back to top
cliclick kp:home ; sleep 0.5

# Tab 2 — MASTERING DELTA
press_tab 2
cap "04-mastering-delta"
cliclick kp:page-down ; sleep 0.8
cap "05-mastering-delta-bottom"
cliclick kp:home ; sleep 0.5

# Tab 3 — DELIVERY (Streaming Normalization)
press_tab 3
cap "06-streaming-normalization"
cliclick kp:page-down ; sleep 0.8
cap "07-streaming-normalization-bottom"
cliclick kp:home ; sleep 0.5

# Tab 4 — STEREO & SPECTRUM (Frequency Spectrum)
press_tab 4
cap "08-frequency-spectrum"
cliclick kp:page-down ; sleep 0.8
cap "09-frequency-spectrum-bottom"
cliclick kp:home ; sleep 0.5

# Tab 5 — EQ MATCH (Engineer)
press_tab 5
cap "10-eq-match-top"
cliclick kp:page-down ; sleep 0.8
cap "11-eq-tips"
cliclick kp:page-down ; sleep 0.8
cap "12-eq-preview"
cliclick kp:home ; sleep 0.5

# Tab 6 — BREAKDOWN (Tonal Issues + Per Element)
press_tab 6
cap "13-tonal-breakdown"
cliclick kp:page-down ; sleep 0.8
cap "14-per-element"
cliclick kp:page-down ; sleep 0.8
cap "15-per-element-bottom"
cliclick kp:home ; sleep 0.5

# Tab 7 — QUALITY (Limiter Artifacts + Distortion)
press_tab 7
cap "16-quality-limiter"
cliclick kp:page-down ; sleep 0.8
cap "17-distortion-check"
cliclick kp:home ; sleep 0.5

# Back to OVERVIEW for final A/B player + engineer header view
press_tab 1
cap "18-overview-final"

echo "All views captured."
ls -la "$OUT"/*.png | grep -E "^.*[0-9]{2}-" | head -25
