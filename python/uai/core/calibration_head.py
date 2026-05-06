"""Learned post-ensemble calibration head.

The calibration head is intentionally tabular: it consumes the exposed detector
scores, a few aggregate detector statistics, optional genre one-hots, and cached
audio summary features, then emits a calibrated probability that the track is AI
generated. XGBoost is imported lazily so existing engine imports still fail open
when the optional model/package is absent.
"""

from __future__ import annotations

import hashlib
import importlib
import json
import logging
import os
import platform
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, Optional

import numpy as np


logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
BASELINE_MODEL_PATH = ROOT / "models" / "calibration_head_v1.json"
DEFAULT_MODEL_PATH = ROOT / "models" / "calibration_head_v1_3.json"
V1_4_4WAY_MODEL_PATH = ROOT / "models" / "calibration_head_v1_4_4way.json"
V1_4_STEM_MODEL_TEMPLATE = "stem_calibration_v1_4_{stem}.json"
DEFAULT_AUDIO_CACHE_DIR = ROOT / "data" / ".cache" / "calibration_head_audio"
_LIBROSA_RECOVERABLE_EXCEPTIONS = (ImportError, RuntimeError, OSError)
_LIBROSA_NUMBA_WARNING_EMITTED = False

DETECTOR_NAMES: tuple[str, ...] = (
    "lofcz",
    "temporal_lofcz",
    "fourier",
    "fakeprint",
    "spectral",
    "codec_residual",
    "phase",
    "highfreq",
    "onset",
    "cnn",
    "ast",
    "aimd",
    "temporal",
    "segment",
    "longcontext",
    "spectttra",
)

DETECTOR_FEATURE_NAMES: tuple[str, ...] = tuple(f"d_{name}" for name in DETECTOR_NAMES)

DERIVED_FEATURE_NAMES: tuple[str, ...] = (
    "detector_mean",
    "detector_max",
    "detector_std",
    "detector_n_above_0_7",
    "detector_n_below_0_2",
    "raw_ensemble_score",
)

AUDIO_FEATURE_NAMES: tuple[str, ...] = (
    "audio_available",
    "audio_tempo",
    "audio_key",
    "audio_spectral_centroid_mean",
    "audio_spectral_rolloff_mean",
    "audio_rms_mean",
    "audio_duration",
    "audio_zcr_mean",
    "audio_harmonic_percussive_ratio",
)

BASE_FEATURE_NAMES: tuple[str, ...] = (
    DETECTOR_FEATURE_NAMES + DERIVED_FEATURE_NAMES + AUDIO_FEATURE_NAMES
)

STEM_TYPES: tuple[str, ...] = ("full", "vocals", "drums", "bass", "other")
STEM_FEATURE_NAMES: tuple[str, ...] = tuple(f"stem__{name}" for name in STEM_TYPES)
STEM_AWARE_FEATURE_NAMES: tuple[str, ...] = BASE_FEATURE_NAMES + STEM_FEATURE_NAMES

METADATA_ATTR = "calibration_head_metadata"
FOUR_WAY_METADATA_ATTR = "v1_4_4way_calibration_metadata"


def _require_xgboost():
    if platform.system() == "Darwin":
        # Avoid libomp/Torch OpenMP runtime crashes on macOS ARM when core
        # detectors have already imported torch before XGBoost is loaded.
        os.environ.setdefault("OMP_NUM_THREADS", "1")
    try:
        return importlib.import_module("xgboost")
    except Exception as exc:  # noqa: BLE001 - optional dependency boundary
        raise RuntimeError(
            "xgboost is required for CalibrationHead. Install requirements.txt "
            "or run `pip install xgboost` in this environment."
        ) from exc


def _as_float(value: Any, default: float = np.nan) -> float:
    try:
        if value is None:
            return default
        if isinstance(value, str) and not value.strip():
            return default
        out = float(value)
    except (TypeError, ValueError):
        return default
    return out if np.isfinite(out) else default


def _clip_probability(value: Any, default: float = np.nan) -> float:
    out = _as_float(value, default=default)
    if not np.isfinite(out):
        return out
    return float(np.clip(out, 0.0, 1.0))


def _slug(value: Any) -> str:
    text = str(value or "").strip().lower()
    keep = [ch if ch.isalnum() else "_" for ch in text]
    slug = "_".join(part for part in "".join(keep).split("_") if part)
    return slug


