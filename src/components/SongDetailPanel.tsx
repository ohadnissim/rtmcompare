import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { BatchResult, AnalysisResult, FileInfo } from '../types'
import { formatDuration } from './DurationPill'
import StreamingPreview from './StreamingPreview'
import ClickTimeline from './ClickTimeline'
import DistortionPanel from './DistortionPanel'
import HumPanel from './HumPanel'
import MonoCompat from './MonoCompat'
import PhaseCorrelation from './PhaseCorrelation'
import PhaseBandsPanel from './PhaseBandsPanel'
import Vectorscope from './Vectorscope'
import CollapsibleSection from './CollapsibleSection'
import ABPlayer from './ABPlayer'
import LoudnessOverTime from './LoudnessOverTime'
import ReadyToDeliverVerdict from './ReadyToDeliverVerdict'
import AttentionList from './AttentionList'
import {
 metricsFromBatch, metricsFromFull,
 buildVerdict, buildAttentionItems,
 formatMetadataStrip,
} from '../singleFileHelpers'
import { DSP_PROFILES, evaluateAgainstProfile } from '../dspProfiles'

interface Props {
 song: BatchResult
 displayName: string
 /** Shared audio state driven by BatchView. */
 playingPath: string | null
 progress: { current: number; duration: number }
 onPlayToggle: () => void
 onSeek: (t: number) => void
 /** Start playback of this song at `sec` — used by click-timeline jumps
 * when the song isn't currently loaded in the shared transport. */
 onPlayAt: (sec: number) => void
 /** Per-song free-form note. Persisted in the album session and rendered
 * in the PDF export. BatchView owns the state so the note survives
 * tab close/reopen. */
 note: string
 onNoteChange: (value: string) => void
 /** Optional reporter so BatchView can surface per-song deep-analysis
 * progress on the table row + tab strip. Emitted on start / progress /
 * completion. BatchView owns the state so it persists across tab
 * close/reopen. */
 onAnalysisChange?: (state: { state: 'running' | 'done' | 'error'; startedAt?: number; message?: string }) => void
 /** Previous / next song navigation — rendered as arrows next to the
 * song title and bound to ← / → keys. Omitted for single-row contexts.
 * Disabled state (no wrap-around) is expressed by passing undefined. */
 onPrev?: () => void
 onNext?: () => void
 /** 1-based position in the current album sort order + total tracks —
 * surfaced as "3 of 12" so the user knows where they are without
 * counting rows in the overview. */
 indexInList?: number
 totalInList?: number
 /** Siblings for the "compare against" reference picker. Now grouped
 * so the dropdown can render with optgroups — favorites pinned on
 * top, then session uploads, then the cohort reference, then the
 * rest of the album. `spectrum` is optional (only refs with 31-band
 * data contribute to the Tonal Balance overlay; A/B playback works
 * regardless). */
 compareTargets?: {
 /** Auto-detected revision siblings — same track, different version
 * suffix (`_v2`, `_REV3`, `_FINAL`). Pinned just under Favorites
 * because engineers reach for "previous rev" constantly during a
 * mastering pass. */
 revisions?: { path: string; label: string; spectrum?: number[] }[]
 favorites?: { path: string; label: string; spectrum?: number[] }[]
 session?: { path: string; label: string; spectrum?: number[] }[]
 cohort?: { path: string; label: string; spectrum?: number[] } | null
 album?: { path: string; label: string; spectrum?: number[] }[]
 }
 /** "+ Load reference…" handler. When provided, SongDetailPanel shows
 * an Upload button next to the dropdown so the user can pull in a
 * file from their library mid-session. */
 onAddReference?: () => void | Promise<void>
 uploadingReference?: boolean
 /** Inline error message if the last add-reference attempt failed —
 * rendered next to the "+ Load" button so the user gets feedback
 * instead of a silent swallow. */
 addReferenceError?: string | null
 onClearAddReferenceError?: () => void
 /** Star toggle for the currently-selected reference. When both are
 * provided SongDetailPanel renders a star button next to the
 * dropdown and calls `onToggleFavorite` on click. */
 isReferenceFavorited?: boolean
 onToggleFavorite?: () => void
 /** Currently-picked reference path + setter — owned by BatchView so
 * the A/B reference locks across song rotations (user ask: "B is
 * changing according to the song I'm viewing"). */
 compareTargetPath?: string | null
 onCompareTargetChange?: (path: string | null) => void
 /** Called when A/B mode engages so BatchView can stop its shared
 * <audio> playback — avoids two simultaneous transports fighting
 * each other when the user flips into A/B. */
 onExternalStop?: () => void
 onClose: () => void
}

/**
 * Expanded per-song panel — the full single-file analysis suite rendered
 * inside album-batch mode. Lazy-loads the deep analysis (clicks, hum,
 * distortion, phase bands, vectorscope, BPM / key / harmonics, streaming
 * preview) via the same IPC ref-only mode already uses, so we reuse one
 * backend pipeline and don't maintain two.
 *
 * Layout order was set by the single-file expert panel:
 * 1. Ready-to-Deliver verdict (GM / Ops ask)
 * 2. Attention list (promoted above transport — Ops ask)
 * 3. Transport
 * 4. Compact metadata strip (SR · BD · ch · ISRC)
 * 5. Stat grid (LUFS / TP / LRA / length / mono)
 * 6. Streaming Normalization Preview (9 of 10 voted)
 * 7. Tonal balance curve + stereo-over-time
 * 8. Clicks / glitches timeline (7 of 10 voted, click→transport)
 * 9. Hum / distortion / phase / vectorscope
 * 10. Key · BPM · harmonics (Hip-Hop + user explicit "I love it")
 */
