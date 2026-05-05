# Paranoid QA Scan — Reusable Prompt

Paste this into a fresh Claude Code session, fill in the three `[FILL IN]`
slots at the top, and let it run.  It works for any app you can drive via
Chrome DevTools Protocol (Electron, any Chromium-based UI, any WebView)
or a similar inspection interface.

Drop this prompt into the chat **after** Claude has read-access to the
app's source tree and the app is launched with its debugging interface
exposed.

---

## Prompt starts here — paste from this line

You are running a **paranoid QA scan** against my app.  I want the kind
of scan that catches what I'd miss if I played through it myself —
systematic, instrumented, and unforgiving.

### What I'm giving you

- **App name**: `[FILL IN: e.g. "MyBudgetApp v2.3"]`
- **How to drive it**: `[FILL IN: e.g. "launched with --remote-debugging-port=9222 --remote-allow-origins=*"]`
- **Source tree**: `[FILL IN: e.g. "~/code/myapp — React + TypeScript + Express backend"]`
- **Ground-truth domain**: `[FILL IN: e.g. "budgeting math: compound interest, tax brackets, savings projections"]`
- **Where to land the report**: `[FILL IN: e.g. "~/code/myapp/qa/paranoid-scan-YYYY-MM-DD.md"]`

### Three outputs, in this order

Produce all three in one report.  Don't stop after bugs.

1. **BUGS** — broken behaviour, data loss risks, crashes, state
   corruption, visual regressions, accessibility failures, race
   conditions.  Severity P0–P3.
2. **CALCULATIONS** — every numeric output the app displays, verified
   against independent ground truth.  If the app says "you'll save
   $3,240", I need a golden-input test that says yes it really is
   $3,240 ± tolerance.
3. **TIGHTENING RECOMMENDATIONS** — places where the displayed output
   is technically correct but could be *tighter, more robust, more
   musical, more defensible*.  These aren't bugs — they're
   "I can make your app better" notes.  Skip this section at your peril;
   the best finds live here.

### Methodology — in this order, no skipping

#### Step 0 — Hook everything before touching anything

Before you click a single button, wire up global listeners:

- `Runtime.enable`, `Page.enable`, `Log.enable`, `Network.enable` via CDP
- Patch `console.error`, `console.warn` to push into a rolling buffer
- `window.addEventListener("error", …)` and `unhandledrejection`
- `Network.requestWillBeSent` + `Network.loadingFailed` streaming into the
  same buffer
- A frame-state poller you can query on demand: current URL / hash /
  main heading / visible route

You should be able to say "what happened in the last N seconds" at any
moment without re-instrumenting.

#### Step 1 — Inventory the surfaces

Before testing anything, build a map:

- Every distinct route / screen / modal / dialog the app can show
- Every interactive control per surface (`button`, `[role=button]`,
  `a`, `[tabindex]`, form inputs, custom components with click handlers)
- Every state transition that leads between surfaces

You end up with a graph.  Your sweep has to visit every node.

#### Step 2 — Sweep each surface paranoidly

For every surface:

1. Navigate to it programmatically (via CDP `Input.dispatchMouseEvent`,
   `Runtime.evaluate` + click, route push — whichever is cleanest).
2. Take a screenshot for the report.
3. Enumerate visible interactive elements.  For each:
   - Screenshot the element state before.
   - Click it.
   - Wait for the UI to settle (network idle, layout stable, no
     pending animations).
   - Capture: new URL, new DOM state, any console output during that
     window, any failed network request, any exception.
   - Screenshot after.
   - Diff: is this transition expected?
4. Check `document.body.innerText` for `NaN`, `undefined`, `null`,
   `Infinity`, `[object Object]`, un-substituted `{placeholder}` markers,
   stale relative dates ("in -3 hours"), missing translations.
5. Check for accessibility regressions: tab order, focus ring, aria-
   labels on icon buttons, contrast on overlaid panels.
6. For every form, try: empty submit, maximum-length submit, pasted
   garbage, Unicode including RTL and emoji, leading/trailing whitespace,
   number inputs with negative / scientific notation / currency symbols.

Surfaces that need state to reach (logged-in vs logged-out, empty-state
vs populated) get swept in every reachable state, not just the default.

#### Step 3 — Calculation verification

For every numeric metric the UI displays, write an independent
ground-truth computation in Python (or whatever is handy), then:

1. Generate / construct inputs where you know the right answer from
   first principles.
2. Drive the app to accept that input.
3. Read the displayed output via DOM scrape.
4. Compare actual vs expected, with a tolerance appropriate to the
   domain (usually 0.1–0.5 units or 1%).
5. Record pass/fail.

The ground truth **must not** come from the app's own code — otherwise
you're just checking the app agrees with itself.  Use the reference
implementation, the spec, or hand-derive.

For numbers that come from ML / subjective heuristics (sentiment, risk
score, confidence percentages), don't assert equality — assert
"impossible values" checks: nothing ever outputs 110% confidence, no
sentiment score outside [-1, 1], etc.

#### Step 4 — Tightening pass

Walk every displayed number a second time and ask:

- **Is the pivot / reference / anchor fragile?**  e.g. "normalised to
  the peak band" falls apart when one band is anomalous; "price vs
  yesterday" falls apart when yesterday was a holiday with no data.
