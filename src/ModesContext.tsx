import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'

/**
 * User surface — controls which groups of panels + DSP profiles the UI
 * shows by default. Panel feedback (round 3): hobbyists felt
 * "Atmos + broadcast + TikTok + DMR" surfaces made the app feel "not
 * for me," while pros wanted every tool at hand. Four tiers:
 *
 * streaming — music-only, Spotify / Apple / YouTube / Tidal /
 * Amazon + Social group. Hides broadcast, Atmos,
 * DMR panels by default.
 * full — everything (the current default). Pro music +
 * broadcast + Atmos. Advanced QC still collapsed.
 * broadcast — broadcast-first: R128 / A85 / Netflix at top,
 * dialog gate prominent, streaming pushed down.
 * post — Atmos / immersive work: Atmos module expanded,
 * ADM validation surfaced.
 *
 * Surface picker lives in the header. Persisted via localStorage.
 */
export type UserSurface = 'streaming' | 'full' | 'broadcast' | 'post' | 'netflix'

/**
 * Advanced-QC defaults per surface, per the final 
 */
export function defaultAdvancedQcForSurface(s: UserSurface): boolean {
 return s === 'post' || s === 'broadcast' || s === 'netflix'
}

interface Modes {
 educator: boolean
 blind: boolean
 surface: UserSurface
 /** Show collapsed-by-default Advanced QC panels (Masking / Phase
 * Bands / Transient Density / Waveform Diff). */
 advancedQc: boolean
 setEducator: (v: boolean) => void
 setBlind: (v: boolean) => void
 setSurface: (v: UserSurface) => void
 setAdvancedQc: (v: boolean) => void
 toggleEducator: () => void
 toggleBlind: () => void
 toggleAdvancedQc: () => void
}

const ModesContext = createContext<Modes>({
 educator: false,
 blind: false,
 surface: 'full',
 advancedQc: false,
 setEducator: () => {},
 setBlind: () => {},
 setSurface: () => {},
 setAdvancedQc: () => {},
 toggleEducator: () => {},
 toggleBlind: () => {},
 toggleAdvancedQc: () => {},
})

