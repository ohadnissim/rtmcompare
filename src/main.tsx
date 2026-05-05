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
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
 <React.StrictMode>
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
 </React.StrictMode>
)
