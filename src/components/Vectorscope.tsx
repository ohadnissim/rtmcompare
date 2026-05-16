import React, { useEffect, useRef, useMemo } from 'react'

interface Props {
 pointsA: { l: number; r: number }[]
 pointsB: { l: number; r: number }[]
 labelA: string
 labelB: string
}

const SIZE = 200

function toScreenPoints(points: { l: number; r: number }[], maxPts = 2000) {
 const step = Math.max(1, Math.floor(points.length / maxPts))
 const half = SIZE / 2
 const k = 0.5
 const pts: { x: number; y: number }[] = []
 for (let i = 0; i < points.length; i += step) {
  const { l, r } = points[i]
  pts.push({
   x: Math.max(0, Math.min(SIZE, half + (r - l) * half * k)),
   y: Math.max(0, Math.min(SIZE, half - (l + r) * half * k)),
  })
 }
 return pts
}

interface ScopeLabels {
 top: string; bottom: string; left: string; right: string
 diagLeft?: string; diagRight?: string
}

function drawScope(
 canvas: HTMLCanvasElement,
 points: { x: number; y: number }[],
 color: string,
 labels: ScopeLabels,
) {
 const ctx = canvas.getContext('2d')
 if (!ctx) return
 const w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2

 ctx.clearRect(0, 0, w, h)

 // Crosshair
 ctx.strokeStyle = 'rgba(76,77,82,0.3)'
 ctx.lineWidth = 0.5
 ctx.beginPath()
 ctx.moveTo(cx, 0); ctx.lineTo(cx, h)
 ctx.moveTo(0, cy); ctx.lineTo(w, cy)
 ctx.stroke()

 // Diagonal guides
 ctx.strokeStyle = 'rgba(76,77,82,0.2)'
 ctx.lineWidth = 0.3
 ctx.beginPath()
 ctx.moveTo(0, h); ctx.lineTo(w, 0)
 ctx.moveTo(0, 0); ctx.lineTo(w, h)
 ctx.stroke()

 // Axis labels
 ctx.font = '7px system-ui, sans-serif'
 ctx.fillStyle = '#696a71'
 ctx.textAlign = 'center'
 ctx.fillText(labels.top, cx, 8)
 ctx.fillText(labels.bottom, cx, h - 3)
 ctx.textAlign = 'left'
 ctx.fillText(labels.left, 4, cy - 2)
 ctx.textAlign = 'right'
 ctx.fillText(labels.right, w - 4, cy - 2)
 if (labels.diagLeft) {
  ctx.fillStyle = 'rgba(130,130,130,0.6)'
  ctx.textAlign = 'center'
  ctx.fillText(labels.diagLeft, w * 0.18, h * 0.18)
  ctx.fillText(labels.diagRight ?? '', w * 0.82, h * 0.18)
 }

 if (points.length === 0) return

 // Phosphor glow — batch all arcs into one path per pass for speed
 ctx.save()
 ctx.filter = 'blur(1.8px)'
 ctx.globalAlpha = 0.4
 ctx.fillStyle = color
 ctx.beginPath()
 for (const { x, y } of points) {
  ctx.moveTo(x + 1.6, y)
  ctx.arc(x, y, 1.6, 0, Math.PI * 2)
 }
 ctx.fill()
 ctx.restore()

 // Crisp detail layer
 ctx.globalAlpha = 0.22
 ctx.fillStyle = color
 ctx.beginPath()
 for (const { x, y } of points) {
  ctx.moveTo(x + 0.7, y)
  ctx.arc(x, y, 0.7, 0, Math.PI * 2)
 }
 ctx.fill()
 ctx.globalAlpha = 1
}

function ScopeCanvas({
 points, cssColor, labels,
}: {
 points: { x: number; y: number }[]
 cssColor: string
 labels: ScopeLabels
}) {
 const ref = useRef<HTMLCanvasElement>(null)

 useEffect(() => {
  const canvas = ref.current
  if (!canvas) return
  // Resolve CSS custom properties — canvas fillStyle doesn't evaluate var()
  const color = cssColor.startsWith('var(')
   ? (getComputedStyle(document.documentElement)
    .getPropertyValue(cssColor.slice(4, -1).trim()).trim() || '#c8a96e')
   : cssColor
  drawScope(canvas, points, color, labels)
 }, [points, cssColor, labels])

 return (
  <canvas
   ref={ref}
   width={SIZE}
   height={SIZE}
   style={{ width: '100%', maxWidth: SIZE, aspectRatio: '1', display: 'block' }}
  />
 )
}

export default function Vectorscope({ pointsA, pointsB, labelA, labelB }: Props) {
 const ptsA = useMemo(() => toScreenPoints(pointsA), [pointsA])
 const ptsB = useMemo(() => toScreenPoints(pointsB), [pointsB])

 // Stable label objects — avoids re-triggering drawScope on every parent render
 const labelsA = useMemo<ScopeLabels>(
  () => ({ top: 'M', bottom: 'M', left: 'S', right: 'S', diagLeft: 'L', diagRight: 'R' }),
  [],
 )
 const labelsB = useMemo<ScopeLabels>(
  () => ({ top: 'M', bottom: 'S', left: 'L', right: 'R' }),
  [],
 )

 return (
  <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-4" style={{ borderRadius: '2px' }}>
   <div className="space-y-1">
    <h2 className="text-lg">Stereo Vectorscope</h2>
    <p className="text-xs text-dark-400">Lissajous display — compare stereo image shape and width</p>
   </div>

   <div className="grid grid-cols-2 gap-4">
    <div className="space-y-2">
     <span className="text-xs text-dark-400">{labelA}</span>
     <div className="bg-dark-800 p-2 flex items-center justify-center" style={{ borderRadius: '2px' }}>
      <ScopeCanvas points={ptsA} cssColor="var(--color-sand-500)" labels={labelsA} />
     </div>
    </div>
    <div className="space-y-2">
     <span className="text-xs text-amber-400">{labelB}</span>
     <div className="bg-dark-800 p-2 flex items-center justify-center" style={{ borderRadius: '2px' }}>
      <ScopeCanvas points={ptsB} cssColor="var(--color-warm-amber)" labels={labelsB} />
     </div>
    </div>
   </div>

   <div className="text-[10px] text-dark-500">
    Vertical axis = mid (mono). Horizontal axis = side. L sits upper-left, R upper-right.
    A vertical line through centre = mono-compatible. Cloud spreading horizontally = wide stereo.
    A line on the HORIZONTAL axis = anti-phase (will cancel on phones / clubs).
   </div>
  </div>
 )
}
