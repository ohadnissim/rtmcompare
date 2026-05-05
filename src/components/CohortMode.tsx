import React, { useMemo, useState } from 'react'
import { BatchResult } from '../types'

interface Props {
 rows: BatchResult[]
 /** The reference the cohort is measured against. Can be:
 * - a file dropped into the reference slot → analysed on the fly
 * - a row from `rows` (a pin the instructor / ops team elects as the ref)
 * - null → cohort mode is disabled. */
 reference: BatchResult | null
 /** Called when the user picks a row from the table to promote as reference. */
 onPickReference: (row: BatchResult | null) => void
 /** Called when the user wants to load a file as the reference (outside the batch). */
 onLoadRefFile?: () => void | Promise<void>
}

/**
 * 31-band ISO centre frequencies — used for the heatmap x-axis labels.
 * Intentionally sparse labels (every 4th band) so the axis stays readable.
 */
const BAND_CENTRES = [
 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500,
 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300,
 8000, 10000, 12500, 16000, 20000,
] as const

function fmtFreq(f: number): string {
 if (f >= 1000) return `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)}k`
 return `${f}`
}

/**
 * Cohort Mode panel — Cohort-wide drift heatmap + per-track distance
 * column. Rendered ABOVE the main batch table when a reference is
 * picked. Pure presentation on top of batch data that already has
 * `spectrum` computed. No extra analysis needed.
 */
export default function CohortMode({ rows, reference, onPickReference, onLoadRefFile }: Props) {
 const [sort, setSort] = useState<'order' | 'distance'>('order')

 // Compute per-track spectral delta vs reference and a scalar "distance"
 // (RMS of the band-wise deltas). Missing spectra are treated as zero
 // distance so they don't pollute the heatmap.
 const deltas = useMemo(() => {
 const ref = reference?.spectrum
 if (!ref || ref.length !== 31) return null
 return rows.map(r => {
 if (!r.spectrum || r.spectrum.length !== 31) {
 return { row: r, delta: null as number[] | null, distance: null as number | null }
 }
 const delta = r.spectrum.map((v, i) => v - ref[i])
 // RMS distance in dB — single scalar summarising how far this track
 // sits from the reference across the full spectrum.
 const distance = Math.sqrt(delta.reduce((s, d) => s + d * d, 0) / delta.length)
 return { row: r, delta, distance }
 })
 }, [rows, reference])

 // Class-wide drift per band — how many tracks are hot (>+1.5 dB) and
 // how many are cold (<-1.5 dB) in each band. Feeds the text summary.
 const drift = useMemo(() => {
 if (!deltas) return null
 const hot = new Array(31).fill(0)
 const cold = new Array(31).fill(0)
 const mean = new Array(31).fill(0)
 let n = 0
 for (const d of deltas) {
 if (!d.delta) continue
 n++
 for (let i = 0; i < 31; i++) {
 mean[i] += d.delta[i]
 if (d.delta[i] > 1.5) hot[i]++
 else if (d.delta[i] < -1.5) cold[i]++
 }
 }
 if (n === 0) return null
 for (let i = 0; i < 31; i++) mean[i] = mean[i] / n
 return { hot, cold, mean, n }
 }, [deltas])

 const sortedDeltas = useMemo(() => {
 if (!deltas) return []
 if (sort === 'distance') {
 return [...deltas].sort((a, b) => (b.distance ?? -1) - (a.distance ?? -1))
 }
 return deltas
 }, [deltas, sort])

 // Cohort mode hides completely when there's no reference — user
 // complaint was "can't close it after it's opened." Clear Reference now
 // makes the whole section disappear; promote a row via `ref ↑` on the
 // table to bring it back.
 if (!reference) return null

 // ── Heatmap render ────────────────────────────────────────────────────
 return (
 <div className="rounded-xl p-5 space-y-4"
 style={{ backgroundColor: 'rgba(48,44,39,0.4)', border: '1px solid rgba(208,176,102,0.18)' }}>
 <div className="flex items-start justify-between gap-4 flex-wrap">
 <div className="min-w-0">
 <div className="text-[10px] tracking-[0.2em] uppercase mb-1" style={{ color: '#d0b066' }}>
 Cohort Mode · Reference
 </div>
 <div className="text-sm truncate" style={{ color: '#ebe7e0', maxWidth: '40ch' }} title={reference.path}>
 {reference.filename}
 </div>
 <div className="text-[10px] font-mono mt-0.5" style={{ color: '#7a7164' }}>
 {reference.lufs_i != null && <>{reference.lufs_i.toFixed(1)} LUFS · </>}
 {reference.true_peak_dbtp != null && <>{reference.true_peak_dbtp.toFixed(1)} dBTP · </>}
 {reference.lra != null && <>{reference.lra.toFixed(1)} LU · </>}
 {reference.sample_rate != null && <>{(reference.sample_rate / 1000).toFixed(reference.sample_rate % 1000 === 0 ? 0 : 1)}k Hz</>}
 </div>
 </div>
 <div className="flex items-center gap-3 text-[10px]">
 <button
 onClick={() => onPickReference(null)}
 className="uppercase tracking-[0.12em] transition-colors hover:text-sand-200"
 style={{ color: '#8d867b' }}
 >
 Clear reference
 </button>
 <span style={{ color: '#3e3a33' }}>·</span>
 <span className="uppercase tracking-[0.1em]" style={{ color: '#7a7164' }}>Sort</span>
 <button
 onClick={() => setSort(s => (s === 'order' ? 'distance' : 'order'))}
 className="uppercase tracking-[0.12em] transition-colors"
 style={{ color: '#d0b066' }}
 >
 {sort === 'order' ? 'track order' : 'by distance'}
 </button>
 </div>
 </div>

 {/* What-am-I-looking-at explainer (user ask). Kept concise — three
 bullets covering what Cohort Mode compares, how to read the
 heatmap, and what counts as "notable." Collapsible so it
 disappears once the user gets it. */}
 <CohortExplainer />

 {/* Drift heatmap */}
 {deltas && deltas.length > 0 && drift && (
 <DriftHeatmap deltas={sortedDeltas} />
 )}

 {/* Class-wide drift summary — plain sentences */}
 {drift && drift.n > 0 && (() => {
 // Find bands where >40% of cohort is hot or cold.
 const warnings: string[] = []
 for (let i = 0; i < 31; i++) {
 const hotPct = (drift.hot[i] / drift.n) * 100
 const coldPct = (drift.cold[i] / drift.n) * 100
 if (hotPct >= 40) {
 warnings.push(`${hotPct.toFixed(0)}% of the cohort is hot at ${fmtFreq(BAND_CENTRES[i])} Hz (mean ${drift.mean[i].toFixed(1)} dB above reference)`)
 } else if (coldPct >= 40) {
 warnings.push(`${coldPct.toFixed(0)}% of the cohort is dark at ${fmtFreq(BAND_CENTRES[i])} Hz (mean ${drift.mean[i].toFixed(1)} dB below reference)`)
 }
 }
 if (warnings.length === 0) return null
 return (
 <div className="space-y-0.5 pt-1 text-[11px]" style={{ color: '#b5afa4' }}>
 <div className="text-[10px] uppercase tracking-[0.12em] mb-1" style={{ color: '#d0b066' }}>
 Class-wide drift
 </div>
 {warnings.slice(0, 6).map((w, i) => (
 <div key={i}>
 <span style={{ color: '#e07a4f' }}>⚠</span> {w}.
 </div>
 ))}
 </div>
 )
 })()}
 </div>
 )
}

