import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

/**
 * Solo a single frequency band on the live A/B player so the engineer
 * can both *see* the band on the spectrum chart and *hear* it through
 * a high-Q band-pass audition filter — beta-tester request from the
 * spectrum-overlay panel: "Ohad it would be dope to solo the
 * frequency that the spectrum is giving us."
 *
 * Usage:
 *
 *   wrap App in <SoloProvider />
 *   inside ABPlayer:           const { soloBand, soloQ } = useSolo()
 *                              → engage a BiquadFilter when soloBand
 *   inside spectrum charts:    const { setSolo } = useSolo()
 *                              → setSolo(centreHz) on band click
 *   inside the toolbar pill:   const { soloBand, clearSolo } = useSolo()
 *                              → render "SOLO 2 kHz [×]" while active
 *
 * Esc clears the solo globally; the provider wires the listener so
 * every consuming component picks it up for free.
 */

interface SoloState {
  /** Centre frequency of the soloed band in Hz, or null when bypassed. */
  soloBand: number | null
  /** Q of the band-pass audition filter. 8 ≈ ⅓-octave, default. */
  soloQ: number
  setSolo: (freqHz: number, q?: number) => void
  clearSolo: () => void
  setSoloQ: (q: number) => void
}

const Ctx = createContext<SoloState | null>(null)

export function SoloProvider({ children }: { children: React.ReactNode }) {
  const [soloBand, setSoloBand] = useState<number | null>(null)
  const [soloQ, _setSoloQ] = useState<number>(8)

  const setSolo = useCallback((freqHz: number, q?: number) => {
    if (!Number.isFinite(freqHz) || freqHz <= 0) return
    setSoloBand(freqHz)
    if (typeof q === 'number' && Number.isFinite(q) && q > 0) _setSoloQ(q)
  }, [])

  const clearSolo = useCallback(() => setSoloBand(null), [])

  const setSoloQ = useCallback((q: number) => {
    if (!Number.isFinite(q) || q <= 0) return
    _setSoloQ(Math.max(0.5, Math.min(64, q)))
  }, [])

  // Esc clears the solo from anywhere — including focused chart elements
  // that ate the keydown otherwise.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && soloBand != null) {
        e.preventDefault()
        clearSolo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [soloBand, clearSolo])

  return (
    <Ctx.Provider value={{ soloBand, soloQ, setSolo, clearSolo, setSoloQ }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSolo(): SoloState {
  const v = useContext(Ctx)
  if (!v) {
    // Fallback no-op when called outside the provider — keeps unit
    // tests + isolated-component renders from crashing.
    return {
      soloBand: null,
      soloQ: 8,
      setSolo: () => {},
      clearSolo: () => {},
      setSoloQ: () => {},
    }
  }
  return v
}

/** Format a centre frequency for the toolbar pill / hover tooltip. */
export function formatSoloFreq(hz: number): string {
  if (hz >= 1000) {
    const k = hz / 1000
    return k >= 10 ? `${k.toFixed(0)} kHz` : `${k.toFixed(1)} kHz`
  }
  return `${Math.round(hz)} Hz`
}
