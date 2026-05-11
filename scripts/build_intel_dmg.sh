#!/usr/bin/env bash
# Build RTMcompare Intel (x86_64) bundle DMG
#
# This script builds the full Intel-compatible release:
#   1. Downloads Python 3.11 universal2 from python.org (if not present)
#   2. Installs all Python packages as x86_64 into python-bundle-intel/
#   3. Builds RTMcompare Electron app for x64
#   4. Builds RTMsend plugin installer DMG (already universal — same as arm64)
#   5. Packages everything into RTMcompare-bundle-<VERSION>-intel.dmg
#
# Pre-requisite: RTMsend must already be built as universal binary.
#   cmake -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" (already done)
#
# Run from project root:
#   bash scripts/build_intel_dmg.sh

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="5.7.2"
PY_VERSION="3.11.9"
PY_PKG_URL="https://www.python.org/ftp/python/${PY_VERSION}/python-${PY_VERSION}-macos11.pkg"
PY_PKG_CACHE="/tmp/python-${PY_VERSION}-universal2.pkg"
SYSTEM_PY="/Library/Frameworks/Python.framework/Versions/3.11/bin/python3.11"

BUNDLE_INTEL_DIR="${PROJECT}/python-bundle-intel"
INTEL_RELEASE_DIR="${PROJECT}/release-build/mac-x64"
INTEL_PROFILE_RELEASE_DIR="${PROJECT}/rtm-profile-app/release-build/mac-x64"

NAME="RTMcompare-bundle-${VERSION}-intel"
VOL="RTMcompare bundle ${VERSION} Intel"
OUT_DIR="${PROJECT}/release"
DMG_OUT="${OUT_DIR}/${NAME}.dmg"
STAGE="${OUT_DIR}/.${NAME}-stage"

DEV_ID_APP="Developer ID Application: Ohad Nissim (3RL52RHGT3)"
NOTARY_PROFILE="rtm-notary"

PLUGIN_DMG="${PROJECT}/rtm-send-plugin/release/RTM-Send-1.2.0.dmg"
DOC_MANUAL="${PROJECT}/release/v5.7.0/MANUAL.pdf"
DOC_FEATURES="${PROJECT}/release/v5.7.0/FEATURES.pdf"
DOC_PITCH="${PROJECT}/release/v5.7.0/PITCH-DECK.pdf"
DOC_CHANGELOG="${PROJECT}/release/v5.7.0/CHANGELOG.pdf"

echo "════════════════════════════════════════════════"
echo "  RTMcompare Intel Build — ${VERSION}"
echo "════════════════════════════════════════════════"

# ── Step 1: Python universal2 ────────────────────────────────────────────────
echo ""
echo "==> [1/5] Python ${PY_VERSION} universal2"

if [ ! -f "$SYSTEM_PY" ]; then
    echo "    Downloading Python ${PY_VERSION} universal2..."
    curl -L "$PY_PKG_URL" -o "$PY_PKG_CACHE" --progress-bar

    echo "    Installing Python ${PY_VERSION} (requires sudo)..."
    sudo installer -pkg "$PY_PKG_CACHE" -target /
    echo "    Python installed."
else
    echo "    Python ${PY_VERSION} already at ${SYSTEM_PY}"
fi

# Verify it can run as x86_64
ARCH_CHECK=$(arch -x86_64 "$SYSTEM_PY" -c "import platform; print(platform.machine())" 2>&1)
if [ "$ARCH_CHECK" != "x86_64" ]; then
    echo "ERROR: Python at $SYSTEM_PY can't run as x86_64. Got: $ARCH_CHECK"
    exit 1
fi
echo "    Verified: arch -x86_64 python → x86_64 ✓"

# ── Step 2: Build python-bundle-intel ────────────────────────────────────────
echo ""
echo "==> [2/5] Building python-bundle-intel (x86_64 packages)"

