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
// 1.0.5 fix: support multiple named drop zones. The callback now receives
// { paths, zone } where zone is the `data-dropzone` attribute of the
// element (or its nearest ancestor) that received the drop. Renderer
// registers a single callback and routes by zone name.

let onDroppedCallback: ((payload: { paths: string[]; zone: string }) => void) | null = null

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
    } catch { /* webUtils.getPathForFile not available in this context */ }
  }
  if (paths.length === 0 || !onDroppedCallback) return

  // Walk up from the drop target to find the nearest data-dropzone attribute.
  let zone = 'masters'
  let el = e.target as HTMLElement | null
  while (el) {
    const dz = el.getAttribute?.('data-dropzone')
    if (dz) { zone = dz; break }
    el = el.parentElement
  }

  try { onDroppedCallback({ paths, zone }) } catch {}
})

contextBridge.exposeInMainWorld('rtmprofileAPI', {
  selectFiles: () => ipcRenderer.invoke('select-files') as Promise<string[]>,
  /** Renderer registers its drop callback once on mount; preload calls
   *  it with { paths, zone } so the renderer can route to the right zone.
   *  zone is the `data-dropzone` attribute of the drop target element. */
  onFilesDropped: (cb: (payload: { paths: string[]; zone: string }) => void) => {
    onDroppedCallback = cb
    return () => { onDroppedCallback = null }
  },
  buildProfile: (args: {
    name: string
    role: string
    outPath?: string
    files: string[]
    deep?: boolean
    chainMixes?: string[]
  }) => ipcRenderer.invoke('build-profile', args),
  showSavedProfile: (jsonPath: string) => ipcRenderer.invoke('show-saved-profile', jsonPath),
  cancelBuild: () => ipcRenderer.invoke('cancel-build') as Promise<boolean>,
  onProgress: (cb: (msg: { i: number; total: number; file: string }) => void) => {
    const listener = (_e: any, msg: any) => cb(msg)
    ipcRenderer.on('profile-progress', listener)
    return () => ipcRenderer.removeListener('profile-progress', listener)
  },
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url) as Promise<void>,
  scanFolder: (folderPath: string) => ipcRenderer.invoke('scan-folder', folderPath) as Promise<string[]>,
})
