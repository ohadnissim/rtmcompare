import React, { useEffect, useMemo, useRef, useState } from 'react'
import { SEARCH_INDEX, scoreEntry, SearchIndexEntry } from '../shortcuts'

interface Props {
 onClose: () => void
 onNavigate: (tabId: string) => void
}

/**
 * ⌘K / Ctrl+K command palette, value-scoped. User types a metric or term
 * ("kick", "spotify", "90 hz", "mono") and gets a ranked list of panels.
 * ↑/↓ moves selection, Enter jumps to the owning tab. Esc closes.
 *
 * Scoped to VALUES, not navigation: 7 tabs are easy to click; 50+ metrics
 * are where typing saves time.
 */
export default function CommandPalette({ onClose, onNavigate }: Props) {
 const [query, setQuery] = useState('')
 const [cursor, setCursor] = useState(0)
 const inputRef = useRef<HTMLInputElement>(null)
 const listRef = useRef<HTMLDivElement>(null)

 useEffect(() => {
 inputRef.current?.focus()
 }, [])

 // Compute the ranked result list. Show top 10 matches when the user has
 // typed something; when empty, show a "starter" list — one representative
 // entry per tab — so the palette isn't blank on open.
 const results: SearchIndexEntry[] = useMemo(() => {
 const q = query.trim()
 if (!q) {
 // Starter list: first entry of each unique tab hint, de-duped.
 const seen = new Set<string>()
 const starter: SearchIndexEntry[] = []
 for (const e of SEARCH_INDEX) {
 const key = e.hint || e.tab
 if (seen.has(key)) continue
 seen.add(key)
 starter.push(e)
 if (starter.length >= 10) break
 }
 return starter
 }
 return SEARCH_INDEX
 .map(e => ({ e, s: scoreEntry(q, e) }))
 .filter(x => x.s > 0)
 .sort((a, b) => b.s - a.s)
 .slice(0, 10)
 .map(x => x.e)
 }, [query])

 // Reset cursor to 0 whenever the query changes.
 useEffect(() => { setCursor(0) }, [query])

 // Keep the selected row visible as the cursor moves.
 useEffect(() => {
 const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)
 el?.scrollIntoView({ block: 'nearest' })
 }, [cursor])

 const pick = (e: SearchIndexEntry) => {
 onNavigate(e.tab)
 }

 return (
 <div
 className="fixed inset-0 z-[95] flex items-start justify-center"
 style={{ backgroundColor: 'rgba(14,13,11,0.55)', backdropFilter: 'blur(6px)' }}
 onClick={onClose}
 >
 <div
 className="w-full max-w-xl mx-4 mt-[12vh] rounded-2xl overflow-hidden"
 style={{
 backgroundColor: '#151411',
 border: '1px solid rgba(208,176,102,0.25)',
 boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
 }}
 onClick={(e) => e.stopPropagation()}
 >
 {/* Search input */}
 <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid rgba(168,161,150,0.08)' }}>
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#d0b066" strokeWidth={1.8}>
 <circle cx="10.5" cy="10.5" r="6.5" />
 <path strokeLinecap="round" d="M20 20l-4-4" />
 </svg>
 <input
 ref={inputRef}
 value={query}
 onChange={(e) => setQuery(e.target.value)}
 onKeyDown={(e) => {
 if (e.key === 'Escape') { onClose() }
 else if (e.key === 'ArrowDown') {
 e.preventDefault()
 setCursor(c => Math.min(results.length - 1, c + 1))
 } else if (e.key === 'ArrowUp') {
 e.preventDefault()
 setCursor(c => Math.max(0, c - 1))
 } else if (e.key === 'Enter') {
 e.preventDefault()
 const picked = results[cursor]
 if (picked) pick(picked)
 }
 }}
 placeholder="Search metrics: kick, spotify, 90 hz, mono…"
 data-palette-input="1"
 className="flex-1 bg-transparent outline-none text-sm"
 style={{ color: '#ebe7e0' }}
 />
 <kbd className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: '#6a6459', border: '1px solid rgba(168,161,150,0.15)' }}>
 Esc
 </kbd>
 </div>

 {/* Results */}
 <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
 {results.length === 0 && (
 <div className="px-5 py-6 text-center text-[12px]" style={{ color: '#6a6459' }}>
 No matches. Try "lufs", "kick", "spotify", "mono", "atmos"…
 </div>
 )}
 {results.map((r, i) => {
 const active = i === cursor
 return (
 <button
 key={i}
 data-idx={i}
 onMouseEnter={() => setCursor(i)}
 onClick={() => pick(r)}
 className="w-full flex items-center justify-between px-5 py-2.5 text-left transition-colors"
 style={{
 backgroundColor: active ? 'rgba(208,176,102,0.08)' : 'transparent',
 borderLeft: `2px solid ${active ? '#d0b066' : 'transparent'}`,
 }}
 >
 <div className="flex items-center gap-3 min-w-0">
 <span
 className="text-[11px] uppercase tracking-[0.12em] w-24 flex-shrink-0"
 style={{ color: active ? '#d0b066' : '#7a7164' }}
 >
 {r.hint || r.tab}
 </span>
 <span
 className="text-sm truncate"
 style={{ color: active ? '#ebe7e0' : '#a8a29e' }}
 >
 {r.label}
 </span>
 </div>
 {active && (
 <span className="text-[10px] uppercase tracking-[0.1em]" style={{ color: '#d0b066' }}>
 ↵ jump
 </span>
 )}
 </button>
 )
 })}
 </div>

 {/* Footer hints */}
 <div className="flex items-center justify-between px-5 py-2.5 text-[10px]"
 style={{ borderTop: '1px solid rgba(168,161,150,0.08)', color: '#6a6459' }}>
 <span>Type to filter · ↑↓ to move · ↵ to jump</span>
 <span className="font-mono">⌘K to reopen</span>
 </div>
 </div>
 </div>
 )
}
