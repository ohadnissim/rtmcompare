# Decision 01 — Pre-Mortem: RTM Suite Delivery-Readiness

**Lens:** Assume the ship FAILED 12 months out. Work backwards to the load-bearing
assumptions nobody is checking. I do not re-list the three audits' bug inventory; I add
the assumption-failure layer they don't cover, grounded in the code.

---

## THE FAILURE STORY (most likely way this dies)

It is June 2027. RTM did the sensible thing: shipped the meter now, fixed the AAC
mono-downmix blocker (#1), and disclosed the three fundamentals. Revenue came. Then a
respected mastering engineer — exactly the buyer this product courts — posts a thread:
*"RTMcompare passed my master as Apple-Digital-Masters clean. Apple's own afclip flagged
it. I sent a clipping master to a label on RTM's word."* It wasn't the bug we fixed. It
was a **second** number that was also wrong — the ViSQOL "speech mode" score, or a
sentinel rendered as a real LUFS, or the profiler match-score that says "92% match" for
two unrelated masters. The specific number doesn't matter. What kills the company is the
**category claim collapsing**: "the trustworthy meter" is a single-bit reputation asset,
and we shipped a product where *we ourselves could not enumerate which numbers were
trustworthy*. The fix-after-ship strategy didn't fail because the fixes were hard. It
failed because **trust is not patchable** — the first wrong number a paying expert catches
revokes the entire instrument's credibility, retroactively, including the numbers that
were correct.

This is the difference between RTM and a generative tool (LANDR/RoEx): if their AI master
sounds 90% good, that's a win. If our meter is 99% right, the 1% is the *entire* product,
because the buyer pays precisely for the promise that they don't have to double-check us.

---

## THE BROKEN ASSUMPTIONS (ranked by if-wrong-how-fatal)

### A1 — "Fixing the ONE known ship-blocker (#1) makes the numbers trustworthy." — Conf: LOW — Impact: CRITICAL
The three audits found wrong numbers in **four independent subsystems**: AAC ISP
(`encoded_preview.py:256,287` — `mean(axis=1)` confirmed, and the shipped
`8.4.0-arm64-stage` bundle already carries it, 3 occurrences), ViSQOL speech-mode
(`comparator.py:1919`), in-band sentinels acted on (`AnalysisView.tsx:2119` — confirmed:
the `lra < 4` guard *passes* a sentinel `0.0` LRA and advises easing compression), and the
profiler cosine score (`engineer_profile.py:954-969` — the `+100` offset that saturates the
metric is still structurally live; the docstring only fixed a *prior* double-log).
**These are not four bugs. They are one pattern (AUDIT 2's "scalar-certainty") manifesting
four times — which means there are almost certainly a fifth and sixth we haven't found.**
The assumption that the bug list is complete is the fatal one. *Cheap pre-test:* before any
ship, run the audits' own proposed gate — ≥95% specificity on a benign-EQ panel, ≥90%
sensitivity on a real-artifact panel — against **every customer-facing scalar**, not just
the AAC verdict. If any metric can't pass, it ships behind a "measured/uncertain" tag or
not at all.

### A2 — "The JUCE white-screen fix will be in the shipped build." — Conf: LOW (verified FALSE) — Impact: CRITICAL (for RTMsend)
AUDIT 1 flagged this UNVERIFIABLE. I verified it: **JUCE is gitignored (`.gitignore:71`),
not a submodule, zero files tracked**, and CI clones it fresh by tag:
`git clone --depth 1 --branch 8.0.12 .../JUCE.git` (`build-windows.yml:51`). The forked
repaint fix lives only in the developer's local checkout. **A clean CI build ships stock
JUCE 8.0.12 and reintroduces the white-screen.** The "we fixed it" belief is true on one
Mac and false everywhere the product is actually built. *Cheap pre-test:* delete local
`JUCE/`, run CI, load RTMsend in a host — if it white-screens, the fix is not committed.
Permanent fix: vendor the fork as a pinned submodule or apply the patch in-CI.

### A3 — "On-device cross-platform parity means the numbers match across installs." — Conf: LOW — Impact: HIGH
AUDIT 1's soxr-vs-resample_poly fork (0.3–0.5 dB TP divergence) and the encoder fork
(afconvert on macOS, ffmpeg elsewhere — confirmed at `encoded_preview.py:264/270`) mean
**the same master gets a different PASS/FAIL on Mac vs Windows.** For a "trustworthy meter"
this is A1 with a platform axis: the buyer who validates on Mac and a collaborator who
validates on Windows get contradictory certs. *Cheap pre-test:* one reference master,
all four platform builds, diff every scalar. Any divergence > the claimed precision is a
disclosure-or-fix item.

### A4 — "Ship-now-fix-later is reversible if a number turns out wrong." — Conf: LOW — Impact: CRITICAL
It is not. A certification number, once relied upon by a customer to deliver to *their*
client, is an **irreversible commitment** — the master is shipped, the label has it, the
trust is spent. Unlike a feature bug (annoying, patchable), a wrong cert is a liability
event. The plan treats correctness like a feature backlog; it is actually a release gate.

### A5 — "B2B/SLA framing protects us." (company, not solo) — Conf: MEDIUM — Impact: HIGH (inverts the risk)
RTM is a company, so SLA/B2B is viable — but an SLA on a meter is a **warranty on
accuracy**. Shipping known-wrong numbers under an SLA converts a reputation risk into a
contractual one. The company structure that enables the certification-layer pivot also
*raises* the cost of shipping wrong now.

---

## DEPENDENCY CHAIN
A1 (numbers trustworthy) is the root. A2 and A3 are A1 on the plugin and platform axes.
A4 says the whole chain is irreversible once a customer relies on it. A5 says the company
framing amplifies the downside. **Weakest link: A1's hidden assumption that the bug list is
complete.** If that breaks, the disclose-3-fundamentals strategy is worthless — you can't
disclose the wrong numbers you haven't found.

## REVERSIBILITY
- **Reversible:** the meter as an *advisory analysis* tool (numbers framed as estimates).
- **Irreversible:** any binary PASS/FAIL cert a customer forwards to a third party. Treat
  every binary verdict as a one-way door.

## KILL SWITCHES
- **Continue to paid ship if:** (a) #1–#4 fixed AND committed/CI-verified; (b) JUCE fork
  pinned and a clean-clone build verified white-screen-free (A2); (c) the audits' own
  spec/sensitivity gate passed against *every* customer-facing scalar (A1); (d) the
  scalar-certainty refactor (tagged `{value,valid,reason}`) gates every binary verdict so an
  invalid measurement *cannot* render as a confident number.
- **Hold / pivot to advisory-only if:** any scalar fails the gate and can't be tagged in
  time — ship the meter as labeled-estimates, withhold the binary Apple-Digital-Masters
  cert until it's trustworthy.

## HARDENING ACTIONS (before committing resources)
1. **Hunt the 5th bug, don't celebrate the 4 found.** Sweep every customer-facing scalar
   for the scalar-certainty pattern; the tagged-measurement-type refactor is the *root* fix
   and should gate ship, not be deferred.
2. **Verify A2 with a clean clone today** — it's a 30-minute test that decides whether
   RTMsend ships at all on CI-built artifacts.
3. **Gate the binary cert separately from the analysis tool.** The advisory meter can ship
   now; the PASS/FAIL Apple-Digital-Masters verdict is the irreversible one — it ships only
   after A1+A3 are closed.
