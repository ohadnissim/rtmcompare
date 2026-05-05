# Codex consult — Installer UX deep-dive + post-5.0 sanity check

You are reviewing **RTMcompare 5.0.x** the day after a multi-version
shipping spree. Two goals:

1. **Install/launch UX is BAD on Windows.** Beta tester just spent 30
   minutes trying to get the portable .exe to run. We need a concrete
   plan to fix this.
2. **Sanity-check everything we shipped this session.** Audit the
   build/sign/notarize pipeline, the bundled assets, and the renderer
   for anything broken or sub-optimal.

Be unforgiving. Honest > flattering. We're days from a beta cohort
expansion and the current Windows experience will burn testers.

## What's shipped right now

### macOS (5.0.0)
- `release/RTMcompare-5.0.0.dmg` — 341 MB
- Apple Developer ID signed: *Ohad Nissim (3RL52RHGT3)*
- Apple-notarized + stapled (notary id `f58928ad-47b7-48f3-8eea-a281e4435886`)
- Gatekeeper: `accepted — source=Notarized Developer ID`
- App name: `RTMcompare.app` (renamed from the old `RTM Suite.app`)
- Bundle id: `com.rtm.audiocompare`
- Hardened Runtime: yes
- userData path: `~/Library/Application Support/RTMcompare/`
- Bundled Python 3.11.15 arm64 at `Contents/Resources/python-bundle/python/bin/python3`
- afconvert used for AAC (Apple's built-in, zero deps)

### Windows (5.0.1)
- `release/RTMcompare-5.0.1-portable.exe` — **317 MB** (compressed; unpacks to 1.5 GB on launch)
- electron-builder portable target, self-extracts to `%TEMP%\<random>\` on every launch
- electron-builder's bundled mini-Wine signed everything via signtool.exe — but **no real Authenticode cert**, so SmartScreen flags every download as "not commonly downloaded"
- Bundled Python 3.11.15 win64 at `python-bundle-win/python/python.exe` (165 MB raw, ~110 MB compressed inside the .exe)
- **NEW:** bundled LGPL ffmpeg.exe (164 MB raw) at `python-bundle-win/ffmpeg/ffmpeg.exe` so Sound Check twin works out of the box

### Recent fix history (so you know what's already addressed)
- v4.1.1 fixed: Python pycache writes breaking signed bundle codesign on first run; Dropbox/cloud-sync paths blocked by an over-tight read-allowlist
- v4.1.2 added: silent-catch console.error coverage on 5 components; IPC handler validation harmonization across 10 path-taking handlers
- v4.1.3 fixed: sticky tab-strip offset (was at top:68px, header is ~92px)
- v5.0.0: rebrand RTM Suite → RTMcompare (single-word display, no `uppercase` CSS, case as-typed)
- v5.0.1 (Windows only): bundled ffmpeg

## The pain points beta tester surfaced today

1. **Downloaded broken file from Dropbox.** Only got a 505-byte placeholder; double-clicked it; nothing happened. Real file was 835 MB. No download-validation surface in our flow.
2. **SmartScreen flagged the .exe.** Not blocked outright — the "isn't commonly downloaded" yellow warning. Tester didn't know how to bypass; had to be walked through "More info → Run anyway."
3. **"Run anyway" then 1-3 min of nothing.** Defender scanning the 165 MB python.exe + 164 MB ffmpeg.exe + assorted DLLs in `%TEMP%`. Tester thought the app was hung. No splash, no progress, no taskbar entry, no feedback.
4. **Re-launch is slow.** Portable target re-extracts to `%TEMP%` every launch. Subsequent launches are NOT cached — same 1-3 min wait each time.
5. **No Start menu entry. No proper uninstaller.** Doesn't feel like a real app.
6. **App data leakage on uninstall.** When tester deletes the .exe, `%TEMP%\<random>\` and `~/.rtm/` are orphaned forever.
7. **macOS side: testers had stale `RTM Suite.app` in /Applications after rename.** Manual delete required. Old data at `~/Library/Application Support/RTM Suite/` orphaned.

## What you should investigate

### A. Windows installer target — concrete options

Evaluate each:

1. **NSIS** — the standard Windows installer. Stable Program Files install, Start menu shortcut, control-panel uninstaller. Defender doesn't re-quarantine bundled binaries from `Program Files`. **Question:** does electron-builder NSIS cross-build from macOS work in 26.x without a real Wine install? (codex previously found it bundles its own mini-Wine for signtool. Does that extend to building the NSIS installer itself?)
2. **Portable with `unpackDirName`** — keep portable, but set `GH_TOKEN`/`unpackDirName` so it extracts ONCE to `%LOCALAPPDATA%\RTMcompare\` and re-launches use that. Effort: low. Caveat: still no Start menu entry.
3. **Squirrel.Windows** — auto-update-friendly installer. More complex but enables in-app update prompts.
4. **MSIX** — modern Windows app package. Sandboxed, auto-updates via Microsoft Store or sideload. Locked to Windows 10/11.
5. **MSI** — enterprise-friendly. Group-policy deployable. Heavier setup.
6. **Hybrid: small bootstrap .exe + downloaded payload** — initial download is ~10 MB, downloads the ~700 MB Python+ffmpeg payload to a stable location on first run with a real progress bar. Way better UX. Effort: high.

For each: give your honest verdict (proceed / skip / proceed-after-X-condition) with effort estimate (hours), risk, and pre-requisites.

### B. Windows code signing

We're paying the SmartScreen tax with every download. Options:

1. **Azure Trusted Signing** (Microsoft's modern replacement for EV Authenticode) — ~$10/month + per-signature fees, 1-7 day publisher validation, no hardware token. Codex previously flagged this as the right call.
2. **OV Authenticode + cloud signing (SSL.com / DigiCert / Sectigo)** — ~$200-400/yr depending on cert and reputation. Standard Authenticode workflow.
3. **EV Authenticode** — ~$300-500/yr. Microsoft no longer guarantees instant SmartScreen bypass with EV per their current docs, but reputation builds faster.

For each: cost, setup time, integration work in our package.json / CI, and whether it makes the SmartScreen warning go away immediately or gradually.

### C. Launch UX improvements (regardless of installer choice)

The 1-3 min "is it hung?" silence is not OK. Investigate:

- Can we ship a tiny **early-launch splash** that appears immediately (within 1-2 sec) before the Electron renderer is ready? On macOS Electron has `BrowserWindow` ready quickly; the issue is mostly Defender + Python init.
- Can we **lazy-load** the bundled Python (analyzer) so the Electron UI launches fast and Python only spawns when the user clicks "Analyze"?
- Is the `python-bundle-win/python/Lib/site-packages/torch` bundle the slow path on first launch? (torch first-import is heavy.) Can we precompute its `.pyc` cache and ship it pre-warmed? (We already redirect numba cache to userData; can we also pre-warm torch?)
- Is the **portable's TEMP self-extraction** itself the slow path, or is it Defender? Have you got a way to measure?
- Can we add **explicit progress feedback** — "verifying signature… extracting Python… loading analyzer… ready" — anywhere in this chain?

### D. Sanity audit of the recent build pipeline

Audit, end-to-end, what we actually shipped this session:

- Did the `package.json` rebrand (`productName: "RTMcompare"`, `dmg.title: "RTMcompare"`) propagate cleanly? Anywhere still saying "RTM Suite" in user-visible places?
- Did the `assertSafeAudioPath` allowlist relaxation (4.1.1) and the IPC handler harmonization (4.1.2) actually get applied to all 10 listed handlers? Any new handlers added since that need the same treatment?
- Did the pythonSpawnEnv() (4.1.1) get wired into ALL 6 Python spawn sites in main.ts? Any missed?
- Did the sticky-tab fix (4.1.3 — `top: 92px`) survive the 5.0.0 rename rebuild?
- Is the bundled ffmpeg actually findable by `_resolve_aac_encoder()` at the runtime path it expects? (`Resources/python-bundle-win/ffmpeg/ffmpeg.exe` from the renderer's perspective.) Walk the path resolution.
- Are there any **new pain points** the user hasn't told us about that would trip a beta tester within the first 5 minutes of using the app?

### E. Distribution surface

- Where SHOULD the app be hosted for download? Direct from our domain? GitHub Releases (limit 2 GB per asset — fits)? Cloudflare R2?
- Should we publish public SHA-256s on a verifiable page so testers can validate downloads?
- Should we add an in-app update check (electron-updater) wired to a feed file we publish?

## Output format

Three sections:

### IMMEDIATE FIXES (next 24 hours)
The smallest set of changes that meaningfully improves the Windows beta-tester experience without a full installer rewrite. Effort hours, file:line specifics.

### MEDIUM-TERM (next 2 weeks)
Installer rewrite, code-signing onboarding, distribution surface. Decisions to make + tradeoffs.

### SANITY CHECK FINDINGS
Anything broken or sub-optimal you found in the audit (Section D). file:line evidence.

## Constraints

- Be specific. file:line, command, exact electron-builder option name.
- Cite electron-builder docs and Microsoft Authenticode/SmartScreen docs by URL where relevant.
- You may run shell commands. Use them — open the unpacked .exe, grep the pipeline, exercise the bundle.
- Honest > flattering. If a popular suggestion (e.g. "buy EV cert") is now obsolete, say so.
- Under ~2500 words.
