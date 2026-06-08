# Launch Audit 01 — Positioning Basics (RTM Suite)

**Lens:** positioning-basics (WHO / WHAT / HOW / WHY / SO-WHAT). Real competitors, no vague claims, "could a stranger repeat it back?"
**Date:** 2026-06-08
**Scope:** Delivery-readiness verdict, positioning division only. I do NOT re-list the three technical audits' bugs — I add the net-new positioning judgment they cannot supply.

---

## TL;DR division verdict contribution

**The single most dangerous fact in this whole package is a positioning fact, not a DSP fact:** RTMcompare's entire promise — its one defensible reason to exist — is **"know exactly what changed, and trust the number."** That is the positioning. AUDIT 1's ship-blocker (AAC ISP verdict on a mono downmix → certifies a clipping master as PASS, `encoded_preview.py:246/255/290/297`) and AUDIT 2's sentinel-as-real-number bug (`-70.0 LUFS` rendered as a confident reading and acted on, `AnalysisView.tsx:2120`) are not "bugs that hurt a feature." **They detonate the positioning itself.** A trust meter that emits a confident wrong PASS has negative value vs. the status quo — worse than no tool, because the engineer stops double-checking.

So my contribution to the board's ship/no-ship vote is: **NO-SHIP as a paid "delivery-certification" or "pass/fail" product until AUDIT 1 #1 and AUDIT 2's sentinel/ViSQOL-mode bugs are fixed.** But — and this is the positioning insight — **the product is shippable TODAY under a narrower, honest position that the current README does not claim.** The fix is partly code and partly *words*.

---

## Positioning Statement (what it should be — corrected)

> For **mastering & mix engineers and small label/distro QC leads** doing **final pre-delivery checks on a release**,
> **RTMcompare** is a **local-first mastering measurement & A/B comparison workbench**
> that **shows exactly what changed between two masters and how each will behave on every streaming platform — without uploading a single file.**
> Unlike **iZotope Insight 2, Nugen MasterCheck/VisLM, Youlean Loudness Meter, and the LANDR/CloudBounce auto-master tools**,
> we are **a neutral, on-device grader that never re-masters your audio and never sends it to the cloud** — and we three-way-reconcile your distributor manifest, which none of them touch.

### One-liner (<=10 words)
**The on-device mastering meter that reconciles your whole delivery.**

### Elevator pitch (~75 words)
RTMcompare is a desktop workbench for the last mile before a release ships. Drop two masters and it level-matches and tells you exactly what changed — LUFS, true peak, LRA, per-band, phase, stereo image — then previews how each will sound after Spotify/Apple/Amazon normalization. Drop a folder and the distributor's CSV and it catches the metadata drift that makes Apple cancel a delivery. Everything runs on your machine. Nothing touches the cloud. It measures; it never re-masters.

---

## Named alternatives it is positioned against (REAL names)

These are RTMcompare's competitors — NOT the UAI competitor set in `competitor-profiles/` (that whole folder is AI-detection rivals — Deezer, IRCAM, ACRCloud, authio — and is mislabeled as relevant here; **net-new finding: the suite has no RTMcompare-specific competitive file at all**, a positioning gap in its own right).

| | RTMcompare | iZotope Insight 2 / RX | Nugen MasterCheck Pro / VisLM | Youlean Loudness Meter | LANDR / CloudBounce / RoEx |
|---|---|---|---|---|---|
| **Best for** | Pre-delivery QC + A/B + manifest reconcile, on-device | Real-time metering inside a session | Codec/loudness preview per-platform | Free/cheap loudness compliance | One-click auto-mastering |
| **Approach** | Offline file-pair grader + delivery reconciler | Insert plugin, live meters | Insert plugin, encoder preview | Insert plugin | Generative cloud re-master |
| **Tradeoff** | Not real-time/in-session; correctness must be perfect | No A/B-delta or manifest reconcile; not a "what changed" tool | Narrower (loudness/codec only) | Loudness only, no spectral/delta | Cloud, changes your audio, not neutral |
| **They win when** | engineer wants live in-DAW meters | engineer lives in the session, not files | only needs platform loudness check | budget = $0 | customer wants the work done FOR them |

