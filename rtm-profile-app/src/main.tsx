import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'

declare global {
  interface Window {
    rtmprofileAPI: {
      selectFiles: () => Promise<string[]>
      buildProfile: (args: {
        name: string
        role: string
        outPath?: string
        files: string[]
        /** Deep Scan: per-stem profile via Demucs (adds ~30s-2min per track). */
        deep?: boolean
      }) => Promise<{
        ok: boolean
        path?: string
        sample_count?: number
        skipped?: number
        error?: string
        python_resolution?: string
      }>
      showSavedProfile: (jsonPath: string) => Promise<boolean>
      cancelBuild: () => Promise<boolean>
      onProgress: (cb: (msg: { i: number; total: number; file: string }) => void) => () => void
      /** Drop callback — preload calls this with resolved on-disk
       *  paths every time files land on the window. Returns an
       *  unsubscribe function. */
      onFilesDropped: (cb: (paths: string[]) => void) => () => void
    }
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
