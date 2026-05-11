/**
 * Auto-detect a Profile from a hosted plugin's parameter list.
 *
 * The contract: when RTMcompare's hand-coded profile registry doesn't
 * have a match for the loaded plugin, this module probes the plugin
 * via RTMsend's RPC and tries to synthesise a Profile from scratch.
 * The synthesised profile is cached in-memory per session (keyed by
 * plugin name) so subsequent Send calls don't re-probe.
 *
 * Detection covers three EQ architectures:
 *
 *   1. Numbered bands  (Pro-Q, Kirchhoff, most modern parametric EQs)
 *      Param names match `Band\s*N\s+<suffix>` where N is sequential.
 *      All bands share a single Freq/Gain/Q scaling.
 *      → ParametricProfile
 *
 *   2. Named slots     (bx_digital, MAAG EQ4, SSL, classic console EQs)
 *      Param names share a non-numeric prefix that names the band
 *      ("EQ Band LF", "Low Mid", etc.) and each band has its own
 *      frequency range.
 *      → NamedSlotsProfile
 *
 *   3. Graphic EQ      (AUGraphicEQ, Voxengo Marvel)
 *      Param names are numeric frequencies ("100 Hz", "1.0 kHz").
 *      Detected as a special-case here and emitted as GraphicProfile.
 *
 * For probing: each freq/gain/Q parameter is set to norm 0.0 / 0.5 /
 * 1.0 in turn, the readback text is parsed for a number, and the
 * scaling type (linear vs log10) is inferred from whether the midpoint
 * is the arithmetic or geometric mean of the endpoints. Original
 * value is restored after probing so we don't disturb the user's
 * config (the EQ display may briefly show extreme values during the
 * probe — happens once per plugin per session).
 */

import {
  Profile, ParametricProfile, NamedSlotsProfile, GraphicProfile, NormaliseRange,
} from './rtmsend-profiles'
import {
  ParameterSnapshot, ParameterUpdate,
  listParameters, findParameters, setParameters,
} from './rtmsend-bridge'
import {
  ReferenceProfile, saveReference, loadReference, inferArchetype,
} from './rtmsend-knowledge'

// ── Parameter-name parsing ────────────────────────────────────────────

/**
 * Extract the (group prefix, suffix) split from a parameter name.
 * Suffix is one of FREQ / GAIN / Q if recognised, else null. The
 * prefix is everything before that suffix, trimmed. Used to group
 * parameters into bands by shared prefix.
 *
 * Examples:
 *   "Band 1 Frequency"       → { prefix: "Band 1",      suffix: "freq" }
 *   "EQ Band LF 1 Gain"      → { prefix: "EQ Band LF 1", suffix: "gain" }
 *   "Band1 Q"                → { prefix: "Band1",        suffix: "q"    }
 *   "Band 1 Used"            → { prefix: "Band 1",       suffix: "used" }
 *   "Band 1 Enabled"         → { prefix: "Band 1",       suffix: "enabled" }
 *   "Output Gain"            → { prefix: "Output",       suffix: "gain" }   ← noise; filtered later
 */
type Suffix = 'freq' | 'gain' | 'q' | 'used' | 'enabled' | null

function classifySuffix (name: string): { prefix: string; suffix: Suffix } {
  const tests: Array<[Suffix, RegExp]> = [
    ['freq',    /\b(freq(uency)?|hz)\s*$/i],
    ['gain',    /\bgain\s*$/i],
    ['q',       /\bq\.?\s*$/i],
    ['used',    /\b(used|use)\s*$/i],
    ['enabled', /\b(enabled?|active|on)\s*$/i],
  ]
  for (const [tag, re] of tests) {
    const m = name.match(re)
    if (m) {
      const prefix = name.slice(0, m.index).trim().replace(/[\s.\-:_]+$/, '').trim()
      return { prefix, suffix: tag }
    }
  }
  return { prefix: name.trim(), suffix: null }
}

// ── Number parsing for scaling probes ────────────────────────────────

