import React from 'react'
import { useAudience } from '../../AudienceContext'
import { v52Copy } from '../../copy/v52'
import { RubricGrade } from './RubricGrade'

/**
 * VerdictHero — Move 3, the four-voice verdict surface.
 *
 * Ink ground, 5-col grid. Verdict block (cols 1-3) leads with a 2px left-rule
 * in the severity colour (sage / warm-amber / warm-red), tracked-caps eyebrow,
 * then the verdict word at 96px Instrument Serif italic. The right column
 * (cols 4-5) carries three supporting metrics — and, for student/teacher,
 * a rubric letter at the top. A 4×4 gold diamond sits upper-right as the
 * single editorial gold gesture for the surface.
 *
 * Audience-varying verdict words come from `v52Copy.verdict.states[audience]`.
 * Components MUST NOT hardcode them.
 */

export type VerdictState = 'ok' | 'caution' | 'fail'

export interface VerdictHeroMetric {
  label: string
  value: string
  unit?: string
}

export interface VerdictHeroProps {
  verdict: VerdictState
  /** Eyebrow line, e.g. "MASTERING QC · 2026-05-13 · my-master-v3.wav" */
  eyebrow?: string
  /** Optional one-sentence caption beneath the verdict. */
  caption?: string
  /** 3 supporting metrics shown as a right-column stack. */
  metrics?: VerdictHeroMetric[]
  /** student/teacher only — rubric grade upper-right. */
  grade?: 'A' | 'B' | 'C' | 'D' | 'F'
  gradePct?: number
  /** teacher only — student name + submission timestamp. */
  studentName?: string
  submittedAt?: string
  /** Slot for the gold CTA. Wave-3 wires this; default empty. */
  actionSlot?: React.ReactNode
}

const SAND_700 = 'rgba(168,161,150,0.22)'
const SAND_400 = 'var(--color-text-muted)'
const SAND_300 = 'var(--color-text-secondary)'
const SAND_200 = '#cfc8bb'
const CREAM = 'var(--color-text-primary)'
const GOLD = 'var(--color-accent)'

const SEVERITY: Record<VerdictState, string> = {
  ok: '#6ec577',          // sage
  caution: '#c5a55a',     // warm-amber (Console Didone gold-family)
  fail: '#c87664',        // warm-red
}

const trackedCaps = (px: number, color: string): React.CSSProperties => ({
  fontFamily: 'var(--font-sans)',
  fontSize: px,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color,
  fontWeight: 500,
})

function MetricCell({ m }: { m: VerdictHeroMetric }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={trackedCaps(9, SAND_400)}>{m.label}</div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontStyle: 'italic',
          fontWeight: 400,
          fontSize: 36,
          lineHeight: 1,
          color: CREAM,
          letterSpacing: '-0.01em',
        }}
      >
        {m.value}
      </div>
      {m.unit && <div style={trackedCaps(9, SAND_400)}>{m.unit}</div>}
    </div>
  )
}

export function VerdictHero({
  verdict,
  eyebrow,
  caption,
  metrics,
  grade,
  gradePct,
  studentName,
  submittedAt,
  actionSlot,
}: VerdictHeroProps) {
  const audience = useAudience()
  const verdictWord = v52Copy.verdict.states[audience][verdict]
  const severity = SEVERITY[verdict]

  const showRubric = (audience === 'student' || audience === 'teacher') && grade
  const showTeacherMeta = audience === 'teacher' && (studentName || submittedAt)

  const defaultEyebrow = (() => {
    const map: Record<typeof audience, string> = {
      pro: 'MASTERING QC',
      producer: 'RELEASE-READINESS',
      student: 'PRACTICE REVIEW',
      teacher: 'SUBMISSION REVIEW',
    } as const
    return map[audience]
  })()

  return (
    <section
      aria-label="Verdict"
      className="grid grid-cols-1 md:grid-cols-5 gap-8"
      style={{
        position: 'relative',
        backgroundColor: 'var(--color-bg-app)',
        padding: 'clamp(28px, 4vw, 56px)',
        borderTop: `1px solid ${SAND_700}`,
        borderBottom: `1px solid ${SAND_700}`,
      }}
    >
      {/* Gold diamond — single gold gesture for the surface */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 18,
          right: 18,
          width: 4,
          height: 4,
          backgroundColor: GOLD,
          transform: 'rotate(45deg)',
        }}
      />

      {/* Verdict block — cols 1-3 */}
      <div
        className="md:col-span-3"
        style={{
          borderLeft: `2px solid ${severity}`,
          paddingLeft: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        <div style={trackedCaps(10, SAND_400)}>{eyebrow ?? defaultEyebrow}</div>

        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 'var(--text-verdict-hero-lg, 96px)',
            lineHeight: 0.95,
            color: CREAM,
            letterSpacing: '-0.02em',
            margin: 0,
          }}
        >
          {verdictWord}
        </h2>

        {caption && (
          <p
            style={{
              fontFamily: 'var(--font-display)',
              fontStyle: 'italic',
              fontWeight: 400,
              fontSize: 14,
              lineHeight: 1.45,
              color: SAND_200,
              margin: 0,
              maxWidth: '52ch',
            }}
          >
            {caption}
          </p>
        )}

        {actionSlot && <div style={{ marginTop: 16 }}>{actionSlot}</div>}
      </div>

      {/* Right column — cols 4-5 */}
      <aside
        className="md:col-span-2"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          alignItems: 'flex-end',
        }}
      >
        {showTeacherMeta && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
            {studentName && <div style={trackedCaps(9, SAND_400)}>{studentName}</div>}
            {submittedAt && <div style={trackedCaps(9, SAND_400)}>{submittedAt}</div>}
          </div>
        )}

        {showRubric && grade && <RubricGrade grade={grade} pct={gradePct} />}

        {metrics && metrics.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
              alignItems: 'flex-end',
              textAlign: 'right',
              width: '100%',
            }}
          >
            {metrics.slice(0, 3).map((m, i) => (
              <MetricCell key={`${m.label}-${i}`} m={m} />
            ))}
          </div>
        )}
      </aside>
    </section>
  )
}

export default VerdictHero
