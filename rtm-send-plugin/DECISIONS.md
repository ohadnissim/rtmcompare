# RTMsend Deferred Decisions

These items emerged from a /reinvent architectural analysis of the RTMsend JUCE plugin. Each one requires a human call before implementation can begin. Read the brief, pick an option, and note your decision so the sprint can be scheduled.

---

## Patent Filings (3 Claims)

**What it is**: Three potentially novel architectural patterns in RTMsend that may qualify for provisional patent protection.

**Why it's deferred**: requires a business decision on whether the IP is worth protecting and the cost/distraction tradeoff of engaging a patent attorney.

**The three claims:**

- **Claim 1 — Bidirectional DAW audio analysis bridge**: a plugin that (a) captures post-chain audio, (b) exposes a JSON-RPC server on localhost for remote parameter writes, and (c) uses a per-instance cryptographically-signed discovery file for secure multi-instance routing. No combined prior art found in USPTO/EPO search.
- **Claim 2 — SHA-256 bound filesystem handoff protocol**: the `.ready` marker carrying `wavSha256`/`jsonSha256` hashes to prevent mid-race file substitution. Addresses a CVE class of plugin impersonation. Novel as applied to audio analysis handoff.
- **Claim 3 — Target-fingerprint guard for remote EQ writes**: the `recommend.eq` method's `targetFingerprint` field (`<format>|<uid>|<version>|<paramCount>`) that validates plugin identity before pushing parameter values. Prevents "push to wrong plugin instance" when multiple instances share a port.

**Options**:
- A) File all three USPTO provisionals now (~$960 total, 12-month window before full filing required). Buys time to evaluate commercial traction before committing to full prosecution.
- B) File only Claim 1 (the broadest architectural claim) as the most defensible and strategically valuable.
- C) Skip provisional filings. Focus on shipping; rely on trade secret / first-mover advantage instead.

**Recommendation**: Option A if you plan to raise or license; Option C if this is a bootstrapped indie product. The $960 is low risk relative to the 12-month optionality it buys. Effort is minimal — you brief an attorney for 2 hours using this document.

**Effort to implement once decided**: S (brief a patent attorney; they draft the provisionals).

---

## Reach Out to Sonible for smart:EQ 4 Integration

**What it is**: A business development opportunity to integrate RTMsend's RPC bridge directly with sonible's smart:EQ 4, enabling one-click EQ matching into a plugin already owned by a large share of RTMcompare's target users.

**Why it's deferred**: requires a decision on partnership strategy and how much of the protocol to expose before the product is publicly launched.

**Context**: sonible's smart:EQ 4 already uses UDP multicast on `localhost:5670` for plugin-to-plugin communication. RTMsend's RPC server is architecturally compatible. A bridge would let RTMcompare write directly into smart:EQ 4's per-band controls — no copy-pasting 31 numbers.

**Options**:
- A) Technical partnership / co-marketing: reach out to sonible's BD team, pitch co-marketing and a documented integration API. Low risk, high visibility.
- B) SDK integration: propose that sonible expose a public RPC or CLAP extension so RTMcompare can target smart:EQ 4 natively, without RTMsend being required.
- C) Build an unofficial bridge unilaterally: reverse-engineer the UDP protocol, ship the bridge, ask forgiveness later. Risky if sonible objects; fast to ship.

**Recommendation**: Option A. The email costs an hour to write. Even a "not interested" reply is useful market signal. Avoid Option C until you have legal clarity on their license terms.

**Effort to implement once decided**: S (write the email); M (if they want a working prototype before the conversation).

---

## Publish the Bridge Protocol Spec as a Versioned RFC

**What it is**: A decision on whether to open-source the `.rtm.json` sidecar + `.ready` marker + RPC wire format as a public spec that any DAW plugin or scripting environment could implement.

**Why it's deferred**: requires a strategic call on open ecosystem vs. proprietary moat.

**Context**: the protocol is already a de-facto standard — it's just not documented anywhere outside the code. Publishing it as an RFC would let REAPER scripts, Max/MSP patches, other AU developers, and CLI tools talk to RTMcompare without RTMsend being the only client. The content mostly exists in code comments.

**Options**:
- A) Publish an open RFC under a Creative Commons or Apache 2.0 license. Grows the integrations surface; positions RTMcompare as the hub of a small ecosystem.
- B) Keep the spec proprietary. RTMsend is the only compatible plugin, which maintains a competitive lock-in.
- C) Publish a "reference" spec but require a compatibility license for commercial plugins (source-available, not open). Compromise position.

**Recommendation**: Option A. The moat in this product isn't the wire format — it's the analysis quality, UX, and the RTMcompare + RTMsend bundle. An open spec attracts integrations that make the platform stickier. Option B is unlikely to hold as a moat once competitors reverse-engineer it.

**Effort to implement once decided**: S (write the RFC document; most content already exists).

---

## SharedRpcBroker Per-Process Singleton

**What it is**: An architectural change to consolidate all RTMsend instances loaded in a single DAW process onto one RPC port, addressed by slot UUID, instead of each instance opening its own port.

**Why it's deferred**: requires a decision on whether to invest the sprint before v1 launch or ship the current per-instance-port design first.

