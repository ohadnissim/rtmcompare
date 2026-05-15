"""
Broadcast WAV metadata reader — parses BEXT, iXML, LIST-INFO, and ID3 chunks
out of a WAV/BWF file. Used for delivery QC: programme titles, ISRCs,
engineer / originator info, etc.

All parsing is done directly from the file bytes (no external deps beyond
the stdlib) to keep the bundle light.
"""

import logging
import os
import struct
import sys
from typing import Optional

# Parse failures inside individual chunk helpers return {} so the outer
# read_delivery_fields call doesn't blow up on one bad chunk, but every
# failure is logged here so beta testers + support can tell whether an
# empty dict means "no data" vs "corrupt chunk swallowed".
_log = logging.getLogger(__name__)
if not _log.handlers:
    _h = logging.StreamHandler(sys.stderr)
    _h.setFormatter(logging.Formatter("[metadata_reader] %(levelname)s: %(message)s"))
    _log.addHandler(_h)
    _log.setLevel(logging.WARNING)


def _read_chunks(path: str) -> dict:
    """
    Walk a RIFF/RF64 WAVE file and return a dict of {chunk_id: chunk_bytes}
    for metadata-bearing chunks we care about.
    """
    chunks: dict = {}
    try:
        with open(path, "rb") as f:
            header = f.read(12)
            if len(header) < 12:
                return chunks
            riff, _, wave = struct.unpack("<4sI4s", header)
            if riff not in (b"RIFF", b"RF64") or wave != b"WAVE":
                return chunks
            # If RF64, the first chunk after header is "ds64" (skip it)
            while True:
                hdr = f.read(8)
                if len(hdr) < 8:
                    break
                cid, size = struct.unpack("<4sI", hdr)
                data = f.read(size)
                if cid in (b"bext", b"iXML", b"LIST", b"ID3 ", b"id3 ", b"axml"):
                    chunks[cid.decode("ascii", errors="ignore").strip()] = data
                # word-align
                if size % 2 == 1:
                    f.read(1)
    except Exception as e:
        _log.warning("RIFF walk failed on %s: %s", path, e)
        return chunks
    return chunks


def _parse_bext(data: bytes) -> dict:
    """EBU TECH 3285 bext chunk."""
    if len(data) < 256:
        return {}
    try:
        description = data[0:256].rstrip(b"\x00").decode("latin-1", errors="replace").strip()
        originator  = data[256:288].rstrip(b"\x00").decode("latin-1", errors="replace").strip()
        originator_ref = data[288:320].rstrip(b"\x00").decode("latin-1", errors="replace").strip()
        origination_date = data[320:330].decode("latin-1", errors="replace").strip()
        origination_time = data[330:338].decode("latin-1", errors="replace").strip()
        # time reference (64-bit sample count) — not critical
        umid = data[346:410].hex() if len(data) >= 410 else ""
        # coding history starts at byte 602
        coding_history = ""
        if len(data) > 602:
            coding_history = data[602:].rstrip(b"\x00").decode("latin-1", errors="replace").strip()
        return {
            "description": description,
            "originator": originator,
            "originator_reference": originator_ref,
            "origination_date": origination_date,
            "origination_time": origination_time,
            "umid": umid[:32] + "…" if umid else "",
            "coding_history": coding_history[:2000],
            "coding_history_parsed": _parse_coding_history(coding_history),
        }
    except Exception as e:
        _log.warning("bext parse failed: %s", e)
        return {}


def _parse_coding_history(text: str) -> list:
    """
    Parse BEXT coding history per EBU TECH 3285 Annex 1.
    Each line typically looks like:
        A=PCM,F=48000,W=24,M=stereo,T=Logic Pro 10.7.5
    Returns a list of dicts keyed by the single-letter field tags:
        A = algorithm / format
        F = sample rate in Hz
        B = bit rate (for compressed formats)
        W = word length / bit depth
        M = mode (mono, stereo, dual-mono, joint-stereo)
        T = text / free-form note (often DAW name)
    """
    if not text:
        return []
    lines = [l.strip() for l in text.replace("\r\n", "\n").split("\n") if l.strip()]
    key_names = {"A": "algorithm", "F": "sample_rate", "B": "bit_rate",
                 "W": "bit_depth", "M": "mode", "T": "text"}
    out = []
    for line in lines:
        entry = {"raw": line}
        for part in line.split(","):
            part = part.strip()
            if "=" in part:
                k, v = part.split("=", 1)
                k = k.strip().upper()[:1]
                v = v.strip()
                if k in key_names:
                    entry[key_names[k]] = v
        if len(entry) > 1:  # Contains more than just raw
            out.append(entry)
    return out


