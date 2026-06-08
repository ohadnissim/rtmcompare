# Decision 02 — The Hard Call

**Lens:** hard-call. Name the *real* decision (not the one on the table), map
irreversibility, apply 10/10/10, separate reversible from irreversible cost.
This report does NOT re-list the bugs (Audits 1–3 own that). It adds only the
net-new judgment my lens provides: **which mistake here is one you cannot take
back**, and how that reframes the ship/no-ship question.

---

## 1. The actual decision being made

The board framed this as *"Is RTMcompare shippable for paid delivery?"* That is
not the real decision. The real decision is:

> **Are we willing to put RTM Audio's name on a number that is sometimes
> confidently wrong, in a product whose only reason to exist is that its numbers
> are trustworthy?**

Everything else (sequence, GTM, pivot) is downstream of that one question. The
product is not a DAW plugin where a bad sound is the user's fault to catch —
it is a *meter sold to people who use it precisely because they cannot hear the
thing it measures*. The customer's entire transaction is: *"I trust this readout
more than my own ears on inter-sample peaks / codec behaviour / loudness."* That
trust is the asset. It is also the only asset a generative competitor
(LANDR, RoEx) structurally cannot clone — Audit 2's moat insight is correct and
it is the *same* asset the bugs threaten. So the bugs do not just risk a refund;
they attack the one thing the company is selling.

That reframes "shippable" entirely. The bar is not "does it mostly work." The
bar is **"can a customer be confidently misled by a customer-facing verdict?"**
On that bar, today, the answer is yes — and I confirmed it in the source, not
just the audit.

## 2. The irreversible-vs-reversible map (the part only this lens adds)

The three audits ranked bugs by *severity*. Severity is the wrong axis for a
ship decision. The right axis is **reversibility of the damage to trust**.

| Failure | Severity (audits) | **Reversibility of the TRUST damage** |
|---|---|---|
| AAC ISP verdict on mono downmix → certifies a clipping master as PASS (`encoded_preview.py:246,255,290,297` — confirmed: pre & post TP both on `mean(axis=1)`, binary `'pass'/'fail'` at :297) | CRITICAL | **IRREVERSIBLE.** A customer ships a hard-panned master we stamped "Apple Digital Masters PASS," it clips on Apple's encoder, the *label/distributor* rejects it or it ships audibly broken. The engineer's reputation took the hit on our word. You do not win that customer back, and they tell the room. |
| Sentinels (−70 LUFS / 0.0 LRA) rendered as real numbers and *acted on* — advises easing compression on a 2s clip (`AnalysisView.tsx:2120`) | CRITICAL | **IRREVERSIBLE per incident.** Same shape: confident, wrong, acted-upon advice with the RTM name on it. |
| RTMprofile match-score effectively constant (~50/50) (`engineer_profile.py:1005`) | CRITICAL | **Reversible-ish but corrosive.** A paid feature that returns noise dressed as signal. Caught late, it reads as fraud, not a bug. |
| ViSQOL in 16 kHz speech mode for music (`comparator.py:1919`) | CRITICAL | Reversible (config fix), but every score emitted until then is quietly wrong. |
| mel-L1 "quality/degradation" label trips on benign EQ | HIGH | Reversible — it's a *label*, fix is a rename + per-band median. |
| RTMsend RT-safety / data races / ARA recycled-pointer | HIGH/MED | Reversible as *crashes* (visible, blamed on "beta plugin"), NOT as silent wrong audio. Different risk class — see §4. |

**The pattern my lens surfaces:** the company-ending failures are not the
crashes. They are the *silent, confident, wrong, customer-facing numbers* — the
exact class Audit 2 named "scalar-certainty." A crash is reversible because the
user *knows* it failed. A wrong PASS verdict is irreversible because the user
*acts on it as truth* and the failure surfaces downstream, with our name on it,
where we can't intervene. **Ship rule that falls out of this: a meter may crash;
a meter may NOT lie. Any code path that can emit a confident customer-facing
verdict that is wrong is a hard blocker. Any code path that merely fails loudly
is a disclose-or-defer.** This cleanly partitions the audits' bug list and is
the single decision rule the board should adopt.

## 3. 10/10/10 on the live option (ship now, fix later)

- **10 minutes:** feels fine. v8.4.0 builds, demos beautifully, BS.1770-4 core
  is genuinely solid (audits agree). Easy to convince yourself it's ready.
- **10 months:** this is where it bites. With paying engineers/labels, the AAC
  PASS bug *will* fire on someone's hard-panned single — it's not a tail risk,
  it's the common case for modern masters. One public "RTM certified my master
  and it clipped on Apple" thread does more damage than 10 months of marketing
  buys back, because it attacks the trust premise directly.
