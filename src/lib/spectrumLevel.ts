/**
 * Perceptually-weighted level alignment for 31-band 1/3-octave spectra.
 *
 * Why this exists: the engineer-curve overlay and the Reference-Match
 * EQ proposer both need to compare two tonal curves that sit at
 * different overall loudness levels.  A naive "pin the loudest band
 * to 0 dB" or "pin the 1 kHz bin to 0 dB" anchors the comparison on
 * one possibly-anomalous band — a single spike or a presence notch
 * yanks the entire curve, and the overlay now reads level+shape
 * instead of shape alone.
 *
 * The fix is to centre each curve on its own PERCEPTUAL mean, weighted
 * by A-weighting (IEC 61672-1) so the ear's actual sensitivity drives
 * the "where's the middle" question.  Bands in the 1-4 kHz region
 * (where the ear is most sensitive) get full vote; sub-bass and
 * air-band bands taper to near-zero vote.
 *
 * After `levelAlign`:
 *   - Both curves have A-weighted mean = 0 dB.
 *   - Overlaying them on the same axis reveals tonal CHARACTER, not
 *     overall level.
 *   - A single spike at 20 Hz or 16 kHz barely moves the reference.
 *   - The 1 kHz bin is no longer load-bearing; a vocal de-ess notch
 *     at 1 kHz won't throw the alignment off.
 */

// 31-band 1/3-octave centres (ISO, 20 Hz → 20 kHz).  Order must match
// every other 31-band curve in the app — Python side
// (reference_quickscan.py), dspProfiles, SpectrumOverlay's FREQ_LABELS,
// spectrumMatch.ts.
export const THIRD_OCTAVE_HZ = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
] as const

// A-weighting in dB at each centre (IEC 61672-1:2013, rounded to 1 dp).
// Pre-computed so we don't recompute the rational function every frame.
// Reference: 1 kHz = 0 dB by definition; ear is most sensitive ~2-4 kHz.
const A_WEIGHT_DB = [
  -50.4, -44.8, -39.5, -34.5, -30.3, -26.2, -22.4, -19.1, -16.2, -13.2,
  -10.8,  -8.7,  -6.6,  -4.8,  -3.2,  -1.9,  -0.8,   0.0,   0.6,   1.0,
    1.2,   1.3,   1.2,   1.0,   0.5,  -0.1,  -1.1,  -2.5,  -4.3,  -6.6, -9.3,
]

// Power weights for averaging: 10^(A/10).  Using power weights (not
// amplitude) keeps the math consistent with how ear sensitivity is
// typically modelled and gives smooth roll-offs at the extremes.
export const A_WEIGHT_POWER = A_WEIGHT_DB.map(a => Math.pow(10, a / 10))

// Sanity check at module load — these three arrays must stay in lock-step.
if (THIRD_OCTAVE_HZ.length !== A_WEIGHT_POWER.length) {
  // eslint-disable-next-line no-console
  console.error('spectrumLevel: band / weight length mismatch')
}

/**
 * Perceptually-weighted mean of a curve (values in dB).  Returns the
 * "where's the centre of this thing, perceptually" dB number.
 * Non-finite bands are skipped — they don't get a vote at all.
 */
export function aWeightedMean(bands: number[]): number {
  const n = Math.min(bands.length, A_WEIGHT_POWER.length)
  let sumV = 0
  let sumW = 0
  for (let i = 0; i < n; i++) {
    const v = bands[i]
    if (!Number.isFinite(v)) continue
    const w = A_WEIGHT_POWER[i]
    sumV += w * v
    sumW += w
  }
  return sumW > 0 ? sumV / sumW : 0
}

/**
 * Level-align a curve so its perceptual centre sits at 0 dB.  Two
 * curves independently aligned will overlay by tonal character alone,
 * regardless of the level difference between the tracks they came from.
 *
 * Rounds to 2 dp to match the existing pivot-normalisation behaviour
 * (stable serialisation for history / tests).
 *
 * Non-finite input bands are clamped to -60 dB in the output, matching
 * the earlier `normalisePeak` convention.
 */
export function levelAlign(bands: number[]): number[] {
  if (!bands || bands.length === 0) return []
  const mean = aWeightedMean(bands)
  return bands.map(v =>
    Number.isFinite(v) ? +((v as number) - mean).toFixed(2) : -60,
  )
}
