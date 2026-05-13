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
 * Imperative setter for the audience override.
 *
 * Writes (or clears) `localStorage['rtm-audience']` and fires a synthetic
 * `storage` event so same-tab `useAudience()` subscribers re-render. The
 * native `storage` event only fires in OTHER tabs, so we dispatch one
 * ourselves for the current tab.
 *
 * Pass `null` to clear the override and fall back to the signal chain.
 */
export function setAudienceOverride(audience: Audience | null): void {
  if (SSR) return
  try {
    if (audience === null) {
      window.localStorage.removeItem(AUDIENCE_KEY)
    } else {
      window.localStorage.setItem(AUDIENCE_KEY, audience)
    }
    // Same-tab notification — useSyncExternalStore in useAudience listens on storage events.
    window.dispatchEvent(new StorageEvent('storage', { key: AUDIENCE_KEY, newValue: audience }))
  } catch {}
}

/**
 * Per-surface v5.2 promotion. Mirror of FLOW's `useV11Surface`.
 *
 *   - `rtm-shell` === 'v5.2'     promotes every surface globally.
 *   - `rtm-shell` === 'legacy'   forces every surface OFF (full opt-out).
 *   - `rtm-v52-surfaces`         comma-separated allow-list, e.g. "cover,verdict".
 *   - `rtm-v52-surfaces-off`     comma-separated DENY-list, takes precedence.
 *
 * Defaults (no flags set):
 *   - `cover` → ON. The editorial cover is the canonical first-paint
 *     surface as of v5.2; a fresh install lands here in pro mode.
 *   - every other surface → OFF until explicitly promoted.
 *
 * Opt-out: set `rtm-shell=legacy`, or add the surface name to
 * `rtm-v52-surfaces-off`.
 */
const SURFACES_ON_BY_DEFAULT = new Set([
  'cover',         // editorial first-paint — on since v5.2 launch
  'gold-budget',   // surgical reskin, low risk — B6 promote
  'verdict',       // VerdictHero renders cleanly across ok/caution/fail — B6 promote
])

export function useV52Surface(name: string): boolean {
  if (SSR) return false
  try {
    const shell = window.localStorage.getItem('rtm-shell')
    if (shell === 'legacy') return false
    if (shell === 'v5.2') return true
    const off = (window.localStorage.getItem('rtm-v52-surfaces-off') || '')
      .split(',').map(s => s.trim()).filter(Boolean)
    if (off.includes(name)) return false
    const on = (window.localStorage.getItem('rtm-v52-surfaces') || '')
      .split(',').map(s => s.trim()).filter(Boolean)
    if (on.includes(name)) return true
    return SURFACES_ON_BY_DEFAULT.has(name)
  } catch {
    return SURFACES_ON_BY_DEFAULT.has(name)
  }
}
