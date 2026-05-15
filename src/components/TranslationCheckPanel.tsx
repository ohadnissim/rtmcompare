import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FileInfo } from '../types'

/**
 * Translation Check — auditions the master through a non-streaming
 * playback environment (phone speaker / earbuds / club PA / car cabin).
 * Sister panel to the Sound Check twin in StreamingPreview, but answers
 * a different question:
 *
 *   Sound Check twin   → "what does Spotify / Apple actually serve?"
 *   Translation Check  → "what does the MIX sound like through these speakers?"
 *
 * Each button kicks the `translation-render` IPC, caches the resulting
 * .m4a, and plays it via Web Audio. Click again to stop. A one-line
 * insight ("LF: −12 dB · Presence: +4 dB") shows next to the active
 * button so the engineer doesn't have to listen blind.
 */

interface Env {
  id: string
  label: string
  short: string
  hint: string
}

const ENVS: Env[] = [
  {
    id: 'phone_speaker',
    label: 'Phone speaker',
    short: 'Phone',
    hint: 'Modern phone driver — sub disappears below 250 Hz, presence range dominates.',
  },
  {
    id: 'earbuds',
    label: 'AirPods / earbuds',
    short: 'Earbuds',
    hint: 'Consumer earbuds — no real sub below 60 Hz, presence-shifted vocals.',
  },
  {
    id: 'club_pa',
    label: 'Club PA',
    short: 'Club PA',
    hint: 'House-system PA — sub bus summed mono below 100 Hz; stereo bass cancels.',
  },
  {
    id: 'car_cabin',
    label: 'Car cabin',
    short: 'Car',
    hint: 'Generic consumer car cabin — bass bump from cabin resonance, midrange suckout.',
  },
]

interface Insight {
  lostLfDb?: number
  presenceChangeDb?: number
}

interface Props {
  file: FileInfo
}

