from __future__ import annotations

try:
    from server import market_collector, ops_service, options_service
except ModuleNotFoundError:
    from scripts.server import market_collector, ops_service, options_service

try:
    from runtime_store import list_symbol_universes
except ModuleNotFoundError:
    from scripts.runtime_store import list_symbol_universes


def _normalize_market_universe_ids(raw_ids: list[str] | None) -> list[str]:
    if raw_ids:
        normalized: list[str] = []
        for raw_id in raw_ids:
            universe_id = str(raw_id or "").strip().lower()
            if not universe_id:
                continue
            if universe_id not in normalized:
                normalized.append(universe_id)
        return normalized

    return [
        str(universe["universeId"]).strip().lower()
        for universe in list_symbol_universes()
        if str(universe.get("universeId") or "").strip()
    ]


def _normalize_options_universe_ids(raw_ids: list[str] | None) -> list[str]:
    if raw_ids:
        normalized: list[str] = []
        for raw_id in raw_ids:
            universe_id = str(raw_id or "").strip()
            if not universe_id:
                continue
            if universe_id not in options_service.COLLECTOR_UNIVERSES:
                raise ValueError(f"Unknown options evidence universe: {universe_id}")
            if universe_id not in normalized:
                normalized.append(universe_id)
        return normalized

    return sorted(options_service.COLLECTOR_UNIVERSES.keys())


def run_data_maintenance(
    *,
    market_universe_ids: list[str] | None = None,
    options_universe_ids: list[str] | None = None,
    run_market_collection: bool = True,
    run_options_collection: bool = True,
    refresh_exchange_symbol_masters: bool = False,
    market_provider_order: str | list[str] | None = None,
    market_full_sync: bool = False,
    market_limit: int | None = None,
    options_minimum_dte: int | None = None,
    options_max_contracts: int | None = None,
    options_as_of_date: str | None = None,
    health_stale_after_days: int = 7,
    health_symbol_limit: int = 20,
    health_universe_limit: int = 20,
    health_run_limit: int = 10,
    health_as_of_date: str | None = None,
    max_attention_symbols: int | None = None,
    max_sync_errors: int | None = None,
) -> dict:
    selected_market_universe_ids = (
        _normalize_market_universe_ids(market_universe_ids)
        if run_market_collection
        else []
    )
    selected_options_universe_ids = (
        _normalize_options_universe_ids(options_universe_ids)
        if run_options_collection
        else []
    )

    known_universes = {
        str(universe["universeId"]).strip().lower(): universe
        for universe in list_symbol_universes()
    }

    market_results: list[dict] = []
    market_failures: list[dict] = []
    if run_market_collection:
        for universe_id in selected_market_universe_ids:
            universe = known_universes.get(universe_id)
            if universe is None:
                market_failures.append(
                    {
                        "universeId": universe_id,
                        "error": "Universe is not stored locally. Seed it before scheduled collection.",
                    }
                )
                continue
            try:
                market_results.append(
                    market_collector.collect_market_universe(
                        universe_id,
                        universe_label=universe.get("label"),
                        provider_order=market_provider_order,
                        refresh_symbol_master=(
                            bool(refresh_exchange_symbol_masters)
                            and str(universe.get("selectionKind") or "").strip() == "exchange"
                        ),
                        exchange=universe.get("exchange"),
                        mic=universe.get("mic"),
                        full_sync=market_full_sync,
                        limit=market_limit,
                    )
                )
            except Exception as error:  # noqa: BLE001
                market_failures.append(
                    {
                        "universeId": universe_id,
                        "label": universe.get("label"),
                        "error": str(error),
                    }
                )

    options_results: list[dict] = []
    options_failures: list[dict] = []
    if run_options_collection:
        for universe_id in selected_options_universe_ids:
            try:
                options_results.append(
                    options_service.collect_options_evidence_for_universe(
                        universe_id,
                        minimum_dte=options_minimum_dte,
                        max_contracts=options_max_contracts,
                        as_of_date=options_as_of_date,
                    )
                )
            except Exception as error:  # noqa: BLE001
                options_failures.append(
                    {
                        "universeId": universe_id,
                        "error": str(error),
                    }
                )

    health = ops_service.build_runtime_health_payload(
        {
            "staleAfterDays": health_stale_after_days,
            "symbolLimit": health_symbol_limit,
            "universeLimit": health_universe_limit,
            "runLimit": health_run_limit,
            "asOfDate": health_as_of_date,
        }
    )

    health_summary = health.get("summary") or {}
    failure_reasons: list[str] = []
    if market_failures:
        failure_reasons.append(f"marketFailures={len(market_failures)}")
    if options_failures:
        failure_reasons.append(f"optionsFailures={len(options_failures)}")
    if max_attention_symbols is not None and int(health_summary.get("attentionSymbolCount") or 0) > int(max_attention_symbols):
        failure_reasons.append(
            f"attentionSymbols={int(health_summary.get('attentionSymbolCount') or 0)}>{int(max_attention_symbols)}"
        )
    if max_sync_errors is not None and int(health_summary.get("syncErrorCount") or 0) > int(max_sync_errors):
        failure_reasons.append(
            f"syncErrors={int(health_summary.get('syncErrorCount') or 0)}>{int(max_sync_errors)}"
        )

    return {
        "status": "ok" if not failure_reasons else "attention",
        "failureReasons": failure_reasons,
        "marketCollection": {
            "requestedUniverseIds": selected_market_universe_ids,
            "results": market_results,
            "failures": market_failures,
        },
        "optionsEvidence": {
            "requestedUniverseIds": selected_options_universe_ids,
            "results": options_results,
            "failures": options_failures,
        },
        "runtimeHealth": health,
    }
