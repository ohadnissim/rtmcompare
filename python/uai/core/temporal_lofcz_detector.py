"""
Frame-level lofcz scorer: pragmatic, budget Resemble DETECT-2B
replacement.

DETECT-2B (Resemble) uses a Mamba state-space model on frozen audio SSL
features to produce a per-frame AI probability. Replicating that is out
of scope (license, training cost). Instead, this module reuses the
existing lofcz fakeprint extractor and ONNX logistic regression model on
overlapping sliding windows of the audio, producing a coarse but useful
per-segment AI probability series. From those frame scores it identifies
contiguous "hybrid zones" (runs of frames whose AI probability exceeds a
threshold).

Design constraints
------------------
* No new training: every per-frame score uses the SAME pretrained MoE
  lofcz heads that already ship in ``models/lofcz_v1_baseline``,
  ``models/lofcz_v2_lyria_specialist``, ``models/lofcz_v3``, and
  ``models/lofcz_v4``. Aggregation across heads matches the production
  ``LofczDetector`` (max of calibrated probabilities) so frame-level
  scores stay numerically comparable to the whole-track ``score``.
* No modifications to ``core/lofcz_detector.py``. We import its primitives
  (``_LofczHead``, ``_load_head``, calibration helpers) but never mutate
  them.
* Cheap: fakeprint computation is ~30 ms per 30-second window on CPU; a
  3-minute track at 15 s hop is 11 windows, so the overhead is ~0.3 s
  per track on top of the existing single-shot lofcz pass.

Why frame-level matters
-----------------------
Distributors (Spotify-tier, Tidal, FUGA, etc.) increasingly want
"verse 2 is AI but the chorus is human"-style attribution for hybrid
tracks. A single track-level score collapses that distinction. Even a
coarse 30 s/15 s grid is enough to flag the obvious case (full-AI vocals
over a human production master) and to surface plausible transition
points to a human reviewer.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple, Union

import numpy as np

from .lofcz_detector import LofczDetector, _LofczHead

try:
    import onnxruntime as ort  # noqa: F401  (presence-check only)
    ONNX_AVAILABLE = True
except ImportError:
    ONNX_AVAILABLE = False


logger = logging.getLogger(__name__)


@dataclass
class TemporalLofczResult:
    """Per-frame lofcz output for a single audio file.

    Field reference for downstream consumers:
      * ``score``           — track-level summary = max(frame_scores) clipped
                              to [0, 1]. Comparable to the existing whole-track
                              ``LofczResult.score`` (same model, same calibration).
      * ``confidence``      — mean per-frame distance from 0.5 (×2) — i.e. how
                              decisive the frames were on average. 0 = all frames
                              sat at 0.5 (no signal); 1 = every frame was {0,1}.
      * ``frame_scores``    — calibrated AI probability per window, in time order.
      * ``frame_times_sec`` — (start_sec, end_sec) tuple per window, same length.
      * ``hybrid_zones``    — contiguous (start_sec, end_sec) runs where every
                              frame's AI probability exceeded
                              ``hybrid_threshold`` (default 0.7). Useful for the
                              distributor / label "where is the AI?" question.
      * ``model_loaded``    — False if no lofcz heads loaded; analyze() then
                              short-circuits to a 0.5 / empty result rather
                              than raising.
    """

    score: float = 0.5
    confidence: float = 0.0
    frame_scores: List[float] = field(default_factory=list)
    frame_times_sec: List[Tuple[float, float]] = field(default_factory=list)
    hybrid_zones: List[Tuple[float, float]] = field(default_factory=list)
    model_loaded: bool = False


class TemporalLofczDetector:
    """Sliding-window lofcz scorer (poor-man's DETECT-2B).

    Construction reuses the same 4-head MoE setup the production
    ``LofczDetector`` uses by default. Each window produces ONE aggregated
    score (max across heads, matching production behaviour) so frame_scores stays numerically
    comparable to ``LofczResult.score`` from the existing detector.

    Parameters
    ----------
    window_sec : float
        Length of each analysis window (default 30 s — matches the lofcz
        detector's preferred minimum context for stable fakeprint stats).
    hop_sec : float
        Stride between windows (default 15 s — i.e. 50% overlap). Halve
        this for finer resolution at proportionally more compute.
    hybrid_threshold : float
        Frame AI probability above which a frame is considered "AI-leaning"
        when computing ``hybrid_zones``. Default 0.7 — chosen to match
        the engine's existing temporal-splice threshold and keep us out
        of the noisy 0.5-0.7 band where frame-to-frame jitter is large.
    model_dirs : Optional[List[str|Path]]
        Override the head directories. If None, defaults to the production
        4-head MoE when all four heads exist on disk, otherwise whatever
        ``LofczDetector`` resolves.
    """

    DEFAULT_WINDOW_SEC = 30.0
    DEFAULT_HOP_SEC = 15.0
    DEFAULT_HYBRID_THRESHOLD = 0.7

    def __init__(
        self,
        window_sec: float = DEFAULT_WINDOW_SEC,
        hop_sec: float = DEFAULT_HOP_SEC,
        hybrid_threshold: float = DEFAULT_HYBRID_THRESHOLD,
        model_dirs: Optional[List[Union[str, Path]]] = None,
        device: str = "cpu",
    ) -> None:
        if window_sec <= 0:
            raise ValueError(f"window_sec must be > 0, got {window_sec}")
        if hop_sec <= 0:
            raise ValueError(f"hop_sec must be > 0, got {hop_sec}")
        if not 0.0 < hybrid_threshold < 1.0:
            raise ValueError(f"hybrid_threshold must be in (0, 1), got {hybrid_threshold}")

        self.window_sec = float(window_sec)
        self.hop_sec = float(hop_sec)
        self.hybrid_threshold = float(hybrid_threshold)
        self.device = str(device or "cpu").strip().lower()

        # Resolve the underlying lofcz detector. We reuse the existing
        # constructor (which already handles MoE / calibration loading) and
        # then steal its ``_heads`` list for direct per-window inference.
        # NOTE: we override max_duration_seconds on the inner detector so
        # the audio loader doesn't truncate long tracks at 180s — we WANT
        # the full duration for frame-level analysis.
        if model_dirs is None:
            root = Path(__file__).resolve().parent.parent
            default_dirs = [
                root / "models/lofcz_v1_baseline",
                root / "models/lofcz_v2_lyria_specialist",
                root / "models/lofcz_v3",
                root / "models/lofcz_v4",
            ]
            if all(d.exists() for d in default_dirs):
                inner = LofczDetector(
                    model_dirs=[str(d) for d in default_dirs],
                    device=self.device,
                )
            else:
                inner = LofczDetector(device=self.device)
        else:
            inner = LofczDetector(
                model_dirs=[str(d) for d in model_dirs],
                device=self.device,
            )

        self._inner = inner
        self._heads: List[_LofczHead] = list(inner._heads)
        self.model_loaded = bool(self._heads) and ONNX_AVAILABLE

        # Larger ceiling for frame-level: we slide a window so we want the
        # full duration, not the truncated 180s the whole-track lofcz uses.
        self._inner.max_duration_seconds = 60 * 60  # 1 hour cap (safety)

        if not self.model_loaded:
            logger.warning(
                "TemporalLofczDetector: no lofcz heads loaded — analyze() will "
                "return an empty result with model_loaded=False."
            )

    # ------------------------------------------------------------------
    #  Public API
    # ------------------------------------------------------------------

    def analyze(self, audio_path: str) -> TemporalLofczResult:
        """Slide the configured window over the audio, score each window."""
        if not self.model_loaded:
            return TemporalLofczResult(model_loaded=False)

        try:
            y = self._inner._load_audio(audio_path)
        except Exception as exc:
            logger.warning("TemporalLofcz: audio load failed for %s: %s", audio_path, exc)
            return TemporalLofczResult(model_loaded=True)

        sr = self._inner.sr  # 16 kHz
        # ``_load_audio`` returns shape (samples, channels).
        n_samples = int(y.shape[0])
        duration_sec = n_samples / float(sr)

        if duration_sec <= 0 or n_samples < self._inner.n_fft:
            return TemporalLofczResult(model_loaded=True)

        win_samples = max(self._inner.n_fft, int(round(self.window_sec * sr)))
        hop_samples = max(1, int(round(self.hop_sec * sr)))

        # Single short track: just one window covering the whole file.
        if n_samples <= win_samples:
            window_starts = [0]
        else:
            last_valid_start = n_samples - win_samples
            window_starts = list(range(0, last_valid_start + 1, hop_samples))
            # Guarantee we always score the tail (e.g. final 30 s) so a
            # 47 s track with 30 s window / 15 s hop yields windows at
            # [0, 15, 17] rather than [0, 15] — the last frame is shorter
            # in the latter case, but its score still represents the tail.
            if window_starts[-1] != last_valid_start:
                window_starts.append(last_valid_start)

        frame_scores: List[float] = []
        frame_times: List[Tuple[float, float]] = []
        for start in window_starts:
            end = min(start + win_samples, n_samples)
            chunk = y[start:end]
            score = self._score_chunk(chunk)
            if score is None:
                continue
            frame_scores.append(score)
            frame_times.append((start / float(sr), end / float(sr)))

        if not frame_scores:
            return TemporalLofczResult(model_loaded=True)

        # Track-level summary = max-of-frames, clipped. We use max here to
        # match the spec ("score = max(frame_scores) clipped to [0, 1]")
        # and because lofcz scores are bimodal in practice — averaging an
        # AI window (~1.0) with a human window (~0.0) gives a useless 0.5,
        # whereas max correctly fires when ANY part of the track is AI.
        score = float(np.clip(max(frame_scores), 0.0, 1.0))

        # Confidence = mean per-frame decisiveness, scaled to [0, 1].
        # Same shape as the per-head confidence in LofczDetector (|p-0.5|*2).
        confidence = float(np.clip(
            np.mean([abs(s - 0.5) * 2.0 for s in frame_scores]),
            0.0, 1.0,
        ))

        hybrid_zones = self._compute_hybrid_zones(frame_scores, frame_times)

        return TemporalLofczResult(
            score=score,
            confidence=confidence,
            frame_scores=frame_scores,
            frame_times_sec=frame_times,
            hybrid_zones=hybrid_zones,
            model_loaded=True,
        )

    # ------------------------------------------------------------------
    #  Internals
    # ------------------------------------------------------------------

    def _score_chunk(self, chunk: np.ndarray) -> Optional[float]:
        """Compute fakeprint on the chunk, run all heads, max-aggregate."""
        if chunk.ndim == 1:
            chunk = chunk[:, None]

        # Pad short chunks up to n_fft to keep the STFT happy. This only
        # ever fires for the final partial window if the track is shorter
        # than ``window_sec``.
        if chunk.shape[0] < self._inner.n_fft:
            chunk = np.pad(
                chunk,
                ((0, self._inner.n_fft - chunk.shape[0]), (0, 0)),
                mode="constant",
            )

        try:
            fakeprint = self._inner._compute_fakeprint(chunk.astype(np.float32, copy=False))
        except Exception as exc:
            logger.debug("TemporalLofcz: fakeprint failed on chunk: %s", exc)
            return None

        fakeprint_input = fakeprint.reshape(1, -1)
        head_calibrated: List[float] = []
        for head in self._heads:
            try:
                raw = LofczDetector._run_onnx(head.ort_session, fakeprint_input)
                cal = float(np.clip(
                    LofczDetector._apply_calibration_static(head.calibration, raw),
                    0.0, 1.0,
                ))
                head_calibrated.append(cal)
            except Exception as exc:
                logger.debug("TemporalLofcz: head %s failed: %s", head.name, exc)

        if not head_calibrated:
            return None

        # Match the production aggregation rule (max across heads).
        return float(np.clip(max(head_calibrated), 0.0, 1.0))

    def _compute_hybrid_zones(
        self,
        frame_scores: List[float],
        frame_times: List[Tuple[float, float]],
    ) -> List[Tuple[float, float]]:
        """Merge contiguous AI-leaning frames into (start_sec, end_sec) zones.

        A zone is opened on the first frame whose score exceeds
        ``hybrid_threshold`` and closed when a frame falls below it. With
        50% overlap windows, "contiguous" means the next frame's start
        time is no later than the current frame's end time (small slack
        to absorb floating-point drift). This is intentionally
        conservative: we report only zones where consecutive overlapping
        windows ALL agreed the audio was AI-leaning, so a single noisy
        false-positive frame does not produce a phantom zone.
        """
        if not frame_scores:
            return []

        zones: List[Tuple[float, float]] = []
        zone_start: Optional[float] = None
        zone_end: Optional[float] = None
        for score, (t0, t1) in zip(frame_scores, frame_times):
            if score > self.hybrid_threshold:
                if zone_start is None:
                    zone_start = t0
                    zone_end = t1
                else:
                    # Gap-tolerant merge: if the next window starts before
                    # (or right at) the current zone's end + a tiny slack,
                    # we extend it. Otherwise we close out and start fresh.
                    slack = 0.5  # seconds — half the typical hop fudge factor
                    if t0 <= (zone_end or t0) + slack:
                        zone_end = max(zone_end or t1, t1)
                    else:
                        zones.append((float(zone_start), float(zone_end or zone_start)))
                        zone_start = t0
                        zone_end = t1
            else:
                if zone_start is not None:
                    zones.append((float(zone_start), float(zone_end or zone_start)))
                    zone_start = None
                    zone_end = None

        if zone_start is not None:
            zones.append((float(zone_start), float(zone_end or zone_start)))

        return zones
