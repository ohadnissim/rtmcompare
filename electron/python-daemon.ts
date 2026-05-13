/**
 * python-daemon.ts — Electron-side manager for the persistent RTM Python daemon.
 *
 * OVERVIEW
 * --------
 * RTMcompare previously spawned a new Python process for every analysis,
 * paying ~13 s of cold-start overhead each time (Python import ~5 s +
 * ONNX BS-RoFormer model load ~8 s).  This module starts a single long-lived
 * daemon that keeps the interpreter and model warm, cutting repeat-analysis
 * latency from ~30 s to ~17 s.
 *
 * LIFECYCLE
 * ---------
 *   startDaemon()    — call from app.whenReady() (non-blocking; boot is async)
 *   daemonRequest()  — send a JSON-RPC request, await the JSON response
 *   shutdownDaemon() — call from app.quit() / before-quit handler
 *
 * FALLBACK
 * --------
 * If the daemon is not running or fails to respond, daemonRequest() rejects
 * so the caller (python-bridge.ts / analyzePython) can fall back to the
 * original spawn-per-analysis path.  The daemon is purely additive — it
 * does NOT replace the existing code path.
 *
 * RESTART POLICY
 * --------------
 * Up to MAX_RESTARTS (3) automatic restarts on unexpected crash.
 * After exhausting restarts the daemon stays down; every daemonRequest()
 * rejects with DaemonUnavailableError so the caller falls back gracefully.
 *
 * THREAD SAFETY NOTE
 * ------------------
 * All pending requests are stored in a Map keyed by UUID.  The daemon
 * processes them concurrently (ThreadPoolExecutor, max 4) but ONNX
 * inference is serialised inside the Python layer.  The Electron side
 * is purely event-driven (no blocking) so concurrent calls are safe.
 */

import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as readline from 'readline'
import { randomUUID as uuidv4 } from 'crypto'
import { getPythonPaths, pythonSpawnEnv, registerJob, unregisterJob } from './python-bridge'

// ── types ─────────────────────────────────────────────────────────────────────

/** Thrown by daemonRequest() when the daemon is not available. */
export class DaemonUnavailableError extends Error {
  readonly code = 'DAEMON_UNAVAILABLE'
  constructor(reason: string) {
    super(`RTM daemon unavailable: ${reason}`)
    this.name = 'DaemonUnavailableError'
  }
}

interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
  progressCallback?: (msg: string) => void
  timer: NodeJS.Timeout
}

type DaemonState = 'stopped' | 'starting' | 'ready' | 'restarting' | 'dead'

// ── constants ─────────────────────────────────────────────────────────────────

const MAX_RESTARTS = 3
/** How long to wait for the daemon to send its ready signal on startup (ms). */
const STARTUP_TIMEOUT_MS = 60_000
/** Per-request timeout — generous because deep-scan takes up to 30 s. */
const REQUEST_TIMEOUT_MS = (Number(process.env.RTM_PY_TIMEOUT_MS) || 30 * 60 * 1000)

// ── module-level state ────────────────────────────────────────────────────────

let _proc: ChildProcess | null = null
let _jobId: string | null = null
let _state: DaemonState = 'stopped'
let _restartCount = 0
let _startupTimer: NodeJS.Timeout | null = null

/** In-flight requests waiting for a JSON-RPC response. */
const _pending = new Map<string, PendingRequest>()

/** Callbacks waiting for the daemon to reach the 'ready' state. */
const _readyWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = []

// ── internal helpers ──────────────────────────────────────────────────────────

function _setState(s: DaemonState): void {
  _state = s
}

function _drainPending(err: Error): void {
  for (const [id, req] of _pending) {
    clearTimeout(req.timer)
    req.reject(err)
    _pending.delete(id)
  }
}

function _rejectWaiters(err: Error): void {
  for (const w of _readyWaiters) w.reject(err)
  _readyWaiters.length = 0
}

function _resolveWaiters(): void {
  for (const w of _readyWaiters) w.resolve()
  _readyWaiters.length = 0
}

