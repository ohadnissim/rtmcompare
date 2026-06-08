# Engineering — Senior Systems Architect: RTM Suite Delivery-Readiness

**Lens:** production-grade system architecture, component boundaries, data-flow contracts,
provenance, scalability. I do NOT re-list the three audits' bugs; I rule on whether the
**architecture** (not just the defects) is delivery-ready, and what the target architecture is.

---

## 1. The target architecture vs. what is shipped

The RTM Suite is a 3-process distributed system whose seams are the real risk surface:

```
 DAW ──hosts──▶ RTMsend (JUCE)           RTMcompare (Electron)        RTMprofile (Electron)
                 │ ring-buffer capture     │ main.ts                    │
                 │ RpcServer (TCP/JSON-RPC) │  ├─ python-daemon.ts ──┐   │
                 └───────RPC socket─────────┼─▶│  (1 long-lived proc) │   │
                                            │  └─ python-bridge.ts ──┤   │
                                            │     (spawn-per-analysis)│   │
                                            └────────────────────────┴── python/analyze.main()
                                                                          (comparator / encoded_preview / …)
```

Three independent processes, two IPC protocols (TCP JSON-RPC plug↔app; stdin/stdout JSON-RPC
app↔Python), one shared compute core (`analyze.main()`). The **core is sound** and correctly
shared. My net-new findings are about the **seams and the data contract** that the bug-level
audits saw locally but did not rule on architecturally.

---

## 2. NET-NEW ARCHITECTURAL JUDGMENTS (beyond the three audits)

### A. The fatal pattern (Audit 2's "scalar-certainty") is an ARCHITECTURAL defect, not a bug-list
Audit 2 correctly identified bare scalars + in-band sentinels (`-70.0` LUFS at
`comparator.py:72/90/165/372/1808/1825`, `0.0` LRA) as the disgust risk. My ruling: this is a
**missing type at the system boundary**, and that is why it manifests as ~dozens of separate
"bugs." `analyze.main()` returns an untyped JSON dict; the UI (`AnalysisView.tsx`) has no way to
distinguish "measured −70 LUFS" from "could-not-measure sentinel." **You cannot fix this with N
point-patches** — every new metric re-introduces the trap (Audit 2 counted 40+ "or DEFAULT"
falsy-traps and 20 silent `except:pass`; those are symptoms of the absent contract).

**Target contract (single, enforced at the Python→JSON boundary):**
```
Measurement = { value: float|null, valid: bool, reason: str|null,
                provenance: {algo, version, channel_mode, sr, gating},
                ci?: [lo, hi] }
```
Serialize ONLY through one `emit()` that refuses to write a bare float. This is the *one*
refactor that retires Audit-1 #1's mono-downmix mislabel, Audit-2's sentinels, the soxr/poly TP
fork (provenance now records which resampler ran), and the mel-L1 mislabel — all as instances of
one fix. **This, not the AAC bug, is the highest-leverage delivery item**, because the AAC bug is
one wrong number and the contract gap is *every future wrong number*.

### B. The daemon/spawn FORK is an un-asserted parity hazard (new)
`python-daemon.ts` is "purely additive": on any daemon hiccup `daemonRequest()` rejects and the
caller silently falls back to spawn-per-analysis (`python-bridge.ts`). Both paths call the same
`analyze.main()` (good — verified at `rtm_daemon.py:241-259`), BUT the daemon redirects
`sys.stdout`, mutates `sys.argv`, and **serializes ALL analyses behind one global
`_analyze_lock` (`rtm_daemon.py:81`)** while the spawn path has process-level isolation. Two
consequences a paying customer can hit:
  1. **Silent provenance divergence** — the customer is never told *which* engine produced their
     cert. If the soxr-vs-poly TP fork (Audit-1 MED) lives on one install's libs, the *same file*
     can certify PASS warm and FAIL cold with no audit trail. For a "trustworthy meter" this is a
     credibility bomb. Fix: stamp `engine_path: daemon|spawn` + lib versions into the provenance
     block (folds into fix A).
  2. **Concurrency theater** — the daemon advertises a 4-worker `ThreadPoolExecutor` but the
     analyze lock makes it strictly serial. That's fine for a desktop tool, but it means the
     "parallel-track / B2B SLA" story (per company strategy) has **no horizontal headroom in the
     current process model**. A batch/SLA tier needs N daemon processes behind a queue, not more
     threads. Flag for GTM, not for this ship.

