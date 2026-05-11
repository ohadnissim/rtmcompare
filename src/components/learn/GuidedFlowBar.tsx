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

interface Props {
  /** Called when a step pill is clicked — callers use this to navigate tabs */
  onNavigate: (tabId: string) => void
  /** Optional reference file path — forwarded to AssignmentPanel for the lock toggle */
  referenceFilePath?: string | null
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

export default function GuidedFlowBar({ onNavigate, referenceFilePath }: Props) {
  const { enabled, step, setStep, nextStep, prevStep, role, setAssignment, assignment } = useLearnMode()
  const [showAssignmentPanel, setShowAssignmentPanel] = React.useState(false)
  const [completed, setCompleted] = React.useState(false)

  if (!enabled) return null

  const currentStep = GUIDED_STEPS[step]
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

  return (
    <>
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
    </>
  )
}
