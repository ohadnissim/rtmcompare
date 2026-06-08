# Engineering Audit 05 — Senior Onboarding Engineer

**Lens:** Senior engineer who just joined this codebase. Reverse-engineer the
architecture and data flow, then rule on **structural / reproducibility /
maintainability** risk. I do NOT re-list the three prior audits' bugs — I add
the net-new judgment that only the "fresh eyes on the whole system" lens
surfaces, and I **resolve one open question Audit 1 left unverifiable.**

**Division verdict contribution: NO-SHIP until the build is reproducible.**
The correctness bugs (Audits 1–3) are real, but they are *fixable scalars*. The
deeper problem a newcomer sees first is that **the shippable artifact cannot be
reproduced from version control** — and the customer-facing measurement engine
is wired through a CLI-emulation shim, not a library API. Both are structural,
both silently regress, and both are invisible to the per-bug audits.

---

## 1. Architecture breakdown (as-built)

### Current pipeline (reverse-engineered)

```
                          RTM Suite (one repo, three products)
 ┌──────────────────────────────────────────────────────────────────────┐
 │ RTMcompare (Electron + React + Python)                                 │
 │                                                                        │
 │  React UI (src/, AnalysisView.tsx)                                     │
 │      │ IPC (preload.ts → main.ts)                                      │
 │      ▼                                                                 │
 │  electron/python-daemon.ts  ── newline-framed JSON-RPC ──┐             │
 │      • spawn() one long-lived Python                     │ stdin/stdout│
 │      • MAX_RESTARTS=3 → then state='dead' permanently     │            │
 │      ▼                                                    ▼            │
 │  python/rtm_daemon.py  (_dispatch_request → _handle_analyze)           │
 │      • acquires module-global _analyze_lock (single-flight)            │
 │      • monkeypatches sys.stdout / sys.argv / module.progress           │
 │      • calls analyze.main()  ← the LEGACY CLI ENTRYPOINT               │
 │      • json.loads( captured stdout text )   ← CLI-as-API               │
 │      ▼                                                                 │
 │  python/analyze.py → comparator.py (2,635 LOC god-module, 8 importers) │
 │      → encoded_preview / engineer_profile / atmos_* / click_detector*  │
 │      → BS.1770-4 core (SOLID per Audit 1)                              │
 │                                                                        │
 │  Bundled: model-cache/ = 4.0 GB on-disk weights (largely dead)         │
 └──────────────────────────────────────────────────────────────────────┘

 ┌───────────────────────────────┐     ┌──────────────────────────────────┐
 │ RTMsend (JUCE plugin)         │     │ RTMprofile (Electron helper)      │
 │  hosts 3rd-party EQ + ARA     │     │  engineer_profile.py fingerprint  │
 │  ring-buffer capture          │     │                                   │
 │  RpcServer.cpp → RTMcompare   │     │                                   │
 └───────────────────────────────┘     └──────────────────────────────────┘

 BUILD INPUTS (the load-bearing finding):
   JUCE/        → git-ignored (.gitignore:71); nested standalone git repo;
                  detached HEAD 501c0767; 9 modules locally modified,
                  UNCOMMITTED, machine-only.
   CI (build-mac.yml:62) → git clone --depth 1 --branch 8.0.12  (STOCK)
                  → no patch step → forked fixes NOT applied on CI.
```

### Proposed pipeline (target)

```
 React UI → IPC → daemon.ts → rtm_daemon.py
                                  │
                                  ▼  in-process LIBRARY call (not CLI)
                          analyze_api(file_a, file_b, opts) -> dict
                                  │  returns tagged measurements
                                  ▼
                          comparator/ package (split god-module)

 BUILD: JUCE pinned as a git submodule (or vendored+committed) at the
        FORKED commit; CI builds from that pin; patches live in VCS.
```

---

## 2. Critical problem areas (ranked) — NET-NEW judgment

### C-1 (SHIP-BLOCKER, net-new — resolves Audit 1's open question)
**The shipped binary cannot be reproduced from source control; the
white-screen / VST3-resize fixes exist only as uncommitted local edits.**

