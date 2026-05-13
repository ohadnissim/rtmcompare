import React from 'react'

interface Props {
 label: string
 valueA: number
 valueB: number
 diff: number
 unit: string
 labelA: string
 labelB: string
 barColor: string
}

export default function LevelMeter({ label, valueA, valueB, diff, unit, labelA, labelB, barColor }: Props) {
 const maxDb = 30
 const widthA = Math.min(100, Math.max(5, ((valueA + maxDb) / maxDb) * 100))
 const widthB = Math.min(100, Math.max(5, ((valueB + maxDb) / maxDb) * 100))

 const diffSign = diff > 0 ? '+' : ''
 // Neutral if near zero; warm-amber if negative (quieter); sage if positive (louder) — no vibrant palette
 const diffColor = Math.abs(diff) < 0.5 ? 'var(--color-sand-400)' : diff > 0 ? 'var(--color-sage)' : 'var(--color-warm-amber)'

 return (
 <div className="space-y-1.5">
 <div className="flex items-center justify-between">
  <span className="text-xs uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
  <span className="text-xs font-mono" style={{ color: diffColor }}>
  {diffSign}{diff.toFixed(1)} {unit}
  </span>
 </div>
 <div className="space-y-1">
  <div className="flex items-center gap-2">
  <span className="text-[10px] w-6" style={{ color: 'var(--color-text-dim)' }}>{labelA}</span>
  <div className="flex-1 h-2.5" style={{ backgroundColor: 'rgba(87,83,78,0.35)', borderRadius: '2px', overflow: 'hidden' }}>
   <div
   className="h-2.5 transition-all duration-700"
   style={{ width: `${widthA}%`, backgroundColor: 'var(--color-sand-400)', borderRadius: '2px' }}
   />
  </div>
  <span className="text-[10px] font-mono w-12 text-right" style={{ color: 'var(--color-text-dim)' }}>{valueA.toFixed(1)}</span>
  </div>
  <div className="flex items-center gap-2">
  <span className="text-[10px] w-6" style={{ color: 'var(--color-text-dim)' }}>{labelB}</span>
  <div className="flex-1 h-2.5" style={{ backgroundColor: 'rgba(87,83,78,0.35)', borderRadius: '2px', overflow: 'hidden' }}>
   <div
   className="h-2.5 transition-all duration-700"
   style={{ width: `${widthB}%`, backgroundColor: barColor, borderRadius: '2px' }}
   />
  </div>
  <span className="text-[10px] font-mono w-12 text-right" style={{ color: 'var(--color-text-dim)' }}>{valueB.toFixed(1)}</span>
  </div>
 </div>
 </div>
 )
}
