# RTMcompare — User Manual

*The toolkit that tells you, with numbers, whether the new master is
actually better — and what every streaming platform is going to do
to it on the way out.*

**v5.0.8** · macOS arm64 + Windows x64 · everything runs locally

---

## What's in the box

*Three apps. They cover the whole mix → master → ship loop, and they
talk to each other through one folder on your disk. No accounts,
no cloud, no upload.*

| App | What it does | Who reaches for it |
|---|---|---|
| **RTMcompare** | A/B compare, single-file QC, album batch, Atmos analysis, streaming preview, master-chain render | Mixing · mastering · label QC |
| **RTMprofile** | Drop a corpus of your masters in. Out comes a `.json` that becomes a "sound like Ohad" target curve in RTMcompare's Match tab | Mastering engineers building a personal reference |
| **RTM Send** | VST3 / AU / Standalone plugin. One button on your DAW master bus → audio + DAW context lands in RTMcompare | Anyone tired of the bounce-and-drag dance |

The whole stack is signed (Apple Developer ID), notarized, and
stapled. No Gatekeeper warning. No "this app is from an unidentified
developer" speed-bump. Drag, eject, open. Done.

---

## Install

### macOS (arm64 / Apple Silicon)

1. Download the DMG.
2. Drag the app onto **/Applications**.
3. Eject the DMG.
4. Launch from /Applications.

That last step matters. macOS App Translocation runs DMG-launched apps
inside a sandbox that breaks the bundled Python — so the app will
politely refuse to start and tell you to drag it to /Applications
first. We'd rather a clean error than a mysterious one.

Three DMGs ship inside the bundle:

- **RTMcompare-5.0.8-arm64.dmg** — the analyser
- **RTMprofile-1.0.5-arm64.dmg** — the profile builder
- **RTM-Send-1.0.0.dmg** — drag the AU/VST3/Standalone bundles into
  their plugin folders, or double-click `Install RTM Send.command`
  and let it do the placement for you

### Windows (x64)

- **RTMcompare Setup 5.0.8.exe** — NSIS installer (signed)
- **RTMcompare 5.0.8.exe** — portable build (no install, runs in place)
- **RTMprofile Setup 1.0.5.exe** + **RTMprofile 1.0.5.exe** — same pattern

The Windows VST3 is built separately on a Windows host via GitHub
Actions. Drop the resulting installer into `Common Files\VST3` and
your DAW will find it on next scan.

---

## The five workflows

*These are the only five things you'll actually do in this app.
Read this section once and you're fluent.*

### 1. Two-file compare — the main event

Drop **A** (the reference, the rough mix, the previous master) and
**B** (the new master, the candidate). Hit **Compare**.

Seven tabs come back at you:

- **Overview** — LUFS / TP / LRA / dynamics deltas, level-matched
  waveforms, level-matched A/B player. The headline numbers, all
  in one breath.
- **Mastering** — what your master pass actually changed. Per-band
  shape, transient density, limiter behaviour, stereo width per band.
  (The receipts. See *Mastering Delta* below.)
- **Stereo & Spectrum** — vectorscope timeline, per-band phase
  correlation, mono fold-down per band, masking overlap.
- **Quality** — clip / hum / click / distortion / generation-loss
  detection. Catches the AAC-of-AAC-of-WAV file the label re-sent
  you and swore was "the original master."
- **Delivery** — Streaming Preview for every major platform, Apple
  Digital Masters check, BWF metadata pane, Spec Drift badge.
- **Atmos** — appears when you drop an ADM BWF; channel layout,
  binaural TP, downmix vectorscope, downmix phase timeline.
- **Match** — the target-curve panel. Pick a reference profile, see
  the per-band correction, export it as a real DAW preset.

Tabs stick to the top of the scroll. You can bury yourself in a
panel and still know where you are.

### 2. Single-file QC

One file, no reference. Click **Analyze Reference Only**.

Use this when a master lands on your desk and you need a clean
delivery readout without picking a reference. LUFS, TP, LRA,
streaming previews, clip detection, spec compliance — same
Delivery tab, faster.

### 3. Album batch

Drop a folder of WAVs / AIFFs / FLACs. Every track gets scanned for
LUFS, TP, LRA, ISRC, sample-rate consistency. Outliers vs the album
median light up red.

Inside the batch:

