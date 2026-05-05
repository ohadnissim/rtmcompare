# Codex consult — reverse-engineer FabFilter Pro-Q `.ffp` binary preset

We need to **write** real FabFilter Pro-Q preset files (`.ffp`,
binary) so users can load RTMcompare's match-EQ output natively in
Pro-Q 3 / Pro-Q 4. Today we ship a JSON file labelled "preset" that
Pro-Q can't read — beta tester just called this out as misleading.

FabFilter does not publish the `.ffp` spec. We need to reverse-engineer
from public sources or tested fixtures. Goal: ship a `.ffp` writer
in the next RTMcompare build.

## What we have to work with

- `src/eqExporters.ts` already has a working **text** exporter for
  Pro-Q (paste-into-Import-Text flow). It encodes per-band {freq,
  gain_db, q, type} for up to 24 bands. This is the reference for
  the band data we want to write.
- Bands we need to encode: `freq` (Hz), `gain_db`, `q`, `type` (peak,
  low-shelf, high-shelf, low-pass, high-pass, notch, band-pass).
  Pro-Q 4 added vintage / dynamic / brickwall types; Pro-Q 3
  ignores anything past its supported set.

## Research questions for you

1. **What is the `.ffp` file structure?** Header, magic bytes, version
   field, band count, per-band record layout (struct). Cite GitHub
   repos, mailing-list posts, blog reverse-engineering writeups,
   open-source converters by name + URL.

2. **Are Pro-Q 3 and Pro-Q 4 `.ffp` files cross-compatible?** If yes,
   target the Pro-Q 3 schema and Pro-Q 4 will read it. If no, document
   the version field and pick the right one to write.

3. **Sample fixtures.** Find any public `.ffp` files we can hex-dump
   and diff against ours: GitHub gists, audio forum threads, sample
   pack downloads. List their URLs. (We'd download one or two,
   xxd them, diff against our output to verify byte-level
   correctness.)

4. **Do any open-source projects already write `.ffp`?** If yes —
   library name, license, can we vendor or reuse the encoder?
   Specifically check for: `pyffp`, `node-ffp`, audio-tools converters,
   the Ardour project, Reaper presets, REAPER JSFX.

5. **Edge cases.** What does Pro-Q do with:
   - bands beyond its 24-band cap → silently dropped or rejected?
   - unrecognised filter types → coerced to peak or rejected?
   - frequency / Q / gain values past the UI limits?

6. **Plan B if `.ffp` proves too hostile.** Is there an XML / clipboard
   format Pro-Q accepts as a fallback that we can ship cleaner than
   the current text? (Pro-Q's right-click → Copy / Paste populates
   a clipboard string — what's its actual schema?)

## Output format

### `.FFP` BYTE LAYOUT
ASCII sketch of the file structure with offsets, field names, types,
endianness. Cite source(s) for each segment.

### IMPLEMENTATION PLAN
Pseudo-code (Python or TypeScript) for the writer. We're going to
implement it in `src/eqExporters.ts` (TypeScript) since EQ export is
renderer-side. Bytes go through `Uint8Array` / `DataView`. If a
Python implementation already exists, link it; we'll port to TS.

### TESTING STRATEGY
How to confirm the resulting `.ffp` actually loads in Pro-Q 4
without us having Pro-Q installed for automated tests. Manual tester
checklist + hex-diff steps.

### FALLBACK
If `.ffp` reverse-engineering looks too risky to ship in a week,
the cheaper alternatives we should ship instead.

## Constraints

- Be specific. Cite repos by URL. Cite forum threads by URL. Date
  every claim — the format has evolved across Pro-Q 2 / 3 / 4.
- You may run shell commands (sandbox `danger-full-access`). Use them
  to fetch any public `.ffp` you can find and run `xxd` / `od` on it.
- Honest > flattering. If the format is genuinely undocumented and
  no open-source writer exists, say so and recommend the fallback.
- Under ~1500 words.
