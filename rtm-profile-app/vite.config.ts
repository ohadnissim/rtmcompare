import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * MED-4: Strip localhost origins from the CSP `connect-src` in production
 * builds. In dev the Vite dev-server is reachable at localhost:5174; in the
 * packed Electron app it is not — those origins must not ship.
 */
function stripDevCsp(): Plugin {
  return {
    name: 'strip-dev-csp',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (ctx.command !== 'build') return html
        return html.replace(
          /\s+http:\/\/localhost:\d+\s*/g, ' '
        ).replace(
          /\s+ws:\/\/localhost:\d+\s*/g, ' '
        )
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), stripDevCsp()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
  },
})
