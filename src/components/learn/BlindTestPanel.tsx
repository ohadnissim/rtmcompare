/**
 * BlindTestPanel — full-screen overlay for Learn Mode v4 Blind Test feature.
 *
 * Students answer structured listening questions BEFORE looking at the meters.
 * After submitting, they can reveal the measurements and compare how their
 * ears calibrated against the actual data.
 */

import React from 'react'
import PanelInfo from '../PanelInfo'
import { useLearnMode } from '../../context/LearnModeContext'
import type { BlindTestAnswer, BlindTestPredictions, EarTrainingAnswers } from '../../types'
import ABPlayer from '../ABPlayer'
import InfoTip from './InfoTip'

interface Props {
  onClose: () => void
  /** Analysis result to compare against after reveal */
  analysisResult: any
  fileAName: string
  fileBName: string
  /** Absolute paths for the audio player — BUG-05 fix */
  fileAPath?: string | null
  fileBPath?: string | null
}

type Dimension = BlindTestAnswer['dimension']
type Choice = BlindTestAnswer['choice']

interface DimensionConfig {
  dimension: Dimension
  label: string
  question: string
}

const DIMENSIONS: DimensionConfig[] = [
  { dimension: 'loudness',      label: 'Loudness',           question: 'Which sounds louder overall?' },
  { dimension: 'tonal_low',     label: 'Low-end energy',     question: 'Which has more bass / low-frequency energy?' },
  { dimension: 'tonal_bright',  label: 'Brightness',         question: 'Which sounds brighter or harsher in the highs?' },
  { dimension: 'stereo_width',  label: 'Stereo width',       question: 'Which sounds wider — more spread from left to right?' },
  { dimension: 'dynamics',      label: 'Dynamic feel',       question: 'Which feels more compressed, dense, or \'pumped\'?' },
  { dimension: 'translation',   label: 'Translation',        question: 'On a phone or laptop speaker, which would translate better?' },
  { dimension: 'overall',       label: 'Overall preference', question: 'Ignoring loudness — which do you prefer, and why?' },
]

function truncate(name: string, maxLen = 18): string {
  return name.length > maxLen ? name.slice(0, maxLen - 1) + '…' : name
}

const DIMENSION_TIPS: Record<string, string> = {
  loudness:     'Integrated loudness (LUFS-I) — the psychoacoustic average level across the whole track. Streaming platforms normalize to −14 LUFS, so the louder-sounding file may actually be turned down on release.',
  tonal_low:    'Low-frequency energy below ~250 Hz. Excess here can mask kick and bass clarity; too little leaves the mix thin on consumer speakers.',
  tonal_bright: 'High-frequency energy above ~8 kHz. Brightness adds air and clarity but too much causes listener fatigue; too little sounds dull or "lo-fi".',
  stereo_width: 'The spread of information between left and right channels. Wide mixes translate well on headphones but can collapse to mono on phones or club systems.',
  dynamics:     'Loudness Range (LRA) — how much the level varies over time. Heavy limiting compresses LRA to 3–5 LU; gentle mastering leaves 8–14 LU of natural dynamic breath.',
  translation:  'Mono compatibility: how much level or tonality is lost when the stereo mix is summed to mono. Poor mono compat hurts phone listening and club playback.',
  overall:      'Your holistic preference for one file over the other, independent of any single dimension. This is the most important ear training — trusting your overall impression.',
}

// ─── Meter comparison helpers ─────────────────────────────────────────────────

function lufsVerdict(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null || b == null) return 'No loudness data available'
  const delta = a - b
  if (Math.abs(delta) < 0.5) return 'Roughly equal (< 0.5 dB)'
  const absDelta = Math.abs(delta)
  if (!isFinite(absDelta)) return 'No loudness data available'
  return delta > 0 ? `A is +${absDelta.toFixed(1)} dB louder` : `B is +${absDelta.toFixed(1)} dB louder`
}

function deltaVerdict(
  a: number | null | undefined,
  b: number | null | undefined,
  labelA: string,
  labelB: string,
  higherMeansMore: boolean,
  unit = ''
): string {
  if (a == null || b == null) return 'No data available'
  const delta = a - b
  if (Math.abs(delta) < 0.1) return 'Roughly equal'
  const absDelta = Math.abs(delta)
  if (!isFinite(absDelta)) return 'No data available'
  const winner = (higherMeansMore ? delta > 0 : delta < 0) ? labelA : labelB
  return `${winner} ${unit}(${absDelta.toFixed(1)} difference)`
}

function matchLufs(
  choice: Choice,
  lufs_a: number | null | undefined,
  lufs_b: number | null | undefined
): 'match' | 'mismatch' | 'neutral' {
  if (lufs_a == null || lufs_b == null) return 'neutral'
  const delta = lufs_a - lufs_b
  if (Math.abs(delta) < 0.5) {
    return choice === 'equal' ? 'match' : 'mismatch'
  }
  if (delta > 0) return choice === 'A' ? 'match' : 'mismatch'
  return choice === 'B' ? 'match' : 'mismatch'
}

function matchDelta(
  choice: Choice,
  a: number | null | undefined,
  b: number | null | undefined,
  higherMeansWinnerIsA: boolean
): 'match' | 'mismatch' | 'neutral' {
  if (a == null || b == null) return 'neutral'
  const delta = a - b
  if (Math.abs(delta) < 0.1) {
    return choice === 'equal' ? 'match' : 'mismatch'
  }
  const dataFavorsA = higherMeansWinnerIsA ? delta > 0 : delta < 0
  if (dataFavorsA) return choice === 'A' ? 'match' : 'mismatch'
  return choice === 'B' ? 'match' : 'mismatch'
}

