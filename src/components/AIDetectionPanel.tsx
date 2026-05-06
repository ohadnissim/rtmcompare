import React, { useState } from 'react'
import { AIDetection } from '../types'

interface Props {
 detection: AIDetection
}

// 5.3.1: verdict labels softened to match what the math actually delivers.
// `python/ai_detector.py:5-7` declares "the output is a risk index, not a
// forensic probability ... `probability` remains an alias of `risk_score_raw`
// until a calibrated mapping ships." Calibration corpus is currently 13
// samples (deployment_ready: false). UI must therefore say "risk", not
// "detected." A delivery decision belongs with a human.
const VERDICT_COLORS = {
 likely_human: { color: '#6ec577', bg: 'rgba(110,197,119,0.1)', label: 'Low AI risk' },
 uncertain:    { color: '#e07a4f', bg: 'rgba(224,122,79,0.1)', label: 'Review' },
 likely_ai:    { color: '#e05a5a', bg: 'rgba(224,90,90,0.1)',  label: 'High AI risk' },
}

// 5.3.x: provenance + calibration badges. The vendored UAI ensemble
// is genuinely calibrated (Lambda-validated F1 0.998); the legacy
// heuristic kept as fallback is uncalibrated. The panel shows which
// engine produced the verdict so engineers don't conflate the two.
const METHOD_BADGE: Record<string, { label: string; tip: string; color: string; bg: string }> = {
 'uai_v1.4': {
 label: 'CALIBRATED · v1.4',
 tip: 'UAI 24-detector calibrated ensemble. Lambda-validated F1 0.998, Lyria-3 OOD recall 0.978, Jamendo human FPR 0.85%. Probability is a real calibrated value, not a heuristic alias. Still review flagged elements manually before any decision.',
 color: '#6ec577',
 bg: 'rgba(110,197,119,0.10)',
 },
 'rtm_v1_heuristic': {
 label: 'HEURISTIC · v1',
 tip: 'Legacy heuristic detector — probability is an alias of an uncalibrated risk index, not a real probability. The vendored UAI ensemble was unavailable on this run; check the dev log for the reason. Treat all scores as advisory.',
 color: '#c5a55a',
 bg: 'rgba(197,165,90,0.10)',
 },
 'unavailable': {
 label: 'UNAVAILABLE',
 tip: 'Both detectors errored on this run. AI detection panel is showing zero scores as a placeholder; see the dev log.',
 color: '#c96765',
 bg: 'rgba(201,103,101,0.10)',
 },
}

export default function AIDetectionPanel({ detection }: Props) {
 const stemVerdicts = detection.stem_verdicts || []
 const hasFlags = stemVerdicts.some(s => s.verdict !== 'likely_human')
 const method = detection.method ?? 'rtm_v1_heuristic'
 const badge = METHOD_BADGE[method] ?? METHOD_BADGE['rtm_v1_heuristic']
 const isCalibrated = method === 'uai_v1.4'
 // 4-way verdict (UAI native: 'Human' / 'AI Generated' / 'Hybrid' /
 // 'Unknown'). The 3-way `verdict` collapses Hybrid → likely_ai for
 // back-compat; show the 4-way form here so engineers see the
 // honest answer.
 const fourWay = detection.track_verdict_4way

 return (
 <div className="bg-dark-900 rounded-2xl p-6 border border-dark-700/50 space-y-5">
 {/* Header — calibration badge + 4-way verdict + max stem chip. */}
 <div className="flex items-start justify-between gap-3">
 <div className="space-y-1">
 <div className="flex items-center gap-2">
 <span
 className="text-[9px] uppercase tracking-[0.18em] px-1.5 py-0.5 rounded font-semibold"
 style={{ color: badge.color, backgroundColor: badge.bg, border: `1px solid ${badge.color}40` }}
 title={badge.tip}
 >
 {badge.label}
 </span>
 {fourWay && (
 <span
 className="text-[10px] uppercase tracking-[0.14em]"
 style={{ color: '#a8a29e' }}
 title="UAI's native four-way verdict. The summary below collapses Hybrid onto 'High AI risk' for backwards compatibility."
 >
 {fourWay}
 </span>
 )}
 </div>
 {detection.max_stem_name && detection.max_stem_score != null && (
 <div className="text-[10px] text-dark-500 font-mono">
 Loudest stem risk: <span style={{ color: '#ebe7e0' }}>{detection.max_stem_name}</span>{' '}
 {(detection.max_stem_score * 100).toFixed(0)}%
 {detection.instrumental_aggregate != null && (
 <span className="ml-3">
 Instr. agg: <span style={{ color: '#ebe7e0' }}>{(detection.instrumental_aggregate * 100).toFixed(0)}%</span>
 </span>
 )}
 </div>
 )}
 </div>
 </div>

 {/* Per-stem verdicts — the main display */}
 {stemVerdicts.length > 0 ? (
 <div className="space-y-2">
 {stemVerdicts.map((sv, i) => {
 const config = VERDICT_COLORS[sv.verdict]
 const pct = Math.round(sv.score * 100)
 return (
 <StemRow
  key={i}
  stem={sv.stem}
  verdict={sv.verdict}
  score={pct}
  detail={sv.detail}
  config={config}
  fourWay={detection.stem_4way_classes?.[sv.stem]}
 />
 )
 })}
 </div>
 ) : (
 /* Fallback: show mix-level checks if no stems */
 <div className="space-y-2">
 {[...detection.checks]
 .sort((a, b) => b.score - a.score)
 .map((check, i) => (
 <CheckBar key={i} check={check} />
 ))
 }
 </div>
 )}

 {/* Mix-level details (collapsible) */}
 {stemVerdicts.length > 0 && detection.checks.length > 0 && (
 <MixDetails checks={detection.checks} />
 )}

 <div
 className="text-[10px] text-dark-600 leading-relaxed"
 title={isCalibrated
 ? 'UAI v1.4 calibrated ensemble — probability is a real calibrated value (Lambda-validated F1 0.998, Jamendo human FPR 0.85%). Still review flagged elements manually before any decision; calibration is good but not forensic-grade.'
 : 'Legacy heuristic — probability is an uncalibrated alias of risk_score_raw. Calibration corpus is small (13 samples; deployment_ready: false). Always review flagged elements manually before any decision.'}
 >
 {isCalibrated
 ? 'Calibrated ensemble (UAI v1.4) — high confidence on instrumental + vocal stems, but still review flagged elements manually.'
 : 'Heuristic risk index — not a calibrated probability. Always review flagged elements manually.'}
 </div>
 </div>
 )
}

