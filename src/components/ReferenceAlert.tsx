import React, { useState } from 'react'
import { ReferenceCheck } from '../types'

interface Props {
 check: ReferenceCheck
 labelA: string
}

export default function ReferenceAlert({ check, labelA }: Props) {
 const [expanded, setExpanded] = useState(false)

 // Don't show anything if reference is good
 if (check.status === 'good') return null

 const statusConfig = {
 fair: {
 color: '#e07a4f',
 bg: 'rgba(224,122,79,0.08)',
 border: 'rgba(224,122,79,0.2)',
 icon: '⚠',
 label: 'Heads up',
 },
 poor: {
 color: '#e05a5a',
 bg: 'rgba(224,90,90,0.08)',
 border: 'rgba(224,90,90,0.2)',
 icon: '⚠',
 label: 'Reference issues',
 },
 }

 const config = statusConfig[check.status] || statusConfig.fair

 return (
 <div
 className="overflow-hidden"
 style={{ borderRadius: '2px', backgroundColor: config.bg, border: `1px solid ${config.border}` }}
 >
 {/* Header — always visible */}
 <button
 onClick={() => setExpanded(!expanded)}
 className="w-full flex items-center gap-3 px-5 py-3 text-left"
 >
 <span style={{ color: config.color }}>{config.icon}</span>
 <div className="flex-1 min-w-0">
 <span className="text-xs font-medium" style={{ color: config.color }}>{config.label}:</span>
 <span className="text-xs ml-1.5" style={{ color: '#a8a29e' }}>{check.summary}</span>
 </div>
 <svg
 className="w-3 h-3 flex-shrink-0 transition-transform"
 style={{ color: '#78716c', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
 fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
 >
 <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
 </svg>
 </button>

 {/* Expanded details */}
 {expanded && (
 <div className="px-5 pb-4 space-y-3">
 {/* Stats bar */}
 <div className="flex gap-4 text-[10px]" style={{ color: '#78716c' }}>
 <span>LUFS: {check.stats.lufs}</span>
 <span>Dynamic range: {check.stats.dynamic_range} dB</span>
 <span>Stereo: {check.stats.stereo_correlation}</span>
 {check.stats.clip_count > 0 && <span style={{ color: '#e05a5a' }}>Clips: {check.stats.clip_count}</span>}
 </div>

 {/* Warnings */}
 <div className="space-y-2">
 {check.warnings.map((w, i) => (
 <div key={i} className="space-y-1">
 <p className="text-xs" style={{ color: w.severity === 'warning' ? '#e7e5e4' : '#a8a29e' }}>
 {w.message}
 </p>
 <p className="text-[11px] italic" style={{ color: '#6b645d' }}>
 {w.suggestion}
 </p>
 </div>
 ))}
 </div>
 </div>
 )}
 </div>
 )
}
