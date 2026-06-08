# Launch Audit 05 — Head of Product / Product Strategist

**Target:** RTM Suite delivery-readiness (RTMcompare v8.4.0 + RTMsend + RTMprofile)
**Lens:** product vision → OKRs → quarterly sequencing → competitive landscape
**Date:** 2026-06-08
**Mode:** advisory, reports-only (no code run, no source modified)

> The three technical audits already ruled the bugs (correctness, DSP, ranked upgrades). I do **not** re-list them. My job is the *product* judgment they don't carry: what the product **is**, what it can truthfully **promise** at ship, the **order** to ship in, and where it **wins**. The 1% insight from Audit 2 (scalar-certainty) is not just a bug class — it is a **positioning decision**, and that's mine to rule on.

---

## 0. The one-sentence verdict

**The RTM Suite is shippable for paid delivery — but NOT as "the trustworthy delivery verdict" it currently claims to be.** Ship it as a **measurement & insight tool** (which it is, and is excellent at) with the pass/fail *certifications* gated behind the trust-foundation sprint. The gap between what it *measures* and what it *certifies* is the entire risk surface, and it is a product/positioning gap before it is an engineering one.

---

## 1. Product vision (what this actually is)

Three candidate identities are fighting inside one codebase, and the team has not picked one. That is the root cause of the scalar-certainty bug — **you cannot decide how confident a number should look until you've decided what business you're in.**

| Identity | Promise | Truth-bar required | Current readiness |
|---|---|---|---|
| **A. The Meter** | "See exactly what changed, in mastering-grade units." | Numbers correct *when valid*; show uncertainty honestly. | **~90% — ships now after #1–#4** |
| **B. The Adviser** | "Here's what to do about it." (EQ moves, tips) | Recommendations defensible; no advice on invalid data. | **~70% — sentinel-acting bugs are the gap** |
| **C. The Certifier** | "PASS/FAIL for Apple/Spotify/Atmos delivery." | Every binary verdict legally/commercially defensible. | **~40% — the AAC-ISP blocker lives here** |

The README sells **C** ("Ready-to-Deliver verdict", "Apple cancels delivery on `Feat.` vs `feat.`", Apple Digital Masters PASS, Atmos Preflight hard-checks) while the engine only earns **A**, mostly earns **B**, and demonstrably cannot back **C** today (AAC ISP mono-downmix certifies a clipping master as PASS — encoded_preview.py:246/255/290/297).

**Vision I recommend:** *"The neutral meter mastering engineers trust — and the only one that tells you when it doesn't know."* Lead with A, earn B, gate C. The honesty-about-uncertainty is the differentiator, not a limitation (see §4).

---

## 2. OKRs that ladder to the ship decision

**O1 — Every customer-facing number is either correct or visibly absent.**
- KR1: 0 in-band sentinels (-70 LUFS / 0.0 LRA) ever rendered as a real value or acted on (AnalysisView.tsx:2120). Convert to the tagged-measurement type `{value,valid,reason,provenance}`.
- KR2: 100% of binary delivery verdicts (AAC ISP, Atmos preflight, ADM) computed per-channel, not mono-downmix.
- KR3: ≥95% specificity on benign EQ, ≥90% sensitivity on real artifacts (Audit 3 gate) before any verdict ships un-disclaimed.

**O2 — No verdict the company cannot defend in front of a paying mastering engineer.**
- KR1: ViSQOL in audio (48k) mode, not 16k speech (comparator.py:1919), or pulled from the verdict path entirely.
- KR2: RTMprofile match-score is monotonic & discriminating (not the ~50/50 saturating cosine, engineer_profile.py:1005) **or** removed from the paid surface until it is.

**O3 — A clean checkout builds the shippable artifact.**
- KR1: The forked JUCE repaint fix is pinned/vendored, not gitignored. **Confirmed gap: `JUCE/` is in `.gitignore` (0 files tracked); CI "clones JUCE + ARA SDK").** A fresh CI build reintroduces the Pro Tools white-screen. This is a release-engineering ship-blocker for RTMsend independent of the audio bugs.

---

## 3. Quarterly sequencing — MUST-fix / DISCLOSE / DEFER

The audits gave the bug list. Here is the **product call** on each bucket — sequenced by *customer-trust blast radius*, not by code effort.

### MUST-FIX before any paid delivery (the "a wrong PASS is a refund + reputation hit" set)
1. **AAC ISP per-channel** (Audit 1 #1) — a false PASS on a clipping master is the single worst thing a *trust meter* can do. Trivial fix, infinite downside. Non-negotiable.
2. **Sentinels never acted on** (Audit 2) — advising "ease compression" off a -70 LUFS sentinel is the "disgust moment" that makes an engineer close the app forever. Product-fatal, not cosmetic.
3. **ViSQOL 48k or out of verdict** — shipping a *speech* model as a *music* quality score is a credibility landmine the day a customer notices.
4. **JUCE fork pinned** (O3) — RTMsend literally won't render on a clean build.
5. **RTMprofile match-score** — it's a **paid** surface returning noise. Either fix or **pull from the paid tier this quarter** (acceptable — it's a companion, not the core).

