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
    id: 'metering',
    label: 'Loudness',
    tabId: 'overview',
    question: 'What is the integrated LUFS of your mix, and how far is it from the Spotify −14 LUFS target?',
    hint: 'Look at the LUFS-I number in the instrument row and the streaming preview table.',
  },
  {
    id: 'stereo',
    label: 'Stereo Imaging',
    tabId: 'stereo-spectrum',
    question: 'Is your mix mono-compatible? What percentage of signal is lost when summed to mono?',
    hint: 'Check the Mono Compat Loss % in the stereo panel.',
  },
  {
    id: 'tonal',
    label: 'Tonal Balance',
    tabId: 'eq-match',
    question: 'Where does your mix differ most from the reference tonally? Name the frequency region and direction.',
    hint: 'Read the Tonal Curve deviation bars.',
  },
  {
    id: 'dynamics',
    label: 'Dynamics',
    tabId: 'mastering-delta',
    question: 'What is the dynamic range (LRA) of your mix, and is it appropriate for the genre?',
    hint: 'LRA target for most commercial genres is 6–9 LU.',
  },
  {
    id: 'breakdown',
    label: 'Mix Breakdown',
    tabId: 'breakdown',
    question: 'Which element is loudest in your mix? Is it masking another element?',
    hint: 'The Masking Overlap panel shows frequency conflicts between elements.',
  },
  {
    id: 'quality',
    label: 'Artifact Check',
    tabId: 'quality',
    question: 'Are there any clicks, clipping samples, or distortion issues? List them.',
    hint: 'Check the click timeline and the distortion severity badge.',
  },
  {
    id: 'delivery',
    label: 'Delivery',
    tabId: 'delivery',
    question: 'Which streaming platforms is your mix ready for, and what single change would most improve delivery readiness?',
    hint: 'Check the per-platform spec table in the Delivery panel.',
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
