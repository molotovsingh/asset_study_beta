from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

try:
    from providers.yfinance_provider import fetch_monthly_straddle_snapshot
except ModuleNotFoundError:
    from scripts.providers.yfinance_provider import fetch_monthly_straddle_snapshot

try:
    from runtime_store import (
        ensure_runtime_store,
        load_option_front_history,
        load_options_screener_rows,
        load_recent_options_screener_runs,
        normalize_symbol,
        record_options_screener_run,
        write_option_monthly_snapshot,
    )
except ModuleNotFoundError:
    from scripts.runtime_store import (
        ensure_runtime_store,
        load_option_front_history,
        load_options_screener_rows,
        load_recent_options_screener_runs,
        normalize_symbol,
        record_options_screener_run,
        write_option_monthly_snapshot,
    )

from .constants import (
    OPTIONS_SCREENER_FETCH_CONCURRENCY,
    OPTIONS_SCREENER_MAX_SYMBOLS,
    OPTIONS_SIGNAL_VERSION,
)
from .metrics import (
    build_candidate_advisory,
    build_direction_context,
    build_term_structure_context,
    build_trade_idea_matches,
    clean_history_number,
    compute_confidence_score,
    compute_cross_sectional_rank,
    compute_execution_score,
    compute_vol_pricing_score,
    options_pricing_bucket,
    options_pricing_label,
    percentile_rank,
)

def build_screener_history_summary(snapshot: dict, focus_contract: dict) -> dict:
    front_history = (
        (snapshot.get("history") or {}).get("frontContracts")
        if isinstance(snapshot.get("history"), dict)
        else []
    )
    normalized_history = front_history if isinstance(front_history, list) else []
    if not normalized_history:
        return {
            "observations": 0,
            "ivPercentile": None,
            "movePercentile": None,
            "ivHv20Percentile": None,
            "ivHv60Percentile": None,
        }

    return {
        "observations": len(normalized_history),
        "ivPercentile": percentile_rank(
            [
                clean_history_number(row.get("straddleImpliedVolatility"))
                for row in normalized_history
            ],
            clean_history_number(focus_contract.get("straddleImpliedVolatility")),
        ),
        "movePercentile": percentile_rank(
            [
                clean_history_number(row.get("impliedMovePercent"))
                for row in normalized_history
            ],
            clean_history_number(focus_contract.get("impliedMovePercent")),
        ),
        "ivHv20Percentile": percentile_rank(
            [clean_history_number(row.get("ivHv20Ratio")) for row in normalized_history],
            clean_history_number(focus_contract.get("ivHv20Ratio")),
        ),
        "ivHv60Percentile": percentile_rank(
            [clean_history_number(row.get("ivHv60Ratio")) for row in normalized_history],
            clean_history_number(focus_contract.get("ivHv60Ratio")),
        ),
    }

