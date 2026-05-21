# UAI — AI Music Detection Competitive Intelligence
**Generated**: 2026-05-17
**Scope**: Full competitive landscape for AI-generated music detection market
**Supersedes**: RTMcompare competitive report (2026-05-16)

---

<!-- UAI COMPETITIVE INTELLIGENCE BELOW — full report starts here -->

# UAI Competitive Intelligence — Master Summary

**Generated**: 2026-05-17
**Scope**: AI music detection market — all known competitors as of May 2026
**UAI benchmark for comparison**: 24-detector ensemble, F1=0.998, 4-stem BS-RoFormer, certificate generation, patent-pending

---

## Competitor Landscape Overview

The AI music detection market reached critical mass in late 2025 / early 2026, driven by three simultaneous forces: AI-generated music now represents 39-44% of all new uploads to major streaming platforms (Deezer reports 60,000 AI tracks/day as of April 2026); EU AI Act Article 50 takes effect August 2, 2026, mandating machine-readable marking of AI-generated audio; and collecting societies (ASCAP, BMI, SOCAN) formally adopted policies in October 2025 to reject fully AI-generated music while accepting human-AI hybrids.

The result is a fragmented market with no dominant winner. Six distinct players have launched AI detection products — but no single competitor offers per-stem analysis, certificate generation, AND a self-service API in one product. UAI's combination of these three capabilities represents the most defensible position in the market.

---

## Competitor Feature Grid

| Feature | UAI | Deezer | Pex/Vobile | Beatdapp | IRCAM Amplify | ACRCloud | authio |
|---------|-----|--------|------------|----------|--------------|---------|--------|
| **Accuracy (claimed)** | F1=0.998 | 99.8% lab / <0.01% FP | Not disclosed | Not disclosed | 99% | Not disclosed | 99.42% |
| **Per-stem analysis** | YES (4-stem BS-RoFormer) | No | No | No | No | 2-stem only | No |
| **Certificate generation** | YES | No | No | No | No | No | No |
| **Self-service API** | YES | No (partners only) | No (contact) | No (demo only) | No (request) | YES (14-day trial) | YES |
| **Desktop app** | YES | No | No | No | No | No | No |
| **Generator IDs published** | Suno/Udio/Boomy/Lyria/AI ACAP | Suno/Udio | Suno/Udio/Boomy/ElevenLabs | Not specified | Suno/Udio/Sonauto/ElevenLabs | 8 (widest list) | 9 |
| **Batch processing** | YES | YES (150K/day) | Not disclosed | Not disclosed | 250K/hour | YES | YES (250K/mo enterprise) |
| **Pricing transparency** | TBD | No (enterprise only) | No | No | No | Free trial | YES (€12-€9,999) |
| **Patent-pending** | YES | YES (2 patents) | No | No | No | No | No |
| **EU AI Act positioning** | YES | YES | No | No | YES | Partial | YES |
| **Streaming fraud bundle** | No | No | No | YES (core product) | No | No | No |
| **Copyright ID combined** | No | No | YES (Pex 120M DB) | No | No | YES (150M DB) | No |
| **Named enterprise customers** | TBD | SACEM, EJI | Disney, Twitch (overall) | UMG, MLC, SoundExchange | None published | TikTok SoundOn | None |
| **Academic research published** | No | YES (ICASSP 2025) | No | No | YES (IRCAM heritage) | No | No |

---

## Pricing Comparison

| Product | Entry Price | Enterprise | Trial |
|---------|------------|------------|-------|
| UAI | TBD | TBD | TBD |
| Deezer AI Detection | Not disclosed | Partnership only | No |
| Pex/Vobile AI Song Detector | Not disclosed | Not disclosed | No |
| Beatdapp Trust & Safety OS | Not disclosed | Not disclosed | Demo only |
| IRCAM Amplify | Not disclosed | Not disclosed | Request |
| ACRCloud AI Detector | ~$32/10K requests (est.) | Contact sales | 14-day free |
| authio | €12/month (200 tracks) | €2,399+/month | 14-day, 20 analyses |
| Sightengine | $29/month | $399/month | Free tier |

---

## Positioning Map

```
                    HIGH ENTERPRISE CREDIBILITY
                              |
              Deezer           |        Beatdapp
           (production scale, |     (UMG/MLC/fraud OS,
            collecting soc.)  |      opaque AI detect)
                              |
   API-ONLY ─────────────────────────────────────── FULL PLATFORM
      (dev-first)             |                      (UI + API + cert)
                              |
         ACRCloud             |          UAI (target position)
      (self-service,          |    (API + desktop + certs + stems)
       2-stem, no cert)       |
                              |
         authio               |    IRCAM Amplify
    (transparent pricing,     |  (batch speed, academic
     no stems, no cert)       |   cred, no self-service)
                              |
                    LOW ENTERPRISE CREDIBILITY
```

---

## First Mover Opportunities — Things No Competitor Offers Yet

### 1. Per-Stem Certificate Generation
**The gap**: Zero competitors offer a legally defensible certificate tied to per-stem analysis. Deezer offers dashboards. authio offers JSON logs. No one offers a signed, tamper-evident certificate that says "this track's vocal stem is 94% AI-generated (Suno), instrumental stem is 87% AI-generated (Udio), certified by UAI v2.1.0 on 2026-05-17."
**Why it matters**: Collecting societies (SACEM, SOCAN, PRS) need something they can reference in registration decisions. Labels need something for legal defense. Distributors need something for compliance documentation. Nobody serves this need.

### 2. 4-Stem Hybrid Track Detection
**The gap**: All competitors do binary (AI vs. human) or 2-stem (vocal/accompaniment). None do 4-stem (vocals, drums, bass, other) with per-stem confidence scores.
**Why it matters**: The real fraud problem in 2026 is hybrid tracks — AI instrumentals under human vocals, AI vocals over human productions. Binary detection misses this. 2-stem misses drums and bass. UAI's 4-stem analysis is the only way to catch partial AI in catalog-scale enforcement.

