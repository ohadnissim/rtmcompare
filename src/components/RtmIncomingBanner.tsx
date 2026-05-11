import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FileInfo } from '../types'

// localStorage key for drops the user has explicitly dismissed — survives
// reload so the same chip doesn't keep resurrecting from the disk inbox.
const DISMISSED_KEY = 'rtm-banner-dismissed-paths'
function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? new Set(arr) : new Set()
  } catch {
    return new Set()
  }
}
function writeDismissed(s: Set<string>) {
  try {
    // Cap to 200 entries so this never grows unbounded.
    const arr = Array.from(s).slice(-200)
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(arr))
  } catch {}
}

/**
 * "Send to RTM" receiver banner — renders a floating notification
 * chip when the DAW plugin drops an audio bounce into
 * ~/.rtm/incoming/. Clicking the chip loads the dropped file into
 * the provided slot (A or B). Dismissing removes the item from the
 * inbox (user's explicit intent).
 *
 * Shows the plugin's sidecar metadata when provided: session name,
 * DAW, sample rate, duration. Falls back to just the filename when
 * the plugin didn't write metadata.
 */

export interface RtmIncomingDrop {
 audioPath: string
 metaPath: string | null
 meta: {
 sessionName?: string
 daw?: string
 sampleRate?: number
 durationSec?: number
 createdAt?: string
 channels?: number
 /** Routing hint from the plugin — 'single' = load into single-file
 * analysis, 'compareB' = drop into Compare mode's File B slot,
 * 'batch' = add to album / batch surface.
 * Unknown / missing values fall back to letting the user pick. */
 route?: 'single' | 'compareB' | 'batch'
 } | null
}

interface Props {
 /** Called when the user picks a drop. Slot is 'A' by default but
 * the banner lets the user route to B if the chip is dragged. */
 onLoadInto: (slot: 'A' | 'B', info: FileInfo, drop: RtmIncomingDrop) => void
 /** Called when the plugin requested single-file analysis routing.
 * Host state typically: setFileA(info) + setState('ref-only') +
 * trigger the reference-only analyse flow. */
 onSingleFileAnalysis?: (info: FileInfo, drop: RtmIncomingDrop) => void
 /** Called when the plugin requested album / batch routing. Host
 * should load the file and surface a hint to open the Album /
 * Batch workflow. */
 onBatch?: (info: FileInfo, drop: RtmIncomingDrop) => void
 /** When true and the sidecar has a known route, the banner auto-
 * routes on receive AND shows a 4-second confirmation toast so
 * the user sees that the plug-in drop succeeded. */
 autoRoute?: boolean
}

