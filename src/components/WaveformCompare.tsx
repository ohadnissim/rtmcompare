import React, { useState } from 'react'

interface Props {
 waveformA: number[]
 waveformB: number[]
 labelA: string
 labelB: string
 durationSec: number
 singleFile?: boolean
}

type ViewMode = 'overlay' | 'split'

export default function WaveformCompare({ waveformA, waveformB, labelA, labelB, durationSec, singleFile }: Props) {
 const [view, setView] = useState<ViewMode>('overlay')
 const w = 800
 const h = view === 'split' ? 160 : 120

 const makePath = (data: number[], baseline: number, amplitude: number): string => {
 const points = data.map((v, i) => ({
 x: (i / (data.length - 1)) * w,
 y: baseline - v * amplitude,
 }))
 // Mirror for waveform shape
 const bottom = data.map((v, i) => ({
 x: (i / (data.length - 1)) * w,
 y: baseline + v * amplitude,
 })).reverse()

 const allPts = [...points, ...bottom]
 if (allPts.length < 2) return ''
 return `M ${allPts[0].x} ${allPts[0].y} ` + allPts.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ') + ' Z'
 }

 return (
 <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-4" style={{ borderRadius: '2px' }}>
 <div className="flex items-center justify-between">
 <div className="space-y-1">
 <h2 className="text-lg font-semibold">{singleFile ? 'Waveform' : 'Waveform Compare'}</h2>
 <p className="text-xs text-dark-400">Visualize dynamics and limiting — see the shape of the audio</p>
 </div>
 {!singleFile && (
 <div className="flex items-center gap-2">
 <button
 onClick={() => setView('overlay')}
 className="text-[10px] px-2 py-1 rounded"
 style={{
 backgroundColor: view === 'overlay' ? 'rgba(255,255,255,0.08)' : 'transparent',
 color: view === 'overlay' ? '#fff' : '#84858c',
 }}
 >
 Overlay
 </button>
 <button
 onClick={() => setView('split')}
 className="text-[10px] px-2 py-1 rounded"
 style={{
 backgroundColor: view === 'split' ? 'rgba(255,255,255,0.08)' : 'transparent',
 color: view === 'split' ? '#fff' : '#84858c',
 }}
 >
 Split
 </button>
 </div>
 )}
 </div>

 <div className="bg-dark-800 p-3 overflow-hidden" style={{ borderRadius: '2px' }}>
 {view === 'overlay' ? (
 <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-28" preserveAspectRatio="none">
 <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke="#4c4d52" strokeWidth="0.5" opacity="0.3" />
 <path d={makePath(waveformA, h / 2, h * 0.4)} fill="#6b8cbb" opacity="0.45" />
 <path d={makePath(waveformB, h / 2, h * 0.4)} fill="#e07a4f" opacity="0.4" />
 </svg>
 ) : (
 <div className="space-y-1">
 {/* File A */}
 <div className="relative">
 <span className="absolute top-0 left-1 text-[9px] z-10" style={{ color: '#6b8cbb' }}>{labelA}</span>
 <svg viewBox={`0 0 ${w} ${h / 2}`} className="w-full h-16" preserveAspectRatio="none">
 <line x1={0} y1={h / 4} x2={w} y2={h / 4} stroke="#4c4d52" strokeWidth="0.5" opacity="0.3" />
 <path d={makePath(waveformA, h / 4, h * 0.2)} fill="#6b8cbb" opacity="0.6" />
 </svg>
 </div>
 {/* File B */}
 <div className="relative">
 <span className="absolute top-0 left-1 text-[9px] z-10" style={{ color: '#e07a4f' }}>{labelB}</span>
 <svg viewBox={`0 0 ${w} ${h / 2}`} className="w-full h-16" preserveAspectRatio="none">
 <line x1={0} y1={h / 4} x2={w} y2={h / 4} stroke="#4c4d52" strokeWidth="0.5" opacity="0.3" />
 <path d={makePath(waveformB, h / 4, h * 0.2)} fill="#e07a4f" opacity="0.55" />
 </svg>
 </div>
 </div>
 )}

 {/* Time ruler */}
 <div className="flex justify-between mt-1 px-1 text-[8px] text-dark-500">
 <span>0:00</span>
 <span>{formatTime(durationSec / 4)}</span>
 <span>{formatTime(durationSec / 2)}</span>
 <span>{formatTime(durationSec * 3 / 4)}</span>
 <span>{formatTime(durationSec)}</span>
 </div>
 </div>

 {/* Legend */}
 {!singleFile && (
 <div className="flex items-center gap-4 text-xs">
 <div className="flex items-center gap-1.5">
 <div className="w-4 h-3 rounded-sm" style={{ backgroundColor: '#6b8cbb', opacity: 0.6 }} />
 <span className="text-dark-400">{labelA}</span>
 </div>
 <div className="flex items-center gap-1.5">
 <div className="w-4 h-3 rounded-sm" style={{ backgroundColor: '#e07a4f', opacity: 0.55 }} />
 <span className="text-dark-400">{labelB}</span>
 </div>
 </div>
 )}
 </div>
 )
}

function formatTime(seconds: number): string {
 const mins = Math.floor(seconds / 60)
 const secs = Math.floor(seconds % 60)
 return `${mins}:${secs.toString().padStart(2, '0')}`
}
