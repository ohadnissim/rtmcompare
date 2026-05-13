/**
 * Certificate.tsx — v5.2 four-variant certificate renderer.
 *
 * Single component parameterized by `audience`. Renders an A4 portrait page
 * on cream paper with Console Didone aesthetic: ink type, single gold accent,
 * Instrument Serif italic hero, JetBrains Mono tracked-caps eyebrows,
 * 2px verdict left-rule, 4-up metric grid, signature footer with 4×4 gold
 * diamond.
 *
 * All type, color, and spacing forced INLINE — dark-mode body tokens must
 * never invert the printed page. Hardcoded paper palette.
 *
 * Multi-page (teacher gradebook) — if `students` array is present, the first
 * page is the cohort cover and subsequent pages are mini-verdicts, separated
 * by page-break-after: always.
 *
 * See `.rtm-design/v5.2-certificate.md` for the moonshot artifact spec.
 */

import React from 'react'
import { v52Copy } from '../../copy/v52'

export type CertificateAudience = 'pro' | 'producer' | 'student' | 'teacher'
export type CertificateVerdict = 'ok' | 'caution' | 'fail'

export interface CertificateMetric {
  /** Tracked-caps eyebrow, e.g. "LUFS-I". */
  label: string
  /** Displayed numeral as a string — caller formats. */
  value: string
  /** Tracked-caps unit suffix, e.g. "LU", "dBTP". */
  unit?: string
  /** If false, render with subtle danger left-rule on the metric cell. */
  inSpec?: boolean
}

export interface CertificateStudent {
  name: string
  verdict: CertificateVerdict
  verdictWord: string
  metaLine: string
  metrics: CertificateMetric[]
  issues?: string[]
}

export interface CertificateProps {
  audience: CertificateAudience
  trackTitle: string
  /** "ARTIST · ALBUM · YEAR · LABEL" — caller composes. */
  metaLine: string
  verdict: CertificateVerdict
  /** Pulled from `v52Copy.verdict.states[audience]` by the caller. */
  verdictWord: string
  /** One-line italic body — optional. */
  caption?: string
  /** 3–6 metrics shown in the grid. */
  metrics: CertificateMetric[]
  /** Top 3 attention items — optional block. */
  issues?: string[]
  /** 8-char id from the print orchestrator. */
  certId: string
  /** 12-char SHA truncation. */
  shaTrunc: string
  timestamp: string
  /** Composed signature line — from `v52Copy.certificate.signature[audience]`. */
  signature: string
  /** Override the masthead from the copy bank — optional. */
  masthead?: string
  /** Teacher variant only — multi-page cohort gradebook. */
  students?: CertificateStudent[]
  /** Teacher cover-page extras. */
  courseTitle?: string
  cohortSize?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Console Didone paper palette — hardcoded so dark-mode tokens cannot invert
// the printed page. Do not refactor to CSS variables.
// ─────────────────────────────────────────────────────────────────────────────
const PAPER = '#ebe7e0'
const INK = '#0e0d0b'
const INK_MUTED = '#3e3a33'
const GOLD = '#d0b066'
const SUCCESS = '#5a8a6a'
const CAUTION = '#c9a15f'
const DANGER = '#b85450'
const HAIRLINE = '#a8a196'

const SERIF = "'Instrument Serif', Georgia, serif"
const MONO = "'JetBrains Mono', ui-monospace, monospace"

function severityColor(v: CertificateVerdict): string {
  if (v === 'ok') return SUCCESS
  if (v === 'caution') return CAUTION
  return DANGER
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout primitives — inline-styled, no Tailwind, no tokens.
// ─────────────────────────────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  width: '210mm',
  height: '297mm',
  padding: '18mm',
  boxSizing: 'border-box',
  position: 'relative',
  overflow: 'hidden',
  background: PAPER,
  color: INK,
  fontFamily: SERIF,
  // First page no break before; subsequent pages handled via wrapper.
  pageBreakAfter: 'always',
}

const trackedCaps = (size: number, color: string = INK): React.CSSProperties => ({
  fontFamily: MONO,
  fontSize: `${size}px`,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color,
  fontWeight: 400,
  lineHeight: 1.2,
})

const italicHero = (size: number, color: string = INK): React.CSSProperties => ({
  fontFamily: SERIF,
  fontStyle: 'italic',
  fontSize: `${size}px`,
  color,
  lineHeight: 1.02,
  fontWeight: 400,
  letterSpacing: '-0.01em',
})

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface MastheadProps {
  audience: CertificateAudience
  override?: string
}

const Masthead: React.FC<MastheadProps> = ({ audience, override }) => {
  const masthead = override ?? v52Copy.certificate.masthead[audience]
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '14mm',
      }}
    >
      <div style={trackedCaps(11, INK)}>RTM·COMPARE</div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
        <div style={trackedCaps(11, INK_MUTED)}>{masthead}</div>
        <div style={{ width: '60mm', height: '1px', background: GOLD }} />
      </div>
    </div>
  )
}

