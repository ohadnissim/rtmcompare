# Codex prompt — Stage 2: Spec validation pack

Build the standards-grade validation pack described in
`release/v4.0-rc2/ship-next-roadmap.md` section 1.2. This is
green-field code: a central registry of every loudness / delivery
spec the analyser checks against, with version + date + URL pinned per
spec, so every analysis result emits a `spec_versions` field reports
can show, and a stale-spec badge fires when the pinned spec changes
versus a re-loaded historical analysis.

## Background — read these for context, don't re-read source

- `release/v4.0-rc2/competitive-analysis.md` — verdict + pain points
  (especially P001 streaming-loudness confusion).
- `release/v4.0-rc2/ship-next-roadmap.md` — the spec for what you're
  building (section "1.2 — Standards-grade validation pack").
- `src/dspProfiles.ts` — current hand-coded targets per platform.
  This file becomes a consumer of the new registry.

## Build

### A. Python registry — `python/specs.py` (NEW)

A single dataclass `Spec`:

```python
from dataclasses import dataclass, field
from typing import Any

@dataclass
class Spec:
    id: str                  # stable identifier, e.g. "ebu_r128"
    name: str                # display name
    version: str             # e.g. "R128 v3.0", "ITU-R BS.1770-4"
    published: str           # ISO date "2014-08-01"
    revised: str | None      # ISO date or None
    targets: dict[str, Any]  # {"lufs_i": -23.0, "tp_dbtp": -1.0, ...}
    references: list[str]    # URLs to the public spec documents
    provisional: bool = False  # True for reverse-engineered specs (TikTok, Reels)
```

Pre-populate with these specs, citing only sources you can find:

| id | name | targets to include |
|---|---|---|
| `itu_bs_1770_4` | ITU-R BS.1770-4 | reference for K-weighting; not a delivery spec itself |
| `ebu_r128` | EBU R128 | lufs_i=-23, tp_dbtp=-1, lra_max=18 |
| `atsc_a85` | ATSC A/85 (CALM Act) | lufs_i=-24, tp_dbtp=-2 |
| `apple_music` | Apple Music | lufs_i=-16, tp_dbtp=-1 |
| `apple_digital_masters` | Apple Digital Masters | lufs_i=-16, tp_dbtp=-1, sr_min=44100, bd_min=24 |
| `spotify` | Spotify | lufs_i=-14, tp_dbtp=-1 |
| `spotify_loud` | Spotify Loud | lufs_i=-11, tp_dbtp=-2 |
| `amazon_music` | Amazon Music | lufs_i=-14, tp_dbtp=-2 |
| `tidal` | Tidal | lufs_i=-14, tp_dbtp=-1 |
| `deezer` | Deezer | lufs_i=-15, tp_dbtp=-1 |
| `soundcloud` | SoundCloud | lufs_i=-14, tp_dbtp=-1 |
| `netflix` | Netflix | lufs_i=-27 dialog-anchor, tp_dbtp=-2 |
| `youtube` | YouTube | lufs_i=-14, tp_dbtp=-1 |
| `tiktok` | TikTok | lufs_i=-14 (provisional), tp_dbtp=-1 |
| `youtube_shorts` | YouTube Shorts | lufs_i=-14 (provisional), tp_dbtp=-1 |
| `instagram_reels` | Instagram + Reels | lufs_i=-14 (provisional), tp_dbtp=-1 |

Mark TikTok / Reels / Shorts entries `provisional=True` because their
targets aren't formally published.

Expose:
- `SPECS: dict[str, Spec]` — keyed by `id`
- `def to_json() -> dict` — serialisable form for IPC consumption
- `def get(id: str) -> Spec | None`
- A constant `SPECS_VERSION` — bump whenever any target changes; this
  is the version the renderer compares for stale-spec detection.

### B. Renderer side: consume the registry

`src/dspProfiles.ts` currently has hand-coded targets. Replace those
literals with values read from a build-time-generated `src/specs.ts`
that mirrors the Python registry.

To keep the renderer offline-pure, generate `src/specs.ts` from
`python/specs.py` at build time:
- Add a tiny script `scripts/generate_specs.py` that imports
  `python/specs.py`, calls `to_json()`, and writes
  `src/specs.ts` as a TypeScript constant.
