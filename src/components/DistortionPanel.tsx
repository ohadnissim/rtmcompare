import React from 'react'
import { DistortionResult } from '../types'

interface Props {
 distortion: DistortionResult
 labelA: string
 labelB: string
 singleFile?: boolean
}

const severityStyles = {
 clean: { color: 'var(--color-data-pass)', bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.25)', icon: '✓', label: 'Clean' },
 warning: { color: 'var(--color-warm-amber)', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.25)', icon: '⚠', label: 'Warning' },
 problem: { color: 'var(--color-danger)', bg: 'rgba(244,63,94,0.1)', border: 'rgba(244,63,94,0.25)', icon: '✕', label: 'Problem' },
}

export default function DistortionPanel({ distortion, labelA, labelB, singleFile }: Props) {
 const style = severityStyles[distortion.severity]

 return (
 <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-5" style={{ borderRadius: '2px' }}>
 {/* Header */}
 <div className="flex items-center justify-between">
 <div className="space-y-1">
 <h2 className="text-lg">Distortion Check</h2>
 <p className="text-xs text-dark-400">
 Clipping, inter-sample peaks, over-limiting, and harmonic distortion
 </p>
 </div>
 <span
 className="text-xs font-bold px-3 py-1 rounded-full"
 style={{ color: style.color, backgroundColor: style.bg, border: `1px solid ${style.border}` }}
 >
 {style.icon} {style.label}
 </span>
 </div>

 {/* Meter Grid */}
 <div className="grid grid-cols-2 gap-3">
 {/* Clipping */}
 <MeterCard
 title="Clipping"
 description="Samples hitting digital ceiling"
 valueA={distortion.clipping.a_clip_count}
 valueB={distortion.clipping.b_clip_count}
 labelA={labelA}
 labelB={labelB}
 singleFile={singleFile}
 format={(v) => v === 0 ? 'None' : `${v} samples`}
 status={singleFile ? (distortion.clipping.b_clip_count > 50 ? 'bad' : 'good') : (distortion.clipping.b_clip_count > distortion.clipping.a_clip_count + 5 ? 'bad' : 'good')}
 />

 {/* True Peak */}
 <MeterCard
 title="True Peak"
 description="Inter-sample peak level (dBTP)"
 valueA={distortion.true_peaks.a_true_peak_db}
 valueB={distortion.true_peaks.b_true_peak_db}
 labelA={labelA}
 labelB={labelB}
 singleFile={singleFile}
 format={(v) => `${v.toFixed(1)} dBTP`}
 status={distortion.true_peaks.b_true_peak_db > 0 ? 'bad' : 'good'}
 />

 {/* Over-limiting */}
 <MeterCard
 title="Over-Limiting"
 description="Flat-top waveform percentage"
 valueA={distortion.limiting.a_flat_pct}
 valueB={distortion.limiting.b_flat_pct}
 labelA={labelA}
 labelB={labelB}
 singleFile={singleFile}
 format={(v) => `${v.toFixed(1)}%`}
 status={distortion.limiting.b_flat_pct > 5 ? 'bad' : distortion.limiting.b_flat_pct > 2 ? 'warn' : 'good'}
 />

 {/* THD — hide in single file mode (no baseline to compare) */}
 {!singleFile && (
 <MeterCard
 title="Harmonic Distortion"
 description="New harmonics added in processing"
 valueA={0}
 valueB={distortion.harmonics.thd_increase_pct}
 labelA={labelA}
 labelB={labelB}
 format={(v, isA) => isA ? 'Baseline' : v > 0.5 ? `+${v.toFixed(1)}%` : 'Minimal'}
 status={'good'}
 />
 )}
 </div>

 {/* Issues */}
 <div className="space-y-2">
 {distortion.issues.map((issue, i) => (
 <div
 key={i}
 className="flex items-start gap-2.5 px-3 py-2 text-xs"
 style={{ borderRadius: '2px', backgroundColor: style.bg }}
 >
 <span style={{ color: style.color }} className="mt-0.5">{style.icon}</span>
 <span className="text-dark-300">{issue}</span>
 </div>
 ))}
 </div>

 {/* Recommendations */}
 {distortion.recommendations.length > 0 && (
 <div className="space-y-1.5 pt-1">
 <p className="text-xs font-medium text-dark-400 uppercase tracking-wide">How to fix</p>
 {distortion.recommendations.map((rec, i) => (
 <p key={i} className="text-xs text-dark-300 leading-relaxed pl-3" style={{ borderLeft: `2px solid ${style.border}` }}>
 {rec}
 </p>
 ))}
 </div>
 )}
 </div>
 )
}

function MeterCard({
 title, description, valueA, valueB, labelA, labelB, format, status, singleFile,
}: {
 title: string
 description: string
 valueA: number
 valueB: number
 labelA: string
 labelB: string
 format: (v: number, isA?: boolean) => string
 status: 'good' | 'warn' | 'bad'
 singleFile?: boolean
}) {
 const statusColor = status === 'good' ? 'var(--color-data-pass)' : status === 'warn' ? 'var(--color-warm-amber)' : 'var(--color-danger)'
 const statusBg = status === 'good' ? 'rgba(52,211,153,0.08)' : status === 'warn' ? 'rgba(245,158,11,0.08)' : 'rgba(244,63,94,0.08)'

 return (
 <div className="p-3.5 space-y-2" style={{ borderRadius: '2px', backgroundColor: statusBg }}>
 <div className="space-y-0.5">
 <p className="text-xs font-medium text-dark-200">{title}</p>
 <p className="text-[10px] text-dark-500">{description}</p>
 </div>
 <div className="space-y-1">
 {singleFile ? (
 <div className="flex items-center justify-between text-[10px]">
 <span style={{ color: statusColor }}>Measured</span>
 <span className="font-mono font-medium" style={{ color: statusColor }}>{format(valueB, false)}</span>
 </div>
 ) : (
 <>
 <div className="flex items-center justify-between text-[10px]">
 <span className="text-dark-400">{labelA}</span>
 <span className="font-mono text-dark-400">{format(valueA, true)}</span>
 </div>
 <div className="flex items-center justify-between text-[10px]">
 <span style={{ color: statusColor }}>{labelB}</span>
 <span className="font-mono font-medium" style={{ color: statusColor }}>{format(valueB, false)}</span>
 </div>
 </>
 )}
 </div>
 <div className="flex items-center gap-1.5">
 <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
 <span className="text-[9px]" style={{ color: statusColor }}>
 {status === 'good' ? 'OK' : status === 'warn' ? 'Check this' : 'Needs attention'}
 </span>
 </div>
 </div>
 )
}
