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
    question: 'Before looking at a single meter: listen through both files on your main monitors, then again on headphones, then on a laptop speaker or phone. What differences do you notice across playback systems? How does your mix translate?\nWhen you listened on laptop speakers, did the low end disappear? Did the vocal become more or less intelligible? How did the stereo width collapse feel? What did you notice on headphones vs. open-back monitors?',
    hint: 'Translation check is the first professional step. The goal is to hear what the numbers will later confirm — or contradict. Note loudness, tonal character, stereo width, and anything that feels "wrong" on any system.\nTranslation issues are always frequency-specific: low end disappears on laptop speakers, harsh mids amplify on earbuds, excessive reverb smears on phone speakers.',
  },
  {
    id: 'metering',
    label: 'Loudness',
    tabId: 'overview',
    question: 'What is the LUFS-I and PLR of your mix? Before the limiter, what is your mix bus peak level — is it hitting around −6 to −3 dBFS? Has gain staging been maintained at every stage from recording through processing to the master bus?\nIs the PLR difference between A and B caused by the mix dynamics themselves, or by the limiter alone? If you removed the limiter, what would PLR be?',
    hint: 'Gain staging rule: recording −18 to −12 dBFS, processing −18 to −12 dBFS, mix bus −6 to −3 dBFS before limiting. A PLR below 6 LU means the limiter is working too hard — fix gain staging upstream first.\nA PLR above 14 LU with heavy limiting means the compressor upstream is doing the real work — the limiter is just catching peaks. Fix the bus compression settings before touching the limiter ceiling.',
  },
  {
    id: 'breakdown',
    label: 'Mix Breakdown',
    tabId: 'breakdown',
    question: 'What is the element hierarchy of your mix — which element sits loudest, which provides the foundation, which cuts through? Is any element masking another in the same frequency band? Describe your bus architecture: what stems or groups are you using?\nWhat reverb types are you using on the main elements — plate, hall, room, or algorithmic? What is the pre-delay setting on your main vocal reverb (aim for 20–60 ms for separation)? Does your reverb decay time match the tempo? Quick check: 60000/BPM × 0.75 = dotted quarter note in ms — a decay longer than 2 bars will blur fast tempos. Are you using any sends for parallel reverb/delay routing, or inserting FX directly on channels?',
    hint: 'Mix Breakdown comes before tonal and dynamics analysis because masking and element balance are root causes — not symptoms. Fix the element hierarchy and the tonal/dynamics numbers often fix themselves.\nReverb type determines character: plate is dense and bright (vocals, snare), hall is long and wide (orchestral, pads), room is tight and natural (drums, acoustic). Pre-delay (20–60 ms) separates the dry sound from the reverb tail, preventing the reverb from masking the source. Tempo-sync your delays: 60000/BPM for quarter notes, half that for eighths.',
  },
  {
    id: 'stereo',
    label: 'Stereo & Phase',
    tabId: 'stereo-spectrum',
    question: 'What is the mono compatibility loss percentage, and how does the mix sound on a single speaker? Check the correlation meter — what does a value near +1 vs near −1 mean? Where in the frequency spectrum does the most phase cancellation occur?\nDescribe your panning architecture: what sits in the center (kick, bass, lead vocal, snare)? What is hard-panned (guitars, pads, doubles)? Are you using Haas effect (a 1–30 ms delay copy on one side for width without M/S artifacts)? Is there enough center-fill — does the mix still have body and punch when summed to mono? If you used M/S (Mid-Side) processing: what did you apply to the Mid channel vs. the Side channel, and why?',
    hint: 'Phase cancellation is frequency-specific. Sub-bass phase issues (below 120 Hz) cause the most mono compat loss and are most damaging on club systems. High-frequency correlation near −1 on cymbals is usually fine. LF correlation near −1 is a serious problem.\nCenter fill is critical: kick, bass, and lead vocal must be center-anchored or the mix collapses in mono. Haas effect (short delay on one channel) creates width without M/S processing but can cause comb filtering — use it sparingly. M/S compression on the sides can control stereo width: compressing just the Side channel narrows overly wide mixes without touching the center image.',
  },
  {
    id: 'tonal',
    label: 'Tonal Balance',
    tabId: 'eq-match',
    question: 'Where does your mix differ most from the reference tonally? Name the specific frequency region (sub/bass/low-mid/mid/presence/air), the direction (too much or too little), the instrument most responsible, and one EQ move that would address it.\nList every track you high-pass filtered and at what frequency. Why did you cut where you did? What was in the low end of your vocals (below 80–120 Hz) that warranted cutting? Is there mud buildup in the 200–400 Hz region? Did you apply any subtractive EQ to the side channel (M/S) to remove low-frequency stereo content below 120 Hz?',
    hint: 'Use the subtractive-first approach: find and cut problem frequencies before boosting character frequencies. Common problems — mud: 200–400 Hz; boxiness: 400–600 Hz; harshness: 2–4 kHz; sibilance: 5–8 kHz. Wide Q boosts, narrow Q cuts.\nHPF on every non-bass element cleans the sub register and prevents mud accumulation. Rule of thumb: guitars HPF at 80–100 Hz, keyboards at 60–80 Hz, vocals at 80–120 Hz (male) or 100–150 Hz (female), room mics at 150–200 Hz. Sub-bass (below 80 Hz) should be mono — use an M/S EQ to cut the side channel below 80–120 Hz on the master bus.',
  },
  {
    id: 'dynamics',
    label: 'Dynamics',
    tabId: 'mastering-delta',
    question: 'What is the LRA and PLR of your mix? What is shaping the dynamics — mix bus compression, limiting, or the arrangement itself? Describe the compressor settings on your mix bus (threshold, ratio, attack, release) and how they affect the LRA.\nDescribe your sidechain compression decisions: does the bass have a sidechain from the kick? If so: what threshold, ratio, and release time? What happens to the bass energy on the kick beat? Are you using parallel compression anywhere — if so, what is the blend ratio between the dry and heavily compressed signal, and what does each layer contribute? How does parallel compression preserve transient detail while adding density?',
    hint: 'LRA reflects the dynamic shape of the arrangement as well as compression decisions. A slow attack (50–100 ms) on the bus compressor lets transients through and preserves punch; a fast attack (1–5 ms) flattens the mix. The PLR shows what the limiter is doing to what the compressor left behind.\nSidechain compression (kick → bass compressor) carves frequency space on the kick beat: the bass ducks 3–6 dB for 20–80 ms, creating a rhythm pocket. Ratio 4–8:1, fast attack (1–5 ms), release matched to beat duration (60000/BPM/4 ms for 16th note). Parallel compression (New York compression): the dry signal preserves transients and air; the heavily compressed copy adds density and sustain. Start with a 30/70 dry/wet blend and adjust by feel.',
  },
  {
    id: 'quality',
    label: 'Artifact Check',
    tabId: 'quality',
    question: 'Are there any clicks, digital clips, distortion artifacts, or hum? For each one found, identify the likely stage in the signal chain where it was introduced. Which is preferable — de-clicking post-export, or returning to the mix session?',
    hint: 'One audible click in a commercial release is a quality control failure. Hum at 50/60 Hz or its harmonics (100, 120, 150, 180 Hz) indicates a ground loop or unbalanced cable in the recording chain. Always fix at the source, never mask with EQ.',
  },
  {
    id: 'delivery',
    label: 'Delivery',
    tabId: 'delivery',
    question: 'What is the True Peak level, and is it safe for AAC encoding (which can raise peaks by up to 3 dB)? Which streaming platforms is this mix compliant for, and what is the single change that would make it compliant for all target platforms?',
    hint: 'AAC encode risk: if True Peak is above −1.5 dBTP, encoding may push peaks above 0 dBTP causing audible distortion. Aim for −1.0 dBTP as a delivery ceiling. Check the per-platform compliance table — Spotify −14 LUFS, Apple Music −16 LUFS, broadcast −23 LUFS.',
  },
  {
    id: 'reflection',
    label: 'Reflection',
    tabId: 'overview',
    question: 'Document your mastering chain in order: list every processor (EQ, compressor, saturation, stereo tool, limiter) with its key settings and the problem it solved. Then write one actionable engineering instruction — the single most important change this mix needs before release.\nDid you use any M/S (Mid-Side) processing in the master chain? If so, what was applied to the Mid vs. Side channel? What parallel processing chains did you use (parallel compression, parallel saturation, parallel reverb) and what problem did each solve?',
    hint: 'Mastering chain order matters: EQ → Compression → Saturation → Stereo Enhancement → Limiting. Documenting the chain builds vocabulary and creates a reference for future sessions. Be specific: "High-pass at 30 Hz to remove sub rumble" beats "cleaned up the low end."\nM/S processing in mastering: EQ the Mid to fix vocal brightness or low-mid mud; EQ the Side to remove low-frequency stereo content (below 80 Hz) and control harshness (2–4 kHz). M/S compression narrows the stereo field when the sides hit the threshold. Document these separately in your chain: e.g., \'M/S EQ: Side HPF at 80 Hz, Side dip −2 dB at 3 kHz; M/S Comp: 2:1 on Sides at −18 dBFS threshold\'.',
  },
]

