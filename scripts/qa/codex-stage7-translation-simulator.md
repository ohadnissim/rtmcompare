# Codex prompt — Stage 7: Translation simulator

Build the translation simulator described in
`release/v4.0-rc2/ship-next-roadmap.md` section 2.2. Real-time
playback EQ + dynamics presets that approximate phone speaker /
earbuds / car / TV / club / laptop, applied to the A/B player so the
engineer hears a plausible playback target without leaving their
studio chair.

## Critical positioning — read this first

This is **simulation, not calibration**. Sonarworks SoundID Reference
owns calibration. RTM doesn't compete there.

The framing in copy and tooltips must be: "this is what a typical
iPhone speaker rolls off and limits to" — NOT "this is what your
customer's iPhone sounds like." The difference is legal-grade and
matters for trust posture (P008 from the competitive-analysis pain
points).

## What to build

### A. Preset registry — `python/translation_targets.py` (NEW)

Six presets, each a dict of EQ + dynamics + bandwidth + mono-fold:

```python
TRANSLATION_PRESETS = {
    "phone_speaker": {
        "name": "Phone speaker",
        "description": "iPhone-style internal speaker — mono, narrow band, heavy compression",
        "mono_fold": True,
        "highpass_hz": 200,      # nothing under 200 Hz survives
        "lowpass_hz": 8000,      # rolloff above 8 kHz
        "eq_bands": [
            {"freq": 1000, "gain_db": 3.0, "q": 1.0},   # midrange emphasis
            {"freq": 4000, "gain_db": 2.0, "q": 1.5},   # presence boost
        ],
        "dynamic_range_max_db": 12.0,  # heavy compression
        "noise_floor_db": -45.0,        # ambient room/hand noise
    },
    "earbuds": {
        "name": "Earbuds",
        "description": "Mass-market in-ear — bass boost, sibilance emphasis, near-field intimacy",
        "mono_fold": False,
        "highpass_hz": 30,
        "lowpass_hz": 18000,
        "eq_bands": [
            {"freq": 80, "gain_db": 4.0, "q": 0.8},      # bass shelf
            {"freq": 6000, "gain_db": 2.5, "q": 1.5},    # sibilance
            {"freq": 12000, "gain_db": 1.5, "q": 1.0},   # air shelf
        ],
        "dynamic_range_max_db": 18.0,
        "noise_floor_db": -55.0,
    },
    "car_stereo": {
        "name": "Car stereo",
        "description": "Mid-range emphasis — low-mid emphasis, road-noise SNR, 60 Hz roll, 14 kHz roll",
        "mono_fold": False,
        "highpass_hz": 60,
        "lowpass_hz": 14000,
        "eq_bands": [
            {"freq": 250, "gain_db": 2.0, "q": 0.8},
            {"freq": 2000, "gain_db": 1.5, "q": 1.2},
        ],
        "dynamic_range_max_db": 15.0,
        "noise_floor_db": -40.0,        # road noise
    },
    "tv_speaker": {
        "name": "TV speaker",
        "description": "Living-room TV speaker — heavy mid emphasis, dialog gate, 250 Hz HPF, 6 kHz LPF",
        "mono_fold": True,
        "highpass_hz": 250,
        "lowpass_hz": 6000,
        "eq_bands": [
            {"freq": 1500, "gain_db": 3.0, "q": 1.0},
        ],
        "dynamic_range_max_db": 10.0,
        "noise_floor_db": -50.0,
    },
    "club_pa": {
        "name": "Club PA",
        "description": "Subwoofer-anchored club system — sub boost, 5 kHz harshness, transient brick",
        "mono_fold": False,
        "highpass_hz": 25,
        "lowpass_hz": 18000,
        "eq_bands": [
            {"freq": 50, "gain_db": 6.0, "q": 1.0},      # sub boost
            {"freq": 5000, "gain_db": 2.0, "q": 1.5},    # harsh
        ],
        "dynamic_range_max_db": 8.0,    # squashed loud
        "noise_floor_db": -40.0,        # crowd / ventilation
    },
    "laptop": {
        "name": "Laptop speaker",
        "description": "MacBook-style internal — mid-only, zero sub, 12 kHz LPF",
        "mono_fold": True,
        "highpass_hz": 250,
        "lowpass_hz": 12000,
        "eq_bands": [
            {"freq": 1500, "gain_db": 2.5, "q": 1.0},
        ],
        "dynamic_range_max_db": 12.0,
        "noise_floor_db": -50.0,
    },
}
```

Tune each preset against actual measured responses where possible.
Cite measurement sources in comments. If you have to guess, say so.

### B. Web Audio chain in `src/components/ABPlayer.tsx`

Build a small EQ + dynamics chain that consumes the preset spec and
applies it to the A/B player's output:

- Pre-gain → HPF → LPF → cascade of peak EQ bands → DynamicsCompressor
  (with target dynamic range) → optional mono-fold (sum L+R / 2) → Out
- Each stage uses native Web Audio nodes (`BiquadFilterNode`,
  `DynamicsCompressorNode`).
- Build the chain once on preset switch, not per-frame.
- Apply to BOTH A and B players so the engineer can A/B same-preset.

### C. New tab in ABPlayer's channel selector

Currently `ABPlayer` has a stereo / Mid / Side / Mono / channel-iso
toggle group. Add a "Translation" tab that opens a sub-menu of the 6
presets. Selected preset wires the chain; "Off" tab tears it down.

Persist the selected preset in localStorage so re-opening the app
restores it.

### D. UI copy

The tab label says "Translation" with a small `?` tooltip:
> "How would this sound on a phone / earbuds / car / TV / club / laptop?
> These are simulations of typical playback responses, not calibrated
> measurements of any specific device. For room correction use
> Sonarworks SoundID Reference."

Each preset's row in the dropdown shows its description from the
Python registry.

### E. Port preset registry to TypeScript

`src/translationTargets.ts` mirrors `python/translation_targets.py`
so the renderer doesn't have to round-trip the IPC. Generate it with
the same `scripts/generate_specs.py` pattern from Stage 2 if Stage 2
ships first; otherwise hand-port it (it's small).

## Acceptance

- Six presets available in the Translation tab.
- Switching presets re-routes the Web Audio chain without audible
  artefacts (50 ms crossfade if you're playing).
- Mono-fold presets sum to mono.
- HPF / LPF / EQ all audibly correct against a 1 kHz sine + 80 Hz
  sine + 12 kHz sine reference signal.
- Tooltip copy matches the "simulation, not calibration" framing.
- Renderer typechecks.
- Append "Stage 7 landed" section to ship-next-roadmap.md.

## Constraints

- Don't run `npm run build` or `vite`.
- Don't add a heavy DSP library. Use native Web Audio.
- Don't change the JSON schema.
- Don't make any preset claim a specific device — keep all copy
  generic ("typical iPhone speaker," "mass-market earbuds").
- Tune presets sparingly. Better to ship a defensible six than a
  flashy twelve.

## Anti-patterns

- Don't try to model the entire physical playback chain. Six
  approximations are enough.
- Don't expose preset internals to users. The dropdown shows name +
  description only; engineers don't want to tweak EQ frequencies.
