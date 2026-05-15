import React, { useState, useEffect, useCallback, useRef } from 'react'
import Wordmark from './shell/Wordmark'

/**
 * First-run onboarding. Welcome modal, then a 5-step spotlight over the
 * upload screen. Flag lives in localStorage (`rtm-tour-done`); header has
 * a "View tour again" button.
 */

type TourState =
 | { kind: 'welcome' }
 | { kind: 'spotlight'; step: number }
 | { kind: 'feature-tip'; id: string }
 | { kind: 'done' }

export interface TourStep {
 /** CSS selector for the element to spotlight. */
 selector: string
 /** Preferred placement relative to the element. */
 placement?: 'top' | 'bottom' | 'left' | 'right' | 'center'
 title: string
 body: string
 /** Minimum viewport width for this step to be useful. */
 minWidth?: number
}

const DEFAULT_UPLOAD_STEPS: TourStep[] = [
 {
 selector: '[data-tour="dropzone"]',
 placement: 'bottom',
 title: 'Drop two tracks here',
 body: 'Left side, the sound you want to chase. Right side, the mix or master you\'re working on. WAV, FLAC, MP3, AIFF, ADM BWF. 16/24/32-bit, up to 192 kHz.',
 },
 {
 selector: '[data-tour="overflow-menu"]',
 placement: 'bottom',
 title: 'Settings & your name',
 body: 'Hit ⋯ to set your engineer name (it shows up on every certificate), toggle Learn Mode, switch themes, and control zoom. Your name is saved locally.',
 },
 {
 selector: '[data-tour="surface-picker"]',
 placement: 'center',
 title: 'Six views, one session',
 body: 'After analysis, tabs give you Overview, Mix Breakdown, Stereo & Spectrum, EQ Match, Mastering Delta, and QC. Switch freely — the comparison stays live.',
 },
 {
 selector: '[data-tour-target="player"]',
 placement: 'center',
 title: 'Level-matched A/B playback',
 body: 'Hit Space to flip between A and B at matched loudness — no volume bias. Codec previews (AAC, Opus, HE-AAC) let you hear how streaming will colour your master before you commit.',
 },
 {
 selector: '[data-tour-learn="bar"]',
 placement: 'center',
 title: 'Learn Mode for classrooms',
 body: 'Turn on Learn Mode (⋯ menu) to get guided curriculum steps, ear training, and assignment rubrics. Teachers get a grade book and Canvas LMS export. Students get a practice report PDF.',
 },
]

export function useTourState() {
 const [state, setState] = useState<TourState>(() => {
 try {
 // Check localStorage first (durable), then sessionStorage as a
 // backup for private-mode / quota-exceeded cases. Defensive
 // against " Suspected root cause
 // was a localStorage write that didn't persist on some platforms
 // — sessionStorage backup guarantees we never re-show within the
 // same browser session even if localStorage fails silently.
 const lsDone = localStorage.getItem('rtm-tour-done') === '1'
 const ssDone = sessionStorage.getItem('rtm-tour-done') === '1'
 return (lsDone || ssDone) ? { kind: 'done' } : { kind: 'welcome' }
 } catch {
 return { kind: 'done' }
 }
 })

 const markDone = () => {
 try { localStorage.setItem('rtm-tour-done', '1') } catch {}
 try { sessionStorage.setItem('rtm-tour-done', '1') } catch {}
 }

 const startTour = useCallback(() => setState({ kind: 'welcome' }), [])
 const skipTour = useCallback(() => {
 markDone()
 setState({ kind: 'done' })
 }, [])
 const beginSpotlight = useCallback(() => {
 // Begin-spotlight also marks done-in-session so navigating away
 // mid-spotlight never re-fires the welcome on return — only the
 // remaining spotlight steps resume. User-visible effect: once
 // they've actively engaged with the tour, the welcome is behind
 // them forever, even if the flag write fails.
 markDone()
 setState({ kind: 'spotlight', step: 0 })
 }, [])
 const nextStep = useCallback(() => {
 setState(s => {
 if (s.kind !== 'spotlight') return s
 const next = s.step + 1
 if (next >= DEFAULT_UPLOAD_STEPS.length) {
 markDone()
 return { kind: 'done' }
 }
 return { kind: 'spotlight', step: next }
 })
 }, [])
 const prevStep = useCallback(() => {
 setState(s => {
 if (s.kind !== 'spotlight' || s.step === 0) return s
 return { kind: 'spotlight', step: s.step - 1 }
 })
 }, [])

 return { state, startTour, skipTour, beginSpotlight, nextStep, prevStep }
}

