import React, { useState } from 'react'
import { METRIC_EXPLAINERS, type MetricExplainerContent } from './METRIC_EXPLAINERS'

// ─── Category mapping ────────────────────────────────────────────────────────

type Category =
  | 'Loudness'
  | 'Dynamics'
  | 'Tonal'
  | 'Stereo'
  | 'Quality'

const CATEGORY_ORDER: Category[] = ['Loudness', 'Dynamics', 'Tonal', 'Stereo', 'Quality']

const METRIC_CATEGORY: Record<string, Category> = {
  lufs_i:            'Loudness',
  true_peak:         'Loudness',
  lra:               'Loudness',
  loudness_diff:     'Loudness',
  plr:               'Loudness',
  streaming_platform:'Loudness',
  dialog_gate:       'Loudness',

  dynamic_range:     'Dynamics',
  crest_factor:      'Dynamics',
  plr_plausibility:  'Dynamics',
  transient_density: 'Dynamics',
  transient_integrity:'Dynamics',
  dither_applied:    'Dynamics',
  noise_floor:       'Dynamics',

  tonal_deviation:   'Tonal',
  masking_overlap:   'Tonal',
  eq_match_band:     'Tonal',

  stereo_width:      'Stereo',
  mono_compat:       'Stereo',
  mono_compat_pct:   'Stereo',
  center_fill_ms:    'Stereo',
  broadband_gain:    'Stereo',

  distortion:        'Quality',
  click_count:       'Quality',
  limiter_artefacts: 'Quality',
  hum_severity:      'Quality',
  generation_loss:   'Quality',
  visqol_mos:        'Quality',
  lra_delta:         'Quality',
}

// ─── Entry type with key attached ────────────────────────────────────────────

interface MetricEntry extends MetricExplainerContent {
  key: string
}

const ALL_ENTRIES: MetricEntry[] = Object.entries(METRIC_EXPLAINERS).map(
  ([key, content]) => ({ key, ...content })
)

// ─── Design tokens ────────────────────────────────────────────────────────────

const GOLD       = 'rgba(208,176,102,0.9)'
const GOLD_DIM   = 'rgba(208,176,102,0.55)'
const MUTED      = 'var(--color-text-muted)'
const SAND_200   = 'var(--color-sand-200)'
const SAND_400   = 'var(--color-sand-400)'

// ─── MetricCard ───────────────────────────────────────────────────────────────

interface MetricCardProps {
  entry: MetricEntry
  expanded: boolean
  onToggle: (key: string | null) => void
}

