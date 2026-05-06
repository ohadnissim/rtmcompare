import { EQBand } from './EQContext'
import { THIRD_OCTAVE_HZ as THIRD_OCTAVE_SHARED, levelAlign } from './lib/spectrumLevel'

/**
 * Reference Match EQ — compute parametric bands that transform the
 * current track's spectrum into the reference's spectrum.
 *
 * Design in one sentence: we diff two perceptually-centred 31-band
 * 1/3-octave curves, find the biggest tonal departures, and emit 4-8
 * parametric moves that collectively close the gap.
 *
 * This is the Ozone Master-Match killer. Reference 4 shows the diff
 * but doesn't propose EQ moves; Ozone proposes moves but burns them
 * into a plugin chain. Ours auditions live through the main A/B
 * player's biquad bank — zero plugin, zero bounce.
 */

// Re-export the band centres from the shared lib so the rest of this
// module keeps its old name but only one source of truth exists.
const THIRD_OCTAVE_HZ = THIRD_OCTAVE_SHARED

/**
 * Result of a match proposal. `bands` is ready to drop into EQContext;
 * `curves` + `matchScore` powers UI visualisation (before/after plot +
 * "how close are we").
 */
export interface MatchProposal {
 bands: EQBand[]
 /** Source curve after normalisation, for display. */
 sourceCurve: number[]
 /** Reference curve after normalisation, for display. */
 referenceCurve: number[]
 /** Predicted curve after applying the proposed bands, for display. */
 predictedCurve: number[]
 /** 0-100 "match score" — 100 = identical after EQ, 0 = far apart.
 * Uses RMS dB deviation over the predicted curve vs reference. */
 matchScore: number
 /** Pre-EQ RMS deviation (dB) so UI can show "gap closed by X dB". */
 rmsBefore: number
 rmsAfter: number
}

/**
 * Find contiguous runs of bands with the same sign (boost vs cut) and
 * magnitude above a threshold. Each run collapses into one parametric
 * move. This prevents emitting 31 tiny bands — we want 4-8 meaningful
 * ones the user can actually reason about.
 */
interface Cluster {
 startIdx: number
 endIdx: number
 /** Average dB deviation (source − reference) across the run. We'll
 * flip sign to get the corrective move. */
 avgDb: number
 /** Index of the strongest band in the cluster — we anchor the
 * parametric move at that frequency. */
 peakIdx: number
}

function clusterDiff(diff: number[], minMagnitude: number): Cluster[] {
 const clusters: Cluster[] = []
 let i = 0
 while (i < diff.length) {
 const sign = Math.sign(diff[i])
 if (sign === 0 || Math.abs(diff[i]) < minMagnitude * 0.5) {
 i++
 continue
 }
 let j = i
 let sum = 0
 let count = 0
 let peakIdx = i
 let peakMag = 0
 while (j < diff.length && Math.sign(diff[j]) === sign && Math.abs(diff[j]) >= minMagnitude * 0.3) {
 sum += diff[j]
 count++
 if (Math.abs(diff[j]) > peakMag) { peakMag = Math.abs(diff[j]); peakIdx = j }
 j++
 }
 if (count > 0 && Math.abs(sum / count) >= minMagnitude) {
 clusters.push({
 startIdx: i,
 endIdx: j - 1,
 avgDb: sum / count,
 peakIdx,
 })
 }
 i = Math.max(j, i + 1)
 }
 // Keep the strongest 6 clusters — anything beyond that is diminishing
 // returns and clutters the UI.
 clusters.sort((a, b) => Math.abs(b.avgDb) - Math.abs(a.avgDb))
 return clusters.slice(0, 6)
}

/**
 * Compute a Q value that fits the cluster span. Wider clusters → lower Q.
 */
function qFromSpan(startIdx: number, endIdx: number): number {
 const spanBands = Math.max(1, endIdx - startIdx + 1)
 // Each band is 1/3 octave; so 3 bands span 1 octave. A "wide" cluster
 // (4+ bands, >1.3 octaves) gets Q ≈ 0.7; a single-band spike gets Q ≈
 // 3. Linear interpolation between those anchors.
 const octaves = spanBands / 3
 if (octaves <= 0.5) return 3.0
 if (octaves >= 2) return 0.6
 return 3.0 - ((octaves - 0.5) / 1.5) * 2.4
}

/**
 * Apply a predicted-gain curve to the source using each band's bell-
 * curve contribution per 1/3-octave bin. Used to preview "what the
 * EQ will produce" before the user commits — same math the UI runs
 * for its corrected-curve overlay, colocated here so the two stay in
 * sync.
 */
