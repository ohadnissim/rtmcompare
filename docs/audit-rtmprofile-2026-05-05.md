# RTMprofile 1.1.0 — multi-skill audit (2026-05-05)

Skills applied: **code-reviewer · senior-security · react-best-practices ·
ui-ux-pro-max · frontend-design**. Companion audit to RTMcompare's
[`audit-2026-05-05.md`](audit-2026-05-05.md) — same rubric, same five
keepers, scoped to the small companion app at `rtm-profile-app/`.

---

## P0 — must fix this sprint

### 1. Body type at 11–12 px + sub-AA muted grey = WCAG fail
**Source:** ui-ux-pro-max
**Where:** `rtm-profile-app/src/App.tsx:151,180,202,256`
Tiny copy plus `MUTED #8d867b` on `#1c1a17` (~3.6:1) double-fails AA. First-time users squint at the drop zone. **Effort: S** — bump base body to 14 px, micro-labels to 11 px tracked-caps, lift muted grey to ~`#a59d8e` for body copy.

### 2. No focus indicators anywhere — keyboard users stranded
**Source:** ui-ux-pro-max
**Where:** `App.tsx:265,349-365,372-405,230-262`
Inputs set `outline:'none'` with no replacement; buttons have no `:focus-visible` ring; the Deep Scan checkbox has no visible focus state. **Effort: S** — global `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px }` and remove the `outline:'none'`.

### 3. Progress event re-renders the entire `App` tree on every Python tick
**Source:** react-best-practices
**Where:** `App.tsx:31,35-37`
`progress` state lives at the root; the form, drop zone, the per-file mapped list, Deep-Scan card, and result panel all re-render on every IPC tick during a long Python build. With 50–200 tracks this is real DOM diff cost. **Effort: S** — extract a memoised `<BuildProgressLabel />` that owns `progress` state and is the only `onProgress` subscriber.

---

## P1 — should fix soon

### 4. Drop zone has no visual / ARIA affordance — listeners live on `window`
**Source:** ui-ux-pro-max
**Where:** `App.tsx:93-106,170-222`
Window-level drag handlers (so dropping anywhere works), but the zone gives no `dragover` highlight, no `aria-label="Audio file drop zone"`, no `role="button"` on the inner Browse affordance, and the giant "+" is a `<div>`. First-timers won't trust that the zone is live. **Effort: M** — wire `onDragEnter/Leave` to swap border to solid gold, add ARIA, make Browse a real `<button>`.

### 5. Onboarding never answers "what is a profile and why make one?"
**Source:** ui-ux-pro-max
**Where:** `App.tsx:137-154`
Header subtitle says *"Build a custom engineer profile from a corpus"* — jargon stacked on jargon ("corpus", "spectral signature", "Match tab") before the user has done anything. **Effort: S** — add one plain-English line: *"Feed RTMprofile 5+ of your finished masters. It learns your sound and saves a fingerprint that RTMcompare uses to grade new mixes against your style."* Move the technical sentence to a `Learn more` disclosure.

### 6. `outPath` IPC argument is an unvalidated path-traversal sink
**Source:** senior-security
**Where:** `electron/main.ts:153` → `python/build_profile.py:427-450`
The renderer can pass `outPath = '~/Library/LaunchAgents/foo.plist'` and the bundled Python writes attacker-controlled JSON anywhere the user can write. **Effort: S** — in the IPC handler, reject `outPath` not under `~/.rtm/profiles/` (resolve + `startsWith` check), or strip it entirely and always derive from `--name`.

### 7. No CSP, no `setWindowOpenHandler` — same gap as parent F4 pre-5.2.0
**Source:** senior-security
**Where:** `index.html` + `electron/main.ts`
`will-navigate` is blocked but `window.open(...)` from a compromised renderer still spawns a BrowserWindow. **Effort: S** — strict `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'">` + `setWindowOpenHandler(() => ({ action: 'deny' }))`.

### 8. Over-broad mac entitlements
**Source:** senior-security
**Where:** `build/entitlements.mac.plist:12,15`
`disable-library-validation` + `disable-executable-page-protection` neutralise hardened-runtime guarantees. A dylib hijack inside the bundled Python dir executes with the app's signed identity. **Effort: M** — drop `disable-executable-page-protection` (Electron doesn't need it). Keep library-validation off only if Python C-extensions truly require it; otherwise remove.

### 9. `proc.on('close')` parses last stdout line blindly — silent build failures on stray output
**Source:** code-reviewer
**Where:** `electron/main.ts:182-210`
`stdout.trim().split('\n').pop()` returns *any* trailing line. If Python writes a deprecation warning to stdout (transitive dep), `JSON.parse` throws → successful build reported as `ok:false`. **Effort: S** — scan stdout from the end for the first `{`-prefixed line and parse that.

