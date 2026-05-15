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

interface ProgressEvent { i: number; total: number; file: string; stage?: string }
interface BuildResult {
  ok: boolean
  path?: string
  sample_count?: number
  skipped?: number
  partialCount?: number
  error?: string
  errorDetail?: string
  python_resolution?: string
  curve?: number[]
  curveMad?: number[]
  chainPairCount?: number
  chain_path?: string
  chain_pair_count?: number
}

/** Memoised status line — owns the progress subscription + its own
 *  re-renders on every IPC tick. The rest of the App tree stays
 *  unmounted-by-renders during a long Python build. */
const BuildStatusLine = memo(function BuildStatusLine({
  busy, onProgressUpdate,
}: { busy: boolean; onProgressUpdate?: (p: ProgressEvent | null) => void }) {
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  useEffect(() => window.rtmprofileAPI.onProgress((p) => {
    setProgress(p)
    onProgressUpdate?.(p)
  }), [onProgressUpdate])
  if (!busy) return <>BUILD PROFILE</>
  if (!progress) return <>STARTING…</>
  const label = 'ANALYZING'
  return (
    <>
      {label} {progress.i} / {progress.total}
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
  const [role, setRole] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BuildResult | null>(null)
  const [dragHover, setDragHover] = useState(false)
  const [nameTouched, setNameTouched] = useState(false)
  const [clearPending, setClearPending] = useState(false)
  // Change 2: per-file progress tracking
  const [currentFile, setCurrentFile] = useState<ProgressEvent | null>(null)
  // Change 3: Compare a Mix CTA state
  const [showCompareHint, setShowCompareHint] = useState(false)
  // Chain analysis — multi-pair: each mix gets matched to a master by title
  const [chainMixFiles, setChainMixFiles] = useState<string[]>([])
  const [chainDragHover, setChainDragHover] = useState(false)
  const chainDropRef = useRef<HTMLDivElement>(null)
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
        role: role.trim(),
        files,
        ...(chainMixFiles.length > 0 ? { chainMixes: chainMixFiles } : {}),
      })
      setResult(r)
      // Move focus to result panel for screen readers / keyboard users
      setTimeout(() => resultRef.current?.focus(), 50)
    } finally {
      setBusy(false)
    }
  }, [files, name, role, chainMixFiles])

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
    // Preload resolves file paths via webUtils and calls this callback with
    // { paths, zone } — zone matches the data-dropzone attribute on the drop target.
    const audioExts = ['.wav', '.aif', '.aiff', '.flac', '.mp3', '.m4a', '.ogg']
    const resolveAudioPaths = async (rawPaths: string[]): Promise<string[]> => {
      const out: string[] = []
      for (const p of rawPaths.filter(Boolean)) {
        const lower = p.toLowerCase()
        if (audioExts.some(ext => lower.endsWith(ext))) {
          out.push(p)
        } else {
          try {
            const ff = await window.rtmprofileAPI.scanFolder?.(p)
            if (ff?.length) out.push(...ff)
          } catch { /* ignore */ }
        }
      }
      return out
    }

    const unsub = window.rtmprofileAPI?.onFilesDropped?.(async ({ paths, zone }) => {
      const allFiles = await resolveAudioPaths(paths)
      if (allFiles.length === 0) return
      if (zone === 'chain-mixes') {
        setChainMixFiles(prev => Array.from(new Set([...prev, ...allFiles])))
      } else {
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

  const nameError = nameTouched && !name.trim() ? 'Profile name is required.' : null
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
        style={{ marginBottom: 20, marginTop: 12 }}
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
          Feed RTMprofile 5+ of your best tracks — masters, mixes, or references.
          It reads your spectral signature and writes a fingerprint file that
          RTMcompare uses to grade new work against your standard.
        </p>
        <p style={{ fontSize: 12, color: V.sand400, lineHeight: 1.5, marginTop: 0, maxWidth: 620 }}>
          Output: a <span className="mono" style={{ color: V.sand100 }}>.json</span> profile.
          Load it from RTMcompare's Match tab → profile dropdown.
        </p>
      </header>

      {/* ── Identity fields ───────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 8 }}>
        <Field
          label="Profile name *"
          value={name}
          onChange={setName}
          onBlur={() => setNameTouched(true)}
          placeholder="e.g. My Profile"
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
        data-dropzone="masters"
      >
        {files.length === 0 ? (
          <div style={{ paddingTop: 4 }}>
            <div
              className="display-serif-italic"
              style={{ fontSize: 26, color: V.sand100, lineHeight: 1.15, marginBottom: 10 }}
            >
              Drop your files here.
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
              Tip: drop an entire folder of tracks for the best results (15+ recommended)
            </div>
          </div>
        ) : (
          <div className="no-drag">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: V.sand400 }}>
                <span style={{ fontVariantNumeric: 'tabular-nums', color: V.sand100 }}>{files.length}</span>
                {' '}track{files.length === 1 ? '' : 's'} ready
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={onPick} disabled={busy} style={btnSecondary} className="no-drag">+ add more</button>
                {clearPending ? (
                  <>
                    <span style={{ fontSize: 11, color: V.sand400 }}>Clear all?</span>
                    <button onClick={onClearConfirm} disabled={busy} style={{ ...btnSecondary, color: 'var(--danger)', borderColor: 'rgba(201,103,101,0.45)' }} className="no-drag">Yes, clear</button>
                    <button onClick={onClearCancel} disabled={busy} style={btnSecondary} className="no-drag">Cancel</button>
                  </>
                ) : (
                  <button onClick={onClear} disabled={busy} style={btnSecondary} className="no-drag">clear all</button>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {files.map(f => {
                const name = f.split(/[/\\]/).pop() ?? f
                return (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: V.sand300 }}>
                    <button
                      onClick={() => onRemoveOne(f)}
                      disabled={busy}
                      className="no-drag"
                      title="Remove this file"
                      style={{ background: 'none', border: 'none', color: V.sand500, cursor: busy ? 'not-allowed' : 'pointer', padding: '0 2px', fontSize: 13, lineHeight: 1, flexShrink: 0 }}
                    >×</button>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Chain analysis mixes (optional) — multi-pair ── */}
      <div style={{ marginBottom: 4 }}>
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ fontSize: 10, color: V.sand500, letterSpacing: '0.14em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
              Mix Files for Delta Analysis
              {chainMixFiles.length > 0 && (
                <span style={{
                  marginLeft: 8,
                  fontStyle: 'normal',
                  textTransform: 'none',
                  letterSpacing: 0,
                  color: V.gold,
                  fontWeight: 500,
                }}>
                  {chainMixFiles.length} {chainMixFiles.length === 1 ? 'file' : 'files'}
                </span>
              )}
              {chainMixFiles.length === 0 && (
                <span style={{ marginLeft: 6, fontStyle: 'italic', textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              )}
            </div>
            {chainMixFiles.length > 0 && (
              <button
                disabled={busy}
                style={{ ...btnGhost, fontSize: 10 }}
                className="no-drag"
                onClick={() => setChainMixFiles([])}
              >
                Clear all
              </button>
            )}
          </div>

          {/* Drop zone — routing handled by preload via data-dropzone="chain-mixes" */}
          <div
            ref={chainDropRef}
            data-dropzone="chain-mixes"
            onDragEnter={e => { e.preventDefault(); setChainDragHover(true) }}
            onDragOver={e => { e.preventDefault() }}
            onDragLeave={e => {
              if (!chainDropRef.current?.contains(e.relatedTarget as Node))
                setChainDragHover(false)
            }}
            onDrop={() => { setChainDragHover(false) }}
            onClick={async () => {
              if (busy) return
              const picked = await window.rtmprofileAPI.selectFiles()
              if (picked.length > 0)
                setChainMixFiles(prev => Array.from(new Set([...prev, ...picked])))
            }}
            style={{
              border: `1.5px ${chainDragHover ? 'solid' : 'dashed'} ${chainDragHover ? 'var(--gold)' : 'var(--border)'}`,
              borderRadius: 'var(--radius)',
              backgroundColor: chainDragHover ? 'var(--gold-tint)' : 'transparent',
              padding: chainMixFiles.length > 0 ? '10px 14px' : '14px',
              marginBottom: 8,
              cursor: busy ? 'default' : 'pointer',
              transition: 'border-color 120ms, background-color 120ms',
            }}
          >
            {chainMixFiles.length === 0 ? (
              <div style={{ textAlign: 'center', color: V.sand500, fontSize: 11 }}>
                Drop mix files here, or click to browse
              </div>
            ) : (() => {
              const normalize = (s: string) =>
                s.replace(/\.[^.]+$/, '')
                 .replace(/^\d{1,3}\s+/, '')
                 .replace(/\bM\d+(?:\.\d+)?\b/gi, '')
                 .replace(/\bMIX\s*\d*\b/gi, '')
                 .replace(/\d{2}-\d{2}-\d{4}/g, '')
                 .replace(/\b(FINAL|FINEL|ROUGH|FLAT|MAIN|CLEAN|RADIO|V\d+)\b/gi, '')
                 .replace(/[()]/g, '').replace(/\s+/g, ' ').trim().toUpperCase()
              const overlap = (a: string, b: string) => {
                const wa = new Set(a.split(' ').filter(Boolean))
                const wb = new Set(b.split(' ').filter(Boolean))
                let inter = 0; wa.forEach(w => { if (wb.has(w)) inter++ })
                return inter / Math.max(1, new Set([...wa, ...wb]).size)
              }
              return (
                <div onClick={e => e.stopPropagation()} className="no-drag">
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 16, fontWeight: 500, color: V.gold, fontVariantNumeric: 'tabular-nums' }}>
                      {chainMixFiles.filter(mp => {
                        const mixTitle = normalize(mp.split(/[/\\]/).pop() ?? mp)
                        let best = 0
                        files.forEach(f => { const s = overlap(mixTitle, normalize(f.split(/[/\\]/).pop() ?? f)); if (s > best) best = s })
                        return best >= 0.4
                      }).length} / {chainMixFiles.length}
                    </span>
                    <span style={{ fontSize: 10, color: V.sand500 }}>pairs matched</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {chainMixFiles.map(f => {
                      const name = f.split(/[/\\]/).pop() ?? f
                      const mixTitle = normalize(name)
                      let best = 0
                      files.forEach(mf => { const s = overlap(mixTitle, normalize(mf.split(/[/\\]/).pop() ?? mf)); if (s > best) best = s })
                      const isMatched = best >= 0.4
                      return (
                        <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                          <button
                            onClick={() => setChainMixFiles(prev => prev.filter(x => x !== f))}
                            disabled={busy}
                            title="Remove this file"
                            style={{ background: 'none', border: 'none', color: V.sand500, cursor: busy ? 'not-allowed' : 'pointer', padding: '0 2px', fontSize: 13, lineHeight: 1, flexShrink: 0 }}
                          >×</button>
                          <span style={{ color: isMatched ? V.sand300 : V.sand500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {name}
                          </span>
                          {!isMatched && <span style={{ fontSize: 10, color: V.sand500, flexShrink: 0 }}>· no match</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}
          </div>{/* end drop zone */}

          <div style={{ fontSize: 11, color: V.sand500, marginBottom: 14, lineHeight: 1.5 }}>
            <strong style={{ color: V.sand300 }}>What this does:</strong> drop your pre-master mixes here. RTMprofile matches each mix to its master by song title (e.g. <em>TOO HIGH MIX3</em> ↔ <em>01 TOO HIGH M1</em>), computes the spectral delta per pair, then aggregates across all pairs. More pairs = more accurate delta signature.
          </div>
      </div>

      {/* ── Build / Cancel buttons ────────────────────────────────── */}
      {/* Sticky so the button stays visible even when the result panel grows. */}
      <div style={{ position: 'sticky', bottom: 0, paddingBottom: 4, zIndex: 10, backgroundColor: 'var(--color-sand-900, #1c1a17)' }}>
{canBuild && !busy && (
        <div style={{ fontSize: 10, color: V.sand500, marginBottom: 6, letterSpacing: '0.03em' }}>
          Saves to <span className="mono" style={{ color: V.sand400 }}>~/.rtm/profiles/</span> — auto-loaded by RTMcompare's Match tab
        </div>
      )}
      <button
        onClick={onBuild}
        disabled={!canBuild}
        style={canBuild ? btnPrimary : btnDisabled}
        className="no-drag"
        aria-label="Build engineer profile from selected tracks"
        title={
          !name.trim() ? 'Enter a profile name above to continue' :
          files.length === 0 ? 'Drop some tracks above to continue' :
          undefined
        }
      >
        <BuildStatusLine busy={busy} onProgressUpdate={handleProgressUpdate} />
      </button>
      {!busy && files.length > 0 && !name.trim() && (
        <div style={{ fontSize: 10, color: 'var(--danger, #c96765)', marginTop: 6, textAlign: 'center' }}>
          ↑ Enter a profile name to enable scan
        </div>
      )}

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
      </div>{/* end sticky build section */}

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
                {/* NIT-9: guard against null/undefined sample_count */}
                {result.sample_count ?? 0} track{(result.sample_count ?? 0) === 1 ? '' : 's'} analyzed
                {result.skipped
                  ? <span style={{ color: V.sand400 }}> · {result.skipped} skipped</span>
                  : null}
              </div>
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: V.sand500, letterSpacing: '0.1em', textTransform: 'uppercase', flexShrink: 0 }}>Fingerprint</span>
                  <span className="mono" style={{ color: V.sand300, fontSize: 11, userSelect: 'text', wordBreak: 'break-all' }}>
                    {result.path}
                  </span>
                </div>
                {result.chain_path && (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, color: V.gold, letterSpacing: '0.1em', textTransform: 'uppercase', flexShrink: 0 }}>Delta ⛓</span>
                    <span className="mono" style={{ color: V.sand300, fontSize: 11, userSelect: 'text', wordBreak: 'break-all' }}>
                      {result.chain_path}
                    </span>
                  </div>
                )}
              </div>
              {result.chain_path && (result.chain_pair_count ?? 0) > 0 && (
                <div style={{ color: V.gold, fontSize: 12, marginTop: 4 }}>
                  {result.chain_pair_count} mix/master pair{result.chain_pair_count === 1 ? '' : 's'} matched — load the delta profile in RTMcompare's Match tab
                </div>
              )}
              {chainMixFiles.length > 0 && !result.chain_path && (
                <div style={{ color: V.sand400, fontSize: 12, marginTop: 4 }}>
                  ⚠ No mix/master pairs could be matched — check that song titles overlap
                </div>
              )}
              {(result.partialCount ?? 0) > 0 && (
                <div style={{ color: V.sand400, fontSize: 12, marginTop: 6 }}>
                  ⚠ {result.partialCount} track{result.partialCount === 1 ? '' : 's'} analyzed partially (short or low-signal sections skipped)
                </div>
              )}
              {result.python_resolution && (
                <div className="mono" style={{ color: V.sand500, fontSize: 10, marginTop: 6 }}>
                  Python: {result.python_resolution}
                </div>
              )}
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
              {result.errorDetail && (
                <pre style={{
                  color: V.sand400, fontSize: 10, marginTop: 8, whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all', maxHeight: 200, overflowY: 'auto',
                  background: 'rgba(0,0,0,0.3)', padding: '8px 10px', borderRadius: 4,
                  userSelect: 'text',
                }}>
                  {result.errorDetail}
                </pre>
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
