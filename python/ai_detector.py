"""AI-vs-human music detector — UAI 24-detector calibrated ensemble.

5.3.x: replaces the heuristic v1 detector (calibrated on 13 samples,
`deployment_ready: false`) with UAI's vendored ensemble (Lambda-validated
F1 0.998, Lyria-3 OOD recall 0.978, Jamendo human FPR 0.85%, calibration
head trained on a much larger labelled corpus).

Public API kept stable for RTM's analyze.py + UI:

    detect_ai(file_path, sr=44100, stems_dir=None) -> dict

Returned dict matches RTM's `AIDetection` schema (src/types.ts):

    {
      probability: float,                # 0..1, calibrated
      verdict: 'likely_human' | 'uncertain' | 'likely_ai',
      summary: str,
      checks: list[{ name, score, weight, detail, reliability }],
      stem_verdicts: list[{ stem, verdict, score, detail }],
    }

Plus a few new fields the UI can progressively adopt without breaking:
    track_verdict_4way  — 'human' / 'ai' / 'hybrid' / 'unknown'
    instrumental_aggregate — calibrated risk over drums+bass+other
    full_mix_score      — calibrated risk on the un-separated mix
    method              — 'uai_v1.4' (so the UI can show provenance)

Fallback to the pre-5.3 heuristic (`ai_detector_v1.py`) on any UAI
failure — silent degrade rather than dropping the panel entirely.
"""
from __future__ import annotations

import os
import pathlib
import sys
from typing import Optional

# ── Configure UAI's vendored runtime root ─────────────────────────────
# Same shim as separator.py; both imports converge on the env var.
_RTM_PYTHON_DIR = pathlib.Path(__file__).resolve().parent
_RTM_ROOT = _RTM_PYTHON_DIR.parent
os.environ.setdefault(
    "RTM_UAI_APPLICATION_ROOT",
    str(_RTM_ROOT / "model-cache" / "uai_root"),
)
if str(_RTM_PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(_RTM_PYTHON_DIR))


# ── Verdict ladder ────────────────────────────────────────────────────
# UAI emits scores 0..1. The thresholds here mirror the v1 panel
# (hidden by default until 0.55) and UAI's `_score_to_verdict` helper.
def _score_to_verdict(score: float) -> str:
    if score is None:
        return "uncertain"
    if score >= 0.65:
        return "likely_ai"
    if score >= 0.45:
        return "uncertain"
    return "likely_human"


def detect_ai(file_path: str, sr: int = 44100,
              stems_dir: Optional[str] = None) -> dict:
    """Score a track via UAI's PerStemScorer; map to RTM's AIDetection
    shape. `stems_dir` is accepted for API parity but ignored — UAI's
    BS-RoFormer separation is part of the scorer."""
    try:
        return _detect_uai(file_path, sr=sr)
    except Exception as err:  # noqa: BLE001
        sys.stderr.write(
            f"[ai_detector] UAI ensemble failed; falling back to v1 heuristic ({err})\n"
        )
        try:
            from ai_detector_v1 import detect_ai as _v1  # type: ignore
            result = _v1(file_path, sr=sr, stems_dir=stems_dir)
            # Mark provenance so the UI can show "heuristic" badge.
            if isinstance(result, dict):
                result.setdefault("method", "rtm_v1_heuristic")
            return result
        except Exception as err2:  # noqa: BLE001
            sys.stderr.write(f"[ai_detector] v1 also failed: {err2}\n")
            return {
                "probability": 0.0,
                "verdict": "uncertain",
                "summary": "AI detection unavailable on this run.",
                "checks": [],
                "stem_verdicts": [],
                "method": "unavailable",
                "error": str(err2),
            }


