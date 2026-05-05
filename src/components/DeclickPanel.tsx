import React, { useState, useCallback } from 'react'
import { DeclickResult } from '../types'

/**
 * RTM De-click — RX-inspired panel for python/declick.py.
 *
 * Visually pinned to the iZotope RX De-click control layout (algorithm
 * dropdown at the top, three numeric sliders, bottom action row) but
 * wearing the RTM black / cream / gold palette. All numeric values stay
 * in sync between slider and the trailing numeric box; changing either
 * updates the underlying param state.
 *
 * The panel calls two Electron IPC handlers:
 *   declickPreview  — runs against the first 10 s of audio, repair mode,
 *                     writes to ~/.rtm/declick-preview.wav for A/B.
 *   declickProcess  — full-length render to a user-chosen path. When
 *                     "Output clicks only" is checked we force mode
 *                     to 'clicks' so the WAV is just the isolated
 *                     impulses, which is how RX's Output > clicks
 *                     debug render behaves.
 */

type Algorithm = 'multiband' | 'singleband' | 'wideband'
type Mode = 'repair' | 'clicks' | 'list'

interface Props {
 filePath: string
 onRendered?: (outPath: string) => void
}

const ALGORITHMS: { value: Algorithm; label: string }[] = [
 { value: 'multiband', label: 'Multi-band (random clicks)' },
 { value: 'singleband', label: 'Single-band (periodic)' },
 { value: 'wideband', label: 'Wide-band (broadband ticks)' },
]

// RTM palette — mirrors the values used across the existing panels so
// this module lives next to AIDetectionPanel without feeling like an
// import from another app. Kept at module scope so helper components
// below (SliderRow / StatCell / BypassToggle) can reach them without
// prop-drilling.
const BG = '#0a0a0a'
const INK = '#ebe7e0'
const GOLD = '#d0b066'
const GOLD_DIM = 'rgba(208,176,102,0.25)'
const MUTED = '#8d867b'
const PANEL = '#151411'
const HAIRLINE = 'rgba(208,176,102,0.18)'
const TRACK = '#2a2722'

