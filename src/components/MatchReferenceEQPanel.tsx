import React, { useMemo, useState, useEffect } from 'react'
import { FileInfo, Recommendation, Category } from '../types'
import InfoTooltip from './InfoTooltip'
import EQExportButton from './EQExportButton'
import ApplyBounceButton from './ApplyBounceButton'
import { EQPreviewPlayer } from './EngineerTipsPanel'
import { onShortcut, RTM_EVENTS } from '../shortcuts'
import { useSolo, formatSoloFreq } from '../SoloContext'

/**
 * Turn the two 31-band spectra (A, B) into a handful of parametric EQ bands
 * that push File B toward File A. This is the actionable counterpart to the
 * text-only recommendations list.
 *
 * Algorithm: collapse the 31-band curve into seven musical regions (sub, low,
 * low-mid, mid, high-mid, brightness, air), average the diff in each, and
 * keep only regions where |A − B| ≥ 1.0 dB. Gain = A_avg − B_avg, so if B is
 * hotter than A we cut (negative gain), and if B is darker we boost.
 */

// 31 1/3-octave centre frequencies that match the backend spectrum arrays.
const FREQS = [
 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630,
 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000,
 12500, 16000, 20000,
]

interface Region {
 id: string
 label: string
 /** Inclusive start index into the 31-band spectrum. */
 start: number
 /** Exclusive end index. */
 end: number
 centre: number
 q: number
}

const REGIONS: Region[] = [
 { id: 'sub', label: 'Sub', start: 0, end: 6, centre: 40, q: 0.7 }, // 20-63 Hz
 { id: 'low', label: 'Low', start: 6, end: 11, centre: 125, q: 0.9 }, // 80-200 Hz
 { id: 'low-mid', label: 'Low-mid', start: 11, end: 15, centre: 350, q: 1.0 }, // 250-500 Hz
 { id: 'mid', label: 'Mid', start: 15, end: 20, centre: 1000, q: 1.0 }, // 630-1.6 kHz
 { id: 'high-mid', label: 'High-mid', start: 20, end: 24, centre: 2800, q: 1.0 }, // 2-4 kHz
 { id: 'presence', label: 'Brightness', start: 24, end: 28, centre: 7000, q: 0.9 }, // 5-10 kHz
 { id: 'air', label: 'Air', start: 28, end: 31, centre: 16000, q: 0.8 }, // 12.5-20 kHz
]

// Minimum meaningful diff — anything smaller is below typical measurement
// noise and not worth an EQ move. Matches the 1 dB rule-of-thumb most
// mixing/mastering courses use.
const MIN_DIFF_DB = 1.0

// Floor on the absolute value of the smoothed spectrum. Below this we treat
// the band as silence and skip it — otherwise the averaging of very quiet
// bands produces huge phantom "diffs".
const SPECTRUM_FLOOR_DB = -55

// Cap on the magnitude of the spectrum-derived gain move. Beta-tester feedback
// (May 2026): sub/low-mid moves were occasionally recommending +8 to +14 dB
// when the reference had a hot 50 Hz peak the candidate didn't (e.g. a kick
// with a different fundamental). That's not a useful suggestion — even
// aggressive mastering moves stay under ±5 dB, and a +12 dB sub boost can
// destroy speakers and translate horribly. Cap broadband bands to ±4 dB,
// sub-bass tighter at ±3 dB. Anything larger gets clamped + a hint that
// the diff was bigger than the cap.
const MAX_GAIN_DB = 4.0
const MAX_GAIN_DB_SUB = 3.0

export interface Band {
 freq: number
 gain_db: number
 q: number
 region: string
 /** Where the move came from — for UI grouping + rec→band linking. */
 source?: 'spectrum' | 'category' | 'engineer'
}

// ─── Category → target EQ move mapping ───────────────────────────────────────
//
// Each stem/region in the backend `categories` array knows its `level_diff`
// (how much louder B is than A for that element). We can't change stem levels
// on a stereo mix-bus EQ, but we CAN approximate the balance shift by
// cutting/boosting the frequency range that element lives in.
//
// The `scale` factor acknowledges that stem level deltas don't translate 1:1
// to mix-bus EQ — the recommendation text itself usually suggests "pull back
// ~half" for vocal/instrument balance fixes, and full compensation for
// tonal fixes like kick weight / brightness / air.
interface CategoryMove {
 categoryName: string
 /** Target centre frequency. */
 freq: number
 q: number
 /** How much of `level_diff` to apply. 1.0 = full compensation. */
 scale: number
 /** If true, invert — a louder stem gets a cut (negative gain). */
 invert: boolean
}

