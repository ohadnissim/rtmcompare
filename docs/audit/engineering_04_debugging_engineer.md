# Engineering — Persona 04: Senior Debugging Engineer

**Lens:** Live-production-incident debugging. The three prior audits already enumerated the bugs. My job is NOT to re-list them — it is to trace the *runtime mechanism* beneath each symptom, name the true root cause, surface the edge cases that the bug titles miss, and rule which proposed "fixes" will silently fail. I treat every customer-facing number as a potential incident report.

**Division verdict contribution:** NO-SHIP as-is. Beyond the known AAC mono-downmix blocker, I found a **release-reproducibility P0 that the audits could only flag as "unverifiable" — I can now rule it definitively as a defect: the JUCE fork containing the white-screen fix is NOT in the build path.** Plus three mechanism-level corrections that change how the must-fix list should be sequenced.

---

## 1. NET-NEW CRITICAL: the white-screen fix is not in the shipping build (rules AUDIT-1's "unverifiable")

AUDIT 1 said the JUCE repaint fix is "UNVERIFIABLE — JUCE not vendored; confirm forked module committed/pinned or a clean checkout reintroduces white-screen." I traced it to a verdict.

**Mechanism / evidence:**
- `JUCE/` exists on the dev machine's disk but `git ls-files JUCE` returns **empty** and there is **no `.gitmodules`**.
- `git check-ignore JUCE` → **`JUCE IS IGNORED`**. `.gitignore:71` = `JUCE/`.
- `.gitignore:76` comment: *"CI clones JUCE + ARA SDK..."* — so CI builds against **stock upstream JUCE**, not the dev machine's locally-modified tree.
- `git log -- JUCE` → empty: no fork commit exists in history.

**Root cause:** Any repaint/resize fix the developer made lives only as an *uncommitted local edit to a git-ignored directory*. The build that ships to customers is produced by CI from pristine upstream JUCE at an unpinned ref. **The fix is, with high confidence, NOT in the artifact.**

**Failure mode:** Two incidents, both customer-facing on day one:
1. **White-screen regression returns** in the CI/release build (the exact bug the dev believes is fixed), and is unreproducible on the dev's own machine — the worst class of "works on my machine" outage.
2. **Silent DSP drift across builds.** Unpinned upstream JUCE means a future CI run pulls a newer JUCE, and `dsp::Oversampling` / FFT / resampler internals can change → the *measurement numbers move between releases* with no code change. For a tool whose entire value is a trustworthy meter (HARD CONSTRAINT a), a meter that changes its reading when the toolchain updates is a category-killing defect.

**Robust fix direction:** Vendor JUCE as a **pinned git submodule** (exact SHA), commit the fork as a *patch file applied in CMake* (so the diff is reviewable and survives a submodule bump), and add a CI assertion that the patched symbol is present in the linked binary. Until the white-screen fix is provably in the CI artifact (headless launch screenshot in CI), RTMsend is not shippable regardless of the Python fixes.

---

## 2. AAC blocker — the mechanism is worse than "mono downmix" (compounding bugs at `encoded_preview.py:246/255/290/291/297`)

AUDIT 1/2 correctly flagged mono-downmix ISP under-read. Debugging the actual code path I found the verdict is corrupted by **three independent bugs stacked**, so even a naive "per-channel max" patch will still mis-certify:

1. **Mono downmix (`:246`, `:255`, `:290`)** — `y.mean(axis=1)` cancels anti-correlated L/R transients; hard-panned peaks read ~6 dB low. Known.
2. **`min(sr_dec, sr)` at `:291`** — the post-decode TP is computed with the *lower* of the two sample rates. If the decoder returns a different rate than requested, the 4× oversampling TP factor is applied against the wrong base rate → the TP axis itself is miscalibrated. AUDIT 1 listed this as LOW; in this function it is **part of the same pass/fail verdict** and is therefore CRITICAL here, not LOW.
3. **No encoder-delay compensation.** `ffmpeg ... pcm_f32le` decode (`:282`) does not trim AAC-LC priming (~2112 samples). `pre_tp` (`:256`) and `post_tp` (`:291`) are measured on **time-misaligned** signals. The delta the customer sees as "codec-induced overshoot" is partly a framing artifact, not the codec.

**Root cause class:** a binary pass/fail verdict (`:297`) emitted from a pipeline with three uncorrected systematic errors. **Edge case the audits missed:** a *dual-mono* master (identical L=R) downmixes losslessly, so it will appear to validate the "fix" in QA — masking that hard-panned content still fails. **Any test gate must include a hard-panned, anti-correlated transient fixture**, or the fix ships still-broken and passes its own regression test.

**Fix direction:** per-channel oversampled TP → `max` across channels; decode at native rate and *trim encoder delay before alignment*; never collapse `sr`.

---

## 3. NET-NEW mechanism: the +100 dB offset doesn't "cancel" — it *destroys* discrimination (`engineer_profile.py:1008-1012`)

AUDIT 2 said the paid match-score "saturates ~50/50". I traced *why*, because the inline comment at `:1006-1007` actively asserts the opposite ("the absolute offset cancels out") — a comment that will mislead whoever tries to fix it.

