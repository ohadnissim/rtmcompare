# Codex prompt — Stage 5: Finish codec audition

Finish the codec-audition feature scaffolded at
`python/encoded_preview.py` and `src/components/StreamingPreview.tsx`.
Per `release/v4.0-rc2/ship-next-roadmap.md` section 1.1, the scaffold
is in place — what's missing is the codec-delta visualisation, true-
peak-after-codec column, multi-platform parallel render, and A/B
audition-buffer swap.

This closes the MasterCheck Pro gap from the competitive analysis.

## What's already there (don't rewrite)

- `python/encoded_preview.py` (273 lines) — render AAC 256 kbps
  preview of loudest 30 s window at each DSP's normalisation gain.
  Currently AAC-only.
- `electron/main.ts` — `encoded-preview-render` IPC handler with
  cache-by-(path, DSP, window-offset).
- `src/components/StreamingPreview.tsx` (616 lines) — per-platform
  table.
- `src/dspProfiles.ts` — DSP target table.

## What to build

### A. Codec matrix per platform

Extend `python/encoded_preview.py` to render the right codec for each
platform, not just AAC:

| Platform | Codec | Bitrate |
|---|---|---|
| Apple Music | AAC | 256 kbps |
| Spotify | Vorbis | 320 kbps (or AAC 256 if ffmpeg lacks libvorbis) |
| Amazon Music | AAC | 256 kbps |
| Tidal | FLAC | (lossless, no audible delta — render anyway for round-trip) |
| YouTube | Opus | 160 kbps |
| TikTok | AAC | 128 kbps |
| YouTube Shorts | Opus | 128 kbps |
| Instagram / Reels | AAC | 128 kbps |
| Deezer | MP3 | 320 kbps |
| SoundCloud | Opus | 128 kbps |

Wrap codec selection in `python/encoded_preview.py` so the IPC handler
can pass a DSP id and get the right ffmpeg flags.

### B. True-peak-after-codec measurement

After the codec round-trip render, decode the output back to PCM and
measure its true peak with the same 4× polyphase oversampling RTM
uses for the source. Add to the JSON return:

```python
{
  "ok": True,
  "path": "/tmp/.../foo.aac",
  "dsp": "spotify",
  "codec": "vorbis",
  "bitrate_kbps": 320,
  "true_peak_after_codec_dbtp": -0.42,
  "true_peak_source_dbtp": -1.0,
  "tp_creep_db": 0.58,
  "spectral_delta_db_per_band": [...31 entries...],
  ...
}
```

`tp_creep_db` is the killer field: how much TP grew through the
codec. MasterCheck reports this because lossy codecs notoriously creep
peaks 0.5–1.5 dB above the source. Engineers staring at `-0.5 dBTP` in
the source thinking they're safe have no idea the codec output is
clipping. RTM should flag this front-and-centre.

### C. Codec-delta spectral visualisation

In `src/components/StreamingPreview.tsx`, add a "Codec delta" column
showing the per-band spectral change from source to codec output.
Render as a small inline 31-band sparkline per platform row.

### D. Parallel multi-platform render

Currently the IPC handler renders one DSP per call. Change the
renderer-side flow to fire all DSP renders in parallel (Promise.all)
and collect results. Codex's encoded preview render takes ~2-5 s per
platform with current single-thread Python — parallel render wins
real wallclock.

Cache by `(path, dsp, window-offset)` is already in place; that
naturally supports parallel callers.

### E. A/B audition swap

In `src/components/ABPlayer.tsx`, when the user clicks the
StreamingPreview row's "Audition encoded" button, swap the A-side
playback buffer to the codec output at the matching window offset.
The B-side stays on source. Engineer hears codec-vs-source A/B at the
same moment in the song with one click.

## Acceptance

- All 10 platforms in the table return non-zero `tp_creep_db` on a
  real master where appropriate (Tidal FLAC should be exactly 0).
- Spectral delta column shows visible per-band differences for
  AAC-128 platforms (TikTok, IG Reels), near-zero for Tidal FLAC.
- Parallel render completes 10 platforms in ≲ 8 s wallclock on the
  bundled Python.
- A/B audition swaps without clicks/pops — Web Audio buffer crossfade
  for 50 ms.
- Cached on second click — instant.
- Both source + installed Python patched, pycache cleared.
- Stderr clean on all 10 golden signals.
- Append "Stage 5 landed" section to ship-next-roadmap.md.

## Constraints

- Don't run `npm run build` or `vite`.
- Pin specific ffmpeg codec flags per platform with comments
  explaining the choice (cite Apple's AAC encoder choice, Spotify's
  Vorbis spec, etc.).
- If `libvorbis` isn't available in the bundled ffmpeg, fall back to
  AAC 256 with a note in the JSON return that it's a substitute.
- Don't change existing IPC contract — only add new fields.
- Don't break stderr cleanliness.
