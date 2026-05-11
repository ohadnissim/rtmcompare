/**
 * Plugin profiles — describe how to translate an RTMcompare EQ
 * suggestion (9 bands of {region, freq_hz, gain_db, q}) into a
 * specific hosted plugin's parameter writes.
 *
 * Two profile styles are supported:
 *
 * 1. "parametric"  — for plugins like FabFilter Pro-Q where the host
 *    can place each band at any frequency. The profile says "use
 *    bands N..N+8 of the plugin, each band has Used at offset 0,
 *    Frequency at offset 2, Gain at offset 3, Q at offset 4". We
 *    also write the freq/gain/Q in normalised (0..1) form using
 *    the plugin-specific scaling described in the profile.
 *
 * 2. "graphic"  — for fixed-band graphic EQs (Apple AUGraphicEQ,
 *    Voxengo Marvel, etc.) where the plugin's bands are at fixed
 *    ISO frequencies. The profile lists the plugin's per-band
 *    parameter names; we look each one up by name, find the
 *    closest plugin band to each of RTM's 9 regions, and apply.
 *
 * Adding a new plugin is one JSON file. No C++ rebuild.
 */

import { ParameterUpdate } from './rtmsend-bridge'

export interface RtmBand {
  region: string
  freq_hz: number
  gain_db: number
  q: number
}

interface ProfileMatch {
  /** Substring match on the loaded plugin's name (case-insensitive). */
  name_contains: string
}

export interface NormaliseRange {
  /** "linear" maps min..max → 0..1 directly; "log10" uses log10(hz). */
  type: 'linear' | 'log10'
  min: number
  max: number
}

export interface ParametricProfile {
  kind: 'parametric'
  name: string
  match: ProfileMatch
  /** Index of the first band in the plugin's parameter list. */
  first_band_index: number
  /** How many parameters belong to one band (Pro-Q 4: 16). */
  params_per_band: number
  /** Offsets within a band's band-param block. Set to null to skip.
   *  Some plugins (Kirchhoff, Pro-Q) gate each band twice:
   *    "Used"    — slot is allocated / a dot exists on the curve
   *    "Enabled" — band actually applies its EQ to audio
   *  Setting only "Used" makes the dot appear but the EQ stays
   *  bypassed (the user sees the move but doesn't hear it). Always
   *  set "enabled" too when the plugin has it. */
  offsets: {
    used: number | null     // 0/1: allocate this band slot
    enabled: number | null  // 0/1: actually apply the EQ on this band
    freq: number            // 0..1 normalised in freq_scaling
    gain: number            // 0..1 normalised in gain_scaling
    q: number | null        // 0..1 normalised in q_scaling
  }
  freq_scaling: NormaliseRange
  gain_scaling: NormaliseRange
  q_scaling?: NormaliseRange
  /** How many bands does the plugin have? We never write past this. */
  total_bands: number
}

export interface GraphicProfile {
  kind: 'graphic'
  name: string
  match: ProfileMatch
  /** Each plugin band: name (matched against host.list_parameters)
   *  + centre frequency in Hz. */
  bands: { name: string; freq_hz: number }[]
  /** 0..1 mapping for gain_db. AUGraphicEQ uses linear ±24 dB
   *  centred at 0.5; profile encodes that. */
  gain_scaling: NormaliseRange
  /** Setup writes that fire BEFORE band gains. Used by plugins that
   *  have a band-frequency SELECTOR (Maag EQ4's Air Band picks
   *  between 2.5k/5k/10k/20k/40k) — we set the selector to the
   *  freq that matches our `bands` entry, so subsequent gain writes
   *  land at the expected centre. Each entry is a direct VST3
   *  parameter index + normalised 0..1 value. */
  init_writes?: { index: number; value: number }[]
}

// "Named-slots" profile — for plugins like bx_digital V3 / SSL Native /
// MAAG EQ4 / classic console-style EQs where bands have fixed conceptual
// names (LF, LMF, MF, HMF, HF or similar) and EACH band has its OWN
// frequency range. A single global freq_scaling can't express that —
// sending RTM Mid (1500 Hz) to a "low-mid" slot that maxes out at 2000 Hz
// is fine, but sending it to a "high" slot whose range starts at 2000 Hz
// would clamp to 2000 Hz (wrong). So each slot carries its own scalings,
// and the translator picks the best-fitting slot per RTM band by
// log-distance match.
interface SlotDescriptor {
  /** Display label (LF/LMF/MF/HMF/HF or similar). Not used for matching. */
  name: string
  /** Index of the first parameter in this slot's contiguous block. */
  base_index: number
  offsets: {
    used: number | null     // 0/1: gate the band ("Active" on bx_digital)
    enabled: number | null  // some plugins have a separate enable
    freq: number
    gain: number
    q: number | null
  }
  freq_scaling: NormaliseRange
  gain_scaling: NormaliseRange
  q_scaling?: NormaliseRange
}

export interface NamedSlotsProfile {
  kind: 'named-slots'
  name: string
  match: ProfileMatch
  slots: SlotDescriptor[]
}

// "Interleaved" profile — for plugins that group parameters by TYPE
// instead of by band. iZotope Ozone EQ 12 is the canonical case:
//   indices 9..16  → Frequency 1..8  (one block of 8 freqs)
//   indices 17..24 → Gain 1..8       (one block of 8 gains)
//   indices 25..32 → Q 1..8
//   indices 41..48 → Enable 1..8
// vs the parametric layout where each band is contiguous (Used, Freq,
// Gain, Q together, then next band's Used, Freq, Gain, Q).
//
// The schema describes WHERE each parameter type's contiguous block
// starts. Slot N's freq is at `freq_base + N`, gain at `gain_base + N`,
// etc. Scaling is uniform across all bands (same as ParametricProfile).
export interface InterleavedProfile {
  kind: 'interleaved'
  name: string
  match: ProfileMatch
  freq_base: number
  gain_base: number
  q_base: number | null
  used_base: number | null      // band on/off gate
  enabled_base: number | null   // separate enable, rare
  total_bands: number
  freq_scaling: NormaliseRange
  gain_scaling: NormaliseRange
  q_scaling?: NormaliseRange
}

