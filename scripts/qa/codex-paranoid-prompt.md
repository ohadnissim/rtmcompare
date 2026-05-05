# Codex Paranoid Scan — RTM Suite v4.0

You are running a paranoid QA / beta-test pass on RTM Suite v4.0 — a macOS
audio QC + mastering app (Electron + React + Python DSP).  Goal: find
every shipping bug, verify every numeric calculation against independent
ground truth, and recommend tightenings even where the math is "correct
but loose".

## Environment

- Source: `/Users/ohadnissim/Compare App`
- Installed app: `/Applications/RTM Suite.app` — already rebuilt with the
  latest source tree (BUG 1, BUG 2, BUG 3, BUG 4, engineer-curve level-
  align all expected to be in this binary).
- Driver for UI sweep: `scripts/qa/cdp_drive.py` (Chrome DevTools Protocol
  over WebSocket; ports already wired).  Launch RTM with:
  ```
  open -n /Applications/RTM\ Suite.app --args \
       --remote-debugging-port=9222 '--remote-allow-origins=*'
  ```
- Python (with PIL, numpy, soundfile, pyloudnorm via system `python3`):
  `/usr/bin/env python3` and the bundled
  `/Applications/RTM Suite.app/Contents/Resources/python-bundle/python/bin/python3`
- Methodology reference: `scripts/qa/paranoid-scan-prompt.md` — read it
  first, then come back here for app-specific slots.
- Final report path: `release/v4.0-rc2/qa-codex-paranoid.md`

## Three required outputs in the report

### 1. BUGS

Walk every reachable surface (Upload, RefOnly single-file analysis,
Compare two-file analysis, Batch / Album, Reference Library modal,
keyboard-shortcut overlay, Master Assistant tabs, A/B player), driving
the app via CDP.  Hook `Runtime.exceptionThrown`, `Runtime.consoleAPICalled`,
`Log.entryAdded`, and `Network.loadingFailed` events into a rolling buffer
BEFORE you click anything.

For each surface:
1. Screenshot the entry state.
2. Enumerate every visible interactive element (buttons, inputs, drop
   zones, mode pills, profile dropdown, tabs).
3. Click each, wait for settle, capture: new URL/state, console
   activity during the window, failed network requests, exceptions,
   visible NaN / undefined / null / `[object Object]` / un-substituted
   placeholders.
4. Try forms (where applicable) with: empty submit, very long input,
   pasted Unicode incl. RTL + emoji, leading/trailing whitespace.
5. Diff state: was the transition expected?

Specifically verify the four shipped fixes actually behave correctly:

- **BUG 1 (rtm-incoming-clear data loss)** — drop a fake WAV into
  `~/.rtm/inbox/`, click the "Clear inbox (N)" button on the floating
  banner chip, confirm the WAV is **NOT** deleted from disk.  Old
  behaviour: file got `unlink`ed.
- **BUG 2 (banner state stomp)** — drop a sidecar `.rtm.json` with
  `{"route": "single"}` next to a WAV in `~/.rtm/inbox/`.  Click an
  entry from "Recent analyses" so File A is set, then click "Analyze
  Reference Only".  Confirm the state transitions to RefOnly view and
  **stays there for at least 30 s** (the old bug bounced state back to
  Upload one frame after RefOnly rendered).
- **BUG 3 (SONG INFO position)** — load any file into RefOnly, scroll
  the page, confirm SONG INFO sits at heading position 2 of the section
  list (immediately after the DAW banner), not buried at position ~14.
  Use `document.querySelectorAll('h2,h3')` to enumerate.
- **BUG 4 (mono-compat phase_penalty)** — generate three synthetic
  WAVs:
    1. anti-phase 60 Hz bass (`L=+sin, R=-sin`) → expect mono risk
       very high in the 20–100 Hz band, near zero elsewhere
    2. independently decorrelated pink-noise L/R → expect mono risk
       ≈ 0 across all bands (this is the beta-tester false positive
       the fix targets)
    3. identical L=R (`corr=+1`) → expect mono risk = 0 everywhere
  Drive each through the RefOnly view and read the per-band risk
  values.  Log expected vs actual.

P0 = data loss / crash / blocks workflow; P3 = cosmetic.

### 2. CALCULATIONS

For every numeric metric the UI displays or the JSON return contains,
run an independent ground-truth check.  Don't trust the app's own code
for the truth value — derive it.

Generate ten golden synthetic WAVs (standard suite — see
`paranoid-scan-prompt.md`):

| # | Signal | Verifies |
|---|---|---|
| 1 | 1 kHz sine, stereo identical, −20 dBFS | LUFS-I (K-weighted), TP, correlation = +1, mono risk = 0 |
| 2 | Anti-phase 60 Hz bass | correlation = −1, mono risk high in 20–100 Hz |
| 3 | Independent pink noise L/R | correlation ≈ 0, mono risk ≈ 0 (BUG 4) |
| 4 | White noise calibrated to −14 LUFS | LUFS round-trip ± 0.1 LU |
| 5 | Deliberately clipped sine (peak 0 dBFS exact) | clip count > 0, TP ≥ 0 dBTP |
| 6 | 30-second silence | LUFS = −∞ / gate, TP = −∞, duration = 30.0 s |
| 7 | 120 BPM click track | tempo detection ± 1 BPM |
| 8 | 1 kHz sine with 4 Hz LFO amplitude swing ±6 dB | known LRA |
| 9 | Matched pair (rough mix + −0.5 dB copy) | level-matched compare → gain ≈ 0.5 dB, spectra agree |
| 10 | 30-s synthetic song stem | end-to-end smoke; no NaN / undefined |

