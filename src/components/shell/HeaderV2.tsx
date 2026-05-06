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
}

export default function HeaderV2({ state, metricCells, canShowBlind, zoom, onOpenShortcuts }: Props) {
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

 {/* Right: overflow trigger. paddingRight matches v1 visual
   right margin. */}
 <div style={{ justifySelf: 'end', paddingRight: 16 }}>
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
