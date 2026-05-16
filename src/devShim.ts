/*
 * devShim.ts — browser-only stub for `window.electronAPI`.
 *
 * RTM ships as an Electron app where `electron/preload.ts` exposes the full
 * IPC surface via `contextBridge.exposeInMainWorld('electronAPI', …)`.
 * When the Vite dev server is opened in a plain browser (e.g. from a smoke
 * test harness) there is no preload, so every `await window.electronAPI.X(…)`
 * hangs the first render and the React tree never mounts past its first
 * async effect.
 *
 * This module installs a no-op shim on the global — ONLY when the real
 * Electron API is absent — so the app can boot far enough for UI tests.
 * Every method returns a sensible empty value; every `on*` subscriber
 * returns a no-op unsubscribe.
 *
 * It MUST be imported at the very top of `src/main.tsx`, before any module
 * that references `window.electronAPI`.
 */

// Run only in the browser and only when the real Electron preload didn't
// run. `typeof window` guard keeps SSR / tooling happy; the second guard
// guarantees we never overwrite the real bridge in a production Electron
// window.
if (typeof window !== 'undefined' && !(window as any).electronAPI) {
 const noop = () => {}
 const unsub = () => noop
 const ok = <T,>(v: T): Promise<T> => Promise.resolve(v)

 ;(window as any).electronAPI = {
 // ── File / folder pickers ───────────────────────────────────────────
 selectFile: () => ok(null),
 selectFolder: () => ok(null),
 listAudioFiles: () => ok([] as { path: string; name: string; size: number }[]),
 pickFolder: () => ok(null),
 pickSavePath: () => ok(null),
 openTextFileDialog: () => ok(null),
 saveFileDialog: () => ok(null),
 saveBinaryFileDialog: () => ok(null),
 getPathForFile: () => '',

 // ── Analysis pipeline ───────────────────────────────────────────────
 analyzeFiles: () => ok({ results: [] } as any),
 analyzeBatch: () => ok({ results: [], deep: {} } as any),
 cancelAnalysis: () => ok(true),
 // When running under the browser smoke-test harness, resolve any
 // path under /__dev__/ to the real test-tone WAV Vite serves at
 // /test-tone.wav. Lets ABPlayer actually decode + play audio in
 // the preview without a backend. All other paths return an empty
 // buffer (decode will fail cleanly and the player shows "Preparing
 // audio…" indefinitely, which is the shim default).
 readAudioFile: async (p?: string) => {
 try {
 if (typeof p === 'string' && p.startsWith('/__dev__/')) {
 const res = await fetch('/test-tone.wav')
 if (res.ok) return await res.arrayBuffer()
 }
 } catch {}
 return new ArrayBuffer(0)
 },
 getFileIdentity: () => ok({
 path: '', size: 0, mtime: 0, mtime_iso: '', sha256: '',
 }),

 // ── Progress subscribers (must return a no-op unsubscribe) ──────────
 onProgress: unsub,
 onBatchProgress: unsub,
 onRtmIncoming: unsub,

 // ── History / profiles ──────────────────────────────────────────────
 historyRead: () => ok([]),
 historyAppend: () => ok(0),
 historyClear: () => ok(true),
 listProfiles: () => ok([]),
 loadCustomProfile: () => ok(null),
 deleteCustomProfile: () => ok(true),

 // ── Export / render / file write ────────────────────────────────────
 renderCorrectedEq: () => ok(''),
 renderPdf: () => ok(null),
 renderPdfDirect: () => ok({ error: 'shim' }),
 writeFileDirect: () => ok({ error: 'shim' }),
 revealInFinder: () => ok(true),
 copyToClipboard: () => ok(true),

 // ── ISRC history / Releases store / Audit log — REMOVED (FLOW territory) ──

 // ── Integrity helpers ───────────────────────────────────────────────
 computeSha256: () => ok(''),
 writeSidecar: () => ok(''),

 // ── Encoded-preview / master chain ──────────────────────────────────
 encodedPreviewRender: () => ok({ ok: false, error: 'shim' } as any),
 masterChainRender: () => ok({ ok: false, error: 'shim' } as any),

 // ── RTM incoming (DAW plugin bridge) ────────────────────────────────
 rtmIncomingList: () => ok([]),
 rtmIncomingClear: () => ok(0),

 // ── BWF writer — REMOVED (FLOW territory) ──

 // ── Reference library ───────────────────────────────────────────────
 referencesList: () => ok([]),
 referencesAdd: () => ok({ error: 'shim' } as any),
 referencesDelete: () => ok(true),
 referencesUpdate: () => ok(null),

 // ── Share as HTML ────────────────────────────────────────────────────
 shareAsHtml: () => ok({ success: false }),

 // ── Ozone preset bridge ──────────────────────────────────────────────
 ozoneDetect: () => ok({ found: false, installations: [] as { name: string; version: string }[] }),
 ozoneInstallPreset: () => ok({ ok: false, results: [], error: 'shim' } as any),

 // ── RTMsend chain push ───────────────────────────────────────────────
 rtmsendDumpParams: () => ok({ plugin: 'shim', params: [] as any[] }),
 rtmsendSendChain: () => ok({ plugin: 'shim', applied: 0, rejected: 0, total_params: 0, updates_attempted: 0 }),
 }

 // ── Dev test hook ──────────────────────────────────────────────────────
 //
 // Exposes `window.__rtmDev` for browser-driven click tests. The app
 // can't actually analyse audio in a browser (no Python backend), so
 // these helpers synthesise a minimal AnalysisResult and dispatch a
 // `__rtm-dev-load` CustomEvent that App.tsx's dev-only listener (also
 // gated on the shim being active) picks up to advance state.
 //
 // This is ONLY active alongside the shim, which itself only runs
 // outside Electron. Zero production surface.
 const fakeFile = (slot: 'A' | 'B', name = 'fake.wav') => ({
 path: `/__dev__/${slot}/${name}`,
 name,
 size: 44100 * 2 * 2 * 180, // ~3 min 16-bit stereo
 })

 /** Minimal fake BatchResult row — populates the BatchView table +
 * Cohort Mode without requiring a real analysis. Only fills the
 * fields the table reads; the rest are null so optional-chained
 * panels collapse gracefully. */
 const fakeBatchRow = (i: number): any => ({
 path: `/__dev__/A/track-${i + 1}.wav`,
 filename: `track-${i + 1}.wav`,
 analysed_sec: 180 + i * 10,
 error: null,
 lufs_i: -9.2 + i * 0.3,
 true_peak_dbtp: -0.8,
 lra: 6.2,
 duration_sec: 180 + i * 10,
 sample_rate: 44100,
 bit_depth: 24,
 channels: 2,
 clipped_samples: 0,
 mono_compat_loss_pct: 0.8,
 spectrum: Array(31).fill(-30),
 isrc: `USRTM25${String(i).padStart(5, '0')}`,
 upc: null,
 title: `Track ${i + 1}`,
 artist: 'Dev Shim',
 album: 'Smoke Test EP',
 track_number: String(i + 1),
 explicit: false,
 p_line: null,
 c_line: null,
 })

 const fakeRefOnlyResult = () => ({
 // Required scalars
 comparison_mode: 'compare' as const,
 level_matched: true,
 gain_applied_db: 0,
 categories: [],
 recommendations: [],
 clicks: [],
 tonal_issues: [],
 duration_sec: 180,

 // Overall stats — enough for the verdict + meta strip.
 // `insights: []` required — AnalysisView.tsx:617 maps over it
 // unguarded when rendering the compare-mode overall summary.
 overall: {
 lufs_a: -9.2, lufs_b: -9.2,
 short_term_max_a: -6.8, short_term_max_b: -6.8,
 true_peak_db_a: -0.8, true_peak_db_b: -0.8,
 lra_a: 6.2, lra_b: 6.2,
 dynamics_a: 7.1, dynamics_b: 7.1,
 width_a: 0.62, width_b: 0.62,
 insights: [],
 },

 // Minimal spectrum (31 bands, all flat at -30 dB)
 spectrum_a: Array(31).fill(-30),
 spectrum_b: Array(31).fill(-30),

 // Waveform (200 points across duration)
 waveform_a: Array.from({ length: 200 }, (_, i) => Math.sin(i / 10) * 0.5),
 waveform_b: Array.from({ length: 200 }, (_, i) => Math.sin(i / 10) * 0.5),

 // Reference check stats — feeds the attention list. Must include
 // `warnings: []` (RefOnlyView line 759 accesses `check.warnings.length`
 // unguarded) and `stats.stereo_correlation` (line 808).
 reference_check: {
 score: 82,
 stats: {
 lufs_i: -9.2,
 true_peak_dbtp: -0.8,
 lra: 6.2,
 clip_count: 0,
 sample_rate: 44100,
 bit_depth: 24,
 channels: 2,
 stereo_correlation: 0.78,
 },
 warnings: [],
 flags: [],
 // song_info is the OUTER key on the fake result; don't duplicate
 // it on reference_check or RefOnlyView's tonal panel will try to
 // render harmonics / bpm / key without the required sub-fields.
 },

 // Streaming preview — minimal 2-row array
 streaming_preview: {
 a: [
 { name: 'Spotify', played_lufs: -14, played_tp: -1.2, delta_db: -4.8, action: 'Attenuated', tp_breach: false, target_lufs: -14, target_tp: -1 },
 { name: 'Apple Music', played_lufs: -16, played_tp: -1.4, delta_db: -6.8, action: 'Attenuated', tp_breach: false, target_lufs: -16, target_tp: -1 },
 ],
 b: [],
 },

 file_metadata: {
 a: { sample_rate: 44100, bit_depth: 24, channels: 2, isrc: null },
 },

 song_info: { title: 'Fake Track', artist: 'Dev Shim' },
 })

 ;(window as any).__rtmDev = {
 /** Load a fake file into slot A + jump directly to the ref-only
 * surface with a synthesised analysis. Lets browser tests reach
 * RefOnlyView without real audio. */
 loadRefOnly() {
 window.dispatchEvent(
 new CustomEvent('__rtm-dev-load', {
 detail: {
 kind: 'ref-only',
 fileA: fakeFile('A'),
 result: fakeRefOnlyResult(),
 },
 }),
 )
 },
 /** Set fileA + fileB (simulates both drop zones filled). */
 setBothFiles() {
 window.dispatchEvent(
 new CustomEvent('__rtm-dev-load', {
 detail: {
 kind: 'upload-ready',
 fileA: fakeFile('A'),
 fileB: fakeFile('B', 'fake-b.wav'),
 },
 }),
 )
 },
 /** Load fileA + fileB + jump to compare-results with fake analysis.
 * The fake result duplicates _a / _b fields so the AnalysisView's
 * compare panels (spectrum overlay, vectorscope, loudness timeline)
 * all have symmetric data to render. */
 loadCompare() {
 const base = fakeRefOnlyResult()
 const compareResult = {
 ...base,
 // Mirror every _a field onto _b so compare panels render the
 // same curve on both sides (visually boring but structurally
 // sound — enough to verify every CollapsibleSection mounts).
 waveform_b: base.waveform_a,
 spectrum_b: base.spectrum_a,
 }
 window.dispatchEvent(
 new CustomEvent('__rtm-dev-load', {
 detail: {
 kind: 'compare',
 fileA: fakeFile('A', 'mix-reference.wav'),
 fileB: fakeFile('B', 'mix-revision.wav'),
 result: compareResult,
 },
 }),
 )
 },
 /** Jump to the batch / album surface with a fake 6-track EP.
 * Enough to exercise every section of BatchView (table, overview,
 * Cohort Mode when a row is promoted, DMR panel, tab strip). */
 loadBatch(n = 6) {
 const results = Array.from({ length: n }, (_, i) => fakeBatchRow(i))
 window.dispatchEvent(
 new CustomEvent('__rtm-dev-load', {
 detail: {
 kind: 'batch',
 results,
 folderName: 'Smoke Test EP',
 },
 }),
 )
 },
 fakeFile,
 fakeBatchRow,
 fakeRefOnlyResult,
 }

 // Useful signal in the DevTools console — confirms the shim installed
 // and the real preload was NOT present.
 // eslint-disable-next-line no-console
 console.info('[devShim] browser electronAPI shim installed (50 methods + __rtmDev helpers)')
}

export {}
