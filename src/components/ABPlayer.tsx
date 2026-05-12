import React, { useState, useRef, useEffect, useCallback } from 'react'
import { FileInfo } from '../types'
import { useModes } from '../ModesContext'
import { useEQ, EQBand } from '../EQContext'
import { onShortcut, emitShortcut, RTM_EVENTS } from '../shortcuts'
import { levelAlign } from '../lib/spectrumLevel'
import { formatPreciseTime } from '../timeFormat'
import { useSolo, formatSoloFreq } from '../SoloContext'

/** Toolbar pill — visible only while a spectrum band is soloed. Shows
 *  the centre frequency and clears the solo on click (Esc also works,
 *  per SoloContext). */
function SoloPill() {
  const { soloBand, soloQ, clearSolo } = useSolo()
  if (soloBand == null) return null
  return (
    <button
      onClick={clearSolo}
      className="text-[10px] px-2 py-0.5 rounded-full font-mono inline-flex items-center gap-1.5"
      style={{ backgroundColor: 'rgba(123,196,158,0.18)', color: '#7bc49e' }}
      title={`Solo ${formatSoloFreq(soloBand)} band-pass · Q ${soloQ.toFixed(1)} · click or Esc to clear`}
    >
      <span style={{ letterSpacing: '0.18em', textTransform: 'uppercase' }}>Solo</span>
      <span>{formatSoloFreq(soloBand)}</span>
      <span style={{ opacity: 0.65 }}>×</span>
    </button>
  )
}

interface Props {
 fileA: FileInfo
 fileB: FileInfo
 gainAppliedDb: number
 stems?: {
 a: Record<string, string>
 b: Record<string, string>
 }
 /** Optional 31-band 1/3-octave spectrum of the currently-selected
 * reference (from Reference Match / library). Rendered as a gold
 * curve above the waveform so the engineer can scrub the master
 * against the reference's tonal shape without leaving the player. */
 referenceCurve?: number[] | null
 /** Optional 31-band spectrum of the current track for context. When
 * provided, both curves overlay on a shared axis. */
 currentCurve?: number[] | null
 referenceLabel?: string
}

