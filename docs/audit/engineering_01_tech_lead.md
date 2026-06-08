# Engineering — 01 Senior Tech Lead

**Verdict contribution: NO-SHIP for paid delivery as-is.** Not because of the four
correctness bugs the audits already found (those are fixable in days), but because
the **engineering process that produced them will keep producing them, and the build
pipeline does not ship the code that was tested.** I am the owner who has to keep this
product trustworthy for five years. From that seat, the product is closer than the bug
list suggests, but the *system around the code* is the real blocker.

I do not re-list the known bugs. I add the judgment only the long-term-ownership lens
surfaces. Three findings below are **net-new and at least as serious as Audit-1 #1.**

---

## NET-NEW FINDING A — The shipped binary does not contain the fix you tested (CONFIRMED SHIP-BLOCKER)

Audit 1 flagged the JUCE repaint/white-screen fix as "UNVERIFIABLE — JUCE not vendored."
It is worse than unverifiable; it is **confirmed broken in CI.**

- `.gitignore:71` ignores `JUCE/`. `git ls-files JUCE/` returns **0 tracked files.** There is
  no `.gitmodules`. The forked module exists only in the developer's working tree.
- `.github/workflows/build-mac.yml:60` **clones stock JUCE 8.0.12 fresh** on every build.
- Therefore the DMG/VST3/AU you sign, notarize, and sell is built against **upstream JUCE,
  not your fork.** Any white-screen repaint fix the dev made locally is absent from the
  customer artifact. The thing you QA'd by hand on your Mac is not the thing in the installer.

This is the classic "works on my machine" failure mode, elevated to a shipped-product
defect. It also means the build is **not reproducible** and a CI cache eviction can
silently change plugin behavior between two releases of the same version string.
For a company whose entire pitch is *trustworthiness*, an unpinned, unversioned core
dependency in the host plugin is disqualifying on its own.

**Fix (smallest safe step):** vendor JUCE as a pinned git submodule at the exact forked
SHA, or commit the fork into the tree and delete the CI `Clone JUCE` step. Until the CI
build is bit-traceable to a committed source tree, nothing should ship.

## NET-NEW FINDING B — There is no test of correctness anywhere; the regression harness gives false confidence

`rtm_regression.py` (903 lines) is the *only* test asset. There are **zero unit tests**
(`find … -name 'test_*.py'` → nothing outside vendored deps; no `conftest.py`, no
`pytest.ini`). I read the harness end-to-end. Every check is one of:

- **Structural presence** — "field `true_peak_a` exists in `headroom`" (`rtm_regression.py:519-520`),
  "categories is a non-empty list" (`:524`).
- **Coarse sanity ranges** — "lufs is between −50 and −3" (`:502-504`).

There is **not a single golden-value assertion** — no `np.isclose` against a known-correct
LUFS/ISP/LRA number, no reference fixture with an externally-verified answer. Search for
`isclose`/`tolerance`/`abs(` in the harness returns only the sine-generator helpers.

**Consequence that directly bears on the board question:** Audit-1 #1 (the 6 dB ISP
under-read that certifies a clipping master as PASS) and Audit-2's ViSQOL-in-speech-mode
bug **both pass this harness green.** A wrong number that is the right *shape* is invisible
to every test you have. For a measurement product where "accuracy of every customer-facing
number is non-negotiable," shipping with no numerical regression net means the next
correctness bug reaches a paying customer before you do — and you will not find out until
they do.

This is why I rule NO-SHIP on *process*, not just bugs: fixing the four flagged bugs
without adding golden-value tests means you have fixed the four bugs you know about and
locked in the discovery pattern for the next four.

## NET-NEW FINDING C — CI has no quality gate at all; it is build-sign-notarize only

`build-mac.yml` runs: read versions → clone JUCE/ARA → build plugin → sign → build python
bundle → **download two ~2GB RoFormer ckpts** (`:228-254`) → npm install → build DMG. There
is **no step that runs `rtm_regression.py`, pytest, npm test, or any assertion.** A red build
is a *compile* failure only. Correctness is entirely manual and entirely undocumented.

Corollary the audits touched but the ownership lens sharpens: CI **downloads and bundles
~4 GB of separator weights** (also present in `release-build/win-unpacked/resources/model-cache/`)
for a separator that does not exist in the product. Beyond the bloat, **those `.ckpt`
weights carry a license-provenance question** (BS/Mel-RoFormer checkpoints are commonly
research/non-commercial) that lands squarely on hard-constraint (c) commercial-distribution
safety. This needs a license sign-off before any paid DMG ships, independent of the audio bugs.

---

## Answers to the board questions

**(1) Shippable for paid delivery, and under what minimum bar?**
No, not today. Minimum bar to ship for money:
- **P0a** Audit-1 #1 (per-channel ISP; stop the false PASS cert). The product's one
  unforgivable failure is certifying a clipping master as compliant.