export default function DeclickPanel({ filePath, onRendered }: Props) {
 const [algorithm, setAlgorithm] = useState<Algorithm>('multiband')
 const [sensitivity, setSensitivity] = useState(2.6)
 const [skew, setSkew] = useState(0.0)
 const [widenMs, setWidenMs] = useState(0.0)
 const [clicksOnly, setClicksOnly] = useState(false)
 const [bypass, setBypass] = useState(false)
 const [busy, setBusy] = useState(false)
 const [status, setStatus] = useState<string | null>(null)
 const [lastResult, setLastResult] = useState<DeclickResult | null>(null)
 const [lastPreviewPath, setLastPreviewPath] = useState<string | null>(null)
 const [compareOriginal, setCompareOriginal] = useState(false)
 const [error, setError] = useState<string | null>(null)

 const paramsSnapshot = useCallback((mode: Mode) => ({
 inPath: filePath,
 algorithm,
 sensitivity,
 skew,
 widenMs,
 mode,
 }), [filePath, algorithm, sensitivity, skew, widenMs])

 const onPreview = useCallback(async () => {
 if (!window.electronAPI?.declickPreview) {
 setError('Preview requires the Electron host.')
 return
 }
 if (bypass) {
 setStatus('Bypass is on. Turn it off to run preview.')
 return
 }
 setBusy(true); setError(null); setStatus('Rendering preview...')
 try {
 const res = await window.electronAPI.declickPreview(paramsSnapshot('repair'))
 setLastResult(res)
 setLastPreviewPath(res.output_path ?? null)
 const outLabel = res.output_path
 ? res.output_path.replace(/^.*\.rtm\//, '~/.rtm/')
 : 'preview WAV'
 setStatus(`Found ${res.click_count} clicks. Preview written to ${outLabel}`)
 } catch (err: any) {
 setError(err?.message || 'Preview failed.')
 setStatus(null)
 } finally {
 setBusy(false)
 }
 }, [paramsSnapshot, bypass])

 const onRender = useCallback(async () => {
 if (!window.electronAPI?.declickProcess) {
 setError('Render requires the Electron host.')
 return
 }
 if (bypass) {
 setStatus('Bypass is on. Turn it off to render.')
 return
 }
 // Suggest an output path next to the input. Swap the extension for
 // .declicked.wav (or .clicks.wav if output-clicks-only is checked).
 const baseName = filePath.replace(/\.[^.]+$/, '')
 const suffix = clicksOnly ? '.clicks.wav' : '.declicked.wav'
 const suggested = `${baseName}${suffix}`

 let outPath: string | null = suggested
 // Prefer the existing save-path dialog when present — matches the
 // pattern in EQExportButton / MasterAssistantPanel. Fall back to
 // writing next to the input, per the task constraint.
 if (window.electronAPI?.pickSavePath) {
 const picked = await window.electronAPI.pickSavePath(
 suggested.split('/').pop() || 'output.wav',
 [{ name: 'WAV', extensions: ['wav'] }],
 )
 if (!picked) return // user cancelled
 outPath = picked
 }

 const mode: Mode = clicksOnly ? 'clicks' : 'repair'
 setBusy(true); setError(null); setStatus('Rendering...')
 try {
 const res = await window.electronAPI.declickProcess({
 ...paramsSnapshot(mode),
 outPath: outPath || undefined,
 })
 setLastResult(res)
 const outLabel = res.output_path || outPath || 'output.wav'
 setStatus(`Rendered ${res.click_count} clicks to ${outLabel}`)
 if (res.output_path && onRendered) onRendered(res.output_path)
 } catch (err: any) {
 setError(err?.message || 'Render failed.')
 setStatus(null)
 } finally {
 setBusy(false)
 }
 }, [paramsSnapshot, clicksOnly, bypass, filePath, onRendered])

 const onCompare = useCallback(() => {
 // Compare toggles between the preview WAV and the original source
 // in whatever external player the host wires up. No preview yet?
 // Prompt the user to run preview first.
 if (!lastPreviewPath) {
 setStatus('Run Preview first to generate a clip to A/B against.')
 return
 }
 setCompareOriginal(v => !v)
 setStatus(compareOriginal
 ? `Comparing against preview: ${lastPreviewPath}`
 : `Comparing against original source.`)
 }, [lastPreviewPath, compareOriginal])

 // % of total samples the repair touched — surfaced as a compact strip
 // at the bottom so users can gauge how aggressive the process was.
 const repairedPct = lastResult && lastResult.duration_sec > 0
 ? (lastResult.samples_repaired / Math.max(1, lastResult.duration_sec * 48000)) * 100
 : null

 return (
 <div
 className="rounded-2xl p-6 space-y-5"
 style={{
 backgroundColor: BG,
 border: `1px solid ${HAIRLINE}`,
 color: INK,
 }}
 >
 <div className="flex items-center justify-between">
 <div>
 <h3 className="text-lg font-semibold tracking-wide" style={{ color: INK }}>
 RTM De-click
 </h3>
 <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>
 RX-style impulse removal. Repairs clicks, pops, and digital ticks.
 </p>
 </div>
 {busy && <Spinner />}
 </div>

 {/* Algorithm dropdown */}
 <div className="space-y-1.5">
 <label className="text-[10px] uppercase tracking-[0.15em]" style={{ color: MUTED }}>
 Algorithm
 </label>
 <select
 value={algorithm}
 disabled={busy}
 onChange={(e) => setAlgorithm(e.target.value as Algorithm)}
 className="w-full px-3 py-2 rounded-lg text-sm outline-none"
 style={{
 backgroundColor: PANEL,
 color: INK,
 border: `1px solid ${HAIRLINE}`,
 }}
 >
 {ALGORITHMS.map(a => (
 <option key={a.value} value={a.value}>{a.label}</option>
 ))}
 </select>
 </div>

 {/* Sensitivity slider 0.0 - 10.0 step 0.1 default 2.6 */}
 <SliderRow
 label="Sensitivity"
 min={0.0}
 max={10.0}
 step={0.1}
 value={sensitivity}
 onChange={setSensitivity}
 disabled={busy}
 unit=""
 hint="How far above the rolling baseline a sample has to land before it's flagged."
 />

 {/* Frequency skew -4.0 to +4.0 step 0.1 default 0.0 */}
 <div className="space-y-1.5">
 <SliderRow
 label="Frequency skew"
 min={-4.0}
 max={4.0}
 step={0.1}
 value={skew}
 onChange={setSkew}
 disabled={busy}
 unit=""
 hint="Bias detection toward low or high frequencies."
 signed
 />
 <div className="flex justify-between text-[10px] uppercase tracking-[0.15em] px-[92px] pr-[120px]" style={{ color: MUTED }}>
 <span>LF</span>
 <span>HF</span>
 </div>
 </div>

 {/* Click widening 0.0 - 5.0 ms step 0.1 default 0.0 */}
 <SliderRow
 label="Click widening"
 min={0.0}
 max={5.0}
 step={0.1}
 value={widenMs}
 onChange={setWidenMs}
 disabled={busy}
 unit="ms"
 hint="Pad each repair region so interpolation extends past the click tail."
 />

 {/* Stats strip */}
 {lastResult && (
 <div
 className="rounded-lg px-3 py-2 flex items-center gap-4 text-[11px] font-mono tabular-nums"
 style={{
 backgroundColor: PANEL,
 border: `1px solid ${HAIRLINE}`,
 color: INK,
 }}
 >
 <StatCell label="Clicks" value={String(lastResult.click_count)} />
 <StatCell label="Per min" value={lastResult.clicks_per_minute.toFixed(1)} />
 <StatCell
 label="Repaired"
 value={repairedPct != null ? `${repairedPct.toFixed(3)}%` : '--'}
 />
 <StatCell label="Duration" value={`${lastResult.duration_sec.toFixed(1)} s`} />
 </div>
 )}

 {/* Status / error */}
 {status && !error && (
 <div className="text-[11px]" style={{ color: MUTED }}>{status}</div>
 )}
 {error && (
 <div
 className="text-[11px] rounded-lg px-3 py-2"
 style={{ color: '#e05a5a', backgroundColor: 'rgba(224,90,90,0.08)' }}
 >
 {error}
 </div>
 )}

 {/* Bottom action row */}
 <div className="flex flex-wrap items-center gap-3 pt-2" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
 <button
 type="button"
 disabled={busy}
 onClick={onPreview}
 className="px-4 py-2 rounded-lg text-xs font-medium transition-colors"
 style={{
 backgroundColor: PANEL,
 color: INK,
 border: `1px solid ${HAIRLINE}`,
 opacity: busy ? 0.5 : 1,
 cursor: busy ? 'wait' : 'pointer',
 }}
 >
 Preview
 </button>
 <BypassToggle value={bypass} onChange={setBypass} disabled={busy} />
 <button
 type="button"
 disabled={busy}
 onClick={onCompare}
 className="px-4 py-2 rounded-lg text-xs font-medium transition-colors"
 style={{
 backgroundColor: PANEL,
 color: compareOriginal ? GOLD : INK,
 border: `1px solid ${compareOriginal ? GOLD_DIM : HAIRLINE}`,
 opacity: busy ? 0.5 : 1,
 cursor: busy ? 'wait' : 'pointer',
 }}
 >
 {compareOriginal ? 'Comparing: Original' : 'Compare'}
 </button>
 <label className="flex items-center gap-2 text-xs" style={{ color: INK, cursor: busy ? 'wait' : 'pointer' }}>
 <input
 type="checkbox"
 disabled={busy}
 checked={clicksOnly}
 onChange={(e) => setClicksOnly(e.target.checked)}
 style={{ accentColor: GOLD }}
 />
 Output clicks only
 </label>
 <div className="flex-1" />
 <button
 type="button"
 disabled={busy}
 onClick={onRender}
 className="px-5 py-2 rounded-lg text-xs font-semibold transition-colors"
 style={{
 backgroundColor: busy ? 'rgba(208,176,102,0.5)' : GOLD,
 color: '#1c1915',
 opacity: busy ? 0.7 : 1,
 cursor: busy ? 'wait' : 'pointer',
 }}
 >
 {busy ? 'Working...' : 'Render'}
 </button>
 </div>
 </div>
 )
}

// ── internal helpers ────────────────────────────────────────────────

function SliderRow({
 label, min, max, step, value, onChange, disabled, unit, hint, signed,
}: {
 label: string
 min: number
 max: number
 step: number
 value: number
 onChange: (v: number) => void
 disabled?: boolean
 unit?: string
 hint?: string
 signed?: boolean
}) {
 return (
 <div className="space-y-1">
 <div className="flex items-center justify-between">
 <label className="text-[10px] uppercase tracking-[0.15em]" style={{ color: MUTED }}>
 {label}
 </label>
 {hint && (
 <span className="text-[10px]" style={{ color: MUTED, opacity: 0.7 }}>
 {hint}
 </span>
 )}
 </div>
 <div className="flex items-center gap-3">
 <span className="text-[10px] font-mono tabular-nums w-14 text-right" style={{ color: MUTED }}>
 {formatBound(min, signed)}{unit ? ` ${unit}` : ''}
 </span>
 <input
 type="range"
 min={min}
 max={max}
 step={step}
 value={value}
 disabled={disabled}
 onChange={(e) => onChange(Number(e.target.value))}
 className="flex-1"
 style={{ accentColor: GOLD }}
 aria-label={label}
 />
 <span className="text-[10px] font-mono tabular-nums w-14" style={{ color: MUTED }}>
 {formatBound(max, signed)}{unit ? ` ${unit}` : ''}
 </span>
 <input
 type="number"
 min={min}
 max={max}
 step={step}
 value={value}
 disabled={disabled}
 onChange={(e) => {
 const next = Number(e.target.value)
 if (Number.isFinite(next)) {
 onChange(Math.max(min, Math.min(max, next)))
 }
 }}
 className="w-20 px-2 py-1 rounded text-xs font-mono tabular-nums text-right outline-none"
 style={{
 backgroundColor: PANEL,
 color: INK,
 border: `1px solid ${HAIRLINE}`,
 }}
 aria-label={`${label} value`}
 />
 </div>
 </div>
 )
}

function formatBound(v: number, signed?: boolean): string {
 if (signed && v > 0) return `+${v.toFixed(1)}`
 return v.toFixed(1)
}

function StatCell({ label, value }: { label: string; value: string }) {
 return (
 <div className="flex flex-col">
 <span className="text-[9px] uppercase tracking-[0.15em]" style={{ color: MUTED }}>{label}</span>
 <span style={{ color: INK }}>{value}</span>
 </div>
 )
}

function BypassToggle({ value, onChange, disabled }: {
 value: boolean
 onChange: (v: boolean) => void
 disabled?: boolean
}) {
 return (
 <button
 type="button"
 role="switch"
 aria-checked={value}
 disabled={disabled}
 onClick={() => onChange(!value)}
 className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
 style={{
 backgroundColor: PANEL,
 color: value ? GOLD : INK,
 border: `1px solid ${value ? GOLD_DIM : HAIRLINE}`,
 opacity: disabled ? 0.5 : 1,
 cursor: disabled ? 'wait' : 'pointer',
 }}
 >
 <span
 className="inline-block w-7 h-3.5 rounded-full relative"
 style={{
 backgroundColor: value ? GOLD_DIM : TRACK,
 transition: 'background-color 120ms',
 }}
 >
 <span
 className="absolute top-0.5 w-2.5 h-2.5 rounded-full"
 style={{
 left: value ? '14px' : '2px',
 backgroundColor: value ? GOLD : MUTED,
 transition: 'left 120ms',
 }}
 />
 </span>
 Bypass
 </button>
 )
}

function Spinner() {
 return (
 <span
 className="inline-block w-4 h-4 rounded-full"
 style={{
 border: `2px solid ${GOLD_DIM}`,
 borderTopColor: GOLD,
 animation: 'rtm-declick-spin 0.9s linear infinite',
 }}
 >
 <style>{`
 @keyframes rtm-declick-spin {
 from { transform: rotate(0deg); }
 to { transform: rotate(360deg); }
 }
 `}</style>
 </span>
 )
}
