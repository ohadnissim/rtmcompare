import React, { useState, useCallback, useMemo, useEffect } from 'react'
import { ReferenceCheck, ClickArtifact, DistortionResult, TonalIssue, MonoCompatibility, EngineerTips, AnalysisResult } from '../types'
import InfoTooltip from './InfoTooltip'
import { TeachTerm } from '../teachMe'
import DurationPill, { formatDuration } from './DurationPill'
import ClickTimeline from './ClickTimeline'
import DistortionPanel from './DistortionPanel'
import TonalIssues from './TonalIssues'
import CollapsibleSection from './CollapsibleSection'
import SpectrumOverlay from './SpectrumOverlay'
import { levelAlign } from '../lib/spectrumLevel'
import Vectorscope from './Vectorscope'
import PhaseCorrelation from './PhaseCorrelation'
import MonoCompat from './MonoCompat'
import WaveformCompare from './WaveformCompare'
import PhaseBandsPanel from './PhaseBandsPanel'
import TempoDriftPanel from './TempoDriftPanel'
import MaskingPanel from './MaskingPanel'
import HumPanel from './HumPanel'
import DeclickPanel from './DeclickPanel'
import TransientDensityPanel from './TransientDensityPanel'
import StreamingPreview from './StreamingPreview'
import LoudnessOverTime from './LoudnessOverTime'
import ReadyToDeliverVerdict from './ReadyToDeliverVerdict'
import AttentionList from './AttentionList'
import CommandPalette from './CommandPalette'
import LimiterArtefactsPanel from './LimiterArtefactsPanel'
import MasterAssistantPanel from './MasterAssistantPanel'
import MetadataPanel from './MetadataPanel'
import ABPlayer from './ABPlayer'
import {
 metricsFromFull, buildVerdict, buildAttentionItems,
 formatMetadataStrip, SingleFileMetrics,
 computeAdmReadiness,
} from '../singleFileHelpers'
import { DSP_PROFILES, evaluateAgainstProfile } from '../dspProfiles'
import { useModes } from '../ModesContext'
import { usePluginDrop } from '../PluginDropContext'
import SpecDriftBadge from './SpecDriftBadge'

interface Props {
 check: {
 reference_check: ReferenceCheck
 clicks?: ClickArtifact[]
 distortion?: DistortionResult
 tonal_issues?: TonalIssue[]
 overall?: { short_term_max_a?: number; short_term_max_b?: number; width_a?: number; lufs_a?: number; dynamics_a?: number }
 spectrum_a?: number[]
 spectrum_b?: number[]
 mid_spectrum_a?: number[]
 side_spectrum_a?: number[]
 vectorscope_a?: { l: number; r: number }[]
 phase_over_time_a?: number[]
 phase_bands_a?: { name: string; freq_range: string; correlation: number }[]
 mono_compat?: MonoCompatibility
 duration_sec?: number
 waveform_a?: number[]
 engineer_tips?: EngineerTips
 masking?: { overlaps: any[]; stem_based: boolean }
 hum?: any
 transient_density?: any
 streaming_preview?: AnalysisResult['streaming_preview']
 sample_rate?: number | null
 bit_depth?: number | null
 channels?: number | null
 isrc?: string | null
 mono_compat_loss_pct?: number | null
 clipped_samples?: number | null
 metadata?: { a?: any; b?: any } | null
 dialog_gate?: { lufs_i: number | null; speech_pct: number; confidence: 'high' | 'medium' | 'low' | 'none' | 'insufficient' | 'error'; note?: string } | null
 // Container / sample-rate / length warnings surfaced by analyze.py.
 // Rendered above the results so the engineer sees them first.
 file_warnings?: { type: string; message: string }[]
 generation_loss?: AnalysisResult['generation_loss']
 limiter_artefacts?: any
 headroom?: any
 lufs_over_time_b?: number[]
 spec_versions?: AnalysisResult['spec_versions']
 /** Full analysis result preserved so MasterAssistantPanel's
 * proposer sees every field (spectrum_b, engineer_tips, overall,
 * dynamics_b, comparison_mode, ...). */
 full_result?: AnalysisResult
 }
 fileName: string
 filePath?: string
}

const TOLERANCE_NOTABLE = 4.0

