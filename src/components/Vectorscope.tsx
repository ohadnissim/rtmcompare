import React, { useId, useMemo } from 'react'

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
 // CRIT-1: Instance-unique filter IDs so multiple Vectorscope mounts
 // don't collide on the global SVG filter namespace (phosphor-a/b).
 const uid = useId().replace(/:/g, 'x')
 const filterIdA = `phosphor-a-${uid}`
 const filterIdB = `phosphor-b-${uid}`

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
 <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-4" style={{ borderRadius: '2px' }}>
 <div className="space-y-1">
 <h2 className="text-lg">Stereo Vectorscope</h2>
 <p className="text-xs text-dark-400">Lissajous display — compare stereo image shape and width</p>
 </div>

 <div className="grid grid-cols-2 gap-4">
 {/* File A */}
 <div className="space-y-2">
 <span className="text-xs text-dark-400">{labelA}</span>
 <div className="bg-dark-800 p-2 flex items-center justify-center" style={{ borderRadius: '2px' }}>
 <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[200px]" style={{ aspectRatio: '1' }}>
 <defs>
 {/* Phosphor glow filter — simulates warm phosphor persistence.
     Blurred layer beneath crisp dots mimics the trailing decay
     of hardware vectorscope phosphors. ID is instance-unique
     (useId) so multiple mounted Vectorscopes don't collide. */}
 <filter id={filterIdA} x="-20%" y="-20%" width="140%" height="140%">
 <feGaussianBlur stdDeviation="1.8" result="blur" />
 </filter>
 </defs>
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
 <text x={size * 0.18} y={size * 0.18} textAnchor="middle" fontSize="7" fill="var(--color-text-muted)">L</text>
 <text x={size * 0.82} y={size * 0.18} textAnchor="middle" fontSize="7" fill="var(--color-text-muted)">R</text>
 {/* Phosphor glow layer — blurred dots simulate warm trailing
     persistence of hardware phosphor screens. */}
 <g filter={`url(#${filterIdA})`} opacity="0.4">
 {svgA.map((p, i) => (
 <circle key={i} cx={p.x} cy={p.y} r="1.6" style={{ fill: 'var(--color-sand-500)' }} />
 ))}
 </g>
 {/* Crisp detail layer on top */}
 {svgA.map((p, i) => (
 <circle key={i} cx={p.x} cy={p.y} r="0.7" style={{ fill: 'var(--color-sand-500)' }} opacity="0.22" />
 ))}
 </svg>
 </div>
 </div>

 {/* File B */}
 <div className="space-y-2">
 <span className="text-xs text-amber-400">{labelB}</span>
 <div className="bg-dark-800 p-2 flex items-center justify-center" style={{ borderRadius: '2px' }}>
 <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[200px]" style={{ aspectRatio: '1' }}>
 {/* CRIT-1: Own <defs> with instance-unique filter ID */}
 <defs>
 <filter id={filterIdB} x="-20%" y="-20%" width="140%" height="140%">
 <feGaussianBlur stdDeviation="1.8" result="blur" />
 </filter>
 </defs>
 {/* Grid */}
 <line x1={center} y1={0} x2={center} y2={size} stroke="#4c4d52" strokeWidth="0.5" opacity="0.3" />
 <line x1={0} y1={center} x2={size} y2={center} stroke="#4c4d52" strokeWidth="0.5" opacity="0.3" />
 <line x1={0} y1={size} x2={size} y2={0} stroke="#4c4d52" strokeWidth="0.3" opacity="0.2" />
 <line x1={0} y1={0} x2={size} y2={size} stroke="#4c4d52" strokeWidth="0.3" opacity="0.2" />
 <text x={center} y={8} textAnchor="middle" fontSize="7" fill="#696a71">M</text>
 <text x={8} y={center - 2} textAnchor="middle" fontSize="7" fill="#696a71">L</text>
 <text x={size - 8} y={center - 2} textAnchor="middle" fontSize="7" fill="#696a71">R</text>
 <text x={center} y={size - 3} textAnchor="middle" fontSize="7" fill="#696a71">S</text>
 {/* Phosphor glow layer for File B (amber) */}
 <g filter={`url(#${filterIdB})`} opacity="0.4">
 {svgB.map((p, i) => (
 <circle key={i} cx={p.x} cy={p.y} r="1.6" style={{ fill: 'var(--color-warm-amber)' }} />
 ))}
 </g>
 {/* Crisp detail layer on top */}
 {svgB.map((p, i) => (
 <circle key={i} cx={p.x} cy={p.y} r="0.7" style={{ fill: 'var(--color-warm-amber)' }} opacity="0.22" />
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
