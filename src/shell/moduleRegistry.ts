import { ModuleManifest } from './moduleTypes'

// ── Stub module components ──────────────────────────────────────────
// These are temporary placeholders. Once migration happens, each
// stub gets replaced by the real module component (e.g. the current
// App.tsx compare flow, BatchView, FLOW's App.tsx). The stubs render
// a centered label so the shell is testable before migration.

import React from 'react'

function StubModule({ label }: { label: string }) {
 return React.createElement('div', {
 className: 'flex items-center justify-center h-full',
 style: { color: 'var(--color-text-muted)', fontSize: '14pt', letterSpacing: '0.18em', textTransform: 'uppercase' as const },
 }, `${label} module — ready for migration`)
}

// ── Manifests ───────────────────────────────────────────────────────
// Each manifest declares a module. The registry exports them as an
// ordered array. PlatformShell reads this list to render the tab bar
// and the [+] store.

export const MODULES: ModuleManifest[] = [
 {
 id: 'compare',
 label: 'Compare',
 description: 'Industry-standard A/B compare + single-file QC + Atmos. Level-matched measurement, engineer profiles, EQ export, streaming preview.',
 version: '4.0.0',
 icon: React.createElement('span', { style: { fontSize: 12 } }, '◎'),
 tier: 'free',
 defaultOrder: 0,
 component: () => StubModule({ label: 'Compare' }),
 accentColor: 'var(--color-data-a)',
 },
 {
 id: 'album-qc',
 label: 'Album QC',
 description: 'Album batch analysis — sortable table, Cohort Mode, per-song deep analysis, A/B inside every tab, notes, DMR, session save/load.',
 version: '4.0.0',
 icon: React.createElement('span', { style: { fontSize: 12 } }, '▤'),
 tier: 'free',
 defaultOrder: 1,
 component: () => StubModule({ label: 'Album QC' }),
 accentColor: 'var(--color-accent)',
 },
 {
 id: 'flow',
 label: 'FLOW',
 description: 'Album sequencing, track transitions, DDP export, delivery packaging. Analyse → order → deliver in one surface.',
 version: '1.0.0',
 icon: React.createElement('span', { style: { fontSize: 12 } }, '↻'),
 tier: 'pro',
 defaultOrder: 2,
 component: () => StubModule({ label: 'FLOW' }),
 accentColor: 'var(--color-data-warn)',
 },
]

/** Lookup a manifest by id. */
export function getModule(id: string): ModuleManifest | undefined {
 return MODULES.find(m => m.id === id)
}
