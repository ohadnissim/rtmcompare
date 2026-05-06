"""Post-aggregator score calibration helpers."""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Mapping, Optional

import numpy as np


logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CLASSICAL_MODEL_PATH = ROOT / "models" / "classical_calibration.json"

CLASSICAL_GATE_THRESHOLD = 0.60
CLASSICAL_MAX_DOWNWARD_DELTA = 0.15


def _normalise_genre_probs(
    genre_probs: Optional[Mapping[str, float]],
) -> dict[str, float]:
    if not genre_probs:
        return {}
    normalised: dict[str, float] = {}
    for key, value in genre_probs.items():
        try:
            normalised[str(key).strip().lower()] = float(value)
        except (TypeError, ValueError):
            continue
    return normalised


def classical_probability(
    genre_probs: Optional[Mapping[str, float]],
) -> float:
    """Return the supplied Classical probability, case-insensitively."""
    probs = _normalise_genre_probs(genre_probs)
    return float(
        max(
            probs.get("classical", 0.0),
            probs.get("genre:classical", 0.0),
        )
    )


@lru_cache(maxsize=4)
def load_classical_calibration(
    model_path: str | Path = DEFAULT_CLASSICAL_MODEL_PATH,
) -> Optional[dict]:
    """Load the persisted Classical calibration model.

    The model is intentionally JSON rather than pickle so audits can inspect
    the exact gate, cap, and isotonic knots without executing arbitrary code.
    Missing or malformed models fail open to preserve production behaviour.
    """
    path = Path(model_path)
    if not path.exists():
        return None
    try:
        model = json.loads(path.read_text())
        knots_x = [float(x) for x in model["knots_x"]]
        knots_y = [float(y) for y in model["knots_y"]]
        if len(knots_x) != len(knots_y) or len(knots_x) < 2:
            raise ValueError("knots_x/knots_y must have equal length >= 2")
        if any(b < a for a, b in zip(knots_x, knots_x[1:])):
            raise ValueError("knots_x must be sorted")
        if any(b < a for a, b in zip(knots_y, knots_y[1:])):
            raise ValueError("knots_y must be monotone non-decreasing")
        model["knots_x"] = knots_x
        model["knots_y"] = knots_y
        return model
    except Exception as exc:
        logger.warning("Classical calibration load failed for %s: %s", path, exc)
        return None


def apply_classical_calibration(
    score: float,
    genre_probs: Optional[Mapping[str, float]],
    *,
    model: Optional[Mapping[str, object]] = None,
) -> float:
    """Apply the Classical isotonic score calibration when the genre gate fires.

    The hook is deliberately post-aggregator: it never changes detector weights
    or lofcz aggregation. It only maps the already-fused score through the
    persisted isotonic curve when ``genre_probs["classical"]`` exceeds the gate.
    Downward movement is capped at 0.15 score units to preserve detection on
    high-scoring Classical-styled AI tracks.
    """
    raw = float(np.clip(score, 0.0, 1.0))
    active_model = dict(model) if model is not None else load_classical_calibration()
    if not active_model:
        return raw

    gate = float(active_model.get("gate_threshold", CLASSICAL_GATE_THRESHOLD))
    if classical_probability(genre_probs) <= gate:
        return raw

    max_delta = float(
        active_model.get("max_downward_delta", CLASSICAL_MAX_DOWNWARD_DELTA)
    )
    if max_delta < 0:
        max_delta = CLASSICAL_MAX_DOWNWARD_DELTA

    try:
        knots_x = np.asarray(active_model["knots_x"], dtype=np.float64)
        knots_y = np.asarray(active_model["knots_y"], dtype=np.float64)
    except Exception:
        return raw

    mapped = float(np.interp(raw, knots_x, knots_y))
    target = min(raw, mapped)
    capped = max(target, raw - max_delta)
    return float(np.clip(capped, 0.0, 1.0))


def clear_classical_calibration_cache() -> None:
    """Clear the model cache for tests or after regenerating the JSON model."""
    load_classical_calibration.cache_clear()
