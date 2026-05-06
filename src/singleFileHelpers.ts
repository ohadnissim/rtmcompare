import { AnalysisResult, BatchResult } from './types'
import { DSP_PROFILES, streamingTpFloorDbtp } from './dspProfiles'

/**
 * Ready-to-Deliver verdict — the top-of-view traffic light every single-file
 * surface (RefOnlyView, SongDetailPanel) shares. Pass/Warn/Hold derived from
 * the obvious QC flags only.
 *
 * 5.3.0: TP is informational. The streaming platforms turn the master DOWN on
 * ingest, which is desirable, not a delivery failure. Reference top-40 masters
 * routinely sit above the streaming TP floor — the alarm was crying wolf.
 * Hum / distortion "problem" severity is HOLD. Everything else rolls up to
 * WARN.
 */
export type VerdictLevel = 'ready' | 'warn' | 'hold'

export interface Verdict {
 level: VerdictLevel
 title: string
 reasons: string[]
 /** Per-DSP pass/fail so the label-ops view gets what the GM asked for. */
 dsp: { name: string; pass: boolean; detail: string }[]
 /** Mono-compat %loss — surfaced as a badge in the verdict row so the
 * dedicated MonoCompat panel can stay behind Advanced QC. Panel
 * ask: "MonoCompat is a single number, not a heatmap." */
 monoLossPct?: number | null
 /** One-line actionable next step ("Ship it." / "Pull the limiter 0.5 dB and re-render." /
 * "HOLD — fix the 12 clipped samples at 01:47 before delivery.") The panel's indie
 * persona explicitly asked for this — the traffic-light alone leaves
 * newer users guessing what to *do*. */
 action?: string
}

/**
 * Normalise either a BatchResult (lite) or a full AnalysisResult (deep
 * single-file pass) into one compact metric record. Every helper downstream
 * reads from this so we don't carry two shapes everywhere.
 */
export interface SingleFileMetrics {
 lufs: number | null
 true_peak: number | null
 lra: number | null
 duration_sec: number | null
 sample_rate: number | null
 bit_depth: number | null
 channels: number | null
 isrc?: string | null
 upc?: string | null
 clipped_samples: number | null
 mono_compat_loss_pct: number | null
 /** Hottest short-term LUFS (LUFS-S) window across the programme.
 * Fed to DSP-profile evaluation so we can flag drops / builds that
 * will trigger the soft-limiter post-normalisation. */
 short_term_max?: number | null
 /** Dialog-gated integrated LUFS — speech only. Populated by the
 * backend's dialog-gate pass (Python) when the track contains
 * detectable speech. Netflix / ATSC A/85 QC anchors here, not
 * the full-programme integrated. */
 dialog_lufs?: number | null
}

export function metricsFromBatch(r: BatchResult): SingleFileMetrics {
 return {
 lufs: r.lufs_i,
 true_peak: r.true_peak_dbtp,
 lra: r.lra,
 duration_sec: r.duration_sec,
 sample_rate: r.sample_rate,
 bit_depth: r.bit_depth,
 channels: r.channels,
 isrc: r.isrc,
 upc: r.upc,
 clipped_samples: r.clipped_samples,
 mono_compat_loss_pct: r.mono_compat_loss_pct,
 }
}

