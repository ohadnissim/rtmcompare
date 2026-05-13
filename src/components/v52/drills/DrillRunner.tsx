/**
 * DrillRunner — A2 drill engine host.
 *
 * Wraps any drill exercise. Provides: attempt recording, score display,
 * reveal mechanic, and a "Next drill" / "Done" CTA. Drill exercises are
 * passed as children; they call onAnswer(score) when the user responds.
 *
 * Console Didone: ink ground, cream type, single gold gesture on the
 * primary action button.
 */

import React, { useState } from 'react'
import { recordAttempt } from '../../../lib/drillStore'

export interface DrillRunnerProps {
  drillId: string
  studentId?: string
  title: string
  eyebrow?: string
  /** Render the exercise. Call `onAnswer(score)` with a 0–100 score when done. */
  children: (onAnswer: (score: number, details?: Record<string, unknown>) => void) => React.ReactNode
  /** Called when the user exits back to LearnHome */
  onExit: () => void
  /** Called after attempt is recorded — LearnHome uses this to refresh the card */
  onAttemptRecorded?: (score: number) => void
}

const SAND_700 = 'rgba(168,161,150,0.22)'
const SAND_400 = 'var(--color-text-muted)'
const SAND_200 = '#cfc8bb'
const CREAM = 'var(--color-text-primary)'
const GOLD = 'var(--color-accent)'
const INK = 'var(--color-bg-app)'

const trackedCaps = (px: number, color: string): React.CSSProperties => ({
  fontFamily: 'var(--font-sans)',
  fontSize: px,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color,
  fontWeight: 500,
})

export function DrillRunner({
  drillId,
  studentId = 'anonymous',
  title,
  eyebrow,
  children,
  onExit,
  onAttemptRecorded,
}: DrillRunnerProps) {
  const [phase, setPhase] = useState<'active' | 'result'>('active')
  const [lastScore, setLastScore] = useState<number | null>(null)

  const handleAnswer = (score: number, details?: Record<string, unknown>) => {
    const attempt = recordAttempt({ drillId, studentId, score, correct: score >= 70, details })
    setLastScore(attempt.score)
    setPhase('result')
    onAttemptRecorded?.(score)
  }

  const handleRetry = () => {
    setPhase('active')
    setLastScore(null)
  }

  return (
    <main style={{ backgroundColor: INK, minHeight: '100vh', padding: 'clamp(28px,4vw,72px)' }}>
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 40 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {eyebrow && <div style={trackedCaps(10, SAND_400)}>{eyebrow}</div>}
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 'clamp(28px,4vw,40px)',
            color: CREAM,
            margin: 0,
            lineHeight: 1.1,
          }}>{title}</h1>
        </div>
        <button
          type="button"
          onClick={onExit}
          style={{
            ...trackedCaps(10, SAND_400),
            background: 'transparent',
            border: `1px solid ${SAND_700}`,
            borderRadius: 2,
            padding: '8px 16px',
            cursor: 'pointer',
          }}
        >
          ← Back
        </button>
      </header>

      <div style={{ borderTop: `1px solid ${SAND_700}`, marginBottom: 36 }} />

      {/* Exercise */}
      {phase === 'active' && (
        <div>{children(handleAnswer)}</div>
      )}

      {/* Result */}
      {phase === 'result' && lastScore !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28, alignItems: 'flex-start' }}>
          <div>
            <div style={trackedCaps(10, SAND_400)}>Score</div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontStyle: 'italic',
              fontWeight: 400,
              fontSize: 'clamp(56px,8vw,80px)',
              color: lastScore >= 70 ? 'var(--color-success, #6ec577)' : 'var(--color-warning, #c5a55a)',
              lineHeight: 1,
              marginTop: 4,
            }}>
              {lastScore}
            </div>
            <div style={trackedCaps(10, lastScore >= 70 ? 'var(--color-success, #6ec577)' : 'var(--color-warning, #c5a55a)')}>
              {lastScore >= 90 ? 'Excellent' : lastScore >= 70 ? 'Pass' : 'Keep practising'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="button"
              onClick={handleRetry}
              style={{
                ...trackedCaps(11, SAND_200),
                background: 'transparent',
                border: `1px solid ${SAND_700}`,
                borderRadius: 2,
                padding: '11px 24px',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={onExit}
              style={{
                ...trackedCaps(11, INK),
                background: GOLD,
                border: `1px solid ${GOLD}`,
                borderRadius: 2,
                padding: '11px 24px',
                cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </main>
  )
}

export default DrillRunner
