#!/usr/bin/env bash
# Build the unified RTMcompare bundle distribution DMG — one mountable
# image carrying every shipping macOS artifact + the doc package:
#
#   RTMcompare bundle 5.0.8/
#   ├── RTMcompare.app
#   ├── RTMprofile.app
#   ├── RTM Send installer.dmg
#   ├── Documentation/
#   │   ├── Manual.pdf
#   │   ├── Features.pdf
#   │   └── Pitch Deck.pdf
#   ├── Applications  (symlink → /Applications)
#   └── README.txt
#
# Signed with Developer ID Application, notarized + stapled, SHA-256
# alongside.

set -euo pipefail

PROJECT="/Users/ohadnissim/Claude/Compare/Compare App"
VERSION="5.7.2"
NAME="RTMcompare-bundle-${VERSION}"
VOL="RTMcompare bundle ${VERSION}"
OUT_DIR="${PROJECT}/release"
DMG_OUT="${OUT_DIR}/${NAME}.dmg"
STAGE="${OUT_DIR}/.${NAME}-stage"
DEV_ID_APP="Developer ID Application: Ohad Nissim (3RL52RHGT3)"
NOTARY_PROFILE="rtm-notary"

# Sources (every signed/notarized artifact already on disk).
RTMCOMPARE_APP="${PROJECT}/release-build/mac-arm64/RTMcompare.app"
RTMPROFILE_APP="${PROJECT}/rtm-profile-app/release-build/mac-arm64/RTMprofile.app"
# 5.7.x: Developer ID Installer cert isn't in the build keychain right
# now, so productbuild can't sign a PKG. We ship the notarized DMG
# instead — same end-user experience (double-click to install), works
# with the Developer ID Application cert we DO have. Drop PKG entirely.
PLUGIN_DMG="${PROJECT}/rtm-send-plugin/release/RTM-Send-1.2.0.dmg"
DOC_MANUAL="${PROJECT}/release/v5.7.0/MANUAL.pdf"
DOC_FEATURES="${PROJECT}/release/v5.7.0/FEATURES.pdf"
DOC_PITCH="${PROJECT}/release/v5.7.0/PITCH-DECK.pdf"
DOC_CHANGELOG="${PROJECT}/release/v5.7.0/CHANGELOG.pdf"

# Sanity-check sources exist.
for path in "$RTMCOMPARE_APP" "$RTMPROFILE_APP" "$PLUGIN_DMG" \
            "$DOC_MANUAL" "$DOC_FEATURES" "$DOC_PITCH" "$DOC_CHANGELOG"; do
  [[ -e "$path" ]] || { echo "Missing source: $path" >&2; exit 1; }
done

mkdir -p "$OUT_DIR"
rm -rf "$STAGE" "$DMG_OUT"
mkdir -p "$STAGE/Documentation"

echo "==> Staging artifacts"
cp -R "$RTMCOMPARE_APP" "$STAGE/"
cp -R "$RTMPROFILE_APP" "$STAGE/"
# 5.7.x: ship the RTM Send installer as a DMG (signed + notarized +
# stapled with Developer ID Application). Same end-user experience —
# user opens the DMG, drags the .vst3/.component/.app into the matching
# /Library folder. No PKG cert needed.
cp "$PLUGIN_DMG" "$STAGE/RTM Send installer.dmg"
cp    "$DOC_MANUAL"     "$STAGE/Documentation/Manual.pdf"
cp    "$DOC_FEATURES"   "$STAGE/Documentation/Features.pdf"
cp    "$DOC_PITCH"      "$STAGE/Documentation/Pitch Deck.pdf"
cp    "$DOC_CHANGELOG"  "$STAGE/Documentation/Changelog.pdf"
ln -s /Applications "$STAGE/Applications"

cat >"$STAGE/README.txt" <<EOF
RTMcompare bundle ${VERSION}

Three apps. One toolkit.

  RTMcompare.app    — the analyser. A/B compare, single-file QC,
                      album batch, Atmos, streaming-platform preview,
                      master-chain render. Drag onto Applications.
  RTMprofile.app    — turn your back catalogue into a target reference.
                      Drag onto Applications.
  RTM Send installer.dmg — open it, drag the AU / VST3 / Standalone
                      bundles into the matching /Library/Audio/Plug-Ins
                      folder (the DMG window shows them all in one
                      place). New in 1.2.0: hosts your favourite EQ
                      and lets RTMcompare write recommended moves
                      directly into the live plugin in your DAW.

Documentation/      — Manual, Features, Pitch Deck (PDFs)

Notes:
- Open both .app files from /Applications, not from this DMG window.
  macOS App Translocation will refuse to launch them otherwise.
- Everything is signed (Developer ID Application) and notarized.

What's new in 5.7.1 (patch):
- Bullet-proofed RTMsend's third-party plugin hosting: callback-lock
  serialisation around prepareToPlay / releaseResources / load / unload
  (was racy on Reaper, Bitwig, Studio One project recall).
- Hosted-plugin fault state separated from user-toggle state — a plugin
  that throws on processBlock now surfaces as "faulted, reload it"
  instead of silently looking disabled.
- Worker-thread setStateInformation no longer hangs the host if the
  message thread is blocked elsewhere.
- All juce::String fields locked against torn-pointer concurrent reads.
- Connection indicator polls every 4s; recommendation chips disabled
  unless RTMsend is actually reachable.

What's new in 5.7.0:
- Send-to-Plugin: RTMcompare pushes EQ recommendations into a hosted
  EQ inside RTMsend, live in your DAW. 16 EQs profiled out of the box
  (Pro-Q 4/3, Kirchhoff, bx_digital V3, SSL 4000 E/G/J, Maag EQ4,
  elysia museq, SPL PQ, Lindell EQ825, Sontec MES432D9D, MixWave
  Pultec EQP-1S3, Ozone 12 EQ, MixWave DW Fearn VT-5).
- Smoothed tonal recommender: tuned-kick fundamentals stop reading as
  broad-band imbalances. Tonal Curve chart, region bars, EQ chips,
  and EQ moves all live in the same number-space now.
- Loudness tip: fires when the master is off-target vs the engineer's
  cohort average (±0.5 / ±1.0 / ±1.5 LU bands).
- Per-Element Breakdown moved to top of Breakdown tab. All 7 cards
  visible by default. Powered by BS-RoFormer 4-stem.
- ARA-aware in Studio One, Cubase/Nuendo, Reaper, Bitwig. Wavelab
  Pro 13 falls back to the 30-second ring buffer (host limitation).

RTMcompare ${VERSION} — © 2026 Ohad Nissim — all features run locally
EOF

echo "==> Building DMG"
hdiutil create \
  -volname "$VOL" \
  -srcfolder "$STAGE" \
  -ov -format UDZO \
  "$DMG_OUT"

echo "==> Signing DMG"
codesign --force --sign "$DEV_ID_APP" --timestamp "$DMG_OUT"

echo "==> Submitting for notarization"
xcrun notarytool submit "$DMG_OUT" \
  --keychain-profile "$NOTARY_PROFILE" \
  --wait

echo "==> Stapling"
xcrun stapler staple "$DMG_OUT"
xcrun stapler validate "$DMG_OUT"

shasum -a 256 "$DMG_OUT" >"${DMG_OUT}.sha256"
rm -rf "$STAGE"

echo ""
echo "Done: $DMG_OUT"
ls -lh "$DMG_OUT"
cat "${DMG_OUT}.sha256"
