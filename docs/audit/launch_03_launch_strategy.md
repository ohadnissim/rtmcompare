# Launch 03 — Launch Strategist (lens: `launch-strategy`)

**Role:** sequence the go-to-market to de-risk; pick the channel mix (Owned /
Rented / Borrowed) that fits the audience; define phase gates and the one
success metric.

**Scope of this report:** I do NOT re-list bugs (Audits 1–3 own that) or
re-derive the ship/no-ship technical bar (decision/engineering divisions own
that). I add only the net-new judgment my lens provides: **how to phase and
channel the launch so that the trust-class bugs cannot detonate in a public,
irreversible way — and how the bug profile dictates the launch motion, not the
other way around.**

---

## 0. The launch-specific reframe

Every other division asked "is it shippable?" The launch question is different:
**"who is allowed to see a wrong number first, and through which channel?"**

The fatal failures (Audit 2's "scalar-certainty"; decision-division's
"reversibility-of-trust" axis) are all *silent confident wrong customer-facing
verdicts*. A launch is precisely the act of maximizing how many strangers see
those verdicts at once, with our name on them, in public, where we cannot
intervene. **A loud, broad, Product-Hunt-style "full launch" is the single worst
delivery vehicle for a product with lie-class bugs**, because PH/HN/social
amplify the one failure mode that is irreversible. The launch motion must
therefore be inverted from the default SaaS playbook: **stay narrow and
recoverable until the lie-class is closed and field-verified, precisely because
this category's failure is reputational and public, not silent and private.**

This is the launch lens's core contribution: the GTM sequence is not a marketing
preference here — it is a *risk-containment instrument*. Phasing is how we make a
trust-error reversible while the fixes land.

---

## 1. Where the launch assets actually stand (grounded)

- **Builds exist and are real:** `release/RTMcompare-bundle-8.4.0-arm64.dmg`,
  `-intel.dmg`, `-win.zip` all present with `.sha256` siblings. Cross-platform
  distribution (a HARD CONSTRAINT) is *materially started* — arm64 + Intel +
  Windows artifacts ship today; Linux is "experimental" (README:59). This is
  further along than most pre-launch products.
- **Promo is half-built:** `commercial-clips/` holds 10 cut videos (15/30/59s,
  IG feed 1:1, IG story 9:16) — launch creative is largely done. But `promo/` is
  empty and there is **no landing page, no waitlist, no email-capture, no
  Product-Hunt listing asset** anywhere in tree. ORB-Owned infrastructure does
  not exist yet.
- **Competitive intel is strong:** `competitor-profiles/` profiles LANDR, IRCAM
  Amplify, C2PA/Truepic, Audible Magic, Deezer/Beatdapp, etc. — the positioning
  raw material for "neutral grader vs generative competitor" is already written.
- **Version drift is a launch-hygiene red flag:** `package.json` = 8.4.0, but
  `README.md:108` says "RTMcompare 5.7.0" and `CHANGELOG.md` top entry is 5.7.0.
  The customer-facing surfaces disagree with the build by three major versions.
  **This must be reconciled before any external eyes** — a meter that can't keep
  its own version straight undercuts the "trust the number" promise on contact.

---

## 2. The phased launch plan (5-phase, with hard exit gates)

The default 5-phase ramp is correct *but the gates are redefined around the
trust bar*. Each gate is a kill-switch, not a checkbox.

### Phase 0 — Reconcile & arm (pre-anything, days)
- Reconcile version strings (README/CHANGELOG → 8.4.0).
- Stand up ONE owned channel: a landing page with email capture. Nothing else.
- **EXIT GATE:** customer-facing surfaces self-consistent; email capture live.

### Phase 1 — Internal / design-partner (closed, hand-picked)
- 5–10 mastering engineers RTM already knows, 1:1, **free, under NDA-lite "you're
  testing a pre-release meter" framing**. Superhuman model: every tester gets a
  live walkthrough — which also lets us *watch them act on a verdict* and catch
  any lie-class survivor before a stranger does.
