import React, { useMemo } from 'react'

interface Props {
 // Stereo data points sampled from the audio (L/R pairs)
 pointsA: { l: number; r: number }[]
 pointsB: { l: number; r: number }[]
 labelA: string
 labelB: string
}

export default function Vectorscope({ pointsA, pointsB, labelA, labelB }: Props) {
 const size = 200
 const center = size / 2

 // 5.3.1 fix: render the canonical engineer's Lissajous —
 //   vertical axis = mid (mono compatibility lies along the V axis)
 //   horizontal axis = side (anti-phase / wide content spreads on H)
 //   L peak → upper-left, R peak → upper-right
 // Pre-5.3 the code put mid on X / side on Y AND mislabelled the
 // axes ("M" was at the top but the math made the top side-not-mid),
 // so engineers reading the chart got the OPPOSITE conclusion from
 // what they expected. The 0.5 normalisation keeps the unit-amplitude
 // square inside the visible square (was 0.7, which clipped at the
 // corners on hot signals).
 const toSvgPoints = (points: { l: number; r: number }[], maxPts: number = 2000) => {
 const step = Math.max(1, Math.floor(points.length / maxPts))
 const pts: { x: number; y: number }[] = []
 const k = 0.5  // L=R=1 → corners stay inside [0, size]
 for (let i = 0; i < points.length; i += step) {
 const { l, r } = points[i]
 // Side on horizontal: positive when R>L → right; negative → left.
 const x = center + (r - l) * center * k
 // Mid on vertical: positive (L+R>0) → up. SVG y inverted, so subtract.
 const y = center - (l + r) * center * k
 pts.push({ x: Math.max(0, Math.min(size, x)), y: Math.max(0, Math.min(size, y)) })
 }
 return pts
 }

 const svgA = useMemo(() => toSvgPoints(pointsA), [pointsA])
 const svgB = useMemo(() => toSvgPoints(pointsB), [pointsB])

 return (
 <div className="bg-dark-900 rounded-2xl p-6 border border-dark-700/50 space-y-4">
 <div className="space-y-1">
 <h2 className="text-lg font-semibold">Stereo Vectorscope</h2>
 <p className="text-xs text-dark-400">Lissajous display — compare stereo image shape and width</p>
 </div>

 <div className="grid grid-cols-2 gap-4">
 {/* File A */}
 <div className="space-y-2">
 <span className="text-xs text-dark-400">{labelA}</span>
 <div className="bg-dark-800 rounded-xl p-2 flex items-center justify-center">
 <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[200px]" style={{ aspectRatio: '1' }}>
 {/* Grid */}
 <line x1={center} y1={0} x2={center} y2={size} stroke="#4c4d52" strokeWidth="0.5" opacity="0.3" />
 <line x1={0} y1={center} x2={size} y2={center} stroke="#4c4d52" strokeWidth="0.5" opacity="0.3" />
 {/* Diagonal guides (L and R) */}
 <line x1={0} y1={size} x2={size} y2={0} stroke="#4c4d52" strokeWidth="0.3" opacity="0.2" />
 <line x1={0} y1={0} x2={size} y2={size} stroke="#4c4d52" strokeWidth="0.3" opacity="0.2" />
 {/* Labels — canonical Lissajous: M top/bottom (vertical = mid),
     S left/right (horizontal = side), L diagonal upper-left,
     R diagonal upper-right. */}
 <text x={center} y={8} textAnchor="middle" fontSize="7" fill="#696a71">M</text>
 <text x={center} y={size - 3} textAnchor="middle" fontSize="7" fill="#696a71">M</text>
 <text x={8} y={center - 2} textAnchor="middle" fontSize="7" fill="#696a71">S</text>
 <text x={size - 8} y={center - 2} textAnchor="middle" fontSize="7" fill="#696a71">S</text>
 <text x={size * 0.18} y={size * 0.18} textAnchor="middle" fontSize="7" fill="#8d867b">L</text>
 <text x={size * 0.82} y={size * 0.18} textAnchor="middle" fontSize="7" fill="#8d867b">R</text>
 {/* Points */}
 {svgA.map((p, i) => (
 <circle key={i} cx={p.x} cy={p.y} r="0.8" fill="#6b7280" opacity="0.15" />
 ))}
 </svg>
 </div>
 </div>

 {/* File B */}
 <div className="space-y-2">
 <span className="text-xs text-amber-400">{labelB}</span>
 <div className="bg-dark-800 rounded-xl p-2 flex items-center justify-center">
 <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[200px]" style={{ aspectRatio: '1' }}>
 {/* Grid */}
 <line x1={center} y1={0} x2={center} y2={size} stroke="#4c4d52" strokeWidth="0.5" opacity="0.3" />
 <line x1={0} y1={center} x2={size} y2={center} stroke="#4c4d52" strokeWidth="0.5" opacity="0.3" />
 <line x1={0} y1={size} x2={size} y2={0} stroke="#4c4d52" strokeWidth="0.3" opacity="0.2" />
 <line x1={0} y1={0} x2={size} y2={size} stroke="#4c4d52" strokeWidth="0.3" opacity="0.2" />
 <text x={center} y={8} textAnchor="middle" fontSize="7" fill="#696a71">M</text>
 <text x={8} y={center - 2} textAnchor="middle" fontSize="7" fill="#696a71">L</text>
 <text x={size - 8} y={center - 2} textAnchor="middle" fontSize="7" fill="#696a71">R</text>
 <text x={center} y={size - 3} textAnchor="middle" fontSize="7" fill="#696a71">S</text>
 {/* Points */}
 {svgB.map((p, i) => (
 <circle key={i} cx={p.x} cy={p.y} r="0.8" fill="#f59e0b" opacity="0.15" />
 ))}
 </svg>
 </div>
 </div>
 </div>

 <div className="text-[10px] text-dark-500">
 Vertical axis = mid (mono). Horizontal axis = side. L sits upper-left, R upper-right.
 A vertical line through centre = mono-compatible. Cloud spreading horizontally = wide stereo.
 A line on the HORIZONTAL axis = anti-phase (will cancel on phones / clubs).
 </div>
 </div>
 )
}
