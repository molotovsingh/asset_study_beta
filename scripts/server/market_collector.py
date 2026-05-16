from __future__ import annotations

from datetime import datetime, timezone

try:
    from providers import finnhub, yahoo_finance15, yfinance_provider
except ModuleNotFoundError:
    from scripts.providers import finnhub, yahoo_finance15, yfinance_provider

try:
    from providers.router import provider_display_name
except ModuleNotFoundError:
    from scripts.providers.router import provider_display_name

try:
    from runtime_store import (
        ensure_runtime_store,
        list_symbol_universes,
        load_cached_series,
        load_corporate_actions,
        load_price_rows,
        load_symbol_sync_state,
        load_symbol_universe_members,
        normalize_symbol,
        record_market_collection_run,
        sync_symbol_universe_members,
        to_iso,
        upsert_symbol_universe,
        write_price_history,
    )
except ModuleNotFoundError:
    from scripts.runtime_store import (
        ensure_runtime_store,
        list_symbol_universes,
        load_cached_series,
        load_corporate_actions,
        load_price_rows,
        load_symbol_sync_state,
        load_symbol_universe_members,
        normalize_symbol,
        record_market_collection_run,
        sync_symbol_universe_members,
        to_iso,
        upsert_symbol_universe,
        write_price_history,
    )

try:
    from server import index_service
except ModuleNotFoundError:
    from scripts.server import index_service


DEFAULT_COLLECTOR_PROVIDER_ORDER = [
    finnhub.PROVIDER_ID,
    yfinance_provider.PROVIDER_ID,
]

AVAILABLE_HISTORY_FETCHERS = {
    finnhub.PROVIDER_ID: finnhub.fetch_history,
    yfinance_provider.PROVIDER_ID: yfinance_provider.fetch_history,
    yahoo_finance15.PROVIDER_ID: yahoo_finance15.fetch_history,
}


def normalize_provider_order(raw_value: str | list[str] | tuple[str, ...] | None) -> list[str]:
    if raw_value is None:
        return list(DEFAULT_COLLECTOR_PROVIDER_ORDER)

    if isinstance(raw_value, str):
        candidates = [part.strip().lower() for part in raw_value.split(",")]
    else:
        candidates = [str(part or "").strip().lower() for part in raw_value]

    normalized: list[str] = []
    for candidate in candidates:
        if not candidate:
            continue
        if candidate not in AVAILABLE_HISTORY_FETCHERS:
            raise ValueError(f"Unknown market collector provider: {candidate}")
        if candidate not in normalized:
            normalized.append(candidate)

    if not normalized:
        raise ValueError("At least one valid market collector provider is required.")
    return normalized


def _fetch_history_with_order(
    symbol: str,
    provider_order: list[str],
    *,
    period: str | None = None,
    start: str | None = None,
    end: str | None = None,
):
    errors: list[str] = []
    for provider_id in provider_order:
        fetcher = AVAILABLE_HISTORY_FETCHERS[provider_id]
        try:
            return fetcher(symbol, period=period, start=start, end=end)
        except Exception as error:  # noqa: BLE001
            errors.append(f"{provider_display_name(provider_id)}: {error}")

    details = " ".join(errors) if errors else "No collector providers were configured."
    raise RuntimeError(f"Could not collect history for {symbol}. {details}")


def _fetch_full_history_with_order(
    symbol: str,
    provider_order: list[str],
):
    last_error: Exception | None = None
    attempts = (
        {"period": "max", "label": "period=max"},
        {
            "start": index_service.years_ago_start_date(index_service.FULL_HISTORY_FALLBACK_YEARS),
            "label": f"start={index_service.years_ago_start_date(index_service.FULL_HISTORY_FALLBACK_YEARS)}",
        },
        {
            "period": index_service.DEFAULT_HISTORY_PERIOD,
            "label": f"period={index_service.DEFAULT_HISTORY_PERIOD}",
        },
    )
    for attempt in attempts:
        try:
            result = _fetch_history_with_order(
                symbol,
                provider_order,
                period=attempt.get("period"),
                start=attempt.get("start"),
            )
        except Exception as error:  # noqa: BLE001
            last_error = error
            continue
        return result, str(attempt["label"])

    if last_error is not None:
        raise RuntimeError(f"Could not fetch broad history for {symbol}: {last_error}") from last_error
    raise RuntimeError(f"Could not fetch history for symbol {symbol}.")


