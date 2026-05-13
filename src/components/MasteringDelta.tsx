import React, { useState } from 'react'
import { AnalysisResult, MasteringDelta as MasteringDeltaData } from '../types'
import CollapsibleSection from './CollapsibleSection'
import WidthPerBandChart from './WidthPerBandChart'
import { useAudience, useV52Surface } from '../AudienceContext'
import { DeltaAnnotations } from './v52/DeltaAnnotations'

interface Props {
 delta: MasteringDeltaData
 overall: AnalysisResult['overall']
}

const FREQ_LABELS = [
 '20 Hz', '25 Hz', '31 Hz', '40 Hz', '50 Hz', '63 Hz', '80 Hz', '100 Hz', '125 Hz', '160 Hz',
 '200 Hz', '250 Hz', '315 Hz', '400 Hz', '500 Hz', '630 Hz', '800 Hz', '1 kHz', '1.25 kHz', '1.6 kHz',
 '2 kHz', '2.5 kHz', '3.15 kHz', '4 kHz', '5 kHz', '6.3 kHz', '8 kHz', '10 kHz', '12.5 kHz', '16 kHz', '20 kHz',
]

const GOLD = 'var(--color-accent)'
const CREAM = 'var(--color-text-primary)'
const MUTED = 'var(--color-text-muted)'
const BLUE = 'var(--color-data-a)'
const GREEN = 'var(--color-data-pass)'
const RED = 'var(--color-danger)'

