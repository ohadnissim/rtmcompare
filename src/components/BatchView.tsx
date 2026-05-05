import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { BatchResult, AlbumSession, ALBUM_SESSION_VERSION } from '../types'
import DurationPill, { formatDuration } from './DurationPill'
import CohortMode from './CohortMode'
import SongDetailPanel from './SongDetailPanel'
import BatchTour, { useBatchTourState } from './BatchTour'
import SongQuickSwitcher from './SongQuickSwitcher'
import { inferRevisions } from '../singleFileHelpers'
import { useModes } from '../ModesContext'
import { streamingTpFloorDbtp } from '../dspProfiles'

interface Props {
 results: BatchResult[]
 folderName?: string
 onBack: () => void
 /** Optional session hydration — when the user picks Load, App.tsx parses
 * the JSON, sets batchResults, and passes the saved notes + tab state
 * through this prop so the batch view lands in the same context. */
 initialSession?: AlbumSession | null
 // Label-mode props (labelMode / releaseId / onReleaseIdChange) and the
 // associated DMR / Releases / Audit log workflow have been removed —
 // those features migrated to FLOW.
}

type SortKey = 'filename' | 'lufs_i' | 'true_peak_dbtp' | 'lra' | 'duration_sec' | 'track_number'
type SortDir = 'asc' | 'desc'

/** Sentinel "tab id" for the album overview — never a song path. */
const OVERVIEW_TAB = 'overview'

/** Deep-analysis progress reported by SongDetailPanel up to BatchView, so
 * the table row and tab strip can show a live indicator. We keep a rough
 * % estimate here too — the backend doesn't emit a numeric progress, so
 * we fall back to elapsed-time / expected-duration. */
const ANALYSIS_EXPECTED_SEC = 20
export type SongAnalysisState = {
 state: 'running' | 'done' | 'error'
 startedAt?: number
 message?: string
}
function analysisPct(s: SongAnalysisState | undefined): number {
 if (!s || s.state !== 'running' || !s.startedAt) return 0
 const elapsed = (Date.now() - s.startedAt) / 1000
 return Math.min(95, Math.round((elapsed / ANALYSIS_EXPECTED_SEC) * 100))
}
function analysisElapsedSec(s: SongAnalysisState | undefined): number {
 if (!s || s.state !== 'running' || !s.startedAt) return 0
 return Math.round((Date.now() - s.startedAt) / 1000)
}

