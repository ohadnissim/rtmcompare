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
import PanelInfo from '../../PanelInfo'
import type {
  EarTrainingDrillId,
  EarTrainingDifficulty,
  EarTrainingProgress,
} from '../../../types'
import InfoTip from '../InfoTip'
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
  /** Pre-select a band ID and auto-start the frequency_id drill (from "Train This →"). */
  preSelectBandId?: string | null
}

type Screen = 'home' | 'drill' | 'heatmap'

// ─── Drill question types ────────────────────────────────────────────────────

type DrillQuestion =
  | { kind: 'loudness_match'; deltaDb: number; choices: number[]; correctIdx: number }
  | { kind: 'frequency_id'; bandId: string; freq: number; direction: 'boost' | 'cut'; gainDB: number; q: number }
  | { kind: 'eq_direction'; bandId: string; freq: number; direction: 'boost' | 'cut'; gainDB: number }
  | { kind: 'q_width'; bandId: string; freq: number; qChoice: 'narrow' | 'wide'; q: number; gainDB: number }
  | { kind: 'compression'; isCompressed: boolean }
  | { kind: 'reverb_time'; lengthChoice: 'short' | 'long'; decaySec: number }
  | { kind: 'distortion'; isDistorted: boolean; drive: number }

function generateQuestion(drill: EarTrainingDrillId, difficulty: EarTrainingDifficulty): DrillQuestion {
  const gainDB = DIFFICULTY_GAIN_DB[difficulty]
  const bands = difficulty === 'advanced' ? THIRD_OCTAVE_BANDS : OCTAVE_BANDS
  if (drill === 'loudness_match') {
    const pools: Record<EarTrainingDifficulty, number[]> = {
      beginner:     [-12, -9, -6, -3, 3, 6, 9, 12],
      intermediate: [-6, -4, -2, 2, 4, 6],
      advanced:     [-3, -2, -1, 1, 2, 3],
    }
    const pool = pools[difficulty]
    const deltaDb = pool[Math.floor(Math.random() * pool.length)]
    // Generate 4 choices: correct + 3 nearby wrong ones from pool
    const others = pool.filter(v => v !== deltaDb)
    const shuffled = others.sort(() => Math.random() - 0.5).slice(0, 3)
    const choices = [...shuffled, deltaDb].sort((a, b) => a - b)
    const correctIdx = choices.indexOf(deltaDb)
    return { kind: 'loudness_match', deltaDb, choices, correctIdx }
  }
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

export default function EarTrainingPanel({ onClose, fileAPath, fileAName, preSelectBandId }: Props) {
  const [screen, setScreen] = React.useState<Screen>('home')
  const [progress, setProgress] = React.useState<EarTrainingProgress>(() => loadProgress())
  const [activeDrill, setActiveDrill] = React.useState<EarTrainingDrillId>('frequency_id')
  const [activeDifficulty, setActiveDifficulty] = React.useState<EarTrainingDifficulty>('beginner')
  const [question, setQuestion] = React.useState<DrillQuestion | null>(null)
  const [userAnswer, setUserAnswer] = React.useState<string | null>(null)
  const [revealed, setRevealed] = React.useState(false)
  // LM-ET-1: allow students to browse their own file directly inside the panel,
  // without needing to load File A in the main comparison view first.
  const [localFilePath, setLocalFilePath] = React.useState<string | null>(null)
  const [localFileName, setLocalFileName] = React.useState<string | undefined>(undefined)
  // Effective path: panel-local pick takes priority over the parent's fileAPath.
  const effectiveFilePath = localFilePath ?? fileAPath
  const effectiveFileName = localFileName ?? fileAName

  const handleBrowseFile = React.useCallback(async () => {
    const filePath = await window.electronAPI?.selectFile?.()
    if (!filePath) return
    const name = filePath.split('/').pop() ?? filePath
    setLocalFilePath(filePath)
    setLocalFileName(name)
    setActiveClipState('loaded_file_a')
  }, [])
  // MED: initialize to true for procedural clips (pink_noise default) — avoids a
  // flash of the loading spinner before the mount effect fires and sets it true.
  // NIT-2: this value is coupled to the DEFAULT_CLIP being 'pink_noise' (a
  // procedural/synthetic source that needs no file load). If DEFAULT_CLIP is
  // ever changed to a file-backed clip, this must be changed back to false, or
  // the spinner will be skipped and the component may try to play before load.
  const [sourceLoaded, setSourceLoaded] = React.useState<boolean>(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [playingLabel, setPlayingLabel] = React.useState<string | null>(null)
  // Generation counter: incremented on every new play. The finally block only
  // clears playingLabel when its own generation is still current — prevents
  // the race where clicking Modified while Reference is playing causes Reference's
  // onended to fire and wipe out the freshly-set 'Modified' label.
  const playGenRef = React.useRef(0)
  // Pink noise is the default — it's the Golden Ears standard for frequency ID
  // and doesn't require File A to be loaded.
  const [activeClip, setActiveClipState] = React.useState<ReferenceClipId>('pink_noise')
  const [confirmReset, setConfirmReset] = React.useState(false)  // LOW: replace confirm()
  const confirmDialogRef = React.useCallback((el: HTMLDivElement | null) => el?.focus(), [])

  const engine = React.useMemo(() => getEarTrainingEngine(), [])

  // Load File A only when the user picks it as the source (procedural clips don't need a file).
  // MED-21 fix: track the current activeClip via ref so the resolved `then` callback can
  // bail if the user switched clips mid-load. Previously the stale callback would call
  // engine.setActiveClip('loaded_file_a') even after the user picked pink_noise, desyncing
  // the engine from the UI.
  const activeClipRef = React.useRef<ReferenceClipId>(activeClip)
  // CRIT-3: ref that always holds the latest progress so the unmount flush
  // can write it without capturing a stale closure value.
  const latestProgressRef = React.useRef(progress)
  React.useEffect(() => { activeClipRef.current = activeClip }, [activeClip])
  React.useEffect(() => {
    if (activeClip !== 'loaded_file_a') {
      engine.setActiveClip(activeClip)
      setSourceLoaded(true)
      setLoadError(null)
      return
    }
    let cancelled = false
    if (!effectiveFilePath) {
      setLoadError('Drop a file on File A or click "Browse…" to load your own audio.')
      setSourceLoaded(false)
      return
    }
    setSourceLoaded(false)
    engine.loadSource(effectiveFilePath, effectiveFileName).then(
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
  }, [activeClip, effectiveFilePath, effectiveFileName, engine])

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

  // CRIT-3 fix: real debounce — the old cleanup wrote saveProgress synchronously,
  // which fired on every progress change (not just unmount), defeating the
  // debounce entirely and keeping the 5-20ms sync localStorage stall.
  // Fix: keep the latest value in a ref; the effect cleanup only cancels the
  // timer; the unmount flush below (empty-dep effect) writes once on teardown.
  React.useEffect(() => {
    latestProgressRef.current = progress
    const t = setTimeout(() => saveProgress(progress), 300)
    return () => {
      clearTimeout(t)
      // DO NOT call saveProgress here — this cleanup runs on every progress
      // change (not only unmount), so writing here is the no-op bug we're fixing.
    }
  }, [progress])

  // Unmount-only flush: write the latest progress exactly once when the panel
  // closes. Empty dep array guarantees this runs only on actual unmount, not
  // on re-renders.
  React.useEffect(() => {
    return () => {
      saveProgress(latestProgressRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Deep-link: auto-start frequency_id drill when preSelectBandId is provided
  // (fired by "Train This →" button in TonalIssues). Mirrors startDrill() but
  // with a forced band so the student immediately trains the flagged frequency.
  React.useEffect(() => {
    if (!preSelectBandId) return
    const difficulty: EarTrainingDifficulty = 'beginner'
    setActiveDrill('frequency_id')
    setActiveDifficulty(difficulty)
    const PANEL_OCTAVE_BANDS = [
      { id: '63hz', hz: 63 }, { id: '125hz', hz: 125 }, { id: '250hz', hz: 250 },
      { id: '500hz', hz: 500 }, { id: '1khz', hz: 1000 }, { id: '2khz', hz: 2000 },
      { id: '4khz', hz: 4000 }, { id: '8khz', hz: 8000 },
    ]
    const band = PANEL_OCTAVE_BANDS.find(b => b.id === preSelectBandId) ?? PANEL_OCTAVE_BANDS[4]
    const direction = (Math.random() < 0.5 ? 'boost' : 'cut') as 'boost' | 'cut'
    const gainDB = 12  // beginner gain
    setQuestion({
      kind: 'frequency_id',
      bandId: band.id,
      freq: band.hz,
      direction,
      gainDB: direction === 'boost' ? gainDB : -gainDB,
      q: 4.0,
    })
    setUserAnswer(null)
    setRevealed(false)
    setScreen('drill')
    engine.lockNewWindow()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preSelectBandId])

  // ── Drill helpers ──────────────────────────────────────────────
  function startDrill(drillId: EarTrainingDrillId, difficulty: EarTrainingDifficulty) {
    setActiveDrill(drillId)
    setActiveDifficulty(difficulty)
    engine.lockNewWindow()
    setQuestion(generateQuestion(drillId, difficulty))
    setUserAnswer(null)
    setRevealed(false)
    setScreen('drill')
  }

  function nextQuestion() {
    engine.lockNewWindow()
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
      question.kind === 'loudness_match' ? String(question.deltaDb) :
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
  // All play functions use loop=true so audio plays endlessly until the user
  // clicks Stop or switches to the other version. The done promise resolves
  // when engine.stop() is called (via the Stop button or next play call).
  // The generation counter prevents stale finally blocks from clearing the
  // playingLabel when a new play has already started.

  function stopPlayback() {
    ++playGenRef.current
    engine.stop()
    setPlayingLabel(null)
  }

  async function playReference() {
    const gen = ++playGenRef.current
    setPlayingLabel('Reference')
    try {
      await engine.playReference(6, true).done
    } finally {
      if (playGenRef.current === gen) setPlayingLabel(null)
    }
  }

  // MED-22 fix: explicit type annotation on `handle` + exhaustiveness default.
  async function playProcessed() {
    if (!question) return
    const gen = ++playGenRef.current
    setPlayingLabel('Modified')
    try {
      let handle: PlayHandle
      switch (question.kind) {
        case 'loudness_match':
          // Reference = 0 dB (no gain), Modified = deltaDb — student hears both via the Reference/Modified buttons
          handle = engine.playWithGain(question.deltaDb, 6, true)
          break
        case 'frequency_id':
        case 'eq_direction':
          handle = engine.playWithEQ({ freq: question.freq, gainDB: question.gainDB, q: DEFAULT_Q }, 6, true)
          break
        case 'q_width':
          handle = engine.playWithEQ({ freq: question.freq, gainDB: question.gainDB, q: question.q }, 6, true)
          break
        case 'compression':
          handle = question.isCompressed
            ? engine.playWithCompression({ threshold: -20, ratio: 8, attack: 0.003, release: 0.1, makeup: 6 }, 6, true)
            : engine.playReference(6, true)
          break
        case 'reverb_time':
          handle = engine.playWithReverb({ decaySec: question.decaySec, mix: 0.45 }, 6, true)
          break
        case 'distortion':
          handle = question.isDistorted
            ? engine.playWithDistortion({ drive: question.drive }, 6, true)
            : engine.playReference(6, true)
          break
        default: {
          const _exhaustive: never = question
          throw new Error(`Unhandled drill kind: ${(_exhaustive as { kind: string }).kind}`)
        }
      }
      await handle.done
    } finally {
      if (playGenRef.current === gen) setPlayingLabel(null)
    }
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <>
    {/* LOW: in-app confirm replaces bare confirm() for reset progress */}
    {confirmReset && (
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        tabIndex={-1}
        onKeyDown={e => { if (e.key === 'Escape') setConfirmReset(false) }}
        ref={confirmDialogRef}
      >
        <div style={{ background: 'rgba(28,26,22,0.98)', border: '1px solid rgba(208,176,102,0.35)', borderRadius: 4, padding: '24px 28px', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>Reset all ear training progress?</div>
          <div style={{ fontSize: 11, color: 'var(--color-sand-400)' }}>All drill scores and unlock progress will be cleared.</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setConfirmReset(false)} style={{ background: 'transparent', border: '1px solid rgba(168,161,150,0.3)', borderRadius: 2, color: 'var(--color-sand-400)', fontSize: 11, padding: '5px 14px', cursor: 'pointer' }}>Cancel</button>
            <button autoFocus onClick={() => { setConfirmReset(false); setProgress(resetProgress()) }} style={{ background: 'rgba(220,80,60,0.12)', border: '1px solid rgba(220,80,60,0.4)', borderRadius: 2, color: 'rgba(220,80,60,0.9)', fontSize: 11, padding: '5px 14px', cursor: 'pointer' }}>Reset</button>
          </div>
        </div>
      </div>
    )}
    <div
      data-eartraining-open="true"
      data-tour-learn="ear-training"
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
            <PanelInfo panelId="learn_ear_training" />
          </div>
          <div style={{ fontSize: 22, color: 'var(--color-text-primary)', fontFamily: 'var(--font-display, serif)', fontStyle: 'italic' }}>
            {screen === 'home' && 'Train your ears, one band at a time.'}
            {screen === 'drill' && DRILL_LABELS[activeDrill] + ` — ${activeDifficulty}`}
            {screen === 'heatmap' && 'Weak Bands Heat Map'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {screen !== 'home' && (
            <button onClick={() => { engine.stop(); ++playGenRef.current; setPlayingLabel(null); setScreen('home') }} style={navBtnStyle}>← Home</button>
          )}
          <button onClick={() => { engine.stop(); ++playGenRef.current; setPlayingLabel(null); onClose() }} style={navBtnStyle}>× Close</button>
        </div>
      </div>

      {loadError && (
        <div style={{ background: 'rgba(220,80,60,0.1)', border: '1px solid rgba(220,80,60,0.4)', padding: 12, borderRadius: 2, color: '#e07060', marginBottom: 20 }}>
          {loadError}
        </div>
      )}

      {!sourceLoaded && !loadError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'rgba(168,161,150,0.7)', fontSize: 13, fontFamily: 'var(--font-display)', fontStyle: 'italic' }}>
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
          fileAvailable={!!effectiveFilePath}
          localFileName={localFileName ?? (localFilePath ? localFilePath.split('/').pop() : undefined)}
          onClipChange={(id) => setActiveClipState(id)}
          onBrowseFile={handleBrowseFile}
          onStartDrill={startDrill}
          onOpenHeatMap={() => setScreen('heatmap')}
          onReset={() => setConfirmReset(true)}
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
          onStop={stopPlayback}
          onAnswer={answer}
          onNext={nextQuestion}
          drillStats={progress.drills[activeDrill]}
        />
      )}

      {sourceLoaded && screen === 'heatmap' && (
        <HeatMapScreen progress={progress} />
      )}
    </div>
    </>
  )
}

// ─── Home screen — drill selector ────────────────────────────────────────────

function HomeScreen({ progress, activeClip, fileAvailable, localFileName, onClipChange, onBrowseFile, onStartDrill, onOpenHeatMap, onReset }: {
  progress: EarTrainingProgress
  activeClip: ReferenceClipId
  fileAvailable: boolean
  localFileName?: string
  onClipChange: (id: ReferenceClipId) => void
  onBrowseFile: () => void
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
        <div style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(208,176,102,0.55)', marginBottom: 8, display: 'flex', alignItems: 'center' }}>
          Source material
          <InfoTip
            label="Source Material"
            body="Pink noise (equal energy/octave) is the gold standard for frequency training. White noise emphasizes highs. Your own file applies the training to real-world material."
          />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {REFERENCE_CLIPS.map(clip => {
            const isFileClip = clip.id === 'loaded_file_a'
            const disabled = isFileClip && !fileAvailable
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
                  {isFileClip && localFileName ? localFileName : clip.description}
                </span>
              </button>
            )
          })}
          {/* LM-ET-1: Browse button — lets students load their own file without
              needing to drop it on the main comparison view first. */}
          <button
            onClick={onBrowseFile}
            title="Pick any audio file from your drive"
            style={{
              padding: '6px 12px',
              background: 'transparent',
              border: '1px solid rgba(208,176,102,0.35)',
              borderRadius: 2,
              color: 'var(--color-accent)',
              fontSize: 11,
              letterSpacing: '0.05em',
              cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 2,
              minWidth: 90,
            }}
          >
            <span>Browse…</span>
            <span style={{ fontSize: 9, color: 'rgba(208,176,102,0.55)', letterSpacing: '0.02em' }}>
              Pick audio file
            </span>
          </button>
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
                fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
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
              <div style={{ fontSize: 10, color: 'rgba(168,161,150,0.55)', marginBottom: 4 }}>
                {stats.attempts > 0 ? `${stats.correct}/${stats.attempts} correct · ${(acc * 100).toFixed(0)}% · best streak ${stats.bestStreak}` : 'No attempts yet'}
              </div>
              {/* Unlock progress bar toward next difficulty */}
              {unlocked && (() => {
                const MIN_ATT = 12, THR = 0.70
                const met = stats.attempts >= MIN_ATT && acc >= THR
                const prog = Math.min(1, stats.attempts / MIN_ATT)
                const attLeft = Math.max(0, MIN_ATT - stats.attempts)
                const corrLeft = Math.max(0, Math.ceil(MIN_ATT * THR) - stats.correct)
                return (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ height: 3, width: '100%', background: 'rgba(168,161,150,0.1)', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
                      <div style={{
                        height: '100%', width: `${prog * 100}%`,
                        background: met ? '#7bc49e' : acc >= THR ? 'rgba(208,176,102,0.7)' : 'rgba(168,161,150,0.3)',
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                    <div style={{ fontSize: 9, color: met ? '#7bc49e' : 'rgba(168,161,150,0.45)', letterSpacing: '0.04em' }}>
                      {met ? '✓ Ready to advance' : attLeft > 0 ? `${stats.attempts}/${MIN_ATT} attempts · need ${corrLeft} more correct at ≥70%` : `${(acc * 100).toFixed(0)}% accuracy · need 70% to advance`}
                    </div>
                  </div>
                )
              })()}
              {unlocked && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {drillId === 'q_width' && (
                    <InfoTip
                      label="Q Width"
                      body="Narrow Q (high Q value) sounds surgical and ringy. Wide Q (low value) sounds tonal and musical. Distinguishing them is essential for creative EQ work."
                    />
                  )}
                  {drillId === 'compression' && (
                    <InfoTip
                      label="Compression Ratio"
                      body="2:1 is gentle levelling. 4:1 is typical vocal/instrument. 8:1+ is limiting. Train to hear the attack transient being softened and the sustain lifted."
                    />
                  )}
                  <InfoTip
                    label="Difficulty"
                    body="Beginner: ±12 dB, 1-octave bands. Intermediate: ±6 dB. Advanced: ±3 dB, 1/3-octave bands — the real-world threshold for professional frequency identification."
                  />
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
                <div style={{ fontSize: 10, fontFamily: 'var(--font-display)', fontStyle: 'italic', color: 'rgba(168,161,150,0.5)' }}>
                  Reach 70% on Advanced of the previous drill to open the next drill.
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
      <div style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(168,161,150,0.55)', marginBottom: 3 }}>
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
  onPlayReference, onPlayProcessed, onStop, onAnswer, onNext, drillStats,
}: {
  drill: EarTrainingDrillId
  difficulty: EarTrainingDifficulty
  question: DrillQuestion
  revealed: boolean
  userAnswer: string | null
  playingLabel: string | null
  onPlayReference: () => void
  onPlayProcessed: () => void
  onStop: () => void
  onAnswer: (option: string) => void
  onNext: () => void
  drillStats: any
}) {
  const options = getDrillOptions(drill, difficulty, question)
  const correctOption = getCorrectOption(question)
  const wasCorrect = revealed && userAnswer === correctOption

  // Unlock progress toward next difficulty / next drill
  const MIN_ATTEMPTS = 12
  const THRESHOLD = 0.70
  const acc = drillStats.attempts > 0 ? drillStats.correct / drillStats.attempts : 0
  const attemptsNeeded = Math.max(0, MIN_ATTEMPTS - drillStats.attempts)
  const correctNeeded = drillStats.attempts > 0
    ? Math.max(0, Math.ceil(MIN_ATTEMPTS * THRESHOLD) - drillStats.correct)
    : Math.ceil(MIN_ATTEMPTS * THRESHOLD)
  const unlockMet = drillStats.attempts >= MIN_ATTEMPTS && acc >= THRESHOLD
  const unlockProgress = Math.min(1, drillStats.attempts / MIN_ATTEMPTS)

  return (
    <div style={{ maxWidth: 880, width: '100%' }}>
      {/* Streak banner + unlock counter */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, color: 'rgba(168,161,150,0.6)' }}>
          Streak: <span style={{ color: 'var(--color-accent)', fontWeight: 600 }}>{drillStats.streak}</span>
          {' · '}Best: {drillStats.bestStreak}
          {' · '}Accuracy: {drillStats.attempts > 0 ? `${(acc * 100).toFixed(0)}%` : '—'}
        </div>
        {/* Unlock progress counter */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end',
          fontSize: 10, color: unlockMet ? '#7bc49e' : 'rgba(168,161,150,0.55)',
          minWidth: 200,
        }}>
          {unlockMet ? (
            <span style={{ color: '#7bc49e', letterSpacing: '0.06em' }}>✓ Unlock criteria met — go back to advance</span>
          ) : (
            <span style={{ letterSpacing: '0.04em' }}>
              {attemptsNeeded > 0
                ? `${drillStats.attempts}/${MIN_ATTEMPTS} attempts · need ${correctNeeded} more correct at ≥70%`
                : `${drillStats.attempts} attempts · ${(acc * 100).toFixed(0)}% accuracy · need 70% to advance`
              }
            </span>
          )}
          <div style={{ width: 200, height: 3, background: 'rgba(168,161,150,0.12)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${unlockProgress * 100}%`,
              background: unlockMet ? '#7bc49e' : acc >= THRESHOLD ? 'rgba(208,176,102,0.7)' : 'rgba(168,161,150,0.35)',
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      </div>

      {/* Playback row — clicking either button stops current and starts new immediately */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 28, alignItems: 'center', flexWrap: 'wrap' }}>
        <PlayButton label="▶ Reference" onClick={onPlayReference} active={playingLabel === 'Reference'} />
        <PlayButton label="▶ Modified" onClick={onPlayProcessed} active={playingLabel === 'Modified'} primary />
        {playingLabel !== null && (
          <button
            onClick={onStop}
            style={{
              padding: '11px 18px',
              background: 'rgba(220,80,60,0.1)',
              border: '1px solid rgba(220,80,60,0.4)',
              borderRadius: 2,
              color: 'rgba(220,80,60,0.85)',
              fontSize: 12,
              letterSpacing: '0.06em',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            ■ Stop
          </button>
        )}
        {playingLabel === null && (
          <span style={{ fontSize: 10, color: 'rgba(168,161,150,0.4)', letterSpacing: '0.04em', fontStyle: 'italic' }}>
            Plays until you stop it — flip between Reference and Modified freely
          </span>
        )}
      </div>

      {/* Question */}
      <div style={{ fontSize: 14, color: 'rgba(168,161,150,0.8)', marginBottom: 16, fontFamily: 'var(--font-display)', fontStyle: 'italic' }}>
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
          <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: wasCorrect ? '#7bc49e' : '#e07060', marginBottom: 6 }}>
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
        <div style={{ color: 'rgba(168,161,150,0.5)', fontFamily: 'var(--font-display)', fontStyle: 'italic' }}>
          Not enough data yet. Run the Frequency ID drill at least 3 times per band.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ color: 'rgba(168,161,150,0.55)', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
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
                  {(() => { const v = b.accuracy * 100; return isFinite(v) ? v.toFixed(0) : '—' })()}%
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
    case 'loudness_match': {
      // choices are stored on the question itself; render them as index-keyed options
      if (_question.kind === 'loudness_match') {
        return _question.choices.map((delta, i) => ({
          value: String(i),
          label: delta > 0
            ? `+${delta} dB (louder)`
            : `${delta} dB (quieter)`,
        }))
      }
      return []
    }
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
    case 'loudness_match': return String(q.correctIdx)
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
    case 'loudness_match': return 'Reference plays at 0 dB. Modified is louder or quieter by a fixed amount. How many dB different is Modified?'
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
    case 'loudness_match': return q.deltaDb > 0
      ? `Modified was ${q.deltaDb} dB louder than Reference.`
      : `Modified was ${Math.abs(q.deltaDb)} dB quieter than Reference.`
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
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

function PlayButton({ label, onClick, active, primary }: { label: string; onClick: () => void; active?: boolean; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '11px 22px',
        background: active
          ? 'rgba(208,176,102,0.18)'
          : primary
            ? 'rgba(208,176,102,0.08)'
            : 'transparent',
        border: `1px solid ${active ? 'rgba(208,176,102,0.9)' : primary ? 'rgba(208,176,102,0.55)' : 'rgba(208,176,102,0.3)'}`,
        borderRadius: 2,
        color: active ? 'var(--color-accent)' : 'var(--color-text-primary)',
        fontSize: 13,
        letterSpacing: '0.06em',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'all 0.12s',
      }}
    >
      {active ? '▶ Playing…' : label}
    </button>
  )
}
