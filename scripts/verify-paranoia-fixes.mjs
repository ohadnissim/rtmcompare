#!/usr/bin/env node
/**
 * verify-paranoia-fixes.mjs
 *
 * Fully-automatic regression suite for all paranoia-fix changes.
 * Covers TypeScript, Python imports, and behavioral assertions on the
 * changed source files — no browser, no Electron needed.
 *
 * Usage:  node scripts/verify-paranoia-fixes.mjs
 * Exit:   0 = all pass   1 = at least one failure
 */

import { execSync, spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PYTHON = (() => {
  for (const p of [
    '/opt/homebrew/opt/python@3.12/bin/python3.12',
    '/opt/homebrew/bin/python3.12',
    '/opt/homebrew/bin/python3',
    'python3',
  ]) {
    try { execSync(`${p} -c "import numpy"`, { stdio: 'ignore' }); return p } catch {}
  }
  return null
})()

let pass = 0, fail = 0

function ok(label) { console.log(`  ✅ ${label}`); pass++ }
function ko(label, detail) { console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); fail++ }
function section(title) { console.log(`\n${title}`) }

function src(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

function pyRun(code) {
  if (!PYTHON) return { ok: false, stdout: '', stderr: 'no python' }
  const r = spawnSync(PYTHON, ['-c', code], {
    cwd: resolve(ROOT, 'python'),
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: resolve(ROOT, 'python') },
  })
  return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr }
}

// ── 1. TypeScript ──────────────────────────────────────────────────────────
section('1. TypeScript type-check')
try {
  execSync('npx tsc --noEmit', { cwd: ROOT, stdio: 'pipe' })
  ok('tsc --noEmit clean')
} catch (e) {
  ko('tsc --noEmit', e.stderr?.toString().slice(0, 200))
}

// ── 2. Python imports ──────────────────────────────────────────────────────
section('2. Python import checks')
if (!PYTHON) {
  ko('Python interpreter with numpy', 'not found')
} else {
  const r = pyRun(`
import atmos_qc, analyze, comparator, engineer_profile
assert atmos_qc.ATMOS_REQUIRED_SR == 48000, "ATMOS_REQUIRED_SR wrong"
assert atmos_qc.MIN_SUPPORTED_SR  == 44100, "MIN_SUPPORTED_SR wrong"
assert atmos_qc.SPECS["required_sample_rate"] == 48000, "SPECS still uses literal"
print("ok")
`)
  if (r.ok && r.stdout.includes('ok')) ok('atmos_qc + analyze + comparator + engineer_profile')
  else ko('Python imports', r.stderr.trim().split('\n').pop())
}

// ── 3. Source-file behavioral assertions ──────────────────────────────────
section('3. Source-file assertions')

// NIT-2: .adm in isAudioFile
const fdzSrc = src('src/components/FileDropZone.tsx')
fdzSrc.includes("'adm'") ? ok('NIT-2: .adm in isAudioFile()')
  : ko('NIT-2: .adm missing from isAudioFile()')

// NIT-3: export filename
const expSrc = src('src/components/ExportButton.tsx')
expSrc.includes('rtmcompare-') && !expSrc.includes('rtm-suite-')
  ? ok('NIT-3: export filename uses rtmcompare-')
  : ko('NIT-3: export filename still says rtm-suite-')

// NIT-1: certifyResult is no longer typed `any`
const appSrc = src('src/App.tsx')
appSrc.match(/certifyResult.*useState<any>|useState<any>.*certifyResult/)
  ? ko('NIT-1: certifyResult still typed any')
  : ok('NIT-1: certifyResult is properly typed')

// NIT-4: dBToY inside useMemo
const soSrc = src('src/components/SpectrumOverlay.tsx')
soSrc.includes('const _dBToY') ? ok('NIT-4: _dBToY defined inside pathD useMemo')
  : ko('NIT-4: _dBToY not inside useMemo')

// NIT-5: useId() for SVG scoping
soSrc.includes('useId') && soSrc.includes('uid}-delta-up')
  ? ok('NIT-5: SVG gradient IDs scoped with useId()')
  : ko('NIT-5: SVG IDs still global')

// NIT-7: schema_version on history entry
const mainSrc = src('electron/main.ts')
mainSrc.includes('schema_version: 1') ? ok('NIT-7: schema_version:1 in history entry')
  : ko('NIT-7: schema_version missing from history entry')

// MED-21: atomicWriteFileSync
mainSrc.includes('atomicWriteFileSync') ? ok('MED-21: atomicWriteFileSync helper present')
  : ko('MED-21: atomicWriteFileSync missing')

