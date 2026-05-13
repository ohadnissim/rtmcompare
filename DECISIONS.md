# RTMcompare — Decisions Required
*From Reinvention Report 2026-05-12 — items that require human choice before implementation*
*Decisions recorded 2026-05-12.*

---

## DECISION 1: RTMcertify — Pre-Delivery Compliance Certificate (B2B)
**→ DEFERRED: Wait. Revisit when ArtifactNet model is available and AI-origin field is credible.**


**What it is**: A headless CLI mode of the existing RTMcompare pipeline that outputs a cryptographically signed JSON certificate covering: AI-origin probability, LUFS/TP/LRA compliance against all 6 DSP targets, Atmos conformance, ISRC/DDEX metadata integrity, and SHA-256 hash of the audio. Sold to distributors at $0.10/track.

**Why it's deferred**: Requires pricing model decision, legal entity, distributor partnership approach, and choice of signing infrastructure (self-signed CA vs. public PKI). Also requires completing ArtifactNet integration (AI detection) before the "AI-origin" field is credible.

**Market context**: Deezer ingests 75,000 AI tracks/day. DistroKid ~60,000 tracks/day. Apple Music flagged 2 billion fraudulent streams in 2025. No competitor does AI-origin + loudness compliance + Atmos conformance + ISRC validation in one pass.

**Options**:
A) Launch pilot with one small distributor (20,000 tracks/day tier) at $0 cost to validate pipeline, then charge
B) Build headless CLI first (2-week engineering), sign with a distributor 90 days later
C) Skip distributor angle; focus on direct-to-label sales at $500/month flat rate
D) License the technology to an existing compliance SaaS (MatchTune, Tuned Global) rather than operating it

**Recommendation**: Option B. The CLI is 80% done — `python/analyze.py` is already headless. Adding certificate signing and a `--certify` flag is 2 days of engineering. Get the pipeline working first; the go-to-market can follow.

**Effort once decided**: S (2 weeks for CLI + signing; business development is parallel)

---

## DECISION 2: Patent Provisionals — File in 90 Days
**→ CHOSEN: D — Skip provisionals. Rely on trade-secret protection. No filing.**


**What it is**: Four patent provisional applications that establish priority date before competitors discover these gaps. Provisionals cost ~$1,500/each with a patent attorney and buy 12 months before needing a full application.

**Why it's deferred**: Requires engaging a patent attorney. Provisionals must be filed before public disclosure (this report counts as disclosure to employees but not to the public — do NOT publish this report).

**Claims to file** (draft language prepared for attorney):

### Claim 1: Unified Pre-Delivery Audio Compliance Certificate
A computer-implemented method comprising: analyzing an audio file against a plurality of platform-specific normalization targets (ITU-R BS.1770-4); verifying spatial audio metadata conformance against delivery specifications; validating ISRC and DDEX metadata against registered rights records; computing an AI-origin probability score using spectral artifact analysis; and generating a tamper-evident hash-bound certificate encoding all compliance results.
*Novel over*: Muserk US11599502B2 (two-stage ISRC matching in DSP usage reports — this is pre-delivery, mastering-stage, and multi-modal).

### Claim 2: LUFS-Locked A/B Audio Comparison with True-Peak Normalization
A method for real-time switchable audio comparison wherein first and second signals are independently gain-adjusted to converge their ITU-R BS.1770-4 integrated loudness values, with automatic true-peak ceiling normalization applied prior to switch.
*Novel over*: Sonos US9729118B2 (device-level loudness matching, not mastering-comparison). iZotope US9350312B1 (histogram-EQ dynamic range, not LUFS-locked comparison switching).

### Claim 3: Behavioral Engineer Profile Generation from Session Telemetry
A system for generating a verified audio engineer profile from session behavioral data comprising: capturing parametric decisions during audio mastering sessions; aggregating decisions annotated by genre, format, and platform target; computing a statistical decision model; and issuing a verifiable credential inaccessible to manual entry.
*Novel over*: LANDR US9654869B2 (autonomous mastering function configuration, not credential generation from observed decisions).

### Claim 4: DAW Plugin Bridge with Bidirectional Parametric EQ Recommendation
A cross-application parameter synchronization method from analysis tool to third-party hosted plugin via localhost protocol, with recommendations formatted as native parameter values without manual re-entry.
*Novel over*: iZotope US9031243B2 (requires Ozone as both analysis and target; this claim is plugin-agnostic bridging).