export default function ABPlayer({ fileA, fileB, gainAppliedDb, stems, referenceCurve, currentCurve, referenceLabel }: Props) {
 // Blind test state lives in the player itself, not in the data view.
 const { blind: blindMode } = useModes()
 // Live EQ. Bands land here from EngineerTipsPanel / ReferenceMatchEQPanel
 // / MasterAssistantPanel; we maintain a biquad bank at the tail of the
 // listen chain and update filter parameters in real time, so toggling /
 // tweaking is audible without stopping playback.
 const eq = useEQ()
 // Per-session scrambling: which physical file is behind button A vs B.
 // Re-shuffles whenever the user clicks "Shuffle again" from the blind UI.
 const [shuffleKey, setShuffleKey] = useState(0)
 const [shuffled, setShuffled] = useState(() => Math.random() < 0.5)
 // When true, "A" button plays fileB's buffer and "B" plays fileA's.
 // Score tracking — persists in localStorage so streaks stick across sessions.
 const [blindScore, setBlindScore] = useState<{ correct: number; total: number }>(() => {
 try { return JSON.parse(localStorage.getItem('rtm-blind-score') || '{"correct":0,"total":0}') }
 catch { return { correct: 0, total: 0 } }
 })
 const [blindRoundResult, setBlindRoundResult] = useState<null | { guess: 'A' | 'B'; correctLetter: 'A' | 'B'; wasCorrect: boolean }>(null)

 // Which *logical* file ("A" or "B" button) does the user currently hear?
 // In blind mode, the underlying AudioBuffer we play is swapped per `shuffled`.
 const resolveBlindFile = useCallback((which: 'A' | 'B'): 'A' | 'B' => {
 if (!blindMode) return which
 // If shuffled, A-button → B-buffer, B-button → A-buffer.
 if (shuffled) return which === 'A' ? 'B' : 'A'
 return which
 }, [blindMode, shuffled])
 const [isPlaying, setIsPlaying] = useState(false)
 const [activeFile, setActiveFile] = useState<'A' | 'B'>('A')
 const [currentTime, setCurrentTime] = useState(0)
 // 5.3.0 perf — every-frame ref so subscribers (TransportClock,
 // ProgressCursor) animate smoothly while the parent re-renders at
 // throttled ~10Hz (the waveform coloring is coarse enough that the
 // eye doesn't notice the lower state-update cadence).
 const currentTimeRef = useRef(0)
 const lastSetCurrentTimeRef = useRef(0)
 // CRIT-7: root element ref — used to detect whether this player instance
 // is the one INSIDE the BlindTestPanel overlay (closest data-blind-test-open).
 const playerRef = useRef<HTMLDivElement | null>(null)
 const [duration, setDuration] = useState(0)
 const [isLoaded, setIsLoaded] = useState(false)
 const [isLoading, setIsLoading] = useState(false)
 const [waveformA, setWaveformA] = useState<number[]>([])
 const [waveformB, setWaveformB] = useState<number[]>([])

 // Stems, Mono & Loop state
 const [playerMode, setPlayerMode] = useState<'mix' | 'stems'>('mix')
 const [activeStem, setActiveStem] = useState<string>('vocals')
 const [stemsLoaded, setStemsLoaded] = useState(false)
 const [stemsLoading, setStemsLoading] = useState(false)
 const [monoMode, setMonoMode] = useState(false)

 // Unified LISTEN MODE — stereo / mono / mid / side / phone.
 // Built on top of the gain nodes as a post-processing chain.
 type ListenMode = 'stereo' | 'mono' | 'mid' | 'side' | 'phone'
 const [listenMode, setListenMode] = useState<ListenMode>('stereo')
 const listenInputRef = useRef<GainNode | null>(null)
 const listenOutputRef = useRef<GainNode | null>(null)
 const listenChainRef = useRef<AudioNode[]>([])
 // EQ stage — lives between listenOutput and the TP analyser. Two
 // fixed gain-node "taps" (eqIn / eqOut) so we can tear down and
 // rebuild the biquad chain between them without touching the rest
 // of the graph. eqBypassGainRef is the bypass path — when the bank
 // is disabled we wire eqIn directly to eqOut through it so the
 // signal still flows at unity.
 const eqInputRef = useRef<GainNode | null>(null)
 const eqOutputRef = useRef<GainNode | null>(null)
 const eqFilterNodesRef = useRef<BiquadFilterNode[]>([])
 const eqBypassGainRef = useRef<GainNode | null>(null)
 // Spectrum-band solo: a BiquadFilter sitting between eqOut and the TP
 // analyser, normally bypassed. When SoloContext has a value, eqOut is
 // re-routed THROUGH the filter so the engineer can hear what's at
 // that frequency. See SoloContext.tsx for the design rationale.
 const soloFilterRef = useRef<BiquadFilterNode | null>(null)
 const soloEngagedRef = useRef<boolean>(false)
 const { soloBand, soloQ } = useSolo()

 // Use refs for stem buffers to avoid stale closure issues
 const stemBuffersARef = useRef<Record<string, AudioBuffer>>({})
 const stemBuffersBRef = useRef<Record<string, AudioBuffer>>({})
 // Drag-and-drop stems — " We
 // accept files named like vocals.wav / drums.wav / bass.wav /
 // other.wav (case-insensitive) and route them into the active side
 // (A or B based on activeFile). A decoded stem stays in the ref
 // dictionary the normal playback path reads from.
 const [stemDragging, setStemDragging] = useState<'A' | 'B' | null>(null)
 const [stemDropMsg, setStemDropMsg] = useState<string | null>(null)
 // Auto-dismiss stem-drop confirmations after 6 s so the green "✓ Loaded
 // N stems" line doesn't pin the transport area open after the user has
 // already moved on to actually listening to them.
 useEffect(() => {
 if (!stemDropMsg) return
 const t = setTimeout(() => setStemDropMsg(null), 6000)
 return () => clearTimeout(t)
 }, [stemDropMsg])
 const [stemWaveformsA, setStemWaveformsA] = useState<Record<string, number[]>>({})
 /**
 * Per-stem TP + loudness telemetry. 
 *
 * Both metrics computed client-side from the decoded AudioBuffer —
 * zero backend dependency, runs in O(n) over the buffer at stem-load
 * time. TP is 4× linearly-upsampled; loudness is an RMS-based
 * approximation (not full BS.1770 K-weighting) so we label it
 * honestly as "Loud" rather than "LUFS".
 */
 const [stemMetrics, setStemMetrics] = useState<Record<string, { tpA: number; tpB: number; loudA: number; loudB: number }>>({})
 const [stemWaveformsB, setStemWaveformsB] = useState<Record<string, number[]>>({})
 const playerModeRef = useRef<'mix' | 'stems'>('mix')
 const activeStemRef = useRef<string>('vocals')
 const effectiveDurationRef = useRef<number>(0)
 const loopEnabledRef = useRef(false)
 const loopStartRef = useRef<number | null>(null)
 const loopEndRef = useRef<number | null>(null)
 const [loopEnabled, setLoopEnabled] = useState(false)
 const [loopStart, setLoopStart] = useState<number | null>(null)
 const [loopEnd, setLoopEnd] = useState<number | null>(null)
 const [isDraggingLoop, setIsDraggingLoop] = useState(false)
 const [dragStartX, setDragStartX] = useState(0)

 const audioCtxRef = useRef<AudioContext | null>(null)
 const bufferARef = useRef<AudioBuffer | null>(null)
 const bufferBRef = useRef<AudioBuffer | null>(null)
 const sourceRef = useRef<AudioBufferSourceNode | null>(null)
 const gainARef = useRef<GainNode | null>(null)
 const gainBRef = useRef<GainNode | null>(null)
 const monoMergerRef = useRef<ChannelMergerNode | null>(null)
 const monoSplitterRef = useRef<ChannelSplitterNode | null>(null)
 const monoGainRef = useRef<GainNode | null>(null)
 // Live TP meter — AnalyserNode tapped right before `destination`, plus a
 // 3-second peak-hold ring. UI reads these via rAF; no reactive state in
 // the hot path.
 const tpAnalyserRef = useRef<AnalyserNode | null>(null)
 const tpSampleBufRef = useRef<Float32Array | null>(null)
 const tpPeakHoldRef = useRef<{ db: number; expires: number }>({ db: -Infinity, expires: 0 })
 // 5.2.0 perf fix (audit P0-8): the meter values were `useState`d and
 // setX'd on every rAF tick (~60 Hz), re-rendering the entire 1700-line
 // ABPlayer component plus every consumer of its derived state during
 // playback. Now we keep them in refs and have a tiny <LiveTpMeter />
 // child read its own RAF — only the meter re-renders, not the parent.
 const tpLiveDbRef = useRef<number>(-Infinity)
 const tpPeakDbRef = useRef<number>(-Infinity)
 const startTimeRef = useRef(0)
 const offsetRef = useRef(0)
 const rafRef = useRef<number>(0)
 const waveformRef = useRef<HTMLDivElement>(null)

 // Load audio files — mastering-grade playback:
 // • AudioContext created AT the file's native sample rate (no resampling).
 // • latencyHint "playback" → larger buffer, zero glitching on Opus 4.6 renders.
 // • Internal AudioBuffer is already 32-bit float; the browser's internal
 // graph uses 32-bit float throughout (Web Audio spec). True 64-bit float
 // isn't available in Web Audio, but float32 at 96 kHz is well beyond
 // audible fidelity for A/B monitoring.
 const loadFiles = useCallback(async () => {
 setIsLoading(true)
 // Declared outside the try so `finally` can tear them down on any
 // failure path. Without this, a decode error between probe.close()
 // and the real-ctx allocation would leak one AudioContext per retry
 // — and Chromium caps the page at ~6 live contexts.
 let probe: AudioContext | null = null
 let ctx: AudioContext | null = null
 let succeeded = false
 try {
 if (!window.electronAPI?.readAudioFile) {
 throw new Error('Audio playback requires Electron')
 }

 // Peek at each file's native sample rate. We decode in the probe,
 // then — if the real ctx ends up running at the same rate as the
 // probe — reuse the probe's buffers (they're transferable across
 // contexts for read-only playback use, per WebAudio spec). When
 // the rates differ we re-decode once into the real ctx.
 probe = new (window.AudioContext || (window as any).webkitAudioContext)()
 const [arrA, arrB] = await Promise.all([
 window.electronAPI.readAudioFile(fileA.path),
 window.electronAPI.readAudioFile(fileB.path),
 ])
 const bufAProbe = await probe.decodeAudioData(arrA.slice(0))
 const bufBProbe = await probe.decodeAudioData(arrB.slice(0))
 // Use the HIGHER of the two file sample rates for the real context,
 // so neither file gets downsampled on the way to the DAC.
 const nativeSr = Math.max(bufAProbe.sampleRate, bufBProbe.sampleRate)

 // Create the REAL context at the native sample rate. Many DACs
 // support 44.1/48/88.2/96 kHz; if the browser rejects the rate we
 // fall back to the default.
 try {
 ctx = new AudioContext({ sampleRate: nativeSr, latencyHint: 'playback' })
 } catch {
 ctx = new AudioContext({ latencyHint: 'playback' })
 }
 audioCtxRef.current = ctx

 // If the real context matches the probe's rate, reuse the probe's
 // decoded buffers — avoids a second O(file-duration) decode pass.
 // Otherwise re-decode into the real ctx (required by spec when SR
 // mismatches).
 const reuseProbe = ctx.sampleRate === probe.sampleRate
 const bufA = reuseProbe ? bufAProbe : await ctx.decodeAudioData(arrA.slice(0))
 const bufB = reuseProbe ? bufBProbe : await ctx.decodeAudioData(arrB.slice(0))

 bufferARef.current = bufA
 bufferBRef.current = bufB

 const gA = ctx.createGain()
 const gB = ctx.createGain()
 gA.gain.value = 1.0
 gB.gain.value = Math.pow(10, gainAppliedDb / 20)
 gainARef.current = gA
 gainBRef.current = gB

 // Build the listen-mode processing chain: gA / gB → [mono/mid/side/phone graph] → destination.
 // The chain can be rebuilt on demand by rebuildListenChain().
 const listenIn = ctx.createGain()
 const listenOut = ctx.createGain()
 listenInputRef.current = listenIn
 listenOutputRef.current = listenOut
 gA.connect(listenIn)
 gB.connect(listenIn)
 rebuildListenChain(ctx, 'stereo')
 // EQ stage — listenOut → eqIn → [biquad bank OR bypass] → eqOut →
 // tpAnalyser → destination. When the EQ is disabled (the default)
 // we route eqIn → bypass-gain → eqOut at unity. When enabled, we
 // replace the bypass path with a chain of BiquadFilterNodes built
 // from the EQContext bands. rebuildEqBank() handles the switch.
 const eqIn = ctx.createGain()
 const eqOut = ctx.createGain()
 const eqBypass = ctx.createGain()
 eqBypass.gain.value = 1
 eqInputRef.current = eqIn
 eqOutputRef.current = eqOut
 eqBypassGainRef.current = eqBypass
 listenOut.connect(eqIn)
 // Start in bypass. rebuildEqBank() will re-wire once bands arrive.
 eqIn.connect(eqBypass)
 eqBypass.connect(eqOut)

 // Tap the final bus for the live TP meter. fftSize 512 samples at
 // native SR gives ~10 ms windows — enough to catch transient peaks
 // without ballooning CPU. We use Float-time-domain data (not FFT)
 // because we only need peak-hold on the raw waveform.
 const tpAnalyser = ctx.createAnalyser()
 tpAnalyser.fftSize = 512
 tpAnalyser.smoothingTimeConstant = 0
 // Build the solo bandpass once. By default we route eqOut → tpAnalyser
 // straight through; the solo effect below disconnects that and inserts
 // the filter when SoloContext goes hot.
 const soloFilter = ctx.createBiquadFilter()
 soloFilter.type = 'bandpass'
 soloFilter.frequency.value = 1000
 soloFilter.Q.value = 8
 soloFilterRef.current = soloFilter
 soloEngagedRef.current = false
 eqOut.connect(tpAnalyser)
 tpAnalyser.connect(ctx.destination)
 tpAnalyserRef.current = tpAnalyser
 // Allocate over a plain ArrayBuffer explicitly so the Float32Array
 // type matches what getFloatTimeDomainData expects across TS libs
 // that distinguish ArrayBuffer from SharedArrayBuffer.
 tpSampleBufRef.current = new Float32Array(new ArrayBuffer(tpAnalyser.fftSize * 4))

 // Mono chain: splitter -> mono gain (sum L+R) -> merger -> destination
 // We'll reconnect gains through this when mono is enabled
 const monoGain = ctx.createGain()
 monoGain.gain.value = 0.5
 monoGainRef.current = monoGain

 setDuration(Math.min(bufA.duration, bufB.duration))
 setWaveformA(extractWaveform(bufA, 200))
 setWaveformB(extractWaveform(bufB, 200))
 setIsLoaded(true)
 succeeded = true
 } catch (err) {
 console.error('Failed to load audio:', err)
 } finally {
 // Always close the probe — it served its purpose the moment we
 // read its sampleRate and (optionally) reused its buffers.
 if (probe) { try { await probe.close() } catch {} }
 // If we failed before wiring the real ctx up, tear it down too,
 // otherwise it sits idle holding a hardware output slot. On
 // success the component's unmount effect owns ctx cleanup.
 if (!succeeded && ctx) {
 try { await ctx.close() } catch {}
 if (audioCtxRef.current === ctx) audioCtxRef.current = null
 }
 setIsLoading(false)
 }
 }, [fileA, fileB, gainAppliedDb])

 // Load stem audio files
 const loadStems = useCallback(async () => {
 if (!stems || !audioCtxRef.current || !window.electronAPI?.readAudioFile) return
 setStemsLoading(true)
 try {
 const ctx = audioCtxRef.current
 const stemNames = Object.keys(stems.a)

 // Load all stems in parallel — previously serial awaits per stem meant
 // 8 sequential IPC round-trips. Promise.all fires all reads at once so
 // the total wait is bounded by the slowest single stem, not their sum.
 const [arraysA, arraysB] = await Promise.all([
 Promise.all(stemNames.map(name => window.electronAPI!.readAudioFile(stems.a[name]))),
 Promise.all(stemNames.map(name => window.electronAPI!.readAudioFile(stems.b[name]))),
 ])
 const [decodedA, decodedB] = await Promise.all([
 Promise.all(arraysA.map(arr => ctx.decodeAudioData(arr.slice(0)))),
 Promise.all(arraysB.map(arr => ctx.decodeAudioData(arr.slice(0)))),
 ])

 const bufsA: Record<string, AudioBuffer> = {}
 const bufsB: Record<string, AudioBuffer> = {}
 for (let i = 0; i < stemNames.length; i++) {
 bufsA[stemNames[i]] = decodedA[i]
 bufsB[stemNames[i]] = decodedB[i]
 }

 stemBuffersARef.current = bufsA
 stemBuffersBRef.current = bufsB

 // Generate waveforms + per-stem TP / loudness for each stem.
 // Computed in the same pass as waveform extraction so the stem
 // selector renders with full telemetry on first paint.
 const wfA: Record<string, number[]> = {}
 const wfB: Record<string, number[]> = {}
 const metrics: Record<string, { tpA: number; tpB: number; loudA: number; loudB: number }> = {}
 for (const name of Object.keys(bufsA)) {
 wfA[name] = extractWaveform(bufsA[name], 200)
 wfB[name] = extractWaveform(bufsB[name], 200)
 metrics[name] = {
 tpA: computeTruePeakDbtp(bufsA[name]),
 tpB: computeTruePeakDbtp(bufsB[name]),
 loudA: computeLoudnessDb(bufsA[name]),
 loudB: computeLoudnessDb(bufsB[name]),
 }
 }
 setStemWaveformsA(wfA)
 setStemWaveformsB(wfB)
 setStemMetrics(metrics)
 setStemsLoaded(true)
 } catch (err) {
 console.error('Failed to load stems:', err)
 }
 setStemsLoading(false)
 }, [stems])

 // ── Unified listen-mode processing chain ──────────────────────────────
 // stereo: pass-through
 // mono: (L+R)/2 on both channels
 // mid: same as mono (informational label)
 // side: (L-R)/2 on both channels — uses gain=-1 invert then sum
 // phone: mono + 300 Hz HPF + 3.4 kHz LPF + 2 kHz presence = phone speaker
 // Built between listenInputRef and listenOutputRef. When mode changes,
 // the intermediate nodes are disconnected/rebuilt.
 function rebuildListenChain(ctx: AudioContext, mode: ListenMode) {
 const input = listenInputRef.current
 const output = listenOutputRef.current
 if (!input || !output) return

 // Tear down previous chain
 for (const n of listenChainRef.current) { try { n.disconnect() } catch {} }
 listenChainRef.current = []
 try { input.disconnect() } catch {}

 if (mode === 'stereo') {
 input.connect(output)
 return
 }

 const splitter = ctx.createChannelSplitter(2)
 const merger = ctx.createChannelMerger(2)
 input.connect(splitter)
 listenChainRef.current.push(splitter, merger)

 // Build the mono-source node: (L+R)/2 for mono/mid/phone, (L-R)/2 for side
 let sourceNode: AudioNode
 if (mode === 'side') {
 const sumSide = ctx.createGain(); sumSide.gain.value = 0.5
 const rInv = ctx.createGain(); rInv.gain.value = -1
 splitter.connect(sumSide, 0) // L into sum
 splitter.connect(rInv, 1) // R → inverter
 rInv.connect(sumSide) // -R into sum
 listenChainRef.current.push(sumSide, rInv)
 sourceNode = sumSide
 } else {
 const sum = ctx.createGain(); sum.gain.value = 0.5
 splitter.connect(sum, 0) // L into sum
 splitter.connect(sum, 1) // R into sum
 listenChainRef.current.push(sum)
 sourceNode = sum
 }

 // Phone simulation: narrow the band to 300 Hz – 3.4 kHz (telephone) + 2 kHz presence lift
 if (mode === 'phone') {
 const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 300; hpf.Q.value = 0.7
 const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 3400; lpf.Q.value = 0.7
 const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 2000; pres.gain.value = 3; pres.Q.value = 1.2
 // Phone speakers roll off sub heavily — extra HPF
 const hpf2 = ctx.createBiquadFilter(); hpf2.type = 'highpass'; hpf2.frequency.value = 180; hpf2.Q.value = 0.9
 sourceNode.connect(hpf2).connect(hpf).connect(lpf).connect(pres)
 sourceNode = pres
 listenChainRef.current.push(hpf, hpf2, lpf, pres)
 }

 // Output the mono-sourced signal to BOTH channels of the stereo bus.
 sourceNode.connect(merger, 0, 0)
 sourceNode.connect(merger, 0, 1)
 merger.connect(output)
 }

 // Called when the user picks a listen mode.
 const applyListenMode = useCallback((mode: ListenMode) => {
 if (!audioCtxRef.current) return
 setListenMode(mode)
 setMonoMode(mode === 'mono') // keep legacy bool in sync
 rebuildListenChain(audioCtxRef.current, mode)
 }, [])

 // ── Live EQ filter bank ──────────────────────────────────────────────
 // Rebuild the biquad chain between eqIn and eqOut whenever the bands
 // change or the enabled flag toggles. Design note: we tear down and
 // re-create the nodes rather than diff because Web Audio guarantees
 // a clean crossfade on disconnect when the graph is quiet enough —
 // and biquads are cheap to recreate. Parameter tweaks within an
 // existing band (gain drag, Q sweep) take a faster path below and
 // update `.value` on the live node so there's zero graph churn.
 const rebuildEqBank = useCallback(() => {
 const ctx = audioCtxRef.current
 const eqIn = eqInputRef.current
 const eqOut = eqOutputRef.current
 const bypass = eqBypassGainRef.current
 if (!ctx || !eqIn || !eqOut || !bypass) return

 // Tear down the old chain cleanly.
 try { eqIn.disconnect() } catch {}
 for (const n of eqFilterNodesRef.current) { try { n.disconnect() } catch {} }
 eqFilterNodesRef.current = []
 try { bypass.disconnect() } catch {}

 const activeBands = eq.enabled ? eq.bands.filter(b => b.enabled) : []
 if (activeBands.length === 0) {
 // Bypass: eqIn → bypassGain → eqOut.
 eqIn.connect(bypass)
 bypass.connect(eqOut)
 return
 }

 // Build biquad bank with per-band Amount scaling applied to gain.
 // Shelving bands keep their type; peakings default.
 let prev: AudioNode = eqIn
 for (const band of activeBands) {
 const node = ctx.createBiquadFilter()
 node.type = band.type || 'peaking'
 node.frequency.value = Math.max(20, Math.min(ctx.sampleRate / 2 - 1, band.freq))
 node.Q.value = Math.max(0.1, Math.min(24, band.q))
 node.gain.value = band.gain_db * eq.amount
 prev.connect(node)
 eqFilterNodesRef.current.push(node)
 prev = node
 }
 prev.connect(eqOut)
 }, [eq.bands, eq.enabled, eq.amount])

 // React to *any* context change. proposalKey cheapens the cost of
 // re-running when bands are replaced wholesale (full rebuild) vs.
 // parameter-nudged (fast path below handles that).
 useEffect(() => {
 rebuildEqBank()
 }, [rebuildEqBank, eq.proposalKey])

 // Spectrum-band solo: when SoloContext goes hot, re-route the post-EQ
 // bus through the bandpass filter so the engineer can hear just that
 // band. When solo clears, restore the direct eqOut → tpAnalyser path.
 // The audio context might not be live yet (player not loaded) — in
 // that case the refs are null and the effect is a no-op until ctx is
 // built; the initial routing in the ctx-build path always starts
 // bypassed so coming back out of solo is fine.
 useEffect(() => {
   const eqOut = eqOutputRef.current
   const tpA = tpAnalyserRef.current
   const filt = soloFilterRef.current
   if (!eqOut || !tpA || !filt) return

   if (soloBand != null) {
     // Update params first so we don't pop on re-engage.
     filt.frequency.setTargetAtTime(soloBand, 0, 0.005)
     filt.Q.setTargetAtTime(soloQ, 0, 0.005)
     if (!soloEngagedRef.current) {
       try { eqOut.disconnect(tpA) } catch {}
       eqOut.connect(filt)
       filt.connect(tpA)
       soloEngagedRef.current = true
     }
   } else if (soloEngagedRef.current) {
     try { eqOut.disconnect(filt) } catch {}
     try { filt.disconnect(tpA) } catch {}
     eqOut.connect(tpA)
     soloEngagedRef.current = false
   }
 }, [soloBand, soloQ, isLoaded])

 // Fast path: when band list length + order are unchanged we update
 // filter-node parameters directly instead of rebuilding. Cheap
 // enough to run per slider move — biquad parameter changes are
 // interpolated by the audio thread so there's no zipper.
 useEffect(() => {
 const nodes = eqFilterNodesRef.current
 const ctx = audioCtxRef.current
 if (!ctx || nodes.length === 0) return
 const active = eq.enabled ? eq.bands.filter(b => b.enabled) : []
 if (active.length !== nodes.length) return // structural change → rebuild path runs
 for (let i = 0; i < active.length; i++) {
 const n = nodes[i]
 const b = active[i]
 const now = ctx.currentTime
 const freqTarget = Math.max(20, Math.min(ctx.sampleRate / 2 - 1, b.freq))
 const qTarget = Math.max(0.1, Math.min(24, b.q))
 const gainTarget = b.gain_db * eq.amount
 // setTargetAtTime with a short time constant = smooth but
 // perceptually immediate transitions.
 try {
 n.frequency.setTargetAtTime(freqTarget, now, 0.008)
 n.Q.setTargetAtTime(qTarget, now, 0.008)
 n.gain.setTargetAtTime(gainTarget, now, 0.008)
 } catch {
 n.frequency.value = freqTarget
 n.Q.value = qTarget
 n.gain.value = gainTarget
 }
 }
 }, [eq.bands, eq.amount, eq.enabled])

 // Legacy name kept so the existing keyboard shortcut ('m') still works.
 const toggleMono = useCallback(() => {
 const next: ListenMode = listenMode === 'mono' ? 'stereo' : 'mono'
 applyListenMode(next)
 }, [listenMode, applyListenMode])

 // Get the correct buffer — uses refs, no stale closures.
 // In blind mode the mapping is shuffled so the UI "A" button may play the
 // audio that lives in bufferBRef, and vice versa.
 const getBuffer = (file: 'A' | 'B', mode: 'mix' | 'stems', stem: string): AudioBuffer | null => {
 const physical = resolveBlindFile(file)
 if (mode === 'stems') {
 const stemBufs = physical === 'A' ? stemBuffersARef.current : stemBuffersBRef.current
 if (stemBufs[stem]) return stemBufs[stem]
 }
 return physical === 'A' ? bufferARef.current : bufferBRef.current
 }

 // Start playback from a given time
 const startPlayback = useCallback((fromTime: number, overrideMode?: 'mix' | 'stems', overrideStem?: string) => {
 if (!audioCtxRef.current || !bufferARef.current || !bufferBRef.current) return

 const ctx = audioCtxRef.current
 if (ctx.state === 'suspended') ctx.resume()

 sourceRef.current?.stop()

 const mode = overrideMode || playerModeRef.current
 const stem = overrideStem || activeStemRef.current
 const buffer = getBuffer(activeFile, mode, stem)
 if (!buffer) return

 const source = ctx.createBufferSource()
 source.buffer = buffer
 // Route through the gain node matching the physical buffer we're about to
 // play — that way the level-matching gain stays correct even in blind mode.
 const physical = resolveBlindFile(activeFile)
 source.connect(physical === 'A' ? gainARef.current! : gainBRef.current!)
 source.start(0, fromTime)
 sourceRef.current = source
 startTimeRef.current = ctx.currentTime - fromTime

 source.onended = () => {
 if (sourceRef.current === source) {
 // If looping, restart from loop start
 if (loopEnabledRef.current && loopStartRef.current !== null && loopEndRef.current !== null) {
 startPlayback(loopStartRef.current)
 } else {
 setIsPlaying(false)
 offsetRef.current = 0
 setCurrentTime(0)
 }
 }
 }
 // Loop state is read via refs above, so it's intentionally not in the deps.
 }, [activeFile, resolveBlindFile])

 // Play/pause
 const togglePlay = useCallback(() => {
 if (!audioCtxRef.current || !bufferARef.current || !bufferBRef.current) return

 if (isPlaying) {
 sourceRef.current?.stop()
 sourceRef.current = null
 offsetRef.current = currentTime
 setIsPlaying(false)
 cancelAnimationFrame(rafRef.current)
 } else {
 const startFrom = (loopEnabledRef.current && loopStartRef.current !== null) ? loopStartRef.current : offsetRef.current
 startPlayback(startFrom)
 setIsPlaying(true)
 // Announce so the EQ preview pauses — only one audio chain should
 // be fighting the output device at a time.
 try { emitShortcut(RTM_EVENTS.mainPlayerStarted) } catch {}

 const updateTime = () => {
 if (audioCtxRef.current && sourceRef.current) {
 const t = audioCtxRef.current.currentTime - startTimeRef.current

 // Loop check — refs only. React state (`loopStart`) lags a
 // render behind the ref by up to ~16 ms; if we mixed them
 // here a just-cleared loop could produce NaN and send the
 // transport to +Infinity. Reading the ref twice keeps the
 // comparison and the seek coherent.
 const lStart = loopStartRef.current
 const lEnd = loopEndRef.current
 if (
 loopEnabledRef.current &&
 lStart !== null &&
 lEnd !== null &&
 t >= lEnd
 ) {
 startPlayback(lStart)
 startTimeRef.current = audioCtxRef.current.currentTime - lStart
 }

 // 5.3.0 perf — ref every frame; state throttled to ~10Hz so
 // the 1700-line component doesn't re-render on every rAF tick
 // just to recolor waveform bars. TransportClock + cursor read
 // from the ref directly via their own rAF and stay smooth.
 const clampedT = Math.min(t, effectiveDurationRef.current)
 currentTimeRef.current = clampedT
 const _nowMs = performance.now()
 if (_nowMs - lastSetCurrentTimeRef.current > 100) {
  lastSetCurrentTimeRef.current = _nowMs
  setCurrentTime(clampedT)
 }

 // ── Live TP meter sample ───────────────────────────────────
 // Read the analyser's time-domain buffer → absolute peak →
 // dBTP. A 4× linear interpolation pass gives a cheap "close-
 // to-true-peak" reading without a proper polyphase filter
 // (which is too heavy for rAF). Peak-hold is 2 s. Skipped
 // when the meter isn't subscribed (no subscribers means no
 // reactive state churn).
 const an = tpAnalyserRef.current
 const buf = tpSampleBufRef.current
 if (an && buf) {
 // Cast placates TS lib.dom types that narrow Float32Array's
 // buffer slot; the runtime contract is unchanged.
 an.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>)
 let peak = 0
 for (let i = 0; i < buf.length; i++) {
 const v = Math.abs(buf[i])
 if (v > peak) peak = v
 // Very lightweight 2× linear estimate — halfway between
 // successive samples. Not a true TP but catches most
 // inter-sample overs without a resampler.
 if (i > 0) {
 const mid = Math.abs((buf[i] + buf[i - 1]) * 0.5)
 if (mid > peak) peak = mid
 }
 }
 const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity
 // Ref writes — the LiveTpMeter child reads these via its own
 // rAF and self-updates, so no parent re-render fires here.
 tpLiveDbRef.current = db
 const now = performance.now()
 const hold = tpPeakHoldRef.current
 if (db > hold.db || now > hold.expires) {
 hold.db = db
 hold.expires = now + 2000
 tpPeakDbRef.current = db
 }
 }

 rafRef.current = requestAnimationFrame(updateTime)
 }
 }
 rafRef.current = requestAnimationFrame(updateTime)
 }
 }, [isPlaying, currentTime, duration, startPlayback, loopEnabled, loopStart, loopEnd])

 // Switch A/B
 const switchFile = useCallback((file: 'A' | 'B') => {
 if (file === activeFile) return
 setActiveFile(file)

 if (isPlaying && audioCtxRef.current) {
 const ctx = audioCtxRef.current
 const pos = ctx.currentTime - startTimeRef.current

 sourceRef.current?.stop()

 // Use correct buffer (stem or mix) for the new file
 const buffer = getBuffer(file, playerModeRef.current, activeStemRef.current)
 if (!buffer) return

 const source = ctx.createBufferSource()
 source.buffer = buffer
 const physical = resolveBlindFile(file)
 source.connect(physical === 'A' ? gainARef.current! : gainBRef.current!)
 source.start(0, pos)
 sourceRef.current = source
 startTimeRef.current = ctx.currentTime - pos

 source.onended = () => {
 if (sourceRef.current === source) {
 if (loopEnabled && loopStart !== null && loopEnd !== null) {
 startPlayback(loopStart)
 } else {
 setIsPlaying(false)
 offsetRef.current = 0
 setCurrentTime(0)
 }
 }
 }
 }
 }, [activeFile, isPlaying, loopEnabled, loopStart, loopEnd, startPlayback, resolveBlindFile])

 // Waveform click = seek, drag = set loop region
 const handleWaveformMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
 if (!waveformRef.current) return
 const rect = waveformRef.current.getBoundingClientRect()
 const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
 setDragStartX(pct)
 setIsDraggingLoop(true)
 }, [])

 const handleWaveformMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
 if (!isDraggingLoop || !waveformRef.current) return
 const rect = waveformRef.current.getBoundingClientRect()
 const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
 const dist = Math.abs(pct - dragStartX)

 // Only create loop if dragged more than 2% of width
 if (dist > 0.02) {
 const dur = effectiveDurationRef.current
 const start = Math.min(dragStartX, pct) * dur
 const end = Math.max(dragStartX, pct) * dur
 setLoopStart(start)
 setLoopEnd(end)
 setLoopEnabled(true)
 loopStartRef.current = start
 loopEndRef.current = end
 loopEnabledRef.current = true
 }
 }, [isDraggingLoop, dragStartX, duration])

 const handleWaveformMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
 if (!waveformRef.current) return
 const rect = waveformRef.current.getBoundingClientRect()
 const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
 const dist = Math.abs(pct - dragStartX)

 if (dist <= 0.02) {
 // Click = seek (not a drag)
 const dur = effectiveDurationRef.current
 const time = Math.min(pct * dur, dur - 0.1)
 offsetRef.current = time
 setCurrentTime(time)

 if (isPlaying) {
 startPlayback(time)
 }
 }

 setIsDraggingLoop(false)
 }, [dragStartX, isPlaying, startPlayback])

 // Clear loop
 const clearLoop = useCallback(() => {
 setLoopEnabled(false)
 setLoopStart(null)
 setLoopEnd(null)
 loopEnabledRef.current = false
 loopStartRef.current = null
 loopEndRef.current = null
 }, [])

 // Auto-load on mount
 useEffect(() => {
 if (!isLoaded && !isLoading) {
 loadFiles()
 }
 }, []) // eslint-disable-line react-hooks/exhaustive-deps

 // Keyboard shortcuts
 useEffect(() => {
 const handleKey = (e: KeyboardEvent) => {
 if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
 switch (e.key) {
 case ' ':
 e.preventDefault()
 togglePlay()
 break
 case 'a': case 'A':
 switchFile('A')
 break
 case 'b': case 'B':
 switchFile('B')
 break
 case 'l': case 'L':
 if (loopEnabledRef.current) clearLoop()
 else if (loopStartRef.current !== null) {
 setLoopEnabled(true)
 loopEnabledRef.current = true
 }
 break
 case 'm': case 'M':
 toggleMono()
 break
 case 'ArrowLeft':
 e.preventDefault()
 if (duration > 0) {
 const newTimeL = Math.max(0, currentTime - 5)
 offsetRef.current = newTimeL
 setCurrentTime(newTimeL)
 if (isPlaying) startPlayback(newTimeL)
 }
 break
 case 'ArrowRight':
 e.preventDefault()
 if (duration > 0) {
 const newTimeR = Math.min(effectiveDurationRef.current - 0.1, currentTime + 5)
 offsetRef.current = newTimeR
 setCurrentTime(newTimeR)
 if (isPlaying) startPlayback(newTimeR)
 }
 break
 }
 }
 if (isLoaded) {
 window.addEventListener('keydown', handleKey)
 return () => window.removeEventListener('keydown', handleKey)
 }
 }, [isLoaded, togglePlay, switchFile, toggleMono, currentTime, duration, loopEnabled, loopStart, clearLoop])

 // ── Cross-tab shortcuts from the central handler. Space, A, B work from
 // any tab, not just when the player element has focus. L/M fall through
 // to their respective owners (EQPreviewPlayer, this file's toggleMono).
 useEffect(() => {
 if (!isLoaded) return
 // CRIT-7: when the BlindTestPanel is open (it mounts its own ABPlayer
 // inside the overlay), an OUTER ABPlayer in AnalysisView would also
 // receive Space and toggle play — two AudioContexts racing the output.
 // If we're not the ABPlayer inside the blind-test overlay, suppress
 // shortcuts and pause if currently playing.
 const isInsideBlindTest = !!playerRef.current?.closest('[data-blind-test-open="true"]')
 const blindTestOpen = !!document.querySelector('[data-blind-test-open="true"]')
 if (blindTestOpen && !isInsideBlindTest) {
 if (isPlaying) togglePlay()
 return  // don't even subscribe — outer player is muted
 }
 const unsubs = [
 onShortcut(RTM_EVENTS.playToggle, () => togglePlay()),
 onShortcut(RTM_EVENTS.sourceA, () => switchFile('A')),
 onShortcut(RTM_EVENTS.sourceB, () => switchFile('B')),
 onShortcut(RTM_EVENTS.monoMonitorToggle, () => toggleMono()),
 // Exclusive playback — if the EQ preview just started, we pause.
 // togglePlay() does the right thing whether we're playing or not.
 onShortcut(RTM_EVENTS.eqPreviewStarted, () => {
 if (isPlaying) togglePlay()
 }),
 ]
 return () => { unsubs.forEach(u => u()) }
 }, [isLoaded, togglePlay, switchFile, toggleMono, isPlaying])

 // CRIT-7: also pause the outer ABPlayer when BlindTestPanel opens
 // mid-playback (the effect above only runs on isLoaded change).
 // Poll the DOM for the data attribute; cheap (every 250ms while open).
 useEffect(() => {
 const interval = setInterval(() => {
 const blindOpen = !!document.querySelector('[data-blind-test-open="true"]')
 const isInside = !!playerRef.current?.closest('[data-blind-test-open="true"]')
 if (blindOpen && !isInside && isPlaying) {
 togglePlay()
 }
 }, 250)
 return () => clearInterval(interval)
 }, [isPlaying, togglePlay])

 // Listen for external seek requests (e.g., from ClickTimeline)
 useEffect(() => {
 const handleSeekRequest = (e: Event) => {
 const detail = (e as CustomEvent).detail
 if (detail && typeof detail.time === 'number' && isLoaded) {
 const time = Math.min(detail.time, effectiveDurationRef.current - 0.1)
 offsetRef.current = time
 setCurrentTime(time)
 if (detail.file === 'A' || detail.file === 'B') {
 switchFile(detail.file)
 }
 if (isPlaying) {
 startPlayback(time)
 }
 }
 }
 window.addEventListener('rtm-seek', handleSeekRequest)
 return () => window.removeEventListener('rtm-seek', handleSeekRequest)
 }, [isLoaded, isPlaying, startPlayback, switchFile])

 // Cleanup
 useEffect(() => {
 return () => {
 cancelAnimationFrame(rafRef.current)
 sourceRef.current?.stop()
 audioCtxRef.current?.close()
 }
 }, [])

 const realLabelA = fileA.name.replace(/\.[^/.]+$/, '')
 const realLabelB = fileB.name.replace(/\.[^/.]+$/, '')
 // In blind mode we hide the actual filenames and show neutral labels.
 const labelA = blindMode ? '?' : realLabelA
 const labelB = blindMode ? '?' : realLabelB
 // Effective duration — stems are shorter than full mix
 const effectiveDuration = (() => {
 if (playerMode === 'stems' && stemsLoaded) {
 const buf = getBuffer(activeFile, 'stems', activeStem)
 return buf ? buf.duration : duration
 }
 return duration
 })()

 effectiveDurationRef.current = effectiveDuration
 const progress = effectiveDuration > 0 ? (currentTime / effectiveDuration) * 100 : 0
 const loopStartPct = loopStart !== null && effectiveDuration > 0 ? (loopStart / effectiveDuration) * 100 : null
 const loopEndPct = loopEnd !== null && effectiveDuration > 0 ? (loopEnd / effectiveDuration) * 100 : null

 // Current waveform and color based on mode
 const isStems = playerMode === 'stems' && stemsLoaded
 const currentWaveform = isStems
 ? ((activeFile === 'A' ? stemWaveformsA : stemWaveformsB)[activeStem] || (activeFile === 'A' ? waveformA : waveformB))
 : (activeFile === 'A' ? waveformA : waveformB)
 const currentBarColor = isStems
 ? (activeStem === 'drums' ? '#e05a5a' : activeStem === 'bass' ? '#6b8cbb' : activeStem === 'vocals' ? '#e07a4f' : '#a855f7')
 : (activeFile === 'A' ? '#6b8cbb' : '#e07a4f')

 return (
 <div ref={playerRef} className="bg-dark-900 p-6 border border-dark-700/50 space-y-4" style={{ borderRadius: '2px' }}>
 <div className="flex items-center justify-between">
 <h2 className="text-lg font-semibold">A/B Player</h2>
 <div className="flex items-center gap-3">
 {/* Live EQ indicator — lit when bands are engaged in the main
 player's listen chain. Amount slider + bypass toggle
 colocated so any proposal (Engineer Tips, Reference Match,
 Master Assistant) can be dialled in from one place — panel
 ask: "move the Amount fader into the player header."
 Keeps the three panels from duplicating the control. */}
 {isLoaded && eq.bands.length > 0 && (
 <div className="flex items-center gap-2">
 <input
 type="range"
 min={0}
 max={150}
 value={Math.round(eq.amount * 100)}
 onChange={e => eq.setAmount(Number(e.target.value) / 100)}
 disabled={!eq.enabled}
 className="w-20 h-1 appearance-none cursor-pointer rounded-full disabled:opacity-40"
 style={{
 background: `linear-gradient(90deg, rgba(208,176,102,0.6) 0%, rgba(208,176,102,0.6) ${Math.min(100, Math.round(eq.amount * 100 / 1.5))}%, rgba(168,161,150,0.15) ${Math.min(100, Math.round(eq.amount * 100 / 1.5))}%, rgba(168,161,150,0.15) 100%)`,
 }}
 aria-label={`EQ amount ${Math.round(eq.amount * 100)} percent`}
 title={`EQ Amount · ${Math.round(eq.amount * 100)}% · scales all band gains. 0 = silence, 100 = as proposed, 150 = 1.5× push.`}
 />
 <span className="text-[9px] font-mono" style={{ color: eq.enabled ? '#d0b066' : '#8d867b', minWidth: 26 }}>
 {Math.round(eq.amount * 100)}%
 </span>
 <button
 onClick={() => eq.setEnabled(!eq.enabled)}
 className="text-[10px] px-2 py-0.5 transition-colors"
 style={{
  borderRadius: '2px',
 color: eq.enabled ? '#d0b066' : '#8d867b',
 backgroundColor: eq.enabled ? 'rgba(208,176,102,0.15)' : 'transparent',
 border: `1px solid ${eq.enabled ? 'rgba(208,176,102,0.45)' : 'rgba(87,83,78,0.35)'}`,
 fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
 }}
 title={eq.enabled
 ? `EQ engaged: ${eq.bands.filter(b => b.enabled).length} band(s) at ${Math.round(eq.amount * 100)}% amount. Click to bypass.`
 : 'EQ bypassed. Click to engage the proposed bands live.'}
 aria-pressed={eq.enabled}
 >
 EQ {eq.enabled ? 'ON' : 'BYPASS'}
 </button>
 </div>
 )}
 {isLoading && (
 <span className="text-xs text-dark-400">Loading audio...</span>
 )}
 {isLoaded && (
 <span className="text-[10px] text-dark-500">
 Level-matched ({Math.abs(gainAppliedDb).toFixed(1)} dB)
 </span>
 )}
 </div>
 </div>

 {isLoaded && (
 <>
 {/* Mix / Stems tabs */}
 {stems && (
 <div className="flex gap-1 p-0.5" style={{ borderRadius: '2px', backgroundColor: 'rgba(51,48,44,0.3)' }}>
 <button
 onClick={() => {
 setPlayerMode('mix')
 playerModeRef.current = 'mix'
 if (isPlaying && audioCtxRef.current) {
 const pos = audioCtxRef.current.currentTime - startTimeRef.current
 startPlayback(pos, 'mix', activeStemRef.current)
 }
 }}
 className="px-4 py-1.5 text-xs transition-all"
 style={{
  borderRadius: '2px',
 backgroundColor: playerMode === 'mix' ? 'rgba(224,122,79,0.15)' : 'transparent',
 color: playerMode === 'mix' ? '#e07a4f' : '#8d867b',
 fontWeight: playerMode === 'mix' ? 500 : 400,
 }}
 >
 Full Mix
 </button>
 <button
 onClick={() => {
 setPlayerMode('stems')
 playerModeRef.current = 'stems'
 if (!stemsLoaded && !stemsLoading) loadStems()
 else if (isPlaying && audioCtxRef.current && stemsLoaded) {
 const pos = audioCtxRef.current.currentTime - startTimeRef.current
 startPlayback(pos, 'stems', activeStemRef.current)
 }
 }}
 className="px-4 py-1.5 text-xs transition-all"
 style={{
  borderRadius: '2px',
 backgroundColor: playerMode === 'stems' ? 'rgba(224,122,79,0.15)' : 'transparent',
 color: playerMode === 'stems' ? '#e07a4f' : '#8d867b',
 fontWeight: playerMode === 'stems' ? 500 : 400,
 }}
 >
 Stems {stemsLoading ? '...' : ''}
 </button>
 </div>
 )}

 {/* Stem selector + ad-hoc drop target */}
 {playerMode === 'stems' && (
 <div className="space-y-2">
 {stemsLoaded && (
 <div className="flex gap-1.5 flex-wrap">
 {Object.keys(stemBuffersARef.current).map(name => {
 const m = stemMetrics[name]
 // Per-stem TP + Loud readout. Highest-TP stem is flagged
 // so the TP offender on a summed master is findable at a glance.
 const tp = m ? (activeFile === 'A' ? m.tpA : m.tpB) : null
 const loud = m ? (activeFile === 'A' ? m.loudA : m.loudB) : null
 const allTps = Object.values(stemMetrics).map(x => activeFile === 'A' ? x.tpA : x.tpB).filter(v => Number.isFinite(v))
 const maxTp = allTps.length ? Math.max(...allTps) : null
 const isTpOffender = m != null && maxTp != null && (activeFile === 'A' ? m.tpA : m.tpB) === maxTp && maxTp > -3
 // TP "over" warning disabled by user direction — show numbers only.
 const tpOver = false
 void (tp != null && tp > -1.0)
 return (
 <button
 key={name}
 onClick={() => {
 setActiveStem(name)
 activeStemRef.current = name
 if (isPlaying && audioCtxRef.current) {
 const pos = audioCtxRef.current.currentTime - startTimeRef.current
 startPlayback(pos, 'stems', name)
 }
 }}
 className="px-3 py-1.5 text-[11px] capitalize transition-all flex flex-col items-start gap-0.5" style={{ borderRadius: '2px' }}
 style={{
 backgroundColor: activeStem === name ? stemColor(name, 0.2) : 'rgba(51,48,44,0.3)',
 color: activeStem === name ? stemColor(name, 1) : '#78716c',
 border: activeStem === name ? `1px solid ${stemColor(name, 0.4)}` : '1px solid transparent',
 fontWeight: activeStem === name ? 500 : 400,
 }}
 title={m
 ? `${name} · ${activeFile}: TP ${tp!.toFixed(1)} dBTP · Loud ${loud!.toFixed(1)} dBFS${isTpOffender ? ' · highest TP of the loaded stems' : ''}. TP is 4× oversampled (~0.5 dB accurate); Loud is broadband RMS, not strict LUFS.`
 : name}
 >
 <span>{name}</span>
 {m && tp != null && loud != null && (
 <span
 className="font-mono text-[8px] tracking-tight"
 style={{
 color: tpOver ? '#e05a5a' : isTpOffender ? '#c5a55a' : '#8d867b',
 opacity: 0.9,
 }}
 >
 {/* ≈ prefix flags Loud as an approximation (broadband RMS). */}
 {tp.toFixed(1)} · ≈{loud.toFixed(1)}
 </span>
 )}
 </button>
 )
 })}
 </div>
 )}
 {/* Ad-hoc stem drop rail — drop 1-4 WAVs named
 vocals/drums/bass/other.wav into A or B without any
 folder-pattern gymnastics. */}
 <div className="grid grid-cols-2 gap-2">
 {(['A', 'B'] as const).map(side => (
 <div
 key={side}
 onDragOver={e => { e.preventDefault(); setStemDragging(side) }}
 onDragLeave={() => setStemDragging(null)}
 onDrop={async e => {
 e.preventDefault()
 setStemDragging(null)
 const files = Array.from(e.dataTransfer.files || [])
 if (files.length === 0) return
 const ctx = audioCtxRef.current
 if (!ctx || !window.electronAPI?.readAudioFile) {
 setStemDropMsg('Player not ready — wait for audio load.')
 return
 }
 const target = side === 'A' ? stemBuffersARef.current : stemBuffersBRef.current
 const wfTarget: Record<string, number[]> = side === 'A' ? { ...stemWaveformsA } : { ...stemWaveformsB }
 let loaded = 0
 for (const f of files) {
 const nameLower = f.name.toLowerCase()
 let stemName = 'other'
 if (nameLower.includes('vocal') || nameLower.includes('vox')) stemName = 'vocals'
 else if (nameLower.includes('drum') || nameLower.includes('beat')) stemName = 'drums'
 else if (nameLower.includes('bass')) stemName = 'bass'
 else if (nameLower.includes('other') || nameLower.includes('melody') || nameLower.includes('synth')) stemName = 'other'
 // Electron 32+: File.path is undefined; use webUtils.getPathForFile()
 // to resolve the path. Works on macOS (forward-slash) and Windows (backslash).
 const path = (window as any).electronAPI?.getPathForFile?.(f) || (f as any).path
 if (!path) continue
 try {
 const ab = await window.electronAPI.readAudioFile(path)
 const buf = await ctx.decodeAudioData(ab.slice(0))
 target[stemName] = buf
 wfTarget[stemName] = extractWaveform(buf, 200)
 loaded++
 } catch (err) {
 console.error('stem decode failed:', err)
 }
 }
 if (side === 'A') setStemWaveformsA(wfTarget)
 else setStemWaveformsB(wfTarget)
 setStemsLoaded(true)
 setStemDropMsg(`Loaded ${loaded} stem${loaded === 1 ? '' : 's'} into ${side}.`)
 }}
 className="px-3 py-2 text-[10px] text-center transition-colors" style={{ borderRadius: '2px' }}
 style={{
 border: `1px dashed ${stemDragging === side ? 'rgba(208,176,102,0.5)' : 'rgba(168,161,150,0.2)'}`,
 backgroundColor: stemDragging === side ? 'rgba(208,176,102,0.08)' : 'rgba(30,28,24,0.3)',
 color: stemDragging === side ? '#d0b066' : '#7a7164',
 }}
 >
 Drop stems into {side}: vocals / drums / bass / other
 </div>
 ))}
 </div>
 {stemDropMsg && (
 <p className="text-[10px] text-center" style={{ color: '#6ec577' }}>✓ {stemDropMsg}</p>
 )}
 </div>
 )}

 {/* Blind-test control bar — shuffle, guess, score */}
 {blindMode && (
 <div className="p-3 space-y-2" style={{ borderRadius: '2px', backgroundColor: 'rgba(208,176,102,0.08)', border: '1px solid rgba(208,176,102,0.25)' }}>
 <div className="flex items-center justify-between gap-3">
 <div className="text-[10px] uppercase tracking-[0.15em]" style={{ color: '#d0b066' }}>
 Blind A/B · guess which is {realLabelB.slice(0, 24)}{realLabelB.length > 24 ? '…' : ''}
 </div>
 <div className="text-[11px] font-mono" style={{ color: '#d0b066' }}>
 Score {blindScore.correct}/{blindScore.total}
 </div>
 </div>
 {blindRoundResult ? (
 <div className="flex items-center justify-between gap-3">
 <span className="text-xs" style={{ color: blindRoundResult.wasCorrect ? '#6fa37e' : '#c96765' }}>
 {blindRoundResult.wasCorrect ? '✓ Correct' : '✕ Wrong'} — "{blindRoundResult.correctLetter}" was playing {realLabelB.slice(0, 40)}
 </span>
 <button
 onClick={() => {
 setShuffled(Math.random() < 0.5)
 setShuffleKey(k => k + 1)
 setBlindRoundResult(null)
 }}
 className="text-[11px] px-3 py-1"
 style={{ borderRadius: '2px', backgroundColor: 'transparent', border: '1px solid #d0b066', color: '#d0b066' }}
 >
 Next round
 </button>
 </div>
 ) : (
 <div className="flex items-center gap-2">
 <span className="text-[11px] text-dark-400">Listen, then pick:</span>
 {(['A', 'B'] as const).map(letter => (
 <button
 key={letter}
 onClick={() => {
 // The "correct" physical file is B = realLabelB.
 // The button the user picked maps to physical via resolveBlindFile.
 const physical = resolveBlindFile(letter)
 const wasCorrect = physical === 'B'
 const newScore = { correct: blindScore.correct + (wasCorrect ? 1 : 0), total: blindScore.total + 1 }
 setBlindScore(newScore)
 try { localStorage.setItem('rtm-blind-score', JSON.stringify(newScore)) } catch {}
 // correctLetter = which UI button *was* behind
 // the real fileB. If the user guessed A and
 // that mapped to physical B, then the "B" they
 // were looking for was under button A → correct
 // letter is 'A'. Previously this stored the
 // user's guess as the correct letter, which
 // made the reveal line read tautologically.
 const correctLetter: 'A' | 'B' = wasCorrect ? letter : (letter === 'A' ? 'B' : 'A')
 setBlindRoundResult({ guess: letter, correctLetter, wasCorrect })
 }}
 className="flex-1 py-1.5 text-xs font-medium" style={{ borderRadius: '2px' }}
 style={{ backgroundColor: 'rgba(14,13,11,0.4)', color: '#ebe7e0', border: '1px solid rgba(208,176,102,0.3)' }}
 >
 "{letter}" is {realLabelB.slice(0, 20)}{realLabelB.length > 20 ? '…' : ''}
 </button>
 ))}
 <button
 onClick={() => {
 setShuffled(Math.random() < 0.5)
 setShuffleKey(k => k + 1)
 }}
 className="text-[10px] px-2 py-1 text-dark-400" style={{ borderRadius: '2px' }}
 style={{ border: '1px solid rgba(87,83,78,0.3)' }}
 title="Re-shuffle which button plays which file"
 >
 Shuffle
 </button>
 </div>
 )}
 </div>
 )}

 {/* A/B Switch — 5.3.0 a11y: role=group with aria-pressed on each
     button so screen readers announce which channel is active. */}
 <div className="flex items-center gap-2" role="group" aria-label="A/B audio source">
 <button
 onClick={() => switchFile('A')}
 aria-pressed={activeFile === 'A'}
 aria-label={`A — ${labelA}${activeFile === 'A' ? ' (active)' : ''}`}
 className="flex-1 py-2.5 text-sm font-medium transition-all"
 style={{
  borderRadius: '2px',
 backgroundColor: activeFile === 'A' ? 'rgba(107,140,187,0.2)' : 'rgba(51,48,44,0.3)',
 border: activeFile === 'A' ? '1px solid rgba(107,140,187,0.4)' : '1px solid transparent',
 color: activeFile === 'A' ? '#6b8cbb' : '#8d867b',
 }}
 >
 A — {labelA}
 </button>

 {/* Quick A/B flip button */}
 <button
 onClick={() => switchFile(activeFile === 'A' ? 'B' : 'A')}
 aria-label="Flip A/B"
 className="flex-shrink-0 w-10 h-10 flex items-center justify-center transition-all" style={{ borderRadius: '2px' }}
 style={{
 backgroundColor: 'rgba(224,122,79,0.12)',
 border: '1px solid rgba(224,122,79,0.25)',
 color: '#e07a4f',
 }}
 title="Flip A/B"
 >
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
 <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
 </svg>
 </button>

 <button
 onClick={() => switchFile('B')}
 aria-pressed={activeFile === 'B'}
 aria-label={`B — ${labelB}${activeFile === 'B' ? ' (active)' : ''}`}
 className="flex-1 py-2.5 text-sm font-medium transition-all"
 style={{
  borderRadius: '2px',
 backgroundColor: activeFile === 'B' ? 'rgba(224,122,79,0.15)' : 'rgba(51,48,44,0.3)',
 border: activeFile === 'B' ? '1px solid rgba(224,122,79,0.3)' : '1px solid transparent',
 color: activeFile === 'B' ? '#e07a4f' : '#8d867b',
 }}
 >
 B — {labelB}
 </button>
 </div>

 {/* Reference-curve overlay — shown when the user has picked a
 reference in the Library / Match flow. Tiny 31-band strip
 above the waveform so scrubbing the master against the
 reference's tonal shape doesn't require a panel switch.
 Context value wins; explicit prop is the fallback for
 embeds that don't use the context. */}
 {(() => {
 const rc = eq.referenceCurve || referenceCurve
 const rl = eq.referenceLabel || referenceLabel
 if (!rc || rc.length === 0) return null
 return (
 <InlineRefCurve
 referenceCurve={rc}
 currentCurve={currentCurve || null}
 referenceLabel={rl || undefined}
 />
 )
 })()}

 {/* Waveform with loop region */}
 <div
 ref={waveformRef}
 className="relative h-16 bg-dark-800 cursor-pointer overflow-hidden select-none" style={{ borderRadius: '2px' }}
 onMouseDown={handleWaveformMouseDown}
 onMouseMove={handleWaveformMouseMove}
 onMouseUp={handleWaveformMouseUp}
 onMouseLeave={() => setIsDraggingLoop(false)}
 >
 {/* Loop region highlight */}
 {loopStartPct !== null && loopEndPct !== null && (
 <div
 className="absolute top-0 bottom-0 z-[1]"
 style={{
 left: `${loopStartPct}%`,
 width: `${loopEndPct - loopStartPct}%`,
 backgroundColor: loopEnabled ? 'rgba(224,122,79,0.15)' : 'rgba(224,122,79,0.08)',
 borderLeft: '1px solid rgba(224,122,79,0.5)',
 borderRight: '1px solid rgba(224,122,79,0.5)',
 }}
 />
 )}

 {/* Waveform bars */}
 <div className="absolute inset-0 flex items-center px-1 z-[2]">
 {currentWaveform.map((val, i) => {
 const barPct = (i / currentWaveform.length) * 100
 const isPast = barPct < progress
 const inLoop = loopStartPct !== null && loopEndPct !== null && barPct >= loopStartPct && barPct <= loopEndPct
 return (
 <div
 key={i}
 className="flex-1 mx-px rounded-sm"
 style={{
 height: `${Math.max(4, val * 100)}%`,
 backgroundColor: currentBarColor,
 opacity: isPast ? 0.9 : inLoop ? 0.5 : 0.25,
 }}
 />
 )
 })}
 </div>

 {/* Playhead */}
 <div
 className="absolute top-0 bottom-0 w-0.5 bg-white z-[3]"
 style={{ left: `${progress}%` }}
 />
 </div>

 {/* Live TP meter — tapped off the final bus. Two numbers:
 INST = instantaneous peak this rAF frame, PEAK = 2-second
 rolling max. Display only — no warning colours (per user
 direction, top-40 references routinely exceed −1 dBTP and
 the alarm was crying wolf). */}
 <LiveTpMeter liveRef={tpLiveDbRef} peakRef={tpPeakDbRef} isPlaying={isPlaying} />

 {/* Transport */}
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 {/* Play/Pause */}
 <button
 onClick={togglePlay}
 className="w-11 h-11 rounded-full flex items-center justify-center transition-colors hover:bg-dark-700"
 style={{ backgroundColor: '#33302c' }}
 aria-label={isPlaying ? 'Pause playback (Space)' : 'Play (Space)'}
 title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
 >
 {isPlaying ? (
 <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
 <rect x="6" y="4" width="4" height="16" rx="1" />
 <rect x="14" y="4" width="4" height="16" rx="1" />
 </svg>
 ) : (
 <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
 <path d="M8 5v14l11-7z" />
 </svg>
 )}
 </button>

 {/* Loop toggle */}
 <button
 onClick={() => {
 if (loopEnabled) clearLoop()
 else if (loopStart !== null) setLoopEnabled(!loopEnabled)
 }}
 className="w-10 h-10 rounded-full flex items-center justify-center transition-colors"
 style={{
 backgroundColor: loopEnabled ? 'rgba(224,122,79,0.2)' : '#33302c',
 color: loopEnabled ? '#e07a4f' : '#8d867b',
 }}
 title={loopEnabled ? 'Clear loop (L)' : 'Drag on waveform to set loop'}
 aria-label={loopEnabled ? 'Clear loop' : 'Loop disabled. Drag on waveform to set loop region'}
 >
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
 </svg>
 </button>

 {/* Listen-mode selector — Stereo / Mono / Mid / Side / Phone.
 Phone simulates how the master will sound on a phone speaker. */}
 <div className="flex items-center gap-1 h-10 rounded-full px-1" style={{ backgroundColor: '#33302c' }}>
 {(['stereo','mono','mid','side','phone'] as ListenMode[]).map(m => {
 const active = listenMode === m
 const label = { stereo: 'ST', mono: 'M', mid: 'MID', side: 'SIDE', phone: '📱' }[m]
 const longTitle = {
 stereo: 'Stereo (default)',
 mono: 'Mono sum, check mono compatibility (M)',
 mid: 'Mid-only. Hear what the center carries.',
 side: 'Side-only. Hear reverbs, wideners, panned elements.',
 phone: 'Phone listener. Simulates a phone speaker (300 Hz–3.4 kHz + presence).',
 }[m]
 return (
 <button
 key={m}
 onClick={() => applyListenMode(m)}
 className="px-2 h-8 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors"
 style={{
 backgroundColor: active ? 'rgba(208,176,102,0.2)' : 'transparent',
 color: active ? '#d0b066' : '#8d867b',
 }}
 title={longTitle}
 aria-label={longTitle}
 aria-pressed={active}
 >
 {label}
 </button>
 )
 })}
 </div>

 {/* Time — beta-tester request (5.0.6): tenth-of-a-second precision so
     users can pinpoint where a click / artefact is, not just round
     seconds. Loop range goes a step further to milliseconds because
     loop boundaries are drag-precise actions. */}
 <span className="text-xs font-mono" style={{ color: '#78716c' }} title={formatPreciseTime(currentTime, 'milli')}>
 {formatPreciseTime(currentTime, 'tenth')} / {formatPreciseTime(effectiveDuration, 'tenth')}
 </span>

 {/* Loop indicator */}
 {loopEnabled && loopStart !== null && loopEnd !== null && (
 <span className="text-[10px] px-2 py-0.5 rounded-full font-mono" style={{ backgroundColor: 'rgba(224,122,79,0.15)', color: '#e07a4f' }}
       title={`${formatPreciseTime(loopStart, 'milli')} — ${formatPreciseTime(loopEnd, 'milli')}`}>
 Loop: {formatPreciseTime(loopStart, 'tenth')} — {formatPreciseTime(loopEnd, 'tenth')}
 </span>
 )}

 {/* Spectrum-band solo pill — beta-tester request: "solo the
     frequency that the spectrum is giving us". Click any band on
     the spectrum chart to engage; this pill shows what's soloed
     and clears it. Esc also clears (handled in SoloContext). */}
 <SoloPill />
 </div>

 {/* Keyboard shortcuts */}
 <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]" style={{ color: '#8d867b' }}>
 <span><kbd className="px-1 py-0.5 rounded" style={{ backgroundColor: '#272524', color: '#78716c' }}>Space</kbd> play</span>
 <span><kbd className="px-1 py-0.5 rounded" style={{ backgroundColor: '#272524', color: '#78716c' }}>A</kbd> <kbd className="px-1 py-0.5 rounded" style={{ backgroundColor: '#272524', color: '#78716c' }}>B</kbd> switch</span>
 <span><kbd className="px-1 py-0.5 rounded" style={{ backgroundColor: '#272524', color: '#78716c' }}>←</kbd> <kbd className="px-1 py-0.5 rounded" style={{ backgroundColor: '#272524', color: '#78716c' }}>→</kbd> scrub</span>
 <span><kbd className="px-1 py-0.5 rounded" style={{ backgroundColor: '#272524', color: '#78716c' }}>M</kbd> mono</span>
 <span><kbd className="px-1 py-0.5 rounded" style={{ backgroundColor: '#272524', color: '#78716c' }}>L</kbd> loop</span>
 <span style={{ color: '#44403c' }}>· drag waveform to set loop</span>
 </div>
 </div>
 </>
 )}

 {!isLoaded && !isLoading && (
 <p className="text-xs text-center py-2" style={{ color: '#8d867b' }}>
 Preparing audio...
 </p>
 )}
 </div>
 )
}

