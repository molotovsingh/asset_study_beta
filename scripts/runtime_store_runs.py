from __future__ import annotations

import json
import sqlite3


def _clean_text(value) -> str | None:
    text = str(value or "").strip()
    return text or None


def _clean_json_object(value) -> dict:
    return value if isinstance(value, dict) else {}


def _clean_json_list(value) -> list:
    return value if isinstance(value, list) else []


def _clean_warning_messages(*values) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, list):
            continue
        for item in value:
            message = _clean_text(item)
            if not message or message in seen:
                continue
            seen.add(message)
            cleaned.append(message)
    return cleaned


def _summary_item_from_row(row: sqlite3.Row) -> dict:
    return {
        "summaryKey": row["summary_key"],
        "label": row["label"],
        "valueText": row["value_text"],
        "valueNumber": row["value_number"],
        "valueKind": row["value_kind"],
        "sortOrder": int(row["sort_order"] or 0),
    }


def _link_item_from_row(row: sqlite3.Row) -> dict:
    return {
        "linkType": row["link_type"],
        "targetKind": row["target_kind"],
        "targetId": row["target_id"],
        "targetLabel": row["target_label"],
        "metadata": json.loads(row["metadata_json"] or "{}"),
        "sortOrder": int(row["sort_order"] or 0),
    }


def _clean_summary_items(value) -> list[dict]:
    if not isinstance(value, list):
        return []
    cleaned: list[dict] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            continue
        label = _clean_text(item.get("label"))
        summary_key = _clean_text(item.get("summaryKey") or item.get("key"))
        value_kind = _clean_text(item.get("valueKind")) or "text"
        value_text = _clean_text(item.get("valueText"))
        raw_number = item.get("valueNumber")
        try:
            value_number = float(raw_number) if raw_number not in (None, "") else None
        except (TypeError, ValueError):
            value_number = None
        if not label:
            continue
        cleaned.append(
            {
                "summaryKey": summary_key or f"summary-{index + 1}",
                "label": label,
                "valueText": value_text,
                "valueNumber": value_number,
                "valueKind": value_kind,
                "sortOrder": int(item.get("sortOrder") or index),
            }
        )
    return cleaned


def _clean_links(value) -> list[dict]:
    if not isinstance(value, list):
        return []
    cleaned: list[dict] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            continue
        link_type = _clean_text(item.get("linkType"))
        target_kind = _clean_text(item.get("targetKind"))
        target_id = _clean_text(item.get("targetId"))
        if not link_type or not target_kind or not target_id:
            continue
        cleaned.append(
            {
                "linkType": link_type,
                "targetKind": target_kind,
                "targetId": target_id,
                "targetLabel": _clean_text(item.get("targetLabel")),
                "metadata": _clean_json_object(item.get("metadata")),
                "sortOrder": int(item.get("sortOrder") or index),
            }
        )
    return cleaned


def _row_to_study_run(row: sqlite3.Row) -> dict:
    return {
        "runId": int(row["run_id"]),
        "studyId": row["study_id"],
        "studyTitle": row["study_title"],
        "viewId": row["view_id"],
        "selectionLabel": row["selection_label"],
        "subjectQuery": row["subject_query"],
        "symbol": row["symbol"],
        "status": row["status"],
        "routeHash": row["route_hash"],
        "requestedStartDate": row["requested_start_date"],
        "requestedEndDate": row["requested_end_date"],
        "actualStartDate": row["actual_start_date"],
        "actualEndDate": row["actual_end_date"],
        "detailLabel": row["detail_label"],
        "requestedParams": json.loads(row["requested_params_json"] or "{}"),
        "resolvedParams": json.loads(row["resolved_params_json"] or "{}"),
        "providerSummary": json.loads(row["provider_summary_json"] or "{}"),
        "dataSnapshotRefs": json.loads(row["data_snapshot_refs_json"] or "[]"),
        "warningCount": int(row["warning_count"] or 0),
        "errorMessage": row["error_message"],
        "runKind": row["run_kind"],
        "startedAt": row["started_at"],
        "completedAt": row["completed_at"],
        "createdAt": row["created_at"],
        "summaryItems": [],
        "links": [],
    }


