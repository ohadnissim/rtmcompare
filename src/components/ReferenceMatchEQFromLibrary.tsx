import React, { useMemo, useState } from 'react'
import { ReferenceRecord } from '../types'
import { useEQ, EQBand } from '../EQContext'
import { proposeMatchFromSpectra, REFERENCE_MATCH_FREQS } from '../spectrumMatch'
import ReferenceLibrary from './ReferenceLibrary'

/**
 * Reference Match EQ — pick a reference from the library, RTM generates
 * the parametric EQ moves that transform the current track's spectrum
 * into the reference's, then auditions them live through the main A/B
 * player.
 *
 * Competitive frame:
 * • iZotope Ozone Master-Match: $249, burns moves into a plugin
 * chain, requires you to render / re-EQ outside the comparator.
 * • Reference 4: shows the diff, doesn't propose moves.
 * • This: moves land in the shared EQContext. Main A/B player audits
 * them live (biquad bank updates in real time), no plugin, no bounce.
 */

interface Props {
 /** 31-band 1/3-octave spectrum of the currently-loaded track.
 * Must be the SAME shape the library computes (python/reference_quickscan)
 * so the two curves stack correctly. */
 currentSpectrum: number[] | null | undefined
 /** Display name of the current track — shown on the curve legend. */
 currentLabel?: string
}

export default function ReferenceMatchEQFromLibrary({ currentSpectrum, currentLabel }: Props) {
 const eq = useEQ()
 const [libraryOpen, setLibraryOpen] = useState(false)
 const [picked, setPicked] = useState<ReferenceRecord | null>(null)

 const proposal = useMemo(() => {
 if (!picked?.spectrum || !currentSpectrum) return null
 return proposeMatchFromSpectra(currentSpectrum, picked.spectrum)
 }, [picked, currentSpectrum])

 const applyToEQ = () => {
 if (!proposal) return
 eq.setBands(proposal.bands)
 eq.setEnabled(true)
 eq.setAmount(1)
 // Push the reference curve into the context so the main A/B player
 // overlays it above the waveform while the engineer scrubs. No
 // panel switch, no memory tax.
 if (picked?.spectrum) {
 eq.setReferenceCurve(picked.spectrum, picked.filename)
 }
 }

 // Empty state — no spectrum on the current track means we can't match.
 if (!currentSpectrum || currentSpectrum.length === 0) {
 return (
 <div
 className="p-4 text-[11px]"
 style={{
 backgroundColor: 'rgba(30,28,24,0.5)',
 border: '1px solid rgba(168,161,150,0.08)',
 color: '#7a7164',
 }}
 >
 Reference Match EQ needs a 31-band spectrum for the current track.
 Run a Deep Scan (Compare or Single-file mode) to unlock this.
 </div>
 )
 }

 return (
 <div
 className="p-4 space-y-3"
 style={{
 backgroundColor: 'rgba(30,28,24,0.5)',
 border: '1px solid rgba(168,161,150,0.1)',
 }}
 >
 <div className="flex items-center justify-between gap-3 flex-wrap">
 <div>
 <h3 className="text-sm font-semibold" style={{ color: '#ebe7e0' }}>
 Reference Match EQ
 </h3>
 <p className="text-[10px] mt-0.5" style={{ color: '#7a7164' }}>
 Pick a reference from your library — RTM proposes EQ moves to match its tonal balance,
 auditions them live through the main player.
 </p>
 </div>
 <button
 onClick={() => setLibraryOpen(true)}
 className="text-[11px] px-3 py-1.5"
 style={{
 color: '#d0b066',
 border: '1px solid rgba(208,176,102,0.35)',
 backgroundColor: 'rgba(208,176,102,0.06)',
 }}
 >
 {picked ? `Reference: ${picked.filename}` : 'Pick reference from library'}
 </button>
 </div>

 {picked && !proposal && (
 <div className="text-[11px]" style={{ color: '#c96765' }}>
 Selected reference has no spectrum (probably pre-library-format). Delete and re-add it.
 </div>
 )}

 {proposal && (
 <div className="space-y-3">
 {/* Before/after match visual */}
 <MatchCurves
 source={proposal.sourceCurve}
 reference={proposal.referenceCurve}
 predicted={proposal.predictedCurve}
 currentLabel={currentLabel || 'Current'}
 referenceLabel={picked?.filename || 'Reference'}
 />

 {/* Score + action row */}
 <div className="flex items-center justify-between gap-3 flex-wrap">
 <div className="flex items-baseline gap-3 text-[11px]" style={{ color: '#a8a29e' }}>
 <span>
 Match score:
 <span
 className="ml-1.5 font-mono font-medium"
 style={{
 color: proposal.matchScore >= 80 ? '#6ec577'
 : proposal.matchScore >= 55 ? '#d0b066'
 : '#e07a4f',
 }}
 >
 {proposal.matchScore}
 </span>
 </span>
 <span className="text-[10px]" style={{ color: '#7a7164' }}>
 gap closed {(proposal.rmsBefore - proposal.rmsAfter).toFixed(1)} dB RMS
 ({proposal.rmsBefore.toFixed(1)} → {proposal.rmsAfter.toFixed(1)})
 </span>
 </div>
 <div className="flex items-center gap-2">
 <button
 onClick={applyToEQ}
 className="text-[11px] px-3 py-1"
 style={{ backgroundColor: '#d0b066', color: '#0e0d0b' }}
 title="Load these bands into the EQ bank and engage it in the main A/B player"
 >
 Apply & audition
 </button>
 <button
 onClick={() => { eq.clear(); setPicked(null) }}
 className="text-[11px] px-3 py-1"
 style={{ color: '#8d867b', border: '1px solid rgba(168,161,150,0.2)' }}
 >
 Clear
 </button>
 </div>
 </div>

 {/* Proposed bands table */}
 <BandsTable bands={proposal.bands} />
 </div>
 )}

 <ReferenceLibrary
 open={libraryOpen}
 onClose={() => setLibraryOpen(false)}
 onPick={(info) => {
 // onPick only gives us FileInfo; re-resolve to the full record
 // via referencesList so we get the spectrum. Cheap: list is
 // already in memory once the modal loaded it.
 if (window.electronAPI?.referencesList) {
 window.electronAPI.referencesList().then(list => {
 const rec = list.find(r => r.path === info.path) || null
 setPicked(rec)
 setLibraryOpen(false)
 })
 } else {
 setLibraryOpen(false)
 }
 }}
 title="Pick a reference to match"
 />
 </div>
 )
}

