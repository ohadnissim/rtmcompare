import React, { useMemo, useState } from 'react'
import { ProfileInfo } from './ProfileDropdown'
import { GenreProfile, GenreAnalysisResult, computeGenreAnalysis, RadarAxis, BAND_FREQS } from '../lib/genreAnalysis'

interface Props {
  spectrumB: number[]     // 31-band file spectrum from analysis result
  profiles: ProfileInfo[] // all profiles (filtered to genre in component)
  /** Pre-loaded profile JSON data, keyed by profile id */
  profileData: Record<string, GenreProfile>
  onRequestProfile?: (id: string) => void
  /** The genre id that should be pre-selected (from localStorage default). */
  defaultGenreId?: string
  /** Called when the user marks a genre as their default. */
  onDefaultChange?: (id: string) => void
}

// ── Radar chart (SVG spider) ──────────────────────────────────────────────────

const RADAR_SIZE = 180
const RADAR_CX = RADAR_SIZE / 2
const RADAR_CY = RADAR_SIZE / 2
const RADAR_R = 72

function radarPoint(val: number, angleRad: number): [number, number] {
  return [
    RADAR_CX + val * RADAR_R * Math.sin(angleRad),
    RADAR_CY - val * RADAR_R * Math.cos(angleRad),
  ]
}

function RadarChart({ axes }: { axes: RadarAxis[] }) {
  const n = axes.length
  if (n === 0) return null

  const angles = axes.map((_, i) => (2 * Math.PI * i) / n)
  const hasSpread = axes.some(a => a.spreadDb != null)

  const polyPoints = (vals: number[]) =>
    vals.map((v, i) => radarPoint(v, angles[i]).join(',')).join(' ')

  // Confidence band: outer = genreVal + halfSpread, inner = genreVal - halfSpread
  // Rendered as two polygons forming a filled ring between them.
  // We use a clipPath trick: draw outer polygon, then XOR with inner.
  // Simpler: just draw outer at low opacity then inner at bg color opacity.
  const MAX_DB_SCALE = 40 // same as dbToRadar: -20..+20 → 0..1 over 40 dB
  const outerVals = axes.map(a => {
    if (a.spreadDb == null) return a.genreVal
    return Math.min(1, a.genreVal + (a.spreadDb / 2) / MAX_DB_SCALE)
  })
  const innerVals = axes.map(a => {
    if (a.spreadDb == null) return a.genreVal
    return Math.max(0, a.genreVal - (a.spreadDb / 2) / MAX_DB_SCALE)
  })

  // Grid rings at 0.25, 0.5, 0.75, 1.0
  const rings = [0.25, 0.5, 0.75, 1.0]

  return (
    <svg viewBox={`0 0 ${RADAR_SIZE} ${RADAR_SIZE}`} width={RADAR_SIZE} height={RADAR_SIZE}>
      {/* Grid rings */}
      {rings.map(r => (
        <polygon
          key={r}
          points={angles.map(a => radarPoint(r, a).join(',')).join(' ')}
          fill="none"
          stroke="rgba(168,161,150,0.12)"
          strokeWidth={0.8}
        />
      ))}
      {/* Axis spokes */}
      {angles.map((a, i) => {
        const [x, y] = radarPoint(1.0, a)
        return <line key={i} x1={RADAR_CX} y1={RADAR_CY} x2={x} y2={y} stroke="rgba(168,161,150,0.15)" strokeWidth={0.8} />
      })}
      {/* Confidence band (TBC3 spread) — drawn before target polygon */}
      {hasSpread && (
        <>
          {/* Outer boundary */}
          <polygon
            points={polyPoints(outerVals)}
            fill="rgba(208,176,102,0.10)"
            stroke="rgba(208,176,102,0.18)"
            strokeWidth={0.6}
            strokeDasharray="2 2"
            strokeLinejoin="round"
          />
          {/* Inner boundary punches out the centre — draw in app bg color */}
          <polygon
            points={polyPoints(innerVals)}
            fill="rgba(28,26,22,0.85)"
            stroke="rgba(208,176,102,0.18)"
            strokeWidth={0.6}
            strokeDasharray="2 2"
            strokeLinejoin="round"
          />
        </>
      )}
      {/* Genre target polygon */}
      <polygon
        points={polyPoints(axes.map(a => a.genreVal))}
        fill="rgba(208,176,102,0.08)"
        stroke="rgba(208,176,102,0.55)"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      {/* File polygon */}
      <polygon
        points={polyPoints(axes.map(a => a.fileVal))}
        fill="rgba(110,197,119,0.08)"
        stroke="rgba(110,197,119,0.55)"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      {/* File dots — green inside tolerance, orange outside */}
      {axes.map((a, i) => {
        const [x, y] = radarPoint(a.fileVal, angles[i])
        const color = a.withinTolerance === false ? '#e07a4f' : '#6ec577'
        return <circle key={i} cx={x} cy={y} r={2.5} fill={color} />
      })}
      {/* Axis labels */}
      {axes.map((a, i) => {
        const [lx, ly] = radarPoint(1.22, angles[i])
        const anchor =
          lx < RADAR_CX - 4 ? 'end' :
          lx > RADAR_CX + 4 ? 'start' : 'middle'
        return (
          <text
            key={i}
            x={lx} y={ly}
            textAnchor={anchor}
            dominantBaseline="middle"
            fontSize={7.5}
            fill="rgba(168,161,150,0.70)"
            fontFamily="monospace"
          >
            {a.label}
          </text>
        )
      })}
    </svg>
  )
}

