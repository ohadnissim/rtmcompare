import React, { useState } from 'react'
import { useAudience, setAudienceOverride } from '../../AudienceContext'
import type { Audience } from '../../copy/v52'
import { v52Copy } from '../../copy/v52'

/**
 * CoverSurface — editorial replacement for the centred-stack EmptyStateV2.
 *
 * v5.2 Console Didone treatment: ink ground, single-gold hairline gesture,
 * Instrument Serif italic for the wordmark and filenames, Outfit for body,
 * JetBrains Mono for file-format data. Audience-aware strings come from
 * `v52Copy.cover.*` — never hardcoded.
 *
 * Layout is a 12-col grid: masthead occupies cols 1-8 (asymmetric weight
 * left), the file-slot pair sits below as a full-width row split by a
 * vertical sand-700 rule, and the recents + greeting block lives in the
 * lower-right (cols 8-12) — breaking the central axis so this reads as
 * a magazine cover, not a SaaS hero.
 */
export interface CoverSurfaceProps {
  // File A
  fileAName: string | null
  fileAFormat?: string
  fileADuration?: string
  onDropA: (file: File) => void
  isDraggingA?: boolean

  // File B
  fileBName: string | null
  fileBFormat?: string
  fileBDuration?: string
  onDropB: (file: File) => void
  isDraggingB?: boolean

  // Swap
  onSwap?: () => void

  // CTAs
  onBeginCompare: () => void
  onBeginRefOnly: () => void
  canCompare: boolean
  canRefOnly: boolean

  // Batch / album analysis — optional. Only renders the link when supplied.
  onBeginBatch?: () => void
  canBatch?: boolean

  // Profile / context
  profileName?: string

  // Recents
  recents?: Array<{ id: string; title: string; ts?: string }>
  onOpenRecent?: (id: string) => void
  recentsTotal?: number

  // Course context
  courseName?: string
  assignmentName?: string
  sessionCount?: number
}

const SAND_700 = 'rgba(168,161,150,0.22)'
const SAND_500 = 'var(--color-text-dim)'
const SAND_400 = 'var(--color-text-muted)'
const SAND_300 = 'var(--color-text-secondary)'
const SAND_200 = '#cfc8bb'
const CREAM = 'var(--color-text-primary)'
const GOLD = 'var(--color-accent)'

const trackedCaps = (px: number, color: string): React.CSSProperties => ({
  fontFamily: 'var(--font-sans)',
  fontSize: px,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color,
  fontWeight: 500,
})

interface SlotProps {
  eyebrow: string
  name: string | null
  emptyLabel: string
  format?: string
  duration?: string
  onDrop: (file: File) => void
  isDragging?: boolean
  bothLoaded: boolean
}

function FileSlot({ eyebrow, name, emptyLabel, format, duration, onDrop, isDragging, bothLoaded }: SlotProps) {
  const [hover, setHover] = useState(false)
  const dragging = isDragging || hover

  const metaLine = [format, duration].filter(Boolean).join(' · ')

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setHover(true) }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault()
        setHover(false)
        const f = e.dataTransfer.files?.[0]
        if (f) onDrop(f)
      }}
      style={{
        padding: '24px 28px',
        minHeight: 168,
        borderLeft: bothLoaded ? `2px solid ${GOLD}` : '2px solid transparent',
        backgroundColor: dragging ? 'rgba(208,176,102,0.04)' : 'transparent',
        transition: 'background-color 120ms var(--easing-shell, ease)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div style={trackedCaps(9, SAND_400)}>{eyebrow}</div>

      {name ? (
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 24,
            lineHeight: 1.15,
            color: CREAM,
            wordBreak: 'break-word',
          }}
        >
          {name}
        </div>
      ) : (
        <div style={trackedCaps(11, SAND_500)}>{emptyLabel}</div>
      )}

      {name && metaLine && (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.02em',
            color: SAND_400,
          }}
        >
          {metaLine}
        </div>
      )}
    </div>
  )
}

