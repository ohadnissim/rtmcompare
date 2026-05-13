// NIT-4: PlatformShell is the future modular ecosystem shell.
// Currently commented-out in src/main.tsx (not yet the primary App entry).
// Keep: intended for the multi-module platform expansion. Wire into main.tsx
// when ready to replace the single-view AnalysisView entrypoint.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import TabBar from './TabBar'
import ModuleStore from './ModuleStore'
import { ModuleManifest, PlatformState, DEFAULT_PLATFORM_STATE } from './moduleTypes'
import { MODULES } from './moduleRegistry'
import ShortcutHelp from '../components/ShortcutHelp'

/**
 * RTM Platform Shell.
 *
 * The thin outer frame that owns the header, the module tab bar, and
 * the viewport where the active module renders. Modules themselves are
 * fully self-contained — the shell never injects state, services, or
 * props into them. It just mounts/hides them.
 *
 * State preservation strategy: Option A — every active module stays
 * mounted at all times; the inactive ones get `display: none`. This
 * means tab-switching is instant (no re-render, no state loss) at the
 * cost of keeping all React trees in memory. For 3 modules this is
 * negligible; revisit if we hit 6+.
 *
 * Platform state (tab order + active tab) persists in localStorage
 * under `rtm-platform-state`. Future: `~/.rtm/platform.json` via IPC.
 */

const STORAGE_KEY = 'rtm-platform-state'

function loadState(): PlatformState {
 try {
 const raw = localStorage.getItem(STORAGE_KEY)
 if (!raw) return DEFAULT_PLATFORM_STATE
 const parsed = JSON.parse(raw)
 if (!Array.isArray(parsed.tabOrder) || !parsed.activeModuleId) return DEFAULT_PLATFORM_STATE
 // Validate that every id in tabOrder actually exists in the registry.
 const knownIds = new Set(MODULES.map(m => m.id))
 const validOrder = parsed.tabOrder.filter((id: string) => knownIds.has(id))
 if (validOrder.length === 0) return DEFAULT_PLATFORM_STATE
 const activeOk = knownIds.has(parsed.activeModuleId) && validOrder.includes(parsed.activeModuleId)
 return {
 tabOrder: validOrder,
 activeModuleId: activeOk ? parsed.activeModuleId : validOrder[0],
 }
 } catch {
 return DEFAULT_PLATFORM_STATE
 }
}

function saveState(state: PlatformState) {
 try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch {}
}