**The sweet spot RTMcompare actually owns:** *file-pair "what changed + is it deliverable" + manifest reconciliation, fully offline.* Insight/Nugen/Youlean are in-session live meters — they do not diff two finished files or read a DDEX ERN. LANDR/RoEx are structurally disqualified from this position: a generative re-masterer **cannot credibly grade neutrality** (AUDIT 2's moat point is correct, and it is a *positioning* moat, not just a tech one).

---

## Self-critique — where the positioning is still fuzzy or undifferentiated (net-new)

1. **The README over-claims into the exact zone the audits say is broken.** README line 3 leads with *"Delivery Manifest Reconciler"* and the body sells *"Apple Digital Masters pass/fail,"* *"Ready-to-Deliver verdict,"* *"Ship-Ready PDF."* Every one of those words is a **certification claim**. AUDIT 1 #1 + AUDIT 2 sentinels mean the product cannot honestly make a binary pass/fail claim yet. **Positioning is writing checks the engine can't cash.** This is the highest-leverage fix and it is free: until the trust-foundation sprint lands, **demote every "pass/fail / Ready-to-Deliver / certified" word to "measurement / flag / review"** and ship the *measurement* position, not the *certification* position. AUDIT 2's "tagged measurement {value,valid,reason,provenance}" is the engineering expression of this same demotion — the words and the data model must move together.

2. **Two products, two stories, one risk of confusion.** RTM Audio also ships UAI (AI-music detection). The DECISIONS.md `$0.10/track` "signed JSON certificate covering AI-origin + LUFS/TP/LRA compliance" bundles them. **Do NOT cross-sell a compliance certificate until the LUFS/TP/LRA side can be trusted** — pairing a shaky meter with the EU-AI-Act halo doubles the liability. The certification-layer pivot (AUDIT 2 moonshot "RTM Verify") is the *right long-term position*, but it is the position you earn AFTER the trust sprint, not the launch position. Shipping the pivot now would brand the company's most strategic future product on top of a known-wrong PASS.

3. **The differentiator must be the one a competitor can't say.** "Mastering-grade measurement" — Insight/Nugen/Youlean all say it. The two claims they *cannot* say: **(a) "fully on-device, your audio never leaves the machine"** (Insight is plugin/local too, but LANDR/RoEx/cloud tools cannot; lead with it against the auto-master crowd that's eating mindshare), and **(b) "diffs two finished masters AND reconciles the distributor's manifest in one pass."** Lead with (b) — it is genuinely uncontested. README buries it.

4. **Version incoherence is a credibility leak.** README footer says `5.7.0`, `Compare.md` says `8.4.0`. A paying engineer who reads "trust my numbers" and sees the vendor can't keep its own version straight has a rational reason to distrust the meters. Trivial, but on-brand-damaging for a trust product.

5. **The dinner-party test passes; the differentiation test is conditional.** A stranger *can* repeat "it's the offline tool that checks your master before release and catches delivery errors." Good. But "trustworthy meter" is only credible once AUDIT 3's pre-ship gate (>=95% specificity on benign EQ, >=90% sensitivity on real artifacts) is *passed and publishable*. **Until that gate result exists, the credibility leg of the positioning is unverified** — so the launch claim must be hedged to "measurement & comparison," reserving "trustworthy/certified" for when the number backs it.

---

## Answers to the four board questions (positioning lens only)

**(1) Shippable for PAID? Under what minimum bar?**
YES — but only as a **"mastering measurement & A/B comparison workbench"** (a *meter*), not as a **"delivery certification / pass-fail"** product. Minimum positioning bar: every binary verdict word demoted to a measurement/flag word until AUDIT 1 #1 + AUDIT 2 sentinel/ViSQOL fixes land and AUDIT 3's accuracy gate is passed. The honest narrow position is sellable today; the certification position is not.

**(2) Sequence — MUST-fix vs disclose vs defer:**
- MUST-fix-pre-paid (because they break the positioning, not just a feature): AUDIT 1 #1 (mono-downmix ISP PASS), AUDIT 2 sentinel-as-real-number + ViSQOL-speech-mode. These three are the *positioning's* blockers.
- Disclose (positioning-honest, ship anyway): "4x TP factor," "hosted-plugin RT risk," "mel-L1 is a spectral-difference, not a quality score" (rename per AUDIT 1) — disclosure here is not just risk hygiene, it is *the differentiator made literal* ("we tell you what the meter can and can't see" = neutral-grader brand).
- Defer post-launch: MED/LOW DSP items, RTMprofile match-score (AUDIT 2: effectively constant — **do NOT sell "engineer match score" as a paid headline feature until fixed; remove it from launch positioning**).

**(3) GTM — ship the meter now, or hold for the cert-layer pivot?**
**Ship the narrowed meter now; hold the cert-layer ("RTM Verify") pivot for after the trust sprint.** The pivot is the correct destination and the real moat (neutral grader generative competitors structurally can't copy). But branding the company's flagship compliance/EU-AI-Act play on top of a meter with a known wrong-PASS is the fastest way to burn the exact trust the pivot needs to sell. Earn the certification position; don't claim it.

**(4) Single biggest risk to the company if we ship as-is:**
**A paying mastering engineer trusts a green "Apple Digital Masters PASS," ships a hard-panned clipping master, it gets rejected (or worse, published clipped) — and they post the screenshot.** For a product whose ENTIRE positioning is "trust the number," one public false-PASS is an extinction-level brand event: it doesn't dent a feature, it refutes the thesis. The downside is asymmetric and permanent in a word-of-mouth pro-audio market. This is why the positioning fix and the AUDIT 1 fix are the *same* decision.

---

## Recommended next steps
- Run `homepage-audit` / `obviously-awesome` once the trust sprint lands, to re-test claim-vs-capability.
- Create the missing RTMcompare-specific competitive file (Insight/Nugen/Youlean/LANDR), distinct from the UAI set in `competitor-profiles/`.
- Reconcile the version string before any public copy ships.
