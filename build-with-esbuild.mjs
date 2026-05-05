// Lightweight bundler for RTM Suite renderer.
// Drop-in replacement for `vite build` when vite runs out of memory.
// Outputs the same dist/ layout that electron-builder expects.

import * as esbuild from 'esbuild'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const dist = path.join(__dirname, 'dist')
fs.mkdirSync(dist, { recursive: true })
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })

// Bundle the React renderer entry.  One JS + one CSS output.
const result = await esbuild.build({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  outfile: 'dist/assets/index.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: false,
  sourcemap: false,
  treeShaking: true,
  loader: {
    '.tsx': 'tsx',
    '.ts': 'tsx',
    '.jsx': 'jsx',
    '.js': 'jsx',
    '.css': 'css',
    '.svg': 'dataurl',
    '.png': 'dataurl',
    '.woff': 'dataurl',
    '.woff2': 'dataurl',
  },
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env.PROD': 'true',
    'import.meta.env.DEV': 'false',
  },
  metafile: false,
  logLevel: 'info',
})

console.log('esbuild complete')

// Write matching index.html that loads the bundle.
const indexSrc = fs.existsSync('index.html')
  ? fs.readFileSync('index.html', 'utf8')
  : fs.readFileSync('dist/index.html', 'utf8').replace(/<script[^>]*src="\/src\/main\.tsx"[^>]*><\/script>/, '')

// Rewrite any absolute /src/main.tsx reference in the source index.html
// to point at the bundled ./assets/index.js.
let html = indexSrc
html = html.replace(/<script[^>]*src="[^"]*main\.tsx"[^>]*><\/script>/,
                    '<script type="module" src="./assets/index.js"></script>')
// If the template had no such script tag (edge case), inject one before </body>.
if (!/\.\/assets\/index\.js/.test(html)) {
  html = html.replace(/<\/body>/, '    <script type="module" src="./assets/index.js"></script>\n  </body>')
}
// Normalise all absolute-path asset references to relative for electron.
html = html.replace(/(href|src)="\//g, '$1="./')
fs.writeFileSync(path.join(dist, 'index.html'), html)

console.log('Wrote dist/index.html (' + html.length + ' bytes)')
console.log('Wrote dist/assets/index.js (' +
            fs.statSync(path.join(dist, 'assets/index.js')).size + ' bytes)')
// Copy public/ if it exists
if (fs.existsSync('public')) {
  for (const entry of fs.readdirSync('public', { withFileTypes: true })) {
    const src = path.join('public', entry.name)
    const dst = path.join(dist, entry.name)
    if (entry.isDirectory()) fs.cpSync(src, dst, { recursive: true })
    else fs.copyFileSync(src, dst)
  }
  console.log('Copied public/ -> dist/')
}
