# Engineering 03 — Senior Performance Engineer
## Delivery-Readiness Verdict Contribution — RTM Suite

**Lens:** Senior performance engineer optimizing a production app for massive traffic.
Maximum speed, lower memory, scalability, faster rendering, cleaner execution, no leaks.
**Scope note:** I do NOT re-litigate the three audits' correctness bugs. I add only the
net-new *performance / scalability / footprint / RT-glitch* judgment my lens surfaces, and
fold it into the ship/no-ship sequence.

---

## DIVISION VERDICT: SHIP-CAPABLE (after the correctness blockers), but with TWO
performance issues I rank as PRE-DELIVERY, and a footprint problem that is a *commercial*
liability even though it is not a correctness bug.

The correctness blockers (Audit 1 #1 AAC mono-downmix ISP; Audit 2 ViSQOL speech-mode,
in-band sentinels acted on) gate the ship — performance does not. RTMcompare is a
desktop, single-user, on-device tool: "massive traffic" maps to **large batch/album runs
and long analysis sessions**, not concurrent web load. Through that lens the engine is
mostly sound (good daemon design, real LRU intent, soxr fast paths), but it has a
**memory leak that bites exactly the power users a paid mastering tool targets**, a
**concurrency model that cannot use the cores it's running on**, and a **3× bloated
install footprint** that will dominate first-touch product perception.

---

## NET-NEW PERFORMANCE FINDINGS (not in the three audits)

### P1 — UNBOUNDED PCM CACHE: documented `cache_clear()` is NEVER called → batch-mode memory leak
`comparator.py:12-20` adds an `@lru_cache` on `_load_audio_cached(path, sr, mono)` and the
docstring explicitly says *"Call `_load_audio_cached.cache_clear()` between unrelated batch
jobs."* Grep across all of `python/*.py`: **zero call sites.** The only reference is the
comment itself (`comparator.py:17`).

Consequence: every track loaded in a batch/album run pins its **full decoded float PCM** in
the process-resident LRU for the daemon's entire lifetime (the daemon is long-lived by
design — `rtm_daemon.py` exists precisely to avoid re-spawn). A 50-track album at
~44.1k stereo float32 is on the order of **2–5 GB resident that never frees**. On an 8–16 GB
laptop (the median customer machine), a large album review will swap, then OOM-kill the
daemon mid-run — and the user loses the whole session. This is the classic "works in the
demo, dies on the real workload" leak. **Trivial fix** (call `cache_clear()` at job
boundary in `rtm_daemon._handle_analyze` / `batch_analyze` loop, or switch to
`functools.lru_cache(maxsize=2)` so only the A/B pair is retained).

### P2 — CACHE BYPASS: the main `compare()` path doesn't use the cache it added
`comparator.py:2518-2519` (`compare()` entrypoint) calls `librosa.load(..., mono=False)`
**directly**, not `_load_audio_cached`. The MED-14 cache is keyed `(path, sr, mono)` and is
only consulted by the mono helper paths. Net effect: **each file is decoded twice per
analysis** — once mono for the cached perceptual paths, once stereo for `compare()`.
`librosa.load` (audioread/soundfile + resample to target sr) is the single most expensive
op in the pipeline. This silently doubles I/O + resample cost on every comparison. The
cache as shipped delivers ~none of its intended benefit on the primary code path. Fix:
route `compare()` through one channel-aware cached loader and slice mono from the stereo
buffer (never decode twice).

### P3 — GIL-BOUND THREADPOOL FOR CPU-BOUND NUMPY WORK (false scalability)
Both the daemon (`rtm_daemon.py:366,374`, `MAX_WORKERS=4`) and batch
(`batch_analyze.py:36,371`) use `ThreadPoolExecutor` for the analysis fan-out. The work is
**CPU-bound numpy/scipy/librosa** (STFT, mel, welch, resample). librosa/numpy release the
GIL *inconsistently* — pure-Python orchestration and many librosa stages do not — so
"4 workers" does NOT give 4× throughput on a 50-track album; it gives contention plus the
peak-memory of 4 full PCM buffers in flight, **amplifying the P1 leak 4×**. For a desktop
tool this is acceptable for the *single* interactive A/B (one job at a time), but the batch
path advertises parallelism it largely cannot deliver and pays the memory cost regardless.
Honest options: (a) cap batch at `max_workers=2` to bound memory until P1 is fixed, or
(b) move batch fan-out to `ProcessPoolExecutor` (true parallelism, but +per-proc import
cost — measure before committing). DO NOT ship a "fast album mode" marketing claim on the
current threaded path.

### P4 — REAL-TIME AUDIO-THREAD ALLOCATION RISK in RTMsend capture
`PluginProcessor.cpp:347,376`: `dest.insert(dest.end(), src, src+toCopy)` runs on the host
**audio thread** inside `processBlock`. `allocateRing()` pre-`reserve()`s capacity
(`:148-149`) and the comment concedes *"std::vector::insert still _may_ allocate"*
(`:142-143`). If a captured loop region exceeds the reserved cap — long loop, tempo
automation lowering BPM, or host reporting a longer cycle than the prepared estimate —
`insert` **heap-allocates on the RT thread → dropout/glitch in the customer's master.**
For a tool whose entire value is trustworthy audio, an audible artifact injected by our own
capture path is reputationally as bad as a wrong number. This is distinct from Audit 1's
data-race ruling (that's correctness of *which* samples; this is *whether we glitch the
stream at all*). Fix: hard-cap `toCopy` to remaining reserved capacity and drop-with-flag
on overflow (never grow on the RT thread), or size the ring to host max-block × max-loop.