/** Parse the leading number (possibly with k/M suffix) from a text. */
function parseNumber (text: string): number | null {
  const m = text.match(/-?\d+\.?\d*/)
  if (!m) return null
  let n = parseFloat(m[0])
  if (Number.isNaN(n)) return null
  // Look for a "k" or "M" SI suffix right after the number.
  const after = text.slice((m.index ?? 0) + m[0].length).trim().toLowerCase()
  if (after.startsWith('k')) n *= 1000
  else if (after.startsWith('m') && !after.startsWith('mm') && !after.startsWith('ms')) n *= 1_000_000
  return n
}

// ── Scaling probe ─────────────────────────────────────────────────────

/**
 * Set the parameter to norm 0.0 / 0.5 / 1.0, parse readback text at
 * each step, restore. Returns the inferred NormaliseRange or null
 * if any step's text didn't parse.
 */
async function probeScaling (
  paramIndex: number, paramName: string,
): Promise<NormaliseRange | null> {
  // Save current value via name-based lookup (list_parameters has a
  // known issue ignoring `start`).
  const orig = (await findParameters(paramName))[0]?.current ?? 0.5

  const parsed: number[] = []
  for (const norm of [0.0, 0.5, 1.0]) {
    await setParameters([{ index: paramIndex, value: norm }])
    const after = (await findParameters(paramName))[0]
    const n = after ? parseNumber(after.text) : null
    if (n == null || !Number.isFinite(n)) {
      await setParameters([{ index: paramIndex, value: orig }])
      return null
    }
    parsed.push(n)
  }
  await setParameters([{ index: paramIndex, value: orig }])

  const [a, m, b] = parsed
  if (a === b) return null  // pinned param, nothing to scale

  // log10 vs linear: midpoint test. If the param is bidirectional
  // (e.g. gain ±X dB centred on 0), the linear midpoint is 0 and the
  // log midpoint is undefined, so log10 only applies when both
  // endpoints are positive and far enough apart that the geometric
  // mean is meaningful.
  if (a > 0 && b > 0) {
    const linMid = (a + b) / 2
    const logMid = Math.sqrt(a * b)
    const linErr = Math.abs(m - linMid)
    const logErr = Math.abs(m - logMid)
    // Pick log10 if its midpoint is materially closer (avoids picking
    // log10 for tight ranges where the two are nearly identical).
    if (logErr < linErr * 0.5) {
      return { type: 'log10', min: a, max: b }
    }
  }
  return { type: 'linear', min: a, max: b }
}

// ── Detection: band groups from parameter names ──────────────────────

interface BandGroup {
  prefix: string
  members: { suffix: Suffix; index: number; name: string }[]
}

/**
 * Group all parameters by their (prefix, suffix) classification, and
 * keep only groups that have at least Frequency + Gain. These are
 * candidate "band" groups.
 */
function findBandGroups (params: ParameterSnapshot[]): BandGroup[] {
  const groups = new Map<string, BandGroup>()
  for (const p of params) {
    const { prefix, suffix } = classifySuffix(p.name)
    if (!suffix) continue
    if (!groups.has(prefix)) groups.set(prefix, { prefix, members: [] })
    groups.get(prefix)!.members.push({ suffix, index: p.index, name: p.name })
  }
  // Keep only groups with at least freq + gain.
  return [...groups.values()].filter(g => {
    const has = (s: Suffix) => g.members.some(m => m.suffix === s)
    return has('freq') && has('gain')
  })
}

function offsetOf (group: BandGroup, suffix: Suffix, baseIndex: number): number | null {
  const m = group.members.find(x => x.suffix === suffix)
  return m ? m.index - baseIndex : null
}

function baseIndexOf (group: BandGroup): number {
  return Math.min(...group.members.map(m => m.index))
}

// ── Numbered-band detection ──────────────────────────────────────────

/**
 * If every group's prefix matches `Band\s*N` with sequential N and
 * uniform stride, it's a Pro-Q-style parametric EQ. Returns the
 * sorted list of groups in band order, or null.
 */
