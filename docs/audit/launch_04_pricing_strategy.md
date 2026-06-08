# Launch 04 — Pricing & Packaging Verdict (RTM Suite)

**Lens:** value metric, tier structure, willingness-to-pay (WTP), monetization risk.
**Scope:** Ship/no-ship contribution from the pricing-and-packaging seat only. I do not re-list the technical bugs in Audits 1-3; I rule on what each bug does to *monetizable value* and how packaging should sequence the fix.
**Date:** 2026-06-08

---

## 1. The division verdict in one line

**Conditional GO — but the load-bearing pricing problem is that RTM is currently packaged to charge for the one thing that is broken (the verdict), and to give away the things that already work (the meters).** Fix the packaging-value mismatch before the first paid invoice, not the code first.

---

## 2. Net-new judgment: which bugs are *pricing* bugs, not engineering bugs

The three audits ranked bugs by correctness severity. The pricing seat ranks them by **proximity to the thing the customer is paying for.** Those orderings are *not* the same, and that gap is the net-new finding.

| Audit-flagged issue | Eng severity | **What value-tier does it sit in?** | Pricing severity |
|---|---|---|---|
| AAC ISP PASS/FAIL on mono downmix (`encoded_preview.py:246/255/290/297`) | CRITICAL | **The certification tier — the premium SKU's entire reason to exist** | **FATAL.** This is not "a bug in a feature." It is a defect in the *value metric itself.* |
| ViSQOL in 16kHz speech mode (`comparator.py:1919`) | CRITICAL | Perceptual-quality readout (a headline differentiator) | HIGH — degrades a tentpole, but not the one you bill the cert on |
| In-band sentinels rendered as real advice (`AnalysisView.tsx:2120`) | CRITICAL | Trust surface across ALL tiers | HIGH — erodes the brand that lets you charge a premium at all |
| RTMprofile match-score is ~constant (`engineer_profile.py:1005`) | CRITICAL | RTMprofile = a paid SKU whose core number is non-functional | **FATAL for that SKU only.** Do not sell RTMprofile as a standalone paid unit until fixed. |
| mel-L1 "quality/degradation" mislabel (`comparator.py:693-743`) | HIGH | A free-tier meter | MEDIUM — rename, don't gate revenue on it |

**The insight the audits imply but don't state in pricing terms:** RTM's value ladder is *inverted relative to its bug distribution.* The free/cheap things (BS.1770-4 loudness core — audited SOLID) are correct. The premium, differentiated, charge-a-multiple things (the Apple Digital Masters PASS/FAIL cert, the perceptual ViSQOL score, the engineer fingerprint) are exactly the ones carrying the CRITICAL defects. **You cannot price a premium on a broken premium.** This is why "ship the meter, fix later" (board Q3) is viable and "ship the cert, fix later" is not — they live in different tiers.

---

## 3. The value metric

**Recommended primary value metric: the trustworthy delivery PASS/FAIL certificate (per-master, or per-seat for the meter).**

WTP reasoning grounded in the competitor table (`competitor-profiles/_summary.md:266`, lines 49-58):

- **Pure meters** (Insight 2 now FREE; VisLM $449; MasterCheck $249; Reference 3 $79; WLM sub $15-25/mo) — this is a **commoditized, race-to-free** category. iZotope making Insight 2 free permanently is the tell: the meter alone has a collapsing price floor. **If RTM's value metric is "a meter," its ceiling is ~$79-249 perpetual and falling.** That does not support a company.
- **The certification/verdict** is the only thing in the landscape with a *rising* WTP, because it is tied to a liability transfer ("RTM says this master passes Apple Digital Masters"), not to a measurement. Liability-transfer products price 5-20x above measurement products. authio's €12→€2,399/mo ladder (line 57) is the proof that a *defensible verdict* tiers far higher than a readout.

**Therefore the value metric must be the verdict — which is exactly the surface that is currently wrong (§2).** That is the whole tension. The fix to bug #1 is "trivial (per-channel max)" per Audit 1; the *pricing* consequence of not fixing it is that you have no premium tier to sell.

**Do NOT charge on a usage/per-analysis metric yet.** On-device, no telemetry, perpetual-desktop posture (Compare.md confirms local Electron + bundled Python) makes per-analysis metering un-enforceable and un-measurable without building license infrastructure you don't have. Per-seat perpetual + annual maintenance is the only enforceable metric for the desktop product today.

---

## 4. Recommended tier structure

Built to quarantine the broken-but-fixable premium from the solid free core, and to match buyer personas already in the codebase (`AudienceContext.tsx`: pro / producer / student / teacher).

| Tier | Price (anchor) | Value metric | In | Out |
|---|---|---|---|---|
| **RTM Meter** (Good) | **Free or $0–49** | Per seat | BS.1770-4 loudness/TP/LRA core (audited SOLID), A/B compare, spectral_difference readout (renamed mel-L1) | Any PASS/FAIL verdict; cert; ViSQOL |
| **RTM Pro** (Better — anchor) | **$149–199 perpetual + ~$59/yr** | Per seat | Everything in Meter + correct ViSQOL music-mode score + multi-platform penalty grid + QC artifact detection | Signed certificate; RTMprofile fingerprint |
| **RTM Verify** (Best) | **$399+ perpetual, or $29–49/mo, or B2B/SLA seat** | Per certified delivery / per seat | The **certified** Apple-Digital-Masters / streaming-delivery PASS/FAIL with per-channel ISP, provenance, and (later) C2PA signature | — |
| **RTMprofile** | **Bundle into Pro as beta, NOT a paid SKU** | — | Engineer fingerprint as a labelled "experimental" feature | Standalone paid status until `engineer_profile.py:1005` is fixed |

