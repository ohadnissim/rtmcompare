# Codex prompt — Stage 6: Stem-level QC

Surface stem-level analysis through the entire QC stack as a "By Stem"
drill-down on every panel. Per
`release/v4.0-rc2/ship-next-roadmap.md` section 2.1.

## What it does

RTM already runs Demucs / Spleeter for stem separation during Deep
Scan (`python/separator.py`, `python/spleeter_run.py`). Today the
stems feed the AI detector and masking analysis only. The full QC
stack — LUFS, per-band mono-risk, distortion, transient density — is
only computed mix-level.

A vocal mix that's AI-generated while the instrumental is real, or
distortion localised to the bass stem rather than the entire mix, is
real-world common and currently invisible to RTM users.

This stage threads the existing Demucs output through the QC pipeline
recursively and surfaces a "By Stem" toggle per panel.

## Build

### A. Recursive analyzer invocation in Python

`python/analyze.py` already separates stems for the AI detector. Add a
second pass that runs `python/comparator.py` (or the appropriate
single-file analyzer) on each stem path after separation:

```python
# After existing stem separation:
if stems_dir and deep_mode:
    per_stem_results = {}
    for stem_name in ["vocals", "drums", "bass", "other"]:
        stem_path = os.path.join(stems_dir, f"{stem_name}.wav")
        if not os.path.exists(stem_path):
            continue
        try:
            per_stem_results[stem_name] = run_single_file_qc(stem_path)
        except Exception as e:
            _warn_optional(f"per_stem_qc/{stem_name}", e)
    result["per_stem"] = per_stem_results
```

`run_single_file_qc()` wraps the existing analyser entrypoint —
factor out a function from `analyze.py`'s current logic that takes
a single file path and returns a result dict.

Each stem result keeps the same shape as a mix-level result so the UI
can iterate uniformly: `lufs`, `true_peak_dbtp`, `spectrum_a`,
`mono_compat`, `distortion`, `transient_density`, etc.

### B. New TypeScript type

`src/types.ts`:

```typescript
export interface PerStemResult {
  lufs: number
  true_peak_dbtp: number
  lra: number
  spectrum: number[]
  mono_compat?: MonoCompatibility
  distortion?: DistortionResult
  transient_density?: TransientDensity
  // … any other field that's stem-meaningful
}

export interface AnalysisResult {
  // … existing fields …
  per_stem?: Partial<Record<'vocals' | 'drums' | 'bass' | 'other', PerStemResult>>
}
```

### C. UI drill-down toggle

Add a "By Stem" toggle to each existing panel that has stem-meaningful
data. Toggle off (default) = existing mix-level row. Toggle on = four
rows, one per stem.

Touch only:
- `src/components/RefOnlyView.tsx` — wrap each section's heading with
  a `<ByStemToggle>` switch.
- `src/components/MonoCompat.tsx` — accept `perStem?: ...` prop, when
  the toggle is on, render four mini-tables instead of one.
- `src/components/DistortionPanel.tsx` — same pattern.
- `src/components/TransientDensityPanel.tsx` (if it exists) — same.
- `src/components/SpectrumOverlay.tsx` — accept `perStem` prop, draw
  four curves overlaid (each in a slightly different cream tint).

The toggle state lives in a single React context
(`ByStemContext`) so toggling once shifts every panel.

### D. Don't expand Deep Scan time more than necessary

Per-stem QC adds 4× the per-track analyser cost. Run it inside the
existing Deep Scan code path so users opting into Deep Scan get it
"free". Don't run it for fast scans.

### E. Patch source + installed

Both `python/analyze.py` source AND
`/Applications/RTM Suite.app/Contents/Resources/python/analyze.py`.
Clear `__pycache__`.

## Acceptance

- Run `analyze.py file_a file_b --deep` on a real master. JSON has
  `per_stem.vocals`, `per_stem.drums`, etc. populated with stem-level
  metrics.
- Toggling "By Stem" in `RefOnlyView` re-renders every panel that has
  per-stem data with the four-row treatment.
- No regression in existing mix-level outputs.
- Stderr clean on the 10 golden signals.
- Renderer typechecks.
- Both source + installed Python patched.
- Append "Stage 6 landed" section to ship-next-roadmap.md.

## Constraints

- Don't run `npm run build` or `vite`.
- Don't add new corrcoef sites without `np.errstate` wraps.
- Don't break the existing JSON schema.
- Don't run per-stem QC in fast mode — only in Deep Scan.

## Anti-patterns

- Don't re-implement analyser logic in stem path. Factor existing
  `analyze.py` flow into `run_single_file_qc()` and reuse.
- Don't read every .tsx file in the source tree. You'll touch ~5
  components; visit only those.
- Don't introduce a per-stem analyzer per-stem-different-from-mix.
  Stems use the same analyzer code path.
