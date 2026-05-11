import React, { useMemo } from 'react'
import { AnalysisResult } from '../types'

/**
 * Per-object Atmos anomaly panel.
 *
 * Flags objects that deviate from the bed in ways that usually indicate
 * mix mistakes rather than artistic intent:
 *
 * • "Hot object" — LUFS > bed + HOT_THRESH_LUFS. Often an un-attenuated
 * send / reverb bus that wasn't meant to be object-panned.
 * • "Silent object" — object declared but inactive. Wastes ADM channels
 * and bloats file size for no delivery benefit.
 * • "Static object" — active but with no trajectory automation (same
 * level across the duration). Usually a mistake: either it was meant
 * to be a bed channel or the automation wasn't printed.
 * • "Dark object" — spectral centroid < DARK_CENTROID_HZ while the
 * object is active. Legitimate for kick/bass sends but a frequent
 * sign of a misrouted low-end element that should be on the LFE bed.
 *
 * Heuristics only — never auto-rejects. Surfaces the list so the mix
 * supervisor can decide.
 */
interface Props {
 result: AnalysisResult
}

const HOT_THRESH_LUFS = 6 // object > bed + 6 LU
const DARK_CENTROID_HZ = 300 // below 300 Hz centroid = dark
const LOW_DYNAMICS_DB = 1.5 // < 1.5 dB dynamic range = static

interface Anomaly {
 channel: string
 label: string
 role: string
 severity: 'warn' | 'block'
 kind: 'hot' | 'silent' | 'static' | 'dark'
 detail: string
}

function detect(result: AnalysisResult): Anomaly[] {
 const channels = result.atmos_channels || []
 if (channels.length === 0) return []

 // Bed reference — use the average LUFS of the main bed channels (L/R/C)
 // as the "album bed level". Fall back to the loudest bed if the L/R/C
 // aren't named explicitly.
 const beds = channels.filter(c => /bed/i.test(c.role || ''))
 const bedLevels = beds.filter(c => c.is_active && isFinite(c.level_db)).map(c => c.level_db)
 const bedMean = bedLevels.length > 0 ? bedLevels.reduce((a, b) => a + b, 0) / bedLevels.length : NaN

 const anomalies: Anomaly[] = []
 for (const c of channels) {
 const isObject = /object/i.test(c.role || '') || /obj/i.test(c.channel || '')
 if (!isObject) continue

 // Silent object — declared but inactive.
 if (!c.is_active) {
 anomalies.push({
 channel: c.channel, label: c.label, role: c.role,
 severity: 'warn', kind: 'silent',
 detail: 'Object declared in the ADM but silent throughout. Remove it before delivery — Apple caps objects at 118 and silent slots still count.',
 })
 continue
 }

 // Hot object — LUFS > bed + HOT_THRESH_LUFS.
 if (isFinite(bedMean) && isFinite(c.level_db) && c.level_db - bedMean > HOT_THRESH_LUFS) {
 anomalies.push({
 channel: c.channel, label: c.label, role: c.role,
 severity: 'block', kind: 'hot',
 detail: `Object is ${(c.level_db - bedMean).toFixed(1)} dB hotter than the bed mean (${bedMean.toFixed(1)} dB). Usually an un-attenuated send / reverb bus that wasn't meant to be object-panned.`,
 })
 }

 // Static object — dynamic range almost zero → no automation.
 if (isFinite(c.dynamic_range_db) && c.dynamic_range_db < LOW_DYNAMICS_DB) {
 anomalies.push({
 channel: c.channel, label: c.label, role: c.role,
 severity: 'warn', kind: 'static',
 detail: `Object has ${c.dynamic_range_db.toFixed(1)} dB dynamic range — no trajectory automation. Either reprint the automation or demote this to the bed layer.`,
 })
 }

 // Dark object — low spectral centroid while active.
 if (isFinite(c.centroid_hz) && c.centroid_hz > 0 && c.centroid_hz < DARK_CENTROID_HZ) {
 anomalies.push({
 channel: c.channel, label: c.label, role: c.role,
 severity: 'warn', kind: 'dark',
 detail: `Object centroid ${Math.round(c.centroid_hz)} Hz — mostly sub / low content. If this is bass or kick it likely belongs on the LFE bed, not an object.`,
 })
 }
 }
 return anomalies
}

export default function AtmosObjectAnomalyPanel({ result }: Props) {
 const anomalies = useMemo(() => detect(result), [result])

 if (!result.atmos_channels || result.atmos_channels.length === 0) return null
 if (anomalies.length === 0) {
 return (
 <div className="px-4 py-3 text-[11px]" style={{
 borderRadius: '2px',
 color: '#6ec577',
 backgroundColor: 'rgba(110,197,119,0.06)',
 border: '1px solid rgba(110,197,119,0.18)',
 }}>
 ✓ No per-object anomalies — every object is active, level-balanced against the bed, and appears to carry meaningful automation.
 </div>
 )
 }
 const blockCount = anomalies.filter(a => a.severity === 'block').length
 const warnCount = anomalies.filter(a => a.severity === 'warn').length
 return (
 <div className="space-y-2">
 <div className="flex items-center gap-3 flex-wrap">
 <span className="text-[10px] uppercase tracking-[0.12em]" style={{ color: '#7a7164' }}>Per-object anomalies</span>
 {blockCount > 0 && (
 <span className="text-[10px] px-2 py-0.5 rounded" style={{ color: '#e05a5a', backgroundColor: 'rgba(224,90,90,0.1)' }}>
 {blockCount} block{blockCount === 1 ? '' : 's'}
 </span>
 )}
 {warnCount > 0 && (
 <span className="text-[10px] px-2 py-0.5 rounded" style={{ color: '#c5a55a', backgroundColor: 'rgba(197,165,90,0.1)' }}>
 {warnCount} warning{warnCount === 1 ? '' : 's'}
 </span>
 )}
 </div>
 <div className="space-y-1.5">
 {anomalies.map((a, i) => (
 <AnomalyRow key={`${a.channel}:${a.kind}:${i}`} a={a} />
 ))}
 </div>
 </div>
 )
}

function AnomalyRow({ a }: { a: Anomaly }) {
 const color = a.severity === 'block' ? '#e05a5a' : '#c5a55a'
 // Unicode-only icons — stay inside the RTM quiet-luxury palette
 // (no emoji glyphs, no gamey colour).
 const icon = {
 hot: '▲',
 silent: '○',
 static: '═',
 dark: '▽',
 }[a.kind] || '⚠'
 return (
 <div className="px-3 py-2 text-[11px]" style={{
 borderRadius: '2px',
 backgroundColor: a.severity === 'block' ? 'rgba(224,90,90,0.06)' : 'rgba(197,165,90,0.06)',
 border: `1px solid ${a.severity === 'block' ? 'rgba(224,90,90,0.18)' : 'rgba(197,165,90,0.2)'}`,
 color: '#b5afa4',
 }}>
 <div className="flex items-center gap-2 flex-wrap">
 <span className="font-mono text-[12px]" style={{ color }}>{icon}</span>
 <span className="font-mono text-[10px]" style={{ color: '#8d867b' }}>{a.channel}</span>
 <span style={{ color: '#ebe7e0' }}>{a.label || a.role}</span>
 <span className="font-mono text-[9px] uppercase tracking-[0.1em]" style={{ color }}>{a.kind}</span>
 </div>
 <div className="text-[10px] mt-1 ml-6" style={{ color: '#8d867b' }}>{a.detail}</div>
 </div>
 )
}
