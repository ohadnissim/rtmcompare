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
 // 5.4.1 simplification: replaced the per-surface override map (which
 // didn't actually persist reliably — the comment block above used to
 // read "Currently it resets") with a simpler "once-touched, sticky"
 // model. Mental model: each surface ships a default (post / broadcast
 // / netflix → on; music / full → off). The first time the user
 // toggles, we record the value AND a "touched" flag. From then on
 // their value sticks across surface switches AND app restarts. To
 // get back to per-surface defaults the user clears `rtm-advanced-qc-
 // touched` (no UI for that yet — fine, this is the behaviour engineers
 // actually expect).
 const [advancedQc, setAdvancedQc] = useState<boolean>(() => {
 try {
 if (localStorage.getItem('rtm-advanced-qc-touched') === '1') {
 return localStorage.getItem('rtm-advanced-qc') === '1'
 }
 const saved = localStorage.getItem('rtm-surface')
 const s: UserSurface = (saved === 'streaming' || saved === 'full' || saved === 'broadcast' || saved === 'post' || saved === 'netflix') ? saved : 'full'
 return defaultAdvancedQcForSurface(s)
 } catch { return false }
 })

 // Surface change: if the user has already touched the toggle, their
 // value sticks across all surfaces. Otherwise apply the new surface's
 // default. This matches what every engineer who's complained about
 // the toggle "resetting" actually wanted — once you decide, it stays.
 const setSurface = useCallback((next: UserSurface) => {
 setSurfaceState(next)
 try {
 if (localStorage.getItem('rtm-advanced-qc-touched') !== '1') {
 setAdvancedQc(defaultAdvancedQcForSurface(next))
 }
 } catch {}
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
 // Manual toggle — flips the value and records that the user has
 // explicitly touched it, so future surface changes / restarts honour
 // their choice instead of reverting to the per-surface default.
 const toggleAdvancedQc = useCallback(() => {
 setAdvancedQc(v => {
 const next = !v
 try { localStorage.setItem('rtm-advanced-qc-touched', '1') } catch {}
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
