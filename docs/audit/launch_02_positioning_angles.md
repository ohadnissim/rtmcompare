# Launch Audit 02 — Positioning Angles (Angle Finder lens)

**Persona:** Find the ANGLE that makes the RTM Suite sell, before any copy is written. Match angle to buyer psychology + competitive position + awareness stage. ADD net-new judgment to the three technical audits — do not re-derive bugs.

**Scope reminder:** REPORTS mode. No code run, no source modified. Advisory only.

---

## POSITIONING ANGLE ANALYSIS

### Context
- **Offer:** RTMcompare — on-device, mastering-grade measurement / A-B compare / delivery-QC tool. Sold to mastering engineers, mixing engineers, labels.
- **Audience:** Technical + Premium B2B. Mastering engineers are the most skeptical, proof-driven buyers in audio. Labels buy on delivery-risk avoidance.
- **Differentiator (real, defensible):** It is a **neutral meter that does not touch the audio.** Every generative competitor (LANDR, RoEx) structurally cannot make this claim — their business model is to change your master. RTM grades; it does not master. Audit 2's moat insight is also the positioning spine.
- **Alternatives they'd consider:** LANDR / RoEx (generative "AI mastering"), iZotope Insight / Youlean (meters), DDP/delivery checkers, "trust my own ears + a borrowed reference master," IRCAM Amplify / Audible Magic (adjacent, detection not delivery).

---

### THE CRITICAL POSITIONING CONSTRAINT (net-new judgment the lens surfaces)

**The angle and the ship-decision are the same decision.** This is the single insight my lens adds that the three technical audits could not:

The ONLY differentiated, defensible, category-cutting angle for this product is **TRUST** — "the meter that is right when nothing else is." Every other angle (speed, breadth of features, Atmos, the DAW-send loop) is a feature-list angle that LANDR/iZotope can match or out-spend.

But Audit 1's SHIP-BLOCKER (AAC ISP verdict on mono downmix → certifies a clipping master as PASS, `encoded_preview.py:246/255/290/297`) and Audit 2's scalar-certainty findings (in-band sentinels rendered as confident real numbers and **acted on**, `AnalysisView.tsx:2120`; ViSQOL in 16 kHz speech mode for a music tool, `comparator.py:1919`; constant PAID match-score, `engineer_profile.py:1005`) mean **the product cannot currently substantiate the only angle that sells it.**

You cannot lead with "the meter you can trust" while a hard-panned clipping master gets a confident green PASS. The first mastering engineer who catches one wrong number on a master they KNOW is clipping will not file a bug — they will tell the other 200 engineers in their Discord, and the trust angle is dead permanently. In this category, **a single public wrong number is a brand-extinction event**, because the entire premise is "trust the number, not your gut." There is no recovery copy for that.

**Verdict contribution from this lens: NO-SHIP as-is — not on engineering grounds (others covered that) but on POSITIONING grounds.** The product's only winning angle is structurally unavailable until the customer-facing numbers are true. Shipping now spends the trust angle — the one asset competitors can't copy — on a product that can't yet honor it.

---

### Recommended Angles (once trust-foundation sprint lands)

#### Primary: #13 The Truth About [X]  +  #8 Us vs Them
**Why:** Technical/Premium buyers reject benefit-puffery and respond to insider truth + a common enemy. The enemy writes itself: **generative "AI mastering" that silently changes your record.** RTM is the neutral grader that refuses to touch the audio. This is the only positioning a generative competitor cannot copy without abandoning their revenue model.
**Headline:** "Every other tool wants to change your master. This one just tells you the truth about it."
**Opening line:** "AI mastering services have a conflict of interest: they get paid to alter your audio. A meter shouldn't have an opinion — it should have a number you can stake your name on."

#### Secondary: #22 What You Don't Know (Fear/Risk) — for the LABEL buyer
**Why:** Labels don't buy meters; they buy **delivery-rejection insurance.** The Delivery Manifest Reconciler (Apple cancels on `Feat.` vs `feat.`, ISRC reuse, P-line mismatch) is a fear-angle goldmine. This is the B2B/SLA wedge RTM-the-company should sell on.
**Headline:** "The metadata drift that gets your release silently rejected by Apple — caught before you upload, not after."
**Opening line:** "A distributor doesn't tell you why the delivery bounced. RTM does, before you hit send."

#### Contrarian Option: #23 WRONG — high risk, only deploy AFTER numbers are bulletproof
**Why:** Highest cut-through with the technical tribe, but it stakes the whole brand on being right. Do NOT run this angle until the trust-foundation sprint closes — a contrarian "everyone else is wrong" claim from a product with a known false-PASS bug is suicidal.
**Headline:** "Stop trusting AI mastering. It's confident, fast, and quietly wrong — and it can't show its work."
**Opening line:** "Confidence is not accuracy. A meter that can't tell you when it doesn't know is just a prettier guess."

### Angle Combo to Lead With
**#13 Truth + #8 Us vs Them**, with #22 Fear as the label-facing variant:
> "Mastering tools sell you change. We sell you certainty. The neutral meter that tells you the truth about your master — and tells you when it isn't sure."

The clause **"and tells you when it isn't sure"** is the copy embodiment of Audit 2's tagged-measurement-type fix `{value, valid, reason, provenance}`. **The product change and the positioning are literally the same move** — confidence intervals + sentinel-suppression are not just bug fixes, they are the proof asset that makes the trust angle credible. Build the honesty INTO the meter and the headline writes itself.

---

### Answers to the four board questions (positioning lens only)

1. **Shippable for paid?** Not under the trust angle — the only angle that wins this category. Minimum bar to unlock the angle = Audit 1 #1–#4 fixed + Audit 2 scalar-certainty refactor + the ≥95% specificity / ≥90% sensitivity gate from Audit 3. Until then any launch must use the weaker, copyable feature-angle and forfeits the moat.
2. **Sequence:** The trust-foundation sprint is a PRE-LAUNCH MARKETING prerequisite, not a post-launch fix. Disclosing the 3 fundamentals (4× TP, hosted-plugin RT risk, mel-L1 ≠ quality) is on-brand IF reframed as "here's exactly what we measure and what we don't" — honesty-as-feature, not a footnote of shame.
3. **GTM:** Ship the METER first under the Truth angle to engineers; the certification-layer pivot ("RTM Verify — Stripe for delivery compliance," Audit 2 moonshot) is the SAME trust angle scaled to a B2B/SLA buyer. Do not split the brand — Verify is the enterprise expression of the identical "neutral grader" positioning. The label-facing #22 fear angle is the natural bridge between them.
4. **Single biggest risk if shipped as-is:** **Permanent destruction of the trust angle** — the one asset LANDR/RoEx structurally cannot replicate. One screenshot of a confident green PASS on an audibly-clipping hard-panned master, posted by a respected engineer, converts your sole moat into your defining liability. The downside is not a refund; it is that the word "RTM" becomes the cautionary tale that sells the competitor.

---

### My single highest-priority recommendation
**Do not launch any TRUST-based message until the customer-facing numbers cannot be caught lying.** Fix Audit 1 #1 (mono-downmix AAC PASS) and Audit 2's acted-on sentinels FIRST, then ship the meter on the #13-Truth + #8-Us-vs-Them combo — because in this category the positioning angle and the product correctness are not two decisions. They are one.
