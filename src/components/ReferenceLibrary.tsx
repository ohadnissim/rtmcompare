import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { FileInfo, ReferenceRecord } from '../types'
import { useReferenceLibrary } from '../referenceLibraryCache'

/**
 * Reference Library — auto-analysed shelf of reference tracks the
 * engineer can recall as File A (or File B) for any comparison.
 *
 * What the competitors don't do:
 * • Reference 4 / SoundID: let you load references but re-scan every
 * session; no tags, no loudness metadata persisted.
 * • LEVELS: measures loudness but has no library concept.
 * • Ozone: no library at all.
 *
 * What we do:
 * • One-click add — quick-scan runs once (LUFS / TP / LRA / spectrum /
 * BPM / key), persists to disk, reload is instant.
 * • Search + tag filter.
 * • Click a card → load into the compare slot. The spectrum is the
 * 31-band 1/3-octave curve used everywhere else in the app, so the
 * library row and the analysis row overlay cleanly.
 *
 * Rendered as a modal overlay so it can be summoned from anywhere the
 * user is picking a reference file.
 */

interface Props {
 /** When open, the modal renders. Parent owns the boolean. */
 open: boolean
 onClose: () => void
 /** Called with a FileInfo-shaped record when the user picks one. */
 onPick: (info: FileInfo) => void
 /** Optional title override so the same component can be used for
 * "pick a reference" and "manage library" contexts. */
 title?: string
}

