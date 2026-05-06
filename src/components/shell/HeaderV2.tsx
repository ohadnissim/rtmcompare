import React from 'react'
import type { AppState } from '../../types'
import Wordmark from './Wordmark'
import SurfaceChips from './SurfaceChips'
import OverflowMenu from './OverflowMenu'
import MetricStrip, { type MetricStripCell } from './MetricStrip'

/**
 * HeaderV2 — the v5.2 Console Didone shell header. Replaces the
 * temporary `<HeaderV2Stub />` once tasks #4–#10 land.
 *
 * Two rows:
 *   - Presence row (~64px): Wordmark · SurfaceChips · OverflowMenu
 *   - Instrument row (~52px): MetricStrip
 *
 * The instrument row is hidden when there's no analysis loaded
 * (idle / loading) so the empty-state cover gets the screen to
 * itself. Thin 1px cream-rule between the rows when both visible.
 *
 * IMPORTANT: outer `<header>` preserves the same sticky / blur /
 * top:28 contract as the v1 header so the parent drag-strip keeps
 * working with the macOS Kensington-safe split. Do NOT change these
 * attributes — see App.tsx comment block above the drag strip.
 */
interface ZoomControls {
 value: number
 pct: string
 in: () => void
 out: () => void
 reset: () => void
 outDisabled?: boolean
 inDisabled?: boolean
}

interface Props {
 state: AppState
 metricCells: MetricStripCell[]
 canShowBlind?: boolean
 zoom?: ZoomControls
 onOpenShortcuts?: () => void
 /** 5.4.1: docked New search affordance. Returns the user to the
  *  upload cover from any analysis state. Pre-5.4.1 a comment in
  *  App.tsx claimed this was "docked into the header link" but the
  *  link itself never existed. */
 onNewSearch?: () => void
}

export default function HeaderV2({ state, metricCells, canShowBlind, zoom, onOpenShortcuts, onNewSearch }: Props) {
 // Hide the instrument row on upload (cover screen owns the field)
 // and processing (no analysis to surface yet). Show on results,
 // ref-only, batch — anywhere actual numbers exist to render.
 const showStrip = state !== 'upload' && state !== 'processing' && metricCells.length > 0

 return (
 <header
 className="app-no-drag sticky z-30 backdrop-blur-md"
 style={{
 top: 28,
 backgroundColor: 'var(--rtm-header-bg)',
 borderBottom: '1px solid var(--rtm-header-border)',
 paddingLeft: 32,
 paddingRight: 32,
 }}
 >
 {/* Row 1 — presence */}
 <div
 style={{
 display: 'grid',
 gridTemplateColumns: '1fr auto 1fr',
 alignItems: 'center',
 height: 64,
 columnGap: 16,
 }}
 >
 {/* Left: wordmark, with breathing room from the macOS traffic
   lights. The 64px paddingLeft mirrors the v1 `pl-16` so the
   wordmark sits in the same X position as before. */}
 <div style={{ paddingLeft: 32, justifySelf: 'start' }}>
 <Wordmark size="md" />
 </div>

 {/* Centre: surface chips. justify-self center anchors them
   independent of the wordmark's width (which can drift across
   theme + OS-font fallbacks). */}
 <div style={{ justifySelf: 'center' }}>
 <SurfaceChips />
 </div>

 {/* Right: Search · Shortcuts · New analysis · Overflow.
   Search jumps you to the ⌘K palette (compare-tabs) or Song
   Quick-Switcher (batch). Shortcuts opens the keyboard help.
   New analysis docks here so engineers don't have to know the
   ⌘N shortcut to start over. */}
 <div style={{ justifySelf: 'end', paddingRight: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
 {state !== 'upload' && state !== 'processing' && (
 <button
 type="button"
 onClick={() => window.dispatchEvent(new CustomEvent('rtm-open-palette'))}
 className="w-8 h-8 rounded-md flex items-center justify-center transition-colors"
 style={{
 color: 'var(--color-text-muted)',
 border: '1px solid var(--color-border)',
 backgroundColor: 'transparent',
 }}
 title="Search (⌘K) — find any tab, metric, or panel by name"
 aria-label="Search"
 >
 <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
 <circle cx="11" cy="11" r="7" />
 <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
 </svg>
 </button>
 )}
 <button
 type="button"
 onClick={() => window.dispatchEvent(new CustomEvent('rtm-toggle-shortcuts'))}
 className="w-8 h-8 rounded-md flex items-center justify-center transition-colors"
 style={{
 color: 'var(--color-text-muted)',
 border: '1px solid var(--color-border)',
 backgroundColor: 'transparent',
 fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
 fontSize: 13,
 }}
 title="Keyboard shortcuts (?)"
 aria-label="Keyboard shortcuts"
 >
 ?
 </button>
 {state !== 'upload' && state !== 'processing' && onNewSearch && (
 <button
 type="button"
 onClick={onNewSearch}
 className="text-[10px] uppercase tracking-[0.16em] px-3 py-1.5 rounded-md transition-colors"
 style={{
 color: 'var(--color-accent)',
 border: '1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)',
 backgroundColor: 'transparent',
 }}
 title="Drop new files. Current analysis stays in Recent Analyses. (⌘N)"
 aria-label="Start a new analysis"
 >
 + New analysis
 </button>
 )}
 <OverflowMenu canShowBlind={canShowBlind} zoom={zoom} onOpenShortcuts={onOpenShortcuts} />
 </div>
 </div>

 {/* Row 2 — instrument. Hidden when no analysis. */}
 {showStrip && (
 <div
 style={{
 borderTop: '1px solid var(--rtm-header-divider)',
 minHeight: 52,
 display: 'flex',
 alignItems: 'center',
 paddingLeft: 64, // align with wordmark's left edge
 paddingRight: 16,
 }}
 >
 <MetricStrip cells={metricCells} />
 </div>
 )}
 </header>
 )
}