function makeCurvePath(data: number[], w: number, h: number, maxDb: number): string {
 // Guard up-front: a single-point array would have divided by zero
 // inside the map and poisoned every point with NaN before the
 // length<2 bail-out could catch it.
 if (!Array.isArray(data) || data.length < 2 || !(maxDb > 0)) return ''
 const denom = data.length - 1
 const points = data.map((v, i) => ({
 x: (i / denom) * w,
 y: h / 2 - (v / maxDb) * (h / 2),
 }))
 let d = `M ${points[0].x} ${points[0].y}`
 for (let i = 1; i < points.length; i++) {
 const prev = points[i - 1]
 const curr = points[i]
 const cpx = (prev.x + curr.x) / 2
 d += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`
 }
 return d
}

export default function RefOnlyView({ check: data, fileName, filePath }: Props) {
 const check = data.reference_check
 const clicks = data.clicks || []
 const distortion = data.distortion
 const tonalIssues = data.tonal_issues || []
 const overall = data.overall
 const label = fileName.replace(/\.[^/.]+$/, '')
 const { surface } = useModes()
 const pluginDrop = usePluginDrop()

 // ⌘K command palette — same as AnalysisView. Header Search button
 // dispatches 'rtm-open-palette'; we need to listen here too because
 // AnalysisView is not mounted in single-file mode.
 const [paletteOpen, setPaletteOpen] = useState(false)
 useEffect(() => {
 const onOpen = () => setPaletteOpen(true)
 const onKey = (e: KeyboardEvent) => {
 if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
 e.preventDefault(); setPaletteOpen(true)
 }
 }
 window.addEventListener('rtm-open-palette', onOpen)
 window.addEventListener('keydown', onKey)
 return () => {
 window.removeEventListener('rtm-open-palette', onOpen)
 window.removeEventListener('keydown', onKey)
 }
 }, [])

 // Attention checklist — tracks which items the user has signed off.
 // When all attention items are checked the export button shows "Send".
 const [checkedAttention, setCheckedAttention] = useState<Set<number>>(new Set())
 const toggleAttentionCheck = useCallback((idx: number) => {
 setCheckedAttention(prev => {
 const next = new Set(prev)
 next.has(idx) ? next.delete(idx) : next.add(idx)
 return next
 })
 }, [])

 // Inline disclosure so we don't have to stand up a new modal stack
 // for one panel. Opens beneath the Clicks timeline on demand.
 const [declickOpen, setDeclickOpen] = useState(false)

 const streamingPreviewRows = data.streaming_preview?.b || []
 const fileAInfo = filePath ? { path: filePath, name: fileName } : undefined

 // REF-B-1: allow the user to load a reference file into the A/B player
 // from within the single-file view. Previously fileB was always set to
 // fileAInfo (same file both sides — audibly identical). Now the user can
 // drag-and-drop or browse a reference track to compare in the player.
 const [refBInfo, setRefBInfo] = useState<{ path: string; name: string } | null>(null)
 // playerFileB: prefer the user-loaded reference; fall back to fileAInfo.
 // The cast is safe — this value is only consumed inside `{fileAInfo && …}`
 // where fileAInfo is already asserted non-null.
 const playerFileB = (refBInfo ?? fileAInfo) as import('../types').FileInfo

 const handleLoadRefB = async () => {
   const filePath = await window.electronAPI?.selectFile?.()
   if (!filePath) return
   setRefBInfo({ path: filePath, name: filePath.split('/').pop() ?? filePath })
 }

 // Compact metadata strip — same shape SongDetailPanel uses, so both
 // views read identically. Pulls SR / BD / channels / ISRC from
 // Props (plumbed by App.tsx from the analysis result).
 const singleFileMetrics: SingleFileMetrics = {
 lufs: check.stats?.lufs ?? null,
 true_peak: distortion?.true_peaks?.b_true_peak_db ?? null,
 lra: check.stats?.dynamic_range ?? null,
 duration_sec: data.duration_sec ?? null,
 sample_rate: data.sample_rate ?? null,
 bit_depth: data.bit_depth ?? null,
 channels: data.channels ?? null,
 isrc: data.isrc ?? (check.song_info as any)?.isrc ?? null,
 clipped_samples: data.clipped_samples ?? check.stats?.clip_count ?? null,
 mono_compat_loss_pct: data.mono_compat_loss_pct ?? null,
 short_term_max: overall?.short_term_max_a ?? null,
 dialog_lufs: data.dialog_gate?.lufs_i ?? null,
 }
 const metaStrip = formatMetadataStrip(singleFileMetrics)

 // Triage Mode — same opt-in as SongDetailPanel. Always on for
 // plugin-dropped files.
 const [triageMode, setTriageMode] = useState<boolean>(() => {
 try { return localStorage.getItem('rtm-triage-mode') === '1' } catch { return false }
 })
 const toggleTriage = useCallback(() => {
 setTriageMode(v => {
 const next = !v
 try { localStorage.setItem('rtm-triage-mode', next ? '1' : '0') } catch {}
 return next
 })
 }, [])
 // When the user is on the broadcast surface, pre-select a broadcast
 // DSP profile so compliance numbers surface immediately. Music
 // surface starts unset (generic).
 const [dspProfileId, setDspProfileId] = useState<string>(() => {
 try {
 const cached = localStorage.getItem('rtm-dsp-profile') || ''
 if (cached) return cached
 } catch {}
 return surface === 'broadcast' ? 'ebur128' : surface === 'post' ? 'netflix' : surface === 'netflix' ? 'netflix' : ''
 })
 const setDspProfile = useCallback((id: string) => {
 setDspProfileId(id)
 try { localStorage.setItem('rtm-dsp-profile', id) } catch {}
 // Panel fix: if a specific DSP is picked the user almost always
 // wants the compliance grid open — mismatch between the grid
 // (always shows 5 music DSPs) and the Attention list (filters to
 // the chosen profile) was flagged as confusing. Auto-open the
 // compliance view so the grid reads alongside the filtered
 // attention items.
 if (id) {
 setComplianceView(true)
 try { localStorage.setItem('rtm-compliance-view', '1') } catch {}
 }
 }, [])

 // Compliance view — toggles the per-DSP pass/fail grid inside the
 // verdict. 
 const [complianceView, setComplianceView] = useState<boolean>(() => {
 try { return localStorage.getItem('rtm-compliance-view') === '1' } catch { return false }
 })
 const toggleCompliance = useCallback(() => {
 setComplianceView(v => {
 const next = !v
 try { localStorage.setItem('rtm-compliance-view', next ? '1' : '0') } catch {}
 return next
 })
 }, [])

 // Build a richer partial so verdict / attention see limiter-artefact
 // + hum + clicks + distortion AND dialog-gate flags.
 // Consumers (buildVerdict / buildAttentionItems) take
 // `AnalysisResult | null | undefined` and guard every access with
 // optional chaining, so a Partial is a safe type here.
 const partialFull = useMemo<Partial<AnalysisResult>>(() => ({
 clicks, distortion, hum: data.hum,
 limiter_artefacts: data.limiter_artefacts,
 dialog_gate: data.dialog_gate,
 }), [clicks, distortion, data.hum, data.limiter_artefacts, data.dialog_gate])

 // DSP filter — the grid respects the user surface so broadcast
 // users see R128 / A85 / Netflix, streaming sees music + social
 // without broadcast clutter. Post surface gets everything.
 const dspFilter = useMemo(() => {
 const broadcastNames = new Set(['EBU R128 (broadcast)', 'ATSC A/85 · CALM Act', 'Netflix'])
 const socialNames = new Set(['TikTok', 'YouTube Shorts', 'Instagram / Reels'])
 const musicNames = new Set(['Spotify', 'Apple Music', 'YouTube', 'Tidal', 'Amazon Music'])
 return (name: string) => {
 if (surface === 'broadcast') return broadcastNames.has(name)
 if (surface === 'netflix') return name === 'Netflix' // single-platform surface per final panel
 if (surface === 'post') return broadcastNames.has(name) || musicNames.has(name)
 if (surface === 'streaming') return musicNames.has(name) || socialNames.has(name)
 return true // full
 }
 }, [surface])
 const verdict = useMemo(() => buildVerdict(singleFileMetrics, partialFull, { dspFilter }), [singleFileMetrics, partialFull, dspFilter])
 const attention = useMemo(() => {
 const base = buildAttentionItems(singleFileMetrics, partialFull)
 const profile = dspProfileId ? DSP_PROFILES[dspProfileId] : null
 if (!profile) return base
 const findings = evaluateAgainstProfile({
 lufs: singleFileMetrics.lufs,
 true_peak: singleFileMetrics.true_peak,
 sample_rate: singleFileMetrics.sample_rate,
 bit_depth: singleFileMetrics.bit_depth,
 isrc: singleFileMetrics.isrc,
 lra: singleFileMetrics.lra,
 short_term_max: singleFileMetrics.short_term_max,
 dialog_lufs: singleFileMetrics.dialog_lufs,
 }, profile)
 const dspItems = findings.map(f => ({
 severity: f.severity === 'block' ? 'hold' as const : f.severity === 'warn' ? 'warn' as const : 'info' as const,
 message: `[${profile.name}] ${f.message}`,
 }))
 return [...dspItems, ...base]
 }, [singleFileMetrics, partialFull, dspProfileId])

 // Click-to-jump: Attention List rows that carry a `jumpSec` emit a
 // `rtm-seek` event that the main A/B player (and any other
 // transport-aware view) listens to. Panel critical-fix: the prop
 // existed in the list; it was never wired here.
 const handleAttentionJump = useCallback((sec: number) => {
 try {
 window.dispatchEvent(new CustomEvent('rtm-seek', { detail: { time: sec } }))
 } catch {}
 }, [])

 // Compose an AnalysisResult the Master Assistant's proposer can
 // read. Prefer full_result (pass-through from App.tsx) and fall
 // back to a synthesised object using the fields we do have.
 // Populated so proposeMasterChain sees *both* sides (_a/_b) of
 // everything — on single-file mode the two sides carry identical
 // values since there's only one track.
 const synthesisedResult: AnalysisResult = useMemo(() => {
 if (data.full_result) return data.full_result
 const lufs = check.stats?.lufs ?? null
 const lra = check.stats?.dynamic_range ?? null
 const width = overall?.width_a ?? null
 const tp = distortion?.true_peaks?.b_true_peak_db ?? null
 const stMax = overall?.short_term_max_a ?? null
 return {
 overall: {
 lufs_a: lufs, lufs_b: lufs,
 short_term_max_a: stMax, short_term_max_b: stMax,
 dynamics_a: lra, dynamics_b: lra,
 width_a: width, width_b: width,
 },
 headroom: data.headroom || {
 a: null, b: null,
 true_peak_a: tp, true_peak_b: tp,
 },
 spectrum_a: data.spectrum_a,
 spectrum_b: data.spectrum_a, // single-file: same curve both sides
 mid_spectrum_a: data.mid_spectrum_a,
 mid_spectrum_b: data.mid_spectrum_a,
 side_spectrum_a: data.side_spectrum_a,
 side_spectrum_b: data.side_spectrum_a,
 engineer_tips: data.engineer_tips,
 distortion,
 reference_check: check,
 duration_sec: data.duration_sec,
 duration_sec_b: data.duration_sec,
 comparison_mode: 'solo',
 clicks,
 mono_compat: data.mono_compat,
 lufs_over_time_a: data.lufs_over_time_b,
 lufs_over_time_b: data.lufs_over_time_b,
 phase_over_time_a: data.phase_over_time_a,
 phase_over_time_b: data.phase_over_time_a,
 waveform_a: data.waveform_a,
 waveform_b: data.waveform_a,
 dialog_gate: data.dialog_gate,
 limiter_artefacts: data.limiter_artefacts,
 spec_versions: data.spec_versions,
 } as unknown as AnalysisResult
 }, [data, check, overall, distortion, clicks])

 // Broadcast file-integrity hint — if BEXT lives on the metadata
 // payload, warn about obvious issues. 
 const integrityWarnings = useMemo(() => {
 const out: string[] = []
 const bext = (data.metadata as any)?.a?.bext
 if (bext && bext.version != null && bext.version < 2) {
 out.push(`BEXT version ${bext.version} — version 2 required for v2 loudness fields (LUFS, TP, LRA, momentary, short-term).`)
 }
 if (bext && (!bext.originator || bext.originator.trim() === '')) {
 out.push('BEXT originator is empty — chain of custody is anonymous.')
 }
 if (bext && bext.umid && /^0+$/.test(String(bext.umid).replace(/\s/g, ''))) {
 out.push('BEXT UMID is all-zeros (sentinel) — re-embed with a real UMID.')
 }
 return out
 }, [data.metadata])

 return (
 <div className="space-y-8">
 {/* ⌘K command palette — same as AnalysisView. Needed here because
 AnalysisView is not mounted in single-file mode. */}
 {paletteOpen && (
 <CommandPalette
 onClose={() => setPaletteOpen(false)}
 onNavigate={() => setPaletteOpen(false)}
 />
 )}
 {/* ── 1. Header ──────────────────────────────────────────── */}
 <div className="text-center space-y-2">
 <h2 className="text-2xl font-medium" style={{ color: '#f5f5f4' }}>Reference Analysis</h2>
 <div className="flex items-center justify-center gap-3">
 <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
 {data.duration_sec != null && data.duration_sec > 0 && (
 <DurationPill seconds={data.duration_sec} label="Length" tint="var(--color-accent)" compact />
 )}
 <SpecDriftBadge analysisVersion={data.spec_versions?.version} stampedSpecs={data.spec_versions} />
 </div>
 </div>

 {/* ── File-level warnings (SR / BD / length / container) ─────
 Surfaced above every other panel so the engineer sees any
 red flag before trusting the measurements. */}
 {data.file_warnings && data.file_warnings.length > 0 && (
 <div className="space-y-1">
 {data.file_warnings.map((w, i) => (
 <div
 key={i}
 className="px-3 py-2 text-[11px] flex items-start gap-2"
 style={{ backgroundColor: 'rgba(224,122,79,0.08)', border: '1px solid rgba(224,122,79,0.3)', color: 'var(--color-data-warn)', borderRadius: '2px' }}
 title={`File warning: ${w.type}`}
 >
 <span className="text-[13px] leading-none" aria-hidden>!</span>
 <span className="flex-1">
 <span className="uppercase tracking-[0.16em] text-[9px] mr-2">{w.type}</span>
 <span style={{ color: '#d9d4c8' }}>{w.message}</span>
 </span>
 </div>
 ))}
 </div>
 )}

 {/* Generation-loss warning badge — mirrors the AnalysisView badge. */}
 {data.generation_loss && data.generation_loss.verdict !== 'likely_lossless' && (
  <div
   role="alert"
   className="px-3 py-2 text-[11px] flex items-start gap-2"
   style={{
    backgroundColor: data.generation_loss.verdict === 'likely_prior_lossy'
     ? 'rgba(224,82,82,0.08)' : 'rgba(150,128,58,0.08)',
    border: `1px solid ${data.generation_loss.verdict === 'likely_prior_lossy'
     ? 'rgba(224,82,82,0.25)' : 'rgba(150,128,58,0.2)'}`,
    color: data.generation_loss.verdict === 'likely_prior_lossy' ? '#e05252' : 'var(--color-accent)',
    borderRadius: '2px',
   }}
  >
   <span className="flex-1">
    <span className="uppercase tracking-[0.16em] text-[9px] mr-2">GENERATION LOSS</span>
    <span style={{ color: '#d9d4c8' }}>
     {data.generation_loss.verdict === 'likely_prior_lossy'
      ? 'Prior lossy encode detected' : 'Possible prior lossy encode'}
     {' '}({Math.round(data.generation_loss.probability * 100)}% probability)
     {data.generation_loss.summary ? ` — ${data.generation_loss.summary}` : ''}
    </span>
   </span>
  </div>
 )}

 {/* ── 2. DAW plugin origin banner ───────────────────────────
 Surfaces region / DAW / source metadata when this file
 was sent here by the RTM Send plugin. */}
 {pluginDrop.slotA && pluginDrop.slotA.audioPath === filePath && (
 <div
 data-tour-ref="banner"
 className="p-3 flex items-start gap-3"
 style={{ backgroundColor: 'rgba(208,176,102,0.06)', border: '1px solid rgba(208,176,102,0.22)', borderRadius: '2px' }}
 >
 <div
 className="w-8 h-8 flex items-center justify-center flex-shrink-0"
 style={{ backgroundColor: 'rgba(208,176,102,0.15)', color: 'var(--color-accent)', borderRadius: '2px' }}
 title="Sent from the RTM Send plugin"
 >
 <span className="text-[14px]">↙</span>
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-baseline gap-2 flex-wrap">
 <span className="text-[9px] uppercase tracking-[0.18em]" style={{ color: 'var(--color-accent)' }}>
 From RTM plugin
 </span>
 {pluginDrop.slotA.daw && (
 <span className="text-[10px]" style={{ color: 'var(--color-sand-300)' }}>{pluginDrop.slotA.daw}</span>
 )}
 {pluginDrop.slotA.source && (
 <span
 className="text-[9px] px-1.5 py-px rounded-full"
 style={{ color: 'var(--color-teal)', backgroundColor: 'rgba(124,164,163,0.1)' }}
 title={{
 ring: 'Last N seconds of the master bus',
 loop: 'DAW loop / cycle region',
 triggered: 'Manually captured region (Rec/Stop)',
 ara: 'ARA region / marker from the host',
 }[pluginDrop.slotA.source]}
 >
 {pluginDrop.slotA.source.toUpperCase()}
 </span>
 )}
 </div>
 <div className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-primary)' }}>
 {pluginDrop.slotA.regionName || pluginDrop.slotA.sessionName || fileName}
 {pluginDrop.slotA.regionStartSec != null && pluginDrop.slotA.regionEndSec != null && (
 <span className="ml-2 font-mono text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
 [{formatSec(pluginDrop.slotA.regionStartSec)} → {formatSec(pluginDrop.slotA.regionEndSec)}]
 </span>
 )}
 {pluginDrop.slotA.regionSourceName && (
 <span className="ml-2 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
 in {pluginDrop.slotA.regionSourceName}
 </span>
 )}
 </div>
 {pluginDrop.slotA.sampleRate && (
 <div className="text-[9px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
 {(pluginDrop.slotA.sampleRate / 1000).toFixed(pluginDrop.slotA.sampleRate % 1000 === 0 ? 0 : 1)} kHz ·
 {pluginDrop.slotA.channels ? ` ${pluginDrop.slotA.channels} ch ·` : ''}
 {pluginDrop.slotA.durationSec ? ` ${pluginDrop.slotA.durationSec.toFixed(1)} s ·` : ''}
 {pluginDrop.slotA.createdAt ? ` ${new Date(pluginDrop.slotA.createdAt).toLocaleTimeString()}` : ''}
 </div>
 )}
 </div>
 </div>
 )}

 {/* ── 2b. Song Info — levels at a glance ────────────────────
 Promoted from Advanced QC to the very top of the single-
 file surface so the user sees the programme level, TP,
 LRA, and stereo width before anything else on the page.
 The BPM / key trivia rides along in the same card when
 the deep analysis populates it; otherwise those rows
 simply blank out. (5.2.3: genre detection removed — was
 unreliable on real-world masters.) */}
 {check?.stats && (
 <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-4" style={{ borderRadius: '2px' }}>
 <h3 className="text-lg font-semibold">Song Info</h3>
 <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
 <StatBox label="Integrated" value={`${check.stats.lufs} LUFS`} />
 {overall?.short_term_max_a != null && (
 <StatBox label="Short-Term Max" value={`${overall.short_term_max_a.toFixed(1)} LUFS`} />
 )}
 <StatBox label="True Peak" value={distortion ? `${distortion.true_peaks.b_true_peak_db} dBTP` : 'N/A'} />
 <StatBox label="LRA" value={`${check.stats.dynamic_range} LU`} />
 {overall?.width_a != null && (
 <StatBox label="Stereo Width" value={`${(overall.width_a * 100).toFixed(0)}%`} />
 )}
 </div>
 <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mt-2">
 <StatBox label="Length" value={formatDuration(data.duration_sec)} />
 {check.song_info?.bpm != null && (
 <StatBox label="BPM" value={`${check.song_info.bpm}`} />
 )}
 {check.song_info?.key && (
 <StatBox label="Key" value={check.song_info.key} sub={check.song_info.key_freq ? `${check.song_info.key_freq} Hz` : undefined} />
 )}
 <StatBox label="Stereo Corr." value={`${check.stats.stereo_correlation}`} />
 <StatBox label="Clipped" value={check.stats.clip_count === 0 ? 'None' : `${check.stats.clip_count}`} warn={check.stats.clip_count > 0} />
 </div>

 {/* 5.2.3: Estimated-Genre card removed — auto-detection was unreliable
 on real-world masters and confused engineers more than it helped. */}
 </div>
 )}

 {/* ── 3. Metadata strip ─────────────────────────────────────
 SR · BD · ch · ISRC (file-format context; the levels are
 now in the Song Info card above). */}
 <div data-tour-ref="meta-strip" className="text-center text-[10px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
 {metaStrip}
 </div>

 {/* ── 3b. Dialog-gate readout ─────────────────────────────
 Speech-gated LUFS with confidence pill + speech-coverage
 percentage. Structured error states ('insufficient',
 'error') still render the row so the engineer sees the
 detector ran; LUFS is shown as a placeholder dash in that
 case. `note` lands below in small italic muted text. */}
 {data.dialog_gate && (() => {
 const dg = data.dialog_gate!
 const pillColor =
 dg.confidence === 'high' ? { fg: 'var(--color-data-pass)', bg: 'rgba(110,197,119,0.12)' } :
 dg.confidence === 'medium' ? { fg: 'var(--color-accent)', bg: 'rgba(208,176,102,0.12)' } :
 dg.confidence === 'insufficient' ? { fg: 'var(--color-data-warn)', bg: 'rgba(224,122,79,0.12)' } :
 dg.confidence === 'error' ? { fg: 'var(--color-danger)', bg: 'rgba(224,90,90,0.12)' } :
 { fg: 'var(--color-text-muted)', bg: 'rgba(141,134,123,0.12)' } // low / none
 const hideLufs = dg.confidence === 'error' || dg.confidence === 'insufficient' || dg.lufs_i == null
 return (
 <div className="flex flex-col items-center gap-1">
 <div className="flex items-center justify-center gap-2 text-[10px] font-mono" style={{ color: 'var(--color-text-primary)' }}>
 <span className="uppercase tracking-[0.16em]" style={{ color: 'var(--color-text-muted)' }}>Dialog</span>
 <span style={{ color: hideLufs ? 'var(--color-text-muted)' : 'var(--color-accent)' }}>
 {hideLufs ? '-' : `${dg.lufs_i!.toFixed(1)} LKFS`}
 </span>
 <span
 className="text-[9px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-full"
 style={{ color: pillColor.fg, backgroundColor: pillColor.bg }}
 title={`Detector confidence: ${dg.confidence}`}
 >
 {dg.confidence}
 </span>
 <span style={{ color: 'var(--color-text-muted)' }}>
 {`${dg.speech_pct.toFixed(0)}% speech`}
 </span>
 </div>
 {dg.note && (
 <div className="text-[9px] font-display italic" style={{ color: 'var(--color-text-muted)' }}>
 {dg.note}
 </div>
 )}
 </div>
 )
 })()}

 {/* ── 4. Triage controls ────────────────────────────────────
 Always available; pre-populated for broadcast surfaces. */}
 <div className="flex items-center justify-center gap-3 flex-wrap">
 <label className="flex items-center gap-1.5 text-[9px]" style={{ color: 'var(--color-text-muted)' }}>
 <span className="uppercase tracking-[0.16em]">DSP profile</span>
 <select
 value={dspProfileId}
 onChange={e => setDspProfile(e.target.value)}
 className="text-[10px] px-2 py-0.5 rounded bg-transparent focus:outline-none"
 style={{ color: 'var(--color-text-primary)', border: '1px solid rgba(168,161,150,0.2)' }}
 >
 <option value="" style={{ backgroundColor: 'var(--color-bg-panel)' }}>— generic —</option>
 {Object.values(DSP_PROFILES).map(p => (
 <option key={p.id} value={p.id} style={{ backgroundColor: 'var(--color-bg-panel)' }}>{p.name}</option>
 ))}
 </select>
 </label>
 <button
 onClick={toggleCompliance}
 className="text-[9px] uppercase tracking-[0.14em] transition-colors"
 style={{
 color: complianceView ? 'var(--color-accent)' : 'var(--color-text-muted)',
 border: `1px solid ${complianceView ? 'rgba(208,176,102,0.4)' : 'rgba(168,161,150,0.15)'}`,
 padding: '2px 8px',
 borderRadius: 999,
 }}
 title="Compliance view. Expands the verdict to a per-DSP pass/fail grid that's clipboard-friendly for delivery tickets."
 >
 {complianceView ? '● Compliance' : 'Compliance'}
 </button>
 <button
 onClick={toggleTriage}
 className="text-[10px] uppercase tracking-[0.14em] transition-colors hover:text-sand-200"
 style={{ color: triageMode ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
 title="Triage Mode — forces the verdict + Attention list even for clean tracks."
 >
 {triageMode ? '▾ Triage · on' : '▸ Triage'}
 </button>
 </div>

 {/* ── 5. Verdict + Attention ─────────────────────────────── */}
 <div data-tour-ref="verdict">
 <ReadyToDeliverVerdict verdict={verdict} showDspGrid={complianceView} />
 </div>

 {/* ── 5b. Apple Digital Masters ready stamp ──────────────────
 Bundles all five ADM requirements into a single badge.
 5.4.2: hidden on single-file + folder scan per user direction.
 ADM is an Atmos/Apple-Music-specific spec; flagging a regular
 stereo master against it for "ADM hold — 24-bit or higher,
 44.1 kHz or higher" was crying wolf. Re-enable only when the
 file is explicitly opened from an Atmos route (atmos solo
 path) or when the user opts in via a future toggle. */}
 {false && (singleFileMetrics.bit_depth != null || singleFileMetrics.sample_rate != null || singleFileMetrics.true_peak != null) && (() => {
 const adm = computeAdmReadiness({
 bitDepth: singleFileMetrics.bit_depth,
 sampleRate: singleFileMetrics.sample_rate,
 truePeakDbtp: singleFileMetrics.true_peak,
 clippedSamples: singleFileMetrics.clipped_samples,
 codingHistoryRaw: data.metadata?.a?.bext?.coding_history || null,
 })
 const colour = adm.status === 'ready' ? 'var(--color-success)' : adm.status === 'warn' ? 'var(--color-accent)' : 'var(--color-danger)'
 const bg = adm.status === 'ready' ? 'rgba(111,163,126,0.10)' : adm.status === 'warn' ? 'rgba(197,165,90,0.10)' : 'rgba(224,90,90,0.10)'
 const icon = adm.status === 'ready' ? '✓' : adm.status === 'warn' ? '⚠' : '✕'
 return (
 <details
 className="px-3 py-2 text-[11px]"
 style={{ backgroundColor: bg, border: `1px solid ${colour}40`, color: colour, borderRadius: '2px' }}
 >
 <summary
 className="list-none cursor-pointer flex items-center gap-2 select-none"
 title="Click to inspect every Apple Digital Masters check. Pass/fail on bit depth, sample rate, true peak, digital clipping, and lossless source chain."
 >
 <span className="text-[13px]" aria-hidden>{icon}</span>
 <span className="uppercase tracking-[0.16em] text-[9px]">Apple Digital Masters</span>
 <span className="flex-1" />
 <span className="text-[11px]" style={{ color: colour }}>{adm.action}</span>
 <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
 <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
 </svg>
 </summary>
 <div className="mt-2 space-y-1">
 {adm.checks.map(c => (
 <div key={c.label} className="flex items-center gap-2 text-[10px]" style={{ color: c.pass ? 'var(--color-sand-300)' : colour }}>
 <span className="w-3" aria-hidden>{c.pass ? '✓' : '✕'}</span>
 <span className="flex-1">{c.label}</span>
 <span className="font-mono" style={{ color: c.pass ? 'var(--color-text-muted)' : colour }}>{c.value}</span>
 </div>
 ))}
 {adm.checks.some(c => c.detail) && (
 <div className="mt-1.5 text-[10px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
 {adm.checks.filter(c => c.detail).map(c => (
 <div key={c.label} className="pt-1">• {c.detail}</div>
 ))}
 </div>
 )}
 {/*
 * One-click "Write ADM-compliant BEXT" Appears only when:
 * • status is WARN (not READY — already compliant; not
 * FAIL — BEXT is not the blocker there)
 * • the specific warning is the source-chain check
 * (empty BEXT coding_history)
 * • we have a file path we can write to
 * Scrolls the metadata panel into view and dispatches the
 * `__rtm-bext-prefill` event with defaults that satisfy
 * ADM's lossless-source-chain verification. The real
 * `bwfWrite` IPC is invoked inside the editor by the user's
 * Save click — we never silently write BEXT without the
 * user confirming.
 */}
 {adm.status === 'warn'
 && adm.checks.find(c => c.key === 'source_chain' && !c.pass)
 && filePath && (
 <button
 onClick={() => {
 const el = document.querySelector('[data-tour-ref="metadata-panel"]') as HTMLElement | null
 el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
 const sr = singleFileMetrics.sample_rate
 const bd = singleFileMetrics.bit_depth
 const ch = singleFileMetrics.channels
 // Coding-history line that satisfies the lossless-chain
 // check: A=PCM marker proves no lossy stage. Parameters
 // drawn from the actual file so the written BEXT matches
 // the real audio rather than boilerplate.
 const codingHistory = `A=PCM,F=${sr ?? 44100},W=${bd ?? 24},M=${ch === 1 ? 'mono' : 'stereo'},T=RTMcompare · ADM render`
 window.dispatchEvent(new CustomEvent('__rtm-bext-prefill', {
 detail: {
 originator: 'RTMcompare · ADM Render',
 codingHistory,
 description: label,
 },
 }))
 }}
 className="mt-2 text-[10px] px-2.5 py-1 transition-colors hover:bg-white/[0.04]"
 style={{ color: 'var(--color-accent)', border: '1px solid rgba(197,165,90,0.45)', borderRadius: '2px' }}
 title="Open the BEXT / iXML editor below with ADM-compliant defaults pre-filled. Click Save in the editor to actually write; RTM never writes BEXT without your confirmation."
 >
 Write ADM-compliant BEXT →
 </button>
 )}
 </div>
 </details>
 )
 })()}

 {attention.length > 0 && (() => {
 const allChecked = attention.every((_, i) => checkedAttention.has(i))
 return (
 <div data-tour-ref="attention" className="space-y-1.5">
 <div className="flex items-center justify-between">
 <div className="text-[9px] uppercase tracking-[0.16em]" style={{ color: 'var(--color-accent)' }}>Attention</div>
 {allChecked && (
 <span
 className="text-[9px] px-2 py-0.5 uppercase tracking-[0.12em]"
 style={{ color: 'var(--color-data-pass)', backgroundColor: 'rgba(110,197,119,0.08)', border: '1px solid rgba(110,197,119,0.3)', borderRadius: '2px' }}
 >✓ All reviewed — ready to send</span>
 )}
 </div>
 <ul className="space-y-1">
 {(attention as Array<{ severity: 'hold' | 'warn' | 'info'; message: string; jumpSec?: number }>).map((item, idx) => {
 const checked = checkedAttention.has(idx)
 const accent = item.severity === 'hold' ? 'var(--color-danger)' : item.severity === 'warn' ? 'var(--color-warning)' : 'var(--color-sand-400)'
 return (
 <li key={idx} className="flex items-start gap-2 min-w-0">
 <button
 onClick={() => toggleAttentionCheck(idx)}
 aria-label={checked ? 'Mark unresolved' : 'Mark resolved'}
 title={checked ? 'Click to unmark' : 'Click to mark as addressed'}
 style={{
 flexShrink: 0,
 marginTop: 2,
 width: 14, height: 14,
 borderRadius: '2px',
 border: `1px solid ${checked ? 'rgba(110,197,119,0.6)' : 'rgba(168,161,150,0.35)'}`,
 backgroundColor: checked ? 'rgba(110,197,119,0.2)' : 'transparent',
 cursor: 'pointer',
 display: 'flex', alignItems: 'center', justifyContent: 'center',
 fontSize: 9, color: 'var(--color-data-pass)',
 }}
 >
 {checked ? '✓' : ''}
 </button>
 <button
 onClick={item.jumpSec != null && handleAttentionJump ? () => handleAttentionJump(item.jumpSec!) : undefined}
 disabled={item.jumpSec == null}
 className={`flex-1 text-left flex items-start gap-2 py-0.5 transition-colors text-[11px] ${item.jumpSec != null ? 'hover:bg-white/[0.04]' : ''}`}
 style={{
 borderLeft: `2px solid ${checked ? 'rgba(110,197,119,0.4)' : accent}`,
 paddingLeft: 8, paddingRight: 8, borderRadius: '2px',
 color: checked ? 'var(--color-text-muted)' : 'var(--color-sand-300)',
 opacity: checked ? 0.55 : 1,
 cursor: item.jumpSec != null ? 'pointer' : 'default',
 textDecoration: checked ? 'line-through' : 'none',
 }}
 >
 <span className="flex-1 min-w-0 break-words">{item.message}</span>
 {item.jumpSec != null && (
 <span className="text-[9px] font-mono" style={{ color: accent }}>
 {`${Math.floor(item.jumpSec / 60)}:${Math.floor(item.jumpSec % 60).toString().padStart(2, '0')}`}
 </span>
 )}
 </button>
 </li>
 )
 })}
 </ul>
 </div>
 )
 })()}

 {/* Limiter-artefact granular metrics. Severity + issues already
 bleed into the Attention list above; this compact row surfaces
 the raw pump / ISO / ringing numbers so engineers can triage
 the why without reading the issue copy. */}
 {data.limiter_artefacts && (
 <LimiterArtefactsPanel artefacts={data.limiter_artefacts} compact />
 )}

 {/* Broadcast integrity warnings — only surface when we have
 BEXT payload to inspect. */}
 {integrityWarnings.length > 0 && (
 <div
 className="px-3 py-2 text-[10px]"
 style={{ backgroundColor: 'rgba(197,165,90,0.08)', border: '1px solid rgba(197,165,90,0.3)', color: 'var(--color-accent)', borderRadius: '2px' }}
 >
 <div className="text-[9px] uppercase tracking-[0.16em] mb-1">File integrity</div>
 {integrityWarnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
 </div>
 )}

 {/* ── 6. A/B player — the missing piece. Single-file mode
 feeds the same FileInfo to both slots so the A/B swap
 is a no-op visually (blind mode auto-hides). The real
 wins here: live EQ bank for Master Assistant / Engineer
 Tips / Reference Match audition, Listen-mode mono/mid/
 side/phone, stems DnD, and the reference-curve overlay
 the Library flow writes into. `rtm-seek` events from
 Attention rows now have a listener. */}
 {fileAInfo && (
 <div data-tour-ref="player">
  {/* REF-B-1: reference slot — lets the user load a second file so the
      A/B player can do a real side-by-side audition from within the
      single-file view. Shows "load reference" affordance when empty. */}
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
   <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
    A/B Player
   </span>
   <div style={{ flex: 1, height: 1, backgroundColor: 'rgba(168,161,150,0.1)' }} />
   {refBInfo ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
     <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontStyle: 'italic', fontFamily: 'var(--font-display)' }}>
      B: {refBInfo.name}
     </span>
     <button
      onClick={() => setRefBInfo(null)}
      title="Remove reference"
      style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: 13, cursor: 'pointer', lineHeight: 1, padding: 0 }}
     >×</button>
    </div>
   ) : (
    <button
     onClick={handleLoadRefB}
     style={{
      fontFamily: 'var(--font-sans)',
      fontSize: 10,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: 'var(--color-accent)',
      background: 'transparent',
      border: '1px solid rgba(208,176,102,0.3)',
      borderRadius: 2,
      padding: '4px 10px',
      cursor: 'pointer',
     }}
    >
     + Load reference B
    </button>
   )}
  </div>
 <ABPlayer
 fileA={fileAInfo}
 fileB={playerFileB}
 gainAppliedDb={0}
 currentCurve={data.spectrum_a || data.engineer_tips?.spectrum_file || null}
 />
 </div>
 )}

 {/* ── 7. Master Assistant — the finish-from-DAW surface ───── */}
 <div data-tour-ref="master-assistant" className="bg-dark-900 p-6 border border-dark-700/50" style={{ borderRadius: '2px' }}>
 <MasterAssistantPanel
 result={synthesisedResult}
 fileB={fileAInfo}
 label={label}
 />
 </div>

 {/* ── 7. Streaming Normalization Preview + Sound Check twin ─
 Expanded by default now — */}
 {streamingPreviewRows.length > 0 && (
 <div data-tour-ref="streaming-preview">
 <CollapsibleSection
 title="Streaming Normalization Preview"
 tooltip="Per-platform playback loudness after normalisation. ▶ on any platform to hear 30 s of a chosen window. The ≋ button plays the *real* AAC output of each DSP's ingest chain."
 why="Every DSP plays your master at its own loudness target: Spotify −14 LUFS, Apple −16, Netflix −27 LKFS on dialog. Mastering louder than the target doesn't help; the DSP attenuates you AND engages its limiter. The ≋ twin button plays what listeners actually hear through the DSP's real ingest chain (gain, 4× TP limiter, AAC codec). The heatmap under each platform shows where the limiter fires on your timeline."
 defaultOpen={true}
 >
 <StreamingPreview
 previewA={streamingPreviewRows}
 previewB={streamingPreviewRows}
 labelA={label}
 labelB={label}
 soloA
 fileA={fileAInfo}
 lufsA={singleFileMetrics.lufs}
 surface={surface}
 />
 </CollapsibleSection>
 </div>
 )}

 {/* ── 8. Loudness over time — expanded on single-file ─────── */}
 {data.lufs_over_time_b && data.lufs_over_time_b.length > 0 && (
 <CollapsibleSection
 title="Loudness over time"
 tooltip="Short-term LUFS across the song with section boundaries from the transient-density detector. See whether your drop actually drops."
 why="Integrated LUFS averages the whole track into one number, fine for delivery but blind to how the song *breathes*. Short-term LUFS (3-second windows) shows whether your chorus sits hotter than your verse, whether the drop lands, whether the bridge sags. Flat = over-compressed; too dynamic = loudness-normalisation flattens you anyway."
 defaultOpen={true}
 >
 <LoudnessOverTime
 result={{
 lufs_over_time_b: data.lufs_over_time_b,
 transient_density: data.transient_density,
 } as AnalysisResult}
 side="b"
 durationSec={data.duration_sec || undefined}
 />
 </CollapsibleSection>
 )}

 {/* ── 9. Waveform — expanded on single-file, TP-breach markers ── */}
 {data.waveform_a && data.duration_sec && (
 <CollapsibleSection
 title="Waveform"
 tooltip="Visual shape of the audio over time."
 why="The waveform tells you at a glance whether the master is over-limited (brick-wall top) or breathing (visible dynamics). Pair with Loudness over time to see where the energy clusters."
 defaultOpen={true}
 >
 <div className="relative">
 <WaveformCompare
 waveformA={data.waveform_a} waveformB={data.waveform_a}
 labelA={label} labelB={label}
 durationSec={data.duration_sec}
 singleFile
 />
 {/* TP-breach overlay removed by user direction — show numbers only. */}
 </div>
 </CollapsibleSection>
 )}

 {/* ── 10. Frequency Spectrum vs Engineer Target ─────────────
 Both curves A-weighted-mean aligned so the overlay reads
 tonal character, not level. */}
 {data.engineer_tips?.spectrum_file && data.engineer_tips?.spectrum_target ? (
 <CollapsibleSection
 title="Frequency Spectrum vs Engineer Target"
 tooltip={`Your file's tonal curve overlaid on ${data.engineer_tips.engineer}'s mastering target — both A-weighted-mean aligned so a single anomalous band can't shift the comparison.`}
 why="Matching a reference curve at the mastering bus is the fastest path to a professional tonal balance. Your ears adapt; the curve does not lie."
 defaultOpen={true}
 >
 {(() => {
 // Align each curve to its own A-weighted perceptual centre so
 // the overlay reads tonal character, not level.  The old
 // 1-kHz-pivot normalisation was fragile: if the file or target
 // happened to have a notch or spike exactly at 1 kHz, the
 // whole curve was yanked up or down.  levelAlign() votes with
 // perceptual weighting so no single band can dominate.
 const fileNorm = levelAlign(data.engineer_tips.spectrum_file!)
 const targetNorm = levelAlign(data.engineer_tips.spectrum_target!)
 return (
 <SpectrumOverlay
 spectrumA={fileNorm}
 spectrumB={targetNorm}
 labelA={label}
 labelB={`${data.engineer_tips.engineer} target`}
 />
 )
 })()}
 </CollapsibleSection>
 ) : data.spectrum_a && (
 <CollapsibleSection
 title="Frequency Spectrum"
 tooltip="31-band frequency analysis of the file — stereo/mid/side views."
 why="A 31-band view of your master's tonal balance: stereo, mid, and side. When no reference curve is loaded the spectrum stands alone as the objective read on whether the mix sits too dark, too bright, or too scooped in the low-mids. Switch to Mid/Side to see how your wide elements (reverb, guitars, stereo synths) stack up against your centred elements (kick, bass, lead vocal)."
 defaultOpen={true}
 >
 <SpectrumOverlay
 spectrumA={data.spectrum_a} spectrumB={data.spectrum_a}
 midSpectrumA={data.mid_spectrum_a} midSpectrumB={data.mid_spectrum_a}
 sideSpectrumA={data.side_spectrum_a} sideSpectrumB={data.side_spectrum_a}
 labelA={label} labelB={label}
 singleFile
 />
 </CollapsibleSection>
 )}

 {/* ── 11. Key Frequencies (relocated near the spectrum) ──────
 Still musical, but now sits next to the spectrum it
 relates to instead of cluttering the top. */}
 {check.song_info?.harmonics && (
 <CollapsibleSection
 title="Key Frequencies"
 tooltip="Harmonics and octaves of the song's root key. The frequencies where EQ moves will have the most musical impact."
 why="Every song has a tonal centre (the key). Its root, fifth, and octaves carry most of the harmonic weight. EQ moves that land ON those frequencies feel musical; moves between them feel mechanical. When in doubt, snap your EQ to the highlighted bands."
 defaultOpen={false}
 >
 <div className="p-4 overflow-hidden" style={{ backgroundColor: 'rgba(48,44,39,0.4)', borderRadius: '2px' }}>
 <div className="relative h-16">
 <div className="absolute inset-x-0 top-1/2 h-px" style={{ backgroundColor: 'rgba(87,83,78,0.3)' }} />
 {check.song_info.harmonics.map((h: any, i: number) => {
 const logPos = (Math.log10(h.freq) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))
 const left = logPos * 100
 if (left < 0 || left > 100) return null
 const isRoot = h.is_root
 const isOctave = h.is_octave
 const color = isRoot ? 'var(--color-data-warn)' : isOctave ? 'var(--color-data-a)' : 'var(--color-data-pass)'
 const height = isRoot ? '100%' : isOctave ? '70%' : '45%'
 const width = isRoot ? 3 : isOctave ? 2 : 1
 return (
 <div key={i} className="absolute flex flex-col items-center" style={{ left: `${left}%`, top: 0, bottom: 0 }}>
 <div className="rounded-full" style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: `${width}px`, height, backgroundColor: color, opacity: isRoot ? 0.9 : isOctave ? 0.6 : 0.35 }} />
 {(isRoot || isOctave) && (
 <span className="absolute text-[8px] font-mono whitespace-nowrap" style={{ bottom: '100%', marginBottom: '2px', color, transform: 'translateX(-50%)', left: '50%' }}>
 {h.freq >= 1000 ? `${(h.freq/1000).toFixed(1)}k` : Math.round(h.freq)}
 </span>
 )}
 {isRoot && (
 <span className="absolute text-[7px] font-medium whitespace-nowrap" style={{ top: '100%', marginTop: '2px', color, transform: 'translateX(-50%)', left: '50%' }}>ROOT</span>
 )}
 </div>
 )
 })}
 </div>
 <div className="flex justify-between mt-2 text-[7px]" style={{ color: 'var(--color-text-muted)' }}>
 <span>20</span><span>50</span><span>100</span><span>200</span><span>500</span><span>1k</span><span>2k</span><span>5k</span><span>10k</span><span>20k</span>
 </div>
 </div>

 <div className="flex flex-wrap gap-1.5 mt-3">
 {check.song_info.harmonics.map((h: any, i: number) => (
 <span key={i} className="text-[9px] px-2 py-0.5 rounded font-mono" style={{
 backgroundColor: h.is_root ? 'rgba(224,122,79,0.15)' : h.is_octave ? 'rgba(107,140,187,0.1)' : 'rgba(110,197,119,0.08)',
 color: h.is_root ? 'var(--color-data-warn)' : h.is_octave ? 'var(--color-data-a)' : 'var(--color-text-muted)',
 fontWeight: h.is_root ? 600 : 400,
 }}>
 {h.freq >= 1000 ? `${(h.freq/1000).toFixed(1)}k` : Math.round(h.freq)} Hz
 <span className="ml-1 opacity-60">{h.label}</span>
 </span>
 ))}
 </div>
 </CollapsibleSection>
 )}

 {/* ── 12. Metadata Panel — BEXT / iXML read + inline edit ─── */}
 {data.metadata && (
 <div data-tour-ref="metadata-panel">
 <CollapsibleSection
 title="Embedded Metadata"
 tooltip="BEXT / iXML / LIST-INFO / ID3 tags in the WAV. Edit inline to embed BEXT originator, UMID, ISRC."
 why="Embedded metadata travels with the audio file through every distributor's pipeline. Edit mode writes atomically; audio bytes stay identical."
 defaultOpen={false}
 >
 {/* Single-sided: only populate slot A so the panel doesn't
 render a duplicate second column. pathB mirrors pathA
 so the editor's edit-mode path works even if it looks
 up the B-side reference later. */}
 <MetadataPanel
 metadata={{ a: data.metadata.a }}
 labelA={label}
 labelB={label}
 pathA={filePath}
 pathB={filePath}
 />
 </CollapsibleSection>
 </div>
 )}

 {/* ── 13. Distortion + TP ──────────────────────────────────── */}
 {distortion && (
 <CollapsibleSection
 title="Distortion Check"
 tooltip="Checks for clipping, true peak violations, over-limiting, and harmonic distortion."
 why="Four checks in one panel: digital clipping (consecutive samples at ceiling), true-peak violations (inter-sample overs your regular peak meter can't see), flat-waveform ratio (over-limiting), and harmonic-distortion increase vs. clean reference. Confidence label: 'high' = direct evidence (real clipping); 'medium' / 'low' = heuristics that mis-classify intentional saturation. Trust high-confidence HOLDs; audit low-confidence ones by ear."
 badge={
 <span className="text-xs px-2 py-0.5 rounded-full" style={{
 color: distortion.severity === 'clean' ? 'var(--color-data-pass)' : distortion.severity === 'warning' ? 'var(--color-data-warn)' : 'var(--color-danger)',
 backgroundColor: distortion.severity === 'clean' ? 'rgba(110,197,119,0.1)' : distortion.severity === 'warning' ? 'rgba(224,122,79,0.1)' : 'rgba(224,90,90,0.1)',
 }}>
 {distortion.severity === 'clean' ? 'Clean' : distortion.severity === 'warning' ? 'Warning' : 'Problem'}
 </span>
 }
 >
 <DistortionPanel distortion={distortion} labelA={label} labelB={label} singleFile />
 </CollapsibleSection>
 )}

 {/* ── 14. Clicks & Glitches ────────────────────────────────── */}
 <CollapsibleSection
 title="Clicks & Glitches"
 tooltip="Sample-level spikes caused by bad edits, buffer glitches, or plugin artifacts."
 why="Detection uses multi-criteria: spectral flatness rules out drum transients, high-pass residual spikes catch true clicks (white-noise impulses). Deduped within 80 ms, capped at 20 events so the panel stays actionable. Every row jumps the transport: a click at 1:47 is worth hearing in context before calling it an artefact vs. a performance choice."
 badge={
 <span className="text-xs px-2 py-0.5 rounded-full" style={{
 color: clicks.length > 0 ? 'var(--color-data-warn)' : 'var(--color-data-pass)',
 backgroundColor: clicks.length > 0 ? 'rgba(224,122,79,0.1)' : 'rgba(110,197,119,0.1)',
 }}>
 {clicks.length > 0 ? `${clicks.length} found` : 'Clean'}
 </span>
 }
 >
 {clicks.length > 0 ? (
 <ClickTimeline clicks={clicks} labelB={label} fileA={filePath ? { path: filePath } : undefined} fileB={filePath ? { path: filePath } : undefined} />
 ) : (
 <div className="flex items-center gap-3 py-2">
 <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(110,197,119,0.1)' }}>
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="var(--color-data-pass)" strokeWidth={2}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
 </svg>
 </div>
 <div>
 <p className="text-sm" style={{ color: 'var(--color-sand-100)' }}>No clicks or glitches detected</p>
 <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>Clean signal — no sample-level artifacts found</p>
 </div>
 </div>
 )}
 {/* RTM De-click launcher — sits right next to the Clicks panel
 so engineers can move from "found N clicks" to "repair them"
 without hunting for the tool in another tab. Inline disclosure
 picked over a modal because the panel needs to coexist with
 the timeline above it during A/B listening. */}
 {filePath && (
 <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(208,176,102,0.12)' }}>
 <button
 type="button"
 onClick={() => setDeclickOpen(v => !v)}
 className="px-3 py-1.5 text-xs font-medium transition-colors"
 style={{
 borderRadius: '2px',
 backgroundColor: declickOpen ? 'rgba(208,176,102,0.12)' : 'var(--color-sand-900)',
 color: declickOpen ? 'var(--color-accent)' : 'var(--color-text-primary)',
 border: `1px solid ${declickOpen ? 'rgba(208,176,102,0.35)' : 'rgba(208,176,102,0.18)'}`,
 }}
 aria-expanded={declickOpen}
 >
 {declickOpen ? 'Close De-click' : 'De-click...'}
 </button>
 {declickOpen && (
 <div className="mt-4">
 <DeclickPanel filePath={filePath} />
 </div>
 )}
 </div>
 )}
 </CollapsibleSection>

 {/* ── 15. Hum / Buzz — only when detected ─────────────────── */}
 {data.hum && data.hum.mains > 0 && (
 <CollapsibleSection
 title="Hum / Buzz Check"
 tooltip="AC mains hum detection with ready-to-paste notch preset."
 why="Ground loops and interference are invisible to most meters but obvious on speakers. Catch hum before it ships — once it's in the master it's baked in."
 defaultOpen={true}
 >
 <HumPanel hum={data.hum} />
 </CollapsibleSection>
 )}

 {/* ── 16. Warnings notes (reference_check.warnings) ─────────
 These are high-signal (file-level warnings from the Python
 backend); keep them visible. */}
 {check.warnings.length > 0 && (
 <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-4" style={{ borderRadius: '2px' }}>
 <h3 className="text-lg font-semibold">Notes</h3>
 <div className="space-y-3">
 {check.warnings.map((w, i) => (
 <div key={i} className="p-3.5 space-y-1.5" style={{ borderRadius: '2px',
 backgroundColor: w.severity === 'warning' ? 'rgba(224,122,79,0.06)' : 'rgba(107,140,187,0.06)',
 borderLeft: `3px solid ${w.severity === 'warning' ? 'rgba(224,122,79,0.3)' : 'rgba(107,140,187,0.2)'}`,
 }}>
 <p className="text-xs" style={{ color: 'var(--color-sand-100)' }}>{w.message}</p>
 <p className="text-[11px]" style={{ color: '#6b645d' }}>{w.suggestion}</p>
 </div>
 ))}
 </div>
 </div>
 )}

 {/* ── 17. Diagnostic panels ─────────────────────────────── */}
 <div className="space-y-6">

 {/* Song Info used to live here; it has been promoted to the
 top of the page (section 2b) so levels are the first thing
 the user sees. */}

 {/* Tonal Character — file curve vs profile neutral. */}
 {check.tonal && (
 <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-4" style={{ borderRadius: '2px' }}>
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <h3 className="text-lg font-semibold">Tonal Character</h3>
 <InfoTooltip text="How the frequency balance compares to the mastering target curve." />
 </div>
 <p className="text-xs" style={{ color: 'var(--color-data-warn)' }}>{check.tonal.character}</p>
 </div>
 <div className="p-3 overflow-hidden" style={{ backgroundColor: 'rgba(48,44,39,0.4)', borderRadius: '2px' }}>
 <svg viewBox="0 0 800 160" className="w-full h-36" preserveAspectRatio="none">
 <line x1="0" y1="80" x2="800" y2="80" stroke="#44403c" strokeWidth="0.5" strokeDasharray="4 4" />
 <path d={makeCurvePath(check.tonal.neutral_curve, 800, 160, 20)} fill="none" stroke="var(--color-data-pass)" strokeWidth="1.5" opacity="0.4" strokeDasharray="4 3" />
 <path d={makeCurvePath(check.tonal.measured, 800, 160, 20)} fill="none" stroke="var(--color-data-warn)" strokeWidth="2" opacity="0.8" />
 {check.tonal.deviations.map((dev: number, i: number) => {
 if (Math.abs(dev) < TOLERANCE_NOTABLE) return null
 const x = (i / 30) * 800
 const w = 800 / 31
 const color = dev > 0 ? 'rgba(224,122,79,0.15)' : 'rgba(107,140,187,0.15)'
 return <rect key={i} x={x} y={0} width={w} height={160} fill={color} />
 })}
 </svg>
 </div>
 {check.tonal.notes.length > 0 && (
 <div className="space-y-1.5">
 {check.tonal.notes.map((note: any, i: number) => (
 <div key={i} className="flex items-center gap-2 text-[11px]">
 <span className="px-1.5 py-0.5 rounded text-[9px] font-medium" style={{
 color: note.deviation > 0 ? 'var(--color-data-warn)' : 'var(--color-data-a)',
 backgroundColor: note.deviation > 0 ? 'rgba(224,122,79,0.12)' : 'rgba(107,140,187,0.12)',
 }}>
 {note.deviation > 0 ? '+' : ''}{note.deviation} dB
 </span>
 <span style={{ color: 'var(--color-sand-300)' }}>{note.description}</span>
 </div>
 ))}
 </div>
 )}
 </div>
 )}

 {/* Mono Compat (full band breakdown — single-number version
 lives in the verdict badge). */}
 {data.mono_compat && (
 <CollapsibleSection
 title="Mono Compatibility · Full"
 tooltip="Per-band mono-compat breakdown. Single-number version lives in the verdict badge."
 why="The verdict badge gives you one number; this panel tells you WHERE the cancellation happens. Mono loss in the sub band (below 100 Hz) matters for clubs and Bluetooth; mono loss in the presence band (2–5 kHz) matters for phone speakers. Knowing the band tells you whether to mono the low end, tighten a stereo widener, or leave it alone."
 defaultOpen={false}
 >
 {data.mono_compat.bands_a && data.mono_compat.bands_a.length > 0 ? (
 <div className="space-y-3">
 <div className="flex items-center justify-between text-xs">
 <span className="text-dark-300">Broadband correlation: <span className="font-mono">{data.mono_compat.correlation_a.toFixed(2)}</span></span>
 <span className="text-dark-300">Weighted risk: <span className="font-mono">{(data.mono_compat.risk_a ?? 0).toFixed(1)}</span></span>
 </div>
 <div className="bg-dark-800/40 p-3 space-y-1.5" style={{ borderRadius: '2px' }}>
 {data.mono_compat.bands_a.map((band: any) => {
 const color = band.loss_pct < 5 ? 'var(--color-data-pass)' : band.loss_pct < 15 ? 'var(--color-warm-amber)' : 'var(--color-danger)'
 return (
 <div key={band.name} className="flex items-center text-[11px] px-2 py-1">
 <div className="flex-1 min-w-0">
 <span className="font-medium text-dark-200">{band.name}</span>
 <span className="ml-2 text-[9px] text-dark-500 font-mono">{band.freq_range}</span>
 </div>
 <span className="w-20 text-center font-mono text-[10px] text-dark-400">{band.correlation.toFixed(2)}</span>
 <span className="w-20 text-center font-mono text-[10px]" style={{ color }}>{band.loss_pct.toFixed(1)}%</span>
 </div>
 )
 })}
 </div>
 <div className="text-[10px] text-dark-500 leading-relaxed">{data.mono_compat.insight}</div>
 </div>
 ) : (
 <div className="space-y-3 text-xs text-dark-300">
 Correlation <span className="font-mono">{data.mono_compat.correlation_a.toFixed(2)}</span> · Mono loss <span className="font-mono">{data.mono_compat.mono_loss_a_pct.toFixed(1)}%</span>
 </div>
 )}
 </CollapsibleSection>
 )}

 {/* Phase Correlation */}
 {data.phase_over_time_a && data.duration_sec && (
 <CollapsibleSection
 title="Phase Correlation"
 tooltip="L/R phase relationship over time. +1 = mono-safe, 0 = fully stereo, negative = canceling in mono."
 why="Broadband correlation hides section-level problems. A mix can average +0.7 for the whole track while a single bridge dips into red for 12 seconds, and that's the section that will cancel on phone speakers. Correlation over time catches the moment, not just the mean."
 defaultOpen={false}
 >
 <PhaseCorrelation
 phaseOverTimeA={data.phase_over_time_a} phaseOverTimeB={data.phase_over_time_a}
 labelA={label} labelB=""
 durationSec={data.duration_sec}
 />
 </CollapsibleSection>
 )}

 {/* Phase Correlation per-band */}
 {data.phase_bands_a && data.phase_bands_a.length > 0 && (
 <CollapsibleSection
 title="Phase Correlation — Per Band"
 tooltip="Broadband correlation can look fine while individual bands cancel."
 why="Correlation is usually a single number; this panel splits it across five bands (sub, low, low-mid, high-mid, high). A wide-in-the-highs / narrow-in-the-subs mix reads as healthy broadband but can still have a phasey reverb tail in the 8 kHz region. Per-band is where you catch the subtler stereo problems."
 defaultOpen={false}
 >
 <PhaseBandsPanel bandsA={data.phase_bands_a} labelA={label} />
 </CollapsibleSection>
 )}

 {/* Tempo Drift */}
 {(check.song_info as any)?.tempo_drift && (
 <CollapsibleSection
 title="Tempo Over Time · Archival"
 tooltip="Windowed BPM across the track. Useful for DJ licensing + classical reissues."
 why="Constant tempo = DJ-friendly, quantisable, remixable. Drifting tempo usually means the source was a performance, not a grid-locked DAW export; useful to flag for classical reissues, archival transfers, and live-album mastering where the drift is the point. For dance / pop deliveries, a visible drift is usually unintended."
 defaultOpen={false}
 >
 <TempoDriftPanel drift={(check.song_info as any).tempo_drift} />
 </CollapsibleSection>
 )}

 {/* Masking */}
 {data.masking && data.masking.overlaps && data.masking.overlaps.length > 0 && (
 <CollapsibleSection
 title="Masking Analysis"
 tooltip="Bands where multiple elements compete for the same frequency space."
 why="Masking is why mixes sound muddy, crowded, or 'never clear no matter how much I EQ'. Two elements fighting for the same frequency region means neither wins; one has to move. Side-chain, cut, or LPF the interferer instead of piling more EQ on the victim."
 defaultOpen={false}
 >
 <MaskingPanel masking={data.masking} />
 </CollapsibleSection>
 )}

 {/* Transient Density */}
 {data.transient_density && data.transient_density.timeline && data.transient_density.timeline.length > 0 && (
 <CollapsibleSection
 title="Transient Density & Structure"
 tooltip="Energy arc, rhythmic density, and section labels."
 why="A drop that doesn't land, a bridge that drags, a chorus quieter than expected: all show up here as section-labelled energy arcs before your ears notice. Useful for arrangement feedback on your own mixes and for spotting 'the limiter ate the second chorus' in someone else's."
 defaultOpen={false}
 >
 <TransientDensityPanel density={data.transient_density} durationSec={data.duration_sec} />
 </CollapsibleSection>
 )}

 {/* Mood & Emotion panel removed — */}

 {/* AI Detection panel removed in 5.5.0 — see CHANGELOG. */}

 {/* Vectorscope — rendered via a memoised sub-component so the
 2000+ SVG nodes aren't rebuilt on every tab-strip switch.
 " The
 fix caps point count at 1200 and memoises on the raw
 vectorscope array, so subsequent renders are O(1). */}
 {data.vectorscope_a && (
 <CollapsibleSection
 title="Stereo Vectorscope"
 tooltip="Lissajous display showing the stereo image shape."
 why="The vectorscope is the fastest visual test for stereo character. A narrow vertical shape means a mostly-mono mix; a wide horseshoe means lots of side content. Diagonal tilts indicate L/R balance issues. A glance tells you 'this mix leans wide' before you read a single number."
 defaultOpen={false}
 >
 <div className="flex justify-center">
 <div className="space-y-2 max-w-[250px]">
 <span className="text-xs text-dark-400">{label}</span>
 <div className="bg-dark-800/30 p-2 flex items-center justify-center" style={{ borderRadius: '2px' }}>
 <VectorscopeCanvas points={data.vectorscope_a} />
 </div>
 </div>
 </div>
 </CollapsibleSection>
 )}

 {/* Tonal Issues */}
 <CollapsibleSection
 title="Tonal Issues"
 tooltip="Detects perceptual problems like harshness, boominess, sibilance, muddiness, boxiness, and thinness."
 why="The named complaints you hear in every mixing book: boominess, muddiness, harshness, sibilance, boxiness, thinness. Each maps to a known frequency region. Objective flags save an hour of 'does this sound harsh to you?' back-and-forth and give you a frequency to start the EQ at."
 badge={
 tonalIssues.length > 0 ? (
 <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: 'var(--color-data-warn)', backgroundColor: 'rgba(224,122,79,0.1)' }}>
 {tonalIssues.length} detected
 </span>
 ) : (
 <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: 'var(--color-data-pass)', backgroundColor: 'rgba(110,197,119,0.1)' }}>
 Clean
 </span>
 )
 }
 defaultOpen={false}
 >
 <TonalIssues issues={tonalIssues} labelA={label} labelB={label} />
 </CollapsibleSection>
 </div>
 </div>
 )
}

