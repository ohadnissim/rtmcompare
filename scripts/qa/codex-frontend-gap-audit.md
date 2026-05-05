# Codex consult — Frontend ↔ Backend gap audit + Advanced QC failure mode + playback-env feature ideas

Beta tester just reported: *"advanced QC does nothing currently in compare mode. I feel like there's things in the backend that are not in the frontend."* They also asked specifically about a **car-speakers playback-environment simulation** as an example of the kind of feature they expect.

Three goals, all focused:

## 1. Find every analyzer-output field that is NOT surfaced in any UI panel

The Python analyzer (`python/analyze.py`, `python/comparator.py`, `python/reference_quickscan.py`, `python/batch_analyze.py`) writes a wide set of fields to the result JSON. The renderer (`src/components/AnalysisView.tsx`, `RefOnlyView.tsx`, `BatchView.tsx`, `SongDetailPanel.tsx`, `MasteringDelta.tsx`, `MasterAssistantPanel.tsx`) consumes only some of them.

For each field written to `result` in any analyzer entrypoint, decide:
- **Rendered**: which component / which conditional gate
- **Partially rendered**: a subset of the data is shown, but useful sub-fields are dropped
- **Hidden in fast mode**: rendered only when the data is populated, which only happens in Deep Scan
- **Backend-only**: computed but never read by the renderer

Output as a table. file:line for each field's write site and (where rendered) its read site.

## 2. Diagnose Advanced QC's "does nothing" symptom in compare mode

Beta tester is in two-file compare mode, toggles **Advanced QC** in the header (`src/App.tsx:843` area), expects new panels to appear, sees nothing change.

Check:
- Is the toggle actually flipping the `advancedQc` value in `ModesContext` round-trip? (`src/ModesContext.tsx:101-118`, `:166-175`)
- The `(advancedQc || ...)` gates in `AnalysisView.tsx:879` (Tonal Issues), `:834,847,858` (Waveform Diff / Transient Density / Masking), `:1154,1223` (Mono Compat), `:1251` (Phase Bands), `:1326` (Tempo Drift) — which of those data fields are even populated in fast mode for two-file compare?
- The "Advanced QC needs Deep Scan" banner I added at the top of AnalysisView (~line 380) — does its trigger condition fire when a tester is in fast mode? Walk through it.
- BatchView consumes `advancedQc` how? Codex earlier flagged it doesn't.

Output: for each Advanced QC panel, ONE of:
- "shows in fast compare mode"
- "shows only in deep compare mode"
- "data field never populated in compare mode at all" (backend gap — file:line where it'd be computed)
- "data field populated but renderer gate prevents render"

Then: ONE recommended UI fix to make Advanced QC feel meaningful in fast compare mode (without forcing every fast scan to also do deep work). Examples: re-classify which panels can show in fast mode, change the banner copy, add a "Run Deep Scan now" button inline.

## 3. Playback-environment simulation feature recommendations

The user asked specifically about *"car simulation and such"* — meaning: simulate playback through different speaker systems / listening environments. We do NOT have this today. We DO have:
- Per-platform streaming-normalization preview (Sound Check twin renders through afconvert + each DSP's TP limiter chain)
- Mono compatibility (a partial proxy for phone speakers / Bluetooth)
- AAC codec audition

Propose **2-4 new playback-environment simulations** that:
- Are technically buildable on top of our existing Python audio chain (we have torch, librosa, scipy, numpy, soundfile)
- Deliver evidence engineers can act on (not just *"sounds different"*)
- Are differentiated from existing tools (Reference 4, LEVELS, Insight)

For each:
- The acoustic transformation: filter chain / EQ curve / convolution / normalization to apply (sketch the impulse response or filter graph)
- Source for the IR / curve / data (publicly available datasets or measurable references)
- The deliverable: streamed audition? rendered .m4a like the Sound Check twin? a Streaming Delta–style heatmap of where the simulated environment masks content?
- Engineer-facing insight ("at car-speaker low end, your sub disappears below 70 Hz")
- Effort estimate

Candidates to consider (pick the strongest 2-4 — don't list everything):
- Car cabin (consumer car ~3-way speaker, road-noise LP filter, moderate cabin reverb, maybe IR from a real cabin measurement)
- AirPods / consumer earbuds (HRTF-light, midrange-forward EQ, no sub <80 Hz)
- Phone speaker (3.5–4 kHz tilt, severe low-cut at ~250 Hz)
- Cheap laptop speaker (similar, with extra distortion at high SPL)
- Club PA (subwoofer-emphasized, peaking around 80 Hz, mono-summed below 100 Hz)
- Radio / FM mastering chain (multiband compression + 8 kHz LP)
- Apple AirPlay / Sonos compressed bus

Be specific and honest. Some of these are more useful than others for the audience (mixing engineers + mastering engineers + label QC).

## Output format

Three sections:

### BACKEND-ONLY FIELDS (Section 1 output)
Table: field name | written at file:line | render status | recommended action

### ADVANCED QC DIAGNOSIS (Section 2 output)
Per-panel table + ONE recommended fix.

### PLAYBACK-ENV SIMS (Section 3 output)
2-4 ranked proposals. Each ~80-150 words.

## Constraints

- Be specific. file:line for every claim about source.
- You may run shell commands. Use them — grep the code, run the analyzer once, dump a result JSON, diff it against what the renderer reads.
- Honest > flattering. If "car simulation" is a marketing vanity feature that won't help engineers, say so.
- Under ~2000 words.
