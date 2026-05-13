import React, { useState, useEffect, useCallback } from 'react'

/**
 * Single-file / Reference-Only analysis tour.
 *
 * Runs after the first `Analyze Reference Only` or when the DAW plugin
 * sends a bounce into the single-file slot. Walks through verdict,
 * player, Master Assistant, Sound Check twin, metadata editor.
 *
 * Replayable via the header Tour button.
 *
 * Mirrors AnalysisTour's popover + spotlight math and keyboard handling.
 * Separate file so single-file doesn't inherit Compare-mode assumptions.
 */

export interface RefOnlyTourStep {
 selector?: string
 placement?: 'top' | 'bottom' | 'left' | 'right' | 'center'
 title: string
 body: string
}

const STEPS: RefOnlyTourStep[] = [
 {
 placement: 'center',
 // 5.7.2 copy:
 title: 'Single-file mode',
 // 5.7.2 copy:
 body: 'This is where a master gets finished. Drop a file, or send one over from your DAW. Everything you need to ship is on this page. Esc to close the tour any time.',
 },
 {
 selector: '[data-tour-ref="banner"]',
 placement: 'bottom',
 // 5.7.2 copy:
 title: 'Where it came from',
 // 5.7.2 copy:
 body: 'If your DAW sent this file, the gold banner shows you the source — which session, which region, what time. If you opened the file by hand, the banner stays out of the way.',
 },
 {
 selector: '[data-tour-ref="meta-strip"]',
 placement: 'bottom',
 // 5.7.2 copy:
 title: 'The numbers, at a glance',
 // 5.7.2 copy:
 body: 'Loudness, peaks, range, sample rate, bit depth, ISRC — all in one strip. If there\'s dialog, you\'ll see a Dialog LUFS read pop in too.',
 },
 {
 selector: '[data-tour-ref="verdict"]',
 placement: 'top',
 // 5.7.2 copy:
 title: 'Verdict + next action',
 // 5.7.2 copy:
 body: 'Green light or one clear next move — "Ship it," "Pull the limiter 0.5 dB," or "Fix the 12 clipped samples at 01:47." Flip on Compliance for a pass/fail grid across every platform.',
 },
 {
 selector: '[data-tour-ref="attention"]',
 placement: 'top',
 // 5.7.2 copy:
 title: 'Things worth a listen',
 // 5.7.2 copy:
 body: 'Click any row with a timestamp and the player jumps there. Peaks, clicks, hum, limiter pumping — all in one list, so you\'re not scroll-hunting.',
 },
 {
 selector: '[data-tour-ref="player"]',
 placement: 'top',
 // 5.7.2 copy:
 title: 'A/B player',
 // 5.7.2 copy:
 body: 'Stereo, mono, M, S, or phone-speaker IR (200 Hz HPF, 4 kHz LPF, ear-bud response). The EQ bank in the header lets you audition any proposed move live — toggle bands, ride the Amount slider, hear it without restarting. Space / A / B / M / L on the keyboard.',
 },
 {
 selector: '[data-tour-ref="master-assistant"]',
 placement: 'top',
 // 5.7.2 copy:
 title: 'Master Assistant',
 // 5.7.2 copy:
 body: 'Pick a target — Spotify, Apple, broadcast, vinyl. The Assistant builds a full chain (gain, HPF, EQ, comp, limiter, dither) and shows every decision. Hear it in the player, then render the WAV.',
 },
 {
 selector: '[data-tour-ref="streaming-preview"]',
 placement: 'top',
 // 5.7.2 copy:
 title: 'Sound Check twin',
 // 5.7.2 copy:
 body: 'The ≋ button plays the actual codec output for each platform — limiter, AAC, all of it. The red strip shows where the limiter clamps. "Twin starts at" lets you audition any second, not just the loudest.',
 },
 {
 selector: '[data-tour-ref="metadata-panel"]',
 placement: 'top',
 // 5.7.2 copy:
 title: 'Tags, in place',
 // 5.7.2 copy:
 body: 'Edit BEXT, iXML, ID3 right here. Write back without touching the audio bytes. ISRC, originator, UMID — all done before delivery, no second tool.',
 },
 {
 placement: 'center',
 // 5.7.2 copy:
 title: 'Want to go deeper?',
 // 5.7.2 copy:
 body: 'Two header toggles: **Advanced QC** adds masking, phase, transient density, waveform diff. **Learn mode** adds "why this matters" notes on every panel. Both off by default — flip them on when you want more.',
 },
]

