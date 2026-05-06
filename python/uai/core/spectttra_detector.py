"""
SpecTTTra long-context detector — SONICS (ICLR 2025) distillation.

Wraps awsaf49/sonics-spectttra-* (HuggingFace) for full-track AI detection
using the paper's separated temporal/spectral patch token transformer over
long (120s) windows. The 120s alpha variant is the published 0.99-F1 model
on SONICS' real-vs-fake song benchmark.

Distinct from ``core.longcontext_detector``, which is a hand-crafted
heuristic over chroma self-similarity. Both ship in parallel: the heuristic
remains as a robust fallback, while this detector contributes a true ML
signal at long-context scale.

Inference details
-----------------
* Sample rate: 16 kHz mono
* Window length: ``model.config.audio.max_time`` seconds (120s for *-120s,
  5s for *-5s) — taken directly from the loaded checkpoint.
* Output: single sigmoid logit per window. The SONICS dataset convention is
  ``target=1 -> fake``, so ``P(AI) = sigmoid(logit)``.
* Multiple windows are aggregated with confidence-weighted soft voting,
  matching the lofcz MoE convention: each window's probability ``p_i`` is
  weighted by ``|p_i - 0.5|`` so saturated windows dominate uncertain ones.

Cross-generator caveat
----------------------
SONICS was trained on Suno + Udio fakes. Empirically (validated on UAI's
166-track AI Productions corpus) Lyria 3 and Suno v5+ score well below 0.5
on this model — they post-date the training set. We surface this signal at
a low base weight (0.05) and let the v5+ guard / lofcz MoE / CLAP-embedding
detector carry the load on next-gen generators. Useful primarily as a
secondary cross-check on legacy Suno-era fakes.

Graceful fallback
-----------------
If the ``sonics`` package or HF checkpoint cannot be loaded (no internet,
torch missing, etc.) the detector returns ``model_loaded=False`` and the
ensemble drops it from the active set — same pattern as embedding/CLAP.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np


logger = logging.getLogger(__name__)


@dataclass
class SpecTTTraResult:
    """Result for a SpecTTTra long-context AI-detection pass."""

    score: float  # 0 = human, 1 = AI (P(AI) under SONICS convention)
    confidence: float
    window_count: int = 0
    per_window_scores: List[float] = field(default_factory=list)
    per_window_starts_sec: List[float] = field(default_factory=list)
    window_duration_sec: float = 0.0
    sample_rate: int = 16000
    model_loaded: bool = False
    model_name: str = ""
    inference_seconds: float = 0.0
    anomalies: List[str] = field(default_factory=list)


class SpecTTTraDetector:
    """SONICS SpecTTTra long-context AI-music detector.

    Lazy-loads the HF checkpoint on first use; no-op on failure so the
    ensemble can ship without a hard dependency.
    """

    DEFAULT_MODEL = "awsaf49/sonics-spectttra-alpha-120s"

    # Stride between adjacent windows when the track is longer than one
    # window. 0.5 = 50% overlap (matches SONICS paper's eval pipeline).
    DEFAULT_HOP_RATIO = 0.5

    # Don't analyse more than this many windows per track. Caps wall time
    # on long mixes / podcasts to ~max_windows * ~0.2s on Mac CPU.
    MAX_WINDOWS = 12

    def __init__(
        self,
        model_name: str = DEFAULT_MODEL,
        device: Optional[str] = None,
        hop_ratio: float = DEFAULT_HOP_RATIO,
        max_windows: int = MAX_WINDOWS,
    ):
        self.model_name = model_name
        self.hop_ratio = float(hop_ratio)
        self.max_windows = int(max_windows)

        # Lazy-load fields populated on first analyse() (or via _load()).
        self._model = None
        self._sample_rate: int = 16000
        self._window_seconds: float = 120.0
        self._window_samples: int = 16000 * 120
        self._device = device
        self._load_attempted = False
        self._load_error: Optional[str] = None

    # --------------------------------------------------------------- model load

    def _load(self) -> bool:
        """Try to load the HF checkpoint. Idempotent + cached."""
        if self._model is not None:
            return True
        if self._load_attempted:
            return False
        self._load_attempted = True

        try:
            import torch  # noqa: F401  (validates torch available before sonics import)
            from sonics import HFAudioClassifier
        except Exception as exc:  # pragma: no cover - depends on env
            self._load_error = f"sonics import failed: {exc}"
            logger.info("SpecTTTra detector unavailable: %s", self._load_error)
            return False

        try:
            model = HFAudioClassifier.from_pretrained(self.model_name)
            model.eval()

            # Resolve device. Prefer explicit user choice, then CUDA/MPS, then CPU.
            import torch
            if self._device is None:
                if torch.cuda.is_available():
                    self._device = "cuda"
                elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
                    # MPS often slower than CPU for 120s transformer windows on
                    # consumer Macs (GPU memcpy + dtype shuffles dominate). Stay
                    # on CPU unless user forces otherwise.
                    self._device = "cpu"
                else:
                    self._device = "cpu"
            model = model.to(self._device)

            cfg_audio = getattr(model.config, "audio", None)
            self._sample_rate = int(getattr(cfg_audio, "sample_rate", 16000))
            self._window_seconds = float(getattr(cfg_audio, "max_time", 120.0))
            self._window_samples = int(self._window_seconds * self._sample_rate)
            self._model = model
            logger.info(
                "SpecTTTra detector loaded: %s (sr=%d, window=%.0fs, device=%s)",
                self.model_name, self._sample_rate, self._window_seconds, self._device,
            )
            return True
        except Exception as exc:  # pragma: no cover - depends on env / network
            self._load_error = f"checkpoint load failed: {exc}"
            logger.warning("SpecTTTra detector load failed: %s", self._load_error)
            self._model = None
            return False

    # ------------------------------------------------------------------- helpers

    def _empty_result(self, anomaly: str) -> SpecTTTraResult:
        return SpecTTTraResult(
            score=0.5,
            confidence=0.0,
            window_count=0,
            per_window_scores=[],
            per_window_starts_sec=[],
            window_duration_sec=self._window_seconds,
            sample_rate=self._sample_rate,
            model_loaded=False,
            model_name=self.model_name,
            anomalies=[anomaly],
        )

    @staticmethod
    def _aggregate(per_window: List[float]) -> tuple[float, float]:
        """Confidence-weighted soft voting (matches lofcz MoE convention).

        Each window probability ``p_i`` is weighted by ``|p_i - 0.5|``, so a
        window saturated at 0.95 dominates a window sitting at 0.55. If every
        window is exactly 0.5 we fall back to the simple mean.
        """
        if not per_window:
            return 0.5, 0.0
        probs = np.asarray(per_window, dtype=np.float64)
        confs = np.abs(probs - 0.5) * 2.0  # in [0, 1]
        weight_sum = float(confs.sum())
        if weight_sum < 1e-6:
            return float(probs.mean()), 0.0
        agg = float((probs * confs).sum() / weight_sum)
        # Confidence = mean per-window confidence × √n (more agreeing windows
        # → higher confidence, capped at 1.0).
        n = len(per_window)
        mean_conf = float(confs.mean())
        confidence = float(min(1.0, mean_conf * np.sqrt(n)))
        return agg, confidence

    # ---------------------------------------------------------------- inference

    def analyze(self, audio_path: str) -> SpecTTTraResult:
        """Run SpecTTTra over a track and return aggregated AI probability."""
        if not audio_path or not os.path.exists(audio_path):
            return self._empty_result(f"File not found: {audio_path or '(empty)'}")

        if not self._load():
            return self._empty_result(
                f"SpecTTTra model not available: {self._load_error or 'unknown'}"
            )

        try:
            import librosa
            import torch
        except Exception as exc:
            return self._empty_result(f"librosa/torch missing: {exc}")

        # Load mono at the model's expected sample rate.
        try:
            audio, _ = librosa.load(audio_path, sr=self._sample_rate, mono=True)
        except Exception as exc:
            return self._empty_result(f"audio load failed: {exc}")

        if audio.size == 0:
            return self._empty_result("empty audio")

        # Build sliding windows. If the track is shorter than a single window,
        # pad to one window. Otherwise stride at hop_ratio * window_samples.
        window = self._window_samples
        if audio.size < window:
            audio = np.pad(audio, (0, window - audio.size))
            starts = [0]
        else:
            hop = max(1, int(window * self.hop_ratio))
            starts = list(range(0, audio.size - window + 1, hop))
            if not starts:
                starts = [0]
            # Always include a final window aligned to the track end so the
            # last few seconds aren't silently dropped.
            tail = audio.size - window
            if tail not in starts:
                starts.append(tail)
            # Cap to MAX_WINDOWS, sampled uniformly across the track so we
            # don't bias toward intro/outro.
            if len(starts) > self.max_windows:
                idx = np.linspace(0, len(starts) - 1, self.max_windows).astype(int)
                starts = [starts[i] for i in idx]

        per_window_scores: List[float] = []
        per_window_starts: List[float] = []

        import time
        t0 = time.time()
        try:
            self._model.eval()
            for start in starts:
                chunk = audio[start:start + window]
                if chunk.size < window:
                    chunk = np.pad(chunk, (0, window - chunk.size))
                x = torch.from_numpy(chunk.astype(np.float32)).unsqueeze(0)
                if self._device != "cpu":
                    x = x.to(self._device)
                with torch.no_grad():
                    logit = self._model(x).flatten()[0].detach().cpu().item()
                # SONICS convention: target=1 -> fake, so sigmoid(logit) = P(AI)
                prob = float(1.0 / (1.0 + np.exp(-logit)))
                per_window_scores.append(prob)
                per_window_starts.append(float(start) / self._sample_rate)
        except Exception as exc:
            return self._empty_result(f"inference failed: {exc}")

        inference_seconds = time.time() - t0

        score, confidence = self._aggregate(per_window_scores)

        anomalies: List[str] = []
        if per_window_scores:
            high = sum(1 for p in per_window_scores if p >= 0.85)
            low = sum(1 for p in per_window_scores if p <= 0.15)
            if high >= max(2, len(per_window_scores) // 2):
                anomalies.append(
                    f"SpecTTTra: {high}/{len(per_window_scores)} long-context "
                    "windows saturated at high AI probability"
                )
            if high and low:
                anomalies.append(
                    f"SpecTTTra: mixed-source signal "
                    f"({high} AI-high windows, {low} human-low) — possible hybrid track"
                )

        return SpecTTTraResult(
            score=float(np.clip(score, 0.0, 1.0)),
            confidence=float(np.clip(confidence, 0.0, 1.0)),
            window_count=len(per_window_scores),
            per_window_scores=per_window_scores,
            per_window_starts_sec=per_window_starts,
            window_duration_sec=self._window_seconds,
            sample_rate=self._sample_rate,
            model_loaded=True,
            model_name=self.model_name,
            inference_seconds=float(inference_seconds),
            anomalies=anomalies,
        )
