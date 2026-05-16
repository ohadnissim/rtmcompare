import React from 'react'
import { useLearnMode } from '../../context/LearnModeContext'
import MetricExplainer from '../learn/MetricExplainer'

/**
 * MetricCell — single column of the v5.2 metric strip.
 *
 * Three stacked lines:
 *   eyebrow → tracked all-caps label, sand-muted, 9px
 *   value   → Didone numeral, cream, 28px
 *   delta   → Didone smaller, sand-secondary by default,
 *             violation colour when `violation === true`
 *
 * Pure presentational. The strip composes these and feeds them
 * data; this cell does no logic of its own.
 *
 * Mono is INTENTIONALLY not used here. Per the philosophy, hero
 * metrics are proper names and get the Didone treatment; mono is
 * reserved for tabular data inside panels (Loudness Over Time,
 * batch results). Don't be tempted to switch — re-read
 * `.rtm-design/philosophy.md` if uncertain.
 *
 * Accessibility:
 *   - The cell announces as a single phrase by combining eyebrow +
 *     value + delta into the visual root's `aria-label`. Inner
 *     text nodes get `aria-hidden` so the SR doesn't read each line
 *     separately and produce a stuttering announcement.
 *   - Optional `tooltip` renders via the native `title` attr — no
 *     custom tooltip widget, no portal. The OverflowMenu (task #10)
 *     is the only place we need a richer tooltip layer; cells are
 *     read at a glance.
 */
// Maps the `eyebrow` label (all-caps, as shown in the UI) to a METRIC_EXPLAINERS key.
const EYEBROW_TO_KEY: Record<string, string> = {
  'LUFS-I': 'lufs_i',
  'TRUE PEAK': 'true_peak',
  'TRUEPEAK': 'true_peak',
  'TP': 'true_peak',
  'LRA': 'lra',
  'DR': 'dynamic_range',
  'PLR': 'plr',
  'MONO': 'mono_compat',
  'MONO COMPAT': 'mono_compat',
  'WIDTH': 'stereo_width',
  'STEREO WIDTH': 'stereo_width',
  'ΔL': 'loudness_diff',
  'LOUDNESS DIFF': 'loudness_diff',
  'MASK': 'masking_overlap',
  'MASKING': 'masking_overlap',
  'DIST': 'distortion',
  'DISTORTION': 'distortion',
  'CLICKS': 'click_count',
  'CLICK COUNT': 'click_count',
  'TONAL': 'tonal_deviation',
  'HUM': 'hum_severity',
  'DIALOG': 'dialog_gate',
  'TRANS': 'transient_density',
  'TRANSIENTS': 'transient_density',
  // New entries for the extended METRIC_EXPLAINERS keys
  'QUALITY': 'visqol_mos',
  'MOS': 'visqol_mos',
  'VISQOL': 'visqol_mos',
  'GEN LOSS': 'generation_loss',
  'GENERATION LOSS': 'generation_loss',
  'AI ORIGIN': 'generation_loss',
  'LIMITER': 'limiter_artefacts',
  'ARTEFACTS': 'limiter_artefacts',
  'LIMITER ARTEFACTS': 'limiter_artefacts',
  'CREST': 'crest_factor',
  'CREST FACTOR': 'crest_factor',
  'PLR PLAUS': 'plr_plausibility',
  'PLR CHECK': 'plr_plausibility',
  'PSR': 'plr_plausibility',
  'BROADBAND': 'broadband_gain',
  'BROADBAND GAIN': 'broadband_gain',
  'LRA DELTA': 'lra_delta',
  'ΔLRA': 'lra_delta',
  'PLATFORM': 'streaming_platform',
  'STREAMING': 'streaming_platform',
  'STREAM': 'streaming_platform',
  'EQ MATCH': 'eq_match_band',
  'EQ BAND': 'eq_match_band',
}

interface Props {
 eyebrow: string
 value: string
 delta?: string
 violation?: boolean
 tooltip?: string
}

export default function MetricCell({ eyebrow, value, delta, violation = false, tooltip }: Props) {
 const { enabled } = useLearnMode()
 const metricKey = EYEBROW_TO_KEY[eyebrow.toUpperCase()] ?? EYEBROW_TO_KEY[eyebrow] ?? ''
 // Build the SR phrase up front. Keep it natural-sounding. We avoid
 // embedding the unicode minus sign by transcribing to "minus" so
 // VoiceOver doesn't say "dash". Likewise "+" → "plus". Numbers
 // come through as-is because tabular announcement is the convention.
 const sr = [
 eyebrow,
 transcribeNumber(value),
 delta ? `delta ${transcribeNumber(delta)}` : null,
 violation ? '— out of tolerance' : null,
 ]
 .filter(Boolean)
 .join(', ')

 const cell = (
 <div
 role="group"
 aria-label={sr}
 title={tooltip}
 style={{
 display: 'flex',
 flexDirection: 'column',
 alignItems: 'flex-start',
 gap: 4,
 }}
 data-cell={eyebrow}
 >
 <span
 aria-hidden
 style={{
 fontFamily: 'var(--font-sans)',
 fontWeight: 500,
 fontSize: 'var(--text-metric-eyebrow)',
 letterSpacing: 'var(--tracking-metric-eyebrow)',
 textTransform: 'uppercase',
 color: 'var(--color-text-muted)',
 lineHeight: 1,
 }}
 >
 {eyebrow}
 </span>

 <div
 aria-hidden
 style={{
 display: 'flex',
 alignItems: 'baseline',
 gap: 8,
 }}
 >
 <span
 style={{
 fontFamily: 'var(--font-display)',
 fontWeight: 400,
 fontSize: 'var(--text-metric-value)',
 lineHeight: 'var(--leading-metric-value)',
 letterSpacing: 'var(--tracking-metric-value)',
 color: 'var(--color-text-primary)',
 textShadow: 'none',
 }}
 >
 {value}
 </span>

 {delta && (
 <span
 style={{
 fontFamily: 'var(--font-display)',
 fontWeight: 400,
 fontSize: 'var(--text-metric-delta)',
 lineHeight: 'var(--leading-metric-delta)',
 color: violation
 ? 'var(--color-violation)'
 : 'var(--color-text-secondary)',
 textShadow: 'none',
 }}
 >
 {delta}
 </span>
 )}
 </div>
 </div>
 )

 if (enabled && metricKey) {
 return (
 <MetricExplainer metricKey={metricKey} value={value} violation={violation}>
 {cell}
 </MetricExplainer>
 )
 }

 return cell
}

// Replace common numeric punctuation so screen readers read values
// the way an engineer would say them aloud.
function transcribeNumber(s: string): string {
 return s
 .replace(/−/g, 'minus ') // unicode minus
 .replace(/^-/, 'minus ')
 .replace(/^\+/, 'plus ')
 .replace(/\bdB\b/g, 'decibels')
 .replace(/\bdBTP\b/g, 'decibels true peak')
 .replace(/\bLU\b/g, 'loudness units')
 .replace(/\bLUFS\b/g, 'loudness units full scale')
}