export function metricsFromFull(r: AnalysisResult, fallback?: SingleFileMetrics): SingleFileMetrics {
 const stats = (r.reference_check?.stats || {}) as any
 const clip = stats.clip_count
 const lufs = r.overall?.lufs_b ?? stats.lufs ?? fallback?.lufs ?? null
 const tp = r.headroom?.true_peak_b ?? r.distortion?.true_peaks?.b_true_peak_db ?? fallback?.true_peak ?? null
 const lra = r.overall?.dynamics_b ?? stats.dynamic_range ?? fallback?.lra ?? null
 const dur = r.duration_sec_b ?? r.duration_sec ?? fallback?.duration_sec ?? null
 // mono-compat: prefer fallback (batch) since full analysis uses a different
 // "weighted risk" scale; batch's % loss is more intuitive in a single view.
 return {
 lufs,
 true_peak: tp,
 lra,
 duration_sec: dur,
 sample_rate: fallback?.sample_rate ?? null,
 bit_depth: fallback?.bit_depth ?? null,
 channels: fallback?.channels ?? null,
 // 5.2.3: top-level genre_a removed — fall back directly to the
 // reference-check ISRC like everywhere else.
 isrc: fallback?.isrc ?? null,
 upc: fallback?.upc ?? null,
 clipped_samples: clip != null ? clip : (fallback?.clipped_samples ?? null),
 mono_compat_loss_pct: fallback?.mono_compat_loss_pct ?? null,
 // New gate inputs — populated by the Python backend when available.
 // The `lufs_over_time_b` series already exists; take its max as the
 // short-term peak. Dialog-gated LUFS comes from the speech gate
 // pass added in Batch H.
 short_term_max: (() => {
 const series = r.lufs_over_time_b
 if (!series || series.length === 0) return null
 const peak = Math.max(...series.filter((v: number) => isFinite(v)))
 return isFinite(peak) ? peak : null
 })(),
 dialog_lufs: r.dialog_gate?.lufs_i ?? null,
 }
}

/** Per-platform integrated-LUFS target for the Ready-to-Deliver DSP
 * row. Music-streaming first (the default view), with broadcast +
 * social underneath for callers that pass a dspFilter narrowing the
 * grid by user surface. */
const DSP_TARGETS: { name: string; target: number }[] = [
 // Music streaming
 { name: 'Spotify', target: -14 },
 { name: 'Apple Music', target: -16 },
 { name: 'YouTube', target: -14 },
 { name: 'Tidal', target: -14 },
 { name: 'Amazon Music', target: -14 },
 // Added in the 4.0 delivery-profile audit — both were named in the
 // manual + pitch deck but missing from the verdict grid.
 { name: 'Deezer', target: -15 },
 { name: 'SoundCloud', target: -14 },
 // Social
 { name: 'TikTok', target: -14 },
 { name: 'YouTube Shorts', target: -14 },
 { name: 'Instagram / Reels', target: -14 },
 // Broadcast / post
 { name: 'EBU R128 (broadcast)', target: -23 },
 { name: 'ATSC A/85 - CALM Act', target: -24 },
 { name: 'Netflix', target: -27 },
]

