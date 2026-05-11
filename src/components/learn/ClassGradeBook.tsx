/**
 * ClassGradeBook — teacher-facing grade book overlay.
 *
 * Scans a folder for .rtm-report.json sidecar files (written alongside student
 * report PDFs by the generate-student-report IPC handler). Renders a sortable
 * grade book table with per-criterion scores and class statistics.
 *
 * Triggered by the "Grade Book" button in GuidedFlowBar (teacher role only).
 */
import React, { useState, useEffect, useCallback } from 'react'
import { useLearnMode } from '../../context/LearnModeContext'
import { LmsExportPanel } from './LmsExportPanel'

function detectRevisions(records: any[]): any[] {
  // Group by studentName (case-insensitive, trimmed)
  const groups: Record<string, any[]> = {}
  for (const r of records) {
    const key = (r.studentName || '').trim().toLowerCase()
    if (!groups[key]) groups[key] = []
    groups[key].push(r)
  }

  const result: any[] = []
  for (const key of Object.keys(groups)) {
    const group = groups[key]
    if (group.length === 1) {
      result.push({ ...group[0], submissionVersion: 1, isDraft: false })
    } else {
      // Sort by exportedAt ascending (oldest = v1)
      const sorted = [...group].sort((a, b) =>
        new Date(a.exportedAt || 0).getTime() - new Date(b.exportedAt || 0).getTime()
      )
      sorted.forEach((r, i) => {
        result.push({
          ...r,
          submissionVersion: i + 1,
          isDraft: i < sorted.length - 1,  // all but latest are drafts
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
  submissionVersion?: number
  isDraft?: boolean
  reportPath?: string
}

interface Props {
  open: boolean
  onClose: () => void
  /** Initial folder path (from assignment.submissionsFolder) */
  initialFolder?: string | null
}

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

  // Sync folder when assignment changes
  useEffect(() => {
    if (assignment?.submissionsFolder && !folder) {
      setFolder(assignment.submissionsFolder)
    }
  }, [assignment?.submissionsFolder])

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
        // Load feedback for each record
        const newFeedbackMap: Record<string, string> = {}
        for (const record of loadedRecords) {
          if (!record.pdfPath) continue
          try {
            const feedback = await (window as any).electronAPI.loadStudentFeedback(record.pdfPath)
            if (feedback?.text) {
              newFeedbackMap[record.pdfPath] = feedback.text
            }
          } catch {
            // best-effort, ignore errors
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
  useEffect(() => {
    if (open && folder) scan(folder)
  }, [open, folder])

  // Check if LMS is configured
  useEffect(() => {
    ;(window as any).electronAPI?.loadLmsConfig?.().then((res: any) => {
      setHasLmsConfig(res?.ok && res.config?.hasToken)
    }).catch(() => {})
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
    await (window as any).electronAPI?.exportGradebookCsv(records)
  }

  if (!open) return null

  // Derive unified column headers from all records' rubric labels
  const allLabels: string[] = []
  records.forEach(r => r.rubric?.forEach(row => {
    if (!allLabels.includes(row.label)) allLabels.push(row.label)
  }))

  // Sort records: isDraft ascending (false first), then user-selected sort
  const sorted = [...records].sort((a, b) => {
    const aIsDraft = draftOverrides[a.reportPath ?? ''] ?? a.isDraft ?? false
    const bIsDraft = draftOverrides[b.reportPath ?? ''] ?? b.isDraft ?? false
    if (aIsDraft !== bIsDraft) return aIsDraft ? 1 : -1
    let cmp = 0
    if (sortCol === 'name') cmp = (a.studentName ?? '').localeCompare(b.studentName ?? '')
    else if (sortCol === 'date') cmp = (a.exportedAt ?? '').localeCompare(b.exportedAt ?? '')
    else if (sortCol === 'pct') cmp = (a.pct ?? -1) - (b.pct ?? -1)
    return sortDir === 'asc' ? cmp : -cmp
  })

  const submitted = records.length
  const avgPct = records.length > 0
    ? Math.round(records.reduce((s, r) => s + (r.pct ?? 0), 0) / records.length * 10) / 10
    : null

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
    letterSpacing: '0.08em',
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
          <span style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>
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
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                padding: '5px 12px',
                cursor: records.length ? 'pointer' : 'not-allowed',
                opacity: records.length ? 1 : 0.5,
              }}
            >
              Export CSV
            </button>
            <button
              onClick={() => setLmsOpen(o => !o)}
              style={{
                background: 'transparent',
                border: '1px solid rgba(208,176,102,0.4)',
                borderRadius: '2px',
                color: 'var(--color-accent)',
                fontSize: 11,
                letterSpacing: '0.08em',
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
          const criterionNames: string[] = records[0]?.rubric?.map(r => r.label) ?? []
          const hasBlindTest = records.some(r => (r as any).blindTest?.answers?.length > 0)

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
                  letterSpacing: '0.1em',
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
                      <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-sand-400)', marginBottom: 8 }}>
                        Per-Criterion Performance
                      </div>
                      {criterionNames.map((criterion, idx) => {
                        const rowsForCriterion = records.map(r => r.rubric?.find(row => row.label === criterion)).filter(Boolean) as RubricRow[]
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
                  {hasBlindTest && (() => {
                    const btRecords = records.filter(r => (r as any).blindTest?.answers?.length > 0)
                    const btCount = btRecords.length
                    const avgCorrect = btCount > 0
                      ? Math.round(btRecords.reduce((s, r) => {
                          const answers = (r as any).blindTest?.answers ?? []
                          return s + answers.filter((a: any) => a.revealed === true).length
                        }, 0) / btCount * 10) / 10
                      : 0

                    // Dimension accuracy
                    const dimMap: Record<string, { correct: number; total: number }> = {}
                    btRecords.forEach(r => {
                      const answers: any[] = (r as any).blindTest?.answers ?? []
                      answers.forEach((a: any) => {
                        if (!a.dimension) return
                        if (!dimMap[a.dimension]) dimMap[a.dimension] = { correct: 0, total: 0 }
                        dimMap[a.dimension].total++
                        if (a.revealed) dimMap[a.dimension].correct++
                      })
                    })
                    const dims = Object.entries(dimMap).map(([name, d]) => ({ name, pct: d.total > 0 ? d.correct / d.total : 0 }))
                    dims.sort((a, b) => b.pct - a.pct)
                    const mostAccurate = dims[0]?.name ?? '—'
                    const leastAccurate = dims[dims.length - 1]?.name ?? '—'

                    return (
                      <div>
                        <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-sand-400)', marginBottom: 8 }}>
                          Blind Test Calibration
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-primary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div>{btCount} student{btCount !== 1 ? 's' : ''} completed blind test</div>
                          <div>Avg correct predictions: <span style={{ color: 'var(--color-accent)' }}>{avgCorrect}</span></div>
                          {dims.length > 0 && (
                            <>
                              <div>Most accurate dimension: <span style={{ color: '#6fcf97' }}>{mostAccurate}</span></div>
                              <div>Least accurate dimension: <span style={{ color: '#eb5757' }}>{leastAccurate}</span></div>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })()}

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
                        </div>
                        {rec.studentId && <div style={{ fontSize: 9, color: 'var(--color-sand-400)' }}>{rec.studentId}</div>}
                      </td>
                      <td style={{ ...tdStyle, fontSize: 10, color: 'var(--color-sand-400)' }}>{dateStr}</td>
                      {allLabels.map(label => {
                        const row = rec.rubric?.find(r => r.label === label)
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
                        {rec.pdfPath ? (
                          <textarea
                            rows={2}
                            placeholder="Add feedback…"
                            value={feedbackMap[rec.pdfPath] ?? ''}
                            onChange={e => {
                              const text = e.target.value
                              setFeedbackMap(prev => ({ ...prev, [rec.pdfPath!]: text }))
                            }}
                            onBlur={e => {
                              const text = e.target.value
                              if (rec.pdfPath) {
                                ;(window as any).electronAPI?.saveStudentFeedback(rec.pdfPath, text)
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
                        {(rec.submissionVersion ?? 1) > 1 && (
                          <button
                            onClick={() => {
                              const currentIsDraft = draftOverrides[rec.reportPath ?? ''] ?? rec.isDraft ?? false
                              setDraftOverrides(prev => ({ ...prev, [rec.reportPath ?? '']: !currentIsDraft }))
                              // If there are exactly 2 records for this student, flip the sibling too
                              const siblings = records.filter(r =>
                                (r.studentName || '').trim().toLowerCase() === (rec.studentName || '').trim().toLowerCase()
                                && r.reportPath !== rec.reportPath
                              )
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
                        )}
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
