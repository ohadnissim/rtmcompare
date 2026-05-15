# RTMcompare Components Audit — Console Didone Compliance
Date: 2026-05-11  
Scope: 21 medium components in `src/components/`  
Standard: v5.2 Anti-AI-Design rules + Console Didone philosophy

---

## Summary

All 21 components audited and fixed. Violations fell into six categories:

1. **Banned border-radius** — `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-2xl` throughout. Fixed to `borderRadius: '2px'` inline or removed in favour of `rounded-full` (pill) where semantically appropriate (e.g. DurationPill container).
2. **backdropFilter blur** — present in 7 components. All removed; no frosted glass in the v5.2 shell.
3. **boxShadow card lift** — present in 5 components. All removed.
4. **Tailwind dark tokens** (`bg-dark-*`, `text-dark-*`, `border-dark-*`) — leaked in LufsTargets, CategoryCard, CollapsibleSection, LevelMeter. Replaced with inline `rgba()` values using the correct sand token equivalents.
5. **Vibrant non-palette colours** — StemCard used `#3b82f6` (blue), `#a855f7` (purple), `#f43f5e` (pink) for stem colour coding. Replaced with sanctioned token set: `--color-warm-amber` (Vocals), `--color-warm-red` (Drums), `--color-teal` (Bass), `--color-sand-400` (Other).
6. **Gold as button fill** — OnboardingTour had `backgroundColor: '#d0b066'` on the primary CTA "Show me around" button. Replaced with transparent + gold border. Same fix applied to the spotlight "Next" button. (The B-bar level fill and the READY verdict diamond are data/colophon uses — left as-is per design intent.)

---

## Per-file breakdown

### ProgressBar.tsx
- Progress track: `rounded-full` → `borderRadius: 2px`
- Progress fill inner: `rounded-full` → `borderRadius: 2px`
- Cancel button: `rounded-full` → `borderRadius: 2px`

### FileDropZone.tsx
- Lock button: `rounded-full` → `borderRadius: 2px`
- Clear button: `rounded-full` → `borderRadius: 2px`
- Drop error message: `rounded` (4px default) → `borderRadius: 2px`

### ProfileDropdown.tsx
- Trigger button: `rounded-md` → `borderRadius: 2px` (added to style block)
- Dropdown panel: `rounded-md` + `backdropFilter: blur(8px)` → `borderRadius: 2px`, no filter
- Removed `shadow-lg` from dropdown

### ReferenceDropdown.tsx
- Trigger button: `rounded-md` → `borderRadius: 2px`
- Dropdown panel: `rounded-md` + `boxShadow: 0 6px 24px...` → `borderRadius: 2px`, no shadow

### ReferenceAlert.tsx
- Wrapper: `rounded-xl` → `borderRadius: 2px`

### RecentAnalyses.tsx
- Entry row: `rounded-lg` → `borderRadius: 2px`
- B-slot badge: `rounded` → `borderRadius: 2px`
- Version count pill: `rounded-full` retained (genuine pill shape)

### InfoTooltip.tsx
- `?` button: `rounded-full` → `borderRadius: 2px` (merged into style block)
- Tooltip bubble: `rounded-lg` + `boxShadow` → `borderRadius: 2px`, no shadow

### CollapsibleSection.tsx
- `?` glossary button: `rounded-full` → `borderRadius: 2px`
- Educator "Why this matters" block: `rounded-lg` → `borderRadius: 2px`
- GlossarySheet overlay: `backdropFilter: blur(4px)` removed
- GlossarySheet panel: `boxShadow: -16px 0 48px...` removed
- Outer container: `bg-dark-900/40 border border-dark-700/30` → inline rgba tokens

### DurationPill.tsx
- No changes — `rounded-full` on the pill container is the correct and only allowed non-2px radius per design system. DurationPill is definitionally a pill.

### LufsTargets.tsx
- Outer container: `rounded-2xl` + `bg-dark-900` → `borderRadius: 2px` + rgba token
- Per-platform cards: `rounded-xl` + `bg-dark-800` → `borderRadius: 2px` + rgba token
- Bar tracks: `rounded-full` → `borderRadius: 2px`
- Bar dots: `rounded-full` → `borderRadius: 2px`
- `text-amber-400` on File B label → `color: var(--color-terra)` (single gold accent)
- `#34d399` (emerald), `#f59e0b` (amber), `#f43f5e` (rose) status colours → `--color-sage`, `--color-warm-amber`, `--color-warm-red` tokens
- Removed all `text-dark-*` and `bg-dark-*` Tailwind token usage
- Removed vibrant brand colour dots (Spotify green, YouTube red, etc.) — not needed for meaning

### CategoryCard.tsx
- Outer container: `bg-dark-900/40 border border-dark-700/30` → inline rgba tokens
- Solo button: `rounded` → `borderRadius: 2px`
- Diff badge: `rounded-full` → `borderRadius: 2px`
- Toast badge: `rounded` → `borderRadius: 2px`
- Level bar tracks: `bg-dark-800/60 rounded-full` → `borderRadius: 2px` + rgba background
- Level bar fills: `rounded-full` → no borderRadius (overflow:hidden on parent handles clipping)
- Extra metrics border: `border-dark-700/30` → inline `rgba()` token
- `text-dark-300`, `text-dark-200`, `text-dark-400`, `text-dark-500` → `var(--color-text-*)` tokens
- Level bar A fill: `#6b7280` (Tailwind zinc) → `var(--color-sand-400)`