# ── ID3v2 (MP3) tag reader ───────────────────────────────────────────────────
#
# Minimal ID3v2.3 / ID3v2.4 parser — no external deps. We only pull out the
# frames that label ops / DDEX ingestion actually care about:
#   TIT2  song title
#   TPE1  artist / lead performer
#   TPE2  album artist
#   TALB  album
#   TRCK  track number
#   TYER  year  (v2.3)
#   TDRC  recording date (v2.4)
#   TCON  genre
#   TSRC  ISRC
#   TCOP  copyright
#   TSSE  encoder / software
#   TENC  encoded by
#   COMM  comment
def _read_id3v2(path: str) -> dict:
    try:
        with open(path, "rb") as f:
            head = f.read(10)
            if len(head) < 10 or head[0:3] != b"ID3":
                return {}
            version = (head[3], head[4])
            flags = head[5]
            # Size is synchsafe (7 bits per byte)
            size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9]
            unsync = bool(flags & 0x80)
            body = f.read(size)
            if unsync:
                # Remove 0xFF 0x00 → 0xFF un-sync padding
                body = body.replace(b"\xff\x00", b"\xff")

            frames = {}
            i = 0
            while i + 10 <= len(body):
                frame_id = body[i:i+4]
                if frame_id == b"\x00\x00\x00\x00":
                    break
                if version[0] >= 4:
                    # synchsafe frame size in v2.4
                    frame_size = ((body[i+4] & 0x7f) << 21) | ((body[i+5] & 0x7f) << 14) | ((body[i+6] & 0x7f) << 7) | (body[i+7] & 0x7f)
                else:
                    frame_size = struct.unpack(">I", body[i+4:i+8])[0]
                # frame_flags = body[i+8:i+10]
                frame_data = body[i+10:i+10+frame_size]
                i += 10 + frame_size

                fid = frame_id.decode("ascii", errors="ignore")
                if fid.startswith("T") and frame_data:
                    encoding = frame_data[0]
                    payload = frame_data[1:]
                    frames[fid] = _decode_id3_text(encoding, payload)
                elif fid == "COMM" and len(frame_data) > 4:
                    # Encoding byte + 3-byte lang + short description\0 + text
                    encoding = frame_data[0]
                    rest = frame_data[4:]
                    # Short description then actual text, separated by \0 (or \0\0 for UTF-16)
                    if encoding in (1, 2):
                        sep = b"\x00\x00"
                    else:
                        sep = b"\x00"
                    parts = rest.split(sep, 1)
                    text = parts[1] if len(parts) > 1 else parts[0]
                    frames["COMM"] = _decode_id3_text(encoding, text)

            keymap = {
                "TIT2": "title", "TPE1": "artist", "TPE2": "album_artist",
                "TALB": "album", "TRCK": "track", "TYER": "year",
                "TDRC": "date", "TSRC": "isrc",  # 5.2.3: TCON/genre stripped
                "TCOP": "copyright", "TSSE": "software", "TENC": "encoded_by",
                "COMM": "comment",
            }
            out = {}
            for fid, label in keymap.items():
                if fid in frames and frames[fid]:
                    out[label] = frames[fid]
            return out
    except Exception as e:
        _log.warning("ID3v2 parse failed on %s: %s", path, e)
        return {}