### 10. File-list rows re-render on any state change (no per-row stable handler)
**Source:** react-best-practices
**Where:** `App.tsx:52-54,202-218`
Inline `() => onRemoveOne(f)` arrow is recreated each render; row `<div>` isn't memoised. Adding/removing one file or any progress tick reconciles the entire list. **Effort: S** — extract a `React.memo`'d `<FileRow path={f} onRemove={onRemoveOne} />`.

---

## P2 — backlog

### 11. Display face is sans-serif everywhere — no Instrument Serif, no design-system parity
**Source:** frontend-design
**Where:** `index.html:14` (no font links) + `App.tsx:145` (wordmark in San Francisco at 22px/600)
The whole Console-Didone premise is missing in this app. The wordmark "RTMprofile" reads as generic SaaS. **Effort: M** — `<link>` Instrument Serif + Outfit + JetBrains Mono in `index.html`; set the wordmark to Instrument Serif italic ~52 px; let it dominate the page.

### 12. Gold appears 5+ times per composition — "single gold gesture" rule broken
**Source:** frontend-design
**Where:** `App.tsx:145` (wordmark) `:181` (drop "+") `:193` (file-count) `:250` (Deep Scan label) `:378` (CTA fill) `:305` (error icon)
The philosophy explicitly forbids this. **Effort: S** — hold gold for the primary CTA outline only; demote the rest to cream / sand-300.

### 13. Pill-shaped solid-gold buttons violate the radius + understated-outlined rule
**Source:** frontend-design
**Where:** `App.tsx:380` (`btnPrimary`, `borderRadius: 8`), `:396` (`btnSecondary`, `borderRadius: 16`)
Parent's `.btn-primary` is `border-radius: 0`, transparent fill, 1 px gold border, hover-fills. RTMprofile uses solid-gold rounded buttons — generic Material aesthetic. **Effort: S** — adopt the parent's `.btn-primary` recipe verbatim.

### 14. Color system entirely re-invented locally — no shared `@theme` tokens
**Source:** frontend-design
**Where:** `App.tsx:3-7` (`GOLD/MUTED/CREAM/BG_PANEL/BORDER` as module constants)
Hex values diverge from the canonical sand-100 / terra (e.g. `#1c1a17` panel ≠ parent `--color-sand-800: #1e1c18`). No light theme. **Effort: M** — import the parent's CSS variables (or duplicate the `@theme` block) and reach via `var(--color-accent)`.

### 15. `_loudness_range` redundantly re-runs gated loudness per 3 s slice
**Source:** code-reviewer
**Where:** `python/build_profile.py:103-133`
For a 4-min track at 44.1 kHz, ~240 redundant gated-loudness passes per file. With Deep Scan × N stems × N files, builds slow noticeably; `lra` is persisted but never read elsewhere. **Effort: M** — use `pyln.Meter.loudness_range()` if available, else delete `lra` entirely.

### 16. Silent files with finite LUFS still pass the `valid` filter
**Source:** code-reviewer
**Where:** `python/build_profile.py:368`
`valid` accepts any measurement where `np.isfinite(m["lufs"])`. A digital-silence file passes pyloudnorm's gate at ~`-70 LUFS` and finite — drags `lufs_avg` toward noise floor and **inflates `curve_mad`** (which now feeds the Austin fix). **Effort: S** — add `m["peak_db"] > -60` to the `valid` predicate.

### 17. Inline style objects rebuild on every progress tick + redundant `as any` escapes
**Source:** react-best-practices + code-reviewer
**Where:** `App.tsx:171-178,230-241` (drop-zone style object) + `electron/main.ts:139` (`(process as any).resourcesPath` cast — already typed in `@types/electron`)
Mostly cosmetic but worth a sweep. **Effort: S**

---

## Recommended sprint plan

**Sprint 1 (one day):** P0s 1–3 + P1s 6–7 + 9–10. Net: WCAG-compliant, focus indicators, stops the per-tick re-render storm, closes the path-traversal + missing-CSP gaps, no more silent build failures.

**Sprint 2 (one day):** P1s 4, 5, 8 + P2 16. Drop zone gets real affordances + ARIA, onboarding answers "why am I here?", entitlements tightened, silent-file guard.

**Backlog:** P2s 11–15, 17 — design-system parity work (load Instrument Serif, share tokens with parent, restyle buttons). Highest leverage at P2 is **#11 + #14 together** — once tokens are shared, restyling cascades.

**Honest summary:** RTMprofile is a solid small app — the recent 1.1.0 work (bundled Python, friendly errors, `curve_mad` for Austin's fix) shows real care. The major gaps are *parity with RTMcompare* — both visually (no Instrument Serif, gold overuse, generic button shapes) and architecturally (no shared tokens, no shared CSP/security baseline). Closing those would make the suite feel like one product instead of two adjacent products. No P0 security findings — the IPC discipline is correct (argv arrays, no shell, no eval).
