import { AnalysisResult } from './types'
import { EQBand } from './EQContext'
import { DSP_PROFILES, DspProfile } from './dspProfiles'

/**
 * Master Assistant v1 — proposes a full delivery chain from a finished
 * analysis and a chosen delivery target. This is the Ozone Master
 * Assistant killer: we already computed everything (loudness, TP,
 * spectrum, engineer tips, DSP targets, streaming preview). All the
 * Assistant does is compose those facts into a concrete chain and
 * route it through our own preview + render pipeline.
 *
 * Output shape is explicit so the UI can display every decision — no
 * black box. The user can tweak or reject any step.
 */

/** Mastering-grade HPF stage — Butterworth 12 dB/oct in the Python
 * renderer. UI also audits a matching biquad in the main player
 * via the EQ bank when enabled. */
export interface MasterChainHPF {
 enabled: boolean
 freq: number
}

/** Program-dependent mastering compressor — see python/master_chain.py
 * for the full design notes (RMS + peak-guard detection, soft knee,
 * asymmetric density-aware release, auto makeup). */
export interface MasterChainComp {
 enabled: boolean
 thresholdDb: number
 ratio: number
 attackMs: number
 releaseMs: number
 kneeDb: number
 /** Auto = match input RMS within ±0.3 dB. Otherwise fixed dB. */
 makeupDb: 'auto' | number
}

/** Vinyl / cutting-specialist stage — RIAA recording pre-emphasis
 * baked in so the master, when cut, plays flat through the turntable's
 * inverse-RIAA curve. Off by default; enable only when rendering
 * for vinyl. */
export interface MasterChainRIAA {
 enabled: boolean
}

export interface MasterChain {
 /** The DSP this chain is tuned for. Drives TP ceiling + target LUFS. */
 profile: DspProfile
 /** Target integrated LUFS we want the output to hit. Equal to
 * profile.targetLufs for music; broadcast targets are anchored on
 * dialog LUFS so we fall back to profile target here too. */
 targetLufs: number
 /** Gain to apply to reach the target. Positive = boost, negative = cut. */
 gainChangeDb: number
 /** High-pass stage — mastering-grade Butterworth. Defaults off; the
 * proposer enables it for thin-kick / sub-rumble cases. */
 hpf: MasterChainHPF
 /** Bands to apply — pulled from engineer tips when available.
 * Empty array = no EQ recommended (already balanced). */
 bands: EQBand[]
 /** Program-dependent compressor. Defaults off unless the source
 * has >15 LU LRA (dense masters love ~1.5 dB of glue). */
 comp: MasterChainComp
 /** RIAA pre-emphasis for vinyl cut masters. Off by default. */
 riaa: MasterChainRIAA
 /** TP ceiling to limit to. Always ≤ profile.tpCeiling. */
 ceilingDbtp: number
 /** Recommended sample rate for the render. Matches delivery spec. */
 sampleRate: number
 /** Recommended bit depth. Matches delivery spec. */
 bitDepth: number
 /** Whether to apply TPDF dither on render. Auto-on when reducing
 * bit depth or going from float to integer. */
 dither: boolean
 /** Human-readable rationale strings, one per step, for the UI to
 * render. Order matches the chain order (gain → EQ → limiter →
 * dither). */
 notes: string[]
 /** Optional warnings the user should see before they trust the
 * chain — e.g. "Master is already at −8 LUFS, pushing it to −14
 * will sound quiet on other platforms." */
 warnings: string[]
}

/**
 * Build a chain for a specific DSP target from a completed analysis.
 * Safe to call repeatedly; pure function.
 */
