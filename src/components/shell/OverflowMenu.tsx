import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useModes } from '../../ModesContext'
import { useTheme } from '../../ThemeContext'

/**
 * OverflowMenu — the `⋯` dropdown that consolidates secondary v2
 * shell controls (per `.rtm-design/v5.2-shell-brief.md` task #10).
 *
 * Rows, in order:
 *   1. Advanced QC toggle
 *   2. Learn mode toggle
 *   3. Blind A/B toggle (only when `canShowBlind`)
 *   4. Zoom controls (− / reset / +)
 *   5. Theme switch (dark / light)
 *   6. Shell version (v2 New / v1 Classic)
 *   7. Shortcuts link (calls `onOpenShortcuts`)
 *
 * The menu is a panel, not a popover library — kept dependency-free
 * because everything we need (focus trap, click-outside, Esc to
 * close) is a handful of lines and the component never needs to
 * portal or escape an overflow:hidden ancestor in the v2 layout.
 *
 * Anti-AI-design adherence: no card shadow with rounded-2xl. Only
 * the discreet `--shadow-overflow-menu` token (deep ambient + 1px
 * inset highlight). Sharp 2px corners. No icons next to row labels.
 */
interface ZoomControls {
 value: number
 pct: string
 in: () => void
 out: () => void
 reset: () => void
 outDisabled?: boolean
 inDisabled?: boolean
}

interface Props {
 canShowBlind?: boolean
 zoom?: ZoomControls
 onOpenShortcuts?: () => void
 className?: string
}

