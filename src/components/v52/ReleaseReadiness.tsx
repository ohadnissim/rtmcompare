import React from 'react'
import { printReleaseCard, type CertificateMetric } from '../../lib/certificate'

/**
 * ReleaseReadiness — Move 4, the producer-mode replacement for the analysis
 * cockpit.
 *
 * Four streaming platforms stacked as hairline rows. Each row carries a
 * severity-coloured 2px left-rule, tracked-caps platform + target spec, live
 * values in JetBrains Mono (cream pass, warm-amber drift, warm-red fail), and
 * a single Δ value in Instrument Serif italic gold — the gold of the row.
 *
 * Below: a full-width "Master for release" gold CTA (only when every platform
 * passes). Beside: a "What to fix" column with up to three italic bullets.
 *
 * Console Didone: ink + cream + one gold per row (Δ), one gold per surface
 * (the CTA). 2px corners. No gradients, no shadows.
 */

export interface PlatformSpec {
  name: 'Spotify' | 'Apple Music' | 'YouTube Music' | 'Tidal'
  /** Target integrated loudness, e.g. -14 or -16. */
  targetLufs: number
  /** Max true-peak in dBTP, typically -1. */
  maxPeakDbtp: number
  /** Optional max LRA in LU. */
  maxLraLu?: number
}

export interface PlatformResult {
  platform: PlatformSpec
  currentLufs: number
  currentPeakDbtp: number
  currentLraLu?: number
  status: 'pass' | 'drift' | 'fail'
}

export interface ReleaseReadinessProps {
  trackTitle: string
  /** 4 — Spotify / Apple / YouTube / Tidal */
  platforms: PlatformResult[]
  /** Top 3 "what to fix" items. */
  issues: string[]
  onMasterForRelease: () => void
  canMaster: boolean
  /** Optional alternative CTA — replaces the default when present. */
  actionSlot?: React.ReactNode
}

const SAND_700 = 'rgba(168,161,150,0.22)'
const SAND_400 = 'var(--color-text-muted)'
const SAND_300 = 'var(--color-text-secondary)'
const SAND_200 = '#cfc8bb'
const CREAM = 'var(--color-text-primary)'
const GOLD = 'var(--color-accent)'
const INK = 'var(--color-bg-app)'

const STATUS_COLOR: Record<PlatformResult['status'], string> = {
  pass: '#6ec577',
  drift: '#c5a55a',
  fail: '#c87664',
}

const VALUE_COLOR: Record<PlatformResult['status'], string> = {
  pass: CREAM,
  drift: '#c5a55a',
  fail: '#c87664',
}

const trackedCaps = (px: number, color: string): React.CSSProperties => ({
  fontFamily: 'var(--font-sans)',
  fontSize: px,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color,
  fontWeight: 500,
})

interface NumeralProps {
  value: string
  unit: string
  color: string
}

function Numeral({ value, unit, color }: NumeralProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 18,
          color,
          letterSpacing: '0.01em',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
      <span style={trackedCaps(9, SAND_400)}>{unit}</span>
    </div>
  )
}

function PlatformRow({ row }: { row: PlatformResult }) {
  const { platform, currentLufs, currentPeakDbtp, currentLraLu, status } = row
  const ruleColor = STATUS_COLOR[status]
  const valColor = VALUE_COLOR[status]
  const deltaLu = currentLufs - platform.targetLufs
  const deltaSign = deltaLu > 0 ? '+' : ''

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '2px 1fr auto auto',
        alignItems: 'center',
        gap: 20,
        padding: '18px 0 18px 22px',
        borderTop: `1px solid ${SAND_700}`,
        position: 'relative',
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: 2,
          backgroundColor: ruleColor,
        }}
      />
      {/* gridTemplateColumns first track is the rule's footprint — collapse it */}
      <span aria-hidden style={{ width: 0 }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={trackedCaps(11, SAND_200)}>
          {platform.name.toUpperCase()} <span style={{ color: SAND_400 }}>·</span> {platform.targetLufs} LUFS <span style={{ color: SAND_400 }}>·</span> {platform.maxPeakDbtp} dBTP
        </div>
        <div style={trackedCaps(9, SAND_400)}>
          {status === 'pass' ? 'Within target' : status === 'drift' ? 'Outside tolerance' : 'Exceeds spec'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}>
        <Numeral value={isFinite(currentLufs) ? currentLufs.toFixed(1) : '—'} unit="LUFS-I" color={valColor} />
        <Numeral value={isFinite(currentPeakDbtp) ? currentPeakDbtp.toFixed(1) : '—'} unit="dBTP" color={valColor} />
        <Numeral
          value={currentLraLu != null && isFinite(currentLraLu) ? currentLraLu.toFixed(1) : '—'}
          unit="LRA LU"
          color={valColor}
        />
      </div>

      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontStyle: 'italic',
          fontWeight: 400,
          fontSize: 14,
          color: GOLD,
          minWidth: 84,
          textAlign: 'right',
        }}
      >
        Δ {deltaSign}{isFinite(deltaLu) ? deltaLu.toFixed(1) : '—'} LU
      </div>
    </div>
  )
}

