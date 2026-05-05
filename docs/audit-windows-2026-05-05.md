# Windows-build audit (2026-05-05)

Skills applied: **code-reviewer + senior-security**, scoped only to
Windows-specific paths in the suite (RTMcompare, RTMprofile, RTM Send).
Triggered by the realisation that the Mac path has had heavy review
(5.2.0 + 5.2.1) but the Windows build had never been audited.

**TL;DR:** the Mac audit fixes are mostly pure-TypeScript and reach
Windows for free. Security parity is essentially achieved. **But the
Windows binaries have two P0 functional bugs that mean every shipped
ZIP from 5.0.7 → 5.2.1 is a paperweight.** Both are CI-config fixes,
not code fixes. Roughly an hour of work + a re-tag.

---

## P0 — must fix immediately (hot-fix as 5.2.2)

### W1. Windows Python bundle is missing `librosa`, `numba`, `demucs`, `julius`
**Severity: P0 (functional blocker)** · **Effort: ~30 min CI edit**
**Where:** [`.github/workflows/build-windows.yml:77-79`](.github/workflows/build-windows.yml)

The Windows CI installs only `numpy scipy soundfile pyloudnorm`. The Mac bundle (`python-bundle/python/lib/python3.11/site-packages/`) carries `librosa`, `numba`, `demucs`, `julius`, `openunmix`, `audioread`, `cffi`, `decorator`, `joblib`, `lazy_loader`, `llvmlite`, `mpmath`, `networkx`, `omegaconf`, `lameenc`, `dora`, `einops`, `filelock`, `fsspec`, `cloudpickle`, plus more.

Roughly **half the analyser modules** import `librosa` at the top of the file: `analyze.py`, `ai_detector.py`, `separator.py`, `click_detector.py`, `tonal_issues.py`, `masking.py`, `transient_density.py`, `engineer_profile.py` (deep-scan path), `atmos_comparator.py`, `reference_quickscan.py`, `hum_detector.py`, …

**Result:** every Windows analysis crashes with `ModuleNotFoundError: librosa`. The Windows ZIPs we've shipped from 5.0.7 onwards (every Windows release) cannot perform any audio analysis.

**Fix:**
```yaml
./python-bundle-win/python/python.exe -m pip install `
  --no-warn-script-location `
  numpy scipy soundfile pyloudnorm librosa numba demucs julius openunmix
```
Bump the cache-key suffix `pybundle-win-py3.11.9-...-v1` → `-v2` so the cache rebuilds with the new packages.

### W2. RTMprofile Windows build ships no Python at all
**Severity: P0 (functional blocker)** · **Effort: 15 min**
**Where:** [`rtm-profile-app/package.json:44-60`](rtm-profile-app/package.json)

`extraResources` only ships `../python-bundle` (Mac). [`rtm-profile-app/electron/main.ts:24`](rtm-profile-app/electron/main.ts) tries to resolve `python-bundle-win` from `process.resourcesPath`, which doesn't exist in the NSIS installer. Resolution falls through to a hardcoded `'C:\\Program Files\\RTMcompare\\resources\\python-bundle-win\\…'` — but RTMcompare installs to `%LOCALAPPDATA%\Programs\RTMcompare\` (per-user) not `C:\Program Files\…`. So that fallback is dead too.

**Result:** RTMprofile on Windows fails at startup whether or not RTMcompare is also installed. The 1.0.6/1.1.0 "self-contained Python" achievement only landed on Mac.

**Fix:** add a Windows-conditional `extraResources` entry mirroring RTMcompare's. Ideally the workflow has the same `python-bundle-win` step run for the RTMprofile pack too.

### W3. `analyzePython` writes debug log to hardcoded `/tmp/rtm-debug.log`
**Severity: P0 (broken on Windows + minor info disclosure)** · **Effort: 5 min**
**Where:** [`electron/python-bridge.ts:271-274`](electron/python-bridge.ts)

Hardcoded POSIX path. On Windows either silently fails (caught by try/catch) or writes to `C:\tmp\rtm-debug.log` if it exists. Either way unusable for actual debugging.

**Fix:**
```ts
import { app } from 'electron'
const debugPath = path.join(app.getPath('temp'), 'rtm-debug.log')
if (process.env.RTM_DEBUG) fs.writeFileSync(debugPath, ...)
```
While here, gate behind `RTM_DEBUG` — leaking spawn args + stderr tail to a world-readable temp file every analysis is also a low-grade info-disclosure (audit P0-W3 mirrors the parent F5 finding from the Mac audit).

---

## P1 — should fix soon

### W4. `cancelActiveAnalysis` uses POSIX signal semantics
**Severity: P1** · **Effort: 20 min**
**Where:** [`electron/python-bridge.ts:76-99`](electron/python-bridge.ts)

Node on Windows ignores the signal name and unconditionally `TerminateProcess`. The 1-second SIGKILL fallback is a no-op. **Worse:** Python child processes spawned BY Python (numba JIT, demucs torch worker, ffmpeg sub-spawn) are NOT killed — Windows has no process-group mechanism by default. Cancel often leaves orphans pinning the file.

