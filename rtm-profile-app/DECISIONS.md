# RTMprofile Reinvention — Deferred Decisions

These findings emerged during the RTMprofile build-profile reinvention pass. Each item is
technically understood and scoped; what remains is a human decision before implementation
can begin. Sorted roughly by urgency.

---

## 1. Patent Provisional Filings (×2)

**What it is**: Two provisional patent applications: (a) cohort spectral fingerprinting with
MAD-based outlier rejection, and (b) cryptographically signed versioned audio engineer profile
as a licensable identity asset.

**Why it's deferred**: Requires engaging a patent attorney. Both must be filed *before* any
public disclosure of the technical internals. Once a competitor reads the `build_profile.py`
source — or a demo is posted — the novelty clock starts. 30-day window for (a), 60 days for (b).

**Options**:
- A) File provisional ($1,500–3,000 via patent attorney per application; 12-month protection buys time to evaluate commercial viability before committing to full utility filing)
- B) Trade secret — don't publish source code or the profile JSON schema. Weak: the HMAC key derivation and curve fields are visible in any exported `.json`, so the algorithm is partially reverse-engineerable from output alone.
- C) Skip — open-source the format and compete on execution speed and ecosystem. Appropriate only if the strategic goal is community adoption over IP monetisation.

**Recommendation**: File provisional on finding (a) immediately — the MAD-based cohort
outlier-rejection combined with mean-centered Welch PSD fingerprinting is the defensible
core. It's not obvious from prior art. Finding (b) (HMAC-signed profile as identity asset)
is broader; file it in the same attorney engagement to share fees. Combined attorney cost
estimate: $2,500–4,500 for both provisionals.

**Effort to implement once decided**: S (attorney does the filing; your job is a 2-hour
technical disclosure call and reviewing a draft)

**Deadline**: 30 days for finding (a). 60 days for finding (b). After that a GitHub push or
conference demo constitutes prior-art disclosure.

---

## 2. Mel-RoFormer Model Swap (SDR 9.66 → 11.99)

**What it is**: Replace the BS-RoFormer 4-stem checkpoint (`bs_roformer_4stem_ep_17_sdr_9.6568.ckpt`)
with the Mel-RoFormer checkpoint from the ZFTurbo model hub. Measured SDR improvement: +2.33 dB.
The separation API is identical; no downstream code changes required beyond the backend loader.

**Why it's deferred**: Three gates before shipping:
1. License verification — ZFTurbo repo claims MIT; confirm the checkpoint weights themselves
   (trained on MUSDB18-HQ) carry no non-commercial restriction.
2. Regression test — model behaviour on edge cases (low-energy stems, mono input, very short
   files <5 s) must be validated before replacing production.
3. CI cache key — both `build-mac.yml` and `build-windows.yml` cache the model directory; the
   key must be updated to avoid stale-model builds.

**Options**:
- A) Swap now — download weights, run on 10 reference tracks, compare SDR and do a listening pass. If no regressions, ship in next release. (1–2 days)
- B) Add as optional `--backend mel_roformer` flag alongside existing BS-RoFormer default. Lets power users opt in before full promotion. (2–3 days, slightly more scope)
- C) Wait for Mel-RoFormer-v2 (paper authors' stated Q3 2026 target). Avoid two model swaps close together.

**Recommendation**: Option A. The license is MIT per the ZFTurbo repo README (confirmed as of
the analysis date). The +2.33 dB SDR improvement is substantial and directly improves per-stem
LUFS measurements in Deep Scan profiles. Run 5–10 tracks from the existing test corpus, compare
both stem-level SDR and the downstream `lufs_avg` delta. If per-stem LUFS shifts by <0.5 dB
on average, ship.

**Implementation steps once decided**:
1. Add `MelRoformerBackend` to `python/uai_stems/__init__.py`, mirroring the existing
   `BsRoformerBackend` class.
2. Update checkpoint filename in the model search paths inside `_separate_bsroformer()`.
3. Update CI cache keys in `.github/workflows/build-mac.yml` and `build-windows.yml`.
4. Update the checkpoint filename reference in the model-search path loop
   (`bs_roformer_4stem_ep_17_sdr_9.6568.ckpt` → new Mel-RoFormer filename).

**Effort to implement once decided**: S (1–2 days)

**Deadline**: Low urgency, but each week of delay means every Deep Scan profile built is
2.33 dB worse than it could be. Ship within the next release cycle.

---

## 3. MuQ-MuLan CLAP Embeddings ("Style Match" score)

**What it is**: Add a 512-dimensional audio embedding to the profile by running the mixed master
through a CLAP-family model during `build_profile.py`. At compare time, compute cosine similarity
between the user's mix embedding and the profile's embedding. Surface this as a "Style Match"
score (0–100%) alongside the existing technical spectral match. Two candidate models:
LAION-CLAP (`laion/clap-htsat-unfused`, ~400 MB) or MuQ-MuLan (arXiv 2404.16969, ~200 MB,
production-audio focused).

**Why it's deferred**: Four decisions required before implementation:
1. Which model? — size/accuracy trade-off.
2. Bundle strategy — the Python bundle currently ships ~350 MB. Adding a 200–400 MB model
   doubles the download. Acceptable?
3. UX — does Style Match replace the existing spectral score, supplement it, or exist in an
   optional "deep analysis" mode?
4. CI cache key updates required across both build workflows.

**Options**:
- A) LAION CLAP (`laion/clap-htsat-unfused`, 400 MB) — general music, well-tested, broad community support
- B) MuQ-MuLan (200 MB) — music-production focused, trained on mix/master audio rather than music listening data; better fit for the RTMprofile use case
- C) Skip embeddings for now — invest the same 3–5 days improving the existing spectral metric (e.g. adding per-octave weighting or transient sensitivity)

