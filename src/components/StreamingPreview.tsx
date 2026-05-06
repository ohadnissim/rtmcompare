import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FileInfo } from '../types'
import StreamingDeltaHeatmap from './StreamingDeltaHeatmap'
import TranslationCheckPanel from './TranslationCheckPanel'
import { useEQ } from '../EQContext'
import { TeachTerm } from '../teachMe'

interface Row {
 name: string
 played_lufs: number
 played_tp: number
 delta_db: number
 action: string
 tp_breach: boolean
 target_lufs: number
 target_tp: number
 /** Optional DSP id (matching dspProfiles.ts) so the Sound Check twin
 * can route to the right Python renderer. When missing we fall back
 * to lower-casing the display name. */
 dsp?: string
}

interface Props {
 previewA: Row[]
 previewB: Row[]
 labelA: string
 labelB: string
 soloA?: boolean
 fileA?: FileInfo
 fileB?: FileInfo
 /** Integrated LUFS per side — required for the Sound Check twin so
 * the Python renderer applies the right normalisation gain. */
 lufsA?: number | null
 lufsB?: number | null
}

/**
 * Key / id for a currently-playing audition so only one plays at a time
 * across the whole table. e.g. "Spotify::b".
 */
type AuditionKey = string

// Display-name → dspProfiles.ts id. Keeps the UI human-readable while
// letting the Python renderer select the right normalisation curve.
const DSP_ID_BY_NAME: Record<string, string> = {
 'Spotify': 'spotify',
 'Spotify Loud': 'spotifyLoud',
 'Apple Music': 'apple',
 'Apple': 'apple',
 'YouTube': 'youtube',
 'YouTube Music': 'youtube',
 'Tidal': 'tidal',
 'Amazon Music': 'amazon',
 'Amazon Music HD': 'amazon',
 'Amazon': 'amazon',
}

