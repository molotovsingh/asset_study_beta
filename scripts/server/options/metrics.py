from __future__ import annotations

import math
from datetime import date, datetime

from .constants import TRADE_IDEA_DEFINITIONS
from ..index_service import get_or_refresh_cached_series

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
    series_loader=None,
) -> dict:
    load_series = series_loader or get_or_refresh_cached_series
    raw_snapshot, _cache_status = load_series(
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

def get_trade_idea_definition(trade_idea_id: str | None) -> dict | None:
    normalized_id = str(trade_idea_id or "").strip().lower()
    return next(
        (
            definition
            for definition in TRADE_IDEA_DEFINITIONS
            if definition["id"] == normalized_id
        ),
        None,
    )

def compute_cross_sectional_rank(
    series: list[float | None],
    current_value: float | None,
) -> float | None:
    if current_value is None or not math.isfinite(current_value):
        return None

    valid_values = sorted(
        value
        for value in series
        if value is not None and math.isfinite(value)
    )
    if not valid_values:
        return None
    if len(valid_values) == 1:
        return 100.0

    less_than_count = sum(1 for value in valid_values if value < current_value)
    equal_count = sum(1 for value in valid_values if value == current_value)
    average_position = less_than_count + max(equal_count - 1, 0) / 2
    return 1 + (average_position / (len(valid_values) - 1)) * 99

def build_term_structure_context(contracts: list[dict] | None) -> dict:
    valid_contracts = sorted(
        [
            contract
            for contract in (contracts or [])
            if clean_history_number(contract.get("daysToExpiry")) is not None
            and clean_history_number(contract.get("straddleImpliedVolatility")) is not None
        ],
        key=lambda contract: clean_history_number(contract.get("daysToExpiry")) or 0,
    )
    if len(valid_contracts) < 2:
        return {
            "frontImpliedVolatility": None,
            "backImpliedVolatility": None,
            "termStructureSteepness": None,
            "termStructureBucket": "none",
            "termStructureLabel": "No Read",
        }

    front_contract = valid_contracts[0]
    back_contract = valid_contracts[-1]
    front_iv = clean_history_number(front_contract.get("straddleImpliedVolatility"))
    back_iv = clean_history_number(back_contract.get("straddleImpliedVolatility"))
    day_span = (
        clean_history_number(back_contract.get("daysToExpiry"))
        - clean_history_number(front_contract.get("daysToExpiry"))
    )
    if front_iv is None or back_iv is None or day_span is None or day_span <= 0:
        return {
            "frontImpliedVolatility": front_iv,
            "backImpliedVolatility": back_iv,
            "termStructureSteepness": None,
            "termStructureBucket": "none",
            "termStructureLabel": "No Read",
        }

    steepness = ((back_iv - front_iv) / day_span) * 30
    if not math.isfinite(steepness):
        return {
            "frontImpliedVolatility": front_iv,
            "backImpliedVolatility": back_iv,
            "termStructureSteepness": None,
            "termStructureBucket": "none",
            "termStructureLabel": "No Read",
        }

    term_structure_bucket = "normal"
    term_structure_label = "Normal"
    if abs(steepness) <= 0.015:
        term_structure_bucket = "flat"
        term_structure_label = "Flat"
    elif steepness >= 0.04:
        term_structure_bucket = "steep"
        term_structure_label = "Steep"
    elif steepness <= -0.04:
        term_structure_bucket = "inverted"
        term_structure_label = "Inverted"

    return {
        "frontImpliedVolatility": front_iv,
        "backImpliedVolatility": back_iv,
        "termStructureSteepness": steepness,
        "termStructureBucket": term_structure_bucket,
        "termStructureLabel": term_structure_label,
    }

def build_trade_idea_matches(row: dict) -> list[dict]:
    matches: list[dict] = []
    iv_percentile = clean_history_number(row.get("ivPercentile"))
    rv_percentile = clean_history_number(row.get("rvPercentile"))
    vrp_rank = clean_history_number(row.get("vrpRank"))
    term_structure_bucket = str(row.get("termStructureBucket") or "").strip().lower()

    is_low_iv = iv_percentile is not None and iv_percentile <= 0.35
    is_high_iv = iv_percentile is not None and iv_percentile >= 0.65
    is_low_rv = rv_percentile is not None and rv_percentile <= 0.35
    is_high_rv = rv_percentile is not None and rv_percentile >= 0.65
    is_low_vrp = vrp_rank is not None and vrp_rank <= 35
    is_high_vrp = vrp_rank is not None and vrp_rank >= 65

    if is_low_iv and is_high_vrp and term_structure_bucket == "flat":
        definition = get_trade_idea_definition("long-calendar")
        if definition:
            matches.append(definition)
    if is_high_iv and is_high_vrp and is_high_rv:
        definition = get_trade_idea_definition("sell-vega")
        if definition:
            matches.append(definition)
    if is_low_iv and is_low_vrp and is_low_rv:
        definition = get_trade_idea_definition("buy-gamma-vega")
        if definition:
            matches.append(definition)
    if is_high_iv and is_low_vrp and term_structure_bucket == "steep":
        definition = get_trade_idea_definition("short-calendar")
        if definition:
            matches.append(definition)

    return matches