def empty_audio_features() -> dict[str, float]:
    """Return the audio feature shape with missing values."""
    return {
        "audio_available": 0.0,
        "audio_tempo": np.nan,
        "audio_key": np.nan,
        "audio_spectral_centroid_mean": np.nan,
        "audio_spectral_rolloff_mean": np.nan,
        "audio_rms_mean": np.nan,
        "audio_duration": np.nan,
        "audio_zcr_mean": np.nan,
        "audio_harmonic_percussive_ratio": np.nan,
    }


def _cache_key(
    audio_path: str | Path,
    *,
    sr: int,
    max_audio_seconds: float,
) -> str:
    path = Path(audio_path)
    try:
        stat = path.stat()
        payload = (
            f"{path.resolve()}|{stat.st_size}|{stat.st_mtime_ns}|"
            f"sr={int(sr)}|max={float(max_audio_seconds):.3f}"
        )
    except OSError:
        payload = f"{path}|sr={int(sr)}|max={float(max_audio_seconds):.3f}"
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def _json_ready(features: Mapping[str, float]) -> dict[str, Optional[float]]:
    out: dict[str, Optional[float]] = {}
    for key, value in features.items():
        val = _as_float(value)
        out[key] = float(val) if np.isfinite(val) else None
    return out


def _from_json_cache(payload: Mapping[str, Any]) -> dict[str, float]:
    features = empty_audio_features()
    for key in AUDIO_FEATURE_NAMES:
        value = payload.get(key)
        features[key] = np.nan if value is None else _as_float(value)
    return features


def _normalise_audio_features(payload: Mapping[str, Any]) -> dict[str, float]:
    features = empty_audio_features()
    for key in AUDIO_FEATURE_NAMES:
        if key in payload:
            features[key] = _as_float(payload.get(key), default=features[key])
    return features


def _is_numba_failure(exc: BaseException) -> bool:
    text = " ".join(
        (
            type(exc).__module__,
            type(exc).__name__,
            str(exc),
            str(getattr(exc, "__cause__", "")),
            str(getattr(exc, "__context__", "")),
        )
    ).lower()
    return "numba" in text or "llvmlite" in text or "jit" in text


def _warn_librosa_fallback_once(call_name: str, exc: BaseException) -> None:
    global _LIBROSA_NUMBA_WARNING_EMITTED
    if _is_numba_failure(exc):
        if not _LIBROSA_NUMBA_WARNING_EMITTED:
            logger.warning(
                "Calibration audio feature extraction: librosa %s failed in a "
                "Numba/JIT path (%s: %s); using fallback or missing-value "
                "sentinels for affected audio features.",
                call_name,
                type(exc).__name__,
                exc,
            )
            _LIBROSA_NUMBA_WARNING_EMITTED = True
        else:
            logger.debug("librosa %s Numba/JIT fallback: %s", call_name, exc)
    else:
        logger.debug("librosa %s failed; using fallback: %s", call_name, exc)


def _fallback_value(value: Any) -> Any:
    return value() if callable(value) else value


def _safe_librosa_call(
    call_name: str,
    func: Any,
    fallback: Any,
    *args: Any,
    **kwargs: Any,
) -> Any:
    try:
        return func(*args, **kwargs)
    except _LIBROSA_RECOVERABLE_EXCEPTIONS as exc:
        _warn_librosa_fallback_once(call_name, exc)
        return _fallback_value(fallback)
    except Exception as exc:  # noqa: BLE001 - per-feature fail-open boundary
        logger.debug("librosa %s failed; using fallback: %s", call_name, exc)
        return _fallback_value(fallback)


def _nanmean_scalar(values: Any) -> float:
    arr = np.asarray(values, dtype=np.float64)
    if arr.size == 0:
        return np.nan
    with np.errstate(invalid="ignore"):
        value = float(np.nanmean(arr))
    return value if np.isfinite(value) else np.nan


def _fallback_tempo(y: np.ndarray, sr: int | float, *, hop_length: int = 512) -> float:
    audio = np.asarray(y, dtype=np.float32).reshape(-1)
    if audio.size < hop_length * 8 or sr <= 0:
        return np.nan
    n_frames = audio.size // hop_length
    if n_frames < 8:
        return np.nan
    env = np.mean(np.abs(audio[: n_frames * hop_length].reshape(n_frames, hop_length)), axis=1)
    onset = np.diff(env, prepend=env[0])
    onset = np.maximum(onset - np.median(onset), 0.0)
    if not np.any(onset > 0.0):
        return np.nan
    onset = onset - float(np.mean(onset))
    corr = np.correlate(onset, onset, mode="full")[onset.size - 1 :]
    frame_rate = float(sr) / float(hop_length)
    min_lag = max(1, int(round(frame_rate * 60.0 / 220.0)))
    max_lag = min(corr.size - 1, int(round(frame_rate * 60.0 / 40.0)))
    if max_lag <= min_lag:
        return np.nan
    lag = int(np.argmax(corr[min_lag:max_lag + 1]) + min_lag)
    return float(np.clip(60.0 * frame_rate / max(lag, 1), 40.0, 220.0))


