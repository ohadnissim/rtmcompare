"""Per-stem scoring pipeline for hybrid-aware track verdicts."""

from __future__ import annotations

import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional

import numpy as np

from .engine import EnsembleDetector
from .hybrid_aggregator import HybridAggregator
from .stem_backends import get_backend


CANONICAL_STEMS = ("vocals", "drums", "bass", "other")
INSTRUMENTAL_COMPONENTS = ("drums", "bass", "other")
CASCADE_DEMUCS_TIMEOUT_SEC = 1200


@dataclass
class PerStemResult:
    """Per-stem score summary plus the hybrid-aware track verdict."""

    vocals_score: Optional[float]
    drums_score: Optional[float]
    bass_score: Optional[float]
    other_score: Optional[float]
    instrumental_aggregate: Optional[float]
    max_stem_score: Optional[float]
    max_stem_name: Optional[str]
    full_mix_score: float
    track_verdict: str
    full_mix_verdict: str = ""
    instrumental_score: Optional[float] = None
    stem_scores: Dict[str, float] = field(default_factory=dict)
    stem_verdicts: Dict[str, str] = field(default_factory=dict)
    stem_detector_scores: Dict[str, Dict[str, float]] = field(default_factory=dict)
    stem_notes: Dict[str, list[str]] = field(default_factory=dict)
    stem_4way_classes: Dict[str, str] = field(default_factory=dict)
    stem_4way_probabilities: Dict[str, Dict[str, float]] = field(default_factory=dict)
    stem_paths: Dict[str, str] = field(default_factory=dict)
    full_mix_detector_scores: Dict[str, float] = field(default_factory=dict)
    full_mix_notes: list[str] = field(default_factory=list)
    separation_dir: str = ""


