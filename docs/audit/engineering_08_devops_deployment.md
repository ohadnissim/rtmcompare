# Engineering Audit 08 — DevOps & Deployment Readiness

**Persona:** Senior DevOps + Deployment Engineer
**Target:** RTM Suite (RTMcompare 8.4.0 · RTMsend · RTMprofile 8.4.0)
**Mode:** Advisory / reports-only. No code run, no files modified.
**Date:** 2026-06-08

> The three prior audits ruled on *correctness* (the meter lies on hard-panned AAC,
> ViSQOL is in speech mode, profile match-score is constant, etc.). This audit does
> **not** re-litigate those. My lens is narrower and orthogonal: **once you decide to
> fix bug #1, can you actually build, sign, ship, and *patch* this product reliably to
> a paying customer — and does the release machinery itself introduce risk to the
> trustworthiness claim?** The answer materially changes the board's GTM call.

---

## Verdict contribution (DevOps division)

**NO-SHIP as-is — but the blocker my lens adds is not a DSP bug, it's that the
release pipeline cannot deliver or repair a trustworthy build.** Two of the prior
audits' recommendations ("ship the meter now & fix later") are **structurally
impossible with the current deployment posture**, because (a) the macOS CI builds
against *stock upstream JUCE*, not the local fork that contains the white-screen fix,
and (b) there is **no working auto-update channel** to push the AAC correctness fix to
already-installed paying customers. You would be shipping an unpatched build with no
patch road back to it.

This is a *correctable* set of pipeline gaps, not a fundamental. But until they are
closed, "ship now and fix" is a fiction — fixing would mean a full manual
re-download-and-reinstall cycle that customers won't perform, leaving the lying meter
in the field indefinitely.

---

## Net-new findings (DevOps lens only — not in Audits 1–3)

### D1 — CRITICAL: CI ships STOCK JUCE; the white-screen/repaint fix is not in release builds
Audit 1 flagged the JUCE repaint fix as "unverifiable — JUCE not vendored." I can now
*resolve* that flag, and the answer is worse than unverified:
- A local JUCE working copy exists and **is a git repo** (`JUCE/.git` present), so a
  fork plausibly carries the fix locally.
- But **CI does not use it.** Both workflows clone a fresh pinned upstream tag:
  `git clone --depth 1 --branch 8.0.12 .../juce-framework/JUCE.git`
  (`.github/workflows/build-mac.yml:62`, `build-windows.yml:51`), and
  `rtm-send-plugin/CMakeLists.txt:73` does `add_subdirectory(${JUCE_DIR} …)` against
  whatever `JUCE_DIR` CI sets — which is the temp clone, **not** the forked tree.
- **Consequence:** every CI-produced (i.e. every *shippable, notarized*) plugin binary
  is built against **unmodified JUCE 8.0.12**. Any locally-applied repaint/white-screen
  fix is silently dropped at release time. The bug the team believes is fixed is
  present in the artifact customers receive.
- **Fix:** make the fork a pinned git submodule (`.gitmodules`, exact SHA) and point
  `JUCE_DIR` at it in CI; OR carry the patch as a tracked `.patch` applied in a CI step
  with a checksum guard. Add a CI smoke step that fails if the patched symbol/line is
  absent. **This must be verified before any release tag.**

### D2 — CRITICAL: No functioning auto-update channel → the "ship & fix later" GTM is unexecutable
- `package.json` has **no `electron-updater` dependency** and **no `publish` block**;
  no `autoUpdater` wiring exists in the Electron main process.
- A `release-build/win-unpacked/resources/app-update.yml` exists
  (`provider: github, owner: ohadnissim, repo: rtmcompare`) and a macOS feed
  `release-build/latest-mac.yml` exists — **but the feed is pinned to version 7.6.5**
  (current product is 8.4.0) with a May-14 release date. The channel is **stale and
  orphaned**, not live.
- **Consequence:** this is strictly worse than "no updater." It signals an update path
  that does not actually deliver 8.4.0+, so a customer who installs today has no
  in-app route to the AAC fix. The only remediation is a full manual reinstall — which,
  for a meter whose entire value is trust, means **the field stays poisoned**.
- **Board implication:** Audits 2 & 3's "promote ViSQOL / fix per-channel ISP and ship"
  assumes you can iterate post-launch. You cannot, today. Either (a) wire and prove a
  real update channel **before** first paid release, or (b) accept that v1 paid is
  effectively immutable and therefore must be *fully* correct at ship — which collapses
  back to "fix all four CRITICALs first."

