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
import type { LearnModeState, LearnRole, AssignmentConfig, LearnAnnotation, LearnGuidedStep } from '../types'

// ─── Guided Steps ────────────────────────────────────────────────────────────

export const GUIDED_STEPS: LearnGuidedStep[] = [
  {
    id: 'listening',
    label: 'Methodology',
    tabId: 'overview',
    question: 'Before measuring anything: listen to both files twice without looking at meters. What do you notice first — loudness, tone, space, or something else?',
    hint: 'Critical listening comes before critical metering. Your ears catch things numbers miss — trust them first.',
  },
  {
    id: 'metering',
    label: 'Loudness',
    tabId: 'overview',
    question: 'What is the integrated LUFS-I of your mix, and how far is it from the target? Would streaming normalization help or hurt this mix?',
    hint: 'Look at the LUFS-I number in the Overview panel. Spotify targets −14 LUFS-I; Apple Music targets −16 LUFS-I.',
  },
  {
    id: 'stereo',
    label: 'Stereo & Phase',
    tabId: 'stereo-spectrum',
    question: 'Is your mix mono-compatible? What percentage of signal is lost in mono — and can you hear the difference on a single speaker?',
    hint: 'Check Mono Compat Loss %. Below 5% is excellent. Check the correlation meter too: values near +1 are safe, near −1 mean phase cancellation.',
  },
  {
    id: 'tonal',
    label: 'Tonal Balance',
    tabId: 'eq-match',
    question: 'Where does your mix differ most from the reference tonally? Name the frequency region, direction (too much/too little), and what instrument is likely responsible.',
    hint: 'Read the Tonal Curve deviation bars. Common culprits: low-mid mud (200–500 Hz), harsh presence (2–4 kHz), or missing air (10 kHz+).',
  },
  {
    id: 'dynamics',
    label: 'Dynamics',
    tabId: 'mastering-delta',
    question: 'What is the LRA and PLR of your mix? Is the dynamic range appropriate for the genre, or has heavy limiting eroded the punch?',
    hint: 'LRA target varies by genre: Pop 4–7 LU, Rock 8–12 LU, Classical 14+ LU. PLR below 6 LU is a warning sign of over-limiting.',
  },
  {
    id: 'breakdown',
    label: 'Mix Breakdown',
    tabId: 'breakdown',
    question: 'Which element is loudest in your mix? Is it masking another element, and what EQ move would fix it?',
    hint: 'The Masking Overlap panel shows frequency conflicts. Try carving the masking element above its fundamental frequency to make space.',
  },
  {
    id: 'quality',
    label: 'Artifact Check',
    tabId: 'quality',
    question: 'Are there any clicks, clipping samples, distortion, or hum issues? For each one found, describe the likely cause.',
    hint: 'Check the Click Timeline, Distortion badge, and Hum severity. A single audible click in a release is a serious quality control failure.',
  },
  {
    id: 'delivery',
    label: 'Delivery',
    tabId: 'delivery',
    question: 'Which streaming platforms is your mix ready for? What is the True Peak level, and will AAC encoding introduce any headroom risk?',
    hint: 'AAC encoding can raise true peaks by up to 3 dB. Aim for −1.0 dBTP to leave encode headroom. Check the per-platform spec table.',
  },
  {
    id: 'reflection',
    label: 'Reflection',
    tabId: 'overview',
    question: 'What is the single most important change you would make to this mix before release? Write it as an actionable engineering instruction.',
    hint: 'Be specific: "Reduce the 200 Hz shelf by 2 dB on the bass bus" is better than "fix the low end." Specificity builds engineering vocabulary.',
  },
]

// ─── Persisted slice (what we save to localStorage) ──────────────────────────

interface PersistedState {
  enabled: boolean
  role: LearnRole
  step: number
  assignment: AssignmentConfig | null
  annotations: LearnAnnotation[]
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
      step: typeof parsed.step === 'number' ? parsed.step : 0,
      assignment: parsed.assignment ?? null,
      annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
    }
  } catch {
    return defaultPersisted()
  }
}

function defaultPersisted(): PersistedState {
  return { enabled: false, role: 'student', step: 0, assignment: null, annotations: [] }
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
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
    } catch { /* swallow — storage is best-effort */ }
  }, [state.enabled, state.role, state.step, state.assignment, state.annotations])

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

  const value: LearnModeState = {
    enabled: state.enabled,
    role: state.role,
    step: state.step,
    assignment: state.assignment,
    annotations: state.annotations,
    toggleLearnMode,
    setRole,
    nextStep,
    prevStep,
    setStep,
    setAssignment,
    addAnnotation,
    removeAnnotation,
    clearAnnotations,
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
