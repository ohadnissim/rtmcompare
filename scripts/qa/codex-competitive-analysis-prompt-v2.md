You are doing a competitive-positioning analysis for RTM Suite v4.0.

**HARD CONSTRAINT: DO NOT read any source files.** The feature list below
is ground truth. Don't grep, don't open .tsx / .py / .ts files, don't
audit anything. The previous run hit context overflow doing source
verification when it shouldn't have. Trust the list. Go straight to web
research and writing.

If you find yourself wanting to verify a feature: don't. Just mark it
✓ in the matrix and move on. Save your context budget for web research
and writing the memo.

## Output

Single file: `release/v4.0-rc2/competitive-analysis.md`. 1500–2500 lines.

## RTM Suite v4.0 — feature ground truth (treat as given)

**Single-file QC:** LUFS-I/S/M, LRA, True Peak, sample peak, clip count,
dynamic range, 31-band 1/3-octave spectrum (mid+side), stereo
correlation/width broadband + per-band, mono-compat per-band risk
(phase-cancellation vs decorrelation distinguished), BPM, key, click /
glitch detection with timeline, distortion (clipping + ISP + over-limiting +
harmonic), 50/60Hz hum detection, limiter-artefact ringing detection,
masking analysis, transient density timeline with section labels, tonal
issue flagging, AI-music detection (9 reliability-weighted probes,
calibration-aware), codec generation-loss detector, engineer-curve target
match (A-weighted-mean aligned), file-format sanity (SR/BD/channels/ISRC/
BWF BEXT+iXML+INFO read+write), streaming normalisation preview for 14
platforms (Apple Music, Spotify, Spotify Loud, Amazon Music, Tidal, Deezer,
SoundCloud, EBU R128, ATSC A/85, Netflix, YouTube, TikTok, YouTube Shorts,
Instagram/Reels), Ready-to-Deliver HOLD logic per platform, Engineer Tips
panel, PDF + HTML export.

**Two-file compare:** level-matched A/B, 6 tabs (Overview/Delivery/
Stereo&Spectrum/EQ Match/Breakdown/Quality), A/B player with stereo+M+S+
Mono+channel-isolation, drag-to-loop, keyboard scrub, parametric EQ
proposer (4-8 bands) with live audition, side-by-side spectrum overlay.

**Album/batch:** folder analyse, cross-track checks, session JSON, Cohort
Mode (anonymous compare).

**Atmos/immersive:** ADM BWF parser, object trajectories, channel energy,
surround-field viz, downmix delta, preflight checks, 5.1/7.1.4 metadata.

**Label-side:** Delivery-Manifest Reconciler (audio↔CSV match by ISRC/
title/artist/duration), ISRC history+dedup, Releases store + audit log,
BWF metadata write-back atomic, Reference Library (saved 31-band
fingerprints with auto-tagging).

**DAW integration:** Send-to-RTM JUCE plugin (AU/VST3/AAX) drops bounces
into ~/.rtm/incoming/, main app picks them up via fs-watch with route hint.

**UX:** Modes (Music/Full/Broadcast/Netflix/Post), Engineer Profiles
(bundled+custom), Learn mode, Reference Library, Onboarding tours, Cmd+K
palette, HOLD/CLEAN verdict, Light+dark themes, fully offline.

## Your three deliverables in the memo

### 1. Competitive matrix
Compare RTM against:
- iZotope **Ozone 11**, **Insight 2**, **RX 11**
- Mastering The Mix **Reference 4**, **Levels 2**, **Bassroom 2**
- NUGEN Audio **MasterCheck Pro**
- Sonible **smart:limit**, **smart:EQ 4**, **true:level**
- **Youlean Loudness Meter Pro**
- Sonarworks **SoundID Reference**
- FabFilter **Pro-Q 4**, **Pro-L 2**
- **LANDR**, **eMastered**, **MasterChannel**
- **Auphonic**
- Steinberg **Wavelab Pro 12**

Rows = features. Cells = ✓ / ✗ / ◐ (partial) / $ (paid add-on).
Cite source URLs for non-trivial competitor claims. Don't verify RTM
column — trust the list. Brief 1-line note per cell where useful.

### 2. Pain points engineers actually have
Hunt: Reddit r/audioengineering, r/AudioPost, r/WeAreTheMusicMakers; Gearspace
forums (Mastering, Production Advice); KVR; Sound on Sound reviews; Tape
Op; mastering podcasts; recent NAMM/AES announcements.

For each pain point you find with citation:
- Complaint (engineer voice, not marketing voice)
- Which competitors fail it
- Whether RTM solves it (yes/no/partial)
- Whether RTM should solve it (judgement)

### 3. Verdict + strategy
- Where RTM **objectively wins** today (only genuine best-in-class wins)
- Where RTM **almost wins but for one missing piece**
- Where RTM **legitimately loses** to a specialist (and is it worth fighting)
- 3 things RTM should ship next
- 3 things RTM should NOT bother building
- Bottom-line: "is RTM the most fully-featured app of this kind?" — yes/no/depends-with-reasoning

## Anti-patterns

- DO NOT read RTM source. Trust the list.
- DO NOT mark RTM ✓ on something not in the list.
- Don't fabricate competitor features. Cite sources.
- Don't write "everyone says X" without a citation.
- Honest > flattering: if RTM isn't the most fully-featured, say so.

Go.