**Fix:** on Windows, use `taskkill /pid <pid> /T /F` for the whole tree:
```ts
if (process.platform === 'win32') {
  execFileSync('taskkill', ['/pid', String(p.pid), '/T', '/F'])
} else {
  p.kill('SIGTERM')
}
```

### W5. `fs.watch(INCOMING_DIR)` unreliable on Windows; no recovery loop
**Severity: P1** · **Effort: 30 min**
**Where:** [`electron/main.ts:1102-1145`](electron/main.ts)

Windows `fs.watch` fires multiple events per write (rename + change pair on each `.ready` drop), can miss events when the user uses an SMB share or sleeps the laptop, and emits events with backslash separators that already pass the SAFE_INCOMING regex but make the 50 ms debounce fire 2–3× per drop. The 5.2.0 watcher hardening is correct on path-traversal, but on Windows the same `.wav` will be re-broadcast to the renderer multiple times.

**Fix:** switch to `chokidar` (already de-duplicates on Windows), or add an in-memory `Set<string>` of recently-broadcast basenames with a 1-second TTL.

### W6. NSIS contradictory: `perMachine:false` + `allowElevation:true`
**Severity: P1** · **Effort: 5 min**
**Where:** [`package.json:85-94`](package.json)

`perMachine:false` installs to `%LOCALAPPDATA%\Programs\RTMcompare\` (no admin needed); `allowElevation:true` then prompts for UAC anyway, which is the worst of both worlds (extra dialog for nothing) and confuses Defender SmartScreen reputation.

**Fix:** for an unsigned app, the per-user route is much better — set `allowElevation:false`. SmartScreen treats per-user installers as lower-risk. If/when an EV cert lands, revisit.

---

## P2 — backlog

### W7. `_rtm_formats` in CMake includes AU on every platform
**Severity: P2** · **Effort: 5 min**
**Where:** [`rtm-send-plugin/CMakeLists.txt:50`](rtm-send-plugin/CMakeLists.txt)

`set(_rtm_formats AU VST3 Standalone)` is unconditional. JUCE silently drops AU on Windows but the configure log is noisy and it slows the build.

**Fix:**
```cmake
set(_rtm_formats VST3 Standalone)
if(APPLE)
  list(APPEND _rtm_formats AU)
endif()
```

---

## Mac vs Windows posture (after 5.2.0/5.2.1 fixes)

The 5.2.0/5.2.1 **security** fixes are largely platform-neutral and DO reach Windows: watcher filename whitelist, `assertSafeAudioPath` extension gates, 256 MB stdout cap + 30-min watchdog, multi-job cancellation map, JSON-on-stdin declick-preview shim — all pure cross-platform TypeScript. The cohort-spread `curve_mad` fix in `python/engineer_profile.py:447-464` reaches Windows because it's pure-NumPy. CSP in `index.html` is a `<meta http-equiv>` tag and will be honored identically by Electron 33's Chromium on Windows.

Net: **security parity is essentially achieved**. **Functional parity is broken** — P0-W1 means the Windows binary doesn't even *get* to exercise most of the analysis paths the Mac audit covered, and P0-W2 means RTMprofile is dead on Windows. The Mac audit fixes are wasted effort on Windows users until P0-W1/W2/W3 land.

## First-run experience delta

A Windows user gets:
1. SmartScreen "Windows protected your PC" modal (one-click "More info" → "Run anyway") — expected, called out in README
2. 1–3 minute Defender real-time scan of the unpacked ~700 MB python-bundle on first launch (partially mitigated by the splash window, but slower than Mac quarantine clearance)
3. A UAC prompt from W6 for what looks to the user like a per-user installer that "shouldn't need admin"
4. **No working analyser.** They'll see "Analysis failed (exit code 1): ModuleNotFoundError: No module named 'librosa'" — or worse, the friendly mapped error that swallows the actual cause and tells them to "report a packaging issue"

Until P0-W1/W2/W3 ship, the Windows download is functionally a paperweight.

---

## Recommended hot-fix: 5.2.2 today

P0-W1 + W2 + W3 are all CI/config edits, no code logic changes, no risk of regression for Mac. Scope:

1. Extend Windows pip install in [`build-windows.yml`](.github/workflows/build-windows.yml) (5 lines)
2. Add Windows `extraResources` entry to [`rtm-profile-app/package.json`](rtm-profile-app/package.json) (~10 lines)
3. Add a CI step to build python-bundle-win for the RTMprofile pack too (~20 lines, mostly copy-paste from the RTMcompare step)
4. Path-fix the debug log + gate behind `RTM_DEBUG` (3 lines)
5. Bump versions to 5.2.2 / RTMprofile 1.1.1
6. Tag, push, monitor the workflow, download, verify
7. Re-pack Mac (just so the version stamp matches across both platforms — no actual code change there)

Estimated total: ~90 minutes including verification.