def _fallback_key(y: np.ndarray, sr: int | float) -> float:
    audio = np.asarray(y, dtype=np.float32).reshape(-1)
    if audio.size < 2048 or sr <= 0:
        return np.nan
    max_samples = int(min(audio.size, max(2048, float(sr) * 30.0)))
    segment = audio[:max_samples]
    if not np.any(np.isfinite(segment)) or float(np.sqrt(np.mean(np.square(segment)))) < 1e-7:
        return np.nan
    n_fft = 1 << int(np.ceil(np.log2(max(2048, segment.size))))
    n_fft = min(n_fft, 262_144)
    segment = segment[:n_fft]
    if segment.size < n_fft:
        segment = np.pad(segment, (0, n_fft - segment.size))
    window = np.hanning(segment.size)
    spectrum = np.abs(np.fft.rfft(segment * window))
    freqs = np.fft.rfftfreq(segment.size, d=1.0 / float(sr))
    mask = (freqs >= 40.0) & (freqs <= 5000.0) & (spectrum > 0.0)
    if not np.any(mask):
        return np.nan
    midi = 69.0 + 12.0 * np.log2(freqs[mask] / 440.0)
    pitch_classes = np.mod(np.rint(midi).astype(np.int64), 12)
    weights = np.bincount(pitch_classes, weights=spectrum[mask], minlength=12)
    return float(np.nanargmax(weights)) if np.any(weights > 0.0) else np.nan


def _sampled_frames(
    y: np.ndarray,
    *,
    frame_length: int = 2048,
    hop_length: int = 1024,
    max_frames: int = 512,
) -> np.ndarray:
    audio = np.asarray(y, dtype=np.float32).reshape(-1)
    if audio.size < frame_length:
        return np.empty((0, frame_length), dtype=np.float32)
    starts = np.arange(0, audio.size - frame_length + 1, hop_length, dtype=np.int64)
    if starts.size > max_frames:
        starts = starts[np.linspace(0, starts.size - 1, max_frames).astype(np.int64)]
    return np.stack([audio[start : start + frame_length] for start in starts])


def _fallback_spectral_centroid_mean(y: np.ndarray, sr: int | float) -> float:
    frames = _sampled_frames(y)
    if frames.size == 0 or sr <= 0:
        return np.nan
    window = np.hanning(frames.shape[1]).astype(np.float32)
    spectrum = np.abs(np.fft.rfft(frames * window, axis=1))
    freqs = np.fft.rfftfreq(frames.shape[1], d=1.0 / float(sr))
    denom = np.sum(spectrum, axis=1)
    valid = denom > 1e-12
    if not np.any(valid):
        return np.nan
    centroid = np.sum(spectrum[valid] * freqs, axis=1) / denom[valid]
    return _nanmean_scalar(centroid)


def _fallback_spectral_rolloff_mean(y: np.ndarray, sr: int | float, *, roll_percent: float = 0.85) -> float:
    frames = _sampled_frames(y)
    if frames.size == 0 or sr <= 0:
        return np.nan
    window = np.hanning(frames.shape[1]).astype(np.float32)
    spectrum = np.abs(np.fft.rfft(frames * window, axis=1))
    freqs = np.fft.rfftfreq(frames.shape[1], d=1.0 / float(sr))
    totals = np.sum(spectrum, axis=1)
    rolloffs: list[float] = []
    for row, total in zip(spectrum, totals):
        if total <= 1e-12:
            continue
        idx = int(np.searchsorted(np.cumsum(row), total * roll_percent, side="left"))
        rolloffs.append(float(freqs[min(idx, freqs.size - 1)]))
    return _nanmean_scalar(rolloffs)


def _fallback_rms_mean(y: np.ndarray) -> float:
    audio = np.asarray(y, dtype=np.float32).reshape(-1)
    if audio.size == 0:
        return np.nan
    return float(np.sqrt(np.mean(np.square(audio))))


def _fallback_zcr_mean(y: np.ndarray) -> float:
    audio = np.asarray(y, dtype=np.float32).reshape(-1)
    if audio.size < 2:
        return np.nan
    return float(np.mean(np.signbit(audio[1:]) != np.signbit(audio[:-1])))


