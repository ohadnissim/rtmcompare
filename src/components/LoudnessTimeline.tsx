import React, { useMemo, useState } from 'react'

interface Props {
 lufsOverTimeA: number[]
 lufsOverTimeB: number[]
 /** Optional momentary LUFS curves (400 ms window). When provided,
 * render as a thinner semi-transparent overlay on top of the
 * short-term curves. */
 lufsMomentaryA?: number[]
 lufsMomentaryB?: number[]
 labelA: string
 labelB: string
 durationSec: number
}

export default function LoudnessTimeline({
 lufsOverTimeA,
 lufsOverTimeB,
 lufsMomentaryA,
 lufsMomentaryB,
 labelA,
 labelB,
 durationSec,
}: Props) {
 const w = 800
 const h = 180
 const padX = 40
 const padY = 20

 // Momentary-overlay toggle. Default OFF so the main short-term curve
 // reads cleanly; engineers who want the tighter-window view flip it on.
 // Only the toggle renders when momentary data is actually present.
 const hasMomentary = !!(lufsMomentaryA?.length || lufsMomentaryB?.length)
 const [showMomentary, setShowMomentary] = useState(false)

 // Y-axis range — include momentary values in the range calc so the
 // overlay's peaks / valleys don't clip when toggled on.
 const allVals = [
 ...lufsOverTimeA,
 ...lufsOverTimeB,
 ...(showMomentary ? (lufsMomentaryA || []) : []),
 ...(showMomentary ? (lufsMomentaryB || []) : []),
 ].filter(v => v > -60)
 const minLufs = Math.floor(Math.min(...allVals) / 2) * 2 - 2
 const maxLufs = Math.ceil(Math.max(...allVals) / 2) * 2 + 2

 const makePath = (data: number[]): string => {
 const points = data.map((v, i) => ({
 x: padX + (i / (data.length - 1)) * (w - padX * 2),
 y: padY + ((maxLufs - v) / (maxLufs - minLufs)) * (h - padY * 2),
 }))
 if (points.length < 2) return ''
 let d = `M ${points[0].x} ${points[0].y}`
 for (let i = 1; i < points.length; i++) {
 const prev = points[i - 1]
 const curr = points[i]
 const cpx = (prev.x + curr.x) / 2
 d += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`
 }
 return d
 }

 // Y-axis grid lines
 const yGridLines = useMemo(() => {
 const lines = []
 for (let v = Math.ceil(minLufs / 4) * 4; v <= maxLufs; v += 4) {
 lines.push(v)
 }
 return lines
 }, [minLufs, maxLufs])

 // Time markers
 const timeMarkers = useMemo(() => {
 const interval = durationSec > 180 ? 60 : 30
 const markers = []
 for (let t = 0; t <= durationSec; t += interval) {
 markers.push(t)
 }
 return markers
 }, [durationSec])

 return (
 <div className="bg-dark-900 rounded-2xl p-6 border border-dark-700/50 space-y-4">
 <div className="flex items-center justify-between">
 <div className="space-y-1">
 <h2 className="text-lg font-semibold">Loudness Over Time</h2>
 <p className="text-xs text-dark-400">LUFS plotted across the song — see where the master pushed harder</p>
 </div>
 <div className="flex items-center gap-3 text-xs">
 <div className="flex items-center gap-1.5">
 <div className="w-6 h-0.5 rounded" style={{ backgroundColor: '#6b8cbb' }} />
 <span className="text-dark-400">{labelA}</span>
 </div>
 <div className="flex items-center gap-1.5">
 <div className="w-6 h-0.5 rounded" style={{ backgroundColor: '#e07a4f' }} />
 <span className="text-dark-400">{labelB}</span>
 </div>
 {hasMomentary && (
 <button
 onClick={() => setShowMomentary(v => !v)}
 className="text-[10px] uppercase tracking-[0.12em] px-2 py-0.5 rounded-full transition-colors"
 style={{
 backgroundColor: showMomentary ? 'rgba(208,176,102,0.15)' : 'rgba(87,83,78,0.18)',
 color: showMomentary ? '#d0b066' : '#8d867b',
 border: `1px solid ${showMomentary ? 'rgba(208,176,102,0.40)' : 'transparent'}`,
 }}
 title="Overlay momentary LUFS (400 ms window) on top of the short-term (3 s) curves. Catches pumping artefacts and dialog-anchor detail that short-term averages away."
 >
 {showMomentary ? '◉ Momentary' : '○ Momentary'}
 </button>
 )}
 </div>
 </div>

 <div className="relative bg-dark-800 rounded-xl p-2 overflow-hidden">
 <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-44" preserveAspectRatio="none">
 {/* Y-axis grid */}
 {yGridLines.map(v => {
 const y = padY + ((maxLufs - v) / (maxLufs - minLufs)) * (h - padY * 2)
 return (
 <g key={v}>
 <line x1={padX} y1={y} x2={w - padX} y2={y} stroke="#4c4d52" strokeWidth="0.5" strokeDasharray="4 4" opacity="0.3" />
 <text x={padX - 4} y={y + 3} textAnchor="end" fontSize="8" fill="#696a71">{v}</text>
 </g>
 )
 })}

 {/* X-axis time markers */}
 {timeMarkers.map(t => {
 const x = padX + (t / durationSec) * (w - padX * 2)
 return (
 <g key={t}>
 <line x1={x} y1={padY} x2={x} y2={h - padY} stroke="#4c4d52" strokeWidth="0.5" opacity="0.2" />
 <text x={x} y={h - 4} textAnchor="middle" fontSize="8" fill="#696a71">{formatTime(t)}</text>
 </g>
 )
 })}

 {/* Momentary overlay — renders BEHIND the short-term curves
 with reduced opacity + thinner stroke so short-term stays
 the dominant visual, and momentary reads as a shadow of
 the faster-window energy. Only when user toggles on. */}
 {showMomentary && lufsMomentaryA && lufsMomentaryA.length > 1 && (
 <path d={makePath(lufsMomentaryA)} fill="none" stroke="#6b8cbb" strokeWidth="1" opacity="0.45" strokeDasharray="2 2" />
 )}
 {showMomentary && lufsMomentaryB && lufsMomentaryB.length > 1 && (
 <path d={makePath(lufsMomentaryB)} fill="none" stroke="#e07a4f" strokeWidth="1" opacity="0.45" strokeDasharray="2 2" />
 )}
 {/* File A (short-term) */}
 <path d={makePath(lufsOverTimeA)} fill="none" stroke="#6b8cbb" strokeWidth="2" opacity="0.8" />
 {/* File B (short-term) */}
 <path d={makePath(lufsOverTimeB)} fill="none" stroke="#e07a4f" strokeWidth="2" opacity="0.9" />

 {/* Y-axis label */}
 <text x={8} y={h / 2} textAnchor="middle" fontSize="8" fill="#696a71" transform={`rotate(-90, 8, ${h / 2})`}>LUFS</text>
 </svg>
 </div>
 </div>
 )
}

function formatTime(seconds: number): string {
 const mins = Math.floor(seconds / 60)
 const secs = Math.floor(seconds % 60)
 return `${mins}:${secs.toString().padStart(2, '0')}`
}
