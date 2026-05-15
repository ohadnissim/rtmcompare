/**
 * RTMsend bridge — Electron main-process side.
 *
 * Speaks newline-delimited JSON-RPC 2.0 to the localhost server that
 * RTMsend's RpcServer listens on (see rtm-send-plugin/Source/RpcServer.{h,cpp}).
 *
 * Port discovery (5.7.1 Tier-3):
 *   Pre-5.7.0 RTMsend wrote a single integer port to ~/.rtm/rtmsend.port.
 *   5.7.0+ writes a per-instance metadata file
 *     ~/.rtm/rtmsend-<pid>-<uuid8>.port
 *   containing JSON {pid, uuid, port, host_app, plugin_name, build}.
 *   Multiple RTMsend instances (one per DAW project / track) can coexist;
 *   we enumerate all per-instance files, sort by mtime DESC, and probe
 *   each port until one answers host.ping. If no per-instance files are
 *   present we fall back to the legacy single-line file so a 5.6.x
 *   RTMsend on the user's system still works.
 *
 * Public surface:
 *   getLoadedPlugin()                 → { name, parameter_count, sample_rate, latency_samples } | null
 *   findParameters(pattern)           → [{ index, name, label, current, default, text }, ...]
 *   setParameters([{ index, value }]) → { applied: [...], rejected: [...] }
 *   recommendEq(payload)              → 5.7.1 Tier-3: send EQ with target-fingerprint guard
 *   ping()                             → 'pong' | throws
 *   probeConnection()                  → ConnectionStatus (read-only, never throws)
 *
 * All calls are async; each opens a fresh TCP connection, sends one
 * line, reads one line, closes. RTMsend's RpcServer handles one client
 * at a time but accepts new connections sequentially — fine at our
 * call rate (clicks, not streams).
 */

import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'

// ── Port discovery ────────────────────────────────────────────────
// 5.7.1 Tier-3: prefer per-instance metadata files; fall back to legacy
// single-line port file for pre-5.7.0 instances. We never trust the
// JSON blindly — `validatePortMeta` enforces shape before we connect.

const RTM_DIR = path.join(os.homedir(), '.rtm')
const LEGACY_PORT_FILE = path.join(RTM_DIR, 'rtmsend.port')

// Per-instance file naming: rtmsend-<pid>-<uuid8>.port (matches
// RpcServer::getInstancePortFile()). The UUID is 8 hex chars, the PID
// is decimal — both safe to read directly into a regex.
const INSTANCE_PORT_RE = /^rtmsend-\d+-[0-9a-fA-F]{8}\.port$/

// 5.7.1 Tier-3: enumeration result. We expose meta to callers so the
// connection indicator can show "host_app · plugin_name" without a
// second round-trip.
export interface RtmSendInstanceMeta {
  pid?: number
  uuid?: string
  port: number
  host_app?: string
  plugin_name?: string
  build?: string
  /** Per-connection auth token. RpcServer (v1.2+) requires every client
   *  to send this as the FIRST line before any JSON-RPC traffic. The
   *  server closes silently on mismatch. Absent on pre-v1.2 instances
   *  (legacy) and the single-line legacy port file. */
  auth_token?: string
  /** True when we got this from the legacy single-line file (pre-5.7.0).
   *  Such instances don't speak Tier-3 ping handshake. */
  legacy: boolean
  /** Absolute path of the file we read this from. Used for unlink-on-
   *  ECONNREFUSED so a stale file from a crashed instance gets cleaned. */
  source_path: string
}