- **Cohort Mode** — pin one track as the cohort reference. Every
  other track gets a heatmap distance score across 31 bands plus
  an RMS distance column. Sort by distance, find the one track that
  doesn't sound like family.
- **Loudness anchor** — flip the Δ column from *vs album median* to
  *vs Spotify −14*, *vs Apple −16*, *vs R128 −23*. Read delivery
  headroom directly off the table.
- **Reissue mode** — pin "old master" as the A across every song
  tab. A/B every track against its original.
- **Per-song notes + album notes** — both ride along in the PDF
  export.

The right-hand song slot rotates as you click rows in the table, so
you don't end up with thirty tabs open and a confused desktop.

### 4. Atmos / ADM

Drop a multichannel ADM BWF. The analyser auto-routes to the Atmos
surface: channel layout, programme name, binaural true-peak, downmix
vectorscope, downmix phase correlation timeline. The A/B player
auto-loads the Atmos stereo downmix against your stereo reference,
level-matched.

Atmos Solo mode handles single-file Atmos QC — same idea, no
reference needed.

### 5. Plugin → app handoff

Install **RTM Send** in your DAW. Drop it on the master bus. Hit
the **Send** button.

The plugin writes the rendered audio + DAW context (region name,
session name, sample rate, BPM, key, region time range) into
`~/.rtm/incoming/`. RTMcompare's file watcher picks it up in about
a second and routes it where you asked:

- **Single** → loads as File A, runs analyser-only
- **Compare B** → loads as File B in your active compare
- **Batch** → seeds File A and starts a batch with this track as
  track 1

A chip appears in the banner with the DAW context and the region
timestamp. No bounce dialog. No drag-drop. No remembering where
your DAW writes its bounces.

---

## RTMprofile — building your own target reference

*Turn ten years of your work into a single `.json` file you can match
against.*

Open RTMprofile. Drop your back catalogue (five tracks minimum for
a stable curve). Type your name, your role, your genres. Click
**Build profile**.

The Python side (the same one that ships inside RTMcompare) measures
each file:

