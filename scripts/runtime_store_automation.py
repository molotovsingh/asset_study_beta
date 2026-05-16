from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone


DEFAULT_AUTOMATION_LABEL = "Daily Maintenance"
DEFAULT_AUTOMATION_KIND = "data-maintenance"


def _clean_text(value) -> str | None:
    text = str(value or "").strip()
    return text or None


def _clean_int(value) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _clean_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _normalize_string_list(values, *, normalize_item=None) -> list[str]:
    if not isinstance(values, list):
        return []
    normalized: list[str] = []
    for raw_value in values:
        text = str(raw_value or "").strip()
        if normalize_item is not None:
            text = normalize_item(text)
        if not text or text in normalized:
            continue
        normalized.append(text)
    return normalized


def _parse_iso_datetime(value: str | None) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _format_summary_json(value) -> str:
    return json.dumps(value or {}, separators=(",", ":"), sort_keys=True)


def _row_to_automation_config(row: sqlite3.Row) -> dict:
    return {
        "automationId": row["automation_id"],
        "label": row["label"],
        "kind": row["kind"],
        "scheduleType": row["schedule_type"],
        "intervalMinutes": int(row["interval_minutes"] or 0),
        "runMarketCollection": bool(row["run_market_collection"]),
        "marketUniverseIds": json.loads(row["market_universe_ids_json"] or "[]"),
        "runOptionsCollection": bool(row["run_options_collection"]),
        "optionsUniverseIds": json.loads(row["options_universe_ids_json"] or "[]"),
        "refreshExchangeSymbolMasters": bool(row["refresh_exchange_symbol_masters"]),
        "marketProviderOrder": json.loads(row["market_provider_order_json"] or "[]"),
        "marketFullSync": bool(row["market_full_sync"]),
        "marketLimit": row["market_limit"],
        "optionsMinimumDte": row["options_minimum_dte"],
        "optionsMaxContracts": row["options_max_contracts"],
        "healthStaleAfterDays": int(row["health_stale_after_days"] or 0),
        "healthSymbolLimit": int(row["health_symbol_limit"] or 0),
        "healthUniverseLimit": int(row["health_universe_limit"] or 0),
        "healthRunLimit": int(row["health_run_limit"] or 0),
        "maxAttentionSymbols": row["max_attention_symbols"],
        "maxSyncErrors": row["max_sync_errors"],
        "isActive": bool(row["is_active"]),
        "isRunning": bool(row["is_running"]),
        "lastRunStartedAt": row["last_run_started_at"],
        "lastRunCompletedAt": row["last_run_completed_at"],
        "lastRunStatus": row["last_run_status"],
        "lastRunSummary": json.loads(row["last_run_summary_json"] or "{}"),
        "lastRunError": row["last_run_error"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def list_automation_configs(*, open_runtime_store) -> list[dict]:
    with open_runtime_store() as connection:
        rows = connection.execute(
            """
            SELECT
                automation_id,
                label,
                kind,
                schedule_type,
                interval_minutes,
                run_market_collection,
                market_universe_ids_json,
                run_options_collection,
                options_universe_ids_json,
                refresh_exchange_symbol_masters,
                market_provider_order_json,
                market_full_sync,
                market_limit,
                options_minimum_dte,
                options_max_contracts,
                health_stale_after_days,
                health_symbol_limit,
                health_universe_limit,
                health_run_limit,
                max_attention_symbols,
                max_sync_errors,
                is_active,
                is_running,
                last_run_started_at,
                last_run_completed_at,
                last_run_status,
                last_run_summary_json,
                last_run_error,
                created_at,
                updated_at
            FROM automation_configs
            ORDER BY lower(label), automation_id
            """
        ).fetchall()
    return [_row_to_automation_config(row) for row in rows]


def load_automation_config(
    automation_id: str,
    *,
    open_runtime_store,
    normalize_dataset_id,
) -> dict | None:
    normalized_automation_id = normalize_dataset_id(automation_id)
    if not normalized_automation_id:
        return None
    with open_runtime_store() as connection:
        row = connection.execute(
            """
            SELECT
                automation_id,
                label,
                kind,
                schedule_type,
                interval_minutes,
                run_market_collection,
                market_universe_ids_json,
                run_options_collection,
                options_universe_ids_json,
                refresh_exchange_symbol_masters,
                market_provider_order_json,
                market_full_sync,
                market_limit,
                options_minimum_dte,
                options_max_contracts,
                health_stale_after_days,
                health_symbol_limit,
                health_universe_limit,
                health_run_limit,
                max_attention_symbols,
                max_sync_errors,
                is_active,
                is_running,
                last_run_started_at,
                last_run_completed_at,
                last_run_status,
                last_run_summary_json,
                last_run_error,
                created_at,
                updated_at
            FROM automation_configs
            WHERE automation_id = ?
            LIMIT 1
            """,
            (normalized_automation_id,),
        ).fetchone()
    return _row_to_automation_config(row) if row is not None else None


def upsert_automation_config(
    automation: dict,
    *,
    open_runtime_store,
    normalize_dataset_id,
    now_iso,
) -> dict:
    normalized_automation_id = normalize_dataset_id(automation.get("automationId") or automation.get("id"))
    if not normalized_automation_id:
        raise RuntimeError("Automation id is required.")

    timestamp = now_iso()
    label = _clean_text(automation.get("label")) or DEFAULT_AUTOMATION_LABEL
    kind = _clean_text(automation.get("kind")) or DEFAULT_AUTOMATION_KIND
    schedule_type = _clean_text(automation.get("scheduleType")) or "interval"
    interval_minutes = max(1, _clean_int(automation.get("intervalMinutes")) or 1440)

    market_universe_ids = _normalize_string_list(
        automation.get("marketUniverseIds"),
        normalize_item=lambda value: normalize_dataset_id(value),
    )
    options_universe_ids = _normalize_string_list(
        automation.get("optionsUniverseIds"),
        normalize_item=lambda value: str(value or "").strip(),
    )
    market_provider_order = _normalize_string_list(
        automation.get("marketProviderOrder"),
        normalize_item=lambda value: str(value or "").strip().lower(),
    )

    with open_runtime_store() as connection:
        connection.execute(
            """
            INSERT INTO automation_configs (
                automation_id,
                label,
                kind,
                schedule_type,
                interval_minutes,
                run_market_collection,
                market_universe_ids_json,
                run_options_collection,
                options_universe_ids_json,
                refresh_exchange_symbol_masters,
                market_provider_order_json,
                market_full_sync,
                market_limit,
                options_minimum_dte,
                options_max_contracts,
                health_stale_after_days,
                health_symbol_limit,
                health_universe_limit,
                health_run_limit,
                max_attention_symbols,
                max_sync_errors,
                is_active,
                is_running,
                last_run_started_at,
                last_run_completed_at,
                last_run_status,
                last_run_summary_json,
                last_run_error,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, '{}', NULL, ?, ?)
            ON CONFLICT(automation_id) DO UPDATE SET
                label = excluded.label,
                kind = excluded.kind,
                schedule_type = excluded.schedule_type,
                interval_minutes = excluded.interval_minutes,
                run_market_collection = excluded.run_market_collection,
                market_universe_ids_json = excluded.market_universe_ids_json,
                run_options_collection = excluded.run_options_collection,
                options_universe_ids_json = excluded.options_universe_ids_json,
                refresh_exchange_symbol_masters = excluded.refresh_exchange_symbol_masters,
                market_provider_order_json = excluded.market_provider_order_json,
                market_full_sync = excluded.market_full_sync,
                market_limit = excluded.market_limit,
                options_minimum_dte = excluded.options_minimum_dte,
                options_max_contracts = excluded.options_max_contracts,
                health_stale_after_days = excluded.health_stale_after_days,
                health_symbol_limit = excluded.health_symbol_limit,
                health_universe_limit = excluded.health_universe_limit,
                health_run_limit = excluded.health_run_limit,
                max_attention_symbols = excluded.max_attention_symbols,
                max_sync_errors = excluded.max_sync_errors,
                is_active = excluded.is_active,
                updated_at = excluded.updated_at
            """,
            (
                normalized_automation_id,
                label,
                kind,
                schedule_type,
                interval_minutes,
                1 if _clean_bool(automation.get("runMarketCollection", True)) else 0,
                json.dumps(market_universe_ids, separators=(",", ":")),
                1 if _clean_bool(automation.get("runOptionsCollection", True)) else 0,
                json.dumps(options_universe_ids, separators=(",", ":")),
                1 if _clean_bool(automation.get("refreshExchangeSymbolMasters", False)) else 0,
                json.dumps(market_provider_order, separators=(",", ":")),
                1 if _clean_bool(automation.get("marketFullSync", False)) else 0,
                _clean_int(automation.get("marketLimit")),
                _clean_int(automation.get("optionsMinimumDte")),
                _clean_int(automation.get("optionsMaxContracts")),
                max(1, _clean_int(automation.get("healthStaleAfterDays")) or 7),
                max(1, _clean_int(automation.get("healthSymbolLimit")) or 20),
                max(1, _clean_int(automation.get("healthUniverseLimit")) or 20),
                max(1, _clean_int(automation.get("healthRunLimit")) or 10),
                _clean_int(automation.get("maxAttentionSymbols")),
                _clean_int(automation.get("maxSyncErrors")),
                1 if _clean_bool(automation.get("isActive", True)) else 0,
                timestamp,
                timestamp,
            ),
        )
        connection.commit()
    return load_automation_config(
        normalized_automation_id,
        open_runtime_store=open_runtime_store,
        normalize_dataset_id=normalize_dataset_id,
    ) or {"automationId": normalized_automation_id, "label": label}


def delete_automation_config(
    automation_id: str,
    *,
    open_runtime_store,
    normalize_dataset_id,
) -> bool:
    normalized_automation_id = normalize_dataset_id(automation_id)
    if not normalized_automation_id:
        return False
    with open_runtime_store() as connection:
        cursor = connection.execute(
            "DELETE FROM automation_configs WHERE automation_id = ?",
            (normalized_automation_id,),
        )
        connection.commit()
    return int(cursor.rowcount or 0) > 0


def update_automation_run_state(
    automation_id: str,
    *,
    is_running: bool,
    started_at: str | None = None,
    completed_at: str | None = None,
    status: str | None = None,
    summary: dict | None = None,
    error: str | None = None,
    open_runtime_store,
    normalize_dataset_id,
    now_iso,
) -> dict | None:
    normalized_automation_id = normalize_dataset_id(automation_id)
    if not normalized_automation_id:
        return None
    timestamp = now_iso()
    with open_runtime_store() as connection:
        connection.execute(
            """
            UPDATE automation_configs
            SET
                is_running = ?,
                last_run_started_at = COALESCE(?, last_run_started_at),
                last_run_completed_at = ?,
                last_run_status = ?,
                last_run_summary_json = ?,
                last_run_error = ?,
                updated_at = ?
            WHERE automation_id = ?
            """,
            (
                1 if is_running else 0,
                started_at,
                completed_at,
                _clean_text(status),
                _format_summary_json(summary),
                _clean_text(error),
                timestamp,
                normalized_automation_id,
            ),
        )
        connection.commit()
    return load_automation_config(
        normalized_automation_id,
        open_runtime_store=open_runtime_store,
        normalize_dataset_id=normalize_dataset_id,
    )


def load_due_automation_configs(
    *,
    open_runtime_store,
    reference_time_iso: str | None = None,
) -> list[dict]:
    reference_time = _parse_iso_datetime(reference_time_iso) or datetime.now(timezone.utc)
    automations = list_automation_configs(open_runtime_store=open_runtime_store)
    due_automations: list[dict] = []
    for automation in automations:
        if not automation.get("isActive") or automation.get("isRunning"):
            continue
        if automation.get("scheduleType") != "interval":
            continue
        interval_minutes = max(1, int(automation.get("intervalMinutes") or 1440))
        last_completed_at = _parse_iso_datetime(automation.get("lastRunCompletedAt"))
        if last_completed_at is None:
            due_automations.append(automation)
            continue
        if last_completed_at + timedelta(minutes=interval_minutes) <= reference_time:
            due_automations.append(automation)
    return due_automations
