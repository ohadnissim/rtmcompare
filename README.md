# RTM Suite

**Mastering-grade A/B compare · Single-file QC · Album batch · Dolby Atmos · Delivery Manifest Reconciler.**

A desktop tool for the entire pre-release audio workflow. Local-first. No cloud round-trip. Built for mastering engineers, label ops, release QC, and immersive mix supervisors.

---

## What's in the Suite

### A/B Compare
Level-matched two-file comparison with mastering-grade measurement: LUFS-I, true peak (dBTP), LRA, per-band masking via Demucs stem separation, phase correlation over time and per band, vectorscope, streaming-normalisation preview across Spotify / Apple / Amazon / Tidal / YouTube, inter-sample-peak meter, AAC encode preview, engineer-profile matching (Serban Ghenea, Chris Lord-Alge, your own), EQ-move export as CSV / FFP / JSON, and apply-and-bounce of a corrected WAV.

### Single-File QC
Deep analysis of a single master. Click and glitch timeline with click-to-transport jump, distortion detection (clipping, ISR, harmonic), mains hum and harmonics, transfer-artefact detection (wow, flutter, DC drift, tape transport, print-through), generation-loss detection of prior AAC or MP3 encoding, key and BPM with harmonic ladder, mono-compat waterfall per band, stereo image and phase bands.

### Album Batch
Drop a folder. Get a sortable overview table with LUFS / TP / LRA / ISRC hygiene and outlier flags. One rotating song tab with `←` `→` keyboard nav. Per-song and album notes embed in every PDF export. Save and load full `.rtmalbum.json` sessions with every analysis, every note, the A/B reference. Lazy deep analysis per song, cached across rotations.

### Cohort Mode
Promote any album track or an external file as the reference. Per-track distance heatmap across 31 bands. Class-wide drift detection. RMS distance column. Sort by drift to see which track strays most.

### Delivery Manifest Reconciler
Drop the CSV or DDEX ERN 4.3 XML the distributor sent alongside the release. DMR three-way-diffs the audio-embedded metadata, the manifest, and the album's internal ISRC set. Catches title-casing drift (Apple cancels delivery on `Feat.` vs `feat.`), ISRC collisions, ISRC reuse from a prior release (cross-session history in `~/.rtm/isrc-history.json`), duration mismatches, missing-from-audio and missing-from-manifest rows, and P-line / C-line mismatches. Exports a Ship-Ready PDF for the delivery ticket and a Corrected CSV the distributor can re-ingest.

### Dolby Atmos
ADM BWF parsing with bed, objects, and trajectories. Binaural TP metering. Downmix QC against the stereo master. Atmos Preflight hard-checks: object count ≤ 118 (Apple cap), LFE routing, bed layout (7.1.2 / 5.1.4), SR = 48 kHz, BD ≥ 24. Per-object anomaly detection — hot, silent, static, or dark objects that usually indicate mix mistakes rather than artistic intent.

### Quality and Engineer Tips
AI-generation detection per stem. Mood, genre, and section classifier for sync pitching. Engineer-target curves with match-score and concrete EQ-move recommendations. Export to FabFilter Pro-Q text, CSV, JSON. Apply-and-bounce a corrected master WAV.

### A/B Player Inside Every Song Tab
Same engine as Compare mode. Pick any other album track, the cohort reference, a starred favourite from past sessions, or upload an external file on the fly. B always tracks the song under view; A is whatever was picked. Live TP meter on the transport. `A` / `B` / `X` / `space` keyboard shortcuts.

### Triage Mode
Optional QC overlay. Ready-to-Deliver verdict, Attention list, per-DSP spec profile (Apple / Spotify / Spotify Loud / Amazon / Tidal / YouTube). Off by default; flip on for release QC.

### Archival Reissue Mode
Drop a folder containing old and new masters. RTM auto-anchors the likely original as the A-side reference across every song tab. Delta loudness / TP / spectrum against the archive, per track.

### Revision Auto-Detect
Scans filenames for `_v2`, `_REV3`, `_FINAL`, `_MIX` suffixes. Pins detected siblings under "↻ Revisions of this track" at the top of the A/B picker. Iterative mastering sessions get instant A-side on the previous pass.

### Console Didone Shell (5.2)
Two-row header: presence row (wordmark, mode chips, `⋯` overflow) and instrument row (LUFS-I, TP, LRA, MONO with eyebrow + Didone numeral + delta). Cover-state empty screen with Didone wordmark and colophon. Per-panel verdict numbers at the top of every analysis tab. Single antique-gold gesture per screen — the active delivery-target chip. Classic shell available as a one-flag fallback (`localStorage['rtm-shell'] = 'v1'`).

---

## System Requirements

- macOS 12 Monterey or later, Apple Silicon native
- ~600 MB disk for the app, bundled Python 3.11, and the Demucs model cache
- No internet after install. Everything runs locally
- Audio formats: WAV, FLAC, AIFF, AIF, MP3, OGG, M4A, ADM BWF

A Windows build ships as a separate artifact. Linux build is experimental.

---

## Quick Start

1. Drag `RTMcompare.app` into `/Applications` from the DMG.
2. First launch shows the cover state — drop two audio files into the unified frame to begin. Or pick an engineer profile, surface (Music / Full / Bcast / Netflix / Post), and use the Reference and Compare slots in the v1 shell.
3. **Compare** for full A/B. **Analyze Reference Only** for single-file QC. **Analyse a folder** for album batch.
4. For albums, drop the distributor CSV onto the Delivery Manifest panel, resolve flagged blockers, hit **Export Ship-Ready PDF** and **Export Corrected CSV**.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / pause the active transport |
| `A` / `B` / `X` | Switch A · Switch B · Flip (ABPlayer) |
| `←` / `→` | Previous / next song (song tab) |
| `1`–`9` | Jump to tab N (Compare view) |
| `M` | Mono listen mode (ABPlayer) |
| `⌘K` / `/` | Command palette · Song quick-switch · Search |
| `⌘E` / `⌘⇧E` | Export EQ FFP · Apply EQ and bounce |
| `?` | Keyboard-shortcut legend |
| `⌘N` | New comparison (when on a results screen) |

---

## Companions

- **RTMprofile** (`rtm-profile-app/`) — feed it 5+ of your finished masters; it learns your sound and saves a fingerprint that loads into RTMcompare's Match tab.
- **RTMsend** (`rtm-send-plugin/`) — VST3 / AU plugin. One-button bridge from Wavelab / Logic / Pro Tools / Studio One into RTMcompare's Single, Compare-B, or Album surfaces. ARA-aware on hosts that support it.

---

## Privacy

Every analysis, render, and metadata read happens on-device. No audio leaves the machine. The only network path the app opens is DSP delivery-status fetching — opt-in, outbound, read-only, tokens stored in the macOS Keychain via `safeStorage`.

---

## Credits

Electron · React · TypeScript · Tailwind v4 · Python 3.11 · NumPy · SciPy · librosa · pyloudnorm · Demucs · JUCE.

Wordmark and hero metrics set in Instrument Serif. Body in Outfit. Tabular data in JetBrains Mono.

RTM Suite 5.2 · 2026