### 3. Collecting Society Integration / Registration Decision API
**The gap**: ASCAP, BMI, SOCAN announced in October 2025 they accept partially AI-generated works but reject fully AI-generated ones — but they have no tool to verify the distinction. No competitor has built an API specifically for collecting society registration decisions.
**Why it matters**: This is a greenfield B2B market of ~100 collecting societies worldwide, each needing to make binary registration decisions at scale. Deezer has SACEM and EJI, but only as licensing customers — not as an integrated registration workflow tool.

### 4. Adversarial Robustness Proof
**The gap**: Deezer's own ICASSP 2025 paper admits their technology "fails drastically" under pitch shifts and re-encoding. No competitor publishes adversarial robustness benchmarks.
**Why it matters**: In a world where "AI humanizer" tools actively market themselves to content farms, robustness to post-processing is the actual moat. UAI's 24-detector ensemble is architecturally more robust than single-model approaches.

### 5. White-Label Distributor Integration Kit
**The gap**: No competitor offers a white-label solution that distributors can embed in their upload workflow with their own branding, DDEX metadata passthrough, and Spotify AI Credits integration.
**Why it matters**: DistroKid, TuneCore, FUGA, and Believe are all building AI detection into their upload flows. The distributor that gets this right first owns the upstream detection market. Currently they're all building custom solutions or using undisclosed vendors.

---

## The One Moat Defensible for 3+ Years

**Per-stem analysis tied to legally defensible certificates, backed by a patent.**

Here is the reasoning:

1. **Technical barrier**: 4-stem BS-RoFormer separation + per-stem classification requires significant ML infrastructure. Competitors (IRCAM, authio, ACRCloud) are 1-2 years away from matching this even if they start today.

2. **Legal barrier**: Certificate generation is not just a technical feature — it requires legal/compliance expertise to make certificates defensible in regulatory proceedings, collecting society registrations, and potential copyright litigation. This expertise compounds over time as UAI accumulates case law, regulator relationships, and precedent.

3. **Network effects via collecting societies**: Once 3-5 collecting societies standardize on UAI certificates for registration decisions, every label and distributor that submits to those societies must use UAI-compatible documentation. This creates switching costs entirely independent of technical quality.

4. **EU AI Act Article 50 timing**: The enforcement deadline is August 2, 2026 — approximately 75 days away. Any company that wants to be compliant needs to integrate AI detection NOW. This creates a winner-take-most dynamic for whoever signs the first major distributor contracts in the next 90 days.

5. **Patent protection**: UAI's patent-pending status on the 24-detector ensemble + calibration head could defensively block competitors from copying the exact architecture. Deezer has 2 patents on different methods, but no competitor has patented the XGBoost calibration head approach.

---

## What Streaming Platforms and Distributors Are Actually Asking For

Based on public statements, policy announcements, and regulatory filings (May 2026):

### Spotify (September 2025 AI Protections + April 2026 Beta)
- **DDEX metadata standard** for AI disclosure — they want structured metadata from distributors, not detection responsibility
- **Spam filter** for mass AI uploads — volume/velocity detection, not just per-track classification
- **Artist verification** (Verified badge) to protect human artists from AI impersonation
- **What Spotify is NOT asking for**: They want distributors to handle detection at ingestion; Spotify validates metadata, does not run detection themselves
- **Signal**: Spotify wants the detection problem solved upstream (at the distributor level) before content reaches them

### Deezer
- Solving this internally — their AI detection is for their own platform + licensing out
- They are a potential customer for UAI's per-stem and certificate capabilities (Deezer's own detector lacks these)
- Their 44% AI upload figure (April 2026) signals the problem is accelerating, not plateauing

### DistroKid (April 2026 Spotify AI Credits launch partner)
- Mandatory AI disclosure checkbox at upload
- Automated screening runs on all uploads
- **Gap they are trying to solve**: Detection of undisclosed AI (the fraud case, not the disclosure case)
- **What they need from UAI**: Accurate per-track classification at upload, fast (under 5 seconds), reliable (low false positives are more important than high true positives for a distributor)

### Collecting Societies (ASCAP/BMI/SOCAN October 2025 policy)
- They accept hybrid (partially AI) works; reject fully AI works
- **Critical gap**: They have no tool to verify the boundary between "partially AI" and "fully AI"
- **What they need from UAI**: Per-stem analysis + certificate that quantifies AI percentage per component + defensible methodology documentation
- **Quote from SOCAN public statement**: "There are still no clear answers as to how anyone (including SOCAN) could tell the difference between 95% human / 5% AI, and 95% AI generated / 5% human." — This is UAI's entire value proposition to collecting societies

### FUGA / Believe / IDOL (Spotify DDEX rollout partners)
- Currently building DDEX metadata passthrough for Spotify AI Credits
- Need detection capability to validate that disclosed metadata is accurate and to flag undisclosed AI
- **What they need from UAI**: API integration, DDEX-compatible output metadata, volume pricing

### CD Baby (full AI ban)
- Strictest policy — 100% AI blocked
- **Need**: Reliable binary detection with very low false positive rate (they need to be confident before rejecting a submission)
- **UAI advantage**: 24-detector ensemble reduces single-point-of-failure false positives

---

## Key Strategic Observations

### 1. The market is bifurcating: disclosure vs. enforcement
The "easy" problem is AI disclosure (artists self-report, Spotify displays the tag). The hard, high-value problem is enforcement (detect undisclosed AI, build evidence for legal action). Only UAI's certificate approach addresses the enforcement case.

### 2. No competitor serves collecting societies well
Deezer has SACEM and EJI as lighthouse customers but no purpose-built registration API. Pex/ACRCloud/IRCAM/authio all target distributors and DSPs but show no collecting society traction. This is the highest-value unserved segment — collecting societies represent the legal gatekeeper for royalty eligibility in every EU country.

### 3. The "AI humanizer" arms race creates sustained demand for adversarial-robust detection
Tools that post-process AI music to evade detection are already being sold commercially. Deezer's own research confirms single-model detectors fail under pitch shifts and re-encoding. UAI's ensemble approach is architecturally more robust to this adversarial scenario.

### 4. EU AI Act enforcement in ~75 days creates NOW urgency
August 2, 2026 is the hard deadline for EU AI Act Article 50. Any EU-based distributor, DSP, or collecting society that has not implemented compliant AI detection before then faces fines up to €30M or 7% global turnover. This is UAI's most powerful near-term sales trigger.

