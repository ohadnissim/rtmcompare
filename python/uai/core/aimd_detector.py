"""
AI-Music-Detection AST-60s detector — public HuggingFace specialist head.

Wraps ``AI-Music-Detection/ai_music_detection_large_60s`` (HuggingFace), an
~91M-parameter Audio Spectrogram Transformer fine-tuned for AI-vs-human
music classification on 60-second windows. Distinct from
``core.ast_detector.ASTDetector`` (our own ONNX AST that the Codex F audit
downweighted to a 0.02 false-positive brake — kept in place but not
strengthened by this module).

Why ship this as a separate head
--------------------------------
Empirical benchmark on the 166-track AI Productions corpus (Agent C,
2026-04-29) shows AI-MD AST-60s lifts UAI's overall AI recall from 76.4%
toward ~88%, with the strongest gains exactly where lofcz wavers:

    suno_likely_flint    27.8% -> ~67% mean above 0.5
    suno_likely_dor      46.7% -> ~80%
    suno_likely_ziso     57.1% -> ~86%
    google_lyria_3       91.5% -> ~93%
    human_reference      0/1 false positive at 0.065 score (cleared)

It is empirically *weaker* than UAI's existing pipeline on:

    elevenlabs_*_loops   ~0% (loops sit far outside this AST's training distribution)
    seoul_drift_*        ~16% on the unlabeled subset

so the engine continues to weigh lofcz / loop / embedding heavily on those
genres — this head is additive, not a replacement.

Inference details
-----------------
* Sample rate: 16 kHz mono (taken from the AST feature extractor config).
* Window length: 60s (the upstream config sets ``max_length=6000`` mel
  frames at 100 fps, i.e. 60s of audio). Tracks shorter than 60s are
  zero-padded to one window; tracks longer get tiled into multiple
  non-overlapping 60s windows and mean-aggregated. We do not stride at 50%
  overlap because each window already covers a song-form unit and
  overlapping just inflates the wall time without changing the per-track
  AI verdict.
* Output: softmax over the model's 2-class head. We pick the AI label by
  scanning ``id2label`` for "ai"/"fake"/"synth" — falls back to label 1.
* Aggregation across windows: simple mean. Confidence-weighted soft voting
  collapses to mean here because the model's two-class softmax is highly
  bimodal (very rarely sits near 0.5), so they're empirically equivalent.
  Mean is what Agent C's bench used and what the 88% recall projection
  was measured under.

Wall-time target on Mac CPU (M2/M3): <5s per track. On the Agent C bench
the median was ~2.2s/track including audio decode.

Graceful fallback
-----------------
If the HF download or model load fails (no internet, library version
mismatch), ``model_loaded`` is False and the engine drops this head from
the active set — same pattern as embedding/SpecTTTra/watermark.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np


logger = logging.getLogger(__name__)


@dataclass
class AIMDResult:
    """Result for an AI-Music-Detection AST-60s pass."""

    score: float                                      # 0..1, calibrated AI probability
    confidence: float                                 # |score - 0.5| * 2
    window_count: int = 0
    per_window_scores: List[float] = field(default_factory=list)
    per_window_starts_sec: List[float] = field(default_factory=list)
    window_duration_sec: float = 60.0
    sample_rate: int = 16000
    model_loaded: bool = False
    model_name: str = ""
    inference_seconds: float = 0.0
    anomalies: List[str] = field(default_factory=list)
    raw_score: Optional[float] = None                 # uncalibrated mean (== score for now)


class AIMDDetector:
    """AI-Music-Detection AST-60s detector — public HF specialist head.

    Lazy-loads the HF checkpoint on first use; no-op on failure so the
    ensemble can ship offline / without a hard dependency.
    """

    DEFAULT_MODEL = "AI-Music-Detection/ai_music_detection_large_60s"
    # AudioSet base extractor — the upstream model reuses MIT's preprocessing
    # config, only the classifier weights are fine-tuned. We pin the base
    # extractor explicitly because that's how Agent C's benchmark loads it.
    EXTRACTOR_BASE = "MIT/ast-finetuned-audioset-10-10-0.4593"

    # 60s windows = 6000 mel frames at the AST's 100 fps default.
    DEFAULT_WINDOW_SECONDS = 60.0
    DEFAULT_MAX_LENGTH = 6000

    # Cap windows per track so very long mixes don't blow wall time.
    # 5 windows = 5 minutes of audio, enough for any song-length input.
    MAX_WINDOWS = 5

    def __init__(
        self,
        model_name: str = DEFAULT_MODEL,
        extractor_base: str = EXTRACTOR_BASE,
        window_seconds: float = DEFAULT_WINDOW_SECONDS,
        max_windows: int = MAX_WINDOWS,
        device: Optional[str] = None,
        cache_dir: Optional[str] = None,
    ):
        self.model_name = model_name
        self.extractor_base = extractor_base
        self.window_seconds = float(window_seconds)
        self.max_windows = int(max_windows)
        self._device_pref = device
        # Match Agent C's benchmark cache path so we don't re-download on
        # first engine init when the bench has already pulled the weights.
        self.cache_dir = cache_dir or os.environ.get(
            "AIMD_CACHE_DIR",
            "/tmp/competitor_aimusicdet_models",
        )

        # Lazy-load fields populated on first analyze() call.
        self._model = None
        self._extractor = None
        self._sample_rate: int = 16000
        self._device: Optional[str] = None
        self._ai_label_idx: int = 1
        self._load_attempted = False
        self._load_error: Optional[str] = None

    # --------------------------------------------------------------- model load

    def _load(self) -> bool:
        """Try to load HF feature extractor + classifier. Idempotent + cached."""
        if self._model is not None:
            return True
        if self._load_attempted:
            return False
        self._load_attempted = True

        try:
            import torch
            from transformers import ASTFeatureExtractor, ASTForAudioClassification
        except Exception as exc:  # pragma: no cover - depends on env
            self._load_error = f"transformers/torch import failed: {exc}"
            logger.info("AIMD detector unavailable: %s", self._load_error)
            return False

        # Make sure the cache dir exists. HF will populate it on first download.
        try:
            os.makedirs(self.cache_dir, exist_ok=True)
        except Exception:
            pass

        try:
            extractor = ASTFeatureExtractor.from_pretrained(
                self.extractor_base,
                cache_dir=self.cache_dir,
                max_length=self.DEFAULT_MAX_LENGTH,
            )
            model = ASTForAudioClassification.from_pretrained(
                self.model_name,
                cache_dir=self.cache_dir,
            )
            model.eval()
        except Exception as exc:  # pragma: no cover - network/HF dependent
            self._load_error = f"checkpoint load failed: {exc}"
            logger.warning("AIMD detector load failed: %s", self._load_error)
            self._model = None
            self._extractor = None
            return False

        # Resolve device. Prefer explicit user choice, then MPS (Apple Silicon),
        # then CUDA, then CPU. AST is small enough that MPS gives a real ~2x
        # speedup on M-series Macs (verified by Agent C's bench: ~2.2s/track on
        # MPS vs ~4.5s on CPU).
        if self._device_pref is not None:
            device = self._device_pref
        else:
            try:
                if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
                    device = "mps"
                elif torch.cuda.is_available():
                    device = "cuda"
                else:
                    device = "cpu"
            except Exception:
                device = "cpu"
        try:
            model = model.to(device)
        except Exception as exc:
            logger.warning("AIMD: failed to move model to %s, falling back to CPU: %s", device, exc)
            device = "cpu"
            model = model.to(device)

        self._device = device
        self._sample_rate = int(getattr(extractor, "sampling_rate", 16000))

        # Identify the AI-positive label index from id2label. Most fine-tunes
        # use either {0:'human', 1:'ai'} or {0:'real', 1:'fake'}; we scan for
        # the keyword and default to 1 if nothing matches.
        ai_idx = None
        try:
            id2label = getattr(model.config, "id2label", {}) or {}
            for idx, label in id2label.items():
                if isinstance(label, str) and any(
                    tok in label.lower() for tok in ("ai", "fake", "synth", "generated")
                ):
                    ai_idx = int(idx)
                    break
        except Exception:
            ai_idx = None
        self._ai_label_idx = 1 if ai_idx is None else ai_idx

        self._model = model
        self._extractor = extractor
        logger.info(
            "AIMD detector loaded: %s (sr=%d, window=%.0fs, ai_idx=%d, device=%s)",
            self.model_name, self._sample_rate, self.window_seconds,
            self._ai_label_idx, self._device,
        )
        return True

    # ------------------------------------------------------------------- helpers

    def _empty_result(self, anomaly: str, model_loaded: bool = False) -> AIMDResult:
        return AIMDResult(
            score=0.5,
            confidence=0.0,
            window_count=0,
            per_window_scores=[],
            per_window_starts_sec=[],
            window_duration_sec=self.window_seconds,
            sample_rate=self._sample_rate,
            model_loaded=model_loaded,
            model_name=self.model_name,
            anomalies=[anomaly],
        )

    # ---------------------------------------------------------------- inference

    def analyze(self, audio_path: str) -> AIMDResult:
        """Run AI-MD AST-60s over a track and return mean-aggregated AI probability."""
        if not audio_path or not os.path.exists(audio_path):
            return self._empty_result(f"File not found: {audio_path or '(empty)'}")

        if not self._load():
            return self._empty_result(
                f"AIMD model not available: {self._load_error or 'unknown'}",
                model_loaded=False,
            )

        try:
            import librosa
            import torch
        except Exception as exc:
            return self._empty_result(
                f"librosa/torch missing: {exc}",
                model_loaded=False,
            )

        sr = self._sample_rate
        window_samples = int(self.window_seconds * sr)

        # Cap the audio we read at max_windows * window_seconds so we don't
        # spend wall time on the tail of a 30-min mix. If the track is shorter
        # than one window, pad to one window.
        max_duration = self.window_seconds * self.max_windows
        try:
            wav, _ = librosa.load(
                audio_path, sr=sr, mono=True, duration=max_duration,
            )
        except Exception as exc:
            return self._empty_result(
                f"audio load failed: {exc}",
                model_loaded=True,
            )

        if wav.size == 0:
            return self._empty_result("empty audio", model_loaded=True)

        # Build non-overlapping 60s windows. For tracks under 60s, pad once.
        if wav.size < window_samples:
            wav = np.pad(wav, (0, window_samples - wav.size))
            window_starts = [0]
        else:
            window_starts = list(range(0, wav.size - window_samples + 1, window_samples))
            if not window_starts:
                window_starts = [0]
            if len(window_starts) > self.max_windows:
                window_starts = window_starts[: self.max_windows]

        per_window_scores: List[float] = []
        per_window_starts: List[float] = []

        import time
        t0 = time.time()
        try:
            self._model.eval()
            for start in window_starts:
                chunk = wav[start : start + window_samples]
                if chunk.size < window_samples:
                    chunk = np.pad(chunk, (0, window_samples - chunk.size))

                inputs = self._extractor(
                    chunk, sampling_rate=sr, return_tensors="pt",
                )
                if self._device != "cpu":
                    inputs = {k: v.to(self._device) for k, v in inputs.items()}

                with torch.no_grad():
                    logits = self._model(**inputs).logits  # (1, num_classes)
                    # softmax in float32 for numerical stability under MPS fp16
                    probs = torch.softmax(logits.float(), dim=-1).squeeze(0).cpu().numpy()

                if probs.ndim == 0:
                    # Unexpected shape; treat as no-signal.
                    prob = 0.5
                elif self._ai_label_idx < probs.size:
                    prob = float(probs[self._ai_label_idx])
                else:
                    prob = float(probs[-1])

                per_window_scores.append(prob)
                per_window_starts.append(float(start) / sr)
        except Exception as exc:
            return self._empty_result(
                f"inference failed: {exc}",
                model_loaded=True,
            )

        inference_seconds = time.time() - t0

        if not per_window_scores:
            return self._empty_result("no windows produced", model_loaded=True)

        # Mean aggregation matches Agent C's benchmark; the 88% projected
        # recall was measured under this exact aggregation rule.
        agg_score = float(np.mean(per_window_scores))
        agg_score = float(np.clip(agg_score, 0.0, 1.0))
        confidence = float(np.clip(abs(agg_score - 0.5) * 2.0, 0.0, 1.0))

        anomalies: List[str] = []
        n_windows = len(per_window_scores)
        if n_windows >= 2:
            high = sum(1 for p in per_window_scores if p >= 0.85)
            low = sum(1 for p in per_window_scores if p <= 0.15)
            if high >= max(2, n_windows // 2):
                anomalies.append(
                    f"AIMD: {high}/{n_windows} 60s windows saturated at high AI probability"
                )
            if high and low:
                anomalies.append(
                    f"AIMD: mixed-source signal ({high} AI-high, {low} human-low) — possible hybrid"
                )

        return AIMDResult(
            score=agg_score,
            confidence=confidence,
            window_count=n_windows,
            per_window_scores=per_window_scores,
            per_window_starts_sec=per_window_starts,
            window_duration_sec=self.window_seconds,
            sample_rate=self._sample_rate,
            model_loaded=True,
            model_name=self.model_name,
            inference_seconds=float(inference_seconds),
            anomalies=anomalies,
            raw_score=agg_score,
        )
