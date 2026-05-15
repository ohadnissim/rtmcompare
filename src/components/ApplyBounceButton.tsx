import React, { useState, useEffect } from 'react'
import { onShortcut, RTM_EVENTS } from '../shortcuts'

interface Band {
 freq: number
 gain_db: number
 q: number
 q_note?: string
 region?: string
}

interface Props {
 bands: Band[]
 /** Same boolean array the live preview uses to bypass individual bands.
  * The bounce HONOURS this — if a band is off in the preview, it's off
  * in the rendered WAV. Without this prop the bounce silently re-includes
  * every band (the 5.1.x correctness bug fixed in 5.2.0). */
 bandEnabled?: boolean[]
 srcFilePath?: string
 fileName?: string
 amountPct?: number
 tpLimit: boolean
 setTpLimit: React.Dispatch<React.SetStateAction<boolean>>
 /** Reference's integrated LUFS-I. When provided, the "Match A loudness"
  * toggle becomes available — closed-loop trim aims at this number, with
  * a +4 dB boost cap so quiet sources chasing hot references don't slam
  * the limiter. Undefined → toggle hidden (no reference loaded). */
 refLufs?: number | null
 /** Short label for the reference (e.g. file name) — shown in the toggle. */
 refLabel?: string
}

/**
 * Primary one-click "Apply EQ moves to the audio + bounce a corrected WAV"
 * action. Lives ABOVE the EQ preview player so the verb is obvious — used
 * to be a buried menu item in EQExportButton's dropdown which beta testers
 * couldn't find.
 *
 * Format-conversion exports (FabFilter, Ableton, CSV, JSON, copy table)
 * still live inside EQExportButton — those are different intent
 * (export to DAW for further work) vs this (render the corrected audio
 * here and now).
 *
 * Ceiling for the optional TP limiter is fixed at −0.3 dBTP (Apple Music
 * spec — strictest common ceiling). Not exposed; we don't want users
 * shipping risky bounces.
 */
