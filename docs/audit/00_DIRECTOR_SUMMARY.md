# RTM Suite — Delivery-Readiness Director Summary

**Scope:** RTMcompare v8.4.0 + RTMsend + RTMprofile. Synthesis of 3 technical audits + 25 board-member reports. Director judgment (CEO+CTO+CPO+CFO lens). Date: 2026-06-08.

Director-verified facts (read directly, not re-derived): JUCE gitignored (`.gitignore:71`), untracked (`git ls-files JUCE` empty), no `.gitmodules`, CI clones stock 8.0.12 (`build-windows.yml:51`); AAC mono downmix confirmed live (`encoded_preview.py:246/255/290`, binary verdict `:297`); `rtm_certify.py` present in shipping `python/`; `model-cache/` = 4.0 GB on disk.

---

## 1. HEADLINE VERDICT

**GO-WITH-CHANGES — NO-GO for paid delivery as-is.** Minimum bar to ship for money: close the **lie-class** (every customer-facing number that can be confidently wrong) behind a typed-measurement contract, make the **shipped binary bit-traceable to the tested source** (JUCE fork pinned + CI gate), **neutralize the signed certificate path**, and **pass a real-master parity gate** — not just the four named point-fixes.

The core BS.1770-4 engine is solid. The product is not unshippable because the math is wrong; it is unshippable because it **emits confident wrong verdicts, signs them, and ships a binary that does not contain the code that was tested.**

---

## 2. THE SINGLE BIGGEST COMPANY RISK IF SHIPPED AS-IS

**RTM mints a cryptographically "signed," forwardable Apple-Digital-Masters PASS certificate on a clipping master it under-reads by ~6 dB — and the signature is forgeable.** This is the convergence point flagged independently by war-room, adversarial, red-team, reinvent, and stress-test: the mono-downmix ISP bug (`encoded_preview.py:246/297`) feeds a *signed, ID'd, forwardable* certificate (`rtm_certify.py`, `Certificate.tsx`), and that signature is a per-machine local HMAC (`rtm_certify.py:199-231`) — meaningless as attestation, trivially forgeable by the customer, yet carrying RTM's name as a warranty.

For a company whose *only* asset is being the trustworthy neutral meter — and whose sister product UAI stakes EU-AI-Act-grade credibility on the same brand — one screenshot of a wrong signed PASS is **irreversible**: it resets the entire WTP ceiling to the free-meter floor (iZotope Insight is now free), converts the sole moat into the competitor's selling point, and contaminates UAI. A meter may crash (reversible); a meter may not lie under signature (irreversible).

---

## 3. P0 / P1 / P2 TABLE

Ranked by (hard-constraint impact × inverse effort). Owner divisions: ENG=engineering, DSP=measurement, REL=release-eng/devops, PROD=product, GTM=launch.

### P0 — MUST-FIX before any paid delivery

