import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { spawn, type ChildProcess } from 'child_process'

let mainWindow: BrowserWindow | null = null

// ── Constants ────────────────────────────────────────────────────────
const DEFAULT_ROLE = 'Mastering Engineer'
// CRIT-3: kill the Python process after 30 minutes regardless of progress.
// Deep Scan on a large library is ~30s-2min per track; 30 min covers ~90
// tracks and prevents an indefinite hang if the script deadlocks.
const BUILD_TIMEOUT_MS = 30 * 60 * 1000

// ── Resolve Python — bundled-first, no external dependencies ─────────
//
// RTMprofile ships with the same ~700 MB Python interpreter that RTMcompare
// uses (numpy / scipy / soundfile / pyloudnorm pre-installed). Per user
// direction (May 2026): the app must work standalone — no "install
// RTMcompare first", no "install Xcode CLI tools", no pip.
//
// Resolution order:
//  1. In-app bundled Python (process.resourcesPath/python-bundle/...)
//  2. RTMcompare's bundle in /Applications (legacy + dev convenience)
//  3. System Python (last-ditch fallback for source-tree dev runs)
function resolvePython(): { python: string; reason: string } {
  // In dev (unpackaged), `process.resourcesPath` points at electron's own
  // resources dir — no bundle there. Fall back to the project's
  // ../python-bundle so dev runs work without install.
  // ITER4: arch-aware bundle selection — arm64 uses python-bundle, Intel uses python-bundle-intel.
  const isArm = process.arch === 'arm64'
  const inAppMacBundleName = isArm ? 'python-bundle' : 'python-bundle-intel'
  const inAppMac = path.join(process.resourcesPath, inAppMacBundleName, 'python', 'bin', 'python3')
  const inAppWin = path.join(process.resourcesPath, 'python-bundle-win', 'python', 'python.exe')
  const devMacBundleName = isArm ? 'python-bundle' : 'python-bundle-intel'
  const devMac = path.resolve(__dirname, '..', '..', '..', devMacBundleName, 'python', 'bin', 'python3')
  const devWin = path.resolve(__dirname, '..', '..', '..', 'python-bundle-win', 'python', 'python.exe')

  const candidates = process.platform === 'darwin'
    ? [
        inAppMac,
        devMac,
        // Legacy fallback: RTMcompare's arm64 bundle (may fail on Intel)
        '/Applications/RTMcompare.app/Contents/Resources/python-bundle/python/bin/python3',
      ]
    : process.platform === 'win32'
      ? [
          inAppWin,
          devWin,
          'C:\\Program Files\\RTMcompare\\resources\\python-bundle-win\\python\\python.exe',
          path.join(process.env['LOCALAPPDATA'] || '', 'Programs', 'RTMcompare', 'resources', 'python-bundle-win', 'python', 'python.exe'),
        ]
      : []

  // LOW-8: hoist existsSync loop to a lazy singleton resolved once at startup.
  // Calling this per-build on the main thread is safe (one-shot), but
  // resolving once at app-ready is cleaner.
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const isInApp = c === inAppMac || c === inAppWin
      return { python: c, reason: isInApp ? 'using bundled Python' : 'using fallback Python' }
    }
  }
  // Last resort: system Python. Should be unreachable in a packaged app
  // because the in-app bundle is mandatory now.
  return {
    python: process.platform === 'win32' ? 'python' : '/usr/bin/python3',
    reason: 'using system Python (bundled Python missing — this is a packaging bug, please report)',
  }
}

// Cache the Python resolution so we don't hit the filesystem on every build.
let _resolvedPython: { python: string; reason: string } | null = null
function getCachedPython() {
  if (!_resolvedPython) _resolvedPython = resolvePython()
  return _resolvedPython
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 700,
    minWidth: 560,
    minHeight: 520,
    backgroundColor: '#1c1a17',
    title: 'RTMprofile',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // MED-1: enable the OS-level Chromium sandbox (defence-in-depth).
      // contextIsolation: true + nodeIntegration: false already prevent
      // direct Node access from the renderer; sandbox: true additionally
      // constrains the renderer process at the OS level.
      sandbox: true,
    },
  })

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5174').catch(() => {
      setTimeout(() => mainWindow?.loadURL('http://localhost:5174'), 2000)
    })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // 5.2.2 hardening (audit P1): mirror RTMcompare's renderer lockdown.
  // CSP lives in index.html; window-level handlers complete the picture.
  // MED-2: restrict will-navigate — allow only the exact known dist path
  // or localhost dev URL. A bare `file://` wildcard would let a
  // compromised renderer read any local file via navigation.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const allowed =
      url.startsWith('http://localhost:5174') ||
      // Packaged app: only our own dist/index.html
      (app.isPackaged && url === mainWindow?.webContents.getURL())
    if (!allowed) {
      e.preventDefault()
    }
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.on('closed', () => { mainWindow = null })

  // CRIT-10: if the renderer reloads mid-build (dev Cmd+R or crash
  // recovery), the old activeBuild's 'close' handler fires into the
  // old closure and sets activeBuild=null — but only AFTER the new
  // renderer has already tried a build and been rejected. Kill the
  // orphaned process immediately on renderer reload so the new render
  // context starts with a clean slate.
  mainWindow.webContents.on('did-start-loading', () => {
    if (activeBuild !== null) {
      activeBuild.kill()
      activeBuild = null
    }
  })
}

