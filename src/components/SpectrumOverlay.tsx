import React, { useState, useMemo } from 'react'
import { useSolo } from '../SoloContext'

interface Props {
 spectrumA: number[]
 spectrumB: number[]
 midSpectrumA?: number[]
 midSpectrumB?: number[]
 sideSpectrumA?: number[]
 sideSpectrumB?: number[]
 labelA: string
 labelB: string
 singleFile?: boolean
}

const FREQ_LABELS = [
 '20', '25', '31', '40', '50', '63', '80', '100', '125', '160',
 '200', '250', '315', '400', '500', '630', '800', '1k', '1.25k', '1.6k',
 '2k', '2.5k', '3.15k', '4k', '5k', '6.3k', '8k', '10k', '12.5k', '16k', '20k',
]

// ISO-266 third-octave centre frequencies — same set the analyser
// uses on the Python side. Index aligned with FREQ_LABELS so a click
// on the chart at band i resolves to FREQ_LABELS[i] / FREQ_HZ[i].
const FREQ_HZ = [
 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
]

/**
 * Invisible band-strip overlay rendered on top of the SVG chart.
 * Each strip is one band wide; clicking solos that frequency through
 * the live A/B player. Hovering shows a hairline highlight + a tooltip
 * with the centre frequency. The currently-soloed band gets a thin
 * gold ring so the eye can track which band is being auditioned.
 *
 * Beta-tester request 5.0.6: "solo the frequency the spectrum is
 * giving us so we can see and HEAR what to boost or cut."
 */
function BandSoloOverlay({ w, h, bands }: { w: number; h: number; bands: number }) {
  const { soloBand, setSolo, clearSolo } = useSolo()
  const [hover, setHover] = useState<number | null>(null)
  const stripW = w / bands
  return (
    <g pointerEvents="auto">
      {Array.from({ length: bands }, (_, i) => {
        const cx = (i + 0.5) * stripW
        const x = i * stripW
        const freq = FREQ_HZ[i] ?? 0
        const isSoloed = soloBand != null && Math.abs(soloBand - freq) < 1
        const isHover = hover === i
        return (
          <g key={i}>
            <rect
              x={x} y={0} width={stripW} height={h}
              fill="transparent"
              onClick={() => {
                if (isSoloed) clearSolo()
                else if (freq > 0) setSolo(freq)
              }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(prev => (prev === i ? null : prev))}
              style={{ cursor: 'pointer' }}
            >
              <title>
                {isSoloed
                  ? `${FREQ_LABELS[i]} Hz — soloed (click to clear)`
                  : `Solo ${FREQ_LABELS[i]} Hz band (click to audition)`}
              </title>
            </rect>
            {(isHover || isSoloed) && (
              <line
                x1={cx} y1={0} x2={cx} y2={h}
                stroke={isSoloed ? '#7bc49e' : '#d0b066'}
                strokeWidth={isSoloed ? 1.4 : 0.7}
                opacity={isSoloed ? 0.85 : 0.55}
                pointerEvents="none"
              />
            )}
          </g>
        )
      })}
    </g>
  )
}

const LABEL_INDICES = [0, 3, 6, 9, 12, 15, 17, 20, 23, 26, 28, 30]

type ViewMode = 'stereo' | 'mid' | 'side' | 'delta'

const viewConfig: Record<ViewMode, { label: string; colorB: string; description: string }> = {
 stereo: { label: 'Stereo', colorB: '#f59e0b', description: 'Full stereo mix EQ comparison' },
 mid: { label: 'Mid', colorB: '#3b82f6', description: 'Center channel — vocals, kick, bass, snare' },
 side: { label: 'Side', colorB: '#a855f7', description: 'Side channel — reverbs, stereo width, panned elements' },
 // Delta = B − A, clamped ±3 dB around a zero baseline. Reads like a
 // "tilt map" — where B is brighter or darker than A per band.
 delta: { label: 'Δ B − A', colorB: '#d0b066', description: 'Per-band difference (B minus A), clamped ±3 dB — quick EQ-shape read.' },
}

