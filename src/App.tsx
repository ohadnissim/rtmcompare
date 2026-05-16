import React, { useState, useCallback, useEffect, useLayoutEffect, useRef, Suspense, lazy } from 'react'
import { getAudioDuration } from './lib/audioDuration'
import { AppState, FileInfo, AnalysisResult } from './types'
import { useTheme } from './ThemeContext'
import { useModes } from './ModesContext'
import { useV52Surface, useAudience } from './AudienceContext'
import HeaderV2 from './components/shell/HeaderV2'
import { LearnModeProvider, useLearnMode } from './context/LearnModeContext'
import LearnCenter from './components/learn/LearnCenter'
import LearnModeToggle from './components/shell/LearnModeToggle'
import GuidedFlowBar from './components/learn/GuidedFlowBar'
import StudentWorkspace from './components/learn/StudentWorkspace'
import EmptyStateV2 from './components/shell/EmptyStateV2'
import { buildMetricCells } from './lib/buildMetricCells'
import FileDropZone from './components/FileDropZone'
import ReferenceLibrary from './components/ReferenceLibrary'
import ReferenceDropdown from './components/ReferenceDropdown'
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
import ProfileDropdown from './components/ProfileDropdown'
import ErrorBoundary from './components/ErrorBoundary'

interface ProfileInfo {
 id: string
 name: string
 description?: string
 sample_count?: number
 user_created?: boolean
 profile_type?: 'fingerprint' | 'chain'
}

// Computed once at module scope — platform never changes mid-session and
// this avoids recalculating inside every render of the App component.
// navigator.userAgentData.platform is the modern API; navigator.platform
// is deprecated but still works in all Electron versions we target.
const isMac = (() => {
 try {
 const ua: any = (navigator as any).userAgentData?.platform || navigator.platform || ''
 return /mac|iphone|ipad/i.test(String(ua))
 } catch { return true }
})()
const MOD   = isMac ? '⌘' : 'Ctrl'
const MINUS = isMac ? '−' : '-'