**Key packaging moves (net-new):**
1. **Demote, don't delete, the broken premium features.** Ship ViSQOL/cert/fingerprint as visible-but-gated "RTM Verify (preview)" so the GTM narrative and upsell path exist on day one — but no money changes hands against a wrong number until the fix lands. This preserves the anchor (board Q1's "minimum bar") without violating the hard accuracy constraint.
2. **RTMprofile must not be a standalone paid SKU now.** A paid product whose headline match-score is effectively constant (`engineer_profile.py:1005`) is a refund-and-chargeback magnet. Fold it into Pro as labelled-beta; it adds perceived depth without carrying a price tag it can't honor.
3. **Sentinels (-70 LUFS / 0.0 LRA acted on as advice, `AnalysisView.tsx:2120`) are a cross-tier trust tax.** Trust is the multiplier on *every* price point. Fixing the tagged-measurement-type pattern (Audit 2's `{value,valid,reason,provenance}`) is not a feature — it is the precondition for charging a premium at all. Sequence it with bug #1.

---

## 5. Answers to the board's pricing-relevant questions

**Q1 — Shippable for PAID, and minimum bar?**
YES for the **Meter/Pro tiers**, under this bar: (a) bug #1 fixed OR the cert tier shipped as un-priced "preview"; (b) sentinels suppressed (no confident fake numbers on any paid surface); (c) mel-L1 renamed `spectral_difference`; (d) RTMprofile not sold standalone. **NO for the Verify/cert tier as a paid unit until bug #1 + ViSQOL 48k land** — you may not invoice against a certificate you know under-reads ~6dB on hard-panned transients.

**Q2 — Sequence (pricing view):**
MUST-fix-before-any-paid: bug #1 (or gate the tier), sentinels, RTMprofile-not-standalone. DISCLOSE: 4x TP factor, hosted-plugin RT risk, "spectral_difference is not a quality score." DEFER-post-launch: ViSQOL 48k (gate the score until then), batch mode, Leq(m). The ordering principle: **fix in descending order of price-tag proximity, not descending order of CVSS.**

**Q3 — Ship-now vs hold-for-cert-pivot:**
**Ship the Meter/Pro now; hold the cert as the paid Verify tier and run the certification-layer pivot in parallel as the B2B/SLA track.** RTM is a company — it can run both. The meter funds runway and seeds the install base; "RTM Verify" (Audit 2's Stripe-for-delivery-compliance) is the high-WTP, liability-transfer SKU and the only path off the commoditizing-meter price floor. Do NOT block the self-serve meter on the enterprise cert. The EU-AI-Act Aug-2026 window (UAI bundle) is the demand trigger for Verify, not for the meter.

**Q4 — Single biggest pricing risk if shipped as-is:**
**A paying customer ships a clipping master that RTM certified as PASS (bug #1), traces the failure to your meter, and the public failure mode of a "trustworthy meter" company is total — it collapses WTP across the entire ladder, including the meters that are correct.** In pricing terms: one false PASS doesn't cost one refund, it resets your whole price ceiling to the free-meter floor, permanently. The asymmetry (trivial fix vs. brand-fatal exposure) makes shipping the *priced* cert as-is indefensible.

---

## 6. Monetization risks (cannibalization / anchoring / churn)

- **Anchoring risk:** with Insight 2 now free (`_summary.md:276`), if RTM anchors as "a better meter," buyers anchor to $0. **Anchor on the verdict/cert, show the meter as the free on-ramp** — this reframes the entire price conversation off the commodity axis.
- **Cannibalization:** a too-generous free Meter eats Pro. Mitigate by gating ViSQOL + penalty grid + QC artifacts to Pro; the free tier is compliance-numbers-only.
- **Churn / refund risk:** the dominant churn driver here is **trust-break, not feature-gap.** A single visibly-wrong number (sentinel advice, constant match-score, false PASS) drives chargebacks faster than any missing feature. Pricing health is downstream of the §2 fixes.
- **Subscription resistance:** the mastering-engineer persona is perpetual-license-loyal and openly hostile to subs (Waves-sub backlash, `_summary.md:317` "$449 is expensive for a meter"). **Desktop = perpetual + annual maintenance. Reserve subscription/usage pricing for RTM Verify B2B/API only,** where buyers (distributors, collecting societies) expect it.

---

## 7. Highest-priority pricing recommendation

**Gate the Apple-Digital-Masters PASS/FAIL certificate behind a separate, initially-UN-PRICED "RTM Verify (preview)" tier, and ship the correct BS.1770-4 Meter/Pro tiers for money now.** This lets you (a) honor the non-negotiable accuracy constraint without holding the whole suite hostage to one fix, (b) keep the high-WTP anchor visible for the GTM story and the parallel cert-pivot, and (c) escape the collapsing free-meter price floor — all while ensuring no customer ever pays against the ~6dB-wrong verdict until `encoded_preview.py` ships per-channel ISP.