### DISCLOSE at ship (honest limitation, not a blocker — this is where most products lie and lose trust)
- **4× TP factor** is sufficient (Audit 3 confirms BS.1770-4 Annex 2). Disclose it; do not gold-plate to 8×.
- **mel-L1 is a spectral-difference, not a quality score** — rename in UI (Audit 1 HIGH). Relabel, don't rebuild.
- **Hosted-plugin real-time risk** (RTMsend) — document the "don't run on a live mix bus" caveat.
- **Atmos LRA on mono sum / per-channel ISP gaps** — scope the Atmos verdict to "advisory" until per-channel lands.

### DEFER post-launch (real, but not trust-fatal)
- soxr-vs-resample_poly 0.3–0.5 dB install divergence (pin one resampler; disclose tolerance).
- 4.5 GB dead ML weights — ship-bloat, not correctness. Strip in a fast-follow to cut the 600 MB→leaner download (a *conversion* win, not a blocker).
- ARA recycled-pointer, detached-worker-on-shutdown — RTMsend hardening, second release.

**The cut line:** anything that can render a *confident wrong PASS to a paying customer* is MUST-FIX. Everything that's *imprecise-but-honest* is DISCLOSE. Everything *internal/cosmetic* is DEFER. That rule is the whole sequencing logic and it falls straight out of the vision in §1.

---

## 4. Competitive landscape — where this wins

The competitor profiles in-repo (acrcloud, audible-magic, pex-vobile, ircam-amplify, landr, c2pa-truepic, deezer/beatdapp AI-detection) cluster into two worlds, and reveal the real white space:

- **Generative masterers (LANDR, RoEx):** they *change* your audio. They have a **structural conflict of interest** — they cannot neutrally grade a master because they sell the master. RTM's neutrality is a moat they *cannot* copy without cannibalizing their core. **This is the positioning wedge: "the grader that has no horse in the race."**
- **Content-ID / provenance (Audible Magic, Pex, C2PA/Truepic):** adjacent, not competing — they answer *"is this AI / whose is it"*, not *"is this delivery-clean."*

**Where RTM wins today (Identity A/B):** there is no on-device, neutral, mastering-grade A/B + single-file QC tool that also reconciles the distributor manifest (DMR is genuinely differentiated — the `Feat.`/`feat.` Apple-rejection catch is a real, specific, painful job-to-be-done). Sold to engineers/labels, on-device, license-clean (Audit 3 confirms PEAQ/Wav2Vec2 correctly avoided). **This is a defensible paid product the moment the verdicts stop lying.**

**The moonshot (Audit 2's pivot) — my GTM call: SEQUENCE it, don't choose it.**
The "RTM Verify — Stripe for audio delivery compliance" certification layer (MCP-wrap RpcServer, C2PA-signed certs, bundle with UAI for the EU AI Act Aug-2 2026 gate) is the **right Q3/Q4 bet** — but it is *Identity C at enterprise scale*, and **C is exactly the identity the engine can't back yet.** You cannot sell "Stripe for compliance certs" on a verdict engine that mono-downmixes ISP. The pivot is **earned by** the trust-foundation sprint, not an alternative to it. The sprint is the on-ramp to the moonshot, so there is no fork in the road — same first move either way.

**GTM recommendation:** **Ship the meter now (post #1–#5), fix in the open, and let the trust-foundation work double as the certification-layer foundation.** The Aug-2-2026 EU AI Act date is a real catalyst for the C2PA-signed-cert pivot and aligns with sister-product UAI — but chasing it before the verdicts are honest would ship a *compliance* product that is itself non-compliant with its own claims. Worst possible launch.

---

## 5. Single biggest risk to the company if we ship as-is

**A respected mastering engineer catches one confidently-wrong PASS — and says so publicly.**

This product's *entire* equity is "trustworthy meter." That equity is **binary and non-recoverable**: the first screenshot of "RTMcompare PASSED a clipping master / told me to decompress a 2-second sentinel clip / scored my mix with a speech model" on a pro audio forum doesn't dent the product — it **ends the category position** and **contaminates the sister product (UAI) and the company name**, because RTM Audio is selling *measurement trust* across the whole portfolio. The fix cost for blocker #1 is one line (per-channel max). The reputational cost of shipping without it is the company's only real asset. **That asymmetry is the entire ship decision.**

---

## 6. My division's verdict contribution

**CONDITIONAL SHIP.** Greenlight RTMcompare as **The Meter (+Adviser)** after MUST-FIX #1–#5; ship the **Certifier** verdicts disclaimed-as-advisory until the Audit-3 spec/sensitivity gate passes. Hold RTMsend's clean-build release until the JUCE fork is pinned (O3). Treat the trust-foundation sprint as the funded **first phase of the certification-layer pivot**, timed to the EU AI Act Aug-2-2026 catalyst — not a separate decision.

**Highest-priority recommendation:** Before anything else, **convert every customer-facing metric to the tagged `{value, valid, reason, provenance}` type and make "invalid → absent/greyed, never a confident scalar" a hard product invariant.** This single product decision simultaneously kills the worst bug class (sentinel-acting + mono-downmix PASS, encoded_preview.py:246/255/290/297, AnalysisView.tsx:2120), establishes the honesty-about-uncertainty that is the product's *only* durable differentiator vs LANDR/RoEx, and is the literal data structure the C2PA-signed certification layer will serialize. It is the one move that pays off in all three identities at once.
