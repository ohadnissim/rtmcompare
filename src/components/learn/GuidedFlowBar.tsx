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
import EarTrainingPanel from './eartraining/EarTrainingPanel'
import { StudentReportButton } from './StudentReportButton'

interface Props {
  /** Called when a step pill is clicked — callers use this to navigate tabs */
  onNavigate: (tabId: string) => void
  /** Optional reference file path — forwarded to AssignmentPanel for the lock toggle */
  referenceFilePath?: string | null
  /** File A display name — forwarded to BlindTestPanel */
  fileAName?: string
  /** File B display name — forwarded to BlindTestPanel */
  fileBName?: string
  /** File A absolute path — forwarded to BlindTestPanel audio player */
  fileAPath?: string | null
  /** File B absolute path — forwarded to BlindTestPanel audio player */
  fileBPath?: string | null
  /** Current analysis result — forwarded to BlindTestPanel for reveal comparison */
  analysisResult?: any
}

// StudentReportExportTrigger removed — NEW-01 fix: use StudentReportButton directly
// (the old trigger dispatched an event but no listener was ever mounted).

export default function GuidedFlowBar({
  onNavigate,
  referenceFilePath,
  fileAName,
  fileBName,
  fileAPath,
  fileBPath,
  analysisResult,
}: Props) {
  const { enabled, step, setStep, nextStep, prevStep, role, setRole, setAssignment, assignment, blindTest, completed, setCompleted, previewingStudent, setPreviewingStudent } = useLearnMode()
  const [showAssignmentPanel, setShowAssignmentPanel] = React.useState(false)
  const [showGradeBook, setShowGradeBook] = React.useState(false)
  const [blindTestOpen, setBlindTestOpen] = React.useState(false)
  const [earTrainingOpen, setEarTrainingOpen] = React.useState(false)
  const [helpOpen, setHelpOpen] = React.useState(false)
  // previewingStudent now lives in context so every consumer (StudentWorkspace,
  // AnalysisView, etc.) sees the same value. effectiveRole drives UI branching.
  const effectiveRole = previewingStudent ? 'student' : role

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

  // BUG-06: sync step pill when user manually clicks a tab in AnalysisView
  // Only sync for tabs that map unambiguously to a single step (not 'overview'
  // which is shared by steps 1, 2, and 9).
  React.useEffect(() => {
    function onTabChanged(e: Event) {
      if (!enabled) return
      const tabId = (e as CustomEvent<{ tabId: string }>).detail?.tabId
      if (!tabId) return
      const matchingIndices = GUIDED_STEPS.reduce<number[]>((acc, s, i) => {
        if (s.tabId === tabId) acc.push(i)
        return acc
      }, [])
      // Only auto-sync when there's exactly one matching step (unambiguous)
      if (matchingIndices.length === 1) {
        setStep(matchingIndices[0])
      }
    }
    window.addEventListener('rtm-tab-changed', onTabChanged)
    return () => window.removeEventListener('rtm-tab-changed', onTabChanged)
  }, [enabled, setStep])

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
      {/* Ear Training overlay */}
      {earTrainingOpen && (
        <EarTrainingPanel
          onClose={() => setEarTrainingOpen(false)}
          fileAPath={fileAPath ?? null}
          fileAName={fileAName}
        />
      )}

      {/* Blind Test overlay */}
      {blindTestOpen && (
        <BlindTestPanel
          onClose={() => setBlindTestOpen(false)}
          analysisResult={analysisResult}
          fileAName={fileAName ?? 'File A'}
          fileBName={fileBName ?? 'File B'}
          fileAPath={fileAPath ?? null}
          fileBPath={fileBPath ?? null}
        />
      )}

      <div
        style={{
          position: 'sticky',
          top: 92,
          zIndex: 30, // must be below header's z-40 so OverflowMenu dropdown renders on top
          background: effectiveRole === 'teacher'
            ? 'rgba(21,20,17,0.98)'
            : 'rgba(21,20,17,0.98)',
          borderBottom: '1px solid rgba(208,176,102,0.18)',
          borderTop: effectiveRole === 'teacher'
            ? '2px solid rgba(123,196,158,0.5)'   // teal = teacher
            : '2px solid rgba(208,176,102,0.5)',  // gold = student
          padding: '0 24px',
        }}
      >
        {/* Role banner — always visible so user knows exactly which mode they're in */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 0 2px',
          borderBottom: '1px solid rgba(208,176,102,0.06)',
        }}>
          <span style={{
            fontSize: 8,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            padding: '2px 7px',
            borderRadius: '2px',
            fontWeight: 600,
            background: effectiveRole === 'teacher'
              ? 'rgba(123,196,158,0.15)'
              : 'rgba(208,176,102,0.12)',
            color: effectiveRole === 'teacher'
              ? 'rgba(123,196,158,0.9)'
              : 'var(--color-accent)',
            border: effectiveRole === 'teacher'
              ? '1px solid rgba(123,196,158,0.3)'
              : '1px solid rgba(208,176,102,0.3)',
          }}>
            {effectiveRole === 'teacher' ? '🎓 Teacher Mode' : '🎧 Student Mode'}
          </span>
          {previewingStudent && (
            <span style={{ fontSize: 9, color: 'rgba(123,196,158,0.6)', letterSpacing: '0.06em' }}>
              — previewing as student
            </span>
          )}
        </div>

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

        {/* Step pills row.
            MED-31 fix: overflow-x was on with `scrollbarWidth: none` and no
            edge-fade affordance — students on narrow screens couldn't tell
            steps 7-9 even existed. Now uses a horizontal fade-mask on the
            right edge so users see content disappearing into the fade and
            know there's more to scroll. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '8px 0 0',
            overflowX: 'auto',
            scrollbarWidth: 'none',
            WebkitMaskImage: 'linear-gradient(to right, black 0%, black calc(100% - 32px), transparent 100%)',
            maskImage: 'linear-gradient(to right, black 0%, black calc(100% - 32px), transparent 100%)',
          }}
        >
          {/* Ear Training button */}
          <button
            onClick={() => setEarTrainingOpen(true)}
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
            title="Golden Ears-style frequency, EQ, compression, reverb, distortion identification drills"
          >
            🎼 Ear Training
          </button>

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

          {/* BUG-20/NEW-04: teacher preview-as-student toggle — local state only, no setRole() */}
          {(effectiveRole === 'teacher' || previewingStudent) && (
            <button
              onClick={() => setPreviewingStudent(!previewingStudent)}
              style={{
                flexShrink: 0,
                background: previewingStudent ? 'rgba(208,176,102,0.08)' : 'transparent',
                border: previewingStudent ? '1px solid rgba(208,176,102,0.7)' : '1px solid rgba(168,161,150,0.25)',
                borderRadius: '2px',
                color: previewingStudent ? 'var(--color-accent)' : 'var(--color-sand-400)',
                fontSize: 10,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                padding: '5px 10px',
                cursor: 'pointer',
                marginLeft: 8,
              }}
            >
              {previewingStudent ? '← Back to Teacher' : 'Preview as Student'}
            </button>
          )}

          {/* Teacher setup button */}
          {/* MED-29 fix: keep teacher controls visible while previewing as
              student. Otherwise the teacher loses the path back to Grade Book
              or Set Up Assignment mid-preview. The role gate is now `actual
              role is teacher` (state.role) rather than `effectiveRole`. */}
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
          {/* MED-29 fix: keep teacher controls visible while previewing as
              student. Otherwise the teacher loses the path back to Grade Book
              or Set Up Assignment mid-preview. The role gate is now `actual
              role is teacher` (state.role) rather than `effectiveRole`. */}
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
              {/* MED-29 fix: keep teacher controls visible while previewing as
              student. Otherwise the teacher loses the path back to Grade Book
              or Set Up Assignment mid-preview. The role gate is now `actual
              role is teacher` (state.role) rather than `effectiveRole`. */}
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
              {/* NEW-01 fix: mount StudentReportButton here so its IPC + event handler are live */}
              <StudentReportButton
                analysisResult={analysisResult}
                fileAName={fileAName}
                fileBName={fileBName}
              />
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
                <button
                  onClick={() => onNavigate(currentStep.tabId)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    marginBottom: 8,
                    padding: '3px 8px',
                    border: '1px solid rgba(208,176,102,0.4)',
                    borderRadius: '2px',
                    fontSize: 10,
                    color: 'var(--color-accent)',
                    letterSpacing: '0.05em',
                    background: 'rgba(208,176,102,0.08)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(208,176,102,0.15)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(208,176,102,0.08)')}
                >
                  <span style={{ fontSize: 9 }}>▶</span>
                  <span style={{ textTransform: 'uppercase', letterSpacing: '0.07em', opacity: 0.7 }}>
                    Open:
                  </span>
                  <span style={{ fontWeight: 600 }}>
                    {currentStep.targetTab}
                  </span>
                </button>
              )}
              {/* BUG-08: show rubric metrics relevant to this step when an assignment is active.
                  FIX (NEW-02): was checking non-existent `rubricMetrics` property; now uses
                  assignment.rubric (RubricCriteria[]) and extracts metric IDs via .map(r=>r.metric). */}
              {assignment && assignment.rubric && assignment.rubric.length > 0 && (() => {
                // Derive metric IDs from the typed rubric array
                const allRubricMetrics: string[] = assignment.rubric.map(r => r.metric)
                // Map each guided step to the rubric metric IDs that a student should be thinking about
                const STEP_RUBRIC_MAP: Record<string, string[]> = {
                  listening:  [],
                  metering:   ['lufs_i', 'lra', 'plr'],
                  breakdown:  ['masking'],
                  stereo:     ['mono_compat_pct', 'stereo_width', 'center_fill_ms'],
                  tonal:      ['tonal_deviation'],
                  dynamics:   ['lra', 'plr', 'transient_integrity'],
                  quality:    ['distortion', 'click_count', 'noise_floor', 'hum_detected'],
                  delivery:   ['true_peak_dbtp', 'dither_applied'],
                  reflection: allRubricMetrics,
                }
                const relevantIds: string[] = STEP_RUBRIC_MAP[currentStep.id] ?? []
                const activeMetrics: string[] = allRubricMetrics
                  .filter((m: string) => relevantIds.includes(m))
                if (!activeMetrics.length) return null
                const METRIC_LABELS: Record<string, string> = {
                  lufs_i: 'LUFS-I', lra: 'LRA', plr: 'PLR',
                  true_peak_dbtp: 'True Peak', mono_compat_pct: 'Mono Compat',
                  stereo_width: 'Stereo Width', tonal_deviation: 'Tonal Dev',
                  distortion: 'Distortion', masking: 'Masking', click_count: 'Clicks',
                  center_fill_ms: 'Center Fill (M/S)', noise_floor: 'Noise Floor',
                  transient_integrity: 'Transient', dither_applied: 'Dithering',
                  hum_detected: 'Hum', dialog_gate: 'Dialog Gate',
                }
                return (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                    <span style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(208,176,102,0.45)', alignSelf: 'center', marginRight: 2 }}>
                      Rubric:
                    </span>
                    {activeMetrics.map(m => (
                      <span
                        key={m}
                        style={{
                          fontSize: 9,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          padding: '2px 6px',
                          border: '1px solid rgba(208,176,102,0.3)',
                          borderRadius: '2px',
                          color: 'rgba(208,176,102,0.75)',
                          background: 'rgba(208,176,102,0.04)',
                        }}
                      >
                        {METRIC_LABELS[m] ?? m}
                      </span>
                    ))}
                  </div>
                )
              })()}
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
              {/* MED-24 fix: Export Report was only mounted on the completion
                  banner. Students couldn't export from inside a step. Now it
                  also sits in the question card for student role, so the
                  PDF can be generated at any point in the flow. */}
              {effectiveRole === 'student' && (
                <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                  <StudentReportButton
                    analysisResult={analysisResult}
                    fileAName={fileAName}
                    fileBName={fileBName}
                  />
                </div>
              )}
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
            // CRIT-6: Help modal must sit ABOVE BlindTestPanel (z-500) and
            // EarTrainingPanel (z-500) — previously z-400 meant the help
            // dialog opened but rendered underneath active drill overlays.
            zIndex: 600,
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