### D3 — HIGH: AAX / Pro Tools is a non-reproducible, bus-factor-1 release path
- macOS CI (`build-mac.yml`) builds **VST3 + AU only**; it contains **zero** references
  to AAX, `wraptool`, or PACE signing (grep = 0). AAX is built and PACE-signed manually
  on the developer's machine (confirmed by `pace_sign.sh` commit `8e9cad4` and the
  MEMORY note that PACE onboarding is still incomplete).
- **Consequence:** the Pro Tools deliverable — the format used by exactly the
  professional mastering engineers this product is sold to — is produced off-pipeline,
  unsigned in CI, non-reproducible, and dependent on one person's iLok/keychain state.
  If that build differs from the CI VST3/AU (different JUCE, different flags), you can
  ship a *different DSP* to your highest-value segment without knowing.
- **Fix:** AAX must be a CI matrix target with PACE signing as a gated secret, or it
  must be explicitly **descoped from v1** (don't ship Pro Tools rather than ship an
  unreproducible binary to pros).

### D4 — HIGH: Version skew across the suite — plugin installer hardcoded to 1.2.0
- `rtm-send-plugin/CMakeLists.txt` → `project(RtmSend VERSION 8.4.0)`, but the Windows
  bundle and NSIS path reference `RTM-Send-1.2.0-Setup.exe`
  (`build-windows.yml:136,308,345`; README line `build-windows.yml:345`).
- **Consequence:** the binary version (8.4.0) and the installer/marketing version
  (1.2.0) disagree. Support cannot reason about "what version does the customer have,"
  crash reports can't be correlated to a build, and the README tells the customer they
  installed a different version than they did. For a trust product this directly
  undermines defensible provenance (the very thing Audit 2's certification pivot wants
  to sell). **Single source of truth for version, derived at build time.**

### D5 — MED: ~5 GB DMG from bundled model weights with no runtime consumer
- `package.json` `extraResources` embeds **`model-cache/**/*`** (4.0 GB locally:
  a 3.5 GB Mel-RoFormer + 503 MB BS-RoFormer ckpt) plus a ~1.1 GB Python bundle into
  **every** DMG. Audit 2 already flagged these weights as dead (the separator that
  consumes them "doesn't exist").
- **DevOps-specific consequences beyond bloat:** (a) every download is ~5 GB → high
  CDN/egress cost, abandoned downloads, slow notarization (large upload to Apple);
  (b) each bundled ML weight **expands the commercial-distribution license surface**
  (HARD CONSTRAINT (c)) — the RoFormer/ZFTurbo checkpoints carry their own license
  terms that must be cleared for *redistribution*, and you are redistributing 4 GB of
  them for **zero product value**. Strip from `extraResources` and from CI download
  steps before any paid release. This is a fast, high-leverage win.

### D6 — MED: Release hygiene — build artifacts and 45 GB of stale outputs tracked / accumulating
- 19 build-output files are committed to git, including
  `rtm-send-plugin/build-win-cross/*.exe`, `.ninja_deps`, generated
  `JUCEConfig*.cmake`, and a stale `release/RTMcompare-bundle-8.0.0-windows/**`
  tree containing `RTMcompare.exe`, `elevate.exe`, and an old `RTMprofile 1.5.1.exe`.
- `release/` is **45 GB** and `release-build/` **29 GB** on disk.
- **Consequences:** (a) committed binaries are a supply-chain/provenance hazard — a
  signed-meter product cannot have unaudited `.exe`s in its source of truth; (b) a
  stale 8.0.0 bundle in the tree risks being shipped or referenced; (c) repo bloat slows
  every clone/CI checkout. **Purge committed build artifacts; tighten `.gitignore`
  (it covers `release-build/` and `*.dmg` but not `build-win-cross/` or
  `release/RTMcompare-bundle-*-windows/` trees).**

### D7 — MED: No crash/error telemetry, by design — but then no field signal on the trust failures
- No telemetry is intentional and is a *marketing asset* ("no cloud, no upload" —
  bundle READMEs). I am **not** recommending you break that promise.
- But the DevOps consequence must be on the record: with no auto-update (D2) **and**
  no telemetry, if the AAC meter certifies a clipping master as PASS in the field, you
  will receive **zero signal** — the first you hear of it is a customer dispute or a
  public reputation hit. For a trust product this is the worst possible blind spot.
- **Reconcilable fix:** opt-in, local-first, anonymized *correctness* diagnostics
  (e.g. a one-click "export diagnostic bundle" the user chooses to send), not silent
  telemetry. Preserves the privacy moat while giving you a field tripwire.

