import { contextBridge, ipcRenderer } from 'electron'

const { webUtils } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  listAudioFiles: (dirPath: string) => ipcRenderer.invoke('list-audio-files', dirPath),
  analyzeBatch: (filePaths: string[], options?: { deep?: boolean; deepWorkers?: number }) =>
    ipcRenderer.invoke('analyze-batch', filePaths, options),
  onBatchProgress: (callback: (msg: { message: string; index: number; total: number }) => void) => {
    ipcRenderer.on('batch-progress', (_event, msg) => callback(msg))
  },
  readAudioFile: (filePath: string) => ipcRenderer.invoke('read-audio-file', filePath),
  getFileIdentity: (filePath: string) => ipcRenderer.invoke('get-file-identity', filePath),
  historyRead: () => ipcRenderer.invoke('history-read'),
  historyAppend: (entry: any) => ipcRenderer.invoke('history-append', entry),
  historyClear: () => ipcRenderer.invoke('history-clear'),
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  analyzeFiles: (fileA: string, fileB: string, fast?: boolean, profile?: string) =>
    ipcRenderer.invoke('analyze-files', fileA, fileB, fast ?? true, profile ?? 'ohad'),
  // Returns an unsubscribe function. Callers MUST invoke it when their
  // component unmounts or starts a new analysis — otherwise each run
  // stacks a new listener on the renderer-side ipcRenderer and old
  // closures keep firing against dead state (AnalysisView was doing
  // exactly this across its full lifetime).
  onProgress: (callback: (msg: string) => void) => {
    const handler = (_event: any, msg: string) => callback(msg)
    ipcRenderer.on('analysis-progress', handler)
    return () => { ipcRenderer.removeListener('analysis-progress', handler) }
  },
  listProfiles: () => ipcRenderer.invoke('list-profiles'),
  loadCustomProfile: () => ipcRenderer.invoke('load-custom-profile'),
  deleteCustomProfile: (id: string) => ipcRenderer.invoke('delete-custom-profile', id),
  renderCorrectedEq: (srcPath: string, bands: any[], outPath?: string, truePeakLimit?: boolean, ceilingDbtp?: number, targetLufs?: number) =>
    ipcRenderer.invoke('render-corrected-eq', srcPath, bands, outPath, truePeakLimit, ceilingDbtp, targetLufs),
  pickSavePath: (suggestedName: string, filters: any[]) =>
    ipcRenderer.invoke('pick-save-path', suggestedName, filters),
  renderPdf: (html: string, suggestedName: string) =>
    ipcRenderer.invoke('render-pdf', html, suggestedName),
  cancelAnalysis: () => ipcRenderer.invoke('cancel-analysis'),
  saveFileDialog: (defaultName: string, contents: string, filters: any[]) =>
    ipcRenderer.invoke('save-file-dialog', defaultName, contents, filters),
  saveBinaryFileDialog: (defaultName: string, bytes: Uint8Array | ArrayBuffer, filters: any[]) =>
    ipcRenderer.invoke('save-binary-file-dialog', defaultName, bytes, filters),
  openTextFileDialog: (filters: any[]) =>
    ipcRenderer.invoke('open-text-file-dialog', filters),
  revealInFinder: (filePath: string) => ipcRenderer.invoke('reveal-in-finder', filePath),
  copyToClipboard: (text: string) => ipcRenderer.invoke('copy-to-clipboard', text),

  // ISRC history / Releases store / Audit log — REMOVED (FLOW territory).
  // PDF integrity helpers — SHA-256 of an arbitrary file, and a generic
  // sidecar writer so we can drop `<file>.sha256` next to exports.
  computeSha256: (filePath: string) => ipcRenderer.invoke('compute-sha256', filePath),
  writeSidecar: (filePath: string, suffix: string, contents: string) =>
    ipcRenderer.invoke('write-sidecar', filePath, suffix, contents),

  // Default export folder — one-time picker + direct writers that skip
  // the save dialog. Renderer caches the path in localStorage.
  pickFolder: (title?: string) => ipcRenderer.invoke('pick-folder', title),
  writeFileDirect: (folderPath: string, fileName: string, contents: string) =>
    ipcRenderer.invoke('write-file-direct', folderPath, fileName, contents),
  renderPdfDirect: (folderPath: string, fileName: string, html: string) =>
    ipcRenderer.invoke('render-pdf-direct', folderPath, fileName, html),

  // Encoded-Preview (Apple Sound Check twin et al) — render a 30 s AAC
  // through the DSP's real chain (gain → 4× TP limiter → codec).  Cached
  // by (file+dsp+lufs) in app temp dir.
  encodedPreviewRender: (srcPath: string, dsp: string, integratedLufs: number | null, windowStartSec?: number | null) =>
    ipcRenderer.invoke('encoded-preview-render', srcPath, dsp, integratedLufs, windowStartSec),

  // Translation Check render — auditions the master through a
  // playback environment (phone speaker / earbuds / club PA / car
  // cabin). Sister IPC to encodedPreviewRender; skips platform
  // normalisation. Returns { ok, path, env_id, lost_lf_db,
  // presence_change_db, ... } with the same caching shape.
  translationRender: (srcPath: string, envId: string, windowStartSec?: number | null) =>
    ipcRenderer.invoke('translation-render', srcPath, envId, windowStartSec),

  // Master Chain — offline render of the full HPF → EQ → compressor →
  // TP limiter → dither pipeline described by `config`.  Config shape
  // matches python/master_chain.py.
  masterChainRender: (srcPath: string, config: any, outPath?: string) =>
    ipcRenderer.invoke('master-chain-render', srcPath, config, outPath),

  // Send-to-RTM plugin bridge — subscribe to incoming audio drops
  // written by the DAW plugin (AU / VST3 / AAX) into ~/.rtm/incoming/.
  // The receiver in main.ts moves complete drops to ~/.rtm/inbox/
  // and fires `rtm-incoming` with { audioPath, metaPath, meta }.
  onRtmIncoming: (cb: (drop: { audioPath: string; metaPath: string | null; meta: any | null }) => void) => {
    const listener = (_e: any, drop: any) => cb(drop)
    ipcRenderer.on('rtm-incoming', listener)
    return () => ipcRenderer.removeListener('rtm-incoming', listener)
  },
  rtmIncomingList: () => ipcRenderer.invoke('rtm-incoming-list'),
  rtmIncomingClear: () => ipcRenderer.invoke('rtm-incoming-clear'),

  // BWF metadata writer — REMOVED. The user-facing edit/write capability
  // moved to FLOW. RTM still stamps BWF on its master-chain renders, but
  // that runs entirely inside python/master_chain.py (no IPC needed).

  // Reference Library — a persisted, auto-analysed shelf of reference
  // tracks engineers can recall as File A for any comparison.
  referencesList: () => ipcRenderer.invoke('references-list'),
  referencesAdd: (srcPath: string) => ipcRenderer.invoke('references-add', srcPath),
  referencesDelete: (id: string) => ipcRenderer.invoke('references-delete', id),
  referencesUpdate: (id: string, patch: { tags?: string[]; notes?: string }) =>
    ipcRenderer.invoke('references-update', id, patch),

  // RTM De-click — RX-style click/pop removal via python/declick.py.
  // `declickProcess` runs the full file; `declickPreview` slices the
  // first 10 s into ~/.rtm/declick-preview.wav so the UI can A/B.
  declickProcess: (args: {
    inPath: string
    outPath?: string
    algorithm: string
    sensitivity: number
    skew: number
    widenMs: number
    mode: 'repair' | 'clicks' | 'list'
  }) => ipcRenderer.invoke('declick-process', args),
  declickPreview: (args: {
    inPath: string
    outPath?: string
    algorithm: string
    sensitivity: number
    skew: number
    widenMs: number
    mode: 'repair' | 'clicks' | 'list'
  }) => ipcRenderer.invoke('declick-preview', args),
})