**Recommendation**: Option B. MuQ-MuLan's training domain (production audio) matches
RTMprofile's corpus better than LAION CLAP's (streaming audio). Smaller footprint. Show both
scores in the UI with a tooltip explaining the difference: "Technical Match" = spectral/dynamic
similarity, "Style Match" = perceptual tonal/texture similarity.

**Implementation steps once decided**:
1. Add MuQ-MuLan model weights to the Python bundle build script.
2. Add `_clap_embedding(signal, sr) -> list[float]` to `build_profile.py`.
3. Add `embedding: [512 floats]` field to the profile JSON output (schema version bump to 5).
4. Add `clap_similarity(profile_embedding, mix_embedding) -> float` to comparison logic.
5. Update all CI cache keys.

**Effort to implement once decided**: M (3–5 days)

**Deadline**: Medium — this is a differentiating feature before competitors add it. 90-day window
before CLAP embeddings in engineer profiles become table stakes.

---

## 4. ITO-Master Chain Fingerprinting

**What it is**: Sony Research arXiv 2506.16889 describes a method to infer mastering chain
parameters (EQ curve, compression ratio, saturation amount) from a dry mix + finished master
pair. This would add a `chain_fingerprint: {eq_curve, comp_ratio, sat_amount}` field to the
profile — letting RTMcompare not just match *loudness and spectrum* but *infer what processing
the engineer applied*.

**Why it's deferred**: Three hard dependencies:
1. ITO-Master model weights are not publicly released as of May 2026. The paper is published;
   the code and checkpoints are not.
2. Requires paired mix+master files as input — current RTMprofile only needs masters.
   UI and build pipeline need rework to accept paired input mode.
3. The paper's arXiv submission date is June 2025; if provisionally filing patents, this paper
   is citable prior art for the chain-inference direction (not for the cohort-fingerprinting
   direction).

**Options**:
- A) Wait for ITO-Master public release — monitor paper authors' GitHub (Sony Research Tokyo). Estimated: H2 2026.
- B) Approximate now using spectral difference between a mix and master: `chain_curve ≈ master_curve − mix_curve`. Weaker (ignores dynamics, saturation), but implementable in 2 days.
- C) Implement Option B now as "Approximate Chain Analysis" with a UI note ("Upgrade to full chain fingerprinting when ITO-Master weights are released"), then replace with the real model when available.

**Recommendation**: Option C. The spectral-diff approximation is cheap and genuinely useful
for the 20% of users who have both the dry mix and the master. Label it "Approximate Chain
Analysis (beta)" and document the ITO-Master upgrade path. When weights release, swap in the
real model with no user-visible interface change.

**Implementation steps for Option B (approximation)**:
1. Add `--mix-file` argument to `build_profile.py` CLI.
2. In `build_profile()`, if mix file provided: compute mix curve, subtract from master curve,
   store as `chain_curve: [31 floats]` in profile JSON.
3. Add UI affordance in Electron to optionally supply a reference mix.

**Effort to implement once decided**: Option B = S (2 days). Full ITO-Master integration = L
(2–3 weeks when weights are available, including paired-input UI redesign).

**Deadline**: Low for Option B (pure upside, no blocking dependencies). Monitor ITO-Master
GitHub monthly; trigger Option A→C transition when weights appear.

---

## 5. Persistent Python Sidecar + Track Cache

