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
        className="w-[560px] max-w-[92vw] overflow-hidden"
        style={{
          backgroundColor: 'var(--color-sand-900)',
          border: '1px solid rgba(208,176,102,0.3)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          borderRadius: '2px',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b" style={{ borderColor: 'rgba(168,161,150,0.12)' }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--color-text-muted)' }}>Modules</div>
              <h2 className="text-lg mt-1" style={{ color: 'var(--color-text-primary)', fontFamily: "'Playfair Display', Georgia, serif", fontWeight: 400 }}>
                Customize your workspace
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-[10px] uppercase tracking-[0.14em] transition-colors hover:text-sand-200"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Done
            </button>
          </div>
          <p className="text-[11px] mt-2" style={{ color: 'var(--color-text-muted)' }}>
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
                className="flex items-center gap-4 px-4 py-3 transition-colors"
                style={{
                  backgroundColor: isActive ? 'rgba(208,176,102,0.06)' : 'rgba(30,28,24,0.4)',
                  border: `1px solid ${isActive ? 'rgba(208,176,102,0.2)' : 'rgba(168,161,150,0.08)'}`,
                  borderRadius: '2px',
                }}
              >
                {/* Icon + info */}
                <div className="flex items-center justify-center w-10 h-10 flex-shrink-0" style={{
                  backgroundColor: 'rgba(14,13,11,0.6)',
                  border: '1px solid rgba(168,161,150,0.12)',
                  fontSize: 18,
                  borderRadius: '2px',
                }}>
                  {mod.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium" style={{ color: 'var(--color-text-primary)' }}>{mod.label}</span>
                    <span className="text-[9px] font-mono" style={{ color: 'var(--color-text-muted)' }}>v{mod.version}</span>
                    {tierBadge && (
                      <span className="text-[9px] px-1.5 py-0.5 uppercase tracking-[0.14em]" style={{
                        color: 'var(--color-text-muted)',
                        backgroundColor: 'rgba(168,161,150,0.08)',
                        border: '1px solid rgba(168,161,150,0.18)',
                        borderRadius: '2px',
                      }}>
                        {tierBadge}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>
                    {mod.description}
                  </p>
                </div>

                {/* Toggle */}
                <button
                  onClick={() => onToggle(mod.id)}
                  className="text-[10px] px-3 py-1.5 flex-shrink-0 transition-colors"
                  style={{
                    color: isActive ? 'var(--color-danger)' : 'var(--color-accent)',
                    border: `1px solid ${isActive ? 'rgba(224,90,90,0.35)' : 'rgba(208,176,102,0.4)'}`,
                    borderRadius: '2px',
                  }}
                >
                  {isActive ? 'Remove' : 'Add'}
                </button>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t text-center text-[9px]" style={{ borderColor: 'rgba(168,161,150,0.08)', color: 'var(--color-text-muted)' }}>
          More modules coming soon — Atmos Studio · Archive · Sync · Broadcast
        </div>
      </div>
    </div>
  )
}
