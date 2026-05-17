import React, { useState, useRef, useEffect } from 'react'
import { useAudience } from '../AudienceContext'
import { PANEL_INFO } from './learn/PANEL_INFO'

const AUDIENCE_LABEL: Record<string, string> = {
  pro: 'PRO',
  producer: 'PRODUCER',
  student: 'STUDENT',
  teacher: 'TEACHER',
}

interface Props {
  panelId: string
}

export default function PanelInfo({ panelId }: Props) {
  const audience = useAudience()
  const content = PANEL_INFO[panelId]
  const [visible, setVisible] = useState(false)
  const [pinned, setPinned] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [above, setAbove] = useState(false)
  const [alignRight, setAlignRight] = useState(false)

  // Decide pop-up position after each open
  useEffect(() => {
    if (!visible || !btnRef.current || !popRef.current) return
    const btnRect = btnRef.current.getBoundingClientRect()
    const popH = popRef.current.offsetHeight
    const popW = popRef.current.offsetWidth
    setAbove(btnRect.bottom + popH + 12 > window.innerHeight)
    setAlignRight(btnRect.left + popW > window.innerWidth - 16)
  }, [visible])

  if (!content) return null

  const description = content[audience]

  const hide = () => { if (!pinned) setVisible(false) }

  const popStyle: React.CSSProperties = {
    position: 'absolute',
    zIndex: 500,
    minWidth: 280,
    maxWidth: 340,
    background: 'rgba(14,13,11,0.97)',
    border: '1px solid rgba(208,176,102,0.18)',
    borderRadius: '2px',
    padding: '14px 16px',
    pointerEvents: pinned ? 'auto' : 'none',
    ...(above
      ? { bottom: 'calc(100% + 8px)', top: 'auto' }
      : { top: 'calc(100% + 8px)' }),
    ...(alignRight
      ? { right: 0, left: 'auto' }
      : { left: 0 }),
  }

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        ref={btnRef}
        aria-label={`Info: ${content.label}`}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={hide}
        onFocus={() => setVisible(true)}
        onBlur={hide}
        onClick={(e) => {
          e.stopPropagation()
          setPinned(v => {
            const next = !v
            setVisible(next)
            return next
          })
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          fontSize: 9,
          lineHeight: '14px',
          textAlign: 'center',
          borderRadius: '50%',
          border: `1px solid ${pinned ? 'rgba(208,176,102,0.7)' : 'rgba(208,176,102,0.4)'}`,
          color: pinned ? 'rgba(208,176,102,0.9)' : 'rgba(208,176,102,0.55)',
          background: pinned ? 'rgba(208,176,102,0.08)' : 'transparent',
          cursor: 'default',
          padding: 0,
          flexShrink: 0,
          userSelect: 'none',
          transition: 'border-color 0.15s, color 0.15s',
        }}
      >
        ⓘ
      </button>

      {visible && (
        <div ref={popRef} role="tooltip" style={popStyle}>
          {/* Audience chip + label row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'rgba(208,176,102,0.55)',
                border: '1px solid rgba(208,176,102,0.25)',
                borderRadius: '2px',
                padding: '2px 5px',
                flexShrink: 0,
              }}
            >
              {AUDIENCE_LABEL[audience] ?? audience.toUpperCase()}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: 11,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--color-accent)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {content.label}
            </span>
          </div>

          {/* Audience-specific description */}
          <div
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              color: 'var(--color-text-primary)',
              lineHeight: 1.55,
              marginBottom: content.tip ? 10 : 0,
            }}
          >
            {description}
          </div>

          {/* Optional tip */}
          {content.tip && (
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontStyle: 'italic',
                fontSize: 11,
                color: 'var(--color-sand-400)',
                lineHeight: 1.5,
              }}
            >
              <span
                style={{
                  fontStyle: 'normal',
                  color: 'var(--color-accent)',
                  fontWeight: 600,
                  marginRight: 4,
                  fontSize: 10,
                  letterSpacing: '0.08em',
                }}
              >
                Tip:
              </span>
              {content.tip}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
