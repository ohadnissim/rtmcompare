# Upgrade 02 — First Principles Lens (Elon / physics-not-analogy)

**Division:** Upgrade — First Principles
**Target:** RTM Suite (RTMcompare v8.4.0 + RTMsend + RTMprofile)
**Date:** 2026-06-08
**Mode:** REPORTS — advisory, no code changed, no jobs run.

---

## 0. The lens, applied honestly

I am not here to re-list the three audits. They found the bugs. My job is to ask
the only question first principles cares about: **what is this product PHYSICALLY
bound by, and which of its "requirements" are just inherited opinion?**

Run the 5 steps in order — *question the requirement → delete → simplify →
accelerate → automate* — and the RTM Suite collapses into a far smaller, far more
defensible object than the one being audited. Most of the ship risk is not bugs.
It is **scope that was never load-bearing.**

---

## 1. Requirements challenged (real constraint vs inherited assumption)

The product's *whole value* (per the hard constraints) is being a **trustworthy
meter**. That is the single physical invariant. Test every feature against it.

| "Requirement" | Real constraint, or opinion? | First-principles ruling |
|---|---|---|
| Emit a **binary** Apple-Digital-Masters PASS/FAIL on AAC ISP | **Opinion, and a dangerous one.** Physics says inter-sample peak is a per-channel, 4×-oversampled estimate with install-dependent resampler error (the soxr-vs-poly 0.3–0.5 dB fork is *measured*). A binary verdict claims a precision the signal chain does not contain. | The mono-downmix bug (`encoded_preview.py:255` `chunk.mean(axis=1)`, decode side `:290`) is the proximate fault — but the **deeper fault is the binary itself.** Even per-channel-correct, a hard PASS at a ceiling you can only estimate to ±0.5 dB is a false claim of certainty. Delete the boolean; emit `value ± CI` + margin-to-ceiling. |
| It must classify **"perceptual_quality" / "degradation"** (`comparator.py:693`) | **Opinion.** A mel-L1 distance is a *difference*, not a *quality*. There is no physical law mapping mel-L1 → "this sounds worse." | Not a calibration bug — a **category error**. Rename to `spectral_difference`, strip the value judgment. (Confirms Audit 1; first principles says it was never a quality axis to begin with.) |
| It must ship a **4.5 GB ML separator stack** (`model-cache/*.ckpt`, 4.0 GB confirmed on disk) | **Opinion — and the separator does not exist.** | DELETE. Dead mass on every cross-platform installer, every download, every notarization. Zero contribution to "trustworthy meter." |
| It must run **ViSQOL** as a quality oracle | **Real-ish, but mis-specified.** ViSQOL in 16 kHz SPEECH mode (`comparator.py:1919`) is measuring a *different physical system* than 44.1/48k music. | Either configure it to the actual signal (48k audio mode) or delete it from the verdict. A wrong-domain model is worse than no model: it manufactures confident error. |
| **RTMprofile** must output a paid engineer match-score | **The math is degenerate.** Cosine on `dB+100` (`engineer_profile.py:1005`) saturates to ~0.5 for *any* two masters — the metric carries ≈0 bits. | A paid number that is mathematically constant is not a weak feature; it is a **refund liability**. Delete RTMprofile from the paid surface until the metric carries real information. |
| RTMsend must **host a 3rd-party EQ in the realtime callback** | **Real capture need, wrong topology.** Hosting arbitrary 3rd-party RT code inside your audio thread means your reliability ceiling = the worst plugin a user loads. You do not control that physics. | Keep the capture-and-send (the patentable core), but treat the hosted-plugin path as **inherently best-effort** and disclose it. Do not certify numbers derived through an uncontrolled RT graph. |

**The one real, non-negotiable constraint:** every customer-facing number must be
*true or absent*. Everything else is negotiable scope.

---

## 2. What to DELETE before optimizing anything

First principles forbids optimizing a part that should not exist. Before a single
bug is "fixed," delete:

1. **The 4.5 GB dead ML weights** (`model-cache/`). No separator → no reason to
   ship. Shrinks the installer, the attack surface, the notarization, the
   cross-platform matrix. Pure subtraction, pure win.
2. **Every binary PASS/FAIL verdict built on an estimated quantity** — AAC ISP,
   and any other "compliant/non-compliant" boolean. Replace with value+CI. This
   *deletes the entire class of "certified a clipping master" failures*, not just
   the mono instance.
3. **RTMprofile from the paid tier.** A constant score is negative value. Ship it
   free/beta or not at all until `engineer_profile.py:1005` carries information.
4. **In-band sentinels rendered as numbers** (−70.0 LUFS, 0.0 LRA →
   `AnalysisView.tsx:2120` acting on them). Delete the sentinel-as-value path
   entirely; a missing measurement must be *structurally* missing, not a magic
   float. This is the same disease as #2.
5. **The 40+ `or DEFAULT` falsy-traps and 20 silent `except: pass`.** Each one is
   a place where the meter *invents* a number instead of admitting absence. Delete
   the swallow; let absence propagate.