def build_options_screener_storage_row(snapshot: dict) -> dict:
    monthly_contracts = snapshot.get("monthlyContracts")
    if not isinstance(monthly_contracts, list) or not monthly_contracts:
        raise RuntimeError(
            f"Options screener snapshot for {snapshot.get('symbol') or 'unknown symbol'} is missing monthly contracts.",
        )

    focus_contract = monthly_contracts[0]
    straddle_mid_price = clean_history_number(focus_contract.get("straddleMidPrice"))
    call_spread = clean_history_number(focus_contract.get("callSpread"))
    put_spread = clean_history_number(focus_contract.get("putSpread"))
    spread_share = (
        (call_spread + put_spread) / straddle_mid_price
        if call_spread is not None
        and put_spread is not None
        and straddle_mid_price is not None
        and straddle_mid_price > 0
        else None
    )
    pricing_label = options_pricing_label(focus_contract)
    pricing_bucket = options_pricing_bucket(pricing_label)
    history_summary = build_screener_history_summary(snapshot, focus_contract)
    front_history = (
        (snapshot.get("history") or {}).get("frontContracts")
        if isinstance(snapshot.get("history"), dict)
        else []
    )
    direction_context = snapshot.get("directionContext") or {}
    trend_context = direction_context.get("trend") or {}
    seasonality_context = direction_context.get("seasonality") or {}
    term_structure_context = build_term_structure_context(monthly_contracts)
    rv_percentile = percentile_rank(
        [
            clean_history_number(row.get("historicalVolatility20"))
            for row in (front_history if isinstance(front_history, list) else [])
        ],
        clean_history_number(focus_contract.get("historicalVolatility20")),
    )

    combined_open_interest = (
        int(focus_contract.get("combinedOpenInterest"))
        if focus_contract.get("combinedOpenInterest") is not None
        else None
    )
    combined_volume = (
        int(focus_contract.get("combinedVolume"))
        if focus_contract.get("combinedVolume") is not None
        else None
    )
    execution_score = compute_execution_score(
        combined_open_interest=combined_open_interest,
        combined_volume=combined_volume,
        spread_share=spread_share,
    )
    confidence_score = compute_confidence_score(
        history_observations=history_summary["observations"],
        seasonality_observations=(
            int(seasonality_context.get("observations"))
            if seasonality_context.get("observations") is not None
            else None
        ),
        execution_score=execution_score,
    )
    vol_pricing_score = compute_vol_pricing_score(
        iv_hv20_ratio=clean_history_number(focus_contract.get("ivHv20Ratio")),
        iv_hv60_ratio=clean_history_number(focus_contract.get("ivHv60Ratio")),
        iv_percentile=history_summary["ivPercentile"],
        iv_hv20_percentile=history_summary["ivHv20Percentile"],
    )
    candidate_advisory = build_candidate_advisory(
        pricing_bucket=pricing_bucket,
        execution_score=execution_score,
        confidence_score=confidence_score,
    )

    warnings = []
    for warning_key in ("directionWarning", "storageWarning"):
        warning_value = str(snapshot.get(warning_key) or "").strip()
        if warning_value:
            warnings.append(warning_value)

    return {
        "symbol": normalize_symbol(snapshot.get("symbol")),
        "provider": snapshot.get("provider"),
        "currency": snapshot.get("currency"),
        "asOfDate": snapshot.get("asOfDate"),
        "expiry": focus_contract.get("expiry"),
        "spotPrice": clean_history_number(snapshot.get("spotPrice")),
        "strike": clean_history_number(focus_contract.get("strike")),
        "daysToExpiry": (
            int(focus_contract.get("daysToExpiry"))
            if focus_contract.get("daysToExpiry") is not None
            else None
        ),
        "straddleMidPrice": straddle_mid_price,
        "impliedMovePercent": clean_history_number(focus_contract.get("impliedMovePercent")),
        "straddleImpliedVolatility": clean_history_number(
            focus_contract.get("straddleImpliedVolatility"),
        ),
        "chainImpliedVolatility": clean_history_number(
            focus_contract.get("chainImpliedVolatility"),
        ),
        "atmImpliedVolatility": clean_history_number(
            focus_contract.get("atmImpliedVolatility"),
        ),
        "put25DeltaImpliedVolatility": clean_history_number(
            focus_contract.get("put25DeltaImpliedVolatility"),
        ),
        "call25DeltaImpliedVolatility": clean_history_number(
            focus_contract.get("call25DeltaImpliedVolatility"),
        ),
        "normalizedSkew": clean_history_number(focus_contract.get("normalizedSkew")),
        "normalizedUpsideSkew": clean_history_number(
            focus_contract.get("normalizedUpsideSkew"),
        ),
        "historicalVolatility20": clean_history_number(
            focus_contract.get("historicalVolatility20"),
        ),
        "historicalVolatility60": clean_history_number(
            focus_contract.get("historicalVolatility60"),
        ),
        "ivHv20Ratio": clean_history_number(focus_contract.get("ivHv20Ratio")),
        "ivHv60Ratio": clean_history_number(focus_contract.get("ivHv60Ratio")),
        "ivPercentile": history_summary["ivPercentile"],
        "rvPercentile": rv_percentile,
        "vrp": clean_history_number(focus_contract.get("ivHv20Spread")),
        "ivHv20Percentile": history_summary["ivHv20Percentile"],
        "combinedOpenInterest": combined_open_interest,
        "combinedVolume": combined_volume,
        "spreadShare": spread_share,
        "pricingLabel": pricing_label,
        "pricingBucket": pricing_bucket,
        "directionScore": clean_history_number(direction_context.get("directionScore")),
        "directionLabel": str(direction_context.get("directionLabel") or "No Read"),
        "trendScore": clean_history_number(trend_context.get("score")),
        "trendLabel": str(trend_context.get("label") or "No Read"),
        "trendReturn63": clean_history_number(trend_context.get("return63")),
        "trendReturn252": clean_history_number(trend_context.get("return252")),
        "seasonalityScore": clean_history_number(seasonality_context.get("score")),
        "seasonalityLabel": str(seasonality_context.get("label") or "No Read"),
        "seasonalityMonthLabel": str(seasonality_context.get("calendarMonthLabel") or ""),
        "seasonalityMeanReturn": clean_history_number(seasonality_context.get("meanReturn")),
        "seasonalityMedianReturn": clean_history_number(
            seasonality_context.get("medianReturn"),
        ),
        "seasonalityWinRate": clean_history_number(seasonality_context.get("winRate")),
        "seasonalityAverageAbsoluteReturn": clean_history_number(
            seasonality_context.get("averageAbsoluteReturn"),
        ),
        "seasonalityObservations": (
            int(seasonality_context.get("observations"))
            if seasonality_context.get("observations") is not None
            else None
        ),
        "volPricingScore": vol_pricing_score,
        "executionScore": execution_score,
        "confidenceScore": confidence_score,
        "candidateAdvisory": candidate_advisory["label"],
        "candidateBucket": candidate_advisory["bucket"],
        "frontImpliedVolatility": term_structure_context["frontImpliedVolatility"],
        "backImpliedVolatility": term_structure_context["backImpliedVolatility"],
        "termStructureSteepness": term_structure_context["termStructureSteepness"],
        "termStructureBucket": term_structure_context["termStructureBucket"],
        "termStructureLabel": term_structure_context["termStructureLabel"],
        "signalVersion": OPTIONS_SIGNAL_VERSION,
        "warnings": warnings,
    }

