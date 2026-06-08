# Engineering — Senior Software Architect Review
## RTM Suite delivery-readiness: the architectural lens

**Scope of this lens:** I do not re-rule the bugs the three audits already found. I ask the
only question an architect can answer that they cannot: *are these bugs accidents, or are they
the predictable output of the current structure?* If the structure manufactures the bug class,
fixing the four cited instances ships a product that will re-grow the same defect on the next
feature. That distinction changes the ship sequence.

---

### 1. The bugs are not independent — they are one architectural defect, four times

Audit 2's "1% insight" (scalar-certainty) is correct but under-stated: it is not a *coding*
pattern, it is a **missing architectural boundary**. Trace the four worst customer-facing
correctness bugs and they collapse to the same root:

| Audit finding | File:line | Root cause (architectural) |
|---|---|---|
| AAC ISP verdict on mono downmix | `encoded_preview.py:246/255/290/297` | DSP primitive returns a bare `float`; no type carries "this number is a mono-sum, not per-channel" |
| In-band sentinels rendered as real numbers | `comparator.py:72,90,165,350,372` → `AnalysisView.tsx:2120` | `-70.0` is a *valid float*; the UI cannot distinguish "measured −70 LUFS" from "could not measure" |
| ViSQOL in 16k speech mode | `comparator.py:1915` | no provenance field records *which model/config* produced the score |
| RTMprofile constant match-score | `engineer_profile.py:1005` | cosine-on-dB returned as a confidence with no validity/range guard |

Every one is the **same missing thing**: a measurement crosses the Python→IPC→React boundary as
a naked `number`, stripped of the four facts that make a meter trustworthy — *is it valid, what
does it represent (mono/stereo/channel), how was it computed, how confident.* The codebase
already proves it knows this matters: `_stamp_spec_versions()` (`comparator.py:26`) bolts
provenance onto the **result envelope**. The architecture has provenance at the top level and
*nothing* at the measurement level. That gap is the bug factory.

**Architect's verdict on sequence:** fixing the four cited call-sites is necessary but is a
**patch, not a fix.** The fix is one boundary type. See §3.

---

### 2. `comparator.py` is a god-module — and it is *why* the verdict bugs hide

2,635 lines, 50+ top-level functions, importing concerns that should never share a file:
- **DSP primitives** (`_bs1770_k_weight`, `_true_peak_and_overs`, `compute_lufs`)
- **verdict logic** (`analyze_category`, `generate_overall_insights`)
- **recommendation prose** (`_compression_rec`, `_limiter_rec`, `_stereo_rec` — these write
  customer-facing English like "ease compression")
- **orchestration** (`run_fast_analysis`)

Eight other modules `import comparator`. This is the coupling that let the mel-L1 "quality" label
(Audit 1) and the sentinel-acted-on-as-advice (Audit 2, `_compression_rec` consuming a −70 LUFS)
ship undetected: **the layer that decides "is this number real" and the layer that writes
"ease your compression" are the same 2,635-line file with no seam between them.** You cannot unit-
test "does the recommender refuse to act on an invalid measurement" because there is no interface
to mock the measurement as invalid.

Worse, the **TP/oversample primitive is duplicated across 10+ files** (`apply_eq.py`,
`atmos_comparator.py`, `analyze.py`, `encoded_preview.py`, `limiter_artefacts.py`, …). Audit 1's
"soxr-vs-resample_poly 0.3–0.5 dB fork between installs" is not a dependency quirk — it is the
**inevitable result of N copies of true-peak math drifting**. There is no single
`truepeak.py` owning the one correct 4× implementation. Two customers on two machines get two
different PASS/FAIL verdicts on the same file. For a tool whose *entire value proposition is being
the trustworthy number*, duplicated measurement primitives is a HARD-CONSTRAINT violation
(constraint a), not a refactor nicety.

---

### 3. The minimum architectural bar to ship paid — a `Measurement` envelope + one DSP core

This is a **strangler-fig** move, not a rewrite. It is small, it preserves behavior, and it is the
cheapest way to make the four bug-fixes *stay* fixed:

**3a. Introduce one boundary type (Python dataclass → identical TS type):**
```
Measurement = { value: float|None, valid: bool, reason: str,
                domain: "mono"|"per_channel"|"stereo_sum", provenance: str }
```
- Make `compute_lufs`, `_true_peak_and_overs`, `compute_visqol_score`, the AAC ISP path, and the
  RTMprofile score **return `Measurement`, not `float`.** This is mechanical and touches ~10
  functions.
- The sentinel bug **cannot recur**: `-70.0` becomes `{value:None, valid:False, reason:"clip too
  short"}`. The UI renders "—" because it is *forced* to branch on `.valid`. The recommender
  (`_compression_rec`) early-returns on `valid==False`.