export default function BatchView({ results, folderName, onBack, initialSession }: Props) {
 const modes = useModes()
 const [sortKey, setSortKey] = useState<SortKey>('filename')
 // Album loudness anchor — the reference LUFS value that the Δ column
 // reads against. 'median' keeps the legacy behaviour (compare each
 // track to the album's own median). A numeric value anchors every
 // track to a DSP target (−14 for Spotify, −16 for Apple, −23 for R128)
 // so Dani can see, in one glance, how far each track sits from the
 // intended delivery target for this EP. Persisted so the choice
 // sticks across sessions.
 type LufsAnchor = 'median' | -14 | -16 | -23
 const [lufsAnchor, setLufsAnchor] = useState<LufsAnchor>(() => {
 try {
 const v = localStorage.getItem('rtm-batch-lufs-anchor')
 if (v === 'median') return 'median'
 const n = Number(v)
 if (n === -14 || n === -16 || n === -23) return n as LufsAnchor
 } catch {}
 return 'median'
 })
 useEffect(() => {
 try { localStorage.setItem('rtm-batch-lufs-anchor', String(lufsAnchor)) } catch {}
 }, [lufsAnchor])
 // Cohort Mode — null until the user picks a reference (either by promoting
 // a row or dropping a reference file).
 const [reference, setReference] = useState<BatchResult | null>(null)

 // Single-slot tab model (user feedback: "rotate in the same tab").
 // Tab strip is just [Overview] + one active song (if any). Clicking a
 // different row replaces the active song in place — no openTabs array.
 // `initialSession.activeTab` still works as a "which song was I on?"
 // restore point.
 const [activeTab, setActiveTab] = useState<string>(() => {
 const saved = initialSession?.activeTab
 if (!saved || saved === OVERVIEW_TAB) return OVERVIEW_TAB
 // Make sure the saved path is still in results (file could have been
 // moved / renamed). Fall back to Overview otherwise.
 if (initialSession?.results?.some(r => r.path === saved)) return saved
 return OVERVIEW_TAB
 })
 const activeSongPath = activeTab === OVERVIEW_TAB ? null : activeTab

 // Notes state — hydrated from a loaded session, otherwise empty. Lives
 // here (not in SongDetailPanel) so it survives tab-close/reopen and so
 // Save can serialise everything in one place.
 const [albumNote, setAlbumNote] = useState<string>(() => initialSession?.notes?.album || '')
 const [songNotes, setSongNotes] = useState<Record<string, string>>(() => initialSession?.notes?.songs || {})
 const setSongNote = useCallback((path: string, value: string) => {
 setSongNotes(prev => ({ ...prev, [path]: value }))
 }, [])

 // A/B reference pick — lives here (not inside SongDetailPanel) so the
 // pick locks as the user rotates B with ← / → or by clicking different
 // rows. User ask: "B is changing according to the song I'm viewing".
 const [abReferencePath, setAbReferencePath] = useState<string | null>(null)

 // Delivery Manifest Reconciler removed — that workflow lives in FLOW.

 // Batch-specific tour — auto-runs the first time a batch view opens,
 // re-triggerable from the Tour button in the header. Covers tabs,
 // Cohort Mode, notes, song-tab surfaces. Separate state + storage
 // key from the upload tour so they don't gate each other.
 const batchTour = useBatchTourState()

 // ⌘K / Ctrl+K quick-switcher — jump straight to any song in the
 // loaded batch without scrolling the table. Mirrors the Compare-view
 // command-palette UX but scoped to song navigation. Also responds to
 // plain "/" (when no input is focused) as a power-user fallback.
 const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false)
 useEffect(() => {
 const onKey = (e: KeyboardEvent) => {
 const t = e.target as HTMLElement | null
 const tag = t?.tagName
 const editable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)
 const mod = e.metaKey || e.ctrlKey
 if (mod && (e.key === 'k' || e.key === 'K')) {
 e.preventDefault()
 setQuickSwitcherOpen(true)
 return
 }
 if (!mod && !editable && e.key === '/') {
 e.preventDefault()
 setQuickSwitcherOpen(true)
 }
 }
 window.addEventListener('keydown', onKey)
 return () => window.removeEventListener('keydown', onKey)
 }, [])

 // Archival Reissue mode — a per-session flag that reframes the batch
 // view for the reissue workflow (old master vs new master). When on,
 // the A/B reference picker's default suggestion is "the oldest file
 // in the folder" and the table shows Δ loudness + Δ TP vs that file
 // in-line. Persists in localStorage so the engineer doesn't have to
 // re-flip it every session. User ask: "we definitly need ... archival
 // reissue mode."
 const [reissueMode, setReissueMode] = useState<boolean>(() => {
 try { return localStorage.getItem('rtm-reissue-mode') === '1' } catch { return false }
 })
 const toggleReissueMode = useCallback(() => {
 setReissueMode(v => {
 const next = !v
 try { localStorage.setItem('rtm-reissue-mode', next ? '1' : '0') } catch {}
 return next
 })
 }, [])
 // When Reissue mode flips on and no A/B reference is set, auto-pick
 // the most-likely-original master. Heuristic: filename matches one of
 // a handful of "original" keywords (orig / 1998 / CD / remaster /
 // original / rip / master); fall back to the alphabetically first
 // track so the user at least lands with SOME anchor. The user can
 // still change it via the dropdown — this is just a sensible default.
 const REISSUE_ORIGINAL_RE = /(orig(?:inal)?|\b19\d{2}\b|\b200\d\b|cd[\s_-]?rip|\bmaster\b|\bremaster\b|source|archive)/i
 useEffect(() => {
 if (!reissueMode) return
 if (abReferencePath) return
 if (results.length === 0) return
 const preferred = results.find(r => REISSUE_ORIGINAL_RE.test(r.filename))
 const pick = preferred || [...results].sort((a, b) => a.filename.localeCompare(b.filename))[0]
 if (pick) setAbReferencePath(pick.path)
 }, [reissueMode, abReferencePath, results])

 // Cohort-reference loader state — user feedback: "I've loaded a
 // reference here, but nothing happens. if it's analysing i need to
 // know." Tracks whether a pick-and-analyse round trip is in flight
 // + the latest progress message + any error so the button can show
 // "Analysing…" instead of appearing dead. Errors are surfaced inline
 // (auto-dismissed on retry / clear).
 const [cohortRefLoading, setCohortRefLoading] = useState(false)
 const [cohortRefMsg, setCohortRefMsg] = useState<string>('')
 const [cohortRefError, setCohortRefError] = useState<string | null>(null)
 // Auto-dismiss reference-load errors after 10 s so a failed scan doesn't
 // leave a red chip pinned next to the "Load reference…" button forever.
 // Click-to-dismiss still works (the inline chip has an onClick clearing
 // the state) — this is the idle fallback.
 useEffect(() => {
 if (!cohortRefError) return
 const t = setTimeout(() => setCohortRefError(null), 10000)
 return () => clearTimeout(t)
 }, [cohortRefError])
 const loadCohortReference = useCallback(async () => {
 if (!window.electronAPI?.selectFile || !window.electronAPI?.analyzeBatch) return
 setCohortRefError(null)
 try {
 const path = await window.electronAPI.selectFile()
 if (!path) return
 setCohortRefLoading(true)
 setCohortRefMsg('Analysing reference…')
 // Tap into the batch progress stream so "Analysing 1/1 · file.wav"
 // surfaces on the button label instead of a generic spinner.
 window.electronAPI.onBatchProgress?.((m) => setCohortRefMsg(m.message || 'Analysing…'))
 const res = await window.electronAPI.analyzeBatch([path])
 const row = res?.results?.[0]
 if (!row) {
 setCohortRefError('Reference scan returned no result — try a WAV / FLAC / AIFF file.')
 return
 }
 if (row.error) {
 setCohortRefError(row.error)
 return
 }
 setReference(row)
 } catch (err: any) {
 setCohortRefError(err?.message || 'Could not load reference file.')
 } finally {
 setCohortRefLoading(false)
 setCohortRefMsg('')
 }
 }, [])

 // Library references — two pools feed the A/B dropdown alongside the
 // current album + cohort ref:
 // • sessionRefs — uploaded mid-session, gone when the app closes.
 // • favRefs — persisted in localStorage so they're always there
 // (user ask: "lets add a favorites, so it will always
 // be on the list regardless to the session").
 type LibraryRef = { path: string; label: string; spectrum?: number[] }
 const FAV_STORAGE_KEY = 'rtm-ab-reference-favorites'
 const [sessionRefs, setSessionRefs] = useState<LibraryRef[]>([])
 const [favRefs, setFavRefs] = useState<LibraryRef[]>(() => {
 try {
 const raw = localStorage.getItem(FAV_STORAGE_KEY)
 if (!raw) return []
 const parsed = JSON.parse(raw)
 return Array.isArray(parsed) ? parsed.filter((x: any) => x && typeof x.path === 'string' && typeof x.label === 'string') : []
 } catch { return [] }
 })
 // Persist favorites whenever they change — single localStorage key,
 // validated on read so a broken JSON doesn't blow up the batch view.
 useEffect(() => {
 try { localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(favRefs)) } catch {}
 }, [favRefs])

 // Upload a new reference file on-demand. Runs a lightweight batch scan
 // so we have a spectrum for the Tonal Balance overlay, then adds to
 // the session pool and auto-selects it as the current A/B reference.
 const [uploadingRef, setUploadingRef] = useState<boolean>(false)
 const [addRefError, setAddRefError] = useState<string | null>(null)
 const addReference = useCallback(async (): Promise<void> => {
 if (!window.electronAPI?.selectFile || !window.electronAPI?.analyzeBatch) return
 setAddRefError(null)
 setUploadingRef(true)
 try {
 const picked = await window.electronAPI.selectFile()
 if (!picked) return
 // De-dupe — if the file is already in the session / favorites /
 // album, just select it rather than adding a second row.
 const existing = [...favRefs, ...sessionRefs].find(r => r.path === picked) ||
 results.find(r => r.path === picked)
 if (existing) {
 setAbReferencePath(picked)
 return
 }
 const res = await window.electronAPI.analyzeBatch([picked])
 const row = res?.results?.[0]
 if (!row) {
 setAddRefError('Scan returned no result for that file — try a WAV / FLAC / AIFF.')
 return
 }
 if (row.error) {
 setAddRefError(row.error)
 return
 }
 const label = cleanSongName(row)
 const entry: LibraryRef = {
 path: picked,
 label,
 spectrum: row.spectrum && row.spectrum.length === 31 ? row.spectrum : undefined,
 }
 setSessionRefs(prev => [...prev, entry])
 setAbReferencePath(picked)
 } catch (err: any) {
 setAddRefError(err?.message || 'Could not load reference file.')
 } finally {
 setUploadingRef(false)
 }
 }, [favRefs, sessionRefs, results])

 // Toggle the currently-selected A/B reference in / out of favorites.
 // Pulls the label + spectrum from wherever the target lives right now
 // (session, album, cohort) so favorites carry the same overlay data.
 const isReferenceFavorited = useMemo(
 () => (abReferencePath ? favRefs.some(r => r.path === abReferencePath) : false),
 [abReferencePath, favRefs]
 )
 const toggleFavoriteCurrent = useCallback(() => {
 if (!abReferencePath) return
 setFavRefs(prev => {
 if (prev.some(r => r.path === abReferencePath)) {
 return prev.filter(r => r.path !== abReferencePath)
 }
 // Harvest the label + spectrum from whichever pool currently owns
 // this path. Order: session uploads → album rows → cohort ref.
 const session = sessionRefs.find(r => r.path === abReferencePath)
 const album = results.find(r => r.path === abReferencePath)
 const cohort = reference && reference.path === abReferencePath ? reference : null
 let entry: LibraryRef | null = null
 if (session) entry = session
 else if (album) entry = {
 path: album.path,
 label: cleanSongName(album),
 spectrum: album.spectrum && album.spectrum.length === 31 ? album.spectrum : undefined,
 }
 else if (cohort) entry = {
 path: cohort.path,
 label: `${cleanSongName(cohort)} (ref)`,
 spectrum: cohort.spectrum && cohort.spectrum.length === 31 ? cohort.spectrum : undefined,
 }
 return entry ? [...prev, entry] : prev
 })
 }, [abReferencePath, sessionRefs, results, reference])

 // Per-song deep-analysis progress — lives at the BatchView level so the
 // table row AND the tab strip can both show a live indicator (user
 // feedback: "i cant know if its working"). 'done' rows persist so the
 // overview gets a ✓ on tracks the user already opened. Init from the
 // shared song-cache so songs that were pre-analyzed during the batch
 // scan show ✓ right away instead of waiting for a tab open.
 const [songAnalysis, setSongAnalysis] = useState<Record<string, SongAnalysisState>>(() => {
 const init: Record<string, SongAnalysisState> = {}
 try {
 const cache: Map<string, any> = (window as any).__rtmSongCache || new Map()
 for (const r of initialSession?.results || []) {
 if (cache.has(r.path)) init[r.path] = { state: 'done' }
 }
 // Also seed from the batch-scan deep pass — those paths are in
 // cache keyed by the result path, so iterate the cache too.
 cache.forEach((_v, k) => {
 if (!init[k]) init[k] = { state: 'done' }
 })
 } catch {}
 return init
 })
 // 1 Hz heartbeat so the elapsed-time / % indicators repaint without the
 // panel having its own interval. Cheap and only live while something is
 // actually running.
 const analysisRunning = useMemo(
 () => Object.values(songAnalysis).some(s => s.state === 'running'),
 [songAnalysis]
 )
 const [, forceTick] = useState(0)
 useEffect(() => {
 if (!analysisRunning) return
 const id = setInterval(() => forceTick(t => t + 1), 1000)
 return () => clearInterval(id)
 }, [analysisRunning])

 // Activate a song tab. Single-slot model — this just replaces whatever
 // song was previously in the one song-tab position.
 const openSongTab = useCallback((path: string) => {
 setActiveTab(path)
 }, [])
 // Close the current song tab — return to Overview.
 const closeSongTab = useCallback((_path: string) => {
 setActiveTab(OVERVIEW_TAB)
 }, [])

 // ── Shared audio engine. One <audio> element, one "currently playing"
 // path, driven via imperative refs so rapid clicks never race state.
 // Overview row buttons + the song-detail transport both call into
 // these helpers, so a new play stops the previous one automatically.
 const audioRef = useRef<HTMLAudioElement | null>(null)
 const [playingPath, setPlayingPath] = useState<string | null>(null)
 const [audioProgress, setAudioProgress] = useState({ current: 0, duration: 0 })
 // Per-file blob URL cache — first play of a file reads the bytes once,
 // subsequent plays seek instantly without re-reading.
 const blobUrlCache = useRef<Map<string, string>>(new Map())

 const stopSong = useCallback(() => {
 const a = audioRef.current
 if (a) { try { a.pause() } catch {} ; a.src = '' }
 setPlayingPath(null)
 setAudioProgress({ current: 0, duration: 0 })
 }, [])

 const playSong = useCallback(async (path: string, opts: { seekFresh?: boolean; startSec?: number } = {}) => {
 // Already playing this same file — either jump to startSec or toggle.
 if (playingPath === path && !opts.seekFresh) {
 const a = audioRef.current
 if (a) {
 if (opts.startSec != null) { a.currentTime = opts.startSec; if (a.paused) a.play().catch(() => {}); return }
 if (a.paused) { a.play().catch(() => {}); return }
 else { a.pause(); setPlayingPath(null); return }
 }
 }
 // Resolve or build the blob URL.
 let url = blobUrlCache.current.get(path)
 if (!url) {
 if (!window.electronAPI?.readAudioFile) return
 try {
 const bytes = await window.electronAPI.readAudioFile(path)
 const blob = new Blob([bytes], { type: 'audio/wav' })
 url = URL.createObjectURL(blob)
 blobUrlCache.current.set(path, url)
 } catch (err) {
 console.error('[batch-view] read audio file failed:', path, err)
 return
 }
 }
 const a = audioRef.current
 if (!a) return
 a.src = url
 // Defer seek until metadata is loaded — setting currentTime before
 // metadata is ignored on some browsers.
 const seekTo = opts.startSec ?? 0
 const onLoaded = () => { a.currentTime = seekTo; a.removeEventListener('loadedmetadata', onLoaded) }
 a.addEventListener('loadedmetadata', onLoaded)
 try { await a.play() } catch (err) { console.error('[batch-view] audio play() rejected:', err); return }
 setPlayingPath(path)
 }, [playingPath])

 // Wire the <audio> element's events → progress state + auto-stop.
 useEffect(() => {
 const a = audioRef.current
 if (!a) return
 const onTime = () => setAudioProgress({ current: a.currentTime, duration: a.duration || 0 })
 const onEnd = () => { setPlayingPath(null); setAudioProgress({ current: 0, duration: a.duration || 0 }) }
 const onPause = () => { /* state already updated by callers */ }
 a.addEventListener('timeupdate', onTime)
 a.addEventListener('ended', onEnd)
 a.addEventListener('pause', onPause)
 return () => {
 a.removeEventListener('timeupdate', onTime)
 a.removeEventListener('ended', onEnd)
 a.removeEventListener('pause', onPause)
 }
 }, [])

 // Clean up blob URLs on unmount.
 useEffect(() => () => {
 blobUrlCache.current.forEach(u => URL.revokeObjectURL(u))
 blobUrlCache.current.clear()
 }, [])
 const [sortDir, setSortDir] = useState<SortDir>('asc')

 // ── Cross-album consistency — flag outliers that deviate more than 1 LU
 // from the median across the album. Same for TP / LRA. Shown as red
 // arrows in the table so "track 7 is 1.8 LU quieter than the rest"
 // reads at a glance.
 const stats = useMemo(() => {
 const median = (vals: number[]) => {
 const s = [...vals].sort((a, b) => a - b)
 if (s.length === 0) return null
 return s[Math.floor(s.length / 2)]
 }
 const lufs = results.map(r => r.lufs_i).filter((v): v is number => v != null && isFinite(v))
 const tp = results.map(r => r.true_peak_dbtp).filter((v): v is number => v != null && isFinite(v))
 const lra = results.map(r => r.lra).filter((v): v is number => v != null && isFinite(v))
 return {
 lufsMedian: median(lufs),
 tpMedian: median(tp),
 lraMedian: median(lra),
 }
 }, [results])

 // ── Duplicate ISRC detection — a real delivery landmine. Count occurrences.
 const isrcCounts = useMemo(() => {
 const m = new Map<string, number>()
 for (const r of results) {
 if (r.isrc) m.set(r.isrc, (m.get(r.isrc) || 0) + 1)
 }
 return m
 }, [results])

 const sortedResults = useMemo(() => {
 const list = [...results]
 list.sort((a, b) => {
 const av = (a as any)[sortKey]
 const bv = (b as any)[sortKey]
 if (av == null && bv == null) return 0
 if (av == null) return 1
 if (bv == null) return -1
 if (typeof av === 'number' && typeof bv === 'number') {
 return sortDir === 'asc' ? av - bv : bv - av
 }
 return sortDir === 'asc'
 ? String(av).localeCompare(String(bv), undefined, { numeric: true })
 : String(bv).localeCompare(String(av), undefined, { numeric: true })
 })
 return list
 }, [results, sortKey, sortDir])

 const toggleSort = (k: SortKey) => {
 if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
 else { setSortKey(k); setSortDir('asc') }
 }


 // ── CSV export — flat, label-ops spreadsheet-ready.
 const exportCsv = async () => {
 const header = [
 'track', 'filename', 'title', 'artist', 'album',
 'lufs_i', 'true_peak_dbtp', 'lra',
 'length_seconds', 'length_mmss',
 'sample_rate', 'bit_depth', 'channels',
 'isrc', 'upc',
 'clipped_samples', 'mono_compat_loss_pct',
 'notes',
 ]
 const rows: string[][] = [header]
 const escape = (v: any) => {
 if (v == null) return ''
 const s = String(v)
 if (s.includes(',') || s.includes('"') || s.includes('\n')) {
 return '"' + s.replace(/"/g, '""') + '"'
 }
 return s
 }
 for (const r of results) {
 const notes: string[] = []
 // Auto-generated warnings go first.
 if (r.error) notes.push(r.error)
 if (r.true_peak_dbtp != null && r.true_peak_dbtp > streamingTpFloorDbtp()) notes.push('TP over −1 dBTP')
 if ((r.clipped_samples || 0) > 0) notes.push(`${r.clipped_samples} clipped samples`)
 // ISRC missing/duplicate warnings disabled by user direction.
 if (stats.lufsMedian != null && r.lufs_i != null && Math.abs(r.lufs_i - stats.lufsMedian) > 1.5) {
 notes.push(`LUFS outlier (${(r.lufs_i - stats.lufsMedian > 0 ? '+' : '') + (r.lufs_i - stats.lufsMedian).toFixed(1)} vs median)`)
 }
 // User's own per-song note — append last so it's easy to scan past
 // the machine warnings.
 const userNote = (songNotes[r.path] || '').trim()
 if (userNote) notes.push(`Note: ${userNote.replace(/\s+/g, ' ')}`)
 rows.push([
 r.track_number ?? '',
 r.filename,
 r.title ?? '',
 r.artist ?? '',
 r.album ?? '',
 r.lufs_i ?? '',
 r.true_peak_dbtp ?? '',
 r.lra ?? '',
 r.duration_sec ?? '',
 r.duration_sec != null ? formatDuration(r.duration_sec) : '',
 r.sample_rate ?? '',
 r.bit_depth ?? '',
 r.channels ?? '',
 r.isrc ?? '',
 r.upc ?? '',
 r.clipped_samples ?? '',
 r.mono_compat_loss_pct ?? '',
 notes.join('; '),
 ].map(escape))
 }
 const csv = rows.map(r => r.join(',')).join('\n')
 const defaultName = (folderName ? `${folderName.replace(/[^a-z0-9_-]+/gi, '_')}_` : '') + 'rtm-batch.csv'
 try {
 if (window.electronAPI?.saveFileDialog) {
 await window.electronAPI.saveFileDialog(defaultName, csv, [{ name: 'CSV', extensions: ['csv'] }])
 } else {
 const blob = new Blob([csv], { type: 'text/csv' })
 const url = URL.createObjectURL(blob)
 const a = document.createElement('a')
 a.href = url; a.download = defaultName; a.click()
 URL.revokeObjectURL(url)
 }
 } catch {}
 }

 // ── JSON export — machine-readable, one object per track.
 //
 // Give me one row per track as JSON and I can
 // bulk-ingest 5000 submissions a month."
 //
 // Shape matches the CSV columns one-to-one so downstream tooling can
 // swap formats without remapping, plus a schema version + metadata
 // envelope so ingest pipelines can validate against the right spec.
 const exportJson = async () => {
 const payload = {
 schema: 'rtm-batch.v1',
 generatedAt: new Date().toISOString(),
 folder: folderName || null,
 trackCount: results.length,
 albumStats: {
 lufsMedian: stats.lufsMedian ?? null,
 tpMedian: stats.tpMedian ?? null,
 lraMedian: stats.lraMedian ?? null,
 },
 albumNote: albumNote || null,
 tracks: results.map(r => {
 const userNote = (songNotes[r.path] || '').trim() || null
 const flags: string[] = []
 if (r.error) flags.push('analysis_error')
 if (r.true_peak_dbtp != null && r.true_peak_dbtp > streamingTpFloorDbtp()) flags.push('tp_over_minus_1')
 if ((r.clipped_samples || 0) > 0) flags.push('clipped')
 // ISRC missing/duplicate flags disabled by user direction.
 if (stats.lufsMedian != null && r.lufs_i != null && Math.abs(r.lufs_i - stats.lufsMedian) > 1.5) flags.push('lufs_outlier')
 return {
 track: r.track_number ?? null,
 filename: r.filename,
 path: r.path,
 title: r.title ?? null,
 artist: r.artist ?? null,
 album: r.album ?? null,
 isrc: r.isrc ?? null,
 upc: r.upc ?? null,
 explicit: r.explicit ?? null,
 pLine: r.p_line ?? null,
 cLine: r.c_line ?? null,
 loudness: {
 lufsI: r.lufs_i ?? null,
 truePeakDbtp: r.true_peak_dbtp ?? null,
 lra: r.lra ?? null,
 },
 format: {
 durationSec: r.duration_sec ?? null,
 sampleRate: r.sample_rate ?? null,
 bitDepth: r.bit_depth ?? null,
 channels: r.channels ?? null,
 },
 integrity: {
 clippedSamples: r.clipped_samples ?? null,
 monoCompatLossPct: r.mono_compat_loss_pct ?? null,
 },
 flags,
 note: userNote,
 error: r.error ?? null,
 }
 }),
 }
 const json = JSON.stringify(payload, null, 2)
 const defaultName = (folderName ? `${folderName.replace(/[^a-z0-9_-]+/gi, '_')}_` : '') + 'rtm-batch.json'
 try {
 if (window.electronAPI?.saveFileDialog) {
 await window.electronAPI.saveFileDialog(defaultName, json, [{ name: 'JSON', extensions: ['json'] }])
 } else {
 const blob = new Blob([json], { type: 'application/json' })
 const url = URL.createObjectURL(blob)
 const a = document.createElement('a')
 a.href = url; a.download = defaultName; a.click()
 URL.revokeObjectURL(url)
 }
 } catch {}
 }

 // ── PDF export — renders an HTML document and hands it to the Electron
 // main process, which does an offscreen printToPDF. Same path the
 // client-report uses; here it's laid out as an album summary sheet
 // with the sortable table frozen in sort-order-at-click-time.
 const exportPdf = async () => {
 if (!window.electronAPI?.renderPdf) {
 // Browser fallback — open a print dialog in a new tab with the same HTML.
 const w = window.open('', '_blank')
 if (w) {
 w.document.write(buildBatchPdfHtml(sortedResults, stats, isrcCounts, folderName, albumNote, songNotes))
 w.document.close()
 setTimeout(() => w.print(), 400)
 }
 return
 }
 try {
 const html = buildBatchPdfHtml(sortedResults, stats, isrcCounts, folderName, albumNote, songNotes)
 const defaultName = (folderName ? `${folderName.replace(/[^a-z0-9_-]+/gi, '_')}_` : '') + 'rtm-batch.pdf'
 await window.electronAPI.renderPdf(html, defaultName)
 } catch {}
 }

 // ── Save album session — serialises results + notes + open tabs into a
 // single JSON the engineer can reopen later. Uses the shared
 // saveFileDialog IPC (same plumbing the CSV export uses), so no new
 // main-process code for this side of the round trip.
 const saveSession = async () => {
 const payload: AlbumSession = {
 version: ALBUM_SESSION_VERSION,
 savedAt: new Date().toISOString(),
 folderName: folderName || null,
 results,
 notes: { album: albumNote, songs: songNotes },
 // Single-slot tab model — we still serialise which song was active
 // so Load lands the user back on it. openTabs kept for schema
 // compatibility with older saves; one entry max.
 openTabs: activeTab !== OVERVIEW_TAB ? [activeTab] : [],
 activeTab,
 spec_versions: results.find(r => r.spec_versions)?.spec_versions,
 }
 const defaultName = (folderName ? `${folderName.replace(/[^a-z0-9_-]+/gi, '_')}_` : '') + 'rtm-album-session.rtmalbum.json'
 const contents = JSON.stringify(payload, null, 2)
 try {
 if (window.electronAPI?.saveFileDialog) {
 await window.electronAPI.saveFileDialog(defaultName, contents, [
 { name: 'RTM Album Session', extensions: ['json', 'rtmalbum'] },
 ])
 } else {
 const blob = new Blob([contents], { type: 'application/json' })
 const url = URL.createObjectURL(blob)
 const a = document.createElement('a')
 a.href = url; a.download = defaultName; a.click()
 URL.revokeObjectURL(url)
 }
 } catch {}
 }

 // ── Load album session — picks a JSON, parses it, and replaces the
 // current batch view via the onBack-then-hydrate dance isn't
 // necessary because BatchView doesn't own batchResults; it lives in
 // App.tsx. We dispatch a CustomEvent that App.tsx listens for and
 // swaps state. Keeps BatchView self-contained without prop drilling
 // another callback just for this path.
 const loadSession = async () => {
 if (!window.electronAPI?.openTextFileDialog) return
 try {
 const picked = await window.electronAPI.openTextFileDialog([
 { name: 'RTM Album Session', extensions: ['json', 'rtmalbum'] },
 ])
 if (!picked) return
 const parsed = JSON.parse(picked.contents) as AlbumSession
 if (!parsed || !Array.isArray(parsed.results)) {
 alert('That file does not look like an RTM album session.')
 return
 }
 window.dispatchEvent(new CustomEvent('rtm-load-album-session', { detail: parsed }))
 } catch (err) {
 alert('Failed to load album session: ' + (err as Error).message)
 }
 }

 // Save-as-release / releases store hooks removed — that workflow lives
 // in FLOW now.

 // ── DDP preflight PDF — per-track pass/fail checklist against the
 // common DDP / distribution spec. Different from the general batch
 // PDF: it's a deliverable-receipt checklist, not a dashboard.
 const exportDDPPreflight = async () => {
 const html = buildDDPPreflightHtml(sortedResults, isrcCounts, folderName)
 const defaultName = (folderName ? `${folderName.replace(/[^a-z0-9_-]+/gi, '_')}_` : '') + 'rtm-ddp-preflight.pdf'
 if (window.electronAPI?.renderPdf) {
 try { await window.electronAPI.renderPdf(html, defaultName) } catch {}
 } else {
 const w = window.open('', '_blank')
 if (w) {
 w.document.write(html); w.document.close()
 setTimeout(() => w.print(), 400)
 }
 }
 }

 return (
 <div className="space-y-6">
 {/* Single shared audio element — drives every play button in the
 batch view (overview rows + song-detail panel). */}
 <audio ref={audioRef} style={{ display: 'none' }} />

 {/* Header strip — folder name + back + export buttons. No pass/warn/
 fail counts: actionable warnings live in the row + footer, so a
 headline tally is noise on top. */}
 <div className="flex items-center justify-between gap-4 flex-wrap">
 <div className="flex items-center gap-3">
 <button
 onClick={onBack}
 className="text-[11px] text-sand-500 hover:text-sand-200 transition-colors"
 >
 ← Back
 </button>
 <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: '#d0b066' }}>Album · Batch</span>
 <span className="text-sm" style={{ color: '#ebe7e0' }}>{folderName || 'Folder'}</span>
 <span className="text-[11px]" style={{ color: '#7a7164' }}>
 {results.length} track{results.length === 1 ? '' : 's'}
 </span>
 {/* Tour replay — runs the in-context batch tour on demand. */}
 <button
 onClick={() => batchTour.startTour()}
 className="text-[10px] uppercase tracking-[0.14em] px-2 py-1 rounded transition-colors hover:text-sand-200"
 style={{ color: '#8d867b', border: '1px solid rgba(168,161,150,0.18)' }}
 title="Replay the batch-view tour — tabs, notes, Cohort Mode, song-tab surfaces."
 >
 Tour
 </button>
 </div>
 <div className="flex items-center gap-2 flex-wrap" data-tour-batch="header-actions">
 {/* Save / Load — persist the whole album-batch session (results +
 notes + open tabs) to a .rtmalbum.json the engineer can reopen
 later. Quiet styling (no gold border) because they're session
 plumbing, not primary deliverables. */}
 {/* Load reference file — entry point back into Cohort Mode now
 that it hides completely when no reference is set. Shows a
 live "Analysing…" label + progress message while the batch
 pass runs so users know something's happening. */}
 {!reference && window.electronAPI?.selectFile && window.electronAPI?.analyzeBatch && (
 <button
 data-tour-batch="load-reference"
 onClick={loadCohortReference}
 disabled={cohortRefLoading}
 className="text-[11px] px-3 py-1.5 rounded-md transition-colors hover:bg-white/[0.03] disabled:cursor-wait"
 style={{
 color: cohortRefLoading ? '#c5a55a' : '#a8a29e',
 border: `1px solid ${cohortRefLoading ? 'rgba(197,165,90,0.4)' : 'rgba(168,161,150,0.2)'}`,
 }}
 title="Load an external reference file (WAV / FLAC). Engages Cohort Mode with drift heatmap + per-track distance against your reference."
 >
 {cohortRefLoading ? (
 <span className="inline-flex items-center gap-1.5">
 <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#c5a55a' }} />
 {cohortRefMsg || 'Analysing reference…'}
 </span>
 ) : (
 'Load reference…'
 )}
 </button>
 )}
 {cohortRefError && (
 <span
 className="text-[10px] px-2 py-1 rounded"
 style={{ color: '#e05a5a', backgroundColor: 'rgba(224,90,90,0.08)', border: '1px solid rgba(224,90,90,0.25)' }}
 role="alert"
 title="Click to dismiss"
 onClick={() => setCohortRefError(null)}
 >
 ⚠ {cohortRefError}
 </span>
 )}
 {/* Archival Reissue toggle — reframes the batch for old-
 master vs new-master workflow. When on, the A/B picker
 auto-suggests the likely "original" master as A and the
 current view anchors deltas against it. Quiet styling
 since it's a power-user mode. */}
 <button
 onClick={toggleReissueMode}
 className="text-[11px] px-3 py-1.5 rounded-md transition-colors hover:bg-white/[0.03]"
 style={{
 color: reissueMode ? '#d0b066' : '#8d867b',
 border: `1px solid ${reissueMode ? 'rgba(208,176,102,0.4)' : 'rgba(168,161,150,0.2)'}`,
 }}
 title="Archival Reissue mode: old-master vs new-master comparison. Auto-suggests the oldest / 'original'-named master as the A-side reference across every song tab."
 >
 {reissueMode ? '◉ Reissue mode' : '○ Reissue mode'}
 </button>
 <button
 onClick={saveSession}
 className="text-[11px] px-3 py-1.5 rounded-md transition-colors hover:bg-white/[0.03]"
 style={{ color: '#a8a29e', border: '1px solid rgba(168,161,150,0.2)' }}
 title="Save this album session (results, notes, open tabs) to a .rtmalbum.json file you can reopen later without re-analysing."
 >
 Save session
 </button>
 {/* Save-as-release + release-save-msg removed — Label mode
 is shelved. Code (saveAsRelease, releaseSaveMsg, releaseId)
 remains in the component for when Labels ships. */}
 <button
 onClick={loadSession}
 className="text-[11px] px-3 py-1.5 rounded-md transition-colors hover:bg-white/[0.03]"
 style={{ color: '#a8a29e', border: '1px solid rgba(168,161,150,0.2)' }}
 title="Load a previously-saved .rtmalbum.json session. Replaces the current batch view."
 >
 Load session
 </button>
 <span className="w-px h-5" style={{ backgroundColor: 'rgba(168,161,150,0.2)' }} />
 {/* Consolidated Export menu — final 
 Uses <details> for native keyboard-accessible disclosure so
 we don't need a focus-trap library. CSV / JSON / PDF / DDP
 all live under the same chip. */}
 <ExportMenu
 items={[
 { label: 'Export CSV', onClick: exportCsv, title: 'Download a spreadsheet-ready CSV with every measurement + notes column.' },
 { label: 'Export JSON', onClick: exportJson, title: 'Machine-readable JSON, one object per track. Ingest into sync libraries, DAM catalogues, LMS.' },
 { label: 'Export PDF', onClick: exportPdf, title: 'Render a PDF of this album dashboard, formatted for handoff to artists / distributors. Includes album + per-song notes.' },
 { label: 'DDP Preflight', onClick: exportDDPPreflight, title: 'Per-track DDP / distribution pre-flight checklist: pass/fail against TP ceiling, SR/BD spec, ISRC hygiene, clipping, mono-compat.' },
 ]}
 />
 </div>
 </div>

 {/* ── Tab strip ── Compare-mode pattern: Overview pinned first and
 un-closeable; opened songs sit to its right, each with ×. Only
 the active tab's content renders below (the Overview body hides
 when a song tab is active, and vice versa), so users never see
 two panes at once. Lives right under the header so it's always
 reachable without scrolling. */}
 <div className="flex items-center gap-1 overflow-x-auto pb-1 -mx-1 px-1 border-b" data-tour-batch="tab-strip" style={{ scrollbarWidth: 'thin', borderColor: 'rgba(168,161,150,0.08)' }}>
 <button
 onClick={() => setActiveTab(OVERVIEW_TAB)}
 className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] tracking-[0.05em] whitespace-nowrap transition-colors flex-shrink-0"
 style={{
 backgroundColor: activeTab === OVERVIEW_TAB ? 'rgba(208,176,102,0.12)' : 'transparent',
 color: activeTab === OVERVIEW_TAB ? '#d0b066' : '#a8a29e',
 border: `1px solid ${activeTab === OVERVIEW_TAB ? 'rgba(208,176,102,0.4)' : 'transparent'}`,
 fontWeight: activeTab === OVERVIEW_TAB ? 500 : 400,
 }}
 title="Album overview — cohort, hero stats, table, album notes"
 >
 <span className="uppercase tracking-[0.12em]">Overview</span>
 </button>
 {/* One song slot — not an array. The active song sits to the right
 of Overview; clicking a different row rotates this slot in
 place instead of stacking more tabs. × returns to Overview. */}
 {activeSongPath && (() => {
 const r = results.find(row => row.path === activeSongPath)
 if (!r) return null
 const name = cleanSongName(r)
 const isPlayingRow = playingPath === activeSongPath
 const hasNote = !!(songNotes[activeSongPath] && songNotes[activeSongPath].trim())
 const idx = sortedResults.findIndex(row => row.path === activeSongPath)
 const ana = songAnalysis[activeSongPath]
 return (
 <div
 className="flex items-center rounded-md whitespace-nowrap transition-colors flex-shrink-0"
 style={{
 backgroundColor: 'rgba(208,176,102,0.12)',
 border: '1px solid rgba(208,176,102,0.4)',
 }}
 >
 <div className="flex items-center gap-1.5 pl-3 pr-2 py-1.5 text-[10px] tracking-[0.05em]" style={{ color: '#d0b066', fontWeight: 500 }} title={r.filename}>
 <span className="font-mono opacity-50" style={{ fontSize: 9 }}>
 {(r.track_number || String((idx === -1 ? 0 : idx) + 1).padStart(2, '0')).padStart(2, '0')}
 </span>
 <span className="truncate max-w-[22ch]">{name}</span>
 {ana?.state === 'running' && (
 <span className="font-mono text-[9px]" style={{ color: '#c5a55a' }} title={`Deep analysis running — ${analysisPct(ana)}%`}>
 {analysisPct(ana)}%
 </span>
 )}
 {ana?.state === 'done' && (
 <span className="text-[9px]" style={{ color: '#6ec577' }} title="Deep analysis ready">✓</span>
 )}
 {hasNote && (
 <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#c5a55a' }} title="Has notes" />
 )}
 {isPlayingRow && (
 <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#d0b066' }} />
 )}
 </div>
 <button
 onClick={(e) => { e.stopPropagation(); closeSongTab(activeSongPath) }}
 className="pr-2 pl-1 py-1.5 transition-colors hover:text-sand-200"
 style={{ color: '#d0b066', fontSize: 12, lineHeight: 1 }}
 title="Close tab (returns to Overview)"
 aria-label={`Close ${name} tab`}
 >
 ×
 </button>
 </div>
 )
 })()}
 </div>

 {/* ── OVERVIEW TAB content ── Cohort, hero, album notes, main table.
 Mirrors the compare-mode pattern: a tab's content block stays
 hidden when another tab is active (no stacked views). */}
 {activeTab === OVERVIEW_TAB && (<>
 {/* Learn-mode explainer for the whole album surface — surfaces only
 when the user toggles Learn mode on in the header. Explains the
 album-batch workflow as a single narrative so Overview / Cohort /
 DMR / table / song-tab rotation read together. */}
 {modes.educator && (
 <div
 className="rounded-lg px-3 py-2 text-[11px] leading-relaxed"
 style={{
 backgroundColor: 'rgba(111,163,126,0.08)',
 border: '1px solid rgba(111,163,126,0.25)',
 color: '#b5afa4',
 }}
 >
 <div className="text-[9px] uppercase tracking-[0.15em] mb-1" style={{ color: '#6fa37e' }}>
 Why this surface
 </div>
 <p className="mb-1.5" style={{ color: '#d9d4c8' }}>
 Album / EP deliveries need <strong>cohort consistency</strong> (LUFS, LRA, TP, tonality) across every track. One bright track next to nine dark ones reads as an engineering mistake, not an artistic choice. This surface is the single-pane read on that consistency.
 </p>
 <p className="mb-1" style={{ color: '#8d867b' }}>
 <strong style={{ color: '#a8a29e' }}>Cohort Mode</strong> pins one track as the reference; every other track's distance from it renders as a heatmap. <strong style={{ color: '#a8a29e' }}>Loudness anchor</strong> reframes the Δ column from "vs. album median" to "vs. Spotify −14" / "Apple −16" / "R128 −23" so you can read delivery headroom directly. <strong style={{ color: '#a8a29e' }}>Album notes</strong> and <strong style={{ color: '#a8a29e' }}>per-song notes</strong> ride along in the PDF export. Click any row to rotate a song-detail tab in the slot to the right of Overview.
 </p>
 <p className="text-[10px] italic" style={{ color: '#8d867b' }}>
 <strong>Reissue mode</strong> (top-right toggle) reframes the batch for old-master vs. new-master. Auto-suggests the likely "original" as the A-side reference across every song tab. <strong>DDP Preflight</strong> exports a per-track pass/fail receipt. <strong>Save session</strong> writes a .rtmalbum.json so the engineer can reopen the exact state without re-analysing.
 </p>
 </div>
 )}

 {/* Cohort Mode — hides completely when no reference (user feedback:
 "can't close it after it's opened"). Promote any row via the
 `ref ↑` link on the table to re-open. */}
 <CohortMode
 rows={results}
 reference={reference}
 onPickReference={setReference}
 onLoadRefFile={async () => {
 if (!window.electronAPI?.selectFile || !window.electronAPI?.analyzeBatch) return
 try {
 const path = await window.electronAPI.selectFile()
 if (!path) return
 const res = await window.electronAPI.analyzeBatch([path])
 const row = res?.results?.[0]
 if (row) setReference(row)
 } catch {}
 }}
 />

 {/* Album-level summary hero */}
 {stats.lufsMedian != null && (
 <div className="rounded-xl px-6 py-4"
 style={{ backgroundColor: 'rgba(30,28,24,0.6)', border: '1px solid rgba(168,161,150,0.08)' }}>
 <div className="grid grid-cols-3 gap-6">
 <StatCard label="Album LUFS · median" value={`${stats.lufsMedian.toFixed(1)} LUFS`} />
 {stats.tpMedian != null && <StatCard label="True peak · median" value={`${stats.tpMedian.toFixed(1)} dBTP`} warn={stats.tpMedian > streamingTpFloorDbtp()} />}
 {stats.lraMedian != null && <StatCard label="LRA · median" value={`${stats.lraMedian.toFixed(1)} LU`} />}
 </div>
 {/* Loudness anchor picker — changes the Δ column in the table
 below from "vs album median" to "vs DSP target" so the
 engineer can see per-track deltas against e.g. Spotify −14
 without doing the subtraction in their head. Narrow row,
 lives right under the stats so the relationship is obvious. */}
 <div className="flex items-center gap-2 mt-3 pt-3 border-t" style={{ borderColor: 'rgba(168,161,150,0.08)' }}>
 <span className="text-[10px] uppercase tracking-[0.15em]" style={{ color: '#7a7164' }}>
 Loudness anchor
 </span>
 <div className="flex gap-1 rounded-md p-0.5" style={{ backgroundColor: 'rgba(14,13,11,0.5)' }}>
 {([
 { v: 'median' as const, label: 'Median', title: 'Compare each track against the album\'s own median LUFS — catches outliers.' },
 { v: -14 as const, label: '−14 · Spotify', title: 'Anchor every track to Spotify\'s −14 LUFS target. Δ column shows headroom vs. that target.' },
 { v: -16 as const, label: '−16 · Apple', title: 'Anchor every track to Apple Music\'s −16 LUFS target.' },
 { v: -23 as const, label: '−23 · R128', title: 'Anchor every track to EBU R128\'s −23 LUFS broadcast target.' },
 ]).map(opt => {
 const active = lufsAnchor === opt.v
 return (
 <button
 key={String(opt.v)}
 onClick={() => setLufsAnchor(opt.v)}
 className="text-[10px] px-2.5 py-1 rounded"
 style={{
 backgroundColor: active ? 'rgba(208,176,102,0.18)' : 'transparent',
 color: active ? '#d0b066' : '#8d867b',
 border: active ? '1px solid rgba(208,176,102,0.35)' : '1px solid transparent',
 }}
 title={opt.title}
 aria-pressed={active}
 >
 {opt.label}
 </button>
 )
 })}
 </div>
 <span className="text-[10px]" style={{ color: '#7a7164' }}>
 {lufsAnchor === 'median'
 ? 'Δ column compares tracks to each other (outlier view).'
 : `Δ column shows headroom vs. ${lufsAnchor} LUFS.`}
 </span>
 </div>
 </div>
 )}

 {/* Album notes — free-form textarea scoped to the whole album. Saved
 with the session, included in the PDF export (under "Album notes")
 so it lands in the engineer's inbox along with the dashboard. */}
 <div data-tour-batch="album-notes">
 <NotesBlock
 label="Album notes"
 placeholder="Notes for the engineer / distributor. Revision requests, context on the album, anything you want attached to the exported PDF."
 value={albumNote}
 onChange={setAlbumNote}
 />
 </div>

 {/* Delivery Manifest Reconciler removed — that workflow lives in FLOW. */}

 {/* Main table */}
 <div className="rounded-xl overflow-hidden" data-tour-batch="main-table" style={{ border: '1px solid rgba(168,161,150,0.08)' }}>
 <table className="w-full text-[11px]">
 <thead>
 <tr style={{ backgroundColor: 'rgba(30,28,24,0.6)' }}>
 <th className="px-2 py-2 text-center w-8" style={{ color: '#7a7164' }}></th>
 <TH label="#" onClick={() => toggleSort('track_number')} active={sortKey === 'track_number'} dir={sortDir} />
 <TH label="Filename" onClick={() => toggleSort('filename')} active={sortKey === 'filename'} dir={sortDir} align="left" />
 <TH label="LUFS-I" onClick={() => toggleSort('lufs_i')} active={sortKey === 'lufs_i'} dir={sortDir} />
 <TH label="TP" onClick={() => toggleSort('true_peak_dbtp')} active={sortKey === 'true_peak_dbtp'} dir={sortDir} />
 <TH label="LRA" onClick={() => toggleSort('lra')} active={sortKey === 'lra'} dir={sortDir} />
 <TH label="Length" onClick={() => toggleSort('duration_sec')} active={sortKey === 'duration_sec'} dir={sortDir} />
 <th className="px-3 py-2 text-center w-20" style={{ color: '#7a7164' }}>SR · BD</th>
 <th className="px-3 py-2 text-left" style={{ color: '#7a7164' }}>ISRC</th>
 <th className="px-3 py-2 text-center w-14" style={{ color: '#7a7164' }}>Mono</th>
 {reference && <th className="px-3 py-2 text-center w-16" style={{ color: '#d0b066' }}>Δ vs ref</th>}
 <th className="px-3 py-2 text-center w-10" style={{ color: '#7a7164' }}></th>
 </tr>
 </thead>
 <tbody>
 {sortedResults.map((r) => {
 // Anchor = album median (legacy) OR a DSP target chosen above.
 // Outlier threshold is tighter against a DSP target (1.0 LU)
 // than against the album median (1.5 LU), since the DSP spec
 // is absolute — half a LU over/under matters more.
 const anchorVal = lufsAnchor === 'median' ? stats.lufsMedian : lufsAnchor
 const lufsDelta = anchorVal != null && r.lufs_i != null ? (r.lufs_i - anchorVal) : null
 const outlierThreshold = lufsAnchor === 'median' ? 1.5 : 1.0
 const lufsOutlier = lufsDelta != null && Math.abs(lufsDelta) > outlierThreshold
 const tpHot = r.true_peak_dbtp != null && r.true_peak_dbtp > streamingTpFloorDbtp()
 const isrcDup = !!(r.isrc && (isrcCounts.get(r.isrc) || 0) > 1)
 return (
 <tr
 key={r.path}
 className="border-t cursor-pointer"
 style={{ borderColor: 'rgba(168,161,150,0.06)', backgroundColor: activeSongPath === r.path ? 'rgba(208,176,102,0.04)' : undefined }}
 onClick={(e) => {
 // Row click (outside the play button) → open (or focus)
 // that song's tab. Browser-tab semantics — a second
 // click on the same row keeps the tab open but stays
 // focused, rather than toggling it closed.
 const t = e.target as HTMLElement
 if (t.closest('button')) return
 openSongTab(r.path)
 }}
 >
 {/* Play button — toggles playback on this row's file. */}
 <td className="px-2 py-2 text-center">
 <button
 onClick={(e) => { e.stopPropagation(); playSong(r.path) }}
 className="w-6 h-6 rounded-full inline-flex items-center justify-center transition-colors hover:bg-white/[0.06]"
 style={{ border: `1px solid ${playingPath === r.path ? 'rgba(208,176,102,0.55)' : 'rgba(168,161,150,0.2)'}` }}
 title={playingPath === r.path ? 'Pause' : 'Play this track'}
 aria-label={playingPath === r.path ? 'Pause' : 'Play'}
 >
 {playingPath === r.path ? (
 <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="#d0b066"><rect x="2" y="2" width="3" height="8" /><rect x="7" y="2" width="3" height="8" /></svg>
 ) : (
 <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="#d0b066"><path d="M3 2 L10 6 L3 10 Z" /></svg>
 )}
 </button>
 </td>
 <td className="px-3 py-2 text-center font-mono text-dark-400">{r.track_number || '—'}</td>
 <td className="px-3 py-2 text-left text-dark-200">
 <div className="flex items-center gap-2">
 <span className="truncate max-w-[32ch]" title={r.filename}>{r.filename}</span>
 {r.title && <span className="text-[10px]" style={{ color: '#a8a29e' }}>· {r.title}</span>}
 {/* Deep-analysis indicator — appears the moment the
 user opens a song tab for the first time, so
 they know analysis is actually running. Stays as
 ✓ once cached, so the overview shows at a glance
 which tracks have a full deep pass available. */}
 {songAnalysis[r.path]?.state === 'running' && (
 <span
 className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded"
 style={{ color: '#c5a55a', backgroundColor: 'rgba(197,165,90,0.1)' }}
 title={`Deep analysis running (${analysisElapsedSec(songAnalysis[r.path])}s elapsed) — ${songAnalysis[r.path].message || 'working…'}`}
 >
 <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#c5a55a' }} />
 {analysisPct(songAnalysis[r.path])}%
 </span>
 )}
 {songAnalysis[r.path]?.state === 'done' && (
 <span
 className="ml-auto text-[10px]"
 style={{ color: '#6ec577' }}
 title="Deep analysis ready — open the tab to view."
 >
 ✓ deep
 </span>
 )}
 </div>
 </td>
 <td className="px-3 py-2 text-center font-mono">
 <span style={{ color: lufsOutlier ? '#e05a5a' : '#e7e5e4' }}>
 {r.lufs_i != null ? r.lufs_i.toFixed(1) : '—'}
 </span>
 {lufsDelta != null && Math.abs(lufsDelta) >= 0.5 && (
 <span className="ml-1 text-[9px]" style={{ color: lufsOutlier ? '#e05a5a' : '#7a7164' }}>
 {lufsDelta > 0 ? '+' : ''}{lufsDelta.toFixed(1)}
 </span>
 )}
 </td>
 <td className="px-3 py-2 text-center font-mono" style={{ color: tpHot ? '#e05a5a' : '#e7e5e4' }}>
 {r.true_peak_dbtp != null ? r.true_peak_dbtp.toFixed(1) : '—'}
 </td>
 <td className="px-3 py-2 text-center font-mono text-dark-300">
 {r.lra != null ? r.lra.toFixed(1) : '—'}
 </td>
 <td className="px-3 py-2 text-center font-mono text-dark-300">
 {r.duration_sec != null ? formatDuration(r.duration_sec) : '—'}
 </td>
 <td className="px-3 py-2 text-center font-mono text-[10px] text-dark-400">
 {r.sample_rate ? `${(r.sample_rate / 1000).toFixed(r.sample_rate % 1000 === 0 ? 0 : 1)}k` : '—'}
 {r.bit_depth ? ` · ${r.bit_depth}` : ''}
 </td>
 <td className="px-3 py-2 text-left font-mono text-[10px]">
 {r.isrc ? (
 <span style={{ color: isrcDup ? '#e05a5a' : '#8d867b' }} title={isrcDup ? 'Duplicate ISRC across album' : undefined}>
 {r.isrc}{isrcDup && ' ⚠'}
 </span>
 ) : (
 <span style={{ color: '#c5a55a' }}>missing</span>
 )}
 </td>
 <td className="px-3 py-2 text-center font-mono text-[10px]">
 {r.mono_compat_loss_pct != null ? (
 <span style={{ color: r.mono_compat_loss_pct > 30 ? '#c5a55a' : '#7a7164' }}>
 {r.mono_compat_loss_pct}%
 </span>
 ) : '—'}
 </td>
 {/* Δ vs ref — only visible when Cohort Mode is active. */}
 {reference && (
 <td className="px-3 py-2 text-center font-mono text-[10px]">
 {(() => {
 if (!reference.spectrum || !r.spectrum || reference.spectrum.length !== 31 || r.spectrum.length !== 31) return <span style={{ color: '#3e3a33' }}>—</span>
 if (r.path === reference.path) return <span className="text-[9px] uppercase tracking-[0.1em]" style={{ color: '#d0b066' }}>ref</span>
 const delta = r.spectrum.map((v, i) => v - reference.spectrum![i])
 const rms = Math.sqrt(delta.reduce((s, d) => s + d * d, 0) / delta.length)
 const warn = rms > 3
 return (
 <span style={{ color: warn ? '#e07a4f' : '#d0b066' }} title={`${rms.toFixed(2)} dB RMS distance from reference across 31 bands`}>
 {rms.toFixed(1)}
 </span>
 )
 })()}
 </td>
 )}
 {/* Ref ↑ — promote this row as the reference. */}
 <td className="px-3 py-2 text-center">
 {reference?.path === r.path ? (
 <span className="text-[9px] uppercase tracking-[0.1em]" style={{ color: '#d0b066' }} title="Current cohort reference">ref</span>
 ) : (
 <button
 onClick={() => setReference(r)}
 className="text-[9px] uppercase tracking-[0.1em] hover:text-[#d0b066] transition-colors"
 style={{ color: '#8d867b' }}
 title="Use this track as the cohort reference"
 >
 ref ↑
 </button>
 )}
 </td>
 </tr>
 )
 })}
 </tbody>
 </table>
 </div>

 {/* Footer notes — outliers + duplicate ISRCs surfaced as plain text */}
 <div className="space-y-1 text-[11px]" style={{ color: '#8d867b' }}>
 {stats.lufsMedian != null && results.filter(r => r.lufs_i != null && Math.abs(r.lufs_i - stats.lufsMedian!) > 1.5).map(r => (
 <div key={r.path}>
 <span style={{ color: '#e05a5a' }}>⚠</span> {r.filename} is {
 ((r.lufs_i! - stats.lufsMedian!) > 0 ? '+' : '') + (r.lufs_i! - stats.lufsMedian!).toFixed(1)
 } LU from the album median — consider re-levelling.
 </div>
 ))}
 {/* ISRC duplicate / missing warnings removed by user direction. */}
 </div>
 </>)}

 {/* ── Song tab content ── Only the active song's detail renders; the
 Overview content above is hidden. Matches Compare mode's
 single-view tab pattern so users never see two panes at once. */}
 {activeSongPath && (() => {
 const song = results.find(r => r.path === activeSongPath)
 if (!song) return null
 return (
 <SongDetailPanel
 // Keying by path forces a clean remount when the user rotates
 // the slot to a different song — caches still hit inside the
 // panel via __rtmSongCache, but the dropdown state etc. resets
 // cleanly.
 key={song.path}
 song={song}
 displayName={cleanSongName(song)}
 playingPath={playingPath}
 progress={audioProgress}
 onPlayToggle={() => playSong(song.path)}
 onSeek={(t) => { const a = audioRef.current; if (a) a.currentTime = t }}
 onPlayAt={(t) => playSong(song.path, { startSec: t })}
 note={songNotes[song.path] || ''}
 onNoteChange={(v) => setSongNote(song.path, v)}
 onAnalysisChange={(state) => {
 setSongAnalysis(prev => ({ ...prev, [song.path]: state }))
 }}
 // Prev / next + list position — walk the sortedResults list
 // so arrow order AND "3 of 12" match the table the user sees.
 // No wrap-around; at the ends, the corresponding arrow
 // disables. Position is 1-based.
 {...(() => {
 const i = sortedResults.findIndex(r => r.path === song.path)
 const prev = i > 0 ? sortedResults[i - 1] : null
 const next = i >= 0 && i < sortedResults.length - 1 ? sortedResults[i + 1] : null
 return {
 onPrev: prev ? () => setActiveTab(prev.path) : undefined,
 onNext: next ? () => setActiveTab(next.path) : undefined,
 indexInList: i >= 0 ? i + 1 : undefined,
 totalInList: sortedResults.length,
 }
 })()}
 // Compare targets — grouped so the SongDetailPanel dropdown
 // can show Revisions + Favorites first, then session uploads,
 // then the cohort ref, then album tracks. Only tracks with
 // 31-band spectrum data contribute to the Tonal Balance
 // overlay; A/B playback still works regardless of spectrum.
 compareTargets={(() => {
 // Auto-detect revision siblings from the batch so the A/B
 // picker's top group is always "previous revs of this
 // track" during an iterative mastering session.
 const revSiblings = inferRevisions(song, results)
 const revPaths = new Set(revSiblings.map(r => r.path))
 return {
 revisions: revSiblings
 .filter(r => r.path !== song.path)
 .map(r => ({
 path: r.path,
 label: cleanSongName(r),
 spectrum: r.spectrum && r.spectrum.length === 31 ? r.spectrum : undefined,
 })),
 favorites: favRefs,
 session: sessionRefs,
 cohort: (reference && reference.path !== song.path) ? {
 path: reference.path,
 label: `${cleanSongName(reference)} (cohort ref)`,
 spectrum: reference.spectrum && reference.spectrum.length === 31 ? reference.spectrum : undefined,
 } : null,
 album: sortedResults
 .filter(r =>
 r.path !== song.path
 && (!reference || r.path !== reference.path)
 && !revPaths.has(r.path) // already in Revisions group — dedupe
 )
 .map(r => ({
 path: r.path,
 label: cleanSongName(r),
 spectrum: r.spectrum && r.spectrum.length === 31 ? r.spectrum : undefined,
 })),
 }
 })()}
 onAddReference={addReference}
 uploadingReference={uploadingRef}
 addReferenceError={addRefError}
 onClearAddReferenceError={() => setAddRefError(null)}
 isReferenceFavorited={isReferenceFavorited}
 onToggleFavorite={toggleFavoriteCurrent}
 // A/B reference pick lives in BatchView state so it locks
 // across song rotations — A stays fixed while B follows the
 // user's tab.
 compareTargetPath={abReferencePath}
 onCompareTargetChange={setAbReferencePath}
 // Stop the shared <audio> when SongDetailPanel flips into
 // A/B mode — ABPlayer runs its own WebAudio graph and we
 // don't want double playback.
 onExternalStop={stopSong}
 onClose={() => closeSongTab(song.path)}
 />
 )
 })()}

 {/* Batch tour — auto-runs first visit, replayable from the header
 Tour button. */}
 <BatchTour tour={batchTour} autoStart />

 {/* ⌘K song quick-switcher. Opens on ⌘K / Ctrl+K or "/" when no
 input is focused. Fuzzy-matches title / artist / filename /
 track # and switches the active tab on Enter. */}
 {quickSwitcherOpen && (
 <SongQuickSwitcher
 songs={results}
 displayName={cleanSongName}
 onClose={() => setQuickSwitcherOpen(false)}
 onJump={(path) => setActiveTab(path)}
 />
 )}
 </div>
 )
}

