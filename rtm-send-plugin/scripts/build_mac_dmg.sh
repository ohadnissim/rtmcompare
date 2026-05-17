#!/usr/bin/env bash
# Build a signed + notarized DMG distribution of RTM Send
# (AU + VST3 + Standalone + AAX for Pro Tools).
#
# AAX signing uses PACE wraptool when available. Set env vars:
#   PACE_COMPANY_GUID  — your PACE developer account Company GUID
#   PACE_PRODUCT_GUID  — the Product GUID registered at ilok.com
# If wraptool is absent or GUIDs unset, AAX is Apple-signed only
# (suitable for Avid developer mode / Pro Tools in dev mode).
#
# Pass --skip-build to skip rebuilding when iterating on packaging.

set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$PLUGIN_ROOT/build"
ART_DIR="$BUILD_DIR/RtmSend_artefacts"
DMG_OUT="$PLUGIN_ROOT/release/RTM-Send-1.3.0.dmg"
DMG_STAGE="$PLUGIN_ROOT/release/.dmg-stage"
DEV_ID_APP="Developer ID Application: Ohad Nissim (3RL52RHGT3)"
NOTARY_PROFILE="rtm-notary"
ENT_FILE="$PLUGIN_ROOT/scripts/entitlements.plist"

# PACE wraptool GUIDs — override via env for CI / release builds
PACE_COMPANY_GUID="${PACE_COMPANY_GUID:-}"
PACE_PRODUCT_GUID="${PACE_PRODUCT_GUID:-}"

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
    -DJUCE_DIR="${JUCE_DIR:-/Users/ohadnissim/Claude/Compare/Compare App/JUCE}" \
    -DJUCE_COPY_PLUGIN_AFTER_BUILD=OFF \
    -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0 \
    -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64"
  cmake --build "$BUILD_DIR" --config Release -j8
fi

AAX_PLUGIN="$ART_DIR/Release/AAX/RTM Send.aaxplugin"

for path in \
  "$ART_DIR/Release/AU/RTM Send.component" \
  "$ART_DIR/Release/VST3/RTM Send.vst3" \
  "$ART_DIR/Release/Standalone/RTM Send.app"; do
  [[ -d "$path" ]] || { echo "Missing: $path" >&2; exit 1; }
done

# AAX is conditional — warn but don't abort if missing
HAS_AAX=0
if [[ -d "$AAX_PLUGIN" ]]; then
  HAS_AAX=1
else
  echo "WARNING: AAX bundle not found at $AAX_PLUGIN — skipping AAX packaging"
fi

echo "==> Code-signing AU / VST3 / Standalone (hardened runtime + entitlements)"
for path in \
  "$ART_DIR/Release/AU/RTM Send.component" \
  "$ART_DIR/Release/VST3/RTM Send.vst3" \
  "$ART_DIR/Release/Standalone/RTM Send.app"; do
  codesign --force --deep --options runtime --timestamp \
    --entitlements "$ENT_FILE" \
    --sign "$DEV_ID_APP" \
    "$path"
done

if [[ $HAS_AAX -eq 1 ]]; then
  echo "==> Signing AAX"
  if command -v wraptool &>/dev/null && [[ -n "$PACE_COMPANY_GUID" && -n "$PACE_PRODUCT_GUID" ]]; then
    echo "  Using PACE wraptool (full distribution signing)"
    # wraptool v5 syntax — adjust --codesign-identity flag name if your
    # version differs (older versions used --signtool or --signid).
    wraptool sign \
      --account "$PACE_COMPANY_GUID" \
      --wcguid  "$PACE_PRODUCT_GUID" \
      --codesign-identity "$DEV_ID_APP" \
      --in "$AAX_PLUGIN" \
      --out "$AAX_PLUGIN"
  else
    if ! command -v wraptool &>/dev/null; then
      echo "  wraptool not found — Apple-signing only (Pro Tools developer mode)"
      echo "  Install wraptool from https://developer.avid.com for distribution builds"
    else
      echo "  PACE_COMPANY_GUID / PACE_PRODUCT_GUID not set — Apple-signing only"
    fi
    codesign --force --deep --options runtime --timestamp \
      --entitlements "$ENT_FILE" \
      --sign "$DEV_ID_APP" \
      "$AAX_PLUGIN"
  fi
fi

echo "==> Verifying signatures"
for path in \
  "$ART_DIR/Release/AU/RTM Send.component" \
  "$ART_DIR/Release/VST3/RTM Send.vst3" \
  "$ART_DIR/Release/Standalone/RTM Send.app"; do
  codesign --verify --strict --verbose=2 "$path"