class PerStemScorer:
    """Run stem separation, score each stem with the ensemble, then aggregate."""

    def __init__(self, engine: EnsembleDetector, stem_backend: str = "bs_roformer_4stem"):
        self.engine = engine
        self.stem_backend = str(stem_backend or "bs_roformer_4stem").strip().lower()
        device = str(getattr(engine, "device", "cpu") or "cpu").strip().lower()
        self.backend = get_backend(self.stem_backend, device=device)
        self._allow_full_track_cpu_demucs()

    def analyze(self, audio_path: str) -> PerStemResult:
        """Analyze a full mix with the per-stem pipeline."""
        source = Path(audio_path)
        out_dir = tempfile.mkdtemp(prefix="uai_per_stem_")
        stem_paths = self.backend.separate(str(source), out_dir)
        stem_paths = {
            name: str(Path(path).resolve()) if Path(path).exists() else str(path)
            for name, path in stem_paths.items()
        }

        full_mix = self._analyze_audio(str(source), stem_name=None)

        stem_scores: Dict[str, float] = {}
        stem_verdicts: Dict[str, str] = {}
        stem_detector_scores: Dict[str, Dict[str, float]] = {}
        stem_notes: Dict[str, list[str]] = {}
        stem_4way_classes: Dict[str, str] = {}
        stem_4way_probabilities: Dict[str, Dict[str, float]] = {}
        for stem_name, stem_path in stem_paths.items():
            stem_result = self._analyze_audio(stem_path, stem_name=stem_name)
            detector_scores = self._float_dict(
                getattr(stem_result, "detector_scores", {}) or {}
            )
            notes = list(getattr(stem_result, "cross_validation_notes", []) or [])
            calibrated_score = self._v1_4_stem_score(
                stem_result=stem_result,
                stem_name=stem_name,
                stem_path=stem_path,
                detector_scores=detector_scores,
                notes=notes,
            )
            if calibrated_score is not None:
                stem_result.score = calibrated_score
                stem_result.verdict = self._score_to_verdict(calibrated_score)

            four_way = self._v1_4_4way_class(
                stem_result=stem_result,
                stem_name=stem_name,
                stem_path=stem_path,
                detector_scores=detector_scores,
            )
            if four_way:
                label = str(four_way.get("class") or "")
                if label:
                    stem_4way_classes[stem_name] = label
                    notes.append(
                        "v1.4 4-way class: "
                        f"{label} ({float(four_way.get('confidence', 0.0)):.3f})"
                    )
                probs = four_way.get("probabilities")
                if isinstance(probs, dict):
                    stem_4way_probabilities[stem_name] = self._float_dict(probs)

            verdict = str(getattr(stem_result, "verdict", ""))
            score = float(getattr(stem_result, "score", 0.5))
            if np.isfinite(score):
                stem_scores[stem_name] = float(np.clip(score, 0.0, 1.0))
            stem_verdicts[stem_name] = verdict
            stem_detector_scores[stem_name] = detector_scores
            stem_notes[stem_name] = notes

        instrumental_aggregate = self._instrumental_aggregate(stem_scores)
        max_stem_name, max_stem_score = self._max_stem(stem_scores)
        track_verdict = self._aggregate_track_verdict(
            stem_scores=stem_scores,
            stem_verdicts=stem_verdicts,
        )

        return PerStemResult(
            vocals_score=stem_scores.get("vocals"),
            drums_score=stem_scores.get("drums"),
            bass_score=stem_scores.get("bass"),
            other_score=stem_scores.get("other"),
            instrumental_aggregate=instrumental_aggregate,
            max_stem_score=max_stem_score,
            max_stem_name=max_stem_name,
            full_mix_score=float(np.clip(float(getattr(full_mix, "score", 0.5)), 0.0, 1.0)),
            track_verdict=track_verdict,
            full_mix_verdict=str(getattr(full_mix, "verdict", "")),
            instrumental_score=stem_scores.get("instrumental"),
            stem_scores=stem_scores,
            stem_verdicts=stem_verdicts,
            stem_detector_scores=stem_detector_scores,
            stem_notes=stem_notes,
            stem_4way_classes=stem_4way_classes,
            stem_4way_probabilities=stem_4way_probabilities,
            stem_paths=stem_paths,
            full_mix_detector_scores=self._float_dict(
                getattr(full_mix, "detector_scores", {}) or {}
            ),
            full_mix_notes=list(getattr(full_mix, "cross_validation_notes", []) or []),
            separation_dir=out_dir,
        )

    def _allow_full_track_cpu_demucs(self) -> None:
        demucs = getattr(self.backend, "demucs", None)
        if demucs is None or not hasattr(demucs, "timeout"):
            return
        try:
            demucs.timeout = max(int(demucs.timeout), CASCADE_DEMUCS_TIMEOUT_SEC)
        except (TypeError, ValueError):
            demucs.timeout = CASCADE_DEMUCS_TIMEOUT_SEC

    def _analyze_audio(self, audio_path: str, stem_name: Optional[str]):
        kwargs = {"run_segments": False}
        if stem_name == "vocals":
            kwargs["vocals_path"] = audio_path
        if stem_name is None:
            return self.engine.analyze(audio_path, **kwargs)

        old_low_band_guard = getattr(self.engine, "low_band_guard", None)
        if old_low_band_guard is None:
            return self.engine.analyze(audio_path, **kwargs)

        self.engine.low_band_guard = False
        try:
            return self.engine.analyze(audio_path, **kwargs)
        finally:
            self.engine.low_band_guard = old_low_band_guard

    def _v1_4_stem_score(
        self,
        *,
        stem_result: object,
        stem_name: str,
        stem_path: str,
        detector_scores: Dict[str, float],
        notes: list[str],
    ) -> Optional[float]:
        calibrate = getattr(self.engine, "apply_v1_4_stem_calibration", None)
        if calibrate is None:
            return None
        raw_score = float(np.clip(float(getattr(stem_result, "score", 0.5)), 0.0, 1.0))
        calibrated = calibrate(
            score=raw_score,
            scores=detector_scores,
            audio_path=stem_path,
            stem_type=stem_name,
        )
        if calibrated is None:
            return None
        if abs(float(calibrated) - raw_score) > 1e-6:
            notes.append(
                "v1.4 stem calibration applied: "
                f"score {raw_score:.3f}->{float(calibrated):.3f}"
            )
        return float(calibrated)

    def _v1_4_4way_class(
        self,
        *,
        stem_result: object,
        stem_name: str,
        stem_path: str,
        detector_scores: Dict[str, float],
    ) -> Optional[dict[str, object]]:
        classify = getattr(self.engine, "predict_v1_4_4way_class", None)
        if classify is None:
            return None
        raw_score = float(np.clip(float(getattr(stem_result, "score", 0.5)), 0.0, 1.0))
        return classify(
            score=raw_score,
            scores=detector_scores,
            audio_path=stem_path,
            stem_type=stem_name,
        )

    @staticmethod
    def _instrumental_aggregate(stem_scores: Dict[str, float]) -> Optional[float]:
        component_scores = [
            stem_scores[name]
            for name in INSTRUMENTAL_COMPONENTS
            if name in stem_scores
        ]
        if component_scores:
            return float(max(component_scores))
        if "instrumental" in stem_scores:
            return float(stem_scores["instrumental"])
        return None

    @staticmethod
    def _max_stem(stem_scores: Dict[str, float]) -> tuple[Optional[str], Optional[float]]:
        if not stem_scores:
            return None, None
        name, score = max(stem_scores.items(), key=lambda item: item[1])
        return name, float(score)

    @staticmethod
    def _float_dict(values: Dict[str, object]) -> Dict[str, float]:
        clean: Dict[str, float] = {}
        for name, value in values.items():
            try:
                number = float(value)
            except (TypeError, ValueError):
                continue
            if np.isfinite(number):
                clean[str(name)] = number
        return clean

    @staticmethod
    def _score_to_verdict(score: float) -> str:
        score = float(np.clip(score, 0.0, 1.0))
        if score < 0.30:
            return "Human Made"
        if score < 0.50:
            return "Likely Human"
        if score < 0.70:
            return "Likely AI"
        return "AI Generated"

    @staticmethod
    def _aggregate_track_verdict(
        stem_scores: Dict[str, float],
        stem_verdicts: Dict[str, str],
    ) -> str:
        return HybridAggregator().aggregate(
            per_stem_scores=stem_scores,
            stem_verdicts=stem_verdicts,
        ).verdict
