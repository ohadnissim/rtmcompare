import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { EngineerTips, FileInfo } from '../types'
import InfoTooltip from './InfoTooltip'
import EQExportButton from './EQExportButton'
import ApplyBounceButton from './ApplyBounceButton'
import { onShortcut, emitShortcut, RTM_EVENTS } from '../shortcuts'
import { useEQ } from '../EQContext'

interface Props {
 tips: EngineerTips
 fileB?: FileInfo
}

const PRIORITY_CONFIG = {
 high: { color: '#e05a5a', bg: 'rgba(224,90,90,0.08)', label: 'Key' },
 medium: { color: '#e07a4f', bg: 'rgba(224,122,79,0.08)', label: 'Suggested' },
 low: { color: '#6ec577', bg: 'rgba(110,197,119,0.08)', label: 'Fine-tune' },
}

// 5.2.1 defensive cap (Austin Seltzer beta-tester report). The Python
// `_compute_eq_filters` is now capped server-side at ±4 dB / ±3 dB sub,
// but a profile JSON cached from a previous version may still ship hot
// values. We re-clamp at the panel boundary so no path can deliver
// destructive moves into the EQ chain or the bounce.
function clampEqFilter<T extends { freq: number; gain_db: number }>(f: T): T {
 const cap = f.freq < 80 ? 3.0 : 4.0
 return { ...f, gain_db: Math.max(-cap, Math.min(cap, f.gain_db)) }
}

export default function EngineerTipsPanel({ tips, fileB }: Props) {
 const filters = (tips.eq_filters || []).map(clampEqFilter)
 const [bandEnabled, setBandEnabled] = useState<boolean[]>(filters.map(() => false))
 // EQ amount lives at the panel level so the export / apply-and-bounce
 // buttons can scale their bands by it too.
 const [eqAmount, setEqAmount] = useState(100)
 // Push bands into the global EQ context so the main A/B player can
 // audition filter moves *while* playback continues (FabFilter-killer
 // feature). Write on mount and on any band-toggle / amount-slide;
 // ABPlayer's biquad bank updates in real time via the context.
 const eq = useEQ()
 useEffect(() => {
 eq.setBands(filters.map((f, i) => ({
 id: `tip-${i}-${f.freq}`,
 freq: f.freq,
 gain_db: f.gain_db,
 q: f.q,
 type: 'peaking',
 enabled: !!bandEnabled[i],
 label: f.q_note || f.region,
 })))
 // Amount is a single global scalar so moving the fader animates
 // gain across every band at once.
 eq.setAmount(eqAmount / 100)
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [filters, bandEnabled, eqAmount])
 // Clear the context on unmount so a stale band set doesn't linger
 // in the player if the user closes the Engineer Tips panel.
 useEffect(() => () => { eq.clear() }, []) // eslint-disable-line react-hooks/exhaustive-deps
 // True-peak limiter toggle — shared by the live EQ preview AND the
 // apply-and-bounce render so the user's "safe delivery" choice carries
 // through both audition and final render. Starts bypassed (like the EQ
 // itself) so users hear the unlimited signal first.
 const [tpLimit, setTpLimit] = useState(false)

 // Bands scaled by the amount fader — these are what gets exported / bounced.
 const scaledFilters = useMemo(() => filters.map(f => ({
 ...f,
 gain_db: Math.round((f.gain_db * (eqAmount / 100)) * 10) / 10,
 })), [filters, eqAmount])

 // Compute live corrected spectrum based on which bands are enabled
 const liveCorrected = useMemo(() => {
 if (!tips.spectrum_file || !tips.spectrum_target || !filters.length) return tips.spectrum_corrected
 // Start with file spectrum, apply only enabled filter corrections
 const FREQS = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000]
 const result = [...tips.spectrum_file]
 for (let fi = 0; fi < filters.length; fi++) {
 if (!bandEnabled[fi]) continue
 const f = filters[fi]
 // Apply gain to nearby frequency bins
 for (let i = 0; i < result.length; i++) {
 const freq = FREQS[i]
 // Simple bell curve influence: strongest at center, falls off
 const octaves = Math.abs(Math.log2(freq / f.freq))
 const influence = Math.max(0, 1 - octaves / (1.5 / f.q))
 result[i] += f.gain_db * influence
 }
 }
 return result.map(v => Math.round(v * 10) / 10)
 }, [tips.spectrum_file, tips.spectrum_target, filters, bandEnabled])

 return (
 <div className="space-y-6">
 {/* Match Score + Radar + Curve upload CTA */}
 <div className="grid grid-cols-3 gap-4">
 <MatchScore score={tips.match_score || 0} engineer={tips.engineer} />
 <div className="col-span-2">
 <RadarChart tips={tips} />
 </div>
 </div>

 {/* Prominent "Load custom target" action — discoverable here next to the
 EQ preview where users actually care about tonal targets. */}
 {(window as any).electronAPI?.loadCustomProfile && (
 <div className="flex items-center justify-between rounded-xl px-4 py-3"
 style={{ backgroundColor: 'rgba(124,164,163,0.06)', border: '1px solid rgba(124,164,163,0.25)' }}>
 <div className="flex-1 pr-3">
 <div className="text-xs font-medium" style={{ color: '#7ca4a3' }}>
 Swap the target curve · use your own reference
 </div>
 <div className="text-[10px] text-dark-400 mt-0.5">
 Load a custom profile JSON (31-band curve, optionally with LUFS / width stats).
 The EQ preview and tips below re-target to your curve.
 </div>
 </div>
 <button
 onClick={async () => {
 try {
 const added = await (window as any).electronAPI.loadCustomProfile()
 if (added) {
 // Profile is saved — nudge user to re-analyze with it selected.
 alert(`Saved "${added.name}". Start a new comparison and pick it from the Engineer Profile dropdown.`)
 }
 } catch (err: any) {
 alert(err?.message || 'Could not load profile')
 }
 }}
 className="text-[11px] px-3 py-1.5 rounded-md transition-colors"
 style={{ backgroundColor: 'rgba(124,164,163,0.15)', color: '#7ca4a3', border: '1px solid rgba(124,164,163,0.35)' }}
 >
 Load target curve…
 </button>
 </div>
 )}


 {/* Tips list header + export */}
 <div className="flex items-center justify-between">
 <span className="text-[10px] uppercase tracking-[0.12em] text-dark-500">Suggested moves</span>
 {filters.length > 0 && (
 <EQExportButton
 bands={scaledFilters as any}
 engineer={tips.engineer}
 fileName={fileB?.name}
 amountPct={eqAmount}
 />
 )}
 </div>

 {/* Tips list */}
 <div className="space-y-2">
 {tips.tips.map((tip, i) => (
 <TipRow key={i} tip={tip} />
 ))}
 </div>

 {/* Primary action — render the corrected WAV right here, no DAW
 round-trip. Above the preview because beta testers couldn't find
 it when it was buried as a menu item in the export dropdown. */}
 {fileB && filters.length > 0 && (
 <ApplyBounceButton
 bands={scaledFilters as any}
 bandEnabled={bandEnabled}
 srcFilePath={fileB.path}
 fileName={fileB.name}
 amountPct={eqAmount}
 tpLimit={tpLimit}
 setTpLimit={setTpLimit}
 />
 )}

 {/* EQ Preview Player — after tips so user reads tips first, then listens */}
 {fileB && filters.length > 0 && (
 <EQPreviewPlayer
 fileB={fileB}
 filters={filters}
 engineer={tips.engineer}
 bandEnabled={bandEnabled}
 setBandEnabled={setBandEnabled}
 eqAmount={eqAmount}
 setEqAmount={setEqAmount}
 tpLimit={tpLimit}
 setTpLimit={setTpLimit}
 />
 )}

 {/* Spectrum: File B vs Target vs Live Corrected */}
 {tips.spectrum_file && tips.spectrum_target && (
 <div className="bg-dark-900 rounded-2xl p-6 border border-dark-700/50 space-y-3">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <span className="text-xs font-medium text-dark-300">Tonal Curve</span>
 <InfoTooltip text="Shows how File B's frequency balance compares to the engineer's target curve. The green 'After EQ' line updates live as you toggle EQ bands above." />
 </div>
 <div className="flex items-center gap-3 text-[9px]">
 <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded" style={{ backgroundColor: '#6b8cbb' }} /> File B</span>
 <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded" style={{ backgroundColor: '#e07a4f' }} /> {tips.engineer}</span>
 <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded" style={{ backgroundColor: '#6ec577' }} /> After EQ</span>
 </div>
 </div>
 <SpectrumChart
 specFile={tips.spectrum_file}
 specTarget={tips.spectrum_target}
 specCorrected={liveCorrected}
 freqs={tips.freqs || []}
 />
 </div>
 )}

 {/* Tonal differences bar chart */}
 {tips.tonal_diff.length > 0 && (
 <div className="bg-dark-900 rounded-2xl p-6 border border-dark-700/50 space-y-3">
 <div className="flex items-center gap-2">
 <span className="text-xs font-medium text-dark-300">Tonal Differences by Region</span>
 <InfoTooltip text="Shows how each frequency region of your file differs from the engineer's target. Positive = louder than target (may need a cut), Negative = quieter (may need a boost)." />
 </div>
 <div className="space-y-1.5">
 {tips.tonal_diff.map((td, i) => (
 <div key={i} className="flex items-center gap-3">
 <span className="text-[11px] text-dark-400 w-20">{td.region}</span>
 <span className="text-[10px] text-dark-500 w-16">{td.freq_range}</span>
 <div className="flex-1 h-2.5 relative" style={{ backgroundColor: '#1a1918' }}>
 <div className="absolute left-1/2 top-0 bottom-0 w-px" style={{ backgroundColor: '#3a3835' }} />
 <div className="absolute top-0 bottom-0 rounded-sm" style={{
 left: td.direction === 'above' ? '50%' : `${50 + (td.diff_db / 10) * 50}%`,
 width: `${Math.min(50, Math.abs(td.diff_db / 10) * 50)}%`,
 backgroundColor: Math.abs(td.diff_db) > 3 ? '#e07a4f' : '#6b8cbb',
 opacity: 0.6,
 }} />
 </div>
 <span className={`text-[10px] font-mono w-12 text-right ${Math.abs(td.diff_db) > 3 ? 'text-orange-400' : 'text-dark-400'}`}>
 {td.diff_db > 0 ? '+' : ''}{td.diff_db} dB
 </span>
 </div>
 ))}
 </div>
 </div>
 )}
 </div>
 )
}


