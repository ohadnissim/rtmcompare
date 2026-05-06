import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { analyzePython, ensureDeps, cancelActiveAnalysis, getPythonPaths, pythonSpawnEnv } from './python-bridge'

let mainWindow: BrowserWindow | null = null

// ── Path-safety helpers (IPC guard) ────────────────────────────────
//
// Any IPC handler that accepts a path from the renderer goes through
// one of these before touching the filesystem.
//
// Policy: the renderer is trusted (we don't load arbitrary web content),
// AND macOS sandboxing already gates filesystem access at the OS level
// (TCC prompts for ~/Documents, ~/Desktop, ~/Downloads on first read).
// So we no longer enforce a hard-coded folder allowlist — beta testers
// keep their music in Dropbox, OneDrive, iCloud, external drives,
// /Users/Shared/, and a hundred other places that an allowlist will
// always be wrong about. Instead we validate shape (well-formed string,
// path resolves, target exists, target is the right kind, audio
// extension where applicable). The audio-extension gate at the IPC
// handler caller-side prevents the renderer from coaxing main into
// reading non-audio files like ~/.ssh/id_rsa.

/** Returns a canonicalised absolute path if `p` points to a regular
 *  file. Throws a clear Error on any violation. */
function assertSafeAudioPath(p: unknown, purpose: string): string {
  if (typeof p !== 'string' || p.length === 0 || p.length > 4096) {
    throw new Error(`${purpose}: invalid path argument`)
  }
  let abs = path.resolve(p)
  if (!fs.existsSync(abs)) {
    throw new Error(`${purpose}: file not found (${abs})`)
  }
  // Resolve symlinks so the existence/type check is on the real target.
  try { abs = fs.realpathSync(abs) } catch {}
  const st = fs.statSync(abs)
  if (!st.isFile()) {
    throw new Error(`${purpose}: not a regular file (${abs})`)
  }
  return abs
}

/** Same policy for a directory argument. */
function assertSafeDir(p: unknown, purpose: string): string {
  if (typeof p !== 'string' || p.length === 0 || p.length > 4096) {
    throw new Error(`${purpose}: invalid directory argument`)
  }
  let abs = path.resolve(p)
  if (!fs.existsSync(abs)) {
    throw new Error(`${purpose}: folder not found (${abs})`)
  }
  try { abs = fs.realpathSync(abs) } catch {}
  const st = fs.statSync(abs)
  if (!st.isDirectory()) {
    throw new Error(`${purpose}: not a directory (${abs})`)
  }
  return abs
}

/** Strip any path components from a user-supplied identifier so it
 *  can't escape the base dir when joined.  Also enforces a
 *  conservative character class. */
function assertSafeProfileId(id: unknown): string {
  if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
    throw new Error('profile id: invalid')
  }
  const base = path.basename(id)
  if (base !== id || !/^[A-Za-z0-9_\-. ]+$/.test(base)) {
    throw new Error(`profile id: illegal characters (${id})`)
  }
  return base
}

// Splash window — opens INSTANTLY on app launch (before Electron loads
// the main renderer, before vite chunks parse, before Python init) so
// the user sees the brand within 200 ms instead of staring at a black
// taskbar entry for 1-3 minutes while Defender scans the bundled
// Python and ffmpeg on Windows. Closed automatically when mainWindow
// fires `ready-to-show`.
let splashWindow: BrowserWindow | null = null

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    backgroundColor: '#1e1e1e',
    transparent: false,
    show: true,
    skipTaskbar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  // Splash lives at build/splash.html (shipped via electron-builder
  // `files` glob — see package.json). In dev mode (unpackaged) the
  // build/ folder is at <projectRoot>/build/ relative to dist-electron.
  // Both packaged and dev resolve to <projectRoot>/build/splash.html.
  // `__dirname` is `<projectRoot>/dist-electron/` in dev (via tsc) and
  // resources/app/dist-electron/ in packaged builds — one level up
  // reaches `build/` in both contexts. (5.2.x: was wrongly `..`,`..`
  // in dev which resolved outside the project, ERR_FILE_NOT_FOUND.)
  const splashPath = path.join(__dirname, '..', 'build', 'splash.html')
  splashWindow.loadFile(splashPath).catch(() => {
    // Splash is non-essential — if it fails to load, just close it
    // and let the main window come up alone.
    try { splashWindow?.close() } catch {}
    splashWindow = null
  })
  splashWindow.on('closed', () => { splashWindow = null })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    // Default size chosen so the header (RTM logo · Tour · Learn · Blind · Zoom
    // pills · Theme · New-comparison) fits on one row without clipping, and
    // the wider analysis panels (heatmap, trajectory) render at their design width.
    width: 1320,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#1c1a17',
    title: 'RTMcompare',
    // Don't show until the renderer's first paint is ready — keeps
    // the splash visible through the slowest part of the boot.
    show: false,
    // macOS: inset titlebar for the quiet-luxury look. Windows uses the default chrome.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,  // Required for File.path on drag-and-drop
    },
  })

  // Load from Vite dev server in development, built files in production
  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      // Vite may not be ready yet — retry after a delay
      setTimeout(() => mainWindow?.loadURL('http://localhost:5173'), 2000)
    })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Reveal the main window once the renderer has actually painted —
  // avoids the white-flash while React is still hydrating. Then close
  // the splash. The splash provides the brand-visible-within-200 ms
  // guarantee; the main window takes over once it's actually ready.
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    if (splashWindow && !splashWindow.isDestroyed()) {
      try { splashWindow.close() } catch {}
    }
  })

  // Handle file drops — intercept in main process where we have full paths.
  // Also block any in-renderer navigation that isn't our local content,
  // and refuse all `window.open` popups outright. With sandbox:false
  // (justified for File.path), these are the renderer-side defences.
  // Audit P0-5 hardening (5.2.0).
  mainWindow.webContents.on('will-navigate', (e, url) => {
    // Allow only the same-origin Vite dev URL in dev; block everything
    // else. In production the loaded file:// origin won't navigate at
    // all; a renderer compromise that tries `location = 'http://...'`
    // gets dropped here instead of reaching the network.
    if (!url.startsWith('http://localhost:5173') && !url.startsWith('file://')) {
      e.preventDefault()
    }
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // Listen for files dropped onto the window
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  // Splash first — paints in <200 ms so the user sees the brand
  // immediately instead of an empty taskbar entry. Main window
  // creation continues in parallel; the splash closes once the
  // main window's `ready-to-show` fires.
  createSplashWindow()
  createWindow()
  // Auto-install Python deps on first launch
  try {
    await ensureDeps((msg) => {
      mainWindow?.webContents.send('analysis-progress', msg)
    })
  } catch (err: any) {
    console.error('Dep install failed:', err.message)
  }
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

// IPC Handlers
ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      {
        name: 'Audio Files',
        extensions: ['wav', 'mp3', 'flac', 'aiff', 'aif', 'ogg', 'm4a'],
      },
    ],
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

// ── Version history ──────────────────────────────────────────────────
// Small local JSON log at ~/.rtm/history.json. Each entry is a single
// analysis of File B (the "target") — filename, path, SHA-256 fingerprint,
// a handful of key metrics, timestamp. Capped at 200 entries per file
// hash and 2000 entries total so the file stays under a few hundred KB.
// Dead simple append-only; readers filter + sort on the renderer side.
//
// The sidebar needs this to answer "has this file been analysed before?"
// without re-hashing every file on every drop. Callers that already have
// the SHA (Client Report PDF computes it) should pass it in; we only
// hash when they don't.
const HISTORY_PATH = path.join(require('os').homedir(), '.rtm', 'history.json')
function ensureRtmDir() {
  try { fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true }) } catch {}
}
function readHistorySync(): any[] {
  try {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}
function writeHistorySync(list: any[]) {
  ensureRtmDir()
  try { fs.writeFileSync(HISTORY_PATH, JSON.stringify(list, null, 2), 'utf8') } catch {}
}
ipcMain.handle('history-read', async () => readHistorySync())
ipcMain.handle('history-append', async (_event, entry: any) => {
  const list = readHistorySync()
  // Dedupe: if the same sha256 was logged within the last 60 s keep only
  // the latest — prevents double-entries on tab-bounce.
  const now = Date.now()
  const sha = entry?.sha256
  const filtered = list.filter(e => !(e.sha256 === sha && (now - (e.ts || 0)) < 60 * 1000))
  filtered.push({ ...entry, ts: now })
  // Cap: keep the last 2000 total, and per-sha cap at 200.
  const perSha = new Map<string, number>()
  for (let i = filtered.length - 1; i >= 0; i--) {
    const s = filtered[i].sha256
    if (!s) continue
    const n = (perSha.get(s) || 0) + 1
    perSha.set(s, n)
    if (n > 200) filtered.splice(i, 1)
  }
  const trimmed = filtered.slice(-2000)
  writeHistorySync(trimmed)
  return trimmed.length
})
ipcMain.handle('history-clear', async () => {
  writeHistorySync([])
  return true
})

// Batch / album mode — pick a folder, list audio files inside it, run the
// lite batch analyser. Three handlers:
//   select-folder        → native folder picker
//   list-audio-files     → recursive-ish (depth 1) scan of a directory
//   analyze-batch        → spawns python/batch_analyze.py with file paths
const AUDIO_EXT = new Set(['.wav', '.flac', '.aiff', '.aif', '.mp3', '.m4a', '.ogg'])

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select album folder',
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

ipcMain.handle('list-audio-files', async (_event, dirPath: string) => {
  try {
    const safeDir = assertSafeDir(dirPath, 'list-audio-files')
    const entries = fs.readdirSync(safeDir, { withFileTypes: true })
    const files: { path: string; name: string; size: number }[] = []
    for (const e of entries) {
      if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase()
        if (AUDIO_EXT.has(ext)) {
          const full = path.join(safeDir, e.name)
          try {
            const stat = fs.statSync(full)
            files.push({ path: full, name: e.name, size: stat.size })
          } catch { /* unreadable file, skip */ }
        }
      }
    }
    // Sort alphabetically — closest to album running order for folders
    // named like "01 - Track.wav". Users can re-sort in the UI.
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    return files
  } catch (err: any) {
    throw new Error(err?.message || 'Could not read folder')
  }
})