### P5 — float32→float64 churn in the 4× TP oversampler (CPU + cache pressure)
`comparator.py:650` and `analyze.py:125`: the soxr 4× true-peak upsample casts each segment
`astype(np.float64)` before resampling. librosa delivers float32; the cast **doubles
memory bandwidth and allocates a transient 2× buffer** on the hottest numeric path, per
segment, per channel. TP detection does not need f64 precision (BS.1770-4 4× is amplitude,
not accumulation-sensitive). Keep float32 through the resampler unless a measured TP delta
justifies f64. Low individual cost but it's on the inner loop and trivially removable.

---

## FOOTPRINT — the commercial-perf issue the audits flagged but underweighted

`model-cache/uai_root` = **4.0 GB** of BS-/Mel-Roformer separator checkpoints
(`*.ckpt`) bundled, for a separator Audit 2 confirms **does not exist** in this product.
Plus **three full Python interpreters** shipped: `python-bundle` 1.1 GB +
`python-bundle-intel` 1.2 GB + `python-bundle-win` 1.1 GB.

From a delivery-perf lens this is a first-impression killer:
- A paid mastering tool that ships a **~7+ GB download / install** signals bloat before the
  user runs a single analysis — the opposite of "precision instrument."
- The 4.0 GB is **pure dead weight** (no code path loads it — `rtm_daemon.py:158-164`
  imports `separator` in a try/except that just warns and disables "deep-scan"). Cut it:
  instant −4 GB, zero functional loss, **highest ROI change in this entire report.**
- The three interpreters are correct for cross-platform but should be assembled **per
  platform installer**, not co-resident in one tree. The macOS arm64 customer should never
  download the Windows + Intel bundles.

This is not a correctness blocker, so it is **disclose/fast-follow, not ship-gate** — but
the 4.0 GB dead-weight cut is so cheap and so high-impact on perceived quality that it
should ride along in the same pre-delivery commit as the correctness fixes.

---

## ANSWERS TO BOARD QUESTIONS (performance division)

**(1) Shippable for paid delivery, min bar?** Performance does not block ship. Min
performance bar to add to the correctness gate: **fix P1 (leak) + P2 (double-decode)** —
both are trivial, both directly threaten the *paying power-user's* large-batch session,
which is the workload our customers actually run. Everything else is disclose/defer.

**(2) Sequence:**
- **MUST-FIX pre-delivery (ride with the correctness commit):** P1 cache_clear/maxsize;
  P2 single cached channel-aware load; **delete the 4.0 GB dead model-cache.**
- **MUST-FIX pre-delivery for RTMsend specifically:** P4 RT-thread allocation cap (we must
  not glitch a customer's audio).
- **DISCLOSE:** batch "parallel" mode is GIL-bound — don't market throughput claims (P3);
  per-platform installers are a fast-follow (footprint).
- **DEFER post-launch:** P3 process-pool re-architecture (measure first); P5 f64 cast.

**(3) GTM — ship the meter now & fix, or hold for the certification-layer pivot?**
From a scalability-of-the-business lens: **ship the meter now** after the gates. The
certification-layer pivot (Audit 2's "RTM Verify") is attractive *because* it is the path
where these perf characteristics become load-bearing — a hosted/MCP cert service WILL face
real concurrency, and then P1/P3 graduate from "annoying" to "fatal." Treat today's P1/P3
fixes as **down-payment on the pivot's architecture**, not throwaway. Ship desktop, fix the
leak/decode, and keep the engine single-job-clean so it can later sit behind a queue.

**(4) Single biggest risk if we ship as-is (perf lens):** The **P1 unbounded PCM cache**.
It is invisible in QA (small test sets), guaranteed to manifest on the real customer
workload (large album masters by a working engineer), and the failure mode is an **OOM
mid-session that destroys their work** — turning our most engaged, highest-paying user's
first serious run into a crash. Combined with the 7 GB install, the customer's first
impression risk is "bloated and unstable," which is lethal for a tool sold on the promise
of being a trustworthy precision instrument.

---

## HIGHEST-PRIORITY PERFORMANCE RECOMMENDATION
**Fix P1 before delivery: make the PCM cache bounded (`maxsize=2`) or call
`cache_clear()` at every job boundary, and delete the 4.0 GB dead `model-cache/uai_root`.**
One is a one-line leak fix on the exact workload our paying customers run; the other is the
single highest-ROI, zero-risk footprint cut available. Both can ride in the same commit as
the correctness blockers. (`comparator.py:12-20`, never-called `cache_clear`;
`model-cache/uai_root` 4.0 GB; loader bypass at `comparator.py:2518-2519`.)
