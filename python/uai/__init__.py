"""UAI stem-separation subset.

Originally vendored as the full UAI v1.4 engine (24 detectors + BS-RoFormer
separator) for the AI detection panel. The AI detector was removed in 5.5.0
to keep the bundle small; this package now ships only the BS-RoFormer
4-stem separator (SDR 9.66 on MUSDB18HQ).

Public surface RTM consumes:
  - `uai.core.stem_backends.get_backend("bs_roformer_4stem")` —
    state-of-the-art separator (drums / bass / other / vocals)

Model files live at `model-cache/uai_root/models/bs_roformer_4stem*`.
The runtime resolver in `core/_runtime.py` honours `RTM_UAI_APPLICATION_ROOT`;
`python/separator.py` sets that on import.

Runtime deps (lazy-imported by the backend):
  - `audio-separator` — BS-RoFormer inference frontend
  - `onnxruntime`     — separator preprocessing on some paths
  - `soxr`            — high-quality resampler
"""