/**
 * Raw heatmap — one row per track, 31 columns. Cell colour is signed:
 * gold for hot (+dB vs ref), blue for dark (−dB vs ref), neutral for
 * matched. Labels: sparse x-axis (every 4th band), filename left.
 */
function DriftHeatmap({ deltas }: {
 deltas: { row: BatchResult; delta: number[] | null; distance: number | null }[]
}) {
 const withData = deltas.filter(d => d.delta != null)
 if (withData.length === 0) return null

 // Scale deltas to colour intensity — clamp to ±8 dB so one outlier
 // doesn't wash out the cohort.
 const colourFor = (d: number) => {
 const mag = Math.min(Math.abs(d) / 8, 1)
 if (d > 0) {
 // gold for hot
 const a = 0.15 + mag * 0.75
 return `rgba(208, 176, 102, ${a.toFixed(2)})`
 } else if (d < 0) {
 // slate-blue for dark
 const a = 0.15 + mag * 0.75
 return `rgba(107, 140, 187, ${a.toFixed(2)})`
 }
 return 'rgba(87,83,78,0.08)'
 }

 return (
 <div className="overflow-x-auto">
 <div className="min-w-[600px]">
 {/* X-axis (frequency) labels */}
 <div className="flex items-center gap-2 text-[9px] font-mono mb-1" style={{ color: '#7a7164' }}>
 <div className="w-[28ch] flex-shrink-0" />
 <div className="flex-1 grid" style={{ gridTemplateColumns: 'repeat(31, minmax(0, 1fr))' }}>
 {BAND_CENTRES.map((f, i) => (
 <div key={i} className="text-center" style={{ fontSize: 8, minWidth: 0 }}>
 {i % 4 === 0 ? fmtFreq(f) : ''}
 </div>
 ))}
 </div>
 <div className="w-[7ch] flex-shrink-0 text-right" style={{ color: '#d0b066' }}>RMS</div>
 </div>
 {/* Rows */}
 {withData.map((d, idx) => (
 <div
 key={d.row.path + idx}
 className="flex items-center gap-2 mb-0.5"
 title={`${d.row.filename}${d.distance != null ? ` · ${d.distance.toFixed(2)} dB RMS distance from reference` : ''}`}
 >
 <div
 className="w-[28ch] flex-shrink-0 text-[10px] truncate"
 style={{ color: '#a8a29e' }}
 title={d.row.filename}
 >
 {d.row.track_number ? <span className="font-mono" style={{ color: '#7a7164' }}>{d.row.track_number.padStart(2, '0')} </span> : null}
 {d.row.filename}
 </div>
 <div
 className="flex-1 grid"
 style={{
 gridTemplateColumns: 'repeat(31, minmax(0, 1fr))',
 border: '1px solid rgba(168,161,150,0.08)',
 borderRadius: 2,
 overflow: 'hidden',
 }}
 >
 {(d.delta || []).map((v, i) => (
 <div
 key={i}
 style={{
 backgroundColor: colourFor(v),
 height: 14,
 }}
 title={`${fmtFreq(BAND_CENTRES[i])} Hz · ${v > 0 ? '+' : ''}${v.toFixed(1)} dB vs reference`}
 />
 ))}
 </div>
 <div
 className="w-[7ch] flex-shrink-0 text-right text-[10px] font-mono tabular-nums"
 style={{ color: d.distance != null && d.distance > 3 ? '#e07a4f' : '#d0b066' }}
 >
 {d.distance != null ? d.distance.toFixed(1) : '—'}
 </div>
 </div>
 ))}
 {/* Legend */}
 <div className="flex items-center justify-end gap-4 mt-2 text-[9px] font-mono" style={{ color: '#7a7164' }}>
 <span className="inline-flex items-center gap-1">
 <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(107,140,187,0.9)' }} /> −8 dB
 </span>
 <span className="inline-flex items-center gap-1">
 <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(87,83,78,0.15)' }} /> match
 </span>
 <span className="inline-flex items-center gap-1">
 <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(208,176,102,0.9)' }} /> +8 dB
 </span>
 </div>
 </div>
 </div>
 )
}