export function buildVerdict(m: SingleFileMetrics, full?: Partial<AnalysisResult> | null, opts?: {
 /** When set, restrict the verdict's `dsp` row to profiles matching
 * the user's selected surface + target. Panel fix: the Attention
 * list filters to the selected DSP but the verdict grid was
 * hard-coded to streaming music only — inconsistent. */
 dspFilter?: (name: string) => boolean
}): Verdict {
 const reasons: string[] = []
 let level: VerdictLevel = 'ready'

 // HOLD cases — blocking issues.
 // 5.2.4: TP HOLD removed by user direction (5.1: "no warnings at all,
 // just display numbers"). The 5.1 sweep cleaned helpers/panels but the
 // verdict + attention paths inside this file were missed. Streaming
 // platforms apply their own true-peak limiting; flagging it as HOLD on
 // the engineer side caused false delivery-blocks on otherwise-clean
 // masters. Numbers still display via the normal stat readouts.
 if ((m.clipped_samples || 0) > 0) {
 level = 'hold'
 reasons.push(`${m.clipped_samples} clipped sample${m.clipped_samples === 1 ? '' : 's'} at 0 dBFS`)
 }
 if (m.sample_rate != null && m.sample_rate < 44100) {
 level = 'hold'
 reasons.push(`Sample rate ${m.sample_rate} Hz — below 44.1 kHz minimum`)
 }
 if (m.bit_depth != null && m.bit_depth < 16) {
 level = 'hold'
 reasons.push(`Bit depth ${m.bit_depth}-bit — below 16-bit minimum`)
 }
 if (full?.distortion?.severity === 'problem') {
 // Only HOLD the delivery on high-confidence distortion. Low-confidence
 // means the signal was flagged purely on THD or flat-top heuristics,
 // both of which mis-classify intentional saturation / heavy mastering
 // limiting. Demote to WARN so the engineer sees it but doesn't get
 // locked out on a false positive.
 const conf = full.distortion.confidence || 'high'
 if (conf === 'high') {
 level = 'hold'
 reasons.push('Audible distortion detected')
 } else if (conf === 'medium') {
 // Fold into WARN below
 } else {
 // low-confidence — note it, but it does not gate delivery
 }
 }
 const hiClicks = (full?.clicks || []).filter(c => c.severity === 'high').length
 if (hiClicks > 0) {
 level = 'hold'
 reasons.push(`${hiClicks} audible click${hiClicks === 1 ? '' : 's'} — fix before delivery`)
 }
 if (full?.hum?.severity === 'audible') {
 level = 'hold'
 reasons.push(`Audible hum at ${full.hum.mains} Hz (and harmonics)`)
 }

 // WARN cases — only promoted when not already 'hold'. We collect into a
 // side list first, then promote once at the end; that keeps TS's control-
 // flow narrowing happy (it doesn't track closure-level mutations of
 // `level`).
 const warnMsgs: string[] = []
 if ((level as VerdictLevel) !== 'hold') {
 // TP-margin and ISRC warnings disabled by user direction.
 if (m.mono_compat_loss_pct != null && m.mono_compat_loss_pct > 30) {
 warnMsgs.push(`${m.mono_compat_loss_pct}% mono-compat loss — elements may disappear on phone speakers`)
 }
 if (full?.distortion?.severity === 'warning') {
 const conf = full.distortion.confidence || 'high'
 warnMsgs.push(conf === 'low'
 ? 'Possible distortion (low-confidence signal — audition before acting)'
 : 'Minor distortion detected')
 }
 // A 'problem'-severity finding with non-high confidence lands here too.
 if (full?.distortion?.severity === 'problem'
 && full.distortion.confidence && full.distortion.confidence !== 'high') {
 warnMsgs.push(full.distortion.confidence === 'medium'
 ? 'Heavy limiting flagged — confirm whether the flat-top shape is intentional'
 : 'Saturation flagged — probably intentional, audition to confirm')
 }
 if (full?.hum?.severity === 'subtle') warnMsgs.push(`Subtle hum at ${full.hum.mains} Hz`)
 }
 if (warnMsgs.length > 0 && (level as VerdictLevel) !== 'hold') {
 level = 'warn'
 reasons.push(...warnMsgs)
 }

 // Per-DSP row — what each platform would do with this master.
 // Filtered by caller's dspFilter when the user has picked a
 // specific target (broadcast / post / social); otherwise the
 // default streaming-music lineup holds.
 const dsp = DSP_TARGETS
 .filter(({ name }) => !opts?.dspFilter || opts.dspFilter(name))
 .map(({ name, target }) => {
 if (m.lufs == null) return { name, pass: false, detail: 'unknown' }
 const delta = m.lufs - target
 // Pass if TP is in spec AND we're not massively over the target
 // (being quiet is always ok — platforms might boost quiet masters on
 // Apple, others leave them alone; neither rejects you for quietness).
 const tpOk = m.true_peak == null || m.true_peak <= streamingTpFloorDbtp()
 const pass = tpOk
 const detail = `${m.lufs.toFixed(1)} → plays ${target} LUFS (${delta > 0 ? '−' : ''}${Math.abs(delta).toFixed(1)} dB)`
 return { name, pass, detail }
 })

 const title =
 level === 'ready' ? 'Ready to ship.' :
 level === 'warn' ? 'One revision needed.' :
 'Hold — fix before delivery.'

 // ── Single actionable next step ────────────────────────────────────────
 // We look at the strongest HOLD evidence first (TP > −1 → clipping →
 // metadata → audible defects), then fall back to WARN-tier actions.
 // Keep it imperative ("Pull …", "Enable …", "Fix …") and concrete —
 // the indie persona explicitly asked for "tell me what to DO".
 const firstClick = (full?.clicks || []).find(c => c.severity === 'high')
 let action: string
 if (level === 'ready') {
 action = 'Ship it.'
 // 5.4.2: TP-as-warning swept here too. Streaming platforms turn the
 // master DOWN on ingest; reference top-40 routinely sits above the
 // streaming TP floor. The "ceiling" recommendation was crying wolf and
 // the user explicitly asked for it gone. Numbers stay visible in the
 // panel; no Hold action driven by TP alone.
 } else if ((m.clipped_samples || 0) > 0) {
 action = `Fix the ${m.clipped_samples} clipped sample${m.clipped_samples === 1 ? '' : 's'} — drop the master-bus output 0.3–0.5 dB and re-render.`
 } else if (m.sample_rate != null && m.sample_rate < 44100) {
 action = `Re-render at 44.1 kHz or higher.`
 } else if (m.bit_depth != null && m.bit_depth < 16) {
 action = `Re-render at 16-bit or higher.`
 } else if (firstClick) {
 action = `Jump to ${firstClick.time_formatted || firstClick.time.toFixed(2) + 's'} in the Clicks panel, audition, and fix the edit / plugin glitch.`
 } else if (full?.hum?.severity === 'audible') {
 action = `Copy the ${full.hum.mains} Hz notch preset from the Hum panel into your EQ and re-render.`
 } else if (full?.distortion?.severity === 'problem' && (full.distortion.confidence || 'high') === 'high') {
 action = `Ease the limiter / saturator — distortion is audible.`
 } else if (level === 'warn' && m.mono_compat_loss_pct != null && m.mono_compat_loss_pct > 30) {
 action = `Audition in mono (press M in the player) — decide if the lost elements matter.`
 } else if (level === 'warn') {
 action = `Review the WARN items below, then ship if they're intentional.`
 } else {
 action = `See the reasons above and revise.`
 }

 return { level, title, reasons, dsp, action, monoLossPct: m.mono_compat_loss_pct ?? null }
}

