/**
 * InfoTip — lightweight ⓘ badge with an educational tooltip popover.
 *
 * Only renders when Learn Mode is active. Positions with `position: fixed`
 * to avoid clipping inside overflow-hidden parents.
 *
 * Design system compliance:
 *   - Gold accent: var(--color-accent) / rgba(208,176,102,…)
 *   - Dark background: var(--color-sand-900) / rgba(14,13,11,…)
 *   - borderRadius: 2px (no rounded-md/lg/xl)
 *   - No backdropFilter or boxShadow card-lift
 */

import React, { useState, useRef, useEffect, useId } from 'react'
import { useLearnMode } from '../../context/LearnModeContext'

interface InfoTipProps {
  /** Bold title shown at the top of the popover */
  label: string
  /** Explanation text shown in the body */
  body: string
}

export default function InfoTip({ label, body }: InfoTipProps) {
  const { enabled } = useLearnMode()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const tipId = useId()

  // Reposition the fixed popover whenever it opens
  useEffect(() => {
    if (!open || !btnRef.current) { setPos(null); return }
    const rect = btnRef.current.getBoundingClientRect()
    const POP_W = 320
    const POP_H = 120 // rough estimate; real height may be taller but clamping is conservative
    const MARGIN = 12
    const vw = window.innerWidth
    const vh = window.innerHeight

    let top = rect.bottom + 6
    let left = rect.left + rect.width / 2 - POP_W / 2
    // Clamp
    left = Math.max(MARGIN, Math.min(vw - POP_W - MARGIN, left))
    top  = Math.max(MARGIN, Math.min(vh - POP_H - MARGIN, top))
    setPos({ top, left })
  }, [open])

  // Don't render anything when Learn Mode is off
  if (!enabled) return null

  return (
    <>
      <button
        ref={btnRef}
        aria-describedby={open ? tipId : undefined}
        aria-label={`Learn more: ${label}`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          fontSize: 9,
          lineHeight: '14px',
          borderRadius: '50%',
          border: '1px solid rgba(208,176,102,0.45)',
          color: 'rgba(208,176,102,0.65)',
          background: 'transparent',
          cursor: 'default',
          marginLeft: 4,
          verticalAlign: 'middle',
          flexShrink: 0,
          userSelect: 'none',
          padding: 0,
        }}
      >
        ⓘ
      </button>

      {open && pos && (
        <div
          id={tipId}
          role="tooltip"
          style={{
            position: 'fixed',
            zIndex: 9000,
            top: pos.top,
            left: pos.left,
            width: 320,
            background: 'rgba(14,13,11,0.97)',
            border: '1px solid rgba(208,176,102,0.25)',
            borderRadius: '2px',
            padding: '12px 14px',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--color-accent)',
              marginBottom: 6,
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              color: 'var(--color-sand-300, rgba(200,193,180,0.9))',
              lineHeight: 1.5,
            }}
          >
            {body}
          </div>
        </div>
      )}
    </>
  )
}