### 5. The market-defining contract is likely with a collecting society, not a DSP
DSPs (Spotify, Apple Music) are building detection upstream at the distributor level. But collecting societies make irreversible registration decisions — and those decisions are already being challenged. The first AI detection company to become a collecting society's "official detection partner" will have a defensible institutional moat for 10+ years.

---

## Individual Competitor Files

- `deezer-ai-detection.md` — Deezer's commercial AI detection product profile
- `pex-vobile.md` — Pex (acquired by Vobile) AI Song Detector profile
- `beatdapp.md` — Beatdapp Trust & Safety OS (AI detection + fraud)
- `ircam-amplify.md` — IRCAM Amplify AI Music Detector profile
- `acrcloud.md` — ACRCloud AI Music Detector profile
- `authio.md` — authio (Forward Digital) AI music detector profile
- `audible-magic.md` — Audible Magic (content ID incumbent, not direct competitor)
- `landr.md` — LANDR (distributor using third-party detection, not competitor)
- `c2pa-truepic.md` — C2PA/Truepic provenance standard (complement, not competitor)

---

## Research Sources

- Deezer newsroom: newsroom-deezer.com (Jan, Apr, Jun 2025; Jan, Mar, Apr 2026)
- Deezer research: research.deezer.com/publication/2025/04/10/ICASSP-Afchar.html
- Deezer ICASSP paper: arxiv.org/html/2501.10111v1
- Pex AI Song Detector: pex.com/ai-song-detector + pex.com/blog
- Vobile acquisition: prnewswire.com/news-releases/vobile-completes-acquisition-of-pex
- Beatdapp: beatdapp.com/trust-safety/ai-music-detection + musically.com Dec 2025
- IRCAM Amplify: ircamamplify.com/products/ai-music-detector
- ACRCloud: acrcloud.com/ai-music-detector
- authio: authio.io + authio.io/solutions
- Audible Magic: audiblemagic.com + Udio partnership PR
- LANDR: landr.com/fairai + support.landr.com
- C2PA: c2pa.org specification docs + truepic.com
- Spotify AI policy: newsroom.spotify.com/2025-09-25
- ASCAP/BMI/SOCAN AI policy: bmi.com + socan.com Oct 2025
- EU AI Act Article 50: digital-strategy.ec.europa.eu
- Distributor policies: dynamoi.com, undetectr.com, soundverse.ai (multiple articles, 2025-2026)
- Market comparison: fwdmusic.com/en/news/best-ai-music-detectors-2026

---

<!-- LEGACY RTMCOMPARE COMPETITIVE REPORT (2026-05-16) PRESERVED BELOW -->



---

## PART 1 — COMPETITIVE TEARDOWN

### Competitor Feature Grid

| Feature | iZotope Insight 2 | Nugen VisLM | Nugen MasterCheck | TC LM6 | Waves WLM+ | LoudnessPenalty | Reference 3 (MTM) | Sonarworks SoundID | FLUX MiRA | LANDR/eMastered | RTMcompare |
|---|---|---|---|---|---|---|---|---|---|---|---|
| LUFS/Integrated Loudness | YES | YES | YES | YES | YES | YES (penalty only) | YES | NO | YES | YES (output only) | YES |
| True Peak | YES | YES | YES | YES | YES | NO | NO | NO | YES | TP readout only | YES |
| Loudness Range (LRA) | YES | YES | YES | YES | NO | NO | YES | NO | YES | NO | YES |
| Momentary/Short-term | YES | YES | YES | YES | NO | NO | NO | NO | YES | NO | YES |
| Streaming platform preview | NO | NO | YES (8 platforms) | NO | NO | YES (7 platforms, penalty score) | NO | NO | NO | YES (output) | YES |
| Codec simulation (MP3/AAC) | NO | NO | YES | NO | NO | NO | NO | NO | NO | NO | NO |
| Broadcast standards (EBU/ATSC/CALM) | YES | YES | NO | YES | YES | NO | NO | NO | YES | NO | NO |
| Leq(m) for broadcast | NO | YES | NO | NO | YES | NO | NO | NO | NO | NO | NO |
| Surround/Immersive (Atmos) | YES (7.1.2) | YES (7.1.4) | YES (7.1.4) | YES (5.1) | NO | NO | NO | YES (9.1.6) | YES (24ch) | NO | YES (QC) |
| A/B comparison | NO | NO | YES | NO | NO | YES (penalty vs penalty) | YES (up to 12 refs) | NO | NO | YES (3 AI masters) | YES (core feature) |
| Tonal balance reference matching | NO | NO | NO | NO | NO | NO | YES | YES (room-corrected monitoring) | NO | NO | YES (engineer profiles) |
| Written mix guidance / AI suggestions | NO | NO | NO | NO | NO | NO | YES (Mix Instructor) | NO | NO | YES (AI processing) | NO |
| Spectrogram / spectral display | YES | NO | NO | NO | NO | NO | YES (Masterscope EQ delta) | NO | YES (Nebula Spatial) | YES (freq analyser) | NO |
| Stereo vectorscope / goniometer | YES | NO | NO | NO | NO | NO | YES | NO | YES (Nebula) | NO | NO |
| Phase correlation meter | YES | NO | NO | NO | NO | NO | YES | NO | YES | NO | NO |
| Intelligibility meter (dialogue) | YES | NO | NO | NO | NO | NO | NO | NO | NO | NO | NO |
| Room / monitor calibration | NO | NO | NO | NO | NO | NO | NO | YES (500+ headphones, speakers) | NO | NO | NO |
| Listening environment simulation | NO | NO | NO | NO | NO | NO | NO | YES (car, consumer, hi-fi) | NO | NO | NO |
| PLR / PSR dynamic metrics | NO | YES | YES | NO | NO | NO | NO | NO | YES | NO | NO |
| Radar loudness display | NO | NO | NO | YES | NO | NO | NO | NO | NO | NO | NO |
| Historical scrolling / ReMEM | NO | YES (24hr) | NO | YES (1min–24hr) | NO | NO | NO | NO | NO | NO | NO |
| Click/distortion/hum detection | NO | NO | NO | NO | NO | NO | NO | NO | NO | NO | YES |
| Generation-loss detection | NO | NO | NO | NO | NO | NO | NO | NO | NO | NO | YES |
| Dolby Atmos QC | NO | NO | NO | NO | NO | NO | NO | NO | NO | NO | YES |
| Engineer profile matching | NO | NO | NO | NO | NO | NO | YES (tonal descriptors) | NO | NO | NO | YES (full profile) |
| Ear training module | NO | NO | NO | NO | NO | NO | NO | NO | NO | NO | YES |
| Student/teacher learn mode | NO | NO | NO | NO | NO | NO | NO | NO | NO | NO | YES |
| Offline/faster-than-realtime scan | YES (AudioSuite) | YES (AudioSuite) | YES (AudioSuite) | NO | NO | YES (local file) | NO | NO | YES | YES | NO |
| Standalone app | YES | YES | NO | NO | NO | YES (desktop) | NO | YES | YES | YES | YES (Electron) |
| AI Auto-EQ / correction suggestions | NO | NO | NO | NO | NO | NO | NO | NO | YES (v26.04) | YES | NO |
| Price | FREE (was $249) | $449 | $249 | ~$200 | Waves sub $15/mo | FREE web | $79 | £99–£249 | TBD sub | LANDR sub | TBD |

