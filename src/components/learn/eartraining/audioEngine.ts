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

class EarTrainingAudioEngine {
  private ctx: AudioContext | null = null
  private masterBuffer: AudioBuffer | null = null
  private masterSourceName: string | null = null
  private currentSource: AudioBufferSourceNode | null = null

  /** Lazily create the AudioContext on first use (avoids autoplay-policy errors). */
  private getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    return this.ctx
  }

  /** Load an audio file (via file:// path) into an AudioBuffer for drill use.
   *  Returns the duration in seconds. */
  async loadSource(filePath: string, displayName?: string): Promise<number> {
    if (this.masterSourceName === filePath && this.masterBuffer) {
      return this.masterBuffer.duration
    }
    const ctx = this.getContext()
    const url = filePath.startsWith('file://')
      ? filePath
      : `file://${filePath.replace(/\\/g, '/')}`
    const res = await fetch(url)
    const arr = await res.arrayBuffer()
    this.masterBuffer = await ctx.decodeAudioData(arr)
    this.masterSourceName = displayName ?? filePath
    return this.masterBuffer.duration
  }

  hasSource(): boolean {
    return this.masterBuffer !== null
  }

  sourceName(): string | null {
    return this.masterSourceName
  }

  /** Stop any currently-playing source. Safe to call at any time. */
  stop() {
    if (this.currentSource) {
      try { this.currentSource.stop() } catch {}
      try { this.currentSource.disconnect() } catch {}
      this.currentSource = null
    }
  }

  /** Pick a random short window of the source buffer to play.
   *  Avoids the first/last 0.5s (often silence/fade) and clamps to maxSec. */
  private pickWindow(maxSec = 8): { offset: number; duration: number } {
    if (!this.masterBuffer) return { offset: 0, duration: 0 }
    const total = this.masterBuffer.duration
    if (total < 2) return { offset: 0, duration: total }
    const usableStart = 0.5
    const usableEnd = Math.max(usableStart + 1, total - 0.5)
    const winLen = Math.min(maxSec, usableEnd - usableStart)
    const offset = usableStart + Math.random() * (usableEnd - usableStart - winLen)
    return { offset, duration: winLen }
  }

  /** Play the source through a graph built by `chainBuilder`.
   *  Returns a PlayHandle whose `done` promise resolves on natural end or stop. */
  private play(
    chainBuilder: (ctx: AudioContext, destination: AudioNode) => AudioNode,
    windowSec = 6
  ): PlayHandle {
    this.stop()
    if (!this.masterBuffer) {
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
    src.buffer = this.masterBuffer
    src.connect(sourceInput)
    this.currentSource = src

    const win = this.pickWindow(windowSec)
    src.start(0, win.offset, win.duration)

    const done = new Promise<void>(resolve => {
      src.onended = () => {
        this.currentSource = null
        resolve()
      }
    })
    return {
      stop: () => this.stop(),
      done,
    }
  }

  /** Play unprocessed reference. */
  playReference(windowSec = 6): PlayHandle {
    return this.play((ctx, dest) => {
      const passthrough = ctx.createGain()
      passthrough.gain.value = 1
      passthrough.connect(dest)
      return passthrough
    }, windowSec)
  }

  /** Play through a peaking EQ at `freq` with `gainDB` (positive = boost). */
  playWithEQ(opts: EQOptions, windowSec = 6): PlayHandle {
    return this.play((ctx, dest) => {
      const eq = ctx.createBiquadFilter()
      eq.type = opts.type ?? 'peaking'
      eq.frequency.value = opts.freq
      eq.Q.value = opts.q ?? DEFAULT_Q
      eq.gain.value = opts.gainDB
      eq.connect(dest)
      return eq
    }, windowSec)
  }

  /** Play through dynamics compression. */
  playWithCompression(opts: CompressionOptions, windowSec = 6): PlayHandle {
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
    }, windowSec)
  }

  /** Play through a synthesized reverb of `decaySec` length.
   *  IR is a noise burst with exponential decay — recognizable as plate-ish reverb,
   *  good enough for a "short vs long" drill without bundling IR files. */
  playWithReverb(opts: ReverbOptions, windowSec = 6): PlayHandle {
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
    }, windowSec)
  }

  /** Play through soft saturation (tanh waveshaper). */
  playWithDistortion(opts: DistortionOptions, windowSec = 6): PlayHandle {
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
    }, windowSec)
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
    this.stop()
    if (this.ctx) {
      try { this.ctx.close() } catch {}
      this.ctx = null
    }
    this.masterBuffer = null
    this.masterSourceName = null
  }
}

// Singleton — one engine for the whole app session.
let _engine: EarTrainingAudioEngine | null = null

export function getEarTrainingEngine(): EarTrainingAudioEngine {
  if (!_engine) _engine = new EarTrainingAudioEngine()
  return _engine
}

/** Convenience helper: pick a random element from an array. */
export function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}
