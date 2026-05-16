from __future__ import annotations

import json
import sqlite3


def load_option_monthly_snapshots(
    symbol: str,
    *,
    as_of_date: str | None = None,
    provider: str | None = None,
    normalize_symbol,
    open_runtime_store,
    load_symbol_row,
) -> list[dict]:
    normalized_symbol = normalize_symbol(symbol)
    if not normalized_symbol:
        return []

    with open_runtime_store() as connection:
        symbol_row = load_symbol_row(connection, normalized_symbol)
        if symbol_row is None:
            return []

        clauses = ["symbol_id = ?"]
        params: list[str | int] = [int(symbol_row["symbol_id"])]
        if as_of_date:
            clauses.append("as_of_date = ?")
            params.append(str(as_of_date))
        if provider:
            clauses.append("provider = ?")
            params.append(str(provider).strip().lower())

        rows = connection.execute(
            f"""
            SELECT
                provider,
                as_of_date,
                fetched_at,
                expiry,
                currency,
                spot_date,
                spot_price,
                minimum_dte,
                max_contracts,
                days_to_expiry,
                strike,
                call_bid,
                call_ask,
                call_last_price,
                call_mid_price,
                call_price_source,
                call_open_interest,
                call_volume,
                call_implied_volatility,
                put_bid,
                put_ask,
                put_last_price,
                put_mid_price,
                put_price_source,
                put_open_interest,
                put_volume,
                put_implied_volatility,
                straddle_mid_price,
                implied_move_price,
                implied_move_percent,
                straddle_implied_volatility,
                chain_implied_volatility,
                implied_volatility_gap,
                historical_volatility_20,
                historical_volatility_60,
                historical_volatility_120,
                iv_hv20_ratio,
                iv_hv60_ratio,
                iv_hv120_ratio,
                iv_hv20_spread,
                iv_hv60_spread,
                iv_hv120_spread,
                combined_open_interest,
                combined_volume,
                pricing_mode
            FROM option_monthly_snapshots
            WHERE {' AND '.join(clauses)}
            ORDER BY as_of_date DESC, expiry ASC
            """,
            tuple(params),
        ).fetchall()

    return [
        {
            "provider": row["provider"],
            "asOfDate": row["as_of_date"],
            "fetchedAt": row["fetched_at"],
            "expiry": row["expiry"],
            "currency": row["currency"],
            "spotDate": row["spot_date"],
            "spotPrice": row["spot_price"],
            "minimumDte": row["minimum_dte"],
            "maxContracts": row["max_contracts"],
            "daysToExpiry": row["days_to_expiry"],
            "strike": row["strike"],
            "callBid": row["call_bid"],
            "callAsk": row["call_ask"],
            "callLastPrice": row["call_last_price"],
            "callMidPrice": row["call_mid_price"],
            "callPriceSource": row["call_price_source"],
            "callOpenInterest": row["call_open_interest"],
            "callVolume": row["call_volume"],
            "callImpliedVolatility": row["call_implied_volatility"],
            "putBid": row["put_bid"],
            "putAsk": row["put_ask"],
            "putLastPrice": row["put_last_price"],
            "putMidPrice": row["put_mid_price"],
            "putPriceSource": row["put_price_source"],
            "putOpenInterest": row["put_open_interest"],
            "putVolume": row["put_volume"],
            "putImpliedVolatility": row["put_implied_volatility"],
            "straddleMidPrice": row["straddle_mid_price"],
            "impliedMovePrice": row["implied_move_price"],
            "impliedMovePercent": row["implied_move_percent"],
            "straddleImpliedVolatility": row["straddle_implied_volatility"],
            "chainImpliedVolatility": row["chain_implied_volatility"],
            "impliedVolatilityGap": row["implied_volatility_gap"],
            "historicalVolatility20": row["historical_volatility_20"],
            "historicalVolatility60": row["historical_volatility_60"],
            "historicalVolatility120": row["historical_volatility_120"],
            "ivHv20Ratio": row["iv_hv20_ratio"],
            "ivHv60Ratio": row["iv_hv60_ratio"],
            "ivHv120Ratio": row["iv_hv120_ratio"],
            "ivHv20Spread": row["iv_hv20_spread"],
            "ivHv60Spread": row["iv_hv60_spread"],
            "ivHv120Spread": row["iv_hv120_spread"],
            "combinedOpenInterest": row["combined_open_interest"],
            "combinedVolume": row["combined_volume"],
            "pricingMode": row["pricing_mode"],
        }
        for row in rows
    ]


