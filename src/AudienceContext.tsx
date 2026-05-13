/**
 * AudienceContext — single source of truth for "who is using RTMcompare right now."
 *
 * Four audiences drive copy, layout density, and verdict vocabulary:
 *   - 'pro'      — mastering engineer / power user. Default.
 *   - 'producer' — release-ready creator (indie / bedroom / label A&R).
 *   - 'student'  — Learn Mode + role=student.
 *   - 'teacher'  — Learn Mode + role=teacher.
 *
 * Signal mapping (priority order):
 *   1. localStorage `rtm-audience` override (testing / Storybook).
 *   2. LearnMode.enabled && role === 'teacher' → 'teacher'
 *   3. LearnMode.enabled && role === 'student' → 'student'
 *   4. localStorage `rtm-persona` === 'producer' → 'producer'
 *      (no first-class producer signal exists yet — exposed for the
 *      forthcoming onboarding picker.)
 *   5. Default → 'pro'.
 *
 * SSR-safe: returns 'pro' when `window` is undefined.
 */

import { useSyncExternalStore } from 'react'
import { useLearnMode } from './context/LearnModeContext'
import type { LearnModeState } from './types'

export type Audience = 'pro' | 'producer' | 'student' | 'teacher'

const AUDIENCE_KEY = 'rtm-audience'
const PERSONA_KEY = 'rtm-persona'
const SSR = typeof window === 'undefined'

function isAudience(v: unknown): v is Audience {
  return v === 'pro' || v === 'producer' || v === 'student' || v === 'teacher'
}

function readStorage(key: string): string | null {
  if (SSR) return null
  try { return window.localStorage.getItem(key) } catch { return null }
}

function subscribeStorage(cb: () => void): () => void {
  if (SSR) return () => {}
  window.addEventListener('storage', cb)
  return () => window.removeEventListener('storage', cb)
}

function snapshot(): string {
  return `${readStorage(AUDIENCE_KEY) ?? ''}|${readStorage(PERSONA_KEY) ?? ''}`
}

/**
 * Resolve the current audience. SSR-safe.
 *
 * Calls `useLearnMode()` inside a try/catch wrapper: if a caller renders
 * outside <LearnModeProvider>, we degrade to non-Learn resolution rather
 * than throwing.
 */
export function useAudience(): Audience {
  // Hooks must run unconditionally. useSyncExternalStore is safe on SSR
  // (returns the server snapshot).
  useSyncExternalStore(subscribeStorage, snapshot, () => '')

  let learn: LearnModeState | null = null
  try {
    learn = useLearnMode()
  } catch {
    learn = null
  }

  if (SSR) return 'pro'

  // 1. Explicit override.
  const override = readStorage(AUDIENCE_KEY)
  if (isAudience(override)) return override

  // 2 & 3. Learn Mode role.
  if (learn?.enabled) {
    return learn.role === 'teacher' ? 'teacher' : 'student'
  }

  // 4. Producer persona flag.
  if (readStorage(PERSONA_KEY) === 'producer') return 'producer'

  // 5. Default.
  return 'pro'
}

/**
 * Per-surface v5.2 promotion. Mirror of FLOW's `useV11Surface`.
 *
 *   - `rtm-shell` === 'v5.2' promotes every surface globally.
 *   - `rtm-v52-surfaces` is a comma-separated allow-list, e.g. "cover,verdict".
 */
export function useV52Surface(name: string): boolean {
  if (SSR) return false
  try {
    const global = window.localStorage.getItem('rtm-shell') === 'v5.2'
    const surfaces = (window.localStorage.getItem('rtm-v52-surfaces') || '')
      .split(',')
      .map(s => s.trim())
    return global || surfaces.includes(name)
  } catch {
    return false
  }
}