def _tempo_value(value: Any) -> float:
    if isinstance(value, tuple):
        value = value[0]
    tempo_arr = np.asarray(value, dtype=np.float64).reshape(-1)
    tempo_val = float(tempo_arr[0]) if tempo_arr.size else np.nan
    return tempo_val if np.isfinite(tempo_val) else np.nan


def _key_from_chroma(value: Any, y: np.ndarray, sr: int | float) -> float:
    chroma = np.asarray(value, dtype=np.float64)
    if chroma.size:
        chroma_mean = np.nanmean(chroma, axis=1)
        if chroma_mean.size and np.any(np.isfinite(chroma_mean)):
            return float(np.nanargmax(chroma_mean))
    return _fallback_key(y, sr)


def _hp_ratio_from_hpss(value: Any) -> float:
    if not isinstance(value, tuple) or len(value) != 2:
        return np.nan
    harmonic, percussive = value
    harmonic = np.asarray(harmonic, dtype=np.float32)
    percussive = np.asarray(percussive, dtype=np.float32)
    if harmonic.size == 0 or percussive.size == 0:
        return np.nan
    harmonic_rms = float(np.sqrt(np.mean(np.square(harmonic))))
    percussive_rms = float(np.sqrt(np.mean(np.square(percussive))))
    return float(harmonic_rms / max(percussive_rms, 1e-9))


def extract_audio_features(
    audio_path: str | Path | None,
    *,
    cache_dir: str | Path = DEFAULT_AUDIO_CACHE_DIR,
    sr: int = 22050,
    max_audio_seconds: float = 180.0,
) -> dict[str, float]:
    """Extract and cache lightweight librosa features for one track.

    Missing files fail open to NaNs. XGBoost handles those missing values, which
    lets validation CSVs remain usable even when their original corpus paths are
    not mounted on the current machine.
    """
    if not audio_path:
        return empty_audio_features()

    path = Path(audio_path)
    if not path.exists():
        return empty_audio_features()

    cache_root = Path(cache_dir)
    cache_file = cache_root / f"{_cache_key(path, sr=sr, max_audio_seconds=max_audio_seconds)}.json"
    if cache_file.exists():
        try:
            return _from_json_cache(json.loads(cache_file.read_text()))
        except Exception as exc:  # noqa: BLE001
            logger.debug("Calibration audio cache read failed for %s: %s", path, exc)

    features = empty_audio_features()
    try:
        import librosa  # noqa: WPS433 - optional runtime dependency
    except ImportError as exc:
        logger.debug("librosa unavailable for calibration audio features: %s", exc)
        return features

    try:
        duration = _safe_librosa_call(
            "get_duration",
            librosa.get_duration,
            np.nan,
            path=str(path),
        )
        loaded = _safe_librosa_call(
            "load",
            librosa.load,
            (np.asarray([], dtype=np.float32), sr),
            str(path),
            sr=sr,
            mono=True,
            duration=max_audio_seconds,
        )
        y, loaded_sr = loaded
        y = np.asarray(y, dtype=np.float32).reshape(-1)
        loaded_sr = int(loaded_sr or sr)
        if y.size == 0:
            return features

        duration_val = _as_float(duration)
        if not np.isfinite(duration_val):
            duration_val = float(y.size / max(1, loaded_sr))

        tempo = _safe_librosa_call(
            "beat.beat_track",
            librosa.beat.beat_track,
            lambda: (_fallback_tempo(y, loaded_sr), np.asarray([], dtype=np.int64)),
            y=y,
            sr=loaded_sr,
        )
        chroma = _safe_librosa_call(
            "feature.chroma_stft",
            librosa.feature.chroma_stft,
            lambda: np.asarray([], dtype=np.float32),
            y=y,
            sr=loaded_sr,
        )
        centroid = _safe_librosa_call(
            "feature.spectral_centroid",
            librosa.feature.spectral_centroid,
            lambda: np.asarray([[_fallback_spectral_centroid_mean(y, loaded_sr)]], dtype=np.float32),
            y=y,
            sr=loaded_sr,
        )
        rolloff = _safe_librosa_call(
            "feature.spectral_rolloff",
            librosa.feature.spectral_rolloff,
            lambda: np.asarray([[_fallback_spectral_rolloff_mean(y, loaded_sr)]], dtype=np.float32),
            y=y,
            sr=loaded_sr,
        )
        rms = _safe_librosa_call(
            "feature.rms",
            librosa.feature.rms,
            lambda: np.asarray([[_fallback_rms_mean(y)]], dtype=np.float32),
            y=y,
        )
        zcr = _safe_librosa_call(
            "feature.zero_crossing_rate",
            librosa.feature.zero_crossing_rate,
            lambda: np.asarray([[_fallback_zcr_mean(y)]], dtype=np.float32),
            y=y,
        )
        hpss = _safe_librosa_call(
            "effects.hpss",
            librosa.effects.hpss,
            None,
            y,
        )

        features = {
            "audio_available": 1.0,
            "audio_tempo": _tempo_value(tempo),
            "audio_key": _key_from_chroma(chroma, y, loaded_sr),
            "audio_spectral_centroid_mean": _nanmean_scalar(centroid),
            "audio_spectral_rolloff_mean": _nanmean_scalar(rolloff),
            "audio_rms_mean": _nanmean_scalar(rms),
            "audio_duration": duration_val,
            "audio_zcr_mean": _nanmean_scalar(zcr),
            "audio_harmonic_percussive_ratio": _hp_ratio_from_hpss(hpss),
        }
        cache_root.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(_json_ready(features), sort_keys=True))
    except Exception as exc:  # noqa: BLE001
        logger.debug("Calibration audio feature extraction failed for %s: %s", path, exc)
    return features


