import React, { useMemo, useState, useEffect } from 'react'
import { AnalysisResult, FileInfo } from '../types'
import { DSP_PROFILES, profilesForSurface } from '../dspProfiles'
import { proposeMasterChain, MasterChain } from '../masterAssistant'
import { useEQ } from '../EQContext'
import { useModes } from '../ModesContext'
import EngineerTipsPanel from './EngineerTipsPanel'
import ReferenceMatchEQFromLibrary from './ReferenceMatchEQFromLibrary'
import { TeachTerm } from '../teachMe'

/**
 * Master Assistant v1. One surface, one action path.
 *
 * 1. Pick a delivery target (Spotify / Apple / YouTube / broadcast).
 * 2. RTM composes a chain (gain → EQ → TP limiter → dither).
 * 3. Preview the chain via the main player + Sound Check twin.
 * 4. One click renders the final WAV via apply_eq.py.
 *
 * Shows every decision and lets the user audition + edit before
 * committing. The whole workflow lives in one screen.
 */

interface Props {
 result: AnalysisResult
 fileB?: FileInfo
 label?: string
}

type MATab = 'chain' | 'tips' | 'match'

export default function MasterAssistantPanel({ result, fileB, label }: Props) {
 const eq = useEQ()
 const modes = useModes()

 // Pre-select the DSP target based on user surface — broadcast users
 // get Netflix / R128 ready to go; post engineers see Netflix;
 // streaming defaults to Spotify. "
 const defaultProfile =
 modes.surface === 'broadcast' ? 'ebur128' :
 modes.surface === 'post' ? 'netflix' :
 modes.surface === 'netflix' ? 'netflix' :
 'spotify'
 const [profileId, setProfileId] = useState<string>(defaultProfile)

 // Tabs: chain (default) / tips (engineer profile) / match (library).
 // 
 // users stop panel-hunting. Shared EQ bank in the main A/B player
 // means whichever tab proposes bands, they all audition live.
 const [tab, setTab] = useState<MATab>('chain')
 const [rendering, setRendering] = useState(false)
 const [renderMsg, setRenderMsg] = useState<string | null>(null)
 const [error, setError] = useState<string | null>(null)

 // Auto-dismiss render banners after 12s (longer than DMR's 8s because
 // renderMsg often contains the output path — users want a moment to
 // read + copy it). Error banners time out too so a stale red bar
 // doesn't linger after the user retries successfully. Clearing either
 // state resets its own timer (via the effect dependency).
 useEffect(() => {
 if (!renderMsg) return
 const t = setTimeout(() => setRenderMsg(null), 12000)
 return () => clearTimeout(t)
 }, [renderMsg])
 useEffect(() => {
 if (!error) return
 const t = setTimeout(() => setError(null), 10000)
 return () => clearTimeout(t)
 }, [error])
 // RIAA toggle — vinyl cut masters only. Separate from the DSP
 // target picker because vinyl uses a streaming profile for its
 // loudness anchor but needs the pre-emphasis curve on top.
 const [riaaEnabled, setRiaaEnabled] = useState(false)
 // Stem-apply toggle — when on, render the chain to each stem in
 // stems/ sibling folder rather than the mix. "
 const [stemApply, setStemApply] = useState<string[] | null>(null)

 const baseChain = useMemo<MasterChain | null>(() => proposeMasterChain(result, profileId), [result, profileId])
 // Merge user toggles into the proposed chain so the UI + renderer
 // see the same object. Amount from the EQ context scales the band
 // gains so what the user hears live in the A/B player is exactly
 // what they render.
 const chain = useMemo<MasterChain | null>(() => {
 if (!baseChain) return null
 const amount = eq.amount ?? 1
 return {
 ...baseChain,
 bands: baseChain.bands.map(b => ({ ...b, gain_db: Math.round(b.gain_db * amount * 10) / 10 })),
 riaa: { enabled: riaaEnabled },
 }
 }, [baseChain, eq.amount, riaaEnabled])

 const applyPreview = () => {
 if (!chain) return
 eq.setBands(chain.bands)
 eq.setEnabled(true)
 eq.setAmount(1)
 setRenderMsg('EQ engaged in the main player. Press Space to audition — flip EQ BYPASS on the transport to A/B.')
 }

 const buildCfg = (overrideBitDepth?: number) => {
 if (!chain) return null
 // ISRC + title / artist pulled from the analysis so BEXT / iXML
 // auto-embed at render time (
 const rc = (result as any).reference_check?.stats || {}
 // 5.2.4: removed dead `(result as any).genre_a?.isrc` fallback —
 // genre_a was deleted from the schema in 5.2.3; the field never
 // populated even before that.
 const isrc = rc.isrc || null
 const title = (result as any).reference_check?.song_info?.title || label || null
 const artist = (result as any).reference_check?.song_info?.artist || null
 const now = new Date().toISOString()
 const bext = {
 description: title ? `${title}${artist ? ` — ${artist}` : ''}` : 'Mastered with RTMcompare',
 originator: 'RTMcompare Master Assistant',
 originator_reference: `${chain.profile.id}-${now}`,
 origination_date: now.slice(0, 10),
 origination_time: now.slice(11, 19),
 coding_history: `A=PCM,F=${chain.sampleRate},W=${chain.bitDepth},M=stereo`,
 version: 2,
 }
 const ixml = isrc ? { ISRC: isrc, PROJECT: title || '', NOTE: `RTM chain: ${chain.profile.name}` } : null
 return {
 gain: chain.gainChangeDb,
 hpf: { enabled: chain.hpf.enabled, freq: chain.hpf.freq },
 eq: { bands: chain.bands.map(b => ({ freq: b.freq, gain_db: b.gain_db, q: b.q })) },
 comp: {
 enabled: chain.comp.enabled,
 threshold_db: chain.comp.thresholdDb,
 ratio: chain.comp.ratio,
 attack_ms: chain.comp.attackMs,
 release_ms: chain.comp.releaseMs,
 knee_db: chain.comp.kneeDb,
 makeup_db: chain.comp.makeupDb,
 },
 riaa: { enabled: chain.riaa.enabled },
 limit: { enabled: true, ceiling_db: chain.ceilingDbtp },
 target_sr: chain.sampleRate,
 bit_depth: overrideBitDepth ?? chain.bitDepth,
 bext,
 ixml,
 }
 }

 const renderFinal = async () => {
 if (!chain || !fileB) return
 if (!window.electronAPI?.masterChainRender) {
 setError('Rendering requires the Electron host.')
 return
 }
 setRendering(true); setError(null); setRenderMsg(null)
 try {
 const cfg = buildCfg()
 if (!cfg) { setRendering(false); return }
 const res = await window.electronAPI.masterChainRender(fileB.path, cfg)
 if (res?.cancelled) { setRendering(false); return }
 if (!res?.ok) {
 setError(res?.error || 'Render failed.')
 } else {
 const delta = res.lufs_in != null && res.lufs_out != null
 ? ` · ${res.lufs_in.toFixed(1)} → ${res.lufs_out.toFixed(1)} LUFS`
 : ''
 const tp = res.tp_out_dbtp != null ? ` · TP ${res.tp_out_dbtp.toFixed(1)} dBTP` : ''
 const meta = (res as any).metadata_note ? ` · ${(res as any).metadata_note}` : ''
 const riaa = chain.riaa.enabled ? ' · RIAA pre-emphasis applied' : ''
 setRenderMsg(`Rendered: ${res.path}${delta}${tp}${meta}${riaa}`)
 }
 } catch (e: any) {
 setError(e?.message || 'Render failed.')
 }
 setRendering(false)
 }

 // Stem-level chain apply — user picks a stems folder, the chain
 // (minus the final limiter) is applied to each stem, outputs are
 // written next to each stem as `<name>_mastered.wav`. 
 const renderStems = async () => {
 if (!chain || !window.electronAPI?.masterChainRender || !window.electronAPI?.pickFolder) {
 setError('Stem render requires the Electron host.')
 return
 }
 const folder = await window.electronAPI.pickFolder('Pick a stems folder (WAVs will be processed in-place)')
 if (!folder) return
 setRendering(true); setError(null); setRenderMsg(null)
 try {
 // The electron side doesn't currently list files — we ask the
 // user to name stems; for v1 we process four standard stems.
 // TODO: wire list-audio-files IPC to auto-discover.
 // Cross-platform path join — hard-coding '/' breaks on Windows.
 // Windows paths from pickFolder come back with backslashes; we
 // detect the separator from the folder itself instead of
 // assuming POSIX. Single source of truth per render call.
 const sep = folder.includes('\\') && !folder.includes('/') ? '\\' : '/'
 const join = (dir: string, name: string) => {
 const stripped = dir.endsWith('/') || dir.endsWith('\\') ? dir.slice(0, -1) : dir
 return stripped + sep + name
 }
 const stemFileNames = ['vocals.wav', 'drums.wav', 'bass.wav', 'other.wav']
 const renderedOk: string[] = []
 const renderedErr: string[] = []
 for (const name of stemFileNames) {
 const src = join(folder, name)
 // Turn off the limiter on the stem — we're NOT bouncing the
 // stem as a final delivery; we're conditioning it so the
 // summed mix downstream does the limiting.
 const cfg = buildCfg()
 if (!cfg) continue
 cfg.limit = { enabled: false, ceiling_db: chain.ceilingDbtp }
 const out = join(folder, name.replace(/\.wav$/i, '') + '_mastered.wav')
 const res = await window.electronAPI.masterChainRender(src, cfg, out)
 if (res?.ok) renderedOk.push(name)
 else renderedErr.push(`${name}: ${res?.error || 'failed'}`)
 }
 const okMsg = renderedOk.length ? `OK: ${renderedOk.join(', ')}` : ''
 const errMsg = renderedErr.length ? ` · errors: ${renderedErr.join(' · ')}` : ''
 setRenderMsg(`Stem-level chain rendered — ${okMsg}${errMsg}`)
 } catch (e: any) {
 setError(e?.message || 'Stem render failed.')
 }
 setRendering(false)
 }

 // Filter picker by the user's chosen surface so streaming-only
 // hobbyists never see EBU R128 / A85 / Netflix.
 const profiles = profilesForSurface(modes.surface)

 return (
 <div className="space-y-4">
 {/* Educator-only explainer — visible only when Learn mode is on.
 Reuses the same data-educator attribute CollapsibleSection
 reads so the whole "why am I looking at this" layer lights
 up together. */}
 {modes.educator && (
 <div
 className="px-3 py-2 text-[11px] leading-relaxed"
 style={{ borderRadius: '2px',
 backgroundColor: 'rgba(111,163,126,0.08)',
 border: '1px solid rgba(111,163,126,0.25)',
 color: 'var(--color-sand-300)',
 }}
 >
 <div className="text-[9px] uppercase tracking-[0.16em] mb-1" style={{ color: 'var(--color-success)' }}>
 Why this panel
 </div>
 <p className="mb-1.5" style={{ color: '#d9d4c8' }}>
 Master Assistant composes a full delivery chain for whichever DSP you pick: <strong>gain → HPF → EQ → compressor → 4× TP limiter → dither</strong>. Every stage shows its settings and rationale; preview the chain live in the main player before you render.
 </p>
 <p className="mb-1" style={{ color: 'var(--color-text-muted)' }}>
 <strong style={{ color: 'var(--color-sand-300)' }}>Gain</strong> moves the master towards the platform's normalisation target so the limiter sees a consistent starting level. <strong style={{ color: 'var(--color-sand-300)' }}>HPF</strong> strips sub-rumble phone speakers can't play. <strong style={{ color: 'var(--color-sand-300)' }}>EQ</strong> applies the engineer-profile / reference-match moves. <strong style={{ color: 'var(--color-sand-300)' }}>Compressor</strong> glues density when LRA &gt; 12 LU. <strong style={{ color: 'var(--color-sand-300)' }}>TP limiter</strong> catches inter-sample overs that streaming ingest would otherwise squash. <strong style={{ color: 'var(--color-sand-300)' }}>Dither</strong> shapes quantisation noise when rendering at 16-bit.
 </p>
 <p className="text-[10px] font-display italic" style={{ color: 'var(--color-text-muted)' }}>
 Three tabs: <strong>Chain</strong> = the full pipeline · <strong>Engineer Tips</strong> = tonal moves from the loaded profile · <strong>Reference Match</strong> = match a library track's spectrum. All three feed the same EQ bank in the main player; whichever tab you engage auditions live.
 </p>
 </div>
 )}
 <div className="flex items-start justify-between gap-3 flex-wrap">
 <div>
 <h2 className="text-lg" style={{ color: 'var(--color-text-primary)' }}>Master Assistant</h2>
 <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
 Pick a delivery target, preview the full chain live in the main player,
 render a delivery-ready master in one click.
 </p>
 </div>
 {/* Target picker */}
 <div className="flex items-center gap-1 p-1" style={{ backgroundColor: 'rgba(30,28,24,0.5)', borderRadius: '2px' }}>
 {profiles.map(p => (
 <button
 key={p.id}
 onClick={() => setProfileId(p.id)}
 className="text-[10px] px-3 py-1 transition-colors"
 style={{ borderRadius: '2px',
 color: profileId === p.id ? 'var(--color-accent)' : 'var(--color-text-muted)',
 backgroundColor: profileId === p.id ? 'rgba(208,176,102,0.15)' : 'transparent',
 border: `1px solid ${profileId === p.id ? 'rgba(208,176,102,0.4)' : 'transparent'}`,
 }}
 title={p.note}
 >
 {p.name}
 </button>
 ))}
 </div>
 </div>

 {/* Tab strip — Chain / Engineer Tips / Reference Match. All
 three feed the same shared EQ bank so auditioning one vs
 another in the main player is a single-click compare. */}
 <div className="flex items-center gap-1 rounded-full p-0.5" style={{ backgroundColor: 'rgba(30,28,24,0.5)', width: 'fit-content' }}>
 {([
 { id: 'chain' as const, label: 'Chain', hint: 'Full delivery chain: gain → HPF → EQ → compressor → TP limiter → dither.' },
 { id: 'tips' as const, label: 'Engineer Tips', hint: 'EQ moves from the loaded engineer profile — audition live in the main player.' },
 { id: 'match' as const, label: 'Reference Match', hint: 'Pick a track from the library; match its spectrum with parametric EQ.' },
 ] as const).map(t => (
 <button
 key={t.id}
 onClick={() => setTab(t.id)}
 className="text-[10px] uppercase tracking-[0.16em] px-3 py-1 rounded-full transition-colors"
 style={{
 color: tab === t.id ? 'var(--color-accent)' : 'var(--color-text-muted)',
 backgroundColor: tab === t.id ? 'rgba(208,176,102,0.15)' : 'transparent',
 border: `1px solid ${tab === t.id ? 'rgba(208,176,102,0.35)' : 'transparent'}`,
 }}
 title={t.hint}
 >
 {t.label}
 </button>
 ))}
 </div>

 {tab === 'tips' && (
 <div className="pt-2" style={{ borderTop: '1px solid rgba(168,161,150,0.06)' }}>
 {result.engineer_tips ? (
 <EngineerTipsPanel tips={result.engineer_tips} fileB={fileB} />
 ) : (
 <p className="text-[11px] font-display italic" style={{ color: 'var(--color-text-muted)' }}>
 No engineer profile active on this analysis — load a profile at scan time to generate tonal EQ tips.
 </p>
 )}
 </div>
 )}

 {tab === 'match' && (
 <div className="pt-2" style={{ borderTop: '1px solid rgba(168,161,150,0.06)' }}>
 <ReferenceMatchEQFromLibrary
 currentSpectrum={(result as any).spectrum_b || (result as any).spectrum_a}
 currentLabel={label}
 />
 </div>
 )}

 {tab === 'chain' && !chain && (
 <div className="text-[11px] font-display italic" style={{ color: 'var(--color-text-muted)' }}>Pick a valid target above.</div>
 )}

 {tab === 'chain' && chain && (
 <>
 {/* Chain summary */}
 <ChainTable chain={chain} />

 {/* Warnings */}
 {chain.warnings.length > 0 && (
 <ul
 className="px-3 py-2 text-[11px] space-y-0.5"
 style={{ backgroundColor: 'rgba(208,176,102,0.08)', border: '1px solid rgba(208,176,102,0.3)', color: 'var(--color-accent)', borderRadius: '2px' }}
 >
 {chain.warnings.map((w, i) => (
 <li key={i}>⚠ {w}</li>
 ))}
 </ul>
 )}

 {/* RIAA toggle — vinyl-only. Collapsed unless the user is
 in a workflow where it matters; we keep it inline for
 discoverability. Applies post-EQ / pre-limit. */}
 <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
 <label className="flex items-center gap-2 cursor-pointer">
 <input
 type="checkbox"
 checked={riaaEnabled}
 onChange={e => setRiaaEnabled(e.target.checked)}
 className="accent-[var(--color-accent)]"
 />
 <span>RIAA pre-emphasis (vinyl cut)</span>
 </label>
 {riaaEnabled && (
 <span className="text-[9px]" style={{ color: 'var(--color-accent)' }}>
 standard IEC 60098 curve — 50 Hz / 500 Hz / 2.122 kHz time constants, unity at 1 kHz
 </span>
 )}
 </div>

 {/* Action row */}
 <div className="flex items-center gap-2 flex-wrap">
 <button
 onClick={applyPreview}
 className="text-[11px] px-4 py-1.5"
 style={{ backgroundColor: 'rgba(208,176,102,0.18)', color: 'var(--color-accent)', border: '1px solid rgba(208,176,102,0.45)', borderRadius: '2px' }}
 title="Load the proposed EQ bands into the A/B player's EQ bank to audition tone changes live. The Amount slider in the player header scales the gains; whatever you set there is what renders."
 >
 Preview in main player
 </button>
 <button
 onClick={renderFinal}
 disabled={rendering || !fileB}
 className="text-[11px] px-4 py-1.5 disabled:opacity-50"
 style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-bg-app)', borderRadius: '2px' }}
 title={fileB
 ? `Render a ${chain.bitDepth}-bit / ${chain.sampleRate / 1000} kHz WAV with the full chain baked in at the current Amount scaling, plus BEXT / iXML metadata embedded.`
 : 'Load a file to render'}
 >
 {rendering ? 'Rendering…' : `Render for ${chain.profile.name}`}
 </button>
 <button
 onClick={renderStems}
 disabled={rendering}
 className="text-[11px] px-3 py-1.5"
 style={{ color: 'var(--color-accent)', border: '1px solid rgba(208,176,102,0.35)', borderRadius: '2px' }}
 title="Pick a folder containing stems (vocals/drums/bass/other WAVs). RTM applies the chain minus the final limiter to each stem and writes <name>_mastered.wav next to each. Useful when the limiter lives on the summed mix downstream."
 >
 Stem-level render…
 </button>
 <button
 onClick={() => { eq.clear(); setRenderMsg(null); setError(null); setRiaaEnabled(false) }}
 className="text-[11px] px-3 py-1.5"
 style={{ color: 'var(--color-text-muted)', border: '1px solid rgba(168,161,150,0.2)', borderRadius: '2px' }}
 >
 Clear
 </button>
 </div>

 {renderMsg && (
 <RenderCompleteBanner message={renderMsg} onDismiss={() => setRenderMsg(null)} />
 )}
 {error && (
 <div className="text-[11px] px-3 py-2 rounded" style={{ color: 'var(--color-danger)', backgroundColor: 'rgba(224,90,90,0.06)', border: '1px solid rgba(224,90,90,0.3)' }}>
 ⚠ {error}
 </div>
 )}
 </>
 )}
 </div>
 )
}

