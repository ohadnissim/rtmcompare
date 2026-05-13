import React, { useState } from 'react'
import { printGradebookExport, type CertificateStudent } from '../../lib/certificate'
import { AnnotationEditor } from './AnnotationEditor'
import ErrorBoundary from '../ErrorBoundary'

/**
 * TeacherDashboard — Move 6, the teacher's top-level Learn surface.
 *
 * Editorial header (course title in Instrument Serif italic), two-column body:
 * roster on the left (cols 1-8), rubric + Export Gradebook CTA on the right
 * (cols 9-12). Single editorial gold gesture per surface: the EXPORT GRADEBOOK
 * CTA. Zero-padded student indices use a condensed display stack — the only
 * place Big Shoulders surfaces in v5.2 typography.
 *
 * Console Didone: ink ground, 2px corners, no shadows, no gradients.
 */

export type Verdict = 'ok' | 'caution' | 'fail'

export interface StudentSubmission {
  id: string
  studentName: string
  assignment: string
  submittedAt: string
  verdict: Verdict
  verdictWord?: string
  recentVerdicts?: Verdict[]
  metrics?: { lufsI: number; peakDbtp: number; lra?: number }
}

export interface RubricThreshold {
  metric: 'lufs_i' | 'peak_dbtp' | 'lra_lu'
  target: number
  tolerance: number
}

export interface TeacherDashboardProps {
  courseName: string
  teacherName: string
  assignmentBrief?: string
  rubric?: RubricThreshold[]
  submissions: StudentSubmission[]
  onOpenSubmission: (id: string) => void
  onApprove?: (id: string) => void
  onReturn?: (id: string) => void
  onExportGradebook: () => void
  actionSlot?: React.ReactNode
}

const SAND_800 = 'rgba(168,161,150,0.14)'
const SAND_700 = 'rgba(168,161,150,0.22)'
const SAND_400 = 'var(--color-text-muted)'
const SAND_300 = 'var(--color-text-secondary)'
const SAND_200 = '#cfc8bb'
const CREAM = 'var(--color-text-primary)'
const INK = 'var(--color-bg-app)'
const GOLD = 'var(--color-accent)'

const SEVERITY: Record<Verdict, string> = {
  ok: 'var(--color-success)',
  caution: 'var(--color-warning)',
  fail: 'var(--color-danger)',
}

const DEFAULT_VERDICT_WORD: Record<Verdict, string> = {
  ok: 'APPROVED',
  caution: 'REVIEW',
  fail: 'RETURN',
}

// Big Shoulders Display preferred; falls back to a condensed sans, then the
// generic display stack. Used only on the zero-padded student indices.
const FONT_INDEX =
  '"Big Shoulders Display", "Big Shoulders Text", "Oswald", "Barlow Condensed", "Inter", sans-serif'

const trackedCaps = (px: number, color: string): React.CSSProperties => ({
  fontFamily: 'var(--font-sans)',
  fontSize: px,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color,
  fontWeight: 500,
})

function relativeTime(iso: string): string {
  const date = new Date(iso)
  const ms = Date.now() - date.getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${Math.max(mins, 0)}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function StatusDot({ verdict }: { verdict: Verdict }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        backgroundColor: SEVERITY[verdict],
      }}
    />
  )
}

function RubricLine({ t }: { t: RubricThreshold }) {
  const labelMap: Record<RubricThreshold['metric'], string> = {
    lufs_i: 'LUFS-I target',
    peak_dbtp: 'True-peak ceiling',
    lra_lu: 'LRA target',
  }
  const unitMap: Record<RubricThreshold['metric'], string> = {
    lufs_i: 'LU',
    peak_dbtp: 'dBTP',
    lra_lu: 'LU',
  }
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 12,
        padding: '10px 0',
        borderBottom: `1px solid ${SAND_800}`,
      }}
    >
      <span style={trackedCaps(10, SAND_300)}>{labelMap[t.metric]}</span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: CREAM,
          letterSpacing: '0.02em',
        }}
      >
        {t.target > 0 ? '+' : ''}
        {t.target} {unitMap[t.metric]} ±{t.tolerance}
      </span>
    </div>
  )
}

