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

export interface LearnTourStep {
  /** CSS data-tour-learn selector target, e.g. '[data-tour-learn="blind-test"]' */
  selector?: string
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center'
  title: string
  body: string
}

const STEPS: LearnTourStep[] = [
  {
    selector: '[data-tour-learn="guided-steps"]',
    placement: 'bottom',
    title: 'Guided Steps',
    body: 'Nine structured listening tasks walk you from monitoring setup through delivery compliance. Each step tells you exactly which tab to check and what to listen for.',
  },
  {
    selector: '[data-tour-learn="blind-test"]',
    placement: 'center',
    title: 'Blind A/B Test',
    body: 'Lock in your predictions before any meters appear. A/B is shuffled randomly each session — you\'ll never know which file is which until you commit. Builds genuine unbiased listening.',
  },
  {
    selector: '[data-tour-learn="ear-training"]',
    placement: 'center',
    title: 'Ear Training',
    body: 'Golden Ears-style frequency ID, EQ width, compression ratio, and reverb type drills. Pink noise, your own file, or the synth mix — all at three difficulty levels.',
  },
  {
    selector: '[data-tour-learn="assignment-panel"]',
    placement: 'center',
    title: 'Assignment',
    body: 'Build a rubric with 14 metrics, set weights and thresholds, choose genre targets, then export a .rtm-assignment.json your students drop into RTMcompare before submitting.',
  },
  {
    selector: '[data-tour-learn="grade-book"]',
    placement: 'center',
    title: 'Grade Book',
    body: 'Scan your submissions folder and every .rtm-report.json appears as a graded row. Class Insights show which metric tripped up the most students. Export Canvas-ready CSV in one click.',
  },
  {
    selector: '[data-tour-learn="navigate-chip"]',
    placement: 'bottom',
    title: 'Navigate Chips',
    body: 'Gold chips at the top of each guided step tell you exactly which tab to visit. Click one and RTMcompare jumps there — no hunting.',
  },
  {
    selector: '[data-tour-learn="annotations"]',
    placement: 'bottom',
    title: 'Annotations',
    body: 'Color-coded sticky notes per tab. Add observations while you\'re listening, export them in the Student Report PDF so instructors see your reasoning.',
  },
]

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
      if (next >= STEPS.length) {
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
  }, [state])

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
          <span className="text-[9px] tracking-[0.18em] uppercase" style={{ color: 'var(--color-accent)' }}>
            Step {stepIndex + 1} of {totalSteps}
          </span>
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
