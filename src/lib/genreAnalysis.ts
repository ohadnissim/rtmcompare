/**
 * Genre target curve analysis — runs entirely in the browser/renderer.
 *
 * Takes the 31-band spectrum already computed by the main analysis plus a
 * loaded genre profile JSON, and returns:
 *   - match_score (0-100)
 *   - radar axes (7 spectral regions + dynamics)
 *   - eq_tips (top moves to reach the genre target)
 *   - coaching (3-5 plain-English observations)
 *
 * No Python round-trip needed: spectrum is already in the analysis result,
 * genre curve is already loaded from the profile JSON.
 */

export interface GenreProfile {
  id: string
  name: string
  description?: string
  role?: string
  profile_type: 'genre'
  curve: number[]           // 31 mean-centered dB values
  curve_mad?: number[]      // mean absolute deviation per band
  /** Per-band confidence spread (high − low) in dB from TBC3 source data.
   *  Present on 10 genres that have a TBC3 counterpart. */
  tbc_spread?: number[]
  /** Same spread normalised 0-1 within the profile (0 = tightest band). */
  tbc_spread_norm?: number[]
  lufs_avg?: number
  lufs_std?: number
  lufs_range?: [number, number]
  dynamic_range_avg?: number
  dynamic_range_std?: number
  width_avg?: number
  width_std?: number
  peak_avg?: number
  sample_count?: number
}

export interface RadarAxis {
  label: string
  fileVal: number      // 0-1 (file's energy in this region, normalised)
  genreVal: number     // 0-1 (genre target energy in this region)
  deltaDb: number      // raw mean delta in dB (positive = file is hotter)
  /** Mean spread (confidence band width) for this region in dB.
   *  Undefined when no TBC3 data is available for this genre. */
  spreadDb?: number
  /** Whether this delta is within the genre's natural tolerance band. */
  withinTolerance?: boolean
}

export interface GenreEqTip {
  region: string
  freq: number        // representative center frequency in Hz
  deltaDb: number     // how far the file is from the target (positive = cut needed)
  action: 'cut' | 'boost'
  note: string
}

export interface GenreAnalysisResult {
  genreId: string
  genreName: string
  matchScore: number         // 0-100
  matchLabel: 'Excellent' | 'Good' | 'Fair' | 'Needs work'
  radar: RadarAxis[]
  eqTips: GenreEqTip[]
  coaching: string[]
  deltaPerBand: number[]     // signed dB deltas (positive = file is hotter than genre)
  spectrumCentered: number[] // mean-centered file spectrum (for spectrum overlay)
  genreCurve: number[]       // mean-centered genre target curve (for spectrum overlay)
}

// 31-band ISO 1/3-octave centers (Hz) — same as MASTERING_BAND_FREQS in comparator.py
export const BAND_FREQS = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
]

// 7 spectral radar regions.
// Sub starts at band 2 (31.5 Hz) — bands 0–1 (20–25 Hz) are excluded because
// mean-centring on bass-heavy genres pushes 20 Hz to −25 dB, which creates
// 15–20 dB artificial deltas even when the actual sub-bass balance is fine.
const RADAR_REGIONS: { label: string; start: number; end: number; centerHz: number }[] = [
  { label: 'Sub',        start: 2,  end: 5,  centerHz: 40    },
  { label: 'Bass',       start: 5,  end: 9,  centerHz: 80    },
  { label: 'Low Mids',   start: 9,  end: 14, centerHz: 250   },
  { label: 'Mids',       start: 14, end: 18, centerHz: 630   },
  { label: 'Upper Mids', start: 18, end: 22, centerHz: 1600  },
  { label: 'Highs',      start: 22, end: 27, centerHz: 5000  },
  { label: 'Air',        start: 27, end: 30, centerHz: 12500 },
]

/** Compute mean of a slice, ignoring −90 sentinel bands. */
function sliceMean(arr: number[], start: number, end: number): number {
  const s = arr.slice(start, end).filter(v => Number.isFinite(v) && v > -89)
  return s.length > 0 ? s.reduce((a, b) => a + b, 0) / s.length : 0
}

