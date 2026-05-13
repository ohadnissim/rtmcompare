import React, { useMemo } from 'react'
import { ChannelEnergy } from '../types'

interface Props {
 channels: ChannelEnergy[]
 heightRatio: number
 centerExtraction: number
}

// Map channel positions to SVG coordinates on a top-down view
// Front at top, rear at bottom, left on left, right on right
const SPEAKER_POSITIONS: Record<string, { x: number; y: number; isHeight?: boolean }> = {
 L: { x: 35, y: 25 },
 R: { x: 65, y: 25 },
 C: { x: 50, y: 15 },
 LFE: { x: 50, y: 90 },
 Ls: { x: 15, y: 55 },
 Rs: { x: 85, y: 55 },
 Lrs: { x: 25, y: 80 },
 Rrs: { x: 75, y: 80 },
 Ltf: { x: 35, y: 30, isHeight: true },
 Rtf: { x: 65, y: 30, isHeight: true },
 Ltr: { x: 25, y: 70, isHeight: true },
 Rtr: { x: 75, y: 70, isHeight: true },
}

export default function AtmosSurroundField({ channels, heightRatio, centerExtraction }: Props) {
 const size = 200

 // Map channel energy to visual sizes
 const maxDb = useMemo(() => {
 const active = channels.filter(c => c.level_db > -50 && c.group !== 'lfe')
 return active.length > 0 ? Math.max(...active.map(c => c.level_db)) : 0
 }, [channels])

 const channelDots = useMemo(() => {
 return channels.map(ch => {
 const pos = SPEAKER_POSITIONS[ch.channel]
 if (!pos) return null

 const isActive = ch.level_db > -40
 const normalizedLevel = isActive ? Math.max(0, (ch.level_db - (-60)) / (maxDb - (-60))) : 0
 const radius = ch.group === 'lfe'
 ? (isActive ? 6 : 3)
 : 4 + normalizedLevel * 10

 let color = 'var(--color-data-a)'
 if (ch.group === 'height') color = 'var(--color-slate-blue)'
 if (ch.group === 'lfe') color = 'var(--color-danger)'

 return {
 ...ch,
 pos,
 radius,
 color,
 isActive,
 isHeight: pos.isHeight || false,
 }
 }).filter(Boolean) as NonNullable<ReturnType<typeof channels.map>[number]>[]
 }, [channels, maxDb])

 return (
 <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-4" style={{ borderRadius: '2px' }}>
 <div className="space-y-1">
 <h2 className="text-lg">Surround Field</h2>
 <p className="text-xs text-dark-400">
 Top-down speaker layout — circle size = energy level
 </p>
 </div>

 <div className="flex items-start gap-6">
 {/* SVG surround field */}
 <div className="bg-dark-800 p-3 flex items-center justify-center flex-1" style={{ borderRadius: '2px' }}>
 <svg viewBox="0 0 100 100" className="w-full max-w-[280px]" style={{ aspectRatio: '1' }}>
 {/* Listener position */}
 <circle cx={50} cy={50} r={2} fill="#57534e" />
 <text x={50} y={54} textAnchor="middle" fontSize="3" fill="#57534e">you</text>

 {/* Reference circles */}
 <circle cx={50} cy={50} r={30} fill="none" stroke="#2a2927" strokeWidth="0.3" />
 <circle cx={50} cy={50} r={15} fill="none" stroke="#2a2927" strokeWidth="0.3" />

 {/* Direction labels */}
 <text x={50} y={5} textAnchor="middle" fontSize="3.5" fill="#4a4845">FRONT</text>
 <text x={50} y={98} textAnchor="middle" fontSize="3.5" fill="#4a4845">REAR</text>
 <text x={3} y={52} textAnchor="start" fontSize="3.5" fill="#4a4845">L</text>
 <text x={97} y={52} textAnchor="end" fontSize="3.5" fill="#4a4845">R</text>

 {/* Speaker dots */}
 {channelDots.map((ch: any) => (
 <g key={ch.channel}>
 {/* Height channels: dashed ring */}
 {ch.isHeight && (
 <circle
 cx={ch.pos.x} cy={ch.pos.y} r={ch.radius + 2}
 fill="none" stroke={ch.color} strokeWidth="0.4"
 strokeDasharray="1.5 1" opacity={ch.isActive ? 0.5 : 0.15}
 />
 )}
 {/* Energy circle */}
 <circle
 cx={ch.pos.x} cy={ch.pos.y} r={ch.radius}
 fill={ch.color}
 opacity={ch.isActive ? 0.6 : 0.1}
 />
 {/* Label */}
 <text
 x={ch.pos.x} y={ch.pos.y + ch.radius + 5}
 textAnchor="middle" fontSize="3" fill={ch.isActive ? 'var(--color-sand-300)' : 'var(--color-text-muted)'}
 >
 {ch.channel}
 </text>
 </g>
 ))}
 </svg>
 </div>

 {/* Metrics sidebar */}
 <div className="space-y-4 min-w-[140px]">
 <div className="space-y-1">
 <span className="text-[10px] text-dark-500 uppercase tracking-wider">Height Energy</span>
 <div className="text-xl font-semibold" style={{ color: heightRatio > 0.05 ? 'var(--color-slate-blue)' : 'var(--color-text-muted)' }}>
 {(heightRatio * 100).toFixed(1)}%
 </div>
 <span className="text-[10px] text-dark-500">
 {heightRatio < 0.03 ? 'Very little height content' :
 heightRatio < 0.10 ? 'Subtle height use' :
 heightRatio < 0.25 ? 'Moderate height content' :
 'Strong height presence'}
 </span>
 </div>

 <div className="space-y-1">
 <span className="text-[10px] text-dark-500 uppercase tracking-wider">Center Extraction</span>
 <div className="text-xl font-semibold" style={{ color: centerExtraction > 0.5 ? 'var(--color-data-pass)' : 'var(--color-data-warn)' }}>
 {(centerExtraction * 100).toFixed(0)}%
 </div>
 <span className="text-[10px] text-dark-500">
 {centerExtraction > 0.8 ? 'Excellent center isolation' :
 centerExtraction > 0.5 ? 'Good center match' :
 centerExtraction > 0.2 ? 'Moderate correlation' :
 'Weak center match'}
 </span>
 </div>

 {/* Legend */}
 <div className="space-y-1.5 pt-2 border-t border-dark-700/50">
 <div className="flex items-center gap-2">
 <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--color-data-a)' }} />
 <span className="text-[10px] text-dark-500">Ear-level</span>
 </div>
 <div className="flex items-center gap-2">
 <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--color-slate-blue)' }} />
 <span className="text-[10px] text-dark-500">Height</span>
 </div>
 <div className="flex items-center gap-2">
 <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--color-danger)' }} />
 <span className="text-[10px] text-dark-500">LFE</span>
 </div>
 </div>
 </div>
 </div>
 </div>
 )
}
