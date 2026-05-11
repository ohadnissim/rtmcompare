import React, { useState, useEffect, useCallback } from 'react'

/**
 * Analysis tour. Runs after the first comparison completes, walking
 * through each tab. Next jumps to the next tab AND highlights a
 * relevant control inside it. `rtm-analysis-tour-done` gates auto-start;
 * the header Tour button restarts the flow at any time.
 */

export interface AnalysisTourStep {
 /** Which tab must be active for this step. Tab click is issued automatically. */
 tab: string
 /** CSS selector for the element to highlight within the tab. */
 selector?: string
 placement?: 'top' | 'bottom' | 'left' | 'right' | 'center'
 title: string
 body: string
}

const STEPS: AnalysisTourStep[] = [
 {
 tab: 'overview',
 selector: '[data-tour="surface-picker"]',
 placement: 'bottom',
 // 5.7.2 copy:
 title: 'Pick your world',
 // 5.7.2 copy:
 body: 'Music, Broadcast, Post, or Full. RTMcompare reshapes itself around the work you do — only the targets and panels you need, nothing you don\'t.',
 },
 {
 tab: 'overview',
 selector: '[data-tour="advanced-qc"]',
 placement: 'bottom',
 // 5.7.2 copy:
 title: 'Advanced QC',
 // 5.7.2 copy:
 body: 'Flip this on when you want the deep dive — masking, phase per band, transient density, the works. Off by default so the page stays clean.',
 },
 {
 tab: 'overview',
 selector: '[data-tour-target="player"]',
 placement: 'bottom',
 // 5.7.2 copy:
 title: 'A/B Player',
 // 5.7.2 copy:
 body: 'Both files, levels matched, instant flip between A and B. Hit "?" for shortcuts. The EQ slider in the header lets you hear any proposed move live, no bouncing.',
 },
 {
 tab: 'overview',
 placement: 'center',
 // 5.7.2 copy:
 title: 'Overview',
 // 5.7.2 copy:
 body: 'The numbers that matter — loudness, peaks, dynamic range, width, length. Every difference between A and B in one table. Hover the gold dot for a quick read on your reference.',
 },
 {
 tab: 'delivery',
 placement: 'center',
 // 5.7.2 copy:
 title: 'Delivery',
 // 5.7.2 copy:
 body: 'Will your master get turned down on Spotify? Apple? Tidal? Hit play on any row to hear the loudest moment at that platform\'s level. Tags live here too.',
 },
 {
 tab: 'stereo',
 placement: 'center',
 // 5.7.2 copy:
 title: 'Stereo & Spectrum',
 // 5.7.2 copy:
 body: 'A vs B spectra overlaid, vectorscope, phase per band, width over time. Catches the stereo and mono problems headphones hide.',
 },
 {
 tab: 'match',
 placement: 'center',
 // 5.7.2 copy:
 title: 'EQ Match',
 // 5.7.2 copy:
 body: 'Five ways to land on a curve. Match the reference, your profile, both, anything from your library, or let the Assistant build a full delivery chain.',
 },
 {
 tab: 'match',
 placement: 'center',
 // 5.7.2 copy:
 title: 'Master Assistant',
 // 5.7.2 copy:
 body: 'Pick a target — Spotify, Apple, YouTube, broadcast, Netflix. The Assistant builds a chain and shows you every move. Preview in the player, then render a clean WAV.',
 },
 {
 tab: 'match',
 placement: 'center',
 // 5.7.2 copy:
 title: 'Reference Library',
 // 5.7.2 copy:
 body: 'Your shelf of references, always ready. Add a track once and it stays analysed. Pick one and hear the EQ moves live through the player.',
 },
 {
 tab: 'delivery',
 placement: 'center',
 // 5.7.2 copy:
 title: 'Sound Check twin',
 // 5.7.2 copy:
 body: 'The ≋ button plays the actual codec output of each platform — gain, limiter, AAC, the lot. The red strip shows where the limiter clamps down. Pick any second to audition.',
 },
 {
 tab: 'breakdown',
 placement: 'center',
 // 5.7.2 copy:
 title: 'Breakdown',
 // 5.7.2 copy:
 body: 'Why does it feel off? Element balance — kick, snare, sub, vocals — masking, transient density. If you ran Deep, you get it stem by stem.',
 },
 {
 tab: 'quality',
 placement: 'center',
 // 5.7.2 copy:
 title: 'Quality',
 // 5.7.2 copy:
 body: 'The stuff that gets a master rejected: clicks, clipping, distortion, hum, tempo wobble. If anything\'s red, fix it before you send.',
 },
 {
 tab: 'atmos',
 placement: 'center',
 // 5.7.2 copy:
 title: 'Atmos Preflight',
 // 5.7.2 copy:
 body: 'One banner — HOLD, WARN, or READY — answers the only question that matters: will the platform accept this? Object count, bed layout, sample rate, headroom, all checked.',
 },
 {
 tab: 'atmos',
 placement: 'center',
 // 5.7.2 copy:
 title: 'Object Anomalies',
 // 5.7.2 copy:
 body: 'Objects that usually mean a mistake: too hot, silent (wasting a slot), static (forgot to automate), or carrying sub that should be in the LFE.',
 },
]