**Context**: when Logic Pro loads RTMsend in 3 channel strips, there are 3 port files, and RTMcompare needs a disambiguation UI to pick the right one. Worse, Logic's sandbox may write some port files to container paths RTMcompare cannot read. A singleton broker (one port, N registered instances, each addressed by UUID) eliminates both problems.

**Options**:
- A) Ship v1 with per-instance ports (current behavior). Accept the friction; add a disambiguation UI in RTMcompare as a workaround.
- B) Implement `SharedRpcBroker` before public launch. Cleaner architecture, solves the Logic sandbox issue, but delays launch by ~1 sprint.
- C) Ship per-instance ports for v1, schedule the broker refactor for v1.1 once the protocol is stable.

**Recommendation**: Option C. The per-instance design is functional for single-instance use (the most common case at launch). The broker is the right long-term architecture, but doing it post-v1 when you have real user feedback on multi-instance workflows is lower risk than speculative pre-launch investment.

**Effort to implement once decided**: M (new `SharedRpcBroker` class, instance registration protocol, RTMcompare discovery logic update).

---

## Multi-Slot Plugin Chain (4 Slots)

**What it is**: Expanding RTMsend from hosting a single plugin to a 4-slot chain (`[pre-EQ] → [compressor] → [limiter] → [capture]`), with RPC addressing by slot index.

**Why it's deferred**: requires a product scope decision — is this needed to validate PMF, or is it scope creep for v1?

**Context**: power users want to place RTMsend at the end of a processing chain. A 4-slot `std::array<HostedPlugin, 4>` would model this. The RPC API would need a `slot` field in parameter write calls. This is a significant refactor touching the processor, RPC API, and editor layout.

**Options**:
- A) Ship v1 with 1-slot (current). Users can load RTMsend after their chain manually; document this as the intended workflow.
- B) Build 4-slot before v1. Richer feature, longer timeline, higher risk of shipping something users don't actually need.
- C) Ship 1-slot for v1, add multi-slot as a paid upgrade feature in v1.5 once you know users want it.

**Recommendation**: Option A (with Option C in your back pocket). The core value proposition is the analysis + EQ push loop, not plugin chaining. Validate that first. Multi-slot is a power-user feature — learn whether your v1 users are actually power users before building it.

**Effort to implement once decided**: L (processor refactor, RPC API change, editor layout change for 4 slot rows).

---

## ST-ITO / ITO-Master Neural EQ Integration

**What it is**: Integration of the arXiv 2410.21233 (ISMIR 2024 Best Paper) "gradient-free style transfer via ITO" model into RTMcompare to auto-generate `recommend.eq` payloads by running iterative optimization against the master's frequency profile.

**Why it's deferred**: requires a decision on which technical route to take and whether to sequence this before or after the faster DAFx24 CNN model (Decision 7 below).

**Context**: this closes the full analysis-to-actuation loop — RTMcompare would generate the EQ payload automatically rather than the user computing it. The reference implementation is MIT-licensed. Route tradeoffs are integration complexity vs. accuracy vs. time-to-ship.

**Options**:
- A) Integrate the Python ST-ITO model directly into RTMcompare's analysis pipeline. Most accurate output; most integration work (Python subprocess, model loading, latency management).
- B) Ship a separate "EQ Match" mode that calls an external Python process the user installs separately. Faster to build; worse UX (external dependency).
- C) Implement the DAFx24 CNN model first (Decision 7), ship it, then layer ST-ITO on top as "EQ Match Pro." CNN is simpler, faster, and gives you a shippable feature in 2 weeks.

**Recommendation**: Option C. Don't block on ST-ITO. The CNN model (Decision 7) is a 2-week path to the same user-facing feature with slightly lower accuracy. Ship the CNN first, validate the workflow, then upgrade the model if users care about accuracy differences.

**Effort to implement once decided**: M (Route A — Python model integration); S (Route C — defer to CNN model first).

---

## DAFx24 CNN EQ-Matching Model (Sprint 1 Priority)

**What it is**: Integration of the arXiv 2407.16691 CNN model that takes (source spectrum, target spectrum) and outputs PEQ band parameters, running in ONNX at ~50ms on CPU, with output that maps directly to RTMsend's `recommend.eq` payload.

**Why it's deferred**: requires sprint approval and a decision to bundle the ONNX runtime with RTMcompare.

**Context**: this is the shortest path to a working "one-click EQ match" feature. Model weights are in the paper's GitHub release. Integration requires: (a) ONNX runtime bundled with RTMcompare's Python layer, (b) a new `/api/eq-match` endpoint, (c) a UI affordance in RTMcompare to trigger it. Estimated 2 weeks, 3 files + 1 new Python module.

**Options**:
- A) Approve the 2-week sprint. Ship EQ match in v1 or v1.1.
- B) Defer until after v1 launch. Ship v1 without auto EQ match; add it once the core product is validated.
- C) Scope down: wire the endpoint and UI affordance now, but use a simpler 31-band averaging heuristic as a placeholder until the CNN model is integrated. Ships faster; less accurate.

**Recommendation**: Option A if the EQ match feature is core to your pitch. Option B if you can tell a compelling story with manual EQ push first (which you can — the RPC bridge itself is the novel part). The CNN model is genuinely straightforward; the 2-week estimate looks credible.

**Effort to implement once decided**: M (2 weeks, 3 files + new Python module).
