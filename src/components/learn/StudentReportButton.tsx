import React, { useState } from 'react'
import { useLearnMode } from '../../context/LearnModeContext'
import type { AssignmentConfig, LearnAnnotation } from '../../types'

interface StudentReportPayload {
  assignment: AssignmentConfig | null
  annotations: LearnAnnotation[]
  analysisResult: any
  fileAName: string
  fileBName: string
  exportedAt: string
}

interface Props {
  analysisResult: any
  fileAName?: string
  fileBName?: string
}

export function StudentReportButton({ analysisResult, fileAName = 'File A', fileBName = 'File B' }: Props) {
  const { enabled, assignment, annotations } = useLearnMode()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleExport() {
    setLoading(true)
    setError(null)

    const payload: StudentReportPayload = {
      assignment,
      annotations,
      analysisResult,
      fileAName,
      fileBName,
      exportedAt: new Date().toISOString(),
    }

    const TIMEOUT_MS = 30_000

    try {
      const result = await Promise.race([
        (window as any).electronAPI.generateStudentReport(payload),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Report generation timed out after 30 s')), TIMEOUT_MS)
        ),
      ])
      if (result?.ok && result.path) {
        await (window as any).electronAPI.revealInFinder(result.path)
      } else {
        setError(result?.error || 'Export failed')
      }
    } catch (e: any) {
      setError(e?.message || 'Export failed')
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    const handler = () => { if (!loading) handleExport() }
    window.addEventListener('rtm-learn-export-report', handler)
    return () => window.removeEventListener('rtm-learn-export-report', handler)
  }, [loading, assignment, annotations, analysisResult, fileAName, fileBName])

  if (!enabled) return null

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <button
        onClick={handleExport}
        disabled={loading}
        style={{
          border: '1px solid rgba(208,176,102,0.4)',
          borderRadius: '2px',
          background: 'none',
          color: loading ? 'var(--color-sand-400)' : 'var(--color-text-primary)',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          padding: '6px 14px',
          cursor: loading ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit',
          transition: 'border-color 0.15s',
        }}
      >
        {loading ? 'Exporting…' : 'Export Report'}
      </button>
      {error && (
        <span style={{ fontSize: 10, color: 'rgba(220,80,60,0.9)', maxWidth: 200, textAlign: 'right' }}>
          {error}
        </span>
      )}
    </div>
  )
}
