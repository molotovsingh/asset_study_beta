from __future__ import annotations

import json
import sqlite3


def row_to_remembered_entry(row: sqlite3.Row) -> dict:
    return {
        "datasetId": row["dataset_id"],
        "label": row["label"],
        "symbol": row["symbol"],
        "currency": row["currency"],
        "providerName": row["provider_name"],
        "family": row["family"],
        "targetSeriesType": row["target_series_type"],
        "sourceSeriesType": row["source_series_type"],
        "sourceUrl": row["source_url"],
        "note": row["note"],
        "generatedAt": row["generated_at"],
        "range": {
            "startDate": row["range_start_date"],
            "endDate": row["range_end_date"],
            "observations": row["observations"],
        },
        "path": row["cache_key"],
        "cacheKey": row["cache_key"],
    }


def row_to_profile(
    row: sqlite3.Row,
    *,
    raw_info_from_row,
    clean_dividend_yield,
    normalize_yield_ratio,
    build_symbol_source_url,
) -> dict:
    raw_info = raw_info_from_row(row)
    return {
        "symbol": row["symbol"],
        "fetchedAt": row["fetched_at"],
        "providerName": row["provider_name"],
        "quoteType": row["quote_type"],
        "shortName": row["short_name"],
        "longName": row["long_name"],
        "sector": row["sector"],
        "industry": row["industry"],
        "country": row["country"],
        "exchange": row["exchange"],
        "exchangeName": row["exchange_name"],
        "currency": row["currency"],
        "marketCap": row["market_cap"],
        "beta": row["beta"],
        "trailingPE": row["trailing_pe"],
        "forwardPE": row["forward_pe"],
        "priceToBook": row["price_to_book"],
        "dividendYield": (
            clean_dividend_yield(raw_info)
            if raw_info
            else normalize_yield_ratio(row["dividend_yield"])
        ),
        "fullTimeEmployees": row["full_time_employees"],
        "website": row["website"],
        "sourceUrl": build_symbol_source_url(row["symbol"]),
    }


def normalize_profile(
    symbol: str,
    info: dict | None,
    *,
    provider_name: str | None = None,
    normalize_symbol,
    clean_text,
    clean_number,
    clean_int,
    clean_dividend_yield,
    build_symbol_source_url,
    now_iso,
) -> dict:
    raw_info = info if isinstance(info, dict) else {}
    normalized_symbol = normalize_symbol(symbol)

    return {
        "symbol": normalized_symbol,
        "fetchedAt": now_iso(),
        "providerName": str(provider_name or "Yahoo Finance (yfinance)").strip()
        or "Yahoo Finance (yfinance)",
        "quoteType": clean_text(raw_info.get("quoteType")),
        "shortName": clean_text(raw_info.get("shortName")),
        "longName": clean_text(raw_info.get("longName")),
        "sector": clean_text(raw_info.get("sector")),
        "industry": clean_text(raw_info.get("industry")),
        "country": clean_text(raw_info.get("country")),
        "exchange": clean_text(raw_info.get("exchange")),
        "exchangeName": clean_text(raw_info.get("fullExchangeName")),
        "currency": clean_text(raw_info.get("currency")),
        "marketCap": clean_number(raw_info.get("marketCap")),
        "beta": clean_number(raw_info.get("beta")),
        "trailingPE": clean_number(raw_info.get("trailingPE")),
        "forwardPE": clean_number(raw_info.get("forwardPE")),
        "priceToBook": clean_number(raw_info.get("priceToBook")),
        "dividendYield": clean_dividend_yield(raw_info),
        "fullTimeEmployees": clean_int(raw_info.get("fullTimeEmployees")),
        "website": clean_text(raw_info.get("website")),
        "sourceUrl": build_symbol_source_url(normalized_symbol),
        "rawInfo": raw_info,
    }


