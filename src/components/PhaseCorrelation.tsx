import React, { useMemo } from 'react'

interface Props {
 phaseOverTimeA: number[]
 phaseOverTimeB: number[]
 labelA: string
 labelB: string
 durationSec: number
 /** Optional: delta value (avgB - avgA). Shows a clickable Δ badge when provided with onAnnotate. */
 correlationDelta?: number
 /** Optional: annotation handler. When provided, a Δ badge appears in the header row. */
 onAnnotate?: () => void
}

export default function PhaseCorrelation({ phaseOverTimeA, phaseOverTimeB, labelA, labelB, durationSec, correlationDelta, onAnnotate }: Props) {
 const w = 800
 const h = 140
 const padX = 30
 const padY = 15

 const makePath = (data: number[]): string => {
 const points = data.map((v, i) => ({
 x: padX + (i / (data.length - 1)) * (w - padX * 2),
 y: padY + ((1 - v) / 2) * (h - padY * 2), // -1 to +1 mapped to full height
 }))
 if (points.length < 2) return ''
 let d = `M ${points[0].x} ${points[0].y}`
 for (let i = 1; i < points.length; i++) {
 d += ` L ${points[i].x} ${points[i].y}`
 }
 return d
 }

 // Find problem zones (phase < 0)
 const problemsB = useMemo(() => {
 const zones: { start: number; end: number }[] = []
 let inZone = false
 let zoneStart = 0
 for (let i = 0; i < phaseOverTimeB.length; i++) {
 if (phaseOverTimeB[i] < 0 && !inZone) {
 zoneStart = i
 inZone = true
 } else if (phaseOverTimeB[i] >= 0 && inZone) {
 zones.push({ start: zoneStart, end: i })
 inZone = false
 }
 }
 return zones
 }, [phaseOverTimeB])

 const avgA = phaseOverTimeA.length > 0 ? phaseOverTimeA.reduce((a, b) => a + b, 0) / phaseOverTimeA.length : 0
 const avgB = phaseOverTimeB.length > 0 ? phaseOverTimeB.reduce((a, b) => a + b, 0) / phaseOverTimeB.length : 0

 return (
 <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-4" style={{ borderRadius: '2px' }}>
 <div className="flex items-center justify-between">
 <div className="space-y-1">
 <h2 className="text-lg">Phase Correlation</h2>
 <p className="text-xs text-dark-400">L/R phase relationship over time — red zones indicate phase issues</p>
 </div>
 <div className="flex items-center gap-3 text-[10px]">
 <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded" style={{ backgroundColor: 'var(--color-sand-500)' }} /> {labelA}: <span className="font-mono">{avgA.toFixed(2)}</span></span>
 <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded" style={{ backgroundColor: 'var(--color-warm-amber)' }} /> {labelB}: <span className="font-mono text-amber-400">{avgB.toFixed(2)}</span></span>
 {onAnnotate && correlationDelta != null && (
  <button
   type="button"
   onClick={onAnnotate}
   title="Add annotation for stereo correlation delta"
   style={{
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.04em',
    color: 'var(--color-accent)',
    background: 'transparent',
    border: '1px solid var(--color-accent)',
    borderRadius: 2,
    padding: '2px 6px',
    cursor: 'pointer',
    opacity: 0.85,
   }}
  >
   Δ {correlationDelta >= 0 ? '+' : ''}{isFinite(correlationDelta) ? correlationDelta.toFixed(2) : '—'}
  </button>
 )}
 </div>
 </div>

 <div className="bg-dark-800 p-3 overflow-hidden" style={{ borderRadius: '2px' }}>
 <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32" preserveAspectRatio="none">
 {/* Zone backgrounds */}
 <rect x={padX} y={padY} width={w - padX * 2} height={(h - padY * 2) / 2} fill="var(--color-data-pass)" opacity="0.03" />
 <rect x={padX} y={padY + (h - padY * 2) / 2} width={w - padX * 2} height={(h - padY * 2) / 2} fill="var(--color-danger)" opacity="0.03" />

 {/* Grid lines */}
 <line x1={padX} y1={padY + (h - padY * 2) / 2} x2={w - padX} y2={padY + (h - padY * 2) / 2} stroke="#4c4d52" strokeWidth="0.5" opacity="0.5" />
 <line x1={padX} y1={padY + (h - padY * 2) / 4} x2={w - padX} y2={padY + (h - padY * 2) / 4} stroke="#4c4d52" strokeWidth="0.5" strokeDasharray="4 4" opacity="0.2" />
 <line x1={padX} y1={padY + (h - padY * 2) * 3 / 4} x2={w - padX} y2={padY + (h - padY * 2) * 3 / 4} stroke="#4c4d52" strokeWidth="0.5" strokeDasharray="4 4" opacity="0.2" />

 {/* Problem zones highlight */}
 {problemsB.map((zone, i) => {
 const x1 = padX + (zone.start / phaseOverTimeB.length) * (w - padX * 2)
 const x2 = padX + (zone.end / phaseOverTimeB.length) * (w - padX * 2)
 return (
 <rect key={i} x={x1} y={padY} width={x2 - x1} height={h - padY * 2} fill="var(--color-danger)" opacity="0.1" />
 )
 })}

 {/* Y-axis labels */}
 <text x={padX - 4} y={padY + 4} textAnchor="end" fontSize="8" fill="var(--color-data-pass)">+1</text>
 <text x={padX - 4} y={padY + (h - padY * 2) / 2 + 3} textAnchor="end" fontSize="8" fill="#696a71">0</text>
 <text x={padX - 4} y={h - padY + 2} textAnchor="end" fontSize="8" fill="var(--color-danger)">-1</text>

 {/* Curves */}
 <path d={makePath(phaseOverTimeA)} fill="none" stroke="var(--color-sand-500)" strokeWidth="1" opacity="0.5" />
 <path d={makePath(phaseOverTimeB)} fill="none" stroke="var(--color-warm-amber)" strokeWidth="1.5" opacity="0.8" />
 </svg>

 {/* Time ruler */}
 <div className="flex justify-between mt-1 px-8 text-[8px] text-dark-500">
 <span>0:00</span>
 <span>{formatTime(durationSec / 2)}</span>
 <span>{formatTime(durationSec)}</span>
 </div>
 </div>

 {/* Labels */}
 <div className="flex items-center gap-4 text-[10px]">
 <span className="text-dark-400">+1 = perfect mono compat</span>
 <span className="text-dark-400">0 = no correlation</span>
 <span className="text-dark-400">-1 = out of phase</span>
 {problemsB.length > 0 && (
 <span className="text-red-400 ml-auto">{problemsB.length} phase issue{problemsB.length > 1 ? 's' : ''} in {labelB}</span>
 )}
 </div>
 </div>
 )
}

function formatTime(seconds: number): string {
 const mins = Math.floor(seconds / 60)
 const secs = Math.floor(seconds % 60)
 return `${mins}:${secs.toString().padStart(2, '0')}`
}
