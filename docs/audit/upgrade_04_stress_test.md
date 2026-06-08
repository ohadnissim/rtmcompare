# Upgrade 04 — Assumption Stress-Test (RTM Suite delivery-readiness)

**Lens:** Which single NUMBER, if off by 2×, breaks the plan? The three prior audits
found the *bugs*. My job is the *numbers the ship/no-ship decision rests on*, how
fragile each is, the downside if the most fragile one is wrong, and what to hedge
before locking the plan. I do not re-list known bugs; I price them.

---

## 1. The load-bearing numbers and how fragile each is

The whole company valuation rests on one claim: **"every customer-facing number is
trustworthy."** That is not one number — it is a *defect rate*. Stress-test it as such.

| # | Load-bearing number | Current implied value | If off by 2× | Fragility |
|---|---|---|---|---|
| **N1** | **Customer-facing-number defect rate** (fraction of emitted verdicts that are wrong/misleading) | Implied ~0 ("trustworthy meter") | Audits found ≥3 verdicts that are *systematically* wrong (AAC mono-downmix pass/fail `encoded_preview.py:246/255/290`; ViSQOL 16kHz speech mode `comparator.py:1919`; in-band sentinels acted on `AnalysisView.tsx:2120`). True rate is **not near zero — it is "at least one fatal per delivery report."** This number is already 100%+ off. | **FATAL.** This is the only number that matters. It is already wrong, not at-risk. |
| **N2** | **RTMprofile paid match-score discriminative range** | Sold as a meaningful 0–100 fingerprint match | `engineer_profile.py:1005` cosine on `dB+100` saturates ~50/50 for *any* two masters → effective range ≈ **±a few points around 50**, i.e. the product measures nothing. A paid feature with ~0 information content. | **FATAL for RTMprofile specifically.** Off by ∞, not 2×. |
| **N3** | **TP oversampling factor (4×)** | 4× | Audit 3 confirms BS.1770-4 Annex 2 → 4× is *sufficient*; soxr-vs-resample_poly fork gives 0.3–0.5 dB *install-dependent* divergence. The factor is fine; the **reproducibility across installs** is the soft number — two customers measure the same file 0.5 dB apart. | **MED.** Factor robust; cross-install determinism fragile. |
| **N4** | **Benign-EQ specificity / real-artifact sensitivity** | Audit 3 gate: ≥95% / ≥90% | mel-L1 "perceptual_quality" trips on a benign 3 dB EQ (`comparator.py:693-743`). Current specificity is **unmeasured** and almost certainly <95%. If true spec is 80% not 95%, 1-in-5 clean masters get a scary "degradation" verdict → support load + trust collapse. | **HIGH, and currently unknown** — you cannot ship a trust product on an unmeasured trust gate. |
| **N5** | **Cross-platform parity** (mac arm64/Intel/Win/Linux produce identical numbers) | Implied identical | 3 separate Python bundles (1.1–1.2 GB each), soxr fork (N3), `min(sr_dec,sr)` TP-axis corruption. If parity is 0.5 dB not 0.0, the "trustworthy meter" is **install-dependent** — the single worst look for a meter. | **HIGH.** Untested across the matrix. |
| **N6** | **License-clean distribution** (binary fraction: 1 or 0) | Assumed 1 (clean) | `demucs` 4.0.1 + `audio_separator` are *bundled in all three Python bundles* but **never imported by app code** (`python/*.py` has zero `import demucs`). Demucs *code* is MIT, but its shipped/pretrained htdemucs **weights are CC-BY-NC research-only**. If those weights are in the bundle, distribution-license-clean = **0, not 1** — and you carry ~0.4 GB torch + a separator you don't even use. | **HIGH and binary** — one NC weight file flips a hard constraint from PASS to FAIL. Free to fix (delete). |
| **N7** | **Pivot asset readiness** (is "RTM Verify" cert layer greenfield or wired?) | Audits frame it as a moonshot | `python/rtm_certify.py` **already exists**: HMAC-signed JSON cert CLI, SHA-256 audio hash, generation-loss probability, 6 DSP targets. The pivot is **~70% built, not greenfield.** DECISIONS.md already prices it ($0.10/track; $500/mo/label; $3k–12k/yr edu). | **LOW risk / HIGH upside** — the expensive part is done; what's missing is exactly N1 (the cert would sign *wrong numbers* today). |

---

## 2. The downside case if the most fragile one is wrong

**The most fragile number is N1 (defect rate), and it is already wrong — this is not a
tail risk, it is the base case.**

Concrete downside chain if you ship as-is:

1. A paying mastering engineer runs a hard-panned, genuinely-clipping master.
2. The AAC inter-sample-peak check downmixes to mono → reads ~6 dB low → emits a
   **green "Apple Digital Masters PASS."**