def upsert_remembered_dataset(
    connection: sqlite3.Connection,
    entry: dict,
    *,
    normalize_symbol,
    extract_cache_key_from_path,
    symbol_cache_key,
    build_symbol_source_url,
    to_iso,
    now_utc,
) -> None:
    range_data = entry.get("range") or {
        "startDate": "",
        "endDate": "",
        "observations": 0,
    }
    symbol = normalize_symbol(entry.get("symbol"))
    cache_key = (
        entry.get("cacheKey")
        or extract_cache_key_from_path(entry.get("path"))
        or symbol_cache_key(symbol)
    )

    connection.execute(
        """
        INSERT INTO remembered_datasets (
            dataset_id,
            label,
            symbol,
            provider_name,
            family,
            currency,
            target_series_type,
            source_series_type,
            source_url,
            note,
            generated_at,
            range_start_date,
            range_end_date,
            observations,
            cache_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(dataset_id) DO UPDATE SET
            label = excluded.label,
            symbol = excluded.symbol,
            provider_name = excluded.provider_name,
            family = excluded.family,
            currency = excluded.currency,
            target_series_type = excluded.target_series_type,
            source_series_type = excluded.source_series_type,
            source_url = excluded.source_url,
            note = excluded.note,
            generated_at = excluded.generated_at,
            range_start_date = excluded.range_start_date,
            range_end_date = excluded.range_end_date,
            observations = excluded.observations,
            cache_key = excluded.cache_key
        """,
        (
            str(entry.get("datasetId") or cache_key).strip(),
            str(entry.get("label") or symbol).strip() or symbol,
            symbol,
            str(entry.get("providerName") or "Yahoo Finance").strip() or "Yahoo Finance",
            str(entry.get("family") or "Remembered").strip() or "Remembered",
            str(entry.get("currency") or "").strip().upper() or None,
            str(entry.get("targetSeriesType") or "Price").strip() or "Price",
            str(entry.get("sourceSeriesType") or "Price").strip() or "Price",
            str(entry.get("sourceUrl") or build_symbol_source_url(symbol)).strip(),
            str(entry.get("note")).strip() if entry.get("note") else None,
            str(entry.get("generatedAt") or to_iso(now_utc())).strip(),
            str(range_data.get("startDate") or ""),
            str(range_data.get("endDate") or ""),
            int(range_data.get("observations") or 0),
            cache_key,
        ),
    )


def upsert_instrument_profile(
    connection: sqlite3.Connection,
    profile: dict,
    *,
    normalize_symbol,
    to_iso,
    now_utc,
) -> None:
    connection.execute(
        """
        INSERT INTO instrument_profiles (
            symbol,
            fetched_at,
            provider_name,
            quote_type,
            short_name,
            long_name,
            sector,
            industry,
            country,
            exchange,
            exchange_name,
            currency,
            market_cap,
            beta,
            trailing_pe,
            forward_pe,
            price_to_book,
            dividend_yield,
            full_time_employees,
            website,
            raw_info_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET
            fetched_at = excluded.fetched_at,
            provider_name = excluded.provider_name,
            quote_type = excluded.quote_type,
            short_name = excluded.short_name,
            long_name = excluded.long_name,
            sector = excluded.sector,
            industry = excluded.industry,
            country = excluded.country,
            exchange = excluded.exchange,
            exchange_name = excluded.exchange_name,
            currency = excluded.currency,
            market_cap = excluded.market_cap,
            beta = excluded.beta,
            trailing_pe = excluded.trailing_pe,
            forward_pe = excluded.forward_pe,
            price_to_book = excluded.price_to_book,
            dividend_yield = excluded.dividend_yield,
            full_time_employees = excluded.full_time_employees,
            website = excluded.website,
            raw_info_json = excluded.raw_info_json
        """,
        (
            normalize_symbol(profile.get("symbol")),
            profile.get("fetchedAt") or to_iso(now_utc()),
            str(profile.get("providerName") or "Yahoo Finance (yfinance)").strip()
            or "Yahoo Finance (yfinance)",
            profile.get("quoteType"),
            profile.get("shortName"),
            profile.get("longName"),
            profile.get("sector"),
            profile.get("industry"),
            profile.get("country"),
            profile.get("exchange"),
            profile.get("exchangeName"),
            str(profile.get("currency") or "").strip().upper() or None,
            profile.get("marketCap"),
            profile.get("beta"),
            profile.get("trailingPE"),
            profile.get("forwardPE"),
            profile.get("priceToBook"),
            profile.get("dividendYield"),
            profile.get("fullTimeEmployees"),
            profile.get("website"),
            json.dumps(
                profile.get("rawInfo") or {},
                separators=(",", ":"),
                default=str,
            ),
        ),
    )


