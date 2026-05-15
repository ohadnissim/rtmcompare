/**
 * DeltaAnnotations — pedagogical side-panel for Mastering Delta values.
 *
 * Active only for `student` and `teacher` audiences. Each Δ in MasteringDelta
 * becomes clickable; the panel renders a curriculum-quality explanation
 * authored in `/v5.2-annotations.json` (also at `.rtm-design/v5.2-annotations.json`).
 *
 * Console Didone surface: ink field, single gold (left-rule + Δ value), 2px
 * corners, Instrument Serif italic for the Δ and body. The panel IS the gold
 * surface — parent surface should drop its gold gutter when annotations are on.
 *
 * Accessibility: focus trap on mount (close button focused first, Tab cycles
 * inside the panel), Esc closes, backdrop click closes.
 */

import { useEffect, useRef, useState } from 'react'

export interface DeltaAnnotation {
  metric: string
  context: string
  delta_threshold_lu?: number
  delta_threshold_db?: number
  delta_threshold?: number
  body: string
}

interface DeltaAnnotationsProps {
  metric: string
  delta: number
  unit: string
  fileAName?: string
  fileBName?: string
  onClose: () => void
}

let cachedAnnotations: DeltaAnnotation[] | null = null

async function loadAnnotations(): Promise<DeltaAnnotation[]> {
  if (cachedAnnotations) return cachedAnnotations
  try {
    const res = await fetch('/v5.2-annotations.json')
    if (!res.ok) return []
    const data = await res.json()
    cachedAnnotations = (data.annotations || []) as DeltaAnnotation[]
    return cachedAnnotations
  } catch {
    return []
  }
}

function selectAnnotation(
  annos: DeltaAnnotation[],
  metric: string,
  delta: number,
): DeltaAnnotation | null {
  const candidates = annos.filter(a => a.metric === metric)
  if (candidates.length === 0) return null

  let context = ''
  if (metric === 'lufs_i') context = delta > 0 ? 'b_louder' : 'a_louder'
  else if (metric === 'true_peak_dbtp' || metric === 'plr') {
    context = delta > 0 ? 'b_higher' : 'a_higher'
  } else if (metric === 'lra_lu') context = delta > 0 ? 'b_wider' : 'a_wider'
  else if (metric === 'stereo_correlation') context = delta < 0 ? 'lower' : ''

  const match = candidates.find(a => a.context === context)
  if (!match) return null

  const threshold =
    match.delta_threshold_lu ?? match.delta_threshold_db ?? match.delta_threshold
  if (threshold !== undefined && Math.abs(delta) < threshold) return null
  return match
}

function metricLabel(metric: string): string {
  const map: Record<string, string> = {
    lufs_i: 'LUFS-I',
    true_peak_dbtp: 'TRUE PEAK',
    lra_lu: 'LRA',
    plr: 'PLR',
    stereo_correlation: 'STEREO CORRELATION',
  }
  return map[metric] || metric.toUpperCase().replace(/_/g, ' ')
}

function directionLine(
  metric: string,
  delta: number,
  fileAName?: string,
  fileBName?: string,
): string {
  const A = fileAName || 'A'
  const B = fileBName || 'B'
  if (Math.abs(delta) < 0.001) return `${A} → ${B} (no change)`
  if (metric === 'lufs_i') {
    return delta > 0 ? `${B} IS LOUDER THAN ${A}` : `${A} IS LOUDER THAN ${B}`
  }
  if (metric === 'true_peak_dbtp' || metric === 'plr') {
    return delta > 0 ? `${B} IS HIGHER THAN ${A}` : `${A} IS HIGHER THAN ${B}`
  }
  if (metric === 'lra_lu') {
    return delta > 0 ? `${B} IS WIDER THAN ${A}` : `${A} IS WIDER THAN ${B}`
  }
  if (metric === 'stereo_correlation') {
    return delta < 0 ? `${B} IS WIDER THAN ${A}` : `${A} IS WIDER THAN ${B}`
  }
  return `${A} → ${B}`
}

