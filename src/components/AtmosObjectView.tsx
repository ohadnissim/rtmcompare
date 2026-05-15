import React, { useState, useMemo } from 'react'

interface TrajectoryPoint { t: number; az: number; el: number; dist: number }

interface Props {
 view: {
 object_count: number
 heatmap_grid: number[][] // [el_bins][az_bins]
 heatmap_dims: { az_bins: number; el_bins: number }
 trajectories: { name: string; cf_id: string; points: TrajectoryPoint[] }[]
 stats: { name: string; motion: string; travel_deg: number; height_pct: number; duration_sec: number; start_sec: number; end_sec: number }[]
 heights_over_time: [number, number][]
 duration_sec: number
 }
}

/**
 * Atmos Object Trajectory — three linked views:
 * 1. Top-down heatmap (az + el projected): shows where objects CLUSTER in the field
 * 2. Time-scrubbed trajectory paths: shows how each object MOVES
 * 3. Height-over-time chart: what fraction of objects live above horizon per second
 * 4. Per-object motion stats card
 *
 * Uses Dolby convention: azimuth 0 = front, +90 = left, -90 = right.
 */

const MOTION_COLOR: Record<string, string> = {
 'static': 'var(--color-slate-blue)',
 'slow': 'var(--color-teal)',
 'active': 'var(--color-accent)',
 'flying': 'var(--color-danger)',
}