export default function StreamingPreview({ previewA, previewB, labelA, labelB, soloA, fileA, fileB, lufsA, lufsB }: Props) {
 const twoCol = !soloA && previewB && previewB.length > 0
 const audition = useAudition()
 const eq = useEQ()
 const twin = useSoundCheckTwin(eq.enabled ? eq.proposalKey : 0)
 // Optional override for the 30-second window the Sound Check twin
 // renders. " Null =
 // auto-detect loudest (default).
 const [twinStartSec, setTwinStartSec] = useState<number | null>(null)

 return (
 <div className="bg-dark-900 rounded-2xl p-6 border border-dark-700/50 space-y-4">
 <div className="space-y-1">
 <div className="flex items-center justify-between gap-3 flex-wrap">
 <h2 className="text-lg font-semibold">Streaming Normalization Preview</h2>
 {/* Sound Check twin window override — null = auto-detect
 loudest 30 s; numeric = render the twin starting at this
 second. Useful for ambient / post-rock / albums where
 the "loudest 30s" isn't representative. */}
 {(fileA || fileB) && (
 <label className="text-[10px] flex items-center gap-2" style={{ color: '#7a7164' }}>
 Twin starts at
 <input
 type="number"
 min={0}
 step={1}
 value={twinStartSec ?? ''}
 placeholder="auto (loudest)"
 onChange={e => {
 const v = e.target.value
 setTwinStartSec(v === '' ? null : Math.max(0, Number(v)))
 }}
 className="w-20 px-2 py-0.5 rounded outline-none font-mono"
 style={{ backgroundColor: 'rgba(14,13,11,0.6)', color: '#d0b066', border: '1px solid rgba(168,161,150,0.15)' }}
 title="Seconds from the start. Leave blank to auto-detect the loudest 30 s window."
 />
 <span>s</span>
 {twinStartSec != null && (
 <button
 onClick={() => setTwinStartSec(null)}
 className="px-1.5 rounded"
 style={{ color: '#8d867b', border: '1px solid rgba(168,161,150,0.15)' }}
 >auto</button>
 )}
 </label>
 )}
 </div>
 <p className="text-xs text-dark-400">
 What each platform will actually play this track at, after their loudness normalisation{' '}
 (<TeachTerm term="lufs">LUFS</TeachTerm>). "−5.3 dB" means Spotify will turn your file down 5.3 dB.
 {(fileA || fileB) && (
 <span className="block mt-1 text-[11px] text-dark-500">
 Click ▶ to audition 30 s of the loudest section with the platform's gain applied — hear exactly what listeners will.
 </span>
 )}
 </p>
 </div>

 <div className="bg-dark-800/40 rounded-xl overflow-hidden">
 <div className="flex items-center text-[10px] text-dark-500 px-3 py-2 border-b border-dark-700/30">
 <span className="flex-1">Platform</span>
 <span className="w-16 text-right">Target</span>
 <span className={`${twoCol ? 'w-48' : 'w-48'} text-right`}>{labelA}</span>
 {twoCol && <span className="w-48 text-right">{labelB}</span>}
 </div>
 {previewA.map((rowA, i) => {
 const rowB = twoCol ? previewB[i] : null
 return (
 <div key={rowA.name} className="flex items-center px-3 py-2 text-[11px] border-b border-dark-700/20 last:border-0">
 <span className="flex-1 text-dark-200 font-medium">{rowA.name}</span>
 <span className="w-16 text-right font-mono text-[10px] text-dark-500">{rowA.target_lufs.toFixed(0)} LUFS</span>
 <div className="w-48 text-right">
 <PlatformCell
 row={rowA}
 file={fileA}
 side="a"
 audition={audition}
 twin={twin}
 integratedLufs={lufsA ?? null}
 twinStartSec={twinStartSec}
 />
 </div>
 {twoCol && rowB && (
 <div className="w-48 text-right">
 <PlatformCell
 row={rowB}
 file={fileB}
 side="b"
 audition={audition}
 twin={twin}
 integratedLufs={lufsB ?? null}
 twinStartSec={twinStartSec}
 />
 </div>
 )}
 </div>
 )
 })}
 </div>

 {/* ── Translation Check — playback-environment audition ─────────
 Sister surface to the Sound Check twin (≋) buttons in the
 streaming-preview rows above. Where Sound Check answers
 "what does each DSP serve?", Translation Check answers
 "what does the MIX sound like through these speakers?".
 Each button renders a 30 s window through a biquad filter
 chain modelling phone / earbuds / club PA / car cabin. */}
 {fileB && !soloA && (
 <TranslationCheckPanel file={fileB} />
 )}

 {/* ── Streaming Delta Heatmap strip ────────────────────────────
 Stacks one row per DSP the user has auditioned via the ≋
 twin button. Red bars = DSP's limiter engaged on that block
 of the preview; quiet = limiter idle. Unique to RTM — no
 other tool shows you *where* the DSP's processing fires. */}
 {(() => {
 // Single-row heatmap: only show the most recently played DSP.
 // Beta-tester report: stacking one row per platform got noisy
 // ("no need to keep all of them open; if I play a different
 // platform close the previous one"). The cached info for every
 // played DSP still lives in twin.allInfo(); we just filter the
 // render to the latest one.
 const lastKey = twin.lastPlayedKey
 if (!lastKey) return null
 const info = twin.infoFor(lastKey)
 if (!info || !(info.gr_envelope_db || []).length) return null
 return (
 <div className="space-y-2 pt-1">
 <div className="flex items-center gap-2">
 <span className="text-[10px] uppercase tracking-[0.15em]" style={{ color: '#d0b066' }}>
 Streaming delta heatmap
 </span>
 <span className="text-[10px]" style={{ color: '#7a7164' }}>
 where the DSP's limiter engaged on the 30-second preview
 </span>
 </div>
 <StreamingDeltaHeatmap
 key={lastKey}
 dsp={info.dspName || lastKey}
 envelope={info.gr_envelope_db || []}
 stepMs={info.gr_envelope_step_ms || 100}
 windowSec={info.window_duration_sec || 30}
 worstGrDb={info.worst_gr_db ?? 0}
 />
 </div>
 )
 })()}

 <p className="text-[10px] text-dark-500 italic">
 Target values per each platform's loudness-normalisation spec (current as of 2026). <TeachTerm term="interSample">TP breach</TeachTerm> flags indicate the platform's <TeachTerm term="tpLimiter">limiter</TeachTerm> will engage after gain adjustment.
 </p>
 </div>
 )
}

