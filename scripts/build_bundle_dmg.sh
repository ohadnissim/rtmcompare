#!/usr/bin/env bash
# Build the RTMcompare bundle DMG — apps + RTM Send plugin direct in window.
#
#   RTMcompare bundle 7.6.0/
#   ├── RTMcompare.app        → drag to Applications
#   ├── RTMprofile.app        → drag to Applications
#   ├── RTM Send.vst3         → drag to VST3 Plugins
#   ├── RTM Send.component    → drag to AU Plugins
#   ├── Applications  ──────→ /Applications
#   ├── VST3 Plugins  ──────→ /Library/Audio/Plug-Ins/VST3
#   ├── AU Plugins    ──────→ /Library/Audio/Plug-Ins/Components
#   └── README.txt
#
# Usage:
#   ./build_bundle_dmg.sh            # defaults to arm64
#   ./build_bundle_dmg.sh arm64
#   ./build_bundle_dmg.sh intel      # x86_64
#
# Produces:
#   release/RTMcompare-bundle-7.6.0-arm64.dmg  (+ .sha256)
#   release/RTMcompare-bundle-7.6.0-intel.dmg  (+ .sha256)
#
# Requires: hdiutil, codesign, xcrun notarytool, xcrun stapler.
# Keychain profile "rtm-notary" must be configured:
#   xcrun notarytool store-credentials rtm-notary --apple-id <email> --team-id 3RL52RHGT3

set -euo pipefail

PROJECT="/Users/ohadnissim/Claude/Compare/Compare App"
VERSION="7.6.5"
DEV_ID_APP="Developer ID Application: Ohad Nissim (3RL52RHGT3)"
NOTARY_PROFILE="rtm-notary"
OUT_DIR="${PROJECT}/release"

# ── Architecture ─────────────────────────────────────────────────────────────
ARCH="${1:-arm64}"
case "$ARCH" in
  arm64)         ARCH_SUFFIX="arm64" ;;
  intel|x86_64)  ARCH_SUFFIX="intel" ; ARCH="x86_64" ;;
  *)             echo "Usage: $0 [arm64|intel]" >&2 ; exit 1 ;;
esac

# ── Paths ─────────────────────────────────────────────────────────────────────
if [[ "$ARCH" == "arm64" ]]; then
  RTMCOMPARE_APP="${PROJECT}/release-build/mac-arm64/RTMcompare.app"
  RTMPROFILE_APP="${PROJECT}/rtm-profile-app/release-build/mac-arm64/RTMprofile.app"
else
  RTMCOMPARE_APP="${PROJECT}/release-build/mac/RTMcompare.app"
  RTMPROFILE_APP="${PROJECT}/rtm-profile-app/release-build/mac/RTMprofile.app"
fi

# RTM Send plugins are universal binaries — same for both arches.
PLUGIN_VST3="${PROJECT}/rtm-send-plugin/build/RtmSend_artefacts/VST3/RTM Send.vst3"
PLUGIN_AU="${PROJECT}/rtm-send-plugin/build/RtmSend_artefacts/AU/RTM Send.component"

NAME="RTMcompare-bundle-${VERSION}-${ARCH_SUFFIX}"
VOL="RTMcompare bundle ${VERSION}"
DMG_OUT="${OUT_DIR}/${NAME}.dmg"
STAGE="${OUT_DIR}/.${NAME}-stage"

# ── Preflight ─────────────────────────────────────────────────────────────────
echo "==> Checking sources (arch: ${ARCH_SUFFIX})"
for path in "$RTMCOMPARE_APP" "$RTMPROFILE_APP" "$PLUGIN_VST3" "$PLUGIN_AU"; do
  [[ -e "$path" ]] || { echo "MISSING: $path" >&2; exit 1; }
done

# ── Sign plugins ──────────────────────────────────────────────────────────────
# The JUCE make build does not code-sign; sign here before staging so that
# every bundle in the DMG satisfies Apple notarization requirements.
echo "==> Signing RTM Send plugins"
codesign --force --deep --options runtime --timestamp \
  --sign "$DEV_ID_APP" "$PLUGIN_VST3"
codesign --force --deep --options runtime --timestamp \
  --sign "$DEV_ID_APP" "$PLUGIN_AU"

mkdir -p "$OUT_DIR"
rm -rf "$STAGE" "$DMG_OUT"
mkdir -p "$STAGE"

# ── Stage ─────────────────────────────────────────────────────────────────────
echo "==> Staging artifacts"
cp -R "$RTMCOMPARE_APP"  "$STAGE/"
cp -R "$RTMPROFILE_APP"  "$STAGE/"
cp -R "$PLUGIN_VST3"     "$STAGE/"
cp -R "$PLUGIN_AU"       "$STAGE/"

# Symlinks — give users a clear drop target for each bundle type.
ln -s /Applications                              "$STAGE/Applications"
ln -s "/Library/Audio/Plug-Ins/VST3"            "$STAGE/VST3 Plugins"
ln -s "/Library/Audio/Plug-Ins/Components"      "$STAGE/AU Plugins"

cat >"$STAGE/README.txt" <<EOF
RTMcompare bundle ${VERSION} — ${ARCH_SUFFIX}

Three apps. One toolkit.

  RTMcompare.app      — A/B compare, QC, batch, Atmos, streaming preview,
                        master-chain render, Learn Mode.
                        Drag onto Applications (or the Applications alias).

  RTMprofile.app      — Turn your back catalogue into a target reference.
                        Drag onto Applications.

  RTM Send.vst3       — DAW plugin. Drag onto "VST3 Plugins" (alias to
                        /Library/Audio/Plug-Ins/VST3). Restart your DAW.

  RTM Send.component  — Audio Unit version of RTM Send. Drag onto
                        "AU Plugins" (alias to
                        /Library/Audio/Plug-Ins/Components). Restart Logic.

Tips:
- Launch RTMcompare and RTMprofile from /Applications, not from this DMG
  window — macOS App Translocation will block them otherwise.
- RTM Send is a universal binary (Apple Silicon + Intel).
- Everything is signed (Developer ID Application) and notarized.

RTMcompare ${VERSION} — © 2026 Ohad Nissim — all features run locally.
EOF

# ── DMG ───────────────────────────────────────────────────────────────────────
echo "==> Building DMG: ${NAME}.dmg"
hdiutil create \
  -volname "$VOL" \
  -srcfolder "$STAGE" \
  -ov -format UDZO \
  "$DMG_OUT"

# ── Sign ──────────────────────────────────────────────────────────────────────
echo "==> Signing DMG"
codesign --force --sign "$DEV_ID_APP" --timestamp "$DMG_OUT"

# ── Notarize ──────────────────────────────────────────────────────────────────
echo "==> Submitting for notarization (this takes a few minutes)"
xcrun notarytool submit "$DMG_OUT" \
  --keychain-profile "$NOTARY_PROFILE" \
  --wait

# ── Staple ────────────────────────────────────────────────────────────────────
echo "==> Stapling"
xcrun stapler staple "$DMG_OUT"
xcrun stapler validate "$DMG_OUT"
spctl -a -v -t open --context context:primary-signature "$DMG_OUT" 2>&1

# ── SHA-256 ───────────────────────────────────────────────────────────────────
shasum -a 256 "$DMG_OUT" >"${DMG_OUT}.sha256"
rm -rf "$STAGE"

echo ""
echo "✅ Done: $DMG_OUT"
ls -lh "$DMG_OUT"
cat "${DMG_OUT}.sha256"
