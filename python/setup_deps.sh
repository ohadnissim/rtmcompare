#!/bin/bash
# RTM — Auto-install Python dependencies on first launch

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MARKER="$SCRIPT_DIR/.deps_installed"
VENV_DIR="$SCRIPT_DIR/.rtm-venv"
LOG="$SCRIPT_DIR/.setup.log"

# Already installed and working?
if [ -f "$MARKER" ] && [ -f "$VENV_DIR/bin/python3" ]; then
    "$VENV_DIR/bin/python3" -c "import librosa" 2>/dev/null
    if [ $? -eq 0 ]; then
        echo "READY"
        exit 0
    fi
    rm -f "$MARKER"
fi

echo "INSTALLING"

# Find python3
PYTHON=""
for p in /usr/bin/python3 /usr/local/bin/python3 /opt/homebrew/bin/python3; do
    if [ -x "$p" ]; then
        PYTHON="$p"
        break
    fi
done

# If no python3 found, try to install Command Line Tools
if [ -z "$PYTHON" ]; then
    echo "INSTALLING_PYTHON"

    # Check if CLT are already installed but python3 just isn't in expected paths
    if xcode-select -p &>/dev/null; then
        # CLT installed but python3 not found — unusual
        echo "ERROR: Command Line Tools installed but Python 3 not found. Install Python from python.org"
        exit 1
    fi

    # Trigger the macOS Command Line Tools installer dialog
    # This opens a native macOS dialog asking the user to install
    xcode-select --install 2>/dev/null

    # Wait for installation to complete (user clicks Install in the dialog)
    echo "WAITING_FOR_PYTHON"
    WAIT_COUNT=0
    MAX_WAIT=120  # 10 minutes max (120 x 5 seconds)
    while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
        sleep 5
        WAIT_COUNT=$((WAIT_COUNT + 1))

        # Check if python3 appeared
        for p in /usr/bin/python3 /usr/local/bin/python3 /opt/homebrew/bin/python3; do
            if [ -x "$p" ]; then
                PYTHON="$p"
                break 2
            fi
        done
    done

    if [ -z "$PYTHON" ]; then
        echo "ERROR: Python 3 installation timed out. Open Terminal and run: xcode-select --install"
        exit 1
    fi

    echo "INSTALLING"
fi

# Create venv
rm -rf "$VENV_DIR"
"$PYTHON" -m venv "$VENV_DIR" >> "$LOG" 2>&1
if [ ! -f "$VENV_DIR/bin/pip" ]; then
    echo "ERROR: Failed to create Python environment. Check $LOG"
    exit 1
fi

# Install deps
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
"$VENV_DIR/bin/pip" install demucs librosa numpy scipy soundfile >> "$LOG" 2>&1

# Verify
"$VENV_DIR/bin/python3" -c "import demucs; import librosa; import numpy; import scipy" >> "$LOG" 2>&1
if [ $? -ne 0 ]; then
    echo "ERROR: Dependencies verification failed. Check $LOG"
    exit 1
fi

touch "$MARKER"
echo "READY"
