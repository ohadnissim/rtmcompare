import React, { useCallback, useEffect, useMemo, useState, memo } from 'react'

// 5.2.2 design pass (audit P0–P2):
//   - Body type bumped to 14 px / 1.55 line-height in index.html (sub-WCAG before)
//   - Focus indicators added globally via :focus-visible in index.html
//   - Gold appears ONCE per composition (the wordmark + the CTA outline,
//     reduced from 5+ uses)
//   - Buttons restyled to mirror the parent's `.btn-primary` recipe:
//     square corners, transparent fill, 1 px gold border, hover-fills
//   - Instrument Serif loaded via index.html and used for the wordmark
//     (was generic system sans before — the named "Console-Didone"
//     never actually appeared in this app)
//   - Progress event extracted to a memoised <BuildStatusLine /> child
//     so the rest of the App tree doesn't re-render on every IPC tick
//   - <FileRow /> memoised so the file list doesn't reconcile on every
//     state change (added/removed file or progress tick)
//   - Drop zone has aria-label, drag highlight, real <button> for Browse
//   - Plain-English onboarding line above the technical description

const GOLD = '#d0b066'
const SAND_400 = '#8d867b'   // muted text — passes AA on dark
const SAND_300 = '#b5afa4'   // tertiary text
const SAND_100 = '#ebe7e0'   // primary
const SAND_800 = '#1e1c18'   // panel bg
const SAND_900 = '#151411'   // input bg
const BORDER = 'rgba(168,161,150,0.18)'
const SUCCESS = '#6ec577'
const DANGER = '#c96765'

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
 *  unmounted-by-renders during a long Python build (audit P0 fix). */
const BuildStatusLine = memo(function BuildStatusLine({
  busy, deepScan,
}: { busy: boolean; deepScan: boolean }) {
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  useEffect(() => window.rtmprofileAPI.onProgress(setProgress), [])
  if (!busy) return <>{deepScan ? 'Build profile (Deep Scan)' : 'Build profile'}</>
  if (!progress) return <>Starting…</>
  return (
    <>
      {deepScan ? 'Deep-scanning' : 'Analyzing'} {progress.i} / {progress.total}…
    </>
  )
})

/** Memoised file row — stable reference + per-row local state so the
 *  whole list doesn't reconcile on every parent re-render. */
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
      fontFamily: 'JetBrains Mono, ui-monospace, Menlo, monospace',
      color: SAND_100,
      borderBottom: '1px solid rgba(168,161,150,0.05)',
    }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, paddingRight: 8 }}>
        {path.split(/[/\\]/).pop()}
      </span>
      <button
        onClick={() => onRemove(path)}
        disabled={busy}
        style={{ ...btnGhost, fontSize: 14 }}
        aria-label={`Remove ${path.split(/[/\\]/).pop()}`}
        title="Remove"
      >×</button>
    </div>
  )
})