export default function ReferenceLibrary({ open, onClose, onPick, title = 'Reference Library' }: Props) {
 // Module-level cache: the first open pays the IPC round-trip;
 // subsequent opens are instant. Add / delete / update paths call
 // refresh() so disk + memory stay in sync.
 const { records, loading, refresh, mutate } = useReferenceLibrary()
 const [adding, setAdding] = useState(false)
 const [search, setSearch] = useState('')
 const [activeTag, setActiveTag] = useState<string | null>(null)
 const [editingId, setEditingId] = useState<string | null>(null)
 const [error, setError] = useState<string | null>(null)

 // Kick a background refresh whenever the modal opens — the render is
 // instant from cache, and the list updates if anything changed.
 useEffect(() => {
 if (open) refresh()
 }, [open, refresh])

 // Close on Escape — standard modal behaviour.
 useEffect(() => {
 if (!open) return
 const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
 window.addEventListener('keydown', handler)
 return () => window.removeEventListener('keydown', handler)
 }, [open, onClose])

 const allTags = useMemo(() => {
 const s = new Set<string>()
 for (const r of records) for (const t of (r.tags || [])) s.add(t)
 return Array.from(s).sort()
 }, [records])

 const visible = useMemo(() => {
 const q = search.trim().toLowerCase()
 return records.filter(r => {
 if (activeTag && !(r.tags || []).includes(activeTag)) return false
 if (!q) return true
 const hay = [
 r.filename, r.key, r.notes, r.bpm ? String(r.bpm) : '',
 ...(r.tags || []),
 ].join(' ').toLowerCase()
 return hay.includes(q)
 })
 }, [records, search, activeTag])

 const handleAdd = useCallback(async () => {
 if (!window.electronAPI?.selectFile || !window.electronAPI.referencesAdd) return
 setAdding(true)
 setError(null)
 try {
 const picked = await window.electronAPI.selectFile()
 if (!picked) { setAdding(false); return }
 const res = await window.electronAPI.referencesAdd(picked)
 if (res && 'error' in res) {
 setError(res.error || 'Could not add reference.')
 } else {
 // Optimistic: prepend the new record so the UI updates
 // instantly, then reconcile with disk.
 if (res) mutate([res as ReferenceRecord, ...records.filter(r => r.id !== (res as ReferenceRecord).id)])
 refresh()
 }
 } catch (e: any) {
 setError(e?.message || 'Could not add reference.')
 }
 setAdding(false)
 }, [records, refresh, mutate])

 const handleDelete = useCallback(async (id: string) => {
 if (!window.electronAPI?.referencesDelete) return
 // Optimistic: drop locally, refresh afterwards.
 mutate(records.filter(r => r.id !== id))
 await window.electronAPI.referencesDelete(id)
 refresh()
 }, [records, refresh, mutate])

 const handleSaveEdits = useCallback(async (id: string, tags: string[], notes: string) => {
 if (!window.electronAPI?.referencesUpdate) return
 // Optimistic local patch.
 mutate(records.map(r => r.id === id ? { ...r, tags, notes } : r))
 await window.electronAPI.referencesUpdate(id, { tags, notes })
 setEditingId(null)
 refresh()
 }, [records, refresh, mutate])

 if (!open) return null

 return (
 <div
 className="fixed inset-0 z-[100] flex items-center justify-center p-8"
 style={{ backgroundColor: 'rgba(14,13,11,0.75)' }}
 onClick={onClose}
 >
 <div
 className="rounded-2xl overflow-hidden max-w-5xl w-full max-h-[90vh] flex flex-col"
 style={{ backgroundColor: '#151411', border: '1px solid rgba(208,176,102,0.3)' }}
 onClick={e => e.stopPropagation()}
 >
 {/* Header */}
 <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid rgba(168,161,150,0.1)' }}>
 <div>
 <h2 className="text-lg" style={{ color: '#ebe7e0', fontWeight: 500 }}>{title}</h2>
 <p className="text-[10px] mt-0.5" style={{ color: '#7a7164' }}>
 {records.length} reference{records.length === 1 ? '' : 's'} ·
 auto-analysed (LUFS · TP · LRA · 31-band spectrum · BPM · key)
 </p>
 </div>
 <div className="flex items-center gap-2">
 <button
 onClick={handleAdd}
 disabled={adding}
 className="text-[11px] px-4 py-1.5 rounded-md transition-colors disabled:opacity-50"
 style={{ backgroundColor: '#d0b066', color: '#0e0d0b' }}
 title="Pick an audio file and add it to the library. Quick-scan runs automatically."
 >
 {adding ? 'Scanning…' : '+ Add reference'}
 </button>
 <button
 onClick={onClose}
 className="text-[11px] px-3 py-1.5 rounded-md"
 style={{ color: '#8d867b', border: '1px solid rgba(168,161,150,0.2)' }}
 >
 Close
 </button>
 </div>
 </div>

 {/* Search + tag filter */}
 <div className="flex items-center gap-3 px-6 py-3" style={{ borderBottom: '1px solid rgba(168,161,150,0.08)' }}>
 <input
 type="text"
 value={search}
 onChange={e => setSearch(e.target.value)}
 placeholder="Search by filename, tag, note, BPM, key…"
 className="flex-1 text-[12px] px-3 py-1.5 rounded-md outline-none"
 style={{
 backgroundColor: 'rgba(30,28,24,0.6)',
 color: '#ebe7e0',
 border: '1px solid rgba(168,161,150,0.15)',
 }}
 />
 {allTags.length > 0 && (
 <div className="flex items-center gap-1 flex-wrap">
 <span className="text-[9px] uppercase tracking-[0.15em]" style={{ color: '#7a7164' }}>Tags</span>
 {allTags.map(t => (
 <button
 key={t}
 onClick={() => setActiveTag(activeTag === t ? null : t)}
 className="text-[10px] px-2 py-0.5 rounded-full transition-colors"
 style={{
 backgroundColor: activeTag === t ? 'rgba(208,176,102,0.25)' : 'rgba(168,161,150,0.08)',
 color: activeTag === t ? '#d0b066' : '#a8a29e',
 border: `1px solid ${activeTag === t ? 'rgba(208,176,102,0.5)' : 'rgba(168,161,150,0.15)'}`,
 }}
 >
 {t}
 </button>
 ))}
 </div>
 )}
 </div>

 {/* Body */}
 <div className="flex-1 overflow-y-auto px-6 py-4">
 {error && (
 <div className="mb-3 px-3 py-2 rounded text-[11px]" style={{ backgroundColor: 'rgba(224,90,90,0.08)', color: '#e05a5a', border: '1px solid rgba(224,90,90,0.3)' }}>
 ⚠ {error}
 </div>
 )}
 {loading && records.length === 0 && (
 <p className="text-center text-[11px] py-8" style={{ color: '#7a7164' }}>Loading library…</p>
 )}
 {!loading && records.length === 0 && (
 <div className="text-center py-16 space-y-3">
 <p className="text-[12px]" style={{ color: '#a8a29e' }}>
 The library is empty.
 </p>
 <p className="text-[10px] max-w-md mx-auto" style={{ color: '#7a7164' }}>
 Add a reference track you trust — a commercial release in your target genre, a past
 master you're proud of, or a rough mix your client loves. RTM auto-extracts the
 loudness curve, spectrum, and rhythm metadata so you can recall it in one click and
 compare instantly.
 </p>
 <button
 onClick={handleAdd}
 disabled={adding}
 className="text-[11px] px-4 py-1.5 rounded-md"
 style={{ backgroundColor: '#d0b066', color: '#0e0d0b' }}
 >
 {adding ? 'Scanning…' : '+ Add your first reference'}
 </button>
 </div>
 )}
 {visible.length === 0 && records.length > 0 && !loading && (
 <p className="text-center text-[11px] py-8" style={{ color: '#7a7164' }}>
 No references match the current filter.
 </p>
 )}
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
 {visible.map(r => (
 <ReferenceCard
 key={r.id}
 record={r}
 onPick={() => { onPick({ path: r.path, name: r.filename }); onClose() }}
 onDelete={() => handleDelete(r.id)}
 editing={editingId === r.id}
 onEditToggle={() => setEditingId(editingId === r.id ? null : r.id)}
 onSaveEdits={(tags, notes) => handleSaveEdits(r.id, tags, notes)}
 />
 ))}
 </div>
 </div>
 </div>
 </div>
 )
}

