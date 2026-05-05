import React, { createContext, useContext, useState, useCallback, useMemo } from 'react'

/**
 * Shared state for the most recent DAW-plugin drop. When the
 * RTM Send plugin writes a bounce + sidecar into ~/.rtm/incoming/
 * and RTM's watcher moves it into the inbox, the RtmIncomingBanner
 * loads it into the correct slot (Reference / Compare-B / single-
 * file analysis) and stashes the sidecar metadata here so downstream
 * views — RefOnlyView, ReadyToDeliverVerdict — can surface context
 * like:
 *
 * Sent from Wavelab · "Verse B" · [2:15 → 3:10] · album_montage.wav
 *
 * Only the *latest* drop per slot is held; the banner itself shows
 * the queue of pending drops.
 */

export interface PluginDropMeta {
 audioPath: string
 sessionName?: string
 daw?: string
 sampleRate?: number
 durationSec?: number
 createdAt?: string
 channels?: number
 source?: 'ring' | 'loop' | 'triggered' | 'ara'
 regionName?: string
 regionStartSec?: number
 regionEndSec?: number
 regionSourceName?: string
 /** Routing hint the plugin sent.  Kept so downstream views can
  * surface DAW/batch context ("routedAs=batch"). */
 route?: 'single' | 'compareB' | 'batch'
 /** Internal flag: when the plug-in asked for Batch routing we load
  * the file into File A and record this so the banner / Cockpit can
  * nudge the user into Album mode. */
 routedAs?: 'single' | 'compareB' | 'batch'
}

interface Ctx {
 /** The drop that populated slot A / single-file, if the most
 * recent load came from the plugin. */
 slotA: PluginDropMeta | null
 /** The drop that populated Compare-mode slot B, if any. */
 slotB: PluginDropMeta | null
 setSlot: (slot: 'A' | 'B' | 'single', meta: PluginDropMeta | null) => void
 /** True when at least one slot carries plugin-origin metadata.
 * Cheap for gating small UI blocks. */
 hasAnyDrop: boolean
}

const PluginDropContext = createContext<Ctx>({
 slotA: null, slotB: null,
 setSlot: () => {},
 hasAnyDrop: false,
})

export function PluginDropProvider({ children }: { children: React.ReactNode }) {
 const [slotA, setSlotA] = useState<PluginDropMeta | null>(null)
 const [slotB, setSlotB] = useState<PluginDropMeta | null>(null)

 const setSlot = useCallback((slot: 'A' | 'B' | 'single', meta: PluginDropMeta | null) => {
 if (slot === 'B') setSlotB(meta)
 else setSlotA(meta) // 'single' shares the A slot conceptually
 }, [])

 const value = useMemo<Ctx>(() => ({
 slotA, slotB, setSlot,
 hasAnyDrop: !!slotA || !!slotB,
 }), [slotA, slotB, setSlot])

 return <PluginDropContext.Provider value={value}>{children}</PluginDropContext.Provider>
}

export function usePluginDrop(): Ctx {
 return useContext(PluginDropContext)
}
