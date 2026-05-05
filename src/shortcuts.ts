/**
 * RTM keyboard shortcut system.
 *
 * The app is a tree of components that each own slices of state the user
 * wants to control from the keyboard (play/pause in ABPlayer, level-match
 * in EQPreviewPlayer, chip navigation in MatchReferenceEQPanel, etc.). We
 * don't want shared global state or a heavyweight store for this — the
 * state already lives where it belongs. Instead we use a tiny event bus:
 * one centralised keydown listener dispatches typed CustomEvents, each
 * component listens for the events it cares about.
 *
 * • Listener in AnalysisView normalises modifier keys and ignores
 * keydowns that originated inside a text input, select, or the
 * command palette.
 * • Events are simple CustomEvents on window so any component can
 * subscribe without imports or providers.
 * • Some shortcuts (⌘K, tab 1–9, Blind A/B) are handled directly in
 * AnalysisView; others fan out via events.
 */

export const RTM_EVENTS = {
 /** Toggle play / pause on the primary A/B player. */
 playToggle: 'rtm:play-toggle',
 /** Switch the A/B player source to file A. */
 sourceA: 'rtm:source-a',
 /** Switch the A/B player source to file B. */
 sourceB: 'rtm:source-b',
 /** Flip the level-matched A/B compensation. */
 levelMatchToggle: 'rtm:level-match-toggle',
 /** Flip the mono-compat monitor on / off. */
 monoMonitorToggle:'rtm:mono-monitor-toggle',
 /** Select the previous chip in the Match tab and audition it. */
 chipPrev: 'rtm:chip-prev',
 /** Select the next chip in the Match tab and audition it. */
 chipNext: 'rtm:chip-next',
 /** Export Pro-Q FFP directly from whatever Match mode is active. */
 exportFFP: 'rtm:export-ffp',
 /** Trigger Apply-and-Bounce. */
 applyBounce: 'rtm:apply-bounce',
 /** Emitted when the EQ preview is about to play — main A/B player should
 * pause so the two don't step on each other. */
 eqPreviewStarted: 'rtm:eq-preview-started',
 /** Emitted when the main A/B player starts — EQ preview should stop so
 * you never have two audio chains fighting the output. */
 mainPlayerStarted:'rtm:main-player-started',
} as const

export type RTMEventName = typeof RTM_EVENTS[keyof typeof RTM_EVENTS]

/** Emit a bus event. Payload optional. */
export function emitShortcut(name: RTMEventName, detail?: unknown) {
 window.dispatchEvent(new CustomEvent(name, { detail }))
}

/** Subscribe to a bus event; returns a cleanup function. */
export function onShortcut(name: RTMEventName, handler: (e: CustomEvent) => void): () => void {
 const listener = (e: Event) => handler(e as CustomEvent)
 window.addEventListener(name, listener)
 return () => window.removeEventListener(name, listener)
}

/** Returns true when the keydown happened inside a text-editing surface. */
export function isEditableTarget(e: KeyboardEvent): boolean {
 const t = e.target as HTMLElement | null
 if (!t) return false
 if (t.isContentEditable) return true
 const tag = t.tagName
 if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
 // Our search palette input sits inside a container we tag with
 // data-palette-input — respect that too, so typing in the palette doesn't
 // fire global shortcuts.
 if (t.closest('[data-palette-input]')) return true
 return false
}

/**
 * Search index used by the ⌘K palette. Each entry is a metric / concept
 * the user might type to jump to the right panel. The palette fuzzy-matches
 * on `keywords` + `label`. `tab` is the target tab id in AnalysisView;
 * `panelId` (optional) is a scroll anchor we stamp on the CollapsibleSection
 * wrapper via `data-panel-id` so the jump can scroll the exact panel into
 * view.
 */
export interface SearchIndexEntry {
 label: string
 tab: string
 keywords: string[]
 /** Human category shown on the right-hand side of the result row. */
 hint?: string
}

