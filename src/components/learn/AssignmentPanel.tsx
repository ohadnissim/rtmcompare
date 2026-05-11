/**
 * AssignmentPanel — teacher-facing slide-in panel for configuring an assignment.
 *
 * Slides in from the right. Contains:
 * - Assignment metadata (title, course, instructor, due date, genre)
 * - Reference file lock toggle
 * - Target spec lock toggle + dropdown
 * - Rubric builder with per-metric target / tolerance / weight rows (add/remove)
 * - Save / Clear / Export / Import buttons
 */

import React, { useState, useEffect } from 'react'
import type { AssignmentConfig, RubricCriteria } from '../../types'

// ─── Default rubric rows ─────────────────────────────────────────────────────

const DEFAULT_RUBRIC: RubricCriteria[] = [
  { id: 'lufs_i',    metric: 'lufs_i',            label: 'Integrated Loudness',  target: -14,  tolerance: 1.5, weight: 0.30 },
  { id: 'lra',       metric: 'lra',               label: 'Dynamic Range (LRA)',  target: 7,    tolerance: 2,   weight: 0.25 },
  { id: 'true_peak', metric: 'true_peak_dbtp',    label: 'True Peak',            target: -1,   tolerance: 0.5, weight: 0.25 },
  { id: 'mono',      metric: 'mono_compat_pct',   label: 'Mono Compat Loss %',   target: 3,    tolerance: 2,   weight: 0.20 },
]

const SPEC_OPTIONS = [
  { id: 'spotify',   label: 'Spotify (−14 LUFS-I, −1 dBTP)' },
  { id: 'apple',     label: 'Apple Music (−16 LUFS-I, −1 dBTP)' },
  { id: 'youtube',   label: 'YouTube (−14 LUFS-I, −1 dBTP)' },
  { id: 'tidal',     label: 'Tidal (−14 LUFS-I, −1 dBTP)' },
  { id: 'broadcast', label: 'Broadcast EBU R128 (−23 LUFS-I)' },
]

const GENRE_OPTIONS = [
  'Pop', 'EDM / Electronic', 'Rock', 'Metal',
  'Hip-Hop / R&B', 'Country', 'Jazz',
  'Classical / Orchestral', 'Folk / Acoustic',
  'Podcast / Spoken Word', 'Other'
]

const GENRE_TARGETS: Record<string, { lraLo: number; lraHi: number; lufsTarget: number }> = {
  'Pop':                   { lraLo: 4,  lraHi: 7,  lufsTarget: -14 },
  'EDM / Electronic':      { lraLo: 4,  lraHi: 6,  lufsTarget: -9  },
  'Rock':                  { lraLo: 8,  lraHi: 12, lufsTarget: -12 },
  'Metal':                 { lraLo: 4,  lraHi: 7,  lufsTarget: -10 },
  'Hip-Hop / R&B':         { lraLo: 6,  lraHi: 9,  lufsTarget: -12 },
  'Country':               { lraLo: 8,  lraHi: 12, lufsTarget: -13 },
  'Jazz':                  { lraLo: 10, lraHi: 14, lufsTarget: -18 },
  'Classical / Orchestral':{ lraLo: 14, lraHi: 20, lufsTarget: -23 },
  'Folk / Acoustic':       { lraLo: 10, lraHi: 16, lufsTarget: -16 },
  'Podcast / Spoken Word': { lraLo: 6,  lraHi: 12, lufsTarget: -16 },
  'Other':                 { lraLo: 6,  lraHi: 12, lufsTarget: -14 },
}

const METRIC_OPTIONS = [
  { key: 'lufs_i',            label: 'Integrated Loudness' },
  { key: 'lra',               label: 'Dynamic Range (LRA)' },
  { key: 'true_peak_dbtp',    label: 'True Peak' },
  { key: 'mono_compat_pct',   label: 'Mono Compat Loss %' },
  { key: 'stereo_width',      label: 'Stereo Width' },
  { key: 'plr',               label: 'Peak-to-Loudness Ratio (PLR)' },
  { key: 'tonal_deviation',   label: 'Tonal Balance Deviation' },
  { key: 'distortion',        label: 'Distortion / Clipping' },
  { key: 'masking_overlap',   label: 'Frequency Masking' },
  { key: 'click_count',       label: 'Click / Artifact Count' },
  { key: 'center_fill_ms',      label: 'Center Fill (M/S Ratio)' },
  { key: 'noise_floor',         label: 'Noise Floor' },
  { key: 'transient_integrity', label: 'Transient Integrity' },
  { key: 'dither_applied',      label: 'Dithering Applied (16-bit delivery)' },
]

