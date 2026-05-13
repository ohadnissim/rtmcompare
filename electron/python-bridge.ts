import { spawn, execSync, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'

// 5.2.0 reliability fix (audit P1-14): track ALL active Python subprocesses
// in a Map keyed by an internal job id, not a single global slot. The old
// `activeProc` pointer was overwritten on every spawn, so cancellation only
// killed the most recent comparator and leaked all parallel jobs (render-
// corrected-eq, master-chain-render, encoded-preview-render, declick,
// translation, references-add, …).
const activeJobs = new Map<string, ChildProcess>()
let _jobCounter = 0
function nextJobId(prefix = 'job'): string {
 _jobCounter = (_jobCounter + 1) & 0xffffffff
 return `${prefix}-${Date.now().toString(36)}-${_jobCounter.toString(36)}`
}
export function registerJob(prefix: string, proc: ChildProcess): string {
 const id = nextJobId(prefix)
 activeJobs.set(id, proc)
 const cleanup = () => activeJobs.delete(id)
 proc.once('exit', cleanup)
 proc.once('error', cleanup)
 return id
}
export function unregisterJob(id: string): void { activeJobs.delete(id) }
// Backward-compat shim — old call sites that wrote to `activeProc`
// directly. The most-recent-spawn semantics are preserved by re-registering
// each spawn under a fresh id; cancelActiveAnalysis() walks the whole map.
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
  // 5.7.x audit fix: namespace the numba cache by app version. Pre-fix,
  // multiple concurrent analyses (a parallel batch run, or the user
  // hitting Analyze twice quickly) wrote the same `.nbi`/`.nbc` files
  // simultaneously — numba doesn't lock cache files. Symptom on first
  // launch after upgrade: `ImportError: nbi version mismatch`. Per-
  // version subdir means a) concurrent writes within the same version
  // are still racy but converge, and b) upgrades start with a clean
  // cache so stale .nbi from a prior version can't poison the load.
  let appVersion = 'dev'
  try { appVersion = require('electron').app.getVersion() } catch {}
  const numbaCacheDir = path.join(cacheRoot, 'numba', appVersion)
  try { fs.mkdirSync(numbaCacheDir, { recursive: true }) } catch {}
  return {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONPYCACHEPREFIX: path.join(cacheRoot, 'pycache'),
    NUMBA_CACHE_DIR: numbaCacheDir,
  }
}

// 5.2.2 (audit P1-W4): on Windows, Node's `proc.kill('SIGTERM')`
// unconditionally TerminateProcess'es the parent only — it has no notion
// of process groups, so any Python children (numba JIT, demucs torch
// worker, ffmpeg) keep running and pin file handles. Use `taskkill /T`
// for tree-kill on Windows; SIGTERM/SIGKILL on POSIX.
function killTree(p: ChildProcess) {
  if (p.killed) return
  if (process.platform === 'win32') {
    try {
      const { execFileSync } = require('child_process') as typeof import('child_process')
      execFileSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      try { p.kill() } catch {}
    }
  } else {
    try {
      p.kill('SIGTERM')
      const t = setTimeout(() => { try { if (!p.killed) p.kill('SIGKILL') } catch {} }, 1000)
      p.once('exit', () => clearTimeout(t))
    } catch {}
  }
}

