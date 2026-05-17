import React, { useState, useEffect, useCallback } from 'react'
import { useAudience, type Audience } from '../AudienceContext'

export interface AnalysisTourStep {
  tab: string
  selector?: string
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center'
  title: string
  body: string
}

interface StepDef {
  tab: string
  selector?: string
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center'
  title: Record<Audience, string>
  body: Record<Audience, string>
}

const STEP_DEFS: StepDef[] = [
  {
    tab: 'overview',
    selector: '[data-tour="surface-picker"]',
    placement: 'bottom',
    title: {
      pro: 'Pick your world',
      producer: 'Set your surface',
      student: 'Choose your context',
      teacher: 'Surface selector',
    },
    body: {
      pro: 'Music, Broadcast, Post, or Full. RTMcompare reshapes itself around the work you do — only the targets and panels you need, nothing you don\'t.',
      producer: 'Choose Music for most releases. This changes which quality checks, loudness targets, and panels you\'ll see — so pick the one that matches your format.',
      student: 'RTMcompare adapts to different types of audio work. Music mode shows the panels most relevant to song mastering. Start here and switch as you explore.',
      teacher: 'The surface picker controls which panels and targets the student sees. Use Music for most curriculum. Demonstrate switching to show how the tool adapts to different workflows.',
    },
  },
  {
    tab: 'overview',
    selector: '[data-tour-target="player"]',
    placement: 'bottom',
    title: {
      pro: 'A/B Player',
      producer: 'A/B listening',
      student: 'Blind A/B comparison',
      teacher: 'Teaching the A/B player',
    },
    body: {
      pro: 'Both files, levels matched, instant flip between A and B. Hit "?" for shortcuts. The EQ slider in the header lets you hear any proposed move live, no bouncing.',
      producer: 'Flip instantly between your mix and the reference — at the same loudness so you\'re comparing tone, not volume. Try it with your eyes closed first.',
      student: 'The A/B player matches both files to the same loudness so your ears aren\'t fooled by level differences. Switch quickly to notice what actually changed in the mastering.',
      teacher: 'Have students switch A/B every 2-3 seconds — too slow and memory fades, too fast and you only catch level differences. The level-matched comparison is critical for training accurate ears.',
    },
  },
  {
    tab: 'overview',
    placement: 'center',
    title: {
      pro: 'Overview',
      producer: 'The numbers',
      student: 'Reading the overview',
      teacher: 'Overview panel — first lesson',
    },
    body: {
      pro: 'The numbers that matter — loudness, peaks, dynamic range, width, length. Every difference between A and B in one table. Hover the gold dot for a quick read on your reference.',
      producer: 'The main dashboard. LUFS tells you how loud your master is. True Peak shows the maximum sample level. LRA is your dynamic range — how much breathing room the music has.',
      student: 'Start every analysis here. LUFS-I (Integrated Loudness) is what streaming platforms use. If your master is louder than the target, they\'ll turn it down — and possibly change how it sounds.',
      teacher: 'Assign students to identify which file is "better" by looking at the numbers only, then verify with their ears. Common misconception to correct: louder is not better — streaming normalization levels the field.',
    },
  },
  {
    tab: 'delivery',
    placement: 'center',
    title: {
      pro: 'Delivery',
      producer: 'Streaming check',
      student: 'Platform delivery',
      teacher: 'Teaching streaming normalization',
    },
    body: {
      pro: 'Will your master get turned down on Spotify? Apple? Tidal? Hit play on any row to hear the loudest moment at that platform\'s level. Tags live here too.',
      producer: 'Hear exactly what your master sounds like after Spotify, Apple, or YouTube turns it up or down. If it sounds pumped or distorted — your limiter is hitting too hard.',
      student: 'Every streaming platform normalizes your track to a target loudness. This panel shows whether your master will be turned up or down, and lets you hear the result before you submit.',
      teacher: 'Play the Sound Check twin for each platform and ask students to describe the difference. Focus on what happens to transients and bass when the limiter ceiling is hit during normalization.',
    },
  },
  {
    tab: 'stereo',
    placement: 'center',
    title: {
      pro: 'Stereo & Spectrum',
      producer: 'Tone & width',
      student: 'Spectral and stereo analysis',
      teacher: 'Stereo and frequency panels',
    },
    body: {
      pro: 'A vs B spectra overlaid, vectorscope, phase per band, width over time. Catches the stereo and mono problems headphones hide.',
      producer: 'See the frequency balance of A vs B side by side. The vectorscope shows how wide your stereo image is — a thin vertical line means very mono, a wide blob means spread stereo.',
      student: 'The spectrum overlay shows the frequency content of both files on the same graph. Areas where they differ tell you where the mastering made EQ adjustments. The vectorscope visualizes the stereo field.',
      teacher: 'Have students compare spectra of a reference track vs their mix. Ask: where is there excess low-mid? Where is the reference brighter? The vectorscope is excellent for explaining phase mono compatibility.',
    },
  },
  {
    tab: 'match',
    placement: 'center',
    title: {
      pro: 'EQ Match',
      producer: 'Get your EQ moves',
      student: 'EQ matching',
      teacher: 'EQ Match as a teaching tool',
    },
    body: {
      pro: 'Five ways to land on a curve. Match the reference, your profile, both, anything from your library, or let the Assistant build a full delivery chain.',
      producer: 'This tab calculates what EQ moves would make your mix sound more like the reference. You can preview the moves in the player and push them straight to your EQ plugin.',
      student: 'EQ matching compares the frequency balance of two files and suggests how to make one sound more like the other. This is a starting point — good mastering requires judgment beyond any curve.',
      teacher: 'Show students the suggested EQ curve, then ask whether they agree by ear. The tool shows what math suggests — critical listening decides what\'s actually correct. Excellent for developing spectral vocabulary.',
    },
  },
  {
    tab: 'match',
    placement: 'center',
    title: {
      pro: 'Master Assistant',
      producer: 'Build your chain',
      student: 'Mastering chain assistant',
      teacher: 'Introducing the Master Assistant',
    },
    body: {
      pro: 'Pick a target — Spotify, Apple, YouTube, broadcast, Netflix. The Assistant builds a chain and shows you every move. Preview in the player, then render a clean WAV.',
      producer: 'Choose a streaming target and the Assistant suggests gain, EQ, compression, and limiting settings. Preview it in the player before committing — the render gives you a new WAV with the chain applied.',
      student: 'The Assistant translates the analysis into a complete processing chain: how much gain, where to EQ, how hard to limit. Compare it against a pro master to see what professional processing adds.',
      teacher: 'Use the chain breakdown to explain signal flow: gain first, then EQ shaping, then dynamics (if needed), then limiting. Each stage has a reason. Let students predict each setting before revealing the suggestion.',
    },
  },
  {
    tab: 'match',
    placement: 'center',
    title: {
      pro: 'Reference Library',
      producer: 'Your reference shelf',
      student: 'Reference library',
      teacher: 'Teaching with references',
    },
    body: {
      pro: 'Your shelf of references, always ready. Add a track once and it stays analysed. Pick one and hear the EQ moves live through the player.',
      producer: 'Save your go-to references here — commercial tracks, your best masters, anything you compare against regularly. They\'re pre-analysed so loading is instant.',
      student: 'A reference library stores professional tracks for comparison. When you load one as File A, all analysis is against that standard — this is how you calibrate your ears to industry benchmarks.',
      teacher: 'Build a class reference library with tracks that demonstrate specific mastering concepts — one with great low end, one with excellent stereo imaging, one with obvious over-limiting. Load them to illustrate each concept.',
    },
  },
  {
    tab: 'delivery',
    placement: 'center',
    title: {
      pro: 'Sound Check twin',
      producer: 'Codec preview',
      student: 'Encoded audio preview',
      teacher: 'Teaching codec artifacts',
    },
    body: {
      pro: 'The ≋ button plays the actual codec output of each platform — gain, limiter, AAC, the lot. The red strip shows where the limiter clamps down. Pick any second to audition.',
      producer: 'This simulates exactly what listeners hear after the streaming service processes your master: codec compression, gain adjustments, and all. If the bass disappears or vocals get harsh — that\'s the codec.',
      student: 'Encoding to AAC or MP3 changes the audio. This preview renders the actual streaming codec output so you can hear what listeners will experience, not just what your DAW plays back.',
      teacher: 'Have students compare the original WAV vs the encoded preview for a heavily-limited track. The codec artifacts become obvious — this demonstrates why headroom matters even for lossy delivery.',
    },
  },
  {
    tab: 'breakdown',
    placement: 'center',
    title: {
      pro: 'Breakdown',
      producer: 'What sounds different?',
      student: 'Element-by-element breakdown',
      teacher: 'Teaching spectral elements',
    },
    body: {
      pro: 'Why does it feel off? Element balance — kick, snare, sub, vocals — masking, transient density. If you ran Deep, get it stem by stem.',
      producer: 'See the balance of kick, sub, snare, hi-hats, and vocals — how much space each element takes up compared to the reference. Masking shows where elements are fighting each other.',
      student: 'Instead of looking at the full spectrum, this panel breaks audio into perceptual elements. Masking analysis shows when one sound obscures another — a key concept in mix clarity and mastering.',
      teacher: 'The element breakdown makes abstract frequency balance concrete. Ask students to guess which element will be loudest in a commercial pop master before loading — this builds spectral prediction skills.',
    },
  },
  {
    tab: 'quality',
    placement: 'center',
    title: {
      pro: 'Quality',
      producer: 'QC checklist',
      student: 'Quality control',
      teacher: 'Teaching quality control',
    },
    body: {
      pro: 'The stuff that gets a master rejected: clicks, clipping, distortion, hum, tempo wobble. If anything\'s red, fix it before you send.',
      producer: 'This catches problems that would get your master rejected or noticed by listeners: digital clipping, crackles, distortion, hum, and wobbling tempo. Green on everything = safe to send.',
      student: 'Quality control identifies technical problems in a master before delivery. These aren\'t subjective — a click at 2:14 is a click at 2:14. Learn to spot each artifact type here and in your DAW.',
      teacher: 'Present a master with a deliberate click or hum artifact and have students find it here first, then locate it in the waveform. Connecting the visual detection to the audio builds critical listening skills.',
    },
  },
  {
    tab: 'atmos',
    placement: 'center',
    title: {
      pro: 'Atmos Preflight',
      producer: 'Atmos readiness',
      student: 'Dolby Atmos QC',
      teacher: 'Teaching Atmos delivery',
    },
    body: {
      pro: 'One banner — HOLD, WARN, or READY — answers the only question that matters: will the platform accept this? Object count, bed layout, sample rate, headroom, all checked.',
      producer: 'If you\'re delivering a Dolby Atmos mix, this tells you whether it meets platform requirements before Apple or Amazon bounces it back. One banner: READY means you\'re good.',
      student: 'Dolby Atmos is a spatial audio format used for immersive mixes. This QC panel checks technical requirements — object count, channel layout, headroom — that streaming platforms require for Atmos delivery.',
      teacher: 'Use the Atmos panel even if you don\'t deliver Atmos yet — it explains the spatial audio format\'s technical requirements clearly. Contrast with stereo requirements to explain why Atmos delivery is more complex.',
    },
  },
  {
    tab: 'atmos',
    placement: 'center',
    title: {
      pro: 'Object Anomalies',
      producer: 'Atmos issues',
      student: 'Atmos object detection',
      teacher: 'Common Atmos mistakes',
    },
    body: {
      pro: 'Objects that usually mean a mistake: too hot, silent (wasting a slot), static (forgot to automate), or carrying sub that should be in the LFE.',
      producer: 'Atmos objects that are too loud, completely silent, never moving, or carrying deep bass where it shouldn\'t be — these are the common mistakes that cause platform rejection or playback issues.',
      student: 'In Dolby Atmos, each sound element is an \'object\' with position data. These detections show common technical errors: an object that\'s too loud will clip on certain playback systems.',
      teacher: 'Each anomaly type maps to a specific mixing mistake. Use these to explain Atmos signal flow: why bass belongs in the LFE bed, why static objects defeat the purpose of spatial audio.',
    },
  },
]

