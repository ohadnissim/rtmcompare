# RTM Suite — Delivery-Readiness Rundown (consolidated)
_Generated 2026-06-08 from four passes: /dsp-double-check, /dsp-research, /reinvent (12-thread), /senior-board (25 members)._
_Source reports: `docs/audit/00_DIRECTOR_SUMMARY.md` + per-member files; raw audit outputs in session task files._

## HEADLINE VERDICT — GO-WITH-CHANGES (NO-GO as-is)
The BS.1770-4 measurement **core is solid and trustworthy** (K-weighting + bilinear prewarp, gating, short-term ST, <3s LRA guard — all verified correct). The suite is **not shippable for paid delivery today** for fixable reasons, not fundamental ones: it emits **confident wrong verdicts**, **signs them** with a forgeable certificate, and **ships a binary that doesn't contain the code that was tested**.

**Minimum bar to ship:** close the "lie-class" behind a typed-measurement contract, make the shipped binary bit-traceable to tested source (JUCE pin + CI gate), neutralize the signed-cert path, and pass a real-master parity gate — not just the named point fixes.

## SINGLE BIGGEST COMPANY RISK
RTM mints a "signed," forwardable **Apple Digital Masters PASS on a clipping master it under-reads ~6 dB** — and the signature is a forgeable per-machine HMAC (`rtm_certify.py:199-231`) carrying RTM's name as a warranty. One screenshot is irreversible: resets willingness-to-pay to the free-meter floor, hands competitors their pitch, and contaminates sister-product UAI.

---

## P0 — MUST FIX before any paid build
| # | Finding | File:line | Effort | Board flag |
|---|---|---|---|---|
| P0-1 | AAC inter-sample-peak verdict on **mono downmix** → false PASS on a clipping master | `encoded_preview.py:246/255/290/297` | S | 22/25 |
| P0-2 | **JUCE fork NOT in the shipped binary** — gitignored/untracked, CI clones stock 8.0.12 → white-screen/paint fix silently absent | `.gitignore:71`, `build-windows.yml:51` | M | 7/25 |
| P0-3 | Forgeable **signed cert** on a wrong number — strip/disable the "certificate" word for now | `rtm_certify.py:199-231` | S–M | 6/25 |
| P0-4 | **Sentinels acted on** — `-70.0` LUFS / `0.0` LRA rendered as real, drive bogus advice | `AnalysisView.tsx:2119`; `comparator.py:1964-71,72` | M | 9/25 |
| P0-5 | **Typed-measurement contract** `{value,valid,reason,provenance}` at the Py→JSON boundary — structurally retires P0-1/P0-4, kills 825 NaN guards + 40 `or DEFAULT` traps | cross-cutting | M–L | 11/25 |
| P0-6 | **ViSQOL in 16 kHz SPEECH mode** for a music tool → switch to 48 kHz audio mode | `comparator.py:1919` | S | 6/25 |
| P0-7 | **No real-master parity gate exists** — build golden set, gate ≥95% specificity (benign EQ) / ≥90% sensitivity (real artifacts) | new harness | M–L | 5/25 |
| P0-8 | RTMprofile **paid match-score is ~constant** (cosine on `dB+100` saturates) → PULL until fixed | `engineer_profile.py:1005` | S | 6/25 |
| P0-9 | Delete **4.0 GB dead ML weights** bundled for a separator that doesn't exist | `model-cache/` | S | 7/25 |

## P1 — fix-soon or disclose
- 16-bit truncation before AAC encode → write PCM_24 (`encoded_preview.py:409`)
- Per-channel TP everywhere (not mono); stereo/Atmos LRA folds to mono sum (`comparator.py:2059`, `:66`)
- soxr-vs-resample_poly TP fork → make soxr a hard dependency or refuse to emit dBTP (`comparator.py:639-652`)
- RTMsend HIGH bugs: `handleBypass(true)` destroys plugin+state & `bypassed` atomic never written (`RpcServer.cpp:727`); data race on `loopCapture.samples` without callback lock (`PluginProcessor.cpp:804`); faulted hosted block captured into ring before recovery (`:233`); ARA region id = recycled raw pointer → wrong-track audio
- Rename `perceptual_quality`/"degradation" → `spectral_difference` (mel-L1 is not a quality score)

## DISCLOSE (state honestly; don't "fix")
- 4× true-peak is **sufficient** per BS.1770-4 Annex 2 — do **not** default to 8× (conditional re-measure only)
- Hosted 3rd-party plugin runs on the audio thread — RT risk is inherent (disclose like a DAW does)
- mel-L1 fallback is a spectral-difference metric, not a perceptual quality score
- QA history is synthetic-only — drop the README "SDR 9.66" framed as mix accuracy

---

## PER-PRODUCT STATUS
- **RTMcompare** — core solid; blocked by P0-1/3/4/5/6/7/9. The trust sprint makes it the flagship GA.
- **RTMsend** — separate beta track. Two issues compound: P0-2 (the paint fix isn't even in the shipped binary — this is why Pro Tools was never confirmed) + HIGH concurrency/state bugs. Needs JUCE pin + the P1 RTMsend fixes before beta.
- **RTMprofile** — **HOLD**. Its headline paid feature (match-score) is mathematically near-constant. Fix-and-reintroduce or retire.

## GTM DECISION
**Ship the fixed METER now; do NOT hold for the pivot; do NOT ship the certificate.** Ship-vs-hold is a false dilemma — the certification layer wraps the same engine and serializes the same typed-measurement type, so the pivot is *earned by* the trust sprint (same first move either way). Parallel tracks (RTM is a company):
- **Track A** — paid Meter + Adviser GA now.
- **Track B** — un-priced "RTM Verify (preview)" with server-side Ed25519/C2PA signing, timed to EU AI Act (Aug 2 2026) + UAI bundle.
- RTMsend = separate beta; RTMprofile = held.

## TIMELINE TO PAID GA (~3 weeks)
- **W0** — quarantine staged `release/` bundles; delete dead weights; disable "certificate" wording.
- **W1** — typed-measurement contract (lands P0-1/4/6); single TP engine.
- **W2** — JUCE submodule + CI gate + live update channel.
- **W3** — parity gate green = the ship gate → **paid GA end of W3**.
- **W4** — demote cert copy, waitlist, closed NDA → throttled paid alpha → Product Hunt last.

## SMALLEST SAFE FIRST STEP
**Quarantine the packaged `release/` 8.4.0 / 7.5.5 bundles and determine whether any bundle or generated certificate already reached a customer.** Hours of work; its answer decides roadmap-vs-recall and reorders everything.

## STRATEGIC UPSIDE (the reason to fix, not just patch)
The fatal pattern — **scalar-certainty** (every metric always returns a confident number) — when inverted into `value ± uncertainty + provenance`, is simultaneously the credibility fix **and** the patentable, category-defining moat. RTM can become the **neutral delivery-certification layer** ("Stripe for audio delivery compliance") that generative competitors (LANDR, RoEx) are structurally disincentivized to build. Patent white space to file fast: the **in-DAW plugin-hosting capture-and-send loop** (RTMsend's exact architecture).

## FOUNDER-ONLY QUESTIONS
1. Did any 8.4.0 / 7.5.5 bundle **or generated certificate** reach a paying customer?
2. Willing to ship **without a binary certificate** at launch?
3. Can Track A and Track B run **truly parallel** (team bandwidth)?
4. Is the Aug-2026 EU-AI-Act / UAI bundle a **committed** catalyst?
5. AAX/PACE signing is **bus-factor-1** — add a second signer before RTMsend beta?
6. RTMprofile — delete permanently, or fix-and-reintroduce?
