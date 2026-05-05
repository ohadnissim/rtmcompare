import React from 'react'

interface Props {
 rangeA: number
 rangeB: number
 diff: number
 labelA: string
 labelB: string
 barColor: string
}

export default function DynamicsChart({ rangeA, rangeB, diff, labelA, labelB, barColor }: Props) {
 const maxRange = 20
 const pctA = Math.min(100, (rangeA / maxRange) * 100)
 const pctB = Math.min(100, (rangeB / maxRange) * 100)

 const label = Math.abs(diff) < 0.5
 ? 'Similar dynamics'
 : diff < 0 ? 'More compressed' : 'More dynamic'

 return (
 <div className="space-y-1.5">
 <div className="flex items-center justify-between">
 <span className="text-xs font-medium text-dark-400 uppercase tracking-wide">Dynamics</span>
 <span className="text-xs text-dark-400">{label}</span>
 </div>
 <div className="space-y-1">
 <div className="flex items-center gap-2">
 <span className="text-[10px] text-dark-500 w-6">{labelA}</span>
 <div className="flex-1 bg-dark-800 rounded-full h-2">
 <div
 className="h-2 rounded-full transition-all duration-700"
 style={{ width: `${pctA}%`, backgroundColor: '#84858c' }}
 />
 </div>
 </div>
 <div className="flex items-center gap-2">
 <span className="text-[10px] text-dark-500 w-6">{labelB}</span>
 <div className="flex-1 bg-dark-800 rounded-full h-2">
 <div
 className="h-2 rounded-full transition-all duration-700"
 style={{ width: `${pctB}%`, backgroundColor: barColor }}
 />
 </div>
 </div>
 </div>
 <div className="flex justify-between text-[9px] text-dark-500">
 <span>Compressed</span>
 <span>Dynamic</span>
 </div>
 </div>
 )
}
