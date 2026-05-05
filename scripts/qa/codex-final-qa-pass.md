# Codex prompt — Final QA / beta-test pass on every shipped stage

Run a comprehensive QA / beta-testing pass across every stage of the
ship-next roadmap that has actually landed. Different Codex session,
fresh eyes, full system view.

## What's shipped (read the roadmap to confirm; don't assume)

Source of truth: `release/v4.0-rc2/ship-next-roadmap.md`. Look for
`## Stage N landed` sections. Whatever stages have those sections are
your scope. As of the last known checkpoint:

- Stage 1 — FLOW feature removal (manifest reconciler, ISRC history,
  Releases store, BWF write-back) → all GONE from RTM.
- Stage 2 — Spec validation pack (`python/specs.py`, 16 specs,
  `spec_versions` stamp on every analyse result, generator,
  `<SpecDriftBadge>` component).
- Stage 3 — Per-stem AI detection (already shipped via the v4.1
  detector rebuild — `stem_verdicts` array on every result).
- Stage 4 — Mastering-delta tab (Compare-view 7th tab; new
  `mastering_delta` field; `signature_hash`).
- Anything else that has a `Stage N landed` appendix: include it.

## Your QA scope — five tracks

### 1. Acceptance regression check

For each shipped stage:
- Re-run every acceptance bullet from its original brief
  (`scripts/qa/codex-stage{N}-*.md`).
- Confirm the bullet is still met after subsequent stages were
  layered on top. Stage 4 might have broken Stage 2 in subtle ways;
  this is your chance to catch it.

### 2. End-to-end smoke

Run the analyzer on every test signal we have:

- 10 golden synthetics: `/tmp/rtm-qa-golden/0[1-9]_*.wav`,
  `10_*.wav`
- 3 real human files:
  - `/Users/ohadnissim/Downloads/MIX.wav`
  - `/Users/ohadnissim/Downloads/DEMO.wav`
  - `/Users/ohadnissim/Downloads/119-waiting-kills-134-bpm-plxy.wav`

Direct-Python invocation:

```bash
PY="/Applications/RTM Suite.app/Contents/Resources/python-bundle/python/bin/python3"
ANALYZE="/Applications/RTM Suite.app/Contents/Resources/python/analyze.py"
"$PY" "$ANALYZE" <wavA> <wavB> --fast --profile=off
```

For each run:
- Confirm `spec_versions` field is present + has 16 specs.
- Confirm `ai_detection.stem_verdicts` is present (when stems
  exist — Deep Scan only; in fast mode it should still emit at
  least the mix-level verdict).
- For two-file compares: confirm `mastering_delta` field is
  populated (if Stage 4 shipped) and the `signature_hash` is stable
  across re-runs of the same input.
- Confirm stderr is **clean** (no RuntimeWarning, no
  invalid-value, no UserWarning). The 10 golden signals must remain
  zero-warning across the suite.

### 3. JSON schema regression

The Electron renderer is currently running against an old vite-built
asar. Any field RENAMED or REMOVED from the analyzer JSON will crash
the installed UI. Audit:

- For every shipped stage, list the fields that were renamed or
  removed (per the brief).
- Confirm none broke an existing renderer field. Additive changes
  (new fields) are fine; renames / removals are not.
- Spot-check a few critical fields the renderer reads:
  `ai_detection.probability`, `ai_detection.score`,
  `ai_detection.detail`, `mono_compat.bands_b`,
  `streaming_preview.b.*.delta_db`, `overall.lufs_a`, etc. Any of
  these missing or differently-shaped → flag P0.

### 4. Typecheck regression

```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.electron.json
```

Both must be clean. If either reports errors, that's a regression
introduced by one of the stages — track it down to the file:line
and the stage that introduced it.

### 5. Static review for the big six concerns

Walk every diff hunk Codex wrote across stages 1–4. For each, check:

- **Math correctness** — is the formula doing what the comment
  claims?
- **NaN / divide-by-zero** — every `np.corrcoef`, `np.mean`, `/`,
  `np.log` on user-derived data has guards or `np.errstate` wrap?
- **Edge cases** — silence, single sample, zero variance, mismatched
  sample rates, mono inputs to stereo paths, missing optional
  fields?
- **Provenance** — does every external value (spec target, codec
  bitrate, AI threshold) cite its source in a comment?
- **Both copies patched** — source + installed Python pairs are
  byte-identical for every Python file Codex touched?
- **Cross-stage interactions** — does Stage 2's
  `spec_versions` field land in batch-mode JSON (Stage 4's path)
  too? Does Stage 3's AI detection still fire correctly through
  Stage 2's instrumentation? Each combination matters.

## Your output

Write a comprehensive QA report at
`release/v4.0-rc2/qa-shipped-stages.md`. Sections:

```markdown
# RTM Shipped-Stages QA Report — YYYY-MM-DD

## Executive summary
- Stages reviewed: ...
- Acceptance failures: ...
- Stderr regressions: ...
- Schema regressions: ...
- Typecheck regressions: ...
- Bugs found and fixed in this pass: ...
- Bugs deferred for triage: ...
- Verdict: PASS / PASS-with-caveats / FAIL

## Per-stage acceptance verification
(for each Stage N: bullet list of "claim → verified" or "claim → failed,
why" with evidence)

## End-to-end smoke results
| Signal | spec_versions | stem_verdicts | mastering_delta | stderr | Pass |
(matrix table)

## Schema regression audit
(per shipped stage: fields renamed / removed, did any break renderer
expectations?)

## Typecheck status
(npx tsc output for both configs)

## Static review findings
(per-stage findings in the six-concerns format above)

## Bugs fixed in this QA pass
(file:line, what changed, why)

## Bugs deferred (need user triage)
(severity, description, recommended fix)

## Verdict + recommendation
- Is the cumulative state of stages 1–4 (and any others) shippable?
- What's the single biggest risk if you move on to Stage 5 today?
```

## Constraints

- **DO NOT** run `npm run build` or `vite` (Mac OOMs).
- **DO NOT** restart the installed app.
- **DO NOT** modify source files unless fixing a small bug — and if
  you do, log it under "Bugs fixed in this QA pass" with rationale.
- **DO NOT** read every component file in the source tree. Read only
  what each stage's brief touched + the diff hunks themselves. The
  previous Stage 2 build session ran out of context window doing
  exactly this.
- If you hit a P0 that blocks the rest of the QA mid-pass, stop,
  write what you've found so far, exit. Don't push through a broken
  state.

## Anti-patterns

- "I assume X works" → re-test X.
- "The build session said it shipped" → verify on disk.
- "I noticed a small code smell while looking at this" → not your
  job. Note it under "Deferred" if useful, otherwise drop it.
- Drive-by refactors → not your job.

Take your time. This is the trust pass before we move on. Honest
findings > flattering findings.