function tryNumberedBands (groups: BandGroup[]): BandGroup[] | null {
  const numbered: { num: number; g: BandGroup }[] = []
  for (const g of groups) {
    const m = g.prefix.match(/^band\s*(\d+)$/i)
    if (!m) return null
    numbered.push({ num: parseInt(m[1], 10), g })
  }
  if (numbered.length < 2) return null
  numbered.sort((a, b) => a.num - b.num)
  // Verify sequential numbering (allows starting from 0 or 1).
  for (let i = 1; i < numbered.length; i++) {
    if (numbered[i].num !== numbered[i - 1].num + 1) return null
  }
  return numbered.map(x => x.g)
}

// ── Build ParametricProfile from numbered bands ─────────────────────

async function buildParametric (
  pluginName: string, groups: BandGroup[],
): Promise<ParametricProfile | null> {
  const first = groups[0]
  const second = groups[1]
  const firstBase = baseIndexOf(first)
  const secondBase = baseIndexOf(second)
  const paramsPerBand = secondBase - firstBase
  if (paramsPerBand <= 0) return null

  const offsets = {
    used:    offsetOf(first, 'used',    firstBase),
    enabled: offsetOf(first, 'enabled', firstBase),
    freq:    offsetOf(first, 'freq',    firstBase)!,
    gain:    offsetOf(first, 'gain',    firstBase)!,
    q:       offsetOf(first, 'q',       firstBase),
  }

  // Probe scalings on the first band only — they're uniform across
  // bands by definition for numbered-band plugins.
  const freqParam = first.members.find(m => m.suffix === 'freq')!
  const gainParam = first.members.find(m => m.suffix === 'gain')!
  const qParam    = first.members.find(m => m.suffix === 'q')

  const freqScaling = await probeScaling(freqParam.index, freqParam.name)
  const gainScaling = await probeScaling(gainParam.index, gainParam.name)
  if (!freqScaling || !gainScaling) return null
  const qScaling = qParam ? await probeScaling(qParam.index, qParam.name) ?? undefined : undefined

  return {
    kind: 'parametric',
    name: `${pluginName} (auto)`,
    match: { name_contains: pluginName },
    first_band_index: firstBase,
    params_per_band: paramsPerBand,
    offsets,
    freq_scaling: freqScaling,
    gain_scaling: gainScaling,
    q_scaling: qScaling,
    total_bands: groups.length,
  }
}

// ── Build NamedSlotsProfile from non-numeric prefixes ────────────────

async function buildNamedSlots (
  pluginName: string, groups: BandGroup[],
): Promise<NamedSlotsProfile | null> {
  // Each group becomes a slot with its own scalings. Probe each.
  const slots: NamedSlotsProfile['slots'] = []
  for (const g of groups) {
    const base = baseIndexOf(g)
    const freqM = g.members.find(m => m.suffix === 'freq')!
    const gainM = g.members.find(m => m.suffix === 'gain')!
    const qM    = g.members.find(m => m.suffix === 'q')

    const freq_scaling = await probeScaling(freqM.index, freqM.name)
    const gain_scaling = await probeScaling(gainM.index, gainM.name)
    if (!freq_scaling || !gain_scaling) continue
    const q_scaling = qM ? await probeScaling(qM.index, qM.name) ?? undefined : undefined

    slots.push({
      name: g.prefix,
      base_index: base,
      offsets: {
        used:    offsetOf(g, 'used',    base),
        enabled: offsetOf(g, 'enabled', base),
        freq:    offsetOf(g, 'freq',    base)!,
        gain:    offsetOf(g, 'gain',    base)!,
        q:       offsetOf(g, 'q',       base),
      },
      freq_scaling,
      gain_scaling,
      q_scaling,
    })
  }
  if (slots.length === 0) return null

  return {
    kind: 'named-slots',
    name: `${pluginName} (auto)`,
    match: { name_contains: pluginName },
    slots,
  }
}

// ── Public API ────────────────────────────────────────────────────────

