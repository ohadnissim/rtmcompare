#!/usr/bin/env bash
# notarize-dmg.sh — submit, wait, staple, and verify all DMGs in release-build/
#
# Usage:
#   ./scripts/notarize-dmg.sh                        # process all *.dmg in release-build/
#   ./scripts/notarize-dmg.sh release-build/foo.dmg  # single DMG
#
# Prerequisites:
#   xcrun notarytool store-credentials "rtm-notary" --apple-id oh.odd@hotmail.com \
#       --team-id 3RL52RHGT3 --password <app-specific-password>
#
# CRIT-12 fix: ensures the DMG container itself is notarized + stapled, not just
# the .app inside. electron-builder with identity= signs the .app but the DMG
# wrapper needs a separate notarytool submission + stapler staple run.
# After this script runs, spctl -a -v <dmg> should return "accepted".

set -euo pipefail

KEYCHAIN_PROFILE="rtm-notary"
RELEASE_DIR="$(cd "$(dirname "$0")/../release-build" && pwd)"

# Determine list of DMGs to process
if [[ $# -gt 0 ]]; then
  DMGS=("$@")
else
  mapfile -t DMGS < <(find "$RELEASE_DIR" -maxdepth 1 -name "*.dmg" | sort)
fi

if [[ ${#DMGS[@]} -eq 0 ]]; then
  echo "No DMGs found in $RELEASE_DIR"
  exit 1
fi

echo "=== Notarize + Staple + Verify ==="
echo "DMGs to process: ${#DMGS[@]}"
echo ""

PASS=0
FAIL=0

for dmg in "${DMGS[@]}"; do
  echo "──────────────────────────────────────"
  echo "DMG: $dmg"

  # 1. Codesign the DMG container itself (electron-builder only signs the .app
  #    inside; the DMG wrapper needs its own Developer ID signature before
  #    notarytool will accept it — otherwise spctl returns "no usable signature").
  echo "→ Codesigning DMG container..."
  # LOW-14: use env var so callers on different Apple Developer accounts don't
  # need to edit this script. Falls back to the current identity.
  IDENTITY="${CODESIGN_IDENTITY:-Developer ID Application: Ohad Nissim (3RL52RHGT3)}"
  if ! codesign --sign "$IDENTITY" --force "$dmg" 2>&1; then
    echo "✗ codesign FAILED for $dmg"
    FAIL=$((FAIL + 1))
    continue
  fi

  # 2. Submit and wait
  echo "→ Submitting to Apple notary service..."
  if ! xcrun notarytool submit "$dmg" \
      --keychain-profile "$KEYCHAIN_PROFILE" \
      --wait 2>&1; then
    echo "✗ Notarization FAILED for $dmg"
    FAIL=$((FAIL + 1))
    continue
  fi

  # 3. Staple the ticket
  echo "→ Stapling ticket..."
  if ! xcrun stapler staple "$dmg" 2>&1; then
    echo "✗ Staple FAILED for $dmg"
    FAIL=$((FAIL + 1))
    continue
  fi

  # 4. Validate staple
  echo "→ Validating staple..."
  if ! xcrun stapler validate "$dmg" 2>&1; then
    echo "✗ Staple validation FAILED for $dmg"
    FAIL=$((FAIL + 1))
    continue
  fi

 # 5. spctl check on the DMG container
  echo "→ spctl check..."
  spctl_out=$(spctl -a -v -t open --context context:primary-signature "$dmg" 2>&1 || true)
  echo "$spctl_out"
  if echo "$spctl_out" | grep -q "accepted"; then
    echo "✓ PASS: $dmg"
    PASS=$((PASS + 1))
  else
    echo "✗ FAIL (spctl rejected): $dmg"
    FAIL=$((FAIL + 1))
  fi
done

echo ""
echo "=== Summary ==="
echo "Passed: $PASS / $((PASS + FAIL))"
if [[ $FAIL -gt 0 ]]; then
  echo "FAILED: $FAIL DMG(s) — check output above"
  exit 1
else
  echo "All DMGs accepted ✓"
fi
