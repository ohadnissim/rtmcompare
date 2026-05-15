"""
BWF (Broadcast Wave) metadata writer — embeds / updates BEXT + iXML
chunks in an existing WAV file.  Mastering-grade: atomic replace,
preserves every non-BEXT chunk, handles RIFF / RF64, leaves audio
samples untouched bit-for-bit.

Panel ask (Marek, mastering): "BWF metadata embedding is non-negotiable
for label delivery.  I shouldn't have to bounce through a separate tool."

What we write:

  * BEXT chunk (EBU TECH 3285 v2) — description, originator,
    originator_reference, origination_date, origination_time,
    UMID, coding_history.

  * iXML chunk (optional) — ISRC, project, notes, session-level
    metadata.  Minimal XML that survives the major DAWs' readers.

Everything else (data, fmt, fact, LIST-INFO, etc.) is preserved
verbatim.  We reject RF64 explicitly with a clear error because RF64
table offsets require bookkeeping beyond this module's scope.

Usage:
    python3 bwf_writer.py <path> <fields.json>
    # writes in place via atomic rename.  fields.json shape:
    # {
    #   "bext": {
    #     "description": "Master v3",
    #     "originator": "RTM Suite",
    #     "originator_reference": "...",
    #     "origination_date": "2026-04-18",
    #     "origination_time": "14:32:00",
    #     "umid": "HEXSTRING_OF_64_BYTES",
    #     "coding_history": "A=PCM,F=44100,W=24"
    #   },
    #   "ixml": {
    #     "ISRC": "USRC12345678",
    #     "PROJECT": "Album Name",
    #     "NOTE": "Mastered by X"
    #   }
    # }
"""
from __future__ import annotations

import json
import os
import re
import struct
import sys
import tempfile
from typing import Any


# ─── BEXT chunk layout ──────────────────────────────────────────────
# Per EBU TECH 3285 v2:
#   Description       256 bytes ASCII
#   Originator         32 bytes ASCII
#   OriginatorRef      32 bytes ASCII
#   OriginationDate    10 bytes yyyy-mm-dd
#   OriginationTime     8 bytes hh:mm:ss
#   TimeReference       8 bytes (u64) — low-part+high-part in v2
#   Version             2 bytes (u16)
#   UMID               64 bytes binary
#   LoudnessValue       2 bytes (i16, scaled by 100) — v2
#   LoudnessRange       2 bytes (i16, scaled by 100) — v2
#   MaxTruePeakLevel    2 bytes (i16, scaled by 100) — v2
#   MaxMomentaryLoudness 2 bytes (i16, scaled by 100) — v2
#   MaxShortTermLoudness 2 bytes (i16, scaled by 100) — v2
#   Reserved          180 bytes (zero)
#   CodingHistory     variable

def _fixed_ascii(s: str | None, length: int) -> bytes:
    data = (s or '').encode('latin-1', errors='replace')[:length]
    return data + b'\x00' * (length - len(data))


def _umid_to_64bytes(umid_str: str | None) -> bytes:
    """Accept a hex string (128 chars → 64 bytes) or raw ASCII (≤ 64).
    Zero-pads when empty / malformed."""
    if not umid_str:
        return b'\x00' * 64
    s = umid_str.strip()
    # 128-char hex (standard SMPTE UMID representation)
    if re.fullmatch(r'[0-9a-fA-F]{128}', s):
        return bytes.fromhex(s)
    # 64-byte raw hex (half-length UMID)
    if re.fullmatch(r'[0-9a-fA-F]{64}', s):
        return bytes.fromhex(s) + b'\x00' * 32
    # Treat as freeform ASCII up to 64 bytes (some tools write this way).
    b = s.encode('latin-1', errors='replace')[:64]
    return b + b'\x00' * (64 - len(b))


def build_bext_chunk(fields: dict) -> bytes:
    """Serialise a BEXT chunk payload (without the 4-byte id + size header)."""
    desc = _fixed_ascii(fields.get('description'), 256)
    origin = _fixed_ascii(fields.get('originator'), 32)
    origin_ref = _fixed_ascii(fields.get('originator_reference'), 32)
    date = _fixed_ascii(fields.get('origination_date'), 10)
    time = _fixed_ascii(fields.get('origination_time'), 8)

    # TimeReference — 64-bit sample count. We keep whatever the user
    # supplied, else zero. Represented as two u32s (low/high) in the
    # on-disk layout but easier to pack as one u64 here.
    time_ref = int(fields.get('time_reference') or 0)
    time_ref_bytes = struct.pack('<Q', time_ref & 0xFFFFFFFFFFFFFFFF)

    version = struct.pack('<H', int(fields.get('version') or 2))
    umid = _umid_to_64bytes(fields.get('umid'))

    # v2 loudness fields: i16 scaled by 100. None → 0 (matches the
    # "not-measured" convention most DAWs use).
    def _loudness(v: Any) -> bytes:
        if v is None:
            return struct.pack('<h', 0)
        try:
            return struct.pack('<h', int(round(float(v) * 100)))
        except Exception:
            return struct.pack('<h', 0)

    loud_val = _loudness(fields.get('loudness_value'))
    loud_rng = _loudness(fields.get('loudness_range'))
    max_tp   = _loudness(fields.get('max_true_peak'))
    max_mom  = _loudness(fields.get('max_momentary'))
    max_st   = _loudness(fields.get('max_short_term'))

    reserved = b'\x00' * 180
    coding_history = (fields.get('coding_history') or '').encode('latin-1', errors='replace')
    # Coding history must end with \r\n per spec; ensure it.
    if coding_history and not coding_history.endswith(b'\r\n'):
        coding_history += b'\r\n'

    payload = (
        desc + origin + origin_ref + date + time + time_ref_bytes + version
        + umid + loud_val + loud_rng + max_tp + max_mom + max_st + reserved
        + coding_history
    )
    return payload