def should_import_remembered_dataset(
    connection: sqlite3.Connection,
    dataset_id: str | None,
    generated_at: str | None,
    *,
    normalize_dataset_id,
    parse_iso_datetime,
) -> bool:
    normalized_dataset_id = normalize_dataset_id(dataset_id)
    if not normalized_dataset_id:
        return False

    existing = connection.execute(
        "SELECT generated_at FROM remembered_datasets WHERE lower(dataset_id) = ?",
        (normalized_dataset_id,),
    ).fetchone()
    if existing is None:
        return True

    incoming_dt = parse_iso_datetime(generated_at)
    existing_dt = parse_iso_datetime(existing[0])
    if incoming_dt is None:
        return False
    if existing_dt is None:
        return True
    return incoming_dt >= existing_dt


def find_remembered_entry(
    dataset_id: str | None,
    symbol: str | None,
    *,
    open_runtime_store,
    normalize_dataset_id,
    normalize_symbol,
) -> dict | None:
    normalized_dataset_id = normalize_dataset_id(dataset_id)
    normalized_symbol = normalize_symbol(symbol)

    with open_runtime_store() as connection:
        if normalized_dataset_id:
            row = connection.execute(
                """
                SELECT
                    dataset_id,
                    label,
                    symbol,
                    provider_name,
                    family,
                    currency,
                    target_series_type,
                    source_series_type,
                    source_url,
                    note,
                    generated_at,
                    range_start_date,
                    range_end_date,
                    observations,
                    cache_key
                FROM remembered_datasets
                WHERE lower(dataset_id) = ?
                LIMIT 1
                """,
                (normalized_dataset_id,),
            ).fetchone()
            if row is not None:
                return row_to_remembered_entry(row)

        if normalized_symbol:
            row = connection.execute(
                """
                SELECT
                    dataset_id,
                    label,
                    symbol,
                    provider_name,
                    family,
                    currency,
                    target_series_type,
                    source_series_type,
                    source_url,
                    note,
                    generated_at,
                    range_start_date,
                    range_end_date,
                    observations,
                    cache_key
                FROM remembered_datasets
                WHERE symbol = ?
                ORDER BY generated_at DESC, dataset_id ASC
                LIMIT 1
                """,
                (normalized_symbol,),
            ).fetchone()
            if row is not None:
                return row_to_remembered_entry(row)

    return None


def remember_symbol(
    snapshot: dict,
    *,
    open_runtime_store,
    normalize_symbol,
    extract_cache_key_from_path,
    symbol_cache_key,
    build_symbol_source_url,
    to_iso,
    now_utc,
    find_remembered_entry_fn,
) -> dict:
    entry = {
        "datasetId": snapshot["datasetId"],
        "label": snapshot["label"],
        "symbol": snapshot["symbol"],
        "currency": snapshot.get("currency"),
        "providerName": snapshot["providerName"],
        "family": snapshot["family"],
        "targetSeriesType": snapshot["targetSeriesType"],
        "sourceSeriesType": snapshot["sourceSeriesType"],
        "sourceUrl": snapshot["sourceUrl"],
        "note": snapshot["note"],
        "generatedAt": snapshot["generatedAt"],
        "range": snapshot["range"],
        "cacheKey": snapshot.get("cache", {}).get("key"),
        "path": snapshot.get("cache", {}).get("path"),
    }

    with open_runtime_store() as connection:
        upsert_remembered_dataset(
            connection,
            entry,
            normalize_symbol=normalize_symbol,
            extract_cache_key_from_path=extract_cache_key_from_path,
            symbol_cache_key=symbol_cache_key,
            build_symbol_source_url=build_symbol_source_url,
            to_iso=to_iso,
            now_utc=now_utc,
        )
        connection.commit()

    return find_remembered_entry_fn(entry["datasetId"], entry["symbol"]) or entry