Note that #2, #4, #5 are **the same bug wearing three costumes.** Audit 2's "1%
insight" (scalar-certainty) is exactly right, and from first principles it is not
a code-quality nit — it is **the product's central physical lie**: the meter
always returns a confident scalar even when the underlying measurement does not
exist or is not valid. *That* is what makes it untrustworthy, not any single line.

---

## 3. The first-principles redesign + order of operations

The minimal trustworthy meter is: **a typed measurement that can refuse to
answer.** Replace the bare scalar everywhere with:

```
Measurement { value | null, valid: bool, ci: [lo,hi]|null, reason, provenance }
```

This is the *whole* fix. It is physically honest: a measurement either exists with
a bound, or it is absent with a reason. There is no third state, and today the
product manufactures a fraudulent third state ("confident scalar from nothing").

**Order of operations (delete before automate):**

1. **DELETE** the dead 4.5 GB weights + RTMprofile-from-paid + every estimated
   boolean verdict. (Days, not weeks. Pure subtraction.)
2. **FIX the one true correctness bug that survives deletion:** per-channel AAC
   ISP (`encoded_preview.py:255/290`). Even after the binary is gone, the
   per-channel *value* must be right.
3. **SIMPLIFY** all metrics to the `Measurement` type. Sentinels, falsy-traps, and
   silent excepts all collapse into `valid:false` + reason. One pattern replaces
   ~60 ad-hoc sites.
4. **FIX the domain errors** that remain meaningful: ViSQOL→48k music mode;
   mel-L1→`spectral_difference` (no quality claim); the resampler fork → pin ONE
   resampler so installs agree (a meter that disagrees with itself is not a meter).
5. **ACCELERATE / pre-ship gate:** Audit 3's bar — ≥95% specificity on benign EQ,
   ≥90% sensitivity on real artifacts. First principles addition: also gate
   **install-to-install reproducibility** (same input → same number across
   macOS arm64/Intel/Win/Linux). Reproducibility *is* trustworthiness; an
   unreproducible meter fails its one invariant.
6. **AUTOMATE** last: CI that runs the gate on every build. Never before steps 1–5.

---

## 4. Board questions — my division's contribution

**(1) Shippable for paid, minimum bar?**
**Conditional GO**, but the bar is *not* "fix the 4 bugs." The bar is: **no
customer-facing scalar may exist without `valid` + provenance, and no PASS/FAIL
boolean may be emitted on an estimated quantity.** Hit that and the AAC blocker,
the sentinels, and the falsy-traps all die together. Ship the *core BS.1770-4
meter* (which the audits agree is SOLID) under that discipline.

**(2) Sequence — fix / disclose / defer?**
- **MUST-fix pre-delivery:** per-channel AAC ISP value; kill all
  estimated-boolean verdicts; the `Measurement` type rollout for anything shown to
  a paying user; pin one resampler.
- **DELETE pre-delivery (faster than fixing):** 4.5 GB weights; RTMprofile from
  paid; ViSQOL-from-verdict (unless re-domained in the same sprint).
- **DISCLOSE:** 4× TP is an estimate with ±tolerance (Audit 3 confirms 4× is
  sufficient — do not gold-plate to 8×); hosted-plugin RT path is best-effort;
  mel-L1 is a difference, not a quality.
- **DEFER post-launch:** RTMsend data-race/lifecycle hardening (real, but it
  degrades *capture*, not *certified numbers* — different blast radius); ARA
  region-id; PEAQ/DNN (license-fatal, never).

**(3) GTM — ship now or hold for the certification pivot?**
**Ship the honest meter now; the pivot is a renaming, not a rebuild.** Audit 2's
"RTM Verify" certification layer is the *correct* long-term shape — but a
certification authority whose certs are estimated booleans is a lawsuit, not a
moat. The `Measurement`-typed, CI-bearing meter from §3 **is literally the
substrate the cert layer requires.** So there is no fork in the road: do §1–§5,
ship it as the meter, and "RTM Verify" becomes the same engine with C2PA signing
bolted on. Holding the meter to wait for the pivot delays the only thing that
makes the pivot possible. Build the truthful primitive; the GTM follows for free.

**(4) Single biggest risk if shipped as-is:**
**The product certifies a falsehood to a paying professional and is believed.**
The AAC mono-downmix PASS is the loaded instance — it tells a label "your
hard-panned master is Apple-Digital-Masters clean" when it clips ~6 dB hot on one
channel. For a tool whose *entire* value is trust, one provably-wrong "PASS"
emailed to a mastering house is not a bug report — it is the **death of the
brand's one asset.** A wrong meter is worth less than no meter, because no meter
doesn't cost you your reputation. This is existential, not cosmetic.

---

## 5. Highest-priority recommendation (one thing)

**Delete every PASS/FAIL boolean that sits on an estimated quantity, and forbid
any customer-facing number that lacks `{valid, ci, provenance}`.** Fixing the
per-channel AAC math (`encoded_preview.py:255/290`) is necessary but insufficient
— the disease is *scalar-certainty*, and the cure is making the meter capable of
saying "I don't know." A meter that can refuse to answer is the only meter worth
selling, and it is the exact substrate the certification-layer pivot needs. Do
this before optimizing, accelerating, or automating anything.
