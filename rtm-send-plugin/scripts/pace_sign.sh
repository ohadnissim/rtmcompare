#!/usr/bin/env bash
# PACE Eden / wraptool signing for RTM Send.aaxplugin
#
# Prerequisites (one-time setup):
#   1. Log in to https://developer.avid.com with your Avid developer account.
#   2. Under "Products", register a new product:
#        Name:        RTM Send
#        Bundle ID:   com.rtmcompare.rtmsend
#        Format:      AAX
#      → PACE portal gives you a COMPANY GUID and a PRODUCT GUID.
#   3. Download wraptool from the same portal (Avid Developer Tools section).
#      Install it — the binary should end up in /usr/local/bin/wraptool.
#   4. Set your iLok username so wraptool can find the Eden license.
#
# Usage:
#   PACE_COMPANY_GUID=<guid> PACE_PRODUCT_GUID=<guid> bash scripts/pace_sign.sh
#   or export them first and just run:  bash scripts/pace_sign.sh
#
# Optional:
#   PACE_ILOK_USER — your iLok username (required only if wraptool can't
#                    auto-detect the logged-in account from iLok License Manager)

set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AAX_SRC="$PLUGIN_ROOT/build/RtmSend_artefacts/Release/AAX/RTM Send.aaxplugin"
DEV_ID_APP="Developer ID Application: Ohad Nissim (3RL52RHGT3)"

PACE_ACCOUNT="${PACE_ACCOUNT:-ohadnissim}"                                      # pc2.paceap.com username
PACE_PRODUCT_GUID="${PACE_PRODUCT_GUID:-E46358F0-520B-11F1-8F29-00505692AD3E}"  # Wrap Config GUID
PACE_ILOK_USER="${PACE_ILOK_USER:-}"

# ── Guard rails ───────────────────────────────────────────────────────────────

# wraptool ships with PACE Eden — use the bundled copy if not in PATH.
WRAPTOOL="wraptool"
if ! command -v wraptool &>/dev/null; then
  PACE_BIN="/Applications/PACEAntiPiracy/Eden/Fusion/Versions/5/bin/wraptool"
  if [[ -x "$PACE_BIN" ]]; then
    WRAPTOOL="$PACE_BIN"
  else
    echo "ERROR: wraptool not found. Expected at $PACE_BIN" >&2
    exit 1
  fi
fi

if [[ -z "$PACE_ACCOUNT" || -z "$PACE_PRODUCT_GUID" ]]; then
  echo ""
  echo "ERROR: PACE_ACCOUNT and PACE_PRODUCT_GUID must be set."
  echo ""
  echo "PACE_ACCOUNT is your pc2.paceap.com username (e.g. ohadnissim)."
  echo "PACE_PRODUCT_GUID is the Wrap Config GUID from the PACE portal."
  echo "Then run:"
  echo "  PACE_ACCOUNT=<username> PACE_PRODUCT_GUID=<wrap-config-guid> bash scripts/pace_sign.sh"
  exit 1
fi

if [[ ! -d "$AAX_SRC" ]]; then
  echo ""
  echo "ERROR: AAX plugin not found at:"
  echo "  $AAX_SRC"
  echo ""
  echo "Run:  cmake --build build --config Release -j8"
  echo "or:   bash scripts/build_mac_dmg.sh --skip-build  (skips rebuild, just packages)"
  exit 1
fi

# ── Sign ─────────────────────────────────────────────────────────────────────

echo "==> PACE wraptool signing RTM Send.aaxplugin"
echo "  Account      : $PACE_ACCOUNT"
echo "  Wrap Config  : $PACE_PRODUCT_GUID"
echo ""

WRAPTOOL_ARGS=(
  sign
  --verbose
  --account      "$PACE_ACCOUNT"
  --wcguid       "$PACE_PRODUCT_GUID"
  --productname  "RTMsend"
  --in           "$AAX_SRC"
  --out          "$AAX_SRC"
  --signid       "$DEV_ID_APP"
)
# NOTE: --productname IS REQUIRED. Without it wraptool only code-signs and does
# NOT apply the PACE wrap ("signed, but not wrapped"), and Pro Tools crashes the
# unwrapped plugin on instantiation (no UI, no crash report — PACE kills it).
# Matches PEAK's known-good invocation. (--autoinstall removed; we ditto-install
# the wrapped build ourselves so the PACE v1 symlink is preserved.)
if [[ -n "$PACE_ILOK_USER" ]]; then
  WRAPTOOL_ARGS+=(--ilokid "$PACE_ILOK_USER")
fi

"$WRAPTOOL" "${WRAPTOOL_ARGS[@]}"

echo ""
echo "==> Verifying codesign (post-wraptool)"
codesign --verify --strict --verbose=2 "$AAX_SRC"

echo ""
echo "==> Installing to Pro Tools system folder"
sudo rm -rf "/Library/Application Support/Avid/Audio/Plug-Ins/RTM Send.aaxplugin"
sudo cp -R "$AAX_SRC" "/Library/Application Support/Avid/Audio/Plug-Ins/"

echo ""
echo "Done. RTM Send.aaxplugin is PACE-signed and installed."
echo "Restart Pro Tools — plugin will appear in the AAX Effects category."
echo ""
echo "Next: run build_mac_dmg.sh with the same env vars to produce the"
echo "distribution DMG with the PACE-protected binary inside."
