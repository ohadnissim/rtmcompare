import React from 'react'

/**
 * MetricCell — single column of the v5.2 metric strip.
 *
 * Three stacked lines:
 *   eyebrow → tracked all-caps label, sand-muted, 9px
 *   value   → Didone numeral, cream, 28px
 *   delta   → Didone smaller, sand-secondary by default,
 *             violation colour when `violation === true`
 *
 * Pure presentational. The strip composes these and feeds them
 * data; this cell does no logic of its own.
 *
 * Mono is INTENTIONALLY not used here. Per the philosophy, hero
 * metrics are proper names and get the Didone treatment; mono is
 * reserved for tabular data inside panels (Loudness Over Time,
 * batch results). Don't be tempted to switch — re-read
 * `.rtm-design/philosophy.md` if uncertain.
 *
 * Accessibility:
 *   - The cell announces as a single phrase by combining eyebrow +
 *     value + delta into the visual root's `aria-label`. Inner
 *     text nodes get `aria-hidden` so the SR doesn't read each line
 *     separately and produce a stuttering announcement.
 *   - Optional `tooltip` renders via the native `title` attr — no
 *     custom tooltip widget, no portal. The OverflowMenu (task #10)
 *     is the only place we need a richer tooltip layer; cells are
 *     read at a glance.
 */
interface Props {
 eyebrow: string
 value: string
 delta?: string
 violation?: boolean
 tooltip?: string
}

export default function MetricCell({ eyebrow, value, delta, violation = false, tooltip }: Props) {
 // Build the SR phrase up front. Keep it natural-sounding. We avoid
 // embedding the unicode minus sign by transcribing to "minus" so
 // VoiceOver doesn't say "dash". Likewise "+" → "plus". Numbers
 // come through as-is because tabular announcement is the convention.
 const sr = [
 eyebrow,
 transcribeNumber(value),
 delta ? `delta ${transcribeNumber(delta)}` : null,
 violation ? '— out of tolerance' : null,
 ]
 .filter(Boolean)
 .join(', ')

 return (
 <div
 role="group"
 aria-label={sr}
 title={tooltip}
 style={{
 display: 'flex',
 flexDirection: 'column',
 alignItems: 'flex-start',
 gap: 4,
 }}
 data-cell={eyebrow}
 >
 <span
 aria-hidden
 style={{
 fontFamily: 'var(--font-sans)',
 fontWeight: 500,
 fontSize: 'var(--text-metric-eyebrow)',
 letterSpacing: 'var(--tracking-metric-eyebrow)',
 textTransform: 'uppercase',
 color: 'var(--color-text-muted)',
 lineHeight: 1,
 }}
 >
 {eyebrow}
 </span>

 <div
 aria-hidden
 style={{
 display: 'flex',
 alignItems: 'baseline',
 gap: 8,
 }}
 >
 <span
 style={{
 fontFamily: 'var(--font-display)',
 fontWeight: 400,
 fontSize: 'var(--text-metric-value)',
 lineHeight: 'var(--leading-metric-value)',
 letterSpacing: 'var(--tracking-metric-value)',
 color: 'var(--color-text-primary)',
 textShadow: 'none',
 }}
 >
 {value}
 </span>

 {delta && (
 <span
 style={{
 fontFamily: 'var(--font-display)',
 fontWeight: 400,
 fontSize: 'var(--text-metric-delta)',
 lineHeight: 'var(--leading-metric-delta)',
 color: violation
 ? 'var(--color-violation)'
 : 'var(--color-text-secondary)',
 textShadow: 'none',
 }}
 >
 {delta}
 </span>
 )}
 </div>
 </div>
 )
}

// Replace common numeric punctuation so screen readers read values
// the way an engineer would say them aloud.
function transcribeNumber(s: string): string {
 return s
 .replace(/−/g, 'minus ') // unicode minus
 .replace(/^-/, 'minus ')
 .replace(/^\+/, 'plus ')
 .replace(/\bdB\b/g, 'decibels')
 .replace(/\bdBTP\b/g, 'decibels true peak')
 .replace(/\bLU\b/g, 'loudness units')
 .replace(/\bLUFS\b/g, 'loudness units full scale')
}
