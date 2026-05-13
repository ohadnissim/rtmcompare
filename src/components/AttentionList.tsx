import React from 'react'
import { AttentionItem } from '../singleFileHelpers'

/**
 * Consolidated attention list — clickable rows. Any item with `jumpSec`
 * set (a click at a timestamp, a hum detection etc.) seeks the shared
 * audio transport on click. "Right now I scroll past it" → we now render
 * above the transport and scrubber so it's the first thing the user
 * meets after the verdict.
 */
export default function AttentionList({ items, onJump }: {
 items: AttentionItem[]
 onJump?: (sec: number) => void
}) {
 if (items.length === 0) {
 return (
 <div className="text-[11px] font-display italic" style={{ color: 'var(--color-text-muted)' }}>
 No artefacts flagged. Limiter, hum, clicks, mono compatibility — all within spec.
 </div>
 )
 }

 const [head, ...rest] = items

 const renderRow = (it: AttentionItem, i: number, opts: { size: 'lg' | 'sm' }) => {
 const accent = it.severity === 'hold' ? 'var(--color-danger)' : it.severity === 'warn' ? 'var(--color-warning)' : 'var(--color-sand-400)'
 const isClickable = !!(it.jumpSec != null && onJump)
 const sizeCls = opts.size === 'lg' ? 'text-[14px]' : 'text-[11px]'
 const borderWidth = opts.size === 'lg' ? '2px' : '2px'
 return (
 <li key={i} className="min-w-0">
 <button
 onClick={isClickable ? () => onJump!(it.jumpSec!) : undefined}
 className={`w-full text-left flex items-start gap-2 py-1 transition-colors ${sizeCls} ${isClickable ? 'hover:bg-white/[0.04]' : ''}`}
 style={{
 borderRadius: '2px',
 color: 'var(--color-sand-300)',
 cursor: isClickable ? 'pointer' : 'default',
 borderLeft: `${borderWidth} solid ${accent}`,
 paddingLeft: '8px',
 paddingRight: '8px',
 }}
 disabled={!isClickable}
 title={isClickable ? 'Click to jump transport to this moment' : undefined}
 >
 <span className="flex-1 min-w-0 break-words">{it.message}</span>
 {it.jumpSec != null && (
 <span className="text-[9px] font-mono" style={{ color: accent }}>
 {fmtT(it.jumpSec)}
 </span>
 )}
 </button>
 </li>
 )
 }

 return (
 <ul className="space-y-1">
 {renderRow(head, 0, { size: 'lg' })}
 {rest.map((it, i) => renderRow(it, i + 1, { size: 'sm' }))}
 </ul>
 )
}

function fmtT(t: number): string {
 const m = Math.floor(t / 60)
 const s = Math.floor(t - m * 60)
 return `${m}:${s.toString().padStart(2, '0')}`
}
