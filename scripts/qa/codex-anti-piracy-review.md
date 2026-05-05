# Codex consult — anti-piracy / licensing architecture for RTM Suite

We're shipping a paid desktop audio-analysis app to mastering engineers
and label QC teams. macOS dmg (Apple-notarized) shipped today; Windows
portable .exe shipping today. We need an honest pass at the **best
licensing + anti-tamper architecture we can ship** without making the
app annoying for the people who actually pay.

## Product + threat model

### What RTM Suite is
- Electron 33 renderer + bundled Python 3.11.15 analyzer (torch /
  librosa / demucs / numba). All deps shipped inside the .app /
  portable .exe (~340 MB mac arm64, ~835 MB win x64).
- Pricing model: not yet decided — perpetual license + paid major
  upgrades is the working assumption. Subscription is on the table.
  Probably $99-$299 price point. Mastering engineers + small labels.
- Distribution: direct download from our own website (no App Store).
  macOS dmg is Apple Developer ID Application signed + notarized.
  Windows portable is unsigned (no Authenticode cert yet — we'd
  consider buying one if you recommend it, ~$200-400/yr EV).
- We have a server we can run (no infra constraints — assume Cloudflare
  Workers / Supabase / a small VPS budget is fine).

### Realistic adversaries (in priority order)
1. **Casual sharer** — buys one license, gives the .dmg + key to a friend.
   Volume risk: medium. Easiest to mitigate.
2. **Forum cracker** — uses static analysis on the asar / Python to
   locate the license-check, patches it, posts a cracked build on
   Russian / Chinese audio forums. Volume risk: medium-to-high once
   patched build is live.
3. **Per-seat sharing inside a studio** — a 5-engineer studio buys 1 seat,
   uses 5 machines. Volume risk: high in the target customer segment.
4. **Trial-reset cycler** — uninstalls + reinstalls to extend the free
   trial indefinitely. Low impact per user but annoying churn.
5. **Repackager / counterfeiter** — strips RTM branding, repackages with
   a different name, resells. Low probability for our market.

### What MUST NOT happen (the "don't annoy paying users" rules)
- App must work fully OFFLINE after first activation. A mastering
  engineer on a flight or in a studio with no internet can NOT be
  blocked from analyzing.
- License must be reactivatable from the user's email without a
  support ticket — losing a laptop / reinstalling macOS shouldn't
  burn their license.
- No nag screens. No "remind me later" interruptions on launch.
- No telemetry beyond what's needed for license validation.
- No DRM that requires kernel extensions, system integrity exceptions,
  or admin password prompts.
- No "phone home every 30 days or app dies" without a generous offline
  grace period (≥ 30 days, ideally 90).

## Output we want from you

### A. Threat-by-threat recommendation
For each of the five adversaries above, propose:
- The cheapest mitigation that meaningfully raises the cost of attack
- The deeper mitigation if we want to go further
- A blunt assessment: is the deeper mitigation worth the engineering
  cost AND the friction it adds for legit users?

### B. License key architecture
Compare these and pick one (or hybrid):
1. **Fully offline signed-key**: server signs a license blob with
   private key; app verifies with embedded public key. No phone-home.
   Trivial to share keys; harder to revoke.
2. **Online activation, offline-cached**: server activates license per
   machine fingerprint, returns signed token; token re-checks every N
   days against server, falls back to cached token offline.
3. **Per-machine activation with seat limit**: server tracks N
   active machines per license; user can self-deactivate from a web
   portal to free a seat. Cheaper for studios to do honestly than to
   share keys.
4. **Hybrid**: signed offline token + optional online activation for
   per-machine seat tracking.

For the chosen approach, sketch:
- The server-side data model (license, activations, seats, revocations)
- The client-side flow (first launch, subsequent launches, offline,
  reactivation)
- The crypto primitives (Ed25519 / RSA / minisign) and where the
  public key lives in the app (asar? compiled into a .node?)

### C. Anti-tamper for the Electron + Python bundle
Specific to our architecture:
- The asar can be extracted with `asar extract` in seconds.
- The Python source ships in plain `.py` files at `Resources/python/*.py`
  — anyone can read and patch the analyzer.
- numba / torch / librosa are too heavy to obfuscate.
- The macOS code signature seal can detect tampering ON the .app, but
  not after a determined attacker re-signs.

What's the right level of effort here? Specifically:
- Does asar integrity (electron-builder asarIntegrity) help against a
  determined cracker, or just script-kiddies?
- Should we move license-check logic into a compiled native module
  (.node) so it's harder to patch than JS?
- Should the Python analyzer ITSELF refuse to run without a license
  token signed for that machine — i.e. license check happens in
  multiple layers, not just in JS?
- Is code obfuscation (JavaScript Obfuscator, V8 bytecode caching) worth
  the debug-pain it creates for us during legit bug investigations?

### D. Trial mechanics
- Trial length recommendation (7 / 14 / 30 days?)
- Hardware-fingerprint scheme that survives a clean macOS reinstall
  but doesn't fingerprint the user across multiple machines they own
  (privacy-respecting)
- Server-side detection of trial-reset cyclers (e.g. flag accounts
  where >3 fingerprints have started a trial in 60 days)

### E. Windows code signing
- Is buying an EV Authenticode cert ($200-400/yr) worth it for our
  target customers? Specifically: does the SmartScreen warning on the
  unsigned .exe drive enough refunds / support tickets to justify the
  cost?
- If yes, recommend a CA (DigiCert / Sectigo / SSL.com) and the
  rough setup time.
- If we wait on the EV cert, what's the messaging on our website /
  inside the SmartScreen click-through that minimises confusion?

### F. Existing code audit
Look at the repo and tell me whether there's ANY licensing /
activation / trial-tracking / fingerprinting code already shipped or
half-built — I want to know if I'm starting from zero or building on
something. Specifically check:
- `electron/main.ts` — any `license` / `activation` / `trial` IPC handlers?
- `python/` — any `--license` flag or trial-time gating?
- `~/.rtm/` — any saved tokens / fingerprints?
- `package.json` — any deps related to licensing (e.g. `keygen-sh`,
  `paddle-node-sdk`, `electron-license`)?

## Output format

Three sections:

### THREAT-BY-THREAT
Five adversaries × (cheap fix, deep fix, my-recommendation, why)

### ARCHITECTURE
- License key model: pick one (with rationale)
- Server-side data model: ASCII sketch
- Client flow: first launch / subsequent / offline / reactivation
- Anti-tamper layers: ranked by cost-vs-value
- Trial mechanics: length, fingerprint, server detection

### ROADMAP
A pragmatic ordered list of what to build, week by week, from "minimum
viable license check we ship next week" through "robust enough to
deter a determined cracker for a year." Be honest about diminishing
returns — at some point each layer adds engineering pain without
proportional revenue protection.

## Constraints

- Be specific. Cite repo files when they exist; recommend specific
  libraries by name + version when relevant; cite specific server
  vendors / APIs.
- No code changes — diagnosis + recommendation only.
- You may run shell commands (sandbox is `danger-full-access`). Use
  them to audit the repo, e.g. grep for license-related strings.
- Honest > flattering. If a popular technique is theatre that won't
  stop a real cracker, say so.
- Under ~2500 words.
