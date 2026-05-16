from __future__ import annotations

import json
from collections import Counter
from datetime import date, datetime, timezone

try:
    from runtime_store import (
        CACHE_DB_PATH,
        list_symbol_universes,
        load_recent_options_screener_runs,
        load_tracked_option_positions,
        open_runtime_store,
    )
except ModuleNotFoundError:
    from scripts.runtime_store import (
        CACHE_DB_PATH,
        list_symbol_universes,
        load_recent_options_screener_runs,
        load_tracked_option_positions,
        open_runtime_store,
    )


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


def _parse_date(value: str | None) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        if "T" in text:
            return datetime.fromisoformat(text).date()
        return date.fromisoformat(text)
    except ValueError:
        return None


def _days_since(reference_date: date, value: str | None) -> int | None:
    parsed = _parse_date(value)
    if parsed is None:
        return None
    return max(0, (reference_date - parsed).days)


def _normalize_positive_int(value, *, default: int, minimum: int, maximum: int, label: str) -> int:
    try:
        normalized = int(value if value is not None else default)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} must be an integer.") from error
    if normalized < minimum or normalized > maximum:
        raise ValueError(f"{label} must be between {minimum} and {maximum}.")
    return normalized


def _load_attention_symbols(*, reference_date: date, stale_after_days: int, limit: int) -> tuple[list[dict], dict]:
    with open_runtime_store() as connection:
        rows = connection.execute(
            """
            SELECT
                symbols.symbol,
                symbols.provider,
                symbols.currency,
                symbols.source_series_type,
                sync_state.last_checked_at,
                sync_state.last_price_date,
                sync_state.history_start_date,
                sync_state.history_end_date,
                sync_state.observations,
                sync_state.last_sync_mode,
                sync_state.last_sync_status,
                sync_state.last_sync_message
            FROM symbols
            LEFT JOIN sync_state
              ON sync_state.symbol_id = symbols.symbol_id
            ORDER BY symbols.symbol
            """
        ).fetchall()

    attention_rows: list[dict] = []
    counts = Counter()
    for row in rows:
        days_since_check = _days_since(reference_date, row["last_checked_at"])
        days_since_price = _days_since(reference_date, row["last_price_date"])
        status = str(row["last_sync_status"] or "").strip().lower() or None

        issue = None
        if row["last_checked_at"] is None:
            issue = "never-checked"
        elif status and status != "ok":
            issue = "sync-error"
        elif days_since_check is not None and days_since_check > stale_after_days:
            issue = "stale-check"
        elif days_since_price is not None and days_since_price > stale_after_days:
            issue = "stale-price"

        if issue is None:
            continue

        counts[issue] += 1
        attention_rows.append(
            {
                "symbol": row["symbol"],
                "provider": row["provider"],
                "currency": row["currency"],
                "sourceSeriesType": row["source_series_type"],
                "issue": issue,
                "daysSinceCheck": days_since_check,
                "daysSincePrice": days_since_price,
                "lastCheckedAt": row["last_checked_at"],
                "lastPriceDate": row["last_price_date"],
                "historyStartDate": row["history_start_date"],
                "historyEndDate": row["history_end_date"],
                "observations": int(row["observations"] or 0),
                "lastSyncMode": row["last_sync_mode"],
                "lastSyncStatus": row["last_sync_status"],
                "lastSyncMessage": row["last_sync_message"],
            }
        )

    issue_priority = {
        "sync-error": 0,
        "never-checked": 1,
        "stale-price": 2,
        "stale-check": 3,
    }
    attention_rows.sort(
        key=lambda row: (
            issue_priority.get(str(row["issue"]), 99),
            -(row["daysSincePrice"] or -1),
            -(row["daysSinceCheck"] or -1),
            row["symbol"],
        )
    )
    return attention_rows[:limit], {
        "attentionSymbolCount": len(attention_rows),
        "neverCheckedCount": counts["never-checked"],
        "syncErrorCount": counts["sync-error"],
        "staleCheckCount": counts["stale-check"],
        "stalePriceCount": counts["stale-price"],
    }