def decorate_options_screener_storage_rows(rows: list[dict]) -> list[dict]:
    iv_series = [clean_history_number(row.get("ivPercentile")) for row in rows]
    rv_series = [clean_history_number(row.get("rvPercentile")) for row in rows]
    vrp_series = [clean_history_number(row.get("vrp")) for row in rows]
    term_series = [clean_history_number(row.get("termStructureSteepness")) for row in rows]
    skew_series = [clean_history_number(row.get("normalizedSkew")) for row in rows]

    decorated_rows = []
    for row in rows:
        iv_rank = compute_cross_sectional_rank(
            iv_series,
            clean_history_number(row.get("ivPercentile")),
        )
        rv_rank = compute_cross_sectional_rank(
            rv_series,
            clean_history_number(row.get("rvPercentile")),
        )
        vrp_rank = compute_cross_sectional_rank(
            vrp_series,
            clean_history_number(row.get("vrp")),
        )
        term_structure_rank = compute_cross_sectional_rank(
            term_series,
            clean_history_number(row.get("termStructureSteepness")),
        )
        skew_rank = compute_cross_sectional_rank(
            skew_series,
            clean_history_number(row.get("normalizedSkew")),
        )
        trade_idea_matches = build_trade_idea_matches(
            {
                **row,
                "ivRank": iv_rank,
                "rvRank": rv_rank,
                "vrpRank": vrp_rank,
                "termStructureRank": term_structure_rank,
                "skewRank": skew_rank,
            },
        )
        decorated_rows.append(
            {
                **row,
                "ivRank": iv_rank,
                "rvRank": rv_rank,
                "vrpRank": vrp_rank,
                "termStructureRank": term_structure_rank,
                "skewRank": skew_rank,
                "tradeIdeaLabels": [
                    definition["label"] for definition in trade_idea_matches
                ],
                "primaryTradeIdea": (
                    trade_idea_matches[0]["label"]
                    if trade_idea_matches
                    else "No Preset Match"
                ),
            },
        )
    return decorated_rows