| # | Finding | File:line | Owner | Effort | Flagged |
|---|---------|-----------|-------|--------|---------|
| P0-1 | **AAC ISP verdict on mono downmix → false PASS** on hard-panned clip. Per-channel max; the per-channel abs already exists at `:185` and is discarded. | `encoded_preview.py:246/255/290/291/297` | DSP | S | 22/25 |
| P0-2 | **JUCE fork NOT in shipped binary** — gitignored, untracked, CI clones stock 8.0.12. White-screen/VST3-resize fix lives only on one dev's disk. Pin as committed submodule at forked SHA + CI gate that fails if patch marker absent. **Verified by Director.** | `.gitignore:71`, `build-windows.yml:51`, CMakeLists `add_subdirectory` | REL | M | 7/25 |
| P0-3 | **Signed certificate is a forgeable warranty on a wrong number.** For v8.4: disable/hard-gate the cert path, drop the word "certificate" + HMAC, default to "NOT CERTIFIED, reason." (Real cert = server-side Ed25519, future product.) | `rtm_certify.py:90/187/199-231`, `Certificate.tsx`, `AnalysisView.tsx:354` | PROD/ENG | S–M | 6/25 |
| P0-4 | **Acted-on in-band sentinels** (-70 LUFS / 0.0 LRA rendered as real numbers, advice given on 2s clips). | `comparator.py:72/90/165`, `AnalysisView.tsx:2119-2120` | ENG/DSP | M | 9/25 |
| P0-5 | **Typed-measurement contract** `{value,valid,reason,domain,provenance}` at the Python→IPC→UI boundary; invalid → absent, never a confident scalar. This is the *structural* fix that retires P0-1/P0-4 and the next undiscovered instance. **Make it a ship gate, not post-launch.** | new boundary type; sentinels, AAC, ViSQOL, profile primitives | ENG-arch | M–L | 11/25 |
| P0-6 | **ViSQOL in 16 kHz SPEECH mode for a music tool** — wrong model, customer-facing perceptual score. Set 48 kHz audio mode. | `comparator.py:1915/1919` | DSP | S | 6/25 |
| P0-7 | **Real-master parity gate** — 20-30 commercial masters vs 2 certified reference meters, gated to published tolerances; INCLUDING a hard-panned anti-correlated transient AAC fixture that must return FAIL. Replaces "fix #1-4" as the actual ship criterion. No golden-value test exists today. | new `tests/`; `rtm_regression.py` asserts only shape | DSP/ENG | M–L | 5/25 |
| P0-8 | **RTMprofile paid match-score is mathematically constant ~50/100** (cosine on dB+100 offset doesn't cancel). PULL from paid surface; do not fix under deadline. A paid score that never moves reads as fraud. | `engineer_profile.py:1005/1008` | PROD | S (pull) | 6/25 |
| P0-9 | **Delete 4.0 GB dead ML weights** (RoFormer/demucs/audio_separator — never imported; CC-BY-NC → HARD-CONSTRAINT-c violation + dormant `torch.load` RCE primitive + redistribution surface). Free win. **Verified 4.0 GB.** | `model-cache/uai_root/*.ckpt` | REL/SEC | S | 7/25 |

### P1 — fix-soon or disclose

| # | Finding | File:line | Owner | Effort | Flagged |
|---|---------|-----------|-------|--------|---------|
| P1-1 | **Single true-peak engine** — TP primitive duplicated across 10+ files; soxr-vs-resample_poly + intel-vs-arm64 fork gives same master two PASS/FAIL verdicts. Collapse onto one audited per-channel engine. | comparator.py + encoded_preview.py + rtm_certify.py | DSP | M | 5/25 |
| P1-2 | **mel-L1 "perceptual_quality"/"degradation" verdict** trips on benign 3 dB EQ — rename to `spectral_difference`, add per-band median subtraction. | `comparator.py:693-743/1087` | DSP | S–M | 4/25 |
| P1-3 | **RTMsend handleBypass(true)** destroys plugin+state, no un-bypass branch, bypassed atomic never written. | `RpcServer.cpp:727` | ENG | M | 3/25 |
| P1-4 | **No live update channel** (no electron-updater, orphaned `latest-mac.yml` at v7.6.5) — cannot push the P0 fix to installed customers; "ship & fix" is structurally impossible without it. | release pipeline | REL | M | 1/25 |
| P1-5 | **Cache leak** — `_load_audio_cached` `cache_clear()` never called → multi-GB OOM on album batch; main `compare()` bypasses cache → every file decoded twice. | `comparator.py:12-20/2518` | ENG-perf | S | 1/25 |
| P1-6 | **16-bit truncation before AAC encode** — measures a 16-bit artifact, not the codec; use 24-bit. | `encoded_preview.py:409` | DSP | S | 2/25 |
| P1-7 | **Demote certification copy** across README/UI (README leads with "Apple Digital Masters pass/fail", "Ready-to-Deliver") to measurement/flag words until P0-1/4/6 land + parity gate passes. README version drift (5.7.0 vs 8.4.0). | README, copy/UI | GTM | S | 4/25 |
| P1-8 | **Audio-thread heap alloc** (`dest.insert` on RT thread) + data race on `loopCapture.samples` copied without callback lock; faulted hosted block captured into ring. | `PluginProcessor.cpp:347/376/804` | ENG | M | 2/25 |
| P1-9 | **daemon busy-lock unreachable** (acquire-then-release before re-acquire) — the 30-min hang it claims to fix is still live; also blocks SLA/parallel-track. | `rtm_daemon.py:248-251` | ENG | S | 1/25 |
| P1-10 | **No landing/waitlist/email-capture** exists — the gating GTM gap for a controlled launch. | infra | GTM | M | 1/25 |
| P1-11 | **Quarantine the already-packaged 8.4.0/7.5.5 bundles** in `release/` — buggy `encoded_preview.py` is byte-identical staged. Confirm none reached a customer (else recall). | `release/**` staged bundles | REL | S | 3/25 |

### P2 — defer post-launch

| # | Finding | File:line | Owner | Effort | Flagged |
|---|---------|-----------|-------|--------|---------|
| P2-1 | RTMprofile per-block integrated-loudness gating misuse | `build_profile.py:631` | DSP | M | 1/25 |
| P2-2 | setStateInformation MessageManagerLock hang; detached RPC workers deref freed state; ARA recycled-pointer wrong-track | RpcServer/PluginProcessor/ARA | ENG | M | 1/25 |
| P2-3 | GIL-bound ThreadPoolExecutor over CPU-bound numpy (false batch parallelism) | comparator batch path | ENG-perf | M | 1/25 |
| P2-4 | PLR mislabel; nperseg floor at 48k; min(sr_dec,sr) TP-axis | comparator/encoded_preview | DSP | S | 1/25 |
| P2-5 | ~40 "or DEFAULT" falsy-traps + ~64 silent `except:pass` (subsumed by P0-5 once enforced) | analyze.py/comparator.py | ENG | M | 3/25 |
| P2-6 | No Linux target despite stated cross-platform constraint | CI | REL | M | 1/25 |
| P2-7 | AAX/PACE signed off-CI (bus-factor-1); installer version skew 1.2.0 vs 8.4.0; committed `.exe`/45GB stale `release/` | release pipeline | REL | M | 1/25 |
| P2-8 | `.scrub-fingerprints.py` as CI gate; verify notarized + hardened-runtime | CI | SEC | S | 1/25 |

---

## 4. DISCLOSE LIST (state honestly in docs, do not "fix")

1. **4× oversampling true-peak is sufficient** (BS.1770-4 Annex 2). Do NOT default to 8×. State the factor in docs (dsp-research confirmed; resolves a fundamental, not a bug).
2. **Hosted-plugin real-time risk** — RTMsend hosts a 3rd-party EQ; RT-safety of arbitrary hosted plugins cannot be guaranteed. Disclose the boundary; ship RTMsend as an explicitly-beta track.
3. **mel-L1 is a spectral-difference measure, not a quality score** — after rename (P1-2), document what it does and does not assert.
4. **Synthetic-only QA history** — until the real-master parity gate (P0-7) is standing, be honest internally that prior "validation" was self-consistency, not reference parity. (Do not ship customer-facing accuracy claims like README's "SDR 9.66" as mix accuracy.)

---

## 5. GTM DECISION

**Ship the fixed METER now; do NOT hold for the certification pivot — but do not ship the certificate.** This is the near-unanimous read across all five divisions, and it is correct.

Reasoning: the "ship-meter vs hold-for-pivot" framing is a **false dilemma** (decision-toolkit, product-strategist, blue-ocean, stress-test all converge here). The certification layer wraps the *same* `RpcServer`/measurement engine and serializes the *same* typed-measurement type that P0-5 builds. The pivot is **earned by** the trust sprint, not an alternative to it — same first move either way. Holding trades a reversible timing call for an irreversible trust call (hard-call). Shipping the *cert* now trades the opposite way and is indefensible: you cannot price a premium on a broken premium, and a wrong cert is worse than no cert (pricing, blue-ocean).

**Parallel-track recommendation (RTM is a company, not a solo dev):**
- **Track A (revenue, now):** RTMcompare as **Meter + Adviser** SKU — the solid BS.1770-4 core, honest measurements, no binary PASS/FAIL cert. This is the paid GA.
- **Track B (moat, parallel):** "RTM Verify (preview)" — un-priced, visible high-WTP anchor. Server-side Ed25519 (not on-device HMAC), C2PA, MCP-wrap the RpcServer. Time GA to the **EU AI Act Aug-2-2026** catalyst, bundled with UAI. The typed-measurement contract (P0-5) is the shared substrate, so Track B costs near-zero incremental design if A is built right.
- **RTMsend:** separate explicitly-beta track, never gating the meter's dates.
- **RTMprofile:** hold from paid until the constant match-score is fixed (P0-8).

---

## 6. RECOMMENDED TIMELINE TO PAID GA

**Week 0 (immediate, hours):** Quarantine staged 8.4.0/7.5.5 bundles (P1-11); confirm none shipped (if any did → recall, not roadmap). Delete 4.0 GB dead weights (P0-9). Disable cert path / strip "certificate" word (P0-3, the free half).

**Week 1 — Trust-critical structural bundle:** Typed-measurement contract (P0-5) + route AAC/sentinel/ViSQOL/profile primitives through it → this lands P0-1, P0-4, P0-6 as instances. Single TP engine (P1-1). RTMprofile pulled (P0-8).

**Week 2 — Reproducible binary:** JUCE fork as pinned submodule + CI gate failing on missing patch marker + clean-clone build proving white-screen fix is in the artifact (P0-2). Live update channel wired (P1-4).

**Week 3 — Prove it:** Real-master parity harness standing; gate = ≥95% specificity on benign EQ, ≥90% sensitivity on real artifacts, hard-panned anti-correlated AAC fixture returns FAIL, golden-value fixtures green (P0-7). This is the actual ship gate.

**Week 4 — Controlled launch:** Demote cert copy + reconcile version drift (P1-7). Stand up landing/waitlist (P1-10). Closed NDA design partners behind the kill-gate (trust-class-incident-count = 0) → throttled paid alpha → gated early access. Product Hunt/HN LAST. RTMsend beta in parallel.

GA for money: **end of Week 3** if parity gate is green; Week 4 begins the controlled funnel. Track B (RTM Verify) starts in parallel Week 1 as design, GA targeted at Aug 2026.

---

## 7. CONFLICT RESOLUTIONS

- **"Promote ViSQOL to primary verdict" (dsp-research) vs "ViSQOL is in the wrong mode" (reinvent/comparator.py:1919).** RESOLVED: both true, sequenced. ViSQOL is *integrated but misconfigured* (16 kHz speech). **First fix the mode (48 kHz music — P0-6), then** it can be promoted toward primary. Do NOT promote a speech-mode score to primary verdict — that ships the wrong-model number as the headline. Mode-fix is P0; promotion is a P1/post-gate product decision once parity (P0-7) validates it on real masters.

- **JUCE: "vendored + pinned at 501c0767" (war-room) vs "gitignored, unpinned, CI clones stock" (tech-lead, debugger, onboarding, devops, systems-arch, product-strategist, challenge).** RESOLVED by Director verification: `.gitignore:71` ignores `JUCE/`, `git ls-files JUCE` is empty, no `.gitmodules`, `build-windows.yml:51` clones stock 8.0.12. The local dir has uncommitted edits but **is not pinned and not in CI.** War-room is **wrong**; the 7-member consensus stands. P0-2 holds. (War-room's downgrade of Audit-1's repaint flag is rejected.)

- **"Trivial fix" (Audit 1, go-mode) vs "structural, not 4 patches" (architect, first-principles, systems-arch).** RESOLVED: the AAC *line* is ~6 lines (true), but the *class* is structural. Do both: ship the typed contract (P0-5) so the point-fix cannot be the only defense. Decision-toolkit's bias flag is upheld — "trivial" reframes a consequence-class bug as severity-class and breeds false confidence that the pattern is gone.

- **"4× TP sufficient" (dsp-research) vs MED "soxr-vs-poly TP fork" (Audit 1).** Not a contradiction: 4× is the right *factor* (disclose, item 1); the *fork* is a single-engine problem (P1-1). Different issues.

- **Security says SHIP (not security-blocked) vs everyone says NO-SHIP.** Both true: zero security ship-blockers; the blocker is correctness/trust. Security's SEC-1 (delete weights) is upheld as P0-9.

---

## 8. THE SMALLEST SAFE FIRST STEP

**Quarantine the already-packaged `release/` 8.4.0 + 7.5.5 bundles and confirm whether any (or any generated certificate) reached a customer.** Zero engineering, hours of work. If a wrong signed PASS already shipped, this is an incident/recall that reorders everything below it. If not, you have bought the runway to fix in the right order. This is the one action whose answer changes the entire plan.

---

## 9. OPEN QUESTIONS ONLY THE FOUNDER CAN ANSWER

1. **Has any 8.4.0/7.5.5 bundle or any generated certificate already reached a paying customer?** (Determines roadmap vs recall — see §8.)
2. **Is RTM willing to ship the meter WITHOUT a binary PASS/FAIL certificate at launch**, holding the cert for the server-side Ed25519 Track-B product? (The whole GTM hinges on this.)
3. **Team shape / bandwidth:** can Track A (trust sprint) and Track B (RTM Verify design) run truly in parallel, or is this sequential? (RTM-is-a-company assumption needs confirming for the Week-1 parallel start.)
4. **Is the Aug-2-2026 EU-AI-Act bundling with UAI a committed GTM catalyst** or opportunistic? (Sets the Track-B GA hard date.)
5. **AAX/PACE signing bus-factor-1** — is there a second signer / documented runbook before RTMsend's beta track goes external?
6. **Pricing intent for RTMprofile** — pull permanently, or fix the cosine score post-launch and reintroduce? (Affects whether P0-8 is a delete or a defer.)