function safeReadJson (p: string): any | null {
  try {
    const raw = fs.readFileSync(p, 'utf8')
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function validateInstanceMeta (raw: any, sourcePath: string): RtmSendInstanceMeta | null {
  if (!raw || typeof raw !== 'object') return null
  const port = Number(raw.port)
  if (!Number.isFinite(port) || port <= 0 || port >= 65536) return null
  // String fields are optional but must be strings if present.
  const checkStr = (v: unknown) => (typeof v === 'string' && v.length < 256 ? v : undefined)
  // auth_token: 32-char hex (128-bit from juce::Uuid). Validate shape
  // so a malformed file can't inject content onto the socket.
  const rawToken = raw.auth_token
  const auth_token = (typeof rawToken === 'string' && /^[0-9a-fA-F]{32}$/.test(rawToken))
    ? rawToken : undefined
  return {
    pid: typeof raw.pid === 'number' && Number.isFinite(raw.pid) ? raw.pid : undefined,
    uuid: checkStr(raw.uuid),
    port,
    auth_token,
    host_app: checkStr(raw.host_app),
    plugin_name: checkStr(raw.plugin_name),
    build: checkStr(raw.build),
    legacy: false,
    source_path: sourcePath,
  }
}

function readLegacyPortFile (): RtmSendInstanceMeta | null {
  try {
    const raw = fs.readFileSync(LEGACY_PORT_FILE, 'utf8').trim()
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n) || n <= 0 || n >= 65536) return null
    return { port: n, legacy: true, source_path: LEGACY_PORT_FILE }
  } catch {
    return null
  }
}

// 5.7.1 Tier-3: enumerate every rtmsend-*.port file in ~/.rtm, sorted
// by mtime DESC (newest first). Returns the parsed metadata for each.
// We DON'T fall back to the legacy file here — callers that want
// legacy-fallback semantics should call readLegacyPortFile() after
// exhausting the per-instance list.
function enumerateInstancePortFiles (): RtmSendInstanceMeta[] {
  let files: string[]
  try {
    files = fs.readdirSync(RTM_DIR)
  } catch {
    return []
  }

  const candidates: { path: string; mtime: number }[] = []
  for (const f of files) {
    if (!INSTANCE_PORT_RE.test(f)) continue
    const fullPath = path.join(RTM_DIR, f)
    try {
      const st = fs.statSync(fullPath)
      if (!st.isFile()) continue
      candidates.push({ path: fullPath, mtime: st.mtimeMs })
    } catch {
      /* file vanished mid-scan; skip */
    }
  }
  // Sort newest first — when an RTMsend instance crashes and is
  // re-loaded, the new file has the latest mtime and we should prefer
  // it over the abandoned one (which we'll eventually unlink on
  // probe failure).
  candidates.sort((a, b) => b.mtime - a.mtime)

  const out: RtmSendInstanceMeta[] = []
  for (const c of candidates) {
    const raw = safeReadJson(c.path)
    const meta = validateInstanceMeta(raw, c.path)
    if (meta) out.push(meta)
  }
  return out
}

// ── Single-shot JSON-RPC call ─────────────────────────────────────
let nextId = 1

interface RpcResponse<T = unknown> {
  jsonrpc: '2.0'
  id: number | null
  result?: T
  error?: { code: number; message: string }
}

export class RtmSendUnavailableError extends Error {
  constructor() {
    super('RTMsend is not running. Load RTMsend on a track in your DAW first.')
    this.name = 'RtmSendUnavailableError'
  }
}

export class RtmSendRpcError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
    this.name = 'RtmSendRpcError'
  }
}

// 5.7.1 Tier-3: structured error codes the recommendation path
// recognises. We re-export them so main.ts and the renderer can pattern-
// match without knowing the integers.
export const RtmSendErrorCodes = {
  /** JSON-RPC standard: method not implemented by this RTMsend build. */
  METHOD_NOT_FOUND: -32601,
  /** RTMsend has no plugin loaded in its slot. */
  NO_PLUGIN: -32001,
  /** Tier-3: target_fingerprint mismatch (different plugin loaded). */
  TARGET_MISMATCH: -32010,
  /** Tier-3: profile min/max version range excluded the loaded version. */
  VERSION_MISMATCH: -32011,
} as const

// 5.7.1 Tier-3: shape of the cached resolved-port. We re-resolve when
// the cached port stops responding (refused or timed-out ping), but
// reuse it across multiple successive RPC calls so a single user click
// doesn't trigger N enumerate-and-probe cycles.
interface ResolvedPort {
  meta: RtmSendInstanceMeta
  /** Wall-clock ms at which we last successfully exchanged bytes. */
  last_ok_at: number
}
let cachedResolved: ResolvedPort | null = null

