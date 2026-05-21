#!/usr/bin/env bash
# Build the RTMcompare Windows bundle.
#
# Bundle layout (all inside a zip):
#   RTMcompare-bundle-8.4.0-win/
#   ├── RTMcompare/               ← portable — extract and run RTMcompare.exe
#   │   └── (all win-unpacked files)
#   ├── Install RTMprofile.exe    ← per-user NSIS installer (no admin needed)
#   ├── Install RTM Send VST3.exe ← installs to Common Files\VST3
#   └── README.txt
#
# RTMcompare is distributed as a portable directory rather than an NSIS
# installer because the model-cache contains files >2 GB that exceed the
# mmap limit in makensis on macOS.
#
# Requires: makensis (brew install makensis), zip
# Run from the Compare App root directory.

set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="8.4.0"
OUT_DIR="${PROJECT}/release"
BUNDLE_NAME="RTMcompare-bundle-${VERSION}-win"
BUNDLE_DIR="${OUT_DIR}/${BUNDLE_NAME}"
ZIP_OUT="${OUT_DIR}/${BUNDLE_NAME}.zip"

# Source paths
RTMCOMPARE_UNPACKED="${PROJECT}/release-build/win-unpacked"
RTMPROFILE_INSTALLER="${PROJECT}/rtm-profile-app/release-build/RTMprofile Setup ${VERSION}.exe"
VST3_WIN="${PROJECT}/rtm-send-plugin/build-win-cross/RtmSend_artefacts/Release/VST3/RTM Send.vst3"

echo "==> Checking sources"
[[ -d "$RTMCOMPARE_UNPACKED" ]] || { echo "MISSING: $RTMCOMPARE_UNPACKED" >&2; exit 1; }
[[ -f "$RTMPROFILE_INSTALLER" ]] || { echo "MISSING: $RTMPROFILE_INSTALLER" >&2; exit 1; }
[[ -d "$VST3_WIN" ]] || { echo "MISSING: $VST3_WIN" >&2; exit 1; }
which makensis >/dev/null 2>&1 || { echo "ERROR: makensis not found. Run: brew install makensis" >&2; exit 1; }

mkdir -p "$OUT_DIR"
rm -rf "$BUNDLE_DIR" "$ZIP_OUT" "${ZIP_OUT}.sha256"
mkdir -p "$BUNDLE_DIR"

# ── Build RTM Send VST3 installer (small — no mmap issues) ────────────────
echo "==> Building RTM Send VST3 installer"
PLUGIN_DIR_ABS="${PROJECT}/rtm-send-plugin/build-win-cross/RtmSend_artefacts/Release"
cd "$PROJECT"
makensis \
  -DPLUGIN_DIR="${PLUGIN_DIR_ABS}" \
  "${PROJECT}/rtm-send-plugin/scripts/build_win_installer.nsi"

# makensis writes OutFile relative to cwd
RTM_SEND_SETUP="${PROJECT}/RTM-Send-${VERSION}-Setup.exe"
[[ -f "$RTM_SEND_SETUP" ]] || RTM_SEND_SETUP="$(find "${PROJECT}" -maxdepth 3 \
  -name "RTM-Send-${VERSION}-Setup.exe" 2>/dev/null | head -1)"
cp "$RTM_SEND_SETUP" "${BUNDLE_DIR}/Install RTM Send VST3.exe"

# ── Stage RTMcompare portable ──────────────────────────────────────────────
# Uses macOS zip (Zip64) to handle >2 GB files — no mmap issue.
echo "==> Staging RTMcompare portable (this copies 5 GB — takes a few minutes)"
cp -R "$RTMCOMPARE_UNPACKED" "${BUNDLE_DIR}/RTMcompare"

# ── Copy RTMprofile installer ──────────────────────────────────────────────
echo "==> Copying RTMprofile installer"
cp "$RTMPROFILE_INSTALLER" "${BUNDLE_DIR}/Install RTMprofile.exe"

# ── README ────────────────────────────────────────────────────────────────
cat >"${BUNDLE_DIR}/README.txt" <<EOF
RTMcompare Bundle ${VERSION} — Windows

Three apps. One toolkit.

INSTALLATION

  1. RTMcompare (portable — no installer needed)
     Open the RTMcompare/ folder in this bundle.
     Double-click RTMcompare.exe to run immediately, OR
     copy the entire RTMcompare/ folder to:
       C:\Users\<you>\AppData\Local\Programs\RTMcompare
     and create a shortcut to RTMcompare.exe on the Desktop.

     Why portable? The app includes AI models (>3 GB) that exceed
     the Windows installer size limits when building on macOS. A
     native Windows installer will be added in a future update.

  2. Install RTMprofile.exe
     Run this installer — builds a custom reference profile from
     your back catalogue. Per-user install, no admin needed.

  3. Install RTM Send VST3.exe
     Run this installer — routes live audio from any 64-bit DAW
     directly into RTMcompare for real-time comparison.
     Installs to: C:\Program Files\Common Files\VST3
     Requires admin. Restart your DAW after installing.

TIPS
  - RTM Send appears in your DAW's VST3 plugin list after a rescan
    (Ableton: Options → Manage Plugins; Studio One: Studio One menu
    → Options → Locations → VST3 Plug-ins → Rescan).
  - If Windows SmartScreen warns on first run: click "More info" →
    "Run anyway". All binaries are developer-signed (Apple notarized
    for macOS; Windows Authenticode signing coming in a future build).

UNINSTALL
  RTMcompare:   delete the RTMcompare/ folder (and any shortcut).
  RTMprofile:   Settings → Apps → RTMprofile → Uninstall.
  RTM Send:     Settings → Apps → RTM Send → Uninstall.

RTMcompare ${VERSION} — © 2026 Ohad Nissim — all processing runs locally.
EOF

# ── ZIP (Zip64 — handles >4 GB) ───────────────────────────────────────────
echo "==> Creating bundle ZIP: ${BUNDLE_NAME}.zip  (this may take 10-20 min)"
cd "$OUT_DIR"
zip -r "${BUNDLE_NAME}.zip" "${BUNDLE_NAME}/"
shasum -a 256 "${BUNDLE_NAME}.zip" >"${BUNDLE_NAME}.zip.sha256"
rm -rf "$BUNDLE_DIR"

echo ""
echo "✅ Done: ${ZIP_OUT}"
ls -lh "${ZIP_OUT}"
cat "${ZIP_OUT}.sha256"