// ─── Match Score (0-100 circle) ─────────────────────────────────────────────

function MatchScore({ score, engineer }: { score: number; engineer: string }) {
 const color = score >= 80 ? '#6ec577' : score >= 50 ? '#e07a4f' : '#e05a5a'
 // Grounding copy so the number isn't floating in a vacuum (panel
 // feedback: "60 doesn't tell me if I'm close to Spotify-ready or if I
 // need to rework the master"). Three plain-language bands, picked so
 // the thresholds align with the ring colour above.
 const verdict =
 score >= 80 ? { label: 'Close to target', sub: 'Small tweaks at most.' } :
 score >= 50 ? { label: 'In the ballpark', sub: 'One or two EQ moves will close the gap.' } :
 { label: 'Meaningful gap', sub: 'Work through the tips below before delivery.' }

 return (
 <div className="bg-dark-900 rounded-2xl p-6 border border-dark-700/50 flex flex-col items-center justify-center gap-3">
 <div className="relative w-24 h-24">
 <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
 <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#2a2927" strokeWidth="2.5" />
 <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke={color} strokeWidth="2.5" strokeDasharray={`${score}, 100`} strokeLinecap="round" />
 </svg>
 <div className="absolute inset-0 flex flex-col items-center justify-center">
 <span className="text-2xl font-bold" style={{ color }}>{score}</span>
 </div>
 </div>
 <div className="text-center">
 <p className="text-[11px]" style={{ color, fontWeight: 500 }}>{verdict.label}</p>
 <p className="text-[9px] mt-0.5" style={{ color: '#7a7164' }}>{verdict.sub}</p>
 <p className="text-[9px] mt-1.5" style={{ color: '#8d867b' }}>vs {engineer}'s style</p>
 </div>
 </div>
 )
}


// ─── Radar Chart ────────────────────────────────────────────────────────────

function RadarChart({ tips }: { tips: EngineerTips }) {
 const size = 200
 const center = size / 2
 const radius = 70

 // 5 axes: Loudness, Dynamics, Width, Low End, High End
 const axes = [
 { label: 'Loudness', file: normalize(tips.file_stats.lufs, -16, -4), target: normalize(tips.target_stats.lufs, -16, -4) },
 { label: 'Dynamics', file: normalize(tips.file_stats.dynamic_range, 1, 12), target: normalize(tips.target_stats.dynamic_range, 1, 12) },
 { label: 'Width', file: normalize(tips.file_stats.width * 100, 0, 30), target: normalize(tips.target_stats.width * 100, 0, 30) },
 { label: 'Low End', file: tips.spectrum_file ? normalize(avg(tips.spectrum_file, 3, 6), -5, 15) : 0.5, target: tips.spectrum_target ? normalize(avg(tips.spectrum_target, 3, 6), -5, 15) : 0.5 },
 { label: 'High End', file: tips.spectrum_file ? normalize(avg(tips.spectrum_file, 23, 28), -15, 0) : 0.5, target: tips.spectrum_target ? normalize(avg(tips.spectrum_target, 23, 28), -15, 0) : 0.5 },
 ]

 const n = axes.length
 const angleStep = (Math.PI * 2) / n

 const getPoint = (value: number, i: number) => ({
 x: center + Math.sin(i * angleStep) * radius * value,
 y: center - Math.cos(i * angleStep) * radius * value,
 })

 const filePath = axes.map((a, i) => getPoint(a.file, i)).map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z'
 const targetPath = axes.map((a, i) => getPoint(a.target, i)).map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z'

 return (
 <div className="bg-dark-900 rounded-2xl p-4 border border-dark-700/50 flex flex-col items-center justify-center gap-2">
 <div className="flex items-center gap-1.5 self-start pl-2">
 <span className="text-[10px] text-dark-400">Profile Radar</span>
 <InfoTooltip text="Blue = your file, Orange = engineer's target. The closer the blue shape matches the orange, the more your file aligns with the engineer's style across loudness, dynamics, stereo width, low-end and high-end balance." />
 </div>
 <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[300px]" style={{ aspectRatio: '1' }}>
 {/* Grid rings */}
 {[0.25, 0.5, 0.75, 1].map(r => (
 <circle key={r} cx={center} cy={center} r={radius * r} fill="none" stroke="#2a2927" strokeWidth="0.5" />
 ))}
 {/* Axis lines */}
 {axes.map((_, i) => {
 const p = getPoint(1, i)
 return <line key={i} x1={center} y1={center} x2={p.x} y2={p.y} stroke="#2a2927" strokeWidth="0.5" />
 })}
 {/* Target shape */}
 <path d={targetPath} fill="rgba(224,122,79,0.1)" stroke="#e07a4f" strokeWidth="1.5" opacity="0.6" />
 {/* File shape */}
 <path d={filePath} fill="rgba(107,140,187,0.1)" stroke="#6b8cbb" strokeWidth="1.5" />
 {/* Labels */}
 {axes.map((a, i) => {
 const p = getPoint(1.2, i)
 return <text key={i} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize="7" fill="#78716c">{a.label}</text>
 })}
 </svg>
 </div>
 )
}