def _collector_cache_dependencies(provider_order: list[str], *, force_full_sync: bool = False) -> dict:
    return {
        "load_cached_series": load_cached_series,
        "normalize_symbol": normalize_symbol,
        "normalize_provider_id": lambda value: str(value or "").strip().lower() or None,
        "cache_is_fresh": (lambda _snapshot: False),
        "snapshot_requires_full_sync": (
            (lambda _snapshot: True)
            if force_full_sync
            else index_service.snapshot_requires_full_sync
        ),
        "ensure_snapshot_currency": index_service.ensure_snapshot_currency,
        "fetch_full_symbol_history_result": (
            lambda symbol, preferred_provider=None: _fetch_full_history_with_order(  # noqa: ARG005
                symbol,
                provider_order,
            )
        ),
        "write_price_history": write_price_history,
        "provider_display_name": provider_display_name,
        "stable_rows_hash": index_service.stable_rows_hash,
        "load_price_rows": load_price_rows,
        "load_corporate_actions": load_corporate_actions,
        "shift_date": index_service.shift_date,
        "fetch_symbol_history_result": (
            lambda symbol, period=None, start=None, end=None, preferred_provider=None: _fetch_history_with_order(  # noqa: ARG005
                symbol,
                provider_order,
                period=period,
                start=start,
                end=end,
            )
        ),
        "validate_price_overlap": index_service.validate_price_overlap,
        "validate_action_overlap": index_service.validate_action_overlap,
        "incremental_overlap_days": index_service.INCREMENTAL_OVERLAP_DAYS,
    }


def collect_symbol_history(
    symbol: str,
    *,
    provider_order: list[str],
    full_sync: bool = False,
) -> tuple[dict, str]:
    return index_service.get_or_refresh_cached_series_core(
        symbol,
        preferred_provider=provider_order[0] if provider_order else None,
        dependencies=_collector_cache_dependencies(provider_order, force_full_sync=full_sync),
    )


def sync_manual_symbol_universe(
    universe_id: str,
    universe_label: str,
    symbols: list[str],
) -> list[dict]:
    upsert_symbol_universe(
        universe_id,
        universe_label,
        selection_kind="manual",
        source_provider="manual",
        note="Bounded local symbol universe for scheduled market collection.",
    )
    return sync_symbol_universe_members(
        universe_id,
        [
            {
                "symbol": normalize_symbol(symbol),
                "label": normalize_symbol(symbol),
                "sourceProvider": "manual",
                "metadata": {"symbol": normalize_symbol(symbol), "kind": "manual"},
            }
            for symbol in symbols
            if normalize_symbol(symbol)
        ],
        source_provider="manual",
        replace=False,
    )


def sync_exchange_symbol_universe(
    universe_id: str,
    universe_label: str,
    *,
    exchange: str,
    mic: str | None = None,
) -> list[dict]:
    normalized_exchange = str(exchange or "").strip().upper()
    discovered = finnhub.fetch_exchange_symbols(normalized_exchange, mic=mic)

    upsert_symbol_universe(
        universe_id,
        universe_label,
        selection_kind="exchange",
        source_provider=finnhub.PROVIDER_ID,
        exchange=normalized_exchange,
        mic=mic,
        note="Finnhub exchange-backed symbol universe for scheduled market collection.",
    )
    return sync_symbol_universe_members(
        universe_id,
        [
            {
                "symbol": entry["symbol"],
                "label": entry["description"] or entry["displaySymbol"] or entry["symbol"],
                "exchange": normalized_exchange,
                "mic": entry.get("mic"),
                "currency": entry.get("currency"),
                "type": entry.get("type"),
                "sourceProvider": finnhub.PROVIDER_ID,
                "metadata": entry,
            }
            for entry in discovered
        ],
        source_provider=finnhub.PROVIDER_ID,
        replace=True,
    )


