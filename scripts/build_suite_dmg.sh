#!/usr/bin/env bash
# Build the unified RTMcompare bundle distribution DMG — one mountable
# image carrying every shipping macOS artifact + the doc package:
#
#   RTMcompare bundle 5.0.8/
#   ├── RTMcompare.app
#   ├── RTMprofile.app
#   ├── RTM Send installer.pkg
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
VERSION="5.2.2"
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
PLUGIN_PKG="${PROJECT}/rtm-send-plugin/release/RTM-Send-1.0.0.pkg"
PLUGIN_DMG="${PROJECT}/rtm-send-plugin/release/RTM-Send-1.0.0.dmg"
DOC_MANUAL="${PROJECT}/release/v5.2.2/MANUAL.pdf"
DOC_FEATURES="${PROJECT}/release/v5.2.2/FEATURES.pdf"
DOC_PITCH="${PROJECT}/release/v5.2.2/PITCH-DECK.pdf"

# Sanity-check sources exist.
for path in "$RTMCOMPARE_APP" "$RTMPROFILE_APP" "$PLUGIN_PKG" \
            "$DOC_MANUAL" "$DOC_FEATURES" "$DOC_PITCH"; do
  [[ -e "$path" ]] || { echo "Missing source: $path" >&2; exit 1; }
done

mkdir -p "$OUT_DIR"
rm -rf "$STAGE" "$DMG_OUT"
mkdir -p "$STAGE/Documentation"

echo "==> Staging artifacts"
cp -R "$RTMCOMPARE_APP" "$STAGE/"
cp -R "$RTMPROFILE_APP" "$STAGE/"
cp    "$PLUGIN_PKG"    "$STAGE/RTM Send installer.pkg"
[[ -f "$PLUGIN_DMG" ]] && cp "$PLUGIN_DMG" "$STAGE/RTM Send installer.dmg"
cp    "$DOC_MANUAL"     "$STAGE/Documentation/Manual.pdf"
cp    "$DOC_FEATURES"   "$STAGE/Documentation/Features.pdf"
cp    "$DOC_PITCH"      "$STAGE/Documentation/Pitch Deck.pdf"
ln -s /Applications "$STAGE/Applications"

cat >"$STAGE/README.txt" <<EOF
RTMcompare bundle ${VERSION}

Three apps. One toolkit.

  RTMcompare.app    — the analyser. A/B compare, single-file QC,
                      album batch, Atmos, streaming-platform preview,
                      master-chain render. Drag onto Applications.
  RTMprofile.app    — turn your back catalogue into a target reference.
                      Drag onto Applications.
  RTM Send installer.pkg — installs the AU + VST3 + Standalone plugin
                      bundle to the canonical macOS plugin folders.
                      Double-click to run.

Documentation/      — Manual, Features, Pitch Deck (PDFs)

Notes:
- Open both .app files from /Applications, not from this DMG window.
  macOS App Translocation will refuse to launch them otherwise.
- Everything is signed (Developer ID Application) and notarized.

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