/**
 * Tiny 31-band spectrum strip rendered above the waveform. Shows the
 * reference curve (gold) and optionally the current track's curve
 * (dusky blue) on the same axis, normalised so both peaks sit at 0 dB.
 * dB scale on the left, frequency ticks at the bottom. Height tuned
 * tight (52 px) so it doesn't push the transport down.
 */
function InlineRefCurve({ referenceCurve, currentCurve, referenceLabel }: {
 referenceCurve: number[]
 currentCurve: number[] | null
 referenceLabel?: string
}) {
 const n = Math.min(referenceCurve.length, currentCurve?.length ?? referenceCurve.length, 31)
 if (n < 2) return null
 const BANDS = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000]
 const w = 600, h = 52
 const pad = { t: 6, r: 4, b: 12, l: 22 }
 // Align each curve to its A-weighted perceptual centre — same fix as
 // RefOnlyView and spectrumMatch.  Peak-normalising lets a single
 // outlier band set the pivot, which yanks the whole curve and makes
 // the shape comparison misleading.  levelAlign() puts each curve at
 // its own perceptual mean = 0 dB.
 const ref = levelAlign(referenceCurve.slice(0, n))
 const cur = currentCurve ? levelAlign(currentCurve.slice(0, n)) : null
 const yMin = -36, yMax = 3
 const toY = (v: number) => {
 const cl = Math.max(yMin, Math.min(yMax, v))
 return pad.t + (1 - (cl - yMin) / (yMax - yMin)) * (h - pad.t - pad.b)
 }
 const toX = (i: number) => pad.l + (i / Math.max(1, n - 1)) * (w - pad.l - pad.r)
 const smoothPath = (arr: number[]) => {
 let d = `M ${toX(0).toFixed(1)} ${toY(arr[0]).toFixed(1)}`
 for (let i = 1; i < n; i++) {
 const px = toX(i - 1), py = toY(arr[i - 1]), x = toX(i), y = toY(arr[i])
 const cx = (px + x) / 2
 d += ` C ${cx.toFixed(1)} ${py.toFixed(1)}, ${cx.toFixed(1)} ${y.toFixed(1)}, ${x.toFixed(1)} ${y.toFixed(1)}`
 }
 return d
 }
 const tickFreqs = [100, 1000, 10000]
 return (
 <div
 className="overflow-hidden"
 style={{ borderRadius: '2px', backgroundColor: 'rgba(14,13,11,0.55)', border: '1px solid rgba(168,161,150,0.08)' }}
 title={referenceLabel
 ? `Reference spectrum overlay. Gold curve is ${referenceLabel}. Scrub the master underneath to hear tonal alignment in context.`
 : 'Reference spectrum overlay'}
 >
 <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height: 52 }}>
 {/* dB grid */}
 {[-24, -12, 0].map(db => (
 <line
 key={db}
 x1={pad.l} y1={toY(db)} x2={w - pad.r} y2={toY(db)}
 stroke="#2a2927" strokeWidth="0.5" strokeDasharray="2 3"
 />
 ))}
 {[-24, -12, 0].map(db => (
 <text key={`l-${db}`} x={pad.l - 3} y={toY(db) + 3} fontSize="7" fill="#57534e" textAnchor="end">{db}</text>
 ))}
 {tickFreqs.map(f => {
 const idx = BANDS.findIndex(b => b >= f)
 if (idx < 0) return null
 return (
 <text key={f} x={toX(idx)} y={h - 2} fontSize="7" fill="#57534e" textAnchor="middle">
 {f >= 1000 ? `${f / 1000}k` : f}
 </text>
 )
 })}
 {cur && <path d={smoothPath(cur)} fill="none" stroke="#6b8cbb" strokeWidth="1.1" opacity="0.75" />}
 <path d={smoothPath(ref)} fill="none" stroke="#d0b066" strokeWidth="1.3" />
 </svg>
 <div className="flex items-center gap-3 px-2 pb-1 text-[8px]" style={{ color: '#7a7164' }}>
 <span className="flex items-center gap-1">
 <span className="w-3 h-px" style={{ backgroundColor: '#d0b066' }} />
 Ref{referenceLabel ? `: ${referenceLabel}` : ''}
 </span>
 {cur && (
 <span className="flex items-center gap-1">
 <span className="w-3 h-px" style={{ backgroundColor: '#6b8cbb' }} />
 Current
 </span>
 )}
 </div>
 </div>
 )
}