def _decode_id3_text(encoding: int, data: bytes) -> str:
    """Decode an ID3 text frame payload by the encoding byte.
    Aggressively strips embedded null bytes — some DAWs (Logic, ProTools)
    write double-null padding that survives .rstrip and breaks downstream
    ISRC validation / DDEX ingestion."""
    try:
        data = data.rstrip(b"\x00")
        if encoding == 0:
            s = data.decode("latin-1", errors="replace")
        elif encoding == 1:
            s = data.decode("utf-16", errors="replace")
        elif encoding == 2:
            s = data.decode("utf-16-be", errors="replace")
        elif encoding == 3:
            s = data.decode("utf-8", errors="replace")
        else:
            return ""
        # Strip any remaining embedded nulls (some writers put them between words)
        s = s.replace("\x00", "").strip()
        return s
    except Exception as e:
        _log.warning("ID3 text decode failed (encoding=%s): %s", encoding, e)
        return ""


def _parse_ixml(data: bytes) -> dict:
    """Extract common iXML fields (project, scene, take, notes)."""
    try:
        text = data.rstrip(b"\x00").decode("utf-8", errors="replace")
        # Very light XML extraction — avoid pulling in a full parser
        import re
        def _find(tag):
            m = re.search(r"<" + tag + r">([^<]*)</" + tag + r">", text, flags=re.IGNORECASE)
            return m.group(1).strip() if m else ""
        return {
            "project": _find("PROJECT"),
            "scene": _find("SCENE"),
            "take": _find("TAKE"),
            "note": _find("NOTE"),
            "isrc": _find("ISRC"),
        }
    except Exception as e:
        _log.warning("iXML parse failed: %s", e)
        return {}


def _parse_list_info(data: bytes) -> dict:
    """LIST chunk with INFO subchunks (IART, INAM, IPRD, ICRD, ICOP, ...)."""
    out = {}
    if len(data) < 4 or data[0:4] != b"INFO":
        return out
    i = 4
    keymap = {
        "INAM": "title", "IART": "artist", "IPRD": "album",
        "ICRD": "date", "ITRK": "track",  # 5.2.3: IGNR/genre stripped
        "ICOP": "copyright", "ISFT": "software", "ICMT": "comment",
        "IENG": "engineer", "ISRC": "source",
    }
    while i + 8 <= len(data):
        cid = data[i:i+4].decode("ascii", errors="ignore")
        size = struct.unpack("<I", data[i+4:i+8])[0]
        i += 8
        value = data[i:i+size].rstrip(b"\x00").decode("latin-1", errors="replace").strip()
        if cid in keymap:
            out[keymap[cid]] = value
        i += size
        if size % 2 == 1:
            i += 1
    return out


def _extract_explicit_from(text: str) -> Optional[bool]:
    """Heuristic explicit-flag detection from a free-form text field.
    Labels put "Explicit" / "Clean" / "[Explicit]" / "Advisory: Explicit"
    inside BWF bext.description + iXML NOTE tags — no standard for WAV,
    so we pattern-match the common conventions."""
    if not text:
        return None
    t = text.lower()
    if "not explicit" in t or "notexplicit" in t:
        return False
    if "[explicit]" in t or "explicit content" in t or "advisory: explicit" in t:
        return True
    if "[clean]" in t or "advisory: clean" in t:
        return False
    return None