3. Engineer delivers to a DSP on the strength of *your certificate*. DSP's own
   encoder clips audibly. The engineer's client / the label hears it.
4. The failure is **attributable to RTM** — you didn't fail to catch a problem, you
   *affirmatively certified a defect as clean*. That is the one error a meter cannot
   survive. A meter that is silent is useless; a meter that is *confidently wrong* is
   liable.

**Why this is uniquely lethal for THIS company:** RTM's entire moat (Audit 2) is
"neutral, trustworthy grader — generative competitors structurally can't copy our
neutrality." A single public "RTM passed my clipping master" post on a mastering
forum **converts your only moat into your headline liability.** The downside is not
"a bug" — it is the **permanent loss of the one asset that differentiates you from
LANDR/RoEx.** Trust is a stock, not a flow: you spend years earning it and lose it in
one screenshot.

Secondary downside (N2): RTMprofile is a *paid* feature returning ~random match
scores. The first sophisticated customer who tests it with two obviously-different
masters and gets "51% match" both ways will (a) demand a refund and (b) reasonably
ask **"what else are you faking?"** — contaminating trust in the meter that *is* real.
**RTMprofile is a trust liability disproportionate to its revenue. Pull it, don't fix
it under deadline.**

---

## 3. What to de-risk or hedge before locking the plan

Ordered by (severity × ease):

1. **N6 — delete the dead separator + NC weights from all 3 bundles (FREE, do today).**
   Zero functional cost (not imported), removes a binary hard-constraint failure, and
   shrinks each bundle by ~0.4 GB+. There is no argument for shipping a CC-BY-NC
   research weight you never call. *This is the cheapest risk-elimination in the suite.*

2. **N1 — fix the 3 systematic-verdict bugs, then GATE THE SCALAR.** The per-channel
   AAC fix is trivial (`encoded_preview.py` — take per-channel max, not `y.mean`).
   ViSQOL → 48 kHz audio mode. Sentinels → never render `-70 LUFS / 0.0 LRA` as a
   real number. But the *durable* hedge is Audit 2's 1% insight: replace every bare
   scalar with a tagged `{value, valid, reason, provenance}` type so an invalid
   measurement **cannot be emitted as a confident number.** This is the structural fix
   that prevents the *next* N1. Lock this into the plan, not just the three point-fixes.

3. **N4/N5 — you cannot ship a trust product on an unmeasured trust gate.** Before
   "ship," run the Audit-3 acceptance set (≥95% benign-EQ specificity, ≥90%
   real-artifact sensitivity) **and** a 50-file cross-platform parity harness asserting
   bit/dB-identical numbers across mac arm64/Intel/Win. If either is unknown at
   ship-time, you are *asserting* trustworthiness you have not *measured* — the same
   sin as N1, one level up. Pin soxr (not resample_poly) to kill N3 divergence.

4. **N2 — pull RTMprofile match-score from the paid surface entirely.** Ship it as
   "experimental / beta, unscored" or hold it. A near-random paid number is a bigger
   trust liability than the revenue it earns. Do not let a deadline force you to ship a
   metric that measures nothing.

5. **Hedge the GTM with N7.** The cert layer is already 70% built. Sequence:
   fix N1 → the *same fix* makes both the meter AND the cert trustworthy. Do **not**
   treat "ship the meter" and "the cert pivot" as a fork — they share one critical
   path (correct numbers). Ship the meter on fixed numbers now; the cert layer becomes
   a near-free upsell on the same corrected core, timed to the EU-AI-Act Aug-2026 gate
   alongside UAI.

---

## Division verdict contribution

**CONDITIONAL NO-SHIP.** The load-bearing number (customer-facing-number defect rate)
is not *at risk* of being wrong — it is *already* wrong, in at least three
systematic, verdict-emitting places, in the exact product whose only value is being
right. You may not ship a paid trustworthy-meter that confidently certifies a clipping
master as clean. **Minimum bar to flip to SHIP:** (a) the 3 systematic-verdict bugs
fixed (N1) + scalar-certainty replaced with tagged measurement type; (b) the trust
gate *measured*, not assumed (N4 ≥95%/≥90%, N5 cross-platform parity proven);
(c) RTMprofile match-score pulled from paid surface (N2); (d) dead NC separator weights
deleted (N6). All four are cheap relative to the company-ending downside. Then ship the
meter and the cert layer together on one corrected core.

**Single highest-priority recommendation:** Fix the AAC mono-downmix verdict
(`encoded_preview.py:246/255/290`) *and* replace every bare-scalar metric with a tagged
`{value, valid, reason, provenance}` type before any paid release — the point-fix stops
today's lethal false-PASS; the type-fix stops the *next* one. This single structural
change is the difference between "a meter with a bug" and "a meter you can't trust,"
and it is the one thing that protects the company's only moat.