function verdictLabel(m: 'match' | 'mismatch' | 'neutral'): { text: string; color: string } {
  if (m === 'match')    return { text: '✓ Your ears were right', color: 'rgba(80,180,100,0.9)' }
  if (m === 'mismatch') return { text: '↻ Interesting — meters say otherwise', color: 'rgba(208,176,102,0.9)' }
  return { text: 'See full analysis for detail', color: 'rgba(168,161,150,0.7)' }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ChoiceRowProps {
  dimension: Dimension
  labelA: string
  labelB: string
  value: Choice | undefined
  onChange: (d: Dimension, c: Choice) => void
}

function ChoiceRow({ dimension, labelA, labelB, value, onChange }: ChoiceRowProps) {
  const options: { choice: Choice; label: string }[] = [
    { choice: 'A', label: labelA },
    { choice: 'equal', label: 'Equal' },
    { choice: 'B', label: labelB },
  ]

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {options.map(opt => {
        const selected = value === opt.choice
        return (
          <button
            key={opt.choice}
            onClick={() => onChange(dimension, opt.choice)}
            style={{
              background: selected ? 'rgba(208,176,102,0.08)' : 'transparent',
              border: selected
                ? '1px solid rgba(208,176,102,0.7)'
                : '1px solid rgba(168,161,150,0.25)',
              borderRadius: '2px',
              color: selected ? 'rgba(208,176,102,1)' : 'var(--color-sand-400, rgba(168,161,150,0.8))',
              fontSize: 11,
              letterSpacing: '0.04em',
              padding: '5px 12px',
              cursor: 'pointer',
              transition: 'border-color 0.1s, color 0.1s, background 0.1s',
              whiteSpace: 'nowrap',
              maxWidth: 140,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

// BlindAudioPlayer removed — replaced with the real ABPlayer (continuous
// playback, waveform scrubbing, gain alignment) so students get the same
// listen experience as the main analysis view.

export default function BlindTestPanel({ onClose, analysisResult, fileAName, fileBName, fileAPath, fileBPath }: Props) {
  const { blindTest, submitBlindTest, revealBlindTest, resetBlindTest } = useLearnMode()

  // ─── Platform Normalization Drill state ────────────────────────────────────
  const [platformMode, setPlatformMode] = React.useState(false)
  const [platformShuffled, setPlatformShuffled] = React.useState<{ a: number; b: number } | null>(null)
  const [platformAnswers, setPlatformAnswers] = React.useState<{ a: string | null; b: string | null }>({ a: null, b: null })
  const [platformRevealed, setPlatformRevealed] = React.useState(false)
  const [platformListenIdx, setPlatformListenIdx] = React.useState(0)

  function startPlatformDrill() {
    const platforms = analysisResult?.streaming_preview?.b
    if (!platforms || platforms.length < 2) return
    const shuffled = [...platforms.keys()].sort(() => Math.random() - 0.5)
    setPlatformShuffled({ a: shuffled[0], b: shuffled[1] })
    setPlatformAnswers({ a: null, b: null })
    setPlatformRevealed(false)
    setPlatformListenIdx(shuffled[0])
    setPlatformMode(true)
  }

  // Build an anonymized 2-item streamingPreview for ABPlayer so the dropdown
  // shows "Mystery A / Mystery B" rather than the real platform names.
  const platformDrillPreview: Array<{ name: string; delta_db: number; played_lufs: number; target_lufs: number }> | undefined =
    platformMode && platformShuffled !== null && analysisResult?.streaming_preview?.b
      ? [
          {
            name: 'Mystery A',
            delta_db: (analysisResult.streaming_preview.b[platformShuffled.a] as any).delta_db,
            played_lufs: (analysisResult.streaming_preview.b[platformShuffled.a] as any).played_lufs,
            target_lufs: (analysisResult.streaming_preview.b[platformShuffled.a] as any).target_lufs,
          },
          {
            name: 'Mystery B',
            delta_db: (analysisResult.streaming_preview.b[platformShuffled.b] as any).delta_db,
            played_lufs: (analysisResult.streaming_preview.b[platformShuffled.b] as any).played_lufs,
            target_lufs: (analysisResult.streaming_preview.b[platformShuffled.b] as any).target_lufs,
          },
        ]
      : undefined

  const [answers, setAnswers] = React.useState<Partial<Record<Dimension, BlindTestAnswer>>>(() => {
    if (!blindTest) return {}
    const map: Partial<Record<Dimension, BlindTestAnswer>> = {}
    for (const a of blindTest.answers) map[a.dimension] = a
    return map
  })
  const [earTraining, setEarTraining] = React.useState<EarTrainingAnswers>({
    frequencyRegions: [],
    reverbType: '',
    monoPrediction: '',
  })
  const [notesField, setNotesField] = React.useState<string>(() => {
    if (!blindTest) return ''
    return blindTest.answers.find(a => a.dimension === 'overall')?.notes ?? ''
  })
  const [submitted, setSubmitted] = React.useState<boolean>(() => blindTest != null)
  const [resetPending, setResetPending] = React.useState(false)
  const resetPendingTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => { if (resetPendingTimer.current) clearTimeout(resetPendingTimer.current) }, [])

  // Blind test — never show the filename. Labels are always plain "A" and "B".
  // fileAName/fileBName are only used for the ABPlayer's internal `name` prop.
  const labelA = 'A'
  const labelB = 'B'

  // Shuffle once per session so the student can't assume "A = Reference".
  // swapped=true means physical fileA is presented as button B and vice versa.
  // Stable across re-renders via useState initialiser (never re-rolls mid-session).
  const [swapped] = React.useState<boolean>(() => Math.random() < 0.5)
  const playerFileA = swapped
    ? { path: fileBPath ?? '', name: 'A' }
    : { path: fileAPath ?? '', name: 'A' }
  const playerFileB = swapped
    ? { path: fileAPath ?? '', name: 'B' }
    : { path: fileBPath ?? '', name: 'B' }

  const allAnswered = DIMENSIONS.every(d => answers[d.dimension] != null)

  function handleChoice(dimension: Dimension, choice: Choice) {
    setAnswers(prev => ({
      ...prev,
      [dimension]: {
        dimension,
        choice,
        notes: dimension === 'overall' ? notesField : (prev[dimension]?.notes ?? ''),
      },
    }))
  }

  function handleSubmit() {
    // Build final answers — for each dimension use the explicit choice the student selected.
    // The 'overall' dimension also syncs the current notes textarea value.
    // BUG-14 fix: no `?? 'equal'` fallback — allAnswered guard already ensures all 7 were
    // explicitly chosen before this fires, so the non-null assertion is safe here.
    const finalAnswers = DIMENSIONS.map(d => ({
      dimension: d.dimension,
      choice: (answers[d.dimension]?.choice ?? 'equal') as 'A' | 'equal' | 'B',
      notes: d.dimension === 'overall' ? notesField : (answers[d.dimension]?.notes ?? ''),
    }))
    const predictions: BlindTestPredictions = {
      answers: finalAnswers,
      earTraining,
      submittedAt: new Date().toISOString(),
      revealed: false,
    }
    submitBlindTest(predictions)
    setSubmitted(true)
  }

  function handleReset() {
    if (!resetPending) {
      setResetPending(true)
      // UX-4: auto-cancel after 3s — don't rely on onBlur which fires on any scroll
      resetPendingTimer.current = setTimeout(() => setResetPending(false), 3000)
      return
    }
    if (resetPendingTimer.current) { clearTimeout(resetPendingTimer.current); resetPendingTimer.current = null }
    resetBlindTest()
    setAnswers({})
    setNotesField('')
    setSubmitted(false)
    setResetPending(false)
  }

  // ─── Results table data ───────────────────────────────────────────────────

  const ar = analysisResult ?? {}

  interface ResultRow {
    dimension: Dimension
    label: string
    yourChoice: Choice | undefined
    yourNotes: string
    metersText: string
    verdict: 'match' | 'mismatch' | 'neutral'
  }

  const resultRows: ResultRow[] = React.useMemo(() => {
    const savedAnswers = blindTest?.answers ?? []
    const answerFor = (d: Dimension) => savedAnswers.find(a => a.dimension === d)
    // Use analysisResult directly (not the `ar` alias created outside useMemo)
    // so the dep is a stable reference rather than a new inline object each render.
    const result = analysisResult ?? {}

    return DIMENSIONS.map(({ dimension, label }) => {
      const a = answerFor(dimension)
      const choice = a?.choice
      const notes = a?.notes ?? ''

      let metersText = ''
      let verdict: 'match' | 'mismatch' | 'neutral' = 'neutral'

      switch (dimension) {
        case 'loudness': {
          metersText = lufsVerdict(result.lufs_i_a, result.lufs_i_b)
          verdict = matchLufs(choice ?? 'equal', result.lufs_i_a, result.lufs_i_b)
          break
        }
        case 'tonal_low': {
          const sa: number[] | undefined = result.spectrum_a
          const sb: number[] | undefined = result.spectrum_b
          if (sa && sb && sa.length > 0 && sb.length === sa.length) {
            const nLow = Math.max(1, Math.floor(sa.length * 0.30))
            const meanA = sa.slice(0, nLow).reduce((s, v) => s + v, 0) / nLow
            const meanB = sb.slice(0, nLow).reduce((s, v) => s + v, 0) / nLow
            metersText = deltaVerdict(meanA, meanB, 'A', 'B', true, 'more low-end ')
            verdict = matchDelta(choice ?? 'equal', meanA, meanB, true)
          } else {
            metersText = 'See Tonal Balance tab for detail'
            verdict = 'neutral'
          }
          break
        }
        case 'tonal_bright': {
          const sa: number[] | undefined = result.spectrum_a
          const sb: number[] | undefined = result.spectrum_b
          if (sa && sb && sa.length > 0 && sb.length === sa.length) {
            const nHigh = Math.max(1, Math.floor(sa.length * 0.30))
            const startIdx = sa.length - nHigh
            const meanA = sa.slice(startIdx).reduce((s, v) => s + v, 0) / nHigh
            const meanB = sb.slice(startIdx).reduce((s, v) => s + v, 0) / nHigh
            metersText = deltaVerdict(meanA, meanB, 'A', 'B', true, 'brighter ')
            verdict = matchDelta(choice ?? 'equal', meanA, meanB, true)
          } else {
            metersText = 'See Tonal Balance tab for detail'
            verdict = 'neutral'
          }
          break
        }
        case 'stereo_width': {
          metersText = deltaVerdict(result.stereo_width_a, result.stereo_width_b, 'A', 'B', true, 'wider ')
          verdict = matchDelta(choice ?? 'equal', result.stereo_width_a, result.stereo_width_b, true)
          break
        }
        case 'dynamics': {
          // Higher LRA = less compressed; lower LRA = more compressed.
          // Question: "which is MORE compressed?" → lower LRA wins.
          // higherMeansMore=false: when lra_a < lra_b (delta<0), winner = labelA = 'A'.
          // NEW-03 fix: was ('B','A') which inverted the display label while matchDelta was correct.
          metersText = deltaVerdict(result.lra_a, result.lra_b, 'A', 'B', false, 'more compressed ')
          verdict = matchDelta(choice ?? 'equal', result.lra_a, result.lra_b, false)
          break
        }
        case 'translation': {
          // Higher mono compat % = better translation
          metersText = deltaVerdict(result.mono_compat_a, result.mono_compat_b, 'A', 'B', true, 'better translation ')
          verdict = matchDelta(choice ?? 'equal', result.mono_compat_a, result.mono_compat_b, true)
          break
        }
        case 'overall': {
          metersText = notes || '—'
          verdict = 'neutral'
          break
        }
      }

      return { dimension, label, yourChoice: choice, yourNotes: notes, metersText, verdict }
    })
  }, [blindTest, analysisResult])

  // Count measurable correct predictions
  const measurableDimensions: Dimension[] = ['loudness', 'stereo_width', 'dynamics', 'translation']
  const correctCount = resultRows.filter(
    r => measurableDimensions.includes(r.dimension) && r.verdict === 'match'
  ).length
  const measurableTotal = measurableDimensions.length

  // ─── Render ───────────────────────────────────────────────────────────────

  const showResults = submitted || blindTest != null

  return (
    <div
      data-blind-test-open="true"
      data-tour-learn="blind-test"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        background: 'rgba(14,13,11,0.98)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* ── SECTION A: Header ─────────────────────────────────────────────── */}
      <div
        style={{
          borderBottom: '1px solid rgba(208,176,102,0.2)',
          padding: '20px 28px 16px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div
              style={{
                fontSize: 11,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'rgba(208,176,102,0.9)',
                marginBottom: 6,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              BLIND TEST — Trust Your Ears First
              <PanelInfo panelId="learn_blind_test" />
              <InfoTip
                label="Blind A/B Test"
                body="Lock in your prediction before the meters are revealed. Develops unbiased listening — the most valuable skill in mastering."
              />
            </div>
            <div
              style={{
                width: 280,
                height: 1,
                background: 'rgba(208,176,102,0.2)',
                marginBottom: 10,
              }}
            />
            <p
              style={{
                fontSize: 13,
                color: 'rgba(168,161,150,0.85)',
                margin: 0,
                lineHeight: 1.6,
                maxWidth: 620,
              }}
            >
              Before you read a single meter, answer these questions from listening alone.
              Submit your predictions, then reveal the measurements to see how well your ears calibrated.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
            {analysisResult?.streaming_preview?.b && analysisResult.streaming_preview.b.length >= 2 && (
              <button
                onClick={platformMode ? () => setPlatformMode(false) : startPlatformDrill}
                style={{
                  fontSize: 10,
                  padding: '3px 10px',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  backgroundColor: platformMode ? 'rgba(208,176,102,0.12)' : 'transparent',
                  color: platformMode ? 'var(--color-accent)' : 'var(--color-sand-400)',
                  border: `1px solid ${platformMode ? 'rgba(208,176,102,0.35)' : 'rgba(168,161,150,0.2)'}`,
                  borderRadius: 2,
                  cursor: 'pointer',
                }}
              >
                ◎ Platform Norm
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: '1px solid rgba(168,161,150,0.2)',
                borderRadius: '2px',
                color: 'rgba(168,161,150,0.6)',
                fontSize: 16,
                padding: '4px 10px',
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          </div>
        </div>
      </div>

      {/* ── Scrollable body ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 40px' }}>

        {/* ── SECTION B: Questions ──────────────────────────────────────── */}
        {!showResults && (
          <div style={{ maxWidth: 740 }}>
            {/* Real ABPlayer — continuous playback, waveform, gain-aligned */}
            {fileAPath && fileBPath && (
              <ABPlayer
                fileA={playerFileA}
                fileB={playerFileB}
                gainAppliedDb={analysisResult?.gain_applied_db ?? 0}
                streamingPreview={platformDrillPreview}
              />
            )}

            {/* ── Platform Normalization Drill ───────────────────────────── */}
            {platformMode && platformShuffled !== null && (() => {
              const platforms = analysisResult!.streaming_preview!.b as Array<{
                name: string; played_lufs: number; played_tp: number; delta_db: number;
                action: string; tp_breach: boolean; target_lufs: number; target_tp: number
              }>
              const platformA = platforms[platformShuffled.a]
              const platformB = platforms[platformShuffled.b]
              const allNames = platforms.map((p: { name: string }) => p.name)

              return (
                <div style={{ padding: '16px 0' }}>
                  {/* Header */}
                  <div style={{ marginBottom: 12 }}>
                    <p style={{ fontSize: 11, color: 'var(--color-sand-300)', lineHeight: 1.5, margin: 0 }}>
                      Listen to File B normalized to two mystery platforms. Use the PLT mode in the player above and select "Mystery A" or "Mystery B" in the dropdown to hear each one. For each, guess which streaming platform's loudness target you're hearing.
                    </p>
                  </div>

                  {/* Mystery platform toggle — visual indicator of active mystery */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                    {(['a', 'b'] as const).map(side => (
                      <button
                        key={side}
                        onClick={() => setPlatformListenIdx(platformShuffled[side])}
                        style={{
                          flex: 1, padding: '8px 0', fontSize: 11, textTransform: 'uppercase',
                          letterSpacing: '0.14em', cursor: 'pointer',
                          backgroundColor: platformListenIdx === platformShuffled[side]
                            ? 'rgba(208,176,102,0.15)' : 'rgba(48,44,39,0.5)',
                          border: `1px solid ${platformListenIdx === platformShuffled[side] ? 'rgba(208,176,102,0.4)' : 'rgba(168,161,150,0.2)'}`,
                          color: platformListenIdx === platformShuffled[side] ? 'var(--color-accent)' : 'var(--color-sand-300)',
                          borderRadius: 2,
                        }}
                      >
                        Guessing: Mystery {side.toUpperCase()}
                      </button>
                    ))}
                  </div>

                  {/* Guess for Mystery A and B */}
                  {!platformRevealed && (['a', 'b'] as const).map(side => (
                    <div key={side} style={{ marginBottom: 12 }}>
                      <p style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 6, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px' }}>
                        Mystery {side.toUpperCase()} is…
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                        {allNames.map((name: string) => (
                          <button
                            key={name}
                            onClick={() => setPlatformAnswers(prev => ({ ...prev, [side]: name }))}
                            style={{
                              padding: '5px 8px', fontSize: 10, textAlign: 'center', cursor: 'pointer',
                              backgroundColor: platformAnswers[side] === name
                                ? 'rgba(208,176,102,0.15)' : 'rgba(48,44,39,0.5)',
                              border: `1px solid ${platformAnswers[side] === name ? 'rgba(208,176,102,0.4)' : 'rgba(168,161,150,0.15)'}`,
                              color: platformAnswers[side] === name ? 'var(--color-accent)' : 'var(--color-sand-400)',
                              borderRadius: 2,
                            }}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Reveal button */}
                  {!platformRevealed && platformAnswers.a && platformAnswers.b && (
                    <button
                      onClick={() => setPlatformRevealed(true)}
                      style={{
                        width: '100%', padding: '8px 0', fontSize: 11, letterSpacing: '0.12em',
                        textTransform: 'uppercase', cursor: 'pointer',
                        backgroundColor: 'rgba(208,176,102,0.12)',
                        color: 'var(--color-accent)',
                        border: '1px solid rgba(208,176,102,0.35)',
                        borderRadius: 2, marginTop: 8,
                      }}
                    >
                      Reveal Platforms
                    </button>
                  )}

                  {/* Reveal result */}
                  {platformRevealed && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                      {(['a', 'b'] as const).map(side => {
                        const actual = side === 'a' ? platformA : platformB
                        const guess = platformAnswers[side]
                        const correct = guess === actual.name
                        return (
                          <div key={side} style={{
                            padding: '10px 12px',
                            backgroundColor: correct ? 'rgba(80,160,80,0.08)' : 'rgba(160,60,60,0.08)',
                            border: `1px solid ${correct ? 'rgba(80,160,80,0.3)' : 'rgba(160,60,60,0.3)'}`,
                            borderRadius: 2,
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: 10, color: 'var(--color-sand-300)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                Mystery {side.toUpperCase()}
                              </span>
                              <span style={{ fontSize: 10, color: correct ? '#5ca05c' : '#c05050' }}>
                                {correct ? '✓ Correct' : '✗ Wrong'}
                              </span>
                            </div>
                            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-sand-100)', fontWeight: 500 }}>
                              {actual.name}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
                              {actual.delta_db > 0 ? '+' : ''}{actual.delta_db.toFixed(1)} dB · plays at {actual.played_lufs.toFixed(1)} LUFS
                              {actual.tp_breach ? ' · TP limiter engages' : ''}
                            </div>
                            {guess !== actual.name && (
                              <div style={{ fontSize: 10, color: 'var(--color-sand-400)', marginTop: 2 }}>
                                You guessed: {guess}
                                {(() => {
                                  const guessedPlatform = platforms.find((p: { name: string }) => p.name === guess)
                                  return guessedPlatform ? ` (${guessedPlatform.delta_db.toFixed(1)} dB · ${guessedPlatform.played_lufs.toFixed(1)} LUFS)` : ''
                                })()}
                              </div>
                            )}
                          </div>
                        )
                      })}
                      <button
                        onClick={startPlatformDrill}
                        style={{
                          fontSize: 10, padding: '6px 0', textTransform: 'uppercase', letterSpacing: '0.12em',
                          color: 'var(--color-text-muted)', border: '1px solid rgba(168,161,150,0.2)',
                          borderRadius: 2, backgroundColor: 'transparent', cursor: 'pointer',
                        }}
                      >
                        Try Again
                      </button>
                    </div>
                  )}
                </div>
              )
            })()}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {DIMENSIONS.map(({ dimension, label, question }) => (
                <div
                  key={dimension}
                  style={{
                    border: '1px solid rgba(168,161,150,0.1)',
                    borderRadius: '2px',
                    padding: '14px 16px',
                    background: 'rgba(255,255,255,0.015)',
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      color: 'rgba(208,176,102,0.7)',
                      marginBottom: 6,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    {label}
                    {DIMENSION_TIPS[dimension] && (
                      <InfoTip label={label} body={DIMENSION_TIPS[dimension]} />
                    )}
                  </div>
                  <p
                    style={{
                      fontSize: 13,
                      color: 'rgba(220,215,205,0.9)',
                      margin: '0 0 12px',
                      lineHeight: 1.5,
                    }}
                  >
                    {question}
                  </p>
                  <ChoiceRow
                    dimension={dimension}
                    labelA={labelA}
                    labelB={labelB}
                    value={answers[dimension]?.choice}
                    onChange={handleChoice}
                  />
                  {dimension === 'overall' && (
                    <textarea
                      value={notesField}
                      onChange={e => {
                        setNotesField(e.target.value)
                        // BUG-14 fix: only update notes if a choice has already been explicitly
                        // selected; do NOT auto-create an answer entry with 'equal' just because
                        // the student typed notes. That would silently mark 'overall' as answered.
                        setAnswers(prev => {
                          if (!prev.overall) return prev   // no choice yet — don't create entry
                          return {
                            ...prev,
                            overall: { ...prev.overall, notes: e.target.value },
                          }
                        })
                      }}
                      placeholder="Your notes on overall preference…"
                      rows={3}
                      style={{
                        marginTop: 10,
                        width: '100%',
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(168,161,150,0.15)',
                        borderRadius: '2px',
                        color: 'rgba(220,215,205,0.85)',
                        fontSize: 12,
                        padding: '8px 10px',
                        resize: 'vertical',
                        fontFamily: 'inherit',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* ── Ear Training section ──────────────────────────────────── */}
            <div style={{ marginTop: 32 }}>
              {/* Divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <div style={{ flex: 1, height: 1, background: 'rgba(168,161,150,0.12)' }} />
                <div
                  style={{
                    fontSize: 9,
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    color: 'rgba(168,161,150,0.45)',
                    flexShrink: 0,
                    textAlign: 'center',
                  }}
                >
                  BONUS — Ear Training (Identify Without Comparing)
                </div>
                <div style={{ flex: 1, height: 1, background: 'rgba(168,161,150,0.12)' }} />
              </div>
              <p style={{ fontSize: 12, color: 'rgba(168,161,150,0.55)', margin: '0 0 20px', lineHeight: 1.6 }}>
                These questions test absolute identification, not A-vs-B comparison. Optional — they do not affect your submission.
              </p>

              {/* Q1 — Frequency regions */}
              <div
                style={{
                  border: '1px solid rgba(168,161,150,0.1)',
                  borderRadius: '2px',
                  padding: '14px 16px',
                  background: 'rgba(255,255,255,0.015)',
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'rgba(208,176,102,0.7)',
                    marginBottom: 8,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  Frequency Regions
                  <InfoTip
                    label="Frequency Region"
                    body="Identifies which part of the spectrum is most prominent. Training this skill lets you name EQ problems by ear before reaching for an analyzer."
                  />
                </div>
                <p style={{ fontSize: 13, color: 'rgba(220,215,205,0.9)', margin: '0 0 12px', lineHeight: 1.5 }}>
                  Which frequency regions stand out most in File B compared to the reference? (select all that apply)
                </p>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                  }}
                >
                  {(
                    [
                      { value: 'sub',        label: 'Sub bass (20–80 Hz)' },
                      { value: 'bass',       label: 'Bass (80–250 Hz)' },
                      { value: 'low_mids',   label: 'Low mids (250–500 Hz)' },
                      { value: 'mids',       label: 'Mids (500–2 kHz)' },
                      { value: 'upper_mids', label: 'Upper mids (2–4 kHz)' },
                      { value: 'presence',   label: 'Presence (4–6 kHz)' },
                      { value: 'air',        label: 'Air (6–20 kHz)' },
                    ] as { value: EarTrainingAnswers['frequencyRegions'][number]; label: string }[]
                  ).map(({ value, label }) => {
                    const checked = earTraining.frequencyRegions.includes(value)
                    return (
                      <label
                        key={value}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          cursor: 'pointer',
                          fontSize: 12,
                          color: checked ? 'rgba(220,215,205,0.9)' : 'rgba(168,161,150,0.7)',
                          userSelect: 'none',
                        }}
                      >
                        <div
                          role="checkbox"
                          aria-checked={checked}
                          tabIndex={0}
                          onClick={() => {
                            setEarTraining(prev => ({
                              ...prev,
                              frequencyRegions: checked
                                ? prev.frequencyRegions.filter(v => v !== value)
                                : [...prev.frequencyRegions, value],
                            }))
                          }}
                          onKeyDown={(e) => {
                            if (e.key === ' ' || e.key === 'Enter') {
                              e.preventDefault()
                              setEarTraining(prev => ({
                                ...prev,
                                frequencyRegions: checked
                                  ? prev.frequencyRegions.filter(v => v !== value)
                                  : [...prev.frequencyRegions, value],
                              }))
                            }
                          }}
                          style={{
                            width: 14,
                            height: 14,
                            border: checked
                              ? '1px solid rgba(208,176,102,0.7)'
                              : '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '2px',
                            background: checked ? 'rgba(208,176,102,0.08)' : 'transparent',
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            transition: 'border-color 0.1s, background 0.1s',
                          }}
                        >
                          {checked && (
                            <div
                              style={{
                                width: 8,
                                height: 8,
                                background: 'rgba(208,176,102,0.9)',
                                borderRadius: '1px',
                              }}
                            />
                          )}
                        </div>
                        <span
                          onClick={() => {
                            setEarTraining(prev => ({
                              ...prev,
                              frequencyRegions: checked
                                ? prev.frequencyRegions.filter(v => v !== value)
                                : [...prev.frequencyRegions, value],
                            }))
                          }}
                        >
                          {label}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>

              {/* Q2 — Reverb type */}
              <div
                style={{
                  border: '1px solid rgba(168,161,150,0.1)',
                  borderRadius: '2px',
                  padding: '14px 16px',
                  background: 'rgba(255,255,255,0.015)',
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'rgba(208,176,102,0.7)',
                    marginBottom: 8,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  Reverb Type
                  <InfoTip
                    label="Reverb Type"
                    body="Plate sounds metallic and dense; hall sounds spacious and diffuse; room sounds intimate. Identifying reverb character by ear is key for matching reference productions."
                  />
                </div>
                <p style={{ fontSize: 13, color: 'rgba(220,215,205,0.9)', margin: '0 0 12px', lineHeight: 1.5 }}>
                  What type of reverb is most prominent on the lead element?
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(
                    [
                      { value: 'plate',  label: 'Plate' },
                      { value: 'hall',   label: 'Hall' },
                      { value: 'room',   label: 'Room' },
                      { value: 'spring', label: 'Spring' },
                      { value: 'none',   label: 'No noticeable reverb' },
                    ] as { value: EarTrainingAnswers['reverbType']; label: string }[]
                  ).map(({ value, label }) => {
                    const selected = earTraining.reverbType === value
                    return (
                      <button
                        key={value}
                        onClick={() => setEarTraining(prev => ({ ...prev, reverbType: value }))}
                        style={{
                          background: selected ? 'rgba(208,176,102,0.08)' : 'transparent',
                          border: selected
                            ? '1px solid rgba(208,176,102,0.7)'
                            : '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '2px',
                          color: selected ? 'rgba(208,176,102,1)' : 'rgba(168,161,150,0.7)',
                          fontSize: 11,
                          letterSpacing: '0.04em',
                          padding: '5px 12px',
                          cursor: 'pointer',
                          transition: 'border-color 0.1s, color 0.1s, background 0.1s',
                        }}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Q3 — Mono prediction */}
              <div
                style={{
                  border: '1px solid rgba(168,161,150,0.1)',
                  borderRadius: '2px',
                  padding: '14px 16px',
                  background: 'rgba(255,255,255,0.015)',
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'rgba(208,176,102,0.7)',
                    marginBottom: 8,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  Mono Prediction
                  <InfoTip
                    label="Mono Prediction"
                    body="Phase cancellation when stereo is summed to mono can erase sub bass, thin the midrange, or collapse the stereo image entirely. Predicting this trains your ear to hear phase before the vectorscope tells you."
                  />
                </div>
                <p style={{ fontSize: 13, color: 'rgba(220,215,205,0.9)', margin: '0 0 12px', lineHeight: 1.5 }}>
                  When summed to mono, what do you predict will be most affected?
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(
                    [
                      { value: 'sub_loss',        label: 'Sub / bass energy',       desc: 'Low end thins out' },
                      { value: 'mid_fullness',     label: 'Midrange fullness',       desc: 'Mid instruments lose body' },
                      { value: 'stereo_collapse',  label: 'Stereo spread collapses', desc: 'Panned elements move to centre' },
                      { value: 'nothing',          label: 'Nothing significant',     desc: 'Mono-safe mix' },
                    ] as { value: EarTrainingAnswers['monoPrediction']; label: string; desc: string }[]
                  ).map(({ value, label, desc }) => {
                    const selected = earTraining.monoPrediction === value
                    return (
                      <button
                        key={value}
                        onClick={() => setEarTraining(prev => ({ ...prev, monoPrediction: value }))}
                        style={{
                          background: selected ? 'rgba(208,176,102,0.08)' : 'transparent',
                          border: selected
                            ? '1px solid rgba(208,176,102,0.7)'
                            : '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '2px',
                          color: selected ? 'rgba(208,176,102,1)' : 'rgba(168,161,150,0.7)',
                          fontSize: 11,
                          letterSpacing: '0.04em',
                          padding: '7px 14px',
                          cursor: 'pointer',
                          transition: 'border-color 0.1s, color 0.1s, background 0.1s',
                          textAlign: 'left',
                          display: 'flex',
                          gap: 12,
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ minWidth: 160 }}>{label}</span>
                        <span
                          style={{
                            fontSize: 10,
                            color: selected ? 'rgba(208,176,102,0.65)' : 'rgba(168,161,150,0.45)',
                            letterSpacing: '0.02em',
                          }}
                        >
                          {desc}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Submit button */}
            <div style={{ marginTop: 28 }}>
              <button
                onClick={handleSubmit}
                disabled={!allAnswered}
                style={{
                  background: allAnswered ? 'rgba(208,176,102,0.06)' : 'transparent',
                  border: `1px solid ${allAnswered ? 'rgba(208,176,102,0.7)' : 'rgba(168,161,150,0.2)'}`,
                  borderRadius: '2px',
                  color: allAnswered ? 'rgba(208,176,102,1)' : 'rgba(168,161,150,0.4)',
                  fontSize: 11,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  padding: '8px 20px',
                  cursor: allAnswered ? 'pointer' : 'not-allowed',
                  transition: 'border-color 0.15s, color 0.15s, background 0.15s',
                }}
              >
                Submit Predictions →
              </button>
              {!allAnswered && (
                <span
                  style={{
                    marginLeft: 12,
                    fontSize: 11,
                    color: 'rgba(168,161,150,0.45)',
                  }}
                >
                  Answer all {DIMENSIONS.length} questions to submit
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── SECTION C: Results ────────────────────────────────────────── */}
        {showResults && (
          <div style={{ maxWidth: 900 }}>
            {/* Reveal banner */}
            {!blindTest?.revealed && (
              <div
                style={{
                  background: 'rgba(208,176,102,0.04)',
                  border: '1px solid rgba(208,176,102,0.25)',
                  borderRadius: '2px',
                  padding: '16px 20px',
                  marginBottom: 24,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      color: 'rgba(208,176,102,0.85)',
                      marginBottom: 4,
                    }}
                  >
                    Predictions Submitted
                  </div>
                  <p style={{ fontSize: 13, color: 'rgba(168,161,150,0.8)', margin: 0 }}>
                    Your answers are locked in. Ready to see how the meters compare?
                  </p>
                </div>
                {!analysisResult && (
                  <p style={{ fontSize: 10, color: 'rgba(208,176,102,0.55)', margin: '0 0 8px 0', fontFamily: 'var(--font-display)', fontStyle: 'italic' }}>
                    Run an analysis first to reveal.
                  </p>
                )}
                <button
                  onClick={() => revealBlindTest(analysisResult)}
                  disabled={!analysisResult}
                  title={!analysisResult ? 'Analysis result not yet available — please run an analysis first' : undefined}
                  style={{
                    background: analysisResult ? 'rgba(208,176,102,0.07)' : 'rgba(208,176,102,0.03)',
                    border: `1px solid ${analysisResult ? 'rgba(208,176,102,0.6)' : 'rgba(208,176,102,0.2)'}`,
                    borderRadius: '2px',
                    color: analysisResult ? 'rgba(208,176,102,1)' : 'rgba(208,176,102,0.35)',
                    fontSize: 11,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    padding: '8px 18px',
                    cursor: analysisResult ? 'pointer' : 'not-allowed',
                    flexShrink: 0,
                  }}
                >
                  Reveal Measurements →
                </button>
              </div>
            )}

            {/* Comparison table */}
            {blindTest?.revealed && (
              <>
                {/* Shuffle reveal — show which physical file was behind A vs B */}
                <div style={{
                  padding: '10px 14px',
                  marginBottom: 12,
                  borderRadius: 2,
                  backgroundColor: 'rgba(208,176,102,0.07)',
                  border: '1px solid rgba(208,176,102,0.25)',
                  fontSize: 12,
                  color: 'var(--color-text-primary)',
                  display: 'flex',
                  gap: 20,
                }}>
                  <span style={{ color: 'rgba(168,161,150,0.7)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', alignSelf: 'center' }}>Files were</span>
                  <span><strong style={{ color: 'var(--color-gold)' }}>A</strong> = {swapped ? fileAName || 'Modified' : fileAName || 'Reference'}</span>
                  <span><strong style={{ color: 'var(--color-gold)' }}>B</strong> = {swapped ? fileBName || 'Reference' : fileBName || 'Modified'}</span>
                </div>
                {/* Column headers */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '160px 1fr 1fr 200px',
                    gap: 12,
                    padding: '0 0 8px',
                    borderBottom: '1px solid rgba(208,176,102,0.12)',
                    marginBottom: 4,
                  }}
                >
                  {['Dimension', 'Your Ears', 'The Meters', ''].map(h => (
                    <div
                      key={h}
                      style={{
                        fontSize: 9,
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        color: 'rgba(168,161,150,0.5)',
                      }}
                    >
                      {h}
                    </div>
                  ))}
                </div>

                {resultRows.map(row => {
                  const vd = verdictLabel(row.verdict)
                  const choiceLabel =
                    row.yourChoice === 'A' ? labelA
                    : row.yourChoice === 'B' ? labelB
                    : row.yourChoice === 'equal' ? 'Equal'
                    : '—'

                  return (
                    <div
                      key={row.dimension}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '160px 1fr 1fr 200px',
                        gap: 12,
                        padding: '10px 0',
                        borderBottom: '1px solid rgba(168,161,150,0.06)',
                        alignItems: 'start',
                      }}
                    >
                      {/* Label */}
                      <div
                        style={{
                          fontSize: 11,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          color: 'rgba(208,176,102,0.65)',
                          paddingTop: 1,
                        }}
                      >
                        {row.label}
                      </div>

                      {/* Your ears */}
                      <div>
                        <span
                          style={{
                            fontSize: 12,
                            color: 'rgba(220,215,205,0.85)',
                          }}
                        >
                          {choiceLabel}
                        </span>
                        {row.dimension === 'overall' && row.yourNotes && (
                          <p
                            style={{
                              fontSize: 11,
                              color: 'rgba(168,161,150,0.65)',
                              margin: '4px 0 0',
                              lineHeight: 1.5,
                            }}
                          >
                            {row.yourNotes}
                          </p>
                        )}
                      </div>

                      {/* The meters */}
                      <div
                        style={{
                          fontSize: 12,
                          color: 'rgba(168,161,150,0.75)',
                          lineHeight: 1.5,
                        }}
                      >
                        {row.metersText}
                      </div>

                      {/* Verdict */}
                      <div
                        style={{
                          fontSize: 11,
                          color: vd.color,
                          lineHeight: 1.4,
                        }}
                      >
                        {vd.text}
                      </div>
                    </div>
                  )
                })}

                {/* Summary */}
                <div
                  style={{
                    marginTop: 20,
                    padding: '12px 16px',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(208,176,102,0.1)',
                    borderRadius: '2px',
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      color: 'rgba(208,176,102,0.6)',
                      marginBottom: 4,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    Calibration Score
                    <InfoTip
                      label="Calibration Score"
                      body="Tracks how often your ears align with the objective measurements. 70%+ is excellent. Berklee ear training studies show 8 weeks of daily practice reaches 85% accuracy."
                    />
                  </div>
                  <div style={{ fontSize: 13, color: 'rgba(220,215,205,0.85)' }}>
                    You correctly predicted {correctCount} of {measurableTotal} measurable dimensions.
                  </div>
                </div>

                {/* Ear Training Results */}
                {blindTest?.earTraining && (
                  <div style={{ marginTop: 28 }}>
                    {/* Divider */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
                      <div style={{ flex: 1, height: 1, background: 'rgba(168,161,150,0.12)' }} />
                      <div
                        style={{
                          fontSize: 9,
                          letterSpacing: '0.16em',
                          textTransform: 'uppercase',
                          color: 'rgba(168,161,150,0.45)',
                          flexShrink: 0,
                        }}
                      >
                        Ear Training Results
                      </div>
                      <div style={{ flex: 1, height: 1, background: 'rgba(168,161,150,0.12)' }} />
                    </div>

                    {/* Frequency regions */}
                    <div
                      style={{
                        border: '1px solid rgba(168,161,150,0.1)',
                        borderRadius: '2px',
                        padding: '12px 14px',
                        background: 'rgba(255,255,255,0.015)',
                        marginBottom: 12,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 9,
                          letterSpacing: '0.14em',
                          textTransform: 'uppercase',
                          color: 'rgba(208,176,102,0.6)',
                          marginBottom: 6,
                        }}
                      >
                        Frequency Regions Selected
                      </div>
                      {blindTest.earTraining.frequencyRegions.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                          {blindTest.earTraining.frequencyRegions.map(r => (
                            <span
                              key={r}
                              style={{
                                fontSize: 11,
                                color: 'rgba(220,215,205,0.8)',
                                border: '1px solid rgba(208,176,102,0.3)',
                                borderRadius: '2px',
                                padding: '2px 8px',
                                background: 'rgba(208,176,102,0.04)',
                              }}
                            >
                              {r.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: 'rgba(168,161,150,0.5)', marginBottom: 8 }}>
                          No regions selected
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: 'rgba(168,161,150,0.55)', lineHeight: 1.5 }}>
                        See Tonal Balance tab for the full spectral comparison.
                      </div>
                    </div>

                    {/* Reverb type */}
                    <div
                      style={{
                        border: '1px solid rgba(168,161,150,0.1)',
                        borderRadius: '2px',
                        padding: '12px 14px',
                        background: 'rgba(255,255,255,0.015)',
                        marginBottom: 12,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 9,
                          letterSpacing: '0.14em',
                          textTransform: 'uppercase',
                          color: 'rgba(208,176,102,0.6)',
                          marginBottom: 6,
                        }}
                      >
                        Reverb Type Identified
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(220,215,205,0.85)', marginBottom: 6 }}>
                        {blindTest.earTraining.reverbType
                          ? blindTest.earTraining.reverbType === 'none'
                            ? 'No noticeable reverb'
                            : blindTest.earTraining.reverbType.charAt(0).toUpperCase() +
                              blindTest.earTraining.reverbType.slice(1)
                          : '—'}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(168,161,150,0.55)', lineHeight: 1.5 }}>
                        Compare with the Methodology notes from your session.
                      </div>
                    </div>

                    {/* Mono prediction */}
                    <div
                      style={{
                        border: '1px solid rgba(168,161,150,0.1)',
                        borderRadius: '2px',
                        padding: '12px 14px',
                        background: 'rgba(255,255,255,0.015)',
                        marginBottom: 12,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 9,
                          letterSpacing: '0.14em',
                          textTransform: 'uppercase',
                          color: 'rgba(208,176,102,0.6)',
                          marginBottom: 6,
                        }}
                      >
                        Mono Prediction
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(220,215,205,0.85)', marginBottom: 8 }}>
                        {blindTest.earTraining.monoPrediction === 'sub_loss'
                          ? 'Sub / bass energy — Low end thins out'
                          : blindTest.earTraining.monoPrediction === 'mid_fullness'
                          ? 'Midrange fullness — Mid instruments lose body'
                          : blindTest.earTraining.monoPrediction === 'stereo_collapse'
                          ? 'Stereo spread collapses — Panned elements move to centre'
                          : blindTest.earTraining.monoPrediction === 'nothing'
                          ? 'Nothing significant — Mono-safe mix'
                          : '—'}
                      </div>
                      {(() => {
                        const monoCompat =
                          ar.mono_compat_b ?? ar.mono_compat_pct_b ?? null
                        if (monoCompat == null) return null
                        const contextMsg =
                          monoCompat < 85
                            ? 'Your mix lost significant content in mono — check Step 4 (Stereo & Phase)'
                            : monoCompat >= 95
                            ? 'Your mix is highly mono-compatible'
                            : 'Moderate mono compatibility — some content affected'
                        return (
                          <div
                            style={{
                              fontSize: 11,
                              color: monoCompat < 85
                                ? 'rgba(208,176,102,0.8)'
                                : 'rgba(168,161,150,0.65)',
                              lineHeight: 1.5,
                              marginBottom: 6,
                            }}
                          >
                            {contextMsg}
                          </div>
                        )
                      })()}
                    </div>

                    {/* Ear training note */}
                    <div
                      style={{
                        padding: '10px 14px',
                        border: '1px solid rgba(168,161,150,0.08)',
                        borderRadius: '2px',
                        background: 'rgba(255,255,255,0.01)',
                      }}
                    >
                      <p
                        style={{
                          fontSize: 11,
                          color: 'rgba(168,161,150,0.55)',
                          margin: 0,
                          lineHeight: 1.65,
                        }}
                      >
                        Frequency identification is the most-tested skill in professional ear training (Golden Ears,
                        Berklee ear training). Review the Tonal Balance tab to see how your frequency perception
                        compares to the spectrum analysis.
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Show locked predictions when not yet revealed */}
            {!blindTest?.revealed && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {resultRows.map(row => {
                  const choiceLabel =
                    row.yourChoice === 'A' ? labelA
                    : row.yourChoice === 'B' ? labelB
                    : row.yourChoice === 'equal' ? 'Equal'
                    : '—'
                  return (
                    <div
                      key={row.dimension}
                      style={{
                        display: 'flex',
                        gap: 16,
                        padding: '8px 12px',
                        background: 'rgba(255,255,255,0.015)',
                        border: '1px solid rgba(168,161,150,0.08)',
                        borderRadius: '2px',
                        alignItems: 'center',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          letterSpacing: '0.14em',
                          textTransform: 'uppercase',
                          color: 'rgba(208,176,102,0.6)',
                          width: 140,
                          flexShrink: 0,
                        }}
                      >
                        {row.label}
                      </span>
                      <span style={{ fontSize: 12, color: 'rgba(220,215,205,0.8)' }}>
                        {choiceLabel}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Reset link */}
            <div style={{ marginTop: 28 }}>
              <button
                onClick={handleReset}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(168,161,150,0.45)',
                  fontSize: 11,
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline',
                  textDecorationColor: 'rgba(168,161,150,0.2)',
                }}
            >
              {resetPending ? '⚠ Click again to confirm reset' : 'Reset Blind Test'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
