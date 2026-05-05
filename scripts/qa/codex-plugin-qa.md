# Codex consult — RTM Send plug-in full QA pass

**RTM Send** is a JUCE-based VST3 / AU / AAX / Standalone plug-in
that sits on a track in the engineer's DAW and renders the last
N seconds of that bus to a `.wav` plus a sidecar `.rtm.json`,
dropping the pair into `~/.rtm/inbox/` so RTMcompare picks it up
within ~1 second. Source lives at `rtm-send-plugin/`.

We're days from a beta cohort expansion. The plug-in MUST work
flawlessly across all major DAWs. Beta testers will not give us a
second chance if it crashes or silently fails.

Be unforgiving. Honest > flattering. Find every real-world failure
mode, not theoretical concerns.

## What's there to audit

- `rtm-send-plugin/CMakeLists.txt` — JUCE build setup (VST3 / AU / AAX / Standalone targets)
- `rtm-send-plugin/Source/PluginProcessor.{h,cpp}` — audio engine, ring buffer, sidecar writer, file-system inbox protocol
- `rtm-send-plugin/Source/PluginEditor.{h,cpp}` — UI: capture-length slider, route picker, send button
- `rtm-send-plugin/Source/RingBuffer.h` — lock-free ring-buffer (real-time safety boundary)
- `rtm-send-plugin/Source/RtmAraDocumentController.{h,cpp}` — ARA integration (for DAWs that support it: Live, Logic, Studio One, etc.)
- `rtm-send-plugin/Source/RtmAraRegionsModel.h` — ARA region model
- Built artefacts at `rtm-send-plugin/build/RtmSend_artefacts/Release/{VST3,AU,AAX,Standalone}/`
  (last built **Apr 19** — pre-rebrand)

## Audit scope

### A. Real-time-thread safety (most-critical)

Audio plug-ins must never allocate, lock, or do file I/O on the
real-time thread. JUCE's `AudioProcessor::processBlock()` runs there.

For each `processBlock()` path in `PluginProcessor.cpp`:
- Find every allocation (new, malloc, std::vector::push_back, std::string concat, etc.)
- Find every mutex / spinlock / condition variable
- Find every file-system call (open, read, write, stat)
- Find every ObjectiveC / JUCE call that may allocate (e.g. juce::String)

Output: file:line for every violation, severity (P0 audio glitch / P1 crash risk / P2 latency).

Bonus: verify `RingBuffer.h` is actually lock-free and bounded.
Single-producer-single-consumer? Multi-producer? Atomic memory ordering?

### B. Cross-DAW compatibility matrix

For each supported host, what's known to work / break:
- **Pro Tools** (AAX) — bus-tap rules, AAX-specific `processAudio` quirks, PACE-signed-only distribution path
- **Logic Pro** (AU) — Logic's offline-bounce vs real-time, ARA capture path, sidechain handling
- **Ableton Live** (VST3 + AU) — Live 11 vs Live 12 quirks, "External Effect" routing, frozen-track behaviour
- **Reaper** (VST3) — multi-channel routing, pinned plugins, Reaper-specific JSFX hosting
- **Cubase / Nuendo** (VST3) — Steinberg-specific VST3 features, ARA in Cubase
- **Studio One** (VST3) — Studio One's strict VST3 conformance, plugin-blacklist behaviour
- **FL Studio** (VST3) — FL's mixer routing, FL-specific Save-As-Preset behaviour
- **Bitwig Studio** (VST3) — Bitwig's modular routing, multi-instance state

For each: known issues, configuration recommendations, bus types
to test. Cite JUCE forum threads / DAW manuals where relevant.

### C. ARA (Audio Random Access) integration

Live, Logic, Studio One support ARA. Our `RtmAraDocumentController`
exposes a region model. Audit:
- Are we correctly reading host playhead / time-signature / tempo?
- Region selection: does the plug-in read selected regions or all
  visible regions?
