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
 title: 'Album Batch',
 body: 'You\'ve dropped a folder. Every track is analysed for LUFS / TP / LRA / ISRC hygiene plus outlier flags. Click any row to open the song in a rotating tab: one slot, B tracks whatever row you pick, ← / → step between tracks.',
 },
 {
 selector: '[data-tour-batch="header-actions"]',
 placement: 'bottom',
 title: 'Session header',
 body: 'Save session writes a .rtmalbum.json with every measurement, note, A/B favorite, and open tab. Load session reopens where you left it; no re-analysis. Reissue mode anchors "old master" as the A-side across every track for reissue workflows.',
 },
 {
 selector: '[data-tour-batch="load-reference"]',
 placement: 'bottom',
 title: 'Cohort Mode',
 body: 'Load a reference file, or promote any row via ref ↑ in the table. Cohort Mode then gives you a per-track drift heatmap across 31 bands plus an RMS distance column. Sort by distance to see which track strays most from the family resemblance.',
 },
 {
 selector: '[data-tour-batch="album-notes"]',
 placement: 'top',
 title: 'Album notes',
 body: 'Free-form notes scoped to the whole album. Persist in the session, embedded in every PDF export you hand off. Per-song notes live inside each song tab; both show up in the Ship-Ready PDF under their own sections.',
 },
 {
 selector: '[data-tour-batch="main-table"]',
 placement: 'top',
 title: 'Sortable table',
 body: 'Click any column header to sort. Red LUFS marks a drift outlier vs the album median. TP is shown as a number — no warning colour. Click a row to open that song\'s detail tab.',
 },
 {
 selector: '[data-tour-batch="tab-strip"]',
 placement: 'bottom',
 title: 'Tab strip · single-slot rotation',
 body: 'Overview is always pinned first. The song-tab slot rotates; clicking a different row replaces it in place rather than stacking tabs. × closes back to overview. ← / → step between songs inside a song tab.',
 },
 {
 placement: 'center',
 title: 'Inside a song tab',
 body: 'Pick any row to open a song. Inside: a full A/B player (same engine as Compare mode) with a reference picker (Revisions auto-detected from filenames pinned at the top, starred favorites persisted across sessions, cohort ref if set, session uploads, all album tracks). Live TP meter on the transport. Triage Mode toggle plus DSP-spec profile picker (Apple / Spotify / Amazon / Tidal / YouTube) for the QC-ops view. Loudness over time with section overlays. Mono-compat waterfall per 1/3-octave band. Click-timeline "F" button for frequency-isolated solo playback. Key / BPM / harmonic ladder. Per-song notes that land in the PDF. Phase bands. Vectorscope. A/B favorites persist across sessions via a star button.',
 hint: 'Close this tour, open a song, then re-trigger via the Tour button to walk those surfaces.',
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
 className="fixed z-[100] rounded-2xl p-5 space-y-3"
 style={{
 ...popoverStyle,
 backgroundColor: '#151411',
 border: '1px solid rgba(208,176,102,0.35)',
 boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
 // Glide between steps — matches the spotlight rect below.
 transition: 'left 300ms cubic-bezier(0.2, 0.8, 0.2, 1), top 300ms cubic-bezier(0.2, 0.8, 0.2, 1), width 300ms ease',
 }}
 onClick={e => e.stopPropagation()}
 >
 <div className="flex items-center justify-between">
 <span className="text-[9px] tracking-[0.2em] uppercase" style={{ color: '#d0b066' }}>
 Batch tour · step {stepIndex + 1} of {totalSteps}
 </span>
 <button
 onClick={stopTour}
 className="text-[10px]"
 style={{ color: '#a8a29e' }}
 >End tour</button>
 </div>
 <h3 className="text-base" style={{ color: '#f5f2ed', fontWeight: 500 }}>{step.title}</h3>
 <p className="text-[12px] leading-relaxed" style={{ color: '#a8a196' }}>{step.body}</p>
 {!rect && (
 <p className="text-[10px] italic pt-1" style={{ color: '#8d867b' }}>
 The highlighted area isn't on this screen yet. Continue, or skip to explore.
 </p>
 )}
 {step.hint && (
 <p className="text-[10px]" style={{ color: '#7a7164', fontStyle: 'italic' }}>{step.hint}</p>
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
