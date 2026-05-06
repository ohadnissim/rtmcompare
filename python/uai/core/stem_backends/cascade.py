"""Cascade backend: Roformer for vocals, Demucs for drums/bass/other.

This is the preferred stem-separation pipeline. BS-RoFormer produces a
much cleaner ``vocals`` / ``instrumental`` split than Demucs, which in
turn makes the downstream Demucs run on the cleaned instrumental more
reliable for ``drums`` / ``bass`` / ``other``.

Stems returned: ``vocals`` (Roformer) plus ``drums``, ``bass``, ``other``
(htdemucs_ft on the Roformer instrumental). The Roformer ``instrumental``
WAV is intentionally not returned — the caller should consume the per-
component stems from htdemucs.
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Dict

from ._protocol import StemBackend
from .demucs import DemucsBackend
from .roformer import BSRoformerBackend


logger = logging.getLogger(__name__)


class CascadeBackend(StemBackend):
    """Run Roformer first, then htdemucs_ft on its instrumental."""

    name = "cascade"

    def __init__(
        self,
        roformer: BSRoformerBackend | None = None,
        demucs_model: str = "htdemucs_ft",
        device: str = "cpu",
    ):
        self.device = str(device or "cpu").strip().lower()
        self.roformer = roformer or BSRoformerBackend(device=self.device)
        # The cascade specifically wants the high-quality 4-stem
        # fine-tuned model on the *cleaned* instrumental. This is where
        # most of the SDR improvement compounds.
        self.demucs = DemucsBackend(
            model=demucs_model,
            four_stem=True,
            device=self.device,
        )

    def warm_up(self) -> None:
        """Warm the reusable RoFormer stage for batch-mode scoring."""
        warm_up = getattr(self.roformer, "warm_up", None)
        if callable(warm_up):
            warm_up()

    def separate(self, audio_path: str, out_dir: str) -> Dict[str, str]:
        out_root = Path(out_dir)
        out_root.mkdir(parents=True, exist_ok=True)

        # ---- Step 1: Roformer split -> vocals + instrumental ----------
        roformer_dir = out_root / "_roformer"
        roformer_dir.mkdir(exist_ok=True)
        try:
            roformer_paths = self.roformer.separate(audio_path, str(roformer_dir))
        except Exception as exc:
            raise RuntimeError(f"Cascade: Roformer stage failed: {exc}") from exc

        instrumental_path = roformer_paths.get("instrumental")
        vocals_path = roformer_paths.get("vocals")
        if not instrumental_path or not vocals_path:
            raise RuntimeError("Cascade: Roformer did not return vocals+instrumental")

        # ---- Step 2: Demucs (htdemucs_ft) on the cleaned instrumental
        demucs_dir = out_root / "_demucs"
        demucs_dir.mkdir(exist_ok=True)
        try:
            demucs_paths = self.demucs.separate(instrumental_path, str(demucs_dir))
        except Exception as exc:
            raise RuntimeError(f"Cascade: Demucs stage failed: {exc}") from exc

        # ---- Step 3: Stage the final outputs into out_dir -------------
        # Copy each stem to a stable, predictable filename at the top of
        # out_dir so the caller doesn't have to know about our internal
        # subdirectories. The intermediates are kept in place for now;
        # SegmentDetector._cleanup() drops the whole tree anyway.
        final: Dict[str, str] = {}

        vocals_dst = out_root / "vocals.wav"
        shutil.copy2(vocals_path, vocals_dst)
        final["vocals"] = str(vocals_dst)

        for stem in ("drums", "bass", "other"):
            src = demucs_paths.get(stem)
            if not src:
                continue
            dst = out_root / f"{stem}.wav"
            shutil.copy2(src, dst)
            final[stem] = str(dst)

        if "vocals" not in final or len(final) < 2:
            raise RuntimeError(
                f"Cascade produced incomplete stems: {list(final.keys())}"
            )

        return final
