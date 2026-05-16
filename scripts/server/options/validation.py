from __future__ import annotations

try:
    from runtime_store import (
        ensure_runtime_store,
        load_options_screener_rows,
        load_price_rows,
        load_recent_options_screener_runs,
        load_tracked_option_marks,
        load_tracked_option_positions,
        normalize_symbol,
    )
except ModuleNotFoundError:
    from scripts.runtime_store import (
        ensure_runtime_store,
        load_options_screener_rows,
        load_price_rows,
        load_recent_options_screener_runs,
        load_tracked_option_marks,
        load_tracked_option_positions,
        normalize_symbol,
    )

from .constants import TRADE_VALIDATION_GROUP_DEFINITIONS, TRADE_VALIDATION_HORIZONS
from .metrics import clean_history_number, mean, median

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

def build_underlying_validation_dedup_key(observation: dict) -> tuple:
    implied_move = clean_history_number(observation.get("impliedMovePercent"))
    return (
        str(observation.get("universeId") or ""),
        str(observation.get("symbol") or ""),
        str(observation.get("asOfDate") or ""),
        str(observation.get("expiry") or ""),
        str(observation.get("daysToExpiry") or ""),
        str(observation.get("pricingBucket") or ""),
        str(observation.get("candidateBucket") or ""),
        str(observation.get("directionBucket") or ""),
        str(observation.get("primaryTradeIdea") or ""),
        f"{implied_move:.6f}" if implied_move is not None else "",
    )

def dedupe_underlying_validation_observations(observations: list[dict]) -> list[dict]:
    deduped: dict[tuple, dict] = {}
    for observation in observations:
        key = build_underlying_validation_dedup_key(observation)
        current = deduped.get(key)
        if current is None:
            deduped[key] = {
                **observation,
                "duplicateCount": 1,
            }
            continue

        current_run_id = int(current.get("runId") or -1)
        next_run_id = int(observation.get("runId") or -1)
        should_replace = next_run_id > current_run_id or (
            next_run_id == current_run_id
            and str(observation.get("createdAt") or "") > str(current.get("createdAt") or "")
        )
        duplicate_count = int(current.get("duplicateCount") or 1) + 1
        deduped[key] = {
            **(observation if should_replace else current),
            "duplicateCount": duplicate_count,
        }

    return list(deduped.values())

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
                    "signalVersion": row.get("signalVersion") or run.get("signalVersion"),
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
                    "rvPercentile": row.get("rvPercentile"),
                    "vrp": row.get("vrp"),
                    "termStructureSteepness": row.get("termStructureSteepness"),
                    "termStructureBucket": row.get("termStructureBucket"),
                    "termStructureLabel": row.get("termStructureLabel"),
                    "normalizedSkew": row.get("normalizedSkew"),
                    "primaryTradeIdea": row.get("primaryTradeIdea"),
                    "seasonalityMonthLabel": row.get("seasonalityMonthLabel"),
                    "warnings": row.get("warnings") or [],
                    **forward,
                }
            )

    raw_observation_count = len(observations)
    observations = dedupe_underlying_validation_observations(observations)
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
        "validationType": "underlying",
        "universeId": universe_id,
        "horizonDays": int(horizon_days),
        "runCount": len(runs),
        "rawObservationCount": raw_observation_count,
        "observationCount": len(observations),
        "maturedCount": matured_count,
        "pendingCount": len(observations) - matured_count,
        "rerunCountCollapsed": max(raw_observation_count - len(observations), 0),
        "observations": observations,
    }

def normalize_trade_validation_group_key(value: str | None) -> str:
    normalized_value = str(value or "").strip()
    if normalized_value in TRADE_VALIDATION_GROUP_DEFINITIONS:
        return normalized_value
    return "candidateBucket"

def normalize_trade_validation_horizon(value) -> str:
    normalized_text = str(value or "").strip().upper()
    if normalized_text in TRADE_VALIDATION_HORIZONS:
        return normalized_text

    numeric_value = clean_history_number(value)
    if numeric_value is not None:
        candidate_key = f"{int(numeric_value)}D"
        if candidate_key in TRADE_VALIDATION_HORIZONS:
            return candidate_key

    return "5D"

def normalize_trade_validation_bucket_label(group_key: str, bucket_value) -> str:
    text = str(bucket_value or "").strip()
    normalized_text = text.lower()
    if group_key == "candidateBucket":
        if normalized_text == "long-premium":
            return "Long Premium"
        if normalized_text == "short-premium":
            return "Short Premium"
        if normalized_text == "low-confidence":
            return "Low Confidence"
        if normalized_text == "watch":
            return "No Vol Edge"
        return text or "Unknown"
    if group_key == "pricingBucket":
        if normalized_text == "cheap":
            return "Cheap"
        if normalized_text == "rich":
            return "Rich"
        if normalized_text == "fair":
            return "Fair"
        if normalized_text == "none":
            return "No Read"
        return text or "Unknown"
    if group_key == "directionBucket":
        if normalized_text == "long":
            return "Long Bias"
        if normalized_text == "short":
            return "Short Bias"
        if normalized_text == "neutral":
            return "Neutral"
        if normalized_text == "none":
            return "No Read"
        return text or "Unknown"
    if group_key == "primaryTradeIdea":
        return text or "No Preset Match"
    if group_key == "signalVersion":
        return text or "Unknown"
    return text or "Unknown"