- LUFS-I via [pyloudnorm](https://github.com/csteinmetz1/pyloudnorm)
- True peak (4× resampled per BS.1770-4)
- LRA, peak-to-RMS, crest
- Third-octave spectrum (31 bands, Welch's method, mean-centred)
- Stereo width

Then it aggregates: median curve, mean+std for the scalars. Out
comes a `.json` profile that drops into `~/.rtm/profiles/<slug>.json`
and shows up in RTMcompare's Match tab on the next session.

What you do with it:

- Build a *house style* for a label's roster
- Maintain consistency across years of mastering work
- Clone the sound of an engineer you respect (drop their catalogue
  in, build the profile, match against it)

Privacy note: every measurement runs locally. The profile JSON is
anonymised numbers — no audio embedded, no filenames in the output,
just a sample count and a curve.

---

## RTM Send — the plugin

*JUCE-based. Ships as VST3 + AU + Standalone on macOS, VST3 +
Standalone on Windows. (AAX is on the roadmap once we have a PACE
Eden cert in hand.)*

Three capture modes:

- **Last-N seconds** — a lock-free SPSC ring buffer captures the most
  recent 30 s (configurable up to 120 s) of audio at the master bus.
  The default. Always available.
- **Loop region** — uses your DAW's loop points. Plays the loop once,
  captures it, ships it. Greys out gracefully on hosts that don't
  expose loop info.
- **Triggered region** — manual Rec / Stop. Host-agnostic. Works
  in any DAW, including the ones that don't expose loop points.

ARA2 (the "send Track 03 of the Wavelab montage without master-bus
playback" feature) is wired up but disabled in the shipped binary.
It lights up on the next plugin release.

Three send routes:

- **Single** — writes a `.wav` + `.rtm.json` sidecar + `.ready`
  marker into `~/.rtm/incoming/`. RTMcompare loads it as the current
  single-file analysis.
- **Compare (File B)** — same write, different sidecar route hint.
  Slots into your active two-file compare as B.
- **Album batch** — seeds the batch with this track as track 1.

Rendered audio uses the host's sample rate. The sidecar carries
the DAW context (session name, region name, ARA region bounds if
relevant) plus a `pluginVersion` stamp so RTMcompare knows what
wrote it.

> Why three apps and not one DAW plugin that does everything?
> Because the analysis is heavy — Demucs stem separation, 4×
> true-peak, AAC encoding for the streaming preview, third-octave
> across 31 bands, the whole Mastering Delta panel — and an audio
> plugin's host process is the worst possible place to do that
> work. The plugin is a 1 MB capture-and-handoff agent. The
> 256 MB analyser sits in its own process where it belongs.

---

## The headline panels

*The seven things that make this not just another meter plug-in.*

### Mastering Delta

The seventh tab on every two-file compare. Treats the comparison as
*"what did this master pass actually change?"* and gives you a
signed report card:

- Broadband loudness gain (signed, in dB)
- Per-band tonal shape across 31 1/3-octave bands, mean-centred so
  you're reading the *shape* move, not the *level* move
- LRA delta · PSR delta · RMS-to-peak delta
- Limiter aggressiveness estimate (TP delta-derived)
- Transient density change (%)
- Stereo width change per band
- TP overs pulled back (count)
- **Playback delta after platform normalization** — what the listener
  actually hears once Spotify / Apple / etc. re-equalize the loudness.
  On hot masters, often reads 0.0 dB on every platform. That's not
  a bug — that's streaming normalization wiping your loudness gain
  in real time. Useful insight.
- **Mastering signature hash** — 8 characters of fingerprint over
  the rounded per-band shape. Same hash twice = identical move.
  Catches the "remaster" that wasn't actually re-mastered.

### Sound Check twin

The teal-green ≋ button next to each platform row in the Streaming
Preview. Renders 30 s of the loudest section of your track *through
that platform's actual ingest chain*: normalization gain → 4×
oversampled true-peak limiter modeled on Apple's, with the per-block
gain-reduction envelope visible in the Streaming Delta Heatmap →
AAC 256 kbps via Apple's `afconvert` on macOS (ffmpeg fallback on
Windows).

Hit ≋. Listen. Decide. The fastest answer to *"will my master clip
on Spotify"* you'll ever get.

### Streaming Preview

A live table showing what each platform will *actually play your
master at*: normalization action, played LUFS, played TP, breach
flags. Spotify, Spotify Loud, Apple Music, YouTube, Tidal, Amazon,
Deezer, SoundCloud — plus short-form (TikTok / Reels / Shorts).

Every spec is pinned in a versioned registry — published date,
revision date, source citations. Reload an old result a year from
now and a **Spec Drift** badge tells you whether the targets you
measured against are still current.

### Match tab + Master Assistant

Pick a reference profile (an engineer's, an album average, your
RTMprofile output, or a streaming target). The Master Assistant
computes a per-band corrective EQ, optional dynamics, optional
limiter — and lets you:

- **Audition it live** through the A/B player with an Amount fader
  (0–100%) so you can hear the move at any intensity
- **Export the EQ** as a real DAW preset:
  - **FabFilter Pro-Q 3 / 4** — native binary `.ffp` (Pro-Q 4 reads
    Pro-Q 3 binaries unchanged)
  - **FabFilter Pro-Q text** — paste into Pro-Q's Paste bar
  - **Ableton EQ Eight** — `.adv` (gzipped XML, real Live 12 schema)
  - **CSV / JSON / clipboard** — for everything else
- **Apply and bounce** — render a 24-bit WAV with the EQ baked in,
  optional true-peak limiter at −0.3 dBTP (Apple Music spec, the
  strictest common ceiling), BWF chunk pre-stamped

### Translation Check

Four playback environments rendered as 30 s `.m4a` auditions you can
A/B against the original:

- **Phone speaker** — modern phone driver; sub disappears, presence
  range dominates
- **Earbuds** — consumer earbuds (AirPods-ish)
- **Club PA** — house-system PA with mono-sum sub
- **Car cabin** — generic mid-class consumer car cabin

The renderer tells you the lost-LF energy and the presence-band
change before you hit play, so you know what you're walking into.

### Per-stem AI detection (Deep Scan)

Demucs separation: vocals / drums / bass / other. Each stem gets its
own AI-content verdict. The point is to tell you *where* the
suspicion lives — a vocal-cloned-but-organic-instrumentation mix
scores very differently from a fully synthetic one, and you want to
know which one is on your desk.

### Reference Library

Star a track in the recent-references row. It persists across
restarts. The library shows quick-scan stats per reference (LUFS,
TP, BPM, key) so you can pick the right reference in three seconds
instead of remembering which folder you put it in.

---

## Working modes

*The header has a Surface picker. Pick the surface that matches
the work; the panels you don't need disappear.*

- **Music** — Spotify / Apple Music / YouTube / Tidal / Amazon at
  top. Broadcast hidden. Atmos hidden.
- **Full** — everything on. Music + broadcast + Atmos.
- **Bcast** — broadcast first: R128 / ATSC A/85 at top, dialog gate
  prominent.
- **Netflix** — Netflix Sound Mix Specifications v1.6 (−27 LKFS
  dialog anchor, −2 dBTP ceiling, 5.1 + stereo, 48k/24-bit minimum).
- **Post** — Atmos / immersive. ADM validation surfaced.

Two side toggles:

- **Advanced QC** — reveals collapsed-by-default diagnostic panels
  (Mono Compatibility, Phase Bands, Transient Density, Tempo Drift,
  Waveform Diff, Masking Overlap). Off by default because most
  engineers don't need them most of the time. Needs Deep Scan to
  populate.
- **Educator** — adds a *why this matters* explainer to every panel.
  Useful when you're handing the report to a producer or onboarding
  someone junior.

---

## Keyboard shortcuts

*Press `?` anywhere for the full list. The ones you'll actually use:*

| Key | Action |
|---|---|
| `Space` | A/B player play / pause |
| `Tab` | toggle A / B |
| `M` | mono fold-down on the player |
| `1`–`7` | jump to tabs 1–7 in compare view |
| `[` / `]` | set loop start / loop end |
| `\` | clear loop |
| `←` / `→` | step between songs in batch song-tab |
| `⌘/Ctrl + K` | command palette — search any metric, jump to its tab |
| `⌘/Ctrl + E` | export EQ |
| `⌘/Ctrl + ⇧ E` | apply EQ + bounce |

---

## Where your data lives

*Everything stays on your disk. Always.*

- **macOS**: `~/Library/Application Support/RTMcompare/python-cache/`
  — Python bytecode + Numba JIT cache, redirected here so the signed
  app bundle is never written to (codesign integrity stays intact)
- **`~/.rtm/`** — analysis history, reference library, plugin inbox,
  custom DSP profiles. Lives in your home folder so it survives app
  reinstalls
- **`~/.rtm/profiles/`** — engineer profile JSONs (RTMprofile output
  lands here)

No telemetry. No phone-home. No analytics. The only network calls
happen when you sign in with a license — and even then the app
works fully offline for 180 days after activation.

---

## Troubleshooting

*The five things people actually run into.*

**"RTMcompare cannot be opened from inside the DMG"**
You launched from the DMG window. macOS App Translocation runs
DMG-launched apps in a sandbox that can't reach our bundled Python.
Drag to /Applications, eject the DMG, open from there.

**"Preparing audio…" stuck on the player**
Pre-5.0 bug. Update to 5.0.5+ (you're already on 5.0.8 if you're
reading this).

**Sound Check twin shows "render ✕" on Windows**
Install ffmpeg (`winget install ffmpeg`) and add it to PATH.
Restart RTMcompare.

**Advanced QC panels are blank**
You're viewing a Fast scan result. Re-run with Deep Scan.

**Mastering Delta says 0.0 dB on every platform**
Working as designed. Both files are louder than every platform's
normalization target, so streaming normalization attenuates them
to the same level. The metric is correctly telling you that
mastering loudness gains evaporate after platform normalization.
This is the lesson, not the bug.

**Plugin → App handoff doesn't show up in RTMcompare**
Check `~/.rtm/incoming/` exists and the plugin can write to it.
RTMcompare must be running for the file watcher to fire. The
plugin writes `.ready` last; if you see `.wav` + `.rtm.json` but
no `.ready`, the plugin crashed mid-write — check the host's
plugin log.

**RTMprofile build fails with "Python not found"**
RTMprofile probes for RTMcompare's bundled Python first. If
RTMcompare isn't installed, it falls back to system `python3` —
which needs `numpy`, `scipy`, `soundfile`, `pyloudnorm` already
installed. Install RTMcompare and the problem disappears.

---

## Versions + spec dates

The app shows its version in the lower-right of the header. Each
analysis stamps the spec versions it ran against. Reload an old
result and the **Spec Drift** badge tells you if anything has
shifted since.

This manual covers **5.0.8**.

---

*RTMcompare © 2026 Ohad Nissim · "RTMcompare", "RTMprofile", and
"RTM Send" are trademarks · distributed under the RTMcompare
End-User Licence Agreement, shipped alongside the application.*