export default function OverflowMenu({ canShowBlind = false, zoom, onOpenShortcuts, className }: Props) {
 const [open, setOpen] = useState(false)
 const triggerRef = useRef<HTMLButtonElement>(null)
 const panelRef = useRef<HTMLDivElement>(null)
 const menuId = useId()

 const { educator, blind, advancedQc, toggleEducator, toggleBlind, toggleAdvancedQc } = useModes()
 const { theme, toggle: toggleTheme } = useTheme()

 // Close on click-outside. Bound only while open to avoid a global
 // listener leaking when the menu's not in use.
 useEffect(() => {
 if (!open) return
 const onDown = (e: MouseEvent) => {
 const t = e.target as Node
 if (panelRef.current?.contains(t)) return
 if (triggerRef.current?.contains(t)) return
 setOpen(false)
 }
 document.addEventListener('mousedown', onDown)
 return () => document.removeEventListener('mousedown', onDown)
 }, [open])

 // Esc to close + focus trap. We don't shuffle Tab order — letting
 // the browser walk the panel's focusable elements naturally is
 // accessible and predictable. We just bracket the panel so Tab
 // out hops back in instead of escaping to the rest of the page.
 useEffect(() => {
 if (!open) return
 const onKey = (e: KeyboardEvent) => {
 if (e.key === 'Escape') {
 e.preventDefault()
 setOpen(false)
 // Return focus to trigger so the keyboard user resumes
 // exactly where they were.
 triggerRef.current?.focus()
 }
 if (e.key === 'Tab') {
 const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
 'button, [href], input, [tabindex]:not([tabindex="-1"])'
 )
 if (!focusables || focusables.length === 0) return
 const first = focusables[0]
 const last = focusables[focusables.length - 1]
 if (e.shiftKey && document.activeElement === first) {
 e.preventDefault()
 last.focus()
 } else if (!e.shiftKey && document.activeElement === last) {
 e.preventDefault()
 first.focus()
 }
 }
 }
 document.addEventListener('keydown', onKey)
 return () => document.removeEventListener('keydown', onKey)
 }, [open])

 // When opening, move focus into the panel (first focusable) so
 // keyboard users land somewhere sensible.
 useEffect(() => {
 if (!open) return
 const t = window.setTimeout(() => {
 const first = panelRef.current?.querySelector<HTMLElement>(
 'button, [href], input, [tabindex]:not([tabindex="-1"])'
 )
 first?.focus()
 }, 0)
 return () => window.clearTimeout(t)
 }, [open])

 const onToggleClick = useCallback(() => setOpen((o) => !o), [])

 return (
 <div className={className} style={{ position: 'relative' }}>
 <button
 ref={triggerRef}
 type="button"
 aria-haspopup="menu"
 aria-expanded={open}
 aria-controls={menuId}
 onClick={onToggleClick}
 title="More controls"
 style={{
 width: 28,
 height: 28,
 borderRadius: 'var(--radius-pill)',
 border: 'none',
 background: 'transparent',
 cursor: 'pointer',
 color: 'var(--color-text-muted)',
 fontSize: 18,
 lineHeight: 1,
 transition: 'color 120ms var(--easing-shell), background-color 120ms var(--easing-shell)',
 }}
 onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text-primary)')}
 onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
 >
 ⋯
 </button>

 {open && (
 <div
 ref={panelRef}
 id={menuId}
 role="menu"
 aria-label="More controls"
 style={{
 position: 'absolute',
 right: 0,
 top: 'calc(100% + 8px)',
 width: 'var(--w-overflow-menu)',
 padding: 'var(--pad-overflow-menu)',
 backgroundColor: 'var(--color-bg-panel)',
 borderRadius: 'var(--radius-card)',
 boxShadow: 'var(--rtm-overflow-shadow)',
 zIndex: 50,
 transition: `opacity var(--duration-menu) var(--easing-shell)`,
 // Reduced motion: spring through is fine, opacity-only is gentle.
 // The browser's media query is honoured by the easing token at
 // the global level — no additional guard needed here since we
 // don't transform.
 }}
 >
 <Row label="Advanced QC" control={<Toggle checked={advancedQc} onChange={toggleAdvancedQc} ariaLabel="Advanced QC" />} />
 <Row label="Learn mode" control={<Toggle checked={educator} onChange={toggleEducator} ariaLabel="Learn mode" />} />
 {canShowBlind && (
 <Row label="Blind A/B" control={<Toggle checked={blind} onChange={toggleBlind} ariaLabel="Blind A/B" />} />
 )}
 {zoom && (
 <Row
 label="Zoom"
 control={
 <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
 <IconButton onClick={zoom.out} disabled={zoom.outDisabled} ariaLabel="Zoom out" glyph="−" />
 <button
 type="button"
 onClick={zoom.reset}
 style={{
 fontFamily: 'var(--font-mono)',
 fontSize: 11,
 color: zoom.value === 1.0 ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
 background: 'transparent',
 border: 'none',
 padding: '0 4px',
 cursor: 'pointer',
 fontVariantNumeric: 'tabular-nums',
 }}
 title="Reset zoom"
 >
 {zoom.pct}
 </button>
 <IconButton onClick={zoom.in} disabled={zoom.inDisabled} ariaLabel="Zoom in" glyph="+" />
 </div>
 }
 />
 )}
 <Row
 label="Theme"
 control={
 <RadioPair
 options={[
 { value: 'dark', label: 'Dark' },
 { value: 'light', label: 'Light' },
 ]}
 value={theme}
 onChange={(v) => v !== theme && toggleTheme()}
 ariaLabel="Theme"
 />
 }
 />
          {onOpenShortcuts && (
 <Row
 label="Keyboard shortcuts"
 control={
 <button
 type="button"
 onClick={() => {
 setOpen(false)
 onOpenShortcuts()
 }}
 style={{
 fontFamily: 'var(--font-sans)',
 fontSize: 12,
 color: 'var(--color-text-secondary)',
 background: 'transparent',
 border: 'none',
 padding: 0,
 cursor: 'pointer',
 letterSpacing: '0.02em',
 }}
 >
 Open →
 </button>
 }
 />
 )}
 </div>
 )}
 </div>
 )
}

