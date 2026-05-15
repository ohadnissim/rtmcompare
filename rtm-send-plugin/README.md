# RTM Send — DAW plugin bridge into RTM Suite

A minimal JUCE plugin (AU / VST3 / AAX) that sits on your master bus.
One button. Click it, and the last 30 seconds of audio flowing
through the plugin is written to a drop folder that RTM Suite
watches — it loads the file automatically for analysis, reference
match, master-chain rendering, Sound Check twin playback, whatever
you need next.

## Why it exists

The #1 pain point the panel flagged in round 3 was "no plugin form."
Every other mastering tool (Ozone, Pro-Q, Insight) lives inside the
DAW as a plugin and auditions in-context. RTM is a standalone app —
which is good for the QC / delivery / library work, but means
context-switching when you just want "quick, how does this Apple-twin
sound right now?"

This plugin closes the loop without compromising RTM's architecture:

- **DAW side**: tiny plugin, ring-buffer of 30 s, writes WAV + sidecar
  when you click "Send".
- **RTM side**: file watcher + inbox, auto-load notification, same
  analysis pipeline.

No socket, no subprocess, no driver. Filesystem handoff. Works across
DAWs (Pro Tools, Logic, Ableton, Cubase, Reaper, Studio One) and
across sessions (plugin writes even when RTM is closed — RTM catches
up on next launch).

## Protocol

Plugin writes three files atomically into `~/.rtm/incoming/`:

```
rtm-<unix_ms>-<session_hash>.wav        # 32-bit float PCM, native SR
rtm-<unix_ms>-<session_hash>.rtm.json   # metadata sidecar
rtm-<unix_ms>-<session_hash>.ready      # zero-byte marker
```

The `.ready` file is written **last**, after the WAV has been flushed
+ fsync'd. RTM's watcher only processes files when the `.ready`
marker appears, guaranteeing we never read a partially-written WAV.

Sidecar JSON shape:

```json
{
  "sessionName": "Hennessy_v3 · master",
  "daw": "Logic Pro",
  "sampleRate": 48000,
  "channels": 2,
  "durationSec": 30.0,
  "createdAt": "2026-04-18T14:32:00Z",
  "pluginVersion": "1.0.0"
}
```

Every field is optional except `sessionName` (falls back to the WAV
filename if missing).

## Four audio sources (dropdown in the plugin)

Picking what to send matters as much as where it goes. The plugin
exposes four capture modes:

1. **Last N seconds (ring buffer)** — always available. The plugin
   keeps the last 5–120 s of audio flowing through the master bus in
   a lock-free ring. Click Send and the tail is snapshotted. Good
   for "quick, how does this chorus sound on Apple?" checks.

2. **DAW loop / selection region** — when the host exposes loop
   points (Logic, Pro Tools, Cubase, Reaper, Studio One, Ableton in
   Arrangement view), the plugin captures exactly the region your
   DAW loops across. Play through the loop once — the plugin records
   one full cycle and is ready to send.
   Requires `AudioPlayHead::getPosition()` + loop-point info (JUCE
   7.1+ API; falls back to the legacy CurrentPositionInfo for older
   hosts). If the host doesn't expose loop points, the UI greys out
   the mode and says so.

3. **Triggered region (Rec / Stop)** — works in every DAW, no
   transport cooperation needed. Hit Rec, play, hit Stop; whatever
   ran through the plugin between clicks is captured. Useful for
   hosts that don't share loop points and for capturing sections
   that cross loop boundaries.

