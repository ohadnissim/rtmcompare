# Windows Python Bundle Setup

Before running `npm run pack:win`, populate `python-bundle-win/python/` with a
Windows CPython 3.11 x64 embeddable runtime.

## Steps

```bash
# 1. Download the embeddable package
curl -LO https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip

# 2. Unzip into the bundle directory
mkdir -p python-bundle-win/python
unzip python-3.11.9-embed-amd64.zip -d python-bundle-win/python

# 3. Enable site-packages (uncomment the import line in python311._pth)
# Edit python-bundle-win/python/python311._pth and uncomment: import site

# 4. Install pip
curl -LO https://bootstrap.pypa.io/get-pip.py
python-bundle-win/python/python.exe get-pip.py --no-warn-script-location

# 5. Install required packages
python-bundle-win/python/python.exe -m pip install \
  numpy scipy soundfile librosa pyloudnorm 2>/dev/null || \
  python-bundle-win/python/Scripts/pip.exe install \
  numpy scipy soundfile librosa pyloudnorm
```

## Notes

- `python-bundle-win/` is gitignored (binary runtime, ~120 MB)
- `pack:win` will exit with a clear error if the directory is missing
- The directory is separate from `python-bundle/` (macOS arm64) and
  `python-bundle-intel/` (macOS x64)