---

## Competitor Profiles (Individual)

### 1. iZotope Insight 2

**URL**: https://www.izotope.com/en/products/insight  
**Price**: Currently FREE (was $249; made free Dec 2025 as holiday promo — now permanently in Plugin Boutique)  
**Unique angle**: Broadest measurement suite aimed at post-production and broadcast; the category "Swiss Army knife"

**Key features not in RTMcompare**:
- Spectrogram with full spectral content display
- Stereo vectorscope and goniometer
- Phase correlation meter
- Intelligibility meter (dialogue-to-music loudness ratio — unique in market)
- Surround to 7.1.2 Atmos
- AudioSuite offline/faster-than-realtime scanning
- Support for EBU R128, BS.1770-1/2/3/4, ATSC A/85, OP-59 broadcast standards

**RTMcompare gaps vs Insight 2**: Spectrogram, vectorscope, phase meter, intelligibility meter, broadcast compliance standards panel  
**Insight 2 gaps vs RTMcompare**: No A/B comparison workflow, no streaming codec simulation, no streaming platform penalty preview, no engineer profile matching, no click/distortion/hum/generation-loss QC, no ear training, no student-teacher mode

**User praise** (Sweetwater/Gearspace): Visual clarity, the intelligibility meter is uniquely useful in post-production, comprehensive broadcast standard support  
**Top complaint**: Low Sweetwater rating (3/5); concerns about iZotope's subscription churn and abandonment of products; now that it's free, some question whether development will continue  
**Threat level for RTMcompare**: MEDIUM-HIGH — free distribution changes competitive calculus; but it lacks RTMcompare's core workflow (A/B comparison, QC artifact detection, streaming preview)

**Sources**: https://www.izotope.com/en/products/insight/features/loudness-and-true-peak-metering | https://www.gearnews.com/izotope-insight-2-freeware/ | https://www.pluginboutique.com/product/2-Effects/25-Spectral-Analysis/16306-Insight-2-2025-Freebie

---

### 2. Nugen Audio VisLM

**URL**: https://nugenaudio.com/vislm/  
**Price**: $449  
**Unique angle**: Broadcast-first; the most trusted loudness meter in post-production facilities; 24-hour ReMEM scrolling history

**Key features not in RTMcompare**:
- ReMEM: stores up to 24 hours of loudness data with timecode-lock — enables "go back and check that scene" workflows
- Leq(m) AND Leq(a) measurement (only VisLM + WLM Plus in market; needed for CALM Act)
- Automated loudness overdub (re-record audio to match target automatically)
- Offline AudioSuite for faster-than-realtime batch processing
- PlayStation and Xbox One certified formats
- PSR (Peak-to-Short-Term Loudness Ratio) display

**RTMcompare gaps vs VisLM**: Leq(m)/Leq(a) for broadcast CALM compliance, 24-hour historical scrolling/ReMEM, timecode-locked measurement  
**VisLM gaps vs RTMcompare**: No streaming platform preview, no A/B comparison, no codec simulation, no QC artifact detection, no engineer profiles

**User praise** (Gearspace): "Spot on all the time"; trusted by post facilities; ReMEM is beloved  
**Top complaint**: $449 is expensive for what's essentially a meter; "Youlean does 90% of this for free"  
**Sources**: https://nugenaudio.com/vislm/ | https://gearspace.com/board/mastering-forum/1442855-most-industry-trusted-metering-plugin.html

---

### 3. Nugen Audio MasterCheck

**URL**: https://nugenaudio.com/mastercheck/  
**Price**: $249  
**Unique angle**: Only dedicated tool with real codec audition (actual MP3/AAC/Ogg encoding preview in realtime); streaming-platform-targeted mastering

**Key features not in RTMcompare**:
- Real codec simulation: hear actual MP3/AAC/Ogg encoding artifacts in realtime (not just level penalties)
- 8 streaming platform presets: Spotify, Apple Music, Tidal, YouTube, SoundCloud, Bandcamp, Qobuz, Pandora
- PSR and PLR display alongside LUFS
- Surround to 7.1.4 for immersive deliverables
- Client education workflow: shows clients why loudness war doesn't work on streaming

**RTMcompare gaps vs MasterCheck**: Real codec encode/decode audition (the most unique gap); PSR/PLR display  
**MasterCheck gaps vs RTMcompare**: No click/distortion/hum detection, no engineer profile matching, no generation-loss detection, no ear training, no A/B file comparison workflow, limited visual analysis

**User praise**: "Essential tool" (Andy Sneap); useful for convincing clients; easy to understand  
**Top complaint**: Complaints that DistroKid/aggregators don't allow per-platform masters; $249 for a single-purpose tool  
**Sources**: https://nugenaudio.com/mastercheck/ | https://ra.co/reviews/21750

---

### 4. TC Electronic LM6 Radar Loudness Meter

**URL**: https://www.tcelectronic.com/loudness-products.html  
**Price**: ~$200 (native plug-in)  
**Unique angle**: The iconic radar display — loudness history visualized as circular time-sweep; broadcast workhorse

