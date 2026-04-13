from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime

try:
    from providers.yfinance_provider import fetch_monthly_straddle_snapshot
except ModuleNotFoundError:
    from scripts.providers.yfinance_provider import fetch_monthly_straddle_snapshot

try:
    from runtime_store import (
        ensure_runtime_store,
        load_option_front_history,
        load_options_screener_rows,
        load_price_rows,
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
        load_price_rows,
        load_recent_options_screener_runs,
        normalize_symbol,
        record_options_screener_run,
        write_option_monthly_snapshot,
    )

from .index_service import get_or_refresh_cached_series


OPTIONS_SCREENER_MAX_SYMBOLS = 25
OPTIONS_SCREENER_FETCH_CONCURRENCY = 3


def clean_history_number(value) -> float | None:
    if value is None:
        return None

    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        return None

    if numeric_value != numeric_value:
        return None

    return numeric_value


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def mean(values: list[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def median(values: list[float]) -> float | None:
    if not values:
        return None
    sorted_values = sorted(values)
    middle = len(sorted_values) // 2
    if len(sorted_values) % 2 == 1:
        return sorted_values[middle]
    return (sorted_values[middle - 1] + sorted_values[middle]) / 2


def score_to_bias_label(score: float | None) -> str:
    if score is None:
        return "No Read"
    if score >= 60:
        return "Long Bias"
    if score <= 40:
        return "Short Bias"
    return "Neutral"


def extract_snapshot_series(raw_snapshot: dict) -> list[tuple[date, float]]:
    rows: list[tuple[date, float]] = []
    for point in raw_snapshot.get("points") or []:
        if not isinstance(point, list) or len(point) < 2:
            continue
        date_value = str(point[0])[:10]
        try:
            point_date = datetime.fromisoformat(date_value).date()
            point_value = float(point[1])
        except (TypeError, ValueError):
            continue
        if not math.isfinite(point_value):
            continue
        rows.append((point_date, point_value))
    rows.sort(key=lambda item: item[0])
    return rows


def latest_sma(values: list[float], window: int) -> float | None:
    if len(values) < window:
        return None
    return sum(values[-window:]) / window


def trailing_return(values: list[float], periods: int) -> float | None:
    if len(values) <= periods:
        return None
    base_value = values[-(periods + 1)]
    if not math.isfinite(base_value) or base_value <= 0:
        return None
    return values[-1] / base_value - 1


def build_trend_context(series_rows: list[tuple[date, float]]) -> dict:
    closes = [value for _date_value, value in series_rows]
    if not closes:
        return {
            "score": None,
            "label": "No Read",
            "spotAboveSma50": None,
            "sma50AboveSma200": None,
            "return63": None,
            "return252": None,
            "sma50": None,
            "sma200": None,
        }

    latest_close = closes[-1]
    sma50 = latest_sma(closes, 50)
    sma200 = latest_sma(closes, 200)
    return63 = trailing_return(closes, 63)
    return252 = trailing_return(closes, 252)
    checks = [
        latest_close > sma50 if sma50 is not None else None,
        sma50 > sma200 if sma50 is not None and sma200 is not None else None,
        return63 > 0 if return63 is not None else None,
        return252 > 0 if return252 is not None else None,
    ]
    available_checks = [flag for flag in checks if flag is not None]
    score = (
        (sum(1 for flag in available_checks if flag) / len(available_checks)) * 100
        if available_checks
        else None
    )
    return {
        "score": score,
        "label": score_to_bias_label(score),
        "spotAboveSma50": checks[0],
        "sma50AboveSma200": checks[1],
        "return63": return63,
        "return252": return252,
        "sma50": sma50,
        "sma200": sma200,
    }


def build_month_end_rows(series_rows: list[tuple[date, float]]) -> list[tuple[int, int, float]]:
    month_values: dict[tuple[int, int], float] = {}
    for point_date, point_value in series_rows:
        month_values[(point_date.year, point_date.month)] = point_value
    return [
        (year, month, month_values[(year, month)])
        for year, month in sorted(month_values.keys())
    ]


def month_distance(left_year: int, left_month: int, right_year: int, right_month: int) -> int:
    return (right_year - left_year) * 12 + (right_month - left_month)


def build_seasonality_context(
    series_rows: list[tuple[date, float]],
    as_of_date: date,
) -> dict:
    month_end_rows = build_month_end_rows(series_rows)
    monthly_returns: list[float] = []

    for index in range(1, len(month_end_rows)):
        previous_year, previous_month, previous_value = month_end_rows[index - 1]
        current_year, current_month, current_value = month_end_rows[index]
        if month_distance(previous_year, previous_month, current_year, current_month) != 1:
            continue
        if current_month != as_of_date.month or previous_value <= 0:
            continue
        monthly_returns.append(current_value / previous_value - 1)

    observations = len(monthly_returns)
    mean_return = mean(monthly_returns)
    median_return = median(monthly_returns)
    win_rate = (
        sum(1 for value in monthly_returns if value > 0) / observations
        if observations
        else None
    )
    average_absolute_return = (
        mean([abs(value) for value in monthly_returns])
        if observations
        else None
    )
    score_components: list[float] = []
    if mean_return is not None:
        score_components.append(50 + clamp(mean_return / 0.12, -1, 1) * 25)
    if win_rate is not None:
        score_components.append(50 + (win_rate - 0.5) * 80)
    score = mean(score_components)
    if observations >= 7:
        sample_quality = "deep"
    elif observations >= 4:
        sample_quality = "fair"
    elif observations > 0:
        sample_quality = "thin"
    else:
        sample_quality = "none"

    return {
        "calendarMonth": as_of_date.month,
        "calendarMonthLabel": as_of_date.strftime("%b"),
        "observations": observations,
        "meanReturn": mean_return,
        "medianReturn": median_return,
        "winRate": win_rate,
        "averageAbsoluteReturn": average_absolute_return,
        "score": score,
        "label": score_to_bias_label(score),
        "sampleQuality": sample_quality,
    }


def build_direction_context(
    symbol: str,
    *,
    as_of_date: str | None = None,
    preferred_provider: str | None = None,
) -> dict:
    raw_snapshot, _cache_status = get_or_refresh_cached_series(
        symbol,
        preferred_provider=preferred_provider,
    )
    series_rows = extract_snapshot_series(raw_snapshot)
    if len(series_rows) < 24:
        raise RuntimeError("Not enough cached daily history is available for direction context.")

    latest_date = series_rows[-1][0]
    effective_as_of = (
        datetime.fromisoformat(as_of_date).date()
        if as_of_date
        else latest_date
    )
    trend_context = build_trend_context(series_rows)
    seasonality_context = build_seasonality_context(series_rows, effective_as_of)
    direction_score = mean(
        [
            value
            for value in [
                trend_context.get("score"),
                seasonality_context.get("score"),
            ]
            if value is not None
        ]
    )
    return {
        "asOfDate": effective_as_of.isoformat(),
        "historyStartDate": series_rows[0][0].isoformat(),
        "historyEndDate": latest_date.isoformat(),
        "observations": len(series_rows),
        "trend": trend_context,
        "seasonality": seasonality_context,
        "directionScore": direction_score,
        "directionLabel": score_to_bias_label(direction_score),
    }


def percentile_rank(series: list[float | None], current_value: float | None) -> float | None:
    if current_value is None or not math.isfinite(current_value):
        return None

    valid_values = [
        value
        for value in series
        if value is not None and math.isfinite(value)
    ]
    if not valid_values:
        return None

    less_than_count = sum(1 for value in valid_values if value < current_value)
    equal_count = sum(1 for value in valid_values if value == current_value)
    return (less_than_count + equal_count) / len(valid_values)


def options_pricing_label(snapshot_contract: dict) -> str:
    windows = [
        (
            clean_history_number(snapshot_contract.get("historicalVolatility20")),
            clean_history_number(snapshot_contract.get("ivHv20Ratio")),
            clean_history_number(snapshot_contract.get("ivHv20Spread")),
        ),
        (
            clean_history_number(snapshot_contract.get("historicalVolatility60")),
            clean_history_number(snapshot_contract.get("ivHv60Ratio")),
            clean_history_number(snapshot_contract.get("ivHv60Spread")),
        ),
        (
            clean_history_number(snapshot_contract.get("historicalVolatility120")),
            clean_history_number(snapshot_contract.get("ivHv120Ratio")),
            clean_history_number(snapshot_contract.get("ivHv120Spread")),
        ),
    ]
    primary_ratio = next(
        (
            ratio
            for historical_volatility, ratio, spread in windows
            if historical_volatility is not None
            and ratio is not None
            and spread is not None
        ),
        None,
    )
    if primary_ratio is None:
        return "No Read"
    if primary_ratio < 0.9:
        return "Cheap"
    if primary_ratio <= 1.1:
        return "Fair"
    if primary_ratio <= 1.3:
        return "Mildly Rich"
    return "Rich"


def options_pricing_bucket(pricing_label: str) -> str:
    if pricing_label == "Cheap":
        return "cheap"
    if pricing_label in {"Rich", "Mildly Rich"}:
        return "rich"
    if pricing_label == "Fair":
        return "fair"
    return "none"


def compute_vol_pricing_score(
    *,
    iv_hv20_ratio: float | None,
    iv_hv60_ratio: float | None,
    iv_percentile: float | None,
    iv_hv20_percentile: float | None,
) -> float | None:
    ratio_value = iv_hv20_ratio if iv_hv20_ratio is not None else iv_hv60_ratio
    ratio_score = (
        clamp(((ratio_value - 0.8) / 0.7) * 100, 0, 100)
        if ratio_value is not None and math.isfinite(ratio_value)
        else None
    )
    percentile_score = (
        clamp(iv_percentile * 100, 0, 100)
        if iv_percentile is not None and math.isfinite(iv_percentile)
        else None
    )
    ratio_percentile_score = (
        clamp(iv_hv20_percentile * 100, 0, 100)
        if iv_hv20_percentile is not None and math.isfinite(iv_hv20_percentile)
        else None
    )
    return mean(
        [
            value
            for value in [ratio_score, percentile_score, ratio_percentile_score]
            if value is not None
        ]
    )


def compute_execution_score(
    *,
    combined_open_interest: int | None,
    combined_volume: int | None,
    spread_share: float | None,
) -> float | None:
    open_interest_score = (
        clamp((combined_open_interest / 20000) * 100, 0, 100)
        if combined_open_interest is not None
        else None
    )
    volume_score = (
        clamp((combined_volume / 3000) * 100, 0, 100)
        if combined_volume is not None
        else None
    )
    spread_score = (
        clamp((1 - spread_share / 0.12) * 100, 0, 100)
        if spread_share is not None and math.isfinite(spread_share)
        else None
    )
    return mean(
        [
            value
            for value in [open_interest_score, volume_score, spread_score]
            if value is not None
        ]
    )


def compute_confidence_score(
    *,
    history_observations: int | None,
    seasonality_observations: int | None,
    execution_score: float | None,
) -> float | None:
    history_score = (
        clamp((history_observations / 20) * 100, 0, 100)
        if history_observations is not None
        else None
    )
    seasonality_score = (
        clamp((seasonality_observations / 10) * 100, 0, 100)
        if seasonality_observations is not None
        else None
    )
    return mean(
        [
            value
            for value in [history_score, seasonality_score, execution_score]
            if value is not None
        ]
    )


def build_candidate_advisory(
    *,
    pricing_bucket: str,
    execution_score: float | None,
    confidence_score: float | None,
) -> dict:
    if (
        (execution_score is not None and execution_score < 45)
        or (confidence_score is not None and confidence_score < 40)
    ):
        return {
            "label": "Low Confidence",
            "bucket": "low-confidence",
        }

    if pricing_bucket == "cheap":
        return {
            "label": "Long Premium Candidate",
            "bucket": "long-premium",
        }

    if pricing_bucket == "rich":
        return {
            "label": "Short Premium Candidate",
            "bucket": "short-premium",
        }

    return {
        "label": "No Vol Edge",
        "bucket": "watch",
    }


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
    direction_context = snapshot.get("directionContext") or {}
    trend_context = direction_context.get("trend") or {}
    seasonality_context = direction_context.get("seasonality") or {}

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
        "historicalVolatility20": clean_history_number(
            focus_contract.get("historicalVolatility20"),
        ),
        "historicalVolatility60": clean_history_number(
            focus_contract.get("historicalVolatility60"),
        ),
        "ivHv20Ratio": clean_history_number(focus_contract.get("ivHv20Ratio")),
        "ivHv60Ratio": clean_history_number(focus_contract.get("ivHv60Ratio")),
        "ivPercentile": history_summary["ivPercentile"],
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
        "warnings": warnings,
    }


def summarize_options_screener_run(run: dict, rows: list[dict]) -> dict:
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
        "rows": rows,
    }


