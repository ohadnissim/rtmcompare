import React, { useCallback, useEffect, useMemo, useState, memo } from 'react'

// Console Didone v5.3 — RTMprofile design upgrade.
// All colours now reference CSS variables from src/index.css.
// No inline hex constants; no gold fills; no centred hero layout;
// no AI-design tells. See DESIGN-UPGRADE.md for the full audit log.

// CSS variable references — typed for intellisense; values live in index.css
const V = {
  gold:     'var(--gold)',
  cream:    'var(--cream)',
  ink:      'var(--ink)',
  border:   'var(--border)',
  sand100:  'var(--color-sand-100)',
  sand300:  'var(--color-sand-300)',
  sand400:  'var(--color-sand-400)',
  sand500:  'var(--color-sand-500)',
  sand700:  'var(--color-sand-700)',
  sand800:  'var(--color-sand-800)',
  sand900:  'var(--color-sand-900)',
  success:  'var(--success)',
  danger:   'var(--danger)',
  goldTint: 'var(--gold-tint)',
  radius:   'var(--radius)',
} as const

interface ProgressEvent { i: number; total: number; file: string }
interface BuildResult {
  ok: boolean
  path?: string
  sample_count?: number
  skipped?: number
  error?: string
  python_resolution?: string
}

/** Memoised status line — owns the progress subscription + its own
 *  re-renders on every IPC tick. The rest of the App tree stays
 *  unmounted-by-renders during a long Python build. */
const BuildStatusLine = memo(function BuildStatusLine({
  busy, deepScan,
}: { busy: boolean; deepScan: boolean }) {
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  useEffect(() => window.rtmprofileAPI.onProgress(setProgress), [])
  if (!busy) return <>{deepScan ? 'BUILD PROFILE — DEEP SCAN' : 'BUILD PROFILE'}</>
  if (!progress) return <>STARTING</>
  return (
    <>
      {deepScan ? 'DEEP-SCANNING' : 'ANALYZING'} {progress.i} / {progress.total}
    </>
  )
})

/** Memoised file row — stable reference so the full list doesn't
 *  reconcile on every parent state change (progress tick, field edit). */
const FileRow = memo(function FileRow({
  path, busy, onRemove,
}: { path: string; busy: boolean; onRemove: (p: string) => void }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 10px',
      fontSize: 12,
      fontFamily: V.sand100, // intentionally keep mono via className below
      borderBottom: `1px solid rgba(168,161,150,0.05)`,
    }}>
      <span
        className="mono"
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          paddingRight: 8,
          color: V.sand100,
        }}
      >
        {path.split(/[/\\]/).pop()}
      </span>
      <button
        onClick={() => onRemove(path)}
        disabled={busy}
        style={btnGhost}
        aria-label={`Remove ${path.split(/[/\\]/).pop()}`}
        title="Remove"
        className="no-drag"
      >×</button>
    </div>
  )
})

