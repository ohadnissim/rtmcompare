/**
 * Ear Training progress store — localStorage persistence + unlock logic.
 *
 * Progress is keyed per-student (using `rtm-learn-student-id` if available,
 * else 'default'). This lets multiple students share a single Mac without
 * stomping each other's stats.
 *
 * Unlock progression (Berklee/Full Sail-style):
 *   1. Start: frequency_id @ beginner is unlocked, everything else locked.
 *   2. ≥70% accuracy on current difficulty (min 12 attempts) → unlock next
 *      difficulty for that drill.
 *   3. ≥70% accuracy on advanced of any drill → unlock the next drill in the
 *      progression (frequency_id → eq_direction → q_width → compression →
 *      reverb_time → distortion).
 */

import type {
  EarTrainingProgress,
  EarTrainingDrillId,
  EarTrainingDifficulty,
  EarTrainingDrillStats,
} from '../../../types'

const STORAGE_PREFIX = 'rtm-eartraining-progress'
const MIN_ATTEMPTS_FOR_UNLOCK = 12
const ACCURACY_THRESHOLD = 0.70

/** Ordered drill progression — each unlocks after mastering the previous. */
export const DRILL_PROGRESSION: EarTrainingDrillId[] = [
  'frequency_id',
  'eq_direction',
  'q_width',
  'compression',
  'reverb_time',
  'distortion',
]

export const DIFFICULTY_ORDER: EarTrainingDifficulty[] = ['beginner', 'intermediate', 'advanced']

export const DRILL_LABELS: Record<EarTrainingDrillId, string> = {
  frequency_id: 'Frequency ID',
  eq_direction: 'EQ Direction',
  q_width:      'Q Width',
  compression:  'Compression',
  reverb_time:  'Reverb Time',
  distortion:   'Distortion',
}

export const DRILL_DESCRIPTIONS: Record<EarTrainingDrillId, string> = {
  frequency_id: 'Hear a boost or cut, name the band',
  eq_direction: 'Was that a boost or a cut?',
  q_width:      'Narrow notch or wide bell?',
  compression:  'Which version was compressed?',
  reverb_time:  'Short room or long hall?',
  distortion:   'Clean or saturated?',
}

function emptyDrillStats(): EarTrainingDrillStats {
  return {
    attempts: 0,
    correct: 0,
    perOption: {},
    lastDifficulty: 'beginner',
    streak: 0,
    bestStreak: 0,
  }
}

function defaultProgress(): EarTrainingProgress {
  const drills: Record<EarTrainingDrillId, EarTrainingDrillStats> = {} as any
  for (const id of DRILL_PROGRESSION) drills[id] = emptyDrillStats()
  const unlockedDifficulty: Record<EarTrainingDrillId, EarTrainingDifficulty> = {} as any
  for (const id of DRILL_PROGRESSION) unlockedDifficulty[id] = 'beginner'
  return {
    drills,
    unlocked: ['frequency_id'],
    unlockedDifficulty,
    totalAttempts: 0,
    totalCorrect: 0,
    lastUpdated: new Date().toISOString(),
  }
}

function storageKey(): string {
  // LOW fix: use studentName as a secondary key so two students on the same Mac
  // (same machine, no Student ID set yet) don't share progress under 'default'.
  let key = 'default'
  try {
    const sid = localStorage.getItem('rtm-learn-student-id')
    const sname = localStorage.getItem('rtm-learn-student-name')
    if (sid) key = sid
    else if (sname) key = `name-${sname.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32)}`
  } catch { /* localStorage unavailable */ }
  return `${STORAGE_PREFIX}-${key}`
}

export function loadProgress(): EarTrainingProgress {
  try {
    const raw = localStorage.getItem(storageKey())
    if (!raw) return defaultProgress()
    const parsed = JSON.parse(raw) as Partial<EarTrainingProgress>
    // Merge with defaults so older saves don't crash when we add new drills.
    const base = defaultProgress()
    return {
      drills: { ...base.drills, ...(parsed.drills ?? {}) } as any,
      unlocked: parsed.unlocked && parsed.unlocked.length > 0
        ? parsed.unlocked
        : base.unlocked,
      unlockedDifficulty: { ...base.unlockedDifficulty, ...(parsed.unlockedDifficulty ?? {}) } as any,
      totalAttempts: parsed.totalAttempts ?? 0,
      totalCorrect: parsed.totalCorrect ?? 0,
      lastUpdated: parsed.lastUpdated ?? new Date().toISOString(),
    }
  } catch {
    return defaultProgress()
  }
}

