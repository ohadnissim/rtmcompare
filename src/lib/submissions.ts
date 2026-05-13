/**
 * submissions.ts — local-first student submission store.
 *
 * A1: Persists to localStorage under 'rtm-submissions'. Each submission
 * carries the student's analysis result, assignment context, verdict,
 * and an ISO timestamp. The teacher dashboard reads and sorts this list.
 *
 * In a multi-student setup the teacher would run a shared folder scan
 * (electronAPI.scanClassFolder) which writes .rtm-report.json sidecars.
 * This module handles the single-device demo path: student submits on
 * the same machine, teacher views the roster in the same session.
 */

import type { StudentSubmission, Verdict } from '../components/v52/TeacherDashboard'

const STORE_KEY = 'rtm-submissions'
const MAX_ENTRIES = 500
/** MED-16: bump when StudentSubmission shape changes incompatibly. */
const SCHEMA_VERSION = 1

function readStore(): StudentSubmission[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
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

function writeStore(entries: StudentSubmission[]): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(entries))
  } catch { /* silently fail if localStorage full */ }
}

/**
 * Add or update a submission. Matching on `id` — if an entry with the
 * same id exists it is replaced (re-submission flow).
 */
export function upsertSubmission(sub: StudentSubmission): void {
  const entries = readStore()
  const idx = entries.findIndex(e => e.id === sub.id)
  if (idx >= 0) {
    entries[idx] = sub
  } else {
    entries.unshift(sub)
    if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES
  }
  writeStore(entries)
}

/**
 * Return all submissions sorted newest-first.
 */
export function getSubmissions(): StudentSubmission[] {
  return readStore().sort((a, b) =>
    new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  )
}

/**
 * Delete a submission by id.
 */
export function deleteSubmission(id: string): void {
  writeStore(readStore().filter(e => e.id !== id))
}

/**
 * Clear all submissions.
 */
export function clearSubmissions(): void {
  try { window.localStorage.removeItem(STORE_KEY) } catch { /* noop */ }
}

/**
 * Build a new StudentSubmission from an analysis result.
 * Called when a student in Learn mode completes an analysis.
 */
export function buildSubmission(params: {
  studentName: string
  assignment: string
  verdict: Verdict
  verdictWord?: string
  metrics?: StudentSubmission['metrics']
}): StudentSubmission {
  return {
    id: crypto.randomUUID(),
    studentName: params.studentName,
    assignment: params.assignment,
    submittedAt: new Date().toISOString(),
    verdict: params.verdict,
    verdictWord: params.verdictWord,
    recentVerdicts: [params.verdict],
    metrics: params.metrics,
  }
}
