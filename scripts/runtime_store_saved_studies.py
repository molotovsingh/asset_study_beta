from __future__ import annotations

import json
import sqlite3
from typing import Callable


def _clean_text(value) -> str | None:
    text = str(value or "").strip()
    return text or None


def _clean_status(value) -> str:
    status = str(value or "").strip().lower()
    return status if status in {"active", "archived"} else "active"


def _json_dumps(payload) -> str:
    return json.dumps(payload if payload is not None else {}, separators=(",", ":"), sort_keys=True)


def _json_loads(payload: str | None, default):
    if not payload:
        return default
    try:
        decoded = json.loads(payload)
    except json.JSONDecodeError:
        return default
    return decoded if isinstance(decoded, type(default)) else default


def _row_to_dependency(row: sqlite3.Row) -> dict:
    return {
        "dependencyId": int(row["dependency_id"]),
        "savedStudyId": row["saved_study_id"],
        "dependencyKey": row["dependency_key"],
        "dependencyKind": row["dependency_kind"],
        "label": row["label"],
        "query": row["query"],
        "symbol": row["symbol"],
        "universeId": row["universe_id"],
        "requiredCapability": row["required_capability"],
        "instrumentId": int(row["instrument_id"]) if row["instrument_id"] is not None else None,
        "mappingId": int(row["mapping_id"]) if row["mapping_id"] is not None else None,
        "verificationStatus": row["verification_status"],
        "issue": _json_loads(row["issue_json"], {}),
        "metadata": _json_loads(row["metadata_json"], {}),
        "updatedAt": row["updated_at"],
    }


def _row_to_artifact(row: sqlite3.Row) -> dict:
    return {
        "artifactId": int(row["artifact_id"]),
        "savedStudyId": row["saved_study_id"],
        "artifactType": row["artifact_type"],
        "artifactVersion": row["artifact_version"],
        "artifact": _json_loads(row["artifact_json"], {}),
        "createdAt": row["created_at"],
    }