**Mechanism:** `arr = spec[i] + 100.0` over bands typically in ~[-60, -10] dBFS → vector components cluster in ~[40, 90], a near-constant positive vector dominated by a large common DC-like component. Cosine similarity of two such vectors is governed by that shared offset → `cos ≈ 0.9999`, `cosine_dist ≈ 1e-4`. The scale at `:1012` (`50*(1 - dist/0.1)`) then pegs `tonal_score ≈ 50` for **any two real masters**. The +100 does NOT cancel in cosine — cosine is scale-invariant but **not offset-invariant**; adding a constant rotates every vector toward the all-ones axis and collapses angular separation.

**Failure mode:** the paid "engineer fingerprint match" returns a near-constant ~50–60/100 regardless of input. A customer A/B-testing two obviously-different masters gets the same score → immediate, demonstrable loss of trust in a *paid* feature.

**Fix direction:** mean-center each log-spectrum before cosine (subtract per-vector mean, not add a constant), OR use a true spectral distance (L2 on normalized log-power). The comment at `:1006-1007` must be deleted — it encodes the bug.

---

## 4. NET-NEW mechanism: `handleBypass` is a state-machine bug, not just "destroys plugin" (`RpcServer.cpp:720-732`)

AUDIT 1 flagged "handleBypass(true) destroys plugin+state & bypassed atomic never written." Debugging the path: `:727` calls `processor.unloadHostedPlugin()` only when `on==true`, and **there is no `else` branch** — so `handleBypass(false)` (un-bypass) is a no-op that still returns `{"bypassed": false}` (`:730`). 

**Root cause:** the RPC reports a *requested* state it never reconciles with *actual* state. After a bypass→unbypass cycle the plugin is gone but the API claims it's active and un-bypassed. **Edge case:** a client that toggles bypass to compare wet/dry (the obvious use of this feature) permanently loses the hosted EQ after the first toggle, with no error. The atomic that `processBlock` reads (`PluginProcessor.cpp` stores around `:157-161`, `:223`) is never written by this handler, so the audio thread's gate and the RPC's claimed state can diverge — a classic two-source-of-truth race.

**Fix direction:** bypass must be a *gate flag* (atomic bool) read by `processBlock`, never an unload; `handleBypass` writes the atomic for both branches and returns the atomic's value, not the request.

---

## 5. Sentinels rendered as real numbers — debugging the blast radius (`AnalysisView.tsx:2120`, AUDIT 2)

The in-band sentinels (-70 LUFS, 0.0 LRA) are the highest-*frequency* incident risk: they don't crash, they produce confident wrong *advice* ("ease compression") on short clips. The debugging concern the audits under-weight: **sentinels are indistinguishable from real measurements downstream** because they're bare scalars. This is the same root pattern AUDIT 2's "scalar-certainty" insight names — and it means every fix above is fragile until measurements carry a `{value, valid, reason}` tag. **A point fix to any one metric does not stop the next sentinel from leaking into a verdict.** The tagged-measurement refactor is therefore not a "nice-to-have post-launch" — it is the structural fix that makes the point fixes hold.

---

## Sequence ruling (debugging priority, by incident-likelihood × blast-radius)

**MUST-FIX before any paid delivery:**
1. **JUCE: pin + commit-the-fork + CI binary assertion** (§1). Without this the build is non-reproducible and the white-screen can ship. Highest priority — it invalidates QA done on the dev machine.
2. **AAC verdict: all three stacked bugs together** (§2), with a hard-panned anti-correlated test fixture. Per-channel max alone is insufficient.
3. **Sentinel containment** (§5): at minimum, gate any verdict/advice on `valid==true`; suppress sentinel-derived advice. Cheap, stops the highest-frequency wrong-advice incident.
4. **Match-score offset fix** (§3) — it's a paid feature returning noise.
5. **handleBypass gate semantics** (§4).

**DISCLOSE (don't block) — but only because they're documented limits, not silent errors:** 4× TP factor; hosted-plugin RT risk.

**DEFER post-launch:** ViSQOL 48 kHz promotion, mel-L1 relabel (these degrade *quality of insight*, not *correctness of a certified number* — acceptable to ship with a "beta" label on those specific readouts).

**The release-build directories already contain stale copies of the buggy Python** (multiple `release-build/**/encoded_preview.py`, `RTM-Suite-5.0.5-stage`, etc.). Whatever fix is made, the build pipeline must be confirmed to *repackage* — a fix to `python/encoded_preview.py` that isn't re-bundled ships the old bug. Verify the packaging step, not just the source edit.

---

## Single biggest risk to the company if shipped as-is

**A paying mastering engineer trusts a green "Apple Digital Masters: PASS" on a master that actually clips inter-sample, ships it to a label/streaming platform, and it gets rejected or audibly distorts.** The product's entire moat is *being the trustworthy meter* (HARD CONSTRAINT a). One public "RTM said it passed and it didn't" — provable, reproducible, on a hard-panned transient — is existential for a measurement company in a way it would not be for a creative tool. The JUCE-fork-not-in-build issue (§1) compounds this: the meter's numbers can silently change between releases.

**Highest-priority recommendation:** Before anything else, **pin JUCE as a committed submodule, land the fork as a reviewed CMake patch, and add a CI check that the patched binary launches without white-screen and that the AAC test fixture (hard-panned, anti-correlated transient) correctly returns FAIL.** This single gate closes both the reproducibility hole and proves the #1 ship-blocker is actually fixed in the artifact customers receive — not just on the developer's disk.