def _detect_uai(file_path: str, sr: int = 44100) -> dict:
    """Drive UAI's PerStemScorer end-to-end and map its result to the
    RTM `AIDetection` schema."""
    from uai.core.engine import EnsembleDetector  # type: ignore
    from uai.core.per_stem_scorer import (  # type: ignore
        CANONICAL_STEMS,
        PerStemScorer,
    )

    engine = EnsembleDetector()
    scorer = PerStemScorer(engine=engine, stem_backend="bs_roformer_4stem")
    result = scorer.analyze(file_path)

    # ── Map per-stem block ────────────────────────────────────────────
    stem_verdicts = []
    for stem in CANONICAL_STEMS:
        score = result.stem_scores.get(stem)
        if score is None:
            continue
        verdict = result.stem_verdicts.get(stem) or _score_to_verdict(score)
        # Build a compact human-readable detail. UAI's stem_notes is a
        # list[str]; keep the first as the primary reason.
        notes = result.stem_notes.get(stem, []) or []
        detail = notes[0] if notes else f"{stem} risk index {score:.2f}"
        stem_verdicts.append({
            "stem": stem,
            "verdict": verdict if verdict in ("likely_human", "uncertain", "likely_ai")
                       else _score_to_verdict(score),
            "score": float(score),
            "detail": detail,
        })

    # ── Map mix-level checks (the legacy `checks` array RTM's UI shows
    #    when no stems are available). Use UAI's full_mix_detector_scores
    #    as the source of truth — every key/value pair becomes a check
    #    row. UAI doesn't ship per-detector "weight" so we emit equal
    #    weights and let the UI bar-chart on score alone.
    checks = []
    for name, score in (result.full_mix_detector_scores or {}).items():
        try:
            score_f = float(score)
        except (TypeError, ValueError):
            continue
        checks.append({
            "name": name,
            "score": max(0.0, min(1.0, score_f)),
            "weight": 1.0,
            "detail": "",
            "reliability": 1.0,
        })

    # ── Top-level verdict + probability ───────────────────────────────
    # UAI's track_verdict is a 4-way string ('AI Generated' / 'Human' /
    # 'Hybrid' / 'Unknown') that doesn't fit RTM's 3-state
    # `likely_human/uncertain/likely_ai` enum. Collapse it: AI/Hybrid →
    # likely_ai, Human → likely_human, Unknown → uncertain. Surface the
    # original 4-way string in `track_verdict_4way` so the UI can
    # progressively switch to it.
    raw_verdict = (result.track_verdict or "").lower()
    if "ai" in raw_verdict and "generated" in raw_verdict:
        top_verdict = "likely_ai"
    elif "hybrid" in raw_verdict:
        top_verdict = "likely_ai"  # hybrid still means "AI is in this mix"
    elif "human" in raw_verdict:
        top_verdict = "likely_human"
    else:
        top_verdict = "uncertain"

    # Probability = the most informative scalar UAI emits.
    # Order of preference: instrumental_aggregate (calibrated, the
    # patent-claim metric) → max_stem_score → full_mix_score.
    probability = (
        result.instrumental_aggregate
        if result.instrumental_aggregate is not None
        else (result.max_stem_score
              if result.max_stem_score is not None
              else (result.full_mix_score if result.full_mix_score is not None
                    else 0.0))
    )
    probability = max(0.0, min(1.0, float(probability)))

    # Human-readable summary. Keep it short; the panel renders this as
    # a one-liner under the verdict pill.
    if top_verdict == "likely_ai":
        summary = (
            f"High AI risk — {result.max_stem_name or 'mix'} stem at "
            f"{(result.max_stem_score or 0.0):.2f}. Calibrated ensemble "
            f"(F1 0.998 on Lambda validation). Verify manually before any decision."
        )
    elif top_verdict == "likely_human":
        summary = (
            "Low AI risk across all stems. Calibrated ensemble verdict; "
            "still a heuristic — confirm on borderline material."
        )
    else:
        summary = (
            "Inconclusive — stem scores are mixed or below the calibration "
            "confidence band. Treat as uncalibrated and review manually."
        )

    return {
        # Core RTM AIDetection schema (src/types.ts):
        "probability": probability,
        "verdict": top_verdict,
        "summary": summary,
        "checks": checks,
        "stem_verdicts": stem_verdicts,
        # ── Bonus fields (UI can progressively adopt) ────────────────
        "track_verdict_4way": result.track_verdict,
        "full_mix_verdict": result.full_mix_verdict,
        "full_mix_score": result.full_mix_score,
        "instrumental_aggregate": result.instrumental_aggregate,
        "max_stem_name": result.max_stem_name,
        "max_stem_score": result.max_stem_score,
        "stem_4way_classes": result.stem_4way_classes,
        "stem_4way_probabilities": result.stem_4way_probabilities,
        "method": "uai_v1.4",
        "calibration": "deployed",  # vs v1's "deployment_ready: false"
    }