def load_remembered_catalog(*, open_runtime_store) -> list[dict]:
    with open_runtime_store() as connection:
        rows = connection.execute(
            """
            SELECT
                dataset_id,
                label,
                symbol,
                provider_name,
                family,
                currency,
                target_series_type,
                source_series_type,
                source_url,
                note,
                generated_at,
                range_start_date,
                range_end_date,
                observations,
                cache_key
            FROM remembered_datasets
            ORDER BY lower(label), symbol, dataset_id
            """
        ).fetchall()

    return [row_to_remembered_entry(row) for row in rows]


def upsert_symbol_universe(
    universe_id: str,
    label: str,
    *,
    selection_kind: str = "manual",
    source_provider: str | None = None,
    exchange: str | None = None,
    mic: str | None = None,
    note: str | None = None,
    normalize_dataset_id,
    to_iso,
    now_utc,
    open_runtime_store,
) -> dict:
    normalized_universe_id = normalize_dataset_id(universe_id)
    normalized_label = str(label or normalized_universe_id).strip() or normalized_universe_id
    if not normalized_universe_id:
        raise RuntimeError("Universe id is required.")

    timestamp = to_iso(now_utc())
    with open_runtime_store() as connection:
        connection.execute(
            """
            INSERT INTO symbol_universes (
                universe_id,
                label,
                selection_kind,
                source_provider,
                exchange,
                mic,
                note,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(universe_id) DO UPDATE SET
                label = excluded.label,
                selection_kind = excluded.selection_kind,
                source_provider = excluded.source_provider,
                exchange = excluded.exchange,
                mic = excluded.mic,
                note = excluded.note,
                updated_at = excluded.updated_at
            """,
            (
                normalized_universe_id,
                normalized_label,
                str(selection_kind or "manual").strip() or "manual",
                str(source_provider or "").strip().lower() or None,
                str(exchange or "").strip().upper() or None,
                str(mic or "").strip().upper() or None,
                str(note or "").strip() or None,
                timestamp,
                timestamp,
            ),
        )
        connection.commit()
        row = connection.execute(
            """
            SELECT
                universe_id,
                label,
                selection_kind,
                source_provider,
                exchange,
                mic,
                note,
                created_at,
                updated_at
            FROM symbol_universes
            WHERE universe_id = ?
            """,
            (normalized_universe_id,),
        ).fetchone()
    return dict(row) if row is not None else {
        "universe_id": normalized_universe_id,
        "label": normalized_label,
    }