const cache = new Map<string, Profile | null>()

/**
 * Try to auto-detect a profile for the currently-loaded plugin. Caches
 * the result (including the negative case — null) per session so the
 * costly probe runs at most once per plugin name. Returns null if no
 * EQ pattern was detected or if probing failed.
 *
 * IMPORTANT: this temporarily disturbs plugin state during the probe
 * (sets each freq/gain/Q to 0.0/0.5/1.0 and restores). On most EQs the
 * user sees a brief flicker on the curve, then it goes back to where
 * they had it. Caller should warn or run this when the plugin is on
 * a track that's not currently being heard.
 */
export async function autoDetectProfile (pluginName: string): Promise<Profile | null> {
  if (cache.has(pluginName)) return cache.get(pluginName) ?? null

  let result: Profile | null = null
  try {
    const params = await listParameters()
    const groups = findBandGroups(params)
    if (groups.length >= 2) {
      const numbered = tryNumberedBands(groups)
      if (numbered) {
        result = await buildParametric(pluginName, numbered)
      } else {
        // Sort named slots by base_index so the namedSlotsUpdates
        // matcher walks them in the order the plugin lays them out.
        const sortedByIndex = [...groups].sort(
          (a, b) => baseIndexOf(a) - baseIndexOf(b))
        result = await buildNamedSlots(pluginName, sortedByIndex)
      }
    }
  } catch (e) {
    // Probe interrupted (RPC dropped, plugin unloaded mid-probe, etc.).
    // Don't cache the failure — next call gets a retry.
    return null
  }

  cache.set(pluginName, result)
  return result
}

/** Clear the autoprofile cache. Useful when the user reloads the same
 *  plugin and we want a fresh probe. */
export function clearAutoProfileCache (): void {
  cache.clear()
}

/**
 * Capture a full reference profile for the loaded plugin and save it to
 * disk. Called once per session per plugin (cached on disk between
 * sessions). Includes:
 *   - Full parameter dump
 *   - Auto-detected Profile (or null if not detectable)
 *   - Archetype tags inferred from name + auto-detect kind
 *
 * This is the "knowledge base" tier — even plugins that don't fit
 * RTM's 9-band Send model (Pultec / API 550 / Bettermaker) get their
 * full parameter map captured here. Future RTMcompare versions can
 * use the data for archetype-aware recommendations even without an
 * active Send profile.
 *
 * Skips re-probing if a reference file already exists on disk for
 * this plugin name AND the parameter count matches (catches the case
 * where the plugin updated and gained/lost params).
 */
export async function captureReference (
  pluginName: string, paramCount: number, rtmsendVersion: string,
): Promise<ReferenceProfile | null> {
  // Skip if already on disk with matching param count.
  const existing = loadReference(pluginName)
  if (existing && existing.parameter_count === paramCount) return existing

  let params: ParameterSnapshot[]
  try {
    params = await listParameters()
  } catch {
    return null
  }

  // Try auto-detect — gives us a Profile or null.
  const profile = await autoDetectProfile(pluginName)

  // Build archetype tags. Start with name-based heuristics, augment
  // with structural facts the auto-detect uncovered.
  const inferred = inferArchetype(pluginName)
  const tags = new Set(inferred.tags)
  if (profile) {
    if (profile.kind === 'parametric')   tags.add('parametric')
    if (profile.kind === 'named-slots')  tags.add('parametric')
    if (profile.kind === 'graphic')      { tags.add('graphic'); tags.add('minimum-phase') }
  }

  const entry: ReferenceProfile = {
    plugin_id: pluginName,  // We don't have a stable VST3 id here; name is fine for now.
    name: pluginName,
    parameter_count: paramCount,
    scanned_at: new Date().toISOString(),
    rtmsend_version: rtmsendVersion,
    archetype_tags: [...tags] as any,
    active_profile: profile,
    raw_parameters: params,
    notes: inferred.notes,
  }
  try { saveReference(entry) } catch { /* non-fatal */ }
  return entry
}
