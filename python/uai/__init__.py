"""UAI engine — vendored subset.

Vendored from `/Users/ohadnissim/Claude/Compare` sister project UAI v1.4
on 2026-05-06 to replace RTM's heuristic AI detector and Demucs-only
stem separator with UAI's BS-RoFormer 4-stem + 24-detector calibrated
ensemble (Lambda-validated F1 0.998, deployment_ready calibration).

Public surfaces RTM consumes:
  - `uai.core.engine.EnsembleDetector` — full-track or per-stem analysis
  - `uai.core.per_stem_scorer.PerStemScorer` — stem-aware track verdict
  - `uai.core.stem_backends.get_backend("bs_roformer_4stem")` —
    state-of-the-art separator (drums / bass / other / vocals;
    SDR 9.66 on MUSDB18HQ)

Model files live under RTM's `model-cache/uai/` (not in this Python
tree). The runtime resolver in `core/_runtime.py` honours the env var
`UAI_MODELS_DIR` if set; RTM's adapter shims set this on import.

Optional runtime dependencies (lazy-imported by individual detectors):
  - `audio-separator` — required for BS-RoFormer 4-stem
  - `onnxruntime`     — every ONNX detector (cnn / ast / lofcz / modspec)
  - `soxr`            — lofcz preprocessing resampler
  - `xgboost`         — calibration_head (gracefully no-ops if absent)
  - `openai-whisper`  — lyrics_detector (lazy; first-run downloads model)

Forbidden deps (UAI server-only, MUST NOT land in RTM):
  - `gradio`, `fastapi`, `uvicorn`, `pydantic` — UAI's `app.py` / `api.py`
  - `cryptography` — UAI's `core/tenants.py` (not vendored)

See `python/ai_detector.py` and `python/separator.py` for the RTM-side
adapter shims that delegate to these UAI surfaces.
"""