export default function App() {
  const [files, setFiles] = useState<string[]>([])
  const [name, setName] = useState('')
  const [role, setRole] = useState('Mastering Engineer')
  // 5.2.3: genre tag removed from the profile schema. The user-typed
  // value didn't drive any downstream behaviour and the auto-detected
  // counterpart was unreliable.
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

  // Drag-and-drop with visible affordances. Drop zone now has a real
  // `dragenter/dragleave` highlight, an ARIA label, and a real <button>
  // for Browse — all audit P1 fixes.
  useEffect(() => {
    let depth = 0
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault()
      depth++
      if (depth === 1) setDragHover(true)
    }
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault()
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragHover(false)
    }
    const onDragOver = (e: DragEvent) => { e.preventDefault() }
    const onDrop = (e: DragEvent) => { e.preventDefault(); depth = 0; setDragHover(false) }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    const unsub = window.rtmprofileAPI?.onFilesDropped?.((paths) => {
      const dropped = (paths || []).filter(Boolean)
      if (dropped.length > 0) {
        setFiles(prev => Array.from(new Set([...prev, ...dropped])))
      }
    })
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      if (typeof unsub === 'function') unsub()
    }
  }, [])

  const canBuild = files.length > 0 && name.trim().length > 0 && !busy

  // Drop-zone visual style derived from drag state. Memoised because
  // the style object identity matters for the inner components.
  const dropZoneStyle: React.CSSProperties = useMemo(() => ({
    border: `1.5px ${dragHover ? 'solid' : 'dashed'} ${dragHover ? GOLD : BORDER}`,
    borderRadius: 2,
    padding: 24,
    backgroundColor: dragHover ? 'rgba(208,176,102,0.06)' : SAND_800,
    marginBottom: 16,
    minHeight: 160,
    transition: 'border-color 120ms, background-color 120ms',
  }), [dragHover])

  return (
    <div style={{ minHeight: '100vh', padding: '32px 28px 28px', boxSizing: 'border-box', overflowY: 'auto' }}>
      {/* macOS frameless drag strip (Electron 'hiddenInset' provides no draggable chrome) */}
      <div
        style={{
          // @ts-expect-error vendor CSS prop
          WebkitAppRegion: 'drag',
          position: 'fixed', top: 0, left: 0, right: 0, height: 36, zIndex: 1000, pointerEvents: 'auto',
        }}
        aria-hidden
      />

      <header style={{
        marginBottom: 28, marginTop: 12,
        // @ts-expect-error vendor CSS prop
        WebkitAppRegion: 'drag',
      }}>
        {/* The single Instrument-Serif moment — the wordmark dominates,
            everything else stays in the warm-grey palette. Gold here is
            the ONE gesture per the Console-Didone philosophy. */}
        {/* 5.2.4: wordmark moved from gold → cream to honour the
            "gold appears once per screen" rule — gold is reserved
            for the Build profile CTA outline below. Italic dropped
            so the wordmark matches RTMcompare's HeaderV2 wordmark. */}
        <div className="display-serif" style={{ fontSize: 48, color: SAND_100, lineHeight: 1, marginBottom: 12, letterSpacing: '0.02em' }}>
          RTMprofile
        </div>
        {/* 5.3: italic kicker pattern — same vocabulary as RTMcompare's
            EmptyStateV2 cover. The single gold word is the chromatic
            gesture; everything else in cream-secondary. */}
        <div className="display-serif italic" style={{ fontSize: 22, color: SAND_300, lineHeight: 1.2, marginBottom: 6 }}>
          Teach RTM your <span style={{ color: GOLD }}>ear</span>.
        </div>
        <div style={{ fontSize: 10, color: SAND_400, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 14 }}>
          Companion to RTMcompare
        </div>
        {/* Plain-English onboarding line — the previous copy went
            straight into "corpus / spectral signature" jargon before
            the user had any context (audit P1). */}
        <p style={{ fontSize: 14, color: SAND_300, lineHeight: 1.5, marginTop: 0, marginBottom: 8, maxWidth: 620 }}>
          Feed RTMprofile 5+ of your finished masters. It learns your sound and saves a fingerprint
          that RTMcompare uses to grade new mixes against your style.
        </p>
        <p style={{ fontSize: 12, color: SAND_400, lineHeight: 1.5, marginTop: 0, maxWidth: 620 }}>
          Output is a <span style={{ color: SAND_100 }} className="mono">.json</span> profile that loads into RTMcompare's Match tab.
        </p>
      </header>

      {/* Form — 5.2.3: Genres field removed (no downstream effect). */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <Field label="Engineer name *" value={name} onChange={setName} placeholder="e.g. Ohad Nissim" />
        <Field label="Role" value={role} onChange={setRole} placeholder="Mastering Engineer" />
      </div>

      {/* Drop zone — real ARIA + visible drag affordance */}
      <div
        style={dropZoneStyle}
        role="region"
        aria-label="Audio file drop zone — drop tracks here or click Browse"
      >
        {files.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px 0', color: SAND_400, fontSize: 14 }}>
            <div style={{ fontSize: 32, color: SAND_300, marginBottom: 8 }} aria-hidden>+</div>
            <div>Drop audio files here, or</div>
            <button
              onClick={onPick}
              disabled={busy}
              style={btnSecondary}
              aria-label="Browse audio files"
            >Browse files</button>
            <div style={{ marginTop: 12, fontSize: 11, color: SAND_400 }} className="mono">
              .wav · .aiff · .flac · .mp3 · .m4a — 5+ tracks recommended for a stable curve
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: SAND_400, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                {files.length} file{files.length === 1 ? '' : 's'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={onPick} disabled={busy} style={btnSecondary}>+ add more</button>
                <button onClick={onClear} disabled={busy} style={btnSecondary}>clear</button>
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

      {/* Deep Scan toggle */}
      <label style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px 14px',
        marginBottom: 12,
        borderRadius: 2,
        border: `1px solid ${deepScan ? 'rgba(208,176,102,0.45)' : BORDER}`,
        backgroundColor: deepScan ? 'rgba(208,176,102,0.06)' : 'rgba(31,27,23,0.5)',
        cursor: busy ? 'not-allowed' : 'pointer',
        transition: 'border-color 120ms, background-color 120ms',
      }}>
        <input
          type="checkbox"
          checked={deepScan}
          onChange={e => setDeepScan(e.target.checked)}
          disabled={busy}
          style={{ accentColor: GOLD, marginTop: 2 }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: SAND_100, fontWeight: 500 }}>
            Deep Scan
            <span style={{ fontSize: 10, color: SAND_400, fontWeight: 400, marginLeft: 8, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
              per-stem analysis
            </span>
          </div>
          <div style={{ fontSize: 12, color: SAND_400, marginTop: 4, lineHeight: 1.45 }}>
            Run each track through Demucs separation and build per-stem profiles
            (vocals · drums · bass · other) on top of the whole-mix one. Adds
            ~30 seconds to two minutes per track on Apple Silicon.
          </div>
        </div>
      </label>

      {/* Build button — outlined gold, square corners (parent .btn-primary recipe) */}
      <button
        onClick={onBuild}
        disabled={!canBuild}
        style={canBuild ? btnPrimary : btnDisabled}
        aria-label="Build engineer profile from selected tracks"
      >
        <BuildStatusLine busy={busy} deepScan={deepScan} />
      </button>

      {/* Result panel */}
      {result && (
        <div
          role="status"
          style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 2,
            backgroundColor: result.ok ? 'rgba(110,197,119,0.06)' : 'rgba(201,103,101,0.06)',
            border: `1px solid ${result.ok ? 'rgba(110,197,119,0.30)' : 'rgba(201,103,101,0.35)'}`,
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {result.ok ? (
            <>
              <div style={{ color: SUCCESS, fontWeight: 500, marginBottom: 6 }}>Profile saved</div>
              <div style={{ color: SAND_100 }}>
                {result.sample_count} track{result.sample_count === 1 ? '' : 's'} analyzed
                {result.skipped ? <span style={{ color: SAND_400 }}> · {result.skipped} skipped</span> : null}
              </div>
              <div style={{ color: SAND_400, fontSize: 11, marginTop: 4 }} className="mono">
                {result.path}
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <button onClick={onReveal} style={btnSecondary}>Reveal in Finder</button>
              </div>
              <div style={{ marginTop: 10, color: SAND_400, fontSize: 12 }}>
                Open RTMcompare → pick this profile from the Match-tab profile dropdown.
              </div>
            </>
          ) : (
            <>
              <div style={{ color: DANGER, fontWeight: 500, marginBottom: 6 }}>Build didn't complete</div>
              <div style={{ color: SAND_100, fontSize: 13, lineHeight: 1.45 }}>{result.error}</div>
              {result.python_resolution && (
                <div style={{ color: SAND_400, fontSize: 11, marginTop: 8 }}>
                  Detail: {result.python_resolution}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 5.2.4: footer rebuilt as a colophon — same vocabulary as
          RTMcompare's <Colophon />. Three centre-dots between
          segments; tracked all-caps in sand-dim. Decorative only —
          aria-hidden so screen readers skip it. */}
      <footer
        aria-hidden
        style={{
          marginTop: 24,
          textAlign: 'center',
          fontSize: 9,
          color: '#6a6459',
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          fontWeight: 500,
        }}
      >
        RTMprofile · v1.1.3 · Companion to RTMcompare
      </footer>
    </div>
  )
}

// Memoised input row so keystroking doesn't re-render siblings (audit P2).
const Field = memo(function Field({ label, value, onChange, placeholder }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 10, color: SAND_400, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </div>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '10px 12px',
          fontSize: 13,
          color: SAND_100,
          backgroundColor: SAND_900,
          border: `1px solid ${BORDER}`,
          borderRadius: 2,
          fontFamily: 'inherit',
        }}
      />
    </label>
  )
})

// 5.2.2 (audit P2): button styling now mirrors the parent's .btn-primary
// recipe — square corners (radius 0), transparent fill, 1 px gold border,
// hover-fills. Stops gold from being used as a button SURFACE (which
// dilutes the single-gold-gesture rule); instead gold is the button's
// outline only. The result panel's success/danger colors stay distinct
// because they communicate state, not brand.
const btnPrimary: React.CSSProperties = {
  width: '100%',
  padding: '12px 24px',
  fontSize: 13,
  fontWeight: 500,
  color: GOLD,
  backgroundColor: 'transparent',
  border: `1px solid ${GOLD}`,
  borderRadius: 2,
  cursor: 'pointer',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  transition: 'background-color 120ms, color 120ms',
}
const btnDisabled: React.CSSProperties = {
  ...btnPrimary,
  color: SAND_400,
  borderColor: BORDER,
  cursor: 'not-allowed',
}
const btnSecondary: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 11,
  color: SAND_300,
  backgroundColor: 'transparent',
  border: `1px solid ${BORDER}`,
  borderRadius: 2,
  cursor: 'pointer',
  letterSpacing: '0.06em',
}
const btnGhost: React.CSSProperties = {
  padding: '2px 8px',
  fontSize: 13,
  color: SAND_400,
  backgroundColor: 'transparent',
  border: 'none',
  cursor: 'pointer',
}
