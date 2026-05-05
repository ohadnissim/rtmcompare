import React, { createContext, useContext, useState, useCallback, useMemo } from 'react'

/**
 * Global EQ state — lets the main A/B player audition filter moves live
 * while playback continues. The competitive goal: match FabFilter Pro-Q's
 * instant-audition behaviour (toggle a band, hear the change now) so users
 * don't have to stop, re-press play, and rebuild context on every move.
 *
 * Design:
 * • One source of truth for proposed bands + overall amount.
 * • EngineerTipsPanel / ReferenceMatchEQPanel write into this context.
 * • ABPlayer reads from it and maintains a biquad bank at the tail of
 * its listen chain (stereo → biquad → destination), updating filter
 * parameters in real time with no playback interruption.
 * • `enabled` gates whether the bank is routed in the graph. When
 * `false`, ABPlayer bypasses the filter bank entirely (zero CPU).
 *
 * We intentionally keep the band shape parametric (biquad-friendly) so
 * the main-player filter chain can be built with standard Web Audio
 * BiquadFilterNodes — no custom DSP required, no resampling weirdness.
 */

export interface EQBand {
 /** Stable key so filter nodes can be diffed on update. */
 id: string
 /** Centre frequency in Hz. */
 freq: number
 /** Gain in dB. Negative for cuts, positive for boosts. */
 gain_db: number
 /** Quality factor (bandwidth). Higher = narrower. */
 q: number
 /** Optional type. Defaults to 'peaking'. Use 'lowshelf' /
 * 'highshelf' when a band is generated for shelving context. */
 type?: BiquadFilterType
 /** Whether this band is currently engaged. User-toggleable per band. */
 enabled: boolean
 /** Optional label for tooltip ("boost presence", "tame 3 k harshness"). */
 label?: string
}

interface EQContextValue {
 bands: EQBand[]
 /** Overall scaling (0 = bypass, 1 = bands as proposed, 0.5 = half). */
 amount: number
 /** Whether the bank is engaged in the main player's listen chain. */
 enabled: boolean
 /** Soft counter bumped when bands are pushed from a new proposer
 * (engineer tips, reference match, master assistant). Downstream
 * effects key off this so re-proposals after user edits cleanly
 * reset the bank rather than diff-editing node-by-node. */
 proposalKey: number
 /** Reference spectrum curve (31-band 1/3-octave) picked in the
 * Reference Match flow. When set, the ABPlayer overlays a gold
 * curve above the waveform so the engineer can judge tonal
 * alignment while scrubbing the master. Null when no reference
 * selected. */
 referenceCurve: number[] | null
 referenceLabel: string | null
 setReferenceCurve: (curve: number[] | null, label?: string | null) => void
 setBands: (b: EQBand[]) => void
 patchBand: (id: string, patch: Partial<EQBand>) => void
 setAmount: (a: number) => void
 setEnabled: (v: boolean) => void
 /** Reset the bank + disable routing. Called on Clear. */
 clear: () => void
}

const EQContext = createContext<EQContextValue | null>(null)

export function EQProvider({ children }: { children: React.ReactNode }) {
 const [bands, setBandsRaw] = useState<EQBand[]>([])
 const [amount, setAmount] = useState<number>(1)
 const [enabled, setEnabled] = useState<boolean>(false)
 const [proposalKey, setProposalKey] = useState(0)
 const [referenceCurve, setReferenceCurveRaw] = useState<number[] | null>(null)
 const [referenceLabel, setReferenceLabel] = useState<string | null>(null)

 const setBands = useCallback((b: EQBand[]) => {
 setBandsRaw(b)
 setProposalKey(k => k + 1)
 }, [])

 const patchBand = useCallback((id: string, patch: Partial<EQBand>) => {
 setBandsRaw(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b))
 }, [])

 const setReferenceCurve = useCallback((curve: number[] | null, label?: string | null) => {
 setReferenceCurveRaw(curve)
 setReferenceLabel(label ?? null)
 }, [])

 const clear = useCallback(() => {
 setBandsRaw([])
 setEnabled(false)
 setAmount(1)
 setReferenceCurveRaw(null)
 setReferenceLabel(null)
 setProposalKey(k => k + 1)
 }, [])

 const value = useMemo<EQContextValue>(() => ({
 bands, amount, enabled, proposalKey, referenceCurve, referenceLabel,
 setBands, patchBand, setAmount, setEnabled, setReferenceCurve, clear,
 }), [bands, amount, enabled, proposalKey, referenceCurve, referenceLabel, setBands, patchBand, setReferenceCurve, clear])

 return <EQContext.Provider value={value}>{children}</EQContext.Provider>
}

export function useEQ(): EQContextValue {
 const ctx = useContext(EQContext)
 if (!ctx) {
 // Fall back to a no-op implementation so components don't crash when
 // mounted outside the provider (tests, storybook). The provider
 // sits at main.tsx alongside ModesProvider / ThemeProvider for all
 // real app code.
 return {
 bands: [], amount: 1, enabled: false, proposalKey: 0,
 referenceCurve: null, referenceLabel: null,
 setBands: () => {}, patchBand: () => {},
 setAmount: () => {}, setEnabled: () => {},
 setReferenceCurve: () => {}, clear: () => {},
 }
 }
 return ctx
}