def read_delivery_fields(path: str) -> dict:
    """
    Flat-dict helper for the DMR flow — returns the union of
    ISRC / UPC / title / artist / album / track / explicit / p_line / c_line
    pulled from BWF bext + iXML + LIST-INFO + ID3v2 chunks, with sensible
    cross-chunk fall-through. Safe to call on any file — returns {} on
    failure rather than raising.

    Distinct from read_metadata (which keeps the nested-by-chunk shape for
    UI surfaces that want to render provenance). Keep both — the DMR
    pipeline + batch_analyze use this flat shape because the call sites
    only care "what does the file claim about its release?".
    """
    out: dict = {
        "isrc": None, "upc": None, "title": None, "artist": None,
        "album": None, "track": None,
        "explicit": None, "p_line": None, "c_line": None,
    }
    lower = path.lower()

    # ── WAV / BWF / RF64 ────────────────────────────────────────────────
    if lower.endswith((".wav", ".bwf", ".rf64")):
        chunks = _read_chunks(path)
        bext = _parse_bext(chunks.get("bext", b"")) if chunks.get("bext") else {}
        ixml = _parse_ixml(chunks.get("iXML", b"")) if chunks.get("iXML") else {}
        info = _parse_list_info(chunks.get("LIST", b"")) if chunks.get("LIST") else {}
        # LIST-INFO has title/artist/album; iXML carries engineer's ISRC.
        out["isrc"] = out["isrc"] or ixml.get("isrc") or info.get("source")
        out["title"] = out["title"] or info.get("title")
        out["artist"] = out["artist"] or info.get("artist")
        out["album"] = out["album"] or info.get("album")
        out["track"] = out["track"] or info.get("track")
        # P-line: prefer LIST ICOP (engineers put copyright there). Strip (P) marker.
        if info.get("copyright"):
            out["p_line"] = info["copyright"].strip()
        # Explicit: scan bext.description + iXML <NOTE>.
        for candidate in (bext.get("description"), ixml.get("note")):
            if candidate:
                val = _extract_explicit_from(candidate)
                if val is not None:
                    out["explicit"] = val
                    break
        # Some BWF engineers also stash copyright / "(C) 2026 Label" in the
        # bext description. Extract any © marker into c_line, ℗ into p_line.
        desc = (bext.get("description") or "") + " " + (ixml.get("note") or "")
        if not out["p_line"]:
            import re as _re
            m = _re.search(r"[℗(P)]\s*(\d{4}[^.;\n]+)", desc, _re.IGNORECASE)
            if m:
                out["p_line"] = m.group(0).strip()
        if not out["c_line"]:
            import re as _re
            m = _re.search(r"[©(C)]\s*(\d{4}[^.;\n]+)", desc, _re.IGNORECASE)
            if m:
                out["c_line"] = m.group(0).strip()
        # Some software writes ID3 chunks into WAV — fall through to ID3 too.
        if "ID3" in chunks or "id3" in chunks:
            id3 = _read_id3v2(path) or {}
            _merge_id3_into_flat(out, id3)

    # ── MP3 / FLAC (ID3v2 at front of file) ─────────────────────────────
    elif lower.endswith((".mp3", ".flac")):
        id3 = _read_id3v2(path) or {}
        _merge_id3_into_flat(out, id3)

    # ── Decoded duration enforcement ─────────────────────────────────────
    # Always run for WAV/BWF/RF64 where tag-vs-physical mismatches occur.
    # Skipped silently for formats soundfile can't open (returns {"error": ...}).
    out["duration_check"] = check_decoded_duration(path)

    return out


def _merge_id3_into_flat(out: dict, id3: dict) -> None:
    """Coalesce ID3v2 frames into the flat delivery-fields dict. Each field
    only gets populated if out[field] is still None — prior-read BWF fields
    win because the engineer wrote them more recently in the pipeline."""
    out["isrc"] = out["isrc"] or id3.get("isrc")
    out["title"] = out["title"] or id3.get("title")
    out["artist"] = out["artist"] or id3.get("artist") or id3.get("album_artist")
    out["album"] = out["album"] or id3.get("album")
    out["track"] = out["track"] or id3.get("track")
    # TCOP is the standard copyright frame — used for p-line by convention.
    if id3.get("copyright") and not out["p_line"]:
        out["p_line"] = id3["copyright"].strip()
    # ID3 doesn't have a dedicated explicit frame. Check the comment + copyright
    # fields for one of the common label conventions.
    for candidate in (id3.get("comment"), id3.get("copyright"), id3.get("title")):
        if candidate and out["explicit"] is None:
            val = _extract_explicit_from(candidate)
            if val is not None:
                out["explicit"] = val
                break