INTEL_PY_PREFIX="${BUNDLE_INTEL_DIR}/python"

if [ -d "${BUNDLE_INTEL_DIR}" ]; then
    echo "    Removing existing python-bundle-intel..."
    rm -rf "${BUNDLE_INTEL_DIR}"
fi

echo "    Creating x86_64 virtualenv..."
arch -x86_64 "$SYSTEM_PY" -m venv "${INTEL_PY_PREFIX}"

INTEL_PY="${INTEL_PY_PREFIX}/bin/python3"
INTEL_PIP="${INTEL_PY_PREFIX}/bin/pip"

echo "    Installing packages (this takes ~15 minutes)..."

# Core audio/DSP packages
arch -x86_64 "$INTEL_PIP" install --upgrade pip --quiet

echo "    → llvmlite + numba (pinned — x86_64 pre-built wheels only)..."
# llvmlite 0.47+ dropped x86_64 macOS wheels and requires building from source.
# 0.43.0 is the last version with pre-built cp311 x86_64 wheels on PyPI.
# numba 0.60.0 is the corresponding release.
arch -x86_64 "$INTEL_PIP" install \
    "llvmlite==0.43.0" \
    "numba==0.60.0" \
    --only-binary :all: \
    --quiet

echo "    → numpy, scipy, librosa, soundfile, pyloudnorm, soxr..."
arch -x86_64 "$INTEL_PIP" install \
    "numpy>=1.24.0,<2.0.0" \
    "scipy>=1.10.0" \
    "librosa>=0.10.0" \
    "soundfile>=0.12.0" \
    "pyloudnorm>=0.1.0" \
    "soxr>=0.5.0" \
    --quiet

echo "    → torch, torchaudio (CPU — x86_64 macOS)..."
# PyTorch x86_64 CPU-only for macOS
arch -x86_64 "$INTEL_PIP" install \
    torch torchaudio \
    --index-url https://download.pytorch.org/whl/cpu \
    --quiet

echo "    → demucs, onnxruntime..."
arch -x86_64 "$INTEL_PIP" install \
    "demucs>=4.0.0" \
    "onnxruntime==1.19.2" \
    --quiet

echo "    → audio-separator (--no-deps — avoids numba>=0.65 conflict on x86_64)..."
# audio-separator requires numba>=0.65.1 which has no x86_64 macOS wheel.
# Install with --no-deps; the runtime uses demucs/onnxruntime directly.
# Also install audio-separator's other direct deps that ARE x86_64-compatible.
arch -x86_64 "$INTEL_PIP" install \
    "audio-separator>=0.30" \
    --no-deps \
    --quiet
arch -x86_64 "$INTEL_PIP" install \
    "pydub>=0.25" \
    "requests>=2.28" \
    "six>=1.16" \
    --quiet 2>/dev/null || true

echo "    Verifying imports..."
arch -x86_64 "$INTEL_PY" -c "
import platform
assert platform.machine() == 'x86_64', f'wrong arch: {platform.machine()}'
import numpy, scipy, librosa, soundfile, pyloudnorm
import torch, torchaudio
import demucs
import onnxruntime, soxr
print('All imports OK — arch:', platform.machine())
print('  numpy:', numpy.__version__)
print('  torch:', torch.__version__)
print('  onnxruntime:', onnxruntime.__version__)
"

echo "    Signing .so and .dylib files..."
find "${BUNDLE_INTEL_DIR}" \( -name "*.so" -o -name "*.dylib" \) 2>/dev/null \
    | xargs -I{} codesign --force --sign "$DEV_ID_APP" \
        --options runtime --timestamp {} 2>/dev/null || true

echo "    python-bundle-intel done ✓"

# ── Step 3: Build Electron app for x64 ───────────────────────────────────────
echo ""
echo "==> [3/5] Building RTMcompare + RTMprofile Electron apps (x64)"