/* ─── Main component ─────────────────────────────────────────────────────── */

export default function OnboardingTour({ externalTour }: { externalTour?: ReturnType<typeof useTourState> }) {
 // Allow the parent App to inject the same tour state so the header "Tour"
 // button can reset / restart the flow; otherwise manage our own instance.
 const internal = useTourState()
 const tour = externalTour || internal
 const { state, skipTour, beginSpotlight, nextStep, prevStep } = tour

 if (state.kind === 'done') return null

 if (state.kind === 'welcome') return <WelcomeModal onStart={beginSpotlight} onSkip={skipTour} />

 if (state.kind === 'spotlight') {
 const step = DEFAULT_UPLOAD_STEPS[state.step]
 return (
 <SpotlightStep
 step={step}
 stepIndex={state.step}
 totalSteps={DEFAULT_UPLOAD_STEPS.length}
 onNext={nextStep}
 onPrev={prevStep}
 onSkip={skipTour}
 />
 )
 }
 return null
}

/* ─── Welcome Modal ──────────────────────────────────────────────────────── */

function WelcomeModal({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
 const startBtnRef = useRef<HTMLButtonElement | null>(null)
 const containerRef = useRef<HTMLDivElement | null>(null)

 // Focus the primary action when the modal mounts.
 useEffect(() => {
 startBtnRef.current?.focus()
 }, [])

 // Tab cycle + Escape to skip — matches CommandPalette focus-trap pattern.
 const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
 if (e.key === 'Escape') {
 e.preventDefault()
 onSkip()
 return
 }
 if (e.key !== 'Tab') return
 const container = containerRef.current
 if (!container) return
 const focusable = container.querySelectorAll<HTMLElement>(
 'input, button, [tabindex]:not([tabindex="-1"])'
 )
 if (focusable.length === 0) return
 const first = focusable[0]
 const last = focusable[focusable.length - 1]
 if (e.shiftKey) {
 if (document.activeElement === first) { e.preventDefault(); last.focus() }
 } else {
 if (document.activeElement === last) { e.preventDefault(); first.focus() }
 }
 }

 return (
 <div
 ref={containerRef}
 role="dialog"
 aria-modal="true"
 aria-labelledby="welcome-modal-title"
 onKeyDown={handleKeyDown}
 className="fixed inset-0 z-[100] flex items-center justify-center"
 style={{ backgroundColor: 'rgba(14,13,11,0.92)' }}
 >
 <div className="relative max-w-3xl mx-6 p-10 grid grid-cols-5 gap-10"
 style={{ borderRadius: '2px', backgroundColor: 'var(--color-sand-900)', border: '1px solid rgba(168,161,150,0.12)' }}>
 {/* Decorative mark — demoted to sand so the single gold on this
    surface is the primary CTA border (Console Didone single-gold rule). */}
 <span
 aria-hidden="true"
 className="absolute"
 style={{
 top: '20px',
 right: '20px',
 width: '4px',
 height: '4px',
 backgroundColor: 'var(--color-sand-600)',
 transform: 'rotate(45deg)',
 }}
 />

 {/* Left column — wordmark, promise, primary action. */}
 <div className="col-span-3 flex flex-col">
 <div className="text-left"><Wordmark size="lg" /></div>
 {/* 5.7.2 copy: */}
 <h2 id="welcome-modal-title" className="mt-4 text-left" style={{ fontSize: '18px', lineHeight: 1.4, color: 'var(--color-text-primary)', fontWeight: 400 }}>
 QC, compare, deliver.
 </h2>
 {/* 5.7.2 copy: */}
 <p className="mt-3 text-left text-sm leading-relaxed" style={{ color: 'var(--color-sand-300)' }}>
 Level-matched A/B, codec-accurate streaming previews (AAC LC, Opus, HE-AAC v2), and EQ moves you can audition before render.
 </p>

 <div className="mt-auto pt-8 flex items-center gap-4">
 <button
 ref={startBtnRef}
 onClick={onStart}
 className="text-[11px] px-5 py-2.5 transition-colors"
 style={{
 borderRadius: '2px',
 backgroundColor: 'var(--color-bg-app)',
 color: 'var(--color-text-primary)',
 border: '2px solid var(--color-accent)',
 }}
 >
 {/* 5.7.2 copy: */}
 Walk me through it
 </button>
 <button
 onClick={onSkip}
 className="text-[11px] px-2 py-2 transition-colors"
 style={{ color: 'var(--color-text-muted)', background: 'transparent', border: 'none' }}
 >
 {/* 5.7.2 copy: */}
 Skip
 </button>
 </div>
 </div>

 {/* Right column — vertical hairline + four pillars stacked. */}
 <div className="col-span-2 pl-8 flex flex-col gap-5" style={{ borderLeft: '1px solid var(--color-sand-700)' }}>
 {/* 5.7.2 copy: */}
 <Pillar title="Drop. Compare." body="Two files, levels matched, every difference laid out side by side." />
 {/* 5.7.2 copy: */}
 <Pillar title="Catch it early." body="Clips, hum, mono problems, missing tags — spotted before the label calls." />
 {/* 5.7.2 copy: */}
 <Pillar title="EQ you can hear." body="Match a reference, audition the moves live, export to Pro-Q or bounce a corrected WAV." />
 {/* 5.7.2 copy: */}
 <Pillar title="Stays on your Mac." body="Every measurement runs locally. Your audio never leaves." />
 </div>
 </div>
 </div>
 )
}

