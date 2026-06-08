# RTM Suite — Session State & Pickup Guide
_Last updated: 2026-06-08_

---

## Quick Orientation

| Product | Version | Status |
|---|---|---|
| **RTMcompare** | 8.4.0 | bug fixes committed (`0efcc58`); only build artifacts + this doc uncommitted |
| **RTMsend** | — | Paint fix is **in the installed AAX (May-19 build)** — still **awaiting one Pro Tools confirmation** |
| **RTMprofile** | 8.4.0 | rtmcompare:// URL fix **committed** (`0efcc58`) |

**The active thread**: RTMsend AAX not rendering in Pro Tools. Root cause identified, fix built into the May-19 install, signed, installed. The fix has NEVER been confirmed — no `EDITOR: paint` exists anywhere in `~/.rtm/rtmsend.log` (1461 lines, May 19→Jun 8) because the editor was never opened in PT since the fix. **Next action = manual PT test** (insert RTM Send → `tail -5 ~/.rtm/rtmsend.log` → expect `EDITOR: paint`).

### 2026-06-08 session notes
- **iPlug2 migration considered and REJECTED.** RTMsend is a JUCE plugin *host* (`AudioPluginFormatManager`/`KnownPluginList`/`createPluginInstance` → runs a 3rd-party EQ inside it, +848-line RPC server, +410-line ARA document controller). iPlug2 has no plugin-hosting or ARA infrastructure — migrating would mean rebuilding a slice of JUCE by hand. Decision: **keep the JUCE plugin as-is.** Reusable-from-PEAK = only the WebView UI shell + build/sign pipeline, not the DSP-host core.
- **Reconciled vs the old May-20 plan**: steps 3/4/6 (commit RTMcompare fixes, RTMprofile URL fix, RTMsend source) are all DONE in `0efcc58`. `rtm-send-plugin/Source/` is clean. Only the PT confirmation (step 1) and its downstream (strip logs, rebuild DMGs) remain.
- **No rebuild done/needed**: the build-dir AAX `Contents/MacOS/` binary is May-19 14:20 — same as the install. Don't waste the physical iLok re-signing unless the PT test fails.

---

## 1. RTMsend (AAX Pro Tools fix — TOP PRIORITY)

### Current state
The AAX plugin is **installed** at `/Library/Application Support/Avid/Audio/Plug-Ins/RTM Send.aaxplugin` (timestamp: May 19 14:19).

It includes:
- `wantsLayerBackedView() = false` — disables CoreAnimation layer (required for PT)
- **The repaint fix** — JUCE `viewMovedToWindow()` now calls `repaint()` after window becomes non-nil
- Diagnostic logs in `~/.rtm/rtmsend.log` (to be removed after confirmation)

### Root cause of the no-UI bug
Pro Tools' AAX wrapper calls `CreateViewContainer()` (which calls JUCE `addToDesktop()`) **before** the plugin's container NSView has been inserted into a real NSWindow. At that moment `[viewToAttachTo window] == nil`, so JUCE's `NSViewComponentPeer.window = nil`. JUCE's VBlank/CVDisplayLink callback skips `onVBlank()` when `[peerView window]` is nil, so `setNeedsDisplayInRect:` is never called and `drawRect:` / `paint()` never fires.

Later, when Pro Tools inserts the container into the window, AppKit fires `viewDidMoveToWindow`. JUCE's handler (`viewMovedToWindow()`) detects `nil→non-nil` and calls `component.setVisible(true)` — but the component was **already visible**, so it's a no-op. No repaint queued. Paint never fires.

### The fix (one line in JUCE)
**File:** `JUCE/modules/juce_gui_basics/native/juce_NSViewComponentPeer_mac.mm`, function `viewMovedToWindow()`:
```cpp
if (shouldSetVisible)
{
    getComponent().setVisible (true);
    getComponent().repaint();   // ← the fix: force repaint regardless of prior visibility
}
```

### Confirmation test
Open Pro Tools → insert RTM Send → `! tail -5 ~/.rtm/rtmsend.log`
→ expect `EDITOR: paint` in output.

### After confirmation: cleanup required
Remove all diagnostic log lines (they write to `~/.rtm/rtmsend.log`) from:
1. `Source/PluginEditor.cpp` — `paint()` log + `visibilityChanged()` impl
2. `Source/PluginEditor.h` — `visibilityChanged()` override declaration
3. `JUCE/modules/juce_audio_plugin_client/juce_audio_plugin_client_AAX.cpp` — `CreateViewContainer()` logs
4. `JUCE/modules/juce_gui_basics/native/juce_NSViewComponentPeer_mac.mm` — `addSubview` before/after logs (**keep the fix**)

Then: rebuild → `codesign --remove-signature` → `bash scripts/pace_sign.sh` → `sudo ditto ... /Library/Application Support/Avid/Audio/Plug-Ins/`

### Build & sign commands (quick reference)
```bash
cd "/Users/ohadnissim/Claude/Compare/Compare App/rtm-send-plugin/build"
cmake --build . --config Release

cd ..
codesign --remove-signature "build/RtmSend_artefacts/Release/AAX/RTM Send.aaxplugin"
bash scripts/pace_sign.sh

sudo ditto "build/RtmSend_artefacts/Release/AAX/RTM Send.aaxplugin" \
           "/Library/Application Support/Avid/Audio/Plug-Ins/RTM Send.aaxplugin"
```

### PACE signing facts
- Wrap config GUID: `E46358F0-520B-11F1-8F29-00505692AD3E`
- Account: `ohadnissim`
- Eden Tools **must be on physical iLok USB** (serial 286FAC), NOT iLok Cloud — verify with `iloktool cloud --status` before signing
- Always `codesign --remove-signature` first — wraptool can't override an existing Apple sig