function stemColor(name: string, alpha: number): string {
 const colors: Record<string, string> = {
 vocals: `rgba(224,122,79,${alpha})`,
 drums: `rgba(224,90,90,${alpha})`,
 bass: `rgba(107,140,187,${alpha})`,
 other: `rgba(168,85,247,${alpha})`,
 }
 return colors[name] || `rgba(168,162,158,${alpha})`
}

function extractWaveform(buffer: AudioBuffer, bars: number): number[] {
 const data = buffer.getChannelData(0)
 const blockSize = Math.floor(data.length / bars)
 const waveform: number[] = []

 for (let i = 0; i < bars; i++) {
 let sum = 0
 const start = i * blockSize
 for (let j = start; j < start + blockSize && j < data.length; j++) {
 sum += Math.abs(data[j])
 }
 waveform.push(sum / blockSize)
 }

 const max = Math.max(...waveform, 0.01)
 return waveform.map(v => v / max)
}

/**
 * Approximate true-peak in dBTP via 4× linear-interpolation oversampling.
 *
 * This is the "naive oversample" method — accurate to roughly 0.5 dB
 * against a proper sinc-interpolated TP meter, which is plenty for
 * per-stem triage ("which stem is responsible for the master's TP
 * over?"). For certification-grade TP measurement the Python backend's
 * BS.1770 implementation remains authoritative; this client-side helper
 * exists purely to surface a fast per-stem read in the ABPlayer UI.
 *
 * Inputs: a decoded AudioBuffer (mono or multi-channel). Examines all
 * channels and returns the highest peak.
 */
