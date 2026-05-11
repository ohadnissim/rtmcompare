import React, { useEffect, useMemo, useRef, useState } from 'react'
import { BatchResult } from '../types'

/**
 * ⌘K / Ctrl+K quick-switcher for the album batch view.
 *
 * Fuzzy-search the loaded batch by track title / artist / filename /
 * track number and jump straight to that song's tab. Mirrors the
 * Compare-view CommandPalette's UX (↑/↓/Enter/Esc) but scoped to song
 * navigation inside the current album — the payoff at presentation
 * time is "type 'vert' → Enter → land on the song" instead of
 * hunting through a long tab strip or scrolling the table.
 *
 * Scoring: case-insensitive substring match with tiny position bonus
 * (earlier matches rank higher). Kept intentionally dumb + deterministic
 * so there's no dependency on a fuzzy-match library and the ranking
 * reads obvious to the user.
 */
interface Props {
 songs: BatchResult[]
 displayName: (r: BatchResult) => string
 onClose: () => void
 onJump: (path: string) => void
}

interface ScoredRow {
 row: BatchResult
 score: number
 label: string
 sub: string
}

function score(query: string, hay: string): number {
 if (!query) return 0
 const q = query.toLowerCase()
 const h = hay.toLowerCase()
 const idx = h.indexOf(q)
 if (idx < 0) return -1
 // Higher score = better. 1000 base - position penalty - length penalty.
 return 1000 - idx * 2 - Math.max(0, h.length - q.length)
}

export default function SongQuickSwitcher({ songs, displayName, onClose, onJump }: Props) {
 const [query, setQuery] = useState('')
 const [cursor, setCursor] = useState(0)
 const inputRef = useRef<HTMLInputElement>(null)
 const listRef = useRef<HTMLDivElement>(null)

 useEffect(() => { inputRef.current?.focus() }, [])

 const results: ScoredRow[] = useMemo(() => {
 const q = query.trim()
 const rows = songs.map((row) => {
 const label = displayName(row)
 const sub = [row.artist, row.filename].filter(Boolean).join(' · ')
 if (!q) return { row, score: 0, label, sub }
 const titleScore = score(q, label)
 const artistScore = score(q, row.artist || '') - 50
 const fileScore = score(q, row.filename) - 100
 const trackScore = score(q, row.track_number || '') - 25
 const best = Math.max(titleScore, artistScore, fileScore, trackScore)
 return { row, score: best, label, sub }
 })
 const filtered = q
 ? rows.filter(r => r.score >= 0).sort((a, b) => b.score - a.score)
 : rows.slice(0, 20)
 return filtered.slice(0, 20)
 }, [query, songs, displayName])

 useEffect(() => { setCursor(0) }, [query])

 useEffect(() => {
 const onKey = (e: KeyboardEvent) => {
 if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
 if (e.key === 'ArrowDown') {
 e.preventDefault()
 setCursor(c => Math.min(results.length - 1, c + 1))
 return
 }
 if (e.key === 'ArrowUp') {
 e.preventDefault()
 setCursor(c => Math.max(0, c - 1))
 return
 }
 if (e.key === 'Enter') {
 e.preventDefault()
 const pick = results[cursor]
 if (pick) { onJump(pick.row.path); onClose() }
 return
 }
 }
 window.addEventListener('keydown', onKey)
 return () => window.removeEventListener('keydown', onKey)
 }, [results, cursor, onClose, onJump])

 // Keep the highlighted item scrolled into view on ↑/↓.
 useEffect(() => {
 const node = listRef.current?.children[cursor] as HTMLElement | undefined
 if (node) node.scrollIntoView({ block: 'nearest' })
 }, [cursor])

 return (
 <div
 className="fixed inset-0 z-[200] flex items-start justify-center pt-28"
 style={{ backgroundColor: 'rgba(10,9,8,0.72)' }}
 onMouseDown={onClose}
 >
 <div
 className="w-[640px] max-w-[92vw] overflow-hidden"
 style={{
 borderRadius: '2px',
 backgroundColor: '#151411',
 border: '1px solid rgba(208,176,102,0.35)',
 }}
 onMouseDown={e => e.stopPropagation()}
 >
 <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: 'rgba(168,161,150,0.12)' }}>
 <span className="text-[10px] uppercase tracking-[0.2em]" style={{ color: '#d0b066' }}>⌘K</span>
 <input
 ref={inputRef}
 value={query}
 onChange={e => setQuery(e.target.value)}
 placeholder="Jump to song: title, artist, filename, track #"
 className="flex-1 bg-transparent outline-none text-[14px]"
 style={{ color: '#ebe7e0' }}
 />
 <span className="text-[9px] tracking-[0.15em] uppercase" style={{ color: '#8d867b' }}>esc to close</span>
 </div>
 <div ref={listRef} className="max-h-[360px] overflow-y-auto py-2">
 {results.length === 0 && (
 <div className="px-5 py-6 text-[12px] italic" style={{ color: '#7a7164' }}>
 No songs matching "{query.trim()}".
 </div>
 )}
 {results.map((r, i) => (
 <button
 key={r.row.path}
 onClick={() => { onJump(r.row.path); onClose() }}
 onMouseEnter={() => setCursor(i)}
 className="w-full text-left px-5 py-2.5 flex items-center gap-3"
 style={{
 backgroundColor: i === cursor ? 'rgba(208,176,102,0.1)' : 'transparent',
 borderLeft: `2px solid ${i === cursor ? '#d0b066' : 'transparent'}`,
 }}
 >
 <span className="font-mono text-[10px] w-8 flex-shrink-0" style={{ color: '#7a7164' }}>
 {r.row.track_number || '—'}
 </span>
 <span className="flex-1 text-[13px] truncate" style={{ color: '#ebe7e0' }}>
 {r.label}
 </span>
 <span className="text-[10px] truncate max-w-[40%]" style={{ color: '#7a7164' }}>
 {r.sub}
 </span>
 </button>
 ))}
 </div>
 <div className="px-5 py-2 text-[9px] flex items-center gap-4" style={{ color: '#8d867b', borderTop: '1px solid rgba(168,161,150,0.08)' }}>
 <span><kbd className="font-mono" style={{ color: '#a8a29e' }}>↑</kbd> / <kbd className="font-mono" style={{ color: '#a8a29e' }}>↓</kbd> navigate</span>
 <span><kbd className="font-mono" style={{ color: '#a8a29e' }}>↵</kbd> open</span>
 <span><kbd className="font-mono" style={{ color: '#a8a29e' }}>esc</kbd> close</span>
 </div>
 </div>
 </div>
 )
}
