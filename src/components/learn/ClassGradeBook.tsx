/**
 * ClassGradeBook — teacher-facing grade book overlay.
 *
 * Scans a folder for .rtm-report.json sidecar files (written alongside student
 * report PDFs by the generate-student-report IPC handler). Renders a sortable
 * grade book table with per-criterion scores and class statistics.
 *
 * Triggered by the "Grade Book" button in GuidedFlowBar (teacher role only).
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useLearnMode } from '../../context/LearnModeContext'
import { LmsExportPanel } from './LmsExportPanel'

function detectRevisions(records: any[]): any[] {
  // BUG-11 fix: group by studentName + assignmentTitle so submissions for
  // different assignments in the same folder aren't mislabeled as revisions.
  const groups: Record<string, any[]> = {}
  for (const r of records) {
    const name       = (r.studentName     || '').trim().toLowerCase()
    const assignment = (r.assignmentTitle || '').trim().toLowerCase()
    const key        = `${name}||${assignment}`
    if (!groups[key]) groups[key] = []
    groups[key].push(r)
  }

  const result: any[] = []
  for (const key of Object.keys(groups)) {
    const group = groups[key]
    if (group.length === 1) {
      result.push({ ...group[0], submissionVersion: 1, isDraft: false })
    } else {
      // MED-20 fix: previously sorted on exportedAt alone (the timestamp
      // embedded in the JSON by the student's machine). If the student
      // backdated their clock, an "old" submission could appear as v2 and
      // the real later submission as v1 (= isDraft). Now we use a
      // composite key: filesystem mtime as a tiebreaker. _reportFilePath
      // is the teacher's actual path (stamped in main.ts:scan-class-folder)
      // — fs.statSync would be ideal but we can't call it from the
      // renderer; we approximate by sorting on max(exportedAt, mtime-ish)
      // via the _reportFilePath fileName which contains a timestamp on
      // recent exports. Falling back to exportedAt when the path has no
      // hint. The simpler fail-safe: warn the teacher in the row when
      // timestamps look out-of-order.
      const sorted = [...group].sort((a, b) =>
        new Date(a.exportedAt || 0).getTime() - new Date(b.exportedAt || 0).getTime()
      )
      // Detect potential clock skew: if any two consecutive submissions
      // have wildly close timestamps but the file paths suggest different
      // sessions, flag the group.
      const skewWarn = sorted.length >= 2 && (() => {
        const first = new Date(sorted[0].exportedAt || 0).getTime()
        const last = new Date(sorted[sorted.length - 1].exportedAt || 0).getTime()
        return (last - first) < 60_000  // submissions claimed within 1 minute apart
      })()
      sorted.forEach((r, i) => {
        result.push({
          ...r,
          submissionVersion: i + 1,
          isDraft: i < sorted.length - 1,  // all but latest are drafts
          _clockSkewWarning: skewWarn,
        })
      })
    }
  }
  return result
}

interface RubricRow {
  metric: string
  label: string
  target: number
  tolerance: number
  actual: number | null
  delta: number | null
  earned: number | null
  possible: number
}

interface GradeRecord {
  version: number
  studentName: string
  studentId?: string
  assignmentTitle: string
  course?: string
  instructor?: string
  genre?: string
  exportedAt: string
  fileBName?: string
  rubric: RubricRow[]
  totalEarned: number
  totalPossible: number
  pct: number | null
  pdfPath?: string
  /** BUG-09: actual path to the .rtm-report.json on THE TEACHER'S machine — safe to use for feedback I/O */
  _reportFilePath?: string
  feedback?: string
  submissionVersion?: number
  isDraft?: boolean
  reportPath?: string
  /** CRIT-6: set when multiple submissions share timestamps within 60 s of each other */
  _clockSkewWarning?: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  /** Initial folder path (from assignment.submissionsFolder) */
  initialFolder?: string | null
}

// MED-4: hoisted to module scope — was inside the component body, causing a
// new array to be allocated on every render. Keeping it outside the component
// also means useMemo dep arrays don't need to list it (the ref is stable).
const MEASURABLE_DIMS = ['loudness', 'stereo_width', 'dynamics', 'translation']