**Key features not in RTMcompare**:
- Radar display: clock-like circular sweep showing loudness over time (1 minute to 24 hours per revolution)
- Configurable radar sweep speed for different delivery contexts (QC a feature film vs. a 3-min song)
- Full broadcast standard compliance: ITU BS.1770-3, ATSC A/85, EBU R128, TR-B32, OP-59
- Established industry trust in broadcast — often spec'd by broadcasters as required delivery tool

**RTMcompare gaps vs LM6**: Radar display (unique UX), broadcast standard compliance panel  
**LM6 gaps vs RTMcompare**: No streaming preview, no codec simulation, no A/B comparison, no QC, no mastering workflow  
**Sources**: https://service.tcgroup.tc/lm6-features.asp | https://www.prosoundweb.com/tc-electronic-introduces-lm6-radar-loudness-meter-as-cross-platform-native-plug-in/

---

### 5. Waves WLM Plus

**URL**: https://www.waves.com/plugins/wlm-loudness-meter  
**Price**: Waves subscription ($15/mo Essential, $25/mo Ultimate)  
**Unique angle**: Most accessible entry point via Waves sub; strong brand recognition; built-in gain correction

**Key features not in RTMcompare**:
- Built-in gain correction/trim (measure, then auto-correct to target in one step)
- Leq(m) support alongside standard LUFS (only other tool with Leq(m) besides VisLM)
- Correction mode: auto-adjusts output to hit loudness target
- 660+ user reviews with 4.79/5 average — highest review volume of any metering tool

**RTMcompare gaps vs WLM+**: Leq(m), in-plugin gain correction/auto-trim  
**WLM+ gaps vs RTMcompare**: No streaming preview, no codec sim, limited display options, no A/B, no QC, no mastering workflow  
**Sources**: https://www.waves.com/plugins/wlm-loudness-meter

---

### 6. Loudness Penalty (loudnesspenalty.com)

**URL**: http://www.loudnesspenalty.com/  
**Price**: FREE web tool; paid plugin versions (AAX, AU, VST)  
**Unique angle**: Penalty-framing — showing "how many dB louder/quieter" your track will sound on each platform; privacy-first (no upload)

**Key features not in RTMcompare**:
- Penalty score framing: "-2.4 on YouTube = 2.4 dB quieter than original" — intuitive for non-engineers
- 7 platform comparison simultaneously (YouTube, Spotify, TIDAL, Apple Music, Amazon, Pandora, Deezer)
- Apple Legacy vs current Apple Music variant shown separately
- Educational email series on platform-specific compression
- Local file processing (no server upload, anonymous)
- Available as web analyzer, desktop app, AND DAW plugin — most distribution channels of any competitor

**RTMcompare gaps vs LP**: Penalty framing (client-friendly language), side-by-side multi-platform penalty score grid  
**LP gaps vs RTMcompare**: No actual audio preview of normalized result, no A/B comparison, no QC, no codec sim, no mastering workflow  
**Sources**: http://www.loudnesspenalty.com/

---

### 7. Mastering The Mix REFERENCE 3

**URL**: https://www.masteringthemix.com/products/reference  
**Price**: $79 (£59)  
**Unique angle**: Mix Instructor AI — writes in plain English what you need to change to match a reference track; "Match %" score

**Key features not in RTMcompare**:
- Match % score: single number showing how close your track is to reference (tonal balance, stereo width, dynamics, loudness combined)
- Mix Instructor: plain-English written guidance ("reduce bass by 2 dB between 80–160 Hz")
- Smart Reference Tracks: auto-suggests best 4 matches from your library based on analysis
- Auto-loop: loops the loudest section of reference automatically for accurate comparison
- Compare up to 12 reference tracks simultaneously
- Mix Balance: suggests gain adjustments for vocals/drums/music/bass separately
- Mix Descriptors: tonal balance and stereo width labels per track
- Masterscope: shows exact EQ delta and stereo width adjustments needed; flags phase issues and overcompression
- 15-day free trial; 30-day money-back

**RTMcompare gaps vs Reference 3**: Plain-English Mix Instructor guidance, Match % score, multi-reference smart library, overcompression flagging from Masterscope  
**Reference 3 gaps vs RTMcompare**: No loudness standard compliance, no streaming platform preview, no artifact QC, no codec simulation, no Atmos support  
**Sources**: https://www.masteringthemix.com/products/reference | https://bedroomproducersblog.com/2026/04/07/mastering-the-mix-reference-3/

---

### 8. Sonarworks SoundID Reference

**URL**: https://www.sonarworks.com/soundid-reference  
**Price**: £99 (headphones only), £249 (speakers + headphones), £299 (with mic)  
**Unique angle**: The only competitor focused on the monitoring chain rather than the audio itself; 250,000+ studios; translation check across listening environments

**Key features not in RTMcompare**:
- Room correction: measures actual room response with mic and generates correction curve
- 500+ headphone calibration profiles
- Speaker calibration for stereo to 9.1.6 Atmos setups
- Translation check: simulate car stereo, consumer earbuds, hi-fi, various speakers
- Virtual Monitoring add-on: simulate specific speakers on headphones
- Zero-latency processing with linear phase, mixed, and zero-latency filter modes
- Custom target curve (flat, Dolby Atmos, custom presets)
- System-wide standalone application (works outside DAW)

**RTMcompare gaps vs SoundID**: Translation/environment simulation (car, earbuds, etc.), headphone/speaker calibration — entirely different category  
**SoundID gaps vs RTMcompare**: Entirely different use case — no loudness measurement, no streaming preview, no A/B comparison, no QC  
**Sources**: https://www.sonarworks.com/soundid-reference | https://www.sonarworks.com/soundid-reference/pricing

---

### 9. FLUX MiRA (new entrant, Jan 2025)

**URL**: https://www.flux.audio/project/mira/  
**Price**: Subscription/perpetual (TBD; free updates for existing FLUX license holders)  
**Unique angle**: Most technically advanced multi-channel analyzer; first immersive audio analyzer supporting 24 channels; AI Auto-EQ scope; targets broadcast, live, and studio

