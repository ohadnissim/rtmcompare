#!/usr/bin/env bash
# Build a signed + notarized Mac .pkg installer for the RTM Send plugin.
#
# Layout placed by the installer:
#   /Library/Audio/Plug-Ins/Components/RTM Send.component   (AU)
#   /Library/Audio/Plug-Ins/VST3/RTM Send.vst3              (VST3)
#   /Applications/RTM Send.app                              (Standalone)
#
# AAX is intentionally skipped — Avid's Eden/PACE signing is gated on a
# separate developer relationship and isn't part of this installer pass
# (per codex plugin QA, Apr 2026).
#
# Prereqs: plugin already built at ../build/RtmSend_artefacts/Release/.
# Pass --skip-build to skip rebuilding when iterating on packaging.
#
# Codesign + notarize using Developer ID + the rtm-notary keychain
# profile (same one used for RTMcompare).

set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$PLUGIN_ROOT/build"
# 5.7.x: artefacts now land directly under RtmSend_artefacts/<format>/.
# The old Release/ subdir was a CMake/Xcode generator quirk that no
# longer applies on the Ninja/Make build we run today.
ART_DIR="$BUILD_DIR/RtmSend_artefacts"
PKG_OUT="$PLUGIN_ROOT/release/RTM-Send-1.2.0.pkg"
PKG_STAGE="$PLUGIN_ROOT/release/.pkg-stage"
DEV_ID_APP="Developer ID Application: Ohad Nissim (3RL52RHGT3)"
DEV_ID_INSTALLER="Developer ID Installer: Ohad Nissim (3RL52RHGT3)"
NOTARY_PROFILE="rtm-notary"

cd "$PLUGIN_ROOT"
mkdir -p release
rm -rf "$PKG_STAGE"
mkdir -p "$PKG_STAGE/Library/Audio/Plug-Ins/Components"
mkdir -p "$PKG_STAGE/Library/Audio/Plug-Ins/VST3"
mkdir -p "$PKG_STAGE/Applications"

# Skip rebuild only when the user explicitly opts in — by default a fresh
# build run guarantees the source changes are in the installer.
if [[ "${1-}" != "--skip-build" ]]; then
  echo "==> Rebuilding plugin"
  rm -rf "$BUILD_DIR"
  # JUCE was cloned next to the project; keep COPY_PLUGIN_AFTER_BUILD off
  # so the build doesn't try to write to /Library without sudo — the
  # installer is the sanctioned install path now.
  cmake -S . -B "$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE=Release \
    -DJUCE_DIR="${JUCE_DIR:-/Users/ohadnissim/Downloads/JUCE}" \
    -DJUCE_COPY_PLUGIN_AFTER_BUILD=OFF \
    -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0 \
    -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64"
  cmake --build "$BUILD_DIR" --config Release -j8
fi

# Verify artifacts.
for path in \
  "$ART_DIR/AU/RTM Send.component" \
  "$ART_DIR/VST3/RTM Send.vst3" \
  "$ART_DIR/Standalone/RTM Send.app"; do
  [[ -d "$path" ]] || { echo "Missing: $path" >&2; exit 1; }
done

echo "==> Code-signing each bundle"
codesign --force --deep --options runtime --timestamp \
  --sign "$DEV_ID_APP" \
  "$ART_DIR/AU/RTM Send.component"
codesign --force --deep --options runtime --timestamp \
  --sign "$DEV_ID_APP" \
  "$ART_DIR/VST3/RTM Send.vst3"
codesign --force --deep --options runtime --timestamp \
  --sign "$DEV_ID_APP" \
  "$ART_DIR/Standalone/RTM Send.app"

echo "==> Verifying signatures"
codesign --verify --strict --verbose=2 "$ART_DIR/AU/RTM Send.component"
codesign --verify --strict --verbose=2 "$ART_DIR/VST3/RTM Send.vst3"
codesign --verify --strict --verbose=2 "$ART_DIR/Standalone/RTM Send.app"

echo "==> Staging installer payload"
cp -R "$ART_DIR/AU/RTM Send.component"   "$PKG_STAGE/Library/Audio/Plug-Ins/Components/"
cp -R "$ART_DIR/VST3/RTM Send.vst3"      "$PKG_STAGE/Library/Audio/Plug-Ins/VST3/"
cp -R "$ART_DIR/Standalone/RTM Send.app" "$PKG_STAGE/Applications/"

echo "==> Building unsigned component .pkg"
UNSIGNED_PKG="$PLUGIN_ROOT/release/.unsigned.pkg"
pkgbuild \
  --root "$PKG_STAGE" \
  --identifier com.rtmsuite.rtmsend.installer \
  --version 1.2.0 \
  --install-location / \
  "$UNSIGNED_PKG"

echo "==> Signing + producing distribution .pkg"
productbuild \
  --package "$UNSIGNED_PKG" \
  --sign "$DEV_ID_INSTALLER" \
  "$PKG_OUT"

rm -f "$UNSIGNED_PKG"

echo "==> Submitting for notarization"
xcrun notarytool submit "$PKG_OUT" \
  --keychain-profile "$NOTARY_PROFILE" \
  --wait

echo "==> Stapling"
xcrun stapler staple "$PKG_OUT"
xcrun stapler validate "$PKG_OUT"

shasum -a 256 "$PKG_OUT" >"$PKG_OUT.sha256"
echo ""
echo "Done: $PKG_OUT"
cat "$PKG_OUT.sha256"
