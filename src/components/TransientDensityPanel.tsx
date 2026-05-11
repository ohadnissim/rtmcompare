import React from 'react'

interface Density {
 timeline: { time: number; density: number; energy: number }[]
 sections: { start: number; end: number; label: string; energy: number }[]
}

const SECTION_COLOR: Record<string, string> = {
 'Intro': '#6b6470',
 'Verse': '#7ca4a3',
 'Verse / Pre-chorus': '#7ca4a3',
 'Breakdown': '#8a95ab',
 'Drop / Chorus': '#d0b066',
 'Climax': '#c9a15f',
 'Outro': '#6b6470',
}

export default function TransientDensityPanel({ density, durationSec, onSectionScrub }: {
 density: Density
 durationSec?: number
 /** Optional callback — when wired, clicking a section label scrubs the
  * ABPlayer to that section's start timestamp. Renders statically when
  * not provided. */
 onSectionScrub?: (timeSec: number) => void
}) {
 if (!density || !density.timeline || density.timeline.length < 2) return null

 const total = durationSec || Math.max(...density.timeline.map(p => p.time)) + 1
 const w = 900
 const h = 120
 // Extra top strip for section labels + vertical markers sitting above the curve.
 const topPad = 18

 // Energy curve
 const energyPath = density.timeline.map((p, i) => {
 const x = (p.time / total) * w
 const y = topPad + h - p.energy * h * 0.85
 return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
 }).join(' ')

 // Alternating tint bands between section boundaries — helps the eye track
 // which part of the timeline belongs to which section without needing to
 // read every label.
 const tintFor = (i: number) => (i % 2 === 0 ? 'rgba(235,231,224,0.025)' : 'rgba(208,176,102,0.035)')

 return (
 <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-4" style={{ borderRadius: '2px' }}>
 <div className="space-y-1">
 <h2 className="text-lg font-semibold">Transient Density & Structure</h2>
 <p className="text-xs text-dark-400">
 Energy arc and rhythmic density over time. Vertical markers label each detected section — {onSectionScrub ? 'click a label to scrub the player there.' : 'use them to navigate drops, breakdowns, and choruses.'}
 </p>
 </div>

 <div className="bg-dark-800 p-3 overflow-hidden" style={{ borderRadius: '2px' }}>
 <svg viewBox={`0 0 ${w} ${h + topPad + 24}`} className="w-full h-40" preserveAspectRatio="none">
 {/* Alternating section background tint */}
 {density.sections.map((s, i) => {
 const x1 = (s.start / total) * w
 const x2 = (s.end / total) * w
 return (
 <rect key={`tint-${i}`} x={x1} y={topPad} width={Math.max(1, x2 - x1)} height={h} fill={tintFor(i)} />
 )
 })}

 {/* Section bands (bottom) — kept for the colour legend at the bottom. */}
 {density.sections.map((s, i) => {
 const x1 = (s.start / total) * w
 const x2 = (s.end / total) * w
 const color = SECTION_COLOR[s.label] || '#6b6470'
 return (
 <rect key={`band-${i}`} x={x1} y={topPad + h + 2} width={Math.max(1, x2 - x1)} height={20} fill={color} opacity="0.18" />
 )
 })}

 {/* Vertical section-start markers + labels above the timeline */}
 {density.sections.map((s, i) => {
 const x1 = (s.start / total) * w
 const color = SECTION_COLOR[s.label] || '#6b6470'
 return (
 <g key={`marker-${i}`}>
 <line x1={x1} x2={x1} y1={topPad} y2={topPad + h} stroke={color} strokeWidth="1" strokeDasharray="2 3" opacity="0.55" />
 {onSectionScrub ? (
 <g
  style={{ cursor: 'pointer' }}
  onClick={() => onSectionScrub(s.start)}
 >
  <rect x={x1 + 2} y={2} width={Math.max(28, s.label.length * 5.2)} height={topPad - 4} fill="rgba(235,231,224,0.04)" rx="2" />
  <text x={x1 + 5} y={topPad - 6} fontSize="9" fill={color} style={{ fontWeight: 600 }}>
  {s.label}
  </text>
 </g>
 ) : (
 <text x={x1 + 3} y={topPad - 6} fontSize="9" fill={color} style={{ fontWeight: 600 }}>
  {s.label}
 </text>
 )}
 </g>
 )
 })}

 {/* Transient density as light bars */}
 {density.timeline.map((p, i) => {
 const x = (p.time / total) * w
 const barH = p.density * h * 0.55
 return (
 <rect key={i} x={x - 1} y={topPad + h - barH} width="2" height={barH}
 fill="#d0b066" opacity={0.25 + p.density * 0.35} />
 )
 })}

 {/* Energy curve */}
 <path d={energyPath} fill="none" stroke="#7ca4a3" strokeWidth="1.5" opacity="0.85" />
 </svg>

 <div className="flex items-center justify-between mt-2 text-[9px] text-dark-500 font-mono">
 <span>0:00</span>
 <span>{Math.floor(total / 2 / 60)}:{String(Math.floor(total / 2) % 60).padStart(2, '0')}</span>
 <span>{Math.floor(total / 60)}:{String(Math.floor(total) % 60).padStart(2, '0')}</span>
 </div>
 </div>

 <div className="flex items-center gap-4 text-[10px]">
 <span className="flex items-center gap-1.5">
 <span className="w-3 h-0.5" style={{ backgroundColor: '#7ca4a3' }} />
 <span className="text-dark-400">Energy (RMS)</span>
 </span>
 <span className="flex items-center gap-1.5">
 <span className="w-3 h-2" style={{ backgroundColor: 'rgba(208,176,102,0.45)' }} />
 <span className="text-dark-400">Transient density</span>
 </span>
 {density.sections.length > 0 && (
 <span className="text-dark-500 ml-auto">{density.sections.length} sections</span>
 )}
 </div>
 </div>
 )
}