**Key features not in RTMcompare**:
- Nebula Spatial Spectrogram: combines spectrum with vectorscope — shows spatial distribution by frequency
- Transfer Function Analysis: system tuning with up to 23 microphones (live/room)
- Impulse Response measurement and delay computation
- Phase and coherence traces
- AI-Powered Auto EQ Scope (v26.04): automatically generates EQ curve from target
- FLUX Sample Push: network audio extraction from DAWs (no hardware insert needed)
- PLR and PSR metrics
- 24-channel support for NHK 22.2, Auro3D, Dolby Atmos
- Head/floor microphone pairing (patent-pending)
- 32/64-bit floating point up to 384 kHz

**RTMcompare gaps vs MiRA**: Nebula spatial spectrogram, transfer function analysis, AI Auto-EQ suggestion, network audio push  
**MiRA gaps vs RTMcompare**: No streaming preview, no codec simulation, no A/B mastering workflow, no engineer profiles, no QC detection, no ear training  
**Sources**: https://www.flux.audio/project/mira/ | https://www.flux.audio/2025/01/23/flux-expands-audio-analysis-capabilities-with-the-new-mira-family-of-analyzer-software/

---

### 10. LANDR / eMastered — AI Mastering

**URL**: https://www.landr.com / https://emastered.com  
**Price**: LANDR subscription from ~$20/mo; eMastered subscription ~$9/mo  
**Unique angle**: Fully automated AI master delivered in seconds; targets bedroom producers, not professional mastering engineers

**Key features not in RTMcompare**:
- Three distinct AI masters generated per upload (different "interpretations")
- Genre detection feeding mastering decisions
- AI controls: 3-band EQ, Presence, De-Esser, Stereo Field, Dynamics, Saturation
- Gain Match and Bypass for before/after comparison
- Distribution integration (LANDR also distributes to streaming)
- eMastered: focuses on a single AI master with reference-matching option

**RTMcompare gaps vs LANDR**: AI-generated master (but this is a different product category entirely — processing vs. analysis)  
**LANDR gaps vs RTMcompare**: No QC artifact detection, no manual control for engineers, no loudness compliance panels, no codec sim, no engineer profiles, no Atmos — targeting a different user entirely  
**Sources**: https://www.landr.com/online-audio-mastering | https://musosoup.com/blog/emastered-vs-landr-ai-mastering-comparison

---

## PART 2 — ACADEMIC PAPERS: TOP 5 TO IMPLEMENT NOW

### Paper #1 — IMPLEMENT IMMEDIATELY: ArtifactNet Codec Artifact Detection
**Title**: "ArtifactNet: Detecting AI-Generated Music via Forensic Residual Physics"  
**URL**: https://arxiv.org/abs/2604.16254  
**Published**: April 2026 (arXiv)  
**Relevance**: DIRECT — maps to RTMcompare's generation-loss detection feature

**What it does**: Uses a bounded-mask UNet (3.6M params) to extract codec residuals from magnitude spectrograms, then decomposes via HPSS into 7-channel forensic features. Achieves F1=0.9829 with FPR=1.49%. Key breakthrough: "codec-aware training" with 4-way codec augmentation (WAV/MP3/AAC/Opus) reduces cross-codec probability drift by 83%.

**RTMcompare application**: Replace or upgrade the current generation-loss detector. ArtifactNet's codec residual approach can distinguish between WAV/MP3/AAC/Opus encoding history, telling mastering engineers whether a file has already been lossy-encoded (critical for generation-loss QC). The HPSS decomposition into harmonic/percussive/residual channels gives fingerprint-like evidence of encoding history.

**Implementation effort**: Medium — model weights available on HuggingFace (amaai-lab/SonicMaster repo linked); Python backend integration with existing audio pipeline.

---

### Paper #2 — HIGH VALUE: SonicMaster All-in-One Mastering Analysis
**Title**: "SonicMaster: Towards Controllable All-in-One Music Restoration and Mastering"  
**URL**: https://arxiv.org/abs/2508.03448  
**Published**: August 2025 (arXiv)  
**Relevance**: HIGH — maps to click/distortion/hum detection AND opens door to automated QC scoring

**What it does**: First unified generative model handling 19 common audio degradations (reverb, EQ imbalance, clipping, dynamic-range errors, stereo artifacts, hum, noise, etc.) in a single generative pass. Conditioned on natural language text prompts OR operates in automatic detection mode. Trained on 175k audio pairs across 10 genres.

**RTMcompare application**: Two uses: (1) Use the detection backbone (the analysis, not the generation) to score severity of each degradation — feeds directly into RTMcompare's click/distortion/hum detection. SonicMaster's 19-degradation taxonomy is a superset of what RTMcompare currently detects. (2) "Automatic QC report" feature: run SonicMaster's detection head, return plain-English report of what's wrong — competitive differentiator over all current tools.

**Implementation effort**: Medium-High — requires integration with the flow-matching model; Python backend; GPU recommended. Dataset (175k pairs, Jamendo) is publicly available.

---

### Paper #3 — STRATEGIC: MMMOS Multi-Axis Audio Quality Assessment
**Title**: "MMMOS: Multi-domain Multi-axis Audio Quality Assessment"  
**URL**: https://arxiv.org/html/2507.04094v2  
**Published**: July 2025 (arXiv)  
**Relevance**: HIGH — replaces subjective MUSHRA with automated perceptual scoring

**What it does**: No-reference (no original needed) multi-domain audio quality assessment that produces four orthogonal quality scores: Production Quality, Production Complexity, Content Enjoyment, Content Usefulness. Fuses frame-level embeddings from WavLM, MuQ, and M2D pretrained encoders. Achieves 20–30% MSE reduction through ensembling.

**RTMcompare application**: "Perceptual Quality Score" — a single dashboard metric showing estimated professional listener quality rating for any uploaded master. This is something NO competitor ships. Engineers could compare their masters' perceptual quality scores against reference tracks or against each other. Works without a reference file (no-reference metric = critical advantage).

**Implementation effort**: Medium — pretrained encoders (WavLM, MuQ, M2D) are publicly available; ensemble head trains on top.

---