def _attach_related_records(
    runs: list[dict],
    *,
    open_runtime_store,
) -> list[dict]:
    if not runs:
        return runs

    run_ids = [int(run["runId"]) for run in runs]
    placeholders = ",".join("?" for _ in run_ids)
    summaries_by_run_id = {run_id: [] for run_id in run_ids}
    links_by_run_id = {run_id: [] for run_id in run_ids}

    with open_runtime_store() as connection:
        summary_rows = connection.execute(
            f"""
            SELECT
                run_id,
                summary_key,
                label,
                value_text,
                value_number,
                value_kind,
                sort_order
            FROM study_run_summaries
            WHERE run_id IN ({placeholders})
            ORDER BY run_id, sort_order, summary_id
            """,
            tuple(run_ids),
        ).fetchall()
        link_rows = connection.execute(
            f"""
            SELECT
                run_id,
                link_type,
                target_kind,
                target_id,
                target_label,
                metadata_json,
                sort_order
            FROM study_run_links
            WHERE run_id IN ({placeholders})
            ORDER BY run_id, sort_order, link_id
            """,
            tuple(run_ids),
        ).fetchall()

    for row in summary_rows:
        summaries_by_run_id.setdefault(int(row["run_id"]), []).append(
            _summary_item_from_row(row)
        )
    for row in link_rows:
        links_by_run_id.setdefault(int(row["run_id"]), []).append(
            _link_item_from_row(row)
        )

    for run in runs:
        run_id = int(run["runId"])
        run["summaryItems"] = summaries_by_run_id.get(run_id, [])
        run["links"] = links_by_run_id.get(run_id, [])
    return runs


def load_study_run_by_id(
    run_id: int,
    *,
    open_runtime_store,
) -> dict | None:
    with open_runtime_store() as connection:
        row = connection.execute(
            """
            SELECT
                run_id,
                study_id,
                study_title,
                view_id,
                selection_label,
                subject_query,
                symbol,
                status,
                route_hash,
                requested_start_date,
                requested_end_date,
                actual_start_date,
                actual_end_date,
                detail_label,
                requested_params_json,
                resolved_params_json,
                provider_summary_json,
                data_snapshot_refs_json,
                warning_count,
                error_message,
                run_kind,
                started_at,
                completed_at,
                created_at
            FROM study_runs
            WHERE run_id = ?
            LIMIT 1
            """,
            (int(run_id),),
        ).fetchone()
    if row is None:
        return None
    runs = _attach_related_records(
        [_row_to_study_run(row)],
        open_runtime_store=open_runtime_store,
    )
    return runs[0] if runs else None


def list_study_runs(
    *,
    limit: int = 25,
    study_id: str | None = None,
    status: str | None = None,
    open_runtime_store,
    normalize_dataset_id,
) -> list[dict]:
    normalized_limit = max(1, int(limit or 25))
    clauses: list[str] = []
    params: list[object] = []

    normalized_study_id = normalize_dataset_id(study_id)
    if normalized_study_id:
        clauses.append("study_id = ?")
        params.append(normalized_study_id)

    normalized_status = _clean_text(status)
    if normalized_status:
        clauses.append("status = ?")
        params.append(normalized_status)

    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with open_runtime_store() as connection:
        rows = connection.execute(
            f"""
            SELECT
                run_id,
                study_id,
                study_title,
                view_id,
                selection_label,
                subject_query,
                symbol,
                status,
                route_hash,
                requested_start_date,
                requested_end_date,
                actual_start_date,
                actual_end_date,
                detail_label,
                requested_params_json,
                resolved_params_json,
                provider_summary_json,
                data_snapshot_refs_json,
                warning_count,
                error_message,
                run_kind,
                started_at,
                completed_at,
                created_at
            FROM study_runs
            {where_sql}
            ORDER BY completed_at DESC, run_id DESC
            LIMIT ?
            """,
            (*params, normalized_limit),
        ).fetchall()
    return _attach_related_records(
        [_row_to_study_run(row) for row in rows],
        open_runtime_store=open_runtime_store,
    )


