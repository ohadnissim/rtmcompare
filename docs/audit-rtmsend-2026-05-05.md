# RTM Send — multi-skill audit (2026-05-05)

Skills applied: **code-reviewer · senior-security · DSP/host-correctness**.
RTM Send is the C++/JUCE plugin (VST3 / AU / Standalone) at
`rtm-send-plugin/`. Companion to the RTMcompare and RTMprofile audits.

Most skills from the React-stack rubric don't apply here. The three
that do are concentrated on:
- C++ correctness (real-time safety, memory ordering, JUCE idioms)
- Plugin-host security (file-path safety in DAW process space, signed
  bundle integrity, privacy of host-supplied metadata)
- DSP/host-integration correctness (does the captured WAV actually
  match what played?)

This is a **higher-stakes audit than the React apps** — bugs here
either glitch audio in real time or write to disk under whatever
permissions the DAW host runs with.

---

## P0 — must fix before next signed release

### 1. Loop region capture is sample-inaccurate (±1 buffer on both ends)
**Source:** DSP audit
**Where:** `Source/PluginProcessor.cpp:135-174`
The capture starts on the first block where `curPpq >= loopStartPpq`, then copies the **entire input buffer from sample 0**. If the loop boundary lands mid-block (it almost always does — buffers are 64–2048 samples), you're prepending up to one full block of pre-loop audio and missing the equivalent at the end. At 48 kHz / 512-sample buffers that's ±10.7 ms of slop — audible on a tight loop, **fatal for any phase-coherent A/B against the source.**
**Fix (M effort):** compute `framesPerPpq = sampleRate * 60 / (bpm * ppqPerBeat)` from `pos->getBpm()` / `getPpqPositionOfLastBarStart()`; convert `(loopStartPpq - curPpq)` to a sample offset within the current block; copy from `getReadPointer(c) + offsetIn` for `(numFrames - offsetIn - tailExcess)` samples. Same trick at end.

### 2. Last-N seconds drops the OLDEST samples instead of trimming the deficit
**Source:** DSP audit
**Where:** `PluginProcessor.cpp:423-428`
When the ring isn't full, `got < wantFrames`. The code computes `drop = wantFrames - got` and **erases `drop` samples from the FRONT of the snapshot** — but `RingBuffer::readLastFrames` already returns exactly `n = min(want, capacity)` samples sized to `n` with leading silence padding. Net effect: the shipped WAV is shorter than requested AND missing its earliest content. This bites on the FIRST Send shortly after instantiation.
**Fix (S effort):** delete lines 423–428 entirely. `readLastFrames` already returns the correct buffer; trust its size.

### 3. `regionName` / `audioSourceName` written into JSON sidecar UNSANITISED
**Source:** senior-security
**Where:** `PluginProcessor.cpp:316-319`
`safeSession` (line 448) sanitises strictly for the *filename*, but `writeSidecar()` writes the raw `region->name`, `region->audioSourceName`, and `sessionName` as JSON values. A malicious `.als` / `.logicx` / Wavelab montage that names a clip something like `"};\n{"route":"single","sessionName":"<200KB of attacker JSON>"`... lands in RTMcompare's banner / batch table verbatim. If RTMcompare's TSX side ever does `dangerouslySetInnerHTML`, this becomes XSS in the receiver. Also: region names containing client/artist/song names leak verbatim (privacy gap, see P2).
**Fix (S effort):** apply the same `.retainCharacters()` whitelist (or length-cap + Unicode-normalize) to *every* host-supplied string before `setProperty()`. Cap at e.g. 200 chars.

### 4. Symlink-following on WAV / sidecar / `.ready` write
**Source:** senior-security
**Where:** `PluginProcessor.cpp:263, 325, 480`
`incomingFolder()` calls `juce::File::createDirectory()` without `O_NOFOLLOW` or post-create `lstat`. `out.createOutputStream()` and `replaceWithText()` likewise follow symlinks. Any process running as the user (another plugin, browser-downloaded malware) can pre-place `~/.rtm/incoming/rtm-20260505-*.wav` as a symlink to `~/.ssh/authorized_keys` or `~/Library/LaunchAgents/foo.plist`. Filename is partly predictable (timestamp + sortable session) so a watcher in the attacker's process can race the predicted name. **The plugin runs in the host's process space — no sandbox, no entitlements limiting writes to `~/.rtm/`.**
**Fix (M effort):** open with `O_NOFOLLOW | O_CREAT | O_EXCL` (POSIX) / `CREATE_NEW` + `FILE_FLAG_OPEN_REPARSE_POINT` reject (Win). Verify `incomingFolder()` itself isn't a symlink via `lstat` once at process start. Consider chmod 0700 on the folder.