function normalize(value: number, min: number, max: number): number {
 return Math.max(0, Math.min(1, (value - min) / (max - min)))
}

function avg(arr: number[], start: number, end: number): number {
 const slice = arr.slice(start, end)
 return slice.reduce((a, b) => a + b, 0) / slice.length
}


// ─── EQ Preview Player ──────────────────────────────────────────────────────

/**
 * Build a coarse peak envelope (one entry per column of UI pixels) from
 * the decoded AudioBuffer. Uses channel 0 as a proxy; plenty for a visual
 * scrub map. Normalised to [0, 1].
 */
function computeEnvelope(buffer: AudioBuffer, columns: number): number[] {
 const data = buffer.getChannelData(0)
 const step = Math.max(1, Math.floor(data.length / columns))
 const out = new Array(columns).fill(0)
 let peak = 0
 for (let c = 0; c < columns; c++) {
 const start = c * step
 const end = Math.min(data.length, start + step)
 let mx = 0
 for (let i = start; i < end; i++) {
 const v = Math.abs(data[i])
 if (v > mx) mx = v
 }
 out[c] = mx
 if (mx > peak) peak = mx
 }
 if (peak > 0) {
 for (let i = 0; i < out.length; i++) out[i] = out[i] / peak
 }
 return out
}

/** Return the start-time (seconds) of the loudest windowSec span via 1 s
 * RMS frames, centred on the peak. Mirrors StreamingPreview's helper but
 * kept local to avoid cross-component coupling. */
function findLoudestWindow(buffer: AudioBuffer, windowSec: number): number {
 const sr = buffer.sampleRate
 const duration = buffer.duration
 if (duration <= windowSec) return 0
 const data = buffer.getChannelData(0)
 const frameLen = sr
 const frameCount = Math.floor(data.length / frameLen)
 if (frameCount < 2) return Math.max(0, (duration - windowSec) / 2)
 const rms: number[] = new Array(frameCount)
 for (let f = 0; f < frameCount; f++) {
 let sum = 0
 const base = f * frameLen
 for (let i = 0; i < frameLen; i++) {
 const v = data[base + i]
 sum += v * v
 }
 rms[f] = Math.sqrt(sum / frameLen)
 }
 let peakIdx = 0
 let peakVal = 0
 for (let f = 0; f < frameCount; f++) {
 if (rms[f] > peakVal) { peakVal = rms[f]; peakIdx = f }
 }
 let start = peakIdx - windowSec / 2
 start = Math.max(0, Math.min(duration - windowSec, start))
 return start
}

