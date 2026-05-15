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
 tooltip="How much louder or quieter the master is vs the mix across the full frequency spectrum. Positive = master is hotter overall."
 onAnnotate={annotationsEnabled ? () => annotate('lufs_i', delta.broadband_gain_db, 'LU') : undefined}
 />
 <Metric
 label="LRA"
 value={`${fmtNum(overall.dynamics_a, 1)} -> ${fmtNum(overall.dynamics_b, 1)} LU`}
 sub={fmtSigned(delta.lra_delta, ' LU')}
 tone={delta.lra_delta < 0 ? GOLD : CREAM}
 tooltip="Loudness Range — how dynamic the track is (loud parts vs quiet parts). A negative delta means mastering compressed the dynamics; typical music sits 4–8 LU."
 onAnnotate={annotationsEnabled ? () => annotate('lra_lu', delta.lra_delta, 'LU') : undefined}
 />
 <Metric
 label="PSR delta"
 value={fmtSigned(delta.psr_delta, ' dB')}
 tone={delta.psr_delta < 0 ? GOLD : CREAM}
 tooltip="Peak-to-Short-term Ratio — headroom between the loudest transient peaks and the average programme level. A drop here means the limiter is catching more peaks (i.e. the master is more limited)."
 onAnnotate={annotationsEnabled ? () => annotate('plr', delta.psr_delta, 'dB') : undefined}
 />
 <Metric
 label="RMS/peak"
 value={fmtSigned(delta.rms_to_peak_delta, ' dB')}
 tone={(delta.rms_to_peak_delta ?? 0) < 0 ? GOLD : CREAM}
 tooltip="Change in the ratio between average energy (RMS) and the loudest peak. A lower ratio after mastering usually means the limiter is working hard and transients are being softened."
 onAnnotate={annotationsEnabled ? () => annotate('true_peak_dbtp', delta.rms_to_peak_delta, 'dB') : undefined}
 />
 <Metric
 label="Limiter"
 value={fmtLimiter(delta.limiter_aggressiveness)}
 sub={delta.estimated_gain_reduction_db != null && isFinite(delta.estimated_gain_reduction_db) ? `${delta.estimated_gain_reduction_db.toFixed(1)} dB est. GR` : undefined}
 tone={limiterColor(delta.limiter_aggressiveness)}
 tooltip="How hard the mastering limiter is working. 'Transparent' = barely touching peaks. 'Heavy' = significant gain reduction — may affect transients and punch."
 />
 </div>

 <div className="grid grid-cols-1 lg:grid-cols-[1fr_0.7fr] gap-4">
 <div className="border overflow-hidden" style={{ borderColor: 'rgba(168,161,150,0.14)', backgroundColor: 'rgba(31,27,23,0.35)' }}>
 <div className="flex items-center px-3 py-2 border-b" style={{ borderColor: 'rgba(168,161,150,0.1)' }}>
 <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.16em]" style={{ color: MUTED }}>
 Per-band gain — 31-band ⅓ octave
 <InfoDot text="The frequency spectrum split into 31 bands (like a graphic EQ). Each bar shows how much louder or quieter the master is in that frequency range vs the mix. Gold = boosted, blue = cut." />
 </div>
 <div className="ml-auto text-[10px] font-mono" style={{ color: MUTED }}>B − A</div>
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
 <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.16em]" style={{ color: MUTED }}>
 Playback delta after platform normalization
 <InfoDot text="Streaming platforms (Spotify, Apple Music, YouTube…) automatically turn tracks up or down to a target loudness before playing them. This shows how much the master differs from the mix after that adjustment. If both files are already louder than the target, the platform pulls them to the same level and the delta reads 0.0 — meaning listeners won't hear the extra loudness you added." />
 </div>
 <div className="text-[10px] leading-relaxed" style={{ color: MUTED }}>
 <span style={{ color: CREAM }}>B − A</span> in played LUFS after each platform's loudness normalization. <span style={{ color: CREAM }}>0.0 on every row</span> = both files already above target — normalization makes them equal.
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
 <ReportLine label="Transient density" value={fmtTransient(delta.transient_density_change_pct)} tooltip="How much the number of sharp transient hits changed after mastering. A big drop often means the limiter is softening drum hits and attacks." />
 <ReportLine label="Peak-to-RMS ratio" value={fmtSigned(delta.peak_to_rms_ratio_change, ' dB')} tooltip="Crest factor change — headroom between the loudest peaks and average loudness. A drop here = more limiting / compression applied during mastering." />
 <ReportLine label="TP overs pulled back" value={fmtTpOvers(delta)} tooltip="Inter-sample true peaks that exceeded the ceiling in the mix but were caught and pulled below it by the mastering limiter." />

 {/* Transient Homogeneity */}
 {delta.transient_homogeneity && (
  <div style={{ borderTop: '1px solid rgba(168,161,150,0.08)', paddingTop: 8 }}>
   <div className="flex items-center justify-between gap-3 text-sm">
    <div>
     <span className="flex items-center gap-1" style={{ color: MUTED }}>
      Transient Uniformity
      <InfoDot text="Measures how similar all the loud hits (kicks, snares, attacks) are in energy after mastering. A score close to 1.0 means every hit has been squashed to the same level — a sign the limiter is over-working and the master may sound flat or lifeless. 'Clean' = transients still vary naturally." />
     </span>
     <div className="text-[10px] mt-0.5" style={{ color: MUTED }}>Flags over-limited / transient-shaped masters</div>
    </div>
    <span className="font-mono" style={{ color: delta.transient_homogeneity.flag ? RED : CREAM }}>
     {delta.transient_homogeneity.homogeneity_score.toFixed(2)} {delta.transient_homogeneity.flag ? '⚠ homogenised' : '/ clean'}
    </span>
   </div>
  </div>
 )}

 {/* Perceptual Distance */}
 {delta.perceptual_quality && (
  <div style={{ borderTop: '1px solid rgba(168,161,150,0.08)', paddingTop: 8 }}>
   <div className="flex items-center justify-between gap-3 text-sm">
    <div>
     <span className="flex items-center gap-1" style={{ color: MUTED }}>
      Perceptual Distance
      <InfoDot text="How different the master sounds from the mix to a human ear — not just on a meter, but perceptually. Near 0 dB = the mastering is essentially inaudible. Above 3 dB = the master sounds noticeably different. Green is good; red means the processing changed the character significantly." />
     </span>
     <div className="text-[10px] mt-0.5" style={{ color: MUTED }}>{delta.perceptual_quality.quality_interpretation}</div>
    </div>
    <span className="font-mono" style={{
     color: delta.perceptual_quality.perceptual_distance_db < 1 ? GREEN
      : delta.perceptual_quality.perceptual_distance_db < 3 ? GOLD
      : RED,
    }}>
     {fmtSigned(delta.perceptual_quality.perceptual_distance_db, ' dB')}
    </span>
   </div>
  </div>
 )}

 {/* PLR Plausibility Warning */}
 {delta.plr_plausibility?.flag && (
  <div style={{ borderTop: '1px solid rgba(168,161,150,0.08)', paddingTop: 8 }}>
   <div className="flex items-center justify-between gap-3 text-sm">
    <div>
     <span className="flex items-center gap-1" style={{ color: GOLD }}>
      PLR Warning
      <InfoDot text="PLR (Peak-to-Loudness Ratio) measures headroom between the true peak and integrated loudness. A very low PLR at a low LUFS target is unusual — it suggests the master may have been over-limited or the analysis numbers don't add up. Worth a listen." />
     </span>
     <div className="text-[10px] mt-0.5" style={{ color: MUTED }}>{delta.plr_plausibility.note}</div>
    </div>
    <span className="font-mono" style={{ color: GOLD }}>
     PLR {delta.plr_plausibility.plr_db.toFixed(1)} dB at {delta.plr_plausibility.lufs_i_db.toFixed(0)} LUFS
    </span>
   </div>
  </div>
 )}

 {/* Measurement Inconsistency */}
 {delta.measurement_inconsistency && (
  <div style={{ borderTop: '1px solid rgba(168,161,150,0.08)', paddingTop: 8 }}>
   <span className="flex items-center gap-1 text-sm" style={{ color: GOLD }}>
    Measurement Warning
    <InfoDot text="The analysis found numbers that don't add up — for example a loudness reading that contradicts the peak level. This can happen with unusual file formats, sample-rate mismatches, or corrupted metadata. The measurements shown may not be fully reliable." />
   </span>
   <div className="font-mono text-[11px] mt-1" style={{ color: CREAM }}>{delta.measurement_inconsistency}</div>
  </div>
 )}

 {/* Crest Trajectory Sparkline */}
 {delta.crest_trajectory && delta.crest_trajectory.n_segments >= 3 && (
  <div style={{ borderTop: '1px solid rgba(168,161,150,0.08)', paddingTop: 12, marginTop: 4 }}>
   <div className="flex items-center gap-1" style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED, marginBottom: 6 }}>
    Dynamic Arc — {delta.crest_trajectory.trajectory} · variance {delta.crest_trajectory.crest_variance_db2.toFixed(1)} dB²
    <InfoDot text="How the master's crest factor (peaks vs average loudness) moves through the song. A 'falling' arc = starts punchy and gets more limited toward the end. 'Stable' = consistent limiting throughout. Variance shows how much that ratio jumps around — higher variance = more dynamic contrast section to section." />
   </div>
   <CrestSparkline segments={delta.crest_trajectory.segments} trajectory={delta.crest_trajectory.trajectory} />
  </div>
 )}
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

