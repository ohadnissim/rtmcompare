# Codex prompt — rebuild RTM Suite AI-detection per its own v4.1 plan

Rebuild RTM Suite's AI-music-detection system according to the v4.1 plan
in `release/v4.0-rc2/qa-codex-ai-detector-review.md` (your own work —
read sections 1, 2, and 3, plus recommendation 19 "Minimum viable v4.1
plan (pragmatic sequencing)").

## Scope — implement steps 1 through 5 of your plan

1. **Reliability + confidence framework.** Every probe returns
   `(score, reliability, reason)`. Aggregate uses `weight × reliability`.
   Add a top-level `confidence` (coverage × agreement) and
   `confidence_band` enum (`low` / `medium` / `high`).
2. **Replace the spectral-ceiling logic and the spectral-artifact
   internals.** Use the architecture-aware periodic-peak detector you
   proposed (recommendation 1). Use the comb-periodicity / cross-section
   stability detector you proposed (recommendation 8).
3. **Vocal-activity gating.** Front-gate the vocal-naturalness probe
   with a cheap VAD (recommendation 4). If vocal activity is too low,
   mark probe `reliability=0` and return.
4. **De-weight or remove weak probes** in the aggregate per
   recommendations 5, 6, 7, 16, 18:
   - REMOVE stereo-phase from aggregate (keep as diagnostic field)
   - REPLACE harmonic-regularity (chroma-ratio) with HPSS residual
     coherence
   - Make timing + dynamics context-conditional
   - Rebalance no-stem default weights per recommendation 16
5. **Calibration layer + benchmark harness.**
   - Add isotonic-regression-based calibration (recommendation 11).
     Real labelled Suno/Udio data isn't available locally — fit
     against the 10 synthetic golden signals + 3 real human files we
     have, AND document explicitly that the calibrator needs a
     proper labelled corpus to be deployment-grade. Save the
     calibration curve as a JSON file the analyser loads at startup.
   - Build the benchmark harness as
     `scripts/qa/ai_detector_bench.py`, re-runnable, prints a
     per-file table, writes results to
     `release/v4.0-rc2/ai-detector-bench.json`.

Skip step 6 (SynthID/watermark sniffing). It's optional in your own
plan and requires libraries we don't have locally.

Also apply your "cheap rename" recommendation: rename
`ai_detection.probability` → `ai_detection.risk_score_raw` AND keep
`probability` as an alias. Keep `probability` set to the same value
as `risk_score_raw` and add `probability_calibrated: false` until a
labelled corpus retrains the isotonic mapping. This lets the renderer
keep working without code changes.

## Constraints

- **Backward-compat the JSON schema.** The Electron renderer reads
  specific field names off `ai_detection.*` (`score`, `probability`,
  `detail`, plus per-probe details). You can ADD new fields freely
  (`risk_score_raw`, `confidence`, `confidence_band`, `unknown` verdict
  state, per-probe `reliability`) but don't remove any field that's
  currently produced.
- **Don't run a build.** This Mac OOMs vite. Renderer rebuild happens
  elsewhere. Your work lives entirely on the Python side.
- **Patch both copies.** Source at `python/ai_detector.py` AND
  installed at `/Applications/RTM Suite.app/Contents/Resources/python/ai_detector.py`.
  Clear `__pycache__` after.
- **Stay in numpy / scipy / librosa.** No new heavy ML deps. No
  torch, no tensorflow, no model weights.
- **Maintain stderr cleanliness.** All 10 golden signals must continue
  to produce zero stderr warnings — the corrcoef errstate wraps and
  the librosa `pitch_tuning` UserWarning suppression are already in
  place; if your refactor introduces new warning sources, suppress
  them at the source.

## Test corpus

- 10 golden synthetics: `/tmp/rtm-qa-golden/0[1-9]_*.wav` and
  `/tmp/rtm-qa-golden/10_*.wav`
- 3 real human files:
  - `/Users/ohadnissim/Downloads/MIX.wav`
  - `/Users/ohadnissim/Downloads/DEMO.wav`
  - `/Users/ohadnissim/Downloads/119-waiting-kills-134-bpm-plxy.wav`

## Acceptance criteria

- All 13 files run end-to-end without errors.
- Stderr is clean on all 13.
- All 3 real human files move from `uncertain` to either
  `likely_human` OR `unknown (low_confidence)` — that was your own
  predicted effect (recommendation 20).
- Each per-probe block now has a `reliability` field in the JSON.
- Top-level output has `risk_score_raw`, `confidence`,
  `confidence_band`, and a verdict that supports the new `unknown`
  state.
- The benchmark script runs and writes `ai-detector-bench.json`.

## Direct-Python invocation pattern (for testing)

```
/Applications/RTM\ Suite.app/Contents/Resources/python-bundle/python/bin/python3 \
  /Applications/RTM\ Suite.app/Contents/Resources/python/analyze.py \
  <wav> <wav> --fast --profile=off
```

## Deliverables

1. Refactored `python/ai_detector.py` (source + installed copy patched, pycache cleared)
2. New `scripts/qa/ai_detector_bench.py` with the benchmark harness
3. Calibration curve JSON loaded at analyser startup
4. Append a section to `release/v4.0-rc2/qa-codex-ai-detector-review.md`:

```markdown
## Rebuild — 2026-04-25

### Steps landed
- (per-step summary, file:line refs)

### Test results
- 10 golden signals: pass/fail per signal × top-level verdict
- 3 real human files: before/after (was uncertain at p=0.127, now ...)

### Known limitations / what's still needed
- (in particular the calibration data deficit — say so explicitly)

### Files touched
- (list)
```

If you hit a P0 mid-rebuild that blocks the rest, stop, write a short
interim section, and exit so I can fix.

## Anti-patterns — don't ship these

- Don't fabricate a calibration curve from synthetic-only data and
  pretend it's deployment-ready. Document the deficit explicitly.
- Don't break stderr cleanliness — it took multiple passes to get
  there.
- Don't introduce a new corrcoef site without an `np.errstate` wrap.
- Don't change the JSON shape in a way that crashes the existing
  renderer.
- Don't add `if __name__ == '__main__'` test code in
  `ai_detector.py` itself; tests live in `scripts/qa/`.

Take your time. Read your own report first. Then refactor. Then test.
Write the report appendix only after the tests pass.