def direction_bucket(direction_label: str | None) -> str:
    text = str(direction_label or "").strip().lower()
    if text == "long bias":
        return "long"
    if text == "short bias":
        return "short"
    if text == "neutral":
        return "neutral"
    return "none"


def build_forward_validation_observation(
    row: dict,
    *,
    horizon_days: int,
    price_rows: list[dict],
) -> dict:
    as_of_date = str(row.get("asOfDate") or row.get("runAsOfDate") or "").strip()
    symbol = normalize_symbol(row.get("symbol"))
    base_price = clean_history_number(row.get("spotPrice"))

    if not symbol or not as_of_date:
        return {
            "symbol": symbol,
            "asOfDate": as_of_date or None,
            "matured": False,
            "baseDate": None,
            "basePrice": base_price,
            "forwardDate": None,
            "forwardPrice": None,
            "forwardReturn": None,
            "absoluteMove": None,
            "availableTradingDays": 0,
            "reason": "Missing symbol or as-of date.",
        }

    eligible_indexes = [
        index
        for index, price_row in enumerate(price_rows)
        if str(price_row.get("date") or "") <= as_of_date
    ]
    if not eligible_indexes:
        return {
            "symbol": symbol,
            "asOfDate": as_of_date,
            "matured": False,
            "baseDate": None,
            "basePrice": base_price,
            "forwardDate": None,
            "forwardPrice": None,
            "forwardReturn": None,
            "absoluteMove": None,
            "availableTradingDays": 0,
            "reason": "No cached price history exists on or before the screener date.",
        }

    base_index = eligible_indexes[-1]
    base_row = price_rows[base_index]
    base_close = clean_history_number(base_row.get("close"))
    effective_base_price = base_price if base_price is not None else base_close
    if effective_base_price is None or effective_base_price <= 0:
        return {
            "symbol": symbol,
            "asOfDate": as_of_date,
            "matured": False,
            "baseDate": base_row.get("date"),
            "basePrice": effective_base_price,
            "forwardDate": None,
            "forwardPrice": None,
            "forwardReturn": None,
            "absoluteMove": None,
            "availableTradingDays": max(len(price_rows) - base_index - 1, 0),
            "reason": "No usable base close was available for validation.",
        }

    target_index = base_index + horizon_days
    available_trading_days = max(len(price_rows) - base_index - 1, 0)
    if target_index >= len(price_rows):
        return {
            "symbol": symbol,
            "asOfDate": as_of_date,
            "matured": False,
            "baseDate": base_row.get("date"),
            "basePrice": effective_base_price,
            "forwardDate": None,
            "forwardPrice": None,
            "forwardReturn": None,
            "absoluteMove": None,
            "availableTradingDays": available_trading_days,
            "reason": f"Only {available_trading_days} trading days have elapsed since the archived row.",
        }

    target_row = price_rows[target_index]
    forward_price = clean_history_number(target_row.get("close"))
    if forward_price is None:
        return {
            "symbol": symbol,
            "asOfDate": as_of_date,
            "matured": False,
            "baseDate": base_row.get("date"),
            "basePrice": effective_base_price,
            "forwardDate": target_row.get("date"),
            "forwardPrice": None,
            "forwardReturn": None,
            "absoluteMove": None,
            "availableTradingDays": available_trading_days,
            "reason": "Target close is missing from the cached history.",
        }

    forward_return = (forward_price / effective_base_price) - 1
    implied_move_percent = clean_history_number(row.get("impliedMovePercent"))
    realized_beat_implied = (
        abs(forward_return) > implied_move_percent
        if implied_move_percent is not None and implied_move_percent >= 0
        else None
    )
    return {
        "symbol": symbol,
        "asOfDate": as_of_date,
        "matured": True,
        "baseDate": base_row.get("date"),
        "basePrice": effective_base_price,
        "forwardDate": target_row.get("date"),
        "forwardPrice": forward_price,
        "forwardReturn": forward_return,
        "absoluteMove": abs(forward_return),
        "impliedMovePercent": implied_move_percent,
        "moveEdge": (
            abs(forward_return) - implied_move_percent
            if implied_move_percent is not None
            else None
        ),
        "realizedBeatImplied": realized_beat_implied,
        "availableTradingDays": available_trading_days,
        "reason": None,
    }


