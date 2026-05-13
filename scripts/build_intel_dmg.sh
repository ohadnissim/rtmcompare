#!/usr/bin/env bash
# Build RTMcompare Intel (x86_64) bundle DMG
#
# Packages the already-built Intel artifacts into a bundle DMG:
#
#   RTMcompare bundle 7.6.2 Intel/
#   ├── RTMcompare.app        → drag to Applications
#   ├── RTMprofile.app        → drag to Applications
#   ├── RTM Send.vst3         → drag to VST3 Plugins
#   ├── RTM Send.component    → drag to AU Plugins
#   ├── Applications  ──────→ /Applications
#   ├── VST3 Plugins  ──────→ /Library/Audio/Plug-Ins/VST3
#   ├── AU Plugins    ──────→ /Library/Audio/Plug-Ins/Components
#   └── README.txt
#
# Prerequisites:
#   - npm run pack must have been run (produces release-build/mac-x64/RTMcompare.app
#     and release-build/mac/RTMcompare.app after electron-builder x64 build)
#   - rtm-profile-app x64 must be built similarly
#   - RTM Send.vst3 / RTM Send.component must be built (universal binary)
#
# Run from project root:
#   bash scripts/build_intel_dmg.sh

set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="7.6.2"
DEV_ID_APP="Developer ID Application: Ohad Nissim (3RL52RHGT3)"
NOTARY_PROFILE="rtm-notary"
OUT_DIR="${PROJECT}/release"

NAME="RTMcompare-bundle-${VERSION}-intel"
VOL="RTMcompare bundle ${VERSION} Intel"
DMG_OUT="${OUT_DIR}/${NAME}.dmg"
STAGE="${OUT_DIR}/.${NAME}-stage"

# ── Source paths ──────────────────────────────────────────────────────────────
# electron-builder outputs x64 to mac-x64 (when arm64 also built) or mac/
RTMCOMPARE_APP="${PROJECT}/release-build/mac-x64/RTMcompare.app"
RTMPROFILE_APP="${PROJECT}/rtm-profile-app/release-build/mac-x64/RTMprofile.app"

# Fallback to mac/ if mac-x64/ is absent (older electron-builder output dir)
if [[ ! -d "$RTMCOMPARE_APP" ]] && [[ -d "${PROJECT}/release-build/mac/RTMcompare.app" ]]; then
  RTMCOMPARE_APP="${PROJECT}/release-build/mac/RTMcompare.app"
fi
if [[ ! -d "$RTMPROFILE_APP" ]] && [[ -d "${PROJECT}/rtm-profile-app/release-build/mac/RTMprofile.app" ]]; then
  RTMPROFILE_APP="${PROJECT}/rtm-profile-app/release-build/mac/RTMprofile.app"
fi

# RTM Send plugins — universal binaries, same for both arches
PLUGIN_VST3="${PROJECT}/rtm-send-plugin/build/RtmSend_artefacts/VST3/RTM Send.vst3"
PLUGIN_AU="${PROJECT}/rtm-send-plugin/build/RtmSend_artefacts/AU/RTM Send.component"

# ── Preflight ─────────────────────────────────────────────────────────────────
echo "==> Checking sources (arch: intel)"
for path in "$RTMCOMPARE_APP" "$RTMPROFILE_APP" "$PLUGIN_VST3" "$PLUGIN_AU"; do
  [[ -e "$path" ]] || { echo "MISSING: $path" >&2; exit 1; }
done

# Verify intel binary
ARCH_CHECK=$(file "${RTMCOMPARE_APP}/Contents/MacOS/RTMcompare" 2>/dev/null || true)
echo "    RTMcompare arch: $ARCH_CHECK"

mkdir -p "$OUT_DIR"
rm -rf "$STAGE" "$DMG_OUT"
mkdir -p "$STAGE"

# ── Stage ─────────────────────────────────────────────────────────────────────
echo "==> Staging artifacts"
cp -R "$RTMCOMPARE_APP"  "$STAGE/"
cp -R "$RTMPROFILE_APP"  "$STAGE/"
cp -R "$PLUGIN_VST3"     "$STAGE/"
cp -R "$PLUGIN_AU"       "$STAGE/"

# Symlinks — clear drop targets for each bundle type
ln -s /Applications                          "$STAGE/Applications"
ln -s "/Library/Audio/Plug-Ins/VST3"        "$STAGE/VST3 Plugins"
ln -s "/Library/Audio/Plug-Ins/Components"  "$STAGE/AU Plugins"

cat >"$STAGE/README.txt" <<EOF
RTMcompare bundle ${VERSION} — Intel (x86_64)

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
