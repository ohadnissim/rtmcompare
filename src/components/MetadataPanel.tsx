import React, { useState, useEffect } from 'react'
import { TeachTerm } from '../teachMe'

interface CodingEntry {
 raw: string
 algorithm?: string
 sample_rate?: string
 bit_rate?: string
 bit_depth?: string
 mode?: string
 text?: string
}

interface Meta {
 bext?: { description?: string; originator?: string; originator_reference?: string; origination_date?: string; origination_time?: string; umid?: string; coding_history?: string; coding_history_parsed?: CodingEntry[] }
 ixml?: { project?: string; scene?: string; take?: string; note?: string; isrc?: string }
 info?: { title?: string; artist?: string; album?: string; date?: string; genre?: string; track?: string; copyright?: string; software?: string; comment?: string; engineer?: string; source?: string }
 id3?: { title?: string; artist?: string; album_artist?: string; album?: string; track?: string; year?: string; date?: string; genre?: string; isrc?: string; copyright?: string; software?: string; encoded_by?: string; comment?: string }
 file_bytes?: number
}

interface Props {
 metadata: { a?: Meta; b?: Meta }
 labelA: string
 labelB: string
 /** Absolute paths to the underlying audio files — required when the
 * user wants to edit & write BEXT / iXML back to disk. Without
 * them the Edit Mode button stays disabled. */
 pathA?: string
 pathB?: string
 /** Fires after a successful write so the caller can re-read metadata
 * and refresh the panel. */
 onWritten?: () => void
}

function hasAny(m?: Meta): boolean {
 if (!m) return false
 return !!(m.bext || m.ixml || m.info || m.id3)
}