export function EQPreviewPlayer({ fileB, filters, engineer, bandEnabled, setBandEnabled, eqAmount, setEqAmount, tpLimit, setTpLimit }: {
 fileB: FileInfo
 filters: { freq: number; gain_db: number; q: number; region: string }[]
 engineer: string
 bandEnabled: boolean[]
 setBandEnabled: React.Dispatch<React.SetStateAction<boolean[]>>
 eqAmount: number
 setEqAmount: React.Dispatch<React.SetStateAction<number>>
 /** True-peak limiter toggle — shared with export for a consistent render. */
 tpLimit: boolean
 setTpLimit: React.Dispatch<React.SetStateAction<boolean>>
}) {
 // Live-EQ bridge to the main A/B player. The toggle next to the
 // listening-settings gear flips `eq.enabled`, which causes the main
 // ABPlayer to route its listen chain through the shared biquad bank.
 const eq = useEQ()
 const [playing, setPlaying] = useState(false)
 // Start bypassed by default — user hears the original mix first, then toggles EQ in.
 const [bypassed, setBypassed] = useState(true)
 // Level-match: auto-compensate the makeup gain so EQ on/off have the same
 // perceived loudness — lets you judge TONE changes without loudness bias.
 const [levelMatch, setLevelMatch] = useState(true)
 // Shortcut hook — `L` flips the level-match toggle from anywhere.
 useEffect(() => onShortcut(RTM_EVENTS.levelMatchToggle, () => setLevelMatch(v => !v)), [])
 const ctxRef = useRef<AudioContext | null>(null)
 const sourceRef = useRef<AudioBufferSourceNode | null>(null)
 const biquadsRef = useRef<BiquadFilterNode[]>([])
 const limiterRef = useRef<DynamicsCompressorNode | null>(null)
 // Analyser taps + makeup gain for real-time level-matching.
 const dryAnalyserRef = useRef<AnalyserNode | null>(null)
 const wetAnalyserRef = useRef<AnalyserNode | null>(null)
 const makeupRef = useRef<GainNode | null>(null)
 const rafRef = useRef<number | null>(null)
 // Track current match state in a ref so the RAF loop sees the latest
 // values without having to re-subscribe on every toggle.
 const levelMatchRef = useRef(levelMatch)
 const bypassedRef = useRef(bypassed)
 useEffect(() => { levelMatchRef.current = levelMatch }, [levelMatch])
 useEffect(() => { bypassedRef.current = bypassed }, [bypassed])
 const bufferRef = useRef<AudioBuffer | null>(null)
 // Synchronous flag so rapid play/pause clicks don't race React state.
 const playingRef = useRef(false)
 // Guard against double-invocation of play() while the async setup is
 // still in flight (the initial file decode can take >100ms).
 const startingRef = useRef(false)

 // Listening settings popover (TP limiter + Level matched live here — they
 // are set-and-forget, not per-session knobs).
 const [listeningOpen, setListeningOpen] = useState(false)

 // 5.5.2: solo-in-place. When non-null, only that band contributes gain;
 // all other bands stay in the chain at gain 0 dB (so the biquad chain
 // length / phase stays identical, the band keeps its position — hence
 // "in place"). Esc clears.
 const [soloBand, setSoloBand] = useState<number | null>(null)
 const gainForBand = useCallback((i: number): number => {
 if (bypassed) return 0
 if (soloBand != null) return i === soloBand ? filters[i].gain_db * (eqAmount / 100) : 0
 return bandEnabled[i] ? filters[i].gain_db * (eqAmount / 100) : 0
 }, [bypassed, soloBand, bandEnabled, filters, eqAmount])
 useEffect(() => {
 const onKey = (e: KeyboardEvent) => {
 if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
 if (e.key === 'Escape' && soloBand != null) {
 e.preventDefault()
 setSoloBand(null)
 }
 }
 window.addEventListener('keydown', onKey)
 return () => window.removeEventListener('keydown', onKey)
 }, [soloBand])

 // Loop region (seconds). Null until the file is analysed and we pick a
 // default "loudest section" window — users can drag on the waveform to
 // override. Refs mirror the state so the async play() + RAF closures
 // always read the latest value without re-binding.
 const [loopStart, setLoopStart] = useState<number | null>(null)
 const [loopEnd, setLoopEnd] = useState<number | null>(null)
 const loopStartRef = useRef<number | null>(null)
 const loopEndRef = useRef<number | null>(null)
 useEffect(() => { loopStartRef.current = loopStart }, [loopStart])
 useEffect(() => { loopEndRef.current = loopEnd }, [loopEnd])

 // Small waveform envelope (array of [0,1] magnitudes) for the scrub UI.
 // Computed once per buffer from channel 0 — good enough as a visual map.
 const [waveEnvelope, setWaveEnvelope] = useState<number[] | null>(null)
 const [bufferDuration, setBufferDuration] = useState<number | null>(null)

 const anyEnabled = bandEnabled.some(Boolean)

 const stop = useCallback(() => {
 playingRef.current = false
 startingRef.current = false
 try { sourceRef.current?.stop() } catch {}
 // Detach the onended handler so it doesn't flip state back on a source
 // that we're intentionally tearing down.
 if (sourceRef.current) { sourceRef.current.onended = null }
 sourceRef.current = null
 try { ctxRef.current?.close() } catch {}
 ctxRef.current = null
 biquadsRef.current = []
 try { limiterRef.current?.disconnect() } catch {}
 limiterRef.current = null
 try { dryAnalyserRef.current?.disconnect() } catch {}
 try { wetAnalyserRef.current?.disconnect() } catch {}
 try { makeupRef.current?.disconnect() } catch {}
 dryAnalyserRef.current = null
 wetAnalyserRef.current = null
 makeupRef.current = null
 if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
 setPlaying(false)
 }, [])

 const play = useCallback(async () => {
 // Hard guard against double-invocation
 if (playingRef.current) { stop(); return }
 if (startingRef.current) return
 if (!window.electronAPI) return

 startingRef.current = true
 try {
 // Mastering-grade EQ preview:
 // • Fresh AudioContext per play session — avoids the "zombie context"
 // state that made subsequent plays overlap the previous session.
 // • AudioContext at file's NATIVE sample rate to avoid resampling.
 // • latencyHint "playback" for stable, click-free audition.
 const ab = bufferRef.current ? null : await window.electronAPI.readAudioFile(fileB.path)

 // Probe native SR if we haven't cached a buffer yet
 let nativeSr = 44100
 if (ab) {
 const probe = new (window.AudioContext || (window as any).webkitAudioContext)()
 const probeBuf = await probe.decodeAudioData(ab.slice(0))
 nativeSr = probeBuf.sampleRate
 await probe.close()
 } else if (bufferRef.current) {
 nativeSr = bufferRef.current.sampleRate
 }

 // Bail if the user hit Pause during the decode race.
 if (!startingRef.current) return

 let ctx: AudioContext
 try { ctx = new AudioContext({ sampleRate: nativeSr, latencyHint: 'playback' }) }
 catch { ctx = new AudioContext({ latencyHint: 'playback' }) }
 ctxRef.current = ctx

 if (ab && !bufferRef.current) {
 bufferRef.current = await ctx.decodeAudioData(ab)
 } else if (bufferRef.current && bufferRef.current.sampleRate !== ctx.sampleRate) {
 // SR mismatch between cached buffer and new ctx — re-decode.
 const ab2 = await window.electronAPI.readAudioFile(fileB.path)
 bufferRef.current = await ctx.decodeAudioData(ab2)
 }

 if (!startingRef.current) { try { ctx.close() } catch {}; ctxRef.current = null; return }
 if (!bufferRef.current) throw new Error('no audio buffer')

 // First-time prep: compute a small waveform envelope for the loop
 // scrubber AND pick a default loop region centred on the loudest
 // 15 s window. The user can override by dragging on the waveform.
 if (waveEnvelope == null) {
 const env = computeEnvelope(bufferRef.current, 240)
 setWaveEnvelope(env)
 setBufferDuration(bufferRef.current.duration)
 if (loopStartRef.current == null || loopEndRef.current == null) {
 const loudest = findLoudestWindow(bufferRef.current, 15)
 const ls = loudest
 const le = Math.min(bufferRef.current.duration, ls + 15)
 setLoopStart(ls)
 setLoopEnd(le)
 loopStartRef.current = ls
 loopEndRef.current = le
 }
 }

 const source = ctx.createBufferSource()
 source.buffer = bufferRef.current
 sourceRef.current = source

 const biquads: BiquadFilterNode[] = []
 for (let i = 0; i < filters.length; i++) {
 const bq = ctx.createBiquadFilter()
 bq.type = 'peaking'
 bq.frequency.value = filters[i].freq
 bq.gain.value = gainForBand(i)
 bq.Q.value = filters[i].q
 biquads.push(bq)
 }
 biquadsRef.current = biquads

 // Dry tap — measures the pre-EQ RMS so the level-match loop can
 // compute how much the EQ changed overall loudness.
 const dryAnalyser = ctx.createAnalyser()
 dryAnalyser.fftSize = 2048
 dryAnalyser.smoothingTimeConstant = 0
 source.connect(dryAnalyser)
 dryAnalyserRef.current = dryAnalyser

 let node: AudioNode = source
 for (const bq of biquads) { node.connect(bq); node = bq }

 // Wet tap — post-EQ RMS measurement for the level-match comparison.
 const wetAnalyser = ctx.createAnalyser()
 wetAnalyser.fftSize = 2048
 wetAnalyser.smoothingTimeConstant = 0
 node.connect(wetAnalyser)
 wetAnalyserRef.current = wetAnalyser

 // Makeup gain — driven by the RAF loop to compensate EQ-induced
 // loudness change. 1.0 when matched or when EQ is bypassed.
 const makeup = ctx.createGain()
 makeup.gain.value = 1.0
 node.connect(makeup)
 makeupRef.current = makeup
 node = makeup

 // Optional true-peak safety limiter — Web Audio's DynamicsCompressor
 // is not 16× oversampled like the bounce render, but with a hard
 // threshold of -0.3 dB, ratio 20:1, fast attack and short release it
 // reliably prevents audible overs on the live preview. Final bounce
 // still uses the mastering-grade Python limiter.
 const limiter = ctx.createDynamicsCompressor()
 limiter.threshold.value = -0.3
 limiter.knee.value = 0
 limiter.ratio.value = 20
 limiter.attack.value = 0.001
 limiter.release.value = 0.1
 limiterRef.current = limiter
 if (tpLimit) {
 node.connect(limiter)
 limiter.connect(ctx.destination)
 } else {
 node.connect(ctx.destination)
 }

 // Real-time level-matching loop. Reads RMS from both analyser taps and
 // drives `makeup.gain` toward dry/wet so EQ on/off perceives the same.
 // Smoothing is via setTargetAtTime — avoids audible zipper noise.
 const dryBuf = new Float32Array(dryAnalyser.fftSize)
 const wetBuf = new Float32Array(wetAnalyser.fftSize)
 const tick = () => {
 const c = ctxRef.current
 const m = makeupRef.current
 const dA = dryAnalyserRef.current
 const wA = wetAnalyserRef.current
 if (!c || !m || !dA || !wA) return
 // Only compensate when the user asked for it AND the EQ is actually
 // changing the signal. Otherwise snap makeup to unity.
 if (!levelMatchRef.current || bypassedRef.current) {
 m.gain.setTargetAtTime(1.0, c.currentTime, 0.05)
 } else {
 dA.getFloatTimeDomainData(dryBuf)
 wA.getFloatTimeDomainData(wetBuf)
 let dry = 0, wet = 0
 for (let i = 0; i < dryBuf.length; i++) dry += dryBuf[i] * dryBuf[i]
 for (let i = 0; i < wetBuf.length; i++) wet += wetBuf[i] * wetBuf[i]
 dry = Math.sqrt(dry / dryBuf.length)
 wet = Math.sqrt(wet / wetBuf.length)
 if (dry > 1e-5 && wet > 1e-5) {
 // Clamp to ±6 dB so a weird silent block can't blast or mute.
 const ratio = Math.max(0.5, Math.min(2.0, dry / wet))
 // 200 ms time-constant → smooth, no zipper, tracks programme.
 m.gain.setTargetAtTime(ratio, c.currentTime, 0.2)
 }
 }
 rafRef.current = requestAnimationFrame(tick)
 }
 rafRef.current = requestAnimationFrame(tick)

 // Use the user-set loop region when present, otherwise fall back to a
 // sensible default (middle-ish 30 s window). The "loudest section"
 // auto-pick is driven via the envelope effect below, not computed
 // here — keeps play() cheap and deterministic.
 const dur = bufferRef.current.duration
 let startOffset = loopStartRef.current ?? Math.max(0, dur / 2 - 15)
 let endOffset = loopEndRef.current ?? Math.min(dur, startOffset + 30)
 if (endOffset - startOffset < 1) endOffset = Math.min(dur, startOffset + 1)
 source.loop = true
 source.loopStart = startOffset
 source.loopEnd = endOffset
 source.start(0, startOffset)

 playingRef.current = true
 startingRef.current = false
 setPlaying(true)

 // Announce to the bus so the main A/B player pauses — two chains
 // fighting the output device is only ever cacophony.
 try { emitShortcut(RTM_EVENTS.eqPreviewStarted) } catch {}

 source.onended = () => {
 // Only flip state if this is still the active source — stop() nulls it.
 if (sourceRef.current === source) {
 playingRef.current = false
 setPlaying(false)
 try { ctx.close() } catch {}
 if (ctxRef.current === ctx) ctxRef.current = null
 sourceRef.current = null
 }
 }
 } catch (err) {
 console.error('[engineer-tips] play failed:', err)
 startingRef.current = false
 playingRef.current = false
 setPlaying(false)
 try { ctxRef.current?.close() } catch {}
 ctxRef.current = null
 }
 }, [fileB, filters, bandEnabled, bypassed, stop, tpLimit])

 // Stop playback when the component unmounts — otherwise a leftover
 // AudioContext keeps producing audio after the panel closes.
 useEffect(() => { return () => { stop() } }, [stop])

 // Exclusive playback — if the main A/B player starts, we stop. Mirrored
 // on the ABPlayer side so it pauses when we start. Prevents two audio
 // chains fighting the output device.
 useEffect(() => onShortcut(RTM_EVENTS.mainPlayerStarted, () => {
 if (playingRef.current) stop()
 }), [stop])

 const toggleBand = useCallback((idx: number) => {
 setBandEnabled(prev => {
 const next = [...prev]
 next[idx] = !next[idx]
 // Mirror the new state into the biquad ourselves rather than
 // depending on the gainForBand effect to fire — keeps clicks
 // snappy. When solo is active, toggling a band's enabled flag
 // doesn't change audible audio (only the soloed band sounds);
 // it just re-stores intent for when solo clears.
 if (biquadsRef.current[idx] && !bypassed && soloBand == null) {
 biquadsRef.current[idx].gain.value = next[idx] ? filters[idx].gain_db * (eqAmount / 100) : 0
 }
 return next
 })
 }, [filters, setBandEnabled, bypassed, eqAmount, soloBand])

 const toggleSolo = useCallback((idx: number) => {
 setSoloBand(prev => prev === idx ? null : idx)
 }, [])

 // Live update when user drags the amount fader, toggles solo, or
 // changes any band-enable flag — single source of truth via gainForBand.
 useEffect(() => {
 if (bypassed) return
 biquadsRef.current.forEach((bq, i) => { bq.gain.value = gainForBand(i) })
 }, [eqAmount, bypassed, bandEnabled, filters, soloBand, gainForBand])

 // Live loop-region update during playback. Setting source.loopStart /
 // loopEnd mid-flight only helps when the playhead is still inside the
 // OLD region — the moment the user drags the loop to a different part
 // of the track, the playhead is usually outside the new bounds and the
 // source just keeps playing where it was. Fix: write the new bounds so
 // small nudges take effect cleanly, AND after a short debounce restart
 // the source from the new loopStart so big moves actually jump.
 const loopRestartTimer = useRef<number | null>(null)
 useEffect(() => {
 if (loopStart == null || loopEnd == null) return
 const src = sourceRef.current
 if (src) {
 try { src.loopStart = loopStart } catch {}
 try { src.loopEnd = loopEnd } catch {}
 }
 // Only restart if we're actually playing — otherwise the next play()
 // will pick up the new region via loopStartRef/loopEndRef anyway.
 if (!playingRef.current) return
 if (loopRestartTimer.current != null) window.clearTimeout(loopRestartTimer.current)
 loopRestartTimer.current = window.setTimeout(() => {
 loopRestartTimer.current = null
 if (!playingRef.current) return
 // Teardown + fresh play. stop() clears context + source + RAF; play()
 // rebuilds the chain and starts from loopStartRef.current.
 stop()
 // Yield once so the close() settles before the new AudioContext is
 // constructed. Otherwise Safari sometimes reuses stale state.
 Promise.resolve().then(() => { play() })
 }, 180)
 return () => {
 if (loopRestartTimer.current != null) {
 window.clearTimeout(loopRestartTimer.current)
 loopRestartTimer.current = null
 }
 }
 }, [loopStart, loopEnd])

 // Live re-route when user toggles TP limiter during playback. The chain
 // is `... biquads → makeup → [limiter?] → destination`, so we re-wire
 // the makeup output each time the toggle flips. Also re-hook the analyser
 // + biquad → makeup taps so the splitter stays intact.
 useEffect(() => {
 const ctx = ctxRef.current
 const limiter = limiterRef.current
 const biquads = biquadsRef.current
 const makeup = makeupRef.current
 const wetAnalyser = wetAnalyserRef.current
 if (!ctx || !limiter || !makeup || biquads.length === 0) return
 const lastBq = biquads[biquads.length - 1]
 try {
 makeup.disconnect()
 limiter.disconnect()
 lastBq.disconnect()
 } catch {}
 // Rebuild taps: biquads → wetAnalyser (tap) AND biquads → makeup.
 if (wetAnalyser) lastBq.connect(wetAnalyser)
 lastBq.connect(makeup)
 if (tpLimit) {
 makeup.connect(limiter)
 limiter.connect(ctx.destination)
 } else {
 makeup.connect(ctx.destination)
 }
 }, [tpLimit])

 // Master bypass — mutes all EQ without losing individual band states
 const toggleBypass = useCallback(() => {
 const newBypassed = !bypassed
 setBypassed(newBypassed)
 biquadsRef.current.forEach((bq, i) => {
 if (newBypassed) { bq.gain.value = 0; return }
 if (soloBand != null) {
 bq.gain.value = i === soloBand ? filters[i].gain_db * (eqAmount / 100) : 0
 } else {
 bq.gain.value = bandEnabled[i] ? filters[i].gain_db * (eqAmount / 100) : 0
 }
 })
 }, [bypassed, bandEnabled, filters, soloBand, eqAmount])

 // Enable all bands
 const enableAll = useCallback(() => {
 setBandEnabled(filters.map(() => true))
 if (!bypassed) {
 biquadsRef.current.forEach((bq, i) => {
 bq.gain.value = filters[i].gain_db * (eqAmount / 100)
 })
 }
 }, [filters, setBandEnabled, bypassed, eqAmount])

 // Disable all bands
 const disableAll = useCallback(() => {
 setBandEnabled(filters.map(() => false))
 biquadsRef.current.forEach((bq) => {
 bq.gain.value = 0
 })
 }, [filters, setBandEnabled])

 return (
 <div className="relative bg-dark-900 rounded-2xl p-6 border border-dark-700/50 space-y-5">
 {/* ── Header row — title + "Hear in main player" toggle + Listening
 gear. The main-player toggle is the FabFilter-killer: flip it
 on and every band-toggle / Amount nudge is audible over the
 main A/B playback with zero interruption. */}
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <h3 className="text-sm font-semibold">EQ Preview</h3>
 <InfoTooltip text="Toggle bands on the left rail, scrub the loop region on the waveform, adjust Amount, hit Play to loop the selected section until you pause." />
 </div>
 <div className="flex items-center gap-2">
 {/* 5.4.1: surface level-match as a quick-access pill so the user
     can A/B EQ-on vs EQ-off at MATCHED loudness without digging
     into the gear-icon popover. Same state as the popover toggle —
     toggle either, both update. Keyboard shortcut: L.
     Why this matters: a +3 dB EQ band makes the program ~1 dB
     louder. Without level-match, the engineer hears "EQ on" as
     "louder" and the listening test biases toward "EQ on = better".
     Level-match closes that loop with auto-RMS makeup so the only
     audible change is tonal. */}
 <button
 onClick={() => setLevelMatch(v => !v)}
 className="text-[10px] px-2.5 py-1 rounded-md transition-colors"
 style={{
 color: levelMatch ? '#6ec577' : '#8d867b',
 backgroundColor: levelMatch ? 'rgba(110,197,119,0.10)' : 'transparent',
 border: `1px solid ${levelMatch ? 'rgba(110,197,119,0.40)' : 'rgba(168,161,150,0.20)'}`,
 }}
 title={levelMatch
 ? 'Level-matched A/B is ON. Auto-RMS compensation makes EQ on / off hit the same perceived loudness so you judge tone, not volume. Press L to toggle.'
 : 'Level-matched A/B is OFF. EQ on / off play at their natural loudness, which biases listening to "louder = better". Press L to enable level-matching.'}
 aria-pressed={levelMatch}
 >
 {levelMatch ? '● Level matched' : 'Level matched'}
 </button>
 <button
 onClick={() => eq.setEnabled(!eq.enabled)}
 className="text-[10px] px-2.5 py-1 rounded-md transition-colors"
 style={{
 color: eq.enabled ? '#d0b066' : '#8d867b',
 backgroundColor: eq.enabled ? 'rgba(208,176,102,0.12)' : 'transparent',
 border: `1px solid ${eq.enabled ? 'rgba(208,176,102,0.45)' : 'rgba(168,161,150,0.2)'}`,
 }}
 title={eq.enabled
 ? 'EQ live in the main player. Toggle bands to hear changes over playback. Click to bypass.'
 : 'Engage the EQ bank in the main A/B player. Once on, band-toggles and Amount nudges audition over playback with no stop-and-restart.'}
 aria-pressed={eq.enabled}
 >
 {eq.enabled ? '● Live in main player' : 'Live in main player'}
 </button>
 <button
 onClick={() => setListeningOpen(v => !v)}
 className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-white/[0.05]"
 style={{ color: listeningOpen ? '#d0b066' : '#8d867b', border: '1px solid rgba(168,161,150,0.15)' }}
 title="Listening settings: true-peak limiter, level-matched A/B"
 aria-label="Listening settings"
 >
 <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
 <circle cx="12" cy="12" r="3" />
 <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06A1.65 1.65 0 0015 19.4a1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09A1.65 1.65 0 0015 4.6a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.14.34.22.7.22 1.06 0 .36-.08.72-.22 1.06z" />
 </svg>
 </button>
 </div>
 </div>

 {/* ── Two-column body — chips left, player right. The chips are the
 data; the player is the instrument. Separating them stops the
 globals from competing with per-band toggles. */}
 <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
 {/* Left rail — per-band chip stack with on/off + trim nudge */}
 <div className="lg:col-span-5 space-y-1.5">
 <div className="flex items-center justify-between px-1 pb-1">
 <span className="text-[10px] uppercase tracking-[0.12em] text-dark-500">Bands</span>
 <div className="flex items-center gap-3">
 <button
 onClick={enableAll}
 className="text-[10px] tracking-[0.08em] uppercase hover:text-[#d0b066] transition-colors"
 style={{ color: '#8d867b' }}
 title="Enable all bands"
 >All</button>
 <button
 onClick={disableAll}
 className="text-[10px] tracking-[0.08em] uppercase hover:text-[#a8a29e] transition-colors"
 style={{ color: '#8d867b' }}
 title="Disable all bands"
 >None</button>
 </div>
 </div>
 <div className="space-y-1">
 {filters.map((f, i) => {
 const enabled = bandEnabled[i]
 const isBoost = f.gain_db > 0
 const scaledGain = f.gain_db * (eqAmount / 100)
 const scaledDisplay = (scaledGain > 0 ? '+' : '') + scaledGain.toFixed(1)
 const fullDisplay = (f.gain_db > 0 ? '+' : '') + f.gain_db.toFixed(1)
 const isSoloed = soloBand === i
 const isMuted = soloBand != null && soloBand !== i
 return (
 <div
 key={i}
 onClick={() => toggleBand(i)}
 className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors hover:bg-white/[0.03]"
 style={{
 backgroundColor: isSoloed ? 'rgba(208,176,102,0.12)' : enabled ? 'rgba(208,176,102,0.05)' : 'transparent',
 borderLeft: `2px solid ${isSoloed ? '#d0b066' : enabled ? (isBoost ? '#6ec577' : '#e07a4f') : 'transparent'}`,
 opacity: isMuted ? 0.45 : 1,
 }}
 role="button"
 tabIndex={0}
 aria-pressed={enabled}
 >
 {/* Status dot — on/off indicator */}
 <span
 className="w-1.5 h-1.5 rounded-full flex-shrink-0"
 style={{
 backgroundColor: enabled ? (isBoost ? '#6ec577' : '#e07a4f') : '#3e3a33',
 }}
 />
 {/* Gain chip — flat text with a bottom hairline (matches
 the Match-tab chip style). */}
 <span
 className="font-mono tabular-nums text-sm flex-shrink-0 w-14 text-right"
 style={{
 color: enabled ? (isBoost ? '#6ec577' : '#e07a4f') : '#8d867b',
 }}
 title={eqAmount < 100 ? `Scaled to ${eqAmount}% of ${fullDisplay} dB` : undefined}
 >
 {scaledDisplay}
 </span>
 {/* Frequency + region */}
 <div className="flex-1 min-w-0">
 <div className="text-[11px]" style={{ color: enabled ? '#ebe7e0' : '#8d867b' }}>
 {f.region}
 </div>
 <div className="text-[10px] font-mono" style={{ color: enabled ? '#7a7164' : '#8d867b' }}>
 {f.freq >= 1000 ? `${(f.freq/1000).toFixed(f.freq >= 10000 ? 0 : 1)}k Hz` : `${f.freq} Hz`}
 <span className="mx-1 opacity-50">·</span>
 Q {f.q.toFixed(1)}
 </div>
 </div>
 {/* Solo-in-place — mutes other bands' gain to 0 dB but keeps
 them in the chain. Esc clears. Stops the row click from
 toggling band-enable. */}
 <button
 type="button"
 onClick={(e) => { e.stopPropagation(); toggleSolo(i) }}
 className="w-6 h-6 rounded text-[9px] tracking-[0.08em] uppercase font-mono flex-shrink-0 flex items-center justify-center transition-colors"
 style={{
 color: isSoloed ? '#0e0d0b' : '#8d867b',
 backgroundColor: isSoloed ? '#d0b066' : 'transparent',
 border: `1px solid ${isSoloed ? '#d0b066' : 'rgba(168,161,150,0.25)'}`,
 }}
 title={isSoloed ? 'Clear solo (Esc)' : 'Solo in place — only this band sounds; others stay in the chain at 0 dB'}
 aria-pressed={isSoloed}
 aria-label={isSoloed ? `Clear solo on ${f.region}` : `Solo ${f.region} in place`}
 >
 S
 </button>
 </div>
 )
 })}
 </div>
 </div>

 {/* Right rail — player: waveform loop, play, Amount, A/B bypass */}
 <div className="lg:col-span-7 space-y-4">
 <WaveformLoopPicker
 envelope={waveEnvelope}
 duration={bufferDuration}
 loopStart={loopStart}
 loopEnd={loopEnd}
 onChange={(ls, le) => { setLoopStart(ls); setLoopEnd(le) }}
 />
 <div className="flex items-center gap-4">
 {/* Play */}
 <button
 onClick={play}
 className="w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-105 flex-shrink-0"
 style={{
 backgroundColor: playing ? 'rgba(224,122,79,0.15)' : 'rgba(208,176,102,0.12)',
 border: `1px solid ${playing ? 'rgba(224,122,79,0.5)' : 'rgba(208,176,102,0.4)'}`,
 }}
 title={playing ? 'Pause (Space)' : 'Play — loops the highlighted region (Space)'}
 aria-label={playing ? 'Pause' : 'Play'}
 >
 {playing ? (
 <svg className="w-4 h-4" fill="#e07a4f" viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
 ) : (
 <svg className="w-4 h-4" fill="#d0b066" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
 )}
 </button>

 {/* Amount fader */}
 <div className="flex-1 flex items-center gap-2">
 <label className="text-[10px] uppercase tracking-[0.1em] text-dark-500 w-14 flex-shrink-0">Amount</label>
 <input
 type="range"
 min="0"
 max="100"
 step="1"
 value={eqAmount}
 onChange={(e) => setEqAmount(Number(e.target.value))}
 aria-label={`EQ amount ${eqAmount} percent`}
 className="flex-1 accent-terra"
 style={{ accentColor: '#d0b066' }}
 />
 <span className="text-[11px] font-mono tabular-nums w-10 text-right flex-shrink-0" style={{ color: eqAmount === 100 ? '#8d867b' : '#d0b066' }}>
 {eqAmount}%
 </span>
 </div>

 {/* A/B bypass — renamed from "BYPASSED / EQ ON" to the honest
 A/B framing. The button IS the A (dry) vs B (wet) toggle. */}
 <button
 onClick={toggleBypass}
 className="px-4 py-2 rounded-md text-[11px] font-semibold tracking-[0.1em] uppercase transition-colors flex-shrink-0"
 style={{
 backgroundColor: 'rgba(208,176,102,0.08)',
 color: bypassed ? '#8d867b' : '#d0b066',
 border: '1px solid rgba(208,176,102,0.3)',
 }}
 title={bypassed ? 'Hearing dry signal — click to engage EQ' : 'Hearing EQ\'d signal — click to bypass'}
 >
 {bypassed ? 'A · dry' : 'B · eq'}
 </button>
 </div>

 {/* Hint strip */}
 <p className="text-[10px] text-dark-500 italic">
 Click the waveform to re-centre the 15 s loop · drag to set a custom region.
 </p>
 </div>
 </div>

 {/* Listening settings popover — anchored top-right, click ⚙ to toggle */}
 {listeningOpen && (
 <div
 className="absolute right-6 top-14 z-20 rounded-xl p-4 space-y-3 min-w-[260px]"
 style={{
 backgroundColor: '#1e1c18',
 border: '1px solid rgba(208,176,102,0.3)',
 boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
 }}
 >
 <div className="flex items-center justify-between">
 <span className="text-[10px] uppercase tracking-[0.15em]" style={{ color: '#d0b066' }}>Listening</span>
 <button
 onClick={() => setListeningOpen(false)}
 className="text-sand-500 hover:text-sand-200 text-lg leading-none"
 aria-label="Close"
 >×</button>
 </div>
 <p className="text-[10px] text-dark-500 italic">Set once, then forget — these affect both the preview and the bounce.</p>
 <label className="flex items-start gap-2 cursor-pointer">
 <input
 type="checkbox"
 checked={tpLimit}
 onChange={(e) => setTpLimit(e.target.checked)}
 className="mt-0.5"
 style={{ accentColor: '#d0b066' }}
 />
 <div className="flex-1">
 <div className="text-[11px]" style={{ color: '#ebe7e0' }}>
 Safety limiter
 </div>
 <div
 className="text-[9px] text-dark-500 mt-0.5"
 title="Web Audio DynamicsCompressor at -0.3 dB / 20:1 — click-free during live audition. The Apply-and-bounce render uses the mastering-grade Python limiter (16× polyphase Kaiser, sub-0.05 dB ceiling accuracy)."
 >
 −0.3 dB ceiling on the live audition. Apply-and-bounce uses the mastering-grade 16× limiter.
 </div>
 </div>
 </label>
 <label className="flex items-start gap-2 cursor-pointer">
 <input
 type="checkbox"
 checked={levelMatch}
 onChange={(e) => setLevelMatch(e.target.checked)}
 className="mt-0.5"
 style={{ accentColor: '#6ec577' }}
 />
 <div className="flex-1">
 <div className="text-[11px]" style={{ color: '#ebe7e0' }}>
 Level-matched A/B
 </div>
 <div className="text-[9px] text-dark-500 mt-0.5">
 Auto RMS compensation so EQ on / off hit at the same perceived loudness. Judge tone, not volume.
 </div>
 </div>
 </label>
 </div>
 )}
 </div>
 )
}

