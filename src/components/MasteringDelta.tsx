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

 {delta.eq_match?.bands?.length ? (
 <div className="border p-3 space-y-2" style={{ borderColor: 'rgba(168,161,150,0.14)', backgroundColor: 'rgba(31,27,23,0.35)' }}>
  <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.16em]" style={{ color: MUTED }}>
   EQ match (B → A)
   <InfoDot text="Suggested parametric EQ moves to apply to B to match A's tonal shape. Each band is 50% of the measured difference — a conservative starting point. Q = filter width (low Q = broad shelf, high Q = surgical cut/boost)." />
  </div>
  <div className="flex flex-wrap gap-2">
   {delta.eq_match.bands.map((b, i) => {
    const sign = b.gain_db >= 0 ? '+' : ''
    const freqLabel = b.freq >= 1000 ? `${(b.freq / 1000).toFixed(b.freq % 1000 === 0 ? 0 : 1)} kHz` : `${b.freq} Hz`
    return (
     <div key={i} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      border: `1px solid ${b.gain_db >= 0 ? 'rgba(208,176,102,0.35)' : 'rgba(99,140,188,0.35)'}`,
      borderRadius: 2, padding: '3px 8px',
      backgroundColor: b.gain_db >= 0 ? 'rgba(208,176,102,0.06)' : 'rgba(99,140,188,0.06)',
     }}>
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 9, color: MUTED, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
       {b.region}
      </span>
      <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11, color: b.gain_db >= 0 ? GOLD : 'var(--color-data-a)' }}>
       {freqLabel} {sign}{b.gain_db.toFixed(1)} dB Q{b.q.toFixed(1)}
      </span>
     </div>
    )
   })}
  </div>
  <div className="text-[10px]" style={{ color: MUTED }}>Start at 50% then re-listen. Negative = cut, positive = boost.</div>
 </div>
 ) : null}

 {/* Extended chain recommendations */}
 {delta.chain_recommendations && (
  <ChainRecs recs={delta.chain_recommendations} eqBands={delta.eq_match?.bands} />
 )}

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

// ── Ozone XML generator (TypeScript port of ozone_export.py) ─────────────────