function PlatformCell({ row, file, side, audition, twin, integratedLufs, twinStartSec }: {
 row: Row
 file?: FileInfo
 side: 'a' | 'b'
 audition: AuditionHook
 twin: TwinHook
 integratedLufs: number | null
 twinStartSec: number | null
}) {
 const actionColor =
 row.action === 'attenuated' ? '#d0b066' :
 row.action === 'boosted' ? '#8a95ab' :
 '#6fa37e'
 const key: AuditionKey = `${row.name}::${side}`
 const twinKey: AuditionKey = `twin::${row.name}::${side}`
 const dspId = row.dsp || DSP_ID_BY_NAME[row.name] || row.name.toLowerCase()

 const isPlaying = audition.playingKey === key
 const isLoading = audition.loadingKey === key
 const isTwinPlaying = twin.playingKey === twinKey
 const isTwinLoading = twin.loadingKey === twinKey
 const canPlay = !!file

 const onToggle = useCallback(() => {
 if (!file) return
 if (isPlaying) audition.stop()
 else { twin.stop(); audition.play(key, file, row.delta_db) }
 }, [file, isPlaying, key, audition, twin, row.delta_db])

 const onTwinToggle = useCallback(() => {
 if (!file) return
 if (isTwinPlaying) twin.stop()
 else { audition.stop(); twin.play(twinKey, file, dspId, integratedLufs, twinStartSec) }
 }, [file, isTwinPlaying, twinKey, twin, audition, dspId, integratedLufs, twinStartSec])

 const twinInfo = twin.infoFor(twinKey)
 const twinError = twin.errorFor(twinKey)

 return (
 <div className="flex items-center justify-end gap-2">
 {canPlay && (
 <button
 onClick={onToggle}
 disabled={isLoading}
 className="w-5 h-5 rounded-full flex items-center justify-center transition-all hover:scale-110 disabled:opacity-50"
 style={{
 backgroundColor: isPlaying ? 'rgba(208,176,102,0.25)' : 'rgba(208,176,102,0.08)',
 border: `1px solid ${isPlaying ? 'rgba(208,176,102,0.6)' : 'rgba(208,176,102,0.25)'}`,
 }}
 aria-label={isPlaying ? `Stop audition of ${row.name}` : `Audition ${row.name} playback`}
 title={isPlaying
 ? 'Stop'
 : `Play 30 s at ${row.delta_db > 0 ? '+' : ''}${row.delta_db.toFixed(1)} dB (gain-only preview of ${row.name}'s normalisation)`}
 >
 {isLoading ? (
 <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: '#d0b066' }} />
 ) : isPlaying ? (
 <svg className="w-2.5 h-2.5" fill="#d0b066" viewBox="0 0 12 12"><rect x="2" y="2" width="3" height="8" /><rect x="7" y="2" width="3" height="8" /></svg>
 ) : (
 <svg className="w-2.5 h-2.5" fill="#d0b066" viewBox="0 0 12 12"><path d="M3 2 L10 6 L3 10 Z" /></svg>
 )}
 </button>
 )}
 {/* Sound Check twin — runs the DSP's real ingest chain (gain → 4×
 TP limiter → AAC 256 k codec) and plays the result. The edge
 over the gain-only button: you hear codec artefacts + limiter
 pumping baked in, not clean PCM. Nobody else ships this. */}
 {canPlay && (
 <button
 onClick={onTwinToggle}
 disabled={isTwinLoading}
 className="w-5 h-5 rounded flex items-center justify-center transition-all hover:scale-110 disabled:opacity-50"
 style={{
 backgroundColor: isTwinPlaying ? 'rgba(124,164,163,0.3)' : 'rgba(124,164,163,0.08)',
 border: `1px solid ${isTwinPlaying ? 'rgba(124,164,163,0.6)' : 'rgba(124,164,163,0.3)'}`,
 }}
 aria-label={isTwinPlaying ? `Stop ${row.name} twin` : `Play ${row.name} Sound-Check twin`}
 title={isTwinLoading
 ? 'Rendering Sound Check twin…'
 : isTwinPlaying
 ? 'Stop'
 : `Play 30 s through ${row.name}'s real chain (gain + TP limiter + AAC codec). Hear exactly what listeners get.${twinInfo?.post_limiter_peak_db != null ? ` · Limiter peak ${twinInfo.post_limiter_peak_db.toFixed(1)} dB` : ''}`}
 >
 {isTwinLoading ? (
 <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: '#7ca4a3' }} />
 ) : (
 <span className="text-[7px] font-bold tracking-tighter" style={{ color: '#7ca4a3' }}>
 {isTwinPlaying ? '■' : '≋'}
 </span>
 )}
 </button>
 )}
 <span className="font-mono text-dark-200">{row.played_lufs.toFixed(1)} LUFS</span>
 {row.delta_db !== 0 && (
 <span className="font-mono text-[10px]" style={{ color: actionColor }}>
 {row.delta_db > 0 ? '+' : ''}{row.delta_db.toFixed(1)} dB
 </span>
 )}
 {/* tp_breach badge removed in 5.3.0 — no warnings, just numbers. */}
 {/* Surface twin-render errors inline so the green ≋ button never
 fails silently. Previous behaviour (console.error only) had
 testers reporting "the render button just stops the audio".
 We keep the message short and route the full error to the
 hover title so the row layout stays compact. */}
 {twinError && !isTwinPlaying && !isTwinLoading && (
 <span
 className="text-[9px] px-1.5 py-0.5 rounded font-mono cursor-help"
 style={{ color: '#c96765', backgroundColor: 'rgba(201,103,101,0.15)' }}
 title={`Sound Check twin render failed: ${twinError}`}
 >
 render ✕
 </span>
 )}
 </div>
 )
}

