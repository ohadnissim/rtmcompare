"""
LTI 1.3 Grade Passback — groundwork scaffold.

LTI 1.3 Advantage / AGS (Assignment and Grade Services) lets RTMcompare
push scores to any compliant LMS (Blackboard, Moodle, Brightspace, Canvas
via standard LTI — not the Canvas-proprietary REST).

STATUS: SCAFFOLD — the JWT signing and OIDC auth flows are wired but not
production-tested. A full deployment requires:
  1. An LTI 1.3 tool registration at the LMS (client_id, deployment_id,
     OIDC auth URL, JWKS URL, AGS endpoint).
  2. An RSA key pair for signing JWT assertions (generate with openssl).
  3. The student's `lis_result_sourcedid` captured from the LTI launch.

See: https://www.imsglobal.org/spec/lti-ags/v2p0

This module provides:
  - LtiConfig dataclass (tool registration parameters)
  - build_score_claim() — construct the AGS score JSON payload
  - post_score() — send the score via HTTP POST with JWT Bearer auth
  - cli entry point: python lti_passback.py --score <0-100> --sourcedid <id> --config <path>
"""
from __future__ import annotations

import json
import os
import sys
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Optional

# ── Security: allowed directory for LTI private keys ─────────────────────────
# All private key files MUST be stored under this directory.
# Paths that escape via .. or absolute paths to other directories are rejected.
_LTI_KEY_DIR = os.path.expanduser("~/.rtm/lti")


def _validate_key_path(path: str) -> str:
    """Resolve and validate that *path* is within _LTI_KEY_DIR.

    Returns the resolved absolute path on success.
    Raises ValueError with a safe message (no raw path in exception) on failure.
    """
    resolved = os.path.realpath(os.path.abspath(os.path.expanduser(path)))
    allowed = os.path.realpath(_LTI_KEY_DIR)
    if not resolved.startswith(allowed + os.sep) and resolved != allowed:
        raise ValueError(
            "private_key_path must be located inside ~/.rtm/lti/ — "
            "path traversal or external key paths are not allowed."
        )
    return resolved


@dataclass
class LtiConfig:
    """LTI 1.3 tool registration parameters for one LMS deployment."""
    client_id: str               # LMS-assigned client ID for this tool
    deployment_id: str           # Deployment-specific ID
    oidc_auth_url: str           # LMS OIDC authorisation endpoint
    token_url: str               # LMS OAuth 2.0 token endpoint
    ags_lineitem_url: str        # AGS LineItem endpoint for this assignment
    private_key_path: str        # Path to PEM RSA private key
    key_id: str = "rtm-key-1"   # Key ID (kid) for the JWK
    lms_type: str = "generic"   # 'canvas' | 'moodle' | 'blackboard' | 'brightspace' | 'generic'