def build_ixml_chunk(fields: dict) -> bytes:
    """Minimal iXML payload — BWF chunk id 'iXML', UTF-8 XML body.
    We preserve the caller's field names as top-level tags under
    <BWFXML>.  Format is what ProTools / Nuendo / Reaper all read."""
    if not fields:
        return b''
    parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<BWFXML>']
    for k, v in fields.items():
        tag = re.sub(r'[^A-Za-z0-9_]', '_', str(k))
        text = str(v).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        parts.append(f'  <{tag}>{text}</{tag}>')
    parts.append('</BWFXML>')
    xml = '\n'.join(parts).encode('utf-8')
    return xml


def _write_chunk(fh, cid: bytes, payload: bytes) -> None:
    """Write a RIFF chunk with WORD-aligned size padding."""
    assert len(cid) == 4
    fh.write(cid)
    fh.write(struct.pack('<I', len(payload)))
    fh.write(payload)
    if len(payload) & 1:
        fh.write(b'\x00')


def patch_bwf(src_path: str, out_path: str, bext_fields: dict | None,
              ixml_fields: dict | None) -> dict:
    """Rewrite a WAV file with updated BEXT / iXML chunks.  Preserves
    every non-target chunk in order.  Returns dict with size + status."""
    with open(src_path, 'rb') as fh:
        header = fh.read(12)
        if len(header) < 12 or header[0:4] not in (b'RIFF', b'RF64'):
            return {"ok": False, "error": "not a RIFF / WAV file"}
        if header[0:4] == b'RF64':
            return {"ok": False, "error": "RF64 not supported (file > 4 GB with sz64 table)"}
        if header[8:12] != b'WAVE':
            return {"ok": False, "error": "RIFF container is not WAVE"}

        # Walk chunks.  We keep every non-bext / non-iXML chunk
        # verbatim, then we'll append the fresh bext / iXML.  Many
        # readers require bext to appear BEFORE data; we insert at
        # position 0 of the preserved list so it lands first after
        # the RIFF header.
        preserved: list[tuple[bytes, bytes]] = []
        while True:
            cid = fh.read(4)
            if len(cid) < 4:
                break
            size_bytes = fh.read(4)
            if len(size_bytes) < 4:
                break
            (size,) = struct.unpack('<I', size_bytes)
            data = fh.read(size)
            # Skip pad byte
            if size & 1:
                fh.read(1)
            if cid in (b'bext', b'iXML'):
                continue  # drop; we're rewriting
            preserved.append((cid, data))

    # Rebuild the BEXT / iXML payloads.
    new_chunks: list[tuple[bytes, bytes]] = []
    if bext_fields is not None:
        new_chunks.append((b'bext', build_bext_chunk(bext_fields)))
    if ixml_fields:
        ixml_body = build_ixml_chunk(ixml_fields)
        if ixml_body:
            new_chunks.append((b'iXML', ixml_body))

    # Data chunk MUST come after metadata chunks.  We insert the new
    # ones BEFORE 'data' in the preserved list.
    data_idx = next((i for i, (cid, _) in enumerate(preserved) if cid == b'data'), None)
    if data_idx is None:
        return {"ok": False, "error": "no data chunk found"}
    combined = preserved[:data_idx] + new_chunks + preserved[data_idx:]

    # Serialise to a tmp file next to the output, then atomic rename.
    tmp_fd, tmp_path = tempfile.mkstemp(suffix='.wav', dir=os.path.dirname(out_path) or None)
    try:
        with os.fdopen(tmp_fd, 'wb') as out:
            # We don't know the total RIFF size yet; write placeholders,
            # then patch.
            out.write(b'RIFF\x00\x00\x00\x00WAVE')
            for cid, payload in combined:
                _write_chunk(out, cid, payload)
            end = out.tell()
            out.seek(4)
            out.write(struct.pack('<I', end - 8))
        os.replace(tmp_path, out_path)
    except Exception as e:
        try: os.unlink(tmp_path)
        except OSError: pass
        return {"ok": False, "error": f"write failed: {e}"}

    return {"ok": True, "path": out_path, "bytes": os.path.getsize(out_path)}


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "usage: bwf_writer.py <path> <fields.json>"}))
        sys.exit(1)
    path = sys.argv[1]
    with open(sys.argv[2], 'r', encoding='utf-8') as f:
        fields = json.load(f)
    out_path = sys.argv[3] if len(sys.argv) > 3 else path
    print(json.dumps(patch_bwf(
        path, out_path,
        fields.get('bext'),
        fields.get('ixml'),
    )))