def _load_universe_health(*, limit: int) -> list[dict]:
    universes = list_symbol_universes()[:limit]
    if not universes:
        return []

    with open_runtime_store() as connection:
        latest_run_rows = connection.execute(
            """
            WITH ranked_runs AS (
                SELECT
                    run_id,
                    universe_id,
                    mode,
                    requested_provider_order_json,
                    symbol_count,
                    success_count,
                    failure_count,
                    skipped_count,
                    refresh_symbol_master,
                    full_sync,
                    as_of_date,
                    started_at,
                    completed_at,
                    failure_json,
                    ROW_NUMBER() OVER (
                        PARTITION BY universe_id
                        ORDER BY completed_at DESC, run_id DESC
                    ) AS row_rank
                FROM market_collection_runs
            )
            SELECT
                run_id,
                universe_id,
                mode,
                requested_provider_order_json,
                symbol_count,
                success_count,
                failure_count,
                skipped_count,
                refresh_symbol_master,
                full_sync,
                as_of_date,
                started_at,
                completed_at,
                failure_json
            FROM ranked_runs
            WHERE row_rank = 1
            """
        ).fetchall()

    latest_by_universe = {
        row["universe_id"]: {
            "runId": int(row["run_id"]),
            "mode": row["mode"],
            "requestedProviderOrder": json.loads(row["requested_provider_order_json"] or "[]"),
            "symbolCount": int(row["symbol_count"] or 0),
            "successCount": int(row["success_count"] or 0),
            "failureCount": int(row["failure_count"] or 0),
            "skippedCount": int(row["skipped_count"] or 0),
            "refreshSymbolMaster": bool(row["refresh_symbol_master"]),
            "fullSync": bool(row["full_sync"]),
            "asOfDate": row["as_of_date"],
            "startedAt": row["started_at"],
            "completedAt": row["completed_at"],
            "failures": json.loads(row["failure_json"] or "[]"),
        }
        for row in latest_run_rows
    }

    return [
        {
            **universe,
            "latestRun": latest_by_universe.get(universe["universeId"]),
        }
        for universe in universes
    ]


def _load_recent_market_collection_runs(*, limit: int) -> list[dict]:
    with open_runtime_store() as connection:
        rows = connection.execute(
            """
            SELECT
                run_id,
                universe_id,
                universe_label,
                mode,
                requested_provider_order_json,
                symbol_count,
                success_count,
                failure_count,
                skipped_count,
                refresh_symbol_master,
                full_sync,
                as_of_date,
                started_at,
                completed_at,
                failure_json
            FROM market_collection_runs
            ORDER BY completed_at DESC, run_id DESC
            LIMIT ?
            """,
            (max(1, int(limit)),),
        ).fetchall()

    return [
        {
            "runId": int(row["run_id"]),
            "universeId": row["universe_id"],
            "universeLabel": row["universe_label"],
            "mode": row["mode"],
            "requestedProviderOrder": json.loads(row["requested_provider_order_json"] or "[]"),
            "symbolCount": int(row["symbol_count"] or 0),
            "successCount": int(row["success_count"] or 0),
            "failureCount": int(row["failure_count"] or 0),
            "skippedCount": int(row["skipped_count"] or 0),
            "refreshSymbolMaster": bool(row["refresh_symbol_master"]),
            "fullSync": bool(row["full_sync"]),
            "asOfDate": row["as_of_date"],
            "startedAt": row["started_at"],
            "completedAt": row["completed_at"],
            "failures": json.loads(row["failure_json"] or "[]"),
        }
        for row in rows
    ]


def _load_open_position_health(*, reference_date: date, limit: int) -> tuple[list[dict], dict]:
    with open_runtime_store() as connection:
        rows = connection.execute(
            """
            SELECT
                positions.position_id,
                symbols.symbol,
                positions.strategy,
                positions.signal_version,
                positions.entry_as_of_date,
                positions.expiry,
                positions.provider,
                positions.primary_trade_idea,
                MAX(marks.mark_date) AS last_mark_date,
                COUNT(marks.mark_date) AS mark_count
            FROM tracked_option_positions AS positions
            INNER JOIN symbols
              ON symbols.symbol_id = positions.symbol_id
            LEFT JOIN tracked_option_marks AS marks
              ON marks.position_id = positions.position_id
            WHERE positions.closed_at IS NULL
            GROUP BY
                positions.position_id,
                symbols.symbol,
                positions.strategy,
                positions.signal_version,
                positions.entry_as_of_date,
                positions.expiry,
                positions.provider,
                positions.primary_trade_idea
            ORDER BY positions.entry_as_of_date DESC, positions.position_id DESC
            LIMIT ?
            """,
            (max(1, int(limit)),),
        ).fetchall()

    positions = [
        {
            "positionId": int(row["position_id"]),
            "symbol": row["symbol"],
            "strategy": row["strategy"],
            "signalVersion": row["signal_version"],
            "entryAsOfDate": row["entry_as_of_date"],
            "expiry": row["expiry"],
            "provider": row["provider"],
            "primaryTradeIdea": row["primary_trade_idea"],
            "lastMarkDate": row["last_mark_date"],
            "markCount": int(row["mark_count"] or 0),
            "daysSinceLastMark": _days_since(reference_date, row["last_mark_date"]),
        }
        for row in rows
    ]

    strategy_counts = Counter(position["strategy"] for position in positions)
    without_marks = sum(1 for position in positions if position["markCount"] <= 0)
    return positions, {
        "openTrackedPositionCount": len(positions),
        "openPositionsWithoutMarks": without_marks,
        "openPositionStrategies": dict(strategy_counts),
    }


