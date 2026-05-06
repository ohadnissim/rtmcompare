import React, { useMemo, useState } from 'react'
import { HistoryEntry, FileInfo } from '../types'

interface Props {
 history: HistoryEntry[]
 /** Fired when the user clicks an entry — the caller decides whether to
 * populate slot A, slot B, or both. Passing the raw entry keeps the
 * component presentational. */
 onPick: (entry: HistoryEntry, slot: 'A' | 'B') => void
 /** Clear the whole log. */
 onClear?: () => void
}

/**
 * "Recent analyses" card — shows the last N distinct files the user has
 * analysed, with their LUFS / TP / LRA / length at analysis time. Clicking
 * an entry's primary label loads it as Reference A (the most common use:
 * "compare my new mix against my previous version"); the tiny B badge
 * loads it into slot B instead.
 *
 * Kept deliberately quiet visually — sits below the Saved / Recent refs
 * library. The entire block collapses when the log is empty.
 */
export default function RecentAnalyses({ history, onPick, onClear }: Props) {
 const [expanded, setExpanded] = useState(false)

 // Collapse to the most recent entry per file-SHA so a track analysed 10
 // times in a row doesn't drown the list. Sorted newest first, capped at
 // 12 (expand to show up to 50).
 const rows = useMemo(() => {
 const byHash = new Map<string, HistoryEntry>()
 for (const e of history) {
 const existing = byHash.get(e.sha256)
 if (!existing || (e.ts || 0) > (existing.ts || 0)) byHash.set(e.sha256, e)
 }
 const list = Array.from(byHash.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0))
 return expanded ? list.slice(0, 50) : list.slice(0, 12)
 }, [history, expanded])

 if (history.length === 0) return null

 const fmtTime = (ts: number) => {
 const diff = Date.now() - ts
 const m = Math.floor(diff / 60000)
 if (m < 1) return 'just now'
 if (m < 60) return `${m}m ago`
 const h = Math.floor(m / 60)
 if (h < 24) return `${h}h ago`
 const d = Math.floor(h / 24)
 if (d < 14) return `${d}d ago`
 return new Date(ts).toLocaleDateString()
 }

 const fmtDur = (s?: number) => {
 if (s == null) return ''
 const mins = Math.floor(s / 60)
 const secs = Math.floor(s - mins * 60)
 return `${mins}:${secs.toString().padStart(2, '0')}`
 }

 return (
 <div className="space-y-2">
 <div className="flex items-center justify-between">
 <span className="text-[10px] uppercase tracking-[0.15em] text-sand-500">Recent analyses</span>
 <div className="flex items-center gap-3">
 <span className="text-[10px] text-sand-400">
 {history.length} total · click to load as Reference
 </span>
 {onClear && (
 <button
 onClick={() => { if (confirm('Clear the entire history log?')) onClear() }}
 className="text-[10px] text-sand-400 hover:text-warm-red transition-colors"
 title="Clear the whole history log"
 >
 clear
 </button>
 )}
 </div>
 </div>
 <div className="space-y-1">
 {rows.map((e) => {
 const entries = history.filter(h => h.sha256 === e.sha256).sort((a, b) => (b.ts || 0) - (a.ts || 0))
 const versions = entries.length
 const file: FileInfo = { path: e.path, name: e.name }
 return (
 <div
 key={e.sha256 + e.ts}
 className="group flex items-center gap-2 rounded-lg px-3 py-2 transition-colors"
 style={{ backgroundColor: 'rgba(87,83,78,0.12)', border: '1px solid rgba(168,161,150,0.08)' }}
 >
 {/* Main label — loads as Reference A */}
 <button
 onClick={() => onPick(e, 'A')}
 className="flex-1 text-left min-w-0"
 title={`${e.path}\nAnalysed ${new Date(e.ts).toLocaleString()}${e.ref_name ? `\nvs ${e.ref_name}` : ''}`}
 >
 <div className="flex items-center gap-2 min-w-0">
 <span className="text-[11px] text-sand-300 truncate">
 {e.name.replace(/\.[^/.]+$/, '')}
 </span>
 {versions > 1 && (
 <span className="text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0"
 style={{ color: '#d0b066', backgroundColor: 'rgba(208,176,102,0.08)' }}>
 {versions} versions
 </span>
 )}
 </div>
 <div className="flex items-center gap-2 mt-0.5 text-[9px] font-mono text-sand-400">
 {e.lufs != null && <span>{e.lufs.toFixed(1)} LUFS</span>}
 {e.true_peak != null && (
 <span>
 {e.true_peak.toFixed(1)} dBTP
 </span>
 )}
 {e.lra != null && <span>{e.lra.toFixed(1)} LU</span>}
 {e.duration_sec != null && <span>{fmtDur(e.duration_sec)}</span>}
 <span className="text-sand-400">· {fmtTime(e.ts)}</span>
 </div>
 </button>
 {/* Tiny B-slot badge — loads into the Compare slot instead */}
 <button
 onClick={() => onPick(e, 'B')}
 className="opacity-0 group-hover:opacity-100 text-[9px] uppercase tracking-[0.1em] px-2 py-1 rounded transition-all flex-shrink-0"
 style={{ color: '#d0b066', border: '1px solid rgba(208,176,102,0.25)' }}
 title="Load this file into the Compare slot (B) instead of Reference (A)"
 >
 → B
 </button>
 </div>
 )
 })}
 </div>
 {!expanded && history.length > 12 && (
 <button
 onClick={() => setExpanded(true)}
 className="text-[10px] text-sand-500 hover:text-sand-300 transition-colors"
 >
 Show more ({history.length - 12})
 </button>
 )}
 </div>
 )
}
