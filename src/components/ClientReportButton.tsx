import React, { useEffect, useRef, useState } from 'react'
import { AnalysisResult, FileInfo, MonoBand } from '../types'
import { streamingTpFloorDbtp } from '../dspProfiles'
import { useEQ, EQBand } from '../EQContext'

interface Props {
 results: AnalysisResult
 fileA: FileInfo
 fileB: FileInfo
}

type ReportMode = 'client' | 'engineer'

/**
 * Two-flavor track report — PDF via Electron's offscreen printToPDF.
 *
 * • Client flavor: softened plain-English narrative, one-line verdict,
 * per-platform playback row, top actions, file-identity receipt block.
 * Everything a manager or A&R would screenshot for a Slack thread.
 * • Engineer flavor: same data, terser tone, ISO timestamps, technical
 * vocabulary. Meant for sending back to the mastering engineer with a
 * concrete revision list.
 *
 * Both flavors include a file-identity block (filename, SR/BD, ms-precise
 * length, size, mtime, SHA-256, ISRC) so the PDF doubles as a
 * deliverable receipt. Mood / genre / BPM / key were removed per label-ops
 * review — wrong audience, misclassification is a reputation risk.
 */
export default function ClientReportButton({ results, fileA, fileB }: Props) {
 const [busy, setBusy] = useState<null | ReportMode>(null)
 const [open, setOpen] = useState(false)
 const eq = useEQ()
 const [reviewer, setReviewer] = useState<string>(() => {
 try { return localStorage.getItem('rtm-reviewer') || '' } catch { return '' }
 })
 const wrapRef = useRef<HTMLDivElement>(null)

 // Persist reviewer name across sessions.
 useEffect(() => {
 try { localStorage.setItem('rtm-reviewer', reviewer) } catch {}
 }, [reviewer])

 // Close dropdown on outside click.
 useEffect(() => {
 if (!open) return
 const onDoc = (e: MouseEvent) => {
 if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
 }
 window.addEventListener('mousedown', onDoc)
 return () => window.removeEventListener('mousedown', onDoc)
 }, [open])

 const labelB = stripExt(fileB.name)

 const handleExport = async (mode: ReportMode) => {
 setOpen(false)
 setBusy(mode)
 try {
 // Pull a file-identity fingerprint from the main process — cheap at
 // this scale and what makes the PDF a deliverable receipt.
 let identity: FileIdentity | null = null
 if (window.electronAPI?.getFileIdentity) {
 try {
 const res = await window.electronAPI.getFileIdentity(fileB.path)
 if (res && !res.error) identity = res
 } catch {}
 }
 const html = generateReport(results, fileA, fileB, {
 mode,
 reviewer: reviewer.trim(),
 identity,
 eqBands: eq.bands.filter(b => b.enabled !== false),
 eqReferenceLabel: eq.referenceLabel ?? null,
 })
 const fileName = `${labelB}-${mode === 'client' ? 'client' : 'engineer'}-report`
 if (window.electronAPI?.renderPdf) {
 const out = await window.electronAPI.renderPdf(html, fileName)
 if (out && window.electronAPI?.revealInFinder) {
 await window.electronAPI.revealInFinder(out)
 }
 } else {
 downloadAsHtml(html, fileName)
 }
 } catch (err) {
 console.error('Report export failed:', err)
 } finally {
 setBusy(null)
 }
 }

 return (
 <div className="relative inline-block" ref={wrapRef}>
 <button
 onClick={() => !busy && setOpen(v => !v)}
 disabled={!!busy}
 className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors"
 style={{
 backgroundColor: 'rgba(124,164,163,0.12)',
 color: '#7ca4a3',
 border: '1px solid rgba(124,164,163,0.35)',
 }}
 title="Export a PDF track report (two tones, one dataset)"
 >
 {busy ? (busy === 'client' ? 'Rendering client PDF…' : 'Rendering engineer PDF…') : 'Export Report'}
 <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
 </svg>
 </button>

 {open && !busy && (
 <div
 className="absolute right-0 top-full mt-1 z-50 rounded-lg shadow-xl py-1 min-w-[300px]"
 style={{ backgroundColor: '#1e1c18', border: '1px solid rgba(168,161,150,0.15)' }}
 >
 {/* "Layman" report — beta-tester ask (5.0.6): an engineer needs to
     send results to an artist / manager who can't read LUFS / TP
     deltas. This flavor uses plain-English verdicts, normal-language
     timestamps, no jargon. Same data, different vocabulary. */}
 <ReportOption
 onClick={() => handleExport('client')}
 title="Layman report (plain English)"
 hint="For artists, managers, A&R. Plain-language verdict + per-platform row + action items in normal words."
 accent="#7ca4a3"
 />
 <ReportOption
 onClick={() => handleExport('engineer')}
 title="Engineer revision notes"
 hint="Terse, timestamped, technical. The mastering-engineer revision checklist."
 accent="#d0b066"
 />
 <div className="my-1 border-t border-dark-700/50" />
 <div className="px-3 py-2 space-y-1">
 <label className="text-[9px] uppercase tracking-[0.15em] text-dark-500">
 Reviewer (on every report)
 </label>
 <input
 type="text"
 value={reviewer}
 onChange={(e) => setReviewer(e.target.value)}
 placeholder="e.g. Ohad Nissim"
 className="w-full bg-transparent text-[11px] px-2 py-1 rounded outline-none"
 style={{ color: '#ebe7e0', border: '1px solid rgba(168,161,150,0.18)' }}
 />
 </div>
 </div>
 )}
 </div>
 )
}

function ReportOption({ onClick, title, hint, accent }: {
 onClick: () => void
 title: string
 hint: string
 accent: string
}) {
 return (
 <button
 onClick={onClick}
 className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-dark-800/80 transition-colors"
 >
 <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: accent }} />
 <div className="flex-1 min-w-0">
 <div className="text-[11px]" style={{ color: '#ebe7e0' }}>{title}</div>
 <div className="text-[9px] text-dark-500 mt-0.5">{hint}</div>
 </div>
 </button>
 )
}

function downloadAsHtml(html: string, name: string) {
 const blob = new Blob([html], { type: 'text/html' })
 const url = URL.createObjectURL(blob)
 const a = document.createElement('a')
 a.href = url
 a.download = `${name}.html`
 a.click()
 URL.revokeObjectURL(url)
}

function stripExt(s: string): string { return s.replace(/\.[^/.]+$/, '') }

/* ────────────────────────────────────────────────────────────────────────── */

interface FileIdentity {
 path: string
 size: number
 mtime: number
 mtime_iso: string
 sha256: string
}

