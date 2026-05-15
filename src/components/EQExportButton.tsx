import React, { useState } from 'react'
import { buildAbletonAdg, buildProQ3Ffp } from '../eqExporters'
import { useV52Surface } from '../AudienceContext'

interface Band {
 freq: number
 gain_db: number
 q: number
 q_note?: string
 region?: string
}

interface Props {
 bands: Band[]
 engineer?: string
 fileName?: string
 // Amount fader value (0-100). When < 100, gets baked into the exported
 // filename so the user can tell a 50% render apart from a full-strength one.
 amountPct?: number
}

/**
 * Export the suggested EQ moves to DAW-readable formats:
 * • FabFilter Pro-Q (.ffp) — native binary, opens in Pro-Q 3 + Pro-Q 4
 * • FabFilter Pro-Q text — paste into Pro-Q's "Import as Text" dialog
 * • Ableton EQ Eight (.adv) — gzipped XML preset for Live 11 / 12
 * • CSV — universal, opens in Excel / Numbers / any DAW automation
 * • JSON — structured for programmatic consumption
 * • Copy table — clipboard-friendly tab-separated rows
 *
 * Apply-and-bounce (render a corrected WAV right here, no DAW round-trip)
 * lives in the dedicated <ApplyBounceButton /> component above the EQ
 * preview. Beta testers couldn't find it when it was the bottom item of
 * this dropdown; promoting it to its own primary button fixed that.
 *
 * Logic Channel EQ and Wavelab SparkleEQ exporters were removed in
 * 5.0.5 after a format audit confirmed Logic uses .pst (not .aupreset)
 * and SparkleEQ doesn't exist as a real Wavelab target.
 */