export function cancelActiveAnalysis(): boolean {
  // 5.2.0: walk the entire active-jobs map (was: only killed the single
  // most-recent comparator). 5.2.2: tree-kill on Windows so child Python
  // workers don't orphan.
  let killed = false
  for (const [id, p] of activeJobs) {
    if (!p.killed) {
      killTree(p)
      killed = true
    }
    activeJobs.delete(id)
  }
  // Legacy single-slot pointer kept in sync.
  if (activeProc && !activeProc.killed) {
    killTree(activeProc)
    killed = true
  }
  return killed
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
  // Prefer Homebrew arm64 Python if available (dev on Apple Silicon — the
  // bundled python-bundle/ only ships with the packaged app, not in the dev
  // tree, so /usr/bin/python3 is bare and lacks numpy/soundfile/etc.)
  const homebrewPythons = [
    '/opt/homebrew/bin/python3.12',
    '/opt/homebrew/bin/python3.11',
    '/opt/homebrew/bin/python3.10',
    '/opt/homebrew/bin/python3',
  ]
  if (!isWin) {
    for (const p of homebrewPythons) {
      if (fs.existsSync(p)) {
        return { pythonCmd: p, pythonDir, scriptPath }
      }
    }
  }
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
  profile: string = ''
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
    // Register in the multi-job tracker so cancelActiveAnalysis() kills
    // this even if a parallel job has overwritten `activeProc` since.
    const jobId = registerJob('analyze', proc)

    // 5.2.0 reliability hardening (audit P1-15):
    //   • per-stream stdout/stderr cap (256 MB combined) — a runaway
    //     Python that prints unbounded JSON should fail loudly, not
    //     OOM the main process
    //   • timeout (env-tunable RTM_PY_TIMEOUT_MS, default 30 minutes)
    //     — a deadlocked numba JIT or wedged demucs should never
    //     leave the renderer waiting forever on a Promise
    const STDOUT_CAP_BYTES = 256 * 1024 * 1024
    let stdoutBytes = 0
    let stderrBytes = 0
    let bufferKilled = false
    const TIMEOUT_MS = Number(process.env.RTM_PY_TIMEOUT_MS) || 30 * 60 * 1000
    const watchdog = setTimeout(() => {
      if (!proc.killed) {
        try { proc.kill('SIGTERM') } catch {}
        bufferKilled = true
      }
    }, TIMEOUT_MS)

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => {
      stdoutBytes += data.length
      if (stdoutBytes + stderrBytes > STDOUT_CAP_BYTES) {
        if (!bufferKilled) {
          bufferKilled = true
          try { proc.kill('SIGTERM') } catch {}
        }
        return
      }
      stdout += data.toString()
    })

    proc.stderr.on('data', (data: Buffer) => {
      stderrBytes += data.length
      if (stdoutBytes + stderrBytes > STDOUT_CAP_BYTES) {
        if (!bufferKilled) {
          bufferKilled = true
          try { proc.kill('SIGTERM') } catch {}
        }
        return
      }
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
      unregisterJob(jobId)
      clearTimeout(watchdog)
      if (bufferKilled) {
        // Replace whatever stderr looks like with a friendly message —
        // the renderer should hear "Python ran too long / produced too
        // much output" not a partial traceback.
        stderr = `RTMcompare aborted the analysis: ${stdoutBytes + stderrBytes >= STDOUT_CAP_BYTES ? 'output exceeded 256 MB' : 'timed out (set RTM_PY_TIMEOUT_MS to override)'}.`
      }

      // 5.2.2 (audit P0-W3 + P0-F5 from Mac): debug log was hardcoded to
      // /tmp/rtm-debug.log — broken on Windows AND a low-grade info-disclosure
      // (world-readable temp file with absolute paths every analysis).
      // Now: gated behind RTM_DEBUG=1, written under app userData with
      // 0600 perms, cross-platform.
      if (process.env.RTM_DEBUG) {
        try {
          let userData: string
          try {
            userData = require('electron').app.getPath('userData')
          } catch {
            userData = require('os').tmpdir()
          }
          const debugPath = path.join(userData, 'rtm-debug.log')
          fs.writeFileSync(debugPath,
            `Exit: ${code} Signal: ${signal}\nPython: ${pythonCmd}\nScript: ${scriptPath}\nArgs: ${args.join(' ')}\nStdout len: ${stdout.length}\nStderr: ${stderr.slice(-1000)}\n`,
            { mode: 0o600 }
          )
        } catch {}
      }

      // 5.7.x audit fix: differentiate the THREE reasons SIGTERM fires.
      // Pre-fix, every SIGTERM/SIGKILL was reported as "cancelled by
      // user", masking the watchdog timeout (30 min) and the stdout
      // overflow guard. Check the more-specific flag first so users
      // see the real cause when their analysis dies on its own.
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        if (bufferKilled) {
          reject(new Error('Analysis killed: stdout overflow (Python printed too much). Re-run with smaller files or report this as a bug.'))
          return
        }
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
