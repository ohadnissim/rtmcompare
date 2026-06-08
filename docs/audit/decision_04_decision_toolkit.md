# Decision 04 — Structured Decision Analyst — RTM Suite Ship/No-Ship

**Lens:** bias checklist, opportunity cost, scenario matrix, regret minimization, pre-mortem.
**Role:** Make the GTM tradeoff explicit and comparable. Guide, don't decide. I add net-new
decision-structure judgment over the three completed audits — I do not re-derive their bugs.

---

## 0. Framing the actual decision (the audits answered "is it broken"; this answers "what do we do")

This is a **Trade-off Navigation** decision (Type 4), not a binary ship/no-ship. There are not two
options (ship / hold) — there are at least **four**, and the board's framing of question (3) as
"ship the meter OR hold for the pivot" is itself a **false-dilemma frame** that needs breaking before
scoring. The pivot ("RTM Verify" certification layer) and shipping the meter are **not mutually
exclusive on the same timeline** — the meter is the engine the certification layer wraps
(`RpcServer` MCP-wrap, per Audit 2). And DECISIONS.md already shows the company **deferred** the
RTMcertify pivot on 2026-05-12 pending the ArtifactNet/AI-origin credibility — so "pivot now" is
re-litigating a recent, documented decision. That is a confirmation-/recency-bias flag, addressed below.

### The four real options

