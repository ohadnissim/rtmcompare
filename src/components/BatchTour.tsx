import React, { useEffect, useState, useCallback } from 'react'

/**
 * Batch Tour. First-run on the album-batch view, re-triggerable via the
 * Tour button in the batch header.
 *
 * Covers surfaces that don't exist on the upload / compare screens:
 * Overview tab + per-song tab rotation, Load reference / Cohort Mode,
 * album notes + per-song notes (embedded in PDF export), Delivery
 * Manifest Reconciler, Archival Reissue toggle, Save / Load session,
 * inside-song-tab bits (Triage + DSP profile picker, A/B reference
 * picker, Live TP meter, Loudness-over-time, mono waterfall, click solo).
 *
 * Selectors are data-tour-batch="..." in BatchView + SongDetailPanel.
 * If a selector doesn't resolve, the tour falls back to a centered
 * popover so missing elements never block progress.
 *
 * `rtm-batch-tour-done` gates auto-start, written from stopTour().
 */

export interface BatchTourStep {
 selector?: string
 placement?: 'top' | 'bottom' | 'left' | 'right' | 'center'
 title: string
 body: string
 /** Optional hint — "open a song tab to see the rest" kind of copy. */
 hint?: string
 /** When set, this step only fires when the user is in label-mode. */
 labelOnly?: boolean
}

const STEPS: BatchTourStep[] = [
 {
 placement: 'center',
 // 5.7.2 copy:
 title: 'Album overview',
 // 5.7.2 copy:
 body: 'You dropped a folder — every track is now measured. Loudness, peaks, length, ISRCs, with outliers flagged. Click any row to open a song; arrow keys step between them.',
 },
 {
 selector: '[data-tour-batch="header-actions"]',
 placement: 'bottom',
 // 5.7.2 copy:
 title: 'Save your session',
 // 5.7.2 copy:
 body: 'Save Session keeps every measurement, note, and favourite. Load it later and you\'re right back where you were. Reissue mode pins the old master as A across every track — handy for re-releases.',
 },
 {
 selector: '[data-tour-batch="load-reference"]',
 placement: 'bottom',
 // 5.7.2 copy:
 title: 'Inter-track consistency',
 // 5.7.2 copy:
 body: 'Load a reference, or promote any track to be the reference. You\'ll get a heatmap showing which tracks drift from the family sound, and a distance column you can sort.',
 },
 {
 selector: '[data-tour-batch="album-notes"]',
 placement: 'top',
 // 5.7.2 copy:
 title: 'Notes that travel with the album',
 // 5.7.2 copy:
 body: 'Jot anything you want about the record as a whole. Notes save with the session and land in the PDF you hand off. Each song has its own notes too.',
 },
 {
 selector: '[data-tour-batch="main-table"]',
 placement: 'top',
 // 5.7.2 copy:
 title: 'The table',
 // 5.7.2 copy:
 body: 'Click any column to sort. Red LUFS means that track is louder or quieter than the rest. Click a row to dive into that song.',
 },
 {
 selector: '[data-tour-batch="tab-strip"]',
 placement: 'bottom',
 // 5.7.2 copy:
 title: 'One song tab, always',
 // 5.7.2 copy:
 body: 'Overview stays pinned. Click another track and the song tab swaps in place — no clutter, no twenty tabs. × takes you back to Overview.',
 },
 {
 placement: 'center',
 // 5.7.2 copy:
 title: 'Inside a song',
 // 5.7.2 copy:
 body: 'Open any track and you get the full A/B player, a reference picker (revisions, favourites, other album tracks), live peak meter, loudness over time, mono check, key and BPM, and per-song notes. Star a favourite and it sticks across sessions.',
 // 5.7.2 copy:
 hint: 'Close the tour, open a song, then hit Tour again to walk those surfaces.',
 },
]

type TourState = { kind: 'idle' } | { kind: 'running'; step: number }