ipcMain.handle('analyze-batch', async (event, filePaths: string[], options?: { deep?: boolean; deepWorkers?: number }) => {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error('analyze-batch: filePaths must be a non-empty array')
  }
  for (const p of filePaths) assertSafeAudioPath(p, 'analyze-batch')
  const isPackaged = app.isPackaged
  const basePath = isPackaged ? (process as any).resourcesPath : path.join(__dirname, '..')
  const pythonDir = path.join(basePath, 'python')
  const isWin = process.platform === 'win32'
  const winBundled = path.join(basePath, 'python-bundle-win', 'python', 'python.exe')
  const macBundled = path.join(basePath, 'python-bundle', 'python', 'bin', 'python3')
  const pythonCmd = isWin
    ? (fs.existsSync(winBundled) ? winBundled : 'python.exe')
    : (fs.existsSync(macBundled) ? macBundled : '/usr/bin/python3')

  return new Promise<any>((resolve, reject) => {
    const { spawn } = require('child_process') as typeof import('child_process')
    const scriptPath = path.join(pythonDir, 'batch_analyze.py')
    // Optional --deep runs full single-file analyses per song in parallel
    // subprocesses inside batch_analyze.py. Users trade longer scan time
    // for every tab being instant in the batch view.
    const args = [scriptPath, ...filePaths]
    if (options?.deep) args.push('--deep')
    if (options?.deepWorkers && options.deepWorkers > 0) args.push(`--deep-workers=${options.deepWorkers}`)
    const proc = spawn(pythonCmd, args, {
      cwd: pythonDir,
      env: pythonSpawnEnv(),
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => {
      const text = d.toString()
      stderr += text
      // Forward per-file progress lines to the renderer.
      for (const line of text.split('\n')) {
        const t = line.trim()
        if (!t) continue
        try {
          const msg = JSON.parse(t)
          if (msg.type === 'progress' && msg.message) {
            event.sender.send('batch-progress', msg)
          }
        } catch { /* not JSON */ }
      }
    })
    proc.on('close', (code: number) => {
      if (code !== 0) {
        reject(new Error(stderr.slice(-500) || `batch analyser exited ${code}`))
        return
      }
      try {
        resolve(JSON.parse(stdout.trim()))
      } catch {
        reject(new Error(`Failed to parse batch output: ${stdout.slice(0, 200)}`))
      }
    })
    proc.on('error', (err: Error) => reject(new Error(`Could not start Python: ${err.message}`)))
  })
})

