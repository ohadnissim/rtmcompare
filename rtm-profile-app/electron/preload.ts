import { contextBridge, ipcRenderer, webUtils } from 'electron'

// ── Drag-and-drop, the bullet-proof way ─────────────────────────────
//
// Three failed approaches led here:
//
//   1.0.0  used file.path directly. Removed by Electron 32 for security.
//   1.0.1  exposed webUtils.getPathForFile via contextBridge. The File
//          object got cloned crossing the bridge, losing the internal
//          [[FileBlobImpl]] slot the API needs — silent throw.
//   1.0.2  registered the drop listener inside the preload (good!) and
//          dispatched a CustomEvent('rtm-files-dropped') with the
//          resolved paths in event.detail. The DOM is shared between
//          preload and renderer isolates, but `event.detail` does NOT
//          survive the isolate boundary cleanly — renderer-side
//          listeners read `undefined` and the drop went nowhere.
//
// 1.0.4 fix: register the drop listener inside the preload (so File is
// in its native isolate when webUtils resolves the path), then push
// the paths through a callback that the renderer registers via
// contextBridge. Strings cross the bridge fine; the callback is a
// proxy contextBridge wires up in both directions.
//
// Empirically verified by checking that `webUtils.getPathForFile()`
// returns a non-empty string in the preload context, and that the
// renderer-registered callback receives the path array on every drop.

let onDroppedCallback: ((paths: string[]) => void) | null = null

window.addEventListener('dragover', (e) => {
  e.preventDefault()
})

window.addEventListener('drop', (e) => {
  e.preventDefault()
  const dt = e.dataTransfer
  if (!dt || !dt.files || dt.files.length === 0) return
  const paths: string[] = []
  for (const f of Array.from(dt.files)) {
    try {
      const p = webUtils.getPathForFile(f)
      if (p) paths.push(p)
    } catch {
      const legacy = (f as unknown as { path?: string }).path
      if (legacy) paths.push(legacy)
    }
  }
  if (paths.length > 0 && onDroppedCallback) {
    try { onDroppedCallback(paths) } catch {}
  }
})

contextBridge.exposeInMainWorld('rtmprofileAPI', {
  selectFiles: () => ipcRenderer.invoke('select-files') as Promise<string[]>,
  /** Renderer registers its drop callback once on mount; preload calls
   *  it directly with the resolved on-disk paths from each drop. */
  onFilesDropped: (cb: (paths: string[]) => void) => {
    onDroppedCallback = cb
    return () => { onDroppedCallback = null }
  },
  buildProfile: (args: {
    name: string
    role: string
    genres: string
    outPath?: string
    files: string[]
    /** Deep Scan: per-stem profile via Demucs. Adds ~30s-2min per track. */
    deep?: boolean
  }) => ipcRenderer.invoke('build-profile', args),
  showSavedProfile: (jsonPath: string) => ipcRenderer.invoke('show-saved-profile', jsonPath),
  onProgress: (cb: (msg: { i: number; total: number; file: string }) => void) => {
    const listener = (_e: any, msg: any) => cb(msg)
    ipcRenderer.on('profile-progress', listener)
    return () => ipcRenderer.removeListener('profile-progress', listener)
  },
})