function getSteps(audience: Audience): AnalysisTourStep[] {
  return STEP_DEFS.map(def => ({
    tab: def.tab,
    selector: def.selector,
    placement: def.placement,
    title: def.title[audience],
    body: def.body[audience],
  }))
}

type TourState = { kind: 'idle' } | { kind: 'running'; step: number }

export function useAnalysisTourState() {
  const [state, setState] = useState<TourState>({ kind: 'idle' })

  const startTour = useCallback(() => setState({ kind: 'running', step: 0 }), [])
  const stopTour = useCallback(() => {
    try { localStorage.setItem('rtm-analysis-tour-done', '1') } catch {}
    setState({ kind: 'idle' })
  }, [])
  const nextStep = useCallback((totalSteps: number) => {
    setState(s => {
      if (s.kind !== 'running') return s
      const next = s.step + 1
      if (next >= totalSteps) {
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
  autoStart?: boolean
}) {
  const { state, startTour, stopTour, nextStep, prevStep } = tour
  const audience = useAudience()
  const STEPS = getSteps(audience)

  useEffect(() => {
    if (!autoStart) return
    try {
      const done = localStorage.getItem('rtm-analysis-tour-done') === '1'
      if (!done && state.kind === 'idle') {
        const id = setTimeout(() => startTour(), 600)
        return () => clearTimeout(id)
      }
    } catch {}
  }, [autoStart, startTour, state.kind])

  useEffect(() => {
    if (state.kind !== 'running') return
    const step = STEPS[state.step]
    const btn = document.querySelector(`[data-tour-tab="${step.tab}"]`) as HTMLButtonElement | null
    if (btn) btn.click()
  }, [state, STEPS])

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
  }, [state, STEPS])

  if (state.kind !== 'running') return null

  const stepIndex = state.step
  const step = STEPS[stepIndex]
  const totalSteps = STEPS.length
  const isFirst = stepIndex === 0
  const isLast = stepIndex === totalSteps - 1

  const AUDIENCE_LABEL: Record<Audience, string> = {
    pro: 'PRO',
    producer: 'PRODUCER',
    student: 'STUDENT',
    teacher: 'TEACHER',
  }

  const W = typeof window !== 'undefined' ? window.innerWidth : 1200
  const H = typeof window !== 'undefined' ? window.innerHeight : 800
  const POP_W = 400
  const POP_H = 240
  const MARGIN = 24

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
              transition: 'x 300ms cubic-bezier(0.2, 0.8, 0.2, 1), y 300ms cubic-bezier(0.2, 0.8, 0.2, 1), width 300ms cubic-bezier(0.2, 0.8, 0.2, 1), height 300ms cubic-bezier(0.2, 0.8, 0.2, 1)',
            }}
          />
        )}
      </svg>

      <div
        className="fixed z-[100] p-5 space-y-3"
        style={{
          ...popoverStyle,
          backgroundColor: 'var(--color-sand-900)',
          border: '1px solid rgba(208,176,102,0.35)',
          transition: 'left 300ms cubic-bezier(0.2, 0.8, 0.2, 1), top 300ms cubic-bezier(0.2, 0.8, 0.2, 1), width 300ms ease',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[9px] tracking-[0.18em] uppercase" style={{ color: 'var(--color-accent)' }}>
              Step {stepIndex + 1} of {totalSteps}
            </span>
            <span
              style={{
                fontSize: 8,
                fontWeight: 700,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'rgba(208,176,102,0.5)',
                border: '1px solid rgba(208,176,102,0.2)',
                borderRadius: '2px',
                padding: '1px 4px',
              }}
            >
              {AUDIENCE_LABEL[audience]}
            </span>
          </div>
          <button
            onClick={stopTour}
            className="text-[10px]"
            style={{ color: 'var(--color-sand-300)' }}
          >Close tour</button>
        </div>
        <h3 className="text-base" style={{ color: '#f5f2ed', fontWeight: 500 }}>{step.title}</h3>
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-sand-300)' }}>{step.body}</p>
        {!rect && (
          <p className="text-[10px] font-display italic pt-1" style={{ color: 'var(--color-text-muted)' }}>
            You&apos;ll see this one once it shows up on screen. Keep going, or close and explore.
          </p>
        )}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: i === stepIndex ? 'var(--color-accent)' : 'var(--color-sand-600)' }} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                onClick={prevStep}
                className="text-[10px] px-3 py-1.5"
                style={{ color: 'var(--color-text-muted)', border: '1px solid rgba(168,161,150,0.2)' }}
              >Back</button>
            )}
            <button
              onClick={() => nextStep(totalSteps)}
              className="text-[10px] px-4 py-1.5"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-bg-app)' }}
            >
              {isLast ? 'Got it' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