export default function SpectrumOverlay({
 spectrumA, spectrumB,
 midSpectrumA, midSpectrumB,
 sideSpectrumA, sideSpectrumB,
 labelA, labelB,
 singleFile,
}: Props) {
 const [view, setView] = useState<ViewMode>('stereo')

 const dataA = view === 'mid' ? (midSpectrumA || spectrumA) : view === 'side' ? (sideSpectrumA || spectrumA) : spectrumA
 const dataB = view === 'mid' ? (midSpectrumB || spectrumB) : view === 'side' ? (sideSpectrumB || spectrumB) : spectrumB
 const config = viewConfig[view]

 const hasMidSide = !!(midSpectrumA && midSpectrumB && sideSpectrumA && sideSpectrumB)

 return (
 <div className="bg-dark-900 rounded-2xl p-6 border border-dark-700/50 space-y-4">
 {/* Header */}
 <div className="flex items-center justify-between">
 <div className="space-y-1">
 <h2 className="text-lg font-semibold">Frequency Spectrum</h2>
 <p className="text-xs text-dark-400">{config.description}</p>
 </div>
 {!singleFile && (
 <div className="flex items-center gap-3 text-xs">
 <div className="flex items-center gap-1.5">
 <div className="w-6 h-0.5 rounded" style={{ backgroundColor: '#6b7280' }} />
 <span className="text-dark-400">{labelA}</span>
 </div>
 <div className="flex items-center gap-1.5">
 <div className="w-6 h-0.5 rounded" style={{ backgroundColor: config.colorB }} />
 <span className="text-dark-400">{labelB}</span>
 </div>
 </div>
 )}
 </div>

 {/* View tabs */}
 {(hasMidSide || !singleFile) && (
 <div className="flex gap-1 bg-dark-800 rounded-lg p-1">
 {(hasMidSide
 ? (singleFile ? (['stereo','mid','side'] as ViewMode[]) : (['stereo','mid','side','delta'] as ViewMode[]))
 : (singleFile ? (['stereo'] as ViewMode[]) : (['stereo','delta'] as ViewMode[]))
 ).map(v => {
 const vc = viewConfig[v]
 const active = view === v
 return (
 <button
 key={v}
 onClick={() => setView(v)}
 className="flex-1 py-1.5 rounded-md text-xs font-medium transition-all"
 style={{
 backgroundColor: active ? 'rgba(255,255,255,0.08)' : 'transparent',
 color: active ? vc.colorB : '#84858c',
 borderBottom: active ? `2px solid ${vc.colorB}` : '2px solid transparent',
 }}
 >
 {vc.label}
 </button>
 )
 })}
 </div>
 )}

 {/* Graph */}
 {view === 'delta'
 ? <SpectrumDeltaGraph dataA={spectrumA} dataB={spectrumB} />
 : <SpectrumGraph dataA={dataA} dataB={dataB} colorB={config.colorB} />}
 </div>
 )
}

/**
 * Zero-centred delta chart — each band shows (B − A) clamped to ±3 dB.
 * Green above zero = B louder, red below = B quieter. Makes the kind of
 * broad "B is dark" / "B is bright" read instant that's otherwise buried
 * in the two-overlay chart.
 */