/* ─── Audition hook ───────────────────────────────────────────────────────
 Caches decoded AudioBuffers + loudest-window offset per file path so
 repeated previews across platforms reuse work.
*/

interface AuditionHook {
 playingKey: AuditionKey | null
 loadingKey: AuditionKey | null
 play: (key: AuditionKey, file: FileInfo, gainDb: number) => Promise<void>
 stop: () => void
}

function useAudition(): AuditionHook {
 const [playingKey, setPlayingKey] = useState<AuditionKey | null>(null)
 const [loadingKey, setLoadingKey] = useState<AuditionKey | null>(null)
 const ctxRef = useRef<AudioContext | null>(null)
 const sourceRef = useRef<AudioBufferSourceNode | null>(null)
 const bufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map())
 const loudestCacheRef = useRef<Map<string, number>>(new Map())
 // Guard against rapid click races during async decode.
 const startingRef = useRef<AuditionKey | null>(null)

 const stop = useCallback(() => {
 startingRef.current = null
 try { sourceRef.current?.stop() } catch {}
 if (sourceRef.current) sourceRef.current.onended = null
 sourceRef.current = null
 try { ctxRef.current?.close() } catch {}
 ctxRef.current = null
 setPlayingKey(null)
 setLoadingKey(null)
 }, [])

 // Stop playback when the panel unmounts to avoid orphan AudioContexts.
 useEffect(() => () => { stop() }, [stop])

 const play = useCallback(async (key: AuditionKey, file: FileInfo, gainDb: number) => {
 if (!window.electronAPI) return
 // Kill any previous audition (including a loading one) before starting.
 stop()
 setLoadingKey(key)
 startingRef.current = key

 try {
 // 1. Decode or reuse cached buffer.
 let buffer = bufferCacheRef.current.get(file.path)
 if (!buffer) {
 const ab = await window.electronAPI.readAudioFile(file.path)
 if (startingRef.current !== key) return
 const probe = new (window.AudioContext || (window as any).webkitAudioContext)()
 buffer = await probe.decodeAudioData(ab)
 await probe.close()
 bufferCacheRef.current.set(file.path, buffer)
 }
 if (startingRef.current !== key) return

 // 2. Find (or reuse) the loudest 30 s window.
 let startOffset = loudestCacheRef.current.get(file.path)
 if (startOffset == null) {
 startOffset = findLoudestWindow(buffer, 30)
 loudestCacheRef.current.set(file.path, startOffset)
 }

 // 3. Build a fresh AudioContext at the file's native sample rate so
 // there's no resampling artefact when comparing platforms.
 let ctx: AudioContext
 try { ctx = new AudioContext({ sampleRate: buffer.sampleRate, latencyHint: 'playback' }) }
 catch { ctx = new AudioContext({ latencyHint: 'playback' }) }
 ctxRef.current = ctx

 const source = ctx.createBufferSource()
 source.buffer = buffer
 const gainNode = ctx.createGain()
 // dB → linear: 10^(dB/20). Clamp to a sane range so an extreme
 // delta never blasts the listener.
 const linear = Math.max(0.05, Math.min(4, Math.pow(10, gainDb / 20)))
 gainNode.gain.value = linear
 source.connect(gainNode)
 gainNode.connect(ctx.destination)

 sourceRef.current = source
 const clipLen = Math.min(30, Math.max(5, buffer.duration - startOffset))
 source.start(0, startOffset, clipLen)
 setLoadingKey(null)
 setPlayingKey(key)
 source.onended = () => {
 if (sourceRef.current === source) {
 setPlayingKey(null)
 try { ctx.close() } catch {}
 ctxRef.current = null
 sourceRef.current = null
 }
 }
 } catch (err) {
 // Surface so a tester (or me) can pull the actual reason
 // out of console — silent catches turned into the v4.1
 // "stuck on Preparing audio" mystery, never again.
 console.error('[streaming-preview] play failed:', err)
 setLoadingKey(null)
 setPlayingKey(null)
 startingRef.current = null
 try { ctxRef.current?.close() } catch {}
 ctxRef.current = null
 }
 }, [stop])

 return { playingKey, loadingKey, play, stop }
}

