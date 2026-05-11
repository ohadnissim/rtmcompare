import React from 'react'

interface Props {
 widthA: number
 widthB: number
 panA: number
 panB: number
 labelA: string
 labelB: string
 barColor: string
 textColor: string
}

export default function StereoField({ widthA, widthB, panA, panB, labelA, labelB, barColor, textColor }: Props) {
 const widthDiff = widthB - widthA
 const widthLabel = Math.abs(widthDiff) < 0.03
 ? 'Same width'
 : widthDiff > 0 ? 'Wider' : 'Narrower'

 return (
 <div className="space-y-1.5">
 <div className="flex items-center justify-between">
 <span className="text-xs font-medium text-dark-400 uppercase tracking-wide">Stereo</span>
 <span className="text-xs text-dark-400">{widthLabel}</span>
 </div>
 <div className="relative h-10 bg-dark-800 overflow-hidden" style={{ borderRadius: '2px' }}>
 {/* Center line */}
 <div className="absolute top-0 bottom-0 left-1/2 w-px bg-dark-600" />
 {/* L/R labels */}
 <span className="absolute top-1 left-2 text-[9px] text-dark-500">L</span>
 <span className="absolute top-1 right-2 text-[9px] text-dark-500">R</span>
 {/* File A width */}
 <div
 className="absolute top-1.5 h-3 rounded"
 style={{
 left: `${50 + (panA - widthA / 2) * 50}%`,
 width: `${Math.max(widthA * 50, 2)}%`,
 backgroundColor: 'rgba(132,133,140,0.4)',
 }}
 />
 {/* File B width */}
 <div
 className="absolute bottom-1.5 h-3 rounded"
 style={{
 left: `${50 + (panB - widthB / 2) * 50}%`,
 width: `${Math.max(widthB * 50, 2)}%`,
 backgroundColor: `${barColor}66`,
 }}
 />
 {/* Labels */}
 <span className="absolute top-1.5 right-2 text-[9px] text-dark-400">{labelA}</span>
 <span className="absolute bottom-1.5 right-2 text-[9px]" style={{ color: textColor }}>{labelB}</span>
 </div>
 </div>
 )
}