- **Is the average the right average?**  Mean where median would
  survive outliers.  Arithmetic mean where geometric mean fits
  (compounding, ratios).  Unweighted mean where perceptual /
  importance / inverse-variance weighting would fit.
- **Are the thresholds defensible?**  Clipping at 1 sample vs 3+
  consecutive.  "Over the limit" at 0.01 above when the spec allows
  0.5 tolerance.  Temperature alarms that don't account for sensor
  noise floor.
- **Is the smoothing / windowing right for the signal length?**  FFT
  window for a 10 s clip vs 5-minute track.  Moving average on a
  daily-ingest dataset vs intraday.
- **Is the statistic robust?**  Max where 95th percentile would behave.
  Single-point measurement where a confidence interval belongs.
- **Cross-metric coherence**: do two fields that should agree actually
  agree? (e.g. sum of line items matches the total shown at the top).
- **Rounding hazards**: does a metric display fewer decimals than the
  threshold it's compared against?  `0.99` rounded to `1.0` then
  tested `>= 1.0` is a classic.
- **Locale hazards**: 12,345.67 vs 12.345,67; midnight rollover in
  non-UTC zones; DST transitions.

For each finding, write a recommendation block:

```
### [n]. [one-line title]

- Where:        path/to/file.ts:LINE  (screenshot if UI)
- Shown today:  exact value / formula / behaviour
- Weakness:     one sentence on what makes it fragile
- Proposed:     the tighter version — code snippet if small
- Evidence:     run the tighter version on a test case and show it
                changes the displayed number in the expected direction
- Effort:       1–5 lines / ~1h / ~half-day / ~day
- Value / effort score: 1–10
```

Rank by value/effort so the cheap wins float.  Do not be shy: if a
displayed number is "fine" but you'd be embarrassed to ship it as a
professional tool, flag it.

#### Step 5 — Cross-reference with known-fix-in-progress items

Before declaring anything a bug, check: is there already a fix on a
branch?  Is there a known-issue doc?  Avoid re-reporting things the
author already knows about.

### Output format (markdown)

```markdown
# Paranoid Scan — [APP] — [DATE]

## Executive summary

- N bugs (P0: ..., P1: ..., P2: ..., P3: ...)
- M calculations verified, K failures
- R tightening recommendations, ranked by value/effort

## Environment

- Build:      ...
- Platform:   ...
- Reached via: ...

## Bugs

### BUG 1 — [title] — P[0–3]

- Surface:       ...
- Reproduction:  step by step
- Root cause:    file:line
- Fix direction: ...
- Evidence:      screenshots, console, stack traces

(repeat)

## Calculations

Signal / Input × Metric × Expected × Actual × Δ × Pass

(table, one row per (input, metric) pair; flag failures in red text)

### Verified metrics

- LUFS-I, LUFS-S, True Peak, LRA, correlation, ... (tick each one)

### Metrics not verifiable (subjective / ML / no ground truth)

- ... (list + sanity check result)

## Tightening recommendations

Sorted by value/effort, descending.

### 1. [title] (score: 9/10, effort: 3 lines)

(recommendation block as above)

(repeat)

## Unreachable surfaces

Anything the scan couldn't cover (needs network, needs a real device,
native dialog can't be driven, etc.) — list so the user knows the blind
spots.
```

### Anti-patterns — things that look like bugs but aren't

- Console warnings from third-party libs you can't control (React
  strict-mode warnings, dev-only source-map errors).  Note them but
  don't flag as bugs.
- `document.activeElement === document.body` right after a route change
  (focus is intentionally reset).
- 4xx responses for endpoints that are expected to 4xx (auth probes).
- Empty states that render "—" or "N/A" on purpose.
- Debounced inputs that emit 0 requests during fast typing.

### What "done" looks like

- The report exists at the path I gave you.
- Every surface in the inventory has at least one screenshot.
- Every numeric metric in the UI has a pass/fail row in CALCULATIONS.
- TIGHTENING has at least 5 items unless the app is trivially small.
- You can point to the rolling console log and prove no exception
  fired unhandled during the whole sweep.

Don't hand me a half-done report.  If you can't reach a surface, tell
me which one and why.  If you're blocked on getting a calculation's
ground truth, tell me which one and propose how to get it.

If you find something I should fix before the rest of the scan makes
sense (e.g. "this crash blocks 40% of surfaces"), stop, tell me, and
wait.

---

## Prompt ends here

### Usage notes for me

- Adjust the `[FILL IN]` slots first.  If the app isn't CDP-driveable,
  replace the "How to drive it" line with whatever is appropriate —
  Playwright, Puppeteer, Appium, manually narrating through
  screenshots, an exposed test-harness CLI, etc.
- For non-audio apps, the calculation verification step still applies —
  just swap "LUFS / BPM / correlation" for "compound interest, tax
  brackets, retirement projection" or whatever your domain is.
- The tightening pass is the best part.  Resist any instinct to delete
  it when you tailor this for a small app — that's where you find the
  quiet improvements.
- The prompt assumes Claude has filesystem + bash access.  If using a
  sandboxed environment, expose CDP via a WebSocket the agent can call
  from bash, or adapt step 0.
