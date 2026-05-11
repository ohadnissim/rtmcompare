/**
 * BlindTestPanel — full-screen overlay for Learn Mode v4 Blind Test feature.
 *
 * Students answer structured listening questions BEFORE looking at the meters.
 * After submitting, they can reveal the measurements and compare how their
 * ears calibrated against the actual data.
 */

import React from 'react'
import { useLearnMode } from '../../context/LearnModeContext'
import type { BlindTestAnswer, BlindTestPredictions } from '../../types'

interface Props {
  onClose: () => void
  /** Analysis result to compare against after reveal */
  analysisResult: any
  fileAName: string
  fileBName: string
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

// ─── Meter comparison helpers ─────────────────────────────────────────────────

function lufsVerdict(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null || b == null) return 'No loudness data available'
  const delta = a - b
  if (Math.abs(delta) < 0.5) return 'Roughly equal (< 0.5 dB)'
  return delta > 0 ? `A is +${Math.abs(delta).toFixed(1)} dB louder` : `B is +${Math.abs(delta).toFixed(1)} dB louder`
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
  const winner = (higherMeansMore ? delta > 0 : delta < 0) ? labelA : labelB
  return `${winner} ${unit}(${Math.abs(delta).toFixed(1)} difference)`
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

export default function BlindTestPanel({ onClose, analysisResult, fileAName, fileBName }: Props) {
  const { blindTest, submitBlindTest, revealBlindTest, resetBlindTest } = useLearnMode()

  const [answers, setAnswers] = React.useState<Partial<Record<Dimension, BlindTestAnswer>>>(() => {
    if (!blindTest) return {}
    const map: Partial<Record<Dimension, BlindTestAnswer>> = {}
    for (const a of blindTest.answers) map[a.dimension] = a
    return map
  })
  const [notesField, setNotesField] = React.useState<string>(() => {
    if (!blindTest) return ''
    return blindTest.answers.find(a => a.dimension === 'overall')?.notes ?? ''
  })
  const [submitted, setSubmitted] = React.useState<boolean>(() => blindTest != null)

  const labelA = truncate(fileAName)
  const labelB = truncate(fileBName)

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
    // Sync overall notes into the answer before submitting
    const finalAnswers = DIMENSIONS.map(d => ({
      dimension: d.dimension,
      choice: answers[d.dimension]?.choice ?? 'equal',
      notes: d.dimension === 'overall' ? notesField : (answers[d.dimension]?.notes ?? ''),
    }))
    const predictions: BlindTestPredictions = {
      answers: finalAnswers,
      submittedAt: new Date().toISOString(),
      revealed: false,
    }
    submitBlindTest(predictions)
    setSubmitted(true)
  }

  function handleReset() {
    resetBlindTest()
    setAnswers({})
    setNotesField('')
    setSubmitted(false)
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

    return DIMENSIONS.map(({ dimension, label }) => {
      const a = answerFor(dimension)
      const choice = a?.choice
      const notes = a?.notes ?? ''

      let metersText = ''
      let verdict: 'match' | 'mismatch' | 'neutral' = 'neutral'

      switch (dimension) {
        case 'loudness': {
          metersText = lufsVerdict(ar.lufs_i_a, ar.lufs_i_b)
          verdict = matchLufs(choice ?? 'equal', ar.lufs_i_a, ar.lufs_i_b)
          break
        }
        case 'tonal_low': {
          metersText = 'See Tonal Balance tab for detail'
          verdict = 'neutral'
          break
        }
        case 'tonal_bright': {
          metersText = 'See Tonal Balance tab for detail'
          verdict = 'neutral'
          break
        }
        case 'stereo_width': {
          metersText = deltaVerdict(ar.stereo_width_a, ar.stereo_width_b, 'A', 'B', true, 'wider ')
          verdict = matchDelta(choice ?? 'equal', ar.stereo_width_a, ar.stereo_width_b, true)
          break
        }
        case 'dynamics': {
          // Higher LRA = less compressed; lower = more compressed
          // Question asks "which is MORE compressed" → lower LRA = more compressed → B wins if lra_b < lra_a
          metersText = deltaVerdict(ar.lra_a, ar.lra_b, 'B', 'A', false, 'more compressed ')
          verdict = matchDelta(choice ?? 'equal', ar.lra_a, ar.lra_b, false)
          break
        }
        case 'translation': {
          // Higher mono compat % = better translation
          metersText = deltaVerdict(ar.mono_compat_a, ar.mono_compat_b, 'A', 'B', true, 'better translation ')
          verdict = matchDelta(choice ?? 'equal', ar.mono_compat_a, ar.mono_compat_b, true)
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
  }, [blindTest, ar])

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
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'rgba(208,176,102,0.9)',
                marginBottom: 6,
              }}
            >
              🎧  BLIND TEST — Trust Your Ears First
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
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* ── Scrollable body ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 40px' }}>

        {/* ── SECTION B: Questions ──────────────────────────────────────── */}
        {!showResults && (
          <div style={{ maxWidth: 740 }}>
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
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: 'rgba(208,176,102,0.7)',
                      marginBottom: 6,
                    }}
                  >
                    {label}
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
                        setAnswers(prev => ({
                          ...prev,
                          overall: {
                            dimension: 'overall',
                            choice: prev.overall?.choice ?? 'equal',
                            notes: e.target.value,
                          },
                        }))
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
                  letterSpacing: '0.1em',
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
                      letterSpacing: '0.1em',
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
                <button
                  onClick={revealBlindTest}
                  style={{
                    background: 'rgba(208,176,102,0.07)',
                    border: '1px solid rgba(208,176,102,0.6)',
                    borderRadius: '2px',
                    color: 'rgba(208,176,102,1)',
                    fontSize: 11,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    padding: '8px 18px',
                    cursor: 'pointer',
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
                        letterSpacing: '0.12em',
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
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: 'rgba(208,176,102,0.6)',
                      marginBottom: 4,
                    }}
                  >
                    Calibration Score
                  </div>
                  <div style={{ fontSize: 13, color: 'rgba(220,215,205,0.85)' }}>
                    You correctly predicted {correctCount} of {measurableTotal} measurable dimensions.
                  </div>
                </div>
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
                          letterSpacing: '0.08em',
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
                Reset Blind Test
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
