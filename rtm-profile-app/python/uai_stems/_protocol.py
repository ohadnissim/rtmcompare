"""Stem-separation backend protocol.

A backend takes a path to a mixed audio file and produces a directory of
per-stem WAV files. The contract is intentionally minimal so the rest of
the engine doesn't need to know which model produced the stems.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Dict


class StemBackend(ABC):
    """Abstract base class for stem-separation backends.

    Implementations must provide ``separate``. Each backend is responsible
    for its own model loading, temp/scratch handling, and resource cleanup
    of intermediate (non-output) artifacts. The caller owns ``out_dir``
    and is responsible for cleaning the returned WAV files.
    """

    #: Short identifier used by the engine in audit/logging output.
    name: str = "base"

    @abstractmethod
    def separate(self, audio_path: str, out_dir: str) -> Dict[str, str]:
        """Separate ``audio_path`` and write stem WAVs into ``out_dir``.

        Args:
            audio_path: Absolute path to the input mix.
            out_dir: Directory where the backend should place its output
                WAV files. Must exist and be writable.

        Returns:
            Mapping of stem name -> absolute path to a WAV file. Keys are
            taken from a small canonical vocabulary:
            ``vocals``, ``instrumental``, ``drums``, ``bass``, ``other``.

        Raises:
            RuntimeError: If separation cannot be completed for any reason
                (model missing, OOM, subprocess failure, etc.). The caller
                is expected to fall back to a different backend.
        """
        raise NotImplementedError
