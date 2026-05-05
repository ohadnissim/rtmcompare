import React, { useCallback, useEffect, useState } from 'react'

const GOLD = '#d0b066'
const MUTED = '#8d867b'
const CREAM = '#ebe7e0'
const BG_PANEL = 'rgba(31,27,23,0.6)'
const BORDER = 'rgba(168,161,150,0.18)'

interface ProgressEvent {
  i: number
  total: number
  file: string
}

interface BuildResult {
  ok: boolean
  path?: string
  sample_count?: number
  skipped?: number
  error?: string
  python_resolution?: string
}

export default function App() {
  const [files, setFiles] = useState<string[]>([])
  const [name, setName] = useState('')
  const [role, setRole] = useState('Mastering Engineer')
  const [genres, setGenres] = useState('')
  const [deepScan, setDeepScan] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [result, setResult] = useState<BuildResult | null>(null)

  // Subscribe to per-file progress events from main.
  useEffect(() => {
    return window.rtmprofileAPI.onProgress(setProgress)
  }, [])

  const onPick = useCallback(async () => {
    const picked = await window.rtmprofileAPI.selectFiles()
    if (picked.length > 0) {
      setFiles(prev => Array.from(new Set([...prev, ...picked])))
    }
  }, [])

  const onClear = useCallback(() => {
    setFiles([])
    setProgress(null)
    setResult(null)
  }, [])

  const onRemoveOne = useCallback((path: string) => {
    setFiles(prev => prev.filter(f => f !== path))
  }, [])

  const onBuild = useCallback(async () => {
    if (files.length === 0 || !name.trim()) return
    setBusy(true)
    setResult(null)
    setProgress(null)
    try {
      const r = await window.rtmprofileAPI.buildProfile({
        name: name.trim(),
        role: role.trim() || 'Mastering Engineer',
        genres: genres.trim(),
        deep: deepScan,
        files,
      })
      setResult(r)
    } finally {
      setBusy(false)
    }
  }, [files, name, role, genres, deepScan])

  const onReveal = useCallback(async () => {
    if (result?.path) {
      await window.rtmprofileAPI.showSavedProfile(result.path)
    }
  }, [result])

  // Drag-and-drop, 1.0.4 callback path:
  //
  // The preload script handles the drop event itself (so the File
  // object stays in its native isolate where webUtils.getPathForFile
  // actually works). It then calls THIS callback with the resolved
  // on-disk paths — strings cross the contextBridge fine. We hold the
  // unsubscribe function returned by onFilesDropped so the listener
  // is torn down on unmount.
  //
  // The dragover preventDefault is a belt-and-suspenders — preload
  // already does it, but the renderer-side handler keeps the cursor
  // affordance correct in dev mode where the preload isn't running.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => { e.preventDefault() }
    window.addEventListener('dragover', onDragOver)
    const unsub = window.rtmprofileAPI?.onFilesDropped?.((paths) => {
      const dropped = (paths || []).filter(Boolean)
      if (dropped.length > 0) {
        setFiles(prev => Array.from(new Set([...prev, ...dropped])))
      }
    })
    return () => {
      window.removeEventListener('dragover', onDragOver)
      if (typeof unsub === 'function') unsub()
    }
  }, [])

  const canBuild = files.length > 0 && name.trim().length > 0 && !busy

  return (
    <div style={{
      minHeight: '100vh',
      padding: '32px 28px 28px',
      boxSizing: 'border-box',
      overflowY: 'auto',
    }}>
      {/* macOS frameless-window drag strip — Electron's titleBarStyle
          'hiddenInset' floats the traffic lights but provides no
          dragable chrome by default. Without an explicit
          `-webkit-app-region: drag` zone the user can't move the
          window at all (1.0.4 beta-tester report). Strip is ~36px
          tall, covers the area around the traffic lights, sits on
          top of the rest of the UI but doesn't intercept clicks
          past its height. */}
      <div
        style={{
          // @ts-expect-error — vendor CSS prop typed loosely by React types
          WebkitAppRegion: 'drag',
          position: 'fixed',
          top: 0, left: 0, right: 0,
          height: 36,
          zIndex: 1000,
          pointerEvents: 'auto',
        }}
        aria-hidden
      />
      <header style={{
        marginBottom: 28, marginTop: 12,
        // @ts-expect-error — same vendor CSS prop. The header is all
        // non-interactive type so giving the whole block drag makes
        // the window movable from anywhere up here, not just the
        // 36px strip.
        WebkitAppRegion: 'drag',
      }}>
        <div style={{ fontSize: 22, color: GOLD, fontWeight: 600, letterSpacing: '0.02em' }}>
          RTMprofile
        </div>
        <div style={{ fontSize: 11, color: MUTED, marginTop: 4, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
          Build a custom engineer profile from a corpus
        </div>
        <p style={{ fontSize: 12, color: MUTED, marginTop: 14, lineHeight: 1.5 }}>
          Drop your tracks below and RTMprofile measures the spectral, dynamic, and stereo signature across the catalog. Output is a <span style={{ color: CREAM }}>.json</span> profile that loads into RTMcompare's Match tab — your style, fingerprinted.
        </p>
      </header>

      {/* ── Form ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 12,
        marginBottom: 16,
      }}>
        <Field label="Engineer name *" value={name} onChange={setName} placeholder="e.g. Ohad Nissim" />
        <Field label="Role" value={role} onChange={setRole} placeholder="Mastering Engineer" />
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Genres (comma-separated)" value={genres} onChange={setGenres} placeholder="Hip-Hop, R&B, Electronic" />
        </div>
      </div>

      {/* ── Drop zone / file list ── */}
      <div style={{
        border: `1.5px dashed ${BORDER}`,
        borderRadius: 12,
        padding: 20,
        backgroundColor: BG_PANEL,
        marginBottom: 16,
        minHeight: 160,
      }}>
        {files.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px 0', color: MUTED, fontSize: 12 }}>
            <div style={{ fontSize: 28, color: GOLD, marginBottom: 6 }}>+</div>
            <div>Drop audio files here, or</div>
            <button onClick={onPick} disabled={busy} style={btnSecondary}>
              Browse files
            </button>
            <div style={{ marginTop: 12, fontSize: 10, color: '#5a544a' }}>
              .wav · .aiff · .flac · .mp3 · .m4a — 5+ tracks recommended for a stable curve
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: GOLD, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                {files.length} file{files.length === 1 ? '' : 's'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={onPick} disabled={busy} style={btnSecondary}>+ add more</button>
                <button onClick={onClear} disabled={busy} style={btnSecondary}>clear</button>
              </div>
            </div>
            <div style={{ maxHeight: 220, overflowY: 'auto', paddingRight: 4 }}>
              {files.map(f => (
                <div key={f} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 8px',
                  fontSize: 11,
                  fontFamily: 'ui-monospace, Menlo, monospace',
                  color: CREAM,
                  borderBottom: '1px solid rgba(168,161,150,0.05)',
                }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, paddingRight: 8 }}>
                    {f.split('/').pop()}
                  </span>
                  <button onClick={() => onRemoveOne(f)} disabled={busy} style={{ ...btnGhost, fontSize: 14 }} title="Remove">×</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Deep Scan toggle ──
          Per-stem profile via Demucs. Adds ~30s-2min per track on
          M-series CPU; the resulting JSON gets a `stems` block with
          a curve / LUFS / dynamics / width fingerprint per stem
          (vocals · drums · bass · other). Beta-tester request 1.0.3.
      */}
      <label style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px 14px',
        marginBottom: 12,
        borderRadius: 10,
        border: `1px solid ${deepScan ? GOLD : BORDER}`,
        backgroundColor: deepScan ? 'rgba(208,176,102,0.08)' : 'rgba(31,27,23,0.5)',
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
          <div style={{ fontSize: 12, color: deepScan ? GOLD : CREAM, fontWeight: 600, letterSpacing: '0.02em' }}>
            Deep Scan
            <span style={{ fontSize: 9, color: MUTED, fontWeight: 400, marginLeft: 8, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
              per-stem analysis
            </span>
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 3, lineHeight: 1.4 }}>
            Run each track through Demucs separation and build per-stem profiles
            (vocals · drums · bass · other) on top of the whole-mix one. Adds
            ~30 seconds to two minutes per track on Apple Silicon.
          </div>
        </div>
      </label>

      {/* ── Build button ── */}
      <button onClick={onBuild} disabled={!canBuild} style={canBuild ? btnPrimary : btnDisabled}>
        {busy
          ? (progress
            ? `${deepScan ? 'Deep-scanning' : 'Analyzing'} ${progress.i} / ${progress.total}…`
            : 'Starting…')
          : (deepScan ? 'Build profile (Deep Scan)' : 'Build profile')}
      </button>

      {/* ── Result panel ── */}
      {result && (
        <div style={{
          marginTop: 16,
          padding: 14,
          borderRadius: 10,
          backgroundColor: result.ok ? 'rgba(110,197,119,0.08)' : 'rgba(201,103,101,0.08)',
          border: `1px solid ${result.ok ? 'rgba(110,197,119,0.30)' : 'rgba(201,103,101,0.35)'}`,
          fontSize: 12,
          lineHeight: 1.5,
        }}>
          {result.ok ? (
            <>
              <div style={{ color: '#6ec577', fontWeight: 600, marginBottom: 6 }}>
                ✓ Profile saved
              </div>
              <div style={{ color: CREAM }}>
                {result.sample_count} track{result.sample_count === 1 ? '' : 's'} analyzed
                {result.skipped ? <span style={{ color: MUTED }}> · {result.skipped} skipped</span> : null}
              </div>
              <div style={{ color: MUTED, fontSize: 11, marginTop: 4, fontFamily: 'ui-monospace, Menlo, monospace' }}>
                {result.path}
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <button onClick={onReveal} style={btnSecondary}>Reveal in Finder</button>
              </div>
              <div style={{ marginTop: 10, color: '#7a7164', fontSize: 11 }}>
                Open RTMcompare → pick this profile from the Match-tab profile dropdown.
              </div>
            </>
          ) : (
            <>
              <div style={{ color: GOLD, fontWeight: 600, marginBottom: 6 }}>
                Build didn't complete
              </div>
              <div style={{ color: CREAM, fontSize: 12, lineHeight: 1.45 }}>
                {result.error}
              </div>
              {/* Python-resolution is muted detail. Useful when debugging
                  but never displayed scarier than the friendly message. */}
              {result.python_resolution && (
                <div style={{ color: MUTED, fontSize: 10, marginTop: 8 }}>
                  Detail: {result.python_resolution}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <footer style={{
        marginTop: 24,
        textAlign: 'center',
        fontSize: 10,
        color: '#5a544a',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
      }}>
        RTMprofile · companion to RTMcompare · v1.0
      </footer>
    </div>
  )
}


function Field({ label, value, onChange, placeholder }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 9, color: MUTED, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 4 }}>
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
          padding: '8px 10px',
          fontSize: 12,
          color: CREAM,
          backgroundColor: 'rgba(14,13,11,0.6)',
          border: `1px solid ${BORDER}`,
          borderRadius: 6,
          outline: 'none',
          fontFamily: 'inherit',
        }}
      />
    </label>
  )
}


const btnPrimary: React.CSSProperties = {
  width: '100%',
  padding: '12px 20px',
  fontSize: 13,
  fontWeight: 600,
  color: '#0e0d0b',
  backgroundColor: GOLD,
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  letterSpacing: '0.04em',
}
const btnDisabled: React.CSSProperties = {
  ...btnPrimary,
  backgroundColor: 'rgba(208,176,102,0.18)',
  color: '#5a544a',
  cursor: 'not-allowed',
}
const btnSecondary: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 11,
  color: GOLD,
  backgroundColor: 'rgba(208,176,102,0.10)',
  border: `1px solid rgba(208,176,102,0.28)`,
  borderRadius: 16,
  cursor: 'pointer',
}
const btnGhost: React.CSSProperties = {
  padding: '2px 8px',
  fontSize: 12,
  color: MUTED,
  backgroundColor: 'transparent',
  border: 'none',
  cursor: 'pointer',
}