### D8 — LOW/MED: Linux is a stated constraint but has no build target
- HARD CONSTRAINT (b) names Linux. There is **no** Linux electron-builder target
  (no AppImage/deb/snap) in either app, and no Linux CI job.
- Either descope Linux from the constraint explicitly, or accept it as a known gap;
  do not let the constraint imply a deliverable that the pipeline cannot produce.

---

## What is genuinely solid (DevOps lens)

- **macOS signing + notarization is correctly implemented**: hardened runtime,
  `notarize: true`, Developer ID into an ephemeral keychain, `notarytool --wait` +
  `stapler staple` + `spctl` gate (`build-mac.yml:121–403`). Entitlements are
  appropriately *minimal* — note the deliberate removal of
  `disable-executable-page-protection` and the documented rationale for keeping
  `disable-library-validation` (bundled Python C-extensions). This is mature work.
- **Windows path signs both the NSIS installer AND the portable EXE** (an explicitly
  fixed past defect, `build-windows.yml:266–280`) — correct; an unsigned portable EXE
  is a SmartScreen trap.
- **Reproducible, pinned toolchain**: JUCE 8.0.12 tag, Python pinned to 3.11 with a
  documented reason (`onnxruntime==1.19.2` wheel availability), Node 20.18.0, universal
  arm64+x86_64 plugin build. Pin discipline is good — the gap (D1) is *which* JUCE.
- **The self-contained Python bundle is handled carefully**: `--copies` venv plus an
  explicit absolute-symlink scrubber so `codesign --strict --deep` accepts it
  (`build-mac.yml:182–209`). This is the kind of detail that usually bites teams late.
- **Graceful degradation**: builds proceed unsigned if secrets are absent; both
  platforms gate cleanly.

---

## Board-question answers (DevOps contribution)

**(1) Shippable for paid delivery, min bar?** No. My division's minimum bar **on top of
the prior audits' four CRITICALs** is: D1 (CI builds the patched JUCE — verified by a
failing-if-absent smoke check), D2 (a *proven* update channel OR an explicit board
decision that v1 paid is immutable and therefore must be fully correct at ship), D3
(AAX in CI or descoped), and D4 (single version source). D5/D6 are pre-ship hygiene
that are cheap and should ride along.

**(2) Sequence — fix / disclose / defer?**
- **MUST-FIX pre-delivery (pipeline):** D1, D2, D4. These gate whether a fix can even
  reach a customer.
- **MUST-DECIDE pre-delivery:** D3 (sign-in-CI vs descope AAX), D5 (strip 4 GB weights).
- **Disclose:** D7 (no telemetry → no field signal — make this an explicit accepted
  risk at board level), D8 (Linux gap).
- **Defer post-launch (after D2 is real):** D6 repo hygiene can be progressive.

**(3) GTM — ship the meter now & fix, or hold for the certification pivot?** The
certification-layer pivot (Audit 2) is the *correct* long-term moat, and — importantly
from my lens — it **forces the exact deployment maturity that's missing today**:
C2PA-signed certs demand reproducible, provenance-clean, single-version builds (D1/D4/D6)
and an update/revocation path (D2). My recommendation: **do not ship the consumer meter
"now & fix"** (D2 makes "fix later" a lie). Instead, fix the four CRITICALs + D1/D2/D4,
ship a *correct* v1 to a **small, design-partner B2B cohort under SLA** (RTM Audio is a
company — this is viable), and use that controlled channel — where you *can* push
updates and you *do* get direct feedback in lieu of telemetry — to harden toward the
certification pivot. Controlled rollout buys both correctness confidence and the
deployment maturity the broad launch will require.

**(4) Single biggest risk if shipped as-is (DevOps framing):** You ship a build that
(a) **does not contain the fix you think it does** (D1 — stock JUCE) and (b) **you
cannot patch in the field** (D2 — dead update channel) and (c) **you get no signal when
it fails** (D7 — no telemetry). The lying-AAC meter therefore reaches a paying customer,
stays there permanently, and surfaces only as a public trust failure — which is
existential for a company whose entire proposition is *being the trustworthy meter*.

---

## Highest-priority DevOps recommendation

**Before any paid release, prove that a CI-produced, notarized build (i) is compiled
against the patched JUCE (D1) and (ii) can be updated in the field via a live channel
(D2).** Encode both as hard CI gates: a smoke check that fails the build if the JUCE
repaint-fix marker is absent, and a release step that publishes a *current* update feed
with `electron-updater` actually wired. Until those two are green, "ship now and fix
later" is not a strategy the pipeline can honor — and the trust product cannot afford a
field defect it can neither prevent nor repair.
