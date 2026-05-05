import React, { useState, useEffect, useCallback } from 'react'

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
 title: 'Drop your files here',
 body: 'Left: your reference (demo, rough, or a track you like the sound of). Right: the file to compare, a mix, master, or Atmos bounce. WAV, FLAC, MP3, AIFF, ADM BWF.',
 },
 {
 selector: '[data-tour="scan-mode"]',
 placement: 'top',
 title: 'Fast or Deep Scan',
 body: 'Fast gives you the full measurement set in under a minute. Deep adds AI stem separation for per-stem masking and AI-generation detection. Auto-disabled on ADM / Atmos files.',
 },
 {
 selector: '[data-tour="profile"]',
 placement: 'top',
 title: 'Engineer Profile',
 body: 'Target curve plus loudness / width / dynamics targets driving Engineer Tips. Load your own from JSON: a Ghenea curve, a vintage Neve console average, or your own signature.',
 },
 {
 selector: '[data-tour="recent"]',
 placement: 'top',
 title: 'Reference Library',
 body: 'Star your go-to references so they re-load in one click. Separate saved list for favourites, recent list for the last 20 files you analysed.',
 },
 {
 selector: '[data-tour="analyze"]',
 placement: 'top',
 title: 'Ready to analyze',
 body: 'Click Compare (or Analyze Reference Only for single-file QC) and watch the progress. Processing is local.',
 },
 {
 selector: '[data-tour="analyze-album"]',
 placement: 'top',
 title: 'Analyse a whole album',
 body: 'Pick a folder. RTM runs a quick pass (LUFS, TP, LRA, length, SR / BD, ISRC hygiene, outlier flags) into a sortable table within seconds. Deep analysis (clicks, hum, distortion, phase bands, BPM / key, streaming preview) runs lazily per track when you open its tab.',
 },
 {
 selector: '[data-tour="analyze-album"]',
 placement: 'top',
 title: 'Inside the album view',
 body: 'Click any row to open that song in a rotating tab. Deep analysis starts on open and caches for the session, so ← / → is instant. Each song has its own Notes; the album has its own. The A/B player lets you reference against any other album track, an uploaded file, or a starred favourite. Promote any row as the cohort reference for a per-track drift heatmap.',
 },
 {
 selector: '[data-tour="load-session"]',
 placement: 'top',
 title: 'Save & reload album sessions',
 body: 'Leaving notes in an album review? Save Session writes a .rtmalbum.json with every row, notes, and your last-open tab. Load Album Session reopens it where you left off, no re-analysis. A/B favourites persist too.',
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
 return (
 <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ backgroundColor: 'rgba(14,13,11,0.92)', backdropFilter: 'blur(8px)' }}>
 <div className="max-w-xl mx-6 rounded-2xl p-10 text-center space-y-6"
 style={{ backgroundColor: '#151411', border: '1px solid rgba(208,176,102,0.25)' }}>
 <div>
 <div className="text-[10px] tracking-[0.3em] uppercase" style={{ color: '#8d867b' }}>Pro audio QC for engineers &amp; producers</div>
 <div className="text-3xl tracking-[0.05em] mt-2" style={{ color: '#f5f2ed', fontWeight: 300 }}>RTMcompare</div>
 <div className="text-[10px] tracking-[0.2em] uppercase mt-1" style={{ color: '#d0b066' }}>Industry-standard QC &amp; A/B</div>
 </div>

 <p className="text-sm leading-relaxed" style={{ color: '#b5afa4' }}>
 Three clicks from <span style={{ color: '#ebe7e0' }}>&ldquo;this mix feels off&rdquo;</span> to <span style={{ color: '#d0b066' }}>knowing why</span>. Level-matched A/B, per-band phase, mono translation, streaming normalisation preview, and concrete EQ moves.
 </p>

 <div className="grid grid-cols-2 gap-3 text-left">
 <Pillar title="Drop. Compare." body="Two files, level-matched, native sample rate. Every measurement side-by-side." />
 <Pillar title="Deliver clean." body="Catch clipping, hum, mono-collapse, ISRC drift, and Atmos spec failures before the label does." />
 <Pillar title="Actionable EQ." body="Match any target curve. Export as FabFilter Pro-Q / CSV / JSON, or Apply &amp; Bounce a corrected WAV." />
 <Pillar title="Local-first." body="Every measurement runs on your machine. No audio leaves. No cloud." />
 </div>

 <div className="flex items-center justify-center gap-3 pt-2">
 <button
 onClick={onSkip}
 className="text-[11px] px-4 py-2 rounded-full transition-colors"
 style={{ color: '#8d867b', border: '1px solid rgba(168,161,150,0.2)' }}
 >
 Skip tour
 </button>
 <button
 onClick={onStart}
 className="text-[11px] px-6 py-2.5 rounded-full transition-all hover:scale-105"
 style={{
 backgroundColor: '#d0b066',
 color: '#0e0d0b',
 boxShadow: '0 8px 24px rgba(208,176,102,0.2)',
 }}
 >
 Show me around
 </button>
 </div>

 <p className="text-[9px]" style={{ color: '#a8a29e' }}>
 Runs locally. Nothing leaves this machine.
 </p>
 </div>
 </div>
 )
}

function Pillar({ title, body }: { title: string; body: string }) {
 return (
 <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(208,176,102,0.04)', border: '1px solid rgba(208,176,102,0.1)' }}>
 <div className="text-[11px] tracking-[0.12em] uppercase mb-1" style={{ color: '#d0b066' }}>{title}</div>
 <div className="text-[11px]" style={{ color: '#a8a196' }}>{body}</div>
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
 className="fixed z-[100] rounded-2xl p-5 space-y-3"
 style={{
 ...popoverStyle,
 backgroundColor: '#151411',
 border: '1px solid rgba(208,176,102,0.35)',
 boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
 // Smooth movement between steps — no more teleport.
 transition: 'left 300ms cubic-bezier(0.2, 0.8, 0.2, 1), top 300ms cubic-bezier(0.2, 0.8, 0.2, 1), width 300ms ease',
 }}
 onClick={e => e.stopPropagation()}
 >
 <div className="flex items-center justify-between">
 <span className="text-[9px] tracking-[0.2em] uppercase" style={{ color: '#d0b066' }}>
 Step {stepIndex + 1} of {totalSteps}
 </span>
 <button
 onClick={onSkip}
 className="text-[10px]"
 style={{ color: '#a8a29e' }}
 >Skip tour</button>
 </div>
 <h3 className="text-base" style={{ color: '#f5f2ed', fontWeight: 500 }}>{step.title}</h3>
 <p className="text-[12px] leading-relaxed" style={{ color: '#a8a196' }}>{step.body}</p>
 {/* Fallback notice — when the target element isn't present on
 the current screen (e.g. copy references "the table" but the
 user hasn't loaded an album yet), the popover is centred.
 Without this note the user stares at the dim backdrop looking
 for something that isn't there. */}
 {!rect && (
 <p className="text-[10px] italic pt-1" style={{ color: '#8d867b' }}>
 The highlighted area isn't on this screen yet — continue the tour, or skip to explore.
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
 onClick={onPrev}
 className="text-[10px] px-3 py-1.5 rounded-md"
 style={{ color: '#8d867b', border: '1px solid rgba(168,161,150,0.2)' }}
 >Back</button>
 )}
 <button
 onClick={onNext}
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
