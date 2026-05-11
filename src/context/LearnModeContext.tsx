/**
 * LearnModeContext — React context for RTMcompare's Learn Mode feature.
 *
 * Provides state and actions for toggling guided education mode, switching
 * between Student and Teacher roles, managing guided steps through the
 * analysis workflow, assignment configuration, and per-session annotations.
 *
 * State is persisted to localStorage under the key `rtm-learn-mode-v1` so
 * a page reload doesn't lose in-progress annotations or role selection.
 */

import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
} from 'react'
import type { LearnModeState, LearnRole, AssignmentConfig, LearnAnnotation, LearnGuidedStep, BlindTestPredictions } from '../types'

// ─── Guided Steps ────────────────────────────────────────────────────────────

export const GUIDED_STEPS: LearnGuidedStep[] = [
  {
    id: 'listening',
    label: 'Methodology',
    tabId: 'overview',
    targetTab: 'Overview',
    question: 'Before looking at a single meter: listen through both files on your main monitors, then again on headphones, then on a laptop speaker or phone. What differences do you notice across playback systems? How does your mix translate?\nWhen you listened on laptop speakers, did the low end disappear? Did the vocal become more or less intelligible? How did the stereo width collapse feel? What did you notice on headphones vs. open-back monitors?',
    hint: 'Translation check is the first professional step. The goal is to hear what the numbers will later confirm — or contradict. Note loudness, tonal character, stereo width, and anything that feels "wrong" on any system.\nTranslation issues are always frequency-specific: low end disappears on laptop speakers, harsh mids amplify on earbuds, excessive reverb smears on phone speakers.',
  },
  {
    id: 'metering',
    label: 'Loudness',
    tabId: 'overview',
    targetTab: 'Overview',
    question: 'What is the LUFS-I and PLR of your mix? Before the limiter, what is your mix bus peak level — is it hitting around −6 to −3 dBFS? Has gain staging been maintained at every stage from recording through processing to the master bus?\nIs the PLR difference between A and B caused by the mix dynamics themselves, or by the limiter alone? If you removed the limiter, what would PLR be?\nBeyond LUFS-I (integrated/gated): is there a difference between the short-term LUFS-S (3-second window) reading at the loudest chorus vs. the quietest verse? What does a LUFS-S swing of more than 8 LU tell you about the dynamic arc of the arrangement? How does the momentary LUFS-M (400 ms window) behave at the loudest transient?',
    hint: 'Gain staging rule: recording −18 to −12 dBFS, processing −18 to −12 dBFS, mix bus −6 to −3 dBFS before limiting. A PLR below 6 LU means the limiter is working too hard — fix gain staging upstream first.\nA PLR above 14 LU with heavy limiting means the compressor upstream is doing the real work — the limiter is just catching peaks. Fix the bus compression settings before touching the limiter ceiling.\nLUFS-M (400 ms) catches the loudest transient moments — critical for broadcast where momentary peaks above −18 LUFS trigger programme loudness processors. LUFS-S (3 s) reveals the dynamic arc: a 10 LU swing between verse and chorus is common in commercial pop and desirable. LUFS-I (gated integrated) is what streaming platforms normalise to — it ignores silence and very quiet passages. A well-mastered track should have LUFS-I at target, LUFS-S peaks 6–10 LU above that, and LUFS-M peaks 10–14 LU above LUFS-I.',
  },
  {
    id: 'breakdown',
    label: 'Mix Breakdown',
    tabId: 'breakdown',
    targetTab: 'Breakdown',
    question: 'What is the element hierarchy of your mix — which element sits loudest, which provides the foundation, which cuts through? Is any element masking another in the same frequency band? Describe your bus architecture: what stems or groups are you using?\nWhat reverb types are you using on the main elements — plate, hall, room, or algorithmic? What is the pre-delay setting on your main vocal reverb (aim for 20–60 ms for separation)? Does your reverb decay time match the tempo? Quick check: 60000/BPM × 0.75 = dotted quarter note in ms — a decay longer than 2 bars will blur fast tempos. Are you using any sends for parallel reverb/delay routing, or inserting FX directly on channels?\nWhere does automation play a role in your mix — which elements have volume rides, filter sweeps, or reverb send automation? Does your lead vocal have manual level automation or just compression? Where did you automate a reverb send up on long held notes, and pull it back on dry phrases? Does the automation support the arrangement\'s energy arc (building to chorus, dropping for verse)?',
    hint: 'Mix Breakdown comes before tonal and dynamics analysis because masking and element balance are root causes — not symptoms. Fix the element hierarchy and the tonal/dynamics numbers often fix themselves.\nReverb type determines character: plate is dense and bright (vocals, snare), hall is long and wide (orchestral, pads), room is tight and natural (drums, acoustic). Pre-delay (20–60 ms) separates the dry sound from the reverb tail, preventing the reverb from masking the source. Tempo-sync your delays: 60000/BPM for quarter notes, half that for eighths.\nAutomation is where a technically correct mix becomes an emotionally communicative one. Volume automation on vocals (±2–3 dB per phrase) catches what compressors miss — subtle line-to-line level variation. Reverb send automation: pull the reverb level up on final words and long notes; reduce it on tight, rhythmic phrases so the reverb doesn\'t smear the groove. Filter automation on pads for a build: high-pass at 400 Hz in the verse, open to full range into the chorus, creates energy without changing the mix level.',
  },
  {
    id: 'stereo',
    label: 'Stereo & Phase',
    tabId: 'stereo-spectrum',
    targetTab: 'Stereo & Spectrum',
    question: 'What is the mono compatibility loss percentage, and how does the mix sound on a single speaker? Check the correlation meter — what does a value near +1 vs near −1 mean? Where in the frequency spectrum does the most phase cancellation occur?\nDescribe your panning architecture: what sits in the center (kick, bass, lead vocal, snare)? What is hard-panned (guitars, pads, doubles)? Are you using Haas effect (a 1–30 ms delay copy on one side for width without M/S artifacts)? Is there enough center-fill — does the mix still have body and punch when summed to mono? If you used M/S (Mid-Side) processing: what did you apply to the Mid channel vs. the Side channel, and why?',
    hint: 'Phase cancellation is frequency-specific. Sub-bass phase issues (below 120 Hz) cause the most mono compat loss and are most damaging on club systems. High-frequency correlation near −1 on cymbals is usually fine. LF correlation near −1 is a serious problem.\nCenter fill is critical: kick, bass, and lead vocal must be center-anchored or the mix collapses in mono. Haas effect (short delay on one channel) creates width without M/S processing but can cause comb filtering — use it sparingly. M/S compression on the sides can control stereo width: compressing just the Side channel narrows overly wide mixes without touching the center image.',
  },
  {
    id: 'tonal',
    label: 'Tonal Balance',
    tabId: 'eq-match',
    targetTab: 'EQ Match',
    question: 'Where does your mix differ most from the reference tonally? Name the specific frequency region (sub/bass/low-mid/mid/presence/air), the direction (too much or too little), the instrument most responsible, and one EQ move that would address it.\nList every track you high-pass filtered and at what frequency. Why did you cut where you did? What was in the low end of your vocals (below 80–120 Hz) that warranted cutting? Is there mud buildup in the 200–400 Hz region? Did you apply any subtractive EQ to the side channel (M/S) to remove low-frequency stereo content below 120 Hz?\nDescribe your vocal processing chain specifically: Where does the high-pass filter cut on the lead vocal, and what did you remove (proximity effect buildup, breath noise, floor rumble)? Is the de-esser before or after your main compressor, and why? Did you use two stages of compression on the vocal — a transparent fast-attack stage followed by a character stage with slower attack? What was the result?',
    hint: 'Use the subtractive-first approach: find and cut problem frequencies before boosting character frequencies. Common problems — mud: 200–400 Hz; boxiness: 400–600 Hz; harshness: 2–4 kHz; sibilance: 5–8 kHz. Wide Q boosts, narrow Q cuts.\nHPF on every non-bass element cleans the sub register and prevents mud accumulation. Rule of thumb: guitars HPF at 80–100 Hz, keyboards at 60–80 Hz, vocals at 80–120 Hz (male) or 100–150 Hz (female), room mics at 150–200 Hz. Sub-bass (below 80 Hz) should be mono — use an M/S EQ to cut the side channel below 80–120 Hz on the master bus.\nVocal chain doctrine: (1) HPF at 80–120 Hz (male) or 100–150 Hz (female) — removes proximity effect and breath floor. (2) De-esser first if the sibilance is loud enough to trigger downstream compression unevenly; after if sibilance is subtle. (3) Stage 1 compression: 2–3:1 ratio, fast attack (5–10 ms), auto release — transparent levelling. (4) Stage 2 compression: 4–6:1, slow attack (20–50 ms), 150–200 ms release — adds character and glue. The slow attack on stage 2 lets transient consonants through, preserving intelligibility. Parallel blend: 70% compressed, 30% dry restores air without losing density.',
  },
  {
    id: 'dynamics',
    label: 'Dynamics',
    tabId: 'mastering-delta',
    targetTab: 'Mastering Delta',
    question: 'What is the LRA and PLR of your mix? What is shaping the dynamics — mix bus compression, limiting, or the arrangement itself? Describe the compressor settings on your mix bus (threshold, ratio, attack, release) and how they affect the LRA.\nDescribe your sidechain compression decisions: does the bass have a sidechain from the kick? If so: what threshold, ratio, and release time? What happens to the bass energy on the kick beat? Are you using parallel compression anywhere — if so, what is the blend ratio between the dry and heavily compressed signal, and what does each layer contribute? How does parallel compression preserve transient detail while adding density?\nWhere did you use saturation in your chain — which buses, which channels? What type of saturation (tape, tube, transistor, clipper) and what character does each contribute? Did you use parallel saturation anywhere — what was the blend ratio? Why might you saturate a bass bus but NOT the master bus if the mix already contains heavily distorted guitars?',
    hint: 'LRA reflects the dynamic shape of the arrangement as well as compression decisions. A slow attack (50–100 ms) on the bus compressor lets transients through and preserves punch; a fast attack (1–5 ms) flattens the mix. The PLR shows what the limiter is doing to what the compressor left behind.\nSidechain compression (kick → bass compressor) carves frequency space on the kick beat: the bass ducks 3–6 dB for 20–80 ms, creating a rhythm pocket. Ratio 4–8:1, fast attack (1–5 ms), release matched to beat duration (60000/BPM/4 ms for 16th note). Parallel compression (New York compression): the dry signal preserves transients and air; the heavily compressed copy adds density and sustain. Start with a 30/70 dry/wet blend and adjust by feel.\nSaturation adds harmonic content: tube/tape saturation adds 2nd-order even harmonics (warm, consonant); transistor/clipper adds 3rd and 5th odd harmonics (aggressive, edgy). Even harmonics on sub-bass add an octave above the fundamental, making bass audible on small speakers without adding actual sub energy — critical for translation. Parallel saturation: blend 20–40% wet; the dry path preserves the original transients while the saturated path adds density. When NOT to saturate: already-distorted material (heavy guitars, overdriven synths) — you\'ll add mud. When the master bus is already heavily limited — saturation into a hard limiter creates harsh intermodulation.',
  },
  {
    id: 'quality',
    label: 'Artifact Check',
    tabId: 'quality',
    targetTab: 'Quality',
    question: 'Are there any clicks, digital clips, distortion artifacts, or hum? For each one found, identify the likely stage in the signal chain where it was introduced. Which is preferable — de-clicking post-export, or returning to the mix session?',
    hint: 'One audible click in a commercial release is a quality control failure. Hum at 50/60 Hz or its harmonics (100, 120, 150, 180 Hz) indicates a ground loop or unbalanced cable in the recording chain. Always fix at the source, never mask with EQ.',
  },
  {
    id: 'delivery',
    label: 'Delivery',
    tabId: 'delivery',
    targetTab: 'Delivery',
    question: 'What is the True Peak level, and is it safe for AAC encoding (which can raise peaks by up to 3 dB)? Which streaming platforms is this mix compliant for, and what is the single change that would make it compliant for all target platforms?\nWhat is the bit depth and sample rate of your final delivery file — and is that correct for the destination? If delivering 16-bit/44.1 kHz (CD, most streaming), did you apply dithering as the absolute last step before bouncing? What type of dither did you use (TPDF, noise-shaped)? If you are delivering 24-bit, dithering is not required — do you know why?',
    hint: 'AAC encode risk: if True Peak is above −1.5 dBTP, encoding may push peaks above 0 dBTP causing audible distortion. Aim for −1.0 dBTP as a delivery ceiling. Check the per-platform compliance table — Spotify −14 LUFS, Apple Music −16 LUFS, broadcast −23 LUFS.\nBit depth and sample rate for delivery: mastering session at 24-bit/96 kHz (or 32-bit float); delivery for streaming/CD at 16-bit/44.1 kHz with dither. Dithering is the final step — after the limiter, after any processing: it adds low-level random noise to prevent quantisation distortion during the 24-bit → 16-bit conversion. TPDF dither: spectrally flat, simplest, correct for most uses. Noise-shaped dither (POW-R, UV22HR): pushes the dither noise into 14–16 kHz where the ear is less sensitive — slightly quieter perceived noise floor. NEVER dither and then process — any gain change or EQ after dither re-introduces quantisation errors. For 24-bit delivery: 24-bit has 144 dB of dynamic range vs. 16-bit\'s 96 dB — quantisation distortion is inaudible at 24-bit, so dither is unnecessary.',
  },
  {
    id: 'reflection',
    label: 'Reflection',
    tabId: 'overview',
    targetTab: 'Overview',
    question: 'Document your mastering chain in order: list every processor (EQ, compressor, saturation, stereo tool, limiter) with its key settings and the problem it solved. Then write one actionable engineering instruction — the single most important change this mix needs before release.\nDid you use any M/S (Mid-Side) processing in the master chain? If so, what was applied to the Mid vs. Side channel? What parallel processing chains did you use (parallel compression, parallel saturation, parallel reverb) and what problem did each solve?\nIs this a full-mix master or would stem mastering have been preferable? What stems would you request (drums, bass, music, vocals, FX) and what would you do differently with individual stem access that you can\'t do with a stereo mix? For 16-bit delivery: confirm dithering was the absolute last step in the chain — document which dither type you used.',
    hint: 'Mastering chain order matters: EQ → Compression → Saturation → Stereo Enhancement → Limiting → Dither (16-bit delivery). Documenting the chain builds vocabulary and creates a reference for future sessions. Be specific: "High-pass at 30 Hz to remove sub rumble" beats "cleaned up the low end."\nM/S processing in mastering: EQ the Mid to fix vocal brightness or low-mid mud; EQ the Side to remove low-frequency stereo content (below 80 Hz) and control harshness (2–4 kHz). M/S compression narrows the stereo field when the sides hit the threshold. Document these separately in your chain: e.g., \'M/S EQ: Side HPF at 80 Hz, Side dip −2 dB at 3 kHz; M/S Comp: 2:1 on Sides at −18 dBFS threshold\'.\nComplete mastering chain order: EQ → Compression → Saturation → Stereo Enhancement → Limiting → Dither (if 16-bit delivery). Dithering must always be the last step — never before the limiter, never before a final EQ pass. Stem mastering advantages: separate EQ/compression per element group, cleaner LF treatment of drums without affecting bass, ability to de-ess vocals independently at mastering stage. Request stems when the full mix has: prominent low-end phase issues, sibilance that can\'t be fixed with broadband de-essing, or dynamic imbalance between elements (e.g., vocal too loud in chorus, can\'t fix with full-mix compression).',
  },
]