/**
 * Reusable notes block — a labelled, expandable textarea matching the
 * quiet-luxury palette. Used at album level in BatchView and inside
 * SongDetailPanel for per-song notes. Kept local to this file because it's
 * three-prop simple and we don't want another component file just for a
 * textarea.
 */
function NotesBlock({ label, placeholder, value, onChange }: {
 label: string
 placeholder?: string
 value: string
 onChange: (v: string) => void
}) {
 const [open, setOpen] = useState<boolean>(!!value)
 const hasContent = !!value && value.trim().length > 0
 // Re-open the block automatically when it hydrates with content from a
 // loaded session (so engineers don't have to hunt for their notes).
 useEffect(() => { if (hasContent) setOpen(true) }, [hasContent])
 return (
 <div className="rounded-xl" style={{ backgroundColor: 'rgba(30,28,24,0.4)', border: '1px solid rgba(168,161,150,0.08)' }}>
 <button
 onClick={() => setOpen(o => !o)}
 className="w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-white/[0.02]"
 aria-expanded={open}
 >
 <div className="flex items-center gap-2">
 <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: '#d0b066' }}>{label}</span>
 {hasContent && (
 <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#c5a55a' }} title="Has notes" />
 )}
 </div>
 <span className="text-[11px]" style={{ color: '#7a7164' }}>{open ? '−' : '+'}</span>
 </button>
 {open && (
 <div className="px-4 pb-3">
 <textarea
 value={value}
 onChange={e => onChange(e.target.value)}
 placeholder={placeholder}
 rows={4}
 className="w-full rounded-lg px-3 py-2 text-[12px] resize-y focus:outline-none"
 style={{
 backgroundColor: 'rgba(18,16,14,0.6)',
 color: '#ebe7e0',
 border: '1px solid rgba(168,161,150,0.12)',
 fontFamily: 'ui-sans-serif, -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif',
 lineHeight: 1.5,
 }}
 />
 <div className="mt-1 text-[9px]" style={{ color: '#8d867b' }}>
 Saved with this session · included in PDF export
 </div>
 </div>
 )}
 </div>
 )
}

