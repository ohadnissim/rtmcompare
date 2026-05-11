# RTMcompare — IT Deployment Notes

## System Requirements

| | Minimum |
|---|---|
| **macOS** | 12 Monterey or later (universal binary — Apple Silicon + Intel) |
| **Windows** | Windows 10 or 11, 64-bit |
| **RAM** | 4 GB |
| **Disk** | 500 MB |
| **Python** | 3.8+ (PDF export only — see below) |

---

## Installation

### macOS

RTMcompare ships as a **notarized DMG**. No additional approval steps required on managed machines.

1. Mount the DMG and drag `RTMcompare.app` to `/Applications/`.
2. First launch is gated by Gatekeeper — users may need to right-click → Open on first run, or you can pre-approve the binary via MDM.

**Silent install (imaging / MDM script):**
```sh
hdiutil attach RTMcompare-*.dmg -quiet && \
cp -R /Volumes/RTMcompare/RTMcompare.app /Applications/ && \
hdiutil detach /Volumes/RTMcompare -quiet
```

### Windows

RTMcompare ships as an **NSIS installer**. Must be run as administrator for the initial install.

**Silent install:**
```cmd
RTMcompare-Setup-*.exe /S
```

---

## Python Dependency (PDF Export Only)

The PDF export feature (student report generation) requires Python 3.8+ with `reportlab` and `pillow`. Audio analysis and all other features work without Python.

**Resolution order — the app checks these locations in sequence:**

1. Bundled Python sidecar (ships with the installer when available)
2. `/usr/local/bin/python3`
3. `/usr/bin/python3`
4. `python3` in the system PATH

If none are found, analysis works normally but the "Export Report" button is disabled with an error message.

**To install dependencies manually:**
```sh
pip install reportlab pillow
```

For lab environments, deploying a Python sidecar or ensuring `python3` is in the standard PATH is the cleanest solution.

---

## Canvas API Token

The Canvas integration is **per-instructor** and configured locally on the instructor's machine only. Student machines never touch Canvas.

**Generating a token in Canvas:**

1. Go to Canvas → Account → Settings → scroll to **Approved Integrations** → click **+ New Access Token**.
2. The token only needs the **"Grades - edit"** scope. No other permissions required.

**How RTMcompare stores it:**

- Tokens are encrypted at rest using **macOS Keychain** (macOS) or **Windows DPAPI via Electron `safeStorage`** (Windows).
- Tokens are **never stored in plaintext** anywhere on disk.
- Storage is per-user, per-machine — no shared credential store.

---

## Network Requirements

| Feature | Network needed? |
|---|---|
| Audio analysis | No — fully offline |
| Learn Mode / Grade Book | No — fully offline |
| PDF export | No — fully offline |
| Canvas grade upload | Yes — HTTPS to your Canvas domain only |

No telemetry, no external analytics, no cloud dependencies outside of the optional Canvas upload.

---

## Data Storage & Privacy

- App writes to `~/Library/Application Support/RTMcompare/` (macOS) or `%APPDATA%\RTMcompare\` (Windows).
- No admin rights required after initial install.
- Student data (reports, annotations, rubric scores) stays on the student's machine. No data leaves the machine except when the instructor performs a Canvas grade upload.
- Canvas tokens are stored in the OS credential store — not in the app data folder.

---

## Uninstall

**macOS:** Drag `RTMcompare.app` to Trash. To remove all user data: `rm -rf ~/Library/Application\ Support/RTMcompare/`

**Windows:** Add/Remove Programs → RTMcompare → Uninstall.