export default function App() {
  const [files, setFiles] = useState<string[]>([])
  const [name, setName] = useState('')
  const [role, setRole] = useState('Mastering Engineer')
  const [deepScan, setDeepScan] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BuildResult | null>(null)
  const [dragHover, setDragHover] = useState(false)

  const onPick = useCallback(async () => {
    const picked = await window.rtmprofileAPI.selectFiles()
    if (picked.length > 0) {
      setFiles(prev => Array.from(new Set([...prev, ...picked])))
    }
  }, [])

  const onClear = useCallback(() => { setFiles([]); setResult(null) }, [])
  const onRemoveOne = useCallback((path: string) => {
    setFiles(prev => prev.filter(f => f !== path))
  }, [])

  const onBuild = useCallback(async () => {
    if (files.length === 0 || !name.trim()) return
    setBusy(true)
    setResult(null)
    try {
      const r = await window.rtmprofileAPI.buildProfile({
        name: name.trim(),
        role: role.trim() || 'Mastering Engineer',
        deep: deepScan,
        files,
      })
      setResult(r)
    } finally {
      setBusy(false)
    }
  }, [files, name, role, deepScan])

  const onReveal = useCallback(async () => {
    if (result?.path) await window.rtmprofileAPI.showSavedProfile(result.path)
  }, [result])

  // Drag-and-drop with visible depth counter to avoid flicker on child drag events.
  useEffect(() => {
    let depth = 0
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault(); depth++
      if (depth === 1) setDragHover(true)
    }
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault(); depth = Math.max(0, depth - 1)
      if (depth === 0) setDragHover(false)
    }
    const onDragOver = (e: DragEvent) => { e.preventDefault() }
    const onDrop    = (e: DragEvent) => { e.preventDefault(); depth = 0; setDragHover(false) }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover',  onDragOver)
    window.addEventListener('drop',      onDrop)
    const unsub = window.rtmprofileAPI?.onFilesDropped?.((paths) => {
      const dropped = (paths || []).filter(Boolean)
      if (dropped.length > 0) {
        setFiles(prev => Array.from(new Set([...prev, ...dropped])))
      }
    })
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover',  onDragOver)
      window.removeEventListener('drop',      onDrop)
      if (typeof unsub === 'function') unsub()
    }
  }, [])

  const canBuild = files.length > 0 && name.trim().length > 0 && !busy

  // Drop-zone style derived from drag state. Memoised for object identity stability.
  const dropZoneStyle: React.CSSProperties = useMemo(() => ({
    border: `1.5px ${dragHover ? 'solid' : 'dashed'} ${dragHover ? 'var(--gold)' : 'var(--border)'}`,
    borderRadius: 'var(--radius)',
    padding: 24,
    backgroundColor: dragHover ? 'var(--gold-tint)' : 'var(--color-sand-800)',
    marginBottom: 16,
    minHeight: 160,
    transition: 'border-color 120ms, background-color 120ms',
  }), [dragHover])

  return (
    <div style={{
      minHeight: '100vh',
      padding: '32px 28px 28px',
      boxSizing: 'border-box',
      overflowY: 'auto',
    }}>
      {/* macOS frameless drag strip */}
      <div
        className="drag-region"
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, height: 36, zIndex: 1000, pointerEvents: 'auto',
        }}
        aria-hidden
      />

      {/* ── Header / Wordmark ──────────────────────────────────────── */}
      {/* Left-anchored per philosophy. Instrument Serif for the wordmark.
          Gold appears exactly ONCE per surface — the italic kicker word.
          Everything else stays cream / sand. */}
      <header
        className="drag-region"
        style={{ marginBottom: 28, marginTop: 12 }}
      >
        <div
          className="display-serif"
          style={{ fontSize: 48, color: V.cream, lineHeight: 1, marginBottom: 12, letterSpacing: '0.02em' }}
        >
          RTMprofile
        </div>

        {/* Single gold word — the one chromatic gesture per the philosophy */}
        <div
          className="display-serif-italic"
          style={{ fontSize: 22, color: V.sand300, lineHeight: 1.2, marginBottom: 6 }}
        >
          Teach RTM your <span style={{ color: V.gold }}>ear</span>.
        </div>

        <div style={{
          fontSize: 10,
          color: V.sand400,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          marginBottom: 14,
        }}>
          Companion to RTMcompare
        </div>

        <p style={{ fontSize: 14, color: V.sand300, lineHeight: 1.5, marginTop: 0, marginBottom: 8, maxWidth: 620 }}>
          Feed RTMprofile 5+ finished masters. It reads your spectral signature and
          writes a fingerprint file that RTMcompare uses to grade new mixes against
          your standard.
        </p>
        <p style={{ fontSize: 12, color: V.sand400, lineHeight: 1.5, marginTop: 0, maxWidth: 620 }}>
          Output: a <span className="mono" style={{ color: V.sand100 }}>.json</span> profile.
          Load it from RTMcompare's Match tab → profile dropdown.
        </p>
      </header>

      {/* ── Identity fields ───────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <Field label="Engineer name *" value={name} onChange={setName} placeholder="e.g. Ohad Nissim" />
        <Field label="Role" value={role} onChange={setRole} placeholder="Mastering Engineer" />
      </div>

      {/* ── Drop zone ─────────────────────────────────────────────── */}
      {/* Left-anchored, asymmetric. No centred stack (anti-AI rule #12).
          Headline in Instrument Serif italic. Sublabel in Outfit 300. */}
      <div
        style={dropZoneStyle}
        role="region"
        aria-label="Audio file drop zone — drop tracks here or click Browse"
      >
        {files.length === 0 ? (
          <div style={{ paddingTop: 4 }}>
            <div
              className="display-serif-italic"
              style={{ fontSize: 26, color: V.sand100, lineHeight: 1.15, marginBottom: 10 }}
            >
              Drop your masters here.
            </div>
            <div style={{ fontSize: 13, color: V.sand400, fontWeight: 300, marginBottom: 16 }}>
              Or select files from disk —
            </div>
            <button
              onClick={onPick}
              disabled={busy}
              style={btnSecondary}
              className="no-drag"
              aria-label="Browse audio files"
            >
              Browse files
            </button>
            <div
              className="mono"
              style={{ marginTop: 16, fontSize: 11, color: V.sand500 }}
            >
              .wav · .aiff · .flac · .mp3 · .m4a — 5+ tracks recommended
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: V.sand400, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                {files.length} file{files.length === 1 ? '' : 's'} staged
              </div>
              <div style={{ display: 'flex', gap: 8 }} className="no-drag">
                <button onClick={onPick} disabled={busy} style={btnSecondary} className="no-drag">
                  + add more
                </button>
                <button onClick={onClear} disabled={busy} style={btnSecondary} className="no-drag">
                  clear
                </button>
              </div>
            </div>
            <div style={{ maxHeight: 240, overflowY: 'auto', paddingRight: 4 }}>
              {files.map(f => (
                <FileRow key={f} path={f} busy={busy} onRemove={onRemoveOne} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Deep Scan toggle ──────────────────────────────────────── */}
      <label style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px 14px',
        marginBottom: 12,
        borderRadius: 'var(--radius)',
        border: `1px solid ${deepScan ? 'rgba(208,176,102,0.45)' : 'var(--border)'}`,
        backgroundColor: deepScan ? 'rgba(208,176,102,0.06)' : 'rgba(31,27,23,0.5)',
        cursor: busy ? 'not-allowed' : 'pointer',
        transition: 'border-color 120ms, background-color 120ms',
      }}>
        <input
          type="checkbox"
          checked={deepScan}
          onChange={e => setDeepScan(e.target.checked)}
          disabled={busy}
          style={{ accentColor: 'var(--gold)', marginTop: 2 }}
          className="no-drag"
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: V.sand100, fontWeight: 500 }}>
            Deep Scan
            <span style={{
              fontSize: 10,
              color: V.sand400,
              fontWeight: 400,
              marginLeft: 8,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
            }}>
              per-stem analysis
            </span>
          </div>
          <div style={{ fontSize: 12, color: V.sand400, marginTop: 4, lineHeight: 1.45 }}>
            Runs BS-RoFormer 4-stem separation (SDR 9.66 on MUSDB18HQ) and builds
            per-stem profiles — vocals · drums · bass · other — on top of the
            whole-mix fingerprint. Adds 30 s – 2 min per track on Apple Silicon.
            First run downloads the 503 MB checkpoint if it is not already on disk
            from a sibling RTMcompare install.
          </div>
        </div>
      </label>

      {/* ── Build button ──────────────────────────────────────────── */}
      {/* Transparent bg, gold border (outlined primary recipe).
          Gold text on active, sand-400 on disabled. Never gold-filled. */}
      <button
        onClick={onBuild}
        disabled={!canBuild}
        style={canBuild ? btnPrimary : btnDisabled}
        className="no-drag"
        aria-label="Build engineer profile from selected tracks"
      >
        <BuildStatusLine busy={busy} deepScan={deepScan} />
      </button>

      {/* ── Result panel ──────────────────────────────────────────── */}
      {result && (
        <div
          role="status"
          style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 'var(--radius)',
            backgroundColor: result.ok ? 'rgba(110,197,119,0.06)' : 'rgba(201,103,101,0.06)',
            border: `1px solid ${result.ok ? 'rgba(110,197,119,0.30)' : 'rgba(201,103,101,0.35)'}`,
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {result.ok ? (
            <>
              <div style={{ color: V.success, fontWeight: 500, marginBottom: 6 }}>
                Profile written.
              </div>
              <div style={{ color: V.sand100 }}>
                {result.sample_count} track{result.sample_count === 1 ? '' : 's'} analyzed
                {result.skipped
                  ? <span style={{ color: V.sand400 }}> · {result.skipped} skipped</span>
                  : null}
              </div>
              <div
                className="mono"
                style={{ color: V.sand400, fontSize: 11, marginTop: 4 }}
              >
                {result.path}
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <button onClick={onReveal} style={btnSecondary} className="no-drag">
                  Reveal in Finder
                </button>
              </div>
              <div style={{ marginTop: 10, color: V.sand400, fontSize: 12 }}>
                RTMcompare → Match tab → profile dropdown → select this file.
              </div>
            </>
          ) : (
            <>
              <div style={{ color: V.danger, fontWeight: 500, marginBottom: 6 }}>
                Build failed.
              </div>
              <div style={{ color: V.sand100, fontSize: 13, lineHeight: 1.45 }}>
                {result.error}
              </div>
              {result.python_resolution && (
                <div style={{ color: V.sand400, fontSize: 11, marginTop: 8 }}>
                  Detail: {result.python_resolution}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Colophon ──────────────────────────────────────────────── */}
      {/* flex space-between, tracked all-caps, sand-500.
          Mirrors RTMcompare's <Colophon /> vocabulary exactly. */}
      <footer
        aria-hidden
        style={{
          marginTop: 28,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.58rem',
          color: V.sand500,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          fontWeight: 500,
        }}
      >
        <span>RTMprofile</span>
        <span>© 2026 RTM Audio. All rights reserved.</span>
      </footer>
    </div>
  )
}

// ── Field ──────────────────────────────────────────────────────────────
// Memoised input row — keystroking one field doesn't re-render siblings.
const Field = memo(function Field({ label, value, onChange, placeholder }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{
        fontSize: 10,
        color: 'var(--color-sand-400)',
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        marginBottom: 6,
      }}>
        {label}
      </div>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="no-drag"
        style={{
          width: '100%',
          padding: '10px 12px',
          fontSize: 13,
          color: 'var(--cream)',
          backgroundColor: 'var(--color-sand-900)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          fontFamily: 'inherit',
        }}
      />
    </label>
  )
})

// ── Button style objects ───────────────────────────────────────────────
// All use CSS variables. No gold fills — gold is border/text only.
// Primary: gold border + gold text, transparent bg. Hover handled via
// CSS in index.css (not needed here; the outlined recipe is clear enough
// without a hover fill at the small size of this app window).

const btnPrimary: React.CSSProperties = {
  width: '100%',
  padding: '12px 24px',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--gold)',
  backgroundColor: 'transparent',
  border: '1px solid var(--gold)',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  transition: 'background-color 120ms, color 120ms',
  fontFamily: 'var(--font-sans)',
}

const btnDisabled: React.CSSProperties = {
  ...btnPrimary,
  color: 'var(--color-sand-400)',
  borderColor: 'var(--border)',
  cursor: 'not-allowed',
}

const btnSecondary: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 11,
  color: 'var(--color-sand-300)',
  backgroundColor: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
  letterSpacing: '0.06em',
  fontFamily: 'var(--font-sans)',
}

const btnGhost: React.CSSProperties = {
  padding: '2px 8px',
  fontSize: 13,
  color: 'var(--color-sand-400)',
  backgroundColor: 'transparent',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
}
