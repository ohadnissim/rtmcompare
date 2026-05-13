import React, { useState } from 'react'
import { useLearnMode } from '../../context/LearnModeContext'
import { METRIC_EXPLAINERS } from './METRIC_EXPLAINERS'

/**
 * MetricExplainer — floating educational popover for any metric.
 *
 * Wraps a trigger element (children) and shows a richly-formatted
 * card on hover/focus when Learn Mode is active. Renders nothing
 * beyond children when Learn Mode is disabled or the metricKey is
 * unknown — zero visual impact in normal usage.
 *
 * Design system compliance:
 *   - borderRadius: 2px (no rounded-md/lg/xl)
 *   - No backdropFilter or boxShadow card-lift
 *   - Gold only as border/accent, never fill
 *   - CSS vars for all colours
 */
interface Props {
  /** Key into METRIC_EXPLAINERS, e.g. "lufs_i" */
  metricKey: string
  /** The trigger element — rendered always, wrapped when learn mode is on */
  children: React.ReactNode
  /** Current displayed value shown in the card header */
  value?: string
  /** When true, highlight the tooHigh/tooLow guidance section */
  violation?: boolean
}

export default function MetricExplainer({ metricKey, children, value, violation }: Props) {
  const { enabled } = useLearnMode()
  const [visible, setVisible] = useState(false)

  // When learn mode is off, or no content exists for this key, render children bare.
  if (!enabled) return <>{children}</>

  const content = METRIC_EXPLAINERS[metricKey]
  if (!content) return <>{children}</>

  return (
    <div
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}

      {/* ⓘ badge — always visible when learn mode is on */}
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          fontSize: 9,
          lineHeight: '12px',
          width: 12,
          height: 12,
          textAlign: 'center',
          borderRadius: '50%',
          border: '1px solid rgba(208,176,102,0.5)',
          color: 'rgba(208,176,102,0.6)',
          cursor: 'default',
          marginLeft: 3,
          verticalAlign: 'middle',
          flexShrink: 0,
          userSelect: 'none',
        }}
      >
        ⓘ
      </span>

      {visible && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            zIndex: 200,
            top: 'calc(100% + 8px)',
            left: 0,
            minWidth: 280,
            maxWidth: 340,
            background: 'rgba(14,13,11,0.97)',
            border: '1px solid rgba(208,176,102,0.18)',
            borderRadius: '2px',
            padding: '14px 16px',
            pointerEvents: 'none',
          }}
        >
          {/* ── Header row: metric name + current value ── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: 11,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--color-accent)',
              }}
            >
              {content.metric}
            </span>
            {value !== undefined && (
              <span
                style={{
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: 13,
                  color: 'var(--color-text-primary)',
                  letterSpacing: '0.02em',
                }}
              >
                {value}
              </span>
            )}
          </div>

          {/* ── Full name ── */}
          <div
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 10,
              color: 'var(--color-sand-400)',
              marginBottom: 8,
              letterSpacing: '0.03em',
            }}
          >
            {content.fullName}
          </div>

          {/* ── One-liner ── */}
          <div
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              color: 'var(--color-text-primary)',
              lineHeight: 1.45,
              marginBottom: 8,
            }}
          >
            {content.oneLiner}
          </div>

          {/* ── Why it matters ── */}
          <div
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              color: 'var(--color-sand-400)',
              lineHeight: 1.5,
              marginBottom: 10,
            }}
          >
            {content.why}
          </div>

          {/* ── Target range chip ── */}
          <div
            style={{
              display: 'inline-block',
              border: '1px solid rgba(208,176,102,0.35)',
              borderRadius: '2px',
              padding: '3px 7px',
              marginBottom: 10,
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 10,
                color: 'var(--color-sand-400)',
                letterSpacing: '0.03em',
              }}
            >
              {content.range}
            </span>
          </div>

          {/* ── Violation guidance (tooHigh / tooLow) ── */}
          {violation && (
            <div
              style={{
                background: 'rgba(220,80,60,0.06)',
                border: '1px solid rgba(220,80,60,0.3)',
                borderRadius: '2px',
                padding: '8px 10px',
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'rgba(220,80,60,0.9)',
                  marginBottom: 4,
                }}
              >
                Out of tolerance
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 11,
                  color: 'var(--color-text-primary)',
                  lineHeight: 1.5,
                  marginBottom: 4,
                }}
              >
                ↑ {content.tooHigh}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 11,
                  color: 'var(--color-text-primary)',
                  lineHeight: 1.5,
                }}
              >
                ↓ {content.tooLow}
              </div>
            </div>
          )}

          {/* ── Pro tip ── */}
          {content.proTip && (
            <div
              style={{
                fontFamily: 'var(--font-display)', fontStyle: 'italic',
                fontSize: 11,
                color: 'var(--color-sand-400)',
                lineHeight: 1.5,
                marginTop: violation ? 0 : 4,
              }}
            >
              <span
                style={{
                  fontStyle: 'normal',
                  color: 'var(--color-accent)',
                  fontWeight: 600,
                  marginRight: 4,
                }}
              >
                Pro tip:
              </span>
              {content.proTip}
            </div>
          )}

          {/* ── Standard footnote ── */}
          {content.standard && (
            <div
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 9,
                color: 'var(--color-sand-400)',
                letterSpacing: '0.05em',
                marginTop: 8,
                opacity: 0.7,
              }}
            >
              {content.standard}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