/**
 * Inline explainer above the heatmap — answers the user's question ("what
 * am I looking at, what can I compare, what's meaningful"). Collapsible
 * (open first time, can be dismissed) so it doesn't become noise after
 * the first couple of sessions.
 */
function CohortExplainer() {
 const [open, setOpen] = React.useState<boolean>(() => {
 try { return localStorage.getItem('rtm-cohort-explainer-dismissed') !== '1' } catch { return true }
 })
 const dismiss = () => {
 setOpen(false)
 try { localStorage.setItem('rtm-cohort-explainer-dismissed', '1') } catch {}
 }
 if (!open) {
 return (
 <button
 onClick={() => setOpen(true)}
 className="text-[10px] uppercase tracking-[0.12em] transition-colors hover:text-sand-200"
 style={{ color: '#8d867b' }}
 >
 What is Cohort Mode?
 </button>
 )
 }
 return (
 <div className="rounded-lg px-4 py-3 text-[11px] space-y-2"
 style={{ backgroundColor: 'rgba(30,28,24,0.55)', border: '1px solid rgba(208,176,102,0.2)', color: '#b5afa4' }}>
 <div className="flex items-center justify-between">
 <span className="text-[10px] uppercase tracking-[0.2em]" style={{ color: '#d0b066' }}>What you're looking at</span>
 <button onClick={dismiss} className="text-[10px] uppercase tracking-[0.1em] transition-colors hover:text-sand-200" style={{ color: '#8d867b' }} title="Dismiss — you can reopen from the 'What is Cohort Mode?' link.">
 Got it
 </button>
 </div>
 <p>
 Cohort Mode measures every track in this batch against a <b style={{ color: '#d0b066' }}>reference</b> —
 either one you promote from the album (click <span className="font-mono">ref ↑</span> on any row) or a file
 you drop in. It answers <i>"does this album sit together, or are a few tracks drifting?"</i>
 </p>
 <ul className="space-y-1 pl-4 list-disc">
 <li><b style={{ color: '#ebe7e0' }}>Heatmap rows</b> — one per track. Each cell is one of 31 ISO frequency bands. <span style={{ color: '#d0b066' }}>Gold</span> = louder than reference in that band; <span style={{ color: '#6b8cbb' }}>blue</span> = quieter.</li>
 <li><b style={{ color: '#ebe7e0' }}>What's meaningful</b> — deltas inside ±1.5 dB are noise; ±3 dB is noticeable; ±6 dB and the track will stand out on the album.</li>
 <li><b style={{ color: '#ebe7e0' }}>RMS column</b> — a single number summarising total tonal distance from the reference. Sort by it to see which track strays the most.</li>
 <li><b style={{ color: '#ebe7e0' }}>Class-wide drift</b> — below the heatmap. Flags bands where most of the album pulls the same direction (often a mastering-bus curve choice worth double-checking).</li>
 </ul>
 </div>
 )
}
