#!/usr/bin/env bash
# 5.5.0 — install the BS-RoFormer separator deps into RTM's local Mac
# python-bundle. The full 24-detector AI ensemble was removed in 5.5.0
# (would have shipped 1.1 GB of model weights for it); only the
# stem-separation backend remains.
#
# Run from the project root:
#   bash scripts/install_uai_deps.sh
#
# What it adds:
#   - audio-separator>=0.30 — BS-RoFormer 4-stem inference frontend
#   - onnxruntime==1.19.2   — separator preprocessing on some paths
#   - soxr>=0.5.0           — high-quality resampler

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE_PY="$PROJECT_ROOT/python-bundle/python/bin/python3"

if [ ! -x "$BUNDLE_PY" ]; then
    echo "ERROR: python-bundle interpreter not found at $BUNDLE_PY" >&2
    echo "Build/refresh the bundle first, then re-run this script." >&2
    exit 1
fi

echo "==> Installing BS-RoFormer separator deps into $BUNDLE_PY"
"$BUNDLE_PY" -m pip install --no-warn-script-location \
    "audio-separator>=0.30" \
    "onnxruntime==1.19.2" \
    "soxr>=0.5.0"

echo "==> Clearing macOS quarantine + ad-hoc-signing fresh dylibs"
xattr -cr "$(dirname "$BUNDLE_PY")/.."  # python-bundle/python/
find "$(dirname "$BUNDLE_PY")/.." \( -name "*.so" -o -name "*.dylib" \) 2>/dev/null \
    | xargs -I{} codesign --force --sign - --timestamp=none {} 2>/dev/null || true

echo "==> Sanity-checking imports"
"$BUNDLE_PY" -c "import audio_separator, onnxruntime, soxr; print('OK', 'onnxruntime', onnxruntime.__version__, 'soxr', soxr.__version__)"

echo ""
echo "Done. RTM's Mac python-bundle now carries the BS-RoFormer runtime."
echo "Win CI installs the same set on every build (workflow cache key v5-stems-only)."