def check_decoded_duration(path: str) -> dict:
    """Compare tag-reported duration against physically-decoded duration.

    Tag duration comes from the RIFF data chunk size calculation or WAV fmt chunk.
    Decoded duration = total_frames / sample_rate (the physical truth).

    A discrepancy > 500 ms is suspicious: either the tag was hand-edited,
    the file was truncated post-encode, or a metadata tool wrote bad headers.

    Returns dict with:
      - decoded_duration_s: float — duration from pcm frame count
      - tag_duration_s: float | None — duration from RIFF chunk sizes (if parseable)
      - discrepancy_ms: float | None — abs(decoded - tag) * 1000
      - flag: bool — True if discrepancy > 500 ms
      - note: str
    """
    result: dict = {}
    try:
        import soundfile as sf  # type: ignore
        info = sf.info(path)
        decoded_duration = info.frames / info.samplerate
        result["decoded_duration_s"] = round(decoded_duration, 4)
        result["sample_rate"] = info.samplerate
        result["channels"] = info.channels
        result["frames"] = info.frames
    except Exception as e:
        return {"error": f"soundfile.info failed: {e}"}

    # Compute tag-based duration from RIFF data chunk size
    tag_duration: float | None = None
    try:
        with open(path, "rb") as f:
            import struct as _struct
            header = f.read(12)
            if len(header) >= 12:
                riff, file_size, wave = _struct.unpack("<4sI4s", header)
                if riff in (b"RIFF", b"RF64") and wave == b"WAVE":
                    sr_tag: int | None = None
                    block_align: int | None = None
                    data_size: int | None = None
                    while True:
                        hdr = f.read(8)
                        if len(hdr) < 8:
                            break
                        cid, size = _struct.unpack("<4sI", hdr)
                        if cid == b"fmt ":
                            fmt = f.read(min(size, 40))
                            if len(fmt) >= 16:
                                sr_tag = _struct.unpack_from("<I", fmt, 4)[0]
                                block_align = _struct.unpack_from("<H", fmt, 12)[0]
                        elif cid == b"data":
                            data_size = size
                            break
                        else:
                            f.seek(size + (size % 2), 1)
                    if sr_tag and block_align and data_size and block_align > 0 and sr_tag > 0:
                        tag_frames = data_size // block_align
                        tag_duration = tag_frames / sr_tag
    except Exception:
        pass

    if tag_duration is not None:
        result["tag_duration_s"] = round(tag_duration, 4)
        disc = abs(result["decoded_duration_s"] - tag_duration)
        result["discrepancy_ms"] = round(disc * 1000, 1)
        result["flag"] = disc > 0.5  # > 500 ms
        if result["flag"]:
            result["note"] = (
                f"Duration mismatch: decoded {result['decoded_duration_s']:.3f}s vs "
                f"tag {tag_duration:.3f}s (delta {result['discrepancy_ms']:.0f} ms). "
                "File may be truncated or have corrupt RIFF headers."
            )
        else:
            result["note"] = f"Duration consistent (delta {result['discrepancy_ms']:.0f} ms)."
    else:
        result["tag_duration_s"] = None
        result["discrepancy_ms"] = None
        result["flag"] = False
        result["note"] = "Could not parse RIFF headers for tag-duration comparison."

    return result


def read_metadata(path: str) -> Optional[dict]:
    """
    Read BEXT / iXML / LIST-INFO from WAV/BWF or ID3v2 from MP3/FLAC.
    Returns None if nothing interesting was found.
    """
    lower = path.lower()
    result: dict = {}

    if lower.endswith((".wav", ".bwf", ".rf64")):
        chunks = _read_chunks(path)
        if chunks:
            if "bext" in chunks:
                result["bext"] = _parse_bext(chunks["bext"])
            if "iXML" in chunks:
                result["ixml"] = _parse_ixml(chunks["iXML"])
            if "LIST" in chunks:
                info = _parse_list_info(chunks["LIST"])
                if info:
                    result["info"] = info
            # Some software writes ID3 chunks into WAV — surface too
            if "ID3" in chunks or "id3" in chunks:
                id3 = _read_id3v2(path)  # Easier to re-read via file parser
                if id3:
                    result.setdefault("info", {}).update(id3)

    elif lower.endswith((".mp3", ".flac")):
        # ID3v2 sits at the start of MP3 files; FLAC can also carry an ID3v2
        # prepended before the 'fLaC' marker (non-standard but common in the wild).
        id3 = _read_id3v2(path)
        if id3:
            result["id3"] = id3

    if not result:
        return None

    # Add file size
    try:
        result["file_bytes"] = os.path.getsize(path)
    except Exception as e:
        _log.warning("stat(%s) failed: %s", path, e)

    return result
