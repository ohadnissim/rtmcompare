import React, { useCallback } from 'react'
import { AnalysisResult, FileInfo } from '../types'

interface Props {
 results: AnalysisResult
 fileA: FileInfo
 fileB: FileInfo
}

export default function ExportButton({ results, fileA, fileB }: Props) {
 const handleExport = useCallback(() => {
 const labelA = fileA.name.replace(/\.[^/.]+$/, '')
 const labelB = fileB.name.replace(/\.[^/.]+$/, '')
 const html = generateReport(results, labelA, labelB)

 const blob = new Blob([html], { type: 'text/html' })
 const url = URL.createObjectURL(blob)
 const a = document.createElement('a')
 a.href = url
 a.download = `rtm-suite-${labelA}-vs-${labelB}.html`
 a.click()
 URL.revokeObjectURL(url)
 }, [results, fileA, fileB])

 return (
 <button
 onClick={handleExport}
 className="flex items-center gap-2 px-4 py-2 rounded-lg bg-dark-700 hover:bg-dark-600 transition-colors text-sm text-dark-200"
 >
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
 </svg>
 Download Report (HTML)
 </button>
 )
}

function escapeHtml(s: string): string {
 return s
 .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
 .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function generateReport(results: AnalysisResult, labelA: string, labelB: string): string {
 const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

 const categoriesHtml = results.categories.map(cat => `
 <div class="cat-card">
 <div class="cat-header">
 <strong>${cat.name}</strong>
 <span class="badge ${cat.level_diff > 0.3 ? 'up' : cat.level_diff < -0.3 ? 'down' : 'same'}">
 ${Math.abs(cat.level_diff) < 0.3 ? '=' : `${cat.level_diff > 0 ? '+' : ''}${cat.level_diff.toFixed(1)} dB`}
 </span>
 </div>
 <p>${cat.insight}</p>
 </div>
 `).join('')

 const issuesHtml = results.distortion ? results.distortion.issues.map(i =>
 `<li>${i}</li>`
 ).join('') : '<li>No distortion data</li>'

 const distRecsHtml = results.distortion?.recommendations?.map(r =>
 `<li>${r}</li>`
 ).join('') || ''

 const clicksHtml = results.clicks?.length > 0
 ? results.clicks.map(c =>
 `<tr><td>${c.time_formatted}</td><td class="${c.severity}">${c.severity.toUpperCase()}</td><td>${c.description}</td></tr>`
 ).join('')
 : '<tr><td colspan="3">No clicks or glitches detected</td></tr>'

 const recsHtml = results.recommendations?.map(r => `
 <div class="rec ${r.priority}">
 <span class="rec-badge">${r.priority.toUpperCase()}</span>
 <strong>${r.area}</strong>: ${r.action}
 </div>
 `).join('') || ''

 const monoHtml = results.mono_compat ? `
 <div class="section">
 <h2>Mono Compatibility</h2>
 <table>
 <tr><th>Band</th><th>Impact</th><th>${labelA} corr/loss</th><th>${labelB} corr/loss</th></tr>
 ${(results.mono_compat.bands_a || []).map((ba, i) => {
 const bb = (results.mono_compat!.bands_b || [])[i]
 return `<tr>
 <td>${ba.name} <span style="color:#888">(${ba.freq_range})</span></td>
 <td>${'●'.repeat(Math.round(ba.impact))}</td>
 <td>${ba.correlation.toFixed(2)} / ${ba.loss_pct.toFixed(1)}%</td>
 <td>${bb ? `${bb.correlation.toFixed(2)} / ${bb.loss_pct.toFixed(1)}%` : ''}</td>
 </tr>`
 }).join('')}
 </table>
 <p style="margin-top:10px">${results.mono_compat.insight}</p>
 </div>
 ` : ''

 const maskingHtml = results.masking && results.masking.overlaps.length > 0 ? `
 <div class="section">
 <h2>Masking Overlap${results.masking.stem_based ? ' (per-stem)' : ''}</h2>
 <table>
 <tr><th>Pair</th><th>Band</th><th>Severity</th><th>Issue</th></tr>
 ${results.masking.overlaps.map(o => `<tr>
 <td><strong>${o.pair}</strong></td>
 <td>${o.freq_range}</td>
 <td class="${o.severity}">${o.severity.toUpperCase()}</td>
 <td>${o.description}${o.tip ? `<br><em style="color:#888">→ ${o.tip}</em>` : ''}</td>
 </tr>`).join('')}
 </table>
 </div>
 ` : ''

 const phaseBandsHtml = results.phase_bands_a && results.phase_bands_a.length > 0 ? `
 <div class="section">
 <h2>Phase Correlation — Per Band</h2>
 <table>
 <tr><th>Band</th><th>${labelA}</th><th>${labelB}</th></tr>
 ${results.phase_bands_a.map((ba, i) => {
 const bb = results.phase_bands_b?.[i]
 return `<tr>
 <td>${ba.name} <span style="color:#888">(${ba.freq_range})</span></td>
 <td>${ba.correlation.toFixed(2)}</td>
 <td>${bb ? bb.correlation.toFixed(2) : ''}</td>
 </tr>`
 }).join('')}
 </table>
 </div>
 ` : ''

 const songInfo = results.reference_check?.song_info as any
 const songInfoHtml = songInfo ? `
 <div class="section">
 <h2>Song Info</h2>
 <table>
 <tr><td><strong>BPM</strong></td><td>${songInfo.bpm}</td></tr>
 <tr><td><strong>Key</strong></td><td>${songInfo.key}${songInfo.key_confidence != null ? ` <span style="color:#888">(${(songInfo.key_confidence * 100).toFixed(0)}% confidence)</span>` : ''}</td></tr>
 ${songInfo.key_alternates && songInfo.key_alternates.length > 0 ? `<tr><td><strong>Alt keys</strong></td><td style="color:#666">${songInfo.key_alternates.map((a: any) => `${a.key} (${a.score.toFixed(2)})`).join(', ')}</td></tr>` : ''}
 ${songInfo.genre && songInfo.genre.primary ? `<tr><td><strong>Genre</strong></td><td>${songInfo.genre.primary} <span style="color:#888">(${(songInfo.genre.confidence * 100).toFixed(0)}% confidence)</span></td></tr>` : ''}
 ${songInfo.tempo_drift && songInfo.tempo_drift.drift ? `<tr><td><strong>Tempo drift</strong></td><td style="color:#b8860b">${songInfo.tempo_drift.range_bpm.toFixed(1)} BPM range — variable tempo</td></tr>` : ''}
 </table>
 </div>
 ` : ''

 const metaHtml = results.metadata ? `
 <div class="section">
 <h2>File Metadata (BEXT / iXML / INFO)</h2>
 ${(['a', 'b'] as const).map(k => {
 const m = results.metadata?.[k]
 if (!m || (!m.bext && !m.ixml && !m.info)) return ''
 const label = k === 'a' ? labelA : labelB
 const rows: string[] = []
 if (m.bext) {
 if (m.bext.description) rows.push(`<tr><td>Description</td><td>${escapeHtml(m.bext.description)}</td></tr>`)
 if (m.bext.originator) rows.push(`<tr><td>Originator</td><td>${escapeHtml(m.bext.originator)}</td></tr>`)
 if (m.bext.origination_date) rows.push(`<tr><td>Date</td><td>${escapeHtml(m.bext.origination_date)} ${escapeHtml(m.bext.origination_time || '')}</td></tr>`)
 }
 if (m.info) {
 for (const [lbl, val] of Object.entries(m.info)) if (val) rows.push(`<tr><td>${lbl}</td><td>${escapeHtml(String(val))}</td></tr>`)
 }
 if (m.ixml) {
 for (const [lbl, val] of Object.entries(m.ixml)) if (val) rows.push(`<tr><td>iXML ${lbl}</td><td>${escapeHtml(String(val))}</td></tr>`)
 }
 if (rows.length === 0) return ''
 return `<h3 style="margin-top:16px;font-size:14px;color:#555">${escapeHtml(label)}</h3><table>${rows.join('')}</table>`
 }).join('')}
 </div>
 ` : ''

 const engineerTipsHtml = results.engineer_tips && results.engineer_tips.tips && results.engineer_tips.tips.length > 0 ? `
 <div class="section">
 <h2>What Would ${escapeHtml(results.engineer_tips.engineer)} Do</h2>
 <p style="color:#555;font-size:13px;margin-bottom:10px">${escapeHtml(results.engineer_tips.summary)}</p>
 ${results.engineer_tips.match_score != null ? `<p><strong>Match score: ${results.engineer_tips.match_score}/100</strong></p>` : ''}
 <table>
 <tr><th>Priority</th><th>Category</th><th>Tip</th></tr>
 ${results.engineer_tips.tips.map(t => `<tr>
 <td class="${t.priority}">${t.priority.toUpperCase()}</td>
 <td>${escapeHtml(t.category)}</td>
 <td>${escapeHtml(t.tip)}<br><em style="color:#888;font-size:11px">${escapeHtml(t.detail)}</em></td>
 </tr>`).join('')}
 </table>
 ${results.engineer_tips.eq_filters && results.engineer_tips.eq_filters.length > 0 ? `
 <h3 style="margin-top:12px;font-size:14px">Recommended EQ Moves</h3>
 <table>
 <tr><th>Band</th><th>Frequency</th><th>Gain</th><th>Q</th><th>Shape</th></tr>
 ${results.engineer_tips.eq_filters.map(f => `<tr>
 <td>${escapeHtml(f.region)}</td>
 <td>${f.freq >= 1000 ? (f.freq/1000).toFixed(f.freq >= 10000 ? 0 : 1) + ' kHz' : f.freq + ' Hz'}</td>
 <td>${f.gain_db > 0 ? '+' : ''}${f.gain_db} dB</td>
 <td>${f.q.toFixed(1)}</td>
 <td style="color:#666">${escapeHtml((f as any).q_note || '')}</td>
 </tr>`).join('')}
 </table>
 ` : ''}
 </div>
 ` : ''

 const headroomHtml = results.headroom ? `
 <div class="section">
 <h2>Loudness & Headroom</h2>
 <table>
 <tr><th></th><th>${labelA}</th><th>${labelB}</th><th>Diff</th></tr>
 <tr><td><strong>Integrated</strong></td><td>${results.overall.lufs_a.toFixed(1)} LUFS</td><td>${results.overall.lufs_b.toFixed(1)} LUFS</td><td>${(results.overall.lufs_b - results.overall.lufs_a).toFixed(1)}</td></tr>
 ${results.overall.short_term_max_a != null && results.overall.short_term_max_b != null ? `<tr><td><strong>Short-term Max</strong></td><td>${results.overall.short_term_max_a.toFixed(1)} LUFS</td><td>${results.overall.short_term_max_b.toFixed(1)} LUFS</td><td>${(results.overall.short_term_max_b - results.overall.short_term_max_a).toFixed(1)}</td></tr>` : ''}
 <tr><td><strong>True Peak</strong></td><td>${results.headroom.true_peak_a.toFixed(1)} dBTP</td><td>${results.headroom.true_peak_b.toFixed(1)} dBTP</td><td>${(results.headroom.true_peak_b - results.headroom.true_peak_a).toFixed(1)}</td></tr>
 <tr><td><strong>LRA</strong></td><td>${results.overall.dynamics_a.toFixed(1)} LU</td><td>${results.overall.dynamics_b.toFixed(1)} LU</td><td>${(results.overall.dynamics_b - results.overall.dynamics_a).toFixed(1)}</td></tr>
 ${results.overall.plr_a != null && results.overall.plr_b != null ? `<tr><td><strong>PLR</strong></td><td>${results.overall.plr_a.toFixed(1)} dB</td><td>${results.overall.plr_b.toFixed(1)} dB</td><td>${(results.overall.plr_b - results.overall.plr_a).toFixed(1)}</td></tr>` : ''}
 </table>
 </div>
 ` : ''

 return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>RTMcompare · A/B Report — ${labelA} vs ${labelB}</title>
<style>
 * { margin: 0; padding: 0; box-sizing: border-box; }
 body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff; color: #1a1a2e; padding: 40px; max-width: 900px; margin: 0 auto; line-height: 1.6; }
 h1 { font-size: 24px; margin-bottom: 4px; }
 h2 { font-size: 18px; margin-bottom: 12px; color: #333; border-bottom: 2px solid #f59e0b; padding-bottom: 6px; }
 .meta { color: #666; font-size: 13px; margin-bottom: 30px; }
 .section { margin-bottom: 32px; }
 .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
 .summary-box { background: #f8f8f8; border-radius: 8px; padding: 16px; text-align: center; }
 .summary-box .label { font-size: 11px; text-transform: uppercase; color: #888; }
 .summary-box .value { font-size: 20px; font-weight: 700; color: #f59e0b; margin: 4px 0; }
 .summary-box .sub { font-size: 11px; color: #999; }
 .cat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
 .cat-card { background: #f8f8f8; border-radius: 8px; padding: 12px; }
 .cat-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
 .cat-card p { font-size: 12px; color: #555; }
 .badge { font-size: 11px; font-family: monospace; padding: 2px 8px; border-radius: 10px; }
 .badge.up { background: #d1fae5; color: #065f46; }
 .badge.down { background: #fef3c7; color: #92400e; }
 .badge.same { background: #f3f4f6; color: #6b7280; }
 table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 12px; }
 th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #eee; }
 th { font-weight: 600; background: #f8f8f8; }
 .high { color: #dc2626; font-weight: 600; }
 .medium { color: #d97706; font-weight: 600; }
 .low { color: #6b7280; }
 .rec { padding: 10px; margin-bottom: 8px; border-radius: 6px; font-size: 12px; border-left: 3px solid; }
 .rec.high { background: #fef2f2; border-color: #dc2626; }
 .rec.medium { background: #fffbeb; border-color: #d97706; }
 .rec.low { background: #f0fdf4; border-color: #16a34a; }
 .rec-badge { font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 3px; margin-right: 6px; }
 .rec.high .rec-badge { background: #fecaca; color: #dc2626; }
 .rec.medium .rec-badge { background: #fde68a; color: #92400e; }
 .rec.low .rec-badge { background: #bbf7d0; color: #166534; }
 .level-match { display: inline-block; background: #d1fae5; color: #065f46; font-size: 12px; padding: 4px 12px; border-radius: 20px; margin-bottom: 20px; }
 ul { padding-left: 20px; font-size: 13px; }
 li { margin-bottom: 4px; }
 .insights p { font-size: 13px; color: #555; margin-bottom: 4px; }
 @media print { body { padding: 20px; } }
</style>
</head>
<body>
 <h1>RTMcompare · A/B Report</h1>
 <p class="meta">${labelA} vs ${labelB} &mdash; ${date}</p>

 ${results.level_matched ? `<div class="level-match">&#10003; Level-matched (${Math.abs(results.gain_applied_db).toFixed(1)} dB applied)</div>` : ''}

 <div class="section">
 <h2>Overall Summary</h2>
 <div class="summary-grid">
 <div class="summary-box">
 <div class="label">Loudness</div>
 <div class="value">${results.overall.loudness_diff > 0 ? '+' : ''}${results.overall.loudness_diff.toFixed(1)} dB</div>
 <div class="sub">${results.overall.loudness_diff > 0 ? `${labelB} is louder` : 'Similar'}</div>
 </div>
 <div class="summary-box">
 <div class="label">Stereo Width</div>
 <div class="value">${Math.abs(results.overall.width_b - results.overall.width_a) < 0.03 ? 'Similar' : results.overall.width_b > results.overall.width_a ? 'Wider' : 'Narrower'}</div>
 <div class="sub">${(Math.abs(results.overall.width_b - results.overall.width_a) * 100).toFixed(0)}% difference</div>
 </div>
 <div class="summary-box">
 <div class="label">Dynamics</div>
 <div class="value">${Math.abs(results.overall.dynamics_b - results.overall.dynamics_a) < 0.5 ? 'Similar' : results.overall.dynamics_b < results.overall.dynamics_a ? 'More compressed' : 'More dynamic'}</div>
 <div class="sub">${Math.abs(results.overall.dynamics_b - results.overall.dynamics_a).toFixed(1)} dB range diff</div>
 </div>
 </div>
 <div class="insights">
 ${results.overall.insights.map(i => `<p>${i}</p>`).join('')}
 </div>
 </div>

 <div class="section">
 <h2>Detailed Breakdown</h2>
 <div class="cat-grid">${categoriesHtml}</div>
 </div>

 ${headroomHtml}
 ${songInfoHtml}
 ${monoHtml}
 ${phaseBandsHtml}
 ${maskingHtml}
 ${engineerTipsHtml}
 ${metaHtml}

 <div class="section">
 <h2>Distortion Check${results.distortion ? ` — ${results.distortion.severity.toUpperCase()}` : ''}</h2>
 <ul>${issuesHtml}</ul>
 ${distRecsHtml ? `<h3 style="margin-top:12px;font-size:14px;">How to fix</h3><ul>${distRecsHtml}</ul>` : ''}
 </div>

 <div class="section">
 <h2>Clicks & Glitches</h2>
 <table>
 <tr><th>Time</th><th>Severity</th><th>Description</th></tr>
 ${clicksHtml}
 </table>
 </div>

 <div class="section">
 <h2>Recommendations</h2>
 ${recsHtml}
 </div>

 <div style="margin-top:40px;padding-top:20px;border-top:1px solid #eee;font-size:11px;color:#999;text-align:center;">
 Generated by RTMcompare &mdash; ${date}
 </div>
</body>
</html>`
}