/**
 * Waveform-with-loop-region scrubber. Shows the amplitude envelope as a
 * row of bars with a gold region highlighting the current loop bounds.
 * Click anywhere to re-centre a 15 s window; drag to set a custom region.
 */
function WaveformLoopPicker({ envelope, duration, loopStart, loopEnd, onChange }: {
 envelope: number[] | null
 duration: number | null
 loopStart: number | null
 loopEnd: number | null
 onChange: (ls: number, le: number) => void
}) {
 const ref = useRef<HTMLDivElement>(null)
 const dragRef = useRef<{ startX: number; t: number } | null>(null)

 const pxToSec = (clientX: number): number => {
 const el = ref.current
 if (!el || !duration) return 0
 const rect = el.getBoundingClientRect()
 const x = Math.max(0, Math.min(rect.width, clientX - rect.left))
 return (x / rect.width) * duration
 }

 const onMouseDown = (e: React.MouseEvent) => {
 if (!duration) return
 const t = pxToSec(e.clientX)
 dragRef.current = { startX: e.clientX, t }
 // Single click without drag = centre a 15 s window on the click point
 // (handled in mouseup unless the user drags). Start with a zero-length
 // region so we can detect the drag threshold.
 onChange(Math.max(0, t - 0.25), Math.min(duration, t + 0.25))
 window.addEventListener('mousemove', onMouseMove)
 window.addEventListener('mouseup', onMouseUp)
 }
 const onMouseMove = (e: MouseEvent) => {
 const d = dragRef.current
 if (!d || !duration) return
 const t = pxToSec(e.clientX)
 const a = Math.min(d.t, t)
 const b = Math.max(d.t, t)
 onChange(Math.max(0, a), Math.min(duration, b))
 }
 const onMouseUp = (e: MouseEvent) => {
 const d = dragRef.current
 window.removeEventListener('mousemove', onMouseMove)
 window.removeEventListener('mouseup', onMouseUp)
 if (!d || !duration) { dragRef.current = null; return }
 const dragged = Math.abs(e.clientX - d.startX) > 6
 if (!dragged) {
 // Click without meaningful drag — recentre a 15 s window.
 const w = 15
 const ls = Math.max(0, Math.min(duration - w, d.t - w / 2))
 onChange(ls, ls + w)
 }
 dragRef.current = null
 }

 const pct = (t: number | null) => (t == null || !duration) ? 0 : Math.max(0, Math.min(100, (t / duration) * 100))
 const startPct = pct(loopStart)
 const endPct = pct(loopEnd)

 if (!envelope || !duration) {
 return (
 <div className="h-20 rounded-lg flex items-center justify-center text-[11px]"
 style={{ backgroundColor: 'rgba(48,44,39,0.4)', border: '1px solid rgba(168,161,150,0.08)', color: '#a8a29e' }}>
 Press Play to analyse the file — waveform will appear here.
 </div>
 )
 }

 return (
 <div className="space-y-1.5">
 <div
 ref={ref}
 onMouseDown={onMouseDown}
 className="relative h-20 rounded-lg select-none cursor-crosshair overflow-hidden"
 style={{ backgroundColor: 'rgba(48,44,39,0.4)', border: '1px solid rgba(168,161,150,0.08)' }}
 >
 {/* Envelope bars */}
 <div className="absolute inset-0 flex items-center gap-[1px] px-0.5">
 {envelope.map((v, i) => {
 // Only highlight bars inside the loop region.
 const barPct = (i / envelope.length) * 100
 const inside = barPct >= startPct && barPct <= endPct
 return (
 <div
 key={i}
 className="flex-1"
 style={{
 height: `${Math.max(2, v * 100)}%`,
 backgroundColor: inside ? 'rgba(208,176,102,0.85)' : 'rgba(168,161,150,0.25)',
 transition: 'background-color 150ms',
 }}
 />
 )
 })}
 </div>
 {/* Region overlay — subtle gold tint + start/end handles */}
 {loopStart != null && loopEnd != null && (
 <>
 <div
 className="absolute top-0 bottom-0 pointer-events-none"
 style={{
 left: `${startPct}%`,
 width: `${Math.max(0.5, endPct - startPct)}%`,
 backgroundColor: 'rgba(208,176,102,0.08)',
 borderLeft: '1px solid rgba(208,176,102,0.6)',
 borderRight: '1px solid rgba(208,176,102,0.6)',
 }}
 />
 </>
 )}
 </div>
 <div className="flex items-center justify-between text-[10px] font-mono" style={{ color: '#7a7164' }}>
 <span>{fmtSec(loopStart)}</span>
 <span className="uppercase tracking-[0.1em] text-[9px]" style={{ color: '#d0b066' }}>
 Loop · {fmtDur(loopEnd != null && loopStart != null ? loopEnd - loopStart : null)}
 </span>
 <span>{fmtSec(loopEnd)}</span>
 </div>
 </div>
 )
}

