/**
 * DSP spec profiles.
 *
 * Every streaming DSP publishes its own delivery spec (target LUFS, TP
 * ceiling, AAC encode, per-track metadata rules). RTM's verdict layer
 * (buildVerdict) is generic — these profiles overlay the specifics so
 * Triage Mode / DMR can say "this would fail Apple but pass Spotify."
 *
 * The shape is intentionally small: just the numeric thresholds that
 * move between platforms. Everything structural (format = WAV, SR ≥
 * 44.1, BD ≥ 16) is in `buildVerdict` directly.
 *
 * Sources and target caveats live in src/specs.ts, generated from
 * python/specs.py. Keep this file as a consumer so the renderer and
 * analyser stamp the same spec fingerprint.
 */

import { SPECS, type SpecId } from './specs'

export interface DspProfile {
 id: 'apple' | 'spotify' | 'spotifyLoud' | 'amazon' | 'tidal' | 'deezer' | 'soundcloud' | 'youtube' | 'ebur128' | 'atsc-a85' | 'netflix' | 'tiktok' | 'youtubeShorts' | 'instagramReels'
 name: string
 /** High-level category so the UI can group profiles by use-case.
 * `social` is the short-form video cluster (TikTok, YouTube Shorts,
 * Instagram Reels) — panel feedback asked for these to cluster
 * together instead of polluting the main streaming row. */
 kind?: 'streaming' | 'broadcast' | 'social'
 /** Integrated LUFS the platform normalises playback to. */
 targetLufs: number
 /** True-peak ceiling at ingest — over this flags a block. */
 tpCeiling: number
 /** Minimum sample rate for a delivered file (Hz). */
 minSampleRate: number
 /** Minimum bit depth for a delivered file. */
 minBitDepth: number
 /** Advisory: how much headroom the platform's limiter leaves above
 * the TP ceiling before visibly attenuating. Used in warnings. */
 advisoryTpMargin: number
 /** Does the platform strictly require ISRC metadata on the recording
 * (vs. allowing it to be supplied via DDEX only)? */
 requireEmbeddedIsrc: boolean
 /** Max loudness range in LU. EBU R128 specifies ≤ 20 LU; Netflix
 * film delivery expects ≤ 15 LU. Streaming-music platforms don't
 * publish hard LRA ceilings, but > 15 LU usually means the master
 * will feel uneven under loudness normalisation — we warn, not block. */
 lraMax?: number
 /** Advisory max for short-term LUFS (LUFS-S). Platforms don't
 * publish this directly, but a short-term peak that sits > 6 LU
 * above integrated will trigger the post-normalisation soft-
 * limiter on loud choruses / drops. Leave undefined to skip. */
 stMaxAboveIntegrated?: number
 /** Freeform "why this value" string — shown in UI tooltips. */
 note: string
}

const DEFAULT_STREAMING_SR = 44100
const DEFAULT_STREAMING_BD = 16
const DEFAULT_BROADCAST_SR = 48000
const DEFAULT_BROADCAST_BD = 16

function targetNumber(specId: SpecId, key: string): number {
 const targets = SPECS[specId].targets as Record<string, unknown>
 const value = targets[key]
 if (typeof value !== 'number') {
 throw new Error(`Spec ${specId} is missing numeric target ${key}`)
 }
 return value
}

function optionalTargetNumber(specId: SpecId, key: string): number | undefined {
 const targets = SPECS[specId].targets as Record<string, unknown>
 const value = targets[key]
 return typeof value === 'number' ? value : undefined
}

function targetNumberOr(specId: SpecId, key: string, fallback: number): number {
 return optionalTargetNumber(specId, key) ?? fallback
}

function specLabel(specId: SpecId): string {
 const spec = SPECS[specId]
 return `${spec.name} ${spec.version}`
}

function lufsText(specId: SpecId): string {
 return `${targetNumber(specId, 'lufs_i')} LUFS`
}

function tpText(specId: SpecId): string {
 return `${targetNumber(specId, 'tp_dbtp').toFixed(1)} dBTP`
}

