#!/usr/bin/env python3
"""Run Spleeter separation via Python API (not CLI)."""
import sys
import os
import json

os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

def main():
    if len(sys.argv) < 4:
        print(json.dumps({"error": "Usage: spleeter_run.py <input> <output_dir> <codec>"}))
        sys.exit(1)

    input_path = sys.argv[1]
    output_dir = sys.argv[2]
    codec = sys.argv[3] if len(sys.argv) > 3 else "wav"

    from spleeter.separator import Separator

    sep = Separator('spleeter:4stems')
    sep.separate_to_file(input_path, output_dir, codec=codec)
    print(json.dumps({"ok": True}))


if __name__ == '__main__':
    main()