function MatchCurves({ source, reference, predicted, currentLabel, referenceLabel }: {
 source: number[]
 reference: number[]
 predicted: number[]
 currentLabel: string
 referenceLabel: string
}) {
 const w = 600, h = 140, pad = { t: 10, r: 6, b: 16, l: 28 }
 const n = Math.min(source.length, reference.length, REFERENCE_MATCH_FREQS.length)
 const bands = REFERENCE_MATCH_FREQS.slice(0, n)
 // Normalised curves already peak at 0; range -60..0 covers them.
 const yMin = -42, yMax = 4
 const toX = (i: number) => pad.l + (i / Math.max(1, n - 1)) * (w - pad.l - pad.r)
 const toY = (v: number) => {
 const clamped = Math.max(yMin, Math.min(yMax, v))
 return pad.t + (1 - (clamped - yMin) / (yMax - yMin)) * (h - pad.t - pad.b)
 }
 const path = (series: number[]) => {
 if (series.length < 2) return ''
 let d = `M ${toX(0).toFixed(1)} ${toY(series[0]).toFixed(1)}`
 for (let i = 1; i < n; i++) {
 const prevX = toX(i - 1), prevY = toY(series[i - 1])
 const x = toX(i), y = toY(series[i])
 const cx = (prevX + x) / 2
 d += ` C ${cx.toFixed(1)} ${prevY.toFixed(1)}, ${cx.toFixed(1)} ${y.toFixed(1)}, ${x.toFixed(1)} ${y.toFixed(1)}`
 }
 return d
 }
 const freqLabels = [20, 100, 1000, 10000, 20000]

 return (
 <div className="overflow-hidden" style={{ backgroundColor: 'rgba(14,13,11,0.7)' }}>
 <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="xMidYMid meet" style={{ height: 140 }}>
 {/* Grid */}
 {[-30, -20, -10, 0].map(db => (
 <line
 key={db}
 x1={pad.l} y1={toY(db)} x2={w - pad.r} y2={toY(db)}
 stroke="#2a2927" strokeWidth="0.5" strokeDasharray="2 3"
 />
 ))}
 {[-30, -20, -10, 0].map(db => (
 <text key={`l-${db}`} x={pad.l - 4} y={toY(db) + 3} fontSize="8" fill="#57534e" textAnchor="end">{db}</text>
 ))}
 {freqLabels.map(f => {
 const idx = bands.findIndex(b => b >= f)
 if (idx < 0) return null
 return (
 <text
 key={f}
 x={toX(idx)} y={h - 4}
 fontSize="8" fill="#57534e" textAnchor="middle"
 >
 {f >= 1000 ? `${f / 1000}k` : f}
 </text>
 )
 })}

 {/* Source (current track) — dusky blue */}
 <path d={path(source)} fill="none" stroke="#6b8cbb" strokeWidth="1.2" opacity="0.8" />
 {/* Reference — gold */}
 <path d={path(reference)} fill="none" stroke="#d0b066" strokeWidth="1.5" />
 {/* Predicted after EQ — teal dashed */}
 <path d={path(predicted)} fill="none" stroke="#7ca4a3" strokeWidth="1.4" strokeDasharray="4 2" />
 </svg>
 {/* Legend */}
 <div className="flex items-center gap-4 px-3 py-1.5 text-[9px]" style={{ color: '#8d867b', borderTop: '1px solid rgba(168,161,150,0.08)' }}>
 <span className="flex items-center gap-1.5">
 <span className="w-3 h-px" style={{ backgroundColor: '#6b8cbb' }} />
 {currentLabel}
 </span>
 <span className="flex items-center gap-1.5">
 <span className="w-3 h-px" style={{ backgroundColor: '#d0b066' }} />
 Reference · {referenceLabel}
 </span>
 <span className="flex items-center gap-1.5">
 <span className="w-3 h-px border-t border-dashed" style={{ borderColor: '#7ca4a3' }} />
 Predicted after EQ
 </span>
 </div>
 </div>
 )
}