export function useBatchTourState() {
 const [state, setState] = useState<TourState>({ kind: 'idle' })
 const startTour = useCallback(() => setState({ kind: 'running', step: 0 }), [])
 const stopTour = useCallback(() => {
 try { localStorage.setItem('rtm-batch-tour-done', '1') } catch {}
 setState({ kind: 'idle' })
 }, [])
 const nextStep = useCallback(() => {
 setState(s => {
 if (s.kind !== 'running') return s
 const next = s.step + 1
 if (next >= STEPS.length) {
 try { localStorage.setItem('rtm-batch-tour-done', '1') } catch {}
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

interface Props {
 tour: ReturnType<typeof useBatchTourState>
 autoStart?: boolean
 labelMode?: boolean
}

export default function BatchTour({ tour, autoStart = false, labelMode = false }: Props) {
 const { state, startTour, stopTour, nextStep, prevStep } = tour

 // Auto-start once per machine — gated on `rtm-batch-tour-done`.
 useEffect(() => {
 if (!autoStart) return
 try {
 const done = localStorage.getItem('rtm-batch-tour-done') === '1'
 if (!done && state.kind === 'idle') {
 const id = setTimeout(() => startTour(), 700)
 return () => clearTimeout(id)
 }
 } catch {}
 }, [autoStart, startTour, state.kind])

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

 // Skip label-only steps when not in label mode. We advance eagerly by
 // walking `state.step` until a valid step is found or we run off the end.
 let stepIndex = state.step
 while (stepIndex < STEPS.length && STEPS[stepIndex].labelOnly && !labelMode) {
 stepIndex += 1
 }
 if (stepIndex >= STEPS.length) {
 // Defer the terminal close to an effect so we don't setState during render.
 setTimeout(stopTour, 0)
 return null
 }
 const step = STEPS[stepIndex]
 const totalSteps = STEPS.length
 const isFirst = stepIndex === 0
 const isLast = stepIndex === totalSteps - 1

 const W = typeof window !== 'undefined' ? window.innerWidth : 1200
 const H = typeof window !== 'undefined' ? window.innerHeight : 800
 // Estimated popover size for edge-clamping. Conservative upper bound
 // so long step copy never pushes the popover past the viewport.
 const POP_W = 440
 const POP_H = 260
 const MARGIN = 24

 const clampX = (x: number) => Math.max(MARGIN, Math.min(W - POP_W - MARGIN, x))
 const clampY = (y: number) => Math.max(MARGIN, Math.min(H - POP_H - MARGIN, y))
 // Default placement: true center of viewport (not the bottom band).
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
 {/* Backdrop + cut-out — pointer-events-none so underlying controls
 stay clickable and the user can keep working mid-tour. */}
 <svg
 className="fixed inset-0 z-[99] pointer-events-none"
 width={W} height={H}
 style={{ width: '100vw', height: '100vh' }}
 >
 <defs>
 <mask id="rtm-batch-tour-cutout">
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
 <rect x={0} y={0} width={W} height={H} fill="rgba(14,13,11,0.72)" mask="url(#rtm-batch-tour-cutout)" />
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
 transition: 'x 300ms cubic-bezier(0.2, 0.8, 0.2, 1), y 300ms cubic-bezier(0.2, 0.8, 0.2, 1), width 300ms cubic-bezier(0.2, 0.8, 0.2, 1), height 300ms cubic-bezier(0.2, 0.8, 0.2, 1)',
 }}
 />
 )}
 </svg>

 {/* Popover */}
 <div
 className="fixed z-[100] p-5 space-y-3"
 style={{
 borderRadius: '2px',
 ...popoverStyle,
 backgroundColor: '#151411',
 border: '1px solid rgba(208,176,102,0.35)',
 // Glide between steps — matches the spotlight rect below.
 transition: 'left 300ms cubic-bezier(0.2, 0.8, 0.2, 1), top 300ms cubic-bezier(0.2, 0.8, 0.2, 1), width 300ms ease',
 }}
 onClick={e => e.stopPropagation()}
 >
 <div className="flex items-center justify-between">
 {/* 5.7.2 copy: */}
 <span className="text-[9px] tracking-[0.18em] uppercase" style={{ color: '#d0b066' }}>
 Album tour · {stepIndex + 1} of {totalSteps}
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
 <p className="text-[10px] font-display italic pt-1" style={{ color: '#8d867b' }}>
 You&apos;ll see this one once it shows up on screen. Keep going, or close and explore.
 </p>
 )}
 {step.hint && (
 <p className="text-[10px]" style={{ color: '#7a7164', fontStyle: 'font-display italic' }}>{step.hint}</p>
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
 style={{ borderRadius: '2px', color: '#8d867b', border: '1px solid rgba(168,161,150,0.2)' }}
 >Back</button>
 )}
 <button
 onClick={nextStep}
 className="text-[10px] px-4 py-1.5"
 style={{ borderRadius: '2px', backgroundColor: '#d0b066', color: '#0e0d0b' }}
 >
 {isLast ? 'Done' : 'Next'}
 </button>
 </div>
 </div>
 </div>
 </>
 )
}