/**
 * Compact attention list — promoted above the transport, per the Ops
 * feedback ("right now I scroll past it"). Consolidates TP / clipping /
 * mono / ISRC / clicks / hum / distortion into clickable rows.
 */
export interface AttentionItem {
 severity: 'hold' | 'warn' | 'info'
 message: string
 /** Optional transport time-jump — set by rows derived from a click
 * timeline, a hum detection at a timestamp, etc. */
 jumpSec?: number
}

export function buildAttentionItems(m: SingleFileMetrics, full?: Partial<AnalysisResult> | null): AttentionItem[] {
 const items: AttentionItem[] = []
 // 5.2.4: TP attention item removed by user direction — see buildVerdict
 // comment above. Number still renders in the stat strip; we don't
 // editorialize it here.
 if ((m.clipped_samples || 0) > 0) {
 items.push({ severity: 'hold', message: `${m.clipped_samples} clipped sample${m.clipped_samples === 1 ? '' : 's'} at 0 dBFS.` })
 }
 if (full?.distortion?.severity === 'problem') {
 items.push({ severity: 'hold', message: 'Audible distortion — review limiter / clipping threshold.' })
 } else if (full?.distortion?.severity === 'warning') {
 items.push({ severity: 'warn', message: 'Minor distortion — borderline, audition before shipping.' })
 }
 if (full?.hum?.severity === 'audible') {
 items.push({ severity: 'hold', message: `Audible hum at ${full.hum.mains} Hz and harmonics.` })
 } else if (full?.hum?.severity === 'subtle') {
 items.push({ severity: 'warn', message: `Subtle hum at ${full.hum.mains} Hz — check room / DI.` })
 }
 const hiClicks = (full?.clicks || []).filter(c => c.severity === 'high')
 for (const c of hiClicks.slice(0, 4)) {
 items.push({
 severity: 'hold',
 message: `Audible click at ${c.time_formatted || c.time.toFixed(2) + 's'} — ${c.description || 'plugin glitch or edit point'}.`,
 jumpSec: c.time,
 })
 }
 if (hiClicks.length > 4) {
 items.push({ severity: 'hold', message: `+ ${hiClicks.length - 4} more click${hiClicks.length - 4 === 1 ? '' : 's'} (see Clicks timeline below).` })
 }
 if (m.mono_compat_loss_pct != null && m.mono_compat_loss_pct > 30) {
 items.push({ severity: 'warn', message: `${m.mono_compat_loss_pct}% energy loss in mono — will degrade on phone speakers / Bluetooth.` })
 }
 // ISRC missing-metadata warning disabled by user direction.

 // Limiter-artefact detector findings — pumping / ISO overs /
 // ringing. Down-weighted when confidence is medium/low so single-
 // detector hits don't bloat the list.
 const la = full?.limiter_artefacts
 if (la) {
 const conf = la.confidence
 const demoteOnLowConfidence = conf !== 'high'
 if (la.severity === 'problem' && !demoteOnLowConfidence) {
 for (const issue of la.issues) items.push({ severity: 'hold', message: issue })
 } else if (la.severity === 'problem' || la.severity === 'warning') {
 for (const issue of la.issues) items.push({ severity: 'warn', message: issue })
 }
 }

 return items
}

