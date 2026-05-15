# RTMprofile — Console Didone Design Upgrade Log

**Date:** 2026-05-11
**Scope:** Full visual audit and upgrade to Console Didone v5.3 spec.

---

## What was wrong (violations by category)

### 1. No CSS variable system
`src/index.css` did not exist. All design tokens were JS constants (`GOLD`, `SAND_400`, etc.) defined at the top of App.tsx. This made the app fragile — any future token change required hunting inline style objects — and it was completely disconnected from the parent RTMcompare CSS variable system.

**Fix:** Created `src/index.css` with a full `--color-sand-*` scale, semantic aliases (`--gold`, `--cream`, `--ink`, `--border`), font-family tokens, `--radius: 2px`, scrollbar styling, focus ring, and base resets. The App.tsx JS constants are replaced by a typed `V` object of CSS variable strings (`var(--gold)`, etc.). All inline style values now reference these variables.

### 2. Drop zone: centred hero stack (anti-AI rule #12)
The empty drop zone used `textAlign: 'center'` on a wrapper div, placing a `+` icon, a line of body copy, and a Browse button in a centred column. This is the single most overused AI-design layout pattern. The `+` div (fontSize 32) also violated rule #14 (decorative icon as focal element).

**Fix:** Drop zone empty state is now left-anchored, asymmetric. The `+` icon is removed entirely. The headline is Instrument Serif italic (`display-serif-italic` class) at 26px. The sublabel uses `fontWeight: 300` Outfit in `sand-400`. The Browse button sits flush-left below the copy, not centred.

### 3. Colophon: centred single-line footer (wrong vocabulary)
The footer was `textAlign: 'center'` with a single centred string. This does not match the colophon vocabulary used in RTMcompare (flex `space-between`, left product name, right copyright, tracked all-caps, `sand-500`). It also contained "· Companion to RTMcompare" embedded in the same string — not separable.

**Fix:** Footer rebuilt as `display: flex; justify-content: space-between`. Left: `RTMprofile`. Right: `© 2026 RTM Audio. All rights reserved.` Font: `0.58rem`, `sand-500`, `letterSpacing: 0.16em`, all-caps. Matches RTMcompare Colophon exactly.

### 4. Result panel: chatbot-register success copy
`"Profile saved"` is acceptable but generic. The error string `"Build didn't complete"` is chatbot-register (soft, non-committal, dodging what happened).

**Fix:**
- Success: `"Profile written."` — declarative, terminal, no exclamation.
- Error: `"Build failed."` — states the fact, not a consolation.
- Next-step instruction changed from passive ("Open RTMcompare → pick this profile") to imperative shorthand: `"RTMcompare → Match tab → profile dropdown → select this file."`

### 5. FileRow: font family applied to wrong property
`FileRow` had `fontFamily: V.sand100` in its container div — a copy-paste error (V.sand100 is a colour, not a font). The mono class was only applied on the `<span>` via `className="mono"`, which was correct, but the container had a nonsensical font assignment.

**Fix:** Container div no longer sets `fontFamily`. The `<span>` carries `className="mono"` and `color: V.sand100` for the file name display.

### 6. Button copy: sentence-case vs tracked-caps
`BuildStatusLine` returned plain mixed-case strings like `"Build profile"` and `"Starting…"`. The button uses `textTransform: uppercase` but the source strings included lowercase letters that won't map correctly with `…` (an ellipsis). Anti-AI rule #24 requires tracked-caps button labels, not sentence-case.

**Fix:** All button-label strings changed to all-caps base strings: `"BUILD PROFILE"`, `"BUILD PROFILE — DEEP SCAN"`, `"STARTING"`, `"ANALYZING {i} / {total}"`, `"DEEP-SCANNING {i} / {total}"`. No ellipsis (anti-AI rule #33: "no 'Loading…' with an ellipsis").

### 7. Drop zone staged-file count copy
`"{n} files"` is technically correct but bare. The context is a staging area, not a display list.

**Fix:** Changed to `"{n} files staged"` — adds operational clarity at no word cost.

### 8. Body description copy: jargon-first
The original onboarding paragraph opened with "corpus / spectral signature" technical terms before the user understood the job-to-be-done.

**Fix:** Revised to: "Feed RTMprofile 5+ finished masters. It reads your spectral signature and writes a fingerprint file that RTMcompare uses to grade new mixes against your standard." — job first, mechanism second.

### 9. Font import: index.html already correct
`index.html` already loads Instrument Serif (ital 0;1), Outfit (wght 300;400;500;600), and JetBrains Mono (wght 400;500) via Google Fonts. No change needed here.

### 10. main.tsx: CSS import missing
`src/index.css` was not imported. Added `import './index.css'` to `src/main.tsx`.

---

## What was already correct (kept unchanged)

- `border-radius: 2` (or `var(--radius)`) everywhere — correct.
- No drop shadows on any surface — correct.
- No gradients — correct.
- No emoji — correct.
- Gold appears exactly once per surface (the italic kicker `"ear"` in the wordmark kicker) — correct; the Build button uses gold for border and text, not fill.
- `btnPrimary`: transparent bg + gold border + gold text — correct outlined recipe.
- `btnSecondary`: transparent bg + sand border — correct ghost recipe.
- `btnDisabled`: sand-400 text + sand border — correct.
- `accentColor: GOLD` on the checkbox — acceptable single use, kept.
- Deep Scan toggle: `rgba(208,176,102,0.06)` bg on active — correct (tint, not fill).
- `dragHover` bg: `rgba(208,176,102,0.12)` — within the tint rule.
- Instrument Serif wordmark, upright (not italic) — consistent with RTMcompare HeaderV2.
- Instrument Serif italic kicker ("Teach RTM your ear.") — correct editorial italic moment.
- `aria-hidden` on decorative footer — correct.
- Drag-region strip at top for macOS hiddenInset title bar — correct.
- `BuildStatusLine` and `FileRow` memoised — performance concern, kept.

---

## Files changed

| File | Change |
|------|--------|
| `src/index.css` | **Created** — CSS variable system, reset, focus ring, scrollbar |
| `src/main.tsx` | Added `import './index.css'` |
| `src/App.tsx` | Full audit: tokens → CSS vars, drop zone asymmetry, colophon, microcopy |
| `DESIGN-UPGRADE.md` | **Created** — this file |
