import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

// Build-time injections consumed by `<Colophon />` (v5.2 shell).
// `__APP_VERSION__` mirrors package.json "version"; `__BUILD_DATE__`
// is the date of the build in ISO short form. Both fall back to
// 'dev' inside the component if these defines are absent (e.g.
// during raw tsc-watch outside Vite).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const buildDate = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
  },
})