/* ────────────────────────────────────────────────────────────────────────── *\
 * Revision auto-detect *
 * *
 * Mastering engineers iterate: "Track 7 v2", "07 Hennessy REV3", *
 * "Moonlit_Drive_FINAL.wav", "Moonlit_Drive_MASTER_v4.wav". When the user is *
 * viewing one of these, we want to surface the sibling revisions in the *
 * A/B reference dropdown under a "Revisions" optgroup so they can live- *
 * reference the previous pass without hunting for it. *
 * *
 * Heuristic: strip version / status suffixes from each filename, compare *
 * the resulting "base stem" — files that share a base are treated as *
 * revisions of each other. *
\* ────────────────────────────────────────────────────────────────────────── */

const VERSION_RE = /([\s_\-]*)(v\d+|rev\d+|mix\d*|master\d*|final\d*|draft\d*|rough\d*|mastered|unmastered|copy\d*)+(\s*\d+)?$/i

/**
 * Strip trailing version / status tokens from a filename stem. Returns
 * the lower-cased "base" used for equivalence grouping. We also drop a
 * leading track number so "01 Hennessy v2.wav" and "Hennessy v1.wav"
 * group together when the engineer renumbered between revs.
 */
export function revisionBaseKey(filename: string): string {
 let s = filename.replace(/\.[^/.]+$/, '') // strip extension
 s = s.replace(/^\s*\d{1,3}\s*[-._]+\s*/, '') // leading track #
 // Iteratively strip trailing version / status tokens (the regex catches
 // one suffix per pass; "_v2_FINAL" needs two passes).
 for (let i = 0; i < 3; i++) {
 const next = s.replace(VERSION_RE, '')
 if (next === s) break
 s = next
 }
 return s.replace(/[_\s]+/g, ' ').trim().toLowerCase()
}

/** Does this filename look like a versioned revision at all? */
export function looksLikeRevision(filename: string): boolean {
 const stem = filename.replace(/\.[^/.]+$/, '')
 return VERSION_RE.test(stem)
}