- **EXIT GATE (hard, non-negotiable):** the decision-division MUST-FIX lie-class
  (AAC per-channel ISP, sentinel guard, ViSQOL 48 kHz, RTMprofile match-score
  fixed-or-pulled, mel rename) is **closed AND field-confirmed** on these
  partners' real hard-panned masters. The dsp-research pre-ship gate (≥95%
  specificity on benign EQ, ≥90% sensitivity on real artifacts) is met. **No
  external phase begins until this gate passes.** This is the launch's load-
  bearing gate.

### Phase 2 — Alpha (controlled external, invite-only)
- Invite from the waitlist individually, **paid at a launch price**, throttled
  (Audit's Option A: 5–10% batches). Keep it small enough that any residual
  issue is an email, not a forum thread.
- RTMsend ships here ONLY as an explicitly-labelled separate "beta" track/SKU
  (per decision-division §4 + engineering: JUCE white-screen fix unverifiable
  until forked module is confirmed committed/pinned). RTMsend's crashes are
  reversible; do not let them ride on RTMcompare's reputation.
- **EXIT GATE:** zero trust-class incidents across the alpha cohort; refund/
  complaint rate on *verdicts* (not UX) at zero; NPS or qualitative "do you trust
  the number" check positive.

### Phase 3 — Beta / early-access (open waitlist, still gated entry)
- Open the waitlist publicly, leak screenshots/the existing IG clips, recruit a
  few named engineers/labels to vouch. Begin borrowed-channel outreach (§3).
- Keep entry gated (early-access framing) so growth never outruns our ability to
  intervene on an incident.
- **EXIT GATE:** ≥4 weeks of field use with no trust-class incident; ≥1 credible
  third-party engineer publicly willing to say "the numbers match my ears."

### Phase 4 — Full launch (the loud moment)
- ONLY here do Product Hunt / HN / broad social fire. The all-day-engagement PH
  playbook applies — but it is deliberately the *last* gate, because this is the
  step that makes any surviving lie-class bug irreversible and public.
- **SUCCESS METRIC (the one that matters):** see §5.

**Why this ordering, in one line:** the launch funnel is run *backwards from the
blast radius* — narrowest/most-recoverable audience while the product can still
lie, widest/least-recoverable audience only after it provably can't.

---

## 3. The ORB channel plan

### Owned (build first — currently missing, the biggest GTM gap)
- **Email list + landing page** — the only Phase-0 deliverable. Every other
  channel funnels here. This is RTM's missing foundation; the product is built,
  the audience pipe is not.
- **Changelog as a product** — a meter's credibility compounds with a visible,
  honest "what we measure and what we don't" log. Use it to disclose the
  fundamentals (4× TP factor, mel = spectral_difference not quality, RTMsend
  beta) *as a feature of trustworthiness*, not a footnote. Disclosure is owned-
  channel content here, not a liability.

### Rented (pick 2, funnel to owned)
- **YouTube + Instagram/Reels** — the `commercial-clips/` assets are already cut
  for exactly these (1:1 feed, 9:16 story). Mastering engineers watch gear/
  technique video; a "watch RTMcompare catch a clip Apple would've rejected" demo
  is the natural hook — *once the AAC verdict is actually correct*. Do NOT run
  this creative until Phase-1 gate passes; a demo that shows a now-known-wrong
  verdict is a public liability.
- **Reddit (r/audioengineering, r/masteringtheoryandtutorials)** + relevant
  Gearspace/forum presence — value-first, the Notion model, funneling to the
  waitlist. This audience is small, expert, and merciless — ideal Phase-3 buzz,
  fatal if hit in Phase-2.

### Borrowed (highest leverage for this audience)
- **Named mastering engineers / label QC leads** — the TRMNL model: put the tool
  in 2–3 respected engineers' hands free, let an honest review carry it. For a
  trust product, third-party "it matches my ears" is worth more than any owned
  claim. Begin in Phase 1 (as design partners), convert to public voices in
  Phase 3.
- **Distributor / delivery-spec ecosystem** (the DDEX/Apple-Digital-Masters
  world the Delivery Manifest Reconciler already speaks to) — borrowed
  credibility that ladders directly into the certification-layer pivot. Seed now,
  harvest post-launch.

---

## 4. Launch-day checklist (Phase-4 gate)

- [ ] Version strings reconciled everywhere (8.4.0).
- [ ] Lie-class fixes closed + field-confirmed (Phase-1 gate, weeks prior).
- [ ] Landing page + email capture live and load-tested.
- [ ] Disclosure page published (4× TP / mel rename / RTMsend beta) — framed as
      trust, not apology.
- [ ] `commercial-clips/` demo re-verified against the *fixed* engine (no clip
      shows a verdict we've since corrected).
- [ ] RTMsend on its own beta track/SKU; JUCE forked module confirmed
      committed/pinned (else RTMsend does not launch — RTMcompare still does).
- [ ] 2–3 borrowed-channel reviews/quotes lined up to publish on the day.
- [ ] PH listing + first-comment + team on all-day support.
- [ ] Incident playbook: a single named owner empowered to pull a build / post a
      correction within the hour if a trust-class report surfaces.

---

## 5. The one metric that defines launch success

Not signups, not PH rank, not revenue. For a trust product the only launch
success metric that matters is:

> **Trust-class incident count = 0** — zero public reports of "RTMcompare gave
> me a confident verdict that was wrong" across the full ramp.

Vanity metrics are recoverable; a single viral "RTM certified my master and it
clipped on Apple" thread (decision-division §3, the AAC PASS path,
`encoded_preview.py:297`) is not. Track signups/conversion as health, but the
*gate* metric — the one that can halt the launch — is trust-incident count.

---

## 6. Answers to the four board questions (launch lens)

1. **Shippable for paid delivery, minimum bar?** Yes — but the launch-lens bar
   adds a *motion* constraint on top of the code bar: shippable to a **narrow,
   recoverable, invite-only paid alpha** the moment the lie-class closes; NOT
   shippable to a broad public launch until that fix is field-confirmed across
   real masters. The build/distribution side is genuinely ready (8.4.0 arm64/
   intel/win exist); the *owned-channel* side (landing/email/waitlist) does not
   exist and is the gating GTM work.
2. **Sequence:** Phase 0 (reconcile + stand up email) → Phase 1 closed design-
   partners behind the hard lie-class gate → Phase 2 throttled paid alpha →
   Phase 3 gated early-access + borrowed-channel buzz → Phase 4 loud PH/HN
   launch. **The loud launch is last by design, because amplification is what
   makes a trust error irreversible.** RTMsend runs as a parallel, explicitly-
   beta track and never gates the meter's dates.
3. **GTM — ship now or hold for the pivot?** Ship the honest meter on this phased
   ramp; do **not** hold the launch for the certification-layer pivot. The pivot
   (RTM Verify / C2PA / EU-AI-Act-with-UAI) is built *on top of* a shipped-and-
   trusted meter and the distributor/DDEX borrowed channels seeded during this
   launch — holding for it trades a reversible timing choice for the irreversible
   risk of launching the meter loud-and-broken. Phase the launch; pursue the
   pivot in parallel via the borrowed-channel ladder.
4. **Single biggest launch risk if we ship as-is:** running the **default broad/
   loud launch motion (PH/HN/social all at once) before the lie-class is
   field-closed** — that motion takes the one irreversible failure (a public
   "RTM certified a clipping master") and maximizes its blast radius on day one,
   destroying the trust that is both the moat and the precondition for the pivot.
   The launch lens's mitigation is structural: invert the funnel, gate hard at
   Phase 1, keep the loud moment last.

---

*Advisory only. The final ship/no-ship and launch-timing call is the human's.
My division's contribution: the GTM sequence is a risk-containment instrument
here — phase the launch backwards from blast radius, gate the first external
phase on the lie-class being field-closed, and keep Product Hunt last.*
