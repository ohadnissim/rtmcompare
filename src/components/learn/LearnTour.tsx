/**
 * LearnTour — guided tour for the Learn Mode panels.
 *
 * Follows the same pattern as AnalysisTour.tsx. Seven steps walk through
 * every major Learn Mode feature. Wire it into LearnCenter with:
 *
 *   const learnTour = useLearnTourState()
 *   <button onClick={learnTour.startTour}>Take tour</button>
 *   <LearnTour tour={learnTour} />
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useAudience, type Audience } from '../../AudienceContext'

export interface LearnTourStep {
  selector?: string
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center'
  title: string
  body: string
}

interface StepDef {
  selector?: string
  placement?: LearnTourStep['placement']
  title: Record<Audience, string>
  body: Record<Audience, string>
}

const STEP_DEFS: StepDef[] = [
  {
    selector: '[data-tour-learn="guided-steps"]',
    placement: 'bottom',
    title: {
      pro: 'Guided Steps',
      producer: 'Guided Workflow',
      student: 'Your Guided Steps',
      teacher: 'Student Curriculum',
    },
    body: {
      pro: 'Nine structured QC tasks — monitoring → overview → loudness → spectrum → stereo → quality → delivery → EQ match → sign-off. A systematic checklist for any mastering session.',
      producer: 'A walkthrough of every important panel in the right order. Each step says exactly what to listen for and where to look. Follow these to make sure you haven\'t missed anything.',
      student: 'Nine listening tasks that guide you through a professional mastering review, step by step. Each step tells you which tab to visit and what specific question to answer. Complete them in order.',
      teacher: 'The nine guided steps map directly to your mastering curriculum. Each step is a listening prompt you can assign or demonstrate. Students must answer the step\'s question before the next step unlocks.',
    },
  },
  {
    selector: '[data-tour-learn="blind-test"]',
    placement: 'center',
    title: {
      pro: 'Blind A/B Test',
      producer: 'Honest A/B',
      student: 'Blind Listening Test',
      teacher: 'Bias Elimination Protocol',
    },
    body: {
      pro: 'Files are shuffled randomly — you don\'t know which is which until you commit your prediction. Eliminates confirmation bias when evaluating a chain you built yourself.',
      producer: 'A/B is randomized each session so you can\'t cheat. Your preference is recorded before you know which file is the "master." Trains you to trust your ears, not your assumptions.',
      student: 'File identity is hidden until after you decide which sounds better. This removes the bias that comes from knowing which file is "supposed to be" the better one. Your blind prediction is logged to your report.',
      teacher: 'Student prediction accuracy from the blind test is the most honest measure of listening development in your class. Students who score well on analysis but poorly on blind tests are measuring, not hearing — critical insight for your teaching.',
    },
  },
  {
    selector: '[data-tour-learn="ear-training"]',
    placement: 'center',
    title: {
      pro: 'Ear Training',
      producer: 'Train Your Ears',
      student: 'Ear Training Drills',
      teacher: 'Perceptual Training Tools',
    },
    body: {
      pro: 'Frequency ID, EQ width (Q), compression ratio, and reverb type drills at three difficulty levels. Use with pink noise or your own audio.',
      producer: 'Practice hearing specific frequency boosts and cuts, compression, and reverb types in isolation — without looking at a meter. The skills that let you identify problems by ear.',
      student: 'Ear training drills develop the listening vocabulary you need to describe what you hear in technical terms. The frequency ID drill is the most important: being able to say "there\'s too much 2 kHz" is a learnable skill, not talent.',
      teacher: 'Assign 10 minutes of frequency ID drills as a class warm-up. Track score improvement over the semester — it\'s a measurable proxy for listening development. Frequency ID scores also predict how well students can give specific mix feedback.',
    },
  },
  {
    selector: '[data-tour-learn="assignment-panel"]',
    placement: 'center',
    title: {
      pro: 'Assignment Builder',
      producer: 'Assignment',
      student: 'Your Assignment',
      teacher: 'Build Your Rubric',
    },
    body: {
      pro: 'Rubric constructor for classroom deployments. 14 metrics, weighted thresholds, genre target locking, Canvas LMS REST passback. Not part of the typical pro workflow.',
      producer: 'If your instructor assigned a rubric (.rtm-assignment.json), load it here to see how your work will be graded. The rubric shows which measurements matter and what the pass thresholds are.',
      student: 'Load your teacher\'s assignment file here (.rtm-assignment.json). The rubric shows you exactly which measurements are graded, what the thresholds are, and how the points are distributed. Work to meet each threshold before submitting.',
      teacher: 'Select which of the 14 metrics to grade, set pass/fail thresholds, assign point weights, and optionally lock a genre target. Export as .rtm-assignment.json for students. Submissions auto-grade when scanned in the Grade Book.',
    },
  },
  {
    selector: '[data-tour-learn="grade-book"]',
    placement: 'center',
    title: {
      pro: 'Grade Book',
      producer: 'Grade Book',
      student: 'How You\'re Graded',
      teacher: 'Grade Book — Scan Submissions',
    },
    body: {
      pro: 'Teacher-facing tool. Batch-grades .rtm-report.json submissions against the loaded rubric. Class Insights show aggregate metric failure rates. Canvas CSV/REST export available.',
      producer: 'A teacher tool — not part of the typical producer workflow. The grade book is where instructors review submitted work.',
      student: 'Your submitted .rtm-report.json is graded automatically against the assignment rubric. The grade is computed from your measured values against each metric\'s threshold. Submit by sharing your report file with your instructor.',
      teacher: 'Scan the submissions folder to instantly grade every .rtm-report.json. The Class Insights panel shows which metric failed most often — your teaching focus for next week. One-click Canvas CSV export or direct REST passback to your LMS gradebook.',
    },
  },
  {
    selector: '[data-tour-learn="navigate-chip"]',
    placement: 'bottom',
    title: {
      pro: 'Navigate Chips',
      producer: 'Step Navigation',
      student: 'Gold Navigation Chips',
      teacher: 'Student Navigation',
    },
    body: {
      pro: 'Chips at the top of each guided step navigate directly to the relevant tab. Useful as QC anchors even in a non-classroom session.',
      producer: 'Each guided step has a chip that jumps you to the right panel. Click it — no hunting through tabs.',
      student: 'The gold chips at the top of each step tell you exactly which tab you need to visit. Click any chip and RTMcompare opens that tab immediately. This keeps you focused on the right panel at the right time.',
      teacher: 'Students who complete steps out of order often miss relationships between panels. The chips enforce the intended sequence — if a student skips a chip, they\'re not following the guided workflow. Check annotation notes to verify engagement.',
    },
  },
  {
    selector: '[data-tour-learn="annotations"]',
    placement: 'bottom',
    title: {
      pro: 'Annotations',
      producer: 'Notes per Panel',
      student: 'Your Listening Notes',
      teacher: 'Student Annotations',
    },
    body: {
      pro: 'Per-tab color-coded notes. Exported in the report PDF. Useful for session documentation, but not a core part of the pro workflow.',
      producer: 'Leave notes on each panel as you work — observations about what you\'re hearing, ideas for fixes, reminders. They\'re exported with your report PDF.',
      student: 'Write your observations here as you listen. These notes are exported in your Student Report PDF so your instructor can see your reasoning, not just your measurements. Good annotations show you\'re thinking, not just clicking.',
      teacher: 'Require at least one annotation per tab as a completion gate — it proves the student actually engaged with the panel rather than skipping through. Annotations are the most revealing part of the student report for qualitative assessment.',
    },
  },
]

function getSteps(audience: Audience): LearnTourStep[] {
  return STEP_DEFS.map(def => ({
    selector: def.selector,
    placement: def.placement,
    title: def.title[audience],
    body: def.body[audience],
  }))
}

type TourState = { kind: 'idle' } | { kind: 'running'; step: number }

export function useLearnTourState() {
  const [state, setState] = useState<TourState>({ kind: 'idle' })

  const startTour = useCallback(() => setState({ kind: 'running', step: 0 }), [])
  const stopTour = useCallback(() => {
    try { localStorage.setItem('rtm-learn-tour-done', '1') } catch {}
    setState({ kind: 'idle' })
  }, [])
  const nextStep = useCallback(() => {
    setState(s => {
      if (s.kind !== 'running') return s
      const next = s.step + 1
      if (next >= STEP_DEFS.length) {
        try { localStorage.setItem('rtm-learn-tour-done', '1') } catch {}
        return { kind: 'idle' }
      }
      return { kind: 'running', step: next }
    })
  }, [])
  const prevStep = useCallback(() => {
    setState(s => (s.kind === 'running' && s.step > 0 ? { kind: 'running', step: s.step - 1 } : s))
  }, [])

  return { state, startTour, stopTour, nextStep, prevStep, isActive: state.kind === 'running' }
}

export default function LearnTour({
  tour,
}: {
  tour: ReturnType<typeof useLearnTourState>
}) {
  const { state, stopTour, nextStep, prevStep } = tour
  const audience = useAudience()
  const STEPS = getSteps(audience)

  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (state.kind !== 'running') return
    const step = STEPS[state.step]
    const measure = () => {
      if (!step.selector) { setRect(null); return }
      const el = document.querySelector(step.selector)
      if (!el) { setRect(null); return }
      const r = el.getBoundingClientRect()
      setRect(r)
      if (r.top < 80 || r.bottom > window.innerHeight - 40) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
    const id = setTimeout(measure, 120)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      clearTimeout(id)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [state, STEPS])

  if (state.kind !== 'running') return null

  const stepIndex = state.step
  const step = STEPS[stepIndex]
  const totalSteps = STEPS.length
  const isFirst = stepIndex === 0
  const isLast = stepIndex === totalSteps - 1

  const W = typeof window !== 'undefined' ? window.innerWidth : 1200
  const H = typeof window !== 'undefined' ? window.innerHeight : 800
  const POP_W = 400
  const POP_H = 240
  const MARGIN = 24

  const clampX = (x: number) => Math.max(MARGIN, Math.min(W - POP_W - MARGIN, x))
  const clampY = (y: number) => Math.max(MARGIN, Math.min(H - POP_H - MARGIN, y))

  let popoverStyle: React.CSSProperties = {
    left: clampX(W / 2 - POP_W / 2),
    top: clampY(H / 2 - POP_H / 2),
    width: POP_W,
  }

  if (rect && step.placement && step.placement !== 'center') {
    const pad = 16
    switch (step.placement) {
      case 'top':
        popoverStyle = { left: clampX(rect.left + rect.width / 2 - POP_W / 2), top: clampY(rect.top - POP_H - pad), width: POP_W }
        break
      case 'bottom':
        popoverStyle = { left: clampX(rect.left + rect.width / 2 - POP_W / 2), top: clampY(rect.bottom + pad), width: POP_W }
        break
      case 'left':
        popoverStyle = { left: clampX(rect.left - POP_W - pad), top: clampY(rect.top + rect.height / 2 - POP_H / 2), width: POP_W }
        break
      case 'right':
        popoverStyle = { left: clampX(rect.right + pad), top: clampY(rect.top + rect.height / 2 - POP_H / 2), width: POP_W }
        break
    }
  }

  return (
    <>
      {/* Backdrop + optional cut-out — pointer-events-none */}
      <svg
        className="fixed inset-0 z-[99] pointer-events-none"
        width={W} height={H}
        style={{ width: '100vw', height: '100vh' }}
      >
        <defs>
          <mask id="rtm-learn-tour-cutout">
            <rect x={0} y={0} width={W} height={H} fill="white" />
            {rect && (
              <rect
                x={rect.left - 8}
                y={rect.top - 8}
                width={rect.width + 16}
                height={rect.height + 16}
                rx={12}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect x={0} y={0} width={W} height={H} fill="rgba(14,13,11,0.72)" mask="url(#rtm-learn-tour-cutout)" />
        {rect && (
          <rect
            x={rect.left - 8}
            y={rect.top - 8}
            width={rect.width + 16}
            height={rect.height + 16}
            rx={12}
            fill="none"
            stroke="rgba(208,176,102,0.75)"
            strokeWidth={1.5}
            style={{
              pointerEvents: 'none',
              transition: 'x 300ms cubic-bezier(0.2, 0.8, 0.2, 1), y 300ms cubic-bezier(0.2, 0.8, 0.2, 1), width 300ms cubic-bezier(0.2, 0.8, 0.2, 1), height 300ms cubic-bezier(0.2, 0.8, 0.2, 1)',
            }}
          />
        )}
      </svg>

      {/* Popover */}
      <div
        className="fixed z-[100] p-5 space-y-3"
        style={{
          ...popoverStyle,
          backgroundColor: 'var(--color-sand-900)',
          border: '1px solid rgba(208,176,102,0.35)',
          transition: 'left 300ms cubic-bezier(0.2, 0.8, 0.2, 1), top 300ms cubic-bezier(0.2, 0.8, 0.2, 1), width 300ms ease',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[9px] tracking-[0.18em] uppercase" style={{ color: 'var(--color-accent)' }}>
              Step {stepIndex + 1} of {totalSteps}
            </span>
            <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(208,176,102,0.5)', border: '1px solid rgba(208,176,102,0.2)', borderRadius: '2px', padding: '1px 4px' }}>
              {audience.toUpperCase()}
            </span>
          </div>
          <button
            onClick={stopTour}
            className="text-[10px]"
            style={{ color: 'var(--color-sand-300)' }}
          >
            Close tour
          </button>
        </div>
        <h3 className="text-base" style={{ color: '#f5f2ed', fontWeight: 500 }}>{step.title}</h3>
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-sand-300)' }}>{step.body}</p>
        {!rect && (
          <p className="text-[10px] font-display italic pt-1" style={{ color: 'var(--color-text-muted)' }}>
            You&apos;ll see this one once it shows up on screen. Keep going, or close and explore.
          </p>
        )}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: i === stepIndex ? 'var(--color-accent)' : 'var(--color-sand-600)' }} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                onClick={prevStep}
                className="text-[10px] px-3 py-1.5"
                style={{ color: 'var(--color-text-muted)', border: '1px solid rgba(168,161,150,0.2)' }}
              >
                Back
              </button>
            )}
            <button
              onClick={nextStep}
              className="text-[10px] px-4 py-1.5"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-bg-app)' }}
            >
              {isLast ? 'Got it' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
