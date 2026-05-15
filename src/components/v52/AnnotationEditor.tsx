/**
 * AnnotationEditor — A5, teacher authoring UI for DeltaAnnotations.
 *
 * A form inside TeacherDashboard that lets teachers write, preview,
 * and save annotations. Saved annotations append to a localStorage
 * list (key: 'rtm-custom-annotations') that DeltaAnnotations reads
 * at the top of its fetch chain before falling back to the seed JSON.
 *
 * Fields: metric, context (a_louder/b_louder/etc.), delta threshold,
 * body text. Preview updates live. Save appends to the local store.
 *
 * Console Didone: ink panel, 2px corners, single gold CTA.
 */

import React, { useState, useRef, useEffect } from 'react'
import ThemedConfirmDialog from './ThemedConfirmDialog'

export interface AnnotationRecord {
  id: string
  metric: string
  context: string
  delta_threshold?: number
  body: string
  audience?: string
  createdAt: string
}

const ANNOTATION_STORE_KEY = 'rtm-custom-annotations'
/** LOW-5: cap the custom annotation store — prevents unbounded localStorage growth. */
const MAX_ENTRIES = 200
/** MED-16: bump when AnnotationRecord shape changes incompatibly. */
const ANNOTATION_SCHEMA_VERSION = 1

