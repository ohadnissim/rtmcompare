#!/usr/bin/env python3.12
"""Strip narration from all v15.x deliverables. Replace audio with TOO HIGH music only."""
import subprocess
from pathlib import Path
import os

CLIPS = Path("/Users/ohadnissim/Downloads/Compare App/commercial-clips")
AUDIO = "/Users/ohadnissim/Dropbox/Work/Mastered/JIGI - EP/Masters/M1.1/01 TOO HIGH (MAIN) M1 29-04-2026.wav"

# Audio offset per variant (seconds into source song)
OFFSETS = {
    "90s":  13.0,        # full intro+drop
    "60s":  13.0,        # full intro+drop
    "30s":  13.0 + 35,   # hot section (drum drop already passed)
    "15s":  13.0 + 47,   # punchier section
}


def probe_dur(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True)
    return float(r.stdout.strip()) if r.returncode == 0 else 90.0


def strip_voice(src, dst):
    dur = probe_dur(src)
    # detect length variant from filename
    name = src.stem
    offset = None
    for tag, off in OFFSETS.items():
        if tag in name:
            offset = off
            break
    if offset is None:
        offset = 13.0

    fade_out = max(0, dur - 1.5)
    cmd = [
        "ffmpeg", "-y",
        "-i", str(src),
        "-ss", str(offset), "-t", str(dur), "-i", AUDIO,
        "-filter_complex",
        f"[1:a]aresample=44100,aformat=channel_layouts=stereo,volume=1.0,"
        f"afade=t=in:st=0:d=0.4,afade=t=out:st={fade_out}:d=1.5[a]",
        "-map", "0:v",
        "-map", "[a]",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "256k",
        "-t", str(dur),
        "-shortest",
        str(dst),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"FAIL {src.name}:", r.stderr[-500:])
        return False
    return True


def main():
    targets = sorted(CLIPS.glob("RTMcompare-v15.[12]-*.mp4"))
    tmp = CLIPS / "_tmp_silenced"
    tmp.mkdir(exist_ok=True)
    for src in targets:
        out_tmp = tmp / src.name
        print(f"  {src.name} ...", end=" ", flush=True)
        if strip_voice(src, out_tmp):
            # replace original
            os.replace(out_tmp, src)
            print(f"✓ {os.path.getsize(src)/1e6:.1f} MB")
        else:
            print("FAIL")
    tmp.rmdir()
    print(f"\nDone. {len(targets)} files re-encoded.")


if __name__ == "__main__":
    main()
