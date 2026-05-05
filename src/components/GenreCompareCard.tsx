import React from 'react'

interface Genre {
 primary: string
 confidence: number
 candidates?: { name: string; score: number }[]
}

interface Props {
 a?: Genre
 b?: Genre
 labelA: string
 labelB: string
}

/**
 * Compact side-by-side genre read for the compare view. Shows the primary
 * genre per file plus a confidence bar and the top 2 runner-up candidates
 * so users can tell "Pop (74) vs Electronic (65)" from "Pop (74) vs Pop
 * (72)" at a glance.
 */
export default function GenreCompareCard({ a, b, labelA, labelB }: Props) {
 const sameGenre = a && b && a.primary === b.primary

 return (
 <div className="rounded-xl p-4 h-full" style={{ backgroundColor: 'rgba(48,44,39,0.4)', border: '1px solid rgba(168,161,150,0.08)' }}>
 <div className="flex items-center gap-2 mb-3">
 <span className="text-[10px] tracking-widest uppercase" style={{ color: '#968d7e' }}>Genre</span>
 {sameGenre && (
 <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ color: '#6ec577', backgroundColor: 'rgba(110,197,119,0.1)' }}>
 match
 </span>
 )}
 </div>

 <div className="space-y-3">
 {a && <GenreRow genre={a} label={labelA} tint="#6b8cbb" />}
 {b && <GenreRow genre={b} label={labelB} tint="#d0b066" />}
 </div>

 {a && b && !sameGenre && (
 <p className="text-[10px] italic mt-3" style={{ color: '#7a7164' }}>
 Different primary genres — if these should feel alike, check the biggest deltas in the EQ / dynamics panels.
 </p>
 )}
 </div>
 )
}

function GenreRow({ genre, label, tint }: { genre: Genre; label: string; tint: string }) {
 // Backend returns confidence in 0-1; tolerate 0-100 too in case future
 // detectors use a different scale.
 const raw = genre.confidence ?? 0
 const pct = raw <= 1 ? Math.round(raw * 100) : Math.round(raw)
 const clamped = Math.max(0, Math.min(100, pct))
 const runners = (genre.candidates || [])
 .filter(c => c.name !== genre.primary)
 .slice(0, 2)
 return (
 <div className="space-y-1.5">
 <div className="flex items-center justify-between gap-2">
 <span className="text-[10px] font-mono truncate" style={{ color: tint, maxWidth: '15ch' }} title={label}>
 {label}
 </span>
 <span className="text-[10px] font-mono tabular-nums" style={{ color: '#a8a29e' }}>
 {clamped}%
 </span>
 </div>
 <div className="text-sm font-medium" style={{ color: '#e7e5e4' }}>
 {genre.primary || 'Unclear'}
 </div>
 <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}>
 <div className="h-full rounded-full" style={{ width: `${clamped}%`, backgroundColor: tint, opacity: 0.8 }} />
 </div>
 {runners.length > 0 && (
 <div className="flex items-center gap-2 text-[9px]" style={{ color: '#7a7164' }}>
 {runners.map((c, i) => (
 <span key={i} className="truncate">
 {c.name} <span className="font-mono">{Math.round(c.score)}</span>
 </span>
 ))}
 </div>
 )}
 </div>
 )
}
