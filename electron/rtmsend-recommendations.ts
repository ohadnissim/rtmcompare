/**
 * Recommendation engine — given an EQ move and the set of plugins the
 * user has, rank the plugins by how well-suited each one is to that
 * specific move.
 *
 * Approach: classify the move ("warm low-end boost", "surgical mid
 * cut", "air-band shimmer", etc.) → required tag set → score each
 * plugin by how many of its archetype tags match the requirement.
 *
 * Intentionally heuristic, not ML/AI. The taxonomy is small enough
 * that hand-coded scoring rules work well and are debuggable.
 */

import { ArchetypeTag, RecommendationReason, ReferenceProfile } from './rtmsend-knowledge'
import { RtmBand } from './rtmsend-profiles'

// ── Move classification ──────────────────────────────────────────────

/**
 * Categorise a single RTM band into the kind of mastering MOVE it
 * represents. Drives which plugin character is preferred.
 */
type MoveCategory =
  | 'warm-lf-boost'        // Sub/Bass boost — vintage character flatters
  | 'mono-lf-discipline'   // Sub/Bass cut or mono-fy — surgical wins
  | 'mud-cut'              // 200-500 Hz cut — surgical, narrow Q
  | 'body-shaping'         // 500-1500 Hz adjustment — anything works
  | 'midrange-character'   // 1500-3000 Hz — console strip wins
  | 'presence-shaping'     // 3000-6000 Hz — surgical for cuts, console for boosts
  | 'harshness-tame'       // 2000-5000 Hz cut — surgical wins
  | 'air-shimmer'          // 8 kHz+ boost — air-band tag wins
  | 'surgical-cut'         // Any narrow cut (Q > 4) — parametric/mastering-grade
  | 'broadstroke'          // Wide Q boost/cut — vintage or parametric

export function classifyMove (band: RtmBand): MoveCategory {
  const f = band.freq_hz
  const g = band.gain_db
  const q = band.q ?? 1.0
  const isCut = g < -0.3
  const isBoost = g > 0.3

  if (q > 4) return 'surgical-cut'

  if (f < 80) {
    return isCut ? 'mono-lf-discipline' : 'warm-lf-boost'
  }
  if (f < 250) {
    return isCut ? 'mono-lf-discipline' : 'warm-lf-boost'
  }
  if (f >= 200 && f < 500 && isCut) return 'mud-cut'
  if (f >= 500 && f < 1500) return 'body-shaping'
  if (f >= 1500 && f < 3000) return 'midrange-character'
  if (f >= 2000 && f < 5000 && isCut) return 'harshness-tame'
  if (f >= 3000 && f < 6000) return 'presence-shaping'
  if (f >= 8000) return 'air-shimmer'
  return 'broadstroke'
}

// ── Tag scoring per move category ────────────────────────────────────

/**
 * For each move category, what tags should boost / penalize a plugin's
 * fitness score. Higher weight = stronger preference. Negative weight
 * = penalty (e.g., a vintage console for a surgical cut is wrong).
 */
const TAG_WEIGHTS: Record<MoveCategory, Partial<Record<ArchetypeTag, number>>> = {
  'warm-lf-boost': {
    'vintage': 1.0,
    'console-strip': 0.8,
    'pultec': 1.2,           // Pultec is the gold standard for warm LF
    'parametric': 0.3,
    'transparent': -0.3,     // Flat parametric misses the magic
    'graphic': -0.5,
  },
  'mono-lf-discipline': {
    'mid-side': 1.0,         // M/S enables the side-LF cut
    'parametric': 0.7,
    'mastering-grade': 0.6,
    'linear-phase': 0.4,     // Phase-coherent LF treatment matters
    'pultec': -0.2,
    'vintage': -0.2,
  },
  'mud-cut': {
    'parametric': 1.0,
    'mastering-grade': 0.7,
    'transparent': 0.6,
    'dynamic': 0.5,          // Dynamic can be more musical than static cut
    'console-strip': 0.2,
    'pultec': -0.5,          // Wrong tool — fixed freqs don't hit mud
  },
  'body-shaping': {
    'parametric': 0.7,
    'console-strip': 0.6,
    'vintage': 0.4,
    'mastering-grade': 0.5,
  },
  'midrange-character': {
    'console-strip': 1.0,    // Neve/SSL midrange is the trope
    'vintage': 0.8,
    'parametric': 0.5,
    'transparent': -0.2,
  },
  'presence-shaping': {
    'parametric': 0.7,
    'console-strip': 0.5,
    'air-band': 0.4,
    'mastering-grade': 0.6,
  },
  'harshness-tame': {
    'parametric': 1.0,
    'mastering-grade': 0.8,
    'dynamic': 0.9,          // De-essers / dynamic EQs shine here
    'transparent': 0.6,
    'pultec': -0.5,
  },
  'air-shimmer': {
    'air-band': 1.5,         // Maag, Slate Air, NLS Air
    'console-strip': 0.5,    // Some console strips have nice air shelves
    'vintage': 0.4,
    'parametric': 0.6,
    'mastering-grade': 0.5,
    'pultec': 0.7,           // Pultec HF shelf is famous
  },
  'surgical-cut': {
    'parametric': 1.2,
    'mastering-grade': 1.0,
    'transparent': 0.8,
    'linear-phase': 0.4,
    'dynamic': 0.5,
    'console-strip': -0.5,   // Wrong tool — broad bands
    'pultec': -0.8,          // Wrong tool — no narrow Q
    'graphic': -0.6,
  },
  'broadstroke': {
    'parametric': 0.5,
    'console-strip': 0.6,
    'vintage': 0.4,
    'tilt': 0.5,
  },
}