/* ─── Sound Check twin hook ──────────────────────────────────────────────
 The real edge over every other "streaming preview" on the market:
 renders a 30-second audition through the DSP's *actual* ingest chain
 (normalisation gain → 4× oversampled TP limiter → AAC 256 k codec) and
 plays the result. Ozone / Reference 4 / LEVELS / Pro-Q all stop at
 "your master at −5 dB." This tool plays the codec output.

 Architecture:
 - Python encoded_preview.py renders m4a to a temp cache keyed by
 (srcPath, mtime, dsp, lufs). Second play of the same pair is
 cache-hot + instant.
 - Renderer fetches the m4a via readAudioFile, decodes into the same
 AudioContext pattern useAudition uses. Mutually exclusive with
 the gain-only audition button.
*/

interface TwinInfo {
 post_limiter_peak_db?: number
 gain_db?: number
 cached?: boolean
 /** Per-block gain-reduction envelope from the DSP's limiter. Feeds
 * the Streaming Delta Heatmap — see StreamingDeltaHeatmap.tsx. */
 gr_envelope_db?: number[]
 gr_envelope_step_ms?: number
 worst_gr_db?: number
 window_duration_sec?: number
 /** DSP display name cached so the heatmap row label is correct even
 * when the panel re-renders. */
 dspName?: string
}
interface TwinHook {
 playingKey: AuditionKey | null
 loadingKey: AuditionKey | null
 /** Most recently played twin key. Persists across stop so the
 * Streaming Delta Heatmap can show the last-played DSP after the
 * user has stopped playback — but switches when they play a
 * different platform. Beta-tester ask: "no need to keep all open;
 * if I play a different platform, close the previous one." */
 lastPlayedKey: AuditionKey | null
 play: (key: AuditionKey, file: FileInfo, dsp: string, integratedLufs: number | null, windowStartSec?: number | null) => Promise<void>
 stop: () => void
 infoFor: (key: AuditionKey) => TwinInfo | null
 /** All cached twin renders, keyed by audition key. Used by hooks
 * that want the full set; the panel filters to `lastPlayedKey`
 * for the heatmap so only the most recent DSP shows. */
 allInfo: () => { key: AuditionKey; info: TwinInfo }[]
 /** Last render error for the given key, or null if none. Surfaces
 * inline in the platform row so a failed twin render is never
 * silent (previous behaviour: error went to console only and the
 * audio just stopped — testers reported the green render button
 * "just stops the audio"). */
 errorFor: (key: AuditionKey) => string | null
}

