import React, { useEffect, useRef, useState } from 'react'
import { SpectrogramData, ClickArtifact } from '../types'

interface Props {
  spectrogramA: SpectrogramData
  spectrogramB: SpectrogramData
  labelA: string
  labelB: string
  durationSec: number
  /** Click artifacts to overlay as severity-coloured hairlines. */
  clicks?: ClickArtifact[]
}

type ViewMode = 'a' | 'b' | 'delta'

const CANVAS_H = 160
const Y_LABEL_FREQS = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
const Y_LABEL_TEXT: Record<number, string> = {
  50: '50', 100: '100', 200: '200', 500: '500',
  1000: '1k', 2000: '2k', 5000: '5k', 10000: '10k', 20000: '20k',
}

// Inferno colormap — 256-entry LUT
const INFERNO_LUT = (() => {
  const stops: [number, [number, number, number]][] = [
    [0.00, [0,   0,   4]],
    [0.13, [22,  11,  57]],
    [0.25, [66,  10,  104]],
    [0.38, [106, 23,  110]],
    [0.50, [147, 38,  103]],
    [0.63, [188, 55,  84]],
    [0.75, [221, 81,  58]],
    [0.88, [243, 120, 25]],
    [1.00, [252, 255, 164]],
  ]
  const lut: Uint8Array = new Uint8Array(256 * 3)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let lo = stops[0], hi = stops[stops.length - 1]
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) { lo = stops[s]; hi = stops[s + 1]; break }
    }
    const span = hi[0] - lo[0]
    const frac = span < 1e-9 ? 0 : (t - lo[0]) / span
    lut[i * 3]     = Math.round(lo[1][0] + frac * (hi[1][0] - lo[1][0]))
    lut[i * 3 + 1] = Math.round(lo[1][1] + frac * (hi[1][1] - lo[1][1]))
    lut[i * 3 + 2] = Math.round(lo[1][2] + frac * (hi[1][2] - lo[1][2]))
  }
  return lut
})()

function deltaRGB(diff: number): [number, number, number] {
  const t = Math.max(-1, Math.min(1, diff / 20))
  if (t < 0) {
    const s = -t
    return [Math.round(20 + 20 * (1 - s)), Math.round(60 * (1 - s) + 30 * s), Math.round(50 + 180 * s)]
  }
  return [Math.round(50 + 190 * t), Math.round(80 * (1 - t)), Math.round(20 * (1 - t))]
}

function renderToCanvas(
  canvas: HTMLCanvasElement,
  dataA: number[][],
  dataB: number[][],
  mode: ViewMode,
  dbFloor: number,
  dbCeil: number,
) {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (w === 0 || h === 0) return
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const data = mode === 'b' ? dataB : dataA
  const n_mels = data.length
  const n_time = data[0]?.length ?? 0
  if (n_mels === 0 || n_time === 0) return

  const cw = canvas.width
  const ch = canvas.height
  const imgData = ctx.createImageData(cw, ch)
  const px = imgData.data
  const dbRange = dbCeil - dbFloor

  for (let py = 0; py < ch; py++) {
    const melBin = Math.max(0, Math.min(n_mels - 1, Math.floor((1 - py / ch) * n_mels)))
    for (let pxX = 0; pxX < cw; pxX++) {
      const tf = Math.max(0, Math.min(n_time - 1, Math.floor((pxX / cw) * n_time)))
      const off = (py * cw + pxX) * 4
      let r: number, g: number, b: number
      if (mode === 'delta') {
        const diff = (dataB[melBin]?.[tf] ?? dbFloor) - (dataA[melBin]?.[tf] ?? dbFloor)
        ;[r, g, b] = deltaRGB(diff)
      } else {
        const db = data[melBin]?.[tf] ?? dbFloor
        const lutI = Math.round(Math.max(0, Math.min(255, ((db - dbFloor) / dbRange) * 255)))
        r = INFERNO_LUT[lutI * 3]
        g = INFERNO_LUT[lutI * 3 + 1]
        b = INFERNO_LUT[lutI * 3 + 2]
      }
      px[off] = r; px[off + 1] = g; px[off + 2] = b; px[off + 3] = 255
    }
  }
  ctx.putImageData(imgData, 0, 0)
}

function yPosForFreq(hz: number, freqs: number[], canvasH: number): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < freqs.length; i++) {
    const d = Math.abs(freqs[i] - hz)
    if (d < bestDist) { bestDist = d; best = i }
  }
  return Math.round((1 - best / freqs.length) * canvasH)
}

function fmtHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${s.toFixed(2)}s`
}

const CLICK_COLORS: Record<ClickArtifact['severity'], string> = {
  high:   'rgba(244,63,94,0.90)',
  medium: 'rgba(245,158,11,0.80)',
  low:    'rgba(132,133,140,0.60)',
}

interface CursorInfo {
  x: number
  y: number
  freqHz: number
  timeSec: number
  db: number
}

export default function Spectrogram({ spectrogramA, spectrogramB, labelA, labelB, durationSec, clicks }: Props) {
  const [mode, setMode] = useState<ViewMode>('a')
  const [dbFloor, setDbFloor] = useState(-80)
  const [dbCeil, setDbCeil] = useState(0)
  const [cursor, setCursor] = useState<CursorInfo | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    renderToCanvas(canvas, spectrogramA.data, spectrogramB.data, mode, dbFloor, dbCeil)
  }, [spectrogramA, spectrogramB, mode, dbFloor, dbCeil])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => {
      renderToCanvas(canvas, spectrogramA.data, spectrogramB.data, mode, dbFloor, dbCeil)
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [spectrogramA, spectrogramB, mode, dbFloor, dbCeil])

  const freqs = spectrogramA.freqs
  const nMels = spectrogramA.data.length
  const nTime = spectrogramA.data[0]?.length ?? 1
  const axisW = 36

  const timeLabels = [0, 0.25, 0.5, 0.75, 1.0].map(t => {
    const sec = t * durationSec
    return { t, label: sec < 60 ? `${Math.round(sec)}s` : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}` }
  })

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const relY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    const timeSec = relX * durationSec
    const melBin = Math.max(0, Math.min(nMels - 1, Math.floor((1 - relY) * nMels)))
    const freqHz = freqs[melBin] ?? 0
    const tf = Math.max(0, Math.min(nTime - 1, Math.floor(relX * nTime)))
    let db: number
    if (mode === 'delta') {
      db = (spectrogramB.data[melBin]?.[tf] ?? dbFloor) - (spectrogramA.data[melBin]?.[tf] ?? dbFloor)
    } else {
      const data = mode === 'b' ? spectrogramB.data : spectrogramA.data
      db = data[melBin]?.[tf] ?? dbFloor
    }
    setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top, freqHz, timeSec, db })
  }

  // Only show click overlays in modes where B is visible
  const showClicks = (mode === 'b' || mode === 'delta') && clicks && clicks.length > 0

  const btnStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: 'var(--font-sans)',
    fontSize: 11,
    fontWeight: 500,
    padding: '2px 10px',
    borderRadius: 'var(--radius-pill)',
    border: 'none',
    cursor: 'pointer',
    backgroundColor: active ? 'var(--rtm-chip-bg-active)' : 'transparent',
    color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
    transition: 'color 120ms, background-color 120ms',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Mode toggle + brightness/contrast controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{
          display: 'inline-flex', gap: 2, padding: 2,
          borderRadius: 'var(--radius-pill)',
          backgroundColor: 'var(--rtm-chip-bg-inactive)',
        }}>
          <button style={btnStyle(mode === 'a')} onClick={() => setMode('a')}>{labelA}</button>
          <button style={btnStyle(mode === 'b')} onClick={() => setMode('b')}>{labelB}</button>
          <button style={btnStyle(mode === 'delta')} onClick={() => setMode('delta')}>Delta</button>
        </div>

        {/* Brightness/contrast sliders — hidden in delta mode (fixed colour scale) */}
        {mode !== 'delta' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
            <span>Floor</span>
            <input
              type="range" min={-120} max={-20} step={5} value={dbFloor}
              onChange={e => {
                const v = Number(e.target.value)
                setDbFloor(Math.min(v, dbCeil - 10))
              }}
              style={{ width: 80, accentColor: 'var(--color-accent)', cursor: 'pointer' }}
              title={`Noise floor: ${dbFloor} dB`}
            />
            <span style={{ width: 34 }}>{dbFloor} dB</span>
            <span>Ceil</span>
            <input
              type="range" min={-40} max={0} step={5} value={dbCeil}
              onChange={e => {
                const v = Number(e.target.value)
                setDbCeil(Math.max(v, dbFloor + 10))
              }}
              style={{ width: 80, accentColor: 'var(--color-accent)', cursor: 'pointer' }}
              title={`Ceiling: ${dbCeil} dB`}
            />
            <span style={{ width: 34 }}>{dbCeil} dB</span>
          </div>
        )}

        {mode === 'delta' && (
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'var(--font-sans)' }}>
            <span style={{ color: '#60a0f0' }}>■</span> A louder &nbsp;
            <span style={{ color: '#888' }}>■</span> equal &nbsp;
            <span style={{ color: '#f07020' }}>■</span> B louder
          </span>
        )}
      </div>

      {/* Canvas + Y axis */}
      <div style={{ display: 'flex', gap: 4 }}>
        {/* Y axis labels */}
        <div style={{ position: 'relative', width: axisW, height: CANVAS_H, flexShrink: 0 }}>
          {Y_LABEL_FREQS.map(hz => {
            const y = yPosForFreq(hz, freqs, CANVAS_H)
            if (y < 6 || y > CANVAS_H - 6) return null
            return (
              <span
                key={hz}
                style={{
                  position: 'absolute',
                  right: 4,
                  top: y - 7,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  color: 'var(--color-text-muted)',
                  lineHeight: 1,
                  userSelect: 'none',
                }}
              >
                {Y_LABEL_TEXT[hz]}
              </span>
            )
          })}
        </div>

        {/* Spectrogram canvas + overlays */}
        <div
          style={{ flex: 1, position: 'relative', height: CANVAS_H, cursor: 'crosshair' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setCursor(null)}
        >
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: CANVAS_H, display: 'block', borderRadius: 2 }}
          />

          {/* Click hairlines */}
          {showClicks && clicks!.map((click, i) => {
            const pct = Math.max(0, Math.min(100, (click.time / durationSec) * 100))
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${pct}%`,
                  width: 1,
                  backgroundColor: CLICK_COLORS[click.severity],
                  pointerEvents: 'none',
                  boxShadow: `0 0 3px ${CLICK_COLORS[click.severity]}`,
                }}
                title={`${click.severity} click · ${click.time_formatted} · ${click.energy_db.toFixed(1)} dB`}
              />
            )
          })}

          {/* Cursor readout tooltip */}
          {cursor && (
            <div
              style={{
                position: 'absolute',
                top: Math.max(0, cursor.y - 36),
                left: cursor.x > 120 ? cursor.x - 128 : cursor.x + 8,
                pointerEvents: 'none',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                lineHeight: '15px',
                color: 'rgba(232,228,220,0.92)',
                backgroundColor: 'rgba(10,9,8,0.88)',
                border: '1px solid rgba(168,161,150,0.22)',
                borderRadius: 3,
                padding: '3px 7px',
                whiteSpace: 'nowrap',
                zIndex: 20,
              }}
            >
              <div>{fmtHz(cursor.freqHz)}</div>
              <div>{fmtTime(cursor.timeSec)}</div>
              <div style={{ color: mode === 'delta' ? (cursor.db >= 0 ? '#f07020' : '#60a0f0') : 'rgba(208,176,102,0.85)' }}>
                {mode === 'delta' ? (cursor.db >= 0 ? '+' : '') : ''}{cursor.db.toFixed(1)} dB
              </div>
            </div>
          )}
        </div>
      </div>

      {/* X axis (time) */}
      <div style={{ display: 'flex', paddingLeft: axisW + 4 }}>
        {timeLabels.map(({ t, label }) => (
          <div
            key={t}
            style={{
              position: 'relative',
              flex: t === 1 ? 0 : 1,
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              color: 'var(--color-text-muted)',
              userSelect: 'none',
              textAlign: t === 1 ? 'right' : 'left',
            }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Footer: scale info + click legend */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontFamily: 'var(--font-sans)',
        fontSize: 9,
        color: 'var(--color-text-muted)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        paddingLeft: axisW + 4,
      }}>
        <span>Hz (mel scale) · dB range: {dbFloor} to {dbCeil}</span>
        {showClicks && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0 }}>
            {(['high', 'medium', 'low'] as const).filter(s => clicks!.some(c => c.severity === s)).map(s => (
              <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ display: 'inline-block', width: 1, height: 10, backgroundColor: CLICK_COLORS[s] }} />
                <span style={{ color: CLICK_COLORS[s], fontSize: 9 }}>{s}</span>
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  )
}