const CATEGORY_EQ_MAP: CategoryMove[] = [
 { categoryName: 'Kick', freq: 90, q: 0.8, scale: 1.0, invert: true },
 { categoryName: 'Snare', freq: 200, q: 0.9, scale: 0.6, invert: true },
 { categoryName: 'Sub', freq: 50, q: 0.7, scale: 1.0, invert: true },
 { categoryName: 'Bass', freq: 150, q: 0.9, scale: 0.8, invert: true },
 { categoryName: 'Vocals', freq: 3000, q: 1.0, scale: 0.5, invert: true },
 { categoryName: 'Instruments', freq: 1000, q: 0.7, scale: 0.5, invert: true },
 { categoryName: 'Brightness', freq: 5000, q: 0.9, scale: 1.0, invert: true },
 { categoryName: 'Air', freq: 12000, q: 0.7, scale: 1.0, invert: true },
]

const CATEGORY_MIN_DIFF_DB = 1.2

/** Derive EQ moves from stem/category level diffs. */
export function deriveCategoryBands(categories: Category[] | undefined): Band[] {
 if (!categories || categories.length === 0) return []
 const byName = new Map(categories.map(c => [c.name, c]))
 const out: Band[] = []
 for (const m of CATEGORY_EQ_MAP) {
 const cat = byName.get(m.categoryName)
 if (!cat) continue
 const diff = cat.level_diff
 if (!diff || Math.abs(diff) < CATEGORY_MIN_DIFF_DB) continue
 // If B is louder (+diff) and invert=true, we want to CUT in B (-gain).
 const signed = m.invert ? -diff : diff
 const gain = signed * m.scale
 // Clamp to a sensible mastering-EQ range.
 const clamped = Math.max(-6, Math.min(6, gain))
 if (Math.abs(clamped) < 0.5) continue
 out.push({
 freq: m.freq,
 gain_db: Math.round(clamped * 10) / 10,
 q: m.q,
 region: m.categoryName,
 source: 'category',
 })
 }
 return out
}

/**
 * 5.7.0: log-frequency Hann smoothing on a 31-band 1/3-octave spectrum.
 * Mirrors python/engineer_profile.py:_smooth_log_spectrum so the
 * single-track Match path produces band moves that are consistent with
 * the engineer-profile path. Without this, narrow tonal features (a
 * tuned kick fundamental at 50 Hz, a resonant note in the bass, etc.)
 * read as broad-band imbalance against any reference and the panel
 * suggests aggressive cuts that destroy the genre's signature.
 *
 * For kernel_bands=3 the resulting kernel is [0.25, 0.5, 0.25] — the
 * classic binomial 3-tap smoother. Reflective padding avoids attenuating
 * the lowest (20 Hz) and highest (20 kHz) bands.
 */
export function smoothLogSpectrum(spec: number[], kernelBands: number = 3): number[] {
  if (!spec || spec.length === 0) return []
  if (kernelBands <= 1 || spec.length <= kernelBands) return spec.slice()
  // Hann window of length kernelBands+2, drop the zero endpoints, normalise.
  const klen = kernelBands + 2
  const raw: number[] = []
  for (let i = 0; i < klen; i++) {
    raw.push(0.5 * (1 - Math.cos((2 * Math.PI * i) / (klen - 1))))
  }
  const kernel = raw.slice(1, -1)
  const ksum = kernel.reduce((a, b) => a + b, 0)
  for (let i = 0; i < kernel.length; i++) kernel[i] /= ksum
  const pad = Math.floor(kernelBands / 2)
  // Reflective padding (np.pad mode='reflect'): mirror around the edge,
  // not including the edge sample itself.
  const padded: number[] = []
  for (let i = pad; i > 0; i--) padded.push(spec[Math.min(i, spec.length - 1)])
  for (let i = 0; i < spec.length; i++) padded.push(spec[i])
  for (let i = 0; i < pad; i++) padded.push(spec[Math.max(spec.length - 2 - i, 0)])
  // Valid-mode convolution.
  const out: number[] = []
  for (let i = 0; i < spec.length; i++) {
    let acc = 0
    for (let k = 0; k < kernel.length; k++) acc += padded[i + k] * kernel[k]
    out.push(acc)
  }
  return out
}

