# Shell Audit — Console Didone v5.2 Compliance
**Date:** 2026-05-11
**Scope:** 12 shell files (shell/ components + App.tsx top-level wiring)
**Result:** 6 violations found and fixed across 2 files. 10 files clean.

---

## Summary

6 violations fixed in 2 files.

---

## File-by-File Log

### `src/components/shell/HeaderV2.tsx` — 5 violations, 5 fixed

| # | Rule violated | Location | Fix applied |
|---|---|---|---|
| 1 | `border-radius: 6px` (rounded-md) on Search button | line 99 (pre-fix) | Removed `rounded-md`, added `borderRadius: 'var(--radius-card)'` in style |
| 2 | `border-radius: 6px` (rounded-md) on Shortcuts button | line 117 | Same fix |
| 3 | `border-radius: 6px` (rounded-md) on "+ New analysis" button | line 134 | Same fix |
| 4 | `backdrop-filter: blur` via `backdrop-blur-md` on header element | line 56 | Removed `backdrop-blur-md` from className. Rule: no backdrop-filter blur. |
| 5 | `color: var(--color-accent)` on "+ New analysis" button label | line 136 | Changed to `color: var(--color-text-primary)` (cream) + `border: '1px solid var(--color-accent)'`. Rule: no gold on informational text; primary button = gold border + cream text. |

### `src/components/shell/OverflowMenu.tsx` — 1 violation, 1 fixed

| # | Rule violated | Location | Fix applied |
|---|---|---|---|
| 6 | RadioPair active state used `var(--color-bg-app)` instead of the canonical `rgba(208,176,102,0.12)` cream tint | line 401 | Changed to `var(--rtm-chip-bg-active)`. Rule: active/selected states must use the cream tint, not a fill. |

---

## Files Audited — No Violations

| File | Notes |
|---|---|
| `Wordmark.tsx` | Clean. `--font-display`, no shadow, no radius. |
| `SurfaceChips.tsx` | Clean. Active chip gold text is sanctioned single-gold-anchor. Pill radius correct. |
| `MetricStrip.tsx` | Clean. Overflow scroll gradient is explicitly excepted by rule #1's clause. |
| `MetricCell.tsx` | Clean. No radius, no gold on labels, Didone numerals correct. |
| `EmptyStateV2.tsx` | Clean. "Before" in gold is the sanctioned single editorial gesture. Asymmetric colophon + RTMBadge break the central axis per anti-centered-stack rule. |
| `PanelVerdict.tsx` | Clean. Didone hero, no radius, no shadow, no gradient. |
| `TabVerdict.tsx` | Clean. No styling — delegates entirely to PanelVerdict. |
| `RTMBadge.tsx` | Clean. Gold diamond is the single chromatic gesture per rule. |
| `Colophon.tsx` | Clean. `--color-text-dim`, `--font-sans`, no gold, no decoration. |
| `App.tsx` (shell wiring) | Clean. Swap button uses `rounded-full` = pill, which is sanctioned. No Tailwind zinc/slate/gray. HeaderV2 and EmptyStateV2 wired correctly. |

---

## Rules With No Violations Found (across all 12 files)

- `text-zinc-*`, `text-slate-*`, `text-gray-*` Tailwind classes: 0 instances
- Emoji: 0 instances (⋯ ↘ are Unicode, not emoji)
- Inline `#c5a55a` or `#d0b066` hex: 0 instances
- `box-shadow` with lift effect: OverflowMenu shadow uses sanctioned `--rtm-overflow-shadow` token (documented exception)
- Decorative icons: SVG icons in HeaderV2 are functional (aria-labels present), not decorative
- Gradients: MetricStrip overflow mask is explicitly excepted in component comment
- Hero type (`--font-display`, italic): correct in Wordmark, EmptyStateV2, PanelVerdict
- `fontStyle: italic` on hero typography: correct where required

---

## Notes for Next Pass

- `src/styles.css` (read for token context, not in fix scope) contains `border-radius: 0.25rem` (4px) on `.drop-zone` and `.stem-card` — these predate v5.2 and are not shell components, but they should be cleaned up in a separate styles audit pass.
- The global focus-visible ring in `styles.css` uses `border-radius: 4px` — also out of scope here but worth addressing.
