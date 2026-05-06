# RTMcompare — Features

*The decision-support toolkit you wish you'd had on the last record.*

**v5.5.0** · macOS arm64 + Windows x64 · everything runs locally · no
account required to download

---

## What's new in 5.5.0

- **Design bump** — Reference dropdown · "+ New analysis" + Search
  palette (⌘K) + shortcut sheet (?) in the header · sticky Advanced
  QC · prominent "Level matched" pill on EQ Preview · quieter scans.
- **FLOW v2 click detector** — drum-friendly. No more snare-as-click
  false positives.
- **BS-RoFormer 4-stem separator** — SDR 9.66 (vs ~7.5 with Demucs).
  Cleaner stems = more reliable Match-tab + EQ Preview.
- **AI detection removed** — see Stem separation section.
- **RTMprofile 1.4.0** — production model-cache discovery fixed.

---

## The three apps

*A complete mix → master → ship loop, in three apps that talk to
each other through one folder on your disk.*

- **RTMcompare** — the analyser. A/B compare, single-file QC, album
  batch, Atmos analysis, streaming preview, master-chain render.
- **RTMprofile** — drop a corpus of your masters in. Out comes a
  `.json` profile that becomes a reference target inside RTMcompare's
  Match tab.
- **RTM Send** — VST3 / AU / Standalone plugin. One button on your
  DAW master bus → audio + DAW context lands in RTMcompare without
  the bounce dialog.

Pick the section that's you:

- 🎚 [**Mixing engineers**](#for-mixing-engineers)
- 🎛 [**Mastering engineers**](#for-mastering-engineers)
- 🏷 [**Label QC + delivery**](#for-label-qc--delivery)
- 🎹 [**Producers + writers**](#for-producers--writers)
- 🔁 [**Cross-cutting**](#cross-cutting)
- 🌐 [**Platforms we know by name**](#platforms-we-know-by-name)

---

<a id="for-mixing-engineers"></a>

## 🎚 For Mixing Engineers

*The math watching while your ears get tired.*

### A/B with the math watching, not your ears

Two-file compare. Drop your mix, drop a reference. You get
level-matched waveforms, level-matched playback, and per-band gain
analysis that tells you exactly which bands you need to move.

The level-matching is the trick. The "louder one wins" reflex
disappears the moment both tracks come back at the same LUFS. What
you're left with is *the actual difference* — the one your client
will hear once Spotify has its way with the gain.

### Translation Check — phone, earbuds, club, car

The 30-second audition button. Renders your master through a phone
speaker, consumer earbuds, club PA, and car cabin filter chain.
Tells you the lost-LF energy and the presence-band change before you
even hit play.

Catches the chorus that disappears on phone speakers and the sub
move that nobody is actually going to hear.

### Mono compatibility per band

Broadband phase correlation is a polite fiction. A mix can read
+0.8 overall and still cancel catastrophically at 60 Hz on a phone
speaker — the chorus just disappears, the engineer never knows why.

The Phase Bands panel breaks correlation down by frequency band so
you catch the one that betrays you. (It's almost always the bass.
It's always the bass.)

### Reference Library that survives restarts

Star a track from any session. It lives in your reference library
across reboots and reinstalls. Quick-scan stats per reference (LUFS,
TP, BPM, key) so you can pick the right reference in three seconds
instead of remembering which folder you put it in last June.

### EQ moves you can paste back into your DAW

The Master Assistant computes a target-curve correction and exports
it as a real preset, ready to drop:

- **FabFilter Pro-Q 3 / 4** — native binary `.ffp` (Pro-Q 4 reads
  Pro-Q 3 binaries unchanged). Drag onto Pro-Q's preset menu.
- **FabFilter Pro-Q text** — paste into Pro-Q's Paste bar.
- **Ableton EQ Eight** — `.adv`, real Live 12 schema. Drop onto an
  EQ Eight in Live 11 / 12.
- **CSV / JSON / clipboard** — for everything else.

> Logic Channel EQ and Wavelab native presets were dropped after a
> format audit revealed both were misleading: Logic uses `.pst`
> (not `.aupreset`) and the Wavelab "SparkleEQ" target doesn't
> exist as a real Wavelab preset format. We'd rather ship two
> formats that load than five that don't.

### DAW handoff, no bounce dialog

The **RTM Send** plugin drops on your master bus. Three capture
modes:

- **Last-N seconds** — lock-free ring buffer captures the most recent
  30 s (configurable up to 120 s). Always available.
- **Loop region** — uses your DAW's loop points. Plays the loop once,
  captures it, ships it.
- **Triggered region** — manual Rec / Stop. Host-agnostic. Works in
  any DAW, including the ones that don't expose loop points.

Three send routes — single, compare-B, batch. The plugin writes the
audio + sidecar JSON + `.ready` marker into RTMcompare's inbox. The
app picks it up in under a second. You don't leave the DAW. You
don't bounce. You don't drag.

---

<a id="for-mastering-engineers"></a>

## 🎛 For Mastering Engineers

*Receipts, every time, for every move.*

### Mastering Delta — what your pass actually changed

A signed report card on the seventh tab of every two-file compare:

- Broadband loudness gain (signed, in dB)
- Per-band tonal-shape delta across 31 1/3-octave bands, mean-centred
  so you read the *shape* move not the *level* move
- LRA delta · PSR delta · RMS-to-peak delta
- Limiter aggressiveness estimate
- Transient density change (%)
- Stereo width change per band
- TP overs pulled back (count)
- **Mastering signature hash** — 8 characters of fingerprint over
  your tonal move. Same hash twice = identical pass. Useful for
  archival and the eternal question: *did the 2026 reissue actually
  re-master, or did somebody just re-encode the 2018 master?*

### Sound Check twin

The teal-green ≋ button next to each platform row. Renders 30 s of
the loudest section *through that platform's actual ingest chain*:
normalization gain → 4× oversampled true-peak limiter modeled on
Apple's, with the per-block gain-reduction envelope visible in the
Streaming Delta Heatmap → AAC 256 kbps via Apple's `afconvert` on
macOS.

Hit ≋. Listen. Decide. The fastest answer to *"will my master clip
on Spotify"* you'll ever get.

### Streaming Preview — pre-mastered for every platform

Live table showing what your master will *actually play at* on
Spotify (−14 LUFS, +6 dB cap on Loud mode), Apple Music (−16 LUFS,
attenuate-only), YouTube, Tidal, Amazon, Deezer, SoundCloud. Per
platform: action, played LUFS, played TP, breach flag.

The platform rules live in a single shared registry — so the
streaming preview, the Mastering Delta panel, and the Sound Check
twin never disagree about how Apple Music behaves. (You'd be amazed
how often that quiet bug bites software that does this.)

### True-peak measurement, certification-grade

4× oversampled true-peak per BS.1770-4. Cross-checked against a fast
Numba kernel for sanity. Every result reports both integrated TP and
the worst short-term TP block, so you know whether the danger is
spread across the master or hiding in one bar of the chorus.

### Pinned spec registry + Spec Drift badge

Every spec — Apple Music, Spotify, EBU R128, ATSC A/85, Netflix
v1.6, YouTube, Tidal, Amazon, Deezer, SoundCloud, plus the
short-form platforms — has a published date, a revision date, and a
links-to-source list. Every analysis stamps the spec version it ran
against.

Reload an old `.rtmalbum.json` from a year ago and the **Spec Drift**
badge tells you whether the targets you measured against are still
current. Useful when a label asks why the 2024 numbers don't quite
match the 2026 ones.

### BWF / ADM metadata round-trip

Read BWF metadata (originator, ISRC, BEXT, iXML) on input. Stamp
BWF metadata on output (Master Chain Render writes a 24-bit WAV
with the BWF chunk pre-populated). For Atmos delivery, ADM XML is
parsed and the channel layout is surfaced in the analyzer.

### Master Chain Render

EQ + dynamics + true-peak limiter + AAC-target-aware loudness,
rendered to a 24-bit WAV with the BWF chunk stamped (originator:
`RTMcompare Master Assistant`, coding history line, optional ISRC).
One pass, one file out, ready for delivery. True-peak limiter
ceiling fixed at −0.3 dBTP — Apple Music spec, the strictest common
ceiling, so you only have to render once.

### RTMprofile — your style as a target

Drop a corpus of your masters into RTMprofile. Out comes a versioned
`.json` profile capturing your typical curve, LUFS distribution, LRA
distribution, dynamic-range, peak distribution, stereo-width
distribution. Drop the JSON into `~/.rtm/profiles/` and it appears
in RTMcompare's Match tab as a target reference.

What it's good for:

- A *house style* for a label's roster
- Maintaining consistency across years of your own work
- Cloning the sound of an engineer you respect (drop their catalogue
  in, build the profile, match against it — entirely legal, entirely
  educational)

---

<a id="for-label-qc--delivery"></a>

## 🏷 For Label QC + Delivery

*The album-level view, with the one outlier highlighted in red.*

### Album batch

Drop a folder of WAVs / AIFFs / FLACs. Every track is scanned for
LUFS, TP, LRA, ISRC, sample-rate consistency. Outliers vs the album
median get flagged in red. You see the problem without reading the
table.

### Cohort Mode — find the one track that doesn't fit

Pin one track as the cohort reference. Every other track gets a
heatmap distance score across 31 bands plus an RMS distance column.
Sort by distance, see the one track that strays furthest from the
family resemblance — the bright one in a dark album, the soft one
in a loud one.

### Loudness anchor

Reframe the Δ column from *vs album median* to *vs Spotify −14*,
*vs Apple −16*, *vs R128 −23*. Read delivery headroom directly off
the table. No mental math required.

### Reissue mode

Anchors "old master" as the A-side reference across every song tab.
A/B every track of the reissue against its original. Catches the
mastering drift between the 1998 vinyl and the 2026 hi-res — the
small EQ hand that the compilation team didn't tell you about.

### Notes that survive the export

Per-song notes + album-wide notes. Both ride along in the
Ship-Ready PDF that the QC engineer hands off to delivery. (Yes,
the same WeasyPrint pipeline as the docs you're reading.)

### Save / load session

Save the entire album-batch session — measurements, notes,
favorites, open tabs — to a `.rtmalbum.json`. Reopen later, no
re-analysis needed. Multi-day QC sessions just work, even across
restarts.

### Single-file quickscan

For when one track lands on your desk and you need delivery hygiene
verified without a comparison. LUFS / TP / LRA / streaming preview /
clip detection in seconds.

---

<a id="for-producers--writers"></a>

## 🎹 For Producers + Writers

*The math, with subtitles.*

### Educator mode

A toggle that adds a *"why this matters"* explainer to every panel.

Useful when:

- Handing the report to a non-engineer collaborator
- Onboarding a junior engineer
- Making the case to a label why their delivery is failing

It's the difference between *"true peak is +0.4 dBTP"* and
*"this will clip on Spotify, here's why, here's the fix."*

### Surfaces that match how you work

Five working surfaces — Music, Full, Broadcast, Netflix, Post —
that change which panels appear by default. Hobbyists won't see
broadcast specs unless they ask for them; broadcast engineers
won't have to dig past streaming specs to find R128.

Surfaces aren't permissions, they're focus. Switch any time.

### One-click playback environment audition

Translation Check renders 30 s of your master through phone
speaker, earbuds, club PA, and car cabin in a click. Hear what
most of your listeners are actually going to hear, before you
commit to the bounce.

### RTM Send — for the producer who doesn't bounce yet

Drop the plugin on your DAW master. Hit Send. The track lands in
RTMcompare with the DAW context — region name, BPM, key, time
range — preserved in the sidecar.

You don't need to leave the DAW. You don't need to bounce-and-drag.
You don't even need to know where your DAW writes its bounces
(the answer is "somewhere weird, almost certainly").

---

<a id="cross-cutting"></a>

## 🔁 Cross-cutting

*The features nobody asks about until they need them.*

### Atmos / immersive

Drop a multichannel ADM BWF and the analyzer routes to the Atmos
surface: channel layout, programme name, binaural true-peak,
downmix vectorscope, downmix phase correlation timeline. The A/B
player auto-loads the Atmos stereo downmix against your stereo
reference, level-balanced. Atmos Solo mode handles single-file
Atmos QC.

### Stem separation (Deep Scan)

BS-RoFormer 4-stem: vocals / drums / bass / other. SDR 9.66 on
MUSDB18HQ. Powers per-stem masking, EQ Preview level-match,
and Match-tab comparisons. Auto-falls-back to Demucs if
BS-RoFormer can't load.

> **AI detection has been removed in 5.5.0.** The 24-detector
> ensemble would have added 1.1 GB to the bundle for one
> optional feature. Sit on 5.4.0 if you needed it.

### Advanced QC mode

A toggle in the header that reveals collapsed-by-default
diagnostic panels:

- **Mono Compatibility** — per-band fold-down behaviour
- **Phase Bands** — per-band phase correlation
- **Transient Density timeline** — auto-detected song sections +
  rhythmic density across the track
- **Tempo Drift over time** — for archival reissues, classical, live
  recordings, anything un-quantized
- **Waveform Diff Heatmap** — time × frequency map of where two
  files actually disagree, not just the average
- **Masking Overlap** — where elements compete for the same
  frequency. In Deep Scan this is per-stem.

Off by default because most engineers don't need them most of the
time. On when you do — they're the most powerful diagnostic
surfaces in the app.

### Built-in shortcuts

Press `?` for the full list. Quick wins:

| Key | Action |
|---|---|
| `Space` | A/B play / pause |
| `Tab` | toggle A / B |
| `M` | mono fold-down |
| `1`–`7` | jump to tabs |
| `⌘/Ctrl + K` | value-scoped command palette |
| `⌘/Ctrl + E` | export EQ |
| `⌘/Ctrl + ⇧ E` | apply EQ + bounce |

### Local-only by design

Audio never leaves your machine. No telemetry, no phone-home, no
analytics. The only network calls happen when you sign in with a
license — and even then the app works fully offline for 180 days
after activation.

Your unreleased mixes never enter someone else's training corpus.
Your demos never become a competitor's research data. The wire
to the internet is, by architecture, only there to verify you
exist.

### Stress-tested

Every release ships only after a full pass through the test corpus:
real album bounces (10 tracks), running every CLI entry point
end-to-end. 5.0.8's pre-ship pass: 16/16 green across single +
hybrid analysis, batch, all four translation envs, all four
streaming previews, three pair comparisons, master-chain render.

---

<a id="platforms-we-know-by-name"></a>

## 🌐 Platforms we know by name

*Every platform in the streaming preview ships with a pinned spec
record (target LUFS, target TP, normalization behavior, source
citations). Reload an old result, and the Spec Drift badge tells
you if anything has shifted since.*

### Music streaming

| Platform | Target LUFS | TP ceiling | Behavior |
|---|---|---|---|
| Spotify | −14 LUFS | −1 dBTP | Boosts quiet up to +6 dB; attenuates loud |
| Spotify Loud | −11 LUFS | −2 dBTP | Boosts quiet up to +6 dB; attenuates loud |
| Apple Music | −16 LUFS | −1 dBTP | Attenuate-only (Sound Check) |
| YouTube | −14 LUFS | −1 dBTP | Attenuate-only |
| Tidal | −14 LUFS | −1 dBTP | Attenuate-only |
| Amazon Music | −14 LUFS | −2 dBTP | Attenuate-only |
| Deezer | −15 LUFS | −1 dBTP | Attenuate-only |
| SoundCloud | −14 LUFS | −1 dBTP | Attenuate-only |

### Short-form

TikTok, YouTube Shorts, Instagram + Reels — pinned at −14 LUFS /
−1 dBTP, marked provisional (reverse-engineered targets, since
the platforms don't publish them).

### Broadcast / streaming TV

- **EBU R128** — −23 LUFS / −1 dBTP / 18 LU LRA guardrail
- **ATSC A/85 (CALM Act)** — −24 LKFS / −2 dBTP / ±2 LU tolerance
- **Netflix Sound Mix Specs v1.6** — −27 LKFS dialog anchor /
  −2 dBTP / 5.1 + stereo / 48 kHz+/24-bit

### Apple Digital Masters

Source profile: 24-bit / ≥44.1 kHz / loudness aligned to Apple Music
Sound Check. ADM source pinned with all delivery requirements.

---

## What's NOT in v5.0.8

*Honest about this:*

- **Real-time playback monitoring while you mix.** RTMcompare is a
  post-pass tool, not a meter plug-in. The live TP meter on the
  player's transport is fine for A/B sessions, not for tracking.
- **De-noising / repair.** We have de-click detection and a basic
  repair pass, but RX-grade restoration is not the goal.
- **Atmos object editing.** We measure Atmos files; we don't edit
  panners.
- **Cloud collaboration.** Local-only by design, full stop.

---

## On the roadmap

- **Pro Tools AAX** for the RTM Send plugin (gated on a separate
  Avid PACE Eden cert)
- **ARA2** integration for region-specific capture from Logic, Studio
  One, Cubase, Reaper, Wavelab montages — wired up in the source,
  hidden in the shipped binary until the implementation lands
- **EV code-signed Windows installer** for instant SmartScreen pass

---

*RTMcompare © 2026 Ohad Nissim · v5.0.8 · all features run locally ·
no account required to download*
