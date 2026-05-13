import React from 'react'

interface Hotspot {
 time_sec: number
 freq_hz: number
 diff_db: number
}

interface Props {
 diff: {
 freqs: number[]
 timeline: number[]
 window_sec: number
 grid: number[][]
 hotspots: Hotspot[]
 duration_sec: number
 }
 labelA: string
 labelB: string
 /** Optional callback — rows in the ranked hotspots list become clickable
  * and fire this with the chosen hotspot. If omitted, rows still render
  * but are not interactive. */
 onHotspotClick?: (hotspot: Hotspot) => void
}

/** Describe what the magnitude means in plain English. */
function describeHotspot(hs: Hotspot, labelB: string): string {
 const mag = Math.abs(hs.diff_db).toFixed(1)
 const freq = hs.freq_hz
 if (hs.diff_db > 0) {
 if (freq < 120) return `+${mag} dB more sub in ${labelB}`
 if (freq < 400) return `+${mag} dB more mud in ${labelB}`
 if (freq < 2000) return `+${mag} dB more body in ${labelB}`
 if (freq < 6000) return `+${mag} dB more presence in ${labelB}`
 return `+${mag} dB brighter in ${labelB}`
 }
 if (freq < 120) return `-${mag} dB less sub in ${labelB}`
 if (freq < 400) return `-${mag} dB less mud in ${labelB}`
 if (freq < 2000) return `-${mag} dB less body in ${labelB}`
 if (freq < 6000) return `-${mag} dB less presence in ${labelB}`
 return `-${mag} dB duller in ${labelB}`
}

/** Magnitude-based colour — matches the brand palette. */
function magnitudeColour(diffDb: number): string {
 const mag = Math.abs(diffDb)
 if (mag > 4) return 'var(--color-danger)' // red
 if (mag >= 2) return 'var(--color-data-warn)' // amber
 return 'var(--color-text-muted)' // muted
}

function formatTime(sec: number): string {
 const m = Math.floor(sec / 60)
 const s = Math.floor(sec) % 60
 return `${m}:${String(s).padStart(2, '0')}`
}

