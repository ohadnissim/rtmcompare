# UAI vendoring notes

Vendored from `/Users/ohadnissim/Claude/UAI` v1.4 on 2026-05-06 to give RTM
a state-of-the-art separator (BS-RoFormer 4-stem; SDR 9.66 on MUSDB18HQ)
and a calibrated AI detector (Lambda-validated F1 0.998, deployment_ready).

This replaces RTM's prior Demucs-only separator (`separator_demucs.py`,
kept as fallback) and heuristic AI detector (`ai_detector_v1.py`, kept
as fallback).

## What lives where

| RTM path | What's there |
|---|---|
| `python/uai/core/` | 35 vendored UAI Python modules (engine + 24 detectors + helpers) |
| `python/uai/core/stem_backends/` | 6 stem-backend modules (BS-RoFormer 4-stem default; cascade / demucs / roformer fallbacks) |
| `python/separator.py` | RTM adapter — delegates to UAI `get_backend("bs_roformer_4stem")` with cascade/demucs/legacy fallback |
| `python/ai_detector.py` | RTM adapter — delegates to UAI `PerStemScorer.analyze`; maps `PerStemResult` → RTM `AIDetection` schema |
| `python/separator_demucs.py` | Pre-5.3 Demucs-only path, kept as last-resort fallback |
| `python/ai_detector_v1.py` | Pre-5.3 heuristic detector, kept as last-resort fallback |
| `model-cache/uai_root/models/` | ~550 MB of model files (BS-RoFormer ckpt + ONNX heads + calibration JSONs + CLAP bank) |

UAI's `core/_runtime.py` was patched (one function, `application_root`)
to honour the env var `RTM_UAI_APPLICATION_ROOT`. Both RTM adapter
shims set this var to `model-cache/uai_root` on import; UAI then
finds its assets at `model-cache/uai_root/models/<file>`.

## Dependencies — RTM bundle additions required

These are **NOT yet** in `python-bundle/` and need to be added before any
production build. (Per current direction, no compiles run yet.)

| Package | Pin | Used by | Notes |
|---|---|---|---|
| `audio-separator` | `>=0.30` | `core/stem_backends/roformer_4stem.py`, `roformer.py` | BS-RoFormer inference frontend. Has its own torch + onnxruntime soft deps. |
| `onnxruntime` | `==1.19.2` | every `*_detector.py` that loads a `.onnx` (cnn / ast / lofcz / modspec / temporal_lofcz / etc.) | CPU build is fine for RTM; CUDA gated by env var if a user has it. |
| `soxr` | `>=0.5.0` | `core/lofcz_detector.py`, `core/watermark_detector.py` (lazy) | High-quality resampler. |
| `xgboost` | (any 2.x) | `core/calibration_head.py` (lazy) | Loads the calibration head JSON. Lazy-imported; absent → fall back to v1 calibration JSON which doesn't need xgboost. |
| `openai-whisper` | `==20240930` | `core/lyrics_detector.py` (lazy) | Lyrics-aware lofcz path. **Optional**: if absent, the engine fail-opens and skips the lyrics detector. **Recommend SKIP** for RTM bundle — it's another ~150 MB of model download on first use, and the lyrics signal isn't required for solid F1 on instrumental + vocal stems. |

**FORBIDDEN** (UAI server-only — must NOT land in RTM bundle):
- `gradio` (UAI `app.py`)
- `fastapi`, `uvicorn`, `pydantic` (UAI `api.py`)
- `cryptography` (UAI `core/tenants.py`, not vendored anyway)

## Version-bump survey (UAI's older pins vs RTM's newer)

The vendoring inventory ran a syntax + API survey over UAI's older
version pins (`torch 2.4`, `numpy 1.26`, `scipy 1.13`, `librosa 0.10`)
against RTM's newer ones (`torch 2.11`, `numpy 2.4.4`, `scipy 1.17.1`,
`librosa 0.11`). Verdict: **HIGH confidence no breaks** across all four
upgrades. UAI uses only the stable API surface in each:

- `torch` — only `torch.load(weights_only=True)` and `torchaudio.transforms.Spectrogram`. No internal symbols, no JIT trace, no AMP, no default-tensor-type tricks.
- `torchaudio` — only `Spectrogram`. Stable.
- `numpy` — explicit `np.float32` / `np.int64` everywhere; no `np.float`/`np.int`/`np.bool`/`np.MachAr`/`np.byte_bounds`.
- `scipy` — only `scipy.signal` (filters + `find_peaks`), `scipy.fft.dct`, `scipy.stats`, `scipy.interpolate`, `scipy.ndimage`. None of the broken-in-1.17 APIs are touched.
- `librosa` — only `load`, `stft`, `feature.melspectrogram`, `feature.chroma_*`, `beat.beat_track`, `onset.*`. All used with keyword args (no positional-arg deprecations).

If any of these surface a runtime issue, the per-detector `try/except`
in `EnsembleDetector` fail-opens that detector with reliability=0; the
ensemble survives and the RTM adapter still emits a usable verdict.

## Schema map — UAI `PerStemResult` → RTM `AIDetection`

| RTM field (src/types.ts) | UAI source | Notes |
|---|---|---|
| `probability` | `instrumental_aggregate` (preferred) → `max_stem_score` → `full_mix_score` | Calibrated risk in 0..1. RTM's prior `probability` was an alias for an uncalibrated heuristic — this is now a real calibrated probability. |
| `verdict` | derived from `track_verdict` (4-way → 3-way) | `"AI Generated"` or `"Hybrid"` → `likely_ai`; `"Human"` → `likely_human`; `"Unknown"` → `uncertain`. |
| `summary` | synthesized | One-liner referencing the loudest stem. |
| `checks[]` | `full_mix_detector_scores` map | Each detector becomes a `{name, score, weight=1, detail, reliability=1}` row. |
| `stem_verdicts[]` | `stem_scores` + `stem_verdicts` + `stem_notes` | Per-stem `{stem, verdict, score, detail}`. |

Bonus fields the RTM UI can progressively adopt without breaking:
`track_verdict_4way`, `full_mix_verdict`, `full_mix_score`,
`instrumental_aggregate`, `max_stem_name`, `max_stem_score`,
`stem_4way_classes`, `stem_4way_probabilities`, `method` (= `"uai_v1.4"`),
`calibration` (= `"deployed"`).

## What's NOT vendored (intentional)

- `core/tenants.py` — UAI's multi-tenant license/key crypto. Not used by
  the engine or scorer; we don't run UAI as a service.
- `detectors/*` — UAI's UI-compat shim tree; just re-exports `core.*`.
  RTM imports `core.*` directly.
- `analysis/`, `audit_kit/`, `lambda/`, `training/`, `evaluation/`,
  `notebooks/`, `tests/`, `sdk/`, `corpus/`, `assets/`, `docs/`,
  `app.py`, `api.py`, `run.py`, `batch_processor.py`, `setup.py`,
  `build_*.py` — server / training / docs not relevant to RTM.
- Superseded model variants (older `lofcz/`, `lofcz_codec/`, `lofcz_v2/`
  pre-`lyria_specialist`, `lofcz_v2_BACKUP_*/`, `modspec_v2/`,
  `*.pt` torch checkpoints when an `.onnx` exists).

## Updating the vendor

When UAI ships a new release, replace files in:
1. `python/uai/core/` — sync from UAI `core/`
2. `python/uai/core/stem_backends/` — sync from UAI `core/stem_backends/`
3. `model-cache/uai_root/models/` — sync from UAI `models/`

Re-apply the one-function patch to `_runtime.py:application_root` to
honour `RTM_UAI_APPLICATION_ROOT`. The patch is documented in the
function's docstring inside the vendored copy.