export type Profile = ParametricProfile | GraphicProfile | NamedSlotsProfile | InterleavedProfile

// ── Profile registry ──────────────────────────────────────────────
// Hardcoded for v1. Future: load from a profiles/ dir on disk so
// users can drop a JSON to add a plugin without a release.
const PROFILES: Profile[] = [
  // FabFilter Pro-Q 4. Empirically validated against the 737-param
  // tree the host sees. Each band block has Used at offset 0,
  // Enabled at offset 1, Frequency at offset 2, Gain at offset 3,
  // Q at offset 4, Shape at offset 5, Slope at 6, Stereo Placement
  // at 7, then 16 more (Speakers, Dynamic Range, Dynamics Enabled,
  // Dynamics Auto, Threshold, Attack, Release, plus 8 sidechain
  // params, plus an Audition flag) — 24 params total per band that
  // we don't touch beyond used/enabled/freq/gain/q. Layout decoded
  // live from RTMsend, NOT from FabFilter docs (docs were wrong).
  // Bands 1..24 fill the first 576 indices (24 × 24); the remaining
  // 161 are global/utility (Output Level, Display Range, etc).
  {
    kind: 'parametric',
    name: 'FabFilter Pro-Q 4',
    match: { name_contains: 'Pro-Q 4' },
    first_band_index: 0,
    params_per_band: 24,
    offsets: { used: 0, enabled: 1, freq: 2, gain: 3, q: 4 },
    // Pro-Q's frequency parameter is normalised log10(hz) over
    // 10 Hz .. 30 kHz. 0.0 ≈ 10 Hz, 1.0 ≈ 30 kHz, 0.575 ≈ 1 kHz
    // (matches what we read back from the live plugin).
    freq_scaling: { type: 'log10', min: 10, max: 30000 },
    // Gain is linear ±30 dB; 0.5 = 0 dB.
    gain_scaling: { type: 'linear', min: -30, max: 30 },
    // Q is log10 over 0.1 .. 40; 0.5 = 1.0 (matches read-back).
    q_scaling: { type: 'log10', min: 0.1, max: 40 },
    total_bands: 24,
  },

  // FabFilter Pro-Q 3 — empirically validated against the live 519-param
  // tree. Used at offset 0, Enabled at 1, Frequency at 2, Gain at 3,
  // (Slope/Shape inserted at 4-6), Q at 7. Total 15 params per band ×
  // 24 bands = 360 band params + 159 globals. Earlier guesses from
  // FabFilter docs (16 per band, q at 4) were WRONG — use empirical.
  // Q scaling matches Pro-Q 4: log10 over 0.025..40.
  {
    kind: 'parametric',
    name: 'FabFilter Pro-Q 3',
    match: { name_contains: 'Pro-Q 3' },
    first_band_index: 0,
    params_per_band: 15,
    offsets: { used: 0, enabled: 1, freq: 2, gain: 3, q: 7 },
    freq_scaling: { type: 'log10', min: 10, max: 30000 },
    gain_scaling: { type: 'linear', min: -30, max: 30 },
    q_scaling: { type: 'log10', min: 0.025, max: 40 },
    total_bands: 24,
  },

  // TBTECH Kirchhoff-EQ — 32-band parametric, 28 params per band.
  // Layout decoded empirically against the live plugin in Wavelab:
  //   Globals 0..5 (Bypass, InvertPhase, MasterVol, GainScale, AutoGain, Pan)
  //   Per-band block (28 params): 0=Used, 1=Enabled, 2=Type, 3=Slope,
  //     4=Freq, 5=Gain, 6=Q, 7..27=stereo/dyn/sidechain
  // Freq matches Pro-Q (log10 10..30k). Gain ±30 dB linear, 0.5=0dB.
  // Q is log10 over 0.025..40 — wider than Pro-Q (0.1..40), so Q values
  // sent to Kirchhoff need this scaling or they'll come out narrower
  // than intended.
  {
    kind: 'parametric',
    name: 'TBTECH Kirchhoff-EQ',
    match: { name_contains: 'kirchhoff' },
    first_band_index: 6,
    params_per_band: 28,
    // Kirchhoff REQUIRES both Used and Enabled set — without
    // Enabled the dot appears on the EQ display but the band
    // doesn't actually shape audio (silent move).
    offsets: { used: 0, enabled: 1, freq: 4, gain: 5, q: 6 },
    freq_scaling: { type: 'log10', min: 10, max: 30000 },
    gain_scaling: { type: 'linear', min: -30, max: 30 },
    q_scaling: { type: 'log10', min: 0.025, max: 40 },
    total_bands: 32,
  },

  // Brainworx bx_digital V3 — classic Mid/Side console-style EQ with
  // 5 named bands per channel (LF, LMF, MF, HMF, HF). We use only
  // channel 1 (the "M" in M/S Master mode, "L" in L/R mode); each
  // band has Type/Gain/Q/Frequency/Active params. Bands have OVERLAPPING
  // freq ranges with different bounds — empirically validated:
  //    LF  : 20-2000 Hz  log10
  //    LMF : 20-2000 Hz  log10
  //    MF  : 20-22000 Hz log10  (covers everything)
  //    HMF : 400-22000 Hz log10
  //    HF  : 2000-40000 Hz log10
  // Gain ±12 dB linear, Q 0.3-15 log10 — same for all bands.
  // Active is the only band-on/off gate (no separate enable). We map to
  // `used`; `enabled` stays null.
  {
    kind: 'named-slots',
    name: 'Brainworx bx_digital V3',
    match: { name_contains: 'bx_digital' },
    slots: [
      { name: 'LF',  base_index: 31, offsets: { used: 4, enabled: null, freq: 3, gain: 1, q: 2 },
        freq_scaling: { type: 'log10', min: 20,   max: 2000  },
        gain_scaling: { type: 'linear', min: -12, max: 12    },
        q_scaling:    { type: 'log10', min: 0.3,  max: 15    } },
      { name: 'LMF', base_index: 36, offsets: { used: 4, enabled: null, freq: 3, gain: 1, q: 2 },
        freq_scaling: { type: 'log10', min: 20,   max: 2000  },
        gain_scaling: { type: 'linear', min: -12, max: 12    },
        q_scaling:    { type: 'log10', min: 0.3,  max: 15    } },
      { name: 'MF',  base_index: 41, offsets: { used: 4, enabled: null, freq: 3, gain: 1, q: 2 },
        freq_scaling: { type: 'log10', min: 20,   max: 22000 },
        gain_scaling: { type: 'linear', min: -12, max: 12    },
        q_scaling:    { type: 'log10', min: 0.3,  max: 15    } },
      { name: 'HMF', base_index: 46, offsets: { used: 4, enabled: null, freq: 3, gain: 1, q: 2 },
        freq_scaling: { type: 'log10', min: 400,  max: 22000 },
        gain_scaling: { type: 'linear', min: -12, max: 12    },
        q_scaling:    { type: 'log10', min: 0.3,  max: 15    } },
      { name: 'HF',  base_index: 51, offsets: { used: 4, enabled: null, freq: 3, gain: 1, q: 2 },
        freq_scaling: { type: 'log10', min: 2000, max: 40000 },
        gain_scaling: { type: 'linear', min: -12, max: 12    },
        q_scaling:    { type: 'log10', min: 0.3,  max: 15    } },
    ],
  },

  // Brainworx bx_hybrid V2 — analog-style 5-band parametric per
  // channel (LF/LMF/MF/HMF/HF) with no Q control and no separate
  // enable gate. We use only channel 1 (the "M" in M/S Master mode).
  // Each band has its own freq range, empirically probed:
  //    LF  : 10-3000 Hz   log10
  //    LMF : 20-5000 Hz   log10
  //    MF  : 20-26000 Hz  log10
  //    HMF : 400-26000 Hz log10
  //    HF  : 400-26000 Hz log10
  // Gain ±12 dB linear, no Q. Without an enable gate, "disabled"
  // slots get gain set to 0 dB (norm=0.5) by namedSlotsUpdates.
  {
    kind: 'named-slots',
    name: 'Brainworx bx_hybrid V2',
    match: { name_contains: 'bx_hybrid' },
    slots: [
      { name: 'LF',  base_index: 11, offsets: { used: null, enabled: null, freq: 0, gain: 1, q: null },
        freq_scaling: { type: 'log10', min: 10,  max: 3000  },
        gain_scaling: { type: 'linear', min: -12, max: 12   } },
      { name: 'LMF', base_index: 15, offsets: { used: null, enabled: null, freq: 0, gain: 1, q: null },
        freq_scaling: { type: 'log10', min: 20,  max: 5000  },
        gain_scaling: { type: 'linear', min: -12, max: 12   } },
      { name: 'MF',  base_index: 19, offsets: { used: null, enabled: null, freq: 0, gain: 1, q: null },
        freq_scaling: { type: 'log10', min: 20,  max: 26000 },
        gain_scaling: { type: 'linear', min: -12, max: 12   } },
      { name: 'HMF', base_index: 23, offsets: { used: null, enabled: null, freq: 0, gain: 1, q: null },
        freq_scaling: { type: 'log10', min: 400, max: 26000 },
        gain_scaling: { type: 'linear', min: -12, max: 12   } },
      { name: 'HF',  base_index: 27, offsets: { used: null, enabled: null, freq: 0, gain: 1, q: null },
        freq_scaling: { type: 'log10', min: 400, max: 26000 },
        gain_scaling: { type: 'linear', min: -12, max: 12   } },
    ],
  },

  // SPL PQ — analog-modelled mastering EQ. 5 named parametric bands
  // per channel (Lo / LM / Mi / HM / Hi) plus HPF/LPF. Two channels
  // (1 = M or L depending on Stereo Mode, 2 = S or R). We profile
  // channel 1 only, the 5 main bands. Each band block is 6 params:
  //   Power, Q Mode, Gain Mode, Gain, Frequency, Q
  // Per-band freq ranges (log10):
  //   Lo : 10-330 Hz       LM : 33-1000 Hz       Mi : 128-4100 Hz
  //   HM : 310-10200 Hz    Hi : 760-24000 Hz
  // Gain ±20 dB linear (0.5 = 0 dB), uniform across bands.
  // Q is REVERSED log10 over [15 .. 0.6] — norm=0 is narrow (Q=15),
  // norm=1 is wide (Q=0.6). The new normalise() above handles this
  // by treating min as "value at norm=0" rather than a floor.
  {
    kind: 'named-slots',
    name: 'SPL PQ',
    match: { name_contains: 'SPL PQ' },
    slots: [
      { name: 'Lo', base_index: 25, offsets: { used: 0, enabled: null, freq: 4, gain: 3, q: 5 },
        freq_scaling: { type: 'log10', min: 10,   max: 330   },
        gain_scaling: { type: 'linear', min: -20, max: 20    },
        q_scaling:    { type: 'log10', min: 15,   max: 0.6   } },
      { name: 'LM', base_index: 31, offsets: { used: 0, enabled: null, freq: 4, gain: 3, q: 5 },
        freq_scaling: { type: 'log10', min: 33,   max: 1000  },
        gain_scaling: { type: 'linear', min: -20, max: 20    },
        q_scaling:    { type: 'log10', min: 15,   max: 0.6   } },
      { name: 'Mi', base_index: 37, offsets: { used: 0, enabled: null, freq: 4, gain: 3, q: 5 },
        freq_scaling: { type: 'log10', min: 128,  max: 4100  },
        gain_scaling: { type: 'linear', min: -20, max: 20    },
        q_scaling:    { type: 'log10', min: 15,   max: 0.6   } },
      { name: 'HM', base_index: 43, offsets: { used: 0, enabled: null, freq: 4, gain: 3, q: 5 },
        freq_scaling: { type: 'log10', min: 310,  max: 10200 },
        gain_scaling: { type: 'linear', min: -20, max: 20    },
        q_scaling:    { type: 'log10', min: 15,   max: 0.6   } },
      { name: 'Hi', base_index: 49, offsets: { used: 0, enabled: null, freq: 4, gain: 3, q: 5 },
        freq_scaling: { type: 'log10', min: 760,  max: 24000 },
        gain_scaling: { type: 'linear', min: -20, max: 20    },
        q_scaling:    { type: 'log10', min: 15,   max: 0.6   } },
    ],
  },

  // iZotope Ozone 12 Equalizer — 8-band parametric using an
  // "interleaved" param layout (all freqs together, then all gains,
  // then all Qs, then all enables). Section is preceded by 9 input/
  // output gain controls, so band-1 freq starts at index 9. There's
  // also an Aux section starting at 58 for M/S Aux processing —
  // we only profile the Stereo/Main section (8 bands is enough for
  // RTM's 9 regions; Top gets dropped in 8-band plugins).
  //
  // Scalings empirically probed and notably non-standard:
  //   - Frequency: LINEAR 20-20000 Hz (most EQs use log10)
  //   - Gain: asymmetric LINEAR -30..+15 dB
  //   - Q: linear 0.2..12
  // The linear freq mapping means the bottom octaves get little
  // resolution per RTM region, but values still land at the right
  // Hz position.
  {
    kind: 'interleaved',
    name: 'iZotope Ozone 12 Equalizer',
    match: { name_contains: 'Ozone 12 Equalizer' },
    freq_base: 9,
    gain_base: 17,
    q_base: 25,
    used_base: 41,        // "EQ: Stereo/Main Enable N"
    enabled_base: null,
    total_bands: 8,
    freq_scaling: { type: 'linear', min: 20,  max: 20000 },
    gain_scaling: { type: 'linear', min: -30, max: 15    },
    q_scaling:    { type: 'linear', min: 0.2, max: 12    },
  },

  // SurferEQ — pitch-tracking parametric EQ. The bands follow the
  // input's fundamental pitch automatically. 2151 total params (most
  // are modulation/automation infrastructure); the EQ section itself
  // is 5 bands × 7 params per band starting at index 11. Auto-detect
  // probed the scalings.
  {
    kind: 'parametric',
    name: 'SurferEQ',
    match: { name_contains: 'SurferEQ' },
    first_band_index: 11,
    params_per_band: 7,
    offsets: { used: null, enabled: 0, freq: 3, gain: 6, q: 5 },
    freq_scaling: { type: 'log10', min: 20, max: 20000 },
    gain_scaling: { type: 'linear', min: -20, max: 20 },
    q_scaling: { type: 'linear', min: 0, max: 3 },
    total_bands: 5,
  },

  // Brainworx bx_console SSL 4000 E — earlier "brown EQ" SSL 4000.
  // Same band shape as G/J variants, but gain is ±15 dB on every band
  // (reflecting the original 4000 E hardware spec, narrower than the
  // later G console).
  {
    kind: 'named-slots',
    name: 'Brainworx bx_console SSL 4000 E',
    match: { name_contains: 'bx_console SSL 4000 E' },
    slots: [
      { name: 'High',     base_index: 38, offsets: { used: null, enabled: null, freq: 1, gain: 0, q: null },
        freq_scaling: { type: 'linear', min: 1500, max: 16000 },
        gain_scaling: { type: 'linear', min: -15,  max: 15    } },
      { name: 'High Mid', base_index: 41, offsets: { used: null, enabled: null, freq: 1, gain: 0, q: 2 },
        freq_scaling: { type: 'linear', min: 600,  max: 7000  },
        gain_scaling: { type: 'linear', min: -15,  max: 15    },
        q_scaling:    { type: 'linear', min: 3.0,  max: 0.5   } },
      { name: 'Low Mid',  base_index: 45, offsets: { used: null, enabled: null, freq: 1, gain: 0, q: 2 },
        freq_scaling: { type: 'linear', min: 200,  max: 2500  },
        gain_scaling: { type: 'linear', min: -15,  max: 15    },
        q_scaling:    { type: 'linear', min: 3.0,  max: 0.5   } },
      { name: 'Low',      base_index: 48, offsets: { used: null, enabled: null, freq: 1, gain: 0, q: null },
        freq_scaling: { type: 'linear', min: 30,   max: 450   },
        gain_scaling: { type: 'linear', min: -15,  max: 15    } },
    ],
  },

  // Brainworx bx_console SSL 4000 G — SSL 4000 channel strip
  // emulation. Same band shape as the 9000 J variant but with the
  // 4000-series curves: ±22 dB on parametric mids (vs ±20),
  // Q range 3.0..0.5 (vs 2.5..0.7), slightly different freq ranges.
  // All bands LINEAR freq scaling on this one (no log10).
  {
    kind: 'named-slots',
    name: 'Brainworx bx_console SSL 4000 G',
    match: { name_contains: 'bx_console SSL 4000' },
    slots: [
      { name: 'High',     base_index: 38, offsets: { used: null, enabled: null, freq: 1, gain: 0, q: null },
        freq_scaling: { type: 'linear', min: 1500, max: 16000 },
        gain_scaling: { type: 'linear', min: -20,  max: 20    } },
      { name: 'High Mid', base_index: 41, offsets: { used: null, enabled: null, freq: 1, gain: 0, q: 2 },
        freq_scaling: { type: 'linear', min: 600,  max: 7000  },
        gain_scaling: { type: 'linear', min: -22,  max: 22    },
        q_scaling:    { type: 'linear', min: 3.0,  max: 0.5   } },
      { name: 'Low Mid',  base_index: 46, offsets: { used: null, enabled: null, freq: 1, gain: 0, q: 2 },
        freq_scaling: { type: 'linear', min: 200,  max: 2500  },
        gain_scaling: { type: 'linear', min: -22,  max: 22    },
        q_scaling:    { type: 'linear', min: 3.0,  max: 0.5   } },
      { name: 'Low',      base_index: 50, offsets: { used: null, enabled: null, freq: 1, gain: 0, q: null },
        freq_scaling: { type: 'linear', min: 30,   max: 450   },
        gain_scaling: { type: 'linear', min: -18,  max: 18    } },
    ],
  },

  // Brainworx bx_console SSL 9000 J — channel-strip emulation of the
  // SSL 9000 J. 4 bands per channel: High (shelf), High Mid (bell),
  // Low Mid (bell), Low (shelf). Q is reversed on parametric bands
  // (norm=0 narrow, norm=1 wide) — same SPL-style mapping. Gain
  // asymmetric on lower bands (matches the hardware spec). Mostly
  // LINEAR freq scaling, except High band which is log10 over a
  // wider range. Probed live and validated.
  // Tagged 'mixing' rather than 'mastering-grade' since this is a
  // channel-strip emulation, intended for tracking/mixing.
  {
    kind: 'named-slots',
    name: 'Brainworx bx_console SSL 9000 J',
    match: { name_contains: 'bx_console SSL 9000' },
    slots: [
      { name: 'High',     base_index: 36, offsets: { used: null, enabled: null, freq: 1, gain: 0, q: null },
        freq_scaling: { type: 'log10',  min: 1500, max: 22000 },
        gain_scaling: { type: 'linear', min: -20,  max: 20    } },
      { name: 'High Mid', base_index: 39, offsets: { used: null, enabled: null, freq: 1, gain: 0, q: 2 },
        freq_scaling: { type: 'linear', min: 600,  max: 7000  },
        gain_scaling: { type: 'linear', min: -20,  max: 20    },
        q_scaling:    { type: 'linear', min: 2.5,  max: 0.7   } },
      { name: 'Low Mid',  base_index: 43, offsets: { used: null, enabled: null, freq: 1, gain: 0, q: 2 },
        freq_scaling: { type: 'linear', min: 200,  max: 2500  },
        gain_scaling: { type: 'linear', min: -20,  max: 18    },
        q_scaling:    { type: 'linear', min: 2.5,  max: 0.7   } },
      { name: 'Low',      base_index: 47, offsets: { used: null, enabled: null, freq: 1, gain: 0, q: null },
        freq_scaling: { type: 'linear', min: 40,   max: 600   },
        gain_scaling: { type: 'linear', min: -18,  max: 18    } },
    ],
  },

  // elysia museq — analog-modelled passive mastering EQ.
  // 5 named bands per channel: Low (shelf) / Bottom / Middle / Top
  // (bells) / High (shelf). Boost-only — gain range is 0..+15 dB.
  // RTM cut moves (negative gain) clamp to 0 dB → silent no-op for
  // those bands; users wanting cuts need a different EQ. Per-band
  // log10 freq ranges:
  //   Low    : 9-200 Hz
  //   Bottom : 18-400 Hz
  //   Middle : 150-3500 Hz
  //   Top    : 700-16000 Hz
  //   High   : 1800-35000 Hz
  // Q probe deferred — defaults to undefined (Q not written, plugin
  // uses its own current Q values). Gain ±15 linear, but only positive
  // half is actually addressable.
  // Auto-detected and validated via probe.
  {
    kind: 'named-slots',
    name: 'elysia museq',
    match: { name_contains: 'museq' },
    slots: [
      { name: 'Low',    base_index: 0,  offsets: { used: null, enabled: null, freq: 3, gain: 0, q: null },
        freq_scaling: { type: 'log10', min: 9,    max: 200   },
        gain_scaling: { type: 'linear', min: 0,   max: 15    } },
      { name: 'Bottom', base_index: 4,  offsets: { used: null, enabled: null, freq: 3, gain: 0, q: 1 },
        freq_scaling: { type: 'log10', min: 18,   max: 400   },
        gain_scaling: { type: 'linear', min: 0,   max: 15    } },
      { name: 'Middle', base_index: 8,  offsets: { used: null, enabled: null, freq: 3, gain: 0, q: 1 },
        freq_scaling: { type: 'log10', min: 150,  max: 3500  },
        gain_scaling: { type: 'linear', min: 0,   max: 15    } },
      { name: 'Top',    base_index: 12, offsets: { used: null, enabled: null, freq: 3, gain: 0, q: 1 },
        freq_scaling: { type: 'log10', min: 700,  max: 16000 },
        gain_scaling: { type: 'linear', min: 0,   max: 15    } },
      { name: 'High',   base_index: 16, offsets: { used: null, enabled: null, freq: 3, gain: 0, q: null },
        freq_scaling: { type: 'log10', min: 1800, max: 35000 },
        gain_scaling: { type: 'linear', min: 0,   max: 15    } },
    ],
  },

  // Knif Audio Soma — Finnish boutique mastering EQ. 4 bands per
  // channel (Low / Low Mid / High Mid / High), each with On + Boost +
  // Freq + Bandwidth. Per-band log10 freq ranges:
  //   Low      : 27-470 Hz
  //   Low Mid  : 100-1800 Hz
  //   High Mid : 560-10000 Hz
  //   High     : 1500-27000 Hz
  // Gain ±8 dB linear (narrower than most — preserves analog character).
  // Bandwidth has a QUIRK: norm=1.0 morphs the band from a bell into
  // a shelf. We use log10 over [0.5, 4] which keeps norm safely below
  // the shelf threshold; high RTM Q values clamp at Q=4 instead of
  // accidentally turning into a shelf.
  // Channel 1 only (channel 2 mirrors at idx 24+).
  {
    kind: 'named-slots',
    name: 'Knif Audio Soma',
    match: { name_contains: 'Knif' },
    slots: [
      { name: 'Low',      base_index: 2,  offsets: { used: 0, enabled: null, freq: 2, gain: 1, q: 3 },
        freq_scaling: { type: 'log10', min: 27,   max: 470   },
        gain_scaling: { type: 'linear', min: -8, max: 8      },
        q_scaling:    { type: 'log10', min: 0.5,  max: 4     } },
      { name: 'Low Mid',  base_index: 6,  offsets: { used: 0, enabled: null, freq: 2, gain: 1, q: 3 },
        freq_scaling: { type: 'log10', min: 100,  max: 1800  },
        gain_scaling: { type: 'linear', min: -8, max: 8      },
        q_scaling:    { type: 'log10', min: 0.5,  max: 4     } },
      { name: 'High Mid', base_index: 10, offsets: { used: 0, enabled: null, freq: 2, gain: 1, q: 3 },
        freq_scaling: { type: 'log10', min: 560,  max: 10000 },
        gain_scaling: { type: 'linear', min: -8, max: 8      },
        q_scaling:    { type: 'log10', min: 0.5,  max: 4     } },
      { name: 'High',     base_index: 14, offsets: { used: 0, enabled: null, freq: 2, gain: 1, q: 3 },
        freq_scaling: { type: 'log10', min: 1500, max: 27000 },
        gain_scaling: { type: 'linear', min: -8, max: 8      },
        q_scaling:    { type: 'log10', min: 0.5,  max: 4     } },
    ],
  },

  // Lindell EQ825 — Plugin Alliance console-strip-style EQ. 5 named
  // bands per channel: LowShelf / Low / Mid / High / HighShelf.
  // Each band has only Freq + Gain (no Q, no enable). Empirically
  // probed per-band freq ranges (mixed linear and log10):
  //   LowShelf : 20-100 Hz linear      (narrow shelf)
  //   Low      : 60-1000 Hz log10
  //   Mid      : 1500-5000 Hz linear   (narrow parametric)
  //   High     : 6000-16000 Hz log10
  //   HighShelf: 3000-20000 Hz linear  (wide shelf)
  // Gain ±12 dB linear, uniform across all bands. No Q. No per-band
  // enable, so empty slots get gain set to 0 dB (norm=0.5) by
  // namedSlotsUpdates' fallback path.
  // We profile the Left channel only; Right is at idx 12-21 with
  // identical layout. Mid/Side toggle (idx 24) lets the plugin
  // operate in M/S mode but we don't address that here.
  {
    kind: 'named-slots',
    name: 'Lindell EQ825',
    match: { name_contains: 'Lindell EQ825' },
    slots: [
      { name: 'LowShelf',  base_index: 1, offsets: { used: null, enabled: null, freq: 0, gain: 1, q: null },
        freq_scaling: { type: 'linear', min: 20,   max: 100   },
        gain_scaling: { type: 'linear', min: -12,  max: 12    } },
      { name: 'Low',       base_index: 3, offsets: { used: null, enabled: null, freq: 0, gain: 1, q: null },
        freq_scaling: { type: 'log10',  min: 60,   max: 1000  },
        gain_scaling: { type: 'linear', min: -12,  max: 12    } },
      { name: 'Mid',       base_index: 5, offsets: { used: null, enabled: null, freq: 0, gain: 1, q: null },
        freq_scaling: { type: 'linear', min: 1500, max: 5000  },
        gain_scaling: { type: 'linear', min: -12,  max: 12    } },
      { name: 'High',      base_index: 7, offsets: { used: null, enabled: null, freq: 0, gain: 1, q: null },
        freq_scaling: { type: 'log10',  min: 6000, max: 16000 },
        gain_scaling: { type: 'linear', min: -12,  max: 12    } },
      { name: 'HighShelf', base_index: 9, offsets: { used: null, enabled: null, freq: 0, gain: 1, q: null },
        freq_scaling: { type: 'linear', min: 3000, max: 20000 },
        gain_scaling: { type: 'linear', min: -12,  max: 12    } },
    ],
  },

  // Maag EQ4 — 6-band fixed-frequency graphic-style EQ. Sub/40/160/
  // 650/2.5k are fixed; Air Band has a discrete frequency SELECTOR
  // (Off / 2.5k / 5k / 10k / 20k / 40k) we pre-set to 10 kHz before
  // sending. Gain is linear ±5 dB on every band. Limited to 5 dB so
  // RTM gain values beyond ±5 will clamp at the rails (visible to
  // the user as the Maag knob hitting its endstop).
  //
  // RTM has 9 bands and Maag has 6, so high-frequency bands collapse
  // to the Air slot (last RTM band wins on collision). Future work:
  // could choose Air Band freq dynamically based on which RTM HF
  // band has the strongest move.
  {
    kind: 'graphic',
    name: 'Maag EQ4',
    match: { name_contains: 'Maag EQ4' },
    init_writes: [
      // Air Band selector: 0.0=Off, 0.2=2.5k, 0.4=5k, 0.6=10k, 0.8=20k, 1.0=40k.
      // Default to 10 kHz — broadly useful for mastering air boosts.
      { index: 6, value: 0.6 },
    ],
    bands: [
      { name: 'Sub',      freq_hz: 10    },
      { name: '40 Hz',    freq_hz: 40    },
      { name: '160 Hz',   freq_hz: 160   },
      { name: '650 Hz',   freq_hz: 650   },
      { name: '2.5 kHz',  freq_hz: 2500  },
      { name: 'Air Gain', freq_hz: 10000 },  // Set to 10k by init_writes above
    ],
    gain_scaling: { type: 'linear', min: -5, max: 5 },
  },

  // Apple AUGraphicEQ — 31 ISO 1/3-octave bands, fixed centres,
  // ±24 dB linear, 0.5 = 0 dB. Verified live.
  {
    kind: 'graphic',
    name: 'Apple AUGraphicEQ',
    match: { name_contains: 'AUGraphicEQ' },
    bands: [
      { name: '20.0 Hz', freq_hz: 20 },
      { name: '25.0 Hz', freq_hz: 25 },
      { name: '31.5 Hz', freq_hz: 31.5 },
      { name: '40.0 Hz', freq_hz: 40 },
      { name: '50.0 Hz', freq_hz: 50 },
      { name: '63.0 Hz', freq_hz: 63 },
      { name: '80.0 Hz', freq_hz: 80 },
      { name: '100.0 Hz', freq_hz: 100 },
      { name: '125.0 Hz', freq_hz: 125 },
      { name: '160.0 Hz', freq_hz: 160 },
      { name: '200.0 Hz', freq_hz: 200 },
      { name: '250.0 Hz', freq_hz: 250 },
      { name: '315.0 Hz', freq_hz: 315 },
      { name: '400.0 Hz', freq_hz: 400 },
      { name: '500.0 Hz', freq_hz: 500 },
      { name: '630.0 Hz', freq_hz: 630 },
      { name: '800.0 Hz', freq_hz: 800 },
      { name: '1000.0 Hz', freq_hz: 1000 },
      { name: '1250.0 Hz', freq_hz: 1250 },
      { name: '1600.0 Hz', freq_hz: 1600 },
      { name: '2000.0 Hz', freq_hz: 2000 },
      { name: '2500.0 Hz', freq_hz: 2500 },
      { name: '3150.0 Hz', freq_hz: 3150 },
      { name: '4000.0 Hz', freq_hz: 4000 },
      { name: '5000.0 Hz', freq_hz: 5000 },
      { name: '6300.0 Hz', freq_hz: 6300 },
      { name: '8000.0 Hz', freq_hz: 8000 },
      { name: '10000.0 Hz', freq_hz: 10000 },
      { name: '12000.0 Hz', freq_hz: 12000 },
      { name: '16000.0 Hz', freq_hz: 16000 },
      { name: '20000.0 Hz', freq_hz: 20000 },
    ],
    gain_scaling: { type: 'linear', min: -24, max: 24 },
  },
]

