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
 <div className="text-[11px] italic" style={{ color: '#6ec577' }}>
 No issues detected. Track is clean.
 </div>
 )
 }
 return (
 <ul className="space-y-1 text-[11px]">
 {items.map((it, i) => {
 const accent = it.severity === 'hold' ? '#e05a5a' : it.severity === 'warn' ? '#c5a55a' : '#a8a29e'
 const isClickable = !!(it.jumpSec != null && onJump)
 return (
 <li key={i}>
 <button
 onClick={isClickable ? () => onJump!(it.jumpSec!) : undefined}
 className={`w-full text-left flex items-start gap-2 px-2 py-1 transition-colors ${isClickable ? 'hover:bg-white/[0.04]' : ''}`}
 style={{ borderRadius: '2px', color: '#b5afa4', cursor: isClickable ? 'pointer' : 'default' }}
 disabled={!isClickable}
 title={isClickable ? 'Click to jump transport to this moment' : undefined}
 >
 <span style={{ color: accent }}>⚠</span>
 <span className="flex-1">{it.message}</span>
 {it.jumpSec != null && (
 <span className="text-[9px] font-mono" style={{ color: accent }}>
 {fmtT(it.jumpSec)} ↗
 </span>
 )}
 </button>
 </li>
 )
 })}
 </ul>
 )
}

function fmtT(t: number): string {
 const m = Math.floor(t / 60)
 const s = Math.floor(t - m * 60)
 return `${m}:${s.toString().padStart(2, '0')}`
}