/** Wait until the daemon reaches the 'ready' state or reject on timeout. */
function _whenReady(): Promise<void> {
  if (_state === 'ready') return Promise.resolve()
  if (_state === 'dead') return Promise.reject(new DaemonUnavailableError('daemon is dead'))
  if (_state === 'stopped') return Promise.reject(new DaemonUnavailableError('daemon not started'))
  return new Promise<void>((resolve, reject) => {
    _readyWaiters.push({ resolve, reject })
  })
}

/** Send a raw JSON-RPC line to the daemon's stdin. */
function _send(obj: object): void {
  if (!_proc || !_proc.stdin || _proc.killed) {
    throw new DaemonUnavailableError('no live process')
  }
  _proc.stdin.write(JSON.stringify(obj) + '\n')
}

/** Route one parsed line from the daemon's stdout to the matching waiter. */
function _handleLine(line: string): void {
  let msg: any
  try {
    msg = JSON.parse(line)
  } catch {
    // Non-JSON stdout line — ignore (shouldn't happen in normal operation).
    return
  }

  const id: string | undefined = msg?.id
  if (!id) return

  const req = _pending.get(id)
  if (!req) return

  clearTimeout(req.timer)
  _pending.delete(id)

  if (msg.error) {
    req.reject(new Error(String(msg.error)))
  } else {
    req.resolve(msg.result)
  }
}

/** Route one parsed line from the daemon's stderr to the matching waiter's progress callback. */
function _handleStderrLine(line: string): void {
  let msg: any
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }

  // Ready signal — daemon has loaded all models.
  if (msg?.type === 'ready') {
    if (_startupTimer) { clearTimeout(_startupTimer); _startupTimer = null }
    _setState('ready')
    _resolveWaiters()
    return
  }

  // Progress for an in-flight request.
  if (msg?.type === 'progress' && msg?.id) {
    const req = _pending.get(msg.id)
    if (req?.progressCallback) {
      req.progressCallback(String(msg.message ?? ''))
    }
    return
  }
}

// ── start / stop ──────────────────────────────────────────────────────────────

/**
 * Start the daemon process.  Safe to call multiple times — no-op if already
 * running.  Returns immediately; use daemonRequest() which waits for 'ready'.
 */
