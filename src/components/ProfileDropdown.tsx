import React, { useEffect, useRef, useState } from 'react'

/**
 * Compact engineer-profile picker for the main upload screen.
 *
 * 5.7.0 restore: the profile dropdown was on the cover in earlier
 * versions but got removed when the v2 shell stripped everything
 * except the two dropzones. Bringing it back so the user can switch
 * between the bundled "Ohad" profile and any user-loaded custom
 * profiles before kicking off an analysis. Without this, the user
 * has to dig into a sub-menu to change profiles.
 *
 * Built-in profiles render first, user-loaded below a thin rule.
 * Bottom row is a "+ Load custom profile…" action that opens a file
 * picker via the IPC bridge. User profiles get a small × on hover
 * that calls the delete handler. Style matches ReferenceDropdown.
 */

export interface ProfileInfo {
 id: string
 name: string
 description?: string
 sample_count?: number
 user_created?: boolean
}

interface Props {
 profiles: ProfileInfo[]
 selected: string
 onSelect: (id: string) => void
 onLoadCustom?: () => void
 onDelete?: (id: string) => void
 errorMessage?: string | null
}

export default function ProfileDropdown({
 profiles,
 selected,
 onSelect,
 onLoadCustom,
 onDelete,
 errorMessage,
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

 const current = profiles.find(p => p.id === selected) ?? profiles[0]
 const builtIn = profiles.filter(p => !p.user_created)
 const userMade = profiles.filter(p => p.user_created)

 return (
   <div ref={wrapRef} className="relative inline-block">
     <button
       onClick={() => setOpen(v => !v)}
       className="flex items-center gap-2 px-3 py-1.5 transition-colors text-[11px]"
       style={{
         borderRadius: '2px',
         color: '#d6cdc0',
         backgroundColor: 'rgba(168,161,150,0.06)',
         border: '1px solid rgba(168,161,150,0.20)',
       }}
       title={current?.description || 'Engineer profile used for tonal recommendations'}
     >
       <span className="opacity-60">Profile:</span>
       <span style={{ color: '#e9e2d4' }}>{current?.name ?? 'Default'}</span>
       <svg className="w-3 h-3 opacity-60" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5}>
         <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
       </svg>
     </button>

     {open && (
       <div
         className="absolute z-30 mt-1 min-w-[260px]"
         style={{
           borderRadius: '2px',
           backgroundColor: 'rgba(28,28,28,0.98)',
           border: '1px solid rgba(168,161,150,0.25)',
           top: '100%',
         }}
       >
         {builtIn.length > 0 && (
           <div className="py-1">
             {builtIn.map(p => (
               <button
                 key={p.id}
                 onClick={() => { onSelect(p.id); setOpen(false) }}
                 role="menuitemradio"
                 aria-checked={p.id === selected}
                 className="w-full flex items-center justify-between gap-3 px-3 py-1.5 transition-colors text-[11px]"
                 style={{
                   color: p.id === selected ? 'var(--color-accent)' : '#d6cdc0',
                   backgroundColor: p.id === selected ? 'rgba(208,176,102,0.10)' : 'transparent',
                 }}
                 onMouseEnter={e => { if (p.id !== selected) e.currentTarget.style.backgroundColor = 'rgba(168,161,150,0.08)' }}
                 onMouseLeave={e => { if (p.id !== selected) e.currentTarget.style.backgroundColor = 'transparent' }}
               >
                 <span className="flex items-center gap-2 min-w-0 text-left">
                   <span aria-hidden="true" className="inline-flex w-2 justify-center" style={{ color: 'var(--color-accent)' }}>
                     {p.id === selected ? '•' : ''}
                   </span>
                   <span className="truncate">{p.name}</span>
                 </span>
                 {typeof p.sample_count === 'number' && p.sample_count > 0 && (
                   <span className="opacity-50 text-[10px] tabular-nums shrink-0">{p.sample_count} tracks</span>
                 )}
               </button>
             ))}
           </div>
         )}
         {userMade.length > 0 && (
           <>
             <div className="my-1 border-t" style={{ borderColor: 'rgba(168,161,150,0.15)' }} />
             <div className="py-1">
               <div className="px-3 py-1 text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Your profiles</div>
               {userMade.map(p => (
                 <div
                   key={p.id}
                   className="group w-full flex items-center justify-between gap-2 pl-3 pr-2 py-1.5 text-[11px]"
                   style={{
                     color: p.id === selected ? 'var(--color-accent)' : '#d6cdc0',
                     backgroundColor: p.id === selected ? 'rgba(208,176,102,0.10)' : 'transparent',
                   }}
                 >
                   <button
                     onClick={() => { onSelect(p.id); setOpen(false) }}
                     role="menuitemradio"
                     aria-checked={p.id === selected}
                     className="flex-1 flex items-start gap-2 text-left truncate"
                     style={{ color: 'inherit' }}
                   >
                     <span aria-hidden="true" className="inline-flex w-2 justify-center pt-[2px]" style={{ color: 'var(--color-accent)' }}>
                       {p.id === selected ? '•' : ''}
                     </span>
                     <span className="min-w-0 flex-1">
                       <div className="truncate">{p.name}</div>
                       {typeof p.sample_count === 'number' && p.sample_count > 0 && (
                         <div className="opacity-50 text-[10px] tabular-nums">{p.sample_count} tracks</div>
                       )}
                     </span>
                   </button>
                   {onDelete && (
                     <button
                       onClick={(e) => { e.stopPropagation(); onDelete(p.id) }}
                       className="opacity-30 group-hover:opacity-100 focus-visible:opacity-100 hover:opacity-100 text-[14px] min-w-[24px] min-h-[24px] flex items-center justify-center"
                       style={{ color: '#a89572' }}
                       title={`Remove "${p.name}" from your profiles`}
                       aria-label="Delete profile"
                     >
                       ×
                     </button>
                   )}
                 </div>
               ))}
             </div>
           </>
         )}
         {onLoadCustom && (
           <>
             <div className="my-1 border-t" style={{ borderColor: 'rgba(168,161,150,0.15)' }} />
             <button
               onClick={() => { onLoadCustom(); setOpen(false) }}
               className="w-full text-left px-3 py-1.5 transition-colors text-[11px]"
               style={{ color: '#a89572' }}
               onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(168,161,150,0.08)' }}
               onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
             >
               + Load custom profile…
             </button>
           </>
         )}
         {errorMessage && (
           <div
             className="px-3 py-1.5 text-[10px]"
             style={{ color: '#e07a4f', borderTop: '1px solid rgba(168,161,150,0.15)' }}
           >
             {errorMessage}
           </div>
         )}
       </div>
     )}
   </div>
 )
}