export default function ApplyBounceButton({ bands, bandEnabled, srcFilePath, fileName, amountPct, tpLimit, setTpLimit, refLufs, refLabel }: Props) {
 const [busy, setBusy] = useState<null | string>(null)
 const [toast, setToast] = useState<string | null>(null)
 // Loudness-match toggle. Default OFF — user direction (May 5):
 // engineers want EQ-match to be the obvious thing the bounce does,
 // and opt INTO the loudness-match deliberately when they want it.
 const [matchLoudness, setMatchLoudness] = useState(false)
 const ceilingDbtp = -0.3
 const refLufsAvailable = refLufs != null && Number.isFinite(refLufs)

 const flash = (msg: string) => {
 setToast(msg)
 setTimeout(() => setToast(null), 3500)
 }

 const rawBase = (fileName || 'eq-moves').replace(/\.[^/.]+$/, '')
 const amountSuffix = amountPct != null && amountPct < 100 ? `-${amountPct}pct` : ''
 const baseName = `${rawBase}${amountSuffix}`

 const applyAndBounce = async () => {
 if (!srcFilePath || !window.electronAPI?.renderCorrectedEq) {
 flash('Apply-and-bounce requires the source file path')
 return
 }

 // Let the user pick WHERE to save the corrected WAV.
 let outPath: string | null = null
 if (window.electronAPI?.pickSavePath) {
 outPath = await window.electronAPI.pickSavePath(`${baseName}__RTM-corrected.wav`, [
 { name: 'WAV', extensions: ['wav'] },
 ])
 if (!outPath) { return } // user cancelled
 }

 const willMatchLoudness = refLufsAvailable && matchLoudness
 const busyMsg = willMatchLoudness
 ? (tpLimit ? 'Rendering + loudness match + TP limit…' : 'Rendering + loudness match…')
 : (tpLimit ? 'Rendering + true-peak limit…' : 'Rendering corrected version…')
 // Filter to ONLY enabled bands. Matches what the user heard in the
 // live preview — the bounce never silently re-introduces a band that
 // was bypassed. When bandEnabled is undefined (legacy callers / tips
 // panel without a toggle row), all bands are shipped.
 const activeBands = bandEnabled
 ? bands.filter((_, i) => bandEnabled[i])
 : bands

 if (activeBands.length === 0) {
 flash('All bands are bypassed — nothing to bounce. Toggle at least one move on.')
 return
 }

 setBusy(busyMsg)
 try {
 const finalPath = await window.electronAPI.renderCorrectedEq(
 srcFilePath,
 activeBands,
 outPath || undefined,
 tpLimit,
 ceilingDbtp,
 willMatchLoudness ? (refLufs as number) : undefined,
 )
 // MED-11: guard against empty string path (Python silent success with no stdout)
 if (!finalPath) throw new Error('Render produced no output path — check Python logs')
 flash(`Rendered: ${finalPath}`)
 if (window.electronAPI?.revealInFinder) {
 await window.electronAPI.revealInFinder(finalPath)
 }
 } catch (err: any) {
 flash(err?.message || 'Render failed')
 } finally {
 setBusy(null)
 }
 }

 // ⌘⇧E shortcut still fires the bounce — same hotkey as before, just
 // wired to this button's instance instead of the menu item's.
 useEffect(() => {
 const unsub = onShortcut(RTM_EVENTS.applyBounce, () => applyAndBounce())
 return () => unsub()
 }, [bands, bandEnabled, srcFilePath, tpLimit, fileName, amountPct, matchLoudness, refLufs])

 if (!bands || bands.length === 0) return null
 const disabled = !srcFilePath || !!busy

 return (
 <div
 className="p-4 flex items-center justify-between gap-4"
 style={{
 backgroundColor: 'rgba(208,176,102,0.08)',
 border: '1px solid rgba(208,176,102,0.30)',
 }}
 >
 <div className="flex-1 min-w-0">
 <div className="text-[12px] font-medium" style={{ color: '#d0b066' }}>
 Apply EQ moves to the audio
 </div>
 <div className="text-[10px] mt-0.5" style={{ color: '#8d867b' }}>
 Bake the {bands.length} band{bands.length === 1 ? '' : 's'} above into a new WAV — no DAW needed.
 {!srcFilePath && ' (Source file path unavailable in this view.)'}
 </div>
 </div>

 {/* Match-loudness toggle — only when a reference LUFS is available.
 Default OFF (May 5 user direction — opt in deliberately). Closed-loop
 trim, +4 dB boost cap. */}
 {srcFilePath && refLufsAvailable && (
 <label
 className="flex items-center gap-2 px-2.5 py-1 cursor-pointer transition-colors"
 style={{ backgroundColor: 'rgba(14,13,11,0.35)' }}
 title={`Closed-loop loudness trim toward ${isFinite(refLufs as number) ? (refLufs as number).toFixed(1) : '—'} LUFS${refLabel ? ` (${refLabel})` : ''}. Boost capped at +4 dB so quiet mixes chasing hot references don't slam the limiter.`}
 >
 <input
 type="checkbox"
 checked={matchLoudness}
 onChange={(e) => setMatchLoudness(e.target.checked)}
 style={{ accentColor: '#d0b066' }}
 />
 <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: matchLoudness ? '#d0b066' : '#8d867b' }}>
 Match {isFinite(refLufs as number) ? (refLufs as number).toFixed(1) : "—"} LUFS
 </span>
 </label>
 )}

 {/* TP-limit toggle — same state as the live preview. Compact pill so
 it sits next to the action button without dominating. */}
 {srcFilePath && (
 <label
 className="flex items-center gap-2 px-2.5 py-1 cursor-pointer transition-colors"
 style={{ backgroundColor: 'rgba(14,13,11,0.35)' }}
 title="True-peak limit at −0.3 dBTP (Apple Music ceiling). 16× oversampled ISP detection. Keeps boosts safe from clipping and platform-side limiters."
 >
 <input
 type="checkbox"
 checked={tpLimit}
 onChange={(e) => setTpLimit(e.target.checked)}
 style={{ accentColor: '#d0b066' }}
 />
 <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: tpLimit ? '#d0b066' : '#8d867b' }}>
 TP limit
 </span>
 </label>
 )}

 <button
 onClick={applyAndBounce}
 disabled={disabled}
 className="px-4 py-2 text-[12px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
 style={{
 backgroundColor: disabled ? 'rgba(208,176,102,0.20)' : '#d0b066',
 color: disabled ? '#8d867b' : '#0e0d0b',
 border: '1px solid rgba(208,176,102,0.55)',
 minWidth: 160,
 }}
 title={srcFilePath
 ? (tpLimit ? 'Render with true-peak limiter engaged (⌘⇧E)' : 'Render without limiter (⌘⇧E)')
 : 'Source file unavailable for this analysis'}
 >
 {busy ? busy : '♫ Apply & Bounce WAV'}
 </button>

 {toast && (
 <div
 className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 text-xs"
 style={{ backgroundColor: 'rgba(14,13,11,0.96)', color: '#d0b066', border: '1px solid rgba(208,176,102,0.35)' }}
 >
 {toast}
 </div>
 )}
 </div>
 )
}
