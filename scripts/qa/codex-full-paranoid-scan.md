# Codex prompt — FULL paranoid scan, system-wide

This is the full paranoid scan of RTM Suite. Read
`scripts/qa/paranoid-scan-prompt.md` for the methodology — three
outputs (BUGS / CALCULATIONS / TIGHTENING RECOMMENDATIONS), unforgiving,
honest > flattering.

## Current state of the system (so you don't have to re-read everything)

**Shipped this cycle:**
- Stage 1 — FLOW removal: `src/deliveryManifest/`, `DeliveryManifestPanel`,
  `ReleaseCockpit`, `LabelTour`, `ReleaseCard`, `releasesStore.ts`
  deleted; IPC handlers `bwf-write` / `releases-*` / `audit-*` /
  `isrc-history-*` removed; `MetadataPanel` now read-only.
- Stage 2 — Spec validation pack: `python/specs.py` (16 specs,
  `SPECS_VERSION=1`), `scripts/generate_specs.py`, auto-generated
  `src/specs.ts`, every analyzer entrypoint stamps `spec_versions` on
  the result, `<SpecDriftBadge>` for stale-spec detection.
- Stage 3 — Per-stem AI detection: already live via the v4.1 detector
  rebuild — `ai_detection.stem_verdicts` array on every result.
- Stage 4 — Mastering-delta tab: `mastering_delta` field on two-file
  compare, signature hash, 7th tab in AnalysisView.

**Earlier-cycle Python fixes (still live in installed app):**
- BUG 4 mono-compat `phase_penalty = max(0, -corr - 0.05)` deadband
- BUG 5 unused `np.mean` of empty list removed
- BUG 6 `np.errstate` wraps on three `corrcoef` sites
- Librosa `pitch_tuning` UserWarning suppressed
- Short-term LUFS off-by-one fix (`+1` on the range bound)
- Mastering-engineer-curve switched from 1 kHz pivot to A-weighted-
  mean alignment

**Known regression flagged by the previous QA pass:**
The earlier QA pipeline reported "fast-mode analyzer JSON has no
`ai_detection` object." This may be a real regression introduced by
one of the recent stages, or it may always have been the case that
fast mode skips AI detection (in which case it's a doc / contract
issue, not a regression). **Determine which and treat accordingly.**

**Test corpus (regenerated in this session):**
- 11 golden synthetics at `/tmp/rtm-qa-golden/0[1-9]_*.wav`,
  `09_rough_mix_m05db.wav`, `10_*.wav`
- 3 real human files:
  - `/Users/ohadnissim/Downloads/MIX.wav`
  - `/Users/ohadnissim/Downloads/DEMO.wav`
  - `/Users/ohadnissim/Downloads/119-waiting-kills-134-bpm-plxy.wav`

The corpus generator is at `scripts/qa/regenerate_goldens.py` if you
need to inspect what each signal contains.

## Three required outputs

### 1. BUGS

Walk every analyzer JSON output, every UI panel claim, every
state-transition path the renderer can reach. For each bug:

- Severity P0 (data loss / crash / blocks workflow) → P3 (cosmetic).
- Reproduction (exact commands or steps).
- Root cause (file:line).
- Fix direction (don't apply unless trivial).

Specifically verify:
- The fast-mode `ai_detection` regression flagged above. Run
  `analyze.py <file> <file> --fast --profile=off` on real human files
  and on goldens; check whether `ai_detection` is in the JSON. If it
  isn't, find where the field gets dropped — is it gated on Deep
  Scan, or is it silently failing?
- Each of the four shipped stages: is its acceptance criterion still
  met? If Stage 4 broke Stage 2 in subtle ways, this is your chance
  to catch it.
- Stderr cleanliness across all 11 goldens.
- Any `np.corrcoef`, `np.mean`, `np.log`, `/` on user-derived data
  that's missing a guard.
- Schema regressions: any field RENAMED or REMOVED from the analyzer
  JSON in any code path.

### 2. CALCULATIONS

Verify every numeric output the analyzer emits against independent
ground truth. The earlier paranoid scan ran 711 row-checks across the
golden corpus; do the same here. Add the new fields shipped this
cycle:
- `spec_versions.specs.<id>.targets.*` — verify each target value
  against its cited spec URL, flag drift.
- `mastering_delta.broadband_gain_db` — verify on the matched -0.5 dB
  pair (`09_rough_mix.wav` vs `09_rough_mix_m05db.wav`); expected
  ≈ -0.5 dB. Verify `signature_hash` is stable across re-runs.
- `mastering_delta.per_band_gain_db` — verify the 31 entries against
  computing the difference of the two normalised spectra directly.
- `ai_detection.stem_verdicts` — independently separate stems with
  Demucs (or similar) on `MIX.wav`, run the AI detector on each, and
  diff against what the analyzer reports.

Independent ground truth via system `python3` + `numpy` + `soundfile`
+ `pyloudnorm`. Don't trust the analyzer's own code as ground truth.

### 3. TIGHTENING RECOMMENDATIONS

Hunt for places where the displayed output is correct but fragile,
loose, or could be more defensible. Categories from the methodology:
- Fragile pivots / single-band normalisations
- Mean where median would survive outliers
- Threshold defensibility (clipping, TP-over alarms, mono-compat
  thresholds)
- Smoothing / windowing inappropriate for signal length
- Statistics that should be percentiles instead of max
- Cross-metric coherence (do two fields that should agree?)
- Locale / time-zone hazards in displayed timestamps
- Perceptual weighting opportunities

Rank by **value/effort** descending. For each:
- Where (file:line)
- Shown today (current value or formula)
- Weakness (one sentence)
- Proposed (snippet)
- Evidence (test case showing the change improves output)
- Effort
- Value/effort score

## Output

Write the report to `release/v4.0-rc2/qa-paranoid-scan-2.md`.

Three sections: `## BUGS`, `## CALCULATIONS`, `## TIGHTENING
RECOMMENDATIONS`. Plus the standard executive summary up top.

## Constraints

- **DO NOT** run `npm run build` or `vite` — Mac OOMs.
- **DO NOT** read every component file — read what each finding
  requires. The previous Stage 2 build session ran out of context
  doing this.
- **DO NOT** modify source files unless fixing a small bug — log it
  under "Bugs fixed in this pass" if you do.
- **DO NOT** rerun the analyzer in parallel against the same paths —
  shared `~/.rtm/stems` directory will race.
- If you hit a P0 mid-scan that blocks the rest, stop, write the
  interim report, exit.

## Anti-patterns

- "I assume X works" → re-test X.
- "The build session said it shipped" → verify on disk.
- Drive-by refactors → not your job.
- Marking a bug "fixed" without re-running the regression test that
  flagged it.
- Fabricating findings to look thorough — if the system is clean,
  write `Verdict: PASS` and exit.

This is the trust pass. Honest > flattering.
