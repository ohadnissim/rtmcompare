"""Track-level verdict aggregation from per-stem AI scores."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional


STEM_HUMAN_MAX = 0.30
STEM_UNCERTAIN_MAX = 0.50
STEM_AI_LIKELY_MIN = 0.50
STEM_AI_CONFIRMED_MIN = 0.70
CONFIDENCE_CAP = 0.95


@dataclass
class HybridVerdict:
    """Hybrid-aware track-level verdict derived from stem scores."""

    verdict: str
    confidence: float
    primary_explanation: str
    per_stem_breakdown: Dict[str, float]
    hybrid_components: List[str] = field(default_factory=list)


class HybridAggregator:
    """Aggregate stem-level AI probabilities into a buyer-facing verdict."""

    _VOCAL_STEM = "vocals"
    _INSTRUMENT_STEMS = ("drums", "bass", "other")
    _CANONICAL_STEMS = (_VOCAL_STEM, *_INSTRUMENT_STEMS)
    _INSTRUMENTAL_ALIASES = {"instrumental", "instrumentals", "no_vocals"}

    def aggregate(
        self,
        per_stem_scores: Dict[str, float],
        full_mix_score: Optional[float] = None,
        stem_verdicts: Optional[Dict[str, str]] = None,
    ) -> HybridVerdict:
        """Return the hybrid-aware track verdict for a set of stem scores.

        ``full_mix_score`` is accepted for API symmetry with the engine but is
        intentionally not fused into this pure stem-level policy.
        """
        del full_mix_score

        normalized_verdicts = self._normalize_verdicts(stem_verdicts or {})
        if self._has_out_of_scope_verdict(normalized_verdicts):
            breakdown = self._normalize_scores(per_stem_scores or {})
            return self._result(
                verdict="Out of Scope",
                confidence=0.0,
                explanation="Stem analysis returned Out of Scope",
                breakdown=breakdown,
            )

        scores = self._normalize_scores(per_stem_scores or {})
        if not scores:
            return self._result(
                verdict="Out of Scope",
                confidence=0.0,
                explanation="Stem separation failed or returned no usable stems",
                breakdown={},
            )

        supported = self._supported_scores(scores)
        if not supported:
            return self._result(
                verdict="Uncertain",
                confidence=0.0,
                explanation="No supported stem scores available",
                breakdown=scores,
            )

        missing = self._missing_required_stems(supported)
        if missing:
            return self._result(
                verdict="Uncertain",
                confidence=0.0,
                explanation=(
                    "Missing required stem scores: " + ", ".join(sorted(missing))
                ),
                breakdown=scores,
            )

        stem_names = list(supported)
        n_ai_confirmed = sum(
            supported[name] >= STEM_AI_CONFIRMED_MIN for name in stem_names
        )
        n_ai_likely = sum(
            STEM_AI_LIKELY_MIN <= supported[name] < STEM_AI_CONFIRMED_MIN
            for name in stem_names
        )
        n_human = sum(supported[name] < STEM_HUMAN_MAX for name in stem_names)
        n_uncertain = sum(
            STEM_HUMAN_MAX <= supported[name] < STEM_AI_LIKELY_MIN
            for name in stem_names
        )

        confirmed_ai_stems = [
            name for name in stem_names if supported[name] >= STEM_AI_CONFIRMED_MIN
        ]
        likely_ai_stems = [
            name
            for name in stem_names
            if STEM_AI_LIKELY_MIN <= supported[name] < STEM_AI_CONFIRMED_MIN
        ]
        human_stems = [
            name for name in stem_names if supported[name] < STEM_HUMAN_MAX
        ]

        if n_ai_confirmed == len(stem_names):
            return self._result(
                verdict="AI Generated",
                confidence=self._ai_confidence(supported, confirmed_ai_stems),
                explanation="Pure AI production",
                breakdown=scores,
            )

        vocal_score = supported.get(self._VOCAL_STEM)
        instrumental_names = [
            name
            for name in self._instrument_names_for_supported(supported)
            if name in supported
        ]
        instrumental_scores = [supported[name] for name in instrumental_names]
        instrumental_all_human = bool(instrumental_scores) and all(
            score < STEM_HUMAN_MAX for score in instrumental_scores
        )
        instrumental_all_confirmed = bool(instrumental_scores) and all(
            score >= STEM_AI_CONFIRMED_MIN for score in instrumental_scores
        )

        if (
            vocal_score is not None
            and vocal_score < STEM_HUMAN_MAX
            and instrumental_all_confirmed
        ):
            return self._hybrid_result(
                scores=scores,
                supported=supported,
                ai_stems=instrumental_names,
                human_stems=[self._VOCAL_STEM],
                explanation="AI instrumental, human vocals",
            )

        if (
            vocal_score is not None
            and vocal_score >= STEM_AI_CONFIRMED_MIN
            and instrumental_all_human
        ):
            return self._hybrid_result(
                scores=scores,
                supported=supported,
                ai_stems=[self._VOCAL_STEM],
                human_stems=instrumental_names,
                explanation="AI vocals, human instrumental",
            )

        if n_ai_confirmed >= 3:
            return self._result(
                verdict="AI Generated",
                confidence=self._ai_confidence(supported, confirmed_ai_stems),
                explanation=self._mostly_ai_explanation(confirmed_ai_stems),
                breakdown=scores,
            )

        if n_ai_confirmed == 2:
            if n_human > 0:
                return self._hybrid_result(
                    scores=scores,
                    supported=supported,
                    ai_stems=confirmed_ai_stems,
                    human_stems=human_stems,
                    explanation=self._hybrid_explanation(confirmed_ai_stems, human_stems),
                )
            return self._result(
                verdict="Likely AI",
                confidence=self._ai_confidence(supported, confirmed_ai_stems),
                explanation="Multiple stems show confirmed AI signal",
                breakdown=scores,
            )

        if n_ai_confirmed == 1:
            if n_human == len(stem_names) - 1:
                ai_stem = confirmed_ai_stems[0]
                return self._hybrid_result(
                    scores=scores,
                    supported=supported,
                    ai_stems=confirmed_ai_stems,
                    human_stems=human_stems,
                    explanation=self._single_ai_explanation(ai_stem),
                )
            if n_human > 0:
                return self._hybrid_result(
                    scores=scores,
                    supported=supported,
                    ai_stems=confirmed_ai_stems,
                    human_stems=human_stems,
                    explanation=self._hybrid_explanation(confirmed_ai_stems, human_stems),
                )
            return self._result(
                verdict="Likely AI",
                confidence=self._ai_confidence(supported, confirmed_ai_stems),
                explanation=f"Confirmed AI signal in {confirmed_ai_stems[0]}",
                breakdown=scores,
            )

        if n_ai_likely >= 2:
            return self._result(
                verdict="Likely Hybrid",
                confidence=self._likely_hybrid_confidence(supported, likely_ai_stems),
                explanation="Multiple stems show likely AI signal",
                breakdown=scores,
                hybrid_components=likely_ai_stems,
            )

        if n_ai_likely == 1:
            return self._result(
                verdict="Uncertain",
                confidence=self._uncertain_confidence(supported),
                explanation="Mixed signals - recommend manual review",
                breakdown=scores,
            )

        if n_human == len(stem_names):
            return self._result(
                verdict="Human Made",
                confidence=self._human_confidence(supported, stem_names),
                explanation="Pure human production",
                breakdown=scores,
            )

        if n_uncertain <= 1:
            return self._result(
                verdict="Likely Human",
                confidence=self._human_confidence(supported, stem_names),
                explanation="Mostly human stem scores with limited uncertainty",
                breakdown=scores,
            )

        return self._result(
            verdict="Uncertain",
            confidence=self._uncertain_confidence(supported),
            explanation="Mixed signals - recommend manual review",
            breakdown=scores,
        )

    def _normalize_scores(self, per_stem_scores: Dict[str, float]) -> Dict[str, float]:
        normalized: Dict[str, float] = {}
        for raw_name, raw_score in per_stem_scores.items():
            name = self._normalize_stem_name(raw_name)
            if not name:
                continue
            score = self._clamp_score(raw_score)
            if name in normalized:
                normalized[name] = max(normalized[name], score)
            else:
                normalized[name] = score
        if "instrumental" in normalized and any(
            stem in normalized for stem in self._INSTRUMENT_STEMS
        ):
            normalized.pop("instrumental")
        return normalized

    def _normalize_verdicts(self, stem_verdicts: Dict[str, str]) -> Dict[str, str]:
        return {
            self._normalize_stem_name(name): str(verdict).strip()
            for name, verdict in stem_verdicts.items()
            if self._normalize_stem_name(name)
        }

    def _normalize_stem_name(self, stem_name: object) -> str:
        name = str(stem_name).strip().lower().replace("-", "_").replace(" ", "_")
        if name in self._INSTRUMENTAL_ALIASES:
            return "instrumental"
        if name == "vocal":
            return self._VOCAL_STEM
        return name

    def _supported_scores(self, scores: Dict[str, float]) -> Dict[str, float]:
        supported_names = set(self._CANONICAL_STEMS) | {"instrumental"}
        return {name: score for name, score in scores.items() if name in supported_names}

    def _missing_required_stems(self, supported: Dict[str, float]) -> List[str]:
        names = set(supported)
        if self._VOCAL_STEM in names and "instrumental" in names:
            return []
        if any(stem in names for stem in self._INSTRUMENT_STEMS):
            return [stem for stem in self._CANONICAL_STEMS if stem not in names]
        return [stem for stem in self._CANONICAL_STEMS if stem not in names]

    def _instrument_names_for_supported(self, supported: Dict[str, float]) -> List[str]:
        if "instrumental" in supported:
            return ["instrumental"]
        return [stem for stem in self._INSTRUMENT_STEMS if stem in supported]

    @staticmethod
    def _has_out_of_scope_verdict(stem_verdicts: Dict[str, str]) -> bool:
        return any(
            verdict.strip().lower().startswith("out of scope")
            for verdict in stem_verdicts.values()
        )

    @staticmethod
    def _clamp_score(score: float) -> float:
        try:
            value = float(score)
        except (TypeError, ValueError):
            return 0.5
        if not math.isfinite(value):
            return 0.5
        return min(1.0, max(0.0, value))

    def _hybrid_result(
        self,
        scores: Dict[str, float],
        supported: Dict[str, float],
        ai_stems: List[str],
        human_stems: List[str],
        explanation: str,
    ) -> HybridVerdict:
        return self._result(
            verdict="Hybrid AI",
            confidence=self._hybrid_confidence(supported, ai_stems, human_stems),
            explanation=explanation,
            breakdown=scores,
            hybrid_components=ai_stems,
        )

    def _result(
        self,
        verdict: str,
        confidence: float,
        explanation: str,
        breakdown: Dict[str, float],
        hybrid_components: Optional[List[str]] = None,
    ) -> HybridVerdict:
        return HybridVerdict(
            verdict=verdict,
            confidence=self._cap_confidence(confidence),
            primary_explanation=explanation,
            per_stem_breakdown=dict(breakdown),
            hybrid_components=list(hybrid_components or []),
        )

    @staticmethod
    def _cap_confidence(confidence: float) -> float:
        if not math.isfinite(float(confidence)):
            return 0.0
        return min(CONFIDENCE_CAP, max(0.0, float(confidence)))

    def _ai_confidence(self, scores: Dict[str, float], ai_stems: List[str]) -> float:
        if not ai_stems:
            return max(scores.values(), default=0.0)
        return max(scores[name] for name in ai_stems)

    def _human_confidence(self, scores: Dict[str, float], stems: List[str]) -> float:
        if not stems:
            return 0.0
        return min(1.0 - scores[name] for name in stems)

    def _hybrid_confidence(
        self,
        scores: Dict[str, float],
        ai_stems: List[str],
        human_stems: List[str],
    ) -> float:
        ai_confidence = min((scores[name] for name in ai_stems), default=0.0)
        human_confidence = min((1.0 - scores[name] for name in human_stems), default=0.0)
        return min(ai_confidence, human_confidence)

    def _likely_hybrid_confidence(
        self,
        scores: Dict[str, float],
        likely_ai_stems: List[str],
    ) -> float:
        likely_confidence = min((scores[name] for name in likely_ai_stems), default=0.5)
        human_stems = [name for name, score in scores.items() if score < STEM_HUMAN_MAX]
        human_confidence = min((1.0 - scores[name] for name in human_stems), default=likely_confidence)
        return min(likely_confidence, human_confidence)

    @staticmethod
    def _uncertain_confidence(scores: Dict[str, float]) -> float:
        if not scores:
            return 0.0
        closest_to_center = min(abs(score - 0.5) for score in scores.values())
        return 1.0 - min(1.0, closest_to_center * 2.0)

    def _single_ai_explanation(self, ai_stem: str) -> str:
        if ai_stem == self._VOCAL_STEM:
            return "AI vocals, human instrumental"
        if ai_stem == "instrumental":
            return "AI instrumental, human vocals"
        return f"AI in {ai_stem} only"

    def _hybrid_explanation(self, ai_stems: List[str], human_stems: List[str]) -> str:
        if ai_stems == [self._VOCAL_STEM]:
            return "AI vocals, human instrumental"
        if ai_stems == ["instrumental"]:
            return "AI instrumental, human vocals"
        if (
            self._VOCAL_STEM in human_stems
            and set(ai_stems).issubset(set(self._INSTRUMENT_STEMS))
        ):
            if set(ai_stems) == set(self._INSTRUMENT_STEMS):
                return "AI instrumental, human vocals"
            return "AI in " + ", ".join(ai_stems)
        return (
            "AI in "
            + ", ".join(ai_stems)
            + "; human in "
            + ", ".join(human_stems)
        )

    def _mostly_ai_explanation(self, ai_stems: List[str]) -> str:
        if set(ai_stems) == set(self._CANONICAL_STEMS):
            return "Pure AI production"
        return "Most stems show confirmed AI signal: " + ", ".join(ai_stems)