### 5. Triggered-capture silently truncates beyond ring capacity
**Source:** DSP audit
**Where:** `PluginProcessor.cpp:156-164, 186-191`
When the capture exceeds the pre-reserved capacity, the audio thread silently drops samples (`headroom == 0 → toCopy = 0`). The user gets a WAV shorter than the captured region with **no warning surfaced** — `lastStatus` keeps showing "running…". Silent data loss for any loop or Rec span longer than `bufferSeconds`.
**Fix (S effort):** set an `std::atomic<bool> truncated` flag in the audio thread on `headroom == 0`; surface "Region truncated at N s — increase buffer length" in the editor and in the sidecar JSON.

---

## P1 — should fix soon

### 6. Ring buffer's release-on-every-frame is missing — torn snapshot risk on Apple Silicon
**Source:** code-reviewer
**Where:** `Source/RingBuffer.h:40,54,63`
Reader does `load(acquire)` (line 63), but the writer's per-block `store(release)` only synchronises at block boundaries — not per frame. On weak-memory architectures (ARM = current Apple Silicon target!) the reader can observe a stale `writeIndex` that points into samples being mid-overwritten on a lapped buffer, producing a torn frame. On x86 this works by luck of the memory model.
**Fix (S effort):** publish writeIndex at frame granularity, OR document the lapped-read risk and guard the snapshot path: read writeIndex twice and discard the snapshot if it changed by more than `capacity - n` samples.

### 7. `processBlock` calls `std::vector::insert` on the audio thread
**Source:** code-reviewer
**Where:** `PluginProcessor.cpp:163-165, 189-191`
The `headroom = capacity - size` clamp prevents a re-allocation, but `vector::insert` is still a non-real-time call: it touches the heap allocator's bookkeeping in some `libc++` builds (debug / ASan paths definitely allocate). This is the textbook real-time hazard.
**Fix (S effort):** replace with `std::memcpy` into the pre-reserved storage and a manual size bump, or use a fixed `juce::AudioBuffer<float>` plus a write index.

### 8. UI thread acquires `getCallbackLock()` to mutate the ring → defeats the "lock-free" claim
**Source:** code-reviewer
**Where:** `PluginProcessor.cpp:204, 237` (`setBufferSeconds`, `startTriggeredCapture`)
Acquiring the callback lock from the UI to serialise vector mutation is correct *for safety*, but it directly defeats the lock-free pitch. Dragging the buffer slider mid-playback glitches audio (every value change re-allocates `numChannels * cap * 4` bytes while `processBlock` is blocked).
**Fix (M effort):** double-buffered ring — build new ring on UI thread, atomically swap pointer; old ring is dropped on the UI thread on the next call. `processBlock` only does an `atomic load` of the ring pointer per block.

### 9. TOCTOU on `.ready` marker — unauthenticated drop channel
**Source:** senior-security
**Where:** `PluginProcessor.cpp:478-487`
Nothing binds the WAV / JSON / `.ready` triple cryptographically. Between plugin's `.ready` write and RTMcompare's open, *any* local process can replace the WAV with arbitrary audio (spoof the master being analysed). A free EQ plugin from a sketchy vendor in the same DAW session could log Send events, then race-rewrite the WAV to make a competitor's track score worse.
**Fix (M effort):** embed a SHA-256 of the WAV + JSON inside the `.ready` marker (1 line). RTMcompare verifies before opening. Bonus: HMAC-sign with a per-install secret in the Keychain.

### 10. Channel layout hardcoded stereo/mono — 5.1 / Atmos / quad rejected
**Source:** DSP audit
**Where:** `PluginProcessor.cpp:11-12, 75-82`
`BusesProperties` declares stereo only. A user dropping this on a 5.1 master either (a) won't see the plugin instantiate, or (b) the host downmixes silently before it arrives — capture is wrong and the user doesn't know.
**Fix (M effort):** add `withInput/withOutput` for `create5point1`, `create7point1`, `quadraphonic`; relax `isBusesLayoutSupported` to accept any matched in/out where channel count ≤ 32. Update sidecar JSON to include channel-layout name, not just count.

### 11. `incomingFolder()` writes break on macOS App Sandbox (Logic Pro X is sandboxed!)
**Source:** code-reviewer
**Where:** `PluginProcessor.cpp:242-248`
`createDirectory()` returns false silently. On sandboxed AU hosts, writes to `$HOME` go to the container, not actual home — so RTMcompare's watcher won't find them.
**Fix (S effort):** check `createDirectory()`'s `juce::Result`, surface a "RTMcompare can't see this folder under sandboxed Logic — disable sandbox or use the standalone build" message; consider `getSpecialLocation(commonApplicationDataDirectory)` as the canonical drop folder.

