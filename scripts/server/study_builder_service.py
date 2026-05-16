from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

try:
    from runtime_store import (
        delete_study_plan_recipe,
        list_study_plan_recipes,
        upsert_study_plan_recipe,
    )
except ModuleNotFoundError:
    from scripts.runtime_store import (
        delete_study_plan_recipe,
        list_study_plan_recipes,
        upsert_study_plan_recipe,
    )


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
STUDY_BUILDER_BRIDGE_PATH = SCRIPTS_DIR / "build_study_builder_payload.mjs"
STUDY_BUILDER_BRIDGE_TIMEOUT_SECONDS = 10
STUDY_PLAN_RECIPE_VERSION = "study-plan-recipes-v1"
STUDY_PLAN_RECIPE_LIMIT = 50


def _require_request_object(request: dict | None) -> dict:
    if not isinstance(request, dict):
        raise ValueError("Study builder request must be a JSON object.")
    return request


def _clean_text(value) -> str:
    return str(value or "").strip()


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", _clean_text(value).lower()).strip("-")
    return (slug or "study-plan")[:48]


def _to_base36(value: int) -> str:
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    if value == 0:
        return "0"
    digits: list[str] = []
    current = int(value)
    while current:
        current, remainder = divmod(current, 36)
        digits.append(alphabet[remainder])
    return "".join(reversed(digits))


def _simple_hash(value: str) -> str:
    hash_value = 2166136261
    for char in str(value or ""):
        hash_value ^= ord(char)
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return _to_base36(hash_value)


def _normalize_recipe_name(name: str, preview: dict) -> str:
    cleaned = re.sub(r"\s+", " ", _clean_text(name))
    if cleaned:
        return cleaned[:120]
    study_title = _clean_text(preview.get("studyTitle"))
    view_label = _clean_text(preview.get("viewLabel"))
    if study_title and view_label:
        return f"{study_title} · {view_label}"
    return "Untitled StudyPlan"


def _build_recipe_id(name: str, route_hash: str, requested_id: str = "") -> str:
    cleaned_id = _clean_text(requested_id)
    if cleaned_id and len(cleaned_id) <= 160:
        return cleaned_id
    return f"{_slugify(name)}-{_simple_hash(route_hash)}"


def _run_study_builder_bridge(mode: str, request: dict) -> dict:
    try:
        completed = subprocess.run(
            ["node", str(STUDY_BUILDER_BRIDGE_PATH), mode],
            input=json.dumps(request, separators=(",", ":"), sort_keys=True),
            text=True,
            capture_output=True,
            cwd=str(SCRIPTS_DIR.parent),
            check=False,
            timeout=STUDY_BUILDER_BRIDGE_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as error:
        raise RuntimeError("Node is required to build study-builder payloads.") from error
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("Study builder contract bridge timed out.") from error

    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip()
        message = "Study builder contract bridge failed."
        if detail:
            message = f"{message} {detail}"
        raise RuntimeError(message)

    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("Study builder contract bridge returned invalid JSON.") from error

    if not isinstance(payload, dict):
        raise RuntimeError("Study builder contract bridge returned an invalid payload.")
    return payload


def build_study_builder_plan_payload(request: dict | None) -> dict:
    payload = _run_study_builder_bridge("plan", _require_request_object(request))
    if (
        payload.get("version") != "study-builder-plan-response-v1"
        or not isinstance(payload.get("plannerResult"), dict)
        or not isinstance(payload.get("plan"), dict)
        or not isinstance(payload.get("preview"), dict)
    ):
        raise RuntimeError("Study builder contract bridge returned an incomplete plan payload.")
    return payload


def build_study_builder_validation_payload(request: dict | None) -> dict:
    payload = _run_study_builder_bridge("validate", _require_request_object(request))
    if (
        payload.get("version") != "study-builder-validation-response-v1"
        or payload.get("mode") not in {"plan", "route"}
        or not isinstance(payload.get("validation"), dict)
        or not isinstance(payload.get("preview"), dict)
    ):
        raise RuntimeError(
            "Study builder contract bridge returned an incomplete validation payload."
        )
    return payload


def build_study_plan_recipe_state_payload(request: dict | None = None) -> dict:
    request = request or {}
    if not isinstance(request, dict):
        raise ValueError("Study builder request must be a JSON object.")
    try:
        limit = int(request.get("limit") or STUDY_PLAN_RECIPE_LIMIT)
    except (TypeError, ValueError) as error:
        raise ValueError("StudyPlan recipe limit must be an integer.") from error
    return {
        "version": STUDY_PLAN_RECIPE_VERSION,
        "limit": STUDY_PLAN_RECIPE_LIMIT,
        "recipes": list_study_plan_recipes(limit=max(1, min(limit, 200))),
    }


def save_study_plan_recipe(request: dict | None) -> dict:
    request = _require_request_object(request)
    plan = request.get("plan")
    validation_payload = build_study_builder_validation_payload({"plan": plan})
    validation = validation_payload.get("validation") or {}
    preview = validation_payload.get("preview") or {}
    existing_payload = build_study_plan_recipe_state_payload({})

    if not validation.get("ok") or not isinstance(validation.get("normalizedPlan"), dict):
        return {
            "ok": False,
            "recipe": None,
            "recipes": existing_payload["recipes"],
            "validation": validation,
            "preview": preview,
        }

    normalized_plan = validation["normalizedPlan"]
    route_hash = _clean_text(validation.get("routeHash") or preview.get("routeHash"))
    if not route_hash:
        raise RuntimeError("Validated StudyPlan did not include a route hash.")

    recipe_name = _normalize_recipe_name(_clean_text(request.get("name")), preview)
    recipe = upsert_study_plan_recipe(
        {
            "id": _build_recipe_id(recipe_name, route_hash, _clean_text(request.get("id"))),
            "version": STUDY_PLAN_RECIPE_VERSION,
            "name": recipe_name,
            "routeHash": route_hash,
            "studyId": normalized_plan.get("studyId"),
            "viewId": normalized_plan.get("viewId"),
            "plan": normalized_plan,
        }
    )
    return {
        "ok": True,
        "recipe": recipe,
        "recipes": build_study_plan_recipe_state_payload({})["recipes"],
        "validation": validation,
        "preview": preview,
    }


def remove_study_plan_recipe(request: dict | None) -> dict:
    request = _require_request_object(request)
    recipe_id = _clean_text(request.get("id") or request.get("recipeId"))
    if not recipe_id:
        raise ValueError("StudyPlan recipe id is required.")
    deleted = delete_study_plan_recipe(recipe_id)
    return {
        "ok": deleted,
        "recipes": build_study_plan_recipe_state_payload({})["recipes"],
    }