def precompute_audio_features(
    audio_paths: Sequence[str | Path | None],
    *,
    cache_dir: str | Path = DEFAULT_AUDIO_CACHE_DIR,
    sr: int = 22050,
    max_audio_seconds: float = 180.0,
) -> dict[str, dict[str, float]]:
    """Extract calibration audio features once for known upcoming paths."""
    out: dict[str, dict[str, float]] = {}
    for audio_path in audio_paths:
        if not audio_path:
            continue
        key = str(audio_path)
        if key in out:
            continue
        out[key] = extract_audio_features(
            audio_path,
            cache_dir=cache_dir,
            sr=sr,
            max_audio_seconds=max_audio_seconds,
        )
    return out


def build_calibration_feature_dict(
    detector_scores: Mapping[str, Any],
    *,
    raw_score: Any = None,
    audio_path: str | Path | None = None,
    genre: Any = None,
    genre_probs: Optional[Mapping[str, float]] = None,
    feature_names: Optional[Sequence[str]] = None,
    genre_values: Optional[Sequence[str]] = None,
    cache_dir: str | Path = DEFAULT_AUDIO_CACHE_DIR,
    audio_features: Optional[Mapping[str, Any]] = None,
    max_audio_seconds: float = 180.0,
) -> dict[str, float]:
    """Build the calibration feature dictionary for one track."""
    features: dict[str, float] = {}
    detector_values: list[float] = []

    for name in DETECTOR_NAMES:
        value = _clip_probability(
            detector_scores.get(name, detector_scores.get(f"d_{name}", np.nan))
        )
        features[f"d_{name}"] = value
        if np.isfinite(value):
            detector_values.append(value)

    finite = np.asarray(detector_values, dtype=np.float64)
    if finite.size:
        features["detector_mean"] = float(np.mean(finite))
        features["detector_max"] = float(np.max(finite))
        features["detector_std"] = float(np.std(finite))
        features["detector_n_above_0_7"] = float(np.sum(finite > 0.7))
        features["detector_n_below_0_2"] = float(np.sum(finite < 0.2))
    else:
        for name in DERIVED_FEATURE_NAMES[:-1]:
            features[name] = np.nan
    features["raw_ensemble_score"] = _clip_probability(raw_score)

    if audio_features is not None:
        features.update(_normalise_audio_features(audio_features))
    else:
        features.update(
            extract_audio_features(
                audio_path,
                cache_dir=cache_dir,
                max_audio_seconds=max_audio_seconds,
            )
        )

    genre_slugs = {_slug(genre)} if genre else set()
    if genre_probs:
        genre_slugs.update(_slug(key) for key in genre_probs)

    target_genres: set[str] = set()
    if genre_values:
        target_genres.update(_slug(value) for value in genre_values)
    if feature_names:
        target_genres.update(
            name.removeprefix("genre__")
            for name in feature_names
            if name.startswith("genre__")
        )

    normalised_probs = {
        _slug(key): _clip_probability(value, default=0.0)
        for key, value in (genre_probs or {}).items()
    }
    for genre_slug in sorted(g for g in target_genres if g):
        feature_name = f"genre__{genre_slug}"
        value = 1.0 if genre_slug in genre_slugs else 0.0
        value = max(value, normalised_probs.get(genre_slug, 0.0))
        features[feature_name] = float(np.clip(value, 0.0, 1.0))

    return features