def _row_to_refresh_run(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return {
        "refreshRunId": int(row["refresh_run_id"]),
        "savedStudyId": row["saved_study_id"],
        "status": row["status"],
        "startedAt": row["started_at"],
        "completedAt": row["completed_at"],
        "refreshedCount": int(row["refreshed_count"] or 0),
        "skippedCount": int(row["skipped_count"] or 0),
        "failedCount": int(row["failed_count"] or 0),
        "details": _json_loads(row["details_json"], {}),
    }


def _row_to_saved_study(row: sqlite3.Row) -> dict:
    return {
        "id": row["saved_study_id"],
        "version": row["version"],
        "name": row["name"],
        "status": row["status"],
        "studyId": row["study_id"],
        "viewId": row["view_id"],
        "routeHash": row["route_hash"],
        "plan": _json_loads(row["plan_json"], {}),
        "keepWarm": bool(row["keep_warm"]),
        "notes": row["notes"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "archivedAt": row["archived_at"],
        "dependencies": [],
        "artifacts": [],
        "readiness": None,
        "latestRunLink": None,
        "latestRefreshRun": None,
    }


def _attach_saved_study_related(
    saved_studies: list[dict],
    *,
    open_runtime_store: Callable[[], sqlite3.Connection],
) -> list[dict]:
    if not saved_studies:
        return saved_studies

    saved_study_ids = [study["id"] for study in saved_studies]
    placeholders = ",".join("?" for _ in saved_study_ids)
    dependencies_by_id = {study_id: [] for study_id in saved_study_ids}
    artifacts_by_id = {study_id: [] for study_id in saved_study_ids}
    latest_refresh_by_id: dict[str, dict | None] = {study_id: None for study_id in saved_study_ids}

    with open_runtime_store() as connection:
        dependency_rows = connection.execute(
            f"""
            SELECT *
            FROM saved_study_dependencies
            WHERE saved_study_id IN ({placeholders})
            ORDER BY saved_study_id, dependency_key
            """,
            tuple(saved_study_ids),
        ).fetchall()
        artifact_rows = connection.execute(
            f"""
            SELECT *
            FROM saved_study_artifacts
            WHERE saved_study_id IN ({placeholders})
            ORDER BY saved_study_id, artifact_id DESC
            """,
            tuple(saved_study_ids),
        ).fetchall()
        refresh_rows = connection.execute(
            f"""
            SELECT *
            FROM saved_study_refresh_runs
            WHERE refresh_run_id IN (
                SELECT MAX(refresh_run_id)
                FROM saved_study_refresh_runs
                WHERE saved_study_id IN ({placeholders})
                GROUP BY saved_study_id
            )
            """,
            tuple(saved_study_ids),
        ).fetchall()

    for row in dependency_rows:
        dependencies_by_id.setdefault(row["saved_study_id"], []).append(_row_to_dependency(row))

    seen_artifact_types: set[tuple[str, str]] = set()
    for row in artifact_rows:
        key = (row["saved_study_id"], row["artifact_type"])
        if key in seen_artifact_types:
            continue
        seen_artifact_types.add(key)
        artifacts_by_id.setdefault(row["saved_study_id"], []).append(_row_to_artifact(row))

    for row in refresh_rows:
        latest_refresh_by_id[row["saved_study_id"]] = _row_to_refresh_run(row)

    for saved_study in saved_studies:
        saved_study_id = saved_study["id"]
        artifacts = sorted(
            artifacts_by_id.get(saved_study_id, []),
            key=lambda artifact: artifact["artifactType"],
        )
        saved_study["dependencies"] = dependencies_by_id.get(saved_study_id, [])
        saved_study["artifacts"] = artifacts
        saved_study["latestRefreshRun"] = latest_refresh_by_id.get(saved_study_id)
        for artifact in artifacts:
            if artifact["artifactType"] == "readiness-snapshot":
                saved_study["readiness"] = artifact["artifact"]
            if artifact["artifactType"] == "latest-run-link":
                saved_study["latestRunLink"] = artifact["artifact"]
    return saved_studies


def upsert_saved_study(
    saved_study: dict,
    *,
    open_runtime_store: Callable[[], sqlite3.Connection],
    now_iso: Callable[[], str],
) -> dict:
    saved_study_id = _clean_text(saved_study.get("id"))
    if not saved_study_id:
        raise RuntimeError("Saved study id is required.")
    name = _clean_text(saved_study.get("name"))
    if not name:
        raise RuntimeError("Saved study name is required.")
    plan = saved_study.get("plan")
    if not isinstance(plan, dict):
        raise RuntimeError("Saved study plan is required.")
    route_hash = _clean_text(saved_study.get("routeHash"))
    if not route_hash:
        raise RuntimeError("Saved study route hash is required.")
    now = now_iso()
    current = load_saved_study(
        saved_study_id,
        include_archived=True,
        open_runtime_store=open_runtime_store,
    )
    created_at = _clean_text(saved_study.get("createdAt")) or (current or {}).get("createdAt") or now
    status = _clean_status(saved_study.get("status") or (current or {}).get("status"))
    archived_at = _clean_text(saved_study.get("archivedAt")) if status == "archived" else None

    with open_runtime_store() as connection:
        connection.execute(
            """
            INSERT INTO saved_studies (
                saved_study_id,
                version,
                name,
                status,
                study_id,
                view_id,
                route_hash,
                plan_json,
                keep_warm,
                notes,
                created_at,
                updated_at,
                archived_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(saved_study_id) DO UPDATE SET
                version = excluded.version,
                name = excluded.name,
                status = excluded.status,
                study_id = excluded.study_id,
                view_id = excluded.view_id,
                route_hash = excluded.route_hash,
                plan_json = excluded.plan_json,
                keep_warm = excluded.keep_warm,
                notes = excluded.notes,
                updated_at = excluded.updated_at,
                archived_at = excluded.archived_at
            """,
            (
                saved_study_id,
                _clean_text(saved_study.get("version")) or "saved-study-v1",
                name,
                status,
                _clean_text(saved_study.get("studyId")),
                _clean_text(saved_study.get("viewId")),
                route_hash,
                _json_dumps(plan),
                1 if saved_study.get("keepWarm", True) else 0,
                _clean_text(saved_study.get("notes")),
                created_at,
                now,
                archived_at,
            ),
        )
        connection.commit()
    loaded = load_saved_study(
        saved_study_id,
        include_archived=True,
        open_runtime_store=open_runtime_store,
    )
    if loaded is None:
        raise RuntimeError("Saved study could not be reloaded.")
    return loaded


def replace_saved_study_dependencies(
    saved_study_id: str,
    dependencies: list[dict],
    *,
    open_runtime_store: Callable[[], sqlite3.Connection],
    now_iso: Callable[[], str],
) -> list[dict]:
    now = now_iso()
    with open_runtime_store() as connection:
        connection.execute(
            "DELETE FROM saved_study_dependencies WHERE saved_study_id = ?",
            (saved_study_id,),
        )
        for dependency in dependencies:
            connection.execute(
                """
                INSERT INTO saved_study_dependencies (
                    saved_study_id,
                    dependency_key,
                    dependency_kind,
                    label,
                    query,
                    symbol,
                    universe_id,
                    required_capability,
                    instrument_id,
                    mapping_id,
                    verification_status,
                    issue_json,
                    metadata_json,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    saved_study_id,
                    _clean_text(dependency.get("dependencyKey")),
                    _clean_text(dependency.get("dependencyKind")) or "symbol",
                    _clean_text(dependency.get("label")),
                    _clean_text(dependency.get("query")),
                    _clean_text(dependency.get("symbol")),
                    _clean_text(dependency.get("universeId")),
                    _clean_text(dependency.get("requiredCapability")) or "priceHistory",
                    dependency.get("instrumentId"),
                    dependency.get("mappingId"),
                    _clean_text(dependency.get("verificationStatus")) or "unverified",
                    _json_dumps(dependency.get("issue") or {}),
                    _json_dumps(dependency.get("metadata") or {}),
                    now,
                ),
            )
        connection.commit()

    saved = load_saved_study(
        saved_study_id,
        include_archived=True,
        open_runtime_store=open_runtime_store,
    )
    return saved["dependencies"] if saved else []


def append_saved_study_artifact(
    saved_study_id: str,
    *,
    artifact_type: str,
    artifact_version: str,
    artifact: dict,
    open_runtime_store: Callable[[], sqlite3.Connection],
    now_iso: Callable[[], str],
) -> dict:
    now = now_iso()
    with open_runtime_store() as connection:
        cursor = connection.execute(
            """
            INSERT INTO saved_study_artifacts (
                saved_study_id,
                artifact_type,
                artifact_version,
                artifact_json,
                created_at
            )
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                saved_study_id,
                _clean_text(artifact_type),
                _clean_text(artifact_version),
                _json_dumps(artifact),
                now,
            ),
        )
        row = connection.execute(
            "SELECT * FROM saved_study_artifacts WHERE artifact_id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        connection.commit()
    return _row_to_artifact(row)


def record_saved_study_refresh_run(
    saved_study_id: str,
    *,
    status: str,
    details: dict | None = None,
    refreshed_count: int = 0,
    skipped_count: int = 0,
    failed_count: int = 0,
    open_runtime_store: Callable[[], sqlite3.Connection],
    now_iso: Callable[[], str],
) -> dict:
    now = now_iso()
    with open_runtime_store() as connection:
        cursor = connection.execute(
            """
            INSERT INTO saved_study_refresh_runs (
                saved_study_id,
                status,
                started_at,
                completed_at,
                refreshed_count,
                skipped_count,
                failed_count,
                details_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                saved_study_id,
                _clean_text(status) or "attention",
                now,
                now,
                int(refreshed_count or 0),
                int(skipped_count or 0),
                int(failed_count or 0),
                _json_dumps(details or {}),
            ),
        )
        row = connection.execute(
            "SELECT * FROM saved_study_refresh_runs WHERE refresh_run_id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        connection.commit()
    return _row_to_refresh_run(row)


def load_saved_study(
    saved_study_id: str,
    *,
    include_archived: bool = False,
    open_runtime_store: Callable[[], sqlite3.Connection],
) -> dict | None:
    normalized_id = _clean_text(saved_study_id)
    if not normalized_id:
        return None
    clauses = ["saved_study_id = ?"]
    params: list[object] = [normalized_id]
    if not include_archived:
        clauses.append("status = 'active'")
    with open_runtime_store() as connection:
        row = connection.execute(
            f"""
            SELECT *
            FROM saved_studies
            WHERE {" AND ".join(clauses)}
            LIMIT 1
            """,
            tuple(params),
        ).fetchone()
    if row is None:
        return None
    studies = _attach_saved_study_related(
        [_row_to_saved_study(row)],
        open_runtime_store=open_runtime_store,
    )
    return studies[0] if studies else None


def list_saved_studies(
    *,
    limit: int = 50,
    status: str | None = None,
    include_archived: bool = False,
    open_runtime_store: Callable[[], sqlite3.Connection],
) -> list[dict]:
    normalized_limit = max(1, min(int(limit or 50), 200))
    clauses: list[str] = []
    params: list[object] = []
    if not include_archived:
        clauses.append("status = ?")
        params.append(_clean_status(status))
    elif _clean_text(status):
        clauses.append("status = ?")
        params.append(_clean_status(status))
    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with open_runtime_store() as connection:
        rows = connection.execute(
            f"""
            SELECT *
            FROM saved_studies
            {where_sql}
            ORDER BY updated_at DESC, saved_study_id ASC
            LIMIT ?
            """,
            (*params, normalized_limit),
        ).fetchall()
    return _attach_saved_study_related(
        [_row_to_saved_study(row) for row in rows],
        open_runtime_store=open_runtime_store,
    )


def archive_saved_study(
    saved_study_id: str,
    *,
    open_runtime_store: Callable[[], sqlite3.Connection],
    now_iso: Callable[[], str],
) -> dict | None:
    now = now_iso()
    with open_runtime_store() as connection:
        cursor = connection.execute(
            """
            UPDATE saved_studies
            SET status = 'archived',
                updated_at = ?,
                archived_at = ?
            WHERE saved_study_id = ?
            """,
            (now, now, _clean_text(saved_study_id)),
        )
        connection.commit()
    if int(cursor.rowcount or 0) <= 0:
        return None
    return load_saved_study(
        saved_study_id,
        include_archived=True,
        open_runtime_store=open_runtime_store,
    )


def find_saved_studies_by_route_hash(
    route_hash: str,
    *,
    open_runtime_store: Callable[[], sqlite3.Connection],
) -> list[dict]:
    normalized_route_hash = _clean_text(route_hash)
    if not normalized_route_hash:
        return []
    with open_runtime_store() as connection:
        rows = connection.execute(
            """
            SELECT *
            FROM saved_studies
            WHERE status = 'active' AND route_hash = ?
            ORDER BY updated_at DESC, saved_study_id ASC
            """,
            (normalized_route_hash,),
        ).fetchall()
    return _attach_saved_study_related(
        [_row_to_saved_study(row) for row in rows],
        open_runtime_store=open_runtime_store,
    )