export default function MasteringDelta({ delta, overall }: Props) {
 const bands = Array.isArray(delta.per_band_gain_db) ? delta.per_band_gain_db : []
 const width = Array.isArray(delta.stereo_width_change_per_band) ? delta.stereo_width_change_per_band : []
 const platforms = delta.perceived_gain_per_platform || {}

 const audience = useAudience()
 const annotationsEnabled =
   useV52Surface('delta-annotations') && (audience === 'student' || audience === 'teacher')
 const [openAnnotation, setOpenAnnotation] = useState<{ metric: string; delta: number; unit: string } | null>(null)

 const annotate = (metric: string, value: number | undefined | null, unit: string) => {
   if (typeof value !== 'number' || !isFinite(value)) return
   setOpenAnnotation({ metric, delta: value, unit })
 }

 return (
 <>
 <CollapsibleSection
 title={`Mastering Delta - signature: ${delta.signature_hash || 'partial'}`}
 tooltip="Report card of what changed between rough mix A and mastered file B: loudness, per-band gain, dynamics, width, limiter behaviour, and platform playback."
 why="A mastering pass is easy to over- or under-estimate by ear after hours in the room. This panel turns the A/B result into a signed checklist of the actual moves."
 defaultOpen={true}
 badge={delta.signature_hash && (
 <span className="font-mono text-[10px] px-2 py-0.5 rounded-full" style={{ color: GOLD, backgroundColor: 'rgba(208,176,102,0.1)' }}>
 {delta.signature_hash}
 </span>
 )}
 >
 <div className="space-y-5">
 <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
 <Metric
 label="Broadband"
 value={fmtSigned(delta.broadband_gain_db, ' dB')}
 tone={delta.broadband_gain_db >= 0 ? GOLD : BLUE}
 onAnnotate={annotationsEnabled ? () => annotate('lufs_i', delta.broadband_gain_db, 'LU') : undefined}
 />
 <Metric
 label="LRA"
 value={`${fmtNum(overall.dynamics_a, 1)} -> ${fmtNum(overall.dynamics_b, 1)} LU`}
 sub={fmtSigned(delta.lra_delta, ' LU')}
 tone={delta.lra_delta < 0 ? GOLD : CREAM}
 onAnnotate={annotationsEnabled ? () => annotate('lra_lu', delta.lra_delta, 'LU') : undefined}
 />
 <Metric
 label="PSR delta"
 value={fmtSigned(delta.psr_delta, ' dB')}
 tone={delta.psr_delta < 0 ? GOLD : CREAM}
 onAnnotate={annotationsEnabled ? () => annotate('plr', delta.psr_delta, 'dB') : undefined}
 />
 <Metric
 label="RMS/peak"
 value={fmtSigned(delta.rms_to_peak_delta, ' dB')}
 tone={(delta.rms_to_peak_delta ?? 0) < 0 ? GOLD : CREAM}
 onAnnotate={annotationsEnabled ? () => annotate('true_peak_dbtp', delta.rms_to_peak_delta, 'dB') : undefined}
 />
 <Metric
 label="Limiter"
 value={fmtLimiter(delta.limiter_aggressiveness)}
 sub={delta.estimated_gain_reduction_db != null ? `${delta.estimated_gain_reduction_db.toFixed(1)} dB est. GR` : undefined}
 tone={limiterColor(delta.limiter_aggressiveness)}
 />
 </div>

 <div className="grid grid-cols-1 lg:grid-cols-[1fr_0.7fr] gap-4">
 <div className="border overflow-hidden" style={{ borderColor: 'rgba(168,161,150,0.14)', backgroundColor: 'rgba(31,27,23,0.35)' }}>
 <div className="flex items-center px-3 py-2 border-b" style={{ borderColor: 'rgba(168,161,150,0.1)' }}>
 <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: MUTED }}>Per-band gain - 31-band 1/3 octave</div>
 <div className="ml-auto text-[10px] font-mono" style={{ color: MUTED }}>B - A</div>
 </div>
 <div className="divide-y" style={{ borderColor: 'rgba(168,161,150,0.08)' }}>
 {bands.length > 0 ? bands.map((gain, i) => (
 <BandRow key={`${FREQ_LABELS[i] || i}-${i}`} label={FREQ_LABELS[i] || `${i + 1}`} gain={gain} widthDelta={width[i]} />
 )) : (
 <div className="px-3 py-4 text-xs" style={{ color: MUTED }}>Per-band data unavailable.</div>
 )}
 </div>
 </div>

 <div className="space-y-4">
 <div className="border p-3 space-y-2" style={{ borderColor: 'rgba(168,161,150,0.14)', backgroundColor: 'rgba(31,27,23,0.35)' }}>
 <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: MUTED }}>Playback delta after platform normalization</div>
 <div className="text-[10px] leading-relaxed" style={{ color: MUTED }}>
 <span style={{ color: CREAM }}>B − A</span> in played LUFS after each platform's loudness normalization. <span style={{ color: CREAM }}>0.0 on every row</span> usually means both files are louder than every platform target — normalization attenuates them to the same level, wiping out the mastering loudness difference.
 </div>
 {Object.keys(platforms).length > 0 ? Object.entries(platforms).map(([name, gain]) => (
 <div key={name} className="flex items-center justify-between gap-3 text-sm">
 <span style={{ color: CREAM }}>{platformName(name)}</span>
 <span className="font-mono" style={{ color: Math.abs(gain) < 0.05 ? MUTED : (gain >= 0 ? GOLD : BLUE) }}>{fmtSigned(gain, ' dB')}</span>
 </div>
 )) : (
 <div className="text-xs" style={{ color: MUTED }}>Platform gain data unavailable.</div>
 )}
 </div>

 <div className="border p-3 space-y-3" style={{ borderColor: 'rgba(168,161,150,0.14)', backgroundColor: 'rgba(31,27,23,0.35)' }}>
 <ReportLine label="Transient density" value={fmtTransient(delta.transient_density_change_pct)} />
 <ReportLine label="Peak-to-RMS ratio" value={fmtSigned(delta.peak_to_rms_ratio_change, ' dB')} />
 <ReportLine label="TP overs pulled back" value={fmtTpOvers(delta)} />
 </div>

 {(delta.width_per_band_a?.length || delta.width_per_band_b?.length) ? (
 <div className="border p-3" style={{ borderColor: 'rgba(168,161,150,0.14)', backgroundColor: 'rgba(31,27,23,0.35)' }}>
 <WidthPerBandChart
 widthA={delta.width_per_band_a}
 widthB={delta.width_per_band_b}
 />
 </div>
 ) : null}
 </div>
 </div>
 </div>
 </CollapsibleSection>
 {openAnnotation && (
 <DeltaAnnotations
 metric={openAnnotation.metric}
 delta={openAnnotation.delta}
 unit={openAnnotation.unit}
 onClose={() => setOpenAnnotation(null)}
 />
 )}
 </>
 )
}

function Metric({ label, value, sub, tone, onAnnotate }: { label: string; value: string; sub?: string; tone?: string; onAnnotate?: () => void }) {
 const valueEl = onAnnotate ? (
 <button
 type="button"
 onClick={onAnnotate}
 className="cursor-pointer hover:underline decoration-2 underline-offset-4 text-left"
 style={{ color: tone || CREAM, fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: '1.125rem', background: 'transparent', border: 'none', padding: 0 }}
 >
 {value}
 </button>
 ) : (
 <div className="font-mono text-lg tabular-nums" style={{ color: tone || CREAM }}>{value}</div>
 )
 return (
 <div className="p-3 min-h-[78px]" style={{ backgroundColor: 'rgba(48,44,39,0.5)' }}>
 <div className="text-[9px] uppercase tracking-[0.16em] mb-1" style={{ color: MUTED }}>{label}</div>
 {valueEl}
 {sub && <div className="text-[10px] mt-1" style={{ color: MUTED }}>{sub}</div>}
 </div>
 )
}