function SubmissionRow({
  sub,
  index,
  onOpen,
  onApprove,
  onReturn,
}: {
  sub: StudentSubmission
  index: number
  onOpen: () => void
  onApprove?: () => void
  onReturn?: () => void
}) {
  const word = sub.verdictWord ?? DEFAULT_VERDICT_WORD[sub.verdict]
  const recent = sub.recentVerdicts ?? []
  const [hover, setHover] = React.useState(false)

  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      role="button"
      tabIndex={0}
      style={{
        display: 'grid',
        gridTemplateColumns: '56px 1fr auto',
        alignItems: 'center',
        gap: 20,
        height: 56,
        padding: '0 8px',
        cursor: 'pointer',
        backgroundColor: hover ? 'rgba(168,161,150,0.06)' : 'transparent',
        borderBottom: `1px solid ${SAND_800}`,
      }}
    >
      <div
        style={{
          fontFamily: FONT_INDEX,
          fontSize: 32,
          lineHeight: 1,
          fontWeight: 500,
          color: SAND_300,
          letterSpacing: '0.02em',
        }}
      >
        {String(index + 1).padStart(2, '0')}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontSize: 22,
            lineHeight: 1.1,
            color: CREAM,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {sub.studentName}
        </div>
        <div style={trackedCaps(9, SAND_400)}>
          {sub.assignment} · submitted {relativeTime(sub.submittedAt)}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {hover && (onApprove || onReturn) && (
          <div style={{ display: 'flex', gap: 6 }}>
            {onApprove && (
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation()
                  onApprove()
                }}
                style={{
                  ...trackedCaps(10, SAND_200),
                  background: 'transparent',
                  border: `1px solid ${SAND_700}`,
                  borderRadius: 2,
                  padding: '4px 10px',
                  cursor: 'pointer',
                }}
              >
                Approve
              </button>
            )}
            {onReturn && (
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation()
                  onReturn()
                }}
                style={{
                  ...trackedCaps(10, SAND_200),
                  background: 'transparent',
                  border: `1px solid ${SAND_700}`,
                  borderRadius: 2,
                  padding: '4px 10px',
                  cursor: 'pointer',
                }}
              >
                Return
              </button>
            )}
          </div>
        )}

        <span style={{ ...trackedCaps(10, SEVERITY[sub.verdict]) }}>{word}</span>

        <div style={{ display: 'flex', gap: 4 }}>
          {recent.slice(-3).map((v, i) => (
            <StatusDot key={i} verdict={v} />
          ))}
        </div>
      </div>
    </div>
  )
}

type DashboardTab = 'roster' | 'annotations'

