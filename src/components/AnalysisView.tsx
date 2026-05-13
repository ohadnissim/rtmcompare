import React, { useState, useMemo, useRef, useEffect } from 'react'
import { AnalysisResult, FileInfo } from '../types'
import ABPlayer from './ABPlayer'
import { AnnotationLayer } from './learn/AnnotationLayer'
import { useLearnMode } from '../context/LearnModeContext'
import CategoryCard from './CategoryCard'
import SpectrumOverlay from './SpectrumOverlay'
import MonoCompat from './MonoCompat'
import DistortionPanel from './DistortionPanel'
import LimiterArtefactsPanel from './LimiterArtefactsPanel'
import ClickTimeline from './ClickTimeline'
import Recommendations from './Recommendations'
import MatchTab from './MatchTab'
import CommandPalette from './CommandPalette'
import { emitShortcut, isEditableTarget, RTM_EVENTS } from '../shortcuts'
import { useModes } from '../ModesContext'
import TabVerdict from './shell/TabVerdict'
import DurationPill, { formatDuration } from './DurationPill'
import ExportButton from './ExportButton'
import LufsTargets from './LufsTargets'
import LoudnessTimeline from './LoudnessTimeline'
import WaveformCompare from './WaveformCompare'
import PhaseCorrelation from './PhaseCorrelation'
import Vectorscope from './Vectorscope'
import InfoTooltip, { CopyableText } from './InfoTooltip'
import CollapsibleSection from './CollapsibleSection'
import TonalIssues from './TonalIssues'
import ReferenceAlert from './ReferenceAlert'
import AtmosChannelEnergy from './AtmosChannelEnergy'
import AtmosSurroundField from './AtmosSurroundField'
import DownmixDelta from './DownmixDelta'
import AtmosQCPanel from './AtmosQCPanel'
import AtmosPreflightPanel from './AtmosPreflightPanel'
import AtmosObjectAnomalyPanel from './AtmosObjectAnomalyPanel'
import MissingElements from './MissingElements'
import MaskingPanel from './MaskingPanel'
import PhaseBandsPanel from './PhaseBandsPanel'
import MetadataPanel from './MetadataPanel'
import TempoDriftPanel from './TempoDriftPanel'
import StreamingPreview from './StreamingPreview'
import StereoTimeline from './StereoTimeline'
import HumPanel from './HumPanel'
import TransientDensityPanel from './TransientDensityPanel'
// WaveformDiffHeatmap was removed from Breakdown in 5.7.x (Mike review:
// "get rid of mix diverge"). The component file still exists for any
// future use; just no caller wires it up here.
import ClientReportButton from './ClientReportButton'
import AtmosObjectView from './AtmosObjectView'
import SpecDriftBadge from './SpecDriftBadge'
import MasteringDelta from './MasteringDelta'

interface Props {
 results: AnalysisResult
 fileA: FileInfo
 fileB: FileInfo
}

type Tab = 'overview' | 'mastering' | 'delivery' | 'stereo' | 'match' | 'breakdown' | 'quality' | 'atmos'