// ─── Persisted slice (what we save to localStorage) ──────────────────────────

interface PersistedState {
  enabled: boolean
  role: LearnRole
  step: number
  /** BUG-07: persisted so "Analysis Complete" banner survives re-renders */
  completed: boolean
  assignment: AssignmentConfig | null
  annotations: LearnAnnotation[]
  blindTest: BlindTestPredictions | null
}

const STORAGE_KEY = 'rtm-learn-mode-v1'

function loadFromStorage(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultPersisted()
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : false,
      role: parsed.role === 'teacher' ? 'teacher' : 'student',
      step: typeof parsed.step === 'number' ? Math.min(parsed.step, GUIDED_STEPS.length - 1) : 0,
      completed: typeof parsed.completed === 'boolean' ? parsed.completed : false,
      assignment: parsed.assignment ?? null,
      annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
      blindTest: parsed.blindTest ?? null,
    }
  } catch {
    return defaultPersisted()
  }
}

function defaultPersisted(): PersistedState {
  return { enabled: false, role: 'student', step: 0, completed: false, assignment: null, annotations: [], blindTest: null }
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

type Action =
  | { type: 'TOGGLE' }
  | { type: 'SET_ROLE'; role: LearnRole }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'SET_STEP'; n: number }
  | { type: 'SET_COMPLETED'; v: boolean }
  | { type: 'SET_ASSIGNMENT'; assignment: AssignmentConfig | null }
  | { type: 'ADD_ANNOTATION'; annotation: LearnAnnotation }
  | { type: 'REMOVE_ANNOTATION'; id: string }
  | { type: 'CLEAR_ANNOTATIONS'; tabId: string; stepId?: string }
  | { type: 'SUBMIT_BLIND_TEST'; predictions: BlindTestPredictions }
  | { type: 'REVEAL_BLIND_TEST'; analysisResult?: any }
  | { type: 'RESET_BLIND_TEST' }

