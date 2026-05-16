from __future__ import annotations

import json
import subprocess
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
STUDY_PROPOSAL_BRIDGE_PATH = SCRIPTS_DIR / "build_study_proposal_payload.mjs"
STUDY_PROPOSAL_BRIDGE_TIMEOUT_SECONDS = 10


def _require_request_object(request: dict | None) -> dict:
    if not isinstance(request, dict):
        raise ValueError("Study proposal request must be a JSON object.")
    return request


def _require_idea(request: dict) -> None:
    idea = str(request.get("idea") or request.get("intent") or "").strip()
    if not idea:
        raise ValueError("idea is required.")


def _run_study_proposal_bridge(request: dict) -> dict:
    try:
        completed = subprocess.run(
            ["node", str(STUDY_PROPOSAL_BRIDGE_PATH)],
            input=json.dumps(request, separators=(",", ":"), sort_keys=True),
            text=True,
            capture_output=True,
            cwd=str(SCRIPTS_DIR.parent),
            check=False,
            timeout=STUDY_PROPOSAL_BRIDGE_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as error:
        raise RuntimeError("Node is required to build study proposal payloads.") from error
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("Study proposal bridge timed out.") from error

    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip()
        message = "Study proposal bridge failed."
        if detail:
            message = f"{message} {detail}"
        raise RuntimeError(message)

    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("Study proposal bridge returned invalid JSON.") from error

    if not isinstance(payload, dict):
        raise RuntimeError("Study proposal bridge returned an invalid payload.")
    return payload


def build_study_proposal_payload(request: dict | None) -> dict:
    request = _require_request_object(request)
    _require_idea(request)
    payload = _run_study_proposal_bridge(request)
    if (
        payload.get("version") != "study-proposal-response-v1"
        or payload.get("mode") != "read-only"
        or not isinstance(payload.get("proposal"), dict)
        or not isinstance(payload.get("execution"), dict)
    ):
        raise RuntimeError("Study proposal bridge returned an incomplete payload.")
    return payload