export function ModesProvider({ children }: { children: React.ReactNode }) {
 const [educator, setEducator] = useState<boolean>(() => {
 try { return localStorage.getItem('rtm-educator') === '1' } catch { return false }
 })
 const [blind, setBlind] = useState<boolean>(() => {
 try { return localStorage.getItem('rtm-blind') === '1' } catch { return false }
 })
 const [surface, setSurfaceState] = useState<UserSurface>(() => {
 try {
 const v = localStorage.getItem('rtm-surface')
 return (v === 'streaming' || v === 'full' || v === 'broadcast' || v === 'post' || v === 'netflix') ? v : 'full'
 } catch { return 'full' }
 })
 // Per-surface manual-override map. Keys are surfaces the user has
 // explicitly toggled AQC on; values are the toggled value. On surface
 // change, if the target surface has an entry here, use it. Otherwise
 // fall back to the surface's default. Persisted to localStorage so
 // overrides survive restarts 
 // Currently it resets. Make the touched-flag surface-scoped."
 const [advancedQcOverrides, setAdvancedQcOverrides] = useState<Partial<Record<UserSurface, boolean>>>(() => {
 try {
 const raw = localStorage.getItem('rtm-advanced-qc-overrides')
 if (!raw) return {}
 const parsed = JSON.parse(raw)
 // Only keep valid surface keys — defensive against localStorage
 // tampering or schema drift from an older build.
 const out: Partial<Record<UserSurface, boolean>> = {}
 for (const key of Object.keys(parsed)) {
 if (key === 'streaming' || key === 'full' || key === 'broadcast' || key === 'post' || key === 'netflix') {
 if (typeof parsed[key] === 'boolean') out[key as UserSurface] = parsed[key]
 }
 }
 return out
 } catch { return {} }
 })
 useEffect(() => {
 try { localStorage.setItem('rtm-advanced-qc-overrides', JSON.stringify(advancedQcOverrides)) } catch {}
 }, [advancedQcOverrides])

 // Initialise advancedQc from the override map if one exists for the
 // current surface; otherwise from the surface's hard-coded default.
 const [advancedQc, setAdvancedQc] = useState<boolean>(() => {
 try {
 const saved = localStorage.getItem('rtm-surface')
 const s: UserSurface = (saved === 'streaming' || saved === 'full' || saved === 'broadcast' || saved === 'post' || saved === 'netflix') ? saved : 'full'
 // Use the same override map we just hydrated. Can't read
 // `advancedQcOverrides` here because it's initialised in parallel;
 // re-hydrate inline from localStorage so the first-paint state is
 // right without a useEffect flicker.
 const rawOv = localStorage.getItem('rtm-advanced-qc-overrides')
 if (rawOv) {
 try {
 const ov = JSON.parse(rawOv)
 if (typeof ov[s] === 'boolean') return ov[s]
 } catch {}
 }
 return defaultAdvancedQcForSurface(s)
 } catch { return false }
 })

 // Surface change: if the target surface has a persisted override, use
 // it; otherwise apply the hard-coded default. The user's manual flip
 // within any surface (via toggleAdvancedQc) writes to the override map
 // so it survives round-trips through other surfaces AND across sessions.
 const setSurface = useCallback((next: UserSurface) => {
 setSurfaceState(next)
 setAdvancedQc(prev => {
 // Pull the override map's current value via the setter-callback
 // pattern to avoid stale closure — setAdvancedQcOverrides above is
 // synchronous but we want the most recent ref.
 const raw = localStorage.getItem('rtm-advanced-qc-overrides')
 if (raw) {
 try {
 const ov = JSON.parse(raw)
 if (typeof ov[next] === 'boolean') return ov[next]
 } catch {}
 }
 return defaultAdvancedQcForSurface(next)
 })
 }, [])

 useEffect(() => {
 try { localStorage.setItem('rtm-educator', educator ? '1' : '0') } catch {}
 document.documentElement.dataset.educator = educator ? '1' : '0'
 }, [educator])

 useEffect(() => {
 try { localStorage.setItem('rtm-blind', blind ? '1' : '0') } catch {}
 document.documentElement.dataset.blind = blind ? '1' : '0'
 }, [blind])

 useEffect(() => {
 try { localStorage.setItem('rtm-surface', surface) } catch {}
 document.documentElement.dataset.surface = surface
 }, [surface])

 useEffect(() => {
 try { localStorage.setItem('rtm-advanced-qc', advancedQc ? '1' : '0') } catch {}
 document.documentElement.dataset.advancedQc = advancedQc ? '1' : '0'
 }, [advancedQc])

 const toggleEducator = useCallback(() => setEducator(v => !v), [])
 const toggleBlind = useCallback(() => setBlind(v => !v), [])
 // Manual toggle — writes the new value into the per-surface override
 // map so the choice survives surface round-trips AND process restarts.
 // Uses a ref to read the *current* surface (not a stale closure).
 const toggleAdvancedQc = useCallback(() => {
 setAdvancedQc(v => {
 const next = !v
 setSurfaceState(cur => {
 setAdvancedQcOverrides(ov => ({ ...ov, [cur]: next }))
 return cur
 })
 return next
 })
 }, [])

 // 5.2.4: memoise the provider value. Without this, every render of
 // ModesProvider invalidates every useModes() consumer (the inline
 // object literal is a fresh reference each render). The 5.2.0 audit
 // (P0 #8 companion fix) called this out; the fix never landed —
 // 5.2.4 QA caught it. Cheap one-line fix; major perf win on the
 // ABPlayer + AnalysisView re-render path because TpMeter + every
 // surface toggle consumer now stays stable.
 const value = useMemo(() => ({
 educator, blind, surface, advancedQc,
 setEducator, setBlind, setSurface, setAdvancedQc,
 toggleEducator, toggleBlind, toggleAdvancedQc,
 }), [educator, blind, surface, advancedQc, setSurface, toggleEducator, toggleBlind, toggleAdvancedQc])

 return (
 <ModesContext.Provider value={value}>
 {children}
 </ModesContext.Provider>
 )
}

export function useModes() {
 return useContext(ModesContext)
}