function computeTruePeakDbtp(buffer: AudioBuffer): number {
 let maxPeak = 0
 for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
 const data = buffer.getChannelData(ch)
 // Scan raw samples for the initial peak (most masters peak here)
 for (let i = 0; i < data.length; i++) {
 const a = Math.abs(data[i])
 if (a > maxPeak) maxPeak = a
 }
 // 4× linear-interpolated oversample pass to catch inter-sample
 // peaks that lie between two adjacent samples.
 for (let i = 0; i < data.length - 1; i++) {
 const s0 = data[i], s1 = data[i + 1]
 for (let k = 1; k < 4; k++) {
 const t = k / 4
 const s = s0 * (1 - t) + s1 * t
 const a = Math.abs(s)
 if (a > maxPeak) maxPeak = a
 }
 }
 }
 if (maxPeak <= 1e-7) return -Infinity
 return 20 * Math.log10(maxPeak)
}

/**
 * Approximate integrated loudness in dBFS (not strict LUFS).
 *
 * We compute RMS over the whole buffer and express it in dBFS. This
 * is NOT BS.1770 K-weighted (no pre-filter, no gating), so we
 * intentionally label the UI column "Loud" rather than "LUFS" to
 * avoid mis-selling precision we don't have. For stem-level triage
 * (relative comparison: "vocals are 3 dB hotter than drums") this
 * tracks within ~1 dB of true LUFS for typical material.
 *
 * The backend provides real K-weighted LUFS on the summed master —
 * that's the certification read. This helper exists only to make the
 * ABPlayer stem selector informative in real time.
 */