Evidence:
- `.gitignore:71` ignores `JUCE/`; parent repo tracks **0** files under it
  (`git ls-files JUCE | wc -l` = 0).
- `JUCE/` is a *nested standalone git repo* at detached `501c0767`, with
  uncommitted working-tree edits to **9 modules / 61 insertions**, including:
  `juce_NSViewComponentPeer_mac.mm` (+15 — the macOS repaint/white-screen
  surface), `juce_audio_plugin_client_AAX.cpp` (+18), `juce_DirectX_windows.cpp`,
  `juce_Direct2DHwndContext_windows.cpp`, `juce_gui_basics.cpp` (+5),
  `juce_ARAAudioReaders.cpp` (+8), `juce_TargetPlatform.h`.
- CI (`build-mac.yml:60-62`) does `git clone --depth 1 --branch 8.0.12`
  of **stock** JUCE with **no patch/apply step**.

**Consequence:** a clean CI release ships **stock JUCE** — i.e. *without* the
forked fixes. Audit 1 correctly flagged the repaint fix as "UNVERIFIABLE —
JUCE not vendored." I can now rule it: **it will regress on the next clean
build.** The fixes ride on one developer's disk. This is also a bus-factor and
supply-chain failure: nothing records *which* upstream commit was forked or
*why* those 61 lines exist. This single item makes the suite NON-SHIPPABLE
independent of any DSP bug, because the artifact QA blesses is not the artifact
CI produces.

**Fix (small, mechanical, high-leverage):** convert `JUCE/` to a committed git
submodule pinned at the forked SHA (or commit the fork to an `rtm/juce-8.0.12`
branch); change CI to check out that pin; delete the stock-clone step. Add a
build-time assertion that the expected patch hashes are present. Until this is
done, *every* downstream sign-off is provisional.

### C-2 (HIGH, net-new — architecture)
**The customer-facing measurement engine is invoked as a CLI emulation, not a
library** (`rtm_daemon.py:237-296`). The daemon redirects `sys.stdout` to an
`io.StringIO`, fakes `sys.argv = ["analyze.py", file_a, file_b, "--fast", …]`,
calls `analyze.main()`, then `json.loads()` the captured stdout text
(`:262, :266-276`). Implications a newcomer flags immediately:
- **Stdout is the API channel AND the RPC channel.** Any stray `print()`, any
  third-party library banner, any warning to stdout inside the deep call tree
  corrupts the JSON and surfaces as a fake "error" (or worse, a mis-parsed
  number). This is fragile precisely where trust is the product.
- **Single-flight global lock** (`_analyze_lock`): the company-strategy brief
  says B2B/SLA/parallel-track is viable, but this engine **physically cannot
  run two analyses concurrently** — it serializes on a module global that
  guards shared `sys.stdout`/`sys.argv`. Any SLA/throughput story is blocked
  by this design, not by hardware.
- **TOCTOU at `:248-251`:** acquire-nonblocking → *release* → re-`with`-acquire.
  Between the release and the re-acquire another request can win the lock, so
  the "busy" guard is racy under real concurrency.

**Fix:** extract a pure `analyze_api(file_a, file_b, opts) -> dict` that returns
a structure and never touches stdout/argv; the CLI becomes a thin wrapper over
it; the daemon calls it directly. Removes the lock's *raison d'être* and the
print-pollution class of failures in one move.

### C-3 (HIGH, net-new — failure observability)
**29 silent/broad `except` blocks in `analyze.py` and 35 in `comparator.py`.**
Combined with Audit 2's "scalar-certainty" finding, this is the mechanism by
which a swallowed exception becomes a confident wrong number: an optional
sub-measurement throws, the `except` eats it, a sentinel/default scalar flows
out, and the daemon — which only sees the final JSON — cannot tell a real
measurement from a defaulted one. Audit 2's `{value,valid,reason,provenance}`
fix is correct; **it is unenforceable until these silent excepts are converted
to recorded failures.** The daemon already has the hook: `_analyze_mod._optional_failures`
is cleared per run (`:253`) but is not surfaced into the result contract.