export const DSP_PROFILES: Record<string, DspProfile> = {
 apple: {
 id: 'apple',
 name: 'Apple Music',
 targetLufs: targetNumber('apple_music', 'lufs_i'),
 tpCeiling: targetNumber('apple_music', 'tp_dbtp'),
 minSampleRate: targetNumber('apple_digital_masters', 'sr_min'),
 minBitDepth: targetNumber('apple_digital_masters', 'bd_min'),
 advisoryTpMargin: 0.5,
 requireEmbeddedIsrc: true,
 note: `${specLabel('apple_music')} plus ${specLabel('apple_digital_masters')} — Sound Check playback target ${lufsText('apple_music')}, ${tpText('apple_music')} ceiling, 24-bit >= 44.1 kHz for ADM.`,
 },
 spotify: {
 id: 'spotify',
 name: 'Spotify',
 targetLufs: targetNumber('spotify', 'lufs_i'),
 tpCeiling: targetNumber('spotify', 'tp_dbtp'),
 minSampleRate: DEFAULT_STREAMING_SR,
 minBitDepth: DEFAULT_STREAMING_BD,
 advisoryTpMargin: 0.5,
 requireEmbeddedIsrc: false,
 note: `${specLabel('spotify')} — target ${lufsText('spotify')}, ${tpText('spotify')} ceiling; louder masters should stay below ${optionalTargetNumber('spotify', 'loud_master_tp_dbtp')?.toFixed(1)} dBTP.`,
 },
 spotifyLoud: {
 id: 'spotifyLoud',
 name: 'Spotify Loud',
 targetLufs: targetNumber('spotify_loud', 'lufs_i'),
 tpCeiling: targetNumber('spotify_loud', 'tp_dbtp'),
 minSampleRate: DEFAULT_STREAMING_SR,
 minBitDepth: DEFAULT_STREAMING_BD,
 advisoryTpMargin: 0.5,
 requireEmbeddedIsrc: false,
 note: `${specLabel('spotify_loud')} — target ${lufsText('spotify_loud')}; RTM applies ${tpText('spotify_loud')} as the documented loud-master safety ceiling.`,
 },
 amazon: {
 id: 'amazon',
 name: 'Amazon Music',
 targetLufs: targetNumber('amazon_music', 'lufs_i'),
 tpCeiling: targetNumber('amazon_music', 'tp_dbtp'),
 minSampleRate: DEFAULT_STREAMING_SR,
 minBitDepth: DEFAULT_STREAMING_BD,
 advisoryTpMargin: 0.5,
 requireEmbeddedIsrc: false,
 note: `${specLabel('amazon_music')} — target ${lufsText('amazon_music')}, stricter ${tpText('amazon_music')} ceiling.`,
 },
 tidal: {
 id: 'tidal',
 name: 'Tidal',
 targetLufs: targetNumber('tidal', 'lufs_i'),
 tpCeiling: targetNumber('tidal', 'tp_dbtp'),
 minSampleRate: DEFAULT_STREAMING_SR,
 minBitDepth: DEFAULT_STREAMING_BD,
 advisoryTpMargin: 0.5,
 requireEmbeddedIsrc: false,
 note: `${specLabel('tidal')} — target ${lufsText('tidal')}, ${tpText('tidal')} ceiling.`,
 },
 deezer: {
 id: 'deezer',
 name: 'Deezer',
 targetLufs: targetNumber('deezer', 'lufs_i'),
 tpCeiling: targetNumber('deezer', 'tp_dbtp'),
 minSampleRate: DEFAULT_STREAMING_SR,
 minBitDepth: DEFAULT_STREAMING_BD,
 advisoryTpMargin: 0.5,
 requireEmbeddedIsrc: false,
 note: `${specLabel('deezer')} — target ${lufsText('deezer')}, ${tpText('deezer')} ceiling. Slightly quieter default than Spotify/Tidal.`,
 },
 soundcloud: {
 id: 'soundcloud',
 name: 'SoundCloud',
 targetLufs: targetNumber('soundcloud', 'lufs_i'),
 tpCeiling: targetNumber('soundcloud', 'tp_dbtp'),
 minSampleRate: DEFAULT_STREAMING_SR,
 minBitDepth: DEFAULT_STREAMING_BD,
 advisoryTpMargin: 0.5,
 requireEmbeddedIsrc: false,
 note: `${specLabel('soundcloud')} — target ${lufsText('soundcloud')}, ${tpText('soundcloud')}; louder masters should stay below ${optionalTargetNumber('soundcloud', 'loud_master_tp_dbtp')?.toFixed(1)} dBTP.`,
 },
 ebur128: {
 id: 'ebur128',
 name: 'EBU R128 (broadcast)',
 kind: 'broadcast',
 targetLufs: targetNumber('ebu_r128', 'lufs_i'),
 tpCeiling: targetNumber('ebu_r128', 'tp_dbtp'),
 minSampleRate: DEFAULT_BROADCAST_SR,
 minBitDepth: DEFAULT_BROADCAST_BD,
 advisoryTpMargin: 1.0,
 requireEmbeddedIsrc: false,
 lraMax: targetNumber('ebu_r128', 'lra_max'),
 note: `${specLabel('ebu_r128')} — integrated ${lufsText('ebu_r128')}, LRA guardrail <= ${targetNumber('ebu_r128', 'lra_max')} LU, TP <= ${tpText('ebu_r128')}.`,
 },
 'atsc-a85': {
 id: 'atsc-a85',
 name: 'ATSC A/85 · CALM Act',
 kind: 'broadcast',
 targetLufs: targetNumber('atsc_a85', 'lufs_i'),
 tpCeiling: targetNumber('atsc_a85', 'tp_dbtp'),
 minSampleRate: DEFAULT_BROADCAST_SR,
 minBitDepth: DEFAULT_BROADCAST_BD,
 advisoryTpMargin: 1.0,
 requireEmbeddedIsrc: false,
 lraMax: 20,
 note: `${specLabel('atsc_a85')} — target ${lufsText('atsc_a85')} / LKFS, stricter ${tpText('atsc_a85')} ceiling, +/-${targetNumber('atsc_a85', 'tolerance_lu')} LU tolerance.`,
 },
 netflix: {
 id: 'netflix',
 name: 'Netflix',
 kind: 'broadcast',
 targetLufs: targetNumber('netflix', 'lufs_i'),
 tpCeiling: targetNumber('netflix', 'tp_dbtp'),
 minSampleRate: targetNumberOr('netflix', 'sr_min', DEFAULT_BROADCAST_SR),
 minBitDepth: targetNumberOr('netflix', 'bd_min', 24),
 advisoryTpMargin: 1.0,
 requireEmbeddedIsrc: false,
 lraMax: targetNumber('netflix', 'lra_max'),
 note: `${specLabel('netflix')} — dialog-anchored ${lufsText('netflix')} LKFS, LRA <= ${targetNumber('netflix', 'lra_max')} LU, TP <= ${tpText('netflix')}, 24-bit 48 kHz.`,
 },
 youtube: {
 id: 'youtube',
 name: 'YouTube',
 kind: 'streaming',
 targetLufs: targetNumber('youtube', 'lufs_i'),
 tpCeiling: targetNumber('youtube', 'tp_dbtp'),
 minSampleRate: DEFAULT_STREAMING_SR,
 minBitDepth: DEFAULT_STREAMING_BD,
 advisoryTpMargin: 0.5,
 requireEmbeddedIsrc: false,
 note: `${specLabel('youtube')} — target ${lufsText('youtube')}, ${tpText('youtube')} ceiling.`,
 },
 tiktok: {
 id: 'tiktok',
 name: 'TikTok',
 kind: 'social',
 targetLufs: targetNumber('tiktok', 'lufs_i'),
 tpCeiling: targetNumber('tiktok', 'tp_dbtp'),
 minSampleRate: DEFAULT_STREAMING_SR,
 minBitDepth: DEFAULT_STREAMING_BD,
 advisoryTpMargin: 0.5,
 requireEmbeddedIsrc: false,
 note: `${specLabel('tiktok')} — provisional measured target ${lufsText('tiktok')} / ${tpText('tiktok')}; verify against current app behaviour before contractual delivery.`,
 },
 youtubeShorts: {
 id: 'youtubeShorts',
 name: 'YouTube Shorts',
 kind: 'social',
 targetLufs: targetNumber('youtube_shorts', 'lufs_i'),
 tpCeiling: targetNumber('youtube_shorts', 'tp_dbtp'),
 minSampleRate: DEFAULT_STREAMING_SR,
 minBitDepth: DEFAULT_STREAMING_BD,
 advisoryTpMargin: 0.5,
 requireEmbeddedIsrc: false,
 note: `${specLabel('youtube_shorts')} — provisional measured target ${lufsText('youtube_shorts')} / ${tpText('youtube_shorts')}; clips get re-encoded more aggressively than long-form YouTube.`,
 },
 instagramReels: {
 id: 'instagramReels',
 name: 'Instagram / Reels',
 kind: 'social',
 targetLufs: targetNumber('instagram_reels', 'lufs_i'),
 tpCeiling: targetNumber('instagram_reels', 'tp_dbtp'),
 minSampleRate: DEFAULT_STREAMING_SR,
 minBitDepth: DEFAULT_STREAMING_BD,
 advisoryTpMargin: 0.5,
 requireEmbeddedIsrc: false,
 note: `${specLabel('instagram_reels')} — provisional measured target ${lufsText('instagram_reels')} / ${tpText('instagram_reels')}; mono folding is common on small phones.`,
 },
}