function StemRow({ stem, verdict, score, detail, config, fourWay }: {
 stem: string; verdict: string; score: number; detail: string;
 config: { color: string; bg: string; label: string };
 fourWay?: string;
}) {
 const [expanded, setExpanded] = useState(false)

 return (
 <div
 className="rounded-lg overflow-hidden"
 style={{
 backgroundColor: verdict === 'likely_human' ? 'rgba(26,25,24,0.5)' : config.bg,
 border: verdict === 'likely_human' ? 'none' : `1px solid ${config.color}22`,
 }}
 >
 <button
 onClick={() => setExpanded(!expanded)}
 className="w-full flex items-center gap-3 px-4 py-3 text-left"
 >
 {/* Verdict badge */}
 <span
 className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
 style={{ color: config.color, backgroundColor: config.bg }}
 >
 {config.label}
 </span>

 {/* Stem name + UAI's 4-way classification (subtle, monospace) */}
 <span className="flex-shrink-0 w-28 flex items-baseline gap-1.5">
 <span className="text-sm font-medium text-dark-200 capitalize">
 {stem}
 </span>
 {fourWay && (
 <span
 className="text-[8px] font-mono uppercase tracking-[0.10em]"
 style={{ color: '#7a7164' }}
 title="UAI's per-stem 4-way classification (Human / AI Generated / Hybrid / Unknown)"
 >
 {fourWay}
 </span>
 )}
 </span>

 {/* Score bar */}
 <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#1a1918' }}>
 <div
 className="h-full rounded-full"
 style={{ width: `${Math.max(2, score)}%`, backgroundColor: config.color, opacity: 0.6 }}
 />
 </div>

 <span className="text-[10px] font-mono w-8 text-right flex-shrink-0" style={{ color: config.color }}>
 {score}%
 </span>

 <svg
 className="w-3 h-3 flex-shrink-0 transition-transform"
 style={{ color: '#8d867b', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
 fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
 >
 <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
 </svg>
 </button>

 {expanded && (
 <div className="px-4 pb-3 pl-24">
 <p className="text-[10px] text-dark-500">{detail}</p>
 </div>
 )}
 </div>
 )
}

function MixDetails({ checks }: { checks: { name: string; score: number; detail: string; weight: number }[] }) {
 const [open, setOpen] = useState(false)
 const mixChecks = checks.filter(c => !c.name.includes('Stem') && !c.name.includes('Vocal'))

 if (mixChecks.length === 0) return null

 return (
 <div>
 <button
 onClick={() => setOpen(!open)}
 className="text-[10px] text-dark-500 hover:text-dark-400 flex items-center gap-1"
 >
 <svg
 className="w-2.5 h-2.5 transition-transform"
 style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
 fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
 >
 <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
 </svg>
 Mix-level analysis
 </button>
 {open && (
 <div className="mt-2 space-y-1.5">
 {mixChecks.sort((a, b) => b.score - a.score).map((check, i) => (
 <CheckBar key={i} check={check} />
 ))}
 </div>
 )}
 </div>
 )
}

function CheckBar({ check }: { check: { name: string; score: number; detail: string; weight: number; probes_run?: number; probes_total?: number } }) {
 const [expanded, setExpanded] = useState(false)
 const pct = Math.round(check.score * 100)
 const color = check.score >= 0.5 ? '#e05a5a' : check.score >= 0.3 ? '#e07a4f' : check.score >= 0.1 ? '#f59e0b' : '#6ec577'
 // When the backend reports partial probe coverage, flag the row so
 // the user knows this particular score is low-confidence.
 const lowCoverage = check.probes_run != null && check.probes_total != null && check.probes_run < check.probes_total
 const coverageRatio = lowCoverage ? `${check.probes_run}/${check.probes_total}` : null

 return (
 <div
 className="rounded-lg overflow-hidden cursor-pointer"
 style={{ backgroundColor: 'rgba(26,25,24,0.5)' }}
 onClick={() => setExpanded(!expanded)}
 >
 <div className="flex items-center gap-3 px-4 py-2">
 <span className="text-[11px] text-dark-400 w-36 flex-shrink-0">{check.name}</span>
 <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#1a1918' }}>
 <div className="h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, backgroundColor: color, opacity: 0.5 }} />
 </div>
 {coverageRatio && (
 <span
  className="text-[9px] font-mono px-1.5 py-0.5 rounded"
  style={{ color: '#d0b066', border: '1px solid rgba(208,176,102,0.3)' }}
  title="Probe coverage — not all sub-tests finished. Interpret the score with caution."
 >
  {coverageRatio}
 </span>
 )}
 <span className="text-[10px] font-mono w-8 text-right" style={{ color }}>{pct}%</span>
 </div>
 {expanded && (
 <div className="px-4 pb-2">
 <p className="text-[10px] text-dark-500">{check.detail}</p>
 </div>
 )}
 </div>
 )
}