export default function SongDetailPanel({
 song, displayName, playingPath, progress, onPlayToggle, onSeek, onPlayAt, note, onNoteChange, onAnalysisChange, onPrev, onNext, indexInList, totalInList, compareTargets, compareTargetPath: compareTargetPathProp, onCompareTargetChange, onAddReference, uploadingReference, addReferenceError, onClearAddReferenceError, isReferenceFavorited, onToggleFavorite, onExternalStop, onClose,
}: Props) {
 const [full, setFull] = useState<AnalysisResult | null>(null)
 const [loading, setLoading] = useState(false)
 const [error, setError] = useState<string | null>(null)
 // Elapsed-time driven progress %. Backend doesn't emit a numeric
 // progress for analyzeFiles, so we estimate — typical single-song
 // deep-analysis lands in ~15–25 s. Capped at 95 so 100 % only shows at
 // actual completion. 1 Hz tick via state so the bar animates.
 const [analysisStartedAt, setAnalysisStartedAt] = useState<number | null>(null)
 const [analysisMsg, setAnalysisMsg] = useState<string>('Queued…')
 const [tick, setTick] = useState(0)
 useEffect(() => {
 if (!loading) return
 const id = setInterval(() => setTick(t => t + 1), 1000)
 return () => clearInterval(id)
 }, [loading])
 const expectedSec = 20
 const elapsedSec = analysisStartedAt ? Math.round((Date.now() - analysisStartedAt) / 1000) : 0
 const progressPct = loading ? Math.min(95, Math.round((elapsedSec / expectedSec) * 100)) : 100
 // `tick` is read here so React re-renders every second while loading.
 void tick

 // Lazy-load the deep single-file analysis when the panel mounts (i.e.
 // when the user opens this song's tab). Cached by path on the window
 // so re-opening is instant within a session.
 // On mount (or song-path change): hydrate `full` from the shared
 // cache if we've already analysed this song. We do NOT kick off an
 // analysis automatically anymore — users asked for an explicit
 // button to control when the expensive deep pass runs. Instead, we
 // render a "Run deep analysis" CTA where the progress bar used to
 // live; the user clicks it when they want the full panel suite.
 useEffect(() => {
 const cache: Map<string, AnalysisResult> = (window as any).__rtmSongCache ||= new Map()
 if (cache.has(song.path)) {
 setFull(cache.get(song.path)!)
 onAnalysisChange?.({ state: 'done' })
 } else {
 setFull(null) // fresh tab or cache miss — wait for the user
 }
 // Clean stale-panel state when the song changes.
 setError(null)
 setLoading(false)
 setAnalysisStartedAt(null)
 setAnalysisMsg('')
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [song.path])

 // Explicit user trigger — called by the "Run deep analysis" button.
 // Safe to call multiple times: if already loading or already cached,
 // it short-circuits.
 const runDeepAnalysis = useCallback(async () => {
 if (loading) return
 if (!window.electronAPI?.analyzeFiles) return
 const cache: Map<string, AnalysisResult> = (window as any).__rtmSongCache ||= new Map()
 if (cache.has(song.path)) {
 setFull(cache.get(song.path)!)
 onAnalysisChange?.({ state: 'done' })
 return
 }
 setLoading(true)
 setError(null)
 const startedAt = Date.now()
 setAnalysisStartedAt(startedAt)
 setAnalysisMsg('Starting deep analysis…')
 onAnalysisChange?.({ state: 'running', startedAt, message: 'Starting deep analysis…' })
 // Progress stream — phase messages ("Detecting clicks", etc).
 // onProgress returns an unsubscribe function; without calling it, every
 // deep-analysis run from a SongDetailPanel would leave a dead listener
 // on ipcRenderer, stacking up as the user clicks through songs.
 let cancelled = false
 let unsubProgress: (() => void) | void = undefined
 if (window.electronAPI?.onProgress) {
 try {
 unsubProgress = window.electronAPI.onProgress((msg: string) => {
 if (cancelled) return
 setAnalysisMsg(msg)
 onAnalysisChange?.({ state: 'running', startedAt, message: msg })
 }) || undefined
 } catch {}
 }
 try {
 const result = await window.electronAPI.analyzeFiles(song.path, song.path, true, 'ohad')
 // Cache + report regardless of mount state so re-opening is instant.
 cache.set(song.path, result)
 onAnalysisChange?.({ state: 'done' })
 setFull(result)
 } catch (err: any) {
 onAnalysisChange?.({ state: 'error', message: err?.message })
 setError(err?.message || 'Deep analysis failed')
 } finally {
 cancelled = true
 try { unsubProgress?.() } catch {}
 setLoading(false)
 }
 // onAnalysisChange intentionally omitted — parent closure churns.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [song.path, loading])

 // ClickTimeline dispatches `rtm-seek` CustomEvent when a row is clicked.
 // ABPlayer already handles this in A/B compare mode; in batch mode the
 // shared transport lives in BatchView, so we catch the event here and
 // forward it. ClickTimeline offsets the event by 1.5 s before the hit to
 // give the ear a run-up. Two paths:
 // • song already playing → just seek
 // • song not loaded → playAt(time) so BatchView loads + seeks atomically
 useEffect(() => {
 const handler = (e: Event) => {
 const detail = (e as CustomEvent).detail
 if (!detail || typeof detail.time !== 'number') return
 if (playingPath === song.path) onSeek(detail.time)
 else onPlayAt(detail.time)
 }
 window.addEventListener('rtm-seek', handler)
 return () => window.removeEventListener('rtm-seek', handler)
 }, [onSeek, onPlayAt, playingPath, song.path])


 // Arrow-key song-nav handler is defined further down (after the
 // compareTarget derivation) — it needs to know whether the ABPlayer
 // is mounted before deciding whether to swallow plain ←/→.

 // Selected "compare against" reference — drives both the Tonal Balance
 // overlay AND the full A/B player. State can live in the parent (so
 // the pick persists across song rotations — user ask: "B is changing
 // according to the song I'm viewing") or locally if the parent didn't
 // wire it up. Either way, consumers see a single `compareTargetPath`
 // value and a `setCompareTargetPath` setter.
 const [localCompareTargetPath, setLocalCompareTargetPath] = useState<string | null>(null)
 const parentControlsCompare = compareTargetPathProp !== undefined && !!onCompareTargetChange
 const compareTargetPath = parentControlsCompare ? (compareTargetPathProp ?? null) : localCompareTargetPath
 const setCompareTargetPath = useCallback((v: string | null) => {
 if (parentControlsCompare) onCompareTargetChange!(v)
 else setLocalCompareTargetPath(v)
 }, [parentControlsCompare, onCompareTargetChange])
 // Flatten the grouped compareTargets so the dropdown's selected path
 // can be resolved in one place. Filter out the current song (can't
 // compare to itself) — harmless if BatchView already did it.
 const flatCompareTargets = useMemo(() => {
 const g = compareTargets || {}
 const out: { path: string; label: string; spectrum?: number[] }[] = []
 const push = (x: { path: string; label: string; spectrum?: number[] }) => {
 if (x.path === song.path) return
 if (out.some(o => o.path === x.path)) return
 out.push(x)
 }
 ;(g.revisions || []).forEach(push)
 ;(g.favorites || []).forEach(push)
 ;(g.session || []).forEach(push)
 if (g.cohort) push(g.cohort)
 ;(g.album || []).forEach(push)
 return out
 }, [compareTargets, song.path])
 const hasAnyTargets = flatCompareTargets.length > 0 || !!onAddReference
 const compareTarget = flatCompareTargets.find(t => t.path === compareTargetPath) || null

 // Arrow-key song navigation.
 //
 // Edge cases that broke v0:
 // • <select> elements (e.g. the A/B reference dropdown) natively
 // capture ArrowLeft/ArrowRight — we must skip when focus is in
 // any form control, not just INPUT / TEXTAREA.
 // • When the A/B player is mounted (a reference is picked), ABPlayer
 // registers its own ArrowLeft/Right handler for scrub (±5 s).
 // Conflict → the user pressed ← and the song changed AND the scrub
 // fired. Resolution: when a reference is active, plain ←/→ scrubs
 // the ABPlayer; Shift+←/→ navigates songs. When no reference is
 // active (solo transport), plain ←/→ navigates songs as before.
 // • `capture: true` on the listener so we run BEFORE the ABPlayer
 // window-level handler and can preventDefault the scrub when the
 // user explicitly asked for song-nav (Shift held).
 useEffect(() => {
 const abPlayerActive = !!compareTarget
 const onKey = (e: KeyboardEvent) => {
 const t = e.target as HTMLElement | null
 const tag = t?.tagName
 if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return
 if (e.metaKey || e.ctrlKey || e.altKey) return
 const isPrev = e.key === 'ArrowLeft'
 const isNext = e.key === 'ArrowRight'
 if (!isPrev && !isNext) return
 const wantsSongNav = e.shiftKey || !abPlayerActive
 if (!wantsSongNav) return
 if (isPrev && onPrev) { e.preventDefault(); e.stopPropagation(); onPrev() }
 else if (isNext && onNext) { e.preventDefault(); e.stopPropagation(); onNext() }
 }
 window.addEventListener('keydown', onKey, { capture: true })
 return () => window.removeEventListener('keydown', onKey, { capture: true } as any)
 }, [onPrev, onNext, compareTarget])

 // If the user rotates B onto the same song that was picked as A,
 // auto-clear so we don't compare a song to itself.
 useEffect(() => {
 if (compareTargetPath === song.path) setCompareTargetPath(null)
 }, [compareTargetPath, song.path, setCompareTargetPath])

 // Stop BatchView's shared <audio> the moment A/B mode engages so the
 // user doesn't get two transports running at once. No-op in solo mode.
 useEffect(() => {
 if (compareTarget && onExternalStop) onExternalStop()
 }, [compareTarget, onExternalStop])

 const m = full ? metricsFromFull(full, metricsFromBatch(song)) : metricsFromBatch(song)

 // Triage Mode — opt-in overlay that brings back the Ready-to-Deliver
 // verdict + Attention list we removed earlier. Gated behind a user
 // preference so the default engineer surface stays clean. Persisted
 // in localStorage so QC / label-ops users flip it once and it stays.
 const [triageMode, setTriageMode] = useState<boolean>(() => {
 try { return localStorage.getItem('rtm-triage-mode') === '1' } catch { return false }
 })
 const toggleTriage = useCallback(() => {
 setTriageMode(v => {
 const next = !v
 try { localStorage.setItem('rtm-triage-mode', next ? '1' : '0') } catch {}
 return next
 })
 }, [])
 // DSP spec profile — when set, Triage Mode overlays per-platform
 // findings ("would fail Apple Digital Masters" etc.) onto the
 // Attention list. Persists per-user so once they pick "Apple" that
 // sticks across sessions.
 const [dspProfileId, setDspProfileId] = useState<string>(() => {
 try { return localStorage.getItem('rtm-dsp-profile') || '' } catch { return '' }
 })
 const setDspProfile = useCallback((id: string) => {
 setDspProfileId(id)
 try { localStorage.setItem('rtm-dsp-profile', id) } catch {}
 }, [])
 const verdict = useMemo(() => (triageMode ? buildVerdict(m, full) : null), [triageMode, m, full])
 const attention = useMemo(() => {
 if (!triageMode) return []
 const base = buildAttentionItems(m, full)
 const profile = dspProfileId ? DSP_PROFILES[dspProfileId] : null
 if (!profile) return base
 // Prepend DSP-profile findings so the active platform's rules
 // surface first. `buildAttentionItems` returns items with severity
 // + message; we map the DSP findings into the same shape.
 // Pass EVERY metric the profile evaluator can check — previously
 // we omitted lra / short_term_max / dialog_lufs which silently
 // bypassed Netflix's dialog-anchored LKFS + LRA <= 15 gates, letting
 // a dialog-heavy master show as PASS in the Attention list when it
 // would fail Netflix QC. Mirror the shape RefOnlyView already uses.
 const findings = evaluateAgainstProfile({
 lufs: m.lufs,
 true_peak: m.true_peak,
 sample_rate: m.sample_rate,
 bit_depth: m.bit_depth,
 isrc: m.isrc,
 lra: m.lra,
 short_term_max: m.short_term_max,
 dialog_lufs: m.dialog_lufs,
 }, profile)
 const dspItems = findings.map(f => ({
 severity: f.severity === 'block' ? 'hold' as const : f.severity === 'warn' ? 'warn' as const : 'info' as const,
 message: `[${profile.name}] ${f.message}`,
 }))
 return [...dspItems, ...base]
 }, [triageMode, m, full, dspProfileId])
 // Reuse the existing transport-jump helper for Attention-list rows.
 const jumpTo = useCallback((sec: number) => {
 if (playingPath === song.path) onSeek(sec)
 else onPlayAt(sec)
 }, [onSeek, onPlayAt, playingPath, song.path])
 const fileInfo: FileInfo = { path: song.path, name: song.filename }
 const isPlaying = playingPath === song.path
 const duration = isPlaying ? (progress.duration || song.duration_sec || 0) : (song.duration_sec || 0)
 const pos = isPlaying ? progress.current : 0
 const songInfo = (full?.reference_check?.song_info) as any

 return (
 <div
 className="rounded-xl p-5 space-y-5"
 style={{ backgroundColor: 'rgba(30,28,24,0.55)', border: '1px solid rgba(208,176,102,0.2)' }}
 >
 {/* Song header: prev / name / next arrows + close. The arrows match
 the ← / → keyboard shortcuts bound above; disabled look when at
 the edges of the song list. */}
 <div className="flex items-start justify-between gap-4 flex-wrap">
 <div className="min-w-0 flex-1">
 <div className="text-[10px] tracking-[0.2em] uppercase mb-1" style={{ color: '#d0b066' }}>
 Song detail
 </div>
 <div className="flex items-center gap-2">
 <button
 onClick={onPrev}
 disabled={!onPrev}
 className="w-7 h-7 rounded-full flex items-center justify-center transition-colors flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/[0.04]"
 style={{ border: '1px solid rgba(168,161,150,0.2)', color: '#a8a29e' }}
 title="Previous song (←)"
 aria-label="Previous song"
 >
 <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
 </svg>
 </button>
 <h3 className="text-xl flex-1 min-w-0 truncate" style={{ color: '#ebe7e0', fontFamily: "'Playfair Display', Georgia, serif", fontWeight: 400 }} title={displayName}>
 {displayName}
 </h3>
 {/* Position in the current album sort order. Shown after the
 title so users never have to count rows in the overview to
 know where they are. Hidden when context isn't known. */}
 {indexInList != null && totalInList != null && totalInList > 0 && (
 <span
 className="text-[10px] font-mono tabular-nums flex-shrink-0"
 style={{ color: '#7a7164' }}
 title={`Track ${indexInList} of ${totalInList} in the current sort order`}
 >
 {indexInList} / {totalInList}
 </span>
 )}
 <button
 onClick={onNext}
 disabled={!onNext}
 className="w-7 h-7 rounded-full flex items-center justify-center transition-colors flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/[0.04]"
 style={{ border: '1px solid rgba(168,161,150,0.2)', color: '#a8a29e' }}
 title="Next song (→)"
 aria-label="Next song"
 >
 <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
 </svg>
 </button>
 </div>
 <div className="text-[11px] mt-1 truncate" style={{ color: '#7a7164' }}>
 {song.artist && <span style={{ color: '#a8a29e' }}>{song.artist}</span>}
 {song.artist && song.album && <span> · </span>}
 {song.album && <>{song.album}</>}
 {(song.artist || song.album) && <span> · </span>}
 <span className="font-mono">{song.filename}</span>
 </div>
 {/* Compact metadata strip — panel consensus to collapse SR/BD/ch/ISRC. */}
 <div className="text-[10px] font-mono mt-0.5" style={{ color: '#7a7164' }}>
 {formatMetadataStrip(m)}
 </div>
 </div>
 <button
 onClick={onClose}
 className="text-[10px] uppercase tracking-[0.12em] transition-colors hover:text-sand-200"
 style={{ color: '#8d867b' }}
 >
 Close
 </button>
 </div>

 {/* Deep-analysis gate.
 • Not yet run → a "Run deep analysis" CTA. Users asked to
 control this explicitly — auto-running on every tab open
 ate time when they only wanted to glance at the metrics.
 • Running → amber progress strip with elapsed seconds
 + latest phase message from the backend (onProgress).
 • Done → hidden (the panels below render instead). */}
 {!full && !loading && !error && (
 <div
 className="rounded-xl px-4 py-4 flex items-center justify-between gap-4 flex-wrap"
 style={{ backgroundColor: 'rgba(30,28,24,0.5)', border: '1px solid rgba(168,161,150,0.15)' }}
 >
 <div className="flex-1 min-w-[16rem]">
 <div className="text-[10px] uppercase tracking-[0.15em]" style={{ color: '#d0b066' }}>
 Deep analysis
 </div>
 <div className="text-[12px] mt-1" style={{ color: '#a8a29e' }}>
 Unlock clicks · distortion · hum · phase bands · key / BPM / harmonics · streaming normalisation preview · loudness-over-time. ~15–25 s per track.
 </div>
 </div>
 <button
 onClick={runDeepAnalysis}
 className="text-[11px] px-4 py-2 rounded-md transition-colors hover:bg-white/[0.03]"
 style={{ color: '#d0b066', border: '1px solid rgba(208,176,102,0.4)' }}
 title="Run the full single-file deep analysis for this song. Result is cached for the rest of the session."
 >
 Run deep analysis
 </button>
 </div>
 )}

 {loading && (
 <div
 className="rounded-xl px-4 py-3"
 style={{ backgroundColor: 'rgba(197,165,90,0.08)', border: '1px solid rgba(197,165,90,0.25)' }}
 role="progressbar"
 aria-valuenow={progressPct}
 aria-valuemin={0}
 aria-valuemax={100}
 aria-label="Deep analysis progress"
 >
 <div className="flex items-center justify-between mb-2">
 <div className="flex items-center gap-2">
 <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#c5a55a' }} />
 <span className="text-[10px] uppercase tracking-[0.15em]" style={{ color: '#c5a55a' }}>
 Deep analysis running
 </span>
 </div>
 <span className="font-mono text-[11px]" style={{ color: '#c5a55a' }}>
 {progressPct}% · {elapsedSec}s
 </span>
 </div>
 <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(197,165,90,0.15)' }}>
 <div
 className="h-full transition-[width] duration-1000 ease-linear"
 style={{ width: `${progressPct}%`, backgroundColor: '#c5a55a' }}
 />
 </div>
 <div className="mt-2 text-[10px] italic" style={{ color: '#a8a29e' }}>
 {analysisMsg || 'Working…'}
 </div>
 </div>
 )}

 {error && !loading && (
 <div
 className="rounded-xl px-4 py-3 flex items-center justify-between gap-3"
 style={{ backgroundColor: 'rgba(224,90,90,0.08)', border: '1px solid rgba(224,90,90,0.25)' }}
 >
 <span className="text-[11px]" style={{ color: '#e05a5a' }}>⚠ Deep analysis failed — {error}</span>
 <button
 onClick={runDeepAnalysis}
 className="text-[10px] px-3 py-1 rounded-md"
 style={{ color: '#e05a5a', border: '1px solid rgba(224,90,90,0.4)' }}
 >
 Try again
 </button>
 </div>
 )}

 {/* Triage Mode toggle + DSP profile picker. QC / label-ops users
 flip on triage, optionally pick a platform (Apple / Spotify /
 Amazon / Tidal / YouTube), and the Attention list is overlaid
 with platform-specific findings. Persists in localStorage. */}
 <div className="flex items-center justify-end gap-3 flex-wrap">
 {triageMode && (
 <label className="flex items-center gap-1.5 text-[9px]" style={{ color: '#7a7164' }}>
 <span className="uppercase tracking-[0.15em]">DSP profile</span>
 <select
 value={dspProfileId}
 onChange={e => setDspProfile(e.target.value)}
 className="text-[10px] px-2 py-0.5 rounded bg-transparent focus:outline-none"
 style={{ color: '#ebe7e0', border: '1px solid rgba(168,161,150,0.2)' }}
 title="Overlay a DSP's specific delivery spec on the Attention list (target LUFS, TP ceiling, SR/BD minimum, ISRC rules)."
 >
 <option value="" style={{ backgroundColor: '#1f1b17' }}>— generic —</option>
 {Object.values(DSP_PROFILES).map(p => (
 <option key={p.id} value={p.id} style={{ backgroundColor: '#1f1b17' }}>{p.name}</option>
 ))}
 </select>
 </label>
 )}
 <button
 onClick={toggleTriage}
 className="text-[10px] uppercase tracking-[0.12em] transition-colors hover:text-sand-200"
 style={{ color: triageMode ? '#d0b066' : '#7a7164' }}
 title="Triage Mode brings back the Ready-to-Deliver verdict + Attention list at the top of the panel. Useful for QC / label-ops; off by default for engineer workflow."
 >
 {triageMode ? '▾ Triage mode · on' : '▸ Triage mode'}
 </button>
 </div>

 {triageMode && verdict && (
 <>
 <ReadyToDeliverVerdict verdict={verdict} compact />
 {attention.length > 0 && (
 <div className="space-y-1.5">
 <div className="text-[9px] uppercase tracking-[0.15em]" style={{ color: '#d0b066' }}>Attention</div>
 <AttentionList items={attention} onJump={jumpTo} />
 </div>
 )}
 </>
 )}

 {/* Per-song notes */}
 <SongNotes value={note} onChange={onNoteChange} />

 {/* Reference picker — drives both the A/B player below AND the
 Tonal Balance overlay further down. Picking any option engages
 full A/B mode (same audio engine as Compare mode) with this
 song as B and the picked file as A. Grouped optgroups put
 Favorites first, then session uploads, then the cohort ref,
 then album tracks — so frequently-used refs are always right
 on top. */}
 {hasAnyTargets && (
 <div className="flex items-center gap-2 flex-wrap">
 <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: '#d0b066' }}>A/B reference</span>
 <select
 value={compareTargetPath || ''}
 onChange={e => setCompareTargetPath(e.target.value || null)}
 className="text-[11px] px-2 py-1 rounded bg-transparent focus:outline-none"
 style={{ color: '#ebe7e0', border: '1px solid rgba(168,161,150,0.2)', minWidth: 240 }}
 title="Pick another album track, a favorite / uploaded reference, or the cohort reference. Engages the same A/B player used in Compare mode; B stays on this song, A is whatever you pick here."
 >
 <option value="" style={{ backgroundColor: '#1f1b17' }}>— solo transport (no A/B) —</option>
 {/* Revisions — auto-detected siblings of the current file
 (same base stem, different _v2 / _REV3 / _FINAL suffix).
 Pinned at the very top during iterative mastering
 sessions, engineers want "previous rev" one click away. */}
 {compareTargets?.revisions && compareTargets.revisions.length > 0 && (
 <optgroup label="↻ Revisions of this track" style={{ backgroundColor: '#1f1b17' }}>
 {compareTargets.revisions.filter(t => t.path !== song.path).map(t => (
 <option key={`rev:${t.path}`} value={t.path} style={{ backgroundColor: '#1f1b17' }}>↻ {t.label}</option>
 ))}
 </optgroup>
 )}
 {/* Cohort ref pinned at the top — user couldn't find it when
 it was buried below Album tracks. Labels, distros and
 mastering ops will always reach for this first if it's
 set. */}
 {compareTargets?.cohort && compareTargets.cohort.path !== song.path && (
 <optgroup label="★ Cohort reference" style={{ backgroundColor: '#1f1b17' }}>
 <option value={compareTargets.cohort.path} style={{ backgroundColor: '#1f1b17' }}>★ {compareTargets.cohort.label}</option>
 </optgroup>
 )}
 {compareTargets?.favorites && compareTargets.favorites.length > 0 && (
 <optgroup label="★ Favorites" style={{ backgroundColor: '#1f1b17' }}>
 {compareTargets.favorites.filter(t => t.path !== song.path).map(t => (
 <option key={`fav:${t.path}`} value={t.path} style={{ backgroundColor: '#1f1b17' }}>★ {t.label}</option>
 ))}
 </optgroup>
 )}
 {compareTargets?.session && compareTargets.session.length > 0 && (
 <optgroup label="⊕ This session" style={{ backgroundColor: '#1f1b17' }}>
 {compareTargets.session.filter(t => t.path !== song.path).map(t => (
 <option key={`sess:${t.path}`} value={t.path} style={{ backgroundColor: '#1f1b17' }}>⊕ {t.label}</option>
 ))}
 </optgroup>
 )}
 {compareTargets?.album && compareTargets.album.length > 0 && (
 <optgroup label="Album tracks" style={{ backgroundColor: '#1f1b17' }}>
 {compareTargets.album.filter(t => t.path !== song.path).map(t => (
 <option key={`alb:${t.path}`} value={t.path} style={{ backgroundColor: '#1f1b17' }}>{t.label}</option>
 ))}
 </optgroup>
 )}
 </select>

 {/* "+ Load" — upload a file from anywhere in the user's library.
 BatchView handles the picker + analyse-for-spectrum round trip
 and auto-selects the result. Spinner while the scan runs. */}
 {onAddReference && (
 <button
 onClick={() => onAddReference()}
 disabled={!!uploadingReference}
 className="text-[11px] px-2 py-1 rounded transition-colors hover:bg-white/[0.03] disabled:opacity-60"
 style={{ color: '#a8a29e', border: '1px solid rgba(168,161,150,0.2)' }}
 title="Load a reference file from your library. It stays in this session's dropdown; star it to keep it across sessions."
 >
 {uploadingReference ? '…' : '+ Load'}
 </button>
 )}
 {addReferenceError && (
 <span
 className="text-[10px] px-2 py-1 rounded cursor-pointer"
 style={{ color: '#e05a5a', backgroundColor: 'rgba(224,90,90,0.08)', border: '1px solid rgba(224,90,90,0.25)' }}
 role="alert"
 title="Click to dismiss"
 onClick={() => onClearAddReferenceError?.()}
 >
 ⚠ {addReferenceError}
 </span>
 )}

 {/* Star — favorite / unfavorite the currently-picked reference
 so it's always on the list across sessions. Only shown when
 a reference is actively selected. */}
 {onToggleFavorite && compareTarget && (
 <button
 onClick={onToggleFavorite}
 className="text-[13px] px-2 py-1 rounded transition-colors hover:bg-white/[0.03]"
 style={{ color: isReferenceFavorited ? '#d0b066' : '#7a7164', border: '1px solid rgba(168,161,150,0.2)', lineHeight: 1 }}
 title={isReferenceFavorited ? 'Remove from favorites' : 'Save as favorite — stays available across sessions'}
 aria-label={isReferenceFavorited ? 'Remove from favorites' : 'Add to favorites'}
 >
 {isReferenceFavorited ? '★' : '☆'}
 </button>
 )}

 {compareTarget && (
 <span className="text-[10px]" style={{ color: '#7a7164' }}>
 Press <span className="font-mono">A</span> / <span className="font-mono">B</span> / <span className="font-mono">X</span> to flip, <span className="font-mono">space</span> play/pause.
 </span>
 )}
 </div>
 )}

 {/* Transport — either the full A/B player (when a reference is
 picked) or the lightweight solo transport (when not). The full
 player is the same ABPlayer used in Compare mode; we key it on
 both path ids so changing either song forces a clean remount. */}
 {compareTarget ? (
 <ABPlayer
 key={`ab:${compareTarget.path}:${song.path}`}
 fileA={{ path: compareTarget.path, name: compareTarget.label }}
 fileB={{ path: song.path, name: song.filename }}
 gainAppliedDb={0}
 />
 ) : (
 <div className="flex items-center gap-4">
 <button
 onClick={onPlayToggle}
 className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 transition-all hover:scale-105"
 style={{
 backgroundColor: isPlaying ? 'rgba(224,122,79,0.15)' : 'rgba(208,176,102,0.12)',
 border: `1px solid ${isPlaying ? 'rgba(224,122,79,0.5)' : 'rgba(208,176,102,0.4)'}`,
 }}
 title={isPlaying ? 'Pause' : 'Play'}
 aria-label={isPlaying ? 'Pause' : 'Play'}
 >
 {isPlaying ? (
 <svg className="w-4 h-4" fill="#e07a4f" viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
 ) : (
 <svg className="w-4 h-4" fill="#d0b066" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
 )}
 </button>
 <div className="flex-1 flex items-center gap-3">
 <span className="text-[10px] font-mono tabular-nums" style={{ color: '#a8a29e', minWidth: 40 }}>
 {fmtTime(pos)}
 </span>
 <div
 className="relative flex-1 h-1.5 rounded-full cursor-pointer"
 style={{ backgroundColor: 'rgba(168,161,150,0.12)' }}
 onClick={(e) => {
 if (!isPlaying || !duration) return
 const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
 const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
 onSeek(ratio * duration)
 }}
 >
 <div className="absolute inset-y-0 left-0 rounded-full transition-all" style={{ width: `${duration > 0 ? (pos / duration) * 100 : 0}%`, backgroundColor: '#d0b066' }} />
 </div>
 <span className="text-[10px] font-mono tabular-nums" style={{ color: '#7a7164', minWidth: 40, textAlign: 'right' }}>
 {fmtTime(duration)}
 </span>
 </div>
 </div>
 )}

 {/* 4. Stat grid */}
 <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
 <StatCard label="Integrated" value={m.lufs != null ? m.lufs.toFixed(1) : '—'} unit="LUFS" />
 <StatCard label="True Peak" value={m.true_peak != null ? m.true_peak.toFixed(1) : '—'} unit="dBTP" />
 <StatCard label="LRA" value={m.lra != null ? m.lra.toFixed(1) : '—'} unit="LU" />
 <StatCard label="Length" value={m.duration_sec != null ? formatDuration(m.duration_sec) : '—'} unit="" />
 <StatCard label="Mono loss" value={m.mono_compat_loss_pct != null ? `${m.mono_compat_loss_pct}` : '—'} unit="%" warn={m.mono_compat_loss_pct != null && m.mono_compat_loss_pct > 30} />
 </div>

 {/* Streaming Normalization Preview — collapsed by default (user
 feedback: takes too much space open). Summary badge shows how
 many platforms will attenuate. */}
 {full?.streaming_preview?.b && full.streaming_preview.b.length > 0 && (
 <CollapsibleSection
 title="Streaming Normalization Preview"
 tooltip="Per-platform playback loudness after normalization. ▶ on any platform to hear 30 s of the loudest section at that platform's level."
 defaultOpen={false}
 badge={(() => {
 const attenuated = full.streaming_preview.b.filter(r => r.action === 'attenuated').length
 return (
 <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: '#c5a55a', backgroundColor: 'rgba(197,165,90,0.12)' }}>
 {attenuated} of {full.streaming_preview.b.length} attenuated
 </span>
 )
 })()}
 >
 <StreamingPreview
 previewA={full.streaming_preview.b}
 previewB={full.streaming_preview.b}
 labelA={displayName}
 labelB={displayName}
 soloA={true}
 fileA={fileInfo}
 lufsA={full.overall?.lufs_b ?? null}
 />
 </CollapsibleSection>
 )}

 {/* Key · BPM · Harmonics — now sits right below Streaming Preview,
 full RefOnlyView layout (log-scaled Hz axis with root / octave /
 harmonic markers + chip row), not the mini block we had before.
 User explicitly asked for the full view back. */}
 {songInfo && (songInfo.bpm || songInfo.key) && (
 <CollapsibleSection
 title="Key · BPM · Harmonics"
 tooltip="Detected tempo + key with the full harmonic ladder. Root is the song's fundamental; octaves are 2× / 4× / 8× multiples; harmonics are the natural partials. All places where EQ moves have the most musical impact."
 defaultOpen={true}
 >
 <SongInfoBlock info={songInfo} />
 </CollapsibleSection>
 )}

 {/* Loudness over time — short-term LUFS curve with auto-section
 overlays (intro / drop / outro). Surfaces per-section LUFS
 averages so a "too loud overall" complaint resolves to "the
 drop is +3 LU hotter than the pre-drop — intentional?" */}
 {full?.lufs_over_time_b && full.lufs_over_time_b.length > 0 && (
 <CollapsibleSection
 title="Loudness over time"
 tooltip="Short-term LUFS plotted across the song with section boundaries from the transient-density detector. Dashed blue line per section is the section's mean LUFS, useful for catching intentional vs accidental dynamic drops between sections."
 defaultOpen={false}
 >
 <LoudnessOverTime result={full} side="b" durationSec={m.duration_sec || undefined} />
 </CollapsibleSection>
 )}

 {/* Tonal balance — 31-band with optional reference overlay. Dropdown
 lets the user layer another song (or the cohort reference) on
 top as a dashed curve, so the 31-band strip actually delivers
 comparative value instead of just a pretty shape. */}
 {song.spectrum && song.spectrum.length === 31 && (
 <div className="space-y-1.5">
 <div className="flex items-center justify-between flex-wrap gap-2">
 <span className="text-[10px] uppercase tracking-[0.12em]" style={{ color: '#7a7164' }}>
 Tonal balance · 31-band
 {compareTarget && compareTarget.spectrum && (
 <span className="ml-2 normal-case tracking-normal" style={{ color: '#6b8cbb' }}>
 · overlaid vs {compareTarget.label}
 </span>
 )}
 </span>
 <span className="text-[9px] font-mono" style={{ color: '#57534e' }}>dB · peak-normalised</span>
 </div>
 <SpectrumCurve spectrum={song.spectrum} compareSpectrum={compareTarget?.spectrum} compareLabel={compareTarget?.label} />
 </div>
 )}

 {/* Clicks timeline with click-to-transport (7/10 vote, daily-driver feature) */}
 {full?.clicks && full.clicks.length > 0 && (
 <CollapsibleSection
 title="Clicks & Glitches"
 tooltip="Digital clicks, pops, edit artefacts. Click any entry to jump the transport there."
 badge={
 <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: '#c5a55a', backgroundColor: 'rgba(150,128,58,0.12)' }}>
 {full.clicks.length} detected
 </span>
 }
 defaultOpen={full.clicks.filter(c => c.severity === 'high').length > 0}
 >
 <ClickTimeline
 clicks={full.clicks}
 labelB={displayName}
 fileA={fileInfo}
 durationSec={m.duration_sec || 0}
 />
 </CollapsibleSection>
 )}

 {/* Distortion */}
 {full?.distortion && (
 <CollapsibleSection
 title="Distortion · Clipping · True Peak"
 tooltip="Inter-sample peak overs, clipping samples, harmonic distortion heuristics."
 defaultOpen={full.distortion.severity === 'problem'}
 >
 <DistortionPanel distortion={full.distortion} labelA={displayName} labelB={displayName} singleFile={true} />
 </CollapsibleSection>
 )}

 {/* Hum / buzz */}
 {full?.hum && full.hum.severity !== 'none' && (
 <CollapsibleSection
 title="Hum / Buzz"
 tooltip={`Mains hum detected at ${full.hum.mains} Hz and harmonics.`}
 defaultOpen={full.hum.severity === 'audible'}
 >
 <HumPanel hum={full.hum} />
 </CollapsibleSection>
 )}

 {/* Mono compatibility — collapsed by default (user feedback: "takes
 a lot of space"). */}
 {full?.mono_compat && (
 <CollapsibleSection
 title="Mono Compatibility"
 tooltip="How much stereo energy survives the mono fold — the phone-speaker / Bluetooth test."
 defaultOpen={false}
 >
 <MonoCompat mono={full.mono_compat} labelA={displayName} labelB={displayName} />
 </CollapsibleSection>
 )}

 {/* Phase Correlation — full-song L/R correlation timeline. */}
 {full?.phase_over_time_a && m.duration_sec && (
 <CollapsibleSection
 title="Phase Correlation Over Time"
 tooltip="L/R phase correlation across the song. Positive = coherent; negative = out-of-phase risk."
 defaultOpen={false}
 >
 <PhaseCorrelation
 phaseOverTimeA={full.phase_over_time_a}
 phaseOverTimeB={full.phase_over_time_a}
 labelA={displayName}
 labelB={displayName}
 durationSec={m.duration_sec}
 />
 </CollapsibleSection>
 )}

 {/* Phase Bands — per-band (low / low-mid / mid / high-mid / high)
 correlation, surfaces where low-end is out of phase etc. Same
 panel as Compare mode. Collapsed by default. */}
 {(full as any)?.phase_bands_a && (full as any).phase_bands_a.length > 0 && (
 <CollapsibleSection
 title="Phase Compatibility · Bands"
 tooltip="L/R correlation split into frequency bands. Low-band out-of-phase is a classic cause of low-end loss on mono playback; high-band out-of-phase usually means wide FX on cymbals that collapse on Bluetooth."
 defaultOpen={false}
 >
 <PhaseBandsPanel
 bandsA={(full as any).phase_bands_a}
 labelA={displayName}
 />
 </CollapsibleSection>
 )}

 {full?.vectorscope_a && (
 <CollapsibleSection
 title="Vectorscope"
 tooltip="L/R stereo image as a 2D Lissajous. Vertical = mono; wide diamond = natural stereo; horizontal = out-of-phase."
 defaultOpen={false}
 >
 <Vectorscope
 pointsA={full.vectorscope_a}
 pointsB={full.vectorscope_a}
 labelA={displayName}
 labelB={displayName}
 />
 </CollapsibleSection>
 )}

 {error && (
 <div className="text-[11px] italic" style={{ color: '#e05a5a' }}>
 Deep analysis failed — {error}. Basic metrics shown above.
 </div>
 )}
 </div>
 )
}

