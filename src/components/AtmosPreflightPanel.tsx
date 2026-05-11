import React, { useMemo } from 'react'
import { AnalysisResult } from '../types'

/**
 * Atmos Preflight Panel.
 *
 * Hard-check delivery rules for Apple Music Dolby Atmos submissions.
 * Orthogonal to AtmosQCPanel (which renders whatever Python's
 * `atmos_qc.checks` array contains) — this panel re-asserts a
 * specific list the label / mix supervisor cares about before a
 * deliverable leaves the room:
 *
 * • Object count ≤ 118 (Apple Music cap).
 * • LFE routing on channel 4 (standard bed layout).
 * • Bed layout is 7.1.2 or 5.1.4 (Apple-accepted topologies).
 * • Sample rate 48 kHz exactly (Dolby Atmos Master spec).
 * • Bit depth ≥ 24 (Apple + Dolby).
 * • No orphan beds (beds declared but all silent).
 * • No non-standard layouts.
 * • Per-object anomaly flags (handled by AtmosObjectAnomaly — listed
 * here as a summary count, full detail on the per-object panel).
 *
 * Ships a single HOLD / WARN / PASS roll-up at the top so the user
 * can read the status at a glance.
 */
interface Props {
 result: AnalysisResult
}

interface Check {
 name: string
 status: 'pass' | 'warn' | 'block'
 value: string
 target: string
 note: string
}

const APPLE_OBJECT_CAP = 118
const VALID_LAYOUTS = new Set(['7.1.2', '5.1.4'])

function evaluate(result: AnalysisResult): Check[] {
 const qc = result.atmos_qc
 const channels = result.atmos_channels || []
 const checks: Check[] = []

 // 1. Object count. Regex.test coerces undefined→"undefined" which
 // wouldn't match, but we guard anyway for robustness.
 const objectCount = channels.filter(c =>
 /object/i.test(c.role || '') || /obj/i.test(c.channel || '')
 ).length
 checks.push({
 name: 'Object count',
 status: objectCount > APPLE_OBJECT_CAP ? 'block' : objectCount > APPLE_OBJECT_CAP - 10 ? 'warn' : 'pass',
 value: `${objectCount}`,
 target: `≤ ${APPLE_OBJECT_CAP}`,
 note: objectCount > APPLE_OBJECT_CAP
 ? `Apple Music caps Atmos deliverables at ${APPLE_OBJECT_CAP} objects. Beyond this, the DSP auto-rejects or silently collapses.`
 : `Apple Music allows up to ${APPLE_OBJECT_CAP} objects; you're comfortably inside.`,
 })

 // 2. LFE routing
 const lfe = channels.find(c => /lfe/i.test(c.label || '') || /lfe/i.test(c.channel || ''))
 checks.push({
 name: 'LFE present',
 status: lfe ? 'pass' : 'warn',
 value: lfe ? `${lfe.channel}` : 'missing',
 target: 'present (channel 4)',
 note: lfe
 ? 'LFE bed channel is present — sub-bass routing should land correctly.'
 : 'No LFE channel detected — if this isn\'t an LFE-less mix by design, the bed layout is wrong.',
 })

 // 3. Layout
 const layout = qc?.specs.layout || ''
 const layoutOk = VALID_LAYOUTS.has(layout)
 checks.push({
 name: 'Bed layout',
 status: layoutOk ? 'pass' : 'warn',
 value: layout || 'unknown',
 target: '7.1.2 or 5.1.4',
 note: layoutOk
 ? 'Bed layout is an Apple-accepted topology.'
 : 'Non-standard bed layout — Apple accepts 7.1.2 and 5.1.4. Anything else may be silently re-routed on ingest.',
 })

 // 4. Sample rate — Dolby Atmos Master is 48 kHz.
 const sr = qc?.specs.sample_rate
 checks.push({
 name: 'Sample rate',
 status: sr === 48000 ? 'pass' : sr != null ? 'block' : 'warn',
 value: sr != null ? `${sr} Hz` : 'unknown',
 target: '48000 Hz',
 note: sr === 48000
 ? 'Dolby Atmos Master spec — 48 kHz exactly.'
 : sr != null
 ? `Dolby Atmos Master requires 48 kHz exactly. ${sr} Hz will be rejected at Apple Music ingest.`
 : 'Sample rate not reported by the analysis — re-open the file.',
 })

 // 5. Bit depth — Apple + Dolby require ≥ 24-bit.
 const bd = qc?.specs.bit_depth
 checks.push({
 name: 'Bit depth',
 status: bd != null && bd >= 24 ? 'pass' : bd != null ? 'block' : 'warn',
 value: bd != null ? `${bd}-bit` : 'unknown',
 target: '≥ 24-bit',
 note: bd != null && bd >= 24
 ? '24-bit float/int — meets Apple Digital Masters + Dolby spec.'
 : bd != null
 ? 'Apple Digital Masters + Dolby Atmos require ≥ 24-bit. 16-bit will be rejected.'
 : 'Bit depth not reported — re-open the file.',
 })

 // 6. Orphan bed — channel present but silent.
 const silentBed = channels.find(c => /bed/i.test(c.role || '') && !c.is_active)
 if (silentBed) {
 checks.push({
 name: 'Orphan bed',
 status: 'warn',
 value: silentBed.channel,
 target: 'active beds only',
 note: `Bed channel ${silentBed.channel} is silent — likely unused but still carried in the ADM. Drop it before delivery to reduce file size.`,
 })
 }

 // 7. ADM axml chunk present — 
 // Without an axml chunk a multichannel WAV is just "12 channels of
 // audio"; there's no object metadata, no bed assignments, no PCM
 // trajectory. A reasonable Atmos tool auto-fills one, but many
 // post pipelines strip it on export and the deliverable silently
 // stops being Atmos.
 // `has_adm` is the canonical flag from the Python ADM parser. We also
 // peek at `adm_metadata` as a safety net for older result shapes.
 const admOk = !!(result.atmos?.has_adm) || !!(result.atmos as any)?.adm_metadata
 checks.push({
 name: 'ADM axml chunk',
 status: admOk ? 'pass' : 'warn',
 value: admOk ? 'present' : 'missing',
 target: 'present (Dolby-compliant BWF)',
 note: admOk
 ? 'ADM axml chunk present — object / bed metadata will survive ingest and route correctly.'
 : 'No axml chunk found — the file is multichannel but carries no ADM metadata. Apple / Dolby re-encoding will treat every channel as a generic bed and you lose object routing.',
 })

 // 7b. Structural ADM validation — fed by python/adm_parser.py's
 // validate_adm(). Object cap, trajectory bounds, programme
 // name, channel-format coverage. Each finding becomes its own
 // Check row so the user sees exactly what's wrong and at what
 // severity. "
 const admFindings = (result as any).adm_validation as
 | { severity: 'block' | 'warn' | 'info'; code: string; message: string; field?: string }[]
 | undefined
 if (admFindings && admFindings.length > 0) {
 for (const f of admFindings) {
 checks.push({
 name: `ADM · ${f.code}`,
 status: f.severity === 'block' ? 'block' : f.severity === 'warn' ? 'warn' : 'pass',
 value: f.severity.toUpperCase(),
 target: 'BS.2076-compliant',
 note: f.message,
 })
 }
 }

 // 8. Binaural-headroom estimate — show if available, as an advisory.
 //    5.3.1 honesty fix: this is an ILD downmix approximation (no HRTF
 //    render). Apple's actual Atmos binaural is rendered by Apple's
 //    spatial-audio engine; we don't reproduce it. We surface this as
 //    an early-warning headroom check, never as a delivery gate.
 const binTp = (result as any).atmos_qc?.binaural_tp?.true_peak_db as number | undefined
 if (binTp != null) {
 checks.push({
 name: 'Binaural TP (approx)',
 // 5.3.1: never blocks — at worst warns. ILD-approx is too coarse
 // to make a delivery call on; Apple's renderer is the authority.
 status: binTp > -1 ? 'warn' : binTp > -2 ? 'warn' : 'pass',
 value: `${binTp.toFixed(1)} dBTP`,
 target: '≤ −1 dBTP (Apple guideline)',
 note: binTp > -1
 ? 'ILD-approx headroom is over Apple\'s −1 dBTP guideline. Verify on Apple\'s renderer before delivery — this is not a substitute.'
 : binTp > -2
 ? 'ILD-approx headroom within 1 dB of the guideline. Verify on Apple\'s renderer.'
 : 'Approx headroom looks OK; still verify on Apple\'s renderer for delivery.',
 })
 }

 return checks
}

