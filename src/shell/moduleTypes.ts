import React from 'react'

/**
 * Module manifest — the contract every RTM Platform module declares.
 *
 * Deliberately thin. The shell doesn't inject services, doesn't manage
 * module state, doesn't wire inter-module communication. It just renders
 * the active module's component in the viewport and handles the tab bar.
 *
 * Each module is a self-contained React component. It mounts when its
 * tab becomes active and stays mounted (hidden via display:none) when
 * the user switches to a different tab — so all state is preserved.
 */
export interface ModuleManifest {
 /** Unique id — used for persistence key, licensing, keyboard scope. */
 id: string
 /** Display label on the tab strip. Keep ≤ 12 characters. */
 label: string
 /** One-liner for the [+] module-store panel. */
 description: string
 /** Semver — shown in the module-store detail view. */
 version: string
 /** Tab icon — small SVG or unicode glyph rendered to the left of the
 * label. Sized at 14 × 14 px in the tab strip. */
 icon: React.ReactNode
 /** Licensing tier. 'free' modules are always available; 'pro' and
 * 'enterprise' are gated by the license file. */
 tier: 'free' | 'pro' | 'enterprise'
 /** Default position in the tab bar (lower = further left). Users can
 * drag-reorder; this is just the factory default. */
 defaultOrder: number
 /** The full-viewport React component rendered when this tab is active.
 * Receives no props from the shell — the module is fully independent.
 * The shell keeps every module mounted (display:none when inactive)
 * so component state survives tab switches. */
 component: React.ComponentType
 /** Optional accent colour used for the tab's active-state underline.
 * Falls back to the global gold (#d0b066) if omitted. */
 accentColor?: string
}

/**
 * Platform-level state persisted in `~/.rtm/platform.json`.
 *
 * This is the only file the shell owns. Everything else (module-internal
 * sessions, notes, analysis caches) is the module's own business.
 */
export interface PlatformState {
 /** Ordered array of module ids — the user's tab arrangement. Modules
 * not in this array are hidden (available via [+] but not in the
 * tab strip). */
 tabOrder: string[]
 /** Which module was active when the user last closed the app. */
 activeModuleId: string
}

export const DEFAULT_PLATFORM_STATE: PlatformState = {
 tabOrder: ['compare', 'album-qc', 'flow'],
 activeModuleId: 'compare',
}