### LevelMeter.tsx
- Bar tracks: `rounded-full` + `bg-dark-800` → `borderRadius: 2px` + rgba
- Bar fills: `rounded-full` → `borderRadius: 2px`
- `text-dark-400`, `text-dark-500` → `var(--color-text-*)` tokens
- Diff colour: `#34d399` (emerald) and `#fbbf24` (amber) → `var(--color-sage)` and `var(--color-warm-amber)`

### StemCard.tsx
- Completely rewrote colour palette. Original used 4-colour vibrant system: amber/yellow, pink/rose, blue, purple.
- Replaced with Console Didone sanctioned tokens: `--color-warm-amber` (Vocals), `--color-warm-red` (Drums), `--color-teal` (Bass), `--color-sand-400` (Other).
- Removed coloured icon background squares (`rounded-lg` tinted boxes) — replaced with a 16px flat SVG icon in the stem accent colour.
- `rounded-lg` on icon container removed.
- `text-dark-300` on insights → `var(--color-text-secondary)`

### SpecDriftBadge.tsx
- Trigger badge: `rounded-md` → `borderRadius: 2px`
- Dialog overlay: `backdropFilter: blur(6px)` removed
- Dialog panel: `rounded-xl` → `borderRadius: 2px`
- Close button: `rounded-md` → `borderRadius: 2px`
- Delta rows: `rounded-lg` → `borderRadius: 2px`
- Fallback "no delta" div: `rounded-lg` → `borderRadius: 2px`

### AttentionList.tsx
- Item button: `rounded` → `borderRadius: 2px`

### ReadyToDeliverVerdict.tsx
- Mono compat badge: `rounded-full` → `borderRadius: 2px`
- DSP compliance wrapper: `rounded-md` → `borderRadius: 2px`
- DSP grid border: `borderRadius: 6` → `borderRadius: '2px'`

### CommandPalette.tsx
- Overlay: `backdropFilter: blur(6px)` removed
- Panel: `rounded-2xl` + `boxShadow: 0 20px 60px...` → `borderRadius: 2px`, no shadow
- Esc kbd: `rounded` → `borderRadius: 2px`

### ShortcutHelp.tsx
- Overlay: `backdropFilter: blur(4px)` removed
- Panel: `rounded-2xl` → `borderRadius: 2px`
- Keyboard key `<kbd>`: `rounded` → `borderRadius: 2px`
- Close button: `rounded-lg` → `borderRadius: 2px`

### ErrorBoundary.tsx
- Error container: `rounded-xl` → `borderRadius: 2px`
- "Try again" button: `rounded-md` → `borderRadius: 2px`
- "Reload app" button: `rounded-md` → `borderRadius: 2px`
- Error copy: "Something went wrong" → "Error" (rule 34: no chatbot-friendly error phrasing)

### RtmIncomingBanner.tsx
- Auto-toast div: `rounded-lg shadow-xl backdrop-blur-md` → `borderRadius: 2px`, no shadow/filter
- DropChip outer div: `rounded-lg shadow-xl backdrop-blur-md` → `borderRadius: 2px`, no shadow/filter
- Icon container: `rounded-md` → `borderRadius: 2px`
- Dismiss-all button: `rounded` → `borderRadius: 2px`
- Load → Reference button: `rounded` → `borderRadius: 2px`
- Load → Compare button: `rounded` → `borderRadius: 2px`
- Dismiss button: `rounded` → `borderRadius: 2px`

### OnboardingTour.tsx
- Welcome modal overlay: `backdropFilter: blur(8px)` removed
- Welcome modal panel: `rounded-2xl` → `borderRadius: 2px`
- "I'll poke around" skip button: `rounded-full` → `borderRadius: 2px`
- "Show me around" CTA button: `rounded-full` + gold fill (`backgroundColor: '#d0b066'`) + `hover:scale-105` + `boxShadow` → `borderRadius: 2px` + transparent background + gold border. Gold fill on buttons is banned per Console Didone.
- Pillar cards: `rounded-xl` → `borderRadius: 2px`
- Spotlight popover: `rounded-2xl` + `boxShadow` → `borderRadius: 2px`, no shadow
- Step indicator dots: `rounded-full` → `borderRadius: 2px`
- "Back" button: `rounded-md` → `borderRadius: 2px`
- "Next" / "Got it" button: `rounded-md` + gold fill → `borderRadius: 2px` + transparent + gold border

---

## Rules enforced

All fixes applied against the following v5.2 rules from `v5.2-anti-ai-design.md`:

- Rule 2: No `backdrop-blur-*`
- Rule 3: No drop shadows on type; no card box-shadow lift
- Rule 6: No `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-3xl`
- Rule 16: No three-colour modern palettes (StemCard)
- Rule 17: No Tailwind gray classes as accent text
- Rule 34: No "Oops!" / "Something went wrong" chatbot error copy (ErrorBoundary)
- Console Didone colour discipline: gold (`--color-terra`) never fills buttons
