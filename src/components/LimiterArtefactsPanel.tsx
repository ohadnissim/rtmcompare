import React from 'react'
import { AnalysisResult } from '../types'

/**
 * Limiter-artefact surface. The backend (python/limiter_artefacts.py) emits a
 * four-way severity + confidence plus three granular scores:
 *   - pump_score                (0..1, how obvious limiter pumping is)
 *   - intersample_over_per_min  (ISO peaks / min, will clip on D/A)
 *   - ringing_events            (HF ringing events on transients)
 *
 * Previously only the severity + issues[] was surfaced (via AttentionList);
 * this compact row exposes the raw numbers so engineers can triage the why
 * without reading the issue copy. One glance: colour = severity, tooltip =
 * definition, number = the actual measurement.
 */

type LimiterArtefacts = NonNullable<AnalysisResult['limiter_artefacts']>

const BRAND = {
  gold: 'var(--color-accent)',
  cream: 'var(--color-text-primary)',
  red: 'var(--color-danger)',
  amber: 'var(--color-data-warn)',
  muted: 'var(--color-text-muted)',
} as const

/** Severity badge colours — match the broader QC vocab used across panels. */
function severityColours(severity: LimiterArtefacts['severity']) {
  switch (severity) {
    case 'problem':
      return { fg: BRAND.red, bg: 'rgba(224,90,90,0.1)', label: 'Problem' }
    case 'warning':
      return { fg: 'var(--color-accent)', bg: 'rgba(150,128,58,0.1)', label: 'Warning' }
    case 'advisory':
      return { fg: BRAND.amber, bg: 'rgba(224,122,79,0.1)', label: 'Advisory' }
    case 'clean':
    default:
      return { fg: 'var(--color-data-pass)', bg: 'rgba(110,197,119,0.1)', label: 'Clean' }
  }
}

/** Confidence pill colours — high = gold, medium = cream, low = muted. */
function confidenceColours(confidence: LimiterArtefacts['confidence']) {
  switch (confidence) {
    case 'high':
      return { fg: BRAND.gold, bg: 'rgba(208,176,102,0.12)' }
    case 'medium':
      return { fg: BRAND.cream, bg: 'rgba(235,231,224,0.08)' }
    case 'low':
    default:
      return { fg: BRAND.muted, bg: 'rgba(141,134,123,0.12)' }
  }
}

/** Pump score: >0.5 = red, 0.3..0.5 = amber, else muted. */
function pumpColour(v: number): string {
  if (v > 0.5) return BRAND.red
  if (v >= 0.3) return BRAND.amber
  return BRAND.muted
}

/** ISO /min: >5 = red, 0.5..5 = amber, else muted. */
function isoColour(v: number): string {
  if (v > 5) return BRAND.red
  if (v >= 0.5) return BRAND.amber
  return BRAND.muted
}

/** Ringing events: >15 = red, 5..15 = amber, else muted. */
function ringingColour(v: number): string {
  if (v > 15) return BRAND.red
  if (v >= 5) return BRAND.amber
  return BRAND.muted
}

interface Props {
  artefacts: LimiterArtefacts
  /** Compact mode drops the issues list (used where attention rows cover it). */
  compact?: boolean
}

export default function LimiterArtefactsPanel({ artefacts, compact }: Props) {
  const sev = severityColours(artefacts.severity)
  const conf = confidenceColours(artefacts.confidence)

  const pump = artefacts.pump_score ?? 0
  const iso = artefacts.intersample_over_per_min ?? 0
  const ring = artefacts.ringing_events ?? 0

  return (
    <div
      className="border px-3 py-2.5 space-y-2"
      style={{ borderRadius: '2px', borderColor: 'rgba(168,161,150,0.18)', backgroundColor: 'rgba(31,27,23,0.35)' }}
    >
      {/* Severity headline + confidence pill */}
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="text-[9px] uppercase tracking-[0.16em]"
          style={{ color: BRAND.gold }}
        >
          Limiter artefacts
        </span>
        <span
          className="text-[10px] px-2 py-0.5 rounded-full"
          style={{ color: sev.fg, backgroundColor: sev.bg }}
          title="Highest-severity finding from the limiter-artefact detector (pumping, inter-sample overs, HF ringing)."
        >
          {sev.label}
        </span>
        <span
          className="text-[9px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-full"
          style={{ color: conf.fg, backgroundColor: conf.bg }}
          title="Detector confidence. High = multiple probes agree. Medium = single strong probe. Low = weak / single-indicator hit, down-weighted in the verdict."
        >
          {artefacts.confidence} conf
        </span>
      </div>

      {/* 3-cell metrics strip */}
      <div className="grid grid-cols-3 gap-2">
        <MetricCell
          label="Pump"
          value={isFinite(pump) ? pump.toFixed(2) : '—'}
          colour={pumpColour(pump)}
          tooltip="Limiter pumping score - 0 is invisible, 1 is obvious at any listen."
        />
        <MetricCell
          label="ISO"
          value={isFinite(iso) ? `${iso.toFixed(1)} /min` : '—'}
          colour={isoColour(iso)}
          tooltip="Inter-sample overs per minute. Non-zero values will clip on D/A conversion."
        />
        <MetricCell
          label="Ring"
          value={String(ring)}
          colour={ringingColour(ring)}
          tooltip="HF ringing events on transients. More than 5 means the attack is too fast."
        />
      </div>

      {/* Issues list - omitted in compact mode (Attention rows already cover it). */}
      {!compact && artefacts.issues && artefacts.issues.length > 0 && (
        <ul className="space-y-1 text-[11px] pt-1" style={{ color: 'var(--color-sand-300)' }}>
          {artefacts.issues.map((issue, i) => (
            <li key={i} className="flex items-start gap-2">
              <span style={{ color: sev.fg }}>!</span>
              <span className="flex-1">{issue}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MetricCell({
  label,
  value,
  colour,
  tooltip,
}: {
  label: string
  value: string
  colour: string
  tooltip: string
}) {
  return (
    <div
      className="rounded px-2 py-1.5 flex flex-col gap-0.5"
      style={{ backgroundColor: 'rgba(235,231,224,0.035)' }}
      title={tooltip}
    >
      <span
        className="text-[9px] uppercase tracking-[0.14em]"
        style={{ color: BRAND.muted }}
      >
        {label}
      </span>
      <span className="text-[13px] font-medium tabular-nums" style={{ color: colour }}>
        {value}
      </span>
    </div>
  )
}