export const DSP_PROFILE_IDS = Object.keys(DSP_PROFILES) as Array<keyof typeof DSP_PROFILES>

/** The most permissive streaming TP ceiling across all streaming
 * profiles — handy as a single floor when code needs one generic
 * "safe for streaming" threshold. Currently -1.0 dBTP (Spotify /
 * Tidal / Apple / YouTube / Deezer / SoundCloud). When a stricter
 * profile lands we pick it up automatically. */
export function streamingTpFloorDbtp(): number {
 const ceilings = Object.values(DSP_PROFILES)
 .filter(p => p.kind === 'streaming' || p.kind === undefined)
 .map(p => p.tpCeiling)
 return ceilings.length ? Math.max(...ceilings) : -1.0
}

/**
 * Filter the full profile list by user surface. Used throughout the
 * UI so a hobbyist shipping to Spotify never sees Netflix or EBU R128.
 *
 * streaming — hide broadcast profiles (R128 / A85 / Netflix)
 * full — show everything (pro default)
 * broadcast — promote broadcast; still show streaming below
 * post — broadcast + streaming; hide social
 *
 * Always preserves the order declared in DSP_PROFILES so curated
 * layout is honoured.
 */
export function profilesForSurface(surface: 'streaming' | 'full' | 'broadcast' | 'post' | 'netflix'): DspProfile[] {
 const all = Object.values(DSP_PROFILES)
 if (surface === 'full') return all
 if (surface === 'streaming') {
 // Music + social only; hide broadcast.
 return all.filter(p => p.kind !== 'broadcast')
 }
 if (surface === 'broadcast') {
 // Broadcast first, then streaming music; no social. Netflix still
 // visible in this list because it IS a broadcast profile — the new
 // `netflix` surface just promotes it to the single-platform default.
 const broadcast = all.filter(p => p.kind === 'broadcast')
 const streaming = all.filter(p => p.kind === 'streaming')
 return [...broadcast, ...streaming]
 }
 if (surface === 'netflix') {
 // Netflix-only surface.
 // Netflix has its own anchor, ceiling, and dialog-gate behaviour; it
 // deserves a single-platform delivery surface. We still expose the
 // other broadcast profiles below so the engineer can A/B against
 // ATSC A/85 or EBU R128 if the same master goes to multiple outlets.
 const netflix = all.filter(p => p.id === 'netflix')
 const otherBroadcast = all.filter(p => p.kind === 'broadcast' && p.id !== 'netflix')
 return [...netflix, ...otherBroadcast]
 }
 // post: broadcast + music; social off.
 const broadcast = all.filter(p => p.kind === 'broadcast')
 const streaming = all.filter(p => p.kind === 'streaming')
 return [...broadcast, ...streaming]
}