// ── Public scoring functions ─────────────────────────────────────────

/**
 * Score a single plugin's fitness for a single move. Sum of tag
 * weights for tags the plugin has, penalties for tags listed with
 * negative weight that the plugin has too. Range is approximately
 * -1 to +2; we clamp to [0, 1] for display by adding 0.5 then
 * clamping.
 */
function scorePluginForMove (tags: ArchetypeTag[], move: MoveCategory): number {
  const weights = TAG_WEIGHTS[move]
  let raw = 0
  for (const tag of tags) {
    raw += weights[tag] ?? 0
  }
  // Map [-2, +2] → [0, 1] approximately. Anything > 1 raw caps to 1.
  return Math.max(0, Math.min(1, (raw + 1.0) / 2.5))
}

/**
 * Generate human-readable reasoning. Surfaces the strongest tag match
 * so the user understands WHY this plugin won. Reasoning is one
 * short sentence designed to be shown in a tooltip / status pill.
 */
function reasoningFor (
  pluginName: string, tags: ArchetypeTag[], move: MoveCategory,
): string {
  const weights = TAG_WEIGHTS[move]
  const positive = tags
    .map(t => ({ t, w: weights[t] ?? 0 }))
    .filter(x => x.w > 0)
    .sort((a, b) => b.w - a.w)

  if (positive.length === 0) return `${pluginName} can apply this move (no special character match)`

  const top = positive[0].t
  const phrase: Partial<Record<ArchetypeTag, string>> = {
    'pultec': 'Pultec-style boost flatters this frequency',
    'vintage': 'analog character suits this move',
    'console-strip': 'console midrange character',
    'parametric': 'precise parametric control',
    'mastering-grade': 'mastering-grade transparency',
    'transparent': 'clean, surgical cut/boost',
    'air-band': 'specialty air-band treatment',
    'dynamic': 'dynamic EQ tames it musically',
    'mid-side': 'M/S routing enables the move',
    'linear-phase': 'phase-coherent for mastering',
    'graphic': 'fixed-frequency control',
    'tilt': 'tilt-style tonal shift',
    'spline': 'spline EQ curve drawing',
    'minimum-phase': 'standard minimum-phase response',
    'mixing': 'better suited for mixing',
    'high-pass': 'high-pass specialty',
    'low-pass': 'low-pass specialty',
  }
  return `${pluginName}: ${phrase[top] ?? top}`
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Rank the user's available plugins by suitability for a single move.
 * Returns sorted descending by score. Plugins with score < 0.3 are
 * dropped (they're poor fits — don't show as recommendations).
 */
export function rankPluginsForMove (
  band: RtmBand,
  available: { name: string; archetype_tags: ArchetypeTag[] }[],
): RecommendationReason[] {
  const move = classifyMove(band)
  const ranked = available
    .map(p => {
      const score = scorePluginForMove(p.archetype_tags, move)
      return {
        plugin_name: p.name,
        score,
        reasoning: reasoningFor(p.name, p.archetype_tags, move),
      }
    })
    .filter(r => r.score >= 0.3)
    .sort((a, b) => b.score - a.score)
  return ranked
}

/**
 * Convenience: for an entire band recommendation set, return a per-band
 * ranking. Used by RTMcompare's "best plugin for this move" UI to show
 * a different plugin suggestion per band if the user wants.
 */
export function rankPluginsForBands (
  bands: RtmBand[],
  available: { name: string; archetype_tags: ArchetypeTag[] }[],
): { band: RtmBand; recommendations: RecommendationReason[] }[] {
  return bands.map(b => ({ band: b, recommendations: rankPluginsForMove(b, available) }))
}

/**
 * Best single plugin overall — picks the plugin that scores highest
 * averaged across all bands in the recommendation. Use for the simple
 * "open this plugin" suggestion in the UI.
 */
export function bestOverallPlugin (
  bands: RtmBand[],
  available: { name: string; archetype_tags: ArchetypeTag[] }[],
): RecommendationReason | null {
  const totals = new Map<string, { score: number; tags: ArchetypeTag[] }>()
  for (const p of available) totals.set(p.name, { score: 0, tags: p.archetype_tags })
  for (const b of bands) {
    const move = classifyMove(b)
    for (const p of available) {
      const t = totals.get(p.name)!
      t.score += scorePluginForMove(p.archetype_tags, move)
    }
  }
  const sorted = [...totals.entries()].sort((a, b) => b[1].score - a[1].score)
  if (sorted.length === 0 || sorted[0][1].score === 0) return null
  const [name, { score, tags }] = sorted[0]
  // Use the highest-band move category to surface a reason.
  const moves = bands.map(classifyMove)
  const dominantMove = moves[0]
  return {
    plugin_name: name,
    score: Math.min(1, score / bands.length),
    reasoning: reasoningFor(name, tags, dominantMove),
  }
}
