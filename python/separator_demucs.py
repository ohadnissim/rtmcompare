"""
Stem separation using Demucs Python API.
Loads model ONCE, processes both files — saves ~30s of model loading.
"""

import os
import sys
import torch
import numpy as np
import librosa
import soundfile as sf


_model = None
_device = None


def get_model():
    """Load Demucs model once, reuse for all separations."""
    global _model, _device

    if _model is not None:
        return _model, _device

    # Set torch cache to app bundle so the model is found without downloading
    # Works both in dev (Compare App/) and packaged (Resources/)
    app_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for base in [app_dir, os.path.join(app_dir, '..', 'Resources')]:
        bundled_cache = os.path.join(base, 'model-cache', 'torch', 'hub', 'checkpoints')
        if os.path.isdir(bundled_cache):
            os.environ['TORCH_HOME'] = os.path.join(base, 'model-cache', 'torch')
            break

    from demucs.pretrained import get_model as load_model

    _device = torch.device("cpu")
    _model = load_model("htdemucs")
    _model.to(_device)
    _model.eval()

    return _model, _device


def separate(audio_path: str, output_dir: str, progress_cb=None):
    """Separate audio into 4 stems using Demucs API.

    5.3.1 honesty fix: pre-5.3 this silently downsampled to
    `model.samplerate` (44.1 kHz) and truncated >2-channel inputs to
    stereo without warning, then ran masking + AI detection on the
    downmixed result. Engineers comparing a 96 kHz / 5.1 master
    against the per-stem masking output had no idea their input had
    been mangled. Now we surface the input-shape facts via stderr so
    the calling pipeline can attach a `file_warnings` entry.
    """
    if progress_cb:
        progress_cb(f"Separating: {os.path.basename(audio_path)}")

    from demucs.apply import apply_model

    model, device = get_model()
    if progress_cb:
        progress_cb("Processing...")

    # Inspect the input BEFORE Demucs's internal resample/downmix so we
    # can report what was lost.
    try:
        info = sf.info(audio_path)
        src_sr = info.samplerate
        src_ch = info.channels
        warnings = []
        if src_sr != model.samplerate:
            warnings.append(
                f"resampled {src_sr}→{model.samplerate} Hz for stem separation"
            )
        if src_ch == 1:
            warnings.append("mono source duplicated to stereo for separation")
        elif src_ch > 2:
            warnings.append(
                f"input has {src_ch} channels — separation runs on the first 2 only "
                "(rear/centre/heights are not analysed)"
            )
        if warnings:
            sys.stderr.write(
                "[separator] input adapted: " + "; ".join(warnings) + "\n"
            )
    except Exception:
        pass

    # Load audio
    wav, sr = librosa.load(audio_path, sr=model.samplerate, mono=False)
    if wav.ndim == 1:
        wav = np.stack([wav, wav])

    # Convert to torch tensor
    tensor = torch.tensor(wav, dtype=torch.float32).unsqueeze(0).to(device)

    # Separate
    with torch.no_grad():
        sources = apply_model(model, tensor, device=device)

    # sources: (1, 4, 2, samples)
    sources = sources.squeeze(0).cpu().numpy()

    # Save stems
    stem_names = ["drums", "bass", "other", "vocals"]
    base_name = os.path.splitext(os.path.basename(audio_path))[0]
    stems_dir = os.path.join(output_dir, base_name)
    os.makedirs(stems_dir, exist_ok=True)

    stems = {}
    for i, name in enumerate(stem_names):
        stem_path = os.path.join(stems_dir, f"{name}.wav")
        sf.write(stem_path, sources[i].T, model.samplerate)
        stems[name] = stem_path

    return stems