function Metric({ label, value, sub, tone, tooltip, onAnnotate }: { label: string; value: string; sub?: string; tone?: string; tooltip?: string; onAnnotate?: () => void }) {
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
 <div className="flex items-center gap-1 mb-1">
 <span className="text-[9px] uppercase tracking-[0.16em]" style={{ color: MUTED }}>{label}</span>
 {tooltip && <InfoDot text={tooltip} />}
 </div>
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

function ReportLine({ label, value, tooltip }: { label: string; value: string; tooltip?: string }) {
 return (
 <div className="flex items-center justify-between gap-3 text-sm">
 <span className="flex items-center gap-1" style={{ color: MUTED }}>
 {label}
 {tooltip && <InfoDot text={tooltip} />}
 </span>
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

interface CrestSegment { start_s: number; crest_db: number }

function CrestSparkline({ segments, trajectory }: { segments: CrestSegment[]; trajectory: 'dynamic' | 'moderate' | 'flat' }) {
 const W = 200, H = 40
 if (segments.length < 2) return null
 const times = segments.map(s => s.start_s)
 const crests = segments.map(s => s.crest_db)
 const tMin = Math.min(...times), tMax = Math.max(...times)
 const cMin = Math.min(...crests), cMax = Math.max(...crests)
 const meanCrest = crests.reduce((a, b) => a + b, 0) / crests.length
 const tRange = tMax - tMin || 1
 const cRange = cMax - cMin || 1
 const pad = 3
 const toX = (t: number) => pad + ((t - tMin) / tRange) * (W - 2 * pad)
 // Invert Y: lower crest = more limited = bottom of chart
 const toY = (c: number) => H - pad - ((c - cMin) / cRange) * (H - 2 * pad)
 const pts = segments.map(s => `${toX(s.start_s).toFixed(1)},${toY(s.crest_db).toFixed(1)}`).join(' ')
 const lineColor = trajectory === 'flat' ? RED : trajectory === 'moderate' ? GOLD : GREEN
 const meanY = toY(meanCrest).toFixed(1)
 return (
  <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
   <line x1={pad} y1={meanY} x2={W - pad} y2={meanY} stroke="rgba(168,161,150,0.25)" strokeWidth={1} strokeDasharray="3,2" />
   <polyline points={pts} fill="none" stroke={lineColor} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
  </svg>
 )
}

/** Small inline ⓘ circle — consistent tooltip trigger used throughout this panel. */
function InfoDot({ text }: { text: string }) {
 return (
 <span
 title={text}
 style={{
 display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
 width: 13, height: 13, borderRadius: '50%', flexShrink: 0,
 fontSize: 8, fontWeight: 600, fontStyle: 'normal',
 color: MUTED, border: `1px solid ${MUTED}`, cursor: 'help',
 lineHeight: 1, verticalAlign: 'middle',
 }}
 aria-label={text}
 >i</span>
 )
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
