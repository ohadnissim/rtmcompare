# Launch 06 — Execution Driver (`go-mode`)

**Verdict contribution: CONDITIONAL GO — gated on a 4-fix correctness sprint, NOT a strategy pivot.**

My lens is the shortest path from "decided" to "in a paying customer's hands."
I do not re-derive the bugs (three audits did that). I rule on **what ships, in what
order, and what the first shippable increment is** — and I flag the one execution
trap that will burn the company.

---

## 0. Ground truth I confirmed (so the plan is real, not theoretical)

- **v8.4.0 is already physically packaged.** `release/RTMcompare-bundle-8.4.0-arm64.dmg`
  (5.03 GB), `-intel.dmg` (5.04 GB), and `-8.0.0-windows.zip` exist with `.sha256`
  siblings. This is not a "we need to build a release" situation — **the gun is loaded.**
  That is exactly why the ship-blocker is dangerous: nothing technical stands between
  today and a customer running a miscertified master.
- **The ship-blocker is real and exactly as Audit 1 stated.** `python/encoded_preview.py`:
  - line **246** `y_mono = y.mean(axis=1)` → mono downmix of the loud window
  - line **290–291** `mono_dec = y_dec.mean(axis=1)` / `post_tp = _tp_db_for_aac(mono_dec, …)`
  - line **297** `'verdict': 'fail' if post_tp > -1.0 else 'pass'`
  A hard-panned transient that clips post-AAC in L or R is averaged with the quieter
  opposite channel before the peak is read, then a binary **Apple Digital Masters PASS**
  is emitted. The fix is genuinely trivial: take `np.max(np.abs(up), axis=1)` per channel
  (the code *already computes per-channel abs at line 185* — it throws it away on the
  ISP path). **One file, ~6 lines, no architecture.**
- **No Python unit-test directory exists** — only `rtm_regression.py` at root. This is
  the single biggest gap between "fixed" and "provably fixed." See gate below.

---

## 1. Shippable for PAID delivery — and the minimum bar

**Yes — but not the artifact sitting in `release/` today.** A trustworthy-meter product
that emits a confident PASS on a clipping master has *negative* value: it is worse than
no tool, because the engineer would otherwise check by ear. The whole moat is "neutral
grader you can trust," and one false PASS to a label client detonates that moat
permanently — labels talk to each other.

**Minimum bar to ship (definition of done for v8.4.1):**
1. The 4 correctness fixes below are in and **each has a red→green regression test
   added to `rtm_regression.py`** (a hard-panned clipping fixture is the keystone test).
2. The Audit-3 pre-ship gate passes: **≥95% specificity on benign EQ, ≥90% sensitivity
   on real artifacts** — run once, recorded in `docs/audit/`.
3. Three fundamentals are **disclosed in-product** (not buried in a manual): 4× TP
   factor, hosted-plugin RT risk, "spectral difference ≠ quality."
4. Clean checkout reproduces the JUCE white-screen fix (forked module committed/pinned).

That is the bar. It is **days, not a pivot.**

---

## 2. Sequence — MUST-fix / disclose / defer

This is the execution plan. Ordered, owner-typed, no strategy.

### TRACK A — MUST-FIX PRE-DELIVERY (blocks v8.4.1) — Python owner, ~2–3 days
Ordered by "destroys a customer number if shipped":
1. **Per-channel ISP in `encoded_preview.py`** (246/255/290/297). *Reuse the line-185
   per-channel abs.* + regression fixture: hard-panned clip must FAIL.
2. **In-band sentinels must not render as real numbers** (`AnalysisView.tsx:2120`,
   `engineer_profile.py`, comparator sentinels −70.0 LUFS / 0.0 LRA). Minimum viable
   form of Audit-2's "tagged measurement": a single `{value, valid, reason}` wrapper on
   the *emitted verdict numbers only* — do NOT boil the ocean refactoring all 40 sites
   now. **Gate the customer-facing verdict; defer the internal-metric cleanup.**
3. **ViSQOL 16 kHz speech → 48 kHz music mode** (`comparator.py:1919`). One config arg.
4. **mel-L1 mislabel** → rename "perceptual_quality"/"degradation" to
   `spectral_difference` + per-band median subtraction so benign 3 dB EQ stops tripping
   (comparator.py:693–743,1087).

### TRACK B — MUST-FIX RT/STABILITY (blocks RTMsend specifically) — JUCE owner, parallel
RTMsend is a separate ship surface. **Decouple it: ship RTMcompare v8.4.1 standalone
first; RTMsend follows when B closes.** Bugs: `handleBypass(true)` state destruction
(RpcServer.cpp:727), loopCapture data race (PluginProcessor.cpp:804), ARA recycled-pointer
wrong-track audio. Do not let RTMsend's RT-safety work hold the meter hostage.

