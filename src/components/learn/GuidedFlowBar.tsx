/**
 * GuidedFlowBar — step-by-step guided progress bar for Learn Mode.
 *
 * Renders sticky just below the header (top: 92px = 28px drag + 64px header).
 * Only visible when learn mode is enabled. Shows 9 step pills in a scrollable
 * row, the current step question, and Prev / Next navigation.
 */

import React from 'react'
import { useLearnMode, GUIDED_STEPS } from '../../context/LearnModeContext'
import AssignmentPanel from './AssignmentPanel'
import ClassGradeBook from './ClassGradeBook'
import BlindTestPanel from './BlindTestPanel'

interface Props {
  /** Called when a step pill is clicked — callers use this to navigate tabs */
  onNavigate: (tabId: string) => void
  /** Optional reference file path — forwarded to AssignmentPanel for the lock toggle */
  referenceFilePath?: string | null
  /** File A display name — forwarded to BlindTestPanel */
  fileAName?: string
  /** File B display name — forwarded to BlindTestPanel */
  fileBName?: string
  /** Current analysis result — forwarded to BlindTestPanel for reveal comparison */
  analysisResult?: any
}

function StudentReportExportTrigger() {
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent('rtm-learn-export-report'))}
      style={{
        background: 'rgba(208,176,102,0.1)',
        border: '1px solid rgba(208,176,102,0.5)',
        borderRadius: '2px',
        color: 'var(--color-text-primary)',
        fontSize: 10,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        padding: '5px 12px',
        cursor: 'pointer',
      }}
    >
      Export Report →
    </button>
  )
}