### C-4 (MED, net-new — duplicate logic / dual code paths)
`click_detector.py` is a dispatcher that imports **both** `click_detector_v1`
**and** `click_detector_v2` and ships both. This is the same shape as Audit 1's
`soxr-vs-resample_poly` and "streaming dead-band" forks: **multiple algorithm
versions co-resident, selectable, producing different customer numbers.** For a
trustworthy-meter product, two code paths for one measurement is a correctness
hazard, not just clutter. Pick one per metric, delete the other, and pin the
resampler/backend so two installs cannot disagree.

---

## 3. Duplicate-logic / dead-code / weight findings

- **4.0 GB `model-cache/`** bundled (confirms Audit 2's "4.5GB dead ML weights
  for a separator that doesn't exist"). This bloats every installer on every
  platform, slows notarization, and ships unused (possibly license-encumbered —
  *verify each weight's license against the no-GPL/no-CC-BY-NC constraint
  before any ship*). Strip from the bundle or gate behind an explicit opt-in
  download.
- `click_detector` / `click_detector_v1` / `click_detector_v2` /
  `click_repair_v2` — versioned forks co-resident (see C-4).
- `rtm_fast.py` + `rtm_fast_bench.py`, `declick.py` + `click_repair_v2.py` —
  audit which are live vs scratch; bench files should not be in the shipped
  bundle.
- `comparator.py` = **2,635 LOC**, imported by 8 modules — a god-module and the
  single highest-churn risk surface; every Audit 1/2 correctness bug lives
  inside it. Splitting it (loudness / truepeak / spectral / codec / verdict)
  is the prerequisite for making the per-metric fixes testable in isolation.

---

## 4. Refactoring strategy (sequence, no functional change)

1. **Make the build reproducible (C-1).** JUCE → committed submodule at forked
   SHA; CI checks out the pin; assert patch presence. *Gate every other
   sign-off on this.*
2. **Library-ize the engine (C-2).** `analyze_api()` returns a dict; CLI + daemon
   both call it; delete stdout/argv monkeypatching and the global lock.
3. **Surface failures (C-3).** Route `_optional_failures` into the result
   contract; this is the substrate Audit 2's tagged-measurement type needs.
4. **De-duplicate algorithms (C-4)** and **strip the 4 GB weights** (§3).
5. **Split `comparator.py`** along measurement boundaries so the Audit 1/2
   per-metric fixes (AAC per-channel ISP, mel-L1 rename, ViSQOL 48 kHz) land in
   small, independently testable modules.

---

## 5. Board answers (engineering-onboarding contribution)

1. **Shippable for PAID?** No — minimum bar adds one item the per-bug audits
   could not see: **CI must build the forked JUCE that QA actually tested**
   (C-1). Without it, fixing every DSP bug still ships an unfixed binary.
2. **Sequence:** *MUST-fix pre-delivery* = C-1 (reproducible build) +
   C-2/C-3 are prerequisites for trusting the Audit-2 measurement-type fix.
   *Disclose:* dual code paths' numeric variance until C-4 lands.
   *Defer:* god-module split, weight stripping (do early — cheap, large win).
3. **GTM:** The certification-layer pivot ("RTM Verify") is attractive but
   **cannot be sold until C-1+C-2 are fixed** — a certification product whose
   own binary is non-reproducible and whose engine is a CLI shim cannot carry a
   C2PA-signed-cert / SLA promise. Fix the foundation, *then* the pivot is the
   right bet (the neutral-grader moat is real). Do not ship the meter "now &
   fix" while C-1 stands: you would be shipping the un-fixed binary.
4. **Single biggest risk if shipped as-is (my division's pick):** **silent
   regression of platform fixes.** A clean release rebuild drops the forked
   JUCE patches and the white-screen / resize-crash defects return on
   customers' machines — with the team believing they were fixed because the
   fix "works on the dev box." That is a trust-destroying, hard-to-diagnose
   field failure for a paid B2B tool, and it is invisible to every audit that
   reads source instead of the build graph.