// 5.7.1 v4 fix: rate-limit the FS scan inside resolveInstance(). Pre-fix
// every failed rpc() invalidated cachedResolved and the next call
// re-walked ~/.rtm (readdirSync + statSync + readFileSync × N). With
// the server hung and the renderer firing multiple IPC handlers, the
// main thread spent ~30% of its time in uv_fs_open synchronously,
// freezing the renderer (Cmd+Q couldn't even fire). The throttle
// keeps the discovery cost flat: one walk per second max, no matter
// how many concurrent failed callers we get.
const RESOLVE_THROTTLE_MS = 1000
let lastResolveAttemptAt = 0
let inFlightResolve: Promise<RtmSendInstanceMeta | null> | null = null

/**
 * 5.7.1 Tier-3: low-level single-shot RPC over a known port. Doesn't do
 * port discovery — that's `resolveInstance()`'s job. Used by both the
 * public RPC functions (after resolveInstance() returns) and by the
 * probe path inside resolveInstance() itself (to avoid re-entering it).
 *
 * auth_token: RpcServer v1.2+ requires the per-instance auth token as
 * the FIRST line sent on every new TCP connection (before any JSON-RPC
 * traffic). The server closes silently on mismatch. Legacy instances
 * (no token in the port file) receive no prefix line — they just get
 * the JSON-RPC request as before.
 */
function rpcOn<T = unknown> (port: number, method: string, params: unknown, timeoutMs: number, auth_token?: string): Promise<T> {
  const id = nextId++
  const request = JSON.stringify({ jsonrpc: '2.0', method, params, id }) + '\n'
  // Auth prefix: send token first, then the JSON-RPC request. RpcServer
  // reads exactly one line before any RPC traffic; we join them so the
  // kernel delivers both in a single TCP segment on the fast path
  // (avoids an extra round-trip on the slow-start window).
  const payload = auth_token ? (auth_token + '\n' + request) : request

  return new Promise<T>((resolve, reject) => {
    const sock = new net.Socket()
    let buf = ''
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      try { sock.destroy() } catch { /* ignore */ }
      fn()
    }
    const t = setTimeout(() => settle(() => reject(new Error(`RTMsend RPC timeout: ${method}`))), timeoutMs)

    sock.on('error', (err) => settle(() => {
      clearTimeout(t)
      reject(err)
    }))
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      const line = buf.slice(0, nl)
      let parsed: RpcResponse<T>
      try {
        parsed = JSON.parse(line)
      } catch (e: any) {
        settle(() => { clearTimeout(t); reject(new Error(`Bad JSON from RTMsend: ${e.message}`)) })
        return
      }
      if (parsed.error) {
        settle(() => { clearTimeout(t); reject(new RtmSendRpcError(parsed.error!.code, parsed.error!.message)) })
        return
      }
      settle(() => { clearTimeout(t); resolve(parsed.result as T) })
    })
    sock.on('close', () => settle(() => { clearTimeout(t); reject(new Error(`RTMsend closed the connection before replying: ${method}`)) }))

    sock.connect(port, '127.0.0.1', () => { sock.write(payload) })
  })
}

/**
 * 5.7.1 Tier-3: walk every per-instance port file (newest mtime first),
 * probe each with a host.ping in parallel-ish (sequentially-but-fast,
 * 1.5s timeout per port), and return the first reachable one. On total
 * failure, fall back to the legacy single-port file. Stale files (port
 * refused or timed out) get unlinked so the next call doesn't waste
 * time on them.
 *
 * Returns null when nothing answers — caller surfaces
 * RtmSendUnavailableError.
 */
async function resolveInstance (): Promise<RtmSendInstanceMeta | null> {
  // Cache hit: re-use the last resolved port if we used it within the
  // last 30s. Saves a probe on rapid-fire UI calls (Send button click
  // races with the connection-indicator poller). We re-validate by
  // letting the actual RPC call fail; on failure we clear the cache.
  if (cachedResolved && Date.now() - cachedResolved.last_ok_at < 30_000) {
    return cachedResolved.meta
  }

  // 5.7.1 v4: throttle + dedup the discovery walk. If a probe is
  // already in flight, wait for it instead of starting a parallel
  // walk. If we walked recently and got nothing, return null fast
  // instead of re-walking. Prevents the main-thread fs-saturation
  // hang that froze the renderer when RpcServer was unresponsive.
  if (inFlightResolve) return inFlightResolve
  const now = Date.now()
  if (now - lastResolveAttemptAt < RESOLVE_THROTTLE_MS) {
    return null  // recent walk found nothing reachable; don't re-spam
  }
  lastResolveAttemptAt = now
  inFlightResolve = doResolveInstance().finally(() => { inFlightResolve = null })
  return inFlightResolve
}