Two execution paths — use both:

a. **Direct Python** — call the bundled analyzer head-on so you get the
   full JSON of every metric:
   ```
   /Applications/RTM\ Suite.app/Contents/Resources/python-bundle/python/bin/python3 \
     /Applications/RTM\ Suite.app/Contents/Resources/python/analyze.py \
     <wav> <wav> --fast --profile=off
   ```
   This bypasses the UI entirely.  Compare the JSON to ground truth.

b. **Via the UI** — for the same signals, drive the file into the
   Reference slot via CDP, run analysis, scrape the displayed numbers
   off the DOM, compare to the same ground truth.  Differences between
   path (a) and path (b) are display / formatting / rounding bugs.

Ground-truth derivations:
- **LUFS-I / LUFS-S / LUFS-M / LRA** — use `pyloudnorm` (system
  Python).  ITU-R BS.1770-4 compliant.  Tolerance ± 0.1 LU.
- **True Peak** — 4× polyphase upsample (or any clean oversampling),
  then `max(abs(y))`.  Tolerance ± 0.1 dB.
- **Sample peak / clip count** — exact (`max(abs(x))`, threshold-hit
  count on raw samples).
- **L/R correlation** — `np.corrcoef(L, R)[0, 1]`.  Tolerance ± 0.01.
- **Stereo width** — same formula RTM uses (verify visually).
- **Mono-compat per-band risk** — `phase_penalty * loss * impact`
  with `phase_penalty = max(0, -corr)`.
- **31-band spectrum** — band-power integration over FFT, compare
  bin-by-bin ± 0.5 dB.
- **BPM** — known from how you generated the click track.
- **Streaming-normalisation gain** — `target_LUFS − measured_LUFS`,
  clamped per platform spec.

For each (signal × metric) pair report: expected, actual, Δ, pass/fail.

Sanity-check (don't equality-assert) the ML-driven fields: AI/synthetic
detection confidence, genre, masking severity, engineer-tip copy,
tonal-character labels, key detection.  Flag impossible values
(confidence > 1.0, NaN, etc.).

### 3. TIGHTENING RECOMMENDATIONS

For each, write a block:

```
- Where:        path/to/file.ts:LINE  (or DSP step in python/*.py)
- Shown today:  exact value / formula / behaviour
- Weakness:     one sentence on what makes it fragile
- Proposed:     the tighter version (snippet if small)
- Evidence:     run the tighter version on a test case showing the
                displayed number changes in the expected direction
- Effort:       1–5 lines / ~1 h / ~half-day / ~day
- Value/effort: 1–10
```

Hunt specifically for:
- Fragile pivots / single-band normalisations (we already fixed two —
  see `src/lib/spectrumLevel.ts`; look for any others).
- Mean where median would survive outliers (LRA windows, tempo
  estimates, clip detection).
- Threshold defensibility (clipping = N consecutive samples? what's
  N?  TP-over alarms with rounding tolerance?).
- Smoothing / windowing inappropriate for signal length.
- Statistics that should be percentiles instead of max.
- Cross-metric coherence (does sum-of-line-items match the displayed
  total?).
- Locale / time-zone hazards in any displayed timestamp / number.
- A-weighting or perceptual-weighting opportunities — already applied
  in `src/lib/spectrumLevel.ts`; look for other places.

Rank tightening recommendations by **value/effort** descending.  Cheap
wins float to the top.

## Output format

```markdown
# RTM Suite v4.0 — Codex Paranoid Scan — YYYY-MM-DD

## Executive summary

- N bugs (P0 / P1 / P2 / P3 counts)
- M calculations verified, K failures
- R tightening recommendations

## Environment

- Build SHA / mtime of /Applications/RTM Suite.app/...
- Python bundle path
- CDP target

## Bugs

### BUG 1 — title — P[0–3]

(per-bug block)

## Calculations

(matrix table; one row per signal × metric)

### Verified
### Sanity-checked only

## Tightening recommendations

(ranked by value/effort)

## Unreachable surfaces

(things you couldn't drive — native dialogs, pickers, etc.)
```

## Anti-patterns — don't flag these as bugs

- React strict-mode dev warnings.
- 4xx responses on auth / probe endpoints that are expected.
- Empty states that render "—" or "N/A" intentionally.
- Console messages from third-party libs we can't control.
- Slow first-render of large spectrum SVGs (perf opportunity, not a
  bug).

## When you're done

- Save the report to `release/v4.0-rc2/qa-codex-paranoid.md`.
- Don't modify any source files.
- Don't run the rebuild (the app is already fresh).
- If you can't reach a surface, list it under "Unreachable surfaces"
  with the reason — don't silently skip.
- If you find a P0 that blocks the rest of the scan, stop, write a
  short interim report, and exit so I can fix it before continuing.
