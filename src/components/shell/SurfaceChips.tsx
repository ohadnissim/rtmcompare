import React, { useCallback, useRef } from 'react'
import { useModes, type UserSurface } from '../../ModesContext'

/**
 * SurfaceChips — extracted from `App.tsx` (v1 lines 881–902) into a
 * v2 shell primitive. Single gold anchor for the entire screen
 * lives here: the active chip carries `data-gold` and the gold
 * colour tokens; nothing else in v2 should reach for gold while a
 * surface is active.
 *
 * Per `.rtm-design/v5.2-anti-ai-design.md`: chips are full-pill
 * radius, not `rounded-2xl`. Inactive chips have NO border, NO
 * hover background — only a colour shift on hover. Keep it bare.
 *
 * Accessibility:
 *   - `role="radiogroup"` with `aria-label="Delivery target"`.
 *   - Each chip is `role="radio"` with `aria-checked`.
 *   - Arrow keys (← → ↑ ↓) move focus and selection roving-tabindex
 *     style: only the active chip has tabIndex 0; others are -1.
 *   - Enter / Space activates whatever has focus.
 *
 * Tooltips: the existing strings from v1 are preserved verbatim so
 * users with the surface picker memorised don't get confused by
 * new copy.
 */
const SURFACES = ['streaming', 'full', 'broadcast', 'netflix', 'post'] as const
type Surface = (typeof SURFACES)[number]

const LABEL: Record<Surface, string> = {
 streaming: 'Music',
 full: 'Full',
 broadcast: 'Bcast',
 netflix: 'Netflix',
 post: 'Post',
}

const TITLE: Record<Surface, string> = {
 streaming: 'Streaming-only (music / Social). Hides broadcast and Atmos.',
 full: 'Everything — pro music + broadcast + Atmos.',
 broadcast: 'Broadcast-first: R128 / A85 at top, dialog gate prominent.',
 netflix: 'Netflix delivery spec — −27 LKFS dialog anchor, −2 dBTP ceiling, stereo + 5.1 music/effects, strict codec.',
 post: 'Atmos / immersive: ADM validation surfaced, broadcast + music also visible.',
}

interface Props {
 className?: string
}

export default function SurfaceChips({ className }: Props) {
 const { surface, setSurface } = useModes()
 const groupRef = useRef<HTMLDivElement>(null)

 const onKeyDown = useCallback(
 (e: React.KeyboardEvent<HTMLDivElement>) => {
 if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
 e.preventDefault()
 const idx = SURFACES.indexOf(surface as Surface)
 if (idx < 0) return
 let next = idx
 if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + SURFACES.length) % SURFACES.length
 else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % SURFACES.length
 else if (e.key === 'Home') next = 0
 else if (e.key === 'End') next = SURFACES.length - 1
 const nextSurface = SURFACES[next]
 setSurface(nextSurface as UserSurface)
 // Move focus to the newly-active chip so keyboard users keep their
 // place. The roving tabIndex below makes only the active chip
 // tabbable, so .focus() lands on it after re-render.
 requestAnimationFrame(() => {
 const el = groupRef.current?.querySelector<HTMLButtonElement>(`[data-chip="${nextSurface}"]`)
 el?.focus()
 })
 },
 [surface, setSurface]
 )

 return (
 <div
 ref={groupRef}
 role="radiogroup"
 aria-label="Delivery target"
 onKeyDown={onKeyDown}
 className={className}
 data-tour="surface-picker"
 style={{
 display: 'inline-flex',
 alignItems: 'center',
 gap: 2,
 padding: 2,
 borderRadius: 'var(--radius-pill)',
 backgroundColor: 'var(--rtm-chip-bg-inactive)',
 }}
 >
 {SURFACES.map((s) => {
 const active = surface === s
 return (
 <button
 key={s}
 type="button"
 role="radio"
 aria-checked={active}
 tabIndex={active ? 0 : -1}
 onClick={() => setSurface(s as UserSurface)}
 title={TITLE[s]}
 data-chip={s}
 data-gold={active || undefined}
 style={{
 fontFamily: 'var(--font-sans)',
 fontWeight: 500,
 fontSize: 'var(--text-metric-eyebrow)',
 letterSpacing: '0.14em',
 textTransform: 'uppercase',
 padding: '2px 10px',
 border: 'none',
 borderRadius: 'var(--radius-pill)',
 cursor: 'pointer',
 transition: 'color 120ms var(--easing-shell), background-color 120ms var(--easing-shell)',
 backgroundColor: active ? 'var(--rtm-chip-bg-active)' : 'transparent',
 color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
 // No outline override — focus-visible ring handled globally via
 // browser default which already lands inside the pill at our
 // padding. If we ever need bespoke focus, route through
 // --color-accent at 50% per the brief.
 }}
 >
 {LABEL[s]}
 </button>
 )
 })}
 </div>
 )
}