async function doResolveInstance (): Promise<RtmSendInstanceMeta | null> {

  // 5.7.1 Tier-3: try per-instance metadata files first. RTMsend 5.7.0+
  // writes one of these per loaded instance. We probe newest-first, so
  // a fresh load wins over a crashed one whose file we haven't unlinked
  // yet.
  const candidates = enumerateInstancePortFiles()
  for (const meta of candidates) {
    try {
      // host.ping is a 1-line round-trip; 1.5s is plenty. RpcServer's
      // listener thread is single-client so a contended instance might
      // queue us briefly, but ping doesn't touch the message thread.
      await rpcOn<unknown>(meta.port, 'host.ping', undefined, 1500, meta.auth_token)
      cachedResolved = { meta, last_ok_at: Date.now() }
      return meta
    } catch (e: any) {
      // 5.7.1 v3 fix: NEVER unlink port files on probe failure. Pre-fix,
      // ECONNREFUSED / ETIMEDOUT / RPC timeout would unlink the per-
      // instance file. RpcServer handles connections serially — two
      // probes that arrive within milliseconds (poll-vs-send race) make
      // one refuse, the file vanishes, and the user is permanently
      // offline until RTMsend restarts. Files leak when an instance
      // crashes; that's a much smaller cost than orphaning the live
      // connection. RTMsend's own stop() unlinks on graceful exit.
      // try the next candidate without disturbing on-disk state.
    }
  }

  // 5.7.1 Tier-3: legacy fallback for pre-5.7.0 RTMsend that doesn't
  // write a per-instance file.
  const legacy = readLegacyPortFile()
  if (legacy) {
    try {
      await rpcOn<unknown>(legacy.port, 'host.ping', undefined, 1500, legacy.auth_token)
      cachedResolved = { meta: legacy, last_ok_at: Date.now() }
      return legacy
    } catch (e: any) {
      // 5.7.1 v3 fix: same rule as per-instance — never unlink the
      // legacy file on probe failure. The cost of a momentarily
      // unreachable file is "next probe retries"; the cost of unlink
      // is "user permanently offline until RTMsend restarts".
    }
  }

  cachedResolved = null
  return null
}

/**
 * Public RPC entry. Resolves the active RTMsend instance (cached or
 * fresh probe), then delegates to rpcOn(). On RPC-level errors we
 * invalidate the cache so the next call re-discovers; transient
 * timeouts shouldn't stick.
 */
async function rpc<T = unknown> (method: string, params?: unknown, timeoutMs = 4000): Promise<T> {
  const meta = await resolveInstance()
  if (meta == null) throw new RtmSendUnavailableError()
  try {
    const result = await rpcOn<T>(meta.port, method, params, timeoutMs, meta.auth_token)
    if (cachedResolved) cachedResolved.last_ok_at = Date.now()
    return result
  } catch (e: any) {
    // ECONNREFUSED on a previously-good port means the instance died OR
    // it's just busy mid-handler (RpcServer handles one connection at a
    // time; a concurrent call lands on the listener while another is in
    // flight and gets refused). 5.7.1 fix: drop ONLY the cached
    // resolution so the next call re-discovers — DO NOT unlink the
    // port file. Pre-fix the unlink raced with the live instance: a
    // poll firing while a Send was in flight would refuse, the port
    // file would vanish, and the connection indicator would flip to
    // offline permanently until the user re-launched RTMsend. The
    // legacy fallback below already prunes truly-stale legacy files
    // when no per-instance file is reachable.
    //
    // 5.7.1 v5 HIGH fix: ALSO invalidate cache on plain RPC timeout
    // (no errno code). Pre-fix the timeout error was a plain
    // `Error('RTMsend RPC timeout: <method>')` with no .code, so it
    // fell through to `throw e` and the cache stayed pointed at the
    // dead port for the full 30 s TTL. Every call during that window
    // wasted 4–15 s blocking on a socket that would never respond.
    // Now any timeout drops the cache so the next call re-resolves.
    const code = (e as NodeJS.ErrnoException).code
    const isTimeout = e instanceof Error && /^RTMsend RPC timeout/.test(e.message)
    if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || isTimeout) {
      cachedResolved = null
      if (isTimeout) throw e  // preserve timeout message for caller
      throw new RtmSendUnavailableError()
    }
    throw e
  }
}