def load_option_front_history(
    symbol: str,
    *,
    provider: str | None = None,
    limit: int = 252,
    normalize_symbol,
    open_runtime_store,
    load_symbol_row,
) -> list[dict]:
    normalized_symbol = normalize_symbol(symbol)
    if not normalized_symbol:
        return []

    normalized_limit = max(1, int(limit or 252))
    with open_runtime_store() as connection:
        symbol_row = load_symbol_row(connection, normalized_symbol)
        if symbol_row is None:
            return []

        clauses = ["symbol_id = ?"]
        params: list[str | int] = [int(symbol_row["symbol_id"])]
        if provider:
            clauses.append("provider = ?")
            params.append(str(provider).strip().lower())

        rows = connection.execute(
            f"""
            WITH ranked_rows AS (
                SELECT
                    provider,
                    as_of_date,
                    fetched_at,
                    expiry,
                    days_to_expiry,
                    strike,
                    spot_price,
                    implied_move_percent,
                    straddle_implied_volatility,
                    chain_implied_volatility,
                    implied_volatility_gap,
                    historical_volatility_20,
                    historical_volatility_60,
                    historical_volatility_120,
                    iv_hv20_ratio,
                    iv_hv60_ratio,
                    iv_hv120_ratio,
                    iv_hv20_spread,
                    iv_hv60_spread,
                    iv_hv120_spread,
                    combined_open_interest,
                    combined_volume,
                    ROW_NUMBER() OVER (
                        PARTITION BY symbol_id, provider, as_of_date
                        ORDER BY days_to_expiry ASC, expiry ASC
                    ) AS row_rank
                FROM option_monthly_snapshots
                WHERE {' AND '.join(clauses)}
            )
            SELECT
                provider,
                as_of_date,
                fetched_at,
                expiry,
                days_to_expiry,
                strike,
                spot_price,
                implied_move_percent,
                straddle_implied_volatility,
                chain_implied_volatility,
                implied_volatility_gap,
                historical_volatility_20,
                historical_volatility_60,
                historical_volatility_120,
                iv_hv20_ratio,
                iv_hv60_ratio,
                iv_hv120_ratio,
                iv_hv20_spread,
                iv_hv60_spread,
                iv_hv120_spread,
                combined_open_interest,
                combined_volume
            FROM ranked_rows
            WHERE row_rank = 1
            ORDER BY as_of_date DESC
            LIMIT ?
            """,
            tuple([*params, normalized_limit]),
        ).fetchall()

    return [
        {
            "provider": row["provider"],
            "asOfDate": row["as_of_date"],
            "fetchedAt": row["fetched_at"],
            "expiry": row["expiry"],
            "daysToExpiry": row["days_to_expiry"],
            "strike": row["strike"],
            "spotPrice": row["spot_price"],
            "impliedMovePercent": row["implied_move_percent"],
            "straddleImpliedVolatility": row["straddle_implied_volatility"],
            "chainImpliedVolatility": row["chain_implied_volatility"],
            "impliedVolatilityGap": row["implied_volatility_gap"],
            "historicalVolatility20": row["historical_volatility_20"],
            "historicalVolatility60": row["historical_volatility_60"],
            "historicalVolatility120": row["historical_volatility_120"],
            "ivHv20Ratio": row["iv_hv20_ratio"],
            "ivHv60Ratio": row["iv_hv60_ratio"],
            "ivHv120Ratio": row["iv_hv120_ratio"],
            "ivHv20Spread": row["iv_hv20_spread"],
            "ivHv60Spread": row["iv_hv60_spread"],
            "ivHv120Spread": row["iv_hv120_spread"],
            "combinedOpenInterest": row["combined_open_interest"],
            "combinedVolume": row["combined_volume"],
        }
        for row in reversed(rows)
    ]


