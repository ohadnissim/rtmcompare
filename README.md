# RTM Suite

**Mastering-grade A/B compare · Single-file QC · Album batch · Dolby Atmos · Label Delivery Manifest Reconciler.**

One desktop app for the entire pre-release audio workflow. Local-first. No cloud round-trip. Built for mastering engineers, label ops, release QC, and immersive mix supervisors.

---

## What's in the Suite

### A/B Compare
Level-matched two-file comparison with mastering-grade measurement: LUFS-I / TP / LRA, per-band masking (AI stem separation via Demucs), phase correlation over time + per-band phase, vectorscope, streaming-normalisation preview across Spotify / Apple / Amazon / Tidal / YouTube, inter-sample-peak meter, AAC encode preview, engineer-profile matching (Serban Ghenea / Chris Lord-Alge / your own), EQ-move export as CSV / FFP / JSON, apply-and-bounce corrected WAV.

### Single-File QC
Deep analysis of a single master — clicks & glitches timeline with click-to-transport jump, distortion detection (clipping / ISR / harmonic), mains-hum + harmonics, transfer-artefact detector (wow / flutter / DC drift / tape transport / print-through), generation-loss detector (prior AAC / MP3 encoding), key / BPM / harmonic ladder, mono-compat waterfall per frequency band, stereo image + phase bands.

### Album Batch
Drop a folder → sortable overview table with LUFS / TP / LRA / ISRC hygiene + outlier flags. One rotating song tab with ← / → keyboard nav. Per-song + album notes embedded in every PDF export. Save / load full `.rtmalbum.json` sessions with every analysis, every note, the A/B reference you picked. Lazy deep analysis per song (cached across tab rotations).

### Cohort Mode
Promote any album track or an external file as the reference. Per-track distance heatmap across 31 bands. Class-wide drift detection. RMS distance column. Sort by drift to see which track strays most.

### Delivery Manifest Reconciler (DMR)
The feature labels have been waiting for. Drop the CSV / DDEX ERN 4.3 XML your distributor sent alongside the release and DMR three-way-diffs: audio-embedded metadata ↔ manifest ↔ batch-internal ISRC collision set. Catches **title casing drift** (Apple auto-cancels on `"Feat." vs "feat."`), ISRC collisions across the album, ISRC reuse from a prior release (cross-session history in `~/.rtm/isrc-history.json`), duration mismatches, missing-from-audio / missing-from-manifest, P-line / C-line mismatches. Exports a **Ship-Ready PDF** for the delivery ticket and a **Corrected CSV** the distributor can re-ingest.

### Dolby Atmos
ADM BWF parsing with bed / objects / trajectories. Binaural TP metering. Downmix QC vs stereo master. **Atmos Preflight** — hard-checks: object count ≤ 118 (Apple cap), LFE routing, bed layout (7.1.2 / 5.1.4), SR = 48 kHz, BD ≥ 24. **Per-object anomaly detection** — hot / silent / static / dark objects that usually indicate mix mistakes, not artistic intent.

### Quality & Engineer Tips
AI-generation detection per stem. Mood / genre / section classifier for sync pitching. Engineer-target curves with match-score + concrete EQ-move recommendations. Export to FabFilter Pro-Q text / CSV / JSON, or apply-and-bounce a corrected master WAV.

### A/B player inside the song tab
Same engine as Compare mode. Pick any other album track, the cohort reference, a favorite from past sessions, or upload an external file on-the-fly — B always tracks the song you're viewing, A is what you picked. Live TP meter on the transport. `A` / `B` / `X` / `space` keyboard shortcuts.

### Triage Mode
Optional QC overlay — Ready-to-Deliver verdict + Attention list + per-DSP spec profile (Apple / Spotify / Spotify Loud / Amazon / Tidal / YouTube). Off by default for engineer workflow; flip on for release-QC.

### Archival Reissue Mode
Drop a folder containing old + new masters and RTM auto-anchors the likely "original" as the A-side reference across every song tab. Delta loudness / TP / spectrum against the archived master, per track.