### VST3 / AU — also installed (system-wide)
- VST3: `/Library/Audio/Plug-Ins/VST3/RTM Send.vst3` ✓
- AU:   `~/Library/Audio/Plug-Ins/Components/RTM Send.component` ✓

---

## 2. RTMcompare — v8.4.0

### Current state
- **Version**: 8.4.0 (last commit `a83c0c3`)
- **107 commits ahead of origin** — not pushed
- **28 files uncommitted** (all bug fixes from the v8.4.0 session)

### Uncommitted fixes (ready to commit)
All in `src/components/` — these are the bug fixes applied after the v8.4.0 feature commit:

| File | What changed |
|---|---|
| `ABPlayer.tsx` | Solo→play DSP glitch fixed: `disconnect()` (no-args) instead of targeted disconnect; unconditional pre-play solo cleanup; suspend AudioContext before EQPreviewPlayer starts |
| `EngineerTipsPanel.tsx` | Infinite render loop fixed: `(tips.eq_filters || []).map(clampEqFilter)` wrapped in `useMemo([tips.eq_filters])`; `EQPreviewPlayer` stop now calls `ctx.suspend()` before `ctx.close()` to stop DynamicsCompressor immediately |
| `GenreAnalysisPanel.tsx` | Changes from last session (inspect before committing) |
| `MasterAssistantPanel.tsx` | Changes from last session |
| `MatchTab.tsx` | Minor change |
| `learn/PANEL_INFO.ts` | Minor change |

Also uncommitted in other areas:
- `competitor-profiles/_summary.md` + 9 new competitor `.md` files (untracked)
- `electron/rtmsend-autoprofile.ts` — AU band-id regex fix (`/^(?:band\s*)?(\d+)[:\-\s]*$/i`)
- `scripts/build_bundle_dmg.sh` — DMG script updates

### Release artifacts (signed + notarized)
All in `release/`:
- `RTMcompare-bundle-8.4.0-arm64.dmg` — ✓
- `RTMcompare-bundle-8.4.0-intel.dmg` — ✓
- `RTMcompare-bundle-8.4.0-win.zip` — ✓

These include RTMcompare.app + RTMprofile.app + RTM Send VST3/AU/AAX.  
**Note**: The AAX in the 8.4.0 DMGs is the OLD build (before the Pro Tools fix). Rebuild DMGs after RTMsend fix is confirmed.

### Key architecture (for context)
- Frontend: Electron + React + TypeScript at `/Users/ohadnissim/Claude/Compare/Compare App/`
- Backend: Python (`python/comparator.py`, `analyze.py`, `atmos_qc.py`, `encoded_preview.py`)
- All A/B comparisons flow through `comparator.py → _attach_mastering_delta()`
- Learn mode: `METRIC_EXPLAINERS.ts` → `MetricExplainer.tsx`; `EYEBROW_TO_KEY` in `MetricCell.tsx`
- Audience system: `useAudience()` from `AudienceContext.tsx` → `'pro'|'producer'|'student'|'teacher'`

---

## 3. RTMprofile — v8.4.0

### Current state
- **Version**: 8.4.0
- **Built** (`dist/` present)
- **1 uncommitted fix**: `rtm-profile-app/electron/main.ts`

### Uncommitted fix
`rtmcompare://` URL handling — now locates `RTMcompare.app` directly via a candidate list and uses `open -a` instead of OS protocol-handler registration. This prevents the dev-mode Electron binary from intercepting the URL and showing the welcome screen.

Candidates checked (in order):
1. `/Applications/RTMcompare.app`
2. `~/Applications/RTMcompare.app`
3. Sibling of RTMprofile.app (DMG / release-build layout)
4. Parent of parent (deeper bundle layout)

### Also uncommitted
`rtm-profile-app/package.json` — version bump (minor, confirm before commit)

---

## 4. What to do next (priority order)

1. **Confirm RTMsend paint fix** — `tail -5 ~/.rtm/rtmsend.log` after inserting in Pro Tools
2. **Strip diagnostic logs** from RTMsend, rebuild, re-sign, reinstall (see cleanup list above)
3. **Commit RTMcompare bug fixes** — the 6 `src/components/` files + `electron/rtmsend-autoprofile.ts`
4. **Commit RTMprofile URL fix** — `rtm-profile-app/electron/main.ts`
5. **Rebuild DMGs** with the clean RTMsend AAX — `scripts/build_bundle_dmg.sh arm64` and `intel`
6. **Commit RTMsend source changes** (all the AAX debug work + JUCE patches)

---

## 5. Key file paths

| Item | Path |
|---|---|
| RTM Suite root | `/Users/ohadnissim/Claude/Compare/Compare App/` |
| RTMsend plugin source | `rtm-send-plugin/Source/` |
| JUCE (patched) | `JUCE/modules/juce_gui_basics/native/juce_NSViewComponentPeer_mac.mm` |
| JUCE AAX wrapper (patched) | `JUCE/modules/juce_audio_plugin_client/juce_audio_plugin_client_AAX.cpp` |
| RTMsend build dir | `rtm-send-plugin/build/` |
| PACE sign script | `rtm-send-plugin/scripts/pace_sign.sh` |
| AAX install location | `/Library/Application Support/Avid/Audio/Plug-Ins/RTM Send.aaxplugin` |
| Plugin debug log | `~/.rtm/rtmsend.log` |
| RTMprofile source | `rtm-profile-app/` |
| DMG build script | `scripts/build_bundle_dmg.sh` |
| Release folder | `release/` |
