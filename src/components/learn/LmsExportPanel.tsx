/**
 * LmsExportPanel — Canvas LMS configuration and grade upload panel.
 *
 * Renders as a collapsible section inside ClassGradeBook. Handles Canvas
 * API token setup, assignment selection, and grade submission.
 */
import React from 'react'

interface GradeRecord {
  studentId?: string
  studentName?: string
  totalEarned?: number
  totalPossible?: number
}

interface Props {
  records: any[] // GradeRecord array from ClassGradeBook
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: 'var(--color-text-primary)',
  borderRadius: '2px',
  fontSize: 12,
  padding: '6px 8px',
  width: '100%',
  boxSizing: 'border-box' as const,
  fontFamily: 'inherit',
  outline: 'none',
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.06em',
  textTransform: 'uppercase' as const,
  color: 'var(--color-sand-400)',
  flexShrink: 0,
  width: 100,
  paddingTop: 7,
}

export function LmsExportPanel({ records }: Props) {
  const [config, setConfig] = React.useState<{
    baseUrl: string
    courseId: string
    assignmentName: string
    hasToken: boolean
  } | null>(null)

  // CRIT-11: in-app confirm modal — replaces 3 sequential window.confirm() calls.
  // window.confirm() blocks the main thread, renders OS-native dialogs that look
  // out of place in Electron, and can't be styled. This state-machine approach
  // yields the same UX in a proper modal.
  const [confirmModal, setConfirmModal] = React.useState<{
    message: string
    resolve: (ok: boolean) => void
  } | null>(null)

  const showConfirm = React.useCallback((message: string): Promise<boolean> => {
    return new Promise(resolve => {
      setConfirmModal({ message, resolve })
    })
  }, [])

  const [formUrl, setFormUrl] = React.useState('')
  const [formCourseId, setFormCourseId] = React.useState('')
  const [formToken, setFormToken] = React.useState('')
  const [assignments, setAssignments] = React.useState<
    Array<{ id: string; name: string; pointsPossible: number }>
  >([])
  const [selectedAssignmentId, setSelectedAssignmentId] = React.useState('')
  const [status, setStatus] = React.useState<
    'idle' | 'testing' | 'fetching' | 'uploading' | 'done' | 'error'
  >('idle')
  const [message, setMessage] = React.useState('')
  const [configOpen, setConfigOpen] = React.useState(false)
  const [uploadResult, setUploadResult] = React.useState<{
    submitted: number
    skipped: number
    rejected: number   // MED: students with invalid SIS ID format (returned by canvas-upload-grades)
    total: number
  } | null>(null)
  const [testResult, setTestResult] = React.useState<{
    ok: boolean
    courseName?: string
    error?: string
  } | null>(null)
  const [saveMessage, setSaveMessage] = React.useState('')

  // Load saved config on mount
  React.useEffect(() => {
    ;(window as any).electronAPI?.loadLmsConfig?.().then((res: any) => {
      if (res?.ok && res.config) {
        setConfig(res.config)
        setFormUrl(res.config.baseUrl)
        setFormCourseId(res.config.courseId)
      } else {
        // BUG-19: auto-expand config form for first-time users so they can see
        // the setup form without having to discover the "⚙ Configure" button
        setConfigOpen(true)
      }
    }).catch(() => {
      // BUG-19: also expand on load failure so the form is visible
      setConfigOpen(true)
    })
  }, [])

  // Pre-select assignment by name when assignments load
  React.useEffect(() => {
    if (assignments.length > 0 && config?.assignmentName) {
      const match = assignments.find(a => a.name === config.assignmentName)
      if (match) setSelectedAssignmentId(match.id)
    }
  }, [assignments, config?.assignmentName])

  async function handleTestConnection() {
    setStatus('testing')
    setTestResult(null)
    try {
      const res = await (window as any).electronAPI?.canvasTestConnection()
      if (res?.ok) {
        setTestResult({ ok: true, courseName: res.courseName })
      } else {
        setTestResult({ ok: false, error: res?.error ?? 'Connection failed' })
      }
    } catch (e: any) {
      setTestResult({ ok: false, error: e?.message ?? 'Connection failed' })
    } finally {
      setStatus('idle')
    }
  }

  async function handleSave() {
    try {
      const res = await (window as any).electronAPI?.saveLmsConfig({
        baseUrl: formUrl,
        apiToken: formToken,
        courseId: formCourseId,
      })
      if (res?.ok) {
        setSaveMessage('✓ Saved')
        setFormToken('')
        setConfigOpen(false)
        // Reload config
        const reload = await (window as any).electronAPI?.loadLmsConfig()
        if (reload?.ok && reload.config) {
          setConfig(reload.config)
          setFormUrl(reload.config.baseUrl)
          setFormCourseId(reload.config.courseId)
        }
        setTimeout(() => setSaveMessage(''), 3000)
      } else {
        setSaveMessage('✗ ' + (res?.error ?? 'Save failed'))
      }
    } catch (e: any) {
      setSaveMessage('✗ ' + (e?.message ?? 'Save failed'))
    }
  }

  async function handleFetchAssignments() {
    setStatus('fetching')
    setMessage('')
    try {
      const res = await (window as any).electronAPI?.canvasGetAssignments()
      if (res?.ok && res.assignments) {
        setAssignments(res.assignments)
        if (res.assignments.length === 0) {
          setMessage('No assignments found in this course.')
        }
      } else {
        setMessage('✗ ' + (res?.error ?? 'Failed to fetch assignments'))
      }
    } catch (e: any) {
      setMessage('✗ ' + (e?.message ?? 'Failed to fetch assignments'))
    } finally {
      setStatus('idle')
    }
  }

  async function handleUpload() {
    if (!selectedAssignmentId || status === 'uploading') return

    // MED-13 fix: preview + confirmation before the upload commits.
    // Previously we sent grades straight to Canvas with no preview, no
    // points-possible sanity check, and silently skipped records missing
    // a studentId. Now we:
    //   1. Show a sorted preview (top 5 students by score) with totals
    //   2. Hard-block when records are missing studentId
    //   3. Warn if rubric totalPossible doesn't match the selected
    //      Canvas assignment's pointsPossible (off-by-2x bug magnet)
    const grades = records.map((r: GradeRecord) => ({
      studentId: r.studentId ?? '',
      studentName: r.studentName ?? '',
      score: r.totalEarned ?? 0,
      totalPossible: r.totalPossible ?? 100,
    }))
    const missingId = grades.filter(g => !g.studentId).map(g => g.studentName || '(no name)')
    if (missingId.length > 0) {
      const proceed = await showConfirm(
        `⚠ ${missingId.length} student(s) have no Canvas Student ID set:\n\n` +
        missingId.slice(0, 8).join('\n') +
        (missingId.length > 8 ? `\n…and ${missingId.length - 8} more` : '') +
        '\n\nThese students will be SKIPPED on upload. ' +
        'Have them re-export their report with a Student ID filled in. ' +
        '\n\nContinue with the upload anyway?'
      )
      if (!proceed) return
    }
    const valid = grades.filter(g => g.studentId)
    const selectedAssignment = assignments.find(a => a.id === selectedAssignmentId)
    // Points-mismatch warning: students' rubrics may total a different number of
    // points than the Canvas assignment expects, leading to wildly off grades.
    const rubricTotals = Array.from(new Set(valid.map(g => g.totalPossible)))
    const canvasPoints = selectedAssignment?.pointsPossible
    if (canvasPoints != null && rubricTotals.length === 1 && rubricTotals[0] !== canvasPoints) {
      const proceed = await showConfirm(
        `⚠ Points-possible mismatch.\n\n` +
        `Your rubric totals ${rubricTotals[0]} points but the Canvas assignment ` +
        `"${selectedAssignment?.name}" is configured for ${canvasPoints} points.\n\n` +
        `Canvas will scale: a student who earned ${rubricTotals[0]} pts (100%) will appear ` +
        `as ${rubricTotals[0]} / ${canvasPoints} = ${((rubricTotals[0] / canvasPoints) * 100).toFixed(0)}% in Canvas.\n\n` +
        `Update the Canvas assignment to ${rubricTotals[0]} points first?`
      )
      if (!proceed) return
    }
    // Final preview before commit
    const top5 = [...valid].sort((a, b) => b.score - a.score).slice(0, 5)
    const previewLines = top5.map(g => `  ${g.studentName || g.studentId}: ${g.score}/${g.totalPossible}`).join('\n')
    const ok = await showConfirm(
      `Upload ${valid.length} grade${valid.length !== 1 ? 's' : ''} to "${selectedAssignment?.name ?? selectedAssignmentId}"?\n\n` +
      `Top 5 scores being submitted:\n${previewLines}\n\n` +
      `${missingId.length > 0 ? `(${missingId.length} student(s) without Student IDs will be skipped.)\n\n` : ''}` +
      `This action cannot be undone.`
    )
    if (!ok) return

    setStatus('uploading')
    setMessage('')
    setUploadResult(null)
    try {
      const res = await (window as any).electronAPI?.canvasUploadGrades({
        assignmentId: selectedAssignmentId,
        grades,
      })
      if (res?.ok) {
        setStatus('done')
        setUploadResult({
          submitted: res.submitted ?? 0,
          skipped: res.skipped ?? 0,
          rejected: res.rejected ?? 0,  // MED: invalid SIS ID format count
          total: res.total ?? records.length,
        })
      } else {
        setStatus('error')
        setMessage(res?.error ?? 'Upload failed')
      }
    } catch (e: any) {
      setStatus('error')
      setMessage(e?.message ?? 'Upload failed')
    }
  }

  const withStudentId = records.filter((r: GradeRecord) => r.studentId)
  const withoutStudentId = records.filter((r: GradeRecord) => !r.studentId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* CRIT-11: in-app confirm modal renders over everything */}
      {confirmModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(14,13,11,0.75)',
          backdropFilter: 'blur(3px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
          role="alertdialog" aria-modal="true"
          onKeyDown={e => {
            if (e.key === 'Enter') { confirmModal.resolve(true); setConfirmModal(null) }
            if (e.key === 'Escape') { confirmModal.resolve(false); setConfirmModal(null) }
          }}
        >
          <div style={{
            background: 'rgba(28,26,22,0.98)',
            border: '1px solid rgba(168,161,150,0.2)',
            borderRadius: 4,
            padding: '24px 28px',
            maxWidth: 480, width: '90%',
            boxShadow: '0 16px 60px rgba(0,0,0,0.6)',
          }}>
            <div style={{
              fontSize: 12, color: 'var(--color-text-primary)',
              whiteSpace: 'pre-wrap', lineHeight: 1.6,
              marginBottom: 20,
            }}>
              {confirmModal.message}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { confirmModal.resolve(false); setConfirmModal(null) }}
                style={{
                  padding: '7px 18px', borderRadius: 2, cursor: 'pointer',
                  background: 'transparent', border: '1px solid rgba(168,161,150,0.3)',
                  color: 'var(--color-sand-400)', fontSize: 11, fontFamily: 'inherit',
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                }}
              >Cancel</button>
              <button
                autoFocus
                onClick={() => { confirmModal.resolve(true); setConfirmModal(null) }}
                style={{
                  padding: '7px 18px', borderRadius: 2, cursor: 'pointer',
                  background: 'rgba(208,176,102,0.12)', border: '1px solid rgba(208,176,102,0.5)',
                  color: 'var(--color-text-primary)', fontSize: 11, fontFamily: 'inherit',
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                }}
              >Continue</button>
            </div>
          </div>
        </div>
      )}

      {/* Header row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: configOpen || config?.hasToken ? 12 : 0,
      }}>
        <span style={{
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--color-accent)',
          flexShrink: 0,
        }}>
          Canvas LMS
        </span>

        <button
          onClick={() => setConfigOpen(o => !o)}
          style={{
            background: config?.hasToken ? 'none' : 'rgba(208,176,102,0.05)',
            border: config?.hasToken ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(208,176,102,0.4)',
            borderRadius: '2px',
            color: config?.hasToken ? 'var(--color-sand-400)' : 'var(--color-accent)',
            fontSize: 10,
            letterSpacing: '0.06em',
            padding: '3px 8px',
            cursor: 'pointer',
          }}
        >
          {config?.hasToken ? '⚙ Configure' : '⚙ Set Up Canvas'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
          {config?.hasToken ? (
            <>
              <span style={{ color: '#6fcf97', fontSize: 12, lineHeight: 1 }}>●</span>
              <span style={{
                fontSize: 10,
                color: 'var(--color-sand-400)',
                maxWidth: 220,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {config.baseUrl ? config.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'Connected'}
              </span>
            </>
          ) : (
            <>
              <span style={{ color: 'rgba(168,161,150,0.5)', fontSize: 12, lineHeight: 1 }}>○</span>
              <span style={{ fontSize: 10, color: 'rgba(168,161,150,0.5)' }}>Not configured</span>
            </>
          )}
        </div>
      </div>

      {/* Config panel */}
      {configOpen && (
        <div style={{
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '2px',
          padding: '14px 16px',
          marginBottom: 16,
          background: 'rgba(255,255,255,0.02)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>

          {/* Canvas URL */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={labelStyle}>Canvas URL</span>
            <input
              type="text"
              value={formUrl}
              onChange={e => setFormUrl(e.target.value)}
              placeholder="https://canvas.institution.edu"
              style={inputStyle}
            />
          </div>

          {/* API Token */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={labelStyle}>API Token</span>
            <input
              type="password"
              value={formToken}
              onChange={e => setFormToken(e.target.value)}
              placeholder="Your Canvas API token (Developer Keys)"
              style={inputStyle}
            />
          </div>

          {/* Course ID */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={labelStyle}>Course ID</span>
            <input
              type="text"
              value={formCourseId}
              onChange={e => setFormCourseId(e.target.value)}
              placeholder="123456 or sis_course_id:ABC101"
              style={inputStyle}
            />
          </div>

          {/* Token note */}
          <div style={{
            fontSize: 10,
            color: 'rgba(208,176,102,0.6)',
            lineHeight: 1.5,
            marginTop: 2,
          }}>
            Generate a token in Canvas → Account → Settings → New Access Token.
            Your token is stored encrypted on this machine and never transmitted
            except to your Canvas server.
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
            <button
              onClick={handleTestConnection}
              disabled={status === 'testing' || !!formToken}
              title={formToken ? 'Save your credentials first, then test' : 'Test connection to Canvas'}
              style={{
                background: 'none',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '2px',
                color: 'var(--color-text-primary)',
                fontSize: 10,
                letterSpacing: '0.06em',
                padding: '5px 12px',
                cursor: (status === 'testing' || !!formToken) ? 'not-allowed' : 'pointer',
                opacity: (status === 'testing' || !!formToken) ? 0.4 : 1,
              }}
            >
              {status === 'testing' ? 'Testing…' : 'Test Connection'}
            </button>
            <button
              onClick={handleSave}
              style={{
                background: 'none',
                border: '1px solid rgba(208,176,102,0.4)',
                borderRadius: '2px',
                color: 'var(--color-accent)',
                fontSize: 10,
                letterSpacing: '0.06em',
                padding: '5px 12px',
                cursor: 'pointer',
              }}
            >
              Save
            </button>
            {saveMessage && (
              <span style={{
                fontSize: 11,
                color: saveMessage.startsWith('✓') ? 'rgba(111,207,151,0.9)' : 'rgba(220,80,60,0.9)',
              }}>
                {saveMessage}
              </span>
            )}
          </div>

          {/* Test result */}
          {testResult && (
            <div style={{
              fontSize: 11,
              color: testResult.ok ? 'rgba(111,207,151,0.9)' : 'rgba(220,80,60,0.9)',
              marginTop: 2,
            }}>
              {testResult.ok
                ? `✓ Connected — ${testResult.courseName ?? 'Course found'}`
                : `✗ ${testResult.error}`
              }
            </div>
          )}
        </div>
      )}

      {/* Upload section — only when configured */}
      {config?.hasToken && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Step 1: Assignment picker */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontSize: 10,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--color-sand-400)',
              flexShrink: 0,
            }}>
              Assignment:
            </span>

            {assignments.length === 0 ? (
              <button
                onClick={handleFetchAssignments}
                disabled={status === 'fetching'}
                style={{
                  background: 'none',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '2px',
                  color: 'var(--color-text-primary)',
                  fontSize: 10,
                  letterSpacing: '0.06em',
                  padding: '5px 12px',
                  cursor: status === 'fetching' ? 'not-allowed' : 'pointer',
                  opacity: status === 'fetching' ? 0.6 : 1,
                }}
              >
                {status === 'fetching' ? 'Fetching…' : 'Fetch Assignments'}
              </button>
            ) : (
              <>
                <select
                  value={selectedAssignmentId}
                  onChange={e => setSelectedAssignmentId(e.target.value)}
                  style={{
                    ...inputStyle,
                    width: 'auto',
                    flex: 1,
                    maxWidth: 320,
                  }}
                >
                  <option value="">— Select assignment —</option>
                  {assignments.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.pointsPossible} pts)
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleFetchAssignments}
                  disabled={status === 'fetching'}
                  style={{
                    background: 'none',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '2px',
                    color: 'var(--color-sand-400)',
                    fontSize: 10,
                    padding: '5px 8px',
                    cursor: status === 'fetching' ? 'not-allowed' : 'pointer',
                    flexShrink: 0,
                  }}
                >
                  ↻
                </button>
              </>
            )}
          </div>

          {/* Fetch error */}
          {message && status === 'idle' && assignments.length === 0 && (
            <div style={{ fontSize: 11, color: 'rgba(220,80,60,0.9)' }}>{message}</div>
          )}

          {/* Step 2: Preview */}
          {records.length > 0 && (
            <div style={{
              fontSize: 10,
              color: 'var(--color-sand-400)',
              lineHeight: 1.5,
            }}>
              Will submit <span style={{ color: 'var(--color-text-primary)' }}>{withStudentId.length}</span> grades
              {withoutStudentId.length > 0 && (
                <span>
                  {' '}·{' '}
                  <span style={{ color: 'rgba(242,201,76,0.9)' }}>{withoutStudentId.length} student{withoutStudentId.length !== 1 ? 's' : ''}</span>
                  {' '}missing Student ID will be skipped
                </span>
              )}
            </div>
          )}

          {/* Step 3: Upload button */}
          <div>
            <button
              onClick={handleUpload}
              disabled={!selectedAssignmentId || status === 'uploading'}
              style={{
                background: 'none',
                border: '1px solid rgba(208,176,102,0.6)',
                borderRadius: '2px',
                color: (!selectedAssignmentId || status === 'uploading') ? 'rgba(208,176,102,0.4)' : 'var(--color-accent)',
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                padding: '6px 16px',
                cursor: (!selectedAssignmentId || status === 'uploading') ? 'not-allowed' : 'pointer',
                opacity: (!selectedAssignmentId || status === 'uploading') ? 0.5 : 1,
              }}
            >
              {status === 'uploading'
                ? 'Uploading…'
                : `⬆ Upload ${withStudentId.length} Grade${withStudentId.length !== 1 ? 's' : ''} to Canvas`
              }
            </button>
          </div>

          {/* Upload success result */}
          {status === 'done' && uploadResult && (
            <div style={{
              border: '1px solid rgba(111,207,151,0.3)',
              borderRadius: '2px',
              padding: '10px 14px',
              background: 'rgba(111,207,151,0.06)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}>
              <div style={{ fontSize: 12, color: 'rgba(111,207,151,0.9)' }}>
                ✓ Submitted {uploadResult.submitted} grade{uploadResult.submitted !== 1 ? 's' : ''}.
                {' '}Grades appear in Canvas within a minute.
              </div>
              {uploadResult.skipped > 0 && (
                <div style={{ fontSize: 11, color: 'rgba(242,201,76,0.9)' }}>
                  ⚠ {uploadResult.skipped} student{uploadResult.skipped !== 1 ? 's' : ''} skipped — missing Student ID.
                </div>
              )}
              {uploadResult.skipped > 0 && (
                <div style={{ fontSize: 10, color: 'var(--color-sand-400)', lineHeight: 1.5, marginTop: 2 }}>
                  Students with no Student ID in their report must resubmit with their Canvas Student ID entered in the assignment settings.
                </div>
              )}
              {/* MED: show rejected count (invalid SIS ID format) returned by canvas-upload-grades */}
              {uploadResult.rejected > 0 && (
                <div style={{ fontSize: 11, color: 'rgba(220,80,60,0.9)', marginTop: 2 }}>
                  ✗ {uploadResult.rejected} student{uploadResult.rejected !== 1 ? 's' : ''} rejected — Student ID format not recognized by Canvas.
                </div>
              )}
              {uploadResult.rejected > 0 && (
                <div style={{ fontSize: 10, color: 'var(--color-sand-400)', lineHeight: 1.5, marginTop: 2 }}>
                  Canvas SIS IDs must be numeric (e.g. <code style={{ fontFamily: 'monospace', fontSize: 10 }}>123456</code>).
                  In Canvas: People → student row → SIS Login ID column.
                  Enter that number in the Student ID field inside each affected student's report, then ask them to resubmit.
                </div>
              )}
            </div>
          )}

          {/* Upload error */}
          {status === 'error' && message && (
            <div style={{
              border: '1px solid rgba(220,80,60,0.3)',
              borderRadius: '2px',
              padding: '10px 14px',
              background: 'rgba(220,80,60,0.06)',
              fontSize: 12,
              color: 'rgba(220,80,60,0.9)',
            }}>
              ✗ {message}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