export function TeacherDashboard({
  courseName,
  teacherName,
  assignmentBrief,
  rubric,
  submissions,
  onOpenSubmission,
  onApprove,
  onReturn,
  onExportGradebook,
  actionSlot,
}: TeacherDashboardProps) {
  const [activeTab, setActiveTab] = useState<DashboardTab>('roster')
  // MED-8: cap visible roster rows to prevent 500+ row layouts blocking the main thread.
  const ROSTER_PAGE = 150
  const [showAllRows, setShowAllRows] = useState(false)

  return (
    <main
      style={{
        backgroundColor: INK,
        minHeight: '100vh',
        padding: 'clamp(28px, 4vw, 72px)',
      }}
    >
      {/* Editorial header */}
      <header style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 40 }}>
        <div style={trackedCaps(11, SAND_400)}>
          ASSIGNMENT WORKSPACE · {courseName.toUpperCase()}
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 'clamp(40px, 7vw, 64px)',
            lineHeight: 1.02,
            color: CREAM,
            letterSpacing: '-0.015em',
            margin: 0,
          }}
        >
          {courseName}
        </h1>
        <div style={trackedCaps(11, SAND_400)}>
          instructor: {teacherName} · {submissions.length} submission
          {submissions.length === 1 ? '' : 's'}
        </div>
        <div style={{ width: '100%', height: 1, backgroundColor: SAND_700, marginTop: 8 }} />

        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 0, marginTop: 4 }}>
          {(['roster', 'annotations'] as DashboardTab[]).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                ...trackedCaps(10, activeTab === tab ? CREAM : SAND_400),
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === tab ? `1px solid ${GOLD}` : '1px solid transparent',
                padding: '8px 20px 8px 0',
                cursor: 'pointer',
                marginRight: 16,
              }}
            >
              {tab === 'roster' ? 'Roster' : 'Annotations'}
            </button>
          ))}
        </div>
      </header>

      {/* Annotations tab */}
      {/* MED-15: ErrorBoundary prevents a bad annotation payload from crashing the dashboard */}
      {activeTab === 'annotations' && (
        <ErrorBoundary>
          <AnnotationEditor />
        </ErrorBoundary>
      )}

      {/* Two-column body */}
      {activeTab === 'roster' && (
      <div className="grid grid-cols-1 md:grid-cols-12 gap-10">
        {/* Roster */}
        <section className="md:col-span-8">
          {submissions.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '32px 0' }}>
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontStyle: 'italic',
                  fontSize: 18,
                  color: CREAM,
                  lineHeight: 1.3,
                }}
              >
                No submissions yet. Set the brief on the right.
              </div>
              <div style={trackedCaps(10, SAND_400)}>
                Roster fills in as students submit · auto-graded against the rubric
              </div>
            </div>
          ) : (
            <div role="list" aria-label="Submissions">
              {(showAllRows ? submissions : submissions.slice(0, ROSTER_PAGE)).map((sub, i) => (
                <SubmissionRow
                  key={sub.id}
                  sub={sub}
                  index={i}
                  onOpen={() => onOpenSubmission(sub.id)}
                  onApprove={onApprove ? () => onApprove(sub.id) : undefined}
                  onReturn={onReturn ? () => onReturn(sub.id) : undefined}
                />
              ))}
              {!showAllRows && submissions.length > ROSTER_PAGE && (
                <button
                  type="button"
                  onClick={() => setShowAllRows(true)}
                  style={{ ...trackedCaps(10, SAND_400), background: 'none', border: `1px solid ${SAND_700}`, borderRadius: 2, padding: '8px 16px', cursor: 'pointer', marginTop: 8 }}
                >
                  Show all {submissions.length} submissions
                </button>
              )}
            </div>
          )}
        </section>

        {/* Rubric + actions */}
        <aside
          className="md:col-span-4"
          style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
        >
          <div style={trackedCaps(11, SAND_400)}>RUBRIC</div>

          {assignmentBrief && (
            <p
              style={{
                fontFamily: 'var(--font-display)',
                fontStyle: 'italic',
                fontSize: 14,
                lineHeight: 1.5,
                color: SAND_200,
                margin: 0,
                display: '-webkit-box',
                WebkitLineClamp: 6,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {assignmentBrief}
            </p>
          )}

          {rubric && rubric.length > 0 && (
            <div>
              {rubric.map((t, i) => (
                <RubricLine key={i} t={t} />
              ))}
            </div>
          )}

          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={onExportGradebook}
              style={{
                ...trackedCaps(11, INK),
                backgroundColor: GOLD,
                border: 'none',
                borderRadius: 2,
                padding: '10px 24px',
                cursor: 'pointer',
              }}
            >
              EXPORT GRADEBOOK
            </button>
          </div>

          {actionSlot && <div>{actionSlot}</div>}
        </aside>
      </div>
      )}
    </main>
  )
}

export default TeacherDashboard

/**
 * Default export-gradebook impl — wired to `printGradebookExport`. Callers
 * who pass `onExportGradebook={() => defaultExportGradebook({ ... })}` get
 * the canonical four-variant Certificate print path; callers with their
 * own backend can ignore this helper and supply a custom handler.
 */
export function defaultExportGradebook(args: {
  courseName: string
  teacherName: string
  submissions: StudentSubmission[]
  date?: string
}): Promise<void> {
  const students: CertificateStudent[] = args.submissions.map(s => {
    const metrics = s.metrics
      ? [
          { label: 'LUFS-I', value: s.metrics.lufsI.toFixed(1), unit: 'LU' },
          { label: 'TRUE PEAK', value: s.metrics.peakDbtp.toFixed(1), unit: 'dBTP' },
          ...(s.metrics.lra != null
            ? [{ label: 'LRA', value: s.metrics.lra.toFixed(1), unit: 'LU' }]
            : []),
        ]
      : []
    return {
      name: s.studentName,
      verdict: s.verdict,
      verdictWord: s.verdictWord ?? DEFAULT_VERDICT_WORD[s.verdict],
      metaLine: `${s.assignment} · ${s.submittedAt}`,
      metrics,
    }
  })
  return printGradebookExport({
    courseTitle: args.courseName,
    metaLine: args.date ?? new Date().toISOString().slice(0, 10),
    students,
    teacherName: args.teacherName,
    course: args.courseName,
    date: args.date,
  })
}
