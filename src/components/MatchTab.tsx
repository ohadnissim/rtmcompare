import React, { useState, useMemo, useEffect } from 'react'
import { AnalysisResult, FileInfo, ChainTips } from '../types'
import MatchReferenceEQPanel, { Band } from './MatchReferenceEQPanel'
import EngineerTipsPanel from './EngineerTipsPanel'
import ReferenceMatchEQFromLibrary from './ReferenceMatchEQFromLibrary'
import MasterAssistantPanel from './MasterAssistantPanel'

type Mode = 'reference' | 'engineer' | 'hybrid' | 'library' | 'assistant' | 'chain'

interface Props {
 results: AnalysisResult
 fileB?: FileInfo
 labelA: string
 labelB: string
}

/**
 * Unified Match tab — replaces the old standalone "Match Reference Tips" and
 * "What Would [Engineer] Do" tabs with a single surface and a segmented
 * mode switcher:
 *
 * • Reference → EQ moves derived from the two-file spectrum + stem diff.
 * • Engineer → Opinionated moves from the loaded engineer profile's
 * target curve.
 * • Hybrid → Reference moves plus any engineer-profile bands that
 * don't overlap (within 1/2 octave) — the best of both
 * worlds when the reference is a sibling track but you
 * also want the engineer's signature.
 *
 * The two panels share 90% of their UI (chips → live EQ preview → export),
 * so collapsing them into one tab removes a false workflow fork. Engineer
 * mode is hidden entirely when no profile tips came back from the backend
 * (e.g. profile was "off" at scan time).
 */
