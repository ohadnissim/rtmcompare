/**
 * StudentWorkspace — compact sidebar for Learn Mode students.
 *
 * Positioned fixed on the right side of the screen. Shows the current
 * guided step, its question, an optional collapsible hint, a persistent
 * "My Answer" textarea (saved to localStorage per step), assignment info,
 * and a step progress bar.
 *
 * Collapses to a 40px-wide tab strip when hidden.
 */

import React, { useState, useEffect } from 'react'
import { useLearnMode, GUIDED_STEPS } from '../../context/LearnModeContext'

const STORAGE_PREFIX = 'rtm-learn-answer-'

function loadAnswer(stepId: string): string {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${stepId}`) ?? ''
  } catch {
    return ''
  }
}

function saveAnswer(stepId: string, text: string) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${stepId}`, text)
  } catch {}
}

export default function StudentWorkspace() {
  const { enabled, role, step, assignment, previewingStudent } = useLearnMode()
  // Effective role: real student OR teacher previewing-as-student
  const isStudent = role === 'student' || previewingStudent
  const [expanded, setExpanded] = useState(true)
  const [showHint, setShowHint] = useState(false)
  const [answer, setAnswer] = useState('')
  const [studentName, setStudentName] = useState('')
  // BUG-03: student ID field — needed for Canvas LMS grade upload
  const [studentId, setStudentId] = useState('')

  const currentStep = GUIDED_STEPS[step]

  // Load answer for the current step from localStorage
  useEffect(() => {
    if (currentStep) {
      setAnswer(loadAnswer(currentStep.id))
      setShowHint(false)
    }
  }, [currentStep?.id])

  // Load student name + ID from localStorage
  useEffect(() => {
    try {
      const storedName = localStorage.getItem('rtm-learn-student-name')
      if (storedName) setStudentName(storedName)
      const storedId = localStorage.getItem('rtm-learn-student-id')
      if (storedId) setStudentId(storedId)
    } catch {}
  }, [])

  // Publish sidebar width as a CSS variable so App.tsx's <main> can
  // add matching padding-right without needing LearnModeContext access.
  useEffect(() => {
    if (enabled && isStudent) {
      document.documentElement.style.setProperty(
        '--rtm-student-sidebar-width',
        expanded ? '260px' : '40px'
      )
    } else {
      document.documentElement.style.removeProperty('--rtm-student-sidebar-width')
    }
    return () => { document.documentElement.style.removeProperty('--rtm-student-sidebar-width') }
  }, [enabled, role, expanded])

  if (!enabled || !isStudent) return null

  const handleAnswerChange = (text: string) => {
    setAnswer(text)
    if (currentStep) saveAnswer(currentStep.id, text)
  }

  const handleNameChange = (name: string) => {
    setStudentName(name)
    try { localStorage.setItem('rtm-learn-student-name', name) } catch {}
  }

  // BUG-03: persist student ID so it's available in PDF + Canvas upload
  const handleIdChange = (id: string) => {
    setStudentId(id)
    try { localStorage.setItem('rtm-learn-student-id', id) } catch {}
  }

  const progressPct = GUIDED_STEPS.length > 0
    ? ((step + 1) / GUIDED_STEPS.length) * 100
    : 0

  return (
    <div
      style={{
        position: 'fixed',
        right: 0,
        top: 120,
        width: expanded ? 260 : 40,
        zIndex: 40,
        transition: 'width 0.2s ease',
        display: 'flex',
        flexDirection: 'row',
        pointerEvents: 'auto',
      }}
    >
      {/* Collapsed tab (always visible) */}
      <button
        onClick={() => setExpanded(v => !v)}
        aria-label={expanded ? 'Collapse workspace' : 'Expand workspace'}
        style={{
          width: 40,
          flexShrink: 0,
          background: 'rgba(21,20,17,0.98)',
          border: '1px solid rgba(208,176,102,0.25)',
          borderRight: 'none',
          borderRadius: '2px 0 0 2px',
          color: 'var(--color-accent)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          writingMode: 'vertical-rl',
          fontSize: 9,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          padding: '12px 0',
          userSelect: 'none',
        }}
      >
        {expanded ? '▶' : '◀ Notes'}
      </button>

      {/* Main panel */}
      <div
        style={{
          flex: 1,
          background: 'rgba(21,20,17,0.98)',
          border: '1px solid rgba(208,176,102,0.25)',
          borderRadius: '0 2px 2px 0',
          overflowY: 'auto',
          overflowX: 'hidden',
          display: expanded ? 'flex' : 'none',
          flexDirection: 'column',
          padding: '14px 14px 20px',
          gap: 0,
          maxHeight: 'calc(100vh - 140px)',
          boxSizing: 'border-box',
        }}
      >
        {/* Step label */}
        <div style={{
          fontSize: 9,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--color-accent)',
          marginBottom: 10,
          opacity: 0.8,
        }}>
          Step {step + 1} / {GUIDED_STEPS.length} — {currentStep?.label}
        </div>

        {/* Hint (collapsible) — replaces the duplicate question. The question
            lives in GuidedFlowBar. This panel is the answer pad. */}
        {currentStep?.hint && (
          <div style={{ marginBottom: 10 }}>
            <button
              onClick={() => setShowHint(v => !v)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-sand-400)',
                fontSize: 10,
                cursor: 'pointer',
                padding: 0,
                letterSpacing: '0.06em',
                textDecoration: 'underline',
                textDecorationStyle: 'dotted',
              }}
            >
              {showHint ? 'Hide hint' : 'Show hint'}
            </button>
            {showHint && (
              <p
                style={{
                  fontSize: 11,
                  color: 'var(--color-sand-400)',
                  fontStyle: 'italic',
                  marginTop: 5,
                  marginBottom: 0,
                  lineHeight: 1.5,
                }}
              >
                {currentStep.hint}
              </p>
            )}
          </div>
        )}

        {/* My Answer textarea */}
        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              display: 'block',
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-sand-400)',
              marginBottom: 4,
            }}
          >
            My Notes — Step {step + 1}
          </label>
          <textarea
            value={answer}
            onChange={e => handleAnswerChange(e.target.value)}
            placeholder="What do you hear? What do the meters tell you? Write your observations here — they'll be included in your report."
            rows={5}
            style={{
              width: '100%',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(168,161,150,0.15)',
              borderRadius: '2px',
              color: 'var(--color-text-primary)',
              padding: '6px 8px',
              fontSize: 12,
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
              lineHeight: 1.5,
              fontFamily: 'inherit',
            }}
          />
        </div>

        {/* MED-11 fix: Student identity (Name + ID) was nested INSIDE the
            assignment box, which only rendered when `assignment` was set. A
            solo student with no assignment had no way to enter their name,
            so the PDF report exported with empty identity. Identity now
            renders unconditionally; the assignment box renders separately
            below it with just the assignment-specific metadata. */}
        <div
          style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(168,161,150,0.12)',
            borderRadius: '2px',
            padding: '8px 10px',
            marginBottom: 12,
          }}
        >
          <div style={{
            fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: 'var(--color-sand-400)', marginBottom: 6,
          }}>
            Your Identity
          </div>
          <label style={{
            display: 'block', fontSize: 10, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: 'var(--color-sand-400)', marginBottom: 3,
          }}>
            Your Name
          </label>
          <input
            type="text"
            value={studentName}
            onChange={e => handleNameChange(e.target.value)}
            placeholder="Student name"
            style={{
              width: '100%', background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(168,161,150,0.15)', borderRadius: '2px',
              color: 'var(--color-text-primary)', padding: '5px 8px', fontSize: 11,
              outline: 'none', boxSizing: 'border-box',
            }}
          />
          <label style={{
            display: 'block', fontSize: 10, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: 'var(--color-sand-400)',
            marginTop: 6, marginBottom: 3,
          }}>
            Student ID
          </label>
          <input
            type="text"
            value={studentId}
            onChange={e => handleIdChange(e.target.value)}
            placeholder="e.g. 12345678"
            style={{
              width: '100%', background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(168,161,150,0.15)', borderRadius: '2px',
              color: 'var(--color-text-primary)', padding: '5px 8px', fontSize: 11,
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Assignment info (when active) — title / course / due-date only */}
        {assignment && (
          <div
            style={{
              background: 'rgba(208,176,102,0.04)',
              border: '1px solid rgba(208,176,102,0.1)',
              borderRadius: '2px',
              padding: '8px 10px',
              marginBottom: 12,
            }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--color-accent)',
                marginBottom: 6,
              }}
            >
              {assignment.title}
            </div>
            {assignment.course && (
              <div style={{ fontSize: 11, color: 'var(--color-sand-400)', marginBottom: 4 }}>
                {assignment.course}
              </div>
            )}
            {assignment.dueDate && (
              <div style={{ fontSize: 10, color: 'var(--color-sand-400)' }}>
                Due: {assignment.dueDate}
              </div>
            )}
          </div>
        )}

        {/* Progress bar */}
        <div style={{ marginTop: 'auto', paddingTop: 4 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 4,
            }}
          >
            <span style={{ fontSize: 10, color: 'var(--color-sand-400)', letterSpacing: '0.06em' }}>
              Progress
            </span>
            <span style={{ fontSize: 10, color: 'var(--color-sand-400)' }}>
              Step {step + 1} / {GUIDED_STEPS.length}
            </span>
          </div>
          {/* Track */}
          <div
            style={{
              height: 2,
              background: 'rgba(168,161,150,0.2)',
              borderRadius: 1,
              overflow: 'hidden',
            }}
          >
            {/* Fill */}
            <div
              style={{
                height: '100%',
                width: `${progressPct}%`,
                background: 'var(--color-accent)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
