/**
 * metricSpecs — single source of truth for what counts as a
 * delivery-spec violation in the v5.2 metric strip and panel
 * verdicts. Used by `<MetricStrip />` and `<PanelVerdict />` to
 * decide when a delta is painted in `--color-violation`.
 *
 * Keep this file presentational-only. It does not run analysis;
 * it interprets analysis result values that the panels already
 * compute. If a tolerance changes, change it here once and every
 * v5.2 surface picks it up.
 *
 * Per `.rtm-design/v5.2-anti-ai-design.md`: violation styling is
 * the ONLY chromatic gesture beyond the active surface chip in v2.
 * Don't add violation thresholds for cosmetics — only for genuine
 * delivery-spec rules.
 */

export type MetricKey =
 | 'lufs-i'
 | 'lufs-s'
 | 'tp'
 | 'lra'
 | 'mono'
 | 'plr'
 | 'crest'

interface MetricSpec {
 /** Symmetric tolerance applied to |delta|. */
 deltaTolerance?: number
 /** Hard upper bound for the absolute value. Triggers violation. */
 absMax?: number
 /** Hard lower bound for the absolute value. */
 absMin?: number
}

/**
 * Tolerances are intentionally conservative. The point of the
 * violation paint is to surface things that would actually fail a
 * delivery QA pass — not every minor drift. Tighten only with a
 * specific delivery-spec citation.
 */
const SPECS: Record<MetricKey, MetricSpec> = {
 'lufs-i': { deltaTolerance: 1.0 },     // ±1 LU vs reference
 'lufs-s': { deltaTolerance: 2.0 },     // short-term tolerance is wider
 'tp':     { absMax: -0.3 },            // Apple/Spotify ceiling guidance
 'lra':    { deltaTolerance: 3.0 },     // ±3 LU LRA delta
 'mono':   { absMax: 0.0 },             // any phase issue trips violation
 'plr':    { deltaTolerance: 2.0 },
 'crest':  { deltaTolerance: 2.0 },
}

/**
 * Return true iff the supplied (value, delta) for `metricKey`
 * crosses tolerance. Either bound is enough to trigger.
 *
 * `value` and `delta` are numbers; if your panel has them as
 * strings (formatted with units, signs), parse them upstream and
 * pass the numeric form here.
 */
export function isViolation(
 metricKey: MetricKey,
 value: number,
 delta?: number
): boolean {
 const spec = SPECS[metricKey]
 if (!spec) return false
 if (spec.deltaTolerance != null && delta != null && Math.abs(delta) > spec.deltaTolerance) return true
 if (spec.absMax != null && value > spec.absMax) return true
 if (spec.absMin != null && value < spec.absMin) return true
 return false
}

/**
 * Return a one-line tooltip explaining the spec. Used by
 * MetricCell's `tooltip` prop so a user hovering a cell can see
 * which target the value is being measured against.
 */
export function specTooltip(metricKey: MetricKey): string | undefined {
 switch (metricKey) {
 case 'lufs-i':
 return 'Integrated loudness. Tolerance: ±1 LU vs reference.'
 case 'lufs-s':
 return 'Short-term loudness. Tolerance: ±2 LU vs reference.'
 case 'tp':
 return 'True peak. Apple Music / Spotify ceiling: −0.3 dBTP.'
 case 'lra':
 return 'Loudness range. Tolerance: ±3 LU vs reference.'
 case 'mono':
 return 'Mono compatibility. Any negative correlation trips.'
 case 'plr':
 return 'Peak-to-loudness ratio. Tolerance: ±2 vs reference.'
 case 'crest':
 return 'Crest factor. Tolerance: ±2 vs reference.'
 default:
 return undefined
 }
}
