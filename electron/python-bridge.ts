import { spawn, execSync, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'

// Track the active analysis subprocess so the UI can cancel it.
let activeProc: ChildProcess | null = null

/** Env for every Python subprocess launched from Electron.
 *
 *  CRITICAL for code-signing: a notarized .app bundle is sealed at
 *  install time. If Python writes `.pyc` files into
 *  Contents/Resources/python-bundle/.../__pycache__/ on first run, or
 *  numba writes `.nbi`/`.nbc` cache files into the bundled site-packages,
 *  the Mach-O Code Signing seal breaks the moment the user clicks
 *  "Analyze". After that, `codesign --verify` fails and Gatekeeper may
 *  re-prompt on subsequent launches.
 *
 *  We force every spawned Python to:
 *    • not write .pyc files at all (PYTHONDONTWRITEBYTECODE=1)
 *    • redirect any leftover bytecode to a writable userData path
 *      (PYTHONPYCACHEPREFIX) — belt-and-suspenders if a sub-script
 *      ever clears DONTWRITEBYTECODE
 *    • redirect numba's JIT cache to a writable userData path
 *      (NUMBA_CACHE_DIR) — numba ignores PYTHONPYCACHEPREFIX
 *
 *  Caches are scoped under `app.getPath('userData')` (i.e.
 *  ~/Library/Application Support/RTMcompare/python-cache/) so they
 *  persist across runs and survive app updates without ever touching
 *  the signed bundle. */
export function pythonSpawnEnv(): NodeJS.ProcessEnv {
  let userData: string
  try {
    userData = require('electron').app.getPath('userData')
  } catch {
    // Dev mode (no electron app yet) — fall back to /tmp
    userData = require('os').tmpdir()
  }
  const cacheRoot = path.join(userData, 'python-cache')
  try { fs.mkdirSync(cacheRoot, { recursive: true }) } catch {}
  return {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONPYCACHEPREFIX: path.join(cacheRoot, 'pycache'),
    NUMBA_CACHE_DIR: path.join(cacheRoot, 'numba'),
  }
}

export function cancelActiveAnalysis(): boolean {
  if (!activeProc || activeProc.killed) return false
  try {
    // SIGTERM first, SIGKILL after 1s if still alive.
    activeProc.kill('SIGTERM')
    const p = activeProc
    setTimeout(() => { try { if (!p.killed) p.kill('SIGKILL') } catch {} }, 1000)
    return true
  } catch {
    return false
  }
}

export function getPythonPaths(): { pythonCmd: string; pythonDir: string; scriptPath: string } {
  const isPackaged = require('electron').app.isPackaged
  const isWin = process.platform === 'win32'

  let basePath: string
  if (isPackaged) {
    basePath = (process as any).resourcesPath
  } else {
    basePath = path.join(__dirname, '..')
  }

  const pythonDir = path.join(basePath, 'python')
  const scriptPath = path.join(pythonDir, 'analyze.py')

  // macOS-only: check for App Translocation (macOS moves apps to a
  // randomized read-only path when launched from inside a mounted DMG
  // window — that path can't reach the bundled Python helper, so we
  // surface a clear instruction). No equivalent behavior on Windows.
  //
  // Wording note: do NOT phrase this as "macOS cannot run …" — testers
  // read that as "your macOS version is too old". The fix is purely
  // about WHERE the app was launched from. RTMcompare supports macOS
  // 12 Monterey and later (LSMinimumSystemVersion 11.0).
  if (!isWin && basePath.includes('AppTranslocation')) {
    throw new Error(
      'RTMcompare was opened from inside the DMG window. macOS App ' +
      'Translocation runs DMG-launched apps in a sandboxed read-only ' +
      "location, which prevents RTM's bundled Python helper from " +
      'loading. To fix: drag RTMcompare onto the Applications folder ' +
      'inside the DMG, eject the DMG, then open RTMcompare from ' +
      '/Applications. (Your macOS version is supported — RTMcompare ' +
      'runs on macOS 12 Monterey and later.)'
    )
  }

  // Bundled standalone Python — different layout per platform.
  //   macOS:   python-bundle/python/bin/python3
  //   Windows: python-bundle-win/python/python.exe
  const winBundled = path.join(basePath, 'python-bundle-win', 'python', 'python.exe')
  const macBundled = path.join(basePath, 'python-bundle', 'python', 'bin', 'python3')

  if (isWin && fs.existsSync(winBundled)) {
    return { pythonCmd: winBundled, pythonDir, scriptPath }
  }
  if (!isWin && fs.existsSync(macBundled)) {
    return { pythonCmd: macBundled, pythonDir, scriptPath }
  }

  // Fallback: system python (dev mode)
  return {
    pythonCmd: isWin ? 'python.exe' : '/usr/bin/python3',
    pythonDir,
    scriptPath,
  }
}

export function ensureDeps(onProgress: (msg: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      // This will throw if App Translocation is detected
      getPythonPaths()
      resolve()
    } catch (err: any) {
      reject(err)
    }
  })
}

export async function analyzePython(
  fileA: string,
  fileB: string,
  onProgress: (msg: string) => void,
  fast: boolean = true,
  profile: string = 'ohad'
): Promise<any> {
  // Ensure deps are installed before running
  await ensureDeps(onProgress)

  return new Promise((resolve, reject) => {
    const { pythonCmd, pythonDir, scriptPath } = getPythonPaths()

    const args = [scriptPath, fileA, fileB]
    if (fast) args.push('--fast')
    if (profile) args.push(`--profile=${profile}`)

    const proc = spawn(pythonCmd, args, {
      cwd: pythonDir,
      env: pythonSpawnEnv(),
    })
    activeProc = proc

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString()
      stderr += text

      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const msg = JSON.parse(trimmed)
          if (msg.type === 'progress' && msg.message) {
            onProgress(msg.message)
          }
        } catch {
          // Not JSON progress
        }
      }
    })

    proc.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      // Clear the active-process pointer so future cancellations are no-ops.
      if (activeProc === proc) activeProc = null

      // Debug log
      try {
        const debugFs = require('fs')
        debugFs.writeFileSync('/tmp/rtm-debug.log',
          `Exit: ${code} Signal: ${signal}\nPython: ${pythonCmd}\nScript: ${scriptPath}\nArgs: ${args.join(' ')}\nStdout len: ${stdout.length}\nStderr: ${stderr.slice(-1000)}\n`)
      } catch {}

      // Distinguish cancelled from crashed.
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        const e: any = new Error('Analysis cancelled by user')
        e.cancelled = true
        reject(e)
        return
      }

      if (code !== 0) {
        reject(new Error(`Analysis failed (exit code ${code}): ${stderr.slice(-500)}`))
        return
      }

      try {
        const result = JSON.parse(stdout.trim())
        if (result.error) {
          reject(new Error(result.error))
        } else {
          resolve(result)
        }
      } catch {
        reject(new Error(`Failed to parse output: ${stdout.slice(0, 200)}`))
      }
    })

    proc.on('error', (err: Error) => {
      reject(new Error(`Could not start Python: ${err.message}`))
    })
  })
}