// ── Helpers ───────────────────────────────────────────────────────

function clamp01 (v: number): number {
  return Math.max(0, Math.min(1, v))
}

function normalise (value: number, scaling: NormaliseRange): number {
  if (scaling.type === 'log10') {
    // `min` is the value at norm=0, `max` is the value at norm=1. Most
    // plugins map increasing norm to increasing value (min < max), but
    // some (SPL PQ's Q parameter, certain compressor "speed" knobs)
    // run the other way — norm=0 is wide-Q, norm=1 is narrow. Don't
    // floor `value` to `min` here; that breaks reversed scalings.
    // Just guard against log(0) / log(negative) with a tiny floor.
    const a = Math.log10(scaling.min)
    const b = Math.log10(scaling.max)
    const safe = Math.max(value, 1e-6)
    return clamp01((Math.log10(safe) - a) / (b - a))
  }
  // linear — handles both directions naturally (max < min is allowed).
  return clamp01((value - scaling.min) / (scaling.max - scaling.min))
}

export function findProfile (pluginName: string): Profile | null {
  const needle = pluginName.toLowerCase()
  for (const p of PROFILES) {
    if (needle.includes(p.match.name_contains.toLowerCase())) return p
  }
  return null
}

export function listSupportedPlugins (): string[] {
  return PROFILES.map(p => p.name)
}

