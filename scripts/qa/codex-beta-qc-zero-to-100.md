# Codex prompt — BETA QC, zero to 100

You are the QA reviewer for RTM Suite v4.1.0 minutes after its first
beta install. The user has just run the freshly notarized dmg and
already surfaced **multiple runtime bugs that typecheck did not
catch**. Your job: audit the entire system end-to-end, surface every
issue a beta tester would hit, and rank them so we can fix them in a
single rebuild before re-notarizing.

Be unforgiving. Honest > flattering. Beta testers will not give us a
second chance if the app is unusable on first launch.

---

## What's shipped (so you don't re-derive it)

**4.1.0 macOS dmg** — signed (Developer ID Application: Ohad Nissim,
3RL52RHGT3), Apple-notarized (submission `eba09fca-cda5-4e58-bafb-ea750b74858d`),
stapled, Gatekeeper-accepted. Living at:
- `dist/RTM Suite-4.1.0-arm64.dmg`
- `release/RTM-Suite-4.1.dmg`

**Source state** (all in tree, all in the dmg):
- Stage 1 — FLOW removal (DeliveryManifestPanel, ReleaseCockpit, BWF writer stripped)
- Stage 2 — Spec validation pack (`python/specs.py`, `src/specs.ts`, `<SpecDriftBadge>`)
- Stage 3 — Per-stem AI detection (`ai_detection.stem_verdicts` array)
- Stage 4 — Mastering Delta tab (`<MasteringDelta>` + `_attach_mastering_delta` in `python/comparator.py`)
- BUGs 1–6 Python fixes (per-band gain mean-centring, ST/M LUFS `+1`, fast-mode `detect_ai`, `reference_quickscan` spec stamps, PLR-all-channels with silence guard, distortion TP-drift gate)
- BUG 7 cleanup (stale FLOW/DMR copy in `package.json`, `App.tsx`, `release/readme-print.html`)
- Sound Check twin afconvert fix (`python/encoded_preview.py:_resolve_aac_encoder`)
- Render ✕ error chip (`src/components/StreamingPreview.tsx`)
- App Translocation copy rewrite (`electron/python-bridge.ts`, compiled to `dist-electron/python-bridge.js`)

**Bundled Python** (macOS): `python-bundle/python/bin/python3` 3.11.15 arm64 — torch 2.11.0, librosa 0.11.0, demucs 4.0.1, numba 0.65.0, llvmlite 0.47.0, numpy 2.4.4, scipy 1.17.1, soundfile 0.13.1.

---

## Live bugs already reported by beta tester (start here)

### Bug L1 — Audio players stuck on "Preparing audio…"
- Symptom: every `<ABPlayer>` instance shows the literal string "Preparing audio…" forever after the analysis finishes. Play button does nothing.
- Tester's audio files live in **Dropbox** (e.g. `~/Library/CloudStorage/Dropbox-*/...` or `~/Dropbox/...`).
- Hypothesis: `electron/main.ts:15-29` `AUDIO_READ_ROOTS` allowlist excludes Dropbox paths. `assertSafeAudioPath` throws *"path outside allowed roots"*. `loadFiles()` catches → resets `isLoading=false`, never sets `isLoaded=true` → UI shows fallback "Preparing audio…" (`src/components/ABPlayer.tsx:1373-1377`).
- **Directive from the user**: *"we need to enable play audio from anywhere"* — relax the allowlist, but don't remove validation entirely (still want extension + existence + regular-file checks).
- Action for you: confirm the diagnosis, then audit *every* IPC handler in `electron/main.ts` that calls `assertSafeAudioPath` or `assertSafeDir` and propose a unified relaxation. Make sure analyzer-launch (`analyze-files`, `analyze-batch`, `master-chain-render`, `encoded-preview-render`, etc.) doesn't have its own duplicate guard.

### Bug L2 — Advanced QC not working
- Symptom: enabling Advanced QC mode (toggle from `src/ModesContext.tsx`) doesn't reveal the panels it should.
- Affected files: `src/ModesContext.tsx`, `src/App.tsx`, `src/components/AnalysisView.tsx`, `src/components/RefOnlyView.tsx`, `src/singleFileHelpers.ts`.
- Possibilities to check:
  - Per-surface override logic at `ModesContext.tsx:79-97` localStorage round-trips silently corrupting state.
  - A panel that's hard-gated by `isAdvanced` *and* a result field that's missing.
  - Toggle button wired to a stale callback after a refactor.
  - State leakage where Advanced QC is on but consumers read a different flag.
- **Reproduce yourself** by reading the toggle wiring end-to-end and identifying the break.

