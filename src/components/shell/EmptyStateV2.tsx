import React from 'react'
import Wordmark from './Wordmark'
import Colophon from './Colophon'
import RTMBadge from './RTMBadge'
import type { HistoryEntry } from '../../types'
import { useV52Surface } from '../../AudienceContext'
import { CoverSurface } from '../v52/CoverSurface'

/**
 * EmptyStateV2 — the cover-page empty state.
 *
 * v5.3 rewrite: stripped from the old 11-control upload UI to a
 * single editorial moment. Wordmark, italic kicker (the canonical
 * tagline with "Before" in gold), one drop frame containing the
 * existing FileDropZones, a Begin button, and a colophon.
 *
 * Secondary affordances (deep scan toggle, profile picker, library
 * shortcut, educator banner) move to the OverflowMenu and to per-
 * panel surfaces post-analysis. The cover is the cover.
 *
 * Read `.rtm-design/v5.2-anti-ai-design.md` before adding anything
 * back. Particularly rule #12 (no centred-stack hero pages) — the
 * cover is centred for the wordmark's editorial moment, but the
 * colophon strip + corner badge break the central axis at the
 * lower zone, so it reads as a magazine cover rather than a
 * three-button SaaS hero.
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
 /** The two FileDropZone instances + swap button — passed verbatim
  * from App.tsx so we don't rebind their state. */
 children: React.ReactNode
 /** Whether the Begin button should be enabled (= at least one
  * file dropped). */
 canBegin: boolean
 /** Click handler for Begin. App.tsx routes to handleCompare or
  * handleRefOnly based on which files are present. */
 onBegin: () => void
 /** Optional secondary action — analyse a folder. */
 onBatch?: () => void
 /** Recent analyses count (for the "Recent ↘" link). */
 recents?: HistoryEntry[]
 onOpenRecents?: () => void
 /** Non-null when the previous analysis attempt failed. Shown as a
  * red callout above the drop frame so the user knows what went
  * wrong before they try again. */
 error?: string | null

 // v5.2 cover-surface pass-through (optional). When `useV52Surface('cover')`
 // is on AND these are supplied, EmptyStateV2 short-circuits to CoverSurface.
 // Legacy callers that don't pass them keep the centred-stack rendering.
 fileAName?: string | null
 fileAFormat?: string
 fileADuration?: string
 onDropA?: (file: File) => void
 fileBName?: string | null
 fileBFormat?: string
 fileBDuration?: string
 onDropB?: (file: File) => void
 onSwap?: () => void
 onBeginCompare?: () => void
 onBeginRefOnly?: () => void
 canCompare?: boolean
 canRefOnly?: boolean
 profileName?: string
 v52Recents?: Array<{ id: string; title: string; ts?: string }>
 onOpenRecent?: (id: string) => void
 courseName?: string
 assignmentName?: string
 sessionCount?: number
}

