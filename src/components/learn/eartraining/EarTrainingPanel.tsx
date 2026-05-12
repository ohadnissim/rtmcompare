/**
 * Ear Training Panel — full-screen Golden Ears-style overlay.
 *
 * Three screens:
 *   1. HOME       — drill selector grid + overall stats + reset
 *   2. DRILL      — active drill question + answer reveal
 *   3. HEAT_MAP   — weak-band visualisation
 *
 * Renders inside Learn Mode only. Opened from GuidedFlowBar's "🎼 Ear Training"
 * button. State persists to localStorage via progressStore.
 */

import React from 'react'
import type {
  EarTrainingDrillId,
  EarTrainingDifficulty,
  EarTrainingProgress,
} from '../../../types'
import {
  DRILL_PROGRESSION,
  DRILL_LABELS,
  DRILL_DESCRIPTIONS,
  loadProgress,
  saveProgress,
  recordAttempt,
  resetProgress,
  overallAccuracy,
  drillAccuracy,
  weakBands,
  DIFFICULTY_ORDER,
} from './progressStore'
import {
  getEarTrainingEngine,
  OCTAVE_BANDS,
  THIRD_OCTAVE_BANDS,
  DIFFICULTY_GAIN_DB,
  DEFAULT_Q,
  NARROW_Q,
  WIDE_Q,
  pickRandom,
  REFERENCE_CLIPS,
} from './audioEngine'
import type { ReferenceClipId, PlayHandle } from './audioEngine'

interface Props {
  onClose: () => void
  /** File A path — used as the audio source for drills. */
  fileAPath?: string | null
  fileAName?: string
}

type Screen = 'home' | 'drill' | 'heatmap'

// ─── Drill question types ────────────────────────────────────────────────────

type DrillQuestion =
  | { kind: 'frequency_id'; bandId: string; freq: number; direction: 'boost' | 'cut'; gainDB: number; q: number }
  | { kind: 'eq_direction'; bandId: string; freq: number; direction: 'boost' | 'cut'; gainDB: number }
  | { kind: 'q_width'; bandId: string; freq: number; qChoice: 'narrow' | 'wide'; q: number; gainDB: number }
  | { kind: 'compression'; isCompressed: boolean }
  | { kind: 'reverb_time'; lengthChoice: 'short' | 'long'; decaySec: number }
  | { kind: 'distortion'; isDistorted: boolean; drive: number }