### Bug L3 — Mastering Delta "Perceived Loudness Gain by Platform" reads 0.0 on every platform
- Computed at `python/comparator.py:524-544` (`_attach_mastering_delta`).
- Tester loaded two real masters and saw 0.0 on Spotify / Apple / YouTube / Tidal / Amazon / Deezer / SoundCloud.
- Working hypothesis: math is correct (both files exceed every platform's target → all attenuated to target → delta 0). But user *expected* a non-zero number.
- Decide: is this **(a) a math bug** (e.g. `lufs_a == lufs_b` because of a wiring mistake upstream in `python/analyze.py:419-422`), or **(b) UX framing only** — and if UX, propose the fix (tooltip text, show A vs B columns, rename the metric, hide when all zero, etc.).

### Bug L4 — Add "Background Vocals" to "Pre-element breakdown"
- Feature request, not strictly a bug. But it should ship with the next dmg.
- Find the "pre-element breakdown" component (one of `src/components/AnalysisView.tsx`, `AnalysisTour.tsx`, or related). It currently lists kick/snare/bass/etc. — needs a `bg_vocal` (or `backing_vocal`) row.
- Trace where the element list comes from on the Python side (likely `python/element_breakdown.py` or similar). The bg-vocals stem may already be there from the demucs separation pipeline (`stem_verdicts` knows about `vocals`/`other`/etc.) but wouldn't include a separate "background vocals" classification — codify whether this is a UI label change, a DSP add, or both.

---

## Wider audit (zero-to-100, not driven by user reports)

### A. Renderer error-state coverage
- `<ABPlayer>` "Preparing audio…" stuck-state pattern is a **template** for similar bugs elsewhere. Find every component that has a "loading || loaded || error || empty" state machine and check that the *catch* path resets state visibly. Specifically:
  - Components whose `loadFiles`-shaped function is called in a `useEffect([])` mount-time hook.
  - Promise rejections that disappear into `console.error` only.
  - Buttons wired to async handlers without disabled / loading visual feedback.
- Output: list of components with silent-failure risk.

### B. IPC surface audit
- Read every `ipcMain.handle(...)` in `electron/main.ts`. For each:
  - Does it validate inputs? (paths, ids, sizes.)
  - Does it shell out / spawn Python with user-supplied data unescaped?
  - Does it return errors in a way the renderer surfaces, or does the renderer just see `null` / `undefined`?
- Output: handlers that need hardening or better error propagation.

### C. Python bundle integrity in the packed app
- `python-bundle/` was assembled ad-hoc on the prior build host (per the handoff: "DO NOT rebuild via pip install — won't match"). It's now baked into the asar / Resources of the installed app at `/Applications/RTM Suite.app/Contents/Resources/python-bundle/python/bin/python3`.
- Run a smoke test from the installed app: `import torch, librosa, demucs, numba, llvmlite, numpy, scipy, soundfile; print all .__version__`.
- Run the analyzer end-to-end on at least one of the deterministic synthetic test signals at `/tmp/rtm-qa-golden/` (regenerate via `python3 scripts/qa/regenerate_goldens.py` if `/tmp/rtm-qa-golden/` is empty).
- Output: any import failure, version surprise, or analyzer crash.

### D. Stage-by-stage smoke test
For each visible feature in the app, write a one-line "did it work?" assessment:
- Two-file compare (rough mix vs master)
- Single-file QC
- Album batch (deep + fast)
- Reference-only quickscan
- Mastering Delta tab (rendering, not just data)
- Spec drift badge (does it surface when result has stale spec_versions?)
- Sound Check twin (now afconvert-based — does it work on this machine without ffmpeg?)
- EQ exporter (the macOS-Logic-hint cosmetic issue from the Windows audit applies here too — does it work on this machine?)
- Atmos / broadcast surfaces
- Plugin (`rtm-send-plugin`) → app handoff via `~/.rtm`
- Onboarding tour (LabelTour was deleted — make sure the remaining tour flows still work)

### E. Performance + log noise
- Run the app fast-mode against `/tmp/rtm-qa-golden/`. Confirm stderr is still clean (the handoff §1 claimed 14/14 test files stderr-clean; verify on this machine).
- Note any new `RuntimeWarning` / `UserWarning` / `DeprecationWarning` lines that have crept in.

### F. Cosmetic but visible
- Logic-preset hints in `src/components/EQExportButton.tsx:283-285` and `src/eqExporters.ts:13-16` — show on Windows even though they're macOS-only. (Not blocking macOS beta.)
- `/tmp/rtm-debug.log` write at `electron/python-bridge.ts:142-145` — fails silently on Windows.
- Any panel that says "v4.0" instead of "v4.1" in user-visible copy.

---

## Output format

Three sections, in this order:

### BUGS
For each bug found:
- **Severity**: P0 (blocks app launch / unusable) / P1 (blocks core feature) / P2 (degrades feature) / P3 (cosmetic)
- **Symptom**: one sentence the user would say
- **Reproduction**: exact steps a tester would follow
- **Root cause**: file:line, why it fails
- **Fix direction**: a sentence or two — don't write the patch, just describe it
- **Confidence**: high / medium / low — and why

### TIGHTENING RECOMMENDATIONS
Code-quality / architectural improvements that aren't bugs but would prevent the next round of beta-tester surprises. Each one with file:line evidence and a why.

### FIX-PRIORITIES
A single ordered list (P0 first) of every BUG and every recommendation that should land in the next dmg before we re-notarize. Be ruthless about scope — if it's not actually shippable in this rebuild cycle, mark it deferred.

---

## Constraints

- Be specific. file:line. Cite the handoff `release/v4.0-rc2/SESSION-HANDOFF-2026-04-26.md` and `release/v4.0-rc2/qa-paranoid-scan-2.md` by §.
- No code changes — diagnosis only.
- You may run shell commands (sandbox is `danger-full-access`). Use them: launch the bundled Python, mount the dmg, etc.
- Under ~2000 words total in the final output.
