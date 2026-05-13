import { app, BrowserWindow, ipcMain, dialog, safeStorage } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import https from 'https'
import http from 'http'
import type { ChildProcess } from 'child_process'
import { analyzePython, ensureDeps, cancelActiveAnalysis, getPythonPaths, pythonSpawnEnv } from './python-bridge'
import { startDaemon, shutdownDaemon, daemonAnalyze, DaemonUnavailableError } from './python-daemon'
import * as rtmsend from './rtmsend-bridge'
import {
  findProfile, listSupportedPlugins, bandsToUpdates, type Profile,
  resolveGraphicIndices, RtmBand,
} from './rtmsend-profiles'
import { autoDetectProfile, captureReference } from './rtmsend-autoprofile'
import {
  ReferenceProfile, listAllReferences, getKnowledgeDir, ArchetypeTag,
} from './rtmsend-knowledge'
import {
  rankPluginsForMove, rankPluginsForBands, bestOverallPlugin,
} from './rtmsend-recommendations'

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

/**
 * Makes a Canvas REST API request using Node's built-in https module.
 * Returns { ok, status, body } — never throws.
 */
function canvasRequest(opts: {
  baseUrl: string
  path: string
  method: string
  token: string
  body?: Record<string, unknown>
}): Promise<{ ok: boolean; status: number; body: unknown }> {
  return new Promise((resolve) => {
    try {
      // CRIT-9 belt-and-braces: even if a tampered config file made it past
      // save-lms-config, re-validate the host allowlist before sending the
      // bearer token. assertCanvasBaseUrl is defined further down; declare
      // a guard here that uses it lazily so module-load order is safe.
      try {
        // assertCanvasBaseUrl will throw if hostname isn't on the allowlist.
        // We don't reuse its return value because the original baseUrl already
        // had whatever path suffix it needs; we only care that the host is OK.
        assertCanvasBaseUrl(opts.baseUrl)
      } catch (e: any) {
        resolve({ ok: false, status: 0, body: { error: e?.message ?? 'baseUrl rejected by allowlist' } })
        return
      }
      const url = new URL(opts.path, opts.baseUrl)
      const isHttps = url.protocol === 'https:'
      const lib = isHttps ? https : http
      const bodyStr = opts.body ? JSON.stringify(opts.body) : undefined

      const req = lib.request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: opts.method,
        headers: {
          'Authorization': `Bearer ${opts.token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        },
        timeout: 15000,
      }, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          let parsed: unknown = data
          try { parsed = JSON.parse(data) } catch { /* keep as string */ }
          resolve({ ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300, status: res.statusCode ?? 0, body: parsed })
        })
      })
      req.on('error', (e) => resolve({ ok: false, status: 0, body: e.message }))
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, body: 'Request timed out' }) })
      if (bodyStr) req.write(bodyStr)
      req.end()
    } catch (e: any) {
      resolve({ ok: false, status: 0, body: e.message })
    }
  })
}

function lmsConfigPath(): string {
  return path.join(app.getPath('userData'), 'lms-config.json')
}

/** Render an HTML string to PDF via a hidden BrowserWindow.
 *  Writes the HTML to a temp file and `loadFile`s it — historically we used a
 *  `data:text/html` URL inline, but Chromium tightened constraints on `loadURL`
 *  for `data:` URIs in recent versions (security + payload size). Temp file is
 *  the canonical pattern and removes the size ceiling for large reports.
 *  The temp file is deleted in the finally block even if rendering throws. */
async function renderHtmlToPdf(
  hidden: BrowserWindow,
  html: string,
  pdfOpts: Electron.PrintToPDFOptions
): Promise<Buffer> {
  const os = require('os') as typeof import('os')
  const tmpDir = path.join(os.tmpdir(), 'rtm-pdf')
  try { fs.mkdirSync(tmpDir, { recursive: true }) } catch {}
  // MED-19 fix: use crypto.randomBytes for the temp filename (Math.random
  // was non-cryptographic and could collide on Windows with two parallel
  // PDF exports started in the same millisecond).
  const crypto = require('crypto') as typeof import('crypto')
  const tmpFile = path.join(
    tmpDir,
    `rtm-pdf-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.html`
  )
  // MED-19 main fix: wrap the ENTIRE body — including writeFileSync — in
  // try/finally so the temp file gets cleaned up even if writing it
  // partially succeeded before disk-full threw. Previously writeFileSync
  // was OUTSIDE the try, leaving partial junk in os.tmpdir()/rtm-pdf/.
  let wrote = false
  try {
    fs.writeFileSync(tmpFile, html, 'utf8')
    wrote = true
    await hidden.loadFile(tmpFile)
    return await hidden.webContents.printToPDF(pdfOpts)
  } finally {
    if (wrote) {
      try { fs.unlinkSync(tmpFile) } catch {}
    } else {
      // Best-effort: the write threw, but a partial file may still exist.
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile) } catch {}
    }
  }
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
      sandbox: true,   // preload uses webUtils.getPathForFile (Electron 30+) — no longer requires sandbox:false
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
    //
    // MED-17 hardening: previously allowed ANY file:// URL. A compromised
    // renderer could navigate to file:///etc/passwd and read it via fetch
    // into the same origin. Now in production we only allow the packaged
    // bundle's own index.html; in dev we allow file:// for hot-reload
    // edge cases and the localhost dev server.
    if (app.isPackaged) {
      // CRIT-1 fix (+ LOW-9 tightening): strict pathname equality, not endsWith.
      // endsWith('/dist/index.html') still allowed /evil/dist/index.html.
      // Build the expected path once from app.getAppPath() so the guard is
      // anchored to the actual resource directory, not just a suffix match.
      let allow = false
      try {
        const parsedUrl = new URL(url)
        // Decode the URL-encoded pathname for accurate comparison
        // LOW-17: normalize decodedPath the same way we normalize expectedPath
        // (backslash→forward-slash) so the comparison is symmetric on Windows.
        const decodedPath = decodeURIComponent(parsedUrl.pathname).replace(/\\/g, '/')
        // Expected packaged path: <resourcesPath>/app.asar/dist/index.html
        // (electron-builder convention; app.getAppPath() returns the asar root)
        const expectedPath = path.join(app.getAppPath(), 'dist', 'index.html')
          .replace(/\\/g, '/')
        // LOW-16: removed the `|| decodedPath === \`/\${expectedPath}\`` branch —
        // on macOS it produced "//Applications/..." which never matches, and on
        // Windows the expectedPath already has a leading "/" from the file: URL,
        // making the double-slash form equally unreachable.
        allow = parsedUrl.protocol === 'file:'
          && decodedPath === expectedPath
          && !decodedPath.includes('..')
      } catch {
        allow = false
      }
      if (!allow) {
        e.preventDefault()
      }
    } else {
      // Dev: only allow Vite HMR localhost — file:// navigation is not needed
      if (!url.startsWith('http://localhost:5173')) {
        e.preventDefault()
      }
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
  // Start persistent Python daemon — pre-warms the interpreter and
  // BS-RoFormer ONNX model so repeat analyses skip the ~13 s cold-start.
  // Non-blocking: daemon boots in the background; analyze-files falls
  // back to the legacy subprocess path if daemon isn't ready yet.
  startDaemon()
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

// ── Atomic file write helper ─────────────────────────────────────────
// CRIT-7/8 fix: bare writeFileSync is non-atomic — a crash mid-write leaves
// a truncated file. This helper writes to a temp file then renames it, which
// is atomic on all major filesystems (ext4, APFS, NTFS).
function atomicWriteFileSync(target: string, contents: string, encoding: BufferEncoding = 'utf8') {
  const tmp = `${target}.tmp${process.pid}`
  try {
    fs.writeFileSync(tmp, contents, encoding)
    fs.renameSync(tmp, target)
  } catch (e) {
    try { fs.unlinkSync(tmp) } catch { /* best-effort cleanup */ }
    throw e
  }
}

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
  // CRIT-7 fix: atomic write via temp-file + rename
  try { atomicWriteFileSync(HISTORY_PATH, JSON.stringify(list, null, 2)) } catch {}
}

// In-memory cache so history-append doesn't re-read the full JSON on every call.
let _historyCache: any[] | null = null
function readHistoryCached(): any[] {
  if (_historyCache === null) _historyCache = readHistorySync()
  return _historyCache
}
function writeHistoryCached(list: any[]) {
  _historyCache = list
  writeHistorySync(list)
}

ipcMain.handle('history-read', async () => {
  _historyCache = null  // force fresh disk read when explicitly requested
  const raw = readHistorySync()
  // Normalise legacy entries that used 'filename' instead of 'name'.
  // The old schema predates 5.x; any entry missing 'name' gets it patched
  // from 'filename', then from the path basename as a last resort.
  return raw.map((e: any) => {
    if (!e.name) {
      return {
        ...e,
        name: e.filename || (e.path ? require('path').basename(String(e.path)) : ''),
      }
    }
    return e
  })
})
ipcMain.handle('history-append', async (_event, entry: any) => {
  const list = readHistoryCached()
  // Dedupe: if the same sha256 was logged within the last 60 s keep only
  // the latest — prevents double-entries on tab-bounce.
  const now = Date.now()
  const sanitized = {
    sha256:       typeof entry?.sha256       === 'string'  ? entry.sha256       : '',
    name:         typeof entry?.name         === 'string'  ? entry.name         : '',
    path:         typeof entry?.path         === 'string'  ? entry.path         : '',
    lufs:         typeof entry?.lufs         === 'number'  ? entry.lufs         : null,
    true_peak:    typeof entry?.true_peak    === 'number'  ? entry.true_peak    : null,
    lra:          typeof entry?.lra          === 'number'  ? entry.lra          : null,
    duration_sec: typeof entry?.duration_sec === 'number'  ? entry.duration_sec : null,
    ref_name:     typeof entry?.ref_name     === 'string'  ? entry.ref_name     : undefined,
    mode:         typeof entry?.mode         === 'string'  ? entry.mode         : null,
    spec_versions: entry?.spec_versions != null && typeof entry.spec_versions === 'object' && !Array.isArray(entry.spec_versions) ? entry.spec_versions : undefined,
    ts:           now,
  }
  const sha = sanitized.sha256
  const filtered = list.filter(e => !(e.sha256 === sha && (now - (e.ts || 0)) < 60 * 1000))
  filtered.push(sanitized)
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
  writeHistoryCached(trimmed)
  return trimmed.length
})
ipcMain.handle('history-clear', async () => {
  writeHistoryCached([])
  return true
})

// Batch / album mode — pick a folder, list audio files inside it, run the
// lite batch analyser. Three handlers:
//   select-folder        → native folder picker
//   list-audio-files     → recursive-ish (depth 1) scan of a directory
//   analyze-batch        → spawns python/batch_analyze.py with file paths
const AUDIO_EXT = new Set(['.wav', '.flac', '.aiff', '.aif', '.mp3', '.m4a', '.ogg'])

// ── Secondary-spawn watchdog ────────────────────────────────────────────
// All secondary Python spawns (everything except the main analyzePython()
// call in python-bridge.ts which has its own watchdog) must go through
// this helper so a corrupt audio file or runaway process can never pin an
// ipcMain handler forever.
//
// Defaults:  5-minute timeout  |  64 MB combined stdout+stderr cap.
// Both are env-tunable (RTM_PY_TIMEOUT_MS, RTM_PY_OUT_CAP_BYTES) so
// developers can override without rebuilding.
const SEC_TIMEOUT_MS  = Number(process.env.RTM_PY_TIMEOUT_MS)    || 5 * 60 * 1000
const SEC_OUT_CAP     = Number(process.env.RTM_PY_OUT_CAP_BYTES)  || 64 * 1024 * 1024

/**
 * Wraps a spawned process with a timeout + stdout/stderr output cap.
 * Returns { stdout, stderr, code } on completion. Rejects with an
 * explanatory error if the timeout fires or output exceeds the cap.
 *
 * @param proc   Already-spawned ChildProcess (caller owns the spawn call
 *               so they can write to stdin, etc. before passing here).
 * @param label  IPC handler name — used in error messages only.
 * @param stdinPayload  Optional string written to stdin and then closed.
 */
function watchdogSpawn(
  proc: ChildProcess,
  label: string,
  stdinPayload?: string | null,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    let stdoutBytes = 0
    let stderrBytes = 0
    let capKilled = false
    let stdout = ''
    let stderr = ''

    const watchdog = setTimeout(() => {
      if (!proc.killed) {
        capKilled = true
        try { proc.kill('SIGTERM') } catch {}
        setTimeout(() => { try { if (!proc.killed) proc.kill('SIGKILL') } catch {} }, 1500)
      }
    }, SEC_TIMEOUT_MS)

    proc.stdout?.on('data', (d: Buffer) => {
      stdoutBytes += d.length
      if (stdoutBytes + stderrBytes > SEC_OUT_CAP) {
        if (!capKilled) { capKilled = true; try { proc.kill('SIGTERM') } catch {} }
        return
      }
      stdout += d.toString()
    })
    proc.stderr?.on('data', (d: Buffer) => {
      stderrBytes += d.length
      if (stdoutBytes + stderrBytes > SEC_OUT_CAP) {
        if (!capKilled) { capKilled = true; try { proc.kill('SIGTERM') } catch {} }
        return
      }
      stderr += d.toString()
    })
    proc.on('close', (code) => {
      clearTimeout(watchdog)
      if (capKilled) {
        const reason = stdoutBytes + stderrBytes >= SEC_OUT_CAP
          ? `output exceeded ${SEC_OUT_CAP / 1024 / 1024} MB cap`
          : `timed out after ${SEC_TIMEOUT_MS / 1000}s`
        reject(new Error(`${label}: Python aborted — ${reason}`))
        return
      }
      resolve({ stdout, stderr, code })
    })
    proc.on('error', (e: Error) => {
      clearTimeout(watchdog)
      reject(new Error(`${label}: Could not start Python — ${e.message}`))
    })

    if (stdinPayload != null) {
      proc.stdin?.end(stdinPayload)
    }
  })
}

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
  // ITER4-SEC: cap to 500 files to prevent unbounded Python process spawning
  if (filePaths.length > 500) {
    throw new Error('analyze-batch: too many files (max 500)')
  }
  for (const p of filePaths) assertSafeAudioPath(p, 'analyze-batch')
  const isPackaged = app.isPackaged
  const basePath = isPackaged ? (process as any).resourcesPath : path.join(__dirname, '..')
  const pythonDir = path.join(basePath, 'python')
  const isWin = process.platform === 'win32'
  const winBundled = path.join(basePath, 'python-bundle-win', 'python', 'python.exe')
  // CRIT-18: select the correct Python bundle for the running CPU arch.
  // Prior code always used python-bundle (arm64); on Intel Macs it would
  // attempt to exec the arm64 binary and fail with "bad CPU type".
  const macArmBundled = path.join(basePath, 'python-bundle', 'python', 'bin', 'python3')
  const macIntelBundled = path.join(basePath, 'python-bundle-intel', 'python', 'bin', 'python3')
  const macBundled = process.arch === 'arm64' ? macArmBundled : macIntelBundled
  const pythonCmd = isWin
    ? (fs.existsSync(winBundled) ? winBundled : 'python.exe')
    : (fs.existsSync(macBundled) ? macBundled : '/usr/bin/python3')

  const { spawn } = require('child_process') as typeof import('child_process')
  const scriptPath = path.join(pythonDir, 'batch_analyze.py')
  // Optional --deep runs full single-file analyses per song in parallel
  // subprocesses inside batch_analyze.py. Users trade longer scan time
  // for every tab being instant in the batch view.
  const args = [scriptPath, ...filePaths]
  if (options?.deep) args.push('--deep')
  if (options?.deepWorkers && Number.isInteger(options.deepWorkers) && options.deepWorkers > 0 && options.deepWorkers <= 32) args.push(`--deep-workers=${options.deepWorkers}`)
  const proc = spawn(pythonCmd, args, { cwd: pythonDir, env: pythonSpawnEnv() })

  // Tap stderr for progress events before handing off to watchdogSpawn,
  // which will collect the rest. We read stderr bytes as they arrive so
  // progress notifications aren't delayed by the cap-check buffer.
  proc.stderr?.on('data', (d: Buffer) => {
    for (const line of d.toString().split('\n')) {
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

  const { stdout, stderr, code } = await watchdogSpawn(proc, 'analyze-batch')
  if (code !== 0) {
    return { ok: false, error: stderr.slice(-500) || `batch analyser exited ${code}` }
  }
  try {
    const parsed = JSON.parse(stdout.trim())
    return { ok: true, ...parsed }
  } catch {
    return { ok: false, error: `Failed to parse batch output: ${stdout.slice(0, 200)}` }
  }
})

// Handle drag-and-drop: receive filename, show dialog to confirm full path
// LOW: resolve-drop-path handler deleted — no renderer caller, no preload bridge.
// File drop-path resolution now uses webUtils.getPathForFile in preload.ts.

// Streaming SHA-256 helper — avoids loading an entire audio file into memory
// just to hash it. `readFileSync` on a 2 GB 32-bit-float WAV would fully
// block the main-process event loop; streaming reads in fixed-size chunks
// and is non-blocking.
function streamSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const crypto = require('crypto') as typeof import('crypto')
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk: Buffer | string) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

// File identity for deliverable-receipt PDFs — size, mtime, and a SHA-256
// fingerprint. Computed in the main process so the renderer doesn't have
// to shuttle the bytes twice. Uses streaming hash to avoid blocking on
// large files (2 GB+ WAVs at 32-bit float / 96 kHz are not uncommon).
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
    const sha256 = await streamSha256(safePath)
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

// 200 MB ceiling — covers ~20 minutes of 24-bit/96 kHz stereo WAV.
// Files larger than this would OOM the V8 heap (2 GB limit) in the renderer.
const MAX_AUDIO_READ_BYTES = 200 * 1024 * 1024

ipcMain.handle('read-audio-file', async (_event, filePath: string) => {
  const safePath = assertSafeAudioPath(filePath, 'read-audio-file')
  const ext = path.extname(safePath).toLowerCase()
  if (!AUDIO_EXT.has(ext)) {
    throw new Error(`read-audio-file: refused for non-audio extension (${ext})`)
  }
  const stat = await fs.promises.stat(safePath)
  if (stat.size > MAX_AUDIO_READ_BYTES) {
    throw new Error(
      `read-audio-file: file too large (${(stat.size / 1024 / 1024).toFixed(0)} MB). ` +
      `Maximum supported size is ${MAX_AUDIO_READ_BYTES / 1024 / 1024} MB. ` +
      `Please convert to a smaller file and retry.`
    )
  }
  const buffer = await fs.promises.readFile(safePath)
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
  if (typeof html !== 'string' || html.length > 10 * 1024 * 1024) {
    dialog.showMessageBox({ type: 'error', title: 'Report Too Large', message: 'The report HTML exceeds the 10 MB limit and cannot be saved as PDF.' }).catch(() => {})
    return null
  }
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
    const pdfBuf = await renderHtmlToPdf(hidden, html, {
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
  // CRIT-18: select the correct Python bundle for the running CPU arch.
  // Prior code always used python-bundle (arm64); on Intel Macs it would
  // attempt to exec the arm64 binary and fail with "bad CPU type".
  const macArmBundled = path.join(basePath, 'python-bundle', 'python', 'bin', 'python3')
  const macIntelBundled = path.join(basePath, 'python-bundle-intel', 'python', 'bin', 'python3')
  const macBundled = process.arch === 'arm64' ? macArmBundled : macIntelBundled
  const pythonCmd = isWin
    ? (fs.existsSync(winBundled) ? winBundled : 'python.exe')
    : (fs.existsSync(macBundled) ? macBundled : '/usr/bin/python3')

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
  const py = spawn(pythonCmd, ['-c', script], { cwd: pythonDir, env: pythonSpawnEnv() })
  const stdinPayload = JSON.stringify({
    src: srcPath,
    bands,
    outPath,
    truePeakLimit: truePeakLimit ?? false,
    ceilingDbtp: ceilingDbtp ?? -1.0,
    targetLufs: targetLufs ?? null,
  })
  const { stdout, stderr, code } = await watchdogSpawn(py, 'render-corrected-eq', stdinPayload)
  if (code !== 0) {
    throw new Error(stderr || `render-corrected-eq exited ${code}`)
  }
  return stdout.trim()
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
    assertSafeAudioPath(filePath, 'reveal-in-finder')
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

ipcMain.handle('analyze-files', async (event, fileA: string, fileB: string, fast: boolean = true, profile: string = '') => {
  assertSafeAudioPath(fileA, 'analyze-files (A)')
  assertSafeAudioPath(fileB, 'analyze-files (B)')
  const sendProgress = (msg: string) => {
    mainWindow?.webContents.send('analysis-progress', msg)
  }

  // Fast path — try the persistent daemon first. Cuts repeat-analysis
  // latency from ~30 s to ~17 s because Python + ONNX stay warm.
  // Falls back to the legacy subprocess path on any daemon error.
  try {
    const result = await daemonAnalyze(fileA, fileB, sendProgress, fast, profile)
    return result
  } catch (err: any) {
    if (!(err instanceof DaemonUnavailableError)) {
      // Daemon was reachable but the analysis itself failed — surface
      // the error rather than hiding it behind a slower retry.
      throw new Error(err.message || 'Analysis failed')
    }
    // Daemon unavailable (still starting, crashed, or exhausted retries)
    // — fall through to the legacy subprocess path transparently.
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
    let previewStdinPayload: string | null = null

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
      // Build the stdin payload here, while previewOut is in scope.
      previewStdinPayload = JSON.stringify({
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
    // interpolated into source). watchdogSpawn closes stdin after writing.
    watchdogSpawn(proc, previewHead ? 'declick-preview' : 'declick-process', previewStdinPayload)
      .then(({ stdout, stderr, code }) => {
        if (tmpSlicePath) { try { fs.unlinkSync(tmpSlicePath) } catch {} }
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
      .catch((err: Error) => {
        if (tmpSlicePath) { try { fs.unlinkSync(tmpSlicePath) } catch {} }
        reject(err)
      })
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

// ── RTMsend bridge — push EQ moves into the user's hosted plugin ───
//
// 1.1.0 RTMsend ships a localhost JSON-RPC server. When loaded in a
// DAW with a third-party plugin (FabFilter Pro-Q etc.) in its slot,
// it lets us push parameter values into that plugin without leaving
// RTMcompare. Profile system in rtmsend-profiles.ts handles the
// plugin-specific math (which param is "Band 3 Frequency", how does
// 0..1 map to Hz, etc.). Adding a new plugin is one entry in that
// file; no rebuild of RTMsend itself.

ipcMain.handle('rtmsend-status', async () => {
  if (!rtmsend.isRunning()) return { running: false }
  try {
    const loaded = await rtmsend.getLoadedPlugin()
    if (!loaded) return { running: true, loaded: null, supported_plugins: listSupportedPlugins() }
    const profile = await resolveProfile(loaded.name)
    // Fire-and-forget: capture full reference profile in the background
    // the first time we see this plugin in this session. Result lands
    // in ~/.rtm/plugin-knowledge/ and feeds the recommendation engine.
    maybeAutoCapture(loaded.name, loaded.parameter_count)
    return {
      running: true,
      loaded,
      profile: profile ? { name: profile.name, kind: profile.kind, auto: profile.name.endsWith('(auto)') } : null,
      supported_plugins: listSupportedPlugins(),
    }
  } catch (e: any) {
    return { running: false, error: e?.message ?? String(e) }
  }
})

/**
 * Resolve a Profile for the loaded plugin. Hand-coded profiles in the
 * registry win; if none matches, we fall through to autoDetectProfile
 * which probes the plugin's parameters live and synthesises a profile
 * (cached per session). This is what lets users hit Send to plugin on
 * an EQ we've never seen before and have it just work.
 */
async function resolveProfile (pluginName: string) {
  const handCoded = findProfile(pluginName)
  if (handCoded) return handCoded
  return await autoDetectProfile(pluginName)
}

ipcMain.handle('rtmsend-send-eq', async (_e, bands: RtmBand[]) => {
  if (!Array.isArray(bands) || bands.length === 0)
    throw new Error('rtmsend-send-eq: bands array is empty')

  const loaded = await rtmsend.getLoadedPlugin()
  if (!loaded) throw new Error('No plugin loaded in RTMsend. Pick a plugin first.')

  const profile = await resolveProfile(loaded.name)
  if (!profile)
    throw new Error(
      `Could not detect a profile for "${loaded.name}" automatically, and no hand-coded profile exists. ` +
      `Supported plugins: ${listSupportedPlugins().join(', ')}.`,
    )

  // Build the parameter writes from the RTM band list. For graphic
  // EQs the initial pass returns marker indices (negative numbers
  // standing for "plugin band slot N") that we resolve into real
  // VST3 indices below using a one-shot list_parameters round-trip.
  let updates = bandsToUpdates(profile, bands)
  if (profile.kind === 'graphic') {
    const params = await rtmsend.listParameters()
    const byName = new Map(params.map(p => [p.name, p.index] as const))
    updates = resolveGraphicIndices(profile, byName, updates)
  }

  if (updates.length === 0)
    throw new Error('Profile produced no parameter writes (check band ranges)')

  const result = await rtmsend.setParameters(updates)
  return {
    plugin: loaded.name,
    profile: profile.name,
    applied: result.applied.length,
    rejected: result.rejected.length,
    rejected_detail: result.rejected,
  }
})

// ── Plugin Knowledge Base ──────────────────────────────────────────────
// Long-term store of every EQ plugin RTMsend has seen, indexed by name.
// Two-tier: ACTIVE profiles (in rtmsend-profiles.ts registry) drive
// Send-to-plugin; REFERENCE profiles (this section, ~/.rtm/plugin-
// knowledge/*.json) drive tool-aware recommendations and the "best
// plugin for this move" feature. Reference entries are saved
// automatically the first time a plugin is loaded in RTMsend during
// a session.

/** List every plugin RTMcompare knows about (active + reference). Used
 *  by the recommendation engine to score against the user's tool set. */
ipcMain.handle('rtmsend-knowledge-list', async () => {
  return listAllReferences()
})

/** Trigger a fresh probe of the currently-loaded plugin and persist
 *  its full reference profile. Returns the saved entry. Skipped if
 *  an entry already exists with the same parameter count. */
ipcMain.handle('rtmsend-knowledge-capture', async () => {
  if (!rtmsend.isRunning()) throw new Error('RTMsend not running')
  const loaded = await rtmsend.getLoadedPlugin()
  if (!loaded) throw new Error('No plugin loaded in RTMsend')
  const entry = await captureReference(loaded.name, loaded.parameter_count, '1.1.1')
  if (!entry) throw new Error('Capture failed')
  return entry
})

/** Force a re-probe even if a cached entry exists. */
ipcMain.handle('rtmsend-knowledge-recapture', async () => {
  if (!rtmsend.isRunning()) throw new Error('RTMsend not running')
  const loaded = await rtmsend.getLoadedPlugin()
  if (!loaded) throw new Error('No plugin loaded in RTMsend')
  // Delete any existing cache entry first so captureReference re-probes.
  const existingPath = path.join(getKnowledgeDir(), '_cache_invalidate.flag')
  try { fs.writeFileSync(existingPath, '') } catch { /* non-fatal */ }
  // Note: captureReference's skip is "if existing && param count matches".
  // We invalidate by deleting the file directly.
  const fileName = loaded.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) + '.json'
  const filePath = path.join(getKnowledgeDir(), fileName)
  try { fs.unlinkSync(filePath) } catch { /* ok if not there */ }
  return await captureReference(loaded.name, loaded.parameter_count, '1.1.1')
})

/** Generate a markdown summary of every plugin we know about. Useful
 *  for shipping documentation. Writes to ~/.rtm/plugin-knowledge/README.md. */
ipcMain.handle('rtmsend-knowledge-readme', async () => {
  const entries = listAllReferences()
  const md = generateKnowledgeReadme(entries)
  const p = path.join(getKnowledgeDir(), 'README.md')
  fs.writeFileSync(p, md, 'utf8')
  return { path: p, plugins: entries.length }
})

/** Rank the user's available plugins for a single EQ move. */
// 5.7.x: filter the recommendation candidate set to plugins where
// Send-to-Plugin actually works (i.e., the plugin has an entry in the
// active PROFILES registry). Reference-only entries stay in the
// knowledge base — we keep their data for archetype heuristics, future
// profile backfill, and the "what plugins does this engineer have?"
// audit — but they no longer surface as recommendations. Resolves the
// "RTMcompare suggests AMEK 200 but Send-to-Plugin can't write to it"
// UX bug Mike flagged: the suggestion and the action now agree.
function activeProfileFilter (entries: ReturnType<typeof listAllReferences>) {
  const supported = new Set(listSupportedPlugins())
  return entries.filter(e => supported.has(e.name))
}

ipcMain.handle('rtmsend-best-plugin-for-move', async (_e, band: RtmBand) => {
  const all = activeProfileFilter(listAllReferences())
  const available = all.map(e => ({ name: e.name, archetype_tags: e.archetype_tags }))
  return rankPluginsForMove(band, available)
})

/** Rank plugins per band across a full RTMcompare recommendation set,
 *  AND return the single best overall plugin. */
ipcMain.handle('rtmsend-best-plugins-for-bands', async (_e, bands: RtmBand[]) => {
  const all = activeProfileFilter(listAllReferences())
  const available = all.map(e => ({ name: e.name, archetype_tags: e.archetype_tags }))
  return {
    per_band: rankPluginsForBands(bands, available),
    best_overall: bestOverallPlugin(bands, available),
  }
})

/**
 * Auto-capture: when the user picks a plugin in RTMsend, transparently
 * save its reference profile in the background. Triggered from the
 * status poll path. Fire-and-forget, don't block status responses on it.
 */
const autoCapturedThisSession = new Set<string>()
function maybeAutoCapture (pluginName: string, paramCount: number): void {
  if (autoCapturedThisSession.has(pluginName)) return
  autoCapturedThisSession.add(pluginName)
  captureReference(pluginName, paramCount, '1.1.1').catch(() => { /* non-fatal */ })
}

function generateKnowledgeReadme (entries: ReferenceProfile[]): string {
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name))
  const lines: string[] = []
  lines.push(`# RTMsend Plugin Knowledge Base`)
  lines.push('')
  lines.push(`Auto-generated reference of every EQ plugin RTMsend has profiled.`)
  lines.push(`${sorted.length} plugin(s) known. Last updated: ${new Date().toISOString()}`)
  lines.push('')
  lines.push(`## Plugins`)
  lines.push('')
  for (const e of sorted) {
    const tags = e.archetype_tags.join(', ') || '(none)'
    const profileKind = e.active_profile?.kind ?? '(no Send profile)'
    lines.push(`### ${e.name}`)
    lines.push('')
    lines.push(`- **Archetype tags:** ${tags}`)
    lines.push(`- **Send profile:** ${profileKind}`)
    lines.push(`- **Parameter count:** ${e.parameter_count}`)
    lines.push(`- **Scanned:** ${e.scanned_at}`)
    if (e.notes) {
      lines.push(`- **Notes:** ${e.notes}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

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
  // CRIT-18: select the correct Python bundle for the running CPU arch.
  // Prior code always used python-bundle (arm64); on Intel Macs it would
  // attempt to exec the arm64 binary and fail with "bad CPU type".
  const macArmBundled = path.join(basePath, 'python-bundle', 'python', 'bin', 'python3')
  const macIntelBundled = path.join(basePath, 'python-bundle-intel', 'python', 'bin', 'python3')
  const macBundled = process.arch === 'arm64' ? macArmBundled : macIntelBundled
  const pyBin = (process.platform === 'win32' && fs.existsSync(winBundled)) ? winBundled
    : (fs.existsSync(macBundled) ? macBundled : 'python3')
  const scriptPath = path.join(pythonDir, 'reference_quickscan.py')
  const { spawn } = require('child_process') as typeof import('child_process')
  const scan = await (async () => {
    try {
      const proc = spawn(pyBin, [scriptPath, srcPath], { cwd: pythonDir, env: pythonSpawnEnv() })
      const { stdout: out, stderr: err, code } = await watchdogSpawn(proc, 'references-add')
      if (code !== 0) return { error: `python exit ${code}: ${err.slice(-300)}` }
      try { return JSON.parse(out.trim().split('\n').pop() || '{}') }
      catch (e: any) { return { error: `parse failed: ${e?.message}` } }
    } catch (e: any) { return { error: e?.message || 'references-add timed out' } }
  })()

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
        const readyPath = path.join(INCOMING_DIR, safeName)
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
  // Newest first — pre-fetch all mtimes to avoid repeated statSync calls
  // inside the sort comparator (N·log(N) blocking I/O on the main thread).
  const mtimes = new Map<string, number>()
  for (const entry of out) {
    try { mtimes.set(entry.audioPath, fs.statSync(entry.audioPath).mtimeMs) } catch { mtimes.set(entry.audioPath, 0) }
  }
  out.sort((a, b) => (mtimes.get(b.audioPath) ?? 0) - (mtimes.get(a.audioPath) ?? 0))
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
  cancelActiveAnalysis()
  try { incomingWatcher?.close() } catch {}
  incomingWatcher = null
  // Gracefully shut down the persistent Python daemon so it doesn't
  // linger as an orphan process after the app exits.
  shutdownDaemon().catch(() => { /* fire-and-forget; process exits anyway */ })
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
    // CRIT-18: select the correct Python bundle for the running CPU arch.
  // Prior code always used python-bundle (arm64); on Intel Macs it would
  // attempt to exec the arm64 binary and fail with "bad CPU type".
  const macArmBundled = path.join(basePath, 'python-bundle', 'python', 'bin', 'python3')
  const macIntelBundled = path.join(basePath, 'python-bundle-intel', 'python', 'bin', 'python3')
  const macBundled = process.arch === 'arm64' ? macArmBundled : macIntelBundled
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
    try {
      const proc = spawn(pyBin, [scriptPath, srcPath, resolvedOut!, cfgPath], { cwd: pythonDir, env: pythonSpawnEnv() })
      const { stdout: out, stderr: err, code } = await watchdogSpawn(proc, 'master-chain-render')
      try { fs.unlinkSync(cfgPath) } catch {}
      if (code !== 0) return { ok: false, error: `python exit ${code}: ${err.slice(-400)}` }
      try { return JSON.parse(out.trim().split('\n').pop() || '{}') }
      catch (e: any) { return { ok: false, error: `parse failed: ${e?.message}; raw=${out.slice(-300)}` } }
    } catch (e: any) {
      try { fs.unlinkSync(cfgPath) } catch {}
      return { ok: false, error: e?.message || 'master-chain-render timed out' }
    }
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
// CRIT-20: allowlist for dsp argv — IDs must match _DSP_TARGETS in encoded_preview.py exactly.
// Previous list used wrong IDs (apple_music, amazon_hd, etc.) — Python accepts the short forms.
const VALID_DSP_IDS = new Set(['apple','spotify','spotifyLoud','amazon','tidal','youtube'])
ipcMain.handle('encoded-preview-render', async (_event, srcPath: string, dsp: string, integratedLufs: number | null, windowStartSec?: number | null) => {
  try { assertSafeAudioPath(srcPath, 'encoded-preview-render') }
  catch (err: any) { return { ok: false, error: err?.message || 'invalid source path' } }
  if (typeof dsp !== 'string' || !VALID_DSP_IDS.has(dsp)) {
    return { ok: false, error: `invalid dsp value: ${String(dsp).slice(0, 40)}` }
  }
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
    // CRIT-18: select the correct Python bundle for the running CPU arch.
  // Prior code always used python-bundle (arm64); on Intel Macs it would
  // attempt to exec the arm64 binary and fail with "bad CPU type".
  const macArmBundled = path.join(basePath, 'python-bundle', 'python', 'bin', 'python3')
  const macIntelBundled = path.join(basePath, 'python-bundle-intel', 'python', 'bin', 'python3')
  const macBundled = process.arch === 'arm64' ? macArmBundled : macIntelBundled
    const pyBin = (process.platform === 'win32' && fs.existsSync(winBundled)) ? winBundled
      : (fs.existsSync(macBundled) ? macBundled : 'python3')
    const scriptPath = path.join(pythonDir, 'encoded_preview.py')
    const args = [scriptPath, srcPath, outPath, dsp]
    // Python CLI expects positional args: [src, out, dsp, lufs,
    // start_sec].  Supply '' placeholders so we can pass start_sec.
    args.push(integratedLufs != null ? String(integratedLufs) : '')
    if (windowStartSec != null) args.push(String(windowStartSec))
    const { spawn } = require('child_process') as typeof import('child_process')
    try {
      const proc = spawn(pyBin, args, { cwd: pythonDir, env: pythonSpawnEnv() })
      const { stdout: out, stderr: err, code } = await watchdogSpawn(proc, 'encoded-preview-render')
      if (code !== 0) return { ok: false, error: `python exit ${code}: ${err.slice(-400)}` }
      try { return JSON.parse(out.trim().split('\n').pop() || '{}') }
      catch (e: any) { return { ok: false, error: `parse failed: ${e?.message}; raw=${out.slice(-400)}` } }
    } catch (e: any) {
      return { ok: false, error: e?.message || 'encoded-preview timed out' }
    }
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
// MED-10: allowlist for envId argv — must match playback_env.py ENVS keys.
const VALID_ENV_IDS = new Set(['phone_speaker','earbuds','club_pa','car_cabin'])
ipcMain.handle('translation-render', async (_event, srcPath: string, envId: string, windowStartSec?: number | null) => {
  try { assertSafeAudioPath(srcPath, 'translation-render') }
  catch (err: any) { return { ok: false, error: err?.message || 'invalid source path' } }
  if (typeof envId !== 'string' || !VALID_ENV_IDS.has(envId)) {
    return { ok: false, error: `invalid envId: ${String(envId).slice(0, 40)}` }
  }
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
    // CRIT-18: select the correct Python bundle for the running CPU arch.
  // Prior code always used python-bundle (arm64); on Intel Macs it would
  // attempt to exec the arm64 binary and fail with "bad CPU type".
  const macArmBundled = path.join(basePath, 'python-bundle', 'python', 'bin', 'python3')
  const macIntelBundled = path.join(basePath, 'python-bundle-intel', 'python', 'bin', 'python3')
  const macBundled = process.arch === 'arm64' ? macArmBundled : macIntelBundled
    const pyBin = (process.platform === 'win32' && fs.existsSync(winBundled)) ? winBundled
      : (fs.existsSync(macBundled) ? macBundled : 'python3')
    const scriptPath = path.join(pythonDir, 'translation_render.py')
    const args = [scriptPath, srcPath, outPath, envId]
    if (windowStartSec != null) args.push(String(windowStartSec))
    const { spawn } = require('child_process') as typeof import('child_process')
    try {
      const proc = spawn(pyBin, args, { cwd: pythonDir, env: pythonSpawnEnv() })
      const { stdout: out, stderr: err, code } = await watchdogSpawn(proc, 'translation-render')
      if (code !== 0) return { ok: false, error: `python exit ${code}: ${err.slice(-400)}` }
      try { return JSON.parse(out.trim().split('\n').pop() || '{}') }
      catch (e: any) { return { ok: false, error: `parse failed: ${e?.message}; raw=${out.slice(-400)}` } }
    } catch (e: any) {
      return { ok: false, error: e?.message || 'translation-render timed out' }
    }
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
  if (typeof html !== 'string' || html.length > 10 * 1024 * 1024) {
    return { error: 'html payload exceeds 10 MB limit' }
  }
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
    const pdfBuf = await renderHtmlToPdf(hidden, html, {
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

/** Build a .rtm-report.json grade record from a StudentReportPayload. */
function buildGradeRecord(payload: any, pdfPath: string): Record<string, unknown> {
  const result    = payload?.analysisResult ?? {}
  const overall   = result?.overall ?? {}
  const assignment = payload?.assignment ?? {}
  const rubric: any[] = assignment?.rubric ?? []

  function getActual(metric: string): number | null {
    if (metric === 'lufs_i')
      return overall.lufs_b ?? overall.lufs_a ?? null
    if (metric === 'lra')
      return overall.dynamics_b ?? overall.lra_b ?? overall.lra ?? null
    if (metric === 'true_peak_dbtp')
      return overall.headroom_b ?? overall.headroom ?? overall.true_peak_b ?? null
    if (metric === 'mono_compat_pct' || metric === 'mono_compat')
      return result?.mono_compat?.mono_loss_b_pct ?? result?.mono_compat?.mono_loss_pct ?? null
    if (metric === 'stereo_width')
      return overall.width_b ?? overall.width ?? null
    if (metric === 'plr') {
      const l = overall.lufs_b ?? overall.lufs_a
      const t = overall.headroom_b ?? overall.headroom
      return (l != null && t != null) ? (t - l) : null
    }
    if (metric === 'tonal_deviation')
      return result?.tonal?.deviation_b ?? result?.tonal?.deviation ?? null
    if (metric === 'distortion')
      return result?.distortion?.severity_b ?? result?.distortion?.severity ?? null
    if (metric === 'masking_overlap')
      return result?.masking?.overlap_pct ?? result?.masking?.masking_pct ?? null
    if (metric === 'click_count') {
      const clicks = result?.clicks ?? {}
      const c = clicks.count_b ?? clicks.count
      if (c != null) return c
      const ev = clicks.click_events ?? clicks.events ?? []
      return Array.isArray(ev) ? ev.length : null
    }
    const ar = result
    if (metric === 'center_fill_ms') {
      // M/S ratio: mid energy / side energy
      // Try analysisResult.ms_ratio_b or analysisResult.center_fill_ms_b or analysisResult.ms_ratio
      const msB = ar?.ms_ratio_b ?? ar?.center_fill_ms_b ?? ar?.ms_ratio ?? null
      return typeof msB === 'number' ? msB : null
    }
    if (metric === 'noise_floor') {
      // Noise floor in dBFS — lower (more negative) is better
      // Try analysisResult.noise_floor_b or analysisResult.noise_floor
      const nfB = ar?.noise_floor_b ?? ar?.noise_floor ?? null
      return typeof nfB === 'number' ? nfB : null
    }
    if (metric === 'transient_integrity') {
      // LRA (loudness range) is the established proxy for transient/dynamic preservation.
      // Higher LRA = more transient headroom retained through the mastering chain.
      // Same field as the 'lra' metric but exposed under a pedagogically clear name.
      return overall.dynamics_b ?? overall.dynamics_a ?? null
    }
    if (metric === 'dither_applied') {
      // Boolean self-report from student reflection step (payload.ditherApplied).
      // Converts to 1.0 (applied) or 0.0 (not applied) so rubric scoreRow() can
      // compare against a teacher-set target of 1 with tolerance 0.1.
      const d = payload?.ditherApplied
      if (d === true)  return 1.0
      if (d === false) return 0.0
      return null
    }
    return null
  }

  function scoreRow(actual: number | null, target: number, tol: number, pts: number): number | null {
    if (actual == null) return null
    const d = Math.abs(actual - target)
    if (d <= tol) return pts
    if (d <= 2 * tol) return pts * 0.5
    return 0
  }

  let totalEarned = 0
  let totalPossible = 0
  const rows = rubric.map((crit: any) => {
    const pts    = typeof crit.points === 'number' ? crit.points : (crit.weight ?? 0) * 100
    const actual = getActual(crit.metric)
    const earned = scoreRow(actual, crit.target, crit.tolerance, pts)
    const delta  = actual != null ? Math.round((actual - crit.target) * 10) / 10 : null
    totalPossible += pts
    if (earned != null) totalEarned += earned
    return {
      metric: crit.metric ?? '',
      label:  crit.label ?? '',
      target: crit.target,
      tolerance: crit.tolerance,
      actual,
      delta,
      earned: earned != null ? Math.round(earned * 10) / 10 : null,
      possible: Math.round(pts * 10) / 10,
    }
  })

  return {
    version:           1,
    studentName:       assignment.studentName ?? '',
    studentId:         assignment.studentId  ?? '',
    assignmentTitle:   assignment.title      ?? '',
    course:            assignment.course     ?? '',
    instructor:        assignment.instructor ?? '',
    genre:             assignment.genre      ?? '',
    dueDate:           assignment.dueDate    ?? '',
    exportedAt:        payload.exportedAt    ?? new Date().toISOString(),
    fileBName:         payload.fileBName     ?? '',
    pdfPath,
    rubric: rows,
    totalEarned:       Math.round(totalEarned * 10) / 10,
    totalPossible:     Math.round(totalPossible * 10) / 10,
    pct:               totalPossible > 0 ? Math.round(totalEarned / totalPossible * 1000) / 10 : null,
    submissionVersion: 1,
    isDraft:           false,
  }
}

// ── Student Report PDF — Learn Mode ──────────────────────────────────────────
// Spawns python/student_report.py with the payload JSON via stdin.
// The script outputs a complete HTML document to stdout, which we render
// to PDF using the same hidden-BrowserWindow printToPDF pattern as
// render-pdf-direct. The PDF is saved to
//   ~/Documents/RTMcompare/student-reports/<studentName>_<title>_<date>.pdf
// Always returns { ok, path? } or { ok: false, error: string }.
ipcMain.handle('generate-student-report', async (_event, payload: any) => {
  try {
    const basePath = app.isPackaged ? (process as any).resourcesPath : path.join(__dirname, '..')
    const pythonDir = path.join(basePath, 'python')
    const isWin = process.platform === 'win32'
    const winBundled = path.join(basePath, 'python-bundle-win', 'python', 'python.exe')
    // CRIT-18: select the correct Python bundle for the running CPU arch.
  // Prior code always used python-bundle (arm64); on Intel Macs it would
  // attempt to exec the arm64 binary and fail with "bad CPU type".
  const macArmBundled = path.join(basePath, 'python-bundle', 'python', 'bin', 'python3')
  const macIntelBundled = path.join(basePath, 'python-bundle-intel', 'python', 'bin', 'python3')
  const macBundled = process.arch === 'arm64' ? macArmBundled : macIntelBundled
    const pyBin = (isWin && fs.existsSync(winBundled)) ? winBundled
      : (fs.existsSync(macBundled) ? macBundled : (isWin ? 'python.exe' : '/usr/bin/python3'))
    const scriptPath = path.join(pythonDir, 'student_report.py')

    const { spawn } = require('child_process') as typeof import('child_process')
    const proc = spawn(pyBin, [scriptPath], { cwd: pythonDir, env: pythonSpawnEnv() })

    let html = ''
    let stderr = ''
    try {
      const res = await watchdogSpawn(proc, 'generate-student-report', JSON.stringify(payload))
      html = res.stdout
      stderr = res.stderr
      if (res.code !== 0) {
        return { ok: false, error: `python exit ${res.code}: ${stderr.slice(-400)}` }
      }
    } catch (e: any) {
      return { ok: false, error: e?.message || 'student_report.py timed out' }
    }

    if (!html.trim()) {
      return { ok: false, error: `student_report.py produced no output. stderr: ${stderr.slice(-300)}` }
    }

    const os = require('os') as typeof import('os')
    const docsDir = path.join(os.homedir(), 'Documents', 'RTMcompare', 'student-reports')
    try { fs.mkdirSync(docsDir, { recursive: true }) } catch { /* ok */ }

    const assignment = payload?.assignment ?? {}
    const studentName  = (typeof assignment?.studentName === 'string' ? assignment.studentName : 'Student').replace(/[^A-Za-z0-9_\- ]/g, '_').slice(0, 40)
    const assignTitle  = (typeof assignment?.title === 'string' ? assignment.title : 'Report').replace(/[^A-Za-z0-9_\- ]/g, '_').slice(0, 40)
    const datePart     = new Date().toISOString().slice(0, 10)
    const fileName     = `${studentName}_${assignTitle}_${datePart}.pdf`.replace(/\s+/g, '_')
    const finalPath    = path.join(docsDir, fileName)

    const hidden = new BrowserWindow({
      show: false, width: 820, height: 1160,
      webPreferences: { offscreen: false, sandbox: true, contextIsolation: true },
    })
    try {
      const pdfBuf = await renderHtmlToPdf(hidden, html, {
        printBackground: true, pageSize: 'A4',
        margins: { top: 0, bottom: 0, left: 0, right: 0 }, preferCSSPageSize: true,
      })
      fs.writeFileSync(finalPath, pdfBuf)
      // ── Write .rtm-report.json sidecar for grade book ──
      try {
        const sidecarPath = finalPath.replace(/\.pdf$/i, '.rtm-report.json')
        const sidecar = buildGradeRecord(payload, finalPath)
        // Include blind test predictions and ear training progress if present.
        //
        // LOW integrity note: earTraining is client-supplied — a student who
        // edits their localStorage `rtm-eartraining-progress-*` JSON could
        // claim 100% accuracy. There's no server-side recomputation in a
        // desktop-only product. Teachers using this metric for graded
        // contexts should treat it as self-reported / honor-system data,
        // same as a written reflection. Blind-test predictions have the
        // same property — they're useful as formative feedback but should
        // not be the sole basis for a summative grade.
        const blindTest = payload?.blindTest ?? null
        const earTraining = (payload as any)?.earTraining ?? null
        const fullSidecar: Record<string, unknown> = { ...sidecar as Record<string, unknown> }
        if (blindTest) fullSidecar.blindTest = blindTest
        if (earTraining) fullSidecar.earTraining = earTraining
        fs.writeFileSync(sidecarPath, JSON.stringify(fullSidecar, null, 2), 'utf8')
      } catch { /* sidecar write is best-effort, never fail the PDF */ }
      return { ok: true, path: finalPath }
    } catch (err: any) {
      return { ok: false, error: err?.message || 'PDF render failed' }
    } finally {
      hidden.close()
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'generate-student-report dispatch failed' }
  }
})

// ── Learn Mode — scan a folder for .rtm-report.json grade files ──────────
// CRIT-1 hardening: previously used `path.resolve` only, so a symlinked entry
// inside the folder (e.g. linking to ~/.ssh) was followed and contents slurped
// into the renderer payload. Now:
//   1. assertSafeDir resolves the folder via realpathSync (symlink-safe)
//   2. each entry is lstatSync'd — symlinks are skipped
//   3. file size cap of 10 MB per .rtm-report.json (poisoned 100 MB junk
//      can no longer OOM the main process)
//   4. async fs.promises throughout — no longer blocks main thread when
//      scanning N=100+ student submissions (MED-10)
const MAX_REPORT_JSON_BYTES = 10 * 1024 * 1024  // 10 MB hard cap per file
ipcMain.handle('scan-class-folder', async (_e, folderPath: string) => {
  try {
    let resolved: string
    try {
      resolved = assertSafeDir(folderPath, 'scan-class-folder')
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'Folder not found or is not a directory.' }
    }

    const files = await fs.promises.readdir(resolved)
    const jsonFiles = files.filter(f => f.endsWith('.rtm-report.json'))

    const records = (await Promise.all(jsonFiles.map(async (f) => {
      const teacherFilePath = path.join(resolved, f)
      try {
        // lstat — do NOT follow symlinks. Skip anything that isn't a regular file.
        const lst = await fs.promises.lstat(teacherFilePath)
        if (!lst.isFile()) return null
        if (lst.size > MAX_REPORT_JSON_BYTES) return null  // refuse oversize files
        const raw = await fs.promises.readFile(teacherFilePath, 'utf8')
        const record = JSON.parse(raw)
        // BUG-09 fix: stamp the teacher's actual file path so ClassGradeBook can
        // key feedback to THIS machine's path, not the student's machine path.
        record._reportFilePath = teacherFilePath
        // Load sibling .rtm-feedback.json if present — same symlink + size guards.
        const feedbackPath = teacherFilePath.replace(/\.rtm-report\.json$/i, '.rtm-feedback.json')
        try {
          const fblst = await fs.promises.lstat(feedbackPath)
          if (fblst.isFile() && fblst.size <= MAX_REPORT_JSON_BYTES) {
            const fb = JSON.parse(await fs.promises.readFile(feedbackPath, 'utf8'))
            record.feedback = fb.feedback ?? ''
          }
        } catch { /* sidecar missing — fine */ }
        return record
      } catch { return null }
    }))).filter(Boolean)

    return { ok: true, records, count: records.length }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'scan-class-folder failed' }
  }
})

// ── Learn Mode — export grade book records as CSV ────────────────────────
// Dynamic per-criterion columns: derived from rubric[] array in each record.
// New metrics (center_fill_ms, noise_floor, etc.) appear automatically when
// teachers include them in their assignment rubric — no CSV code changes needed.
ipcMain.handle('export-gradebook-csv', async (_e, records: any[]) => {
  if (!Array.isArray(records) || records.length === 0) {
    return { ok: false, error: 'No records to export.' }
  }

  // Build unified set of criterion labels from all records
  const labelSet: string[] = []
  records.forEach((rec: any) => {
    (rec.rubric ?? []).forEach((row: any) => {
      if (row.label && !labelSet.includes(row.label)) labelSet.push(row.label)
    })
  })

  // CSV header — Canvas-compatible column order:
  // Student Name, Student ID, Assignment, Genre, Due Date, Submitted,
  // Score %, [Criterion Earned / Possible...], Teacher Feedback
  const criterionCols = labelSet.flatMap(l => [`${l} Earned`, `${l} Possible`])
  const allCols = [
    'Student Name', 'Student ID', 'Assignment', 'Genre', 'Due Date', 'Submitted',
    'Score %',
    ...criterionCols,
    'Teacher Feedback',
  ]

  function csvCell(v: unknown): string {
    if (v == null) return ''
    const s = String(v)
    // MED-13: also quote \r-only line endings (Excel/Numbers treat \r as row break)
    return s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')
      ? `"${s.replace(/"/g, '""')}"` : s
  }

  const rows = records.map((rec: any) => {
    const submitted = rec.exportedAt ? new Date(rec.exportedAt).toLocaleDateString() : ''
    const dueDate = rec.dueDate ?? ''
    const scoreCell = rec.pct != null ? `${rec.pct}%` : ''
    const criterionValues = labelSet.flatMap(label => {
      const row = (rec.rubric ?? []).find((r: any) => r.label === label)
      return row ? [row.earned ?? '', row.possible ?? ''] : ['', '']
    })
    return [
      rec.studentName ?? '',
      rec.studentId ?? '',
      rec.assignmentTitle ?? '',
      rec.genre ?? '',
      dueDate,
      submitted,
      scoreCell,
      ...criterionValues,
      rec.feedback ?? '',
    ]
  })

  const csvLines = [allCols.map(csvCell).join(','), ...rows.map(r => r.map(csvCell).join(','))]
  const csvContent = csvLines.join('\n')

  const { dialog } = require('electron')
  const savePath = await dialog.showSaveDialog({
    title: 'Export Grade Book',
    defaultPath: path.join(require('os').homedir(), 'Documents', 'RTMcompare', `gradebook_${new Date().toISOString().slice(0,10)}.csv`),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  if (savePath.canceled || !savePath.filePath) return { ok: false, error: 'Cancelled' }
  try {
    fs.writeFileSync(savePath.filePath, csvContent, 'utf8')
    return { ok: true, path: savePath.filePath }
  } catch (e: any) {
    return { ok: false, error: e?.message }
  }
})

// ── Learn Mode — teacher feedback persistence ─────────────────────────────
// Each student report gets a sibling .rtm-feedback.json file so teachers
// can save notes that survive app restarts and survive re-exports.

ipcMain.handle('save-student-feedback', async (_e, reportPath: string, feedback: string) => {
  try {
    // MED-16 hardening: previously accepted ANY path ending .pdf or .rtm-report.json
    // and overwrote the .rtm-feedback.json neighbor. Now:
    //  1. Resolve via realpathSync (rejects symlinks at the leaf)
    //  2. Resolved file must exist + be a regular file (no symlinks, no dirs)
    //  3. Suffix check (must be a real RTMcompare report file)
    //  4. Feedback string size cap to prevent overwriting massive sibling files
    if (typeof reportPath !== 'string' || reportPath.length === 0 || reportPath.length > 4096) {
      return { ok: false, error: 'reportPath invalid.' }
    }
    let resolved = path.resolve(reportPath)
    if (!fs.existsSync(resolved)) {
      return { ok: false, error: 'reportPath does not exist.' }
    }
    // realpathSync — refuses to write through a symlink chain
    try { resolved = fs.realpathSync(resolved) } catch {
      return { ok: false, error: 'reportPath could not be resolved.' }
    }
    const lst = fs.lstatSync(resolved)
    if (!lst.isFile()) {
      return { ok: false, error: 'reportPath must be a regular file (not a symlink or directory).' }
    }
    if (!/\.(rtm-report\.json|pdf)$/i.test(resolved)) {
      return { ok: false, error: 'reportPath must end in .rtm-report.json or .pdf' }
    }
    if (typeof feedback !== 'string' || feedback.length > 64 * 1024) {
      return { ok: false, error: 'Feedback text is too long (max 64 KB).' }
    }
    const feedbackPath = resolved.replace(/\.rtm-report\.json$/i, '.rtm-feedback.json')
      .replace(/\.pdf$/i, '.rtm-feedback.json')
    // CRIT-9 fix: verify the sibling feedback file is safe before writing.
    // (a) must be in the exact same directory as the report — prevents path-
    //     traversal where the report path somehow resolves outside submissions.
    // (b) if feedback file already exists, refuse if it's a symlink — an
    //     attacker could pre-plant a symlink to redirect the write.
    if (path.dirname(feedbackPath) !== path.dirname(resolved)) {
      return { ok: false, error: 'Feedback path is outside the report directory.' }
    }
    if (fs.existsSync(feedbackPath)) {
      const fbLst = fs.lstatSync(feedbackPath)
      if (fbLst.isSymbolicLink()) {
        return { ok: false, error: 'Feedback path is a symlink — refusing to write.' }
      }
    }
    atomicWriteFileSync(feedbackPath, JSON.stringify({ feedback, savedAt: new Date().toISOString() }, null, 2))
    return { ok: true, path: feedbackPath }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'save-student-feedback failed' }
  }
})

// LOW-22: load-student-feedback handler removed — no renderer caller exists
// (grep src/ + preload confirms zero call sites). Removing it shrinks the
// IPC attack surface. Re-add if/when ClassGradeBook needs to pre-populate
// the feedback textarea on load from disk.

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
  try {
    return await streamSha256(filePath)
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

// ── Canvas LMS Integration ──────────────────────────────────────────

// CRIT-9 defense-in-depth: validate baseUrl against an allowlist of known
// Canvas-LMS host suffixes before storing it or sending the bearer token.
// A compromised renderer that could rewrite baseUrl would otherwise leak the
// teacher's Canvas API token to an attacker-controlled host (SSRF + creds-leak).
//
// Accepted: HTTPS only, host ends with one of: instructure.com, canvaslms.com,
// or a localhost test domain (for QA only).
const CANVAS_HOST_ALLOWLIST = [
  '.instructure.com',
  '.canvaslms.com',
]
function assertCanvasBaseUrl(baseUrl: unknown): string {
  if (typeof baseUrl !== 'string' || baseUrl.length === 0 || baseUrl.length > 2048) {
    throw new Error('Canvas baseUrl is required.')
  }
  let url: URL
  try { url = new URL(baseUrl) } catch {
    throw new Error('Canvas baseUrl is not a valid URL.')
  }
  if (url.protocol !== 'https:') {
    throw new Error('Canvas baseUrl must use HTTPS.')
  }
  const host = url.hostname.toLowerCase()
  const ok = CANVAS_HOST_ALLOWLIST.some(suffix =>
    suffix.startsWith('.') ? host.endsWith(suffix) : host === suffix
  )
  if (!ok) {
    throw new Error(
      `Canvas baseUrl host "${host}" is not on the allowlist. ` +
      'Expected a *.instructure.com or *.canvaslms.com URL.'
    )
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '')}`
}

ipcMain.handle('save-lms-config', async (_e, config: {
  baseUrl: string
  apiToken: string
  courseId: string
  assignmentName?: string
}) => {
  try {
    // CRIT-9: validate baseUrl BEFORE storing it.
    const safeBaseUrl = assertCanvasBaseUrl(config.baseUrl)
    // MED-14 fix: previously fell back to base64 (plaintext) when safeStorage
    // was unavailable. That silently stored the Canvas API token in plaintext
    // on disk — bad on Linux without libsecret, on a broken Mac keychain, or
    // on a kiosk. Now we refuse to save and surface a clear error so the user
    // knows to fix their keychain instead of getting silently insecure.
    if (!safeStorage.isEncryptionAvailable()) {
      return {
        ok: false,
        error:
          'Cannot save Canvas token: OS keychain encryption is unavailable. ' +
          'On macOS, check that Keychain Access is unlocked. On Linux, install ' +
          'libsecret (gnome-keyring or kwallet). Refusing to store the token ' +
          'in plaintext on disk.',
      }
    }
    const encrypted = safeStorage.encryptString(config.apiToken).toString('base64')
    const toSave = {
      baseUrl: safeBaseUrl,
      courseId: config.courseId,
      assignmentName: config.assignmentName ?? '',
      encryptedToken: encrypted,
      usedSafeStorage: true,
      savedAt: new Date().toISOString(),
    }
    // CRIT-8 fix: atomic write via temp-file + rename
    atomicWriteFileSync(lmsConfigPath(), JSON.stringify(toSave, null, 2))
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message }
  }
})

ipcMain.handle('load-lms-config', async () => {
  try {
    if (!fs.existsSync(lmsConfigPath())) return { ok: true, config: null }
    const raw = JSON.parse(fs.readFileSync(lmsConfigPath(), 'utf8'))
    return {
      ok: true,
      config: {
        baseUrl: raw.baseUrl ?? '',
        courseId: raw.courseId ?? '',
        assignmentName: raw.assignmentName ?? '',
        hasToken: !!raw.encryptedToken,
      }
    }
  } catch {
    return { ok: true, config: null }
  }
})

// Electron 36+ throws on decrypt failure (was: returned ""). Centralise the
// try/catch so all three Canvas IPC handlers surface a clear actionable error
// instead of a generic stack trace.
function decryptCanvasToken(raw: any): { ok: true; token: string; legacy?: boolean } | { ok: false; error: string } {
  if (!raw.usedSafeStorage) {
    // Legacy path: token was stored as base64 plaintext when safeStorage was
    // unavailable on the machine that saved the config (Linux without libsecret,
    // broken macOS keychain, or saved before SEC-5 landed).
    // Transparently return the token so the user is NOT locked out, then callers
    // should invoke migrateCanvasTokenIfNeeded() to re-encrypt and save.
    if (!raw.encryptedToken) {
      return { ok: false, error: 'No Canvas token saved. Please enter your API token in LMS settings.' }
    }
    try {
      const token = Buffer.from(raw.encryptedToken, 'base64').toString('utf8').trim()
      if (!token) return { ok: false, error: 'Canvas token is empty. Please re-enter your API token in LMS settings.' }
      return { ok: true, token, legacy: true }
    } catch {
      return { ok: false, error: 'Canvas credentials are unreadable. Please re-enter your API token in LMS settings.' }
    }
  }
  try {
    const token = safeStorage.decryptString(Buffer.from(raw.encryptedToken, 'base64'))
    return { ok: true, token }
  } catch (e: any) {
    return { ok: false, error: 'Keychain decrypt failed — re-enter your Canvas API token in LMS settings' }
  }
}

// Re-encrypt a legacy plaintext Canvas token with safeStorage and save it.
// Called after a successful API operation on a legacy config so existing users
// are silently migrated on their first successful Canvas use after the update.
function migrateCanvasTokenIfNeeded(dec: { ok: true; token: string; legacy?: boolean }, raw: any): void {
  if (!dec.legacy) return
  if (!safeStorage.isEncryptionAvailable()) return
  try {
    const encrypted = safeStorage.encryptString(dec.token).toString('base64')
    const migrated = { ...raw, encryptedToken: encrypted, usedSafeStorage: true }
    atomicWriteFileSync(lmsConfigPath(), JSON.stringify(migrated, null, 2))
  } catch { /* best-effort; user can re-enter manually if this fails */ }
}

ipcMain.handle('canvas-test-connection', async (_e) => {
  try {
    if (!fs.existsSync(lmsConfigPath())) return { ok: false, error: 'No LMS config saved' }
    const raw = JSON.parse(fs.readFileSync(lmsConfigPath(), 'utf8'))
    const dec = decryptCanvasToken(raw)
    if (!dec.ok) return dec
    const token = dec.token

    if (!CANVAS_ID_RE.test(String(raw.courseId ?? ''))) {
      return { ok: false, error: 'Invalid Course ID format — must be numeric or sis_course_id:XXX.' }
    }
    const res = await canvasRequest({
      baseUrl: raw.baseUrl,
      path: `/api/v1/courses/${raw.courseId}`,
      method: 'GET',
      token,
    })
    if (!res.ok) {
      const msg = typeof res.body === 'object' && res.body !== null && 'errors' in (res.body as any)
        ? JSON.stringify((res.body as any).errors)
        : `HTTP ${res.status}`
      return { ok: false, error: msg }
    }
    const course = res.body as any
    migrateCanvasTokenIfNeeded(dec, raw)
    return { ok: true, courseName: course.name ?? course.course_code ?? raw.courseId }
  } catch (e: any) {
    return { ok: false, error: e?.message }
  }
})

ipcMain.handle('canvas-get-assignments', async () => {
  try {
    if (!fs.existsSync(lmsConfigPath())) return { ok: false, error: 'No LMS config saved' }
    const raw = JSON.parse(fs.readFileSync(lmsConfigPath(), 'utf8'))
    const dec = decryptCanvasToken(raw)
    if (!dec.ok) return dec
    const token = dec.token

    if (!CANVAS_ID_RE.test(String(raw.courseId ?? ''))) {
      return { ok: false, error: 'Invalid Course ID format — must be numeric or sis_course_id:XXX.' }
    }
    const res = await canvasRequest({
      baseUrl: raw.baseUrl,
      path: `/api/v1/courses/${raw.courseId}/assignments?per_page=50&order_by=due_at`,
      method: 'GET',
      token,
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    // Canvas may return an object (errors, rate-limit, etc.) instead of an array
    // when something is misconfigured. Guard before .map() to prevent TypeError.
    if (!Array.isArray(res.body)) {
      return { ok: false, error: `Canvas returned unexpected response: ${JSON.stringify(res.body).slice(0, 200)}` }
    }
    const assignments = (res.body as any[]).map((a: any) => ({ id: String(a.id), name: a.name, pointsPossible: a.points_possible }))
    migrateCanvasTokenIfNeeded(dec, raw)
    return { ok: true, assignments }
  } catch (e: any) {
    return { ok: false, error: e?.message }
  }
})

// NIT: hoist regex to module level — avoids recompilation on every upload
const STUDENT_ID_RE = /^[A-Za-z0-9_.@-]{1,64}$/
// SEC-1: Canvas numeric IDs (course, assignment) — only digits or sis_course_id:XXX style
const CANVAS_ID_RE = /^(\d{1,20}|sis_course_id:[A-Za-z0-9_.@-]{1,64}|sis_section_id:[A-Za-z0-9_.@-]{1,64})$/

ipcMain.handle('canvas-upload-grades', async (_e, payload: {
  assignmentId: string
  grades: Array<{ studentId: string; studentName: string; score: number; totalPossible: number }>
}) => {
  try {
    if (!fs.existsSync(lmsConfigPath())) return { ok: false, error: 'No LMS config saved' }
    const raw = JSON.parse(fs.readFileSync(lmsConfigPath(), 'utf8'))
    const dec = decryptCanvasToken(raw)
    if (!dec.ok) return dec
    migrateCanvasTokenIfNeeded(dec, raw)
    const token = dec.token

    // Build grade_data for Canvas bulk update API.
    // BUG-10 fix: send raw score points, not a percentage. Canvas scales the
    // value against the assignment's own points_possible, so sending "85" on
    // a 50-pt assignment would enter 85/50 = 170%. Send the raw earned points
    // and ensure the Canvas assignment's point value matches the rubric total.
    // Canvas expects: { grade_data: { "sis_user_id:XXXXX": { posted_grade: "85.5" } } }
    //
    // MED-15 hardening: studentId originates from localStorage and is interpolated
    // into the Canvas API path. A student who set their ID to "1/users/2/grades?x="
    // could redirect/poison the request. Validate ^[A-Za-z0-9_.@-]{1,64}$ — anything
    // else is rejected before the request is built. Same charset Canvas itself
    // accepts for SIS user IDs.

    // SEC-1: validate courseId and assignmentId before interpolating into URL path
    if (!CANVAS_ID_RE.test(String(raw.courseId ?? ''))) {
      return { ok: false, error: 'Invalid Course ID format — must be numeric or sis_course_id:XXX.' }
    }
    if (!CANVAS_ID_RE.test(String(payload.assignmentId ?? ''))) {
      return { ok: false, error: 'Invalid Assignment ID format — must be numeric.' }
    }
    // ITER4-SEC: cap grades array to prevent main-process heap pressure + oversized Canvas POST
    if (!Array.isArray(payload.grades) || payload.grades.length > 1000) {
      return { ok: false, error: 'grades array invalid or exceeds 1000 entries.' }
    }
    const gradeData: Record<string, { posted_grade: string }> = {}
    const rejected: string[] = []
    for (const g of payload.grades) {
      if (!g.studentId) continue
      if (!STUDENT_ID_RE.test(g.studentId)) {
        // LOW-10: cap to 80 chars — studentName from renderer is untrusted;
        // avoid echoing unbounded strings back in the rejection message.
        const label = (g.studentName || g.studentId).slice(0, 80)
        rejected.push(label)
        continue
      }
      if (!Number.isFinite(g.score)) continue
      // Round to 1 decimal to avoid floating-point noise
      const rawScore = Math.round(g.score * 10) / 10
      gradeData[`sis_user_id:${g.studentId}`] = { posted_grade: String(rawScore) }
    }

    if (Object.keys(gradeData).length === 0) {
      // LOW-23: give a diagnostic that matches the actual failure mode.
      // Before: always said "Students must enter Canvas ID" even when the
      // grade book was empty or all scores were NaN.
      const hasAnyId = payload.grades.some((g: any) => g.studentId)
      const hasAnyScore = payload.grades.some((g: any) => Number.isFinite(g.score))
      let errMsg = 'Nothing to submit: '
      if (!payload.grades.length) errMsg += 'the grade book is empty — scan a submissions folder first.'
      else if (!hasAnyId) errMsg += 'no students have a Canvas Student ID in their report. Students must enter their ID when exporting.'
      else if (!hasAnyScore) errMsg += 'all students have a missing or invalid score (check rubric configuration).'
      else errMsg += 'all Student IDs failed format validation or all scores are non-finite.'
      return { ok: false, error: errMsg }
    }

    const res = await canvasRequest({
      baseUrl: raw.baseUrl,
      path: `/api/v1/courses/${raw.courseId}/assignments/${payload.assignmentId}/submissions/update_grades`,
      method: 'POST',
      token,
      body: { grade_data: gradeData },
    })

    if (!res.ok) {
      const errMsg = typeof res.body === 'object' && res.body !== null
        ? JSON.stringify(res.body)
        : String(res.body)
      return { ok: false, error: `Canvas API error (HTTP ${res.status}): ${errMsg}` }
    }

    // Canvas bulk update returns a Progress object — not per-student results
    // Return how many we submitted
    const rejectedSuffix = rejected.length > 0
      ? ` ${rejected.length} student${rejected.length !== 1 ? 's' : ''} rejected for invalid Student ID format: ${rejected.slice(0, 3).join(', ')}${rejected.length > 3 ? '…' : ''}.`
      : ''
    // LOW fix: skipped previously included rejected (double-counted). Now:
    //   skipped  = students with no SIS ID field at all (g.studentId falsy)
    //   rejected = students whose SIS ID failed the STUDENT_ID_RE format check
    //   submitted = students who passed both checks AND have a finite score
    // Note: students with a non-finite score (NaN/Infinity) also end up in
    // noSisId because they never enter gradeData — noSisId is best described
    // as "not submitted for any reason other than invalid SIS ID format".
    // LOW-12: updated comment to reflect this; count is correct.
    const noSisId = payload.grades.length - Object.keys(gradeData).length - rejected.length
    return {
      ok: true,
      submitted: Object.keys(gradeData).length,
      total: payload.grades.length,
      skipped: noSisId,
      rejected: rejected.length,
      message: `Submitted ${Object.keys(gradeData).length} grades to Canvas. Grades may take a moment to appear.${rejectedSuffix}`,
    }
  } catch (e: any) {
    return { ok: false, error: e?.message }
  }
})

ipcMain.handle('clear-lms-config', async () => {
  try {
    if (fs.existsSync(lmsConfigPath())) fs.unlinkSync(lmsConfigPath())
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message }
  }
})

// ── RTMcertify — pre-delivery compliance certificate ─────────────────────────
// ── Share as HTML ─────────────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildShareHtml(title: string, reportJson: string): string {
  let data: Record<string, any> = {}
  try { data = JSON.parse(reportJson) } catch { /* keep empty */ }

  const overall = (data?.overall ?? {}) as Record<string, any>
  const fileA = String(data?.file_a ?? data?.filename_a ?? 'File A')
  const fileB = String(data?.file_b ?? data?.filename_b ?? 'File B')
  const fmt = (v: unknown, unit = '') => v != null ? `${Number(v).toFixed(1)}${unit}` : '—'

  const rows: [string, string, string][] = [
    ['LUFS-I',       fmt(overall.lufs_i_a, ' LUFS'),  fmt(overall.lufs_i_b, ' LUFS')],
    ['True Peak',    fmt(overall.true_peak_a, ' dBTP'), fmt(overall.true_peak_b, ' dBTP')],
    ['LRA',          fmt(overall.lra_a, ' LU'),        fmt(overall.lra_b, ' LU')],
    ['PLR',          fmt(overall.plr_a, ' LU'),        fmt(overall.plr_b, ' LU')],
    ['Stereo Width', overall.stereo_width_a != null ? `${Math.round(Number(overall.stereo_width_a) * 100)}%` : '—',
                     overall.stereo_width_b != null ? `${Math.round(Number(overall.stereo_width_b) * 100)}%` : '—'],
  ]
  const tableRows = rows.map(([l, a, b]) => `<tr><td>${escapeHtml(l)}</td><td>${escapeHtml(a)}</td><td>${escapeHtml(b)}</td></tr>`).join('\n')

  const matchScore = overall.match_score ?? overall.overall_match ?? null
  const visqolLine = overall.visqol_mos != null
    ? `<p style="margin:8px 0;font-size:12px;color:rgba(208,176,102,0.7)">ViSQOL perceptual match: <strong>${Number(overall.visqol_mos).toFixed(2)}/5.0</strong></p>`
    : ''
  const dateFmt = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title || 'RTMcompare Report')}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#1a1816;color:#e9e2d4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;padding:32px;max-width:720px;margin:0 auto}
h1{font-size:18px;font-weight:500;color:rgba(208,176,102,0.9);margin-bottom:4px}
.sub{font-size:11px;color:rgba(168,161,150,0.5);margin-bottom:24px}
table{width:100%;border-collapse:collapse;margin:16px 0}
th{text-align:left;font-size:10px;color:rgba(168,161,150,0.5);padding:4px 8px;font-weight:400;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid rgba(255,255,255,0.06)}
td{padding:6px 8px;font-size:13px;border-bottom:1px solid rgba(255,255,255,0.04)}
td:first-child{color:rgba(168,161,150,0.7);font-size:11px}
.score{font-size:32px;font-weight:300;color:rgba(208,176,102,0.9);margin:16px 0 2px}
.score-label{font-size:10px;color:rgba(168,161,150,0.5);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px}
details{margin-top:24px;border:1px solid rgba(255,255,255,0.06);border-radius:2px}
summary{padding:8px 12px;font-size:11px;color:rgba(168,161,150,0.5);cursor:pointer;user-select:none}
pre{padding:12px;font-size:10px;overflow-x:auto;color:rgba(168,161,150,0.4);line-height:1.5;white-space:pre-wrap;word-break:break-all}
footer{margin-top:32px;font-size:10px;color:rgba(168,161,150,0.3);border-top:1px solid rgba(255,255,255,0.04);padding-top:16px}
a{color:inherit}
</style>
</head>
<body>
<h1>${escapeHtml(title || 'Analysis Report')}</h1>
<p class="sub">Generated by RTMcompare · ${dateFmt}</p>
${matchScore != null ? `<div class="score">${Math.round(Number(matchScore))}%</div><div class="score-label">Match Score</div>` : ''}
${visqolLine}
<table>
  <thead><tr><th>Metric</th><th>${escapeHtml(fileA)}</th><th>${escapeHtml(fileB)}</th></tr></thead>
  <tbody>${tableRows}</tbody>
</table>
<details>
  <summary>Full analysis data (JSON)</summary>
  <pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>
</details>
<footer>RTMcompare · <a href="https://rtmcompare.com">rtmcompare.com</a></footer>
</body>
</html>`
}

ipcMain.handle('share-as-html', async (_event, payload: { title: string; reportJson: string }) => {
  const result = await dialog.showSaveDialog({
    title: 'Save Shareable Report',
    defaultPath: `${(payload.title || 'rtm-report').replace(/[^a-z0-9_-]/gi, '_')}.html`,
    filters: [{ name: 'HTML Report', extensions: ['html'] }],
  })
  if (result.canceled || !result.filePath) return { success: false }

  const html = buildShareHtml(payload.title, payload.reportJson)
  fs.writeFileSync(result.filePath, html, 'utf8')
  return { success: true, filePath: result.filePath }
})

ipcMain.handle('rtm-certify', async (_event, fileA: string, fileB: string) => {
  try { assertSafeAudioPath(fileA, 'rtm-certify (A)') }
  catch (err: any) { return { ok: false, error: err?.message } }
  try { assertSafeAudioPath(fileB, 'rtm-certify (B)') }
  catch (err: any) { return { ok: false, error: err?.message } }

  const { pythonCmd, pythonDir } = getPythonPaths()
  const scriptPath = path.join(pythonDir, 'rtm_certify.py')
  if (!fs.existsSync(scriptPath)) return { ok: false, error: 'rtm_certify.py not found' }

  try {
    const { spawn } = require('child_process') as typeof import('child_process')
    const proc = spawn(pythonCmd, [scriptPath, '--certify', fileA, fileB], {
      cwd: pythonDir,
      env: pythonSpawnEnv(),
    })
    // watchdogSpawn enforces the same 5-minute timeout + 64 MB output cap as
    // every other secondary Python spawn, and kills the process automatically
    // so it can never become an orphan on app-quit.
    const { stdout, stderr } = await watchdogSpawn(proc, 'rtm-certify')
    const lines = stdout.split('\n')
    let result: any = null
    for (let i = lines.length - 1; i >= 0; i--) {
      const t = lines[i].trim()
      if (t.startsWith('{')) { try { result = JSON.parse(t); break } catch {} }
    }
    if (!result) throw new Error(`no JSON output; stderr: ${stderr.slice(-200)}`)
    if (result.error) return { ok: false, error: result.error }
    return { ok: true, certificate: result }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'rtm-certify failed' }
  }
})