function computeLoudnessDb(buffer: AudioBuffer): number {
 let sumSq = 0
 let n = 0
 for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
 const data = buffer.getChannelData(ch)
 for (let i = 0; i < data.length; i++) {
 const v = data[i]
 sumSq += v * v
 }
 n += data.length
 }
 if (n === 0) return -Infinity
 const rms = Math.sqrt(sumSq / n)
 if (rms <= 1e-7) return -Infinity
 return 20 * Math.log10(rms)
}

// Legacy second-precision formatter kept for any internal call sites that
// still expect the old shape — the user-visible readouts now route
// through formatPreciseTime so beta testers can see exact playhead
// position to a tenth (and a millisecond on hover).
function formatTime(seconds: number): string {
 return formatPreciseTime(seconds, 'second')
}

/**
 * Live TP meter display. Two readouts:
 * • INST — instantaneous sample peak this frame (approximate dBTP).
 * • PEAK — rolling 2-second maximum.
 *
 * Display only — no warning colours by user direction. Reference top-40
 * masters routinely sit above −1 dBTP, so the red alarm was crying wolf.
 *
 * Kept intentionally tiny + monospace so it reads like a hardware meter
 * rather than a UI chrome element. Hidden when nothing's playing yet
 * (values are −∞ until the first sample comes through).
 */