declare global {
 interface Window {
 electronAPI?: {
 analyzeFiles: (fileA: string, fileB: string, fast?: boolean, profile?: string, chainProfile?: string) => Promise<AnalysisResult>
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
 ok: boolean
 error?: string
 results: import('./types').BatchResult[]
 /** Populated when options.deep = true. Keyed by absolute path;
 * each value is the full single-file AnalysisResult (same shape
 * analyze.py returns for ref-only mode), OR `{ __error: string }`
 * if the per-song deep run failed. */
 deep?: Record<string, any>
 spec_versions?: import('./types').SpecVersions
 }>
 onBatchProgress?: (callback: (msg: { message: string; index: number; total: number }) => void) => (() => void)
 listProfiles?: () => Promise<ProfileInfo[]>
 openProfilesFolder?: () => void
 onProfilesReady?: (cb: (profiles: ProfileInfo[]) => void) => () => void
 onProfileUrlOpened?: (cb: (profile: ProfileInfo) => void) => () => void
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
 // Learn Mode — Student Report PDF export
 generateStudentReport?: (payload: any) => Promise<{ ok: boolean; path?: string; error?: string }>
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
 /** RTMcertify — generate a signed pre-delivery compliance certificate. */
 rtmCertify?: (fileA: string, fileB: string) => Promise<{
 certificate_id: string
 file_a: string
 file_b: string
 analysis: {
 lufs_i?: number | null
 true_peak_dbtp?: number | null
 lra?: number | null
 mono_compat_pct?: number | null
 tonal_deviation?: number | null
 generation_loss_probability?: number | null
 }
 compliance: { streaming_ready: boolean; generation_loss_ok: boolean }
 sha256_a: string
 sha256_b: string
 hmac_sha256: string
 timestamp: string
 error?: string
 }>
 /** Share as HTML — save a self-contained static HTML report. */
 shareAsHtml?: (payload: { title: string; reportJson: string }) => Promise<{ success: boolean; filePath?: string }>
 // RTMsend bridge
 rtmsendStatus?: () => Promise<{
   running: boolean
   loaded?: { name: string; parameter_count: number } | null
   profile?: any
   supported_plugins?: string[]
 }>
 rtmsendSendEq?: (bands: { region: string; freq_hz: number; gain_db: number; q: number }[]) => Promise<any>
 rtmsendKnowledgeList?: () => Promise<any[]>
 rtmsendKnowledgeCapture?: () => Promise<any>
 rtmsendKnowledgeRecapture?: () => Promise<any>
 rtmsendKnowledgeReadme?: () => Promise<{ path: string; plugins: number }>
 rtmsendBestPluginForMove?: (band: { region: string; freq_hz: number; gain_db: number; q: number }) => Promise<any>
 rtmsendBestPluginsForBands?: (bands: { region: string; freq_hz: number; gain_db: number; q: number }[]) => Promise<{
   per_band: any[]
   best_overall: any | null
 }>
 // Canvas LMS / Learn Mode
 canvasTestConnection?: () => Promise<{ ok: boolean; courseName?: string; error?: string }>
 canvasGetAssignments?: () => Promise<{ ok: boolean; assignments?: any[]; error?: string }>
 canvasUploadGrades?: (payload: { assignmentId: string; grades: Array<{ studentId: string; studentName: string; score: number; totalPossible: number }> }) => Promise<{ ok: boolean; submitted?: number; skipped?: number; rejected?: number; total?: number; error?: string }>
 saveLmsConfig?: (config: { baseUrl: string; apiToken: string; courseId: string; assignmentName?: string }) => Promise<{ ok: boolean; error?: string }>
 loadLmsConfig?: () => Promise<{ ok: boolean; config?: { baseUrl: string; courseId: string; assignmentName: string; hasToken: boolean } | null; error?: string }>
 clearLmsConfig?: () => Promise<{ ok: boolean; error?: string }>
 saveStudentFeedback?: (reportPath: string, feedback: string) => Promise<{ ok: boolean; error?: string }>
 scanClassFolder?: (folderPath: string) => Promise<{ ok: boolean; records?: any[]; count?: number; error?: string }>
 exportGradebookCsv?: (records: any[]) => Promise<{ ok: boolean; path?: string; error?: string }>
 // Ozone preset bridge — detect installed versions and install directly
 ozoneDetect?: () => Promise<{ found: boolean; installations: { name: string; version: string }[] }>
 ozoneInstallPreset?: (xml: string, fileName: string) => Promise<{
  ok: boolean
  results: { version: string; path?: string; error?: string }[]
  revealPath?: string
  error?: string
 }>
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
/** Wrap a Promise with a 5-minute timeout.
 * Throws an Error with `message` if the promise doesn't resolve in time.
 * This guards against the Python daemon silently hanging — without it the
 * UI stays on the processing screen forever with no feedback or recovery.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  const timer = new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error(message)), ms)
  )
  timer.catch(() => {}) // suppress unhandled rejection if promise settles first
  return Promise.race([promise, timer])
}

function debounce<T extends (...args: any[]) => void>(fn: T, wait: number): T {
  let id: ReturnType<typeof setTimeout> | undefined
  return ((...args: Parameters<T>) => {
    if (id !== undefined) clearTimeout(id)
    id = setTimeout(() => fn(...args), wait)
  }) as T
}

function dismissNativeTooltip(e: React.MouseEvent<HTMLElement>) {
 try {
 const el = e.currentTarget as HTMLElement
 el.removeAttribute('title')
 el.blur()
 } catch {}
}

/**
 * CoverWiredEmptyState — thin wrapper that pulls course/assignment from
 * LearnModeContext and forwards file metadata + drop/swap/openRecent
 * handlers to EmptyStateV2. Lives inside <LearnModeProvider> so it can
 * call useLearnMode(); App itself is the provider parent and cannot.
 *
 * Derives `format` from the filename extension (uppercased). Duration
 * is intentionally undefined — decoding audio just to label the cover
 * isn't worth the cost; the slot copy degrades to em-dash.
 */
interface CoverWiredEmptyStateProps {
 canBegin: boolean
 onBegin: () => void
 onBeginCompare?: () => void
 onBeginRefOnly?: () => void
 onBatch?: () => void
 recents: HistoryEntry[]
 onOpenRecents: () => void
 onClearRecents?: () => void
 onTour?: () => void
 error?: string | null
 fileA: FileInfo | null
 fileB: FileInfo | null
 setFileA: (f: FileInfo | null) => void
 setFileB: (f: FileInfo | null) => void
 history: HistoryEntry[]
 profileName?: string
 onProfileNameChange?: (name: string) => void
 controls?: React.ReactNode
 children?: React.ReactNode
 onClearA?: () => void
 onClearB?: () => void
}
function CoverWiredEmptyState({
 canBegin, onBegin, onBeginCompare, onBeginRefOnly, onBatch, recents, onOpenRecents, onClearRecents, onTour, error,
 fileA, fileB, setFileA, setFileB, history, profileName, onProfileNameChange, controls, children, onClearA, onClearB,
}: CoverWiredEmptyStateProps) {
 const learn = useLearnMode()
 const assignment = learn.assignment
 // When the v52 CoverSurface is active it renders its own FileSlot drop areas.
 // Passing FileDropZone children would duplicate the drop UI ("double window").
 // Gate legacy-only children behind this flag.
 const useV52Cover = useV52Surface('cover')
 const [fileADuration, setFileADuration] = useState<string | undefined>(undefined)
 const [fileBDuration, setFileBDuration] = useState<string | undefined>(undefined)
 const extOf = (name?: string | null) => {
  if (!name) return undefined
  const parts = name.split('.')
  if (parts.length < 2) return undefined
  return parts.pop()!.toUpperCase()
 }
 const adoptFile = (slot: 'A' | 'B') => (file: File) => {
  // Mirror FileDropZone path-resolution: Electron 32+ requires webUtils.getPathForFile.
  const fullPath = window.electronAPI?.getPathForFile?.(file) || (file as any).path || ''
  if (!fullPath) return
  const info: FileInfo = { path: fullPath, name: file.name }
  if (slot === 'A') {
   setFileA(info)
   getAudioDuration(file).then(d => setFileADuration(d ?? undefined))
  } else {
   setFileB(info)
   getAudioDuration(file).then(d => setFileBDuration(d ?? undefined))
  }
 }
 // Browse via Electron native file dialog for each slot.
 const browseFile = (slot: 'A' | 'B') => async () => {
  const filePath = await window.electronAPI?.selectFile?.()
  if (!filePath) return
  const name = filePath.split('/').pop() ?? filePath
  const info: FileInfo = { path: filePath, name }
  if (slot === 'A') setFileA(info)
  else setFileB(info)
 }
 const onOpenRecent = (id: string) => {
  // CoverSurface emits the recent's `id`, which we set to HistoryEntry.path
  // when projecting v52Recents below. Match on path; fall back to name.
  const entry = history.find(h => h.path === id) ?? history.find(h => h.name === id)
  if (!entry) return
  const info: FileInfo = { path: entry.path, name: entry.name }
  // Default behaviour mirrors RecentAnalyses → 'A' slot (the more common
  // "open this as my reference" intent). The user can swap from the cover.
  setFileA(info)
 }
 const v52Recents = history.slice(0, 3).map(r => ({
  id: r.id ?? (r.path ?? r.name ?? ''),
  title: r.name ?? '',
  ts: undefined as string | undefined,
 }))
 return (
  <EmptyStateV2
   canBegin={canBegin}
   onBegin={onBegin}
   onBeginCompare={onBeginCompare}
   onBeginRefOnly={onBeginRefOnly}
   onBatch={onBatch}
   recents={recents}
   onOpenRecents={onOpenRecents}
   error={error}
   fileAName={fileA?.name ?? null}
   fileAFormat={extOf(fileA?.name)}
   fileADuration={fileADuration}
   fileBName={fileB?.name ?? null}
   fileBFormat={extOf(fileB?.name)}
   fileBDuration={fileBDuration}
   onDropA={adoptFile('A')}
   onDropB={adoptFile('B')}
   onBrowseA={browseFile('A')}
   onBrowseB={browseFile('B')}
   onClearA={onClearA}
   onClearB={onClearB}
   onSwap={() => { const a = fileA; setFileA(fileB); setFileB(a) }}
   v52Recents={v52Recents}
   onOpenRecent={onOpenRecent}
   onClearRecents={onClearRecents}
   onTour={onTour}
   profileName={profileName}
   onProfileNameChange={onProfileNameChange}
   courseName={assignment?.course}
   assignmentName={assignment?.title}
   sessionCount={history.length}
   controls={controls}
  >
   {children}
  </EmptyStateV2>
 )
}

export default function App() {
 const goldBudget = useV52Surface('gold-budget')
 const useV52Cover = useV52Surface('cover')
 const audience = useAudience()
 const showLearnCenter = useV52Surface('learn') && (audience === 'student' || audience === 'teacher')
 const [state, setState] = useState<AppState>('upload')
 const [fileA, setFileA] = useState<FileInfo | null>(null)
 const [fileB, setFileB] = useState<FileInfo | null>(null)
 // Which slot the Reference Library modal will drop the picked track into.
 // null = modal closed.
 const [libraryTargetSlot, setLibraryTargetSlot] = useState<'A' | 'B' | null>(null)
 const [progress, setProgress] = useState('')
 const [results, setResults] = useState<AnalysisResult | null>(null)
 const [error, setError] = useState<string | null>(null)
 // RTMcertify state — signed pre-delivery compliance certificate
 const [certifyResult, setCertifyResult] = useState<{
  certificate_id?: string; file_a?: string; file_b?: string;
  sha256_a?: string; sha256_b?: string; hmac_sha256?: string;
  timestamp?: string; error?: string;
  analysis?: Record<string, number | null | undefined>;
  compliance?: Record<string, boolean>;
} | null>(null)
 const [certifying, setCertifying] = useState(false)
 // Inline toast for certify Copy / Save actions — clears after 2s so
 // the user gets confirmation instead of a silent no-op.
 const [certifyToast, setCertifyToast] = useState<string | null>(null)
 useEffect(() => {
 if (!certifyToast) return
 const id = window.setTimeout(() => setCertifyToast(null), 2000)
 return () => window.clearTimeout(id)
 }, [certifyToast])
 // Transient "scan cancelled" toast. Distinct from `error` so timeouts
 // (which set `error`) and cancellations (which set this) don't blur
 // into the same UX state. Auto-clears after 3s.
 const [cancelMessage, setCancelMessage] = useState<string | null>(null)
 useEffect(() => {
   if (!cancelMessage) return
   const t = setTimeout(() => setCancelMessage(null), 3000)
   return () => clearTimeout(t)
 }, [cancelMessage])
 // Pending plug-in incoming drop while a results / ref-only view is on
 // screen. Holds the drop until the user explicitly chooses Replace or
 // Keep current. Shape: { slot, info, drop } — same args RtmIncomingBanner
 // already passes to onLoadInto.
 type PendingIncoming = {
   slot: 'A' | 'B'
   info: FileInfo
   drop: any // eslint-disable-line @typescript-eslint/no-explicit-any
 }
 // FIFO queue. The chip shows the first entry; subsequent drops wait
 // their turn so a second plugin send never silently overwrites the
 // first. Drains via Replace / Keep current.
 const [pendingQueue, setPendingQueue] = useState<PendingIncoming[]>([])
 const [refOnlyResults, setRefOnlyResults] = useState<any>(null) // eslint-disable-line @typescript-eslint/no-explicit-any
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
 // 5.2.3: genre_a removed
 atmos: result.atmos,
 comparison_mode: result.comparison_mode,
 song_info: result.song_info,
 generation_loss: (result as any).generation_loss,
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
 let parsed: AlbumSession
 try {
 parsed = JSON.parse(picked.contents) as AlbumSession
 } catch {
 setError('That file does not look like an RTM album session (JSON parse error).')
 return
 }
 if (!parsed || !Array.isArray(parsed.results)) {
 setError('That file does not look like an RTM album session.')
 return
 }
 // 5.3.0 protocol check — tolerant additive: unknown extra fields
 // are kept; missing required fields are caught above; a higher
 // version warns but still loads (forward-compat by default).
 // See docs/protocol.md.
 const v = (parsed as any).version
 if (typeof v === 'number' && v > 1) {
 console.warn(`[rtmalbum] file is version ${v}, this build understands version 1. Loading anyway; some fields may be ignored.`)
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
 const [profile, setProfile] = useState<string>(() => {
   try { return localStorage.getItem('rtm-profile') ?? '' } catch { return '' }
 })
 const [chainProfile, setChainProfile] = useState<string>(() => {
   try { return localStorage.getItem('rtm-chain-profile') ?? '' } catch { return '' }
 })
 // Engineer display name — shown in the "Hi, {name}" greeting on the cover.
 // Persisted to localStorage so it survives restarts.
 const [engineerName, setEngineerName] = useState<string>(() => {
   try { return localStorage.getItem('rtm-engineer-name') ?? '' } catch { return '' }
 })
 const handleEngineerNameChange = useCallback((name: string) => {
   setEngineerName(name)
   try { localStorage.setItem('rtm-engineer-name', name) } catch {}
 }, [])

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
 const [profiles, setProfiles] = useState<ProfileInfo[]>([])
 const [profileError, setProfileError] = useState<string | null>(null)

 const refreshProfiles = useCallback(async () => {
   try {
     const list = await window.electronAPI?.listProfiles?.()
     if (Array.isArray(list)) {
       setProfiles(list)
       if (list.length === 0) {
         setProfileError('No profiles found — try reinstalling or contact support.')
       } else {
         setProfileError(null)
       }
     }
   } catch (e) {
     console.error('[profiles] load failed', e)
     setProfileError('Could not load profiles — check installation.')
   }
 }, [])

 useEffect(() => {
   // Pull once on mount
   refreshProfiles()
   // Also subscribe to the push event from main process (fired on ready-to-show)
   const unsub = window.electronAPI?.onProfilesReady?.((list) => {
     if (Array.isArray(list) && list.length > 0) setProfiles(list)
   })
   return () => unsub?.()
 }, [refreshProfiles])

 // Handle rtmcompare://profile?path=... URL opens from RTMprofile.
 // Main process installs the profile and sends this event; we refresh
 // the list and switch to the new profile so the user lands on it.
 useEffect(() => {
   const unsub = window.electronAPI?.onProfileUrlOpened?.((profileInfo) => {
     if (!profileInfo?.id) return
     refreshProfiles().then(() => {
       setProfile(profileInfo.id)
       try { localStorage.setItem('rtm-profile', profileInfo.id) } catch {}
     })
   })
   return () => unsub?.()
 }, [refreshProfiles])

 // Auto-select profiles once the list loads.
 // - If localStorage has a saved id that exists in the list, restore it.
 // - If nothing was ever saved, pick the first available profile so the
 //   dropdown visual matches what actually gets passed to the analysis.
 useEffect(() => {
   if (profiles.length === 0) return

   const fingerprintProfiles = profiles.filter(p => !p.profile_type || p.profile_type === 'fingerprint')
   // Use the `profile` state value (already read from localStorage on mount) — avoids a second localStorage read.
   const savedProfile = profile
   // MED-4: check ALL profiles for the saved ID so a mis-typed profile_type doesn't lose the selection
   const savedExists = savedProfile && profiles.some(p => p.id === savedProfile)
   if (savedExists) {
     setProfile(savedProfile)
   } else if (!savedProfile && fingerprintProfiles.length > 0) {
     const first = fingerprintProfiles[0].id
     setProfile(first)
     try { localStorage.setItem('rtm-profile', first) } catch {}
   }

   const chainProfiles = profiles.filter(p => p.profile_type === 'chain')
   const savedChain = (() => { try { return localStorage.getItem('rtm-chain-profile') ?? '' } catch { return '' } })()
   if (savedChain && chainProfiles.some(p => p.id === savedChain)) {
     setChainProfile(savedChain)
   } else if (!savedChain && chainProfiles.length > 0) {
     const first = chainProfiles[0].id
     setChainProfile(first)
     try { localStorage.setItem('rtm-chain-profile', first) } catch {}
   }
 }, [profiles])

 const handleLoadProfile = useCallback(async () => {
 if (!window.electronAPI?.loadCustomProfile) return
 setProfileError(null)
 try {
 const added = await window.electronAPI.loadCustomProfile()
 if (added) {
 await refreshProfiles()
 setProfile(added.id)
 // MED-5: persist so the selection survives reboot
 try { localStorage.setItem('rtm-profile', added.id) } catch {}
 }
 } catch (err: any) {
 setProfileError(err?.message || 'Could not load profile')
 }
 }, [refreshProfiles])

 const handleLoadChainProfile = useCallback(async () => {
 if (!window.electronAPI?.loadCustomProfile) return
 try {
 const added = await window.electronAPI.loadCustomProfile()
 if (added) {
 await refreshProfiles()
 setChainProfile(added.id)
 try { localStorage.setItem('rtm-chain-profile', added.id) } catch {}
 }
 } catch { /* silent */ }
 }, [refreshProfiles])

 const handleDeleteProfile = useCallback(async (id: string) => {
 if (!window.electronAPI?.deleteCustomProfile) return
 await window.electronAPI.deleteCustomProfile(id)
 await refreshProfiles()
 if (profile === id) setProfile('')
 if (chainProfile === id) { setChainProfile(''); try { localStorage.setItem('rtm-chain-profile', '') } catch {} }
 }, [profile, chainProfile, refreshProfiles])

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

 // CRIT-4: in-flight guard. Spam-clicking Analyze (or Ref-only) before React
 // flushes setState('processing') used to fire handleCompare multiple times,
 // each spawning a fresh Python subprocess. Each spawn overwrote activeProc
 // in python-bridge, so cancellation only killed the last one; the earlier
 // runs raced stdout into the same result handler.
 const analysisInFlight = useRef(false)
 // CRIT-9: focus management — focus the results heading after analysis
 const resultsHeadingRef = useRef<HTMLHeadingElement>(null)
 const focusResults = useCallback(() => {
   setTimeout(() => resultsHeadingRef.current?.focus(), 80)
 }, [])

 const handleRefOnly = useCallback(async () => {
 if (!fileA) return
 if (analysisInFlight.current) return  // CRIT-4: drop the extra click
 analysisInFlight.current = true
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
 unsubProgress = window.electronAPI.onProgress(debounce((msg: string) => setProgress(msg), 16)) || undefined
 const result = await withTimeout(
  window.electronAPI.analyzeFiles(fileA.path, fileA.path, true, profile, chainProfile),
  5 * 60 * 1000,
  'Analysis timed out after 5 minutes. The audio file may be too large or the backend may have hung — please try again.'
 )

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
 focusResults()
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
 metadata: (result as any).metadata || null,
 headroom: (result as any).headroom,
 dialog_gate: (result as any).dialog_gate,
 limiter_artefacts: (result as any).limiter_artefacts,
 spec_versions: (result as any).spec_versions,
 adm_validation: (result as any).adm_validation,
 // 5.2.3: genre_a removed
 atmos: (result as any).atmos,
 comparison_mode: (result as any).comparison_mode,
 // File-level warnings (SR/BD/length/container oddities). RefOnlyView
 // renders them in the header strip so the engineer sees them before
 // trusting the measurements.
 file_warnings: (result as any).file_warnings,
 generation_loss: (result as any).generation_loss,
 full_result: result, // for Master Assistant's proposeMasterChain
 })
 setState('ref-only')
 focusResults()
 appendHistory(fileA, result, 'ref-only')
 }
 } catch (err: any) {
 if (/timed out/i.test(err?.message || '')) {
   try { window.electronAPI?.cancelAnalysis?.() } catch {}
 }
 if (err?.cancelled || /cancelled/i.test(err?.message || '')) {
 setError(null)
 setCancelMessage('Scan cancelled')
 } else {
 setError(err.message || 'Analysis failed')
 }
 setState('upload')
 } finally {
 try { unsubProgress?.() } catch {}
 analysisInFlight.current = false  // CRIT-4: release the in-flight lock
 }
 // `profile` is a dep: stale closures were running the analysis
 // against the initial 'ohad' profile even after the user picked a
 // different one from the dropdown.
 }, [fileA, profile, chainProfile])

 const handleCompare = useCallback(async () => {
 if (!fileA || !fileB) return
 if (analysisInFlight.current) return  // CRIT-4: drop the extra click
 analysisInFlight.current = true
 setState('processing')
 setError(null)
 setProgress('Starting analysis...')
 pushRecentRef(fileA)
 // Reset Blind A/B so a new comparison starts with labels visible.
 setBlind(false)

 let unsubProgress: (() => void) | void = undefined
 try {
 if (window.electronAPI) {
 unsubProgress = window.electronAPI.onProgress(debounce((msg: string) => setProgress(msg), 16)) || undefined
 const result = await withTimeout(
  window.electronAPI.analyzeFiles(fileA.path, fileB.path, true, profile, chainProfile),
  5 * 60 * 1000,
  'Analysis timed out after 5 minutes. The audio file may be too large or the backend may have hung — please try again.'
 )
 setResults(result)
 setState('results')
 focusResults()
 // Log the reference (A) to local history — fires in the background.
 appendHistory(fileA, result, 'compare', fileB.name)
 } else {
 throw new Error('Run this app via Electron (npm run dev) to analyze real audio files.')
 }
 } catch (err: any) {
 if (/timed out/i.test(err?.message || '')) {
   try { window.electronAPI?.cancelAnalysis?.() } catch {}
 }
 if (err?.cancelled || /cancelled/i.test(err?.message || '')) {
 setError(null)
 setCancelMessage('Scan cancelled')
 } else {
 setError(err.message || 'Analysis failed')
 }
 setState('upload')
 } finally {
 try { unsubProgress?.() } catch {}
 analysisInFlight.current = false  // CRIT-4: release the in-flight lock
 }
 // Same fix as handleRefOnly: profile was captured stale from the
 // initial render, so compare analyses also ran against 'ohad' after
 // a dropdown change.
 }, [fileA, fileB, profile, chainProfile])

 const handleCancelScan = useCallback(() => {
 try { window.electronAPI?.cancelAnalysis?.() } catch {}
 }, [])

 const handleReset = useCallback(() => {
 setState('upload')
 setFileA(null)
 setFileB(null)
 setResults(null)
 setRefOnlyResults(null)
 setBatchResults(null)
 setBatchFolderName(null)
 setBatchInitialSession(null)
 setError(null)
 setCertifyResult(null)
 setNavOrigin('upload')
 }, [])

 // ── RTMcertify — signed pre-delivery compliance certificate ────────────
 const handleCertify = useCallback(async () => {
 if (!fileA || !fileB || !window.electronAPI?.rtmCertify) return
 setCertifying(true)
 setCertifyResult(null)
 try {
 const cert = await window.electronAPI.rtmCertify(fileA.path, fileB.path)
 setCertifyResult(cert)
 } catch (e: any) {
 setCertifyResult({ error: e?.message || 'Certificate generation failed' })
 } finally {
 setCertifying(false)
 }
 }, [fileA, fileB])

 // Listen for 'rtm-certify-trigger' dispatched by the ✦ Certify button in
 // AnalysisView so we don't need to thread handleCertify as a prop.
 useEffect(() => {
 const handler = () => { handleCertify() }
 window.addEventListener('rtm-certify-trigger', handler)
 return () => window.removeEventListener('rtm-certify-trigger', handler)
 }, [handleCertify])

 // ── Album / batch mode — pick a folder, analyse every audio file inside,
 // route to the BatchView when done. Per-file progress streams through
 // `onBatchProgress` so the progress bar shows "Analysing 3/12 · foo.wav".
 const handleBatch = useCallback(async () => {
 if (!window.electronAPI?.selectFolder || !window.electronAPI?.listAudioFiles || !window.electronAPI?.analyzeBatch) {
 setError('Batch mode requires the Electron host')
 return
 }
 // CRIT-2: in-flight guard — same pattern as handleCompare / handleRefOnly.
 // Without this, spam-clicking "Analyze Batch" before setState('processing')
 // flushes spawns multiple Python subprocesses, each overwriting activeProc
 // so only the last is cancellable and results race into the same handler.
 if (analysisInFlight.current) return
 analysisInFlight.current = true
 let unsubBatchProgress: (() => void) | undefined
 try {
 const folder = await window.electronAPI.selectFolder()
 if (!folder) return
 // Flip into processing immediately — `listAudioFiles` walks the
 // directory tree synchronously and on a large folder it can stall
 // for several seconds. Without this the upload page hangs with no
 // feedback after the picker closes.
 setState('processing')
 setError(null)
 setProgress('Scanning folder…')
 const folderBase = folder.split(/[\\/]/).pop() || folder
 const files = await window.electronAPI.listAudioFiles(folder)
 if (!files || files.length === 0) {
 setError(`No audio files in "${folderBase}" — looked for wav/flac/aiff/mp3/m4a/ogg.`)
 setState('upload')
 return
 }
 setProgress(`Batch · preparing ${files.length} track${files.length === 1 ? '' : 's'}…`)
 unsubBatchProgress = window.electronAPI.onBatchProgress?.((msg) => setProgress(msg.message))
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
 unsubBatchProgress?.()
 if (!res.ok) throw new Error(res.error || 'Batch analysis failed')
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
 focusResults()
 } catch (err: any) {
 unsubBatchProgress?.()
 setError(err?.message || 'Batch analysis failed')
 setState('upload')
 } finally {
 analysisInFlight.current = false
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

 // MOD / MINUS are computed at module scope above the component.

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
 }, [state, handleReset, zoomIn, zoomOut, zoomReset])

 // ── Modes (educator + blind) come from ModesContext so toggling them
 // actually re-renders every panel that reads them.
 const { educator: educatorMode, blind: blindMode, toggleEducator, toggleBlind, surface, setSurface } = useModes()
 const pluginDrop = usePluginDrop()


 return (
 <LearnModeProvider>
 {showLearnCenter ? <LearnCenter /> : (
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
 real header. This is where macOS registers the window drag.
 NOTE (v5.2): the drag strip stays at the parent level — both v1 and
 v2 shells consume it via the sticky+top:28 contract on the header
 below. Do NOT move it inside either branch. */}
 <div
 className="app-drag-region sticky top-0 z-40"
 style={{ height: 28, backgroundColor: 'transparent' }}
 aria-hidden
 />
 <HeaderV2
 state={state}
 metricCells={buildMetricCells(results, {
 isAtmos: !!(results && results.atmos && (results.atmos as any).is_atmos),
 })}
 canShowBlind={state === 'results' && !!fileA && !!fileB && fileA.path !== fileB.path}
 zoom={{
 value: zoom,
 pct: `${zoomPct}%`,
 in: zoomIn,
 out: zoomOut,
 reset: zoomReset,
 outDisabled: zoom <= 0.86,
 inDisabled: zoom >= 1.49,
 }}
 onNewSearch={handleReset}
 learnToggle={<LearnModeToggle />}
 engineerName={engineerName}
 onEngineerNameChange={handleEngineerNameChange}
 />

 {/* Learn Mode — GuidedFlowBar renders sticky below the header when
 learn mode is enabled. onNavigate dispatches a CustomEvent that
 AnalysisView listens to, switching its active tab. StudentWorkspace
 floats on the right for students (self-hides when role !== 'student'). */}
 <GuidedFlowBar
 onNavigate={(tabId) => {
 window.dispatchEvent(new CustomEvent('rtm-learn-navigate', { detail: { tabId } }))
 }}
 referenceFilePath={fileA?.path ?? null}
 fileAName={fileA?.name}
 fileBName={fileB?.name}
 fileAPath={fileA?.path ?? null}
 fileBPath={fileB?.path ?? null}
 analysisResult={results}
 />
 {/* MED-12: ErrorBoundary isolates Learn Mode so a render crash
      in ClassGradeBook/LmsExportPanel doesn't unmount the whole app. */}
 <ErrorBoundary label="Learn Mode">
   <StudentWorkspace />
 </ErrorBoundary>

 <main className="max-w-5xl mx-auto px-8 py-6" style={{ paddingRight: 'calc(32px + var(--rtm-student-sidebar-width, 0px))', transition: 'padding-right 0.2s ease' }}>
 {/* Pending plug-in drop confirmation — replaces the silent
     unmount-the-results behaviour. The chip mounts at the top of
     the main column so it's visible whether the user is on the
     upload, results, or ref-only surface. */}
 {pendingQueue.length > 0 && (
 <div
 role="alert"
 style={{
 marginBottom: 16,
 padding: '10px 14px',
 border: '1px solid var(--color-accent)',
 borderRadius: 2,
 display: 'flex',
 alignItems: 'center',
 gap: 12,
 flexWrap: 'wrap',
 fontFamily: 'var(--font-sans)',
 fontSize: 'var(--text-sm, 0.875rem)',
 color: 'var(--color-text-primary)',
 }}
 >
 <span style={{ flex: 1 }}>
 {pendingQueue.length > 1
 ? `Plug-in sent ${pendingQueue.length} new bounces — replace current comparison?`
 : 'Plug-in sent a new bounce — replace current comparison?'}
 <span style={{ display: 'block', color: 'var(--color-text-secondary)', fontSize: 12, marginTop: 2 }}>
 {pendingQueue[0].info.name}
 </span>
 </span>
 <button
 type="button"
 onClick={() => {
 const head = pendingQueue[0]
 const { slot, info, drop } = head
 // Compute what the file slots will look like AFTER this replace,
 // so we can pick the right downstream analysis call.
 const nextA = slot === 'A' ? info : fileA
 const nextB = slot === 'B' ? info : fileB
 if (slot === 'A') {
 setFileA(info)
 pluginDrop.setSlot('A', drop?.meta ? { audioPath: info.path, ...drop.meta } : null)
 } else {
 setFileB(info)
 pluginDrop.setSlot('B', drop?.meta ? { audioPath: info.path, ...drop.meta } : null)
 }
 setPendingQueue(q => q.slice(1))
 // MED-3: handleCompare/handleRefOnly close over stale fileA/fileB
 // because React batches the setFileA/setFileB above. Defer to the
 // next tick so state has committed before we read it.
 if (nextA && nextB) {
 setTimeout(() => void handleCompare(), 0)
 } else if (nextA) {
 setTimeout(() => void handleRefOnly(), 0)
 } else {
 setState('upload')
 }
 }}
 style={{
 padding: '4px 12px',
 fontSize: 11,
 fontWeight: 600,
 letterSpacing: '0.06em',
 textTransform: 'uppercase',
 border: '1px solid var(--color-accent)',
 borderRadius: 2,
 background: 'transparent',
 color: 'var(--color-accent)',
 cursor: 'pointer',
 }}
 >
 Replace
 </button>
 <button
 type="button"
 onClick={() => setPendingQueue(q => q.slice(1))}
 style={{
 padding: '4px 12px',
 fontSize: 11,
 fontWeight: 600,
 letterSpacing: '0.06em',
 textTransform: 'uppercase',
 border: '1px solid var(--color-border)',
 borderRadius: 2,
 background: 'transparent',
 color: 'var(--color-text-secondary)',
 cursor: 'pointer',
 }}
 >
 Keep current
 </button>
 </div>
 )}
 {/* ReleaseCockpit removed — Label mode is shelved while we
 focus on the engineer side. The component + its tour + the
 releases store all remain in the codebase. */}

 {/* v5.2: cover-page empty state — Console Didone treatment. */}
  {state === 'upload' && (
    <CoverWiredEmptyState
      canBegin={!!fileA}
      onBegin={fileA && fileB ? handleCompare : handleRefOnly}
      onBeginCompare={handleCompare}
      onBeginRefOnly={handleRefOnly}
      onBatch={window.electronAPI?.selectFolder ? handleBatch : undefined}
      recents={history}
      onOpenRecents={() => { /* dropdown handled inline via the RecentAnalyses card below */ }}
      onClearRecents={async () => { await window.electronAPI?.historyClear?.(); setHistory([]) }}
      onTour={onHeaderTourClick}
      error={error}
      fileA={fileA}
      fileB={fileB}
      setFileA={setFileA}
      setFileB={setFileB}
      history={history}
      onClearA={() => setFileA(null)}
      onClearB={() => setFileB(null)}
      profileName={engineerName || undefined}
      onProfileNameChange={handleEngineerNameChange}
      controls={<>
        <ProfileDropdown
          profiles={profiles.filter(p => !p.profile_type || p.profile_type === 'fingerprint')}
          selected={profile}
          onSelect={(id) => { setProfile(id); try { localStorage.setItem('rtm-profile', id) } catch {} }}
          onLoadCustom={handleLoadProfile}
          onDelete={handleDeleteProfile}
          errorMessage={profileError}
          alignRight
        />
        <ProfileDropdown
          profiles={[{ id: '', name: 'None', profile_type: 'chain' }, ...profiles.filter(p => p.profile_type === 'chain')]}
          selected={chainProfile}
          onSelect={(id) => { setChainProfile(id); try { localStorage.setItem('rtm-chain-profile', id) } catch {} }}
          onLoadCustom={handleLoadChainProfile}
          onDelete={(id) => handleDeleteProfile(id)}
          label="Delta"
          alignRight
        />
      </>}
    >
      {/* Legacy-only UI: FileDropZones, swap, mode indicator, recents.
          v52 CoverSurface already has FileSlots and recents built in —
          rendering these again creates a "double window". */}
      {!useV52Cover && <>
        {(savedRefs.length > 0 || recentRefs.length > 0) && (
          <div className="flex items-center justify-center gap-3 mb-4">
            <ReferenceDropdown
              saved={savedRefs}
              recent={recentRefs}
              onPick={setFileA}
              onRemoveRecent={removeRecentRef}
              slotLabel="Reference"
            />
            <ReferenceDropdown
              saved={savedRefs}
              recent={recentRefs}
              onPick={setFileB}
              onRemoveRecent={removeRecentRef}
              slotLabel="Compare"
            />
          </div>
        )}
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
          {(fileA || fileB) && (
            <button
              onClick={() => { const a = fileA; setFileA(fileB); setFileB(a) }}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 hidden md:flex items-center justify-center transition-all hover:scale-110"
              style={{ backgroundColor: 'var(--color-bg-app)', border: '1px solid rgba(168,161,150,0.25)', color: 'var(--color-text-secondary)', borderRadius: 2 }}
              aria-label={fileA && fileB ? "Swap reference and compare files" : "Move file to the other slot"}
              title={fileA && fileB ? "Swap files" : "Move to the other slot"}
            >
              {fileA && fileB ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              ) : fileA ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m0 0l-5-5m5 5l-5 5" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5m0 0l5-5m-5 5l5 5" />
                </svg>
              )}
            </button>
          )}
        </div>
        <div
          style={{
            marginTop: 16,
            textAlign: 'center',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-metric-eyebrow)',
            letterSpacing: 'var(--tracking-metric-eyebrow)',
            textTransform: 'uppercase',
            color: 'var(--color-text-dim)',
          }}
        >
          {fileA && fileB ? (
            <>
              Begin comparison
              <span style={{ display: 'block', marginTop: 4, color: 'var(--color-text-secondary)', textTransform: 'none', letterSpacing: 0 }}>
                vs. {fileB.name}
              </span>
            </>
          ) : fileA ? (
            'Analyse reference only'
          ) : null}
        </div>
        {cancelMessage && (
          <div
            role="status"
            style={{
              marginTop: 12,
              marginInline: 'auto',
              width: 'min(840px, 92%)',
              padding: '8px 14px',
              border: '1px solid rgba(168,161,150,0.25)',
              borderRadius: 2,
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-sm, 0.875rem)',
              color: 'var(--color-text-secondary)',
              textAlign: 'center',
            }}
          >
            {cancelMessage}
          </div>
        )}
        {history.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <RecentAnalyses
              history={history}
              onPick={(entry, slot) => {
                const info: FileInfo = { path: entry.path, name: entry.name }
                if (slot === 'A') setFileA(info)
                else setFileB(info)
              }}
              onClear={async () => {
                await (window.electronAPI as any)?.historyClear?.()
                setHistory([])
              }}
            />
          </div>
        )}
      </>}
    </CoverWiredEmptyState>
  )}

 {state === 'processing' && (
 <ProgressBar message={progress} onCancel={handleCancelScan} />
 )}

 {/* Lazy boundaries — see imports above. The Suspense fallback is
 a tiny progress strip so the user has immediate feedback while
 the chunk downloads (typically <300 ms on first switch, instant
 on subsequent visits via Vite's chunk cache). */}
 {state === 'results' && results && (
 <>
 {/* CRIT-9: keyboard focus target after analysis completes */}
 <h2
   ref={resultsHeadingRef}
   tabIndex={-1}
   className="sr-only"
   style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}
 >
   Analysis results
 </h2>
 <Suspense fallback={<ProgressBar message="Loading compare view…" />}>
 <AnalysisView
 results={results}
 fileA={fileA!}
 fileB={fileB!}
 />
 </Suspense>
 </>
 )}

 {/* RTMcertify — signed pre-delivery compliance certificate.
 Only visible when comparing two files (not ref-only or batch). */}
 {state === 'results' && results && fileA && fileB && window.electronAPI?.rtmCertify && (
 <div style={{ padding: '12pt 20pt 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
 <button
 onClick={handleCertify}
 disabled={certifying}
 title="Generate a signed pre-delivery compliance certificate (RTMcertify)"
 style={goldBudget ? {
   alignSelf: 'flex-start',
   padding: '10px 24px',
   fontFamily: 'var(--font-sans)',
   fontSize: 12,
   fontWeight: 500,
   letterSpacing: '0.12em',
   textTransform: 'uppercase' as const,
   border: '1px solid var(--color-accent)',
   borderRadius: 2,
   background: 'var(--color-accent)',
   color: 'var(--color-bg-app)',
   cursor: certifying ? 'wait' : 'pointer',
   opacity: certifying ? 0.5 : 1,
   display: 'inline-flex',
   alignItems: 'center',
   gap: 8,
 } : {
   alignSelf: 'flex-start',
   padding: '6px 16px',
   fontSize: 12,
   fontWeight: 600,
   letterSpacing: '0.06em',
   textTransform: 'uppercase' as const,
   border: '1px solid rgba(168,161,150,0.25)',
   borderRadius: 2,
   background: 'transparent',
   color: 'var(--color-text-secondary, #aaa)',
   cursor: certifying ? 'wait' : 'pointer',
   opacity: certifying ? 0.5 : 1,
   display: 'inline-flex',
   alignItems: 'center',
   gap: 8,
 }}
 >
 {certifying ? 'Generating certificate…' : 'Get RTMcertify Certificate'}
 <span title="RTMcertify creates a tamper-proof compliance certificate for your delivery: a signed JSON document containing SHA-256 file fingerprints, LUFS and true-peak measurements, sample rate, bit depth, and a unique certificate ID with a UTC timestamp. Use it to prove to a label, distributor, or streaming platform exactly what was delivered and when — and that nothing was changed after the fact." style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 13, height: 13, borderRadius: '50%', fontSize: 7, fontWeight: 600, color: goldBudget ? 'rgba(0,0,0,0.5)' : 'rgba(168,161,150,0.5)', border: `1px solid ${goldBudget ? 'rgba(0,0,0,0.3)' : 'rgba(168,161,150,0.3)'}`, lineHeight: 1, cursor: 'help', flexShrink: 0 }}>i</span>
 </button>
 {certifyResult && (certifyResult.error ? (
 <div
 style={{
 fontFamily: 'var(--font-sans)',
 fontSize: 12,
 color: 'var(--color-danger)',
 padding: '6px 0',
 }}
 >
 Certificate failed: {certifyResult.error}
 </div>
 ) : (
 <div
 style={{
 border: '1px solid var(--color-border)',
 borderRadius: 2,
 padding: '10pt 14pt',
 fontSize: 11,
 display: 'flex',
 flexDirection: 'column',
 gap: 6,
 color: 'var(--color-text-primary)',
 }}
 >
 <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
 Certificate issued
 </div>
 <div style={{ fontFamily: 'var(--font-mono)' }}>
 ID&nbsp;
 <span style={{ color: 'var(--color-text-primary)' }}>
 {String(certifyResult.certificate_id || '').slice(0, 8)}…
 </span>
 </div>
 <div style={{ fontFamily: 'var(--font-mono)' }}>
 SHA256 A&nbsp;
 <span style={{ color: 'var(--color-text-primary)' }}>
 {String(certifyResult.sha256_a || '').slice(0, 8)}…
 </span>
 </div>
 <div style={{ fontFamily: 'var(--font-mono)' }}>
 SHA256 B&nbsp;
 <span style={{ color: 'var(--color-text-primary)' }}>
 {String(certifyResult.sha256_b || '').slice(0, 8)}…
 </span>
 </div>
 <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
 <button
 type="button"
 onClick={async () => {
 const json = JSON.stringify(certifyResult, null, 2)
 try {
 await navigator.clipboard.writeText(json)
 setCertifyToast('Copied JSON to clipboard')
 } catch {
 setCertifyToast('Copy failed — try selecting the JSON manually')
 }
 }}
 style={{
 padding: '4px 12px',
 fontSize: 11,
 fontWeight: 600,
 letterSpacing: '0.06em',
 textTransform: 'uppercase',
 border: '1px solid var(--color-border)',
 borderRadius: 2,
 background: 'transparent',
 color: 'var(--color-text-secondary)',
 cursor: 'pointer',
 }}
 >
 Copy JSON
 </button>
 <button
 type="button"
 onClick={async () => {
 const json = JSON.stringify(certifyResult, null, 2)
 const defaultName = `rtmcertify-${String(certifyResult.certificate_id || 'cert').slice(0, 8)}.cert.json`
 try {
 if (window.electronAPI?.saveFileDialog) {
 await window.electronAPI.saveFileDialog(defaultName, json, [{ name: 'RTM Certificate', extensions: ['cert.json', 'json'] }])
 setCertifyToast('Saved .cert.json')
 return
 }
 } catch {
 setCertifyToast('Save cancelled')
 return
 }
 // Browser fallback — Blob download.
 try {
 const blob = new Blob([json], { type: 'application/json' })
 const url = URL.createObjectURL(blob)
 const a = document.createElement('a')
 a.href = url
 a.download = defaultName
 a.click()
 setTimeout(() => URL.revokeObjectURL(url), 1000)
 setCertifyToast('Saved .cert.json')
 } catch {
 setCertifyToast('Save cancelled')
 }
 }}
 style={{
 padding: '4px 12px',
 fontSize: 11,
 fontWeight: 600,
 letterSpacing: '0.06em',
 textTransform: 'uppercase',
 border: '1px solid var(--color-border)',
 borderRadius: 2,
 background: 'transparent',
 color: 'var(--color-text-secondary)',
 cursor: 'pointer',
 }}
 >
 Save .cert.json
 </button>
 </div>
 {certifyToast && (
 <div
 role="status"
 style={{
 fontSize: 11,
 color: 'var(--color-text-muted)',
 marginTop: 4,
 }}
 >
 {certifyToast}
 </div>
 )}
 </div>
 ))}
 </div>
 )}

 {state === 'batch' && batchResults && (
 <>
 {/* LOW-16: keyboard focus target for batch results */}
 <h2
   ref={resultsHeadingRef}
   tabIndex={-1}
   className="sr-only"
   style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}
 >
   Batch analysis results
 </h2>
 <Suspense fallback={<ProgressBar message="Loading batch view…" />}>
 <BatchView
 results={batchResults}
 folderName={batchFolderName || undefined}
 onBack={handleBatchBack}
 initialSession={batchInitialSession}
 />
 </Suspense>
 </>
 )}

 {state === 'ref-only' && refOnlyResults && (
 <>
 {/* CRIT-9: keyboard focus target */}
 <h2
   ref={resultsHeadingRef}
   tabIndex={-1}
   className="sr-only"
   style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}
 >
   Analysis results
 </h2>
 <Suspense fallback={<ProgressBar message="Loading single-file view…" />}>
 <RefOnlyView check={refOnlyResults} fileName={fileA!.name} filePath={fileA!.path} />
 </Suspense>
 </>
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
 // If a comparison / single-file view is on screen we don't
 // silently nuke it — defer the drop and let the user choose
 // (see pendingIncoming chip rendered near the dropzones).
 if (state === 'results' || state === 'ref-only') {
 const targetSlot: 'A' | 'B' = slot === 'B' && !fileA ? 'A' : slot
 setPendingQueue(q => [...q, { slot: targetSlot, info, drop }])
 return
 }
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
 )}
 </LearnModeProvider>
 )
}