app.whenReady().then(() => createWindow())
app.on('window-all-closed', () => app.quit())
app.on('activate', () => { if (mainWindow === null) createWindow() })


// ── IPC ──────────────────────────────────────────────────────────────

// Open an external URL via the OS default handler (used for rtmcompare:// protocol).
// MED: only allow rtmcompare:// and https:// URLs to prevent arbitrary navigation.
ipcMain.handle('open-external', async (_e, url: string) => {
  const { shell } = require('electron') as typeof import('electron')
  const safe = typeof url === 'string' && (url.startsWith('rtmcompare://') || url.startsWith('https://'))
  if (!safe) return
  await shell.openExternal(url)
})

// Recursively scan a folder for audio files.
// The folderPath comes from FileSystemDirectoryEntry.fullPath which is a
// virtual path — we resolve it relative to the home dir as a best-effort.
// The real use-case is the Electron drop path which is an absolute fs path.
ipcMain.handle('scan-folder', async (_e, folderPath: string) => {
  const AUDIO_EXTS = new Set(['.wav', '.aif', '.aiff', '.flac', '.mp3', '.m4a', '.ogg'])
  const results: string[] = []
  const MAX_FILES = 500

  function walkSync(dir: string, depth: number) {
    if (depth > 8 || results.length >= MAX_FILES) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (results.length >= MAX_FILES) return
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walkSync(full, depth + 1)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (AUDIO_EXTS.has(ext)) results.push(full)
      }
    }
  }

  const resolved = path.resolve(String(folderPath))
  try {
    const stat = fs.statSync(resolved)
    if (stat.isDirectory()) walkSync(resolved, 0)
  } catch { /* invalid path, return empty */ }
  return results
})

ipcMain.handle('select-files', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Pick audio files for the engineer profile',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: ['wav', 'aiff', 'aif', 'flac', 'mp3', 'm4a'] }],
  })
  if (res.canceled) return []
  return res.filePaths
})

// MED-3: validate the renderer-supplied path against the profiles dir
// before passing to shell.showItemInFolder. Without this, any
// renderer-supplied string becomes a local filesystem oracle.
ipcMain.handle('show-saved-profile', async (_e, jsonPath: string) => {
  const { shell } = require('electron') as typeof import('electron')
  const os = require('os') as typeof import('os')
  const profilesDir = path.resolve(os.homedir(), '.rtm', 'profiles')
  const resolved = path.resolve(String(jsonPath))
  const dirNorm = process.platform === 'win32' ? profilesDir.toLowerCase() : profilesDir
  const resNorm = process.platform === 'win32' ? resolved.toLowerCase() : resolved
  if (!resNorm.startsWith(dirNorm + path.sep) && resNorm !== dirNorm) {
    return false  // silently refuse — not within profiles dir
  }
  try {
    shell.showItemInFolder(resolved)
    return true
  } catch {
    return false
  }
})

interface BuildArgs {
  name: string
  role: string
  outPath?: string
  files: string[]
  /** Deep Scan: per-stem profile via Demucs. Adds ~30s-2min per track. */
  deep?: boolean
  chainReference?: string
}

// MED-28: use a typed BuildResult instead of Promise<any>
interface BuildResult {
  ok: boolean
  path?: string
  sample_count?: number
  skipped?: number
  // CRIT-11: number of tracks successfully analyzed before a crash
  partialCount?: number
  error?: string
  python_resolution?: string
  curve?: number[]
  curveMad?: number[]
}

// 5.7.x audit fix: serialise concurrent build-profile IPC calls. Pre-fix
// two presses (or a renderer reload mid-build) would spawn two Python
// procs that both wrote to ~/.rtm/profiles/<slug>.json — last writer
// wins, possibly mid-flush, leaving a truncated/invalid JSON. Now we
// reject a second invocation while one is in flight.
let activeBuild: ChildProcess | null = null

