import React from 'react'

interface Band {
 name: string
 freq_range: string
 correlation: number
}

interface Props {
 bandsA: Band[]
 bandsB?: Band[]
 labelA: string
 labelB?: string
}

function corrColor(c: number): string {
 if (c < 0) return '#c96765' // out of phase
 if (c < 0.3) return '#d0b066' // ambiguous
 if (c < 0.7) return '#b5afa4' // decorrelated (wide)
 return '#6fa37e' // mono-compatible
}

function corrLabel(c: number): string {
 if (c < 0) return 'Out of phase'
 if (c < 0.3) return 'Wide'
 if (c < 0.7) return 'Stereo'
 if (c < 0.95) return 'Correlated'
 return 'Near-mono'
}

function corrFix(bandName: string, c: number): string {
 if (c >= 0.7) return ''
 if (c < 0) {
 if (bandName === 'Sub' || bandName === 'Bass') {
 return 'Sub/bass is OUT OF PHASE — bass will vanish on phone speakers. Polarity-check your bass tracks and any stereo widening below 120 Hz.'
 }
 return 'Out of phase — check polarity or excessive side-channel processing in this range.'
 }
 if (bandName === 'Sub' || bandName === 'Bass') {
 if (c < 0.3) return 'Sub is dangerously wide. Mono-ise below 120 Hz before streaming.'
 return 'Low end is wider than ideal — narrow stereo below 150 Hz.'
 }
 if (bandName === 'Low Mid' && c < 0.3) return 'Low-mids running wide — vocal body and instrument fundamentals may smear in mono.'
 if (bandName === 'Mid' && c < 0.4) return 'Mids are wide — check stereo doublers / widener on lead vocal.'
 return ''
}

// Weighted "mono safety" score 0-100. Low bands weighted heavier because
// that's where cancellation actually damages the listening experience.
function overallScore(bands: Band[]): number {
 const weights: Record<string, number> = {
 'Sub': 5, 'Bass': 4, 'Low Mid': 3, 'Mid': 2.5, 'Upper': 1.5, 'Air': 0.8,
 }
 let sumW = 0, sum = 0
 for (const b of bands) {
 const w = weights[b.name] ?? 1
 sumW += w
 // Correlation -1..1 → 0..100. Clamp negative to 0 heavily penalised.
 const norm = Math.max(0, (b.correlation + 0.2) / 1.2)
 sum += Math.min(1, norm) * w
 }
 return sumW > 0 ? Math.round((sum / sumW) * 100) : 0
}

function scoreColor(s: number): string {
 if (s >= 75) return '#6fa37e'
 if (s >= 50) return '#d0b066'
 return '#c96765'
}

function scoreLabel(s: number): string {
 if (s >= 85) return 'Mono-safe'
 if (s >= 70) return 'Mostly safe'
 if (s >= 50) return 'Check on phone'
 if (s >= 30) return 'Phase issues'
 return 'Serious cancellation'
}

export default function PhaseBandsPanel({ bandsA, bandsB, labelA, labelB }: Props) {
 if (!bandsA || bandsA.length === 0) return null

 const scoreA = overallScore(bandsA)
 const scoreB = bandsB ? overallScore(bandsB) : null

 return (
 <div className="bg-dark-900 rounded-2xl p-6 border border-dark-700/50 space-y-4">
 <div className="flex items-start justify-between gap-4">
 <div className="space-y-1 flex-1">
 <h2 className="text-lg font-semibold">Phase Correlation — Per Band</h2>
 <p className="text-xs text-dark-400">
 +1 = mono-compatible · 0 = wide stereo · −1 = cancels in mono. Sub and Bass bands matter most — that's where mono cancellation is audible.
 </p>
 </div>
 <div className="flex gap-2">
 <ScoreCard label={labelA} score={scoreA} />
 {scoreB !== null && labelB && <ScoreCard label={labelB} score={scoreB} />}
 </div>
 </div>

 <div className="bg-dark-800/40 rounded-xl p-3 space-y-1">
 <div className="flex items-center text-[10px] text-dark-500 px-2 pb-1 border-b border-dark-700/30">
 <span className="flex-1">Band</span>
 <span className="w-20 text-center">{labelA}</span>
 {bandsB && <span className="w-20 text-center">{labelB}</span>}
 <span className="w-24 text-center">Verdict</span>
 <span className="flex-[2] pl-3">What it means / fix</span>
 </div>
 {bandsA.map((band, i) => {
 const b = bandsB?.[i]
 const shown = b ? b.correlation : band.correlation
 const verdict = corrLabel(shown)
 const verdictColor = corrColor(shown)
 const fix = corrFix(band.name, shown)
 return (
 <div key={band.name} className="flex items-start px-2 py-1.5 rounded row-hover">
 <div className="flex-1">
 <span className="text-[12px] font-medium text-dark-200">{band.name}</span>
 <span className="text-[9px] text-dark-500 font-mono ml-2">{band.freq_range}</span>
 </div>
 <span className="w-20 text-center font-mono text-[11px]" style={{ color: corrColor(band.correlation) }}>
 {band.correlation.toFixed(2)}
 </span>
 {b && (
 <span className="w-20 text-center font-mono text-[11px]" style={{ color: corrColor(b.correlation) }}>
 {b.correlation.toFixed(2)}
 </span>
 )}
 <span className="w-24 text-center text-[10px]" style={{ color: verdictColor }}>
 {verdict}
 </span>
 <span className="flex-[2] pl-3 text-[10px]" style={{ color: fix ? '#d0b066' : '#57534e' }}>
 {fix || '—'}
 </span>
 </div>
 )
 })}
 </div>
 </div>
 )
}

function ScoreCard({ label, score }: { label: string; score: number }) {
 const color = scoreColor(score)
 return (
 <div className="rounded-lg px-3 py-2 text-center min-w-[110px]" style={{ backgroundColor: 'rgba(42,41,39,0.45)', border: `1px solid ${color}40` }}>
 <div className="text-[9px] uppercase tracking-[0.12em]" style={{ color: '#8d867b' }}>{label}</div>
 <div className="flex items-baseline justify-center gap-1">
 <span className="text-2xl font-semibold font-mono" style={{ color }}>{score}</span>
 <span className="text-[10px] text-dark-500">/100</span>
 </div>
 <div className="text-[9px]" style={{ color }}>{scoreLabel(score)}</div>
 </div>
 )
}
