#!/usr/bin/env bash
# RTMcompare end-to-end stress test — drives every CLI entry point against
# a real-track corpus the way an engineer or label QC team would use the
# app. Logs every failure to /tmp/rtm-stress-<stamp>/.
#
# Usage:  scripts/stress_test.sh [corpus_dir]
# Default corpus: ~/Dropbox/FLO BOUNCES FOR APPROVAL
#
# Run as a single shot — one notification at completion. Output gathered
# in the per-run dir; tail summary printed at exit.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORPUS="${1:-$HOME/Dropbox/FLO BOUNCES FOR APPROVAL}"
PYTHON="/Applications/RTMcompare.app/Contents/Resources/python-bundle/python/bin/python3"

if [[ ! -x "$PYTHON" ]]; then
  echo "ERROR: bundled python not found at $PYTHON" >&2
  echo "Install RTMcompare (or fall back to system python3 — slower, may miss deps)." >&2
  exit 2
fi

if [[ ! -d "$CORPUS" ]]; then
  echo "ERROR: corpus dir not found: $CORPUS" >&2
  exit 2
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="/tmp/rtm-stress-$STAMP"
mkdir -p "$OUT"
LOG="$OUT/stress.log"
SUMMARY="$OUT/summary.txt"

echo "=== RTMcompare stress test — $STAMP ===" | tee "$LOG"
echo "corpus : $CORPUS" | tee -a "$LOG"
echo "python : $PYTHON" | tee -a "$LOG"
echo "out    : $OUT" | tee -a "$LOG"

# Pick ten tracks. WAV/AIFF/FLAC/MP3 — anything the analyser ingests.
mapfile -t TRACKS < <(find "$CORPUS" -maxdepth 1 -type f \( -iname "*.wav" -o -iname "*.flac" -o -iname "*.aif" -o -iname "*.aiff" -o -iname "*.mp3" -o -iname "*.m4a" \) 2>/dev/null | head -10)

if (( ${#TRACKS[@]} < 2 )); then
  echo "ERROR: need at least 2 tracks in corpus, found ${#TRACKS[@]}" | tee -a "$LOG" >&2
  exit 2
fi

echo "tracks : ${#TRACKS[@]}" | tee -a "$LOG"
for t in "${TRACKS[@]}"; do echo "  - ${t##*/}" | tee -a "$LOG"; done

# Counters scoped to the summary writer.
PASS=0; FAIL=0; SKIP=0
declare -a FAILS=()

run_step () {
  local name="$1"; shift
  local logf="$OUT/${name}.log"
  echo "" | tee -a "$LOG"
  echo "── $name ──" | tee -a "$LOG"
  local t0=$SECONDS
  if "$@" >"$logf" 2>&1; then
    local dt=$(( SECONDS - t0 ))
    echo "  ok    (${dt}s) → $logf" | tee -a "$LOG"
    PASS=$((PASS+1))
  else
    local rc=$?
    local dt=$(( SECONDS - t0 ))
    echo "  FAIL  rc=$rc (${dt}s) → $logf" | tee -a "$LOG"
    FAIL=$((FAIL+1))
    FAILS+=("$name (rc=$rc)")
    # Tail the failing log into the main log so the summary is self-contained.
    tail -10 "$logf" | sed 's/^/    /' | tee -a "$LOG" >/dev/null
  fi
}

# Use the first track as "A" and the second as the reference "B"; subsequent
# steps cycle through tracks for batch / translation tests.
A="${TRACKS[0]}"
B="${TRACKS[1]}"

# 1. Single-file analysis — fast mode
run_step "analyze-fast"      "$PYTHON" "$ROOT/python/analyze.py" "$A" "$B" --fast

# 2. Single-file analysis — hybrid (default, slower; uses Demucs stems)
run_step "analyze-hybrid"    "$PYTHON" "$ROOT/python/analyze.py" "$A" "$B"

# 3. Reference check against streaming targets
if [[ -f "$ROOT/python/reference_check.py" ]]; then
  run_step "reference-check" "$PYTHON" "$ROOT/python/reference_check.py" "$A"
fi

# 4. Batch analyse the whole album (everything we found)
run_step "batch-analyze"     "$PYTHON" "$ROOT/python/batch_analyze.py" "${TRACKS[@]}"

# 5. Translation-render — phone, earbuds, club, car. Renders 30 s of A.
for env in phone_speaker earbuds club_pa car_cabin; do
  run_step "translate-$env"  "$PYTHON" "$ROOT/python/translation_render.py" "$A" "$OUT/translate-${env}.m4a" "$env"
done

# 6. Master-chain render — applies Master Assistant's full pipeline.
# Arg order is `<in> <out> <config.json>` (output BEFORE config — see
# python/master_chain.py:511).
if [[ -f "$ROOT/python/master_chain.py" ]]; then
  echo '{"hpf_hz":30,"comp":{"on":false},"limiter":{"on":true,"ceiling_dbtp":-1.0,"target_lufs":-14.0}}' >"$OUT/mc.json"
  run_step "master-chain"    "$PYTHON" "$ROOT/python/master_chain.py" "$A" "$OUT/master-chain-out.wav" "$OUT/mc.json"
fi

# 7. Encoded preview — what each streaming platform serves the listener
if [[ -f "$ROOT/python/encoded_preview.py" ]]; then
  for plat in spotify apple tidal youtube; do
    run_step "encoded-$plat" "$PYTHON" "$ROOT/python/encoded_preview.py" "$A" "$OUT/preview-${plat}.m4a" "$plat"
  done
fi

# 8. Two-track A/B comparator (different track each iteration)
for i in 1 2 3; do
  AA="${TRACKS[0]}"
  BB="${TRACKS[$i]}"
  run_step "compare-pair-$i" "$PYTHON" "$ROOT/python/analyze.py" "$AA" "$BB" --fast
done

# Detector / panel modules are imported by analyze.py — they don't have
# CLI entry points, so probing them as scripts is meaningless. The
# detector logic is exercised under analyze-hybrid above.

# Summary
{
  echo ""
  echo "=== SUMMARY $STAMP ==="
  echo "pass   : $PASS"
  echo "fail   : $FAIL"
  echo "skip   : $SKIP"
  echo ""
  if (( FAIL > 0 )); then
    echo "Failed steps:"
    for f in "${FAILS[@]}"; do echo "  - $f"; done
    echo ""
    echo "Drill into failures: cat $OUT/<step>.log"
  else
    echo "All steps passed."
  fi
  echo ""
  echo "Run dir: $OUT"
} | tee "$SUMMARY" | tee -a "$LOG"

# Exit non-zero if anything failed so the caller can react.
[[ "$FAIL" -eq 0 ]]
