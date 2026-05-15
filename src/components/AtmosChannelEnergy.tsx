import React from 'react'
import { ChannelEnergy } from '../types'

interface Props {
 channels: ChannelEnergy[]
 layout: string
 objectCount?: number
 objectEnergyDb?: number | null
 hasAdm?: boolean
}

const GROUP_LABELS: Record<string, { label: string; color: string }> = {
 ear_level: { label: 'Ear Level', color: 'var(--color-data-a)' },
 height: { label: 'Height', color: 'var(--color-slate-blue)' },
 lfe: { label: 'LFE', color: 'var(--color-danger)' },
}

export default function AtmosChannelEnergy({ channels, layout, objectCount, objectEnergyDb, hasAdm }: Props) {
 // Find the max level for scaling (ignore very quiet channels)
 const activeLevels = channels.filter(c => c.level_db > -60).map(c => c.level_db)
 const maxDb = activeLevels.length > 0 ? Math.max(...activeLevels) : 0
 const minDb = -60
 const range = maxDb - minDb

 // Group channels
 const groups = ['ear_level', 'height', 'lfe'] as const
 const grouped = groups.map(g => ({
 group: g,
 ...GROUP_LABELS[g],
 channels: channels.filter(c => c.group === g),
 })).filter(g => g.channels.length > 0)

 const barWidth = 600
 const barHeight = 16
 const labelWidth = 40

 return (
 <div className="bg-dark-900 p-6 border border-dark-700/50 space-y-4" style={{ borderRadius: '2px' }}>
 <div className="space-y-1">
 <h2 className="text-lg">Channel Energy</h2>
 <p className="text-xs text-dark-400">
 RMS level per channel in the {layout} bed
 </p>
 </div>

 <div className="space-y-5">
 {grouped.map(g => (
 <div key={g.group} className="space-y-2">
 <div className="flex items-center gap-2">
 <div className="w-2 h-2 rounded-full" style={{ backgroundColor: g.color }} />
 <span className="text-xs font-medium text-dark-300">{g.label}</span>
 </div>

 <div className="space-y-1.5">
 {g.channels.map(ch => {
 const pct = range > 0 ? Math.max(0, (ch.level_db - minDb) / range) * 100 : 0
 const isActive = ch.level_db > -40
 return (
 <div key={ch.channel} className="flex items-center gap-3">
 <span className="text-[11px] text-dark-400 w-8 text-right font-mono">
 {ch.channel}
 </span>
 <div className="flex-1 h-4 rounded-full overflow-hidden" style={{ backgroundColor: '#1a1918' }}>
 <div
 className="h-full rounded-full transition-all"
 style={{
 width: `${pct}%`,
 backgroundColor: isActive ? g.color : '#3a3835',
 opacity: isActive ? 0.8 : 0.3,
 }}
 />
 </div>
 <span className={`text-[10px] font-mono w-14 text-right ${isActive ? 'text-dark-300' : 'text-dark-600'}`}>
 {ch.level_db > -60 ? `${ch.level_db.toFixed(1)} dB` : 'silent'}
 </span>
 </div>
 )
 })}
 </div>
 </div>
 ))}
 </div>

 {/* Object energy info (when objects exist but no ADM position data) */}
 {!hasAdm && objectCount != null && objectCount > 0 && (
 <div className="flex items-center gap-3 px-4 py-3" style={{ borderRadius: '2px', backgroundColor: 'rgba(168,85,247,0.05)', border: '1px solid rgba(168,85,247,0.15)' }}>
 <span className="text-xs" style={{ color: 'var(--color-slate-blue)' }}>
 {objectCount} audio objects
 </span>
 {objectEnergyDb != null && isFinite(objectEnergyDb) && (
 <span className="text-[10px] font-mono text-dark-400">
 {objectEnergyDb.toFixed(1)} dB total energy
 </span>
 )}
 <span className="text-[10px] text-dark-600">
 — no position metadata (spatial placement unknown)
 </span>
 </div>
 )}

 <div className="text-[10px] text-dark-500">
 {!hasAdm && objectCount != null && objectCount > 0
 ? `Showing bed channels only. ${objectCount} objects have audio content but no ADM position data — their spatial placement cannot be determined from this file.`
 : `Shows how audio energy is distributed across all ${layout} channels. Active channels should show clear signal; silent or very quiet channels may indicate content that could use more spatial treatment.`
 }
 </div>
 </div>
 )
}