// ─── Persisted slice (what we save to localStorage) ──────────────────────────

interface PersistedState {
  enabled: boolean
  role: LearnRole
  step: number
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
      assignment: parsed.assignment ?? null,
      annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
      blindTest: parsed.blindTest ?? null,
    }
  } catch {
    return defaultPersisted()
  }
}

function defaultPersisted(): PersistedState {
  return { enabled: false, role: 'student', step: 0, assignment: null, annotations: [], blindTest: null }
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

type Action =
  | { type: 'TOGGLE' }
  | { type: 'SET_ROLE'; role: LearnRole }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'SET_STEP'; n: number }
  | { type: 'SET_ASSIGNMENT'; assignment: AssignmentConfig | null }
  | { type: 'ADD_ANNOTATION'; annotation: LearnAnnotation }
  | { type: 'REMOVE_ANNOTATION'; id: string }
  | { type: 'CLEAR_ANNOTATIONS' }
  | { type: 'SUBMIT_BLIND_TEST'; predictions: BlindTestPredictions }
  | { type: 'REVEAL_BLIND_TEST' }
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
    case 'SET_ASSIGNMENT':
      return { ...state, assignment: action.assignment }
    case 'ADD_ANNOTATION':
      return { ...state, annotations: [...state.annotations, action.annotation] }
    case 'REMOVE_ANNOTATION':
      return { ...state, annotations: state.annotations.filter(a => a.id !== action.id) }
    case 'CLEAR_ANNOTATIONS':
      return { ...state, annotations: [] }
    case 'SUBMIT_BLIND_TEST':
      return { ...state, blindTest: action.predictions }
    case 'REVEAL_BLIND_TEST':
      if (!state.blindTest) return state
      return { ...state, blindTest: { ...state.blindTest, revealed: true } }
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
        assignment: state.assignment,
        annotations: state.annotations,
        blindTest: state.blindTest,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
    } catch { /* swallow — storage is best-effort */ }
  }, [state.enabled, state.role, state.step, state.assignment, state.annotations, state.blindTest])

  const toggleLearnMode = useCallback(() => dispatch({ type: 'TOGGLE' }), [])
  const setRole = useCallback((role: LearnRole) => dispatch({ type: 'SET_ROLE', role }), [])
  const nextStep = useCallback(() => dispatch({ type: 'NEXT_STEP' }), [])
  const prevStep = useCallback(() => dispatch({ type: 'PREV_STEP' }), [])
  const setStep = useCallback((n: number) => dispatch({ type: 'SET_STEP', n }), [])
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
  const clearAnnotations = useCallback(() => dispatch({ type: 'CLEAR_ANNOTATIONS' }), [])

  const submitBlindTest = useCallback((p: BlindTestPredictions) => dispatch({ type: 'SUBMIT_BLIND_TEST', predictions: p }), [])
  const revealBlindTest = useCallback(() => dispatch({ type: 'REVEAL_BLIND_TEST' }), [])
  const resetBlindTest = useCallback(() => dispatch({ type: 'RESET_BLIND_TEST' }), [])

  const value: LearnModeState = {
    enabled: state.enabled,
    role: state.role,
    step: state.step,
    assignment: state.assignment,
    annotations: state.annotations,
    blindTest: state.blindTest,
    toggleLearnMode,
    setRole,
    nextStep,
    prevStep,
    setStep,
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
