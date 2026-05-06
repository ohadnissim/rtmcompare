import React from 'react'
import { MonoCompatibility } from '../types'

interface BandInfo {
 name: string
 freq_range: string
 impact: number
 note: string
 correlation: number
 loss_pct: number
 risk: number
}

interface Props {
 mono: MonoCompatibility & {
 bands_a?: BandInfo[]
 bands_b?: BandInfo[]
 risk_a?: number
 risk_b?: number
 }
 labelA: string
 labelB: string
}

export default function MonoCompat({ mono, labelA, labelB }: Props) {
 const getStatus = (risk: number): { color: string; label: string } => {
 if (risk < 8) return { color: '#6ec577', label: 'Excellent' }
 if (risk < 20) return { color: '#c5a55a', label: 'Acceptable' }
 return { color: '#e05a5a', label: 'High Risk' }
 }

 const riskA = mono.risk_a ?? mono.mono_loss_a_pct
 const riskB = mono.risk_b ?? mono.mono_loss_b_pct
 const statusA = getStatus(riskA)
 const statusB = getStatus(riskB)
 const worsened = riskB > riskA + 10

 return (
 <div className="bg-dark-900 rounded-2xl p-6 border border-dark-700/50 space-y-4">
 <div className="flex items-center justify-between">
 <div className="space-y-1">
 <h2 className="text-lg font-semibold">Mono Compatibility</h2>
 <p className="text-xs text-dark-400">
 Mono-loss % is how much <strong>energy disappears</strong> when L/R are summed — lower is better. Weighted risk amplifies low-band cancellation because that's where the damage is audible.
 </p>
 </div>
 {worsened && (
 <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
 style={{ color: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.12)' }}>
 Degraded
 </span>
 )}
 </div>

 {/* Scoring legend — helps readers understand the numbers */}
 <div className="grid grid-cols-3 gap-2 text-[10px]">
 <div className="rounded-md px-2.5 py-1.5" style={{ backgroundColor: 'rgba(110,197,119,0.10)', color: '#6ec577' }}>
 <div className="font-semibold">&lt; 5% loss</div>
 <div className="opacity-80">Excellent — mono-safe</div>
 </div>
 <div className="rounded-md px-2.5 py-1.5" style={{ backgroundColor: 'rgba(197,165,90,0.10)', color: '#c5a55a' }}>
 <div className="font-semibold">5–15% loss</div>
 <div className="opacity-80">Acceptable — narrow the widest band</div>
 </div>
 <div className="rounded-md px-2.5 py-1.5" style={{ backgroundColor: 'rgba(224,90,90,0.10)', color: '#e05a5a' }}>
 <div className="font-semibold">&gt; 15% loss</div>
 <div className="opacity-80">High risk — phone/bluetooth will suffer</div>
 </div>
 </div>

 {/* Overall risk summary */}
 <div className="grid grid-cols-2 gap-4">
 <RiskSummary label={labelA} risk={riskA} status={statusA} barColor="#6b7280" />
 <RiskSummary label={labelB} risk={riskB} status={statusB} barColor="#c5a55a" />
 </div>

 {/* Per-band waterfall — compact heatmap strip showing mono-fold
 loss percentage per frequency band at a glance. Low bands on
 the left (where damage hurts most — phone speakers), high
 bands on the right. Cell height + colour encode the loss %
 so the offending region jumps out before the user reads the
 table below. */}
 {mono.bands_b && mono.bands_b.length > 0 && (
 <MonoWaterfall
 bandsA={mono.bands_a || mono.bands_b}
 bandsB={mono.bands_b}
 labelA={labelA}
 labelB={labelB}
 />
 )}

 {/* Per-band breakdown */}
 {mono.bands_a && mono.bands_b && (
 <div className="bg-dark-800/40 rounded-xl p-3 space-y-2">
 <div className="flex items-center justify-between text-[10px] text-dark-500 px-2 pb-1 border-b border-dark-700/30">
 <span className="flex-1">Band</span>
 <span className="w-20 text-center">Impact</span>
 <span className="w-24 text-center">{labelA}</span>
 <span className="w-24 text-center">{labelB}</span>
 </div>
 {mono.bands_b.map((band, i) => {
 const bandA = mono.bands_a![i]
 return (
 <BandRow
 key={band.name}
 band={band}
 bandA={bandA}
 labelA={labelA}
 labelB={labelB}
 />
 )
 })}
 </div>
 )}

 {/* Insight */}
 <p className="text-xs text-dark-300 leading-relaxed">{mono.insight}</p>
 </div>
 )
}

function RiskSummary({
 label, risk, status, barColor,
}: {
 label: string
 risk: number
 status: { color: string; label: string }
 barColor: string
}) {
 // Cap the bar at "scale-top" = 100 so extreme risk values (>100) still
 // render inside the bar AND show an "off-scale" pill.
 const SCALE_TOP = 100
 const pct = Math.min(100, (risk / SCALE_TOP) * 100)
 const offScale = risk > SCALE_TOP

 return (
 <div className="bg-dark-800 rounded-xl p-4 space-y-3">
 <div className="flex items-center justify-between">
 <span className="text-xs font-medium" style={{ color: barColor }}>{label}</span>
 <span className="text-xs font-mono" style={{ color: status.color }}>{status.label}</span>
 </div>
 <div className="space-y-1">
 <div className="relative h-3 bg-dark-700 rounded-full overflow-hidden">
 <div className="absolute inset-0 flex opacity-20">
 <div className="w-[13%]" style={{ backgroundColor: '#6ec577' }} />
 <div className="w-[20%]" style={{ backgroundColor: '#c5a55a' }} />
 <div className="flex-1" style={{ backgroundColor: '#e05a5a' }} />
 </div>
 <div
 className="absolute top-0 bottom-0 rounded-full"
 style={{
 left: 0,
 width: `${pct}%`,
 backgroundColor: status.color,
 opacity: 0.75,
 }}
 />
 </div>
 <div className="flex justify-between text-[8px] text-dark-500">
 <span>Safe</span>
 <span>At-risk</span>
 <span>High risk</span>
 </div>
 </div>
 <div className="flex items-center justify-between text-[10px]">
 <span className="text-dark-400">Weighted risk</span>
 <div className="flex items-center gap-1.5">
 <span className="font-mono" style={{ color: status.color }}>{risk.toFixed(1)}</span>
 {offScale && (
 <span className="text-[8px] px-1 rounded" style={{ color: status.color, backgroundColor: `${status.color}20` }}>
 off-scale
 </span>
 )}
 </div>
 </div>
 </div>
 )
}

function bandFix(name: string, loss: number, correlation: number): string {
 if (loss < 5 && correlation > 0.7) return ''
 if (name === 'Sub' || name === 'Bass') {
 if (correlation < 0.3) return 'Mono-ise below 120 Hz (elliptical EQ / M-S tool) — keeps phone playback intact.'
 if (loss > 10) return 'Narrow the stereo spread on bass elements — HPF any stereo wideners / reverbs below 150 Hz.'
 }
 if (name === 'Low Mid' && loss > 15) return 'Pan-check your low-mid instruments (piano, rhodes, guitars) — spread is eating their level on mono.'
 if (name === 'Mid' && loss > 15) return 'Vocals / snare tops may be fighting. Reduce side-channel energy 500 Hz–2 kHz.'
 if (name === 'Upper' && loss > 20) return 'Lead presence getting lost in mono — tame side-band 2–6 kHz widening.'
 if (name === 'Air' && loss > 25) return 'Shimmer/air reverbs eat themselves in mono — cosmetic, low impact.'
 return ''
}

function BandRow({
 band, bandA, labelA, labelB,
}: {
 band: BandInfo
 bandA: BandInfo
 labelA: string
 labelB: string
}) {
 const colorA = lossColor(bandA.loss_pct)
 const colorB = lossColor(band.loss_pct)
 const delta = band.loss_pct - bandA.loss_pct
 const degraded = delta > 3 && band.impact >= 3
 const fixHintB = bandFix(band.name, band.loss_pct, band.correlation)

 return (
 <div className="flex items-start text-[11px] px-2 py-1.5 rounded row-hover transition-colors">
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-1.5">
 <span className="font-medium text-dark-200">{band.name}</span>
 <span className="text-[9px] text-dark-500 font-mono">{band.freq_range}</span>
 {degraded && (
 <span className="text-[8px] px-1 py-0.5 rounded" style={{ color: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)' }}>
 +{delta.toFixed(0)}%
 </span>
 )}
 </div>
 <div className="text-[9px] text-dark-500 mt-0.5">{band.note}</div>
 {fixHintB && (
 <div className="text-[10px] mt-0.5" style={{ color: '#d0b066' }}>→ {fixHintB}</div>
 )}
 </div>
 <div className="w-20 flex items-center justify-center pt-1">
 <ImpactDots impact={band.impact} />
 </div>
 <div className="w-24 flex flex-col items-center pt-0.5">
 <span className="font-mono text-[10px]" style={{ color: colorA }}>{bandA.loss_pct.toFixed(1)}%</span>
 <span className="text-[8px] text-dark-600">r={bandA.correlation.toFixed(2)}</span>
 </div>
 <div className="w-24 flex flex-col items-center pt-0.5">
 <span className="font-mono text-[10px]" style={{ color: colorB }}>{band.loss_pct.toFixed(1)}%</span>
 <span className="text-[8px] text-dark-600">r={band.correlation.toFixed(2)}</span>
 </div>
 </div>
 )
}

function ImpactDots({ impact }: { impact: number }) {
 // Map impact 0.8-5.0 to 1-5 dots
 const n = Math.min(5, Math.max(1, Math.round(impact)))
 return (
 <div className="flex items-center justify-center gap-0.5">
 {[0, 1, 2, 3, 4].map(i => (
 <span
 key={i}
 className="w-1 h-1 rounded-full"
 style={{
 backgroundColor: i < n ? '#c5a55a' : '#3e3a33',
 opacity: i < n ? 0.8 : 0.3,
 }}
 />
 ))}
 </div>
 )
}

function lossColor(loss: number): string {
 if (loss < 5) return '#6ec577'
 if (loss < 15) return '#c5a55a'
 return '#e05a5a'
}

/**
 * Waterfall strip — one vertical cell per frequency band, height and
 * colour encoding mono-fold loss percentage. Two rows (A on top, B
 * below) so engineers can see at a glance which band collapses and
 * whether B is worse than A. Low frequencies on the left (that's where
 * mono-fold damage hurts — kick / bass / sub) so the eye lands on the
 * high-impact region first.
 */
function MonoWaterfall({ bandsA, bandsB, labelA, labelB }: {
 bandsA: BandInfo[]
 bandsB: BandInfo[]
 labelA: string
 labelB: string
}) {
 // 5.3.1 honesty fix: render `risk` (post-DEADBAND), not raw
 // `loss_pct`. Decorrelated-but-mono-safe content (wide stereo
 // recordings) loses energy on a mono fold but isn't a delivery
 // problem — the side-panel risk score correctly reads "Excellent"
 // while the waterfall used to draw tall amber bars on the same
 // signal. The two surfaces disagreed; engineers complained about
 // the waterfall lighting up on clean wide masters. Now they agree.
 const maxRisk = Math.max(
 ...bandsA.map(b => b.risk || 0),
 ...bandsB.map(b => b.risk || 0),
 30, // visual floor so a 3 % risk doesn't look scary
 )
 const heightFor = (risk: number) => {
 const pct = Math.max(0, Math.min(1, risk / maxRisk))
 return `${8 + pct * 36}px` // 8px floor, 44px max
 }
 const isSingleFile = labelA === labelB
 return (
 <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(48,44,39,0.35)', border: '1px solid rgba(168,161,150,0.08)' }}>
 <div className="flex items-center justify-between mb-2">
 <span className="text-[10px] uppercase tracking-[0.12em]" style={{ color: '#7a7164' }}>
 Mono-risk waterfall
 </span>
 <span className="text-[9px] font-mono" style={{ color: '#8d867b' }}>
 low ← → high · cell = phase-cancellation risk (decorrelated wide content does not light up)
 </span>
 </div>
 <div className="space-y-1">
 {!isSingleFile && (
 <MonoWaterfallRow label={labelA} bands={bandsA} heightFor={heightFor} />
 )}
 <MonoWaterfallRow label={isSingleFile ? '' : labelB} bands={bandsB} heightFor={heightFor} />
 </div>
 </div>
 )
}
function MonoWaterfallRow({ label, bands, heightFor }: {
 label: string
 bands: BandInfo[]
 heightFor: (loss: number) => string
}) {
 return (
 <div className="flex items-end gap-1">
 {label && (
 <span className="text-[9px] font-mono w-20 flex-shrink-0 truncate" style={{ color: '#a8a29e' }}>{label}</span>
 )}
 <div className="flex-1 flex items-end gap-1" style={{ height: 48 }}>
 {bands.map((b, i) => (
 <div
 key={i}
 className="flex-1 rounded-sm transition-colors"
 style={{
 height: heightFor(b.risk || 0),
 backgroundColor: lossColor(b.risk || 0),
 opacity: 0.85,
 }}
 title={`${b.name} (${b.freq_range}) — risk ${(b.risk || 0).toFixed(1)} · raw mono loss ${(b.loss_pct || 0).toFixed(1)}% · ${b.note || ''}`}
 />
 ))}
 </div>
 </div>
 )
}