export function saveProgress(p: EarTrainingProgress) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(p))
  } catch { /* storage full / unavailable — fine */ }
}

/** Record a single drill attempt and return the updated progress.
 *  Handles unlock progression automatically. */
export function recordAttempt(
  progress: EarTrainingProgress,
  drill: EarTrainingDrillId,
  difficulty: EarTrainingDifficulty,
  optionId: string,
  correct: boolean
): EarTrainingProgress {
  const next: EarTrainingProgress = JSON.parse(JSON.stringify(progress))
  const stats = next.drills[drill]
  stats.attempts++
  stats.lastDifficulty = difficulty
  if (correct) {
    stats.correct++
    stats.streak++
    if (stats.streak > stats.bestStreak) stats.bestStreak = stats.streak
  } else {
    stats.streak = 0
  }
  const perOpt = stats.perOption[optionId] ?? { attempts: 0, correct: 0 }
  perOpt.attempts++
  if (correct) perOpt.correct++
  stats.perOption[optionId] = perOpt

  next.totalAttempts++
  if (correct) next.totalCorrect++
  next.lastUpdated = new Date().toISOString()

  // ── Unlock checks ─────────────────────────────────────────────
  // 1. Bump difficulty if accuracy at current difficulty is high.
  if (stats.attempts >= MIN_ATTEMPTS_FOR_UNLOCK) {
    const accuracy = stats.correct / stats.attempts
    if (accuracy >= ACCURACY_THRESHOLD) {
      const currIdx = DIFFICULTY_ORDER.indexOf(next.unlockedDifficulty[drill])
      const completedIdx = DIFFICULTY_ORDER.indexOf(difficulty)
      if (completedIdx >= currIdx && currIdx < DIFFICULTY_ORDER.length - 1) {
        next.unlockedDifficulty[drill] = DIFFICULTY_ORDER[currIdx + 1]
      }
      // 2. If they cleared advanced of this drill, unlock the next drill in the chain.
      if (difficulty === 'advanced' && accuracy >= ACCURACY_THRESHOLD) {
        const drillIdx = DRILL_PROGRESSION.indexOf(drill)
        if (drillIdx >= 0 && drillIdx < DRILL_PROGRESSION.length - 1) {
          const nextDrill = DRILL_PROGRESSION[drillIdx + 1]
          if (!next.unlocked.includes(nextDrill)) next.unlocked.push(nextDrill)
        }
      }
    }
  }

  return next
}

/** Reset all progress (back to starting state). */
export function resetProgress(): EarTrainingProgress {
  const fresh = defaultProgress()
  saveProgress(fresh)
  return fresh
}

/** Compute the overall accuracy across all drills. */
export function overallAccuracy(p: EarTrainingProgress): number {
  return p.totalAttempts > 0 ? p.totalCorrect / p.totalAttempts : 0
}

/** Compute accuracy for a single drill. */
export function drillAccuracy(s: EarTrainingDrillStats): number {
  return s.attempts > 0 ? s.correct / s.attempts : 0
}

/** Return the per-band heat map for the frequency_id drill — sorted by accuracy ascending
 *  so the weakest bands surface first. */
export function weakBands(
  p: EarTrainingProgress,
  drill: EarTrainingDrillId = 'frequency_id'
): Array<{ option: string; accuracy: number; attempts: number }> {
  const s = p.drills[drill]
  if (!s) return []
  return Object.entries(s.perOption)
    .filter(([, v]) => v.attempts >= 3)  // need enough samples
    .map(([option, v]) => ({
      option,
      accuracy: v.correct / v.attempts,
      attempts: v.attempts,
    }))
    .sort((a, b) => a.accuracy - b.accuracy)
}
