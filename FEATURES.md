# RTMcompare — Features

A surface-by-surface reference. Read alongside `README.md`.

---

## A/B Compare

The flagship surface. Two files in. Every difference between them out.

- **Level-matched playback** — both files normalised to −18 LUFS integrated before comparison so a louder master can't fake "better."
- **LUFS-I, true peak (dBTP), LRA, MONO** — the four delivery numbers, surfaced in the instrument row at the top of every screen.
- **Per-band masking** — BS-RoFormer AI stem separation reveals where vocals, drums, bass, and other are losing energy. Per-band, not just whole-mix.
- **Phase correlation over time** — full-track plot plus per-band phase ribbon. Catches phase issues that scalar correlation hides.
- **Vectorscope** — XY mid/side scope with peak-hold. Read width and centre-energy at a glance.
- **Streaming-normalisation preview** — Spotify, Apple, Amazon, Tidal, YouTube. See exactly how each platform will play your master.
- **Inter-sample peak meter** — 4× oversampled true-peak detection (BS.1770-4). The Apply-and-bounce limiter steps internally to 16× polyphase Kaiser for sub-0.05 dB ceiling accuracy on the rendered master.
- **AAC encode preview** — render through Apple's AAC encoder, A/B against the source.
- **Engineer-profile matching** — Serban Ghenea, Chris Lord-Alge, your own (built with RTMprofile). Match-score plus concrete EQ-move recommendations, now driven by 3-band Hann-smoothed spectra so a tuned-kick fundamental at 50 Hz doesn't read as a broad-band imbalance.
- **EQ-move export** — FabFilter Pro-Q text, CSV, JSON. Or apply-and-bounce a corrected master WAV in one click.
- **Send to Plugin** — push EQ recommendations live into a hosted plugin in your DAW via RTMsend. Adjust the Amount fader to dial in how hard you apply the move.

## Single-File QC

Drop one file. Get a deep clinical pass.

- **Click and glitch timeline** — peaks plotted with click-to-transport jump. Audition every defect in seconds.
- **Distortion detection** — clipping, ISR, harmonic. Severity rating. Frequency where it sits.
- **Mains hum and harmonics** — 50 / 60 Hz fundamental plus 3rd / 5th / 7th. Catches grounding issues.
- **Transfer-artefact detection** — wow, flutter, DC drift, tape transport, print-through. For analog-source masters.
- **Generation-loss detection** — prior AAC or MP3 encoding history. Surfaces lossy ancestors.
- **Key, BPM, harmonic ladder** — for sync pitching and metadata.
- **Mono-compat waterfall** — per band, not just a scalar. See exactly where the mono fold collapses.
- **Stereo image and phase bands** — image width and per-band phase, side by side.

## Album Batch

A folder in. A sortable table out. Plus full per-song deep dive on demand.

- **Sortable overview table** — LUFS / TP / LRA / ISRC / duration / SR / BD / outlier flags.
- **One rotating song tab** — `←` `→` to step through. Lazy deep analysis cached across rotations.
- **Per-song and album notes** — embedded in every PDF export. Travels with the file.
- **`.rtmalbum.json` sessions** — save and load every analysis, every note, the A/B reference, the cohort ref, the DMR state.
- **Cohort Mode** — promote any track or external file as the reference. Per-track distance heatmap across 31 bands. RMS distance column. Sort by drift to find the outliers.

## Delivery Manifest Reconciler

For label ops. Catches the small things that cancel a delivery.

- **Three-way diff** — audio-embedded metadata ↔ distributor manifest ↔ batch-internal ISRC set.
- **Title-casing drift** — `Feat.` vs `feat.` is enough for Apple to auto-cancel. Surfaced as a blocker.
- **ISRC collisions** — across the album and across prior releases (cross-session history in `~/.rtm/isrc-history.json`).
- **Duration mismatches** — between audio file and manifest.
- **Missing-from-audio / missing-from-manifest** — surfaces orphan rows on either side.
- **P-line / C-line mismatches** — copyright string drift.
- **Ship-Ready PDF + Corrected CSV** — exports to attach to the delivery ticket and re-ingest at the distributor.

## Dolby Atmos

ADM BWF native. Built for immersive mix supervisors.

- **ADM parsing** — bed, objects, trajectories, channel mapping.
- **Binaural TP metering** — early-warning binaural-headroom estimate (ILD downmix, no HRTF). Apple's Atmos guideline is < −1 dBTP on their renderer's binaural deliverable; this is a fast sanity-check, not a substitute for that renderer.
- **Downmix QC** — vs the stereo master. Surfaces level / spectrum drift.
- **Atmos Preflight** — hard-checks: object count ≤ 118, LFE routing, bed layout (7.1.2 / 5.1.4), SR = 48 kHz, BD ≥ 24.
- **Per-object anomaly detection** — hot, silent, static, dark objects. Usually mix mistakes, not artistic intent.