@dataclass
class ScoreClaim:
    """IMS AGS score object."""
    userId: str                          # LMS user ID or lis_result_sourcedid
    scoreGiven: float                    # 0..scoreMaximum
    scoreMaximum: float                  # typically 100.0
    comment: str = ""                    # Instructor feedback (optional)
    activityProgress: str = "Completed"  # Initialized | Started | InProgress | Submitted | Completed
    gradingProgress: str = "FullyGraded" # NotReady | Failed | Pending | PendingManual | FullyGraded
    timestamp: str = field(default_factory=lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


def build_score_payload(score: ScoreClaim) -> dict:
    """Build the AGS score JSON body per IMS LTI AGS v2.0 spec."""
    payload = asdict(score)
    payload["https://purl.imsglobal.org/spec/lti-ags/claim/score"] = {
        "scoreGiven": score.scoreGiven,
        "scoreMaximum": score.scoreMaximum,
        "activityProgress": score.activityProgress,
        "gradingProgress": score.gradingProgress,
        "userId": score.userId,
        "timestamp": score.timestamp,
    }
    return payload


def _build_client_assertion_jwt(config: LtiConfig) -> str:
    """Build a signed JWT client assertion for OAuth 2.0 client_credentials grant.

    Requires PyJWT + cryptography:
        pip install PyJWT cryptography

    Returns the signed JWT string.
    """
    try:
        import jwt  # type: ignore  (PyJWT)
        safe_key_path = _validate_key_path(config.private_key_path)
        with open(safe_key_path, "r") as f:
            private_key = f.read()
        now = int(time.time())
        claims = {
            "iss": config.client_id,
            "sub": config.client_id,
            "aud": config.token_url,
            "iat": now,
            "exp": now + 300,  # 5 minute window
            "jti": str(uuid.uuid4()),
        }
        token = jwt.encode(claims, private_key, algorithm="RS256",
                           headers={"kid": config.key_id})
        return token if isinstance(token, str) else token.decode()
    except ImportError:
        raise RuntimeError("PyJWT + cryptography required for LTI 1.3: pip install PyJWT cryptography")


def get_access_token(config: LtiConfig) -> str:
    """Exchange client assertion JWT for an AGS bearer token.

    Returns the access token string.
    Raises RuntimeError on failure.
    """
    try:
        import urllib.request
        import urllib.parse

        assertion = _build_client_assertion_jwt(config)
        body = urllib.parse.urlencode({
            "grant_type": "client_credentials",
            "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
            "client_assertion": assertion,
            "scope": "https://purl.imsglobal.org/spec/lti-ags/scope/score",
        }).encode()

        req = urllib.request.Request(config.token_url, data=body, method="POST",
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())

        if "access_token" not in data:
            raise RuntimeError(f"No access_token in response: {data}")
        return str(data["access_token"])
    except Exception as e:
        raise RuntimeError(f"LTI token request failed: {e}") from e


def post_score(config: LtiConfig, score: ScoreClaim) -> dict:
    """Post a score to the LMS via AGS.

    Returns {"ok": True} on success or {"ok": False, "error": str} on failure.
    """
    try:
        import urllib.request

        token = get_access_token(config)
        payload = build_score_payload(score)
        body = json.dumps(payload).encode()

        # AGS score endpoint: <lineitem_url>/scores
        scores_url = config.ags_lineitem_url.rstrip("/") + "/scores"
        req = urllib.request.Request(
            scores_url, data=body, method="POST",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/vnd.ims.lis.v1.score+json",
                "Accept": "application/json",
            }
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp_body = resp.read()
        return {"ok": True, "response": resp_body.decode()[:500]}
    except RuntimeError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        return {"ok": False, "error": f"AGS POST failed: {e}"}


def save_config(config: LtiConfig, path: str) -> None:
    """Persist LTI config to a JSON file."""
    with open(path, "w") as f:
        json.dump(asdict(config), f, indent=2)


def load_config(path: str) -> LtiConfig:
    """Load LTI config from a JSON file.

    Validates private_key_path is within the allowed directory before
    returning — prevents a tampered config from causing path traversal.
    """
    with open(path) as f:
        data = json.load(f)
    cfg = LtiConfig(**data)
    # Validate early; raises ValueError if path escapes ~/.rtm/lti/
    _validate_key_path(cfg.private_key_path)
    return cfg


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="RTMcompare LTI 1.3 grade passback")
    parser.add_argument("--score", type=float, required=True, help="Score (0-100)")
    parser.add_argument("--user-id", required=True, help="LMS user ID")
    parser.add_argument("--config", required=True, help="Path to lti-config.json")
    parser.add_argument("--comment", default="", help="Optional instructor comment")
    args = parser.parse_args()

    try:
        cfg = load_config(args.config)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Could not load config: {e}"}))
        sys.exit(1)

    sc = ScoreClaim(
        userId=args.user_id,
        scoreGiven=min(100.0, max(0.0, args.score)),
        scoreMaximum=100.0,
        comment=args.comment,
    )
    result = post_score(cfg, sc)
    print(json.dumps(result))
    sys.exit(0 if result.get("ok") else 1)