# Helper: patch package.json for x64, build, restore
build_x64_app() {
    local APP_DIR="$1"
    local OUT_DIR="$2"
    local BUNDLE_FROM="$3"   # python-bundle or ../python-bundle

    cd "$APP_DIR"

    node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.build.mac.target = [{ target: 'dir', arch: ['x64'] }];
// Point at intel python bundle
pkg.build.mac.extraResources = (pkg.build.mac.extraResources || pkg.build.extraResources || []).map(r => {
    if (r.from && r.from.includes('python-bundle') && !r.from.includes('intel')) {
        return { ...r, from: r.from.replace('python-bundle', 'python-bundle-intel') };
    }
    return r;
});
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
"

    mkdir -p "$OUT_DIR"
    # CSC_IDENTITY_AUTO_DISCOVERY=false disables electron-builder's own signing.
    # We sign manually in step 4 via sign_and_notarize(), same as the arm64 flow.
    # This avoids "codesign --verify --deep --strict" failures on x64 cross-builds.
    CSC_IDENTITY_AUTO_DISCOVERY=false \
    arch -x86_64 npx electron-builder --mac dir --x64 \
        --config.mac.identity=null \
        --config.directories.output="$OUT_DIR" 2>&1 | grep -E "error|Error|Building|Packaging|•" || true

    # Restore
    node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.build.mac.target = [{ target: 'dmg', arch: ['arm64'] }];
pkg.build.mac.extraResources = (pkg.build.mac.extraResources || []).map(r => {
    if (r.from && r.from.includes('python-bundle-intel')) {
        return { ...r, from: r.from.replace('python-bundle-intel', 'python-bundle') };
    }
    return r;
});
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
"
}

echo "    Building RTMcompare x64..."
mkdir -p "$INTEL_RELEASE_DIR"
build_x64_app "$PROJECT" "$INTEL_RELEASE_DIR" "python-bundle-intel"

echo "    Building RTMprofile x64..."
mkdir -p "$INTEL_PROFILE_RELEASE_DIR"
build_x64_app "${PROJECT}/rtm-profile-app" "$INTEL_PROFILE_RELEASE_DIR" "../python-bundle-intel"

cd "$PROJECT"

# Find the built apps
RTMCOMPARE_INTEL_APP=$(find "${INTEL_RELEASE_DIR}" -name "RTMcompare.app" -maxdepth 4 | head -1)
RTMPROFILE_INTEL_APP=$(find "${INTEL_PROFILE_RELEASE_DIR}" -name "RTMprofile.app" -maxdepth 4 | head -1)

[ -z "$RTMCOMPARE_INTEL_APP" ] && { echo "ERROR: RTMcompare.app not found"; exit 1; }
[ -z "$RTMPROFILE_INTEL_APP" ] && { echo "ERROR: RTMprofile.app not found"; exit 1; }

echo "    RTMcompare: $RTMCOMPARE_INTEL_APP"
file "${RTMCOMPARE_INTEL_APP}/Contents/MacOS/RTMcompare"
echo "    RTMprofile:  $RTMPROFILE_INTEL_APP"
file "${RTMPROFILE_INTEL_APP}/Contents/MacOS/RTMprofile"

# ── Step 4: Sign & notarize the Electron app ─────────────────────────────────
echo ""
echo "==> [4/5] Sign + notarize RTMcompare + RTMprofile x64"

