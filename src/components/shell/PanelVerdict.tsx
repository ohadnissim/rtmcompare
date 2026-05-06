import React from 'react'

/**
 * PanelVerdict — the hero typography moment at the top of each of
 * the seven main analysis panels.
 *
 * Three lines:
 *   eyebrow → tracked all-caps label, sand-muted, 10px
 *   value   → Didone hero numeral, cream
 *               size 'lg' → 96px (Overview, Mastering Delta)
 *               size 'sm' → 64px (Stereo & Spectrum, EQ Match,
 *                                 Breakdown, Quality, Delivery)
 *   caption → italic display serif, sand-secondary, 14px,
 *             one short sentence
 *
 * The `lg` / `sm` split is the philosophy's "operatic ratio" made
 * concrete: primary verdicts (Overview, Mastering Delta) earn the
 * 96px scale; supporting verdicts stay quieter at 64px. The visible
 * 32px gap between the two scales is intentional — subtle is wrong
 * here.
 *
 * `violation` paints the hero numeral in the violation colour
 * (warm-red via `--color-violation`). Use it ONLY when a number has
 * crossed a delivery-spec tolerance — never decoratively. See
 * `metricSpecs.ts` (task #9 will introduce it) for the canonical
 * threshold helper.
 *
 * This component is purely presentational. It does not derive
 * values from analysis result objects — the panel that mounts it
 * does that and passes the strings in. Keeping it dumb means we
 * can render mockups, Storybook frames, and tests without any
 * audio analysis dependency.
 */
type VerdictSize = 'sm' | 'lg'

interface Props {
 eyebrow: string
 value: string
 caption?: string
 size?: VerdictSize
 violation?: boolean
 className?: string
}

const HERO_SIZE: Record<VerdictSize, string> = {
 sm: 'var(--text-verdict-hero-sm)',
 lg: 'var(--text-verdict-hero-lg)',
}

export default function PanelVerdict({
 eyebrow,
 value,
 caption,
 size = 'lg',
 violation = false,
 className,
}: Props) {
 return (
 <header
 // Use a <header> landmark so the verdict is announced first by
 // assistive tech as the panel's own header — distinct from the
 // app's top header (which uses role="banner" via implicit
 // <header> at the page top, but only one banner per document
 // is allowed; `<header>` inside a panel becomes a section
 // header instead, which is what we want).
 className={className}
 style={{
 display: 'flex',
 flexDirection: 'column',
 alignItems: 'flex-start',
 gap: 6,
 paddingBottom: 16,
 }}
 >
 <span
 style={{
 fontFamily: 'var(--font-sans)',
 fontWeight: 500,
 fontSize: 'var(--text-verdict-eyebrow)',
 letterSpacing: 'var(--tracking-verdict-eyebrow)',
 textTransform: 'uppercase',
 color: 'var(--color-text-muted)',
 lineHeight: 1,
 }}
 >
 {eyebrow}
 </span>

 <span
 style={{
 fontFamily: 'var(--font-display)',
 fontWeight: 400,
 fontSize: HERO_SIZE[size],
 lineHeight: 'var(--leading-verdict-hero)',
 letterSpacing: 'var(--tracking-metric-value)',
 color: violation
 ? 'var(--color-violation)'
 : 'var(--color-text-primary)',
 textShadow: 'none',
 // Disable any default tabular-nums inheritance — verdict
 // numerals are proper names, not tabular data, so they get
 // proportional figures.
 fontVariantNumeric: 'normal',
 }}
 >
 {value}
 </span>

 {caption && (
 <span
 style={{
 fontFamily: 'var(--font-display)',
 fontStyle: 'italic',
 fontWeight: 400,
 fontSize: 'var(--text-verdict-caption)',
 lineHeight: 'var(--leading-verdict-caption)',
 color: 'var(--color-text-secondary)',
 maxWidth: '52ch',
 }}
 >
 {caption}
 </span>
 )}
 </header>
 )
}
