# Codex consult — Ableton `.adv`, Logic `.aupreset`, Wavelab native preset format research

We just shipped a real binary `.ffp` writer for FabFilter Pro-Q 3/4
based on your earlier research. Now we need the same depth for the
**other three EQ-export formats** — Ableton EQ Eight, Logic Channel
EQ, Wavelab — because today none of them are bench-tested and a beta
tester just called the JSON one out as misleading.

Honest verdict per format would be ideal: "ship as-is", "fix this
specific thing", or "drop the menu item — there's no clean path".

## What we have right now

`src/eqExporters.ts` ships these builders:

- `buildAbletonEqEightXml(bands, amount)` → XML serialized via
  `gzipString` → `.adv` (was `.adg` until 5.0.5; we just renamed it).
  Root element changed from `<GroupDevicePreset>` to
  `<DevicePreset>`. Per-band XML hand-rolled.
- `buildLogicChannelEqAupreset(bands, amount, presetName)` → string
  output. Logic AU presets are normally **binary plist**; this one
  appears to emit XML / text. Needs a hard look.
- `buildWavelabSparkleEqXml(bands, title)` → XML fragment named
  `.spkl.xml`. Wavelab modern uses `.vstpreset` (binary). The
  whole format premise may be wrong.

Source: read each builder end-to-end before answering.

## What we need from you

For EACH of the 3 formats, three answers:

### 1. What does the host app **actually** load?

- Ableton Live 12 EQ Eight: confirmed `.adv` (Device Preset). What's
  the canonical XML schema? Live writes presets as **gzipped XML with
  `<Ableton MajorVersion="..." ...><DevicePreset>...`** — what's the
  exact structure inside `<DevicePreset>` for an EQ Eight device in
  Live 11 / 12 specifically? Per-band element name? Filter type
  codes? Frequency / Q / gain encoding (linear, log, normalised)?
- Logic Pro 11 Channel EQ: `.aupreset` is a **binary plist** keyed
  by `manufacturer` / `subtype` / `type` / `name` / `data` (the
  blob is parameter values). What are the exact keys and parameter
  IDs Channel EQ expects? Where can we get a known-good Channel EQ
  `.aupreset` to hex-diff against ours?
- Wavelab 12: native preset format? `.vstpreset` (Steinberg-standard
  VST3 preset)? Or does Wavelab have its own `.preset` flavour for
  the SparkleEQ specifically? Different per Wavelab version (Elements
  / Pro / Cast)?

### 2. Reference implementations / fixtures

For each, find:
- Open-source projects that write these formats. License, last
  commit date, repo URL. We can vendor MIT/Apache work; can't touch
  GPL / proprietary.
- Public sample fixtures we can download. URL, file size. Plan to
  hex-dump and diff against our output.
- Any reverse-engineering blog posts, audio forums (KVR, gearspace),
  or DAW-specific docs that pin down the schema.

### 3. Verdict per format

Pick ONE for each:

- **Ship as-is** (current builder is correct or close enough for
  beta) — call out any small fix.
- **Fix specifically** (point to file:line in `src/eqExporters.ts`
  with the change). If the fix is sketch-able in TS, sketch it.
- **Drop the menu item** (no clean path to a host-loadable preset;
  the menu item is misleading and should go). Recommend a fallback
  (e.g. CSV-only for Wavelab if `.vstpreset` is too risky).

For Logic specifically: if writing the binary plist is too risky
without a known-good fixture to diff against, recommend instead a
**Logic** import path that takes a different format
(e.g. text-based, or via a Pro-Q text intermediary).

## Output format

Three sections, in this order:

### ABLETON EQ EIGHT `.adv`
- Verdict (ship / fix / drop)
- Schema details Live 12 expects + cite source
- File:line of the fix(es) in `src/eqExporters.ts`
- TS pseudo-code for any non-trivial change

### LOGIC CHANNEL EQ `.aupreset`
- Verdict
- Binary plist key/value spec + cite source
- Sample fixture URLs to hex-diff
- Implementation plan or "drop this menu item, here's why"

### WAVELAB
- Verdict on `.vstpreset` vs current `.spkl.xml`
- If `.vstpreset`: format details + sample fixtures
- If drop: which other formats Wavelab loads that we already export

## Constraints

- Be specific. file:line, repo URL, blog post URL, forum thread URL.
- Date every claim — DAW preset formats evolve (Live 11 ≠ Live 12;
  Logic 10 ≠ Logic 11).
- You may run shell commands. Use them — fetch a sample, hex-diff it,
  run `gunzip` on a `.adv`, dump the plist, etc.
- Honest > flattering. If a format is genuinely too undocumented to
  ship reliably, recommend dropping the menu item.
- Under ~2000 words.
