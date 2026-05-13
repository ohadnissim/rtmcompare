import React, { useState, useMemo, useEffect } from 'react'
import { AnalysisResult, FileInfo } from '../types'
import MatchReferenceEQPanel, { Band } from './MatchReferenceEQPanel'
import EngineerTipsPanel from './EngineerTipsPanel'
import ReferenceMatchEQFromLibrary from './ReferenceMatchEQFromLibrary'
import MasterAssistantPanel from './MasterAssistantPanel'

type Mode = 'reference' | 'engineer' | 'hybrid' | 'library' | 'assistant'

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
 const [mode, setMode] = useState<Mode>(hasEngineer ? 'reference' : 'reference')
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
 const hasResults = (results.recommendations && results.recommendations.length > 0) || !!results.spectrum_a

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
 className="inline-flex items-center gap-1 p-1 rounded-full"
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
 className="text-[11px] px-4 py-1.5 rounded-full transition-all uppercase tracking-[0.14em] disabled:cursor-not-allowed"
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