sign_and_notarize() {
    local APP="$1"
    local NOTARY_ZIP="/tmp/$(basename $APP)-intel-notary.zip"

    echo "    Signing all Mach-O binaries inside: $(basename $APP)..."
    # Sign every Mach-O binary — shared libs (.dylib/.so/.node) AND plain
    # executables (torch/bin/protoc, torch_shm_manager, Squirrel/ShipIt, etc.)
    find "$APP" -type f | while IFS= read -r f; do
        if [[ "$(file -b "$f" 2>/dev/null)" == *"Mach-O"* ]]; then
            codesign --force --sign "$DEV_ID_APP" \
                --options runtime --timestamp \
                --entitlements "${PROJECT}/build/entitlements.mac.plist" \
                "$f" 2>/dev/null || true
        fi
    done

    codesign --force --deep --sign "$DEV_ID_APP" \
        --options runtime \
        --entitlements "${PROJECT}/build/entitlements.mac.plist" \
        --timestamp \
        "$APP"

    echo "    Notarizing: $(basename $APP)..."
    rm -f "$NOTARY_ZIP"
    ditto -c -k --keepParent "$APP" "$NOTARY_ZIP"
    xcrun notarytool submit "$NOTARY_ZIP" \
        --keychain-profile "$NOTARY_PROFILE" \
        --wait --timeout 30m
    xcrun stapler staple "$APP"
    echo "    $(basename $APP) notarized ✓"
}

sign_and_notarize "${RTMCOMPARE_INTEL_APP}"
sign_and_notarize "${RTMPROFILE_INTEL_APP}"

# ── Step 5: Build bundle DMG ──────────────────────────────────────────────────
echo ""
echo "==> [5/5] Building Intel bundle DMG"

rm -rf "$STAGE" "$DMG_OUT"
mkdir -p "$STAGE/Documentation"

echo "    Staging artifacts..."
cp -R "${RTMCOMPARE_INTEL_APP}" "$STAGE/"
cp -R "${RTMPROFILE_INTEL_APP}" "$STAGE/"
cp "${PLUGIN_DMG}" "$STAGE/RTM Send installer.dmg"
cp "${DOC_MANUAL}"    "$STAGE/Documentation/Manual.pdf"
cp "${DOC_FEATURES}"  "$STAGE/Documentation/Features.pdf"
cp "${DOC_PITCH}"     "$STAGE/Documentation/Pitch Deck.pdf"
cp "${DOC_CHANGELOG}" "$STAGE/Documentation/Changelog.pdf"

cat > "$STAGE/README.txt" <<'EOREADME'
RTMcompare bundle — Intel (x86_64)

CONTENTS
  RTMcompare.app          — Main comparison app (Intel)
  RTMprofile.app          — Build reference profiles from your catalogue (Intel)
  RTM Send installer.dmg  — RTM Send plugin (VST3 + AU, Universal Binary)
  Documentation/          — Manual, Features guide, Pitch Deck, Changelog

INSTALL
  1. Drag RTMcompare.app and RTMprofile.app → Applications
  2. Open RTM Send installer.dmg → run the installer

SYSTEM REQUIREMENTS
  macOS 11.0 or later
  Intel Mac (x86_64)

EOREADME

ln -s /Applications "$STAGE/Applications"

echo "    Creating DMG..."
hdiutil create \
    -volname "$VOL" \
    -srcfolder "$STAGE" \
    -ov \
    -format UDZO \
    -imagekey zlib-level=9 \
    -fs HFS+ \
    -o "$DMG_OUT"

echo "    Signing DMG..."
codesign --sign "$DEV_ID_APP" --timestamp "$DMG_OUT"

echo "    Notarizing DMG..."
xcrun notarytool submit "$DMG_OUT" \
    --keychain-profile "$NOTARY_PROFILE" \
    --wait \
    --timeout 30m

echo "    Stapling DMG..."
xcrun stapler staple "$DMG_OUT"

# Cleanup stage
rm -rf "$STAGE"

# SHA
SHA=$(shasum -a 256 "$DMG_OUT" | awk '{print $1}')
echo "$SHA  ${NAME}.dmg" > "${OUT_DIR}/${NAME}.dmg.sha256"

echo ""
echo "════════════════════════════════════════════════"
echo "  Intel DMG ready:"
echo "  ${DMG_OUT}"
echo "  SHA-256: ${SHA}"
echo "════════════════════════════════════════════════"
