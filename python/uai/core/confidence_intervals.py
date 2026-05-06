"""Bootstrap confidence intervals for detector score series."""

from __future__ import annotations

from typing import Dict, Iterable, List

import numpy as np


class BootstrapCIComputer:
    """Compute percentile bootstrap CIs over per-segment score means."""

    def __init__(
        self,
        n_bootstrap: int = 500,
        segment_sec: float = 8.0,
        rng_seed: int = 42,
    ) -> None:
        if int(n_bootstrap) < 1:
            raise ValueError("n_bootstrap must be >= 1")
        if float(segment_sec) <= 0.0:
            raise ValueError("segment_sec must be > 0")
        self.n_bootstrap = int(n_bootstrap)
        self.segment_sec = float(segment_sec)
        self.rng_seed = int(rng_seed)

    def compute(self, track_scores: Dict[str, Iterable[float]]) -> dict:
        """Return 95% bootstrap CIs for each score series in ``track_scores``.

        Input keys are preserved in the output names. For example, the key
        ``score`` produces ``score_ci_low_95`` and ``score_ci_high_95``; the
        key ``d_lofcz`` produces ``d_lofcz_ci_low_95`` and
        ``d_lofcz_ci_high_95``.
        """
        rng = np.random.default_rng(self.rng_seed)
        intervals = {}
        for key, raw_values in track_scores.items():
            values = self._clean_scores(raw_values)
            if values.size == 0:
                continue
            if values.size == 1 or np.allclose(values, values[0]):
                low = high = float(values[0])
            else:
                sample_indices = rng.integers(
                    0,
                    values.size,
                    size=(self.n_bootstrap, values.size),
                )
                means = values[sample_indices].mean(axis=1)
                low, high = np.percentile(means, [2.5, 97.5])
            intervals[f"{key}_ci_low_95"] = float(np.clip(low, 0.0, 1.0))
            intervals[f"{key}_ci_high_95"] = float(np.clip(high, 0.0, 1.0))
        return intervals

    @staticmethod
    def _clean_scores(raw_values: Iterable[float]) -> np.ndarray:
        cleaned: List[float] = []
        for value in raw_values:
            try:
                numeric = float(value)
            except (TypeError, ValueError):
                continue
            if np.isfinite(numeric):
                cleaned.append(numeric)
        if not cleaned:
            return np.asarray([], dtype=np.float64)
        return np.clip(np.asarray(cleaned, dtype=np.float64), 0.0, 1.0)