export default function TranslationCheckPanel({ file }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [errorById, setErrorById] = useState<Record<string, string>>({})
  const [insightById, setInsightById] = useState<Record<string, Insight>>({})

  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const bufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map())
  const startingRef = useRef<string | null>(null)

  const stop = useCallback(() => {
    startingRef.current = null
    try { sourceRef.current?.stop() } catch {}
    if (sourceRef.current) sourceRef.current.onended = null
    sourceRef.current = null
    try { ctxRef.current?.close() } catch {}
    ctxRef.current = null
    setActiveId(null)
    setLoadingId(null)
  }, [])

  // Tear down the AudioContext on unmount — without this, switching
  // tabs while audio's playing leaves a dangling context that keeps
  // outputting silence (and counts toward Chromium's 6-context cap).
  useEffect(() => () => { stop() }, [stop])

  const play = useCallback(async (envId: string) => {
    if (!window.electronAPI?.translationRender || !window.electronAPI.readAudioFile) {
      setErrorById(prev => ({ ...prev, [envId]: 'electron API not available' }))
      return
    }
    stop()
    setLoadingId(envId)
    setErrorById(prev => ({ ...prev, [envId]: '' }))
    startingRef.current = envId

    try {
      const cacheKey = `${file.path}|${envId}`
      let buffer = bufferCacheRef.current.get(cacheKey)
      if (!buffer) {
        const res = await window.electronAPI.translationRender(file.path, envId)
        if (startingRef.current !== envId) return
        if (!res.ok || !res.path) {
          const msg = res.error || 'render failed'
          console.error('[translation-check] render failed:', msg)
          setErrorById(prev => ({ ...prev, [envId]: msg }))
          setLoadingId(null)
          startingRef.current = null
          return
        }
        if (typeof res.lost_lf_db === 'number' || typeof res.presence_change_db === 'number') {
          setInsightById(prev => ({
            ...prev,
            [envId]: {
              lostLfDb: res.lost_lf_db,
              presenceChangeDb: res.presence_change_db,
            },
          }))
        }
        const ab = await window.electronAPI.readAudioFile(res.path)
        if (startingRef.current !== envId) return
        const probe = new (window.AudioContext || (window as any).webkitAudioContext)()
        buffer = await probe.decodeAudioData(ab)
        await probe.close()
        bufferCacheRef.current.set(cacheKey, buffer)
      }
      if (startingRef.current !== envId) return

      let ctx: AudioContext
      try { ctx = new AudioContext({ sampleRate: buffer.sampleRate, latencyHint: 'playback' }) }
      catch { ctx = new AudioContext({ latencyHint: 'playback' }) }
      ctxRef.current = ctx

      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      sourceRef.current = source
      source.start(0, 0, Math.min(30, buffer.duration))
      setLoadingId(null)
      setActiveId(envId)
      source.onended = () => {
        if (sourceRef.current === source) {
          setActiveId(null)
          try { ctx.close() } catch {}
          ctxRef.current = null
          sourceRef.current = null
        }
      }
    } catch (err: any) {
      const msg = err?.message || String(err) || 'play failed'
      console.error('[translation-check] play failed:', msg)
      setErrorById(prev => ({ ...prev, [envId]: msg }))
      setLoadingId(null)
      setActiveId(null)
      startingRef.current = null
      try { ctxRef.current?.close() } catch {}
      ctxRef.current = null
    }
  }, [file, stop])

  const onClickEnv = useCallback((envId: string) => {
    if (activeId === envId) stop()
    else play(envId)
  }, [activeId, stop, play])

  const fmtSigned = (v?: number) => (typeof v === 'number' && isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB` : '—')

  return (
    <div className="border p-3 space-y-3" style={{ borderRadius: '2px', borderColor: 'rgba(168,161,150,0.14)', backgroundColor: 'rgba(31,27,23,0.35)' }}>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.16em]" style={{ color: 'var(--color-accent)' }}>
          Translation check
        </span>
        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
          how the master sounds through real-world playback chains — click to audition the loudest 30 s
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {ENVS.map(env => {
          const isActive  = activeId === env.id
          const isLoading = loadingId === env.id
          const insight   = insightById[env.id]
          const error     = errorById[env.id]
          return (
            <div key={env.id} className="flex items-center gap-2">
              <button
                onClick={() => onClickEnv(env.id)}
                disabled={isLoading}
                className="text-[11px] px-3 py-1.5 rounded-full transition-colors"
                style={{
                  backgroundColor: isActive ? 'rgba(208,176,102,0.25)' : 'rgba(208,176,102,0.08)',
                  border: `1px solid ${isActive ? 'rgba(208,176,102,0.55)' : 'rgba(208,176,102,0.25)'}`,
                  color: isActive ? 'var(--color-text-primary)' : 'var(--color-accent)',
                  opacity: isLoading ? 0.6 : 1,
                  cursor: isLoading ? 'wait' : 'pointer',
                }}
                title={env.hint}
                aria-label={isActive ? `Stop ${env.label} translation` : `Audition ${env.label}`}
              >
                {isLoading ? '…' : isActive ? '■' : '▶'}{' '}{env.short}
              </button>
              {insight && (typeof insight.lostLfDb === 'number' || typeof insight.presenceChangeDb === 'number') && (
                <span className="text-[10px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
                  LF&nbsp;<span style={{ color: (insight.lostLfDb ?? 0) < -3 ? 'var(--color-danger)' : 'var(--color-sand-300)' }}>{fmtSigned(insight.lostLfDb)}</span>
                  {' · '}
                  Presence&nbsp;<span style={{ color: (insight.presenceChangeDb ?? 0) > 2 ? 'var(--color-danger)' : 'var(--color-sand-300)' }}>{fmtSigned(insight.presenceChangeDb)}</span>
                </span>
              )}
              {error && !isActive && !isLoading && (
                <span className="text-[10px]" style={{ color: 'var(--color-danger)' }} title={error}>
                  render ✕
                </span>
              )}
            </div>
          )
        })}
      </div>
      <p className="text-[10px] font-display italic leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
        Biquad-filter approximations (no IRs in v5.0.4). Useful as a translation gut-check, not a substitute for actually testing on the target system. IR-based versions for car cabins and club PAs are on the v5.x roadmap.
      </p>
    </div>
  )
}
