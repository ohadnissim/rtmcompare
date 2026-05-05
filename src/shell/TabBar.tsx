import React, { useCallback, useRef, useState } from 'react'
import { ModuleManifest } from './moduleTypes'

/**
 * Drag-reorderable tab strip for the RTM Platform shell.
 *
 * Each tab is a module. Dragging reorders; drop commits. The [+] button
 * at the end opens the module store (handled by the parent via
 * `onOpenStore`). Active tab gets a coloured underline using the
 * module's accent colour (or the default gold).
 *
 * HTML Drag & Drop API — no library dependency. The drag-image is the
 * tab itself so it feels native. We track the drag-over index to show
 * a thin gold insertion indicator, then splice on drop.
 */
interface Props {
 tabs: ModuleManifest[]
 activeId: string
 onSelect: (id: string) => void
 onReorder: (newOrder: string[]) => void
 onOpenStore: () => void
}

export default function TabBar({ tabs, activeId, onSelect, onReorder, onOpenStore }: Props) {
 const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
 const dragSourceIdx = useRef<number | null>(null)

 const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
 dragSourceIdx.current = idx
 e.dataTransfer.effectAllowed = 'move'
 // Use a transparent 1×1 image as the drag ghost — the browser's
 // default ghost is usually an opaque clone of the element which
 // occludes the insertion indicator. The tab itself stays visible
 // at its current position with reduced opacity.
 const ghost = document.createElement('canvas')
 ghost.width = 1; ghost.height = 1
 e.dataTransfer.setDragImage(ghost, 0, 0)
 }, [])

 const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
 e.preventDefault()
 e.dataTransfer.dropEffect = 'move'
 setDragOverIdx(idx)
 }, [])

 const handleDrop = useCallback((e: React.DragEvent, dropIdx: number) => {
 e.preventDefault()
 setDragOverIdx(null)
 const fromIdx = dragSourceIdx.current
 if (fromIdx == null || fromIdx === dropIdx) return
 const ids = tabs.map(t => t.id)
 const [moved] = ids.splice(fromIdx, 1)
 ids.splice(dropIdx, 0, moved)
 onReorder(ids)
 dragSourceIdx.current = null
 }, [tabs, onReorder])

 const handleDragEnd = useCallback(() => {
 setDragOverIdx(null)
 dragSourceIdx.current = null
 }, [])

 return (
 <div
 className="flex items-center gap-0.5 px-8 border-b overflow-x-auto"
 style={{
 backgroundColor: 'rgba(14,13,11,0.6)',
 borderColor: 'rgba(168,161,150,0.08)',
 scrollbarWidth: 'thin',
 }}
 role="tablist"
 aria-label="Platform modules"
 >
 {tabs.map((tab, idx) => {
 const isActive = tab.id === activeId
 const accent = tab.accentColor || '#d0b066'
 const isDragOver = dragOverIdx === idx
 return (
 <button
 key={tab.id}
 role="tab"
 aria-selected={isActive}
 draggable
 onDragStart={e => handleDragStart(e, idx)}
 onDragOver={e => handleDragOver(e, idx)}
 onDrop={e => handleDrop(e, idx)}
 onDragEnd={handleDragEnd}
 onClick={() => onSelect(tab.id)}
 className="relative flex items-center gap-2 px-5 py-3 text-[10px] tracking-[0.12em] uppercase transition-all whitespace-nowrap flex-shrink-0"
 style={{
 color: isActive ? '#ebe7e0' : '#7a7164',
 fontWeight: isActive ? 500 : 300,
 borderBottom: `2px solid ${isActive ? accent : 'transparent'}`,
 opacity: dragSourceIdx.current === idx ? 0.4 : 1,
 cursor: 'pointer',
 }}
 title={tab.description}
 >
 {/* Drag-over insertion indicator */}
 {isDragOver && dragSourceIdx.current !== idx && (
 <span
 className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full"
 style={{ backgroundColor: '#d0b066' }}
 />
 )}
 <span className="flex-shrink-0" style={{ width: 14, height: 14, lineHeight: '14px', textAlign: 'center' }}>
 {tab.icon}
 </span>
 <span>{tab.label}</span>
 </button>
 )
 })}

 {/* [+] module store button */}
 <button
 onClick={onOpenStore}
 className="flex items-center justify-center px-4 py-3 text-[11px] transition-colors hover:text-sand-200 flex-shrink-0"
 style={{ color: '#57534e' }}
 title="Add or remove modules"
 aria-label="Open module store"
 >
 +
 </button>
 </div>
 )
}