export function CoverSurface({
  fileAName,
  fileAFormat,
  fileADuration,
  onDropA,
  isDraggingA,
  fileBName,
  fileBFormat,
  fileBDuration,
  onDropB,
  isDraggingB,
  onSwap,
  onBeginCompare,
  onBeginRefOnly,
  canCompare,
  canRefOnly,
  onBeginBatch,
  canBatch,
  profileName,
  recents,
  onOpenRecent,
  recentsTotal,
  courseName,
  assignmentName,
  sessionCount,
}: CoverSurfaceProps) {
  const audience = useAudience()
  const eyebrow = v52Copy.cover.eyebrow[audience]
  const valueProp = v52Copy.cover.valueProp[audience]
  const fileALabel = `FILE A · ${v52Copy.slots.fileA}`
  const fileBLabel = `FILE B · ${v52Copy.slots.fileB[audience]}`
  const dropAPlaceholder = v52Copy.slots.dropA
  const dropBPlaceholder = v52Copy.slots.dropB[audience]
  const greeting = v52Copy.cover.greeting[audience]({
    name: profileName,
    n: sessionCount,
    course: courseName,
    assignment: assignmentName,
  })

  const bothLoaded = !!fileAName && !!fileBName
  const visibleRecents = (recents ?? []).slice(0, 3)
  const totalRecents = recentsTotal ?? (recents?.length ?? 0)
  const remainder = Math.max(0, totalRecents - visibleRecents.length)

  return (
    <section
      aria-label="RTMcompare cover"
      className="grid grid-cols-12 gap-8"
      style={{
        minHeight: '100vh',
        padding: 'clamp(32px, 5vw, 64px)',
        backgroundColor: 'var(--color-bg-app)',
        position: 'relative',
      }}
    >
      {/* Masthead — cols 1-8 */}
      <header className="col-span-12 md:col-span-8" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 'var(--text-wordmark-hero)',
            lineHeight: 1,
            color: CREAM,
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          RTM<span style={{ color: SAND_400 }}>·</span>Compare
        </h1>

        <div style={{ width: '30%', height: 1, backgroundColor: GOLD }} />

        <div style={trackedCaps(11, SAND_400)}>{eyebrow}</div>

        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 22,
            lineHeight: 1.3,
            color: CREAM,
            marginTop: 4,
            maxWidth: '32ch',
          }}
        >
          {valueProp}
        </div>
      </header>

      {/* File slots — full-width row */}
      <div
        className="col-span-12"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1px 1fr',
          alignItems: 'stretch',
          marginTop: 8,
          border: `1px solid ${SAND_700}`,
          borderLeft: 'none',
          borderRight: 'none',
          position: 'relative',
        }}
      >
        <FileSlot
          eyebrow={fileALabel}
          name={fileAName}
          emptyLabel={dropAPlaceholder}
          format={fileAFormat}
          duration={fileADuration}
          onDrop={onDropA}
          isDragging={isDraggingA}
          bothLoaded={bothLoaded}
        />
        <div style={{ backgroundColor: SAND_700 }} />
        <FileSlot
          eyebrow={fileBLabel}
          name={fileBName}
          emptyLabel={dropBPlaceholder}
          format={fileBFormat}
          duration={fileBDuration}
          onDrop={onDropB}
          isDragging={isDraggingB}
          bothLoaded={bothLoaded}
        />

        {onSwap && (fileAName || fileBName) && (
          <button
            type="button"
            onClick={onSwap}
            aria-label="Swap reference and master"
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 32,
              height: 32,
              backgroundColor: 'var(--color-bg-app)',
              border: `1px solid ${SAND_700}`,
              borderRadius: 2,
              color: SAND_300,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
            }}
          >
            ⇄
          </button>
        )}
      </div>

      {/* CTA row */}
      <div className="col-span-12" style={{ display: 'flex', alignItems: 'baseline', gap: 28, marginTop: 8 }}>
        <button
          type="button"
          onClick={canCompare ? onBeginCompare : undefined}
          disabled={!canCompare}
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: canCompare ? CREAM : SAND_500,
            backgroundColor: 'transparent',
            border: `1px solid ${canCompare ? SAND_300 : SAND_700}`,
            borderRadius: 2,
            padding: '12px 22px',
            cursor: canCompare ? 'pointer' : 'not-allowed',
            transition: 'border-color 120ms var(--easing-shell, ease)',
          }}
        >
          Begin comparison →
        </button>

        <button
          type="button"
          onClick={canRefOnly ? onBeginRefOnly : undefined}
          disabled={!canRefOnly}
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            color: canRefOnly ? SAND_300 : SAND_500,
            background: 'transparent',
            border: 'none',
            cursor: canRefOnly ? 'pointer' : 'not-allowed',
            textDecoration: 'underline',
            textDecorationColor: SAND_700,
            textUnderlineOffset: 4,
            padding: 0,
          }}
        >
          Analyse reference only
        </button>

        {onBeginBatch && canBatch && (
          <button
            type="button"
            onClick={onBeginBatch}
            className="text-[11px] tracking-[0.12em] uppercase border-b border-dotted hover:opacity-80"
            style={{
              color: 'var(--color-text-muted)',
              borderColor: 'var(--color-text-muted)',
              background: 'transparent',
              padding: '4px 0',
            }}
          >
            Analyse an album →
          </button>
        )}
      </div>

      {/* Bottom-right: recents + greeting */}
      <aside
        className="col-span-12 md:col-start-8 md:col-span-5"
        style={{
          marginTop: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          alignItems: 'flex-end',
          textAlign: 'right',
        }}
      >
        {visibleRecents.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={trackedCaps(9, SAND_400)}>Recent ({totalRecents})</div>
            {visibleRecents.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={onOpenRecent ? () => onOpenRecent(r.id) : undefined}
                style={{
                  fontFamily: 'var(--font-display)',
                  fontStyle: 'italic',
                  fontWeight: 400,
                  fontSize: 14,
                  color: SAND_200,
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: onOpenRecent ? 'pointer' : 'default',
                  textAlign: 'right',
                }}
              >
                — {r.title}
              </button>
            ))}
            {remainder > 0 && (
              <span style={{ ...trackedCaps(9, SAND_500), marginTop: 2 }}>+ {remainder} more</span>
            )}
          </div>
        )}

        <div style={{ width: '30%', height: 1, backgroundColor: SAND_700 }} />

        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 14,
            color: SAND_300,
            maxWidth: '36ch',
          }}
        >
          {greeting}
        </div>

        {/* Audience switcher — discoverable per-tab override.
            Replaces the DevTools-only localStorage workaround. */}
        <div
          className="mt-4 flex gap-3 items-center"
          style={{ fontSize: '9px', letterSpacing: '0.16em' }}
        >
          <span style={{ color: SAND_400, textTransform: 'uppercase' }}>VIEW AS</span>
          {(['pro', 'producer', 'student', 'teacher'] as Audience[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAudienceOverride(a)}
              style={{
                color: a === audience ? CREAM : SAND_400,
                textTransform: 'uppercase',
                background: 'transparent',
                border: 'none',
                padding: '2px 0',
                borderBottom: a === audience ? `1px solid ${GOLD}` : '1px solid transparent',
                cursor: 'pointer',
                letterSpacing: '0.16em',
                fontSize: '9px',
              }}
            >
              {a}
            </button>
          ))}
        </div>
      </aside>
    </section>
  )
}

export default CoverSurface