function MetricCard({ entry, expanded, onToggle }: MetricCardProps) {
  const handleClick = () => onToggle(expanded ? null : entry.key)

  return (
    <div
      style={{
        border: '1px solid rgba(168,161,150,0.15)',
        backgroundColor: expanded ? 'rgba(32,29,26,0.9)' : 'rgba(32,29,26,0.6)',
        borderRadius: 2,
        padding: '8px 10px',
        cursor: 'pointer',
        transition: 'background-color 0.12s ease',
      }}
      onClick={handleClick}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          fontSize: 9,
          color: MUTED,
          lineHeight: 1,
          flexShrink: 0,
          marginRight: 2,
          userSelect: 'none',
        }}>
          {expanded ? '▾' : '▸'}
        </span>

        <span style={{
          fontWeight: 600,
          fontSize: 12,
          color: GOLD,
          letterSpacing: '0.04em',
          flexShrink: 0,
        }}>
          {entry.metric}
        </span>

        {entry.unit && (
          <span style={{ fontSize: 10, color: MUTED, flexShrink: 0 }}>
            {entry.unit}
          </span>
        )}

        <span style={{
          fontSize: 11,
          color: SAND_400,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: expanded ? 'normal' : 'nowrap',
          flex: 1,
        }}>
          {entry.oneLiner}
        </span>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* Full name */}
          <div style={{ fontSize: 11, color: SAND_200, fontWeight: 500 }}>
            {entry.fullName}
          </div>

          {/* Why it matters */}
          <div style={{
            fontSize: 11,
            color: SAND_400,
            fontStyle: 'italic',
            lineHeight: 1.55,
            borderLeft: `2px solid rgba(168,161,150,0.18)`,
            paddingLeft: 8,
          }}>
            {entry.why}
          </div>

          {/* Range chip */}
          {entry.range && (
            <div style={{
              display: 'inline-block',
              fontSize: 10,
              color: MUTED,
              backgroundColor: 'rgba(168,161,150,0.08)',
              border: '1px solid rgba(168,161,150,0.14)',
              borderRadius: 2,
              padding: '3px 7px',
              lineHeight: 1.4,
            }}>
              <span style={{ color: SAND_400, fontWeight: 500 }}>Range: </span>{entry.range}
            </div>
          )}

          {/* Too High / Too Low */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {entry.tooHigh && (
              <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.45 }}>
                <span style={{ color: 'rgba(208,120,80,0.85)', fontWeight: 600 }}>↑ Too high: </span>
                {entry.tooHigh}
              </div>
            )}
            {entry.tooLow && (
              <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.45 }}>
                <span style={{ color: 'rgba(100,170,200,0.85)', fontWeight: 600 }}>↓ Too low: </span>
                {entry.tooLow}
              </div>
            )}
          </div>

          {/* Pro tip */}
          {entry.proTip && (
            <div style={{
              fontSize: 10,
              color: GOLD_DIM,
              lineHeight: 1.5,
              borderTop: '1px solid rgba(208,176,102,0.12)',
              paddingTop: 6,
              marginTop: 2,
            }}>
              <span style={{ fontWeight: 600, color: GOLD }}>Pro tip: </span>
              {entry.proTip}
            </div>
          )}

          {/* Standard footnote */}
          {entry.standard && (
            <div style={{ fontSize: 9, color: MUTED, letterSpacing: '0.05em', marginTop: 2 }}>
              Standard: {entry.standard}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── GlossaryBrowser ─────────────────────────────────────────────────────────

export function GlossaryBrowser() {
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const q = searchQuery.trim().toLowerCase()

  const filteredEntries: MetricEntry[] = q
    ? ALL_ENTRIES.filter(e =>
        [e.metric, e.fullName, e.oneLiner, e.unit, e.why].some(
          field => field?.toLowerCase().includes(q)
        )
      )
    : ALL_ENTRIES

  const handleToggle = (key: string | null) => setExpandedKey(key)

  return (
    <div>
      {/* Search bar */}
      <input
        placeholder="Search metrics…"
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        style={{
          width: '100%',
          padding: '6px 10px',
          fontSize: 11,
          backgroundColor: 'rgba(48,44,39,0.6)',
          border: '1px solid rgba(168,161,150,0.2)',
          color: 'var(--color-sand-200)',
          borderRadius: 2,
          outline: 'none',
          marginBottom: 12,
          boxSizing: 'border-box',
          fontFamily: 'var(--font-sans)',
        }}
      />

      {/* Flat list when searching */}
      {q ? (
        filteredEntries.length === 0 ? (
          <div style={{ fontSize: 11, color: MUTED, padding: '8px 0' }}>
            No metrics match "{searchQuery}"
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filteredEntries.map(entry => (
              <MetricCard
                key={entry.key}
                entry={entry}
                expanded={expandedKey === entry.key}
                onToggle={handleToggle}
              />
            ))}
          </div>
        )
      ) : (
        /* Grouped by category */
        CATEGORY_ORDER.map(category => {
          const metricsInCategory = filteredEntries.filter(
            e => METRIC_CATEGORY[e.key] === category
          )
          if (metricsInCategory.length === 0) return null
          return (
            <div key={category} style={{ marginBottom: 16 }}>
              <div style={{
                fontSize: 9,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: MUTED,
                marginBottom: 6,
                fontFamily: 'var(--font-sans)',
                fontWeight: 500,
              }}>
                {category}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {metricsInCategory.map(entry => (
                  <MetricCard
                    key={entry.key}
                    entry={entry}
                    expanded={expandedKey === entry.key}
                    onToggle={handleToggle}
                  />
                ))}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

export default GlossaryBrowser