function generateQuestion(drill: EarTrainingDrillId, difficulty: EarTrainingDifficulty): DrillQuestion {
  const gainDB = DIFFICULTY_GAIN_DB[difficulty]
  const bands = difficulty === 'advanced' ? THIRD_OCTAVE_BANDS : OCTAVE_BANDS
  switch (drill) {
    case 'frequency_id': {
      const band = pickRandom(bands)
      const direction = Math.random() < 0.5 ? 'boost' : 'cut'
      return {
        kind: 'frequency_id',
        bandId: band.id,
        freq: band.hz,
        direction,
        gainDB: direction === 'boost' ? gainDB : -gainDB,
        q: DEFAULT_Q,
      }
    }
    case 'eq_direction': {
      const band = pickRandom(bands)
      const direction = Math.random() < 0.5 ? 'boost' : 'cut'
      return {
        kind: 'eq_direction',
        bandId: band.id,
        freq: band.hz,
        direction,
        gainDB: direction === 'boost' ? gainDB : -gainDB,
      }
    }
    case 'q_width': {
      const band = pickRandom(bands)
      const qChoice = Math.random() < 0.5 ? 'narrow' : 'wide'
      return {
        kind: 'q_width',
        bandId: band.id,
        freq: band.hz,
        qChoice,
        q: qChoice === 'narrow' ? NARROW_Q : WIDE_Q,
        gainDB,  // always a boost — we're testing Q recognition, not direction
      }
    }
    case 'compression': {
      const isCompressed = Math.random() < 0.5
      return { kind: 'compression', isCompressed }
    }
    case 'reverb_time': {
      const lengthChoice = Math.random() < 0.5 ? 'short' : 'long'
      const decaySec = lengthChoice === 'short' ? 0.6 : 2.6
      return { kind: 'reverb_time', lengthChoice, decaySec }
    }
    case 'distortion': {
      const isDistorted = Math.random() < 0.5
      const drive = difficulty === 'beginner' ? 0.7 : difficulty === 'intermediate' ? 0.4 : 0.22
      return { kind: 'distortion', isDistorted, drive }
    }
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function EarTrainingPanel({ onClose, fileAPath, fileAName }: Props) {
  const [screen, setScreen] = React.useState<Screen>('home')
  const [progress, setProgress] = React.useState<EarTrainingProgress>(() => loadProgress())
  const [activeDrill, setActiveDrill] = React.useState<EarTrainingDrillId>('frequency_id')
  const [activeDifficulty, setActiveDifficulty] = React.useState<EarTrainingDifficulty>('beginner')
  const [question, setQuestion] = React.useState<DrillQuestion | null>(null)
  const [userAnswer, setUserAnswer] = React.useState<string | null>(null)
  const [revealed, setRevealed] = React.useState(false)
  const [sourceLoaded, setSourceLoaded] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [playingLabel, setPlayingLabel] = React.useState<string | null>(null)
  // Pink noise is the default — it's the Golden Ears standard for frequency ID
  // and doesn't require File A to be loaded.
  const [activeClip, setActiveClipState] = React.useState<ReferenceClipId>('pink_noise')

  const engine = React.useMemo(() => getEarTrainingEngine(), [])

  // Load File A only when the user picks it as the source (procedural clips don't need a file).
  // MED-21 fix: track the current activeClip via ref so the resolved `then` callback can
  // bail if the user switched clips mid-load. Previously the stale callback would call
  // engine.setActiveClip('loaded_file_a') even after the user picked pink_noise, desyncing
  // the engine from the UI.
  const activeClipRef = React.useRef<ReferenceClipId>(activeClip)
  React.useEffect(() => { activeClipRef.current = activeClip }, [activeClip])
  React.useEffect(() => {
    if (activeClip !== 'loaded_file_a') {
      engine.setActiveClip(activeClip)
      setSourceLoaded(true)
      setLoadError(null)
      return
    }
    let cancelled = false
    if (!fileAPath) {
      setLoadError('Load File A in the main view first, or pick a procedural source.')
      setSourceLoaded(false)
      return
    }
    engine.loadSource(fileAPath, fileAName).then(
      () => {
        if (cancelled) return
        // MED-21: only commit the load if the user is STILL on loaded_file_a.
        if (activeClipRef.current !== 'loaded_file_a') return
        engine.setActiveClip('loaded_file_a')
        setSourceLoaded(true)
        setLoadError(null)
      },
      (err) => { if (!cancelled) setLoadError(err?.message || 'Failed to load audio') }
    )
    return () => { cancelled = true; engine.stop() }
  }, [activeClip, fileAPath, fileAName, engine])

  // Stop audio when leaving the panel.
  React.useEffect(() => () => { engine.stop() }, [engine])

  // MED-27 fix: pre-warm the procedural buffer in idle time so the FIRST play
  // doesn't block the UI for 150-300ms on slow machines. We trigger
  // engine.playReference() with a 0ms-window proxy... actually simpler: just
  // touch getCurrentBuffer via a tiny silent prepare call. The engine caches
  // procedural buffers after first generation, so subsequent plays are instant.
  React.useEffect(() => {
    if (!sourceLoaded) return
    const w = window as any
    const ric: (cb: () => void) => number = w.requestIdleCallback || ((cb: () => void) => setTimeout(cb, 200))
    const cic: (id: number) => void = w.cancelIdleCallback || clearTimeout
    const id = ric(() => {
      // engine.prepare() just touches the cache — no audio plays.
      engine.prepare()
    })
    return () => { try { cic(id) } catch {} }
  }, [sourceLoaded, activeClip, engine])

  // Persist progress on every change.
  // MED-26 fix: debounce saveProgress. Previously fired on every render that
  // mutated progress — every drill answer triggered a sync localStorage write
  // (5-20ms stall). Now waits 300ms; if the user racks up answers quickly only
  // the final state is written. The cleanup also fires saveProgress so we
  // don't lose state on rapid panel close.
  React.useEffect(() => {
    const t = setTimeout(() => saveProgress(progress), 300)
    return () => {
      clearTimeout(t)
      // best-effort: write immediately on cleanup so closing the panel doesn't
      // discard the most recent answer
      saveProgress(progress)
    }
  }, [progress])

  // ── Drill helpers ──────────────────────────────────────────────
  function startDrill(drillId: EarTrainingDrillId, difficulty: EarTrainingDifficulty) {
    setActiveDrill(drillId)
    setActiveDifficulty(difficulty)
    setQuestion(generateQuestion(drillId, difficulty))
    setUserAnswer(null)
    setRevealed(false)
    setScreen('drill')
  }

  function nextQuestion() {
    setQuestion(generateQuestion(activeDrill, activeDifficulty))
    setUserAnswer(null)
    setRevealed(false)
  }

  function answer(option: string) {
    if (revealed || !question) return
    const correct = isCorrect(question, option)
    setUserAnswer(option)
    setRevealed(true)
    // Use a stable option id for stats — for frequency_id we want the band, not just the answer.
    const optionId =
      question.kind === 'frequency_id' ? question.bandId :
      question.kind === 'eq_direction' ? question.direction :
      question.kind === 'q_width'      ? question.qChoice :
      question.kind === 'compression'  ? (question.isCompressed ? 'compressed' : 'uncompressed') :
      question.kind === 'reverb_time'  ? question.lengthChoice :
      question.kind === 'distortion'   ? (question.isDistorted ? 'distorted' : 'clean') :
      'unknown'
    setProgress(p => recordAttempt(p, activeDrill, activeDifficulty, optionId, correct))
  }

  // ── Audio playback handlers ────────────────────────────────────
  // MED-23 fix: wrap every play in try/finally so playingLabel always clears,
  // even if the engine throws (e.g. AudioContext was closed by an external dispose).
  async function playReference() {
    setPlayingLabel('Reference')
    try {
      await engine.playReference(6).done
    } finally {
      setPlayingLabel(null)
    }
  }

  // MED-22 fix: explicit type annotation on `handle` + exhaustiveness default.
  // Previously `let handle` was implicit any; if a new drill kind was added to the
  // type but not handled here, `handle` stayed undefined and `await handle.done`
  // threw a TypeError. Now TS enforces the discriminated-union check and the
  // default branch throws a clear error.
  async function playProcessed() {
    if (!question) return
    setPlayingLabel('Modified')
    try {
      let handle: PlayHandle
      switch (question.kind) {
        case 'frequency_id':
        case 'eq_direction':
          handle = engine.playWithEQ({ freq: question.freq, gainDB: question.gainDB, q: DEFAULT_Q })
          break
        case 'q_width':
          handle = engine.playWithEQ({ freq: question.freq, gainDB: question.gainDB, q: question.q })
          break
        case 'compression':
          handle = question.isCompressed
            ? engine.playWithCompression({ threshold: -20, ratio: 8, attack: 0.003, release: 0.1, makeup: 6 })
            : engine.playReference()
          break
        case 'reverb_time':
          handle = engine.playWithReverb({ decaySec: question.decaySec, mix: 0.45 })
          break
        case 'distortion':
          handle = question.isDistorted
            ? engine.playWithDistortion({ drive: question.drive })
            : engine.playReference()
          break
        default: {
          const _exhaustive: never = question
          throw new Error(`Unhandled drill kind: ${(_exhaustive as { kind: string }).kind}`)
        }
      }
      await handle.done
    } finally {
      setPlayingLabel(null)
    }
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div
      data-eartraining-open="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        background: 'rgba(14,13,11,0.97)',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 36px',
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', color: 'rgba(208,176,102,0.7)', textTransform: 'uppercase', marginBottom: 4 }}>
            🎼 Ear Training — Golden Ears Curriculum
          </div>
          <div style={{ fontSize: 22, color: 'var(--color-text-primary)', fontFamily: 'var(--font-display, serif)', fontStyle: 'italic' }}>
            {screen === 'home' && 'Train your ears, one band at a time.'}
            {screen === 'drill' && DRILL_LABELS[activeDrill] + ` — ${activeDifficulty}`}
            {screen === 'heatmap' && 'Weak Bands Heat Map'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {screen !== 'home' && (
            <button onClick={() => { engine.stop(); setScreen('home') }} style={navBtnStyle}>← Home</button>
          )}
          <button onClick={() => { engine.stop(); onClose() }} style={navBtnStyle}>× Close</button>
        </div>
      </div>

      {loadError && (
        <div style={{ background: 'rgba(220,80,60,0.1)', border: '1px solid rgba(220,80,60,0.4)', padding: 12, borderRadius: 2, color: '#e07060', marginBottom: 20 }}>
          {loadError}
        </div>
      )}

      {!sourceLoaded && !loadError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'rgba(168,161,150,0.7)', fontSize: 13, fontStyle: 'italic' }}>
          <span style={{
            display: 'inline-block', width: 14, height: 14, borderRadius: '50%',
            border: '2px solid rgba(208,176,102,0.25)',
            borderTopColor: 'rgba(208,176,102,0.85)',
            animation: 'rtm-et-spin 0.9s linear infinite',
          }} aria-hidden="true" />
          Loading audio source… (procedural clips are always instant — switch source above if your file is large)
          {/* NIT-6: spinner + timeout hint. Was a bare italic string with no
              animation and no fallback CTA — slow loads looked frozen. */}
          <style>{`@keyframes rtm-et-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {sourceLoaded && screen === 'home' && (
        <HomeScreen
          progress={progress}
          activeClip={activeClip}
          fileAvailable={!!fileAPath}
          onClipChange={(id) => setActiveClipState(id)}
          onStartDrill={startDrill}
          onOpenHeatMap={() => setScreen('heatmap')}
          onReset={() => { if (confirm('Reset all ear training progress?')) setProgress(resetProgress()) }}
        />
      )}

      {sourceLoaded && screen === 'drill' && question && (
        <DrillScreen
          drill={activeDrill}
          difficulty={activeDifficulty}
          question={question}
          revealed={revealed}
          userAnswer={userAnswer}
          playingLabel={playingLabel}
          onPlayReference={playReference}
          onPlayProcessed={playProcessed}
          onAnswer={answer}
          onNext={nextQuestion}
          drillStats={progress.drills[activeDrill]}
        />
      )}

      {sourceLoaded && screen === 'heatmap' && (
        <HeatMapScreen progress={progress} />
      )}
    </div>
  )
}

// ─── Home screen — drill selector ────────────────────────────────────────────

function HomeScreen({ progress, activeClip, fileAvailable, onClipChange, onStartDrill, onOpenHeatMap, onReset }: {
  progress: EarTrainingProgress
  activeClip: ReferenceClipId
  fileAvailable: boolean
  onClipChange: (id: ReferenceClipId) => void
  onStartDrill: (d: EarTrainingDrillId, df: EarTrainingDifficulty) => void
  onOpenHeatMap: () => void
  onReset: () => void
}) {
  const overall = overallAccuracy(progress)
  return (
    <div>
      {/* Stats bar */}
      <div style={{
        display: 'flex', gap: 24, padding: '14px 18px', marginBottom: 18,
        background: 'rgba(208,176,102,0.04)', border: '1px solid rgba(208,176,102,0.12)', borderRadius: 2,
      }}>
        <StatBlock label="Overall accuracy" value={progress.totalAttempts > 0 ? `${(overall * 100).toFixed(0)}%` : '—'} />
        <StatBlock label="Total drills" value={String(progress.totalAttempts)} />
        <StatBlock label="Correct" value={String(progress.totalCorrect)} />
        <StatBlock label="Drills unlocked" value={`${progress.unlocked.length} of ${DRILL_PROGRESSION.length}`} />
        <div style={{ flex: 1 }} />
        <button onClick={onOpenHeatMap} style={navBtnStyle}>Heat Map →</button>
        <button onClick={onReset} style={{ ...navBtnStyle, color: 'rgba(220,80,60,0.75)', borderColor: 'rgba(220,80,60,0.35)' }}>Reset</button>
      </div>

      {/* Source clip selector — Golden Ears uses pink noise; we also offer drums,
          vocal-shaped noise, synth mix, and the student's loaded File A. */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(208,176,102,0.55)', marginBottom: 8 }}>
          Source material
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {REFERENCE_CLIPS.map(clip => {
            const disabled = clip.id === 'loaded_file_a' && !fileAvailable
            const active = clip.id === activeClip
            return (
              <button
                key={clip.id}
                disabled={disabled}
                onClick={() => onClipChange(clip.id)}
                title={clip.description}
                style={{
                  padding: '6px 12px',
                  background: active ? 'rgba(208,176,102,0.12)' : 'transparent',
                  border: `1px solid ${active ? 'rgba(208,176,102,0.7)' : 'rgba(168,161,150,0.25)'}`,
                  borderRadius: 2,
                  color: disabled ? 'rgba(168,161,150,0.3)' : active ? 'var(--color-accent)' : 'rgba(168,161,150,0.85)',
                  fontSize: 11,
                  letterSpacing: '0.05em',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 2,
                  minWidth: 130,
                }}
              >
                <span>{clip.label}</span>
                <span style={{ fontSize: 9, color: 'rgba(168,161,150,0.55)', letterSpacing: '0.02em' }}>
                  {clip.description}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Drill grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 14 }}>
        {DRILL_PROGRESSION.map(drillId => {
          const unlocked = progress.unlocked.includes(drillId)
          const stats = progress.drills[drillId]
          const acc = drillAccuracy(stats)
          const unlockedDifficulty = progress.unlockedDifficulty[drillId]
          const unlockedIdx = DIFFICULTY_ORDER.indexOf(unlockedDifficulty)
          return (
            <div
              key={drillId}
              style={{
                background: unlocked ? 'rgba(208,176,102,0.05)' : 'rgba(168,161,150,0.04)',
                border: `1px solid ${unlocked ? 'rgba(208,176,102,0.25)' : 'rgba(168,161,150,0.12)'}`,
                borderRadius: 2,
                padding: 16,
                opacity: unlocked ? 1 : 0.55,
              }}
            >
              <div style={{
                fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
                color: unlocked ? 'var(--color-accent)' : 'rgba(168,161,150,0.5)',
                marginBottom: 6,
              }}>
                {unlocked ? '✓ Unlocked' : '🔒 Locked'}
              </div>
              <div style={{ fontSize: 16, color: 'var(--color-text-primary)', fontWeight: 500, marginBottom: 4 }}>
                {DRILL_LABELS[drillId]}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(168,161,150,0.7)', marginBottom: 12, lineHeight: 1.4 }}>
                {DRILL_DESCRIPTIONS[drillId]}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(168,161,150,0.55)', marginBottom: 8 }}>
                {stats.attempts > 0 ? `${stats.correct}/${stats.attempts} correct · ${(acc * 100).toFixed(0)}% · best streak ${stats.bestStreak}` : 'No attempts yet'}
              </div>
              {unlocked && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {DIFFICULTY_ORDER.map((diff, i) => {
                    const accessible = i <= unlockedIdx
                    return (
                      <button
                        key={diff}
                        disabled={!accessible}
                        onClick={() => onStartDrill(drillId, diff)}
                        style={{
                          padding: '5px 11px',
                          background: accessible ? 'rgba(208,176,102,0.08)' : 'transparent',
                          border: `1px solid ${accessible ? 'rgba(208,176,102,0.4)' : 'rgba(168,161,150,0.18)'}`,
                          borderRadius: 2,
                          color: accessible ? 'var(--color-text-primary)' : 'rgba(168,161,150,0.4)',
                          fontSize: 10,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          cursor: accessible ? 'pointer' : 'not-allowed',
                        }}
                      >
                        {diff}{!accessible && ' 🔒'}
                      </button>
                    )
                  })}
                </div>
              )}
              {!unlocked && (
                <div style={{ fontSize: 10, fontStyle: 'italic', color: 'rgba(168,161,150,0.5)' }}>
                  Reach 70% on Advanced of the previous drill to unlock.
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(168,161,150,0.55)', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, color: 'var(--color-text-primary)', fontFamily: 'var(--font-display, serif)' }}>
        {value}
      </div>
    </div>
  )
}

// ─── Drill screen — active question ──────────────────────────────────────────

function DrillScreen({
  drill, difficulty, question, revealed, userAnswer, playingLabel,
  onPlayReference, onPlayProcessed, onAnswer, onNext, drillStats,
}: {
  drill: EarTrainingDrillId
  difficulty: EarTrainingDifficulty
  question: DrillQuestion
  revealed: boolean
  userAnswer: string | null
  playingLabel: string | null
  onPlayReference: () => void
  onPlayProcessed: () => void
  onAnswer: (option: string) => void
  onNext: () => void
  drillStats: any
}) {
  const options = getDrillOptions(drill, difficulty, question)
  const correctOption = getCorrectOption(question)
  const wasCorrect = revealed && userAnswer === correctOption

  return (
    <div style={{ maxWidth: 880, width: '100%' }}>
      {/* Streak banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div style={{ fontSize: 11, color: 'rgba(168,161,150,0.6)' }}>
          Streak: <span style={{ color: 'var(--color-accent)', fontWeight: 600 }}>{drillStats.streak}</span>
          {' · '}Best: {drillStats.bestStreak}
          {' · '}Accuracy: {drillStats.attempts > 0 ? `${((drillStats.correct / drillStats.attempts) * 100).toFixed(0)}%` : '—'}
        </div>
      </div>

      {/* Playback row */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 28 }}>
        <PlayButton label="▶ Reference" onClick={onPlayReference} active={playingLabel === 'Reference'} />
        <PlayButton label="▶ Modified" onClick={onPlayProcessed} active={playingLabel === 'Modified'} primary />
      </div>

      {/* Question */}
      <div style={{ fontSize: 14, color: 'rgba(168,161,150,0.8)', marginBottom: 16, fontStyle: 'italic' }}>
        {getDrillPrompt(drill)}
      </div>

      {/* Options grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: options.length > 8
          ? 'repeat(auto-fill, minmax(110px, 1fr))'
          : options.length > 2
            ? 'repeat(auto-fill, minmax(140px, 1fr))'
            : 'repeat(2, 1fr)',
        gap: 8,
        marginBottom: 28,
      }}>
        {options.map(opt => {
          const isCorrect = revealed && opt.value === correctOption
          const isWrongPick = revealed && opt.value === userAnswer && userAnswer !== correctOption
          return (
            <button
              key={opt.value}
              onClick={() => onAnswer(opt.value)}
              disabled={revealed}
              style={{
                padding: '11px 14px',
                background: isCorrect ? 'rgba(123,196,158,0.15)' : isWrongPick ? 'rgba(220,80,60,0.15)' : 'rgba(208,176,102,0.04)',
                border: `1px solid ${isCorrect ? 'rgba(123,196,158,0.6)' : isWrongPick ? 'rgba(220,80,60,0.5)' : 'rgba(208,176,102,0.25)'}`,
                borderRadius: 2,
                color: isCorrect ? '#7bc49e' : isWrongPick ? '#e07060' : 'var(--color-text-primary)',
                fontSize: 13,
                cursor: revealed ? 'default' : 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.15s',
              }}
            >
              {opt.label}{isCorrect && ' ✓'}{isWrongPick && ' ✗'}
            </button>
          )
        })}
      </div>

      {/* Reveal */}
      {revealed && (
        <div style={{
          padding: '14px 18px',
          background: wasCorrect ? 'rgba(123,196,158,0.06)' : 'rgba(220,80,60,0.06)',
          border: `1px solid ${wasCorrect ? 'rgba(123,196,158,0.3)' : 'rgba(220,80,60,0.3)'}`,
          borderRadius: 2,
          marginBottom: 18,
        }}>
          <div style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: wasCorrect ? '#7bc49e' : '#e07060', marginBottom: 6 }}>
            {wasCorrect ? '✓ Correct' : '✗ Not quite'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-primary)', lineHeight: 1.5 }}>
            {explainAnswer(question, drill)}
          </div>
        </div>
      )}

      {revealed && (
        <button onClick={onNext} style={{ ...navBtnStyle, fontSize: 12, padding: '8px 18px' }}>
          Next question →
        </button>
      )}
    </div>
  )
}

// ─── Heat map screen ─────────────────────────────────────────────────────────

function HeatMapScreen({ progress }: { progress: EarTrainingProgress }) {
  const fid = weakBands(progress, 'frequency_id')
  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ fontSize: 13, color: 'rgba(168,161,150,0.8)', marginBottom: 18, lineHeight: 1.55 }}>
        Bands where you're least accurate on the Frequency ID drill. Spend more time on the weakest ones —
        these are the EQ bands you're least likely to identify by ear in a real session.
      </div>
      {fid.length === 0 ? (
        <div style={{ color: 'rgba(168,161,150,0.5)', fontStyle: 'italic' }}>
          Not enough data yet. Run the Frequency ID drill at least 3 times per band.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ color: 'rgba(168,161,150,0.55)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              <th style={{ textAlign: 'left', padding: '6px 12px' }}>Band</th>
              <th style={{ textAlign: 'right', padding: '6px 12px' }}>Attempts</th>
              <th style={{ textAlign: 'right', padding: '6px 12px' }}>Accuracy</th>
              <th style={{ padding: '6px 12px' }} />
            </tr>
          </thead>
          <tbody>
            {fid.map(b => (
              <tr key={b.option} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <td style={{ padding: '8px 12px', color: 'var(--color-text-primary)' }}>{b.option}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: 'rgba(168,161,150,0.75)' }}>{b.attempts}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: b.accuracy >= 0.7 ? '#7bc49e' : b.accuracy >= 0.4 ? 'rgba(208,176,102,0.85)' : '#e07060' }}>
                  {(b.accuracy * 100).toFixed(0)}%
                </td>
                <td style={{ padding: '8px 12px', width: '40%' }}>
                  <div style={{ height: 4, background: 'rgba(168,161,150,0.1)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${b.accuracy * 100}%`,
                      background: b.accuracy >= 0.7 ? '#7bc49e' : b.accuracy >= 0.4 ? 'rgba(208,176,102,0.7)' : '#e07060',
                    }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDrillOptions(
  drill: EarTrainingDrillId,
  difficulty: EarTrainingDifficulty,
  _question: DrillQuestion
): Array<{ value: string; label: string }> {
  const bands = difficulty === 'advanced' ? THIRD_OCTAVE_BANDS : OCTAVE_BANDS
  switch (drill) {
    case 'frequency_id': return bands.map(b => ({ value: b.id, label: b.label }))
    case 'eq_direction': return [{ value: 'boost', label: 'Boost' }, { value: 'cut', label: 'Cut' }]
    case 'q_width':      return [{ value: 'narrow', label: 'Narrow Q' }, { value: 'wide', label: 'Wide Q' }]
    case 'compression':  return [{ value: 'compressed', label: 'Compressed' }, { value: 'uncompressed', label: 'Uncompressed' }]
    case 'reverb_time':  return [{ value: 'short', label: 'Short room' }, { value: 'long', label: 'Long hall' }]
    case 'distortion':   return [{ value: 'distorted', label: 'Saturated' }, { value: 'clean', label: 'Clean' }]
  }
}

function getCorrectOption(q: DrillQuestion): string {
  switch (q.kind) {
    case 'frequency_id': return q.bandId
    case 'eq_direction': return q.direction
    case 'q_width':      return q.qChoice
    case 'compression':  return q.isCompressed ? 'compressed' : 'uncompressed'
    case 'reverb_time':  return q.lengthChoice
    case 'distortion':   return q.isDistorted ? 'distorted' : 'clean'
  }
}

function isCorrect(q: DrillQuestion, picked: string): boolean {
  return picked === getCorrectOption(q)
}

function getDrillPrompt(drill: EarTrainingDrillId): string {
  switch (drill) {
    case 'frequency_id': return 'Listen to Reference, then Modified. Which band was changed?'
    case 'eq_direction': return 'Reference vs Modified — was that a boost or a cut?'
    case 'q_width':      return 'How wide was the EQ — narrow surgical notch, or wide bell?'
    case 'compression':  return 'One of these has more compression. Which one?'
    case 'reverb_time':  return 'How long is the reverb tail?'
    case 'distortion':   return 'Was harmonic saturation applied, or is it clean?'
  }
}

function explainAnswer(q: DrillQuestion, _drill: EarTrainingDrillId): string {
  switch (q.kind) {
    case 'frequency_id': return `It was a ${q.direction} of ${q.gainDB.toFixed(0)} dB at ${formatHz(q.freq)}.`
    case 'eq_direction': return `That was a ${q.direction} of ${Math.abs(q.gainDB).toFixed(0)} dB at ${formatHz(q.freq)}.`
    case 'q_width':      return `${q.qChoice === 'narrow' ? 'Narrow' : 'Wide'} Q (${q.q.toFixed(1)}) at ${formatHz(q.freq)}.`
    case 'compression':  return q.isCompressed
      ? 'Compressed: 8:1 ratio, fast attack, +6 dB makeup gain.'
      : 'Uncompressed — straight playback.'
    case 'reverb_time':  return `${q.lengthChoice === 'short' ? 'Short' : 'Long'} reverb — ${q.decaySec.toFixed(1)}s decay.`
    case 'distortion':   return q.isDistorted
      ? `Tanh saturation, drive ${q.drive.toFixed(2)}.`
      : 'Clean signal.'
  }
}

function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : hz % 1000 === 0 ? 0 : 2)} kHz` : `${hz} Hz`
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const navBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  background: 'transparent',
  border: '1px solid rgba(208,176,102,0.3)',
  borderRadius: 2,
  color: 'rgba(168,161,150,0.8)',
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

function PlayButton({ label, onClick, active, primary }: { label: string; onClick: () => void; active?: boolean; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={active}
      style={{
        padding: '11px 22px',
        background: active
          ? 'rgba(208,176,102,0.18)'
          : primary
            ? 'rgba(208,176,102,0.08)'
            : 'transparent',
        border: `1px solid ${primary ? 'rgba(208,176,102,0.55)' : 'rgba(208,176,102,0.3)'}`,
        borderRadius: 2,
        color: 'var(--color-text-primary)',
        fontSize: 13,
        letterSpacing: '0.06em',
        cursor: active ? 'wait' : 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {active ? '▶ Playing…' : label}
    </button>
  )
}