export default function AtmosObjectView({ view }: Props) {
 const [highlight, setHighlight] = useState<number | null>(null)
 const [tab, setTab] = useState<'heatmap' | 'trails'>('heatmap')

 if (!view || view.object_count === 0) return null

 const { object_count, heatmap_grid, trajectories, stats, heights_over_time, duration_sec } = view

 return (
 <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-4">
 <div className="flex items-center justify-between">
 <div className="space-y-1">
 <h2 className="text-lg">Object Trajectories (Atmos)</h2>
 <p className="text-xs text-dark-400">
 Per-object position over time, extracted from ADM axml metadata.
 {object_count > 0 && ` ${object_count} object${object_count > 1 ? 's' : ''} carrying spatial data.`}
 </p>
 </div>
 <div className="flex gap-1 rounded-full p-0.5" style={{ backgroundColor: 'rgba(42,39,34,0.5)' }}>
 {(['heatmap','trails'] as const).map(k => (
 <button
 key={k}
 onClick={() => setTab(k)}
 className="text-[10px] px-3 py-1 rounded-full transition-colors"
 style={{
 backgroundColor: tab === k ? 'rgba(208,176,102,0.2)' : 'transparent',
 color: tab === k ? 'var(--color-accent)' : 'var(--color-text-muted)',
 }}
 >
 {k === 'heatmap' ? 'Heatmap' : 'Trails'}
 </button>
 ))}
 </div>
 </div>

 {/* Sphere view — heatmap OR trails */}
 <div className="bg-dark-800 p-3">
 {tab === 'heatmap' ? (
 <HeatmapSphere grid={heatmap_grid} />
 ) : (
 <TrajectoryTrails
 trajectories={trajectories}
 highlight={highlight}
 />
 )}
 <div className="flex justify-between mt-2 text-[8px] text-dark-500 font-mono">
 <span>Left 90°</span>
 <span>Front 0°</span>
 <span>Right -90°</span>
 </div>
 </div>

 {/* Height-over-time strip */}
 {heights_over_time.length > 1 && (
 <div className="bg-dark-800/40 p-3 space-y-1">
 <div className="flex items-center justify-between text-[10px] text-dark-500">
 <span className="uppercase tracking-[0.14em]">Objects in height channel over time</span>
 <span className="font-mono">0 → {Math.floor(duration_sec/60)}:{String(Math.floor(duration_sec)%60).padStart(2,'0')}</span>
 </div>
 <HeightOverTime data={heights_over_time} durationSec={duration_sec} />
 </div>
 )}

 {/* Per-object stats list */}
 {stats.length > 0 && (
 <div className="bg-dark-800/40 p-3 space-y-1">
 <div className="flex items-center text-[10px] text-dark-500 px-2 pb-1 border-b border-dark-700/30">
 <span className="flex-1">Object</span>
 <span className="w-20 text-center">Motion</span>
 <span className="w-20 text-center">Travel</span>
 <span className="w-20 text-center">In height</span>
 <span className="w-20 text-right">Active</span>
 </div>
 {stats.slice(0, 40).map((s, i) => {
 const color = MOTION_COLOR[s.motion] || 'var(--color-text-muted)'
 return (
 <div
 key={i}
 onMouseEnter={() => setHighlight(i)}
 onMouseLeave={() => setHighlight(null)}
 className="flex items-center text-[11px] px-2 py-1 rounded hover:bg-dark-700/30 transition-colors cursor-default"
 >
 <span className="flex-1 truncate text-dark-200" title={s.name}>{s.name}</span>
 <span className="w-20 text-center font-mono text-[10px]" style={{ color }}>{s.motion}</span>
 <span className="w-20 text-center font-mono text-[10px] text-dark-400">{isFinite(s.travel_deg) ? s.travel_deg.toFixed(0) : '—'}°</span>
 <span className="w-20 text-center font-mono text-[10px]" style={{ color: s.height_pct > 0.2 ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
 {Math.round(s.height_pct * 100)}%
 </span>
 <span className="w-20 text-right font-mono text-[9px] text-dark-500">
 {formatT(s.start_sec)}–{formatT(s.end_sec)}
 </span>
 </div>
 )
 })}
 </div>
 )}
 </div>
 )
}

/* ─── Heatmap: az x el projected as a top-down fisheye ────────────────────── */

function HeatmapSphere({ grid }: { grid: number[][] }) {
 const W = 520
 const H = 280
 const R = Math.min(W, H) / 2 - 10
 const cx = W / 2
 const cy = H / 2 + 10 // bias down slightly so horizon sits mid-height

 const elBins = grid.length
 const azBins = grid[0]?.length || 0

 // Build concentric rings of wedges.
 // Project (el, az) to (r, θ) where r = (90 - el) / 90 * R (90° elevation = center)
 // and θ = az → x/y.
 const wedges: React.ReactElement[] = []
 for (let ei = 0; ei < elBins; ei++) {
 for (let ai = 0; ai < azBins; ai++) {
 const el = -90 + (ei + 0.5) * (180 / elBins)
 const az = (ai + 0.5) * (360 / azBins)
 const v = grid[ei][ai]
 if (v < 0.02) continue
 // Only draw the upper hemisphere clearly; lower hemisphere shown muted in a ring
 const inUpper = el >= 0
 const r = ((90 - Math.abs(el)) / 90) * R * (inUpper ? 1 : 1.02)
 const angleRad = (az - 90) * Math.PI / 180 // 0° az (front) at top
 const x = cx + r * Math.cos(angleRad)
 const y = cy + r * Math.sin(angleRad)
 const color = inUpper ? `rgba(208,176,102,${0.15 + v * 0.75})` : `rgba(124,164,163,${0.12 + v * 0.55})`
 wedges.push(
 <circle key={`${ei}-${ai}`} cx={x} cy={y} r={6 + v * 6} fill={color} />
 )
 }
 }

 return (
 <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-64">
 {/* Reference rings */}
 {[0.33, 0.66, 1.0].map((f, i) => (
 <circle key={i} cx={cx} cy={cy} r={R * f} fill="none" stroke="var(--color-sand-600)" strokeWidth="0.5" strokeDasharray="3 4" opacity="0.55" />
 ))}
 {/* Cardinal markers */}
 <line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke="var(--color-sand-600)" strokeWidth="0.5" opacity="0.5" />
 <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke="var(--color-sand-600)" strokeWidth="0.5" opacity="0.5" />
 <text x={cx} y={cy - R - 3} fontSize="9" fill="var(--color-sand-500)" textAnchor="middle">FRONT</text>
 <text x={cx - R - 4} y={cy + 3} fontSize="9" fill="var(--color-sand-500)" textAnchor="end">LEFT</text>
 <text x={cx + R + 4} y={cy + 3} fontSize="9" fill="var(--color-sand-500)" textAnchor="start">RIGHT</text>
 <text x={cx} y={cy + R + 12} fontSize="9" fill="var(--color-sand-500)" textAnchor="middle">REAR</text>
 <text x={cx + 4} y={cy - 4} fontSize="8" fill="var(--color-sand-500)">horizon 0°</text>
 <text x={cx + 4} y={cy - R / 3 - 2} fontSize="8" fill="var(--color-sand-500)">+30°</text>
 <text x={cx + 4} y={cy - 2 * R / 3 - 2} fontSize="8" fill="var(--color-sand-500)">+60°</text>

 {/* Heatmap dots */}
 {wedges}
 </svg>
 )
}

/* ─── Trail view: object position paths ───────────────────────────────────── */

function TrajectoryTrails({ trajectories, highlight }: {
 trajectories: { name: string; points: TrajectoryPoint[] }[]
 highlight: number | null
}) {
 const W = 520
 const H = 280
 const R = Math.min(W, H) / 2 - 10
 const cx = W / 2
 const cy = H / 2 + 10

 // Rainbow palette for trails
 const colors = ['var(--color-accent)', 'var(--color-teal)', 'var(--color-danger)', 'var(--color-slate-blue)', 'var(--color-success)', '#a37c52', 'var(--color-warning)', '#8abcb3']

 const project = (az: number, el: number) => {
 const r = ((90 - Math.abs(el)) / 90) * R
 const angleRad = (az - 90) * Math.PI / 180
 return [cx + r * Math.cos(angleRad), cy + r * Math.sin(angleRad)] as const
 }

 return (
 <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-64">
 {/* Reference rings */}
 {[0.33, 0.66, 1.0].map((f, i) => (
 <circle key={i} cx={cx} cy={cy} r={R * f} fill="none" stroke="var(--color-sand-600)" strokeWidth="0.5" strokeDasharray="3 4" opacity="0.4" />
 ))}
 <line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke="var(--color-sand-600)" strokeWidth="0.5" opacity="0.35" />
 <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke="var(--color-sand-600)" strokeWidth="0.5" opacity="0.35" />

 {trajectories.map((tr, ti) => {
 const color = colors[ti % colors.length]
 const isHi = highlight === null || highlight === ti
 if (tr.points.length < 2) {
 const [x, y] = project(tr.points[0].az, tr.points[0].el)
 return <circle key={ti} cx={x} cy={y} r={4} fill={color} opacity={isHi ? 0.9 : 0.25} />
 }
 const d = tr.points.map((p, i) => {
 const [x, y] = project(p.az, p.el)
 return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
 }).join(' ')
 return (
 <g key={ti} opacity={isHi ? 0.85 : 0.18}>
 <path d={d} fill="none" stroke={color} strokeWidth={1.2} />
 {/* start dot */}
 <circle {...dotProps(project(tr.points[0].az, tr.points[0].el))} r={3} fill={color} />
 {/* end dot (larger) */}
 <circle {...dotProps(project(tr.points[tr.points.length-1].az, tr.points[tr.points.length-1].el))} r={4} fill={color} stroke="var(--color-bg-app)" strokeWidth="1" />
 </g>
 )
 })}
 <text x={cx} y={cy - R - 3} fontSize="9" fill="var(--color-sand-500)" textAnchor="middle">FRONT</text>
 <text x={cx - R - 4} y={cy + 3} fontSize="9" fill="var(--color-sand-500)" textAnchor="end">LEFT</text>
 <text x={cx + R + 4} y={cy + 3} fontSize="9" fill="var(--color-sand-500)" textAnchor="start">RIGHT</text>
 <text x={cx} y={cy + R + 12} fontSize="9" fill="var(--color-sand-500)" textAnchor="middle">REAR</text>
 </svg>
 )
}

function dotProps(p: readonly [number, number]) { return { cx: p[0], cy: p[1] } }

/* ─── Height-over-time strip ─────────────────────────────────────────────── */

function HeightOverTime({ data, durationSec }: { data: [number, number][]; durationSec: number }) {
 const W = 800
 const H = 40
 const path = useMemo(() => {
 if (data.length < 2) return ''
 return data.map(([t, f], i) => {
 const x = (t / durationSec) * W
 const y = H - f * H
 return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
 }).join(' ')
 }, [data, durationSec])
 return (
 <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-10" preserveAspectRatio="none">
 <line x1={0} x2={W} y1={H} y2={H} stroke="var(--color-sand-600)" strokeWidth="0.5" />
 <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" />
 {/* Fill under curve */}
 <path d={`${path} L ${W} ${H} L 0 ${H} Z`} fill="var(--color-accent)" opacity="0.12" />
 </svg>
 )
}

function formatT(s: number): string {
 const m = Math.floor(s / 60)
 const ss = Math.floor(s) % 60
 return `${m}:${String(ss).padStart(2,'0')}`
}