def build_options_screener_validation_payload(
    *,
    universe_id: str | None = None,
    horizon_days: int,
    limit_runs: int = 60,
    row_limit: int = 25,
) -> dict:
    runs = load_recent_options_screener_runs(limit=max(1, limit_runs))
    if universe_id:
        runs = [
            run
            for run in runs
            if str(run.get("universeId") or "").strip() == str(universe_id).strip()
        ]

    price_cache: dict[str, list[dict]] = {}
    observations: list[dict] = []

    for run in runs:
        rows = load_options_screener_rows(
            run_id=run["runId"],
            limit=max(1, row_limit),
        )
        for row in rows:
            symbol = normalize_symbol(row.get("symbol"))
            if symbol not in price_cache:
                price_cache[symbol] = load_price_rows(symbol)
            forward = build_forward_validation_observation(
                row,
                horizon_days=horizon_days,
                price_rows=price_cache[symbol],
            )
            observations.append(
                {
                    "runId": run["runId"],
                    "universeId": run.get("universeId"),
                    "universeLabel": run.get("universeLabel"),
                    "createdAt": run.get("createdAt"),
                    "symbol": symbol,
                    "provider": row.get("provider"),
                    "asOfDate": row.get("asOfDate"),
                    "expiry": row.get("expiry"),
                    "daysToExpiry": row.get("daysToExpiry"),
                    "spotPrice": row.get("spotPrice"),
                    "impliedMovePercent": row.get("impliedMovePercent"),
                    "pricingLabel": row.get("pricingLabel"),
                    "pricingBucket": row.get("pricingBucket"),
                    "candidateAdvisory": row.get("candidateAdvisory"),
                    "candidateBucket": row.get("candidateBucket"),
                    "directionLabel": row.get("directionLabel"),
                    "directionBucket": direction_bucket(row.get("directionLabel")),
                    "directionScore": row.get("directionScore"),
                    "executionScore": row.get("executionScore"),
                    "confidenceScore": row.get("confidenceScore"),
                    "ivHv20Ratio": row.get("ivHv20Ratio"),
                    "ivHv60Ratio": row.get("ivHv60Ratio"),
                    "ivPercentile": row.get("ivPercentile"),
                    "seasonalityMonthLabel": row.get("seasonalityMonthLabel"),
                    "warnings": row.get("warnings") or [],
                    **forward,
                }
            )

    observations.sort(
        key=lambda entry: (
            str(entry.get("asOfDate") or ""),
            str(entry.get("symbol") or ""),
            int(entry.get("runId") or 0),
        ),
        reverse=True,
    )

    matured_count = sum(1 for entry in observations if entry.get("matured"))
    return {
        "universeId": universe_id,
        "horizonDays": int(horizon_days),
        "runCount": len(runs),
        "observationCount": len(observations),
        "maturedCount": matured_count,
        "pendingCount": len(observations) - matured_count,
        "observations": observations,
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
        storage_rows = [
            build_options_screener_storage_row(snapshot)
            for snapshot in snapshots
        ]
        storage = record_options_screener_run(
            universe_id=universe_id,
            universe_label=universe_label,
            minimum_dte=minimum_dte,
            max_contracts=max_contracts,
            requested_symbols=normalized_symbols,
            failures=failures,
            rows=storage_rows,
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

    summaries = [
        summarize_options_screener_run(
            run,
            load_options_screener_rows(
                run_id=run["runId"],
                limit=row_limit,
            ),
        )
        for run in runs
    ]

    return {
        "universeId": universe_id,
        "runs": summaries,
    }


def build_options_screener_validation_response(request: dict) -> dict:
    ensure_runtime_store()
    universe_id = str(request.get("universeId") or "").strip() or None
    horizon_days = max(1, min(int(request.get("horizonDays") or 5), 252))
    limit_runs = max(1, min(int(request.get("limitRuns") or 60), 240))
    row_limit = max(1, min(int(request.get("rowLimit") or 25), 100))

    return build_options_screener_validation_payload(
        universe_id=universe_id,
        horizon_days=horizon_days,
        limit_runs=limit_runs,
        row_limit=row_limit,
    )