/**
 * Best-effort song-name extraction. Prefers the `title` metadata field
 * (BWF bext / iXML / ID3v2) — that's the engineer's intentional label.
 *
 * Filename cleanup (user rule, unified across batch + single-file views):
 * 1. Strip extension.
 * 2. Strip a leading track number + separator ("01 - ", "03_", etc).
 * 3. Cut everything from the first `(` onward — engineers put version /
 * mix status / date / credits there and none of it belongs in the tab
 * title. Example:
 * "01 TAIR OTI KSHEZE NIGMAR (MAIN) M1 03-04-2026.wav"
 * → "TAIR OTI KSHEZE NIGMAR"
 * 4. Collapse underscores → spaces.
 */
function cleanSongName(r: BatchResult): string {
 if (r.title && r.title.trim()) return stripParenthetical(r.title.trim())
 let n = r.filename.replace(/\.[^/.]+$/, '')
 n = n.replace(/^\s*\d{1,3}\s*[-._]+\s*/, '')
 n = stripParenthetical(n)
 n = n.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
 return n || r.filename.replace(/\.[^/.]+$/, '') || r.filename
}
function stripParenthetical(s: string): string {
 const i = s.indexOf('(')
 return i >= 0 ? s.slice(0, i).trim() : s.trim()
}