def sync_symbol_universe_members(
    universe_id: str,
    entries: list[dict],
    *,
    source_provider: str | None = None,
    replace: bool = False,
    normalize_dataset_id,
    normalize_symbol,
    to_iso,
    now_utc,
    open_runtime_store,
) -> list[dict]:
    normalized_universe_id = normalize_dataset_id(universe_id)
    if not normalized_universe_id:
        raise RuntimeError("Universe id is required.")

    timestamp = to_iso(now_utc())
    normalized_entries: list[dict] = []
    seen_symbols: set[str] = set()
    for raw_entry in entries:
        if not isinstance(raw_entry, dict):
            continue
        symbol = normalize_symbol(raw_entry.get("symbol"))
        if not symbol or symbol in seen_symbols:
            continue
        seen_symbols.add(symbol)
        normalized_entries.append(
            {
                "symbol": symbol,
                "label": str(raw_entry.get("label") or symbol).strip() or symbol,
                "exchange": str(raw_entry.get("exchange") or "").strip().upper() or None,
                "mic": str(raw_entry.get("mic") or "").strip().upper() or None,
                "instrumentType": str(raw_entry.get("instrumentType") or raw_entry.get("type") or "").strip() or None,
                "currency": str(raw_entry.get("currency") or "").strip().upper() or None,
                "sourceProvider": (
                    str(raw_entry.get("sourceProvider") or source_provider or "").strip().lower() or None
                ),
                "metadataJson": json.dumps(raw_entry.get("metadata") or raw_entry, separators=(",", ":"), sort_keys=True),
            },
        )

    with open_runtime_store() as connection:
        for entry in normalized_entries:
            connection.execute(
                """
                INSERT INTO symbol_universe_members (
                    universe_id,
                    symbol,
                    label,
                    exchange,
                    mic,
                    instrument_type,
                    currency,
                    is_active,
                    source_provider,
                    metadata_json,
                    created_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
                ON CONFLICT(universe_id, symbol) DO UPDATE SET
                    label = excluded.label,
                    exchange = excluded.exchange,
                    mic = excluded.mic,
                    instrument_type = excluded.instrument_type,
                    currency = COALESCE(excluded.currency, symbol_universe_members.currency),
                    is_active = 1,
                    source_provider = excluded.source_provider,
                    metadata_json = excluded.metadata_json,
                    updated_at = excluded.updated_at
                """,
                (
                    normalized_universe_id,
                    entry["symbol"],
                    entry["label"],
                    entry["exchange"],
                    entry["mic"],
                    entry["instrumentType"],
                    entry["currency"],
                    entry["sourceProvider"],
                    entry["metadataJson"],
                    timestamp,
                    timestamp,
                ),
            )

        if replace:
            if normalized_entries:
                placeholders = ", ".join("?" for _ in normalized_entries)
                connection.execute(
                    f"""
                    UPDATE symbol_universe_members
                    SET is_active = 0, updated_at = ?
                    WHERE universe_id = ?
                      AND symbol NOT IN ({placeholders})
                    """,
                    (timestamp, normalized_universe_id, *[entry["symbol"] for entry in normalized_entries]),
                )
            else:
                connection.execute(
                    """
                    UPDATE symbol_universe_members
                    SET is_active = 0, updated_at = ?
                    WHERE universe_id = ?
                    """,
                    (timestamp, normalized_universe_id),
                )
        connection.commit()

        rows = connection.execute(
            """
            SELECT
                universe_id,
                symbol,
                label,
                exchange,
                mic,
                instrument_type,
                currency,
                is_active,
                source_provider,
                metadata_json,
                created_at,
                updated_at
            FROM symbol_universe_members
            WHERE universe_id = ?
            ORDER BY label, symbol
            """,
            (normalized_universe_id,),
        ).fetchall()

    return [
        {
            "universeId": row["universe_id"],
            "symbol": row["symbol"],
            "label": row["label"],
            "exchange": row["exchange"],
            "mic": row["mic"],
            "instrumentType": row["instrument_type"],
            "currency": row["currency"],
            "isActive": bool(row["is_active"]),
            "sourceProvider": row["source_provider"],
            "metadata": json.loads(row["metadata_json"] or "{}"),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]


def load_symbol_universe_members(
    universe_id: str,
    *,
    include_inactive: bool = False,
    normalize_dataset_id,
    open_runtime_store,
) -> list[dict]:
    normalized_universe_id = normalize_dataset_id(universe_id)
    with open_runtime_store() as connection:
        clauses = ["universe_id = ?"]
        params: list[object] = [normalized_universe_id]
        if not include_inactive:
            clauses.append("is_active = 1")
        rows = connection.execute(
            f"""
            SELECT
                universe_id,
                symbol,
                label,
                exchange,
                mic,
                instrument_type,
                currency,
                is_active,
                source_provider,
                metadata_json,
                created_at,
                updated_at
            FROM symbol_universe_members
            WHERE {' AND '.join(clauses)}
            ORDER BY label, symbol
            """,
            tuple(params),
        ).fetchall()

    return [
        {
            "universeId": row["universe_id"],
            "symbol": row["symbol"],
            "label": row["label"],
            "exchange": row["exchange"],
            "mic": row["mic"],
            "instrumentType": row["instrument_type"],
            "currency": row["currency"],
            "isActive": bool(row["is_active"]),
            "sourceProvider": row["source_provider"],
            "metadata": json.loads(row["metadata_json"] or "{}"),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]


def list_symbol_universes(*, open_runtime_store) -> list[dict]:
    with open_runtime_store() as connection:
        rows = connection.execute(
            """
            SELECT
                universes.universe_id,
                universes.label,
                universes.selection_kind,
                universes.source_provider,
                universes.exchange,
                universes.mic,
                universes.note,
                universes.created_at,
                universes.updated_at,
                SUM(CASE WHEN members.is_active = 1 THEN 1 ELSE 0 END) AS active_members
            FROM symbol_universes AS universes
            LEFT JOIN symbol_universe_members AS members
              ON members.universe_id = universes.universe_id
            GROUP BY
                universes.universe_id,
                universes.label,
                universes.selection_kind,
                universes.source_provider,
                universes.exchange,
                universes.mic,
                universes.note,
                universes.created_at,
                universes.updated_at
            ORDER BY universes.label, universes.universe_id
            """
        ).fetchall()

    return [
        {
            "universeId": row["universe_id"],
            "label": row["label"],
            "selectionKind": row["selection_kind"],
            "sourceProvider": row["source_provider"],
            "exchange": row["exchange"],
            "mic": row["mic"],
            "note": row["note"],
            "activeMembers": int(row["active_members"] or 0),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]


def load_symbol_sync_state(
    symbol: str,
    *,
    normalize_symbol,
    open_runtime_store,
) -> dict | None:
    normalized_symbol = normalize_symbol(symbol)
    if not normalized_symbol:
        return None

    with open_runtime_store() as connection:
        row = connection.execute(
            """
            SELECT
                symbols.symbol,
                symbols.provider,
                symbols.currency,
                symbols.source_series_type,
                sync_state.first_full_sync_at,
                sync_state.last_full_sync_at,
                sync_state.last_incremental_sync_at,
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
            WHERE symbols.symbol = ?
            """,
            (normalized_symbol,),
        ).fetchone()

    if row is None:
        return None

    return {
        "symbol": row["symbol"],
        "provider": row["provider"],
        "currency": row["currency"],
        "sourceSeriesType": row["source_series_type"],
        "firstFullSyncAt": row["first_full_sync_at"],
        "lastFullSyncAt": row["last_full_sync_at"],
        "lastIncrementalSyncAt": row["last_incremental_sync_at"],
        "lastCheckedAt": row["last_checked_at"],
        "lastPriceDate": row["last_price_date"],
        "historyStartDate": row["history_start_date"],
        "historyEndDate": row["history_end_date"],
        "observations": int(row["observations"] or 0),
        "lastSyncMode": row["last_sync_mode"],
        "lastSyncStatus": row["last_sync_status"],
        "lastSyncMessage": row["last_sync_message"],
    }


def record_market_collection_run(
    *,
    universe_id: str,
    universe_label: str,
    mode: str,
    requested_provider_order: list[str],
    symbol_count: int,
    success_count: int,
    failure_count: int,
    skipped_count: int,
    refresh_symbol_master: bool,
    full_sync: bool,
    as_of_date: str | None,
    started_at: str,
    completed_at: str,
    failures: list[dict],
    normalize_dataset_id,
    open_runtime_store,
) -> dict:
    normalized_universe_id = normalize_dataset_id(universe_id)
    with open_runtime_store() as connection:
        cursor = connection.execute(
            """
            INSERT INTO market_collection_runs (
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                normalized_universe_id,
                str(universe_label or normalized_universe_id).strip() or normalized_universe_id,
                str(mode or "collect").strip() or "collect",
                json.dumps(list(requested_provider_order or []), separators=(",", ":")),
                int(symbol_count),
                int(success_count),
                int(failure_count),
                int(skipped_count),
                1 if refresh_symbol_master else 0,
                1 if full_sync else 0,
                str(as_of_date or "").strip() or None,
                started_at,
                completed_at,
                json.dumps(list(failures or []), separators=(",", ":")),
            ),
        )
        connection.commit()
        run_id = int(cursor.lastrowid)

    return {
        "runId": run_id,
        "universeId": normalized_universe_id,
        "universeLabel": universe_label,
        "mode": mode,
        "requestedProviderOrder": list(requested_provider_order or []),
        "symbolCount": int(symbol_count),
        "successCount": int(success_count),
        "failureCount": int(failure_count),
        "skippedCount": int(skipped_count),
        "refreshSymbolMaster": bool(refresh_symbol_master),
        "fullSync": bool(full_sync),
        "asOfDate": as_of_date,
        "startedAt": started_at,
        "completedAt": completed_at,
        "failures": list(failures or []),
    }