function ChainTable({ chain }: { chain: MasterChain }) {
 const rows: { label: string; value: string; detail: string; status?: 'on' | 'off' }[] = [
 {
 label: 'Target',
 value: `${chain.profile.name} · ${chain.targetLufs} LUFS`,
 detail: chain.profile.note,
 },
 {
 label: 'Gain',
 value: chain.gainChangeDb === 0
 ? 'no change'
 : `${chain.gainChangeDb > 0 ? '+' : ''}${chain.gainChangeDb.toFixed(1)} dB`,
 detail: chain.gainChangeDb === 0
 ? 'Master is already at target level.'
 : chain.gainChangeDb > 0
 ? 'Push the master up towards the platform target.'
 : 'Pull the master down so the TP limiter has headroom.',
 },
 {
 label: 'HPF',
 status: chain.hpf.enabled ? 'on' : 'off',
 value: chain.hpf.enabled ? `Butterworth 12 dB/oct @ ${chain.hpf.freq} Hz` : 'bypassed',
 detail: chain.hpf.enabled
 ? 'Sub-rumble removal — industry-standard 2nd-order Butterworth, zero-phase not applied (phase-aligned with the kick envelope).'
 : 'Bottom band already controlled.',
 },
 {
 label: 'EQ',
 value: chain.bands.length === 0 ? 'no moves' : `${chain.bands.length} band${chain.bands.length === 1 ? '' : 's'}`,
 detail: chain.bands.length === 0
 ? 'Engineer tips produced no EQ suggestions.'
 : chain.bands.map(b => `${b.freq >= 1000 ? `${(b.freq / 1000).toFixed(b.freq % 1000 === 0 ? 0 : 1)}k` : b.freq} Hz ${b.gain_db > 0 ? '+' : ''}${b.gain_db.toFixed(1)} dB / Q ${b.q.toFixed(1)}`).join(' · '),
 },
 {
 label: 'Compressor',
 status: chain.comp.enabled ? 'on' : 'off',
 value: chain.comp.enabled
 ? `${chain.comp.ratio.toFixed(1)}:1 @ ${chain.comp.thresholdDb} dB · ${chain.comp.attackMs}/${chain.comp.releaseMs} ms · ${chain.comp.kneeDb} dB knee`
 : 'bypassed',
 detail: chain.comp.enabled
 ? 'Program-dependent: RMS detector (10 ms window) with a peak-guard that lets transients > 3 dB above RMS drive reduction, 6 dB soft knee. Release tracks a 500 ms density follower — dense / loud sections stretch the release up to 2.5× so the comp "breathes" instead of chatters, sparse passages keep the 200 ms baseline so drums retain attack. Auto-makeup matches input RMS within ±0.3 dB so the bypass A/B is level-matched.'
 : 'Dynamics already controlled (< 12 LU range); no glue compression needed.',
 },
 ...(chain.riaa.enabled ? [{
 label: 'RIAA',
 status: 'on' as const,
 value: 'IEC 60098 recording curve',
 detail: 'Time-constants 3180 µs / 318 µs / 75 µs. Turntable playback applies the inverse — master sounds flat on the consumer side. Goes post-EQ, pre-limiter so the limiter catches the post-emphasis HF hot-spots.',
 }] : []),
 {
 label: 'Limiter',
 value: `TP ≤ ${chain.ceilingDbtp.toFixed(1)} dBTP`,
 detail: '4× oversampled look-ahead limiter (same math as the Sound Check twin).',
 },
 {
 label: 'Format',
 value: `${chain.bitDepth}-bit · ${chain.sampleRate / 1000} kHz${chain.dither ? ' · TPDF dither' : ''}`,
 detail: `Matches ${chain.profile.name}'s delivery spec.`,
 },
 ]
 return (
 <div className="overflow-hidden" style={{ border: '1px solid rgba(168,161,150,0.1)', backgroundColor: 'rgba(30,28,24,0.4)', borderRadius: '2px' }}>
 {rows.map((r, i) => (
 <div
 key={r.label}
 className="flex items-start px-3 py-2"
 style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(168,161,150,0.06)' }}
 >
 <span className="w-24 text-[9px] uppercase tracking-[0.16em] pt-0.5" style={{ color: 'var(--color-text-muted)' }}>
 {(() => {
 // Wire the small glossary of chain-stage terms into TeachTerm
 // so hovering the stage label in Learn mode reveals the
 // InfoTooltip body (attack/release, knee, make-up, etc.).
 // Only the stage labels that correspond to a registered
 // glossary key get wrapped — everything else renders plain.
 const termByLabel: Record<string, string | undefined> = {
 Compressor: 'compressor',
 RIAA: 'riaa',
 Limiter: 'tpLimiter',
 }
 const key = termByLabel[r.label]
 return key ? <TeachTerm term={key}>{r.label}</TeachTerm> : r.label
 })()}
 {r.status && (
 <span
 className="ml-1.5 px-1 py-px rounded-sm"
 style={{
 color: r.status === 'on' ? 'var(--color-accent)' : 'var(--color-text-muted)',
 backgroundColor: r.status === 'on' ? 'rgba(208,176,102,0.12)' : 'transparent',
 border: `1px solid ${r.status === 'on' ? 'rgba(208,176,102,0.35)' : 'rgba(87,83,78,0.3)'}`,
 fontSize: 8,
 }}
 >
 {r.status.toUpperCase()}
 </span>
 )}
 </span>
 <div className="flex-1">
 <div className="text-[12px] font-mono" style={{ color: 'var(--color-text-primary)' }}>{r.value}</div>
 <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{r.detail}</div>
 </div>
 </div>
 ))}
 </div>
 )
}

