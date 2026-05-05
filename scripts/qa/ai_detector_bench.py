#!/usr/bin/env python3
"""
RTM Suite AI detector benchmark harness (v4.1).

- Runs the installed analyzer end-to-end on the 10 synthetic golden files
  plus 3 real human reference files.
- Prints a compact per-file table.
- Fits a provisional isotonic calibration curve (PAVA) from raw risk scores.
- Writes benchmark results to release/v4.0-rc2/ai-detector-bench.json.
- Writes the calibration curve JSON for source + installed detector copies.

Important:
The fitted curve is NOT deployment-grade. It is based on a tiny mixed corpus
(10 synthetics + 3 human tracks) and exists only as a stopgap for QA.
"""

from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np


PYTHON_BIN = "/Applications/RTM Suite.app/Contents/Resources/python-bundle/python/bin/python3"
ANALYZE_PY = "/Applications/RTM Suite.app/Contents/Resources/python/analyze.py"

SOURCE_CALIBRATION = Path("python/ai_detector_calibration_v4_1.json")
INSTALLED_CALIBRATION = Path("/Applications/RTM Suite.app/Contents/Resources/python/ai_detector_calibration_v4_1.json")
BENCH_OUTPUT = Path("release/v4.0-rc2/ai-detector-bench.json")

HUMAN_FILES = [
    "/Users/ohadnissim/Downloads/MIX.wav",
    "/Users/ohadnissim/Downloads/DEMO.wav",
    "/Users/ohadnissim/Downloads/119-waiting-kills-134-bpm-plxy.wav",
]


def _collect_dataset() -> list[dict]:
    matches = sorted(glob.glob("/tmp/rtm-qa-golden/[0-9][0-9]_*.wav"))
    by_index = {}
    for p in matches:
        name = os.path.basename(p)
        try:
            idx = int(name.split("_", 1)[0])
        except Exception:
            continue
        if 1 <= idx <= 10 and idx not in by_index:
            by_index[idx] = p

    golden = [by_index[i] for i in range(1, 11) if i in by_index]

    dataset = []
    for p in golden:
        dataset.append({"path": p, "label": 1, "kind": "golden_synthetic"})
    for p in HUMAN_FILES:
        dataset.append({"path": p, "label": 0, "kind": "real_human"})
    return dataset


def _parse_json_stdout(stdout_text: str) -> dict:
    lines = [ln.strip() for ln in stdout_text.splitlines() if ln.strip()]
    if not lines:
        raise RuntimeError("Analyzer returned no stdout JSON")

    # analyze.py emits one final JSON object on stdout.
    for line in reversed(lines):
        if line.startswith("{") and line.endswith("}"):
            return json.loads(line)
    raise RuntimeError("No JSON object found in analyzer stdout")


def _stderr_warnings(stderr_text: str) -> list[str]:
    warn_lines = []
    for line in stderr_text.splitlines():
        ln = line.strip()
        if not ln:
            continue
        if ln.startswith('{"type": "progress"'):
            continue
        if "WARNING" in ln or ln.startswith("[ai_detector]") or ln.startswith("[analyze] WARNING"):
            warn_lines.append(ln)
    return warn_lines


def _run_analyzer(path: str) -> dict:
    cmd = [PYTHON_BIN, ANALYZE_PY, path, path, "--fast", "--profile=off"]
    proc = subprocess.run(cmd, capture_output=True, text=True)

    result = {
        "cmd": cmd,
        "returncode": proc.returncode,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
    }

    if proc.returncode != 0:
        return result

    parsed = _parse_json_stdout(proc.stdout)
    result["parsed"] = parsed
    result["stderr_warning_lines"] = _stderr_warnings(proc.stderr)
    return result


