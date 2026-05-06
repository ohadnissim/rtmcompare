"""Lyrics authorship detector using Whisper transcription plus text heuristics."""

from __future__ import annotations

import logging
import math
import os
import re
import tempfile
import threading
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np


logger = logging.getLogger(__name__)


_WORD_RE = re.compile(r"[A-Za-z][A-Za-z']+|\d+")
_YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")
_NUMBER_RE = re.compile(r"\b\d+(?:[.,:/-]\d+)*\b")
_CAPITALIZED_RE = re.compile(r"\b[A-Z][a-z]{2,}\b")


@dataclass
class LyricsResult:
    """Lyrics analysis result.

    score is 0..1, where 1 means the lyrics look AI-written.

    perplexity, repetition_score, and axis_score are populated when GPT-2
    based lyrics-axis scoring is available (see
    :meth:`LyricsDetector._perplexity_score`).
    """

    score: float
    confidence: float
    transcript: str
    features: Dict[str, Any] = field(default_factory=dict)
    reasons: List[str] = field(default_factory=list)
    perplexity: Optional[float] = None
    repetition_score: Optional[float] = None
    axis_score: Optional[float] = None


class LyricsDetector:
    """Transcribe vocals with Whisper and score AI-writing signals in lyrics."""

    _model_cache: Dict[str, Any] = {}
    _model_errors: Dict[str, str] = {}
    _model_lock = threading.Lock()

    # GPT-2 perplexity model cache (lazy-loaded). Stores either
    # (tokenizer, model) on success or False on permanent failure.
    _gpt2_cache: Dict[str, Any] = {}
    _gpt2_lock = threading.Lock()

    _banal_terms = {
        "love",
        "heart",
        "soul",
        "night",
        "light",
        "sky",
        "fly",
        "dream",
        "dreams",
        "fire",
        "desire",
        "pain",
        "rain",
        "tears",
        "fears",
        "forever",
        "together",
        "alone",
        "home",
        "cry",
        "tonight",
        "broken",
        "lost",
        "found",
        "alive",
        "free",
        "shine",
        "stars",
        "moon",
        "dance",
        "chance",
        "way",
        "stay",
        "away",
        "believe",
        "breathe",
        "feel",
        "feeling",
    }

    _generic_emotion_terms = {
        "love",
        "heart",
        "sad",
        "happy",
        "lonely",
        "alone",
        "hurt",
        "pain",
        "cry",
        "tears",
        "fear",
        "fears",
        "hope",
        "dream",
        "dreams",
        "believe",
        "feel",
        "feeling",
        "feelings",
        "broken",
        "lost",
        "found",
        "alive",
        "free",
        "forever",
        "miss",
        "need",
        "want",
        "desire",
    }

    _concrete_reference_terms = {
        "street",
        "avenue",
        "road",
        "highway",
        "apartment",
        "kitchen",
        "bedroom",
        "bar",
        "diner",
        "motel",
        "hotel",
        "airport",
        "station",
        "subway",
        "train",
        "bus",
        "church",
        "school",
        "hospital",
        "river",
        "bridge",
        "corner",
        "parking",
        "store",
        "phone",
        "letter",
        "photo",
        "picture",
        "cigarette",
        "coffee",
        "whiskey",
        "dress",
        "jacket",
        "shoes",
        "window",
        "door",
        "clock",
        "radio",
        "ticket",
    }

    _months = {
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
    }

    _common_rhyme_pairs = {
        frozenset(("night", "light")),
        frozenset(("heart", "apart")),
        frozenset(("love", "above")),
        frozenset(("fire", "desire")),
        frozenset(("pain", "rain")),
        frozenset(("tears", "fears")),
        frozenset(("forever", "together")),
        frozenset(("alone", "home")),
        frozenset(("cry", "sky")),
        frozenset(("fly", "sky")),
        frozenset(("way", "stay")),
        frozenset(("chance", "dance")),
        frozenset(("tonight", "alright")),
        frozenset(("free", "me")),
        frozenset(("blue", "you")),
        frozenset(("true", "you")),
    }

    _music_hallucination_phrases = {
        "thank you for watching",
        "thanks for watching",
        "subscribe",
        "like and subscribe",
        "subtitles by",
        "captioned by",
        "music",
        "instrumental",
        "applause",
    }

    def __init__(
        self,
        model_name: str = "base",
        language: Optional[str] = None,
        min_words: int = 24,
        max_transcript_chars: int = 12000,
        device: str = "cpu",
    ):
        self.model_name = model_name
        self.language = language
        self.min_words = min_words
        self.max_transcript_chars = max_transcript_chars
        self.device = self._normalize_device(device)

    @property
    def model_loaded(self) -> bool:
        return self._model_cache_key in self._model_cache

    @staticmethod
    def _normalize_device(device: Optional[str]) -> str:
        normalized = str(device or "cpu").strip().lower()
        return normalized or "cpu"

    @property
    def _model_cache_key(self) -> str:
        return f"{self.model_name}:{self.device}"

    def analyze(self, audio_path: str, vocals_path: Optional[str] = None) -> LyricsResult:
        """Analyze lyrics from a full mix or from an optional vocals stem."""
        source_path = vocals_path if vocals_path and Path(vocals_path).exists() else audio_path
        source_kind = "vocals_stem" if source_path == vocals_path else "full_mix"

        if not source_path or not Path(source_path).exists():
            return self._neutral_result(
                "Lyrics analysis skipped because the audio file was not found",
                {"source": source_kind, "audio_path": source_path or ""},
            )

        try:
            transcription = self._transcribe(source_path)
        except Exception as exc:
            logger.warning("Whisper lyrics transcription failed: %s", exc)
            return self._neutral_result(
                f"Whisper transcription unavailable: {str(exc)[:140]}",
                {"source": source_kind, "transcription_error": str(exc)[:500]},
            )

        transcript = transcription["transcript"][: self.max_transcript_chars].strip()
        segments = transcription["segments"]
        lines = self._lyric_lines(transcript=transcript, segments=segments)
        words_original = _WORD_RE.findall(transcript)
        words = [w.lower() for w in words_original]
        word_count = len(words)

        detected_language = transcription.get("language")
        language_probability = transcription.get("language_probability")

        features: Dict[str, Any] = {
            "transcription": {
                "source": source_kind,
                "model": self.model_name,
                "segment_count": len(segments),
                "word_count": word_count,
                "line_count": len(lines),
                "avg_logprob": transcription["avg_logprob"],
                "avg_no_speech_prob": transcription["avg_no_speech_prob"],
                "language": detected_language,
                "language_probability": language_probability,
            },
            "detected_language": detected_language,
            "language_probability": language_probability,
        }

        if word_count < 8:
            features.update(
                {
                    "repetitive_structure": {"score": 0.5, "reason": "insufficient_text"},
                    "vocabulary_banality": {"score": 0.5, "reason": "insufficient_text"},
                    "specific_references": {"score": 0.5, "reason": "insufficient_text"},
                    "predictable_meter": {"score": 0.5, "reason": "insufficient_text"},
                    "generic_emotional_language": {"score": 0.5, "reason": "insufficient_text"},
                }
            )
            return LyricsResult(
                score=0.5,
                confidence=0.0,
                transcript=transcript,
                features=features,
                reasons=["Not enough lyrical transcript for reliable lyrics authorship analysis"],
            )

        reasons: List[str] = []
        repetition_score, repetition_features, repetition_reasons = self._score_repetitive_structure(lines, words)
        banality_score, banality_features, banality_reasons = self._score_vocabulary_banality(lines, words)
        specificity_score, specificity_features, specificity_reasons = self._score_lack_of_specificity(
            transcript=transcript,
            lines=lines,
            words=words,
        )
        meter_score, meter_features, meter_reasons = self._score_predictable_meter(lines)
        emotion_score, emotion_features, emotion_reasons = self._score_generic_emotion(words, specificity_score)

        features["repetitive_structure"] = repetition_features
        features["vocabulary_banality"] = banality_features
        features["specific_references"] = specificity_features
        features["predictable_meter"] = meter_features
        features["generic_emotional_language"] = emotion_features

        reasons.extend(repetition_reasons)
        reasons.extend(banality_reasons)
        reasons.extend(specificity_reasons)
        reasons.extend(meter_reasons)
        reasons.extend(emotion_reasons)

        weights = {
            "repetitive_structure": 0.26,
            "vocabulary_banality": 0.22,
            "specific_references": 0.18,
            "predictable_meter": 0.17,
            "generic_emotional_language": 0.17,
        }
        feature_scores = {
            "repetitive_structure": repetition_score,
            "vocabulary_banality": banality_score,
            "specific_references": specificity_score,
            "predictable_meter": meter_score,
            "generic_emotional_language": emotion_score,
        }
        score = float(
            sum(weights[name] * feature_scores[name] for name in weights)
            / max(sum(weights.values()), 1e-8)
        )

        confidence = self._confidence(
            word_count=word_count,
            line_count=len(lines),
            transcription=transcription,
            feature_scores=list(feature_scores.values()),
        )

        # GPT-2 based lyrics-axis refinement: low perplexity + high 5-gram
        # repetition correlate with AI-generated lyrics. We blend the new
        # signal 50/50 into the existing heuristic score when available.
        # Language gate: GPT-2 is English-only, and Whisper is known to
        # hallucinate degenerate English on non-English vocals (e.g. Korean),
        # which yields artificially low perplexity and a false AI signal.
        perplexity_value: Optional[float] = None
        repetition_value: Optional[float] = None
        axis_value: Optional[float] = None
        existing_score = float(np.clip(score, 0.0, 1.0))
        blended_score = existing_score

        is_english = isinstance(detected_language, str) and detected_language.lower() == "en"
        lang_prob_ok = (
            not isinstance(language_probability, (int, float))
            or float(language_probability) >= 0.5
        )

        if not is_english or not lang_prob_ok:
            lang_label = detected_language or "unknown"
            reasons.append(
                f"non-English vocals detected ({lang_label}) - skipping GPT-2 perplexity check"
            )
        elif len(transcript) >= 30:
            ppl_result = self._perplexity_score(transcript)
            if ppl_result is not None:
                perplexity_value, repetition_value = ppl_result
                axis_value = self._lyrics_axis_score(perplexity_value, repetition_value)
                blended_score = float(
                    np.clip(0.5 * existing_score + 0.5 * axis_value, 0.0, 1.0)
                )
                features["lyrics_axis"] = {
                    "perplexity": perplexity_value,
                    "repetition_score": repetition_value,
                    "axis_score": axis_value,
                    "existing_score": existing_score,
                    "blended_score": blended_score,
                }
                if perplexity_value < 25.0:
                    reasons.append(
                        f"lyrics show GPT-2 perplexity {perplexity_value:.1f} - typical AI-generated range"
                    )

        if not reasons:
            if blended_score < 0.4:
                reasons.append("Lyrics include enough specificity and variation to avoid common AI-writing flags")
            elif blended_score > 0.6:
                reasons.append("Lyrics show several generic or formulaic writing signals")
            else:
                reasons.append("Lyrics evidence is mixed; no single writing-pattern signal dominates")

        return LyricsResult(
            score=blended_score,
            confidence=float(np.clip(confidence, 0.0, 1.0)),
            transcript=transcript,
            features=features,
            reasons=self._dedupe_reasons(reasons),
            perplexity=perplexity_value,
            repetition_score=repetition_value,
            axis_score=axis_value,
        )

    def _get_model(self) -> Any:
        cache_key = self._model_cache_key
        if cache_key in self._model_cache:
            return self._model_cache[cache_key]
        if cache_key in self._model_errors:
            raise RuntimeError(self._model_errors[cache_key])

        with self._model_lock:
            if cache_key in self._model_cache:
                return self._model_cache[cache_key]
            if cache_key in self._model_errors:
                raise RuntimeError(self._model_errors[cache_key])

            try:
                import whisper

                model = whisper.load_model(
                    self.model_name,
                    device=self.device,
                    download_root=self._whisper_cache_dir(),
                )
            except Exception as exc:
                message = (
                    f"Unable to load Whisper model '{self.model_name}'. "
                    "Install openai-whisper and make sure the model is cached or downloadable."
                )
                self._model_errors[cache_key] = f"{message} Original error: {exc}"
                raise RuntimeError(self._model_errors[cache_key]) from exc

            self._model_cache[cache_key] = model
            return model

    def _whisper_cache_dir(self) -> str:
        configured = os.getenv("UAI_WHISPER_CACHE_DIR")
        if configured:
            path = Path(configured).expanduser()
        else:
            cache_root = Path(os.getenv("XDG_CACHE_HOME", str(Path.home() / ".cache"))).expanduser()
            path = cache_root / "whisper"

        try:
            path.mkdir(parents=True, exist_ok=True)
            return str(path)
        except OSError:
            fallback = Path(tempfile.gettempdir()) / "uai_whisper_cache"
            fallback.mkdir(parents=True, exist_ok=True)
            return str(fallback)

    def _transcribe(self, audio_path: str) -> Dict[str, Any]:
        model = self._get_model()

        torch_module = None
        try:
            import torch
            torch_module = torch

            device_type = getattr(getattr(model, "device", None), "type", "cpu")
            use_fp16 = bool(device_type == "cuda" and torch.cuda.is_available())
        except Exception:
            use_fp16 = False

        kwargs = {
            "task": "transcribe",
            "fp16": use_fp16,
            "verbose": False,
            "temperature": 0.0,
            "condition_on_previous_text": False,
        }
        if self.language:
            kwargs["language"] = self.language

        if torch_module is not None:
            with torch_module.no_grad():
                result = model.transcribe(audio_path, **kwargs)
        else:
            result = model.transcribe(audio_path, **kwargs)
        raw_segments = result.get("segments") or []

        detected_language = result.get("language")
        language_probability = result.get("language_probability")
        if not isinstance(language_probability, (int, float)):
            # whisper.transcribe doesn't always expose language_probability;
            # if missing, fall back to the highest entry in detected_language_probs
            probs = result.get("language_probs") or result.get("detected_language_probs")
            if isinstance(probs, dict) and probs:
                try:
                    language_probability = float(max(probs.values()))
                except Exception:
                    language_probability = None

        segments = []
        logprobs = []
        no_speech_probs = []
        for segment in raw_segments:
            text = self._clean_segment_text(str(segment.get("text", "")))
            if not text:
                continue
            if self._looks_like_music_marker(text):
                continue

            avg_logprob = segment.get("avg_logprob")
            no_speech_prob = segment.get("no_speech_prob")
            if isinstance(avg_logprob, (int, float)):
                logprobs.append(float(avg_logprob))
            if isinstance(no_speech_prob, (int, float)):
                no_speech_probs.append(float(no_speech_prob))

            if (
                isinstance(no_speech_prob, (int, float))
                and isinstance(avg_logprob, (int, float))
                and no_speech_prob > 0.93
                and avg_logprob < -1.2
            ):
                continue

            segments.append(
                {
                    "text": text,
                    "start": float(segment.get("start", 0.0) or 0.0),
                    "end": float(segment.get("end", 0.0) or 0.0),
                    "avg_logprob": float(avg_logprob) if isinstance(avg_logprob, (int, float)) else None,
                    "no_speech_prob": (
                        float(no_speech_prob) if isinstance(no_speech_prob, (int, float)) else None
                    ),
                }
            )

        transcript = "\n".join(s["text"] for s in segments).strip()
        if not transcript:
            transcript = self._clean_segment_text(str(result.get("text", ""))).strip()
            if self._looks_like_music_marker(transcript):
                transcript = ""

        return {
            "transcript": transcript,
            "segments": segments,
            "avg_logprob": float(np.mean(logprobs)) if logprobs else None,
            "avg_no_speech_prob": float(np.mean(no_speech_probs)) if no_speech_probs else None,
            "language": detected_language if isinstance(detected_language, str) else None,
            "language_probability": (
                float(language_probability)
                if isinstance(language_probability, (int, float))
                else None
            ),
        }

    def _score_repetitive_structure(self, lines: Sequence[str], words: Sequence[str]) -> Tuple[float, dict, List[str]]:
        normalized_lines = [self._normalize_line(line) for line in lines if len(_WORD_RE.findall(line)) >= 2]
        line_count = len(normalized_lines)

        if line_count < 4:
            features = {
                "score": 0.5,
                "line_count": line_count,
                "duplicate_line_ratio": 0.0,
                "near_duplicate_line_ratio": 0.0,
                "repeated_phrase_ratio": 0.0,
            }
            return 0.5, features, []

        counts = Counter(normalized_lines)
        duplicate_instances = sum(count - 1 for count in counts.values() if count > 1)
        duplicate_ratio = duplicate_instances / max(line_count, 1)

        near_duplicate_pairs = 0
        comparisons = 0
        for idx, line in enumerate(normalized_lines):
            line_words = set(line.split())
            if not line_words:
                continue
            for other in normalized_lines[idx + 1 : min(line_count, idx + 8)]:
                other_words = set(other.split())
                if not other_words:
                    continue
                comparisons += 1
                jaccard = len(line_words & other_words) / max(len(line_words | other_words), 1)
                if jaccard >= 0.72:
                    near_duplicate_pairs += 1
        near_duplicate_ratio = near_duplicate_pairs / max(comparisons, 1)

        repeated_phrase_ratio = self._repeated_ngram_ratio(words, n=3)
        phrase_score = _scale(repeated_phrase_ratio, low=0.04, high=0.18)
        duplicate_score = _scale(duplicate_ratio, low=0.08, high=0.34)
        near_duplicate_score = _scale(near_duplicate_ratio, low=0.06, high=0.28)

        score = float(np.clip(0.42 * duplicate_score + 0.30 * near_duplicate_score + 0.28 * phrase_score, 0, 1))
        features = {
            "score": score,
            "line_count": line_count,
            "duplicate_line_ratio": duplicate_ratio,
            "near_duplicate_line_ratio": near_duplicate_ratio,
            "repeated_phrase_ratio": repeated_phrase_ratio,
        }

        reasons = []
        if duplicate_ratio >= 0.16:
            reasons.append(f"Repeated lyric lines are prominent ({duplicate_ratio:.0%} duplicate line instances)")
        if repeated_phrase_ratio >= 0.12:
            reasons.append("Short phrases recur at a formulaic rate across the transcript")
        if near_duplicate_ratio >= 0.18:
            reasons.append("Multiple lyric lines are near-duplicates with small word substitutions")

        return score, features, reasons

    def _score_vocabulary_banality(self, lines: Sequence[str], words: Sequence[str]) -> Tuple[float, dict, List[str]]:
        if not words:
            return 0.5, {"score": 0.5}, []

        word_count = len(words)
        banal_count = sum(1 for word in words if word in self._banal_terms)
        banal_density = banal_count / max(word_count, 1)
        unique_word_ratio = len(set(words)) / max(word_count, 1)
        rhyme_pair_ratio = self._common_rhyme_pair_ratio(lines)

        banal_score = _scale(banal_density, low=0.07, high=0.22)
        rhyme_score = _scale(rhyme_pair_ratio, low=0.08, high=0.38)
        low_variety_score = _scale(1.0 - unique_word_ratio, low=0.45, high=0.72)
        score = float(np.clip(0.45 * banal_score + 0.32 * rhyme_score + 0.23 * low_variety_score, 0, 1))

        features = {
            "score": score,
            "banal_term_density": banal_density,
            "banal_term_count": banal_count,
            "unique_word_ratio": unique_word_ratio,
            "common_rhyme_pair_ratio": rhyme_pair_ratio,
        }

        reasons = []
        if banal_density >= 0.16:
            reasons.append("Lyrics lean heavily on common pop abstractions and generic rhyme vocabulary")
        if rhyme_pair_ratio >= 0.25:
            reasons.append("Common rhyming pairs appear repeatedly in line endings")
        if unique_word_ratio <= 0.38 and word_count >= 60:
            reasons.append("Vocabulary variety is unusually low for the transcript length")

        return score, features, reasons

    def _score_lack_of_specificity(
        self,
        transcript: str,
        lines: Sequence[str],
        words: Sequence[str],
    ) -> Tuple[float, dict, List[str]]:
        word_count = len(words)
        if word_count == 0:
            return 0.5, {"score": 0.5}, []

        line_starts = {
            _WORD_RE.findall(line)[0]
            for line in lines
            if _WORD_RE.findall(line)
        }
        proper_nouns = [
            token
            for token in _CAPITALIZED_RE.findall(transcript)
            if token not in line_starts and token.lower() not in {"i", "im", "ive"}
        ]
        year_count = len(_YEAR_RE.findall(transcript))
        number_count = len(_NUMBER_RE.findall(transcript))
        month_count = sum(1 for word in words if word in self._months)
        concrete_count = sum(1 for word in words if word in self._concrete_reference_terms)
        total_refs = len(proper_nouns) + year_count + number_count + month_count + concrete_count
        refs_per_100 = 100.0 * total_refs / max(word_count, 1)

        lack_score = 1.0 - _scale(refs_per_100, low=0.5, high=4.0)
        features = {
            "score": float(np.clip(lack_score, 0, 1)),
            "specific_reference_count": total_refs,
            "specific_references_per_100_words": refs_per_100,
            "proper_noun_count": len(proper_nouns),
            "year_count": year_count,
            "number_count": number_count,
            "month_count": month_count,
            "concrete_detail_count": concrete_count,
        }

        reasons = []
        if refs_per_100 < 0.7 and word_count >= 70:
            reasons.append("Lyrics contain few concrete personal, cultural, temporal, or place references")
        elif refs_per_100 >= 4.0:
            reasons.append("Lyrics include concrete references that reduce the AI-lyrics signal")

        return float(features["score"]), features, reasons

    def _score_predictable_meter(self, lines: Sequence[str]) -> Tuple[float, dict, List[str]]:
        line_word_counts = [len(_WORD_RE.findall(line)) for line in lines if len(_WORD_RE.findall(line)) >= 2]
        if len(line_word_counts) < 5:
            features = {
                "score": 0.5,
                "line_count": len(line_word_counts),
                "line_word_count_mean": float(np.mean(line_word_counts)) if line_word_counts else 0.0,
                "line_word_count_std": float(np.std(line_word_counts)) if line_word_counts else 0.0,
                "line_word_count_cv": 0.0,
                "syllable_count_cv": 0.0,
            }
            return 0.5, features, []

        syllable_counts = [self._estimate_syllables(line) for line in lines if len(_WORD_RE.findall(line)) >= 2]
        word_mean = float(np.mean(line_word_counts))
        word_std = float(np.std(line_word_counts))
        word_cv = word_std / max(word_mean, 1e-8)
        syllable_mean = float(np.mean(syllable_counts)) if syllable_counts else 0.0
        syllable_std = float(np.std(syllable_counts)) if syllable_counts else 0.0
        syllable_cv = syllable_std / max(syllable_mean, 1e-8)

        predictable_word_score = 1.0 - _scale(word_cv, low=0.18, high=0.55)
        predictable_syllable_score = 1.0 - _scale(syllable_cv, low=0.16, high=0.48)
        regular_length_bonus = 0.15 if 5.0 <= word_mean <= 11.0 else 0.0
        score = float(np.clip(0.48 * predictable_word_score + 0.37 * predictable_syllable_score + regular_length_bonus, 0, 1))

        features = {
            "score": score,
            "line_count": len(line_word_counts),
            "line_word_count_mean": word_mean,
            "line_word_count_std": word_std,
            "line_word_count_cv": word_cv,
            "syllable_count_mean": syllable_mean,
            "syllable_count_std": syllable_std,
            "syllable_count_cv": syllable_cv,
        }

        reasons = []
        if word_cv <= 0.22 and syllable_cv <= 0.22 and len(line_word_counts) >= 8:
            reasons.append("Line lengths and estimated syllable counts are unusually uniform")
        return score, features, reasons

    def _score_generic_emotion(
        self,
        words: Sequence[str],
        lack_specificity_score: float,
    ) -> Tuple[float, dict, List[str]]:
        if not words:
            return 0.5, {"score": 0.5}, []

        word_count = len(words)
        emotion_count = sum(1 for word in words if word in self._generic_emotion_terms)
        pronoun_count = sum(1 for word in words if word in {"i", "me", "my", "you", "your", "we", "us", "our"})
        emotion_density = emotion_count / max(word_count, 1)
        pronoun_density = pronoun_count / max(word_count, 1)

        emotion_score = _scale(emotion_density, low=0.08, high=0.23)
        pronoun_score = _scale(pronoun_density, low=0.16, high=0.34)
        score = float(np.clip(0.58 * emotion_score + 0.22 * pronoun_score + 0.20 * lack_specificity_score, 0, 1))

        features = {
            "score": score,
            "generic_emotion_density": emotion_density,
            "generic_emotion_count": emotion_count,
            "pronoun_density": pronoun_density,
            "lack_specificity_score": lack_specificity_score,
        }

        reasons = []
        if emotion_density >= 0.16 and lack_specificity_score >= 0.65:
            reasons.append("Emotional language is generic and weakly anchored to concrete details")
        return score, features, reasons

    def _confidence(
        self,
        word_count: int,
        line_count: int,
        transcription: Dict[str, Any],
        feature_scores: Sequence[float],
    ) -> float:
        word_evidence = _scale(word_count, low=self.min_words, high=140)
        line_evidence = _scale(line_count, low=5, high=18)

        avg_logprob = transcription.get("avg_logprob")
        avg_no_speech_prob = transcription.get("avg_no_speech_prob")
        quality = 0.62
        if isinstance(avg_logprob, (int, float)):
            quality = float(np.clip((avg_logprob + 1.4) / 1.1, 0.2, 1.0))
        if isinstance(avg_no_speech_prob, (int, float)):
            quality *= float(np.clip(1.15 - avg_no_speech_prob, 0.25, 1.0))

        feature_array = np.asarray(feature_scores, dtype=np.float32)
        decisiveness = float(abs(np.mean(feature_array) - 0.5) * 2.0)
        agreement = float(1.0 - min(np.std(feature_array) * 1.8, 1.0))
        confidence = 0.36 * word_evidence + 0.20 * line_evidence + 0.20 * quality + 0.14 * agreement + 0.10 * decisiveness
        return float(np.clip(confidence, 0, 1))

    def _lyric_lines(self, transcript: str, segments: Sequence[dict]) -> List[str]:
        if segments:
            raw_lines = [str(segment.get("text", "")).strip() for segment in segments]
        else:
            raw_lines = re.split(r"[\n\r]+|(?<=[.!?])\s+", transcript)

        lines: List[str] = []
        for raw in raw_lines:
            cleaned = self._clean_segment_text(raw)
            if not cleaned:
                continue
            words = _WORD_RE.findall(cleaned)
            if len(words) <= 14:
                lines.append(cleaned)
                continue

            for idx in range(0, len(words), 8):
                chunk = " ".join(words[idx : idx + 8])
                if len(_WORD_RE.findall(chunk)) >= 2:
                    lines.append(chunk)
        return lines

    def _clean_segment_text(self, text: str) -> str:
        text = re.sub(r"\[(?:music|instrumental|applause|noise|silence)\]", " ", text, flags=re.I)
        text = re.sub(r"\((?:music|instrumental|applause|noise|silence)\)", " ", text, flags=re.I)
        text = re.sub(r"\s+", " ", text).strip()
        return text

    def _looks_like_music_marker(self, text: str) -> bool:
        normalized = re.sub(r"[^a-z0-9 ]+", "", text.lower()).strip()
        if not normalized:
            return True
        if normalized in self._music_hallucination_phrases:
            return True
        return any(phrase in normalized for phrase in self._music_hallucination_phrases if len(phrase) > 8)

    def _normalize_line(self, line: str) -> str:
        words = [w.lower().strip("'") for w in _WORD_RE.findall(line)]
        return " ".join(words)

    def _line_ending_word(self, line: str) -> Optional[str]:
        words = [w.lower().strip("'") for w in _WORD_RE.findall(line)]
        if not words:
            return None
        return words[-1]

    def _common_rhyme_pair_ratio(self, lines: Sequence[str]) -> float:
        endings = [self._line_ending_word(line) for line in lines]
        endings = [ending for ending in endings if ending]
        if len(endings) < 2:
            return 0.0

        pairs = 0
        common_pairs = 0
        for first, second in zip(endings, endings[1:]):
            if not first or not second or first == second:
                continue
            pairs += 1
            if frozenset((first, second)) in self._common_rhyme_pairs:
                common_pairs += 1
            elif self._rhyme_tail(first) == self._rhyme_tail(second) and first not in self._concrete_reference_terms:
                common_pairs += 0.5
        return common_pairs / max(pairs, 1)

    def _rhyme_tail(self, word: str) -> str:
        word = re.sub(r"[^a-z]", "", word.lower())
        if len(word) <= 3:
            return word
        vowels = "aeiouy"
        for idx in range(len(word) - 2, -1, -1):
            if word[idx] in vowels:
                return word[idx:]
        return word[-3:]

    def _repeated_ngram_ratio(self, words: Sequence[str], n: int) -> float:
        if len(words) < n * 3:
            return 0.0
        grams = [tuple(words[idx : idx + n]) for idx in range(0, len(words) - n + 1)]
        counts = Counter(grams)
        repeats = sum(count - 1 for count in counts.values() if count > 1)
        return repeats / max(len(grams), 1)

    def _estimate_syllables(self, line: str) -> int:
        return sum(max(1, _count_syllables(word)) for word in _WORD_RE.findall(line))

    def _neutral_result(self, reason: str, features: Optional[dict] = None) -> LyricsResult:
        return LyricsResult(
            score=0.5,
            confidence=0.0,
            transcript="",
            features=features or {},
            reasons=[reason],
        )

    def _dedupe_reasons(self, reasons: Sequence[str]) -> List[str]:
        deduped = []
        seen = set()
        for reason in reasons:
            if reason in seen:
                continue
            seen.add(reason)
            deduped.append(reason)
        return deduped

    # ------------------------------------------------------------------
    # GPT-2 perplexity / repetition lyrics-axis scoring
    # ------------------------------------------------------------------
    def _load_gpt2(self) -> Optional[Tuple[Any, Any]]:
        """Lazy-load the GPT-2 small model and tokenizer.

        Returns ``(tokenizer, model)`` on success or ``None`` if anything
        prevents loading (missing dependencies, offline, etc.). The result
        is cached on the class so the cost is paid only once per process.
        """
        cache_key = f"gpt2:{self.device}"
        cached = self._gpt2_cache.get(cache_key)
        if cached is False:
            return None
        if cached is not None:
            return cached

        with self._gpt2_lock:
            cached = self._gpt2_cache.get(cache_key)
            if cached is False:
                return None
            if cached is not None:
                return cached

            try:
                import torch  # noqa: F401  (sanity-check torch is importable)
                from transformers import AutoModelForCausalLM, AutoTokenizer

                tokenizer = AutoTokenizer.from_pretrained("gpt2")
                model = AutoModelForCausalLM.from_pretrained("gpt2")
                model = model.to(self.device)
                model.eval()
            except Exception as exc:
                logger.warning(
                    "GPT-2 lyrics-perplexity model unavailable; falling back to "
                    "heuristic-only lyrics score (%s)",
                    exc,
                )
                self._gpt2_cache[cache_key] = False
                return None

            self._gpt2_cache[cache_key] = (tokenizer, model)
            return tokenizer, model

    def _perplexity_score(self, transcript: str) -> Optional[Tuple[float, float]]:
        """Compute GPT-2 perplexity and 5-gram repetition for ``transcript``.

        Returns ``(perplexity, repetition_score)`` or ``None`` if GPT-2 cannot
        be loaded. The repetition score is computed independently of the
        language model so it is meaningful even when GPT-2 is unhappy with
        the language (e.g., Korean) — but if GPT-2 is unavailable at all we
        return ``None`` so callers can skip the blending step entirely.
        """
        loaded = self._load_gpt2()
        if loaded is None:
            return None

        tokenizer, model = loaded
        try:
            import torch

            with torch.no_grad():
                encoded = tokenizer(
                    transcript,
                    return_tensors="pt",
                    truncation=True,
                    max_length=getattr(model.config, "n_positions", 1024),
                )
                if self.device != "cpu":
                    if hasattr(encoded, "to"):
                        encoded = encoded.to(self.device)
                    else:
                        encoded = {
                            key: value.to(self.device) if hasattr(value, "to") else value
                            for key, value in dict(encoded).items()
                        }
                input_ids = encoded["input_ids"]
                if input_ids.shape[1] < 2:
                    return None
                outputs = model(input_ids, labels=input_ids)
                loss = float(outputs.loss.detach().cpu().item())
            perplexity = float(math.exp(min(loss, 50.0)))  # guard against overflow
        except Exception as exc:
            logger.warning("GPT-2 perplexity computation failed: %s", exc)
            return None

        repetition = self._five_gram_repetition(transcript)
        return perplexity, repetition

    @staticmethod
    def _five_gram_repetition(transcript: str) -> float:
        """Sliding-window 5-gram duplicate ratio: ``1 - unique/total``."""
        tokens = [w.lower() for w in _WORD_RE.findall(transcript)]
        if len(tokens) < 5:
            return 0.0
        grams = [tuple(tokens[i : i + 5]) for i in range(len(tokens) - 4)]
        if not grams:
            return 0.0
        unique = len(set(grams))
        total = len(grams)
        return float(np.clip(1.0 - unique / total, 0.0, 1.0))

    @staticmethod
    def _lyrics_axis_score(perplexity: float, repetition: float) -> float:
        """Map (perplexity, repetition) to a 0..1 AI-likeness score.

        - Low GPT-2 perplexity -> high AI score via a sigmoid centered at 35.
        - High 5-gram repetition -> high AI score via linear ramp 0.2..0.6.
        - Final score is a weighted blend (0.6 perplexity, 0.4 repetition).
        """
        try:
            score_ppl = 1.0 / (1.0 + math.exp((float(perplexity) - 35.0) / 8.0))
        except OverflowError:
            score_ppl = 0.0 if perplexity > 35.0 else 1.0
        score_rep = float(np.clip((float(repetition) - 0.2) / 0.4, 0.0, 1.0))
        return float(np.clip(0.6 * score_ppl + 0.4 * score_rep, 0.0, 1.0))


def _scale(value: float, low: float, high: float) -> float:
    if math.isclose(high, low):
        return 0.0
    return float(np.clip((float(value) - low) / (high - low), 0.0, 1.0))


def _count_syllables(word: str) -> int:
    word = re.sub(r"[^a-z]", "", word.lower())
    if not word:
        return 0
    if len(word) <= 3:
        return 1
    groups = re.findall(r"[aeiouy]+", word)
    count = len(groups)
    if word.endswith("e") and count > 1 and not word.endswith(("le", "ye")):
        count -= 1
    return max(count, 1)
