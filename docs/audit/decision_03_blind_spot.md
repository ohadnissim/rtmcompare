# Decision 03 — Blind-Spot Analyst

**Persona:** Identify the SINGLE most critical blind spot — the unexamined belief shared
across the team's mental models that, if wrong, caps everything. Net-new judgment only; I do
not re-list the bugs the three audits already found.

---

## The #1 Blind Spot (stated as the unexamined belief)

> **"If our DSP math is correct, our numbers are trustworthy — so verification means
> auditing the formulas, not validating the outputs against the real world."**

Every input to this verdict shares this gap:

- **The three audits** all reason at the *code/formula* layer. Audit 1 rules BS.1770-4
  "SOLID" by inspecting the K-weighting/prewarp/gating implementation. Audit 3's pre-ship gate
  ("≥95% specificity / ≥90% sensitivity") is the *only* output-validation idea in the entire
  packet — and it's scoped to the mel-L1 artifact flag, not to the core meters customers buy.
- **The product's own QA corpus is 100% synthetic.** `scripts/qa/regenerate_goldens.py`
  builds 10 deterministic signals — sines, pink/white noise, a clipped sine, 30 s of silence,
  a click track, a "synthetic song stem." There is **not one real commercial master with a
  known-correct LUFS/TP/LRA** anywhere in the QA path.
- **The only "validation" in the engine is self-consistency.** `comparator.py:643` checks the
  TP filter against its own spec tolerance (±0.02 dBTP); `comparator.py:1136` cross-validates
  "PLR ≈ TP − LUFS_I (within tolerance)." Both are the meter grading its *own internal
  algebra*. There is **zero parity check against an independent reference meter** (Youlean,
  NUGEN, Orban, ffmpeg ebur128, a Dolby-certified ADM meter) — the one artifact a
  measurement *company* must own.

The belief is invisible because correct-formula and trustworthy-number feel like the same
thing to a DSP-literate founder. They are not. The AAC ISP bug (Audit 1 #1) is the proof the
team can't see: the K-weighting was flawless *and the customer still got a clipping master
certified PASS*, because correctness was verified per-formula, never per-output on a
hard-panned real track. That bug is not an isolated defect — it is **the signature of the
blind spot.** Audit 2's "scalar-certainty" insight names the same disease at the
representation layer; the blind spot is its root *cause*: a team that validates against math
will keep shipping scalars that are computed correctly and mean the wrong thing.

## Why the current framing hides it

The board question is framed as **"which bugs block ship?"** — a triage frame. Triage
assumes the bug list is the risk surface. But a synthetic-only, self-consistent validation
regime **cannot generate the bug list for the failure class that actually threatens the
company**: outputs that are individually plausible, internally consistent, formula-correct,
and *wrong on real audio*. The AAC bug, the 16 kHz ViSQOL speech-mode error (Audit 2), the
saturated RTMprofile match-score (Audit 2), the mel-L1 mislabel — **every one of these passes
synthetic goldens and self-consistency, and every one was caught by a human reading code, not
by a test.** The audits are excellent code reviews. The company has no system that would have
caught *any* of them automatically, which means the next one ships silently. The framing hides
the blind spot because "fix #1–#4 then ship" treats the four known instances as the
population, when they are a *sample drawn by manual inspection from an unmeasured population.*

A secondary, same-root instance the audits under-weight: the README sells **"BS-RoFormer
4-stem (SDR 9.66 on MUSDB18HQ)"** as the engine behind paid per-element (KICK/SNARE/SUB…)
verdicts. SDR-on-MUSDB is a *research benchmark on a different corpus*; it is being presented
to a paying engineer as accuracy on *their* mix. Same belief: a number that is true in the
lab is sold as true for the customer. (The 4 GB of weights are real and present — so this is
a live customer-facing claim, plus an unresolved commercial-license question on those
checkpoints that the hard-constraint (c) audit must close before ship.)

## The single highest-leverage move to test/remove it

**Build a real-world ground-truth parity harness before any paid delivery — and make passing
it the ship gate, replacing "fix #1–#4."**

Concretely, the minimum viable version (days, not weeks):

1. **Reference-meter parity (highest leverage, smallest cost).** Take 20–30 real commercial
   masters (varied genre, mono/stereo/hard-panned, an Atmos ADM). Measure LUFS-I, TP, LRA,
   per-channel ISP, post-AAC LUFS in RTMcompare **and** in 2 independent certified meters.
   Gate: agree within published tolerance (e.g. ±0.1 LU, ±0.1 dBTP). **This single test would
   have caught Audit-1 #1, the ViSQOL mode error, and the mono-downmix family — none of which
   the synthetic corpus or self-consistency can catch.** It is also the artifact that converts
   the meter into a *certifiable* one (directly enabling Audit 2's "RTM Verify" pivot).
3. **Adversarial real-audio set:** hard-panned transients, true-stereo, a known-clipping
   master, a benign-3 dB-EQ pair. Gate on Audit 3's specificity/sensitivity targets — but on
   *real* audio, not the mel flag alone.
4. **Publish a tolerance/provenance statement per metric** (operationalizes Audit 2's tagged
   `{value, valid, reason, provenance}`). A measurement company's brand *is* its stated
   tolerances; shipping numbers with no published accuracy bound is the commercial form of the
   same blind spot.

If the founder pushes back with "the math is right, we don't need this" — that *is* the blind
spot speaking, and the AAC bug is the receipt.

---

## Verdict contribution (Decision division)

**Conditional NO-SHIP — but the binding condition is broader than the audits state.**
Fixing #1–#4 is necessary and not sufficient. The company's existential risk is not the four
known bugs; it is that **nothing in the product can detect bug #5.** Convert ship-readiness
from a bug-triage to an *output-validation* gate: a real-master reference-meter parity harness
+ published per-metric tolerances must pass before one paid invoice. That same harness is the
asset that unlocks the certification-layer pivot — so this move is GTM-accretive, not a tax.

**Single highest-priority recommendation:** Stand up the real-master reference-meter parity
harness and make it the ship gate. It is the only thing that turns "our math is correct" into
"our numbers are trustworthy" — the exact claim the business is sold on.
