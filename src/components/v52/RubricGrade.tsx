import React from 'react'

/**
 * RubricGrade — student/teacher Move-3 rubric mark.
 *
 * Letter grade in Instrument Serif italic, 64px, single-gold accent.
 * Sits upper-right of the verdict block. Optional percentage rendered
 * below the letter in JetBrains Mono 11px sand-400.
 *
 * Console Didone: one strong move per surface — the letter itself is
 * the gesture, not a chip / pill / progress bar.
 */
export interface RubricGradeProps {
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  /** Optional percentage, rendered as tracked-caps below the letter. */
  pct?: number
}

const SAND_400 = 'var(--color-text-muted)'
const GOLD = 'var(--color-accent)'

export function RubricGrade({ grade, pct }: RubricGradeProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 4,
      }}
      aria-label={`Grade ${grade}${pct != null ? `, ${pct} percent` : ''}`}
    >
      <div
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 9,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: SAND_400,
          fontWeight: 500,
        }}
      >
        Grade
      </div>

      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontStyle: 'italic',
          fontWeight: 400,
          fontSize: 64,
          lineHeight: 1,
          color: GOLD,
          letterSpacing: '-0.02em',
        }}
      >
        {grade}
      </div>

      {pct != null && (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.02em',
            color: SAND_400,
          }}
        >
          {pct.toFixed(0)}%
        </div>
      )}
    </div>
  )
}

export default RubricGrade