function reducer(state: PersistedState, action: Action): PersistedState {
  switch (action.type) {
    case 'TOGGLE':
      return { ...state, enabled: !state.enabled }
    case 'SET_ROLE':
      return { ...state, role: action.role }
    case 'NEXT_STEP':
      return { ...state, step: Math.min(state.step + 1, GUIDED_STEPS.length - 1) }
    case 'PREV_STEP':
      return { ...state, step: Math.max(state.step - 1, 0) }
    case 'SET_STEP':
      return { ...state, step: Math.max(0, Math.min(action.n, GUIDED_STEPS.length - 1)) }
    case 'SET_COMPLETED':
      return { ...state, completed: action.v }
    case 'SET_ASSIGNMENT':
      return { ...state, assignment: action.assignment }
    case 'ADD_ANNOTATION':
      return { ...state, annotations: [...state.annotations, action.annotation] }
    case 'REMOVE_ANNOTATION':
      return { ...state, annotations: state.annotations.filter(a => a.id !== action.id) }
    case 'CLEAR_ANNOTATIONS':
      // BUG-16 fix: when stepId is provided, only clear annotations for that step
      return {
        ...state,
        annotations: state.annotations.filter(a => {
          if (a.tabId !== action.tabId) return true  // different tab — keep
          if (!action.stepId) return false             // no stepId → clear all for this tab
          // stepId provided → clear only if annotation's stepId matches (or annotation has no stepId)
          return a.stepId !== undefined && a.stepId !== action.stepId
        }),
      }
    case 'SUBMIT_BLIND_TEST':
      return { ...state, blindTest: action.predictions }
    case 'REVEAL_BLIND_TEST': {
      if (!state.blindTest) return state
      // BUG-12 fix: stamp isCorrect on each measurable answer at reveal time
      const ar = action.analysisResult ?? {}
      const revealedAnswers = state.blindTest.answers.map(a => {
        let isCorrect: boolean | undefined
        const c = a.choice
        const abs = (n: number) => Math.abs(n)
        if (a.dimension === 'loudness') {
          const d = (ar.lufs_i_a ?? ar.lufs_a) - (ar.lufs_i_b ?? ar.lufs_b)
          if (!isNaN(d)) isCorrect = abs(d) < 0.5 ? c === 'equal' : d > 0 ? c === 'A' : c === 'B'
        } else if (a.dimension === 'stereo_width') {
          const d = ar.stereo_width_a - ar.stereo_width_b
          if (!isNaN(d)) isCorrect = abs(d) < 0.1 ? c === 'equal' : d > 0 ? c === 'A' : c === 'B'
        } else if (a.dimension === 'dynamics') {
          const d = ar.lra_a - ar.lra_b
          if (!isNaN(d)) isCorrect = abs(d) < 0.1 ? c === 'equal' : d < 0 ? c === 'A' : c === 'B'
        } else if (a.dimension === 'translation') {
          const d = ar.mono_compat_a - ar.mono_compat_b
          if (!isNaN(d)) isCorrect = abs(d) < 0.1 ? c === 'equal' : d > 0 ? c === 'A' : c === 'B'
        }
        return { ...a, isCorrect }
      })
      return { ...state, blindTest: { ...state.blindTest, revealed: true, answers: revealedAnswers } }
    }
    case 'RESET_BLIND_TEST':
      return { ...state, blindTest: null }
    default:
      return state
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────

const LearnModeContext = createContext<LearnModeState | null>(null)

export function LearnModeProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadFromStorage)

  // Persist every state change.
  useEffect(() => {
    try {
      const persisted: PersistedState = {
        enabled: state.enabled,
        role: state.role,
        step: state.step,
        completed: state.completed,
        assignment: state.assignment,
        annotations: state.annotations,
        blindTest: state.blindTest,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
    } catch { /* swallow — storage is best-effort */ }
  }, [state.enabled, state.role, state.step, state.completed, state.assignment, state.annotations, state.blindTest])

  const toggleLearnMode = useCallback(() => dispatch({ type: 'TOGGLE' }), [])
  const setRole = useCallback((role: LearnRole) => dispatch({ type: 'SET_ROLE', role }), [])
  const nextStep = useCallback(() => dispatch({ type: 'NEXT_STEP' }), [])
  const prevStep = useCallback(() => dispatch({ type: 'PREV_STEP' }), [])
  const setStep = useCallback((n: number) => dispatch({ type: 'SET_STEP', n }), [])
  const setCompleted = useCallback((v: boolean) => dispatch({ type: 'SET_COMPLETED', v }), [])
  const setAssignment = useCallback((assignment: AssignmentConfig | null) => dispatch({ type: 'SET_ASSIGNMENT', assignment }), [])

  const addAnnotation = useCallback((a: Omit<LearnAnnotation, 'id' | 'createdAt'>) => {
    const annotation: LearnAnnotation = {
      ...a,
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
    }
    dispatch({ type: 'ADD_ANNOTATION', annotation })
  }, [])

  const removeAnnotation = useCallback((id: string) => dispatch({ type: 'REMOVE_ANNOTATION', id }), [])
  const clearAnnotations = useCallback((tabId: string, stepId?: string) => dispatch({ type: 'CLEAR_ANNOTATIONS', tabId, stepId }), [])

  const submitBlindTest = useCallback((p: BlindTestPredictions) => dispatch({ type: 'SUBMIT_BLIND_TEST', predictions: p }), [])
  const revealBlindTest = useCallback((analysisResult?: any) => dispatch({ type: 'REVEAL_BLIND_TEST', analysisResult }), [])
  const resetBlindTest = useCallback(() => dispatch({ type: 'RESET_BLIND_TEST' }), [])

  const value: LearnModeState = {
    enabled: state.enabled,
    role: state.role,
    step: state.step,
    completed: state.completed,
    assignment: state.assignment,
    annotations: state.annotations,
    blindTest: state.blindTest,
    toggleLearnMode,
    setRole,
    nextStep,
    prevStep,
    setStep,
    setCompleted,
    setAssignment,
    addAnnotation,
    removeAnnotation,
    clearAnnotations,
    submitBlindTest,
    revealBlindTest,
    resetBlindTest,
  }

  return (
    <LearnModeContext.Provider value={value}>
      {children}
    </LearnModeContext.Provider>
  )
}

/** Hook to consume LearnModeContext. Throws if used outside LearnModeProvider. */
export function useLearnMode(): LearnModeState {
  const ctx = useContext(LearnModeContext)
  if (!ctx) throw new Error('useLearnMode must be used inside <LearnModeProvider>')
  return ctx
}
