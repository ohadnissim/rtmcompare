import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { spawn } from 'child_process'

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

  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())
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
  genres: string
  outPath?: string
  files: string[]
  /** Deep Scan: per-stem profile via Demucs. Adds ~30s-2min per track. */
  deep?: boolean
}

ipcMain.handle('build-profile', async (event, args: BuildArgs) => {
  if (!args.files || args.files.length === 0) {
    return { ok: false, error: 'no files supplied' }
  }
  if (!args.name?.trim()) {
    return { ok: false, error: 'engineer name required' }
  }
  // Validate every file path exists before spawning Python — better
  // error than "file not found" buried in stderr.
  for (const f of args.files) {
    if (!fs.existsSync(f)) {
      return { ok: false, error: `file not found: ${f}` }
    }
  }

  const { python, reason } = resolvePython()
  const basePath = app.isPackaged ? (process as any).resourcesPath : path.join(__dirname, '..')
  const scriptPath = path.join(basePath, 'python', 'build_profile.py')
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, error: `build_profile.py missing at ${scriptPath}` }
  }

  const cliArgs = [
    scriptPath,
    '--name', args.name,
    '--role', args.role || 'Mastering Engineer',
    '--genres', args.genres || '',
    '--progress',
  ]
  if (args.deep) cliArgs.push('--deep')
  if (args.outPath) cliArgs.push('--out', args.outPath)
  cliArgs.push(...args.files)

  return await new Promise<any>((resolve) => {
    const proc = spawn(python, cliArgs, {
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONDONTWRITEBYTECODE: '1',
      },
    })
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
        const result = JSON.parse(stdout.trim().split('\n').pop() || '{}')
        resolve({ ...result, python_resolution: reason })
      } catch (e: any) {
        resolve({ ok: false, error: `parse failed: ${e?.message}; raw=${stdout.slice(-400)}` })
      }
    })
    proc.on('error', (err: Error) => {
      resolve({
        ok: false,
        error: `Couldn't start the analysis engine. This is a packaging issue — please report.`,
        python_resolution: `spawn failed (${python}): ${err.message}`,
      })
    })
  })
})