export function getCustomAnnotations(): AnnotationRecord[] {
  try {
    const raw = window.localStorage.getItem(ANNOTATION_STORE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (parsed !== null && !Array.isArray(parsed)) {
      if (typeof parsed === 'object' && (parsed as any).v !== ANNOTATION_SCHEMA_VERSION) return []
      if (typeof parsed === 'object' && Array.isArray((parsed as any).data)) return (parsed as any).data
      return []
    }
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveAnnotation(record: AnnotationRecord): void {
  try {
    const existing = getCustomAnnotations()
    const idx = existing.findIndex(a => a.id === record.id)
    if (idx >= 0) existing[idx] = record
    else existing.unshift(record)
    // LOW-5: enforce MAX_ENTRIES cap.
    if (existing.length > MAX_ENTRIES) existing.length = MAX_ENTRIES
    window.localStorage.setItem(ANNOTATION_STORE_KEY, JSON.stringify(existing))
  } catch { /* silently fail */ }
}

function deleteAnnotation(id: string): void {
  try {
    const existing = getCustomAnnotations().filter(a => a.id !== id)
    window.localStorage.setItem(ANNOTATION_STORE_KEY, JSON.stringify(existing))
  } catch { /* noop */ }
}

const METRICS = [
  'lufs_i', 'true_peak_dbtp', 'lra', 'plr', 'stereo_width',
  'mono_compat_pct', 'tonal_deviation', 'distortion', 'masking_overlap', 'center_fill_ms',
]

const CONTEXTS = [
  'a_louder', 'b_louder', 'a_brighter', 'b_brighter',
  'a_wider', 'b_wider', 'a_more_dynamic', 'b_more_dynamic', 'any',
]

const SAND_700 = 'rgba(168,161,150,0.22)'
const SAND_400 = 'var(--color-text-muted)'
const SAND_200 = '#cfc8bb'
const CREAM = 'var(--color-text-primary)'
const GOLD = 'var(--color-accent)'
const INK = 'var(--color-bg-app)'
const PANEL = 'var(--color-bg-panel, #1c1b17)'

const trackedCaps = (px: number, color: string): React.CSSProperties => ({
  fontFamily: 'var(--font-sans)',
  fontSize: px,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color,
  fontWeight: 500,
})

const inputStyle: React.CSSProperties = {
  backgroundColor: PANEL,
  border: `1px solid ${SAND_700}`,
  borderRadius: 2,
  color: CREAM,
  fontFamily: 'var(--font-sans)',
  fontSize: 12,
  padding: '8px 12px',
  width: '100%',
  boxSizing: 'border-box',
}

export function AnnotationEditor() {
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>(getCustomAnnotations)
  const [metric, setMetric] = useState(METRICS[0])
  const [context, setContext] = useState(CONTEXTS[0])
  const [threshold, setThreshold] = useState('')
  const [body, setBody] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  // LOW-4: clear the "Saved ✓" dismiss timer on unmount to prevent setState-after-unmount.
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (savedTimerRef.current != null) clearTimeout(savedTimerRef.current) }, [])

  const refresh = () => setAnnotations(getCustomAnnotations())

  const handleSave = () => {
    if (!body.trim()) return
    const record: AnnotationRecord = {
      // MED-19: prefix with 'custom:' to prevent any UUID collision with seed annotations.
      id: editingId ?? `custom:${crypto.randomUUID()}`,
      metric,
      context,
      delta_threshold: threshold ? parseFloat(threshold) : undefined,
      body: body.trim(),
      createdAt: new Date().toISOString(),
    }
    saveAnnotation(record)
    refresh()
    setEditingId(null)
    setBody('')
    setThreshold('')
    setSaved(true)
    if (savedTimerRef.current != null) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
  }

  const handleEdit = (a: AnnotationRecord) => {
    setEditingId(a.id)
    setMetric(a.metric)
    setContext(a.context)
    setThreshold(a.delta_threshold != null ? String(a.delta_threshold) : '')
    setBody(a.body)
  }

  const handleDelete = (id: string) => {
    deleteAnnotation(id)
    refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, padding: '24px 0' }}>
      <div style={trackedCaps(10, SAND_400)}>
        {editingId ? 'Edit annotation' : 'New annotation'}
      </div>

      {/* Form */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="ae-metric" style={trackedCaps(9, SAND_400)}>Metric</label>
          <select id="ae-metric" value={metric} onChange={e => setMetric(e.target.value)} style={inputStyle}>
            {METRICS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="ae-context" style={trackedCaps(9, SAND_400)}>Context</label>
          <select id="ae-context" value={context} onChange={e => setContext(e.target.value)} style={inputStyle}>
            {CONTEXTS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="ae-threshold" style={trackedCaps(9, SAND_400)}>Delta threshold (optional)</label>
          <input
            id="ae-threshold"
            type="number"
            step="0.1"
            placeholder="e.g. 1.5"
            value={threshold}
            onChange={e => setThreshold(e.target.value)}
            style={inputStyle}
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor="ae-body" style={trackedCaps(9, SAND_400)}>Body (50–200 words)</label>
        <textarea
          id="ae-body"
          rows={5}
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Write the annotation text that students will see when this metric fires…"
          style={{ ...inputStyle, resize: 'vertical' }}
        />
        <div style={{ ...trackedCaps(9, SAND_400), textAlign: 'right' }}>
          {body.trim().split(/\s+/).filter(Boolean).length} words
        </div>
      </div>

      {/* Live preview */}
      {body && (
        <div style={{
          backgroundColor: PANEL,
          border: `1px solid ${SAND_700}`,
          borderLeft: `2px solid ${GOLD}`,
          borderRadius: 2,
          padding: '14px 18px',
        }}>
          <div style={trackedCaps(9, SAND_400)}>Preview · {metric} · {context}</div>
          <p style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontSize: 13,
            color: SAND_200,
            margin: '8px 0 0',
            lineHeight: 1.6,
          }}>{body}</p>
        </div>
      )}

      {/* Save CTA */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={!body.trim()}
          style={{
            ...trackedCaps(11, !body.trim() ? SAND_400 : INK),
            background: !body.trim() ? 'transparent' : GOLD,
            border: `1px solid ${!body.trim() ? SAND_700 : GOLD}`,
            borderRadius: 2,
            padding: '10px 24px',
            cursor: body.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          {editingId ? 'Update annotation' : 'Save annotation'}
        </button>
        {editingId && (
          <button
            type="button"
            onClick={() => { setEditingId(null); setBody(''); setThreshold('') }}
            style={{
              ...trackedCaps(11, SAND_400),
              background: 'transparent',
              border: `1px solid ${SAND_700}`,
              borderRadius: 2,
              padding: '10px 20px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        )}
        {saved && <span style={trackedCaps(10, GOLD)}>Saved ✓</span>}
      </div>

      {/* Saved annotations list */}
      {annotations.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ ...trackedCaps(10, SAND_400), borderTop: `1px solid ${SAND_700}`, paddingTop: 20 }}>
            Saved annotations ({annotations.length})
          </div>
          {annotations.map(a => (
            <div key={a.id} style={{
              backgroundColor: PANEL,
              border: `1px solid ${SAND_700}`,
              borderRadius: 2,
              padding: '12px 16px',
              display: 'flex',
              gap: 16,
              alignItems: 'flex-start',
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ ...trackedCaps(9, SAND_400), marginBottom: 4 }}>
                  {a.metric} · {a.context}{a.delta_threshold != null ? ` · Δ≥${a.delta_threshold}` : ''}
                </div>
                <p style={{
                  fontFamily: 'var(--font-display)',
                  fontStyle: 'italic',
                  fontSize: 12,
                  color: SAND_200,
                  margin: 0,
                  lineHeight: 1.5,
                }}>
                  {a.body.length > 120 ? a.body.slice(0, 120) + '…' : a.body}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button type="button" onClick={() => handleEdit(a)}
                  style={{ ...trackedCaps(9, SAND_400), background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px' }}>
                  Edit
                </button>
                <button type="button" onClick={() => setConfirmDeleteId(a.id)}
                  style={{ ...trackedCaps(9, 'var(--color-danger)'), background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px' }}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {confirmDeleteId && (
        <ThemedConfirmDialog
          tone="destructive"
          title="Delete annotation"
          body="This annotation will be permanently removed from your store and cannot be recovered."
          confirmLabel="Delete"
          onConfirm={() => { handleDelete(confirmDeleteId); setConfirmDeleteId(null) }}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  )
}

export default AnnotationEditor