export default function PlatformShell() {
 const [state, setState] = useState<PlatformState>(loadState)
 const [storeOpen, setStoreOpen] = useState(false)

 // Persist on every change.
 useEffect(() => { saveState(state) }, [state])

 // Resolve manifests for the active tab order.
 const activeTabs: ModuleManifest[] = useMemo(() => {
 return state.tabOrder
 .map(id => MODULES.find(m => m.id === id))
 .filter(Boolean) as ModuleManifest[]
 }, [state.tabOrder])

 // Which module is currently displayed.
 const activeModule = useMemo(
 () => activeTabs.find(t => t.id === state.activeModuleId) || activeTabs[0],
 [activeTabs, state.activeModuleId]
 )

 const selectTab = useCallback((id: string) => {
 setState(s => ({ ...s, activeModuleId: id }))
 }, [])

 const reorderTabs = useCallback((newOrder: string[]) => {
 setState(s => ({ ...s, tabOrder: newOrder }))
 }, [])

 const toggleModule = useCallback((id: string) => {
 setState(s => {
 const has = s.tabOrder.includes(id)
 let tabOrder: string[]
 let activeModuleId = s.activeModuleId
 if (has) {
 tabOrder = s.tabOrder.filter(t => t !== id)
 // If we just removed the active tab, fall back to the first remaining.
 if (activeModuleId === id) activeModuleId = tabOrder[0] || ''
 } else {
 // Add at the end; use the module's defaultOrder to insert at
 // the right position relative to existing tabs.
 const mod = MODULES.find(m => m.id === id)
 if (!mod) return s
 tabOrder = [...s.tabOrder, id]
 // Sort by defaultOrder so newly-added modules land in the
 // "factory" position rather than always at the far right.
 tabOrder.sort((a, b) => {
 const ma = MODULES.find(m => m.id === a)
 const mb = MODULES.find(m => m.id === b)
 return (ma?.defaultOrder ?? 99) - (mb?.defaultOrder ?? 99)
 })
 // Auto-activate the just-added module so the user sees it.
 activeModuleId = id
 }
 return { tabOrder, activeModuleId }
 })
 }, [])

 return (
 <div className="min-h-screen bg-sand-950 flex flex-col">
 {/* macOS drag-strip — kept separate from the blurred header so the
 `-webkit-app-region: drag` hit-region does NOT overlap a node
 with `backdrop-filter: blur`. That combination deadlocks the
 macOS cursor-event pipeline on systems with a low-level mouse
 driver (Kensington Works etc.) and freezes the pointer.
 Electron #24156 / #38624. Same split used in App.tsx. */}
 <div
 className="app-drag-region sticky top-0 z-40"
 style={{ height: 28, backgroundColor: 'transparent' }}
 aria-hidden
 />
 {/* ── Header ── */}
 <header
 className="app-no-drag px-8 py-4 sticky z-30 flex items-center justify-between relative"
 style={{
 top: 28,
 backgroundColor: 'var(--rtm-header-bg, rgba(14,13,11,0.95))',
 borderBottom: '1px solid rgba(168,161,150,0.08)',
 borderRadius: '2px',
 }}
 >
 <div className="flex items-center gap-3 pl-16 app-no-drag">
 <span
 style={{
 fontFamily: 'var(--font-display)',
 fontSize: 'var(--text-wordmark-sm)',
 letterSpacing: 'var(--tracking-wordmark)',
 lineHeight: 'var(--leading-wordmark)',
 fontStyle: 'italic',
 color: 'var(--color-text-primary)',
 }}
 >
 RTM
 </span>
 <span
 className="uppercase"
 style={{
 fontFamily: 'var(--font-body, "Outfit", sans-serif)',
 fontSize: '11px',
 letterSpacing: '0.3em',
 color: 'var(--color-text-muted)',
 }}
 >
 suite
 </span>
 </div>
 <div className="flex items-center gap-3 app-no-drag">
 <button
 onClick={() => {
 try { localStorage.removeItem('rtm-tour-done') } catch {}
 try { localStorage.removeItem('rtm-analysis-tour-done') } catch {}
 try { localStorage.removeItem('rtm-batch-tour-done') } catch {}
 window.location.reload()
 }}
 className="text-[10px] uppercase tracking-[0.14em] px-2 py-1 rounded transition-colors hover:text-sand-200"
 style={{ color: 'var(--color-text-muted)', border: '1px solid rgba(168,161,150,0.18)' }}
 title="Restart all tours"
 >
 Tour
 </button>
 </div>
 {/* Single gold gesture — 1px hairline at the bottom of the header. */}
 <div
 className="absolute bottom-0 left-0 right-0"
 style={{ height: '1px', background: 'var(--color-accent)', opacity: 0.35 }}
 aria-hidden
 />
 </header>

 {/* ── Tab bar ── */}
 <TabBar
 tabs={activeTabs}
 activeId={state.activeModuleId}
 onSelect={selectTab}
 onReorder={reorderTabs}
 onOpenStore={() => setStoreOpen(true)}
 />

 {/* ── Module viewport ── All active modules stay mounted; only the
 active one is visible (display: block vs none). Instant tab
 switching, zero state loss. */}
 <main className="flex-1 relative">
 {activeTabs.map(tab => {
 const Comp = tab.component
 const isVisible = tab.id === activeModule?.id
 return (
 <div
 key={tab.id}
 style={{ display: isVisible ? 'block' : 'none' }}
 className="h-full"
 >
 <div className="max-w-5xl mx-auto px-8 py-6">
 <Comp />
 </div>
 </div>
 )
 })}
 </main>

 {/* ── Module store overlay ── */}
 {storeOpen && (
 <ModuleStore
 allModules={MODULES}
 activeIds={state.tabOrder}
 onToggle={toggleModule}
 onClose={() => setStoreOpen(false)}
 />
 )}

 {/* ── Global keyboard-shortcut legend ── */}
 <ShortcutHelp />
 </div>
 )
}
