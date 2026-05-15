/**
 * Ear Training audio engine — Web Audio API DSP wrapper.
 *
 * All processing is real-time, in the browser. No Python, no IPC. The student's
 * loaded File A (or a curated reference clip) is decoded into an AudioBuffer
 * once; each drill question wires up a fresh BiquadFilter / DynamicsCompressor
 * / ConvolverNode chain over that buffer.
 *
 * Bands match the Golden Ears 1-octave grid (8 bands) plus an extended
 * 1/3-octave grid (31 bands) for advanced difficulty.
 */

/** 1-octave bands — Beginner and Intermediate. */
export const OCTAVE_BANDS = [
  { id: '63hz',   hz: 63,    label: '63 Hz'   },
  { id: '125hz',  hz: 125,   label: '125 Hz'  },
  { id: '250hz',  hz: 250,   label: '250 Hz'  },
  { id: '500hz',  hz: 500,   label: '500 Hz'  },
  { id: '1khz',   hz: 1000,  label: '1 kHz'   },
  { id: '2khz',   hz: 2000,  label: '2 kHz'   },
  { id: '4khz',   hz: 4000,  label: '4 kHz'   },
  { id: '8khz',   hz: 8000,  label: '8 kHz'   },
] as const

/** 1/3-octave bands — Advanced difficulty (subset of the standard 31-band set). */
export const THIRD_OCTAVE_BANDS = [
  { id: '50hz',    hz: 50,     label: '50 Hz'    },
  { id: '63hz',    hz: 63,     label: '63 Hz'    },
  { id: '80hz',    hz: 80,     label: '80 Hz'    },
  { id: '100hz',   hz: 100,    label: '100 Hz'   },
  { id: '125hz',   hz: 125,    label: '125 Hz'   },
  { id: '160hz',   hz: 160,    label: '160 Hz'   },
  { id: '200hz',   hz: 200,    label: '200 Hz'   },
  { id: '250hz',   hz: 250,    label: '250 Hz'   },
  { id: '315hz',   hz: 315,    label: '315 Hz'   },
  { id: '400hz',   hz: 400,    label: '400 Hz'   },
  { id: '500hz',   hz: 500,    label: '500 Hz'   },
  { id: '630hz',   hz: 630,    label: '630 Hz'   },
  { id: '800hz',   hz: 800,    label: '800 Hz'   },
  { id: '1khz',    hz: 1000,   label: '1 kHz'    },
  { id: '1.25khz', hz: 1250,   label: '1.25 kHz' },
  { id: '1.6khz',  hz: 1600,   label: '1.6 kHz'  },
  { id: '2khz',    hz: 2000,   label: '2 kHz'    },
  { id: '2.5khz',  hz: 2500,   label: '2.5 kHz'  },
  { id: '3.15khz', hz: 3150,   label: '3.15 kHz' },
  { id: '4khz',    hz: 4000,   label: '4 kHz'    },
  { id: '5khz',    hz: 5000,   label: '5 kHz'    },
  { id: '6.3khz',  hz: 6300,   label: '6.3 kHz'  },
  { id: '8khz',    hz: 8000,   label: '8 kHz'    },
  { id: '10khz',   hz: 10000,  label: '10 kHz'   },
  { id: '12.5khz', hz: 12500,  label: '12.5 kHz' },
  { id: '16khz',   hz: 16000,  label: '16 kHz'   },
] as const

export type BandId = string

import type { EarTrainingDifficulty } from '../../../types'

/** dB applied for EQ drills at each difficulty level. */
export const DIFFICULTY_GAIN_DB: Record<EarTrainingDifficulty, number> = {
  beginner:     12,
  intermediate:  6,
  advanced:      3,
}

/** Default Q for the BiquadFilter. Q_WIDTH drill overrides this. */
export const DEFAULT_Q = 4.0
export const NARROW_Q = 8.0
export const WIDE_Q   = 1.5

export interface PlayHandle {
  stop: () => void
  /** Resolves when playback ends naturally. */
  done: Promise<void>
}

export interface EQOptions {
  freq: number
  gainDB: number    // positive = boost, negative = cut
  q?: number
  type?: BiquadFilterType  // 'peaking' (default), 'lowshelf', 'highshelf'
}

export interface CompressionOptions {
  threshold: number  // dB, -100..0
  ratio: number      // 1..20
  attack: number     // seconds
  release: number    // seconds
  makeup: number     // dB, gain compensation
}

