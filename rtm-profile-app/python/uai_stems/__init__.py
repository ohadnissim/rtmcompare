"""Pluggable stem-separation backends for the SegmentDetector.

Five backends ship with this package:

- :class:`BSRoformer4StemBackend` — default 4-stem BS-RoFormer
  (drums, bass, other, vocals).
- :class:`MelRoformerBackend`    — higher-quality 4-stem Mel-Band-RoFormer
  (drums, bass, other, vocals); SDR 11.99 vs BS-RoFormer's 9.66.
- :class:`BSRoformerBackend` — best vocal isolation, 2 stems
  (vocals + instrumental).
- :class:`DemucsBackend`     — legacy htdemucs subprocess, 2 or 4 stems.
- :class:`CascadeBackend`    — Roformer for vocals, then htdemucs_ft on
  the cleaned instrumental for drums/bass/other (fallback).

Use :func:`get_backend` to look one up by name. Unknown names raise
``ValueError``.
"""

from __future__ import annotations

from typing import Dict, Optional, Type

from ._protocol import StemBackend
from .cascade import CascadeBackend
from .demucs import DemucsBackend
from .mel_roformer import MelRoformerBackend
from .roformer import BSRoformerBackend
from .roformer_4stem import BSRoformer4StemBackend


default_backend = "bs_roformer_4stem"

_BACKENDS: Dict[str, Type[StemBackend]] = {
    "bs_roformer_4stem": BSRoformer4StemBackend,
    "bs_roformer_cascade": BSRoformer4StemBackend,
    "mel_roformer_4stem": MelRoformerBackend,
    "cascade": CascadeBackend,
    "roformer": BSRoformerBackend,
    "demucs": DemucsBackend,
}


def get_backend(name: Optional[str] = None, **kwargs) -> StemBackend:
    """Return an instance of the named backend.

    Args:
        name: One of ``bs_roformer_4stem`` (default), ``mel_roformer_4stem``,
            ``cascade``, ``roformer``, or ``demucs``.
        **kwargs: Forwarded to the backend constructor.

    Raises:
        ValueError: If ``name`` does not match a known backend.
    """
    key = (name or default_backend).strip().lower()
    if key not in _BACKENDS:
        raise ValueError(
            f"Unknown stem backend {name!r}. Known backends: {sorted(_BACKENDS)}"
        )
    return _BACKENDS[key](**kwargs)


__all__ = [
    "StemBackend",
    "BSRoformer4StemBackend",
    "BSRoformerBackend",
    "CascadeBackend",
    "DemucsBackend",
    "MelRoformerBackend",
    "default_backend",
    "get_backend",
]