// ─────────────────────────────────────────────────────────────────
// Row + Toggle + IconButton + RadioPair are local to the menu.
// They're not exported because they're shaped to this menu's
// rhythm (32px row height, label-control gap), not generic.

function Row({ label, control }: { label: string; control: React.ReactNode }) {
 return (
 <div
 role="menuitem"
 style={{
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'space-between',
 height: 'var(--h-overflow-row)',
 padding: '0 8px',
 gap: 'var(--gap-overflow-row)',
 borderRadius: 'var(--radius-card)',
 }}
 >
 <span
 style={{
 fontFamily: 'var(--font-sans)',
 fontSize: 13,
 color: 'var(--color-text-secondary)',
 }}
 >
 {label}
 </span>
 {control}
 </div>
 )
}

function Toggle({
 checked,
 onChange,
 ariaLabel,
}: {
 checked: boolean
 onChange: () => void
 ariaLabel: string
}) {
 return (
 <button
 type="button"
 role="switch"
 aria-checked={checked}
 aria-label={ariaLabel}
 onClick={onChange}
 style={{
 width: 32,
 height: 18,
 borderRadius: 'var(--radius-pill)',
 border: '1px solid var(--rtm-toggle-border)',
 background: checked ? 'var(--rtm-chip-bg-active)' : 'transparent',
 position: 'relative',
 cursor: 'pointer',
 transition: 'background-color 120ms var(--easing-shell)',
 padding: 0,
 }}
 >
 <span
 aria-hidden
 style={{
 position: 'absolute',
 top: 2,
 left: checked ? 16 : 2,
 width: 12,
 height: 12,
 borderRadius: 'var(--radius-pill)',
 backgroundColor: checked ? 'var(--color-accent)' : 'var(--color-text-muted)',
 transition: 'left 120ms var(--easing-shell), background-color 120ms var(--easing-shell)',
 }}
 />
 </button>
 )
}

function IconButton({
 onClick,
 disabled,
 ariaLabel,
 glyph,
}: {
 onClick: () => void
 disabled?: boolean
 ariaLabel: string
 glyph: string
}) {
 return (
 <button
 type="button"
 onClick={onClick}
 disabled={disabled}
 aria-label={ariaLabel}
 style={{
 width: 22,
 height: 22,
 borderRadius: 'var(--radius-pill)',
 border: 'none',
 background: 'var(--rtm-chip-bg-inactive)',
 color: 'var(--color-text-secondary)',
 fontSize: 13,
 lineHeight: 1,
 cursor: disabled ? 'not-allowed' : 'pointer',
 opacity: disabled ? 0.3 : 1,
 padding: 0,
 }}
 >
 {glyph}
 </button>
 )
}

function RadioPair<T extends string>({
 options,
 value,
 onChange,
 ariaLabel,
}: {
 options: { value: T; label: string }[]
 value: T
 onChange: (v: T) => void
 ariaLabel: string
}) {
 return (
 <div
 role="radiogroup"
 aria-label={ariaLabel}
 style={{
 display: 'inline-flex',
 alignItems: 'center',
 gap: 2,
 padding: 2,
 borderRadius: 'var(--radius-pill)',
 backgroundColor: 'var(--rtm-chip-bg-inactive)',
 }}
 >
 {options.map((o) => {
 const active = o.value === value
 return (
 <button
 key={o.value}
 type="button"
 role="radio"
 aria-checked={active}
 onClick={() => onChange(o.value)}
 style={{
 fontFamily: 'var(--font-sans)',
 fontSize: 11,
 fontWeight: 500,
 padding: '2px 8px',
 borderRadius: 'var(--radius-pill)',
 border: 'none',
 cursor: 'pointer',
 backgroundColor: active ? 'var(--rtm-chip-bg-active)' : 'transparent',
 color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
 transition: 'color 120ms var(--easing-shell), background-color 120ms var(--easing-shell)',
 }}
 >
 {o.label}
 </button>
 )
 })}
 </div>
 )
}