/* ─── Sub-components ─────────────────────────────────────────────────── */

function StatCard({ label, value, unit, warn }: { label: string; value: string; unit: string; warn?: boolean }) {
 return (
 <div className="rounded-lg px-3 py-2.5" style={{ backgroundColor: 'rgba(48,44,39,0.5)', border: '1px solid rgba(168,161,150,0.06)' }}>
 <div className="text-[9px] uppercase tracking-[0.15em]" style={{ color: '#7a7164' }}>{label}</div>
 <div className="flex items-baseline gap-1.5 mt-1">
 <span className="font-mono tabular-nums text-base" style={{ color: warn ? '#e07a4f' : '#e7e5e4', fontWeight: 300 }}>
 {value}
 </span>
 {unit && <span className="text-[9px]" style={{ color: '#7a7164' }}>{unit}</span>}
 </div>
 </div>
 )
}

/**
 * 31-band spectrum as a filled cubic-Bezier curve. Now supports an
 * optional reference overlay (dashed) so the engineer can see the song
 * against another master / the cohort reference without jumping views —
 * that's the payoff the plain single-file strip was missing.
 */
function SpectrumCurve({ spectrum, compareSpectrum, compareLabel }: {
 spectrum: number[]
 compareSpectrum?: number[]
 compareLabel?: string
}) {
 const width = 640
 const height = 96
 const minDb = -60
 const maxDb = 0
 const toY = (db: number) => {
 const clamped = Math.max(minDb, Math.min(maxDb, db))
 return height - ((clamped - minDb) / (maxDb - minDb)) * height
 }
 const toPath = (data: number[]): string => {
 if (data.length === 0) return ''
 // Guard the denominator — a single-bin spectrum would divide by zero
 // and emit `M NaN NaN`, which Chromium renders as an invisible path
 // that can blow up the enclosing <svg>'s bounding box in Safari.
 const denom = Math.max(1, data.length - 1)
 const pts = data.map((v, i) => ({ x: (i / denom) * width, y: toY(v) }))
 if (pts.length === 0) return ''
 let p = `M ${pts[0].x} ${pts[0].y}`
 for (let i = 1; i < pts.length; i++) {
 const prev = pts[i - 1]
 const curr = pts[i]
 const cpx = (prev.x + curr.x) / 2
 p += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`
 }
 return p
 }
 const d = toPath(spectrum)
 const fillPath = `${d} L ${width} ${height} L 0 ${height} Z`
 const compareD = compareSpectrum && compareSpectrum.length === spectrum.length ? toPath(compareSpectrum) : null
 const labels = ['20', '100', '1k', '10k']
 const labelAt = [0, 8, 17, 27]
 return (
 <div className="rounded-lg px-4 py-3 space-y-2" style={{ backgroundColor: 'rgba(48,44,39,0.35)', border: '1px solid rgba(168,161,150,0.06)' }}>
 <svg viewBox={`0 0 ${width} ${height + 18}`} className="w-full" preserveAspectRatio="none">
 {[-20, -40].map(db => (
 <line key={db} x1={0} x2={width} y1={toY(db)} y2={toY(db)} stroke="#3e3a33" strokeWidth={0.5} strokeDasharray="2 3" />
 ))}
 <path d={fillPath} fill="rgba(208,176,102,0.15)" />
 <path d={d} fill="none" stroke="#d0b066" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
 {compareD && (
 <path d={compareD} fill="none" stroke="#6b8cbb" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 3" opacity="0.8" />
 )}
 {labels.map((l, i) => (
 <text key={i} x={(labelAt[i] / 30) * width} y={height + 14} fontSize="9" fill="#7a7164" textAnchor="middle" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
 {l} Hz
 </text>
 ))}
 </svg>
 {compareLabel && (
 <div className="flex items-center gap-4 text-[9px]" style={{ color: '#7a7164' }}>
 <span className="flex items-center gap-1.5">
 <span className="inline-block w-3 h-0.5" style={{ backgroundColor: '#d0b066' }} />
 This song
 </span>
 <span className="flex items-center gap-1.5">
 <span className="inline-block w-3 border-t border-dashed" style={{ borderColor: '#6b8cbb' }} />
 {compareLabel}
 </span>
 </div>
 )}
 </div>
 )
}

/**
 * Key / BPM / harmonics block — full RefOnlyView layout as the user asked
 * for the complete view back. Wider log-scaled axis with labeled octave
 * markers + a chip row below listing every harmonic with its label (root,
 * octave, 3rd, 5th…). Colour-coded so the ladder reads at a glance:
 * amber = root, blue = octaves, green = harmonics.
 */
function SongInfoBlock({ info }: { info: any }) {
 const harmonics: { freq: number; is_root?: boolean; is_octave?: boolean; label?: string }[] = info.harmonics || []
 return (
 <div className="space-y-4">
 <div className="grid grid-cols-3 gap-3">
 <MiniStat label="BPM" value={info.bpm ? `${info.bpm}` : '—'} />
 <MiniStat
 label="Key"
 value={info.key || '—'}
 sub={info.key_confidence != null ? `${Math.round(info.key_confidence * 100)}% conf.` : undefined}
 />
 <MiniStat
 label="Root"
 value={info.root_note || '—'}
 sub={info.key_freq ? `${info.key_freq} Hz` : undefined}
 />
 </div>
 {harmonics.length > 0 && (
 <div className="space-y-2">
 <div className="flex items-center justify-between">
 <span className="text-[10px] uppercase tracking-[0.12em]" style={{ color: '#7a7164' }}>Key frequencies</span>
 <span className="text-[9px] font-mono" style={{ color: '#57534e' }}>
 20 Hz → 20 kHz (log)
 </span>
 </div>
 {/* Full log-scaled harmonic ladder, matching RefOnlyView. */}
 <div className="rounded-lg p-4 overflow-hidden" style={{ backgroundColor: 'rgba(48,44,39,0.4)' }}>
 <div className="relative h-16">
 <div className="absolute inset-x-0 top-1/2 h-px" style={{ backgroundColor: 'rgba(87,83,78,0.3)' }} />
 {harmonics.map((h, i) => {
 const logPos = (Math.log10(h.freq) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))
 const left = logPos * 100
 if (left < 0 || left > 100) return null
 const isRoot = h.is_root
 const isOctave = h.is_octave
 const color = isRoot ? '#e07a4f' : isOctave ? '#6b8cbb' : '#6ec577'
 const height = isRoot ? '100%' : isOctave ? '70%' : '45%'
 const width = isRoot ? 3 : isOctave ? 2 : 1
 return (
 <div key={i} className="absolute flex flex-col items-center" style={{ left: `${left}%`, top: 0, bottom: 0 }}>
 <div className="rounded-full" style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: `${width}px`, height, backgroundColor: color, opacity: isRoot ? 0.9 : isOctave ? 0.6 : 0.35 }} />
 {(isRoot || isOctave) && (
 <span className="absolute text-[8px] font-mono whitespace-nowrap" style={{ bottom: '100%', marginBottom: '2px', color, transform: 'translateX(-50%)', left: '50%' }}>
 {h.freq >= 1000 ? `${(h.freq/1000).toFixed(1)}k` : Math.round(h.freq)}
 </span>
 )}
 {isRoot && (
 <span className="absolute text-[7px] font-medium whitespace-nowrap" style={{ top: '100%', marginTop: '2px', color, transform: 'translateX(-50%)', left: '50%' }}>ROOT</span>
 )}
 </div>
 )
 })}
 </div>
 <div className="flex justify-between mt-3 text-[7px]" style={{ color: '#57534e' }}>
 <span>20</span><span>50</span><span>100</span><span>200</span><span>500</span><span>1k</span><span>2k</span><span>5k</span><span>10k</span><span>20k</span>
 </div>
 </div>
 {/* Chip row — every harmonic with its label */}
 <div className="flex flex-wrap gap-1.5">
 {harmonics.map((h, i) => (
 <span key={i} className="text-[9px] px-2 py-0.5 rounded font-mono" style={{
 backgroundColor: h.is_root ? 'rgba(224,122,79,0.15)' : h.is_octave ? 'rgba(107,140,187,0.1)' : 'rgba(110,197,119,0.08)',
 color: h.is_root ? '#e07a4f' : h.is_octave ? '#6b8cbb' : '#78716c',
 fontWeight: h.is_root ? 600 : 400,
 }}>
 {h.freq >= 1000 ? `${(h.freq/1000).toFixed(1)}k` : Math.round(h.freq)} Hz
 {h.label && <span className="ml-1 opacity-60">{h.label}</span>}
 </span>
 ))}
 </div>
 </div>
 )}
 </div>
 )
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
 return (
 <div className="rounded-lg p-3" style={{ backgroundColor: 'rgba(48,44,39,0.5)' }}>
 <div className="text-[9px] uppercase tracking-[0.15em]" style={{ color: '#7a7164' }}>{label}</div>
 <div className="text-sm font-medium mt-0.5" style={{ color: '#e7e5e4' }}>{value}</div>
 {sub && <div className="text-[9px] mt-0.5" style={{ color: '#57534e' }}>{sub}</div>}
 </div>
 )
}

/**
 * Per-song notes block. Always visible (not behind a collapse) — engineers
 * reach for notes constantly while auditioning, so the extra click hurts.
 * Auto-grows with content. Placeholder nudges the user toward the kind of
 * thing that's useful to ship with the PDF.
 */
function SongNotes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
 const hasContent = !!value && value.trim().length > 0
 return (
 <div className="rounded-xl" style={{ backgroundColor: 'rgba(18,16,14,0.4)', border: '1px solid rgba(168,161,150,0.08)' }}>
 <div className="flex items-center justify-between px-3 py-2">
 <div className="flex items-center gap-2">
 <span className="text-[9px] uppercase tracking-[0.15em]" style={{ color: '#d0b066' }}>Notes</span>
 {hasContent && (
 <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#c5a55a' }} title="Has notes" />
 )}
 </div>
 <span className="text-[9px]" style={{ color: '#57534e' }}>Saved with session · included in PDF</span>
 </div>
 <div className="px-3 pb-3">
 <textarea
 value={value}
 onChange={e => onChange(e.target.value)}
 placeholder="Notes for this track. Revision requests, what's fixed since last pass, anything you want attached to the PDF."
 rows={3}
 className="w-full rounded-lg px-3 py-2 text-[12px] resize-y focus:outline-none"
 style={{
 backgroundColor: 'rgba(12,10,8,0.6)',
 color: '#ebe7e0',
 border: '1px solid rgba(168,161,150,0.12)',
 lineHeight: 1.5,
 }}
 />
 </div>
 </div>
 )
}

function fmtTime(t: number): string {
 if (!isFinite(t) || t < 0) t = 0
 const m = Math.floor(t / 60)
 const s = Math.floor(t - m * 60)
 return `${m}:${s.toString().padStart(2, '0')}`
}