def record_study_run(
    study_run: dict,
    *,
    open_runtime_store,
    normalize_dataset_id,
    normalize_symbol,
    now_iso,
) -> dict:
    study_id = normalize_dataset_id(study_run.get("studyId"))
    if not study_id:
        raise RuntimeError("Study id is required.")

    study_title = _clean_text(study_run.get("studyTitle"))
    if not study_title:
        raise RuntimeError("Study title is required.")

    selection_label = _clean_text(study_run.get("selectionLabel"))
    if not selection_label:
        raise RuntimeError("Selection label is required.")

    subject_query = _clean_text(study_run.get("subjectQuery"))
    if not subject_query:
        raise RuntimeError("Subject query is required.")

    completed_at = _clean_text(study_run.get("completedAt")) or now_iso()
    created_at = _clean_text(study_run.get("createdAt")) or completed_at
    route_hash = _clean_text(study_run.get("routeHash"))
    if route_hash and not route_hash.startswith("#"):
        route_hash = None
    requested_params = _clean_json_object(study_run.get("requestedParams"))
    resolved_params = dict(_clean_json_object(study_run.get("resolvedParams")))
    warning_messages = _clean_warning_messages(
        study_run.get("warningMessages"),
        study_run.get("warnings"),
        resolved_params.get("warningMessages"),
        resolved_params.get("warnings"),
    )
    if warning_messages:
        resolved_params["warningMessages"] = warning_messages
    try:
        requested_warning_count = int(study_run.get("warningCount") or 0)
    except (TypeError, ValueError):
        requested_warning_count = 0
    warning_count = max(0, requested_warning_count, len(warning_messages))
    summary_items = _clean_summary_items(study_run.get("summaryItems"))
    links = _clean_links(study_run.get("links"))

    with open_runtime_store() as connection:
        cursor = connection.execute(
            """
            INSERT INTO study_runs (
                study_id,
                study_title,
                view_id,
                selection_label,
                subject_query,
                symbol,
                status,
                route_hash,
                requested_start_date,
                requested_end_date,
                actual_start_date,
                actual_end_date,
                detail_label,
                requested_params_json,
                resolved_params_json,
                provider_summary_json,
                data_snapshot_refs_json,
                warning_count,
                error_message,
                run_kind,
                started_at,
                completed_at,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                study_id,
                study_title,
                _clean_text(study_run.get("viewId")),
                selection_label,
                subject_query,
                normalize_symbol(study_run.get("symbol")) or None,
                _clean_text(study_run.get("status")) or "success",
                route_hash,
                _clean_text(study_run.get("requestedStartDate")),
                _clean_text(study_run.get("requestedEndDate")),
                _clean_text(study_run.get("actualStartDate")),
                _clean_text(study_run.get("actualEndDate")),
                _clean_text(study_run.get("detailLabel")),
                json.dumps(
                    requested_params,
                    separators=(",", ":"),
                    sort_keys=True,
                ),
                json.dumps(
                    resolved_params,
                    separators=(",", ":"),
                    sort_keys=True,
                ),
                json.dumps(
                    _clean_json_object(study_run.get("providerSummary")),
                    separators=(",", ":"),
                    sort_keys=True,
                ),
                json.dumps(
                    _clean_json_list(study_run.get("dataSnapshotRefs")),
                    separators=(",", ":"),
                ),
                warning_count,
                _clean_text(study_run.get("errorMessage")),
                _clean_text(study_run.get("runKind")) or "analysis",
                _clean_text(study_run.get("startedAt")),
                completed_at,
                created_at,
            ),
        )
        run_id = int(cursor.lastrowid)

        if summary_items:
            connection.executemany(
                """
                INSERT INTO study_run_summaries (
                    run_id,
                    summary_key,
                    label,
                    value_text,
                    value_number,
                    value_kind,
                    sort_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        run_id,
                        item["summaryKey"],
                        item["label"],
                        item["valueText"],
                        item["valueNumber"],
                        item["valueKind"],
                        item["sortOrder"],
                    )
                    for item in summary_items
                ],
            )
        if links:
            connection.executemany(
                """
                INSERT INTO study_run_links (
                    run_id,
                    link_type,
                    target_kind,
                    target_id,
                    target_label,
                    metadata_json,
                    sort_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        run_id,
                        item["linkType"],
                        item["targetKind"],
                        item["targetId"],
                        item["targetLabel"],
                        json.dumps(item["metadata"], separators=(",", ":"), sort_keys=True),
                        item["sortOrder"],
                    )
                    for item in links
                ],
            )
        connection.commit()

    runs = list_study_runs(
        limit=1,
        open_runtime_store=open_runtime_store,
        normalize_dataset_id=normalize_dataset_id,
        status=None,
        study_id=None,
    )
    if runs and runs[0]["runId"] == run_id:
        return runs[0]

    recorded_run = load_study_run_by_id(
        run_id,
        open_runtime_store=open_runtime_store,
    )
    if recorded_run is None:
        raise RuntimeError("Recorded study run could not be reloaded.")
    return recorded_run
