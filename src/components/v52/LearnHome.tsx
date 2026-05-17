import React, { useState } from 'react'
import { DrillCard, type DrillCardProps } from './DrillCard'
import { printPracticeReport } from '../../lib/certificate'
import { summarizeDrill } from '../../lib/drillStore'
import { DrillRunner } from './drills/DrillRunner'
import { GlossaryBrowser } from '../learn/GlossaryBrowser'

/**
 * LearnHome — Move 7, the student's home screen for Learn Mode.
 *
 * Editorial header, one hero "Today's drill" card, and a 2-col grid of the
 * remaining drills. Ink ground. Single gold per surface lives inside each
 * DrillCard's Start CTA — the home page itself has no chrome gold.
 *
 * Drill data is seeded statically for v5.2 Move 7. Real drill plumbing
 * ships in Wave 3.
 */

const SAND_700 = 'rgba(168,161,150,0.22)'
const SAND_400 = 'var(--color-text-muted)'
const SAND_200 = '#cfc8bb'
const CREAM = 'var(--color-text-primary)'
const INK = 'var(--color-bg-app)'

const trackedCaps = (px: number, color: string): React.CSSProperties => ({
  fontFamily: 'var(--font-sans)',
  fontSize: px,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color,
  fontWeight: 500,
})

const SEED_DRILLS_BASE: Array<Omit<DrillCardProps, 'onStart' | 'attemptCount' | 'recentScores' | 'cumulativeGrade'>> = [
  {
    eyebrow: 'EAR TRAINING · LUFS GUESSING',
    title: 'Match the integrated loudness',
    body: 'Listen, guess, then reveal. Build LUFS intuition.',
  },
  {
    eyebrow: 'EAR TRAINING · STEREO IMAGE',
    title: 'Hear the width',
    body: 'Mono · Mid · Side · Stereo — identify the active channel.',
  },
  {
    eyebrow: 'EAR TRAINING · MASKING',
    title: 'Spot the collision',
    body: 'Two tracks fighting at 250 Hz. Which is which?',
  },
  {
    eyebrow: 'MIX CRITIQUE · BALANCE',
    title: 'Find the problem',
    body: 'Real masters. One thing is off. Identify it before the reveal.',
  },
  {
    eyebrow: 'EAR TRAINING · TRUE PEAK',
    title: 'When does it clip?',
    body: 'Hear inter-sample peaks before the meters catch them.',
  },
  {
    eyebrow: 'EAR TRAINING · GENRE LOUDNESS',
    title: 'Genre profile recognition',
    body: 'Pop · Hip-hop · Classical · EDM — match the LUFS-I distribution to its genre.',
  },
]

const GRADE_VALUES = ['A', 'B', 'C', 'D', 'F'] as const
type GradeLetter = typeof GRADE_VALUES[number]

function toGradeLetter(g: string | undefined): GradeLetter | undefined {
  if (!g) return undefined
  return (GRADE_VALUES as readonly string[]).includes(g) ? g as GradeLetter : undefined
}

function buildDrills(studentId?: string): Omit<DrillCardProps, 'onStart'>[] {
  return SEED_DRILLS_BASE.map(d => {
    const summary = summarizeDrill(d.eyebrow, studentId)
    return {
      ...d,
      attemptCount: summary.attemptCount,
      recentScores: summary.recentScores,
      cumulativeGrade: toGradeLetter(summary.cumulativeGrade),
    }
  })
}

/**
 * Pick a "next" drill: prefer something with zero attempts, otherwise the
 * lowest-grade drill. Pure-function recommender — no backend call.
 */
function pickHeroIndex(drills: Omit<DrillCardProps, 'onStart'>[]): number {
  const zeroIdx = drills.findIndex(d => (d.attemptCount ?? 0) === 0)
  if (zeroIdx >= 0) return zeroIdx
  const gradeRank: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 }
  let worst = 0
  let worstRank = Infinity
  drills.forEach((d, i) => {
    const r = d.cumulativeGrade ? gradeRank[d.cumulativeGrade] : 6
    if (r < worstRank) {
      worstRank = r
      worst = i
    }
  })
  return worst
}