type TourState = { kind: 'idle' } | { kind: 'running'; step: number }

export function useRefOnlyTourState() {
 const [state, setState] = useState<TourState>({ kind: 'idle' })

 const startTour = useCallback(() => setState({ kind: 'running', step: 0 }), [])
 const stopTour = useCallback(() => {
 try { localStorage.setItem('rtm-refonly-tour-done', '1') } catch {}
 setState({ kind: 'idle' })
 }, [])
 const nextStep = useCallback(() => {
 setState(s => {
 if (s.kind !== 'running') return s
 const next = s.step + 1
 if (next >= STEPS.length) {
 try { localStorage.setItem('rtm-refonly-tour-done', '1') } catch {}
 return { kind: 'idle' }
 }
 return { kind: 'running', step: next }
 })
 }, [])
 const prevStep = useCallback(() => {
 setState(s => (s.kind === 'running' && s.step > 0 ? { kind: 'running', step: s.step - 1 } : s))
 }, [])

 return { state, startTour, stopTour, nextStep, prevStep, isActive: state.kind === 'running' }
}

// Popover geometry — same dimensions + clamping pattern as
// AnalysisTour / OnboardingTour so single-file visually matches.
const POP_W = 400
const POP_H = 220
const MARGIN = 24

function clampX(x: number, w: number = POP_W, marg: number = MARGIN): number {
 return Math.max(marg, Math.min(window.innerWidth - w - marg, x))
}
function clampY(y: number, h: number = POP_H, marg: number = MARGIN): number {
 return Math.max(marg, Math.min(window.innerHeight - h - marg, y))
}