// ── Public surface ────────────────────────────────────────────────

export interface LoadedPlugin {
  name: string
  parameter_count: number
  sample_rate: number
  latency_samples: number
  /** 5.7.1 Tier-3: optional fields that future RTMsend builds populate.
   *  Pre-5.7.1 builds omit these — callers must treat as optional. */
  format?: string
  uid?: string
  version?: string
}

export interface ParameterSnapshot {
  index: number
  name: string
  label: string
  current: number
  default: number
  text: string
}

export interface ParameterUpdate {
  index: number
  value: number  // 0..1 normalised
}

export interface ApplyResult {
  applied: { index: number; value: number }[]
  rejected: { index: number; error: string }[]
}

export async function ping(): Promise<unknown> {
  return rpc<unknown>('host.ping')
}

export async function getLoadedPlugin(): Promise<LoadedPlugin | null> {
  return rpc<LoadedPlugin | null>('host.get_loaded_plugin')
}

export async function listParameters(): Promise<ParameterSnapshot[]> {
  return rpc<ParameterSnapshot[]>('host.list_parameters')
}

export async function findParameters(pattern: string): Promise<ParameterSnapshot[]> {
  return rpc<ParameterSnapshot[]>('host.find_parameters', { pattern })
}

export async function setParameters(updates: ParameterUpdate[]): Promise<ApplyResult> {
  // 5.7.x: 15s timeout (was 4s default). The juce-best-practices audit
  // flagged that 4s is too tight when RTMsend is mid-scan or the host
  // is busy on first cold call after session restore. setParameters
  // typically completes in <100ms but can spike to 5-10s during
  // contention. 15s gives headroom without making truly-stuck calls
  // hang forever.
  return rpc<ApplyResult>('host.set_parameters', { updates }, 15000)
}

export function isRunning(): boolean {
  // 5.7.1 Tier-3: any reachable port file (per-instance OR legacy) means
  // an instance is at least claiming to exist. Probe-time validation
  // happens in resolveInstance(); this is a synchronous sanity check
  // for code paths that need a quick gate before showing UI.
  //
  // 5.7.1 v5 HIGH fix: cache the result for 1 s. Pre-fix every 4 s
  // status poll called this synchronously (readdirSync + statSync per
  // file) BEFORE the v4 RESOLVE_THROTTLE_MS gate ran — so the FS
  // saturation that froze the renderer happened on the gate's
  // upstream side. Now isRunning() pays the FS cost at most once
  // per second.
  const nowTs = Date.now()
  if (nowTs - isRunningCache.at < 1000) return isRunningCache.value
  const present = enumerateInstancePortFiles().length > 0 || readLegacyPortFile() != null
  isRunningCache = { at: nowTs, value: present }
  return present
}
let isRunningCache: { at: number; value: boolean } = { at: 0, value: false }

// 5.7.1 Tier-3: SHA-256 of "<format>|<plugin uid>|<plugin version>|<param count>"
// matching RTMsend's RpcServer::computeTargetFingerprint(). Used for the
// recommend.eq target-fingerprint guard. If any of the optional fields
// are missing (older RTMsend that doesn't surface format/uid/version yet)
// we fall back to the parameter_count alone — better than emitting a
// fingerprint that can never match.
export function computeTargetFingerprint (loaded: LoadedPlugin): string {
  const fmt = loaded.format ?? ''
  const uid = loaded.uid ?? ''
  const ver = loaded.version ?? ''
  const cnt = String(loaded.parameter_count)
  const blob = `${fmt}|${uid}|${ver}|${cnt}`
  return crypto.createHash('sha256').update(blob, 'utf8').digest('hex')
}