export default function GuidedFlowBar({
  onNavigate,
  referenceFilePath,
  fileAName,
  fileBName,
  analysisResult,
}: Props) {
  const { enabled, step, setStep, nextStep, prevStep, role, setAssignment, assignment, blindTest } = useLearnMode()
  const [showAssignmentPanel, setShowAssignmentPanel] = React.useState(false)
  const [showGradeBook, setShowGradeBook] = React.useState(false)
  const [completed, setCompleted] = React.useState(false)
  const [blindTestOpen, setBlindTestOpen] = React.useState(false)
  const [helpOpen, setHelpOpen] = React.useState(false)

  // --- Derived values and memos MUST come before any early return (Rules of Hooks) ---
  const currentStep = GUIDED_STEPS[step]

  const stepQuestion = React.useMemo(() => {
    if (currentStep?.id === 'dynamics' && (assignment as any)?.genre) {
      const genreLraGuide: Record<string, string> = {
        'Pop': '4–7 LU',
        'EDM / Electronic': '4–6 LU',
        'Rock': '8–12 LU',
        'Hip-Hop / R&B': '6–9 LU',
        'Jazz': '10–14 LU',
        'Classical / Orchestral': '14–20 LU',
        'Folk / Acoustic': '10–16 LU',
        'Podcast / Spoken Word': '6–12 LU',
      }
      const target = genreLraGuide[(assignment as any).genre] ?? '6–12 LU'
      return `What is the LRA and PLR of your mix? For ${(assignment as any).genre}, a typical LRA is ${target}. Is your mix within that range, or has limiting eroded the punch?`
    }
    return currentStep?.question ?? ''
  }, [currentStep, (assignment as any)?.genre])

  // Count correct measurable blind test predictions for completion screen
  const blindTestSummary = React.useMemo(() => {
    if (!blindTest?.revealed || !blindTest.answers.length) return null
    const measurable = ['loudness', 'stereo_width', 'dynamics', 'translation'] as const
    type MeasurableDim = typeof measurable[number]
    const ar = analysisResult ?? {}

    function matchLufs(choice: string, a: number | null | undefined, b: number | null | undefined): boolean {
      if (a == null || b == null) return false
      const delta = a - b
      if (Math.abs(delta) < 0.5) return choice === 'equal'
      return delta > 0 ? choice === 'A' : choice === 'B'
    }
    function matchDelta(choice: string, a: number | null | undefined, b: number | null | undefined, higherFavorsA: boolean): boolean {
      if (a == null || b == null) return false
      const delta = a - b
      if (Math.abs(delta) < 0.1) return choice === 'equal'
      return (higherFavorsA ? delta > 0 : delta < 0) ? choice === 'A' : choice === 'B'
    }

    let correct = 0
    for (const dim of measurable) {
      const answer = blindTest.answers.find(a => a.dimension === dim)
      if (!answer) continue
      const c = answer.choice
      if (dim === 'loudness' && matchLufs(c, ar.lufs_i_a, ar.lufs_i_b)) correct++
      else if (dim === 'stereo_width' && matchDelta(c, ar.stereo_width_a, ar.stereo_width_b, true)) correct++
      else if (dim === 'dynamics' && matchDelta(c, ar.lra_a, ar.lra_b, false)) correct++
      else if (dim === 'translation' && matchDelta(c, ar.mono_compat_a, ar.mono_compat_b, true)) correct++
    }
    return { correct, total: measurable.length }
  }, [blindTest, analysisResult])

  // Early return AFTER all hooks
  if (!enabled) return null

  const isLastStep = step === GUIDED_STEPS.length - 1

  const handleStepClick = (index: number) => {
    setStep(index)
    onNavigate(GUIDED_STEPS[index].tabId)
  }

  const handleNext = () => {
    if (!isLastStep) {
      nextStep()
      onNavigate(GUIDED_STEPS[step + 1].tabId)
    }
  }

  const handlePrev = () => {
    if (step > 0) {
      prevStep()
      onNavigate(GUIDED_STEPS[step - 1].tabId)
    }
  }

  return (
    <>
      {/* Blind Test overlay */}
      {blindTestOpen && (
        <BlindTestPanel
          onClose={() => setBlindTestOpen(false)}
          analysisResult={analysisResult}
          fileAName={fileAName ?? 'File A'}
          fileBName={fileBName ?? 'File B'}
        />
      )}

      <div
        style={{
          position: 'sticky',
          top: 92,
          zIndex: 35,
          background: 'rgba(21,20,17,0.98)',
          borderBottom: '1px solid rgba(208,176,102,0.18)',
          padding: '0 24px',
        }}
      >
        {/* Assignment title row — shown when an assignment is active */}
        {assignment && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '6px 0 4px',
              borderBottom: '1px solid rgba(208,176,102,0.08)',
            }}
          >
            <span
              style={{
                fontSize: 10,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--color-accent)',
              }}
            >
              {assignment.title}
            </span>
            {assignment.course && (
              <span style={{ fontSize: 10, color: 'var(--color-sand-400)' }}>
                {assignment.course}
              </span>
            )}
            {assignment.dueDate && (
              <span style={{ fontSize: 10, color: 'var(--color-sand-400)', marginLeft: 'auto' }}>
                Due: {assignment.dueDate}
              </span>
            )}
          </div>
        )}

        {/* Step pills row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '8px 0 0',
            overflowX: 'auto',
            scrollbarWidth: 'none',
          }}
        >
          {/* Blind Test button */}
          <button
            onClick={() => setBlindTestOpen(true)}
            style={{
              flexShrink: 0,
              background: 'transparent',
              border: '1px solid rgba(168,161,150,0.3)',
              borderRadius: '2px',
              color: 'var(--color-sand-400)',
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '5px 10px',
              cursor: 'pointer',
              marginRight: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            🎧 Blind Test
            {blindTest != null && (
              <span
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'rgba(208,176,102,0.8)',
                  flexShrink: 0,
                }}
              />
            )}
          </button>

          {GUIDED_STEPS.map((s, index) => {
            const isActive = index === step
            const isCompleted = index < step

            return (
              <button
                key={s.id}
                onClick={() => handleStepClick(index)}
                style={{
                  flexShrink: 0,
                  background: isActive ? 'rgba(208,176,102,0.06)' : 'transparent',
                  border: 'none',
                  borderBottom: isActive
                    ? '2px solid var(--color-accent)'
                    : '2px solid transparent',
                  color: isActive
                    ? 'var(--color-text-primary)'
                    : isCompleted
                    ? 'var(--color-accent)'
                    : 'var(--color-sand-400)',
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  padding: '6px 12px',
                  cursor: 'pointer',
                  borderRadius: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  opacity: isCompleted ? 0.75 : 1,
                  transition: 'color 0.15s, background 0.15s',
                  whiteSpace: 'nowrap',
                }}
              >
                {isCompleted && (
                  <span style={{ fontSize: 9, color: 'var(--color-accent)' }}>✓</span>
                )}
                <span>
                  Step {index + 1}: {s.label}
                </span>
              </button>
            )
          })}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Teacher setup button */}
          {role === 'teacher' && (
            <button
              onClick={() => setShowGradeBook(true)}
              style={{
                flexShrink: 0,
                background: 'transparent',
                border: '1px solid rgba(208,176,102,0.3)',
                borderRadius: '2px',
                color: 'var(--color-sand-400)',
                fontSize: 10,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                padding: '5px 10px',
                cursor: 'pointer',
                marginLeft: 8,
              }}
            >
              Grade Book
            </button>
          )}
          {role === 'teacher' && (
            <button
              onClick={() => setShowAssignmentPanel(true)}
              style={{
                flexShrink: 0,
                background: 'transparent',
                border: '1px solid rgba(208,176,102,0.4)',
                borderRadius: '2px',
                color: 'var(--color-accent)',
                fontSize: 10,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                padding: '5px 10px',
                cursor: 'pointer',
                marginLeft: 8,
              }}
            >
              Set Up Assignment
            </button>
          )}

          {/* Help button */}
          <button
            onClick={() => setHelpOpen(v => !v)}
            style={{
              padding: '4px 9px',
              background: 'none',
              border: '1px solid rgba(208,176,102,0.25)',
              borderRadius: '2px',
              color: 'var(--color-sand-400)',
              fontSize: 11,
              cursor: 'pointer',
              letterSpacing: '0.04em',
              flexShrink: 0,
            }}
            aria-label="Open help"
          >
            ?
          </button>

          {/* Prev / Next controls */}
          <div style={{ display: 'flex', gap: 6, marginLeft: 12, flexShrink: 0 }}>
            <button
              onClick={handlePrev}
              disabled={step === 0}
              style={{
                background: 'transparent',
                border: '1px solid rgba(208,176,102,0.4)',
                borderRadius: '2px',
                color: step === 0 ? 'var(--color-sand-400)' : 'var(--color-text-primary)',
                fontSize: 11,
                padding: '5px 12px',
                cursor: step === 0 ? 'not-allowed' : 'pointer',
                opacity: step === 0 ? 0.4 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              ← Prev
            </button>
            <button
              onClick={() => {
                if (isLastStep) {
                  setCompleted(true)
                } else {
                  handleNext()
                }
              }}
              disabled={false}
              style={{
                background: 'transparent',
                border: `1px solid ${isLastStep ? 'rgba(208,176,102,0.7)' : 'rgba(208,176,102,0.4)'}`,
                borderRadius: '2px',
                color: 'var(--color-text-primary)',
                fontSize: 11,
                padding: '5px 12px',
                cursor: 'pointer',
                transition: 'opacity 0.15s',
              }}
            >
              {isLastStep ? 'Finish ✓' : 'Next →'}
            </button>
          </div>
        </div>

        {/* Completion banner or current step question box */}
        {completed ? (
          <div style={{
            background: 'rgba(208,176,102,0.06)',
            border: '1px solid rgba(208,176,102,0.3)',
            borderRadius: '2px',
            padding: '14px 18px',
            margin: '8px 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--color-accent)', fontWeight: 600, marginBottom: 3 }}>
                ✓ Analysis Complete
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-sand-400)' }}>
                You've worked through all {GUIDED_STEPS.length} steps. Export your report to document your findings.
              </div>
              {blindTestSummary && (
                <div
                  style={{
                    marginTop: 8,
                    paddingTop: 8,
                    borderTop: '1px solid rgba(208,176,102,0.1)',
                    fontSize: 11,
                    color: 'var(--color-sand-400)',
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: 'rgba(208,176,102,0.5)',
                      marginRight: 8,
                    }}
                  >
                    Blind Test Results
                  </span>
                  You correctly predicted {blindTestSummary.correct} of {blindTestSummary.total} measurable dimensions.
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                onClick={() => setCompleted(false)}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(168,161,150,0.2)',
                  borderRadius: '2px',
                  color: 'var(--color-sand-400)',
                  fontSize: 10,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  padding: '5px 10px',
                  cursor: 'pointer',
                }}
              >
                Review Steps
              </button>
              {role === 'teacher' && (
                <button
                  onClick={() => setShowGradeBook(true)}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(208,176,102,0.3)',
                    borderRadius: '2px',
                    color: 'var(--color-sand-400)',
                    fontSize: 10,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    padding: '5px 10px',
                    cursor: 'pointer',
                  }}
                >
                  Grade Book
                </button>
              )}
              <StudentReportExportTrigger />
            </div>
          </div>
        ) : (
          currentStep && (
            <div
              style={{
                background: 'rgba(208,176,102,0.04)',
                border: '1px solid rgba(208,176,102,0.12)',
                borderRadius: '2px',
                padding: '10px 14px',
                margin: '8px 0',
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--color-accent)',
                  marginBottom: 5,
                }}
              >
                Step {step + 1} of {GUIDED_STEPS.length} — {currentStep.label}
              </div>
              {currentStep.targetTab && (
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  marginBottom: 8,
                  padding: '3px 8px',
                  border: '1px solid rgba(208,176,102,0.3)',
                  borderRadius: '2px',
                  fontSize: 10,
                  color: 'var(--color-sand-400)',
                  letterSpacing: '0.05em',
                  background: 'rgba(208,176,102,0.05)',
                }}>
                  <span style={{ fontSize: 9, opacity: 0.6 }}>▶</span>
                  <span style={{ textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    Navigate to:
                  </span>
                  <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                    {currentStep.targetTab}
                  </span>
                </div>
              )}
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--color-text-primary)',
                  fontStyle: 'italic',
                  fontFamily: 'var(--font-display, serif)',
                  margin: 0,
                  lineHeight: 1.5,
                }}
              >
                {stepQuestion}
              </p>
            </div>
          )
        )}
      </div>

      {/* Help modal */}
      {helpOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={e => { if (e.target === e.currentTarget) setHelpOpen(false) }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 400,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.65)',
          }}
        >
          <div style={{
            background: 'rgba(14,13,11,0.98)',
            border: '1px solid rgba(208,176,102,0.3)',
            borderRadius: '2px',
            padding: '24px 28px',
            maxWidth: 600,
            width: '90%',
            maxHeight: '80vh',
            overflowY: 'auto',
            position: 'relative',
          }}>
            {/* Close button */}
            <button onClick={() => setHelpOpen(false)} style={{
              position: 'absolute', top: 12, right: 14,
              background: 'none', border: 'none',
              color: 'var(--color-sand-400)', cursor: 'pointer', fontSize: 16,
            }}>×</button>

            {/* Title */}
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 20, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Learn Mode — Quick Start
            </div>

            {/* Getting Started section */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(208,176,102,0.8)', marginBottom: 10 }}>
                Getting Started
              </div>
              {[
                { n: 1, text: 'Drag your reference track onto the left drop zone (File A) and your mix onto the right (File B).' },
                { n: 2, text: 'Click the "Learn Mode" toggle in the top bar to enable guided mode.' },
                { n: 3, text: 'If your instructor gave you an assignment file (.rtm-assignment.json), click "Load Assignment" to load the rubric.' },
                { n: 4, text: 'Enter your Student ID in the assignment panel — use the same format as your Canvas Student ID.' },
                { n: 5, text: 'Work through the 9 guided steps in the bar at the bottom. Each step has explanations and what to look for.' },
                { n: 6, text: 'Click "🎧 Blind Test" to test your ears — make predictions before the meters are revealed.' },
                { n: 7, text: 'When you\'ve worked through the steps, click "Export Report" to generate your PDF.' },
                { n: 8, text: 'Submit the PDF to your instructor as directed (email, folder, LMS upload).' },
              ].map(({ n, text }) => (
                <div key={n} style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: 'rgba(208,176,102,0.7)', minWidth: 16, marginTop: 1 }}>{n}.</span>
                  <span style={{ fontSize: 12, color: 'var(--color-text-primary)', lineHeight: 1.5 }}>{text}</span>
                </div>
              ))}
            </div>

            {/* Blind Test section */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(208,176,102,0.8)', marginBottom: 10 }}>
                Blind Test Mode
              </div>
              <p style={{ fontSize: 12, color: 'var(--color-text-primary)', lineHeight: 1.6, margin: 0 }}>
                Before looking at any meters, pick which file wins on each dimension — loudness, low-end, brightness, stereo width, dynamics, translation, and overall. Lock your predictions, then reveal to see how your ears compare to the measurements. This is ear training in action.
              </p>
            </div>

            {/* Troubleshooting section */}
            <div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(208,176,102,0.8)', marginBottom: 10 }}>
                Troubleshooting
              </div>
              {[
                { q: 'Export Report is greyed out', a: 'Complete at least the first guided step first.' },
                { q: 'PDF shows no scores', a: 'Ask your instructor to share the assignment file (.rtm-assignment.json) with rubric metrics.' },
                { q: 'Python not found error', a: 'Run: pip install reportlab pillow in your Terminal, then try again.' },
              ].map(({ q, a }) => (
                <div key={q} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-primary)', fontWeight: 600 }}>{q}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-sand-400)', marginTop: 2 }}>{a}</div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div style={{ marginTop: 24, paddingTop: 14, borderTop: '1px solid rgba(208,176,102,0.12)', fontSize: 10, color: 'var(--color-sand-400)', textAlign: 'center', letterSpacing: '0.04em' }}>
              RTMcompare Learn Mode is built for Mixing &amp; Mastering courses · See docs/learn-mode/ for full guides
            </div>
          </div>
        </div>
      )}

      {/* Assignment Panel (teacher only) — slide-in from right */}
      <AssignmentPanel
        open={showAssignmentPanel}
        onClose={() => setShowAssignmentPanel(false)}
        onSave={(cfg) => {
          setAssignment(cfg)
          setShowAssignmentPanel(false)
        }}
        onClear={() => {
          setAssignment(null)
          setShowAssignmentPanel(false)
        }}
        current={assignment ?? null}
        referenceFilePath={referenceFilePath ?? null}
      />

      {/* Grade Book (teacher only) */}
      <ClassGradeBook
        open={showGradeBook}
        onClose={() => setShowGradeBook(false)}
        initialFolder={assignment?.submissionsFolder ?? null}
      />
    </>
  )
}