4. **ARA region / marker** — *ARA2-hosting DAWs only* (Wavelab 10+,
   Studio One 5+, Logic 10.6+, Cubase 10.5+, Nuendo 10+, REAPER 6+).
   The plugin registers an ARA Document Controller; the host
   publishes every playback region + named marker in the current
   project. A dropdown shows:
     - Each region by name + time range + source name ("Track 03 ·
       0:42 → 3:14 · montage.wav").
     - Each pair of adjacent named markers ("■ CD Track 1 → CD
       Track 2 · 0:00 → 3:45 s").
   Pick one, hit Send — we read the source samples directly from
   the host (not from live playback), so you don't have to play the
   region back. Exact sample-accurate capture.
   Wavelab CD markers, montage clips, Studio One events, Cubase
   parts all materialise here. Pro Tools and Ableton don't host
   ARA2 and so don't expose this mode.

The selected source is persisted per-session.

## ARA2 module

When the ARA SDK is present at build time (see below), the plugin
builds as a dual VST3/AU plugin + ARA2 module. Hosts that don't
speak ARA just see a normal insert — nothing breaks. Hosts that do
get the region/marker dropdown for free.

### ARA SDK setup

```bash
git clone https://github.com/Celemony/ARA_SDK.git ../ARA_SDK
# or: export ARA_SDK_PATH=/path/to/ARA_SDK
```

With the SDK in place, CMake auto-detects it and enables ARA; look
for `-- ARA SDK found at … — ARA2 module will be built` in the
configure log. If the SDK is absent, CMake prints `-- ARA SDK not
found … skipping ARA2` and builds a ring-buffer / loop / triggered
version.

### What the plugin reads from the ARA document

- **PlaybackRegion** — every clip / region in the host's
  arrangement.  Each one becomes a dropdown entry with its start,
  end, and audio-source name.  This is the primary target for
  "send region X to RTM."
- **AudioSource** — the underlying file the region plays back.
  Sample data is read via the ARA audio-source reader on the UI
  thread (ARA explicitly designs this API for non-realtime access).
  No host playback required.
- **Named markers** — when the host exposes `kARAContentTypeMarkers`
  via the audio-source content reader, we aggregate them into a
  `Between markers` submenu.  Wavelab's Generic + CD markers
  surface here; marker access varies by host.

### What the plugin does *not* do via ARA

- Doesn't modify the host document (read-only).
- Doesn't request edit locks.
- Doesn't produce ARA edit state (nothing to persist — our entire
  job is to export a region to disk).
- Doesn't implement a custom editor view (stays in the plugin's
  own floating UI; we don't embed into the host arrange window).

### Fallback behaviour

If the user picks *ARA region* in a host that hasn't activated
ARA on this plugin instance (e.g. loaded in Pro Tools, or in an
ARA-hosting DAW that didn't enable the extension), the status line
reads "ARA not active in this host — the dropdown should be greyed
out" and the send fails cleanly.

## Two destination buttons

Once you've chosen a source, two Send buttons route the snapshot
into the right RTM surface:

- **Single-file analysis** — drops the bounce into RTM's reference-
  only view. LUFS / TP / spectrum / engineer tips / sound-check
  twin, no comparison needed.
- **Compare (→ File B)** — drops the bounce into Compare mode's
  File B slot, sitting alongside whatever reference is already
  loaded in File A. Instant A/B against a commercial reference or
  your library pick.

The routing hint travels in the sidecar JSON (`route: "single"` or
`"compareB"`); RTM's receiver auto-loads accordingly, no second
click.

## Ring-buffer design

The plugin keeps a circular buffer of the last `N = 30` seconds of
audio, sized for the plugin's native sample rate + channel count.
`processBlock` copies every incoming sample into the buffer (constant
time, no allocation). When "Send to RTM" is clicked, the UI thread
drains the buffer into a temp WAV while `processBlock` continues
unaffected.

Lock-free discipline: buffer uses an atomic write index; the UI side
reads a copy of the index + memcpy's out. No DSP interruption.

## Building

Requires JUCE 7.0.5+ and a recent CMake (3.22+).

### macOS

```bash
cd rtm-send-plugin
cmake -B build -G Xcode
cmake --build build --config Release
```

Outputs land in `build/RtmSend_artefacts/Release/`:
- `AU/RtmSend.component` → `~/Library/Audio/Plug-Ins/Components/`
- `VST3/RtmSend.vst3`     → `~/Library/Audio/Plug-Ins/VST3/`
- `AAX/RtmSend.aaxplugin` → `/Library/Application Support/Avid/Audio/Plug-Ins/` (requires signed PACE account + Pro Tools Developers key)

### Windows

```powershell
cd rtm-send-plugin
cmake -B build -G "Visual Studio 17 2022"
cmake --build build --config Release
```

Outputs:
- `VST3/RtmSend.vst3` → `C:\Program Files\Common Files\VST3\`
- `AAX/RtmSend.aaxplugin` → `C:\Program Files\Common Files\Avid\Audio\Plug-Ins\`

### Linux (VST3 only)

```bash
cd rtm-send-plugin
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
```

Output: `build/RtmSend_artefacts/VST3/RtmSend.vst3` → `~/.vst3/`

## Files

```
rtm-send-plugin/
├─ CMakeLists.txt          # JUCE CMake build
├─ Source/
│  ├─ PluginProcessor.h    # AudioProcessor — ring buffer + send
│  ├─ PluginProcessor.cpp
│  ├─ PluginEditor.h       # JUCE Component — single button + status
│  ├─ PluginEditor.cpp
│  └─ RingBuffer.h         # lock-free circular buffer
└─ README.md               # this file
```

## Configuration

Per-session, the plugin stores:
- Buffer duration (default 30 s; max 120 s)
- Session name (auto-filled from host track name when the DAW
  exposes it; override in the UI)

Stored in the DAW's plugin state so it survives session save/reload.

## Why 30 seconds

Long enough for the Sound Check twin to pick a meaningful window
(the twin itself auditions 30 s). Short enough that the buffer
doesn't chew memory — at 48 kHz stereo float, 30 s is ~11.5 MB.
Bumpable to 120 s via the preferences popover.

## Security

The plugin only writes to `~/.rtm/incoming/`. Never reads, never
networks, never touches the rest of the filesystem. RTM Suite's
watcher is the only consumer of that folder.
