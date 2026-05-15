// Dev-only electronAPI shim — MUST load before any module that touches
// window.electronAPI. No-op in production (real Electron preload present).
import './devShim'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// PlatformShell is the future modular ecosystem shell — not yet the
// production root. Real app still mounts here. See `src/shell/` and
// `RTM Platform/ARCHITECTURE.md` for the migration plan.
// import PlatformShell from './shell/PlatformShell'
import { ThemeProvider } from './ThemeContext'
import { ModesProvider } from './ModesContext'
import { EQProvider } from './EQContext'
import { SoloProvider } from './SoloContext'
import { PluginDropProvider } from './PluginDropContext'
import ErrorBoundary from './components/ErrorBoundary'
import './styles.css'

// Dev-only render-loop detector. "Maximum update depth exceeded" is a React
// warning (not an Error throw), so it bypasses the ErrorBoundary. Without a
// component stack we can't tell which component is looping. This intercept
// captures and logs the full stack the first time the error fires so the next
// occurrence shows exactly where to look.
if (import.meta.env.DEV) {
 const _origError = console.error.bind(console)
 let loopReported = false
 console.error = (...args: unknown[]) => {
   const msg = typeof args[0] === 'string' ? args[0] : ''
   if (!loopReported && msg.includes('Maximum update depth exceeded')) {
     loopReported = true
     _origError('[RTM render-loop] Component stack follows ↓')
     _origError(...args)
     // Print a clean stack trace so we can trace back to the component.
     try { throw new Error('[RTM render-loop] call stack') } catch (e) { _origError(e) }
   } else {
     _origError(...args)
   }
 }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
 <React.StrictMode>
 {/* Top-level error boundary — without this, any throw inside the
 React tree (malformed FFT, stem worker reject, …) unmounts the
 whole app and leaks the AudioContext. Added 5.2.0 audit P1-10. */}
 <ErrorBoundary label="the app">
 <ThemeProvider>
 <ModesProvider>
 <EQProvider>
 <SoloProvider>
 <PluginDropProvider>
 <App />
 </PluginDropProvider>
 </SoloProvider>
 </EQProvider>
 </ModesProvider>
 </ThemeProvider>
 </ErrorBoundary>
 </React.StrictMode>
)