function ReferenceCard({ record, onPick, onDelete, editing, onEditToggle, onSaveEdits }: {
 record: ReferenceRecord
 onPick: () => void
 onDelete: () => void
 editing: boolean
 onEditToggle: () => void
 onSaveEdits: (tags: string[], notes: string) => void
}) {
 const [tagsInput, setTagsInput] = useState((record.tags || []).join(', '))
 const [notesInput, setNotesInput] = useState(record.notes || '')

 useEffect(() => {
 setTagsInput((record.tags || []).join(', '))
 setNotesInput(record.notes || '')
 }, [record.tags, record.notes, editing])

 const lufsLabel = record.lufs_i != null
 ? `${record.lufs_i.toFixed(1)} LUFS`
 : '— LUFS'
 const tpLabel = record.true_peak_dbtp != null
 ? `${record.true_peak_dbtp >= 0 ? '+' : ''}${record.true_peak_dbtp.toFixed(1)} dBTP`
 : '— dBTP'
 const lraLabel = record.lra != null ? `${record.lra.toFixed(1)} LU` : '— LU'

 return (
 <div
 className="rounded-xl p-3 space-y-2 transition-colors"
 style={{
 backgroundColor: 'rgba(30,28,24,0.5)',
 border: '1px solid rgba(168,161,150,0.1)',
 }}
 >
 {/* Spectrum thumbnail */}
 {record.spectrum && record.spectrum.length > 0 && (
 <SpectrumThumbnail bands={record.spectrum} />
 )}

 {/* Filename + pick */}
 <div className="flex items-center justify-between gap-2">
 <button
 onClick={onPick}
 className="text-[12px] font-medium truncate text-left flex-1 hover:underline"
 style={{ color: '#ebe7e0' }}
 title={`Load "${record.filename}" into the reference slot`}
 >
 {record.filename}
 </button>
 <button
 onClick={onPick}
 className="text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
 style={{ color: '#d0b066', border: '1px solid rgba(208,176,102,0.35)' }}
 >
 Use
 </button>
 </div>

 {/* Metrics strip */}
 <div className="flex items-center gap-3 text-[10px] font-mono" style={{ color: '#a8a29e' }}>
 <span title="Integrated LUFS">{lufsLabel}</span>
 <span style={{ color: '#7a7164' }} title="True peak">
 {tpLabel}
 </span>
 <span title="Loudness range">{lraLabel}</span>
 {record.bpm != null && <span title="Beats per minute">{record.bpm.toFixed(0)} BPM</span>}
 {record.key && <span title="Estimated key">{record.key}</span>}
 </div>

 {/* Tags / notes — view or edit */}
 {!editing ? (
 <>
 <div className="flex items-center gap-1 flex-wrap min-h-[18px]">
 {(record.tags || []).map(t => (
 <span
 key={t}
 className="text-[9px] px-1.5 py-0.5 rounded-full"
 style={{ backgroundColor: 'rgba(124,164,163,0.12)', color: '#7ca4a3' }}
 >
 {t}
 </span>
 ))}
 {(!record.tags || record.tags.length === 0) && (
 <span className="text-[9px] italic" style={{ color: '#57534e' }}>no tags</span>
 )}
 </div>
 {record.notes && (
 <p className="text-[10px] italic truncate" style={{ color: '#8d867b' }} title={record.notes}>
 {record.notes}
 </p>
 )}
 </>
 ) : (
 <div className="space-y-1.5">
 <input
 type="text"
 value={tagsInput}
 onChange={e => setTagsInput(e.target.value)}
 placeholder="tags, comma-separated"
 className="w-full text-[10px] px-2 py-1 rounded outline-none"
 style={{
 backgroundColor: 'rgba(14,13,11,0.6)', color: '#ebe7e0',
 border: '1px solid rgba(168,161,150,0.15)',
 }}
 />
 <textarea
 value={notesInput}
 onChange={e => setNotesInput(e.target.value)}
 placeholder="notes"
 rows={2}
 className="w-full text-[10px] px-2 py-1 rounded outline-none resize-none"
 style={{
 backgroundColor: 'rgba(14,13,11,0.6)', color: '#ebe7e0',
 border: '1px solid rgba(168,161,150,0.15)',
 }}
 />
 </div>
 )}

 {/* Footer actions */}
 <div className="flex items-center justify-between pt-1 text-[9px]" style={{ color: '#57534e' }}>
 {!editing ? (
 <button
 onClick={onEditToggle}
 className="hover:underline"
 style={{ color: '#7a7164' }}
 >
 Edit tags / notes
 </button>
 ) : (
 <div className="flex items-center gap-2">
 <button
 onClick={() => onSaveEdits(
 tagsInput.split(',').map(s => s.trim()).filter(Boolean),
 notesInput.trim(),
 )}
 className="px-2 py-0.5 rounded"
 style={{ color: '#d0b066', border: '1px solid rgba(208,176,102,0.35)' }}
 >
 Save
 </button>
 <button
 onClick={onEditToggle}
 style={{ color: '#8d867b' }}
 >
 Cancel
 </button>
 </div>
 )}
 <button
 onClick={() => { if (confirm(`Remove "${record.filename}" from the library? The audio file stays on disk.`)) onDelete() }}
 className="hover:underline"
 style={{ color: '#7a7164' }}
 >
 Remove
 </button>
 </div>
 {record.error && (
 <p className="text-[9px]" style={{ color: '#e05a5a' }}>Scan: {record.error}</p>
 )}
 </div>
 )
}

