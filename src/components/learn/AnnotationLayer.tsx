import React, { useState } from 'react'
import { useLearnMode } from '../../context/LearnModeContext'
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
  const { enabled, annotations, addAnnotation, removeAnnotation } = useLearnMode()

  const [popoverOpen, setPopoverOpen] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [selectedColor, setSelectedColor] = useState<LearnAnnotation['color']>('gold')

  if (!enabled) return null

  const tabAnnotations = annotations.filter(a => a.tabId === tabId)

  // Stack notes without positionX from top in a column on the right.
  let stackOffset = 0

  function handleAdd() {
    if (!noteText.trim()) return
    addAnnotation({ text: noteText.trim(), tabId, color: selectedColor })
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

      {/* Add Note button — fixed position */}
      <button
        onClick={() => setPopoverOpen(v => !v)}
        style={{
          position: 'fixed',
          bottom: 80,
          right: 16,
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

      {/* Input popover */}
      {popoverOpen && (
        <div
          style={{
            position: 'fixed',
            bottom: 120,
            right: 16,
            zIndex: 220,
            width: 220,
            background: 'rgba(14,13,11,0.95)',
            border: '1px solid rgba(208,176,102,0.4)',
            borderRadius: '2px',
            padding: 12,
            boxSizing: 'border-box',
          }}
        >
          <textarea
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
    </>
  )
}
