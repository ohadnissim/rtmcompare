import React from 'react'

/**
 * Tiny "2:43.825" pill used wherever we need to surface track length —
 * overview header, Atmos info, single-file view. Atmos deliveries are
 * tightly bound to exact duration (sync to picture, broadcast slot fits,
 * dialog timing) so length needs to be visible everywhere AND at
 * millisecond precision — broadcast and OTT specs call out frame-accurate
 * lengths that round-to-second numbers will hide.
 */

/** Compact "2:43" form — for tight inline use where ms is overkill. */
export function formatDurationShort(seconds: number | undefined | null): string {
 if (seconds == null || isNaN(seconds as number) || (seconds as number) <= 0) return '—'
 const s = Math.round(seconds as number)
 const mins = Math.floor(s / 60)
 const secs = s % 60
 return `${mins}:${secs.toString().padStart(2, '0')}`
}

/** Full "2:43.825" form (mm:ss.SSS) — the default everywhere now. */
export function formatDuration(seconds: number | undefined | null): string {
 if (seconds == null || isNaN(seconds as number) || (seconds as number) <= 0) return '—'
 const total = seconds as number
 const mins = Math.floor(total / 60)
 const wholeSecs = Math.floor(total - mins * 60)
 const ms = Math.round((total - mins * 60 - wholeSecs) * 1000)
 // Carry milliseconds when rounding tips them to 1000.
 let s = wholeSecs
 let m = mins
 let outMs = ms
 if (outMs >= 1000) { outMs = 0; s += 1 }
 if (s >= 60) { s -= 60; m += 1 }
 return `${m}:${s.toString().padStart(2, '0')}.${outMs.toString().padStart(3, '0')}`
}

interface Props {
 seconds?: number | null
 /** Optional label shown to the left of the time, e.g. "Length" or filename. */
 label?: string
 /** Optional accent color (defaults to neutral). Used to tint A vs B. */
 tint?: string
 /** Compact = tighter padding for inline use in dense headers. */
 compact?: boolean
}

export default function DurationPill({ seconds, label, tint, compact }: Props) {
 const value = formatDuration(seconds)
 const color = tint || '#a8a29e'
 return (
 <span
 className={`inline-flex items-center gap-1.5 rounded-full ${compact ? 'px-2 py-0.5' : 'px-2.5 py-1'}`}
 style={{
 backgroundColor: 'rgba(87,83,78,0.18)',
 border: '1px solid rgba(168,161,150,0.1)',
 }}
 title={seconds != null && !isNaN(seconds) ? `${(seconds as number).toFixed(2)} seconds` : 'Duration unknown'}
 >
 <svg className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={2}>
 <circle cx="12" cy="12" r="9" />
 <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
 </svg>
 {label && (
 <span className={`uppercase tracking-[0.12em] ${compact ? 'text-[8px]' : 'text-[9px]'}`} style={{ color: '#7a7164' }}>
 {label}
 </span>
 )}
 <span className={`font-mono tabular-nums ${compact ? 'text-[10px]' : 'text-[11px]'}`} style={{ color }}>
 {value}
 </span>
 </span>
 )
}
