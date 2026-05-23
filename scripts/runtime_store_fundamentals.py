from __future__ import annotations

import json
import sqlite3


def _json_dumps(value) -> str:
    return json.dumps(value if value is not None else {}, separators=(",", ":"), sort_keys=True)


def _json_loads(value: str | None, default):
    if not value:
        return default
    try:
        decoded = json.loads(value)
    except json.JSONDecodeError:
        return default
    return decoded


def _clean_text(value) -> str | None:
    text = str(value or "").strip()
    return text or None


def _clean_number(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _row_to_universe(row: sqlite3.Row) -> dict:
    return {
        "universeId": row["universe_id"],
        "label": row["label"],
        "sourceProvider": row["source_provider"],
        "sourceKind": row["source_kind"],
        "sourceSymbol": row["source_symbol"],
        "sourceUrl": row["source_url"],
        "asOfDate": row["as_of_date"],
        "memberCount": int(row["member_count"] or 0),
        "activeMembers": int(row["active_members"] or 0) if "active_members" in row.keys() else int(row["member_count"] or 0),
        "note": row["note"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _row_to_member(row: sqlite3.Row) -> dict:
    return {
        "universeId": row["universe_id"],
        "symbol": row["symbol"],
        "providerSymbol": row["provider_symbol"],
        "label": row["label"],
        "exchange": row["exchange"],
        "mic": row["mic"],
        "sector": row["sector"],
        "industry": row["industry"],
        "currency": row["currency"],
        "isin": row["isin"],
        "cusip": row["cusip"],
        "weight": row["weight"],
        "isActive": bool(row["is_active"]),
        "sourceProvider": row["source_provider"],
        "metadata": _json_loads(row["metadata_json"], {}),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _row_to_snapshot(row: sqlite3.Row) -> dict:
    return {
        "snapshotId": int(row["snapshot_id"]),
        "universeId": row["universe_id"],
        "symbol": row["symbol"],
        "providerSymbol": row["provider_symbol"],
        "provider": row["provider"],
        "asOfDate": row["as_of_date"],
        "periodStartDate": row["period_start_date"],
        "periodEndDate": row["period_end_date"],
        "metricType": row["metric_type"],
        "sourceUrl": row["source_url"],
        "fetchedAt": row["fetched_at"],
        "metricCount": int(row["metric_count"] or 0),
        "seriesMetricCount": int(row["series_metric_count"] or 0),
        "rawPayload": _json_loads(row["raw_payload_json"], {}),
    }


def upsert_fundamental_universe(
    *,
    universe_id: str,
    label: str,
    source_provider: str,
    source_kind: str,
    source_symbol: str | None,
    source_url: str | None,
    as_of_date: str | None,
    member_count: int,
    note: str | None,
    normalize_dataset_id,
    to_iso,
    now_utc,
    open_runtime_store,
) -> dict:
    normalized_id = normalize_dataset_id(universe_id)
    if not normalized_id:
        raise ValueError("Fundamental universe id is required.")
    timestamp = to_iso(now_utc())

    with open_runtime_store() as connection:
        connection.execute(
            """
            INSERT INTO fundamental_universes (
                universe_id,
                label,
                source_provider,
                source_kind,
                source_symbol,
                source_url,
                as_of_date,
                member_count,
                note,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(universe_id) DO UPDATE SET
                label = excluded.label,
                source_provider = excluded.source_provider,
                source_kind = excluded.source_kind,
                source_symbol = excluded.source_symbol,
                source_url = excluded.source_url,
                as_of_date = excluded.as_of_date,
                member_count = excluded.member_count,
                note = excluded.note,
                updated_at = excluded.updated_at
            """,
            (
                normalized_id,
                str(label or normalized_id).strip() or normalized_id,
                str(source_provider or "").strip().lower() or "unknown",
                str(source_kind or "manual").strip().lower() or "manual",
                _clean_text(source_symbol),
                _clean_text(source_url),
                _clean_text(as_of_date),
                max(0, int(member_count or 0)),
                _clean_text(note),
                timestamp,
                timestamp,
            ),
        )
        connection.commit()

    return load_fundamental_universe(
        normalized_id,
        normalize_dataset_id=normalize_dataset_id,
        open_runtime_store=open_runtime_store,
    )


def sync_fundamental_universe_members(
    universe_id: str,
    members: list[dict],
    *,
    source_provider: str | None = None,
    replace: bool = True,
    normalize_dataset_id,
    normalize_symbol,
    to_iso,
    now_utc,
    open_runtime_store,
) -> list[dict]:
    normalized_id = normalize_dataset_id(universe_id)
    if not normalized_id:
        raise ValueError("Fundamental universe id is required.")

    timestamp = to_iso(now_utc())
    normalized_members: list[dict] = []
    seen_symbols: set[str] = set()
    for raw_member in members:
        provider_symbol = normalize_symbol(raw_member.get("providerSymbol") or raw_member.get("symbol"))
        symbol = normalize_symbol(raw_member.get("symbol") or provider_symbol)
        if not symbol or symbol in seen_symbols:
            continue
        seen_symbols.add(symbol)
        normalized_members.append(
            {
                "symbol": symbol,
                "providerSymbol": provider_symbol or symbol,
                "label": _clean_text(raw_member.get("label")) or symbol,
                "exchange": _clean_text(raw_member.get("exchange")),
                "mic": _clean_text(raw_member.get("mic")),
                "sector": _clean_text(raw_member.get("sector")),
                "industry": _clean_text(raw_member.get("industry")),
                "currency": _clean_text(raw_member.get("currency")),
                "isin": _clean_text(raw_member.get("isin")),
                "cusip": _clean_text(raw_member.get("cusip")),
                "weight": _clean_number(raw_member.get("weight")),
                "sourceProvider": str(raw_member.get("sourceProvider") or source_provider or "").strip().lower() or None,
                "metadata": raw_member.get("metadata") if isinstance(raw_member.get("metadata"), dict) else {},
            },
        )

    with open_runtime_store() as connection:
        if replace:
            connection.execute(
                """
                UPDATE fundamental_universe_members
                SET is_active = 0,
                    updated_at = ?
                WHERE universe_id = ?
                """,
                (timestamp, normalized_id),
            )

        connection.executemany(
            """
            INSERT INTO fundamental_universe_members (
                universe_id,
                symbol,
                provider_symbol,
                label,
                exchange,
                mic,
                sector,
                industry,
                currency,
                isin,
                cusip,
                weight,
                is_active,
                source_provider,
                metadata_json,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
            ON CONFLICT(universe_id, symbol) DO UPDATE SET
                provider_symbol = excluded.provider_symbol,
                label = excluded.label,
                exchange = excluded.exchange,
                mic = excluded.mic,
                sector = excluded.sector,
                industry = excluded.industry,
                currency = excluded.currency,
                isin = excluded.isin,
                cusip = excluded.cusip,
                weight = excluded.weight,
                is_active = 1,
                source_provider = excluded.source_provider,
                metadata_json = excluded.metadata_json,
                updated_at = excluded.updated_at
            """,
            [
                (
                    normalized_id,
                    member["symbol"],
                    member["providerSymbol"],
                    member["label"],
                    member["exchange"],
                    member["mic"],
                    member["sector"],
                    member["industry"],
                    member["currency"],
                    member["isin"],
                    member["cusip"],
                    member["weight"],
                    member["sourceProvider"],
                    _json_dumps(member["metadata"]),
                    timestamp,
                    timestamp,
                )
                for member in normalized_members
            ],
        )

        active_count = connection.execute(
            """
            SELECT count(*) AS count
            FROM fundamental_universe_members
            WHERE universe_id = ?
              AND is_active = 1
            """,
            (normalized_id,),
        ).fetchone()["count"]
        connection.execute(
            """
            UPDATE fundamental_universes
            SET member_count = ?,
                updated_at = ?
            WHERE universe_id = ?
            """,
            (int(active_count or 0), timestamp, normalized_id),
        )
        connection.commit()

    return load_fundamental_universe_members(
        normalized_id,
        include_inactive=True,
        normalize_dataset_id=normalize_dataset_id,
        open_runtime_store=open_runtime_store,
    )


def load_fundamental_universe(
    universe_id: str,
    *,
    normalize_dataset_id,
    open_runtime_store,
) -> dict | None:
    normalized_id = normalize_dataset_id(universe_id)
    if not normalized_id:
        return None
    with open_runtime_store() as connection:
        row = connection.execute(
            """
            SELECT
                universe_id,
                label,
                source_provider,
                source_kind,
                source_symbol,
                source_url,
                as_of_date,
                member_count,
                note,
                created_at,
                updated_at
            FROM fundamental_universes
            WHERE universe_id = ?
            """,
            (normalized_id,),
        ).fetchone()
    return _row_to_universe(row) if row is not None else None


def list_fundamental_universes(*, open_runtime_store) -> list[dict]:
    with open_runtime_store() as connection:
        rows = connection.execute(
            """
            SELECT
                universes.universe_id,
                universes.label,
                universes.source_provider,
                universes.source_kind,
                universes.source_symbol,
                universes.source_url,
                universes.as_of_date,
                universes.member_count,
                COALESCE(active_counts.active_members, 0) AS active_members,
                universes.note,
                universes.created_at,
                universes.updated_at
            FROM fundamental_universes AS universes
            LEFT JOIN (
                SELECT universe_id, count(*) AS active_members
                FROM fundamental_universe_members
                WHERE is_active = 1
                GROUP BY universe_id
            ) AS active_counts
              ON active_counts.universe_id = universes.universe_id
            ORDER BY universes.updated_at DESC, universes.universe_id
            """
        ).fetchall()
    return [_row_to_universe(row) for row in rows]


def load_fundamental_universe_members(
    universe_id: str,
    *,
    include_inactive: bool = False,
    normalize_dataset_id,
    open_runtime_store,
) -> list[dict]:
    normalized_id = normalize_dataset_id(universe_id)
    if not normalized_id:
        return []
    query = """
        SELECT
            universe_id,
            symbol,
            provider_symbol,
            label,
            exchange,
            mic,
            sector,
            industry,
            currency,
            isin,
            cusip,
            weight,
            is_active,
            source_provider,
            metadata_json,
            created_at,
            updated_at
        FROM fundamental_universe_members
        WHERE universe_id = ?
    """
    params: list[object] = [normalized_id]
    if not include_inactive:
        query += " AND is_active = 1"
    query += " ORDER BY weight DESC, symbol"
    with open_runtime_store() as connection:
        rows = connection.execute(query, params).fetchall()
    return [_row_to_member(row) for row in rows]


def upsert_fundamental_snapshot(
    snapshot: dict,
    metrics: list[dict],
    *,
    normalize_dataset_id,
    normalize_symbol,
    to_iso,
    now_utc,
    open_runtime_store,
) -> dict:
    universe_id = normalize_dataset_id(snapshot.get("universeId"))
    symbol = normalize_symbol(snapshot.get("symbol"))
    provider_symbol = normalize_symbol(snapshot.get("providerSymbol") or symbol)
    provider = str(snapshot.get("provider") or "").strip().lower() or "unknown"
    as_of_date = str(snapshot.get("asOfDate") or "").strip()[:10]
    metric_type = str(snapshot.get("metricType") or "all").strip() or "all"
    if not universe_id or not symbol or not provider_symbol or not as_of_date:
        raise ValueError("Fundamental snapshot requires universeId, symbol, providerSymbol, and asOfDate.")

    timestamp = str(snapshot.get("fetchedAt") or to_iso(now_utc())).strip()
    raw_payload = snapshot.get("rawPayload") if isinstance(snapshot.get("rawPayload"), dict) else {}
    metric_count = int(snapshot.get("metricCount") or 0)
    series_metric_count = int(snapshot.get("seriesMetricCount") or 0)

    with open_runtime_store() as connection:
        connection.execute(
            """
            INSERT INTO fundamental_snapshots (
                universe_id,
                symbol,
                provider_symbol,
                provider,
                as_of_date,
                period_start_date,
                period_end_date,
                metric_type,
                source_url,
                fetched_at,
                raw_payload_json,
                metric_count,
                series_metric_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(universe_id, provider_symbol, provider, as_of_date, metric_type) DO UPDATE SET
                symbol = excluded.symbol,
                period_start_date = excluded.period_start_date,
                period_end_date = excluded.period_end_date,
                source_url = excluded.source_url,
                fetched_at = excluded.fetched_at,
                raw_payload_json = excluded.raw_payload_json,
                metric_count = excluded.metric_count,
                series_metric_count = excluded.series_metric_count
            """,
            (
                universe_id,
                symbol,
                provider_symbol,
                provider,
                as_of_date,
                _clean_text(snapshot.get("periodStartDate")),
                _clean_text(snapshot.get("periodEndDate")),
                metric_type,
                _clean_text(snapshot.get("sourceUrl")),
                timestamp,
                _json_dumps(raw_payload),
                metric_count,
                series_metric_count,
            ),
        )
        snapshot_row = connection.execute(
            """
            SELECT snapshot_id
            FROM fundamental_snapshots
            WHERE universe_id = ?
              AND provider_symbol = ?
              AND provider = ?
              AND as_of_date = ?
              AND metric_type = ?
            """,
            (universe_id, provider_symbol, provider, as_of_date, metric_type),
        ).fetchone()
        if snapshot_row is None:
            raise RuntimeError("Could not persist fundamental snapshot.")
        snapshot_id = int(snapshot_row["snapshot_id"])

        connection.execute(
            "DELETE FROM fundamental_metrics WHERE snapshot_id = ?",
            (snapshot_id,),
        )
        connection.executemany(
            """
            INSERT INTO fundamental_metrics (
                snapshot_id,
                metric_name,
                period_type,
                period_end_date,
                value_number,
                value_text,
                unit,
                source_field
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    snapshot_id,
                    str(metric.get("metricName") or "").strip(),
                    str(metric.get("periodType") or "snapshot").strip().lower() or "snapshot",
                    _clean_text(metric.get("periodEndDate")),
                    _clean_number(metric.get("valueNumber")),
                    _clean_text(metric.get("valueText")),
                    _clean_text(metric.get("unit")),
                    _clean_text(metric.get("sourceField")),
                )
                for metric in metrics
                if str(metric.get("metricName") or "").strip()
            ],
        )
        connection.commit()

    return load_fundamental_snapshot(
        snapshot_id,
        open_runtime_store=open_runtime_store,
    )


def load_fundamental_snapshot(
    snapshot_id: int,
    *,
    open_runtime_store,
) -> dict:
    with open_runtime_store() as connection:
        row = connection.execute(
            """
            SELECT
                snapshot_id,
                universe_id,
                symbol,
                provider_symbol,
                provider,
                as_of_date,
                period_start_date,
                period_end_date,
                metric_type,
                source_url,
                fetched_at,
                raw_payload_json,
                metric_count,
                series_metric_count
            FROM fundamental_snapshots
            WHERE snapshot_id = ?
            """,
            (int(snapshot_id),),
        ).fetchone()
    if row is None:
        raise RuntimeError(f"Fundamental snapshot {snapshot_id} was not found.")
    return _row_to_snapshot(row)


def load_fundamental_snapshots(
    *,
    universe_id: str | None = None,
    symbol: str | None = None,
    limit: int = 50,
    normalize_dataset_id,
    normalize_symbol,
    open_runtime_store,
) -> list[dict]:
    query = """
        SELECT
            snapshot_id,
            universe_id,
            symbol,
            provider_symbol,
            provider,
            as_of_date,
            period_start_date,
            period_end_date,
            metric_type,
            source_url,
            fetched_at,
            raw_payload_json,
            metric_count,
            series_metric_count
        FROM fundamental_snapshots
        WHERE 1 = 1
    """
    params: list[object] = []
    if universe_id:
        query += " AND universe_id = ?"
        params.append(normalize_dataset_id(universe_id))
    if symbol:
        query += " AND symbol = ?"
        params.append(normalize_symbol(symbol))
    query += " ORDER BY fetched_at DESC, snapshot_id DESC LIMIT ?"
    params.append(max(1, int(limit or 50)))
    with open_runtime_store() as connection:
        rows = connection.execute(query, params).fetchall()
    return [_row_to_snapshot(row) for row in rows]


def load_fundamental_metrics(
    snapshot_id: int,
    *,
    open_runtime_store,
) -> list[dict]:
    with open_runtime_store() as connection:
        rows = connection.execute(
            """
            SELECT
                metric_name,
                period_type,
                period_end_date,
                value_number,
                value_text,
                unit,
                source_field
            FROM fundamental_metrics
            WHERE snapshot_id = ?
            ORDER BY period_type, metric_name, period_end_date DESC
            """,
            (int(snapshot_id),),
        ).fetchall()
    return [
        {
            "metricName": row["metric_name"],
            "periodType": row["period_type"],
            "periodEndDate": row["period_end_date"],
            "valueNumber": row["value_number"],
            "valueText": row["value_text"],
            "unit": row["unit"],
            "sourceField": row["source_field"],
        }
        for row in rows
    ]


def record_fundamental_collection_run(
    *,
    universe_id: str,
    universe_label: str,
    provider: str,
    source_kind: str,
    period_days: int,
    symbol_count: int,
    success_count: int,
    failure_count: int,
    skipped_count: int,
    as_of_date: str,
    started_at: str,
    completed_at: str,
    failures: list[dict],
    normalize_dataset_id,
    open_runtime_store,
) -> dict:
    normalized_id = normalize_dataset_id(universe_id)
    with open_runtime_store() as connection:
        cursor = connection.execute(
            """
            INSERT INTO fundamental_collection_runs (
                universe_id,
                universe_label,
                provider,
                source_kind,
                period_days,
                symbol_count,
                success_count,
                failure_count,
                skipped_count,
                as_of_date,
                started_at,
                completed_at,
                failure_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                normalized_id,
                str(universe_label or normalized_id).strip() or normalized_id,
                str(provider or "").strip().lower() or "unknown",
                str(source_kind or "").strip().lower() or "manual",
                max(0, int(period_days or 0)),
                max(0, int(symbol_count or 0)),
                max(0, int(success_count or 0)),
                max(0, int(failure_count or 0)),
                max(0, int(skipped_count or 0)),
                str(as_of_date or "").strip()[:10],
                started_at,
                completed_at,
                _json_dumps(failures if isinstance(failures, list) else []),
            ),
        )
        run_id = int(cursor.lastrowid)
        connection.commit()

    return {
        "runId": run_id,
        "universeId": normalized_id,
        "universeLabel": str(universe_label or normalized_id).strip() or normalized_id,
        "provider": str(provider or "").strip().lower() or "unknown",
        "sourceKind": str(source_kind or "").strip().lower() or "manual",
        "periodDays": max(0, int(period_days or 0)),
        "symbolCount": max(0, int(symbol_count or 0)),
        "successCount": max(0, int(success_count or 0)),
        "failureCount": max(0, int(failure_count or 0)),
        "skippedCount": max(0, int(skipped_count or 0)),
        "asOfDate": str(as_of_date or "").strip()[:10],
        "startedAt": started_at,
        "completedAt": completed_at,
        "failures": failures if isinstance(failures, list) else [],
    }
