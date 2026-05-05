import React from 'react'
import { Category } from '../types'
import { useSolo, formatSoloFreq } from '../SoloContext'

interface Props {
 category: Category
 labelA: string
 labelB: string
}

const categoryConfig: Record<string, { icon: string; color: string; accent: string }> = {
 Kick: { icon: '⬤', color: '#f43f5e', accent: 'rgba(244,63,94,0.15)' },
 Snare: { icon: '◎', color: '#fb923c', accent: 'rgba(251,146,60,0.15)' },
 Sub: { icon: '〰', color: '#8b5cf6', accent: 'rgba(139,92,246,0.15)' },
 Bass: { icon: '♪', color: '#3b82f6', accent: 'rgba(59,130,246,0.15)' },
 Vocals: { icon: '🎤', color: '#f59e0b', accent: 'rgba(245,158,11,0.15)' },
 Instruments: { icon: '🎹', color: '#10b981', accent: 'rgba(16,185,129,0.15)' },
 Brightness: { icon: '☀', color: '#eab308', accent: 'rgba(234,179,8,0.15)' },
 Air: { icon: '✦', color: '#06b6d4', accent: 'rgba(6,182,212,0.15)' },
 Wideness: { icon: '↔', color: '#a855f7', accent: 'rgba(168,85,247,0.15)' },
 Punch: { icon: '⚡', color: '#ef4444', accent: 'rgba(239,68,68,0.15)' },
}

// Element → centre frequency for solo-in-place audition. Mirrors the
// CATEGORY_EQ_MAP in MatchReferenceEQPanel; kept inline so the card is
// self-contained. Q = 4 gives ~½-octave audition that's wide enough to
// hear musical context, narrower than the default 8 used by spectrum bands.
const CATEGORY_SOLO_FREQ: Record<string, { freq: number; q: number }> = {
 Kick:        { freq: 90,    q: 3 },
 Snare:       { freq: 200,   q: 3 },
 Sub:         { freq: 50,    q: 3 },
 Bass:        { freq: 150,   q: 3 },
 Vocals:      { freq: 3000,  q: 2.5 },
 Instruments: { freq: 1000,  q: 2 },
 Brightness:  { freq: 5000,  q: 2.5 },
 Air:         { freq: 12000, q: 2 },
 Punch:       { freq: 120,   q: 3 },
 // Wideness has no single frequency anchor — solo button is hidden.
}

export default function CategoryCard({ category, labelA, labelB }: Props) {
 const config = categoryConfig[category.name] || { icon: '●', color: '#84858c', accent: 'rgba(132,133,140,0.15)' }
 const diff = category.level_diff
 const absDiff = Math.abs(diff)
 const { soloBand, setSolo, clearSolo } = useSolo()
 const soloMap = CATEGORY_SOLO_FREQ[category.name]
 const isSoloed = soloMap != null && soloBand != null && Math.abs(soloBand - soloMap.freq) < 0.1

 // Determine the visual "bar" comparison
 const maxDb = 40
 const barA = Math.min(100, Math.max(8, ((category.level_a + maxDb) / maxDb) * 100))
 const barB = Math.min(100, Math.max(8, ((category.level_b + maxDb) / maxDb) * 100))

 // Diff badge color
 const diffColor = absDiff < 0.3 ? '#84858c' : diff > 0 ? '#34d399' : '#fbbf24'

 return (
 <div
 className="p-4 transition-all bg-dark-900/40 border border-dark-700/30"
 style={{ borderLeft: `2px solid ${config.color}40` }}
 >
 {/* Header row */}
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-2.5">
 <span className="text-lg" role="img">{config.icon}</span>
 <span className="font-semibold text-sm">{category.name}</span>
 </div>
 <div className="flex items-center gap-2">
 {soloMap && (
 <button
 onClick={() => isSoloed ? clearSolo() : setSolo(soloMap.freq, soloMap.q)}
 className="text-[9px] font-mono uppercase tracking-[0.14em] px-1.5 py-0.5 rounded transition-colors"
 style={{
 color: isSoloed ? '#0e0d0b' : '#a8a29e',
 backgroundColor: isSoloed ? '#d0b066' : 'rgba(168,161,150,0.10)',
 borderBottom: `1px solid ${isSoloed ? '#d0b066' : 'rgba(168,161,150,0.25)'}`,
 }}
 title={isSoloed
 ? `Soloed at ${formatSoloFreq(soloMap.freq)} — click to clear (or Esc)`
 : `Solo ${category.name} in place — band-pass audition at ${formatSoloFreq(soloMap.freq)}`}
 >
 {isSoloed ? 'SOLO ON' : 'S'}
 </button>
 )}
 {/* Level diff badge */}
 <span
 className="text-xs font-mono px-2 py-0.5 rounded-full"
 style={{
 color: diffColor,
 backgroundColor: `${diffColor}20`,
 }}
 >
 {absDiff < 0.3 ? '=' : `${diff > 0 ? '+' : ''}${diff.toFixed(1)} dB`}
 </span>
 </div>
 </div>

 {/* Insight text — click to copy */}
 <p
 className="text-xs text-dark-300 leading-relaxed mb-3 cursor-pointer hover:text-dark-200 transition-colors"
 onClick={() => navigator.clipboard.writeText(category.insight)}
 title="Click to copy"
 >
 {category.insight}
 </p>

 {/* Level bars */}
 <div className="space-y-1">
 <div className="flex items-center gap-2">
 <span className="text-[9px] text-dark-500 w-10 truncate">{labelA}</span>
 <div className="flex-1 bg-dark-800/60 rounded-full h-2">
 <div
 className="h-2 rounded-full transition-all duration-700"
 style={{ width: `${barA}%`, backgroundColor: '#6b7280' }}
 />
 </div>
 </div>
 <div className="flex items-center gap-2">
 <span className="text-[9px] w-10 truncate" style={{ color: config.color }}>{labelB}</span>
 <div className="flex-1 bg-dark-800/60 rounded-full h-2">
 <div
 className="h-2 rounded-full transition-all duration-700"
 style={{ width: `${barB}%`, backgroundColor: config.color }}
 />
 </div>
 </div>
 </div>

 {/* Extra metrics for relevant categories */}
 {(category.name === 'Wideness' || category.name === 'Vocals' || category.name === 'Instruments') && (
 <div className="mt-2 pt-2 border-t border-dark-700/30">
 <div className="flex items-center justify-between text-[10px] text-dark-400">
 <span>Stereo width</span>
 <span>
 {(category.width_a * 100).toFixed(0)}% → {(category.width_b * 100).toFixed(0)}%
 </span>
 </div>
 </div>
 )}

 {(category.name === 'Punch' || category.name === 'Kick' || category.name === 'Snare') && (
 <div className="mt-2 pt-2 border-t border-dark-700/30">
 <div className="flex items-center justify-between text-[10px] text-dark-400">
 <span>Transient punch</span>
 <span>
 {category.punch_a.toFixed(1)}x → {category.punch_b.toFixed(1)}x
 </span>
 </div>
 </div>
 )}

 {(category.name === 'Bass' || category.name === 'Sub') && (
 <div className="mt-2 pt-2 border-t border-dark-700/30">
 <div className="flex items-center justify-between text-[10px] text-dark-400">
 <span>Dynamic range</span>
 <span>
 {category.dynamics_a.toFixed(1)} → {category.dynamics_b.toFixed(1)} dB
 </span>
 </div>
 </div>
 )}
 </div>
 )
}
