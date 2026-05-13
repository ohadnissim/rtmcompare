/**
 * v52.ts — canonical copy bank for RTMcompare v5.2 audience-aware surfaces.
 *
 * Single source of truth for every string that varies by audience
 * (pro / producer / student / teacher). Components MUST NOT hardcode
 * audience-varying copy — reach into `v52Copy.<surface>.<field>[audience]`.
 *
 * See `.rtm-design/v5.2-copy-bank.md` for conventions and the process for
 * adding a new surface or audience.
 */

export type Audience = 'pro' | 'producer' | 'student' | 'teacher'

/** Context passed to greeting / signature templating functions. */
export interface GreetingCtx {
  name?: string
  /** Period count — "sessions this week", "tracks this month", etc. */
  n?: number
  course?: string
  assignment?: string
}

export interface CertificateCtx {
  engineer?: string
  version?: string
  title?: string
  label?: string
  studentName?: string
  assignment?: string
  grade?: string | number
  teacherName?: string
  course?: string
  date?: string
}

type ByAudience<T> = Record<Audience, T>

interface CoverCopy {
  eyebrow: ByAudience<string>
  valueProp: ByAudience<string>
  greeting: ByAudience<(c: GreetingCtx) => string>
}

interface VerdictStates {
  ok: string
  caution: string
  fail: string
}

interface VerdictCopy {
  states: ByAudience<VerdictStates>
}

interface CtaCopy {
  primary: ByAudience<string>
  secondary: ByAudience<string>
}

interface CertificateCopy {
  masthead: ByAudience<string>
  signature: ByAudience<(c: CertificateCtx) => string>
}

export interface V52Copy {
  cover: CoverCopy
  verdict: VerdictCopy
  cta: CtaCopy
  certificate: CertificateCopy
}

export const v52Copy: V52Copy = {
  cover: {
    eyebrow: {
      pro: 'MASTERING QC · LEVEL-MATCHED',
      producer: 'RELEASE-READINESS · ONE LOOK',
      student: 'LISTEN · COMPARE · UNDERSTAND',
      teacher: 'ASSIGNMENT WORKSPACE',
    },
    valueProp: {
      pro: 'Compare. Catch. Deliver.',
      producer: 'Drop your track. See where it stands.',
      student: 'Train your ears. Read your meters.',
      teacher: 'Set the brief. See the answers.',
    },
    greeting: {
      pro: (c) => `Hi, ${c.name ?? 'engineer'}. ${c.n ?? 0} sessions this week.`,
      producer: (c) => `Hi, ${c.name ?? 'producer'}. ${c.n ?? 0} tracks this month.`,
      student: (c) => `Hi, ${c.name ?? 'student'}. Course: ${c.course ?? '—'}. Assignment ${c.assignment ?? '—'}.`,
      teacher: (c) => `Hi, ${c.name ?? 'instructor'}. ${c.n ?? 0} pending submissions.`,
    },
  },
  verdict: {
    states: {
      pro:      { ok: 'READY',         caution: 'HOLD',           fail: 'FIX' },
      producer: { ok: 'RELEASE-READY', caution: 'ONE MORE PASS',  fail: 'NOT YET' },
      student:  { ok: 'STRONG',        caution: 'DEVELOPING',     fail: 'RETRY' },
      teacher:  { ok: 'APPROVED',      caution: 'NEEDS REVIEW',   fail: 'RESUBMIT' },
    },
  },
  cta: {
    primary: {
      pro: 'Export final master',
      producer: 'Master for release',
      student: 'Submit assignment',
      teacher: 'Approve',
    },
    secondary: {
      pro: 'Generate certificate',
      producer: 'Generate release card',
      student: 'Save practice report',
      teacher: 'Return for revision',
    },
  },
  certificate: {
    masthead: {
      pro: 'MASTERING QC CERTIFICATE',
      producer: 'RELEASE-READY',
      student: 'PRACTICE REPORT',
      teacher: 'ASSIGNMENT GRADEBOOK',
    },
    signature: {
      pro: (c) => `Mastered by ${c.engineer ?? '—'} · QC by RTMcompare ${c.version ?? ''}`.trim(),
      producer: (c) => `Track: ${c.title ?? '—'} · Released by ${c.label ?? '—'}`,
      student: (c) => `${c.studentName ?? '—'} · ${c.assignment ?? '—'} · Grade ${c.grade ?? '—'}`,
      teacher: (c) => `${c.teacherName ?? '—'} · ${c.course ?? '—'} · ${c.date ?? ''}`.trim(),
    },
  },
}

/**
 * Convenience lookup. Generic-preserving so callers get autocomplete on
 * the field name AND a precisely-typed return value.
 *
 *   pickV52('cover', 'valueProp', 'producer')
 *     → 'Drop your track. See where it stands.'
 *   pickV52('cover', 'greeting', 'student')
 *     → (c: GreetingCtx) => string
 */
export function pickV52<
  S extends keyof V52Copy,
  F extends keyof V52Copy[S],
>(surface: S, field: F, audience: Audience): V52Copy[S][F] extends ByAudience<infer T> ? T : never {
  const node = (v52Copy[surface] as unknown as Record<string, unknown>)[field as string] as ByAudience<unknown>
  return node[audience] as V52Copy[S][F] extends ByAudience<infer T> ? T : never
}