export default function RtmIncomingBanner({ onLoadInto, onSingleFileAnalysis, onBatch, autoRoute = true }: Props) {
 const [drops, setDrops] = useState<RtmIncomingDrop[]>([])
 // Auto-route toast — a transient visible confirmation that the
 // plug-in drop fired.  Fixes the "nothing happened" perception
 // that shipped in v4.0.0.
 const [autoToast, setAutoToast] = useState<{ text: string; key: number } | null>(null)
 const showAutoToast = (text: string) => {
 const key = Date.now()
 setAutoToast({ text, key })
 setTimeout(() => {
 setAutoToast(t => (t && t.key === key ? null : t))
 }, 4500)
 }

 // The parent (App.tsx) passes inline arrow functions for the three
 // callbacks, which means their identities change on every App render.
 // If we put them in the effect's dep array the effect tears down and
 // replays the inbox list every render — which re-fires auto-routing and
 // (critically) re-calls `setState('upload')` inside the parent handler,
 // stomping any state transition the user just triggered.  See QA report
 // BUG 2.  Hold the callbacks in refs so the effect body always sees the
 // latest version, without needing to re-subscribe.
 const onLoadIntoRef = useRef(onLoadInto)
 const onSingleRef = useRef(onSingleFileAnalysis)
 const onBatchRef = useRef(onBatch)
 const autoRouteRef = useRef(autoRoute)
 useEffect(() => {
 onLoadIntoRef.current = onLoadInto
 onSingleRef.current = onSingleFileAnalysis
 onBatchRef.current = onBatch
 autoRouteRef.current = autoRoute
 })

 // Guard against double-routing the same audio file within one session.
 // A drop that's auto-routed once must never auto-route again — the user
 // has already seen the toast and the slot is populated.
 const routedRef = useRef<Set<string>>(new Set())
 // Persistent dismissals — a drop the user dismissed is hidden across
 // reloads (but not deleted from disk, see BUG 1 fix).
 const dismissedRef = useRef<Set<string>>(readDismissed())

 // Stable drop handler — empty dep list guarantees the subscription
 // doesn't tear down on parent re-render.
 //
 // 5.7.x: takes a `liveDrop` flag. Live drops (received via the
 // main-process watcher AFTER mount) honour the plugin's routing
 // hint (`route: 'single' / 'compareB' / 'batch'`) and auto-load
 // into the requested slot. Pre-existing drops surfaced by the
 // mount-time inbox sweep do NOT auto-route — they show the chip
 // and let the user decide. Otherwise stale files in
 // ~/.rtm/incoming/ from a previous session keep loading themselves
 // as Reference on every RTMcompare launch (Mike's bug report).
 const handleDrop = useCallback((drop: RtmIncomingDrop, liveDrop: boolean) => {
 if (dismissedRef.current.has(drop.audioPath)) return
 if (routedRef.current.has(drop.audioPath)) return
 const name = basename(drop.audioPath)
 const info = { path: drop.audioPath, name }
 const ar = autoRouteRef.current
 const route = drop.meta?.route
 // Auto-route only for LIVE drops. Pre-existing files surface as a
 // chip so the user can decide — they may be hours or days old
 // and shouldn't silently land in the Reference slot on launch.
 if (liveDrop && ar && route === 'compareB') {
 routedRef.current.add(drop.audioPath)
 onLoadIntoRef.current('B', info, drop)
 showAutoToast('Plug-in drop routed to Compare (File B) - click Compare to analyse.')
 return
 }
 if (liveDrop && ar && route === 'single' && onSingleRef.current) {
 routedRef.current.add(drop.audioPath)
 onSingleRef.current(info, drop)
 showAutoToast('Plug-in drop loaded as Reference - click Analyze Reference Only to start.')
 return
 }
 if (liveDrop && ar && route === 'batch' && onBatchRef.current) {
 routedRef.current.add(drop.audioPath)
 onBatchRef.current(info, drop)
 showAutoToast('Plug-in drop loaded as the seed for a new album batch — click "Analyze Album" to start the batch with this track as track 1.')
 return
 }
 // No auto-route (either pre-existing drop, no routing hint, or
 // auto-route disabled): show the chip and let the user pick.
 setDrops(prev => dedupe([drop, ...prev]))
 }, [])

 // Effect 1 — one-shot initial sweep of the inbox on mount.  Used to be
 // in the same effect as the live subscription; splitting it keeps both
 // from re-running when parent callbacks change identity.
 useEffect(() => {
 let mounted = true
 if (window.electronAPI?.rtmIncomingList) {
 window.electronAPI.rtmIncomingList().then(list => {
 if (!mounted) return
 // Pre-existing inbox files: show chips, never auto-route.
 for (const d of list) handleDrop(d, /*liveDrop*/ false)
 }).catch(() => {})
 }
 return () => { mounted = false }
 // handleDrop is stable (empty deps above).
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [])

 // Effect 2 — live subscription to the main-process watcher.  Also runs
 // exactly once per mount. Live drops auto-route per their meta hint.
 useEffect(() => {
 if (!window.electronAPI?.onRtmIncoming) return
 const unsub = window.electronAPI.onRtmIncoming((drop) => handleDrop(drop, /*liveDrop*/ true))
 return () => { try { unsub?.() } catch {} }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [])

 if (drops.length === 0 && !autoToast) return null

 const dismissAll = () => {
 // Record dismissal locally so these drops don't come back on the next
 // inbox sweep.  Intentionally NOT calling rtmIncomingClear() — that
 // handler used to unlink WAVs out from under mid-flight analyses.
 for (const d of drops) dismissedRef.current.add(d.audioPath)
 writeDismissed(dismissedRef.current)
 setDrops([])
 }

 return (
 <div
 className="fixed bottom-4 right-4 z-[200] max-w-sm space-y-2"
 role="region"
 aria-label="Incoming from RTM plugin"
 >
 {autoToast && (
 <div
 className="px-3 py-2"
 style={{
 borderRadius: '2px',
 backgroundColor: 'rgba(30,28,24,0.95)',
 border: '1px solid rgba(208,176,102,0.55)',
 }}
 role="status"
 aria-live="polite"
 >
 <div className="text-[10px] uppercase tracking-[0.15em] mb-0.5" style={{ color: '#d0b066' }}>
 RTM plugin
 </div>
 <div className="text-[11px]" style={{ color: '#ebe7e0' }}>
 {autoToast.text}
 </div>
 </div>
 )}
 {drops.slice(0, 3).map((d, i) => (
 <DropChip
 key={d.audioPath}
 drop={d}
 onLoad={(slot) => {
 // Mark as routed so a later inbox re-sweep can't resurrect the
 // same chip into the same slot while the analysis is mid-flight.
 routedRef.current.add(d.audioPath)
 onLoadInto(slot, { path: d.audioPath, name: basename(d.audioPath) }, d)
 setDrops(prev => prev.filter(x => x.audioPath !== d.audioPath))
 }}
 onDismiss={() => {
 dismissedRef.current.add(d.audioPath)
 writeDismissed(dismissedRef.current)
 setDrops(prev => prev.filter(x => x.audioPath !== d.audioPath))
 }}
 />
 ))}
 {drops.length > 3 && (
 <div className="flex items-center justify-end">
 <button
 onClick={dismissAll}
 className="text-[9px] px-2 py-0.5 hover:bg-white/[0.06]"
 style={{ color: '#7a7164', border: '1px solid rgba(168,161,150,0.2)' }}
 >
 Clear inbox ({drops.length})
 </button>
 </div>
 )}
 </div>
 )
}

function DropChip({ drop, onLoad, onDismiss }: {
 drop: RtmIncomingDrop
 onLoad: (slot: 'A' | 'B') => void
 onDismiss: () => void
}) {
 const meta = drop.meta || {}
 const name = meta.sessionName || basename(drop.audioPath)
 const sub = [
 meta.daw,
 meta.sampleRate ? `${(meta.sampleRate / 1000).toFixed(meta.sampleRate % 1000 === 0 ? 0 : 1)} kHz` : null,
 meta.channels ? `${meta.channels} ch` : null,
 meta.durationSec ? `${meta.durationSec.toFixed(1)} s` : null,
 ].filter(Boolean).join(' · ')

 return (
 <div
 className="px-3 py-2 flex items-start gap-3"
 style={{
 borderRadius: '2px',
 backgroundColor: 'rgba(30,28,24,0.95)',
 border: '1px solid rgba(208,176,102,0.45)',
 }}
 >
 <div className="w-8 h-8 flex items-center justify-center flex-shrink-0"
 style={{ borderRadius: '2px', backgroundColor: 'rgba(208,176,102,0.15)', color: '#d0b066' }}
 title="Incoming from the RTM Send plugin">
 <span className="text-[14px]">↙</span>
 </div>
 <div className="flex-1 min-w-0">
 <div className="text-[10px] uppercase tracking-[0.15em]" style={{ color: '#d0b066' }}>
 From RTM plugin
 </div>
 <div className="text-[12px] truncate" style={{ color: '#ebe7e0' }} title={name}>
 {name}
 </div>
 {sub && (
 <div className="text-[9px] mt-0.5" style={{ color: '#8d867b' }}>{sub}</div>
 )}
 <div className="flex items-center gap-1.5 mt-1.5">
 <button
 onClick={() => onLoad('A')}
 className="text-[10px] px-2 py-0.5"
 style={{ borderRadius: '2px', color: '#d0b066', border: '1px solid rgba(208,176,102,0.4)' }}
 >
 → Reference
 </button>
 <button
 onClick={() => onLoad('B')}
 className="text-[10px] px-2 py-0.5"
 style={{ borderRadius: '2px', color: '#d0b066', border: '1px solid rgba(208,176,102,0.4)', backgroundColor: 'rgba(208,176,102,0.1)' }}
 >
 → Compare
 </button>
 <button
 onClick={onDismiss}
 className="text-[10px] px-2 py-0.5 ml-auto"
 style={{ color: '#8d867b' }}
 >
 Dismiss
 </button>
 </div>
 </div>
 </div>
 )
}

function basename(p: string): string {
 return p.split(/[\\/]/).pop() || p
}

function dedupe(drops: RtmIncomingDrop[]): RtmIncomingDrop[] {
 const seen = new Set<string>()
 const out: RtmIncomingDrop[] = []
 for (const d of drops) {
 if (seen.has(d.audioPath)) continue
 seen.add(d.audioPath)
 out.push(d)
 }
 return out
}
