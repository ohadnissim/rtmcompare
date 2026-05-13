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
 const containerRef = useRef<HTMLDivElement>(null)
 // Capture the element that had focus before the palette opened so we
 // can restore it when the palette closes. Without this, dismissing with
 // Escape drops keyboard focus entirely — the next keystroke (Space)
 // triggers whatever was focused before the modal opened (e.g. the play button).
 const previousFocusRef = useRef<Element | null>(null)

 useEffect(() => {
 previousFocusRef.current = document.activeElement
 inputRef.current?.focus()
 return () => {
 // Restore focus to the element that was active before the palette opened.
 const prev = previousFocusRef.current
 if (prev && (prev as HTMLElement).focus) {
 (prev as HTMLElement).focus()
 }
 }
 }, [])

 // Focus trap: keep Tab / Shift+Tab cycling within the palette container.
 const handleKeyDownContainer = (e: React.KeyboardEvent<HTMLDivElement>) => {
 if (e.key !== 'Tab') return
 const container = containerRef.current
 if (!container) return
 const focusable = container.querySelectorAll<HTMLElement>(
 'input, button, [tabindex]:not([tabindex="-1"])'
 )
 if (focusable.length === 0) return
 const first = focusable[0]
 const last = focusable[focusable.length - 1]
 if (e.shiftKey) {
 if (document.activeElement === first) { e.preventDefault(); last.focus() }
 } else {
 if (document.activeElement === last) { e.preventDefault(); first.focus() }
 }
 }

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
 style={{ backgroundColor: 'rgba(14,13,11,0.55)' }}
 onClick={onClose}
 >
 <div
 ref={containerRef}
 role="dialog"
 aria-modal="true"
 aria-label="Command palette"
 className="w-full max-w-xl mx-4 mt-[12vh] overflow-hidden"
 style={{
 borderRadius: '2px',
 backgroundColor: 'var(--color-sand-900)',
 border: '1px solid rgba(168,161,150,0.12)',
 }}
 onClick={(e) => e.stopPropagation()}
 onKeyDown={handleKeyDownContainer}
 >
 {/* Search input */}
 <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid rgba(168,161,150,0.08)' }}>
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="var(--color-accent)" strokeWidth={1.8}>
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
 style={{ color: 'var(--color-text-primary)' }}
 />
 <kbd className="text-[10px] px-1.5 py-0.5" style={{ borderRadius: '2px', color: 'var(--color-text-secondary)', border: '1px solid rgba(168,161,150,0.15)' }}>
 Esc
 </kbd>
 </div>

 {/* Results */}
 <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
 {!query.trim() && results.length > 0 && (
 <div className="px-5 pt-3 pb-1 text-[10px] uppercase tracking-[0.16em]" style={{ color: 'var(--color-text-muted)' }}>
 Type a metric, platform, or panel name
 </div>
 )}
 {results.length === 0 && (
 <div className="px-5 py-6">
 <div className="pl-3 border-l-2 text-left text-[12px]" style={{ borderColor: 'var(--color-sand-700)', color: 'var(--color-text-secondary)' }}>
 No matches. Try "lufs", "kick", "spotify", "mono", "atmos"…
 </div>
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
 borderLeft: `2px solid ${active ? 'var(--color-accent)' : 'transparent'}`,
 }}
 >
 <div className="flex items-center gap-3 min-w-0">
 <span
 className="text-[11px] uppercase tracking-[0.14em] w-24 flex-shrink-0"
 style={{ color: active ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
 >
 {r.hint || r.tab}
 </span>
 <span
 className="text-sm truncate"
 style={{ color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}
 >
 {r.label}
 </span>
 </div>
 {active && (
 <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-muted)' }}>
 ↵ jump
 </span>
 )}
 </button>
 )
 })}
 </div>

 {/* Footer hints */}
 <div className="flex items-center justify-between px-5 py-2.5 text-[10px]"
 style={{ borderTop: '1px solid rgba(168,161,150,0.08)', color: 'var(--color-text-secondary)' }}>
 <span>Type to filter · ↑↓ to move · ↵ to jump</span>
 <span className="font-mono">⌘K to reopen</span>
 </div>
 </div>
 </div>
 )
}