def _normalise_stem_type(stem_type: Any) -> str:
    stem = _slug(stem_type) or "full"
    aliases = {
        "instrumental": "other",
        "instrumentals": "other",
        "no_vocals": "other",
    }
    stem = aliases.get(stem, stem)
    return stem if stem in STEM_TYPES else "full"


def add_stem_type_features(
    features: Mapping[str, Any],
    stem_type: Any,
) -> dict[str, float]:
    """Return ``features`` plus the v1.4 stem-type one-hot columns."""
    out = {str(key): _as_float(value) for key, value in features.items()}
    normalized = _normalise_stem_type(stem_type)
    for stem in STEM_TYPES:
        out[f"stem__{stem}"] = 1.0 if stem == normalized else 0.0
    return out


def build_stem_aware_feature_dict(
    detector_scores: Mapping[str, Any],
    *,
    stem_type: Any = "full",
    raw_score: Any = None,
    audio_path: str | Path | None = None,
    genre: Any = None,
    genre_probs: Optional[Mapping[str, float]] = None,
    feature_names: Optional[Sequence[str]] = None,
    genre_values: Optional[Sequence[str]] = None,
    cache_dir: str | Path = DEFAULT_AUDIO_CACHE_DIR,
    audio_features: Optional[Mapping[str, Any]] = None,
    max_audio_seconds: float = 180.0,
) -> dict[str, float]:
    """Build a calibration feature row with v1.4 stem-type one-hots."""
    features = build_calibration_feature_dict(
        detector_scores,
        raw_score=raw_score,
        audio_path=audio_path,
        genre=genre,
        genre_probs=genre_probs,
        feature_names=feature_names,
        genre_values=genre_values,
        cache_dir=cache_dir,
        audio_features=audio_features,
        max_audio_seconds=max_audio_seconds,
    )
    return add_stem_type_features(features, stem_type)


def feature_dicts_to_matrix(
    rows: Sequence[Mapping[str, Any]],
    feature_names: Sequence[str],
) -> np.ndarray:
    """Convert feature dictionaries to a dense float32 matrix with NaNs."""
    matrix = np.empty((len(rows), len(feature_names)), dtype=np.float32)
    for row_idx, row in enumerate(rows):
        for col_idx, name in enumerate(feature_names):
            matrix[row_idx, col_idx] = _as_float(row.get(name))
    return matrix


def _coerce_rows(
    X: Any,
    feature_names: Optional[Sequence[str]],
) -> tuple[np.ndarray, list[str]]:
    if isinstance(X, np.ndarray):
        matrix = np.asarray(X, dtype=np.float32)
        if matrix.ndim == 1:
            matrix = matrix.reshape(1, -1)
        names = list(feature_names or [f"f{i}" for i in range(matrix.shape[1])])
        if len(names) != matrix.shape[1]:
            raise ValueError("feature_names length must match X columns")
        return matrix, names

    if hasattr(X, "to_numpy") and hasattr(X, "columns"):
        names = list(feature_names or [str(c) for c in X.columns])
        matrix = np.asarray(X[names].to_numpy(), dtype=np.float32)
        return matrix, names

    if isinstance(X, Mapping):
        X = [X]

    if isinstance(X, Sequence) and not isinstance(X, (str, bytes)):
        rows = list(X)
        if rows and all(isinstance(row, Mapping) for row in rows):
            if feature_names is None:
                names = sorted({str(key) for row in rows for key in row})
            else:
                names = [str(name) for name in feature_names]
            return feature_dicts_to_matrix(rows, names), names

    raise TypeError("X must be a numpy array, pandas DataFrame, dict, or list of dicts")