export function deriveMatchBands(specA: number[], specB: number[]): Band[] {
 if (!specA || !specB || specA.length < 31 || specB.length < 31) return []
 // 5.7.0: smooth both spectra equally before the diff. See
 // smoothLogSpectrum() docstring for the full motivation. Same op
 // on both sides preserves real broad-band imbalances; suppresses
 // narrow tonal features that the diff alone can't tell apart from
 // intentional musical content.
 const specASm = smoothLogSpectrum(specA)
 const specBSm = smoothLogSpectrum(specB)
 const bands: Band[] = []
 for (const r of REGIONS) {
 const sliceA = specASm.slice(r.start, r.end)
 const sliceB = specBSm.slice(r.start, r.end)
 const aAvg = sliceA.reduce((s, v) => s + v, 0) / sliceA.length
 const bAvg = sliceB.reduce((s, v) => s + v, 0) / sliceB.length
 // Skip regions that are effectively silent in both files.
 if (aAvg < SPECTRUM_FLOOR_DB && bAvg < SPECTRUM_FLOOR_DB) continue
 const rawGain = aAvg - bAvg
 if (Math.abs(rawGain) < MIN_DIFF_DB) continue
 // Cap: sub region tighter, everything else broadband cap. Prevents
 // the +12 dB bass-boost recommendations beta testers reported when a
 // reference had a hot 50 Hz peak the candidate didn't.
 const cap = r.id === 'sub' ? MAX_GAIN_DB_SUB : MAX_GAIN_DB
 const gain = Math.max(-cap, Math.min(cap, rawGain))
 bands.push({
 freq: r.centre,
 gain_db: Math.round(gain * 10) / 10,
 q: r.q,
 region: r.label,
 source: 'spectrum',
 })
 }
 return bands
}

/**
 * Merge stem-derived + spectrum-derived bands. Stem-derived moves are
 * preferred when they overlap on the same musical range because they're
 * more specific (driven by per-element level diffs, not just tonal
 * average). Overlap = within 1/2 octave of an existing band.
 */
export function mergeBands(categoryBands: Band[], spectrumBands: Band[]): Band[] {
 const out: Band[] = [...categoryBands]
 for (const s of spectrumBands) {
 const overlap = out.some(c => Math.abs(Math.log2(c.freq / s.freq)) < 0.5)
 if (!overlap) out.push(s)
 }
 // Sort low → high so the UI reads left-to-right like a parametric EQ.
 out.sort((a, b) => a.freq - b.freq)
 return out
}

interface Props {
 recommendations: Recommendation[]
 categories?: Category[]
 specA?: number[]
 specB?: number[]
 /** Reference's integrated LUFS-I — passed through to ApplyBounceButton
  * so the "Match A loudness" toggle can target it. Optional; toggle
  * hides when undefined. */
 refLufs?: number | null
 fileB?: FileInfo
 labelA: string
 labelB: string
 /**
 * Extra parametric bands to merge into the derived list — used by Hybrid
 * mode in the unified Match tab to layer the engineer-profile moves on
 * top of the reference-derived ones. Same dedup rule applies (within
 * 1/2 octave of an existing band is dropped to avoid doubling moves).
 */
 extraBands?: Band[]
 /** Optional override for the panel title when embedded in the Match tab. */
 title?: string
 /** Optional override for the panel subtitle (under the title). */
 subtitle?: React.ReactNode
}

