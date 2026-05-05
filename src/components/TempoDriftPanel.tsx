import React from 'react'

interface Props {
 drift?: {
 timeline: { time: number; bpm: number }[]
 range_bpm: number
 drift: boolean
 median_bpm: number
 }
}

export default function TempoDriftPanel({ drift }: Props) {
 if (!drift || !drift.timeline || drift.timeline.length < 2) return null

 const tempos = drift.timeline.map(p => p.bpm)
 const minT = Math.min(...tempos)
 const maxT = Math.max(...tempos)
 const pad = Math.max(1, (maxT - minT) * 0.2)
 const yMin = minT - pad
 const yMax = maxT + pad
 const w = 800
 const h = 100

 const path = drift.timeline.map((p, i) => {
 const x = (i / (drift.timeline.length - 1)) * w
 const y = h - ((p.bpm - yMin) / (yMax - yMin)) * h
 return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
 }).join(' ')

 return (
 <div className="bg-dark-900 rounded-2xl p-6 border border-dark-700/50 space-y-4">
 <div className="flex items-center justify-between">
 <div className="space-y-1">
 <h2 className="text-lg font-semibold">Tempo Over Time</h2>
 <p className="text-xs text-dark-400">
 Sliding-window BPM. Large range (&gt;3 BPM) suggests variable tempo — live takes or un-quantised productions.
 </p>
 </div>
 <div className="flex items-center gap-3 text-right">
 <div>
 <div className="text-[9px] uppercase tracking-[0.1em] text-dark-500">Median</div>
 <div className="text-base font-mono text-dark-100">{drift.median_bpm.toFixed(1)} BPM</div>
 </div>
 <div>
 <div className="text-[9px] uppercase tracking-[0.1em] text-dark-500">Range</div>
 <div className="text-base font-mono" style={{ color: drift.drift ? '#d0b066' : '#6fa37e' }}>
 ±{(drift.range_bpm / 2).toFixed(1)}
 </div>
 </div>
 </div>
 </div>

 <div className="bg-dark-800 rounded-xl p-3">
 <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24" preserveAspectRatio="none">
 {/* Median reference line */}
 <line
 x1={0}
 x2={w}
 y1={h - ((drift.median_bpm - yMin) / (yMax - yMin)) * h}
 y2={h - ((drift.median_bpm - yMin) / (yMax - yMin)) * h}
 stroke="#4c4d52"
 strokeWidth="0.5"
 strokeDasharray="4 3"
 />
 <path d={path} fill="none" stroke="#d0b066" strokeWidth="2" />
 {/* Points */}
 {drift.timeline.map((p, i) => {
 const x = (i / (drift.timeline.length - 1)) * w
 const y = h - ((p.bpm - yMin) / (yMax - yMin)) * h
 return <circle key={i} cx={x} cy={y} r={2} fill="#d0b066" />
 })}
 </svg>
 <div className="flex justify-between mt-1 text-[9px] text-dark-500 font-mono">
 <span>{yMin.toFixed(1)} BPM</span>
 <span>{yMax.toFixed(1)} BPM</span>
 </div>
 </div>

 {drift.drift && (
 <div className="text-[11px] px-3 py-2 rounded-lg" style={{ backgroundColor: 'rgba(208,176,102,0.10)', color: '#d0b066' }}>
 Tempo range {drift.range_bpm.toFixed(1)} BPM — this track varies in tempo across the timeline. Expect beat-grid misalignment if you're DJ-syncing or re-cutting.
 </div>
 )}
 </div>
 )
}