export function startDaemon(): void {
  if (_state === 'starting' || _state === 'ready') return
  if (_state === 'dead') {
    console.warn('[RTM-daemon] daemon is dead (too many restarts), not starting')
    return
  }

  _setState('starting')

  let pythonCmd: string
  let pythonDir: string

  try {
    const paths = getPythonPaths()
    pythonCmd = paths.pythonCmd
    pythonDir = paths.pythonDir
  } catch (err: any) {
    console.error('[RTM-daemon] getPythonPaths failed:', err.message)
    _setState('dead')
    _rejectWaiters(new DaemonUnavailableError(err.message))
    return
  }

  const daemonScript = path.join(pythonDir, 'rtm_daemon.py')
  const args = [daemonScript, '--daemon']

  console.log(`[RTM-daemon] Spawning: ${pythonCmd} ${args.join(' ')}`)

  const proc = spawn(pythonCmd, args, {
    cwd: pythonDir,
    env: pythonSpawnEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  _proc = proc
  _jobId = registerJob('daemon', proc)

  // ── stdout: newline-delimited JSON-RPC responses ─────────────────────────
  const rl = readline.createInterface({ input: proc.stdout!, crlfDelay: Infinity })
  rl.on('line', _handleLine)

  // ── stderr: progress + ready signal ─────────────────────────────────────
  const rlErr = readline.createInterface({ input: proc.stderr!, crlfDelay: Infinity })
  rlErr.on('line', _handleStderrLine)

  // ── startup timeout ───────────────────────────────────────────────────────
  _startupTimer = setTimeout(() => {
    if (_state !== 'ready') {
      console.error('[RTM-daemon] startup timed out — killing process')
      try { proc.kill('SIGTERM') } catch {}
    }
  }, STARTUP_TIMEOUT_MS)

  // ── process exit ─────────────────────────────────────────────────────────
  proc.on('close', (code, signal) => {
    if (_startupTimer) { clearTimeout(_startupTimer); _startupTimer = null }
    if (_jobId) { unregisterJob(_jobId); _jobId = null }
    _proc = null

    const wasReady = (_state === 'ready')
    const reason = `exited (code=${code} signal=${signal})`

    // Drain all pending requests with an error.
    _drainPending(new DaemonUnavailableError(reason))

    if (_restartCount < MAX_RESTARTS) {
      _restartCount++
      const delay = Math.min(1000 * _restartCount, 5000)
      console.warn(`[RTM-daemon] ${reason} — restart ${_restartCount}/${MAX_RESTARTS} in ${delay} ms`)
      _setState('restarting')
      _rejectWaiters(new DaemonUnavailableError(`restarting after ${reason}`))
      setTimeout(startDaemon, delay)
    } else {
      console.error(`[RTM-daemon] ${reason} — exhausted restarts, marking dead`)
      _setState('dead')
      _rejectWaiters(new DaemonUnavailableError(reason))
    }
  })

  proc.on('error', (err) => {
    console.error('[RTM-daemon] spawn error:', err.message)
    if (_startupTimer) { clearTimeout(_startupTimer); _startupTimer = null }
    _drainPending(new DaemonUnavailableError(err.message))
    _setState('dead')
    _rejectWaiters(new DaemonUnavailableError(err.message))
  })
}

/**
 * Send a shutdown request and forcibly kill the process if it doesn't exit
 * within 3 seconds.  Safe to call on app quit.
 */
export async function shutdownDaemon(): Promise<void> {
  if (!_proc || _proc.killed) {
    _setState('stopped')
    return
  }

  console.log('[RTM-daemon] Sending shutdown…')
  _setState('stopped')  // Prevent restart logic on the ensuing close event.
  _restartCount = MAX_RESTARTS  // Suppress restart.

  try {
    _send({ id: uuidv4(), method: 'shutdown' })
  } catch {
    // stdin may already be closed — proceed to force-kill.
  }

  const proc = _proc
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      if (!proc.killed) {
        try { proc.kill('SIGKILL') } catch {}
      }
      resolve()
    }, 3000)
    proc.once('close', () => { clearTimeout(t); resolve() })
  })
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Send a JSON-RPC request to the daemon and return the result.
 *
 * Throws DaemonUnavailableError if the daemon is not running — callers
 * should catch this and fall back to the spawn-per-analysis path.
 *
 * @param method   JSON-RPC method name
 * @param params   Request params object
 * @param onProgress  Optional callback for progress messages
 */
export async function daemonRequest(
  method: string,
  params: Record<string, unknown>,
  onProgress?: (msg: string) => void
): Promise<unknown> {
  // Wait for daemon to be ready (or reject immediately if dead/stopped).
  await _whenReady()

  const id = uuidv4()

  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      _pending.delete(id)
      reject(new Error(`RTM daemon request timed out after ${REQUEST_TIMEOUT_MS / 1000} s`))
    }, REQUEST_TIMEOUT_MS)

    _pending.set(id, { resolve, reject, progressCallback: onProgress, timer })

    try {
      _send({ id, method, params })
    } catch (err: any) {
      clearTimeout(timer)
      _pending.delete(id)
      reject(new DaemonUnavailableError(err.message))
    }
  })
}

/**
 * Convenience wrapper: run a full two-file comparison via the daemon.
 * Returns the same JSON structure as analyzePython() in python-bridge.ts.
 * Throws DaemonUnavailableError when daemon is down (caller falls back).
 */
export async function daemonAnalyze(
  fileA: string,
  fileB: string,
  onProgress: (msg: string) => void,
  fast = true,
  profile = 'ohad'
): Promise<unknown> {
  return daemonRequest('analyze', { file_a: fileA, file_b: fileB, fast, profile }, onProgress)
}

/**
 * Convenience wrapper: single-file reference analysis via the daemon.
 */
export async function daemonAnalyzeSingle(
  file: string,
  onProgress: (msg: string) => void,
  fast = true,
  profile = 'ohad'
): Promise<unknown> {
  return daemonRequest('analyze_single', { file, fast, profile }, onProgress)
}

/**
 * Ping the daemon.  Resolves true if alive, false if not available.
 */
export async function pingDaemon(): Promise<boolean> {
  try {
    const res = await daemonRequest('ping', {}) as any
    return res?.pong === true
  } catch {
    return false
  }
}

/** True when the daemon process is live and has signalled ready. */
export function isDaemonReady(): boolean {
  return _state === 'ready'
}
