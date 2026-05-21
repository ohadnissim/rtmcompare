# IRCAM Amplify (AI Music Detector) — Competitor Profile

**URL**: https://www.ircamamplify.com/products/ai-music-detector
**Generated**: 2026-05-17
**Depth**: Deep profile

---

## At a Glance

| Metric | Value |
|--------|-------|
| Tagline | "The world's most accurate solution to detect AI-generated music" |
| Founded | IRCAM founded 1977; IRCAM Amplify spinout ~2020 |
| Headquarters | Paris, France |
| Team size | ~30 (IRCAM Amplify spinout, backed by IRCAM research institute) |
| Funding | IRCAM is French state-funded research institute; Amplify is commercialization arm |
| Accuracy claimed | 99% (less than 1% false positives) |
| Batch throughput | 250,000 tracks/hour |
| API access | Request required (no self-service) |

---

## Positioning & Messaging

**Primary value proposition**: "Trusted third-party safeguard solution — establishing the global standard for transparency in the age of AI music. 99% accuracy, 250K tracks/hour, REST API."

**Target audience**: DSPs, music distributors, record labels, CMOs/PROs, music publishers

**Positioning angle**: Academic/research credibility (IRCAM is to audio research what MIT is to tech) + enterprise batch scale

**Key messaging themes**:
- "World's most accurate" claim — ircamamplify.com product page
- Third-party independence / safeguard framing — positions as neutral auditor
- Batch throughput leadership (250K/hour) — targets catalog-scale audit use case
- "Global standard" aspiration language

---

## Product & Features

### Core capabilities
- AI-generated music detection via RESTful API and SDK
- Covers Suno, Udio, Sonauto, ElevenLabs + emerging models
- Batch processing: 250,000 tracks/hour (highest published figure in market)
- Continuous model updates for new AI generator coverage
- Enterprise SLA available
- GDPR compliant (France/EU)

### Technology basis
- Built on IRCAM's decades of audio analysis research (spectral modeling, perceptual audio coding)
- GitHub demo repo available: github.com/Ircam-Amplify/AI-MUSIC-DETECTOR
- RESTful API with SDK integration

### Notable differentiators
- Fastest published batch throughput (250K tracks/hour)
- Most credible academic pedigree in the space
- EU-native company — strong regulatory positioning for EU AI Act Article 50
- Open demo on GitHub signals developer-friendliness

### What it does NOT do (gaps)
- No per-stem analysis (full track only)
- No certificate generation or legally defensible audit trail product
- No self-service pricing — access by request only
- Claimed 99% accuracy is not independently benchmarked; independent tests show 97.6% (fwdmusic comparison)
- No generator-specific platform attribution in published docs
- No desktop app / UI for non-technical users
- No batch pricing transparency

---

## Pricing

| Tier | Price | Notes |
|------|-------|-------|
| Enterprise API | Not disclosed | Request access only |

- No published pricing tiers
- Access gated behind sales contact
- Likely per-track or per-batch enterprise pricing (not confirmed)

---

## Customers & Social Proof

**Named customers**: Not publicly disclosed
**Target segments**: DSPs, distributors, labels, CMOs, PROs, publishers
**Credibility basis**: IRCAM name recognition in professional audio community (sound designers, broadcast, research)

---

## Strengths & Weaknesses

### Strengths
- Highest published batch throughput in market (250K tracks/hour)
- Strongest academic credibility — IRCAM is the most respected audio research institution in Europe
- EU-native company with strong GDPR and EU AI Act compliance positioning
- GitHub demo signals openness vs. black-box competitors
- Continuous model updates promise (vs. static competitors)

### Weaknesses
- No pricing transparency — high friction for evaluation
- No per-stem analysis
- No certificate generation
- No desktop app / non-API UI
- Independent testing shows 97.6% accuracy vs. their 99% claim (fwdmusic 2026 comparison)
- No named customers — hard to validate at-scale performance
- Request-only access slows sales cycle

---

## Competitive Implications for UAI

**Where IRCAM is strong vs. UAI**: Academic pedigree, batch throughput claim, EU regulatory positioning, IRCAM brand in professional audio

**Where UAI is strong vs. IRCAM**:
- Per-stem analysis (4-stem BS-RoFormer) — no competitor has this
- Certificate generation for audit trails
- Published F1=0.998 on test set with named generators
- Desktop app for non-technical users
- Self-service API vs. request-only access
- 24-detector ensemble vs. IRCAM's single model

**Opportunities**: IRCAM's lack of per-stem analysis and certificates makes them vulnerable with collecting societies who need legal-grade outputs. Attack on "depth of analysis" rather than speed.

**Threats**: IRCAM's batch speed (250K/hour) could be compelling for large DSPs running catalog audits. If they add per-stem analysis, they become a serious full-spectrum threat.

---

## Raw Data Sources

- ircamamplify.com/products/ai-music-detector scraped: 2026-05-17
- fwdmusic.com/en/news/best-ai-music-detectors-2026 scraped: 2026-05-17
- imusician.pro IRCAM coverage: 2026-05-17
