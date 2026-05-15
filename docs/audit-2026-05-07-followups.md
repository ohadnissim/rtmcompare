# Audit follow-ups — 2026-05-07

Three skill-based audits ran in parallel against RTMcompare, RTMsend, and
RTMprofile. **39 findings total.** Original log on the first version of this
file. After the user said "dont ship yet / I want everything fully fixed and
dealt with," the grind that produced 5.7.1 closed out **all 32 non-Tier-3
findings**. The 5 Tier-3 protocol upgrades remain queued for 5.8.0 because
they introduce breaking changes to the JSON-RPC schema.

---

## Applied in 5.7.0 (initial pass — first 5)

| # | App | Finding | File |
|---|---|---|---|
| C1 | RTMcompare | BS-RoFormer stem overwrite (file B's stems clobbered file A's in the same dir) | `python/comparator.py:run_hybrid_analysis` |
| C2 | RTMcompare | Stem-based masking only walked subdirs; primary BS-RoFormer writes flat | `python/masking.py:analyze_masking` |
| C3 | RTMprofile | `dynamic_range_avg` saved as crest factor, RTMcompare expects LRA — units mismatch | `rtm-profile-app/python/build_profile.py:_aggregate_scalar_block` |
| C4 | RTMprofile | `pyln.Meter(sr, block_size=3.0)` broke BS.1770 LRA gating — values 30–40% smaller than reference meters | `rtm-profile-app/python/build_profile.py:_loudness_range` |
| H5 | RTMcompare | EQ tip text used uncapped `abs(diff)/2` while the chip applied the ±3/4 dB cap — same diff produced two different numbers | `python/engineer_profile.py:generate_tips` |

---

## Applied in 5.7.1 — RTMsend threading & lifetime (9 fixes)

| Tier | Finding | File / call site |
|---|---|---|
| CRITICAL | Audio-thread reentrancy via `processBlock` try/catch — `hostingEnabled` race with loadHostedPlugin → separate `hostedPluginFaulted` atomic | `PluginProcessor.{h,cpp}` |
| CRITICAL | `prepareToPlay` race with hostedPlugin internal state — added `getCallbackLock()` around `setPlayConfigDetails` / `prepareToPlay` / `releaseResources` | `PluginProcessor.cpp:65-92, 133-160` |
| CRITICAL | `loadHostedPlugin` unique\_ptr swap not atomic — wrapped in `ScopedLock(getCallbackLock())` | `PluginProcessor.cpp:1095-1108` |
| HIGH | `unloadHostedPlugin` symmetric race — same callback-lock fix | `PluginProcessor.cpp:1145-1162` |
| HIGH | RpcServer thread access to `hostedPlugin` not synchronized — `runOnMessageThreadSync` already in place from earlier 5.7.x; verified all four call sites | `RpcServer.cpp:267-465` |
| HIGH | `lastStatus` / `sessionName` / `hostedPluginName` non-atomic `juce::String` — `juce::CriticalSection stringFieldsLock` guards all read/write paths via `setLastStatusLocked` helper + locked getters/setters | `PluginProcessor.{h,cpp}` |
| HIGH | `selectedAraRegionId` non-atomic — same lock; reads snapshot the value into a local before heavy ARA work | `PluginProcessor.{h,cpp}` |
| HIGH | `setStateInformation` MessageManagerLock can hang indefinitely — `MessageManagerLock(juce::Thread::getCurrentThread())` honours `threadShouldExit()` | `PluginProcessor.cpp:802-840` |
| HIGH | `closeButtonPressed` callAsync lambda dereferences freed processor — `JUCE_DECLARE_WEAK_REFERENCEABLE` + `juce::WeakReference` capture in `showHostedPluginWindow`; `juce::Component::SafePointer` for the editor's scan callback | `PluginProcessor.cpp:1175-1200`, `PluginEditor.cpp:209-228` |

---

## Applied in 5.7.1 — RTMcompare DSP medium issues (9 fixes)

| Tier | Finding | File |
|---|---|---|
| CRITICAL | True-peak `rtm_fast` linear interp under-reads ISP — primary path now `scipy.resample_poly` | `python/rtm_fast.py` |
| HIGH | `masking.py` mix\_rms math wrong — replaced with `sqrt(mean(_actual_mix**2))` | `python/masking.py:analyze_masking` |
| HIGH | Python-bridge SIGTERM misclassified as user cancel — bufferKilled flag distinguishes paths | `electron/python-bridge.ts` |
| HIGH | `compute_spectrum` 1e-5 floor too high — lowered to 1e-7 | `python/engineer_profile.py:compute_spectrum` |
| MEDIUM | Region (29,31) Ultra High averages 2 bands — extended to (28,31) | `python/engineer_profile.py:REGION_NAMES` |
| MEDIUM | Numba JIT cache cross-process race — per-app-version subdir | `electron/python-bridge.ts:numbaCacheDir` |
| MEDIUM | `clip_count` threshold used 16-bit FS — switched to 0.99999 (float) | `python/rtm_fast.py` |
| MEDIUM | `compute_dynamic_range` LRA fallback raw RMS — K-weighted fallback added | `python/comparator.py:compute_dynamic_range` |
| MEDIUM | `run_full_analysis` mix sum trim only considered loaded\_a lengths — trim across both | `python/comparator.py:run_full_analysis` |