function generateOzonePresetXml(delta: MasteringDeltaData, trackName = ''): string {
 const chain = delta.chain_recommendations
 const eqBands = delta.eq_match?.bands ?? []
 const ts = Math.floor(Date.now() / 1000)
 const comment = trackName ? `RTMcompare — ${trackName}` : 'RTMcompare generated preset'

 const p = (eid: string, pid: string, val: number | string) => {
  const v = typeof val === 'number' ? val.toFixed(8) : String(val)
  return `        <Param ElementID="${eid}" ParamID="${pid}" Value="${v}" />`
 }
 const extra = (eid: string, data = '') =>
  `        <ExtraBytes ElementID="${eid}" Data="${data}" />`
 const disabled = (tag: string, eid: string) =>
  `    <${tag} Enabled="0">\n${extra(eid)}\n    </${tag}>`

 const lines: string[] = []
 lines.push(`<?xml version="1.0" standalone="yes" ?>`)
 lines.push(`<OzoneMS PresetVer="4" PluginVer="120000" PluginBuild="0" Comments="${comment}" LastModified="${ts}">`)

 lines.push(disabled('Clarity', 'Clarity'))
 lines.push(disabled('DynamicEQ', 'Dynamic EQ'))

 // Dynamics (compression)
 const comp = chain?.compression
 if (comp && comp.severity !== 'none') {
  const ratioMap: Record<string, number> = {
   '1.5:1–2:1': 1.75, '2:1 or less': 1.75, '2:1–3:1': 2.5, '3:1–4:1': 3.5,
  }
  const attackMap: Record<string, number> = { '10–30 ms': 20, '20–50 ms': 35, '40–80 ms': 60 }
  const releaseMap: Record<string, number> = { '100–200 ms': 150, '150–300 ms': 200, '200–400 ms': 300 }
  const ratio = Object.entries(ratioMap).find(([k]) => (comp.ratio_hint || '').includes(k))?.[1] ?? 2.0
  const attack = Object.entries(attackMap).find(([k]) => (comp.attack_hint || '').includes(k))?.[1] ?? 30.0
  const release = Object.entries(releaseMap).find(([k]) => (comp.release_hint || '').includes(k))?.[1] ?? 200.0
  lines.push(`    <Dynamics Enabled="1">`)
  lines.push(p('Dynamics', 'Num Bands', 1))
  lines.push(p('Dynamics', 'Detection Method', 2))
  lines.push(p('Dynamics', 'Auto Gain Compensation', 1))
  lines.push(p('Dynamics', 'Lookahead', 0.0))
  lines.push(p('Dynamics', 'Band 1 Comp Threshold', -20.0))
  lines.push(p('Dynamics', 'Band 1 Comp Ratio', ratio))
  lines.push(p('Dynamics', 'Band 1 Comp Attack', attack))
  lines.push(p('Dynamics', 'Band 1 Comp Release', release))
  lines.push(p('Dynamics', 'Band 1 Comp Soft Knee', 4.0))
  lines.push(p('Dynamics', 'Band 1 Gain', 0.5))
  lines.push(p('Dynamics', 'Band 1 Mix', 100.0))
  lines.push(extra('Dynamics'))
  lines.push(`    </Dynamics>`)
 } else {
  lines.push(disabled('Dynamics', 'Dynamics'))
 }

 // EQ
 if (eqBands.length > 0) {
  lines.push(`    <EQ Enabled="1">`)
  eqBands.slice(0, 8).forEach((band: { freq: number; gain_db: number; q: number }, idx: number) => {
   const i = idx + 1
   lines.push(p('Equalizer', `Band ${i} Enable`, 1))
   lines.push(p('Equalizer', `Band ${i} Visible`, 1))
   lines.push(p('Equalizer', `Band ${i} Shape`, 2))
   lines.push(p('Equalizer', `Band ${i} Frequency`, band.freq))
   lines.push(p('Equalizer', `Band ${i} Gain`, band.gain_db))
   lines.push(p('Equalizer', `Band ${i} Q`, band.q ?? 1.4))
  })
  lines.push(extra('Equalizer'))
  lines.push(`    </EQ>`)
 } else {
  lines.push(disabled('EQ', 'Equalizer'))
 }

 lines.push(disabled('EQ2', 'Post Equalizer'))
 lines.push(disabled('Exciter', 'Exciter'))

 lines.push(`    <Global Enabled="0">`)
 lines.push(`        <ExtraBytes ElementID="ElementChain" Data="" />`)
 lines.push(`        <ExtraBytes ElementID="Global" Data="" />`)
 lines.push(`    </Global>`)

 // Imager
 const stereo = chain?.stereo
 if (stereo) {
  const oz = stereo.ozone
  lines.push(`    <Imager Enabled="1">`)
  lines.push(p('Stereo Imager', 'Num Bands', oz.num_bands))
  lines.push(p('Stereo Imager', 'Crossover Cutoff 1', oz.crossover_hz))
  lines.push(p('Stereo Imager', 'Crossover Cutoff 2', 4000.0))
  lines.push(p('Stereo Imager', 'Crossover Cutoff 3', 12000.0))
  const widths = [oz.band1_width_pct, oz.band2_width_pct]
  widths.forEach((w, idx) => {
   const i = idx + 1
   lines.push(p('Stereo Imager', `Band ${i} Width Percent`, w))
   lines.push(p('Stereo Imager', `Band ${i} Active`, 1))
  })
  for (let i = 3; i <= 4; i++) {
   lines.push(p('Stereo Imager', `Band ${i} Width Percent`, 0.0))
   lines.push(p('Stereo Imager', `Band ${i} Active`, 0))
  }
  lines.push(extra('Stereo Imager'))
  lines.push(`    </Imager>`)
 } else {
  lines.push(disabled('Imager', 'Stereo Imager'))
 }

 lines.push(disabled('Impact', 'Impact'))
 lines.push(disabled('LowEndFocus', 'Low End Focus'))
 lines.push(disabled('MasterRebalance', 'Master Rebalance'))

 lines.push(`    <MatchEQ Enabled="0">`)
 lines.push(extra('Match Equalizer'))
 lines.push(extra('Snapshot'))
 lines.push(`    </MatchEQ>`)

 // Maximizer
 const lim = chain?.limiter
 if (lim) {
  const oz = lim.ozone
  lines.push(`    <Maximizer Enabled="1">`)
  lines.push(p('Maximizer', 'Mode', oz.mode))
  lines.push(p('Maximizer', 'Threshold', oz.threshold))
  lines.push(p('Maximizer', 'Margin', oz.margin))
  lines.push(p('Maximizer', 'Character', oz.character))
  lines.push(p('Maximizer', 'Spectral Shaping Style', 2))
  lines.push(extra('Maximizer'))
  lines.push(`    </Maximizer>`)
 } else {
  lines.push(disabled('Maximizer', 'Maximizer'))
 }

 lines.push(`    <Meters Enabled="0" />`)
 lines.push(disabled('SpectralShaper', 'Spectral Shaper'))
 lines.push(disabled('Stabilizer', 'Stabilizer'))
 lines.push(disabled('VintageCompressor', 'Vintage Compressor'))
 lines.push(disabled('VintageEQ', 'Vintage EQ'))
 lines.push(disabled('VintageLimiter', 'Vintage Limiter'))
 lines.push(disabled('VintageTape', 'Vintage Tape'))

 lines.push(`</OzoneMS>`)
 return lines.join('\n')
}

