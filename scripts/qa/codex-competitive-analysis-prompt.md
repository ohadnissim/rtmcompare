# Codex prompt — RTM Suite competitive-positioning analysis

Do a thorough competitive-positioning analysis for **RTM Suite v4.0**
(Electron + React + Python audio QC + mastering suite). Output a
strategic memo at `release/v4.0-rc2/competitive-analysis.md`.

This is research, not a code change. Use the web. Cite sources inline.

## RTM's actual feature surface (don't underweight any of this)

Source-tree-verified, not marketing copy. If you doubt any claim,
`grep` the source under `/Users/ohadnissim/Compare App` to confirm.

### Single-file QC (RefOnly path)
- LUFS-I / LUFS-S / LUFS-M / LRA / True Peak / sample peak / clip count / dynamic range
- 31-band 1/3-octave spectrum (mid + side decomposition)
- Stereo correlation + width, broadband + per-band (Sub / Bass / Low Mid / Mid / Upper / Air)
- Mono-compat per-band risk with **phase-cancellation vs decorrelation distinction** (not raw correlation; the formula is `phase_penalty = max(0, -corr - 0.05)`)
- BPM + key detection
- Click / digital-glitch detection with timeline
- Distortion: clipping, inter-sample TP, over-limiting, harmonic
- Hum (50/60 Hz) detection
- Limiter-artefact (ringing) detection
- Masking analysis (frequency overlap)
- Transient-density timeline with section labelling ("verse / pre-chorus")
- Tonal-issue flagging (mud, harshness, sibilance)
- AI-generated-music detection (v4.1: 9 reliability-weighted probes, HPSS coherence, comb-periodicity, vocal-activity-gated VAD path, isotonic calibration loader, confidence band)
- Codec generation-loss detector (`python/generation_loss_detector.py`)
- Engineer-curve target match (31-band, A-weighted-mean aligned)
- File-format sanity: SR / BD / channels / ISRC / BWF (BEXT / iXML / INFO chunk reader + writer)
- Streaming-normalisation preview for **14 platforms**: Apple Music · Spotify · Spotify Loud · Amazon Music · Tidal · Deezer · SoundCloud · EBU R128 · ATSC A/85 (CALM Act) · Netflix · YouTube · TikTok · YouTube Shorts · Instagram + Reels
- "Ready to Deliver" HOLD logic per platform (fail-fast on TP-over, LRA-out-of-spec, etc.)
- Engineer Tips panel (LLM-generated copy keyed off measurements)
- PDF + HTML report export

### Two-file compare (Compare path)
- Level-matched A/B
- 6 tabs: Overview / Delivery / Stereo & Spectrum / EQ Match / Breakdown / Quality
- A/B player with stereo + Mid + Side + Mono + channel-isolation switching, drag-to-loop, keyboard scrub
- Reference-Match parametric EQ proposer (4–8 bands) with audition through built-in biquad bank
- Side-by-side spectrum overlay, A-weighted-mean aligned

### Album / batch
- Folder of files → per-track analysis, cross-track gap/coherence checks
- Saves session JSON, re-loadable

### Atmos / immersive
- ADM BWF parser
- Atmos QC: object trajectories, channel energy, surround-field viz, downmix delta, preflight checks
- 5.1 / 7.1.4 metadata sanity

### Label / delivery side
- Delivery-Manifest Reconciler — match audio files to label-supplied CSV (ISRC / title / artist / duration), flag mismatches
- ISRC history + dedup
- Releases store + audit log
- BWF metadata write-back (in-place, atomic)
- Reference-Library (saved 31-band fingerprints with auto-tagging)

### DAW integration
- "Send to RTM" plugin (separate JUCE-built AU/VST3/AAX) drops bounces into `~/.rtm/incoming/` with sidecar metadata; main app picks them up via fs-watch and routes to single-file / Compare / batch based on plugin's `route` hint.

### UX
- Modes: Music · Full · Broadcast · Netflix · Post (panel filters)
- Engineer Profiles (bundled + custom-loader)
- Learn mode — "why this matters" per panel
- Reference Library — saved + recent references with starring
- Onboarding tours (Upload, Analysis, RefOnly, Batch)
- Cmd+K command palette
- HOLD/CLEAN delivery verdict
- Light + dark themes
- All offline (no cloud round-trip)

## Three deliverables in one memo

### 1. Competitive matrix
Build a feature × competitor matrix. Cover at minimum:
- iZotope **Ozone 11** + **Insight 2** + **RX 11**
- Mastering The Mix **Reference 4** + **Levels 2** + **Bassroom 2**
- NUGEN Audio **MasterCheck Pro**
- Sonible **smart:limit** + **smart:EQ 4** + **true:level**
- **Youlean Loudness Meter Pro**
- Sonarworks **SoundID Reference**
- FabFilter **Pro-Q 4** + **Pro-L 2** + **Pro-MB**
- MeldaProduction **MAutoEqualizer / MUtility**
- **LANDR / eMastered / MasterChannel / CloudBounce** (online auto-mastering)
- **Auphonic** (broadcast / podcast)
- Steinberg **Wavelab Pro 12** (mastering DAW with QC)
- NUGEN **Halo Upmix** + **VisLM** (broadcast loudness)
- Anything else relevant you find during research

For each, build the matrix. Rows = features RTM has + features it lacks. Cells: ✓ / ✗ / ◐ (partial) / $ (paid add-on). Cite the source for non-trivial claims.

### 2. Pain points in the field
Hunt actively. Don't list generic things — find specific complaints from working engineers in:
- Reddit r/AudioPost, r/audioengineering, r/WeAreTheMusicMakers, r/edmproduction (genre-specific mastering chat)
- Gearspace forums (Mastering, Production Advice)
- KVR Audio forum + reviews
- Sound on Sound, Tape Op, Resolution magazine reviews
- Mastering podcast transcripts if findable
- Recent NAMM / AES / Music Tech Trade announcements

For each pain point:
- The complaint (engineer voice, not marketing voice)
- Which competitors fail to solve it
- Whether RTM solves it today (file:line evidence if it does)
- Whether RTM should solve it (judgement call + reasoning)

### 3. Strategic positioning + verdict
- Where RTM **objectively wins** today (only genuine best-in-class wins, with evidence)
- Where RTM **almost wins but for one missing piece** (and what that piece is)
- Where RTM **legitimately loses to a specialist** (and whether that's worth fighting)
- Three things RTM should ship next to consolidate the win
- Three things RTM should NOT bother building (specialist is too good)
- One **honest bottom-line answer** to: "is RTM the most fully-featured app of this kind?" — yes / no / "depends on how you define the category, here's why"

## Constraints

- Use the web. Cite inline (URL + section anchor where possible).
- Don't fabricate. Mark unverifiable claims `(unverified)`.
- Don't mark RTM ✓ on something it doesn't actually have — `grep` the source if unsure (paths: `python/`, `src/components/`, `electron/`).
- 1500–3000 lines of structured markdown is fine; longer is fine if the matrix needs it.
- Don't change any source code.

## Anti-patterns

- Don't write "everyone says X" without a citation — find the specific thread / post / review.
- Don't list "AI mastering" as a single feature — three categories: auto-master (LANDR), reference-match (Ozone Master Match), and AI-detection (RTM, ircam-amplify).
- Don't accept marketing-speak from competitor sites without checking whether the feature does what the page implies.
- Don't conclude "RTM is the most fully-featured" if the analysis shows otherwise. Honest > flattering.

Read your previous AI-detector work in the same folder
(`release/v4.0-rc2/qa-codex-ai-detector-review.md`) for context on
RTM's voice and depth. Then research. Then write.