export const SEARCH_INDEX: SearchIndexEntry[] = [
 // Overview
 { label: 'Integrated LUFS', tab: 'overview', keywords: ['lufs', 'loudness', 'integrated', 'loud'], hint: 'Overview' },
 { label: 'True Peak (dBTP)', tab: 'overview', keywords: ['true peak', 'dbtp', 'tp', 'peak', 'ceiling'], hint: 'Overview' },
 { label: 'LRA / Dynamic Range', tab: 'overview', keywords: ['lra', 'dynamic range', 'dynamics', 'crest'], hint: 'Overview' },
 { label: 'Short-Term Max', tab: 'overview', keywords: ['short term', 'chorus loudness', 'max'], hint: 'Overview' },
 { label: 'Momentary Max', tab: 'overview', keywords: ['momentary', '400ms', 'spike'], hint: 'Overview' },
 { label: 'Length', tab: 'overview', keywords: ['length', 'duration', 'ms', 'seconds', 'runtime'], hint: 'Overview' },
 { label: 'Stereo Width', tab: 'overview', keywords: ['width', 'stereo', 'side', 'mid side'], hint: 'Overview' },
 { label: 'Waveform', tab: 'overview', keywords: ['waveform', 'energy', 'shape'], hint: 'Overview' },
 { label: 'Loudness Over Time', tab: 'overview', keywords: ['loudness over time', 'lufs curve'], hint: 'Overview' },

 // Delivery
 { label: 'Spotify normalization', tab: 'delivery', keywords: ['spotify', 'streaming', 'normalization', '−14'], hint: 'Delivery' },
 { label: 'Apple Music normalization',tab: 'delivery', keywords: ['apple', 'music', 'normalization', '−16'], hint: 'Delivery' },
 { label: 'YouTube normalization', tab: 'delivery', keywords: ['youtube', 'streaming'], hint: 'Delivery' },
 { label: 'Tidal / Amazon / Deezer', tab: 'delivery', keywords: ['tidal', 'amazon', 'deezer', 'streaming'], hint: 'Delivery' },
 { label: 'TP breach', tab: 'delivery', keywords: ['tp breach', 'true peak breach', 'clip'], hint: 'Delivery' },
 { label: 'File metadata', tab: 'delivery', keywords: ['metadata', 'bwf', 'bext', 'ixml', 'isrc', 'tags'], hint: 'Delivery' },

 // Stereo
 { label: 'Frequency spectrum', tab: 'stereo', keywords: ['spectrum', 'eq curve', 'frequency', 'tonal'], hint: 'Stereo' },
 { label: 'Mono compatibility', tab: 'stereo', keywords: ['mono', 'compat', 'phone', 'bluetooth'], hint: 'Stereo' },
 { label: 'Phase correlation', tab: 'stereo', keywords: ['phase', 'correlation', 'out of phase'], hint: 'Stereo' },
 { label: 'Per-band phase', tab: 'stereo', keywords: ['band phase', 'low phase', 'high phase'], hint: 'Stereo' },
 { label: 'Vectorscope', tab: 'stereo', keywords: ['vectorscope', 'lissajous', 'x/y'], hint: 'Stereo' },
 { label: 'Stereo image over time', tab: 'stereo', keywords: ['stereo time', 'width timeline'], hint: 'Stereo' },

 // Match
 { label: 'Reference EQ match', tab: 'match', keywords: ['match', 'reference', 'eq', 'moves', 'recommendations'], hint: 'EQ Match' },
 { label: 'Engineer profile tips', tab: 'match', keywords: ['engineer', 'profile', 'target curve', 'tips'], hint: 'EQ Match' },
 { label: 'Apply and bounce', tab: 'match', keywords: ['apply', 'bounce', 'export wav', 'render'], hint: 'EQ Match' },
 { label: 'Pro-Q FFP export', tab: 'match', keywords: ['pro-q', 'fabfilter', 'ffp', 'export eq'], hint: 'EQ Match' },

 // Breakdown
 { label: 'Kick', tab: 'breakdown', keywords: ['kick', 'drums', 'low'], hint: 'Breakdown' },
 { label: 'Snare', tab: 'breakdown', keywords: ['snare', 'drums', 'body'], hint: 'Breakdown' },
 { label: 'Sub', tab: 'breakdown', keywords: ['sub', '808', 'sub bass', 'low end'], hint: 'Breakdown' },
 { label: 'Bass', tab: 'breakdown', keywords: ['bass', 'low', 'bass guitar'], hint: 'Breakdown' },
 { label: 'Vocals', tab: 'breakdown', keywords: ['vocals', 'vocal', 'lead'], hint: 'Breakdown' },
 { label: 'Instruments', tab: 'breakdown', keywords: ['instruments', 'keys', 'guitars', 'synths'], hint: 'Breakdown' },
 { label: 'Brightness', tab: 'breakdown', keywords: ['brightness', 'highs', '5k', '3-10 khz'], hint: 'Breakdown' },
 { label: 'Air', tab: 'breakdown', keywords: ['air', 'top end', '10 khz', 'sparkle'], hint: 'Breakdown' },
 { label: 'Masking', tab: 'breakdown', keywords: ['masking', 'overlap'], hint: 'Breakdown' },
 { label: 'Transient density', tab: 'breakdown', keywords: ['transient', 'density', 'sections'], hint: 'Breakdown' },
 { label: 'Tonal issues', tab: 'breakdown', keywords: ['harsh', 'muddy', 'boxy', 'boom', 'thin', 'sibilant'], hint: 'Breakdown' },

 // Quality
 { label: 'Clicks & glitches', tab: 'quality', keywords: ['click', 'glitch', 'pop', 'artifact'], hint: 'Quality' },
 { label: 'Distortion', tab: 'quality', keywords: ['distortion', 'clipping', 'clip', 'over'], hint: 'Quality' },
 { label: 'Hum & buzz', tab: 'quality', keywords: ['hum', 'buzz', '50 hz', '60 hz', 'mains'], hint: 'Quality' },
 { label: 'Tempo over time', tab: 'quality', keywords: ['tempo', 'bpm', 'drift'], hint: 'Quality' },

 // Atmos (conditional)
 { label: 'Atmos QC', tab: 'atmos', keywords: ['atmos', 'qc', 'dolby', 'immersive'], hint: 'Atmos' },
 { label: 'Surround field', tab: 'atmos', keywords: ['surround', 'field', 'height', 'immersive'], hint: 'Atmos' },
 { label: 'Object trajectories', tab: 'atmos', keywords: ['objects', 'trajectory', 'panning'], hint: 'Atmos' },
 { label: 'Downmix fidelity', tab: 'atmos', keywords: ['downmix', 'stereo fold', 'fold down'], hint: 'Atmos · Downmix' },
]

/**
 * Score a query against an index entry — simple substring scoring with a
 * light boost for whole-word matches and keyword-order preservation.
 * Good enough for ~50 items without pulling in a real fuzzy lib.
 */
export function scoreEntry(query: string, entry: SearchIndexEntry): number {
 const q = query.trim().toLowerCase()
 if (!q) return 0
 const label = entry.label.toLowerCase()
 const keywords = entry.keywords.map(k => k.toLowerCase())
 let score = 0
 if (label === q) score += 100
 if (label.startsWith(q)) score += 30
 if (label.includes(q)) score += 15
 for (const kw of keywords) {
 if (kw === q) score += 40
 else if (kw.startsWith(q)) score += 12
 else if (kw.includes(q)) score += 6
 }
 // Split-term bonus — "kick lufs" matches "Integrated LUFS" (lufs) then
 // "Kick" (kick). Awards partial multi-term queries.
 const parts = q.split(/\s+/).filter(Boolean)
 if (parts.length > 1) {
 for (const p of parts) {
 if (label.includes(p)) score += 4
 if (keywords.some(k => k.includes(p))) score += 3
 }
 }
 return score
}