- Wire it into `package.json` so `npm run build` runs it before
  `tsc + vite`. Example: `"build": "python3 scripts/generate_specs.py && tsc -p tsconfig.electron.json && vite build"`.

### C. Emit `spec_versions` on every analysis result

In `python/analyze.py`'s `run()` function, just before returning the
result dict, attach:

```python
from specs import to_json as _specs_to_json, SPECS_VERSION
result["spec_versions"] = {
    "version": SPECS_VERSION,
    "evaluated_at": datetime.now(timezone.utc).isoformat(),
    "specs": _specs_to_json(),
}
```

Do this in `comparator.py` and `batch_analyze.py` too. Wherever the
analyser is the entrypoint, it stamps the analysis with the spec
fingerprint it ran against.

### D. Stale-spec badge in re-loaded reports

When a saved analysis or session is loaded back into the UI, compare
its stamped `spec_versions.version` against the current
`SPECS_VERSION`. If they differ, render a badge near the report
header: `Spec v3 → v5 — re-run analysis to see updated platform
targets`. The badge tooltip lists which specs changed.

Implementation:
- Add `currentSpecsVersion: number` to a new `src/specsCompare.ts`
  helper, derived from the generated `src/specs.ts`.
- New `<SpecDriftBadge analysisVersion={n} />` component, rendered
  inside the report header in `RefOnlyView` and `AnalysisView`.
- The badge clicks through to a small modal listing per-spec deltas
  (renderer reads the analysis's stamped `spec_versions.specs` and
  diffs against the current registry).

### E. Embed `spec_versions` in PDF / HTML report exports

In `src/components/ClientReportButton.tsx`, add a "Standards checked
against" footer block listing each spec's name + version + published
date, sourced from the analysis's `spec_versions`. This is the trust
posture the roadmap calls out: a label downstream can audit "this was
checked against EBU R128 v3.0 published 2014-08-01."

## Acceptance

- `python/specs.py` exists, has the 16 specs above with cited URLs.
- `python3 scripts/generate_specs.py` writes `src/specs.ts` cleanly.
- `npm run build` (don't actually run it — Mac OOMs vite — but make
  sure the `tsc` step alone passes) calls the generator before `tsc`.
- `python/analyze.py` emits `spec_versions` on every result.
- `src/components/ClientReportButton.tsx` includes the "Standards
  checked against" footer.
- `<SpecDriftBadge>` exists, type-safe, integrated into `RefOnlyView`
  and `AnalysisView` headers.
- Both source `python/analyze.py` and the installed copy at
  `/Applications/RTM Suite.app/Contents/Resources/python/analyze.py`
  are patched, plus `python/specs.py` placed in both locations.
- Run on `/tmp/rtm-qa-golden/01_sine1k_m20_stereo.wav` and confirm
  the JSON now has `spec_versions` populated.
- Append a section to
  `release/v4.0-rc2/ship-next-roadmap.md` titled "Stage 2 landed —
  YYYY-MM-DD" listing every file touched, the SPECS_VERSION shipped,
  and any provisional entries that need verification later.

## Constraints

- Don't run `npm run build` or `vite` — this Mac OOMs.
- Don't change the JSON schema in a way that breaks the existing
  renderer (additions are fine; renames / removals are not).
- Don't add new heavy dependencies. Stay in numpy / scipy / librosa /
  pyloudnorm.
- Don't fabricate URLs. If you can't find a public spec for a target
  (TikTok / Reels / Shorts), cite it as "(reverse-engineered;
  verify)" in the registry's `references` list and set
  `provisional=True`.

## Anti-patterns

- Don't read every component file in the source tree — go straight to
  the two files you're changing (`dspProfiles.ts`,
  `ClientReportButton.tsx`) plus the new files you're creating.
- Don't introduce a new corrcoef site without an `np.errstate` wrap.
- Don't break stderr cleanliness on the 10 golden signals.

Take your time. Verify each spec's targets against the cited public
spec before committing the value. If a target is contested (Spotify
Loud, e.g.) document the disagreement in the registry's
`references`.