// ── Translate RTM bands → parameter writes ────────────────────────

export function bandsToUpdates (profile: Profile, bands: RtmBand[]): ParameterUpdate[] {
  if (profile.kind === 'parametric')   return parametricUpdates(profile, bands)
  if (profile.kind === 'named-slots')  return namedSlotsUpdates(profile, bands)
  if (profile.kind === 'interleaved')  return interleavedUpdates(profile, bands)
  return graphicUpdates(profile, bands)
}

/**
 * Interleaved-layout translation. Each parameter type lives in its own
 * contiguous block (freq_base..freq_base+N-1, gain_base..gain_base+N-1,
 * etc.), so band slot K's freq is at `freq_base + K`. Same RTM-reserved-
 * slots discipline as parametricUpdates: fill slots 0..N-1 with bands,
 * disable slots N..RTM_RESERVED_SLOTS-1.
 */
function interleavedUpdates (profile: InterleavedProfile, bands: RtmBand[]): ParameterUpdate[] {
  const out: ParameterUpdate[] = []
  const reserved = Math.min(RTM_RESERVED_SLOTS, profile.total_bands)
  for (let slot = 0; slot < reserved; slot++) {
    if (slot < bands.length) {
      const b = bands[slot]
      if (profile.used_base != null) {
        out.push({ index: profile.used_base + slot, value: 1 })
      }
      if (profile.enabled_base != null) {
        out.push({ index: profile.enabled_base + slot, value: 1 })
      }
      out.push({ index: profile.freq_base + slot, value: normalise(b.freq_hz, profile.freq_scaling) })
      out.push({ index: profile.gain_base + slot, value: normalise(b.gain_db, profile.gain_scaling) })
      if (profile.q_base != null && profile.q_scaling) {
        out.push({ index: profile.q_base + slot, value: normalise(b.q, profile.q_scaling) })
      }
    } else {
      // Empty slot — disable so prior values don't linger.
      if (profile.enabled_base != null) {
        out.push({ index: profile.enabled_base + slot, value: 0 })
      }
      if (profile.used_base != null) {
        out.push({ index: profile.used_base + slot, value: 0 })
      }
    }
  }
  return out
}