- **P0b** Finding A — make CI build the forked JUCE from committed/pinned source. The binary
  must contain the code you tested.
- **P0c** Finding C-license — get written commercial clearance for the bundled ckpts, or
  rip the 4 GB of dead weights out of the shipped bundle entirely (preferred — they serve
  no feature).
- **P0d** Audit-2's acted-on sentinels (−70 LUFS / 0.0 LRA rendered as real advice,
  `AnalysisView.tsx:2120`) and the RTMprofile constant match-score (`engineer_profile.py:1005`)
  — both are "confidently wrong to a paying customer," same risk class as #1.
- **P0e** A **golden-value regression suite** with ≥10 externally-verified fixtures
  (known LUFS/ISP/LRA, hard-panned transient case, benign-EQ case, real-artifact case),
  wired into CI as a blocking gate. This is the cheapest insurance against the *next* #1.

**(2) Sequence — MUST-fix / disclose / defer.**
- **MUST-fix pre-delivery:** P0a–P0e above, plus Audit-1's HIGH RTMsend `handleBypass`
  state-destruction and the `loopCapture` data race (a crash/garbage-audio bug in a hosted
  RT context is a support nightmare and a trust-killer), and the mel-L1 mislabel (rename to
  `spectral_difference` + the per-band median FP fix — a label that calls a 3 dB EQ a
  "quality degradation" erodes meter trust).
- **Disclose (ship with honest copy):** 4× TP factor (Audit-3 confirms sufficient per
  BS.1770-4 Annex 2 — do not gold-plate to 8×); hosted-plugin RT risk; soxr-vs-resample_poly
  0.3–0.5 dB cross-install TP divergence (pin one resampler in the bundle to make this
  deterministic — a "trustworthy meter" cannot give two numbers on two machines).
- **Defer post-launch:** ARA recycled-region-id, MED-tier shutdown deref, nperseg floor,
  PLR mislabel, Atmos-on-mono-sum (gate the Atmos verdict behind a "beta" badge until fixed).

**(3) GTM — ship the meter now & fix, or hold for the certification pivot?**
Ship the **fixed meter now**; do **not** hold for the "RTM Verify / Stripe-for-delivery"
pivot. The pivot is the right 18-month direction and the patentable in-DAW capture loop is
real white space — but a certification *layer* is only sellable if the underlying meter is
provably correct, and right now it demonstrably is not (Findings A–C). You earn the right to
sell certification by first making the meter trustworthy and *traceable*. The tagged-measurement
type from Audit-2 (`{value, valid, reason, provenance}`) is the correct bridge: build it now
as the internal data model (it directly fixes the sentinel-as-real-number class), and it
becomes the substrate for C2PA-signed certs later. One architecture, shipped incrementally.

**(4) Single biggest risk to the company if we ship as-is.**
**A paying mastering engineer trusts a green "Apple Digital Masters PASS" (or a ViSQOL/
match-score number), delivers to a label, and the master is rejected or audibly clips.**
The product's entire value proposition is "trust this number." The first publicly-burned
engineer ends RTM's credibility in a small, tight-knit, reputation-driven market — and
because CI ships stock JUCE and has no golden-value gate, *you cannot even reproduce or
prove what number you actually shipped them.* The reputational loss is uninsurable and,
for a measurement company, existential.

---

## Production-readiness gaps (ownership view, beyond the bug list)
- **No correctness test suite + no CI quality gate** (Findings B, C) — the top structural debt.
- **Unpinned core dependency** (JUCE fork unversioned; Finding A) — reproducibility hole.
- **No bit-traceability** from a release DMG back to a committed source SHA for the plugin.
- **4 GB dead weights** shipped (cost, install time, license exposure).
- **40+ `or DEFAULT` falsy-traps and 20 silent `except: pass`** (per Audit 2) — these are why
  sentinels reach the UI as real numbers; they convert "no measurement" into "a confident
  wrong measurement." Sweep these as part of the tagged-measurement refactor, not piecemeal.
- **Three Electron/JUCE products, one dev tree, one structural-only test** — the maintenance
  surface is large and currently under-defended. Before scaling features, scale the safety net.

## Clarifying questions I need answered before committing to a ship date
1. Team shape: who owns the JUCE fork, and is there appetite to vendor + write the golden
   suite (≈1–2 eng-weeks) before launch, or is this a solo crunch? (Determines P0e feasibility.)
2. Provenance: do we have a commercial license for the bundled RoFormer ckpts, or can we
   delete them outright? (Hard blocker either way.)
3. Is the Apple Digital Masters PASS/FAIL string customer-facing today, or behind a flag?
   (Determines whether #1 is "fix before any sale" or "already shipped — incident response.")
4. Are RTMsend (hosted-plugin RT) and the Atmos path in the paid SKU at launch, or can they
   ship as labeled beta to shrink the P0 surface?