export function DeltaAnnotations({
  metric,
  delta,
  unit,
  fileAName,
  fileBName,
  onClose,
}: DeltaAnnotationsProps) {
  const [annotation, setAnnotation] = useState<DeltaAnnotation | null>(null)
  const [loaded, setLoaded] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let alive = true
    loadAnnotations().then(annos => {
      if (!alive) return
      setAnnotation(selectAnnotation(annos, metric, delta))
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [metric, delta])

  // Focus management + Esc + Tab trap.
  useEffect(() => {
    const previousActive = document.activeElement as HTMLElement | null
    closeBtnRef.current?.focus()

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previousActive?.focus?.()
    }
  }, [onClose])

  const deltaSign = delta > 0 ? '+' : delta < 0 ? '' : ''
  const deltaDisplay = `Δ ${deltaSign}${isFinite(delta) ? delta.toFixed(1) : '—'} ${unit}`

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Annotation for ${metricLabel(metric)}`}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        backgroundColor: 'rgba(14,13,11,0.6)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        style={{
          width: '33vw',
          minWidth: '420px',
          maxWidth: '560px',
          height: '100%',
          backgroundColor: 'var(--color-bg-app)',
          borderLeft: '1px solid var(--color-border-strong, rgba(168,161,150,0.3))',
          padding: '2rem',
          overflowY: 'auto',
          position: 'relative',
        }}
      >
        {/* 2px gold left-rule */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '2rem',
            top: '2rem',
            bottom: '2rem',
            width: '2px',
            backgroundColor: 'var(--color-accent)',
          }}
        />

        <div style={{ paddingLeft: '1.5rem', position: 'relative' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              marginBottom: '1.5rem',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--color-text-muted)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              ANNOTATION · {metricLabel(metric)}
            </div>
            <button
              ref={closeBtnRef}
              onClick={onClose}
              aria-label="Close annotation"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-text-primary)',
                fontSize: '20px',
                cursor: 'pointer',
                padding: '0 4px',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>

          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontStyle: 'italic',
              fontSize: '48px',
              color: 'var(--color-accent)',
              lineHeight: 1.05,
              marginBottom: '0.75rem',
            }}
          >
            {deltaDisplay}
          </div>

          <div
            style={{
              fontSize: '11px',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--color-text-muted)',
              fontFamily: 'var(--font-mono)',
              marginBottom: '2rem',
            }}
          >
            {directionLine(metric, delta, fileAName, fileBName)}
          </div>

          {loaded && annotation ? (
            <p
              style={{
                fontFamily: 'var(--font-display)',
                fontStyle: 'italic',
                fontSize: '16px',
                color: 'var(--color-text-primary)',
                lineHeight: 1.7,
                marginBottom: '2.5rem',
              }}
            >
              {annotation.body}
            </p>
          ) : loaded ? (
            <p
              style={{
                fontFamily: 'var(--font-display)',
                fontStyle: 'italic',
                fontSize: '16px',
                color: 'var(--color-text-muted)',
                lineHeight: 1.7,
                marginBottom: '2.5rem',
              }}
            >
              No annotation authored for this delta yet. Teachers can author one
              in <span style={{ fontFamily: 'var(--font-mono)', fontStyle: 'normal', fontSize: '13px' }}>v5.2-annotations.json</span>.
            </p>
          ) : (
            <p
              style={{
                fontSize: '11px',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--color-text-muted)',
                fontFamily: 'var(--font-mono)',
                marginBottom: '2.5rem',
              }}
            >
              Loading…
            </p>
          )}

          <div
            style={{
              fontSize: '9px',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--color-text-muted)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            AUTHORED · curriculum
          </div>
        </div>
      </div>
    </div>
  )
}

export default DeltaAnnotations