/**
 * 5.7.1 Tier-3: recommend.eq method. Wraps host.set_parameters with a
 * target-fingerprint guard so a recommendation built for plugin A can't
 * silently land on plugin B (which would show parameter writes at
 * indices that mean something completely different).
 *
 * Behaviour:
 *   • Newer RTMsend that implements `recommend.eq`: receives the full
 *     payload, validates target_fingerprint against the loaded plugin,
 *     applies updates if it matches. Rejects with E_TARGET_MISMATCH or
 *     E_VERSION_MISMATCH on mismatch.
 *   • Pre-5.7.1 RTMsend: returns METHOD_NOT_FOUND. We fall through to
 *     plain host.set_parameters and let the user proceed without the
 *     guard (best-effort backwards compat).
 *
 * The caller (main.ts rtmsend-send-eq IPC) builds the payload from the
 * profile and the loaded-plugin info we already fetched, so this stays
 * a pure passthrough.
 */
export interface RecommendEqPayload {
  /** 0..1 normalised parameter writes (same shape as setParameters). */
  updates: ParameterUpdate[]
  /** SHA-256 of the loaded plugin's identity at recommendation time. */
  target_fingerprint: string
  /** Optional version-range guard. Both inclusive. Either or both may
   *  be omitted if the profile doesn't specify one. */
  min_version?: string
  max_version?: string
  /** Optional human-friendly tag for logs. The plugin name we expected. */
  expected_plugin?: string
}

export async function recommendEq (payload: RecommendEqPayload): Promise<ApplyResult> {
  // 5.7.1 Tier-3: try the new method first. If RTMsend doesn't know it
  // (pre-5.7.1 instance), fall back to plain set_parameters. Use the
  // same 15s timeout as setParameters since under the hood it does the
  // same work plus a fingerprint check.
  try {
    return await rpc<ApplyResult>('recommend.eq', payload, 15000)
  } catch (e: any) {
    if (e instanceof RtmSendRpcError && e.code === RtmSendErrorCodes.METHOD_NOT_FOUND) {
      // Legacy fallback — 5.6.x/5.7.0 RTMsend. The fingerprint guard
      // is silently disabled for these instances; the bands have
      // already been resolved against the live plugin so writing them
      // is still safe.
      return await setParameters(payload.updates)
    }
    throw e
  }
}

/**
 * 5.7.x: live connection probe used by the renderer's "Compare ↔ Send
 * connected?" indicator. Returns a structured status without throwing.
 *
 * 5.7.1 Tier-3 states:
 *   'disconnected'         — no port file or every port refused TCP
 *   'unreachable'          — TCP open but host.ping timed out (>1.5s)
 *   'connected'            — host.ping succeeded; RTMsend 5.7.1+, plugin loaded
 *   'connected_legacy'     — RTMsend pre-5.7.1; ping returns just "pong"
 *   'no_plugin'            — RTMsend running, plugin slot empty
 *   'loaded_but_no_plugin' — host.ping says plugin_loaded=false (5.7.1+)
 *   'faulted'              — host.ping says plugin_faulted=true (5.7.1+)
 *
 * Uses a short 1.5s timeout — the renderer polls this every few seconds,
 * we don't want a hung call to block the UI. On any error path we treat
 * it as "disconnected" rather than throwing, so the UI never has to
 * differentiate between "RTMsend just crashed" and "loopback firewall".
 */
export type ConnectionStatus =
  | { state: 'disconnected'; reason: string }
  | { state: 'unreachable'; reason: string }
  | { state: 'no_plugin' }
  | { state: 'loaded_but_no_plugin' }
  | { state: 'faulted'; reason?: string }
  | { state: 'connected'; plugin: string; parameter_count: number; meta?: RtmSendInstanceMeta }
  | { state: 'connected_legacy'; plugin?: string; parameter_count?: number; meta?: RtmSendInstanceMeta }

interface PingHandshake {
  // RpcServer pre-5.7.1 returns just the string "pong". RpcServer 5.7.1+
  // returns a structured object. We pattern on shape.
  ok?: boolean
  build?: string
  host_app?: string
  plugin_loaded?: boolean
  plugin_faulted?: boolean
  plugin_name?: string
  parameter_count?: number
  fault_reason?: string
}

