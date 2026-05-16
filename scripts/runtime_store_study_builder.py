from __future__ import annotations

import json
import sqlite3


def _clean_text(value) -> str | None:
    text = str(value or "").strip()
    return text or None


def _row_to_study_plan_recipe(row: sqlite3.Row) -> dict:
    return {
        "id": row["recipe_id"],
        "version": row["version"],
        "name": row["name"],
        "routeHash": row["route_hash"],
        "studyId": row["study_id"],
        "viewId": row["view_id"],
        "plan": json.loads(row["plan_json"] or "{}"),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def list_study_plan_recipes(
    *,
    limit: int = 50,
    open_runtime_store,
) -> list[dict]:
    normalized_limit = max(1, min(int(limit or 50), 200))
    with open_runtime_store() as connection:
        rows = connection.execute(
            """
            SELECT
                recipe_id,
                version,
                name,
                route_hash,
                study_id,
                view_id,
                plan_json,
                created_at,
                updated_at
            FROM study_plan_recipes
            ORDER BY updated_at DESC, recipe_id ASC
            LIMIT ?
            """,
            (normalized_limit,),
        ).fetchall()
    return [_row_to_study_plan_recipe(row) for row in rows]


def load_study_plan_recipe(
    recipe_id: str,
    *,
    open_runtime_store,
) -> dict | None:
    normalized_recipe_id = _clean_text(recipe_id)
    if not normalized_recipe_id:
        return None
    with open_runtime_store() as connection:
        row = connection.execute(
            """
            SELECT
                recipe_id,
                version,
                name,
                route_hash,
                study_id,
                view_id,
                plan_json,
                created_at,
                updated_at
            FROM study_plan_recipes
            WHERE recipe_id = ?
            LIMIT 1
            """,
            (normalized_recipe_id,),
        ).fetchone()
    return _row_to_study_plan_recipe(row) if row is not None else None


def upsert_study_plan_recipe(
    recipe: dict,
    *,
    open_runtime_store,
    now_iso,
) -> dict:
    recipe_id = _clean_text(recipe.get("id"))
    name = _clean_text(recipe.get("name"))
    route_hash = _clean_text(recipe.get("routeHash"))
    study_id = _clean_text(recipe.get("studyId"))
    view_id = _clean_text(recipe.get("viewId"))
    plan = recipe.get("plan") if isinstance(recipe.get("plan"), dict) else None

    if not recipe_id:
        raise RuntimeError("StudyPlan recipe id is required.")
    if not name:
        raise RuntimeError("StudyPlan recipe name is required.")
    if not route_hash:
        raise RuntimeError("StudyPlan recipe route hash is required.")
    if not study_id:
        raise RuntimeError("StudyPlan recipe study id is required.")
    if not view_id:
        raise RuntimeError("StudyPlan recipe view id is required.")
    if plan is None:
        raise RuntimeError("StudyPlan recipe plan is required.")

    current = load_study_plan_recipe(
        recipe_id,
        open_runtime_store=open_runtime_store,
    )
    updated_at = _clean_text(recipe.get("updatedAt")) or now_iso()
    created_at = _clean_text(recipe.get("createdAt"))
    if not created_at and current:
        created_at = current.get("createdAt")
    created_at = created_at or updated_at

    with open_runtime_store() as connection:
        connection.execute(
            """
            INSERT INTO study_plan_recipes (
                recipe_id,
                version,
                name,
                route_hash,
                study_id,
                view_id,
                plan_json,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(recipe_id) DO UPDATE SET
                version = excluded.version,
                name = excluded.name,
                route_hash = excluded.route_hash,
                study_id = excluded.study_id,
                view_id = excluded.view_id,
                plan_json = excluded.plan_json,
                updated_at = excluded.updated_at
            """,
            (
                recipe_id,
                _clean_text(recipe.get("version")) or "study-plan-recipes-v1",
                name,
                route_hash,
                study_id,
                view_id,
                json.dumps(plan, separators=(",", ":"), sort_keys=True),
                created_at,
                updated_at,
            ),
        )
        connection.commit()

    saved = load_study_plan_recipe(
        recipe_id,
        open_runtime_store=open_runtime_store,
    )
    if saved is None:
        raise RuntimeError("StudyPlan recipe could not be reloaded.")
    return saved


def delete_study_plan_recipe(
    recipe_id: str,
    *,
    open_runtime_store,
) -> bool:
    normalized_recipe_id = _clean_text(recipe_id)
    if not normalized_recipe_id:
        return False
    with open_runtime_store() as connection:
        cursor = connection.execute(
            "DELETE FROM study_plan_recipes WHERE recipe_id = ?",
            (normalized_recipe_id,),
        )
        connection.commit()
    return int(cursor.rowcount or 0) > 0
