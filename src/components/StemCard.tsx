import React from 'react'
import { StemAnalysis } from '../types'
import LevelMeter from './LevelMeter'
import StereoField from './StereoField'
import DynamicsChart from './DynamicsChart'

interface Props {
 stem: StemAnalysis
 labelA: string
 labelB: string
}

const stemIcons: Record<string, string> = {
 Vocals: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z',
 Drums: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z',
 Bass: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z',
 Other: 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z',
}

const stemColorMap: Record<string, { bg: string; text: string; bar: string }> = {
 Vocals: { bg: 'rgba(245,158,11,0.2)', text: '#fbbf24', bar: '#f59e0b' },
 Drums: { bg: 'rgba(244,63,94,0.2)', text: '#fb7185', bar: '#f43f5e' },
 Bass: { bg: 'rgba(59,130,246,0.2)', text: '#60a5fa', bar: '#3b82f6' },
 Other: { bg: 'rgba(168,85,247,0.2)', text: '#c084fc', bar: '#a855f7' },
}

export default function StemCard({ stem, labelA, labelB }: Props) {
 const colors = stemColorMap[stem.name] || stemColorMap.Other

 return (
 <div className="stem-card space-y-4">
 {/* Header */}
 <div className="flex items-center gap-3">
 <div
 className="w-9 h-9 rounded-lg flex items-center justify-center"
 style={{ backgroundColor: colors.bg }}
 >
 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke={colors.text}>
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={stemIcons[stem.name] || stemIcons.Other} />
 </svg>
 </div>
 <h3 className="font-semibold text-lg">{stem.name}</h3>
 </div>

 {/* Insights */}
 <div className="space-y-1.5">
 {stem.insights.map((insight, i) => (
 <p key={i} className="text-sm text-dark-300 leading-relaxed">
 {insight}
 </p>
 ))}
 </div>

 {/* Metrics */}
 <div className="grid grid-cols-1 gap-3 pt-2">
 <LevelMeter
 label="Level"
 valueA={stem.level.lufs_a}
 valueB={stem.level.lufs_b}
 diff={stem.level.diff_db}
 unit="dB"
 labelA={labelA}
 labelB={labelB}
 barColor={colors.bar}
 />
 <StereoField
 widthA={stem.stereo.width_a}
 widthB={stem.stereo.width_b}
 panA={stem.stereo.pan_a}
 panB={stem.stereo.pan_b}
 labelA={labelA}
 labelB={labelB}
 barColor={colors.bar}
 textColor={colors.text}
 />
 <DynamicsChart
 rangeA={stem.dynamics.dynamic_range_a}
 rangeB={stem.dynamics.dynamic_range_b}
 diff={stem.dynamics.diff}
 labelA={labelA}
 labelB={labelB}
 barColor={colors.bar}
 />
 </div>
 </div>
 )
}
