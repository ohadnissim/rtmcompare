import React from 'react'
import { TonalIssue } from '../types'
import { useSolo, formatSoloFreq } from '../SoloContext'

interface Props {
 issues: TonalIssue[]
 labelA: string
 labelB: string
}

/**
 * Parse a freq_range string like "100–300 Hz", "5–8 kHz", "200 Hz" into a
 * geometric-mean centre frequency (better than arithmetic for log-scale
 * audio bands). Returns null if the string can't be parsed.
 */
function parseFreqRange(s: string): number | null {
 if (!s) return null
 const t = s.toLowerCase().replace(/\s+/g, '')
 const isKHz = t.includes('khz')
 const nums = t.replace(/[^\d\.\-–—,]/g, '').split(/[-–—,]/).map(parseFloat).filter(n => Number.isFinite(n) && n > 0)
 if (nums.length === 0) return null
 const mult = isKHz ? 1000 : 1
 if (nums.length === 1) return nums[0] * mult
 const lo = Math.min(...nums)
 const hi = Math.max(...nums)
 return Math.sqrt(lo * hi) * mult
}

const issueIcons: Record<string, string> = {
 'Boominess': '~',
 'Muddiness': '////',
 'Boxiness': '[ ]',
 'Harshness': '!!',
 'Sibilance': 'Ss',
 'Thinness': '---',
 'Brightness Fatigue': '**',
}

const issueColors: Record<string, string> = {
 'Boominess': '#6b8cbb',
 'Muddiness': '#8b7355',
 'Boxiness': '#a87832',
 'Harshness': '#e05a5a',
 'Sibilance': '#d4784f',
 'Thinness': '#6b8cbb',
 'Brightness Fatigue': '#e07a4f',
}

export default function TonalIssues({ issues, labelA, labelB }: Props) {
 const { soloBand, setSolo, clearSolo } = useSolo()
 if (issues.length === 0) {
 return (
 <div className="flex items-center gap-3 py-2">
 <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(110,197,119,0.1)' }}>
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#6ec577" strokeWidth={2}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
 </svg>
 </div>
 <div>
 <p className="text-sm" style={{ color: '#e7e5e4' }}>No tonal issues detected</p>
 <p className="text-[11px]" style={{ color: '#57534e' }}>Tonal balance is clean between both versions</p>
 </div>
 </div>
 )
 }

 return (
 <div className="space-y-3">
 {issues.map((issue, i) => {
 const color = issueColors[issue.name] || '#e07a4f'
 const icon = issueIcons[issue.name] || '?'

 const soloFreq = parseFreqRange(issue.freq_range)
 const isSoloed = soloFreq != null && soloBand != null && Math.abs(soloBand - soloFreq) < 0.5
 return (
 <div
 key={i}
 className="rounded-xl p-4 space-y-2.5"
 style={{ backgroundColor: `${color}10`, borderLeft: `3px solid ${color}40` }}
 >
 {/* Header */}
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2.5">
 <span
 className="w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-bold"
 style={{ backgroundColor: `${color}20`, color }}
 >
 {icon}
 </span>
 <div>
 <span className="text-sm font-medium" style={{ color: '#e7e5e4' }}>{issue.name}</span>
 <span className="text-[10px] ml-2" style={{ color: '#78716c' }}>{issue.freq_range}</span>
 </div>
 </div>
 <div className="flex items-center gap-2">
 {soloFreq != null && (
 <button
 onClick={() => isSoloed ? clearSolo() : setSolo(soloFreq, 3)}
 className="text-[9px] font-mono uppercase tracking-[0.14em] px-1.5 py-0.5 rounded transition-colors"
 style={{
 color: isSoloed ? '#0e0d0b' : '#a8a29e',
 backgroundColor: isSoloed ? '#d0b066' : 'rgba(168,161,150,0.10)',
 borderBottom: `1px solid ${isSoloed ? '#d0b066' : 'rgba(168,161,150,0.25)'}`,
 }}
 title={isSoloed
 ? `Soloed at ${formatSoloFreq(soloFreq)} — click to clear (or Esc)`
 : `Solo ${issue.name} in place — band-pass audition at ${formatSoloFreq(soloFreq)}`}
 >
 {isSoloed ? 'SOLO ON' : 'S'}
 </button>
 )}
 <span
 className="text-[10px] font-mono px-2 py-0.5 rounded-full"
 style={{
 color: issue.severity === 'warning' ? '#e07a4f' : '#a8a29e',
 backgroundColor: issue.severity === 'warning' ? 'rgba(224,122,79,0.15)' : 'rgba(87,83,78,0.2)',
 }}
 >
 {issue.diff > 0 ? '+' : ''}{issue.diff} dB
 </span>
 </div>
 </div>

 {/* Description */}
 <p className="text-xs leading-relaxed" style={{ color: '#a8a29e' }}>
 {issue.description}
 </p>

 {/* Level comparison */}
 <div className="flex items-center gap-4 text-[10px]" style={{ color: '#78716c' }}>
 <span>{labelA}: {issue.level_a} dB</span>
 <span>→</span>
 <span style={{ color }}>{labelB}: {issue.level_b} dB</span>
 <span style={{ color: '#57534e' }}>({issue.detail})</span>
 </div>

 {/* Fix suggestion */}
 <div className="flex items-start gap-2 pt-1">
 <span className="text-[10px] font-medium mt-0.5" style={{ color: '#6ec577' }}>Fix:</span>
 <p
 className="text-[11px] leading-relaxed cursor-pointer hover:opacity-80"
 style={{ color: '#a8a29e' }}
 onClick={() => navigator.clipboard.writeText(`${issue.name}: ${issue.fix}`)}
 title="Click to copy"
 >
 {issue.fix}
 </p>
 </div>
 </div>
 )
 })}
 </div>
 )
}