// Handle drag-and-drop: receive filename, show dialog to confirm full path
ipcMain.handle('resolve-drop-path', async (_event, fileName: string) => {
  // The File.path doesn't work with contextIsolation, so we ask user to confirm
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    title: `Select ${fileName}`,
    filters: [
      { name: 'Audio Files', extensions: ['wav', 'mp3', 'flac', 'aiff', 'aif', 'ogg', 'm4a'] },
    ],
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

// File identity for deliverable-receipt PDFs — size, mtime, and a SHA-256
// fingerprint. 30 MB WAV hashes in ~0.2s on an M1; acceptable for a manual
// report export. Computed in the main process so the renderer doesn't have
// to shuttle the bytes twice.
ipcMain.handle('get-file-identity', async (_event, filePath: string) => {
  try {
    const safePath = assertSafeAudioPath(filePath, 'get-file-identity')
    // Extension gate so a renderer can't coax us into hashing a random
    // non-audio file inside the allowed roots (e.g. a plain-text
    // secret sitting in ~/Documents).
    const ext = path.extname(safePath).toLowerCase()
    if (!AUDIO_EXT.has(ext)) {
      throw new Error(`get-file-identity: refused for non-audio extension (${ext})`)
    }
    const stat = fs.statSync(safePath)
    const crypto = require('crypto') as typeof import('crypto')
    const buf = fs.readFileSync(safePath)
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex')
    return {
      path: safePath,
      size: stat.size,
      mtime: stat.mtimeMs,
      mtime_iso: new Date(stat.mtimeMs).toISOString(),
      sha256,
    }
  } catch (err: any) {
    return { error: err?.message || 'Could not read file identity' }
  }
})

ipcMain.handle('read-audio-file', async (_event, filePath: string) => {
  const safePath = assertSafeAudioPath(filePath, 'read-audio-file')
  const ext = path.extname(safePath).toLowerCase()
  if (!AUDIO_EXT.has(ext)) {
    throw new Error(`read-audio-file: refused for non-audio extension (${ext})`)
  }
  const buffer = fs.readFileSync(safePath)
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
})

// ── Profile management ──────────────────────────────────────────────────
const USER_PROFILES_DIR = path.join(require('os').homedir(), '.rtm', 'profiles')

function ensureUserProfilesDir() {
  try { fs.mkdirSync(USER_PROFILES_DIR, { recursive: true }) } catch {}
}

ipcMain.handle('list-profiles', async () => {
  ensureUserProfilesDir()
  const profiles: any[] = []
  const seen = new Set<string>()

  // User profiles first (so they shadow built-ins if IDs collide)
  try {
    for (const f of fs.readdirSync(USER_PROFILES_DIR).sort()) {
      if (!f.endsWith('.json')) continue
      const id = f.replace(/\.json$/, '')
      if (seen.has(id)) continue
      try {
        const data = JSON.parse(fs.readFileSync(path.join(USER_PROFILES_DIR, f), 'utf8'))
        profiles.push({
          id,
          name: data.name || id,
          description: data.description || '',
          sample_count: data.sample_count || 0,
          user_created: true,
        })
        seen.add(id)
      } catch {}
    }
  } catch {}

  // Built-in profiles
  const isPackaged = app.isPackaged
  const basePath = isPackaged ? (process as any).resourcesPath : path.join(__dirname, '..')
  const builtinDir = path.join(basePath, 'python', 'profiles')
  try {
    for (const f of fs.readdirSync(builtinDir).sort()) {
      if (!f.endsWith('.json')) continue
      const id = f.replace(/\.json$/, '')
      if (seen.has(id)) continue
      try {
        const data = JSON.parse(fs.readFileSync(path.join(builtinDir, f), 'utf8'))
        profiles.push({
          id,
          name: data.name || id,
          description: data.description || '',
          sample_count: data.sample_count || 0,
          user_created: false,
        })
        seen.add(id)
      } catch {}
    }
  } catch {}

  return profiles
})

ipcMain.handle('load-custom-profile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    title: 'Load Engineer Profile',
    filters: [{ name: 'Profile JSON', extensions: ['json'] }],
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const sourcePath = result.filePaths[0]
  try {
    const raw = fs.readFileSync(sourcePath, 'utf8')
    const data = JSON.parse(raw)
    // Validate shape — 31-band curve is the only hard requirement.
    // Loudness / dynamic-range / width stats are filled with sensible
    // mastering defaults when missing, so users can drop in just a curve
    // (e.g. exported from a reference analyser or hand-crafted).
    if (!Array.isArray(data.curve) || data.curve.length !== 31) {
      throw new Error('Profile missing a 31-band `curve` array.')
    }
    if (typeof data.lufs_avg !== 'number') data.lufs_avg = -10.0
    if (typeof data.dynamic_range_avg !== 'number') data.dynamic_range_avg = 6.0
    if (typeof data.width_avg !== 'number') data.width_avg = 0.12
    if (!data.name) data.name = path.basename(sourcePath, '.json')
    if (!data.description) data.description = 'Custom target — curve-only (loudness/width defaults applied)'
    data.curve_only = data.curve_only || (data.sample_count == null)

    // Derive an ID from the filename (sanitized)
    ensureUserProfilesDir()
    const baseName = path.basename(sourcePath, '.json').toLowerCase().replace(/[^a-z0-9_-]/g, '_')
    let id = baseName
    let n = 1
    while (fs.existsSync(path.join(USER_PROFILES_DIR, `${id}.json`))) {
      id = `${baseName}_${n++}`
    }
    const destPath = path.join(USER_PROFILES_DIR, `${id}.json`)
    fs.writeFileSync(destPath, JSON.stringify(data, null, 2))

    return {
      id,
      name: data.name || id,
      description: data.description || '',
      sample_count: data.sample_count || 0,
      user_created: true,
    }
  } catch (err: any) {
    throw new Error(`Invalid profile: ${err.message || err}`)
  }
})

ipcMain.handle('delete-custom-profile', async (_event, profileId: string) => {
  // Strip any path components — `profileId` like "../../../etc/passwd"
  // would otherwise escape USER_PROFILES_DIR when joined.
  const safeId = assertSafeProfileId(profileId)
  const filePath = path.join(USER_PROFILES_DIR, `${safeId}.json`)
  // Belt-and-suspenders: reject if the resolved path escaped the base.
  const resolved = path.resolve(filePath)
  const baseResolved = path.resolve(USER_PROFILES_DIR)
  if (!resolved.startsWith(baseResolved + path.sep) && resolved !== baseResolved) {
    throw new Error('delete-custom-profile: path traversal refused')
  }
  if (fs.existsSync(resolved)) {
    fs.unlinkSync(resolved)
    return true
  }
  return false
})

// ── Render HTML string → PDF via Electron's offscreen webContents ──
// Returns the PDF bytes so the renderer can save via dialog, OR writes
// directly to a provided path.
ipcMain.handle('render-pdf', async (_event, html: string, suggestedName: string) => {
  const result = await dialog.showSaveDialog({
    defaultPath: suggestedName.endsWith('.pdf') ? suggestedName : `${suggestedName}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (result.canceled || !result.filePath) return null

  // Spin up a hidden BrowserWindow that loads the HTML, then printToPDF.
  const hidden = new BrowserWindow({
    show: false,
    width: 820,
    height: 1160,
    webPreferences: { offscreen: false, sandbox: true, contextIsolation: true },
  })
  try {
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
    await hidden.loadURL(dataUrl)
    const pdfBuf = await hidden.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true,
    })
    fs.writeFileSync(result.filePath, pdfBuf)
    return result.filePath
  } finally {
    hidden.close()
  }
})

// ── Pick save location for Apply-and-Bounce render ─────────────────
ipcMain.handle('pick-save-path', async (_event, suggestedName: string, filters: { name: string; extensions: string[] }[]) => {
  const result = await dialog.showSaveDialog({
    defaultPath: suggestedName,
    filters: filters || [{ name: 'Audio', extensions: ['wav'] }],
  })
  if (result.canceled || !result.filePath) return null
  return result.filePath
})

// ── Apply-and-bounce: render a corrected version of the file with the
// suggested EQ moves baked in. Runs python/apply_eq.py as a subprocess.
// If outPath is provided, writes there; otherwise uses a temp path.
ipcMain.handle('render-corrected-eq', async (
  _event,
  srcPath: string,
  bands: { freq: number; gain_db: number; q: number }[],
  outPath?: string,
  truePeakLimit?: boolean,
  ceilingDbtp?: number,
  targetLufs?: number,
) => {
  assertSafeAudioPath(srcPath, 'render-corrected-eq')
  const isPackaged = app.isPackaged
  const basePath = isPackaged ? (process as any).resourcesPath : path.join(__dirname, '..')
  const pythonDir = path.join(basePath, 'python')
  // Cross-platform python path resolution (same logic as python-bridge.ts)
  const isWin = process.platform === 'win32'
  const winBundled = path.join(basePath, 'python-bundle-win', 'python', 'python.exe')
  const macBundled = path.join(basePath, 'python-bundle', 'python', 'bin', 'python3')
  const pythonCmd = isWin
    ? (fs.existsSync(winBundled) ? winBundled : 'python.exe')
    : (fs.existsSync(macBundled) ? macBundled : '/usr/bin/python3')

  return new Promise<string>((resolve, reject) => {
    const { spawn } = require('child_process') as typeof import('child_process')
    // Feed bands over stdin so we don't run into ARG_MAX limits.
    const script = `
import sys, json, os
sys.path.insert(0, ${JSON.stringify(pythonDir)})
from apply_eq import render_corrected
payload = json.loads(sys.stdin.read())
_target_lufs = payload.get('targetLufs')
out = render_corrected(
    payload['src'],
    payload['bands'],
    payload.get('outPath'),
    true_peak_limit=bool(payload.get('truePeakLimit', False)),
    ceiling_dbtp=float(payload.get('ceilingDbtp', -1.0)),
    target_lufs=(float(_target_lufs) if _target_lufs is not None else None),
)
print(out)
`
    const py = spawn(pythonCmd, ['-c', script], {
      cwd: pythonDir,
      env: pythonSpawnEnv(),
    })
    let stdout = ''
    let stderr = ''
    py.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    py.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    py.on('close', (code: number) => {
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(new Error(stderr || `render-corrected-eq exited ${code}`))
      }
    })
    py.stdin.end(JSON.stringify({
      src: srcPath,
      bands,
      outPath,
      truePeakLimit: truePeakLimit ?? false,
      ceilingDbtp: ceilingDbtp ?? -1.0,
      targetLufs: targetLufs ?? null,
    }))
  })
})

// Save-dialog helper for exports
ipcMain.handle('save-file-dialog', async (_e, defaultName: string, contents: string, filters: any[]) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: filters || [{ name: 'All Files', extensions: ['*'] }],
  })
  if (result.canceled || !result.filePath) return null
  fs.writeFileSync(result.filePath, contents, 'utf8')
  return result.filePath
})

// Binary save dialog — same as above but writes a Uint8Array
// (ArrayBuffer on the wire).  Used by the DAW-preset exporters that
// produce gzipped / binary output (Ableton .adg).
ipcMain.handle('save-binary-file-dialog', async (_e, defaultName: string, bytes: Uint8Array | ArrayBuffer, filters: any[]) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: filters || [{ name: 'All Files', extensions: ['*'] }],
  })
  if (result.canceled || !result.filePath) return null
  const buf = bytes instanceof ArrayBuffer ? Buffer.from(bytes) : Buffer.from(bytes as any)
  fs.writeFileSync(result.filePath, buf)
  return result.filePath
})

// Open-dialog helper that reads a text/JSON file and returns its contents.
// Used for "Load album session" — the renderer parses the JSON itself so we
// don't bake the schema into the main process. Returns { path, contents }
// or null on cancel / read failure.
ipcMain.handle('open-text-file-dialog', async (_e, filters: any[]) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: filters || [{ name: 'All Files', extensions: ['*'] }],
  })
  if (result.canceled || !result.filePaths[0]) return null
  const p = result.filePaths[0]
  try {
    const contents = fs.readFileSync(p, 'utf8')
    return { path: p, contents }
  } catch {
    return null
  }
})

ipcMain.handle('reveal-in-finder', async (_e, filePath: string) => {
  const { shell } = require('electron') as typeof import('electron')
  try {
    shell.showItemInFolder(filePath)
    return true
  } catch { return false }
})

ipcMain.handle('cancel-analysis', async () => {
  return cancelActiveAnalysis()
})

ipcMain.handle('copy-to-clipboard', async (_e, text: string) => {
  const { clipboard } = require('electron') as typeof import('electron')
  clipboard.writeText(text)
  return true
})

ipcMain.handle('analyze-files', async (event, fileA: string, fileB: string, fast: boolean = true, profile: string = 'ohad') => {
  assertSafeAudioPath(fileA, 'analyze-files (A)')
  assertSafeAudioPath(fileB, 'analyze-files (B)')
  const sendProgress = (msg: string) => {
    mainWindow?.webContents.send('analysis-progress', msg)
  }

  try {
    const result = await analyzePython(fileA, fileB, sendProgress, fast, profile)
    return result
  } catch (err: any) {
    throw new Error(err.message || 'Analysis failed')
  }
})

// ── RTM De-click ─────────────────────────────────────────────────────
// Thin wrapper around python/declick.py. Two handlers share one helper:
//   declick-process  — full-length render/list with user-chosen params
//   declick-preview  — forced 10 s preview, mode=repair, fixed output
//                      path at ~/.rtm/declick-preview.wav so the UI can
//                      A/B against the original without a save dialog.
// declick.py prints a single JSON object to stdout. stderr is only used
// for logging; we capture the tail on non-zero exit for diagnostics.
interface DeclickArgs {
  inPath: string
  outPath?: string
  algorithm: string
  sensitivity: number
  skew: number
  widenMs: number
  mode: 'repair' | 'clicks' | 'list'
}

function runDeclick(args: DeclickArgs, previewHead: boolean): Promise<any> {
  assertSafeAudioPath(args.inPath, previewHead ? 'declick-preview' : 'declick-process')
  return new Promise((resolve, reject) => {
    const { pythonCmd, pythonDir } = getPythonPaths()
    const scriptPath = path.join(pythonDir, 'declick.py')
    const cliArgs: string[] = [scriptPath, args.inPath]
    if (args.outPath) {
      cliArgs.push('--out', args.outPath)
    }
    cliArgs.push('--algorithm', args.algorithm)
    cliArgs.push('--sensitivity', String(args.sensitivity))
    cliArgs.push('--skew', String(args.skew))
    cliArgs.push('--widen-ms', String(args.widenMs))
    cliArgs.push('--mode', args.mode)

    const { spawn } = require('child_process') as typeof import('child_process')
    // Preview mode: cap to first 10 s by instructing declick.py via an
    // environment flag the script itself doesn't honour today; fall back
    // to a stdin pre-slice is overkill. Simplest solution: use the
    // wrapper Python -c script to slice the file into a tmp WAV first
    // when previewHead is true.
    let spawnArgs: string[]
    let spawnScriptPath: string
    let tmpSlicePath: string | null = null

    if (previewHead) {
      // Build a tiny inline shim that:
      //   1. reads the first 10 s of payload['inPath'] into a tmp WAV
      //   2. imports declick and processes that tmp WAV with the same params
      //   3. prints the resulting JSON on stdout
      // ALL user-controlled values flow through JSON-on-stdin — the script
      // template only references `payload[...]`. Previous version inlined
      // numeric args (sensitivity / skew / widenMs) into Python source,
      // which was a renderer-compromise → arbitrary-Python-execution gap
      // (audit P0-2, fixed in 5.2.0). Only constants and the trusted
      // `pythonDir` path may be interpolated into this template.
      const previewDir = path.join(require('os').homedir(), '.rtm')
      try { fs.mkdirSync(previewDir, { recursive: true }) } catch {}
      tmpSlicePath = path.join(require('os').tmpdir(), `rtm-declick-slice-${Date.now()}.wav`)
      const previewOut = path.join(previewDir, 'declick-preview.wav')
      const shim = `
import sys, os, json
sys.path.insert(0, ${JSON.stringify(pythonDir)})
import soundfile as sf
import numpy as np
payload = json.loads(sys.stdin.read())
src = payload['inPath']
slice_path = payload['tmpSlicePath']
out_path = payload['previewOut']
algorithm = str(payload['algorithm'])
sensitivity = float(payload['sensitivity'])
frequency_skew = float(payload['skew'])
click_widening_ms = float(payload['widenMs'])
data, sr = sf.read(src, always_2d=True)
head = data[: int(sr * 10.0)]
sf.write(slice_path, head, sr)
from declick import declick_file, DeclickParams
params = DeclickParams(
    algorithm=algorithm,
    sensitivity=sensitivity,
    frequency_skew=frequency_skew,
    click_widening_ms=click_widening_ms,
    output_mode="repair",
)
result = declick_file(slice_path, out_path, params)
from dataclasses import asdict
d = asdict(result)
d["clicks"] = [asdict(c) for c in result.clicks]
try:
    os.unlink(slice_path)
except Exception:
    pass
print(json.dumps(d))
`
      spawnScriptPath = '-c'
      spawnArgs = [spawnScriptPath, shim]
      // Stash the JSON-stdin payload for the spawn block below to write.
      ;(globalThis as any).__declick_preview_payload__ = JSON.stringify({
        inPath: String(args.inPath),
        tmpSlicePath: String(tmpSlicePath),
        previewOut: String(previewOut),
        algorithm: String(args.algorithm),
        sensitivity: Number(args.sensitivity),
        skew: Number(args.skew),
        widenMs: Number(args.widenMs),
      })
    } else {
      spawnScriptPath = scriptPath
      spawnArgs = cliArgs
    }

    const proc = spawn(pythonCmd, spawnArgs, {
      cwd: pythonDir,
      env: pythonSpawnEnv(),
    })
    // Stream the JSON payload to stdin for the preview shim — this is
    // how user-supplied params reach the Python script SAFELY (never
    // interpolated into source).
    const previewPayload = (globalThis as any).__declick_preview_payload__ as string | undefined
    if (previewPayload && spawnScriptPath === '-c') {
      proc.stdin.end(previewPayload)
      ;(globalThis as any).__declick_preview_payload__ = undefined
    }
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code: number) => {
      if (tmpSlicePath) {
        try { fs.unlinkSync(tmpSlicePath) } catch {}
      }
      if (code !== 0) {
        reject(new Error(`declick exit ${code}: ${stderr.slice(-500)}`))
        return
      }
      try {
        // declick.py and the preview shim both print a single JSON object
        // on the final line. Defensive .pop() in case an import-time
        // warning went to stdout ahead of the payload.
        const payload = stdout.trim().split('\n').pop() || '{}'
        resolve(JSON.parse(payload))
      } catch (err: any) {
        reject(new Error(`declick parse failed: ${err?.message}; raw=${stdout.slice(-300)}`))
      }
    })
    proc.on('error', (err: Error) => reject(new Error(`Could not start Python: ${err.message}`)))
  })
}

ipcMain.handle('declick-process', async (_e, args: DeclickArgs) => {
  if (!args?.inPath) throw new Error('declick-process: missing inPath')
  return await runDeclick(args, false)
})

ipcMain.handle('declick-preview', async (_e, args: DeclickArgs) => {
  if (!args?.inPath) throw new Error('declick-preview: missing inPath')
  return await runDeclick(args, true)
})

// ── ISRC history / Releases store / Audit log — REMOVED (FLOW territory)
// These features migrated to FLOW. Only RTM's analyser-side BWF metadata
// reading stays — see python/metadata_reader.py for the read path that
// surfaces ISRC, BEXT, iXML in QC reports. Anything that mutates the
// label-side delivery state belongs in FLOW now.

// ── Reference Library ────────────────────────────────────────────────────
// An auto-recalling, analysed library of reference tracks the engineer
// can summon as File A for any comparison.  Stored at
// ~/.rtm/references.json as a single append-mostly array; each record
// is the quick-scan output (LUFS / TP / LRA / spectrum / BPM / key) +
// user-added tags + notes.  The reference audio files stay wherever the
// user keeps them — we only index the path, not the bytes.
//
// This is a moat feature: Reference 4 / LEVELS let you *load* a
// reference, but never auto-extract + persist the full delivery-grade
// metadata and feed it back into live matching.  We do.
const REFERENCES_PATH = path.join(require('os').homedir(), '.rtm', 'references.json')
interface RefRecord {
  id: string
  path: string
  filename: string
  added_at: string  // ISO-8601
  // Quick-scan results — all optional so a partial scan still lands.
  sample_rate?: number
  channels?: number
  duration_sec?: number
  lufs_i?: number | null
  lra?: number
  true_peak_dbtp?: number
  spectrum?: number[]
  bpm?: number
  key?: string
  // User-editable.
  tags?: string[]
  notes?: string
  error?: string
}
function readRefs(): RefRecord[] {
  try {
    if (!fs.existsSync(REFERENCES_PATH)) return []
    return JSON.parse(fs.readFileSync(REFERENCES_PATH, 'utf8')) as RefRecord[]
  } catch { return [] }
}
function writeRefs(list: RefRecord[]) {
  const dir = path.dirname(REFERENCES_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const tmp = `${REFERENCES_PATH}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8')
  fs.renameSync(tmp, REFERENCES_PATH)
}
ipcMain.handle('references-list', async () => readRefs())
ipcMain.handle('references-delete', async (_e, id: string) => {
  const list = readRefs().filter(r => r.id !== id)
  writeRefs(list)
  return true
})
ipcMain.handle('references-update', async (_e, id: string, patch: Partial<RefRecord>) => {
  const list = readRefs()
  const idx = list.findIndex(r => r.id === id)
  if (idx < 0) return null
  // Only allow user-editable fields through — never overwrite analysis.
  const safe: Partial<RefRecord> = {}
  if (patch.tags) safe.tags = patch.tags
  if (patch.notes != null) safe.notes = patch.notes
  list[idx] = { ...list[idx], ...safe }
  writeRefs(list)
  return list[idx]
})
ipcMain.handle('references-add', async (_e, srcPath: string) => {
  try { assertSafeAudioPath(srcPath, 'references-add') }
  catch (err: any) { return { error: err?.message || 'file not found' } }
  const list = readRefs()
  // De-dupe by absolute path — re-adding the same file updates the
  // record instead of creating a second row.
  const existing = list.find(r => r.path === srcPath)
  const id = existing?.id || `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const filename = path.basename(srcPath)

  // Run the quick-scan through Python.
  const basePath = app.isPackaged ? (process as any).resourcesPath : path.join(__dirname, '..')
  const pythonDir = path.join(basePath, 'python')
  const winBundled = path.join(basePath, 'python-bundle-win', 'python', 'python.exe')
  const macBundled = path.join(basePath, 'python-bundle', 'python', 'bin', 'python3')
  const pyBin = (process.platform === 'win32' && fs.existsSync(winBundled)) ? winBundled
    : (fs.existsSync(macBundled) ? macBundled : 'python3')
  const scriptPath = path.join(pythonDir, 'reference_quickscan.py')
  const { spawn } = require('child_process') as typeof import('child_process')
  const scan = await new Promise<any>((resolve) => {
    const proc = spawn(pyBin, [scriptPath, srcPath], { cwd: pythonDir, env: pythonSpawnEnv() })
    let out = '', err = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { err += d.toString() })
    proc.on('close', (code: number) => {
      if (code !== 0) { resolve({ error: `python exit ${code}: ${err.slice(-300)}` }); return }
      try { resolve(JSON.parse(out.trim().split('\n').pop() || '{}')) }
      catch (e: any) { resolve({ error: `parse failed: ${e?.message}` }) }
    })
    proc.on('error', (e: Error) => resolve({ error: e.message }))
  })

  const record: RefRecord = {
    id,
    path: srcPath,
    filename,
    added_at: existing?.added_at || new Date().toISOString(),
    tags: existing?.tags || [],
    notes: existing?.notes || '',
    ...scan,
  }
  if (existing) {
    const idx = list.findIndex(r => r.id === existing.id)
    list[idx] = record
  } else {
    list.unshift(record)
  }
  writeRefs(list)
  return record
})

// ═══════════════════════════════════════════════════════════════════
// RTM Send-to-RTM Receiver
// ═══════════════════════════════════════════════════════════════════
//
// Bridge from the RTM DAW plugin (JUCE AU/VST3/AAX sitting on the
// master bus) into this Electron app.  Architecture:
//
//   Plugin captures the last N seconds of audio into an internal ring
//   buffer.  When the user hits "Send to RTM", the plugin writes:
//     ~/.rtm/incoming/<timestamp>-<session>.wav          (audio)
//     ~/.rtm/incoming/<timestamp>-<session>.rtm.json     (metadata)
//     ~/.rtm/incoming/<timestamp>-<session>.ready        (marker)
//
//   The .ready sidecar is the "this file is complete, safe to read"
//   marker — without it we'd risk the watcher grabbing a half-written
//   WAV.  When fs.watch fires for the .ready file, we move the trio
//   into ~/.rtm/inbox/ (atomic), then emit `rtm-incoming` on the IPC
//   bus.  The renderer shows a notification chip; click loads the
//   file into Compare.
//
// Every field of this protocol is documented in rtm-send-plugin/README.md.

const INCOMING_DIR = path.join(require('os').homedir(), '.rtm', 'incoming')
const INBOX_DIR = path.join(require('os').homedir(), '.rtm', 'inbox')

interface IncomingDrop {
  audioPath: string
  metaPath: string | null
  meta: any | null
}

function readMetaSafe(metaPath: string | null): any | null {
  if (!metaPath || !fs.existsSync(metaPath)) return null
  try { return JSON.parse(fs.readFileSync(metaPath, 'utf8')) }
  catch { return null }
}

function processReadyMarker(readyPath: string): IncomingDrop | null {
  // Base name matches the audio + metadata files.
  const base = readyPath.replace(/\.ready$/, '')
  const candidateWav = `${base}.wav`
  const candidateMeta = `${base}.rtm.json`
  if (!fs.existsSync(candidateWav)) {
    // The plugin may have written them in a different order; give up
    // cleanly and let the next scan pick up a fully-formed pair.
    return null
  }
  // 5.3.0 (audit P0 #4): refuse to follow a symlink. A same-user
  // attacker can pre-plant `<predictable>.wav` as a symlink to e.g.
  // ~/Library/Cookies/Cookies.binarycookies and have us rename it
  // into our inbox. lstat-equivalent via fs.lstatSync.
  try {
    const wavStat = fs.lstatSync(candidateWav)
    if (!wavStat.isFile() || wavStat.isSymbolicLink()) {
      console.warn('[rtm-incoming] refusing non-regular file:', candidateWav)
      return null
    }
    if (fs.existsSync(candidateMeta)) {
      const metaStat = fs.lstatSync(candidateMeta)
      if (!metaStat.isFile() || metaStat.isSymbolicLink()) {
        console.warn('[rtm-incoming] refusing non-regular meta:', candidateMeta)
        return null
      }
    }
    const readyStat = fs.lstatSync(readyPath)
    if (!readyStat.isFile() || readyStat.isSymbolicLink()) {
      console.warn('[rtm-incoming] refusing non-regular .ready:', readyPath)
      return null
    }
  } catch {
    return null
  }
  // 5.3.0 (audit P1 #9): if the .ready marker carries SHA-256 hashes
  // (RTM Send 1.1.0+), verify the WAV + JSON match before promoting.
  // RTM Send 1.0.0 wrote a zero-byte marker — we accept that for
  // back-compat but emit a debug note so we know which clients are
  // pre-1.1.0. Tolerant additive per docs/protocol.md.
  try {
    const readyText = fs.readFileSync(readyPath, 'utf8').trim()
    if (readyText.length > 0) {
      const ready = JSON.parse(readyText)
      const verify = (filePath: string, expected: unknown) => {
        if (typeof expected !== 'string' || !expected) return true
        const buf = fs.readFileSync(filePath)
        const got = require('crypto').createHash('sha256').update(buf).digest('hex')
        return got.toLowerCase() === expected.toLowerCase()
      }
      if (!verify(candidateWav, ready.wavSha256)) {
        console.warn('[rtm-incoming] WAV SHA-256 mismatch — refusing drop:', candidateWav)
        return null
      }
      if (fs.existsSync(candidateMeta) && !verify(candidateMeta, ready.jsonSha256)) {
        console.warn('[rtm-incoming] JSON SHA-256 mismatch — refusing drop:', candidateMeta)
        return null
      }
    }
  } catch (err) {
    console.warn('[rtm-incoming] .ready parse failed (treating as legacy zero-byte marker):', err)
  }
  if (!fs.existsSync(INBOX_DIR)) fs.mkdirSync(INBOX_DIR, { recursive: true })
  const inboxWav = path.join(INBOX_DIR, path.basename(candidateWav))
  const inboxMeta = fs.existsSync(candidateMeta) ? path.join(INBOX_DIR, path.basename(candidateMeta)) : null
  try {
    fs.renameSync(candidateWav, inboxWav)
    if (inboxMeta) fs.renameSync(candidateMeta, inboxMeta)
    fs.unlinkSync(readyPath)
  } catch (err) {
    console.error('rtm-incoming move failed:', err)
    return null
  }
  return {
    audioPath: inboxWav,
    metaPath: inboxMeta,
    meta: readMetaSafe(inboxMeta),
  }
}

/** Broadcast a drop to the renderer — only one window, so just emit to it. */
function broadcastIncoming(drop: IncomingDrop) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('rtm-incoming', drop)
    // Attention nudge — flash dock / taskbar so the engineer sees it.
    try {
      if (process.platform === 'darwin') app.dock?.bounce('informational')
      else mainWindow.flashFrame(true)
    } catch {}
  }
}

let incomingWatcher: ReturnType<typeof fs.watch> | null = null
function startIncomingWatcher() {
  if (incomingWatcher) return
  if (!fs.existsSync(INCOMING_DIR)) fs.mkdirSync(INCOMING_DIR, { recursive: true })
  // Sweep any pre-existing .ready files that landed while the app
  // was closed (plugin can write them between sessions).
  try {
    for (const f of fs.readdirSync(INCOMING_DIR)) {
      if (f.endsWith('.ready')) {
        const drop = processReadyMarker(path.join(INCOMING_DIR, f))
        if (drop) broadcastIncoming(drop)
      }
    }
  } catch {}
  try {
    // 5.2.0 hardening: filename must be a single basename matching a
    // strict whitelist. Stops malware on the same machine from dropping
    // `../../Library/LaunchAgents/x.plist.ready` and having us rename
    // arbitrary files into ~/.rtm/inbox/. The DAW plugin only ever
    // writes plain ASCII names anyway.
    const SAFE_INCOMING = /^[A-Za-z0-9_.-]+\.ready$/
    // 5.2.2 (audit P1-W5): Windows fs.watch fires multiple events per
    // write (rename + change pair on .ready drops), so the same .wav
    // gets re-broadcast 2-3× per Send. In-memory dedup with 1 s TTL
    // suppresses repeats on every platform — also defends against any
    // other multi-event watcher quirks.
    const recentBroadcasts = new Map<string, number>()
    const DEDUP_WINDOW_MS = 1000
    incomingWatcher = fs.watch(INCOMING_DIR, (event, filename) => {
      if (!filename) return
      if (!filename.endsWith('.ready')) return
      // Reject path-traversal / symlink-target / non-ASCII shenanigans.
      // path.basename round-trip catches platform-quirky separators too.
      const safeName = path.basename(String(filename))
      if (safeName !== String(filename) || !SAFE_INCOMING.test(safeName)) {
        try { fs.unlinkSync(path.join(INCOMING_DIR, safeName)) } catch {}
        return
      }
      const now = Date.now()
      const last = recentBroadcasts.get(safeName)
      if (last != null && now - last < DEDUP_WINDOW_MS) {
        return
      }
      recentBroadcasts.set(safeName, now)
      // Sweep stale entries periodically to keep the map bounded.
      if (recentBroadcasts.size > 100) {
        for (const [k, v] of recentBroadcasts) {
          if (now - v > DEDUP_WINDOW_MS * 5) recentBroadcasts.delete(k)
        }
      }
      // Debounce tiny write latency — a 50 ms pause lets the plugin
      // finish rename + fsync on slow drives.
      setTimeout(() => {
        const readyPath = path.join(INCOMING_DIR, filename)
        if (!fs.existsSync(readyPath)) return
        const drop = processReadyMarker(readyPath)
        if (drop) broadcastIncoming(drop)
      }, 50)
    })
  } catch (err) {
    console.error('rtm-incoming watcher failed:', err)
  }
}

// Start the watcher once the main window is ready.  Placed after
// createWindow so mainWindow is initialised; guarded so we can call
// it safely on will-quit too.
ipcMain.handle('rtm-incoming-list', async () => {
  if (!fs.existsSync(INBOX_DIR)) return []
  const out: IncomingDrop[] = []
  for (const f of fs.readdirSync(INBOX_DIR)) {
    if (!f.endsWith('.wav')) continue
    const audioPath = path.join(INBOX_DIR, f)
    const metaPath = path.join(INBOX_DIR, f.replace(/\.wav$/, '.rtm.json'))
    out.push({
      audioPath,
      metaPath: fs.existsSync(metaPath) ? metaPath : null,
      meta: fs.existsSync(metaPath) ? readMetaSafe(metaPath) : null,
    })
  }
  // Newest first.
  out.sort((a, b) => fs.statSync(b.audioPath).mtimeMs - fs.statSync(a.audioPath).mtimeMs)
  return out
})
// `rtm-incoming-clear` used to `unlinkSync` every file in INBOX_DIR.  That
// was catastrophic: if the user was mid-analysis on a file whose path lived
// in the inbox (normal for plug-in drops), dismissing the banner deleted
// the actual WAV out from under the Python analyser and the next run
// crashed with `File not found`.  We keep the handler so the renderer keeps
// compiling, but it no longer touches the filesystem.  The renderer
// clears its visible `drops` state locally and persists a dismissed-paths
// set in localStorage so the chip doesn't re-appear for already-seen drops.
// If the disk actually needs tidying, a dedicated Archive operation can do
// that later — the plug-in rewrites its drops on every bounce so it's fine
// to leave the inbox populated.
ipcMain.handle('rtm-incoming-clear', async () => {
  return 0
})

app.whenReady().then(() => {
  // Delay a tick so mainWindow is populated.
  setTimeout(startIncomingWatcher, 150)
})
app.on('will-quit', () => {
  try { incomingWatcher?.close() } catch {}
  incomingWatcher = null
})

// BWF user-facing write-back IPC removed — that capability lives in FLOW
// now. RTM still stamps BWF metadata on its own master-chain renders via
// python/master_chain.py invoking python/bwf_writer.py internally; the
// renderer-callable handler that lets the engineer rewrite an arbitrary
// existing file's BEXT / iXML is the FLOW-territory feature we cut.

// ── Master-Chain render (Master Assistant's full HPF → EQ → comp →
//    TP-limiter → dither pipeline, rendered offline to a WAV) ─────────
ipcMain.handle('master-chain-render', async (_event, srcPath: string, config: any, outPath?: string) => {
  if (!config) return { ok: false, error: 'missing config' }
  try { assertSafeAudioPath(srcPath, 'master-chain-render') }
  catch (err: any) { return { ok: false, error: err?.message || 'invalid srcPath' } }
  try {
    const basePath = app.isPackaged ? (process as any).resourcesPath : path.join(__dirname, '..')
    const pythonDir = path.join(basePath, 'python')
    const winBundled = path.join(basePath, 'python-bundle-win', 'python', 'python.exe')
    const macBundled = path.join(basePath, 'python-bundle', 'python', 'bin', 'python3')
    const pyBin = (process.platform === 'win32' && fs.existsSync(winBundled)) ? winBundled
      : (fs.existsSync(macBundled) ? macBundled : 'python3')
    const scriptPath = path.join(pythonDir, 'master_chain.py')

    // Resolve out path via save dialog when caller didn't supply one.
    let resolvedOut = outPath
    if (!resolvedOut) {
      const base = path.basename(srcPath).replace(/\.[^.]+$/, '')
      const suggested = `${base}_mastered.wav`
      const res = await dialog.showSaveDialog({
        defaultPath: suggested,
        filters: [{ name: 'WAV', extensions: ['wav'] }],
      })
      if (res.canceled || !res.filePath) return { ok: false, cancelled: true }
      resolvedOut = res.filePath
    }

    // Stash config into a tmp JSON so we don't have to quote-escape on Windows.
    const cfgPath = path.join(require('os').tmpdir(), `rtm-master-chain-${Date.now()}.json`)
    fs.writeFileSync(cfgPath, JSON.stringify(config), 'utf8')
    const { spawn } = require('child_process') as typeof import('child_process')
    return await new Promise<any>((resolve) => {
      const proc = spawn(pyBin, [scriptPath, srcPath, resolvedOut!, cfgPath], { cwd: pythonDir, env: pythonSpawnEnv() })
      let out = '', err = ''
      proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
      proc.stderr.on('data', (d: Buffer) => { err += d.toString() })
      proc.on('close', (code: number) => {
        try { fs.unlinkSync(cfgPath) } catch {}
        if (code !== 0) { resolve({ ok: false, error: `python exit ${code}: ${err.slice(-400)}` }); return }
        try { resolve(JSON.parse(out.trim().split('\n').pop() || '{}')) }
        catch (e: any) { resolve({ ok: false, error: `parse failed: ${e?.message}; raw=${out.slice(-300)}` }) }
      })
      proc.on('error', (e: Error) => resolve({ ok: false, error: e.message }))
    })
  } catch (err: any) {
    return { ok: false, error: err?.message || 'master-chain dispatch failed' }
  }
})

// ── Encoded-Preview (Apple Sound Check twin + other DSPs) ────────────────
// Renders a 30-second AAC 256k audition through the DSP's *real* chain:
// normalisation gain → 4× oversampled TP limiter → AAC codec.  The cache
// lives in app.getPath('temp')/rtm-encoded-preview; keys are
// `${sha1(srcPath+mtime+dsp+lufs)}.m4a` so repeated auditions of the same
// (file, DSP) pair hit disk once.  Cache cleared on app quit.
const ENCODED_PREVIEW_DIR = path.join(require('os').tmpdir(), 'rtm-encoded-preview')
ipcMain.handle('encoded-preview-render', async (_event, srcPath: string, dsp: string, integratedLufs: number | null, windowStartSec?: number | null) => {
  try { assertSafeAudioPath(srcPath, 'encoded-preview-render') }
  catch (err: any) { return { ok: false, error: err?.message || 'invalid source path' } }
  try {
    if (!fs.existsSync(ENCODED_PREVIEW_DIR)) fs.mkdirSync(ENCODED_PREVIEW_DIR, { recursive: true })
    const crypto = require('crypto')
    const stat = fs.statSync(srcPath)
    const key = crypto.createHash('sha1').update(`${srcPath}|${stat.mtimeMs}|${dsp}|${integratedLufs ?? ''}|${windowStartSec ?? ''}`).digest('hex')
    const outPath = path.join(ENCODED_PREVIEW_DIR, `${key}.m4a`)
    // Cache hit — skip the Python round-trip.
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      return { ok: true, path: outPath, cached: true, dsp }
    }
    const basePath = app.isPackaged ? (process as any).resourcesPath : path.join(__dirname, '..')
    const pythonDir = path.join(basePath, 'python')
    const winBundled = path.join(basePath, 'python-bundle-win', 'python', 'python.exe')
    const macBundled = path.join(basePath, 'python-bundle', 'python', 'bin', 'python3')
    const pyBin = (process.platform === 'win32' && fs.existsSync(winBundled)) ? winBundled
      : (fs.existsSync(macBundled) ? macBundled : 'python3')
    const scriptPath = path.join(pythonDir, 'encoded_preview.py')
    const args = [scriptPath, srcPath, outPath, dsp]
    // Python CLI expects positional args: [src, out, dsp, lufs,
    // start_sec].  Supply '' placeholders so we can pass start_sec.
    args.push(integratedLufs != null ? String(integratedLufs) : '')
    if (windowStartSec != null) args.push(String(windowStartSec))
    const { spawn } = require('child_process') as typeof import('child_process')
    return await new Promise<any>((resolve) => {
      const proc = spawn(pyBin, args, { cwd: pythonDir, env: pythonSpawnEnv() })
      let out = '', err = ''
      proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
      proc.stderr.on('data', (d: Buffer) => { err += d.toString() })
      proc.on('close', (code: number) => {
        if (code !== 0) { resolve({ ok: false, error: `python exit ${code}: ${err.slice(-400)}` }); return }
        try { resolve(JSON.parse(out.trim().split('\n').pop() || '{}')) }
        catch (e: any) { resolve({ ok: false, error: `parse failed: ${e?.message}; raw=${out.slice(-400)}` }) }
      })
      proc.on('error', (e: Error) => resolve({ ok: false, error: e.message }))
    })
  } catch (err: any) {
    return { ok: false, error: err?.message || 'encoded-preview dispatch failed' }
  }
})
// Clear cache on quit so old renders don't balloon /tmp.
app.on('will-quit', () => {
  try {
    if (fs.existsSync(ENCODED_PREVIEW_DIR)) {
      for (const f of fs.readdirSync(ENCODED_PREVIEW_DIR)) {
        try { fs.unlinkSync(path.join(ENCODED_PREVIEW_DIR, f)) } catch {}
      }
    }
  } catch {}
})

// ── Translation-check render ─────────────────────────────────────────────
// Auditions a master through a non-streaming playback environment
// (phone speaker / earbuds / club PA / car cabin). Sister IPC to
// encoded-preview-render but skips platform normalisation entirely —
// this answers "what does the MIX sound like in that environment",
// not "what does each streaming platform serve". Same caching shape:
// hash the (path, mtime, env, start) and reuse the .m4a if it exists.
const TRANSLATION_RENDER_DIR = path.join(require('os').tmpdir(), 'rtm-translation-render')
ipcMain.handle('translation-render', async (_event, srcPath: string, envId: string, windowStartSec?: number | null) => {
  try { assertSafeAudioPath(srcPath, 'translation-render') }
  catch (err: any) { return { ok: false, error: err?.message || 'invalid source path' } }
  try {
    if (!fs.existsSync(TRANSLATION_RENDER_DIR)) fs.mkdirSync(TRANSLATION_RENDER_DIR, { recursive: true })
    const crypto = require('crypto')
    const stat = fs.statSync(srcPath)
    const key = crypto.createHash('sha1').update(`${srcPath}|${stat.mtimeMs}|${envId}|${windowStartSec ?? ''}`).digest('hex')
    const outPath = path.join(TRANSLATION_RENDER_DIR, `${key}.m4a`)
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      return { ok: true, path: outPath, cached: true, env_id: envId }
    }
    const basePath = app.isPackaged ? (process as any).resourcesPath : path.join(__dirname, '..')
    const pythonDir = path.join(basePath, 'python')
    const winBundled = path.join(basePath, 'python-bundle-win', 'python', 'python.exe')
    const macBundled = path.join(basePath, 'python-bundle', 'python', 'bin', 'python3')
    const pyBin = (process.platform === 'win32' && fs.existsSync(winBundled)) ? winBundled
      : (fs.existsSync(macBundled) ? macBundled : 'python3')
    const scriptPath = path.join(pythonDir, 'translation_render.py')
    const args = [scriptPath, srcPath, outPath, envId]
    if (windowStartSec != null) args.push(String(windowStartSec))
    const { spawn } = require('child_process') as typeof import('child_process')
    return await new Promise<any>((resolve) => {
      const proc = spawn(pyBin, args, { cwd: pythonDir, env: pythonSpawnEnv() })
      let out = '', err = ''
      proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
      proc.stderr.on('data', (d: Buffer) => { err += d.toString() })
      proc.on('close', (code: number) => {
        if (code !== 0) { resolve({ ok: false, error: `python exit ${code}: ${err.slice(-400)}` }); return }
        try { resolve(JSON.parse(out.trim().split('\n').pop() || '{}')) }
        catch (e: any) { resolve({ ok: false, error: `parse failed: ${e?.message}; raw=${out.slice(-400)}` }) }
      })
      proc.on('error', (e: Error) => resolve({ ok: false, error: e.message }))
    })
  } catch (err: any) {
    return { ok: false, error: err?.message || 'translation-render dispatch failed' }
  }
})
app.on('will-quit', () => {
  try {
    if (fs.existsSync(TRANSLATION_RENDER_DIR)) {
      for (const f of fs.readdirSync(TRANSLATION_RENDER_DIR)) {
        try { fs.unlinkSync(path.join(TRANSLATION_RENDER_DIR, f)) } catch {}
      }
    }
  } catch {}
})

// ── Default export folder (skip-the-dialog for power users) ──────────────
// Panel feedback (Dani, Eli): "I bounce 3–4 times per session; the modal
// every time is real time."  The renderer picks a folder once (via the
// system dialog), stashes the path in localStorage, and from then on
// every export calls the `-direct` variants below that write straight
// to <folder>/<name> without prompting. The picker handler lives here so
// the renderer never has to touch the filesystem directly.
ipcMain.handle('pick-folder', async (_event, title?: string) => {
  const result = await dialog.showOpenDialog({
    title: title || 'Choose the default export folder',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})
ipcMain.handle('write-file-direct', async (_event, folderPath: string, fileName: string, contents: string | Uint8Array) => {
  if (!folderPath || !fileName) return { error: 'missing folderPath or fileName' }
  try {
    const safeDir = assertSafeDir(folderPath, 'write-file-direct')
    const sanitised = fileName.replace(/[\\/:*?"<>|]/g, '_')
    if (!sanitised || sanitised.length > 256) {
      return { error: 'invalid fileName' }
    }
    const finalPath = path.join(safeDir, sanitised)
    fs.writeFileSync(finalPath, contents as any)
    return finalPath
  } catch (err: any) {
    return { error: err?.message || 'direct write failed' }
  }
})
ipcMain.handle('render-pdf-direct', async (_event, folderPath: string, fileName: string, html: string) => {
  if (!folderPath || !fileName) return { error: 'missing folderPath or fileName' }
  let safeDir: string
  try { safeDir = assertSafeDir(folderPath, 'render-pdf-direct') }
  catch (err: any) { return { error: err?.message || 'invalid folder' } }
  const sanitised = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`
  if (sanitised.length > 256) return { error: 'invalid fileName' }
  const finalPath = path.join(safeDir, sanitised.replace(/[\\/:*?"<>|]/g, '_'))

  const hidden = new BrowserWindow({
    show: false,
    width: 820,
    height: 1160,
    webPreferences: { offscreen: false, sandbox: true, contextIsolation: true },
  })
  try {
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
    await hidden.loadURL(dataUrl)
    const pdfBuf = await hidden.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true,
    })
    fs.writeFileSync(finalPath, pdfBuf)
    return finalPath
  } catch (err: any) {
    return { error: err?.message || 'PDF render failed' }
  } finally {
    hidden.close()
  }
})

// ── SHA-256 for Ship-Ready PDF integrity ─────────────────────────────────
// Eli asked for a way to prove the PDF wasn't hand-edited post-export. We
// hash the rendered PDF bytes and return the digest; the renderer writes
// the footer line into the HTML before PDF generation, OR we write a
// sidecar .sha256 file next to the PDF. Both are useful — we offer both
// paths via a single IPC call.
ipcMain.handle('compute-sha256', async (_e, filePath: string) => {
  try { assertSafeAudioPath(filePath, 'compute-sha256') }
  catch (err: any) { return { error: err?.message || 'invalid path' } }
  // 5.2.0: also gate by extension so this can't be used to fingerprint
  // arbitrary files on disk via a renderer compromise.
  const ext = path.extname(filePath).toLowerCase()
  if (!AUDIO_EXT.has(ext)) {
    return { error: 'compute-sha256 only accepts audio files' }
  }
  const crypto = require('crypto')
  try {
    const data = fs.readFileSync(filePath)
    return crypto.createHash('sha256').update(data).digest('hex')
  } catch (err: any) {
    return { error: err?.message || 'hash failed' }
  }
})
ipcMain.handle('write-sidecar', async (_e, filePath: string, suffix: string, contents: string) => {
  try { assertSafeAudioPath(filePath, 'write-sidecar') }
  catch (err: any) { return { error: err?.message || 'invalid base path' } }
  // 5.2.0 hardening: pin the BASE file to a known audio extension so a
  // renderer compromise can't call writeSidecar('/Users/x/.zshrc',
  // '.evil', '...') and plant arbitrary content next to system files.
  // The legitimate use is a `.sha256` next to a master WAV.
  const baseExt = path.extname(filePath).toLowerCase()
  if (!AUDIO_EXT.has(baseExt)) {
    return { error: 'sidecar base must be an audio file (.wav/.flac/.aiff/.aif/.mp3/.m4a/.ogg)' }
  }
  if (typeof suffix !== 'string' || suffix.length === 0 || suffix.length > 64 || suffix.includes('/') || suffix.includes('\\') || suffix.includes('..')) {
    return { error: 'invalid sidecar suffix' }
  }
  try {
    const out = `${filePath}${suffix}`
    // Final guard: the resolved sidecar must still live in the same dir
    // as the source file. Defends against any suffix-based escape.
    const baseDir = path.dirname(path.resolve(filePath))
    const outDir = path.dirname(path.resolve(out))
    if (baseDir !== outDir) {
      return { error: 'sidecar must live in the source file dir' }
    }
    fs.writeFileSync(out, contents, 'utf8')
    return out
  } catch (err: any) {
    return { error: err?.message || 'sidecar write failed' }
  }
})
