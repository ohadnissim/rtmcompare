import React from 'react'
import MetricCell from './MetricCell'

/**
 * MetricStrip — the v5.2 instrument row. A horizontal row of
 * `<MetricCell />` instances, staggered fade-in from 0.4 → 1
 * opacity over `--duration-stagger-cell`, each cell delayed by
 * `--duration-stagger-step × index`.
 *
 * The strip is presentational. The data shape is what callers
 * pass; the strip does not compute anything. Each cell entry can
 * supply its own `violation` flag (typically computed via
 * `metricSpecs.isViolation`), or omit the flag entirely.
 *
 * Reduced-motion: when `prefers-reduced-motion: reduce` is set,
 * the stagger is suppressed via the `@media` rule below — every
 * cell renders at full opacity instantly.
 *
 * Layout: flex-wrap allowed; below ~960px the strip becomes a
 * horizontally scrollable row with a fade gradient at the right
 * edge to indicate overflow. The fade is the ONLY gradient
 * permitted in v2 (see `.rtm-design/v5.2-anti-ai-design.md` rule
 * #1's exception clause) because it serves overflow legibility.
 */
export interface MetricStripCell {
 key: string
 eyebrow: string
 value: string
 delta?: string
 violation?: boolean
 tooltip?: string
}

interface Props {
 cells: MetricStripCell[]
 className?: string
}

export default function MetricStrip({ cells, className }: Props) {
 return (
 <>
 <style>{STAGGER_STYLES}</style>
 <div
 role="group"
 aria-label="Loudness summary"
 className={className}
 data-rtm-metric-strip
 style={{
 display: 'flex',
 flexWrap: 'wrap',
 alignItems: 'center',
 gap: '32px',
 paddingTop: 6,
 paddingBottom: 6,
 // overflow handling for narrow widths handled via media query
 // in the embedded styles tag below.
 }}
 >
 {cells.map((c, i) => (
 <div
 key={c.key}
 className="rtm-metric-stagger"
 style={
 {
 ['--rtm-cell-index' as string]: String(i),
 } as React.CSSProperties
 }
 >
 <MetricCell
 eyebrow={c.eyebrow}
 value={c.value}
 delta={c.delta}
 violation={c.violation}
 tooltip={c.tooltip}
 />
 </div>
 ))}
 </div>
 </>
 )
}

// Stagger animation lives next to the component because (a) it's
// only ever consumed by this strip and (b) we want it to disappear
// completely under reduced-motion. Keeping it inline as a <style>
// node preserves SSR / hydration correctness without bringing in
// a CSS-in-JS dependency the project doesn't already use.
const STAGGER_STYLES = `
 @keyframes rtm-metric-fade {
   from { opacity: 0.4; }
   to   { opacity: 1; }
 }
 .rtm-metric-stagger {
   opacity: 1;
   animation: rtm-metric-fade var(--duration-stagger-cell) var(--easing-shell) both;
   animation-delay: calc(var(--duration-stagger-step) * var(--rtm-cell-index, 0));
 }
 @media (prefers-reduced-motion: reduce) {
   .rtm-metric-stagger {
     animation: none;
     opacity: 1;
   }
 }
 @media (max-width: 960px) {
   [data-rtm-metric-strip] {
     flex-wrap: nowrap;
     overflow-x: auto;
     mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 32px), transparent 100%);
   }
 }
`
