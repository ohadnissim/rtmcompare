import React from 'react'
import { ModuleManifest } from './moduleTypes'

/**
 * Module Store — the [+] panel that lists all registered modules with
 * activate / deactivate toggles. Modules in the tab bar are "active";
 * modules not in the tab bar are "available." Click to toggle.
 *
 * Tier gating (pro / enterprise) is placeholder for now — the toggle
 * works regardless of tier. Licensing enforcement comes later with the
 * `~/.rtm/license.json` check.
 */
interface Props {
 allModules: ModuleManifest[]
 activeIds: string[]
 onToggle: (id: string) => void
 onClose: () => void
}

export default function ModuleStore({ allModules, activeIds, onToggle, onClose }: Props) {
 return (
 <div
 className="fixed inset-0 z-[150] flex items-center justify-center"
 style={{ backgroundColor: 'rgba(10,9,8,0.78)', backdropFilter: 'blur(6px)' }}
 onClick={onClose}
 >
 <div
 className="w-[560px] max-w-[92vw] rounded-2xl overflow-hidden"
 style={{
 backgroundColor: '#151411',
 border: '1px solid rgba(208,176,102,0.3)',
 boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
 }}
 onClick={e => e.stopPropagation()}
 >
 {/* Header */}
 <div className="px-6 py-5 border-b" style={{ borderColor: 'rgba(168,161,150,0.12)' }}>
 <div className="flex items-center justify-between">
 <div>
 <div className="text-[10px] uppercase tracking-[0.25em]" style={{ color: '#d0b066' }}>Modules</div>
 <h2 className="text-lg mt-1" style={{ color: '#ebe7e0', fontFamily: "'Playfair Display', Georgia, serif", fontWeight: 400 }}>
 Customize your workspace
 </h2>
 </div>
 <button
 onClick={onClose}
 className="text-[10px] uppercase tracking-[0.12em] transition-colors hover:text-sand-200"
 style={{ color: '#8d867b' }}
 >
 Done
 </button>
 </div>
 <p className="text-[11px] mt-2" style={{ color: '#8d867b' }}>
 Toggle modules on or off. Active modules show as tabs. Drag the tab bar to reorder.
 </p>
 </div>

 {/* Module list */}
 <div className="px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
 {allModules.map(mod => {
 const isActive = activeIds.includes(mod.id)
 const tierBadge = mod.tier !== 'free' ? mod.tier.toUpperCase() : null
 return (
 <div
 key={mod.id}
 className="flex items-center gap-4 rounded-xl px-4 py-3 transition-colors"
 style={{
 backgroundColor: isActive ? 'rgba(208,176,102,0.06)' : 'rgba(30,28,24,0.4)',
 border: `1px solid ${isActive ? 'rgba(208,176,102,0.2)' : 'rgba(168,161,150,0.08)'}`,
 }}
 >
 {/* Icon + info */}
 <div className="flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0" style={{
 backgroundColor: 'rgba(14,13,11,0.6)',
 border: '1px solid rgba(168,161,150,0.12)',
 fontSize: 18,
 }}>
 {mod.icon}
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2">
 <span className="text-[12px] font-medium" style={{ color: '#ebe7e0' }}>{mod.label}</span>
 <span className="text-[9px] font-mono" style={{ color: '#8d867b' }}>v{mod.version}</span>
 {tierBadge && (
 <span className="text-[8px] px-1.5 py-0.5 rounded uppercase tracking-[0.1em]" style={{
 color: '#c5a55a',
 backgroundColor: 'rgba(197,165,90,0.12)',
 border: '1px solid rgba(197,165,90,0.25)',
 }}>
 {tierBadge}
 </span>
 )}
 </div>
 <p className="text-[10px] mt-0.5 truncate" style={{ color: '#8d867b' }}>
 {mod.description}
 </p>
 </div>

 {/* Toggle */}
 <button
 onClick={() => onToggle(mod.id)}
 className="text-[10px] px-3 py-1.5 rounded-md flex-shrink-0 transition-colors"
 style={{
 color: isActive ? '#e05a5a' : '#d0b066',
 border: `1px solid ${isActive ? 'rgba(224,90,90,0.35)' : 'rgba(208,176,102,0.4)'}`,
 }}
 >
 {isActive ? 'Remove' : 'Add'}
 </button>
 </div>
 )
 })}
 </div>

 {/* Footer */}
 <div className="px-6 py-3 border-t text-center text-[9px]" style={{ borderColor: 'rgba(168,161,150,0.08)', color: '#8d867b' }}>
 More modules coming soon — Atmos Studio · Archive · Sync · Broadcast
 </div>
 </div>
 </div>
 )
}