// ── EQ Delta bar chart ────────────────────────────────────────────────────────

function DeltaBars({ deltaPerBand, spreadPerBand }: { deltaPerBand: number[]; spreadPerBand?: number[] }) {
  const max = Math.max(...deltaPerBand.map(Math.abs), 3)
  const labels = ['20', '25', '32', '40', '50', '63', '80', '100', '125', '160',
    '200', '250', '315', '400', '500', '630', '800', '1k', '1.25k', '1.6k',
    '2k', '2.5k', '3.15k', '4k', '5k', '6.3k', '8k', '10k', '12.5k', '16k', '20k']

  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-px" style={{ height: 64, minWidth: 280 }}>
        {deltaPerBand.map((d, i) => {
          const pct = Math.abs(d) / max
          const halfSpread = spreadPerBand ? spreadPerBand[i] / 2 : 0
          const withinTol = halfSpread > 0 && Math.abs(d) <= halfSpread
          const isPos = d >= 0
          // Tolerance indicator: a thin horizontal tick at the half-spread height
          const tolPct = spreadPerBand ? Math.min(halfSpread / max, 1) * 50 : 0

          return (
            <div key={i} className="flex flex-col items-center relative" style={{ flex: 1, minWidth: 6, height: '100%' }}
              title={`${BAND_FREQS[i]} Hz: ${d > 0 ? '+' : ''}${d.toFixed(1)} dB${spreadPerBand ? ` (tolerance ±${halfSpread.toFixed(1)} dB)` : ''}`}
            >
              {isPos ? (
                <>
                  <div style={{ flex: 1 }} />
                  <div style={{
                    height: `${pct * 50}%`, width: '100%', minHeight: 1,
                    backgroundColor: withinTol ? 'rgba(168,161,150,0.40)' : 'rgba(224,122,79,0.70)',
                    borderRadius: '1px 1px 0 0',
                  }} />
                  {/* Tolerance tick — upper side */}
                  {tolPct > 0 && <div style={{ position: 'absolute', bottom: `50%`, width: '100%', height: 1, backgroundColor: 'rgba(208,176,102,0.45)', marginBottom: `${tolPct}%` }} />}
                  <div style={{ height: '50%', width: '100%', backgroundColor: 'transparent' }} />
                </>
              ) : (
                <>
                  <div style={{ height: '50%', width: '100%', backgroundColor: 'transparent' }} />
                  {/* Tolerance tick — lower side */}
                  {tolPct > 0 && <div style={{ position: 'absolute', top: `50%`, width: '100%', height: 1, backgroundColor: 'rgba(208,176,102,0.45)', marginTop: `${tolPct}%` }} />}
                  <div style={{
                    height: `${pct * 50}%`, width: '100%', minHeight: 1,
                    backgroundColor: withinTol ? 'rgba(168,161,150,0.40)' : 'rgba(110,197,119,0.70)',
                    borderRadius: '0 0 1px 1px',
                  }} />
                  <div style={{ flex: 1 }} />
                </>
              )}
            </div>
          )
        })}
      </div>
      {/* Zero line */}
      <div className="relative" style={{ height: 1 }}>
        <div className="absolute inset-0" style={{ backgroundColor: 'rgba(168,161,150,0.25)' }} />
      </div>
      {/* Frequency label row — only show every ~4th */}
      <div className="flex gap-px mt-1" style={{ minWidth: 280 }}>
        {labels.map((l, i) => (
          <div key={i} style={{ flex: 1, minWidth: 6 }}>
            {i % 4 === 0 && (
              <span className="block text-center" style={{ fontSize: 6, color: 'rgba(168,161,150,0.45)', transform: 'rotate(-45deg)', transformOrigin: 'left top', whiteSpace: 'nowrap', marginLeft: 2 }}>
                {l}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Match score gauge ─────────────────────────────────────────────────────────

const SCORE_COLORS: Record<string, string> = {
  'Excellent': '#6ec577',
  'Good':      '#d0b066',
  'Fair':      '#e07a4f',
  'Needs work':'#e05a5a',
}

function MatchGauge({ score, label }: { score: number; label: string }) {
  const color = SCORE_COLORS[label] || '#e07a4f'
  return (
    <div className="flex items-center gap-3">
      <div className="relative" style={{ width: 52, height: 52 }}>
        <svg viewBox="0 0 52 52" width={52} height={52}>
          <circle cx={26} cy={26} r={22} fill="none" stroke="rgba(168,161,150,0.12)" strokeWidth={4} />
          <circle
            cx={26} cy={26} r={22}
            fill="none"
            stroke={color}
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 22}`}
            strokeDashoffset={`${2 * Math.PI * 22 * (1 - score / 100)}`}
            transform="rotate(-90 26 26)"
            style={{ transition: 'stroke-dashoffset 0.6s ease' }}
          />
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center text-[13px] font-bold tabular-nums"
          style={{ color }}
        >
          {score}
        </span>
      </div>
      <div>
        <div className="text-[11px] font-medium" style={{ color }}>{label}</div>
        <div className="text-[10px]" style={{ color: 'rgba(168,161,150,0.60)' }}>match score</div>
      </div>
    </div>
  )
}

// ── Genre picker (compact tabs) ───────────────────────────────────────────────

const GENRE_GROUPS: { label: string; ids: string[] }[] = [
  { label: 'All', ids: ['AllPurpose'] },
  { label: 'Hip-Hop', ids: ['HipHop', 'Trap', 'ClassicHipHop'] },
  { label: 'Pop', ids: ['Pop', 'DancePop', 'IndiePop', 'KPopJPop', 'Electropop'] },
  { label: 'Rock', ids: ['Rock', 'IndieRock', 'AltRock', 'ClassicRock', 'PunkRock', 'PostRock', 'Metal'] },
  { label: 'R&B / Jazz', ids: ['RnbSoul', 'Jazz', 'VocalJazz'] },
  { label: 'Electronic', ids: ['EDM', 'House', 'Techno', 'DrumAndBass', 'Dubstep', 'FutureBass', 'Hyperpop'] },
  { label: 'Other', ids: ['Orchestral', 'Ambient', 'Folk', 'Country', 'PopCountry', 'LatinPop', 'Reggaeton', 'Reggae', 'LoFi'] },
]

// ── Main panel ────────────────────────────────────────────────────────────────

export default function GenreAnalysisPanel({ spectrumB, profiles, profileData, onRequestProfile, defaultGenreId, onDefaultChange }: Props) {
  const genreProfiles = profiles.filter(p => p.profile_type === 'genre')
  const fallbackId = genreProfiles.find(p => p.id === 'AllPurpose')?.id ?? genreProfiles[0]?.id ?? ''
  const [selectedId, setSelectedId] = useState<string>(defaultGenreId ?? fallbackId)
  const [groupFilter, setGroupFilter] = useState<string>('All')

  // When defaultGenreId prop changes (e.g. library opens with a saved default), sync selection
  React.useEffect(() => {
    if (defaultGenreId && defaultGenreId !== selectedId) setSelectedId(defaultGenreId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultGenreId])

  const profile = profileData[selectedId] as GenreProfile | undefined

  const result = useMemo<GenreAnalysisResult | null>(() => {
    if (!profile || !spectrumB || spectrumB.length < 31) return null
    return computeGenreAnalysis(spectrumB, profile)
  }, [spectrumB, profile])

  // Filtered genre list for the picker
  const visibleIds = groupFilter === 'All'
    ? genreProfiles.map(p => p.id)
    : GENRE_GROUPS.find(g => g.label === groupFilter)?.ids ?? []

  const visibleProfiles = genreProfiles.filter(p => visibleIds.includes(p.id))

  if (genreProfiles.length === 0) {
    return (
      <div className="text-[11px] py-4 text-center" style={{ color: 'rgba(168,161,150,0.5)' }}>
        No genre profiles available.
      </div>
    )
  }

  // Request missing profile data
  if (!profile && selectedId && onRequestProfile) {
    onRequestProfile(selectedId)
  }

  return (
    <div className="space-y-4">
      {/* Group filter tabs */}
      <div className="flex flex-wrap gap-1">
        {GENRE_GROUPS.map(g => (
          <button
            key={g.label}
            onClick={() => {
              setGroupFilter(g.label)
              // auto-select first genre in group if current not in it
              const ids = g.label === 'All' ? genreProfiles.map(p => p.id) : g.ids
              if (!ids.includes(selectedId)) {
                const first = genreProfiles.find(p => ids.includes(p.id))
                if (first) {
                  setSelectedId(first.id)
                  if (!profileData[first.id]) onRequestProfile?.(first.id)
                }
              }
            }}
            className="text-[10px] px-2 py-0.5 transition-colors"
            style={{
              borderRadius: '2px',
              color: groupFilter === g.label ? '#0e0d0b' : 'var(--color-text-muted)',
              backgroundColor: groupFilter === g.label ? '#d0b066' : 'rgba(168,161,150,0.08)',
              border: `1px solid ${groupFilter === g.label ? '#d0b066' : 'rgba(168,161,150,0.15)'}`,
            }}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Genre pill picker */}
      <div className="flex flex-wrap gap-1.5">
        {visibleProfiles.map(p => (
          <button
            key={p.id}
            onClick={() => {
              setSelectedId(p.id)
              if (!profileData[p.id]) onRequestProfile?.(p.id)
            }}
            className="text-[11px] px-2.5 py-1 transition-all"
            style={{
              borderRadius: '2px',
              color: p.id === selectedId ? 'var(--color-accent)' : 'var(--color-text-primary)',
              backgroundColor: p.id === selectedId ? 'rgba(208,176,102,0.14)' : 'rgba(168,161,150,0.06)',
              border: `1px solid ${p.id === selectedId ? 'rgba(208,176,102,0.50)' : 'rgba(168,161,150,0.15)'}`,
            }}
          >
            {p.name}
          </button>
        ))}
      </div>

      {!result ? (
        <div className="text-[11px] py-4 text-center" style={{ color: 'rgba(168,161,150,0.5)' }}>
          {profile ? 'Computing…' : 'Loading profile data…'}
        </div>
      ) : (
        <>
          {/* Header row: gauge + description */}
          <div className="flex items-start gap-5">
            <MatchGauge score={result.matchScore} label={result.matchLabel} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  {result.genreName}
                </span>
                {onDefaultChange && (
                  <button
                    onClick={() => onDefaultChange(selectedId)}
                    title={selectedId === defaultGenreId ? 'This is your default genre' : 'Set as default genre (remembers across sessions)'}
                    className="text-[11px] transition-opacity"
                    style={{ color: selectedId === defaultGenreId ? 'var(--color-accent)' : 'rgba(168,161,150,0.35)' }}
                  >
                    {selectedId === defaultGenreId ? '★' : '☆'}
                  </button>
                )}
              </div>
              {profile?.role && (
                <div className="text-[10px] mt-0.5" style={{ color: 'rgba(168,161,150,0.55)' }}>
                  {profile.role}
                </div>
              )}
              {profile?.lufs_avg != null && (
                <div className="flex gap-3 mt-2 text-[10px] tabular-nums" style={{ color: 'rgba(168,161,150,0.70)' }}>
                  <span>avg {profile.lufs_avg.toFixed(1)} LUFS</span>
                  {profile.dynamic_range_avg != null && <span>LRA {profile.dynamic_range_avg.toFixed(1)} LU</span>}
                  {profile.width_avg != null && <span>width {(profile.width_avg * 100).toFixed(0)}%</span>}
                  {profile.sample_count != null && <span>{profile.sample_count} tracks</span>}
                </div>
              )}
            </div>
          </div>

          {/* Two-column: radar + coaching */}
          <div className="flex gap-5 items-start">
            <div className="shrink-0">
              <RadarChart axes={result.radar} />
              {/* Legend */}
              <div className="flex flex-wrap gap-3 mt-1 justify-center">
                <span className="flex items-center gap-1 text-[9px]" style={{ color: 'rgba(110,197,119,0.80)' }}>
                  <span style={{ display: 'inline-block', width: 10, height: 2, backgroundColor: '#6ec577', borderRadius: 1 }} />
                  Your file
                </span>
                <span className="flex items-center gap-1 text-[9px]" style={{ color: 'rgba(208,176,102,0.80)' }}>
                  <span style={{ display: 'inline-block', width: 10, height: 2, backgroundColor: '#d0b066', borderRadius: 1 }} />
                  {result.genreName}
                </span>
                {result.radar.some(a => a.spreadDb != null) && (
                  <span className="flex items-center gap-1 text-[9px]" style={{ color: 'rgba(208,176,102,0.45)' }}>
                    <span style={{ display: 'inline-block', width: 10, height: 6, backgroundColor: 'rgba(208,176,102,0.18)', border: '1px dashed rgba(208,176,102,0.35)', borderRadius: 1 }} />
                    tolerance band
                  </span>
                )}
                {result.radar.some(a => a.withinTolerance === false) && (
                  <span className="flex items-center gap-1 text-[9px]" style={{ color: 'rgba(224,122,79,0.80)' }}>
                    <span style={{ display: 'inline-block', width: 6, height: 6, backgroundColor: '#e07a4f', borderRadius: '50%' }} />
                    outside tolerance
                  </span>
                )}
              </div>
            </div>

            {/* Coaching text */}
            <div className="flex-1 min-w-0 space-y-2">
              {result.coaching.map((c, i) => (
                <p key={i} className="text-[11px] leading-relaxed" style={{ color: i === 0 ? 'rgba(168,161,150,0.85)' : 'rgba(168,161,150,0.65)' }}>
                  {c}
                </p>
              ))}
            </div>
          </div>

          {/* Delta bars */}
          {result.deltaPerBand.length > 0 && (
            <div>
              <div className="text-[10px] mb-2 flex items-center gap-2" style={{ color: 'rgba(168,161,150,0.55)' }}>
                <span>Per-band delta vs genre target</span>
                <span className="flex items-center gap-1">
                  <span style={{ display: 'inline-block', width: 8, height: 6, backgroundColor: 'rgba(224,122,79,0.70)', borderRadius: 1 }} />
                  <span>hot</span>
                </span>
                <span className="flex items-center gap-1">
                  <span style={{ display: 'inline-block', width: 8, height: 6, backgroundColor: 'rgba(110,197,119,0.70)', borderRadius: 1 }} />
                  <span>low</span>
                </span>
              </div>
              <DeltaBars deltaPerBand={result.deltaPerBand} spreadPerBand={profile?.tbc_spread} />
            </div>
          )}

          {/* EQ tips */}
          {result.eqTips.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(168,161,150,0.45)' }}>EQ moves to match genre</div>
              {result.eqTips.map((tip, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 px-3 py-2.5"
                  style={{
                    borderRadius: '2px',
                    backgroundColor: tip.action === 'cut' ? 'rgba(224,122,79,0.06)' : 'rgba(110,197,119,0.06)',
                    borderLeft: `2px solid ${tip.action === 'cut' ? 'rgba(224,122,79,0.35)' : 'rgba(110,197,119,0.35)'}`,
                  }}
                >
                  <span
                    className="text-[9px] font-bold shrink-0 mt-0.5 px-1 py-0.5"
                    style={{
                      borderRadius: '2px',
                      color: tip.action === 'cut' ? '#e07a4f' : '#6ec577',
                      backgroundColor: tip.action === 'cut' ? 'rgba(224,122,79,0.12)' : 'rgba(110,197,119,0.12)',
                    }}
                  >
                    {tip.action === 'cut' ? '▼ CUT' : '▲ BOOST'}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium" style={{ color: 'var(--color-text-primary)' }}>
                      {tip.region}
                    </div>
                    <div className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'rgba(168,161,150,0.70)' }}>
                      {tip.note}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
