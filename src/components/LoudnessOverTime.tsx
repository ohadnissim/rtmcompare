import React, { useMemo } from 'react'
import { AnalysisResult } from '../types'

/**
 * Loudness-over-time with auto-section overlays.
 *
 * Plots short-term LUFS across the song + overlays the section boundaries
 * the transient-density detector already produces (intro / verse / drop /
 * outro). Gives engineers per-section LUFS averages so a complaint like
 * "the track feels too loud overall" resolves to "the drop is +3 LU
 * hotter than the pre-drop — intentional or not?"
 *
 * Data sources:
 * • `results.lufs_over_time_b` — array of LUFS-S samples (Python step
 * is ~400 ms per sample, so 150 samples ≈ 1 min of music).
 * • `results.transient_density.sections` — { start, end, label, energy }
 * list of macro sections.
 *
 * If either source is missing the component returns null — non-breaking
 * for older analysis results or files where section detection couldn't
 * resolve structure.
 */
interface Props {
 result: AnalysisResult
 /** Use side "a" or "b" — defaults to b (the target file in Compare
 * mode, also the only side populated in ref-only song detail). */
 side?: 'a' | 'b'
 /** File duration in seconds — maps section boundaries onto the
 * sample array. Falls back to the Analysis result's own duration. */
 durationSec?: number
}

interface SectionStat {
 label: string
 start: number
 end: number
 meanLufs: number
}

export default function LoudnessOverTime({ result, side = 'b', durationSec }: Props) {
 const data = side === 'a' ? result.lufs_over_time_a : result.lufs_over_time_b
 const sections = result.transient_density?.sections || []
 const duration = durationSec ?? (result as any).duration_sec ?? 0
 const stats = useMemo<SectionStat[]>(() => {
 if (!data || data.length === 0 || duration <= 0 || sections.length === 0) return []
 const step = duration / data.length
 return sections.map(s => {
 const startIdx = Math.max(0, Math.floor(s.start / step))
 const endIdx = Math.min(data.length, Math.ceil(s.end / step))
 let sum = 0, n = 0
 for (let i = startIdx; i < endIdx; i++) {
 const v = data[i]
 if (isFinite(v) && v > -70) { sum += v; n++ }
 }
 return {
 label: s.label || 'section',
 start: s.start,
 end: s.end,
 meanLufs: n > 0 ? sum / n : NaN,
 }
 })
 }, [data, sections, duration])

 if (!data || data.length === 0) return null

 // Scale: find min/max LUFS in the data, clamp to a sensible window.
 const valid = data.filter(v => isFinite(v) && v > -70)
 if (valid.length === 0) return null
 const rawMin = Math.min(...valid)
 const rawMax = Math.max(...valid)
 const minY = Math.floor(Math.min(rawMin, -30))
 const maxY = Math.ceil(Math.max(rawMax, -6))
 const w = 800
 const h = 140
 const padX = 40
 const padTop = 10
 const padBottom = 20

 const toX = (i: number) => padX + (i / (data.length - 1)) * (w - padX * 2)
 const toY = (v: number) => {
 if (!isFinite(v) || v < minY) return h - padBottom
 const clamped = Math.max(minY, Math.min(maxY, v))
 return padTop + ((maxY - clamped) / (maxY - minY)) * (h - padTop - padBottom)
 }
 const pathD = (() => {
 let d = ''
 for (let i = 0; i < data.length; i++) {
 if (!isFinite(data[i]) || data[i] < -70) continue
 d += (d ? 'L' : 'M') + ` ${toX(i).toFixed(1)} ${toY(data[i]).toFixed(1)} `
 }
 return d
 })()

 // Y-axis labels at round integer LUFS.
 const yTicks: number[] = []
 for (let v = Math.ceil(maxY / 3) * 3; v >= minY; v -= 3) yTicks.push(v)

 return (
 <div className="p-4 space-y-2" style={{
 borderRadius: '2px',
 backgroundColor: 'rgba(48,44,39,0.35)',
 border: '1px solid rgba(168,161,150,0.08)',
 }}>
 <div className="flex items-center justify-between flex-wrap gap-2">
 <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-muted)' }}>
 Loudness over time · short-term LUFS
 </span>
 <span className="text-[9px] font-mono" style={{ color: '#8d867b' }}>
 section overlays from transient-density detector
 </span>
 </div>

 <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
 {/* Y-axis grid */}
 {yTicks.map(v => (
 <g key={v}>
 <line x1={padX} x2={w - padX} y1={toY(v)} y2={toY(v)} stroke="#3e3a33" strokeWidth={0.5} strokeDasharray="2 3" />
 <text x={padX - 4} y={toY(v) + 3} fontSize="9" fill="var(--color-text-muted)" textAnchor="end" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
 {v}
 </text>
 </g>
 ))}

 {/* Section shading + labels */}
 {sections.length > 0 && duration > 0 && sections.map((s, i) => {
 const startIdx = Math.max(0, Math.floor((s.start / duration) * data.length))
 const endIdx = Math.min(data.length - 1, Math.ceil((s.end / duration) * data.length))
 const x1 = toX(startIdx)
 const x2 = toX(endIdx)
 const alt = i % 2 === 0
 return (
 <g key={i}>
 <rect x={x1} y={padTop} width={x2 - x1} height={h - padTop - padBottom}
 fill={alt ? 'rgba(208,176,102,0.04)' : 'rgba(107,140,187,0.04)'} />
 <text x={(x1 + x2) / 2} y={padTop + 12} fontSize="9" fill="#b5afa4" textAnchor="middle"
 fontFamily="ui-sans-serif, -apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif"
 style={{ textTransform: 'uppercase', letterSpacing: '0.14em' }}>
 {s.label}
 </text>
 </g>
 )
 })}

 {/* LUFS curve */}
 <path d={pathD} fill="none" stroke="#d0b066" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />

 {/* Section mean markers */}
 {stats.map((s, i) => {
 if (!isFinite(s.meanLufs)) return null
 const startIdx = Math.max(0, Math.floor((s.start / duration) * data.length))
 const endIdx = Math.min(data.length - 1, Math.ceil((s.end / duration) * data.length))
 const x1 = toX(startIdx)
 const x2 = toX(endIdx)
 const y = toY(s.meanLufs)
 return (
 <g key={`mean-${i}`}>
 <line x1={x1} x2={x2} y1={y} y2={y} stroke="#6b8cbb" strokeWidth={1.2} strokeDasharray="3 2" opacity="0.75" />
 <text x={x2 - 4} y={y - 3} fontSize="9" fill="#6b8cbb" textAnchor="end"
 fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
 {s.meanLufs.toFixed(1)}
 </text>
 </g>
 )
 })}
 </svg>

 {/* Section-stat legend row */}
 {stats.length > 0 && (
 <div className="flex items-center gap-3 flex-wrap text-[9px] font-mono" style={{ color: '#8d867b' }}>
 {stats.map((s, i) => isFinite(s.meanLufs) && (
 <span key={i}>
 <span className="uppercase" style={{ color: '#a8a29e' }}>{s.label}</span>
 <span className="ml-1.5" style={{ color: '#d0b066' }}>{s.meanLufs.toFixed(1)} LUFS</span>
 </span>
 ))}
 </div>
 )}
 </div>
 )
}