export default function AnalysisView({ results, fileA, fileB }: Props) {
 // Data-view labels are always the real file names. The ABPlayer handles the
 // blind-test shuffle locally and does its own scoring — this keeps all
 // spectrum / reference / QC analysis readable while the audition stays blind.
 const labelA = stripExt(fileA.name)
 const labelB = stripExt(fileB.name)

 // Learn Mode — hide tab strip and mount annotation layer when active
 const { enabled: learnEnabled } = useLearnMode()

 const [activeTab, setActiveTab] = useState<Tab>('overview')
 // Atmos tab has a sub-toggle (Immersive / Downmix) so ADM sessions don't
 // need two separate top-level tabs. Defaults to Immersive — the
 // Atmos-specific view — because that's why the user opened the tab.
 const [atmosView, setAtmosView] = useState<'immersive' | 'downmix'>('immersive')
 // ⌘K palette — opens on Cmd/Ctrl+K, closes on Esc.
 const [paletteOpen, setPaletteOpen] = useState(false)
 // CRIT-2: Share in-flight guard — prevents double-click opening two save dialogs.
 const [sharingStatus, setSharingStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
 const { setBlind, toggleBlind, surface, advancedQc } = useModes()

 // Refs for scroll targets.
 const playerRef = useRef<HTMLDivElement>(null) // set on the A/B player wrapper
 const tabTopRef = useRef<HTMLDivElement>(null) // sentinel AFTER the player — scroll here on tab change
 const firstRenderRef = useRef(true)

 // Scroll behavior:
 // • First render after scan: scroll to top so the sticky tabs + player are both visible.
 // • Subsequent tab changes: scroll to `tabTopRef` so the new tab's panel starts at the top
 // (below the sticky tab bar, past the player).
 useEffect(() => {
 if (firstRenderRef.current) {
 firstRenderRef.current = false
 // Ensure viewport is at the very top so the user sees the tabs + player.
 window.scrollTo({ top: 0, behavior: 'auto' })
 return
 }
 const el = tabTopRef.current
 if (el) {
 requestAnimationFrame(() => {
 const rect = el.getBoundingClientRect()
 const absTop = window.scrollY + rect.top
 // Leave room for the sticky app-header (~68px) + tab bar (~60px) + a
 // small gap so the new panel starts just below both sticky regions.
 window.scrollTo({ top: Math.max(0, absTop - 140), behavior: 'auto' })
 })
 }
 }, [activeTab])

 const isAtmos = results.comparison_mode === 'stereo_vs_atmos'
 const isAtmosSolo = results.comparison_mode === 'atmos_solo'
 const isSolo = isAtmosSolo // alias for clarity — no stereo reference

 // Tab order follows the actual workflow of mastering / A&R / producer users:
 // Overview → Delivery (streaming + file meta) → Stereo → EQ Match →
 // Breakdown (diagnostic) → Quality (QC) → Atmos / Downmix (conditional).
 // Atmos lives at the far end because it's only relevant to ADM files, and
 // splitting it across the middle fragmented the flow for stereo sessions.
 const tabs = useMemo(() => {
 const t: { id: Tab; label: string; icon: string }[] = [
 { id: 'overview', label: 'Overview', icon: '◉' },
 ]
 if (!isAtmos && !isAtmosSolo && results.mastering_delta) {
 t.push({ id: 'mastering', label: 'Mastering Delta', icon: 'M' })
 }
 // Delivery — streaming-normalisation preview + file metadata. Hidden in
 // Atmos modes (platforms don't apply per-stream LUFS normalisation to
 // Atmos renders the same way).
 if (!isAtmos && !isAtmosSolo) {
 t.push({ id: 'delivery', label: 'Delivery', icon: '⇡' })
 }
 if (!isAtmos && !isAtmosSolo) {
 t.push({ id: 'stereo', label: 'Stereo & Spectrum', icon: '↔' })
 }
 if (isAtmosSolo) {
 // Solo mode still benefits from spectrum view on downmix
 t.push({ id: 'stereo', label: 'Downmix Spectrum', icon: '↔' })
 }
 // Unified Match tab — segmented Reference / Engineer / Hybrid inside.
 // Hidden only in Atmos-solo mode where there's no compare file.
 if (!isSolo) {
 t.push({ id: 'match', label: 'EQ Match', icon: '▸' })
 }
 if (!isSolo) {
 t.push({ id: 'breakdown', label: 'Breakdown', icon: '◫' })
 }
 t.push({ id: 'quality', label: 'Quality', icon: '✓' })
 // Single Atmos tab at the end — conditional on ADM files. Inside it a
 // sub-toggle flips between Immersive (the native Atmos view) and
 // Downmix (how the stereo render compares). Previously these were two
 // top-level tabs; collapsing avoids an empty "Downmix" slot in
 // atmos-solo mode and keeps ADM sessions from fragmenting the tab row.
 if (isAtmos || isAtmosSolo) {
 t.push({ id: 'atmos', label: 'Atmos', icon: '' })
 }
 return t
 }, [isAtmos, isAtmosSolo, isSolo, results.engineer_tips, results.mastering_delta])


 // ── Global keyboard shortcuts (scoped to the analysis view). Ignores
 // keydowns inside text inputs / selects / the palette, and skips any
 // combo that already belongs to the host (Cmd+N / Cmd+= / etc. still
 // work via App.tsx's own handler). Fans most actions out to the
 // event bus so the right component picks them up.
 useEffect(() => {
 // 5.4.2: header Search button dispatches `rtm-open-palette` so the
 // user can open the ⌘K palette without knowing the shortcut.
 const onCustomOpen = () => setPaletteOpen(true)
 window.addEventListener('rtm-open-palette', onCustomOpen)

 // Learn Mode guided flow — GuidedFlowBar dispatches this event to
 // switch the active tab when the user clicks a step pill or Prev/Next.
 const onLearnNavigate = (e: Event) => {
 const tabId = (e as CustomEvent<{ tabId: string }>).detail?.tabId
 if (tabId) setActiveTab(tabId as Tab)
 }
 window.addEventListener('rtm-learn-navigate', onLearnNavigate)

 const onKey = (e: KeyboardEvent) => {
 if (isEditableTarget(e)) return
 const mod = e.metaKey || e.ctrlKey

 // ⌘K / Ctrl+K → open the command palette.
 if (mod && (e.key === 'k' || e.key === 'K')) {
 e.preventDefault()
 setPaletteOpen(true)
 return
 }

 // ⌘E / ⌘⇧E → export FFP / Apply & Bounce. Shift+E sends the
 // applyBounce event, plain E sends exportFFP.
 if (mod && (e.key === 'e' || e.key === 'E')) {
 e.preventDefault()
 if (e.shiftKey) emitShortcut(RTM_EVENTS.applyBounce)
 else emitShortcut(RTM_EVENTS.exportFFP)
 return
 }

 // Everything past this point is a single-key shortcut — skip when a
 // modifier is held so we don't trample browser / OS combos.
 if (mod || e.altKey) return

 // Digits 1–9 → jump to tab by index. We read from the `tabs` array
 // live so conditional tabs (Atmos) get the right index.
 if (/^[1-9]$/.test(e.key)) {
 const idx = parseInt(e.key, 10) - 1
 if (idx < tabs.length) {
 e.preventDefault()
 setActiveTab(tabs[idx].id)
 }
 return
 }

 switch (e.key) {
 case ' ':
 case 'Spacebar':
 // Play / pause the A/B player from any tab.
 e.preventDefault()
 emitShortcut(RTM_EVENTS.playToggle)
 return
 case 'a':
 case 'A':
 emitShortcut(RTM_EVENTS.sourceA)
 return
 case 'b':
 emitShortcut(RTM_EVENTS.sourceB)
 return
 case 'B':
 // Shift+B → blind A/B toggle (uppercase reaches us when Shift is
 // held). Separates from source-switch so both live on `b`.
 e.preventDefault()
 toggleBlind()
 return
 case 'l':
 case 'L':
 emitShortcut(RTM_EVENTS.levelMatchToggle)
 return
 case 'm':
 case 'M':
 emitShortcut(RTM_EVENTS.monoMonitorToggle)
 return
 case '[':
 emitShortcut(RTM_EVENTS.chipPrev)
 return
 case ']':
 emitShortcut(RTM_EVENTS.chipNext)
 return
 }
 }
 window.addEventListener('keydown', onKey)
 return () => {
 window.removeEventListener('keydown', onKey)
 window.removeEventListener('rtm-open-palette', onCustomOpen)
 window.removeEventListener('rtm-learn-navigate', onLearnNavigate)
 }
 }, [tabs, toggleBlind])

 return (
 <div className="space-y-8">
 {/* Shortcut help overlay now lives at App root (so `?` works on
 every screen, not only the compare-results view). */}

 {/* ⌘K command palette — value-scoped search. Jumps to the tab that
 owns the metric / term. Opens via Cmd/Ctrl+K from anywhere. */}
 {paletteOpen && (
 <CommandPalette
 onClose={() => setPaletteOpen(false)}
 onNavigate={(tabId) => {
 setActiveTab(tabId as Tab)
 setPaletteOpen(false)
 }}
 />
 )}

 {/* Header bar */}
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-5 text-sm">
 <div className="flex items-center gap-2">
 <span className="text-sand-300">{labelA}</span>
 <DurationPill seconds={results.duration_sec_a ?? results.duration_sec} tint="#6b8cbb" compact />
 </div>
 {!isSolo && (<>
 <span className="text-sand-400 text-xs">vs</span>
 <div className="flex items-center gap-2">
 <span className="text-sand-300">{labelB}</span>
 <DurationPill seconds={results.duration_sec_b ?? results.duration_sec} tint="var(--color-accent)" compact />
 </div>
 </>)}
 {isAtmosSolo && (
 <span className="text-[10px] px-2 py-0.5 tracking-[0.16em] uppercase" style={{ borderRadius: '2px', backgroundColor: 'rgba(138,149,171,0.12)', color: 'var(--color-slate-blue)' }}>
 Atmos Solo · {results.atmos?.channel_layout}
 </span>
 )}
 </div>
 <div className="flex items-center gap-3">
 <SpecDriftBadge analysisVersion={results.spec_versions?.version} stampedSpecs={results.spec_versions} />
 <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>Press <kbd className="px-1 py-0.5 rounded text-[9px]" style={{ backgroundColor: '#272524', color: '#78716c' }}>?</kbd> for shortcuts</span>
 {/* ✦ Assistant — 1-click shortcut to the Match tab's Assistant panel.
   Surfaces what was previously 3 clicks away (tab → mode picker → Assistant).
   Dispatches 'rtm-match-mode' so MatchTab can switch its internal mode. */}
 <button
 type="button"
 onClick={() => {
 setActiveTab('match')
 window.dispatchEvent(new CustomEvent('rtm-match-mode', { detail: { mode: 'assistant' } }))
 }}
 title="Open the Master Assistant — compose gain → EQ → TP limiter → dither in one click"
 style={{
 fontSize: 11,
 padding: '2px 8px',
 border: '1px solid rgba(208,176,102,0.3)',
 borderRadius: 2,
 color: 'rgba(208,176,102,0.7)',
 cursor: 'pointer',
 background: 'transparent',
 }}
 >
 ✦ Assistant
 </button>
 {/* ✦ Certify — visible CTA for RTMcertify pre-delivery certificate.
   Only shown when the Electron API is present (desktop only). Dispatches
   'rtm-certify-trigger' which App.tsx handles to avoid threading certify
   state through the component tree. */}
 {window.electronAPI?.rtmCertify && (
 <button
 type="button"
 onClick={() => window.dispatchEvent(new CustomEvent('rtm-certify-trigger'))}
 title="Generate a shareable PDF certifying this analysis"
 style={{
 fontSize: 11,
 padding: '2px 8px',
 border: '1px solid rgba(208,176,102,0.3)',
 borderRadius: 2,
 color: 'rgba(208,176,102,0.7)',
 cursor: 'pointer',
 background: 'transparent',
 }}
 >
 ✦ Certify
 </button>
 )}
 {/* Share — saves a self-contained HTML report anyone can open in a browser.
       CRIT-2: in-flight guard (sharingStatus) prevents double-click double-dialog.
       Status chip gives user visible feedback on save / cancel / error. */}
 {window.electronAPI?.shareAsHtml && (
 <>
 <button
 type="button"
 disabled={sharingStatus === 'saving'}
 onClick={async () => {
 if (sharingStatus === 'saving') return
 setSharingStatus('saving')
 try {
 const res = await window.electronAPI?.shareAsHtml?.({
 title: `${fileA.name ?? 'A'} vs ${fileB.name ?? 'B'}`,
 reportJson: JSON.stringify(results),
 })
 setSharingStatus(res?.success ? 'saved' : 'idle')
 if (res?.success) setTimeout(() => setSharingStatus('idle'), 3000)
 } catch {
 setSharingStatus('error')
 setTimeout(() => setSharingStatus('idle'), 4000)
 }
 }}
 title="Save a shareable HTML report — anyone can open it in a browser, no install needed"
 style={{
 fontSize: 10,
 padding: '2px 8px',
 border: '1px solid rgba(255,255,255,0.1)',
 borderRadius: 2,
 color: sharingStatus === 'saving' ? 'var(--color-text-disabled)' : 'var(--color-text-muted)',
 background: 'transparent',
 cursor: sharingStatus === 'saving' ? 'not-allowed' : 'pointer',
 opacity: sharingStatus === 'saving' ? 0.5 : 1,
 }}
 >
 {sharingStatus === 'saving' ? 'Saving…' : 'Share ↗'}
 </button>
 {sharingStatus === 'saved' && (
 <span style={{ fontSize: 10, color: 'rgba(208,176,102,0.8)' }}>Saved ✓</span>
 )}
 {sharingStatus === 'error' && (
 <span style={{ fontSize: 10, color: 'var(--color-danger)' }}>Save failed</span>
 )}
 </>
 )}
 {results?.overall?.visqol_mos != null && (
 <div
 title={`ViSQOL perceptual match. 5.0=identical, 1.0=very different`}
 style={{
 fontSize: 10,
 padding: '2px 8px',
 border: `1px solid ${results.overall.visqol_mos >= 4.0 ? 'rgba(208,176,102,0.4)' : results.overall.visqol_mos >= 3.0 ? 'rgba(242,201,76,0.4)' : 'rgba(220,80,60,0.4)'}`,
 borderRadius: 2,
 color: results.overall.visqol_mos >= 4.0 ? 'rgba(208,176,102,0.8)' : results.overall.visqol_mos >= 3.0 ? 'rgba(242,201,76,0.8)' : 'var(--color-danger)',
 cursor: 'help',
 }}
 >
 ViSQOL {results.overall.visqol_mos.toFixed(2)}
 </div>
 )}
 <ClientReportButton results={results} fileA={fileA} fileB={fileB} />
 <ExportButton results={results} fileA={fileA} fileB={fileB} />
 </div>
 </div>

 {/* Meta-strip — left-aligned. Severity carried by the 2px left rule color.
   Replaces the prior stack of centered rounded-full pills. */}
 {((results.file_warnings && results.file_warnings.length > 0) ||
   (results.generation_loss && results.generation_loss.verdict !== 'likely_lossless') ||
   (!isSolo && results.level_matched && !isAtmos) ||
   isAtmos) && (
 <div className="flex items-start gap-4 flex-wrap">
 {results.file_warnings && results.file_warnings.map((w, i) => (
 <div key={`fw-${i}`} className="flex items-baseline gap-2 pl-3 border-l-2" style={{ borderColor: 'var(--color-warning)' }}>
 <span className="text-[10px] tracking-[0.16em] uppercase" style={{ color: 'var(--color-text-muted)' }}>FILE</span>
 <span className="text-[11px]" style={{ color: 'var(--color-text-primary)' }}>{w.message}</span>
 </div>
 ))}
 {results.generation_loss && results.generation_loss.verdict !== 'likely_lossless' && (
 <div
  className="flex items-baseline gap-2 pl-3 border-l-2"
  style={{ borderColor: results.generation_loss.verdict === 'likely_prior_lossy' ? 'var(--color-danger)' : 'var(--color-warning)' }}
  title={results.generation_loss.summary}
 >
 <span className="text-[10px] tracking-[0.16em] uppercase" style={{ color: 'var(--color-text-muted)' }}>ENCODE</span>
 <span className="text-[11px]" style={{ color: 'var(--color-text-primary)' }}>
 {results.generation_loss.verdict === 'likely_prior_lossy'
  ? 'Prior lossy encode detected'
  : 'Possible prior lossy encode'}
 {' '}— {Math.round(results.generation_loss.probability * 100)}% probability
 </span>
 </div>
 )}
 {!isSolo && results.level_matched && !isAtmos && (
 <div className="flex items-baseline gap-2 pl-3 border-l-2" style={{ borderColor: 'var(--color-text-muted)' }}>
 <span className="text-[10px] tracking-[0.16em] uppercase" style={{ color: 'var(--color-text-muted)' }}>LEVEL</span>
 <span className="text-[11px]" style={{ color: 'var(--color-text-primary)' }}>matched — differences below are real, not volume</span>
 <InfoTooltip text="Both files are adjusted to the same loudness before comparing, so differences reflect actual mix decisions — not just volume changes." />
 </div>
 )}
 {isAtmos && (
 <div className="flex items-baseline gap-2 pl-3 border-l-2" style={{ borderColor: 'var(--color-text-muted)' }}>
 <span className="text-[10px] tracking-[0.16em] uppercase" style={{ color: 'var(--color-text-muted)' }}>PLAYER</span>
 <span className="text-[11px]" style={{ color: 'var(--color-text-primary)' }}>downmix · level balanced for A/B</span>
 <InfoTooltip text="The A/B player plays your stereo reference against the Atmos stereo downmix, level-matched. Overview metrics below show the original Atmos measurements (not the downmix)." />
 </div>
 )}
 {isAtmos && results.atmos && (
 <div className="flex items-baseline gap-2 pl-3 border-l-2" style={{ borderColor: 'var(--color-text-muted)' }}>
 <span className="text-[10px] tracking-[0.16em] uppercase" style={{ color: 'var(--color-text-muted)' }}>ATMOS</span>
 <span className="text-[11px]" style={{ color: 'var(--color-text-primary)' }}>
 Stereo vs {results.atmos.channel_layout}
 {results.atmos.programme_name && ` — ${results.atmos.programme_name}`}
 </span>
 <InfoTooltip text={`Comparing original stereo mix against ${results.atmos.channel_count}-channel Atmos bed. The stereo analysis below uses the Atmos stereo downmix. Spatial metrics show channel energy, height usage, and surround balance.`} />
 </div>
 )}
 </div>
 )}

 {/* Sticky tab nav + CockpitStrip — wrapper always renders so CockpitStrip
 stays visible. Tab buttons themselves are hidden in Learn Mode
 (GuidedFlowBar drives navigation). The always-on metrics dashboard
 (LUFS-I / TP / LRA / mono-compat) is too valuable to hide.
 `--app-sticky-top` measured at runtime by App.tsx so it survives header reflows. */}
 <div
 role="tablist"
 aria-label="Analysis sections"
 className="sticky z-20 -mx-8 px-8 bg-sand-950 border-b border-dark-700/30"
 style={{ top: 'var(--app-sticky-top, 100px)' }}
 >
 <div className="flex" style={{ display: learnEnabled ? 'none' : 'flex' }}>
 {tabs.map(tab => (
 <button
 key={tab.id}
 onClick={() => {
   setActiveTab(tab.id)
   // BUG-06: let GuidedFlowBar sync its step indicator when user manually switches tabs
   window.dispatchEvent(new CustomEvent('rtm-tab-changed', { detail: { tabId: tab.id } }))
 }}
 role="tab"
 aria-selected={activeTab === tab.id}
 aria-label={tab.label}
 data-tour-tab={tab.id}
 className={`flex items-center gap-1.5 px-5 py-3 text-[11px] tracking-[0.14em] uppercase transition-all border-b-2 ${activeTab === tab.id ? 'text-sand-50 border-terra font-normal' : 'text-sand-400 border-transparent font-normal'}`}
 >
 <span className="hidden sm:inline">{tab.label}</span>
 <span className="sm:hidden" aria-hidden="true">{tab.icon}</span>
 </button>
 ))}
 </div>
 {/* ── Cockpit strip ── Always-visible metrics row so the user
 never tab-hops just to read a number. File names + durations on
 the left, LUFS-I / TP / LRA / mono-compat in the middle (with
 Δ-from-reference in gold), Binaural TP on the far right when
 Atmos is loaded. Tabs are the manual; this strip is the
 dashboard. */}
 {!isSolo && (
 <CockpitStrip
 results={results}
 labelA={labelA}
 labelB={labelB}
 isAtmos={isAtmos}
 />
 )}
 </div>

 {/* A/B Player — inline, NOT sticky. Visible on initial scan load; scrolls
 out of view when the user starts reading panel content. */}
 <div ref={playerRef} data-tour-target="player">
 <ABPlayer
 fileA={isAtmosSolo && results.atmos_downmix_path ? { path: results.atmos_downmix_path, name: `${labelA} (Downmix)` } : fileA}
 fileB={isAtmosSolo && results.atmos_downmix_path ? { path: results.atmos_downmix_path, name: `${labelA} (Downmix)` } : (isAtmos && results.atmos_downmix_path ? { path: results.atmos_downmix_path, name: `${stripExt(fileB.name)} (Downmix)` } : fileB)}
 gainAppliedDb={results.gain_applied_db}
 stems={results.stems}
 />
 </div>

 {/* Sentinel — tab-switch scrolls here so the new tab always starts at the top */}
 <div ref={tabTopRef} aria-hidden="true" />

 {/* Advanced QC strip — always shown when the toggle is on, lists
 which panels are live now vs which need a Deep Scan. Replaces the
 v5.0.x banner that fired only when EVERYTHING was empty (rarely
 the case in compare mode), so the toggle was a confusing no-op
 for testers. Per codex frontend-gap audit (5.0.3). */}
 {advancedQc && (() => {
 const live: string[] = []
 const deepOnly: string[] = []
 if (results.waveform_diff?.grid?.length) live.push('Waveform Diff')
 else if (!isSolo) deepOnly.push('Waveform Diff')
 if (results.transient_density?.timeline?.length) live.push('Transient Density')
 else deepOnly.push('Transient Density')
 if (results.masking?.overlaps?.length) live.push('Masking')
 else deepOnly.push('Per-stem Masking')
 if (results.mono_compat) live.push('Mono Compatibility')
 else deepOnly.push('Mono Compatibility')
 if (results.phase_bands_a?.length) live.push('Phase Bands')
 else deepOnly.push('Phase Bands')
 if ((results.reference_check?.song_info as any)?.tempo_drift) live.push('Tempo Drift')
 else deepOnly.push('Tempo Drift')
 if (results.tonal_issues?.length) live.push('Tonal Issues')
 const hasAnyLive = live.length > 0
 const hasAnyDeepOnly = deepOnly.length > 0
 return (
 <div className="border p-3 text-[11px] space-y-1.5" style={{ borderRadius: '2px', borderColor: 'rgba(124,164,163,0.35)', backgroundColor: 'rgba(124,164,163,0.06)' }}>
 <div className="flex items-center justify-between gap-3">
 <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: 'var(--color-teal)' }}>
 Advanced QC enabled
 </div>
 {hasAnyDeepOnly && (
 <span className="text-[9px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-muted)' }}>
 Re-analyze with Deep Scan for stem-separated metrics
 </span>
 )}
 </div>
 {hasAnyLive && (
 <div style={{ color: '#a8a196' }}>
 <span style={{ color: 'var(--color-teal)' }}>Active now:</span>{' '}
 <span style={{ color: 'var(--color-text-primary)' }}>{live.join(', ')}</span>
 </div>
 )}
 {hasAnyDeepOnly && (
 <div style={{ color: '#a8a196' }}>
 <span style={{ color: 'var(--color-text-muted)' }}>Deep Scan adds:</span>{' '}
 <span style={{ color: '#a8a196' }}>{deepOnly.join(', ')}</span>
 </div>
 )}
 </div>
 )
 })()}

 {/* ─── OVERVIEW TAB ─── */}
 {activeTab === 'overview' && (
 <div className="space-y-6">
 <TabVerdict tab="overview" results={results} isAtmos={isAtmos} />
 <CollapsibleSection
 title="Overall Summary"
 tooltip="High-level comparison of loudness, stereo width, and dynamic range between the two files."
 why="Everything you hear between two mixes is some combination of these numbers. Start here to see which axis moved, then drill into the panel that explains why."
 glossary={[
 { term: 'Integrated LUFS (LUFS-I)', def: 'Loudness averaged over the whole track per ITU-R BS.1770. The number streaming platforms use to normalise playback level. −14 LUFS is Spotify\'s target; −16 LUFS is Apple Music\'s.' },
 { term: 'True Peak (dBTP)', def: 'Peak measured AFTER upsampling to detect inter-sample peaks. Reported as a number — no warning thresholds (top-40 references routinely sit above −1 dBTP).' },
 { term: 'Short-Term Max', def: 'Loudest 3-second LUFS window in the file. Rough proxy for "how loud does the chorus hit".' },
 { term: 'Momentary Max', def: 'Loudest 400 ms LUFS window. Catches spikey masters that game the integrated number.' },
 { term: 'LRA (Loudness Range)', def: 'Difference between the loudest and quietest loudness-gated sections, in LU. Big LRA = dynamic; small LRA = over-limited.' },
 { term: 'PLR', def: 'Peak-to-loudness ratio. How much crest-factor your master has — 8–12 is punchy, <6 is squashed.' },
 { term: 'Binaural TP (approx)', def: 'Early-warning binaural-headroom estimate via an ILD downmix (no HRTF render). Apple\'s Atmos guideline is < −1 dBTP on their renderer\'s binaural deliverable; this is a fast sanity-check, not a substitute for that renderer. Verify on Apple\'s renderer before delivery.' },
 { term: 'Stereo Width', def: 'Side energy / (mid + side energy). 0% = mono, 15–25% is typical pop, >40% is extreme M/S processing.' },
 { term: 'Mono-compat risk', def: 'How much energy is lost when the stereo signal is summed to mono. High risk = audio disappears on phone speakers.' },
 { term: 'Diff column', def: 'Signed difference B − A. Positive means B is more of that metric than A; negative means less.' },
 ]}
 >
 {/* ── Hero metrics — LUFS-I + True Peak dominate the card so the
 eye lands on loudness + headroom first, everything else is
 context. 32 px gold numbers, labels + deltas in 10 px muted. */}
 {(() => {
 const lufsA = results.overall.lufs_a
 const lufsB = (isAtmos && results.atmos_qc?.specs?.loudness_lufs != null)
 ? results.atmos_qc.specs.loudness_lufs
 : results.overall.lufs_b
 const lufsDelta = lufsB - lufsA
 const tpA = results.headroom?.true_peak_a
 const tpB = (isAtmos && results.atmos_qc?.specs?.true_peak_dbtp != null)
 ? results.atmos_qc.specs.true_peak_dbtp
 : results.headroom?.true_peak_b
 const tpDelta = (tpA != null && tpB != null) ? (tpB - tpA) : null
 const fmtDelta = (d: number | null) => {
 if (d == null) return ''
 if (Math.abs(d) < 0.05) return '±0'
 return (d > 0 ? '+' : '−') + Math.abs(d).toFixed(1)
 }
 // TP warnings disabled by user direction — show numbers only.
 const tpWarn = false
 void (tpB != null && tpB > -1.0) // legacy threshold retained for reference
 return (
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 mb-5">
 {/* LUFS-I hero */}
 <div className="px-6 py-5" style={{ borderRight: '1px solid rgba(168,161,150,0.08)' }}>
 <div className="text-[10px] tracking-[0.18em] uppercase mb-2" style={{ color: 'var(--color-text-muted)' }}>
 Integrated · LUFS
 </div>
 <div className="flex items-baseline gap-3">
 <span className="font-mono tabular-nums" style={{ fontSize: 'var(--text-metric-value)', lineHeight: 1, color: 'var(--color-accent)' }}>
 {lufsB.toFixed(1)}
 </span>
 <span className="text-[11px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
 {fmtDelta(lufsDelta)} {isAtmos && <span className="text-[9px] opacity-60">(Atmos)</span>}
 </span>
 </div>
 <div className="text-[10px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
 Reference: <span className="font-mono">{lufsA.toFixed(1)}</span>
 </div>
 </div>
 {/* True Peak hero */}
 <div className="px-6 py-5">
 <div className="text-[10px] tracking-[0.18em] uppercase mb-2" style={{ color: tpWarn ? '#e07a4f' : 'var(--color-text-muted)' }}>
 True Peak · dBTP
 </div>
 <div className="flex items-baseline gap-3">
 <span
 className="font-mono tabular-nums"
 style={{
 fontSize: 'var(--text-metric-value)',
 lineHeight: 1,
 color: tpWarn ? '#e07a4f' : 'var(--color-accent)',
 }}
 >
 {tpB != null ? tpB.toFixed(1) : '—'}
 </span>
 <span className="text-[11px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
 {fmtDelta(tpDelta)} {isAtmos && <span className="text-[9px] opacity-60">(Atmos)</span>}
 </span>
 </div>
 <div className="text-[10px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
 Reference: <span className="font-mono">{tpA != null ? tpA.toFixed(1) : '—'}</span>
 </div>
 </div>
 </div>
 )
 })()}

 {/* A vs B comparison table — every metric in one place for
 precision users. Hairline dividers, 11 px off-white body, no
 row backgrounds: reads as a specification sheet, not a
 dashboard. */}
 <div className="overflow-hidden" style={{ borderRadius: '2px', border: '1px solid rgba(168,161,150,0.06)' }}>
 <table className="w-full text-[11px]">
 <thead>
 <tr className="border-b border-dark-700/30">
 <th className="text-left px-4 py-2.5 text-dark-500 font-normal w-28"></th>
 <th className="text-right px-3 py-2.5 text-dark-300 font-medium">
 <span className="inline-flex items-center gap-1.5">
 {labelA}
 {results.reference_check && (
 <RefStatusDot check={results.reference_check} labelA={labelA} />
 )}
 </span>
 </th>
 <th className="text-right px-3 py-2.5 font-medium text-terra">{labelB}</th>
 <th className="text-right px-3 py-2.5 text-dark-500 font-normal w-20">Diff</th>
 </tr>
 </thead>
 <tbody>
 {(results.duration_sec_a != null || results.duration_sec_b != null) && (
 <tr className="border-b border-dark-700/20">
 <td className="px-4 py-2 text-dark-400">Length</td>
 <td className="text-right font-mono tabular-nums text-dark-300">{formatDuration(results.duration_sec_a ?? results.duration_sec)}</td>
 <td className="text-right font-mono tabular-nums text-terra">{formatDuration(results.duration_sec_b ?? results.duration_sec)}</td>
 <td className="text-right font-mono tabular-nums text-dark-500">
 {(() => {
 const a = results.duration_sec_a ?? results.duration_sec ?? 0
 const b = results.duration_sec_b ?? results.duration_sec ?? 0
 const dMs = Math.round((b - a) * 1000)
 if (dMs === 0) return '—'
 const sign = dMs > 0 ? '+' : '−'
 const abs = Math.abs(dMs)
 // Show ms when small, ms within seconds when bigger
 if (abs < 1000) return `${sign}${abs} ms`
 const wholeS = Math.floor(abs / 1000)
 const remMs = abs % 1000
 return `${sign}${wholeS}.${remMs.toString().padStart(3, '0')} s`
 })()}
 </td>
 </tr>
 )}
 <tr className="border-b border-dark-700/20">
 <td className="px-4 py-2 text-dark-400">Integrated</td>
 <td className="text-right font-mono tabular-nums text-dark-300">{results.overall.lufs_a.toFixed(1)} LUFS</td>
 <td className="text-right font-mono tabular-nums text-terra">
 {(isAtmos && results.atmos_qc?.specs?.loudness_lufs != null
 ? results.atmos_qc.specs.loudness_lufs
 : results.overall.lufs_b
 ).toFixed(1)} LUFS
 {isAtmos && <span className="text-[9px] text-dark-500 ml-1">(Atmos)</span>}
 </td>
 <td className="text-right font-mono tabular-nums text-dark-500">
 {(() => {
 const b = isAtmos && results.atmos_qc?.specs?.loudness_lufs != null
 ? results.atmos_qc.specs.loudness_lufs
 : results.overall.lufs_b
 const d = b - results.overall.lufs_a
 return (d > 0 ? '+' : '') + d.toFixed(1)
 })()}
 </td>
 </tr>
 {/* Dialog-gate row — speech-anchored LUFS from the Python
 dialog_gate analyzer. Only one reading per analysis (not
 per-file), so the value spans both file columns. Always
 renders when the analyzer produced output so the engineer
 can see that the detector ran, even on 'insufficient' /
 'error' states (which show a '-' placeholder + note
 instead of a LUFS number). */}
 {results.dialog_gate && (() => {
 const dg = results.dialog_gate!
 const pillColor =
 dg.confidence === 'high' ? { fg: '#6ec577', bg: 'rgba(110,197,119,0.12)' } :
 dg.confidence === 'medium' ? { fg: 'var(--color-accent)', bg: 'rgba(208,176,102,0.12)' } :
 dg.confidence === 'insufficient' ? { fg: '#e07a4f', bg: 'rgba(224,122,79,0.12)' } :
 dg.confidence === 'error' ? { fg: 'var(--color-danger)', bg: 'rgba(224,90,90,0.12)' } :
 { fg: 'var(--color-text-muted)', bg: 'rgba(141,134,123,0.12)' } // low / none
 const hideLufs = dg.confidence === 'error' || dg.confidence === 'insufficient' || dg.lufs_i == null
 return (
 <>
 <tr className={dg.note ? '' : 'border-b border-dark-700/20'}>
 <td className="px-4 py-2 text-dark-400">
 Dialog (gated)
 </td>
 <td className="text-right font-mono tabular-nums text-dark-300" colSpan={2}>
 <span className="inline-flex items-center justify-center gap-2">
 <span style={{ color: hideLufs ? 'var(--color-text-muted)' : 'var(--color-text-primary)' }}>
 {hideLufs ? '-' : `${dg.lufs_i!.toFixed(1)} LKFS`}
 </span>
 <span
 className="text-[9px] uppercase tracking-[0.14em] px-2 py-0.5"
 style={{ color: pillColor.fg, backgroundColor: pillColor.bg, borderRadius: '2px' }}
 title={`Detector confidence: ${dg.confidence}`}
 >
 {dg.confidence}
 </span>
 <span style={{ color: 'var(--color-text-muted)' }}>
 {`${dg.speech_pct.toFixed(0)}% speech`}
 </span>
 </span>
 </td>
 <td className="text-right font-mono tabular-nums text-dark-500">-</td>
 </tr>
 {dg.note && (
 <tr className="border-b border-dark-700/20">
 <td></td>
 <td className="px-4 pb-2 pt-0 text-[10px] font-display italic" colSpan={3} style={{ color: 'var(--color-text-muted)' }}>
 {dg.note}
 </td>
 </tr>
 )}
 </>
 )
 })()}
 {!isAtmos && results.overall.short_term_max_a != null && results.overall.short_term_max_b != null && (
 <tr className="border-b border-dark-700/20">
 <td className="px-4 py-2 text-dark-400">Short-Term Max <span className="text-[9px] text-dark-600">(3s)</span></td>
 <td className="text-right font-mono tabular-nums text-dark-300">{results.overall.short_term_max_a.toFixed(1)} LUFS</td>
 <td className="text-right font-mono tabular-nums text-terra">{results.overall.short_term_max_b.toFixed(1)} LUFS</td>
 <td className="text-right font-mono tabular-nums text-dark-500">{(results.overall.short_term_max_b - results.overall.short_term_max_a) > 0 ? '+' : ''}{(results.overall.short_term_max_b - results.overall.short_term_max_a).toFixed(1)}</td>
 </tr>
 )}
 {!isAtmos && results.overall.momentary_max_a != null && results.overall.momentary_max_b != null && (
 <tr className="border-b border-dark-700/20">
 <td className="px-4 py-2 text-dark-400">Momentary Max <span className="text-[9px] text-dark-600">(400ms)</span></td>
 <td className="text-right font-mono tabular-nums text-dark-300">{results.overall.momentary_max_a.toFixed(1)} LUFS</td>
 <td className="text-right font-mono tabular-nums text-terra">{results.overall.momentary_max_b.toFixed(1)} LUFS</td>
 <td className="text-right font-mono tabular-nums text-dark-500">{(results.overall.momentary_max_b - results.overall.momentary_max_a) > 0 ? '+' : ''}{(results.overall.momentary_max_b - results.overall.momentary_max_a).toFixed(1)}</td>
 </tr>
 )}
 {results.headroom && (
 <tr className="border-b border-dark-700/20">
 <td className="px-4 py-2 text-dark-400">True Peak</td>
 <td className="text-right font-mono tabular-nums text-dark-300">{results.headroom.true_peak_a.toFixed(1)} dBTP</td>
 <td className="text-right font-mono tabular-nums text-terra">
 {(isAtmos && results.atmos_qc?.specs?.true_peak_dbtp != null
 ? results.atmos_qc.specs.true_peak_dbtp
 : results.headroom.true_peak_b
 ).toFixed(1)} dBTP
 {isAtmos && <span className="text-[9px] text-dark-500 ml-1">(Atmos)</span>}
 </td>
 <td className="text-right font-mono tabular-nums text-dark-500">
 {(() => {
 const b = isAtmos && results.atmos_qc?.specs?.true_peak_dbtp != null
 ? results.atmos_qc.specs.true_peak_dbtp
 : results.headroom.true_peak_b
 const d = b - results.headroom.true_peak_a
 return (d > 0 ? '+' : '') + d.toFixed(1)
 })()}
 </td>
 </tr>
 )}
 {isAtmos && results.atmos?.binaural_tp?.true_peak_db != null && (
 <tr className="border-b border-dark-700/20">
 <td className="px-4 py-2 text-dark-400">Binaural TP <span className="text-[9px] text-dark-600">(approx)</span></td>
 <td className="text-right font-mono tabular-nums text-dark-500">—</td>
 <td className="text-right font-mono tabular-nums text-terra">{results.atmos.binaural_tp.true_peak_db.toFixed(1)} dBTP</td>
 <td className="text-right font-mono tabular-nums text-dark-500">—</td>
 </tr>
 )}
 <tr className="border-b border-dark-700/20">
 <td
 className="px-4 py-2 text-dark-400"
 title="LRA — Loudness Range (BS.1770-4 / EBU R128). Difference between the loudest and quietest loudness-gated sections, in LU. Big LRA = dynamic; small LRA = over-limited. Modern pop sits 4–8 LU; classical can run 15+ LU."
 >LRA</td>
 <td className="text-right font-mono tabular-nums text-dark-300">{results.overall.dynamics_a.toFixed(1)} LU</td>
 <td className="text-right font-mono tabular-nums text-terra">{results.overall.dynamics_b.toFixed(1)} LU</td>
 <td className="text-right font-mono tabular-nums text-dark-500">{(results.overall.dynamics_b - results.overall.dynamics_a) > 0 ? '+' : ''}{(results.overall.dynamics_b - results.overall.dynamics_a).toFixed(1)}</td>
 </tr>
 {results.overall.plr_a != null && results.overall.plr_b != null && (
 <tr className="border-b border-dark-700/20">
 <td
 className="px-4 py-2 text-dark-400"
 title="PLR — Peak-to-Loudness Ratio. True-peak minus integrated LUFS, in dB. How much crest-factor your master has. 8–12 dB is punchy; <6 dB is squashed; >14 dB is unusually dynamic for music."
 >PLR</td>
 <td className="text-right font-mono tabular-nums text-dark-300">{results.overall.plr_a.toFixed(1)} dB</td>
 <td className="text-right font-mono tabular-nums text-terra">{results.overall.plr_b.toFixed(1)} dB</td>
 <td className="text-right font-mono tabular-nums text-dark-500">{(results.overall.plr_b - results.overall.plr_a) > 0 ? '+' : ''}{(results.overall.plr_b - results.overall.plr_a).toFixed(1)}</td>
 </tr>
 )}
 {results.overall.psr_a != null && results.overall.psr_b != null && (
 <tr className="border-b border-dark-700/20">
 <td
 className="px-4 py-2 text-dark-400"
 title="PSR — Peak-to-Short-term Ratio. True-peak minus max short-term LUFS. Limiter stress on peaks. Target: >3 LU. <1 LU = over-limited."
 >PSR</td>
 <td className="text-right font-mono tabular-nums text-dark-300">{results.overall.psr_a.toFixed(1)} LU</td>
 <td
 className="text-right font-mono tabular-nums"
 style={{
 color: results.overall.psr_b > 3
 ? 'rgba(100,200,120,0.9)'
 : results.overall.psr_b >= 1
 ? 'rgba(242,201,76,0.8)'
 : 'var(--color-danger)',
 }}
 >{results.overall.psr_b.toFixed(1)} LU</td>
 <td className="text-right font-mono tabular-nums text-dark-500 text-[10px]">
 Δ {(results.overall.psr_b - results.overall.psr_a) > 0 ? '+' : ''}{(results.overall.psr_b - results.overall.psr_a).toFixed(1)} LU
 </td>
 </tr>
 )}
 {!isAtmos && !isAtmosSolo && (
 <tr>
 <td className="px-4 py-2 text-dark-400">
 Stereo Width
 <span className="text-[9px] text-dark-600 ml-1">({describeWidth(results.overall.width_a)})</span>
 </td>
 <td className="text-right font-mono tabular-nums text-dark-300">{describeWidth(results.overall.width_a)}</td>
 <td className="text-right font-mono tabular-nums text-terra">{describeWidth(results.overall.width_b)}</td>
 <td className="text-right font-mono tabular-nums text-dark-500">
 {widthDelta(results.overall.width_a, results.overall.width_b)}
 </td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 <div className="space-y-2 pt-2">
 {/* Insights are computed from stereo vs downmix in Atmos mode, which
 produces misleading lines like "B is 10 dB quieter overall" —
 suppress those and show an Atmos-appropriate explainer instead. */}
 {isAtmos ? (
 <div className="text-[11px] text-dark-300 leading-relaxed space-y-1">
 <div>Overview metrics for the Atmos file come from the Atmos measurement itself (not the downmix).</div>
 <div>Player plays your stereo reference against the Atmos stereo downmix, level-balanced for honest A/B.</div>
 {results.atmos && (
 <div className="text-dark-400">
 {results.atmos.channel_count}ch {results.atmos.channel_layout}
 {results.atmos.object_count > 0 && ` · ${results.atmos.object_count} objects`}
 {results.atmos.has_adm ? ' · ADM metadata present' : ''}
 </div>
 )}
 </div>
 ) : (
 results.overall.insights.map((insight, i) => (
 <CopyableText key={i} text={insight} />
 ))
 )}
 </div>
 </CollapsibleSection>

 {/* Streaming Normalization Preview + File Metadata now live on
 the dedicated Delivery tab. */}


 {/* Waveform */}
 {results.waveform_a && results.waveform_b && results.duration_sec && (
 <CollapsibleSection
 title="Waveform"
 tooltip="Visual shape of the audio over time. A flatter, more rectangular waveform means heavier limiting/compression. More peaks and valleys = more dynamic."
 why="Fastest read on how hard a master was pushed. A brick (solid rectangle, no peaks above the limiter ceiling) means 10–12 dB of compression and almost no transient left. A waveform that still breathes keeps drums punchy, cymbals intact, vocals forward."
 >
 <WaveformCompare
 waveformA={results.waveform_a}
 waveformB={results.waveform_b}
 labelA={labelA}
 labelB={labelB}
 durationSec={results.duration_sec}
 />
 </CollapsibleSection>
 )}

 {/* Loudness Timeline */}
 {results.lufs_over_time_a && results.lufs_over_time_b && results.duration_sec && (
 <CollapsibleSection
 title="Loudness Over Time"
 tooltip="LUFS loudness plotted across the song. Shows where the master pushed harder. Useful for spotting over-compressed choruses or quiet intros that got boosted."
 why="Integrated LUFS is one number for the whole track, useful for streaming but silent on arrangement. Short-term LUFS over time shows the macro-dynamics the listener feels: verse to chorus jump, the held breath before a drop, the way a bridge sits back. Flat line = no movement; peaks in the wrong places = the limiter is rewriting the arrangement."
 >
 <LoudnessTimeline
 lufsOverTimeA={results.lufs_over_time_a}
 lufsOverTimeB={results.lufs_over_time_b}
 lufsMomentaryA={results.lufs_momentary_a}
 lufsMomentaryB={results.lufs_momentary_b}
 labelA={labelA}
 labelB={labelB}
 durationSec={results.duration_sec}
 />
 </CollapsibleSection>
 )}

 {/* 5.2.3: GenreCompareCard removed — auto-detection was unreliable
 (false readings on real-world masters) and the value wasn't acted
 on anywhere downstream. Top-level genre_a/genre_b are no longer
 emitted by analyze.py. */}

 </div>
 )}

 {/* ─── MASTERING DELTA TAB ─── */}
 {activeTab === 'mastering' && results.mastering_delta && (
 <div className="space-y-6">
 <TabVerdict tab="mastering" results={results} isAtmos={isAtmos} />
 <MasteringDelta delta={results.mastering_delta} overall={results.overall} />
 </div>
 )}

 {/* ─── DELIVERY TAB ─── */}
 {activeTab === 'delivery' && (
 <div className="space-y-6">
 <TabVerdict tab="delivery" results={results} isAtmos={isAtmos} />
 {/* Streaming Normalization Preview — the main attraction on this
 tab. Default-open because delivery is the whole reason anyone
 clicks here. Hidden for Atmos modes (platforms normalise those
 differently). */}
 {results.streaming_preview && !isAtmos && !isAtmosSolo && (
 <CollapsibleSection
 title="Streaming Normalization Preview"
 tooltip="What each major platform will actually play this track at, after their loudness normalisation. Spotify, Apple, Tidal, and others attenuate loud masters. Apple Music also boosts quiet masters. TP breach flags mean the platform's limiter will engage."
 why="Most listeners hear your track through streaming platforms, not your studio. Every platform turns loud masters down, which negates the volume war. The adjusted playback loudness is what your audience actually hears, and flags whether your true-peak will trigger the platform's limiter."
 defaultOpen={true}
 glossary={[
 { term: 'Target', def: 'The platform\'s LUFS-I target. Spotify −14, Apple Music −16, Tidal −14, YouTube −14, Amazon Music −14, Deezer −15, SoundCloud −14.' },
 { term: 'Played LUFS', def: 'What your track plays back at AFTER the platform applies its normalisation gain. If your master is −8 LUFS and Spotify targets −14, Spotify turns you down 6 dB and you play at −14.' },
 { term: 'Delta (dB)', def: 'How much the platform will change your level. Negative = they\'ll turn you down (attenuation); positive = they\'ll turn you up (boost; only Apple does this for quiet masters).' },
 { term: 'TP flag', def: 'True peak AFTER the platform\'s normalisation gain has been applied. If this exceeds the platform\'s ceiling, their limiter engages on playback — which changes the sound and is usually audible.' },
 { term: '▶ audition', def: 'Plays 30 seconds of the loudest section of your file with the platform\'s gain delta applied — hear exactly what a Spotify listener will actually hear.' },
 { term: 'Loudness war', def: 'The 1990s–2010s race to make masters as loud as possible. Platforms now normalise, so a louder master just gets turned down more — and loses its dynamic range for nothing. −9 LUFS and −14 LUFS play back at the same perceived level; the −14 sounds punchier.' },
 ]}
 >
 <StreamingPreview
 previewA={results.streaming_preview.a}
 previewB={results.streaming_preview.b}
 labelA={labelA}
 labelB={labelB}
 soloA={isSolo}
 fileA={fileA}
 fileB={fileB}
 lufsA={results.overall?.lufs_a ?? null}
 lufsB={results.overall?.lufs_b ?? null}
 />
 </CollapsibleSection>
 )}

 {/* File Metadata — BEXT / iXML / LIST-INFO. Embedded tags are
 what distributors and DSPs actually read, so it lives on
 Delivery alongside the streaming preview. */}
 {results.metadata && (
 <CollapsibleSection
 title="File Metadata"
 tooltip="BEXT, iXML, and LIST-INFO tags embedded in the WAV."
 why="Embedded metadata travels with the file through every distributor's pipeline. Inspect what's there; embed what's missing if your delivery target requires it."
 defaultOpen={false}
 >
 <MetadataPanel metadata={results.metadata} labelA={labelA} labelB={labelB} pathA={fileA?.path} pathB={fileB?.path} />
 </CollapsibleSection>
 )}

 {/* Empty-state — the only path where a non-Atmos comparison lands
 on Delivery with zero cards is a freshly-ingested file with no
 metadata and the backend skipping the streaming preview. Keep
 the tab present so the user learns the shortcut. */}
 {!(results.streaming_preview && !isAtmos && !isAtmosSolo) && !results.metadata && (
 <div className="p-8 text-center space-y-2"
 style={{ borderRadius: '2px', backgroundColor: 'rgba(48,44,39,0.4)', border: '1px solid rgba(168,161,150,0.08)' }}>
 <p className="text-sm" style={{ color: '#a8a29e' }}>No delivery checks for this file</p>
 <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
 Streaming normalization and embedded metadata appear here for stereo WAV/FLAC/AIFF files.
 </p>
 </div>
 )}
 </div>
 )}

 {/* ─── BREAKDOWN TAB ─── */}
 {activeTab === 'breakdown' && (
 <div className="space-y-6">
 <TabVerdict tab="breakdown" results={results} isAtmos={isAtmos} />
 {/* Genre classification is surfaced only on the Reference-only
 single-file view — on a 2-file comparison it adds clutter
 without helping the mix decision. (Mood analyser was removed
 in v4.0 entirely; mood_detector.py no longer exists.) */}

 {/* 5.7.x: Per-Element Breakdown moved to the top of the tab —
 it's the most actionable section here, so it gets prime
 real-estate above Transient Density / Masking / Tonal Issues.
 Default-collapsed; the badge tells you whether anything's
 above the 0.5 dB JND threshold without expanding. Punch /
 Wideness / Air are cut per teacher-review — they're vibes
 not measurements, but still reachable via `results.categories`
 for anything that wants the raw set. */}
 {(() => {
 const CUT = new Set(['Punch', 'Wideness', 'Air'])
 // 0.5 dB is the floor for human JND on wide-band level — below
 // that, the two tracks are "the same" for the purposes of
 // triage, so hiding them declutters without losing anything
 // useful.
 const THRESHOLD_DB = 0.5
 const elements = results.categories.filter(c => !CUT.has(c.name))
 const outliers = elements.filter(c => Math.abs(c.level_diff) > THRESHOLD_DB)
 const balanced = elements.filter(c => Math.abs(c.level_diff) <= THRESHOLD_DB)
 return (
 <CollapsibleSection
 title="Per-Element Breakdown"
 tooltip="Level-matched comparison per element. Elements that differ by more than 0.5 dB show up by default; the rest are collapsed."
 why="0.5 dB is the audibility threshold for wide-band level. Anything under that sounds identical, so hiding it stops the panel from reading like a spreadsheet."
 defaultOpen={false}
 badge={
 outliers.length > 0 ? (
 <span className="text-[10px] px-2 py-0.5" style={{ borderRadius: '2px', color: 'var(--color-accent)', backgroundColor: 'rgba(150,128,58,0.1)' }}>
 {outliers.length} above ±0.5 dB
 </span>
 ) : (
 <span className="text-[10px] px-2 py-0.5" style={{ borderRadius: '2px', color: '#6ec577', backgroundColor: 'rgba(110,197,119,0.1)' }}>
 All within ±0.5 dB
 </span>
 )
 }
 >
 <PerElementDrawer outliers={outliers} balanced={balanced} labelA={labelA} labelB={labelB} />
 </CollapsibleSection>
 )
 })()}

 {/* 5.7.x: Mix-diverge waveform heatmap was removed per Mike's
 review — overlapped with the per-region tonal_diff bars and
 the time-vs-frequency view rarely produced an actionable
 read in user testing. The data is still in the API response
 (results.waveform_diff) for anyone wanting to revive it later;
 just nothing visualises it.

 Same review folded these sections (Masking Overlap, Transient
 Density) up to top-level Breakdown — they used to be gated
 behind the Advanced QC toggle, but there's no value hiding
 them. If the data is present, surface it.

 Order: Masking before Transient. Masking diagnoses "why is
 this muddy?" — actionable. Transient is more contextual /
 navigational (sections + arc), so it sits below. */}

 {results.masking && results.masking.overlaps && results.masking.overlaps.length > 0 && (
 <CollapsibleSection
 title="Masking Overlap"
 tooltip="Where elements compete for the same frequency range. In Deep Scan this is per-stem (kick vs bass, vocal vs instruments, etc.). Otherwise shows full-mix density flags."
 why="Masking is why mixes sound muddy, crowded, or 'never clear no matter how much I EQ'. Two elements fighting for the same frequency means neither wins; one has to move. Side-chain, cut, or LPF the interferer instead of adding more EQ to the victim."
 badge={
 <span className="text-[10px] px-2 py-0.5" style={{ borderRadius: '2px', color: 'var(--color-accent)', backgroundColor: 'rgba(208,176,102,0.1)' }}>
 {results.masking.overlaps.length} flagged
 </span>
 }
 defaultOpen={false}
 >
 <MaskingPanel masking={results.masking} />
 </CollapsibleSection>
 )}

 {results.transient_density && results.transient_density.timeline.length > 0 && (
 <CollapsibleSection
 title="Transient Density & Structure"
 tooltip="Energy arc, rhythmic density, and auto-detected sections across the track."
 why="A drop that doesn't land, a bridge that drags, a chorus quieter than expected: all show up here before your ears notice."
 defaultOpen={false}
 >
 <TransientDensityPanel density={results.transient_density} durationSec={results.duration_sec} />
 </CollapsibleSection>
 )}

 {/* Tonal Issues — collapsed by default and only shown when
 there's something detected. 5.7.x: dropped the advancedQc
 fallback — engineers catch these by ear, so showing an empty
 "Clean" panel just adds visual weight to the page without
 helping. If the detector finds nothing, the section is gone. */}
 {results.tonal_issues && results.tonal_issues.length > 0 && (
 <CollapsibleSection
 title="Tonal Issues"
 defaultOpen={false}
 tooltip="Detects perceptual problems like harshness (2-5 kHz), boominess (100-300 Hz), sibilance (5-9 kHz), muddiness (200-500 Hz), boxiness (300-700 Hz), and thinness (below 200 Hz). These are what experienced engineers listen for."
 why="The named complaints you hear in every mixing book: boominess, muddiness, harshness, sibilance, boxiness, thinness. Each maps to a known frequency band. Objective flags save an hour of 'does this sound harsh to you?' back-and-forth."
 badge={
 results.tonal_issues && results.tonal_issues.length > 0 ? (
 <span className="text-[10px] px-2 py-0.5" style={{ borderRadius: '2px', color: 'var(--color-accent)', backgroundColor: 'rgba(150,128,58,0.1)' }}>
 {results.tonal_issues.length} detected
 </span>
 ) : (
 <span className="text-[10px] px-2 py-0.5" style={{ borderRadius: '2px', color: '#6ec577', backgroundColor: 'rgba(110,197,119,0.1)' }}>
 Clean
 </span>
 )
 }
 >
 <TonalIssues
 issues={results.tonal_issues || []}
 labelA={labelA}
 labelB={labelB}
 />
 </CollapsibleSection>
 )}

 </div>
 )}

 {/* ─── ATMOS TAB (ADM comparisons + solo Atmos analysis) ─── */}
 {activeTab === 'atmos' && (isAtmos || isAtmosSolo) && (
 <div className="space-y-6">
 {/* Sub-toggle — Immersive vs Downmix. Hidden in atmos-solo mode
 because there's no stereo reference to build a downmix view
 from. Same hairline-pill pattern as the EQ Match tab. */}
 {isAtmos && !isAtmosSolo && (
 <div className="flex items-center justify-center">
 <div
 className="inline-flex items-center gap-1 p-1"
 style={{ borderRadius: '2px', backgroundColor: 'rgba(48,44,39,0.5)', border: '1px solid rgba(168,161,150,0.12)' }}
 >
 <button
 onClick={() => setAtmosView('immersive')}
 className="text-[11px] px-4 py-1.5 transition-all uppercase tracking-[0.14em]"
 style={{
 borderRadius: '2px',
 backgroundColor: atmosView === 'immersive' ? 'rgba(138,149,171,0.15)' : 'transparent',
 color: atmosView === 'immersive' ? 'var(--color-slate-blue)' : '#a8a29e',
 border: `1px solid ${atmosView === 'immersive' ? 'rgba(138,149,171,0.4)' : 'transparent'}`,
 fontWeight: atmosView === 'immersive' ? 500 : 400,
 }}
 title="Native Atmos view — surround field, object trajectories, per-channel energy"
 >
 Immersive
 </button>
 <button
 onClick={() => setAtmosView('downmix')}
 className="text-[11px] px-4 py-1.5 transition-all uppercase tracking-[0.14em]"
 style={{
 borderRadius: '2px',
 backgroundColor: atmosView === 'downmix' ? 'rgba(138,149,171,0.15)' : 'transparent',
 color: atmosView === 'downmix' ? 'var(--color-slate-blue)' : '#a8a29e',
 border: `1px solid ${atmosView === 'downmix' ? 'rgba(138,149,171,0.4)' : 'transparent'}`,
 fontWeight: atmosView === 'downmix' ? 500 : 400,
 }}
 title="How the stereo downmix compares to the stereo reference"
 >
 Downmix
 </button>
 </div>
 </div>
 )}

 {(atmosView === 'immersive' || isAtmosSolo) && (<>
 {/* Atmos info strip — channel layout + duration + programme name.
 Length is critical for Atmos delivery (sync, broadcast slots,
 dialog timing) so it sits at the top of every Atmos view. */}
 {results.atmos && (
 <div className="flex flex-wrap items-center gap-3 px-4 py-2"
 style={{ borderRadius: '2px', backgroundColor: 'rgba(138,149,171,0.06)', border: '1px solid rgba(138,149,171,0.18)' }}>
 <span className="text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--color-slate-blue)' }}>
 Atmos · {results.atmos.channel_layout}
 </span>
 <DurationPill seconds={results.duration_sec_b ?? results.duration_sec} label="Length" tint="var(--color-slate-blue)" compact />
 {results.atmos.programme_name && (
 <span className="text-[11px]" style={{ color: '#b394d4' }}>
 {results.atmos.programme_name}
 </span>
 )}
 {results.atmos.channel_count != null && (
 <span className="text-[10px] font-mono" style={{ color: '#7a6a8a' }}>
 {results.atmos.channel_count} ch
 </span>
 )}
 </div>
 )}
 {/* Apple Music Atmos Preflight — hard-checks (object count ≤118,
 LFE routing, layout 7.1.2/5.1.4, SR=48k, BD≥24, orphan beds,
 binaural TP). Rolls up to a single HOLD / WARN / READY
 banner so the mix supervisor reads deliverability at a
 glance before the wider Atmos QC panel. */}
 {results.atmos_qc && <AtmosPreflightPanel result={results} />}

 {/* Per-object anomaly detector — flags hot / silent / static /
 dark objects that usually indicate mix mistakes rather
 than artistic intent. Reads `atmos_channels` which the
 Atmos QC pass already emits. */}
 {results.atmos_channels && results.atmos_channels.length > 0 && (
 <AtmosObjectAnomalyPanel result={results} />
 )}

 {results.atmos_qc && (
 <CollapsibleSection
 title="Dolby Atmos QC"
 tooltip="Checks your Atmos file against Dolby's delivery specifications for music streaming platforms (Apple Music, Tidal, Amazon Music). Verifies loudness, true peak, sample rate, bit depth, channel activity, and more."
 why="Apple Music, Tidal, and Amazon reject Atmos deliveries that miss spec: wrong sample rate, too-hot TP, inactive channels, missing ADM. A spec-fail is a one-week slip while delivery re-bounces and re-ingests. Catch it before upload."
 badge={
 <span className="text-[10px] px-2 py-0.5" style={{ borderRadius: '2px',
 color: results.atmos_qc.status === 'pass' ? '#6ec577' : results.atmos_qc.status === 'warning' ? 'var(--color-accent)' : 'var(--color-danger)',
 backgroundColor: results.atmos_qc.status === 'pass' ? 'rgba(110,197,119,0.1)' : results.atmos_qc.status === 'warning' ? 'rgba(150,128,58,0.1)' : 'rgba(224,90,90,0.1)',
 }}>
 {results.atmos_qc.score}/100
 </span>
 }
 >
 <AtmosQCPanel qc={results.atmos_qc} scope="atmos-only" />
 </CollapsibleSection>
 )}

 {results.atmos && (
 <>
 <CollapsibleSection
 title="Surround Field (Atmos)"
 tooltip="Top-down view of the speaker layout with energy per channel measured directly from the Atmos file. Circle size represents how much audio is present at each speaker position. Height channels shown with dashed outlines."
 why="The Atmos field is your spatial canvas. Uneven energy distribution (e.g. all content stuck in L/R) means the mix isn't actually using the Atmos format, just paying for it."
 >
 <AtmosSurroundField
 channels={results.atmos.channel_energy}
 heightRatio={results.atmos.height_ratio}
 centerExtraction={results.atmos.center_extraction}
 />
 </CollapsibleSection>

 {/* Per-object trajectory heatmap — only present when ADM has per-object position */}
 {results.atmos_object_view && results.atmos_object_view.object_count > 0 && (
 <CollapsibleSection
 title="Object Trajectories"
 tooltip="Per-object position data from the ADM metadata. Shows where in the Atmos sphere each object sits, how it moves, and how much it uses height channels."
 why="The best test for whether a mix uses Atmos creatively or pays lip-service to it. Static heatmap concentrated at L/R = same mix as stereo. Spread across height and rears = genuine spatial design."
 >
 <AtmosObjectView view={results.atmos_object_view} />
 </CollapsibleSection>
 )}

 <CollapsibleSection
 title="Channel Energy (Atmos)"
 tooltip="Measured directly from the Atmos file: RMS level for each channel in the bed. Shows how audio energy is distributed across ear-level, height, and LFE channels."
 why="Silent channels in Atmos indicate unused real-estate or a bed-only delivery. Compare against the track's intent."
 >
 <AtmosChannelEnergy
 channels={results.atmos.channel_energy}
 layout={results.atmos.channel_layout}
 objectCount={results.atmos.object_count}
 objectEnergyDb={results.atmos.object_energy_db}
 hasAdm={results.atmos.has_adm}
 />

 {results.atmos_channels && results.atmos_channels.length > 0 && (
 <div className="mt-4 space-y-1.5">
 <span className="text-xs font-medium text-dark-300">Channel Content Analysis</span>
 {results.atmos_channels.map(ch => (
 <div key={ch.channel} className="flex items-center gap-3 px-3 py-2 bg-dark-800/30" style={{ borderRadius: '2px' }}>
 <span className="text-[11px] font-mono text-dark-400 w-8">{ch.channel}</span>
 <span className={`text-[10px] font-mono w-14 ${ch.is_active ? 'text-dark-300' : 'text-dark-600'}`}>
 {ch.is_active ? `${ch.level_db.toFixed(1)} dB` : 'silent'}
 </span>
 <span className="text-[10px] text-dark-500 flex-1">{ch.description}</span>
 {ch.is_active && ch.dynamic_range_db > 0 && (
 <span className="text-[9px] text-dark-600">DR {ch.dynamic_range_db.toFixed(1)} dB</span>
 )}
 </div>
 ))}
 </div>
 )}
 </CollapsibleSection>

 </>
 )}
 </>)}

 {atmosView === 'downmix' && !isAtmosSolo && (<>
 {/* Downmix-scoped QC checks — pulled out of the main Atmos QC list
 so the two tabs stay cleanly separated by concern. */}
 {results.atmos_qc && (
 <CollapsibleSection
 title="Downmix QC Checks"
 tooltip="Quality checks that apply to the stereo fold-down of the Atmos file: what listeners on non-Atmos platforms (Spotify, Apple Music stereo, YouTube) will actually hear."
 why="Most of your audience hears the downmix, not the Atmos mix. These checks are what matter for stereo streaming delivery."
 >
 <AtmosQCPanel qc={results.atmos_qc} scope="downmix-only" />
 </CollapsibleSection>
 )}

 {results.atmos && (
 <>
 <CollapsibleSection
 title="Downmix Fidelity"
 tooltip="Compares the original stereo mix against the Atmos stereo downmix (level-matched). Shows tonal differences when the Atmos mix is folded down to stereo."
 why="The Atmos renderer does not produce a stereo twin of your stereo mix. It produces a phase-coherent fold-down with its own LFE and surround summing. Kick can get quieter, vocals can shift pan, reverb tails can go wide. Downmix-fidelity flags the tonal drift so you can adjust bed levels or send a separate stereo bounce."
 >
 <DownmixDelta
 delta={results.atmos.downmix_delta}
 surroundBalance={results.atmos.surround_balance}
 lfe={results.atmos.lfe}
 />
 </CollapsibleSection>

 {results.atmos.missing_elements && (
 <CollapsibleSection
 title="Missing Elements"
 tooltip="Detects mix elements (kick, snare, vocals, etc.) that are significantly quieter or absent in the Atmos downmix compared to the stereo original."
 why="The stereo downmix reaches about 90% of your audience (anyone not on an Atmos-capable Apple Music / Tidal / Amazon setup). If the kick disappears or the vocal drops 3 dB in the fold-down, most listeners hear the wrong mix. Flag offenders before they ship."
 badge={
 results.atmos.missing_elements.length > 0 ? (
 <span className="text-[10px] px-2 py-0.5" style={{ borderRadius: '2px',
 color: results.atmos.missing_elements.some(e => e.severity === 'missing') ? 'var(--color-danger)' : 'var(--color-accent)',
 backgroundColor: results.atmos.missing_elements.some(e => e.severity === 'missing') ? 'rgba(224,90,90,0.1)' : 'rgba(150,128,58,0.1)',
 }}>
 {results.atmos.missing_elements.length} detected
 </span>
 ) : (
 <span className="text-[10px] px-2 py-0.5" style={{ borderRadius: '2px', color: '#6ec577', backgroundColor: 'rgba(110,197,119,0.1)' }}>
 All present
 </span>
 )
 }
 >
 <MissingElements elements={results.atmos.missing_elements} />
 </CollapsibleSection>
 )}
 </>
 )}

 {results.spectrum_a && results.spectrum_b && (
 <CollapsibleSection
 title="Downmix Frequency Spectrum"
 tooltip="EQ curve comparison: original stereo vs Atmos stereo downmix across 31 frequency bands."
 why="The Atmos fold-down EQs differently than your stereo mix: height objects sum into mid content, surrounds sum into side, LFE gets re-routed. The 31-band delta shows which region shifted (lost low-mids? gained sibilance?) so you can correct the bed or raise a stem level before re-render."
 >
 <SpectrumOverlay
 spectrumA={results.spectrum_a}
 spectrumB={results.spectrum_b}
 midSpectrumA={results.mid_spectrum_a}
 midSpectrumB={results.mid_spectrum_b}
 sideSpectrumA={results.side_spectrum_a}
 sideSpectrumB={results.side_spectrum_b}
 labelA={labelA}
 labelB={`${labelB} (Downmix)`}
 />
 </CollapsibleSection>
 )}

 {advancedQc && results.mono_compat && (
 <CollapsibleSection
 title="Downmix Mono Compatibility · Advanced"
 tooltip="How much audio is lost when the stereo downmix is collapsed to mono. Matters for phone speakers and Bluetooth. Single-number version lives in the Verdict badge."
 why="The fold-down is phase-coherent in theory, but the bed ↔ object sum can still cancel in mono. Clubs, phone speakers, smart-speaker mono playback, and most Bluetooth pair modes sum to mono. If the downmix collapses there, half your listeners lose the bass or the vocal. Verify the fold-down survives the collapse."
 defaultOpen={false}
 >
 <MonoCompat mono={results.mono_compat} labelA={labelA} labelB={`${labelB} (Downmix)`} />
 </CollapsibleSection>
 )}

 {results.vectorscope_a && results.vectorscope_b && (
 <CollapsibleSection
 title="Downmix Vectorscope"
 tooltip="Stereo image comparison between original stereo and Atmos downmix."
 why="The Atmos downmix often ends up wider than the native stereo mix because surround objects get summed into side. A too-wide downmix reads as 'phasey' on earbuds and can trip platform limiter thresholds. Fastest visual read on how the fold-down's stereo picture compares."
 defaultOpen={false}
 >
 <Vectorscope
 pointsA={results.vectorscope_a}
 pointsB={results.vectorscope_b}
 labelA={labelA}
 labelB={`${labelB} (Downmix)`}
 />
 </CollapsibleSection>
 )}

 {results.phase_over_time_a && results.phase_over_time_b && results.duration_sec && (
 <CollapsibleSection
 title="Downmix Phase Correlation"
 tooltip="L/R phase relationship of the stereo downmix over time."
 why="Atmos fold-downs can have section-specific phase problems the full-track correlation number hides. A bridge that introduces a rear-surround object can dip the downmix correlation into negative territory for 15 seconds. Timeline catches the moment, not the average."
 defaultOpen={false}
 >
 <PhaseCorrelation
 phaseOverTimeA={results.phase_over_time_a}
 phaseOverTimeB={results.phase_over_time_b}
 labelA={labelA}
 labelB={`${labelB} (Downmix)`}
 durationSec={results.duration_sec}
 />
 </CollapsibleSection>
 )}
 </>)}
 </div>
 )}

 {/* ─── STEREO & SPECTRUM TAB ─── */}
 {activeTab === 'stereo' && (
 <div className="space-y-6">
 <TabVerdict tab="stereo" results={results} isAtmos={isAtmos} />
 {results.spectrum_a && results.spectrum_b && (
 <CollapsibleSection
 title="Frequency Spectrum"
 tooltip="EQ curve comparison across 31 frequency bands. Shows exactly where tonal changes were made: boosts and cuts in the low end, mids, and highs."
 why="Tonal balance is the #1 thing separating amateur and pro masters. Your ears adapt to whatever you've been listening to; the spectrum never lies. Compare against a reference for objective EQ decisions, not fatigue-biased ones."
 >
 <SpectrumOverlay
 spectrumA={results.spectrum_a}
 spectrumB={results.spectrum_b}
 midSpectrumA={results.mid_spectrum_a}
 midSpectrumB={results.mid_spectrum_b}
 sideSpectrumA={results.side_spectrum_a}
 sideSpectrumB={results.side_spectrum_b}
 labelA={labelA}
 labelB={labelB}
 />
 </CollapsibleSection>
 )}

 {advancedQc && results.mono_compat && (
 <CollapsibleSection
 title="Mono Compatibility · Advanced"
 tooltip="Tests how much audio is lost when left and right channels are combined (mono). Single-number version lives in the Verdict badge; this is the full per-band breakdown."
 why="Most of your audience hears the track on phone speakers, Bluetooth earbuds, clubs (often summed to mono below 100 Hz), and radio. If your sub cancels in mono, bass disappears for half your listeners. Check before bouncing."
 defaultOpen={false}
 >
 <MonoCompat mono={results.mono_compat} labelA={labelA} labelB={labelB} />
 </CollapsibleSection>
 )}

 {results.phase_over_time_a && results.phase_over_time_b && results.duration_sec && (
 <CollapsibleSection
 title="Phase Correlation"
 tooltip="L/R phase relationship over time. +1 = perfectly correlated (mono compatible), 0 = uncorrelated, -1 = out of phase (will cancel in mono). Red zones indicate potential problems."
 why="Broadband correlation is an average. A mix can score +0.7 overall and still have a chorus dipping into red for ten seconds, and that window is exactly when the club subs cancel. Phase over time catches the section-level cancellation the single number misses."
 defaultOpen={false}
 >
 <PhaseCorrelation
 phaseOverTimeA={results.phase_over_time_a}
 phaseOverTimeB={results.phase_over_time_b}
 labelA={labelA}
 labelB={labelB}
 durationSec={results.duration_sec}
 />
 </CollapsibleSection>
 )}

 {advancedQc && results.phase_bands_a && results.phase_bands_a.length > 0 && (
 <CollapsibleSection
 title="Phase Correlation — Per Band · Advanced"
 tooltip="Broadband correlation can hide sub-band problems. Watch Sub/Bass for cancellation that vanishes on phone speakers."
 why="A mix can look mono-compatible broadband (+0.9 correlation overall) but still cancel catastrophically at 60 Hz. The low end is where mono collapse does the most damage; broadband correlation misses it."
 defaultOpen={false}
 >
 <PhaseBandsPanel
 bandsA={results.phase_bands_a}
 bandsB={results.phase_bands_b}
 labelA={labelA}
 labelB={labelB}
 />
 </CollapsibleSection>
 )}

 {results.vectorscope_a && results.vectorscope_b && (
 <CollapsibleSection
 title="Stereo Vectorscope"
 tooltip="Lissajous display showing stereo image shape. Vertical spread = mono content (kick, bass, vocals). Horizontal spread = stereo content (reverbs, panned elements). A wider shape = wider stereo image."
 why="The vectorscope is the fastest visual test for stereo character. A narrow vertical shape means a mostly-mono mix; a wide horseshoe means lots of side content. Diagonal tilts indicate L/R balance issues."
 defaultOpen={false}
 >
 <Vectorscope
 pointsA={results.vectorscope_a}
 pointsB={results.vectorscope_b}
 labelA={labelA}
 labelB={labelB}
 />
 </CollapsibleSection>
 )}

 {results.stereo_timeline_a && results.stereo_timeline_a.width && results.stereo_timeline_a.width.length > 2 && (
 <CollapsibleSection
 title="Stereo Image Over Time"
 tooltip="Section-by-section width, correlation, and balance timelines. Catches accidental pan drift, stereo collapses, and bridge/drop width changes."
 why="A mix can measure fine on the vectorscope average but drift wide or narrow between sections. Timeline catches the bridge that accidentally went mono, the drop that's too wide, the take subtly panned left."
 defaultOpen={false}
 >
 <StereoTimeline
 timelineA={results.stereo_timeline_a}
 timelineB={results.stereo_timeline_b || { width: [], correlation: [], balance: [] }}
 labelA={labelA}
 labelB={labelB}
 durationSec={results.duration_sec}
 soloA={isSolo}
 />
 </CollapsibleSection>
 )}
 </div>
 )}

 {/* ─── QUALITY TAB ─── */}
 {activeTab === 'quality' && (
 <div className="space-y-6">
 <TabVerdict tab="quality" results={results} isAtmos={isAtmos} />
 {/* Hum / 50-60 Hz detector */}
 {results.hum && results.hum.mains > 0 && (
 <CollapsibleSection
 title="Hum / Buzz Check"
 tooltip="Scans for AC mains hum (50/60 Hz) and its harmonics."
 why="Ground loops, poor shielding, and interference inject audible hum. Once present it's hard to remove but trivial to spot with notch EQ. This panel tells you exactly where."
 >
 <HumPanel hum={results.hum} />
 </CollapsibleSection>
 )}

 {/* Streaming normalization preview moved to Overview (second card)
 per expert panel — "will this get turned down?" is an Overview
 question, not a QC finding. */}

 {/* File Metadata moved to the Delivery tab. */}

 {/* Tempo drift timeline — archival / DJ-pool use case. Hidden
 behind Advanced QC since rock / pop / hip-hop engineers
 don't use it (flagged as clutter by 3 voices). */}
 {advancedQc && results.reference_check?.song_info && (results.reference_check.song_info as any).tempo_drift && (
 <CollapsibleSection
 title="Tempo Over Time · Archival"
 tooltip="Windowed BPM across the track. A non-flat line suggests un-quantised / live / modulating tempo: useful for DJs, remixers, and classical reissues."
 why="Constant tempo = DJ-friendly, quantisable, loopable. Variable tempo means manual cue-points, no beat-grid sync, harder remix work. Archival / classical also cares: confirms the source is an un-quantised performance, not a grid-locked export."
 defaultOpen={false}
 >
 <TempoDriftPanel drift={(results.reference_check.song_info as any).tempo_drift} />
 </CollapsibleSection>
 )}

 {results.distortion && (
 <CollapsibleSection
 title="Distortion Check"
 tooltip="Checks for clipping (samples hitting digital ceiling), inter-sample peaks (true peaks exceeding 0 dBTP), over-limiting (flat-topped waveforms), and new harmonic distortion from processing."
 why="Inter-sample peaks above 0 dBTP create audible clicks on MP3/AAC playback even when the source file looks clean. Streaming platforms will also engage their limiters. Fix with a -1 dBTP ceiling before encoding."
 badge={
 <span className="text-xs px-2 py-0.5" style={{ borderRadius: '2px',
 color: results.distortion.severity === 'clean' ? '#6ec577' : results.distortion.severity === 'warning' ? 'var(--color-accent)' : 'var(--color-danger)',
 backgroundColor: results.distortion.severity === 'clean' ? 'rgba(110,197,119,0.1)' : results.distortion.severity === 'warning' ? 'rgba(150,128,58,0.1)' : 'rgba(224,90,90,0.1)',
 }}>
 {results.distortion.severity === 'clean' ? 'Clean' : results.distortion.severity === 'warning' ? 'Warning' : 'Problem'}
 </span>
 }
 >
 <DistortionPanel distortion={results.distortion} labelA={labelA} labelB={labelB} />
 </CollapsibleSection>
 )}

 {/* Limiter-artefact granular metrics — pumping / ISO overs /
 HF ringing. Sits next to Distortion Check because the two
 detectors answer adjacent questions ("does it clip?" vs
 "is the limiter mangling transients?"). */}
 {results.limiter_artefacts && (
 <LimiterArtefactsPanel artefacts={results.limiter_artefacts} />
 )}

 <CollapsibleSection
 title="Clicks & Glitches"
 tooltip="Scans for sample-level spikes: single-sample discontinuities caused by bad edits, buffer glitches, or plugin artifacts. Only flags true digital artifacts, not musical transients like drum hits."
 why="Digital clicks are almost always unintended: bad edits, buffer underruns, plugin glitches. Even one is a defect. On headphones they're impossible to unhear. Catch these before mastering, not after a listener tweets about it."
 badge={
 <span className="text-xs px-2 py-0.5" style={{ borderRadius: '2px',
 color: results.clicks && results.clicks.length > 0 ? 'var(--color-accent)' : '#6ec577',
 backgroundColor: results.clicks && results.clicks.length > 0 ? 'rgba(150,128,58,0.1)' : 'rgba(110,197,119,0.1)',
 }}>
 {results.clicks && results.clicks.length > 0 ? `${results.clicks.length} found` : 'Clean'}
 </span>
 }
 >
 {results.clicks && results.clicks.length > 0 ? (
 <ClickTimeline
 clicks={results.clicks}
 labelB={labelB}
 fileA={fileA}
 fileB={fileB}
 waveform={results.waveform_b}
 durationSec={results.duration_sec}
 />
 ) : (
 <div className="flex items-center gap-3 py-2">
 <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(110,197,119,0.1)' }}>
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#6ec577" strokeWidth={2}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
 </svg>
 </div>
 <div>
 <p className="text-sm" style={{ color: '#e7e5e4' }}>No clicks or glitches detected</p>
 <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Clean signal — no sample-level artifacts found</p>
 </div>
 </div>
 )}
 </CollapsibleSection>

 </div>
 )}
 {/*
 Reference tab removed per expert panel consensus — the unique
 signals (reference clipping count, tonal issues, status) are
 surfaced inline in the Overview comparison table and column-A
 hover. Users who want a dedicated single-file deep dive use
 'Analyze Reference Only' from the upload screen.
 */}

 {/* ─── MATCH TAB (unified Reference / Engineer / Hybrid) ─── */}
 {activeTab === 'match' && (
 <div className="space-y-6">
 <TabVerdict tab="match" results={results} isAtmos={isAtmos} />
 <MatchTab
 results={results}
 fileB={fileB}
 labelA={labelA}
 labelB={labelB}
 />
 </div>
 )}

 {/* ─── LEARN MODE: Annotation Layer ─── */}
 {/* Mounted once and keyed to the active tab so annotations are
     scoped per-tab per-step. Renders as a fixed overlay so it
     works identically regardless of which tab is showing. */}
 {learnEnabled && <AnnotationLayer tabId={activeTab} />}

 </div>
 )
}

function MetricBox({ label, value, sub, tooltip }: { label: string; value: string; sub: string; tooltip?: string }) {
 return (
 <div className="p-5 text-left space-y-1.5" style={{ borderRadius: '2px', backgroundColor: 'rgba(48,44,39,0.5)' }}>
 <div className="flex items-center gap-1">
 <p className="text-[10px] tracking-widest uppercase" style={{ color: '#968d7e' }}>{label}</p>
 {tooltip && <InfoTooltip text={tooltip} />}
 </div>
 <p className="font-display italic text-xl text-terra">{value}</p>
 <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{sub}</p>
 </div>
 )
}

const TOLERANCE_NOTABLE = 4.0

function formatTimeMins(seconds: number): string {
 const mins = Math.floor(seconds / 60)
 const secs = Math.floor(seconds % 60)
 return `${mins}:${secs.toString().padStart(2, '0')}`
}

function makeCurvePath(data: number[], w: number, h: number, maxDb: number): string {
 const points = data.map((v, i) => ({
 x: (i / (data.length - 1)) * w,
 y: h / 2 - (v / maxDb) * (h / 2),
 }))
 if (points.length < 2) return ''
 let d = `M ${points[0].x} ${points[0].y}`
 for (let i = 1; i < points.length; i++) {
 const prev = points[i - 1]
 const curr = points[i]
 const cpx = (prev.x + curr.x) / 2
 d += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`
 }
 return d
}

/**
 * Per-element drawer — outliers always visible at top, balanced section
 * expanded by default with a HIDE affordance.
 *
 * 5.7.x: this is the look Mike approved on iteration 3. Earlier:
 *  - Original: balanced hidden behind "Show 7 balanced elements" CTA.
 *    Reads as "still hidden" on well-matched mixes.
 *  - Iter 2 (drawer rewrite): no fold UI at all, plain grid. Functional
 *    but visually inconsistent with the "Balanced · within ±0.5 dB"
 *    label Mike has in his head from earlier builds.
 *  - This version (final): keep the labelled balanced section + HIDE
 *    button on the right, but seed `showBalanced = true` so the rows
 *    are visible the moment the panel renders. Click HIDE to collapse
 *    back to a single "Show N balanced" link if the user wants compact.
 */
function PerElementDrawer({ outliers, balanced, labelA, labelB }: {
 outliers: import('../types').Category[]
 balanced: import('../types').Category[]
 labelA: string
 labelB: string
}) {
 // Default-visible — was `useState(false)` originally, that's the
 // "still hidden" bug Mike caught.
 const [showBalanced, setShowBalanced] = useState(true)

 if (outliers.length === 0 && balanced.length === 0) {
 return <p className="text-[11px] text-dark-500">No per-element data available.</p>
 }

 return (
 <div className="space-y-3">
 {outliers.length > 0 && (
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
 {outliers.map(cat => (
 <CategoryCard key={cat.name} category={cat} labelA={labelA} labelB={labelB} />
 ))}
 </div>
 )}
 {balanced.length > 0 && (
 <div className="pt-1">
 {!showBalanced ? (
 <button
 onClick={() => setShowBalanced(true)}
 className="text-[10px] tracking-[0.14em] uppercase transition-colors hover:text-[#d0b066]"
 style={{ color: 'var(--color-text-muted)' }}
 >
 Show {balanced.length} balanced element{balanced.length === 1 ? '' : 's'} <span className="opacity-70">(within ±0.5 dB)</span>
 </button>
 ) : (
 <>
 <div className="flex items-center justify-between mb-2">
 <span className="text-[10px] tracking-[0.14em] uppercase" style={{ color: 'var(--color-text-muted)' }}>
 Balanced · within ±0.5 dB
 </span>
 <button
 onClick={() => setShowBalanced(false)}
 className="text-[10px] uppercase tracking-[0.14em] transition-colors hover:text-sand-200"
 style={{ color: 'var(--color-text-muted)' }}
 >
 Hide
 </button>
 </div>
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
 {balanced.map(cat => (
 <CategoryCard key={cat.name} category={cat} labelA={labelA} labelB={labelB} />
 ))}
 </div>
 </>
 )}
 </div>
 )}
 </div>
 )
}

/**
 * Always-visible cockpit strip — the sticky band under the tabs that carries
 * the four metrics every engineer / A&R / producer glances at constantly.
 * · LUFS-I (integrated loudness)
 * · TP (true peak)
 * · LRA (dynamic range)
 * · Mono (compatibility risk, as a traffic-light dot)
 *
 * Each metric shows B's value in the foreground and the Δ-from-A in gold
 * immediately below. TP cell turns warm-orange when over −1 dBTP. Mono dot
 * goes green / amber / red based on the weighted risk score.
 *
 * Keeps the old filename strip too — just promoted to a two-row layout.
 * `CockpitMetric` inside is the reusable cell. Binaural TP tacks on at the
 * far right only when Atmos is loaded.
 */
function CockpitStrip({ results, labelA, labelB, isAtmos }: {
 results: AnalysisResult
 labelA: string
 labelB: string
 isAtmos: boolean
}) {
 // Pull metrics + compute Δs once. Atmos mode swaps in the Atmos-native
 // LUFS/TP when the backend provided them — matches the Overview hero.
 const lufsA = results.overall.lufs_a
 const lufsB = (isAtmos && results.atmos_qc?.specs?.loudness_lufs != null)
 ? results.atmos_qc.specs.loudness_lufs
 : results.overall.lufs_b
 const tpA = results.headroom?.true_peak_a
 const tpB = (isAtmos && results.atmos_qc?.specs?.true_peak_dbtp != null)
 ? results.atmos_qc.specs.true_peak_dbtp
 : results.headroom?.true_peak_b
 const lraA = results.overall.dynamics_a
 const lraB = results.overall.dynamics_b

 // Mono-compat — weighted risk is 0-100, lower is better.
 const monoRiskB = results.mono_compat
 ? ((results.mono_compat as any).risk_b ?? results.mono_compat.mono_loss_b_pct)
 : null
 const monoRiskA = results.mono_compat
 ? ((results.mono_compat as any).risk_a ?? results.mono_compat.mono_loss_a_pct)
 : null
 const monoDotColour = monoRiskB == null
 ? '#3e3a33'
 : monoRiskB > 25 ? 'var(--color-danger)'
 : monoRiskB > 12 ? 'var(--color-accent)'
 : '#6ec577'

 // TP warnings disabled by user direction — show numbers only.
 const tpWarn = false
 void (tpB != null && tpB > -1.0)
 const btp = results.atmos?.binaural_tp?.true_peak_db
 const btpWarn = false
 void (btp != null && btp > -1.0)

 return (
 <div className="border-t border-dark-700/20">
 {/* Row 1 — filenames + durations (unchanged visual language). */}
 <div className="flex items-center justify-center gap-3 px-4 pt-1 text-[10px] text-sand-500 flex-wrap">
 <span className="font-mono truncate max-w-[30ch]" style={{ color: '#6b8cbb' }} title={labelA}>{labelA}</span>
 <span className="font-mono opacity-70" style={{ color: '#6b8cbb' }}>
 {formatDuration(results.duration_sec_a ?? results.duration_sec)}
 </span>
 <span className="opacity-50">vs</span>
 <span className="font-mono truncate max-w-[30ch]" style={{ color: 'var(--color-accent)' }} title={labelB}>{labelB}</span>
 <span className="font-mono opacity-70" style={{ color: 'var(--color-accent)' }}>
 {formatDuration(results.duration_sec_b ?? results.duration_sec)}
 </span>
 </div>

 {/* Row 2 — cockpit metrics. Each cell: label, big B value, Δ in gold. */}
 <div className="flex items-center justify-center gap-0 py-1.5 flex-wrap">
 <CockpitMetric
 label="LUFS-I"
 value={`${lufsB.toFixed(1)}`}
 unit="LUFS"
 delta={lufsB - lufsA}
 deltaUnit="dB"
 />
 <CockpitMetric
 label="TP"
 value={tpB != null ? tpB.toFixed(1) : '—'}
 unit="dBTP"
 delta={tpA != null && tpB != null ? tpB - tpA : null}
 deltaUnit="dB"
 warn={tpWarn}
 />
 <CockpitMetric
 label="LRA"
 value={lraB != null ? lraB.toFixed(1) : '—'}
 unit="LU"
 delta={lraA != null && lraB != null ? lraB - lraA : null}
 deltaUnit="LU"
 title="LRA — Loudness Range (BS.1770-4). Difference between loudest and quietest gated sections, in LU. 4–8 LU = modern pop; <4 = squashed; >12 = unusually dynamic."
 />
 {/* Mono dot — colour-coded traffic light, numeric risk in brackets. */}
 <div className="inline-flex items-center gap-2 px-4 py-1 border-l" style={{ borderColor: 'rgba(168,161,150,0.1)' }}>
 <span className="text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-muted)' }}>Mono</span>
 <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: monoDotColour }} title={monoRiskB != null ? `Mono-compat risk: ${Math.round(monoRiskB)} / 100${monoRiskA != null ? ` · reference ${Math.round(monoRiskA)}` : ''}` : 'Mono-compat unknown'} />
 {monoRiskB != null && (
 <span className="font-mono tabular-nums text-[10px]" style={{ color: '#a8a29e' }}>
 {Math.round(monoRiskB)}
 </span>
 )}
 </div>
 {/* Binaural TP — Atmos only. Surfaced alongside the other cockpit
 cells so label/ops don't need to tab into Atmos to spot a breach. */}
 {isAtmos && btp != null && (
 <div className="inline-flex items-center gap-2 px-4 py-1 border-l" style={{ borderColor: 'rgba(168,161,150,0.1)' }}
 title={btpWarn ? 'ILD-approx binaural headroom is over Apple\'s −1 dBTP guideline. Verify on Apple\'s renderer before delivery — this is not a substitute.' : 'ILD-approx binaural-headroom estimate (no HRTF render). Apple\'s renderer is the authority for delivery sign-off.'}>
 <span className="text-[11px] uppercase tracking-[0.14em]" style={{ color: btpWarn ? '#e07a4f' : 'var(--color-slate-blue)' }}>
 Binaural TP <span style={{ color: 'var(--color-text-muted)' }}>(approx)</span>
 </span>
 <span className="font-mono tabular-nums text-[11px]" style={{ color: btpWarn ? '#e07a4f' : 'var(--color-text-primary)' }}>
 {btp.toFixed(1)}
 </span>
 <span className="text-[11px] tracking-[0.14em] uppercase" style={{ color: 'var(--color-text-muted)' }}>dBTP</span>
 </div>
 )}
 </div>
 </div>
 )
}

/**
 * One cell of the cockpit strip — label on top, big B value in the middle,
 * gold Δ underneath. Warn state swaps the value colour to warm-orange.
 */
function CockpitMetric({ label, value, unit, delta, deltaUnit, warn, title }: {
 label: string
 value: string
 unit: string
 delta: number | null
 deltaUnit: string
 warn?: boolean
 title?: string
}) {
 const fmtDelta = (d: number | null) => {
 if (d == null || !isFinite(d)) return ''
 if (Math.abs(d) < 0.05) return '±0'
 const sign = d > 0 ? '+' : '−'
 return `${sign}${Math.abs(d).toFixed(1)}`
 }
 const deltaStr = fmtDelta(delta)
 return (
 <div className="inline-flex items-center gap-2 px-4 py-1 border-l first:border-l-0" style={{ borderColor: 'rgba(168,161,150,0.1)' }} title={title}>
 <span className="text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
 <span
 className="font-mono tabular-nums text-[11px]"
 style={{ color: warn ? '#e07a4f' : 'var(--color-text-primary)' }}
 >
 {value}
 </span>
 <span className="text-[11px] tracking-[0.14em] uppercase" style={{ color: 'var(--color-text-muted)' }}>{unit}</span>
 {deltaStr && (
 <span
 className="font-mono tabular-nums text-[10px]"
 style={{ color: 'var(--color-accent)', opacity: deltaStr === '±0' ? 0.5 : 1 }}
 title={`Δ vs reference${deltaUnit ? ` (${deltaUnit})` : ''}`}
 >
 {deltaStr}
 </span>
 )}
 </div>
 )
}

/**
 * Compact reference-quality indicator — a single colored dot next to the
 * reference filename in the Overview comparison table. Hovering reveals the
 * status summary plus any unique signals that used to live on the dedicated
 * Reference tab (clip count, tonal issues, BPM, key). Keeps the "is my
 * reference actually usable as a target?" check available without stealing
 * a whole tab from the main flow.
 */
function RefStatusDot({ check, labelA }: { check: any; labelA: string }) {
 const status = check?.status || 'good'
 const colour = status === 'good' ? '#6ec577' : status === 'fair' ? 'var(--color-accent)' : 'var(--color-danger)'
 const clipCount = check?.stats?.clip_count ?? 0
 const bpm = check?.song_info?.bpm
 const key = check?.song_info?.key
 const tonalIssueCount = (check?.tonal_issues || []).length
 const lines: string[] = []
 lines.push(`${labelA} — reference quality: ${status.toUpperCase()}`)
 if (check?.summary) lines.push(check.summary)
 if (bpm) lines.push(`BPM ${bpm}${key ? ` · Key ${key}` : ''}`)
 if (clipCount > 0) lines.push(`${clipCount} clipped sample${clipCount === 1 ? '' : 's'}`)
 if (tonalIssueCount > 0) lines.push(`${tonalIssueCount} tonal issue${tonalIssueCount === 1 ? '' : 's'}`)
 if (status === 'good' && clipCount === 0 && tonalIssueCount === 0) {
 lines.push('No issues — clean target.')
 }
 return (
 <span
 className="inline-block rounded-full"
 style={{
 width: 8,
 height: 8,
 backgroundColor: colour,
 }}
 title={lines.join('\n')}
 aria-label={`Reference quality: ${status}`}
 />
 )
}

function StatBox({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
 return (
 <div className="p-3 text-center space-y-1" style={{ borderRadius: '2px', backgroundColor: 'rgba(48,44,39,0.5)' }}>
 <p className="text-[9px] tracking-widest uppercase" style={{ color: '#78716c' }}>{label}</p>
 <p className="text-sm font-medium font-mono tabular-nums" style={{ color: warn ? 'var(--color-danger)' : '#e7e5e4' }}>{value}</p>
 {sub && <p className="text-[9px]" style={{ color: 'var(--color-text-muted)' }}>{sub}</p>}
 </div>
 )
}

function stripExt(name: string): string {
 return name.replace(/\.[^/.]+$/, '')
}

// Translate the 0–1 side/(mid+side) ratio into a vocabulary that makes sense
// to human ears. Numbers like "0.117" are meaningless to most users.
function describeWidth(w: number | undefined | null): string {
 if (w == null || isNaN(w as number)) return '—'
 if (w < 0.03) return 'Near-mono'
 if (w < 0.08) return 'Tight'
 if (w < 0.15) return 'Balanced'
 if (w < 0.25) return 'Wide'
 if (w < 0.40) return 'Very wide'
 return 'Extreme / M/S heavy'
}

function widthDelta(a: number, b: number): string {
 const da = describeWidth(a)
 const db = describeWidth(b)
 if (da === db) return 'Same'
 if ((b - a) > 0.02) return 'Wider'
 if ((b - a) < -0.02) return 'Tighter'
 return 'Same'
}
