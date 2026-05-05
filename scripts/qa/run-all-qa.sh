#!/usr/bin/env bash
#
# RTM Suite — top-level QA gate.
# Runs every automated check.  Exit 0 = clean, 1 = at least one FAIL.
# Suitable for `npm run qa` or a pre-ship git hook.

set -u
cd "$(dirname "$0")/../.."

FAIL=0
section () { echo; echo "==================================="; echo "  $1"; echo "==================================="; }

section "PLUG-IN TEXT SCAN"
bash scripts/qa/plugin-text-scan.sh || FAIL=1

section "PLUG-IN BUILD VALIDATE"
bash scripts/qa/plugin-build-validate.sh || FAIL=1

# Only run integration smoke if app is running — otherwise it exits 2
# (skipped), which we don't count as a failure.
if pgrep -fq "RTM Suite" || pgrep -fq "rtm-suite"; then
    section "APP INTEGRATION SMOKE"
    bash scripts/qa/app-integration-smoke.sh || FAIL=1
else
    section "APP INTEGRATION SMOKE - skipped (RTM Suite not running)"
fi

echo
if [ $FAIL -eq 0 ]; then
    echo ">>> ALL AUTOMATED QA GATES PASS <<<"
    exit 0
else
    echo ">>> QA FAILED - DO NOT SHIP <<<"
    exit 1
fi
