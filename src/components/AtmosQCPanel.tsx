import React, { useState } from 'react'
import { AtmosQC, AtmosQCCheck } from '../types'
import InfoTooltip from './InfoTooltip'

interface Props {
 qc: AtmosQC
 // When specified, filter the checks list:
 // 'atmos-only' → hide checks whose name starts with "Downmix" (those belong in the Downmix tab)
 // 'downmix-only' → only show Downmix checks
 scope?: 'atmos-only' | 'downmix-only' | 'all'
}

const STATUS_CONFIG = {
 pass: { color: 'var(--color-success)', bg: 'rgba(111,163,126,0.12)', icon: '✓', label: 'Pass' },
 warning: { color: 'var(--color-accent)', bg: 'rgba(208,176,102,0.12)', icon: '⚠', label: 'Warning' },
 fail: { color: 'var(--color-danger)', bg: 'rgba(201,103,101,0.14)', icon: '✕', label: 'Fail' },
}

function CheckRow({ check }: { check: AtmosQCCheck }) {
 const [expanded, setExpanded] = useState(false)
 const config = STATUS_CONFIG[check.status]

 return (
 <div
 className="overflow-hidden"
 style={{ borderRadius: '2px', backgroundColor: 'rgba(26,25,24,0.5)', border: `1px solid ${check.status === 'pass' ? 'transparent' : config.bg}` }}
 >
 <button
 onClick={() => check.suggestion ? setExpanded(!expanded) : null}
 className="w-full flex items-center gap-3 px-4 py-2.5 text-left"
 >
 {/* Status icon */}
 <span
 className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold flex-shrink-0"
 style={{ backgroundColor: config.bg, color: config.color }}
 >
 {config.icon}
 </span>

 {/* Name + message */}
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2">
 <span className="text-xs font-medium text-dark-200">{check.name}</span>
 <span className="text-[10px] font-mono" style={{ color: config.color }}>{check.value}</span>
 </div>
 <p className="text-[10px] text-dark-500 mt-0.5 truncate">{check.message}</p>
 </div>

 {/* Target */}
 <span className="text-[10px] text-dark-600 flex-shrink-0 hidden sm:block">
 {check.target}
 </span>

 {/* Expand arrow */}
 {check.suggestion && (
 <svg
 className="w-3 h-3 flex-shrink-0 transition-transform"
 style={{ color: 'var(--color-text-muted)', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
 fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
 >
 <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
 </svg>
 )}
 </button>

 {/* Expanded suggestion */}
 {expanded && check.suggestion && (
 <div className="px-4 pb-3 pl-12">
 <p className="text-[11px] font-display italic" style={{ color: '#8a8580' }}>
 {check.suggestion}
 </p>
 </div>
 )}
 </div>
 )
}

export default function AtmosQCPanel({ qc, scope = 'all' }: Props) {
 const overallConfig = STATUS_CONFIG[qc.status]
 // Filter checks by scope. Downmix-scoped checks are the ones whose names
 // start with "Downmix" or "Binaural" (the binaural TP is a downmix-ish
 // concern too — it's what listeners on headphones actually hear).
 const isDownmixCheck = (name: string) => /^(downmix|binaural)/i.test(name)
 const scopedChecks = qc.checks.filter(c => {
 if (scope === 'atmos-only') return !isDownmixCheck(c.name)
 if (scope === 'downmix-only') return isDownmixCheck(c.name)
 return true
 })
 const failCount = scopedChecks.filter(c => c.status === 'fail').length
 const warnCount = scopedChecks.filter(c => c.status === 'warning').length
 const passCount = scopedChecks.filter(c => c.status === 'pass').length

 return (
 <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-5" style={{ borderRadius: '2px' }}>
 {/* Header: status + score */}
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-4">
 {/* Score circle */}
 <div className="relative w-14 h-14">
 <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
 <path
 d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
 fill="none"
 stroke="#2a2927"
 strokeWidth="3"
 />
 <path
 d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
 fill="none"
 stroke={overallConfig.color}
 strokeWidth="3"
 strokeDasharray={`${qc.score}, 100`}
 strokeLinecap="round"
 />
 </svg>
 <div className="absolute inset-0 flex items-center justify-center">
 <span className="text-sm font-bold" style={{ color: overallConfig.color }}>
 {qc.score}
 </span>
 </div>
 </div>

 <div>
 <div className="flex items-center gap-2">
 <span
 className="text-xs font-semibold px-2 py-0.5 rounded-full"
 style={{ color: overallConfig.color, backgroundColor: overallConfig.bg }}
 >
 {overallConfig.label}
 </span>
 <h2 className="text-lg">Dolby Atmos QC</h2>
 </div>
 <p className="text-xs text-dark-400 mt-0.5">{qc.summary}</p>
 </div>
 </div>

 {/* Count badges */}
 <div className="flex items-center gap-2">
 {failCount > 0 && (
 <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: 'var(--color-danger)', backgroundColor: 'rgba(224,90,90,0.1)' }}>
 {failCount} fail
 </span>
 )}
 {warnCount > 0 && (
 <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: 'var(--color-data-warn)', backgroundColor: 'rgba(224,122,79,0.1)' }}>
 {warnCount} warn
 </span>
 )}
 <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: 'var(--color-data-pass)', backgroundColor: 'rgba(110,197,119,0.1)' }}>
 {passCount} pass
 </span>
 </div>
 </div>

 {/* Specs grid */}
 <div className="grid grid-cols-4 sm:grid-cols-7 gap-3 py-3 border-y border-dark-700/30">
 <SpecBox label="Loudness" value={`${qc.specs.loudness_lufs} LUFS`} />
 <SpecBox label="True Peak" value={`${qc.specs.true_peak_dbtp} dBTP`} />
 <SpecBox label="Sample Rate" value={`${qc.specs.sample_rate / 1000} kHz`} />
 <SpecBox label="Bit Depth" value={`${qc.specs.bit_depth}-bit`} />
 <SpecBox label="Channels" value={`${qc.specs.channel_count}ch`} />
 <SpecBox label="Layout" value={qc.specs.layout} />
 <SpecBox label="Duration" value={formatDuration(qc.specs.duration_sec)} />
 </div>

 {/* Checks list — failures first, then warnings, then passes */}
 <div className="space-y-1.5">
 {[...scopedChecks]
 .sort((a, b) => {
 const order = { fail: 0, warning: 1, pass: 2 }
 return (order[a.status] ?? 2) - (order[b.status] ?? 2)
 })
 .map((check, i) => (
 <CheckRow key={i} check={check} />
 ))
 }
 {scopedChecks.length === 0 && (
 <div className="text-[11px] text-dark-500 font-display italic px-3 py-2">No checks in this scope.</div>
 )}
 </div>

 {/* Channel stats */}
 {qc.channel_stats.silent_channels.length > 0 && (
 <div className="text-[10px] text-dark-500 flex items-center gap-2">
 <span>Silent bed channels:</span>
 <span className="text-dark-400">{qc.channel_stats.silent_channels.join(', ')}</span>
 </div>
 )}
 </div>
 )
}

function SpecBox({ label, value }: { label: string; value: string }) {
 return (
 <div className="text-center">
 <div className="text-[10px] text-dark-600 uppercase tracking-wider">{label}</div>
 <div className="text-xs font-mono text-dark-300 mt-0.5">{value}</div>
 </div>
 )
}

function formatDuration(sec: number): string {
 const m = Math.floor(sec / 60)
 const s = Math.round(sec % 60)
 return `${m}:${s.toString().padStart(2, '0')}`
}