### TRACK C — DISCLOSE (ships in v8.4.1 as UI/docs, no code-correctness risk)
4× TP factor; hosted-plugin RT risk; spectral-difference-is-not-quality;
16-bit→24-bit pre-AAC note (and fix encoded_preview.py:409 to 24-bit — it's a 1-line
dtype change, promote into Track A if cheap).

### TRACK D — DEFER POST-LAUNCH (file as tracked debt, disclose nothing customer-facing)
soxr/resample_poly install divergence (pin one resampler in the bundle — pick soxr,
document); RTMprofile constant match-score (engineer_profile.py:1005 — **but gate
RTMprofile out of the paid-verdict surface until fixed; a paid score that's always
~50/50 is fraud-adjacent, so this is a SHIP-GATE for RTMprofile, a DEFER for RTMcompare**);
4.5 GB dead ML weights (strip from bundle — also cuts the 5 GB DMG, a real install-UX win);
nperseg/PLR/min(sr_dec,sr) lows.

---

## 3. GTM — ship the meter now & fix, or hold for the certification pivot?

**Ship the fixed meter now. Bank the pivot as the v9 roadmap, do not block v8.4.1 on it.**

GO-mode reasoning: the certification-layer pivot ("RTM Verify — Stripe for audio
delivery compliance," C2PA-signed certs, MCP-wrapped RpcServer, UAI bundle for the
EU-AI-Act Aug-2026 gate) is the *correct long-term direction* and Audit 2 is right that
it's the real moat. **But you cannot sell a certification layer whose underlying meter
emits false PASSes.** The pivot is *built on top of* a trustworthy meter — fixing
Track A is the **prerequisite for the pivot, not an alternative to it.** So there is no
real fork: do Track A regardless. Shipping v8.4.1 now (a) starts revenue, (b) gets the
meter under real masters that will surface the next bug, and (c) earns the trust receipts
the certification story will later sell. Holding everything for the pivot is the classic
go-mode anti-pattern: trading a shippable increment for a strategy slide.

**The Aug-2026 EU-AI-Act window is a real clock** — it argues *for* shipping fast and
iterating, not for a long pre-pivot hold.

---

## 4. Single biggest risk to the company if we ship as-is

**A label or mastering house delivers a clipping master to a streaming platform because
RTMcompare certified it Apple-Digital-Masters PASS — and traces the failure back to us.**

This is not "a bug." For a product whose *entire value proposition and pricing* is
"trustworthy neutral meter," a single false PASS on a flagship customer's release is an
**extinction-class trust event**: it converts the moat (neutrality) into the liability
(we vouched, we were wrong, in writing, on a paid cert). The 5 GB signed DMGs in
`release/` mean this is one distribution action away. **The asymmetry is brutal: the fix
is 6 lines; the downside is the company.** Ship-gate is non-negotiable.

Secondary company risk: **RTMprofile's constant ~50/50 match score billed as a paid
feature** (engineer_profile.py:1005). If a customer ever notices the score doesn't move,
it reads as fraud, not a bug. Gate RTMprofile out of the paid surface until fixed.

---

## 5. First shippable increment + reporting cadence

**First shippable increment: `RTMcompare v8.4.1` (RTMcompare standalone only;
RTMsend + RTMprofile follow their own gates).**

**Definition of done for v8.4.1:**
- Track A (4 fixes) merged, each with a regression test green in `rtm_regression.py`.
- Audit-3 gate run recorded (≥95% benign-EQ specificity, ≥90% artifact sensitivity).
- Track C disclosures visible in-product.
- Clean-checkout build reproduces the JUCE fix (no white screen).
- New 8.4.1 DMGs built + sha256 for arm64 / Intel / Windows; the 8.4.0 bundles in
  `release/` are **pulled/quarantined** so the miscertifying build cannot be distributed.
- RTMprofile paid match-score gated OUT of this release.

**Reporting cadence:** daily one-line status against the four Track-A items + the gate
result; flip to GO the moment the hard-panned-clip fixture goes red→green AND the gate
passes. Owner sign-off required on the gate number before any DMG leaves the building.

**Bottom line:** This is a **GO with a short, well-bounded gate** — not a hold, not a
pivot. The work is days. The danger is that the product is *already packaged*, so
"ship" today is a single click away from the extinction event. Quarantine the 8.4.0
bundles, run the 4-fix sprint, ship 8.4.1.
