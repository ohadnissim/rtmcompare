"""
Long-context structural detector for AI music detection.

This detector targets the 30-120s regime where structural repetition patterns
become visible. The core idea aligns with the SpecTTTra (ICLR 2025) insight:
AI songs often exhibit over-regular long-range dependencies (e.g., near-perfect
verse/chorus repeats) that are hard to see in short 5-10s snippets.

Signals computed per overlapping long window:
- Chroma self-similarity / recurrence matrix patterns
- Near-identical segment repetition ratio
- Segment-level entropy (low entropy => formulaic structure)
- Spectral variance over time (low variance => uniform long spans)

Then compares recurrence/self-similarity structure across distant song sections.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import librosa
import numpy as np
from scipy import signal
from scipy.ndimage import zoom


@dataclass
class LongContextWindowResult:
    """Per-window long-context structural analysis."""

    window_duration_sec: float
    start_sec: float
    end_sec: float
    frame_count: int
    self_similarity_score: float
    structural_repetition_score: float
    segment_entropy_score: float
    spectral_uniformity_score: float
    structural_score: float
    near_identical_pairs: int = 0
    total_pairs: int = 0
    near_identical_ratio: float = 0.0
    normalized_entropy: float = 0.0
    spectral_variance: float = 0.0
    offdiagonal_similarity: float = 0.0


@dataclass
class LongContextSectionSimilarity:
    """Similarity between two distant sections' self-similarity structure."""

    window_duration_sec: float
    start_a_sec: float
    start_b_sec: float
    similarity: float


@dataclass
class LongContextResult:
    """Result for long-context structural regularity analysis."""

    score: float  # 0 = likely human structure, 1 = likely AI-like regularity
    confidence: float
    structural_regularity: float
    track_duration_sec: float
    window_hop_sec: float
    window_sizes_sec: List[float] = field(default_factory=list)
    window_results: List[LongContextWindowResult] = field(default_factory=list)
    mean_self_similarity: float = 0.0
    mean_structural_repetition: float = 0.0
    mean_segment_entropy_score: float = 0.0
    mean_spectral_uniformity: float = 0.0
    cross_section_similarity: float = 0.0
    cross_section_score: float = 0.0
    suspicious_section_pairs: List[LongContextSectionSimilarity] = field(default_factory=list)
    component_scores: Dict[str, float] = field(default_factory=dict)
    repetition_patterns: List[str] = field(default_factory=list)
    anomalies: List[str] = field(default_factory=list)