function fmtSec(t: number | null): string {
 if (t == null) return '—'
 const m = Math.floor(t / 60)
 const s = Math.floor(t - m * 60)
 const ms = Math.round((t - m * 60 - s) * 100)
 return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
}
function fmtDur(t: number | null): string {
 if (t == null) return '—'
 return `${t.toFixed(1)} s`
}


// ─── Spectrum Chart ─────────────────────────────────────────────────────────

function SpectrumChart({ specFile, specTarget, specCorrected, freqs }: {
 specFile: number[]; specTarget: number[]; specCorrected?: number[]; freqs: string[]
}) {
 const w = 800, h = 200
 const pad = { top: 10, bottom: 25, left: 5, right: 5 }
 const gw = w - pad.left - pad.right
 const gh = h - pad.top - pad.bottom

 const allVals = [...specFile, ...specTarget, ...(specCorrected || [])].filter(v => v > -50)
 const maxDb = Math.max(...allVals) + 2
 const minDb = Math.min(...allVals) - 2

 const toX = (i: number) => pad.left + (i / (specFile.length - 1)) * gw
 const toY = (v: number) => pad.top + (1 - (v - minDb) / (maxDb - minDb)) * gh
 const makePath = (data: number[]) => data.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')

 const labelIndices = [0, 4, 8, 12, 16, 20, 24, 28, 30]

 return (
 <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: '180px' }} preserveAspectRatio="none">
 {[0, -5, -10, -15, -20].map(db => (
 <g key={db}>
 <line x1={pad.left} y1={toY(db)} x2={w - pad.right} y2={toY(db)} stroke="#2a2927" strokeWidth="0.5" />
 <text x={pad.left + 2} y={toY(db) - 3} fontSize="7" fill="#4a4845">{db} dB</text>
 </g>
 ))}
 <path d={makePath(specTarget)} fill="none" stroke="#e07a4f" strokeWidth="2" opacity="0.5" strokeDasharray="4 2" />
 {specCorrected && <path d={makePath(specCorrected)} fill="none" stroke="#6ec577" strokeWidth="1.5" opacity="0.7" />}
 <path d={makePath(specFile)} fill="none" stroke="#6b8cbb" strokeWidth="2" />
 {labelIndices.map(i => (
 i < freqs.length && <text key={i} x={toX(i)} y={h - 3} textAnchor="middle" fontSize="7" fill="#57534e">{freqs[i]}</text>
 ))}
 </svg>
 )
}


