#!/usr/bin/env bash
# Build a signed + notarized DMG distribution of RTM Send (AU + VST3 +
# Standalone). User drags each bundle into the matching folder; the DMG
# layout includes shortcuts to ~/Library/Audio/Plug-Ins/Components,
# ~/Library/Audio/Plug-Ins/VST3, and /Applications.
#
# This is the path we use because we don't have a "Developer ID
# Installer" cert (needed for productbuild .pkg signing) — only the
# "Developer ID Application" cert. The Application cert is enough to
# sign + notarize the DMG and the bundles inside, which is the same
# trust path any well-behaved indie plugin uses (TDR, Melda, etc.).
#
# Pass --skip-build to skip rebuilding when iterating on packaging.

set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$PLUGIN_ROOT/build"
# 5.7.x: artefacts land directly under RtmSend_artefacts/<format>/.
ART_DIR="$BUILD_DIR/RtmSend_artefacts"
DMG_OUT="$PLUGIN_ROOT/release/RTM-Send-1.2.0.dmg"
DMG_STAGE="$PLUGIN_ROOT/release/.dmg-stage"
DEV_ID_APP="Developer ID Application: Ohad Nissim (3RL52RHGT3)"
NOTARY_PROFILE="rtm-notary"
ENT_FILE="$PLUGIN_ROOT/scripts/entitlements.plist"

cd "$PLUGIN_ROOT"
mkdir -p release
rm -rf "$DMG_STAGE"
mkdir -p "$DMG_STAGE"

# Hardened-runtime entitlements for the audio plugins. JUCE plugins
# need just the basics: audio I/O, no library validation (so the host
# can load them), no app-sandbox (plugins are loaded into the host's
# process and run in its sandbox, not their own).
if [[ ! -f "$ENT_FILE" ]]; then
  cat >"$ENT_FILE" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.device.audio-input</key>
  <true/>
</dict>
</plist>
PLIST
fi

if [[ "${1-}" != "--skip-build" ]]; then
  echo "==> Rebuilding plugin"
  rm -rf "$BUILD_DIR"
  cmake -S . -B "$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE=Release \
    -DJUCE_DIR="${JUCE_DIR:-/Users/ohadnissim/Downloads/JUCE}" \
    -DJUCE_COPY_PLUGIN_AFTER_BUILD=OFF \
    -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0 \
    -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64"
  cmake --build "$BUILD_DIR" --config Release -j8
fi

for path in \
  "$ART_DIR/AU/RTM Send.component" \
  "$ART_DIR/VST3/RTM Send.vst3" \
  "$ART_DIR/Standalone/RTM Send.app"; do
  [[ -d "$path" ]] || { echo "Missing: $path" >&2; exit 1; }
done

echo "==> Code-signing each bundle (hardened runtime + entitlements)"
for path in \
  "$ART_DIR/AU/RTM Send.component" \
  "$ART_DIR/VST3/RTM Send.vst3" \
  "$ART_DIR/Standalone/RTM Send.app"; do
  codesign --force --deep --options runtime --timestamp \
    --entitlements "$ENT_FILE" \
    --sign "$DEV_ID_APP" \
    "$path"
done

echo "==> Verifying signatures"
for path in \
  "$ART_DIR/AU/RTM Send.component" \
  "$ART_DIR/VST3/RTM Send.vst3" \
  "$ART_DIR/Standalone/RTM Send.app"; do
  codesign --verify --strict --verbose=2 "$path"
done

echo "==> Staging DMG payload"
cp -R "$ART_DIR/AU/RTM Send.component"   "$DMG_STAGE/"
cp -R "$ART_DIR/VST3/RTM Send.vst3"      "$DMG_STAGE/"
cp -R "$ART_DIR/Standalone/RTM Send.app" "$DMG_STAGE/"

# Drag-target shortcuts. 5.7.x: point at the SYSTEM-wide /Library
# locations. Most DAWs (Logic, Pro Tools, Wavelab) scan /Library by
# default and treat ~/Library as a secondary path or ignore it; users
# who installed via these shortcuts to ~/Library before were sometimes
# missing the plugin from their DAW's list. /Library requires admin
# rights to write, so the user gets a Finder authentication prompt on
# the drag — that's expected and matches every other commercial plugin.
ln -s "/Library/Audio/Plug-Ins/Components" "$DMG_STAGE/Components (drag here)" 2>/dev/null || true
ln -s "/Library/Audio/Plug-Ins/VST3"       "$DMG_STAGE/VST3 (drag here)" 2>/dev/null || true
ln -s "/Applications"                       "$DMG_STAGE/Applications (drag here)" 2>/dev/null || true

# Quick installer the user can double-click — copies everything into
# the right places without making them open three Finder windows.
# Uses sudo for the /Library/ paths; the user enters their password once.
cat >"$DMG_STAGE/Install RTM Send.command" <<'EOF'
#!/usr/bin/env bash
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "Installing RTM Send to /Library/Audio/Plug-Ins/ (system-wide)."
echo "You'll be asked for your admin password once."
echo ""

# /Library/ requires admin — sudo handles the elevation prompt.
sudo mkdir -p "/Library/Audio/Plug-Ins/Components" "/Library/Audio/Plug-Ins/VST3"

echo "Installing AU…"
sudo rm -rf "/Library/Audio/Plug-Ins/Components/RTM Send.component"
sudo cp -R "$HERE/RTM Send.component" "/Library/Audio/Plug-Ins/Components/"

echo "Installing VST3…"
sudo rm -rf "/Library/Audio/Plug-Ins/VST3/RTM Send.vst3"
sudo cp -R "$HERE/RTM Send.vst3" "/Library/Audio/Plug-Ins/VST3/"

echo "Installing standalone…"
rm -rf "/Applications/RTM Send.app"
cp -R "$HERE/RTM Send.app" "/Applications/"

echo ""
echo "✓ RTM Send installed."
echo "  • AU         : /Library/Audio/Plug-Ins/Components/RTM Send.component"
echo "  • VST3       : /Library/Audio/Plug-Ins/VST3/RTM Send.vst3"
echo "  • Standalone : /Applications/RTM Send.app"
echo ""
echo "Restart your DAW so it rescans the plugin folders."
read -n 1 -s -r -p "Press any key to close…"
EOF
chmod +x "$DMG_STAGE/Install RTM Send.command"

cat >"$DMG_STAGE/README.txt" <<'EOF'
RTM Send — installation
=======================

Easiest path:
  Double-click "Install RTM Send.command".

Manual path:
  Drag each bundle to its target folder shortcut:
    • RTM Send.component → Components (drag here)  (Audio Unit)
    • RTM Send.vst3      → VST3 (drag here)        (VST3)
    • RTM Send.app       → Applications (drag here) (standalone)

After installing, restart your DAW so it rescans the plugin folders.

Tested hosts: Logic Pro, Ableton Live 11/12, Reaper, Studio One,
Cubase / Nuendo, FL Studio, Bitwig.

AAX (Pro Tools) is not in this build — Avid PACE Eden signing is
gated on a separate developer relationship and will land in a
future release.
EOF

echo "==> Building DMG"
rm -f "$DMG_OUT"
hdiutil create \
  -volname "RTM Send 1.2.0" \
  -srcfolder "$DMG_STAGE" \
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

shasum -a 256 "$DMG_OUT" >"$DMG_OUT.sha256"
echo ""
echo "Done: $DMG_OUT"
cat "$DMG_OUT.sha256"
