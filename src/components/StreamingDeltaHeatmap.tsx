import React, { useMemo } from 'react'

/**
 * Streaming Delta Heatmap — shows where each DSP's limiter engages on
 * the timeline of the 30-second preview window. Red bars = limiter
 * pulling signal down; quiet = no engagement.
 *
 * Why it's a moat: everyone reports "played loudness" as one number.
 * Nobody (Ozone, Insight, LEVELS, Reference 4) shows you WHERE the
 * limiter fires. Engineers can now see that Apple's limiter is eating
 * the drop on the chorus but leaves the verses alone — actionable
 * information that tells them exactly which passage to retune.
 */

interface Props {
 /** DSP display name for the row label. */
 dsp: string
 /** Per-block gain-reduction envelope from the Sound Check twin.
 * Values ≤ 0 dB; 0 = limiter idle, -3 = 3 dB pulled down. */
 envelope: number[]
 /** Block step in ms — used to label the time axis. */
 stepMs: number
 /** Full window duration in seconds. */
 windowSec: number
 /** Worst GR dB across the window, used to colour-scale the row. */
 worstGrDb: number
 /** Short-form: filename / label for context. */
 trackLabel?: string
 /** Optional click handler — parent wires to the Sound Check twin
 * play button, e.g. "jump to this block on the timeline". */
 onClickBlock?: (blockIdx: number) => void
}

export default function StreamingDeltaHeatmap({
 dsp, envelope, stepMs, windowSec, worstGrDb, trackLabel, onClickBlock,
}: Props) {
 // Filter out empty envelopes so the panel doesn't render a
 // meaningless strip for silent previews.
 const hasData = Array.isArray(envelope) && envelope.length > 0
 // Worst GR drives colour intensity. If the limiter never engaged
 // beyond 0.3 dB we mark it "clean"; otherwise we scale red intensity
 // 0..1 against the worst reduction we observed (clamped to -6 dB so
 // the visualisation doesn't collapse to a wall of crimson on
 // wildly-hot masters).
 const grMax = useMemo(() => Math.max(0.5, Math.min(6, Math.abs(worstGrDb))), [worstGrDb])

 const secondsPerBlock = stepMs / 1000

 return (
 <div className="overflow-hidden" style={{ borderRadius: '2px', backgroundColor: 'rgba(14,13,11,0.6)', border: '1px solid rgba(168,161,150,0.08)' }}>
 <div className="flex items-center justify-between px-3 py-1.5 text-[9px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-muted)', borderBottom: '1px solid rgba(168,161,150,0.06)' }}>
 <span>{dsp} limiter · where it engaged</span>
 <span className="font-mono" style={{ color: worstGrDb < -1 ? 'var(--color-danger)' : worstGrDb < -0.3 ? 'var(--color-accent)' : 'var(--color-data-pass)' }}>
 {worstGrDb < -0.3 ? `worst ${worstGrDb.toFixed(1)} dB` : 'clean'}
 </span>
 </div>
 {!hasData ? (
 <p className="text-[10px] font-display italic px-3 py-2" style={{ color: 'var(--color-text-muted)' }}>
 Play the Sound Check twin (≋) first — the heatmap draws from the limiter's gain-reduction envelope.
 </p>
 ) : (
 <div className="relative h-7" style={{ backgroundColor: 'rgba(30,28,24,0.35)' }}>
 <div className="absolute inset-0 flex">
 {envelope.map((grDb, i) => {
 const reduction = Math.max(0, Math.min(grMax, -grDb)) // 0 = idle
 const intensity = grMax > 0 ? reduction / grMax : 0
 // Transparent when idle, red when hot.
 const bg = intensity <= 0.02
 ? 'rgba(110,197,119,0.04)' // faint green = idle
 : `rgba(224,90,90,${0.15 + intensity * 0.65})`
 const tooltip = `${(i * secondsPerBlock).toFixed(1)}s · ${grDb.toFixed(1)} dB gain reduction (limiter pull-down)`
 return (
 <div
 key={i}
 className="flex-1 cursor-default"
 style={{ backgroundColor: bg }}
 title={tooltip}
 onClick={() => onClickBlock?.(i)}
 />
 )
 })}
 </div>
 {/* Axis ticks every 5 s */}
 <div className="absolute inset-0 pointer-events-none">
 {Array.from({ length: Math.floor(windowSec / 5) + 1 }).map((_, ti) => {
 const sec = ti * 5
 const pct = windowSec > 0 ? (sec / windowSec) * 100 : 0
 return (
 <div
 key={ti}
 className="absolute top-0 bottom-0"
 style={{ left: `${pct}%`, width: 1, backgroundColor: 'rgba(168,161,150,0.15)' }}
 />
 )
 })}
 </div>
 </div>
 )}
 {hasData && (
 <div className="flex items-center justify-between px-3 py-1 text-[9px]" style={{ color: 'var(--color-text-muted)' }}>
 <span>0 s</span>
 <span>{(windowSec / 2).toFixed(0)} s</span>
 <span>{windowSec.toFixed(0)} s</span>
 </div>
 )}
 </div>
 )
}