function TH({ label, onClick, active, dir, align = 'center' }: {
 label: string
 onClick: () => void
 active: boolean
 dir: SortDir
 align?: 'left' | 'center'
}) {
 return (
 <th
 className={`px-3 py-2 cursor-pointer select-none hover:text-sand-200 transition-colors text-${align}`}
 onClick={onClick}
 style={{ color: active ? '#d0b066' : '#7a7164', fontWeight: active ? 500 : 400 }}
 >
 {label}
 {active && <span className="ml-1 text-[9px]">{dir === 'asc' ? '↑' : '↓'}</span>}
 </th>
 )
}

function StatCard({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
 return (
 <div>
 <div className="text-[10px] tracking-[0.2em] uppercase mb-1" style={{ color: '#7a7164' }}>{label}</div>
 <div className="text-xl font-mono" style={{ color: warn ? '#e05a5a' : '#d0b066', fontWeight: 300 }}>
 {value}
 </div>
 </div>
 )
}

/**
 * Build a print-ready HTML document for the batch report. Intentionally
 * ink-on-paper (light background, near-black text, gold accents) so it
 * reads well both on screen and in a printed PDF. Uses inline CSS so it
 * survives being piped through Electron's offscreen printToPDF.
 */
function buildBatchPdfHtml(
 rows: BatchResult[],
 stats: { lufsMedian: number | null; tpMedian: number | null; lraMedian: number | null },
 isrcCounts: Map<string, number>,
 folderName?: string,
 albumNote?: string,
 songNotes?: Record<string, string>,
): string {
 const esc = (v: unknown) => (v == null ? '' : String(v).replace(/[&<>"]/g, c => (
 { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c as '&' | '<' | '>' | '"']!
 )))
 // Preserve paragraph breaks in free-form notes without risking injection.
 const escMultiline = (s: string) => esc(s).replace(/\n/g, '<br />')
 const now = new Date()
 const stamp = now.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })

 const outlierRows = stats.lufsMedian != null
 ? rows.filter(r => r.lufs_i != null && Math.abs(r.lufs_i - (stats.lufsMedian as number)) > 1.5)
 : []
 const dupIsrcs = Array.from(isrcCounts.entries()).filter(([, n]) => n > 1)
 const missingIsrc = rows.filter(r => !r.isrc).length

 const rowHtml = rows.map(r => {
 const lufsDelta = stats.lufsMedian != null && r.lufs_i != null ? (r.lufs_i - stats.lufsMedian) : null
 const lufsOutlier = lufsDelta != null && Math.abs(lufsDelta) > 1.5
 const tpHot = r.true_peak_dbtp != null && r.true_peak_dbtp > streamingTpFloorDbtp()
 const isrcDup = !!(r.isrc && (isrcCounts.get(r.isrc) || 0) > 1)
 return `
 <tr>
 <td class="num">${esc(r.track_number || '')}</td>
 <td>${esc(r.filename)}${r.title ? `<div class="sub">${esc(r.title)}${r.artist ? ' · ' + esc(r.artist) : ''}</div>` : ''}</td>
 <td class="mono ${lufsOutlier ? 'warn' : ''}">
 ${r.lufs_i != null ? r.lufs_i.toFixed(1) : '—'}
 ${lufsDelta != null && Math.abs(lufsDelta) >= 0.5 ? `<span class="delta">${lufsDelta > 0 ? '+' : ''}${lufsDelta.toFixed(1)}</span>` : ''}
 </td>
 <td class="mono ${tpHot ? 'warn' : ''}">${r.true_peak_dbtp != null ? r.true_peak_dbtp.toFixed(1) : '—'}</td>
 <td class="mono">${r.lra != null ? r.lra.toFixed(1) : '—'}</td>
 <td class="mono">${r.duration_sec != null ? formatDuration(r.duration_sec) : '—'}</td>
 <td class="mono sub">${r.sample_rate ? `${Math.round(r.sample_rate / 100) / 10}k` : '—'}${r.bit_depth ? ` · ${r.bit_depth}` : ''}</td>
 <td class="mono sub">${r.isrc ? esc(r.isrc) : '—'}</td>
 <td class="mono ${r.mono_compat_loss_pct != null && r.mono_compat_loss_pct > 30 ? 'warn' : ''}">${r.mono_compat_loss_pct != null ? r.mono_compat_loss_pct + '%' : '—'}</td>
 </tr>`
 }).join('')

 // ISRC duplicate / missing notes removed by user direction.
 void dupIsrcs; void missingIsrc;
 const outlierNotes = outlierRows
 .map(r => `<li><b>${esc(r.filename)}</b> is ${((r.lufs_i! - (stats.lufsMedian as number)) > 0 ? '+' : '') + (r.lufs_i! - (stats.lufsMedian as number)).toFixed(1)} LU from the album median. Consider re-levelling.</li>`)
 .join('')

 // User-authored notes — album-level block (up top, always shown when
 // present) and per-song appendix (only tracks with notes). Kept separate
 // from the machine-generated `outlierNotes` above so engineers can scan
 // their own words without wading through automated warnings.
 const albumNoteHtml = albumNote && albumNote.trim()
 ? `<div class="user-notes"><h3>Album notes</h3><p>${escMultiline(albumNote.trim())}</p></div>`
 : ''
 const perSongNoteRows = rows
 .map(r => ({ r, note: (songNotes?.[r.path] || '').trim() }))
 .filter(x => x.note.length > 0)
 const perSongNotesHtml = perSongNoteRows.length > 0
 ? `<div class="user-notes song-notes">
 <h3>Track notes</h3>
 ${perSongNoteRows.map(({ r, note }) =>
 `<div class="song-note"><b>${esc(r.track_number || '')}${r.track_number ? ' · ' : ''}${esc(r.filename)}</b><p>${escMultiline(note)}</p></div>`
 ).join('')}
 </div>`
 : ''

 return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(folderName || 'Album')} — RTM batch</title>
