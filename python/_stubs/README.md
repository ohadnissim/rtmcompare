# Unfinished analyzer scaffolds

Files here define the contract / stub implementation for features on
the roadmap but not yet wired into production `analyze.py`.

Do **not** import from here — the implementations are placeholder or
incomplete, and ship state is "not present in the analysis pipeline".

- `binaural_render.py` — Apple Spatial Audio binaural rendering.
  Needs HRTF impulse-response bank + ADM spatial-pan decoder.
- `transfer_artefact_detector.py` — wow/flutter/DC drift/print-through
  detection for tape-transfer QC. Needs proper `scipy.signal.hilbert`
  envelope + tuning against a corpus of actual tape captures.

When implementation work begins, move the file back to `python/` and
wire it into `analyze.py` + `types.ts` + the correct React panel.
