import React from 'react'
import { DownmixDelta as DownmixDeltaType, SurroundBalance, LfeAnalysis } from '../types'
import InfoTooltip from './InfoTooltip'

interface Props {
 delta: DownmixDeltaType
 surroundBalance: SurroundBalance
 lfe: LfeAnalysis
}

export default function DownmixDelta({ delta, surroundBalance, lfe }: Props) {
 const maxDiff = Math.max(3, ...delta.categories.map(c => Math.abs(c.diff_db)))

 return (
 <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-5" style={{ borderRadius: '2px' }}>
 {/* Downmix comparison */}
 <div className="space-y-4">
 <div className="space-y-1">
 <div className="flex items-center gap-2">
 <h2 className="text-lg font-semibold">Downmix Fidelity</h2>
 <InfoTooltip text="Compares the original stereo mix against the Atmos stereo downmix. Differences show what changes when the Atmos mix is folded to stereo." />
 </div>
 <p className="text-xs text-dark-400">{delta.insight}</p>
 </div>

 {/* Bar chart: per-band differences */}
 <div className="space-y-1.5">
 {delta.categories.map(cat => {
 const pct = (cat.diff_db / maxDiff) * 50 // 50% = full bar in one direction
 const isPositive = cat.diff_db > 0
 return (
 <div key={cat.name} className="flex items-center gap-3">
 <span className="text-[11px] text-dark-400 w-20 text-right">{cat.name}</span>
 <div className="flex-1 h-3.5 relative" style={{ backgroundColor: '#1a1918' }}>
 {/* Center line */}
 <div className="absolute left-1/2 top-0 bottom-0 w-px" style={{ backgroundColor: '#3a3835' }} />
 {/* Bar */}
 <div
 className="absolute top-0 bottom-0"
 style={{
 borderRadius: '2px',
 left: isPositive ? '50%' : `${50 + pct}%`,
 width: `${Math.abs(pct)}%`,
 backgroundColor: Math.abs(cat.diff_db) > 1.5 ? '#e07a4f' :
 Math.abs(cat.diff_db) > 0.5 ? '#f59e0b' : '#6b8cbb',
 opacity: 0.7,
 }}
 />
 </div>
 <span className={`text-[10px] font-mono w-14 text-right ${
 Math.abs(cat.diff_db) > 1.5 ? 'text-orange-400' :
 Math.abs(cat.diff_db) > 0.5 ? 'text-amber-400' : 'text-dark-400'
 }`}>
 {cat.diff_db > 0 ? '+' : ''}{cat.diff_db.toFixed(1)} dB
 </span>
 </div>
 )
 })}
 </div>

 <div className="flex items-center gap-2 text-xs">
 <span className="text-dark-500">Overall:</span>
 <span className={Math.abs(delta.overall_diff_db) > 1 ? 'text-orange-400' : 'text-dark-300'}>
 {delta.overall_diff_db > 0 ? '+' : ''}{delta.overall_diff_db.toFixed(1)} dB
 </span>
 </div>
 </div>

 {/* Surround balance & LFE */}
 <div className="grid grid-cols-2 gap-4 pt-3 border-t border-dark-700/30">
 {/* Surround balance */}
 <div className="space-y-2">
 <div className="flex items-center gap-2">
 <span className="text-xs font-medium text-dark-300">Surround Balance</span>
 <InfoTooltip text="Left/right symmetry of surround channels. Large imbalances may cause the mix to feel lopsided." />
 </div>
 <div className="space-y-1">
 <div className="flex items-center justify-between">
 <span className="text-[10px] text-dark-500">Ls / Rs</span>
 <span className={`text-[10px] font-mono ${surroundBalance.lr_diff_db > 2 ? 'text-orange-400' : 'text-dark-400'}`}>
 {surroundBalance.lr_diff_db.toFixed(1)} dB diff
 </span>
 </div>
 <div className="flex items-center justify-between">
 <span className="text-[10px] text-dark-500">Lrs / Rrs</span>
 <span className={`text-[10px] font-mono ${surroundBalance.rear_lr_diff_db > 2 ? 'text-orange-400' : 'text-dark-400'}`}>
 {surroundBalance.rear_lr_diff_db.toFixed(1)} dB diff
 </span>
 </div>
 <div className="mt-1">
 {surroundBalance.balanced ? (
 <span className="text-[10px] text-green-400">Balanced</span>
 ) : (
 <span className="text-[10px] text-orange-400">Imbalanced</span>
 )}
 </div>
 </div>
 </div>

 {/* LFE analysis */}
 <div className="space-y-2">
 <div className="flex items-center gap-2">
 <span className="text-xs font-medium text-dark-300">LFE Channel</span>
 <InfoTooltip text="Subwoofer channel analysis. Content above 120 Hz in the LFE may cause issues on some playback systems." />
 </div>
 <div className="space-y-1">
 <div className="flex items-center justify-between">
 <span className="text-[10px] text-dark-500">Level</span>
 <span className={`text-[10px] font-mono ${lfe.has_content ? 'text-dark-300' : 'text-dark-600'}`}>
 {lfe.has_content ? `${lfe.level_db.toFixed(1)} dB` : 'No content'}
 </span>
 </div>
 {lfe.high_freq_warning && (
 <div className="flex items-center gap-1 mt-1">
 <span className="text-[10px] text-orange-400">
 HF content detected ({lfe.high_freq_energy_db.toFixed(1)} dB above 120 Hz)
 </span>
 </div>
 )}
 {lfe.has_content && !lfe.high_freq_warning && (
 <span className="text-[10px] text-green-400">Clean LFE</span>
 )}
 </div>
 </div>
 </div>

 <div className="text-[10px] text-dark-500">
 Left of center = Atmos downmix is quieter than stereo original. Right = louder. Small differences (&lt;1 dB) are normal.
 </div>
 </div>
 )
}