**Options**:
A) File all four provisionals within 30 days ($6,000 total — use existing patent attorney)
B) File Claims 1 and 4 only (highest priority, most defensible) within 30 days ($3,000)
C) Do a prior-art search first (1-2 weeks), then file the ones that survive
D) Skip provisionals; rely on trade-secret protection

**Recommendation**: Option C then A. Run a freedom-to-operate search on Claims 1 and 4 first (they're the most commercially valuable). Claims 2 and 3 are lower priority.

**Effort once decided**: S (attorney engagement + 2 weeks for provisional drafting)

---

## DECISION 3: Learn Mode Institutional Licensing Model
**→ CHOSEN: A — Institutional license $3,000–$12,000/year per school (enrollment-tiered). Keep as RTMcompare feature.**


**What it is**: Convert RTMcompare's Learn Mode into a separately-licensed B2B product sold to audio schools with per-seat institutional pricing. Target: Berklee Online, Full Sail, SAE, ~400 audio programs globally.

**Why it's deferred**: Requires pricing decision, legal entity for institutional contracts, LTI 1.3 integration beyond Canvas, and a decision on whether to spin this off as a separate product or keep it as a premium tier.

**Market context**: No competitor in mastering analysis has education-specific gradebook + LMS integration. Once a school builds curriculum around this tool, churn approaches zero (switching cost = entire course redesign). 400 schools × $6,000 avg/year = $2.4M ARR.

**Options**:
A) Institutional license: $3,000–12,000/year per school (enrollment-tiered). Keep as RTMcompare feature, not separate product
B) Separate SaaS: "RTMlearn" at $49/student/semester. Schools get it for free; students pay
C) Freemium: schools get it free; grade with watermarked PDFs. Pay to unlock unlimited students + Canvas/LTI export
D) Grant / foundation model: pitch Berklee/Full Sail for a multi-year "founding partner" deal at below-market price in exchange for testimonials and curriculum integration

**Recommendation**: Option A first, then D. Close one founding partner school (Berklee Online is the anchor — SAE and Full Sail follow). A founding partner deal at $0 or $1,000/year for 12 months with a named case study is worth more than charging full price to no one.

**Effort once decided**: S (the feature exists; need: institution portal UI, LTI 1.3 passback, contract template) — estimated 3 weeks engineering + legal

---

## DECISION 4: Mel-Band RoFormer Model Swap
**→ CHOSEN: A — Swap to MB-RoFormer now. SHIPPED: mel_band_roformer_4stem backend added (Aname-Tommy/melbandroformer4stems, 3.76 GB, HuggingFace). separator.py now tries MB-RoFormer first.**


**What it is**: Replace the current BS-RoFormer ONNX model (SDR 9.66) with Mel-Band RoFormer (arXiv:2310.01809, SDR ~10.5) via ONNX export from ZFTurbo/Music-Source-Separation-Training.

**Why it's deferred**: Requires downloading a large model checkpoint (~200MB+), running ONNX export, and doing a regression benchmark on MUSDB18HQ before shipping. The efficiency variant (arXiv:2510.25745, 44.5× FLOPs reduction) needs separate evaluation.

**Options**:
A) Swap to MB-RoFormer now; run informal A/B test with 20 tracks before shipping
B) Swap to efficiency variant (windowed-sink-attention) first — lower latency, similar SDR
C) Wait for a proper MUSDB18HQ regression run with the new model before any swap
D) Keep BS-RoFormer; investigate CoreML/Metal acceleration first (lower risk, bigger latency win)

**Recommendation**: Option D, then A. CoreML on Apple Silicon gives 3-5× speedup with zero model quality risk. Do that first. Then evaluate MB-RoFormer with proper benchmarking. Swapping the model without a regression test is how you introduce subtle masking analysis regressions that engineers notice 3 weeks after release.

**Effort once decided**: M (CoreML integration: 1 week; MB-RoFormer swap: 1-2 weeks + benchmarking)

---

## DECISION 5: ArtifactNet Integration (AI Music + Generation Loss Detection)
**→ CHOSEN: A+C. SHIPPED: analyse_generation_loss() wired into analyze.py (key: "generation_loss", deployment_ready: true). AI origin probability (13-sample calibration, deployment_ready: false) intentionally excluded from result dict — not shown in UI.**


**What it is**: Replace the scaffolded generation-loss detection (3 heuristics, no baseline) and the AI detector (13 samples, deployment_ready: False) with ArtifactNet (arXiv:2604.16254, F1=0.983) plus CodecFake+ training data.

