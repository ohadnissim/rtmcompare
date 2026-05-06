"""Weighted detector engine for full-track authorship analysis."""

import gc
from copy import deepcopy
import logging
import platform
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from ._runtime import file_sha256, resolve_model_path
from ._security import attach_report_fingerprint, check_trial
from .aimd_detector import AIMDDetector, AIMDResult
from .ast_detector import ASTDetector, ASTResult
from .calibration_head import (
    AUDIO_FEATURE_NAMES,
    CalibrationHead,
    FourWayCalibrationHead,
    V1_4_4WAY_MODEL_PATH,
    V1_4_STEM_MODEL_TEMPLATE,
    build_calibration_feature_dict,
    build_stem_aware_feature_dict,
    precompute_audio_features,
)
from .cnn_detector import CNNDetector, CNNResult
from .codec_residual_detector import CodecResidualDetector, CodecResidualResult
from .calibration import apply_classical_calibration, classical_probability
from .confidence_intervals import BootstrapCIComputer
from .embedding_detector import EmbeddingDetector, EmbeddingResult
from .lofcz_detector import LofczDetector
from .fakeprint_detector import FakePrintDetector, FakePrintResult
from .fourier_detector import FourierDetector, FourierResult
from .highfreq_detector import HighFrequencyDetector, HighFreqResult
from .hybrid_aggregator import HybridAggregator, HybridVerdict
from .lyrics_detector import LyricsDetector, LyricsResult
from .longcontext_detector import LongContextDetector, LongContextResult
from .loop_detector import LoopDetector, LoopResult
from .modspec_detector import ModspecDetector, ModspecResult
from .onset_detector import OnsetTimingDetector, OnsetTimingResult
from .phase_detector import PhaseDetector, PhaseResult
from .production_detector import ProductionDetector, ProductionResult
from .segment_detector import SegmentDetector, SegmentResult
from .spectral_detector import SpectralDetector, SpectralResult
from .spectral_filter_detector import detect_filter_signature
from .spectttra_detector import SpecTTTraDetector, SpecTTTraResult
from .stereo_realism_detector import StereoRealismDetector, StereoRealismResult
from .temporal_detector import TemporalDetector, TemporalResult
from .temporal_lofcz_detector import TemporalLofczDetector, TemporalLofczResult
from .vocal_tremor_detector import VocalTremorDetector, VocalTremorResult
from .watermark_detector import WatermarkDetector, WatermarkResult


logger = logging.getLogger(__name__)


@dataclass
class EnsembleResult:
    """Final combined analysis result."""

    verdict: str
    score: float
    confidence: float
    verdict_emoji: str
    score_ci_low_95: Optional[float] = None
    score_ci_high_95: Optional[float] = None

    # Per-detector results
    fourier: Optional[FourierResult] = None
    fakeprint: Optional[FakePrintResult] = None
    spectral: Optional[SpectralResult] = None
    cnn: Optional[CNNResult] = None
    ast: Optional[ASTResult] = None
    aimd: Optional[AIMDResult] = None
    codec_residual: Optional[CodecResidualResult] = None
    phase: Optional[PhaseResult] = None
    highfreq: Optional[HighFreqResult] = None
    onset: Optional[OnsetTimingResult] = None
    segment: Optional[SegmentResult] = None
    temporal: Optional[TemporalResult] = None
    temporal_lofcz: Optional[TemporalLofczResult] = None
    longcontext: Optional[LongContextResult] = None
    spectttra: Optional[SpecTTTraResult] = None
    lyrics: Optional[LyricsResult] = None
    production: Optional[ProductionResult] = None
    embedding: Optional[EmbeddingResult] = None
    vocal_tremor: Optional[VocalTremorResult] = None
    stereo_realism: Optional[StereoRealismResult] = None
    watermark: Optional[WatermarkResult] = None
    loop: Optional[LoopResult] = None
    # Modulation-spectrum detector (Codex DELTA, 2026-04-30): reverb-aware
    # complementary head. None when the model isn't trained / loaded.
    modspec: Optional[ModspecResult] = None

    # Per-segment AI zones (start_sec, end_sec) sourced from the frame-level
    # lofcz scorer — populated for distributors / labels who want
    # "verse 2 is AI but the chorus is human"-style attribution. Empty list
    # means either a clean human track or a uniformly-AI track (where the
    # zone covers ~the whole duration but we de-duplicate to per-frame data
    # only when partial coverage signals a true hybrid).
    hybrid_zones: List[Tuple[float, float]] = field(default_factory=list)

    # Optional stem-first verdict from HybridAggregator. This is additive:
    # the legacy EnsembleResult.verdict remains the primary engine verdict.
    hybrid_verdict: Optional[HybridVerdict] = None

    # Breakdown
    detector_scores: Dict[str, float] = field(default_factory=dict)
    detector_weights: Dict[str, float] = field(default_factory=dict)
    detector_score_cis: Dict[str, Tuple[float, float]] = field(default_factory=dict)
    analysis_metadata: Dict[str, object] = field(default_factory=dict)
    all_anomalies: List[str] = field(default_factory=list)
    cross_validation_notes: List[str] = field(default_factory=list)
    top_reasons: List[str] = field(default_factory=list)
    generated_at: str = ""
    report_fingerprint: str = ""

    # Per-generator attribution (Hive / IRCAM-style credit attribution).
    # Sourced from the multi-class CNN's softmax distribution, then gated by
    # the overall AI score and a confidence threshold for honest reporting.
    predicted_generator: str = "unknown"
    generator_confidence: float = 0.0
    generator_distribution: Dict[str, float] = field(default_factory=dict)

    @property
    def verdict_color(self) -> str:
        if "AI" in self.verdict and "Hybrid" not in self.verdict:
            return "#FF4444"
        if "Human" in self.verdict:
            return "#44BB44"
        if "Hybrid" in self.verdict:
            return "#FF8800"
        return "#FFAA00"

    @property
    def is_hybrid(self) -> bool:
        return "Hybrid" in self.verdict

    @property
    def is_out_of_scope(self) -> bool:
        """True when the clip was rejected by any scope gate.

        Covers the duration-based "Out of Scope" verdict and the
        low-band-energy "Out of Scope: bass-stripped" verdict. Sweep /
        eval / dashboard code should filter on this rather than treating
        the 0.5 score as a real verdict.
        """
        return self.verdict.startswith("Out of Scope")

    @property
    def is_bass_stripped(self) -> bool:
        """True when the clip was rejected by the low-band-energy guard.

        Specifically signals the KTH-style high-pass-filter shared
        failure mode (8 kHz HP filter on MSD humans). Distinct from the
        duration-based scope gate so eval code can attribute the
        out-of-scope routing reason.
        """
        return self.verdict == "Out of Scope: bass-stripped"