export default function MatchTab({ results, fileB, labelA, labelB }: Props) {
 const hasEngineer = !!results.engineer_tips
 const hasChain = !!results.chain_tips
 const [mode, setMode] = useState<Mode>('reference')
 // Listen for the '✦ Assistant' header button so it can deep-link directly
 // to this mode without the user needing to click the mode picker.
 useEffect(() => {
 const handler = (e: Event) => {
 const detail = (e as CustomEvent<{ mode: Mode }>).detail
 if (detail?.mode) setMode(detail.mode)
 }
 window.addEventListener('rtm-match-mode', handler)
 return () => window.removeEventListener('rtm-match-mode', handler)
 }, [])

 // hasResults: true when the analysis produced actionable EQ recommendations.
 // The mode picker collapses to an "Advanced ▾" disclosure when false so the
 // tab doesn't look busy before the user has anything to act on.
 // MED-6 fix: removed `|| !!results.spectrum_a`. spectrum_a is populated
 // immediately after file load (just the FFT), so the old condition made
 // hasResults true before match recommendations were ready, surfacing an
 // empty mode picker. Gate solely on recommendations.
 const hasResults = !!(results.recommendations && results.recommendations.length > 0)

 // Engineer profile bands shaped like the Match panel's Band type, so they
 // can be mixed into Hybrid's derivation.
 const engineerBands: Band[] = useMemo(() => {
 const filters = results.engineer_tips?.eq_filters || []
 return filters.map(f => ({
 freq: f.freq,
 gain_db: f.gain_db,
 q: f.q,
 region: f.region || 'Engineer',
 source: 'engineer' as const,
 }))
 }, [results.engineer_tips])

 const modePicker = (
 <div className="flex items-center justify-center">
 <div
 className="inline-flex items-center gap-1 p-1 rounded-sm"
 style={{ backgroundColor: 'rgba(48,44,39,0.5)', border: '1px solid rgba(168,161,150,0.12)' }}
 >
 <ModePill
 active={mode === 'reference'}
 onClick={() => setMode('reference')}
 label="Reference"
 hint="Moves derived from your two-file comparison"
 />
 <ModePill
 active={mode === 'engineer'}
 onClick={() => hasEngineer && setMode('engineer')}
 label="Engineer"
 hint={hasEngineer
 ? `Opinionated moves from ${results.engineer_tips?.engineer || 'the loaded engineer'}'s profile`
 : "Load an engineer profile at scan time — required for engineer-specific matching"}
 disabled={!hasEngineer}
 />
 <ModePill
 active={mode === 'hybrid'}
 onClick={() => hasEngineer && setMode('hybrid')}
 label="Hybrid"
 hint={hasEngineer
 ? "Reference moves plus non-overlapping engineer profile bands"
 : "Requires an engineer profile"}
 disabled={!hasEngineer}
 />
 <ModePill
 active={mode === 'library'}
 onClick={() => setMode('library')}
 label="Library"
 hint="Match the tonal balance of any reference in your personal library"
 />
 <ModePill
 active={mode === 'assistant'}
 onClick={() => setMode('assistant')}
 label="Assistant"
 hint="One-click: compose gain → EQ → TP limiter → dither for a specific DSP target, preview live, render."
 />
 <ModePill
 active={mode === 'chain'}
 onClick={() => setMode('chain')}
 label="⛓ Delta"
 hint={hasChain
 ? `Preview where this mix lands after ${results.chain_tips?.engineer || 'the loaded engineer'}'s mastering chain`
 : "Select a Delta profile before analysis to see chain prediction"}
 />
 </div>
 </div>
 )

 return (
 <div className="space-y-5">
 {/* Segmented control — show inline when results exist; collapse to an
   "Advanced ▾" disclosure before the user has anything to act on so
   the tab doesn't look busy on first open. */}
 {hasResults ? modePicker : (
 <details style={{ textAlign: 'center' }}>
 <summary
 style={{
 fontSize: 11,
 color: 'var(--color-text-muted)',
 cursor: 'pointer',
 listStyle: 'none',
 display: 'inline-flex',
 alignItems: 'center',
 gap: 4,
 userSelect: 'none',
 }}
 >
 ⚙ Analysis mode (Advanced)
 </summary>
 <div style={{ marginTop: 8 }}>
 {modePicker}
 </div>
 </details>
 )}

 {/* Body — one panel at a time, same aesthetic either way. */}
 {mode === 'reference' && (
 <MatchReferenceEQPanel
 recommendations={results.recommendations || []}
 categories={results.categories}
 specA={results.spectrum_a}
 specB={results.spectrum_b}
 refLufs={results.overall?.lufs_a}
 fileB={fileB}
 labelA={labelA}
 labelB={labelB}
 />
 )}

 {mode === 'engineer' && results.engineer_tips && (
 <EngineerTipsPanel tips={results.engineer_tips} fileB={fileB} />
 )}

 {mode === 'hybrid' && results.engineer_tips && (
 <MatchReferenceEQPanel
 recommendations={results.recommendations || []}
 categories={results.categories}
 specA={results.spectrum_a}
 specB={results.spectrum_b}
 refLufs={results.overall?.lufs_a}
 fileB={fileB}
 labelA={labelA}
 labelB={labelB}
 extraBands={engineerBands}
 title="Hybrid moves"
 subtitle={<>Reference-derived EQ plus <span className="text-dark-200">{results.engineer_tips.engineer || 'loaded engineer'}</span>'s signature where they don't overlap.</>}
 />
 )}

 {mode === 'library' && (
 <ReferenceMatchEQFromLibrary
 currentSpectrum={results.spectrum_b}
 currentLabel={labelB}
 />
 )}

 {mode === 'assistant' && (
 <MasterAssistantPanel
 result={results}
 fileB={fileB}
 label={labelB}
 />
 )}

 {mode === 'chain' && (
 results.chain_tips
   ? <ChainTipsPanel tips={results.chain_tips} />
   : (
     <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
       <div className="text-2xl opacity-30">⛓</div>
       <div className="text-sm font-medium" style={{ color: 'var(--color-text-dim)' }}>No delta data for this session</div>
       <div className="text-xs max-w-xs" style={{ color: 'var(--color-text-muted)' }}>
         Load a delta profile, select it in the top-right dropdown, then re-run the analysis.
       </div>
       {window.electronAPI?.loadCustomProfile && (
         <button
           onClick={async () => {
             try { await window.electronAPI?.loadCustomProfile?.() } catch {}
           }}
           className="text-[11px] px-4 py-2 mt-2 transition-colors"
           style={{ backgroundColor: 'rgba(208,176,102,0.12)', color: 'var(--color-accent)', border: '1px solid rgba(208,176,102,0.35)', borderRadius: '2px' }}
         >
           Load delta profile…
         </button>
       )}
     </div>
   )
 )}
 </div>
 )
}