def _fit_isotonic_pava(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if x.size != y.size or x.size == 0:
        raise ValueError("x/y must be non-empty and same length")

    order = np.argsort(x)
    x_sorted = x[order].astype(float)
    y_sorted = y[order].astype(float)

    blocks = []
    for idx, yi in enumerate(y_sorted):
        blocks.append({"start": idx, "end": idx, "w": 1.0, "sum": float(yi)})
        while len(blocks) >= 2:
            a = blocks[-2]
            b = blocks[-1]
            mean_a = a["sum"] / a["w"]
            mean_b = b["sum"] / b["w"]
            if mean_a <= mean_b:
                break
            merged = {
                "start": a["start"],
                "end": b["end"],
                "w": a["w"] + b["w"],
                "sum": a["sum"] + b["sum"],
            }
            blocks.pop()
            blocks.pop()
            blocks.append(merged)

    y_hat = np.zeros_like(y_sorted, dtype=float)
    for b in blocks:
        mean_val = b["sum"] / b["w"]
        y_hat[b["start"] : b["end"] + 1] = mean_val

    # Collapse duplicates in x.
    unique_x = []
    unique_y = []
    for xv in np.unique(x_sorted):
        m = x_sorted == xv
        unique_x.append(float(xv))
        unique_y.append(float(np.mean(y_hat[m])))

    x_curve = np.asarray(unique_x, dtype=float)
    y_curve = np.maximum.accumulate(np.asarray(unique_y, dtype=float))

    # Ensure full domain for interpolation.
    if x_curve[0] > 0.0:
        x_curve = np.insert(x_curve, 0, 0.0)
        y_curve = np.insert(y_curve, 0, y_curve[0])
    if x_curve[-1] < 1.0:
        x_curve = np.append(x_curve, 1.0)
        y_curve = np.append(y_curve, y_curve[-1])

    y_curve = np.clip(y_curve, 0.0, 1.0)
    y_curve = np.maximum.accumulate(y_curve)
    return x_curve, y_curve


def _write_calibration_curve(entries: list[dict], curve_x: np.ndarray, curve_y: np.ndarray) -> dict:
    generated_at = dt.datetime.now(dt.timezone.utc).isoformat()
    sample_count = len(entries)
    synthetic_count = sum(1 for e in entries if e["kind"] == "golden_synthetic")
    human_count = sum(1 for e in entries if e["kind"] == "real_human")

    payload = {
        "version": "ai-detector-v4.1-provisional-2026-04-25",
        "generated_at": generated_at,
        "method": "isotonic_regression_pava",
        "deployment_ready": False,
        "sample_count": sample_count,
        "training_counts": {
            "golden_synthetic": synthetic_count,
            "real_human": human_count,
        },
        "training_note": (
            "Provisional calibration only: fitted on 10 synthetic golden signals and 3 real human files. "
            "This is NOT deployment-grade. Retrain on a properly labelled real-world corpus "
            "(Suno/Udio/human across genres, codecs, and transformations) before using calibrated probabilities in production."
        ),
        "label_legend": {
            "golden_synthetic": 1,
            "real_human": 0,
        },
        "x": [round(float(v), 6) for v in curve_x],
        "y": [round(float(v), 6) for v in curve_y],
    }

    SOURCE_CALIBRATION.parent.mkdir(parents=True, exist_ok=True)
    INSTALLED_CALIBRATION.parent.mkdir(parents=True, exist_ok=True)

    SOURCE_CALIBRATION.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    INSTALLED_CALIBRATION.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def _shorten(path: str, max_len: int = 42) -> str:
    base = os.path.basename(path)
    return base if len(base) <= max_len else (base[: max_len - 1] + "…")


def _print_table(rows: list[dict]) -> None:
    print("\nAI Detector Benchmark (v4.1)\n")
    header = (
        f"{'#':>2}  {'file':<42}  {'label':<6}  {'raw':>5}  {'conf':>5}  "
        f"{'band':<6}  {'verdict':<13}  {'stderr_warns':>12}"
    )
    print(header)
    print("-" * len(header))
    for i, row in enumerate(rows, start=1):
        print(
            f"{i:>2}  {_shorten(row['path']):<42}  "
            f"{row['kind']:<6}  "
            f"{row.get('risk_score_raw', 0.0):>5.3f}  "
            f"{row.get('confidence', 0.0):>5.3f}  "
            f"{row.get('confidence_band', '-'): <6}  "
            f"{row.get('verdict', 'error'):<13}  "
            f"{len(row.get('stderr_warning_lines', [])):>12}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Run AI detector benchmark and update provisional calibration curve.")
    parser.add_argument("--no-calibration-update", action="store_true", help="Run benchmark without writing calibration JSON.")
    args = parser.parse_args()

    dataset = _collect_dataset()
    if len(dataset) != 13:
        print(f"Expected 13 files (10 golden + 3 human), found {len(dataset)}.", file=sys.stderr)

    rows = []
    raw_scores = []
    labels = []
    errors = []

    for item in dataset:
        path = item["path"]
        kind = item["kind"]
        label = item["label"]

        print(f"[bench] running: {path}", file=sys.stderr, flush=True)

        rec = {
            "path": path,
            "kind": kind,
            "label": label,
        }

        if not os.path.exists(path):
            rec["error"] = "file_not_found"
            errors.append((path, "file_not_found"))
            rows.append(rec)
            continue

        try:
            run = _run_analyzer(path)
            rec["returncode"] = run["returncode"]
            rec["stderr_warning_lines"] = run.get("stderr_warning_lines", [])

            if run["returncode"] != 0:
                rec["error"] = "analyzer_nonzero_exit"
                rec["stderr_tail"] = run.get("stderr", "")[-500:]
                errors.append((path, "analyzer_nonzero_exit"))
                rows.append(rec)
                continue

            parsed = run.get("parsed", {})
            ai = parsed.get("ai_detection") or {}

            rec.update(
                {
                    "risk_score_raw": float(ai.get("risk_score_raw", ai.get("probability", 0.0))),
                    "probability": float(ai.get("probability", 0.0)),
                    "risk_score_calibrated": float(ai.get("risk_score_calibrated", 0.0)),
                    "probability_calibrated": bool(ai.get("probability_calibrated", False)),
                    "confidence": float(ai.get("confidence", 0.0)),
                    "confidence_band": ai.get("confidence_band"),
                    "verdict": ai.get("verdict"),
                    "summary": ai.get("summary"),
                }
            )

            raw_scores.append(rec["risk_score_raw"])
            labels.append(float(label))

        except Exception as e:
            rec["error"] = str(e)
            errors.append((path, str(e)))

        rows.append(rec)

    _print_table(rows)

    bench_payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "analyzer": {
            "python_bin": PYTHON_BIN,
            "analyze_py": ANALYZE_PY,
            "args": ["--fast", "--profile=off"],
        },
        "dataset": {
            "golden_glob": ["/tmp/rtm-qa-golden/0[1-9]_*.wav", "/tmp/rtm-qa-golden/10_*.wav"],
            "human_files": HUMAN_FILES,
        },
        "results": rows,
        "errors": errors,
        "notes": [
            "Raw risk is heuristic and uncalibrated for production use.",
            "Calibration curve below is provisional due to tiny/non-representative corpus.",
        ],
    }

    calibration_payload = None
    if raw_scores and labels:
        x = np.asarray(raw_scores, dtype=float)
        y = np.asarray(labels, dtype=float)
        curve_x, curve_y = _fit_isotonic_pava(x, y)
        calibrated = np.interp(x, curve_x, curve_y)

        bench_payload["calibration_fit"] = {
            "method": "isotonic_regression_pava",
            "x": [round(float(v), 6) for v in curve_x],
            "y": [round(float(v), 6) for v in curve_y],
            "mae_on_fit": round(float(np.mean(np.abs(calibrated - y))), 6),
            "sample_count": int(len(x)),
            "deployment_ready": False,
            "warning": "Do not treat this as production calibration. Needs large labelled corpus.",
        }

        if not args.no_calibration_update:
            calibration_payload = _write_calibration_curve(rows, curve_x, curve_y)
            bench_payload["calibration_written"] = {
                "source": str(SOURCE_CALIBRATION),
                "installed": str(INSTALLED_CALIBRATION),
                "version": calibration_payload["version"],
            }

    BENCH_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    BENCH_OUTPUT.write_text(json.dumps(bench_payload, indent=2), encoding="utf-8")

    warn_count = sum(len(r.get("stderr_warning_lines", [])) for r in rows)
    print(f"\nWrote benchmark JSON: {BENCH_OUTPUT}")
    if calibration_payload is not None:
        print(f"Updated calibration JSON: {SOURCE_CALIBRATION} + {INSTALLED_CALIBRATION}")
    print(f"Total stderr warning lines: {warn_count}")

    if errors:
        print(f"Errors: {len(errors)}", file=sys.stderr)
        for p, e in errors:
            print(f"- {p}: {e}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
