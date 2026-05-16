from __future__ import annotations

import json
import os
import shlex
import subprocess
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    from runtime_store import load_study_run_by_id
except ModuleNotFoundError:
    from scripts.runtime_store import load_study_run_by_id


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
CONTRACT_BRIDGE_PATH = SCRIPTS_DIR / "build_study_run_assistant_payload.mjs"
ASSISTANT_CONTRACT_BRIDGE_PATH = SCRIPTS_DIR / "export_assistant_contract.mjs"
ASSISTANT_CONTRACT_BUNDLE_BRIDGE_PATH = SCRIPTS_DIR / "build_assistant_contract_bundle.mjs"
CONTRACT_BRIDGE_TIMEOUT_SECONDS = 10
ASSISTANT_CONTRACT_VERSION = "assistant-contract-v1"
ASSISTANT_CONTRACT_BUNDLE_VERSION = "assistant-contract-bundle-v1"
ASSISTANT_READINESS_VERSION = "assistant-readiness-v1"
ASSISTANT_STUDY_PLAN_DRY_RUN_VERSION = "assistant-study-plan-dry-run-v1"
ASSISTANT_STUDY_PLAN_LIVE_DRAFT_VERSION = "assistant-study-plan-live-draft-v1"
STUDY_PLAN_VERSION = "study-plan-v1"
STUDY_RUN_HANDOFF_VERSION = "study-run-handoff-v1"
STUDY_RUN_EXPLANATION_BRIEF_VERSION = "study-run-explanation-brief-v1"
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
DEFAULT_OPENAI_STUDY_PLANNER_MODEL = "gpt-4.1-mini"
REQUIRED_CONTRACT_BUNDLE_KEYS = [
    "assistant",
    "metricRegistry",
    "studyCatalog",
    "studyProposal",
    "intentPlanner",
    "studyPlan",
    "studyPlanRecipe",
    "studyRunExplanation",
    "studyRunHandoff",
    "studyRunExplanationBrief",
]


class StudyRunNotFoundError(LookupError):
    pass


def _parse_run_id(value) -> int:
    if isinstance(value, bool):
        raise ValueError("runId must be a positive integer.")
    try:
        run_id = int(str(value or "").strip())
    except (TypeError, ValueError) as error:
        raise ValueError("runId must be a positive integer.") from error
    if run_id <= 0:
        raise ValueError("runId must be a positive integer.")
    return run_id


def _require_request_object(request: dict | None) -> dict:
    if not isinstance(request, dict):
        raise ValueError("Assistant request must be a JSON object.")
    return request


def _require_intent(request: dict) -> str:
    intent = str((request or {}).get("intent") or "").strip()
    if not intent:
        raise ValueError("intent is required.")
    return intent


def _optional_positive_int(value, default: int, *, label: str) -> int:
    if value is None or str(value).strip() == "":
        return default
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} must be an integer.") from error
    if parsed <= 0:
        raise ValueError(f"{label} must be positive.")
    return parsed


def _get_study_builder_service():
    try:
        from . import study_builder_service
    except ImportError:
        from scripts.server import study_builder_service
    return study_builder_service


def _run_node_json_bridge(
    command: list[str],
    *,
    input_text: str | None = None,
    bridge_label: str = "Assistant contract bridge",
) -> dict:
    try:
        completed = subprocess.run(
            command,
            input=input_text,
            text=True,
            capture_output=True,
            cwd=str(SCRIPTS_DIR.parent),
            check=False,
            timeout=CONTRACT_BRIDGE_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as error:
        raise RuntimeError("Node is required to build assistant contract payloads.") from error
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f"{bridge_label} timed out.") from error

    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip()
        message = f"{bridge_label} failed."
        if detail:
            message = f"{message} {detail}"
        raise RuntimeError(message)

    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"{bridge_label} returned invalid JSON.") from error


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _truthy(value, default: bool = True) -> bool:
    if value is None:
        return default
    normalized = str(value).strip().lower()
    if normalized in {"0", "false", "no", "off"}:
        return False
    if normalized in {"1", "true", "yes", "on"}:
        return True
    return default


