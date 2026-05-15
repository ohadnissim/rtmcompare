import React, { useState } from 'react'
import { MissingElement } from '../types'

interface Props {
 elements: MissingElement[]
}

export default function MissingElements({ elements }: Props) {
 if (elements.length === 0) {
 return (
 <div className="bg-dark-900 p-6 border border-dark-700/50">
 <div className="flex items-center gap-3">
 <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(110,197,119,0.1)' }}>
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="var(--color-data-pass)" strokeWidth={2}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
 </svg>
 </div>
 <div>
 <p className="text-sm text-dark-200">All elements present</p>
 <p className="text-[10px] text-dark-500">No missing or significantly reduced elements detected in the Atmos downmix.</p>
 </div>
 </div>
 </div>
 )
 }

 const missing = elements.filter(e => e.severity === 'missing')
 const reduced = elements.filter(e => e.severity === 'reduced')

 return (
 <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-4">
 <div className="space-y-1">
 <h2 className="text-lg">Missing Elements</h2>
 <p className="text-xs text-dark-400">
 Elements that are significantly quieter or absent in the Atmos downmix compared to the stereo original
 </p>
 </div>

 <div className="space-y-2">
 {missing.map((elem, i) => (
 <ElementRow key={`m-${i}`} element={elem} />
 ))}
 {reduced.map((elem, i) => (
 <ElementRow key={`r-${i}`} element={elem} />
 ))}
 </div>
 </div>
 )
}

function ElementRow({ element }: { element: MissingElement }) {
 const [expanded, setExpanded] = useState(false)
 const isMissing = element.severity === 'missing'

 return (
 <div
 className="overflow-hidden"
 style={{
 backgroundColor: isMissing ? 'rgba(224,90,90,0.05)' : 'rgba(224,122,79,0.05)',
 border: `1px solid ${isMissing ? 'rgba(224,90,90,0.15)' : 'rgba(224,122,79,0.15)'}`,
 }}
 >
 <button
 onClick={() => setExpanded(!expanded)}
 className="w-full flex items-center gap-3 px-4 py-3 text-left"
 >
 {/* Severity icon */}
 <span
 className="flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold flex-shrink-0"
 style={{
 backgroundColor: isMissing ? 'rgba(224,90,90,0.15)' : 'rgba(224,122,79,0.15)',
 color: isMissing ? 'var(--color-danger)' : 'var(--color-data-warn)',
 }}
 >
 {isMissing ? '!' : '~'}
 </span>

 {/* Element name + level diff */}
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2">
 <span className="text-sm font-medium text-dark-200">{element.name}</span>
 <span
 className="text-xs font-mono"
 style={{ color: isMissing ? 'var(--color-danger)' : 'var(--color-data-warn)' }}
 >
 {element.diff_db > 0 ? '+' : ''}{isFinite(element.diff_db) ? element.diff_db.toFixed(1) : '—'} dB
 </span>
 <span
 className="text-[10px] px-1.5 py-0.5 rounded"
 style={{
 color: isMissing ? 'var(--color-danger)' : 'var(--color-data-warn)',
 backgroundColor: isMissing ? 'rgba(224,90,90,0.1)' : 'rgba(224,122,79,0.1)',
 }}
 >
 {isMissing ? 'MISSING' : 'REDUCED'}
 </span>
 </div>
 <p className="text-[10px] text-dark-500 mt-0.5">{element.message}</p>
 </div>

 {/* Expand */}
 <svg
 className="w-3 h-3 flex-shrink-0 transition-transform"
 style={{ color: 'var(--color-text-muted)', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
 fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
 >
 <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
 </svg>
 </button>

 {expanded && (
 <div className="px-4 pb-3 pl-13">
 <p className="text-[11px] font-display italic" style={{ color: '#8a8580' }}>
 {element.suggestion}
 </p>
 </div>
 )}
 </div>
 )
}
