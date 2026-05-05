import React, { useState, useCallback, useEffect, useLayoutEffect, useRef, Suspense, lazy } from 'react'
import { AppState, FileInfo, AnalysisResult } from './types'
import { useTheme } from './ThemeContext'
import { useModes } from './ModesContext'
import FileDropZone from './components/FileDropZone'
import ReferenceLibrary from './components/ReferenceLibrary'
import RtmIncomingBanner from './components/RtmIncomingBanner'
import { usePluginDrop } from './PluginDropContext'
import ProgressBar from './components/ProgressBar'
// 5.2.0 perf fix (audit P1-19): the three primary mode panels (Compare,
// Single-file, Batch) are mutually exclusive — only one is visible at any
// time — yet the previous eager imports forced all three into the cold
// boot bundle (~7000 LOC across BatchView 1884 / RefOnlyView 1321 /
// AnalysisView 1853). Lazy-loading them cuts initial JS by ~40-50%.
// Vite handles the dynamic import out of the box; no config needed.
const AnalysisView = lazy(() => import('./components/AnalysisView'))
const RefOnlyView = lazy(() => import('./components/RefOnlyView'))
const BatchView = lazy(() => import('./components/BatchView'))
import RecentAnalyses from './components/RecentAnalyses'
import type { BatchResult, HistoryEntry, AlbumSession } from './types'
import OnboardingTour, { useTourState } from './components/OnboardingTour'
import ShortcutHelp from './components/ShortcutHelp'
import AnalysisTour, { useAnalysisTourState } from './components/AnalysisTour'
import RefOnlyTour, { useRefOnlyTourState } from './components/RefOnlyTour'

interface ProfileInfo {
 id: string
 name: string
 description?: string
 sample_count?: number
 user_created?: boolean
}

declare global {
 interface Window {
 electronAPI?: {
 analyzeFiles: (fileA: string, fileB: string, fast?: boolean, profile?: string) => Promise<AnalysisResult>
 readAudioFile: (filePath: string) => Promise<ArrayBuffer>
 getFileIdentity?: (filePath: string) => Promise<{ path: string; size: number; mtime: number; mtime_iso: string; sha256: string; error?: string }>
 historyRead?: () => Promise<import('./types').HistoryEntry[]>
 historyAppend?: (entry: import('./types').HistoryEntry) => Promise<number>
 historyClear?: () => Promise<boolean>
 getPathForFile: (file: File) => string
 onProgress: (callback: (msg: string) => void) => (() => void) | void
 selectFile: () => Promise<string | null>
 selectFolder?: () => Promise<string | null>
 listAudioFiles?: (dirPath: string) => Promise<{ path: string; name: string; size: number }[]>
 analyzeBatch?: (filePaths: string[], options?: { deep?: boolean; deepWorkers?: number }) => Promise<{
 results: import('./types').BatchResult[]
 /** Populated when options.deep = true. Keyed by absolute path;
 * each value is the full single-file AnalysisResult (same shape
 * analyze.py returns for ref-only mode), OR `{ __error: string }`
 * if the per-song deep run failed. */
 deep?: Record<string, any>
 spec_versions?: import('./types').SpecVersions
 }>
 onBatchProgress?: (callback: (msg: { message: string; index: number; total: number }) => void) => void
 listProfiles?: () => Promise<ProfileInfo[]>
 loadCustomProfile?: () => Promise<ProfileInfo | null>
 deleteCustomProfile?: (id: string) => Promise<boolean>
 renderCorrectedEq?: (srcPath: string, bands: { freq: number; gain_db: number; q: number }[], outPath?: string, truePeakLimit?: boolean, ceilingDbtp?: number, targetLufs?: number) => Promise<string>
 saveFileDialog?: (defaultName: string, contents: string, filters: { name: string; extensions: string[] }[]) => Promise<string | null>
 saveBinaryFileDialog?: (defaultName: string, bytes: Uint8Array | ArrayBuffer, filters: { name: string; extensions: string[] }[]) => Promise<string | null>
 openTextFileDialog?: (filters: { name: string; extensions: string[] }[]) => Promise<{ path: string; contents: string } | null>
 pickSavePath?: (suggestedName: string, filters: { name: string; extensions: string[] }[]) => Promise<string | null>
 renderPdf?: (html: string, suggestedName: string) => Promise<string | null>
 cancelAnalysis?: () => Promise<boolean>
 revealInFinder?: (filePath: string) => Promise<boolean>
 copyToClipboard?: (text: string) => Promise<boolean>
 // ISRC history / Releases store / Audit log — REMOVED (FLOW territory)
 // Integrity helpers for Ship-Ready PDF
 computeSha256?: (filePath: string) => Promise<string | { error: string }>
 writeSidecar?: (filePath: string, suffix: string, contents: string) => Promise<string | { error: string }>
 // Default export folder — skip-the-dialog plumbing
 pickFolder?: (title?: string) => Promise<string | null>
 writeFileDirect?: (folderPath: string, fileName: string, contents: string) => Promise<string | { error: string }>
 renderPdfDirect?: (folderPath: string, fileName: string, html: string) => Promise<string | { error: string }>
 // Master Chain — offline render of the full HPF → EQ → comp → TP
 // limiter → dither pipeline. `config` mirrors python/master_chain.py.
 masterChainRender?: (srcPath: string, config: any, outPath?: string) => Promise<{
 ok: boolean
 path?: string
 lufs_in?: number | null
 lufs_out?: number | null
 tp_out_dbtp?: number
 makeup_db_actual?: number
 sample_rate?: number
 bit_depth?: number
 cancelled?: boolean
 error?: string
 }>
 // Send-to-RTM plugin bridge.
 onRtmIncoming?: (cb: (drop: { audioPath: string; metaPath: string | null; meta: { sessionName?: string; daw?: string; sampleRate?: number; durationSec?: number; createdAt?: string; channels?: number } | null }) => void) => () => void
 rtmIncomingList?: () => Promise<{ audioPath: string; metaPath: string | null; meta: any | null }[]>
 rtmIncomingClear?: () => Promise<number>

 // BWF metadata writer — REMOVED (FLOW territory)
 // Encoded-Preview — Apple Sound Check twin + other DSPs
 encodedPreviewRender?: (srcPath: string, dsp: string, integratedLufs: number | null, windowStartSec?: number | null) => Promise<{
 ok: boolean
 path?: string
 dsp?: string
 gain_db?: number
 target_lufs?: number
 tp_ceiling?: number
 post_limiter_peak_db?: number
 /** Worst-case gain reduction across the preview window (dB). */
 worst_gr_db?: number
 /** Per-block gain-reduction envelope for the Streaming Delta
 * Heatmap — array of dB values where 0 = no reduction. */
 gr_envelope_db?: number[]
 /** Block width of each envelope sample, in ms (default 100). */
 gr_envelope_step_ms?: number
 window_start_sec?: number
 window_duration_sec?: number
 cached?: boolean
 error?: string
 }>
 // Translation Check — auditions the master through a playback
 // environment (phone speaker / earbuds / club PA / car cabin).
 // Sister IPC to encodedPreviewRender; skips platform normalisation.
 translationRender?: (srcPath: string, envId: string, windowStartSec?: number | null) => Promise<{
 ok: boolean
 path?: string
 env_id?: string
 env_label?: string
 lost_lf_db?: number
 presence_change_db?: number
 window_start_sec?: number
 window_duration_sec?: number
 cached?: boolean
 error?: string
 }>
 // Reference Library
 referencesList?: () => Promise<import('./types').ReferenceRecord[]>
 referencesAdd?: (srcPath: string) => Promise<import('./types').ReferenceRecord | { error: string }>
 referencesDelete?: (id: string) => Promise<boolean>
 referencesUpdate?: (id: string, patch: { tags?: string[]; notes?: string }) =>
 Promise<import('./types').ReferenceRecord | null>
 // RTM De-click — thin IPC bridge to python/declick.py. See python for
 // the full parameter contract; types.ts for the result shape.
 declickProcess?: (args: {
 inPath: string
 outPath?: string
 algorithm: string
 sensitivity: number
 skew: number
 widenMs: number
 mode: 'repair' | 'clicks' | 'list'
 }) => Promise<import('./types').DeclickResult>
 declickPreview?: (args: {
 inPath: string
 outPath?: string
 algorithm: string
 sensitivity: number
 skew: number
 widenMs: number
 mode: 'repair' | 'clicks' | 'list'
 }) => Promise<import('./types').DeclickResult>
 }
 }
}