def build_runtime_health_payload(request: dict | None = None) -> dict:
    request = request or {}
    stale_after_days = _normalize_positive_int(
        request.get("staleAfterDays"),
        default=7,
        minimum=1,
        maximum=365,
        label="staleAfterDays",
    )
    symbol_limit = _normalize_positive_int(
        request.get("symbolLimit"),
        default=20,
        minimum=1,
        maximum=200,
        label="symbolLimit",
    )
    universe_limit = _normalize_positive_int(
        request.get("universeLimit"),
        default=20,
        minimum=1,
        maximum=100,
        label="universeLimit",
    )
    run_limit = _normalize_positive_int(
        request.get("runLimit"),
        default=10,
        minimum=1,
        maximum=100,
        label="runLimit",
    )

    reference_date = _parse_date(request.get("asOfDate")) or _utc_today()

    with open_runtime_store() as connection:
        summary_row = connection.execute(
            """
            SELECT
                (SELECT COUNT(*) FROM symbols) AS total_symbols,
                (SELECT COUNT(*) FROM sync_state WHERE observations > 0) AS synced_symbols,
                (SELECT COUNT(*) FROM symbol_universes) AS total_universes,
                (SELECT COUNT(*) FROM market_collection_runs) AS total_collection_runs,
                (SELECT COUNT(*) FROM options_screener_runs) AS total_screener_runs,
                (SELECT COUNT(*) FROM tracked_option_positions) AS total_tracked_positions,
                (SELECT COUNT(*) FROM tracked_option_positions WHERE closed_at IS NULL) AS open_tracked_positions,
                (SELECT COUNT(*) FROM tracked_option_marks) AS total_tracked_marks
            """
        ).fetchone()

    attention_symbols, attention_counts = _load_attention_symbols(
        reference_date=reference_date,
        stale_after_days=stale_after_days,
        limit=symbol_limit,
    )
    universe_health = _load_universe_health(limit=universe_limit)
    recent_collection_runs = _load_recent_market_collection_runs(limit=run_limit)
    open_position_health, position_counts = _load_open_position_health(
        reference_date=reference_date,
        limit=run_limit,
    )
    recent_screener_runs = load_recent_options_screener_runs(limit=run_limit)
    tracked_positions_total = load_tracked_option_positions(open_only=False, limit=5000)
    closed_tracked_position_count = sum(1 for position in tracked_positions_total if position.get("closedAt"))

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "referenceDate": reference_date.isoformat(),
        "databasePath": str(CACHE_DB_PATH),
        "thresholds": {
            "staleAfterDays": stale_after_days,
            "symbolLimit": symbol_limit,
            "universeLimit": universe_limit,
            "runLimit": run_limit,
        },
        "summary": {
            "totalSymbols": int(summary_row["total_symbols"] or 0),
            "syncedSymbols": int(summary_row["synced_symbols"] or 0),
            "totalUniverses": int(summary_row["total_universes"] or 0),
            "totalCollectionRuns": int(summary_row["total_collection_runs"] or 0),
            "totalScreenerRuns": int(summary_row["total_screener_runs"] or 0),
            "totalTrackedPositions": int(summary_row["total_tracked_positions"] or 0),
            "closedTrackedPositionCount": closed_tracked_position_count,
            "openTrackedPositionCount": int(summary_row["open_tracked_positions"] or 0),
            "totalTrackedMarks": int(summary_row["total_tracked_marks"] or 0),
            **attention_counts,
        },
        "attentionSymbols": attention_symbols,
        "universeHealth": universe_health,
        "recentCollectionRuns": recent_collection_runs,
        "recentScreenerRuns": recent_screener_runs,
        "openPositionHealth": open_position_health,
        "positionSummary": position_counts,
    }
