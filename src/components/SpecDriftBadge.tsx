import React, { useState, useEffect, useRef } from 'react'
import type { SpecVersions } from '../types'
import { currentSpecsVersion, diffSpecVersions, specDriftSummary } from '../specsCompare'

interface Props {
 analysisVersion?: number | null
 stampedSpecs?: SpecVersions | null
}

export default function SpecDriftBadge({ analysisVersion, stampedSpecs }: Props) {
 const [open, setOpen] = useState(false)
 const triggerRef = useRef<HTMLButtonElement | null>(null)
 const dialogRef = useRef<HTMLDivElement | null>(null)
 const closeBtnRef = useRef<HTMLButtonElement | null>(null)

 // 5.3.0 a11y: focus trap + Escape to close + return focus on close.
 // Standard modal-dialog hygiene the prior audit flagged.
 useEffect(() => {
 if (!open) return
 const previouslyFocused = document.activeElement as HTMLElement | null
 // Move focus into the dialog.
 closeBtnRef.current?.focus()
 const onKey = (e: KeyboardEvent) => {
 if (e.key === 'Escape') {
 e.preventDefault()
 setOpen(false)
 return
 }
 if (e.key !== 'Tab' || !dialogRef.current) return
 const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
 'a[href], area[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
 )
 if (!focusables.length) return
 const first = focusables[0]
 const last = focusables[focusables.length - 1]
 if (e.shiftKey && document.activeElement === first) {
 e.preventDefault()
 last.focus()
 } else if (!e.shiftKey && document.activeElement === last) {
 e.preventDefault()
 first.focus()
 }
 }
 document.addEventListener('keydown', onKey)
 return () => {
 document.removeEventListener('keydown', onKey)
 // Return focus to the trigger that opened the dialog.
 try { (previouslyFocused || triggerRef.current)?.focus?.() } catch {}
 }
 }, [open])

 if (analysisVersion == null || analysisVersion === currentSpecsVersion) return null

 const deltas = diffSpecVersions(stampedSpecs)
 const title = specDriftSummary(stampedSpecs)

 return (
 <>
 <button
 ref={triggerRef}
 type="button"
 onClick={() => setOpen(true)}
 className="inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-[10px] font-medium"
 style={{
 color: '#e07a4f',
 backgroundColor: 'rgba(224,122,79,0.10)',
 border: '1px solid rgba(224,122,79,0.35)',
 }}
 title={title}
 >
 Spec v{analysisVersion}{' -> '}v{currentSpecsVersion} — re-run analysis to see updated platform targets
 </button>

 {open && (
 <div
 className="fixed inset-0 z-[120] flex items-center justify-center p-6"
 style={{ backgroundColor: 'rgba(14,13,11,0.82)', backdropFilter: 'blur(6px)' }}
 role="dialog"
 aria-modal="true"
 aria-label="Spec drift details"
 onClick={() => setOpen(false)}
 >
 <div
 ref={dialogRef}
 className="w-full max-w-2xl rounded-xl p-5"
 style={{ backgroundColor: '#1e1c18', border: '1px solid rgba(168,161,150,0.18)', color: '#ebe7e0' }}
 onClick={(e) => e.stopPropagation()}
 >
 <div className="flex items-start justify-between gap-4">
 <div>
 <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: '#e07a4f' }}>Spec drift</div>
 <h3 className="mt-1 text-lg font-medium">Spec v{analysisVersion}{' -> '}v{currentSpecsVersion}</h3>
 </div>
 <button
 ref={closeBtnRef}
 type="button"
 onClick={() => setOpen(false)}
 aria-label="Close spec drift details"
 className="rounded-md px-2 py-1 text-[11px]"
 style={{ color: '#a8a196', border: '1px solid rgba(168,161,150,0.18)' }}
 >
 Close
 </button>
 </div>

 <p className="mt-3 text-[12px]" style={{ color: '#a8a196' }}>
 This analysis was checked against an older standards registry. Re-run analysis before signing off delivery targets.
 </p>

 <div className="mt-4 max-h-[55vh] overflow-auto space-y-2">
 {deltas.length > 0 ? deltas.map(delta => (
 <div
 key={delta.id}
 className="rounded-lg p-3"
 style={{ backgroundColor: 'rgba(48,44,39,0.55)', border: '1px solid rgba(168,161,150,0.10)' }}
 >
 <div className="flex items-center justify-between gap-3">
 <span className="text-[12px] font-medium">{delta.name}</span>
 <span className="text-[9px] font-mono" style={{ color: '#7a7164' }}>{delta.id}</span>
 </div>
 <ul className="mt-2 space-y-1">
 {delta.changed.map((line, index) => (
 <li key={index} className="text-[11px] font-mono" style={{ color: '#d9d4c8' }}>{line}</li>
 ))}
 </ul>
 </div>
 )) : (
 <div className="rounded-lg p-3 text-[12px]" style={{ backgroundColor: 'rgba(48,44,39,0.55)', color: '#d9d4c8' }}>
 The global registry version changed, but the stamped per-spec payload does not show target-level differences.
 </div>
 )}
 </div>
 </div>
 </div>
 )}
 </>
 )
}