function LiveTpMeter({ liveRef, peakRef, isPlaying }: {
 liveRef: React.MutableRefObject<number>
 peakRef: React.MutableRefObject<number>
 isPlaying: boolean
}) {
 // 5.2.0 perf fix: read from refs on our own rAF and write to local
 // state at most ~30Hz. Kills the parent's full re-render that the
 // previous setState-on-every-tick pattern caused. Only THIS small
 // component re-renders; the 1700-line ABPlayer is untouched.
 const [tick, setTick] = React.useState(0)
 React.useEffect(() => {
 if (!isPlaying) return
 let raf = 0
 let last = 0
 const loop = (t: number) => {
 if (t - last > 33) { // ~30 Hz repaint, plenty for a meter
 last = t
 setTick(n => (n + 1) & 0xffff)
 }
 raf = requestAnimationFrame(loop)
 }
 raf = requestAnimationFrame(loop)
 return () => cancelAnimationFrame(raf)
 }, [isPlaying])
 void tick // read so React keeps the effect alive

 const fmt = (db: number) => {
 if (!isFinite(db) || db === -Infinity) return '—'
 return `${db >= 0 ? '+' : ''}${db.toFixed(1)}`
 }
 const live = liveRef.current
 const peak = peakRef.current
 const show = isPlaying || isFinite(peak)
 if (!show) return null
 return (
 <div
 className="flex items-center gap-3 px-3 py-1.5 self-end" style={{ borderRadius: '2px' }}
 style={{
 backgroundColor: 'rgba(14,13,11,0.55)',
 border: '1px solid rgba(168,161,150,0.18)',
 fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
 }}
 title="Near-TP meter — 2× linear-interpolation estimate off the final bus. Underestimates by ~0.3–0.5 dB vs the BS.1770-4 4× reference. PEAK holds for 2 s. Numbers only — no warning colour. The Apply-and-bounce render uses the mastering-grade 16× polyphase limiter."
 aria-label="Live near-TP meter (2× linear)"
 >
 <div className="flex items-baseline gap-1.5">
 <span className="text-[8px] uppercase tracking-[0.15em]" style={{ color: '#a8a29e' }}>INST</span>
 <span className="text-[11px] tabular-nums" style={{ color: '#a8a29e' }}>
 {fmt(live)}
 </span>
 </div>
 <span className="w-px h-3" style={{ backgroundColor: 'rgba(168,161,150,0.4)' }} />
 <div className="flex items-baseline gap-1.5">
 <span className="text-[8px] uppercase tracking-[0.15em]" style={{ color: '#a8a29e' }}>PEAK</span>
 <span className="text-[11px] font-medium tabular-nums" style={{ color: '#d0b066' }}>
 {fmt(peak)}
 </span>
 <span className="text-[8px]" style={{ color: '#a8a29e' }}>dBTP</span>
 </div>
 </div>
 )
}