export default function RefOnlyTour({
 tour,
 autoStart = false,
}: {
 tour: ReturnType<typeof useRefOnlyTourState>
 autoStart?: boolean
}) {
 const { state, startTour, stopTour, nextStep, prevStep } = tour
 const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

 // Auto-start once per machine unless the user re-triggers the tour.
 useEffect(() => {
 if (!autoStart) return
 try {
 const done = localStorage.getItem('rtm-refonly-tour-done') === '1'
 if (!done && state.kind === 'idle') {
 const id = setTimeout(() => startTour(), 600)
 return () => clearTimeout(id)
 }
 } catch {}
 }, [autoStart, startTour, state.kind])

 useEffect(() => {
 if (state.kind !== 'running') { setRect(null); return }
 const step = STEPS[state.step]
 if (!step.selector) { setRect(null); return }

 // Re-measure on mount + whenever the window resizes, since the
 // target element's bounding rect moves with scroll / layout.
 const measure = () => {
 const el = document.querySelector(step.selector!) as HTMLElement | null
 if (!el) { setRect(null); return }
 const r = el.getBoundingClientRect()
 setRect({ x: r.left, y: r.top, w: r.width, h: r.height })
 // Scroll the target into view so the spotlight is visible.
 el.scrollIntoView({ block: 'center', behavior: 'smooth' })
 }
 measure()
 const id = setTimeout(measure, 250) // post-scroll settle
 window.addEventListener('resize', measure)
 return () => { clearTimeout(id); window.removeEventListener('resize', measure) }
 }, [state])

 useEffect(() => {
 if (state.kind !== 'running') return
 const onKey = (e: KeyboardEvent) => {
 if (e.key === 'Escape') stopTour()
 else if (e.key === 'ArrowRight' || e.key === 'Enter') nextStep()
 else if (e.key === 'ArrowLeft') prevStep()
 }
 window.addEventListener('keydown', onKey)
 return () => window.removeEventListener('keydown', onKey)
 }, [state.kind, stopTour, nextStep, prevStep])

 if (state.kind !== 'running') return null
 const step = STEPS[state.step]

 // Popover position — anchor to the spotlight rect when we have one,
 // otherwise centre in the viewport.
 let popX: number
 let popY: number
 if (rect) {
 const placement = step.placement || 'bottom'
 if (placement === 'top') { popX = clampX(rect.x + rect.w / 2 - POP_W / 2); popY = clampY(rect.y - POP_H - 12) }
 else if (placement === 'bottom') { popX = clampX(rect.x + rect.w / 2 - POP_W / 2); popY = clampY(rect.y + rect.h + 12) }
 else if (placement === 'left') { popX = clampX(rect.x - POP_W - 12); popY = clampY(rect.y + rect.h / 2 - POP_H / 2) }
 else if (placement === 'right') { popX = clampX(rect.x + rect.w + 12); popY = clampY(rect.y + rect.h / 2 - POP_H / 2) }
 else { popX = clampX(window.innerWidth / 2 - POP_W / 2); popY = clampY(window.innerHeight / 2 - POP_H / 2) }
 } else {
 popX = clampX(window.innerWidth / 2 - POP_W / 2)
 popY = clampY(window.innerHeight / 2 - POP_H / 2)
 }

 return (
 <div
 className="fixed inset-0 z-[200] pointer-events-none"
 aria-live="polite"
 >
 {/* Dim + spotlight cut-out */}
 <svg className="absolute inset-0 w-full h-full pointer-events-auto" onClick={stopTour}>
 <defs>
 <mask id="ref-only-tour-mask">
 <rect width="100%" height="100%" fill="white" />
 {rect && (
 <rect
 x={rect.x - 8} y={rect.y - 8}
 width={rect.w + 16} height={rect.h + 16}
 rx={10}
 fill="black"
 style={{ transition: 'x 300ms cubic-bezier(0.2, 0.8, 0.2, 1), y 300ms cubic-bezier(0.2, 0.8, 0.2, 1), width 300ms cubic-bezier(0.2, 0.8, 0.2, 1), height 300ms cubic-bezier(0.2, 0.8, 0.2, 1)' }}
 />
 )}
 </mask>
 </defs>
 <rect width="100%" height="100%" fill="rgba(14,13,11,0.72)" mask="url(#ref-only-tour-mask)" />
 </svg>

 {/* Popover */}
 <div
 className="absolute pointer-events-auto"
 style={{
 borderRadius: '2px',
 left: popX, top: popY,
 width: POP_W, maxWidth: POP_W,
 backgroundColor: '#1a1815',
 border: '1px solid rgba(208,176,102,0.35)',
 transition: 'left 300ms cubic-bezier(0.2, 0.8, 0.2, 1), top 300ms cubic-bezier(0.2, 0.8, 0.2, 1)',
 }}
 role="dialog"
 aria-label={step.title}
 >
 <div className="p-4 space-y-2">
 <div className="flex items-center justify-between">
 {/* 5.7.2 copy: */}
 <span className="text-[9px] uppercase tracking-[0.18em]" style={{ color: 'var(--color-accent)' }}>
 Single file · {state.step + 1} / {STEPS.length}
 </span>
 {/* 5.7.2 copy: */}
 <button
 onClick={stopTour}
 className="text-[10px] px-2 py-0.5 rounded hover:bg-white/[0.06]"
 style={{ color: 'var(--color-text-muted)', border: '1px solid rgba(168,161,150,0.2)' }}
 title="Close the tour (Esc)"
 >
 Close
 </button>
 </div>
 <h3 className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{step.title}</h3>
 <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{step.body}</p>
 <div className="flex items-center justify-between pt-1.5">
 <button
 onClick={prevStep}
 disabled={state.step === 0}
 className="text-[11px] px-3 py-1 disabled:opacity-30"
 style={{ borderRadius: '2px', color: 'var(--color-text-muted)', border: '1px solid rgba(168,161,150,0.2)' }}
 >
 ← Back
 </button>
 <button
 onClick={state.step + 1 >= STEPS.length ? stopTour : nextStep}
 className="text-[11px] px-4 py-1"
 style={{ borderRadius: '2px', backgroundColor: 'var(--color-accent)', color: '#0e0d0b' }}
 >
 {state.step + 1 >= STEPS.length ? 'Done' : 'Next →'}
 </button>
 </div>
 </div>
 </div>
 </div>
 )
}