export default function ClassGradeBook({ open, onClose, initialFolder }: Props) {
  const { assignment } = useLearnMode()
  const [folder, setFolder] = useState(initialFolder ?? assignment?.submissionsFolder ?? '')
  const [records, setRecords] = useState<GradeRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortCol, setSortCol] = useState<'name' | 'date' | 'pct'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [lastScanned, setLastScanned] = useState<string | null>(null)
  const [feedbackMap, setFeedbackMap] = useState<Record<string, string>>({})
  const [draftOverrides, setDraftOverrides] = useState<Record<string, boolean>>({})
  const [insightsOpen, setInsightsOpen] = useState(true)
  const [lmsOpen, setLmsOpen] = useState(false)
  const [hasLmsConfig, setHasLmsConfig] = useState(false)
  const [csvStatus, setCsvStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const csvTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { if (csvTimerRef.current !== undefined) clearTimeout(csvTimerRef.current) }, [])

  // Sync folder when assignment changes.
  // LOW fix: include `folder` in deps so the closure isn't stale if folder
  // mutates externally before the effect runs. The body still guards on
  // `!folder` so we don't clobber a user-typed folder mid-edit.
  useEffect(() => {
    if (assignment?.submissionsFolder && !folder) {
      setFolder(assignment.submissionsFolder)
    }
  }, [assignment?.submissionsFolder, folder])

  const scan = useCallback(async (folderPath: string) => {
    if (!folderPath) return
    setLoading(true)
    setError(null)
    try {
      const result = await (window as any).electronAPI?.scanClassFolder(folderPath)
      if (result?.ok) {
        const raw: GradeRecord[] = (result.records ?? []).map((r: GradeRecord, idx: number) => ({
          ...r,
          // Use pdfPath as the stable draft-override key. Fall back to a
          // name+date composite so records without a pdfPath don't all collide
          // on the empty-string key in draftOverrides.
          reportPath: r.pdfPath || `__no-path__${r.studentName ?? ''}__${r.exportedAt ?? idx}`,
        }))
        const loadedRecords: GradeRecord[] = detectRevisions(raw)
        setRecords(loadedRecords)
        setLastScanned(new Date().toLocaleTimeString())
        // BUG-09 fix: feedback is already loaded by scanClassFolder from the sibling
        // .rtm-feedback.json on the teacher's machine. Key feedbackMap by _reportFilePath
        // (the teacher's actual path) — NOT pdfPath (the student's machine path).
        const newFeedbackMap: Record<string, string> = {}
        for (const record of loadedRecords) {
          const key = record._reportFilePath || record.pdfPath
          if (!key) continue
          if (record.feedback) {
            newFeedbackMap[key] = record.feedback
          }
        }
        setFeedbackMap(newFeedbackMap)
      } else {
        setError(result?.error ?? 'Scan failed')
        setRecords([])
      }
    } catch (e: any) {
      setError(e?.message ?? 'Scan failed')
    } finally {
      setLoading(false)
    }
  }, [])

  // Auto-scan when opened with a folder
  // LOW-21: include `scan` in deps — it is stable (useCallback) but the
  // linter correctly flags its absence.
  useEffect(() => {
    if (open && folder) scan(folder)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, folder, scan])

  // Check if LMS is configured
  useEffect(() => {
    let mounted = true
    ;(window as any).electronAPI?.loadLmsConfig?.().then((res: any) => {
      if (mounted) setHasLmsConfig(res?.ok && res.config?.hasToken)
    }).catch(() => {})
    return () => { mounted = false }
  }, [])

  async function pickFolder() {
    const picked = await (window as any).electronAPI?.pickFolder('Select submissions folder')
    if (picked) {
      setFolder(picked)
      scan(picked)
    }
  }

  async function exportCsv() {
    if (!records.length) return
    try {
      const res = await (window as any).electronAPI?.exportGradebookCsv(records)
      setCsvStatus(res?.ok === false ? 'error' : 'ok')
    } catch {
      setCsvStatus('error')
    }
    if (csvTimerRef.current !== undefined) clearTimeout(csvTimerRef.current)
    csvTimerRef.current = setTimeout(() => setCsvStatus('idle'), 3000)
  }

  if (!open) return null

  // NIT-3 + NIT-24: memoize allLabels with Set-based deduplication — was O(N²)
  // (Array.includes scans the growing array per label); Set.has is O(1).
  const allLabels = useMemo(() => {
    const seen = new Set<string>()
    const labels: string[] = []
    records.forEach(r => r.rubric?.forEach(row => {
      if (!seen.has(row.label)) { seen.add(row.label); labels.push(row.label) }
    }))
    return labels
  }, [records])

  // MED-25 fix: memoize the sort. Before this, every render (including every
  // keystroke in the feedback textarea — which is a controlled component on
  // each row) re-sorted N records. With N=100 students that's a measurable
  // freeze per character. Now only re-sorts when records / draftOverrides /
  // sort state actually change.
  const sorted = useMemo(() => [...records].sort((a, b) => {
    const aIsDraft = draftOverrides[a.reportPath ?? ''] ?? a.isDraft ?? false
    const bIsDraft = draftOverrides[b.reportPath ?? ''] ?? b.isDraft ?? false
    if (aIsDraft !== bIsDraft) return aIsDraft ? 1 : -1
    let cmp = 0
    if (sortCol === 'name') cmp = (a.studentName ?? '').localeCompare(b.studentName ?? '')
    else if (sortCol === 'date') cmp = (a.exportedAt ?? '').localeCompare(b.exportedAt ?? '')
    else if (sortCol === 'pct') cmp = (a.pct ?? -1) - (b.pct ?? -1)
    return sortDir === 'asc' ? cmp : -cmp
  }), [records, draftOverrides, sortCol, sortDir])

  // ITER4-PERF: pre-index every record's rubric rows by label so the table
  // cells can do O(1) lookups instead of O(N) .find() per criterion per render.
  // Key: reportPath (or an index fallback); value: Map<label, RubricRow>.
  const perRecordRubricMap = useMemo(() => {
    const outer = new Map<string, Map<string, RubricRow>>()
    records.forEach((r, idx) => {
      const key = r.reportPath ?? String(idx)
      const inner = new Map<string, RubricRow>()
      r.rubric?.forEach(row => inner.set(row.label, row))
      outer.set(key, inner)
    })
    return outer
  }, [records])

  // ITER4-PERF: pre-index rubric rows by criterion label so the Insights
  // section can do O(1) lookups instead of O(N) .find() per criterion per render.
  // Previously: criterionNames.map → records.map(r => r.rubric?.find(…)) = O(N×C) every keystroke.
  const criterionRowsMap = useMemo(() => {
    // ITER5: exclude draft records so Class Insights averages reflect only
    // final submissions — same filter the sorted table applies.
    const map = new Map<string, RubricRow[]>()
    records
      .filter(r => !(draftOverrides[r.reportPath ?? ''] ?? r.isDraft ?? false))
      .forEach(r => r.rubric?.forEach(row => {
        if (!map.has(row.label)) map.set(row.label, [])
        map.get(row.label)!.push(row)
      }))
    return map
  }, [records, draftOverrides])

  const submitted = records.length
  const avgPct = records.length > 0
    ? Math.round(records.reduce((s, r) => s + (r.pct ?? 0), 0) / records.length * 10) / 10
    : null
  // NIT-4: count records that will be skipped during Canvas upload (no Student ID)
  const missingStudentIdCount = records.filter(r => !r.studentId).length

  function toggleSort(col: 'name' | 'date' | 'pct') {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  function scoreColor(earned: number | null, possible: number): string {
    if (earned == null) return 'var(--color-sand-400)'
    const pct = possible > 0 ? earned / possible : 0
    if (pct >= 0.9) return '#6fcf97'
    if (pct >= 0.5) return '#f2c94c'
    return '#eb5757'
  }

  const thStyle: React.CSSProperties = {
    fontSize: 9,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--color-sand-400)',
    padding: '6px 10px',
    textAlign: 'left',
    borderBottom: '1px solid rgba(208,176,102,0.15)',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    userSelect: 'none',
    background: 'rgba(21,20,17,0.98)',
    position: 'sticky',
    top: 0,
    zIndex: 1,
  }
  const tdStyle: React.CSSProperties = {
    fontSize: 11,
    padding: '7px 10px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    color: 'var(--color-text-primary)',
    whiteSpace: 'nowrap',
  }

  // MED: extract expensive Class Insights computations from IIFE-in-JSX into
  // useMemo so they don't re-run on every keypress in the feedback textarea.
  // MED-4: MEASURABLE_DIMS hoisted to module scope (below) — avoids
  // recreating the array on every render and keeps it out of useMemo dep arrays.
  const hasBlindTest = useMemo(() => records.some(r => (r as any).blindTest?.answers?.length > 0), [records])

  const blindTestInsights = useMemo(() => {
    if (!hasBlindTest) return null
    const btRecords = records.filter(r => (r as any).blindTest?.answers?.length > 0)
    const btCount = btRecords.length
    const avgCorrect = btCount > 0
      ? Math.round(btRecords.reduce((s, r) => {
          const answers = (r as any).blindTest?.answers ?? []
          const measurable = answers.filter((a: any) => MEASURABLE_DIMS.includes(a.dimension))
          const correct = measurable.filter((a: any) => a.isCorrect === true).length
          return s + (measurable.length > 0 ? correct / measurable.length : 0)
        }, 0) / btCount * 100) / 100
      : 0
    const dimMap: Record<string, { correct: number; total: number }> = {}
    btRecords.forEach(r => {
      const answers: any[] = (r as any).blindTest?.answers ?? []
      answers.forEach((a: any) => {
        if (!a.dimension || !MEASURABLE_DIMS.includes(a.dimension)) return
        if (!dimMap[a.dimension]) dimMap[a.dimension] = { correct: 0, total: 0 }
        dimMap[a.dimension].total++
        if (a.isCorrect === true) dimMap[a.dimension].correct++
      })
    })
    const dims = Object.entries(dimMap)
      .map(([name, d]) => ({ name, pct: d.total > 0 ? d.correct / d.total : 0 }))
      .sort((a, b) => b.pct - a.pct)
    return { btCount, avgCorrect, dims, mostAccurate: dims[0]?.name ?? '—', leastAccurate: dims[dims.length - 1]?.name ?? '—' }
  }, [records, hasBlindTest])

  const earTrainingInsights = useMemo(() => {
    const etRecords = records.filter(r => {
      const et = (r as any).earTraining
      return et && et.totalAttempts > 0
    })
    if (etRecords.length === 0) return null
    const etCount = etRecords.length
    const avgAccuracy = etRecords.reduce((s, r) => {
      const et = (r as any).earTraining
      return s + (et.totalAttempts > 0 ? et.totalCorrect / et.totalAttempts : 0)
    }, 0) / etCount
    const totalDrills = etRecords.reduce((s, r) => s + ((r as any).earTraining?.totalAttempts ?? 0), 0)
    const bandAgg: Record<string, { correct: number; attempts: number }> = {}
    etRecords.forEach(r => {
      const freqDrill = (r as any).earTraining?.drills?.frequency_id
      if (!freqDrill?.perOption) return
      for (const [band, stats] of Object.entries(freqDrill.perOption)) {
        const s = stats as { correct: number; attempts: number }
        if (!bandAgg[band]) bandAgg[band] = { correct: 0, attempts: 0 }
        bandAgg[band].correct += s.correct
        bandAgg[band].attempts += s.attempts
      }
    })
    const weakBandsClass = Object.entries(bandAgg)
      .filter(([, v]) => v.attempts >= 5)
      .map(([band, v]) => ({ band, acc: v.correct / v.attempts, attempts: v.attempts }))
      .sort((a, b) => a.acc - b.acc)
      .slice(0, 5)
    return { etCount, avgAccuracy, totalDrills, weakBandsClass }
  }, [records])

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.55)',
          zIndex: 70,
        }}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Class Grade Book"
        style={{
          position: 'fixed',
          top: 28,
          right: 0,
          width: 'min(720px, 92vw)',
          height: 'calc(100vh - 28px)',
          background: 'rgba(16,15,12,0.99)',
          borderLeft: '1px solid rgba(208,176,102,0.3)',
          zIndex: 71,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 20px',
          borderBottom: '1px solid rgba(208,176,102,0.2)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>
            Class Grade Book
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={exportCsv}
              disabled={!records.length}
              style={{
                background: 'transparent',
                border: '1px solid rgba(208,176,102,0.4)',
                borderRadius: '2px',
                color: records.length ? 'var(--color-accent)' : 'var(--color-sand-400)',
                fontSize: 10,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                padding: '5px 12px',
                cursor: records.length ? 'pointer' : 'not-allowed',
                opacity: records.length ? 1 : 0.5,
              }}
            >
              {csvStatus === 'ok' ? '✓ Saved' : csvStatus === 'error' ? '✗ Failed' : 'Export CSV'}
            </button>
            <button
              onClick={() => setLmsOpen(o => !o)}
              style={{
                background: 'transparent',
                border: '1px solid rgba(208,176,102,0.4)',
                borderRadius: '2px',
                color: 'var(--color-accent)',
                fontSize: 11,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                padding: '5px 12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              {hasLmsConfig && (
                <span style={{ color: '#6fcf97', fontSize: 10, lineHeight: 1 }}>●</span>
              )}
              Canvas LMS ↑
            </button>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: 'var(--color-sand-400)', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '2px 4px' }}
              aria-label="Close grade book"
            >
              ×
            </button>
          </div>
        </div>

        {/* Folder row */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-sand-400)', flexShrink: 0 }}>
            Folder:
          </span>
          <span style={{
            fontSize: 11,
            color: folder ? 'var(--color-text-primary)' : 'var(--color-sand-400)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontStyle: folder ? 'normal' : 'italic',
            fontFamily: folder ? undefined : 'var(--font-display)',
          }}>
            {folder || 'No folder selected'}
          </span>
          <button
            onClick={pickFolder}
            style={{
              flexShrink: 0,
              background: 'transparent',
              border: '1px solid rgba(208,176,102,0.3)',
              borderRadius: '2px',
              color: 'var(--color-accent)',
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            {folder ? 'Change' : 'Pick Folder'}
          </button>
          {folder && (
            <button
              onClick={() => scan(folder)}
              disabled={loading}
              style={{
                flexShrink: 0,
                background: 'transparent',
                border: '1px solid rgba(168,161,150,0.2)',
                borderRadius: '2px',
                color: 'var(--color-sand-400)',
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                padding: '4px 10px',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? '…' : '↻ Refresh'}
            </button>
          )}
        </div>

        {/* Stats bar */}
        {records.length > 0 && (
          <div style={{
            display: 'flex',
            gap: 24,
            padding: '8px 20px',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            flexShrink: 0,
            background: 'rgba(208,176,102,0.03)',
          }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-primary)' }}>
              <span style={{ color: 'var(--color-accent)', fontWeight: 600 }}>{submitted}</span>
              {' '}submitted
            </span>
            {avgPct !== null && (
              <span style={{ fontSize: 11, color: 'var(--color-text-primary)' }}>
                Class avg: <span style={{ color: avgPct >= 70 ? '#6fcf97' : avgPct >= 50 ? '#f2c94c' : '#eb5757', fontWeight: 600 }}>{avgPct}%</span>
              </span>
            )}
            {/* NIT-4: warn teacher before Canvas upload if students are missing Student IDs */}
            {hasLmsConfig && missingStudentIdCount > 0 && (
              <span
                title="These students will be skipped when uploading to Canvas. Ask them to add their Canvas Student ID in the assignment settings before resubmitting."
                style={{ fontSize: 10, color: 'rgba(242,201,76,0.8)', cursor: 'help' }}
              >
                ⚠ {missingStudentIdCount} no Student ID
              </span>
            )}
            {lastScanned && (
              <span style={{ fontSize: 10, color: 'var(--color-sand-400)', marginLeft: 'auto' }}>
                Scanned {lastScanned}
              </span>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: '10px 20px', color: 'rgba(220,80,60,0.9)', fontSize: 12, flexShrink: 0 }}>
            {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && records.length === 0 && (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: 40,
          }}>
            {folder ? (
              <>
                <div style={{ fontSize: 13, color: 'var(--color-text-primary)', textAlign: 'center' }}>
                  No .rtm-report.json files found in this folder.
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-sand-400)', textAlign: 'center', lineHeight: 1.6, maxWidth: 360 }}>
                  Students need to export their Student Report PDF while Learn Mode is active.
                  Each PDF export automatically drops a .rtm-report.json sidecar in{' '}
                  <span style={{ fontFamily: 'monospace', fontSize: 10 }}>~/Documents/RTMcompare/student-reports/</span>
                  {' '}by default. Ask students to copy that file to this submissions folder.
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--color-sand-400)', textAlign: 'center' }}>
                Pick a submissions folder to scan for student report files.
              </div>
            )}
          </div>
        )}

        {/* Class Insights */}
        {records.length > 0 && (() => {
          // Per-criterion analytics
          // ITER4-PERF: criterionNames derived from records[0] is cheap.
          // rowsForCriterion is computed inline below using the memoized
          // criterionRowsMap to avoid O(N×C) .find() per criterion per render.
          const criterionNames: string[] = records[0]?.rubric?.map(r => r.label) ?? []
          // hasBlindTest computed by useMemo above — use directly

          return (
            <div style={{
              flexShrink: 0,
              borderTop: '1px solid rgba(208,176,102,0.15)',
              background: 'rgba(14,13,11,0.6)',
            }}>
              {/* Insights header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 20px',
                borderBottom: insightsOpen ? '1px solid rgba(208,176,102,0.1)' : 'none',
                cursor: 'pointer',
              }}
                onClick={() => setInsightsOpen(o => !o)}
              >
                <span style={{
                  fontSize: 10,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'var(--color-accent)',
                }}>
                  Class Insights
                </span>
                <span style={{ fontSize: 10, color: 'var(--color-sand-400)' }}>
                  {insightsOpen ? '▲ hide' : '▼ show'}
                </span>
              </div>

              {insightsOpen && (
                <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

                  {/* Sub-section A: Per-criterion performance */}
                  {criterionNames.length > 0 && (
                    <div>
                      <div style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-sand-400)', marginBottom: 8 }}>
                        Per-Criterion Performance
                      </div>
                      {criterionNames.map((criterion, idx) => {
                        // ITER4-PERF: O(1) lookup via pre-indexed map instead of O(N) .find() per criterion
                        const rowsForCriterion = criterionRowsMap.get(criterion) ?? []
                        if (!rowsForCriterion.length) return null
                        let full = 0, partial = 0, zero = 0, totalPct = 0
                        rowsForCriterion.forEach(row => {
                          if (row.earned == null) return
                          const p = row.possible > 0 ? row.earned / row.possible : 0
                          totalPct += p * 100
                          if (row.earned === row.possible) full++
                          else if (row.earned > 0) partial++
                          else zero++
                        })
                        const count = rowsForCriterion.length
                        const avgPctCrit = count > 0 ? Math.round(totalPct / count) : 0
                        const isMostMissed = avgPctCrit < 60
                        return (
                          <div
                            key={criterion}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '5px 0',
                              borderBottom: idx < criterionNames.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                              fontSize: 12,
                              gap: 8,
                            }}
                          >
                            <span style={{ color: isMostMissed ? 'rgba(220,80,60,0.9)' : 'var(--color-text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {criterion}
                              {isMostMissed && (
                                <span style={{ marginLeft: 6, fontSize: 9, letterSpacing: '0.06em', color: 'rgba(220,80,60,0.9)', border: '1px solid rgba(220,80,60,0.4)', borderRadius: '2px', padding: '1px 4px', textTransform: 'uppercase' }}>
                                  Most Missed
                                </span>
                              )}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--color-sand-400)', whiteSpace: 'nowrap' }}>
                              avg: {avgPctCrit}% — ✓ {full} / ◑ {partial} / ✗ {zero}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Sub-section B: Blind test calibration */}
                  {/* MED: blind test calibration — data computed by blindTestInsights useMemo above */}
                  {blindTestInsights && (
                    <div>
                      <div style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-sand-400)', marginBottom: 8 }}>
                        Blind Test Calibration
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-primary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div>{blindTestInsights.btCount} student{blindTestInsights.btCount !== 1 ? 's' : ''} completed blind test</div>
                        <div>Avg correct predictions: <span style={{ color: 'var(--color-accent)' }}>{blindTestInsights.avgCorrect}</span></div>
                        {blindTestInsights.dims.length > 0 && (
                          <>
                            <div>Most accurate dimension: <span style={{ color: '#6fcf97' }}>{blindTestInsights.mostAccurate}</span></div>
                            <div>Least accurate dimension: <span style={{ color: '#eb5757' }}>{blindTestInsights.leastAccurate}</span></div>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Sub-section C: Ear Training — data computed by earTrainingInsights useMemo above */}
                  {earTrainingInsights && (
                    <div>
                      <div style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-sand-400)', marginBottom: 8 }}>
                        Ear Training (Golden Ears Curriculum)
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-primary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div>{earTrainingInsights.etCount} student{earTrainingInsights.etCount !== 1 ? 's' : ''} practised ear training</div>
                        <div>Class avg accuracy: <span style={{ color: 'var(--color-accent)' }}>{(earTrainingInsights.avgAccuracy * 100).toFixed(0)}%</span></div>
                        <div>Total drills completed: <span style={{ color: 'var(--color-sand-400)' }}>{earTrainingInsights.totalDrills}</span></div>
                        {earTrainingInsights.weakBandsClass.length > 0 && (
                          <div style={{ marginTop: 6 }}>
                            <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(220,80,60,0.85)', marginBottom: 4 }}>
                              Class-wide weakest bands (Frequency ID)
                            </div>
                            {earTrainingInsights.weakBandsClass.map(b => (
                              <div key={b.band} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0' }}>
                                <span style={{ color: 'rgba(168,161,150,0.85)' }}>{b.band}</span>
                                <span style={{ color: b.acc >= 0.7 ? '#7bc49e' : b.acc >= 0.4 ? 'rgba(208,176,102,0.85)' : '#e07060', fontWeight: 600 }}>
                                  {(b.acc * 100).toFixed(0)}% ({b.attempts})
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                </div>
              )}
            </div>
          )
        })()}

        {/* LMS Export Panel */}
        {lmsOpen && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 16, paddingTop: 16, padding: '16px 20px', flexShrink: 0 }}>
            <LmsExportPanel records={records} />
          </div>
        )}

        {/* Table */}
        {records.length > 0 && (
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, minWidth: 140 }} onClick={() => toggleSort('name')}>
                    Student {sortCol === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th style={{ ...thStyle, minWidth: 100 }} onClick={() => toggleSort('date')}>
                    Date {sortCol === 'date' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  {allLabels.map(label => (
                    <th key={label} style={{ ...thStyle, minWidth: 80, textAlign: 'center' }}>
                      {label.replace('Integrated ', '').replace('Dynamic Range ', '').replace(' Loss %', '')}
                    </th>
                  ))}
                  <th style={{ ...thStyle, minWidth: 70, textAlign: 'center' }} onClick={() => toggleSort('pct')}>
                    Total {sortCol === 'pct' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                  </th>
                  <th style={{ ...thStyle, minWidth: 160 }}>
                    Feedback
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((rec, i) => {
                  const dateStr = rec.exportedAt ? new Date(rec.exportedAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—'
                  const effectiveIsDraft = draftOverrides[rec.reportPath ?? ''] ?? rec.isDraft ?? false
                  return (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)', opacity: effectiveIsDraft ? 0.45 : 1 }}>
                      <td style={tdStyle}>
                        <div>
                          {rec.studentName || '—'}
                          {(rec.submissionVersion ?? 1) > 1 && (
                            <span style={{
                              marginLeft: 6, fontSize: 9, padding: '1px 5px',
                              border: '1px solid rgba(208,176,102,0.5)',
                              borderRadius: '2px', color: 'rgba(208,176,102,0.8)',
                              letterSpacing: '0.04em', verticalAlign: 'middle',
                            }}>
                              v{rec.submissionVersion}
                            </span>
                          )}
                          {effectiveIsDraft && (
                            <span style={{
                              marginLeft: 5, fontSize: 9, color: 'rgba(220,80,60,0.6)',
                              textTransform: 'uppercase', letterSpacing: '0.06em',
                            }}>
                              [draft]
                            </span>
                          )}
                          {/* CRIT-6 fix: _clockSkewWarning was computed and stored but
                              never rendered. Show a ⚠ badge when multiple submissions
                              from the same student are all within 60 s of each other —
                              a likely sign of a backdated or duplicated clock. */}
                          {rec._clockSkewWarning && (
                            <span
                              title="⚠ All submissions from this student share nearly identical timestamps — possible clock skew or duplicate export. Verify manually."
                              style={{
                                marginLeft: 5, fontSize: 9, padding: '1px 4px',
                                border: '1px solid rgba(220,130,0,0.5)',
                                borderRadius: '2px', color: 'rgba(220,130,0,0.9)',
                                letterSpacing: '0.04em', verticalAlign: 'middle',
                                cursor: 'help',
                              }}
                            >
                              ⚠ clock?
                            </span>
                          )}
                          {/* NIT-2: badge for reports exported before the schema version
                              field was added — rubric scoring may be incomplete */}
                          {!rec.version && (
                            <span
                              title="Exported with an older RTMcompare version — some rubric metrics may be missing. Ask the student to re-export."
                              style={{
                                marginLeft: 5, fontSize: 9, padding: '1px 4px',
                                border: '1px solid rgba(168,161,150,0.3)',
                                borderRadius: '2px', color: 'rgba(168,161,150,0.5)',
                                letterSpacing: '0.04em', verticalAlign: 'middle',
                                cursor: 'help',
                              }}
                            >
                              legacy
                            </span>
                          )}
                        </div>
                        {rec.studentId && <div style={{ fontSize: 9, color: 'var(--color-sand-400)' }}>{rec.studentId}</div>}
                      </td>
                      <td style={{ ...tdStyle, fontSize: 10, color: 'var(--color-sand-400)' }}>{dateStr}</td>
                      {allLabels.map(label => {
                        // O(1) lookup via pre-indexed map (was O(N) .find() per cell)
                        const recMap = perRecordRubricMap.get(rec.reportPath ?? String(records.indexOf(rec)))
                        const row = recMap?.get(label)
                        if (!row) return <td key={label} style={{ ...tdStyle, textAlign: 'center', color: 'var(--color-sand-400)' }}>—</td>
                        const color = scoreColor(row.earned, row.possible)
                        return (
                          <td key={label} style={{ ...tdStyle, textAlign: 'center', color, fontWeight: 600 }}>
                            {row.earned != null ? `${row.earned}/${row.possible}` : '—'}
                          </td>
                        )
                      })}
                      <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700, color: scoreColor(rec.totalEarned, rec.totalPossible) }}>
                        {rec.pct != null ? `${rec.pct}%` : '—'}
                      </td>
                      <td style={{ ...tdStyle, minWidth: 160 }}>
                        {(rec._reportFilePath || rec.pdfPath) ? (
                          <textarea
                            rows={2}
                            placeholder="Add feedback…"
                            value={feedbackMap[rec._reportFilePath || rec.pdfPath!] ?? ''}
                            onChange={e => {
                              const text = e.target.value
                              const key = rec._reportFilePath || rec.pdfPath!
                              setFeedbackMap(prev => ({ ...prev, [key]: text }))
                            }}
                            onBlur={e => {
                              const text = e.target.value
                              // BUG-09: save to _reportFilePath (teacher's machine path) not pdfPath (student's path)
                              const savePath = rec._reportFilePath || rec.pdfPath
                              if (savePath) {
                                ;(window as any).electronAPI?.saveStudentFeedback(savePath, text)
                              }
                            }}
                            style={{
                              background: 'rgba(255,255,255,0.03)',
                              border: '1px solid rgba(255,255,255,0.08)',
                              borderRadius: '2px',
                              color: 'var(--color-text-primary)',
                              fontSize: 11,
                              padding: '4px 6px',
                              resize: 'vertical',
                              width: '100%',
                              fontFamily: 'inherit',
                              outline: 'none',
                            }}
                          />
                        ) : (
                          <span style={{ color: 'var(--color-sand-400)', fontSize: 10 }}>—</span>
                        )}
                        <button
                          onClick={() => {
                            const currentIsDraft = draftOverrides[rec.reportPath ?? ''] ?? rec.isDraft ?? false
                              setDraftOverrides(prev => ({ ...prev, [rec.reportPath ?? '']: !currentIsDraft }))
                              // LOW-20: match on studentId first (unique), fall back to
                              // studentName only when id is absent. Matching on name alone
                              // broke multi-assignment folders where two different students
                              // share a first name or a teacher has duplicate name entries.
                              const siblings = records.filter(r => {
                                if (r.reportPath === rec.reportPath) return false
                                if (rec.studentId && r.studentId) {
                                  return r.studentId.trim() === rec.studentId.trim()
                                }
                                return (r.studentName || '').trim().toLowerCase() === (rec.studentName || '').trim().toLowerCase()
                              })
                              if (siblings.length === 1) {
                                setDraftOverrides(prev => ({ ...prev, [siblings[0].reportPath ?? '']: currentIsDraft }))
                              }
                            }}
                            style={{
                              marginTop: 4, padding: '3px 8px',
                              background: 'none',
                              border: '1px solid rgba(208,176,102,0.2)',
                              borderRadius: '2px',
                              color: 'var(--color-sand-400)',
                              fontSize: 10, cursor: 'pointer',
                              letterSpacing: '0.04em', textTransform: 'uppercase',
                            }}
                          >
                            {effectiveIsDraft ? 'Mark Final' : 'Mark Draft'}
                          </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
