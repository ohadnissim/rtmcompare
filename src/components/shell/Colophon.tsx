import React from 'react'

/**
 * Colophon — the quiet line at the bottom of the empty-state cover.
 *
 * Renders `RTMcompare · v{version} · build {buildDate} · {license}`
 * with three centre-dots between segments. Set in tracked all-caps
 * at the metric-eyebrow scale (9px), sand-dim, decorative-only —
 * `aria-hidden` so a screen reader skips it entirely.
 *
 * This is the philosophy's "fine printing" vocabulary made literal:
 * a book has a colophon, and so does the cover empty state. Don't
 * be tempted to add a logo, a mark, an icon, or a "version: 5.2.0"
 * label here. The dignity is in the typography and the dots.
 *
 * Source values:
 *   - `version`   → injected at build time via Vite `define` as
 *                   `__APP_VERSION__` (mirrors `package.json` "version").
 *   - `buildDate` → injected at build time as `__BUILD_DATE__`.
 *   - `license`   → constant string passed by the caller.
 *
 * If the Vite defines are absent (e.g. during tsc-watch outside a
 * Vite build), we fall back to "dev" — keeps the component
 * renderable in tooling and tests without crashing.
 */
declare const __APP_VERSION__: string
declare const __BUILD_DATE__: string

interface Props {
 /** Override version. Defaults to Vite-injected `__APP_VERSION__`. */
 version?: string
 /** Override build date. Defaults to Vite-injected `__BUILD_DATE__`. */
 buildDate?: string
 /** License label. Defaults to `Internal license`. */
 license?: string
 className?: string
}

export default function Colophon({
 version,
 buildDate,
 license = 'Internal license',
 className,
}: Props) {
 const v = version ?? safeDefine(() => __APP_VERSION__) ?? 'dev'
 const b = buildDate ?? safeDefine(() => __BUILD_DATE__) ?? 'dev'

 const segments = [
 'RTMcompare',
 `v${v}`,
 `build ${b}`,
 license,
 ]

 return (
 <div
 aria-hidden
 className={className}
 style={{
 fontFamily: 'var(--font-sans)',
 fontWeight: 500,
 fontSize: 'var(--text-metric-eyebrow)',
 letterSpacing: 'var(--tracking-metric-eyebrow)',
 textTransform: 'uppercase',
 color: 'var(--color-text-dim)',
 textAlign: 'center',
 lineHeight: 1,
 // Three centre-dots between segments — render as plain text
 // so copy-paste preserves the visual rhythm.
 whiteSpace: 'nowrap',
 overflow: 'hidden',
 textOverflow: 'ellipsis',
 }}
 >
 {segments.join(' · ')}
 </div>
 )
}

// Vite `define` substitutes `__APP_VERSION__` at build time. Outside
// a Vite build (Jest, Storybook without Vite, raw tsc), the symbol
// is undefined and direct reference throws ReferenceError. The
// thunked accessor isolates the throw so we can fall back cleanly.
function safeDefine<T>(read: () => T): T | undefined {
 try {
 return read()
 } catch {
 return undefined
 }
}