// ─── Rubric templates ────────────────────────────────────────────────────────

const RUBRIC_TEMPLATES: Array<{
  name: string
  description: string
  rows: Array<{ metric: string; target: number; tolerance: number; points: number }>
}> = [
  {
    name: 'Mixing Fundamentals',
    description: 'Tonal balance, loudness, mono compat, masking — week 4–6 level',
    rows: [
      { metric: 'lufs_i',          target: -14, tolerance: 2,   points: 10 },
      { metric: 'tonal_deviation', target: 0,   tolerance: 3,   points: 10 },
      { metric: 'masking_overlap', target: 0,   tolerance: 15,  points: 10 },
      { metric: 'mono_compat_pct', target: 90,  tolerance: 8,   points: 10 },
      { metric: 'lra',             target: 9,   tolerance: 3,   points: 10 },
    ],
  },
  {
    name: 'Mastering Final Project',
    description: 'All 12 metrics, strict tolerances — final exam standard',
    rows: [
      { metric: 'lufs_i',           target: -14,  tolerance: 1,   points: 10 },
      { metric: 'lra',              target: 9,    tolerance: 2,   points: 10 },
      { metric: 'true_peak_dbtp',   target: -1,   tolerance: 0.5, points: 10 },
      { metric: 'mono_compat_pct',  target: 92,   tolerance: 5,   points: 10 },
      { metric: 'stereo_width',     target: 0.65, tolerance: 0.15,points: 10 },
      { metric: 'plr',              target: 10,   tolerance: 3,   points: 10 },
      { metric: 'tonal_deviation',  target: 0,    tolerance: 2,   points: 10 },
      { metric: 'distortion',       target: 0,    tolerance: 2,   points: 10 },
      { metric: 'masking_overlap',  target: 0,    tolerance: 10,  points: 10 },
      { metric: 'click_count',      target: 0,    tolerance: 0,   points: 10 },
      { metric: 'center_fill_ms',   target: 1.0,  tolerance: 0.3, points: 10 },
      { metric: 'noise_floor',      target: -75,  tolerance: 10,  points: 10 },
    ],
  },
  {
    name: 'Advanced Dynamics Focus',
    description: 'Dynamics-only rubric: LRA, PLR, transients, noise, artifacts',
    rows: [
      { metric: 'lra',         target: 9,   tolerance: 2,  points: 20 },
      { metric: 'plr',         target: 10,  tolerance: 3,  points: 20 },
      { metric: 'distortion',  target: 0,   tolerance: 1,  points: 20 },
      { metric: 'noise_floor', target: -75, tolerance: 10, points: 20 },
      { metric: 'click_count', target: 0,   tolerance: 0,  points: 20 },
    ],
  },
]

