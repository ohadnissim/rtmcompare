import React, { useState } from 'react'
import Wordmark from './Wordmark'
import Colophon from './Colophon'
import type { HistoryEntry } from '../../types'

/**
 * EmptyStateV2 — the cover-page empty state for the v5.2 shell.
 *
 * Wraps the existing dual `<FileDropZone />` instances (passed via
 * `children`) without modifying them. The cover supplies:
 *   - a hero `<Wordmark size="hero" />` ~40% from the top
 *   - a tracked-caps tagline below
 *   - a single quiet frame around the children (the actual drop UI)
 *   - a colophon line pinned to the bottom margin
 *   - a "↘ Recent (n)" link that toggles the `recents` drawer
 *
 * The philosophy bar to clear here: this empty state should read
 * as a magazine cover, not a SaaS upload page. Re-read
 * `.rtm-design/v5.2-anti-ai-design.md` rules #12 (no centred-stack
 * hero), #15 (no "How it works" banners), #28-32 (no marketing
 * copy) before adding anything.
 *
 * Educator-mode banner and library shortcut strip live OUTSIDE this
 * component (rendered alongside it in App.tsx) — that's intentional.
 * The cover is the cover; secondary affordances stack below.
 */
interface Props {
 /** The two FileDropZone instances + swap button — passed verbatim
  * from App.tsx so we don't rebind their state. */
 children: React.ReactNode
 /** Recent analyses list. Renders a small drawer toggle when there
  * are entries; hidden when empty. */
 recents?: HistoryEntry[]
 /** Click handler for the "Recent" drawer toggle. App.tsx owns the
  * actual drawer rendering; this component just surfaces the link. */
 onOpenRecents?: () => void
}

export default function EmptyStateV2({ children, recents, onOpenRecents }: Props) {
 const [recentsOpen, setRecentsOpen] = useState(false)
 const recentCount = recents?.length ?? 0

 return (
 <section
 aria-label="RTMcompare cover"
 style={{
 minHeight: 'calc(100vh - 160px)', // page minus header + main padding
 display: 'flex',
 flexDirection: 'column',
 position: 'relative',
 // Generous interior margins so the wordmark breathes. The
 // brief calls for ~40% from top — flex-direction column with
 // a grow-spacer above pins it there responsively.
 paddingTop: 'clamp(48px, 12vh, 140px)',
 paddingBottom: 56,
 }}
 >
 {/* Hero wordmark + tagline */}
 <header
 style={{
 display: 'flex',
 flexDirection: 'column',
 alignItems: 'center',
 gap: 12,
 marginBottom: 'clamp(40px, 8vh, 96px)',
 }}
 >
 <Wordmark size="hero" as="h1" />
 <span
 style={{
 fontFamily: 'var(--font-sans)',
 fontWeight: 500,
 fontSize: 'var(--text-metric-eyebrow)',
 letterSpacing: 'var(--tracking-metric-eyebrow)',
 textTransform: 'uppercase',
 color: 'var(--color-text-secondary)',
 opacity: 0.6,
 lineHeight: 1,
 }}
 >
 Drop two audio files to begin
 </span>
 </header>

 {/* The drop frame. The quiet 1px dashed border is the entire
  visual treatment; the children (FileDropZones) live inside
  with their own already-existing styling. */}
 <div
 style={{
 width: 'min(840px, 92%)',
 marginInline: 'auto',
 padding: 24,
 border: '1px dashed var(--rtm-frame-border)',
 borderRadius: 'var(--radius-card)',
 backgroundColor: 'transparent',
 }}
 >
 {children}
 </div>

 {/* Spacer pushes colophon to bottom without forcing an absolute
  position — keeps the layout scroll-friendly when the window
  is short. */}
 <div style={{ flexGrow: 1 }} />

 {/* Bottom strip — Recent link left of centre, colophon centred. */}
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
 <div style={{ justifySelf: 'end' }}>
 {recentCount > 0 && (
 <button
 type="button"
 onClick={() => {
 setRecentsOpen((v) => !v)
 onOpenRecents?.()
 }}
 aria-expanded={recentsOpen}
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
 padding: 0,
 transition: 'color 120ms var(--easing-shell)',
 }}
 onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
 onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-dim)')}
 >
 ↘ Recent ({recentCount})
 </button>
 )}
 </div>
 </footer>
 </section>
 )
}
