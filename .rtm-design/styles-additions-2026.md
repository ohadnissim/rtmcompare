# styles.css additions — 2026-05-11

Appended to `src/styles.css`. Nothing above the insertion point was modified.

---

## 1. Microinteraction animation system

Seven keyframes added: `panel-in`, `tab-fade`, `analysis-pulse`, `verdict-in`, `empty-in`, `banner-in`. Each is a single reusable primitive following the Trigger/Rules/Feedback/Loops model (Dan Saffer).

**Applied selectors:**

| Target | Selector used | Animation |
|---|---|---|
| MetricCell children | `[data-rtm-metric-strip] [data-cell]:nth-child(1–6+)` | `panel-in` with stagger using `--duration-stagger-step` tokens |
| Tab panel content | `[role="tabpanel"]` | `tab-fade` 160ms |
| Progress bar fill | `[role="progressbar"] > div` | `analysis-pulse` 2s infinite; stopped at `aria-valuenow="100"` |
| Verdict hero numbers | `[aria-label="Overall verdict"] > span:nth-child(2)` (× 7 tabs) | `verdict-in` 320ms, 60ms delay |
| Empty-state cover | `[aria-label="RTMcompare cover"]` | `empty-in` 400ms |
| Incoming plugin banner chips | `[aria-label="Incoming from RTM plugin"] > div` | `banner-in` 200ms |
| Drop zone drag-active | `.drop-zone.active` | `transform: scale(1.003)` via transition |

**Note on component structure:** EmptyStateV2, MetricCell, and PanelVerdict are almost entirely inline-styled. Selectors use ARIA landmark attributes and data-attributes that already exist in the DOM — no component changes required for the animations to fire.

**Global reduced-motion backstop** added (`prefers-reduced-motion: reduce`) — covers everything outside the existing shell-scoped reduced-motion block already in the file.

---

## 2. Focus rings

Global `:focus-visible` ring added at 1px solid `--color-terra`, offset 2px. Defers to the 2px v5.2 shell ring (scoped to `[data-rtm-metric-strip]` etc.) when both could match. `:focus:not(:focus-visible)` removes the browser default ring so the two rings never stack.

---

## 3. Skip-to-content link

`.skip-link` class added. Lives at `top: -100%` until focused, then slides to `top: 8px` via a 0.1s transition. To activate: add `<a href="#main-content" className="skip-link">Skip to content</a>` as the first DOM child in App.tsx, and `id="main-content"` on the top-level content wrapper.

---

## 4. Display font intent classes

`.verdict-hero`, `.empty-headline`, `.panel-verdict-value` → `font-family: var(--font-display); font-style: italic;`. These act as opt-in classes for future refactors (PanelVerdict accepts a `className` prop on its wrapper `<header>`; applying `.panel-verdict` + child `.panel-verdict-value` would be the clean path). Current component inline styles already set the font-family; these classes document intent and enable future cleanup without CSS changes.

---

## 5. Scrollbar styling

6 × 6px track, transparent background, `--color-sand-600` thumb with `border-radius: 2px`. Hover lifts to `--color-sand-500`. Firefox covered via `scrollbar-width: thin` + `scrollbar-color` on `*`.

---

## 6. Screen-reader utility

`.sr-only` — standard visually-hidden pattern (position absolute, 1 × 1px clip). Use on ARIA live region text that has no visible counterpart, or any label-only span.
