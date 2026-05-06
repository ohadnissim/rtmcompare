"""Runtime detector package."""

from .cnn_detector import CNNDetector as CNNDetector
from .codec_residual_detector import CodecResidualDetector as CodecResidualDetector
from .engine import EnsembleDetector as EnsembleDetector
from .fakeprint_detector import FakePrintDetector as FakePrintDetector
from .fourier_detector import FourierDetector as FourierDetector
from .highfreq_detector import HighFrequencyDetector as HighFrequencyDetector
from .lyrics_detector import LyricsDetector as LyricsDetector
from .lyrics_detector import LyricsResult as LyricsResult
from .longcontext_detector import LongContextDetector as LongContextDetector
from .longcontext_detector import LongContextResult as LongContextResult
from .onset_detector import OnsetTimingDetector as OnsetTimingDetector
from .onset_detector import OnsetTimingResult as OnsetTimingResult
from .phase_detector import PhaseDetector as PhaseDetector
from .production_detector import ProductionDetector as ProductionDetector
from .production_detector import ProductionResult as ProductionResult
from .segment_detector import SegmentDetector as SegmentDetector
from .spectral_detector import SpectralDetector as SpectralDetector
from .spectttra_detector import SpecTTTraDetector as SpecTTTraDetector
from .spectttra_detector import SpecTTTraResult as SpecTTTraResult
from .stem_classifier import StemClassifier as StemClassifier
from .temporal_detector import TemporalDetector as TemporalDetector

__all__ = [
    "CNNDetector",
    "CodecResidualDetector",
    "EnsembleDetector",
    "FakePrintDetector",
    "FourierDetector",
    "HighFrequencyDetector",
    "LyricsDetector",
    "LyricsResult",
    "LongContextDetector",
    "LongContextResult",
    "OnsetTimingDetector",
    "OnsetTimingResult",
    "PhaseDetector",
    "ProductionDetector",
    "ProductionResult",
    "SegmentDetector",
    "SpecTTTraDetector",
    "SpecTTTraResult",
    "SpectralDetector",
    "StemClassifier",
    "TemporalDetector",
]
