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
 title: 'Single-file analysis',
 body: 'This surface is where a master gets finished. Drop the file yourself, or send it from your DAW via the RTM Send plugin. Either way, everything you need to ship lives on this page. Press Esc to dismiss this tour at any time.',
 },
 {
 selector: '[data-tour-ref="banner"]',
 placement: 'bottom',
 title: 'DAW origin',
 body: 'When the RTM Send plugin delivered this file, the gold banner at the top shows where it came from: DAW, region name, time range, source. Silent when you opened the file manually.',
 },
 {
 selector: '[data-tour-ref="meta-strip"]',
 placement: 'bottom',
 title: 'Metadata strip',
 body: 'LUFS · True Peak · LRA · SR · Bit depth · ISRC at a glance. On broadcast / post tracks a Dialog LKFS read appears when the Python speech-gate detects speech.',
 },
 {
 selector: '[data-tour-ref="verdict"]',
 placement: 'top',
 title: 'Ready-to-deliver verdict',
 body: 'Traffic-light diagnosis + a one-line action ("Ship it" / "Pull the limiter 0.5 dB" / "Fix the 12 clipped samples at 01:47"). Mono-loss badge in the same row. Compliance toggle opens a per-DSP pass/fail grid scoped to your current surface (Music / Broadcast / Post).',
 },
 {
 selector: '[data-tour-ref="attention"]',
 placement: 'top',
 title: 'Attention list · clickable',
 body: 'Every row with a timestamp jumps the player to that moment. TP breaches, clicks, audible hum, limiter artefacts, DSP-profile findings all route here so you don\'t scroll-hunt.',
 },
 {
 selector: '[data-tour-ref="player"]',
 placement: 'top',
 title: 'A/B player',
 body: 'Live playback plus listen modes (mono / mid / side / phone). The EQ bank in the header audits whatever Master Assistant / Engineer Tips / Reference Match proposes: toggle bands, drag the Amount slider, hear the change over playback with no restart. Keyboard: Space / A / B / M / L.',
 },
 {
 selector: '[data-tour-ref="master-assistant"]',
 placement: 'top',
 title: 'Master Assistant',
 body: 'Three tabs: Chain (full delivery pipeline), Engineer Tips (profile-driven EQ), Reference Match (library-backed spectrum match). Pick a DSP target; RTM composes gain → HPF → EQ → compressor → TP limiter → dither and shows every decision. Preview live, render a delivery-ready WAV. RIAA toggle for vinyl; stem-level render for per-stem chains.',
 },
 {
 selector: '[data-tour-ref="streaming-preview"]',
 placement: 'top',
 title: 'Sound Check twin',
 body: 'Each DSP row has a ≋ button that plays the REAL AAC output of that platform\'s ingest chain: gain, 4× TP limiter, codec. The red Delta Heatmap under each row shows where the limiter fires on a 30-second window. "Twin starts at" lets you pick any section, not just the loudest.',
 },
 {
 selector: '[data-tour-ref="metadata-panel"]',
 placement: 'top',
 title: 'Metadata editor',
 body: 'BEXT / iXML / LIST-INFO / ID3 tags inline. Edit Mode writes back atomically; audio bytes stay identical. Embed ISRC, BEXT originator, UMID before delivery without bouncing through a separate tool.',
 },
 {
 placement: 'center',
 title: 'Advanced QC + Learn mode',
 body: 'Header toggles: **Advanced QC** unlocks masking, phase per-band, transient density, waveform diff, tempo drift. **Learn mode** reveals "Why this matters" copy on every panel. Both stay off by default; turn them on when you want the deep dive.',
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
 className="absolute pointer-events-auto rounded-xl shadow-2xl"
 style={{
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
 <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: '#d0b066' }}>
 Single-file · {state.step + 1} / {STEPS.length}
 </span>
 <button
 onClick={stopTour}
 className="text-[10px] px-2 py-0.5 rounded hover:bg-white/[0.06]"
 style={{ color: '#8d867b', border: '1px solid rgba(168,161,150,0.2)' }}
 title="Skip the tour (Esc)"
 >
 Skip
 </button>
 </div>
 <h3 className="text-sm font-medium" style={{ color: '#ebe7e0' }}>{step.title}</h3>
 <p className="text-[11px] leading-relaxed" style={{ color: '#a8a29e' }}>{step.body}</p>
 <div className="flex items-center justify-between pt-1.5">
 <button
 onClick={prevStep}
 disabled={state.step === 0}
 className="text-[11px] px-3 py-1 rounded-md disabled:opacity-30"
 style={{ color: '#8d867b', border: '1px solid rgba(168,161,150,0.2)' }}
 >
 ← Back
 </button>
 <button
 onClick={state.step + 1 >= STEPS.length ? stopTour : nextStep}
 className="text-[11px] px-4 py-1 rounded-md"
 style={{ backgroundColor: '#d0b066', color: '#0e0d0b' }}
 >
 {state.step + 1 >= STEPS.length ? 'Done' : 'Next →'}
 </button>
 </div>
 </div>
 </div>
 </div>
 )
}