/**
 * Given the current song + the full album list, return siblings that
 * appear to be other revisions of the same track. Never includes the
 * current song itself.
 */
export function inferRevisions<T extends { path: string; filename: string }>(
 current: T,
 all: T[],
): T[] {
 const baseCurrent = revisionBaseKey(current.filename)
 if (!baseCurrent) return []
 return all.filter(r => r.path !== current.path && revisionBaseKey(r.filename) === baseCurrent)
}

/**
 * Compact format strip — "44.1k · 24-bit · 2ch · ISRC ABC123456789" —
 * replaces the 4-line metadata block with one line. Panel consensus.
 */
export function formatMetadataStrip(m: SingleFileMetrics): string {
 const parts: string[] = []
 if (m.sample_rate != null) {
 parts.push(`${(m.sample_rate / 1000).toFixed(m.sample_rate % 1000 === 0 ? 0 : 1)}k Hz`)
 }
 if (m.bit_depth != null) parts.push(`${m.bit_depth}-bit`)
 if (m.channels != null) parts.push(`${m.channels} ch`)
 if (m.isrc) parts.push(`ISRC ${m.isrc}`)
 if (m.upc) parts.push(`UPC ${m.upc}`)
 return parts.join(' · ')
}

/* --------------------------------------------------------------------------- */
/* ADM ready-to-deliver stamp */
/* --------------------------------------------------------------------------- */

export interface AdmCheck {
 /** Stable key the UI can use for tooltips / keyboard navigation. */
 key: 'bit_depth' | 'sample_rate' | 'true_peak' | 'source_chain' | 'mastered_for_itunes'
 /** Display label ("24-bit or higher", "Lossless source chain"). */
 label: string
 /** Did this specific check pass? */
 pass: boolean
 /** Short human-readable reading ("24-bit", "−0.9 dBTP"). */
 value: string
 /** Longer advisory if the check failed or is warning-level. */
 detail?: string
}

export interface AdmReadiness {
 /** Aggregate status — `ready` when every hard check passes;
 * `warn` when only soft-advisory checks are open (e.g. we cannot
 * confirm the source-chain from BEXT coding_history but nothing is
 * actively failing); `fail` when a hard requirement is missed. */
 status: 'ready' | 'warn' | 'fail'
 checks: AdmCheck[]
 /** One-line action for the UI badge ("APPLE DIGITAL MASTERS READY",
 * "Hold — 48k / 24-bit required"). */
 action: string
}

/**
 * Compute Apple Digital Masters readiness from what RTM already knows.
 *
 * Apple's published ADM technical requirements (2024 spec, enforced by
 * their ingest QC):
 * 1. Bit depth ≥ 24 — HARD
 * 2. Sample rate ≥ 44.1 kHz — HARD
 * 3. True peak ≤ −1 dBTP — HARD
 * 4. Lossless source chain (no MP3/AAC — SOFT (we verify via
 * intermediaries in the master chain) BEXT coding_history;
 * advisory if unknown)
 * 5. No clipped samples — HARD
 *
 * "
 *
 * `codingHistoryRaw` is the BEXT `coding_history` string when present.
 * We look for lossy signatures ('MP3', 'AAC', 'M=joint-stereo' without
 * 'PCM' earlier in the chain). When the field is empty we mark the
 * source-chain check as WARN rather than fail — a file without BEXT
 * can still be a lossless master; it just can't prove it.
 */
