import React from 'react'

/**
 * DrillCard — Move 7, a single ear-training drill card.
 *
 * Ink ground, 1px sand-700 border, 2px corners. Single editorial gold gesture:
 * the "Start drill" CTA. Sparkline (left) + cumulative grade (right, gold)
 * sit at the bottom. Hero size scales the title and whitespace for the
 * "Today's drill" lead on LearnHome.
 *
 * Console Didone: no rounded-2xl, no shadows, no gradients. Instrument Serif
 * italic for the title and grade. Tracked-caps for the eyebrow and CTA.
 */

export interface DrillCardProps {
  eyebrow: string
  title: string
  body?: string
  attemptCount?: number
  recentScores?: number[]
  cumulativeGrade?: 'A' | 'B' | 'C' | 'D' | 'F'
  onStart: () => void
  size?: 'default' | 'hero'
}

const SAND_700 = 'rgba(168,161,150,0.22)'
const SAND_400 = 'var(--color-text-muted)'
const SAND_300 = 'var(--color-text-secondary)'
const SAND_200 = '#cfc8bb'
const CREAM = 'var(--color-text-primary)'
const INK = 'var(--color-bg-app)'
const GOLD = 'var(--color-accent)'

const trackedCaps = (px: number, color: string): React.CSSProperties => ({
  fontFamily: 'var(--font-sans)',
  fontSize: px,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color,
  fontWeight: 500,
})

function Sparkline({ scores }: { scores: number[] }) {
  if (!scores || scores.length < 2) return null
  const w = 60
  const h = 16
  const max = Math.max(100, ...scores)
  const min = Math.min(0, ...scores)
  const range = max - min || 1
  const step = w / (scores.length - 1)
  const pts = scores
    .map((s, i) => {
      const x = i * step
      const y = h - ((s - min) / range) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden>
      <polyline points={pts} fill="none" stroke={SAND_300} strokeWidth={1} />
    </svg>
  )
}

export function DrillCard({
  eyebrow,
  title,
  body,
  attemptCount,
  recentScores,
  cumulativeGrade,
  onStart,
  size = 'default',
}: DrillCardProps) {
  const hero = size === 'hero'
  const titleSize = hero ? 'clamp(40px, 6vw, 64px)' : 'clamp(28px, 4vw, 48px)'

  return (
    <article
      style={{
        backgroundColor: INK,
        border: `1px solid ${SAND_700}`,
        borderRadius: 2,
        padding: hero ? 'clamp(32px, 4vw, 56px)' : 32,
        display: 'flex',
        flexDirection: 'column',
        gap: hero ? 28 : 20,
        minHeight: hero ? 320 : 220,
      }}
    >
      <div style={trackedCaps(11, SAND_400)}>{eyebrow}</div>

      <h3
        style={{
          fontFamily: 'var(--font-display)',
          fontStyle: 'italic',
          fontWeight: 400,
          fontSize: titleSize,
          lineHeight: 1.04,
          color: CREAM,
          letterSpacing: '-0.01em',
          margin: 0,
        }}
      >
        {title}
      </h3>

      {body && (
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontSize: 14,
            lineHeight: 1.5,
            color: SAND_200,
            margin: 0,
            maxWidth: '52ch',
          }}
        >
          {body}
        </p>
      )}

      <div style={{ flex: 1 }} />

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
          paddingTop: 12,
          borderTop: `1px solid ${SAND_700}`,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {recentScores && recentScores.length >= 2 ? (
            <Sparkline scores={recentScores} />
          ) : (
            <div style={{ width: 60, height: 16 }} />
          )}
          <div style={trackedCaps(9, SAND_400)}>
            {typeof attemptCount === 'number' ? `${attemptCount} attempts` : 'no attempts'}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {cumulativeGrade && (
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontStyle: 'italic',
                fontSize: 24,
                lineHeight: 1,
                color: GOLD,
              }}
              aria-label={`Cumulative grade ${cumulativeGrade}`}
            >
              {cumulativeGrade}
            </div>
          )}
          <button
            type="button"
            onClick={onStart}
            style={{
              ...trackedCaps(11, INK),
              backgroundColor: GOLD,
              border: 'none',
              borderRadius: 2,
              padding: '8px 20px',
              cursor: 'pointer',
            }}
          >
            Start drill →
          </button>
        </div>
      </div>
    </article>
  )
}

export default DrillCard