/**
 * 3-tap Hann smooth a 31-band spectrum in log-frequency space.
 * Kernel = np.hanning(5)[1:-1] normalised = [0.25, 0.5, 0.25].
 * Same operation as engineer_profile._smooth_log_spectrum(kernel_bands=3)
 * so genre comparison matches the Engineer Tips methodology — single-note
 * resonances (kick fundamentals, tuned bass) are suppressed without
 * destroying broad-band tonal imbalances.
 * Sentinel bands (−90 = out-of-Nyquist) are replaced with the nearest
 * valid neighbour before smoothing and restored afterwards.
 */
function smoothLogSpectrum(spec: number[]): number[] {
  const n = spec.length
  // Fill sentinels with nearest valid neighbour so they don't bleed into adjacent bands
  const clean = [...spec]
  for (let i = 0; i < n; i++) {
    if (clean[i] <= -89) {
      for (let d = 1; d < n; d++) {
        if (i - d >= 0 && clean[i - d] > -89) { clean[i] = clean[i - d]; break }
        if (i + d < n && clean[i + d] > -89) { clean[i] = clean[i + d]; break }
      }
    }
  }
  // Reflective padding (1 band each side, mirroring Python's np.pad mode='reflect')
  const padded = [clean[Math.min(1, n - 1)], ...clean, clean[Math.max(n - 2, 0)]]
  // Convolve with [0.25, 0.5, 0.25]
  const result = clean.map((_, i) => padded[i] * 0.25 + padded[i + 1] * 0.5 + padded[i + 2] * 0.25)
  // Restore original sentinel positions
  return result.map((v, i) => spec[i] <= -89 ? spec[i] : v)
}

/** Mean-center an array, ignoring −90 sentinel bands (out-of-Nyquist placeholders set by Python). */
function meanCenter(arr: number[]): number[] {
  const valid = arr.filter(v => Number.isFinite(v) && v > -89)
  const m = valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 0
  return arr.map(v => (v <= -89 ? v : v - m))
}

/** Clamp a value between min and max. */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/** Map a mean-centered dB value (-20..+20) to 0-1 radar range. */
function dbToRadar(db: number): number {
  return clamp((db + 20) / 40, 0, 1)
}