### C. RpcServer is the best-architected seam — and the one un-pinnable dependency
The TCP JSON-RPC layer has explicit version negotiation, per-connection threading, lock-free
`handlePing`, and a method allow-list (`RpcServer.cpp:478-490`). This is production-grade and is
the **right place to harden into the "RTM Verify" MCP layer** (Audit 2's pivot) — the contract is
already a clean RPC surface. BUT the suite **vendors JUCE as a working tree, not a pinned
submodule** (`JUCE/` is a directory, no submodule pin visible). Audit-1 flagged the repaint/
white-screen fix as UNVERIFIABLE for exactly this reason. Architecturally: **an un-pinned native
dependency on the customer-facing render path is a release-blocker independent of any DSP bug** —
a clean checkout can silently reintroduce the white-screen. Pin JUCE to a commit SHA (submodule or
vendored-with-recorded-rev) before any signed build. Same applies to ARA_SDK.

### D. RTMsend lifecycle bugs are a STATE-OWNERSHIP architecture flaw (new framing)
Audit-1's `handleBypass(true)` destroying the plugin (`RpcServer.cpp:727`), the
`loopCapture.samples` race (`PluginProcessor.cpp:804`), the recycled-ARA-pointer→wrong-track, and
the detached-worker-deref-on-shutdown are not four bugs — they are **one missing rule: who owns
the hosted-plugin + capture state and on which thread.** The RPC (network) thread, the audio
callback, and the message thread all mutate shared host state with no single owner. The correct
architecture is a **command queue into the audio thread** (RPC enqueues, audio thread applies at
block boundaries, results posted back) — lock-free, single-owner, and it dissolves all four
defects plus the `setStateInformation` MessageManagerLock hang. This is more than the audits'
point-fixes but is the *cheaper* path to durable correctness on a plugin that captures live audio
into a customer's session.

### E. RTMprofile rests on an un-validated similarity contract — do NOT ship paid
Audit-2 found the paid match-score is effectively constant (cosine on dB+100 saturates,
`engineer_profile.py:1005`) and Audit-1 found per-block integrated-loudness gating misuse
(`build_profile.py:631`). Architecturally these mean **RTMprofile has no validated output
contract at all** — it emits a confident number with no calibration ground truth. Under HARD
CONSTRAINT (a), shipping a *paid* fingerprint score that is mathematically near-constant is the
single largest fraud-perception risk in the suite. Verdict: **RTMprofile is not delivery-ready at
any price; demote to free/beta "experimental" or hold.**

---

## 3. Answers to the board questions

**(1) Shippable for PAID delivery, and minimum bar?**
- **RTMcompare: YES, conditionally.** Minimum bar = the four Audit-1 ship-blockers + ViSQOL
  48kHz/music-mode fix (Audit 2/3) + **fix A (typed-measurement contract through one emit())** +
  **pin JUCE/ARA (fix C)** + pass the dsp-research gate (≥95% specificity benign EQ, ≥90%
  sensitivity real artifacts). Without fix A you ship a meter that *will* re-grow wrong numbers.
- **RTMsend: YES as a capture utility, conditionally** on the four lifecycle bugs (ideally via the
  command-queue refactor D) + the pinned-JUCE verification.
- **RTMprofile: NO for paid.** Ship free/experimental or hold.

**(2) Sequence — must-fix / disclose / defer:**
- **MUST-FIX pre-delivery:** AAC per-channel ISP (Audit-1 #1); typed-measurement contract +
  sentinel suppression (fix A — this *is* the bulk of Audit-2's CRITICALs in one move); ViSQOL
  music/48k; mel-L1 rename+FP fix; pin JUCE/ARA; RTMsend bypass/race (min: point-fix; better:
  command-queue D).
- **DISCLOSE (ship with documented limitation):** 4× TP factor (BS.1770-4-sufficient per Audit 3);
  hosted-plugin real-time risk; daemon-vs-spawn engine identity is now *stamped* not hidden.
- **DEFER post-launch:** command-queue refactor if point-fixes ship first; N-daemon scale tier;
  the RTM Verify MCP/C2PA pivot; ARA region-id rework; dead 4.5GB ML weights removal (size/trust
  hygiene, not correctness).

**(3) GTM — ship now & fix, or hold for the certification pivot?**
**Ship the meter now (RTMcompare, hardened), build the pivot on the seam you already have.** The
RpcServer is already a clean RPC contract (fix C) and the typed-measurement contract (fix A) is
*exactly* the substrate a C2PA-signed "RTM Verify" cert needs. Do not hold revenue for the pivot;
fixes A+C are simultaneously the ship-blocker fixes AND the pivot's foundation. Sequence the EU-AI-
Act/UAI bundle for the Aug-2026 window as a *second* release off the same contract.

**(4) Single biggest risk if shipped as-is:**
**A confidently-rendered wrong number certifies a customer's master, and there is no provenance
trail to explain why.** The AAC mono-downmix PASS (Audit-1 #1) is the first instance; the missing
measurement-type contract (fix A) guarantees there will be more. For a product whose entire value
is *being trustworthy*, a single screenshot of "RTMcompare said PASS, my master clipped on
streaming" is existential — and the daemon/spawn fork (B) means you may not even be able to
reproduce the bad verdict. The architecture, not any one bug, is what makes this risk systemic.

---

## 4. Verdict contribution (Engineering / Systems Architecture)

**CONDITIONAL SHIP for RTMcompare + RTMsend; HOLD RTMprofile-paid.** The compute core and the RPC
seam are production-grade. The blocker is not the DSP — it is a **missing typed-measurement
contract at the Python→UI boundary** plus an **un-pinned native dependency** on the render path.
Both are cheap, and both double as the foundation for the certification-layer pivot.
