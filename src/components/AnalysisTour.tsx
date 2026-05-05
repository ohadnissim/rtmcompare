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
 title: 'Surface picker',
 body: 'Music / Full / Bcast / Post in the header tunes the whole app to your workflow. Music = Spotify / Apple / YouTube / social only; Broadcast = R128 / A/85 / Netflix first with dialog-gated LUFS; Post = both; Full = everything. Changes what DSP profiles, delivery targets, and Atmos panels you see.',
 },
 {
 tab: 'overview',
 selector: '[data-tour="advanced-qc"]',
 placement: 'bottom',
 title: 'Advanced QC',
 body: 'Off by default. Toggle on to unlock masking, per-band phase, transient density, waveform diff, tempo drift, and the full mono-compat breakdown. Round-3 panel consensus: these are pro-only diagnostics that clutter the page for everyone else.',
 },
 {
 tab: 'overview',
 selector: '[data-tour-target="player"]',
 placement: 'bottom',
 title: 'A/B Player',
 body: 'Level-matched playback of both files. Click A or B to swap, scrub to find sections, and keyboard shortcut "?" shows all hotkeys. Playback is gapless for instant A/B flips. EQ Amount slider + BYPASS pill in the header audits any proposed EQ live over playback.',
 },
 {
 tab: 'overview',
 placement: 'center',
 title: 'Overview',
 body: 'Your north-star metrics: Integrated LUFS, True Peak, LRA, stereo width, dynamic range, length (ms-precise). The A vs B table shows every difference; the gold dot next to the reference filename summarises reference quality on hover.',
 },
 {
 tab: 'delivery',
 placement: 'center',
 title: 'Delivery',
 body: 'Will your master get turned down? Each streaming platform row has a ▶ to audition the loudest section at that platform\'s normalised level; Spotify vs Apple vs Tidal back to back. File metadata lives here too — inspect BEXT / iXML / LIST-INFO tags before delivery.',
 },
 {
 tab: 'stereo',
 placement: 'center',
 title: 'Stereo & Spectrum',
 body: 'Overlaid spectra (A vs B), vectorscope, per-band phase, stereo-width trajectory. Catches mono-compat issues and stereo imbalances engineers miss on headphones.',
 },
 {
 tab: 'match',
 placement: 'center',
 title: 'EQ Match',
 body: 'One surface, five lenses. Reference = EQ derived from A vs B. Engineer = the loaded profile\'s curve. Hybrid = both. Library = match any reference from your persistent library with live auditioned EQ. Assistant = the full delivery chain (gain, HPF, EQ, compressor, TP limiter, dither).',
 },
 {
 tab: 'match',
 placement: 'center',
 title: 'Master Assistant',
 body: 'Pick a DSP target (Spotify / Apple / YouTube / broadcast / Netflix). RTM composes a transparent chain and shows every stage: what gain it applies, whether the HPF engages, what bands land, whether the compressor glues the dynamics. Preview in the player, then render a delivery-ready WAV with BEXT / iXML auto-embedded.',
 },
 {
 tab: 'match',
 placement: 'center',
 title: 'Reference Library',
 body: 'Library tab opens your persistent reference shelf. Tracks you\'ve added once stay auto-analysed (LUFS / TP / LRA / spectrum / BPM / key). Pick one; RTM proposes parametric EQ moves to match its tonal balance and auditions them live through the player\'s biquad bank. No plugin, no bounce.',
 },
 {
 tab: 'delivery',
 placement: 'center',
 title: 'Sound Check twin + Delta Heatmap',
 body: 'The ≋ button next to each DSP plays the *actual* AAC output of that platform\'s ingest chain: gain, 4× oversampled TP limiter, codec. The red heatmap underneath shows where each limiter fires on the 30-second window. Pick any start-second in the "Twin starts at" field to audition a specific passage.',
 },
 {
 tab: 'breakdown',
 placement: 'center',
 title: 'Breakdown',
 body: 'Diagnostic: per-element balance (kick, snare, sub, vocals, etc.), mix-diverge heatmap, masking, transient density. If deep-scan was on, you get per-stem breakdown, useful for figuring out why something feels off.',
 },
 {
 tab: 'quality',
 placement: 'center',
 title: 'Quality',
 body: 'QC red-flags: clicks, clipping, distortion, hum, tonal issues, tempo stability. If anything here shows red, fix it before delivery.',
 },
 {
 tab: 'atmos',
 placement: 'center',
 title: 'Atmos Preflight',
 body: 'ADM-specific hard-checks: object count ≤ 118 (Apple Music cap), LFE routing, bed layout (7.1.2 or 5.1.4), SR 48 kHz, BD ≥ 24-bit, orphan beds, binaural TP headroom. Single HOLD / WARN / READY banner: deliverability at a glance before the wider Atmos QC panel.',
 },
 {
 tab: 'atmos',
 placement: 'center',
 title: 'Per-object Anomalies',
 body: 'Flags objects that usually mean mix mistakes: hot (object > bed + 6 LU, un-attenuated send), silent (declared but inactive, wasting ADM slots), static (no trajectory automation), dark (sub-content routed to an object instead of the LFE bed).',
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
 className="fixed z-[100] rounded-2xl p-5 space-y-3"
 style={{
 ...popoverStyle,
 backgroundColor: '#151411',
 border: '1px solid rgba(208,176,102,0.35)',
 boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
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
 <button
 onClick={stopTour}
 className="text-[10px]"
 style={{ color: '#6a6459' }}
 >End tour</button>
 </div>
 <h3 className="text-base" style={{ color: '#f5f2ed', fontWeight: 500 }}>{step.title}</h3>
 <p className="text-[12px] leading-relaxed" style={{ color: '#a8a196' }}>{step.body}</p>
 {!rect && (
 <p className="text-[10px] italic pt-1" style={{ color: '#8d867b' }}>
 The highlighted area isn't on this screen yet. Continue, or skip to explore.
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
 className="text-[10px] px-3 py-1.5 rounded-md"
 style={{ color: '#8d867b', border: '1px solid rgba(168,161,150,0.2)' }}
 >Back</button>
 )}
 <button
 onClick={nextStep}
 className="text-[10px] px-4 py-1.5 rounded-md"
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
