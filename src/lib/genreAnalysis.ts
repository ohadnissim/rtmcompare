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
}

// 31-band ISO 1/3-octave centers (Hz) — same as MASTERING_BAND_FREQS in comparator.py
export const BAND_FREQS = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
]

// 7 spectral radar regions (same boundaries as _EQ_MATCH_REGIONS in comparator.py)
// plus a 8th synthetic Dynamics axis derived from lufs/LRA
const RADAR_REGIONS: { label: string; start: number; end: number; centerHz: number }[] = [
  { label: 'Sub',        start: 0,  end: 4,  centerHz: 31.5  },
  { label: 'Bass',       start: 4,  end: 8,  centerHz: 80    },
  { label: 'Low Mids',   start: 8,  end: 14, centerHz: 250   },
  { label: 'Mids',       start: 14, end: 18, centerHz: 630   },
  { label: 'Upper Mids', start: 18, end: 22, centerHz: 1600  },
  { label: 'Highs',      start: 22, end: 27, centerHz: 5000  },
  { label: 'Air',        start: 27, end: 31, centerHz: 14000 },
]

/** Compute mean of a slice of an array. */
function sliceMean(arr: number[], start: number, end: number): number {
  const s = arr.slice(start, end)
  return s.reduce((a, b) => a + b, 0) / s.length
}

/** Mean-center an array (subtract mean). */
function meanCenter(arr: number[]): number[] {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length
  return arr.map(v => v - m)
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
    }
  }

  // Mean-center the file's spectrum so it's in the same space as the genre curve
  const spectrumCentered = meanCenter(spectrumRaw.slice(0, 31))
  const genreCurve = profile.curve.slice(0, 31)

  // Per-band delta: positive = file is hotter than genre target
  const deltaPerBand = spectrumCentered.map((v, i) => v - genreCurve[i])

  // Match score: RMS of per-band deltas. When TBC3 spread is available,
  // clamp each delta to zero if it falls within the tolerance band —
  // those regions are genuinely inside the genre's natural variation.
  const spreadPerBand = profile.tbc_spread
  const effectiveDeltas = deltaPerBand.map((d, i) => {
    if (!spreadPerBand) return d
    const halfSpread = spreadPerBand[i] / 2
    return Math.abs(d) <= halfSpread ? 0 : d - Math.sign(d) * halfSpread
  })
  const rmsDelta = Math.sqrt(effectiveDeltas.reduce((s, d) => s + d * d, 0) / effectiveDeltas.length)
  const matchScore = Math.round(clamp(100 - rmsDelta * 6, 0, 100))
  const matchLabel: GenreAnalysisResult['matchLabel'] =
    matchScore >= 85 ? 'Excellent' :
    matchScore >= 70 ? 'Good' :
    matchScore >= 50 ? 'Fair' : 'Needs work'

  // Radar axes — include TBC3 confidence spread when available
  const spread = profile.tbc_spread   // 31-band spread in dB, or undefined
  const radar: RadarAxis[] = RADAR_REGIONS.map(r => {
    const fileRegionMean  = sliceMean(spectrumCentered, r.start, r.end)
    const genreRegionMean = sliceMean(genreCurve, r.start, r.end)
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

  // EQ tips: find the 5 regions with the largest |delta|, skip tiny ones
  const EQ_REGIONS = [
    { label: 'Sub',        start: 0,  end: 4,  centerHz: 31.5  },
    { label: 'Low Bass',   start: 4,  end: 6,  centerHz: 50    },
    { label: 'Bass',       start: 6,  end: 8,  centerHz: 100   },
    { label: 'Low Mids',   start: 8,  end: 12, centerHz: 250   },
    { label: 'Mid-Low',    start: 12, end: 14, centerHz: 400   },
    { label: 'Mids',       start: 14, end: 17, centerHz: 630   },
    { label: 'Upper Mids', start: 17, end: 20, centerHz: 1600  },
    { label: 'Presence',   start: 20, end: 23, centerHz: 3150  },
    { label: 'Highs',      start: 23, end: 27, centerHz: 6300  },
    { label: 'Air',        start: 27, end: 31, centerHz: 14000 },
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
  }
}
