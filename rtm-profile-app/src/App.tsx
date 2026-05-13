import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import ProfileRadar from './ProfileRadar'

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

/** Shared default — keep in sync with main.ts DEFAULT_ROLE */
const DEFAULT_ROLE = 'Mastering Engineer'

interface ProgressEvent { i: number; total: number; file: string }
interface BuildResult {
  ok: boolean
  path?: string
  sample_count?: number
  skipped?: number
  partialCount?: number
  error?: string
  python_resolution?: string
  curve?: number[]
  curveMad?: number[]
}

/** Memoised status line — owns the progress subscription + its own
 *  re-renders on every IPC tick. The rest of the App tree stays
 *  unmounted-by-renders during a long Python build. */
const BuildStatusLine = memo(function BuildStatusLine({
  busy, deepScan, onProgressUpdate,
}: { busy: boolean; deepScan: boolean; onProgressUpdate?: (p: ProgressEvent | null) => void }) {
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  useEffect(() => window.rtmprofileAPI.onProgress((p) => {
    setProgress(p)
    onProgressUpdate?.(p)
  }), [onProgressUpdate])
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

// Role → CSS variable colour mapping (mirrors index.html :root tokens)
const ROLE_COLORS: Record<string, string> = {
  'Mastering Engineer': 'var(--role-mastering)',
  'Mixing Engineer':    'var(--role-mixing)',
  'Tracking Engineer':  'var(--role-tracking)',
}
const DEFAULT_ROLE_COLOR = 'var(--role-default)'

export default function App() {
  const [files, setFiles] = useState<string[]>([])
  const [name, setName] = useState('')
  const [role, setRole] = useState(DEFAULT_ROLE)
  const [deepScan, setDeepScan] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BuildResult | null>(null)
  const [dragHover, setDragHover] = useState(false)
  const [nameTouched, setNameTouched] = useState(false)
  const [clearPending, setClearPending] = useState(false)
  // Change 2: per-file progress tracking
  const [currentFile, setCurrentFile] = useState<ProgressEvent | null>(null)
  // Change 3: Compare a Mix CTA state
  const [showCompareHint, setShowCompareHint] = useState(false)
  // Item 4: chain reference file for approximate chain analysis
  const [chainRefFile, setChainRefFile] = useState<string>('')
  const resultRef = useRef<HTMLDivElement>(null)

  // Stable callback for BuildStatusLine to push progress updates up
  const handleProgressUpdate = useCallback((p: ProgressEvent | null) => {
    setCurrentFile(p)
  }, [])

  const onPick = useCallback(async () => {
    const picked = await window.rtmprofileAPI.selectFiles()
    if (picked.length > 0) {
      setFiles(prev => Array.from(new Set([...prev, ...picked])))
    }
  }, [])

  const onClear = useCallback(() => {
    setClearPending(true)
  }, [])

  const onClearConfirm = useCallback(() => {
    setFiles([])
    setResult(null)
    setNameTouched(false)
    setClearPending(false)
  }, [])

  const onClearCancel = useCallback(() => {
    setClearPending(false)
  }, [])

  const onRemoveOne = useCallback((path: string) => {
    setFiles(prev => prev.filter(f => f !== path))
  }, [])

  const onBuild = useCallback(async () => {
    setNameTouched(true)
    if (files.length === 0 || !name.trim()) return
    setBusy(true)
    setResult(null)
    setCurrentFile(null)
    setShowCompareHint(false)
    try {
      const r = await window.rtmprofileAPI.buildProfile({
        name: name.trim(),
        role: role.trim() || DEFAULT_ROLE,
        deep: deepScan,
        files,
        ...(chainRefFile.trim() ? { chainReference: chainRefFile.trim() } : {}),
      })
      setResult(r)
      // Move focus to result panel for screen readers / keyboard users
      setTimeout(() => resultRef.current?.focus(), 50)
    } finally {
      setBusy(false)
    }
  // CRIT-4 fix: chainRefFile was missing from the dep array. Without it,
  // setting a chain reference file then immediately clicking Build would use
  // a stale closure (chainRefFile = '') and silently skip chain analysis.
  }, [files, name, role, deepScan, chainRefFile])

  const onCancel = useCallback(async () => {
    await window.rtmprofileAPI.cancelBuild()
  }, [])

  const onReveal = useCallback(async () => {
    if (result?.path) await window.rtmprofileAPI.showSavedProfile(result.path)
  }, [result])

  const onBuildAnother = useCallback(() => {
    setFiles([])
    setResult(null)
    setNameTouched(false)
    setCurrentFile(null)
    setShowCompareHint(false)
  }, [])

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
    // Change 5: folder drag-and-drop — the preload already gives us
    // absolute on-disk paths. For folders, we ask main to scan them.
    const unsub = window.rtmprofileAPI?.onFilesDropped?.(async (paths) => {
      const dropped = (paths || []).filter(Boolean)
      if (dropped.length === 0) return
      const audioExts = ['.wav', '.aif', '.aiff', '.flac', '.mp3', '.m4a', '.ogg']
      const allFiles: string[] = []
      for (const p of dropped) {
        // If it looks like an audio file, add directly
        const lower = p.toLowerCase()
        if (audioExts.some(ext => lower.endsWith(ext))) {
          allFiles.push(p)
        } else {
          // Assume it might be a folder — ask main to scan it
          try {
            const folderFiles = await window.rtmprofileAPI.scanFolder?.(p)
            if (folderFiles && folderFiles.length > 0) allFiles.push(...folderFiles)
          } catch { /* ignore */ }
        }
      }
      if (allFiles.length > 0) {
        setFiles(prev => Array.from(new Set([...prev, ...allFiles])))
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

  const nameError = nameTouched && !name.trim() ? 'Engineer name is required.' : null
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
      height: '100%',
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 8 }}>
        <Field
          label="Engineer name *"
          value={name}
          onChange={setName}
          onBlur={() => setNameTouched(true)}
          placeholder="e.g. Your Name"
          error={nameError ?? undefined}
        />
        <Field label="Role" value={role} onChange={setRole} placeholder={DEFAULT_ROLE} />
      </div>
      {/* Change 4: role colour badge */}
      {role.trim() && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <span style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: ROLE_COLORS[role.trim()] ?? DEFAULT_ROLE_COLOR,
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 10,
            color: ROLE_COLORS[role.trim()] ?? DEFAULT_ROLE_COLOR,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            fontWeight: 500,
          }}>
            {role.trim()}
          </span>
        </div>
      )}

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
            {/* Change 5: folder drop hint */}
            <div style={{ marginTop: 8, fontSize: 11, color: V.sand500, fontStyle: 'italic' }}>
              Tip: drop an entire folder of masters for the best results (15+ tracks recommended)
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: V.sand400, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                {files.length} file{files.length === 1 ? '' : 's'} staged
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} className="no-drag">
                <button onClick={onPick} disabled={busy} style={btnSecondary} className="no-drag">
                  + add more
                </button>
                {clearPending ? (
                  <>
                    <span style={{ fontSize: 11, color: V.sand400 }}>Clear all?</span>
                    <button onClick={onClearConfirm} disabled={busy} style={{ ...btnSecondary, color: 'var(--danger)', borderColor: 'rgba(201,103,101,0.45)' }} className="no-drag">
                      Yes, clear
                    </button>
                    <button onClick={onClearCancel} disabled={busy} style={btnSecondary} className="no-drag">
                      Cancel
                    </button>
                  </>
                ) : (
                  <button onClick={onClear} disabled={busy} style={btnSecondary} className="no-drag">
                    clear
                  </button>
                )}
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

      {/* ── Chain reference (optional) — only shown when files are staged ── */}
      {files.length > 0 && (
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 10, color: V.sand500, letterSpacing: '0.14em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
            Reference Mix for Chain Analysis
            <span style={{ marginLeft: 6, fontStyle: 'italic', textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
          </div>
          <button
            disabled={busy}
            style={{ ...btnSecondary, fontSize: 10, padding: '4px 10px', flexShrink: 0 }}
            className="no-drag"
            onClick={async () => {
              const picked = await window.rtmprofileAPI.selectFiles()
              if (picked.length > 0) setChainRefFile(picked[0])
            }}
          >
            {chainRefFile ? 'Change' : 'Pick file…'}
          </button>
          {chainRefFile && (
            <>
              <span className="mono" style={{ fontSize: 10, color: V.sand400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {chainRefFile.split(/[/\\]/).pop()}
              </span>
              <button
                disabled={busy}
                style={btnGhost}
                className="no-drag"
                aria-label="Remove chain reference file"
                onClick={() => setChainRefFile('')}
              >×</button>
            </>
          )}
        </div>
      )}

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
            Separates each track into vocals, drums, bass, and other elements,
            then builds an individual fingerprint for each stem in addition to
            the full-mix fingerprint. Takes 30 seconds to 2 minutes per track
            (Apple Silicon). On first use, downloads a ~190 MB model — only once.
          </div>
        </div>
      </label>

      {/* ── Build / Cancel buttons ────────────────────────────────── */}
      <button
        onClick={onBuild}
        disabled={!canBuild}
        style={canBuild ? btnPrimary : btnDisabled}
        className="no-drag"
        aria-label="Build engineer profile from selected tracks"
      >
        <BuildStatusLine busy={busy} deepScan={deepScan} onProgressUpdate={handleProgressUpdate} />
      </button>

      {/* Change 6: animated audio-bars during build */}
      {busy && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
          <div className="audio-bars">
            <div className="bar" />
            <div className="bar" />
            <div className="bar" />
            <div className="bar" />
            <div className="bar" />
          </div>
          {/* Change 2: per-file progress line */}
          {currentFile && (
            <div style={{ fontSize: 11, color: V.sand400, flex: 1 }}>
              Currently processing:{' '}
              <span className="mono" style={{ color: V.sand100 }}>
                {currentFile.file.split(/[/\\]/).pop()}
              </span>
              {' '}({currentFile.i} of {currentFile.total})
            </div>
          )}
        </div>
      )}

      {busy && (
        <button
          onClick={onCancel}
          style={{ ...btnSecondary, width: '100%', marginTop: 8, textAlign: 'center' }}
          className="no-drag"
          aria-label="Cancel the current build"
        >
          Cancel build
        </button>
      )}

      {/* ── Result panel ──────────────────────────────────────────── */}
      {result && (
        <div
          ref={resultRef}
          role="status"
          tabIndex={-1}
          style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 'var(--radius)',
            backgroundColor: result.ok ? 'rgba(110,197,119,0.06)' : 'rgba(201,103,101,0.06)',
            border: `1px solid ${result.ok ? 'rgba(110,197,119,0.30)' : 'rgba(201,103,101,0.35)'}`,
            fontSize: 13,
            lineHeight: 1.5,
            outline: 'none',
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
                style={{ color: V.sand400, fontSize: 11, marginTop: 4, userSelect: 'text' }}
              >
                {result.path}
              </div>
              {result.ok && result.curve && result.curve.length >= 31 && (
                <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
                  <ProfileRadar
                    curve={result.curve}
                    curveMad={result.curveMad}
                    role={role}
                    sampleCount={result.sample_count ?? 0}
                    width={340}
                    height={340}
                  />
                </div>
              )}
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button onClick={onReveal} style={btnSecondary} className="no-drag">
                  Reveal in Finder
                </button>
                <button onClick={onBuildAnother} style={btnSecondary} className="no-drag">
                  Build another
                </button>
                {/* Change 3: Compare a Mix CTA */}
                <button
                  onClick={async () => {
                    const profileUrl = `rtmcompare://profile?path=${encodeURIComponent(result.path ?? '')}`
                    try {
                      await window.rtmprofileAPI.openExternal?.(profileUrl)
                    } catch {
                      setShowCompareHint(true)
                    }
                  }}
                  style={{ ...btnSecondary, borderColor: 'rgba(123,79,255,0.5)', color: 'var(--role-mastering)' }}
                  className="no-drag"
                >
                  Compare a Mix →
                </button>
              </div>
              {/* Change 3: compare hint if RTMcompare not installed */}
              {showCompareHint && (
                <div style={{ marginTop: 8, fontSize: 12, color: V.sand400, fontStyle: 'italic' }}>
                  RTMcompare isn't installed. Download it at{' '}
                  <span className="mono" style={{ color: V.sand300 }}>rtmcompare.com</span>
                </div>
              )}
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
                {/* MED-18: fallback body so users aren't left with empty error box */}
                {result.error || 'An unexpected error occurred. Check that Python is installed and the input files are valid audio.'}
              </div>
              {result.partialCount != null && result.partialCount > 0 && (
                <div style={{ color: V.sand400, fontSize: 12, marginTop: 6 }}>
                  {result.partialCount} track{result.partialCount === 1 ? '' : 's'} were analyzed before the build stopped.
                </div>
              )}
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
const Field = memo(function Field({ label, value, onChange, onBlur, placeholder, error }: {
  label: string
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  placeholder?: string
  error?: string
}) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{
        fontSize: 10,
        color: error ? 'var(--danger)' : 'var(--color-sand-400)',
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
        onBlur={onBlur}
        placeholder={placeholder}
        className="no-drag"
        aria-invalid={!!error}
        aria-describedby={error ? `${label.replace(/\s+/g, '-').toLowerCase()}-error` : undefined}
        style={{
          width: '100%',
          padding: '10px 12px',
          fontSize: 13,
          color: 'var(--cream)',
          backgroundColor: 'var(--color-sand-900)',
          border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
          borderRadius: 'var(--radius)',
          fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />
      {error && (
        <div
          id={`${label.replace(/\s+/g, '-').toLowerCase()}-error`}
          role="alert"
          style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}
        >
          {error}
        </div>
      )}
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
