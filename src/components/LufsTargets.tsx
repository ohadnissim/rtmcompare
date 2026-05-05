import React from 'react'

interface Props {
 lufsA: number
 lufsB: number
 labelA: string
 labelB: string
}

const targets = [
 { name: 'Spotify', lufs: -14, color: '#1DB954' },
 { name: 'Apple Music', lufs: -16, color: '#fc3c44' },
 { name: 'YouTube', lufs: -14, color: '#ff0000' },
 { name: 'Tidal', lufs: -14, color: '#000000' },
 { name: 'Amazon Music', lufs: -14, color: '#25d1da' },
 { name: 'Club / DJ', lufs: -8, color: '#f59e0b' },
]

export default function LufsTargets({ lufsA, lufsB, labelA, labelB }: Props) {
 return (
 <div className="bg-dark-900 rounded-2xl p-6 border border-dark-700/50 space-y-4">
 <div className="space-y-1">
 <h2 className="text-lg font-semibold">Streaming Loudness Targets</h2>
 <p className="text-xs text-dark-400">How your files compare to platform normalization targets</p>
 </div>

 <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
 {targets.map(t => {
 const diffA = lufsA - t.lufs
 const diffB = lufsB - t.lufs
 const statusA = getStatus(diffA)
 const statusB = getStatus(diffB)

 return (
 <div key={t.name} className="bg-dark-800 rounded-xl p-3.5 space-y-2.5">
 <div className="flex items-center gap-2">
 <div className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
 <span className="text-xs font-medium text-dark-200">{t.name}</span>
 <span className="text-[9px] text-dark-500 ml-auto">{t.lufs} LUFS</span>
 </div>

 {/* File A */}
 <div className="flex items-center justify-between text-[10px]">
 <span className="text-dark-400 truncate max-w-[120px]">{labelA}</span>
 <span className="font-mono flex-shrink-0" style={{ color: statusA.color }}>
 {diffA > 0 ? `turned down ${diffA.toFixed(1)} dB` : diffA < -1 ? `${Math.abs(diffA).toFixed(1)} dB below` : 'on target'}
 </span>
 </div>

 {/* File B */}
 <div className="flex items-center justify-between text-[10px]">
 <span className="text-amber-400 truncate max-w-[120px]">{labelB}</span>
 <span className="font-mono flex-shrink-0" style={{ color: statusB.color }}>
 {diffB > 0 ? `turned down ${diffB.toFixed(1)} dB` : diffB < -1 ? `${Math.abs(diffB).toFixed(1)} dB below` : 'on target'}
 </span>
 </div>

 {/* Visual bar */}
 <div className="relative h-1.5 bg-dark-700 rounded-full overflow-hidden">
 {/* Target marker */}
 <div className="absolute top-0 bottom-0 w-px bg-dark-400" style={{ left: '50%' }} />
 {/* File A dot */}
 <div
 className="absolute top-0 h-1.5 w-1.5 rounded-full"
 style={{
 left: `${Math.max(5, Math.min(95, 50 + diffA * 3))}%`,
 backgroundColor: '#6b7280',
 transform: 'translateX(-50%)',
 }}
 />
 {/* File B dot */}
 <div
 className="absolute top-0 h-1.5 w-1.5 rounded-full"
 style={{
 left: `${Math.max(5, Math.min(95, 50 + diffB * 3))}%`,
 backgroundColor: '#f59e0b',
 transform: 'translateX(-50%)',
 }}
 />
 </div>
 </div>
 )
 })}
 </div>

 {/* Explanation */}
 <div className="text-[10px] text-dark-500 space-y-1">
 <p>Files louder than the target will be turned down by the platform. Files quieter will be turned up (or left quiet on some platforms).</p>
 <p>Aim for within +/- 1 dB of the target for best results.</p>
 </div>
 </div>
 )
}

function getStatus(diff: number): { color: string; icon: string } {
 const abs = Math.abs(diff)
 if (abs <= 1) return { color: '#34d399', icon: '' }
 if (abs <= 3) return { color: '#f59e0b', icon: '' }
 return { color: '#f43f5e', icon: diff > 0 ? '(will be turned down)' : '(quiet)' }
}