### Paper #4 — MEDIUM-TERM: Music Mixing Style Transfer via Contrastive Learning
**Title**: "Music Mixing Style Transfer: A Contrastive Learning Approach to Disentangle Audio Effects"  
**URL**: https://arxiv.org/abs/2211.02247  
**Also relevant**: "Combining audio control and style transfer using latent diffusion" (arXiv:2408.00196, Aug 2024)  
**Relevance**: MEDIUM — maps directly to RTMcompare's engineer profile matching feature

**What it does**: Extracts "audio effects fingerprint" from a reference track using contrastive learning. Learns to separate audio effects information from musical content — meaning you can take Engineer A's master and extract "what EQ/compression/stereo decisions they made" as a transferable vector, independent of the song itself.

**RTMcompare application**: Upgrade the engineer profile matching from "compare tonal balance curves" to "extract actual effect processing fingerprint." Users could upload a reference master by Engineer X, and RTMcompare would show: "Engineer X tends toward: +2dB shelf at 12kHz, slow attack compression, wide mid-side processing." This is far beyond what REFERENCE 3's Mix Descriptors or any competitor does.

**Implementation effort**: High — but the 2022 paper has public code; the 2024 latent diffusion extension is newer but builds on top of Stable Audio / AudioLDM2.

---

### Paper #5 — NEAR-TERM QUICK WIN: HAAQI-Net Non-Intrusive Music Quality Assessment
**Title**: "HAAQI-Net: A Non-intrusive Neural Music Audio Quality Assessment Model for Hearing Aids"  
**URL**: https://arxiv.org/abs/2401.01145  
**Published**: January 2024 (arXiv)  
**Relevance**: MEDIUM — novel non-intrusive quality metric applicable to mastering QC

**What it does**: Predicts perceived audio quality without needing the original (non-intrusive). Uses BiLSTM with attention mechanisms on BEATs model features. Originally designed for hearing aids but the architecture generalizes to mastering — predicts a perceptual quality score for any audio file.

**RTMcompare application**: Fast quality pre-screening. Before a mastering session, run HAAQI-Net to flag: "This mix has perceptual quality issues in these frequency bands." Pairs with the SonicMaster degradation taxonomy for a full QC pipeline. Particularly useful for RTMcompare's student/teacher mode: show learners an objective quality score for their work.

**Implementation effort**: Low — BLSTM + BEATs is lightweight; BEATs pretrained model publicly available from Microsoft.

---

### Additional Academic Context

**Loudness Normalization Research**: AES paper "Speech Loudness in Broadcasting and Streaming" (AES 156th Convention, Madrid, June 2024 — arXiv:2405.17364) proposes DNNs to isolate speech signals for more precise speech-loudness measurement. Maps to RTMcompare's post-production Dolby Atmos QC use case.

**MUSHRA Modernization**: "Rethinking MUSHRA" (arXiv:2411.12719) proposes MUSHRA-1S (single-stimulus variant) for more scalable perceptual testing. Directly applicable to RTMcompare's ear training module — use MUSHRA-1S methodology to build scientifically-validated ear training exercises.

**True Peak / Intersample**: AES TD1008.1.21-9 (supersedes TD1004) is the current AES standard on loudness for streaming. RTMcompare should implement its recommendations precisely for credibility in professional markets.

---

## PART 3 — MARKET GAPS

### Single Biggest Market Gap: Real-Time Codec Audition + Penalty Side-by-Side

Across Gearspace, Reddit, and professional forums, the most requested unshipped feature is:
**"Let me HEAR what Spotify/Apple/YouTube will actually do to my master, not just see a number."**