export default function MatchReferenceEQPanel({ recommendations, categories, specA, specB, refLufs, fileB, labelA, labelB, extraBands, title, subtitle }: Props) {
 const bands = useMemo(() => {
 const cat = deriveCategoryBands(categories)
 const spec = deriveMatchBands(specA || [], specB || [])
 const refMerged = mergeBands(cat, spec)
 if (!extraBands || extraBands.length === 0) return refMerged
 // Hybrid: merge in engineer profile bands using the same 1/2-octave
 // dedup — reference-derived moves win conflicts because they come from
 // THE actual two-file comparison.
 return mergeBands(refMerged, extraBands)
 }, [categories, specA, specB, extraBands])
 const [bandEnabled, setBandEnabled] = useState<boolean[]>(() => bands.map(() => false))
 const [eqAmount, setEqAmount] = useState(100)
 // Shared TP-limiter toggle — applies to both the live audition and the
 // apply-and-bounce render so they render the same signal.
 const [tpLimit, setTpLimit] = useState(false)
 const { soloBand, setSolo, clearSolo } = useSolo()

 // Chip-nav cursor — `[` / `]` step through the bands and enable the one
 // under the cursor. Lets the user compare one move at a time without
 // reaching for the mouse. Starts at -1 (no band in focus).
 const [chipCursor, setChipCursor] = useState(-1)
 useEffect(() => {
 const step = (dir: 1 | -1) => {
 if (bands.length === 0) return
 setChipCursor(prev => {
 const next = prev < 0 ? (dir > 0 ? 0 : bands.length - 1) : ((prev + dir + bands.length) % bands.length)
 setBandEnabled(en => en.map((_, i) => i === next))
 return next
 })
 }
 const unsubs = [
 onShortcut(RTM_EVENTS.chipNext, () => step(1)),
 onShortcut(RTM_EVENTS.chipPrev, () => step(-1)),
 ]
 return () => { unsubs.forEach(u => u()) }
 }, [bands.length])

 // Keep bandEnabled length in sync if the derived bands change (e.g. on
 // fresh comparison). Avoids index-out-of-range gain writes in the biquad.
 React.useEffect(() => {
 setBandEnabled(prev => {
 if (prev.length === bands.length) return prev
 return bands.map((_, i) => prev[i] ?? false)
 })
 }, [bands.length])

 const scaledBands = useMemo(() => bands.map(b => ({
 ...b,
 gain_db: Math.round(b.gain_db * (eqAmount / 100) * 10) / 10,
 })), [bands, eqAmount])

 const highCount = recommendations.filter(r => r.priority === 'high').length
 const medCount = recommendations.filter(r => r.priority === 'medium').length

 const priorityConfig = {
 high: { color: '#f43f5e', bg: 'rgba(244,63,94,0.12)', border: 'rgba(244,63,94,0.25)', label: 'High' },
 medium: { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.20)', label: 'Med' },
 low: { color: '#34d399', bg: 'rgba(52,211,153,0.10)', border: 'rgba(52,211,153,0.20)', label: 'Low' },
 }

 return (
 <div className="space-y-6">
 {/* Text recommendations (unchanged) */}
 {recommendations.length > 0 && (
 <div className="bg-dark-900 rounded-2xl p-6 border border-dark-700/50 space-y-5">
 <div className="flex items-center justify-between">
 <div className="space-y-1">
 <h2 className="text-lg font-semibold">{title ?? 'Recommendations'}</h2>
 <p className="text-xs text-dark-400">
 {subtitle ?? (<>How to bring <span className="text-amber-400">{labelB}</span> closer to <span className="text-dark-200">{labelA}</span>'s style while keeping improvements</>)}
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
 // Does this rec have a matching EQ band we can toggle?
 const bandIdx = bands.findIndex(b => b.region === rec.area)
 const hasBand = bandIdx >= 0
 const bandEnabledForRec = hasBand && bandEnabled[bandIdx]
 // 5.2.1 fix: chip text now shows the SCALED gain (matches what audio
 // plays + what the bounce bakes), not the raw value. Pulling the
 // Amount fader to 25% used to show "+4 dB" while the audio played
 // +1 dB — actively misleading the engineer reading the panel.
 const band = hasBand ? scaledBands[bandIdx] : null
 return (
 <div
 key={i}
 className="rounded-lg p-3.5 flex gap-3"
 style={{ backgroundColor: config.bg, borderLeft: `3px solid ${config.border}` }}
 >
 <div className="flex-shrink-0 pt-0.5">
 <span
 className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
 style={{ color: config.color, backgroundColor: `${config.color}20` }}
 >
 {config.label}
 </span>
 </div>
 <div className="space-y-1 min-w-0 flex-1">
 <div className="flex items-center justify-between gap-2">
 <span className="text-xs font-medium text-dark-200">{rec.area}</span>
 {hasBand && band && (() => {
 const isSoloed = soloBand != null && Math.abs(soloBand - band.freq) < 0.5
 return (
 <div className="flex items-center gap-2">
 <button
 onClick={() => isSoloed ? clearSolo() : setSolo(band.freq, 4)}
 className="text-[9px] font-mono uppercase tracking-[0.14em] px-1.5 py-0.5 rounded transition-colors"
 style={{
 color: isSoloed ? '#0e0d0b' : '#a8a29e',
 backgroundColor: isSoloed ? '#d0b066' : 'rgba(168,161,150,0.10)',
 }}
 title={isSoloed
 ? `Soloed at ${formatSoloFreq(band.freq)} — click to clear (or Esc)`
 : `Solo this band in place — band-pass audition at ${formatSoloFreq(band.freq)}`}
 >
 {isSoloed ? 'SOLO ON' : 'S'}
 </button>
 {/* Flat text with a hairline underline — no pill, no coloured
 fill. Gold tint only on hover / when the band is active.
 Quiet-luxury replacement for the former coloured chip. */}
 <button
 onClick={() => setBandEnabled(prev => {
 const next = [...prev]
 next[bandIdx] = !next[bandIdx]
 return next
 })}
 aria-pressed={bandEnabledForRec}
 className={`text-[10px] font-mono tabular-nums transition-colors group/chip ${bandEnabledForRec ? 'is-active' : ''}`}
 style={{
 color: bandEnabledForRec ? '#d0b066' : '#a8a29e',
 borderBottom: `1px solid ${bandEnabledForRec ? '#d0b066' : 'rgba(168,161,150,0.25)'}`,
 paddingBottom: 1,
 background: 'transparent',
 }}
 onMouseEnter={(e) => {
 if (!bandEnabledForRec) (e.currentTarget as HTMLElement).style.color = '#d0b066'
 }}
 onMouseLeave={(e) => {
 if (!bandEnabledForRec) (e.currentTarget as HTMLElement).style.color = '#a8a29e'
 }}
 title={bandEnabledForRec ? 'EQ band active — click to bypass' : 'Apply this move to the EQ chain below'}
 >
 {(band.gain_db > 0 ? '+' : '')}{band.gain_db} dB · {band.freq >= 1000 ? `${(band.freq / 1000).toFixed(1)}k` : band.freq} Hz
 </button>
 </div>
 )
 })()}
 </div>
 <p
 className="text-xs text-dark-300 leading-relaxed hover:text-dark-200 transition-colors cursor-pointer"
 onClick={() => navigator.clipboard.writeText(`${rec.area}: ${rec.action}`)}
 title="Click to copy"
 >
 {rec.action}
 </p>
 </div>
 </div>
 )
 })}
 </div>

 {bands.length > 0 && (
 <div className="flex items-center justify-between pt-2 border-t border-dark-700/30">
 <p className="text-[10px] text-dark-500 italic">
 Click any move above to apply — audition live, then export or bounce.
 </p>
 <div className="flex items-center gap-4">
 <button
 onClick={() => setBandEnabled(bands.map(() => true))}
 className="text-[10px] tracking-[0.1em] uppercase transition-colors hover:text-[#d0b066]"
 style={{ color: '#d0b066' }}
 >
 Apply all
 </button>
 <button
 onClick={() => setBandEnabled(bands.map(() => false))}
 className="text-[10px] tracking-[0.1em] uppercase transition-colors hover:text-[#a8a29e]"
 style={{ color: '#8d867b' }}
 >
 Bypass all
 </button>
 </div>
 </div>
 )}
 </div>
 )}

 {/* Actionable EQ moves derived from spectrum diff */}
 {bands.length > 0 ? (
 <>
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <span className="text-[10px] uppercase tracking-[0.12em] text-dark-500">
 Match moves — derived EQ
 </span>
 <InfoTooltip text={`Parametric EQ bands derived from the spectrum difference between ${labelA} and ${labelB}. Positive gain boosts where B is quieter than A; negative gain cuts where B is hotter. Audition below and export to your DAW, or apply and bounce a corrected WAV.`} />
 </div>
 {fileB && (
 <EQExportButton
 bands={scaledBands as any}
 engineer={`match-${labelA.slice(0, 16)}`}
 fileName={fileB.name}
 amountPct={eqAmount}
 />
 )}
 </div>

 {/* Primary action — render the corrected WAV right here, no DAW
 round-trip. Above the preview because beta testers couldn't find
 it when it was buried as a menu item in the export dropdown. */}
 {fileB && (
 <ApplyBounceButton
 bands={scaledBands as any}
 bandEnabled={bandEnabled}
 srcFilePath={fileB.path}
 fileName={fileB.name}
 amountPct={eqAmount}
 tpLimit={tpLimit}
 setTpLimit={setTpLimit}
 refLufs={refLufs}
 refLabel={labelA}
 />
 )}

 {fileB && (
 <EQPreviewPlayer
 fileB={fileB}
 filters={bands as any}
 engineer={`match-${labelA}`}
 bandEnabled={bandEnabled}
 setBandEnabled={setBandEnabled}
 eqAmount={eqAmount}
 setEqAmount={setEqAmount}
 tpLimit={tpLimit}
 setTpLimit={setTpLimit}
 />
 )}
 </>
 ) : (
 <div className="bg-dark-900 rounded-2xl p-6 border border-dark-700/50 text-center space-y-2">
 <p className="text-sm" style={{ color: '#a8a29e' }}>No EQ moves needed</p>
 <p className="text-[11px]" style={{ color: '#8d867b' }}>
 {labelA} and {labelB} are within {MIN_DIFF_DB} dB across every region — tonal balance already matches.
 </p>
 </div>
 )}
 </div>
 )
}