interface ReportOptions {
 mode: ReportMode
 reviewer: string
 identity: FileIdentity | null
 /** Proposed EQ bands from the Match panel / Master Assistant —
  *  rendered as an "EQ recommendations" section in the report so the
  *  engineer / artist sees the actual reference-vs-compare moves
  *  instead of just narrative bullets. */
 eqBands: EQBand[]
 /** Label of the reference profile / track the EQ was matched against,
  *  if any. Goes into the section subtitle ("Match vs Beyoncé · 4")
  *  so the recipient knows what the moves are aiming at. */
 eqReferenceLabel: string | null
}

function generateReport(r: AnalysisResult, fileA: FileInfo, fileB: FileInfo, opts: ReportOptions): string {
 const labelA = stripExt(fileA.name)
 const labelB = stripExt(fileB.name)
 const isSingleFile = fileA.path === fileB.path
 const now = new Date()
 const dateHuman = now.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
 const dateIso = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
 const dateShown = opts.mode === 'engineer' ? dateIso : dateHuman

 const verdict = buildVerdict(r, isSingleFile, opts.mode)
 const platformRow = buildPlatformRow(r)
 const comparisonRows = buildComparisonTable(r, labelA, labelB, isSingleFile, opts.mode)
 const bullets = buildTopActions(r, labelA, labelB, isSingleFile, opts.mode)
 const identityRows = buildFileIdentity(r, fileB, opts.identity)
 const standardsRows = buildStandardsBlock(r)
 const eqRows = buildEqRecommendations(opts.eqBands, opts.mode)
 const tonalBlock = buildTonalBalance(r, opts.mode)
 const stereoBlock = buildStereoMonoPhase(r, labelB, opts.mode)
 const artefactsBlock = buildArtefactsBlock(r, opts.mode)

 // Typographic hierarchy — verdict is 18pt, section headers are small caps,
 // body is 11.5pt. Tone switches through CSS classes so the `engineer`
 // flavor stays legible but terser.
 return `<!DOCTYPE html>
<html lang="en">
<head>
 <meta charset="utf-8">
 <title>${escapeHtml(labelB)} — ${opts.mode === 'client' ? 'Track Report' : 'Engineer Revision Notes'}</title>
 <style>
 @page { size: A4; margin: 16mm 14mm; }
 * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
 body { font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; background: #fbf9f4; color: #1a1814; line-height: 1.5; font-size: 11.5pt; }
 .eyebrow { font-size: 8.5pt; letter-spacing: 0.22em; text-transform: uppercase; color: #b48f3a; font-weight: 500; }
 h1 { font-family: "Playfair Display", Georgia, serif; font-weight: 400; letter-spacing: 0.01em; font-size: 24pt; margin: 2pt 0 4pt; }
 .sub { color: #7a7164; font-size: 9.5pt; margin-bottom: 10pt; }

 /* 18pt verdict line — the headline label/ops screenshots. */
 .verdict {
 font-size: 18pt;
 font-weight: 500;
 padding: 14pt 16pt;
 border-left: 3pt solid ${verdict.color};
 background: ${verdict.bg};
 margin: 10pt 0 14pt;
 letter-spacing: 0.005em;
 color: ${verdict.textColor};
 }
 .verdict .reason { display: block; margin-top: 4pt; font-size: 10pt; font-weight: 400; color: #5c5549; letter-spacing: 0; }

 h2 { font-size: 9.5pt; font-weight: 500; text-transform: uppercase; letter-spacing: 0.18em; color: #b48f3a; margin: 18pt 0 8pt; border-bottom: 1px solid #ecdfbf; padding-bottom: 4pt; }

 /* Per-platform playback row — second slide in the report. */
 .platform-row { display: grid; grid-template-columns: repeat(${platformRow.length || 1}, 1fr); gap: 0; background: #f4eddb; border-radius: 4pt; overflow: hidden; margin-bottom: 4pt; }
 .platform-cell { padding: 10pt 8pt; text-align: center; border-right: 1px solid #ecdfbf; }
 .platform-cell:last-child { border-right: none; }
 .platform-cell .name { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.14em; color: #8d867b; margin-bottom: 3pt; }
 .platform-cell .val { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12pt; color: #1a1814; font-weight: 500; }
 .platform-cell .delta { display: block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 8.5pt; color: #8d867b; margin-top: 2pt; }
 .platform-cell.warn .val { color: #a23d2f; }
 .platform-cell.warn .delta { color: #a23d2f; }

 /* Comparison table. */
 table.compare { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
 table.compare th { text-align: left; padding: 6pt 8pt; color: #8d867b; font-weight: 500; border-bottom: 1px solid #ecdfbf; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.12em; }
 table.compare th.num, table.compare td.num { text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10pt; }
 table.compare td { padding: 5pt 8pt; border-bottom: 1px solid #f3ecd9; }
 table.compare .ref { color: #8d867b; }
 table.compare .comp { color: #1a1814; font-weight: 500; }
 table.compare .diff-better { color: #3d6b4a; }
 table.compare .diff-worse { color: #a23d2f; }

 /* Tonal / stereo / artefacts shared row layout — small cards. */
 .obs-block { background: #f4eddb; border-radius: 4pt; padding: 10pt 12pt; margin: 4pt 0 10pt; }
 .obs-row { display: grid; grid-template-columns: 30mm 1fr 22mm; gap: 10pt; padding: 5pt 0; border-bottom: 1px dashed #e8dcb9; align-items: baseline; }
 .obs-row:last-child { border-bottom: none; }
 .obs-row .label { color: #1a1814; font-weight: 500; font-size: 10pt; }
 .obs-row .text { color: #3a362f; font-size: 9.5pt; line-height: 1.4; }
 .obs-row .num { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9.5pt; text-align: right; color: #1a1814; }
 .obs-row .num.ok { color: #3d6b4a; }
 .obs-row .num.warn { color: #b48f3a; }
 .obs-row .num.bad { color: #a23d2f; }

 /* EQ recommendations table. */
 table.eq-table { width: 100%; border-collapse: collapse; font-size: 10pt; margin-top: 4pt; }
 table.eq-table th { text-align: left; padding: 6pt 8pt; color: #8d867b; font-weight: 500; border-bottom: 1px solid #ecdfbf; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.12em; }
 table.eq-table th.num, table.eq-table td.num { text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10pt; }
 table.eq-table td { padding: 6pt 8pt; border-bottom: 1px solid #f3ecd9; vertical-align: top; }
 table.eq-table .band-name { font-weight: 500; color: #1a1814; min-width: 22mm; }
 table.eq-table .move-pos { color: #3d6b4a; font-weight: 500; }
 table.eq-table .move-neg { color: #a23d2f; font-weight: 500; }
 table.eq-table .what { color: #3a362f; font-size: 9.5pt; line-height: 1.4; }

 /* Top actions. */
 .bullet { display: flex; gap: 10pt; padding: 8pt 0; border-bottom: 1px solid #ecdfbf; }
 .bullet:last-child { border-bottom: none; }
 .bullet-num { width: 20pt; height: 20pt; background: #b48f3a; color: #fff; font-size: 10pt; display: flex; align-items: center; justify-content: center; border-radius: 50%; flex-shrink: 0; font-weight: 500; }
 .bullet-title { font-size: 11pt; font-weight: 500; color: #1a1814; }
 .bullet-body { font-size: 10pt; color: #3a362f; margin-top: 2pt; }

 /* File identity receipt block — signatures, SHA, etc. */
 .identity { background: #f4eddb; border-radius: 4pt; padding: 10pt 14pt; margin-top: 6pt; }
 .identity-row { display: flex; justify-content: space-between; gap: 12pt; padding: 3pt 0; border-bottom: 1px dashed #e8dcb9; font-size: 9.5pt; }
 .identity-row:last-child { border-bottom: none; }
 .identity-row .k { color: #8d867b; letter-spacing: 0.08em; text-transform: uppercase; font-size: 8pt; min-width: 72pt; }
 .identity-row .v { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #1a1814; word-break: break-all; text-align: right; flex: 1; }
 .identity-row .v.muted { color: #8d867b; }

 .standards { background: #f4eddb; border-radius: 4pt; padding: 8pt 10pt; margin-top: 6pt; }
 .standard-row { display: grid; grid-template-columns: 38mm 1fr 22mm 18mm; gap: 8pt; padding: 3pt 0; border-bottom: 1px dashed #e8dcb9; font-size: 8.5pt; align-items: baseline; }
 .standard-row:last-child { border-bottom: none; }
 .standard-row .name { font-weight: 500; color: #1a1814; }
 .standard-row .version, .standard-row .date { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #5c5549; }
 .standard-row .flag { color: #a23d2f; text-align: right; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.08em; }

 /* Footer. */
 .footer { margin-top: 18pt; padding-top: 8pt; border-top: 1px solid #d8cba5; font-size: 8.5pt; color: #8d867b; display: flex; justify-content: space-between; }

 /* Engineer-flavor tightenings. */
 .mode-engineer body, body.mode-engineer { font-size: 10.5pt; }
 .mode-engineer h1 { font-size: 18pt; font-family: ui-sans-serif, -apple-system, sans-serif; font-weight: 500; letter-spacing: 0; }
 .mode-engineer .verdict { font-size: 14pt; padding: 10pt 12pt; }
 .mode-engineer .bullet-title { font-size: 10.5pt; }
 .mode-engineer .bullet-body { font-size: 9.5pt; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
 </style>
</head>
<body class="mode-${opts.mode}">
 <div class="eyebrow">${opts.mode === 'client' ? 'Track Report' : 'Revision Notes · Engineer'}</div>
 <h1>${escapeHtml(labelB)}</h1>
 <p class="sub">${escapeHtml(dateShown)}${opts.reviewer ? ` · ${escapeHtml(opts.reviewer)}` : ''}${isSingleFile ? '' : ` · vs ${escapeHtml(labelA)}`}</p>

 <div class="verdict">
 ${escapeHtml(verdict.title)}
 ${verdict.reason ? `<span class="reason">${escapeHtml(verdict.reason)}</span>` : ''}
 </div>

 ${platformRow.length > 0 ? `
 <h2>Streaming playback · what listeners will actually hear</h2>
 <div class="platform-row">
 ${platformRow.map(p => `
 <div class="platform-cell${p.warn ? ' warn' : ''}">
 <div class="name">${escapeHtml(p.name)}</div>
 <div class="val">${escapeHtml(p.played)}${p.tpBreach ? ' ⚠' : ''}</div>
 <span class="delta">${escapeHtml(p.delta)}</span>
 </div>
 `).join('')}
 </div>
 <p style="font-size:8.5pt;color:#8d867b;margin-top:4pt;font-style:italic">Post-normalisation playback loudness per platform. ⚠ = limiter engages.</p>
 ` : ''}

 ${comparisonRows ? `
 <h2>${isSingleFile ? 'Measurements' : `${escapeHtml(labelB)} vs ${escapeHtml(labelA)}`}</h2>
 <table class="compare">
 <thead>
 <tr>
 <th>Metric</th>
 ${isSingleFile
 ? '<th class="num">Value</th>'
 : `<th class="num">${escapeHtml(labelA)}</th><th class="num">${escapeHtml(labelB)}</th><th class="num">Δ</th>`}
 </tr>
 </thead>
 <tbody>${comparisonRows}</tbody>
 </table>
 ` : ''}

 ${bullets.length > 0 ? `
 <h2>${opts.mode === 'engineer' ? 'Revision checklist' : `Top ${bullets.length} action${bullets.length === 1 ? '' : 's'}`}</h2>
 ${bullets.map((b, i) => `
 <div class="bullet">
 <div class="bullet-num">${i + 1}</div>
 <div>
 <div class="bullet-title">${escapeHtml(b.title)}</div>
 <div class="bullet-body">${escapeHtml(b.body)}</div>
 </div>
 </div>
 `).join('')}
 ` : ''}

 ${tonalBlock}

 ${eqRows ? `
 <h2>EQ recommendations${opts.eqReferenceLabel ? ` · matched to ${escapeHtml(opts.eqReferenceLabel)}` : ` · ${escapeHtml(labelA)} vs ${escapeHtml(labelB)}`}</h2>
 <p style="font-size:9.5pt;color:#7a7164;margin:-4pt 0 8pt;font-style:italic">${opts.mode === 'engineer'
   ? 'Bands generated by the Match panel from the per-band spectrum delta. Apply via the FabFilter Pro-Q / Ableton EQ Eight / CSV exports.'
   : 'These are the EQ moves the analyser recommends for the master to land closer to the reference. Each row: where on the dial, how loud, how wide a band, and what it does.'}</p>
 <table class="eq-table">
 <thead>
 <tr>
 <th>Band</th>
 <th class="num">Frequency</th>
 <th class="num">Move</th>
 <th class="num">Width</th>
 <th>What it does</th>
 </tr>
 </thead>
 <tbody>${eqRows}</tbody>
 </table>
 ` : ''}

 ${stereoBlock}

 ${artefactsBlock}

 <h2>Deliverable receipt</h2>
 <div class="identity">
 ${identityRows}
 </div>

 ${standardsRows ? `
 <h2>Standards checked against</h2>
 <div class="standards">
 ${standardsRows}
 </div>
 ` : ''}

 <div class="footer">
 <span>RTM Audio${opts.reviewer ? ` · ${escapeHtml(opts.reviewer)}` : ''}</span>
 <span>${escapeHtml(opts.mode === 'engineer' ? dateIso : dateHuman)}</span>
 </div>
</body>
</html>`
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Verdict — one-line headline, distinct tone per flavor. */
/* ────────────────────────────────────────────────────────────────────────── */

function buildVerdict(r: AnalysisResult, isSingleFile: boolean, mode: ReportMode): {
 title: string
 reason: string
 color: string
 bg: string
 textColor: string
} {
 // Gather all blocking / warning signals.
 const blocking: string[] = []
 const warnings: string[] = []
 if (r.headroom && r.headroom.true_peak_b > streamingTpFloorDbtp()) blocking.push('true-peak overs')
 if (r.distortion?.severity === 'problem') blocking.push('distortion / clipping')
 if ((r.clicks || []).filter(c => c.severity === 'high').length > 0) blocking.push('audible clicks')

 if (r.mono_compat && (r.mono_compat as any).risk_b > 25) warnings.push('mono-compat risk')
 if (r.distortion?.severity === 'warning') warnings.push('minor distortion')
 // TP-margin warning disabled by user direction — show numbers only.

 if (blocking.length > 0) {
 const title = mode === 'engineer'
 ? `HOLD: ${blocking[0]}`
 : `Hold: ${blocking[0]}.`
 const reason = mode === 'engineer'
 ? blocking.join('; ')
 : `We recommend another revision before delivery. See the checklist below.`
 return { title, reason, color: '#a23d2f', bg: '#f5e0df', textColor: '#6b1f19' }
 }
 if (warnings.length > 0) {
 const title = mode === 'engineer'
 ? `ONE REVISION: ${warnings[0]}`
 : `One revision needed.`
 const reason = mode === 'engineer'
 ? warnings.join('; ')
 : `Address ${warnings.join(', ')} before final delivery; otherwise the track is ready.`
 return { title, reason, color: '#b48f3a', bg: '#f5ecd4', textColor: '#5c4820' }
 }
 const title = mode === 'engineer'
 ? 'READY TO SHIP'
 : 'Ready to ship.'
 const reason = isSingleFile
 ? 'No blocking issues detected; measurements look clean.'
 : 'No blocking issues; measurements are in line with the reference.'
 return { title, reason, color: '#3d6b4a', bg: '#eaf2ec', textColor: '#1f3d2a' }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Per-platform playback row — the slide label-ops screenshots. */
/* ────────────────────────────────────────────────────────────────────────── */

function buildPlatformRow(r: AnalysisResult): { name: string; played: string; delta: string; tpBreach: boolean; warn: boolean }[] {
 const rows = r.streaming_preview?.b || []
 // Keep the 5 most recognisable services — ordered by audience size. If the
 // backend dropped any, the grid shrinks automatically.
 const pick = ['Spotify', 'Apple Music', 'YouTube', 'Tidal', 'Amazon Music']
 const out: { name: string; played: string; delta: string; tpBreach: boolean; warn: boolean }[] = []
 for (const name of pick) {
 const row = rows.find(r => r.name === name)
 if (!row) continue
 const delta = row.delta_db === 0 ? '±0 dB' : `${row.delta_db > 0 ? '+' : ''}${row.delta_db.toFixed(1)} dB`
 out.push({
 name,
 played: `${row.played_lufs.toFixed(1)} LUFS`,
 delta,
 // TP-breach warnings disabled by user direction — show numbers only.
 tpBreach: false,
 warn: false,
 })
 }
 return out
}

/* ────────────────────────────────────────────────────────────────────────── */
/* A-vs-B comparison table. */
/* ────────────────────────────────────────────────────────────────────────── */

function buildComparisonTable(r: AnalysisResult, labelA: string, labelB: string, singleFile: boolean, _mode: ReportMode): string {
 const rows: string[] = []
 const addRow = (label: string, a: string, b: string, diff: string, qual?: 'better' | 'worse' | '') => {
 if (singleFile) {
 rows.push(`<tr><td>${escapeHtml(label)}</td><td class="num">${escapeHtml(b)}</td></tr>`)
 } else {
 const cls = qual === 'better' ? 'diff-better' : qual === 'worse' ? 'diff-worse' : ''
 rows.push(
 `<tr><td>${escapeHtml(label)}</td><td class="num ref">${escapeHtml(a)}</td><td class="num comp">${escapeHtml(b)}</td><td class="num ${cls}">${escapeHtml(diff)}</td></tr>`
 )
 }
 }

 // Length (ms-precise, label/ops cares)
 const da = r.duration_sec_a ?? r.duration_sec
 const db = r.duration_sec_b ?? r.duration_sec
 if (da != null || db != null) {
 addRow('Length', da != null ? fmtLen(da) : '—', db != null ? fmtLen(db) : '—',
 da != null && db != null ? fmtLenDelta(db - da) : '—')
 }

 const la = r.overall.lufs_a, lb = r.overall.lufs_b
 addRow('Integrated loudness', `${la.toFixed(1)} LUFS`, `${lb.toFixed(1)} LUFS`, fmtSigned(lb - la, 'dB'))

 if (r.overall.short_term_max_a != null && r.overall.short_term_max_b != null) {
 addRow('Short-term max (3 s)', `${r.overall.short_term_max_a.toFixed(1)} LUFS`,
 `${r.overall.short_term_max_b.toFixed(1)} LUFS`,
 fmtSigned(r.overall.short_term_max_b - r.overall.short_term_max_a, 'dB'))
 }

 if (r.headroom) {
 const a = r.headroom.true_peak_a, b = r.headroom.true_peak_b
 addRow('True peak', `${a.toFixed(1)} dBTP`, `${b.toFixed(1)} dBTP`, fmtSigned(b - a, 'dB'),
 b > -1 ? 'worse' : b <= -1 ? 'better' : '')
 }

 addRow('Dynamic range (LRA)',
 `${r.overall.dynamics_a.toFixed(1)} LU`,
 `${r.overall.dynamics_b.toFixed(1)} LU`,
 fmtSigned(r.overall.dynamics_b - r.overall.dynamics_a, 'LU'))

 if (r.overall.plr_a != null && r.overall.plr_b != null) {
 addRow('Crest (PLR)', `${r.overall.plr_a.toFixed(1)} dB`, `${r.overall.plr_b.toFixed(1)} dB`,
 fmtSigned(r.overall.plr_b - r.overall.plr_a, 'dB'))
 }

 addRow('Stereo image', describeWidth(r.overall.width_a), describeWidth(r.overall.width_b),
 widthDelta(r.overall.width_a, r.overall.width_b))

 if (r.mono_compat) {
 const riskA = (r.mono_compat as any).risk_a ?? r.mono_compat.mono_loss_a_pct
 const riskB = (r.mono_compat as any).risk_b ?? r.mono_compat.mono_loss_b_pct
 addRow('Mono-compat risk', `${Math.round(riskA)}`, `${Math.round(riskB)}`, fmtSigned(riskB - riskA, ''),
 riskB > riskA + 5 ? 'worse' : riskB < riskA - 5 ? 'better' : '')
 }

 return rows.join('')
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Tonal balance — rolls up the tonal_issues / tonal-region observations  */
/* the analyser flagged. One row per affected region with a plain-English */
/* explanation engineers can act on without translating from numbers.     */
/* ────────────────────────────────────────────────────────────────────────── */

function buildTonalBalance(r: AnalysisResult, mode: ReportMode): string {
  const issues = r.tonal_issues || []
  if (issues.length === 0) return ''
  // Drop very-mild deviations — clutter without action value.
  const meaningful = issues.filter(i => Math.abs(i.diff ?? 0) >= 0.4)
  if (meaningful.length === 0) return ''
  // Sort by absolute deviation so the worst row reads first.
  const sorted = [...meaningful].sort(
    (a, b) => Math.abs(b.diff ?? 0) - Math.abs(a.diff ?? 0)
  ).slice(0, 6)

  const rows = sorted.map(i => {
    const diff = i.diff ?? 0
    const direction = diff > 0 ? 'too bright' : 'too dark'
    const region = i.name || 'Region'
    const freqRange = i.freq_range || ''
    const numCls = Math.abs(diff) >= 2 ? 'bad' : Math.abs(diff) >= 1 ? 'warn' : 'ok'
    const numTxt = `${diff > 0 ? '+' : ''}${diff.toFixed(1)} dB`
    const text = mode === 'engineer'
      ? `${region} · ${freqRange} · ${direction}`
      : tonalExplain(region, diff)
    return `<div class="obs-row">
  <div class="label">${escapeHtml(region)}${freqRange ? ` <span style="color:#8d867b;font-weight:400;font-size:9pt">(${escapeHtml(freqRange)})</span>` : ''}</div>
  <div class="text">${escapeHtml(text)}</div>
  <div class="num ${numCls}">${escapeHtml(numTxt)}</div>
</div>`
  }).join('')

  return `<h2>Tonal balance · vs reference</h2>
<p style="font-size:9.5pt;color:#7a7164;margin:-4pt 0 6pt;font-style:italic">${
    mode === 'engineer'
      ? 'Per-region spectrum delta vs reference profile. Δ in dB.'
      : 'How the master\'s tonal balance compares to the reference. The number is how many dB louder or quieter that region is than it should be.'
  }</p>
<div class="obs-block">${rows}</div>`
}

function tonalExplain(region: string, diff: number): string {
  const tooMuch = diff > 0
  const map: Record<string, [string, string]> = {
    Sub:        ['Bottom end is heavier than the reference. Tighten the sub.',
                 'Bottom end is lighter than the reference. The track may feel thin on big speakers.'],
    Bass:       ['Bass region is louder than the reference. Risk of mud and "boom".',
                 'Bass region is quieter than the reference. Track may feel weak.'],
    'Low Mid':  ['Low-mids are pushed forward. Can sound boxy, "cardboard" texture.',
                 'Low-mids are scooped. Track may feel hollow, lacking body.'],
    Mid:        ['Mid range is forward — vocals and leads dominate.',
                 'Mids sit too far back — vocals lose presence.'],
    Presence:   ['Presence range is hot. Risk of harshness and ear-fatigue.',
                 'Presence range is dull. Vocals lack clarity, snare lacks snap.'],
    High:       ['Highs are bright vs reference. Edge of brittle.',
                 'Highs are dark vs reference. Cymbals lack air, mix sounds dull.'],
    Air:        ['Air band is over the reference. Sibilance + cymbal ring.',
                 'Air band is shy. Mix lacks expensive sheen.'],
  }
  const pair = map[region]
  if (!pair) return tooMuch
    ? `${region} is louder than the reference by about ${Math.abs(diff).toFixed(1)} dB.`
    : `${region} is quieter than the reference by about ${Math.abs(diff).toFixed(1)} dB.`
  return tooMuch ? pair[0] : pair[1]
}


/* ────────────────────────────────────────────────────────────────────────── */
/* Stereo / Mono / Phase — how the master translates outside studio-stereo. */
/* Pulls broadband correlation, mono-fold-down loss, and the worst per-band */
/* phase / fold-down rows. The "what it means" column is plain-language —   */
/* phone speakers, club PA, headphones — what the engineer's listener gets. */
/* ────────────────────────────────────────────────────────────────────────── */

function buildStereoMonoPhase(r: AnalysisResult, labelB: string, mode: ReportMode): string {
  const rows: string[] = []
  const mc = r.mono_compat
  if (mc) {
    const corrB = mc.correlation_b
    const lossB = mc.mono_loss_b_pct
    if (Number.isFinite(corrB)) {
      const cls = corrB >= 0.6 ? 'ok' : corrB >= 0.3 ? 'warn' : 'bad'
      rows.push(rowHTML(
        'Phase correlation',
        mode === 'engineer'
          ? `Broadband correlation across ${escapeHtml(labelB)}.`
          : 'How well the left and right channels agree. +1 = mono, 0 = uncorrelated, −1 = anti-phase.',
        corrB.toFixed(2), cls,
      ))
    }
    if (Number.isFinite(lossB)) {
      const cls = lossB <= 8 ? 'ok' : lossB <= 18 ? 'warn' : 'bad'
      rows.push(rowHTML(
        'Mono fold-down loss',
        mode === 'engineer'
          ? `Energy lost when summed to mono.`
          : 'How much energy disappears when listeners are on phones, Bluetooth speakers, or in clubs (everything sums to mono).',
        `${lossB.toFixed(0)}%`, cls,
      ))
    }
    // Worst per-band loss
    const worst = (mc.bands_b || []).reduce<MonoBand | null>(
      (w, b) => (b.loss_pct > (w?.loss_pct || 0) ? b : w), null,
    )
    if (worst && worst.loss_pct >= 15) {
      const cls = worst.loss_pct >= 30 ? 'bad' : 'warn'
      rows.push(rowHTML(
        `Worst mono band: ${escapeHtml(worst.name)}`,
        mode === 'engineer'
          ? `${escapeHtml(worst.freq_range)} · loss ${worst.loss_pct.toFixed(0)}% · note: ${escapeHtml(worst.note || '—')}`
          : `The ${worst.name.toLowerCase()} band loses ${worst.loss_pct.toFixed(0)}% in mono — the part of the mix most likely to disappear on phone speakers.`,
        `${worst.loss_pct.toFixed(0)}%`, cls,
      ))
    }
  }
  // Top phase-band issues from phase_bands_b
  const pb = r.phase_bands_b || []
  const worstPhase = pb
    .filter(b => Number.isFinite(b.correlation) && b.correlation < 0.3)
    .sort((a, b) => a.correlation - b.correlation)
    .slice(0, 2)
  for (const w of worstPhase) {
    const cls = w.correlation < 0 ? 'bad' : 'warn'
    rows.push(rowHTML(
      `Phase band: ${escapeHtml(w.name)}`,
      mode === 'engineer'
        ? `${escapeHtml(w.freq_range)} correlation ${w.correlation.toFixed(2)}.`
        : `${w.name} band (${w.freq_range}) is ${w.correlation < 0 ? 'anti-phase' : 'weakly correlated'}. Watch for cancellation in mono.`,
      w.correlation.toFixed(2), cls,
    ))
  }

  if (rows.length === 0) return ''
  return `<h2>Stereo · mono · phase</h2>
<div class="obs-block">${rows.join('')}</div>`
}

function rowHTML(label: string, text: string, value: string, cls: string): string {
  return `<div class="obs-row">
  <div class="label">${escapeHtml(label)}</div>
  <div class="text">${escapeHtml(text)}</div>
  <div class="num ${cls}">${escapeHtml(value)}</div>
</div>`
}


/* ────────────────────────────────────────────────────────────────────────── */
/* Audible artefacts — clicks, hum, distortion with timestamps. The         */
/* timestamp column lets the engineer jump straight to the problem in their */
/* DAW; the explainer column sells the issue to a non-technical recipient.  */
/* ────────────────────────────────────────────────────────────────────────── */

function buildArtefactsBlock(r: AnalysisResult, mode: ReportMode): string {
  const rows: string[] = []
  // High-severity clicks with timestamps.
  const hiClicks = (r.clicks || []).filter(c => c.severity === 'high').slice(0, 5)
  if (hiClicks.length > 0) {
    const stamps = hiClicks.map(c => c.time_formatted || `${c.time.toFixed(2)}s`).join(', ')
    rows.push(rowHTML(
      `Audible click${hiClicks.length === 1 ? '' : 's'} (${hiClicks.length})`,
      mode === 'engineer'
        ? `Edit point or plugin glitch suspect. Stamps: ${stamps}.`
        : `Likely edit points or plugin glitches at: ${stamps}. Worth a listen-through with the engineer.`,
      stamps.length > 24 ? stamps.slice(0, 22) + '…' : stamps,
      'bad',
    ))
  }

  // Distortion summary
  const dist = r.distortion
  if (dist && dist.severity === 'problem') {
    rows.push(rowHTML(
      'Distortion flagged',
      mode === 'engineer'
        ? `Severity ${dist.severity}. Review limiter / clipping threshold.`
        : 'The analyser flagged audible clipping or saturation segments. Worth review at mastering.',
      String(dist.severity).toUpperCase(),
      'bad',
    ))
  } else if (dist && dist.severity === 'warning') {
    rows.push(rowHTML(
      'Distortion: borderline',
      mode === 'engineer'
        ? 'Some sub-clip events. Verify against tracking files.'
        : 'A handful of borderline-clip events — probably fine, but flag-worthy.',
      'WARN', 'warn',
    ))
  }

  // Hum (mains)
  if (r.hum && r.hum.severity === 'audible') {
    rows.push(rowHTML(
      `Mains hum: ${r.hum.mains} Hz`,
      mode === 'engineer'
        ? `${r.hum.summary}. Notch preset: ${r.hum.notch_preset.map(p => `${p.freq.toFixed(1)} Hz Q${p.q.toFixed(1)} ${p.gain_db.toFixed(1)} dB`).join(', ')}.`
        : `Audible mains hum at ${r.hum.mains} Hz. Likely a tracking-stage ground issue. ${r.hum.summary}.`,
      'AUDIBLE', 'bad',
    ))
  } else if (r.hum && r.hum.severity === 'subtle') {
    rows.push(rowHTML(
      `Subtle hum: ${r.hum.mains} Hz`,
      mode === 'engineer' ? r.hum.summary : 'Sub-audible mains hum present — only a problem on hi-fi systems.',
      'SUBTLE', 'warn',
    ))
  }

  // Limiter artefacts
  const la = r.limiter_artefacts
  if (la && la.severity === 'problem') {
    rows.push(rowHTML(
      'Limiter: pumping',
      mode === 'engineer'
        ? `Pump score ${la.pump_score.toFixed(2)}. Review release / threshold.`
        : 'The limiter is pumping audibly — ease the threshold or lengthen the release for more breath.',
      'PUMP', 'bad',
    ))
  }

  if (rows.length === 0) return ''
  return `<h2>Audible artefacts</h2>
<div class="obs-block">${rows.join('')}</div>`
}


/* ────────────────────────────────────────────────────────────────────────── */
/* EQ recommendations — pulls the proposed bands from EQContext and       */
/* renders one row per band with a plain-English explainer of what each   */
/* move does. The headline metric (frequency / gain / Q) is shown along   */
/* with a tonal-region label and a sentence about why the move matters.    */
/* Beta-tester ask: "the report needs the EQ recs vs reference."          */
/* ────────────────────────────────────────────────────────────────────────── */

/** Map a centre frequency in Hz to the tonal-region name engineers use
 *  in conversation. Boundaries match the regions called out elsewhere
 *  in the app (Sub / Bass / Low Mid / Mid / Presence / High / Air). */
function freqRegion(hz: number): string {
  if (hz < 60)    return 'Sub'
  if (hz < 200)   return 'Bass'
  if (hz < 500)   return 'Low Mid'
  if (hz < 2000)  return 'Mid'
  if (hz < 5000)  return 'Presence'
  if (hz < 10000) return 'High'
  return 'Air'
}

/** Q → conversational width label. Pro-Q ranges roughly 0.1 to 40;
 *  middle-of-the-road musical EQ work sits between 0.7 and 2.5. */
function qWidth(q: number): string {
  if (q < 0.7)  return 'wide'
  if (q < 1.5)  return 'medium'
  if (q < 4.0)  return 'narrow'
  return 'surgical'
}

/** Per-region intent map — what a boost / cut at this part of the
 *  spectrum does for the listener. Plain language only; no LUFS, no
 *  dBTP. Engineers reading the same row get the same intent without
 *  needing the explainer. */
const INTENT: Record<string, { boost: string; cut: string }> = {
  Sub:        { boost: 'Adds weight under 60 Hz — felt more than heard. Can crowd the kick if overdone.',
                cut:   'Tightens the bottom end. Removes rumble and DC offset that eats headroom.' },
  Bass:       { boost: 'Adds warmth and body in the bass region. Makes the track feel fuller.',
                cut:   'Less mud, less boom. The track gets cleaner and more articulate.' },
  'Low Mid':  { boost: 'Adds body to vocals and instruments — fills out the mix.',
                cut:   'Removes muddiness and "cardboard". The mid range opens up.' },
  Mid:        { boost: 'Pushes vocals and lead instruments forward — more presence.',
                cut:   'Tames "honk" or boxiness. The mids sit back and breathe.' },
  Presence:   { boost: 'Adds clarity and intelligibility. Vocals cut through, snare snaps.',
                cut:   'Tames harshness and ear-fatigue. The mix gets smoother.' },
  High:       { boost: 'Adds definition and edge to top-end percussion and air on vocals.',
                cut:   'Softens brittle highs. Less "crispy", more refined.' },
  Air:        { boost: 'Sparkle and openness above 10 kHz. Adds expensive sheen.',
                cut:   'Tames sibilance and over-bright cymbals.' },
}

function buildEqRecommendations(bands: EQBand[], mode: ReportMode): string {
  if (!bands || bands.length === 0) return ''
  // Filter out near-zero bands — anything below 0.2 dB is below the
  // perceptual threshold and just clutters the table.
  const meaningful = bands.filter(b => Math.abs(b.gain_db) >= 0.2)
  if (meaningful.length === 0) return ''
  // Sort by frequency so the table reads bass-to-treble like a Pro-Q
  // screenshot.
  const sorted = [...meaningful].sort((a, b) => a.freq - b.freq)
  return sorted.map(b => {
    const region = freqRegion(b.freq)
    const isBoost = b.gain_db > 0
    const moveTxt = `${isBoost ? '+' : ''}${b.gain_db.toFixed(1)} dB`
    const moveCls = isBoost ? 'move-pos' : 'move-neg'
    const widthLabel = qWidth(b.q)
    const widthTxt = mode === 'engineer'
      ? `Q ${b.q.toFixed(1)}`
      : `${widthLabel} (Q ${b.q.toFixed(1)})`
    const freqTxt = b.freq >= 1000
      ? `${(b.freq / 1000).toFixed(b.freq >= 10000 ? 0 : 1)} kHz`
      : `${Math.round(b.freq)} Hz`
    const intent = INTENT[region]
    const what = mode === 'engineer'
      ? (b.label ? escapeHtml(b.label) : `Peaking · ${region}`)
      : (intent ? (isBoost ? intent.boost : intent.cut) : '')
    return `<tr>
 <td class="band-name">${escapeHtml(region)}</td>
 <td class="num">${escapeHtml(freqTxt)}</td>
 <td class="num ${moveCls}">${escapeHtml(moveTxt)}</td>
 <td class="num">${escapeHtml(widthTxt)}</td>
 <td class="what">${escapeHtml(what)}</td>
</tr>`
  }).join('')
}


/* ────────────────────────────────────────────────────────────────────────── */
/* Top actions — tone flips between client (plain) and engineer (terse). */
/* ────────────────────────────────────────────────────────────────────────── */

function buildTopActions(r: AnalysisResult, _labelA: string, labelB: string, _singleFile: boolean, mode: ReportMode): { title: string; body: string }[] {
 const out: { title: string; body: string }[] = []

 if (r.headroom && r.headroom.true_peak_b > streamingTpFloorDbtp()) {
 out.push(mode === 'engineer' ? {
 title: `TP=${r.headroom.true_peak_b.toFixed(1)} dBTP, over −1 dBTP ceiling`,
 body: `Set limiter output ceiling to −1.0 dBTP and re-bounce.`,
 } : {
 title: `True-peak is ${r.headroom.true_peak_b.toFixed(1)} dBTP, over the safe ceiling`,
 body: `Inter-sample peaks this high clip on MP3/AAC transcodes. Ask the engineer to bring the limiter ceiling to −1 dBTP before final bounce.`,
 })
 } else if (r.distortion?.severity === 'problem') {
 out.push(mode === 'engineer' ? {
 title: 'Distortion: ≥1 flagged segment',
 body: 'Review clipping threshold; timestamps in detail tab.',
 } : {
 title: 'Distortion detected',
 body: 'Review the limiter and clipping threshold at mastering. We spotted segments where it\'s audible.',
 })
 }

 if (r.mono_compat && (r.mono_compat.risk_b ?? 0) > 20) {
 const worst = (r.mono_compat.bands_b || []).reduce<MonoBand | null>(
 (w, b) => (b.risk > (w?.risk || 0) ? b : w), null)
 if (worst) {
 out.push(mode === 'engineer' ? {
 title: `Mono loss ${worst.name}: ${worst.loss_pct.toFixed(0)}%`,
 body: `Tighten stereo image in the ${worst.name.toLowerCase()} band.`,
 } : {
 title: `${worst.name} band loses ${worst.loss_pct.toFixed(0)}% in mono`,
 body: `Most listeners are on phones, Bluetooth, or in clubs; all sum to mono. Tighten stereo below 200 Hz.`,
 })
 }
 }

 const hiClicks = (r.clicks || []).filter(c => c.severity === 'high')
 if (hiClicks.length > 0) {
 const stamps = hiClicks.slice(0, 3).map(c => c.time_formatted || `${c.time.toFixed(2)}s`).join(', ')
 out.push(mode === 'engineer' ? {
 title: `${hiClicks.length} audible click${hiClicks.length > 1 ? 's' : ''}: ${stamps}${hiClicks.length > 3 ? '…' : ''}`,
 body: `Edit points or plugin glitches. See detail tab for full list.`,
 } : {
 title: `${hiClicks.length} audible click${hiClicks.length > 1 ? 's' : ''} to verify`,
 body: `Likely edits or plugin glitches. Timestamps are in the detailed report.`,
 })
 }

 const lufsDiff = r.overall.lufs_b - r.overall.lufs_a
 if (Math.abs(lufsDiff) > 2) {
 out.push(mode === 'engineer' ? {
 title: `LUFS Δ=${lufsDiff > 0 ? '+' : ''}${lufsDiff.toFixed(1)} dB vs ref`,
 body: lufsDiff > 0
 ? `Pull limiter ceiling / release back; preview platform normalisation.`
 : `Push master 1-2 dB; check TP post-push.`,
 } : {
 title: lufsDiff > 0
 ? `${labelB} is ${Math.abs(lufsDiff).toFixed(1)} dB louder than the reference`
 : `${labelB} is ${Math.abs(lufsDiff).toFixed(1)} dB quieter than the reference`,
 body: lufsDiff > 0
 ? `Every major platform will turn this down. Consider backing the limiter off so the mix breathes more.`
 : `Next to the reference in a playlist, this will sound underwhelming. A gentle loudness push (2–3 dB) would help.`,
 })
 }

 const dynDiff = r.overall.dynamics_b - r.overall.dynamics_a
 if (Math.abs(dynDiff) > 3) {
 out.push(mode === 'engineer' ? {
 title: `LRA Δ=${dynDiff > 0 ? '+' : ''}${dynDiff.toFixed(1)} LU vs ref`,
 body: dynDiff < 0
 ? `Release compressor / reduce limiting.`
 : `Add glue compression to tighten dynamics.`,
 } : {
 title: dynDiff < 0
 ? `${Math.abs(dynDiff).toFixed(1)} LU less dynamic than the reference`
 : `${Math.abs(dynDiff).toFixed(1)} LU more dynamic than the reference`,
 body: dynDiff < 0
 ? `Over-compressed. Ease off the bus compressor / limiter for more breathing room.`
 : `More dynamic. Gentle glue compression would help it land with similar impact.`,
 })
 }

 if (out.length === 0) {
 out.push(mode === 'engineer' ? {
 title: 'No blocking issues',
 body: 'Standard QC pass before delivery.',
 } : {
 title: `${labelB} is in great shape`,
 body: 'No major blockers detected. Standard QC pass recommended before final delivery.',
 })
 }

 return out.slice(0, 4)
}

/* ────────────────────────────────────────────────────────────────────────── */
/* File identity — the deliverable-receipt block. */
/* ────────────────────────────────────────────────────────────────────────── */

function buildFileIdentity(r: AnalysisResult, fileB: FileInfo, identity: FileIdentity | null): string {
 const rows: { k: string; v: string; muted?: boolean }[] = []
 rows.push({ k: 'Filename', v: fileB.name })
 const dur = r.duration_sec_b ?? r.duration_sec
 if (dur != null) rows.push({ k: 'Length', v: fmtLen(dur) })
 // Pull SR/BD/channels from batch-style backend if present, otherwise from
 // Reference-check/metadata. For the normal 2-file flow we just have the
 // file's native length from the backend; SR/BD might need a probe. Keep
 // the field optional.
 const meta = (r as any).metadata as any
 if (meta?.format) {
 const sr = meta.format.sample_rate
 const bd = meta.format.bit_depth
 if (sr || bd) rows.push({ k: 'Format', v: `${sr ? `${sr} Hz` : ''}${sr && bd ? ' · ' : ''}${bd ? `${bd}-bit` : ''}` })
 }
 // ISRC / UPC from metadata readers.
 const isrc = meta?.isrc || meta?.ISRC
 const upc = meta?.upc || meta?.UPC || meta?.barcode
 // ISRC missing-flag disabled by user direction — only render when present.
 if (isrc) rows.push({ k: 'ISRC', v: isrc })
 if (upc) rows.push({ k: 'UPC', v: upc })
 if (identity) {
 rows.push({ k: 'Size', v: fmtBytes(identity.size) })
 rows.push({ k: 'Modified', v: identity.mtime_iso })
 rows.push({ k: 'SHA-256', v: identity.sha256 })
 }
 rows.push({ k: 'Path', v: fileB.path, muted: true })
 return rows.map(r => `
 <div class="identity-row">
 <span class="k">${escapeHtml(r.k)}</span>
 <span class="v${r.muted ? ' muted' : ''}">${escapeHtml(r.v)}</span>
 </div>
 `).join('')
}

function buildStandardsBlock(r: AnalysisResult): string {
 const specs = r.spec_versions?.specs
 if (!specs) return ''
 return Object.values(specs).map(spec => `
 <div class="standard-row">
 <span class="name">${escapeHtml(spec.name)}</span>
 <span class="version">${escapeHtml(spec.version)}</span>
 <span class="date">${escapeHtml(spec.published)}</span>
 <span class="flag">${spec.provisional ? 'Provisional' : ''}</span>
 </div>
 `).join('')
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function describeWidth(w: number): string {
 if (w == null || isNaN(w as number)) return '—'
 if (w < 0.03) return 'Near mono'
 if (w < 0.08) return 'Tight'
 if (w < 0.15) return 'Balanced'
 if (w < 0.25) return 'Wide'
 return 'Very wide'
}
function widthDelta(a: number, b: number): string {
 const da = describeWidth(a), db = describeWidth(b)
 if (da === db) return 'Same'
 if ((b - a) > 0.02) return 'Wider'
 if ((b - a) < -0.02) return 'Narrower'
 return 'Same'
}
function fmtSigned(v: number, unit: string): string {
 if (isNaN(v)) return '—'
 const sign = v > 0 ? '+' : ''
 return `${sign}${v.toFixed(1)}${unit ? ' ' + unit : ''}`
}
function fmtLen(sec: number): string {
 const m = Math.floor(sec / 60)
 const s = Math.floor(sec - m * 60)
 const ms = Math.round((sec - m * 60 - s) * 1000)
 return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`
}
function fmtLenDelta(ds: number): string {
 const ms = Math.round(ds * 1000)
 if (ms === 0) return '—'
 const sign = ms > 0 ? '+' : '−'
 const abs = Math.abs(ms)
 if (abs < 1000) return `${sign}${abs} ms`
 const w = Math.floor(abs / 1000), r = abs % 1000
 return `${sign}${w}.${r.toString().padStart(3, '0')} s`
}
function fmtBytes(n: number): string {
 if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
 if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`
 return `${n} B`
}
function escapeHtml(s: string): string {
 return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
