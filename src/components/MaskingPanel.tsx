import React from 'react'

interface Overlap {
 pair: string
 freq_range: string
 severity: 'high' | 'medium' | 'low' | 'info'
 description: string
 level_a: number
 level_b: number
 tip: string
}

interface Props {
 masking: { overlaps: Overlap[]; stem_based: boolean }
}

const SEVERITY: Record<string, { color: string; bg: string; label: string }> = {
 high: { color: '#c96765', bg: 'rgba(201,103,101,0.10)', label: 'High' },
 medium: { color: '#d0b066', bg: 'rgba(208,176,102,0.10)', label: 'Medium' },
 low: { color: '#8a95ab', bg: 'rgba(138,149,171,0.10)', label: 'Low' },
 info: { color: '#8d867b', bg: 'rgba(141,134,123,0.08)', label: 'Info' },
}

export default function MaskingPanel({ masking }: Props) {
 if (!masking || !masking.overlaps || masking.overlaps.length === 0) {
 return (
 <div className="bg-dark-900 p-6 border border-dark-700/50">
 <h2 className="text-lg font-semibold mb-2">Masking Analysis</h2>
 <p className="text-xs text-dark-400">No significant masking detected — elements have clear frequency space.</p>
 </div>
 )
 }

 return (
 <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-4">
 <div className="flex items-center justify-between">
 <div className="space-y-1">
 <h2 className="text-lg font-semibold">Masking Analysis</h2>
 <p className="text-xs text-dark-400">
 {masking.stem_based
 ? 'Per-stem frequency overlap — where elements fight for the same band.'
 : 'Full-mix density — no stems available; running coarse band-balance check.'}
 </p>
 </div>
 {!masking.stem_based && (
 <span className="text-[10px] px-2 py-1 rounded-full" style={{ color: '#8d867b', border: '1px solid rgba(141,134,123,0.3)' }}>
 Run Deep Scan for per-stem analysis
 </span>
 )}
 </div>

 <div className="space-y-2">
 {masking.overlaps.map((o, i) => {
 const sev = SEVERITY[o.severity] || SEVERITY.info
 return (
 <div
 key={i}
 className="p-3 flex items-start gap-3"
 style={{ backgroundColor: sev.bg, border: `1px solid ${sev.color}30` }}
 >
 <div
 className="text-[9px] px-2 py-0.5 rounded-full mt-0.5 whitespace-nowrap"
 style={{ color: sev.color, border: `1px solid ${sev.color}60` }}
 >
 {sev.label}
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-baseline gap-2 flex-wrap">
 <span className="text-sm font-medium text-dark-100">{o.pair}</span>
 <span className="text-[10px] font-mono text-dark-500">{o.freq_range}</span>
 <span className="text-[9px] font-mono text-dark-500">
 · A {o.level_a.toFixed(1)} dB / B {o.level_b.toFixed(1)} dB
 </span>
 </div>
 <p className="text-[11px] text-dark-300 mt-0.5">{o.description}</p>
 {o.tip && (
 <p className="text-[10px] text-dark-500 italic mt-1">→ {o.tip}</p>
 )}
 </div>
 </div>
 )
 })}
 </div>
 </div>
 )
}
