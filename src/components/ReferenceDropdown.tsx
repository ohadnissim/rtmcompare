import React, { useEffect, useRef, useState } from 'react'
import { FileInfo } from '../types'

/**
 * Compact reference-history dropdown for the upload cover.
 *
 * 5.4.1 fix: pre-5.4.1 the upload screen showed neither saved nor
 * recent references at all (the v1 shell rendered them as a long
 * inline list; the v2 cover removed everything except the two
 * dropzones). Re-introduce the affordance as a single dropdown
 * trigger so the user can re-load any prior reference without
 * re-dragging the file from Finder, but without flooding the cover
 * with names.
 *
 * Saved (★) come first, recent below, separated by a thin rule.
 * Click a row → loads it into the target slot. Hover-state highlight
 * matches the file-drop active border. Closes on outside click or
 * Escape.
 */

interface RecentRef { path: string; name: string; lastUsed: number }
interface SavedRef { path: string; name: string; label?: string; addedAt: number }

interface Props {
 saved: SavedRef[]
 recent: RecentRef[]
 onPick: (f: FileInfo) => void
 onRemoveRecent?: (path: string) => void
 /** "Reference" or "Compare" — drives the trigger label. */
 slotLabel?: 'Reference' | 'Compare'
}

export default function ReferenceDropdown({
 saved,
 recent,
 onPick,
 onRemoveRecent,
 slotLabel = 'Reference',
}: Props) {
 const [open, setOpen] = useState(false)
 const wrapRef = useRef<HTMLDivElement>(null)

 useEffect(() => {
 if (!open) return
 const onDoc = (e: MouseEvent) => {
 if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
 }
 const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
 document.addEventListener('mousedown', onDoc)
 document.addEventListener('keydown', onKey)
 return () => {
 document.removeEventListener('mousedown', onDoc)
 document.removeEventListener('keydown', onKey)
 }
 }, [open])

 const total = saved.length + recent.length
 if (total === 0) return null  // nothing to show — keep cover clean

 return (
 <div ref={wrapRef} className="relative inline-block">
 <button
 type="button"
 onClick={() => setOpen(v => !v)}
 className="text-[10px] uppercase tracking-[0.16em] px-3 py-1.5 transition-colors"
 style={{
 borderRadius: '2px',
 color: open ? 'var(--color-accent)' : 'var(--color-text-muted)',
 border: `1px solid ${open ? 'color-mix(in srgb, var(--color-accent) 40%, transparent)' : 'var(--color-border)'}`,
 backgroundColor: 'transparent',
 }}
 aria-haspopup="menu"
 aria-expanded={open}
 title={`Re-load a previous ${slotLabel.toLowerCase()} (${total} available)`}
 >
 Load {slotLabel.toLowerCase()} ▾
 </button>

 {open && (
 <div
 role="menu"
 className="absolute left-0 z-30 mt-1 min-w-[280px] max-h-[60vh] overflow-y-auto py-1"
 style={{
 borderRadius: '2px',
 backgroundColor: 'var(--color-bg-panel)',
 border: '1px solid var(--color-border)',
 }}
 >
 {saved.length > 0 && (
 <>
 <div
 className="px-3 py-1 text-[9px] uppercase tracking-[0.18em]"
 style={{ color: 'var(--color-text-dim)' }}
 >
 Starred · {saved.length}
 </div>
 {saved.map((r) => (
 <RowButton
 key={`s-${r.path}`}
 label={r.label || r.name}
 path={r.path}
 starred
 onClick={() => { onPick({ path: r.path, name: r.name }); setOpen(false) }}
 />
 ))}
 </>
 )}

 {recent.length > 0 && (
 <>
 {saved.length > 0 && (
 <div
 className="my-1 mx-2"
 style={{ borderTop: '1px solid var(--color-border)' }}
 />
 )}
 <div
 className="px-3 py-1 text-[9px] uppercase tracking-[0.18em]"
 style={{ color: 'var(--color-text-dim)' }}
 >
 Recent · {recent.length}
 </div>
 {recent.map((r) => (
 <RowButton
 key={`r-${r.path}`}
 label={r.name}
 path={r.path}
 onClick={() => { onPick({ path: r.path, name: r.name }); setOpen(false) }}
 onRemove={onRemoveRecent ? () => onRemoveRecent(r.path) : undefined}
 />
 ))}
 </>
 )}
 </div>
 )}
 </div>
 )
}

function RowButton({
 label, path, starred, onClick, onRemove,
}: {
 label: string
 path: string
 starred?: boolean
 onClick: () => void
 onRemove?: () => void
}) {
 return (
 <div className="flex items-stretch group">
 <button
 type="button"
 onClick={onClick}
 className="flex-1 text-left px-3 py-1.5 transition-colors"
 style={{ color: 'var(--color-text-secondary)' }}
 onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--color-bg-elev)' }}
 onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent' }}
 title={path}
 >
 <span className="flex items-center gap-2 text-[11px]">
 {starred && (
 <span style={{ color: 'var(--color-accent)' }} aria-hidden="true">★</span>
 )}
 <span className="truncate">{label}</span>
 </span>
 </button>
 {onRemove && (
 <button
 type="button"
 onClick={(e) => { e.stopPropagation(); onRemove() }}
 className="px-2 opacity-0 group-hover:opacity-100 transition-opacity"
 style={{ color: 'var(--color-text-dim)' }}
 aria-label="Remove from recent"
 title="Remove from recent"
 >
 ×
 </button>
 )}
 </div>
 )
}
