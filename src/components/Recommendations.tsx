import React from 'react'
import { Recommendation } from '../types'

interface Props {
 recommendations: Recommendation[]
 labelA: string
 labelB: string
}

const priorityConfig = {
 high: { label: 'High', color: '#f43f5e', bg: 'rgba(244,63,94,0.12)', border: 'rgba(244,63,94,0.25)' },
 medium: { label: 'Med', color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.20)' },
 low: { label: 'Low', color: '#34d399', bg: 'rgba(52,211,153,0.10)', border: 'rgba(52,211,153,0.20)' },
}

export default function Recommendations({ recommendations, labelA, labelB }: Props) {
 if (!recommendations || recommendations.length === 0) return null

 const highCount = recommendations.filter(r => r.priority === 'high').length
 const medCount = recommendations.filter(r => r.priority === 'medium').length

 return (
 <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-5" style={{ borderRadius: '2px' }}>
 <div className="flex items-center justify-between">
 <div className="space-y-1">
 <h2 className="text-lg font-semibold">Recommendations</h2>
 <p className="text-xs text-dark-400">
 How to bring <span className="text-amber-400">{labelB}</span> closer to{' '}
 <span className="text-dark-200">{labelA}</span>'s style while keeping improvements
 </p>
 </div>
 <div className="flex items-center gap-2">
 {highCount > 0 && (
 <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
 style={{ color: priorityConfig.high.color, backgroundColor: priorityConfig.high.bg }}>
 {highCount} high
 </span>
 )}
 {medCount > 0 && (
 <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
 style={{ color: priorityConfig.medium.color, backgroundColor: priorityConfig.medium.bg }}>
 {medCount} med
 </span>
 )}
 </div>
 </div>

 <div className="space-y-2.5">
 {recommendations.map((rec, i) => {
 const config = priorityConfig[rec.priority]
 return (
 <div
 key={i}
 className="p-3.5 flex gap-3"
 style={{ borderRadius: '2px', backgroundColor: config.bg, borderLeft: `3px solid ${config.border}` }}
 >
 <div className="flex-shrink-0 pt-0.5">
 <span
 className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
 style={{ color: config.color, backgroundColor: `${config.color}20` }}
 >
 {config.label}
 </span>
 </div>
 <div
 className="space-y-1 min-w-0 cursor-pointer"
 onClick={() => navigator.clipboard.writeText(`${rec.area}: ${rec.action}`)}
 title="Click to copy"
 >
 <span className="text-xs font-medium text-dark-200">{rec.area}</span>
 <p className="text-xs text-dark-300 leading-relaxed hover:text-dark-200 transition-colors">{rec.action}</p>
 </div>
 </div>
 )
 })}
 </div>
 </div>
 )
}