const Hero: React.FC<{ title: string; metaLine: string }> = ({ title, metaLine }) => (
  <div style={{ marginBottom: '10mm' }}>
    <div style={italicHero(96)}>{title}</div>
    <div style={{ ...trackedCaps(11, INK_MUTED), marginTop: '6mm' }}>{metaLine}</div>
  </div>
)

const VerdictBlock: React.FC<{
  verdict: CertificateVerdict
  verdictWord: string
  caption?: string
}> = ({ verdict, verdictWord, caption }) => {
  const rule = severityColor(verdict)
  return (
    <div
      style={{
        borderLeft: `2px solid ${rule}`,
        paddingLeft: '8mm',
        marginBottom: '10mm',
      }}
    >
      <div style={italicHero(96, INK)}>{verdictWord}</div>
      {caption ? (
        <div
          style={{
            fontFamily: SERIF,
            fontStyle: 'italic',
            fontSize: '14px',
            color: INK_MUTED,
            marginTop: '4mm',
            lineHeight: 1.45,
          }}
        >
          {caption}
        </div>
      ) : null}
    </div>
  )
}

const MetricCell: React.FC<{ m: CertificateMetric }> = ({ m }) => {
  const danger = m.inSpec === false
  return (
    <div
      style={{
        borderLeft: danger ? `2px solid ${DANGER}` : `1px solid ${HAIRLINE}`,
        paddingLeft: '4mm',
        paddingTop: '2mm',
        paddingBottom: '2mm',
        display: 'flex',
        flexDirection: 'column',
        gap: '2mm',
      }}
    >
      <div style={trackedCaps(10, INK_MUTED)}>{m.label}</div>
      <div
        style={{
          fontFamily: SERIF,
          fontStyle: 'italic',
          fontSize: '40px',
          color: INK,
          lineHeight: 1,
        }}
      >
        {m.value}
      </div>
      {m.unit ? <div style={trackedCaps(9, INK_MUTED)}>{m.unit}</div> : null}
    </div>
  )
}

const MetricGrid: React.FC<{ metrics: CertificateMetric[] }> = ({ metrics }) => {
  // Up to 6 metrics, 4 per row.
  const cols = Math.min(metrics.length, 4)
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: '6mm',
        marginBottom: '10mm',
      }}
    >
      {metrics.slice(0, 6).map((m, i) => (
        <MetricCell key={`${m.label}-${i}`} m={m} />
      ))}
    </div>
  )
}

const IssuesBlock: React.FC<{ issues: string[] }> = ({ issues }) => (
  <div style={{ marginBottom: '10mm' }}>
    <div style={{ ...trackedCaps(11, INK), marginBottom: '4mm' }}>ISSUES CAUGHT</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2mm' }}>
      {issues.slice(0, 3).map((iss, i) => (
        <div
          key={i}
          style={{
            fontFamily: SERIF,
            fontStyle: 'italic',
            fontSize: '14px',
            color: INK,
            lineHeight: 1.45,
          }}
        >
          — {iss}
        </div>
      ))}
    </div>
  </div>
)

const SignatureFooter: React.FC<{
  signature: string
  certId: string
  shaTrunc: string
  timestamp: string
}> = ({ signature, certId, shaTrunc, timestamp }) => (
  <div
    style={{
      position: 'absolute',
      left: '18mm',
      right: '18mm',
      bottom: '18mm',
    }}
  >
    <div style={{ width: '100%', height: '1px', background: INK, marginBottom: '4mm' }} />
    <div style={{ ...trackedCaps(11, INK), marginBottom: '2mm' }}>{signature}</div>
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <div style={trackedCaps(10, INK_MUTED)}>
        CERT {certId} · {shaTrunc} · {timestamp}
      </div>
      <div
        style={{
          width: '4mm',
          height: '4mm',
          background: GOLD,
          transform: 'rotate(45deg)',
        }}
      />
    </div>
  </div>
)