def load_derived_daily_metrics(
    symbol: str,
    *,
    metric_date: str | None = None,
    provider: str | None = None,
    metric_family: str | None = None,
    normalize_symbol,
    open_runtime_store,
    load_symbol_row,
) -> list[dict]:
    normalized_symbol = normalize_symbol(symbol)
    if not normalized_symbol:
        return []

    with open_runtime_store() as connection:
        symbol_row = load_symbol_row(connection, normalized_symbol)
        if symbol_row is None:
            return []

        clauses = ["symbol_id = ?"]
        params: list[str | int] = [int(symbol_row["symbol_id"])]
        if metric_date:
            clauses.append("metric_date = ?")
            params.append(str(metric_date))
        if provider:
            clauses.append("provider = ?")
            params.append(str(provider).strip().lower())
        if metric_family:
            clauses.append("metric_family = ?")
            params.append(str(metric_family).strip())

        rows = connection.execute(
            f"""
            SELECT
                provider,
                metric_date,
                metric_family,
                metric_key,
                window_days,
                metric_value,
                source,
                updated_at
            FROM derived_daily_metrics
            WHERE {' AND '.join(clauses)}
            ORDER BY metric_date DESC, metric_family ASC, window_days ASC, metric_key ASC
            """,
            tuple(params),
        ).fetchall()

    return [
        {
            "provider": row["provider"],
            "metricDate": row["metric_date"],
            "metricFamily": row["metric_family"],
            "metricKey": row["metric_key"],
            "windowDays": row["window_days"],
            "metricValue": row["metric_value"],
            "source": row["source"],
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]


def load_recent_options_screener_runs(limit: int = 20, *, open_runtime_store) -> list[dict]:
    normalized_limit = max(1, int(limit or 20))
    with open_runtime_store() as connection:
        rows = connection.execute(
            """
            SELECT
                run_id,
                universe_id,
                universe_label,
                minimum_dte,
                max_contracts,
                signal_version,
                requested_symbols_json,
                failure_json,
                row_count,
                failure_count,
                as_of_date,
                created_at
            FROM options_screener_runs
            ORDER BY created_at DESC, run_id DESC
            LIMIT ?
            """,
            (normalized_limit,),
        ).fetchall()

    return [
        {
            "runId": row["run_id"],
            "universeId": row["universe_id"],
            "universeLabel": row["universe_label"],
            "minimumDte": row["minimum_dte"],
            "maxContracts": row["max_contracts"],
            "signalVersion": row["signal_version"],
            "requestedSymbols": json.loads(row["requested_symbols_json"] or "[]"),
            "failures": json.loads(row["failure_json"] or "[]"),
            "rowCount": row["row_count"],
            "failureCount": row["failure_count"],
            "asOfDate": row["as_of_date"],
            "createdAt": row["created_at"],
        }
        for row in rows
    ]


def load_options_screener_rows(
    *,
    symbol: str | None = None,
    universe_id: str | None = None,
    run_id: int | None = None,
    limit: int = 100,
    open_runtime_store,
    load_symbol_row,
) -> list[dict]:
    normalized_limit = max(1, int(limit or 100))
    with open_runtime_store() as connection:
        clauses = []
        params: list[str | int] = []
        if symbol:
            symbol_row = load_symbol_row(connection, symbol)
            if symbol_row is None:
                return []
            clauses.append("rows.symbol_id = ?")
            params.append(int(symbol_row["symbol_id"]))
        if universe_id:
            clauses.append("runs.universe_id = ?")
            params.append(str(universe_id).strip())
        if run_id is not None:
            clauses.append("rows.run_id = ?")
            params.append(int(run_id))

        where_clause = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = connection.execute(
            f"""
            SELECT
                runs.run_id,
                runs.universe_id,
                runs.universe_label,
                runs.created_at,
                runs.as_of_date AS run_as_of_date,
                runs.signal_version AS run_signal_version,
                symbols.symbol,
                rows.provider,
                rows.as_of_date,
                rows.expiry,
                rows.spot_price,
                rows.strike,
                rows.days_to_expiry,
                rows.straddle_mid_price,
                rows.implied_move_percent,
                rows.straddle_implied_volatility,
                rows.chain_implied_volatility,
                rows.historical_volatility_20,
                rows.historical_volatility_60,
                rows.iv_hv20_ratio,
                rows.iv_hv60_ratio,
                rows.iv_percentile,
                rows.iv_hv20_percentile,
                rows.combined_open_interest,
                rows.combined_volume,
                rows.spread_share,
                rows.pricing_label,
                rows.pricing_bucket,
                rows.direction_score,
                rows.direction_label,
                rows.trend_score,
                rows.trend_label,
                rows.trend_return_63,
                rows.trend_return_252,
                rows.seasonality_score,
                rows.seasonality_label,
                rows.seasonality_month_label,
                rows.seasonality_mean_return,
                rows.seasonality_median_return,
                rows.seasonality_win_rate,
                rows.seasonality_average_absolute_return,
                rows.seasonality_observations,
                rows.vol_pricing_score,
                rows.execution_score,
                rows.confidence_score,
                rows.candidate_advisory,
                rows.candidate_bucket,
                rows.signal_version,
                rows.rv_percentile,
                rows.vrp,
                rows.front_implied_volatility,
                rows.back_implied_volatility,
                rows.term_structure_steepness,
                rows.term_structure_bucket,
                rows.term_structure_label,
                rows.atm_implied_volatility,
                rows.put_25_delta_implied_volatility,
                rows.call_25_delta_implied_volatility,
                rows.normalized_skew,
                rows.normalized_upside_skew,
                rows.iv_rank,
                rows.rv_rank,
                rows.vrp_rank,
                rows.term_structure_rank,
                rows.skew_rank,
                rows.primary_trade_idea,
                rows.trade_idea_labels_json,
                rows.warnings_json
            FROM options_screener_rows AS rows
            INNER JOIN options_screener_runs AS runs
                ON runs.run_id = rows.run_id
            INNER JOIN symbols
                ON symbols.symbol_id = rows.symbol_id
            {where_clause}
            ORDER BY runs.created_at DESC, rows.symbol_id ASC
            LIMIT ?
            """,
            tuple([*params, normalized_limit]),
        ).fetchall()

    return [
        {
            "runId": row["run_id"],
            "universeId": row["universe_id"],
            "universeLabel": row["universe_label"],
            "createdAt": row["created_at"],
            "runAsOfDate": row["run_as_of_date"],
            "runSignalVersion": row["run_signal_version"],
            "symbol": row["symbol"],
            "provider": row["provider"],
            "asOfDate": row["as_of_date"],
            "expiry": row["expiry"],
            "spotPrice": row["spot_price"],
            "strike": row["strike"],
            "daysToExpiry": row["days_to_expiry"],
            "straddleMidPrice": row["straddle_mid_price"],
            "impliedMovePercent": row["implied_move_percent"],
            "straddleImpliedVolatility": row["straddle_implied_volatility"],
            "chainImpliedVolatility": row["chain_implied_volatility"],
            "historicalVolatility20": row["historical_volatility_20"],
            "historicalVolatility60": row["historical_volatility_60"],
            "ivHv20Ratio": row["iv_hv20_ratio"],
            "ivHv60Ratio": row["iv_hv60_ratio"],
            "ivPercentile": row["iv_percentile"],
            "ivHv20Percentile": row["iv_hv20_percentile"],
            "combinedOpenInterest": row["combined_open_interest"],
            "combinedVolume": row["combined_volume"],
            "spreadShare": row["spread_share"],
            "pricingLabel": row["pricing_label"],
            "pricingBucket": row["pricing_bucket"],
            "directionScore": row["direction_score"],
            "directionLabel": row["direction_label"],
            "trendScore": row["trend_score"],
            "trendLabel": row["trend_label"],
            "trendReturn63": row["trend_return_63"],
            "trendReturn252": row["trend_return_252"],
            "seasonalityScore": row["seasonality_score"],
            "seasonalityLabel": row["seasonality_label"],
            "seasonalityMonthLabel": row["seasonality_month_label"],
            "seasonalityMeanReturn": row["seasonality_mean_return"],
            "seasonalityMedianReturn": row["seasonality_median_return"],
            "seasonalityWinRate": row["seasonality_win_rate"],
            "seasonalityAverageAbsoluteReturn": row["seasonality_average_absolute_return"],
            "seasonalityObservations": row["seasonality_observations"],
            "volPricingScore": row["vol_pricing_score"],
            "executionScore": row["execution_score"],
            "confidenceScore": row["confidence_score"],
            "candidateAdvisory": row["candidate_advisory"],
            "candidateBucket": row["candidate_bucket"],
            "signalVersion": row["signal_version"] or row["run_signal_version"],
            "rvPercentile": row["rv_percentile"],
            "vrp": row["vrp"],
            "frontImpliedVolatility": row["front_implied_volatility"],
            "backImpliedVolatility": row["back_implied_volatility"],
            "termStructureSteepness": row["term_structure_steepness"],
            "termStructureBucket": row["term_structure_bucket"],
            "termStructureLabel": row["term_structure_label"],
            "atmImpliedVolatility": row["atm_implied_volatility"],
            "put25DeltaImpliedVolatility": row["put_25_delta_implied_volatility"],
            "call25DeltaImpliedVolatility": row["call_25_delta_implied_volatility"],
            "normalizedSkew": row["normalized_skew"],
            "normalizedUpsideSkew": row["normalized_upside_skew"],
            "ivRank": row["iv_rank"],
            "rvRank": row["rv_rank"],
            "vrpRank": row["vrp_rank"],
            "termStructureRank": row["term_structure_rank"],
            "skewRank": row["skew_rank"],
            "primaryTradeIdea": row["primary_trade_idea"],
            "tradeIdeaLabels": json.loads(row["trade_idea_labels_json"] or "[]"),
            "warnings": json.loads(row["warnings_json"] or "[]"),
        }
        for row in rows
    ]


def record_options_screener_run(
    *,
    universe_id: str,
    universe_label: str,
    minimum_dte: int,
    max_contracts: int,
    requested_symbols: list[str],
    failures: list[dict],
    rows: list[dict],
    signal_version: str | None = None,
    created_at: str | None = None,
    normalize_symbol,
    open_runtime_store,
    ensure_symbol_row,
    clean_text,
    clean_number,
    clean_int,
    to_iso,
    now_utc,
) -> dict:
    if not rows:
        raise RuntimeError("At least one screener row is required to record a run.")

    timestamp = str(created_at or to_iso(now_utc())).strip()
    normalized_requested_symbols = [
        normalize_symbol(symbol)
        for symbol in requested_symbols
        if normalize_symbol(symbol)
    ]
    as_of_date = max(
        (str(row.get("asOfDate") or "").strip() for row in rows if row.get("asOfDate")),
        default=None,
    )

    with open_runtime_store() as connection:
        cursor = connection.execute(
            """
            INSERT INTO options_screener_runs (
                universe_id,
                universe_label,
                minimum_dte,
                max_contracts,
                signal_version,
                requested_symbols_json,
                failure_json,
                row_count,
                failure_count,
                as_of_date,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(universe_id or "custom").strip() or "custom",
                str(universe_label or "Custom Universe").strip() or "Custom Universe",
                int(minimum_dte or 25),
                int(max_contracts or 1),
                clean_text(signal_version) or "legacy-v0",
                json.dumps(normalized_requested_symbols, separators=(",", ":")),
                json.dumps(failures or [], separators=(",", ":")),
                len(rows),
                len(failures or []),
                as_of_date,
                timestamp,
            ),
        )
        run_id = int(cursor.lastrowid)

        row_payloads = []
        for row in rows:
            normalized_symbol = normalize_symbol(row.get("symbol"))
            if not normalized_symbol:
                continue
            symbol_id = ensure_symbol_row(
                connection,
                normalized_symbol,
                currency=row.get("currency"),
                provider=row.get("provider"),
                source_series_type="Price",
                timestamp=timestamp,
            )
            row_payloads.append(
                (
                    run_id,
                    symbol_id,
                    str(row.get("provider") or "yfinance").strip().lower() or "yfinance",
                    str(row.get("asOfDate") or "").strip(),
                    str(row.get("expiry") or "").strip() or None,
                    clean_number(row.get("spotPrice")),
                    clean_number(row.get("strike")),
                    clean_int(row.get("daysToExpiry")),
                    clean_number(row.get("straddleMidPrice")),
                    clean_number(row.get("impliedMovePercent")),
                    clean_number(row.get("straddleImpliedVolatility")),
                    clean_number(row.get("chainImpliedVolatility")),
                    clean_number(row.get("historicalVolatility20")),
                    clean_number(row.get("historicalVolatility60")),
                    clean_number(row.get("ivHv20Ratio")),
                    clean_number(row.get("ivHv60Ratio")),
                    clean_number(row.get("ivPercentile")),
                    clean_number(row.get("ivHv20Percentile")),
                    clean_int(row.get("combinedOpenInterest")),
                    clean_int(row.get("combinedVolume")),
                    clean_number(row.get("spreadShare")),
                    clean_text(row.get("pricingLabel")),
                    clean_text(row.get("pricingBucket")),
                    clean_number(row.get("directionScore")),
                    clean_text(row.get("directionLabel")),
                    clean_number(row.get("trendScore")),
                    clean_text(row.get("trendLabel")),
                    clean_number(row.get("trendReturn63")),
                    clean_number(row.get("trendReturn252")),
                    clean_number(row.get("seasonalityScore")),
                    clean_text(row.get("seasonalityLabel")),
                    clean_text(row.get("seasonalityMonthLabel")),
                    clean_number(row.get("seasonalityMeanReturn")),
                    clean_number(row.get("seasonalityMedianReturn")),
                    clean_number(row.get("seasonalityWinRate")),
                    clean_number(row.get("seasonalityAverageAbsoluteReturn")),
                    clean_int(row.get("seasonalityObservations")),
                    clean_number(row.get("volPricingScore")),
                    clean_number(row.get("executionScore")),
                    clean_number(row.get("confidenceScore")),
                    clean_text(row.get("candidateAdvisory")),
                    clean_text(row.get("candidateBucket")),
                    clean_text(row.get("signalVersion")) or clean_text(signal_version) or "legacy-v0",
                    clean_number(row.get("rvPercentile")),
                    clean_number(row.get("vrp")),
                    clean_number(row.get("frontImpliedVolatility")),
                    clean_number(row.get("backImpliedVolatility")),
                    clean_number(row.get("termStructureSteepness")),
                    clean_text(row.get("termStructureBucket")),
                    clean_text(row.get("termStructureLabel")),
                    clean_number(row.get("atmImpliedVolatility")),
                    clean_number(row.get("put25DeltaImpliedVolatility")),
                    clean_number(row.get("call25DeltaImpliedVolatility")),
                    clean_number(row.get("normalizedSkew")),
                    clean_number(row.get("normalizedUpsideSkew")),
                    clean_number(row.get("ivRank")),
                    clean_number(row.get("rvRank")),
                    clean_number(row.get("vrpRank")),
                    clean_number(row.get("termStructureRank")),
                    clean_number(row.get("skewRank")),
                    clean_text(row.get("primaryTradeIdea")),
                    json.dumps(row.get("tradeIdeaLabels") or [], separators=(",", ":")),
                    json.dumps(row.get("warnings") or [], separators=(",", ":")),
                    timestamp,
                )
            )

        if not row_payloads:
            raise RuntimeError("No valid screener rows were available to record.")

        connection.executemany(
            """
            INSERT INTO options_screener_rows (
                run_id,
                symbol_id,
                provider,
                as_of_date,
                expiry,
                spot_price,
                strike,
                days_to_expiry,
                straddle_mid_price,
                implied_move_percent,
                straddle_implied_volatility,
                chain_implied_volatility,
                historical_volatility_20,
                historical_volatility_60,
                iv_hv20_ratio,
                iv_hv60_ratio,
                iv_percentile,
                iv_hv20_percentile,
                combined_open_interest,
                combined_volume,
                spread_share,
                pricing_label,
                pricing_bucket,
                direction_score,
                direction_label,
                trend_score,
                trend_label,
                trend_return_63,
                trend_return_252,
                seasonality_score,
                seasonality_label,
                seasonality_month_label,
                seasonality_mean_return,
                seasonality_median_return,
                seasonality_win_rate,
                seasonality_average_absolute_return,
                seasonality_observations,
                vol_pricing_score,
                execution_score,
                confidence_score,
                candidate_advisory,
                candidate_bucket,
                signal_version,
                rv_percentile,
                vrp,
                front_implied_volatility,
                back_implied_volatility,
                term_structure_steepness,
                term_structure_bucket,
                term_structure_label,
                atm_implied_volatility,
                put_25_delta_implied_volatility,
                call_25_delta_implied_volatility,
                normalized_skew,
                normalized_upside_skew,
                iv_rank,
                rv_rank,
                vrp_rank,
                term_structure_rank,
                skew_rank,
                primary_trade_idea,
                trade_idea_labels_json,
                warnings_json,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            row_payloads,
        )
        connection.commit()

    return {
        "runId": run_id,
        "universeId": str(universe_id or "custom").strip() or "custom",
        "universeLabel": str(universe_label or "Custom Universe").strip() or "Custom Universe",
        "signalVersion": clean_text(signal_version) or "legacy-v0",
        "asOfDate": as_of_date,
        "rowCount": len(row_payloads),
        "failureCount": len(failures or []),
        "createdAt": timestamp,
    }


def write_option_monthly_snapshot(
    symbol: str,
    snapshot: dict,
    *,
    normalize_symbol,
    open_runtime_store,
    load_symbol_row,
    ensure_symbol_row,
    to_iso,
    now_utc,
) -> list[dict]:
    normalized_symbol = normalize_symbol(symbol or snapshot.get("symbol"))
    if not normalized_symbol:
        raise RuntimeError("symbol is required to cache option snapshots.")

    as_of_date = str(snapshot.get("asOfDate") or "").strip()
    contracts = snapshot.get("monthlyContracts") or []
    if not as_of_date:
        raise RuntimeError("monthly straddle snapshot is missing an as-of date.")
    if not isinstance(contracts, list) or not contracts:
        raise RuntimeError("monthly straddle snapshot is missing contract rows.")

    provider = str(snapshot.get("provider") or "yfinance").strip().lower() or "yfinance"
    currency = str(snapshot.get("currency") or "").strip().upper() or None
    timestamp = str(snapshot.get("fetchedAt") or to_iso(now_utc())).strip()
    realized_volatility = snapshot.get("realizedVolatility") or {}

    with open_runtime_store() as connection:
        symbol_id = ensure_symbol_row(
            connection,
            normalized_symbol,
            currency=currency,
            provider=provider,
            source_series_type="Price",
            timestamp=timestamp,
        )
        connection.execute(
            """
            DELETE FROM option_monthly_snapshots
            WHERE symbol_id = ?
              AND provider = ?
              AND as_of_date = ?
            """,
            (symbol_id, provider, as_of_date),
        )
        connection.executemany(
            """
            INSERT INTO option_monthly_snapshots (
                symbol_id,
                provider,
                as_of_date,
                fetched_at,
                expiry,
                currency,
                spot_date,
                spot_price,
                minimum_dte,
                max_contracts,
                days_to_expiry,
                strike,
                call_bid,
                call_ask,
                call_last_price,
                call_mid_price,
                call_price_source,
                call_open_interest,
                call_volume,
                call_implied_volatility,
                put_bid,
                put_ask,
                put_last_price,
                put_mid_price,
                put_price_source,
                put_open_interest,
                put_volume,
                put_implied_volatility,
                straddle_mid_price,
                implied_move_price,
                implied_move_percent,
                straddle_implied_volatility,
                chain_implied_volatility,
                implied_volatility_gap,
                historical_volatility_20,
                historical_volatility_60,
                historical_volatility_120,
                iv_hv20_ratio,
                iv_hv60_ratio,
                iv_hv120_ratio,
                iv_hv20_spread,
                iv_hv60_spread,
                iv_hv120_spread,
                combined_open_interest,
                combined_volume,
                pricing_mode,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    symbol_id,
                    provider,
                    as_of_date,
                    timestamp,
                    str(contract.get("expiry") or "").strip(),
                    currency,
                    snapshot.get("spotDate"),
                    snapshot.get("spotPrice"),
                    int(snapshot.get("minimumDte") or 25),
                    int(snapshot.get("maxContracts") or 4),
                    int(contract.get("daysToExpiry") or 0),
                    contract.get("strike"),
                    contract.get("callBid"),
                    contract.get("callAsk"),
                    contract.get("callLastPrice"),
                    contract.get("callMidPrice"),
                    contract.get("callPriceSource"),
                    int(contract.get("callOpenInterest") or 0),
                    int(contract.get("callVolume") or 0),
                    contract.get("callImpliedVolatility"),
                    contract.get("putBid"),
                    contract.get("putAsk"),
                    contract.get("putLastPrice"),
                    contract.get("putMidPrice"),
                    contract.get("putPriceSource"),
                    int(contract.get("putOpenInterest") or 0),
                    int(contract.get("putVolume") or 0),
                    contract.get("putImpliedVolatility"),
                    contract.get("straddleMidPrice"),
                    contract.get("impliedMovePrice"),
                    contract.get("impliedMovePercent"),
                    contract.get("straddleImpliedVolatility"),
                    contract.get("chainImpliedVolatility"),
                    contract.get("impliedVolatilityGap"),
                    contract.get("historicalVolatility20"),
                    contract.get("historicalVolatility60"),
                    contract.get("historicalVolatility120"),
                    contract.get("ivHv20Ratio"),
                    contract.get("ivHv60Ratio"),
                    contract.get("ivHv120Ratio"),
                    contract.get("ivHv20Spread"),
                    contract.get("ivHv60Spread"),
                    contract.get("ivHv120Spread"),
                    int(contract.get("combinedOpenInterest") or 0),
                    int(contract.get("combinedVolume") or 0),
                    str(contract.get("pricingMode") or "unknown"),
                    timestamp,
                )
                for contract in contracts
                if str(contract.get("expiry") or "").strip()
            ],
        )

        metrics = []
        for metric_key, window_days in (("hv20", 20), ("hv60", 60), ("hv120", 120)):
            metric_value = realized_volatility.get(metric_key)
            if metric_value is None:
                continue
            metrics.append(
                {
                    "metricFamily": "realized_volatility",
                    "metricKey": metric_key,
                    "windowDays": window_days,
                    "metricValue": metric_value,
                }
            )
        if metrics:
            connection.executemany(
                """
                INSERT INTO derived_daily_metrics (
                    symbol_id,
                    provider,
                    metric_date,
                    metric_family,
                    metric_key,
                    window_days,
                    metric_value,
                    source,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol_id, provider, metric_date, metric_family, metric_key, window_days)
                DO UPDATE SET
                    metric_value = excluded.metric_value,
                    source = excluded.source,
                    updated_at = excluded.updated_at
                """,
                [
                    (
                        symbol_id,
                        provider,
                        as_of_date,
                        metric["metricFamily"],
                        metric["metricKey"],
                        int(metric["windowDays"] or 0),
                        metric["metricValue"],
                        "monthly_straddle",
                        timestamp,
                    )
                    for metric in metrics
                ],
            )
        connection.commit()

    return load_option_monthly_snapshots(
        normalized_symbol,
        as_of_date=as_of_date,
        provider=provider,
        normalize_symbol=normalize_symbol,
        open_runtime_store=open_runtime_store,
        load_symbol_row=load_symbol_row,
    )


def _tracked_position_from_row(row: sqlite3.Row) -> dict:
    return {
        "positionId": row["position_id"],
        "sourceRunId": row["source_run_id"],
        "symbol": row["symbol"],
        "universeId": row["universe_id"],
        "universeLabel": row["universe_label"],
        "provider": row["provider"],
        "strategy": row["strategy"],
        "signalVersion": row["signal_version"],
        "entryAsOfDate": row["entry_as_of_date"],
        "entryBaseDate": row["entry_base_date"],
        "expiry": row["expiry"],
        "strike": row["strike"],
        "daysToExpiry": row["days_to_expiry"],
        "spotPrice": row["spot_price"],
        "callEntryBid": row["call_entry_bid"],
        "callEntryAsk": row["call_entry_ask"],
        "callEntryMid": row["call_entry_mid"],
        "putEntryBid": row["put_entry_bid"],
        "putEntryAsk": row["put_entry_ask"],
        "putEntryMid": row["put_entry_mid"],
        "entryMarkSource": row["entry_mark_source"],
        "entryExecutableValue": row["entry_executable_value"],
        "entryReferenceMid": row["entry_reference_mid"],
        "candidateBucket": row["candidate_bucket"],
        "pricingBucket": row["pricing_bucket"],
        "directionBucket": row["direction_bucket"],
        "primaryTradeIdea": row["primary_trade_idea"],
        "createdAt": row["created_at"],
        "closedAt": row["closed_at"],
        "closeReason": row["close_reason"],
    }


def load_tracked_option_positions(
    *,
    position_id: int | None = None,
    universe_id: str | None = None,
    strategy: str | None = None,
    signal_version: str | None = None,
    open_only: bool = False,
    limit: int = 500,
    open_runtime_store,
) -> list[dict]:
    normalized_limit = max(1, int(limit or 500))
    with open_runtime_store() as connection:
        clauses = []
        params: list[str | int] = []
        if position_id is not None:
            clauses.append("positions.position_id = ?")
            params.append(int(position_id))
        if universe_id:
            clauses.append("positions.universe_id = ?")
            params.append(str(universe_id).strip())
        if strategy:
            clauses.append("positions.strategy = ?")
            params.append(str(strategy).strip())
        if signal_version:
            clauses.append("positions.signal_version = ?")
            params.append(str(signal_version).strip())
        if open_only:
            clauses.append("positions.closed_at IS NULL")

        where_clause = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = connection.execute(
            f"""
            SELECT
                positions.position_id,
                positions.source_run_id,
                symbols.symbol,
                positions.universe_id,
                positions.universe_label,
                positions.provider,
                positions.strategy,
                positions.signal_version,
                positions.entry_as_of_date,
                positions.entry_base_date,
                positions.expiry,
                positions.strike,
                positions.days_to_expiry,
                positions.spot_price,
                positions.call_entry_bid,
                positions.call_entry_ask,
                positions.call_entry_mid,
                positions.put_entry_bid,
                positions.put_entry_ask,
                positions.put_entry_mid,
                positions.entry_mark_source,
                positions.entry_executable_value,
                positions.entry_reference_mid,
                positions.candidate_bucket,
                positions.pricing_bucket,
                positions.direction_bucket,
                positions.primary_trade_idea,
                positions.created_at,
                positions.closed_at,
                positions.close_reason
            FROM tracked_option_positions AS positions
            INNER JOIN symbols
                ON symbols.symbol_id = positions.symbol_id
            {where_clause}
            ORDER BY positions.entry_as_of_date DESC, positions.position_id DESC
            LIMIT ?
            """,
            tuple([*params, normalized_limit]),
        ).fetchall()

    return [_tracked_position_from_row(row) for row in rows]


def load_tracked_option_marks(
    *,
    position_id: int,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 1000,
    open_runtime_store,
) -> list[dict]:
    normalized_limit = max(1, int(limit or 1000))
    with open_runtime_store() as connection:
        clauses = ["position_id = ?"]
        params: list[str | int] = [int(position_id)]
        if start_date:
            clauses.append("mark_date >= ?")
            params.append(str(start_date))
        if end_date:
            clauses.append("mark_date <= ?")
            params.append(str(end_date))

        rows = connection.execute(
            f"""
            SELECT
                position_id,
                mark_date,
                recorded_at,
                underlying_close,
                underlying_close_date,
                call_bid,
                call_ask,
                call_mid,
                put_bid,
                put_ask,
                put_mid,
                reference_straddle_mid,
                executable_mark_value,
                edge_vs_entry_premium,
                executable_return,
                mark_source,
                mark_status,
                reason
            FROM tracked_option_marks
            WHERE {' AND '.join(clauses)}
            ORDER BY mark_date ASC
            LIMIT ?
            """,
            tuple([*params, normalized_limit]),
        ).fetchall()

    return [
        {
            "positionId": row["position_id"],
            "markDate": row["mark_date"],
            "recordedAt": row["recorded_at"],
            "underlyingClose": row["underlying_close"],
            "underlyingCloseDate": row["underlying_close_date"],
            "callBid": row["call_bid"],
            "callAsk": row["call_ask"],
            "callMid": row["call_mid"],
            "putBid": row["put_bid"],
            "putAsk": row["put_ask"],
            "putMid": row["put_mid"],
            "referenceStraddleMid": row["reference_straddle_mid"],
            "executableMarkValue": row["executable_mark_value"],
            "edgeVsEntryPremium": row["edge_vs_entry_premium"],
            "executableReturn": row["executable_return"],
            "markSource": row["mark_source"],
            "markStatus": row["mark_status"],
            "reason": row["reason"],
        }
        for row in rows
    ]


def upsert_tracked_option_position(
    position: dict,
    *,
    created_at: str | None = None,
    normalize_symbol,
    open_runtime_store,
    ensure_symbol_row,
    clean_text,
    clean_number,
    clean_int,
    to_iso,
    now_utc,
) -> dict:
    timestamp = str(created_at or to_iso(now_utc())).strip()
    normalized_symbol = normalize_symbol(position.get("symbol"))
    if not normalized_symbol:
        raise RuntimeError("Tracked option position requires a symbol.")
    source_run_id = clean_int(position.get("sourceRunId"))
    if source_run_id is None or source_run_id <= 0:
        raise RuntimeError("Tracked option position requires a valid source run id.")

    with open_runtime_store() as connection:
        symbol_id = ensure_symbol_row(
            connection,
            normalized_symbol,
            currency=position.get("currency"),
            provider=position.get("provider"),
            source_series_type="Price",
            timestamp=timestamp,
        )
        connection.execute(
            """
            INSERT INTO tracked_option_positions (
                source_run_id,
                symbol_id,
                universe_id,
                universe_label,
                provider,
                strategy,
                signal_version,
                entry_as_of_date,
                entry_base_date,
                expiry,
                strike,
                days_to_expiry,
                spot_price,
                call_entry_bid,
                call_entry_ask,
                call_entry_mid,
                put_entry_bid,
                put_entry_ask,
                put_entry_mid,
                entry_mark_source,
                entry_executable_value,
                entry_reference_mid,
                candidate_bucket,
                pricing_bucket,
                direction_bucket,
                primary_trade_idea,
                created_at,
                closed_at,
                close_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (
                symbol_id,
                provider,
                entry_as_of_date,
                expiry,
                strike,
                strategy,
                signal_version
            ) DO NOTHING
            """,
            (
                source_run_id,
                symbol_id,
                str(position.get("universeId") or "custom").strip() or "custom",
                str(position.get("universeLabel") or "Custom Universe").strip()
                or "Custom Universe",
                str(position.get("provider") or "yfinance").strip().lower() or "yfinance",
                str(position.get("strategy") or "").strip(),
                str(position.get("signalVersion") or "legacy-v0").strip() or "legacy-v0",
                str(position.get("entryAsOfDate") or "").strip(),
                clean_text(position.get("entryBaseDate")),
                str(position.get("expiry") or "").strip(),
                clean_number(position.get("strike")),
                clean_int(position.get("daysToExpiry")),
                clean_number(position.get("spotPrice")),
                clean_number(position.get("callEntryBid")),
                clean_number(position.get("callEntryAsk")),
                clean_number(position.get("callEntryMid")),
                clean_number(position.get("putEntryBid")),
                clean_number(position.get("putEntryAsk")),
                clean_number(position.get("putEntryMid")),
                str(position.get("entryMarkSource") or "snapshot").strip() or "snapshot",
                clean_number(position.get("entryExecutableValue")),
                clean_number(position.get("entryReferenceMid")),
                clean_text(position.get("candidateBucket")),
                clean_text(position.get("pricingBucket")),
                clean_text(position.get("directionBucket")),
                clean_text(position.get("primaryTradeIdea")),
                timestamp,
                clean_text(position.get("closedAt")),
                clean_text(position.get("closeReason")),
            ),
        )
        connection.commit()

    positions = load_tracked_option_positions(
        universe_id=position.get("universeId"),
        strategy=position.get("strategy"),
        signal_version=position.get("signalVersion"),
        open_only=False,
        limit=1000,
        open_runtime_store=open_runtime_store,
    )
    for entry in positions:
        if (
            entry["symbol"] == normalized_symbol
            and entry["provider"] == str(position.get("provider") or "yfinance").strip().lower()
            and entry["entryAsOfDate"] == str(position.get("entryAsOfDate") or "").strip()
            and entry["expiry"] == str(position.get("expiry") or "").strip()
            and clean_number(entry["strike"]) == clean_number(position.get("strike"))
            and entry["strategy"] == str(position.get("strategy") or "").strip()
            and entry["signalVersion"] == str(position.get("signalVersion") or "legacy-v0").strip()
        ):
            return entry
    raise RuntimeError("Tracked option position could not be loaded after insert.")


def upsert_tracked_option_mark(
    position_id: int,
    mark: dict,
    *,
    recorded_at: str | None = None,
    open_runtime_store,
    clean_text,
    clean_number,
    to_iso,
    now_utc,
) -> dict:
    timestamp = str(recorded_at or to_iso(now_utc())).strip()
    mark_date = str(mark.get("markDate") or "").strip()
    if not mark_date:
        raise RuntimeError("Tracked option mark requires a mark date.")

    with open_runtime_store() as connection:
        connection.execute(
            """
            INSERT INTO tracked_option_marks (
                position_id,
                mark_date,
                recorded_at,
                underlying_close,
                underlying_close_date,
                call_bid,
                call_ask,
                call_mid,
                put_bid,
                put_ask,
                put_mid,
                reference_straddle_mid,
                executable_mark_value,
                edge_vs_entry_premium,
                executable_return,
                mark_source,
                mark_status,
                reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (position_id, mark_date) DO UPDATE SET
                recorded_at = excluded.recorded_at,
                underlying_close = excluded.underlying_close,
                underlying_close_date = excluded.underlying_close_date,
                call_bid = excluded.call_bid,
                call_ask = excluded.call_ask,
                call_mid = excluded.call_mid,
                put_bid = excluded.put_bid,
                put_ask = excluded.put_ask,
                put_mid = excluded.put_mid,
                reference_straddle_mid = excluded.reference_straddle_mid,
                executable_mark_value = excluded.executable_mark_value,
                edge_vs_entry_premium = excluded.edge_vs_entry_premium,
                executable_return = excluded.executable_return,
                mark_source = excluded.mark_source,
                mark_status = excluded.mark_status,
                reason = excluded.reason
            """,
            (
                int(position_id),
                mark_date,
                timestamp,
                clean_number(mark.get("underlyingClose")),
                clean_text(mark.get("underlyingCloseDate")),
                clean_number(mark.get("callBid")),
                clean_number(mark.get("callAsk")),
                clean_number(mark.get("callMid")),
                clean_number(mark.get("putBid")),
                clean_number(mark.get("putAsk")),
                clean_number(mark.get("putMid")),
                clean_number(mark.get("referenceStraddleMid")),
                clean_number(mark.get("executableMarkValue")),
                clean_number(mark.get("edgeVsEntryPremium")),
                clean_number(mark.get("executableReturn")),
                str(mark.get("markSource") or "unknown").strip() or "unknown",
                str(mark.get("markStatus") or "missing").strip() or "missing",
                clean_text(mark.get("reason")),
            ),
        )
        if str(mark.get("markStatus") or "").strip() == "settled":
            connection.execute(
                """
                UPDATE tracked_option_positions
                SET closed_at = COALESCE(closed_at, ?),
                    close_reason = COALESCE(close_reason, ?)
                WHERE position_id = ?
                """,
                (
                    mark_date,
                    clean_text(mark.get("reason")) or "expired",
                    int(position_id),
                ),
            )
        connection.commit()

    marks = load_tracked_option_marks(
        position_id=int(position_id),
        limit=5000,
        open_runtime_store=open_runtime_store,
    )
    for entry in marks:
        if entry["markDate"] == mark_date:
            return entry
    raise RuntimeError("Tracked option mark could not be loaded after upsert.")