/**
 * Chromium on macOS has a well-known bug where a native `title` tooltip
 * stays on screen after the element it's attached to unmounts — we saw
 * this during the upload→processing transition, the batch button's
 * tooltip hung around over the scanning view. Calling this on mousedown
 * (fires BEFORE click) strips the title + blurs the element so the
 * tooltip dismisses while the button still exists. Apply to any CTA that
 * unmounts on click.
 */
function dismissNativeTooltip(e: React.MouseEvent<HTMLElement>) {
 try {
 const el = e.currentTarget as HTMLElement
 el.removeAttribute('title')
 el.blur()
 } catch {}
}

export default function App() {
 const [state, setState] = useState<AppState>('upload')
 const [fileA, setFileA] = useState<FileInfo | null>(null)
 const [fileB, setFileB] = useState<FileInfo | null>(null)
 // Which slot the Reference Library modal will drop the picked track into.
 // null = modal closed.
 const [libraryTargetSlot, setLibraryTargetSlot] = useState<'A' | 'B' | null>(null)
 const [progress, setProgress] = useState('')
 const [results, setResults] = useState<AnalysisResult | null>(null)
 const [error, setError] = useState<string | null>(null)
 const [deepScan, setDeepScan] = useState(false)
 const [refOnlyResults, setRefOnlyResults] = useState<any>(null)
 // A-side lock. When set,
 // the Reference drop zone ignores drops + clicks so successive revisions
 // target the Compare slot without clobbering the pinned master. Also
 // blocks the "Clear all" from wiping A. Persists per-session only —
 // a fresh launch starts unlocked so the user sees the normal drop flow.
 const [lockFileA, setLockFileA] = useState(false)

 // ── Sticky-header height publishing ─────────────────────────────────────
 //
 // Tabs in AnalysisView (and any other sticky strip below the app
 // header) need to clear the drag-strip + sticky header. Hardcoding a
 // pixel offset breaks every time the header content changes. We
 // measure both at runtime, publish `--app-sticky-top` on
 // documentElement, and any sticky child reads it via
 // `top: var(--app-sticky-top, 100px)`.
 //
 // useLayoutEffect (not useEffect) so the CSS var is set BEFORE the
 // first paint — otherwise sticky tabs use the 100px fallback for
 // one frame and feel jumpy.
 //
 // The +4 px buffer below the measured total keeps tabs cleanly off
 // the header's bottom border instead of butting against it
 // (rounding errors in box-model + sub-pixel rendering can leave a
 // 1 px sliver of overlap that reads as "tabs going under").
 useLayoutEffect(() => {
 const update = () => {
 const drag = document.querySelector<HTMLElement>('.app-drag-region')
 const header = document.querySelector<HTMLElement>('header.app-no-drag')
 const total = (drag?.offsetHeight ?? 28) + (header?.offsetHeight ?? 68) + 4
 document.documentElement.style.setProperty('--app-sticky-top', `${total}px`)
 }
 update()
 // Re-measure on font load + window resize. ResizeObserver catches
 // inline content reflow (e.g. when the surface picker grows / shrinks).
 const ro = new ResizeObserver(update)
 const drag = document.querySelector<HTMLElement>('.app-drag-region')
 const header = document.querySelector<HTMLElement>('header.app-no-drag')
 if (drag) ro.observe(drag)
 if (header) ro.observe(header)
 window.addEventListener('resize', update)
 // Two delayed re-measurements catch late font loads + electron-
 // window-ready repaints that ResizeObserver can miss on first paint.
 const t1 = setTimeout(update, 150)
 const t2 = setTimeout(update, 800)
 return () => {
 ro.disconnect()
 window.removeEventListener('resize', update)
 clearTimeout(t1)
 clearTimeout(t2)
 }
 }, [])

 // ── Dev test hook (browser-only) ──────────────────────────────────────
 //
 // Lets the Claude Preview smoke-test harness jump the app to specific
 // surfaces without going through the real Electron analyze pipeline.
 // Gated on the devShim being active (no electron preload present), so
 // this is dead code in a shipped Electron build. Fires when eval calls
 // `window.__rtmDev.loadRefOnly()` / `setBothFiles()`.
 useEffect(() => {
 if ((window as any).process?.versions?.electron) return
 const onLoad = (e: Event) => {
 const { detail } = e as CustomEvent
 if (!detail) return
 if (detail.kind === 'ref-only') {
 // Apply the same flattening the real analyze callback does
 // (lines 420-466 in the analyze handler) so RefOnlyView sees
 // the shape it expects. Without this, `check.reference_check`
 // and `check.metadata.a` paths throw and the tree silently
 // unmounts under React's error boundary.
 const result = detail.result || {}
 setFileA(detail.fileA)
 setRefOnlyResults({
 reference_check: result.reference_check,
 clicks: result.clicks || [],
 distortion: result.distortion,
 tonal_issues: result.tonal_issues || [],
 overall: result.overall,
 spectrum_a: result.spectrum_a,
 mid_spectrum_a: result.mid_spectrum_a,
 side_spectrum_a: result.side_spectrum_a,
 vectorscope_a: result.vectorscope_a,
 phase_over_time_a: result.phase_over_time_a,
 phase_bands_a: result.phase_bands_a,
 mono_compat: result.mono_compat,
 duration_sec: result.duration_sec,
 waveform_a: result.waveform_a,
 engineer_tips: result.engineer_tips,
 masking: result.masking,
 ai_detection: result.ai_detection,
 hum: result.hum,
 transient_density: result.transient_density,
 streaming_preview: result.streaming_preview,
 lufs_over_time_b: result.lufs_over_time_b,
 sample_rate: result.metadata?.a?.sample_rate ?? null,
 bit_depth: result.metadata?.a?.bit_depth ?? null,
 channels: result.metadata?.a?.channels ?? null,
 isrc: result.metadata?.a?.isrc ?? null,
 clipped_samples: result.reference_check?.stats?.clip_count ?? null,
 metadata: result.metadata || null,
 headroom: result.headroom,
 dialog_gate: result.dialog_gate,
 limiter_artefacts: result.limiter_artefacts,
 spec_versions: result.spec_versions,
 adm_validation: result.adm_validation,
 genre_a: result.genre_a,
 atmos: result.atmos,
 comparison_mode: result.comparison_mode,
 song_info: result.song_info,
 full_result: result,
 })
 setState('ref-only')
 } else if (detail.kind === 'upload-ready') {
 setFileA(detail.fileA)
 setFileB(detail.fileB)
 } else if (detail.kind === 'compare') {
 setFileA(detail.fileA)
 setFileB(detail.fileB)
 setResults(detail.result)
 setState('results')
 } else if (detail.kind === 'batch') {
 setBatchResults(detail.results)
 setBatchFolderName(detail.folderName || null)
 setState('batch')
 }
 }
 window.addEventListener('__rtm-dev-load', onLoad)
 return () => window.removeEventListener('__rtm-dev-load', onLoad)
 }, [])
 const [batchResults, setBatchResults] = useState<BatchResult[] | null>(null)
 const [batchFolderName, setBatchFolderName] = useState<string | null>(null)
 // Session payload forwarded to BatchView when the user Loads a
 // .rtmalbum.json. Cleared on back-out so a fresh batch doesn't inherit
 // stale notes.
 const [batchInitialSession, setBatchInitialSession] = useState<AlbumSession | null>(null)

 // ── User mode (Engineer vs Label) ──────────────────────────────────
 // Label mode replaces the upload screen with the Release Cockpit —
 // a card grid over the local releases store. Engineer mode is the
 // flagship A/B-compare-first experience. Persisted in localStorage.
 type UserMode = 'engineer' | 'label'
 const [userMode, setUserMode] = useState<UserMode>(() => {
 const raw = (typeof window !== 'undefined' ? localStorage.getItem('rtm-user-mode') : null) as UserMode | null
 return raw === 'label' ? 'label' : 'engineer'
 })
 const toggleUserMode = useCallback(() => {
 setUserMode(prev => {
 const next: UserMode = prev === 'engineer' ? 'label' : 'engineer'
 try { localStorage.setItem('rtm-user-mode', next) } catch {}
 return next
 })
 }, [])

 // Origin of the current BatchView — 'upload' (flagship scan / load)
 // or 'cockpit' (clicked a release card). Back button honours this so
 // label users return to their dashboard, engineers return to upload.
 type NavOrigin = 'upload' | 'cockpit'
 const [navOrigin, setNavOrigin] = useState<NavOrigin>('upload')

 // Release-id state removed — releases / cockpit / hydrate-from-release
 // all live in FLOW now.

 // Global handler for Load-album-session — triggered from the upload
 // page's Load button OR from BatchView's Load button (via CustomEvent).
 // Centralised here because it owns batchResults state.
 const applyLoadedSession = useCallback((session: AlbumSession) => {
 setBatchResults(session.results)
 setBatchFolderName(session.folderName || null)
 setBatchInitialSession(session)
 setState('batch')
 setError(null)
 }, [])
 useEffect(() => {
 const handler = (e: Event) => {
 const detail = (e as CustomEvent).detail as AlbumSession | undefined
 if (detail) applyLoadedSession(detail)
 }
 window.addEventListener('rtm-load-album-session', handler)
 return () => window.removeEventListener('rtm-load-album-session', handler)
 }, [applyLoadedSession])

 // Release-cockpit hydration handler removed — that flow lives in FLOW.
 // Upload-page Load button — opens the picker, parses, hydrates state.
 const loadSessionFromUpload = useCallback(async () => {
 if (!window.electronAPI?.openTextFileDialog) return
 try {
 const picked = await window.electronAPI.openTextFileDialog([
 { name: 'RTM Album Session', extensions: ['json', 'rtmalbum'] },
 ])
 if (!picked) return
 const parsed = JSON.parse(picked.contents) as AlbumSession
 if (!parsed || !Array.isArray(parsed.results)) {
 setError('That file does not look like an RTM album session.')
 return
 }
 applyLoadedSession(parsed)
 } catch (err: any) {
 setError('Failed to load album session: ' + (err?.message || 'unknown error'))
 }
 }, [applyLoadedSession])

 // Version-history state — re-read the log after every write so the
 // upload screen's sidebar reflects the latest analysis without a reload.
 // `historyBump` is a nonce the analysis handlers increment on write.
 const [history, setHistory] = useState<HistoryEntry[]>([])
 const [historyBump, setHistoryBump] = useState(0)
 useEffect(() => {
 let cancelled = false
 ;(async () => {
 try {
 if (window.electronAPI?.historyRead) {
 const list = await window.electronAPI.historyRead()
 if (!cancelled) setHistory(list || [])
 }
 } catch {}
 })()
 return () => { cancelled = true }
 }, [historyBump])
 const [profile, setProfile] = useState('ohad')

 // ── Reference library (recent + saved favourites) ─────────────────────
 // Two lists:
 // - recentRefs: last 8 refs the user actually analysed (auto-pushed)
 // - savedRefs: user-starred "go-to" references with optional custom label
 interface RecentRef { path: string; name: string; lastUsed: number }
 interface SavedRef { path: string; name: string; label?: string; addedAt: number }
 const [recentRefs, setRecentRefs] = useState<RecentRef[]>(() => {
 try { return JSON.parse(localStorage.getItem('rtm-refs') || '[]') } catch { return [] }
 })
 const [savedRefs, setSavedRefs] = useState<SavedRef[]>(() => {
 try { return JSON.parse(localStorage.getItem('rtm-saved-refs') || '[]') } catch { return [] }
 })
 const pushRecentRef = useCallback((f: FileInfo) => {
 setRecentRefs(prev => {
 const filtered = prev.filter(r => r.path !== f.path)
 // Bump from 8 → 20 — enough for a label A&R workflow triaging demos.
 const next = [{ path: f.path, name: f.name, lastUsed: Date.now() }, ...filtered].slice(0, 20)
 try { localStorage.setItem('rtm-refs', JSON.stringify(next)) } catch {}
 return next
 })
 }, [])
 const removeRecentRef = useCallback((path: string) => {
 setRecentRefs(prev => {
 const next = prev.filter(r => r.path !== path)
 try { localStorage.setItem('rtm-refs', JSON.stringify(next)) } catch {}
 return next
 })
 }, [])
 const toggleSavedRef = useCallback((f: FileInfo, label?: string) => {
 setSavedRefs(prev => {
 const exists = prev.some(r => r.path === f.path)
 const next = exists
 ? prev.filter(r => r.path !== f.path)
 : [...prev, { path: f.path, name: f.name, label, addedAt: Date.now() }]
 try { localStorage.setItem('rtm-saved-refs', JSON.stringify(next)) } catch {}
 return next
 })
 }, [])
 const renameSavedRef = useCallback((path: string, label: string) => {
 setSavedRefs(prev => {
 const next = prev.map(r => r.path === path ? { ...r, label } : r)
 try { localStorage.setItem('rtm-saved-refs', JSON.stringify(next)) } catch {}
 return next
 })
 }, [])
 const isSaved = (path: string) => savedRefs.some(r => r.path === path)
 const [profiles, setProfiles] = useState<ProfileInfo[]>([{ id: 'ohad', name: 'Ohad Nissim' }])
 const [profileError, setProfileError] = useState<string | null>(null)

 const refreshProfiles = useCallback(async () => {
 try {
 if (window.electronAPI?.listProfiles) {
 const list = await window.electronAPI.listProfiles()
 if (list && list.length > 0) setProfiles(list)
 }
 } catch {}
 }, [])

 useEffect(() => { refreshProfiles() }, [refreshProfiles])

 const handleLoadProfile = useCallback(async () => {
 if (!window.electronAPI?.loadCustomProfile) return
 setProfileError(null)
 try {
 const added = await window.electronAPI.loadCustomProfile()
 if (added) {
 await refreshProfiles()
 setProfile(added.id)
 }
 } catch (err: any) {
 setProfileError(err?.message || 'Could not load profile')
 }
 }, [refreshProfiles])

 const handleDeleteProfile = useCallback(async (id: string) => {
 if (!window.electronAPI?.deleteCustomProfile) return
 await window.electronAPI.deleteCustomProfile(id)
 await refreshProfiles()
 if (profile === id) setProfile('ohad')
 }, [profile, refreshProfiles])

 // ── Version-history capture. Writes one entry per completed analysis
 // to ~/.rtm/history.json via IPC. Non-blocking — a failure here
 // never surfaces to the user because history is a nice-to-have, not
 // a hard dependency. Hashing is done in main process (fast, native).
 const appendHistory = useCallback(async (file: FileInfo, result: any, mode: HistoryEntry['mode'], refName?: string) => {
 if (!window.electronAPI?.getFileIdentity || !window.electronAPI?.historyAppend) return
 try {
 const id = await window.electronAPI.getFileIdentity(file.path)
 if (!id || id.error || !id.sha256) return
 // For compare mode `result` is the AnalysisResult; for ref-only it's
 // a slimmed object; we probe both shapes defensively.
 const lufs = result?.overall?.lufs_b ?? result?.reference_check?.stats?.lufs
 const tp = result?.headroom?.true_peak_b ?? result?.distortion?.true_peaks?.b_true_peak_db
 const lra = result?.overall?.dynamics_b ?? result?.reference_check?.stats?.dynamic_range
 const dur = result?.duration_sec_b ?? result?.duration_sec
 await window.electronAPI.historyAppend({
 sha256: id.sha256,
 name: file.name,
 path: file.path,
 ts: Date.now(),
 mode,
 ref_name: refName,
 lufs: typeof lufs === 'number' ? Math.round(lufs * 10) / 10 : undefined,
 true_peak: typeof tp === 'number' ? Math.round(tp * 10) / 10 : undefined,
 lra: typeof lra === 'number' ? Math.round(lra * 10) / 10 : undefined,
 duration_sec: typeof dur === 'number' ? Math.round(dur * 1000) / 1000 : undefined,
 spec_versions: result?.spec_versions,
 })
 // Trigger a re-fetch so the sidebar updates without a reload.
 setHistoryBump(b => b + 1)
 } catch { /* swallow — history is best-effort */ }
 }, [])

 const handleRefOnly = useCallback(async () => {
 if (!fileA) return
 setState('processing')
 setError(null)
 setProgress('Analyzing reference...')
 pushRecentRef(fileA)
 setBlind(false)

 // Capture unsubscribe so this run's listener doesn't outlive it —
 // without cleanup every subsequent analyze-files call stacked another
 // stale closure on the ipcRenderer.
 let unsubProgress: (() => void) | void = undefined
 try {
 if (window.electronAPI) {
 unsubProgress = window.electronAPI.onProgress((msg: string) => setProgress(msg)) || undefined
 const result = await window.electronAPI.analyzeFiles(fileA.path, fileA.path, true, profile)

 // If this was a multichannel / ADM file, backend returns
 // comparison_mode === 'atmos_solo'. Route to the full AnalysisView
 // (which hides stereo-compare panels when solo) instead of RefOnlyView.
 if (result.comparison_mode === 'atmos_solo') {
 // Synthesise a second "fileB" pointing to the same file so the
 // AnalysisView, ABPlayer, etc. continue to work — the view itself
 // hides stereo-only panels when comparison_mode === 'atmos_solo'.
 setFileB(fileA)
 setResults(result as any)
 setState('results')
 return
 }

 setRefOnlyResults({
 reference_check: result.reference_check,
 clicks: result.clicks || [],
 distortion: result.distortion,
 tonal_issues: result.tonal_issues || [],
 overall: result.overall,
 spectrum_a: result.spectrum_a,
 mid_spectrum_a: result.mid_spectrum_a,
 side_spectrum_a: result.side_spectrum_a,
 vectorscope_a: result.vectorscope_a,
 phase_over_time_a: result.phase_over_time_a,
 phase_bands_a: (result as any).phase_bands_a,
 mono_compat: result.mono_compat,
 duration_sec: result.duration_sec,
 waveform_a: result.waveform_a,
 engineer_tips: result.engineer_tips,
 masking: (result as any).masking,
 ai_detection: result.ai_detection,
 hum: (result as any).hum,
 transient_density: (result as any).transient_density,
 streaming_preview: (result as any).streaming_preview,
 lufs_over_time_b: result.lufs_over_time_b,
 // File-format metadata — lets RefOnlyView surface the Ready-to-
 // Deliver HOLD paths for SR/BD/channels and fill the ISRC slot.
 sample_rate: (result as any).metadata?.a?.sample_rate ?? null,
 bit_depth: (result as any).metadata?.a?.bit_depth ?? null,
 channels: (result as any).metadata?.a?.channels ?? null,
 isrc: (result as any).metadata?.a?.isrc
 ?? (result as any).metadata?.a?.ixml?.isrc
 ?? (result as any).metadata?.a?.id3?.isrc
 ?? null,
 clipped_samples: result.reference_check?.stats?.clip_count ?? null,
 // Extra pass-through so RefOnlyView can render Master
 // Assistant + Metadata editor + broadcast rows without
 // refetching. Keep the whole analysis result around so the
 // Master Assistant's proposer has everything it needs.
 metadata: (result as any).metadata || (result as any).metadata || null,
 headroom: (result as any).headroom,
 dialog_gate: (result as any).dialog_gate,
 limiter_artefacts: (result as any).limiter_artefacts,
 spec_versions: (result as any).spec_versions,
 adm_validation: (result as any).adm_validation,
 genre_a: (result as any).genre_a,
 atmos: (result as any).atmos,
 comparison_mode: (result as any).comparison_mode,
 // File-level warnings (SR/BD/length/container oddities). RefOnlyView
 // renders them in the header strip so the engineer sees them before
 // trusting the measurements.
 file_warnings: (result as any).file_warnings,
 full_result: result, // for Master Assistant's proposeMasterChain
 })
 setState('ref-only')
 appendHistory(fileA, result, 'ref-only')
 }
 } catch (err: any) {
 if (err?.cancelled || /cancelled/i.test(err?.message || '')) {
 setError(null)
 } else {
 setError(err.message || 'Analysis failed')
 }
 setState('upload')
 } finally {
 try { unsubProgress?.() } catch {}
 }
 // `profile` is a dep: stale closures were running the analysis
 // against the initial 'ohad' profile even after the user picked a
 // different one from the dropdown.
 }, [fileA, profile])

 const handleCompare = useCallback(async () => {
 if (!fileA || !fileB) return
 setState('processing')
 setError(null)
 setProgress(deepScan ? 'Starting AI stem separation...' : 'Starting analysis...')
 pushRecentRef(fileA)
 // Reset Blind A/B so a new comparison starts with labels visible.
 setBlind(false)

 let unsubProgress: (() => void) | void = undefined
 try {
 if (window.electronAPI) {
 unsubProgress = window.electronAPI.onProgress((msg: string) => setProgress(msg)) || undefined
 const result = await window.electronAPI.analyzeFiles(fileA.path, fileB.path, !deepScan, profile)
 setResults(result)
 setState('results')
 // Log the target (B) to local history — fires in the background.
 appendHistory(fileB, result, 'compare', fileA.name)
 } else {
 throw new Error('Run this app via Electron (npm run dev) to analyze real audio files.')
 }
 } catch (err: any) {
 if (err?.cancelled || /cancelled/i.test(err?.message || '')) {
 setError(null)
 } else {
 setError(err.message || 'Analysis failed')
 }
 setState('upload')
 } finally {
 try { unsubProgress?.() } catch {}
 }
 // Same fix as handleRefOnly: profile was captured stale from the
 // initial render, so compare analyses also ran against 'ohad' after
 // a dropdown change.
 }, [fileA, fileB, deepScan, profile])

 const handleCancelScan = useCallback(() => {
 try { window.electronAPI?.cancelAnalysis?.() } catch {}
 }, [])

 const handleReset = () => {
 setState('upload')
 setFileA(null)
 setFileB(null)
 setResults(null)
 setRefOnlyResults(null)
 setBatchResults(null)
 setBatchFolderName(null)
 setBatchInitialSession(null)
 setError(null)
 setNavOrigin('upload')
 }

 // ── Album / batch mode — pick a folder, analyse every audio file inside,
 // route to the BatchView when done. Per-file progress streams through
 // `onBatchProgress` so the progress bar shows "Analysing 3/12 · foo.wav".
 const handleBatch = useCallback(async () => {
 if (!window.electronAPI?.selectFolder || !window.electronAPI?.listAudioFiles || !window.electronAPI?.analyzeBatch) {
 setError('Batch mode requires the Electron host')
 return
 }
 try {
 const folder = await window.electronAPI.selectFolder()
 if (!folder) return
 const files = await window.electronAPI.listAudioFiles(folder)
 if (!files || files.length === 0) {
 setError('No audio files found in that folder (looking for wav / flac / aiff / mp3 / m4a / ogg).')
 return
 }
 setState('processing')
 setError(null)
 setProgress(`Batch · preparing ${files.length} track${files.length === 1 ? '' : 's'}…`)
 window.electronAPI.onBatchProgress?.((msg) => setProgress(msg.message))
 // Fast measurement-only batch — LUFS / TP / LRA / spectrum / ISRC for
 // every track. Deep single-file analyses (clicks, hum, distortion,
 // phase bands, BPM/key, streaming preview) run lazily on demand when
 // a song tab is opened, and are cached in `window.__rtmSongCache` so
 // re-opening the same song is instant. Users explicitly asked for
 // this: "users likes to see immidiate visuals. and sometimes not
 // even open a song for a deep analysis." The Python `--deep` path
 // stays in place (dormant) so we can re-enable pre-scanning later if
 // a different workflow needs it.
 const res = await window.electronAPI.analyzeBatch(files.map(f => f.path))
 setBatchResults(res.results)
 setBatchFolderName(folder.split(/[\\/]/).pop() || folder)
 // Fresh analysis — drop any previously-loaded session so the new
 // album doesn't inherit notes / tabs from a different run. Note
 // we intentionally do NOT wipe `__rtmSongCache`: it's keyed by
 // absolute file path, so a different folder never collides, and
 // the common case of re-opening the same album after a Back →
 // scan round-trip stays instant.
 setBatchInitialSession(null)
 setNavOrigin('upload')
 // Stash the absolute folder path on the window so BatchView's
 // Save-as-release button can find it without prop drilling through
 // unrelated components.
 ;(window as any).__rtmCurrentFolderPath = folder
 setState('batch')
 } catch (err: any) {
 setError(err?.message || 'Batch analysis failed')
 setState('upload')
 }
 }, [userMode])

 // Back from BatchView — in Label mode with a cockpit origin we return
 // to the cockpit (which is what the upload state now renders). Same
 // code path as handleReset; the mode branch decides what renders.
 const handleBatchBack = useCallback(() => {
 handleReset()
 }, [])

 const { theme, toggle: toggleTheme } = useTheme()
 const tour = useTourState()
 const analysisTour = useAnalysisTourState()
 const refOnlyTour = useRefOnlyTourState()
 const { setBlind } = useModes()

 // Tour button in the header dispatches to the right tour for the current screen.
 const onHeaderTourClick = useCallback(() => {
 if (state === 'results') {
 // Comparison results view — replay the per-tab walkthrough.
 analysisTour.startTour()
 } else if (state === 'ref-only') {
 // Single-file surface — replay the ref-only walkthrough.
 refOnlyTour.startTour()
 } else {
 // Upload / processing / batch: show the upload onboarding tour.
 tour.startTour()
 }
 }, [state, analysisTour, refOnlyTour, tour])

 // Cross-platform modifier key label — ⌘ on macOS, Ctrl on Windows/Linux.
 // navigator.platform is deprecated but still works across Electron versions;
 // navigator.userAgentData.platform is the modern fallback.
 const isMac = (() => {
 try {
 const ua: any = (navigator as any).userAgentData?.platform || navigator.platform || ''
 return /mac|iphone|ipad/i.test(String(ua))
 } catch { return true }
 })()
 const MOD = isMac ? '⌘' : 'Ctrl'
 const MINUS = isMac ? '−' : '-'

 // Detect multichannel file by extension heuristic (full check is done in Python).
 // We use a quick filename / extension cue so we can gate Deep Scan before analysis.
 const isProbablyAtmos = (f: FileInfo | null) => {
 if (!f) return false
 const name = f.name.toLowerCase()
 // .wav with 'atmos' / 'adm' / 'bwav' hints, or explicit ADM extensions
 return name.includes('atmos') || name.includes('adm') ||
 name.endsWith('.bwav') || name.endsWith('.rf64') ||
 (name.endsWith('.wav') && name.includes('7.1.4'))
 }
 const atmosLikely = isProbablyAtmos(fileA) || isProbablyAtmos(fileB)
 // Force fast mode when we detect an Atmos file — stems don't apply to multichannel.
 useEffect(() => {
 if (atmosLikely && deepScan) setDeepScan(false)
 }, [atmosLikely, deepScan])

 // ── UI zoom (persistent) ──────────────────────────────────────────────
 // Stored as a factor (0.85 – 1.5). Applied via CSS `zoom` on <html>, which
 // scales everything (including media queries for a proper responsive feel).
 const [zoom, setZoom] = useState<number>(() => {
 const raw = typeof window !== 'undefined' ? localStorage.getItem('rtm-zoom') : null
 const z = raw ? parseFloat(raw) : 1.0
 return isNaN(z) ? 1.0 : Math.max(0.85, Math.min(1.5, z))
 })
 useEffect(() => {
 // `zoom` is Chromium-only; Electron uses Chromium so it's safe here.
 document.documentElement.style.zoom = String(zoom)
 localStorage.setItem('rtm-zoom', String(zoom))
 }, [zoom])
 const zoomPct = Math.round(zoom * 100)
 const zoomIn = () => setZoom(z => Math.min(1.5, +(z + 0.05).toFixed(2)))
 const zoomOut = () => setZoom(z => Math.max(0.85, +(z - 0.05).toFixed(2)))
 const zoomReset = () => setZoom(1.0)

 // Keyboard shortcuts: Cmd/Ctrl + / -, Cmd/Ctrl + 0, Cmd/Ctrl + N
 useEffect(() => {
 const onKey = (e: KeyboardEvent) => {
 const mod = e.metaKey || e.ctrlKey
 if (!mod) return
 if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn() }
 else if (e.key === '-') { e.preventDefault(); zoomOut() }
 else if (e.key === '0') { e.preventDefault(); zoomReset() }
 else if (e.key === 'n' || e.key === 'N') {
 if (state === 'results' || state === 'ref-only' || state === 'batch') {
 e.preventDefault()
 handleReset()
 }
 }
 }
 window.addEventListener('keydown', onKey)
 return () => window.removeEventListener('keydown', onKey)
 }, [state])

 // ── Modes (educator + blind) come from ModesContext so toggling them
 // actually re-renders every panel that reads them.
 const { educator: educatorMode, blind: blindMode, toggleEducator, toggleBlind, surface, setSurface, advancedQc, toggleAdvancedQc } = useModes()
 const pluginDrop = usePluginDrop()


 return (
 <div className="min-h-screen bg-sand-950 transition-colors duration-300">
 {/*
 * Header — sticky titlebar.
 *
 * macOS + Electron + Kensington-driver note: the combination of
 * `-webkit-app-region: drag` + `backdrop-filter: blur` on the SAME
 * element is a known deadlock trigger on macOS with low-level
 * mouse drivers (Kensington Works, some Logitech / Razer builds).
 * The driver's cursor event tap stacks up behind the GPU blur
 * pass in the compositor and the pointer freezes. Electron
 * issue #24156 / #38624.
 *
 * Fix: drag-region and backdrop-blur live on DIFFERENT nodes.
 * A thin drag-strip sits at the top with zero filter; the main
 * header underneath gets the blur (but is no-drag). The two
 * stack visually as one bar but hit-test cleanly.
 *
 * We also drop `select-none` from the root — Kensington's
 * trackball select-to-drag gestures conflict with it, and we
 * never actually wanted global selection-off anyway (only UI
 * chrome components set `user-select: none` locally).
 */}
 {/* Zero-cost drag strip — 28 px tall, transparent, sits above the
 real header. This is where macOS registers the window drag. */}
 <div
 className="app-drag-region sticky top-0 z-40"
 style={{ height: 28, backgroundColor: 'transparent' }}
 aria-hidden
 />
 <header
 className="app-no-drag px-8 py-5 sticky z-30 backdrop-blur-md"
 style={{
 top: 28,
 backgroundColor: 'rgba(14,13,11,0.85)',
 borderBottom: '1px solid rgba(168,161,150,0.08)',
 }}
 >
 <div className="max-w-5xl mx-auto flex items-center justify-between">
 <div className="flex items-center gap-3 pl-16">
 <span className="text-lg font-light tracking-[0.05em]" style={{ color: '#ebe7e0' }}>RTMcompare</span>
 </div>
 <div className="flex items-center gap-4 app-no-drag">
 {/* Label-mode toggle removed — focusing on the engineer
 side for now. Code + Release Cockpit + LabelTour are
 preserved in the codebase for when Labels ships as its
 own module in the RTM Platform. See RTM Labels/ and
 RTM Platform/ARCHITECTURE.md for the plan. */}

 {/* Surface picker — controls which DSP profiles, panels,
 and delivery targets appear. Hobbyists pick `streaming`,
 pros pick `full`, broadcast / post engineers pick those.
 */}
 <div data-tour="surface-picker" className="flex items-center gap-0.5 px-0.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(87,83,78,0.18)' }}>
 {(['streaming', 'full', 'broadcast', 'netflix', 'post'] as const).map(s => (
 <button
 key={s}
 onClick={() => setSurface(s)}
 className="text-[9px] uppercase tracking-[0.12em] px-2 py-0.5 rounded-full transition-colors"
 style={{
 backgroundColor: surface === s ? 'rgba(208,176,102,0.18)' : 'transparent',
 color: surface === s ? '#d0b066' : '#8d867b',
 }}
 title={({
 streaming: 'Streaming-only (music / Social). Hides broadcast and Atmos.',
 full: 'Everything — pro music + broadcast + Atmos.',
 broadcast: 'Broadcast-first: R128 / A85 at top, dialog gate prominent.',
 netflix: 'Netflix delivery spec — −27 LKFS dialog anchor, −2 dBTP ceiling, stereo + 5.1 music/effects, strict codec.',
 post: 'Atmos / immersive: ADM validation surfaced, broadcast + music also visible.',
 } as Record<string, string>)[s]}
 >
 {s === 'streaming' ? 'Music' : s === 'full' ? 'Full' : s === 'broadcast' ? 'Bcast' : s === 'netflix' ? 'Netflix' : 'Post'}
 </button>
 ))}
 </div>

 {/* Advanced QC — unlocks Masking, Phase Bands, Transient
 Density, Waveform Diff, Tempo Drift. Off by default.
 Hidden in batch view because BatchView has no advanced
 panels wired (codex audit, frontend-gap report). When
 batch grows advanced surfaces, restore `state === 'batch'`. */}
 {(state === 'results' || state === 'ref-only') && (
 <button
 data-tour="advanced-qc"
 onClick={toggleAdvancedQc}
 className="text-[10px] px-2.5 py-1 rounded-full transition-colors"
 style={{
 backgroundColor: advancedQc ? 'rgba(124,164,163,0.15)' : 'rgba(87,83,78,0.18)',
 color: advancedQc ? '#7ca4a3' : '#8d867b',
 border: `1px solid ${advancedQc ? 'rgba(124,164,163,0.40)' : 'transparent'}`,
 }}
 title="Reveal collapsed-by-default diagnostic panels: masking, phase bands, transient density, waveform diff, tempo drift."
 >
 Advanced QC
 </button>
 )}

 {/* Educator mode — always available on every surface. The
 upload, batch, ref-only, results, and cockpit views all
 emit `why`-prop copy / educator banners that depend on
 this toggle, so the button must be reachable before the
 first analysis too (previously state-gated → dead educator
 block on upload). */}
 <button
 onClick={toggleEducator}
 className="text-[10px] px-2.5 py-1 rounded-full transition-colors"
 style={{
 backgroundColor: educatorMode ? 'rgba(111,163,126,0.15)' : 'rgba(87,83,78,0.18)',
 color: educatorMode ? '#6fa37e' : '#8d867b',
 border: `1px solid ${educatorMode ? 'rgba(111,163,126,0.40)' : 'transparent'}`,
 }}
 title="Reveal 'Why this matters' explainers on every panel"
 >
 Learn mode
 </button>

 {/* Blind test — only meaningful when comparing two DIFFERENT files */}
 {state === 'results' && fileA && fileB && fileA.path !== fileB.path && (
 <button
 onClick={toggleBlind}
 className="text-[10px] px-2.5 py-1 rounded-full transition-colors"
 style={{
 backgroundColor: blindMode ? 'rgba(208,176,102,0.15)' : 'rgba(87,83,78,0.18)',
 color: blindMode ? '#d0b066' : '#8d867b',
 border: `1px solid ${blindMode ? 'rgba(208,176,102,0.40)' : 'transparent'}`,
 }}
 title="Randomly swap which file is A vs B in the player and hide their names. Your pick reveals whether you guessed correctly."
 >
 Blind A/B
 </button>
 )}

 {/* Zoom controls */}
 <div className="flex items-center gap-1 px-2 py-1 rounded-full" style={{ backgroundColor: 'rgba(87,83,78,0.18)' }}>
 <button
 onClick={zoomOut}
 disabled={zoom <= 0.86}
 className="w-6 h-6 rounded-full flex items-center justify-center text-[13px] transition-colors disabled:opacity-30"
 style={{ color: '#a8a29e' }}
 title={`Zoom out (${MOD}${MINUS})`}
 >−</button>
 <button
 onClick={zoomReset}
 className="text-[10px] font-mono tabular-nums w-10 text-center transition-colors"
 style={{ color: zoom === 1.0 ? '#8d867b' : '#d0b066' }}
 title={`Reset zoom (${MOD}0)`}
 >{zoomPct}%</button>
 <button
 onClick={zoomIn}
 disabled={zoom >= 1.49}
 className="w-6 h-6 rounded-full flex items-center justify-center text-[13px] transition-colors disabled:opacity-30"
 style={{ color: '#a8a29e' }}
 title={`Zoom in (${MOD}+)`}
 >+</button>
 </div>

 {/* Discreet help / tour — a single ? glyph so the header stays
 quiet. Click dispatches to the right tour for the current
 screen (upload onboarding or per-tab analysis walkthrough). */}
 <button
 onClick={onHeaderTourClick}
 className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-white/[0.04]"
 style={{ color: '#8d867b' }}
 title={
 state === 'results' ? 'Replay the analysis walkthrough'
 : state === 'ref-only' ? 'Replay the single-file walkthrough'
 : 'Open the product tour'
 }
 aria-label="Product tour"
 >
 <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
 <circle cx="12" cy="12" r="9" />
 <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 9.5a2.5 2.5 0 115 0c0 1.5-2.5 2-2.5 3.5M12 17h.01" />
 </svg>
 </button>

 {/* Theme toggle */}
 <button
 onClick={toggleTheme}
 className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
 style={{ backgroundColor: 'rgba(87,83,78,0.2)' }}
 title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
 >
 {theme === 'dark' ? (
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#a8a29e" strokeWidth={2}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
 </svg>
 ) : (
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#57534e" strokeWidth={2}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
 </svg>
 )}
 </button>
 {(state === 'results' || state === 'ref-only' || state === 'batch') && (
 <button
 onClick={handleReset}
 className="inline-flex items-center gap-2 text-xs text-sand-500 hover:text-sand-200 transition-colors tracking-wide"
 title={`Start a new comparison (${MOD}N)`}
 >
 <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
 <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
 </svg>
 New comparison
 <kbd
 className="px-1 py-0.5 text-[9px] rounded"
 style={{ backgroundColor: 'rgba(87,83,78,0.25)', color: '#8d867b' }}
 >
 {MOD}N
 </kbd>
 </button>
 )}
 </div>
 </div>
 </header>

 <main className="max-w-5xl mx-auto px-8 py-6">
 {/* ReleaseCockpit removed — Label mode is shelved while we
 focus on the engineer side. The component + its tour + the
 releases store all remain in the codebase. */}

 {state === 'upload' && (
 <div className="space-y-6">
 <div className="text-center space-y-2">
 <h2 className="text-xl font-light tracking-[0.15em] uppercase" style={{ color: '#ebe7e0' }}>Analyze your audio</h2>
 <div className="max-w-2xl mx-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[12px]">
 <span className="text-sand-400"><span className="text-sand-200">One file</span> · QC any track.</span>
 <span className="text-sand-600">·</span>
 <span className="text-sand-400"><span className="text-sand-200">Two files</span> · level-matched A/B.</span>
 <span className="text-sand-600">·</span>
 <span className="text-sand-400"><span className="text-sand-200">Folder</span> · album / batch mode.</span>
 </div>
 </div>

 {/* Learn-mode explainer — surfaces on the upload surface when
 the user has Learn mode on. Gives new users the "why three
 workflows" framing before they pick one. */}
 {educatorMode && (
 <div
 className="rounded-lg px-4 py-3 text-[11px] leading-relaxed max-w-3xl mx-auto"
 style={{
 backgroundColor: 'rgba(111,163,126,0.08)',
 border: '1px solid rgba(111,163,126,0.25)',
 color: '#b5afa4',
 }}
 >
 <div className="text-[9px] uppercase tracking-[0.15em] mb-1.5" style={{ color: '#6fa37e' }}>
 Why three workflows
 </div>
 <p className="mb-1.5" style={{ color: '#d9d4c8' }}>
 RTM branches on what you drop. <strong>One file</strong> → single-file surface: verdict, attention list, A/B player, Master Assistant, Sound Check twin. Use it when you already have a mix and want to finish + ship. <strong>Two files</strong> → compare surface: every delta between the two files (spectrum, dynamics, stereo, phase, loudness, masking) on level-matched playback. Use it for mix revisions, ref tracks, or before-vs-after. <strong>Folder</strong> → batch / album surface: cohort consistency across every track. Use it for albums, EPs, label deliveries.
 </p>
 <p className="text-[10px] italic" style={{ color: '#8d867b' }}>
 Everything is level-matched to −18 LUFS integrated before comparison so a louder master doesn't fool your ears into thinking it's better. The RTM Send DAW plugin can also stream a bounce from Wavelab / Logic / Pro Tools / Studio One into the single-file surface; no export dialog.
 </p>
 </div>
 )}

 {/* Library shortcut strip — above the dropzones so it's
 discoverable but doesn't crowd them. Opens the modal with
 the picked slot pre-targeted. */}
 <div className="flex items-center justify-center gap-2 text-[11px]" style={{ color: '#8d867b' }}>
 <span>Load from library:</span>
 <button
 onClick={() => setLibraryTargetSlot('A')}
 className="px-3 py-1 rounded-full hover:bg-white/[0.04] transition-colors"
 style={{ color: '#d0b066', border: '1px solid rgba(208,176,102,0.3)' }}
 title="Pick a previously-analysed reference track for the Reference slot"
 >
 ← Reference
 </button>
 <button
 onClick={() => setLibraryTargetSlot('B')}
 className="px-3 py-1 rounded-full hover:bg-white/[0.04] transition-colors"
 style={{ color: '#d0b066', border: '1px solid rgba(208,176,102,0.3)' }}
 title="Pick a previously-analysed track for the Compare slot"
 >
 Compare →
 </button>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative" data-tour="dropzone">
 <FileDropZone
 label="Reference"
 hint="Demo, rough or your mix"
 file={fileA}
 onFile={setFileA}
 locked={lockFileA && !!fileA}
 onToggleLock={fileA ? () => setLockFileA(v => !v) : undefined}
 />
 <FileDropZone
 label="Compare"
 hint="Mix, new version, master or atmos file"
 file={fileB}
 onFile={setFileB}
 />
 {/* Mid-column swap button (only when both files loaded) */}
 {fileA && fileB && (
 <button
 onClick={() => { const a = fileA; setFileA(fileB); setFileB(a) }}
 className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110 hidden md:flex"
 style={{ backgroundColor: '#0e0d0b', border: '1px solid rgba(208,176,102,0.4)', color: '#d0b066', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}
 aria-label="Swap reference and compare files"
 title="Swap files"
 >
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
 </svg>
 </button>
 )}
 </div>

 {/* Clear-all button — below the dropzones when at least one is loaded.
 When the Reference slot is locked, Clear only wipes Compare so
 the pinned reference survives. */}
 {(fileA || fileB) && (
 <div className="flex items-center justify-center gap-3">
 <button
 onClick={() => {
 if (!lockFileA) setFileA(null)
 setFileB(null)
 }}
 className="text-[11px] px-3 py-1.5 rounded-full transition-colors"
 style={{ color: '#8d867b', border: '1px solid rgba(168,161,150,0.2)' }}
 title={lockFileA && fileA ? 'Clear Compare (Reference is locked)' : 'Clear both files'}
 >
 {lockFileA && fileA ? 'Clear Compare' : 'Clear all'}
 </button>
 </div>
 )}

 {/* ── Saved reference library (starred, persistent) ─────────── */}
 {savedRefs.length > 0 && !fileA && (
 <div className="space-y-2" data-tour="recent">
 <div className="flex items-center justify-between">
 <span className="text-[10px] uppercase tracking-[0.15em] text-sand-500">Saved references</span>
 <span className="text-[10px] text-sand-600">{savedRefs.length} starred · click to load into Reference slot</span>
 </div>
 <div className="flex flex-wrap gap-2">
 {savedRefs.map(r => (
 <div key={r.path} className="group flex items-center gap-1 text-[11px] rounded-full"
 style={{ backgroundColor: 'rgba(208,176,102,0.1)', border: '1px solid rgba(208,176,102,0.28)' }}
 >
 <span className="pl-2" style={{ color: '#d0b066' }}>★</span>
 <button
 onClick={() => setFileA({ path: r.path, name: r.name })}
 className="pl-1 py-1 hover:text-sand-100"
 style={{ color: '#e1d4a7' }}
 title={`${r.path}${r.label ? ` — ${r.label}` : ''}`}
 >
 {r.label || r.name.replace(/\.[^/.]+$/, '')}
 </button>
 <button
 onClick={() => {
 const newLabel = window.prompt('Label for this reference (leave blank for filename):', r.label || '')
 if (newLabel !== null) renameSavedRef(r.path, newLabel)
 }}
 className="pl-1 py-1 text-sand-500 opacity-0 group-hover:opacity-100 hover:text-sand-300"
 title="Rename"
 >✎</button>
 <button
 onClick={() => toggleSavedRef({ path: r.path, name: r.name })}
 className="pr-2 pl-1 py-1 text-sand-500 opacity-0 group-hover:opacity-100 hover:text-warm-red"
 title="Unstar"
 >×</button>
 </div>
 ))}
 </div>
 </div>
 )}

 {/* ── Recent references (last used) ─────────────────────────── */}
 {recentRefs.length > 0 && !fileA && (
 <div className="space-y-2" data-tour={savedRefs.length === 0 ? 'recent' : undefined}>
 <div className="flex items-center justify-between">
 <span className="text-[10px] uppercase tracking-[0.15em] text-sand-500">Recent references</span>
 <span className="text-[10px] text-sand-600">{recentRefs.length} · click ★ to save as go-to</span>
 </div>
 <div className="flex flex-wrap gap-2">
 {recentRefs.map(r => {
 const saved = isSaved(r.path)
 return (
 <div key={r.path} className="group flex items-center gap-1 text-[11px] rounded-full"
 style={{ backgroundColor: 'rgba(87,83,78,0.18)', border: '1px solid rgba(168,161,150,0.1)' }}
 >
 <button
 onClick={() => toggleSavedRef({ path: r.path, name: r.name })}
 className="pl-2 py-1"
 style={{ color: saved ? '#d0b066' : '#8d867b' }}
 title={saved ? 'Unstar' : 'Save as go-to reference'}
 >★</button>
 <button
 onClick={() => setFileA({ path: r.path, name: r.name })}
 className="pl-1 py-1 text-sand-300 hover:text-sand-100"
 title={r.path}
 >
 {r.name.replace(/\.[^/.]+$/, '')}
 </button>
 <button
 onClick={() => removeRecentRef(r.path)}
 className="pr-2 pl-1 py-1 text-sand-500 opacity-0 group-hover:opacity-100 hover:text-warm-red"
 title="Remove from recents"
 >×</button>
 </div>
 )
 })}
 </div>
 </div>
 )}

 {/* Version-history sidebar — local log of past analyses.
 Clicking an entry loads it as Reference A (or → B via the
 hover badge). Collapses entirely when the log is empty so
 first-run users don't see it. */}
 <RecentAnalyses
 history={history}
 onPick={(e, slot) => {
 const f: FileInfo = { path: e.path, name: e.name }
 if (slot === 'A') setFileA(f)
 else setFileB(f)
 }}
 onClear={async () => {
 try {
 await window.electronAPI?.historyClear?.()
 setHistoryBump(b => b + 1)
 } catch {}
 }}
 />

 {error && (
 <div className="rounded-xl p-4 text-sm text-center" style={{ backgroundColor: 'rgba(196,92,92,0.08)', color: '#c45c5c', border: '1px solid rgba(196,92,92,0.15)' }}>
 {error}
 </div>
 )}

 {/* Mode toggle — Deep Scan is disabled when an Atmos file is detected */}
 <div className="flex flex-col items-center gap-2" data-tour="scan-mode">
 <div className="flex items-center justify-center gap-3">
 <button
 onClick={() => setDeepScan(false)}
 className="px-4 py-2 rounded-lg text-xs transition-all"
 style={{
 backgroundColor: !deepScan ? 'rgba(197,165,90,0.15)' : 'transparent',
 color: !deepScan ? '#c5a55a' : '#8d867b',
 border: !deepScan ? '1px solid rgba(197,165,90,0.3)' : '1px solid transparent',
 fontWeight: !deepScan ? 500 : 400,
 }}
 >
 Fast · ~1 min
 </button>
 <button
 onClick={() => !atmosLikely && setDeepScan(true)}
 disabled={atmosLikely}
 className="px-4 py-2 rounded-lg text-xs transition-all"
 style={{
 backgroundColor: deepScan ? 'rgba(197,165,90,0.15)' : 'transparent',
 color: atmosLikely ? '#3e3a33' : (deepScan ? '#c5a55a' : '#8d867b'),
 border: deepScan ? '1px solid rgba(197,165,90,0.3)' : '1px solid transparent',
 fontWeight: deepScan ? 500 : 400,
 cursor: atmosLikely ? 'not-allowed' : 'pointer',
 opacity: atmosLikely ? 0.4 : 1,
 }}
 title={atmosLikely ? 'Deep Scan (stem separation) does not apply to multichannel / Atmos files' : undefined}
 >
 Deep Scan · AI stems · ~3-5 min
 </button>
 </div>
 {atmosLikely && (
 <p className="text-[10px] text-sand-500 italic">
 Deep Scan disabled — Atmos / multichannel analysis runs its own dedicated pipeline.
 </p>
 )}
 </div>

 {/* Engineer Profile Selector */}
 <div className="flex flex-col items-center gap-2" data-tour="profile">
 <div className="flex items-center justify-center gap-3">
 <span className="text-[11px] text-sand-600" title="An Engineer Profile is a target tonal curve + loudness + width stats. Picking one tells the Match panel what 'ideal' looks like — RTM then suggests EQ moves to get your track closer to it. You can use the shipped profiles, load a custom JSON, or skip profiles entirely (Match will fall back to the two-file spectrum diff).">Engineer Profile:</span>
 <div className="relative">
 <select
 value={profile}
 onChange={(e) => {
 if (e.target.value === '__load__') {
 handleLoadProfile()
 } else {
 setProfile(e.target.value)
 }
 }}
 className="appearance-none px-4 py-2 pr-8 rounded-lg text-xs bg-transparent cursor-pointer"
 style={{
 color: '#a8a29e',
 border: '1px solid rgba(87,83,78,0.4)',
 backgroundColor: 'rgba(28,26,23,0.8)',
 }}
 >
 {profiles.map(p => (
 <option key={p.id} value={p.id}>
 {/* Show the profile NAME itself for user-created profiles
 (was just "custom" previously — unhelpful). */}
 {p.name || p.id}{p.user_created ? ' ★' : ''}
 </option>
 ))}
 <option disabled>──────────</option>
 <option value="__load__">+ Load custom profile…</option>
 </select>
 <svg className="w-3 h-3 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="#57534e" strokeWidth={2}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
 </svg>
 </div>
 {profiles.find(p => p.id === profile)?.user_created && (
 <button
 onClick={() => handleDeleteProfile(profile)}
 className="text-[10px] px-2 py-1 rounded transition-colors"
 style={{ color: '#8d867b', border: '1px solid rgba(87,83,78,0.3)' }}
 title="Remove this custom profile"
 >
 remove
 </button>
 )}
 </div>
 {profiles.find(p => p.id === profile)?.description && (
 <p className="text-[10px] text-sand-500 italic max-w-md text-center">
 {profiles.find(p => p.id === profile)?.description}
 </p>
 )}
 {/* What a profile actually does — plain-language explainer
 that stays visible under the selector. " */}
 <p className="text-[10px] max-w-lg text-center" style={{ color: '#8d867b' }}>
 A profile is a target tonal curve + loudness + width stats.
 RTM's Match panel will propose EQ moves to get your track closer to it.
 Not sure which to pick? Any modern-pop profile works for most genres; swap later to taste.
 </p>
 {profile === 'off' && (
 <p className="text-[10px] text-center" style={{ color: '#8d867b' }}>
 No profile active — Match will use a two-file spectrum diff instead.
 </p>
 )}
 {profileError && (
 <p className="text-[10px]" style={{ color: '#c96765' }}>{profileError}</p>
 )}
 </div>

 <div className="flex flex-wrap items-center justify-center gap-3" data-tour="analyze">
 <button
 onMouseDown={dismissNativeTooltip}
 onClick={handleRefOnly}
 disabled={!fileA}
 className="px-5 py-2.5 rounded-xl text-sm transition-all"
 style={{
 backgroundColor: fileA ? 'rgba(107,140,187,0.15)' : 'rgba(51,48,44,0.3)',
 color: fileA ? '#6b8cbb' : '#8d867b',
 border: fileA ? '1px solid rgba(107,140,187,0.25)' : '1px solid transparent',
 opacity: fileA ? 1 : 0.4,
 cursor: fileA ? 'pointer' : 'not-allowed',
 }}
 >
 Analyze Reference Only
 </button>
 <button
 onMouseDown={dismissNativeTooltip}
 onClick={handleCompare}
 disabled={!fileA || !fileB}
 className="btn-primary"
 >
 Compare
 </button>
 {/* Album / batch mode — on the same CTA row so users see it
 without scrolling. Muted styling because comparison is the
 hero action; batch is a power-user shortcut. */}
 {window.electronAPI?.selectFolder && (
 <button
 onMouseDown={dismissNativeTooltip}
 onClick={handleBatch}
 data-tour="analyze-album"
 className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12px] transition-colors"
 style={{ color: '#8d867b', border: '1px solid rgba(168,161,150,0.15)' }}
 title="Drop a folder — get a sortable table with LUFS / TP / LRA / length / SR / BD / ISRC and outlier flags across the album."
 >
 <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 3h8a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
 </svg>
 Analyse an album
 </button>
 )}
 {/* Load a saved album session — the paired half of BatchView's
 Save button. Sits beside the batch CTA so users who left
 notes yesterday can jump back in without re-analysing. */}
 {window.electronAPI?.openTextFileDialog && (
 <button
 onMouseDown={dismissNativeTooltip}
 onClick={loadSessionFromUpload}
 data-tour="load-session"
 className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12px] transition-colors"
 style={{ color: '#8d867b', border: '1px solid rgba(168,161,150,0.15)' }}
 title="Re-open a previously-saved album batch session (.rtmalbum.json) — includes every analysis row, notes, and which song tabs were open."
 >
 <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h10l4 4v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z" />
 <path strokeLinecap="round" strokeLinejoin="round" d="M14 4v4h4" />
 </svg>
 Load album session
 </button>
 )}
 </div>

 <p className="text-center text-[10px] text-sand-600 italic">
 *For best Atmos analysis, use an ADM BWF file
 </p>
 </div>
 )}

 {state === 'processing' && (
 <ProgressBar message={progress} onCancel={handleCancelScan} />
 )}

 {/* Lazy boundaries — see imports above. The Suspense fallback is
 a tiny progress strip so the user has immediate feedback while
 the chunk downloads (typically <300 ms on first switch, instant
 on subsequent visits via Vite's chunk cache). */}
 {state === 'results' && results && (
 <Suspense fallback={<ProgressBar message="Loading compare view…" />}>
 <AnalysisView
 results={results}
 fileA={fileA!}
 fileB={fileB!}
 />
 </Suspense>
 )}

 {state === 'batch' && batchResults && (
 <Suspense fallback={<ProgressBar message="Loading batch view…" />}>
 <BatchView
 results={batchResults}
 folderName={batchFolderName || undefined}
 onBack={handleBatchBack}
 initialSession={batchInitialSession}
 />
 </Suspense>
 )}

 {state === 'ref-only' && refOnlyResults && (
 <Suspense fallback={<ProgressBar message="Loading single-file view…" />}>
 <RefOnlyView check={refOnlyResults} fileName={fileA!.name} filePath={fileA!.path} />
 </Suspense>
 )}
 </main>

 {/* Floating New Comparison CTA removed — docked into the header link
 instead. Bottega doesn't float buttons. */}

 {/* Onboarding tour — shows first-run welcome + spotlights the upload flow.
 The header "Tour" button can re-trigger it anytime via tour.startTour. */}
 {state === 'upload' && <OnboardingTour externalTour={tour} />}
 {/* Keyboard-shortcut legend — mounted at App level so `?` works
 everywhere (upload, batch, cockpit, single-file, compare) not
 just on the compare results screen. */}
 <ShortcutHelp />

 {/* Analysis tour — walks through each tab after first comparison.
 Auto-starts once (persisted in `rtm-analysis-tour-done`); the header
 Tour button can re-trigger it from the results screen at any time. */}
 {state === 'results' && (
 <AnalysisTour tour={analysisTour} autoStart={true} />
 )}

 {/* Single-file / reference-only tour — separate walkthrough tailored to
 the single-file surface (DAW origin banner, verdict, player, Master
 Assistant, Sound Check twin, metadata editor, Advanced QC + Learn).
 Auto-starts once (persisted in `rtm-refonly-tour-done`); replayable
 from the header Tour button on the ref-only view. */}
 {state === 'ref-only' && (
 <RefOnlyTour tour={refOnlyTour} autoStart={true} />
 )}

 {/* Send-to-RTM plugin receiver — floats a chip when the DAW
 plugin drops an audio bounce into ~/.rtm/incoming/. One
 click loads it into Reference or Compare. */}
 <RtmIncomingBanner
 onLoadInto={(slot, info, drop) => {
 console.log('[rtm] plugin drop -> slot', slot, 'path=', info.path)
 // Bug #1 fix: if plugin asks for Compare (File B) but no File A
 // is loaded yet, promote the drop to File A so the user has
 // something to analyse. Otherwise Compare stays disabled and
 // the user sees "nothing happen".
 if (slot === 'B' && !fileA) {
 console.log('[rtm] Compare route with no File A; promoting to File A')
 setFileA(info)
 pluginDrop.setSlot('A', drop?.meta ? { audioPath: info.path, ...drop.meta } : null)
 } else if (slot === 'A') {
 setFileA(info)
 pluginDrop.setSlot('A', drop?.meta ? { audioPath: info.path, ...drop.meta } : null)
 } else {
 setFileB(info)
 pluginDrop.setSlot('B', drop?.meta ? { audioPath: info.path, ...drop.meta } : null)
 }
 // Jump back to upload state if we're mid-results so the
 // new file lands cleanly.
 if (state === 'results' || state === 'ref-only') setState('upload')
 }}
 onSingleFileAnalysis={(info, drop) => {
 // Plugin asked for single-file analysis: load into slot A,
 // return to upload state, let the user hit Analyze. A visible
 // chip is ALSO shown (see RtmIncomingBanner.showAutoRouteToast)
 // so the user knows the plug-in drop succeeded.
 console.log('[rtm] plugin single-file route -> File A path=', info.path)
 setFileA(info)
 setFileB(null)
 pluginDrop.setSlot('single', drop?.meta ? { audioPath: info.path, ...drop.meta } : null)
 if (state !== 'upload') setState('upload')
 }}
 onBatch={(info, drop) => {
 // Plugin asked for Album / Batch routing. We can't append to an
 // active batch mid-session without user consent (and there is no
 // public batch-append API on BatchView right now), so we load the
 // file as File A and switch to the upload surface. The user clicks
 // "Analyze Album" to enter batch mode with this file as track 1.
 // The toast in RtmIncomingBanner spells this out so the user isn't
 // surprised that nothing was added to an existing batch.
 console.log('[rtm] plugin batch route -> seed File A, user starts batch path=', info.path)
 setFileA(info)
 pluginDrop.setSlot('A', drop?.meta ? { audioPath: info.path, ...drop.meta, routedAs: 'batch' } : null)
 if (state !== 'upload') setState('upload')
 }}
 />

 {/* Reference Library modal — always mounted so the open/close
 transition stays snappy. The target slot determines where
 the picked file lands. */}
 <ReferenceLibrary
 open={libraryTargetSlot !== null}
 onClose={() => setLibraryTargetSlot(null)}
 onPick={(info) => {
 if (libraryTargetSlot === 'A') setFileA(info)
 else if (libraryTargetSlot === 'B') setFileB(info)
 setLibraryTargetSlot(null)
 }}
 title={libraryTargetSlot === 'B' ? 'Pick a Compare track' : 'Pick a Reference'}
 />
 </div>
 )
}
