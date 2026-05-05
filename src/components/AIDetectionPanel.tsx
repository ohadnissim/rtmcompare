import React, { useState } from 'react'
import { AIDetection } from '../types'

interface Props {
 detection: AIDetection
}

const VERDICT_COLORS = {
 likely_human: { color: '#6ec577', bg: 'rgba(110,197,119,0.1)', label: 'Human' },
 uncertain: { color: '#e07a4f', bg: 'rgba(224,122,79,0.1)', label: 'Review' },
 likely_ai: { color: '#e05a5a', bg: 'rgba(224,90,90,0.1)', label: 'AI Detected' },
}

export default function AIDetectionPanel({ detection }: Props) {
 const stemVerdicts = detection.stem_verdicts || []
 const hasFlags = stemVerdicts.some(s => s.verdict !== 'likely_human')

 return (
 <div className="bg-dark-900 rounded-2xl p-6 border border-dark-700/50 space-y-5">
 {/* Per-stem verdicts — the main display */}
 {stemVerdicts.length > 0 ? (
 <div className="space-y-2">
 {stemVerdicts.map((sv, i) => {
 const config = VERDICT_COLORS[sv.verdict]
 const pct = Math.round(sv.score * 100)
 return (
 <StemRow key={i} stem={sv.stem} verdict={sv.verdict} score={pct} detail={sv.detail} config={config} />
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

 <div className="text-[10px] text-dark-600 leading-relaxed">
 Heuristic screening — not forensic-grade. Heavy processing can trigger false positives. Flagged elements should be reviewed manually.
 </div>
 </div>
 )
}

function StemRow({ stem, verdict, score, detail, config }: {
 stem: string; verdict: string; score: number; detail: string;
 config: { color: string; bg: string; label: string }
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

 {/* Stem name */}
 <span className="text-sm font-medium text-dark-200 capitalize flex-shrink-0 w-20">
 {stem}
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
