/**
 * RubricScoreCard — shows each rubric criterion with target, tolerance,
 * actual measured value, and score.
 *
 * Rendered at the bottom of AssignmentPanel (student-facing) whenever
 * both an assignment config and analysis results are available.
 */

import React from 'react'
import type { AssignmentConfig, AnalysisResult } from '../../types'

// ─── Unit labels per metric ──────────────────────────────────────────────────

const METRIC_UNITS: Record<string, string> = {
  lufs_i:         'LUFS',
  lra:            'LU',
  true_peak_dbtp: 'dBTP',
  plr:            'dB',
  psr:            'LU',
  stereo_width:   '',
  spectral_flux:  '',
  visqol_mos:     'MOS',
  short_term_max: 'LUFS',
  momentary_max:  'LUFS',
}

// ─── Value extractor ─────────────────────────────────────────────────────────

function getActualValue(metric: string, results: AnalysisResult): number | null {
  switch (metric) {
    case 'lufs_i':         return results.overall?.lufs_b ?? null
    case 'lra':            return results.overall?.dynamics_b ?? null
    case 'true_peak_dbtp': return results.headroom?.true_peak_b ?? null
    case 'plr':            return results.overall?.plr_b ?? null
    case 'psr':            return results.overall?.psr_b ?? null
    case 'stereo_width':   return results.overall?.width_b ?? null
    case 'spectral_flux':  return results.spectral_flux_b ?? null
    case 'visqol_mos':     return results.overall?.visqol_mos ?? null
    case 'short_term_max': return results.overall?.short_term_max_b ?? null
    case 'momentary_max':  return results.overall?.momentary_max_b ?? null
    default:               return null
  }
}

// ─── Scoring logic (mirrors Python score_criterion) ──────────────────────────

function scoreOneCriterion(
  actual: number,
  target: number,
  tolerance: number,
  points: number,
): number {
  const delta = Math.abs(actual - target)
  if (delta <= tolerance) return points
  if (delta <= tolerance * 2) return Math.round(points * 0.5)
  return 0
}

// ─── Value formatter ─────────────────────────────────────────────────────────

function formatValue(value: number, metric: string): string {
  const unit = METRIC_UNITS[metric] ?? ''
  // Negative LUFS-like values — use minus sign (not hyphen)
  const formatted = value.toFixed(1)
  const displayVal = value < 0 ? `−${Math.abs(value).toFixed(1)}` : formatted
  return unit ? `${displayVal} ${unit}` : displayVal
}

// ─── Color helpers ────────────────────────────────────────────────────────────

function rowBg(score: number, maxScore: number): string {
  if (score >= maxScore) return 'rgba(80,160,80,0.08)'
  if (score > 0) return 'rgba(200,160,40,0.08)'
  return 'rgba(160,60,60,0.08)'
}

function pctColor(pct: number): string {
  if (pct >= 80) return 'rgba(80,200,100,0.9)'
  if (pct >= 50) return 'rgba(200,170,60,0.9)'
  return 'rgba(200,80,60,0.9)'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RubricScoreCard({
  assignment,
  results,
  className,
}: {
  assignment: AssignmentConfig
  results: AnalysisResult
  className?: string
}) {
  const rubric = assignment.rubric ?? []

  // Resolve points per criterion — fall back to weight-based distribution of 100
  const totalBasePoints = rubric.reduce((acc, c) => acc + (c.points ?? 0), 0)
  const useWeights = totalBasePoints === 0

  const rows = rubric.map(criterion => {
    const pts = useWeights
      ? Math.round(criterion.weight * 100)
      : (criterion.points ?? Math.round(criterion.weight * 100))
    const actual = getActualValue(criterion.metric, results)
    const earned = actual !== null
      ? scoreOneCriterion(actual, criterion.target, criterion.tolerance, pts)
      : null
    return { criterion, pts, actual, earned }
  })

  const totalPts = rows.reduce((acc, r) => acc + r.pts, 0)
  const earnedPts = rows.reduce((acc, r) => acc + (r.earned ?? 0), 0)
  const measuredRows = rows.filter(r => r.earned !== null)
  const pct = measuredRows.length > 0 && totalPts > 0
    ? Math.round((earnedPts / totalPts) * 100)
    : null

  return (
    <div
      className={className}
      style={{
        marginTop: 20,
        border: '1px solid rgba(168,161,150,0.15)',
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '8px 12px',
          background: 'rgba(208,176,102,0.06)',
          borderBottom: '1px solid rgba(168,161,150,0.15)',
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--color-accent)',
          }}
        >
          Rubric Scorecard
        </span>
        {pct !== null ? (
          <span style={{ fontSize: 11, color: pctColor(pct), fontVariantNumeric: 'tabular-nums' }}>
            {earnedPts}&thinsp;/&thinsp;{totalPts}&thinsp;pts&ensp;
            <span style={{ fontSize: 10, opacity: 0.75 }}>({pct}%)</span>
          </span>
        ) : (
          <span style={{ fontSize: 10, color: 'var(--color-sand-400)' }}>
            {totalPts}&thinsp;pts total
          </span>
        )}
      </div>

      {/* Column header row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 90px 80px 72px',
          gap: 0,
          padding: '4px 12px',
          borderBottom: '1px solid rgba(168,161,150,0.10)',
          background: 'rgba(0,0,0,0.12)',
        }}
      >
        {['Criterion', 'Target ± Tol', 'Actual', 'Score'].map(h => (
          <span
            key={h}
            style={{
              fontSize: 9,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--color-sand-400)',
            }}
          >
            {h}
          </span>
        ))}
      </div>

      {/* Data rows */}
      {rows.map(({ criterion, pts, actual, earned }) => {
        const bg = earned !== null ? rowBg(earned, pts) : 'transparent'
        const unit = METRIC_UNITS[criterion.metric] ?? ''
        const targetStr = unit
          ? `${criterion.target} ${unit} ± ${criterion.tolerance}`
          : `${criterion.target} ± ${criterion.tolerance}`

        return (
          <div
            key={criterion.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 90px 80px 72px',
              gap: 0,
              padding: '5px 12px',
              background: bg,
              borderBottom: '1px solid rgba(168,161,150,0.08)',
              alignItems: 'center',
            }}
          >
            {/* Label */}
            <span
              style={{
                fontSize: 11,
                color: 'var(--color-text-primary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {criterion.label}
            </span>

            {/* Target ± Tolerance */}
            <span
              style={{
                fontSize: 10,
                color: 'var(--color-sand-400)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {targetStr}
            </span>

            {/* Actual value */}
            <span
              style={{
                fontSize: 11,
                color: actual !== null ? 'var(--color-sand-300)' : 'rgba(168,161,150,0.4)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {actual !== null ? formatValue(actual, criterion.metric) : '—'}
            </span>

            {/* Score */}
            <span
              style={{
                fontSize: 10,
                color: earned !== null
                  ? earned >= pts
                    ? 'rgba(80,200,100,0.85)'
                    : earned > 0
                      ? 'rgba(200,170,60,0.85)'
                      : 'rgba(200,80,60,0.75)'
                  : 'rgba(168,161,150,0.4)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {earned !== null ? `${earned} / ${pts} pts` : `— / ${pts} pts`}
            </span>
          </div>
        )
      })}

      {rubric.length === 0 && (
        <div
          style={{
            padding: '12px',
            fontSize: 11,
            color: 'var(--color-sand-400)',
            textAlign: 'center',
          }}
        >
          No rubric criteria defined.
        </div>
      )}
    </div>
  )
}
