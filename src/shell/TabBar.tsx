import React, { useCallback, useEffect, useRef, useState } from 'react'
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
 *
 * A "+N" badge appears at the far right when tabs overflow the visible
 * strip area — visual affordance only, tabs remain horizontally scrollable.
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
 const activeRef = useRef<HTMLButtonElement>(null)
 const containerRef = useRef<HTMLDivElement>(null)
 const [overflowCount, setOverflowCount] = useState(0)

 // Keep the active tab visible when the active id changes (e.g. tab opened
 // via keyboard / module store while the strip is scrolled off-screen).
 useEffect(() => {
  activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
 }, [activeId])

 // Measure how many tabs are clipped beyond the visible container edge.
 // The callback is gated behind requestAnimationFrame so that a continuous
 // resize (drag-to-resize window) causes at most one layout read per frame
 // instead of one per pixel — avoids forced-layout thrashing on the main thread.
 useEffect(() => {
  const el = containerRef.current
  if (!el) return
  let rafId = 0
  const measure = () => {
   let hidden = 0
   const containerRight = el.getBoundingClientRect().right
   el.querySelectorAll<HTMLButtonElement>('[role="tab"]').forEach(btn => {
    if (btn.getBoundingClientRect().right > containerRight + 4) hidden++
   })
   setOverflowCount(hidden)
  }
  const scheduleMeasure = () => {
   cancelAnimationFrame(rafId)
   rafId = requestAnimationFrame(measure)
  }
  const ro = new ResizeObserver(scheduleMeasure)
  ro.observe(el)
  measure()
  return () => { ro.disconnect(); cancelAnimationFrame(rafId) }
 }, [tabs])

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

 // MED-13: roving tabIndex — Left/Right arrow keys move focus through the tablist.
 const handleKeyDown = useCallback((e: React.KeyboardEvent, idx: number) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  e.preventDefault()
  const delta = e.key === 'ArrowRight' ? 1 : -1
  const next = (idx + delta + tabs.length) % tabs.length
  const tabEls = containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  tabEls?.[next]?.focus()
 }, [tabs.length])

 return (
  <div className="relative">
   <div
    ref={containerRef}
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
     const accent = tab.accentColor || 'var(--color-accent)'
     const isDragOver = dragOverIdx === idx
     return (
      <button
       key={tab.id}
       ref={tab.id === activeId ? activeRef : null}
       role="tab"
       aria-selected={isActive}
       draggable
       onDragStart={e => handleDragStart(e, idx)}
       onDragOver={e => handleDragOver(e, idx)}
       onDrop={e => handleDrop(e, idx)}
       onDragEnd={handleDragEnd}
       onKeyDown={e => handleKeyDown(e, idx)}
       onClick={() => onSelect(tab.id)}
       tabIndex={isActive ? 0 : -1}
       className="relative flex items-center gap-2 px-5 py-3 text-[11px] tracking-[0.14em] uppercase transition-all whitespace-nowrap flex-shrink-0"
       style={{
        color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
        fontWeight: isActive ? 500 : 400,
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
         style={{ backgroundColor: 'var(--color-accent)' }}
        />
       )}
       <span className="flex-shrink-0" style={{ width: 14, height: 14, lineHeight: '14px', textAlign: 'center' }}>
        {tab.icon}
       </span>
       <span>{tab.label}</span>
      </button>
     )
    })}

    {/* "+N" overflow badge — non-interactive, hints that more tabs are scrollable */}
    {overflowCount > 0 && (
     <span
      aria-hidden
      className="flex-shrink-0 px-2 py-3 select-none pointer-events-none"
      style={{
       fontSize: 9,
       letterSpacing: '0.14em',
       textTransform: 'uppercase',
       color: 'var(--color-sand-400, #a8a29e)',
      }}
     >
      +{overflowCount}
     </span>
    )}

    {/* [+] module store button */}
    <button
     onClick={onOpenStore}
     className="flex items-center justify-center px-4 py-3 text-[11px] transition-colors hover:text-sand-200 flex-shrink-0"
     style={{ color: 'var(--color-text-muted)' }}
     title="Add or remove modules"
     aria-label="Open module store"
    >
     +
    </button>
   </div>
   {/* Right-edge fade affordance — solid 1px hairline so it signals
     "more content to the right" without using a gradient (gradients
     are blocked decoratively; this functional cue stays inside brand
     rules). */}
   <div
    className="pointer-events-none absolute right-0 top-0 bottom-0 w-px"
    style={{ background: 'var(--color-sand-700)' }}
    aria-hidden
   />
  </div>
 )
}