// ─── Chain Tips Panel ────────────────────────────────────────────────────────

const FREQ_LABELS = ['20','25','31.5','40','50','63','80','100','125','160','200','250','315','400','500','630','800','1k','1.25k','1.6k','2k','2.5k','3.15k','4k','5k','6.3k','8k','10k','12.5k','16k','20k']

function ChainTipsPanel({ tips }: { tips: ChainTips }) {
 const w = 800, h = 200
 const pad = { top: 10, bottom: 25, left: 5, right: 5 }
 const gw = w - pad.left - pad.right
 const gh = h - pad.top - pad.bottom

 const allVals = [...tips.spectrum_file, ...tips.spectrum_after_chain].filter(v => v > -50)
 const maxDb = allVals.length > 0 ? Math.max(...allVals) + 2 : 0
 const minDb = allVals.length > 0 ? Math.min(...allVals) - 2 : -20

 const toX = (i: number) => pad.left + (i / Math.max(1, tips.spectrum_file.length - 1)) * gw
 const toY = (v: number) => pad.top + (1 - (v - minDb) / (maxDb - minDb)) * gh
 const makePath = (data: number[]) => data.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
 const labelIndices = [0, 4, 8, 12, 16, 20, 24, 28, 30]

 return (
 <div className="space-y-4">
 <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-3" style={{ borderRadius: '2px' }}>
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <span className="text-xs font-medium text-dark-300">Chain Prediction</span>
 <span className="text-[10px] text-dark-500">— where this mix lands after {tips.engineer}'s mastering chain</span>
 </div>
 <div className="flex items-center gap-3 text-[9px]">
 <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded" style={{ backgroundColor: '#6b8cbb' }} /> This mix</span>
 <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded" style={{ backgroundColor: '#d4a843' }} /> After chain</span>
 </div>
 </div>
 <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: '180px' }} preserveAspectRatio="none">
 {[0, -5, -10, -15, -20].map(db => (
 <g key={db}>
 <line x1={pad.left} y1={toY(db)} x2={w - pad.right} y2={toY(db)} stroke="#2a2927" strokeWidth="0.5" />
 <text x={pad.left + 2} y={toY(db) - 3} fontSize="7" fill="#4a4845">{db} dB</text>
 </g>
 ))}
 <path d={makePath(tips.spectrum_after_chain)} fill="none" stroke="#d4a843" strokeWidth="2" opacity="0.85" />
 <path d={makePath(tips.spectrum_file)} fill="none" stroke="#6b8cbb" strokeWidth="2" />
 {labelIndices.map(i => (
 i < FREQ_LABELS.length && <text key={i} x={toX(i)} y={h - 3} textAnchor="middle" fontSize="7" fill="#57534e">{FREQ_LABELS[i]}</text>
 ))}
 </svg>
 <div className="text-[10px] text-dark-500">
 Delta from {tips.pair_count} mix/master pair{tips.pair_count === 1 ? '' : 's'} — gold = predicted master position (blue + chain delta).
 Max shift: {Math.max(0, ...tips.eq_curve.filter((v): v is number => v !== null).map(Math.abs)).toFixed(1)} dB.
 </div>
 </div>
 </div>
 )
}

function ModePill({ active, onClick, label, hint, disabled }: {
 active: boolean
 onClick: () => void
 label: string
 hint: string
 disabled?: boolean
}) {
 return (
 <button
 onClick={onClick}
 disabled={disabled}
 title={hint}
 className="text-[11px] px-4 py-1.5 rounded-sm transition-all uppercase tracking-[0.14em] disabled:cursor-not-allowed"
 style={{
 backgroundColor: active ? 'rgba(208,176,102,0.15)' : 'transparent',
 color: disabled ? 'var(--color-sand-600)' : active ? 'var(--color-accent)' : 'var(--color-sand-300)',
 border: `1px solid ${active ? 'rgba(208,176,102,0.4)' : 'transparent'}`,
 fontWeight: active ? 500 : 400,
 }}
 >
 {label}
 </button>
 )
}