def group_trade_validation_observations(
    observations: list[dict],
    *,
    group_key: str,
) -> list[dict]:
    groups: dict[str, list[dict]] = {}
    for observation in observations:
        key = str(observation.get(group_key) or "unknown")
        groups.setdefault(key, []).append(observation)

    grouped_results = []
    for key, rows in groups.items():
        executable_returns = [
            clean_history_number(row.get("executableReturn"))
            for row in rows
            if clean_history_number(row.get("executableReturn")) is not None
        ]
        edge_amounts = [
            clean_history_number(row.get("edgeVsEntryPremium"))
            for row in rows
            if clean_history_number(row.get("edgeVsEntryPremium")) is not None
        ]
        adverse_returns = [
            clean_history_number(row.get("maxAdverseReturn"))
            for row in rows
            if clean_history_number(row.get("maxAdverseReturn")) is not None
        ]
        clipped_count = sum(1 for row in rows if row.get("clippedToExpiry"))
        win_count = sum(
            1
            for row in rows
            if clean_history_number(row.get("executableReturn")) is not None
            and clean_history_number(row.get("executableReturn")) > 0
        )
        grouped_results.append(
            {
                "key": key,
                "label": normalize_trade_validation_bucket_label(group_key, key),
                "count": len(rows),
                "averageExecutableReturn": mean(executable_returns),
                "medianExecutableReturn": median(executable_returns),
                "winRate": (win_count / len(rows)) if rows else None,
                "averageEdgeVsEntryPremium": mean(edge_amounts),
                "averageMaxAdverseReturn": mean(adverse_returns),
                "clippedToExpiryRate": (clipped_count / len(rows)) if rows else None,
                "rows": rows,
            },
        )

    grouped_results.sort(
        key=lambda group: (
            clean_history_number(group.get("averageExecutableReturn"))
            if clean_history_number(group.get("averageExecutableReturn")) is not None
            else -float("inf")
        ),
        reverse=True,
    )
    return grouped_results

def build_trade_validation_observation(
    position: dict,
    *,
    horizon_key: str,
    price_rows: list[dict],
    marks: list[dict],
) -> dict:
    entry_base_date = str(position.get("entryBaseDate") or position.get("entryAsOfDate") or "").strip()
    expiry = str(position.get("expiry") or "").strip()
    entry_executable_value = clean_history_number(position.get("entryExecutableValue"))
    available_trading_days = 0
    observation = {
        "positionId": position.get("positionId"),
        "sourceRunId": position.get("sourceRunId"),
        "universeId": position.get("universeId"),
        "universeLabel": position.get("universeLabel"),
        "symbol": position.get("symbol"),
        "provider": position.get("provider"),
        "strategy": position.get("strategy"),
        "signalVersion": position.get("signalVersion"),
        "entryAsOfDate": position.get("entryAsOfDate"),
        "entryBaseDate": entry_base_date or None,
        "expiry": position.get("expiry"),
        "strike": position.get("strike"),
        "entryExecutableValue": entry_executable_value,
        "candidateBucket": position.get("candidateBucket"),
        "pricingBucket": position.get("pricingBucket"),
        "directionBucket": position.get("directionBucket"),
        "primaryTradeIdea": position.get("primaryTradeIdea") or "No Preset Match",
        "matured": False,
        "clippedToExpiry": False,
        "availableTradingDays": available_trading_days,
        "exitMarkDate": None,
        "exitMarkSource": None,
        "exitMarkStatus": None,
        "underlyingClose": None,
        "underlyingCloseDate": None,
        "executableMarkValue": None,
        "edgeVsEntryPremium": None,
        "executableReturn": None,
        "maxAdverseReturn": None,
        "reason": None,
    }
    if not entry_base_date or not expiry or entry_executable_value is None or entry_executable_value <= 0:
        observation["reason"] = "Tracked position is missing entry metadata."
        return observation

    eligible_indices = [
        index
        for index, price_row in enumerate(price_rows)
        if str(price_row.get("date") or "") <= entry_base_date
    ]
    if not eligible_indices:
        observation["reason"] = "No cached underlying history exists on or before the entry date."
        return observation

    base_index = eligible_indices[-1]
    available_trading_days = max(len(price_rows) - base_index - 1, 0)
    observation["availableTradingDays"] = available_trading_days

    expiry_indices = [
        index
        for index, price_row in enumerate(price_rows)
        if str(price_row.get("date") or "") <= expiry
    ]
    if not expiry_indices:
        observation["reason"] = "No cached underlying close exists on or before expiry."
        return observation

    expiry_index = expiry_indices[-1]
    if horizon_key == "EXPIRY":
        target_index = expiry_index
    else:
        horizon_days = int(TRADE_VALIDATION_HORIZONS[horizon_key])
        candidate_index = base_index + horizon_days
        if candidate_index > expiry_index:
            target_index = expiry_index
            observation["clippedToExpiry"] = True
        elif candidate_index >= len(price_rows):
            observation["reason"] = (
                f"Only {available_trading_days} trading days have elapsed since entry."
            )
            return observation
        else:
            target_index = candidate_index

    target_row = price_rows[target_index]
    target_mark_date = str(target_row.get("date") or "")
    mark_by_date = {
        str(mark.get("markDate") or ""): mark
        for mark in marks
    }
    exit_mark = mark_by_date.get(target_mark_date)
    if exit_mark is None:
        observation["reason"] = "No exact-contract mark is stored for the target trade date."
        return observation

    executable_return = clean_history_number(exit_mark.get("executableReturn"))
    if executable_return is None:
        observation["reason"] = str(exit_mark.get("reason") or "Target trade mark is not executable.")
        observation["exitMarkDate"] = target_mark_date
        observation["exitMarkSource"] = exit_mark.get("markSource")
        observation["exitMarkStatus"] = exit_mark.get("markStatus")
        return observation

    adverse_returns = [
        clean_history_number(mark.get("executableReturn"))
        for mark in marks
        if entry_base_date <= str(mark.get("markDate") or "") <= target_mark_date
        and clean_history_number(mark.get("executableReturn")) is not None
    ]
    observation.update(
        {
            "matured": True,
            "exitMarkDate": target_mark_date,
            "exitMarkSource": exit_mark.get("markSource"),
            "exitMarkStatus": exit_mark.get("markStatus"),
            "underlyingClose": clean_history_number(exit_mark.get("underlyingClose")),
            "underlyingCloseDate": exit_mark.get("underlyingCloseDate"),
            "executableMarkValue": clean_history_number(exit_mark.get("executableMarkValue")),
            "edgeVsEntryPremium": clean_history_number(exit_mark.get("edgeVsEntryPremium")),
            "executableReturn": executable_return,
            "maxAdverseReturn": min(adverse_returns) if adverse_returns else None,
            "reason": None,
        },
    )
    return observation

