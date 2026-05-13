/**
 * LearnModeToggle — compact badge in the HeaderV2 presence row that
 * activates / deactivates RTMcompare's guided Learn Mode.
 *
 * When Learn Mode is OFF the badge is a subtle outlined chip.
 * When ON the border glows with the gold accent colour and an inline
 * role switcher (Student | Teacher) appears to the right of the badge.
 *
 * Follows the RTMcompare design system strictly:
 *   - borderRadius 2px (never rounded-md / rounded-lg etc.)
 *   - Gold only as border / text accent, never as fill
 *   - CSS custom properties for all colours
 *   - No boxShadow / backdropFilter
 */

import React from 'react'
import { useLearnMode } from '../../context/LearnModeContext'
import type { LearnRole } from '../../types'

interface Props {
  /** Disable the toggle when no analysis results are loaded yet. */
  disabled?: boolean
}

export default function LearnModeToggle({ disabled = false }: Props) {
  const { enabled, role, toggleLearnMode, setRole } = useLearnMode()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* Main toggle badge — disabled until analysis results are present */}
      <button
        type="button"
        onClick={disabled ? undefined : toggleLearnMode}
        disabled={disabled}
        aria-pressed={enabled}
        aria-label={
          disabled
            ? 'Learn Mode — run analysis first'
            : enabled ? 'Disable Learn Mode' : 'Enable Learn Mode'
        }
        title={disabled ? 'Run analysis first to enable Learn Mode' : undefined}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 10px',
          borderRadius: 2,
          border: enabled
            ? '1px solid rgba(208,176,102,0.7)'
            : '1px solid rgba(208,176,102,0.25)',
          backgroundColor: enabled ? 'rgba(208,176,102,0.08)' : 'transparent',
          color: enabled ? 'var(--color-text-primary)' : 'var(--color-text-dim, var(--color-sand-400, #a8a29e))',
          fontFamily: 'var(--font-sans)',
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.4 : 1,
          transition: 'border-color 150ms ease, color 150ms ease, background-color 150ms ease',
          whiteSpace: 'nowrap',
        }}
      >
        {enabled ? (
          <>
            <span style={{ color: 'var(--color-accent, #d0b066)' }}>✓</span>
            {' '}Learn Mode
          </>
        ) : (
          'Learn Mode'
        )}
      </button>

      {/* Role toggle — only visible when Learn Mode is ON */}
      {enabled && (
        <div
          role="group"
          aria-label="Learn Mode role"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: '2px 3px',
            borderRadius: 2,
            border: '1px solid rgba(208,176,102,0.2)',
            backgroundColor: 'transparent',
          }}
        >
          {(['student', 'teacher'] as LearnRole[]).map((r) => {
            const active = role === r
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                aria-pressed={active}
                style={{
                  padding: '2px 8px',
                  borderRadius: 2,
                  border: 'none',
                  backgroundColor: active ? 'rgba(208,176,102,0.12)' : 'transparent',
                  color: active
                    ? 'var(--color-accent, #d0b066)'
                    : 'var(--color-text-dim, var(--color-sand-400, #a8a29e))',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 10,
                  letterSpacing: '0.14em',
                  textTransform: 'capitalize',
                  cursor: 'pointer',
                  transition: 'background-color 120ms ease, color 120ms ease',
                }}
              >
                {r}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