class CalibrationHead:
    """XGBoost calibration model with JSON persistence."""

    def __init__(
        self,
        *,
        feature_names: Optional[Sequence[str]] = None,
        params: Optional[Mapping[str, Any]] = None,
        num_boost_round: int = 700,
        early_stopping_rounds: int = 40,
        random_state: int = 42,
        metadata: Optional[Mapping[str, Any]] = None,
    ) -> None:
        self.feature_names = [str(name) for name in feature_names] if feature_names else []
        self.params = dict(params or {})
        self.num_boost_round = int(num_boost_round)
        self.early_stopping_rounds = int(early_stopping_rounds)
        self.random_state = int(random_state)
        self.metadata = dict(metadata or {})
        self.booster = None

    def fit(
        self,
        X: Any,
        y: Sequence[int] | np.ndarray,
        groups: Optional[Sequence[Any]] = None,
        *,
        eval_set: Optional[tuple[Any, Sequence[int] | np.ndarray]] = None,
        sample_weight: Optional[Sequence[float] | np.ndarray] = None,
        eval_sample_weight: Optional[Sequence[float] | np.ndarray] = None,
    ) -> "CalibrationHead":
        """Fit the calibration head.

        ``groups`` is accepted for the training pipeline's split metadata; the
        model itself is pointwise binary log-loss and does not use group-aware
        objectives.
        """
        xgb = _require_xgboost()
        matrix, names = _coerce_rows(X, self.feature_names or None)
        labels = np.asarray(y, dtype=np.float32)
        if labels.shape[0] != matrix.shape[0]:
            raise ValueError("X and y must have the same number of rows")
        if labels.size and not set(np.unique(labels).tolist()).issubset({0.0, 1.0}):
            raise ValueError("y must contain binary labels 0/1")
        self.feature_names = names

        weights = (
            np.asarray(sample_weight, dtype=np.float32)
            if sample_weight is not None
            else self._balanced_weights(labels)
        )
        train = xgb.DMatrix(
            matrix,
            label=labels,
            weight=weights,
            feature_names=self.feature_names,
            missing=np.nan,
        )

        evals = [(train, "train")]
        if eval_set is not None:
            x_eval, y_eval = eval_set
            eval_matrix, eval_names = _coerce_rows(x_eval, self.feature_names)
            if eval_names != self.feature_names:
                raise ValueError("eval_set feature names must match training features")
            eval_labels = np.asarray(y_eval, dtype=np.float32)
            eval_weights = (
                np.asarray(eval_sample_weight, dtype=np.float32)
                if eval_sample_weight is not None
                else self._balanced_weights(eval_labels)
            )
            valid = xgb.DMatrix(
                eval_matrix,
                label=eval_labels,
                weight=eval_weights,
                feature_names=self.feature_names,
                missing=np.nan,
            )
            evals.append((valid, "validation"))

        params = self._training_params(labels)
        self.booster = xgb.train(
            params,
            train,
            num_boost_round=self.num_boost_round,
            evals=evals,
            early_stopping_rounds=(
                self.early_stopping_rounds if eval_set is not None else None
            ),
            verbose_eval=False,
        )
        self.metadata.update(
            {
                "feature_names": self.feature_names,
                "num_boost_round": self.num_boost_round,
                "early_stopping_rounds": self.early_stopping_rounds,
                "random_state": self.random_state,
                "groups_seen": int(len(set(groups))) if groups is not None else None,
                "xgboost_params": params,
            }
        )
        self._sync_metadata()
        return self

    @staticmethod
    def _balanced_weights(labels: np.ndarray) -> np.ndarray:
        labels = np.asarray(labels, dtype=np.float32)
        weights = np.ones(labels.shape[0], dtype=np.float32)
        if labels.size == 0:
            return weights
        positives = float(np.sum(labels == 1.0))
        negatives = float(np.sum(labels == 0.0))
        total = positives + negatives
        if positives > 0:
            weights[labels == 1.0] = total / (2.0 * positives)
        if negatives > 0:
            weights[labels == 0.0] = total / (2.0 * negatives)
        return weights

    def _training_params(self, labels: np.ndarray) -> dict[str, Any]:
        positives = max(float(np.sum(labels == 1.0)), 1.0)
        negatives = max(float(np.sum(labels == 0.0)), 1.0)
        params = {
            "objective": "binary:logistic",
            "eval_metric": "logloss",
            "tree_method": "hist",
            "eta": 0.035,
            "max_depth": 3,
            "min_child_weight": 8.0,
            "subsample": 0.85,
            "colsample_bytree": 0.85,
            "lambda": 3.0,
            "alpha": 0.2,
            "seed": self.random_state,
            "nthread": 1 if platform.system() == "Darwin" else 0,
            "scale_pos_weight": negatives / positives,
        }
        params.update(self.params)
        return params

    def predict_proba(self, X: Any) -> np.ndarray:
        """Return one calibrated AI probability per row."""
        if self.booster is None:
            raise RuntimeError("CalibrationHead is not fitted or loaded")
        xgb = _require_xgboost()
        matrix, names = _coerce_rows(X, self.feature_names)
        if names != self.feature_names:
            raise ValueError("Prediction feature names do not match fitted model")
        dmatrix = xgb.DMatrix(
            matrix,
            feature_names=self.feature_names,
            missing=np.nan,
        )
        preds = np.asarray(self.booster.predict(dmatrix), dtype=np.float64)
        return np.clip(preds.reshape(-1), 0.0, 1.0)

    def save(self, path: str | Path) -> None:
        """Save the fitted XGBoost booster in JSON format."""
        if self.booster is None:
            raise RuntimeError("Cannot save an unfitted CalibrationHead")
        out_path = Path(path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        self._sync_metadata()
        self.booster.save_model(str(out_path))

    @classmethod
    def load(cls, path: str | Path) -> "CalibrationHead":
        """Load a persisted XGBoost JSON calibration head."""
        xgb = _require_xgboost()
        booster = xgb.Booster()
        booster.load_model(str(path))
        metadata_raw = booster.attr(METADATA_ATTR)
        metadata = json.loads(metadata_raw) if metadata_raw else {}
        feature_names = metadata.get("feature_names") or booster.feature_names or []
        head = cls(
            feature_names=feature_names,
            random_state=int(metadata.get("random_state", 42)),
            metadata=metadata,
        )
        head.booster = booster
        return head

    def feature_importance(self, *, top_k: int = 10) -> list[dict[str, float | str]]:
        """Return top feature importances by gain."""
        if self.booster is None:
            raise RuntimeError("CalibrationHead is not fitted or loaded")
        raw = self.booster.get_score(importance_type="gain")
        rows = [
            {"feature": str(name), "importance": float(value)}
            for name, value in raw.items()
        ]
        seen = {str(row["feature"]) for row in rows}
        for name in self.feature_names:
            if name not in seen:
                rows.append({"feature": str(name), "importance": 0.0})
        rows.sort(key=lambda row: row["importance"], reverse=True)
        return rows[:top_k]

    def _sync_metadata(self) -> None:
        if self.booster is None:
            return
        metadata = dict(self.metadata)
        metadata["feature_names"] = list(self.feature_names)
        metadata["schema_version"] = 1
        self.booster.set_attr(**{METADATA_ATTR: json.dumps(metadata, sort_keys=True)})


class FourWayCalibrationHead:
    """XGBoost multi-class v1.4 calibration head with JSON persistence."""

    def __init__(
        self,
        *,
        feature_names: Optional[Sequence[str]] = None,
        class_names: Optional[Sequence[str]] = None,
        metadata: Optional[Mapping[str, Any]] = None,
    ) -> None:
        self.feature_names = [str(name) for name in feature_names] if feature_names else []
        self.class_names = [str(name) for name in class_names] if class_names else []
        self.metadata = dict(metadata or {})
        self.booster = None

    @classmethod
    def load(cls, path: str | Path) -> "FourWayCalibrationHead":
        """Load a persisted XGBoost multi-class v1.4 calibration head."""
        xgb = _require_xgboost()
        booster = xgb.Booster()
        booster.load_model(str(path))
        metadata_raw = booster.attr(FOUR_WAY_METADATA_ATTR) or booster.attr(METADATA_ATTR)
        metadata = json.loads(metadata_raw) if metadata_raw else {}
        feature_names = metadata.get("feature_names") or booster.feature_names or []
        class_names = metadata.get("class_names") or metadata.get("classes") or []
        head = cls(
            feature_names=feature_names,
            class_names=class_names,
            metadata=metadata,
        )
        head.booster = booster
        return head

    def predict_proba(self, X: Any) -> np.ndarray:
        """Return class probabilities for each row."""
        if self.booster is None:
            raise RuntimeError("FourWayCalibrationHead is not loaded")
        xgb = _require_xgboost()
        matrix, names = _coerce_rows(X, self.feature_names)
        if names != self.feature_names:
            raise ValueError("Prediction feature names do not match fitted model")
        dmatrix = xgb.DMatrix(
            matrix,
            feature_names=self.feature_names,
            missing=np.nan,
        )
        preds = np.asarray(self.booster.predict(dmatrix), dtype=np.float64)
        if preds.ndim == 1:
            class_count = max(len(self.class_names), 1)
            preds = preds.reshape(-1, class_count)
        return np.clip(preds, 0.0, 1.0)

    def predict_label(self, X: Any) -> list[str]:
        """Return the most likely v1.4 class label for each row."""
        probs = self.predict_proba(X)
        indices = np.argmax(probs, axis=1)
        if not self.class_names:
            return [str(int(index)) for index in indices]
        return [self.class_names[int(index)] for index in indices]