def build_trade_validation_payload(
    *,
    universe_id: str | None = None,
    horizon_key: str = "5D",
    group_key: str = "candidateBucket",
    limit_positions: int = 500,
) -> dict:
    positions = load_tracked_option_positions(
        universe_id=universe_id,
        open_only=False,
        limit=max(1, limit_positions),
    )
    price_cache: dict[str, list[dict]] = {}
    observations: list[dict] = []

    for position in positions:
        symbol = normalize_symbol(position.get("symbol"))
        if symbol not in price_cache:
            price_cache[symbol] = load_price_rows(symbol)
        marks = load_tracked_option_marks(
            position_id=int(position["positionId"]),
            limit=5000,
        )
        observations.append(
            build_trade_validation_observation(
                position,
                horizon_key=horizon_key,
                price_rows=price_cache[symbol],
                marks=marks,
            ),
        )

    observations.sort(
        key=lambda observation: (
            str(observation.get("entryAsOfDate") or ""),
            str(observation.get("symbol") or ""),
            int(observation.get("positionId") or 0),
        ),
        reverse=True,
    )
    matured_observations = [
        observation for observation in observations if observation.get("matured")
    ]
    grouped_results = group_trade_validation_observations(
        matured_observations,
        group_key=group_key,
    )
    clipped_count = sum(
        1 for observation in matured_observations if observation.get("clippedToExpiry")
    )
    return {
        "validationType": "trade",
        "universeId": universe_id,
        "horizonKey": horizon_key,
        "horizonDays": TRADE_VALIDATION_HORIZONS[horizon_key]
        if horizon_key != "EXPIRY"
        else None,
        "groupKey": group_key,
        "groupLabel": TRADE_VALIDATION_GROUP_DEFINITIONS[group_key],
        "positionCount": len(positions),
        "observationCount": len(observations),
        "maturedCount": len(matured_observations),
        "pendingCount": len(observations) - len(matured_observations),
        "clippedCount": clipped_count,
        "observations": observations,
        "groupedResults": grouped_results,
    }

def build_trade_validation_response(request: dict) -> dict:
    ensure_runtime_store()
    universe_id = str(request.get("universeId") or "").strip() or None
    group_key = normalize_trade_validation_group_key(request.get("groupKey"))
    horizon_key = normalize_trade_validation_horizon(
        request.get("horizon") or request.get("horizonDays"),
    )
    limit_positions = max(1, min(int(request.get("limitPositions") or 500), 5000))
    return build_trade_validation_payload(
        universe_id=universe_id,
        horizon_key=horizon_key,
        group_key=group_key,
        limit_positions=limit_positions,
    )

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