// ─── Sub-components / style helpers ─────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(168,161,150,0.15)',
  borderRadius: '2px',
  color: 'var(--color-text-primary)',
  padding: '6px 10px',
  fontSize: 12,
  width: '100%',
  outline: 'none',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 10,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-sand-400)',
  marginBottom: 4,
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--color-accent)',
  marginBottom: 10,
  marginTop: 18,
  paddingBottom: 4,
  borderBottom: '1px solid rgba(208,176,102,0.1)',
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
  onSave: (cfg: AssignmentConfig) => void
  onClear: () => void
  current: AssignmentConfig | null
  /** Current reference file path (from App state) — captured when lock is toggled on */
  referenceFilePath: string | null
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AssignmentPanel({ open, onClose, onSave, onClear, current, referenceFilePath }: Props) {
  const [title, setTitle]               = useState(current?.title ?? '')
  const [course, setCourse]             = useState(current?.course ?? '')
  const [instructor, setInstructor]     = useState(current?.instructor ?? '')
  const [dueDate, setDueDate]           = useState(current?.dueDate ?? '')
  const [genre, setGenre]               = useState(current?.genre ?? '')
  const [lockRef, setLockRef]           = useState(!!current?.lockedReferenceFile)
  const [lockSpec, setLockSpec]         = useState(!!current?.lockedTargetSpec)
  const [selectedSpec, setSelectedSpec] = useState(current?.lockedTargetSpec ?? SPEC_OPTIONS[0].id)
  const [submissionsFolder, setSubmissionsFolder] = useState(current?.submissionsFolder ?? '')
  const [rubric, setRubric]             = useState<RubricCriteria[]>(
    current?.rubric?.length ? current.rubric : DEFAULT_RUBRIC
  )
  const [templateOpen, setTemplateOpen]       = useState(false)
  const [templateApplied, setTemplateApplied] = useState('')
  const [importError, setImportError]         = useState('')

  // Sync when `current` changes (e.g. loaded from context)
  useEffect(() => {
    if (current) {
      setTitle(current.title ?? '')
      setCourse(current.course ?? '')
      setInstructor(current.instructor ?? '')
      setDueDate(current.dueDate ?? '')
      setGenre(current.genre ?? '')
      setSubmissionsFolder(current.submissionsFolder ?? '')
      setLockRef(!!current.lockedReferenceFile)
      setLockSpec(!!current.lockedTargetSpec)
      setSelectedSpec(current.lockedTargetSpec ?? SPEC_OPTIONS[0].id)
      setRubric(current.rubric?.length ? current.rubric : DEFAULT_RUBRIC)
    }
  }, [current])

  // Clear template confirmation after 2s
  useEffect(() => {
    if (!templateApplied) return
    const t = setTimeout(() => setTemplateApplied(''), 2000)
    return () => clearTimeout(t)
  }, [templateApplied])

  // Rubric helpers
  const updateRubricRow = (id: string, field: keyof RubricCriteria, raw: string) => {
    setRubric(prev => prev.map(row => {
      if (row.id !== id) return row
      if (field === 'label') return { ...row, label: raw }
      if (field === 'metric') return { ...row, metric: raw }
      const num = parseFloat(raw)
      return { ...row, [field]: isNaN(num) ? row[field as 'target'] : num }
    }))
  }

  const totalWeight = rubric.reduce((acc, r) => acc + r.weight, 0)
  const weightOk = Math.abs(totalWeight - 1) < 0.01

  const handleSave = () => {
    const cfg: AssignmentConfig = {
      title,
      course,
      instructor,
      studentName: '',
      dueDate: dueDate || undefined,
      genre: genre || undefined,
      submissionsFolder: submissionsFolder || undefined,
      lockedReferenceFile: lockRef ? (referenceFilePath ?? current?.lockedReferenceFile ?? null) : null,
      lockedTargetSpec: lockSpec ? selectedSpec : null,
      rubric,
    }
    onSave(cfg)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Assignment Setup"
      style={{
        position: 'fixed',
        right: 0,
        top: 28,
        width: 320,
        height: 'calc(100vh - 28px)',
        background: 'rgba(21,20,17,0.98)',
        borderLeft: '1px solid rgba(208,176,102,0.25)',
        zIndex: 60,
        overflowY: 'auto',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.22s ease',
        padding: '20px 18px 32px',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
        <span
          style={{
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--color-accent)',
          }}
        >
          Assignment Setup
        </span>
        <button
          onClick={onClose}
          aria-label="Close assignment panel"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-sand-400)',
            fontSize: 18,
            cursor: 'pointer',
            lineHeight: 1,
            padding: '2px 4px',
          }}
        >
          ×
        </button>
      </div>

      {/* ── Metadata ─────────────────────────────────────────────────── */}
      <div style={sectionTitleStyle}>Details</div>

      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle}>Assignment Title</label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Week 4 Mastering Critique"
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle}>Course Name</label>
        <input
          type="text"
          value={course}
          onChange={e => setCourse(e.target.value)}
          placeholder="e.g. Music Production 301"
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle}>Instructor Name</label>
        <input
          type="text"
          value={instructor}
          onChange={e => setInstructor(e.target.value)}
          placeholder="e.g. Dr. Amara Diallo"
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle}>Due Date</label>
        <input
          type="date"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={labelStyle}>Genre</label>
        <select value={genre} onChange={e => setGenre(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
          <option value="">— Select genre —</option>
          {GENRE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        {genre && GENRE_TARGETS[genre] && (
          <div style={{
            fontSize: 10,
            color: 'var(--color-sand-400)',
            marginTop: 4,
            padding: '4px 8px',
            background: 'rgba(208,176,102,0.04)',
            border: '1px solid rgba(208,176,102,0.1)',
            borderRadius: '2px',
            lineHeight: 1.6,
          }}>
            LRA: {GENRE_TARGETS[genre].lraLo}–{GENRE_TARGETS[genre].lraHi} LU
            &nbsp;·&nbsp;
            LUFS-I target: {GENRE_TARGETS[genre].lufsTarget} LUFS
          </div>
        )}
      </div>

      {/* ── Locks ────────────────────────────────────────────────────── */}
      <div style={sectionTitleStyle}>Locks</div>

      <label
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          marginBottom: 12,
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={lockRef}
          onChange={e => setLockRef(e.target.checked)}
          style={{ marginTop: 2, accentColor: 'var(--color-accent)', flexShrink: 0 }}
        />
        <div>
          <span style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>
            Lock Reference File
          </span>
          {lockRef && (
            <div style={{ fontSize: 11, color: 'var(--color-sand-400)', marginTop: 3 }}>
              {referenceFilePath
                ? referenceFilePath.split(/[\\/]/).pop()
                : current?.lockedReferenceFile
                ? current.lockedReferenceFile.split(/[\\/]/).pop()
                : 'No reference file loaded yet'}
            </div>
          )}
          <div
            style={{
              fontSize: 10,
              color: 'var(--color-sand-400)',
              marginTop: 3,
              fontStyle: 'italic',
            }}
          >
            Students won't be able to change the reference.
          </div>
        </div>
      </label>

      <label
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          marginBottom: lockSpec ? 8 : 18,
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={lockSpec}
          onChange={e => setLockSpec(e.target.checked)}
          style={{ marginTop: 2, accentColor: 'var(--color-accent)', flexShrink: 0 }}
        />
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>
            Lock Target Spec
          </span>
          <div
            style={{
              fontSize: 10,
              color: 'var(--color-sand-400)',
              marginTop: 3,
              fontStyle: 'italic',
            }}
          >
            Students can't change the delivery spec chip.
          </div>
        </div>
      </label>

      {lockSpec && (
        <div style={{ marginBottom: 14, paddingLeft: 26 }}>
          <select
            value={selectedSpec}
            onChange={e => setSelectedSpec(e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            {SPEC_OPTIONS.map(opt => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ── Class Submissions ────────────────────────────────────────── */}
      <div style={sectionTitleStyle}>Class Submissions</div>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Submissions Folder</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={submissionsFolder}
            readOnly
            placeholder="Pick folder where students drop their reports…"
            style={{ ...inputStyle, flex: 1, cursor: 'default', color: submissionsFolder ? 'var(--color-text-primary)' : 'var(--color-sand-400)', fontSize: 11 }}
          />
          <button
            onClick={async () => {
              const folderPath = await (window as any).electronAPI?.pickFolder('Select submissions folder')
              if (folderPath) setSubmissionsFolder(folderPath)
            }}
            style={{
              flexShrink: 0,
              background: 'transparent',
              border: '1px solid rgba(208,176,102,0.35)',
              borderRadius: '2px',
              color: 'var(--color-accent)',
              fontSize: 10,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              padding: '5px 10px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Pick Folder
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--color-sand-400)', marginTop: 4, fontStyle: 'italic' }}>
          Students drop their .rtm-report.json files here. The Grade Book scans this folder.
        </div>
      </div>

      {/* ── Rubric ───────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          ...sectionTitleStyle,
          position: 'relative',
        }}
      >
        <span>Rubric Criteria</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {templateApplied && (
            <span style={{ fontSize: 10, color: 'var(--color-accent)', letterSpacing: '0.04em' }}>
              ✓ {templateApplied} template applied
            </span>
          )}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setTemplateOpen(o => !o)}
              style={{
                background: 'none',
                border: '1px solid rgba(208,176,102,0.35)',
                borderRadius: '2px',
                color: 'var(--color-accent)',
                fontSize: 10,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                padding: '2px 7px',
                cursor: 'pointer',
              }}
            >
              Templates ▾
            </button>
            {templateOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 4,
                  zIndex: 300,
                  background: 'rgba(14,13,11,0.98)',
                  border: '1px solid rgba(208,176,102,0.3)',
                  borderRadius: '2px',
                  width: 240,
                  overflow: 'hidden',
                }}
              >
                {RUBRIC_TEMPLATES.map((tpl, idx) => (
                  <div
                    key={tpl.name}
                    style={{
                      padding: '10px 12px',
                      borderBottom: idx < RUBRIC_TEMPLATES.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--color-text-primary)', marginBottom: 2 }}>
                        {tpl.name}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--color-accent)', lineHeight: 1.4 }}>
                        {tpl.description}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        const totalPts = tpl.rows.reduce((s, r) => s + r.points, 0)
                        setRubric(tpl.rows.map((r, i) => {
                          const opt = METRIC_OPTIONS.find(m => m.key === r.metric)
                          return {
                            id: `tpl-${Date.now()}-${i}`,
                            metric: r.metric,
                            label: opt?.label ?? r.metric,
                            target: r.target,
                            tolerance: r.tolerance,
                            weight: totalPts > 0 ? r.points / totalPts : 1 / tpl.rows.length,
                          }
                        }))
                        setTemplateOpen(false)
                        setTemplateApplied(tpl.name)
                      }}
                      style={{
                        flexShrink: 0,
                        background: 'none',
                        border: '1px solid rgba(208,176,102,0.35)',
                        borderRadius: '2px',
                        color: 'var(--color-accent)',
                        fontSize: 9,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        padding: '3px 7px',
                        cursor: 'pointer',
                      }}
                    >
                      Apply
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setRubric(DEFAULT_RUBRIC)}
            style={{
              background: 'none',
              border: '1px solid rgba(208,176,102,0.3)',
              borderRadius: '2px',
              color: 'var(--color-accent)',
              fontSize: 9,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '2px 7px',
              cursor: 'pointer',
            }}
          >
            Load Defaults
          </button>
        </div>
      </div>

      {/* Table header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 52px 52px 44px 28px',
          gap: 4,
          marginBottom: 4,
        }}
      >
        {(['Metric', 'Target', '±', 'Wt%', ''] as const).map((h, i) => (
          <span
            key={i}
            style={{
              fontSize: 9,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-sand-400)',
            }}
          >
            {h}
          </span>
        ))}
      </div>

      {rubric.map(row => (
        <div
          key={row.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 52px 52px 44px 28px',
            gap: 4,
            marginBottom: 5,
            alignItems: 'center',
          }}
        >
          <select
            value={row.metric}
            onChange={e => {
              const selectedMetric = METRIC_OPTIONS.find(m => m.key === e.target.value)
              setRubric(prev => prev.map(r =>
                r.id !== row.id ? r : {
                  ...r,
                  metric: e.target.value,
                  label: selectedMetric?.label ?? e.target.value,
                }
              ))
            }}
            style={{ ...inputStyle, fontSize: 11, padding: '4px 7px', cursor: 'pointer' }}
          >
            {METRIC_OPTIONS.map(m => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
          <input
            type="number"
            value={row.target}
            onChange={e => updateRubricRow(row.id, 'target', e.target.value)}
            style={{ ...inputStyle, fontSize: 11, padding: '4px 6px', textAlign: 'right' }}
          />
          <input
            type="number"
            value={row.tolerance}
            onChange={e => updateRubricRow(row.id, 'tolerance', e.target.value)}
            style={{ ...inputStyle, fontSize: 11, padding: '4px 6px', textAlign: 'right' }}
          />
          <input
            type="number"
            value={Math.round(row.weight * 100)}
            onChange={e => updateRubricRow(row.id, 'weight', String(parseFloat(e.target.value) / 100))}
            min={0}
            max={100}
            style={{ ...inputStyle, fontSize: 11, padding: '4px 6px', textAlign: 'right' }}
          />
          <button
            onClick={() => setRubric(prev => prev.filter(r => r.id !== row.id))}
            style={{ background: 'none', border: 'none', color: 'rgba(220,80,60,0.7)', fontSize: 14, cursor: 'pointer', padding: 0, lineHeight: 1 }}
            aria-label="Remove row"
          >
            −
          </button>
        </div>
      ))}

      {/* Add Criterion button */}
      <button
        onClick={() => {
          const newId = `row-${Date.now()}`
          setRubric(prev => [...prev, { id: newId, metric: 'lufs_i', label: 'Integrated Loudness', target: -14, tolerance: 1.5, weight: 0.10 }])
        }}
        style={{
          background: 'none',
          border: '1px solid rgba(208,176,102,0.2)',
          borderRadius: '2px',
          color: 'var(--color-sand-400)',
          fontSize: 10,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          padding: '4px 10px',
          cursor: 'pointer',
          marginBottom: 8,
          width: '100%',
        }}
      >
        + Add Criterion
      </button>

      {/* Weight total indicator */}
      <div
        style={{
          fontSize: 10,
          color: weightOk ? 'var(--color-accent)' : '#e05a5a',
          marginBottom: 8,
        }}
      >
        Total weight: {Math.round(totalWeight * 100)}%
        {!weightOk && ' (must equal 100%)'}
      </div>

      {/* ── Actions ──────────────────────────────────────────────────── */}
      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          onClick={handleSave}
          disabled={!title.trim()}
          style={{
            background: 'rgba(208,176,102,0.1)',
            border: '1px solid rgba(208,176,102,0.5)',
            borderRadius: '2px',
            color: title.trim() ? 'var(--color-text-primary)' : 'var(--color-sand-400)',
            fontSize: 12,
            letterSpacing: '0.08em',
            padding: '8px 14px',
            cursor: title.trim() ? 'pointer' : 'not-allowed',
            textTransform: 'uppercase',
            opacity: title.trim() ? 1 : 0.5,
          }}
        >
          Save Assignment
        </button>
        <button
          onClick={onClear}
          style={{
            background: 'transparent',
            border: '1px solid rgba(168,161,150,0.2)',
            borderRadius: '2px',
            color: 'var(--color-sand-400)',
            fontSize: 11,
            letterSpacing: '0.06em',
            padding: '7px 14px',
            cursor: 'pointer',
            textTransform: 'uppercase',
          }}
        >
          Clear Assignment
        </button>
        <button
          onClick={async () => {
            const cfg: AssignmentConfig = { title, course, instructor, studentName: '', dueDate: dueDate || undefined, genre: genre || undefined, lockedReferenceFile: lockRef ? (referenceFilePath ?? current?.lockedReferenceFile ?? null) : null, lockedTargetSpec: lockSpec ? selectedSpec : null, rubric }
            const json = JSON.stringify(cfg, null, 2)
            await (window as any).electronAPI?.saveFileDialog(
              `${title || 'assignment'}.rtm-assignment.json`,
              json,
              [{ name: 'RTMcompare Assignment', extensions: ['rtm-assignment.json'] }]
            )
          }}
          style={{
            background: 'transparent',
            border: '1px solid rgba(168,161,150,0.2)',
            borderRadius: '2px',
            color: 'var(--color-sand-400)',
            fontSize: 11,
            letterSpacing: '0.06em',
            padding: '7px 14px',
            cursor: 'pointer',
            textTransform: 'uppercase',
          }}
        >
          Export (.json)
        </button>
        <button
          onClick={async () => {
            const text = await (window as any).electronAPI?.openTextFileDialog([
              { name: 'RTMcompare Assignment', extensions: ['rtm-assignment.json', 'json'] }
            ])
            if (!text) return
            try {
              const cfg = JSON.parse(text) as AssignmentConfig
              setTitle(cfg.title ?? '')
              setCourse(cfg.course ?? '')
              setInstructor(cfg.instructor ?? '')
              setDueDate(cfg.dueDate ?? '')
              setGenre(cfg.genre ?? '')
              setLockRef(!!cfg.lockedReferenceFile)
              setLockSpec(!!cfg.lockedTargetSpec)
              if (cfg.lockedTargetSpec) setSelectedSpec(cfg.lockedTargetSpec)
              if (cfg.rubric?.length) setRubric(cfg.rubric)
              // BUG-15 fix: restore submissionsFolder so grade book can find submissions
              if (cfg.submissionsFolder) setSubmissionsFolder(cfg.submissionsFolder)
              setImportError('')
            } catch (err: any) {
              setImportError('Invalid assignment file — could not parse JSON.')
              setTimeout(() => setImportError(''), 4000)
            }
          }}
          style={{
            background: 'transparent',
            border: '1px solid rgba(168,161,150,0.2)',
            borderRadius: '2px',
            color: 'var(--color-sand-400)',
            fontSize: 11,
            letterSpacing: '0.06em',
            padding: '7px 14px',
            cursor: 'pointer',
            textTransform: 'uppercase',
          }}
        >
          Import (.json)
        </button>
        {importError && (
          <div style={{ fontSize: 10, color: 'rgba(220,80,60,0.9)', marginTop: 4 }}>
            {importError}
          </div>
        )}
      </div>
    </div>
  )
}