def summarize_options_screener_run(
    run: dict,
    rows: list[dict],
    *,
    preview_rows: list[dict] | None = None,
) -> dict:
    pricing_counts = {
        "rich": 0,
        "cheap": 0,
        "fair": 0,
        "none": 0,
    }
    candidate_counts = {
        "long-premium": 0,
        "short-premium": 0,
        "low-confidence": 0,
        "watch": 0,
    }

    for row in rows:
        pricing_bucket = str(row.get("pricingBucket") or "none").strip().lower()
        if pricing_bucket in pricing_counts:
            pricing_counts[pricing_bucket] += 1
        candidate_bucket = str(row.get("candidateBucket") or "watch").strip().lower()
        if candidate_bucket in candidate_counts:
            candidate_counts[candidate_bucket] += 1

    top_direction = max(
        rows,
        key=lambda row: (
            clean_history_number(row.get("directionScore"))
            if clean_history_number(row.get("directionScore")) is not None
            else -1
        ),
        default=None,
    )
    rich_rows = [
        row
        for row in rows
        if str(row.get("pricingBucket") or "").strip().lower() == "rich"
    ]
    cheap_rows = [
        row
        for row in rows
        if str(row.get("pricingBucket") or "").strip().lower() == "cheap"
    ]
    top_rich = max(
        rich_rows,
        key=lambda row: (
            clean_history_number(row.get("ivHv20Ratio"))
            if clean_history_number(row.get("ivHv20Ratio")) is not None
            else -1
        ),
        default=None,
    )
    top_cheap = min(
        cheap_rows,
        key=lambda row: (
            clean_history_number(row.get("ivHv20Ratio"))
            if clean_history_number(row.get("ivHv20Ratio")) is not None
            else float("inf")
        ),
        default=None,
    )

    return {
        **run,
        "pricingCounts": pricing_counts,
        "candidateCounts": candidate_counts,
        "topDirection": (
            {
                "symbol": top_direction.get("symbol"),
                "directionLabel": top_direction.get("directionLabel"),
                "directionScore": top_direction.get("directionScore"),
            }
            if top_direction
            else None
        ),
        "topRich": (
            {
                "symbol": top_rich.get("symbol"),
                "pricingLabel": top_rich.get("pricingLabel"),
                "ivHv20Ratio": top_rich.get("ivHv20Ratio"),
            }
            if top_rich
            else None
        ),
        "topCheap": (
            {
                "symbol": top_cheap.get("symbol"),
                "pricingLabel": top_cheap.get("pricingLabel"),
                "ivHv20Ratio": top_cheap.get("ivHv20Ratio"),
            }
            if top_cheap
            else None
        ),
        "rows": preview_rows if preview_rows is not None else rows,
    }

def build_monthly_straddle_snapshot_response(
    symbol: str,
    *,
    minimum_dte: int,
    max_contracts: int,
) -> dict:
    snapshot = fetch_monthly_straddle_snapshot(
        symbol,
        minimum_dte=minimum_dte,
        max_contracts=max_contracts,
    )
    try:
        write_option_monthly_snapshot(symbol, snapshot)
        snapshot["history"] = {
            "frontContracts": load_option_front_history(
                symbol,
                provider=snapshot.get("provider"),
                limit=252,
            ),
        }
    except Exception as storage_error:  # noqa: BLE001
        snapshot["storageWarning"] = (
            f"Local snapshot persistence failed: {storage_error}"
        )
    return snapshot

def build_monthly_straddle_payload(request: dict) -> dict:
    symbol = normalize_symbol(request.get("symbol"))
    if not symbol:
        raise ValueError("A symbol is required.")

    minimum_dte = int(request.get("minimumDte") or 25)
    max_contracts = int(request.get("maxContracts") or 4)
    if minimum_dte < 7 or minimum_dte > 365:
        raise ValueError("Minimum DTE must be between 7 and 365 days.")
    if max_contracts < 1 or max_contracts > 8:
        raise ValueError("Contract count must be between 1 and 8.")

    return {
        "snapshot": build_monthly_straddle_snapshot_response(
            symbol,
            minimum_dte=minimum_dte,
            max_contracts=max_contracts,
        ),
    }