### 12. `setStateInformation` accepts NaN `bufferSeconds`
**Source:** code-reviewer
**Where:** `PluginProcessor.cpp:519`
Some hosts (Pro Tools, some Cubase) call this on a worker thread during session load. Plus the input is unvalidated JSON: `obj->getProperty("bufferSeconds")` on garbage returns 0.0 → `jlimit` clamps to 1.0 — okay, but `NaN` slips through `std::abs(s - bufferSeconds) < 0.01` (NaN compares false) and reaches `allocateRing` where `std::round(NaN * sr)` is implementation-defined.
**Fix (S effort):** `if (! std::isfinite(s)) s = kDefaultBufferSeconds;` before `jlimit`.

---

## P2 — backlog

### 13. Bit-depth: forced 32-bit float WAV with no 24-bit PCM option / no dither
**Source:** DSP audit
**Where:** `PluginProcessor.cpp:266`
Always 32-bit float. Mastering engineers expect 24-bit PCM as the canonical handoff. If anyone later changes 32 → 24, the path uses **truncation** with no TPDF dither.
**Fix (S effort):** expose "WAV format: 32f / 24-bit PCM" setting; on 24-bit, dither using `juce::Dither` or hand-rolled TPDF before the AudioFormatWriter.

### 14. Privacy: sidecar JSON exfiltrates client/artist/song names verbatim
**Source:** senior-security
**Where:** `PluginProcessor.cpp:278, 316-319`
`sessionName`, `regionName`, `audioSourceName`, host DAW description — all written plaintext. Mastering engineers commonly name sessions `"Beyoncé - Track 03 - mix v7 - confidential"`. If a user shares a `.ready`+`.wav`+`.json` triple (e.g. zips `~/.rtm/incoming/` for support), the JSON leaks NDA-protected names.
**Fix (M effort):** hash or truncate sensitive strings in the sidecar by default; offer a "verbose metadata" opt-in toggle. Strip absolute paths.

### 15. Memory disclosure: float NaN/Inf written to WAV from host garbage
**Source:** senior-security
**Where:** `PluginProcessor.cpp:269` (writeWav)
The WAV writer streams raw `float` samples — NaN / Inf / subnormals reach the file if the host feeds garbage. Not a classic info-leak but a fuzzing surface for the receiver's WAV parser.
**Fix (S effort):** `if (!std::isfinite(sample)) sample = 0.0f` clamp in `writeWav()` before writing.

### 16. No tests
**Source:** code-reviewer
No `.test.cpp`, no `juce::UnitTest` subclasses found in `Source/`. Audio plugins are notoriously hard to refactor without unit tests — the SPSC ring + bit-perfect capture + state serialisation are exactly the surfaces that *should* be covered.
**Fix (L effort):** add `juce::UnitTest` for RingBuffer (push/pop/lap/fill/empty) + a headless `processBlock` smoke test with synthetic input and an expected-output WAV diff.

---

## Bonus observations (not in top list)

- ARA pull path (`RtmAraDocumentController.cpp:131-158`) is **the cleanest part of the codebase** — sample-accurate by construction because it bypasses the realtime path entirely. Worth preserving its discipline as a reference for refactoring the live capture path.
- `idForRegion` casts pointer to hex as a "stable" id — survives only as long as the region object lives. Comment acknowledges this. Edge case but not a P-issue today.
- `bufferSeconds` clamp at `kMaxBufferSeconds=120` — correct.
- State deserialization is JSON-parse only, no eval-equivalent, bounds-checked enum — clean (modulo P1 #12).
- Cross-platform: source uses JUCE abstractions throughout — nothing Mac-only in the C++ code.

---

## Recommended sprint plan

**Sprint 1 (one week):** P0s 1–5 + P1 #6, #7. Net: capture is sample-accurate (loop + last-N), no silent truncation, host-supplied metadata sanitised, symlink races closed, audio-thread real-time discipline genuinely lock-free.

**Sprint 2 (one week):** P1s 8–12. Glitch-free buffer-resize, `.ready` integrity binding, surround support, sandbox compatibility fix, NaN guard.

**Backlog:** P2s 13–16. Bit-depth options, privacy, NaN clamp, unit tests.

**"Would I trust this in a mastering session" (DSP agent quote):**
> *Not yet — for the LastNSeconds path, no; for Loop, no; for ARA, mostly yes. Fix items 1 and 2 first; they're small surgical changes and they're the difference between a capture tool an engineer can phase-cancel against the source and one they can't.*

Translation for engineering planning: **the next RTM Send release should be 1.1.0 with these capture fixes, not a 1.0.x patch.** The version bump signals to existing 1.0.0 users that the captures they shipped before may not phase-cancel and shouldn't be trusted as ground truth for archival comparisons.