export async function probeConnection(): Promise<ConnectionStatus> {
  // 5.7.1 Tier-3: full discovery walk. resolveInstance() handles the
  // per-instance enumeration + legacy fallback + cache + stale-file
  // cleanup. We get back a meta blob (or null) and one known-reachable
  // port. From there we ask for the rich ping payload to decide which
  // state to surface.
  const meta = await resolveInstance()
  if (meta == null) {
    return { state: 'disconnected', reason: 'RTMsend not running' }
  }

  // 5.7.1 Tier-3: rich ping handshake. RTMsend 5.7.1+ returns
  //   { ok: true, build, host_app, plugin_loaded, plugin_faulted, ... }
  // RTMsend pre-5.7.1 returns the legacy string "pong". We pattern on
  // shape rather than hitting host.ping twice.
  let pong: unknown
  try {
    pong = await rpcOn<unknown>(meta.port, 'host.ping', undefined, 1500, meta.auth_token)
  } catch (e: any) {
    // The cache might be stale — drop it so the next probe re-discovers.
    cachedResolved = null
    if (e instanceof Error && e.message.startsWith('RTMsend RPC timeout')) {
      return { state: 'unreachable', reason: 'host.ping timed out' }
    }
    return { state: 'disconnected', reason: String(e?.message ?? e).slice(0, 120) }
  }

  // Legacy "pong" string → treat as connected_legacy. We still try to
  // surface the loaded plugin name via host.get_loaded_plugin so the
  // indicator can show something useful, but a failure there isn't
  // fatal (the user just sees "RTMsend · legacy · plugin unknown").
  if (typeof pong === 'string') {
    try {
      const loaded = await rpcOn<LoadedPlugin | null>(meta.port, 'host.get_loaded_plugin', undefined, 1500, meta.auth_token)
      if (!loaded) return { state: 'no_plugin' }
      return {
        state: 'connected_legacy',
        plugin: loaded.name,
        parameter_count: loaded.parameter_count,
        meta,
      }
    } catch {
      return { state: 'connected_legacy', meta }
    }
  }

  // Structured ping (Tier-3). The plugin object's name comes from
  // either `plugin_name` (1-line ping) or a separate get_loaded_plugin
  // round-trip if the ping doesn't include it.
  const ping = (pong && typeof pong === 'object' ? pong as PingHandshake : {}) as PingHandshake

  if (ping.plugin_faulted === true) {
    return { state: 'faulted', reason: ping.fault_reason }
  }
  if (ping.plugin_loaded === false) {
    return { state: 'loaded_but_no_plugin' }
  }

  // Plugin loaded — pull the name. Prefer the ping payload (saves a
  // round-trip), fall back to host.get_loaded_plugin.
  if (ping.plugin_name && typeof ping.parameter_count === 'number') {
    return {
      state: 'connected',
      plugin: ping.plugin_name,
      parameter_count: ping.parameter_count,
      meta,
    }
  }
  try {
    const loaded = await rpcOn<LoadedPlugin | null>(meta.port, 'host.get_loaded_plugin', undefined, 1500, meta.auth_token)
    if (!loaded) return { state: 'no_plugin' }
    return {
      state: 'connected',
      plugin: loaded.name,
      parameter_count: loaded.parameter_count,
      meta,
    }
  } catch (e: any) {
    return { state: 'unreachable', reason: String(e?.message ?? e).slice(0, 120) }
  }
}

/**
 * 5.7.1 Tier-3: testing/diagnostic helper. Returns the metadata blob of
 * the currently-cached RTMsend instance, or null. Useful for the
 * "About / Debug" panel.
 */
export function getResolvedMeta (): RtmSendInstanceMeta | null {
  return cachedResolved?.meta ?? null
}

/** 5.7.1 Tier-3: drop the cached resolution. Forces the next call to
 *  re-enumerate. Call this from the renderer when the user clicks
 *  "Reconnect" in the UI. */
export function invalidateInstanceCache (): void {
  cachedResolved = null
}