Loudness Penalty shows a dB penalty number. MasterCheck does codec simulation but only one platform at a time with no A/B against your original in the same interface. RTMcompare's streaming platform preview is positioned to be first to combine:
1. Real codec encode/decode audition (like MasterCheck)
2. Multi-platform penalty display (like Loudness Penalty)
3. True A/B against your original master (RTMcompare's core)

No tool does all three simultaneously. This is the gap.

---

### "First Mover" Opportunities — No Competitor Has Shipped These

**1. Perceptual Quality Score (no-reference)**
No competitor shows a single "this master sounds like X quality to a listener" score. MMMOS paper makes this buildable. RTMcompare could show "Perceptual Quality: 87/100" alongside LUFS and TP. Patent-defensible framing.

**2. Generation-Loss History Detection**
ArtifactNet can detect whether a file was previously MP3/AAC encoded before arriving as WAV. "This file shows codec artifacts consistent with prior 128kbps MP3 encoding." No tool on the market does this. Mastering engineers regularly receive pre-compressed files from clients who don't know better.

**3. Plain-English QC Report**
SonicMaster's 19-degradation taxonomy + text output means RTMcompare could generate: "Your master has: moderate hum at 60Hz, borderline clipping in the 4–8kHz range, stereo image narrowing above 12kHz." REFERENCE 3 does this for tonal balance only (Mix Instructor). RTMcompare could do it for technical QC issues — entirely different and complementary.

**4. Engineer Fingerprint via Effects Disentanglement**
Current "engineer profile matching" compares tonal curves. The contrastive learning approach (Paper #4) extracts actual processing fingerprints — compression behavior, saturation character, stereo decisions — as a vector independent of song content. "This master matches Tchad Blake's processing fingerprint at 78% confidence." Zero competitors near this.

**5. Education + Certification Integration**
RTMcompare is the ONLY tool with ear training and student/teacher mode. No competitor targets audio schools. AES, Berklee, SAE Institute all lack a dedicated QC/analysis learning platform. This is an untapped B2B vertical — license to schools as "RTMcompare Edu."

**6. Mastering Session History Timeline**
Nugen VisLM has 24-hour ReMEM for broadcast. No tool has "mastering session compare history" — version A vs version B vs version C of the master over the course of a session. Engineers currently bounce stems with date-stamped filenames. RTMcompare could auto-capture session snapshots and build a timeline.

---

### What Users Beg for (Cross-Forum Synthesis)

From Gearspace + KVR Audio + Production Expert discussions:

1. **"Tell me the loudest section by timestamp"** — "Quickly analyze tracks and tell me, based on LUFS, the loudest section is from xx:xx to yy:yy seconds." (Gearspace — explicitly requested, no tool does it automatically in plain UI)

2. **"One tool that does it all"** — Engineers use VisLM for broadcast compliance, MasterCheck for codec preview, Loudness Penalty for platform penalty, Insight 2 for visual analysis. "I'm tired of switching tools." RTMcompare's consolidation play is exactly right.

3. **"Consistent readings across tools"** — MiRA reads 2–2.5 LUFS lower than other meters. Users frustrated by disagreement between tools. "Which one is right?" RTMcompare could include a "Standards Compliance Verification" mode showing readings vs. the AES TD1008 reference spec.

4. **"Offline/batch mode"** — Engineers with 10–15 song albums want to run all tracks through QC overnight. Only VisLM and Insight 2 (via AudioSuite) offer this. RTMcompare's Electron app could ship batch mode as a strong differentiator.

5. **"Leq(m) for TV placement"** — Music supervisors and sync licensing engineers need Leq(m). Only VisLM and WLM Plus offer it. A huge, underserved sync/licensing market.

---

### Where Competitors Are Building Toward

**iZotope**: Made Insight 2 free, likely clearing the deck for Insight 3 with deeper Ozone/RX integration. Watch for: AI-powered spectrogram annotation ("this spike is distortion from your limiter").

**Nugen Audio**: Consistently adding immersive channel counts (now at 7.1.4). Watch for: expanding MasterCheck's platform list and adding more codec types (Opus/WebM for YouTube).

**FLUX MiRA**: The new entrant with the most aggressive roadmap. AI Auto-EQ (v26.04) is just the start — likely building toward real-time analysis suggestions. Their 24-channel immersive support and network audio push (FLUX Sample Push) targets studio facilities. Watch for: integration with SPAT Revolution for immersive production workflows.

**Mastering The Mix (REFERENCE 3)**: Mix Instructor plain-English guidance is clearly their moat. Watch for: an AI that suggests which specific plugin/processing to use, not just which frequency to adjust. Also: a SoundID-like monitoring correction add-on.

**Sonarworks**: Adding more virtual monitoring environments (they already have car stereo, consumer earbuds, hi-fi). Watch for: Atmos-specific binaural translation environments.

**Sonible**: smart:EQ 4 + smart:comp 3 form a growing AI processing suite. They're building toward a full-session AI mastering chain. Not a direct competitor to RTMcompare (they're processing tools), but their AI genre/style analysis could converge.

---

## Feature Gap Prioritization for RTMcompare Roadmap

### Tier 1 — Implement in next 3 months (fills critical gaps, no competitor has):
1. **Loudest-section timestamp finder** — "Peak LUFS: 1:23–1:47" — 5-day build, huge user request
2. **Batch/offline analysis mode** — Analyze full albums overnight — 2-week build
3. **ArtifactNet generation-loss upgrade** — Use codec residual fingerprint to detect encoding history — 3-week build
4. **Multi-platform penalty grid** — Show Spotify/Apple/YouTube/Tidal penalties simultaneously alongside RTMcompare's audio preview — 2-week build

### Tier 2 — Implement in 3–9 months (strong differentiation):
5. **Perceptual Quality Score (MMMOS)** — No-reference quality metric — 4-week build
6. **Plain-English QC Report** — SonicMaster degradation taxonomy → text output — 6-week build
7. **Leq(m) meter** — Required for sync/broadcast market — 1-week build (well-specified standard)
8. **PSR/PLR display** — Alongside existing LUFS/TP/LRA — 3-day build

### Tier 3 — 9–18 months (moonshots, major moats):
9. **Engineer Effects Fingerprint** — Contrastive learning extraction of processing style — 3-month R&D
10. **RTMcompare Edu** — B2B school licensing with LMS integration — business development track

---

## Sources

- iZotope Insight 2 features: https://www.izotope.com/en/products/insight/features
- iZotope Insight 2 loudness/TP: https://www.izotope.com/en/products/insight/features/loudness-and-true-peak-metering
- iZotope free promo: https://www.gearnews.com/izotope-insight-2-freeware/
- Nugen VisLM: https://nugenaudio.com/vislm/
- Nugen MasterCheck: https://nugenaudio.com/mastercheck/
- TC LM6 features: https://service.tcgroup.tc/lm6-features.asp
- TC LM6 ProSoundWeb: https://www.prosoundweb.com/tc-electronic-introduces-lm6-radar-loudness-meter-as-cross-platform-native-plug-in/
- Waves WLM Plus: https://www.waves.com/plugins/wlm-loudness-meter
- Loudness Penalty: http://www.loudnesspenalty.com/
- Mastering The Mix REFERENCE 3: https://www.masteringthemix.com/products/reference
- REFERENCE 3 Bedroom Producers Blog: https://bedroomproducersblog.com/2026/04/07/mastering-the-mix-reference-3/
- Sonarworks SoundID Reference: https://www.sonarworks.com/soundid-reference
- FLUX MiRA: https://www.flux.audio/project/mira/
- FLUX MiRA launch: https://www.flux.audio/2025/01/23/flux-expands-audio-analysis-capabilities-with-the-new-mira-family-of-analyzer-software/
- LANDR features: https://www.landr.com/online-audio-mastering
- LANDR vs eMastered: https://musosoup.com/blog/emastered-vs-landr-ai-mastering-comparison
- ArtifactNet paper: https://arxiv.org/abs/2604.16254
- SonicMaster paper: https://arxiv.org/abs/2508.03448
- MMMOS paper: https://arxiv.org/html/2507.04094v2
- Music Mixing Style Transfer: https://arxiv.org/abs/2211.02247
- Audio control + style transfer (latent diffusion): https://arxiv.org/abs/2408.00196
- HAAQI-Net paper: https://arxiv.org/abs/2401.01145
- Rethinking MUSHRA: https://arxiv.org/html/2411.12719v3
- AES TD1008 loudness streaming standard: https://www.aes.org/technical/documentDownloads.cfm?docID=731
- AES speech loudness streaming paper: https://arxiv.org/pdf/2405.17364
- Gearspace metering plugin trust: https://gearspace.com/board/mastering-forum/1442855-most-industry-trusted-metering-plugin.html
- Spotify loudness normalization: https://support.spotify.com/us/artists/article/loudness-normalization/
- Sonible smart:EQ 4: https://www.sonible.com/smarteq4/
