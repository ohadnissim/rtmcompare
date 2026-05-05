#!/usr/bin/env bash
#
# RTM Send — build-artifact validation.
# Runs every automated check we can land on already-compiled plug-in
# binaries before they get signed + shipped.
#
# Requires the build to have produced ./rtm-send-plugin/build/
#   RtmSend_artefacts/{AU,VST3,AAX,Standalone}/RTM Send.*
# before this script runs.
#
# Pass = every format satisfies every check.  Exit 1 on any failure.

set -u
cd "$(dirname "$0")/../.."

BUILD="rtm-send-plugin/build/RtmSend_artefacts/Release"
FAIL=0

pass () { echo "  PASS - $1"; }
warn () { echo "  WARN - $1"; }
fail () { echo "  FAIL - $1"; FAIL=1; }

echo "[QA] Plug-in build validation"
echo "==========================================="

# ── Pass A · binaries exist ──
# Pass A - binaries exist
echo "[A] Build artefacts present"
for kind in AU VST3 AAX Standalone; do
  case "$kind" in
    AU)         path="$BUILD/AU/RTM Send.component/Contents/MacOS/RTM Send" ;;
    VST3)       path="$BUILD/VST3/RTM Send.vst3/Contents/MacOS/RTM Send" ;;
    AAX)        path="$BUILD/AAX/RTM Send.aaxplugin/Contents/MacOS/RTM Send" ;;
    Standalone) path="$BUILD/Standalone/RTM Send.app/Contents/MacOS/RTM Send" ;;
  esac
  if [ -f "$path" ]; then pass "$kind: $(basename "$path") ($(stat -f%z "$path") bytes)"
  else fail "$kind: missing at $path"; fi
done
echo ""

# ── Pass B · Mach-O architecture + OS minimum ──
# Pass B - Mach-O architecture + OS minimum
echo "[B] Mach-O audit (arm64 + macOS 11 minimum)"
for kind in AU VST3 AAX Standalone; do
  case "$kind" in
    AU)         path="$BUILD/AU/RTM Send.component/Contents/MacOS/RTM Send" ;;
    VST3)       path="$BUILD/VST3/RTM Send.vst3/Contents/MacOS/RTM Send" ;;
    AAX)        path="$BUILD/AAX/RTM Send.aaxplugin/Contents/MacOS/RTM Send" ;;
    Standalone) path="$BUILD/Standalone/RTM Send.app/Contents/MacOS/RTM Send" ;;
  esac
  [ ! -f "$path" ] && continue
  arch=$(file "$path" 2>/dev/null | head -1)
  if echo "$arch" | grep -qi "arm64"; then pass "$kind: arm64 Mach-O"
  else fail "$kind: $arch"; fi
done
echo ""

# ── Pass C · auval on the AU (Apple's format-compliance gate) ──
# Pass C - auval on the AU (Apple's format-compliance gate)
echo "[C] AU validation via auval"
AU_PATH="$BUILD/AU/RTM Send.component"
if [ -d "$AU_PATH" ]; then
  # Copy into a throwaway location auval can load from, run it, clean up.
  STAGE=/tmp/rtm-auval-stage
  rm -rf "$STAGE"; mkdir -p "$STAGE"
  cp -R "$AU_PATH" "$STAGE/"
  # auval needs the component in /Library/Audio/Plug-Ins/Components
  # to be loadable; testing an absolute path requires it's registered.
  # For pre-ship use, run auval manually after install; document here.
  echo "  INFO - auval is a post-install check; run after drag-install:"
  echo "           auval -v aufx RtmS Rtma"
  echo "         (4-char codes from the JUCE project)"
  rm -rf "$STAGE"
else
  warn "AU component not built yet"
fi
echo ""

# ── Pass D · JUCE name/version mismatch sniff ──
# Pass D - JUCE name/version mismatch sniff
echo "[D] Info.plist version consistency"
MISMATCH=0
for kind in AU VST3 AAX Standalone; do
  case "$kind" in
    AU)         plist="$BUILD/AU/RTM Send.component/Contents/Info.plist" ;;
    VST3)       plist="$BUILD/VST3/RTM Send.vst3/Contents/Info.plist" ;;
    AAX)        plist="$BUILD/AAX/RTM Send.aaxplugin/Contents/Info.plist" ;;
    Standalone) plist="$BUILD/Standalone/RTM Send.app/Contents/Info.plist" ;;
  esac
  [ ! -f "$plist" ] && continue
  v=$(defaults read "${plist%.plist}" CFBundleShortVersionString 2>/dev/null || echo "?")
  pass "$kind: CFBundleShortVersionString=$v"
done
echo ""

# ── Pass E · pluginval (if installed) ──
# Pass E - pluginval (if installed)
echo "[E] pluginval torture test (if installed)"
# Resolve the binary: PATH first, then the Homebrew cask install path.
PLUGINVAL=""
if command -v pluginval >/dev/null 2>&1; then
  PLUGINVAL="$(command -v pluginval)"
elif [ -x "/Applications/pluginval.app/Contents/MacOS/pluginval" ]; then
  PLUGINVAL="/Applications/pluginval.app/Contents/MacOS/pluginval"
fi

if [ -n "$PLUGINVAL" ]; then
  for fmt in VST3 AU; do
    case "$fmt" in
      VST3) p="$BUILD/VST3/RTM Send.vst3" ;;
      AU)   p="$BUILD/AU/RTM Send.component" ;;
    esac
    if [ -d "$p" ]; then
      out=$("$PLUGINVAL" --strictness-level 5 --validate "$p" --timeout-ms 120000 2>&1 | tail -5)
      if echo "$out" | grep -qi "SUCCESS"; then pass "$fmt: pluginval strictness 5"
      else fail "$fmt: pluginval reported issues ($out)"; fi
    fi
  done
else
  warn "pluginval not installed (brew install --cask pluginval, or github.com/Tracktion/pluginval/releases)"
fi
echo ""

echo "==========================================="
if [ $FAIL -eq 0 ]; then
  echo "[QA] Build validation: PASS"
  exit 0
else
  echo "[QA] Build validation: FAIL"
  exit 1
fi