export default function EmptyStateV2({
 children,
 canBegin,
 onBegin,
 onBatch,
 recents,
 onOpenRecents,
 error,
 fileAName,
 fileAFormat,
 fileADuration,
 onDropA,
 fileBName,
 fileBFormat,
 fileBDuration,
 onDropB,
 onSwap,
 onBeginCompare,
 onBeginRefOnly,
 canCompare,
 canRefOnly,
 profileName,
 v52Recents,
 onOpenRecent,
 courseName,
 assignmentName,
 sessionCount,
}: Props) {
 // recents prop kept for API stability; the count is no longer surfaced
 // in the footer (the dead "Recent (N)" button was removed — inline
 // RecentAnalyses below the dropzones is the source of truth).
 void recents
 void onOpenRecents

 // v5.2 cover surface — opt-in via `rtm-shell=v5.2` or `rtm-v52-surfaces`
 // allow-list. Falls back to the legacy layout below when off OR when
 // the parent hasn't yet wired the new drop/handler props.
 const useV52Cover = useV52Surface('cover')
 if (useV52Cover) {
  return (
   <CoverSurface
    fileAName={fileAName ?? null}
    fileAFormat={fileAFormat}
    fileADuration={fileADuration}
    onDropA={onDropA ?? (() => {})}
    fileBName={fileBName ?? null}
    fileBFormat={fileBFormat}
    fileBDuration={fileBDuration}
    onDropB={onDropB ?? (() => {})}
    onSwap={onSwap}
    onBeginCompare={onBeginCompare ?? onBegin}
    onBeginRefOnly={onBeginRefOnly ?? onBegin}
    canCompare={canCompare ?? (canBegin && !!fileAName && !!fileBName)}
    canRefOnly={canRefOnly ?? canBegin}
    profileName={profileName}
    recents={(v52Recents ?? (recents ?? []).slice(0, 3).map(r => ({
     id: (r as HistoryEntry).path ?? (r as HistoryEntry).name ?? '',
     title: (r as HistoryEntry).name ?? '',
     ts: undefined,
    })))}
    recentsTotal={v52Recents ? v52Recents.length : (recents?.length ?? 0)}
    onOpenRecent={onOpenRecent}
    courseName={courseName}
    assignmentName={assignmentName}
    sessionCount={sessionCount ?? recents?.length}
   />
  )
 }

 return (
 <section
 aria-label="RTMcompare cover"
 style={{
 minHeight: 'calc(100vh - 160px)',
 display: 'flex',
 flexDirection: 'column',
 position: 'relative',
 paddingTop: 'clamp(48px, 10vh, 120px)',
 paddingBottom: 56,
 }}
 >
 {/* RTMBadge — quiet brand mark in the upper-right corner.
   Establishes the suite identity without competing with the
   wordmark below. */}
 <div style={{ position: 'absolute', top: 32, right: 32 }}>
 <RTMBadge subscript="COMPARE" size="md" frame />
 </div>

 {/* Hero wordmark + italic kicker */}
 <header
 style={{
 display: 'flex',
 flexDirection: 'column',
 alignItems: 'center',
 gap: 18,
 marginBottom: 'clamp(36px, 6vh, 72px)',
 }}
 >
 <Wordmark size="hero" as="h1" />

 {/* Canonical tagline. Two lines, italic Didone, centred. The
   word "Before" carries the single gold gesture. */}
 <div
 style={{
 display: 'flex',
 flexDirection: 'column',
 alignItems: 'center',
 gap: 4,
 marginTop: 6,
 }}
 >
 <span
 style={{
 fontFamily: 'var(--font-display)',
 fontStyle: 'italic',
 fontWeight: 400,
 fontSize: 'clamp(1.25rem, 2.4vw, 1.75rem)',
 lineHeight: 1.15,
 color: 'var(--color-text-secondary)',
 }}
 >
 Hear what Spotify hears.
 </span>
 <span
 style={{
 fontFamily: 'var(--font-display)',
 fontStyle: 'italic',
 fontWeight: 400,
 fontSize: 'clamp(1.25rem, 2.4vw, 1.75rem)',
 lineHeight: 1.15,
 color: 'var(--color-text-secondary)',
 }}
 >
 <span style={{ color: 'var(--color-accent)' }}>Before</span>
 {' '}Spotify hears it.
 </span>
 </div>
 </header>

 {/* Error callout — only visible after a failed analysis attempt.
   Sits above the drop frame so the user sees it before re-dropping
   files. Red left-border card keeps it visually distinct from the
   editorial cover layout without being modal-level disruptive. */}
 {error && (
  <div
   role="alert"
   style={{
    width: 'min(840px, 92%)',
    marginInline: 'auto',
    marginBottom: 16,
    padding: '10px 16px',
    borderLeft: '3px solid var(--color-error, #e05252)',
    borderRadius: 'var(--radius-card)',
    backgroundColor: 'color-mix(in srgb, var(--color-error, #e05252) 8%, transparent)',
    color: 'var(--color-error, #e05252)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-sm, 0.875rem)',
    lineHeight: 1.5,
   }}
  >
   {error}
  </div>
 )}

 {/* The drop frame — a single dashed rectangle around the two
   FileDropZones (passed via children). Sized like a record
   sleeve — wider than tall, asymmetric tension with the centred
   wordmark above. */}
 <div
 style={{
 width: 'min(840px, 92%)',
 marginInline: 'auto',
 padding: 28,
 border: '1px dashed var(--rtm-frame-border)',
 borderRadius: 'var(--radius-card)',
 backgroundColor: 'transparent',
 }}
 >
 {children}
 </div>

 {/* Outcome statement — tells the user what they'll get before they
   commit a file drop. Single sentence, muted, centred under the frame. */}
 <p
 style={{
 fontSize: 11,
 color: 'var(--color-text-muted)',
 marginTop: 6,
 textAlign: 'center',
 maxWidth: 280,
 marginInline: 'auto',
 lineHeight: 1.5,
 }}
 >
 Drop A and B — you'll see LUFS, stereo width, masking, dynamics, and a match score in under 10 seconds.
 </p>

 {/* CTA row — Begin (italic display) + tiny "Or analyse a folder" */}
 <div
 style={{
 display: 'flex',
 flexDirection: 'column',
 alignItems: 'center',
 gap: 12,
 marginTop: 32,
 }}
 >
 <button
 type="button"
 onClick={canBegin ? onBegin : undefined}
 disabled={!canBegin}
 style={{
 fontFamily: 'var(--font-display)',
 fontStyle: 'italic',
 fontWeight: 400,
 fontSize: 'clamp(1.5rem, 2.8vw, 2rem)',
 color: canBegin ? 'var(--color-text-primary)' : 'var(--color-text-dim)',
 background: 'transparent',
 border: 'none',
 cursor: canBegin ? 'pointer' : 'not-allowed',
 padding: '4px 12px',
 letterSpacing: '0.005em',
 transition: 'color 120ms var(--easing-shell)',
 }}
 >
 Begin analysis
 </button>

 {onBatch && (
 <button
 type="button"
 onClick={onBatch}
 style={{
 fontFamily: 'var(--font-sans)',
 fontWeight: 500,
 fontSize: 'var(--text-metric-eyebrow)',
 letterSpacing: 'var(--tracking-metric-eyebrow)',
 textTransform: 'uppercase',
 color: 'var(--color-text-dim)',
 background: 'transparent',
 border: 'none',
 cursor: 'pointer',
 transition: 'color 120ms var(--easing-shell)',
 }}
 onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
 onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-dim)')}
 >
 ↘ Or analyse a folder
 </button>
 )}
 </div>

 {/* Spacer pushes the colophon to the bottom without absolute
   positioning — keeps the page scroll-friendly when the window
   is short. */}
 <div style={{ flexGrow: 1, minHeight: 24 }} />

 {/* Bottom strip — colophon centred, Recent link bottom-right.
   The asymmetric Recent placement breaks the central axis — the
   composition reads as a magazine cover, not a centred SaaS hero. */}
 <footer
 style={{
 display: 'grid',
 gridTemplateColumns: '1fr auto 1fr',
 alignItems: 'center',
 paddingInline: 32,
 gap: 16,
 }}
 >
 <div /> {/* left spacer */}
 <Colophon />
 {/* Right footer slot intentionally empty — the legacy "Recent (N)"
     button was dead (no scroll target, popover never wired up). The
     inline RecentAnalyses card below the dropzones is now the single
     source of truth for recent history. */}
 <div style={{ justifySelf: 'end' }} />
 </footer>
 </section>
 )
}