/**
 * Named-slots translation. Each plugin slot has its own freq range;
 * we assign each RTM band to the slot whose range covers its freq AND
 * whose CENTRE (geometric mean of min/max) is closest in log space.
 * Greedy: we walk RTM bands from low to high frequency and consume
 * slots as we find good matches. Slots that don't get an RTM band
 * are explicitly disabled (Active = 0) so previous Sends are wiped.
 */
function namedSlotsUpdates (profile: NamedSlotsProfile, bands: RtmBand[]): ParameterUpdate[] {
  const out: ParameterUpdate[] = []
  // Sort bands by frequency (RTM emits them this way already; defensive)
  const sortedBands = [...bands].sort((a, b) => a.freq_hz - b.freq_hz)
  const usedSlotIdx = new Set<number>()

  // Match each RTM band to the best-fitting unused slot.
  const assignments: { band: RtmBand; slotIdx: number }[] = []
  for (const b of sortedBands) {
    let bestIdx = -1
    let bestDist = Infinity
    for (let i = 0; i < profile.slots.length; i++) {
      if (usedSlotIdx.has(i)) continue
      const s = profile.slots[i]
      const inRange = b.freq_hz >= s.freq_scaling.min && b.freq_hz <= s.freq_scaling.max
      if (!inRange) continue
      const centre = Math.sqrt(s.freq_scaling.min * s.freq_scaling.max)
      const dist = Math.abs(Math.log10(b.freq_hz) - Math.log10(centre))
      if (dist < bestDist) { bestDist = dist; bestIdx = i }
    }
    if (bestIdx >= 0) {
      usedSlotIdx.add(bestIdx)
      assignments.push({ band: b, slotIdx: bestIdx })
    }
    // RTM bands that don't fit any remaining slot are dropped.
  }

  // Write the assigned slots.
  for (const { band, slotIdx } of assignments) {
    const s = profile.slots[slotIdx]
    const base = s.base_index
    if (s.offsets.used != null) {
      out.push({ index: base + s.offsets.used, value: 1 })
    }
    if (s.offsets.enabled != null) {
      out.push({ index: base + s.offsets.enabled, value: 1 })
    }
    out.push({ index: base + s.offsets.freq, value: normalise(band.freq_hz, s.freq_scaling) })
    out.push({ index: base + s.offsets.gain, value: normalise(band.gain_db, s.gain_scaling) })
    if (s.offsets.q != null && s.q_scaling) {
      out.push({ index: base + s.offsets.q, value: normalise(band.q, s.q_scaling) })
    }
  }

  // Disable any slot we didn't fill — wipes stale state from a previous
  // Send. Same contract as parametricUpdates. Three cases:
  //
  //   1. Slot has an Enabled gate     → write Enabled=0
  //   2. Slot has a Used gate         → write Used=0  (also wipes the dot)
  //   3. Slot has neither (e.g. bx_hybrid V2, classic console-style EQs
  //      that have no on/off per band) → fall back to writing Gain=0
  //      (which for linear ±N dB scaling is norm=0.5, i.e. unity gain).
  //      The band still "exists" but contributes nothing audible.
  for (let i = 0; i < profile.slots.length; i++) {
    if (usedSlotIdx.has(i)) continue
    const s = profile.slots[i]
    const hasGate = s.offsets.enabled != null || s.offsets.used != null
    if (s.offsets.enabled != null) {
      out.push({ index: s.base_index + s.offsets.enabled, value: 0 })
    }
    if (s.offsets.used != null) {
      out.push({ index: s.base_index + s.offsets.used, value: 0 })
    }
    if (!hasGate) {
      // Find the norm value that maps to 0 dB on this slot's gain
      // scaling. For symmetric ranges (-N .. +N) that's 0.5; for
      // asymmetric ranges we compute it.
      const g = s.gain_scaling
      const zeroNorm = (0 - g.min) / (g.max - g.min)
      out.push({
        index: s.base_index + s.offsets.gain,
        value: clamp01(zeroNorm),
      })
    }
  }
  return out
}