class EnsembleDetector:
    """Cross-validate detector outputs and produce a single verdict."""

    # Detectors known to be fooled by current-gen models (Suno v5+, Udio v3+).
    # These keyed on transposed-conv checkerboard / first-gen vocoder artifacts
    # that have been engineered out of newer generators. When we detect a v5+
    # situation (lofcz strongly AI but legacy detectors confidently "human"),
    # we downweight these specifically rather than dragging the score with them.
    _LEGACY_DETECTORS_FOOLED_BY_V5 = (
        "fourier", "codec_residual", "fakeprint", "ast", "phase",
        "spectral", "production",
    )

    # Patent Claim 1 marker: the production fakeprint stack remains the four
    # distinct lofcz ONNX heads, and the continuation six-head MoE consensus
    # adds two independent heads that vote on human-confirming physiology /
    # recording realism: vocal_tremor and stereo_realism. They have their own
    # detector outputs (d_*) and fusion weights (w_*), and they enter the
    # inverse guard as peer content-aware brakes.
    _SIX_HEAD_MOE_CONSENSUS_HEADS = (
        "lofcz_v1_baseline",
        "lofcz_v2_lyria_specialist",
        "lofcz_v3",
        "lofcz_v4",
        "vocal_tremor",
        "stereo_realism",
    )

    # Detectors that operate on broad content / timbre / human-recording
    # features. This mirrors docs/audit/methods.md §4.2 and extends the
    # inverse "lofcz overconfidence" guard with the two new six-head MoE
    # voices. If lofcz saturates strongly AI but at least three of these heads
    # are confidently human, lofcz is likely producing a fakeprint-timbre
    # artifact rather than a real AI signal.
    _CONTENT_AWARE_DETECTORS = (
        "cnn", "ast", "highfreq", "onset", "segment", "embedding",
        "vocal_tremor", "stereo_realism",
    )

    # Brick-wall filter guard groups. HP-8k removes bass/mids and makes
    # low-band-dependent heads (especially lofcz in the local KTH profile)
    # overconfident. LP-1k removes air/presence bands and can make high-band
    # specialists untrustworthy. The guard attenuates both their weights and
    # their distance from neutral during fusion.
    _HP_FILTER_DEPENDENT_DETECTORS = (
        "fakeprint", "lofcz", "fourier", "phase", "temporal_lofcz",
    )
    _LP_FILTER_DEPENDENT_DETECTORS = ("highfreq", "cnn", "ast")
    FILTER_GUARD_WEIGHT_FACTOR = 0.10
    FILTER_GUARD_SCORE_FACTOR = 0.20

    # Public detector registry used by audit/reporting tests. It intentionally
    # names the 15 documented fusion detectors plus the two continuation heads;
    # passive/non-fusion decorators such as watermark and loop stay outside
    # this count.
    _DOCUMENTED_DETECTOR_KEYS = (
        "lofcz",
        "cnn",
        "ast",
        "fourier",
        "codec_residual",
        "fakeprint",
        "phase",
        "spectral",
        "production",
        "highfreq",
        "onset",
        "segment",
        "temporal",
        "embedding",
        "lyrics",
        "vocal_tremor",
        "stereo_realism",
    )

    # ------------------------------------------------------------------
    # Configurable consensus-guard parameters (Claims 6, 7, 10, 20, 21)
    # ------------------------------------------------------------------
    # These constants are referenced by both consensus guards so the
    # 21-claim provisional patent can point to a single, named knob per
    # axis. Defaults are byte-identical to the pre-2026-04-30 fusion path
    # (see core/engine.py.pre-claim-lift-batch1 for the prior literals).
    #
    # MIN_QUORUM_FORWARD: minimum number of legacy-subset detectors that
    # must report a non-None score before the v5+ (forward) guard is
    # allowed to fire. Claim 20: "≥3 for the forward condition". The
    # provisional accepts any value ≥1; below 3 the guard becomes more
    # aggressive (single-detector outliers can trigger downweighting).
    MIN_QUORUM_FORWARD = 3
    # MIN_QUORUM_INVERSE: minimum number of content-aware-subset detectors
    # required before the inverse "lofcz overconfidence" guard can fire.
    # Claim 20: "≥2 for the inverse condition". Deployed default is 3
    # (stricter than the claim minimum) — relax to 2 if more permissive
    # FPR-protection on small ensembles is desired.
    MIN_QUORUM_INVERSE = 3
    # GUARD_DOWNWEIGHT_FACTOR: multiplicative weight reduction applied to
    # detectors flagged by either guard. Claim 7: "approximately 4×
    # downweight" → factor = 1/4 = 0.25. Acceptable claim range is 0.10
    # (10× downweight) to 0.50 (2× downweight). Set to 1.0 to disable
    # downweighting entirely (still emits notes for audit-trail purposes).
    GUARD_DOWNWEIGHT_FACTOR = 0.25
    # Forward-guard activation thresholds. The score threshold is the
    # documented <0.40 per-detector condition from methods.md §4.1. The
    # legacy *_MEAN_MAX names are retained as API aliases for older tests and
    # callers, but the guard now counts detectors below the threshold instead
    # of comparing a group mean.
    FORWARD_LOFCZ_THRESHOLD = 0.85
    FORWARD_LEGACY_SCORE_MAX = 0.40
    FORWARD_LEGACY_MEAN_MAX = FORWARD_LEGACY_SCORE_MAX
    # Inverse-guard activation thresholds. Same count-based <0.40 semantics
    # for the documented content detector group from methods.md §4.2.
    INVERSE_LOFCZ_THRESHOLD = 0.85
    INVERSE_CONTENT_SCORE_MAX = 0.40
    INVERSE_CONTENT_MEAN_MAX = INVERSE_CONTENT_SCORE_MAX
    # Tie-break policy when both guards would fire simultaneously
    # (Claim 21). Three modes:
    #   "prefer_forward": apply only the v5+ (forward) guard. This is the
    #       deployed default: matches the pre-2026-04-30 behavior where
    #       the inverse guard is short-circuited via `if not v5_guard_active`.
    #   "prefer_inverse": apply only the lofcz-overconfidence (inverse)
    #       guard. Useful when the deployer wants stricter lofcz FPR
    #       suppression than legacy-detector preservation.
    #   "first_match": apply both guards if both conditions hold (the
    #       forward guard's downweight applies to legacy detectors AND the
    #       inverse guard's downweight applies to lofcz / temporal_lofcz).
    #       Independent application — the two subsets are disjoint by
    #       construction so there is no double-application on the same
    #       detector.
    TIE_BREAK_POLICIES = ("prefer_forward", "prefer_inverse", "first_match")

    # Per-generator attribution thresholds (Hive / IRCAM Amplify parity).
    # The CNN currently sits at ~62.84% val acc on 7 classes (v1.2 retrain),
    # so we don't claim a top-1 generator below this softmax probability —
    # we degrade to the honest "uncertain_ai" bucket instead.
    _GENERATOR_CONFIDENCE_THRESHOLD = 0.40
    # Below this overall AI score we treat the verdict as human and refuse to
    # claim AI generator attribution at all.
    _GENERATOR_AI_GATE = 0.50

    # Public verdict policy. methods.md §4.3 documents the binary operating
    # thresholds as Human <0.35 and AI >=0.65; QA-WIRING v6 also requires the
    # five-bucket user-facing spectrum below.
    DOCUMENTED_HUMAN_THRESHOLD = 0.35
    DOCUMENTED_AI_THRESHOLD = 0.65
    VERDICT_HUMAN_MADE_MAX = 0.20
    VERDICT_LIKELY_HUMAN_MAX = 0.40
    VERDICT_UNCERTAIN_MAX = 0.60
    VERDICT_LIKELY_AI_MAX = 0.80

    # Full-track scope policy. UAI's customer surface (Spotify, Apple Music,
    # Sony, FUGA / DistroKid / Tidal) ingests full songs, not sample-pack
    # loops. Track-level detectors (fakeprint / lofcz / CNN / AST / longcontext)
    # all degrade on <30s clips because their spectral statistics assume many
    # seconds of stationary content. When `full_track_only=True` (default), we
    # return verdict="Out of Scope" for clips below this duration rather than
    # producing a verdict the heads aren't designed for. Buyers who want loop
    # support pass `full_track_only=False` to fall through to the existing
    # loop-detector short-circuit path.
    # MP3 framing and encoder delay commonly make nominal 30.0 s validation
    # clips report as ~29.977 s. Keep the product policy at "about 30 s" while
    # avoiding accidental out-of-scope routing for those tracks.
    _FULL_TRACK_MIN_DURATION_SEC = 29.5

    # ------------------------------------------------------------------
    # Low-band-energy guard rail (KTH self-audit shared failure mode)
    # ------------------------------------------------------------------
    # When bass + mids are stripped (e.g. a high-pass filter at >=8 kHz
    # cutoff), the discriminator has only treble noise to work with.
    # Track-level detectors trained on full-band content treat this as
    # out-of-distribution and default to "AI" (the AI side of the training
    # distribution carries more high-frequency energy on average). The
    # KTH self-audit confirmed that UAI and IRCAM Amplify both produce
    # human FPR=1.00 on MSD humans run through an 8 kHz HP filter.
    #
    # No legitimate music distribution platform ingests bass-stripped
    # audio (that's an editing artifact, not a track), so the honest
    # response is to mark the clip out_of_scope. The gate computes the
    # ratio of energy below 500 Hz to total energy on a ~5 s probe and
    # routes anything below -30 dB through the new "Out of Scope:
    # bass-stripped" verdict.
    _LOW_BAND_ENERGY_THRESHOLD_DB = -30.0
    _LOW_BAND_FREQ_HZ = 500.0
    _LOW_BAND_PROBE_DURATION_SEC = 5.0
    _LOW_BAND_PROBE_SR = 22050

    # Digital silence / near-silence guard rail. Full-length all-zero files can
    # produce confident AI votes because downstream detectors see degenerate
    # spectra outside their training distribution. Route them out of scope
    # before detector fusion; auditors can bypass with ``silence_guard=False``.
    _SILENCE_RMS_THRESHOLD_DB = -60.0
    _NEAR_SILENCE_PEAK_THRESHOLD_DB = -55.0

    # ------------------------------------------------------------------
    #  Claim 16 — duration-gated short-circuit module
    # ------------------------------------------------------------------
    # The loop short-circuit fires when a clip's duration is below the
    # configured threshold AND the periodicity-based detector reports a
    # plausible loop. The 22 s default is the empirical FMA / sample-pack
    # boundary (Codex U FPR fix 2026-04-30): real sample-pack loops stay
    # under 22 s, FMA-medium 30-second excerpts encode at 29.98 s and were
    # being misclassified as loops without this gate. The provisional
    # patent (Claim 16) names only the existence of the threshold, so the
    # value is exposed as a knob for downstream sweeps.
    LOOP_SHORT_CIRCUIT_MAX_DURATION = 22.0
    # Periodicity-based detector activation envelope. The loop detector's
    # autocorrelation peak is mapped to a loop_period in seconds; real
    # 1/2/4/8-bar loops at 60-180 BPM sit in the [0.5, 4.0] s band.
    # >5 s "periods" are usually full-track structure that the periodicity
    # heuristic falsely matched on, hence the upper bound.
    LOOP_SHORT_CIRCUIT_MIN_PERIOD = 0.5
    LOOP_SHORT_CIRCUIT_MAX_PERIOD = 4.0
    # Minimum loop-detector confidence required to short-circuit. Below
    # this we fall through to the regular ensemble fusion path.
    LOOP_SHORT_CIRCUIT_MIN_CONFIDENCE = 0.30

    # ------------------------------------------------------------------
    #  Claim 13 — hybrid-zone duration policy
    # ------------------------------------------------------------------
    # Hybrid zones below this duration are filtered out of the verdict-
    # policy decision (they're treated as transient false-positives from
    # the temporal scorer's per-window jitter rather than a stable
    # AI-leaning passage). Defaults to 0.0 to preserve the pre-2026-04-30
    # behavior where every emitted zone counted; bump to e.g. 4.0 to
    # require at least one half-hop's worth of contiguous AI evidence
    # before flagging hybrid.
    HYBRID_ZONE_MIN_DURATION_SEC = 0.0

    def __init__(
        self,
        cnn_model_path: Optional[str] = None,
        ast_model_path: Optional[str] = None,
        device: Optional[str] = None,
        sr: int = 22050,
        ai_threshold: float = DOCUMENTED_AI_THRESHOLD,
        human_threshold: float = DOCUMENTED_HUMAN_THRESHOLD,
        enable_segments: bool = True,
        enable_temporal: bool = True,
        enable_longcontext: bool = True,
        fusion_mode: str = "confidence_weighted",
        full_track_only: bool = True,
        low_band_guard: bool = True,
        silence_guard: bool = True,
        batch_mode: bool = False,
        validation_mode: bool = False,
        enable_aimd: bool = False,
        use_calibration_head: bool = True,
        use_v1_4_4way_calibration: bool = True,
        calibration_head_path: Optional[str] = None,
        # ---- Consensus-guard parameters (Claims 6, 7, 10, 20, 21) ------
        # Each defaults to the class-level constant so out-of-the-box
        # behavior is byte-identical to the pre-2026-04-30 fusion path.
        # Override per-instance to exercise the broader claim ranges in
        # benchmark sweeps without retraining or branching.
        min_quorum_forward: Optional[int] = None,
        min_quorum_inverse: Optional[int] = None,
        guard_downweight_factor: Optional[float] = None,
        forward_lofcz_threshold: Optional[float] = None,
        forward_legacy_mean_max: Optional[float] = None,
        inverse_lofcz_threshold: Optional[float] = None,
        inverse_content_mean_max: Optional[float] = None,
        legacy_detector_group: Optional[Tuple[str, ...]] = None,
        content_aware_detector_group: Optional[Tuple[str, ...]] = None,
        tie_break_policy: str = "prefer_forward",
        # ---- Loop short-circuit knobs (Claim 16) -----------------------
        loop_short_circuit_max_duration: Optional[float] = None,
        loop_short_circuit_min_period: Optional[float] = None,
        loop_short_circuit_max_period: Optional[float] = None,
        loop_short_circuit_min_confidence: Optional[float] = None,
        # ---- Hybrid-zone duration policy (Claim 13) --------------------
        hybrid_zone_min_duration_sec: Optional[float] = None,
        # ---- Post-aggregator genre calibration -------------------------
        enable_classical_calibration: bool = True,
        # ---- Learned post-ensemble calibration ------------------------
        # Loaded fail-open from models/calibration_head_v1_3.json when present,
        # otherwise models/calibration_head_v1.json.
        calibration_precompute_paths: Optional[Sequence[str]] = None,
        # ---- Bootstrap confidence intervals ---------------------------
        compute_confidence_intervals: bool = False,
        compute_detector_confidence_intervals: bool = False,
        ci_n_bootstrap: int = 500,
        ci_segment_sec: float = 8.0,
        ci_hop_sec: float = 4.0,
        ci_rng_seed: int = 42,
    ):
        """
        fusion_mode:
          - "simple": legacy fixed-weight sum (pre-v5.5-upgrade behavior)
          - "confidence_weighted" (default): each detector contribution is
            scaled by |score - 0.5| * 2. Detectors at 0.5 (no signal) contribute
            nothing; detectors near 0 or 1 contribute their full base weight.
            Also applies a "v5+ guard" that downweights detectors known to be
            fooled by Suno v5+ / Udio v3+ when those conditions are detected.

        Consensus-guard parameters (None → use the class-level default
        constant; override to exercise the broader patent claim ranges):

          - min_quorum_forward: ≥1 (Claim 20, default 3)
          - min_quorum_inverse: ≥1 (Claim 20, default 3)
          - guard_downweight_factor: in (0, 1] (Claim 7, default 0.25)
          - forward_lofcz_threshold: in [0, 1] (Claim 7, default 0.85)
          - forward_legacy_mean_max: in [0, 1] (Claim 7, default 0.40);
            retained name, now used as the per-detector low-score threshold.
          - inverse_lofcz_threshold: in [0, 1] (Claim 7, default 0.85)
          - inverse_content_mean_max: in [0, 1] (Claim 7, default 0.40);
            retained name, now used as the per-detector low-score threshold.
          - legacy_detector_group: tuple of detector names overriding
            the class-level _LEGACY_DETECTORS_FOOLED_BY_V5 (Claims 8, 10).
          - content_aware_detector_group: tuple of detector names
            overriding _CONTENT_AWARE_DETECTORS (Claims 9, 10).
          - tie_break_policy: one of {"prefer_forward", "prefer_inverse",
            "first_match"} controlling behavior when both guards fire
            (Claim 21, default "prefer_forward" matches pre-2026-04-30
            behavior).

        Loop short-circuit knobs (Claim 16):
          - loop_short_circuit_max_duration: > 0 (default 22.0 s).
            Above this, the periodicity-based detector cannot route the
            verdict through the loop path.
          - loop_short_circuit_min_period: > 0 (default 0.5 s).
          - loop_short_circuit_max_period: > min_period (default 4.0 s).
          - loop_short_circuit_min_confidence: in [0, 1] (default 0.30).

        Hybrid-zone duration policy (Claim 13):
          - hybrid_zone_min_duration_sec: >= 0 (default 0.0 — no
            filtering). Set to a positive value to require contiguous
            AI-leaning evidence of at least that duration before a zone
            counts toward the verdict.

        Classical calibration:
          - enable_classical_calibration: bool (default True). When True,
            the already-fused score is passed through the persisted
            Classical isotonic calibration only when the caller supplies
            ``genre_probs`` with ``classical`` probability > 0.6. This is a
            post-aggregator stage: detector weights, lofcz aggregation,
            v4-pin promotion, and modspec weight stay unchanged.

        Learned calibration head:
          - use_calibration_head: bool (default True). When True and
            ``models/calibration_head_v1_3.json`` exists, the post-fusion
            score is passed through the XGBoost calibration head before verdict
            thresholds are applied. If the v1.3 model is missing, the engine
            falls back to ``models/calibration_head_v1.json``. Missing or
            unloadable models fail open to the raw ensemble score with a
            warning.

          - use_v1_4_4way_calibration: bool (default True). When True and
            the v1.4 stem-aware model files exist, per-stem callers can route
            stem scores through the v1.4 binary stem heads and optional 4-way
            class head. Missing v1.4 files fail open to the v1.3.1/full-mix
            calibration path.

          - calibration_precompute_paths: optional sequence of audio paths.
            When supplied, the calibration audio summary features are cached at
            construction so batch scoring pays the librosa feature cost once.

        Low-band-energy guard rail:
          - low_band_guard: bool (default True). When True (the
            production setting), audio with energy below 500 Hz that is
            more than 30 dB below total spectral energy is routed to a
            new "Out of Scope: bass-stripped" verdict. Closes the KTH
            self-audit shared UAI / IRCAM failure mode at 8 kHz HP.
            Only active when ``full_track_only=True``. Set to False if
            scoring on bass-stripped material is a legitimate use case.

        Silence guard:
          - silence_guard: bool (default True). When True, digital silence
            and near-silence where both RMS and peak amplitude sit below
            production thresholds are routed to "Out of Scope: silence".
            Set to False for audits that intentionally score silence.

        Batch mode:
          - batch_mode: bool (default False). When True, lazy Torch/HF
            detectors are warmed during construction and per-track scratch
            state is collected before every ``analyze()`` call so long-running
            validation workers keep model weights loaded without accumulating
            prior-track intermediates.

        Validation mode:
          - validation_mode: bool (default False). Keeps the patented MoE /
            consensus architecture active but skips expensive diagnostic
            detectors that have zero or tiny validation-fusion value. This is
            intended for large-batch throughput harnesses, not production
            customer reports.

        Bootstrap confidence intervals:
          - compute_confidence_intervals: bool (default False). When True,
            runs an additional raw-waveform segment pass and attaches 95%
            bootstrap intervals for the final ensemble score.
          - compute_detector_confidence_intervals: bool (default False).
            When True, also attaches per-detector CIs in
            ``result.detector_score_cis``. This implies the ensemble CI pass
            and is off by default because it increases report payload size and
            segment-pass bookkeeping.
          - ci_n_bootstrap / ci_segment_sec / ci_hop_sec / ci_rng_seed:
            deterministic bootstrap and segmentation controls.
        """
        trial = check_trial()
        if not trial["valid"]:
            raise PermissionError(trial["message"])
        if fusion_mode not in ("simple", "confidence_weighted"):
            raise ValueError(f"fusion_mode must be 'simple' or 'confidence_weighted', got {fusion_mode!r}")
        self.fusion_mode = fusion_mode
        self._root = Path(__file__).resolve().parent.parent
        self.device = self._resolve_device(device)
        self.batch_mode = bool(batch_mode)
        self.validation_mode = bool(validation_mode)
        self.use_calibration_head = bool(use_calibration_head)
        self.use_v1_4_4way_calibration = bool(use_v1_4_4way_calibration)
        self.calibration_head_path = self._resolve_calibration_head_path(
            calibration_head_path
        )
        self.calibration_head = self._load_calibration_head()
        self.v1_4_4way_calibration = self._load_v1_4_4way_calibration()
        self.v1_4_stem_calibration_heads = self._load_v1_4_stem_calibration_heads()
        self._calibration_audio_features_by_path: Dict[str, Dict[str, float]] = {}
        if calibration_precompute_paths:
            self.precompute_calibration_audio_features(calibration_precompute_paths)
        self._fast_batch_profile = bool(
            self.validation_mode
            or (
                self.batch_mode
                and not enable_segments
                and not enable_temporal
                and not enable_longcontext
            )
        )
        optional_cnn_model_path = cnn_model_path
        optional_ast_model_path = ast_model_path

        if cnn_model_path is None:
            bundled_cnn = resolve_model_path("cnn", root=self._root, verify=True)
            if bundled_cnn is None:
                raise RuntimeError("Required bundled CNN model is missing")
            cnn_model_path = str(bundled_cnn)
        if ast_model_path is None:
            bundled_ast = resolve_model_path("ast", root=self._root, verify=True)
            if bundled_ast is None:
                raise RuntimeError("Required bundled AST model is missing")
            ast_model_path = str(bundled_ast)
        self._cnn_model_path = Path(cnn_model_path).resolve()
        self._ast_model_path = Path(ast_model_path).resolve()

        # ---- Resolve consensus-guard parameters --------------------------
        if tie_break_policy not in self.TIE_BREAK_POLICIES:
            raise ValueError(
                f"tie_break_policy must be one of {self.TIE_BREAK_POLICIES!r}, "
                f"got {tie_break_policy!r}"
            )
        cls = type(self)
        self.min_quorum_forward = (
            int(min_quorum_forward)
            if min_quorum_forward is not None
            else cls.MIN_QUORUM_FORWARD
        )
        self.min_quorum_inverse = (
            int(min_quorum_inverse)
            if min_quorum_inverse is not None
            else cls.MIN_QUORUM_INVERSE
        )
        if self.min_quorum_forward < 1:
            raise ValueError("min_quorum_forward must be >= 1")
        if self.min_quorum_inverse < 1:
            raise ValueError("min_quorum_inverse must be >= 1")
        self.guard_downweight_factor = (
            float(guard_downweight_factor)
            if guard_downweight_factor is not None
            else cls.GUARD_DOWNWEIGHT_FACTOR
        )
        if not (0.0 < self.guard_downweight_factor <= 1.0):
            raise ValueError(
                "guard_downweight_factor must be in (0, 1]; "
                f"got {self.guard_downweight_factor!r}"
            )
        self.forward_lofcz_threshold = (
            float(forward_lofcz_threshold)
            if forward_lofcz_threshold is not None
            else cls.FORWARD_LOFCZ_THRESHOLD
        )
        self.forward_legacy_mean_max = (
            float(forward_legacy_mean_max)
            if forward_legacy_mean_max is not None
            else cls.FORWARD_LEGACY_MEAN_MAX
        )
        self.inverse_lofcz_threshold = (
            float(inverse_lofcz_threshold)
            if inverse_lofcz_threshold is not None
            else cls.INVERSE_LOFCZ_THRESHOLD
        )
        self.inverse_content_mean_max = (
            float(inverse_content_mean_max)
            if inverse_content_mean_max is not None
            else cls.INVERSE_CONTENT_MEAN_MAX
        )
        self.legacy_detector_group = (
            tuple(legacy_detector_group)
            if legacy_detector_group is not None
            else cls._LEGACY_DETECTORS_FOOLED_BY_V5
        )
        self.content_aware_detector_group = (
            tuple(content_aware_detector_group)
            if content_aware_detector_group is not None
            else cls._CONTENT_AWARE_DETECTORS
        )
        self.tie_break_policy = tie_break_policy

        # ---- Resolve loop short-circuit parameters (Claim 16) -----------
        self.loop_short_circuit_max_duration = (
            float(loop_short_circuit_max_duration)
            if loop_short_circuit_max_duration is not None
            else cls.LOOP_SHORT_CIRCUIT_MAX_DURATION
        )
        if self.loop_short_circuit_max_duration <= 0:
            raise ValueError(
                "loop_short_circuit_max_duration must be > 0; got "
                f"{self.loop_short_circuit_max_duration!r}"
            )
        self.loop_short_circuit_min_period = (
            float(loop_short_circuit_min_period)
            if loop_short_circuit_min_period is not None
            else cls.LOOP_SHORT_CIRCUIT_MIN_PERIOD
        )
        self.loop_short_circuit_max_period = (
            float(loop_short_circuit_max_period)
            if loop_short_circuit_max_period is not None
            else cls.LOOP_SHORT_CIRCUIT_MAX_PERIOD
        )
        if self.loop_short_circuit_min_period <= 0:
            raise ValueError(
                "loop_short_circuit_min_period must be > 0; got "
                f"{self.loop_short_circuit_min_period!r}"
            )
        if self.loop_short_circuit_max_period <= self.loop_short_circuit_min_period:
            raise ValueError(
                "loop_short_circuit_max_period must exceed "
                "loop_short_circuit_min_period"
            )
        self.loop_short_circuit_min_confidence = (
            float(loop_short_circuit_min_confidence)
            if loop_short_circuit_min_confidence is not None
            else cls.LOOP_SHORT_CIRCUIT_MIN_CONFIDENCE
        )
        if not (0.0 <= self.loop_short_circuit_min_confidence <= 1.0):
            raise ValueError(
                "loop_short_circuit_min_confidence must be in [0, 1]"
            )

        # ---- Resolve hybrid-zone duration policy (Claim 13) -------------
        self.hybrid_zone_min_duration_sec = (
            float(hybrid_zone_min_duration_sec)
            if hybrid_zone_min_duration_sec is not None
            else cls.HYBRID_ZONE_MIN_DURATION_SEC
        )
        if self.hybrid_zone_min_duration_sec < 0:
            raise ValueError(
                "hybrid_zone_min_duration_sec must be >= 0"
            )

        self.fourier = FourierDetector(sr=sr)
        self.fakeprint = FakePrintDetector(sr=max(44100, sr))
        self.spectral = SpectralDetector(sr=sr)
        self.codec_residual = CodecResidualDetector(sr=max(44100, sr))
        self.phase = PhaseDetector(sr=max(44100, sr))
        self.highfreq = HighFrequencyDetector(sr=max(44100, sr))
        self.onset = OnsetTimingDetector(sr=sr)
        self.lyrics = self._make_lyrics_detector()
        self.production = ProductionDetector(sr=max(44100, sr))
        # MoE lofcz: 4-head ensemble with confidence-weighted soft voting plus
        # asymmetric v4-augmented-pinned promotion (Codex ZZ Path C, 2026-04-30,
        # extended by Codex DELTA, 2026-04-30 with v5 retrain awareness).
        #
        #   * lofcz_v1_baseline:         original Suno specialist
        #     (after v5 hot-swap: v1 + augmentation, see scripts/retrain_lofcz_v5.py)
        #   * lofcz_v2_lyria_specialist: Lyria 3 / later-gen Suno specialist
        #     (after v5 hot-swap: v2_lyria + augmentation)
        #   * lofcz_v3:                  Codex V's v3 (broad-human-prior trained
        #     on ~4000 FMA-medium humans, dropped FMA FPR 13.6% to 0.80%). High
        #     un-attacked AI recall (98.4% on training cache, 93.7% on Lyria).
        #   * lofcz_v4:                  Codex VV's adversarial-augmented head
        #     (pitch+/-1/+2/-2, stretch+/-5%, reverb+medium augmentations
        #     in training). Head-level 70-84% adversarial invariance on
        #     pitch/stretch attacks. Lower un-attacked Lyria recall (76%).
        #
        # The v5 hot-swap (Codex DELTA, 2026-04-30) replaces lofcz_v1_baseline
        # and lofcz_v2_lyria_specialist contents in-place with their
        # adversarially-augmented counterparts — same MoE constructor, same head
        # count, just better LR weights. After v5 every MoE head should have
        # 40-50%+ pitch-shift adversarial recall, removing the need for the
        # asymmetric v4-pin promotion (we keep the pin code path alive but the
        # gating threshold can be made stricter once cross-corpus FPR is
        # validated on Jamendo).
        #
        # Why this 4-head structure (per Codex ZZ): a 3-head MoE replacing v3
        # with v4 (the previous "VV hot-swap") regresses un-attacked AI recall
        # 30 pts because v4 was trained for adversarial invariance at the cost
        # of clean Lyria recall. Keeping v3 as a separate head means soft-vote
        # on un-attacked AI is dominated by v3 (high-recall baseline), while
        # v4-pin promotion still fires on adversarial AI when ALL THREE legacy
        # heads (v1, v2_lyria, v3) collapse to <0.20. The pin's "all others
        # confidently human" trigger is stricter with 4 heads than 3, which
        # tightens the FPR risk on borderline humans.
        #
        # Empirical baselines on the 5279-track training cache:
        #   v1 only            AI rec 80.6% / FPR 3.10%
        #   v2-lyria only      AI rec 99.1% / FPR 4.77%
        #   v3 only            AI rec 98.4% / FPR 0.07%
        #   v4 only            AI rec 92.0% / FPR 0.33%  (Lyria 76%, adversarial-augmented)
        #   v1+v2-lyria+v3 MoE AI rec 98.1% / FPR 0.68%  (Codex V baseline)
        #   4-head MoE (this)  Path C — projected ≤1% FPR + adversarial recovery
        #
        # The startup manifest/assertion below intentionally crashes if any
        # required head is absent or duplicated. The 2026-05-03 wiring audit
        # found that silent subset loading hid an orphaned v4 head in prod.
        _moe_candidates = [
            self._root / "models/lofcz_v1_baseline",
            self._root / "models/lofcz_v2_lyria_specialist",
            self._root / "models/lofcz_v3",
            self._root / "models/lofcz_v4",
        ]
        self._verify_required_lofcz_heads(_moe_candidates)
        self.lofcz = LofczDetector(
            model_dirs=[str(d) for d in _moe_candidates],
            device=self.device,
        )
        # Frame-level lofcz (Resemble DETECT-2B-style coarse temporal head):
        # slides a 30s/15s window over the audio and scores each window
        # through the SAME MoE lofcz heads, producing a per-segment AI
        # probability series + contiguous "hybrid_zones". No new training,
        # ~0.3s extra inference per track.
        try:
            self.temporal_lofcz = (
                None
                if self._fast_batch_profile
                else TemporalLofczDetector(
                    model_dirs=_moe_candidates,
                    device=self.device,
                )
            )
        except Exception as exc:
            logger.warning("Temporal-lofcz detector init failed (will be no-op): %s", exc)
            self.temporal_lofcz = None
        # Modulation-spectrum (reverb-aware complementary feature, Codex DELTA
        # 2026-04-30). The detector is *opt-in*: if `models/modspec/` doesn't
        # exist or fails to load, ModspecDetector.model_loaded is False and we
        # treat the score as None (weight=0). This means the new code is safe
        # to ship before the model is trained — engine behaviour is identical
        # to today until weights are dropped in.
        try:
            self.modspec = None if self._fast_batch_profile else ModspecDetector(device=self.device)
        except Exception as exc:
            logger.warning("Modspec detector init failed (will be no-op): %s", exc)
            self.modspec = None
        # CLAP-embedding detector — generator-invariant timbre fingerprint via
        # nearest-neighbour distance to a reference bank of known-AI / known-human.
        # Loads the bank from disk if present; gracefully degrades to no-op if not.
        if self._fast_batch_profile:
            self.embedding = None
        else:
            try:
                self.embedding = EmbeddingDetector(device=self.device)
            except Exception as exc:
                logger.warning("Embedding detector init failed (will be no-op): %s", exc)
                self.embedding = None
        # Six-head MoE continuation heads (Patent Claim 1 marker):
        # these are independent CPU signal models, not extra lofcz ONNX
        # sessions. They add human-confirming evidence that the four fakeprint
        # heads do not observe: vocal F0 micro-tremor and physically realistic
        # stereo imaging.
        #
        # PERF-NOTE (v1.3 post-Lambda-revalidation): pYIN-based vocal_tremor
        # costs ~21s/track on a 2x H100 in fast/no-segment mode while
        # contributing zero to the consensus score in that mode (analyst
        # ablation showed only lofcz has non-zero weight when
        # _fast_batch_profile is True). We therefore gate both Lane 3 heads
        # behind the fast_batch_profile to preserve validation-mode throughput.
        # In production (non-fast) mode they remain active and contribute their
        # 0.04 weights as designed.
        if self._fast_batch_profile:
            self.vocal_tremor = None
            self.stereo_realism = None
        else:
            try:
                self.vocal_tremor = VocalTremorDetector(device=self.device)
            except Exception as exc:
                logger.warning("Vocal micro-tremor detector init failed (will be no-op): %s", exc)
                self.vocal_tremor = None
            try:
                self.stereo_realism = StereoRealismDetector(
                    device=self.device,
                    reference_path=self._root / "models" / "stereo_reference_v1.json",
                )
            except Exception as exc:
                logger.warning("Stereo-imaging realism detector init failed (will be no-op): %s", exc)
                self.stereo_realism = None
        # Passive watermark verifier — reads C2PA Content Credentials and
        # AudioSeal markers (no-op for SynthID until Google ships a public
        # verifier). Gives free recall on AI generators that publish
        # provenance signatures. Cheap (<1s/track) and fail-soft: a hard
        # detection sets watermark_score=1.0, anything else is 0.0/0.5.
        try:
            self.watermark = WatermarkDetector()
        except Exception as exc:
            logger.warning("Watermark detector init failed (will be no-op): %s", exc)
            self.watermark = None
        # Loop detector — closes the <30s short-clip blind spot (e.g. ElevenLabs
        # sample-pack loops) where track-level detectors degrade because their
        # spectral statistics assume many seconds of material. Pure signal
        # processing, no training data, ~5ms/clip. When loop.is_loop=True the
        # ensemble short-circuits to give this detector heavy weight.
        try:
            self.loop = LoopDetector()
        except Exception as exc:
            logger.warning("Loop detector init failed (will be no-op): %s", exc)
            self.loop = None
        self.cnn = CNNDetector(
            model_path=None if self._fast_batch_profile else str(self._cnn_model_path),
            sr=sr,
            device=self.device,
        )
        self.ast = ASTDetector(
            model_path=None if self._fast_batch_profile else str(self._ast_model_path),
            device=self.device,
        )
        # AI-Music-Detection AST-60s — public HF specialist head. Fine-tuned
        # on 60s windows; empirically lifts overall AI recall on the 166-track
        # corpus from ~76% toward ~88%, with the strongest gains on Suno-likely
        # tracks where the lofcz MoE wavers (Flint 28%->67%, Dor 47%->80%,
        # Ziso 57%->86%). Cleared the 1 human reference at 0.065. Weaker than
        # lofcz on ElevenLabs sample-pack loops, so the loop short-circuit
        # still owns those — this head is additive, not a replacement.
        # Lazy-loads on first analyze(); no-op if HF unreachable.
        if enable_aimd and not self._fast_batch_profile:
            try:
                self.aimd = AIMDDetector(device=self.device)
            except Exception as exc:
                logger.warning("AIMD detector init failed (will be no-op): %s", exc)
                self.aimd = None
        else:
            self.aimd = None
        self.segment = SegmentDetector(
            sr=sr,
            cnn_model_path=optional_cnn_model_path,
            ast_model_path=optional_ast_model_path,
            device=self.device,
        ) if enable_segments else None
        self.temporal = TemporalDetector(
            cnn_model_path=optional_cnn_model_path,
            sr=sr,
            device=self.device,
        ) if enable_temporal else None
        self.longcontext = LongContextDetector(sr=sr) if enable_longcontext else None
        # SpecTTTra long-context distillation — SONICS (ICLR 2025) checkpoint
        # for 120s temporal/spectral patch transformer. Lazy-loaded; gracefully
        # no-ops if HF download fails or `sonics` package isn't installed.
        # Sits alongside the heuristic LongContextDetector rather than
        # replacing it (the heuristic is fast + always available; SpecTTTra
        # contributes a true ML signal at long scale on Suno/Udio-era fakes).
        try:
            self.spectttra = SpecTTTraDetector(device=self.device) if enable_longcontext else None
        except Exception as exc:
            logger.warning("SpecTTTra detector init failed (will be no-op): %s", exc)
            self.spectttra = None

        self.ai_threshold = ai_threshold
        self.human_threshold = human_threshold
        self.sr = int(sr)
        self.enable_segments = enable_segments
        self.enable_temporal = enable_temporal
        self.enable_longcontext = enable_longcontext
        self.full_track_only = full_track_only
        self.low_band_guard = bool(low_band_guard)
        self.silence_guard = bool(silence_guard)
        self.enable_classical_calibration = bool(enable_classical_calibration)
        self.compute_confidence_intervals = bool(
            compute_confidence_intervals or compute_detector_confidence_intervals
        )
        self.compute_detector_confidence_intervals = bool(compute_detector_confidence_intervals)
        if int(ci_n_bootstrap) < 1:
            raise ValueError("ci_n_bootstrap must be >= 1")
        if float(ci_segment_sec) <= 0.0:
            raise ValueError("ci_segment_sec must be > 0")
        if float(ci_hop_sec) <= 0.0:
            raise ValueError("ci_hop_sec must be > 0")
        self.ci_n_bootstrap = int(ci_n_bootstrap)
        self.ci_segment_sec = float(ci_segment_sec)
        self.ci_hop_sec = float(ci_hop_sec)
        self.ci_rng_seed = int(ci_rng_seed)
        self.ci_computer = BootstrapCIComputer(
            n_bootstrap=self.ci_n_bootstrap,
            segment_sec=self.ci_segment_sec,
            rng_seed=self.ci_rng_seed,
        )
        self.detectors = self._documented_detector_registry()
        self._assert_required_components_loaded()
        if self.batch_mode:
            self._warm_up_batch_detectors()
        self._load_manifest = self._emit_load_manifest()
        logger.info("EnsembleDetector load manifest: %s", self._load_manifest)
        self._detector_load_state = self._snapshot_detector_load_state()

    def _snapshot_detector_load_state(self) -> Dict[str, str]:
        """Record which detectors actually loaded vs fell back to a neutral 0.5.

        Surfaced in ``EnsembleResult.analysis_metadata['detector_load_state']``
        so audit trails make the silent-fallback set explicit. Statuses:
            "loaded"   — detector reports model_loaded=True (or no fallback path)
            "fallback" — detector reports model_loaded=False (returns 0.5)
            "absent"   — detector slot exists but is None/unset
            "n/a"      — detector has no model_loaded attribute and no clear signal
        """
        state: Dict[str, str] = {}
        candidate_attrs = (
            "ast", "cnn", "codec_residual", "embedding", "fakeprint",
            "fourier", "highfreq", "lofcz", "longcontext", "loop", "lyrics",
            "modspec", "onset", "phase", "production", "segment", "spectral",
            "spectttra", "stereo_realism", "temporal", "temporal_lofcz",
            "vocal_tremor", "watermark", "aimd",
        )
        for attr in candidate_attrs:
            det = getattr(self, attr, None)
            if det is None:
                state[attr] = "absent"
                continue
            ml = getattr(det, "model_loaded", None)
            if ml is None:
                ml = getattr(det, "is_loaded", None)
            if ml is True:
                state[attr] = "loaded"
            elif ml is False:
                state[attr] = "fallback"
            else:
                state[attr] = "n/a"
        # Calibration heads are part of the load surface too.
        state["calibration_head"] = "loaded" if getattr(self, "calibration_head", None) is not None else "absent"
        state["v1_4_4way_calibration"] = "loaded" if getattr(self, "v1_4_4way_calibration", None) is not None else "absent"
        v1_4_stem = getattr(self, "v1_4_stem_calibration_heads", {}) or {}
        state["v1_4_stem_calibration_heads"] = (
            "loaded" if v1_4_stem else "absent"
        )
        return state

    def _make_lyrics_detector(self) -> LyricsDetector:
        """Create the lyrics detector with the engine-selected device."""
        return LyricsDetector(model_name="base", device=self.device)

    def _documented_detector_registry(self) -> Dict[str, object]:
        """Return the 17-detector public registry for audit wiring tests."""
        return {name: getattr(self, name, None) for name in self._DOCUMENTED_DETECTOR_KEYS}

    @staticmethod
    def _resolve_device(device: Optional[str]) -> str:
        """Resolve the runtime device without auto-selecting Mac MPS.

        Mac audit runs must be CPU-reproducible by default. Linux can still
        pick CUDA automatically for Lambda/GPU hosts, and explicit user
        overrides such as ``device="mps"`` are honored.
        """
        if device is not None:
            return str(device).strip().lower()
        if platform.system() == "Darwin":
            return "cpu"
        if platform.system() == "Linux":
            try:
                import torch  # noqa: WPS433 - optional runtime dependency
                if torch.cuda.is_available():
                    return "cuda"
            except Exception:
                pass
        return "cpu"

    def _resolve_calibration_head_path(
        self,
        calibration_head_path: Optional[str],
    ) -> Path:
        """Resolve the learned calibration head model path."""
        if calibration_head_path:
            path = Path(calibration_head_path)
            return path if path.is_absolute() else self._root / path
        v1_3 = self._root / "models" / "calibration_head_v1_3.json"
        if v1_3.exists():
            return v1_3
        return self._root / "models" / "calibration_head_v1.json"

    @staticmethod
    def _load_head_or_warn(loader_cls, path: Path, label: str, warn_on_missing: bool):
        """Generic fail-open loader used by all three calibration head loaders.

        Returns the loaded head, or ``None`` if the file is missing or load fails.
        Warns about missing files only when ``warn_on_missing`` is true (the
        primary calibration head opts in; the optional v1.4 heads opt out so an
        absent file is silent, since absence is the expected default).
        """
        if not path.exists():
            if warn_on_missing:
                logger.warning(
                    "%s requested but model file is missing at %s; using raw ensemble score",
                    label,
                    path,
                )
            return None
        try:
            return loader_cls.load(path)
        except Exception as exc:  # noqa: BLE001
            logger.warning("%s failed to load from %s: %s", label, path, exc)
            return None

    def _load_calibration_head(self) -> Optional[CalibrationHead]:
        """Load the learned calibration head, failing open when unavailable."""
        if not getattr(self, "use_calibration_head", True):
            return None
        path = getattr(
            self,
            "calibration_head_path",
            self._resolve_calibration_head_path(None),
        )
        return self._load_head_or_warn(
            CalibrationHead, path, "Calibration head", warn_on_missing=True
        )

    def _load_v1_4_4way_calibration(self) -> Optional[FourWayCalibrationHead]:
        """Load the optional v1.4 four-way class head."""
        if not getattr(self, "use_v1_4_4way_calibration", True):
            return None
        path = self._root / "models" / V1_4_4WAY_MODEL_PATH.name
        return self._load_head_or_warn(
            FourWayCalibrationHead, path, "v1.4 4-way calibration head", warn_on_missing=False
        )

    def _load_v1_4_stem_calibration_heads(self) -> Dict[str, CalibrationHead]:
        """Load optional v1.4 per-stem binary calibration heads."""
        if not getattr(self, "use_v1_4_4way_calibration", True):
            return {}
        heads: Dict[str, CalibrationHead] = {}
        model_dir = self._root / "models"
        for stem in ("vocals", "drums", "bass", "other"):
            path = model_dir / V1_4_STEM_MODEL_TEMPLATE.format(stem=stem)
            head = self._load_head_or_warn(
                CalibrationHead, path, f"v1.4 stem calibration head ({stem})", warn_on_missing=False
            )
            if head is not None:
                heads[stem] = head
        return heads

    def _calibration_head_uses_audio_features(self) -> bool:
        heads = [getattr(self, "calibration_head", None)]
        heads.append(getattr(self, "v1_4_4way_calibration", None))
        heads.extend((getattr(self, "v1_4_stem_calibration_heads", {}) or {}).values())
        names = {
            name
            for head in heads
            if head is not None
            for name in (getattr(head, "feature_names", []) or [])
        }
        return any(name in names for name in AUDIO_FEATURE_NAMES)

    def precompute_calibration_audio_features(
        self,
        audio_paths: Sequence[str],
    ) -> Dict[str, Dict[str, float]]:
        """Cache calibration audio summaries for known upcoming tracks."""
        if not self._calibration_head_uses_audio_features():
            return {}
        paths = [str(path) for path in audio_paths if path]
        if not paths:
            return {}
        missing = [
            path
            for path in dict.fromkeys(paths)
            if path not in self._calibration_audio_features_by_path
        ]
        if missing:
            self._calibration_audio_features_by_path.update(
                precompute_audio_features(missing)
            )
        return {
            path: self._calibration_audio_features_by_path[path]
            for path in paths
            if path in self._calibration_audio_features_by_path
        }

    def _calibration_audio_features_for_path(
        self,
        audio_path: str,
    ) -> Optional[Dict[str, float]]:
        if not self._calibration_head_uses_audio_features():
            return None
        key = str(audio_path)
        if key not in self._calibration_audio_features_by_path:
            self.precompute_calibration_audio_features([key])
        return self._calibration_audio_features_by_path.get(key)

    def predict_v1_4_4way_class(
        self,
        *,
        score: float,
        scores: Dict[str, Optional[float]],
        audio_path: str,
        stem_type: str,
        genre_probs: Optional[Dict[str, float]] = None,
    ) -> Optional[Dict[str, object]]:
        """Return the optional v1.4 4-way class prediction for a row."""
        head = getattr(self, "v1_4_4way_calibration", None)
        if head is None:
            return None
        try:
            feature_row = build_stem_aware_feature_dict(
                scores,
                raw_score=score,
                audio_path=audio_path,
                stem_type=stem_type,
                genre_probs=genre_probs,
                feature_names=head.feature_names,
                audio_features=self._calibration_audio_features_for_path(audio_path),
            )
            probabilities = head.predict_proba([feature_row])[0]
            labels = list(getattr(head, "class_names", []) or [])
            if not labels:
                labels = [str(index) for index in range(len(probabilities))]
            best_index = int(np.argmax(probabilities))
            return {
                "class": labels[best_index],
                "confidence": float(probabilities[best_index]),
                "probabilities": {
                    labels[index]: float(probabilities[index])
                    for index in range(min(len(labels), len(probabilities)))
                },
            }
        except Exception as exc:  # noqa: BLE001
            logger.warning("v1.4 4-way calibration inference failed: %s", exc)
            return None

    def apply_v1_4_stem_calibration(
        self,
        *,
        score: float,
        scores: Dict[str, Optional[float]],
        audio_path: str,
        stem_type: str,
        genre_probs: Optional[Dict[str, float]] = None,
    ) -> Optional[float]:
        """Return a v1.4 per-stem calibrated AI probability, if available."""
        if not getattr(self, "use_v1_4_4way_calibration", True):
            return None
        head = (getattr(self, "v1_4_stem_calibration_heads", {}) or {}).get(stem_type)
        if head is None:
            return None
        try:
            feature_row = build_stem_aware_feature_dict(
                scores,
                raw_score=score,
                audio_path=audio_path,
                stem_type=stem_type,
                genre_probs=genre_probs,
                feature_names=head.feature_names,
                audio_features=self._calibration_audio_features_for_path(audio_path),
            )
            calibrated = float(head.predict_proba([feature_row])[0])
        except Exception as exc:  # noqa: BLE001
            logger.warning("v1.4 stem calibration inference failed for %s: %s", stem_type, exc)
            return None
        if not np.isfinite(calibrated):
            return None
        return float(np.clip(calibrated, 0.0, 1.0))

    @staticmethod
    def _verify_required_lofcz_heads(model_dirs: List[Path]) -> None:
        """Verify the required production MoE heads exist and are distinct."""
        missing = []
        head_hashes = []
        for model_dir in model_dirs:
            onnx_path = model_dir / "ai_music_detector.onnx"
            if not onnx_path.exists():
                missing.append(str(onnx_path))
                continue
            head_hashes.append(file_sha256(onnx_path))
        if missing:
            raise RuntimeError(
                "Required lofcz MoE head ONNX file(s) missing: "
                + ", ".join(missing)
            )
        if len(head_hashes) != len(set(head_hashes)):
            raise RuntimeError(
                "Required lofcz MoE heads are not distinct by sha256: "
                + ", ".join(head_hashes)
            )

    @staticmethod
    def _calibration_type(calibration: Optional[dict]) -> Optional[str]:
        if not calibration:
            return None
        return str(calibration.get("method", "unknown"))

    def _lofcz_head_manifest(self) -> List[dict]:
        heads = getattr(self.lofcz, "_heads", [])
        manifest = []
        for head in heads:
            onnx_path = Path(head.model_dir) / "ai_music_detector.onnx"
            manifest.append({
                "name": str(head.name),
                "sha256": file_sha256(onnx_path) if onnx_path.exists() else None,
                "path": str(onnx_path),
                "calibration_type": self._calibration_type(head.calibration),
            })
        return manifest

    def _onnx_random_forward(self, session, shape: Tuple[int, ...], label: str) -> None:
        rng = np.random.default_rng(20260503)
        input_name = session.get_inputs()[0].name
        sample = rng.random(shape, dtype=np.float32)
        outputs = session.run(None, {input_name: sample})
        arrays = [np.asarray(out) for out in outputs]
        if not arrays or not all(np.isfinite(arr).all() for arr in arrays):
            raise RuntimeError(f"{label} random ONNX forward pass returned non-finite output")

    def _assert_required_components_loaded(self) -> None:
        """Crash loudly if the documented production engine is degraded."""
        errors: List[str] = []

        lofcz_heads = self._lofcz_head_manifest()
        lofcz_hashes = [h["sha256"] for h in lofcz_heads if h.get("sha256")]
        if len(lofcz_heads) != 4:
            errors.append(f"lofcz expected 4 heads, loaded {len(lofcz_heads)}")
        if len(lofcz_hashes) != len(set(lofcz_hashes)):
            errors.append("lofcz head sha256s are not distinct")

        strict_components = not bool(getattr(self, "_fast_batch_profile", False))

        temporal_heads = getattr(getattr(self, "temporal_lofcz", None), "_heads", [])
        if strict_components and len(temporal_heads) != 4:
            errors.append(f"temporal_lofcz expected 4 heads, loaded {len(temporal_heads)}")

        if strict_components and not getattr(self.cnn, "model_loaded", False):
            errors.append("CNN model did not load")
        elif strict_components:
            self._onnx_random_forward(self.cnn.ort_session, (1, 1, 224, 224), "CNN")

        if strict_components and (
            self.ast is None or not getattr(self.ast, "model_loaded", False)
        ):
            errors.append("AST model did not load")
        elif strict_components:
            self._onnx_random_forward(self.ast.ort_session, (1, 1, 128, 1024), "AST")

        if strict_components and (
            self.modspec is None or not getattr(self.modspec, "model_loaded", False)
        ):
            errors.append("modspec model did not load")

        if (
            strict_components
            and (
                self.embedding is None
                or not getattr(self.embedding, "model_loaded", False)
                or getattr(self.embedding, "bank_embeddings", None) is None
            )
        ):
            errors.append("embedding/CLAP model and bank did not load")

        if errors:
            raise RuntimeError(
                "Required production engine components failed to load: "
                + "; ".join(errors)
            )

    def _emit_load_manifest(self) -> dict:
        """Emit what actually loaded so audits can detect wiring drift."""
        modspec_onnx = (
            Path(self.modspec.model_dir) / "modspec.onnx"
            if self.modspec is not None else None
        )
        manifest = {
            "lofcz_heads": self._lofcz_head_manifest(),
            "modspec": {
                "loaded": bool(self.modspec and self.modspec.model_loaded),
                "path": str(modspec_onnx) if modspec_onnx else None,
                "sha256": file_sha256(modspec_onnx) if modspec_onnx and modspec_onnx.exists() else None,
                "feature_dim": getattr(self.modspec, "feature_dim", None),
                "providers": list(getattr(self.modspec, "providers", [])) if self.modspec else [],
            },
            "cnn": {
                "loaded": bool(getattr(self.cnn, "model_loaded", False)),
                "model_type": self.cnn.model_type,
                "path": getattr(self.cnn, "model_path", None),
                "sha256": getattr(self.cnn, "model_sha256", None),
                "class_names": list(getattr(self.cnn, "class_names", [])),
                "providers": list(getattr(self.cnn, "providers", [])),
            },
            "ast": {
                "loaded": bool(self.ast and self.ast.model_loaded),
                "path": getattr(self.ast, "model_path", None) if self.ast else None,
                "sha256": getattr(self.ast, "model_sha256", None) if self.ast else None,
                "providers": list(getattr(self.ast, "providers", [])) if self.ast else [],
            },
            "embedding": {
                "loaded": bool(self.embedding and self.embedding.model_loaded),
                "path": str(getattr(self.embedding, "model_path", "")) if self.embedding else None,
                "device": getattr(self.embedding, "device", "cpu") if self.embedding else "cpu",
                "bank_size": (
                    int(self.embedding.bank_embeddings.shape[0])
                    if self.embedding is not None
                    and getattr(self.embedding, "bank_embeddings", None) is not None
                    else 0
                ),
                "embedding_dim": getattr(self.embedding, "embedding_dim", 0) if self.embedding else 0,
            },
            "six_head_moe": {
                "claim_1_marker": True,
                "heads": list(self._SIX_HEAD_MOE_CONSENSUS_HEADS),
                "detector_registry_count": len(getattr(self, "detectors", {}) or {}),
                "detector_registry_keys": list((getattr(self, "detectors", {}) or {}).keys()),
            },
            "vocal_tremor": {
                "loaded": bool(self.vocal_tremor and getattr(self.vocal_tremor, "model_loaded", False)),
                "detector": type(self.vocal_tremor).__name__ if self.vocal_tremor else None,
                "device": getattr(self.vocal_tremor, "device", "cpu") if self.vocal_tremor else "cpu",
            },
            "stereo_realism": {
                "loaded": bool(self.stereo_realism and getattr(self.stereo_realism, "model_loaded", False)),
                "detector": type(self.stereo_realism).__name__ if self.stereo_realism else None,
                "reference_path": (
                    str(getattr(self.stereo_realism, "reference_path", ""))
                    if self.stereo_realism else None
                ),
                "reference_sample_count": (
                    int((getattr(self.stereo_realism, "reference", {}) or {}).get("sample_count", 0))
                    if self.stereo_realism else 0
                ),
            },
            "watermark": {
                "loaded": bool(self.watermark and getattr(self.watermark, "model_loaded", False)),
                "detector": type(self.watermark).__name__ if self.watermark else None,
            },
            "calibration_head": {
                "enabled": bool(getattr(self, "use_calibration_head", True)),
                "loaded": bool(getattr(self, "calibration_head", None) is not None),
                "path": str(getattr(self, "calibration_head_path", "")),
                "feature_count": (
                    len(getattr(self.calibration_head, "feature_names", []))
                    if getattr(self, "calibration_head", None) is not None
                    else 0
                ),
            },
            "lyrics_lazy": not self.batch_mode,
            "validation_mode": bool(getattr(self, "validation_mode", False)),
            "fast_batch_profile": bool(getattr(self, "_fast_batch_profile", False)),
            "thresholds": {
                "documented_human_made_lt": self.DOCUMENTED_HUMAN_THRESHOLD,
                "documented_ai_made_gte": self.DOCUMENTED_AI_THRESHOLD,
                "bucket_human_made_lt": self.VERDICT_HUMAN_MADE_MAX,
                "bucket_likely_human_lt": self.VERDICT_LIKELY_HUMAN_MAX,
                "bucket_uncertain_lt": self.VERDICT_UNCERTAIN_MAX,
                "bucket_likely_ai_lt": self.VERDICT_LIKELY_AI_MAX,
                "full_track_min_sec": self._FULL_TRACK_MIN_DURATION_SEC,
                "low_band_energy_threshold_db": self._LOW_BAND_ENERGY_THRESHOLD_DB,
                "low_band_freq_hz": self._LOW_BAND_FREQ_HZ,
                "silence_rms_threshold_db": self._SILENCE_RMS_THRESHOLD_DB,
                "near_silence_peak_threshold_db": self._NEAR_SILENCE_PEAK_THRESHOLD_DB,
            },
            "fusion_weights": {
                "dynamic": True,
                "lofcz_base": 0.45,
                "temporal_lofcz_base": 0.05,
                "embedding_base": 0.10,
                "modspec_base": 0.05,
                "vocal_tremor_base": 0.04,
                "stereo_realism_base": 0.04,
                "watermark_when_present": 0.30,
            },
            "confidence_intervals": {
                "enabled": bool(getattr(self, "compute_confidence_intervals", False)),
                "detector_cis": bool(getattr(self, "compute_detector_confidence_intervals", False)),
                "n_bootstrap": int(getattr(self, "ci_n_bootstrap", 500)),
                "segment_sec": float(getattr(self, "ci_segment_sec", 8.0)),
                "hop_sec": float(getattr(self, "ci_hop_sec", 4.0)),
                "rng_seed": int(getattr(self, "ci_rng_seed", 42)),
            },
            "guard_thresholds": {
                "forward_lofcz_gte": self.forward_lofcz_threshold,
                "forward_legacy_score_lt": self.forward_legacy_mean_max,
                "forward_low_count_gte": self.min_quorum_forward,
                "inverse_lofcz_gte": self.inverse_lofcz_threshold,
                "inverse_content_score_lt": self.inverse_content_mean_max,
                "inverse_low_count_gte": self.min_quorum_inverse,
                "downweight_factor": self.guard_downweight_factor,
                "legacy_group": list(self.legacy_detector_group),
                "content_group": list(self.content_aware_detector_group),
            },
        }
        return manifest

    def _warm_up_batch_detectors(self) -> None:
        """Eagerly load lazy models used by repeated validation scoring."""
        warmups = [
            ("lofcz", self._warm_up_lofcz),
            (
                "lyrics",
                None if self._fast_batch_profile else getattr(self.lyrics, "_get_model", None),
            ),
            ("aimd", getattr(self.aimd, "_load", None) if self.aimd is not None else None),
            (
                "spectttra",
                getattr(self.spectttra, "_load", None)
                if self.spectttra is not None else None,
            ),
            (
                "segment",
                getattr(self.segment, "warm_up", None)
                if self.segment is not None else None,
            ),
        ]
        for name, warmup in warmups:
            if warmup is None:
                continue
            try:
                warmup()
            except Exception as exc:
                logger.warning("Batch-mode warm-up failed for %s: %s", name, exc)

    def _warm_up_lofcz(self) -> None:
        """Prime ONNX/CUDA runtime for all lofcz MoE heads during batch init."""
        lofcz = getattr(self, "lofcz", None)
        heads = getattr(lofcz, "_heads", None) or []
        n_features = int(getattr(lofcz, "n_features", 3585))
        if not heads:
            return
        fakeprint = np.zeros((1, n_features), dtype=np.float32)
        for head in heads:
            lofcz._run_onnx(head.ort_session, fakeprint)

    def reset_per_track_state(self) -> None:
        """Release prior-track scratch buffers without unloading model weights."""
        detector_names = (
            "fourier",
            "fakeprint",
            "spectral",
            "codec_residual",
            "phase",
            "highfreq",
            "onset",
            "lyrics",
            "production",
            "lofcz",
            "temporal_lofcz",
            "modspec",
            "embedding",
            "vocal_tremor",
            "stereo_realism",
            "watermark",
            "loop",
            "cnn",
            "ast",
            "aimd",
            "segment",
            "temporal",
            "longcontext",
            "spectttra",
        )
        for detector in (getattr(self, name, None) for name in detector_names):
            reset = getattr(detector, "reset_per_track_state", None)
            if callable(reset):
                try:
                    reset()
                except Exception as exc:
                    logger.debug("Per-track reset failed for %s: %s", type(detector).__name__, exc)

        if not getattr(self, "batch_mode", False):
            return
        gc.collect()
        try:
            import torch  # noqa: WPS433 - optional runtime dependency

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    def get_load_manifest(self) -> dict:
        """Return a copy of the structured startup load manifest."""
        return deepcopy(self._load_manifest)

    def _empty_result(self, error_msg: str) -> "EnsembleResult":
        """Return a graceful empty result for invalid/missing files."""
        return EnsembleResult(
            verdict="Invalid Audio",
            score=0.5,
            confidence=0.0,
            verdict_emoji="⚠️",  # warning
            detector_scores={},
            detector_weights={},
            all_anomalies=[error_msg],
            cross_validation_notes=[error_msg],
            top_reasons=[error_msg],
        )

    @staticmethod
    def _neutral_cnn_result() -> CNNResult:
        return CNNResult(
            score=0.5,
            confidence=0.0,
            model_loaded=False,
            model_type="none",
        )

    @staticmethod
    def _neutral_fourier_result() -> FourierResult:
        return FourierResult(
            score=0.5,
            confidence=0.0,
            artifacts_found=[],
            artifact_frequencies=[],
            artifact_magnitudes=[],
            highfreq_dropoff_hz=0.0,
            highfreq_score=0.0,
        )

    @staticmethod
    def _neutral_fakeprint_result(reason: str) -> FakePrintResult:
        return FakePrintResult(
            score=0.5,
            confidence=0.0,
            residue_energy=0.0,
            residue_p95=0.0,
            anomalies=[reason],
        )

    @staticmethod
    def _neutral_spectral_result(reason: str) -> SpectralResult:
        return SpectralResult(
            score=0.5,
            confidence=0.0,
            feature_scores={},
            feature_details={},
            anomalies=[reason],
        )

    @staticmethod
    def _neutral_codec_residual_result(reason: str) -> CodecResidualResult:
        return CodecResidualResult(
            score=0.5,
            confidence=0.0,
            mean_spectral_residual=0.0,
            mean_mdct_shift=0.0,
            low_degradation_score=0.5,
            residual_consistency=0.5,
            mdct_consistency=0.5,
            anomalies=[reason],
        )

    @staticmethod
    def _neutral_highfreq_result(reason: str) -> HighFreqResult:
        return HighFreqResult(
            score=0.5,
            confidence=0.0,
            cutoff_frequency_hz=0.0,
            steepest_gradient_db_per_khz=0.0,
            rolloff_slope_db_per_khz=0.0,
            band_energy_15_17_db=0.0,
            band_energy_17_20_db=0.0,
            band_energy_ratio_db=0.0,
            sharp_cutoff_detected=False,
            anomalies=[reason],
        )

    @staticmethod
    def _neutral_phase_result(reason: str) -> PhaseResult:
        return PhaseResult(
            score=0.5,
            confidence=0.0,
            stereo_present=False,
            mean_coherence=0.0,
            mean_entropy=0.0,
            coherence_entropy_corr=0.0,
            scatter_score=0.5,
            extreme_band_count=0,
            anomalies=[reason],
        )

    @staticmethod
    def _neutral_onset_result(reason: str) -> OnsetTimingResult:
        return OnsetTimingResult(
            score=0.5,
            confidence=0.0,
            onset_count=0,
            tempo_bpm=0.0,
            timing_std_ms=0.0,
            timing_iqr_ms=0.0,
            median_abs_offset_ms=0.0,
            grid_snap_ratio=0.0,
            offset_entropy=0.0,
            ioi_cv=0.0,
            ioi_mad_ms=0.0,
            ioi_lognormal_ks=0.5,
            ioi_normal_ks=0.5,
            ioi_uniform_ks=0.5,
            grid_lock_score=0.5,
            ioi_regularity_score=0.5,
            distribution_score=0.5,
            onset_strength_uniformity_score=0.5,
            anomalies=[reason],
        )

    def _out_of_scope_result(self, duration_sec: float) -> "EnsembleResult":
        """Return a scope-gated result for clips below the full-track minimum.

        UAI's customer surface (Spotify / Apple / Sony / FUGA / DistroKid /
        Tidal) ingests full songs. Track-level detectors degrade on short
        clips because their spectral statistics assume tens of seconds of
        material. Rather than emit a low-confidence guess that drags the
        headline accuracy, we mark the clip out_of_scope so downstream
        eval / sweep / pitch-deck code can filter it cleanly. Pass
        ``full_track_only=False`` to ``EnsembleDetector(...)`` to disable
        and fall through to the loop-detector short-circuit path.
        """
        msg = (
            f"Out of scope: {duration_sec:.1f}s clip is below the "
            f"{self._FULL_TRACK_MIN_DURATION_SEC:.1f}s full-track minimum. "
            "UAI targets full songs; pass full_track_only=False for loop support."
        )
        return EnsembleResult(
            verdict="Out of Scope",
            score=0.5,
            confidence=0.0,
            verdict_emoji="↪️",
            detector_scores={},
            detector_weights={},
            all_anomalies=[msg],
            cross_validation_notes=[msg],
            top_reasons=[msg],
        )

    def _is_below_full_track_minimum(self, duration_sec: float) -> bool:
        """Return True when a duration should be routed out of scope."""
        return float(duration_sec) < self._FULL_TRACK_MIN_DURATION_SEC

    def _bass_stripped_result(self, low_band_db: float) -> "EnsembleResult":
        """Return a scope-gated result for bass-stripped audio.

        Triggered by ``_check_low_band_energy`` when energy below
        ``_LOW_BAND_FREQ_HZ`` falls below ``_LOW_BAND_ENERGY_THRESHOLD_DB``
        relative to total energy. The KTH self-audit confirmed this is
        the shared UAI / IRCAM Amplify failure mode on MSD humans
        passed through an 8 kHz high-pass filter: with bass and mids
        stripped, models trained on full-band content treat the signal
        as out-of-distribution and default to "AI". Returning out_of_scope
        is the honest answer; pass ``low_band_guard=False`` to
        ``EnsembleDetector(...)`` to disable.
        """
        msg = (
            f"Out of scope: bass-stripped audio (low-band energy "
            f"{low_band_db:.1f} dB below total, threshold "
            f"{self._LOW_BAND_ENERGY_THRESHOLD_DB:.1f} dB). Likely a high-pass "
            "edit rather than a master; track-level detectors degrade on "
            "low-band-deficient input. Pass low_band_guard=False to override."
        )
        return EnsembleResult(
            verdict="Out of Scope: bass-stripped",
            score=0.5,
            confidence=0.0,
            verdict_emoji="↪️",
            detector_scores={},
            detector_weights={},
            all_anomalies=[msg],
            cross_validation_notes=[msg],
            top_reasons=[msg],
        )

    @staticmethod
    def _linear_amplitude_to_db(value: float) -> float:
        if value <= 0.0:
            return -float("inf")
        return 20.0 * float(np.log10(value))

    def _silence_result(self, rms_db: float, peak_db: float) -> "EnsembleResult":
        """Return a scope-gated result for digital silence / near-silence."""
        msg = (
            f"Out of scope: silence (RMS {rms_db:.1f} dB, peak "
            f"{peak_db:.1f} dB; thresholds RMS "
            f"{self._SILENCE_RMS_THRESHOLD_DB:.1f} dB and peak "
            f"{self._NEAR_SILENCE_PEAK_THRESHOLD_DB:.1f} dB). "
            "Track-level detectors are not meaningful on silent input. "
            "Pass silence_guard=False to override."
        )
        return EnsembleResult(
            verdict="Out of Scope: silence",
            score=0.5,
            confidence=0.0,
            verdict_emoji="↪️",
            detector_scores={},
            detector_weights={},
            all_anomalies=[msg],
            cross_validation_notes=[msg],
            top_reasons=[msg],
        )

    def _check_silence(self, audio_path: str) -> Tuple[bool, float, float]:
        """Return (is_silence, rms_db, peak_db) for ``audio_path``.

        The primary path streams samples with soundfile so long tracks do not
        need to be held in memory. If a codec is not supported by soundfile, we
        fall back to librosa decode.
        """
        sample_count = 0
        sum_squares = 0.0
        peak = 0.0

        try:
            import soundfile as sf

            with sf.SoundFile(audio_path) as handle:
                for block in handle.blocks(
                    blocksize=65536,
                    dtype="float32",
                    always_2d=True,
                ):
                    arr = np.asarray(block, dtype=np.float64)
                    if arr.size == 0:
                        continue
                    sample_count += int(arr.size)
                    sum_squares += float(np.sum(arr * arr))
                    peak = max(peak, float(np.max(np.abs(arr))))
        except Exception:
            try:
                import librosa

                audio, _ = librosa.load(audio_path, sr=None, mono=False)
            except Exception as exc:
                logger.warning("Silence guard load failed: %s", exc)
                return (False, 0.0, 0.0)
            arr = np.asarray(audio, dtype=np.float64)
            if arr.size > 0:
                sample_count = int(arr.size)
                sum_squares = float(np.sum(arr * arr))
                peak = float(np.max(np.abs(arr)))

        if sample_count <= 0:
            return (False, 0.0, 0.0)

        rms = float(np.sqrt(sum_squares / float(sample_count)))
        rms_db = self._linear_amplitude_to_db(rms)
        peak_db = self._linear_amplitude_to_db(peak)
        is_silence = (
            rms_db <= self._SILENCE_RMS_THRESHOLD_DB
            and peak_db <= self._NEAR_SILENCE_PEAK_THRESHOLD_DB
        )
        return (is_silence, rms_db, peak_db)

    def _check_low_band_energy(self, audio_path: str) -> Tuple[bool, float]:
        """Return (is_bass_stripped, low_band_db) for ``audio_path``.

        Loads ``_LOW_BAND_PROBE_DURATION_SEC`` of audio at
        ``_LOW_BAND_PROBE_SR`` mono, takes the magnitude FFT, and
        computes 10*log10(low_band_energy / total_energy) where
        low_band_energy is the sum of squared magnitudes for bins below
        ``_LOW_BAND_FREQ_HZ``. Returns is_bass_stripped=True when the
        ratio is at or below ``_LOW_BAND_ENERGY_THRESHOLD_DB``.

        Failures (decode errors, empty audio, all-silence) return
        ``(False, 0.0)`` so the guard fails open and falls through to
        the regular ensemble fusion path rather than false-flagging
        scope on unrelated input issues.
        """
        try:
            import librosa
            audio, sr = librosa.load(
                audio_path,
                sr=self._LOW_BAND_PROBE_SR,
                mono=True,
                duration=self._LOW_BAND_PROBE_DURATION_SEC,
            )
        except Exception as exc:
            logger.warning("Low-band probe load failed: %s", exc)
            return (False, 0.0)
        if audio is None or audio.size == 0:
            return (False, 0.0)
        # Avoid log(0) on digital silence — fail open.
        total_energy = float(np.sum(audio.astype(np.float64) ** 2))
        if total_energy <= 0.0:
            return (False, 0.0)
        spec = np.abs(np.fft.rfft(audio))
        freqs = np.fft.rfftfreq(audio.shape[0], d=1.0 / float(sr))
        power = spec.astype(np.float64) ** 2
        spec_total = float(np.sum(power))
        if spec_total <= 0.0:
            return (False, 0.0)
        low_band_mask = freqs < self._LOW_BAND_FREQ_HZ
        low_band_power = float(np.sum(power[low_band_mask]))
        if low_band_power <= 0.0:
            # All low-band energy gone — clearly bass-stripped.
            return (True, -float("inf"))
        ratio = low_band_power / spec_total
        low_band_db = 10.0 * float(np.log10(ratio))
        return (low_band_db <= self._LOW_BAND_ENERGY_THRESHOLD_DB, low_band_db)

    def _detect_filter_signature_for_path(self, audio_path: str) -> Dict[str, object]:
        """Load a CPU-only probe and detect destructive filter signatures."""
        try:
            import librosa

            audio, sr = librosa.load(
                audio_path,
                sr=22050,
                mono=True,
                duration=30.0,
            )
            signature = detect_filter_signature(audio, int(sr))
        except Exception as exc:
            logger.warning("Spectral filter signature probe failed: %s", exc)
            signature = {
                "low_pass_detected": False,
                "low_pass_cutoff_hz": None,
                "high_pass_detected": False,
                "high_pass_cutoff_hz": None,
                "is_brick_wall": False,
            }
        return dict(signature)

    @staticmethod
    def _clip_score(value) -> Optional[float]:
        try:
            score = float(value)
        except (TypeError, ValueError):
            return None
        if not np.isfinite(score):
            return None
        return float(np.clip(score, 0.0, 1.0))

    def _safe_analyze_for_ci(self, detector_name: str, audio_path: str, **kwargs):
        detector = getattr(self, detector_name, None)
        analyze = getattr(detector, "analyze", None)
        if not callable(analyze):
            return None
        try:
            if kwargs:
                return analyze(audio_path, **kwargs)
            return analyze(audio_path)
        except Exception as exc:
            logger.debug("CI segment analysis failed for %s: %s", detector_name, exc)
            return None

    def _ci_segment_starts(self, total_samples: int, sr: int) -> List[int]:
        segment_sec = float(getattr(self, "ci_segment_sec", 8.0))
        hop_sec = float(getattr(self, "ci_hop_sec", 4.0))
        segment_samples = max(1, int(round(segment_sec * float(sr))))
        hop_samples = max(1, int(round(hop_sec * float(sr))))
        if total_samples <= segment_samples:
            return [0]
        last_start = total_samples - segment_samples
        starts = list(range(0, last_start + 1, hop_samples))
        if not starts or starts[-1] != last_start:
            starts.append(last_start)
        return starts

    @staticmethod
    def _slice_audio_for_ci(audio: np.ndarray, start: int, end: int) -> np.ndarray:
        if audio.ndim == 1:
            return np.asarray(audio[start:end], dtype=np.float32)
        # librosa with mono=False returns channel-first arrays. soundfile wants
        # samples x channels, so transpose the segment back before writing.
        if audio.shape[0] <= audio.shape[-1]:
            return np.asarray(audio[:, start:end].T, dtype=np.float32)
        return np.asarray(audio[start:end, :], dtype=np.float32)

    def _score_ci_segment(
        self,
        segment_path: str,
        run_segments: bool,
        genre_probs: Optional[Dict[str, float]],
    ) -> Tuple[Dict[str, float], Optional[float]]:
        """Score one raw waveform segment for bootstrap CI aggregation."""
        fast_profile = bool(getattr(self, "_fast_batch_profile", False))
        fast_skip_reason = "Detector skipped in fast batch profile"

        fourier_result = self._neutral_fourier_result()
        fakeprint_result = self._neutral_fakeprint_result(fast_skip_reason)
        spectral_result = self._neutral_spectral_result(fast_skip_reason)
        codec_residual_result = self._neutral_codec_residual_result(fast_skip_reason)
        phase_result = self._neutral_phase_result(fast_skip_reason)
        highfreq_result = self._neutral_highfreq_result(fast_skip_reason)
        onset_result = self._neutral_onset_result(fast_skip_reason)
        cnn_result = self._neutral_cnn_result()

        if not fast_profile:
            fourier_result = self._safe_analyze_for_ci("fourier", segment_path) or fourier_result
            fakeprint_result = self._safe_analyze_for_ci("fakeprint", segment_path) or fakeprint_result
            spectral_result = self._safe_analyze_for_ci("spectral", segment_path) or spectral_result
            codec_residual_result = (
                self._safe_analyze_for_ci("codec_residual", segment_path)
                or codec_residual_result
            )
            phase_result = self._safe_analyze_for_ci("phase", segment_path) or phase_result
            highfreq_result = self._safe_analyze_for_ci("highfreq", segment_path) or highfreq_result
            onset_result = self._safe_analyze_for_ci("onset", segment_path) or onset_result
            cnn_result = self._safe_analyze_for_ci("cnn", segment_path) or cnn_result

        lofcz_result = self._safe_analyze_for_ci("lofcz", segment_path)
        ast_result = None if fast_profile else self._safe_analyze_for_ci("ast", segment_path)
        modspec_result = None if fast_profile else self._safe_analyze_for_ci("modspec", segment_path)
        embedding_result = None if fast_profile else self._safe_analyze_for_ci("embedding", segment_path)
        watermark_result = None if fast_profile else self._safe_analyze_for_ci("watermark", segment_path)
        production_result = None if fast_profile else self._safe_analyze_for_ci("production", segment_path)
        vocal_tremor_result = None
        stereo_realism_result = None
        if (
            getattr(self, "vocal_tremor", None) is not None
            or getattr(self, "stereo_realism", None) is not None
        ):
            try:
                import librosa

                aux_audio, aux_sr = librosa.load(
                    segment_path,
                    sr=44100,
                    mono=False,
                )
            except Exception as exc:
                logger.debug("CI six-head segment audio load failed: %s", exc)
                aux_audio = None
                aux_sr = 44100
            if aux_audio is not None and getattr(self, "vocal_tremor", None) is not None:
                try:
                    vocal_tremor_result = self.vocal_tremor.analyze(
                        aux_audio,
                        int(aux_sr),
                        audio_path=segment_path,
                        vocals_path=None,
                        try_demucs=False,
                    )
                except Exception as exc:
                    logger.debug("CI vocal_tremor segment analysis failed: %s", exc)
            if aux_audio is not None and getattr(self, "stereo_realism", None) is not None:
                try:
                    stereo_realism_result = self.stereo_realism.analyze(aux_audio, int(aux_sr))
                except Exception as exc:
                    logger.debug("CI stereo_realism segment analysis failed: %s", exc)

        segment_result = None
        if run_segments and self.enable_segments and getattr(self, "segment", None) is not None:
            segment_result = self._safe_analyze_for_ci("segment", segment_path)

        scores: Dict[str, Optional[float]] = {
            "lofcz": (
                self._clip_score(getattr(lofcz_result, "score", None))
                if lofcz_result is not None
                and getattr(lofcz_result, "model_loaded", True)
                else None
            ),
            "fourier": None if fast_profile else self._clip_score(getattr(fourier_result, "score", None)),
            "fakeprint": None if fast_profile else self._clip_score(getattr(fakeprint_result, "score", None)),
            "spectral": None if fast_profile else self._clip_score(getattr(spectral_result, "score", None)),
            "codec_residual": (
                None if fast_profile else self._clip_score(getattr(codec_residual_result, "score", None))
            ),
            "phase": None if fast_profile else self._clip_score(getattr(phase_result, "score", None)),
            "highfreq": None if fast_profile else self._clip_score(getattr(highfreq_result, "score", None)),
            "onset": (
                self._clip_score(getattr(onset_result, "score", None))
                if not fast_profile and getattr(onset_result, "confidence", 0.0) > 0.0
                else None
            ),
            "cnn": (
                self._clip_score(getattr(cnn_result, "score", None))
                if getattr(cnn_result, "model_loaded", False)
                else None
            ),
            "ast": (
                self._clip_score(getattr(ast_result, "score", None))
                if ast_result is not None and getattr(ast_result, "model_loaded", False)
                else None
            ),
            "segment": (
                self._clip_score(getattr(segment_result, "overall_score", None))
                if segment_result is not None
                else None
            ),
            "production": (
                self._clip_score(getattr(production_result, "score", None))
                if production_result is not None
                and getattr(production_result, "confidence", 0.0) > 0.05
                else None
            ),
            "embedding": (
                self._clip_score(getattr(embedding_result, "score", None))
                if embedding_result is not None
                and getattr(embedding_result, "model_loaded", False)
                and getattr(embedding_result, "confidence", 0.0) > 0.05
                else None
            ),
            "modspec": (
                self._clip_score(getattr(modspec_result, "score", None))
                if modspec_result is not None
                and getattr(modspec_result, "model_loaded", False)
                and getattr(modspec_result, "confidence", 0.0) > 0.05
                else None
            ),
            "vocal_tremor": (
                self._clip_score(getattr(vocal_tremor_result, "score", None))
                if vocal_tremor_result is not None
                and getattr(vocal_tremor_result, "model_loaded", False)
                else None
            ),
            "stereo_realism": (
                self._clip_score(getattr(stereo_realism_result, "score", None))
                if stereo_realism_result is not None
                and getattr(stereo_realism_result, "model_loaded", False)
                else None
            ),
            "watermark": (
                self._clip_score(getattr(watermark_result, "score", None))
                if watermark_result is not None
                and getattr(watermark_result, "model_loaded", False)
                and (
                    getattr(watermark_result, "score", 0.0) > 0.0
                    or getattr(watermark_result, "detected", None)
                )
                else None
            ),
        }
        active = {name: score for name, score in scores.items() if score is not None}
        if not active:
            return {}, None

        notes: List[str] = []
        weights = self._cross_validate(
            active=active,
            fourier=fourier_result,
            fakeprint=fakeprint_result,
            spectral=spectral_result,
            codec_residual=codec_residual_result,
            phase=phase_result,
            highfreq=highfreq_result,
            onset=onset_result,
            cnn=cnn_result,
            ast=ast_result,
            temporal=None,
            segment=segment_result,
            longcontext=None,
            lyrics=None,
            production=production_result,
            modspec=modspec_result,
            vocal_tremor=vocal_tremor_result,
            stereo_realism=stereo_realism_result,
            notes=notes,
        )
        if self.fusion_mode == "simple":
            combined = self._combine_simple(scores, weights)
        else:
            combined, _fusion_notes = self._combine_confidence_weighted(scores, weights)
        combined = self._apply_classical_calibration(
            score=combined,
            genre_probs=genre_probs,
            notes=notes,
        )
        return active, float(np.clip(combined, 0.0, 1.0))

    def _compute_bootstrap_confidence_intervals(
        self,
        audio_path: str,
        run_segments: bool,
        genre_probs: Optional[Dict[str, float]],
    ) -> dict:
        """Compute ensemble and optional detector CIs from raw audio segments."""
        try:
            import librosa
            import soundfile as sf
            import tempfile

            audio, sr = librosa.load(audio_path, sr=None, mono=False)
        except Exception as exc:
            logger.warning("Bootstrap CI audio load failed: %s", exc)
            return {}

        audio = np.asarray(audio, dtype=np.float32)
        if audio.size == 0:
            return {}
        total_samples = int(audio.shape[-1] if audio.ndim > 1 and audio.shape[0] <= audio.shape[-1] else audio.shape[0])
        if total_samples <= 0:
            return {}

        starts = self._ci_segment_starts(total_samples=total_samples, sr=int(sr))
        segment_samples = max(
            1,
            int(round(float(getattr(self, "ci_segment_sec", 8.0)) * float(sr))),
        )
        score_series: List[float] = []
        detector_series: Dict[str, List[float]] = {}

        try:
            with tempfile.TemporaryDirectory(prefix="uai_ci_segments_") as tmp_dir:
                tmp_path = Path(tmp_dir)
                for idx, start in enumerate(starts):
                    end = min(total_samples, start + segment_samples)
                    segment_audio = self._slice_audio_for_ci(audio, start, end)
                    if segment_audio.size == 0:
                        continue
                    segment_path = tmp_path / f"segment_{idx:04d}.wav"
                    sf.write(str(segment_path), segment_audio, int(sr))
                    detector_scores, ensemble_score = self._score_ci_segment(
                        str(segment_path),
                        run_segments=run_segments,
                        genre_probs=genre_probs,
                    )
                    if ensemble_score is not None:
                        score_series.append(float(ensemble_score))
                    if getattr(self, "compute_detector_confidence_intervals", False):
                        for name, value in detector_scores.items():
                            detector_series.setdefault(f"d_{name}", []).append(float(value))
        finally:
            # The CI pass reuses detector instances after the main pass. Clear
            # segment scratch buffers before returning to batch callers.
            self.reset_per_track_state()

        if not score_series:
            return {}

        ci_inputs: Dict[str, List[float]] = {"score": score_series}
        if getattr(self, "compute_detector_confidence_intervals", False):
            ci_inputs.update(detector_series)
        ci_computer = getattr(self, "ci_computer", None)
        if ci_computer is None:
            ci_computer = BootstrapCIComputer(
                n_bootstrap=int(getattr(self, "ci_n_bootstrap", 500)),
                segment_sec=float(getattr(self, "ci_segment_sec", 8.0)),
                rng_seed=int(getattr(self, "ci_rng_seed", 42)),
            )
        intervals = ci_computer.compute(ci_inputs)

        detector_cis: Dict[str, Tuple[float, float]] = {}
        if getattr(self, "compute_detector_confidence_intervals", False):
            for key in detector_series:
                low = intervals.get(f"{key}_ci_low_95")
                high = intervals.get(f"{key}_ci_high_95")
                if low is None or high is None:
                    continue
                detector_name = key[2:] if key.startswith("d_") else key
                detector_cis[detector_name] = (float(low), float(high))

        return {
            "score_ci_low_95": intervals.get("score_ci_low_95"),
            "score_ci_high_95": intervals.get("score_ci_high_95"),
            "detector_score_cis": detector_cis,
            "segment_count": len(score_series),
        }

    def _attach_bootstrap_confidence_intervals(
        self,
        result: "EnsembleResult",
        audio_path: str,
        run_segments: bool,
        genre_probs: Optional[Dict[str, float]],
    ) -> None:
        ci = self._compute_bootstrap_confidence_intervals(
            audio_path=audio_path,
            run_segments=run_segments,
            genre_probs=genre_probs,
        )
        low = ci.get("score_ci_low_95")
        high = ci.get("score_ci_high_95")
        if low is None or high is None:
            result.cross_validation_notes.append("Bootstrap CI unavailable: no segment scores")
            return
        result.score_ci_low_95 = float(low)
        result.score_ci_high_95 = float(high)
        result.detector_score_cis = dict(ci.get("detector_score_cis") or {})

        width = result.score_ci_high_95 - result.score_ci_low_95
        result.cross_validation_notes.append(
            "Bootstrap score CI: "
            f"95% [{result.score_ci_low_95:.3f}, {result.score_ci_high_95:.3f}], "
            f"width={width:.3f}, segments={int(ci.get('segment_count') or 0)}"
        )
        if width > 0.30 and "(low confidence)" not in result.verdict:
            result.verdict = f"{result.verdict} (low confidence)"

    def analyze(
        self,
        audio_path: str,
        run_segments: bool = True,
        vocals_path: Optional[str] = None,
        genre_probs: Optional[Dict[str, float]] = None,
        hybrid_aggregator: Optional[HybridAggregator] = None,
    ) -> EnsembleResult:
        """Run all detectors, cross-validate, and produce final verdict."""
        self.reset_per_track_state()

        # --- Step 0: Validate input file -------------------------------
        from pathlib import Path
        if not audio_path or not Path(audio_path).exists():
            return self._empty_result(f"File not found: {audio_path or '(empty path)'}")

        # Quick audio validation — try loading first second
        try:
            import librosa
            librosa.load(audio_path, sr=22050, mono=True, duration=0.5)
        except Exception as exc:
            return self._empty_result(f"Cannot read audio file: {str(exc)[:100]}")

        self.precompute_calibration_audio_features([audio_path])

        # --- Step 0b: Full-track scope gate ----------------------------
        # Cheap header-only duration probe (no full decode). When
        # ``full_track_only`` is enabled (default), short clips short-
        # circuit to an out_of_scope verdict so they don't pollute
        # headline accuracy. Buyers who want loop coverage construct
        # ``EnsembleDetector(full_track_only=False)``.
        duration_sec = float("inf")
        if self.full_track_only:
            try:
                duration_sec = float(librosa.get_duration(path=audio_path))
            except Exception:
                # If duration probe fails, fall through and let the
                # detectors handle/error out — don't false-flag scope.
                duration_sec = float("inf")
            if self._is_below_full_track_minimum(duration_sec):
                return self._out_of_scope_result(duration_sec)

        # --- Step 0c: Spectral brick-wall filter signature probe --------
        # This is independent from the legacy low-band-energy scope gate. The
        # scope gate still rejects obviously bass-stripped masters, while this
        # signature follows tracks that slip through and later attenuates
        # detector heads whose evidence depends on the removed band.
        filter_signature = self._detect_filter_signature_for_path(audio_path)

        # --- Step 0d: Silence guard rail -------------------------------
        if self.silence_guard:
            is_silence, rms_db, peak_db = self._check_silence(audio_path)
            if is_silence:
                return self._silence_result(rms_db, peak_db)

        # --- Step 0e: Low-band-energy guard rail -----------------------
        # Bass-stripped audio (e.g. an >=8 kHz high-pass edit) is the
        # shared UAI / IRCAM failure mode confirmed by the KTH self-audit:
        # both produce human FPR=1.00 because their training distribution
        # never saw "human music with bass removed". Routing this input
        # through a scope-gate verdict is more honest than a low-confidence
        # AI label. Gate is paired with ``full_track_only`` so loop /
        # sample-pack flows (which legitimately can have low low-band
        # energy on short percussive clips) are unaffected. Distributors
        # with a legitimate use case for bass-stripped scoring pass
        # ``low_band_guard=False``.
        if self.full_track_only and self.low_band_guard:
            is_bass_stripped, low_band_db = self._check_low_band_energy(audio_path)
            if is_bass_stripped:
                return self._bass_stripped_result(low_band_db)

        fast_profile = bool(getattr(self, "_fast_batch_profile", False))
        fast_skip_reason = "Detector skipped in fast batch profile"

        # --- Step 1: Run detectors independently -------------------------
        if fast_profile:
            fourier_result = self._neutral_fourier_result()
            fakeprint_result = self._neutral_fakeprint_result(fast_skip_reason)
            spectral_result = self._neutral_spectral_result(fast_skip_reason)
            codec_residual_result = self._neutral_codec_residual_result(fast_skip_reason)
        else:
            fourier_result = self.fourier.analyze(audio_path)
            fakeprint_result = self.fakeprint.analyze(audio_path)
            spectral_result = self.spectral.analyze(audio_path)
            codec_residual_result = self.codec_residual.analyze(audio_path)
        if fast_profile:
            phase_result = self._neutral_phase_result("Phase detector skipped in fast batch profile")
        else:
            phase_result = self.phase.analyze(audio_path)
        if fast_profile:
            highfreq_result = self._neutral_highfreq_result(fast_skip_reason)
        else:
            highfreq_result = self.highfreq.analyze(audio_path)
        if fast_profile:
            onset_result = self._neutral_onset_result("Onset detector skipped in fast batch profile")
        else:
            onset_result = self.onset.analyze(audio_path)
        lofcz_result = self.lofcz.analyze(audio_path)
        if fast_profile:
            cnn_result = self._neutral_cnn_result()
        else:
            cnn_result = self.cnn.analyze(audio_path)

        temporal_lofcz_result = None
        if self.temporal_lofcz is not None and not fast_profile:
            try:
                temporal_lofcz_result = self.temporal_lofcz.analyze(audio_path)
            except Exception as exc:
                logger.warning("Temporal-lofcz analysis failed: %s", exc)

        modspec_result = None
        if self.modspec is not None and not fast_profile:
            try:
                modspec_result = self.modspec.analyze(audio_path)
            except Exception as exc:
                logger.warning("Modspec analysis failed: %s", exc)

        embedding_result = None
        if self.embedding is not None and not fast_profile:
            try:
                embedding_result = self.embedding.analyze(audio_path)
            except Exception as exc:
                logger.warning("Embedding (CLAP) analysis failed: %s", exc)

        watermark_result = None
        if self.watermark is not None and not fast_profile:
            try:
                watermark_result = self.watermark.analyze(audio_path)
            except Exception as exc:
                logger.warning("Watermark analysis failed: %s", exc)

        loop_result = None
        if self.loop is not None and not fast_profile:
            try:
                loop_result = self.loop.analyze(audio_path)
            except Exception as exc:
                logger.warning("Loop analysis failed: %s", exc)

        lyrics_result = None
        if self.lyrics is not None and not fast_profile:
            try:
                lyrics_result = self.lyrics.analyze(audio_path=audio_path, vocals_path=vocals_path)
            except Exception as exc:
                logger.warning("Lyrics analysis failed: %s", exc)

        production_result = None
        if not fast_profile:
            try:
                production_result = self.production.analyze(audio_path)
            except Exception as exc:
                logger.warning("Production analysis failed: %s", exc)

        ast_result = None
        if self.ast and not fast_profile:
            try:
                ast_result = self.ast.analyze(audio_path)
            except Exception as exc:
                logger.warning("AST analysis failed: %s", exc)

        aimd_result = None
        if self.aimd is not None and not fast_profile:
            try:
                aimd_result = self.aimd.analyze(audio_path)
            except Exception as exc:
                logger.warning("AIMD analysis failed: %s", exc)

        segment_result = None
        if run_segments and self.enable_segments and self.segment:
            try:
                segment_result = self.segment.analyze(audio_path)
            except Exception as exc:
                logger.warning("Segment analysis failed: %s", exc)

        temporal_result = None
        if self.enable_temporal and self.temporal:
            try:
                temporal_result = self.temporal.analyze(audio_path)
            except Exception as exc:
                logger.warning("Temporal analysis failed: %s", exc)

        longcontext_result = None
        if self.enable_longcontext and self.longcontext:
            try:
                longcontext_result = self.longcontext.analyze(audio_path)
            except Exception as exc:
                logger.warning("Long-context analysis failed: %s", exc)

        spectttra_result = None
        if self.enable_longcontext and self.spectttra is not None:
            try:
                spectttra_result = self.spectttra.analyze(audio_path)
            except Exception as exc:
                logger.warning("SpecTTTra analysis failed: %s", exc)

        six_head_audio = None
        six_head_sr = 44100

        def _load_six_head_audio():
            nonlocal six_head_audio, six_head_sr
            if six_head_audio is None:
                six_head_audio, six_head_sr = librosa.load(
                    audio_path,
                    sr=44100,
                    mono=False,
                    duration=60.0,
                )
            return six_head_audio, int(six_head_sr)

        vocal_tremor_result = None
        if getattr(self, "vocal_tremor", None) is not None:
            try:
                aux_audio, aux_sr = _load_six_head_audio()
                vocal_tremor_result = self.vocal_tremor.analyze(
                    aux_audio,
                    aux_sr,
                    audio_path=audio_path,
                    vocals_path=vocals_path,
                    try_demucs=False,
                )
            except Exception as exc:
                logger.warning("Vocal micro-tremor analysis failed: %s", exc)

        stereo_realism_result = None
        if getattr(self, "stereo_realism", None) is not None:
            try:
                aux_audio, aux_sr = _load_six_head_audio()
                stereo_realism_result = self.stereo_realism.analyze(aux_audio, aux_sr)
            except Exception as exc:
                logger.warning("Stereo-imaging realism analysis failed: %s", exc)

        # --- Step 2: Collect scores -------------------------------------
        scores = {
            "lofcz": lofcz_result.score if lofcz_result.model_loaded else None,
            # Frame-level lofcz: score = max(frame_scores). Will closely
            # track whole-track lofcz on uniform tracks but diverges on
            # hybrids (where one verse can spike to 0.95 while the rest
            # sits near 0.1, giving a true track-level "AI somewhere here"
            # signal without dragging the average back to 0.5).
            "temporal_lofcz": (
                float(np.clip(temporal_lofcz_result.score, 0.0, 1.0))
                if temporal_lofcz_result is not None
                and temporal_lofcz_result.model_loaded
                and temporal_lofcz_result.frame_scores
                else None
            ),
            "fourier": None if fast_profile else fourier_result.score,
            "fakeprint": None if fast_profile else fakeprint_result.score,
            "spectral": None if fast_profile else spectral_result.score,
            "codec_residual": None if fast_profile else codec_residual_result.score,
            "phase": None if fast_profile else phase_result.score,
            "highfreq": None if fast_profile else highfreq_result.score,
            "onset": (
                onset_result.score
                if not fast_profile and onset_result.confidence > 0
                else None
            ),
            "cnn": cnn_result.score if cnn_result.model_loaded else None,
            "ast": ast_result.score if ast_result and ast_result.model_loaded else None,
            # AI-Music-Detection AST-60s public head: gate on model_loaded
            # AND window_count > 0 (so HF download failures or empty-audio
            # paths surface as None rather than voting "uncertain" 0.5).
            "aimd": (
                aimd_result.score
                if aimd_result is not None
                and aimd_result.model_loaded
                and aimd_result.window_count > 0
                else None
            ),
            "temporal": (
                temporal_result.overall_score if temporal_result and temporal_result.model_loaded else None
            ),
            "segment": segment_result.overall_score if segment_result else None,
            "longcontext": longcontext_result.score if longcontext_result else None,
            # SpecTTTra (SONICS, ICLR 2025) — gate on model_loaded AND
            # window_count > 0. Cross-generator caveat documented in the
            # detector module: empirically returns low/uninformative scores
            # on Lyria 3 and Suno v5+ (post-training-set generators), so we
            # surface it as a low-weight cross-check rather than a primary
            # signal. The lofcz MoE + CLAP embedding still carry the load
            # on next-gen tracks.
            "spectttra": (
                spectttra_result.score
                if spectttra_result is not None
                and spectttra_result.model_loaded
                and spectttra_result.window_count > 0
                and spectttra_result.confidence > 0.05
                else None
            ),
            "lyrics": (
                lyrics_result.score
                if lyrics_result is not None and lyrics_result.confidence > 0.05
                else None
            ),
            "production": (
                production_result.score
                if production_result is not None and production_result.confidence > 0.05
                else None
            ),
            "embedding": (
                embedding_result.score
                if embedding_result is not None and embedding_result.model_loaded
                and embedding_result.confidence > 0.05
                else None
            ),
            # Six-head MoE continuation heads: each has its own detector
            # result and CSV d_/w_ columns. Neutral 0.5 outputs stay present
            # but contribute zero under confidence-weighted fusion.
            "vocal_tremor": (
                vocal_tremor_result.score
                if vocal_tremor_result is not None
                and vocal_tremor_result.model_loaded
                else None
            ),
            "stereo_realism": (
                stereo_realism_result.score
                if stereo_realism_result is not None
                and stereo_realism_result.model_loaded
                else None
            ),
            # Modulation-spectrum reverb-aware head (Codex DELTA, 2026-04-30).
            # Surfaces None when the model isn't loaded or returned a degenerate
            # score — fusion treats None as "this detector is silent" and
            # renormalises weights over the active set, so a missing modspec
            # head is byte-identical to the pre-modspec engine.
            "modspec": (
                modspec_result.score
                if modspec_result is not None
                and modspec_result.model_loaded
                and modspec_result.confidence > 0.05
                else None
            ),
            # Watermark verifier contributes ONLY when a watermark actually
            # fires — i.e. score > 0 and at least one format was detected (or
            # a partial AudioSeal hit pushed score to 0.5). When no watermark
            # is present (the default), we surface None so the ensemble's
            # weight-renormalization treats this branch as silent rather than
            # voting "human" with confidence 0.
            "watermark": (
                watermark_result.score
                if watermark_result is not None
                and watermark_result.model_loaded
                and (watermark_result.score > 0.0 or watermark_result.detected)
                else None
            ),
            # Loop detector contributes ONLY when the clip *is* a short loop.
            # On full tracks it returns score=0.5 / is_loop=False which we map
            # to None so the renormalization treats this branch as silent.
            "loop": (
                loop_result.score
                if loop_result is not None and loop_result.is_loop and loop_result.model_loaded
                else None
            ),
        }

        active = {k: v for k, v in scores.items() if v is not None}
        notes = []
        if fast_profile:
            notes.append("Fast batch profile active: scoring with six-head MoE core only")

        # --- Short-circuit: short loop detected ---------------------------
        # When loop_detector flags this as a <22s loop with a tight musical
        # period, the track-level detectors (fakeprint / lofcz / CNN / AST /
        # longcontext) are operating outside their reliable regime — fakeprint
        # requires n_fft=8192 samples and the time-average collapses on short
        # clips. We give the loop detector very heavy weight (0.65) and
        # downweight the unreliable track-level heads.
        #
        # Codex U FPR fix 2026-04-30 (replaces the prior <30s+conf>0.20 gate):
        #  - duration_sec < 22.0:  excludes FMA-style 30s music excerpts
        #    (encoded as 29.98s due to MP3 framing precision) which were
        #    misclassified as loops by the periodicity heuristic.
        #  - 0.5 < loop_period_sec < 4.0:  real sample-pack loops are 1/2/4/8
        #    bars at 60-180 bpm → period 0.5-4s; >5s "loops" are usually
        #    full-track structure that periodicity falsely matched on.
        #  - confidence > 0.30:  hygiene bump (was 0.20). Empirically the
        #    diagnostic borderline.
        loop_short_circuit = self._is_loop_short_circuit(loop_result)
        if loop_short_circuit:
            notes.append(
                f"Short-loop short-circuit: {loop_result.duration_sec:.1f}s clip with "
                f"period={loop_result.loop_period_sec:.2f}s, "
                f"periodicity={loop_result.periodicity:.2f}, "
                f"micro-var={loop_result.timing_microvariation:.1f}ms — "
                "loop detector weighted heavily, track-level detectors downweighted"
            )

        # --- Step 3: Dynamic weighting ----------------------------------
        weights = self._cross_validate(
            active=active,
            fourier=fourier_result,
            fakeprint=fakeprint_result,
            spectral=spectral_result,
            codec_residual=codec_residual_result,
            phase=phase_result,
            highfreq=highfreq_result,
            onset=onset_result,
            cnn=cnn_result,
            ast=ast_result,
            temporal=temporal_result,
            segment=segment_result,
            longcontext=longcontext_result,
            lyrics=lyrics_result,
            production=production_result,
            modspec=modspec_result,
            vocal_tremor=vocal_tremor_result,
            stereo_realism=stereo_realism_result,
            notes=notes,
        )

        # --- Step 3b: Short-loop weight override ------------------------
        # When the loop detector flags this as a <30s loop, override the
        # normal weighting so the loop detector dominates and the unreliable
        # track-level heads (fakeprint / longcontext / spectral / AST / CNN /
        # temporal / segment / production / lyrics / phase / fourier) are
        # zeroed out — they all assume many seconds of stationary content
        # and degrade on short clips. We keep small contributions from the
        # signal-domain heads that DO work on short clips.
        if loop_short_circuit:
            # lofcz is also a track-level head trained on full songs (typical
            # train segment ~10-30s of song-like context). On 5-15s loops it
            # frequently returns confident 0.0 (a drum-loop spectrum looks
            # nothing like its training distribution), which would otherwise
            # cancel out the loop detector's positive vote. We zero it here.
            ZERO_FOR_SHORT = (
                "fakeprint", "fourier", "longcontext", "spectral",
                "ast", "aimd", "cnn", "temporal", "temporal_lofcz", "segment",
                "production", "lyrics", "phase", "lofcz", "embedding", "modspec",
                "vocal_tremor", "stereo_realism",
            )
            for name in ZERO_FOR_SHORT:
                if name in weights:
                    weights[name] = 0.0
            # Loop dominates; only the per-frame signal-domain heads that
            # work on a few hundred ms of audio still contribute.
            short_clip_weights = {
                "loop": 0.65,
                "onset": 0.15,
                "highfreq": 0.10,
                "codec_residual": 0.07,
                "watermark": 0.03,
            }
            for name, w in short_clip_weights.items():
                if scores.get(name) is not None:
                    weights[name] = w
            # Re-normalize over active detectors only.
            active_total = sum(max(weights.get(k, 0.0), 0.0)
                               for k in weights if scores.get(k) is not None)
            if active_total > 0:
                for k in list(weights.keys()):
                    if scores.get(k) is None:
                        weights[k] = 0.0
                    else:
                        weights[k] = max(weights[k], 0.0) / active_total

        fusion_scores, weights, filter_guard_metadata = self._apply_filter_guard_to_fusion(
            scores=scores,
            weights=weights,
            filter_signature=filter_signature,
            notes=notes,
        )
        fusion_active = {k: v for k, v in fusion_scores.items() if v is not None}

        # --- Step 4: Weighted score -------------------------------------
        if self.fusion_mode == "simple":
            combined = self._combine_simple(fusion_scores, weights)
        else:
            combined, fusion_notes = self._combine_confidence_weighted(fusion_scores, weights)
            notes.extend(fusion_notes)

        combined = self._apply_classical_calibration(
            score=combined,
            genre_probs=genre_probs,
            notes=notes,
        )
        combined = self._apply_long_human_consensus_guard(
            score=combined,
            scores=fusion_scores,
            duration_sec=duration_sec,
            notes=notes,
            segment=segment_result,
        )
        combined = self._apply_learned_calibration_head(
            score=combined,
            scores=fusion_scores,
            audio_path=audio_path,
            genre_probs=genre_probs,
            notes=notes,
        )

        # --- Step 5: Confidence -----------------------------------------
        confidence = self._compute_confidence(
            fusion_active,
            notes,
            total_possible=len(scores),
            longcontext=longcontext_result,
        )

        # --- Step 6: Verdict --------------------------------------------
        verdict, emoji = self._determine_verdict(
            combined=combined,
            confidence=confidence,
            temporal=temporal_result,
            temporal_lofcz=temporal_lofcz_result,
            segment=segment_result,
            notes=notes,
        )

        # --- Collect anomalies ------------------------------------------
        all_anomalies = []
        all_anomalies.extend(fourier_result.artifacts_found)
        all_anomalies.extend(fakeprint_result.anomalies)
        all_anomalies.extend(spectral_result.anomalies)
        all_anomalies.extend(codec_residual_result.anomalies)
        all_anomalies.extend(phase_result.anomalies)
        all_anomalies.extend(highfreq_result.anomalies)
        all_anomalies.extend(onset_result.anomalies)

        if temporal_result and temporal_result.splice_candidates_sec:
            times = ", ".join(f"{t:.1f}s" for t in temporal_result.splice_candidates_sec[:5])
            all_anomalies.append(f"Temporal AI-score shifts at {times}")

        if segment_result:
            for stem in segment_result.stems.values():
                all_anomalies.extend(stem.anomalies)
        if longcontext_result:
            all_anomalies.extend(longcontext_result.anomalies)
        if spectttra_result is not None and spectttra_result.model_loaded:
            all_anomalies.extend(spectttra_result.anomalies)
        if lyrics_result:
            all_anomalies.extend(f"lyrics: {reason}" for reason in lyrics_result.reasons)
        if production_result:
            all_anomalies.extend(f"production: {reason}" for reason in production_result.reasons)
        if embedding_result and embedding_result.model_loaded:
            all_anomalies.extend(f"embedding: {a}" for a in embedding_result.anomalies)
        if vocal_tremor_result is not None:
            all_anomalies.extend(f"vocal_tremor: {a}" for a in vocal_tremor_result.anomalies)
        if stereo_realism_result is not None:
            all_anomalies.extend(f"stereo_realism: {a}" for a in stereo_realism_result.anomalies)
        if watermark_result is not None:
            # Surface the strongest signal (which watermark formats fired)
            # as a top-line anomaly. Any soft / library-loading anomalies the
            # detector recorded are echoed unchanged so they end up in the
            # report exactly like every other detector's anomalies.
            if watermark_result.detected:
                all_anomalies.append(
                    "watermark: detected " + ", ".join(watermark_result.detected)
                )
            all_anomalies.extend(watermark_result.anomalies)
        if loop_result is not None and loop_result.is_loop:
            all_anomalies.extend(f"loop: {a}" for a in loop_result.anomalies)

        display_scores = {k: (v if v is not None else 0.5) for k, v in scores.items()}

        result = EnsembleResult(
            verdict=verdict,
            score=float(np.clip(combined, 0, 1)),
            confidence=float(np.clip(confidence, 0, 1)),
            verdict_emoji=emoji,
            fourier=fourier_result,
            fakeprint=fakeprint_result,
            spectral=spectral_result,
            codec_residual=codec_residual_result,
            phase=phase_result,
            highfreq=highfreq_result,
            onset=onset_result,
            cnn=cnn_result,
            ast=ast_result,
            aimd=aimd_result,
            segment=segment_result,
            temporal=temporal_result,
            temporal_lofcz=temporal_lofcz_result,
            longcontext=longcontext_result,
            spectttra=spectttra_result,
            lyrics=lyrics_result,
            production=production_result,
            embedding=embedding_result,
            vocal_tremor=vocal_tremor_result,
            stereo_realism=stereo_realism_result,
            watermark=watermark_result,
            loop=loop_result,
            modspec=modspec_result,
            detector_scores=display_scores,
            detector_weights=weights,
            analysis_metadata={
                "six_head_moe_consensus": {
                    "claim_1_marker": True,
                    "heads": list(self._SIX_HEAD_MOE_CONSENSUS_HEADS),
                    "detector_keys": ["lofcz", "vocal_tremor", "stereo_realism"],
                    "vocal_tremor_features": (
                        dict(vocal_tremor_result.features)
                        if vocal_tremor_result is not None else {}
                    ),
                    "stereo_realism_features": (
                        dict(stereo_realism_result.features)
                        if stereo_realism_result is not None else {}
                    ),
                },
                "detector_load_state": dict(getattr(self, "_detector_load_state", {})),
                **filter_guard_metadata,
            },
            all_anomalies=all_anomalies,
            cross_validation_notes=notes,
            hybrid_zones=(
                list(temporal_lofcz_result.hybrid_zones)
                if temporal_lofcz_result is not None
                and temporal_lofcz_result.model_loaded
                else []
            ),
        )

        self._attach_hybrid_aggregator_verdict(
            result=result,
            hybrid_aggregator=hybrid_aggregator,
            full_mix_score=combined,
        )

        if getattr(self, "compute_confidence_intervals", False):
            self._attach_bootstrap_confidence_intervals(
                result=result,
                audio_path=audio_path,
                run_segments=bool(run_segments),
                genre_probs=genre_probs,
            )

        result.top_reasons = self.get_top_reasons(result, top_k=3)
        self._attach_generator_attribution(result, cnn_result)
        attach_report_fingerprint(result, audio_path)
        return result

    def _attach_hybrid_aggregator_verdict(
        self,
        result: "EnsembleResult",
        hybrid_aggregator: Optional[HybridAggregator],
        full_mix_score: float,
    ) -> None:
        """Attach a stem-first hybrid verdict when the caller opts in."""
        if hybrid_aggregator is None:
            return

        segment = getattr(result, "segment", None)
        stems = getattr(segment, "stems", None)
        if not stems:
            return

        per_stem_scores: Dict[str, float] = {}
        stem_verdicts: Dict[str, str] = {}
        for stem_name, stem in stems.items():
            score = getattr(stem, "score", None)
            if score is None:
                continue
            try:
                per_stem_scores[str(stem_name)] = float(score)
            except (TypeError, ValueError):
                continue

            verdict = getattr(stem, "verdict", None)
            if verdict is not None:
                stem_verdicts[str(stem_name)] = str(verdict)

        if not per_stem_scores:
            return

        hybrid_verdict = hybrid_aggregator.aggregate(
            per_stem_scores=per_stem_scores,
            full_mix_score=full_mix_score,
            stem_verdicts=stem_verdicts,
        )
        result.hybrid_verdict = hybrid_verdict
        result.analysis_metadata.setdefault("hybrid_aggregator", {})
        result.analysis_metadata["hybrid_aggregator"] = {
            "verdict": hybrid_verdict.verdict,
            "confidence": hybrid_verdict.confidence,
            "primary_explanation": hybrid_verdict.primary_explanation,
            "hybrid_components": list(hybrid_verdict.hybrid_components),
        }

    def _apply_classical_calibration(
        self,
        score: float,
        genre_probs: Optional[Dict[str, float]],
        notes: list,
    ) -> float:
        """Apply the post-aggregator Classical score calibration if gated."""
        if not getattr(self, "enable_classical_calibration", True):
            return score
        if not genre_probs:
            return score
        calibrated = apply_classical_calibration(score, genre_probs)
        if calibrated != score:
            notes.append(
                "Classical calibration applied: "
                f"genre_prob={classical_probability(genre_probs):.2f}, "
                f"score {score:.3f}->{calibrated:.3f}"
            )
        return calibrated

    def _apply_learned_calibration_head(
        self,
        score: float,
        scores: Dict[str, Optional[float]],
        audio_path: str,
        genre_probs: Optional[Dict[str, float]],
        notes: list,
    ) -> float:
        """Apply the learned XGBoost calibration head when loaded."""
        head = getattr(self, "calibration_head", None)
        if head is None:
            return score
        try:
            feature_row = build_calibration_feature_dict(
                scores,
                raw_score=score,
                audio_path=audio_path,
                genre_probs=genre_probs,
                feature_names=head.feature_names,
                audio_features=self._calibration_audio_features_for_path(audio_path),
            )
            calibrated = float(head.predict_proba([feature_row])[0])
        except Exception as exc:  # noqa: BLE001
            logger.warning("Calibration head inference failed: %s", exc)
            return score
        if not np.isfinite(calibrated):
            logger.warning("Calibration head returned a non-finite score; using raw ensemble score")
            return score
        calibrated = float(np.clip(calibrated, 0.0, 1.0))
        if abs(calibrated - float(score)) > 1e-6:
            notes.append(
                "Learned calibration head applied: "
                f"score {float(score):.3f}->{calibrated:.3f}"
            )
        return calibrated

    def _apply_long_human_consensus_guard(
        self,
        score: float,
        scores: Dict[str, Optional[float]],
        duration_sec: float,
        notes: list,
        segment: Optional[SegmentResult] = None,
    ) -> float:
        """Suppress long-form human false positives from isolated AI spikes.

        Long commercial masters can trigger lofcz/temporal-lofcz or production
        spikes on a few dense sections. We do not change the public verdict
        thresholds; instead, for long tracks only, we require content-aware
        consensus before allowing a borderline score to remain above the
        likely-human bucket.
        """
        if not np.isfinite(duration_sec) or duration_sec < 120.0:
            return score
        if score < self.VERDICT_LIKELY_HUMAN_MAX or score >= self.DOCUMENTED_AI_THRESHOLD:
            return score

        per_stem_scores = []
        if segment is not None and getattr(segment, "stems", None):
            for fallback_name, stem in segment.stems.items():
                if not getattr(stem, "has_content", True):
                    continue
                stem_score = getattr(stem, "score", None)
                if stem_score is None:
                    continue
                try:
                    value = float(stem_score)
                except (TypeError, ValueError):
                    continue
                if not np.isfinite(value):
                    continue
                per_stem_scores.append((getattr(stem, "name", fallback_name), value))

        if per_stem_scores:
            max_stem_name, max_stem_score = max(per_stem_scores, key=lambda item: item[1])
            if max_stem_score >= 0.50:
                notes.append(
                    "Long-human consensus guard skipped: "
                    f"per-stem AI signal {max_stem_name}={max_stem_score:.3f} "
                    "is at or above the hybrid gate"
                )
                return score

        guard_reason = None
        active_names = {name for name, value in scores.items() if value is not None}
        if active_names == {"lofcz"} and score < 0.55:
            guard_reason = "lofcz_only_borderline_long_track"

        human_anchor_group = (
            "cnn",
            "ast",
            "embedding",
            "segment",
            "longcontext",
            "spectttra",
            "modspec",
            "highfreq",
            "onset",
            "vocal_tremor",
            "stereo_realism",
        )
        present = {
            name: float(scores[name])
            for name in human_anchor_group
            if scores.get(name) is not None
        }
        if len(present) < 3 and guard_reason is None:
            return score

        human_votes = [name for name, value in present.items() if value < 0.40]
        strong_ai_votes = [name for name, value in present.items() if value > 0.65]
        if len(human_votes) >= 3 and len(strong_ai_votes) <= 1:
            guard_reason = f"human_anchor_votes={len(human_votes)}/{len(present)}"

        # Long mastered human tracks can light up artifact-sensitive heads
        # (CNN, phase/high-frequency cutoffs, temporal-lofcz max windows) while
        # independent long/context and residual brakes remain human. This was the
        # cb_LEAVE_ME_ALONE failure mode: the AI votes were mostly mastering /
        # separator artifacts, not content consensus.
        human_brake_group = (
            "ast",
            "spectttra",
            "codec_residual",
            "production",
            "fourier",
            "fakeprint",
            "onset",
            "vocal_tremor",
            "stereo_realism",
        )
        content_ai_group = (
            "lofcz",
            "embedding",
            "lyrics",
            "modspec",
            "longcontext",
            "spectttra",
            "ast",
            "production",
            "fakeprint",
            "codec_residual",
            "vocal_tremor",
            "stereo_realism",
        )
        brake_votes = [
            name
            for name in human_brake_group
            if scores.get(name) is not None and float(scores[name]) < 0.40
        ]
        content_ai_votes = [
            name
            for name in content_ai_group
            if scores.get(name) is not None and float(scores[name]) > 0.65
        ]
        lofcz_score = scores.get("lofcz")
        lofcz_not_ai = lofcz_score is None or float(lofcz_score) < 0.55
        if (
            guard_reason is None
            and len(brake_votes) >= 5
            and not content_ai_votes
            and lofcz_not_ai
        ):
            guard_reason = (
                f"human_brakes={','.join(brake_votes)}, "
                "no_content_ai_votes"
            )

        if guard_reason is None:
            return score

        old_score = float(score)
        guarded = min(old_score, self.VERDICT_LIKELY_HUMAN_MAX - 0.01)
        notes.append(
            "Long-human consensus guard applied: "
            f"duration={duration_sec:.1f}s, {guard_reason}, "
            f"score {old_score:.3f}->{guarded:.3f}"
        )
        return guarded

    # ------------------------------------------------------------------
    #  Per-generator attribution (Hive / IRCAM-style credit attribution)
    # ------------------------------------------------------------------

    def _attach_generator_attribution(
        self,
        result: "EnsembleResult",
        cnn_result: Optional[CNNResult],
    ) -> None:
        """
        Populate result.predicted_generator / generator_confidence /
        generator_distribution from the multi-class CNN softmax.

        Rules:
          1. Pull the per-class distribution from cnn_result.generator_probabilities.
          2. If the overall AI score is below the AI gate (track verdict ~ human),
             force predicted_generator='human' with confidence = 1 - score and
             skip generator attribution. We don't claim "Suno" on tracks our
             ensemble itself thinks are human.
          3. Otherwise, take the top-1 generator from the distribution. If the
             top-1 softmax probability is below the threshold (default 0.40),
             degrade to "uncertain_ai" rather than overclaiming attribution
             on a 62%-accurate model.
        """
        # Default: unknown distribution, no claim.
        distribution: Dict[str, float] = {}
        if cnn_result is not None and cnn_result.generator_probabilities:
            distribution = {
                str(k): float(v) for k, v in cnn_result.generator_probabilities.items()
            }
        result.generator_distribution = distribution

        # Sanity guard: track verdict says human, so no AI generator attribution.
        if result.score < self._GENERATOR_AI_GATE:
            result.predicted_generator = "human"
            result.generator_confidence = float(np.clip(1.0 - result.score, 0.0, 1.0))
            return

        # Track verdict says AI: attribute the top class, with threshold guard.
        if not distribution:
            # CNN unavailable / unloaded: degrade to uncertain.
            result.predicted_generator = "uncertain_ai"
            result.generator_confidence = 0.0
            return

        top_class, top_prob = max(distribution.items(), key=lambda kv: kv[1])
        result.generator_confidence = float(top_prob)

        # If the CNN itself thinks "human" but the ensemble says AI, skip the
        # top-1 (it would be "human") and take the highest-probability AI class.
        if top_class == "human":
            ai_only = {k: v for k, v in distribution.items() if k != "human"}
            if ai_only:
                top_class, top_prob = max(ai_only.items(), key=lambda kv: kv[1])
                result.generator_confidence = float(top_prob)
            else:
                result.predicted_generator = "uncertain_ai"
                return

        # Confidence threshold: don't overclaim on a 62%-accurate classifier.
        if top_prob < self._GENERATOR_CONFIDENCE_THRESHOLD:
            result.predicted_generator = "uncertain_ai"
            return

        result.predicted_generator = str(top_class)

    # ------------------------------------------------------------------
    #  Score-fusion implementations (used by analyze())
    # ------------------------------------------------------------------

    @staticmethod
    def _combine_simple(scores: Dict[str, Optional[float]],
                        weights: Dict[str, float]) -> float:
        """Legacy fixed-weight sum fusion. Kept for reproducibility / A/B."""
        combined = 0.0
        for name, weight in weights.items():
            if weight <= 0:
                continue
            score = scores.get(name, None)
            if score is None:
                continue
            combined += weight * score
        return combined

    @staticmethod
    def _as_optional_float(value: object) -> Optional[float]:
        try:
            number = float(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None
        if not np.isfinite(number):
            return None
        return number

    def _apply_filter_guard_to_fusion(
        self,
        scores: Dict[str, Optional[float]],
        weights: Dict[str, float],
        filter_signature: Optional[Dict[str, object]],
        notes: List[str],
    ) -> Tuple[Dict[str, Optional[float]], Dict[str, float], Dict[str, object]]:
        """Attenuate detector evidence made unreliable by brick-wall filters."""
        signature = dict(filter_signature or {})
        metadata: Dict[str, object] = {
            "filter_signature": signature,
            "filter_guard_applied": False,
            "filter_guard_mode": None,
            "filter_guard_deweighted_detectors": [],
        }
        if not bool(signature.get("is_brick_wall", False)):
            return dict(scores), dict(weights), metadata

        planned: List[str] = []
        modes: List[str] = []
        cutoffs: Dict[str, float] = {}

        hp_cutoff = self._as_optional_float(signature.get("high_pass_cutoff_hz"))
        if bool(signature.get("high_pass_detected", False)) and hp_cutoff is not None and hp_cutoff > 4000.0:
            planned.extend(self._HP_FILTER_DEPENDENT_DETECTORS)
            modes.append("high_pass")
            cutoffs["high_pass_cutoff_hz"] = hp_cutoff

        lp_cutoff = self._as_optional_float(signature.get("low_pass_cutoff_hz"))
        if bool(signature.get("low_pass_detected", False)) and lp_cutoff is not None and lp_cutoff < 2000.0:
            planned.extend(self._LP_FILTER_DEPENDENT_DETECTORS)
            modes.append("low_pass")
            cutoffs["low_pass_cutoff_hz"] = lp_cutoff

        if not planned:
            return dict(scores), dict(weights), metadata

        planned_unique = list(dict.fromkeys(planned))
        affected = [name for name in planned_unique if scores.get(name) is not None]
        guarded_scores = dict(scores)
        guarded_weights = dict(weights)
        score_factor = float(getattr(self, "FILTER_GUARD_SCORE_FACTOR", 0.20))
        weight_factor = float(getattr(self, "FILTER_GUARD_WEIGHT_FACTOR", 0.10))

        for name in affected:
            score = scores.get(name)
            if score is not None:
                guarded_scores[name] = float(np.clip(0.5 + (float(score) - 0.5) * score_factor, 0.0, 1.0))
            if name in guarded_weights:
                guarded_weights[name] = max(float(guarded_weights[name]), 0.0) * weight_factor

        active_total = sum(
            max(float(guarded_weights.get(name, 0.0)), 0.0)
            for name, value in guarded_scores.items()
            if value is not None
        )
        if active_total > 0.0:
            for name in list(guarded_weights.keys()):
                if guarded_scores.get(name) is None:
                    guarded_weights[name] = 0.0
                else:
                    guarded_weights[name] = max(float(guarded_weights[name]), 0.0) / active_total

        mode = "+".join(modes)
        metadata.update({
            "filter_guard_applied": True,
            "filter_guard_mode": mode,
            "filter_guard_deweighted_detectors": planned_unique,
            "filter_guard_active_deweighted_detectors": affected,
            "filter_guard_cutoffs_hz": cutoffs,
            "filter_guard_weight_factor": weight_factor,
            "filter_guard_score_factor": score_factor,
        })
        note = (
            "Spectral filter guard applied: "
            f"mode={mode}, cutoffs={cutoffs}, "
            f"deweighted={planned_unique}, active={affected}, "
            f"weight_factor={weight_factor:.2f}, score_factor={score_factor:.2f}"
        )
        notes.append(note)
        logger.info(note)
        return guarded_scores, guarded_weights, metadata

    def _is_loop_short_circuit(self, loop_result) -> bool:
        """Pure decision function for the duration-gated short-circuit
        (Claim 16).

        Returns True iff the periodicity-based detector reported a clip
        that satisfies all four gates:

          * the periodicity-based detector ran successfully,
          * the autocorrelation peak fell inside the configured loop-period
            band,
          * the loop confidence exceeds the configured minimum, and
          * the clip duration is below the configured maximum.

        Wrapped as a method (rather than inlined) so the routing decision
        can be unit-tested directly without requiring an audio file.
        """
        if loop_result is None:
            return False
        if not getattr(loop_result, "is_loop", False):
            return False
        if not getattr(loop_result, "model_loaded", False):
            return False
        if loop_result.confidence <= self.loop_short_circuit_min_confidence:
            return False
        if loop_result.duration_sec >= self.loop_short_circuit_max_duration:
            return False
        period = loop_result.loop_period_sec
        if not (
            self.loop_short_circuit_min_period
            < period
            < self.loop_short_circuit_max_period
        ):
            return False
        return True

    def _filter_hybrid_zones_by_duration(
        self,
        zones: List[Tuple[float, float]],
    ) -> List[Tuple[float, float]]:
        """Apply the duration policy from Claim 13 to a list of zones.

        Drops any zone whose ``end - start`` is below the configured
        ``hybrid_zone_min_duration_sec``. Defaults to 0.0 (pass-through),
        preserving the pre-2026-04-30 verdict policy.
        """
        if not zones:
            return []
        threshold = self.hybrid_zone_min_duration_sec
        if threshold <= 0:
            return list(zones)
        return [
            (start, end) for (start, end) in zones
            if (end - start) >= threshold
        ]

    @staticmethod
    def _merge_adjacent_hybrid_zones(
        zones: List[Tuple[float, float]],
        gap_tolerance_sec: float = 0.5,
    ) -> List[Tuple[float, float]]:
        """Merge zones whose gap is below ``gap_tolerance_sec``.

        Helper for the verdict policy. Keeps zones in input order; merges
        only when the gap between successive zones (zone_b.start -
        zone_a.end) is non-negative and below the tolerance.
        """
        if not zones:
            return []
        ordered = sorted(zones, key=lambda z: z[0])
        merged: List[Tuple[float, float]] = [ordered[0]]
        for start, end in ordered[1:]:
            prev_start, prev_end = merged[-1]
            gap = start - prev_end
            if 0.0 <= gap <= gap_tolerance_sec:
                merged[-1] = (prev_start, max(prev_end, end))
            else:
                merged.append((start, end))
        return merged

    def _evaluate_consensus_guards(
        self,
        scores: Dict[str, Optional[float]],
    ) -> Tuple[bool, bool, List[str]]:
        """Decide which consensus guards fire on the given per-detector scores.

        Pure function over the scores dict (no fusion side-effects), so unit
        tests can drive it directly with synthetic per-detector inputs to
        exercise Claims 6, 7, 10, 20, 21 in isolation.

        Returns ``(forward_active, inverse_active, notes)`` where the bools
        gate per-detector downweighting in the fusion loop and ``notes``
        contains a structured audit-trail string per fired guard (Claim 10).
        The tie-break policy (Claim 21) is honored: only the policy-selected
        guard(s) are reported as active even when both raw conditions hold.
        """

        notes: List[str] = []
        lofcz_score = scores.get("lofcz")
        six_head_detector_scores = {
            k: scores.get(k)
            for k in ("lofcz", "temporal_lofcz", "vocal_tremor", "stereo_realism")
            if scores.get(k) is not None
        }
        six_head_score_note = ", ".join(
            f"{k}={float(v):.2f}" for k, v in six_head_detector_scores.items()
        )

        # ---- Forward (v5+) guard: lofcz strong AI vs legacy human consensus
        legacy_scores = [
            scores.get(k) for k in self.legacy_detector_group
            if scores.get(k) is not None
        ]
        forward_condition = False
        legacy_low_count = 0
        if (lofcz_score is not None
                and lofcz_score >= self.forward_lofcz_threshold
                and legacy_scores):
            legacy_low_count = sum(
                1 for score in legacy_scores
                if score < self.forward_legacy_mean_max
            )
            if legacy_low_count >= self.min_quorum_forward:
                forward_condition = True

        # ---- Inverse (lofcz overconfidence) guard: lofcz strong AI vs
        # content-aware human consensus.
        content_aware_scores = [
            scores.get(k) for k in self.content_aware_detector_group
            if scores.get(k) is not None
        ]
        inverse_condition = False
        content_low_count = 0
        if (lofcz_score is not None
                and lofcz_score >= self.inverse_lofcz_threshold
                and content_aware_scores):
            content_low_count = sum(
                1 for score in content_aware_scores
                if score < self.inverse_content_mean_max
            )
            if content_low_count >= self.min_quorum_inverse:
                inverse_condition = True

        # ---- Tie-break policy (Claim 21) ----
        forward_active = False
        inverse_active = False
        if forward_condition and inverse_condition:
            policy = self.tie_break_policy
            if policy == "prefer_forward":
                forward_active = True
            elif policy == "prefer_inverse":
                inverse_active = True
            elif policy == "first_match":
                forward_active = True
                inverse_active = True
            # (policy validated in __init__; no other branch reachable)
            notes.append(
                f"tie-break: both guards triggered, applied policy={policy}"
            )
        else:
            forward_active = forward_condition
            inverse_active = inverse_condition

        # ---- Structured audit notes (Claim 10) ----
        # Format: human-readable string that names the guard, the threshold
        # values that were satisfied, and which detectors were downweighted.
        # Tests exercise the substring contract; downstream tooling can
        # parse the colon-separated key=value tail if needed.
        downweight_pct = self.guard_downweight_factor
        if forward_active:
            notes.append(
                "forward (v5+) guard active: "
                f"lofcz={lofcz_score:.2f} "
                f">={self.forward_lofcz_threshold:.2f} "
                f"AND legacy_low_count={legacy_low_count} "
                f">={self.min_quorum_forward} "
                f"with scores <{self.forward_legacy_mean_max:.2f} "
                f"(present {len(legacy_scores)}) "
                f"six_head_moe=[{six_head_score_note}] "
                f"— downweighting [{', '.join(self.legacy_detector_group)}] "
                f"by factor {downweight_pct:.4f}"
            )
        if inverse_active:
            notes.append(
                "inverse (lofcz overconfidence) guard active: "
                f"lofcz={lofcz_score:.2f} "
                f">={self.inverse_lofcz_threshold:.2f} "
                f"AND content_low_count={content_low_count} "
                f">={self.min_quorum_inverse} "
                f"with scores <{self.inverse_content_mean_max:.2f} "
                f"(present {len(content_aware_scores)}) "
                f"six_head_moe=[{six_head_score_note}] "
                "— downweighting [lofcz, temporal_lofcz] "
                f"by factor {downweight_pct:.4f}"
            )

        return forward_active, inverse_active, notes

    def _combine_confidence_weighted(
        self,
        scores: Dict[str, Optional[float]],
        weights: Dict[str, float],
    ) -> Tuple[float, List[str]]:
        """
        Confidence-weighted fusion.

        For each detector, the contribution = base_weight * confidence * score,
        where confidence = |score - 0.5| * 2 in [0, 1]. A detector returning 0.5
        (no signal) contributes nothing; one returning 0 or 1 contributes its
        full base weight. The result is the normalized weighted average.

        Also applies the bidirectional consensus guards (Claim 6):
          - Forward (v5+) guard: downweights legacy artifact detectors when
            lofcz is strongly AI but they confidently say "human".
          - Inverse (lofcz overconfidence) guard: downweights lofcz +
            temporal_lofcz when lofcz saturates AI but the expanded six-head
            MoE/content-aware consensus is neutral-or-human.

        Tie-breaking (Claim 21) is governed by ``self.tie_break_policy``.

        Returns (combined_score, notes_for_audit_trail).
        """
        forward_active, inverse_active, notes = self._evaluate_consensus_guards(scores)

        weighted_sum = 0.0
        weight_total = 0.0
        downweight = self.guard_downweight_factor
        for name, base_weight in weights.items():
            if base_weight <= 0:
                continue
            score = scores.get(name, None)
            if score is None:
                continue

            confidence = abs(score - 0.5) * 2.0  # 0 = no signal, 1 = max
            eff_weight = base_weight * confidence

            # Forward (v5+) guard: legacy detectors get downweighted (default
            # 4x → factor 0.25). They may still be useful on legacy tracks,
            # so we preserve a fraction of their weight rather than zero them.
            if forward_active and name in self.legacy_detector_group:
                eff_weight *= downweight

            # Inverse (lofcz overconfidence) guard: when lofcz saturates
            # without content-aware consensus, downweight it (symmetric
            # counterpart of the forward guard).
            if inverse_active and name in ("lofcz", "temporal_lofcz"):
                eff_weight *= downweight

            weighted_sum += eff_weight * score
            weight_total += eff_weight

        if weight_total < 1e-9:
            # No detector confident at all — true uncertainty. Return 0.5.
            notes.append("All detectors at ~0.5 (no signal); returning 0.5 (uncertain)")
            return 0.5, notes

        return weighted_sum / weight_total, notes

    def _cross_validate(
        self,
        active: dict,
        fourier: FourierResult,
        fakeprint: FakePrintResult,
        spectral: SpectralResult,
        codec_residual: CodecResidualResult,
        phase: PhaseResult,
        highfreq: HighFreqResult,
        onset: OnsetTimingResult,
        cnn: CNNResult,
        ast: Optional[ASTResult] = None,
        temporal: Optional[TemporalResult] = None,
        segment: Optional[SegmentResult] = None,
        longcontext: Optional[LongContextResult] = None,
        lyrics: Optional[LyricsResult] = None,
        production: Optional[ProductionResult] = None,
        modspec: Optional[ModspecResult] = None,
        vocal_tremor: Optional[VocalTremorResult] = None,
        stereo_realism: Optional[StereoRealismResult] = None,
        notes: list = None,
    ) -> dict:
        """Cross-validate detectors and assign dynamic weights."""

        if notes is None:
            notes = []

        has_cnn = cnn.model_loaded
        has_ast = "ast" in active and active["ast"] is not None
        has_temporal = temporal is not None and temporal.model_loaded
        has_longcontext = longcontext is not None
        has_onset = onset is not None and onset.confidence > 0.0
        has_lyrics = lyrics is not None and lyrics.confidence > 0.05
        has_production = production is not None and production.confidence > 0.05
        has_vocal_tremor = "vocal_tremor" in active and active["vocal_tremor"] is not None
        has_stereo_realism = "stereo_realism" in active and active["stereo_realism"] is not None

        if has_ast and has_cnn:
            # Legacy detector mix (before adding new codec/phase/highfreq branches).
            legacy_weights = {
                # AST downweighted from 0.45 to 0.02 per Codex F audit (2026-04-29):
                # AST scored 99.5% on in-distribution Suno v3 but is empirically
                # fooled by Suno v5+ (0.000 on v5.5 tracks). Its only consistent
                # win is catching ~1.5% of lofcz false-positives on heavily-
                # mastered commercial human tracks (cb_* series). Keeping it as
                # a low-weight FP brake rather than retiring entirely.
                "fourier": 0.10,
                "fakeprint": 0.10,
                "spectral": 0.0,
                "cnn": 0.65,  # was 0.25 — absorbed AST's old weight
                "ast": 0.02,  # was 0.45 — Codex F recommendation
                "temporal": 0.10 if has_temporal else 0.0,
                "segment": 0.0,
            }
        elif has_ast:
            legacy_weights = {
                # AST-only fallback (no CNN). Even here AST is downweighted —
                # the signal-domain detectors (fourier/fakeprint) get the bulk
                # since AST is unreliable on v5+ generators.
                "fourier": 0.40,
                "fakeprint": 0.40,
                "spectral": 0.0,
                "cnn": 0.0,
                "ast": 0.10,  # was 0.60 — AST is FP-brake only
                "temporal": 0.10 if has_temporal else 0.0,
                "segment": 0.0,
            }
        elif has_cnn:
            legacy_weights = {
                "fourier": 0.20,
                "fakeprint": 0.15,
                "spectral": 0.10,
                "cnn": 0.45,
                "ast": 0.0,
                "temporal": 0.10 if has_temporal else 0.0,
                "segment": 0.0,
            }
        else:
            legacy_weights = {
                "fourier": 0.45,
                "fakeprint": 0.35,
                "spectral": 0.20,
                "cnn": 0.0,
                "ast": 0.0,
                "temporal": 0.0,
                "segment": 0.0,
            }

        # lofcz is the strongest pretrained detector when available. Signal-domain
        # detectors stay active as cross-checks and for cases the model misses.
        # The CLAP "embedding" detector is a generator-invariant timbre check that
        # supplements lofcz, especially valuable on Suno v5+ / Udio v3+ where the
        # signal-domain detectors are fooled.
        has_lofcz = "lofcz" in active and active["lofcz"] is not None
        has_temporal_lofcz = "temporal_lofcz" in active and active["temporal_lofcz"] is not None
        has_embedding = "embedding" in active and active["embedding"] is not None
        has_spectttra = "spectttra" in active and active["spectttra"] is not None
        # AI-Music-Detection AST-60s public head — only enters fusion when the
        # HF model loaded and produced ≥1 60s window. Substantial base weight
        # (0.20) because empirical data shows it's our strongest *single*
        # signal on Suno-likely tracks (Flint/Dor/Ziso) where lofcz wavers,
        # and it cleared the human reference at 0.065. Position roughly equal
        # in importance to lofcz's 0.45 max-aggregated MoE — the two are
        # complementary specialists, not redundant.
        has_aimd = "aimd" in active and active["aimd"] is not None
        # Watermark only enters the fusion when something actually fired —
        # see the score-collection step where we forward None for the
        # no-signal case. When present, give it a high base weight (0.30):
        # a verified C2PA manifest or AudioSeal hit is essentially ground-
        # truth provenance, far more decisive than any signal-domain heuristic.
        has_watermark = "watermark" in active and active["watermark"] is not None
        weights = {
            "lofcz": 0.45 if has_lofcz else 0.0,
            # Frame-level lofcz: small weight — it shares the same model
            # as whole-track lofcz so its evidence is highly correlated.
            # The real value is the per-frame breakdown + hybrid_zones,
            # not a separate vote in the fusion. Keeping the weight non-zero
            # so partial-AI tracks (where max(frame_scores) is high but the
            # whole-track score averaged out lower) still get nudged up.
            "temporal_lofcz": 0.05 if has_temporal_lofcz else 0.0,
            # AI-MD AST-60s — DOWNWEIGHTED to 0.0 after empirical A/B test
            # on 2026-04-30 (sweep_v5_with_aimd.csv vs sweep_v4_lofcz_fixed.csv).
            # Original projection (Agent C, 2026-04-29) said AI-MD would rescue
            # 24 Suno-Flint/Dor/Ziso tracks, lifting recall from 76% to ~88%.
            # That projection was measured against the BROKEN-lofcz UAI build.
            # After the lofcz weights bug fix, the production stack already
            # catches those Suno tracks; AI-MD's 0.20 weight added 0 new
            # catches but pulled 2 borderline seoul_drift tracks below 0.5.
            # Detector remains loaded (model_loaded=True) for diagnostic
            # inspection / future re-evaluation; just contributes zero weight.
            "aimd": 0.0,
            "embedding": 0.10 if has_embedding else 0.0,
            # Six-head MoE continuation heads. Kept intentionally small:
            # they add human-confirming coverage without disturbing the
            # established v1.3 detector balance.
            "vocal_tremor": 0.04 if has_vocal_tremor else 0.0,
            "stereo_realism": 0.04 if has_stereo_realism else 0.0,
            "watermark": 0.30 if has_watermark else 0.0,
            "codec_residual": 0.08,
            "phase": 0.05,
            "highfreq": 0.10,
            "onset": 0.05 if has_onset else 0.0,
            "longcontext": 0.05 if has_longcontext else 0.0,
            # SpecTTTra long-context — base 0.05. Empirically weak on
            # Lyria 3 / Suno v5+ (post-training-set), so we keep the base
            # weight low. The confidence-weighted fusion will further damp
            # any window that lands near 0.5 anyway.
            "spectttra": 0.05 if has_spectttra else 0.0,
            "lyrics": 0.05 if has_lyrics else 0.0,
            "production": 0.07 if has_production else 0.0,
            # Modulation-spectrum reverb-aware head (Codex DELTA, 2026-04-30).
            # Initial weight 0.05 — held intentionally low until validated on
            # the Codex Z reverb attack set. Scales up only when modspec
            # confidence is high (cross-validation rule below).
            "modspec": 0.05 if active.get("modspec") is not None else 0.0,
        }

        legacy_target = max(0.20, 1.0 - sum(weights.values()))
        legacy_total = sum(float(v) for v in legacy_weights.values())
        scale = legacy_target / legacy_total if legacy_total > 0 else 0.0

        for name, value in legacy_weights.items():
            weights[name] = float(value) * scale

        # Rule 1: Strong checkerboard evidence.
        if fourier.score > 0.7 and len(fourier.artifact_frequencies) >= 5:
            weights["fourier"] += 0.08
            notes.append(
                "Fourier boosted: strong checkerboard artifacts detected "
                f"({len(fourier.artifact_frequencies)} peaks)"
            )

        # Rule 2: Strong fakeprint residue evidence.
        if fakeprint.score > 0.7:
            weights["fakeprint"] += 0.08
            notes.append(
                f"FakePrint boosted: residue energy {fakeprint.residue_energy:.2f}dB"
            )

        # Rule 3: CNN/Fourier disagreement -> trust CNN slightly more.
        if has_cnn and abs(active.get("cnn", 0.5) - active.get("fourier", 0.5)) > 0.4:
            weights["cnn"] += 0.06
            weights["fourier"] = max(0.10, weights["fourier"] - 0.04)
            notes.append(
                f"CNN/Fourier disagree (CNN={active.get('cnn', 0):.2f}, "
                f"Fourier={active.get('fourier', 0):.2f}) -> CNN weighted higher"
            )

        # Rule 4: Fourier high-frequency cliff strengthens Fourier.
        if fourier.highfreq_score > 0.7:
            weights["fourier"] += 0.05
            notes.append(
                f"High-frequency cliff near {fourier.highfreq_dropoff_hz:.0f}Hz -> Fourier boosted"
            )

        # Rule 5: Dedicated high-frequency detector found a sharp cutoff.
        if highfreq.sharp_cutoff_detected:
            weights["highfreq"] += 0.05
            notes.append(
                "HighFreq boosted: brick-wall cutoff near "
                f"{highfreq.cutoff_frequency_hz:.0f}Hz (gradient={highfreq.steepest_gradient_db_per_khz:.1f}dB/kHz)"
            )

        # Rule 6: Cross-check highfreq + codec residual evidence.
        if highfreq.sharp_cutoff_detected and codec_residual.low_degradation_score > 0.6:
            weights["highfreq"] += 0.05
            weights["codec_residual"] += 0.04
            notes.append(
                "HighFreq + CodecResidual agreement: sharp cutoff with low codec degradation "
                f"(codec_score={codec_residual.low_degradation_score:.2f})"
            )

        # Rule 7: Phase anomalies are more informative when multi-band extremes exist.
        if phase.score > 0.65 and phase.extreme_band_count >= 2:
            weights["phase"] += 0.04
            notes.append(
                "Phase detector boosted: multi-band stereo phase extremes "
                f"(bands={phase.extreme_band_count})"
            )

        # Rule 8: Strong onset grid-lock is informative for drums/instrumentals.
        if has_onset and onset.score > 0.65 and onset.confidence > 0.35:
            weights["onset"] += 0.06
            notes.append(
                "Onset detector boosted: micro-timing is tightly grid-locked "
                f"(std={onset.timing_std_ms:.1f}ms, snap={onset.grid_snap_ratio:.0%})"
            )

        # Rule 9: Temporal instability indicates splice/mashup behavior.
        if has_temporal and temporal.transition_magnitudes:
            max_delta = max(temporal.transition_magnitudes)
            if max_delta > 0.35:
                weights["temporal"] += 0.08
                notes.append(
                    f"Temporal detector found abrupt AI-score shifts (max delta={max_delta:.2f})"
                )

        # Rule 10: CNN very decisive.
        if has_cnn and (active.get("cnn", 0.5) > 0.9 or active.get("cnn", 0.5) < 0.1):
            weights["cnn"] += 0.04
            notes.append(f"CNN highly decisive ({active.get('cnn', 0.5):.2f})")

        # Rule 11: Strong long-context structural regularity.
        if has_longcontext and longcontext.structural_regularity > 0.72:
            weights["longcontext"] += 0.05
            notes.append(
                "Long-context boosted: structural regularity over 30-120s windows "
                f"is high ({longcontext.structural_regularity:.2f})"
            )

        # Rule 12: Lyrics show formulaic AI-writing cues.
        if has_lyrics and lyrics.score > 0.68 and lyrics.confidence > 0.35:
            weights["lyrics"] += 0.05
            notes.append(
                "Lyrics detector boosted: transcript shows formulaic AI-writing cues "
                f"(score={lyrics.score:.2f}, confidence={lyrics.confidence:.2f})"
            )

        # Rule 13: Production/mastering signatures are strong.
        if has_production and production.score > 0.68 and production.confidence > 0.35:
            weights["production"] += 0.06
            notes.append(
                "Production detector boosted: mix-bus dynamics/EQ/artifacts look AI-assisted "
                f"(score={production.score:.2f}, confidence={production.confidence:.2f})"
            )

        # Rule 14: New detectors flag AI but AST/CNN say human.
        # This catches AI instrumentals that fool spectrogram-based models.
        # Use max of new detectors (any strong signal counts) not just average
        new_scores = [
            active.get("highfreq", 0.5),
            active.get("codec_residual", 0.5),
            active.get("phase", 0.5),
            active.get("onset", 0.5),
            active.get("production", 0.5),
            active.get("vocal_tremor", 0.5),
            active.get("stereo_realism", 0.5),
        ]
        new_above_threshold = sum(1 for s in new_scores if s > 0.6)
        old_avg = np.mean([active.get("ast", 0.5), active.get("cnn", 0.5)])
        if new_above_threshold >= 2 and old_avg < 0.4:
            # New detectors see AI that old ones missed — heavily boost new, suppress old
            weights["highfreq"] += 0.15
            weights["codec_residual"] += 0.12
            weights["phase"] += 0.08
            weights["onset"] += 0.08
            weights["vocal_tremor"] += 0.04
            weights["stereo_realism"] += 0.04
            weights["ast"] = max(0.03, weights.get("ast", 0) * 0.3)
            weights["cnn"] = max(0.03, weights.get("cnn", 0) * 0.3)
            weights["fourier"] = max(0.02, weights.get("fourier", 0) * 0.3)
            notes.append(
                f"Signal-domain detectors flag AI ({new_above_threshold}/{len(new_scores)} above threshold) but "
                f"spectrogram models disagree (avg={old_avg:.2f}) → "
                "boosting signal detectors, reducing spectrogram models"
            )

        # Rule 15: Modspec disambiguation — when modspec confidently flags AI
        # but lofcz / fakeprint sit near 0.5, this is the reverberated-AI
        # signature the modspec head was designed to catch. Boost modspec and
        # slightly down-weight lofcz/fakeprint, which are reverb-confused
        # (their spectral hull is smeared by the reverb tail).
        if modspec is not None and modspec.model_loaded:
            ms_score = float(modspec.score)
            ms_conf = float(modspec.confidence)
            lofcz_score = active.get("lofcz", 0.5)
            fakeprint_score = active.get("fakeprint", 0.5)
            if ms_score > 0.70 and ms_conf > 0.40 and (
                abs(lofcz_score - 0.5) < 0.20 or abs(fakeprint_score - 0.5) < 0.20
            ):
                weights["modspec"] = weights.get("modspec", 0.0) + 0.10
                weights["lofcz"] = max(0.20, weights.get("lofcz", 0.0) - 0.05)
                weights["fakeprint"] = max(0.05, weights.get("fakeprint", 0.0) - 0.03)
                notes.append(
                    f"Modspec boosted: confident AI ({ms_score:.2f}, conf {ms_conf:.2f}) "
                    f"with lofcz/fakeprint ambiguous "
                    f"(lofcz={lofcz_score:.2f}, fakeprint={fakeprint_score:.2f}) — "
                    "reverberated-AI signature"
                )
            # Conversely: modspec confidently HUMAN with lofcz confidently AI
            # is the "track is just heavily reverberated" case (e.g. live
            # cathedral recording). We don't want modspec to overrule a
            # confident lofcz on those, so we only nudge.
            elif ms_score < 0.30 and ms_conf > 0.40 and lofcz_score > 0.70:
                weights["modspec"] = max(0.02, weights.get("modspec", 0.0) - 0.02)
                notes.append(
                    f"Modspec leans human ({ms_score:.2f}) but lofcz strongly AI "
                    f"({lofcz_score:.2f}) — keeping modspec light"
                )

        # Normalize over active detectors only.
        active_weight_sum = 0.0
        for name in weights:
            if active.get(name) is not None:
                active_weight_sum += max(weights[name], 0.0)
            else:
                weights[name] = 0.0

        if active_weight_sum > 0:
            for name in weights:
                weights[name] = max(weights[name], 0.0) / active_weight_sum

        return weights

    def _compute_confidence(
        self,
        active: dict,
        notes: list,
        total_possible: int = 10,
        longcontext: Optional[LongContextResult] = None,
    ) -> float:
        """Compute confidence based on detector consensus and decisiveness."""
        active_scores = [v for v in active.values() if v is not None]
        if not active_scores:
            return 0.0

        if len(active_scores) >= 2:
            std = np.std(active_scores)
            agreement = 1.0 - min(std * 2.0, 1.0)
        else:
            agreement = 0.5

        avg = float(np.mean(active_scores))
        decisiveness = abs(avg - 0.5) * 2.0

        coverage = len(active_scores) / max(float(total_possible), 1.0)

        ai_votes = sum(1 for s in active_scores if s > 0.6)
        human_votes = sum(1 for s in active_scores if s < 0.4)
        max_votes = max(ai_votes, human_votes)
        consensus = max_votes / len(active_scores)

        confidence = 0.32 * agreement + 0.28 * decisiveness + 0.15 * coverage + 0.25 * consensus

        if len(active_scores) >= 3:
            if consensus >= 0.75:
                notes.append(f"Strong consensus: {max_votes}/{len(active_scores)} detectors agree")
            elif consensus <= 0.5:
                notes.append(
                    f"Weak consensus split ({ai_votes} AI, {human_votes} Human, "
                    f"{len(active_scores) - ai_votes - human_votes} Mixed)"
                )

        # Cross-validation rule:
        # if long-context detects strong structural repetition and other
        # detectors independently flag AI, increase confidence.
        if longcontext is not None:
            high_long_repetition = (
                longcontext.mean_structural_repetition >= 0.68
                or longcontext.structural_regularity >= 0.72
            )
            other_ai_votes = sum(
                1
                for name, score in active.items()
                if name != "longcontext" and score is not None and score > 0.6
            )
            if high_long_repetition and other_ai_votes >= 2:
                boost = min(0.12, 0.04 + 0.02 * other_ai_votes)
                confidence = float(np.clip(confidence + boost, 0.0, 1.0))
                notes.append(
                    "Confidence boosted: long-context structural repetition aligns with "
                    f"{other_ai_votes} AI-leaning detector(s)"
                )

        return float(np.clip(confidence, 0, 1))

    def _determine_verdict(
        self,
        combined: float,
        confidence: float,
        temporal: Optional[TemporalResult],
        segment: Optional[SegmentResult],
        notes: list,
        temporal_lofcz: Optional[TemporalLofczResult] = None,
    ) -> tuple:
        """Determine final verdict considering hybrid evidence."""

        # Temporal hybrid detection: both strong AI and strong human spans.
        if temporal and temporal.ai_score_series:
            has_ai_chunks = any(s > 0.65 for s in temporal.ai_score_series)
            has_human_chunks = any(s < 0.35 for s in temporal.ai_score_series)
            if (
                has_ai_chunks
                and has_human_chunks
                and len(temporal.splice_candidates_sec) >= 2
                and temporal.confidence >= 0.55
                and len(temporal.ai_score_series) >= 6
            ):
                notes.append(
                    "Temporal analysis shows alternating AI-like and human-like chunks "
                    "-> Hybrid verdict"
                )
                return "Hybrid (Temporal AI Shift)", "\U0001F39A"

        # Frame-level lofcz hybrid detection. Treat partial temporal coverage
        # as hybrid; full-track AI coverage falls through to the score buckets.
        if temporal_lofcz and temporal_lofcz.hybrid_zones:
            zones = self._merge_adjacent_hybrid_zones(
                self._filter_hybrid_zones_by_duration(
                    list(temporal_lofcz.hybrid_zones)
                )
            )
            if zones and temporal_lofcz.frame_times_sec:
                start = min(t[0] for t in temporal_lofcz.frame_times_sec)
                end = max(t[1] for t in temporal_lofcz.frame_times_sec)
                total = max(end - start, 1e-6)
                ai_duration = sum(max(0.0, zone_end - zone_start)
                                  for zone_start, zone_end in zones)
                ai_fraction = float(np.clip(ai_duration / total, 0.0, 1.0))
                if 0.05 < ai_fraction < 0.95:
                    ai_pct = int(round(ai_fraction * 100.0))
                    if combined < self.VERDICT_UNCERTAIN_MAX:
                        notes.append(
                            "Frame-level lofcz partial AI zones suppressed: "
                            f"{ai_pct}% temporal coverage but aggregate score "
                            f"{combined:.3f} is below the likely-AI gate"
                        )
                    else:
                        notes.append(
                            "Frame-level lofcz emitted partial AI zones "
                            f"({ai_pct}% AI coverage) -> Hybrid verdict"
                        )
                        return f"Hybrid ({ai_pct}% AI)", "\U0001F39A"

        # Stem hybrid detection.
        if segment and segment.stems:
            ai_stems = [s.name for s in segment.stems.values() if s.has_content and s.score > 0.6]
            human_stems = [s.name for s in segment.stems.values() if s.has_content and s.score < 0.4]
            active_stems = [s for s in segment.stems.values() if s.has_content]

            if ai_stems and human_stems and combined >= self.VERDICT_LIKELY_HUMAN_MAX:
                notes.append(
                    f"Stems indicate AI in [{', '.join(ai_stems)}] and human in "
                    f"[{', '.join(human_stems)}] -> Hybrid verdict"
                )
                return "Hybrid (AI + Human)", "\U0001F916\U0001F3B5"

            if len(ai_stems) >= max(2, len(active_stems) // 2) and not human_stems:
                notes.append(
                    f"Most stems flag AI ({len(ai_stems)}/{len(active_stems)}) -> overriding mix score"
                )
                return "AI Generated", "\U0001F916"

        if combined < self.VERDICT_HUMAN_MADE_MAX:
            return "Human Made", "\U0001F3B5"
        if combined < self.VERDICT_LIKELY_HUMAN_MAX:
            return "Likely Human", "\U0001F3B5"
        if combined < self.VERDICT_UNCERTAIN_MAX:
            return "Uncertain", "\U0001F914"
        if combined < self.VERDICT_LIKELY_AI_MAX:
            return "Likely AI", "\U0001F916"
        if combined >= self.VERDICT_LIKELY_AI_MAX:
            return "AI Generated", "\U0001F916"
        return "Uncertain", "\U0001F914"

    def get_top_reasons(self, result: EnsembleResult, top_k: int = 3) -> List[str]:
        """
        Return top evidence-backed reasons for the final verdict.

        Output examples:
        - "Checkerboard artifacts at ~2.3kHz equivalent periodicity..."
        - "MFCC variation 3x below human average..."
        - "High-freq cliff at 11kHz..."
        """
        candidates = []

        # Fourier checkerboard / high-frequency evidence
        if result.fourier:
            if result.fourier.artifact_frequencies:
                n_peaks = len(result.fourier.artifact_frequencies)
                candidates.append(
                    (
                        min(1.0, 0.3 + 0.1 * n_peaks),
                        f"Checkerboard artifacts: {n_peaks} periodic spectral peaks detected",
                    )
                )

            if result.fourier.highfreq_dropoff_hz > 0 and result.fourier.highfreq_score > 0.4:
                candidates.append(
                    (
                        result.fourier.highfreq_score,
                        f"High-frequency cliff near {result.fourier.highfreq_dropoff_hz:.0f}Hz",
                    )
                )

        # FakePrint residue evidence
        if result.fakeprint:
            candidates.append(
                (
                    result.fakeprint.score,
                    (
                        f"FakePrint residue energy {result.fakeprint.residue_energy:.2f}dB "
                        f"(p95={result.fakeprint.residue_p95:.2f}dB)"
                    ),
                )
            )

        # Spectral MFCC evidence
        if result.spectral:
            mfcc_details = result.spectral.feature_details.get("mfcc", {})
            mfcc_var = mfcc_details.get("avg_temporal_variation")
            mfcc_delta = mfcc_details.get("avg_delta_magnitude")
            if mfcc_var is not None and mfcc_delta is not None:
                # 20 is the current detector's rough human-like variation boundary.
                ratio = 20.0 / max(float(mfcc_var), 1e-6)
                candidates.append(
                    (
                        float(result.spectral.feature_scores.get("mfcc", 0.5)),
                        (
                            f"MFCC variation {ratio:.1f}x below human-like baseline "
                            f"(var={float(mfcc_var):.2f}, delta={float(mfcc_delta):.2f})"
                        ),
                    )
                )

        # Codec residual evidence
        if result.codec_residual:
            candidates.append(
                (
                    result.codec_residual.score,
                    (
                        "MP3-64 codec residual: "
                        f"degradation_ratio={result.codec_residual.degradation_ratio:.4f}, "
                        f"logdiff={result.codec_residual.log_spectral_distance_db:.2f}dB, "
                        f"high_loss={result.codec_residual.high_band_loss_ratio:.4f}"
                    ),
                )
            )

        # High-frequency cutoff evidence
        if result.highfreq and result.highfreq.cutoff_frequency_hz > 0:
            candidates.append(
                (
                    result.highfreq.score,
                    (
                        f"High-frequency cutoff at {result.highfreq.cutoff_frequency_hz:.0f}Hz "
                        f"(gradient={result.highfreq.steepest_gradient_db_per_khz:.1f}dB/kHz, "
                        f"15-17k vs 17-20k={result.highfreq.band_energy_ratio_db:.1f}dB)"
                    ),
                )
            )

        # Stereo phase evidence
        if result.phase and result.phase.stereo_present:
            candidates.append(
                (
                    result.phase.score,
                    (
                        "Stereo phase anomaly: "
                        f"coherence={result.phase.mean_coherence:.2f}, "
                        f"entropy={result.phase.mean_entropy:.2f}, "
                        f"extreme bands={result.phase.extreme_band_count}"
                    ),
                )
            )

        # Onset micro-timing evidence
        if result.onset and result.onset.confidence > 0:
            candidates.append(
                (
                    result.onset.score,
                    (
                        "Onset micro-timing: "
                        f"std={result.onset.timing_std_ms:.1f}ms, "
                        f"snap={result.onset.grid_snap_ratio:.0%}, "
                        f"IOI CV={result.onset.ioi_cv:.2f}"
                    ),
                )
            )

        # CNN whole-track + generator evidence
        if result.cnn and result.cnn.model_loaded and result.cnn.window_scores:
            max_win = max(result.cnn.window_scores)
            mean_win = float(np.mean(result.cnn.window_scores))
            hi_windows = sum(1 for s in result.cnn.window_scores if s > 0.7)
            candidates.append(
                (
                    abs(result.cnn.score - 0.5) * 2,
                    (
                        f"CNN window evidence: mean={mean_win:.2f}, max={max_win:.2f}, "
                        f"high-AI windows={hi_windows}/{len(result.cnn.window_scores)}"
                    ),
                )
            )

            if result.cnn.predicted_generator and result.cnn.predicted_generator != "human":
                gen_prob = result.cnn.generator_probabilities.get(result.cnn.predicted_generator, 0.0)
                candidates.append(
                    (
                        gen_prob,
                        (
                            f"Generator attribution leans {result.cnn.predicted_generator} "
                            f"(p={gen_prob:.2f})"
                        ),
                    )
                )

        # Temporal splice evidence
        if result.temporal and result.temporal.transition_magnitudes:
            max_delta = max(result.temporal.transition_magnitudes)
            if result.temporal.splice_candidates_sec:
                first_times = ", ".join(f"{t:.1f}s" for t in result.temporal.splice_candidates_sec[:3])
                candidates.append(
                    (
                        min(1.0, max_delta),
                        f"Temporal discontinuities detected (max chunk delta={max_delta:.2f}) at {first_times}",
                    )
                )

        # Long-context structural evidence
        if result.longcontext:
            candidates.append(
                (
                    result.longcontext.structural_regularity,
                    (
                        "Long-context structural regularity over 30-120s windows is "
                        f"{result.longcontext.structural_regularity:.2f}"
                    ),
                )
            )
            if result.longcontext.suspicious_section_pairs:
                pair = result.longcontext.suspicious_section_pairs[0]
                candidates.append(
                    (
                        pair.similarity,
                        (
                            "Distant sections share highly similar self-similarity patterns "
                            f"({pair.start_a_sec:.1f}s vs {pair.start_b_sec:.1f}s, sim={pair.similarity:.2f})"
                        ),
                    )
                )

        # SpecTTTra long-context (SONICS / ICLR 2025) evidence
        if (result.spectttra and result.spectttra.model_loaded
                and result.spectttra.window_count > 0
                and result.spectttra.confidence > 0.05):
            confidence_strength = result.spectttra.confidence * abs(result.spectttra.score - 0.5) * 2.0
            label = "SpecTTTra-AI" if result.spectttra.score >= 0.5 else "SpecTTTra-real"
            candidates.append(
                (
                    confidence_strength,
                    (
                        f"{label}: long-context (120s) score={result.spectttra.score:.2f} "
                        f"over {result.spectttra.window_count} windows "
                        f"(SONICS, ICLR 2025)"
                    ),
                )
            )

        # Lyrics writing-pattern evidence
        if result.lyrics and result.lyrics.confidence > 0.05:
            for reason in result.lyrics.reasons[:3]:
                candidates.append(
                    (
                        result.lyrics.confidence * abs(result.lyrics.score - 0.5) * 2.0,
                        f"Lyrics: {reason}",
                    )
                )

        # Production/mastering evidence
        if result.production and result.production.confidence > 0.05:
            for reason in result.production.reasons[:3]:
                candidates.append(
                    (
                        result.production.confidence * abs(result.production.score - 0.5) * 2.0,
                        f"Production: {reason}",
                    )
                )

        # Six-head MoE continuation evidence
        if result.vocal_tremor and result.vocal_tremor.confidence > 0.1:
            feats = result.vocal_tremor.features or {}
            candidates.append(
                (
                    result.vocal_tremor.confidence * abs(result.vocal_tremor.score - 0.5) * 2.0,
                    (
                        "Vocal micro-tremor: "
                        f"tremor={float(feats.get('tremor_pct', 0.0)) * 100.0:.2f}% "
                        f"of F0, regularity={float(feats.get('tremor_regularity', 0.0)):.2f}"
                    ),
                )
            )

        if result.stereo_realism and result.stereo_realism.confidence > 0.1:
            feats = result.stereo_realism.features or {}
            candidates.append(
                (
                    result.stereo_realism.confidence * abs(result.stereo_realism.score - 0.5) * 2.0,
                    (
                        "Stereo imaging realism: "
                        f"high-band coherence={float(feats.get('high_band_coherence', 0.0)):.2f}, "
                        f"width slope={float(feats.get('width_slope', 0.0)):.3f}"
                    ),
                )
            )

        # Segment hybrid evidence
        if result.segment and result.segment.stems:
            ai_stems = result.segment.ai_stems
            human_stems = result.segment.human_stems
            if ai_stems and human_stems:
                candidates.append(
                    (
                        0.95,
                        (
                            f"Stem split shows AI in [{', '.join(ai_stems)}] and "
                            f"human in [{', '.join(human_stems)}]"
                        ),
                    )
                )

        # Fall back to generic note if needed.
        if not candidates:
            return ["No strong detector-specific evidence available"]

        # Sort by strength and deduplicate message text.
        candidates.sort(key=lambda item: item[0], reverse=True)
        reasons = []
        seen = set()
        for _, message in candidates:
            if message in seen:
                continue
            seen.add(message)
            reasons.append(message)
            if len(reasons) >= top_k:
                break
        return reasons