export function ReleaseReadiness({
  trackTitle,
  platforms,
  issues,
  onMasterForRelease,
  canMaster,
  actionSlot,
}: ReleaseReadinessProps) {
  const allPass = platforms.length > 0 && platforms.every(p => p.status === 'pass')
  const ctaEnabled = canMaster && allPass
  const visibleIssues = issues.slice(0, 3)

  // v5.2 Wave 3 — when the user fires "Master for release", run the
  // caller's handler AND print the release card. The card is a
  // receipt for the commitment.
  const handleMaster = async () => {
    onMasterForRelease()
    const first = platforms[0]
    const derivedMetrics: CertificateMetric[] = first
      ? [
          { label: 'LUFS-I', value: isFinite(first.currentLufs) ? first.currentLufs.toFixed(1) : '—', unit: 'LU' },
          { label: 'TRUE PEAK', value: isFinite(first.currentPeakDbtp) ? first.currentPeakDbtp.toFixed(1) : '—', unit: 'dBTP' },
          ...(first.currentLraLu != null
            ? [{ label: 'LRA', value: isFinite(first.currentLraLu) ? first.currentLraLu.toFixed(1) : '—', unit: 'LU' }]
            : []),
        ]
      : []
    try {
      await printReleaseCard({
        trackTitle,
        metaLine: new Date().toISOString().slice(0, 10),
        verdict: 'ok',
        metrics: derivedMetrics,
      })
    } catch {
      /* card render failure is non-blocking — caller already fired */
    }
  }

  return (
    <section
      aria-label="Release-readiness"
      style={{
        backgroundColor: INK,
        padding: 'clamp(24px, 3vw, 40px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
      }}
    >
      {/* Eyebrow band */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={trackedCaps(10, SAND_400)}>
          RELEASE-READINESS <span style={{ color: SAND_400 }}>·</span> STREAMING PLATFORMS <span style={{ color: SAND_400 }}>·</span> {platforms.length} TARGETS
        </div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 20,
            color: CREAM,
            letterSpacing: '-0.01em',
          }}
        >
          {trackTitle}
        </div>
      </div>

      <div
        className="grid grid-cols-1 lg:grid-cols-3"
        style={{ gap: 28 }}
      >
        {/* Platform stack */}
        <div className="lg:col-span-2" style={{ display: 'flex', flexDirection: 'column' }}>
          {platforms.map((p, i) => (
            <PlatformRow key={`${p.platform.name}-${i}`} row={p} />
          ))}
          <div style={{ borderTop: `1px solid ${SAND_700}` }} />
        </div>

        {/* What to fix */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={trackedCaps(10, SAND_400)}>What to fix</div>
          {visibleIssues.length === 0 ? (
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontStyle: 'italic',
                fontSize: 14,
                color: SAND_300,
              }}
            >
              Nothing to fix.
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {visibleIssues.map((it, i) => (
                <li
                  key={i}
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontStyle: 'italic',
                    fontWeight: 400,
                    fontSize: 14,
                    lineHeight: 1.4,
                    color: SAND_200,
                    display: 'flex',
                    gap: 10,
                  }}
                >
                  <span aria-hidden style={{ color: GOLD, flexShrink: 0 }}>—</span>
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {/* CTA */}
      <div style={{ marginTop: 6 }}>
        {actionSlot ? (
          actionSlot
        ) : (
          <button
            type="button"
            onClick={ctaEnabled ? handleMaster : undefined}
            disabled={!ctaEnabled}
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              fontWeight: 500,
              padding: '14px 32px',
              borderRadius: 2,
              border: ctaEnabled ? `1px solid ${GOLD}` : `1px solid ${SAND_700}`,
              backgroundColor: ctaEnabled ? GOLD : 'transparent',
              color: ctaEnabled ? INK : SAND_400,
              cursor: ctaEnabled ? 'pointer' : 'not-allowed',
              width: '100%',
              transition: 'background-color 120ms var(--easing-shell, ease)',
            }}
          >
            Master for release
          </button>
        )}
      </div>
    </section>
  )
}

export default ReleaseReadiness