export interface ReverbOptions {
  /** seconds — synthesizes a noise-burst IR of this length */
  decaySec: number
  /** 0..1 — wet/dry mix */
  mix: number
}

export interface DistortionOptions {
  /** drive amount, 0..1 (subtle harmonic saturation, not hard clipping) */
  drive: number
}

/** Built-in procedural reference signals.
 *  These are what Golden Ears actually trains on — pure test signals
 *  isolate the EQ change from musical context. Music is added later. */
export type ReferenceClipId =
  | 'pink_noise'      // broadband pink noise — gold standard for freq ID
  | 'white_noise'     // flat-spectrum white noise — sharper HF training
  | 'drum_loop'       // synth kick+snare+hat loop — rhythmic context
  | 'vocal_noise'     // formant-shaped noise — sounds vocal-ish
  | 'full_mix'        // bass + drums + pad — mix-like content
  | 'loaded_file_a'   // the student's loaded File A

export const REFERENCE_CLIPS: Array<{ id: ReferenceClipId; label: string; description: string }> = [
  { id: 'pink_noise',   label: 'Pink Noise',    description: 'Equal energy per octave — standard' },
  { id: 'white_noise',  label: 'White Noise',   description: 'Flat spectrum — sharper HF training' },
  { id: 'drum_loop',    label: 'Drum Loop',     description: 'Kick/snare/hat — rhythmic context' },
  { id: 'vocal_noise',  label: 'Vocal-shaped',  description: 'Formant-shaped — vocal-like' },
  { id: 'full_mix',     label: 'Synth Mix',     description: 'Bass + drums + pad — full-mix context' },
  { id: 'loaded_file_a', label: 'My File A',    description: 'The audio you loaded into the analyser' },
]

class EarTrainingAudioEngine {
  private ctx: AudioContext | null = null
  private masterBuffer: AudioBuffer | null = null
  private masterSourceName: string | null = null
  private currentSource: AudioBufferSourceNode | null = null
  private proceduralCache: Partial<Record<ReferenceClipId, AudioBuffer>> = {}
  private activeClip: ReferenceClipId = 'pink_noise'
  /** Locked playback offset for the current question round.
   *  Set once when the first play fires per question, reused for all
   *  subsequent plays (Reference + Modified) so both start at the same
   *  point in the audio file. Reset to null by lockNewWindow(). */
  private lockedOffset: number | null = null