function useSoundCheckTwin(cacheBustToken: number = 0): TwinHook {
 const [playingKey, setPlayingKey] = useState<AuditionKey | null>(null)
 const [loadingKey, setLoadingKey] = useState<AuditionKey | null>(null)
 const [lastPlayedKey, setLastPlayedKey] = useState<AuditionKey | null>(null)
 const ctxRef = useRef<AudioContext | null>(null)
 const sourceRef = useRef<AudioBufferSourceNode | null>(null)
 const bufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map())
 const infoCacheRef = useRef<Map<string, TwinInfo>>(new Map())
 const errorCacheRef = useRef<Map<string, string>>(new Map())
 const startingRef = useRef<AuditionKey | null>(null)

 // When the caller's cacheBustToken changes (e.g. EQ bank was re-
 // proposed in EQContext), clear the twin cache so the next play
 // renders through the new EQ state. Without this, the gold ≋
 // button serves a stale AAC made from pre-EQ audio. "
 const lastTokenRef = useRef<number>(cacheBustToken)
 useEffect(() => {
 if (cacheBustToken !== lastTokenRef.current) {
 bufferCacheRef.current.clear()
 infoCacheRef.current.clear()
 lastTokenRef.current = cacheBustToken
 }
 }, [cacheBustToken])

 const stop = useCallback(() => {
 startingRef.current = null
 try { sourceRef.current?.stop() } catch {}
 if (sourceRef.current) sourceRef.current.onended = null
 sourceRef.current = null
 try { ctxRef.current?.close() } catch {}
 ctxRef.current = null
 setPlayingKey(null)
 setLoadingKey(null)
 }, [])

 useEffect(() => () => { stop() }, [stop])

 const infoFor = useCallback((key: AuditionKey) => infoCacheRef.current.get(key) || null, [])

 const play = useCallback(async (key: AuditionKey, file: FileInfo, dsp: string, integratedLufs: number | null, windowStartSec?: number | null) => {
 if (!window.electronAPI?.encodedPreviewRender || !window.electronAPI.readAudioFile) {
 setLoadingKey(null)
 return
 }
 stop()
 setLoadingKey(key)
 // Clear any prior error for this key so the inline message doesn't
 // stick around once the user retries.
 errorCacheRef.current.delete(key)
 startingRef.current = key

 try {
 // Cache by (path + dsp + lufs + startSec) — buffer cache key
 // mirrors main-process cache key so repeated plays of the same
 // twin reuse both.
 const cacheKey = `${file.path}|${dsp}|${integratedLufs ?? ''}|${windowStartSec ?? ''}`
 let buffer = bufferCacheRef.current.get(cacheKey)
 if (!buffer) {
 const res = await window.electronAPI.encodedPreviewRender(file.path, dsp, integratedLufs, windowStartSec)
 if (startingRef.current !== key) return
 if (!res.ok || !res.path) {
 const errMsg = res.error || 'render failed (no error message)'
 console.error('Sound Check twin render failed:', errMsg)
 // Cache the error so the panel can show it inline next to
 // the failed platform row instead of silently doing nothing.
 errorCacheRef.current.set(key, errMsg)
 setLoadingKey(null)
 startingRef.current = null
 return
 }
 infoCacheRef.current.set(key, {
 post_limiter_peak_db: res.post_limiter_peak_db,
 gain_db: res.gain_db,
 cached: res.cached,
 gr_envelope_db: res.gr_envelope_db,
 gr_envelope_step_ms: res.gr_envelope_step_ms,
 worst_gr_db: res.worst_gr_db,
 window_duration_sec: res.window_duration_sec,
 dspName: dsp,
 })
 const ab = await window.electronAPI.readAudioFile(res.path)
 if (startingRef.current !== key) return
 const probe = new (window.AudioContext || (window as any).webkitAudioContext)()
 buffer = await probe.decodeAudioData(ab)
 await probe.close()
 bufferCacheRef.current.set(cacheKey, buffer)
 }
 if (startingRef.current !== key) return

 let ctx: AudioContext
 try { ctx = new AudioContext({ sampleRate: buffer.sampleRate, latencyHint: 'playback' }) }
 catch { ctx = new AudioContext({ latencyHint: 'playback' }) }
 ctxRef.current = ctx

 const source = ctx.createBufferSource()
 source.buffer = buffer
 source.connect(ctx.destination)
 sourceRef.current = source
 source.start(0, 0, Math.min(30, buffer.duration))
 setLoadingKey(null)
 setPlayingKey(key)
 source.onended = () => {
 if (sourceRef.current === source) {
 setPlayingKey(null)
 try { ctx.close() } catch {}
 ctxRef.current = null
 sourceRef.current = null
 }
 }
 } catch (err: any) {
 const msg = err?.message || String(err) || 'play failed'
 console.error('Sound Check twin play failed:', msg)
 errorCacheRef.current.set(key, msg)
 setLoadingKey(null)
 setPlayingKey(null)
 startingRef.current = null
 try { ctxRef.current?.close() } catch {}
 ctxRef.current = null
 }
 }, [stop])

 // Re-rendering tick so the panel updates when a new twin landed.
 // Without this, infoCacheRef mutations wouldn't trigger React's diff
 // because refs don't participate in the reactive graph.
 const [, setTick] = useState(0)
 const allInfo = useCallback((): { key: AuditionKey; info: TwinInfo }[] => {
 return Array.from(infoCacheRef.current.entries()).map(([key, info]) => ({ key, info }))
 }, [])
 // Expose the tick setter through the play path so consumers see new
 // entries immediately.
 const _origPlay = play
 const playWithTick = useCallback(async (key: AuditionKey, file: FileInfo, dsp: string, integratedLufs: number | null, windowStartSec?: number | null) => {
 // Mark this key as the latest-played BEFORE the render kicks off
 // so the heatmap immediately switches to the new DSP — even
 // before the render completes — instead of leaving the previous
 // platform's heatmap visible during the load.
 setLastPlayedKey(key)
 const r = await _origPlay(key, file, dsp, integratedLufs, windowStartSec)
 setTick(t => t + 1)
 return r
 }, [_origPlay])
 const errorFor = useCallback((key: AuditionKey) => errorCacheRef.current.get(key) || null, [])
 return { playingKey, loadingKey, lastPlayedKey, play: playWithTick, stop, infoFor, allInfo, errorFor }
}

/**
 * Find the start offset (seconds) of the highest-energy `windowSec` window
 * in the buffer using 1 s RMS stepping. Centred on the peak 1 s frame so
 * the clip lands squarely on the loudest passage.
 */
function findLoudestWindow(buffer: AudioBuffer, windowSec: number): number {
 const sr = buffer.sampleRate
 const duration = buffer.duration
 if (duration <= windowSec) return 0

 // Use channel 0 as a proxy — for stereo mixes it's close enough to the
 // overall energy profile for the purpose of picking a preview window.
 const data = buffer.getChannelData(0)
 const frameLen = sr // 1 s frames
 const frameCount = Math.floor(data.length / frameLen)
 if (frameCount < 2) return Math.max(0, (duration - windowSec) / 2)

 // Compute 1 s RMS for each frame (cheap).
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

 // Find peak 1 s RMS, centre a windowSec-long clip around it.
 let peakIdx = 0
 let peakVal = 0
 for (let f = 0; f < frameCount; f++) {
 if (rms[f] > peakVal) { peakVal = rms[f]; peakIdx = f }
 }
 const peakTime = peakIdx // seconds
 let start = peakTime - windowSec / 2
 start = Math.max(0, Math.min(duration - windowSec, start))
 return start
}
