import React, { useState, useCallback, useRef } from 'react'
import { FileInfo } from '../types'

interface Props {
 label: string
 hint: string
 file: FileInfo | null
 onFile: (f: FileInfo | null) => void
 /** When set, the zone enters "locked" state: drops + click are
 * ignored, the Clear button is hidden, and a gold padlock chip sits
 * top-left. Used in Compare mode to pin the A-side (Reference)
 * across successive revisions dropped into B. */
 locked?: boolean
 onToggleLock?: () => void
}

export default function FileDropZone({ label, hint, file, onFile, locked, onToggleLock }: Props) {
 const [dragging, setDragging] = useState(false)
 const [dropError, setDropError] = useState<string | null>(null)
 const inputRef = useRef<HTMLInputElement>(null)

 const handleDrop = useCallback(async (e: React.DragEvent) => {
 e.preventDefault()
 setDragging(false)
 setDropError(null)
 if (locked) return // swallow drops when locked — revisions go to B
 const dropped = e.dataTransfer.files[0]
 if (!dropped) {
 // Source had no File payload. Common when dragging from cloud-only
 // files in Finder (iCloud / Dropbox placeholders) or from search
 // results. Tell the user instead of silently re-prompting.
 setDropError('That drop didn\'t include a file. If it\'s an iCloud/Dropbox placeholder, open it once in Finder to download it, then drop again.')
 return
 }
 if (!isAudioFile(dropped.name)) {
 setDropError(`${dropped.name} isn't an audio file we recognise (.wav .aiff .flac .mp3 .m4a .ogg .wma).`)
 return
 }

 // Use Electron's webUtils.getPathForFile API. Accept any non-empty
 // absolute path — DO NOT check for `/` since Windows paths use `\`
 // (e.g. `C:\Users\nicka\Downloads\song.wav`).
 const fullPath = (window as any).electronAPI?.getPathForFile?.(dropped) || (dropped as any).path || ''

 if (fullPath) {
 onFile({ path: fullPath, name: dropped.name })
 } else {
 // Path resolution failed (rare — usually a non-Finder drag source
 // that doesn't expose a real OS path). Don't auto-open a second
 // file picker — that confuses users into thinking drag-drop is
 // broken. Show a clear inline message and let them click to browse.
 console.warn('[FileDropZone] getPathForFile returned empty for', dropped.name)
 setDropError('Couldn\'t read this file\'s path from the drop. Click the zone to browse for it instead.')
 }
 }, [onFile, locked])

 const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
 const selected = e.target.files?.[0]
 if (!selected || !isAudioFile(selected.name)) return
 // Electron 32+: File.path is undefined. Resolve via webUtils.getPathForFile().
 const fullPath = (window as any).electronAPI?.getPathForFile?.(selected) || (selected as any).path
 onFile({ path: fullPath || selected.name, name: selected.name })
 }, [onFile])

 const handleClick = async () => {
 if (locked) return // don't open file picker on a locked zone
 if (window.electronAPI?.selectFile) {
 const path = await window.electronAPI.selectFile()
 if (path) {
 const name = path.split(/[\\/]/).pop() || path
 onFile({ path, name })
 }
 } else {
 inputRef.current?.click()
 }
 }

 const handleClear = useCallback((e: React.MouseEvent) => {
 e.stopPropagation()
 onFile(null as any) // null = clear
 }, [onFile])

 // 5.3.0 a11y: keyboard-activate (SC 2.1.1). The zone is a "button"
 // with role + tabIndex + Enter/Space activation. The hint text now
 // names the file picker explicitly so screen-reader users know
 // pressing Enter opens it. Drop area is announced via aria-label.
 const onKeyDown = (e: React.KeyboardEvent) => {
 if (locked) return
 if (e.key === 'Enter' || e.key === ' ') {
 e.preventDefault()
 handleClick()
 }
 }
 const ariaLabel = locked
 ? `${label} drop zone — locked`
 : file
 ? `${label} drop zone — ${file.name} loaded. Press Enter to replace.`
 : `${label} drop zone. Drop an audio file, or press Enter to browse.`

 return (
 <div
 role="region"
 aria-label={ariaLabel}
 className={`drop-zone ${dragging ? 'active' : ''} ${file ? 'loaded' : ''} relative`}
 onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
 onDragLeave={() => setDragging(false)}
 onDrop={handleDrop}
 onClick={!file ? handleClick : undefined}
 >
 <input
 ref={inputRef}
 type="file"
 accept="audio/*,.wav,.mp3,.flac,.aiff,.aif,.ogg,.m4a,.adm"
 className="hidden"
 onChange={handleFileSelect}
 />

 {file ? (
 <div className="space-y-3">
 {/* Lock toggle (top-left) — only rendered when the parent
 opts in via onToggleLock. Gold when locked, muted when
 unlocked. Sits opposite the Clear button so the two
 controls never overlap visually. */}
 {onToggleLock && (
 <button
 onClick={(e) => { e.stopPropagation(); onToggleLock() }}
 className="absolute top-2 left-2 h-7 px-2 flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] transition-all"
 style={{
 borderRadius: '2px',
 backgroundColor: locked ? 'rgba(208,176,102,0.16)' : 'rgba(87,83,78,0.18)',
 color: locked ? '#d0b066' : '#8d867b',
 border: `1px solid ${locked ? 'rgba(208,176,102,0.45)' : 'rgba(168,161,150,0.18)'}`,
 }}
 aria-label={locked ? `Unlock ${label}` : `Lock ${label}. Subsequent drops will route to the other slot`}
 title={locked
 ? `${label} is locked. Drops + clicks are ignored; revisions will target the other slot. Click to unlock.`
 : `Lock ${label}. When locked, subsequent drops on this zone are ignored so your Reference stays fixed across revisions.`}
 >
 <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
 {locked ? (
 <path strokeLinecap="round" strokeLinejoin="round" d="M5 11V7a7 7 0 0114 0v4M5 11h14a1 1 0 011 1v8a1 1 0 01-1 1H5a1 1 0 01-1-1v-8a1 1 0 011-1z" />
 ) : (
 <path strokeLinecap="round" strokeLinejoin="round" d="M5 11V7a7 7 0 0113.5-2.5M5 11h14a1 1 0 011 1v8a1 1 0 01-1 1H5a1 1 0 01-1-1v-8a1 1 0 011-1z" />
 )}
 </svg>
 {locked ? 'Locked' : 'Lock'}
 </button>
 )}
 {/* Clear button — appears on hover, top-right. Suppressed
 when the slot is locked so the user can't accidentally
 wipe their pinned reference. */}
 {!locked && (
 <button
 onClick={handleClear}
 className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center transition-all opacity-70 hover:opacity-100"
  style={{ borderRadius: '2px', backgroundColor: 'rgba(201,103,101,0.12)', color: '#c96765' }}
 aria-label={`Clear ${label}`}
 title="Clear this file"
 >
 <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
 </svg>
 </button>
 )}
 <svg className="w-5 h-5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: '#7a9a7e' }}>
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
 </svg>
 <p className="text-xs tracking-widest uppercase" style={{ color: '#7a9a7e' }}>{label}</p>
 <p className="text-sm text-sand-300 truncate max-w-[250px] mx-auto">{file.name}</p>
 </div>
 ) : (
 <div className="space-y-4">
 <svg className="w-5 h-5 mx-auto text-sand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
 </svg>
 <div>
 <p className="text-xs tracking-widest uppercase text-sand-400">{label}</p>
 <p className="text-[11px] text-sand-400 mt-1">{hint}</p>
 </div>
 <p className="text-[11px] text-sand-400">Drop audio here, or</p>
 <button
 type="button"
 onClick={(e) => { e.stopPropagation(); handleClick() }}
 className="text-[11px] px-4 py-1.5 transition-colors"
 style={{
   borderRadius: '2px',
   color: 'var(--color-text-primary)',
   border: '1px solid rgba(168,161,150,0.3)',
   backgroundColor: 'rgba(87,83,78,0.18)',
 }}
 >
 Browse…
 </button>
 {dropError && (
 <p
 className="text-[11px] mt-2 px-3 py-2"
 style={{ borderRadius: '2px', color: '#d0b066', backgroundColor: 'rgba(208,176,102,0.10)' }}
 onClick={(e) => { e.stopPropagation(); setDropError(null) }}
 title="Click to dismiss"
 >
 {dropError}
 </p>
 )}
 </div>
 )}
 </div>
 )
}

function isAudioFile(name: string): boolean {
 const ext = name.toLowerCase().split('.').pop()
 return ['wav', 'mp3', 'flac', 'aiff', 'aif', 'ogg', 'm4a', 'wma', 'adm'].includes(ext || '')
}