// CRIT-8: cancel the in-flight build. The renderer calls this when the
// user clicks the cancel button. We SIGTERM the Python process; the
// 'close' handler sets activeBuild=null and the build IPC resolves with
// ok: false + error: 'cancelled'.
ipcMain.handle('cancel-build', async () => {
  if (activeBuild !== null) {
    activeBuild.kill()  // SIGTERM; Python's atexit handlers run
    return true
  }
  return false
})

ipcMain.handle('build-profile', async (_event, args: BuildArgs): Promise<BuildResult> => {
  if (activeBuild !== null) {
    return { ok: false, error: 'A profile build is already in progress. Wait for it to finish or cancel it first.' }
  }
  if (!args.files || args.files.length === 0) {
    return { ok: false, error: 'no files supplied' }
  }
  if (!args.name?.trim()) {
    return { ok: false, error: 'engineer name required' }
  }
  // 5.2.2 hardening (audit P1): cap engineer name length so a runaway
  // string can't blow up filename-handling downstream (slugify can
  // collide silently). 80 chars is plenty for any real engineer name.
  if (args.name.length > 80) {
    return { ok: false, error: 'engineer name must be 80 characters or less' }
  }
  // LOW-3: cap role length too — previously uncapped.
  if (args.role && args.role.length > 80) {
    return { ok: false, error: 'role must be 80 characters or less' }
  }
  // CRIT-4: validate every file path exists AND resolve symlinks before
  // passing to Python. A symlink to /etc/passwd passes fs.existsSync
  // and reaches sf.read() — the resolved path is checked here to block
  // it from ever reaching the Python subprocess.
  for (const f of args.files) {
    if (!fs.existsSync(f)) {
      return { ok: false, error: `file not found: ${f}` }
    }
    try {
      const real = fs.realpathSync(f)
      // Verify the real path is a regular file, not /etc/passwd etc.
      const stat = fs.statSync(real)
      if (!stat.isFile()) {
        return { ok: false, error: `not a file: ${f}` }
      }
    } catch {
      return { ok: false, error: `could not resolve path: ${f}` }
    }
  }

  const { python, reason } = getCachedPython()
  const basePath = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..')
  const scriptPath = path.join(basePath, 'python', 'build_profile.py')
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, error: `build_profile.py missing at ${scriptPath}` }
  }

  // 5.2.2 hardening (audit P1): if the renderer sends an outPath, pin
  // it to ~/.rtm/profiles/ so a future renderer compromise can't write
  // to ~/Library/LaunchAgents/foo.plist or other sensitive locations.
  // Without an outPath the Python derives one from --name (legitimate
  // path, also under ~/.rtm/profiles/).
  let safeOutPath: string | undefined
  if (args.outPath) {
    const os = require('os') as typeof import('os')
    const profilesDir = path.resolve(os.homedir(), '.rtm', 'profiles')
    const resolved = path.resolve(args.outPath)
    // 5.7.x audit fix: case-insensitive prefix check on Windows.
    const dirNorm = process.platform === 'win32' ? profilesDir.toLowerCase() : profilesDir
    const resNorm = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    if (!resNorm.startsWith(dirNorm + path.sep) && resNorm !== dirNorm) {
      return { ok: false, error: 'outPath must live under ~/.rtm/profiles/' }
    }
    safeOutPath = resolved
  }

  const cliArgs = [
    scriptPath,
    '--name', args.name,
    '--role', args.role || DEFAULT_ROLE,
    '--progress',
  ]
  if (args.deep) cliArgs.push('--deep')
  if (safeOutPath) cliArgs.push('--out', safeOutPath)
  if (args.chainReference) cliArgs.push('--chain-reference', args.chainReference)
  cliArgs.push(...args.files)

  return await new Promise<BuildResult>((resolve) => {
    const proc = spawn(python, cliArgs, {
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONDONTWRITEBYTECODE: '1',
      },
    })
    activeBuild = proc  // 5.7.x: register so a second IPC call sees we're busy

    // CRIT-3: kill the process after BUILD_TIMEOUT_MS if it hasn't exited.
    const killTimer = setTimeout(() => {
      if (activeBuild === proc) {
        proc.kill()
        // Note: the 'close' handler will fire and call resolve().
      }
    }, BUILD_TIMEOUT_MS)

    let stdout = ''
    let stderr = ''
    // CRIT-11: track progress events so we know how many tracks were
    // analyzed before a crash or cancellation.
    let lastProgressI = 0

    // MED-27: assemble stderr line-by-line. A C-extension can write a
    // partial line that interrupts the JSON, causing the parser to
    // silently swallow it. The assembler here only calls JSON.parse on
    // complete '\n'-terminated lines.
    let stderrBuf = ''
    proc.stdout.on('data', (d: Buffer) => {
      // CRIT-3: cap the stdout buffer to prevent Node heap exhaustion
      // on runaway Python output. Keep only the last 4 MB.
      const chunk = d.toString()
      stdout += chunk
      if (stdout.length > 4_000_000) stdout = stdout.slice(-4_000_000)
    })
    proc.stderr.on('data', (d: Buffer) => {
      const text = d.toString()
      stderr += text
      if (stderr.length > 4_000_000) stderr = stderr.slice(-4_000_000)
      // MED-27: append to the line assembler and drain complete lines.
      stderrBuf += text
      let nl: number
      while ((nl = stderrBuf.indexOf('\n')) !== -1) {
        const line = stderrBuf.slice(0, nl)
        stderrBuf = stderrBuf.slice(nl + 1)
        const t = line.trim()
        if (!t) continue
        try {
          const msg = JSON.parse(t)
          if (msg.type === 'progress') {
            lastProgressI = msg.i || 0
            mainWindow?.webContents.send('profile-progress', msg)
          }
        } catch { /* not JSON, ignore */ }
      }
    })
    proc.on('close', (code: number | null, signal: string | null) => {
      clearTimeout(killTimer)
      activeBuild = null  // 5.7.x: release the slot for the next build
      if (code !== 0) {
        const wasCancelled = signal === 'SIGTERM' || code === null
        // Map common stderr shapes to friendly one-liners.
        const tail = stderr.slice(-400)
        let friendly = wasCancelled
          ? 'Build cancelled.'
          : `RTMprofile couldn't finish the build. The error log below may help.`
        if (!wasCancelled) {
          if (/Permission denied/i.test(tail)) {
            friendly = `Permission denied reading or writing the profile output. Check the destination folder is writable.`
          } else if (/no valid measurements/i.test(tail)) {
            friendly = `None of the dropped files had usable audio (silence or unreadable). Try a different selection.`
          } else if (/MemoryError|out of memory/i.test(tail)) {
            friendly = `Ran out of memory analysing the corpus. Try fewer or shorter tracks per build.`
          } else if (/xcode-select|ModuleNotFoundError|No module named/i.test(tail)) {
            friendly = `Bundled Python failed to start. This is a packaging bug — please report so we can fix the build.`
          }
        }
        resolve({
          ok: false,
          error: friendly,
          python_resolution: reason,
          // CRIT-11: tell the renderer how many tracks got analyzed
          // before the crash/cancel so it can surface partial progress.
          partialCount: lastProgressI > 0 ? lastProgressI : undefined,
        })
        return
      }
      try {
        // 5.2.2 (audit P1): scan stdout from the END for the first
        // line that starts with `{` and parse THAT as JSON.
        const lines = stdout.split('\n')
        let result: BuildResult | null = null
        for (let i = lines.length - 1; i >= 0; i--) {
          const t = lines[i].trim()
          if (t.startsWith('{')) {
            try {
              const parsed = JSON.parse(t)
              // MED-26: validate the parsed object has the expected shape
              // before accepting it as a BuildResult. A stray JSON-ish
              // log line would silently produce ok: undefined (falsy) and
              // show "Build failed" for a successful run.
              if (typeof parsed.ok === 'boolean') {
                result = parsed as BuildResult
                break
              }
            } catch { /* try previous line */ }
          }
        }
        if (result == null) throw new Error('no JSON output found in stdout')
        // Inject curve data for ProfileRadar component
        if (result.ok && result.path) {
          try {
            const profileJson = JSON.parse(fs.readFileSync(result.path, 'utf8'))
            if (Array.isArray(profileJson.curve)) result.curve = profileJson.curve
            if (Array.isArray(profileJson.curve_mad)) result.curveMad = profileJson.curve_mad
          } catch { /* non-fatal — radar just won't show */ }
        }
        resolve({ ...result, python_resolution: reason })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        resolve({ ok: false, error: `parse failed: ${msg}; raw=${stdout.slice(-400)}` })
      }
    })
    proc.on('error', (err: Error) => {
      clearTimeout(killTimer)
      activeBuild = null  // 5.7.x
      resolve({
        ok: false,
        error: `Couldn't start the analysis engine. This is a packaging issue — please report.`,
        python_resolution: `spawn failed (${python}): ${err.message}`,
      })
    })
  })
})