- Lifetime: are document/musical-time updates handled when the host
  edits the timeline?
- Crash modes when ARA is partially supported (e.g. Reaper's
  experimental ARA)

### D. File-system inbox protocol

The plug-in writes a `.wav` + `.rtm.json` pair to `~/.rtm/inbox/`.
RTMcompare's watcher reads them.

Audit the protocol:
- **Atomicity** — is the write `mv` from a temp file or could the
  watcher pick up half-written .wav? (Race condition on Live's
  freeze export scenarios.)
- **Filename collisions** — what happens if two sends fire within
  the same millisecond? UUID? Timestamp + counter? Retry-on-conflict?
- **Inbox cleanup** — does the plug-in clean its old captures, or
  does the user's `~/.rtm/inbox/` grow forever?
- **Cross-machine** — what if a user has the plug-in on a remote
  Pro Tools rig and RTMcompare on a Mac? (Today: works only same
  machine; should we surface that, or is there a network path?)
- **Sidecar JSON schema** — does it match what `RtmIncomingBanner.tsx`
  in the renderer expects? `route` field values, `meta` shape, etc.
- **Sandbox / TCC** — does the plug-in have permission to write to
  `~/.rtm/`? On Apple-notarised hosts (Logic, Pro Tools), TCC may
  prompt the user the first time. What's the UX?

### E. UI quirks

`PluginEditor.cpp` audit:
- Slider range / default / accessibility labels
- Route picker (single / compareB / batch / ref-only) — every value
  the renderer knows how to handle?
- Status label feedback on success / failure
- Button-disable during write (avoid double-fire)
- Keyboard accessibility

### F. Build / signing / distribution

- CMakeLists targets: are AU + VST3 + AAX + Standalone all reaching
  parity? Missing entitlements?
- Code-signing: macOS plug-ins need Developer ID, today they're
  unsigned (built Apr 19). What's the signing flow we'd add to
  the build?
- Notarisation: Apple notarisation for AU and VST3 — required for
  macOS 14+? At what level (per-bundle or whole installer)?
- AAX: PACE iLok integration is required to distribute. We don't
  have that today. What's the cost / effort?

### G. Rebrand carry-over

The host app renamed from "RTM Suite" → "RTMcompare". Plug-in source
still says "RTM Suite" in:
- `CMakeLists.txt:50` — COMPANY_NAME
- `Source/PluginEditor.cpp:28` — subtitle copy
- `Source/PluginEditor.cpp:62` — batch button tooltip
- A few comment references

Check whether changing `BUNDLE_ID "com.rtmsuite.rtmsend"` would
break testers' existing plug-in registration (DAWs cache plug-in
identity by UID/bundle). Recommend keep-or-change.

### H. Standalone vs plug-in parity

The Standalone target lets engineers run RTM Send outside any DAW.
- What's the actual use case for Standalone?
- Does it have a meaningful UX (file browser? real-time mic in?)
  or is it just a debug build?
- Should we drop Standalone entirely if it's not adding value?

## Output format

Three sections in this order:

### CRITICAL FINDINGS
P0 / P1 issues that would crash or silently fail in beta. file:line
evidence for each. Numbered list, ordered by severity.

### CROSS-DAW CHECKLIST
Per-DAW table. What works, what to test, what to fix before beta.

### REBRAND + DISTRIBUTION ROADMAP
Specific changes to make: rebrand strings, bundle-id decision,
signing flow, AAX iLok or skip-AAX decision. Effort estimates.

## Constraints

- Be specific. Cite file:line for every claim.
- You may run shell commands. Use them — open the .vst3 bundle,
  hex-dump the AU `.component`, run `pluginval` if available, grep
  for thread-safety bugs.
- Honest > flattering. If "real-time safe" is theatre because we
  allocate on processBlock, say so. If a DAW is too niche to test,
  say so.
- Under ~2500 words.