// RTMcompare's EQ Preview emits up to 9 bands (one per region: Sub,
// Bass, Low Mid, Mid, Upper Mid, Presence, Brilliance, Air, Top).
// We reserve the FIRST 9 slots of the hosted plugin's band stack
// for RTMsend output. Engineers' manual bands belong in slots 10+
// and we never touch those. This contract lets each Send fully
// re-state RTM's section of the EQ — toggling a band off in
// RTMcompare actually empties its slot in the plugin instead of
// leaving stale values from a previous Send.
const RTM_RESERVED_SLOTS = 9

function parametricUpdates (profile: ParametricProfile, bands: RtmBand[]): ParameterUpdate[] {
  const out: ParameterUpdate[] = []
  const reserved = Math.min(RTM_RESERVED_SLOTS, profile.total_bands)
  for (let slot = 0; slot < reserved; slot++) {
    const base = profile.first_band_index + slot * profile.params_per_band
    if (slot < bands.length) {
      // Fill slot with the band the user wants there.
      const b = bands[slot]
      if (profile.offsets.used != null) {
        out.push({ index: base + profile.offsets.used, value: 1 })
      }
      if (profile.offsets.enabled != null) {
        out.push({ index: base + profile.offsets.enabled, value: 1 })
      }
      out.push({ index: base + profile.offsets.freq, value: normalise(b.freq_hz, profile.freq_scaling) })
      out.push({ index: base + profile.offsets.gain, value: normalise(b.gain_db, profile.gain_scaling) })
      if (profile.offsets.q != null && profile.q_scaling) {
        out.push({ index: base + profile.offsets.q, value: normalise(b.q, profile.q_scaling) })
      }
    } else {
      // Empty this RTM-reserved slot. Setting Used=0 hides the dot
      // on plugins that gate visibility on Used (Pro-Q, Kirchhoff);
      // setting Enabled=0 also kills any audio contribution if Used
      // is sticky. We write Enabled first so the audio cuts before
      // the visual disappears (no half-second blip of unwanted EQ).
      if (profile.offsets.enabled != null) {
        out.push({ index: base + profile.offsets.enabled, value: 0 })
      }
      if (profile.offsets.used != null) {
        out.push({ index: base + profile.offsets.used, value: 0 })
      }
    }
  }
  return out
}