/**
 * Render-complete banner — shown after Master Assistant's Render
 * call succeeds. Parses the message's `Rendered: <path>` prefix so
 * we can offer a "Reveal in Finder" / "Open folder" shortcut — panel
 * ask (indie producer): "tell me where the file actually went."
 */
function RenderCompleteBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
 const match = message.match(/Rendered:\s*([^\s·]+(?:\s[^\s·]+)*?)(?=\s*·|\s*$)/)
 const path = match ? match[1].trim() : null
 const reveal = async () => {
 if (!path || !window.electronAPI?.revealInFinder) return
 try { await window.electronAPI.revealInFinder(path) } catch {}
 }
 return (
 <div
 className="px-3 py-2 flex items-start gap-3"
 style={{
 borderRadius: '2px',
 color: 'var(--color-data-pass)',
 backgroundColor: 'rgba(110,197,119,0.06)',
 border: '1px solid rgba(110,197,119,0.3)',
 }}
 >
 <span className="text-[14px] leading-none pt-0.5">✓</span>
 <div className="flex-1 min-w-0">
 <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: 'var(--color-data-pass)' }}>
 Master ready
 </div>
 <div className="text-[11px] mt-0.5 break-all" style={{ color: 'var(--color-text-primary)' }}>{message}</div>
 </div>
 <div className="flex items-center gap-2 flex-shrink-0">
 {path && window.electronAPI?.revealInFinder && (
 <button
 onClick={reveal}
 className="text-[10px] px-2 py-0.5"
 style={{ color: 'var(--color-data-pass)', border: '1px solid rgba(110,197,119,0.45)', borderRadius: '2px' }}
 title={`Reveal ${path} in Finder / Explorer`}
 >
 Reveal
 </button>
 )}
 <button
 onClick={onDismiss}
 className="text-[10px] px-2 py-0.5"
 style={{ color: 'var(--color-text-muted)', border: '1px solid rgba(168,161,150,0.2)', borderRadius: '2px' }}
 >
 Dismiss
 </button>
 </div>
 </div>
 )
}
