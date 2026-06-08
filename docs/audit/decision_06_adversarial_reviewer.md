# Decision 06 — Adversarial Reviewer

**Lens:** Break the self-review monoculture. Three friendly audits already agree on
*what* is broken. My job is to attack what all three *assumed*, mislead a newcomer,
hide a flaw, and find the failure mode none of them framed. I re-derive nothing; I
add only net-new adversarial judgment, grounded in the code.

**Division verdict contribution: NO-SHIP as-is. Conditional SHIP after a hard gate
(below). The blocker is worse than Audit 1 stated — the false PASS is already
packaged into a distributable artifact AND propagates into a forwardable
certificate.**

---

## What the three friendly audits missed (the 1% the agreeable review skipped)

### Finding A — The ship-blocker is not theoretical; it is ALREADY STAGED FOR DISTRIBUTION (CRITICAL, net-new)
Audit 1 framed the AAC mono-downmix bug as a code defect to fix before ship. The
adversarial read is harsher: it is **already in a release bundle on disk**.

- `release/.RTMcompare-bundle-8.4.0-arm64-stage/.../python/encoded_preview.py` is
  **byte-identical** (`diff -q` exit 0) to the buggy working-tree source.
- The bug is verified live at `python/encoded_preview.py:246` (`y_mono = y.mean(axis=1)`),
  `:255` (`mono_chunk = chunk.mean(axis=1)`), `:290` (`mono_dec = y_dec.mean(axis=1)`),
  `:297` (binary `'fail' if post_tp > -1.0 else 'pass'`), `:291` (`min(sr_dec, sr)` TP-axis corruption).

**Saboteur's move:** I don't need to introduce a bug — I just ship the bundle that
already exists. The "trivial per-channel fix" is true *in source* but irrelevant to a
build artifact already cut at 8.4.0. **Before any ship discussion, confirm whether
8.4.0-arm64-stage / 7.5.5-intel-stage have left the building** (sent to any customer,
uploaded to update server, signed-and-notarized for release). If yes, this is no
longer a pre-ship gate — it is an **incident/recall**, not a roadmap item.

### Finding B — The false PASS does not stay on screen; it is minted into a forwardable, ID'd CERTIFICATE (CRITICAL, net-new)
Audit 2's "disgust candidate" framing (sentinels rendered as real numbers) is about
*UI* misleading the *user*. The graver path: `AnalysisView.tsx:354-355` wires a
`rtm-certify-trigger` that generates a **"tamper-proof compliance certificate —
SHA-256 fingerprints, loudness measurements, unique certificate ID."** That
certificate (`src/components/v52/Certificate.tsx`, `certificateLog.ts`) carries a
`verdictWord` and a metric grid and is designed to be exported/forwarded to a label
or distributor as *proof*.

So the mono-downmix false PASS is not an ephemeral screen value the engineer might
catch — it is **cryptographically fingerprinted, given a unique ID, logged, and
handed to the customer as a durable attestation they forward downstream.** RTM's own
SHA-256 makes the false claim *non-repudiable and traceable back to RTM*. This is the
single largest legal/reputational exposure in the suite and **no audit named it.** A
"tamper-proof" cert that certifies a clipping master as Apple-compliant is worse than
no cert: it manufactures the evidence that you were wrong on purpose.

**Gate addition:** the certify path MUST NOT emit any compliance verdict that derives
from a downmixed or sentinel value. A cert must refuse to assert what it could not
measure (ties directly to Audit 2's tagged-measurement fix — but the cert is where
"valid:false" is non-negotiable, not advisory).

### Finding C — The New Hire ships the wrong bundle (process flaw, net-new)
Four stale staged bundles coexist (`5.0.5`, `5.4.0`, `7.5.5-intel`, `8.4.0-arm64`)
plus a live `.claude/worktrees/agent-*` copy of all three buggy files. A new
engineer running the release script has **no signal which tree is canonical** and the
intel/arm64 split means the soxr-vs-resample_poly TP fork (Audit 1 MED) can ship
*differently per architecture* — i.e., the same master gets PASS on arm64 and FAIL on
Intel from the same product. That is a trust-killer for a "trustworthy meter" and is
a HARD-CONSTRAINT(a) violation hiding as a MED bug. **Pre-ship: pin one tree, delete
or quarantine the stale stage dirs, and add a cross-arch parity test on TP verdicts.**