function BandsTable({ bands }: { bands: EQBand[] }) {
 if (bands.length === 0) {
 return (
 <div className="text-[11px]" style={{ color: '#6ec577' }}>
 ✓ Already close to the reference — no meaningful moves proposed.
 </div>
 )
 }
 return (
 <div className="overflow-hidden" style={{ border: '1px solid rgba(168,161,150,0.08)' }}>
 <div className="flex items-center px-3 py-1.5 text-[9px] uppercase tracking-[0.12em]" style={{ color: '#7a7164', backgroundColor: 'rgba(14,13,11,0.4)' }}>
 <span className="w-16">Freq</span>
 <span className="w-14 text-right">Gain</span>
 <span className="w-12 text-right">Q</span>
 <span className="flex-1 pl-4">Move</span>
 </div>
 {bands.map(b => (
 <div key={b.id} className="flex items-center px-3 py-1.5 text-[11px] font-mono" style={{ color: '#a8a29e', borderTop: '1px solid rgba(168,161,150,0.05)' }}>
 <span className="w-16">{b.freq >= 1000 ? `${(b.freq / 1000).toFixed(b.freq % 1000 === 0 ? 0 : 1)}k` : b.freq}</span>
 <span
 className="w-14 text-right"
 style={{ color: b.gain_db > 0 ? '#6ec577' : '#e07a4f' }}
 >
 {b.gain_db > 0 ? '+' : ''}{b.gain_db.toFixed(1)} dB
 </span>
 <span className="w-12 text-right">{b.q.toFixed(1)}</span>
 <span className="flex-1 pl-4 text-[10px]" style={{ color: '#8d867b' }}>{b.label || ''}</span>
 </div>
 ))}
 </div>
 )
}