function formatBytes(b?: number): string {
 if (!b) return ''
 if (b > 1e9) return `${(b / 1e9).toFixed(2)} GB`
 if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`
 if (b > 1e3) return `${(b / 1e3).toFixed(0)} KB`
 return `${b} B`
}

// Delivery-readiness check: does this file have the critical fields a label's
// DDEX ingestion pipeline will require? Separate from the BWF-specific check
// below so label-ops users can pass on a streaming master without a BEXT
// originator, while broadcast / post users flag it.
function checkDeliveryReady(m?: Meta): { ok: boolean; missing: string[] } {
 const missing: string[] = []
 if (!m) return { ok: false, missing: ['all metadata'] }
 const bext = m.bext
 const info = m.info
 const ixml = m.ixml
 const id3 = m.id3
 const hasTitle = !!(info?.title || id3?.title || bext?.description)
 const hasArtist = !!(info?.artist || id3?.artist)
 // ISRC missing-flag disabled by user direction.
 void (ixml?.isrc || id3?.isrc)
 if (!hasTitle) missing.push('Title')
 if (!hasArtist) missing.push('Artist')
 return { ok: missing.length === 0, missing }
}

// Broadcast-readiness check: BEXT originator + non-zero UMID. Jonas (post
// engineer): "strip BEXT originator and the file loses its audit trail —
// the deliverable is technically valid but untraceable back to the facility
// that mixed it." Shown as an advisory banner, not a hard block.
function checkBroadcastReady(m?: Meta): { ok: boolean; missing: string[] } {
 const missing: string[] = []
 if (!m?.bext) return { ok: true, missing: [] } // No BEXT = probably a streaming master, skip.
 if (!m.bext.originator || m.bext.originator.trim() === '') missing.push('BEXT Originator')
 // A UMID of all zeros is the "empty" sentinel some tools write — treat
 // it as missing.
 const umid = m.bext.umid || ''
 if (!umid || /^0+$/.test(umid.replace(/\s/g, ''))) missing.push('UMID')
 if (!m.bext.origination_date) missing.push('Origination date')
 return { ok: missing.length === 0, missing }
}

/**
 * ADM-compliant BEXT defaults. Pre-populated when a user clicks
 * "Write ADM-compliant BEXT" on the ADM-stamp button. All fields satisfy Apple Digital Masters' lossless-source-chain
 * check (the one soft-verified via BEXT coding_history).
 */
export interface AdmBextDefaults {
 /** Optional originator string — defaults to "RTMcompare · ADM Render" */
 originator?: string
 /** Optional coding history — built from the file's real sample rate /
 * bit depth / channel count by the caller if known. */
 codingHistory?: string
 /** Optional human title for the description field. */
 description?: string
}

export default function MetadataPanel({ metadata, labelA, labelB, pathA, pathB, onWritten }: Props) {
 // BWF / iXML / INFO write-back UI removed — that capability moved to
 // FLOW. RTM still READS metadata for QC purposes (this panel) but no
 // longer writes it back. The `pathA`/`pathB`/`onWritten` props remain
 // in the type signature so callers don't have to change, but they're
 // now unused.
 // eslint-disable-next-line @typescript-eslint/no-unused-vars
 void pathA; void pathB; void onWritten

 if (!metadata || (!hasAny(metadata.a) && !hasAny(metadata.b))) {
 // Even when metadata is absent, show the "will fail DDEX" warning so the
 // user knows their file is missing critical tags.
 return (
 <div className="bg-dark-900 rounded-2xl p-6 border border-dark-700/50 space-y-3">
 <h2 className="text-lg font-semibold">File Metadata</h2>
 <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'rgba(201,103,101,0.08)', border: '1px solid rgba(201,103,101,0.3)' }}>
 <div className="text-[11px] font-medium" style={{ color: '#c96765' }}>✕ No metadata tags found</div>
 <div className="text-[10px] text-dark-400 mt-1">
 This file has no BEXT / iXML / LIST-INFO / ID3 tags.
 </div>
 </div>
 </div>
 )
 }

 const deliveryA = checkDeliveryReady(metadata.a)
 const deliveryB = checkDeliveryReady(metadata.b)

 return (
 <div className="bg-dark-900 rounded-2xl p-6 border border-dark-700/50 space-y-4">
 <div className="space-y-1">
 <h2 className="text-lg font-semibold">File Metadata (BEXT / iXML / INFO)</h2>
 <p className="text-xs text-dark-400">
 Delivery-grade metadata embedded in the WAV/BWF.
 </p>
 </div>

 {/* Delivery-readiness banner — flags missing ISRC / title / artist */}
 {(metadata.a || metadata.b) && (
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
 {hasAny(metadata.a) && <DeliveryBanner label={labelA} status={deliveryA} />}
 {hasAny(metadata.b) && <DeliveryBanner label={labelB} status={deliveryB} />}
 </div>
 )}

 {/* Broadcast-readiness banner — shown only when a BEXT chunk is
 present (so streaming-only masters aren't nagged). Missing
 originator / UMID is an audit-trail problem, not a DDEX
 rejection — styled as info, not error. */}
 {(metadata.a?.bext || metadata.b?.bext) && (
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
 {metadata.a?.bext && <BroadcastBanner label={labelA} status={checkBroadcastReady(metadata.a)} />}
 {metadata.b?.bext && <BroadcastBanner label={labelB} status={checkBroadcastReady(metadata.b)} />}
 </div>
 )}

 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 {hasAny(metadata.a) && (
 <div className="space-y-2">
 <MetaBlock label={labelA} meta={metadata.a!} />
 </div>
 )}
 {hasAny(metadata.b) && (
 <div className="space-y-2">
 <MetaBlock label={labelB} meta={metadata.b!} />
 </div>
 )}
 </div>
 </div>
 )
}

function BroadcastBanner({ label, status }: { label: string; status: { ok: boolean; missing: string[] } }) {
 const color = status.ok ? '#6fa37e' : '#c5a55a'
 return (
 <div className="rounded-lg px-3 py-2" style={{ backgroundColor: `${color}10`, border: `1px solid ${color}40` }}>
 <div className="flex items-center justify-between">
 <span className="text-[10px] uppercase tracking-[0.12em]" style={{ color }}>
 {status.ok ? '✓ Broadcast audit trail intact' : '⚠ Broadcast audit trail incomplete'}
 </span>
 <span className="text-[10px] text-dark-500 truncate max-w-[40%]" title={label}>{label}</span>
 </div>
 {!status.ok && (
 <div className="text-[10px] text-dark-300 mt-1">
 Missing: <span style={{ color }}>{status.missing.join(', ')}</span>. Not a delivery blocker, but post-production QA won't be able to trace this file back to the facility.
 </div>
 )}
 </div>
 )
}

function DeliveryBanner({ label, status }: { label: string; status: { ok: boolean; missing: string[] } }) {
 const color = status.ok ? '#6fa37e' : '#c96765'
 return (
 <div className="rounded-lg px-3 py-2" style={{ backgroundColor: `${color}10`, border: `1px solid ${color}40` }}>
 <div className="flex items-center justify-between">
 <span className="text-[10px] uppercase tracking-[0.12em]" style={{ color }}>
 {status.ok ? '✓ Delivery-ready' : '✕ Missing for DDEX'}
 </span>
 <span className="text-[10px] text-dark-500 truncate max-w-[40%]" title={label}>{label}</span>
 </div>
 {!status.ok && (
 <div className="text-[10px] text-dark-300 mt-1">
 Missing: <span style={{ color }}>{status.missing.join(', ')}</span>. Label ingestion will bounce this.
 </div>
 )}
 </div>
 )
}

function MetaBlock({ label, meta }: { label: string; meta: Meta }) {
 return (
 <div className="bg-dark-800/40 rounded-xl p-4 space-y-3 text-[11px]">
 <div className="flex items-center justify-between pb-2 border-b border-dark-700/40">
 <span className="text-terra font-medium">{label}</span>
 {meta.file_bytes != null && <span className="font-mono text-dark-500">{formatBytes(meta.file_bytes)}</span>}
 </div>

 {meta.bext && (
 <Section title="BEXT (Broadcast Wave)">
 <Row label="Description" value={meta.bext.description} />
 <Row label="Originator" value={meta.bext.originator} />
 <Row label="Reference" value={meta.bext.originator_reference} />
 <Row label="Date" value={[meta.bext.origination_date, meta.bext.origination_time].filter(Boolean).join(' ')} />
 <UmidRow value={meta.bext.umid} />
 {meta.bext.coding_history_parsed && meta.bext.coding_history_parsed.length > 0 && (
 <div className="mt-2 space-y-1">
 <div className="text-[9px] uppercase tracking-[0.1em] text-dark-500">Coding history</div>
 <div className="space-y-0.5 max-h-40 overflow-y-auto">
 {meta.bext.coding_history_parsed.map((entry, i) => (
 <div key={i} className="bg-dark-900/40 rounded px-2 py-1 text-[10px]">
 <div className="flex flex-wrap gap-x-2 gap-y-0.5 font-mono">
 {entry.algorithm && <span><span className="text-dark-500">fmt</span> <span className="text-dark-200">{entry.algorithm}</span></span>}
 {entry.sample_rate && <span><span className="text-dark-500">sr</span> <span className="text-dark-200">{entry.sample_rate}</span></span>}
 {entry.bit_depth && <span><span className="text-dark-500">bits</span> <span className="text-dark-200">{entry.bit_depth}</span></span>}
 {entry.bit_rate && <span><span className="text-dark-500">kbps</span> <span className="text-dark-200">{entry.bit_rate}</span></span>}
 {entry.mode && <span><span className="text-dark-500">mode</span> <span className="text-dark-200">{entry.mode}</span></span>}
 </div>
 {entry.text && <div className="text-[9px] text-dark-400 mt-0.5">{entry.text}</div>}
 </div>
 ))}
 </div>
 </div>
 )}
 {!meta.bext.coding_history_parsed?.length && meta.bext.coding_history && (
 <div className="mt-2 space-y-1">
 <div className="text-[9px] uppercase tracking-[0.1em] text-dark-500">Coding history</div>
 <div className="font-mono text-[10px] text-dark-400 whitespace-pre-wrap max-h-24 overflow-y-auto bg-dark-900/40 rounded p-1.5">
 {meta.bext.coding_history}
 </div>
 </div>
 )}
 </Section>
 )}

 {meta.id3 && Object.values(meta.id3).some(v => v) && (
 <Section title="ID3v2 Tags">
 <Row label="Title" value={meta.id3.title} />
 <Row label="Artist" value={meta.id3.artist} />
 <Row label="Album artist" value={meta.id3.album_artist} />
 <Row label="Album" value={meta.id3.album} />
 <Row label="Track" value={meta.id3.track} />
 <Row label="Year" value={meta.id3.year || meta.id3.date} />
 <Row label="Genre" value={meta.id3.genre} />
 <Row label="ISRC" value={meta.id3.isrc} mono />
 <Row label="Copyright" value={meta.id3.copyright} />
 <Row label="Software" value={meta.id3.software} />
 <Row label="Encoded by" value={meta.id3.encoded_by} />
 <Row label="Comment" value={meta.id3.comment} />
 </Section>
 )}

 {meta.ixml && Object.values(meta.ixml).some(v => v) && (
 <Section title="iXML (Session Metadata)">
 <Row label="Project" value={meta.ixml.project} />
 <Row label="Scene" value={meta.ixml.scene} />
 <Row label="Take" value={meta.ixml.take} />
 <Row label="ISRC" value={meta.ixml.isrc} mono />
 <Row label="Note" value={meta.ixml.note} />
 </Section>
 )}

 {meta.info && Object.values(meta.info).some(v => v) && (
 <Section title="LIST-INFO (Tags)">
 <Row label="Title" value={meta.info.title} />
 <Row label="Artist" value={meta.info.artist} />
 <Row label="Album" value={meta.info.album} />
 <Row label="Track" value={meta.info.track} />
 <Row label="Date" value={meta.info.date} />
 <Row label="Engineer" value={meta.info.engineer} />
 <Row label="Software" value={meta.info.software} />
 <Row label="Copyright" value={meta.info.copyright} />
 <Row label="Comment" value={meta.info.comment} />
 </Section>
 )}
 </div>
 )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
 return (
 <div className="space-y-1">
 <div className="text-[9px] uppercase tracking-[0.12em] text-dark-500">{title}</div>
 {children}
 </div>
 )
}

function UmidRow({ value }: { value?: string }) {
 if (!value) return null
 const copy = async () => {
 try {
 if ((window as any).electronAPI?.copyToClipboard) {
 await (window as any).electronAPI.copyToClipboard(value)
 } else {
 await navigator.clipboard.writeText(value)
 }
 } catch {}
 }
 return (
 <div className="flex items-baseline gap-2">
 <span className="text-dark-500 w-20 flex-shrink-0">UMID</span>
 <span className="flex-1 text-dark-200 font-mono text-[10px] break-all">{value}</span>
 <button
 onClick={copy}
 className="text-[9px] px-1.5 py-0.5 rounded transition-colors flex-shrink-0"
 style={{ color: '#8d867b', border: '1px solid rgba(168,161,150,0.2)' }}
 title="Copy UMID to clipboard"
 >
 copy
 </button>
 </div>
 )
}

function Row({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
 if (!value) return null
 // Validate ISRC shape (ISO 3901): 2-letter country + 3-char registrant + 2-digit year + 5-digit designation
 // Hyphens are allowed visually but not in the canonical form.
 const isIsrc = label.toUpperCase() === 'ISRC'
 const isrcValid = isIsrc ? /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(value.replace(/-/g, '')) : true
 return (
 <div className="flex items-baseline gap-2">
 <span className="text-dark-500 w-20 flex-shrink-0">{label}</span>
 <span className={`flex-1 text-dark-200 ${mono ? 'font-mono text-[10px] break-all' : ''}`}>{value}</span>
 {isIsrc && (
 <span
 className="text-[9px] px-1.5 py-0.5 rounded"
 style={{
 color: isrcValid ? '#6fa37e' : '#c96765',
 backgroundColor: isrcValid ? 'rgba(111,163,126,0.12)' : 'rgba(201,103,101,0.14)',
 }}
 title={isrcValid
 ? 'Valid ISO 3901 format'
 : 'Invalid ISRC — expected format: CCRRRYYNNNNN (country + registrant + year + designation)'}
 >
 {isrcValid ? '✓ valid' : '✕ invalid'}
 </span>
 )}
 </div>
 )
}


// BwfEditor function removed — BWF write-back lives in FLOW now.
