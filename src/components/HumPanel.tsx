import React from 'react'
import { useToast } from '../hooks/useToast'

interface Hum {
 mains: number
 harmonics: { freq: number; prominence_db: number; coverage: number }[]
 notch_preset: { freq: number; q: number; gain_db: number }[]
 severity: 'none' | 'subtle' | 'audible'
 summary: string
}

export default function HumPanel({ hum }: { hum: Hum }) {
 const { message: toast, show: showToast } = useToast()
 if (!hum) return null

 const SEVERITY_COLOR: Record<string, string> = {
 none: '#6fa37e',
 subtle: '#d0b066',
 audible: '#c96765',
 }
 const color = SEVERITY_COLOR[hum.severity] || '#6fa37e'

 const copyPreset = async () => {
 if (!hum.notch_preset.length) return
 const text = hum.notch_preset.map(n =>
 `${n.freq.toFixed(1)} Hz Q=${n.q.toFixed(1)} ${n.gain_db.toFixed(1)} dB`
 ).join('\n')
 try {
 if ((window as any).electronAPI?.copyToClipboard) {
 await (window as any).electronAPI.copyToClipboard(text)
 } else {
 await navigator.clipboard.writeText(text)
 }
 showToast('Copied')
 } catch {
 showToast('Copy failed')
 }
 }

 return (
 <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-4" style={{ borderRadius: '2px' }}>
 <div className="flex items-center justify-between">
 <div className="space-y-1">
 <h2 className="text-lg font-semibold">Hum / Buzz Check</h2>
 <p className="text-xs text-dark-400">
 Scans for 50/60 Hz AC mains hum and its harmonics. Common issue on guitar / vocal recordings, ground loops, poor grounding.
 </p>
 </div>
 <span className="text-[10px] px-2.5 py-1 rounded-full font-medium"
 style={{ color, backgroundColor: `${color}14`, border: `1px solid ${color}40` }}>
 {hum.severity === 'none' ? '✓ Clean' : hum.severity === 'subtle' ? '⚠ Subtle' : '✕ Audible'}
 </span>
 </div>

 <p className="text-xs text-dark-300">{hum.summary}</p>

 {hum.harmonics.length > 0 && (
 <div className="p-3 space-y-2" style={{ borderRadius: '2px', backgroundColor: 'rgba(26,25,24,0.5)' }}>
 <div className="flex items-center justify-between text-[10px] text-dark-500 px-2 pb-1 border-b border-dark-700/30">
 <span className="flex-1">Frequency ({hum.mains} Hz mains + harmonics)</span>
 <span className="w-24 text-right">Prominence</span>
 <span className="w-20 text-right">Present</span>
 </div>
 {hum.harmonics.map((h, i) => (
 <div key={i} className="flex items-center text-[11px] px-2 py-1">
 <span className="flex-1 font-mono text-dark-200">{h.freq.toFixed(1)} Hz</span>
 <span className="w-24 text-right font-mono" style={{ color }}>+{h.prominence_db.toFixed(1)} dB</span>
 <span className="w-20 text-right font-mono text-dark-400">{Math.round(h.coverage * 100)}%</span>
 </div>
 ))}
 </div>
 )}

 {hum.notch_preset.length > 0 && (
 <div className="space-y-1.5">
 <div className="flex items-center justify-between">
 <span className="text-[10px] uppercase tracking-[0.12em]" style={{ color }}>
 Suggested notch preset
 </span>
 <div className="flex items-center gap-2">
 {toast && (
 <span
 role="status"
 aria-live="polite"
 className="text-[9px] font-mono uppercase tracking-[0.14em] px-1.5 py-0.5 rounded"
 style={{ backgroundColor: 'rgba(208,176,102,0.15)', color: '#d0b066' }}
 >
 {toast}
 </span>
 )}
 <button
 onClick={copyPreset}
 className="text-[10px] px-2 py-1 transition-colors" style={{ borderRadius: '2px' }}
 style={{ color: '#d0b066', border: '1px solid rgba(208,176,102,0.35)' }}
 >
 Copy preset
 </button>
 </div>
 </div>
 <div className="p-3 font-mono text-[11px] space-y-0.5" style={{ borderRadius: '2px', backgroundColor: 'rgba(26,25,24,0.6)' }}>
 {hum.notch_preset.map((n, i) => (
 <div key={i} className="flex gap-4">
 <span className="text-dark-300">{n.freq.toFixed(1)} Hz</span>
 <span className="text-dark-500">Q = {n.q.toFixed(1)}</span>
 <span style={{ color: '#c96765' }}>{n.gain_db.toFixed(1)} dB</span>
 </div>
 ))}
 </div>
 <p className="text-[9px] text-dark-500 italic">
 Paste into Pro-Q, Pro-MB, or any parametric EQ. High-Q bells at these frequencies remove the hum while leaving musical content unaffected.
 </p>
 </div>
 )}
 </div>
 )
}