/** Format Hz value as a human string. */
function fmtHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`
}

// A-weighting (IEC 61672-1) power weights at each 31-band centre — same table as spectrumLevel.ts
const A_WEIGHT_DB = [
  -50.4, -44.8, -39.5, -34.5, -30.3, -26.2, -22.4, -19.1, -16.2, -13.2,
  -10.8,  -8.7,  -6.6,  -4.8,  -3.2,  -1.9,  -0.8,   0.0,   0.6,   1.0,
    1.2,   1.3,   1.2,   1.0,   0.5,  -0.1,  -1.1,  -2.5,  -4.3,  -6.6, -9.3,
]
const A_WEIGHT_POWER = A_WEIGHT_DB.map(a => Math.pow(10, a / 10))

/** Perceptually-weighted level alignment — centres a curve on its A-weighted mean. */
function levelAlign(bands: number[]): number[] {
  const n = Math.min(bands.length, A_WEIGHT_POWER.length)
  let sumV = 0, sumW = 0
  for (let i = 0; i < n; i++) {
    const v = bands[i]
    if (!Number.isFinite(v)) continue
    sumV += A_WEIGHT_POWER[i] * v
    sumW += A_WEIGHT_POWER[i]
  }
  const mean = sumW > 0 ? sumV / sumW : 0
  return bands.map(v => Number.isFinite(v) ? v - mean : -60)
}

export function computeGenreAnalysis(
  spectrumRaw: number[],          // 31-band file spectrum (dBFS, from analysis result)
  profile: GenreProfile,
): GenreAnalysisResult {
  if (!spectrumRaw || spectrumRaw.length < 31 || !profile.curve || profile.curve.length < 31) {
    return {
      genreId: profile.id,
      genreName: profile.name,
      matchScore: 0,
      matchLabel: 'Needs work',
      radar: [],
      eqTips: [],
      coaching: ['Insufficient data for genre analysis.'],
      deltaPerBand: [],
      spectrumCentered: [],
      genreCurve: [],
    }
  }

  // Both spectrum_b (from visualizations.py band_spectrum) and the genre curve
  // (from build_profile) are stored as simple arithmetic mean-centred dB values.
  // Re-centre each with the same method so any residual offset cancels cleanly.
  const spectrumCentered = meanCenter(spectrumRaw.slice(0, 31))
  const genreCurve = meanCenter(profile.curve.slice(0, 31))

  // Apply the same log-frequency Hann smoothing as Engineer Tips
  // (engineer_profile._smooth_log_spectrum, kernel=3). Smoothing both curves
  // cancels single-note resonances (kick fundamentals, tuned 808 subs) that
  // would otherwise show up as spurious 5–10 dB deltas in specific bands.
  const spectrumSmoothed = smoothLogSpectrum(spectrumCentered)
  const genreCurveSmoothed = smoothLogSpectrum(genreCurve)

  // Per-band delta: positive = file is hotter than genre target.
  // Uses smoothed spectra so individual resonances don't skew tips/score.
  // Sentinel bands (−90 = out-of-Nyquist) produce 0 delta — no valid data.
  const deltaPerBand = spectrumSmoothed.map((v, i) => {
    if (v <= -89 || genreCurveSmoothed[i] <= -89) return 0
    return v - genreCurveSmoothed[i]
  })

  // Match score: RMS of per-band deltas, excluding bands 0–1 (20–25 Hz) and 30 (20 kHz).
  // Those bands are excluded because mean-centring on bass-heavy genres pushes 20–25 Hz
  // to −9…−25 dB, creating 10–20 dB artificial deltas even when the audible bass is fine.
  // Band 30 (20 kHz) is a sentinel at 44.1 kHz and already contributes 0 delta.
  // When TBC3 spread is available, clamp each delta to zero inside the tolerance.
  const SCORE_BAND_MASK = [
    0, 0,  // bands 0-1 (20–25 Hz) — excluded
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,  // bands 2-11
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,  // bands 12-21
    1, 1, 1, 1, 1, 1, 1, 1,        // bands 22-29
    0,                               // band 30 (20 kHz) — excluded
  ]
  const spreadPerBand = profile.tbc_spread
  const effectiveDeltas = deltaPerBand.map((d, i) => {
    if (!spreadPerBand) return d
    const halfSpread = spreadPerBand[i] / 2
    return Math.abs(d) <= halfSpread ? 0 : d - Math.sign(d) * halfSpread
  })
  const scoreBands = effectiveDeltas.filter((_, i) => SCORE_BAND_MASK[i])
  const rmsDelta = Math.sqrt(scoreBands.reduce((s, d) => s + d * d, 0) / scoreBands.length)
  const matchScore = Math.round(clamp(100 - rmsDelta * 6, 0, 100))
  const matchLabel: GenreAnalysisResult['matchLabel'] =
    matchScore >= 85 ? 'Excellent' :
    matchScore >= 70 ? 'Good' :
    matchScore >= 50 ? 'Fair' : 'Needs work'

  // Radar axes — use smoothed spectra for the same reason as deltaPerBand
  const spread = profile.tbc_spread   // 31-band spread in dB, or undefined
  const radar: RadarAxis[] = RADAR_REGIONS.map(r => {
    const fileRegionMean  = sliceMean(spectrumSmoothed, r.start, r.end)
    const genreRegionMean = sliceMean(genreCurveSmoothed, r.start, r.end)
    const deltaDb = Math.round((fileRegionMean - genreRegionMean) * 10) / 10

    let spreadDb: number | undefined
    let withinTolerance: boolean | undefined
    if (spread) {
      // Mean spread for this region (half-width of the confidence band)
      spreadDb = Math.round(sliceMean(spread, r.start, r.end) * 10) / 10
      // Delta is within tolerance if |delta| < half the spread
      withinTolerance = Math.abs(deltaDb) <= spreadDb / 2
    }

    return {
      label: r.label,
      fileVal: dbToRadar(fileRegionMean),
      genreVal: dbToRadar(genreRegionMean),
      deltaDb,
      spreadDb,
      withinTolerance,
    }
  })

  // EQ tips: find the 5 regions with the largest |delta|, skip tiny ones.
  // Sub starts at band 2 (31.5 Hz) for the same reason as RADAR_REGIONS above.
  // Air ends at band 30 (16 kHz) — band 30 (20 kHz) is often a sentinel at 44.1 kHz.
  const EQ_REGIONS = [
    { label: 'Sub',        start: 2,  end: 5,  centerHz: 40    },
    { label: 'Low Bass',   start: 5,  end: 7,  centerHz: 63    },
    { label: 'Bass',       start: 7,  end: 9,  centerHz: 100   },
    { label: 'Low Mids',   start: 9,  end: 13, centerHz: 250   },
    { label: 'Mid-Low',    start: 13, end: 15, centerHz: 400   },
    { label: 'Mids',       start: 15, end: 18, centerHz: 630   },
    { label: 'Upper Mids', start: 18, end: 21, centerHz: 1600  },
    { label: 'Presence',   start: 21, end: 24, centerHz: 3150  },
    { label: 'Highs',      start: 24, end: 27, centerHz: 6300  },
    { label: 'Air',        start: 27, end: 30, centerHz: 12500 },
  ]

  const regionDeltas = EQ_REGIONS.map(r => ({
    region: r.label,
    freq: r.centerHz,
    deltaDb: Math.round(sliceMean(deltaPerBand, r.start, r.end) * 10) / 10,
  })).filter(r => Math.abs(r.deltaDb) >= 0.8)

  regionDeltas.sort((a, b) => Math.abs(b.deltaDb) - Math.abs(a.deltaDb))

  const eqTips: GenreEqTip[] = regionDeltas.slice(0, 5).map(r => {
    const action: 'cut' | 'boost' = r.deltaDb > 0 ? 'cut' : 'boost'
    const absDb = Math.abs(r.deltaDb).toFixed(1)
    const move = Math.round(Math.abs(r.deltaDb) / 2 * 10) / 10 // half-the-delta suggestion
    const note = action === 'cut'
      ? `${absDb} dB hot vs ${profile.name} target — try a ${move} dB cut around ${fmtHz(r.freq)}`
      : `${absDb} dB below ${profile.name} target — try a ${move} dB boost around ${fmtHz(r.freq)}`
    return { region: r.region, freq: r.freq, deltaDb: r.deltaDb, action, note }
  })

  // Coaching text: 3-5 human observations
  const coaching: string[] = []

  if (profile.description) {
    coaching.push(profile.description)
  }

  const topCut = eqTips.find(t => t.action === 'cut')
  const topBoost = eqTips.find(t => t.action === 'boost')

  if (topCut && Math.abs(topCut.deltaDb) >= 2) {
    coaching.push(`Your ${topCut.region.toLowerCase()} is running ${Math.abs(topCut.deltaDb).toFixed(1)} dB hotter than typical ${profile.name} masters. ${topCut.note}.`)
  }
  if (topBoost && Math.abs(topBoost.deltaDb) >= 2) {
    coaching.push(`${profile.name} masters tend to have more ${topBoost.region.toLowerCase()} energy — your file is ${Math.abs(topBoost.deltaDb).toFixed(1)} dB light in this region.`)
  }

  if (matchScore >= 85) {
    coaching.push('Tonal shape is well-aligned with the genre. Focus on dynamics and loudness for the final step.')
  } else if (matchScore >= 65) {
    coaching.push('Good foundation — a few targeted EQ moves will bring you into the genre pocket.')
  } else {
    coaching.push('Significant tonal divergence from the genre average. Start with the highest-priority EQ moves and re-analyse.')
  }

  // Lufs coaching if we have profile data
  if (profile.lufs_avg != null) {
    coaching.push(`${profile.name} masters average around ${profile.lufs_avg.toFixed(1)} LUFS integrated.`)
  }

  return {
    genreId: profile.id,
    genreName: profile.name,
    matchScore,
    matchLabel,
    radar,
    eqTips,
    coaching,
    deltaPerBand,
    spectrumCentered: spectrumSmoothed,
    genreCurve: genreCurveSmoothed,
  }
}
