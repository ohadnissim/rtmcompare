# Changelog

All the changes worth telling you about, newest first.

---

## 5.7.0 — Send to Plugin, smoothed spectra, Breakdown redesign

The big one for DAW-centric workflows. RTMcompare can now talk directly to the EQ sitting in your session.

### Send-to-Plugin (RTMsend bridge)

RTMsend is now a host plugin — it holds any third-party EQ inside it, and RTMcompare pushes recommended bands straight into the live plugin as parameter moves. Click Send to Plugin in RTMcompare, watch the bands land on your hosted EQ, then use the Amount fader to dial in how hard you apply the move.

- **16 EQ profiles out of the box:** FabFilter Pro-Q 4 and 3, TBTECH Kirchhoff-EQ, bx_digital V3, bx_dynEQ V2, all SSL 4000 E/G/J variants, Maag EQ4, elysia museq, SPL PQ, SPL Passeq Single, Lindell EQ825, Sontec MES432D9D, MixWave Pultec EQP-1S3, Ozone 12 Equalizer, MixWave DW Fearn VT-5.
- **Auto-detect for unlisted plugins** — numbered-band detection (Pro-Q-style) and named-slot detection (SSL/bx_digital-style) handle anything not in the catalogue.
- **Pultec / range-selector plugins** capture as reference-only profiles (their UI doesn't map to direct parameter writes).
- **ARA support** on Studio One, Cubase/Nuendo, Reaper, Bitwig. Wavelab Pro 13 is non-ARA — falls back to a 30-second ring buffer.

### Spectral smoothing

The tonal recommender now runs on 3-band log-frequency Hann-smoothed spectra. A tuned-kick fundamental at 50 Hz no longer reads as a broad-band imbalance. The Tonal Curve chart, Tonal Differences bars, EQ chips, and EQ moves are all in the same smoothed number-space now — what you see and what the engine acts on agree.

### Loudness tip

New tip block in the Engineer tab. Fires when your master is off-target vs the engineer's cohort average: ±0.5 LU = low-priority, ±1.0 LU = noticeable in A/B, ±1.5 LU = ease the limiter / push the master.

### EQ tip ↔ chip math fix

Tip text now reads "X dB hot — consider a Y dB cut" where Y is exactly half of X — matching the chip value next to it. Before 5.7.0 the chip was 60% of the difference and the tip text was 50%; they disagreed by ~15%.

### Breakdown tab redesign

- **Per-Element Breakdown moves to the top.** KICK / SNARE / SUB / BASS / VOCALS / INSTRUMENTS / BRIGHTNESS, all 7 visible by default. Powered by BS-RoFormer (SDR 9.66 on MUSDB18HQ; sum-back error now ±0.2 dB instead of ±0.5).
- **Transient Density & Structure, Masking Overlap, and Tonal Issues** promoted out of the Advanced QC toggle — they show whenever data is present.
- **Mix Diverge heatmap removed** — overlapped with the per-region tonal_diff bars.
- New section order: Per-Element Breakdown → Masking Overlap → Transient Density & Structure → Tonal Issues.

### Engineer profile dropdown

Restored to the cover screen. Pick your reference engineer before kicking off an analysis — no sub-menu dig required.

---

## 5.6.0 — Tonal Curve chart fix, per-element visibility

- **Tonal Curve chart now draws smoothed contours.** Pre-5.6.0 the chart drew raw spectra (legitimately huge spikes at narrow tonal features) while the recommender used smoothed values — so the chart and the tips appeared to disagree by 4–7 dB. Fixed.
- **All 7 per-element cards visible by default.** Removed the Show/Hide gate; the 0.5 dB JND threshold now governs visibility automatically.

---

## 5.5.2 — solo-in-place on the EQ Preview

Tiny **S** toggle next to every band on the EQ Preview panel. Click it to solo that band in place — the other bands stay in the chain at 0 dB so the biquad order, Q, and frequency positions are preserved (the band keeps its slot — hence "in place"). Click again or press `Esc` from anywhere to clear.

Useful when you're trying to hear what one specific EQ move is doing without the others colouring the result.

---

## 5.5.1 — the "?" button works now

A one-liner. The `?` button in the header dispatched a custom event that nothing was listening for, so clicking it did nothing. Pressing the `?` key worked fine; only the click route was broken. Fixed.

If you're already on 5.5.0 and only ever press `?` instead of clicking, you don't need this update.

---

## 5.5.0 — the big one

This release rebuilds the click detector, gives the whole app a fresh coat of paint, and upgrades the stem separator to something genuinely state-of-the-art. The 24-detector AI ensemble we'd been working on doesn't ship in this version — read on.

### Design bump

We took a hard look at the UI and trimmed the bits that got in your way:

- **Reference history is a dropdown now.** Your starred refs and recent picks live in a compact menu on the main page instead of a wall of names. Click, scroll, pick, go.
- **"+ New analysis" lives in the header.** Reset and start fresh from anywhere — no more hunting through the menu.
- **Search palette (⌘K).** Jump to anything, fast. New header button to summon it.
- **Keyboard shortcuts panel (?).** All the hotkeys, one tap away. Also in the header.
- **EQ Preview: "Level matched" toggle is now a pill, not a hidden gear-icon setting.** A/B-ing the EQ tweak with and without level-matching used to take three clicks. Now it's one.
- **Advanced QC remembers its state.** Open it once, it stays open across sessions. No more re-toggling every time you launch the app.
- **Quieter single-file & folder scans.** Removed the Ceiling and ADM warnings that fired on every non-Atmos file — they were noise, not signal.

### Click & glitch detector — drum-friendly

The v1 click detector was great at finding clicks. It was also great at flagging snare hits as clicks. Replaced it with FLOW v2 (LPC residual, Godsill & Rayner 1998).

- **No more drum false positives.** Tuned to FLOW's strict production default (sensitivity 1.0, K = max(6, 12/sens) = 12).
- **Better severity ranking.** The top 20 list now sorts by severity then ratio, so the worst offenders surface first.
- **Cleaner deduplication.** Removed redundant 80 ms double-dedupe that was hiding adjacent real clicks.

### Stem separator — BS-RoFormer

Quiet but big. The Demucs-only separator from earlier 5.x has been replaced with BS-RoFormer 4-stem (drums / bass / other / vocals).

- **SDR 9.66 on MUSDB18HQ.** Up from ~7.5 with Demucs. Cleaner stems = more reliable downstream analysis (Match tab, EQ Preview level-match, masking).
- **Auto-falls-back to Demucs** if BS-RoFormer can't load — older bundles and edge cases keep working.

### AI detector — removed

We were going to ship UAI's 24-detector calibrated ensemble (F1 0.998 on Lambda validation). It works beautifully — but it would have added 1.1 GB of model weights to the bundle, mostly for one optional feature most engineers don't use day-to-day. We pulled it for now and may revisit as a separate opt-in download. If you relied on the AI panel, sit on 5.4.0 for now or shout.

### RTMprofile (1.4.0)

- **Production model-cache discovery.** Standalone RTMprofile.app now walks up the bundle to find `model-cache/` correctly — no more "model not found" on first launch.
- **BS-RoFormer with htdemucs fallback.** Deep Scan picks the best separator available; falls back gracefully on older bundles.
- **Updated Deep Scan blurb.** Reflects the new BS-RoFormer pipeline.

### Build & deploy

- **Bundle dropped ~840 MB.** Mac DMG goes from ~2 GB (with AI ensemble + CLAP) to a leaner ship. Win bundle finally includes the BS-RoFormer separator (it was silently missing in 5.4.0).
- **Win CI cache key bumped to v5.** Forces a clean rebuild without xgboost / transformers / huggingface_hub.
- **24 audit fixes** from the pre-flight pass. Mostly cosmetics, a couple of real wiring bugs.

---

## 5.4.0

UAI integration kickoff. BS-RoFormer 4-stem + 24-detector ensemble landed, but shipped without the strict engine deps so the panel ran in validation mode in production. Click detector v2 first cut. 24 audit fixes.

## 5.3.0

Vendored the UAI detector runtime (modspec, lofcz, CNN, AST). First pass at the calibrated ensemble. Mac signing/notarization automation.

## 5.2.x

Windows bundle reached parity with Mac (added librosa/numba/demucs/julius/openunmix). Atmos pipeline polish. Pitch deck refresh.

## 5.1.x

First Windows release. EBU R128 fixes. Album batch view.

## 5.0.x

Initial 5.x line — A/B compare, single-file QC, Atmos, the whole bundle structure.