  /** Lazily create the AudioContext on first use (avoids autoplay-policy errors). */
  private getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    return this.ctx
  }

  /** Load an audio file (via file:// path) into an AudioBuffer for drill use.
   *  Returns the duration in seconds.
   *  LOW fix: use pathToFileURL semantics — manual concat produced "file://C:/"
   *  on Windows (missing the third slash). Now derives the URL safely.
   *  Also: previously short-circuited when displayName === masterSourceName,
   *  which left a stale buffer if the file at that path had been replaced on
   *  disk. Now caches by absolute path only and always re-decodes when the
   *  path changes. */
  async loadSource(filePath: string, displayName?: string): Promise<number> {
    if (this.masterSourceName === filePath && this.masterBuffer) {
      return this.masterBuffer.duration
    }
    const ctx = this.getContext()
    // In Electron, fetch('file://') is blocked by CSP. Use the IPC bridge instead.
    // Fall back to fetch() only in browser / dev-server contexts (no electronAPI).
    let arr: ArrayBuffer
    if (window.electronAPI?.readAudioFile) {
      arr = await window.electronAPI?.readAudioFile(filePath)
    } else {
      // Browser / dev-server fallback — build a proper file:// URL.
      const normalized = filePath.replace(/\\/g, '/')
      const url = filePath.startsWith('file://')
        ? filePath
        : /^[A-Za-z]:\//.test(normalized) ? `file:///${normalized}` : `file://${normalized}`
      const res = await fetch(url)
      arr = await res.arrayBuffer()
    }
    this.masterBuffer = await ctx.decodeAudioData(arr)
    this.masterSourceName = filePath
    void displayName  // kept for future API symmetry
    return this.masterBuffer.duration
  }

  /** Force the loaded-file buffer to invalidate. Call this when the user
   *  knows the file at the cached path has changed on disk and they want
   *  to re-read it. LOW fix. */
  invalidateLoadedFile(): void {
    this.masterBuffer = null
    this.masterSourceName = null
  }

  hasSource(): boolean {
    // Procedural clips are always available; only loaded_file_a needs an actual load.
    return this.activeClip !== 'loaded_file_a' || this.masterBuffer !== null
  }

  sourceName(): string | null {
    return this.masterSourceName
  }

  /** Switch the source material between procedural clips and the loaded file. */
  setActiveClip(id: ReferenceClipId) {
    this.activeClip = id
  }

  getActiveClip(): ReferenceClipId {
    return this.activeClip
  }

  /** Pre-warm the cache for the active clip without playing any audio.
   *  Call this in requestIdleCallback after opening the panel so the first
   *  real play doesn't block the UI thread for 150-300ms generating the
   *  procedural buffer. MED-27 fix. */
  prepare(): void {
    try { this.getCurrentBuffer() } catch { /* best-effort */ }
  }

  /** Resolve the AudioBuffer for the currently-active clip.
   *  Procedural clips are generated on first request and cached for the session. */
  private getCurrentBuffer(): AudioBuffer | null {
    if (this.activeClip === 'loaded_file_a') return this.masterBuffer
    const cached = this.proceduralCache[this.activeClip]
    if (cached) return cached
    const ctx = this.getContext()
    let buf: AudioBuffer | null = null
    switch (this.activeClip) {
      case 'pink_noise':   buf = this.generatePinkNoise(ctx, 8);  break
      case 'white_noise':  buf = this.generateWhiteNoise(ctx, 8); break
      case 'drum_loop':    buf = this.generateDrumLoop(ctx, 8);   break
      case 'vocal_noise':  buf = this.generateVocalNoise(ctx, 8); break
      case 'full_mix':     buf = this.generateFullMix(ctx, 8);    break
    }
    if (buf) this.proceduralCache[this.activeClip] = buf
    return buf
  }

  /** Pick a random short window of the source buffer to play.
   *  Avoids the first/last 0.5s (often silence/fade) and clamps to maxSec.
   *  For procedural clips (which are short loops), picks offset 0.
   *  Uses lockedOffset when set so that Reference and Modified always start
   *  at the same point in the file. Call lockNewWindow() before a new question. */
  private pickWindow(buffer: AudioBuffer, maxSec = 8): { offset: number; duration: number } {
    const total = buffer.duration
    if (total < 2) return { offset: 0, duration: total }
    // For short clips (procedural ones are ~8s), play the whole thing
    if (total <= maxSec + 1) return { offset: 0, duration: Math.min(total, maxSec) }
    const usableStart = 0.5
    const usableEnd = Math.max(usableStart + 1, total - 0.5)
    const winLen = Math.min(maxSec, usableEnd - usableStart)
    if (this.lockedOffset === null) {
      this.lockedOffset = usableStart + Math.random() * (usableEnd - usableStart - winLen)
    }
    return { offset: this.lockedOffset, duration: winLen }
  }

  /** Call this at the start of each new drill question so the next play
   *  picks a fresh random window — shared by Reference and Modified for
   *  that question round. */
  lockNewWindow(): void {
    this.lockedOffset = null
  }

  /** Resolve function for the current loop's done promise — called by stop(). */
  private resolveCurrentDone: (() => void) | null = null

  /** Stop any currently-playing source. Safe to call at any time. */
  stop() {
    if (this.currentSource) {
      try { this.currentSource.stop() } catch {}
      try { this.currentSource.disconnect() } catch {}
      this.currentSource = null
    }
    if (this.resolveCurrentDone) {
      this.resolveCurrentDone()
      this.resolveCurrentDone = null
    }
  }

  /** Play the source through a graph built by `chainBuilder`.
   *  When `loop=true`, plays endlessly until stop() is called — done resolves on stop.
   *  Returns a PlayHandle whose `done` promise resolves on natural end or stop. */
  private play(
    chainBuilder: (ctx: AudioContext, destination: AudioNode) => AudioNode,
    windowSec = 6,
    loop = false
  ): PlayHandle {
    this.stop()
    const buffer = this.getCurrentBuffer()
    if (!buffer) {
      return { stop: () => {}, done: Promise.resolve() }
    }
    const ctx = this.getContext()
    // Resume context if suspended (autoplay policy).
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {})
    }

    const masterGain = ctx.createGain()
    masterGain.gain.value = 0.85
    masterGain.connect(ctx.destination)

    const sourceInput = chainBuilder(ctx, masterGain)

    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(sourceInput)
    this.currentSource = src

    let done: Promise<void>
    if (loop) {
      src.loop = true
      // For looped playback: pick a window start point but play the whole buffer
      // from there (loopStart/loopEnd not set so it loops the full buffer).
      const win = this.pickWindow(buffer, windowSec)
      src.start(0, win.offset)
      // Done resolves when stop() is called.
      done = new Promise<void>(resolve => {
        this.resolveCurrentDone = resolve
      })
    } else {
      const win = this.pickWindow(buffer, windowSec)
      src.start(0, win.offset, win.duration)
      done = new Promise<void>(resolve => {
        src.onended = () => {
          this.currentSource = null
          resolve()
        }
      })
    }

    return {
      stop: () => this.stop(),
      done,
    }
  }

  /** Play unprocessed reference. */
  playReference(windowSec = 6, loop = false): PlayHandle {
    return this.play((ctx, dest) => {
      const passthrough = ctx.createGain()
      passthrough.gain.value = 1
      passthrough.connect(dest)
      return passthrough
    }, windowSec, loop)
  }

  /** Play through a peaking EQ at `freq` with `gainDB` (positive = boost). */
  playWithEQ(opts: EQOptions, windowSec = 6, loop = false): PlayHandle {
    return this.play((ctx, dest) => {
      const eq = ctx.createBiquadFilter()
      eq.type = opts.type ?? 'peaking'
      eq.frequency.value = opts.freq
      eq.Q.value = opts.q ?? DEFAULT_Q
      eq.gain.value = opts.gainDB
      eq.connect(dest)
      return eq
    }, windowSec, loop)
  }

  /** Play through dynamics compression. */
  playWithCompression(opts: CompressionOptions, windowSec = 6, loop = false): PlayHandle {
    return this.play((ctx, dest) => {
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = opts.threshold
      comp.ratio.value = opts.ratio
      comp.attack.value = opts.attack
      comp.release.value = opts.release
      const makeup = ctx.createGain()
      makeup.gain.value = Math.pow(10, opts.makeup / 20)
      comp.connect(makeup).connect(dest)
      return comp
    }, windowSec, loop)
  }

  /** Play through a synthesized reverb of `decaySec` length.
   *  IR is a noise burst with exponential decay — recognizable as plate-ish reverb,
   *  good enough for a "short vs long" drill without bundling IR files. */
  playWithReverb(opts: ReverbOptions, windowSec = 6, loop = false): PlayHandle {
    return this.play((ctx, dest) => {
      const dry = ctx.createGain()
      const wet = ctx.createGain()
      dry.gain.value = 1 - opts.mix
      wet.gain.value = opts.mix

      const convolver = ctx.createConvolver()
      convolver.buffer = this.makeReverbIR(ctx, opts.decaySec)

      const input = ctx.createGain()
      input.gain.value = 1
      input.connect(dry).connect(dest)
      input.connect(convolver).connect(wet).connect(dest)
      return input
    }, windowSec, loop)
  }

  /** Play through soft saturation (tanh waveshaper). */
  playWithDistortion(opts: DistortionOptions, windowSec = 6, loop = false): PlayHandle {
    return this.play((ctx, dest) => {
      const shaper = ctx.createWaveShaper()
      // Cast because TS 6 narrows Float32Array's underlying buffer type
      // (Float32Array<ArrayBufferLike> vs Float32Array<ArrayBuffer>).
      shaper.curve = this.makeDistortionCurve(opts.drive) as any
      shaper.oversample = '2x'
      // Drop level a touch so the saturation doesn't just sound louder
      const trim = ctx.createGain()
      trim.gain.value = 0.85
      shaper.connect(trim).connect(dest)
      return shaper
    }, windowSec, loop)
  }

  // ─── Procedural signal generators ──────────────────────────────────────────
  // All generators return a 2-channel buffer at the AudioContext sample rate.
  // Levels are normalised so each signal sits around -12 dBFS RMS — loud enough
  // to hear EQ changes without clipping after a +12 dB boost.

  /** White noise — uncorrelated random samples, equal energy per Hz.
   *  Sounds bright/harsh compared to pink because high frequencies are
   *  spectrally over-represented relative to how the ear weights them. */
  private generateWhiteNoise(ctx: AudioContext, durationSec: number): AudioBuffer {
    const rate = ctx.sampleRate
    const len = Math.floor(rate * durationSec)
    const buf = ctx.createBuffer(2, len, rate)
    // Per-channel uncorrelated noise for proper stereo image
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch)
      // Scale to roughly -12 dBFS RMS — match pink noise level for fair A/B
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.28
    }
    return buf
  }

  /** Pink noise — Voss-McCartney algorithm. Gold-standard frequency-ID source.
   *  Spectrally flat in 1/3-octave bands, so a band boost is unambiguous. */
  private generatePinkNoise(ctx: AudioContext, durationSec: number): AudioBuffer {
    const rate = ctx.sampleRate
    const len = Math.floor(rate * durationSec)
    const buf = ctx.createBuffer(2, len, rate)
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch)
      // Voss-McCartney: sum N random values where each updates at half the rate of the previous
      const rows = 16
      const counters = new Array(rows).fill(0)
      const values = new Array(rows).fill(0)
      let runningSum = 0
      let counter = 0
      for (let i = 0; i < len; i++) {
        counter++
        for (let r = 0; r < rows; r++) {
          if ((counter & ((1 << r) - 1)) === 0) {
            const old = values[r]
            values[r] = Math.random() * 2 - 1
            runningSum += values[r] - old
            counters[r] = counter
          }
        }
        data[i] = runningSum / rows * 0.32  // scale to ~-12 dBFS
      }
    }
    return buf
  }

  /** Synthesised drum loop — kick + snare + hat at 120 BPM (8th notes).
   *  Each hit is a short envelope-modulated synth, no samples needed. */
  private generateDrumLoop(ctx: AudioContext, durationSec: number): AudioBuffer {
    const rate = ctx.sampleRate
    const len = Math.floor(rate * durationSec)
    const buf = ctx.createBuffer(2, len, rate)
    const beatSamples = Math.floor(rate * 0.5)  // 120 BPM = 0.5s per beat
    const data = [buf.getChannelData(0), buf.getChannelData(1)]
    // Kick on 1, 3 / Snare on 2, 4 / Hat on every 8th
    for (let beat = 0; beat < Math.floor(durationSec / 0.5); beat++) {
      const beatStart = beat * beatSamples
      if (beat % 4 === 0 || beat % 4 === 2) this.synthKick(data, beatStart, rate, len)
      if (beat % 4 === 1 || beat % 4 === 3) this.synthSnare(data, beatStart, rate, len)
      // Hat every 8th note
      this.synthHat(data, beatStart, rate, len)
      this.synthHat(data, beatStart + Math.floor(beatSamples / 2), rate, len)
    }
    return buf
  }

  /** Vocal-shaped noise — pink noise summed through three BANDPASS filters at vowel-'aa'
   *  formant frequencies (F1/F2/F3). Using bandpass rather than peaking EQ concentrates
   *  the noise energy AT each formant band instead of boosting a narrow sliver above a
   *  full-spectrum noise floor — that's what makes it sound vocal rather than just noise. */
  private generateVocalNoise(ctx: AudioContext, durationSec: number): AudioBuffer {
    const rate = ctx.sampleRate
    const len  = Math.floor(rate * durationSec)
    const buf  = ctx.createBuffer(2, len, rate)

    // Vowel 'ah' formants: F1 ≈ 700 Hz, F2 ≈ 1200 Hz, F3 ≈ 2500 Hz
    // Q=3 → bandwidth ≈ 230/400/830 Hz — perceptually wide enough to be recognisable
    const formants = [
      { freq: 700,  q: 3.0, weight: 1.0 },  // F1 — main body / low-mid warmth
      { freq: 1200, q: 3.0, weight: 0.7 },  // F2 — vowel character / presence
      { freq: 2500, q: 3.5, weight: 0.35 }, // F3 — upper harmonic / brightness
    ]

    for (let ch = 0; ch < 2; ch++) {
      // Generate pink noise as the excitation source (Voss-McCartney)
      const pink = new Float32Array(len)
      const rows = 16; const pvals = new Array(rows).fill(0)
      let psum = 0; let pctr = 0
      for (let i = 0; i < len; i++) {
        pctr++
        for (let r = 0; r < rows; r++) {
          if ((pctr & ((1 << r) - 1)) === 0) {
            const old = pvals[r]; pvals[r] = Math.random() * 2 - 1; psum += pvals[r] - old
          }
        }
        pink[i] = psum / rows
      }

      const out = buf.getChannelData(ch)
      out.fill(0)

      // Pass pink noise through each bandpass filter and sum the outputs
      for (const f of formants) {
        // RBJ bandpass (constant 0 dB peak gain): b0=α, b1=0, b2=-α, a0=1+α, a1=-2cosω, a2=1-α
        const w0    = 2 * Math.PI * f.freq / rate
        const alpha = Math.sin(w0) / (2 * f.q)
        const b0    =  alpha
        const b2    = -alpha
        const a0    = 1 + alpha
        const a1    = -2 * Math.cos(w0)
        const a2    = 1 - alpha
        const ib0 = b0 / a0, ib2 = b2 / a0, ia1 = a1 / a0, ia2 = a2 / a0
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0
        for (let i = 0; i < len; i++) {
          const x = pink[i]
          const y = ib0 * x + ib2 * x2 - ia1 * y1 - ia2 * y2
          x2 = x1; x1 = x; y2 = y1; y1 = y
          out[i] += y * f.weight
        }
      }

      // RMS-normalise to ~−12 dBFS so it sits level with other procedural clips
      let rms = 0
      for (let i = 0; i < len; i++) rms += out[i] * out[i]
      rms = Math.sqrt(rms / len)
      const scale = rms > 0 ? 0.25 / rms : 1   // 0.25 linear ≈ −12 dBFS
      for (let i = 0; i < len; i++) out[i] *= scale
    }

    return buf
  }

  /** Synthetic full-mix simulation — bass arpeggio + drum loop + pad.
   *  Mimics the spectral density of a real mix so EQ training applies to real-world material. */
  private generateFullMix(ctx: AudioContext, durationSec: number): AudioBuffer {
    const rate = ctx.sampleRate
    const len = Math.floor(rate * durationSec)
    const drums = this.generateDrumLoop(ctx, durationSec)
    const out = ctx.createBuffer(2, len, rate)
    const drumData = [drums.getChannelData(0), drums.getChannelData(1)]
    const outData = [out.getChannelData(0), out.getChannelData(1)]
    // Bass — saw at 55, 73, 82 Hz (A1, D2, E2) every half beat, lowpassed
    const bassNotes = [55, 73, 82, 73]
    const beatSamples = Math.floor(rate * 0.5)
    for (let beat = 0; beat < Math.floor(durationSec / 0.5); beat++) {
      const note = bassNotes[beat % 4]
      const start = beat * beatSamples
      const end = Math.min(start + beatSamples, len)
      for (let i = start; i < end; i++) {
        const t = (i - start) / rate
        // Saw wave + simple decay envelope
        const phase = (t * note) % 1
        const saw = (phase * 2 - 1) * 0.25
        const env = Math.exp(-t * 3)
        const v = saw * env
        outData[0][i] += v
        outData[1][i] += v
      }
    }
    // Pad — soft chord using 3 sine partials with slow LFO
    const padFreqs = [220, 277, 330]  // A3 / C#4 / E4 — A major
    for (let i = 0; i < len; i++) {
      const t = i / rate
      let pad = 0
      for (const f of padFreqs) {
        pad += Math.sin(2 * Math.PI * f * t) / padFreqs.length
      }
      const lfo = 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.3 * t)
      pad *= 0.08 * lfo
      outData[0][i] += pad
      outData[1][i] += pad
    }
    // Drums on top
    for (let i = 0; i < len; i++) {
      outData[0][i] += drumData[0][i] * 0.7
      outData[1][i] += drumData[1][i] * 0.7
    }
    // Lowpass the result a bit to soften aliasing
    return this.applyOverallTilt(out, rate)
  }

  /** Apply gentle high-shelf cut to soften the procedural full-mix top end. */
  private applyOverallTilt(buf: AudioBuffer, rate: number): AudioBuffer {
    const w0 = 2 * Math.PI * 10000 / rate
    const alpha = Math.sin(w0) / 2
    const cos_w0 = Math.cos(w0)
    const A = Math.pow(10, -3 / 40)  // -3 dB shelf
    const b0 = A * ((A + 1) + (A - 1) * cos_w0 + 2 * Math.sqrt(A) * alpha)
    const b1 = -2 * A * ((A - 1) + (A + 1) * cos_w0)
    const b2 = A * ((A + 1) + (A - 1) * cos_w0 - 2 * Math.sqrt(A) * alpha)
    const a0 = (A + 1) - (A - 1) * cos_w0 + 2 * Math.sqrt(A) * alpha
    const a1 = 2 * ((A - 1) - (A + 1) * cos_w0)
    const a2 = (A + 1) - (A - 1) * cos_w0 - 2 * Math.sqrt(A) * alpha
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const data = buf.getChannelData(ch)
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0
      for (let i = 0; i < data.length; i++) {
        const x = data[i]
        const y = (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2
        x2 = x1; x1 = x; y2 = y1; y1 = y
        data[i] = y
      }
    }
    return buf
  }

  /** Synthesised kick — sine sweep 80→40 Hz with exponential decay. */
  private synthKick(data: Float32Array[], start: number, rate: number, len: number) {
    const dur = Math.floor(rate * 0.15)
    for (let i = 0; i < dur && start + i < len; i++) {
      const t = i / rate
      const freq = 80 * Math.exp(-t * 25)  // 80 → ~7 Hz across 150ms
      const env = Math.exp(-t * 18)
      const v = Math.sin(2 * Math.PI * freq * t) * env * 0.85
      data[0][start + i] += v
      data[1][start + i] += v
    }
  }

  /** Synthesised snare — bandpass noise burst centred at 200 Hz. */
  private synthSnare(data: Float32Array[], start: number, rate: number, len: number) {
    const dur = Math.floor(rate * 0.12)
    // Quick noise + tone hybrid
    let prev = 0  // simple lowpass state
    for (let i = 0; i < dur && start + i < len; i++) {
      const t = i / rate
      const env = Math.exp(-t * 22)
      const noise = (Math.random() * 2 - 1)
      prev = prev * 0.6 + noise * 0.4
      const tone = Math.sin(2 * Math.PI * 200 * t) * 0.3
      const v = (prev * 0.7 + tone) * env * 0.45
      data[0][start + i] += v
      data[1][start + i] += v
    }
  }

  /** Synthesised hi-hat — short HP noise burst. */
  private synthHat(data: Float32Array[], start: number, rate: number, len: number) {
    const dur = Math.floor(rate * 0.05)
    // Highpassed noise — approximated by differencing the white noise
    let prev = 0
    for (let i = 0; i < dur && start + i < len; i++) {
      const t = i / rate
      const env = Math.exp(-t * 50)
      const w = (Math.random() * 2 - 1)
      const hp = w - prev
      prev = w
      const v = hp * env * 0.22
      data[0][start + i] += v
      data[1][start + i] += v
    }
  }

  /** Generate a noise-burst impulse response of `decaySec` length. */
  private makeReverbIR(ctx: AudioContext, decaySec: number): AudioBuffer {
    const rate = ctx.sampleRate
    const len = Math.max(1, Math.floor(rate * decaySec))
    const ir = ctx.createBuffer(2, len, rate)
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch)
      for (let i = 0; i < len; i++) {
        // exponential decay × white noise
        const t = i / len
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2)
      }
    }
    return ir
  }

  /** tanh-shaped saturation curve.
   *  drive 0 → linear; drive 1 → heavy compression of the waveform. */
  private makeDistortionCurve(drive: number): Float32Array {
    const k = 1 + drive * 30  // 1..31 — covers subtle through aggressive
    const samples = 1024
    const curve = new Float32Array(samples)
    for (let i = 0; i < samples; i++) {
      const x = (i / samples) * 2 - 1
      curve[i] = Math.tanh(k * x) / Math.tanh(k)
    }
    return curve
  }

  /** Clean up the AudioContext (call on panel unmount). */
  dispose() {
    this.stop()  // also resolves any pending loop done promise
    if (this.ctx) {
      try { this.ctx.close() } catch {}
      this.ctx = null
    }
    this.masterBuffer = null
    this.masterSourceName = null
    this.resolveCurrentDone = null
  }
}

// Singleton — one engine per app session.
// Version stamp: bump this string whenever the procedural generators change so
// the singleton is rebuilt (and stale cached buffers are discarded) on next load.
const ENGINE_VERSION = 'v3-bandpass-formants'
let _engine: EarTrainingAudioEngine | null = null
let _engineVersion = ''

export function getEarTrainingEngine(): EarTrainingAudioEngine {
  if (!_engine || _engineVersion !== ENGINE_VERSION) {
    if (_engine) _engine.dispose()
    _engine = new EarTrainingAudioEngine()
    _engineVersion = ENGINE_VERSION
  }
  return _engine
}

/** Convenience helper: pick a random element from an array. */
export function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}