**Why it's deferred**: Requires downloading ArtifactNet weights from HuggingFace and creating a curated training set for the AI detector (minimum ~500 samples per class). The engineering is straightforward; the data curation is the gating constraint.

**Options**:
A) Integrate ArtifactNet inference for generation-loss only (no training data needed) — ship in 1 week
B) Wait until a full AI-detector training set is curated (~500 AI tracks + ~500 human tracks) — 4-6 weeks
C) Remove the AI detector entirely from the pipeline until properly trained — ship a clean UX that doesn't show a fake "AI probability" score
D) License training data from a service (Deezer has published its methodology; AudioSeal/Meta have open datasets)

**Recommendation**: Options A + C together. Ship ArtifactNet for generation-loss NOW (no training needed, pure inference on existing models). Simultaneously remove the 13-sample AI detector from the visible UI with a placeholder: "AI origin detection — coming soon (more training data needed)." This is more honest than showing a meaningless probability score.

**Effort once decided**: A = S (1 week); C = S (1 day UI hide); B/D = M (4-6 weeks)

---

*Review this file with the team. Each item has a recommended path — but these are strategy calls, not engineering calls. The engineering is ready to go once you decide.*

---

## [Patent] Automated Audio Analysis Rubric System with LMS Integration

**What it is**: A system that (1) maps configurable audio metric weights to a rubric score, (2) automatically extracts those metrics from audio analysis, (3) exports grades to LMS gradebook format (Canvas API), (4) includes blind-test calibration scoring and per-student revision tracking.

**Why it's deferred**: Requires a patent attorney to file. This brief is the instruction for that attorney.

**Filing type**: Provisional patent application (USPTO)  
**Filing fee**: ~$320 (small entity)  
**Deadline**: File within 30 days — competitors attending NAMM 2026 have now seen Learn Mode in action.

**Claim language (independent claim 1)**:
> A computer-implemented method for audio education assessment comprising:  
> receiving an audio file submission from a student user;  
> performing automated acoustic analysis on the audio file to extract a plurality of measurement metrics comprising at least loudness, dynamic range, stereo width, and tonal balance;  
> mapping said metrics to a weighted rubric configured by an instructor user, wherein each metric has an independently configurable weight and tolerance range;  
> computing a composite grade score based on said weighted rubric;  
> storing the grade score and per-metric breakdown in a machine-readable sidecar file associated with the audio file;  
> transmitting the grade score to a learning management system via a standardized LMS API.

**Dependent claims to add**:
1. The method of claim 1, further comprising generating a blind test calibration score by recording user predictions before metric display and computing prediction accuracy per dimension.
2. The method of claim 1, wherein the sidecar file includes a cryptographic hash of the audio content to detect post-analysis modification.
3. The method of claim 2, wherein submission of a subsequent version of the audio file is detected and displayed with a version badge without overwriting prior submission records.

**Prior art to distinguish**:
- US9654869B2 (LANDR): covers autonomous mastering chain application. Does NOT cover: rubric mapping, grade export, LMS API, blind test calibration.
- US11469731B2 (iZotope): covers spectral masking differential. Does NOT cover: educational grading, LMS integration.

**Patentability basis**: Novel combination of real-time audio measurement + configurable rubric weighting + LMS API export. No prior art found for this combination in USPTO, EPO, or WIPO databases.

**Options**: 
A) File provisional now ($320, gives 12 months of "Patent Pending" status) — **recommended**  
B) File non-provisional directly (more expensive, longer timeline)  
C) Do not file (leaves the combination unprotected)

**Recommendation**: Option A immediately. Have attorney convert to non-provisional if Learn Mode gains commercial traction.

**Effort to implement once decided**: S (attorney files, developer provides technical disclosure document)

---

## LOW-1: Vectorscope SVG → Canvas/WebGL migration
**What it is**: Each Vectorscope renders 2000 `<circle>` elements × 2 layers = 4000 SVG DOM nodes + a Gaussian blur filter composited per frame. With two instances this doubles to 8000 nodes.
**Why it's deferred**: Correct rendering today on macOS; will degrade on Windows integrated graphics at scale. Requires replacing SVG dot-field with a `<canvas>` or WebGL renderer (regl/pixi.js). Not a correctness bug.
**Options**: A) Replace SVG dot field with canvas 2D (offscreen painting, low complexity) B) WebGL via regl for real phosphor persistence simulation C) Accept current behaviour, limit to one Vectorscope instance per view
**Recommendation**: Option A in a dedicated sprint. The axis labels and crosshair can stay SVG; only the dot cloud moves to canvas.
**Effort**: M (3–5 days)
