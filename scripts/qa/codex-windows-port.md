# Codex consult — Windows beta build feasibility

## Context

RTM Suite v4.1.0 macOS dmg is signed + Apple-notarized + stapled and ready. We need a parallel **Windows installer** (`.exe`) for beta testers.

## Build environment
- Host: macOS 26.4.1 / Apple Silicon / 24 GB RAM. **No Wine installed.**
- electron-builder 26.8.1, electron 33, vite 8.
- macOS bundled Python lives at `python-bundle/python/bin/python3` (Python 3.11.15 arm64, ~680 MB on disk, with torch / librosa / demucs / numba / llvmlite / numpy / scipy / soundfile).
- **Windows Python bundle is NOT on this Mac.** The handoff (`release/v4.0-rc2/SESSION-HANDOFF-2026-04-26.md`) §8 references `python-bundle-win/ (821 MB)` as living on the prior Mac. Three sidecar tarballs are on this Mac (source / macOS-bundle / conversation JSONL) — the win bundle wasn't included. The handoff explicitly forbids `pip install` rebuilds: *"DO NOT try to rebuild from requirements.txt or pip install — the result will not match the verified-working bundle."*

## Beta-tester constraints
- Tolerable: SmartScreen warnings on first launch (no Windows code signing — Developer ID Authenticode cert isn't in keychain).
- Tolerable: per-tester ffmpeg install if Sound Check twin needs it (the macOS afconvert fallback in `python/encoded_preview.py:_resolve_aac_encoder` is macOS-only).
- Not tolerable: app fails to launch, can't find Python, or hangs on first analyzer run.

## What we need from you (the codex agent)

Read the codebase, then produce a **decision document** answering:

### A. Is the source Windows-ready as-is?
Audit these for Windows-platform branching:
- `electron/main.ts`, `electron/python-bridge.ts`, `electron/preload.ts` — path separators, Python spawn, env vars
- `python/encoded_preview.py` — the `_resolve_aac_encoder()` fallback chain on Windows
- Any hard-coded `/Applications`, `/Users/`, `~/Library`, `/usr/bin/...`, or POSIX-only assumptions in either layer
- Any code that shells out (analyzer launch, ffmpeg/afconvert calls, demucs separation, etc.)

Report file:line for each Windows-incompatible spot, classed as: **blocker / breaking / cosmetic**.

### B. What `package.json` changes are needed?
Currently the `build` block is mac-only. Propose the additions for a Windows target:
- `win`: `target` (NSIS recommended for testers — single-installer experience), `icon` (`build/icon.ico` exists, 62 KB), arch (`x64`).
- `nsis`: `oneClick: false`, `perMachine: false`, `allowToChangeInstallationDirectory: true` for testers.
- `extraResources`: how do we conditionally bundle `python-bundle-win/` for Windows builds vs `python-bundle/` for macOS? (electron-builder supports per-platform extraResources.)
- `files`: anything to exclude from the Windows build that's macOS-only?

Output: a complete proposed diff to `package.json` (just the `build` block).

### C. Cross-build feasibility on this Mac
Without Wine:
- electron-builder 26.x: which Windows targets cross-build cleanly from macOS?
- Will NSIS work without Wine, or do we need `--linux` / Docker / a real Windows host?
- If NSIS needs Wine, what's the lightest path to install just enough Wine to make this work?
- Alternative target candidates if NSIS is out: `portable`, `zip`, `appx`, `squirrel`.

### D. What does the user need to provide for the build to actually happen?
- The 821 MB `python-bundle-win/` tarball from the prior Mac (sidecar approach, like the macOS one).
- Tester ffmpeg note in the README?
- Anything else?

### E. Recommendation
One of: **proceed-with-caveats** / **proceed-after-bundle-arrives** / **do-not-ship-this-cycle**. Justify in 2-3 sentences.

## Constraints on your output

- Be specific. File paths and line numbers. Cite handoff sections by §.
- No code changes — diagnosis only. We'll act on your recommendation.
- Under ~600 words total.