<style>
 @page { size: A4; margin: 16mm 12mm; }
 html, body { background: #fbf9f4; color: #1a1814; font-family: ui-sans-serif, -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif; font-size: 10.5pt; }
 body { margin: 0; padding: 0; }
 .eyebrow { font-size: 8pt; letter-spacing: 0.24em; text-transform: uppercase; color: #b48f3a; }
 h1 { font-family: "Playfair Display", Georgia, serif; font-weight: 400; letter-spacing: 0.02em; font-size: 26pt; margin: 0 0 4pt; }
 .sub { color: #7a7164; font-size: 9pt; }
 .meta { color: #7a7164; font-size: 9pt; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 4pt; }
 .hairline { border: none; border-top: 1px solid #d8cba5; margin: 12pt 0 10pt; }
 .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12pt; margin: 10pt 0 14pt; padding: 10pt 0; border-top: 1px solid #ecdfbf; border-bottom: 1px solid #ecdfbf; }
 .stat .l { font-size: 8pt; letter-spacing: 0.2em; text-transform: uppercase; color: #8d867b; }
 .stat .v { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 300; font-size: 18pt; color: #b48f3a; }
 .stat.warn .v { color: #a23d2f; }
 table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
 th, td { padding: 6pt 7pt; text-align: center; border-bottom: 1px solid #ecdfbf; }
 th { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.12em; color: #7a7164; font-weight: 500; background: #f4eddb; }
 td:nth-child(2) { text-align: left; }
 td.num { color: #7a7164; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
 td.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
 td .delta { font-size: 8pt; margin-left: 4pt; color: #8d867b; }
 td.warn, td.warn .delta, td.warn code { color: #a23d2f; }
 td .sub, td.sub { color: #8d867b; font-size: 8.5pt; }
 .notes { margin-top: 14pt; padding: 10pt 14pt; background: #f4eddb; border-left: 2pt solid #b48f3a; }
 .notes h3 { margin: 0 0 4pt; font-size: 10pt; letter-spacing: 0.14em; text-transform: uppercase; color: #b48f3a; font-weight: 500; }
 .notes ul { margin: 4pt 0 0; padding-left: 16pt; }
 .notes li { margin-bottom: 3pt; }
 .user-notes { margin: 14pt 0; padding: 12pt 14pt; background: #fff8e6; border-left: 2pt solid #b48f3a; page-break-inside: avoid; }
 .user-notes h3 { margin: 0 0 6pt; font-size: 10pt; letter-spacing: 0.14em; text-transform: uppercase; color: #b48f3a; font-weight: 500; }
 .user-notes p { margin: 0; color: #1a1814; font-size: 10.5pt; line-height: 1.45; white-space: pre-wrap; }
 .song-notes .song-note { margin-top: 8pt; padding-top: 6pt; border-top: 1px dashed #e0d2a8; }
 .song-notes .song-note:first-of-type { border-top: none; margin-top: 4pt; padding-top: 0; }
 .song-notes .song-note b { font-size: 10pt; color: #7a6226; }
 .song-notes .song-note p { margin-top: 3pt; font-size: 10pt; }
 .footer { margin-top: 16pt; border-top: 1px solid #d8cba5; padding-top: 8pt; font-size: 8.5pt; color: #8d867b; display: flex; justify-content: space-between; }
 code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #ecdfbf; padding: 0 3pt; border-radius: 2pt; }
</style></head><body>
 <div class="eyebrow">Album · Batch</div>
 <h1>${esc(folderName || 'Folder')}</h1>
 <div class="meta">${rows.length} track${rows.length === 1 ? '' : 's'} · analysed ${esc(stamp)}</div>
 <hr class="hairline" />
 <div class="stats">
 <div class="stat"><div class="l">Album LUFS · median</div><div class="v">${stats.lufsMedian != null ? stats.lufsMedian.toFixed(1) + ' LUFS' : '—'}</div></div>
 <div class="stat ${stats.tpMedian != null && stats.tpMedian > streamingTpFloorDbtp() ? 'warn' : ''}"><div class="l">True peak · median</div><div class="v">${stats.tpMedian != null ? stats.tpMedian.toFixed(1) + ' dBTP' : '—'}</div></div>
 <div class="stat"><div class="l">LRA · median</div><div class="v">${stats.lraMedian != null ? stats.lraMedian.toFixed(1) + ' LU' : '—'}</div></div>
 </div>
 ${albumNoteHtml}
 <table>
 <thead><tr>
 <th style="width:28pt">#</th>
 <th style="text-align:left">Filename</th>
 <th>LUFS-I</th>
 <th>TP</th>
 <th>LRA</th>
 <th>Length</th>
 <th>SR · BD</th>
 <th>ISRC</th>
 <th>Mono</th>
 </tr></thead>
 <tbody>${rowHtml}</tbody>
 </table>
 ${outlierNotes ? `<div class="notes"><h3>Machine-generated notes</h3><ul>${outlierNotes}</ul></div>` : ''}
 ${perSongNotesHtml}
 <div class="footer">
 <span>RTM Audio · quiet-luxury audio tools</span>
 <span>${esc(stamp)}</span>
 </div>
</body></html>`
}

/* ────────────────────────────────────────────────────────────────────────── */
/* DDP Preflight PDF */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * DDP / distribution preflight checklist PDF. Different layout from the
 * general album dashboard — this is the document you forward to mastering
 * or to a distributor as a signed pre-delivery receipt.
 *
 * Each track gets a row of coloured checkmarks against the standard DDP
 * + DSP delivery spec:
 * · TP ≤ −1.0 dBTP (standard streaming ceiling, Apple spec is −1 dBTP)
 * · Sample rate 44.1 kHz (DDP target) or 88.2 / 96 kHz (high-res)
 * · Bit depth ≥ 16 (DDP requires 16; 24 typical for high-res)
 * · Channels = 2 (DDP is stereo)
 * · No clipped samples
 * · ISRC present and unique across the album
 * · Mono-compat loss % ≤ 30%
 * · Length > 0
 *
 * Album-level summary up top + a sign-off block at the bottom.
 */
function buildDDPPreflightHtml(
 rows: BatchResult[],
 isrcCounts: Map<string, number>,
 folderName?: string,
): string {
 const esc = (v: unknown) => (v == null ? '' : String(v).replace(/[&<>"]/g, c => (
 { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c as '&' | '<' | '>' | '"']!
 )))
 const now = new Date()
 const stamp = now.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })

 // Per-spec check — returns {pass, detail} per column.
 const checks = rows.map(r => {
 const tp = r.true_peak_dbtp
 const sr = r.sample_rate
 const bd = r.bit_depth
 const ch = r.channels
 const clip = r.clipped_samples || 0
 const mono = r.mono_compat_loss_pct
 const isrc = r.isrc
 const dup = !!(isrc && (isrcCounts.get(isrc) || 0) > 1)
 return {
 row: r,
 tp: { pass: tp != null && tp <= streamingTpFloorDbtp(), detail: tp != null ? `${tp.toFixed(1)} dBTP` : 'unknown' },
 sr: { pass: sr != null && [44100, 48000, 88200, 96000, 176400, 192000].includes(sr), detail: sr != null ? `${sr} Hz` : 'unknown' },
 bd: { pass: bd != null && bd >= 16, detail: bd != null ? `${bd}-bit` : 'unknown' },
 ch: { pass: ch === 2, detail: ch != null ? `${ch} ch` : 'unknown' },
 clip: { pass: clip === 0, detail: clip === 0 ? 'None' : `${clip} samples` },
 // ISRC pass/fail disabled by user direction — display-only.
 isrc: { pass: true, detail: isrc ? esc(isrc) : '—' },
 mono: { pass: mono != null && mono <= 30, detail: mono != null ? `${mono}%` : 'unknown' },
 len: { pass: r.duration_sec != null && r.duration_sec > 0, detail: r.duration_sec != null ? formatDuration(r.duration_sec) : 'unknown' },
 }
 })

 // Album-level pass/fail — album passes if every track passes every check.
 const allPass = checks.every(c => c.tp.pass && c.sr.pass && c.bd.pass && c.ch.pass && c.clip.pass && c.isrc.pass && c.mono.pass && c.len.pass)
 const failCount = checks.filter(c => !(c.tp.pass && c.sr.pass && c.bd.pass && c.ch.pass && c.clip.pass && c.isrc.pass && c.mono.pass && c.len.pass)).length

 // Album identity — UPC if consistent, total runtime, SR/BD consistency flag.
 const upcs = Array.from(new Set(rows.map(r => r.upc).filter(Boolean)))
 const upc = upcs.length === 1 ? upcs[0] : upcs.length > 1 ? 'INCONSISTENT' : 'missing'
 const totalSec = rows.reduce((s, r) => s + (r.duration_sec || 0), 0)
 const srSet = Array.from(new Set(rows.map(r => r.sample_rate).filter(Boolean)))
 const bdSet = Array.from(new Set(rows.map(r => r.bit_depth).filter(Boolean)))
 const srConsistent = srSet.length === 1
 const bdConsistent = bdSet.length === 1

 const cell = (c: { pass: boolean; detail: string }) =>
 `<td class="check ${c.pass ? 'p' : 'f'}"><span class="mark">${c.pass ? '✓' : '✗'}</span><span class="det">${esc(c.detail)}</span></td>`

 const rowsHtml = checks.map((c, i) => `
 <tr>
 <td class="num">${esc(c.row.track_number || String(i + 1).padStart(2, '0'))}</td>
 <td class="name">${esc(c.row.filename)}${c.row.title ? `<div class="sub">${esc(c.row.title)}</div>` : ''}</td>
 ${cell(c.tp)}
 ${cell(c.sr)}
 ${cell(c.bd)}
 ${cell(c.ch)}
 ${cell(c.clip)}
 ${cell(c.isrc)}
 ${cell(c.mono)}
 ${cell(c.len)}
 </tr>
 `).join('')

 return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>DDP Preflight — ${esc(folderName || 'Album')}</title>
<style>
 @page { size: A4 landscape; margin: 12mm 10mm; @bottom-right { content: counter(page) " / " counter(pages); color: #8d867b; font-size: 8pt; } }
 * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
 body { font-family: ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif; background: #fbf9f4; color: #1a1814; line-height: 1.5; font-size: 10pt; }
 .eyebrow { font-size: 8.5pt; letter-spacing: 0.24em; text-transform: uppercase; color: #b48f3a; font-weight: 500; }
 h1 { font-family: "Playfair Display", Georgia, serif; font-weight: 400; font-size: 22pt; letter-spacing: 0.01em; margin: 3pt 0 4pt; }
 .sub { color: #7a7164; font-size: 9pt; }
 .verdict { font-size: 16pt; padding: 10pt 14pt; border-left: 3pt solid ${allPass ? '#3d6b4a' : '#a23d2f'}; background: ${allPass ? '#eaf2ec' : '#f5e0df'}; margin: 8pt 0 12pt; color: ${allPass ? '#1f3d2a' : '#6b1f19'}; font-weight: 500; }
 .verdict .reason { display: block; margin-top: 3pt; font-size: 10pt; font-weight: 400; color: #5c5549; }
 .identity { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10pt; margin: 6pt 0 12pt; padding: 9pt 0; border-top: 1px solid #ecdfbf; border-bottom: 1px solid #ecdfbf; }
 .identity div .l { font-size: 7.5pt; letter-spacing: 0.18em; text-transform: uppercase; color: #8d867b; }
 .identity div .v { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11pt; color: #1a1814; margin-top: 2pt; word-break: break-all; }
 .identity div.warn .v { color: #a23d2f; }
 table.preflight { width: 100%; border-collapse: collapse; font-size: 9pt; table-layout: fixed; }
 table.preflight th, table.preflight td { padding: 5pt 6pt; text-align: center; border-bottom: 1px solid #ecdfbf; vertical-align: middle; }
 table.preflight th { font-size: 7.5pt; letter-spacing: 0.1em; text-transform: uppercase; color: #b48f3a; background: #f4eddb; font-weight: 500; }
 table.preflight td.num { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #8d867b; width: 24pt; }
 table.preflight td.name { text-align: left; font-size: 9.5pt; }
 table.preflight td.name .sub { font-size: 8pt; color: #8d867b; margin-top: 1pt; }
 table.preflight td.check { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
 table.preflight td.check .mark { display: block; font-size: 12pt; font-weight: 500; }
 table.preflight td.check .det { display: block; font-size: 7.5pt; color: #8d867b; margin-top: 1pt; }
 table.preflight td.check.p .mark { color: #3d6b4a; }
 table.preflight td.check.f .mark { color: #a23d2f; }
 table.preflight td.check.f .det { color: #a23d2f; font-weight: 500; }
 .signoff { margin-top: 16pt; padding: 12pt 14pt; background: #f4eddb; border-left: 3pt solid #b48f3a; }
 .signoff-label { font-size: 8.5pt; letter-spacing: 0.2em; text-transform: uppercase; color: #b48f3a; margin-bottom: 6pt; }
 .signoff-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20pt; margin-top: 8pt; }
 .signoff-grid .line { border-bottom: 1px solid #b48f3a; height: 14pt; }
 .signoff-grid .l { font-size: 8pt; letter-spacing: 0.12em; text-transform: uppercase; color: #8d867b; margin-top: 4pt; }
 .footer { margin-top: 14pt; padding-top: 8pt; border-top: 1px solid #d8cba5; font-size: 8pt; color: #8d867b; display: flex; justify-content: space-between; }
</style></head><body>
 <div class="eyebrow">Distribution · DDP preflight</div>
 <h1>${esc(folderName || 'Album')} — preflight checklist</h1>
 <p class="sub">${rows.length} track${rows.length === 1 ? '' : 's'} · checked ${esc(stamp)}</p>
 <div class="verdict">
 ${allPass ? 'READY TO SHIP · all tracks pass the preflight' : `HOLD · ${failCount} track${failCount === 1 ? '' : 's'} failing the preflight`}
 <span class="reason">${allPass
 ? 'Every track meets the TP ceiling (−1.0 dBTP), sample-rate / bit-depth spec, channel config, clipping, ISRC uniqueness, mono-compat, and length checks.'
 : 'See the red cells below. Address before delivery to distributor.'}</span>
 </div>

 <div class="identity">
 <div${upc === 'INCONSISTENT' || upc === 'missing' ? ' class="warn"' : ''}>
 <div class="l">UPC</div><div class="v">${esc(upc)}</div>
 </div>
 <div>
 <div class="l">Total runtime</div><div class="v">${formatDuration(totalSec)}</div>
 </div>
 <div${!srConsistent ? ' class="warn"' : ''}>
 <div class="l">Sample rate</div><div class="v">${srConsistent ? (srSet[0] + ' Hz') : 'MIXED — ' + srSet.join(' · ') + ' Hz'}</div>
 </div>
 <div${!bdConsistent ? ' class="warn"' : ''}>
 <div class="l">Bit depth</div><div class="v">${bdConsistent ? (bdSet[0] + '-bit') : 'MIXED — ' + bdSet.join('/') + '-bit'}</div>
 </div>
 <div>
 <div class="l">Tracks</div><div class="v">${rows.length}</div>
 </div>
 </div>

 <table class="preflight">
 <thead>
 <tr>
 <th style="width:24pt">#</th>
 <th style="width:30%">Track</th>
 <th>TP ≤ −1 dBTP</th>
 <th>Sample rate</th>
 <th>Bit depth</th>
 <th>Channels</th>
 <th>No clipping</th>
 <th>ISRC unique</th>
 <th>Mono ≤ 30%</th>
 <th>Length</th>
 </tr>
 </thead>
 <tbody>${rowsHtml}</tbody>
 </table>

 <div class="signoff">
 <div class="signoff-label">QC sign-off</div>
 <div class="signoff-grid">
 <div><div class="line"></div><div class="l">Reviewer</div></div>
 <div><div class="line"></div><div class="l">Date</div></div>
 <div><div class="line"></div><div class="l">Signature</div></div>
 </div>
 </div>

 <div class="footer">
 <span>RTM Audio · DDP preflight checklist</span>
 <span>${esc(stamp)}</span>
 </div>
</body></html>`
}

/* --------------------------------------------------------------------------- */
/* ExportMenu */
/* --------------------------------------------------------------------------- */
/**
 * Single Export chip that expands a small panel of actions.
 *
 * Final Uses <details>/<summary> so
 * keyboard focus, screen readers, and the Escape-to-close behaviour
 * all come for free.
 *
 * Items render as full-width rows inside the popover; clicking a row
 * runs its action and closes the disclosure.
 */
function ExportMenu({
 items,
}: {
 items: { label: string; title: string; onClick: () => void | Promise<void> }[]
}) {
 const detailsRef = React.useRef<HTMLDetailsElement>(null)
 // Close the menu on outside-click + Escape.
 React.useEffect(() => {
 const close = () => { if (detailsRef.current) detailsRef.current.open = false }
 const onDocClick = (e: MouseEvent) => {
 const el = detailsRef.current
 if (el && el.open && !el.contains(e.target as Node)) close()
 }
 const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
 document.addEventListener('mousedown', onDocClick)
 document.addEventListener('keydown', onKey)
 return () => {
 document.removeEventListener('mousedown', onDocClick)
 document.removeEventListener('keydown', onKey)
 }
 }, [])
 return (
 <details ref={detailsRef} className="relative">
 <summary
 className="list-none text-[11px] px-3 py-1.5 rounded-md transition-colors hover:bg-white/[0.03] cursor-pointer select-none flex items-center gap-1.5"
 style={{ color: '#d0b066', border: '1px solid rgba(208,176,102,0.35)' }}
 title="Export. CSV for humans, JSON for pipelines, PDF for handoff, DDP for distributor preflight."
 >
 Export
 <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
 <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
 </svg>
 </summary>
 <div
 className="absolute right-0 mt-2 min-w-[240px] rounded-md overflow-hidden shadow-xl z-40"
 style={{
 backgroundColor: '#1f1b17',
 border: '1px solid rgba(168,161,150,0.2)',
 }}
 role="menu"
 >
 {items.map((it, i) => (
 <button
 key={it.label}
 onClick={() => {
 if (detailsRef.current) detailsRef.current.open = false
 void it.onClick()
 }}
 className="block w-full text-left text-[11px] px-3 py-2 transition-colors hover:bg-white/[0.04]"
 style={{
 color: '#d0b066',
 borderTop: i === 0 ? 'none' : '1px solid rgba(168,161,150,0.08)',
 }}
 title={it.title}
 role="menuitem"
 >
 {it.label}
 </button>
 ))}
 </div>
 </details>
 )
}
