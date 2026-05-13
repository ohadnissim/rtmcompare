/**
 * ThemedConfirmDialog — v5.2 Console Didone confirmation modal.
 *
 * Replaces native window.confirm() across the app. Consistent ink ground,
 * 2px corners, Instrument Serif italic title, tracked-caps eyebrow.
 *
 * Props:
 *   title        — Instrument Serif italic headline
 *   body         — optional paragraph below the title
 *   tone         — 'default' | 'final' | 'destructive'
 *                  final/destructive: gold confirm button
 *                  default: sand-ghost confirm button
 *   confirmLabel — CTA label (default "Confirm")
 *   cancelLabel  — cancel label (default "Cancel")
 *   onConfirm    — called when user confirms
 *   onCancel     — called when user cancels or presses Escape
 *   actionSlot   — optional React node below the body, before the buttons
 *
 * Accessibility: role=dialog, aria-modal, focus trap (Tab cycles confirm ↔ cancel),
 * Escape cancels, focus restored to previously-focused element on close.
 */

import React, { useEffect, useRef } from 'react'

export interface ThemedConfirmDialogProps {
  title: string
  body?: string
  tone?: 'default' | 'final' | 'destructive'
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  actionSlot?: React.ReactNode
}

const SAND_700 = 'rgba(168,161,150,0.22)'
const SAND_400 = 'var(--color-text-muted)'
const SAND_200 = '#cfc8bb'
const CREAM = 'var(--color-text-primary)'
const GOLD = 'var(--color-accent)'
const INK = 'var(--color-bg-app)'
const PANEL = 'var(--color-bg-panel, #1c1b17)'

export function ThemedConfirmDialog({
  title,
  body,
  tone = 'default',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  actionSlot,
}: ThemedConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  // Save previously focused element, restore on unmount.
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement
    confirmRef.current?.focus()
    return () => {
      previousFocus.current?.focus()
    }
  }, [])

  // Escape cancels; Tab cycles within the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
      if (e.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button')
        if (!focusable || focusable.length < 2) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus() }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus() }
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const isGold = tone === 'final' || tone === 'destructive'

  return (
    // Backdrop
    <div
      role="presentation"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(14,13,11,0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      {/* Dialog panel — stop propagation so backdrop click doesn't close */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rtm-confirm-title"
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: PANEL,
          border: `1px solid ${SAND_700}`,
          borderRadius: 2,
          padding: '28px 32px',
          maxWidth: 440,
          width: '90vw',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* Eyebrow */}
        <div style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 9,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: SAND_400,
        }}>
          {tone === 'destructive' ? 'Destructive action' : tone === 'final' ? 'Commit' : 'Confirm'}
        </div>

        {/* Title */}
        <h2
          id="rtm-confirm-title"
          style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 20,
            color: CREAM,
            margin: 0,
            lineHeight: 1.2,
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h2>

        {/* Body */}
        {body && (
          <p style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            lineHeight: 1.5,
            color: SAND_200,
            margin: 0,
          }}>
            {body}
          </p>
        )}

        {/* Optional slot */}
        {actionSlot}

        {/* Divider */}
        <div style={{ height: 1, backgroundColor: SAND_700 }} />

        {/* Button row */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          {/* Cancel — always sand-ghost */}
          <button
            type="button"
            onClick={onCancel}
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              fontWeight: 500,
              padding: '9px 20px',
              borderRadius: 2,
              border: `1px solid ${SAND_700}`,
              backgroundColor: 'transparent',
              color: SAND_400,
              cursor: 'pointer',
            }}
          >
            {cancelLabel}
          </button>

          {/* Confirm — gold for final/destructive, sand for default */}
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              fontWeight: 500,
              padding: '9px 20px',
              borderRadius: 2,
              border: `1px solid ${isGold ? GOLD : SAND_700}`,
              backgroundColor: isGold ? GOLD : 'transparent',
              color: isGold ? INK : CREAM,
              cursor: 'pointer',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ThemedConfirmDialog