function formatSec(sec: number): string {
 const m = Math.floor(sec / 60)
 const s = Math.floor(sec % 60)
 return `${m}:${s.toString().padStart(2, '0')}`
}

function StatBox({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
 const termByLabel: Record<string, string> = {
 'Integrated': 'lufsI',
 'Short-Term Max': 'lufsS',
 'True Peak': 'tp',
 'LRA': 'lra',
 'Stereo Width': 'midSide',
 }
 const termKey = termByLabel[label]
 return (
 <div className="p-3 text-center space-y-1" style={{ backgroundColor: 'rgba(48,44,39,0.5)', borderRadius: '2px' }}>
 <p className="text-[9px] tracking-widest uppercase flex items-center justify-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
 {termKey ? <TeachTerm term={termKey}>{label}</TeachTerm> : label}
 </p>
 <p className="text-sm font-medium" style={{ color: warn ? 'var(--color-danger)' : 'var(--color-sand-100)' }}>{value}</p>
 {sub && <p className="text-[9px]" style={{ color: 'var(--color-text-muted)' }}>{sub}</p>}
 </div>
 )
}

/**
 * Memoised Lissajous scatter — isolates the 2000+ SVG nodes from the
 * parent's render tree so tab-strip switches don't rebuild them.
 *
 * Point cap dropped from 2000 → 1200 after 
 * Memoised on the raw `points` array reference, so any parent re-render
 * that doesn't swap the data array is a zero-cost pass.
 */
const VectorscopeCanvas = React.memo(function VectorscopeCanvas({ points }: {
 points: { l: number; r: number }[]
}) {
 const cap = 1200
 const svgPoints = React.useMemo(() => {
 const step = Math.max(1, Math.floor(points.length / cap))
 const out: { x: number; y: number }[] = []
 for (let i = 0; i < points.length; i += step) {
 const { l, r } = points[i]
 const x = 100 + (l + r) * 100 * 0.7
 const y = 100 - (l - r) * 100 * 0.7
 out.push({
 x: Math.max(0, Math.min(200, x)),
 y: Math.max(0, Math.min(200, y)),
 })
 }
 return out
 }, [points])
 return (
 <svg viewBox="0 0 200 200" className="w-full" style={{ aspectRatio: '1' }}>
 <line x1={100} y1={0} x2={100} y2={200} stroke="#4c4d52" strokeWidth="0.5" opacity="0.3" />
 <line x1={0} y1={100} x2={200} y2={100} stroke="#4c4d52" strokeWidth="0.5" opacity="0.3" />
 {svgPoints.map((p, i) => (
 <circle key={i} cx={p.x} cy={p.y} r="0.8" fill="var(--color-accent)" opacity="0.15" />
 ))}
 </svg>
 )
})