**What it is**: Two separable improvements to the profile build pipeline:
- **Track cache**: content-addressed cache at `~/.rtm/tracks/<sha256_of_audio>.json` storing
  the per-track measurement (LUFS, spectral curve, stem data). Rebuilding a profile with the
  same tracks reads from cache instead of re-running Welch PSD + stem separation. A 10-track
  Deep Scan profile rebuild goes from ~8 min → ~30 sec if tracks haven't changed.
- **Persistent sidecar**: replace the subprocess-per-build model (one Python process per
  `build_profile.py` invocation) with a long-running Python sidecar that the Electron app
  spawns once and communicates with over a local socket. Eliminates ~2–3 sec cold-start per
  build from Python interpreter and model-weight load.

**Why it's deferred**: The sidecar requires new IPC protocol, health monitoring, restart-on-
crash logic, and versioned cache invalidation when schema or model changes. It's a 3–4 week
architectural change. The track cache is independent and can be delivered alone in ~1 week.

**Options**:
- A) Full sidecar + cache (3–4 weeks)
- B) Track cache only, no sidecar (1 week). Biggest UX win per engineering day. The cold-start
  penalty remains but only hits the first build; subsequent rebuilds are fast.
- C) Status quo

**Recommendation**: Option B first. The track cache is self-contained: write per-track analysis
to `~/.rtm/tracks/<sha256>.json` at the end of `_analyse_track()`, check for a cache hit at
the start. Cache key: SHA-256 of the raw audio bytes. Invalidate on schema_version bump.
Sidecar is an architectural investment worth revisiting after the cache ships and user feedback
confirms the cold-start penalty is a real pain point.

**Implementation steps for Option B**:
1. Add `_cache_path(audio_bytes) -> Path` helper: `~/.rtm/tracks/<sha256>.json`.
2. In `_analyse_track()`: check cache hit before processing; write to cache on success.
3. Add cache invalidation: if `schema_version` in cached JSON != current `SCHEMA_VERSION`,
   ignore cache entry and recompute.
4. Add `--no-cache` flag to `build_profile.py` CLI for debugging.

**Effort to implement once decided**: Option B = M (1 week). Option A = L (3–4 weeks).

**Deadline**: Medium. This is a quality-of-life win for power users building profiles iteratively.
Target next major release.

---

## 6. Sonic Identity Marketplace

**What it is**: RTMprofile becomes a platform. Audio engineers publish their HMAC-signed profiles
to a public registry. Artists and producers pay micro-licences to evaluate their mixes against a
named engineer's profile. Engineer profile = licensable IP asset, not just a local file.

**Why it's deferred**: Requires decisions across three domains simultaneously:
- **Infrastructure**: S3-backed profile registry + DynamoDB index + Stripe payment processing.
- **Legal**: Who owns the profile data? What are the engineer's rights if RTMcompare is acquired?
  What jurisdiction governs the licence?
- **Product**: Pricing model (per-comparison, subscription, revenue share?), discovery UX,
  abuse prevention (profile scraping, fake engineer accounts).

**Options**:
- A) Build registry (6–12 months, requires backend team, legal counsel, payment infrastructure)
- B) Partner with an existing marketplace — DAW plugin marketplaces (Plugin Alliance, Splice,
  iZotope ecosystem) already have payment rails, user bases, and distribution. License the
  profile format; let them build the marketplace.
- C) Sell the concept as an acquisition feature — inMusic (Akai, Alesis, M-Audio), Native
  Instruments, Avid, or Waves would find "engineer identity as licensed IP" strategically
  valuable. RTMprofile is a proof-of-concept that de-risks their investment.

**Recommendation**: Validate demand before committing to any infrastructure. The HMAC-signed
JSON export already works — users can share profiles today. Run this experiment: reach out to
3 music schools (Berklee Online, Full Sail, SAE). If their mixing/mastering courses adopt
RTMcompare in a "build your signature profile" assignment, the student cohort generates a
profile corpus organically. That's the seed corpus for any marketplace. If 200 students build
and share profiles in 6 months with zero marketplace infrastructure, Option A or B becomes
a much easier pitch.

**Effort to implement once decided**: XL (6–12 months for full platform, Option A). Partnership
path (Option B) is M (2–3 months to spec the API, find the partner, and draft the licence
agreement). Acquisition path (Option C) requires a deck and an intro, not engineering.

**Deadline**: Low urgency, high strategic upside. Set a 6-month review gate: if RTMcompare has
reached 5,000 MAU and at least 50 engineers have published profiles organically, escalate to
Option A or B.