### Finding D — The Auditor: "trustworthy meter" is asserted, not evidenced
HARD CONSTRAINT (a) says every customer-facing number is non-negotiable. Yet I found
**no warranty/disclaimer/liability language** in README/Compare/FEATURES and the
product literally calls its output "compliance verdict" (`encoded_preview.py:238`)
and "tamper-proof compliance certificate." You are making a **compliance
representation with no measurement-validity disclosure and no liability ceiling.** A
B2B label customer who gets a track rejected by Apple *after* an RTM PASS cert has a
clean negligent-misrepresentation story. The fix is not only code — it is (1) the
tagged-measurement provenance from Audit 2 surfaced *on the cert*, and (2) explicit
scope/disclaimer copy ("indicative, 4× TP per BS.1770-4 Annex 2; not an Apple-issued
certification").

---

## Highest-confidence real problems (deduped, ranked by company risk)

1. **False compliance PASS is staged AND certifiable** (Findings A+B). Company-ending
   if a staged bundle shipped or a cert was issued. Verify distribution status FIRST.
2. **Cross-architecture verdict divergence** (Finding C) — same master, different
   PASS/FAIL by CPU. Directly violates the meter's reason to exist.
3. **No liability/scope disclosure behind a "compliance certificate"** (Finding D) —
   converts every correctness bug into a legal claim.
4. Everything Audits 1–3 ruled CRITICAL/HIGH (AAC per-channel, ViSQOL 16k speech mode,
   constant RTMprofile match score, 16-bit pre-AAC truncation, scalar-certainty) — I
   concur, do not re-list.

---

## Answers to the four board questions

**(1) Shippable for PAID delivery, minimum bar?** Not as-is. Minimum bar =
Audit-1 #1–#4 fixed in source AND in the *single canonical bundle*, PLUS: (i) certify
path refuses verdicts derived from downmix/sentinel; (ii) cross-arch TP-verdict parity
test green; (iii) disclaimer/scope copy on every compliance assertion; (iv) the
≥95% benign-EQ specificity / ≥90% real-artifact sensitivity gate from Audit 3.
Stale stage dirs deleted.

**(2) MUST-fix vs disclose vs defer.**
- MUST-fix pre-delivery: AAC per-channel (A), certify-path valid-gating (B), cross-arch
  parity (C), ViSQOL 48k music mode, sentinel-rendering, RTMprofile constant score.
- Disclose (ship with honest copy): 4× TP factor, hosted-plugin RT risk, mel-L1 is a
  spectral-difference not a quality score, "indicative not Apple-issued."
- Defer post-launch: RTMsend ARA region-id, MessageManagerLock hang, 4.5GB dead
  weights (size/footprint, not correctness), nperseg floor, PLR mislabel.

**(3) GTM — ship now vs hold for the certification pivot?** Ship the **fixed meter
now**; do NOT hold for the "RTM Verify / Stripe-for-delivery" pivot. The pivot is
the right 18-month bet, but it *raises* the trust bar — you cannot anchor a
certification business on a stack that currently mints false certs. The fixes above
are the prerequisite for the pivot, not an alternative to it. Sequence: trust-fix →
ship meter → earn the certification right → then productize the layer.

**(4) Single biggest risk if shipped as-is.** A paying label forwards an RTM-signed,
SHA-256-fingerprinted "tamper-proof compliance certificate" asserting Apple Digital
Masters PASS on a master that clips on hard-panned transients; Apple/distributor
rejects it; the cert names RTM as the attesting authority with no disclaimer. That is
simultaneously a refund event, a referenceable-customer loss, and a
negligent-misrepresentation exposure — and it contaminates the sister UAI
EU-AI-Act-compliance story by association. **The certificate turns a 6 dB read error
into a signed lie with RTM's name on it.**

---

## My single highest-priority recommendation
**Before touching the roadmap, establish the distribution status of the staged
`8.4.0-arm64` and `7.5.5-intel` bundles and of any certificate ever generated by the
certify flow.** If either shipped or any cert was issued, this is an incident/recall —
not a pre-ship fix list. Then make the **certify path the hardest gate in the product:
no compliance verdict may be minted from a downmixed, sentinel, or arch-divergent
value, and every cert must carry scope/disclaimer copy.** Fix the meter before you
sell the certificate.