export default function EQExportButton({ bands, engineer, fileName, amountPct }: Props) {
 const [open, setOpen] = useState(false)
 const [toast, setToast] = useState<string | null>(null)
 const goldBudget = useV52Surface('gold-budget')

 const rawBase = (fileName || 'eq-moves').replace(/\.[^/.]+$/, '')
 // If the user dialed the Amount fader below 100 %, bake that into the
 // export filename so "MIX-eq-moves-50pct.ffp" reads differently from the
 // full-strength render. When at 100 % we keep the original naming so
 // existing workflows that glob on "-eq-moves" keep matching.
 const amountSuffix = amountPct != null && amountPct < 100 ? `-${amountPct}pct` : ''
 const baseName = `${rawBase}${amountSuffix}`

 const flash = (msg: string) => {
 setToast(msg)
 setTimeout(() => setToast(null), 3500)
 }

 const saveFile = async (name: string, contents: string, filters: { name: string; extensions: string[] }[]) => {
 try {
 if (window.electronAPI?.saveFileDialog) {
 const p = await window.electronAPI.saveFileDialog(name, contents, filters)
 if (p) flash(`Saved to ${p}`)
 } else {
 // Browser fallback
 const blob = new Blob([contents], { type: 'text/plain' })
 const url = URL.createObjectURL(blob)
 const a = document.createElement('a')
 a.href = url
 a.download = name
 a.click()
 URL.revokeObjectURL(url)
 }
 } catch (err: any) {
 flash(err?.message || 'Save failed')
 }
 }

 const exportCSV = () => {
 const lines = ['index,freq_hz,gain_db,q,shape,region']
 bands.forEach((b, i) => {
 lines.push([
 i + 1,
 b.freq,
 isFinite(b.gain_db) ? b.gain_db.toFixed(2) : '0.00',
 isFinite(b.q) ? b.q.toFixed(2) : '1.00',
 (b.q_note || '').replace(/,/g, ';'),
 (b.region || '').replace(/,/g, ';'),
 ].join(','))
 })
 saveFile(`${baseName}-eq-moves.csv`, lines.join('\n') + '\n', [
 { name: 'CSV', extensions: ['csv'] },
 ])
 setOpen(false)
 }

 const exportJSON = () => {
 const payload = {
 version: 1,
 generated_by: 'RTMcompare',
 engineer_profile: engineer || null,
 source_file: fileName || null,
 eq_moves: bands.map(b => ({
 freq_hz: b.freq,
 gain_db: +(isFinite(b.gain_db) ? b.gain_db.toFixed(2) : '0.00'),
 q: +(isFinite(b.q) ? b.q.toFixed(2) : '1.00'),
 shape: b.q_note || null,
 region: b.region || null,
 })),
 }
 saveFile(`${baseName}-eq-moves.json`, JSON.stringify(payload, null, 2), [
 { name: 'JSON', extensions: ['json'] },
 ])
 setOpen(false)
 }

 // FabFilter Pro-Q 3/4 native binary preset (.ffp) — primary export.
 // Pro-Q 4 reads the Pro-Q 3 binary natively (Frederik @ FabFilter,
 // Jan 2025 forum). 1348-byte file, 24 band slots + 22 global trailer
 // floats. Reverse-engineered from the MIT-licensed
 // raoulsh/preset-toolkit reference fixtures. Drops cleanly into
 // Pro-Q's preset folder or via Open Other Preset.
 const exportFabFilterFfp = async () => {
 try {
 const bandsForExport = bands.map((b, i) => ({
 id: `eq-${i}`,
 freq: b.freq,
 gain_db: b.gain_db,
 q: b.q,
 type: 'peaking' as const,
 enabled: true,
 label: b.q_note || b.region,
 }))
 const blob = buildProQ3Ffp(bandsForExport)
 if (window.electronAPI?.saveBinaryFileDialog) {
 const p = await window.electronAPI.saveBinaryFileDialog(
 `${baseName}-eq.ffp`,
 blob,
 [{ name: 'FabFilter Pro-Q preset', extensions: ['ffp'] }],
 )
 if (p) flash(`Pro-Q preset saved → ${p}. Open in Pro-Q 3 / Pro-Q 4 via the preset menu.`)
 } else {
 const blobObj = new Blob([blob as BlobPart], { type: 'application/octet-stream' })
 const url = URL.createObjectURL(blobObj)
 const a = document.createElement('a')
 a.href = url; a.download = `${baseName}-eq.ffp`; a.click()
 URL.revokeObjectURL(url)
 }
 } catch (err: any) {
 flash(err?.message || 'FabFilter .ffp export failed')
 }
 setOpen(false)
 }

 // FabFilter Pro-Q text export — secondary path. Use this when the
 // engineer wants to paste into Pro-Q's "Import as Text" dialog
 // instead of dropping a binary file. Saved as `.txt` (NOT `.ffp`)
 // so the extension matches the actual content type.
 const exportFFP = () => {
 const lines: string[] = []
 lines.push(`# FabFilter Pro-Q EQ moves — generated by RTMcompare`)
 lines.push(`# Source: ${fileName || 'unknown'}`)
 lines.push(`# Profile: ${engineer || 'n/a'}`)
 lines.push(`# Bands: ${bands.length}`)
 lines.push(`#`)
 lines.push(`# For each band: freq, gain (dB), Q, shape=bell, enabled=1`)
 lines.push(`# Paste into Pro-Q's "Import preset as text" dialog`)
 lines.push('')
 bands.forEach((b, i) => {
 lines.push(
 `band_${i + 1}: freq=${isFinite(b.freq) ? b.freq.toFixed(1) : '1000.0'}Hz gain=${isFinite(b.gain_db) ? b.gain_db.toFixed(2) : '0.00'}dB q=${isFinite(b.q) ? b.q.toFixed(2) : '1.00'} shape=bell enabled=true`
 )
 })
 saveFile(`${baseName}-eq.txt`, lines.join('\n') + '\n', [
 { name: 'Text', extensions: ['txt'] },
 { name: 'All', extensions: ['*'] },
 ])
 setOpen(false)
 }

 // Ableton EQ Eight .adv — gzipped XML native preset. Drops
 // straight onto an EQ Eight instance (Live 10 / 11 / 12).
 const exportAbleton = async () => {
 try {
 // Map the flat band list onto EQBand shape the builder expects.
 const bandsForExport = bands.map((b, i) => ({
 id: `eq-${i}`,
 freq: b.freq,
 gain_db: b.gain_db,
 q: b.q,
 type: 'peaking' as const,
 enabled: true,
 label: b.q_note || b.region,
 }))
 const gz = await buildAbletonAdg(bandsForExport, 1.0)
 if (window.electronAPI?.saveBinaryFileDialog) {
 const p = await window.electronAPI.saveBinaryFileDialog(
 `${baseName}-eq-eight.adv`,
 gz,
 [{ name: 'Ableton Device Preset', extensions: ['adv'] }],
 )
 if (p) flash(`Ableton preset saved → ${p}. Drag it onto an EQ Eight in Live.`)
 } else {
 const blob = new Blob([gz as BlobPart], { type: 'application/gzip' })
 const url = URL.createObjectURL(blob)
 const a = document.createElement('a')
 a.href = url; a.download = `${baseName}-eq-eight.adv`; a.click()
 URL.revokeObjectURL(url)
 }
 } catch (err: any) {
 flash(err?.message || 'Ableton export failed')
 }
 setOpen(false)
 }

 const copyPlainTable = async () => {
 const header = ['Freq', 'Gain', 'Q', 'Shape', 'Region']
 const rows = bands.map(b => [
 isFinite(b.freq) ? (b.freq >= 1000 ? `${(b.freq/1000).toFixed(1)} kHz` : `${b.freq} Hz`) : '— Hz',
 `${b.gain_db >= 0 ? '+' : ''}${isFinite(b.gain_db) ? b.gain_db.toFixed(1) : '—'} dB`,
 isFinite(b.q) ? b.q.toFixed(1) : '—',
 b.q_note || '',
 b.region || '',
 ])
 const text = [header, ...rows].map(r => r.join('\t')).join('\n')
 try {
 if (window.electronAPI?.copyToClipboard) {
 await window.electronAPI.copyToClipboard(text)
 } else {
 await navigator.clipboard.writeText(text)
 }
 flash('Copied table to clipboard — paste into any spreadsheet')
 } catch { flash('Copy failed') }
 setOpen(false)
 }

 if (!bands || bands.length === 0) return null

 return (
 <div className="relative inline-block">
 <button
 onClick={() => setOpen(v => !v)}
 className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-medium transition-colors"
 style={
   goldBudget
     ? {
         borderRadius: '2px',
         backgroundColor: 'var(--color-accent)',
         color: 'var(--color-bg-app)',
         border: '1px solid var(--color-accent)',
         letterSpacing: '0.12em',
         textTransform: 'uppercase',
       }
     : {
         borderRadius: '2px',
         backgroundColor: 'rgba(168,161,150,0.10)',
         color: 'var(--color-text-secondary)',
         border: '1px solid rgba(168,161,150,0.25)',
       }
 }
 title="Export the suggested EQ moves as a DAW preset (FabFilter / Ableton / CSV / JSON)."
 >
 Export to DAW
 <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
 </svg>
 </button>

 {open && (
 <div className="absolute right-0 top-full mt-1 z-50 py-1 min-w-[260px]"
 style={{ borderRadius: '2px', backgroundColor: 'var(--color-bg-panel)', border: '1px solid rgba(168,161,150,0.15)' }}>
 <MenuItem onClick={exportFabFilterFfp} icon="FF" title="FabFilter Pro-Q (.ffp)" hint="Native binary — Pro-Q 3 + Pro-Q 4" />
 <MenuItem onClick={exportFFP} icon="EQ" title="FabFilter Pro-Q text" hint='Paste into Pro-Q "Import as Text"' />
 <MenuItem onClick={exportAbleton} icon="▲" title="Ableton EQ Eight (.adv)" hint="Drop onto EQ Eight in Live 11 / 12" />
 <div className="my-1 border-t border-dark-700/50" />
 <MenuItem onClick={exportCSV} icon="⤓" title="CSV (spreadsheet)" hint="Opens in Excel / Numbers / Sheets" />
 <MenuItem onClick={exportJSON} icon="{ }" title="JSON" hint="Structured, for scripting" />
 <MenuItem onClick={copyPlainTable} icon="⎘" title="Copy table to clipboard" hint="Paste into docs / DAW notes" />
 </div>
 )}

 {toast && (
 <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 text-xs"
 style={{ borderRadius: '2px', backgroundColor: 'rgba(14,13,11,0.96)', color: 'var(--color-accent)', border: '1px solid rgba(208,176,102,0.35)' }}>
 {toast}
 </div>
 )}
 </div>
 )
}

function MenuItem({ onClick, icon, title, hint, disabled, accent }: {
 onClick: () => void
 icon: string
 title: string
 hint: string
 disabled?: boolean
 accent?: boolean
}) {
 return (
 <button
 onClick={onClick}
 disabled={disabled}
 className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-dark-800/80 disabled:opacity-40 transition-colors"
 >
 <span className="w-6 flex-shrink-0 text-center text-[11px] font-mono" style={{ color: accent ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>{icon}</span>
 <div className="flex-1 min-w-0">
 <div className="text-[11px]" style={{ color: accent ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>{title}</div>
 <div className="text-[9px] text-dark-500 mt-0.5">{hint}</div>
 </div>
 </button>
 )
}
