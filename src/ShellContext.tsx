import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'

/**
 * Shell version flag — controls which top-level shell renders.
 *
 * `'v1'` is the v5.1.x classic shell (current header markup, classic
 * empty state). `'v2'` is the Console Didone shell rebuild (HeaderV2,
 * MetricStrip, EmptyStateV2, PanelVerdict). Both code paths coexist
 * during the v5.2 transition; either can be selected at runtime via
 * the OverflowMenu → Shell version switch (delivered with task #10).
 *
 * Default is `'v2'`. To force classic, set
 * `localStorage['rtm-shell'] = 'v1'`. Anything else (including unset)
 * resolves to `'v2'`.
 *
 * Persisted via localStorage. Updates apply on next render — no
 * reload required, since `<header>` re-renders when this context
 * value changes.
 *
 * See `.rtm-design/v5.2-shell-brief.md` and
 * `.rtm-design/v5.2-anti-ai-design.md` before editing the v2 shell.
 */
type ShellVersion = 'v1' | 'v2'

interface ShellContextType {
 shellVersion: ShellVersion
 setShellVersion: (v: ShellVersion) => void
}

const ShellContext = createContext<ShellContextType>({
 shellVersion: 'v2',
 setShellVersion: () => {},
})

export function useShell() {
 return useContext(ShellContext)
}

export function ShellProvider({ children }: { children: React.ReactNode }) {
 const [shellVersion, setShellVersionState] = useState<ShellVersion>(() => {
 try {
 const saved = localStorage.getItem('rtm-shell')
 // Only `'v1'` opts out of v2. Unset / anything else → v2 (the
 // default for v5.2). Mirrors the conservative defaulting used
 // by ThemeContext: keep behaviour stable when the key is
 // missing or corrupted.
 return saved === 'v1' ? 'v1' : 'v2'
 } catch {
 return 'v2'
 }
 })

 const setShellVersion = useCallback((v: ShellVersion) => {
 setShellVersionState(v)
 try {
 localStorage.setItem('rtm-shell', v)
 } catch {
 // Private mode / quota exceeded — silent fail.
 }
 }, [])

 useEffect(() => {
 // Reserved for future analytics / debug-pane visibility.
 }, [shellVersion])

 const value = useMemo(() => ({ shellVersion, setShellVersion }), [shellVersion, setShellVersion])

 return (
 <ShellContext.Provider value={value}>
 {children}
 </ShellContext.Provider>
 )
}