def build_options_screener_snapshot_payload(request: dict) -> dict:
    ensure_runtime_store()
    raw_symbols = request.get("symbols")
    if not isinstance(raw_symbols, list) or not raw_symbols:
        raise ValueError("At least one symbol is required.")

    normalized_symbols: list[str] = []
    for raw_symbol in raw_symbols:
        symbol = normalize_symbol(raw_symbol)
        if symbol and symbol not in normalized_symbols:
            normalized_symbols.append(symbol)

    if not normalized_symbols:
        raise ValueError("At least one valid symbol is required.")
    if len(normalized_symbols) > OPTIONS_SCREENER_MAX_SYMBOLS:
        raise ValueError(
            f"Options screener accepts up to {OPTIONS_SCREENER_MAX_SYMBOLS} symbols per run.",
        )

    minimum_dte = int(request.get("minimumDte") or 25)
    max_contracts = int(request.get("maxContracts") or 1)
    universe_id = str(request.get("universeId") or "custom").strip() or "custom"
    universe_label = (
        str(request.get("universeLabel") or "Custom Universe").strip()
        or "Custom Universe"
    )
    if minimum_dte < 7 or minimum_dte > 365:
        raise ValueError("Minimum DTE must be between 7 and 365 days.")
    if max_contracts < 1 or max_contracts > 4:
        raise ValueError("Contract count must be between 1 and 4.")

    def load_symbol_snapshot(symbol: str) -> dict:
        try:
            snapshot = build_monthly_straddle_snapshot_response(
                symbol,
                minimum_dte=minimum_dte,
                max_contracts=max_contracts,
            )
            try:
                snapshot["directionContext"] = build_direction_context(
                    symbol,
                    as_of_date=snapshot.get("asOfDate"),
                    preferred_provider=snapshot.get("provider"),
                )
            except Exception as direction_error:  # noqa: BLE001
                snapshot["directionWarning"] = str(direction_error)
            return {
                "symbol": symbol,
                "snapshot": snapshot,
                "error": None,
            }
        except Exception as error:  # noqa: BLE001
            return {
                "symbol": symbol,
                "snapshot": None,
                "error": str(error),
            }

    worker_count = min(OPTIONS_SCREENER_FETCH_CONCURRENCY, len(normalized_symbols))
    with ThreadPoolExecutor(max_workers=max(1, worker_count)) as executor:
        results = list(executor.map(load_symbol_snapshot, normalized_symbols))

    snapshots = [
        result["snapshot"]
        for result in results
        if result["snapshot"] is not None
    ]
    failures = [
        {
            "symbol": result["symbol"],
            "error": result["error"],
        }
        for result in results
        if result["snapshot"] is None
    ]
    if not snapshots:
        raise RuntimeError("None of the requested symbols returned a usable options snapshot.")

    storage = None
    storage_warning = None
    try:
        storage_rows = decorate_options_screener_storage_rows(
            [
            build_options_screener_storage_row(snapshot)
            for snapshot in snapshots
            ],
        )
        storage = record_options_screener_run(
            universe_id=universe_id,
            universe_label=universe_label,
            minimum_dte=minimum_dte,
            max_contracts=max_contracts,
            requested_symbols=normalized_symbols,
            failures=failures,
            rows=storage_rows,
            signal_version=OPTIONS_SIGNAL_VERSION,
        )
    except Exception as storage_error:  # noqa: BLE001
        storage_warning = str(storage_error)

    return {
        "universeId": universe_id,
        "universeLabel": universe_label,
        "symbols": normalized_symbols,
        "minimumDte": minimum_dte,
        "maxContracts": max_contracts,
        "snapshots": snapshots,
        "failures": failures,
        "storage": storage,
        "storageWarning": storage_warning,
        "signalVersion": OPTIONS_SIGNAL_VERSION,
    }

def build_options_screener_history_payload(request: dict) -> dict:
    ensure_runtime_store()
    universe_id = str(request.get("universeId") or "").strip() or None
    limit = max(1, min(int(request.get("limit") or 6), 12))
    row_limit = max(1, min(int(request.get("rowLimit") or 10), 25))

    runs = load_recent_options_screener_runs(limit=limit * 3)
    if universe_id:
        runs = [
            run
            for run in runs
            if str(run.get("universeId") or "").strip() == universe_id
        ]
    runs = runs[:limit]

    summaries = []
    for run in runs:
        full_rows = load_options_screener_rows(
            run_id=run["runId"],
            limit=max(row_limit, int(run.get("rowCount") or row_limit)),
        )
        summaries.append(
            summarize_options_screener_run(
                run,
                full_rows,
                preview_rows=full_rows[:row_limit],
            ),
        )

    return {
        "universeId": universe_id,
        "runs": summaries,
    }
