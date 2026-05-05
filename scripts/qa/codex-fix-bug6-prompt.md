# Codex prompt — fix BUG 6 (corrcoef divide-by-zero on degenerate spectral frames)

You are fixing one P3 bug in RTM Suite v4.0. The bug is documented in
`release/v4.0-rc2/qa-codex-paranoid.md` (the most recent re-verification
section near the bottom of the file). Read that first if you want context.

## The bug

`python/ai_detector.py:543` — inside `_check_spectral_artifacts` — calls
`np.corrcoef(frame, other)[0, 1]` on spectral frames that can be
zero-variance (pure silence, click-track gaps). NumPy then prints:

```
/Applications/RTM Suite.app/Contents/Resources/python-bundle/python/lib/python3.11/site-packages/numpy/lib/_function_base_impl.py:3023: RuntimeWarning: invalid value encountered in divide
/Applications/RTM Suite.app/Contents/Resources/python-bundle/python/lib/python3.11/site-packages/numpy/lib/_function_base_impl.py:3024: RuntimeWarning: invalid value encountered in divide
```

…to stderr. The returned `corr` is `NaN`, which the existing
`if not np.isnan(corr)` guard at line 544 already filters out, so the
**logic is already correct** — the warning is purely cosmetic stderr
noise.

The previous BUG 5 fix in this same function removed an unrelated empty
`np.mean(...)` line; it didn't touch the corrcoef path.

Confirmed-affected golden signals:

- `/tmp/rtm-qa-golden/06_silence_30s.wav` — 1 warning per analysis run
- `/tmp/rtm-qa-golden/07_click_120bpm.wav` — 2 warnings per analysis run

The other 8 signals analyse with clean stderr.

## Fix

Pick the cheaper of the two below — your call, both are correct:

**Option A (errstate wrap — preferred):**
```python
with np.errstate(invalid='ignore', divide='ignore'):
    corr = np.corrcoef(frame, other)[0, 1]
```

**Option B (explicit guard):**
```python
if np.std(frame) < 1e-12 or np.std(other) < 1e-12:
    corr = float('nan')
else:
    corr = np.corrcoef(frame, other)[0, 1]
```

Option A is one extra line, no behavior change, just suppresses NumPy's
stderr noise inside the call. Option B short-circuits before the call
but adds a couple of lines.

After editing the source, **also patch the installed copy** so the running
analyzer benefits without a rebuild:

```bash
cp "/Users/ohadnissim/Compare App/python/ai_detector.py" \
   "/Applications/RTM Suite.app/Contents/Resources/python/ai_detector.py"
rm -f "/Applications/RTM Suite.app/Contents/Resources/python/__pycache__/ai_detector.cpython-"*.pyc
```

The reason for the dual update: this Mac can't rebuild the production DMG
(vite OOMs at the optimizer pass — confirmed by the user). The installed
app's Python is read fresh on every analyzer invocation, so patching it
directly is how fixes ship until a rebuild lands on a stronger machine.

## Verify the fix

Run the same two golden signals that previously triggered warnings.
After the fix, BOTH should show **zero warnings** on stderr:

```bash
PY="/Applications/RTM Suite.app/Contents/Resources/python-bundle/python/bin/python3"
ANALYZE="/Applications/RTM Suite.app/Contents/Resources/python/analyze.py"
for w in /tmp/rtm-qa-golden/06_silence_30s.wav /tmp/rtm-qa-golden/07_click_120bpm.wav; do
  echo "--- $(basename "$w") ---"
  STDERR=$("$PY" "$ANALYZE" "$w" "$w" --fast --profile=off 2>&1 >/dev/null)
  WARNCOUNT=$(echo "$STDERR" | grep -cE "RuntimeWarning|invalid value" || true)
  if [ "$WARNCOUNT" -eq 0 ]; then
    echo "  PASS: stderr clean"
  else
    echo "  FAIL: $WARNCOUNT warnings still present"
    echo "$STDERR" | grep -E "RuntimeWarning|invalid value" | head -3
  fi
done
```

Then re-run all 10 golden signals to confirm no regressions on the others:

```bash
PY="/Applications/RTM Suite.app/Contents/Resources/python-bundle/python/bin/python3"
ANALYZE="/Applications/RTM Suite.app/Contents/Resources/python/analyze.py"
for w in /tmp/rtm-qa-golden/*.wav; do
  STDERR=$("$PY" "$ANALYZE" "$w" "$w" --fast --profile=off 2>&1 >/dev/null)
  WARNCOUNT=$(echo "$STDERR" | grep -cE "RuntimeWarning|invalid value" || true)
  printf "%-40s %s\n" "$(basename "$w")" "$([ "$WARNCOUNT" -eq 0 ] && echo clean || echo "$WARNCOUNT warnings")"
done
```

Acceptance: every signal shows `clean`. If any signal regresses (was
clean before, has warnings now), back out the change and report.

Also confirm the AI-detection score itself didn't drift on the affected
signals — `_check_spectral_artifacts` returns `{"score": float, "detail": str}`.
For silence and the click track, the score should remain whatever it was
before the fix (the original NaN-filter guard already eliminated those
frames from the average). Spot-check by parsing the analyzer JSON:

```bash
PY="/Applications/RTM Suite.app/Contents/Resources/python-bundle/python/bin/python3"
ANALYZE="/Applications/RTM Suite.app/Contents/Resources/python/analyze.py"
"$PY" "$ANALYZE" /tmp/rtm-qa-golden/07_click_120bpm.wav /tmp/rtm-qa-golden/07_click_120bpm.wav --fast --profile=off 2>/dev/null \
  | python3 -c "import json,sys; r=json.load(sys.stdin); print(json.dumps(r.get('ai_detection', {}), indent=2))"
```

## Update the report

Append a short addendum to `release/v4.0-rc2/qa-codex-paranoid.md` —
just a couple of lines under a `### BUG 6 fix` heading inside the
existing `## Re-verification after tightenings` section:

```markdown
### BUG 6 fix — corrcoef divide-by-zero suppression

- Where: `python/ai_detector.py:543` (and installed copy)
- Fix: <option-A-or-B-with-snippet>
- Stderr after fix: clean across all 10 golden signals
- AI-detection score unchanged on signals 6 and 7 (NaN filter already in place at line 544)
```

## What you must NOT do

- Don't run `npm run build` or `electron-builder` — both OOM on this Mac.
- Don't restart RTM Suite if it's running.
- Don't add new dependencies.
- Don't reformat the surrounding code beyond the fix lines.
- Don't change the AI-detection score logic — only suppress the stderr noise.

## Done condition

- Both source and installed `ai_detector.py` patched.
- All 10 golden signals show clean stderr.
- AI-detection JSON output unchanged on signals 6 and 7 vs. pre-fix.
- Report addendum landed.
- No source files outside `python/ai_detector.py` modified.