function graphicUpdates (profile: GraphicProfile, bands: RtmBand[]): ParameterUpdate[] {
  // For each RTM band, find the plugin's nearest fixed-frequency
  // band, and write its gain. Q is ignored; graphic EQs are fixed-Q.
  // If multiple RTM bands map to the same plugin band, the LAST
  // write wins (we don't sum) — typically fine since RTM's 9 bands
  // are spread far enough apart (Sub..Air spans 20Hz..16kHz) that
  // collisions on a 31-band ISO grid are rare.
  const out: ParameterUpdate[] = []
  // Emit init_writes first so band-selector params (Maag's Air Band)
  // get set to the right freq before the gain pass lands.
  if (profile.init_writes) {
    for (const w of profile.init_writes) out.push(w)
  }
  for (const b of bands) {
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < profile.bands.length; i++) {
      // Compare in log space — perceptually meaningful for audio.
      const d = Math.abs(Math.log10(profile.bands[i].freq_hz) - Math.log10(b.freq_hz))
      if (d < bestDist) { bestDist = d; bestIdx = i }
    }
    // We push the param-name → resolution to the caller (handler in
    // main.ts) since we only have indices after host.list_parameters.
    // Encode the chosen plugin-band index in a separate helper return.
    out.push({ index: -1 - bestIdx, value: normalise(b.gain_db, profile.gain_scaling) })
  }
  return out
}

/**
 * Resolve negative "plugin-band index" markers from graphicUpdates
 * into real parameter indices, given the loaded plugin's full
 * parameter list. Called from the IPC handler after a list_parameters
 * round-trip. Returns the same updates shape but with real indices.
 */
export function resolveGraphicIndices (
  profile: GraphicProfile,
  paramListByName: Map<string, number>,
  marked: ParameterUpdate[],
): ParameterUpdate[] {
  return marked.map(u => {
    if (u.index >= 0) return u  // already resolved
    const bandIdx = -(u.index + 1)
    const paramName = profile.bands[bandIdx]?.name
    if (!paramName) return u
    const realIdx = paramListByName.get(paramName)
    if (realIdx == null) return u
    return { index: realIdx, value: u.value }
  }).filter(u => u.index >= 0)
}
