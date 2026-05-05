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
 const diffColor = Math.abs(diff) < 0.5 ? '#84858c' : diff > 0 ? '#34d399' : '#fbbf24'

 return (
 <div className="space-y-1.5">
 <div className="flex items-center justify-between">
 <span className="text-xs font-medium text-dark-400 uppercase tracking-wide">{label}</span>
 <span className="text-xs font-mono" style={{ color: diffColor }}>
 {diffSign}{diff.toFixed(1)} {unit}
 </span>
 </div>
 <div className="space-y-1">
 <div className="flex items-center gap-2">
 <span className="text-[10px] text-dark-500 w-6">{labelA}</span>
 <div className="flex-1 bg-dark-800 rounded-full h-2.5">
 <div
 className="h-2.5 rounded-full transition-all duration-700"
 style={{ width: `${widthA}%`, backgroundColor: '#84858c' }}
 />
 </div>
 <span className="text-[10px] text-dark-500 font-mono w-12 text-right">{valueA.toFixed(1)}</span>
 </div>
 <div className="flex items-center gap-2">
 <span className="text-[10px] text-dark-500 w-6">{labelB}</span>
 <div className="flex-1 bg-dark-800 rounded-full h-2.5">
 <div
 className="h-2.5 rounded-full transition-all duration-700"
 style={{ width: `${widthB}%`, backgroundColor: barColor }}
 />
 </div>
 <span className="text-[10px] text-dark-500 font-mono w-12 text-right">{valueB.toFixed(1)}</span>
 </div>
 </div>
 </div>
 )
}