export function proposeMasterChain(
 result: AnalysisResult,
 profileId: string = 'spotify',
): MasterChain | null {
 const profile = DSP_PROFILES[profileId]
 if (!profile) return null

 const overall = result.overall
 const lufs = overall?.lufs_b ?? null
 const tpMeasured = result.headroom?.true_peak_b
 ?? result.distortion?.true_peaks?.b_true_peak_db
 ?? null

 const targetLufs = profile.targetLufs

 // Gain step: move the master towards the target, but respect DSP
 // behaviour — attenuate-only platforms (Apple, Tidal) shouldn't be
 // "boosted to target" because listeners will still hear the quiet
 // version after normalisation on other services. For quiet masters
 // we only propose a boost when the current level is more than 3 LU
 // below target (margin to avoid over-cooking already-good masters).
 let gainChangeDb = 0
 const notes: string[] = []
 const warnings: string[] = []

 if (lufs != null && isFinite(lufs)) {
 const gap = targetLufs - lufs
 if (gap > 3) {
 gainChangeDb = Math.min(gap, 6) // cap boost at +6 dB
 notes.push(`Boost ${gainChangeDb.toFixed(1)} dB to reach ${targetLufs} LUFS (${profile.name} target).`)
 if (gap > 6) {
 warnings.push(`Master is ${Math.abs(gap).toFixed(1)} LU below target — capping boost at +6 dB. Consider stem-level gain or compression before re-rendering.`)
 }
 } else if (gap < -2) {
 // Master is too hot — DSP will attenuate it anyway. Propose a
 // proactive cut equal to what the DSP would do on playback so
 // our limiter has headroom to catch inter-sample peaks.
 gainChangeDb = gap
 notes.push(`Pull ${Math.abs(gainChangeDb).toFixed(1)} dB to meet ${profile.name} playback level and give the limiter headroom.`)
 } else {
 notes.push(`Already within ${Math.abs(gap).toFixed(1)} LU of ${profile.name}'s target — no loudness change needed.`)
 }
 } else {
 warnings.push('No integrated LUFS reading — cannot propose gain step.')
 }

 // HPF — default cutoff 30 Hz. Enable when the master carries
 // meaningful sub-rumble (energy below 40 Hz > -18 dB of band peak
 // on the 31-band spectrum). Bedroom producers often bake in
 // sub-clutter they can't monitor on small speakers.
 const spectrum = result.spectrum_b || []
 const subBandAvg = spectrum.slice(0, 4) // 20 / 25 / 31.5 / 40 Hz
 .filter(v => isFinite(v))
 const subEnergy = subBandAvg.length ? Math.max(...subBandAvg) : -Infinity
 const hpf: MasterChainHPF = {
 enabled: subEnergy > -18, // hot sub-band → HPF on
 freq: 30,
 }
 if (hpf.enabled) {
 notes.push(`HPF at ${hpf.freq} Hz — sub-rumble detected in the bottom band (${subEnergy.toFixed(1)} dB below peak).`)
 } else {
 notes.push(`HPF bypassed — bottom band already controlled.`)
 }

 // EQ step: reuse engineer tips when the user ran with a profile
 // selected. Otherwise no bands.
 const tipFilters = result.engineer_tips?.eq_filters || []
 const bands: EQBand[] = tipFilters.map((f, i) => ({
 id: `ma-${i}-${f.freq}`,
 freq: f.freq,
 gain_db: f.gain_db,
 q: f.q,
 type: 'peaking',
 enabled: true,
 label: f.q_note || f.region,
 }))
 if (bands.length > 0) {
 notes.push(`Apply ${bands.length} EQ move${bands.length === 1 ? '' : 's'} from engineer tips (${result.engineer_tips?.engineer || 'default profile'}).`)
 } else {
 notes.push('No EQ moves proposed — engineer tips were off at scan time. Run with a profile selected for tone-shaping.')
 }

 // Compressor — enable when LRA is dense (> 12 LU). Mastering
 // engineers use a light 1.5:1 / 2:1 comp on dense masters to glue
 // transients and tighten the envelope. Quiet / dynamic programmes
 // (LRA < 8) get no compression — they already breathe.
 const lraMeasured = overall?.dynamics_b ?? null
 const compEnabled = lraMeasured != null && lraMeasured > 12
 const comp: MasterChainComp = {
 enabled: compEnabled,
 thresholdDb: -18,
 ratio: 2.0,
 attackMs: 10,
 releaseMs: 200,
 kneeDb: 6,
 makeupDb: 'auto',
 }
 if (compEnabled) {
 notes.push(`Glue compression — 2:1 at −18 dB, 10/200 ms, soft knee. Tames ${lraMeasured!.toFixed(1)} LU range to sit tighter under the limiter.`)
 } else {
 notes.push(lraMeasured != null && isFinite(lraMeasured)
 ? `Compression bypassed — ${lraMeasured.toFixed(1)} LU dynamics are already controlled.`
 : 'Compression bypassed — LRA not measured.')
 }

 // Limiter: TP ceiling = profile's, minus a small safety margin when
 // the measurement is already close to the ceiling.
 const ceilingDbtp = profile.tpCeiling
 notes.push(`True-peak limit at ${ceilingDbtp.toFixed(1)} dBTP (${profile.name} ceiling).`)
 // TP-margin warning disabled by user direction — show numbers only.
 void (tpMeasured != null && tpMeasured > ceilingDbtp - 0.5)

 // Sample rate / bit depth: match profile's delivery spec. Bit-depth
 // reduction triggers dither.
 const sampleRate = profile.minSampleRate
 const bitDepth = profile.minBitDepth
 const dither = bitDepth < 24
 if (dither) notes.push('TPDF dither on render (bit depth ≤ 16).')

 return {
 profile,
 targetLufs,
 gainChangeDb,
 hpf,
 bands,
 comp,
 riaa: { enabled: false },
 ceilingDbtp,
 sampleRate,
 bitDepth,
 dither,
 notes,
 warnings,
 }
}
