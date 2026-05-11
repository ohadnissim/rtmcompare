import React from 'react'

interface Props {
 lufsA: number
 lufsB: number
 labelA: string
 labelB: string
}

const targets = [
 { name: 'Spotify', lufs: -14 },
 { name: 'Apple Music', lufs: -16 },
 { name: 'YouTube', lufs: -14 },
 { name: 'Tidal', lufs: -14 },
 { name: 'Amazon Music', lufs: -14 },
 { name: 'Club / DJ', lufs: -8 },
]

export default function LufsTargets({ lufsA, lufsB, labelA, labelB }: Props) {
 return (
 <div className="space-y-4" style={{ borderRadius: '2px', padding: '1.5rem', backgroundColor: 'rgba(30,28,24,0.4)', border: '1px solid rgba(168,161,150,0.08)' }}>
 <div className="space-y-1">
 <h3 className="text-sm">Streaming Loudness Targets</h3>
 <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>How your files compare to platform normalization targets</p>
 </div>

 <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
 {targets.map(t => {
  const diffA = lufsA - t.lufs
  const diffB = lufsB - t.lufs
  const statusA = getStatus(diffA)
  const statusB = getStatus(diffB)

  return (
  <div key={t.name} className="space-y-2.5" style={{ backgroundColor: 'rgba(30,28,24,0.6)', border: '1px solid rgba(168,161,150,0.08)', borderRadius: '2px', padding: '0.875rem' }}>
   <div className="flex items-center gap-2">
   <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t.name}</span>
   <span className="text-[9px] ml-auto font-mono" style={{ color: 'var(--color-text-dim)' }}>{t.lufs} LUFS</span>
   </div>

   {/* File A */}
   <div className="flex items-center justify-between text-[10px]">
   <span className="truncate max-w-[120px]" style={{ color: 'var(--color-text-muted)' }}>{labelA}</span>
   <span className="font-mono flex-shrink-0" style={{ color: statusA.color }}>
    {diffA > 0 ? `turned down ${diffA.toFixed(1)} dB` : diffA < -1 ? `${Math.abs(diffA).toFixed(1)} dB below` : 'on target'}
   </span>
   </div>

   {/* File B */}
   <div className="flex items-center justify-between text-[10px]">
   <span className="truncate max-w-[120px]" style={{ color: 'var(--color-terra)' }}>{labelB}</span>
   <span className="font-mono flex-shrink-0" style={{ color: statusB.color }}>
    {diffB > 0 ? `turned down ${diffB.toFixed(1)} dB` : diffB < -1 ? `${Math.abs(diffB).toFixed(1)} dB below` : 'on target'}
   </span>
   </div>

   {/* Visual bar */}
   <div className="relative h-1.5 overflow-hidden" style={{ backgroundColor: 'rgba(87,83,78,0.35)', borderRadius: '2px' }}>
   {/* Target marker */}
   <div className="absolute top-0 bottom-0 w-px" style={{ left: '50%', backgroundColor: 'rgba(168,161,150,0.3)' }} />
   {/* File A dot */}
   <div
    className="absolute top-0 h-1.5 w-1.5"
    style={{
    left: `${Math.max(5, Math.min(95, 50 + diffA * 3))}%`,
    backgroundColor: 'var(--color-sand-400)',
    transform: 'translateX(-50%)',
    borderRadius: '2px',
    }}
   />
   {/* File B dot */}
   <div
    className="absolute top-0 h-1.5 w-1.5"
    style={{
    left: `${Math.max(5, Math.min(95, 50 + diffB * 3))}%`,
    backgroundColor: 'var(--color-terra)',
    transform: 'translateX(-50%)',
    borderRadius: '2px',
    }}
   />
   </div>
  </div>
  )
 })}
 </div>

 {/* Explanation */}
 <div className="text-[10px] space-y-1" style={{ color: 'var(--color-text-dim)' }}>
 <p>Files louder than the target will be turned down by the platform. Files quieter will be turned up (or left quiet on some platforms).</p>
 <p>Aim for within +/- 1 dB of the target for best results.</p>
 </div>
 </div>
 )
}

function getStatus(diff: number): { color: string } {
 const abs = Math.abs(diff)
 if (abs <= 1) return { color: 'var(--color-sage)' }
 if (abs <= 3) return { color: 'var(--color-warm-amber)' }
 return { color: 'var(--color-warm-red)' }
}