class LongContextDetector:
    """Detect structural regularity over long (30-120s) time spans."""

    def __init__(
        self,
        sr: int = 22050,
        feature_hop_length: int = 2048,
        window_sizes_sec: Tuple[float, ...] = (30.0, 60.0, 120.0),
        window_hop_sec: float = 15.0,
        structural_fps: float = 2.5,
        segment_duration_sec: float = 2.0,
        segment_hop_sec: float = 1.0,
    ):
        self.sr = sr
        self.feature_hop_length = feature_hop_length
        self.window_sizes_sec = tuple(sorted(float(w) for w in window_sizes_sec))
        self.window_hop_sec = float(window_hop_sec)
        self.structural_fps = float(structural_fps)
        self.segment_duration_sec = float(segment_duration_sec)
        self.segment_hop_sec = float(segment_hop_sec)

    def analyze(self, audio_path: str) -> LongContextResult:
        """Run long-context structural analysis over 30/60/120s windows."""
        y, sr = librosa.load(audio_path, sr=self.sr, mono=True)

        if y.size == 0:
            return LongContextResult(
                score=0.5,
                confidence=0.0,
                structural_regularity=0.5,
                track_duration_sec=0.0,
                window_hop_sec=self.window_hop_sec,
                window_sizes_sec=list(self.window_sizes_sec),
                anomalies=["Audio appears empty; long-context detector skipped"],
            )

        track_duration_sec = float(len(y) / sr)

        if track_duration_sec < min(self.window_sizes_sec) * 0.7:
            return LongContextResult(
                score=0.5,
                confidence=0.1,
                structural_regularity=0.5,
                track_duration_sec=track_duration_sec,
                window_hop_sec=self.window_hop_sec,
                window_sizes_sec=list(self.window_sizes_sec),
                anomalies=[
                    (
                        f"Track too short ({track_duration_sec:.1f}s) for robust "
                        "30-120s long-context analysis"
                    )
                ],
            )

        chroma = self._compute_chroma(y, sr)
        log_mel = self._compute_log_mel(y, sr)

        if chroma.size == 0 or log_mel.size == 0:
            return LongContextResult(
                score=0.5,
                confidence=0.2,
                structural_regularity=0.5,
                track_duration_sec=track_duration_sec,
                window_hop_sec=self.window_hop_sec,
                window_sizes_sec=list(self.window_sizes_sec),
                anomalies=["Insufficient spectral features for long-context analysis"],
            )

        global_spectral_variance = float(np.mean(np.std(log_mel, axis=1))) if log_mel.shape[1] > 1 else 1.0
        global_spectral_variance = max(global_spectral_variance, 1e-6)

        window_results: List[LongContextWindowResult] = []
        signatures_by_duration: Dict[float, List[Tuple[float, np.ndarray]]] = {
            w: [] for w in self.window_sizes_sec
        }

        total_samples = len(y)
        window_hop_samples = int(self.window_hop_sec * sr)

        for window_duration in self.window_sizes_sec:
            window_samples = int(window_duration * sr)
            starts = self._window_starts(
                total_samples=total_samples,
                window_samples=window_samples,
                hop_samples=window_hop_samples,
            )

            for start_sample in starts:
                end_sample = min(start_sample + window_samples, total_samples)
                analyzed = self._analyze_window(
                    chroma=chroma,
                    log_mel=log_mel,
                    start_sample=start_sample,
                    end_sample=end_sample,
                    sr=sr,
                    window_duration=window_duration,
                    global_spectral_variance=global_spectral_variance,
                )
                if analyzed is None:
                    continue

                window_result, signature_vec = analyzed
                window_results.append(window_result)

                if signature_vec is not None:
                    signatures_by_duration[window_duration].append(
                        (window_result.start_sec, signature_vec)
                    )

        if not window_results:
            return LongContextResult(
                score=0.5,
                confidence=0.2,
                structural_regularity=0.5,
                track_duration_sec=track_duration_sec,
                window_hop_sec=self.window_hop_sec,
                window_sizes_sec=list(self.window_sizes_sec),
                anomalies=["No valid long-context windows were extracted"],
            )

        mean_self_similarity = float(np.mean([w.self_similarity_score for w in window_results]))
        mean_structural_repetition = float(np.mean([w.structural_repetition_score for w in window_results]))
        mean_segment_entropy_score = float(np.mean([w.segment_entropy_score for w in window_results]))
        mean_spectral_uniformity = float(np.mean([w.spectral_uniformity_score for w in window_results]))

        cross_section_similarity, cross_section_score, suspicious_pairs = self._compare_section_matrices(
            signatures_by_duration=signatures_by_duration
        )

        structural_regularity = float(
            np.clip(
                0.23 * mean_self_similarity
                + 0.27 * mean_structural_repetition
                + 0.20 * mean_segment_entropy_score
                + 0.15 * mean_spectral_uniformity
                + 0.15 * cross_section_score,
                0.0,
                1.0,
            )
        )

        window_struct_scores = np.array([w.structural_score for w in window_results], dtype=float)
        consistency = float(np.clip(1.0 - min(np.std(window_struct_scores) / 0.22, 1.0), 0.0, 1.0))
        score = float(np.clip(0.88 * structural_regularity + 0.12 * consistency, 0.0, 1.0))

        coverage = min(len(window_results) / 12.0, 1.0)
        component_values = [
            mean_self_similarity,
            mean_structural_repetition,
            mean_segment_entropy_score,
            mean_spectral_uniformity,
            cross_section_score,
        ]
        agreement = float(np.clip(1.0 - min(np.std(component_values) * 1.8, 1.0), 0.0, 1.0))
        decisiveness = float(abs(score - 0.5) * 2.0)
        confidence = float(np.clip(0.35 * coverage + 0.35 * agreement + 0.30 * decisiveness, 0.0, 1.0))

        repetition_patterns = self._build_pattern_notes(
            window_results=window_results,
            mean_structural_repetition=mean_structural_repetition,
            mean_segment_entropy_score=mean_segment_entropy_score,
            mean_spectral_uniformity=mean_spectral_uniformity,
            suspicious_pairs=suspicious_pairs,
        )

        anomalies = list(repetition_patterns)

        return LongContextResult(
            score=score,
            confidence=confidence,
            structural_regularity=structural_regularity,
            track_duration_sec=track_duration_sec,
            window_hop_sec=self.window_hop_sec,
            window_sizes_sec=list(self.window_sizes_sec),
            window_results=window_results,
            mean_self_similarity=mean_self_similarity,
            mean_structural_repetition=mean_structural_repetition,
            mean_segment_entropy_score=mean_segment_entropy_score,
            mean_spectral_uniformity=mean_spectral_uniformity,
            cross_section_similarity=cross_section_similarity,
            cross_section_score=cross_section_score,
            suspicious_section_pairs=suspicious_pairs,
            component_scores={
                "self_similarity": mean_self_similarity,
                "structural_repetition": mean_structural_repetition,
                "segment_entropy": mean_segment_entropy_score,
                "spectral_uniformity": mean_spectral_uniformity,
                "cross_section_similarity": cross_section_score,
                "consistency": consistency,
            },
            repetition_patterns=repetition_patterns,
            anomalies=anomalies,
        )

    def _compute_chroma(self, y: np.ndarray, sr: int) -> np.ndarray:
        """Compute robust chroma representation used for structure analysis."""
        try:
            chroma = librosa.feature.chroma_cqt(
                y=y,
                sr=sr,
                hop_length=self.feature_hop_length,
            )
        except Exception:
            chroma = librosa.feature.chroma_stft(
                y=y,
                sr=sr,
                hop_length=self.feature_hop_length,
                n_fft=4096,
            )

        chroma = np.asarray(chroma, dtype=np.float32)
        if chroma.ndim != 2 or chroma.shape[1] == 0:
            return np.zeros((12, 0), dtype=np.float32)

        # Light smoothing to avoid overreacting to frame noise.
        if chroma.shape[1] >= 5:
            chroma = signal.savgol_filter(chroma, window_length=5, polyorder=2, axis=1, mode="interp")
            chroma = np.clip(chroma, 0.0, None)

        return chroma

    def _compute_log_mel(self, y: np.ndarray, sr: int) -> np.ndarray:
        """Compute log-mel representation for long-span spectral variance."""
        mel = librosa.feature.melspectrogram(
            y=y,
            sr=sr,
            n_fft=4096,
            hop_length=self.feature_hop_length,
            n_mels=64,
            fmax=sr / 2.0,
        )
        return librosa.power_to_db(mel + 1e-10)

    def _window_starts(self, total_samples: int, window_samples: int, hop_samples: int) -> List[int]:
        """Build overlapping window starts with tail coverage."""
        if window_samples <= 0 or hop_samples <= 0:
            return []

        min_coverage = int(0.7 * window_samples)
        if total_samples < min_coverage:
            return []

        if total_samples <= window_samples:
            return [0]

        starts = list(range(0, total_samples - window_samples + 1, hop_samples))
        tail_start = total_samples - window_samples
        if not starts or tail_start - starts[-1] >= hop_samples // 2:
            starts.append(tail_start)

        # Deduplicate while preserving order.
        deduped = []
        seen = set()
        for s in starts:
            if s in seen:
                continue
            seen.add(s)
            deduped.append(s)
        return deduped

    def _analyze_window(
        self,
        chroma: np.ndarray,
        log_mel: np.ndarray,
        start_sample: int,
        end_sample: int,
        sr: int,
        window_duration: float,
        global_spectral_variance: float,
    ) -> Optional[Tuple[LongContextWindowResult, np.ndarray]]:
        """Compute all long-context features for one window."""
        start_frame = int(start_sample / self.feature_hop_length)
        end_frame = int(np.ceil(end_sample / self.feature_hop_length))

        start_frame = max(0, min(start_frame, chroma.shape[1]))
        end_frame = max(start_frame + 1, min(end_frame, chroma.shape[1]))

        chroma_win = chroma[:, start_frame:end_frame]
        mel_win = log_mel[:, start_frame:end_frame]

        if chroma_win.shape[1] < 8 or mel_win.shape[1] < 4:
            return None

        target_frames = int(max(36, round(window_duration * self.structural_fps)))
        if chroma_win.shape[1] > target_frames:
            chroma_struct = signal.resample(chroma_win, target_frames, axis=1)
        else:
            chroma_struct = chroma_win

        # Normalize per frame for cosine-style structural comparison.
        frame_norm = np.linalg.norm(chroma_struct, axis=0, keepdims=True) + 1e-8
        chroma_struct = chroma_struct / frame_norm

        ssm = self._compute_recurrence_matrix(chroma_struct)
        if ssm.shape[0] < 4:
            return None

        self_similarity_score, offdiag_mean = self._self_similarity_score(ssm)

        (
            structural_repetition_score,
            near_identical_pairs,
            total_pairs,
            near_identical_ratio,
            normalized_entropy,
            segment_entropy_score,
        ) = self._segment_repetition_and_entropy(chroma_struct)

        spectral_variance = float(np.mean(np.std(mel_win, axis=1))) if mel_win.shape[1] > 1 else 0.0
        variance_ratio = spectral_variance / max(global_spectral_variance, 1e-6)
        spectral_uniformity_score = float(np.clip((1.20 - variance_ratio) / 0.70, 0.0, 1.0))

        structural_score = float(
            np.clip(
                0.28 * self_similarity_score
                + 0.30 * structural_repetition_score
                + 0.22 * segment_entropy_score
                + 0.20 * spectral_uniformity_score,
                0.0,
                1.0,
            )
        )

        signature_vec = self._matrix_signature(ssm)

        result = LongContextWindowResult(
            window_duration_sec=float(window_duration),
            start_sec=float(start_sample / sr),
            end_sec=float(end_sample / sr),
            frame_count=int(chroma_struct.shape[1]),
            self_similarity_score=float(self_similarity_score),
            structural_repetition_score=float(structural_repetition_score),
            segment_entropy_score=float(segment_entropy_score),
            spectral_uniformity_score=float(spectral_uniformity_score),
            structural_score=float(structural_score),
            near_identical_pairs=int(near_identical_pairs),
            total_pairs=int(total_pairs),
            near_identical_ratio=float(near_identical_ratio),
            normalized_entropy=float(normalized_entropy),
            spectral_variance=float(spectral_variance),
            offdiagonal_similarity=float(offdiag_mean),
        )

        return result, signature_vec

    def _compute_recurrence_matrix(self, chroma_struct: np.ndarray) -> np.ndarray:
        """Compute chroma self-similarity using librosa recurrence functions."""
        n_frames = chroma_struct.shape[1]
        if n_frames < 2:
            return np.eye(max(n_frames, 1), dtype=np.float32)

        width = max(1, int(self.structural_fps))
        k = min(max(4, int(np.sqrt(n_frames) * 2)), n_frames - 1)

        try:
            rec = librosa.segment.recurrence_matrix(
                chroma_struct,
                k=k,
                width=width,
                metric="cosine",
                sym=True,
                sparse=False,
                mode="affinity",
                self=True,
            )
        except Exception:
            # Fallback to dense cosine self-similarity if recurrence fails.
            rec = np.dot(chroma_struct.T, chroma_struct)
            rec = np.clip(rec, 0.0, 1.0)
            np.fill_diagonal(rec, 1.0)

        rec = np.asarray(rec, dtype=np.float32)
        if rec.ndim != 2 or rec.shape[0] != rec.shape[1]:
            size = chroma_struct.shape[1]
            return np.eye(size, dtype=np.float32)

        # Ensure bounded numerical range.
        rec = np.clip(rec, 0.0, 1.0)
        return rec

    def _self_similarity_score(self, ssm: np.ndarray) -> Tuple[float, float]:
        """Score long-range off-diagonal recurrence regularity."""
        n = ssm.shape[0]
        if n < 3:
            return 0.5, 0.0

        idx = np.arange(n)
        i, j = np.meshgrid(idx, idx, indexing="ij")
        min_sep = max(2, int(self.structural_fps * 3.0))
        far_mask = np.abs(i - j) >= min_sep

        if not np.any(far_mask):
            far_mask = ~np.eye(n, dtype=bool)

        far_vals = ssm[far_mask]
        if far_vals.size == 0:
            return 0.5, 0.0

        offdiag_mean = float(np.mean(far_vals))
        high_affinity_ratio = float(np.mean(far_vals >= 0.75))

        # High off-diagonal affinity + many strong matches => high regularity.
        score_raw = 0.65 * offdiag_mean + 0.35 * high_affinity_ratio
        score = float(np.clip((score_raw - 0.18) / 0.60, 0.0, 1.0))
        return score, offdiag_mean

    def _segment_repetition_and_entropy(
        self,
        chroma_struct: np.ndarray,
    ) -> Tuple[float, int, int, float, float, float]:
        """
        Segment-level repetition/entropy metrics from chroma sequence.

        Returns:
            repetition_score, near_pairs, total_pairs, near_ratio,
            normalized_entropy, entropy_score
        """
        fps = self.structural_fps
        frames_per_segment = max(2, int(round(self.segment_duration_sec * fps)))
        frames_per_hop = max(1, int(round(self.segment_hop_sec * fps)))

        segment_vectors = []
        n_frames = chroma_struct.shape[1]
        for start in range(0, max(1, n_frames - frames_per_segment + 1), frames_per_hop):
            end = start + frames_per_segment
            if end > n_frames:
                break
            seg = chroma_struct[:, start:end]
            vec = np.mean(seg, axis=1)
            norm = np.linalg.norm(vec) + 1e-8
            segment_vectors.append(vec / norm)

        if len(segment_vectors) < 4:
            return 0.5, 0, 0, 0.0, 0.5, 0.5

        seg = np.asarray(segment_vectors, dtype=np.float32)
        sim = np.dot(seg, seg.T)
        sim = np.clip(sim, -1.0, 1.0)

        iu0, iu1 = np.triu_indices(seg.shape[0], k=1)
        min_gap_segments = max(2, int(round(4.0 / max(self.segment_hop_sec, 1e-6))))
        far_pairs = (iu1 - iu0) >= min_gap_segments

        pair_vals = sim[iu0[far_pairs], iu1[far_pairs]]
        if pair_vals.size == 0:
            return 0.5, 0, 0, 0.0, 0.5, 0.5

        near_threshold = 0.92
        very_near_threshold = 0.97

        near_pairs = int(np.sum(pair_vals >= near_threshold))
        very_near_pairs = int(np.sum(pair_vals >= very_near_threshold))
        total_pairs = int(pair_vals.size)
        near_ratio = float(near_pairs / max(total_pairs, 1))
        very_near_ratio = float(very_near_pairs / max(total_pairs, 1))

        repetition_raw = 0.70 * near_ratio + 0.30 * very_near_ratio
        repetition_score = float(np.clip((repetition_raw - 0.02) / 0.25, 0.0, 1.0))

        tokens = np.argmax(seg, axis=1)
        token_entropy = self._normalized_entropy(tokens, n_bins=12)

        if len(tokens) >= 2:
            transitions = tokens[:-1] * 12 + tokens[1:]
            transition_entropy = self._normalized_entropy(transitions, n_bins=12 * 12)
        else:
            transition_entropy = token_entropy

        normalized_entropy = float(0.60 * token_entropy + 0.40 * transition_entropy)

        # Low entropy => more formulaic / repetitive structure.
        entropy_score = float(np.clip((1.0 - normalized_entropy - 0.05) / 0.80, 0.0, 1.0))

        return (
            repetition_score,
            near_pairs,
            total_pairs,
            near_ratio,
            normalized_entropy,
            entropy_score,
        )

    def _normalized_entropy(self, values: np.ndarray, n_bins: int) -> float:
        """Shannon entropy normalized to [0, 1]."""
        if values.size == 0:
            return 0.0

        counts = np.bincount(values.astype(int), minlength=max(1, n_bins)).astype(np.float64)
        probs = counts / np.sum(counts)
        probs = probs[probs > 0]
        if probs.size == 0:
            return 0.0

        entropy = -np.sum(probs * np.log2(probs))
        max_entropy = np.log2(float(n_bins)) if n_bins > 1 else 1.0
        if max_entropy <= 0:
            return 0.0
        return float(np.clip(entropy / max_entropy, 0.0, 1.0))

    def _matrix_signature(self, ssm: np.ndarray, target_size: int = 32) -> np.ndarray:
        """Build fixed-size signature vector from a self-similarity matrix."""
        if ssm.shape[0] == 0:
            return np.zeros(1, dtype=np.float32)

        scale = target_size / float(ssm.shape[0])
        resized = zoom(ssm, zoom=(scale, scale), order=1)
        resized = np.asarray(resized, dtype=np.float32)

        if resized.shape[0] != target_size or resized.shape[1] != target_size:
            resized = np.resize(resized, (target_size, target_size)).astype(np.float32)

        tri = resized[np.triu_indices(target_size, k=1)]
        norm = np.linalg.norm(tri) + 1e-8
        return tri / norm

    def _compare_section_matrices(
        self,
        signatures_by_duration: Dict[float, List[Tuple[float, np.ndarray]]],
    ) -> Tuple[float, float, List[LongContextSectionSimilarity]]:
        """
        Compare section-level self-similarity matrices across distant parts.

        Returns:
            cross_section_similarity, cross_section_score, suspicious_pairs
        """
        pair_scores: List[Tuple[float, float, float, float]] = []

        for duration, entries in signatures_by_duration.items():
            if len(entries) < 2:
                continue

            for i in range(len(entries)):
                start_i, sig_i = entries[i]
                for j in range(i + 1, len(entries)):
                    start_j, sig_j = entries[j]

                    # Ignore heavily overlapping windows for cross-section checks.
                    if abs(start_j - start_i) < duration * 0.75:
                        continue

                    denom = (np.linalg.norm(sig_i) * np.linalg.norm(sig_j)) + 1e-8
                    sim = float(np.dot(sig_i, sig_j) / denom)
                    pair_scores.append((duration, start_i, start_j, sim))

        if not pair_scores:
            return 0.0, 0.0, []

        sims = np.array([p[3] for p in pair_scores], dtype=float)
        top_count = max(1, int(np.ceil(len(sims) * 0.25)))
        top_mean = float(np.mean(np.sort(sims)[-top_count:]))

        cross_section_similarity = float(np.clip(top_mean, 0.0, 1.0))
        cross_section_score = float(np.clip((cross_section_similarity - 0.70) / 0.25, 0.0, 1.0))

        suspicious_pairs = []
        pair_scores.sort(key=lambda x: x[3], reverse=True)
        for duration, start_i, start_j, sim in pair_scores:
            if sim < 0.90:
                continue
            suspicious_pairs.append(
                LongContextSectionSimilarity(
                    window_duration_sec=float(duration),
                    start_a_sec=float(start_i),
                    start_b_sec=float(start_j),
                    similarity=float(sim),
                )
            )
            if len(suspicious_pairs) >= 8:
                break

        return cross_section_similarity, cross_section_score, suspicious_pairs

    def _build_pattern_notes(
        self,
        window_results: List[LongContextWindowResult],
        mean_structural_repetition: float,
        mean_segment_entropy_score: float,
        mean_spectral_uniformity: float,
        suspicious_pairs: List[LongContextSectionSimilarity],
    ) -> List[str]:
        """Produce human-readable repetition pattern details."""
        notes: List[str] = []

        high_windows = [w for w in window_results if w.structural_score >= 0.7]
        if high_windows:
            notes.append(
                (
                    f"Long-context regularity is high in {len(high_windows)}/{len(window_results)} "
                    "windows (30-120s range)"
                )
            )

        if mean_structural_repetition >= 0.65:
            notes.append(
                (
                    f"Near-identical segment repetition is elevated "
                    f"(avg repetition score={mean_structural_repetition:.2f})"
                )
            )

        if mean_segment_entropy_score >= 0.60:
            notes.append(
                (
                    f"Segment sequence entropy is low/formulaic "
                    f"(AI-likelihood entropy score={mean_segment_entropy_score:.2f})"
                )
            )

        if mean_spectral_uniformity >= 0.60:
            notes.append(
                (
                    f"Spectral evolution is unusually uniform across long windows "
                    f"(uniformity score={mean_spectral_uniformity:.2f})"
                )
            )

        if suspicious_pairs:
            first = suspicious_pairs[0]
            notes.append(
                (
                    "Distant sections have very similar self-similarity structure "
                    f"(e.g., {first.start_a_sec:.1f}s vs {first.start_b_sec:.1f}s, "
                    f"similarity={first.similarity:.2f})"
                )
            )

        return notes