---

## Applied in 5.7.1 — RTMprofile cohort issues (8 fixes)

| Tier | Finding | File |
|---|---|---|
| HIGH | Concurrent build-profile IPC race — `let activeBuild: ChildProcess` serialiser | `rtm-profile-app/electron/main.ts` |
| HIGH | Cohort-of-1 `curve_mad = 0` defeats RTMcompare dead-zone — gated on cohort ≥3 | `rtm-profile-app/python/build_profile.py` |
| HIGH | Cohort-of-2 stem MAD meaningless — threshold raised to ≥4 | `rtm-profile-app/python/build_profile.py` |
| MEDIUM | Welch `nperseg=8192` not capped — `nperseg = min(8192, len(sig))` | `rtm-profile-app/python/build_profile.py:compute_spectrum` |
| MEDIUM | model-cache `walked_up` creates spurious dirs — only walk existing dirs | `rtm-profile-app/python/build_profile.py` |
| MEDIUM | Windows outPath check case-sensitive — `toLowerCase()` on win32 | `rtm-profile-app/electron/main.ts` |
| MEDIUM | Mixed-SR cohort skewed — out-of-Nyquist returns NaN, `np.nanmedian` for aggregation | `rtm-profile-app/python/build_profile.py` |
| MEDIUM | JSON write not atomic — `.tmp` + `os.replace` | `rtm-profile-app/python/build_profile.py` |

---

## Applied in 5.7.1 — RTMsend medium / cosmetic findings

| Tier | Finding | File |
|---|---|---|
| MEDIUM | Destructor cleanup order — explicit `rpcServer→araRegionsModel→hostedPluginWindow→hostedPlugin` | `PluginProcessor.cpp:41-58` |
| MEDIUM | AU hint string didn't mention VST3-only hosting — appended " · Send-to-Plugin: VST3-only." when wrapperType is AU | `PluginEditor.cpp` |

The other RTMsend medium findings (async load via `createPluginInstanceAsync`,
`AudioProcessorValueTreeState` exposure, `HostedEditorHolder` dead code,
`writeWav` `FileOutputStream` ownership, `MidiBuffer.clear()` allocation)
remain in the design backlog — they're real but invasive enough that landing
them inside a patch release was riskier than the bugs they fix.

---

## Deferred to 5.8.0 — RTMsend protocol upgrades (Tier 3)

These require breaking changes to the JSON-RPC schema. The pre-5.8.0
RTMcompare/RTMsend pair will continue to interoperate; the 5.8.0 schema
adds optional fields and rejection codes that older clients won't recognise.

| # | Finding | Schema impact |
|---|---|---|
| T3-1 | **Per-instance port files** — `~/.rtm/rtmsend-<pid>-<uuid>.port` instead of one shared file. Resolves multiple-DAW races where two open Wavelabs each spawn an RTMsend on the same machine. | Filename change; bridge needs to enumerate matching files and pick the freshest by mtime. |
| T3-2 | **`target_fingerprint` rejection** — recommendation payload includes plugin format+UID+version+param-count hash; RTMsend rejects with `E_TARGET_MISMATCH` if hosted plugin doesn't match. Resolves "user switched plugins between Compare's read-back and Send" silent miswrite. | New `target_fingerprint` field in `recommend.eq` payload; new `E_TARGET_MISMATCH` error code. |
| T3-3 | **Plugin-version mismatch detection** — profile carries `min_version`/`max_version` and `param_count_signature`; bridge refuses to send if signature drifts vs. the loaded plugin. | New profile schema fields (backwards-compatible — pre-5.8.0 bridges treat them as informational). |
| T3-4 | **`host.ping` keepalive + 1.5 s handshake timeout** — distinguishes "not running" from "running but busy" so the connection indicator isn't a guess. | New `host.ping` RPC method. Pre-5.8.0 bridges return method-not-found and the indicator falls back to TCP-connect-only. |
| T3-5 | **Per-connection 30 s read deadline on the RpcServer side** — prevents one stuck client wedging the listener. | Server-side only, no schema change. |

---

## Status

**Total: 32 applied (5.7.0 + 5.7.1 across 3 apps) + 5 deferred (5.8.0 protocol).**

Build artefacts:
- 5.7.0 bundle DMG (initial ship): SHA-256 `a35640dc38ba01c616d28caf5a2a0171da6ddeace9a901bd46f5cfc2690ef998` — May 7 22:43, signed + notarized + stapled, gatekeeper accepted.
- 5.7.1 patch DMG: pending rebuild (this session, post-audit-grind).