- **10 years:** the certification-layer pivot Audit 2 describes ("RTM Verify —
  Stripe for delivery compliance," C2PA-signed certs, EU-AI-Act gate with UAI)
  is a genuinely large outcome — *and it is only reachable if RTM's name means
  "trustworthy" in year one.* Shipping a meter that lies now doesn't just risk
  v8; it poisons the well for the pivot that is the actual prize. **The pivot is
  the strategic reason the trust bar is non-negotiable, not a reason to delay.**

## 4. The recommended call (and the cost it accepts)

**HOLD for paid delivery until the "no confident lie" set is closed, then SHIP
the meter — do NOT hold for the pivot.**

Concretely, three buckets, decided by the §2 rule:

**MUST-FIX before any paid delivery (the lie-class — small, bounded, days):**
1. AAC ISP per-channel max, not mono downmix (`encoded_preview.py` — the
   verdict at :297 is the only thing that ships a wrong PASS; the fix is
   per-channel, audits call it trivial). **This alone is the line between
   shippable and not.**
2. Sentinel guard: any −70/0.0-style sentinel must render as "insufficient
   data," never a number, and must gate the advice at `AnalysisView.tsx:2120`.
3. ViSQOL → 48 kHz audio mode (`comparator.py:1919`).
4. RTMprofile match-score: either fix the cosine saturation
   (`engineer_profile.py:1005`) **or pull the paid match-score from the SKU**
   until it's real. A constant dressed as a score is the most reputationally
   radioactive item in the whole audit — do not ship it as paid signal.
5. mel-L1: rename to `spectral_difference`, strip "quality/degradation" verdict
   language. Cheap, and it stops us asserting a quality claim we can't back.

**DISCLOSE, ship with it (loud-failure / fundamental — honesty defuses these):**
- 4× TP factor (BS.1770-4 sufficient per Audit 3 — do NOT chase 8×).
- Hosted-plugin RT risk in RTMsend: ship RTMsend as **explicitly labelled beta**,
  separate SKU/track. Its crashes are reversible (§2); its bugs are not in the
  lie-class. This is the parallel-track the company structure allows — do not let
  RTMsend's HIGH/MED items hold the meter hostage.

**DEFER post-launch:** the RT-safety hardening, ARA recycled-pointer, soxr fork,
the 4.5 GB dead ML weights (cut from bundle — it's embarrassing, not dangerous).

**The cost this call explicitly accepts:**
- We slip the paid date by the days it takes to close items 1–5. That is the
  price, and it is cheap relative to the irreversible alternative.
- We ship a meter we *know* has known reversible imperfections (disclosed 4×,
  beta RTMsend, mel rename). That is acceptable **because a disclosed limitation
  is not a broken promise** — the trust contract is "our numbers are honest,"
  not "our numbers are omniscient." Disclosure keeps the contract intact.
- We do NOT wait for the certification pivot. Holding the meter for the pivot
  conflates a reversible GTM choice with an irreversible trust choice. Ship the
  honest meter now; the pivot is built *on top of* shipped trust, not instead of it.

**What would change this call:**
- If item 1 (AAC per-channel) turns out non-trivial in practice (it shouldn't —
  I read the path), gate the *AAC PASS/FAIL verdict only* behind a "preview,
  not certification" label and ship the rest. Never emit the binary cert until
  it's per-channel.
- If RTMprofile match-score can't be made real in the slip window, cutting it
  from the paid SKU is strictly better than shipping it — revisit only the SKU,
  not the ship date.
- If the JUCE white-screen fix is unverifiable (Audit 1: module not vendored),
  that gates **RTMsend** only, not the meter — confirm the forked module is
  committed/pinned before RTMsend's beta, but do not let it touch RTMcompare's date.

---

## 5. Answers to the four board questions

1. **Shippable?** Yes for the *meter*, at a minimum bar of **"no code path emits
   a confident customer-facing verdict that is wrong"** — i.e. §4 items 1–5
   closed. Not shippable today (AAC PASS lie confirmed in source).
2. **Sequence:** MUST-FIX = the lie-class (1–5). DISCLOSE = 4× TP, beta RTMsend,
   mel rename. DEFER = RT-safety/ARA/soxr/dead-weights. The partition rule is
   "lies block, loud failures disclose."
3. **GTM:** Ship the honest meter now; build the certification pivot on top of
   shipped trust. Do not hold the meter for the pivot — that trades a reversible
   timing decision for an irreversible trust risk.
4. **Single biggest risk if we ship as-is:** the AAC mono-downmix PASS verdict
   (`encoded_preview.py:297`) certifies a real customer's clipping master as
   Apple-compliant; it fails downstream with RTM's name on it, and **the trust
   that is the company's entire moat — and the precondition for the pivot — does
   not come back.**

---

*Advisory only. The final ship/no-ship call is the human's. My division's
contribution is the reframe: judge these bugs by reversibility-of-trust-damage,
not severity — and on that axis the line is bright and short.*