## Quality and Engineer Tips

The "what should I change" surface.

- **Engineer-target curves** — match-score against the chosen profile, driven by smoothed spectra. The Tonal Curve chart, Tonal Differences bars, EQ chips, and EQ moves all live in the same number-space — what you see is what the engine acts on.
- **Concrete EQ moves** — frequency, gain, Q. Tip text reads "X dB hot — consider a Y dB cut" where Y is exactly half of X. Apply half, listen, decide whether to push further.
- **Loudness tip** — fires when your master is off-target vs the engineer's cohort average. ±0.5 LU = low-priority, ±1.0 LU = noticeable in A/B, ±1.5 LU = ease the limiter.
- **Apply-and-bounce** — one click, corrected WAV in your render folder.
- **Mood, genre, section classifier** — for sync pitching, library tagging.

## Breakdown Tab

Element-by-element dissection. Starts with the most actionable view.

- **Per-Element Breakdown** — KICK / SNARE / SUB / BASS / VOCALS / INSTRUMENTS / BRIGHTNESS level-matched against the reference. All 7 visible by default. Powered by BS-RoFormer 4-stem (SDR 9.66 on MUSDB18HQ — sum-back error ±0.2 dB).
- **Masking Overlap** — where your elements are fighting each other in frequency.
- **Transient Density and Structure** — attack shape, transient density, envelope comparisons.
- **Tonal Issues** — surfaces when the engine finds tonal divergence worth calling out. Smoothed spectra only, so narrow resonances (a tuned kick, a key-rooted harmonic) don't register as phantom wideband cuts.

## A/B Player

Same engine everywhere. Same shortcuts everywhere.

- **B tracks the active context** — the song you're viewing.
- **A is whatever you picked** — another album track, the cohort reference, a starred favourite, or an external file dropped on the fly.
- **Live TP meter** — instantaneous and 2-second peak-hold on the transport.
- **Mono listen** — `M`. Solo each side — `S`. Flip A/B — `X`. Loop — `L`.

## Triage Mode

Optional. For release QC, not engineer workflow.

- **Ready-to-Deliver verdict** — pass / hold / block.
- **Attention list** — every issue that didn't pass, ordered by severity.
- **Per-DSP spec profile** — Apple, Spotify, Spotify Loud, Amazon, Tidal, YouTube. Shows which platform you'd fail and why.

## Console Didone Shell (5.2)

The visual surface. Documented separately in `.rtm-design/`.

- **Two-row header** — presence row (wordmark, mode chips, `⋯`) and instrument row (LUFS-I, TP, LRA, MONO).
- **Cover-state empty screen** — Didone wordmark, single drop frame, colophon at bottom. Engineer-profile dropdown lives here — pick your reference before the analysis starts.
- **Per-panel verdict** — Didone hero number at the top of each of the seven main analysis tabs.
- **Single-gold rule** — gold appears on exactly one element per screen: the active delivery-target chip.
- **Classic shell as fallback** — `localStorage['rtm-shell'] = 'v1'` returns to the v5.1.x markup byte-for-byte.

---

## Companion Apps

- **RTMprofile** — feed it 5+ of your finished masters; it learns your sound and saves a fingerprint that loads into RTMcompare's Match tab.
- **RTMsend** — VST3 / AU JUCE plugin that hosts any third-party EQ inside it. RTMcompare pushes its recommended moves directly into the live plugin in your DAW — bands appear as parameter moves on the hosted EQ, dial in the Amount fader to taste. 16 EQ profiles ship out of the box (FabFilter Pro-Q 4, Pro-Q 3, TBTECH Kirchhoff-EQ, bx_digital V3, bx_dynEQ V2, SSL 4000 E/G/J variants, Maag EQ4, elysia museq, SPL PQ, SPL Passeq Single, Lindell EQ825, Sontec MES432D9D, MixWave Pultec EQP-1S3, Ozone 12 Equalizer, MixWave DW Fearn VT-5). Unlisted plugins auto-detect. ARA-aware on Studio One, Cubase/Nuendo, Reaper, and Bitwig; falls back to a 30-second ring buffer on Wavelab Pro 13.

- **Ozone Preset Export** — one click exports the full mastering chain (EQ + Dynamics + Limiter + Imager) as a native Ozone XML preset. Auto-installs into `~/Documents/iZotope/Ozone/User Presets/RTMcompare/` — the preset appears in Ozone's browser immediately, no manual file management. The EQ bands carry the exact delta curves from the analysis; the limiter ceiling is set to the true-peak compliance target for the chosen delivery platform.

Both apps share the Console Didone aesthetic. The wordmark, palette, and typographic hierarchy carry across the suite.
