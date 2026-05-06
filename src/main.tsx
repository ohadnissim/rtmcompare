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