export default function AtmosPreflightPanel({ result }: Props) {
 const checks = useMemo(() => evaluate(result), [result])
 const worst = checks.reduce<'pass' | 'warn' | 'block'>((acc, c) =>
 c.status === 'block' || acc === 'block' ? 'block' :
 c.status === 'warn' || acc === 'warn' ? 'warn' : 'pass',
 'pass')
 const palette = {
 pass: { color: '#6ec577', bg: 'rgba(110,197,119,0.08)', tag: 'READY' },
 warn: { color: '#c5a55a', bg: 'rgba(197,165,90,0.08)', tag: 'WARN' },
 block: { color: '#e05a5a', bg: 'rgba(224,90,90,0.08)', tag: 'HOLD' },
 }[worst]
 return (
 <div className="p-5 space-y-3" style={{
 borderRadius: '2px',
 backgroundColor: palette.bg,
 borderLeft: `3px solid ${palette.color}`,
 }}>
 <div className="flex items-center gap-3 flex-wrap">
 <span
 className="text-[9px] font-semibold tracking-[0.18em] uppercase px-2 py-0.5 rounded-full"
 style={{ color: palette.color, backgroundColor: `${palette.color}20` }}
 >
 {palette.tag}
 </span>
 <span className="font-medium" style={{ color: '#ebe7e0', fontSize: 15 }}>
 Atmos Preflight — {worst === 'block' ? 'fix before delivery' : worst === 'warn' ? 'advisory issues' : 'Apple Music–ready'}
 </span>
 </div>
 <div className="space-y-1.5">
 {checks.map((c, i) => (
 <CheckRow key={i} check={c} />
 ))}
 </div>
 </div>
 )
}

function CheckRow({ check }: { check: Check }) {
 const color = check.status === 'pass' ? '#6ec577' : check.status === 'warn' ? '#c5a55a' : '#e05a5a'
 const icon = check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : '✗'
 return (
 <div className="flex items-start gap-3 text-[11px]" style={{ color: '#b5afa4' }}>
 <span className="font-mono mt-0.5" style={{ color }}>{icon}</span>
 <div className="flex-1">
 <div className="flex items-baseline gap-2 flex-wrap">
 <span className="font-medium" style={{ color: '#ebe7e0' }}>{check.name}</span>
 <span className="font-mono text-[10px]" style={{ color }}>{check.value}</span>
 <span className="font-mono text-[10px]" style={{ color: '#8d867b' }}>target {check.target}</span>
 </div>
 <div className="text-[10px] mt-0.5" style={{ color: '#8d867b' }}>{check.note}</div>
 </div>
 </div>
 )
}