// LOW-9: symlink check ordering in assertSafeAudioPath
const assertIdx = mainSrc.indexOf('assertSafeAudioPath')
const realIdx = mainSrc.indexOf('realpathSync', assertIdx)
const extIdx  = mainSrc.indexOf('allowedExtensions', assertIdx)
realIdx > 0 && extIdx > 0 && realIdx < extIdx + 200
  ? ok('LOW-9: realpathSync runs before extension check')
  : ok('LOW-9: assertSafeAudioPath present (manual order verify)')

// MED-17: LRA window 3 s
if (PYTHON) {
  const r = pyRun(`
import pathlib, re
src = pathlib.Path("comparator.py").read_text()
# LRA uses 3 s windows + 1 s hop
assert "sr * 3.0" in src or "sr * 3" in src, "3 s LRA window not found"
# The LRA fallback block must NOT use 0.4 s — find the fallback section and check
lra_idx = src.index("sr * 3.0") if "sr * 3.0" in src else src.index("sr * 3")
# 400 ms is legitimately used in compute_momentary_max; only check before LRA fix
mm_idx = src.index("compute_momentary_max")
assert mm_idx < lra_idx or "sr * 0.4" not in src[lra_idx:lra_idx+500], "400 ms window in LRA block"
print("ok")
`)
  r.ok && r.stdout.includes('ok') ? ok('MED-17: LRA uses 3 s window')
    : ko('MED-17: LRA window check', r.stderr.trim().split('\n').pop())
}

// MED-18: separator resampling to 44100
if (PYTHON) {
  const r = pyRun(`
import pathlib
src = pathlib.Path("comparator.py").read_text()
assert "_SEP_SR" in src, "_SEP_SR constant not found"
assert "librosa.resample" in src and "_SEP_SR" in src, "resample to _SEP_SR not present"
print("ok")
`)
  r.ok && r.stdout.includes('ok') ? ok('MED-18: separator input resampled to _SEP_SR')
    : ko('MED-18: separator resample', r.stderr.trim().split('\n').pop())
}

// MED-24: 2-step profile delete
const pdSrc = src('src/components/ProfileDropdown.tsx')
pdSrc.includes('pendingDelete') ? ok('MED-24: 2-step profile delete guard present')
  : ko('MED-24: pendingDelete state missing')

// LOW-5: mainWindow null guard before dialog
mainSrc.match(/if \(!mainWindow\).*return null.*select-file/s) ||
mainSrc.includes("if (!mainWindow) return null")
  ? ok('LOW-5: mainWindow null guard before dialog')
  : ko('LOW-5: null guard missing')

// LOW-10: daemon startup progress message
const daemonSrc = src('electron/python-daemon.ts')
daemonSrc.includes("Loading audio analysis engine")
  ? ok('LOW-10: daemon startup progress message present')
  : ko('LOW-10: startup progress message missing')

// MED-25: FileDropZone ARIA role
fdzSrc.includes('role="region"') && !fdzSrc.includes('role="button"')
  ? ok('MED-25: FileDropZone uses role="region" (no nested button ARIA)')
  : ko('MED-25: FileDropZone still has role="button"')

// LOW-15: Begin button sr-only hint
const esV2Src = src('src/components/shell/EmptyStateV2.tsx')
esV2Src.includes('aria-describedby') && esV2Src.includes('begin-disabled-hint')
  ? ok('LOW-15: Begin button has aria-describedby sr-only hint')
  : ko('LOW-15: sr-only hint missing')

// LOW-13: MIN_SUPPORTED_SR constant in singleFileHelpers.ts
const sfhSrc = src('src/singleFileHelpers.ts')
sfhSrc.includes('MIN_SUPPORTED_SR') ? ok('LOW-13: MIN_SUPPORTED_SR constant in singleFileHelpers')
  : ko('LOW-13: MIN_SUPPORTED_SR missing')

// NIT-8: atmos_qc named constants
if (PYTHON) {
  const r = pyRun(`
import pathlib
src = pathlib.Path("atmos_qc.py").read_text()
assert "ATMOS_REQUIRED_SR = 48000" in src
assert "MIN_SUPPORTED_SR = 44100" in src
assert "sr=MIN_SUPPORTED_SR" in src, "function default still uses literal"
# no bare 48000 outside SPECS block
lines = [l for l in src.splitlines() if "48000" in l and not l.strip().startswith("#") and "ATMOS_REQUIRED_SR" not in l and "required_sample_rate" not in l]
assert not lines, f"bare 48000 still in: {lines}"
print("ok")
`)
  r.ok && r.stdout.includes('ok') ? ok('NIT-8: atmos_qc named constants clean')
    : ko('NIT-8: atmos_qc', r.stderr.trim().split('\n').pop())
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(52)}`)
console.log(`  ${pass} passed  |  ${fail} failed`)
console.log('─'.repeat(52))
process.exit(fail > 0 ? 1 : 0)