done
if [[ $HAS_AAX -eq 1 ]]; then
  codesign --verify --strict --verbose=2 "$AAX_PLUGIN"
fi

echo "==> Staging DMG payload"
cp -R "$ART_DIR/Release/AU/RTM Send.component"   "$DMG_STAGE/"
cp -R "$ART_DIR/Release/VST3/RTM Send.vst3"      "$DMG_STAGE/"
cp -R "$ART_DIR/Release/Standalone/RTM Send.app" "$DMG_STAGE/"
if [[ $HAS_AAX -eq 1 ]]; then
  cp -R "$AAX_PLUGIN" "$DMG_STAGE/"
fi

# Drag-target shortcuts pointing at SYSTEM-wide /Library locations.
# /Library requires admin rights to write — users get a Finder auth prompt,
# which matches every other commercial plugin installer.
ln -s "/Library/Audio/Plug-Ins/Components" "$DMG_STAGE/Components (drag here)" 2>/dev/null || true
ln -s "/Library/Audio/Plug-Ins/VST3"       "$DMG_STAGE/VST3 (drag here)" 2>/dev/null || true
ln -s "/Applications"                       "$DMG_STAGE/Applications (drag here)" 2>/dev/null || true
if [[ $HAS_AAX -eq 1 ]]; then
  ln -s "/Library/Application Support/Avid/Audio/Plug-Ins" \
    "$DMG_STAGE/ProTools Plug-Ins (drag here)" 2>/dev/null || true
fi

# Quick installer the user can double-click — copies everything into
# the right places without making them open multiple Finder windows.
# Uses sudo for /Library/ paths; password prompt appears once.
cat >"$DMG_STAGE/Install RTM Send.command" <<'EOF'
#!/usr/bin/env bash
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "Installing RTM Send (system-wide)."
echo "You'll be asked for your admin password once."
echo ""

sudo mkdir -p \
  "/Library/Audio/Plug-Ins/Components" \
  "/Library/Audio/Plug-Ins/VST3" \
  "/Library/Application Support/Avid/Audio/Plug-Ins"

echo "Installing AU…"
sudo rm -rf "/Library/Audio/Plug-Ins/Components/RTM Send.component"
sudo cp -R "$HERE/RTM Send.component" "/Library/Audio/Plug-Ins/Components/"

echo "Installing VST3…"
sudo rm -rf "/Library/Audio/Plug-Ins/VST3/RTM Send.vst3"
sudo cp -R "$HERE/RTM Send.vst3" "/Library/Audio/Plug-Ins/VST3/"

echo "Installing standalone…"
rm -rf "/Applications/RTM Send.app"
cp -R "$HERE/RTM Send.app" "/Applications/"

if [[ -d "$HERE/RTM Send.aaxplugin" ]]; then
  echo "Installing AAX (Pro Tools)…"
  sudo rm -rf "/Library/Application Support/Avid/Audio/Plug-Ins/RTM Send.aaxplugin"
  sudo cp -R "$HERE/RTM Send.aaxplugin" "/Library/Application Support/Avid/Audio/Plug-Ins/"
fi

echo ""
echo "RTM Send installed."
echo "  • AU         : /Library/Audio/Plug-Ins/Components/RTM Send.component"
echo "  • VST3       : /Library/Audio/Plug-Ins/VST3/RTM Send.vst3"
echo "  • Standalone : /Applications/RTM Send.app"
if [[ -d "$HERE/RTM Send.aaxplugin" ]]; then
echo "  • AAX        : /Library/Application Support/Avid/Audio/Plug-Ins/RTM Send.aaxplugin"
fi
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

Manual path — drag each bundle to its shortcut folder:
  • RTM Send.component → Components (drag here)        (Audio Unit — Logic, Ableton, etc.)
  • RTM Send.vst3      → VST3 (drag here)              (VST3 — Ableton, Reaper, Cubase, etc.)
  • RTM Send.app       → Applications (drag here)      (Standalone)
  • RTM Send.aaxplugin → ProTools Plug-Ins (drag here) (AAX — Pro Tools)

After installing, restart your DAW so it rescans the plugin folders.

Tested hosts: Logic Pro, Ableton Live 11/12, Reaper, Studio One,
Cubase / Nuendo, FL Studio, Bitwig, Pro Tools.

Requirements: macOS 11.0+, iLok License Manager (for the AAX edition).
EOF

echo "==> Building DMG"
rm -f "$DMG_OUT"
hdiutil create \
  -volname "RTM Send 1.3.0" \
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
