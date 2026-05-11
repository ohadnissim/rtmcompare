import React from 'react'
import { Verdict } from '../singleFileHelpers'

/**
 * Top-of-view pass/fail block — the "is this track going to cause a problem
 * at delivery?" answer the GM / Delivery Ops asked for, mapped to each DSP's
 * spec. Colour-coded left rail matches the Client Report PDF verdict so the
 * on-screen and export surfaces read as one voice.
 */
export default function ReadyToDeliverVerdict({ verdict, compact, showDspGrid }: { verdict: Verdict; compact?: boolean; showDspGrid?: boolean }) {
 const palette = {
 ready: { accent: '#6ec577', bg: 'rgba(110,197,119,0.08)', tag: 'READY' },
 warn: { accent: '#c5a55a', bg: 'rgba(197,165,90,0.08)', tag: 'WARN' },
 hold: { accent: '#e05a5a', bg: 'rgba(224,90,90,0.08)', tag: 'HOLD' },
 }[verdict.level]

 return (
 <div
 style={{
 backgroundColor: palette.bg,
 borderLeft: `3px solid ${palette.accent}`,
 borderRadius: 'var(--radius-card)',
 padding: compact ? '10pt 14pt' : '14pt 18pt',
 }}
 >
 <div className="flex items-center gap-3 flex-wrap">
 {/* 5.2.0 (audit P2-22): the SaaS-pill verdict tag was the same
 vocabulary as Stripe/Linear/Notion — generic. Replaced with a
 hairline + tracked small-caps + a 4×4 px gold diamond when the
 status is READY (single gold gesture per view per Console-
 Didone philosophy: "the gold is a promise kept sparingly"). */}
 <span
 className="text-[9px] font-semibold tracking-[0.18em] uppercase inline-flex items-center gap-2 px-2 py-1"
 style={{
 color: palette.accent,
 borderTop: `1px solid ${palette.accent}`,
 borderBottom: `1px solid ${palette.accent}`,
 letterSpacing: '0.22em',
 }}
 >
 {verdict.level === 'ready' && (
 <span
 aria-hidden
 style={{
 display: 'inline-block',
 width: 4,
 height: 4,
 backgroundColor: '#d0b066',
 transform: 'rotate(45deg)',
 }}
 />
 )}
 {palette.tag}
 </span>
 <span
 className="font-medium"
 style={{
 color: '#ebe7e0',
 fontSize: compact ? 15 : 18,
 letterSpacing: 0.005,
 lineHeight: 1.3,
 }}
 >
 {verdict.title}
 </span>
 {/* Mono-compat badge — single number in the verdict row replaces
 the dedicated Mono Compat heatmap panel. Green < 10% loss,
 gold 10-30%, red > 30% (bluetooth / phone-speaker damage). */}
 {verdict.monoLossPct != null && (
 <span
 className="text-[9px] tracking-[0.12em] uppercase px-2 py-0.5"
 style={{
 borderRadius: '2px',
 color: verdict.monoLossPct > 30 ? '#e05a5a' : verdict.monoLossPct > 10 ? '#c5a55a' : '#6ec577',
 backgroundColor: verdict.monoLossPct > 30 ? 'rgba(224,90,90,0.12)' : verdict.monoLossPct > 10 ? 'rgba(197,165,90,0.12)' : 'rgba(110,197,119,0.12)',
 }}
 title={`Mono compatibility — ${verdict.monoLossPct.toFixed(0)}% energy loss when collapsed to mono. Press M in the player to hear it.`}
 >
 Mono −{verdict.monoLossPct.toFixed(0)}%
 </span>
 )}
 </div>

 {verdict.reasons.length > 0 && (
 <ul className="mt-2 space-y-0.5 text-[11px]" style={{ color: '#b5afa4' }}>
 {verdict.reasons.slice(0, compact ? 3 : 6).map((r, i) => (
 <li key={i}><span style={{ color: palette.accent }}>·</span> {r}</li>
 ))}
 </ul>
 )}

 {/* Action line — the "what do I DO" the 
 Renders below the reasons so the user reads the diagnosis
 first, then the concrete next step. Only skipped when there
 isn't one (older cached verdicts from before this field). */}
 {verdict.action && (
 <div
 className="mt-3 pt-2.5 flex items-baseline gap-2"
 style={{ borderTop: `1px solid ${palette.accent}33` }}
 >
 <span
 className="text-[9px] uppercase tracking-[0.18em] flex-shrink-0"
 style={{ color: palette.accent, opacity: 0.85 }}
 >
 Next
 </span>
 <span
 className="text-[12px] leading-snug"
 style={{ color: '#ebe7e0', fontWeight: 500 }}
 >
 {verdict.action}
 </span>
 </div>
 )}

 {/* 5.2.4: removed the duplicate Stripe-style "Ship it / Revise / Hold"
 pill that lived here. The editorial hairline + tracked-caps tag
 at the top of this card already carries the verdict; the pill was
 a regression of audit P2-22 ("Verdict tag is a generic SaaS chip,
 not a colophon mark") that crept back in after the original fix.
 The platforms-checked count moves down into the per-platform
 grid header where it belongs. */}

 {/* Per-DSP pass/fail grid — hidden by default, surfaced under
 the "Compliance view" toggle.
 Each row shows the target DSP, measured playback level, and
 the level delta the DSP will apply. */}
 {showDspGrid && verdict.dsp.length > 0 && (
 <div className="mt-3 pt-3 overflow-hidden" style={{ borderRadius: '2px', borderTop: `1px solid ${palette.accent}22` }}>
 <div className="flex items-baseline justify-between mb-2">
 <span className="text-[9px] uppercase tracking-[0.15em]" style={{ color: palette.accent }}>
 Per-platform compliance
 </span>
 <span className="text-[9px]" style={{ color: '#7a7164' }}>
 {verdict.dsp.length} platform{verdict.dsp.length === 1 ? '' : 's'} checked
 </span>
 </div>
 <div style={{ border: '1px solid rgba(168,161,150,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
 {verdict.dsp.map((d, i) => (
 <div
 key={d.name}
 className="flex items-center px-3 py-1.5 text-[11px]"
 style={{
 borderTop: i === 0 ? 'none' : '1px solid rgba(168,161,150,0.08)',
 backgroundColor: d.pass ? 'rgba(110,197,119,0.04)' : 'rgba(224,90,90,0.04)',
 }}
 >
 <span
 className="w-16 text-[9px] uppercase tracking-[0.12em]"
 style={{ color: d.pass ? '#6ec577' : '#e05a5a' }}
 >
 {d.pass ? '✓ Pass' : '✕ Fail'}
 </span>
 <span className="w-32 font-medium" style={{ color: '#ebe7e0' }}>{d.name}</span>
 <span className="flex-1 font-mono text-[10px]" style={{ color: '#a8a29e' }}>{d.detail}</span>
 </div>
 ))}
 </div>
 </div>
 )}

 {/* Per-DSP pass/fail grid was here; removed at user's request —
 "not a fan of that alert system." The Streaming Normalization
 Preview panel below (with a ▶ play button per platform, same
 pattern as Compare mode) is the proper detail surface. */}
 </div>
 )
}
