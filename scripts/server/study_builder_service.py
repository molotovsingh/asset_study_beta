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


from . import saved_study_service


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
STUDY_BUILDER_BRIDGE_PATH = SCRIPTS_DIR / "build_study_builder_payload.mjs"
STUDY_BUILDER_BRIDGE_TIMEOUT_SECONDS = 10
STUDY_BUILDER_PLAN_RESPONSE_VERSION = "study-builder-plan-response-v1"
STUDY_BUILDER_VALIDATION_RESPONSE_VERSION = "study-builder-validation-response-v1"
STUDY_PLAN_RECIPE_VERSION = "study-plan-recipes-v1"
STUDY_PLAN_RECIPE_LIMIT = 50
STUDY_PLAN_VERSION = "study-plan-v1"
INTENT_PLANNER_VERSION = "intent-planner-v1"


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
        payload.get("version") != STUDY_BUILDER_PLAN_RESPONSE_VERSION
        or not isinstance(payload.get("plannerResult"), dict)
        or payload["plannerResult"].get("version") != INTENT_PLANNER_VERSION
        or not isinstance(payload.get("plan"), dict)
        or payload["plan"].get("version") != STUDY_PLAN_VERSION
        or not isinstance(payload.get("preview"), dict)
    ):
        raise RuntimeError("Study builder contract bridge returned an incomplete plan payload.")
    return payload


def build_study_builder_validation_payload(request: dict | None) -> dict:
    payload = _run_study_builder_bridge("validate", _require_request_object(request))
    if (
        payload.get("version") != STUDY_BUILDER_VALIDATION_RESPONSE_VERSION
        or payload.get("mode") not in {"plan", "route"}
        or not isinstance(payload.get("validation"), dict)
        or not isinstance(payload.get("preview"), dict)
        or (
            isinstance(payload["validation"].get("normalizedPlan"), dict)
            and payload["validation"]["normalizedPlan"].get("version") != STUDY_PLAN_VERSION
        )
        or (
            isinstance(payload.get("normalizedPlan"), dict)
            and payload["normalizedPlan"].get("version") != STUDY_PLAN_VERSION
        )
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
    saved_recipes = [
        saved_study_service.saved_study_to_recipe(saved_study)
        for saved_study in saved_study_service.build_saved_study_state_payload(
            {"limit": max(1, min(limit, 200))}
        )["savedStudies"]
    ]
    recipes_by_id = {recipe["id"]: recipe for recipe in saved_recipes}
    for recipe in list_study_plan_recipes(limit=max(1, min(limit, 200))):
        recipes_by_id.setdefault(recipe["id"], recipe)
    recipes = sorted(
        recipes_by_id.values(),
        key=lambda recipe: (str(recipe.get("updatedAt") or ""), str(recipe.get("id") or "")),
        reverse=True,
    )[: max(1, min(limit, 200))]
    return {
        "version": STUDY_PLAN_RECIPE_VERSION,
        "limit": STUDY_PLAN_RECIPE_LIMIT,
        "recipes": recipes,
    }


def _save_validated_plan_as_saved_study(
    *,
    request: dict,
    validation: dict,
    preview: dict,
) -> dict:
    normalized_plan = validation["normalizedPlan"]
    route_hash = _clean_text(validation.get("routeHash") or preview.get("routeHash"))
    if not route_hash:
        raise RuntimeError("Validated StudyPlan did not include a route hash.")

    study_name = _normalize_recipe_name(_clean_text(request.get("name")), preview)
    saved_payload = saved_study_service.save_validated_saved_study(
        {
            "id": _clean_text(request.get("id") or request.get("savedStudyId")),
            "name": study_name,
            "routeHash": route_hash,
            "plan": normalized_plan,
            "preview": preview,
            "keepWarm": request.get("keepWarm", True),
            "notes": request.get("notes"),
        }
    )
    saved_study = saved_payload["savedStudy"]
    recipe = upsert_study_plan_recipe(
        {
            "id": saved_study["id"],
            "version": STUDY_PLAN_RECIPE_VERSION,
            "name": saved_study["name"],
            "routeHash": saved_study["routeHash"],
            "studyId": saved_study["studyId"],
            "viewId": saved_study["viewId"],
            "plan": saved_study["plan"],
        }
    )
    return {
        "savedPayload": saved_payload,
        "savedStudy": saved_study,
        "recipe": {
            **recipe,
            "savedStudy": saved_study,
            "readiness": saved_study.get("readiness"),
            "dependencies": saved_study.get("dependencies") or [],
        },
    }


def save_saved_study(request: dict | None) -> dict:
    request = _require_request_object(request)
    plan = request.get("plan")
    validation_payload = build_study_builder_validation_payload({"plan": plan})
    validation = validation_payload.get("validation") or {}
    preview = validation_payload.get("preview") or {}

    if not validation.get("ok") or not isinstance(validation.get("normalizedPlan"), dict):
        raise ValueError("Invalid StudyPlan.")

    saved_result = _save_validated_plan_as_saved_study(
        request=request,
        validation=validation,
        preview=preview,
    )
    state = saved_study_service.build_saved_study_state_payload({})
    return {
        "version": saved_study_service.SAVED_STUDY_VERSION,
        "ok": True,
        "savedStudy": saved_result["savedStudy"],
        "savedStudies": state["savedStudies"],
        "validation": validation,
        "preview": preview,
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
            "savedStudy": None,
            "validation": validation,
            "preview": preview,
        }

    saved_result = _save_validated_plan_as_saved_study(
        request=request,
        validation=validation,
        preview=preview,
    )
    return {
        "ok": True,
        "recipe": saved_result["recipe"],
        "recipes": build_study_plan_recipe_state_payload({})["recipes"],
        "savedStudy": saved_result["savedStudy"],
        "validation": validation,
        "preview": preview,
    }


def remove_study_plan_recipe(request: dict | None) -> dict:
    request = _require_request_object(request)
    recipe_id = _clean_text(request.get("id") or request.get("recipeId"))
    if not recipe_id:
        raise ValueError("StudyPlan recipe id is required.")
    archive_payload = saved_study_service.archive_saved_study({"id": recipe_id})
    legacy_deleted = delete_study_plan_recipe(recipe_id)
    return {
        "ok": bool(archive_payload.get("ok") or legacy_deleted),
        "recipes": build_study_plan_recipe_state_payload({})["recipes"],
        "savedStudy": archive_payload.get("savedStudy"),
    }
