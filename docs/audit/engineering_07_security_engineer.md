# Engineering — Persona 07: Senior Security Engineer
## Delivery-Readiness Security Audit — RTM Suite (RTMcompare 8.4.0 / RTMsend / RTMprofile)

**Lens:** Think like an attacker, report like a defender. Attack surface, auth, injection, sensitive-data exposure, supply chain. I do not re-litigate the DSP-correctness bugs from Audits 1–3 — those are accuracy bugs, not exploit primitives. My job is the question none of the three prior audits asked: *what can a hostile actor, a crafted input, or a poisoned dependency do to this system, and does shipping it expose the company to a breach, not just a wrong number?*

---

### VERDICT (security division contribution)

**SHIP — not security-blocked.** From a pure attack-surface standpoint this is the most security-mature product in the RTM portfolio. The local RPC channel, the Electron renderer, and the Python subprocess fabric are all hardened by what is clearly a prior security pass (CRIT-/MED-/LOW- tagged fixes are visible in-line). I found **zero CRITICAL and zero HIGH security vulnerabilities.** None of my findings gate paid delivery. This is in deliberate contrast to Audit 1/2's *correctness* ship-blocker (the AAC mono-downmix ISP verdict) — that bug ships a wrong PASS to a customer; it is not an exploit. My division does not add a blocker; it adds a residual-risk register.

The single largest *company* risk on ship is therefore **not** a security breach — it is the trust-integrity failure the other audits found (a clipping master certified PASS). My security input to that question: because the product's brand promise is "trustworthy meter," a security incident and a wrong-number incident damage the *same* asset. Treat both under one trust-integrity umbrella.

---

### What is already done well (verified, not assumed)

These materially de-risk the ship and deserve to be on record:

- **RTMsend RPC is loopback-only + token-gated + constant-time-compared.** Listener binds `127.0.0.1` port 0 (`RpcServer.cpp:216`); 128-bit CSPRNG token via OS RNG (`RpcServer.cpp:159-162`); token file `chmod 0600` (`RpcServer.cpp:260,295`); mismatch closes silently with no oracle (`RpcServer.cpp:398-418`). This defeats the obvious same-host attack (a malicious local app driving a paying engineer's plugin parameters / exfiltrating captured audio). Good design.
- **Electron is hardened to spec:** `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true` (`main.ts:254-296`); `will-navigate` anchored to exact packaged `index.html` path with `..` rejection (`main.ts:367-401`); `setWindowOpenHandler → deny` (`main.ts:403`); CSP with no `unsafe-eval`, no remote script origins (`main.ts:420-424`). The preload exposes a tiny, typed surface (`preload.js`).
- **No command injection.** Every Python spawn uses `spawn(cmd, argsArray)` with no `shell:true`; the two `-c` inline scripts interpolate only the trusted `pythonDir` via `JSON.stringify` and pass all user data over **stdin as JSON** (`main.ts:1181-1205`, `:1455-1496`). User file paths are argv elements, never shell tokens.
- **Interpreter resolution is absolute-path-first** (`python-bridge.ts:165-173`) — packaged builds never do a PATH lookup, so binary-planting/PATH-hijack does not apply to shipped users. Bare `python.exe`/`/usr/bin/python3` fallback (`:193`) is dev-only (guarded by `existsSync` of the bundle).
- **Daemon has no network surface** — stdio pipes only (`python-daemon.ts:219`), not a socket. Nothing new to firewall.
- **No unsafe deserialization in shipped Python.** Grep for `pickle/torch.load/np.load(allow_pickle)/yaml.load/eval/exec/os.system/shell=True` across `python/` and `rtm-profile-app/python/` returned **empty**.
- **Canvas LMS integration is well-built** (this is a net-new surface no prior audit mentions): token stored via Electron `safeStorage`/OS keychain, refuses to persist if keychain unavailable (`main.ts:3021-3095`); egress host allowlisted to `*.instructure.com`/`*.canvaslms.com` and **HTTPS enforced**, re-validated at send time even against a tampered config (`main.ts:2979-3001`, `:110-122`). SSRF and cleartext-token leak are both closed.
- **No committed secrets** in `src/`, `electron/`, profile app, or scripts (scan clean; only the keychain-backed Canvas token plumbing and the RPC auth-token machinery match).

---

### NET-NEW FINDINGS (only my lens surfaces these)

#### SEC-1 — MEDIUM — Pickle-backed `.ckpt` model weights ship in the bundle as a latent RCE sink
**Evidence:** `model-cache/uai_root/models/*.ckpt` (4.0 GB; `bs_roformer…ckpt`, `mel_band_roformer…ckpt`). PyTorch `.ckpt` files are pickle-serialized; `torch.load()` on an attacker-supplied `.ckpt` is arbitrary-code-execution by design. Audit 2 already flagged these as **dead weight** (the separator they belong to does not exist in the shipped code) — and my grep confirms **no `torch.load` call exists in the shipped tree today**, so there is no *active* exploit path.
**Why it still matters (attacker lens):** (a) these files are in the signed bundle on every customer machine; the day someone wires up a "load custom separator model" feature, or a support workflow tells a user to drop a `.ckpt` into `model-cache/`, this becomes a live RCE with no further warning; (b) they are sourced from a third party (RoFormer SDR-checkpoint naming) — verify the **license** is commercial-distribution-safe (this is also a HARD-CONSTRAINT-(c) item, not just security); (c) 4 GB of dead, unsigned-origin binary in a paid bundle is itself an attack/tamper surface and a 4 GB customer-bandwidth cost.
**Fix:** Remove the `.ckpt`/`.yaml` model files from the shipped bundle entirely (they back no feature). If/when a load path is ever added, pin `torch.load(..., weights_only=True)` and verify a SHA-256 of each weight file against a baked-in manifest before load. **Do not ship a `torch.load` of a user-reachable path, ever.**

#### SEC-2 — LOW/MED — Reviewer-identity & internal-process fingerprints leak in shipped, decompilable source
**Evidence:** `.scrub-fingerprints.py` exists specifically to strip `// Panel ask:`, `// <Name>'s sign-off polish`, `// Grammy-ME…` and named-reviewer comments from `src/`. Its existence proves these strings are *in the tree*. The Electron renderer ships as an `app.asar` that is trivially unpacked (`npx asar extract`), and the in-line audit tags (`CRIT-9`, `MED-17`, `LOW-16`) are themselves a roadmap of every place the team thinks is fragile.
**Why it matters:** This is information disclosure + a reverse-engineering aid handed to a competitor or attacker — it reveals named individuals (privacy/professionalism for a B2B product sold to labels) and a prioritized list of historically-weak code. Not exploitable alone; reputationally and competitively real.
**Fix:** (1) Run `.scrub-fingerprints.py` as a **mandatory release-pipeline step** (CI gate), not a one-shot — confirm it ran against the 8.4.0 build that ships. (2) Strip audit-tag comments from the production bundle (build-time comment stripper / minify) so `CRIT-/MED-/LOW-` markers do not ship. (3) Consider `asar` integrity (electron `asarIntegrity`) to at least make tampering detectable.

#### SEC-3 — LOW — RPC token constant-time compare leaks input *length* via loop bound
**Evidence:** `RpcServer.cpp:413-416` — `cmpLen = min(tLen, iLen)`; the compare loop runs `cmpLen` iterations, so wall-clock scales with the attacker's submitted length. The XOR-accumulate correctly avoids leaking *which byte* mismatched, and the length XOR (`:412`) correctly forces a mismatch on length difference — but the *timing* is still input-length-dependent.
**Why it (barely) matters:** Over loopback against a 128-bit token regenerated every `start()` cycle, this is not practically exploitable — there is no length to discover (token length is fixed and public-knowable). Documenting it so it isn't "fixed" into a regression and so the threat model is explicit.
**Fix (optional):** Iterate over a fixed `tLen` always, indexing the input modulo its length (or against a zero pad). Cosmetic; do **not** prioritize over SEC-1/SEC-2.

#### SEC-4 — LOW — Windows `taskkill` invoked by bare name
**Evidence:** `python-bridge.ts:94` — `execFileSync('taskkill', [...])`. Bare-name resolution on Windows searches CWD/PATH; classic binary-planting vector if the app's CWD is ever attacker-writable.
**Why it's low:** `taskkill.exe` lives in `System32` (early on the system PATH), `execFileSync` (no shell), and the app CWD is the install dir. Real but small.
**Fix:** Call `%SystemRoot%\System32\taskkill.exe` by absolute path. One-line hardening; bundle with the Windows-port work.

#### SEC-5 — INFRA/PROCESS — Confirm code-signing & notarization integrity of the *shipped* artifacts
**Evidence (process gap, not a code bug):** `CertificateSigningRequest.certSigningRequest` is committed at repo root (a CSR is not secret — the private key is the asset — but it shouldn't be in source control as hygiene). Entitlements files exist for RTMsend (`rtm-send-plugin/build*/…entitlements`). Audit 1 flagged the JUCE repaint fix as **unverifiable because JUCE is not vendored/pinned** — that same gap is a *supply-chain* concern from my lens: an unpinned JUCE checkout can silently change the security-relevant socket/threading code in `RpcServer`/`PluginProcessor` between builds.
**Fix:** (1) Confirm every shipped binary (RTMcompare app, RTMsend VST3/AU/AAX, RTMprofile) is Developer-ID signed with **hardened runtime** and notarized — this is also load-bearing for the `MEMORY` note that ad-hoc-signed VST3 crashes hosts. (2) Pin JUCE to a committed submodule/commit SHA so the audited RPC code is the code that ships. (3) Move the CSR out of the repo.

---

### Answers to the four board questions (security lens only)

**(1) Shippable for paid delivery, and minimum bar?**
From security: **yes, shippable now.** Minimum security bar to clear before the paid build leaves the building: **SEC-1 (delete the 4 GB pickle `.ckpt` weights — also a license item)** and **SEC-2 (run the fingerprint scrubber + strip audit-tag comments as a CI gate).** Both are *bundle-hygiene* fixes, not code rewrites — hours, not sprints. SEC-3/4/5 are post-launch except the *one-time verification* that artifacts are notarized + hardened-runtime (SEC-5.1), which should be a release checklist tick, not net-new work.

**(2) Sequence — must-fix / disclose / defer:**
- **MUST-FIX pre-delivery (security):** SEC-1 (remove weights), SEC-2 (scrub + comment-strip in CI), SEC-5.1 (verify signing/notarization of shipped artifacts).
- **DISCLOSE (security):** that RTMsend opens a localhost RPC port while loaded in the DAW (security-conscious B2B buyers / label IT will ask) — document the loopback-only + token-gated model proactively; it's a *selling point*, not a liability.
- **DEFER post-launch:** SEC-3 (timing cosmetic), SEC-4 (Windows taskkill absolute path — fold into Windows port), SEC-5.2 (JUCE pinning — do before the *next* RPC change, not before this ship).

**(3) GTM — ship the meter now vs hold for the certification-layer pivot:**
Security strongly favors **ship now, pivot later.** The "RTM Verify / Stripe-for-delivery-compliance" moonshot (Audit 2) is the *highest-security-stakes* version of this product — the moment you emit C2PA-signed certificates and MCP-wrap the RpcServer for remote callers, you inherit signing-key custody, a remotely-reachable RPC surface (the loopback-only assumption that makes today's RPC safe **evaporates**), and certificate-forgery/replay as a threat class. None of that is in scope today and the current codebase is **not** architected for it (token model assumes same-user loopback). Ship the on-device meter (low, well-understood attack surface), and treat the certification layer as a **new security-design project** with its own threat model, key-management plan, and audit — not an increment.

**(4) Single biggest security risk to the company if we ship as-is:**
**SEC-1 — the dead 4 GB pickle `.ckpt` weights.** Today it's inert. But it is (a) a possible **commercial-license violation** shipping in a paid product (HARD CONSTRAINT (c)), (b) a **dormant RCE primitive** one careless feature/support-step away from going live, and (c) 4 GB of opaque third-party binary in your signed bundle that you cannot fully vouch for. It is the only finding that simultaneously touches breach risk, license risk, and bundle integrity — and the fix is *deletion*, which is free. Delete it before ship.

---

*Scope note: read-only audit. No code executed, no source modified. Findings are advisory; the human owns the ship decision. Severity = security exploitability, distinct from the customer-trust severity the DSP audits use.*