type TourState = { kind: 'idle' } | { kind: 'running'; step: number }

export function useAnalysisTourState() {
 const [state, setState] = useState<TourState>({ kind: 'idle' })

 const startTour = useCallback(() => setState({ kind: 'running', step: 0 }), [])
 const stopTour = useCallback(() => {
 try { localStorage.setItem('rtm-analysis-tour-done', '1') } catch {}
 setState({ kind: 'idle' })
 }, [])
 const nextStep = useCallback(() => {
 setState(s => {
 if (s.kind !== 'running') return s
 const next = s.step + 1
 if (next >= STEPS.length) {
 try { localStorage.setItem('rtm-analysis-tour-done', '1') } catch {}
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

export default function AnalysisTour({
 tour,
 autoStart = false,
}: {
 tour: ReturnType<typeof useAnalysisTourState>
 /** When true and the user hasn't completed the analysis tour before,
 * auto-start on mount. */
 autoStart?: boolean
}) {
 const { state, startTour, stopTour, nextStep, prevStep } = tour

 // Auto-start once per machine (unless user re-triggers via header button)
 useEffect(() => {
 if (!autoStart) return
 try {
 const done = localStorage.getItem('rtm-analysis-tour-done') === '1'
 if (!done && state.kind === 'idle') {
 // Small delay so the results have rendered before we measure DOM
 const id = setTimeout(() => startTour(), 600)
 return () => clearTimeout(id)
 }
 } catch {}
 }, [autoStart, startTour, state.kind])

 // When the step changes, click the corresponding tab button so the panel
 // actually appears on screen before we highlight a target inside it.
 useEffect(() => {
 if (state.kind !== 'running') return
 const step = STEPS[state.step]
 const btn = document.querySelector(`[data-tour-tab="${step.tab}"]`) as HTMLButtonElement | null
 if (btn) btn.click()
 }, [state])

 const [rect, setRect] = useState<DOMRect | null>(null)
 useEffect(() => {
 if (state.kind !== 'running') return
 const step = STEPS[state.step]
 const measure = () => {
 if (!step.selector) { setRect(null); return }
 const el = document.querySelector(step.selector)
 if (!el) { setRect(null); return }
 const r = el.getBoundingClientRect()
 setRect(r)
 if (r.top < 80 || r.bottom > window.innerHeight - 40) {
 el.scrollIntoView({ behavior: 'smooth', block: 'center' })
 }
 }
 // Defer so tab-switch + panel render first.
 const id = setTimeout(measure, 120)
 window.addEventListener('resize', measure)
 window.addEventListener('scroll', measure, true)
 return () => {
 clearTimeout(id)
 window.removeEventListener('resize', measure)
 window.removeEventListener('scroll', measure, true)
 }
 }, [state])

 if (state.kind !== 'running') return null

 const stepIndex = state.step
 const step = STEPS[stepIndex]
 const totalSteps = STEPS.length
 const isFirst = stepIndex === 0
 const isLast = stepIndex === totalSteps - 1

 const W = typeof window !== 'undefined' ? window.innerWidth : 1200
 const H = typeof window !== 'undefined' ? window.innerHeight : 800
 // Estimated popover height for vertical clamping. Actual height depends
 // on body-text line count so this is a conservative upper bound — keeps
 // the popover on-screen on typical laptops regardless of step copy.
 const POP_W = 400
 const POP_H = 240
 const MARGIN = 24

 // Popover placement — true center by default (not bottom). When a step
 // has a selector + non-centered placement, anchor to the target rect
 // with clamped edges. Every field is clamped to [MARGIN, max − POP_*]
 // so the popover never leaves the viewport.
 const clampX = (x: number) => Math.max(MARGIN, Math.min(W - POP_W - MARGIN, x))
 const clampY = (y: number) => Math.max(MARGIN, Math.min(H - POP_H - MARGIN, y))
 let popoverStyle: React.CSSProperties = {
 left: clampX(W / 2 - POP_W / 2),
 top: clampY(H / 2 - POP_H / 2),
 width: POP_W,
 }
 if (rect && step.placement && step.placement !== 'center') {
 const pad = 16
 switch (step.placement) {
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
 }
 }

 return (
 <>
 {/* Backdrop + optional cut-out — pointer-events-none so the dim layer
 never traps clicks meant for the header / sticky tabs. The popover
 (rendered separately below at z-[100]) is the only interactive
 surface; backdrop is visual only. */}
 <svg
 className="fixed inset-0 z-[99] pointer-events-none"
 width={W} height={H}
 style={{ width: '100vw', height: '100vh' }}
 >
 <defs>
 <mask id="rtm-analysis-tour-cutout">
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
 <rect x={0} y={0} width={W} height={H} fill="rgba(14,13,11,0.72)" mask="url(#rtm-analysis-tour-cutout)" />
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
 backgroundColor: '#151411',
 border: '1px solid rgba(208,176,102,0.35)',
 // Smooth movement between steps. Eases `left / top / width`
 // over 300 ms — short enough not to feel sluggish, long enough
 // to read as intentional rather than a teleport.
 transition: 'left 300ms cubic-bezier(0.2, 0.8, 0.2, 1), top 300ms cubic-bezier(0.2, 0.8, 0.2, 1), width 300ms ease',
 }}
 onClick={e => e.stopPropagation()}
 >
 <div className="flex items-center justify-between">
 <span className="text-[9px] tracking-[0.2em] uppercase" style={{ color: '#d0b066' }}>
 Tab {stepIndex + 1} of {totalSteps}
 </span>
 {/* 5.7.2 copy: */}
 <button
 onClick={stopTour}
 className="text-[10px]"
 style={{ color: '#a8a29e' }}
 >Close tour</button>
 </div>
 <h3 className="text-base" style={{ color: '#f5f2ed', fontWeight: 500 }}>{step.title}</h3>
 <p className="text-[12px] leading-relaxed" style={{ color: '#a8a196' }}>{step.body}</p>
 {!rect && (
 // 5.7.2 copy:
 <p className="text-[10px] italic pt-1" style={{ color: '#8d867b' }}>
 You&apos;ll see this one once it shows up on screen. Keep going, or close and explore.
 </p>
 )}
 <div className="flex items-center justify-between pt-1">
 <div className="flex items-center gap-1">
 {Array.from({ length: totalSteps }).map((_, i) => (
 <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: i === stepIndex ? '#d0b066' : '#3e3a33' }} />
 ))}
 </div>
 <div className="flex items-center gap-2">
 {!isFirst && (
 <button
 onClick={prevStep}
 className="text-[10px] px-3 py-1.5"
 style={{ color: '#8d867b', border: '1px solid rgba(168,161,150,0.2)' }}
 >Back</button>
 )}
 <button
 onClick={nextStep}
 className="text-[10px] px-4 py-1.5"
 style={{ backgroundColor: '#d0b066', color: '#0e0d0b' }}
 >
 {isLast ? 'Got it' : 'Next'}
 </button>
 </div>
 </div>
 </div>
 </>
 )
}