/**
 * Evaluate a set of single-file metrics against a DSP profile. Returns
 * per-rule findings with severity. Triage Mode hoists these into the
 * Attention list when the user has a profile selected.
 */
export interface ProfileFinding {
 severity: 'ok' | 'warn' | 'block'
 field: 'lufs' | 'tp' | 'sr' | 'bd' | 'isrc' | 'lra' | 'st' | 'dialog'
 message: string
}
export function evaluateAgainstProfile(
 m: {
 lufs: number | null
 true_peak: number | null
 sample_rate: number | null
 bit_depth: number | null
 isrc?: string | null
 /** Loudness range (LU). When present we'll flag over-spec LRA. */
 lra?: number | null
 /** Max short-term LUFS over the whole programme (LUFS-S). When
 * present we'll flag if it sits too far above integrated. */
 short_term_max?: number | null
 /** Dialog-gated integrated LUFS (speech only). Netflix measures
 * its −27 LKFS target against this, not the full-programme
 * integrated — a music-heavy mix can be −27 overall and still
 * fail QC because the dialog sits at −20. */
 dialog_lufs?: number | null
 },
 profile: DspProfile,
): ProfileFinding[] {
 const out: ProfileFinding[] = []
 if (m.true_peak != null) {
 if (m.true_peak > profile.tpCeiling) {
 out.push({
 severity: 'block', field: 'tp',
 message: `TP ${m.true_peak.toFixed(1)} dBTP over ${profile.name}'s ${profile.tpCeiling.toFixed(1)} dBTP ceiling — limiter will engage on ingest.`,
 })
 } else if (m.true_peak > profile.tpCeiling - profile.advisoryTpMargin) {
 out.push({
 severity: 'warn', field: 'tp',
 message: `TP ${m.true_peak.toFixed(1)} dBTP within ${profile.advisoryTpMargin.toFixed(1)} dB of ${profile.name}'s ceiling — leave more margin before ingest.`,
 })
 }
 }
 if (m.sample_rate != null && m.sample_rate < profile.minSampleRate) {
 out.push({
 severity: 'block', field: 'sr',
 message: `Sample rate ${m.sample_rate} Hz — ${profile.name} requires ≥ ${profile.minSampleRate} Hz.`,
 })
 }
 if (m.bit_depth != null && m.bit_depth < profile.minBitDepth) {
 out.push({
 severity: 'block', field: 'bd',
 message: `Bit depth ${m.bit_depth} — ${profile.name} requires ≥ ${profile.minBitDepth}-bit.`,
 })
 }
 if (profile.requireEmbeddedIsrc && !m.isrc) {
 out.push({
 severity: 'block', field: 'isrc',
 message: `${profile.name} requires an ISRC embedded in the file — none found.`,
 })
 }
 // LRA gate — only when the profile has a published ceiling.
 if (profile.lraMax != null && m.lra != null) {
 if (m.lra > profile.lraMax) {
 out.push({
 severity: profile.kind === 'broadcast' ? 'block' : 'warn',
 field: 'lra',
 message: `Loudness range ${m.lra.toFixed(1)} LU — over ${profile.name}'s ${profile.lraMax} LU ceiling. ${profile.kind === 'broadcast' ? 'Broadcast QC will reject this.' : 'Expect uneven playback under normalisation.'}`,
 })
 } else if (m.lra > profile.lraMax - 2) {
 out.push({
 severity: 'warn', field: 'lra',
 message: `LRA ${m.lra.toFixed(1)} LU — within 2 LU of ${profile.name}'s ${profile.lraMax} LU ceiling. Tighten dynamics if you can.`,
 })
 }
 }
 // Short-term LUFS peak — the hottest 3-second block. 
 if (m.short_term_max != null && m.lufs != null) {
 const gap = m.short_term_max - m.lufs
 const cap = profile.stMaxAboveIntegrated ?? 6
 if (gap > cap) {
 out.push({
 severity: 'warn', field: 'st',
 message: `Short-term peak ${m.short_term_max.toFixed(1)} LUFS — ${gap.toFixed(1)} LU above integrated. ${profile.name}'s soft-limiter will engage on the loudest passage after normalisation.`,
 })
 }
 }
 // Dialog-anchored LUFS — Netflix and ATSC A/85 measure the spec
 // against speech, not the whole programme. When we have a dialog
 // gate we check it against the profile's integrated target.
 if (profile.kind === 'broadcast' && m.dialog_lufs != null) {
 const tol = profile.id === 'netflix' ? 2.0 : 2.0 // Netflix tolerates ±2 LU around −27
 const delta = m.dialog_lufs - profile.targetLufs
 if (Math.abs(delta) > tol) {
 out.push({
 severity: 'block', field: 'dialog',
 message: `Dialog sits at ${m.dialog_lufs.toFixed(1)} LKFS — ${delta > 0 ? '+' : ''}${delta.toFixed(1)} LU vs ${profile.name}'s ${profile.targetLufs}. Re-balance the dialog stem, not the master.`,
 })
 }
 }
 return out
}
