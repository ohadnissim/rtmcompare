import React, { useState } from 'react'
import { useLearnMode, GUIDED_STEPS } from '../../context/LearnModeContext'
import type { LearnAnnotation } from '../../types'

interface Props {
  tabId: string
  containerRef?: React.RefObject<HTMLDivElement>
}

const COLOR_MAP: Record<NonNullable<LearnAnnotation['color']>, string> = {
  gold: 'var(--color-accent)',
  red: 'rgba(220,80,60,0.7)',
  teal: 'rgba(100,200,180,0.7)',
  sand: 'var(--color-sand-400)',
}

const COLORS: Array<LearnAnnotation['color']> = ['gold', 'red', 'teal', 'sand']

export function AnnotationLayer({ tabId }: Props) {
  const { enabled, annotations, step, addAnnotation, removeAnnotation, clearAnnotations } = useLearnMode()

  const [popoverOpen, setPopoverOpen] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = React.useState(false)
  const [noteText, setNoteText] = useState('')
  const [selectedColor, setSelectedColor] = useState<LearnAnnotation['color']>('gold')

  if (!enabled) return null

  // BUG-16 fix: scope annotations to the current step when multiple steps share
  // the same tabId (e.g. 'overview' is used by steps 1, 2, and 9).
  // Annotations added before this fix (no stepId) are shown on all steps for
  // backward compatibility.
  const currentStepId = GUIDED_STEPS[step]?.id
  const tabAnnotations = annotations.filter(a =>
    a.tabId === tabId && (a.stepId === undefined || a.stepId === currentStepId)
  )

  // Stack notes without positionX from top in a column on the right.
  let stackOffset = 0

  function handleAdd() {
    if (!noteText.trim()) return
    // BUG-16: store stepId alongside tabId so annotations are step-scoped
    addAnnotation({ text: noteText.trim(), tabId, stepId: currentStepId, color: selectedColor })
    setNoteText('')
    setSelectedColor('gold')
    setPopoverOpen(false)
  }

  function handleCancel() {
    setNoteText('')
    setSelectedColor('gold')
    setPopoverOpen(false)
  }

  return (
    <>
      {/* Overlay — does NOT block pointer events */}
      <div
        data-tour-learn="annotations"
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 200,
        }}
      >
        {tabAnnotations.map((ann) => {
          let style: React.CSSProperties = {
            position: 'absolute',
            width: 180,
            pointerEvents: 'all',
            background: 'rgba(21,20,17,0.96)',
            border: `1px solid rgba(208,176,102,0.25)`,
            borderRadius: '2px',
            borderLeft: `3px solid ${COLOR_MAP[ann.color ?? 'gold']}`,
            padding: '8px 10px',
            boxSizing: 'border-box',
          }

          if (ann.positionX != null) {
            style = {
              ...style,
              left: `${ann.positionX * 100}%`,
              top: 80,
            }
          } else {
            style = {
              ...style,
              right: 16,
              top: 80 + stackOffset,
            }
            stackOffset += 110
          }

          return (
            <div key={ann.id} style={style}>
              {/* Delete button */}
              <button
                onClick={() => removeAnnotation(ann.id)}
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 6,
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-sand-400)',
                  cursor: 'pointer',
                  fontSize: 12,
                  lineHeight: 1,
                  padding: 0,
                }}
                aria-label="Delete annotation"
              >
                ×
              </button>
              <p
                style={{
                  margin: '0 16px 4px 0',
                  fontSize: 12,
                  color: 'var(--color-text-primary)',
                  lineHeight: 1.4,
                  wordBreak: 'break-word',
                }}
              >
                {ann.text}
              </p>
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--color-sand-400)',
                }}
              >
                {new Date(ann.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          )
        })}
      </div>

      {/* Add Note button — fixed position. `right` clears the student sidebar
          when it's visible (CSS var falls back to 16px when not in student mode). */}
      <button
        onClick={() => setPopoverOpen(v => !v)}
        style={{
          position: 'fixed',
          bottom: 80,
          right: 'calc(16px + var(--rtm-student-sidebar-width, 0px))',
          zIndex: 210,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 14px',
          background: 'rgba(14,13,11,0.95)',
          border: '1px solid var(--color-accent)',
          borderRadius: '2px',
          color: 'var(--color-text-primary)',
          fontSize: 12,
          cursor: 'pointer',
          letterSpacing: '0.04em',
        }}
        aria-label="Add annotation"
      >
        <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
        Add Note
      </button>

      {/* Clear All button — only shown when THIS STEP has annotations (NEW-06 fix:
          was checking all-tab annotations, but action clears only current step) */}
      {tabAnnotations.length > 0 && (
        <button
          onClick={() => setShowClearConfirm(true)}
          style={{
            position: 'fixed',
            bottom: 46,
            right: 'calc(16px + var(--rtm-student-sidebar-width, 0px))',
            zIndex: 210,
            padding: '5px 12px',
            background: 'rgba(14,13,11,0.95)',
            border: '1px solid rgba(220,80,60,0.35)',
            borderRadius: '2px',
            color: 'rgba(220,80,60,0.7)',
            fontSize: 10,
            cursor: 'pointer',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
          aria-label="Clear all annotations on this tab"
        >
          Clear All
        </button>
      )}

      {/* Input popover */}
      {popoverOpen && (
        <div
          style={{
            position: 'fixed',
            bottom: 120,
            right: 'calc(16px + var(--rtm-student-sidebar-width, 0px))',
            zIndex: 220,
            width: 220,
            background: 'rgba(14,13,11,0.95)',
            border: '1px solid rgba(208,176,102,0.4)',
            borderRadius: '2px',
            padding: 12,
            boxSizing: 'border-box',
          }}
        >
          {/* CRIT-7 fix: associate label with textarea for screen readers */}
          <label
            htmlFor="rtm-annotation-note"
            style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}
          >
            Annotation note
          </label>
          <textarea
            id="rtm-annotation-note"
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            rows={4}
            placeholder="Type your note…"
            style={{
              width: '100%',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(208,176,102,0.2)',
              borderRadius: '2px',
              color: 'var(--color-text-primary)',
              fontSize: 12,
              padding: '6px 8px',
              resize: 'none',
              outline: 'none',
              boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
            autoFocus
          />

          {/* Color swatches */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {COLORS.map(c => (
              <button
                key={c}
                onClick={() => setSelectedColor(c)}
                aria-label={`Color ${c}`}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '2px',
                  background: COLOR_MAP[c!],
                  border: selectedColor === c
                    ? '2px solid var(--color-text-primary)'
                    : '2px solid transparent',
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              onClick={handleAdd}
              style={{
                flex: 1,
                padding: '5px 0',
                background: 'none',
                border: '1px solid rgba(208,176,102,0.5)',
                borderRadius: '2px',
                color: 'var(--color-text-primary)',
                fontSize: 11,
                cursor: 'pointer',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}
            >
              Add
            </button>
            <button
              onClick={handleCancel}
              style={{
                flex: 1,
                padding: '5px 0',
                background: 'none',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '2px',
                color: 'var(--color-sand-400)',
                fontSize: 11,
                cursor: 'pointer',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {/* Clear All confirmation dialog */}
      {showClearConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)',
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowClearConfirm(false) }}
        >
          <div style={{
            background: 'rgba(21,20,17,0.99)',
            border: '1px solid rgba(220,80,60,0.4)',
            borderRadius: '2px',
            padding: '24px 28px',
            maxWidth: 320,
            width: '90%',
          }}>
            <div style={{ fontSize: 13, color: 'var(--color-text-primary)', marginBottom: 8, fontWeight: 600 }}>
              Clear all notes?
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-sand-400)', marginBottom: 20, lineHeight: 1.5 }}>
              This will permanently delete all {tabAnnotations.length} annotation{tabAnnotations.length !== 1 ? 's' : ''} on this step. This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => {
                  // BUG-16: pass stepId so only the current step's annotations are cleared
                  clearAnnotations(tabId, currentStepId)
                  setShowClearConfirm(false)
                }}
                style={{
                  flex: 1,
                  padding: '7px 0',
                  background: 'rgba(220,80,60,0.08)',
                  border: '1px solid rgba(220,80,60,0.5)',
                  borderRadius: '2px',
                  color: 'rgba(220,80,60,0.9)',
                  fontSize: 11,
                  cursor: 'pointer',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                Clear All
              </button>
              <button
                onClick={() => setShowClearConfirm(false)}
                style={{
                  flex: 1,
                  padding: '7px 0',
                  background: 'transparent',
                  border: '1px solid rgba(168,161,150,0.2)',
                  borderRadius: '2px',
                  color: 'var(--color-sand-400)',
                  fontSize: 11,
                  cursor: 'pointer',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
