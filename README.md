# RTMcompare

**Mastering-grade A/B compare · Single-file QC · Album batch · Dolby Atmos · Delivery Manifest Reconciler.**

A desktop tool for the entire pre-release audio workflow. Local-first. No cloud round-trip. Built for mastering engineers, mixing engineers, and producers who need to know exactly what changed and exactly what to do about it.

---

## What's in RTMcompare

### A/B Compare
Level-matched two-file comparison with mastering-grade measurement: LUFS-I, true peak (dBTP), LRA, per-band masking via BS-RoFormer stem separation, phase correlation over time and per band, vectorscope, streaming-normalisation preview across Spotify / Apple / Amazon / Tidal / YouTube, inter-sample-peak meter, AAC encode preview, engineer-profile matching, EQ-move export as CSV / FFP / JSON, and apply-and-bounce of a corrected WAV. EQ recommendations now push live into your DAW via RTMsend.

### Single-File QC
Deep analysis of a single master. Click and glitch timeline with click-to-transport jump, distortion detection (clipping, ISR, harmonic), mains hum and harmonics, transfer-artefact detection (wow, flutter, DC drift, tape transport, print-through), generation-loss detection of prior AAC or MP3 encoding, key and BPM with harmonic ladder, mono-compat waterfall per band, stereo image and phase bands.

### Album Batch
Drop a folder. Get a sortable overview table with LUFS / TP / LRA / ISRC hygiene and outlier flags. One rotating song tab with `←` `→` keyboard nav. Per-song and album notes embed in every PDF export. Save and load full `.rtmalbum.json` sessions with every analysis, every note, the A/B reference. Lazy deep analysis per song, cached across rotations.

### Cohort Mode
Promote any album track or an external file as the reference. Per-track distance heatmap across 31 bands. Class-wide drift detection. RMS distance column. Sort by drift to see which track strays most.

### Delivery Manifest Reconciler
Drop the CSV or DDEX ERN 4.3 XML the distributor sent alongside the release. DMR three-way-diffs the audio-embedded metadata, the manifest, and the album's internal ISRC set. Catches title-casing drift (Apple cancels delivery on `Feat.` vs `feat.`), ISRC collisions, ISRC reuse from a prior release, duration mismatches, missing-from-audio and missing-from-manifest rows, and P-line / C-line mismatches. Exports a Ship-Ready PDF and a Corrected CSV.

### Dolby Atmos
ADM BWF parsing with bed, objects, and trajectories. Binaural TP metering. Downmix QC against the stereo master. Atmos Preflight hard-checks: object count ≤ 118, LFE routing, bed layout, SR = 48 kHz, BD ≥ 24. Per-object anomaly detection — hot, silent, static, or dark objects.

### Quality and Engineer Tips
Engineer-target curves with match-score and concrete EQ-move recommendations driven by Hann-smoothed spectra. Tip text and chip values agree: "X dB hot — consider a Y dB cut" where Y is exactly half of X. Loudness tip fires when your master is off-target vs the cohort. Export to CSV / FFP / JSON or apply-and-bounce a corrected master WAV.

### Breakdown Tab
Per-Element Breakdown leads: KICK / SNARE / SUB / BASS / VOCALS / INSTRUMENTS / BRIGHTNESS level-matched cards, all 7 visible by default, powered by BS-RoFormer 4-stem (SDR 9.66 on MUSDB18HQ). Masking Overlap, Transient Density & Structure, and Tonal Issues follow — no toggle gate, they surface whenever data is present.

### A/B Player Inside Every Song Tab
Same engine as Compare mode. B always tracks the song under view; A is whatever was picked — another album track, the cohort reference, a starred favourite, or an external file. Live TP meter on the transport. `A` / `B` / `X` / `Space` keyboard shortcuts.

### Triage Mode
Optional QC overlay. Ready-to-Deliver verdict, Attention list, per-DSP spec profile (Apple / Spotify / Spotify Loud / Amazon / Tidal / YouTube). Off by default; flip on for release QC.

### Archival Reissue Mode
Drop a folder containing old and new masters. RTMcompare auto-anchors the likely original as the A-side reference across every song tab. Delta loudness / TP / spectrum against the archive, per track.

### Revision Auto-Detect
Scans filenames for `_v2`, `_REV3`, `_FINAL`, `_MIX` suffixes. Pins detected siblings under "↻ Revisions of this track" at the top of the A/B picker.

### Console Didone Shell (5.2)
Two-row header: presence row (wordmark, mode chips, `⋯` overflow) and instrument row (LUFS-I, TP, LRA, MONO). Cover-state empty screen with engineer-profile dropdown — pick your reference before the analysis starts. Per-panel verdict numbers at the top of every tab. Single antique-gold gesture per screen. Classic shell available as a one-flag fallback (`localStorage['rtm-shell'] = 'v1'`).

---

## System Requirements

- macOS 12 Monterey or later, Apple Silicon native
- ~600 MB disk for the app, bundled Python 3.11, and the model cache
- No internet after install. Everything runs locally
- Audio formats: WAV, FLAC, AIFF, AIF, MP3, OGG, M4A, ADM BWF

A Windows build ships as a separate artifact. Linux build is experimental.

---

## Quick Start

1. Drag `RTMcompare.app` into `/Applications` from the DMG.
2. First launch shows the cover state — pick an engineer profile, then drop two audio files to begin.
3. **Compare** for full A/B. **Analyze Reference Only** for single-file QC. **Analyse a folder** for album batch.
4. For albums, drop the distributor CSV onto the Delivery Manifest panel, resolve flagged blockers, hit **Export Ship-Ready PDF** and **Export Corrected CSV**.
5. To push EQ recommendations into your DAW, load RTMsend in your host, pick an EQ in its slot, then click **Send to Plugin** in RTMcompare.

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
- **RTMsend** (`rtm-send-plugin/`) — VST3 / AU host plugin. Hosts any third-party EQ and lets RTMcompare write recommended moves directly into the live plugin. 16 profiles ship out of the box; unlisted plugins auto-detect. ARA-aware on Studio One, Cubase/Nuendo, Reaper, Bitwig.

---

## Privacy

Every analysis, render, and metadata read happens on-device. No audio leaves the machine. The only network path the app opens is DSP delivery-status fetching — opt-in, outbound, read-only, tokens stored in the macOS Keychain via `safeStorage`.

---

## Credits

Electron · React · TypeScript · Tailwind v4 · Python 3.11 · NumPy · SciPy · librosa · pyloudnorm · BS-RoFormer · JUCE.

Wordmark and hero metrics set in Instrument Serif. Body in Outfit. Tabular data in JetBrains Mono.

RTMcompare 5.7.0 · 2026