def _readiness_check(
    check_id: str,
    label: str,
    *,
    ok: bool,
    severity: str = "error",
    detail: str = "",
    metadata: dict | None = None,
) -> dict:
    return {
        "id": check_id,
        "label": label,
        "ok": bool(ok),
        "severity": "info" if ok else severity,
        "failureSeverity": severity,
        "detail": detail,
        "metadata": metadata or {},
    }


def _run_readiness_command(command_text: str) -> tuple[bool, str]:
    try:
        command = shlex.split(command_text)
    except ValueError as error:
        return False, f"Could not parse command: {error}"
    if not command:
        return False, "Empty command."

    try:
        completed = subprocess.run(
            command,
            text=True,
            capture_output=True,
            cwd=str(SCRIPTS_DIR.parent),
            check=False,
            timeout=CONTRACT_BRIDGE_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as error:
        return False, f"Command executable not found: {error.filename}"
    except subprocess.TimeoutExpired:
        return False, "Command timed out."

    detail = (completed.stdout or completed.stderr or "").strip()
    return completed.returncode == 0, detail


def _route_handlers_for_readiness() -> tuple[dict, dict]:
    try:
        from . import routes as server_routes
    except ImportError:
        from scripts.server import routes as server_routes
    return server_routes.GET_ROUTE_HANDLERS, server_routes.POST_ROUTE_HANDLERS


def _extract_response_text(payload: dict) -> str:
    if isinstance(payload.get("output_text"), str):
        return payload["output_text"]

    parts: list[str] = []
    for item in payload.get("output") or []:
        if not isinstance(item, dict):
            continue
        for content in item.get("content") or []:
            if not isinstance(content, dict):
                continue
            text = content.get("text")
            if isinstance(text, str):
                parts.append(text)
    return "\n".join(parts).strip()


def _parse_json_object_from_text(text: str) -> dict:
    cleaned = str(text or "").strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end < start:
            raise ValueError("Model response did not contain a JSON object.")
        parsed = json.loads(cleaned[start : end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("Model response JSON must be an object.")
    return parsed


def _build_live_planner_prompt(intent: str) -> dict:
    contract_bundle = build_assistant_contract_bundle_payload({})
    contracts = contract_bundle["contracts"]
    return {
        "intent": intent,
        "studyCatalog": contracts["studyCatalog"],
        "studyPlanContract": contracts["studyPlan"],
        "instructions": [
            "Return one study-plan-v1 JSON object only.",
            "Use only study ids, view ids, and route params from the provided contracts.",
            "Set requiresConfirmation to true.",
            "Do not include prose, markdown, comments, or unsupported metrics.",
            "If the intent is underspecified but can be safely mapped, choose conservative defaults.",
        ],
    }


def _call_openai_responses_api(api_key: str, payload: dict) -> dict:
    request = urllib.request.Request(
        OPENAI_RESPONSES_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI planner request failed with HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"OpenAI planner request failed: {error.reason}") from error
    except TimeoutError as error:
        raise RuntimeError("OpenAI planner request timed out.") from error


def _build_contract_payload(run: dict) -> dict:
    payload = _run_node_json_bridge(
        ["node", str(CONTRACT_BRIDGE_PATH)],
        input_text=json.dumps(run, separators=(",", ":"), sort_keys=True),
    )

    handoff = payload.get("handoff")
    explanation_brief = payload.get("explanationBrief")
    if (
        not isinstance(handoff, dict)
        or handoff.get("version") != STUDY_RUN_HANDOFF_VERSION
        or not isinstance(explanation_brief, dict)
        or explanation_brief.get("version") != STUDY_RUN_EXPLANATION_BRIEF_VERSION
    ):
        raise RuntimeError("Assistant contract bridge returned an incomplete payload.")
    return payload


def build_study_run_brief_payload(request: dict) -> dict:
    run_id = _parse_run_id((request or {}).get("runId"))
    run = load_study_run_by_id(run_id)
    if run is None:
        raise StudyRunNotFoundError(f"Study run {run_id} was not found.")

    contract_payload = _build_contract_payload(run)
    return {
        "run": run,
        "handoff": contract_payload["handoff"],
        "explanationBrief": contract_payload["explanationBrief"],
    }


def build_assistant_contract_payload(_request: dict | None = None) -> dict:
    payload = _run_node_json_bridge(
        ["node", str(ASSISTANT_CONTRACT_BRIDGE_PATH)],
        bridge_label="Assistant contract manifest bridge",
    )
    if (
        payload.get("version") != ASSISTANT_CONTRACT_VERSION
        or not isinstance(payload.get("contracts"), list)
        or not isinstance(payload.get("backendEndpoints"), list)
        or not isinstance(payload.get("hardStops"), list)
    ):
        raise RuntimeError("Assistant contract manifest bridge returned an incomplete payload.")
    return payload


def build_assistant_contract_bundle_payload(_request: dict | None = None) -> dict:
    payload = _run_node_json_bridge(
        ["node", str(ASSISTANT_CONTRACT_BUNDLE_BRIDGE_PATH)],
        bridge_label="Assistant contract bundle bridge",
    )
    contracts = payload.get("contracts")
    if (
        payload.get("version") != ASSISTANT_CONTRACT_BUNDLE_VERSION
        or not isinstance(contracts, dict)
        or not isinstance(contracts.get("assistant"), dict)
        or contracts["assistant"].get("version") != ASSISTANT_CONTRACT_VERSION
        or not isinstance(contracts.get("metricRegistry"), dict)
        or not isinstance(contracts.get("studyCatalog"), dict)
        or not isinstance(contracts.get("studyPlan"), dict)
        or contracts["studyPlan"].get("version") != STUDY_PLAN_VERSION
    ):
        raise RuntimeError("Assistant contract bundle bridge returned an incomplete payload.")
    return payload


def build_assistant_readiness_payload(request: dict | None = None) -> dict:
    request = request or {}
    run_artifact_checks = _truthy(request.get("artifactChecks"), default=True)
    checks: list[dict] = []
    assistant_contract = None
    contract_bundle = None

    try:
        assistant_contract = build_assistant_contract_payload({})
        checks.append(
            _readiness_check(
                "assistant-contract",
                "Assistant contract bridge",
                ok=True,
                detail=f"{ASSISTANT_CONTRACT_VERSION} loaded from JS source.",
                metadata={"version": assistant_contract.get("version")},
            )
        )
    except Exception as error:  # noqa: BLE001 - readiness should report all failures.
        checks.append(
            _readiness_check(
                "assistant-contract",
                "Assistant contract bridge",
                ok=False,
                detail=str(error),
            )
        )

    try:
        contract_bundle = build_assistant_contract_bundle_payload({})
        checks.append(
            _readiness_check(
                "assistant-contract-bundle",
                "Assistant contract bundle bridge",
                ok=True,
                detail=f"{ASSISTANT_CONTRACT_BUNDLE_VERSION} loaded from JS source.",
                metadata={"version": contract_bundle.get("version")},
            )
        )
    except Exception as error:  # noqa: BLE001 - readiness should report all failures.
        checks.append(
            _readiness_check(
                "assistant-contract-bundle",
                "Assistant contract bundle bridge",
                ok=False,
                detail=str(error),
            )
        )

    if contract_bundle:
        contracts = contract_bundle.get("contracts") or {}
        missing_keys = [
            key for key in REQUIRED_CONTRACT_BUNDLE_KEYS if not isinstance(contracts.get(key), dict)
        ]
        checks.append(
            _readiness_check(
                "assistant-contract-bundle-keys",
                "Required contract bundle members",
                ok=not missing_keys,
                detail=(
                    "All required deterministic assistant contracts are present."
                    if not missing_keys
                    else f"Missing contract bundle members: {', '.join(missing_keys)}"
                ),
                metadata={
                    "required": REQUIRED_CONTRACT_BUNDLE_KEYS,
                    "available": sorted(contracts.keys()),
                },
            )
        )

    if assistant_contract:
        assistant_artifact_path = SCRIPTS_DIR.parent / "docs" / "assistant-contract.json"
        if not assistant_artifact_path.exists():
            checks.append(
                _readiness_check(
                    "assistant-artifact-assistant-contract",
                    "Generated artifact for assistant-contract",
                    ok=False,
                    detail="Missing generated artifact: docs/assistant-contract.json",
                    metadata={"artifact": "docs/assistant-contract.json"},
                )
            )
        elif not run_artifact_checks:
            checks.append(
                _readiness_check(
                    "assistant-artifact-assistant-contract",
                    "Generated artifact for assistant-contract",
                    ok=True,
                    severity="info",
                    detail="Generated artifact exists; drift command skipped by request.",
                    metadata={"artifact": "docs/assistant-contract.json"},
                )
            )
        else:
            ok, detail = _run_readiness_command("node scripts/export_assistant_contract.mjs --check")
            checks.append(
                _readiness_check(
                    "assistant-artifact-assistant-contract",
                    "Generated artifact for assistant-contract",
                    ok=ok,
                    detail=detail or ("Generated artifact is in sync." if ok else "Generated artifact check failed."),
                    metadata={
                        "artifact": "docs/assistant-contract.json",
                        "checkCommand": "node scripts/export_assistant_contract.mjs --check",
                    },
                )
            )

        try:
            get_handlers, post_handlers = _route_handlers_for_readiness()
            missing_endpoints = []
            for endpoint in assistant_contract.get("backendEndpoints") or []:
                method = str(endpoint.get("method") or "").upper()
                path = str(endpoint.get("path") or "")
                handlers = get_handlers if method == "GET" else post_handlers if method == "POST" else {}
                if path not in handlers:
                    missing_endpoints.append(f"{method} {path}")
            checks.append(
                _readiness_check(
                    "assistant-backend-routes",
                    "Assistant contract backend endpoint wiring",
                    ok=not missing_endpoints,
                    detail=(
                        "All assistant contract backend endpoints are wired in routes.py."
                        if not missing_endpoints
                        else f"Missing route handlers: {', '.join(missing_endpoints)}"
                    ),
                    metadata={
                        "declaredEndpointCount": len(assistant_contract.get("backendEndpoints") or []),
                        "missingEndpoints": missing_endpoints,
                    },
                )
            )
        except Exception as error:  # noqa: BLE001 - readiness should report all failures.
            checks.append(
                _readiness_check(
                    "assistant-backend-routes",
                    "Assistant contract backend endpoint wiring",
                    ok=False,
                    detail=str(error),
                )
            )

        for contract in assistant_contract.get("contracts") or []:
            contract_id = str(contract.get("id") or "unknown-contract")
            artifact_path = SCRIPTS_DIR.parent / str(contract.get("generatedArtifact") or "")
            check_command = str(contract.get("checkCommand") or "").strip()
            if not artifact_path.exists():
                checks.append(
                    _readiness_check(
                        f"assistant-artifact-{contract_id}",
                        f"Generated artifact for {contract_id}",
                        ok=False,
                        detail=f"Missing generated artifact: {artifact_path.relative_to(SCRIPTS_DIR.parent)}",
                        metadata={"artifact": str(artifact_path.relative_to(SCRIPTS_DIR.parent))},
                    )
                )
                continue
            if not run_artifact_checks:
                checks.append(
                    _readiness_check(
                        f"assistant-artifact-{contract_id}",
                        f"Generated artifact for {contract_id}",
                        ok=True,
                        severity="info",
                        detail="Generated artifact exists; drift command skipped by request.",
                        metadata={"artifact": str(artifact_path.relative_to(SCRIPTS_DIR.parent))},
                    )
                )
                continue
            ok, detail = _run_readiness_command(check_command)
            checks.append(
                _readiness_check(
                    f"assistant-artifact-{contract_id}",
                    f"Generated artifact for {contract_id}",
                    ok=ok,
                    detail=detail or ("Generated artifact is in sync." if ok else "Generated artifact check failed."),
                    metadata={
                        "artifact": str(artifact_path.relative_to(SCRIPTS_DIR.parent)),
                        "checkCommand": check_command,
                    },
                )
            )

    failed_checks = [
        check for check in checks if not check["ok"] and check.get("failureSeverity") == "error"
    ]
    warning_checks = [
        check for check in checks if not check["ok"] and check.get("failureSeverity") == "warning"
    ]
    status = "ok" if not failed_checks else "attention"
    return {
        "version": ASSISTANT_READINESS_VERSION,
        "generatedAt": _utc_now_iso(),
        "status": status,
        "summary": {
            "total": len(checks),
            "passed": len([check for check in checks if check["ok"]]),
            "failed": len(failed_checks),
            "warnings": len(warning_checks),
        },
        "checks": checks,
        "liveAiTesting": {
            "requiredForReadiness": False,
            "requiredOnlyWhen": "Calling POST /api/assistant/study-plan-live-draft or scripts/run_assistant_live_planner_smoke.py.",
            "expectedKeyNames": ["OPENAI_API_KEY"],
            "status": "not-required",
        },
    }


def build_assistant_study_plan_dry_run_payload(request: dict | None = None) -> dict:
    request = _require_request_object(request)
    intent = _require_intent(request)
    study_builder_service = _get_study_builder_service()
    draft_payload = study_builder_service.build_study_builder_plan_payload({"intent": intent})
    validation_payload = study_builder_service.build_study_builder_validation_payload(
        {"plan": draft_payload["plan"]}
    )
    readiness = build_assistant_readiness_payload({"artifactChecks": False})
    preview = validation_payload["preview"]
    validation = validation_payload["validation"]
    return {
        "version": ASSISTANT_STUDY_PLAN_DRY_RUN_VERSION,
        "mode": "intent",
        "intent": intent,
        "readiness": readiness,
        "plannerResult": draft_payload["plannerResult"],
        "plan": draft_payload["plan"],
        "validation": validation,
        "preview": preview,
        "canRun": bool(preview.get("canRun")),
        "execution": {
            "executed": False,
            "requiresConfirmation": True,
            "reason": "Dry run only. The study route is not executed and no AI model is called.",
        },
    }


def build_assistant_study_plan_live_draft_payload(request: dict | None = None) -> dict:
    request = _require_request_object(request)
    intent = _require_intent(request)
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("OPENAI_API_KEY is required for live assistant planning.")

    model = str(
        request.get("model")
        or os.environ.get("OPENAI_STUDY_PLANNER_MODEL")
        or os.environ.get("OPENAI_MODEL")
        or DEFAULT_OPENAI_STUDY_PLANNER_MODEL
    ).strip()
    if not model:
        raise ValueError("OpenAI model is required for live assistant planning.")

    max_output_tokens = _optional_positive_int(
        request.get("maxOutputTokens") or os.environ.get("OPENAI_STUDY_PLANNER_MAX_OUTPUT_TOKENS"),
        900,
        label="maxOutputTokens",
    )
    prompt_payload = _build_live_planner_prompt(intent)
    response_payload = _call_openai_responses_api(
        api_key,
        {
            "model": model,
            "instructions": (
                "You are a constrained planner for Index Study Lab. "
                "Return only a JSON object that conforms to study-plan-v1."
            ),
            "input": json.dumps(prompt_payload, separators=(",", ":"), sort_keys=True),
            "max_output_tokens": max_output_tokens,
            "store": False,
        },
    )
    output_text = _extract_response_text(response_payload)
    if not output_text:
        raise RuntimeError("OpenAI planner returned no text output.")

    plan = _parse_json_object_from_text(output_text)
    study_builder_service = _get_study_builder_service()
    validation_payload = study_builder_service.build_study_builder_validation_payload({"plan": plan})
    readiness = build_assistant_readiness_payload({"artifactChecks": False})
    preview = validation_payload["preview"]
    validation = validation_payload["validation"]
    return {
        "version": ASSISTANT_STUDY_PLAN_LIVE_DRAFT_VERSION,
        "mode": "intent",
        "provider": "openai",
        "model": model,
        "intent": intent,
        "readiness": readiness,
        "modelResult": {
            "responseId": response_payload.get("id"),
            "status": response_payload.get("status"),
            "outputTextLength": len(output_text),
            "parsedJson": True,
        },
        "plan": plan,
        "validation": validation,
        "preview": preview,
        "canRun": bool(preview.get("canRun")),
        "execution": {
            "executed": False,
            "requiresConfirmation": True,
            "reason": "Live draft only. The study route is not executed and no result prose is generated.",
        },
    }
