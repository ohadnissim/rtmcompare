import React, { useRef, useEffect } from 'react'

// 31 ISO-266 abbreviated band labels
const FREQ_LABELS = [
  '20', '25', '31', '40', '50', '63', '80', '100', '125', '160', '200',
  '250', '315', '400', '500', '630', '800', '1k', '1.25k', '1.6k', '2k',
  '2.5k', '3.15k', '4k', '5k', '6.3k', '8k', '10k', '12.5k', '16k', '20k',
]

const ROLE_COLORS: Record<string, string> = {
  'Mastering Engineer': '#7B4FFF',
  'Mixing Engineer': '#00E5FF',
  'Tracking Engineer': '#FFB830',
}
const DEFAULT_COLOR = '#7B4FFF'

export interface ProfileRadarProps {
  curve: number[]         // 31 dB values
  curveMad?: number[]     // 31 MAD values (optional)
  role: string
  sampleCount: number
  width?: number
  height?: number
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

export default function ProfileRadar({
  curve,
  curveMad,
  role,
  sampleCount,
  width = 380,
  height = 380,
}: ProfileRadarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const color = ROLE_COLORS[role] ?? DEFAULT_COLOR
  const [r, g, b] = hexToRgb(color)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    const cx = width / 2
    const cy = height / 2
    const maxR = Math.min(cx, cy) * 0.78

    // Background
    ctx.fillStyle = '#0D0D0F'
    ctx.fillRect(0, 0, width, height)

    const n = curve.length  // 31

    // Convert band index to canvas coords
    // dB: 0 dB → 60% of maxR; ±15 dB → ±40% of maxR
    // radius = maxR * (0.60 + (db / 15) * 0.40)  clamped [0.05*maxR, maxR]
    const dbToRadius = (db: number) => {
      const r_ = maxR * (0.60 + (db / 15) * 0.40)
      return Math.max(0.05 * maxR, Math.min(maxR, r_))
    }

    const getPoint = (i: number, db: number): [number, number] => {
      const angle = (i / n) * 2 * Math.PI - Math.PI / 2
      const rad = dbToRadius(db)
      return [cx + rad * Math.cos(angle), cy + rad * Math.sin(angle)]
    }

    // ── Grid rings ──────────────────────────────────────────────────
    const ringDbs = [-10, 0, 10]
    ctx.save()
    ringDbs.forEach((db, idx) => {
      const ringR = dbToRadius(db)
      ctx.beginPath()
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2)
      ctx.strokeStyle = idx === 1
        ? 'rgba(255,255,255,0.18)'  // 0 dB ring is more visible
        : 'rgba(255,255,255,0.07)'
      ctx.lineWidth = idx === 1 ? 1.2 : 0.8
      ctx.stroke()
    })
    ctx.restore()

    // ── Axis lines (center → rim) ────────────────────────────────
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'
    ctx.lineWidth = 0.5
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * 2 * Math.PI - Math.PI / 2
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + maxR * Math.cos(angle), cy + maxR * Math.sin(angle))
      ctx.stroke()
    }
    ctx.restore()

    // ── MAD shading band ────────────────────────────────────────
    if (curveMad && curveMad.length === n) {
      // Upper band (+MAD)
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const [x, y] = getPoint(i, curve[i] + curveMad[i])
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fillStyle = `rgba(${r},${g},${b},0.15)`
      ctx.fill()

      // Lower band (-MAD) — drawn as a second filled polygon to create
      // the band effect
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const [x, y] = getPoint(i, curve[i] - curveMad[i])
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fillStyle = '#0D0D0F'  // cut out center
      ctx.fill()
    }

    // ── Main curve polygon ───────────────────────────────────────
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const [x, y] = getPoint(i, curve[i])
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.stroke()

    // Subtle fill inside the curve
    ctx.fillStyle = `rgba(${r},${g},${b},0.06)`
    ctx.fill()

    // ── Frequency labels at key positions ───────────────────────
    // Show labels at cardinal + selected positions: 20Hz, 1kHz, 20kHz
    // and a few others spread around
    const labelIndices = [0, 7, 17, 30]  // 20Hz, 100Hz, 2kHz, 20kHz
    ctx.save()
    ctx.font = '10px "JetBrains Mono", monospace'
    ctx.fillStyle = 'rgba(255,255,255,0.45)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    labelIndices.forEach(i => {
      const angle = (i / n) * 2 * Math.PI - Math.PI / 2
      const labelR = maxR + 16
      const lx = cx + labelR * Math.cos(angle)
      const ly = cy + labelR * Math.sin(angle)
      ctx.fillText(FREQ_LABELS[i], lx, ly)
    })
    ctx.restore()

    // ── dB ring labels (0 dB) ────────────────────────────────────
    ctx.save()
    ctx.font = '9px "JetBrains Mono", monospace'
    ctx.fillStyle = 'rgba(255,255,255,0.25)'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const zeroR = dbToRadius(0)
    ctx.fillText('0 dB', cx + zeroR + 4, cy)
    ctx.restore()

    // ── N tracks counter ─────────────────────────────────────────
    ctx.save()
    ctx.font = '10px "JetBrains Mono", monospace'
    ctx.fillStyle = `rgba(${r},${g},${b},0.7)`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillText(`N = ${sampleCount} tracks`, width - 10, height - 10)
    ctx.restore()

  }, [curve, curveMad, role, sampleCount, width, height, color, r, g, b])

  return (
    <canvas
      ref={canvasRef}
      style={{
        width,
        height,
        display: 'block',
        borderRadius: 6,
      }}
      aria-label={`Frequency fingerprint radar for ${role}, ${sampleCount} tracks`}
    />
  )
}