// ── ChainRecs ────────────────────────────────────────────────────────────────

function SeverityBadge({ label, color }: { label: string; color: string }) {
 return (
  <span style={{
   display: 'inline-block', padding: '1px 6px', borderRadius: 2,
   fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
   border: `1px solid ${color}33`, color, backgroundColor: `${color}11`,
  }}>{label}</span>
 )
}

function RecCard({ title, badge, children }: { title: string; badge?: React.ReactNode; children: React.ReactNode }) {
 return (
  <div style={{ borderTop: '1px solid rgba(168,161,150,0.1)', paddingTop: 10 }}>
   <div className="flex items-center gap-2 mb-2">
    <span style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: MUTED }}>{title}</span>
    {badge}
   </div>
   <div className="space-y-1">{children}</div>
  </div>
 )
}

function RecLine({ label, value, tone }: { label: string; value: string; tone?: string }) {
 return (
  <div className="flex items-start justify-between gap-4 text-xs">
   <span style={{ color: MUTED, flexShrink: 0 }}>{label}</span>
   <span className="font-mono text-right" style={{ color: tone || CREAM }}>{value}</span>
  </div>
 )
}

function ChainRecs({
 recs,
 eqBands,
}: {
 recs: NonNullable<MasteringDeltaData['chain_recommendations']>
 eqBands?: { freq: number; gain_db: number; q: number; region?: string }[]
}) {
 const [saving, setSaving] = useState(false)
 const [menuOpen, setMenuOpen] = useState(false)
 const [toast, setToast] = useState<string | null>(null)
 const [rtmsendOzone, setRtmsendOzone] = useState<boolean>(false)
 const [rtmsendOzoneAdvanced, setRtmsendOzoneAdvanced] = useState<boolean>(false)
 const [ozoneInstallations, setOzoneInstallations] = useState<{ name: string; version: string }[]>([])

 // Detect Ozone installation on mount; re-check RTMsend status every time the menu opens.
 React.useEffect(() => {
  window.electronAPI?.ozoneDetect?.().then(res => {
   setOzoneInstallations(res.found ? (res.installations ?? []) : [])
  }).catch(() => {})
 }, [])

 const checkRtmsendStatus = React.useCallback(() => {
  window.electronAPI?.rtmsendStatus?.().then(status => {
   const pluginName: string = status?.loaded?.name ?? ''
   const nameLo = pluginName.toLowerCase()
   setRtmsendOzone(status?.running === true && nameLo.includes('ozone') && nameLo.includes('equalizer'))
   // Ozone Advanced = running + "ozone" in name but NOT one of the individual modules
   setRtmsendOzoneAdvanced(status?.running === true && nameLo.includes('ozone') &&
     !nameLo.includes('equalizer') && !nameLo.includes('imager') &&
     !nameLo.includes('dynamics') && !nameLo.includes('maximizer'))
  }).catch(() => {})
 }, [])

 React.useEffect(() => {
  if (menuOpen) checkRtmsendStatus()
 }, [menuOpen, checkRtmsendStatus])

 React.useEffect(() => {
  if (!menuOpen) return
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
 }, [menuOpen])

 const flash = (msg: string) => {
  setToast(msg)
  setTimeout(() => setToast(null), 4500)
 }

 // Include EQ bands so the generated preset has all four modules active.
 const buildXml = () => generateOzonePresetXml({
  chain_recommendations: recs,
  eq_match: eqBands && eqBands.length > 0 ? { bands: eqBands } : undefined,
 } as MasteringDeltaData)

 // Push full mastering chain directly to Ozone Advanced via RTMsend (no preset file)
 const pushChainViaRtmsend = async () => {
  setSaving(true); setMenuOpen(false)
  try {
   const comp = recs.compression
   const lim  = recs.limiter
   const stereo = recs.stereo

   const ratioMap: Record<string, number> = { '1.5:1–2:1': 1.75, '2:1 or less': 1.75, '2:1–3:1': 2.5, '3:1–4:1': 3.5 }
   const attackMap: Record<string, number> = { '10–30 ms': 20, '20–50 ms': 35, '40–80 ms': 60 }
   const releaseMap: Record<string, number> = { '100–200 ms': 150, '150–300 ms': 200, '200–400 ms': 300 }

   const result = await window.electronAPI?.rtmsendSendChain?.({
    eq_bands: eqBands?.map(b => ({ region: b.region ?? 'mid', freq_hz: b.freq, gain_db: b.gain_db, q: b.q })),
    comp: comp && comp.severity !== 'none' ? {
     threshold_db: -20,
     ratio: Object.entries(ratioMap).find(([k]) => (comp.ratio_hint || '').includes(k))?.[1] ?? 2.0,
     attack_ms: Object.entries(attackMap).find(([k]) => (comp.attack_hint || '').includes(k))?.[1] ?? 30.0,
     release_ms: Object.entries(releaseMap).find(([k]) => (comp.release_hint || '').includes(k))?.[1] ?? 200.0,
    } : undefined,
    limiter: lim?.ozone ? {
     threshold_db: lim.ozone.threshold,
     margin_db: lim.ozone.margin,
     character: lim.ozone.character,
    } : undefined,
    imager: stereo?.ozone ? {
     crossover_hz: stereo.ozone.crossover_hz,
     band1_width_pct: stereo.ozone.band1_width_pct,
     band2_width_pct: stereo.ozone.band2_width_pct,
    } : undefined,
   })
   if (!result) { flash('RTMsend bridge unavailable'); return }
   flash(`Pushed ${result.applied} params to ${result.plugin} (${result.rejected} rejected)`)
  } catch (err: any) {
   flash(err?.message ?? 'Chain push failed')
  } finally {
   setSaving(false)
  }
 }

 // Diagnostic: dump all parameters from the loaded plugin — used to verify Ozone Advanced
 // parameter names match our mapping before trusting rtmsend-send-chain results.
 const dumpParams = async () => {
  setSaving(true); setMenuOpen(false)
  try {
   const res = await window.electronAPI?.rtmsendDumpParams?.()
   if (!res) { flash('RTMsend bridge unavailable'); return }
   const text = `Plugin: ${res.plugin}\nTotal params: ${res.params.length}\n\n` +
    res.params.map(p => `[${p.index}] ${p.name} = ${p.current.toFixed(4)} (default ${p.default.toFixed(4)}) "${p.text}"`).join('\n')
   await navigator.clipboard.writeText(text)
   flash(`Copied ${res.params.length} params from "${res.plugin}" to clipboard`)
  } catch (err: any) {
   flash(err?.message ?? 'Dump failed')
  } finally {
   setSaving(false)
  }
 }

 // RTMsend path: push EQ match bands directly to Ozone EQ in the DAW (live, no file)
 const pushEqViaRtmsend = async () => {
  setSaving(true); setMenuOpen(false)
  try {
   if (!eqBands || eqBands.length === 0) {
    flash('No EQ match bands — run analysis first')
    return
   }
   const bands = eqBands.map(b => ({
    region: b.region ?? 'mid',
    freq_hz: b.freq,
    gain_db: b.gain_db,
    q: b.q,
   }))
   const result = await window.electronAPI?.rtmsendSendEq?.(bands)
   if (result?.ok === false) {
    flash(result.error ?? 'RTMsend: push failed')
   } else {
    flash('EQ pushed to Ozone 12 Equalizer via RTMsend')
   }
  } catch (err: any) {
   flash(err?.message ?? 'RTMsend error')
  } finally {
   setSaving(false)
  }
 }

 // Primary path: write directly into ~/Documents/iZotope/Ozone N Advanced/User Presets/RTMcompare/
 const sendToOzone = async () => {
  setSaving(true); setMenuOpen(false)
  try {
   const xml = buildXml()
   const profName = recs.profile_context?.name
   const fileName = profName
    ? `rtmcompare-${profName.toLowerCase().replace(/\s+/g, '-')}.xml`
    : 'rtmcompare-master.xml'
   if (window.electronAPI?.ozoneInstallPreset) {
    const res = await window.electronAPI.ozoneInstallPreset(xml, fileName)
    if (res.ok) {
     const installed = res.results.filter((r: any) => r.path)
     const versions = installed.map((r: any) => r.version).join(', ')
     flash(`Installed in ${versions} — reload presets or restart Ozone to see "RTMcompare" category`)
    } else {
     flash(res.error || 'Install failed — try "Save XML…" instead')
    }
   } else {
    flash('Ozone bridge unavailable — use "Save XML…"')
   }
  } catch (err: any) {
   flash(err?.message || 'Install failed')
  } finally {
   setSaving(false)
  }
 }

 // Fallback: save dialog (user picks location)
 const saveXml = async () => {
  setSaving(true); setMenuOpen(false)
  try {
   const xml = buildXml()
   if (window.electronAPI?.saveFileDialog) {
    const saved = await window.electronAPI.saveFileDialog(
     'rtmcompare-master.xml', xml,
     [{ name: 'Ozone Preset', extensions: ['xml'] }],
    )
    if (saved) flash(`Preset saved — place it in Ozone's User Presets folder and reload presets`)
   } else {
    const blob = new Blob([xml], { type: 'text/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'rtmcompare-master.xml'; a.click()
    URL.revokeObjectURL(url)
    flash('Preset downloaded')
   }
  } catch (err: any) {
   flash(err?.message || 'Save failed')
  } finally {
   setSaving(false)
  }
 }

 const comp = recs.compression
 const lim = recs.limiter
 const stereo = recs.stereo
 const gs = recs.gain_staging
 const clip = recs.clipping
 const profCtx = recs.profile_context

 const hasContent = (comp && comp.severity !== 'none') || lim || stereo || gs || clip

 return (
  <div className="border p-3 space-y-0" style={{ borderColor: 'rgba(168,161,150,0.14)', backgroundColor: 'rgba(31,27,23,0.35)' }}>
   <div className="flex items-center justify-between mb-3">
    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em]" style={{ color: MUTED }}>
     Chain Recommendations
     <InfoDot text="Suggested processing chain derived from comparing mix (A) to master (B). Compression, limiting, stereo, gain staging, and clipping settings extrapolated from the measured differences. Exports directly to Ozone 9–12." />
     {profCtx?.name && (
      <span style={{
       fontSize: 9, letterSpacing: '0.1em', padding: '1px 6px',
       border: `1px solid rgba(208,176,102,0.3)`, borderRadius: 2,
       color: GOLD, backgroundColor: 'rgba(208,176,102,0.08)',
       textTransform: 'uppercase',
      }}>
       {profCtx.name}
      </span>
     )}
    </div>
    <div className="relative">
     <button
      onClick={() => setMenuOpen(v => !v)}
      disabled={saving}
      className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium transition-opacity disabled:opacity-50"
      style={{
       borderRadius: 2, border: `1px solid rgba(208,176,102,0.4)`,
       color: GOLD, backgroundColor: 'rgba(208,176,102,0.08)',
       letterSpacing: '0.1em', textTransform: 'uppercase',
      }}
      title="Send recommendations to Ozone or save as XML preset file."
     >
      {saving ? '…' : 'Send to Ozone'}
      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
       <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
     </button>
     {menuOpen && (
      <>
      <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden="true" />
      <div className="absolute right-0 top-full mt-1 z-50 py-1 min-w-[240px]"
       style={{ borderRadius: 2, backgroundColor: 'var(--color-bg-panel)', border: '1px solid rgba(168,161,150,0.15)' }}>
       {/* Full chain push — Ozone Advanced loaded in RTMsend */}
       {rtmsendOzoneAdvanced && (
        <button onClick={pushChainViaRtmsend}
         className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-dark-800/80 transition-colors">
         <span className="w-5 flex-shrink-0 text-center text-[11px]" style={{ color: GREEN }}>⇉</span>
         <div>
          <div className="text-[11px]" style={{ color: GREEN }}>Push full chain live (RTMsend)</div>
          <div className="text-[9px] mt-0.5" style={{ color: MUTED }}>EQ + Comp + Limiter + Imager → Ozone Advanced directly, no preset file or reload</div>
         </div>
        </button>
       )}
       {/* EQ-only push — Ozone EQ module loaded in RTMsend */}
       {rtmsendOzone && eqBands && eqBands.length > 0 && (
        <button onClick={pushEqViaRtmsend}
         className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-dark-800/80 transition-colors">
         <span className="w-5 flex-shrink-0 text-center text-[11px]" style={{ color: GREEN }}>↗</span>
         <div>
          <div className="text-[11px]" style={{ color: GREEN }}>Push EQ live (RTMsend)</div>
          <div className="text-[9px] mt-0.5" style={{ color: MUTED }}>Sends EQ bands only to Ozone EQ module — instant, no file</div>
         </div>
        </button>
       )}
       {/* Diagnostic — dump parameter list from whatever plugin is loaded */}
       {(rtmsendOzone || rtmsendOzoneAdvanced) && (
        <button onClick={dumpParams}
         className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-dark-800/80 transition-colors">
         <span className="w-5 flex-shrink-0 text-center text-[11px]" style={{ color: MUTED }}>⎘</span>
         <div>
          <div className="text-[11px]" style={{ color: CREAM }}>Copy param list to clipboard</div>
          <div className="text-[9px] mt-0.5" style={{ color: MUTED }}>Dumps all VST3 parameter names + indices from the loaded plugin</div>
         </div>
        </button>
       )}
       <button onClick={sendToOzone}
        className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-dark-800/80 transition-colors">
        <span className="w-5 flex-shrink-0 text-center text-[11px]" style={{ color: ozoneInstallations.length > 0 ? GOLD : MUTED }}>⇢</span>
        <div>
         <div className="flex items-center gap-2">
          <span className="text-[11px]" style={{ color: ozoneInstallations.length > 0 ? GOLD : CREAM }}>Install full preset in Ozone</span>
          {ozoneInstallations.length > 0 ? (
           <span className="text-[9px] px-1.5 py-px" style={{ color: GREEN, backgroundColor: 'rgba(110,197,119,0.10)', border: '1px solid rgba(110,197,119,0.25)', borderRadius: 2 }}>
            {ozoneInstallations.map(i => i.name).join(', ')} detected
           </span>
          ) : (
           <span className="text-[9px] px-1.5 py-px" style={{ color: MUTED, backgroundColor: 'rgba(168,161,150,0.08)', border: '1px solid rgba(168,161,150,0.15)', borderRadius: 2 }}>
            Ozone not found
           </span>
          )}
         </div>
         <div className="text-[9px] mt-0.5" style={{ color: MUTED }}>
          {ozoneInstallations.length > 0
           ? 'EQ + Comp + Limiter + Imager → ~/Documents/iZotope, appears in preset browser'
           : 'Will still write the XML — place it in Ozone\'s User Presets folder manually'}
         </div>
        </div>
       </button>
       <button onClick={saveXml}
        className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-dark-800/80 transition-colors">
        <span className="w-5 flex-shrink-0 text-center text-[11px]" style={{ color: MUTED }}>⬇</span>
        <div>
         <div className="text-[11px]" style={{ color: CREAM }}>Save XML…</div>
         <div className="text-[9px] mt-0.5" style={{ color: MUTED }}>Save dialog — place file in Ozone's User Presets folder manually</div>
        </div>
       </button>
      </div>
      </>
     )}
    </div>
   </div>

   {!hasContent && (
    <div className="text-xs" style={{ color: MUTED }}>No chain recommendations — analysis data insufficient.</div>
   )}

   {/* Profile context summary — shows which fields are driving the recs */}
   {profCtx && (profCtx.compression_character || profCtx.limiter_tightness || profCtx.loudness_style || profCtx.chain_lufs_delta != null) && (
    <div style={{ borderTop: '1px solid rgba(168,161,150,0.1)', paddingTop: 8, marginTop: 4 }}>
     <div className="flex flex-wrap gap-x-4 gap-y-1">
      {profCtx.is_chain_profile ? (
       /* Chain profile: show measured deltas */
       <>
        {profCtx.chain_lufs_delta != null && (
         <RecLine label="Chain LUFS shift"
          value={`${profCtx.chain_lufs_delta > 0 ? '+' : ''}${profCtx.chain_lufs_delta.toFixed(1)} LU${profCtx.lufs_delta_mad != null ? ` ±${profCtx.lufs_delta_mad.toFixed(1)}` : ''}`} />
        )}
        {profCtx.chain_lra_delta != null && (
         <RecLine label="Chain LRA change"
          value={`${profCtx.chain_lra_delta > 0 ? '+' : ''}${profCtx.chain_lra_delta.toFixed(1)} LU · ${profCtx.compression_character ?? ''}`} />
        )}
        {profCtx.chain_peak_delta != null && (
         <RecLine label="Chain peak shift"
          value={`${profCtx.chain_peak_delta > 0 ? '+' : ''}${profCtx.chain_peak_delta.toFixed(1)} dBTP`} />
        )}
        {profCtx.chain_width_delta != null && (
         <RecLine label="Chain width change"
          value={`${profCtx.chain_width_delta > 0 ? '+' : ''}${(profCtx.chain_width_delta * 100).toFixed(0)}%`} />
        )}
       </>
      ) : (
       /* Fingerprint profile: show absolute targets */
       <>
        {profCtx.compression_character && (
         <RecLine label="Profile compression" value={`${profCtx.compression_character}${profCtx.crest_factor_avg != null ? ` · crest ${profCtx.crest_factor_avg.toFixed(0)} dB` : ''}`} />
        )}
        {profCtx.limiter_tightness && (
         <RecLine label="Profile limiter" value={`${profCtx.limiter_tightness}${profCtx.plr_avg != null ? ` · PLR ${profCtx.plr_avg.toFixed(0)} LU` : ''}`} />
        )}
        {profCtx.loudness_style && (
         <RecLine label="Profile loudness" value={`${profCtx.loudness_style}${profCtx.target_lufs != null ? ` · ${profCtx.target_lufs.toFixed(1)} LUFS avg` : ''}`} />
        )}
        {profCtx.macro_dynamics_lu != null && (
         <RecLine label="Profile macro dynamics" value={`${profCtx.macro_dynamics_lu.toFixed(1)} LU swing`} />
        )}
       </>
      )}
     </div>
    </div>
   )}

   {/* Compression */}
   {comp && comp.severity !== 'none' && (
    <RecCard
     title="Compression"
     badge={<SeverityBadge label={comp.severity} color={comp.severity === 'heavy' ? RED : comp.severity === 'moderate' ? GOLD : CREAM} />}
    >
     <div className="text-xs mb-1" style={{ color: CREAM }}>{comp.summary}</div>
     <RecLine label="Ratio" value={comp.ratio_hint} />
     <RecLine label="Attack" value={comp.attack_hint} />
     <RecLine label="Release" value={comp.release_hint} />
     <RecLine label="Threshold" value={comp.threshold_note} />
     <RecLine
      label="Transients"
      value={comp.transients_preserved ? 'preserved' : 'softened'}
      tone={comp.transients_preserved ? GREEN : GOLD}
     />
     <RecLine label="LRA before → after" value={`${comp.lra_b.toFixed(1)} LU (Δ ${comp.lra_delta > 0 ? '+' : ''}${comp.lra_delta.toFixed(1)})`} />
    </RecCard>
   )}

   {/* Limiter */}
   {lim && (
    <RecCard
     title="Limiter / Maximizer"
     badge={<SeverityBadge label={lim.character} color={lim.over_limited ? RED : lim.character === 'heavy' ? GOLD : CREAM} />}
    >
     <div className="text-xs mb-1" style={{ color: CREAM }}>{lim.summary}</div>
     <RecLine label="Est. gain reduction" value={`${lim.gain_reduction_db.toFixed(1)} dB`} tone={lim.gain_reduction_db > 3 ? RED : GOLD} />
     <RecLine label="Output ceiling" value={`${lim.ceiling_dbtp.toFixed(1)} dBTP`} />
     <RecLine label="Ceiling note" value={lim.ceiling_note} />
     {lim.over_limited && <RecLine label="Warning" value="Over-limited — transients may be damaged" tone={RED} />}
     <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(168,161,150,0.08)' }}>
      <div className="text-[9px] uppercase tracking-widest mb-1" style={{ color: MUTED }}>Ozone Maximizer settings</div>
      <RecLine label="Threshold" value={`${lim.ozone.threshold.toFixed(1)} dBTP`} />
      <RecLine label="Margin (ceiling)" value={`${lim.ozone.margin.toFixed(1)} dBTP`} />
      <RecLine label="Mode" value={lim.ozone.mode === 3 ? 'IRC4 (transparent)' : `IRC${lim.ozone.mode}`} />
      <RecLine label="Character" value={`${lim.ozone.character.toFixed(0)} / 10`} />
     </div>
    </RecCard>
   )}

   {/* Stereo */}
   {stereo && (
    <RecCard title="Stereo / M-S">
     {stereo.notes.map((note, i) => (
      <div key={i} className="text-xs" style={{ color: i === 0 ? CREAM : MUTED }}>{note}</div>
     ))}
     {stereo.ms_needed && <RecLine label="M-S processing" value="recommended" tone={GOLD} />}
     {stereo.bass_too_wide && <RecLine label="Sub bass" value="too wide — mono below ~120 Hz" tone={RED} />}
     {stereo.highs_too_narrow && <RecLine label="High end" value="narrower than reference" tone={BLUE} />}
     {stereo.mono_loss_pct > 5 && (
      <RecLine label="Mono compatibility" value={`${stereo.mono_loss_pct.toFixed(0)}% of content lost in mono`} tone={stereo.mono_loss_pct > 15 ? RED : GOLD} />
     )}
     <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(168,161,150,0.08)' }}>
      <div className="text-[9px] uppercase tracking-widest mb-1" style={{ color: MUTED }}>Ozone Imager settings</div>
      <RecLine label="Crossover" value={`${stereo.ozone.crossover_hz} Hz`} />
      <RecLine label="Low band width" value={`${stereo.ozone.band1_width_pct > 0 ? '+' : ''}${stereo.ozone.band1_width_pct.toFixed(0)}%`} tone={stereo.ozone.band1_width_pct < -10 ? BLUE : GOLD} />
      <RecLine label="High band width" value={`${stereo.ozone.band2_width_pct > 0 ? '+' : ''}${stereo.ozone.band2_width_pct.toFixed(0)}%`} />
     </div>
    </RecCard>
   )}

   {/* Gain Staging */}
   {gs && (
    <RecCard title="Gain Staging">
     <div className="text-xs mb-1" style={{ color: CREAM }}>{gs.summary}</div>
     <RecLine label="Reference style" value={gs.reference_style} />
     <RecLine label="Mix LUFS" value={`${gs.lufs_a.toFixed(1)} LUFS`} />
     <RecLine label="Master LUFS" value={`${gs.lufs_b.toFixed(1)} LUFS`} />
     <RecLine label="Target" value={`${gs.target_lufs.toFixed(1)} LUFS`} />
     <RecLine label="Gap to target" value={`${gs.lufs_gap > 0 ? '+' : ''}${gs.lufs_gap.toFixed(1)} LU`} tone={Math.abs(gs.lufs_gap) > 2 ? GOLD : GREEN} />
     {Math.abs(gs.broadband_gain_db) > 0.1 && (
      <RecLine label="Pre-limiter gain" value={`${gs.broadband_gain_db > 0 ? '+' : ''}${gs.broadband_gain_db.toFixed(1)} dB`} />
     )}
     {gs.pre_limiter_note && (
      <div className="text-[10px] mt-1" style={{ color: MUTED }}>{gs.pre_limiter_note}</div>
     )}
    </RecCard>
   )}

   {/* Clipping */}
   {clip && (
    <RecCard
     title="Clipping"
     badge={<SeverityBadge label={clip.safe_to_clip ? 'safe to clip' : 'no clipping'} color={clip.safe_to_clip ? GREEN : MUTED} />}
    >
     <div className="text-xs mb-1" style={{ color: CREAM }}>{clip.summary}</div>
     <RecLine label="Approach" value={
      clip.approach === 'clipper_then_limiter' ? 'Clipper → Limiter'
       : clip.approach === 'limiter_only' ? 'Limiter only'
       : 'Evaluate'
     } />
     {clip.safe_to_clip && (
      <>
       <RecLine label="Clipper ceiling" value={`${clip.clipper_ceiling_dbtp.toFixed(1)} dBTP`} />
       <RecLine label="Limiter ceiling" value={`${clip.limiter_ceiling_dbtp.toFixed(1)} dBTP`} />
       {clip.suggested_settings && (
        <div className="text-[10px] mt-1 font-mono" style={{ color: MUTED }}>{clip.suggested_settings}</div>
       )}
      </>
     )}
    </RecCard>
   )}

   {toast && (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 text-xs"
     style={{ borderRadius: 2, backgroundColor: 'rgba(14,13,11,0.96)', color: GOLD, border: '1px solid rgba(208,176,102,0.35)' }}>
     {toast}
    </div>
   )}
  </div>
 )
}