function formatFreq(hz: number): string {
 return hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`
}

/**
 * Spectrum diff heatmap — warm colour = B louder than A in that band/time,
 * cool colour = quieter. Grid is [time_bins][freq_bins] in dB.
 */
export default function WaveformDiffHeatmap({ diff, labelA, labelB, onHotspotClick }: Props) {
 if (!diff || !diff.grid || diff.grid.length === 0) return null

 const freqs = diff.freqs
 const timeBins = diff.grid.length
 const freqBins = freqs.length
 const w = 900
 const h = 220
 const cellW = w / timeBins
 const cellH = h / freqBins

 // Colour scale — diverging: cool blue for negative, warm red for positive
 const cellColor = (db: number): string => {
 const clamped = Math.max(-12, Math.min(12, db))
 const intensity = Math.abs(clamped) / 12
 if (clamped > 0) {
 // Red/orange — B louder
 const r = 201, g = Math.round(103 + (255 - 103) * (1 - intensity)), b = Math.round(101 + (255 - 101) * (1 - intensity))
 return `rgba(${r},${Math.max(60, g)},${Math.max(60, b)},${0.15 + intensity * 0.75})`
 }
 // Blue/teal — B quieter
 return `rgba(124,164,163,${0.10 + intensity * 0.70})`
 }

 const freqLabelIndices = [0, 5, 10, 15, 17, 20, 25, 28, 30]
 .filter(i => i < freqs.length)
 const timeLabelCount = 6

 return (
 <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-4">
 <div className="space-y-1">
 <h2 className="text-lg">Where does the mix diverge?</h2>
 <p className="text-xs text-dark-400">
 Spectrum diff heatmap — <span style={{ color: 'var(--color-danger)' }}>warm</span> = {labelB} louder than {labelA}, <span style={{ color: 'var(--color-teal)' }}>cool</span> = quieter.
 Reads left-to-right by time, bottom-to-top by frequency.
 </p>
 </div>

 <div className="bg-dark-800 p-3 overflow-hidden">
 <svg viewBox={`0 0 ${w} ${h + 30}`} className="w-full h-56" preserveAspectRatio="none">
 {/* Cells */}
 {diff.grid.map((row, ti) =>
 row.map((v, fi) => {
 const x = ti * cellW
 const y = h - (fi + 1) * cellH // bottom = low freq
 return (
 <rect
 key={`${ti}-${fi}`}
 x={x}
 y={y}
 width={cellW + 0.5}
 height={cellH + 0.5}
 fill={cellColor(v)}
 shapeRendering="crispEdges"
 />
 )
 })
 )}

 {/* Hotspot circles */}
 {diff.hotspots.slice(0, 6).map((hs, i) => {
 const ti = diff.timeline.findIndex(t => t >= hs.time_sec)
 const fi = freqs.indexOf(hs.freq_hz)
 if (ti < 0 || fi < 0) return null
 const cx = ti * cellW + cellW / 2
 const cy = h - (fi + 0.5) * cellH
 return (
 <g key={i}>
 <circle cx={cx} cy={cy} r={6} fill="none" stroke="var(--color-text-primary)" strokeWidth="1" />
 <text x={cx + 8} y={cy + 3} fontSize="8" fill="var(--color-text-primary)">
 {hs.diff_db > 0 ? '+' : ''}{hs.diff_db.toFixed(1)}dB
 </text>
 </g>
 )
 })}

 {/* Frequency labels (left) */}
 {freqLabelIndices.map(fi => {
 const y = h - (fi + 0.5) * cellH
 const hz = freqs[fi]
 const label = hz >= 1000 ? `${hz / 1000}k` : `${hz}`
 return (
 <text key={fi} x={4} y={y + 3} fontSize="8" fill="var(--color-sand-500)">{label}</text>
 )
 })}

 {/* Time labels (bottom) */}
 {Array.from({ length: timeLabelCount }).map((_, i) => {
 const pct = i / (timeLabelCount - 1)
 const x = pct * w
 const t = pct * diff.duration_sec
 const label = `${Math.floor(t / 60)}:${String(Math.floor(t) % 60).padStart(2, '0')}`
 return (
 <text key={i} x={x} y={h + 14} fontSize="8" fill="var(--color-sand-500)" textAnchor="middle">{label}</text>
 )
 })}
 </svg>
 </div>

 {/* Ranked hotspots list — sorted by |diff_db| desc, arrows for direction,
  magnitude-coloured dB, clickable rows when a callback is provided. */}
 {diff.hotspots.length > 0 && (
 <div className="bg-dark-800/40 p-3 space-y-1">
 <div className="flex items-center justify-between">
 <span className="text-[10px] uppercase tracking-[0.14em] text-dark-500">Biggest divergence points</span>
 <span className="text-[9px] text-dark-500">[^] hotter in {labelB} &middot; [v] quieter in {labelB}</span>
 </div>
 {[...diff.hotspots]
 .sort((a, b) => Math.abs(b.diff_db) - Math.abs(a.diff_db))
 .slice(0, 6)
 .map((hs, i) => {
 const arrow = hs.diff_db > 0 ? '^' : 'v'
 const arrowColor = hs.diff_db > 0 ? 'var(--color-danger)' : 'var(--color-text-muted)'
 const dbColor = magnitudeColour(hs.diff_db)
 const clickable = Boolean(onHotspotClick)
 const rowClasses = 'flex items-center text-[11px] px-2 py-1 transition-colors'
 + (clickable ? ' cursor-pointer hover:bg-dark-700/40' : '')
 return (
 <div
 key={i}
 className={rowClasses}
 role={clickable ? 'button' : undefined}
 tabIndex={clickable ? 0 : undefined}
 onClick={clickable ? () => onHotspotClick!(hs) : undefined}
 onKeyDown={clickable ? (e) => {
 if (e.key === 'Enter' || e.key === ' ') {
 e.preventDefault()
 onHotspotClick!(hs)
 }
 } : undefined}
 >
 <span className="w-6 font-mono text-dark-500">{i + 1}.</span>
 <span className="w-8 font-mono text-center" style={{ color: arrowColor }}>[{arrow}]</span>
 <span className="w-14 font-mono text-dark-400 pl-2">{formatTime(hs.time_sec)}</span>
 <span className="w-20 font-mono text-dark-300">{formatFreq(hs.freq_hz)}</span>
 <span className="w-20 font-mono text-right pr-3" style={{ color: dbColor }}>
 {hs.diff_db > 0 ? '+' : ''}{hs.diff_db.toFixed(1)} dB
 </span>
 <span className="flex-1 text-[10px]" style={{ color: 'var(--color-text-primary)', opacity: 0.72 }}>
 {describeHotspot(hs, labelB)}
 </span>
 </div>
 )
 })}
 </div>
 )}
 </div>
 )
}