/**
 * Tiny spectrum thumbnail — same 31-band 1/3-octave curve the rest of
 * the app uses, rendered as a 120×40 SVG. Gold line, dark backdrop,
 * reads at a glance next to other cards. When the user drops a track
 * to compare, the analysis spectrum overlays on top of this without
 * any resampling — the bands match exactly.
 */
function SpectrumThumbnail({ bands }: { bands: number[] }) {
 // Wider than the card so freq labels fit. Keep height modest so
 // the card stays compact.
 const w = 360, h = 60
 const pad = { t: 4, r: 4, b: 10, l: 22 }
 const yMin = -48, yMax = 3 // tightens the useful range for mastered tracks
 const toY = (db: number) => {
 const clamped = Math.max(yMin, Math.min(yMax, db))
 return pad.t + (1 - (clamped - yMin) / (yMax - yMin)) * (h - pad.t - pad.b)
 }
 const pts = bands.map((v, i) => ({
 x: pad.l + (i / Math.max(1, bands.length - 1)) * (w - pad.l - pad.r),
 y: toY(v),
 }))
 let d = ''
 if (pts.length >= 2) {
 d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
 for (let i = 1; i < pts.length; i++) {
 const prev = pts[i - 1], curr = pts[i]
 const cx = (prev.x + curr.x) / 2
 d += ` C ${cx.toFixed(1)} ${prev.y.toFixed(1)}, ${cx.toFixed(1)} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`
 }
 }
 // dB gridlines + frequency anchors so the curve reads against scale.
 const dbTicks = [-36, -24, -12, 0]
 const BANDS = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000]
 const freqLabels = [100, 1000, 10000]
 const freqX = (f: number) => {
 const idx = BANDS.findIndex(b => b >= f)
 return idx < 0 ? null : pad.l + (idx / Math.max(1, BANDS.length - 1)) * (w - pad.l - pad.r)
 }
 return (
 <div className="rounded overflow-hidden" style={{ backgroundColor: 'rgba(14,13,11,0.7)' }}>
 <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height: 50 }}>
 {/* dB grid + labels */}
 {dbTicks.map(db => (
 <React.Fragment key={db}>
 <line x1={pad.l} y1={toY(db)} x2={w - pad.r} y2={toY(db)} stroke="#2a2927" strokeWidth="0.5" strokeDasharray="2 3" />
 <text x={pad.l - 3} y={toY(db) + 3} fontSize="7" fill="#57534e" textAnchor="end">{db}</text>
 </React.Fragment>
 ))}
 {/* Frequency anchors */}
 {freqLabels.map(f => {
 const x = freqX(f); if (x == null) return null
 return (
 <text key={f} x={x} y={h - 1.5} fontSize="7" fill="#57534e" textAnchor="middle">
 {f >= 1000 ? `${f / 1000}k` : f}
 </text>
 )
 })}
 {d && <path d={`${d} L ${(w - pad.r).toFixed(1)} ${(h - pad.b).toFixed(1)} L ${pad.l.toFixed(1)} ${(h - pad.b).toFixed(1)} Z`} fill="#d0b066" opacity="0.12" />}
 {d && <path d={d} fill="none" stroke="#d0b066" strokeWidth="1.2" />}
 </svg>
 </div>
 )
}