// ─────────────────────────────────────────────────────────────────────────────
// Page renderers
// ─────────────────────────────────────────────────────────────────────────────

interface SinglePageProps {
  audience: CertificateAudience
  trackTitle: string
  metaLine: string
  verdict: CertificateVerdict
  verdictWord: string
  caption?: string
  metrics: CertificateMetric[]
  issues?: string[]
  certId: string
  shaTrunc: string
  timestamp: string
  signature: string
  masthead?: string
  isLast?: boolean
}

const SinglePage: React.FC<SinglePageProps> = (p) => {
  const style: React.CSSProperties = {
    ...pageStyle,
    pageBreakAfter: p.isLast ? 'auto' : 'always',
  }
  return (
    <div className="certificate-page" style={style}>
      <Masthead audience={p.audience} override={p.masthead} />
      <Hero title={p.trackTitle} metaLine={p.metaLine} />
      <VerdictBlock verdict={p.verdict} verdictWord={p.verdictWord} caption={p.caption} />
      <MetricGrid metrics={p.metrics} />
      {p.issues && p.issues.length > 0 ? <IssuesBlock issues={p.issues} /> : null}
      <SignatureFooter
        signature={p.signature}
        certId={p.certId}
        shaTrunc={p.shaTrunc}
        timestamp={p.timestamp}
      />
    </div>
  )
}

interface GradebookCoverProps {
  courseTitle: string
  cohortSize: number
  signature: string
  certId: string
  shaTrunc: string
  timestamp: string
  masthead?: string
}

const GradebookCover: React.FC<GradebookCoverProps> = (p) => (
  <div className="certificate-page" style={pageStyle}>
    <Masthead audience="teacher" override={p.masthead} />
    <div style={{ marginTop: '60mm', marginBottom: '20mm' }}>
      <div style={trackedCaps(11, INK_MUTED)}>COURSE</div>
      <div style={{ ...italicHero(96), marginTop: '8mm' }}>{p.courseTitle}</div>
    </div>
    <div
      style={{
        borderLeft: `2px solid ${GOLD}`,
        paddingLeft: '8mm',
        marginBottom: '10mm',
      }}
    >
      <div style={trackedCaps(11, INK_MUTED)}>COHORT</div>
      <div style={{ ...italicHero(64), marginTop: '4mm' }}>
        {p.cohortSize} {p.cohortSize === 1 ? 'submission' : 'submissions'}
      </div>
    </div>
    <SignatureFooter
      signature={p.signature}
      certId={p.certId}
      shaTrunc={p.shaTrunc}
      timestamp={p.timestamp}
    />
  </div>
)

// ─────────────────────────────────────────────────────────────────────────────
// Top-level component
// ─────────────────────────────────────────────────────────────────────────────

export const Certificate: React.FC<CertificateProps> = (props) => {
  // Teacher gradebook — multi-page when `students` is supplied.
  if (props.audience === 'teacher' && props.students && props.students.length > 0) {
    const courseTitle = props.courseTitle ?? props.trackTitle
    const cohortSize = props.cohortSize ?? props.students.length
    return (
      <div id="certificate-print-root-inner">
        <GradebookCover
          courseTitle={courseTitle}
          cohortSize={cohortSize}
          signature={props.signature}
          certId={props.certId}
          shaTrunc={props.shaTrunc}
          timestamp={props.timestamp}
          masthead={props.masthead}
        />
        {props.students.map((s, i) => (
          <SinglePage
            key={`${s.name}-${i}`}
            audience="teacher"
            trackTitle={s.name}
            metaLine={s.metaLine}
            verdict={s.verdict}
            verdictWord={s.verdictWord}
            metrics={s.metrics}
            issues={s.issues}
            certId={props.certId}
            shaTrunc={props.shaTrunc}
            timestamp={props.timestamp}
            signature={props.signature}
            masthead={props.masthead}
            isLast={i === props.students!.length - 1}
          />
        ))}
      </div>
    )
  }

  return (
    <div id="certificate-print-root-inner">
      <SinglePage
        audience={props.audience}
        trackTitle={props.trackTitle}
        metaLine={props.metaLine}
        verdict={props.verdict}
        verdictWord={props.verdictWord}
        caption={props.caption}
        metrics={props.metrics}
        issues={props.issues}
        certId={props.certId}
        shaTrunc={props.shaTrunc}
        timestamp={props.timestamp}
        signature={props.signature}
        masthead={props.masthead}
        isLast={true}
      />
    </div>
  )
}

export default Certificate
