import React from 'react'

/**
 * Error boundary added in 5.2.0 (audit P1-10).
 *
 * Without this, any throw inside the React tree (SpectrumOverlay dividing
 * by zero on a malformed FFT, a stem worker rejecting, etc.) unmounts the
 * entire app — and the audio graph in ABPlayer leaks because cleanup
 * effects never run during a panicked unmount.
 *
 * Two recommended placements:
 *   • At the root inside main.tsx, around <App /> — catches global crashes
 *   • Inside AnalysisView's tab switch — catches per-panel crashes so a
 *     broken Atmos panel doesn't kill the whole compare view
 *
 * Renders a Console-Didone-styled fallback with the error message + a
 * "Reload" button (window.location.reload()) and a "Try again" button
 * that resets the boundary in place.
 */

interface Props {
 children: React.ReactNode
 /** Override the default fallback. Receives the caught error + a reset
  * callback that clears the error state and re-renders children. */
 fallback?: (error: Error, reset: () => void) => React.ReactNode
 /** Called once when the boundary catches an error. Useful for logging
  * to the main process via electronAPI. */
 onError?: (error: Error, info: React.ErrorInfo) => void
 /** Short label that appears in the default fallback ("…in the spectrum
  * panel", "…in the audio player"). Optional. */
 label?: string
}

interface State {
 error: Error | null
}

export default class ErrorBoundary extends React.Component<Props, State> {
 state: State = { error: null }

 static getDerivedStateFromError(error: Error): State {
 return { error }
 }

 componentDidCatch(error: Error, info: React.ErrorInfo) {
 try { this.props.onError?.(error, info) } catch {}
 // Best-effort console log for dev — production paths should route
 // through onError to the main process.
 // eslint-disable-next-line no-console
 console.error('[ErrorBoundary]', this.props.label || '', error, info.componentStack)
 }

 reset = () => this.setState({ error: null })

 render() {
 if (this.state.error) {
 if (this.props.fallback) return this.props.fallback(this.state.error, this.reset)
 const where = this.props.label ? ` in ${this.props.label}` : ''
 return (
 <div
 role="alert"
 className="rounded-xl p-6 m-4 max-w-2xl mx-auto"
 style={{
 backgroundColor: 'rgba(224,90,90,0.06)',
 border: '1px solid rgba(224,90,90,0.30)',
 color: '#ebe7e0',
 }}
 >
 <div className="text-sm font-medium mb-2" style={{ color: '#e07a4f' }}>
 Something went wrong{where}.
 </div>
 <div className="text-xs mb-4" style={{ color: '#a8a29e' }}>
 {this.state.error.message || 'Unknown error'}
 </div>
 <div className="flex items-center gap-2">
 <button
 onClick={this.reset}
 className="text-[11px] px-3 py-1.5 rounded-md"
 style={{
 backgroundColor: 'rgba(208,176,102,0.12)',
 color: '#d0b066',
 border: '1px solid rgba(208,176,102,0.35)',
 }}
 >
 Try again
 </button>
 <button
 onClick={() => window.location.reload()}
 className="text-[11px] px-3 py-1.5 rounded-md"
 style={{
 backgroundColor: 'rgba(168,161,150,0.10)',
 color: '#a8a29e',
 border: '1px solid rgba(168,161,150,0.25)',
 }}
 >
 Reload app
 </button>
 </div>
 </div>
 )
 }
 return this.props.children as any
 }
}
