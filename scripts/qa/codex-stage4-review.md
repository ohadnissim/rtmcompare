# Codex prompt — Stage 4 review + bug fix pass

A previous Codex session just built Stage 4 (Mastering-delta tab) per
the brief at `scripts/qa/codex-stage4-mastering-delta.md`. Your job is
to **review + fix** what was just shipped. Different Codex session,
different eyes, fresh context.

## Read these first

1. `scripts/qa/codex-stage4-mastering-delta.md` — the original brief.
   Tells you what was supposed to land.
2. `release/v4.0-rc2/ship-next-roadmap.md` — the "Stage 4 landed"
   section the build session was told to append. Tells you what the
   builder claims they shipped.
3. The actual diff. `git diff` is your friend if available; otherwise
   inspect the files claimed in the appendix.

## What to do

### 1. Verify acceptance criteria

For each acceptance bullet in the original brief:

- Confirm it's actually met. Don't trust the builder's report —
  reproduce it.
- Run the test commands the brief specified. Specifically:
  - Run `analyze.py` on `/tmp/rtm-qa-golden/09_rough_mix.wav` and
    `/tmp/rtm-qa-golden/09_rough_mix_m05db.wav` (the matched pair from
    the calc-verification suite). The brief said
    `broadband_gain_db ≈ -0.5`. Confirm or flag.
  - Confirm `signature_hash` is stable across re-runs of the same input.
  - Run the full 10-signal stderr sweep — must stay zero warnings.
- For any bullet that the build session claimed met but you cannot
  reproduce, log it under "Acceptance failures" in your review note.

### 2. Static review — bugs, regressions, drift

Read the diff carefully. Look for:

- **Schema regressions** — did the JSON shape change in a way that
  could crash the existing renderer? Any field RENAMED (not added)?
- **Math errors** — does the broadband-gain calculation actually use
  `lufs_b - lufs_a` and not the reverse? Is the per-band delta sign
  consistent with the broadband sign?
- **Edge cases** — what happens on identical files (delta = 0)?
  On single-file QC where there's no File B? On a clipped signal? On
  silence? On an analysis error in either side?
- **Signature stability** — is the rounding deterministic across runs?
  Could float jitter make the hash flip between sessions on the same
  inputs?
- **Stderr regressions** — does the new code add a `np.corrcoef` site
  without an `np.errstate` wrap? A `np.mean` on a possibly-empty list?
  Anywhere libraries might emit a warning?
- **Both copies patched?** — is the source `python/comparator.py` AND
  the installed `/Applications/RTM Suite.app/.../comparator.py` updated?
  Pycache cleared?
- **Renderer typecheck** — `npx tsc --noEmit -p tsconfig.json` clean?
- **Electron typecheck** — `npx tsc --noEmit -p tsconfig.electron.json`
  clean?

### 3. Fix any small bugs you find

If a fix is < 10 lines and clearly correct, **apply it** as part of
this review pass. Patch both source + installed Python where
relevant. Clear pycache. Update the appendix in
`ship-next-roadmap.md` to say "Stage 4 review fixes — YYYY-MM-DD" and
list what you changed and why.

If a fix is bigger, **don't apply it**. Log it under "Deferred
findings" in the review note for the user to triage.

### 4. Output

Append a section to `release/v4.0-rc2/ship-next-roadmap.md`:

```markdown
## Stage 4 review — YYYY-MM-DD

### Acceptance verification
- (per-bullet pass / fail with evidence)

### Bugs fixed in this pass
- (file:line, what changed, why)

### Deferred findings (need user triage)
- (description, severity, recommended fix)

### Verdict
PASS / PASS-with-caveats / FAIL — short summary
```

## Constraints

- **DO NOT read every source file.** Read only the files the build
  session touched (per the appendix it wrote) plus the test outputs.
- **DO NOT run a vite build** — Mac OOMs. Typechecks only.
- **DO NOT change anything beyond bug fixes.** No drive-by
  refactors. No "while I'm here" cleanups.
- **DO NOT run codec audition or stem-level QC.** Those are different
  stages with different test corpora.
- If the build session never appended a "Stage 4 landed" section to
  the roadmap, that's itself a finding — log it and proceed by
  inferring the diff from `git status` / `git diff` if available.

## Anti-patterns

- Don't accept "the test passed" without rerunning the test.
- Don't accept "stderr clean" without rerunning the sweep.
- Don't fabricate fixes for non-existent bugs to look thorough. If
  the build is clean, write `Verdict: PASS` and exit.
