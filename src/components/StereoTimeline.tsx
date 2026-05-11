import React from 'react'

interface Timeline {
 width: number[]
 correlation: number[]
 balance: number[]
}

interface Props {
 timelineA: Timeline
 timelineB: Timeline
 labelA: string
 labelB: string
 durationSec?: number
 soloA?: boolean
}

export default function StereoTimeline({ timelineA, timelineB, labelA, labelB, durationSec, soloA }: Props) {
 if (!timelineA || !timelineA.width || timelineA.width.length < 2) return null
 const twoCol = !soloA && timelineB && timelineB.width && timelineB.width.length >= 2

 return (
 <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-5" style={{ borderRadius: '2px' }}>
 <div className="space-y-1">
 <h2 className="text-lg font-semibold">Stereo Image Over Time</h2>
 <p className="text-xs text-dark-400">
 Section-by-section width, L/R correlation, and left/right balance — surfaces drops, bridges, mono collapses, and accidental pan drift.
 </p>
 </div>

 <div className="space-y-4">
 <StereoLane title="Width (side/total energy)" a={timelineA.width} b={twoCol ? timelineB.width : undefined}
 labelA={labelA} labelB={labelB} durationSec={durationSec}
 range={[0, 0.5]} colorA="#8a95ab" colorB="#d0b066"
 mid={0.15}
 interpret={(v) => v < 0.05 ? 'Near-mono' : v < 0.15 ? 'Narrow' : v < 0.30 ? 'Stereo' : 'Wide'} />
 <StereoLane title="L/R correlation" a={timelineA.correlation} b={twoCol ? timelineB.correlation : undefined}
 labelA={labelA} labelB={labelB} durationSec={durationSec}
 range={[-1, 1]} colorA="#8a95ab" colorB="#d0b066"
 mid={0}
 interpret={(v) => v > 0.9 ? 'Mono-compat' : v > 0.5 ? 'Stereo' : v > 0 ? 'Wide' : 'Out of phase'} />
 <StereoLane title="L/R balance" a={timelineA.balance} b={twoCol ? timelineB.balance : undefined}
 labelA={labelA} labelB={labelB} durationSec={durationSec}
 range={[-0.5, 0.5]} colorA="#8a95ab" colorB="#d0b066"
 mid={0}
 interpret={(v) => Math.abs(v) < 0.05 ? 'Centred' : v > 0 ? `+${(v*100).toFixed(0)}% right` : `${(v*100).toFixed(0)}% left`} />
 </div>
 </div>
 )
}

function StereoLane({ title, a, b, labelA, labelB, durationSec, range, colorA, colorB, mid, interpret }: {
 title: string
 a: number[]
 b?: number[]
 labelA: string
 labelB: string
 durationSec?: number
 range: [number, number]
 colorA: string
 colorB: string
 mid: number
 interpret: (v: number) => string
}) {
 const w = 800
 const h = 50
 const [ymin, ymax] = range
 const scaleY = (v: number) => h - ((v - ymin) / (ymax - ymin)) * h

 const path = (data: number[]): string => {
 if (!data.length) return ''
 return data.map((v, i) => {
 const x = (i / Math.max(1, data.length - 1)) * w
 const y = scaleY(Math.min(ymax, Math.max(ymin, v)))
 return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
 }).join(' ')
 }

 // Median for quick interpretation
 const sorted = [...a].sort((x, y) => x - y)
 const medianA = sorted[Math.floor(sorted.length / 2)]

 return (
 <div className="space-y-1">
 <div className="flex items-baseline justify-between text-[10px]">
 <span className="text-dark-300 uppercase tracking-[0.1em]">{title}</span>
 <span className="text-dark-500 font-mono">{interpret(medianA)}</span>
 </div>
 <div className="bg-dark-800 p-2" style={{ borderRadius: '2px' }}>
 <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10" preserveAspectRatio="none">
 <line x1={0} x2={w} y1={scaleY(mid)} y2={scaleY(mid)} stroke="#4c4d52" strokeWidth="0.5" strokeDasharray="4 3" opacity="0.6" />
 <path d={path(a)} fill="none" stroke={colorA} strokeWidth="1.5" opacity="0.85" />
 {b && <path d={path(b)} fill="none" stroke={colorB} strokeWidth="1.5" opacity="0.85" />}
 </svg>
 {durationSec && (
 <div className="flex justify-between text-[8px] text-dark-500 mt-0.5 font-mono px-1">
 <span>0:00</span>
 <span>{formatTime(durationSec / 2)}</span>
 <span>{formatTime(durationSec)}</span>
 </div>
 )}
 </div>
 <div className="flex items-center gap-3 text-[9px]">
 <span className="flex items-center gap-1"><span className="w-3 h-0.5" style={{ backgroundColor: colorA }} /><span className="text-dark-400">{labelA}</span></span>
 {b && <span className="flex items-center gap-1"><span className="w-3 h-0.5" style={{ backgroundColor: colorB }} /><span className="text-dark-400">{labelB}</span></span>}
 </div>
 </div>
 )
}

function formatTime(seconds: number): string {
 const mins = Math.floor(seconds / 60)
 const secs = Math.floor(seconds % 60)
 return `${mins}:${secs.toString().padStart(2, '0')}`
}