### Revision Auto-Detect
Scans filenames for `_v2` / `_REV3` / `_FINAL` / `_MIX` suffixes and pins detected siblings under "↻ Revisions of this track" at the top of the A/B picker. Iterative mastering sessions get instant A-side on the previous pass.

---

## System Requirements

- **macOS 12 Monterey or later** (Apple Silicon native).
- **~600 MB** disk space for the app + bundled Python 3.11 + Demucs model cache.
- **Internet not required** after install. Everything runs locally.
- **Audio formats**: WAV, FLAC, AIFF / AIF, MP3, OGG, M4A, ADM BWF.

A Windows build exists as a separate artifact. Linux build is experimental.

---

## Quick Start

1. **Install** — drag `RTM Suite.app` into `/Applications` from the DMG.
2. **First launch** — welcome modal + 8-step tour walks through every surface. Dismiss with Skip Tour at any point; relaunch via the "Tour" button in the header.
3. **Drop files** — left slot = reference, right slot = target. Works with drag-drop or the file picker.
4. **Pick a scan mode** — Fast (full measurement set in under a minute) or Deep Scan (adds AI stem separation for masking + AI-gen detection).
5. **Choose an engineer profile** — Serban Ghenea, Chris Lord-Alge, etc., or bring your own JSON.
6. **Analyze Reference Only** for single-file QC, **Compare** for full A/B, or **Analyse an album** for batch mode.

For albums: drop the folder, drop your distributor's CSV on the **Delivery Manifest** panel, resolve flagged blockers, hit **Export Ship-Ready PDF** + **Export Corrected CSV** → attach to the delivery ticket.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / pause the active transport |
| `A` / `B` / `X` | Switch A / B / flip (inside ABPlayer) |
| `←` / `→` | Previous / next song (inside a song tab) |
| `1`–`9` | Jump to tab N (Compare view) |
| `M` | Mono listen mode (ABPlayer) |
| `?` | Keyboard-shortcut legend |

---

## Privacy

Every analysis, every render, every metadata read happens on-device. No audio leaves your machine. The only network path the app ever opens is DSP delivery-status fetching (opt-in, outbound, read-only, tokens stored in macOS Keychain via `safeStorage`).

---

## What's New in 4.0

- **Delivery Manifest Reconciler** — CSV + DDEX ERN 4.3 + ISRC history. Ship-Ready PDF + Corrected CSV exports.
- **A/B player in every song tab** — same engine as Compare mode, B tracks the active song, A locks across rotations.
- **Reference favourites** — star references to persist across sessions. Upload external files on-the-fly.
- **Revision auto-detect** — `_v2` / `_REV3` siblings pinned at the top of the A/B dropdown.
- **Live TP meter** — instantaneous + 2-second peak-hold on the ABPlayer transport.
- **Triage Mode** + **DSP spec profiles** — optional QC overlay with per-platform rule checking.
- **Atmos Preflight** — hard-check panel + per-object anomaly detector.
- **Archival Reissue mode** — old-master vs new-master workflow with auto-anchor.
- **Loudness over time + section overlays** — per-section LUFS averages with transient-density boundaries.
- **Per-band mono-compat waterfall** — see *where* the mono fold collapses, not just a scalar.
- **Click solo (F)** — band-isolated playback complements the existing residual-subtraction click-only mode.
- **Cohort Mode explainer** — three-bullet guide to what the heatmap means.
- **Album notes + per-song notes** — embedded in every PDF export.
- **Save / Load album sessions** — `.rtmalbum.json` round-trip with results, notes, A/B favourites, cohort ref, DMR state.
- **Python modules scaffolded** — encoded-AAC preview, transfer-artefact detector, generation-loss detector, binaural render.

---

## Credits

Built on Electron, React, TypeScript, Tailwind, Python 3.11, NumPy, SciPy, librosa, pyloudnorm, Demucs.

RTM Suite 4.0 · 2026