// ─── Tip Row ────────────────────────────────────────────────────────────────

function TipRow({ tip }: { tip: { category: string; priority: string; tip: string; detail: string; eq_move?: { freq: number; gain_db: number; q: number; q_note?: string; region: string } | null } }) {
 const [expanded, setExpanded] = useState(false)
 const config = PRIORITY_CONFIG[tip.priority as keyof typeof PRIORITY_CONFIG] || PRIORITY_CONFIG.low
 const move = tip.eq_move

 const fmtFreq = (hz: number) =>
 hz >= 1000 ? `${(hz / 1000).toFixed(1).replace(/\.0$/, '')} kHz` : `${Math.round(hz)} Hz`

 return (
 <div className="rounded-xl overflow-hidden" style={{ backgroundColor: config.bg, border: `1px solid ${config.color}15` }}>
 <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
 <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full flex-shrink-0" style={{ color: config.color, backgroundColor: `${config.color}20` }}>{config.label}</span>
 <span className="text-[10px] text-dark-500 w-24 flex-shrink-0">{tip.category}</span>
 <span className="text-xs text-dark-200 flex-1">{tip.tip}</span>

 {/* Machine-readable EQ move chip — so the user sees freq + gain + Q
 right on the row without expanding or cross-referencing a chart. */}
 {move && (
 <span className="flex items-center gap-1.5 flex-shrink-0 px-2 py-1 rounded-md font-mono text-[10px]"
 style={{ backgroundColor: 'rgba(14,13,11,0.4)', border: '1px solid rgba(168,161,150,0.15)' }}
 title={move.q_note ? `Q ${move.q.toFixed(1)} — ${move.q_note}` : `Q ${move.q.toFixed(1)}`}
 >
 <span style={{ color: '#8d867b' }}>{fmtFreq(move.freq)}</span>
 <span style={{ color: move.gain_db >= 0 ? '#6fa37e' : '#c96765' }}>
 {move.gain_db >= 0 ? '+' : ''}{move.gain_db.toFixed(1)} dB
 </span>
 <span style={{ color: '#d0b066' }}>Q {move.q.toFixed(1)}</span>
 </span>
 )}

 <svg className="w-3 h-3 flex-shrink-0 transition-transform" style={{ color: '#8d867b', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
 </svg>
 </button>
 {expanded && (
 <div className="px-4 pb-3 pl-28 space-y-1">
 <p className="text-[10px] text-dark-500">{tip.detail}</p>
 {move?.q_note && (
 <p className="text-[10px]" style={{ color: '#d0b066' }}>
 Q shape: <strong>{move.q_note}</strong> — {move.q_note === 'narrow — surgical'
 ? 'tight, corrective — fixes a resonant peak without affecting the band next door.'
 : move.q_note === 'wide — tonal shift'
 ? 'broad, musical — shifts the whole region gently, like a tilt.'
 : 'middle ground — corrective enough to move the balance without sounding phasey.'}
 </p>
 )}
 </div>
 )}
 </div>
 )
}

function StatCompare({ label, current, target, diff, unit }: { label: string; current: string; target: string; diff: number; unit: string }) {
 const isClose = Math.abs(diff) < 1.5
 const color = isClose ? '#6ec577' : Math.abs(diff) > 3 ? '#e05a5a' : '#e07a4f'
 return (
 <div className="rounded-lg p-3 text-center space-y-1.5" style={{ backgroundColor: 'rgba(26,25,24,0.5)' }}>
 <p className="text-[9px] text-dark-600 uppercase tracking-wider">{label}</p>
 <p className="text-sm font-mono" style={{ color }}>{current}</p>
 <p className="text-[9px] text-dark-500">target: {target}</p>
 <p className="text-[10px] font-mono" style={{ color }}>{diff > 0 ? '+' : ''}{diff.toFixed(1)} {unit}</p>
 </div>
 )
}