export function LearnHome() {
  const [activeDrill, setActiveDrill] = useState<Omit<DrillCardProps, 'onStart'> | null>(null)
  const [drillRevision, setDrillRevision] = useState(0)

  const SEED_DRILLS = buildDrills()
  const heroIdx = pickHeroIndex(SEED_DRILLS)
  const hero = SEED_DRILLS[heroIdx]
  const rest = SEED_DRILLS.filter((_, i) => i !== heroIdx)

  // Silence unused warning — drillRevision triggers re-render after attempt
  void drillRevision

  if (activeDrill) {
    return (
      <DrillRunner
        drillId={activeDrill.eyebrow}
        title={activeDrill.title}
        eyebrow={activeDrill.eyebrow}
        onExit={() => setActiveDrill(null)}
        onAttemptRecorded={() => setDrillRevision(r => r + 1)}
      >
        {() => (
          <div style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontSize: 18,
            color: 'var(--color-text-secondary)',
            padding: '32px 0',
          }}>
            Drill: <em>{activeDrill.title}</em> — coming in Wave 3
          </div>
        )}
      </DrillRunner>
    )
  }

  // v5.2 Wave 3 — surface a "Save practice report" affordance when there's
  // a recent attempt. Seed values; real wiring comes when drills actually
  // run. One tracked-caps link, no gold — the per-drill Start CTA holds
  // the gold for this view.
  const lastAttempt = [...SEED_DRILLS]
    .filter(d => (d.attemptCount ?? 0) > 0 && d.cumulativeGrade)
    .sort((a, b) => (b.attemptCount ?? 0) - (a.attemptCount ?? 0))[0]
  const handleSaveReport = async () => {
    if (!lastAttempt) return
    await printPracticeReport({
      trackTitle: lastAttempt.title,
      metaLine: lastAttempt.eyebrow,
      verdict: 'ok',
      metrics: [],
      studentName: '—',
      assignment: lastAttempt.eyebrow,
      grade: lastAttempt.cumulativeGrade ?? 'B',
    })
  }

  const startDrill = (drill: Omit<DrillCardProps, 'onStart'>) => () => {
    setActiveDrill(drill)
  }

  return (
    <main
      style={{
        backgroundColor: INK,
        minHeight: '100vh',
        padding: 'clamp(28px, 4vw, 72px)',
      }}
    >
      {/* Editorial header */}
      <header style={{ display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 48 }}>
        <div style={trackedCaps(11, SAND_400)}>LEARN · DRILLS</div>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 'clamp(40px, 7vw, 64px)',
            lineHeight: 1.02,
            color: CREAM,
            letterSpacing: '-0.015em',
            margin: 0,
            maxWidth: '14ch',
          }}
        >
          Train your ears.
        </h1>
        <div style={{ width: '30%', height: 1, backgroundColor: SAND_700 }} />
        {lastAttempt && (
          <button
            type="button"
            onClick={handleSaveReport}
            style={{
              ...trackedCaps(10, SAND_200),
              background: 'transparent',
              border: 'none',
              padding: 0,
              alignSelf: 'flex-start',
              cursor: 'pointer',
              marginTop: 2,
            }}
          >
            Last attempt: {lastAttempt.cumulativeGrade ?? '—'} ·{' '}
            <span style={{ color: SAND_400 }}>Save practice report →</span>
          </button>
        )}
      </header>

      {/* Today's drill — hero card */}
      <section style={{ marginBottom: 56 }}>
        <div style={{ ...trackedCaps(10, SAND_400), marginBottom: 14 }}>TODAY'S DRILL</div>
        <DrillCard {...hero} size="hero" onStart={startDrill(hero)} />
      </section>

      {/* Grid of remaining drills */}
      <section>
        <div style={{ ...trackedCaps(10, SAND_400), marginBottom: 14 }}>ALL DRILLS</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {rest.map(d => (
            <DrillCard key={d.title} {...d} onStart={startDrill(d)} />
          ))}
        </div>
      </section>

      {/* Glossary Browser */}
      <div style={{ marginTop: 24 }}>
        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 9,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--color-text-muted)',
          }}>REFERENCE · GLOSSARY</span>
          <span style={{ fontSize: 11, color: 'var(--color-sand-400)' }}>
            — 29 metrics explained for every level
          </span>
        </div>
        <GlossaryBrowser />
      </div>

      {/* Editorial close */}
      <footer
        style={{
          marginTop: 72,
          paddingTop: 24,
          borderTop: `1px solid ${SAND_700}`,
          ...trackedCaps(10, SAND_400),
        }}
      >
        <span style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 14, color: SAND_200, textTransform: 'none', letterSpacing: 0 }}>
          One drill a day. Ears get sharper before opinions do.
        </span>
      </footer>
    </main>
  )
}

export default LearnHome
