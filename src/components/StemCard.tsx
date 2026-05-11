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

// Console Didone palette: sand + a single warm accent per stem type.
// No blue/purple/pink — only the sanctioned token set.
// Vocals: warm-amber (most prominent, front-of-mix element)
// Drums: warm-red (transient, impact)
// Bass: teal (low, foundational)
// Other: sand-400 (neutral — not the focal element)
const stemColorMap: Record<string, { bar: string }> = {
 Vocals: { bar: 'var(--color-warm-amber)' },
 Drums:  { bar: 'var(--color-warm-red)' },
 Bass:   { bar: 'var(--color-teal)' },
 Other:  { bar: 'var(--color-sand-400)' },
}

// SVG path data per stem — functional directional icons only, no decoration
const stemIcons: Record<string, string> = {
 Vocals: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z',
 Drums:  'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z',
 Bass:   'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z',
 Other:  'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z',
}

export default function StemCard({ stem, labelA, labelB }: Props) {
 const colors = stemColorMap[stem.name] ?? stemColorMap.Other

 return (
 <div className="stem-card space-y-4">
  {/* Header — stem name only, no decorative colour block */}
  <div className="flex items-center gap-3">
  <svg
   className="w-4 h-4 flex-shrink-0"
   fill="none"
   viewBox="0 0 24 24"
   stroke={colors.bar}
   strokeWidth={1.5}
  >
   <path strokeLinecap="round" strokeLinejoin="round" d={stemIcons[stem.name] ?? stemIcons.Other} />
  </svg>
  <h3 className="text-sm uppercase tracking-[0.12em]" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-sans)' }}>{stem.name}</h3>
  </div>

  {/* Insights */}
  <div className="space-y-1.5">
  {stem.insights.map((insight, i) => (
   <p key={i} className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
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
   textColor={colors.bar}
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
