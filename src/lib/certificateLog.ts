/**
 * certificateLog.ts — local ledger of issued certificates.
 *
 * Each call to logCertificate() appends a row to localStorage under
 * the key 'rtm-certificate-log'. Rows are capped at MAX_LOG_ENTRIES
 * (200) — oldest entries are dropped silently.
 *
 * A4: every printProCertificate / printReleaseCard / printPracticeReport
 * call that reaches printCertificate() should call logCertificate() so
 * issuances are never lost.
 */

export interface CertificateLogEntry {
  certId: string
  shaTrunc: string
  trackTitle: string
  audience: string
  verdict: string
  metrics: Array<{ label: string; value: string; unit?: string }>
  issuedAt: string  // ISO 8601
}

const LOG_KEY = 'rtm-certificate-log'
const MAX_LOG_ENTRIES = 200
/** MED-16: bump when CertificateLogEntry shape changes incompatibly. */
const SCHEMA_VERSION = 1

function readLog(): CertificateLogEntry[] {
  try {
    const raw = window.localStorage.getItem(LOG_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (parsed !== null && !Array.isArray(parsed)) {
      if (typeof parsed === 'object' && (parsed as any).v !== SCHEMA_VERSION) return []
      if (typeof parsed === 'object' && Array.isArray((parsed as any).data)) return (parsed as any).data
      return []
    }
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeLog(entries: CertificateLogEntry[]): void {
  try {
    window.localStorage.setItem(LOG_KEY, JSON.stringify(entries))
  } catch {
    // localStorage full or unavailable — fail silently
  }
}

/**
 * Append a certificate issuance to the local log.
 * Non-throwing: failures are silently swallowed.
 */
export function logCertificate(entry: CertificateLogEntry): void {
  try {
    const log = readLog()
    log.unshift(entry) // newest first
    if (log.length > MAX_LOG_ENTRIES) log.length = MAX_LOG_ENTRIES
    writeLog(log)
  } catch {
    // silently fail — never block a print path
  }
}

/**
 * Return all logged certificates, newest first.
 */
export function getCertificateLog(): CertificateLogEntry[] {
  return readLog()
}

/**
 * Clear the entire log.
 */
export function clearCertificateLog(): void {
  try {
    window.localStorage.removeItem(LOG_KEY)
  } catch { /* noop */ }
}