- **A — Ship as-is now.** Take the revenue, fix in patch. (What the as-is question implies.)
- **B — Trust-Foundation gate then ship (≈1–2 wk).** Fix the 4 correctness ship-blockers
  (Audit 1 #1–#4, Audit 2 AAC/ViSQOL/profile-score), pass the specificity/sensitivity gate
  (Audit 3: ≥95% benign-EQ specificity, ≥90% artifact sensitivity), disclose the 3 fundamentals,
  ship the meter. Pivot remains a **later** parallel track.
- **C — Hold the meter, build the certification-layer pivot first.** Delay all revenue for the
  bigger TAM.
- **D — Ship B now AND open the certification layer as a funded parallel track** (RTM is a company,
  per the company memory — parallel tracks are viable; the engine is shared).

---

## 1. Options scored on the axes that matter

Criteria named and weighted by the **HARD CONSTRAINT** that trustworthiness of every customer-facing
number is the product's *entire value*. Trust-integrity is therefore the dominant axis (×2 weight),
not co-equal with speed. Scores 1 (bad) – 5 (good).

| Axis (weight) | A: Ship as-is | B: Gate→Ship meter | C: Hold→Pivot | D: B + parallel pivot |
|---|---|---|---|---|
| **Trust integrity** (×2) — does a paying customer ever get a *confidently-wrong* number? | **1** — AAC mono-downmix certifies a clipping master as PASS (`encoded_preview.py:246/255/290/297`); in-band sentinels acted on as real advice (`AnalysisView.tsx:2120`) | 5 | 5 | 5 |
| Time-to-revenue (×1) | 5 | 4 | 1 | 4 |
| TAM / strategic ceiling (×1) | 2 | 3 | 5 | 5 |
| Execution risk / focus (×1) | 4 (cheap) | 4 | 2 (TAM unproven, ArtifactNet not ready) | 3 (two tracks dilute a company-stage team) |
| Reversibility if wrong (×1) | **1** — a false PASS that ships a clipping master is *not* reversible; the customer already pressed the master | 5 | 4 | 5 |
| **Weighted total** | **14** | **27** | **22** | **27** |

**B and D tie on the integrity-weighted score.** They differ only on whether the pivot runs *now*
or *next*. The audits agree on B's content; the only open question the toolkit surfaces is B-vs-D —
a **sequencing/focus** question, not a correctness one.

---

## 2. Biases currently distorting the call

Run against the standard checklist; only the ones that *fire* are listed:

- **□ Sunk Cost — FIRES, twice.** (a) The **4.5 GB dead ML weights** bundled for a separator that
  doesn't exist (Audit 2) is sunk cost made physical — it is shipping cost and attack surface for
  zero current value; the instinct to "keep it, we paid for it / we'll use it for ArtifactNet" is
  the bias. Cut it from the installer regardless of GTM choice. (b) The **scalar-certainty
  architecture** (Audit 2's 1% insight) is sunk design debt; the temptation to patch the 4 named
  bugs and *not* refactor to `{value,valid,reason,provenance}` is sunk-cost reasoning — the same
  class of bug (confident sentinel) will re-spawn elsewhere. See §5 pre-mortem.
- **□ Optimism — FIRES.** "Trivial fix (per-channel max)" (Audit 1 #1) invites "so just ship and
  patch." Optimism bias treats a *correctness* bug in a *trust* product as a *severity* bug. It is
  not. A trivial-to-fix bug that silently certifies clipping is the **highest-consequence** bug
  precisely because it is invisible to the customer until their master is rejected by Apple.
- **□ Confirmation / Recency — FIRES on the pivot.** Three fresh audits all gestured at "RTM Verify"
  as the moonshot, creating a chorus that makes the pivot *feel* validated. But DECISIONS.md
  (2026-05-12) already **deferred** it for concrete, still-unmet reasons (AI-origin not credible
  until ArtifactNet; legal entity; signing infra). The recent audit-chorus should not silently
  overturn a 4-week-old reasoned deferral. **The condition that gated the pivot has not changed.**
- **□ Anchoring — FIRES.** "v8.4.0" anchors the team on a mature/finished product. Eight major
  versions create a *felt* readiness that the correctness audits contradict. Version number is not
  evidence of trust-readiness.
- **□ Authority — mild.** "Core BS.1770-4 is SOLID" (Audit 1) is true and tempting to over-extend
  into "the meter is solid." The *foundation* is solid; the *delivery-verdict layer* (AAC/ViSQOL/
  profile-score) is where the trust breaks. Don't let the solid core launder the broken verdicts.

Not firing: FOMO, Social Proof, Loss Aversion, Shiny Object (the pivot is shiny, but it's
*deferred-shiny*, covered under Confirmation).

---

## 3. Scenario matrix (option A — ship as-is — because that's the tempting/cheap path)

| Scenario | Prob | Outcome | Expected impact |
|---|---|---|---|
| A paying engineer trusts an AAC PASS on a hard-panned master, delivers it, Apple/distributor rejects it for ISP clipping | **High** | The one thing the product sells — a trustworthy meter — is publicly falsified on the customer's own master | Catastrophic to brand; this *is* the company's whole value prop |
| A label runs RTMprofile match-score (constant ~50/50, `engineer_profile.py:1005`) as a paid deliverable | Med-High | Customer notices every pair scores ~50% → concludes the tool is noise | Refunds + "RTM numbers are fake" word-of-mouth in a small, tight pro-audio community |
| ViSQOL-in-speech-mode (`comparator.py:1919`) score cited in a mastering dispute | Med | Wrong-model number used as evidence; indefensible under scrutiny | Credibility loss; possible chargeback |
| Sentinel (-70 LUFS) advice acted on for a 2s clip (`AnalysisView.tsx:2120`) | Med | "disgust candidate" — visibly nonsensical advice | Trust erosion, support load |
| No incident before the patch lands | Low-Med | Got lucky | Survives, but on luck not design |

The pro-audio market is **small and reputation-dense** (engineers/labels talk). The asymmetry is
brutal: upside of shipping 1–2 weeks early is marginal cash; downside is a falsified-meter story in
the exact community you sell to. **Negative expected value.**

---

## 4. Opportunity cost

- **Cost of B (gate first):** ≈1–2 weeks of engineering, deferred revenue. Bounded, known, small.
- **Cost of A (ship as-is):** the *option value of trust*. Once a customer catches one confidently-
  wrong number, you don't lose one sale — you lose the right to be believed by a referral network.
  In a trust product the destroyed asset is the entire moat (Audit 2: "neutral grader" moat).
- **Cost of C (hold for pivot):** all near-term revenue + validation, betting on a TAM that
  DECISIONS.md says isn't yet enable-able (ArtifactNet/AI-origin not credible). You'd be holding a
  *working, fixable, sellable* product hostage to an *unbuilt, gated* one. High opportunity cost.

---

## 5. Pre-mortem (it's 2026-09, the launch failed — why?)

1. We shipped A, an engineer's "PASS"-stamped master got rejected for ISP clipping, screenshotted it,
   and the post out-ranked our marketing. **Control: in our hands — fix #1 before any paid ship.**
2. We fixed the 4 named bugs but *not* the scalar-certainty architecture (sunk-cost, §2), and a
   **different** sentinel/constant surfaced post-launch in a code path no audit happened to open.
   **Control: ours — the architectural fix `{value,valid,reason,provenance}` is the real
   ship-blocker class, not the 4 instances.** *This is the biggest hidden risk the toolkit surfaces:
   fixing the four named bugs can create false confidence that the pattern is gone.*
3. JUCE white-screen reappeared on a clean checkout because the forked repaint module was never
   committed/pinned (Audit 1, UNVERIFIABLE). **Control: ours — verify before ship, trivial.**
4. We held for the pivot (C); a competitor shipped a good-enough meter; ArtifactNet still wasn't
   ready; we'd burned the quarter. **Control: partial.**

Warning signs to watch: any metric rendered without a validity flag; any "or DEFAULT" falsy-trap
(40+ exist, Audit 2); any `except: pass` (20 exist) swallowing a measurement failure into a confident
number.

---

## 6. Regret-minimization & the choice

Imagine looking back in 10 months.

- **Regret of shipping B (gate→ship):** minimal. Worst case you "wasted" 1–2 weeks hardening a trust
  product. No one regrets that in a measurement company.
- **Regret of shipping A:** maximal and *irreversible in reputation* — you can patch the code but not
  un-send the customer's rejected master.
- **Regret of C (hold for pivot):** medium-high — a fixable revenue product sat idle for a gated bet.

**Regret-minimizing choice: B, with D as the immediately-following posture** — gate-then-ship the
meter, and open the certification layer as a *parallel track only once its gating condition
(credible AI-origin via ArtifactNet) is met*, not before. Do **not** re-overturn the 2026-05-12
deferral on audit-enthusiasm alone.

**The key uncertainty it hinges on:** *not* the 4 named bugs (those are decided — fix them). It
hinges on whether the team treats the **scalar-certainty refactor** as in-scope for the pre-ship
gate or defers it. If deferred, B silently degrades toward A over the next two release cycles as new
confident-wrong numbers leak through untouched code paths. **Make the tagged-measurement-type
refactor (or at minimum a validity-flag wrapper on every customer-facing number) part of the
ship gate, not a post-launch nice-to-have.**

---

## 7. Answers to the board's four questions

1. **Shippable for paid?** Not as-is. Yes after the **Trust-Foundation gate**: fix Audit 1 #1–#4 +
   Audit 2's AAC-24bit / ViSQOL-48kHz-audio-mode / RTMprofile match-score; pass Audit 3's
   ≥95% benign-EQ specificity & ≥90% artifact-sensitivity gate; verify the JUCE fork is committed/
   pinned; **and add a validity flag to every customer-facing scalar.** Minimum bar = "no confidently-
   wrong number can reach a paying customer."
2. **Sequence — MUST-fix / disclose / defer:**
   - **MUST-fix pre-delivery:** AAC per-channel ISP (`encoded_preview.py`); ViSQOL audio mode
     (`comparator.py:1919`); RTMprofile match-score (`engineer_profile.py:1005`); sentinel→validity-
     flag (`AnalysisView.tsx:2120` + the pattern); mel-L1 relabel/FP-fix; RTMsend handleBypass +
     capture data-race (real-time safety); 24-bit pre-AAC; cut the 4.5 GB dead weights.
   - **Disclose (don't block):** 4× TP factor sufficiency; hosted-plugin RT risk; "spectral_difference
     is not a quality score."
   - **Defer post-launch:** soxr/resample TP-fork harmonization; nperseg floor; ARA region-id
     hardening (unless ARA is in the paid SKU — then promote to MUST-fix).
3. **GTM:** **Ship the meter (B) now after the gate; do NOT hold for the pivot.** The pivot's gating
   condition (credible AI-origin) is unmet per DECISIONS.md and unchanged. Wrap-as-certification is
   a parallel track for *after* ArtifactNet, on the *same* engine — not a reason to withhold revenue.
4. **Single biggest risk if we ship as-is:** the AAC mono-downmix false-PASS
   (`encoded_preview.py:246/255/290/297`) **publicly falsifying the meter on a paying customer's own
   master** in a small, reputation-dense market — destroying the "trustworthy neutral grader" moat
   that is the company's entire value and the basis of the certification-layer future. One screenshot
   can cost the franchise.

---

**Division verdict contribution:** NO-SHIP as-is; SHIP after the Trust-Foundation gate (Option B,
D-posture next). The decision is over-framed as binary — break the false dilemma: meter-now and
pivot-later share an engine and aren't in conflict.
