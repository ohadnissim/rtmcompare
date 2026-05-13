import React from 'react'

/**
 * WidthPerBandChart — per-octave-band stereo width comparison.
 * A: reference (white bars), B: current (gold bars).
 * 0 = mono, 1 = fully decorrelated.
 */

const BANDS = ['63', '125', '250', '500', '1k', '2k', '4k', '8k']
const BAR_HEIGHT = 80  // px, the total chart height

interface Props {
  widthA?: number[]  // 8 values
  widthB?: number[]  // 8 values
}

export default function WidthPerBandChart({ widthA, widthB }: Props) {
  const hasA = Array.isArray(widthA) && widthA.length > 0
  const hasB = Array.isArray(widthB) && widthB.length > 0

  if (!hasA && !hasB) return null

  return (
    <div style={{ width: '100%', padding: '8px 0' }}>
      {/* Header row: title + legend */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.16em' }}>
          Stereo Width per Band
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <div style={{ width: 8, height: 8, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 1 }} />
            <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>A</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <div style={{ width: 8, height: 8, backgroundColor: 'rgba(208,176,102,0.55)', borderRadius: 1 }} />
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
          <span style={{ fontSize: 8, color: 'var(--color-text-muted)', lineHeight: 1 }}>100%</span>
          <span style={{ fontSize: 8, color: 'var(--color-text-muted)', lineHeight: 1 }}>50%</span>
          <span style={{ fontSize: 8, color: 'var(--color-text-muted)', lineHeight: 1 }}>0</span>
        </div>

        {/* Band column groups */}
        <div style={{ display: 'flex', flex: 1, gap: 2, alignItems: 'flex-end' }}>
          {BANDS.map((band, i) => {
            const valA = hasA ? (widthA![i] ?? 0) : null
            const valB = hasB ? (widthB![i] ?? 0) : null

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
                    <div
                      style={{
                        width: 10,
                        height: Math.max(2, valB * BAR_HEIGHT),
                        backgroundColor: 'rgba(208,176,102,0.55)',
                        borderRadius: '1px 1px 0 0',
                      }}
                      title={`B ${band} Hz: ${(valB * 100).toFixed(0)}%`}
                    />
                  )}
                </div>

                {/* Freq label */}
                <span style={{ fontSize: 8, color: 'var(--color-text-muted)', textAlign: 'center', lineHeight: 1 }}>
                  {band}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
