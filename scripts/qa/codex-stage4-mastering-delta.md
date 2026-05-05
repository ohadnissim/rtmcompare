# Codex prompt — Stage 4: Mastering-delta tab

Build the "Mastering Delta" tab described in
`release/v4.0-rc2/ship-next-roadmap.md` section 2.3. This is a UI
synthesis layer over the existing two-file compare result — a tab in
the Compare view that turns RTM into a mastering-engineer's
self-review tool.

## What it does

Engineer drops their rough mix as File A and the mastered version as
File B, hits Compare. RTM already computes everything. The new tab
just renders a "what mastering changed" report card:

1. **Net gain applied** — broadband + per-band 31-row 1/3-octave
2. **Dynamic range delta** — LRA before → after, PSR delta,
   RMS-to-peak delta
3. **Transient handling** — peak-to-RMS ratio change, transient
   density flattening %
4. **Stereo width per band** — wider / narrower / no-change marker
   per row
5. **Inter-sample peak handling** — TP overs in source pulled back,
   limiter aggressiveness estimate
6. **Perceived loudness gain per platform** — using existing
   `streaming_preview` data, show "Spotify net gain: +5.3 dB"
7. **Mastering signature hash** — short fingerprint (first 8 hex
   chars of SHA-256 of the rounded delta vector) so the engineer can
   see "this matches my usual pattern" or "this session diverged"

## Build

### A. Compute delta fields in Python

Most fields already exist in `python/comparator.py`'s output. The
mastering-signature hash is new. Add to `comparator.py`:

```python
def _mastering_signature(spec_diff: list[float]) -> str:
    """8-hex-char fingerprint of the rounded 31-band per-band gain
    delta. Stable across noise — values rounded to 0.5 dB before
    hashing — but distinct enough that a different chain reads as a
    different signature."""
    import hashlib
    rounded = [round(v * 2) / 2 for v in spec_diff]
    payload = ",".join(f"{v:.1f}" for v in rounded).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:8]
```

Stamp the result with `mastering_delta`:

```python
result["mastering_delta"] = {
    "broadband_gain_db": result["overall"]["lufs_b"] - result["overall"]["lufs_a"],
    "per_band_gain_db": [...31 entries...],
    "lra_delta": result["overall"]["lra_b"] - result["overall"]["lra_a"],
    "psr_delta": ...,
    "transient_density_change_pct": ...,
    "stereo_width_change_per_band": [...31 entries...],
    "tp_overs_pulled_back": ...,
    "limiter_aggressiveness": ...,  # heuristic 0..1 from gain reduction
    "perceived_gain_per_platform": {"spotify": ..., "apple_music": ..., ...},
    "signature_hash": _mastering_signature(...),
}
```

Only emit `mastering_delta` when both files are present (skip in
single-file QC). Wrap in try/except — if any input field is missing
emit a partial dict with whatever's available.

### B. New TypeScript type

`src/types.ts`:

```typescript
export interface MasteringDelta {
  broadband_gain_db: number
  per_band_gain_db: number[]
  lra_delta: number
  psr_delta: number
  transient_density_change_pct: number
  stereo_width_change_per_band: number[]
  tp_overs_pulled_back: number
  limiter_aggressiveness: number
  perceived_gain_per_platform: Record<string, number>
  signature_hash: string
}
```

Add `mastering_delta?: MasteringDelta` to `AnalysisResult`.

### C. New component

`src/components/MasteringDelta.tsx` — the tab content. Layout:

```
┌─────────────────────────────────────────────────────┐
│  Mastering Delta — signature: a3f9b2c1            │
├─────────────────────────────────────────────────────┤
│  Broadband: +5.3 dB  ·  LRA: 8.4 → 5.7 LU (−2.7)   │
│  Limiter aggressiveness: 0.74 (heavy)               │
│                                                     │
│  Per-band gain (31 rows, 1/3-octave):              │
│  20 Hz   ████░░░░░░  +1.2 dB  (no width change)    │
│  25 Hz   ███░░░░░░░  +0.9 dB  (-2 width)           │
│  ... 31 rows ...                                    │
│                                                     │
│  Perceived loudness gain by platform:              │
│  Spotify        +5.3 dB                             │
│  Apple Music    +3.3 dB                             │
│  YouTube        +5.3 dB                             │
│  ...                                                │
│                                                     │
│  Transient density: −12% (rounded off)              │
│  TP overs pulled back: 47 → 0                       │
└─────────────────────────────────────────────────────┘
```

Style consistent with other Compare tabs — same gold accent, same
collapsible rows. Use the existing `<CollapsibleSection>` pattern.

### D. Wire it as a Compare tab

`src/components/AnalysisView.tsx` has the 6-tab Compare bar
(Overview / Delivery / Stereo & Spectrum / EQ Match / Breakdown /
Quality). Add a 7th: **Mastering Delta**. Render only when
`results.mastering_delta` is present (which only happens when both
files are non-identical and the analysis ran in compare mode).

### E. Patch source + installed

Both `python/comparator.py` source AND
`/Applications/RTM Suite.app/Contents/Resources/python/comparator.py`.
Clear `__pycache__`.

## Acceptance

- Run `analyze.py rough.wav mastered.wav` on any two real masters and
  the JSON has `mastering_delta` populated.
- Run on `/tmp/rtm-qa-golden/09_rough_mix.wav` and
  `/tmp/rtm-qa-golden/09_rough_mix_m05db.wav` (the matched pair from
  the calc-verification suite — the 0.5 dB difference). Verify the
  delta math is correct: `broadband_gain_db ≈ -0.5`,
  `signature_hash` is consistent across re-runs.
- No regressions in the existing 10 golden signals' analyzer output.
- Both source + installed Python patched, pycache cleared.
- Renderer typechecks (`npx tsc --noEmit -p tsconfig.json`).
- Append a "Stage 4 landed" section to
  `release/v4.0-rc2/ship-next-roadmap.md` listing every file touched.

## Constraints

- Don't run `npm run build` or `vite` — Mac OOMs.
- Don't change the JSON schema in ways that break existing renderer
  consumers.
- Don't introduce new corrcoef sites without `np.errstate` wraps.
- Don't break stderr cleanliness.

## Anti-patterns

- Don't read every file in `src/components/`. You only need
  `AnalysisView.tsx` + the new `MasteringDelta.tsx` + the existing
  `<CollapsibleSection>` pattern (look at `RefOnlyView.tsx` for
  examples — but read sparingly).
- Don't add a heavy stats library. Use numpy.
- Don't fabricate values you can't compute. If `tp_overs_pulled_back`
  isn't recoverable from the existing fields, omit it.
