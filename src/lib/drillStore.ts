/**
 * drillStore.ts — localStorage persistence for drill attempts.
 *
 * A2: Keyed by drillId × studentId × timestamp. Used by LearnHome to
 * read live attemptCount / recentScores / cumulativeGrade per card.
 */

export interface DrillAttempt {
  id: string
  drillId: string
  studentId: string
  score: number        // 0–100
  correct: boolean
  attemptedAt: string  // ISO 8601
  details?: Record<string, unknown>
}

const STORE_KEY = 'rtm-drill-attempts'
const MAX_ENTRIES = 2000
/** MED-16: bump when DrillAttempt shape changes incompatibly. On mismatch, the store resets. */
const SCHEMA_VERSION = 1

function readStore(): DrillAttempt[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    // Migration guard: if stored value is wrapped ({v, data}) with a different version, reset.
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

function writeStore(entries: DrillAttempt[]): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(entries))
  } catch { /* silently fail */ }
}

export function recordAttempt(attempt: Omit<DrillAttempt, 'id' | 'attemptedAt'>): DrillAttempt {
  const full: DrillAttempt = {
    ...attempt,
    id: crypto.randomUUID(),
    attemptedAt: new Date().toISOString(),
  }
  const entries = readStore()
  entries.unshift(full)
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES
  writeStore(entries)
  return full
}

export function getAttemptsForDrill(drillId: string, studentId?: string): DrillAttempt[] {
  return readStore().filter(a =>
    a.drillId === drillId && (studentId == null || a.studentId === studentId)
  )
}

export function getAllAttempts(studentId?: string): DrillAttempt[] {
  const all = readStore()
  return studentId ? all.filter(a => a.studentId === studentId) : all
}

/**
 * Compute cumulative letter grade from an array of scores (0–100).
 * Weighted toward recency: last 5 attempts count double.
 */
export function computeGrade(scores: number[]): string {
  if (scores.length === 0) return '—'
  const recent = scores.slice(-5)
  const older = scores.slice(0, -5)
  // Weighted average: recent 5 count double. Divide by total weight, not count.
  const weightedSum = older.reduce((a, b) => a + b, 0) + recent.reduce((a, b) => a + b * 2, 0)
  const totalWeight = older.length + recent.length * 2
  const avg = weightedSum / totalWeight
  if (avg >= 90) return 'A'
  if (avg >= 80) return 'B'
  if (avg >= 70) return 'C'
  if (avg >= 60) return 'D'
  return 'F'
}

/**
 * Summarize drill history for the LearnHome card.
 */
export function summarizeDrill(drillId: string, studentId?: string): {
  attemptCount: number
  recentScores: number[]
  cumulativeGrade?: string
} {
  const attempts = getAttemptsForDrill(drillId, studentId)
    // LOW-2: guard invalid date strings — NaN from a bad ISO string sorts unpredictably.
    .sort((a, b) => {
      const ta = new Date(a.attemptedAt).getTime()
      const tb = new Date(b.attemptedAt).getTime()
      return (isNaN(ta) ? 0 : ta) - (isNaN(tb) ? 0 : tb)
    })
  const scores = attempts.map(a => a.score)
  const recentScores = scores.slice(-10)
  return {
    attemptCount: attempts.length,
    recentScores,
    cumulativeGrade: scores.length > 0 ? computeGrade(scores) : undefined,
  }
}

export function clearAllAttempts(): void {
  try { window.localStorage.removeItem(STORE_KEY) } catch { /* noop */ }
}
