"""License, trial, and report fingerprint helpers."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional, Tuple

from ._runtime import file_sha256


# ─── Trial Configuration ────────────────────────────────────────────────────

TRIAL_DAYS = 15


def _trial_data_path() -> Path:
    """Path to the trial state file."""
    if platform.system() == "Darwin":
        return Path.home() / "Library" / "Application Support" / "UAI" / ".state"
    if platform.system() == "Windows":
        base = Path(os.getenv("APPDATA", str(Path.home())))
        return base / "UAI" / ".state"
    return Path.home() / ".uai" / ".state"


def _encode_state(data: dict) -> str:
    """Lightly obfuscate trial state so casual users can't just edit the date."""
    raw = json.dumps(data, sort_keys=True)
    # Simple XOR obfuscation (not crypto — just discourages casual edits)
    key = b"UAI_TRIAL_2026"
    encoded = bytes(b ^ key[i % len(key)] for i, b in enumerate(raw.encode("utf-8")))
    return encoded.hex()


def _decode_state(hex_str: str) -> dict:
    """Decode obfuscated trial state."""
    key = b"UAI_TRIAL_2026"
    decoded = bytes(b ^ key[i % len(key)] for i, b in enumerate(bytes.fromhex(hex_str)))
    return json.loads(decoded.decode("utf-8"))


def _get_trial_state() -> dict:
    """Read or initialize the trial state."""
    path = _trial_data_path()

    if path.exists():
        try:
            hex_data = path.read_text(encoding="utf-8").strip()
            state = _decode_state(hex_data)
            # Validate structure
            if "install_date" in state and "machine_id" in state:
                return state
        except Exception:
            pass

    # First launch — initialize trial
    machine_id = hashlib.sha256(
        f"{platform.node()}:{platform.machine()}:{uuid.getnode()}".encode()
    ).hexdigest()[:16]

    state = {
        "install_date": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "machine_id": machine_id,
        "trial_days": TRIAL_DAYS,
        "license_key": None,
    }

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_encode_state(state), encoding="utf-8")
    return state


def check_trial() -> dict:
    """
    Check trial status.

    Returns dict with:
        valid: bool — whether the app should run
        days_remaining: int — days left in trial
        expired: bool — whether trial has expired
        licensed: bool — whether a license key is active
        message: str — human-readable status
    """
    state = _get_trial_state()

    # Licensed users bypass trial
    if state.get("license_key") and validate_license_key(state["license_key"]):
        return {
            "valid": True,
            "days_remaining": 999,
            "expired": False,
            "licensed": True,
            "message": "Licensed",
        }

    # Calculate trial expiry
    install_date = datetime.fromisoformat(state["install_date"])
    trial_end = install_date + timedelta(days=state.get("trial_days", TRIAL_DAYS))
    now = datetime.now(timezone.utc)
    remaining = (trial_end - now).total_seconds()
    days_remaining = max(0, int(remaining / 86400))

    if remaining <= 0:
        return {
            "valid": False,
            "days_remaining": 0,
            "expired": True,
            "licensed": False,
            "message": f"Trial expired. Your {TRIAL_DAYS}-day trial ended on {trial_end.strftime('%B %d, %Y')}.",
        }

    return {
        "valid": True,
        "days_remaining": days_remaining,
        "expired": False,
        "licensed": False,
        "message": f"{days_remaining} days remaining in trial",
    }


def activate_license(license_key: str) -> bool:
    """Activate a license key, disabling the trial timer."""
    if not validate_license_key(license_key):
        return False

    state = _get_trial_state()
    state["license_key"] = license_key

    path = _trial_data_path()
    path.write_text(_encode_state(state), encoding="utf-8")
    return True


# ─── License Validation ─────────────────────────────────────────────────────

def validate_license_key(license_key: Optional[str] = None) -> bool:
    """Validate a license key. Placeholder for future signed-license workflow."""
    if not license_key:
        return False
    # Future: validate against server or signed token
    # For now, accept any non-empty key with correct format
    return len(license_key) >= 16 and license_key.startswith("UAI-")


# ─── Installation ID ────────────────────────────────────────────────────────

def _install_id_path() -> Path:
    configured = os.getenv("UAI_INSTALL_ID_FILE")
    if configured:
        return Path(configured).expanduser()

    if platform.system() == "Darwin":
        return Path.home() / "Library" / "Application Support" / "UAI" / "install.id"
    if platform.system() == "Windows":
        base = Path(os.getenv("APPDATA", str(Path.home())))
        return base / "UAI" / "install.id"
    return Path.home() / ".uai" / "install.id"


def installation_id() -> str:
    """Return a stable local installation identifier."""
    override = os.getenv("UAI_INSTALL_ID")
    if override:
        return override.strip()

    path = _install_id_path()
    try:
        if path.exists():
            value = path.read_text(encoding="utf-8").strip()
            if value:
                return value
        path.parent.mkdir(parents=True, exist_ok=True)
        value = uuid.uuid4().hex
        path.write_text(value, encoding="utf-8")
        return value
    except OSError:
        fallback = f"{platform.node()}:{platform.system()}:{platform.machine()}"
        return hashlib.sha256(fallback.encode("utf-8")).hexdigest()


# ─── Report Fingerprint ─────────────────────────────────────────────────────

def build_report_fingerprint(audio_path: str, verdict: str, score: float) -> Tuple[str, str]:
    """Create a traceable report fingerprint for an analysis result."""
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    try:
        audio_digest = file_sha256(Path(audio_path))[:24]
    except OSError:
        audio_digest = hashlib.sha256(str(audio_path).encode("utf-8")).hexdigest()[:24]

    payload = "|".join([
        installation_id(),
        audio_digest,
        verdict,
        f"{float(score):.6f}",
        generated_at,
    ])
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest().upper()
    return generated_at, f"UAI-{digest[:6]}-{digest[6:12]}-{digest[12:18]}"


def attach_report_fingerprint(result, audio_path: str) -> None:
    """Attach generated-at and fingerprint metadata to an analysis result."""
    generated_at, fingerprint = build_report_fingerprint(
        audio_path=audio_path,
        verdict=getattr(result, "verdict", ""),
        score=float(getattr(result, "score", 0.0)),
    )
    result.generated_at = generated_at
    result.report_fingerprint = fingerprint
