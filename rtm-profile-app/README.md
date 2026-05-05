# RTMprofile

Companion app to RTMcompare. Builds an engineer-style mastering profile
from a corpus of audio files.

Drop your tracks → analyze → out comes a `.json` profile that loads into
RTMcompare's Match tab.

## Output schema

```json
{
  "name":              "Engineer Name",
  "role":              "Mastering Engineer",
  "genres":            ["Hip-Hop", "R&B"],
  "description":       "Mastering Engineer — Hip-Hop, R&B",
  "sample_count":      75,
  "curve":             [/* 31 floats: third-octave dB, mean-centred */],
  "lufs_avg":          -8.7,
  "lufs_std":          0.9,
  "lufs_range":        [-11.7, -6.5],
  "dynamic_range_avg": 5.5,
  "dynamic_range_std": 2.3,
  "width_avg":         0.117,
  "width_std":         0.064,
  "peak_avg":          -0.3
}
```

Matches `python/profiles/ohad.json` in the RTMcompare repo. Drop any
RTMprofile output into `~/.rtm/profiles/<slug>.json` and RTMcompare picks
it up automatically.

## Architecture

- **Tiny Electron shell** — drag-drop file picker + form for name / role
  / genres + Build button. ~250 lines of React.
- **Python aggregator** at `python/build_profile.py` — measures LUFS-I,
  true peak, LRA, third-octave spectrum, crest factor, stereo width per
  file, then aggregates (median curve, mean+std for scalars).
- **Shares RTMcompare's Python bundle.** Probes
  `/Applications/RTMcompare.app/Contents/Resources/python-bundle/` first
  so the dmg stays small (no duplicated 700 MB analyzer). Falls back to
  system `python3` if RTMcompare isn't installed (system Python must
  have `numpy`, `scipy`, `soundfile`, `pyloudnorm`).

## Develop

```bash
npm install
npm run dev   # starts vite + tsc -w + electron
```

## Ship

```bash
npm run pack         # macOS → release-build/RTMprofile-<v>-arm64.dmg
npm run pack:win     # Windows → release-build/RTMprofile-<v>-Setup.exe + portable
```

## Standalone CLI

The Python aggregator runs standalone too — useful for scripting or
batch jobs:

```bash
python3 python/build_profile.py \
  --name "Ohad Nissim" \
  --role "Mastering Engineer" \
  --genres "Hip-Hop,R&B,Electronic" \
  --out ohad.json \
  --progress \
  *.wav
```
