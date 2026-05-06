#!/usr/bin/env bash
# 5.3.x — install the new UAI runtime deps into RTM's local Mac
# python-bundle. This is a one-shot script: run it once to bring the
# bundle up to spec for the vendored UAI engine. The Win CI workflow
# at .github/workflows/build-windows.yml already installs the same set
# on every cache-key bump, so Win is handled automatically.
#
# Run from the project root:
#   bash scripts/install_uai_deps.sh
#
# What it adds:
#   - audio-separator>=0.30 — BS-RoFormer 4-stem inference frontend
#   - onnxruntime==1.19.2   — every ONNX detector in core/*_detector.py
#   - soxr>=0.5.0           — lofcz preprocessing resampler (already
#                             present transitively but pinned for clarity)
#   - xgboost               — calibration-head loader (lazy; engine
#                             falls back gracefully if absent)
#
# What it does NOT add:
#   - openai-whisper        — UAI's optional lyrics detector. Adds ~150 MB
#                             of model download on first use. Engine
#                             fail-opens without it. Recommended OFF
#                             until lyrics-aware detection is required.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE_PY="$PROJECT_ROOT/python-bundle/python/bin/python3"

if [ ! -x "$BUNDLE_PY" ]; then
    echo "ERROR: python-bundle interpreter not found at $BUNDLE_PY" >&2
    echo "Build/refresh the bundle first, then re-run this script." >&2
    exit 1
fi

echo "==> Installing UAI runtime deps into $BUNDLE_PY"
"$BUNDLE_PY" -m pip install --no-warn-script-location \
    "audio-separator>=0.30" \
    "onnxruntime==1.19.2" \
    "soxr>=0.5.0"

# xgboost is OPT-IN. On macOS it pulls in `libxgboost.dylib` which
# in turn requires `libomp.dylib` from Homebrew. Without libomp the
# import dlopen()s and dies. UAI's calibration head lazy-imports
# xgboost and the engine fail-opens cleanly when it's absent — you
# just don't get the v1.3 calibrated head, you get the legacy
# calibration JSON path. Worth installing only on machines that
# already have `brew install libomp`. Run:
#   "$BUNDLE_PY" -m pip install xgboost
# only after libomp is present and reachable from the bundle.

echo "==> Clearing macOS quarantine + ad-hoc-signing fresh dylibs"
xattr -cr "$(dirname "$BUNDLE_PY")/.."  # python-bundle/python/
find "$(dirname "$BUNDLE_PY")/.." -name "*.so" -o -name "*.dylib" 2>/dev/null \
    | xargs -I{} codesign --force --sign - --timestamp=none {} 2>/dev/null

echo "==> Sanity-checking imports"
"$BUNDLE_PY" -c "import audio_separator, onnxruntime, soxr; print('OK', 'onnxruntime', onnxruntime.__version__, 'soxr', soxr.__version__)"

echo ""
echo "Done. RTM's Mac python-bundle now carries the UAI runtime."
echo "Win CI installs the same set on every build (workflow cache key v3-uai)."
