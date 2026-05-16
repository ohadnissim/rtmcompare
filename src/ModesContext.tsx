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

interface Modes {
 educator: boolean
 blind: boolean
 surface: UserSurface
 setEducator: (v: boolean) => void
 setBlind: (v: boolean) => void
 setSurface: (v: UserSurface) => void
 toggleEducator: () => void
 toggleBlind: () => void
}

const ModesContext = createContext<Modes>({
 educator: false,
 blind: false,
 surface: 'full',
 setEducator: () => {},
 setBlind: () => {},
 setSurface: () => {},
 toggleEducator: () => {},
 toggleBlind: () => {},
})

export function ModesProvider({ children }: { children: React.ReactNode }) {
 const [educator, setEducator] = useState<boolean>(() => {
 try { return localStorage.getItem('rtm-educator') === '1' } catch { return false }
 })
 const [blind, setBlind] = useState<boolean>(() => {
 try { return localStorage.getItem('rtm-blind') === '1' } catch { return false }
 })
 const [surface] = useState<UserSurface>('full')
 const setSurface = useCallback((_next: UserSurface) => {}, [])

 useEffect(() => {
 try { localStorage.setItem('rtm-educator', educator ? '1' : '0') } catch {}
 document.documentElement.dataset.educator = educator ? '1' : '0'
 }, [educator])

 useEffect(() => {
 try { localStorage.setItem('rtm-blind', blind ? '1' : '0') } catch {}
 document.documentElement.dataset.blind = blind ? '1' : '0'
 }, [blind])

 useEffect(() => {
 document.documentElement.dataset.surface = surface
 }, [surface])

 const toggleEducator = useCallback(() => setEducator(v => !v), [])
 const toggleBlind = useCallback(() => setBlind(v => !v), [])

 const value = useMemo(() => ({
 educator, blind, surface,
 setEducator, setBlind, setSurface,
 toggleEducator, toggleBlind,
 }), [educator, blind, surface, setSurface, toggleEducator, toggleBlind])

 return (
 <ModesContext.Provider value={value}>
 {children}
 </ModesContext.Provider>
 )
}

export function useModes() {
 return useContext(ModesContext)
}