function Pillar({ title, body }: { title: string; body: string }) {
 return (
 <div>
 <div className="text-[10px] tracking-[0.18em] uppercase mb-1" style={{ color: 'var(--color-text-primary)' }}>{title}</div>
 <div className="text-[11px] leading-relaxed" style={{ color: 'var(--color-sand-300)' }}>{body}</div>
 </div>
 )
}

/* ─── Spotlight Step ─────────────────────────────────────────────────────── */

function SpotlightStep({ step, stepIndex, totalSteps, onNext, onPrev, onSkip }: {
 step: TourStep
 stepIndex: number
 totalSteps: number
 onNext: () => void
 onPrev: () => void
 onSkip: () => void
}) {
 const [rect, setRect] = useState<DOMRect | null>(null)

 // Measure the target element + re-measure on resize/scroll/zoom
 useEffect(() => {
 const measure = () => {
 const el = document.querySelector(step.selector)
 if (el) {
 const r = el.getBoundingClientRect()
 setRect(r)
 // Scroll into view if off-screen
 if (r.top < 40 || r.bottom > window.innerHeight - 40) {
 el.scrollIntoView({ behavior: 'smooth', block: 'center' })
 }
 } else {
 setRect(null)
 }
 }
 measure()
 // Re-measure after a tick so layout settles
 const id = setTimeout(measure, 50)
 window.addEventListener('resize', measure)
 window.addEventListener('scroll', measure, true)
 return () => {
 clearTimeout(id)
 window.removeEventListener('resize', measure)
 window.removeEventListener('scroll', measure, true)
 }
 }, [step.selector])

 const isFirst = stepIndex === 0
 const isLast = stepIndex === totalSteps - 1

 // Backdrop with cut-out around the target rectangle (using SVG mask).
 const W = typeof window !== 'undefined' ? window.innerWidth : 1200
 const H = typeof window !== 'undefined' ? window.innerHeight : 800
 // Estimated popover size used for edge-clamping. Keeps the popover on
 // screen regardless of the target rect's position.
 const POP_W = 360
 const POP_H = 200
 const MARGIN = 24
 const clampX = (x: number) => Math.max(MARGIN, Math.min(W - POP_W - MARGIN, x))
 const clampY = (y: number) => Math.max(MARGIN, Math.min(H - POP_H - MARGIN, y))

 // Popover placement — true centre by default; anchor to the target
 // rect with clamped edges when placement is directional.
 let popoverStyle: React.CSSProperties = {
 left: clampX(W / 2 - POP_W / 2),
 top: clampY(H / 2 - POP_H / 2),
 width: POP_W,
 }
 if (rect) {
 const pad = 16
 switch (step.placement || 'bottom') {
 case 'top':
 popoverStyle = { left: clampX(rect.left + rect.width / 2 - POP_W / 2), top: clampY(rect.top - POP_H - pad), width: POP_W }
 break
 case 'bottom':
 popoverStyle = { left: clampX(rect.left + rect.width / 2 - POP_W / 2), top: clampY(rect.bottom + pad), width: POP_W }
 break
 case 'left':
 popoverStyle = { left: clampX(rect.left - POP_W - pad), top: clampY(rect.top + rect.height / 2 - POP_H / 2), width: POP_W }
 break
 case 'right':
 popoverStyle = { left: clampX(rect.right + pad), top: clampY(rect.top + rect.height / 2 - POP_H / 2), width: POP_W }
 break
 case 'center':
 default:
 popoverStyle = { left: clampX(W / 2 - POP_W / 2), top: clampY(H / 2 - POP_H / 2), width: POP_W }
 }
 }

 return (
 <>
 {/* Backdrop + cut-out — pointer-events-none so the dim layer never
 intercepts clicks on the underlying app. Use the popover Next/Back
 buttons to advance. */}
 <svg
 className="fixed inset-0 z-[99] pointer-events-none"
 width={W} height={H}
 style={{ width: '100vw', height: '100vh' }}
 >
 <defs>
 <mask id="rtm-tour-cutout">
 <rect x={0} y={0} width={W} height={H} fill="white" />
 {rect && (
 <rect
 x={rect.left - 8}
 y={rect.top - 8}
 width={rect.width + 16}
 height={rect.height + 16}
 rx={12}
 fill="black"
 />
 )}
 </mask>
 </defs>
 <rect x={0} y={0} width={W} height={H} fill="rgba(14,13,11,0.78)" mask="url(#rtm-tour-cutout)" />
 {rect && (
 <rect
 x={rect.left - 8}
 y={rect.top - 8}
 width={rect.width + 16}
 height={rect.height + 16}
 rx={12}
 fill="none"
 stroke="rgba(208,176,102,0.75)"
 strokeWidth={1.5}
 style={{
 pointerEvents: 'none',
 // Smooth glide to match the popover — same easing + duration.
 transition: 'x 300ms cubic-bezier(0.2, 0.8, 0.2, 1), y 300ms cubic-bezier(0.2, 0.8, 0.2, 1), width 300ms cubic-bezier(0.2, 0.8, 0.2, 1), height 300ms cubic-bezier(0.2, 0.8, 0.2, 1)',
 }}
 />
 )}
 </svg>

 {/* Popover */}
 <div
 className="fixed z-[100] p-5 space-y-3"
 style={{
 ...popoverStyle,
 backgroundColor: 'var(--color-sand-900)',
 border: '1px solid rgba(208,176,102,0.35)',
 borderRadius: '2px',
 maxHeight: 'calc(100vh - 2rem)',
 overflowY: 'auto',
 // Smooth movement between steps — no more teleport.
 transition: 'left 300ms cubic-bezier(0.2, 0.8, 0.2, 1), top 300ms cubic-bezier(0.2, 0.8, 0.2, 1), width 300ms ease',
 }}
 onClick={e => e.stopPropagation()}
 >
 <div className="flex items-center justify-between">
 <span className="text-[9px] tracking-[0.18em] uppercase" style={{ color: 'var(--color-accent)' }}>
 Step {stepIndex + 1} of {totalSteps}
 </span>
 {/* 5.7.2 copy: */}
 <button
 onClick={onSkip}
 className="text-[10px]"
 style={{ color: '#a8a29e' }}
 >Close tour</button>
 </div>
 <h3 className="text-base" style={{ color: '#f5f2ed', fontWeight: 500 }}>{step.title}</h3>
 <p className="text-[12px] leading-relaxed" style={{ color: '#a8a196' }}>{step.body}</p>
 {/* Fallback notice — when the target element isn't present on
 the current screen (e.g. copy references "the table" but the
 user hasn't loaded an album yet), the popover is centred.
 Without this note the user stares at the dim backdrop looking
 for something that isn't there. */}
 {!rect && (
 // 5.7.2 copy:
 <p className="text-[10px] font-display italic pt-1" style={{ color: 'var(--color-text-muted)' }}>
 You&apos;ll see this one once it shows up on screen. Keep going, or close the tour and explore.
 </p>
 )}
 <div className="flex items-center justify-between pt-1">
 <div className="flex items-center gap-1">
 {Array.from({ length: totalSteps }).map((_, i) => (
 <span key={i} className="w-1.5 h-1.5" style={{ borderRadius: '2px', backgroundColor: i === stepIndex ? 'var(--color-terra)' : 'var(--color-sand-600)' }} />
 ))}
 </div>
 <div className="flex items-center gap-2">
 {!isFirst && (
 <button
 onClick={onPrev}
 className="text-[10px] px-3 py-1.5"
 style={{ borderRadius: '2px', color: 'var(--color-text-muted)', border: '1px solid rgba(168,161,150,0.2)' }}
 >Back</button>
 )}
 <button
 onClick={onNext}
 className="text-[10px] px-4 py-1.5"
 style={{ borderRadius: '2px', backgroundColor: 'transparent', color: 'var(--color-accent)', border: '1px solid rgba(208,176,102,0.55)' }}
 >
 {isLast ? 'Done' : 'Next'}
 </button>
 </div>
 </div>
 </div>
 </>
 )
}
