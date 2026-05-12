import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { spawn, type ChildProcess } from 'child_process'

let mainWindow: BrowserWindow | null = null

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
  const inAppMac = path.join(process.resourcesPath, 'python-bundle', 'python', 'bin', 'python3')
  const inAppWin = path.join(process.resourcesPath, 'python-bundle-win', 'python', 'python.exe')
  const devMac = path.resolve(__dirname, '..', '..', '..', 'python-bundle', 'python', 'bin', 'python3')
  const devWin = path.resolve(__dirname, '..', '..', '..', 'python-bundle-win', 'python', 'python.exe')

  const candidates = process.platform === 'darwin'
    ? [
        inAppMac,
        devMac,
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
      sandbox: false,
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
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost:5174') && !url.startsWith('file://')) {
      e.preventDefault()
    }
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(() => createWindow())
app.on('window-all-closed', () => app.quit())
app.on('activate', () => { if (mainWindow === null) createWindow() })


// ── IPC ──────────────────────────────────────────────────────────────

ipcMain.handle('select-files', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Pick audio files for the engineer profile',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: ['wav', 'aiff', 'aif', 'flac', 'mp3', 'm4a'] }],
  })
  if (res.canceled) return []
  return res.filePaths
})

ipcMain.handle('show-saved-profile', async (_e, jsonPath: string) => {
  const { shell } = require('electron') as typeof import('electron')
  try {
    shell.showItemInFolder(jsonPath)
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
}

// 5.7.x audit fix: serialise concurrent build-profile IPC calls. Pre-fix
// two presses (or a renderer reload mid-build) would spawn two Python
// procs that both wrote to ~/.rtm/profiles/<slug>.json — last writer
// wins, possibly mid-flush, leaving a truncated/invalid JSON. Now we
// reject a second invocation while one is in flight.
let activeBuild: ChildProcess | null = null

ipcMain.handle('build-profile', async (event, args: BuildArgs) => {
  if (activeBuild && !activeBuild.killed) {
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
  // Validate every file path exists before spawning Python — better
  // error than "file not found" buried in stderr.
  for (const f of args.files) {
    if (!fs.existsSync(f)) {
      return { ok: false, error: `file not found: ${f}` }
    }
  }

  const { python, reason } = resolvePython()
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
    const profilesDir = path.resolve(require('os').homedir(), '.rtm', 'profiles')
    const resolved = path.resolve(args.outPath)
    // 5.7.x audit fix: case-insensitive prefix check on Windows.
    // `os.homedir()` and renderer-supplied paths can disagree on
    // case (`C:\Users\Foo` vs `c:\users\foo`), failing the original
    // case-sensitive comparison and rejecting legitimate paths.
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
    '--role', args.role || 'Mastering Engineer',
    // 5.2.3: --genres removed; build_profile.py no longer accepts it
    '--progress',
  ]
  if (args.deep) cliArgs.push('--deep')
  if (safeOutPath) cliArgs.push('--out', safeOutPath)
  cliArgs.push(...args.files)

  return await new Promise<any>((resolve) => {
    const proc = spawn(python, cliArgs, {
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONDONTWRITEBYTECODE: '1',
      },
    })
    activeBuild = proc  // 5.7.x: register so a second IPC call sees we're busy
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => {
      const text = d.toString()
      stderr += text
      // Forward {"type":"progress",...} lines to the renderer.
      for (const line of text.split('\n')) {
        const t = line.trim()
        if (!t) continue
        try {
          const msg = JSON.parse(t)
          if (msg.type === 'progress') {
            mainWindow?.webContents.send('profile-progress', msg)
          }
        } catch { /* not JSON, ignore */ }
      }
    })
    proc.on('close', (code: number | null) => {
      activeBuild = null  // 5.7.x: release the slot for the next build
      if (code !== 0) {
        // Map common stderr shapes to friendly one-liners. Bundled Python
        // means xcode-select / pip-install errors should never fire in a
        // shipped app — but the patterns are kept defensively for the
        // dev fallback path and for surfacing real script bugs cleanly.
        const tail = stderr.slice(-400)
        let friendly = `RTMprofile couldn't finish the build. The error log below may help.`
        if (/Permission denied/i.test(tail)) {
          friendly = `Permission denied reading or writing the profile output. Check the destination folder is writable.`
        } else if (/no valid measurements/i.test(tail)) {
          friendly = `None of the dropped files had usable audio (silence or unreadable). Try a different selection.`
        } else if (/MemoryError|out of memory/i.test(tail)) {
          friendly = `Ran out of memory analysing the corpus. Try fewer or shorter tracks per build.`
        } else if (/xcode-select|ModuleNotFoundError|No module named/i.test(tail)) {
          // Should be impossible in a packaged build; if it fires, the
          // python-bundle didn't ship correctly — flag it as a packaging
          // bug rather than blaming the user.
          friendly = `Bundled Python failed to start. This is a packaging bug — please report so we can fix the build.`
        }
        resolve({
          ok: false,
          error: friendly,
          python_resolution: reason,
        })
        return
      }
      try {
        // 5.2.2 (audit P1): scan stdout from the END for the first
        // line that starts with `{` and parse THAT as JSON. The old
        // `.split('\n').pop()` picked any trailing line — a stray
        // deprecation warning from a transitive Python dep would
        // turn a successful build into a phantom failure.
        const lines = stdout.split('\n')
        let result: any = null
        for (let i = lines.length - 1; i >= 0; i--) {
          const t = lines[i].trim()
          if (t.startsWith('{')) {
            try { result = JSON.parse(t); break } catch { /* try previous */ }
          }
        }
        if (result == null) throw new Error('no JSON output found in stdout')
        resolve({ ...result, python_resolution: reason })
      } catch (e: any) {
        resolve({ ok: false, error: `parse failed: ${e?.message}; raw=${stdout.slice(-400)}` })
      }
    })
    proc.on('error', (err: Error) => {
      activeBuild = null  // 5.7.x
      resolve({
        ok: false,
        error: `Couldn't start the analysis engine. This is a packaging issue — please report.`,
        python_resolution: `spawn failed (${python}): ${err.message}`,
      })
    })
  })
})