function applyBands(source: number[], bands: EQBand[]): number[] {
 const out = source.slice()
 for (const b of bands) {
 for (let i = 0; i < out.length; i++) {
 const f = THIRD_OCTAVE_HZ[i]
 const octaves = Math.abs(Math.log2(f / b.freq))
 // Parametric bell-curve influence — peaks at the centre, falls
 // off with distance in octaves scaled by Q.
 const influence = Math.max(0, 1 - (octaves * b.q) / 1.5)
 out[i] += b.gain_db * influence
 }
 }
 return out
}

function rmsDeviation(a: number[], b: number[]): number {
 const n = Math.min(a.length, b.length)
 if (n === 0) return 0
 let sum = 0
 for (let i = 0; i < n; i++) {
 const d = a[i] - b[i]
 sum += d * d
 }
 return Math.sqrt(sum / n)
}

export function proposeMatchFromSpectra(
 sourceSpectrum: number[] | null | undefined,
 referenceSpectrum: number[] | null | undefined,
 opts?: { minMagnitude?: number; maxGain?: number },
): MatchProposal | null {
 if (!sourceSpectrum?.length || !referenceSpectrum?.length) return null
 const n = Math.min(sourceSpectrum.length, referenceSpectrum.length, THIRD_OCTAVE_HZ.length)
 // Align each curve to its own A-weighted perceptual centre — a single
 // spiky band no longer sets the pivot, so the proposed EQ bands
 // reflect genuine tonal character differences rather than an
 // accidental peak elsewhere in the spectrum.
 const src = levelAlign(sourceSpectrum.slice(0, n))
 const ref = levelAlign(referenceSpectrum.slice(0, n))

 // Smooth each curve slightly before diffing so band-to-band jitter
 // (windowing noise in the FFT) doesn't emit a band per bin. 3-point
 // triangular window: 0.25 · prev + 0.5 · curr + 0.25 · next.
 const smooth = (arr: number[]) => arr.map((v, i) => {
 const p = i > 0 ? arr[i - 1] : v
 const nx = i < arr.length - 1 ? arr[i + 1] : v
 return 0.25 * p + 0.5 * v + 0.25 * nx
 })
 const srcS = smooth(src)
 const refS = smooth(ref)

 // diff[i] = how much louder the *source* is than the reference in band i.
 // Positive → cut in source, negative → boost in source.
 const diff = srcS.map((v, i) => v - refS[i])
 const minMag = opts?.minMagnitude ?? 1.5
 // 5.3.1 cap alignment: pre-5.3 this defaulted to ±6 dB, but the
 // engineer-profile match path uses ±4 dB broadband / ±3 dB sub
 // (python/engineer_profile.py:499-500). Two paths quoting different
 // maxima for "match this curve" was a correctness regression waiting
 // to happen. Default to the same broadband cap; sub-80 Hz bands get
 // a tighter cap below at apply time.
 const maxGain = opts?.maxGain ?? 4.0
 const maxGainSub = 3.0  // <80 Hz cap, mirrors engineer_profile.py
 const clusters = clusterDiff(diff, minMag)

 const bands: EQBand[] = clusters.map((c, ci) => {
 const freq = THIRD_OCTAVE_HZ[c.peakIdx]
 // Cap corrective gain at maxGain (or the sub cap below 80 Hz). The
 // tighter sub cap acknowledges that low-end energy moves are
 // perceptually amplified by room modes and small-speaker rolloff;
 // ±3 dB is enough to reshape the bottom without "more is more."
 const cap = freq < 80 ? maxGainSub : maxGain
 const correction = Math.max(-cap, Math.min(cap, -c.avgDb))
 const q = qFromSpan(c.startIdx, c.endIdx)
 return {
 id: `match-${ci}-${freq}`,
 freq,
 gain_db: Math.round(correction * 10) / 10,
 q: Math.round(q * 10) / 10,
 type: 'peaking',
 enabled: true,
 label: correction > 0 ? `boost ${freq} Hz` : `cut ${freq} Hz`,
 }
 })

 // Predicted curve after bands applied — for UI + match-score.
 const predicted = applyBands(src, bands)
 const rmsBefore = rmsDeviation(src, ref)
 const rmsAfter = rmsDeviation(predicted, ref)
 // Score: map rmsAfter into 0-100. 0 dB RMS → 100, 6+ dB → 0.
 const matchScore = Math.max(0, Math.min(100, Math.round(100 * (1 - Math.min(6, rmsAfter) / 6))))

 return {
 bands,
 sourceCurve: src,
 referenceCurve: ref,
 predictedCurve: predicted,
 matchScore,
 rmsBefore: Math.round(rmsBefore * 100) / 100,
 rmsAfter: Math.round(rmsAfter * 100) / 100,
 }
}

export const REFERENCE_MATCH_FREQS = THIRD_OCTAVE_HZ
