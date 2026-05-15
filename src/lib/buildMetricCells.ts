import type { AnalysisResult } from '../types'
import type { MetricStripCell } from '../components/shell/MetricStrip'
import { isViolation, specTooltip } from './metricSpecs'

/**
 * buildMetricCells — pulls the four hero cockpit metrics out of an
 * AnalysisResult and shapes them into the v5.2 metric strip's data
 * format. Mirrors the extraction logic in AnalysisView's
 * CockpitRow (around line 1625) so both views agree on what counts
 * as the "headline" loudness summary.
 *
 * Atmos mode prefers the Atmos-native LUFS/TP values when present
 * — matching the v1 cockpit's behaviour exactly.
 *
 * Returns an empty array when results are null or missing the
 * required `overall` block. The caller can then hide the strip
 * (HeaderV2 already does, when `cells.length === 0`).
 */
export function buildMetricCells(
 results: AnalysisResult | null,
 opts: { isAtmos?: boolean } = {}
): MetricStripCell[] {
 if (!results || !results.overall) return []
 const { isAtmos = false } = opts

 const lufsA = results.overall.lufs_a
 const lufsB =
 isAtmos && results.atmos_qc?.specs?.loudness_lufs != null
 ? results.atmos_qc.specs.loudness_lufs
 : results.overall.lufs_b

 const tpA = results.headroom?.true_peak_a
 const tpB =
 isAtmos && results.atmos_qc?.specs?.true_peak_dbtp != null
 ? results.atmos_qc.specs.true_peak_dbtp
 : results.headroom?.true_peak_b

 const lraA = results.overall.dynamics_a
 const lraB = results.overall.dynamics_b

 // Mono-compat risk is 0–100, lower is better. We surface fileB
 // (the mix being evaluated). Treat anything > 0 as a soft violation
 // so any phase issue paints. The exact threshold is calibrated in
 // metricSpecs.ts.
 const monoRiskB = results.mono_compat
 ? ((results.mono_compat as { risk_b?: number; mono_loss_b_pct?: number }).risk_b ??
 results.mono_compat.mono_loss_b_pct)
 : null

 const cells: MetricStripCell[] = []

 if (lufsB != null) {
 const delta = lufsA != null ? lufsB - lufsA : null
 cells.push({
 key: 'lufs-i',
 eyebrow: 'LUFS-I',
 value: fmt(lufsB, 1),
 delta: delta != null ? `${signed(delta, 1)} LU` : undefined,
 violation: delta != null ? isViolation('lufs-i', lufsB, delta) : false,
 tooltip: specTooltip('lufs-i'),
 })
 }

 if (tpB != null) {
 const delta = tpA != null ? tpB - tpA : null
 cells.push({
 key: 'tp',
 eyebrow: 'TP',
 value: fmt(tpB, 1),
 delta: delta != null ? `${signed(delta, 1)} dB` : undefined,
 violation: isViolation('tp', tpB, delta ?? undefined),
 tooltip: specTooltip('tp'),
 })
 }

 if (lraB != null) {
 const delta = lraA != null ? lraB - lraA : null
 cells.push({
 key: 'lra',
 eyebrow: 'LRA',
 value: fmt(lraB, 1),
 delta: delta != null ? `${signed(delta, 1)} LU` : undefined,
 violation: delta != null ? isViolation('lra', lraB, delta) : false,
 tooltip: specTooltip('lra'),
 })
 }

 if (monoRiskB != null) {
 cells.push({
 key: 'mono',
 eyebrow: 'MONO',
 value: Math.round(monoRiskB).toString(),
 delta: undefined,
 violation: monoRiskB > 0,
 tooltip: specTooltip('mono'),
 })
 }

 return cells
}

// ── helpers
function fmt(n: number, digits: number): string {
 if (!isFinite(n)) return '—'
 // Use a real Unicode minus for negative values so the Didone
 // serif renders the typographically correct glyph (the ASCII
 // hyphen-minus is too short and reads as "weak" at large sizes).
 const s = n.toFixed(digits)
 return s.startsWith('-') ? `−${s.slice(1)}` : s
}

function signed(n: number, digits: number): string {
 if (!isFinite(n)) return '—'
 if (n === 0) return `±${n.toFixed(digits)}`
 if (n > 0) return `+${n.toFixed(digits)}`
 const abs = (-n).toFixed(digits)
 return `−${abs}` // unicode minus
}
