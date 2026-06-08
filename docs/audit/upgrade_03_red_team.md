# Upgrade 03 — Red Team Verdict: RTM Suite Delivery Readiness

**Lens:** the adversary who WANTS the meter to lie. Crown jewel = *trust in the
emitted number/PASS*. The three prior audits found bugs the engineers made by
accident. My job is the bugs an attacker — or a hostile customer, or a customer's
lawyer — makes *on purpose*. I do not re-list known bugs; I add the attack-path
judgment only this lens provides.

---

## Threat model (who attacks a measurement company)

1. **The dishonest customer** — a label/engineer who wants a "PASS" cert to wave at
   a distributor or client, regardless of the audio. They will *manufacture* a green
   verdict.
2. **The disputing customer** — delivered on your PASS, got rejected by Apple/Spotify,
   and now wants to prove your cert was worthless to claw back money or sue.
3. **The competitor** — LANDR/iZotope/a reviewer who wants to publish "RTMcompare
   certifies clipping masters as Apple-compliant" (the Audit-1 #1 bug is exactly this
   headline, already public-ready).
4. **The malicious file** — a crafted input that makes the daemon misbehave.

The first two are the company-killers. RTM Audio sells *trust*; an attacker who
breaks trust cheaply destroys the entire product category, not one feature.

---

## NET-NEW FINDINGS (not in Audits 1–3)

### RT-1 — CRITICAL: the "signed certificate" is security theatre and a liability magnet
`rtm_certify.py:199-231`. The cert is HMAC-SHA256 signed with a **per-machine random
key written to `~/.rtm/certify.key`** (line 207-217). The key never leaves the
signing machine. Consequences, ranked by damage:

- **The signature proves nothing to a recipient.** Nobody but the signing machine
  can verify it (they don't have the key), and the signing machine can trivially
  re-sign *any* payload. This is not a certificate — it is a self-issued note. A
  customer can hand-edit `compliance.streaming_ready` to `true`, delete the old
  `hmac_sha256`, and re-run `_sign()` on their own machine — the key auto-creates on
  first run (line 211). **Forging a "PASS" takes one line of Python.** Crown jewel
  (trust in the cert) falls for $0.
- **It invites the disputing-customer attack.** The moment you call this a
  "certificate" with an HMAC, you imply third-party verifiability you do not have.
  When a customer's PASS gets rejected by a DSP, *your own marketing of the word
  "certificate" + "signed"* becomes Exhibit A. The Audit-2 pivot ("Stripe for audio
  delivery compliance", C2PA-signed certs) is **structurally impossible on this
  primitive** — C2PA requires an asymmetric key whose public half a verifier trusts.
  Shipping the word "certificate" now *poisons the well* for the very pivot the board
  is weighing in GTM question 3.
- **The cert signs the wrong thing anyway.** The compliance block (`_compliance`,
  line 182-196) is computed from `_compute_true_peak` (line 71) which inherits the
  **Audit-1 #1 mono-downmix true-peak bug path** via `comparator._true_peak_and_overs`,
  and `true_peak_ok = true_peak <= -1.0` (line 187) — so the *cryptographically signed*
  field is the under-read number. You are signing a lie with a key that proves nothing.

**Cheapest hardening:** (a) Until there is a real asymmetric, RTM-held signing key
with an online/offline verifier, **do not ship the word "certificate" or the HMAC.**
Call the output a "report", drop `hmac_sha256`. A signature nobody can check adds only
legal surface, never trust. (b) If the cert stays, the *only* honest signer is an
RTM-server-side key the customer never possesses — which means the cert pivot is a
*backend* product, not an on-device feature. That is a real architecture decision the
board must make before any cert ships.

### RT-2 — HIGH: the PASS bar is gameable by construction (metric gaming)
`rtm_certify.py:182-196`. Every gate is a single threshold on a single scalar with no
validity/coverage check (this is the concrete weaponization of Audit-2's
"scalar-certainty" insight):

- `lufs_range_ok` and `streaming_ready` gate on **integrated LUFS of a whole file**.
  Append 2 s of −40 LUFS tail or measure a 2 s excerpt and the integrated number
  moves into the green window while the loud body still clips. The Audit-2 "advises
  easing compression on a 2s clip" disgust-bug is the *same hole* viewed from the
  attacker side: short/padded input games the gate.
- `generation_loss_ok = (gen_loss_prob is None) or (prob < 0.4)` (line 190) — **a
  failed detector (None) returns OK.** Feed a format the detector can't read →
  `except: return None` (line 172) → silent PASS. *Detector failure should never be a
  PASS.* Same falsy-trap class Audit-2 flagged, here load-bearing on a compliance gate.
- `mono_compat` (line 100-124) and `tonal_deviation` (line 127) are computed but
  **not in any gate** — dead reassurance numbers in a "compliance" cert.

**Cheapest hardening:** every gate must require `valid==True` AND minimum-duration
coverage; `None`/failed → `UNKNOWN` (never PASS); reject inputs under N seconds for
a streaming-readiness claim.

### RT-3 — HIGH: daemon `_analyze_lock` "busy" guard is a no-op (self-inflicted DoS / crossed results)
`rtm_daemon.py:248-251`. The non-blocking probe acquires then **immediately releases**
the lock *before* re-acquiring with `with _analyze_lock` (line 251). Between release
and re-acquire, a second worker (pool has 4) wins the lock; the first then **blocks up
to 30 min** — the exact hang MED-15 claims to fix. The "busy" path is unreachable
under real concurrency. For an attacker (or just a fast double-click), queue N analyses
→ UI hangs → support load / refund pressure. Worse, the redirect of global
`sys.stdout`/`sys.argv` (line 261-269) is only safe *because* serialization holds; the
broken probe widens the window where a malformed input causing an early-return could
leave another request's globals crossed.

**Cheapest hardening:** delete lines 248-250; do the busy-check *inside* a single
atomic acquire — `if not acquire(blocking=False): return busy` and release in `finally`.
Three-line fix.

### RT-4 — MED: no input validation on daemon paths — confused-deputy on a local RPC
`rtm_daemon.py:225-231` accepts arbitrary `file_a`/`file_b` paths over the JSON-RPC
pipe and reads them. `rtm_certify.py` *does* block symlinks (line 238-241) — good — but
the daemon does **not**. If the RpcServer/MCP-wrap pivot (Audit-2) ever exposes this
loop beyond a trusted local pipe, it is an unauthenticated file-read primitive. File
this as a *pivot blocker*, not a v8.4 blocker: **the MCP-wrap moonshot must not ship
until the daemon authenticates and path-validates**, or RTM ships a local file-exfil
RPC under its own brand.

### RT-5 — MED: brand/headline risk is the real crown jewel, and it is already loaded
Audit-1 #1 (clipping master → Apple PASS) + RT-1 (one-line forgeable cert) compose into
a single reviewer tweet that ends the "trustworthy meter" positioning. The damage isn't
one wrong number — it's *the category claim*. A meter that can be caught certifying a
clipping master, with a "signature" anyone can forge, is strictly worse than no cert,
because it converts "we measure" (defensible) into "we certify" (a promise you can't
keep on-device).

---

## Ranked attack paths (feasibility × damage)

| # | Attack | Feasibility | Damage | Crown jewel |
|---|--------|-------------|--------|-------------|
| 1 | Hand-edit + re-sign a PASS cert (RT-1) | trivial (1 line) | company-ending | trust/cert integrity |
| 2 | Reviewer publishes "certifies clipping as Apple-compliant" (Audit-1 #1 + RT-5) | already true | category-ending | brand = "trustworthy meter" |
| 3 | Pad/short-clip to game LUFS/gen-loss gate (RT-2) | trivial | per-customer fraud + your liability | PASS semantics |
| 4 | Disputing customer sues on worthless "certificate" wording (RT-1) | opportunistic | legal/financial | the word "certificate" |
| 5 | Concurrent analyses hang the app (RT-3) | accidental or trivial | support cost / refunds | reliability |
| 6 | File-read via daemon RPC *if* pivot exposes it (RT-4) | conditional | security incident | pivot viability |

---

## Cheapest hardening that closes the most paths

1. **Drop the word "certificate" and the HMAC for v8.4** (closes paths 1, 4; defuses
   half of 2). Ship a "delivery report." Zero engineering, removes the largest legal +
   forgery surface. *This is my single highest-priority recommendation.*
2. **Fix Audit-1 #1 (per-channel TP)** — without it, every other fix is lipstick;
   path 2 stays live. Already known; I'm re-weighting it from "ship-blocker" to
   "brand-survival blocker."
3. **Gate-validity guard (RT-2):** failed/`None`/short-input → `UNKNOWN`, never PASS.
4. **Three-line daemon lock fix (RT-3).**

---

## Answers to the four board questions (Red-Team contribution)

**(1) Shippable for PAID delivery?** As a *measurement/report* tool: yes, after
Audit-1 #1-#4 + RT-2/RT-3 and **dropping the cert/HMAC framing**. As a *certification*
tool: **no, and not fixable on-device** — RT-1 means on-device signing can never be a
trustworthy cert. Minimum bar: the word you put in the UI must match what you can
defend in a dispute. "Report" you can defend; "signed certificate" you cannot.

**(2) Sequence:** MUST-fix pre-delivery: Audit-1 #1, RT-1 (remove cert framing), RT-2,
RT-3. Disclose: 4× TP factor, hosted-plugin RT risk, mel-L1 ≠ quality (Audits 1–2).
Defer (gate the pivot, not the launch): RT-4.

**(3) GTM:** Ship the **meter** now, *not* the certifier. The cert pivot (Audit-2) is
the right long game but is **architecturally a server-side product** (RT-1, RT-4) —
selling it as on-device is selling a forgeable promise. Build the asymmetric,
RTM-held-key + verifier as the actual pivot; do not let v8.4 ship a fake preview of it
that poisons the brand.

**(4) Single biggest risk if shipped as-is:** Not a wrong number — it's the
**compounding of a forgeable "signed certificate" (RT-1) with a demonstrably wrong PASS
(Audit-1 #1)** into a one-tweet proof that RTM Audio's meters lie. For a company whose
entire moat is neutrality and trust, that is existential, and it is cheap for an
adversary to trigger today.