- The mono-downmix ISP bug **cannot recur**: `domain` makes it a type error to emit a per-channel
  compliance verdict from a `domain:"mono"` measurement.
- The ViSQOL config bug **cannot recur silently**: `provenance:"visqol-48k-audio"` is asserted at
  the verdict gate.

**3b. Extract `dsp_core/` — one owner per primitive.** Move the single correct `truepeak`,
`kweight`, `loudness` implementations into one module; delete the 10 copies; everyone imports it.
This *is* the fix for the soxr fork (Audit 1 MED) — pin one resampler in one place.

**3c. Carve `comparator.py` along the seam that already exists conceptually:**
`dsp_core/` (primitives) → `analysis/` (category scoring) → `verdict/` (pass-fail + recommender
prose). The recommender becomes a pure function of `Measurement[]`; it physically *cannot* read a
raw float. This is the modularity that makes Audit 3's pre-ship gate (≥95% specificity / ≥90%
sensitivity) **testable** — you can now feed synthetic `Measurement` fixtures to `verdict/` in
isolation.

**Effort honesty:** 3a is ~2–3 days and is the load-bearing change. 3b is ~2 days. 3c is the
strangler boundary — start it, do not finish it before ship; wrap the god-module behind the new
interfaces and migrate function-by-function post-launch. Behavior is preserved throughout because
`Measurement.value` carries the identical number the old `float` did.

---

### 4. Net-new architectural risks the three audits did not surface

- **No vendored-JUCE pin = non-reproducible build (HARD-CONSTRAINT b).** Audit 1 flagged the
  repaint fix as "unverifiable." Architecturally it is worse: `JUCE/` is a sibling git checkout,
  not a submodule pinned in `rtm-send-plugin`. A clean CI checkout on the Windows/Linux cross-
  build (`build-win-cross/`) can pull a *different JUCE SHA* and silently reintroduce the white-
  screen, and the forked module patch can vanish. **Before any paid ship: vendor JUCE as a pinned
  submodule/commit and assert the fork patch is in-tree.** This is a one-hour fix that closes a
  cross-platform reproducibility hole the bug-audit cannot see because the bug is *absence of a
  pin*, not a line of code.

- **Two Python invocation paths = two code paths to the same verdict.** `python-daemon.ts`
  (persistent JSON-RPC) and `python-bridge.ts` (spawn-per-analysis fallback) are both live. Audit
  1's "streaming dead-band path disagreement" is the daemon-vs-spawn divergence surfacing. Two
  paths means a bug fixed in one can persist in the other, and a customer silently hits whichever
  their machine fell back to. **Make the daemon the single path; keep spawn only as a hard-fail
  diagnostic, not a silent functional fallback.**

- **4.5 GB dead ML weights bundled (Audit 2) is also a license/SBOM surface.** Shipping weights
  for a separator that does not exist is not just bloat — every bundled artifact is a license
  obligation under HARD-CONSTRAINT (c). Dead weights = unaudited license exposure in the installer.
  Remove before distribution, not after.

---

### 5. Division verdict (Engineering — Architecture)

**CONDITIONAL NO-SHIP as-is; SHIP after the §3a envelope + §3b dsp-core + §4 JUCE pin + the four
Audit-1/2 fixes land.** I concur with the audits that the product is not shippable for paid
delivery today. I add one structural condition they did not: **shipping only the four point-fixes,
without the `Measurement` envelope and the single dsp-core, ships a product that will re-grow the
exact same trust-defect on feature N+1 — and the next instance will reach a paying customer before
you catch it.** The point-fixes are the patch; the envelope is the fix; they cost ~1 week combined
and that week is the difference between "we fixed four bugs" and "this class of bug cannot recur."

**On GTM (Board Q3):** the architecture *favors* the certification-layer pivot Audit 2 proposed —
but only **after** §3a. The `Measurement` envelope with `valid/provenance` fields IS the data model
a C2PA-signed delivery cert serializes. Do not pivot first; build the envelope (which you need to
ship the meter anyway), and the pivot becomes a serialization layer on top, not a rewrite. The
envelope is the single investment that de-risks both the ship-now and the pivot paths.

**Single biggest company risk if shipped as-is (Board Q4):** not any one bug — it is that the
*structure guarantees the trust-defect recurs faster than QA catches it*, and the product's only
moat is trust. The first time two customers get two different PASS/FAIL verdicts on the same file
(the duplicated-truepeak fork, §2), the "trustworthy meter" positioning is dead and cannot be
re-earned with a patch.

**Highest-priority recommendation:** introduce the `Measurement{value,valid,reason,domain,
provenance}` envelope and force the LUFS/true-peak/ViSQOL/AAC-ISP/profile primitives through it
(§3a). It is the one change that simultaneously fixes the sentinel bug, the mono-downmix ISP bug,
the ViSQOL-config bug, makes the pre-ship test gate possible, and becomes the data model for the
certification pivot.
