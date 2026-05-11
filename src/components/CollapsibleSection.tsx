import React, { useState, useEffect } from 'react'
import InfoTooltip from './InfoTooltip'
import { useModes } from '../ModesContext'

export interface GlossaryEntry {
 /** The term as it appears in the panel (e.g. "LUFS-I"). */
 term: string
 /** 1-2 sentence plain-language definition. */
 def: string
}

interface Props {
 title: string
 tooltip: string
 badge?: React.ReactNode
 defaultOpen?: boolean
 why?: string
 /**
 * Consolidated glossary for this panel. When provided, the inline `?`
 * tooltip icon is replaced with a `?` button that opens a right-side
 * sheet containing the panel's overview + every term defined once, in
 * one place. Replaces per-metric InfoTooltip spam.
 */
 glossary?: GlossaryEntry[]
 children: React.ReactNode
}

export default function CollapsibleSection({ title, tooltip, badge, why, glossary, children }: Props) {
 // Note on `defaultOpen` (kept in Props for backwards compat with every
 // call site): this component is misnamed — it has never actually
 // collapsed. We tried adding a real fold in 5.7.x but Mike preferred
 // the original always-open behaviour ("just like the other windows")
 // because every panel in the rest of the app shows its content by
 // default and the chevron made the page feel emptier on first paint.
 // The prop stays accepted-but-ignored so existing callers don't break.
 // When educator mode is on, show the `why` text inline under the title.
 const { educator } = useModes()
 const explainer = why || tooltip
 const [sheetOpen, setSheetOpen] = useState(false)
 const hasGlossary = !!(glossary && glossary.length > 0)

 return (
 <div className="overflow-visible" style={{ backgroundColor: 'rgba(30,28,24,0.4)', border: '1px solid rgba(168,161,150,0.08)' }}>
 <div className="flex items-center justify-between px-6 pt-5 pb-3">
 <div className="flex items-center gap-2">
 <h2 className="text-lg font-semibold">{title}</h2>
 {hasGlossary ? (
 <button
 onClick={() => setSheetOpen(true)}
 className="w-5 h-5 flex items-center justify-center text-[11px] transition-colors hover:bg-white/[0.06]"
 style={{ borderRadius: '2px', color: '#8d867b', border: '1px solid rgba(168,161,150,0.2)' }}
 title="Open panel glossary"
 aria-label={`Open ${title} glossary`}
 >
 ?
 </button>
 ) : (
 <InfoTooltip text={tooltip} />
 )}
 </div>
 {badge}
 </div>
 {educator && explainer && (
 <div className="px-6 pb-3 -mt-2">
 <div className="text-[11px] leading-relaxed px-3 py-2"
 style={{ borderRadius: '2px', backgroundColor: 'rgba(111,163,126,0.06)', color: '#8bb598', borderLeft: '2px solid #6fa37e' }}>
 <span className="text-[9px] uppercase tracking-[0.15em] mr-2" style={{ color: '#6fa37e' }}>Why this matters</span>
 {explainer}
 </div>
 </div>
 )}
 <div className="px-6 pb-5 space-y-4">
 {children}
 </div>

 {hasGlossary && sheetOpen && (
 <GlossarySheet
 title={title}
 overview={tooltip}
 why={why}
 entries={glossary!}
 onClose={() => setSheetOpen(false)}
 />
 )}
 </div>
 )
}

/**
 * Right-side glossary sheet — the "one ? per panel" replacement for dozens
 * of tiny inline tooltips. Appears on click, dims the rest of the UI, and
 * dismisses on Esc / click-outside / close button.
 */
function GlossarySheet({ title, overview, why, entries, onClose }: {
 title: string
 overview: string
 why?: string
 entries: GlossaryEntry[]
 onClose: () => void
}) {
 useEffect(() => {
 const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
 window.addEventListener('keydown', onKey)
 return () => window.removeEventListener('keydown', onKey)
 }, [onClose])

 return (
 <div
 className="fixed inset-0 z-[90] flex justify-end"
 style={{ backgroundColor: 'rgba(14,13,11,0.6)' }}
 onClick={onClose}
 >
 <div
 className="h-full w-full max-w-md flex flex-col"
 style={{
 backgroundColor: '#151411',
 borderLeft: '1px solid rgba(208,176,102,0.25)',
 }}
 onClick={(e) => e.stopPropagation()}
 >
 <div className="px-6 py-5 flex items-start justify-between" style={{ borderBottom: '1px solid rgba(168,161,150,0.1)' }}>
 <div>
 <div className="text-[10px] tracking-[0.2em] uppercase mb-1" style={{ color: '#d0b066' }}>Glossary</div>
 <h3 className="text-lg" style={{ color: '#f5f2ed', fontWeight: 300 }}>{title}</h3>
 </div>
 <button
 onClick={onClose}
 className="text-sand-500 hover:text-sand-200 transition-colors text-lg leading-none"
 title="Close (Esc)"
 aria-label="Close glossary"
 >×</button>
 </div>

 <div className="px-6 py-4 space-y-3" style={{ borderBottom: '1px solid rgba(168,161,150,0.08)' }}>
 <p className="text-[12px] leading-relaxed" style={{ color: '#a8a29e' }}>{overview}</p>
 {why && (
 <p className="text-[11px] leading-relaxed italic" style={{ color: '#8d867b' }}>{why}</p>
 )}
 </div>

 <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
 {entries.map((e, i) => (
 <div key={i} className="space-y-1">
 <div className="text-[11px] font-mono" style={{ color: '#d0b066' }}>{e.term}</div>
 <div className="text-[12px] leading-relaxed" style={{ color: '#b5afa4' }}>{e.def}</div>
 </div>
 ))}
 </div>

 <div className="px-6 py-3 text-[10px] text-right" style={{ borderTop: '1px solid rgba(168,161,150,0.08)', color: '#a8a29e' }}>
 Esc or click outside to close
 </div>
 </div>
 </div>
 )
}