function SpectrumDeltaGraph({ dataA, dataB }: { dataA: number[]; dataB: number[] }) {
 const w = 800
 const h = 200
 const padX = 0
 const padY = 10
 const CLAMP = 3
 const bands = Math.min(dataA.length, dataB.length)

 const diffs = useMemo(() => {
 const out: number[] = []
 for (let i = 0; i < bands; i++) {
 const d = (dataB[i] || 0) - (dataA[i] || 0)
 out.push(Math.max(-CLAMP, Math.min(CLAMP, d)))
 }
 return out
 }, [dataA, dataB, bands])

 const denom = Math.max(1, bands - 1)
 const centerY = padY + (h - padY * 2) / 2
 const dBToY = (d: number) => centerY - (d / CLAMP) * ((h - padY * 2) / 2)

 const pathD = useMemo(() => {
 if (diffs.length < 2) return ''
 const pts = diffs.map((v, i) => ({ x: padX + (i / denom) * (w - padX * 2), y: dBToY(v) }))
 let p = `M ${pts[0].x} ${pts[0].y}`
 for (let i = 1; i < pts.length; i++) {
 const prev = pts[i - 1], curr = pts[i]
 const cpx = (prev.x + curr.x) / 2
 p += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`
 }
 return p
 }, [diffs, denom])

 return (
 <div className="relative bg-dark-800 rounded-xl p-3">
 <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-48" preserveAspectRatio="none" role="img" aria-label="Frequency spectrum chart — see the table below this chart for the underlying band values">
 {/* Gridlines at ±3 / ±1.5 / 0 dB */}
 {[-3, -1.5, 0, 1.5, 3].map(d => {
 const y = dBToY(d)
 const isZero = d === 0
 return (
 <line
 key={d}
 x1={padX} y1={y} x2={w - padX} y2={y}
 stroke={isZero ? '#6c6a63' : '#4c4d52'}
 strokeWidth={isZero ? 0.8 : 0.5}
 strokeDasharray={isZero ? undefined : '4 4'}
 opacity={isZero ? 0.55 : 0.25}
 />
 )
 })}
 {LABEL_INDICES.map(i => {
 const x = padX + (i / denom) * (w - padX * 2)
 return <line key={i} x1={x} y1={padY} x2={x} y2={h - padY} stroke="#4c4d52" strokeWidth="0.5" opacity="0.15" />
 })}
 {/* Positive / negative fills */}
 <defs>
 <linearGradient id="delta-up" x1="0" y1="0" x2="0" y2="1">
 <stop offset="0%" stopColor="#34d399" stopOpacity="0.32" />
 <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
 </linearGradient>
 <linearGradient id="delta-down" x1="0" y1="1" x2="0" y2="0">
 <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.32" />
 <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
 </linearGradient>
 <clipPath id="delta-above"><rect x={0} y={0} width={w} height={centerY} /></clipPath>
 <clipPath id="delta-below"><rect x={0} y={centerY} width={w} height={h - centerY} /></clipPath>
 </defs>
 {/* Fill above the zero line (B > A) */}
 <g clipPath="url(#delta-above)">
 <path d={`${pathD} L ${w - padX} ${centerY} L ${padX} ${centerY} Z`} fill="url(#delta-up)" />
 </g>
 {/* Fill below the zero line (B < A) */}
 <g clipPath="url(#delta-below)">
 <path d={`${pathD} L ${w - padX} ${centerY} L ${padX} ${centerY} Z`} fill="url(#delta-down)" />
 </g>
 <path d={pathD} fill="none" stroke="#d0b066" strokeWidth="2" />
 {/* Click any band to solo that frequency on the player. */}
 <BandSoloOverlay w={w} h={h} bands={bands} />
 </svg>
 <div className="flex justify-between px-1 mt-1">
 {LABEL_INDICES.map(i => (
 <span key={i} className="text-[8px] text-dark-500">{FREQ_LABELS[i]}</span>
 ))}
 </div>
 <div className="flex items-center gap-3 mt-2 text-[10px] text-dark-500">
 <span><span style={{ color: '#34d399' }}>▲</span> B louder</span>
 <span><span style={{ color: '#f43f5e' }}>▼</span> B quieter</span>
 <span className="ml-auto">Click any band to solo it · Clamped ±{CLAMP} dB</span>
 </div>
 </div>
 )
}

function SpectrumGraph({ dataA, dataB, colorB }: { dataA: number[]; dataB: number[]; colorB: string }) {
 const bands = dataA.length
 const w = 800
 const h = 200
 const padX = 0
 const padY = 10

 const { normA, normB, diffBands } = useMemo(() => {
 // 5.2.0 perf fix (audit P2-25): the previous Math.max(...dataA, ...dataB)
 // spread two 31-element arrays onto the call stack on every render —
 // small in absolute terms but wasted work when the chart updates often.
 // Single-pass loop instead.
 let maxVal = 0.001
 let minVal = Infinity
 for (let i = 0; i < dataA.length; i++) {
 const a = dataA[i], b = dataB[i] ?? 0
 if (a > maxVal) maxVal = a; if (b > maxVal) maxVal = b
 if (a < minVal) minVal = a; if (b < minVal) minVal = b
 }
 const range = maxVal - minVal || 1
 const nA: number[] = new Array(dataA.length)
 const nB: number[] = new Array(dataA.length)
 const diff: number[] = new Array(dataA.length)
 for (let i = 0; i < dataA.length; i++) {
 nA[i] = (dataA[i] - minVal) / range
 nB[i] = ((dataB[i] ?? 0) - minVal) / range
 diff[i] = (dataB[i] ?? 0) - dataA[i]
 }
 return { normA: nA, normB: nB, diffBands: diff }
 }, [dataA, dataB])

 const makePath = (data: number[]): string => {
 const points = data.map((v, i) => ({
 x: padX + (i / (data.length - 1)) * (w - padX * 2),
 y: padY + (1 - v) * (h - padY * 2),
 }))
 if (points.length < 2) return ''
 let d = `M ${points[0].x} ${points[0].y}`
 for (let i = 1; i < points.length; i++) {
 const prev = points[i - 1]
 const curr = points[i]
 const cpx = (prev.x + curr.x) / 2
 d += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`
 }
 return d
 }

 const makeFilledPath = (data: number[]): string => {
 const base = makePath(data)
 const lastX = padX + (w - padX * 2)
 return `${base} L ${lastX} ${h} L ${padX} ${h} Z`
 }

 const annotations = useMemo(() => {
 const anns: { index: number; diff: number; freq: string }[] = []

 // Method 1: Local peaks (point differences)
 for (let i = 1; i < diffBands.length - 1; i++) {
 const absDiff = Math.abs(diffBands[i])
 if (absDiff > 0.5) {
 if (absDiff >= Math.abs(diffBands[i - 1]) && absDiff >= Math.abs(diffBands[i + 1])) {
 anns.push({ index: i, diff: diffBands[i], freq: FREQ_LABELS[i] || '' })
 }
 }
 }

 // Method 2: Region averages — catch gradual differences across frequency ranges
 const regions = [
 { name: 'Sub', start: 0, end: 4 },
 { name: 'Bass', start: 4, end: 8 },
 { name: 'Low Mid', start: 8, end: 13 },
 { name: 'Mid', start: 13, end: 18 },
 { name: 'Presence', start: 18, end: 23 },
 { name: 'High', start: 23, end: 27 },
 { name: 'Air', start: 27, end: 31 },
 ]
 for (const region of regions) {
 const regionDiffs = diffBands.slice(region.start, region.end)
 if (regionDiffs.length === 0) continue
 const avgDiff = regionDiffs.reduce((a, b) => a + b, 0) / regionDiffs.length
 if (Math.abs(avgDiff) > 0.8) {
 // Use the middle band of the region
 const midIdx = Math.floor((region.start + region.end) / 2)
 // Don't add if a local peak already covers this area
 const alreadyCovered = anns.some(a => Math.abs(a.index - midIdx) < 3)
 if (!alreadyCovered) {
 anns.push({ index: midIdx, diff: avgDiff, freq: FREQ_LABELS[midIdx] || '' })
 }
 }
 }

 // Deduplicate close annotations and return top 6
 const sorted = anns.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
 const filtered: typeof anns = []
 for (const ann of sorted) {
 if (!filtered.some(f => Math.abs(f.index - ann.index) < 2)) {
 filtered.push(ann)
 }
 }
 return filtered.slice(0, 10)
 }, [diffBands])

 return (
 <>
 <div className="relative bg-dark-800 rounded-xl p-3">
 <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-48" preserveAspectRatio="none" role="img" aria-label="Frequency spectrum chart — see the table below this chart for the underlying band values">
 {[0.25, 0.5, 0.75].map(pct => (
 <line
 key={pct}
 x1={padX} y1={padY + (1 - pct) * (h - padY * 2)}
 x2={w - padX} y2={padY + (1 - pct) * (h - padY * 2)}
 stroke="#4c4d52" strokeWidth="0.5" strokeDasharray="4 4" opacity="0.3"
 />
 ))}

 {LABEL_INDICES.map(i => {
 const x = padX + (i / (bands - 1)) * (w - padX * 2)
 return (
 <line key={i} x1={x} y1={padY} x2={x} y2={h - padY} stroke="#4c4d52" strokeWidth="0.5" opacity="0.2" />
 )
 })}

 <path d={makeFilledPath(normA)} fill="#6b7280" opacity="0.08" />
 <path d={makeFilledPath(normB)} fill={colorB} opacity="0.08" />
 <path d={makePath(normA)} fill="none" stroke="#6b7280" strokeWidth="2" opacity="0.6" />
 <path d={makePath(normB)} fill="none" stroke={colorB} strokeWidth="2" opacity="0.9" />

 {/* Click-to-solo per band — see SoloContext.tsx. */}
 <BandSoloOverlay w={w} h={h} bands={bands} />
 </svg>

 {/* Annotation dots on chart */}
 <div className="absolute inset-0 pointer-events-none" style={{ padding: '12px' }}>
 {annotations.map((ann, i) => {
 const leftPct = (ann.index / (bands - 1)) * 100
 const topPct = (1 - normB[ann.index]) * 100 * 0.9 + 5
 const color = ann.diff > 0 ? '#34d399' : '#f43f5e'
 return (
 <div key={i} className="absolute -translate-x-1/2" style={{ left: `${leftPct}%`, top: `${Math.max(2, topPct - 14)}%` }}>
 <div className="flex flex-col items-center">
 <span className="text-[9px] font-bold px-1 rounded" style={{ color, backgroundColor: 'rgba(20,19,19,0.85)' }}>
 {ann.diff > 0 ? '+' : ''}{ann.diff.toFixed(1)}
 </span>
 <div className="w-1.5 h-1.5 rounded-full mt-0.5" style={{ backgroundColor: color }} />
 </div>
 </div>
 )
 })}
 </div>

 <div className="flex justify-between px-1 mt-1">
 {LABEL_INDICES.map(i => (
 <span key={i} className="text-[8px] text-dark-500">{FREQ_LABELS[i]}</span>
 ))}
 </div>

 {/* Screen-reader fallback table — gives non-visual users access
 to the same per-band data the chart shows. Hidden visually with
 `sr-only` (Tailwind utility) but available to assistive tech.
 5.2.0 a11y baseline (audit P0-6). */}
 <table className="sr-only" aria-label="Spectrum band-by-band values">
 <caption>31 third-octave bands, dB difference (B minus A). Negative = B is quieter at that band.</caption>
 <thead>
 <tr>
 <th scope="col">Band</th>
 <th scope="col">Frequency</th>
 <th scope="col">A (dB)</th>
 <th scope="col">B (dB)</th>
 <th scope="col">Δ (dB)</th>
 </tr>
 </thead>
 <tbody>
 {dataA.map((a, i) => (
 <tr key={i}>
 <td>{i + 1}</td>
 <td>{FREQ_LABELS[i] || '—'} Hz</td>
 <td>{a.toFixed(1)}</td>
 <td>{(dataB[i] ?? 0).toFixed(1)}</td>
 <td>{((dataB[i] ?? 0) - a).toFixed(1)}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>

 {annotations.length > 0 && (
 <div className="flex flex-wrap gap-1.5 mt-1">
 {[...annotations].sort((a, b) => a.index - b.index).map((ann, i) => (
 <span
 key={i}
 className="text-[10px] px-2 py-1 rounded-full"
 style={{
 color: ann.diff > 0 ? '#34d399' : '#f43f5e',
 backgroundColor: ann.diff > 0 ? 'rgba(52,211,153,0.1)' : 'rgba(244,63,94,0.1)',
 }}
 >
 {ann.freq}: {ann.diff > 0 ? '+' : ''}{ann.diff.toFixed(1)} dB
 </span>
 ))}
 </div>
 )}
 </>
 )
}
