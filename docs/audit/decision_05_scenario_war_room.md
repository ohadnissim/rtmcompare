# Decision 05 — Scenario War-Room

**Lens:** Cascading, compound what-ifs across product/ops/cost/team/market. Not "is bug X bad" (that's Audits 1–3). The question is: *which 2–3 variables move together, what cascade do they trigger, and what hedges must be pre-committed before we ship for money.* I ground three net-new findings the prior audits did not weight, then trace the cascades.

---

## Net-new findings (not in Audits 1–3) that change the cascade

### NN-1 — The certification-layer pivot is ALREADY SHIPPED, half-built, on top of the broken metrics.
`src/App.tsx:197-216` exposes a live `rtmCertify` feature; backend `python/rtm_certify.py`. It emits a **signed pre-delivery compliance certificate** with `compliance: { streaming_ready: boolean; generation_loss_ok: boolean }`, a `certificate_id`, dual SHA-256 file hashes, and an `hmac_sha256` seal. Audit 2 framed "become the certification layer" as a *future moonshot*. It is not future — it is in the product today. That inverts the GTM question: we are not deciding *whether* to enter the trust-attestation business; we have **already made a binary, signed, customer-facing compliance claim** that rests on the exact metrics Audit 1/2 ruled broken (AAC mono-downmix ISP pass/fail, sentinel-as-real, constant profile score). **A signed false PASS is categorically worse than an unsigned wrong number** — the signature converts a measurement error into a documented, attributable warranty.

### NN-2 — The signature is machine-local HMAC → cryptographically meaningless as third-party attestation.
`rtm_certify.py:199-231`: the signing key is `os.urandom(32)` written to `~/.rtm/certify.key` on the *producer's own machine*. The docstring claims certs are "unforgeable without access to the signing machine." That is true and useless: the **recipient (label, distributor, A&R) has no key to verify against**, and the producer can re-sign any payload at will. This is symmetric HMAC masquerading as a certificate. It looks like C2PA/PKI assurance; it delivers none. If RTMcertify is ever marketed as a verifiable cert, that is the single highest litigation-and-reputation surface in the suite — more dangerous than any single DSP bug, because it is a *security/trust* claim, not a *measurement* claim.

### NN-3 — JUCE IS vendored and pinned (de-risks Audit 1's "unverifiable" flag).
`JUCE/` is a full git checkout pinned at `501c0767…`. Audit 1 could not verify the repaint/white-screen fix because "JUCE not vendored." It is vendored and pinned at the suite root. The fork-persistence risk is materially lower than Audit 1 assumed — confirm the repaint patch lives in this pinned tree (one diff check), then that ship-blocker concern downgrades to LOW.

---

## Compound Scenarios (cascade traced)

I pick the **3 co-moving variables** most likely to detonate together:
**(V1)** a customer-facing number is wrong on a real delivery; **(V2)** that number was *signed* (RTMcertify); **(V3)** the customer is a label/distributor with a contract, not a hobbyist.

### BASE CASE — "Ship the meter, certify quietly, get caught on one panned master"
*Probability: high if we ship as-is.*
- T0: A mastering engineer runs RTMcertify on a hard-panned hip-hop master. The AAC ISP check reads the mono downmix (`encoded_preview.py:246/255/290/297`), ~6 dB low. Cert says `streaming_ready: true`.
- T+2w: Apple/Tidal ingest rejects it for inter-sample clipping, OR it ships and codec-clips on consumer playback.
- **Cascade:** Product (one bad cert) → Ops (support ticket, "but your tool *certified* this") → Legal (the engineer forwards the signed cert to *their* client/label as proof they QC'd it; now RTM is in a three-party blame chain) → Market (the engineer is a node in a 200-person mastering Slack; the story "RTM passed a clipping master and put a signature on it" travels in days) → Team (firefighting pulls the only DSP person off roadmap for a week).
- **Net:** A single ~6 dB read on one transient costs a customer relationship, a forum reputation hit, and a sprint. The dollar-loss is small; the *trust-asset* loss is the whole moat (Audit 2's "neutral grader" position). For a meter, trust is the only inventory.

### ADVERSE CASE — "The signed cert becomes a contractual artifact in a B2B/SLA deal"
*Probability: moderate — and rises the moment GTM leans B2B (RTM is a company; SLA is explicitly on the table).*
- A label or distributor adopts RTMcompare under an SLA and **writes RTMcertify into their delivery workflow** ("vendors must attach an RTM compliance cert"). The cert's `streaming_ready` boolean is now a **gate other parties rely on**.
- One mono-sum-LRA-on-Atmos error (Audit 2) or a sentinel rendered as a confident LUFS on a short clip (`AnalysisView.tsx:2120`) flows into a signed cert that a third party acts on.
- **Cascade:** Product → Ops (SLA breach clock starts) → Legal (now it's *breach of warranty*, and NN-2 means we can't even prove which build/key signed it to defend ourselves) → Finance (SLA penalty + churn of the anchor B2B logo we built GTM around) → Market (a B2B reference customer churning over a *correctness* failure is the worst possible proof point for a trust product; competitors with no certification feature look *safer*) → Team (founder time consumed by the incident for a month).
- **This is the asymmetric tail.** The same bugs that cost a hobbyist a forum post cost the *company* its lighthouse account and its trust narrative simultaneously, because the signature + the contract couple the failures.

### BEST CASE — "Trust-foundation sprint first, certify only what's provably true"
*Probability: high if we sequence correctly.*
- We fix the 4 Audit-1 blockers + the 2 Audit-2 correctness bugs (ViSQOL 48 kHz, sentinel suppression), **gate RTMcertify behind only the metrics that survive the tagged-validity refactor**, and demote/disable the `generation_loss_ok` and any metric that can't carry a confidence interval.
- The cert then attests *only* to BS.1770-4 LUFS/LRA/per-channel TP — the part Audit 1 already ruled SOLID — and explicitly *declines to certify* what it can't measure honestly ("AAC ISP: per-channel, valid" / "Atmos LRA: not certified, mono-sum only").
- **Cascade (virtuous):** Product (a meter that *refuses to lie* is the differentiator) → Market (this IS the Audit-2 moat — generative competitors LANDR/RoEx structurally can't claim neutrality; a meter that says "I won't certify this, here's why" out-trusts a meter that always returns a green check) → GTM (the cert becomes a *real* asset for the EU-AI-Act / Apple-Digital-Masters B2B story, bundled with UAI) → Finance (defensible premium pricing on trust).

---

## Early-Warning Triggers to watch

| Trigger | What it signals | Watch via |
|---|---|---|
| First support ticket containing the words "but it certified" | NN-1 cascade has started; a signed false-pass is in the wild | Support inbox keyword alert |
| Any prospect asks "can our distributor verify the cert?" | NN-2 is about to be exposed publicly | Sales call notes |
| First B2B/SLA contract that *references* RTMcertify output | Adverse-case coupling is forming; warranty exposure live | Contract review gate |
| A panned-master / Atmos title in the user's own test corpus passes ISP but fails a real distributor ingest | The mono-downmix bug is reproducing on real deliveries | Run the Audit-3 pre-ship gate corpus |
| Forum/Slack mention of RTM + "wrong"/"clipped"/"false pass" | Market-trust erosion underway | Reddit/Slack monitoring |

---

## Pre-committed Hedges (decide NOW, before ship)

1. **DISABLE or relabel RTMcertify before any paid release** until NN-1/NN-2 are resolved. This is non-negotiable and is my single highest-priority recommendation (below). A signed binary compliance claim on un-fixed metrics is the one feature that converts every Audit-1/2 bug into a *warranty* liability. Shipping the meter without the cert is fully recoverable; shipping the cert is not.
2. **Per-build cert provenance.** When RTMcertify returns, bake in `app_version`, `metric_engine_version`, and a build hash so that if a cert is ever disputed we can prove which logic signed it. Hedges the NN-2 "can't defend ourselves" failure even before moving to real PKI/C2PA.
3. **Tagged-validity gate on the cert specifically** (Audit-2's `{value,valid,reason,provenance}`). The cert must be *physically incapable* of emitting a boolean PASS on a metric whose `valid=false` (sentinel, mono-sum-on-stereo-claim, 16 kHz ViSQOL). Cert defaults to "NOT CERTIFIED — reason" rather than PASS. This single invariant neutralizes the entire scalar-certainty failure class at the one surface where it's most dangerous.
4. **Confirm the JUCE repaint patch in the pinned tree** (NN-3) — one diff, closes Audit-1's only unverifiable flag.
5. **B2B contract firewall:** until the cert is real (PKI/C2PA, post-launch), add a clause that RTMcertify output is an advisory internal QC aid, not a warranted third-party attestation. Cheap legal hedge against the adverse-case tail.

---

## Answers to the four board questions (war-room contribution)

1. **Shippable for paid?** The *meter* — yes, after Audit-1 #1–#4 + Audit-2 correctness fixes + disclosures. The *certificate as currently built* — **no, not at any bar**, because of NN-1/NN-2. Minimum bar: cert disabled or hard-gated on tagged-validity, never emitting PASS on an invalid metric.
2. **Sequence:** MUST-fix pre-delivery = the 4 blockers + sentinel/ViSQOL + **gate-or-kill RTMcertify**. Disclose = 4× TP, hosted-plugin RT risk, mel-L1-is-not-quality. Defer = soxr divergence, ARA id, real PKI/C2PA cert.
3. **GTM:** This is a false binary. The pivot is *already half-shipped* (NN-1). Do not "hold for the pivot" and do not "ship now and fix later" — **ship the meter, and ship the cert ONLY in its honest-refusal form.** The trust-foundation sprint IS the GTM. A meter that refuses to certify what it can't measure is the moat; the half-built always-green cert is the anti-moat.
4. **Single biggest risk if we ship as-is:** A **signed false PASS lands in a B2B/SLA customer's contractual delivery workflow** (NN-1 × NN-2 × NN-3-contract). It simultaneously breaches an SLA, destroys the neutral-grader trust narrative the whole company is positioned on, and — because the signature is machine-local HMAC — leaves us unable to even forensically defend which build produced it. One incident, three functions down, moat gone.