def collect_market_universe(
    universe_id: str,
    *,
    universe_label: str | None = None,
    provider_order: list[str] | None = None,
    refresh_symbol_master: bool = False,
    exchange: str | None = None,
    mic: str | None = None,
    symbols: list[str] | None = None,
    full_sync: bool = False,
    limit: int | None = None,
) -> dict:
    ensure_runtime_store()
    normalized_universe_id = str(universe_id or "").strip().lower()
    if not normalized_universe_id:
        raise ValueError("Universe id is required.")

    normalized_provider_order = normalize_provider_order(provider_order)
    normalized_symbols = [normalize_symbol(symbol) for symbol in (symbols or []) if normalize_symbol(symbol)]
    started_at = to_iso(datetime.now(timezone.utc))

    if normalized_symbols:
        synced_members = sync_manual_symbol_universe(
            normalized_universe_id,
            universe_label or normalized_universe_id,
            normalized_symbols,
        )
    elif refresh_symbol_master:
        if not exchange:
            raise ValueError("Exchange is required when refreshing a symbol master from Finnhub.")
        synced_members = sync_exchange_symbol_universe(
            normalized_universe_id,
            universe_label or f"{exchange.upper()} Symbols",
            exchange=exchange,
            mic=mic,
        )
    else:
        synced_members = load_symbol_universe_members(normalized_universe_id)

    active_members = [member for member in synced_members if member.get("isActive")]
    if limit is not None:
        active_members = active_members[: max(0, int(limit))]
    if not active_members:
        raise RuntimeError(
            "No active universe members are available. Seed the universe with --symbols or --refresh-symbol-master first.",
        )

    collected: list[dict] = []
    failures: list[dict] = []
    skipped_count = 0
    for member in active_members:
        symbol = normalize_symbol(member.get("symbol"))
        if not symbol:
            skipped_count += 1
            continue
        try:
            sync_before = load_symbol_sync_state(symbol)
            snapshot, cache_status = collect_symbol_history(
                symbol,
                provider_order=normalized_provider_order,
                full_sync=full_sync,
            )
            sync_after = load_symbol_sync_state(symbol)
            collected.append(
                {
                    "symbol": symbol,
                    "label": member.get("label") or symbol,
                    "cacheStatus": cache_status,
                    "provider": snapshot.get("provider"),
                    "providerName": provider_display_name(snapshot.get("provider")),
                    "range": snapshot.get("range"),
                    "lastPriceDate": (snapshot.get("syncState") or {}).get("lastPriceDate") or snapshot.get("range", {}).get("endDate"),
                    "previousLastPriceDate": (sync_before or {}).get("lastPriceDate"),
                    "syncMode": (sync_after or {}).get("lastSyncMode"),
                    "syncStatus": (sync_after or {}).get("lastSyncStatus"),
                },
            )
        except Exception as error:  # noqa: BLE001
            failures.append(
                {
                    "symbol": symbol,
                    "label": member.get("label") or symbol,
                    "error": str(error),
                },
            )

    completed_at = to_iso(datetime.now(timezone.utc))
    universe_row = next(
        (entry for entry in list_symbol_universes() if entry["universeId"] == normalized_universe_id),
        None,
    )
    run_record = record_market_collection_run(
        universe_id=normalized_universe_id,
        universe_label=(
            universe_label
            or (universe_row["label"] if universe_row is not None else normalized_universe_id)
        ),
        mode="full" if full_sync else "incremental",
        requested_provider_order=normalized_provider_order,
        symbol_count=len(active_members),
        success_count=len(collected),
        failure_count=len(failures),
        skipped_count=skipped_count,
        refresh_symbol_master=refresh_symbol_master,
        full_sync=full_sync,
        as_of_date=datetime.now(timezone.utc).date().isoformat(),
        started_at=started_at,
        completed_at=completed_at,
        failures=failures,
    )
    return {
        **run_record,
        "members": active_members,
        "collected": collected,
    }
