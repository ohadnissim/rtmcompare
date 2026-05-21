# authio (Forward Digital) — Competitor Profile

**URL**: https://authio.io/
**Generated**: 2026-05-17
**Depth**: Deep profile

---

## At a Glance

| Metric | Value |
|--------|-------|
| Tagline | "AI Music Detector — Detect AI Generated Music with 99.42% Accuracy" |
| Founded | ~2024 (Forward Digital SAS); authio product ~early 2025 |
| Headquarters | France (EU-native, GDPR compliant) |
| Team size | ~10-20 (small startup) |
| Funding | Bootstrap/early-stage (no public funding rounds found) |
| Accuracy claimed | 99.42% (false positive rate <0.6%) |
| Detection speed | Under 5 seconds per track |
| Generators covered | 9 platforms |
| Pricing | From €12/month (most transparent pricing in market) |

---

## Positioning & Messaging

**Primary value proposition**: "12-model ensemble architecture, 99.42% accuracy, transparent pricing from €12/month — the most honest AI music detector in the market."

**Target audience**: Music distributors, DSPs, labels, collecting societies, compliance teams

**Positioning angle**: Transparency-first — only competitor with full published pricing + published accuracy + open API documentation

**Key messaging themes**:
- Published accuracy with methodology explanation (12-model ensemble with meta-classifier) — authio.io/technology
- Transparent pricing tiers (€12 to €9,999/month) — authio.io pricing
- "Platform attribution gives your legal and compliance teams the evidence chain they need" — authio.io/solutions
- EU-native, GDPR compliant
- "Auditable detection logs" mentioned in enterprise tier

---

## Product & Features

### Core capabilities
- 12-model ensemble: 12 specialized neural networks, each trained on different generator signatures, combined via weighted voting meta-classifier
- Platform attribution: identifies which of 9 generators created content
- JSON structured reports with confidence scores (0.0–1.0 scale) + platform attribution
- REST API with Python, Node.js, and Java SDKs
- Batch processing (up to 250K tracks/month at Enterprise, up to 1,000 req/min)
- Auditable detection logs (Enterprise tier)
- GDPR compliant — no audio retention
- 14-day free trial (20 analyses)
- Free in-browser checker (5/day, no signup)

### Supported generators (9 platforms)
1. Suno
2. Udio
3. MusicGen
4. ElevenLabs
5. Stable Audio
6. Riffusion
7. Mureka
8. (2 more unspecified in public materials)

### Notable differentiators
- Only competitor with fully published pricing tiers (€12–€9,999/month)
- Most transparent published accuracy methodology (12-model ensemble explained)
- "Evidence chain" language in solutions page — signals compliance/legal use case awareness
- Lowest-cost entry point in market (€12/month Starter)
- GDPR-compliant no-audio-retention policy published

### What it does NOT do (gaps)
- No per-stem analysis (full track binary only)
- No certificate generation or formal legally defensible audit trail product
- No desktop app
- Auditable detection logs only at Enterprise tier (€2,399/month)
- Small team — durability risk vs. Deezer/ACRCloud/IRCAM
- No named enterprise customers published
- Confidence scoring ≠ a verifiable certificate

---

## Pricing

| Tier | Monthly Cost | Monthly Tracks | Batch Speed | Support |
|------|-------------|----------------|-------------|---------|
| Starter | €12 | 200 | 10 req/min | 48h |
| Professional | €63 | 2,000 | 60 req/min | 24h |
| Business | €639 | 50,000 | 200 req/min | Dedicated manager |
| Enterprise | €2,399 | 250,000 | 500 req/min | 99.9% SLA |
| Custom | €9,999+ | Unlimited | 1,000 req/min | <2h priority |

**Overage**: €0.008–€0.08 per extra track depending on tier
**Free trial**: 14 days, 20 analyses, no credit card

This is the most transparent and developer-friendly pricing in the market.

---

## Customers & Social Proof

**Named customers**: None published
**Social proof**: 99.42% accuracy claim + 12-model methodology explanation
**Comparison pages**: Publishes head-to-head vs. ACRCloud — signals market awareness

---

## Strengths & Weaknesses

### Strengths
- Most pricing-transparent competitor — removes sales friction for SMB distributors
- Published methodology makes accuracy claims verifiable/auditable
- Lowest entry price (€12/month) creates developer community and word-of-mouth
- EU-native GDPR compliance published
- "Evidence chain" awareness in solutions copy
- Fast processing (under 5 seconds per track)

### Weaknesses
- No per-stem analysis — biggest technical gap vs. UAI
- No certificate generation
- Small team — longevity risk for enterprise contracts
- No named customers — hard to sell to risk-averse enterprises
- No desktop app
- 0.6% false positive rate could be problematic at distributor scale (e.g., 60,000 tracks/day = 360 false positives daily)

---

## Competitive Implications for UAI

**Where authio is strong vs. UAI**: Pricing transparency, developer-friendliness, accessible entry point, GDPR compliance documentation

**Where UAI is strong vs. authio**:
- Per-stem analysis (4-stem BS-RoFormer) — authio has none
- Certificate generation for legally defensible evidence
- 24-detector ensemble vs. 12 (deeper coverage)
- Patent-pending status
- Desktop app for non-technical users
- Named generators: Boomy, Lyria, AI ACAP (authio doesn't cover these)
- False positive rate: UAI's calibrated head vs. authio's 0.6% FP rate

**Opportunities**: authio is showing distributors that transparent pricing works — UAI should publish competitive pricing and match their developer experience. Compete on depth (per-stem) not just accuracy numbers.

**Threats**: authio's low price point (€12/month) could become the default for small distributors, and once integrated, they don't upgrade to more expensive solutions unless there's a compelling reason.

---

## Raw Data Sources

- authio.io homepage scraped: 2026-05-17
- authio.io/solutions scraped: 2026-05-17
- authio.io/technology scraped: 2026-05-17
- fwdmusic.com comparison article: 2026-05-17
