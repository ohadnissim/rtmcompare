import React, { useState } from 'react'
import { useLearnMode } from '../../context/LearnModeContext'
import { METRIC_EXPLAINERS } from '../learn/METRIC_EXPLAINERS'

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
 /** Key into METRIC_EXPLAINERS for the learn-mode inline explainer */
 metricKey?: string
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
 metricKey,
}: Props) {
 const { enabled } = useLearnMode()
 const [showExplainer, setShowExplainer] = useState(false)

 const explainerContent = metricKey ? METRIC_EXPLAINERS[metricKey] : null

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
 <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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

 {enabled && explainerContent && (
 <button
 type="button"
 aria-label={`Explain ${explainerContent.metric}`}
 aria-expanded={showExplainer}
 onClick={() => setShowExplainer(v => !v)}
 style={{
 flexShrink: 0,
 width: 14,
 height: 14,
 display: 'inline-flex',
 alignItems: 'center',
 justifyContent: 'center',
 border: '1px solid rgba(208,176,102,0.2)',
 borderRadius: '2px',
 background: 'transparent',
 color: 'var(--color-sand-400)',
 fontSize: 9,
 fontFamily: 'var(--font-sans)',
 fontWeight: 600,
 cursor: 'pointer',
 padding: 0,
 lineHeight: 1,
 }}
 >
 ?
 </button>
 )}
 </div>
 )}

 {enabled && showExplainer && explainerContent && (
 <div
 style={{
 width: '100%',
 maxWidth: 380,
 background: 'rgba(14,13,11,0.97)',
 border: '1px solid rgba(208,176,102,0.18)',
 borderRadius: '2px',
 padding: '14px 16px',
 marginTop: 4,
 }}
 >
 {/* Header */}
 <div
 style={{
 display: 'flex',
 alignItems: 'baseline',
 justifyContent: 'space-between',
 gap: 8,
 marginBottom: 8,
 }}
 >
 <span
 style={{
 fontFamily: 'var(--font-sans)',
 fontWeight: 600,
 fontSize: 11,
 letterSpacing: '0.1em',
 textTransform: 'uppercase',
 color: 'var(--color-accent)',
 }}
 >
 {explainerContent.metric}
 </span>
 <span
 style={{
 fontFamily: 'var(--font-mono, monospace)',
 fontSize: 13,
 color: 'var(--color-text-primary)',
 letterSpacing: '0.02em',
 }}
 >
 {value}
 </span>
 </div>

 {/* Full name */}
 <div
 style={{
 fontFamily: 'var(--font-sans)',
 fontSize: 10,
 color: 'var(--color-sand-400)',
 marginBottom: 8,
 letterSpacing: '0.03em',
 }}
 >
 {explainerContent.fullName}
 </div>

 {/* One-liner */}
 <div
 style={{
 fontFamily: 'var(--font-sans)',
 fontSize: 13,
 color: 'var(--color-text-primary)',
 lineHeight: 1.45,
 marginBottom: 8,
 }}
 >
 {explainerContent.oneLiner}
 </div>

 {/* Why */}
 <div
 style={{
 fontFamily: 'var(--font-sans)',
 fontSize: 12,
 color: 'var(--color-sand-400)',
 lineHeight: 1.5,
 marginBottom: 10,
 }}
 >
 {explainerContent.why}
 </div>

 {/* Target range chip */}
 <div
 style={{
 display: 'inline-block',
 border: '1px solid rgba(208,176,102,0.35)',
 borderRadius: '2px',
 padding: '3px 7px',
 marginBottom: violation ? 10 : 0,
 }}
 >
 <span
 style={{
 fontFamily: 'var(--font-sans)',
 fontSize: 10,
 color: 'var(--color-sand-400)',
 letterSpacing: '0.03em',
 }}
 >
 {explainerContent.range}
 </span>
 </div>

 {/* Violation guidance */}
 {violation && (
 <div
 style={{
 background: 'rgba(220,80,60,0.06)',
 border: '1px solid rgba(220,80,60,0.3)',
 borderRadius: '2px',
 padding: '8px 10px',
 marginTop: 10,
 marginBottom: explainerContent.proTip ? 8 : 0,
 }}
 >
 <div
 style={{
 fontFamily: 'var(--font-sans)',
 fontSize: 10,
 fontWeight: 600,
 letterSpacing: '0.08em',
 textTransform: 'uppercase',
 color: 'rgba(220,80,60,0.9)',
 marginBottom: 4,
 }}
 >
 Out of tolerance
 </div>
 <div
 style={{
 fontFamily: 'var(--font-sans)',
 fontSize: 11,
 color: 'var(--color-text-primary)',
 lineHeight: 1.5,
 marginBottom: 4,
 }}
 >
 ↑ {explainerContent.tooHigh}
 </div>
 <div
 style={{
 fontFamily: 'var(--font-sans)',
 fontSize: 11,
 color: 'var(--color-text-primary)',
 lineHeight: 1.5,
 }}
 >
 ↓ {explainerContent.tooLow}
 </div>
 </div>
 )}

 {/* Pro tip */}
 {explainerContent.proTip && (
 <div
 style={{
 fontFamily: 'var(--font-sans)',
 fontStyle: 'italic',
 fontSize: 11,
 color: 'var(--color-sand-400)',
 lineHeight: 1.5,
 marginTop: 8,
 }}
 >
 <span
 style={{
 fontStyle: 'normal',
 color: 'var(--color-accent)',
 fontWeight: 600,
 marginRight: 4,
 }}
 >
 Pro tip:
 </span>
 {explainerContent.proTip}
 </div>
 )}

 {/* Standard footnote */}
 {explainerContent.standard && (
 <div
 style={{
 fontFamily: 'var(--font-sans)',
 fontSize: 9,
 color: 'var(--color-sand-400)',
 letterSpacing: '0.05em',
 marginTop: 8,
 opacity: 0.7,
 }}
 >
 {explainerContent.standard}
 </div>
 )}
 </div>
 )}
 </header>
 )
}