function BandRow({ label, gain, widthDelta }: { label: string; gain: number; widthDelta?: number }) {
 return (
 <div className="grid grid-cols-[58px_1fr_68px_118px] items-center gap-3 px-3 py-1.5 text-[11px]">
 <span className="font-mono" style={{ color: MUTED }}>{label}</span>
 <GainBar value={gain} />
 <span className="font-mono text-right tabular-nums" style={{ color: gain >= 0 ? GOLD : BLUE }}>{fmtSigned(gain, ' dB')}</span>
 <span className="truncate" title={widthText(widthDelta)} style={{ color: widthTone(widthDelta) }}>{widthText(widthDelta)}</span>
 </div>
 )
}

function GainBar({ value }: { value: number }) {
 const pct = Math.min(50, Math.abs(value) / 6 * 50)
 const left = value >= 0 ? 50 : 50 - pct
 return (
 <div className="relative h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(14,13,11,0.65)' }}>
 <div className="absolute top-0 bottom-0 w-px" style={{ left: '50%', backgroundColor: 'rgba(235,231,224,0.35)' }} />
 <div
 className="absolute top-0 bottom-0 rounded-full"
 style={{
 left: `${left}%`,
 width: `${pct}%`,
 backgroundColor: value >= 0 ? GOLD : BLUE,
 opacity: Math.abs(value) < 0.05 ? 0.25 : 0.85,
 }}
 />
 </div>
 )
}

function ReportLine({ label, value }: { label: string; value: string }) {
 return (
 <div className="flex items-center justify-between gap-3 text-sm">
 <span style={{ color: MUTED }}>{label}</span>
 <span className="font-mono text-right" style={{ color: CREAM }}>{value}</span>
 </div>
 )
}

function fmtNum(value: number | undefined | null, digits: number): string {
 return typeof value === 'number' && isFinite(value) ? value.toFixed(digits) : '--'
}

function fmtSigned(value: number | undefined | null, unit = ''): string {
 if (typeof value !== 'number' || !isFinite(value)) return '--'
 if (Math.abs(value) < 0.05) return `0.0${unit}`
 return `${value > 0 ? '+' : ''}${value.toFixed(1)}${unit}`
}

function fmtLimiter(value: number | undefined | null): string {
 if (typeof value !== 'number' || !isFinite(value)) return '--'
 const label = value >= 0.8 ? 'pinned' : value >= 0.55 ? 'heavy' : value >= 0.25 ? 'moderate' : 'light'
 return `${value.toFixed(2)} (${label})`
}

function limiterColor(value: number | undefined | null): string {
 if (typeof value !== 'number' || !isFinite(value)) return MUTED
 if (value >= 0.8) return RED
 if (value >= 0.55) return GOLD
 if (value >= 0.25) return CREAM
 return GREEN
}

function widthText(value: number | undefined): string {
 if (typeof value !== 'number' || !isFinite(value)) return 'width n/a'
 if (value > 0.02) return `wider ${value.toFixed(2)}`
 if (value < -0.02) return `narrower ${value.toFixed(2)}`
 return 'no width change'
}

function widthTone(value: number | undefined): string {
 if (typeof value !== 'number' || !isFinite(value)) return MUTED
 if (value > 0.02) return GOLD
 if (value < -0.02) return BLUE
 return MUTED
}

function platformName(key: string): string {
 const names: Record<string, string> = {
 spotify: 'Spotify',
 apple_music: 'Apple Music',
 youtube: 'YouTube',
 tidal: 'Tidal',
 amazon_music: 'Amazon Music',
 deezer: 'Deezer',
 soundcloud: 'SoundCloud',
 }
 return names[key] || key.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function fmtTransient(value: number | undefined | null): string {
 if (typeof value !== 'number' || !isFinite(value)) return '--'
 const note = value < -1 ? 'rounded off' : value > 1 ? 'sharpened' : 'unchanged'
 return `${fmtSigned(value, '%')} (${note})`
}

function fmtTpOvers(delta: MasteringDeltaData): string {
 if (typeof delta.tp_overs_a === 'number' && typeof delta.tp_overs_b === 'number') {
 return `${delta.tp_overs_a} -> ${delta.tp_overs_b}`
 }
 if (typeof delta.tp_overs_pulled_back === 'number') {
 return `${delta.tp_overs_pulled_back} pulled back`
 }
 return '--'
}