export function computeAdmReadiness(args: {
 bitDepth: number | null
 sampleRate: number | null
 truePeakDbtp: number | null
 clippedSamples: number | null
 codingHistoryRaw?: string | null
}): AdmReadiness {
 const { bitDepth, sampleRate, truePeakDbtp, clippedSamples, codingHistoryRaw } = args
 const checks: AdmCheck[] = []

 // 1. Bit depth ≥ 24
 checks.push({
 key: 'bit_depth',
 label: '24-bit or higher',
 pass: bitDepth != null && bitDepth >= 24,
 value: bitDepth != null ? `${bitDepth}-bit` : 'unknown',
 detail: bitDepth != null && bitDepth < 24
 ? `Apple Digital Masters requires 24-bit or higher. This file is ${bitDepth}-bit — re-bounce at 24-bit.`
 : bitDepth == null
 ? 'Bit depth not detected from the file header.'
 : undefined,
 })

 // 2. Sample rate ≥ 44.1 kHz
 checks.push({
 key: 'sample_rate',
 label: '44.1 kHz or higher',
 pass: sampleRate != null && sampleRate >= 44100,
 value: sampleRate != null ? `${(sampleRate / 1000).toFixed(sampleRate % 1000 === 0 ? 0 : 1)} kHz` : 'unknown',
 detail: sampleRate != null && sampleRate < 44100
 ? `Apple Digital Masters requires 44.1 kHz minimum. This file is ${(sampleRate / 1000).toFixed(1)} kHz.`
 : undefined,
 })

 // 3. True peak — display only, no pass/fail (per user direction)
 checks.push({
 key: 'true_peak',
 label: 'True peak',
 pass: true,
 value: truePeakDbtp != null ? `${truePeakDbtp.toFixed(1)} dBTP` : 'unknown',
 detail: undefined,
 })

 // 4. No clipped samples (HARD)
 checks.push({
 key: 'true_peak', // reuse key — clipping is a TP/integrity issue
 label: 'No digital clipping',
 pass: clippedSamples == null || clippedSamples === 0,
 value: clippedSamples == null ? 'unknown' : clippedSamples === 0 ? 'clean' : `${clippedSamples} samples`,
 detail: (clippedSamples || 0) > 0
 ? `${clippedSamples} clipped sample(s) detected — Apple rejects files with digital clipping. Re-render with 1–2 dB of headroom.`
 : undefined,
 })

 // 5. Lossless source chain (SOFT via BEXT coding_history)
 const history = (codingHistoryRaw || '').toUpperCase()
 const hasLossy = /\bMP3\b|\bAAC\b|\bOGG\b|\bVORBIS\b|\bOPUS\b/.test(history)
 const hasPcm = /\bPCM\b|\bWAV\b|\bFLAC\b|\bALAC\b/.test(history)
 const sourceChainPass = history.length > 0 && !hasLossy
 const sourceChainValue = !history
 ? 'unknown'
 : hasLossy
 ? 'lossy stage found'
 : hasPcm
 ? 'PCM verified'
 : 'no lossy flag found'
 checks.push({
 key: 'source_chain',
 label: 'Lossless source chain',
 pass: sourceChainPass,
 value: sourceChainValue,
 detail: hasLossy
 ? 'BEXT coding_history contains a lossy codec reference. Apple Digital Masters requires a lossless source chain — audit the mix → master → delivery path for an MP3/AAC intermediate.'
 : !history
 ? 'BEXT coding_history is empty. ADM permits this but the certification cannot auto-verify a lossless chain.'
 : undefined,
 })

 // Aggregate
 const hardKeys = new Set(['bit_depth', 'sample_rate', 'true_peak'])
 const hardFail = checks.some(c => hardKeys.has(c.key) && !c.pass)
 const softFail = checks.some(c => !c.pass && !hardKeys.has(c.key))
 const status: AdmReadiness['status'] = hardFail
 ? 'fail'
 : softFail
 ? 'warn'
 : 'ready'

 const action = status === 'ready'
 ? 'Apple Digital Masters ready'
 : status === 'warn'
 ? 'ADM ready — source chain unverifiable'
 : `ADM hold — ${checks.filter(c => !c.pass && hardKeys.has(c.key)).map(c => c.label.toLowerCase()).join(', ')}`

 return { status, checks, action }
}
