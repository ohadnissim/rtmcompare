import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import { ClickArtifact } from '../types'

interface Props {
 clicks: ClickArtifact[]
 labelB: string
 fileA?: { path: string }
 fileB?: { path: string }
 waveform?: number[]
 durationSec?: number
}

const severityConfig = {
 high: { color: '#f43f5e', bg: 'rgba(244,63,94,0.15)', label: 'Loud', markerSize: 14 },
 medium: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'Moderate', markerSize: 12 },
 low: { color: '#84858c', bg: 'rgba(132,133,140,0.12)', label: 'Subtle', markerSize: 10 },
}

// Pre-roll 1.5 s so the listener hears the bar leading into the click,
// making the artifact much easier to spot in context.
function seekToTime(time: number, file?: 'A' | 'B') {
 window.dispatchEvent(new CustomEvent('rtm-seek', { detail: { time: Math.max(0, time - 1.5), file } }))
}

export default function ClickTimeline({ clicks, labelB, fileA, fileB, waveform, durationSec }: Props) {
 // All hooks must be called unconditionally before any early return
 // (Rules of Hooks — violating this causes React to throw in strict mode).
 const highCount = useMemo(() => clicks.filter(c => c.severity === 'high').length, [clicks])
 const medCount = useMemo(() => clicks.filter(c => c.severity === 'medium').length, [clicks])
 const lowCount = useMemo(() => clicks.filter(c => c.severity === 'low').length, [clicks])

 const maxTime = useMemo(() => {
 if (!clicks || clicks.length === 0) return 60
 return Math.max(clicks[clicks.length - 1].time + 10, 60)
 }, [clicks])

 const timeMarkers = useMemo(() => {
 const markers: number[] = []
 const interval = maxTime > 180 ? 60 : 30
 for (let t = 0; t <= maxTime; t += interval) {
 markers.push(t)
 }
 return markers
 }, [maxTime])

 // Early return AFTER all hooks — safe to bail out here
 if (!clicks || clicks.length === 0) return null

 return (
 <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-5" style={{ borderRadius: '2px' }}>
 {/* Header */}
 <div className="flex items-center justify-between">
 <div className="space-y-1">
 <h2 className="text-lg font-semibold">Clicks & Glitches</h2>
 <p className="text-xs text-dark-400">
 Potential clicks, pops, or glitches detected — bad edits, buffer errors, or plugin artifacts. Click play to verify.
 </p>
 </div>
 <div className="flex items-center gap-2">
 {highCount > 0 && (
 <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
 style={{ color: '#f43f5e', backgroundColor: 'rgba(244,63,94,0.15)' }}>
 {highCount} loud
 </span>
 )}
 {medCount > 0 && (
 <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
 style={{ color: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.12)' }}>
 {medCount} moderate
 </span>
 )}
 {lowCount > 0 && (
 <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
 style={{ color: '#84858c', backgroundColor: 'rgba(132,133,140,0.12)' }}>
 {lowCount} subtle
 </span>
 )}
 </div>
 </div>

 {/* Visual Timeline */}
 <div className="space-y-1">
 <div className="relative h-20 bg-dark-800 overflow-visible px-3" style={{ borderRadius: '2px' }}>
 <div className="absolute inset-x-3 top-1/2 -translate-y-1/2 h-px bg-dark-600" />

 {/* RMS waveform — CLIPPED to the rail only (time-label/markers poke above).
 A nested div with overflow-hidden gives the waveform its own bounding box
 so it can't leak into the next section. */}
 {waveform && waveform.length > 0 && (
 <div className="absolute inset-x-3 top-1/2 -translate-y-1/2 pointer-events-none overflow-hidden rounded"
 style={{ height: '70%' }}>
 <svg
 className="w-full h-full"
 viewBox={`0 0 100 100`}
 preserveAspectRatio="none"
 >
 {waveform.map((v, i) => {
 const tWave = durationSec ? (i / waveform.length) * durationSec : (i / waveform.length) * maxTime
 const x = (tWave / maxTime) * 100
 if (x > 100) return null
 const h = Math.max(2, v * 80)
 return (
 <rect
 key={i}
 x={x}
 y={50 - h / 2}
 width={Math.max(0.3, 100 / waveform.length * 0.8)}
 height={h}
 fill="#4c4d52"
 opacity="0.4"
 />
 )
 })}
 </svg>
 </div>
 )}

 {timeMarkers.map(t => {
 const pct = (t / maxTime) * 100
 return (
 <div key={t} className="absolute top-0 bottom-0" style={{ left: `calc(${pct}% + 0px)` }}>
 <div className="h-full w-px bg-dark-700/40" style={{ marginLeft: '12px' }} />
 </div>
 )
 })}

 {clicks.map((click, i) => {
 const config = severityConfig[click.severity]
 const pct = (click.time / maxTime) * 100
 return (
 <div
 key={i}
 className="absolute top-0 bottom-0 flex flex-col items-center justify-center cursor-pointer"
 style={{ left: `${pct}%` }}
 onClick={() => seekToTime(click.time, 'B')}
 title={`Click to seek to ${click.time_formatted}`}
 >
 <div
 className="absolute top-1 bottom-1 w-0.5 rounded-full"
 style={{ backgroundColor: config.color, opacity: 0.5 }}
 />
 <div
 className="relative z-10 rounded-full border-2 shadow-lg hover:scale-125 transition-transform"
 style={{
 width: config.markerSize,
 height: config.markerSize,
 backgroundColor: config.color,
 borderColor: '#1a1a1c',
 boxShadow: `0 0 8px ${config.color}80`,
 }}
 />
 <div
 className="absolute font-mono font-bold px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap"
 style={{
 bottom: 'calc(100% - 4px)',
 color: config.color,
 backgroundColor: '#1a1a1c',
 }}
 >
 {click.time_formatted}
 </div>
 </div>
 )
 })}
 </div>

 <div className="relative h-4 px-3">
 {timeMarkers.map(t => {
 const pct = (t / maxTime) * 100
 return (
 <span
 key={t}
 className="absolute text-[9px] text-dark-500 -translate-x-1/2"
 style={{ left: `${pct}%` }}
 >
 {formatTime(t)}
 </span>
 )
 })}
 </div>
 </div>

 {/* Click list with play controls */}
 <div className="space-y-1.5 max-h-48 overflow-y-auto">
 {clicks.map((click, i) => (
 <ClickRow key={i} click={click} fileA={fileA} fileB={fileB} />
 ))}
 </div>

 {/* Summary */}
 {clicks.length > 0 && (
 <div className="text-[10px] text-dark-500 pt-1 space-y-1">
 <p>Use the play buttons to verify each detection. Some results may be triggered by sharp transients (drums, percussion) or aggressive processing rather than actual artifacts.</p>
 </div>
 )}
 </div>
 )
}

function ClickRow({ click, fileA, fileB }: { click: ClickArtifact; fileA?: { path: string }; fileB?: { path: string } }) {
 const config = severityConfig[click.severity]
 const [playing, setPlaying] = useState(false)
 // Error message shown inline on the row so users aren't left staring at
 // a dead play button. Cleared on the next successful start.
 const [errorMsg, setErrorMsg] = useState<string | null>(null)

 // Auto-dismiss transient "playback failed" toasts after 8 s so the
 // error chip doesn't stick around after the user has moved on to a
 // different click / row. Every new error resets the timer via the
 // effect's dependency.
 useEffect(() => {
 if (!errorMsg) return
 const t = setTimeout(() => setErrorMsg(null), 8000)
 return () => clearTimeout(t)
 }, [errorMsg])

 const ctxRef = useRef<AudioContext | null>(null)
 const sourceRef = useRef<AudioBufferSourceNode | null>(null)
 // Ref mirror of `playing` so the four handlers can gate without racing
 // on React state. Rapid clicks across buttons (C then F) used to slip
 // through the `if (playing)` check because the state hadn't committed
 // yet — result: two concurrent AudioContexts, ctxRef overwritten,
 // first one leaked and never stopped.
 const playingRef = useRef(false)

 const isSingleFile = !fileB || (fileA?.path === fileB?.path)
 const targetFile = fileB || fileA

 const stopPlayback = useCallback(() => {
 try { sourceRef.current?.stop() } catch {}
 try { ctxRef.current?.close() } catch {}
 sourceRef.current = null
 ctxRef.current = null
 playingRef.current = false
 setPlaying(false)
 }, [])

 // Unmount cleanup — if the user navigates away while audio is playing,
 // the AudioContext would keep humming into the destination otherwise.
 useEffect(() => () => {
 try { sourceRef.current?.stop() } catch {}
 try { ctxRef.current?.close() } catch {}
 }, [])

 /**
 * Play the 2-second region around the click through a narrow band-pass
 * filter centred where digital clicks live (3 kHz, Q≈4). Complements
 * the existing residual-subtraction "click-only" mode: this one's
 * useful when the click is embedded in a loud transient and the
 * subtraction trick under-reveals it (residual gets masked). Band-
 * isolated playback catches the zipper / quantisation nature of
 * digital clicks without touching the rest of the signal.
 */
 const playBandSolo = useCallback(async () => {
 if (!targetFile || !window.electronAPI) return
 if (playingRef.current) { stopPlayback(); return }
 playingRef.current = true
 setErrorMsg(null)
 try {
 const ctx = new AudioContext()
 ctxRef.current = ctx
 const buf = await window.electronAPI.readAudioFile(targetFile.path).then(ab => ctx.decodeAudioData(ab))

 const startSec = Math.max(0, click.time - 1)
 const endSec = Math.min(buf.duration, click.time + 1)
 const startSample = Math.floor(startSec * buf.sampleRate)
 const endSample = Math.floor(endSec * buf.sampleRate)
 const length = endSample - startSample

 const regionBuf = ctx.createBuffer(buf.numberOfChannels, length, buf.sampleRate)
 for (let ch = 0; ch < buf.numberOfChannels; ch++) {
 const data = buf.getChannelData(ch)
 const region = regionBuf.getChannelData(ch)
 for (let i = 0; i < length; i++) {
 region[i] = startSample + i < data.length ? data[startSample + i] : 0
 }
 }
 const source = ctx.createBufferSource()
 source.buffer = regionBuf
 // Biquad bandpass → gain boost → destination. 3 kHz is the
 // sweet spot for digital clicks / edit artefacts; Q of 4 gives
 // ~750 Hz bandwidth (wide enough to preserve click character).
 const bp = ctx.createBiquadFilter()
 bp.type = 'bandpass'
 bp.frequency.value = 3000
 bp.Q.value = 4
 const boost = ctx.createGain()
 boost.gain.value = 2.0
 source.connect(bp)
 bp.connect(boost)
 boost.connect(ctx.destination)
 source.start()
 sourceRef.current = source
 setPlaying(true)
 source.onended = () => { playingRef.current = false; setPlaying(false); try { ctx.close() } catch {}; ctxRef.current = null }
 } catch (e: any) {
 playingRef.current = false
 setPlaying(false)
 setErrorMsg(e?.message ? `Playback failed: ${e.message}` : 'Playback failed — file may be missing or unreadable.')
 try { ctxRef.current?.close() } catch {}
 ctxRef.current = null
 }
 }, [click, targetFile, stopPlayback])

 // Play region around the click
 const playRegion = useCallback(async () => {
 if (!targetFile || !window.electronAPI) return
 if (playingRef.current) { stopPlayback(); return }
 playingRef.current = true
 setErrorMsg(null)
 try {
 const ctx = new AudioContext()
 ctxRef.current = ctx

 const buf = await window.electronAPI.readAudioFile(targetFile.path).then(ab => ctx.decodeAudioData(ab))

 const startSec = Math.max(0, click.time - 1)
 const endSec = Math.min(buf.duration, click.time + 1)
 const startSample = Math.floor(startSec * buf.sampleRate)
 const endSample = Math.floor(endSec * buf.sampleRate)
 const length = endSample - startSample

 const regionBuf = ctx.createBuffer(buf.numberOfChannels, length, buf.sampleRate)
 for (let ch = 0; ch < buf.numberOfChannels; ch++) {
 const data = buf.getChannelData(ch)
 const region = regionBuf.getChannelData(ch)
 for (let i = 0; i < length; i++) {
 region[i] = startSample + i < data.length ? data[startSample + i] : 0
 }
 }

 const source = ctx.createBufferSource()
 source.buffer = regionBuf
 source.connect(ctx.destination)
 source.start()
 sourceRef.current = source
 setPlaying(true)
 source.onended = () => { playingRef.current = false; setPlaying(false); try { ctx.close() } catch {}; ctxRef.current = null }
 } catch (e: any) {
 playingRef.current = false
 setPlaying(false)
 setErrorMsg(e?.message ? `Playback failed: ${e.message}` : 'Playback failed — file may be missing or unreadable.')
 try { ctxRef.current?.close() } catch {}
 ctxRef.current = null
 }
 }, [click, targetFile, stopPlayback])

 // Play isolated click only (like RX "Output clicks only")
 // Subtracts interpolated "clean" audio from original to isolate just the artifact
 const playClickOnly = useCallback(async () => {
 if (!targetFile || !window.electronAPI) return
 if (playingRef.current) { stopPlayback(); return }
 playingRef.current = true
 setErrorMsg(null)
 try {
 const ctx = new AudioContext()
 ctxRef.current = ctx

 const buf = await window.electronAPI.readAudioFile(targetFile.path).then(ab => ctx.decodeAudioData(ab))

 // Extract region around click
 const clickSample = Math.floor(click.time * buf.sampleRate)
 const glitchHalf = Math.floor(buf.sampleRate * 0.025) // 25ms each side of click
 const padSamples = Math.floor(buf.sampleRate * 0.5) // 500ms context each side
 const startSample = Math.max(0, clickSample - glitchHalf - padSamples)
 const endSample = Math.min(buf.length, clickSample + glitchHalf + padSamples)
 const length = endSample - startSample

 const clickOnlyBuf = ctx.createBuffer(buf.numberOfChannels, length, buf.sampleRate)

 for (let ch = 0; ch < buf.numberOfChannels; ch++) {
 const data = buf.getChannelData(ch)
 const output = clickOnlyBuf.getChannelData(ch)

 // Copy original audio
 for (let i = 0; i < length; i++) {
 output[i] = startSample + i < data.length ? data[startSample + i] : 0
 }

 // In the glitch region, subtract interpolated "clean" audio
 // Interpolate linearly from pre-glitch to post-glitch
 const glitchStart = clickSample - glitchHalf - startSample
 const glitchEnd = clickSample + glitchHalf - startSample

 if (glitchStart > 0 && glitchEnd < length) {
 const valBefore = output[Math.max(0, glitchStart - 1)]
 const valAfter = output[Math.min(length - 1, glitchEnd + 1)]
 const glitchLen = glitchEnd - glitchStart

 // Create delta: original minus interpolated
 for (let i = glitchStart; i < glitchEnd; i++) {
 const t = (i - glitchStart) / glitchLen
 const interpolated = valBefore + (valAfter - valBefore) * t
 output[i] = (output[i] - interpolated) * 8 // amplify the isolated click
 }

 // Silence the non-glitch regions (we only want to hear the click)
 // Fade in from silence to the glitch
 const fadeLen = Math.min(Math.floor(buf.sampleRate * 0.01), glitchStart)
 for (let i = 0; i < glitchStart - fadeLen; i++) {
 output[i] = 0
 }
 // Guard — if glitchStart <= 0 the fadeLen can be 0, which
 // would make `i / fadeLen` = NaN and corrupt the output.
 if (fadeLen > 0) {
 for (let i = 0; i < fadeLen; i++) {
 output[glitchStart - fadeLen + i] *= i / fadeLen
 }
 }
 // Fade out after the glitch
 const fadeLenOut = Math.min(Math.floor(buf.sampleRate * 0.01), length - glitchEnd)
 if (fadeLenOut > 0) {
 for (let i = 0; i < fadeLenOut; i++) {
 output[glitchEnd + i] *= 1 - (i / fadeLenOut)
 }
 }
 for (let i = glitchEnd + fadeLenOut; i < length; i++) {
 output[i] = 0
 }
 }
 }

 const source = ctx.createBufferSource()
 source.buffer = clickOnlyBuf
 source.connect(ctx.destination)
 source.start()
 sourceRef.current = source
 setPlaying(true)
 source.onended = () => { playingRef.current = false; setPlaying(false); try { ctx.close() } catch {}; ctxRef.current = null }
 } catch (e: any) {
 playingRef.current = false
 setPlaying(false)
 setErrorMsg(e?.message ? `Playback failed: ${e.message}` : 'Playback failed — file may be missing or unreadable.')
 try { ctxRef.current?.close() } catch {}
 ctxRef.current = null
 }
 }, [click, targetFile, stopPlayback])

 // Play delta (B minus A) — only for comparison mode
 const playDelta = useCallback(async () => {
 if (!fileA || !fileB || isSingleFile || !window.electronAPI) return
 if (playingRef.current) { stopPlayback(); return }
 playingRef.current = true
 setErrorMsg(null)
 try {
 const ctx = new AudioContext()
 ctxRef.current = ctx

 const [bufA, bufB] = await Promise.all([
 window.electronAPI.readAudioFile(fileA.path).then(ab => ctx.decodeAudioData(ab)),
 window.electronAPI.readAudioFile(fileB.path).then(ab => ctx.decodeAudioData(ab)),
 ])

 // Level match B to A using RMS ratio
 const rmsA = Math.sqrt(bufA.getChannelData(0).reduce((s, v) => s + v * v, 0) / bufA.length)
 const rmsB = Math.sqrt(bufB.getChannelData(0).reduce((s, v) => s + v * v, 0) / bufB.length)
 const levelGain = rmsA > 0.0001 && rmsB > 0.0001 ? rmsA / rmsB : 1

 const startSec = Math.max(0, click.time - 1)
 const endSec = Math.min(Math.min(bufA.duration, bufB.duration), click.time + 1)
 const startSample = Math.floor(startSec * bufA.sampleRate)
 const endSample = Math.floor(endSec * bufA.sampleRate)
 const length = endSample - startSample

 const deltaBuffer = ctx.createBuffer(bufA.numberOfChannels, length, bufA.sampleRate)
 for (let ch = 0; ch < Math.min(bufA.numberOfChannels, bufB.numberOfChannels); ch++) {
 const dataA = bufA.getChannelData(ch)
 const dataB = bufB.getChannelData(ch)
 const delta = deltaBuffer.getChannelData(ch)
 let peak = 0
 for (let i = 0; i < length; i++) {
 const sA = startSample + i < dataA.length ? dataA[startSample + i] : 0
 const sB = startSample + i < dataB.length ? dataB[startSample + i] * levelGain : 0
 delta[i] = sB - sA
 peak = Math.max(peak, Math.abs(delta[i]))
 }
 // Normalize to -6 dB so it's audible without distortion
 if (peak > 0.001) {
 const gain = 0.5 / peak
 for (let i = 0; i < length; i++) {
 delta[i] *= gain
 }
 }
 }

 const source = ctx.createBufferSource()
 source.buffer = deltaBuffer
 source.connect(ctx.destination)
 source.start()
 sourceRef.current = source
 setPlaying(true)
 source.onended = () => { playingRef.current = false; setPlaying(false); try { ctx.close() } catch {}; ctxRef.current = null }
 } catch (e: any) {
 playingRef.current = false
 setPlaying(false)
 setErrorMsg(e?.message ? `Playback failed: ${e.message}` : 'Playback failed — file may be missing or unreadable.')
 try { ctxRef.current?.close() } catch {}
 ctxRef.current = null
 }
 }, [click, fileA, fileB, isSingleFile, stopPlayback])

 return (
 <div
 className="flex items-center gap-2 px-3 py-2.5 text-xs"
 style={{ borderRadius: '2px', backgroundColor: config.bg, borderLeft: `3px solid ${config.color}` }}
 >
 {/* Play region button */}
 <button
 onClick={playRegion}
 className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 hover:scale-110 transition-transform"
 style={{ backgroundColor: `${config.color}30` }}
 title="Play 2s around this click"
 >
 <svg className="w-3 h-3" fill={config.color} viewBox="0 0 24 24">
 <path d="M8 5v14l11-7z" />
 </svg>
 </button>

 {/* Click-only button (like RX "Output clicks only") */}
 <button
 onClick={playClickOnly}
 className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 hover:scale-110 transition-transform"
 style={{ backgroundColor: 'rgba(168,85,247,0.2)' }}
 title="Hear just the click (interpolated-residual isolation)"
 >
 <span className="text-[8px] font-bold" style={{ color: '#a855f7' }}>C</span>
 </button>

 {/* Frequency-band solo — band-pass around 3 kHz (click sweet spot)
 + 2× gain. Complements "C" when the click is masked by a loud
 transient and residual subtraction under-reveals it. */}
 <button
 onClick={playBandSolo}
 className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 hover:scale-110 transition-transform"
 style={{ backgroundColor: 'rgba(34,197,94,0.2)' }}
 title="Solo in band (3 kHz bandpass + boost). Catches zipper / quantisation clicks hidden by loud transients."
 >
 <span className="text-[8px] font-bold" style={{ color: '#22c55e' }}>F</span>
 </button>


 {/* Time */}
 <span className="font-mono font-bold w-14 flex-shrink-0" style={{ color: config.color }}>
 {click.time_formatted}
 </span>

 {/* Severity */}
 <span
 className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0"
 style={{ color: config.color, backgroundColor: `${config.color}20` }}
 >
 {config.label}
 </span>

 {/* Description */}
 <span className="text-dark-300 truncate">{click.description}</span>

 {/* Energy */}
 <span className="text-dark-500 font-mono ml-auto flex-shrink-0">
 {click.energy_db.toFixed(1)} dB
 </span>

 {/* Inline error — appears only after a failed playback attempt.
 Dismisses on the next successful start. Keeps the UI honest
 instead of silently swallowing decode / IPC failures. */}
 {errorMsg && (
 <span
 className="text-[10px] ml-2 flex-shrink-0"
 style={{ color: '#e05a5a' }}
 title={errorMsg}
 >
 ⚠ {errorMsg.length > 40 ? errorMsg.slice(0, 40) + '…' : errorMsg}
 </span>
 )}
 </div>
 )
}

// Tick-rail formatter — short rounded labels at 5/10/30s intervals.
// Per-click rows above use `click.time_formatted` from the Python
// detector, which is already millisecond-precise.
function formatTime(seconds: number): string {
 // Beta-tester request (5.0.6): show tenth-of-second on the tick rail
 // when the track is short, full seconds when it's long. Keeps the rail
 // legible without truncating sub-second precision on click windows.
 const mins = Math.floor(seconds / 60)
 const secs = seconds % 60
 const secStr = seconds < 60
   ? secs.toFixed(1).padStart(4, '0')
   : Math.floor(secs).toString().padStart(2, '0')
 return `${mins}:${secStr}`
}
