import React from 'react'

/**
 * WidthPerBandChart — per-octave-band stereo width comparison.
 *
 * Renders 8 band columns (63 Hz → 8 kHz). Each column shows two bars:
 *   A = reference track (white fill, low opacity)
 *   B = compare track  (transparent with gold border — MED-3: gold is border/text only, never fill)
 *
 * Values are 0.0 (fully mono) to 1.0 (fully decorrelated / anti-phase).
 * After CRIT-4, anti-phase stereo correctly maps to 1.0 instead of 0.0.
 *
 * @param widthA - 8 per-band width values for track A (0.0–1.0, index 0=63Hz to 7=8kHz)
 * @param widthB - 8 per-band width values for track B (0.0–1.0, same layout)
 */

const BANDS = ['63', '125', '250', '500', '1k', '2k', '4k', '8k']
const BAR_HEIGHT = 80  // px, total chart height

interface Props {
  /** Width values 0.0 (mono) to 1.0 (fully decorrelated). 8 octave bands: 63 125 250 500 1k 2k 4k 8k Hz. */
  widthA?: number[]
  /** Width values 0.0 (mono) to 1.0 (fully decorrelated). 8 octave bands: 63 125 250 500 1k 2k 4k 8k Hz. */
  widthB?: number[]
}

// MED-4: memoised — only re-renders when widthA/widthB arrays change reference.
const WidthPerBandChart = React.memo(function WidthPerBandChart({ widthA, widthB }: Props) {
  const hasA = Array.isArray(widthA) && widthA.length > 0
  const hasB = Array.isArray(widthB) && widthB.length > 0

  if (!hasA && !hasB) return null

  // MED-4: bounds guard — clamp to exactly 8 elements, default missing values to 0
  const aVals = Array.from({ length: 8 }, (_, i) => (hasA ? (widthA![i] ?? 0) : null))
  const bVals = Array.from({ length: 8 }, (_, i) => (hasB ? (widthB![i] ?? 0) : null))

  return (
    <div style={{ width: '100%', padding: '8px 0' }}>
      {/* Header row: title + legend */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.16em' }}>
          Stereo Width per Band
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            {/* A legend: white fill (consistent with all other A-track visuals) */}
            <div style={{ width: 8, height: 8, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 2 }} />
            <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>A</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            {/* MED-3 fix: B legend uses gold border (not fill). Design rule: gold = border/text only. */}
            {/* LOW-4 fix: borderRadius 2px (was 1px). */}
            <div style={{ width: 8, height: 8, backgroundColor: 'transparent', border: '1px solid rgba(208,176,102,0.7)', borderRadius: 2 }} />
            <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>B</span>
          </div>
        </div>
      </div>

      {/* Chart body: Y-axis labels + bar groups */}
      <div style={{ display: 'flex', gap: 0 }}>
        {/* Y-axis labels */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          height: BAR_HEIGHT,
          marginRight: 4,
          paddingBottom: 0,
        }}>
          <span style={{ fontSize: 9, color: 'var(--color-text-muted)', lineHeight: 1 }}>100%</span>
          <span style={{ fontSize: 9, color: 'var(--color-text-muted)', lineHeight: 1 }}>50%</span>
          <span style={{ fontSize: 9, color: 'var(--color-text-muted)', lineHeight: 1 }}>0</span>
        </div>

        {/* Band column groups */}
        <div style={{ display: 'flex', flex: 1, gap: 2, alignItems: 'flex-end' }}>
          {BANDS.map((band, i) => {
            const valA = aVals[i]
            const valB = bVals[i]

            return (
              <div
                key={band}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  flex: 1,
                  gap: 2,
                }}
              >
                {/* Bars grow upward */}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: BAR_HEIGHT }}>
                  {valA !== null && (
                    <div
                      style={{
                        width: 10,
                        height: Math.max(2, valA * BAR_HEIGHT),
                        backgroundColor: 'rgba(255,255,255,0.25)',
                        borderRadius: '1px 1px 0 0',
                      }}
                      title={`A ${band} Hz: ${(valA * 100).toFixed(0)}%`}
                    />
                  )}
                  {valB !== null && (
                    // MED-3 fix: transparent fill + gold border (was gold fill).
                    <div
                      style={{
                        width: 10,
                        height: Math.max(2, valB * BAR_HEIGHT),
                        backgroundColor: 'transparent',
                        border: '1px solid rgba(208,176,102,0.65)',
                        borderRadius: '1px 1px 0 0',
                        boxSizing: 'border-box',
                      }}
                      title={`B ${band} Hz: ${(valB * 100).toFixed(0)}%`}
                    />
                  )}
                </div>

                {/* Freq label */}
                <span style={{ fontSize: 9, color: 'var(--color-text-muted)', textAlign: 'center', lineHeight: 1 }}>
                  {band}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
})

export default WidthPerBandChart
