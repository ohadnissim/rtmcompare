"""Legacy Demucs subprocess backend.

Wraps the existing ``python -m demucs --two-stems vocals -n <model>``
invocation, preserving the exact behavior the engine has shipped with.
This is the safe fallback when newer backends fail.
"""

from __future__ import annotations

import logging
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, Optional, Sequence

from ._protocol import StemBackend


logger = logging.getLogger(__name__)


class DemucsBackend(StemBackend):
    """Run Demucs as a subprocess and return the separated stems.

    By default uses the ``htdemucs`` 2-stem split (vocals + no_vocals)
    because that is what the legacy ``SegmentDetector`` produced. When
    ``four_stem`` is True the backend runs the full 4-stem split
    (vocals/drums/bass/other) — this is the mode used by ``CascadeBackend``
    when it asks Demucs to break down a pre-cleaned instrumental track.
    """

    name = "demucs"

    def __init__(
        self,
        model: str = "htdemucs",
        four_stem: bool = False,
        timeout: int = 300,
        device: str = "cpu",
    ):
        self.model = model
        self.four_stem = four_stem
        self.timeout = timeout
        self.device = str(device or "cpu").strip().lower()

    def separate(self, audio_path: str, out_dir: str) -> Dict[str, str]:
        out_root = Path(out_dir)
        out_root.mkdir(parents=True, exist_ok=True)

        self._run_demucs([audio_path], out_root)
        stems_path = self._locate_output_dir(out_root, audio_path)
        if stems_path is None:
            logger.error("Demucs subprocess produced no stem directory under %s", out_root)
            raise RuntimeError("Demucs finished but no stem directory was found")

        stem_paths = self._collect_stems(stems_path)
        if not stem_paths:
            logger.error("Demucs subprocess produced no expected stem WAVs under %s", stems_path)
            raise RuntimeError(f"No expected stem WAVs found under {stems_path}")

        return stem_paths

    def separate_many(self, audio_paths: Sequence[str], out_dir: str) -> Dict[str, Dict[str, str]]:
        """Run one Demucs subprocess for multiple audio files.

        Demucs does not expose a long-lived worker API, but its CLI accepts
        multiple input paths. Batch callers can use this to amortize Python and
        model start-up over a group of tracks when they use the standalone
        Demucs backend.
        """
        paths = [str(path) for path in audio_paths]
        if not paths:
            return {}

        out_root = Path(out_dir)
        out_root.mkdir(parents=True, exist_ok=True)
        self._run_demucs(paths, out_root)

        results: Dict[str, Dict[str, str]] = {}
        for audio_path in paths:
            stems_path = self._locate_output_dir(out_root, audio_path)
            if stems_path is None:
                logger.warning("Demucs batch produced no stem directory for %s", audio_path)
                results[audio_path] = {}
                continue
            results[audio_path] = self._collect_stems(stems_path)
        return results

    def _run_demucs(self, audio_paths: Sequence[str], out_root: Path) -> None:
        cmd = [
            sys.executable, "-m", "demucs",
            "-n", self.model,
            "--device", self.device,
            "-o", str(out_root),
        ]
        if not self.four_stem:
            cmd.extend(["--two-stems", "vocals"])
        cmd.extend(str(path) for path in audio_paths)
        logger.info("Demucs subprocess Python: %s", sys.executable)
        logger.info("Demucs subprocess command: %s", shlex.join(cmd))

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.timeout,
            )
        except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
            logger.error("Demucs subprocess unavailable via %s: %s", sys.executable, exc)
            raise RuntimeError(f"Demucs subprocess unavailable: {exc}") from exc

        if result.returncode != 0:
            stderr = result.stderr.strip()
            logger.error(
                "Demucs subprocess failed with exit code %s using %s: %s",
                result.returncode,
                sys.executable,
                stderr[:300],
            )
            raise RuntimeError(
                f"Demucs returned non-zero ({result.returncode}): "
                f"{stderr[:300]}"
            )

    def _collect_stems(self, stems_path: Path) -> Dict[str, str]:
        stem_paths: Dict[str, str] = {}

        if self.four_stem:
            for stem_name in ("vocals", "drums", "bass", "other"):
                stem_file = stems_path / f"{stem_name}.wav"
                if stem_file.exists():
                    stem_paths[stem_name] = str(stem_file)
        else:
            # 2-stem mode: vocals + no_vocals (the engine renames it
            # to "instrumental" downstream).
            for stem_name, file_name in (("vocals", "vocals"), ("instrumental", "no_vocals")):
                stem_file = stems_path / f"{file_name}.wav"
                if stem_file.exists():
                    stem_paths[stem_name] = str(stem_file)

            # Defensive fallback: if for any reason demucs ignored the
            # --two-stems flag and produced 4 stems, accept those.
            if not stem_paths:
                for stem_name in ("vocals", "drums", "bass", "other"):
                    stem_file = stems_path / f"{stem_name}.wav"
                    if stem_file.exists():
                        stem_paths[stem_name] = str(stem_file)

        return stem_paths

    @staticmethod
    def _locate_output_dir(out_root: Path, audio_path: str) -> Optional[Path]:
        """Find the per-track directory Demucs created."""
        audio_name = Path(audio_path).stem

        # Demucs writes to: {out_root}/{model_name}/{audio_name}/{stem}.wav
        # Try the model-named subdirectory first.
        for model_dir in out_root.iterdir() if out_root.exists() else []:
            if not model_dir.is_dir():
                continue
            candidate = model_dir / audio_name
            if candidate.exists():
                return candidate

        # Fallback: locate any directory containing vocals.wav under out_root.
        for vocals_wav in out_root.rglob("vocals.wav"):
            return vocals_wav.parent

        return None


def _isolated_demucs(
    audio_path: str,
    four_stem: bool,
    model: str,
    device: str = "cpu",
) -> Dict[str, str]:
    """Run Demucs in a private temp dir and return result paths.

    Helper used by :class:`CascadeBackend` so that the cascade's own
    output directory only receives the post-processed stems we hand back
    to the caller.
    """
    backend = DemucsBackend(model=model, four_stem=four_stem, device=device)
    tmp = tempfile.mkdtemp(prefix="aivshu_demucs_inner_")
    try:
        results = backend.separate(audio_path, tmp)
        # Return paths as-is; the cascade is responsible for copying out.
        return results
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
