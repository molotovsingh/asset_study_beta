from __future__ import annotations

from datetime import datetime

try:
    from providers.yfinance_provider import (
        OptionContractNotMarkableError,
        fetch_exact_contract_quote,
    )
except ModuleNotFoundError:
    from scripts.providers.yfinance_provider import (
        OptionContractNotMarkableError,
        fetch_exact_contract_quote,
    )

try:
    from runtime_store import (
        load_option_monthly_snapshots,
        load_options_screener_rows,
        load_price_rows,
        load_tracked_option_marks,
        load_tracked_option_positions,
        upsert_tracked_option_mark,
        upsert_tracked_option_position,
    )
except ModuleNotFoundError:
    from scripts.runtime_store import (
        load_option_monthly_snapshots,
        load_options_screener_rows,
        load_price_rows,
        load_tracked_option_marks,
        load_tracked_option_positions,
        upsert_tracked_option_mark,
        upsert_tracked_option_position,
    )

from ..index_service import get_or_refresh_cached_series
from .constants import COLLECTOR_UNIVERSES, OPTIONS_SCREENER_MAX_SYMBOLS, OPTIONS_SIGNAL_VERSION, TRACKED_STRATEGY_BY_CANDIDATE_BUCKET
from .metrics import clean_history_number
from .validation import direction_bucket

def candidate_bucket_to_strategy(candidate_bucket: str | None) -> str | None:
    return TRACKED_STRATEGY_BY_CANDIDATE_BUCKET.get(
        str(candidate_bucket or "").strip().lower(),
    )

def strikes_match(left_value, right_value, *, tolerance: float = 1e-6) -> bool:
    left_number = clean_history_number(left_value)
    right_number = clean_history_number(right_value)
    if left_number is None or right_number is None:
        return False
    return abs(left_number - right_number) <= tolerance

def compute_entry_executable_value(strategy: str, contract: dict) -> float | None:
    call_bid = clean_history_number(contract.get("callBid"))
    call_ask = clean_history_number(contract.get("callAsk"))
    put_bid = clean_history_number(contract.get("putBid"))
    put_ask = clean_history_number(contract.get("putAsk"))

    if strategy == "long_front_straddle":
        if call_ask is None or put_ask is None or call_ask <= 0 or put_ask <= 0:
            return None
        return call_ask + put_ask
    if strategy == "short_front_straddle":
        if call_bid is None or put_bid is None or call_bid <= 0 or put_bid <= 0:
            return None
        return call_bid + put_bid
    return None

def compute_mark_executable_value(strategy: str, contract: dict) -> float | None:
    call_bid = clean_history_number(contract.get("callBid"))
    call_ask = clean_history_number(contract.get("callAsk"))
    put_bid = clean_history_number(contract.get("putBid"))
    put_ask = clean_history_number(contract.get("putAsk"))

    if strategy == "long_front_straddle":
        if call_bid is None or put_bid is None or call_bid < 0 or put_bid < 0:
            return None
        return call_bid + put_bid
    if strategy == "short_front_straddle":
        if call_ask is None or put_ask is None or call_ask < 0 or put_ask < 0:
            return None
        return call_ask + put_ask
    return None

def compute_trade_edge_amount(
    strategy: str,
    *,
    entry_executable_value: float | None,
    executable_mark_value: float | None,
) -> float | None:
    if (
        entry_executable_value is None
        or executable_mark_value is None
        or entry_executable_value <= 0
    ):
        return None
    if strategy == "long_front_straddle":
        return executable_mark_value - entry_executable_value
    if strategy == "short_front_straddle":
        return entry_executable_value - executable_mark_value
    return None

def build_mark_payload_from_contract(
    position: dict,
    contract: dict,
    *,
    mark_date: str,
    underlying_close: float | None,
    underlying_close_date: str | None,
    mark_source: str,
    mark_status: str,
    reason: str | None = None,
) -> dict:
    executable_mark_value = compute_mark_executable_value(
        position["strategy"],
        contract,
    )
    edge_vs_entry_premium = compute_trade_edge_amount(
        position["strategy"],
        entry_executable_value=clean_history_number(position.get("entryExecutableValue")),
        executable_mark_value=executable_mark_value,
    )
    executable_return = (
        edge_vs_entry_premium / clean_history_number(position.get("entryExecutableValue"))
        if edge_vs_entry_premium is not None
        and clean_history_number(position.get("entryExecutableValue")) not in (None, 0)
        else None
    )
    return {
        "markDate": mark_date,
        "underlyingClose": underlying_close,
        "underlyingCloseDate": underlying_close_date,
        "callBid": contract.get("callBid"),
        "callAsk": contract.get("callAsk"),
        "callMid": contract.get("callMidPrice"),
        "putBid": contract.get("putBid"),
        "putAsk": contract.get("putAsk"),
        "putMid": contract.get("putMidPrice"),
        "referenceStraddleMid": contract.get("straddleMidPrice"),
        "executableMarkValue": executable_mark_value,
        "edgeVsEntryPremium": edge_vs_entry_premium,
        "executableReturn": executable_return,
        "markSource": mark_source,
        "markStatus": mark_status,
        "reason": reason,
    }

def load_or_refresh_price_rows(
    symbol: str,
    *,
    preferred_provider: str | None = None,
    minimum_end_date: str | None = None,
) -> list[dict]:
    price_rows = load_price_rows(symbol)
    latest_date = (
        str(price_rows[-1].get("date"))
        if price_rows
        else None
    )
    if not price_rows or (
        minimum_end_date
        and (latest_date is None or latest_date < str(minimum_end_date))
    ):
        get_or_refresh_cached_series(
            symbol,
            preferred_provider=preferred_provider,
        )
        price_rows = load_price_rows(symbol)
    return price_rows

def build_tracked_position_from_screener_row(row: dict) -> tuple[dict | None, str | None]:
    strategy = candidate_bucket_to_strategy(row.get("candidateBucket"))
    if not strategy:
        return None, "Row does not map to a tracked front-straddle strategy."

    contracts = load_option_monthly_snapshots(
        row.get("symbol"),
        as_of_date=row.get("asOfDate"),
        provider=row.get("provider"),
    )
    matching_contract = next(
        (
            contract
            for contract in contracts
            if str(contract.get("expiry") or "").strip() == str(row.get("expiry") or "").strip()
            and strikes_match(contract.get("strike"), row.get("strike"))
        ),
        None,
    )
    if matching_contract is None:
        return None, "No exact cached entry contract was found for the screener row."

    entry_executable_value = compute_entry_executable_value(strategy, matching_contract)
    if entry_executable_value is None or entry_executable_value <= 0:
        return None, "The entry contract did not have executable bid/ask prices."

    position = {
        "sourceRunId": row.get("runId"),
        "symbol": row.get("symbol"),
        "provider": row.get("provider"),
        "strategy": strategy,
        "signalVersion": row.get("signalVersion") or OPTIONS_SIGNAL_VERSION,
        "universeId": row.get("universeId"),
        "universeLabel": row.get("universeLabel"),
        "entryAsOfDate": row.get("asOfDate"),
        "entryBaseDate": matching_contract.get("spotDate") or row.get("asOfDate"),
        "expiry": row.get("expiry"),
        "strike": row.get("strike"),
        "daysToExpiry": row.get("daysToExpiry"),
        "spotPrice": matching_contract.get("spotPrice") or row.get("spotPrice"),
        "callEntryBid": matching_contract.get("callBid"),
        "callEntryAsk": matching_contract.get("callAsk"),
        "callEntryMid": matching_contract.get("callMidPrice"),
        "putEntryBid": matching_contract.get("putBid"),
        "putEntryAsk": matching_contract.get("putAsk"),
        "putEntryMid": matching_contract.get("putMidPrice"),
        "entryMarkSource": matching_contract.get("pricingMode") or "snapshot",
        "entryExecutableValue": entry_executable_value,
        "entryReferenceMid": matching_contract.get("straddleMidPrice"),
        "candidateBucket": row.get("candidateBucket"),
        "pricingBucket": row.get("pricingBucket"),
        "directionBucket": direction_bucket(row.get("directionLabel")),
        "primaryTradeIdea": row.get("primaryTradeIdea"),
        "currency": row.get("currency"),
    }
    return position, None

def sync_tracked_positions_for_run(run_id: int) -> dict:
    rows = load_options_screener_rows(
        run_id=int(run_id),
        limit=OPTIONS_SCREENER_MAX_SYMBOLS * 4,
    )
    eligible_rows = 0
    tracked_positions = 0
    skipped_rows: list[dict] = []

    for row in rows:
        strategy = candidate_bucket_to_strategy(row.get("candidateBucket"))
        if not strategy:
            continue
        eligible_rows += 1
        position, skip_reason = build_tracked_position_from_screener_row(row)
        if position is None:
            skipped_rows.append(
                {
                    "symbol": row.get("symbol"),
                    "reason": skip_reason or "Position could not be tracked.",
                },
            )
            continue

        stored_position = upsert_tracked_option_position(position)
        tracked_positions += 1
        entry_contract = {
            "callBid": position.get("callEntryBid"),
            "callAsk": position.get("callEntryAsk"),
            "callMidPrice": position.get("callEntryMid"),
            "putBid": position.get("putEntryBid"),
            "putAsk": position.get("putEntryAsk"),
            "putMidPrice": position.get("putEntryMid"),
            "straddleMidPrice": position.get("entryReferenceMid"),
        }
        entry_mark = build_mark_payload_from_contract(
            stored_position,
            entry_contract,
            mark_date=stored_position.get("entryBaseDate") or stored_position.get("entryAsOfDate"),
            underlying_close=clean_history_number(stored_position.get("spotPrice")),
            underlying_close_date=stored_position.get("entryBaseDate"),
            mark_source="entry-quote",
            mark_status="quoted",
        )
        upsert_tracked_option_mark(
            int(stored_position["positionId"]),
            entry_mark,
        )

    return {
        "runId": int(run_id),
        "eligibleRows": eligible_rows,
        "trackedPositions": tracked_positions,
        "skippedRows": skipped_rows,
    }

def build_intrinsic_settlement_mark(position: dict, price_rows: list[dict]) -> dict | None:
    expiry = str(position.get("expiry") or "").strip()
    eligible_rows = [
        row
        for row in price_rows
        if str(row.get("date") or "") <= expiry
    ]
    if not eligible_rows:
        return None

    settlement_row = eligible_rows[-1]
    underlying_close = clean_history_number(settlement_row.get("close"))
    strike = clean_history_number(position.get("strike"))
    if underlying_close is None or strike is None:
        return None

    call_intrinsic = max(underlying_close - strike, 0.0)
    put_intrinsic = max(strike - underlying_close, 0.0)
    contract = {
        "callBid": call_intrinsic,
        "callAsk": call_intrinsic,
        "callMidPrice": call_intrinsic,
        "putBid": put_intrinsic,
        "putAsk": put_intrinsic,
        "putMidPrice": put_intrinsic,
        "straddleMidPrice": call_intrinsic + put_intrinsic,
    }
    return build_mark_payload_from_contract(
        position,
        contract,
        mark_date=str(settlement_row.get("date") or expiry),
        underlying_close=underlying_close,
        underlying_close_date=str(settlement_row.get("date") or expiry),
        mark_source="expiry-intrinsic",
        mark_status="settled",
        reason="Expired; settled from intrinsic value on the last underlying close at or before expiry.",
    )

def refresh_open_tracked_option_marks(*, as_of_date: str | None = None) -> dict:
    current_date = str(as_of_date or datetime.utcnow().date().isoformat())
    positions = load_tracked_option_positions(
        open_only=True,
        limit=5000,
    )
    refreshed_positions = 0
    settled_positions = 0
    missing_marks = 0

    for position in positions:
        existing_marks = load_tracked_option_marks(
            position_id=int(position["positionId"]),
            limit=5000,
        )
        existing_dates = {mark["markDate"] for mark in existing_marks}

        if current_date > str(position.get("expiry") or ""):
            price_rows = load_or_refresh_price_rows(
                position["symbol"],
                preferred_provider=position.get("provider"),
                minimum_end_date=position.get("expiry"),
            )
            settlement_mark = build_intrinsic_settlement_mark(position, price_rows)
            if settlement_mark and settlement_mark["markDate"] not in existing_dates:
                upsert_tracked_option_mark(
                    int(position["positionId"]),
                    settlement_mark,
                )
                settled_positions += 1
            continue

        try:
            quote = fetch_exact_contract_quote(
                position["symbol"],
                expiry=str(position.get("expiry") or ""),
                strike=float(position.get("strike")),
            )
            mark_date = str(quote.get("spotDate") or quote.get("asOfDate") or current_date)
            if mark_date in existing_dates:
                continue
            mark_payload = build_mark_payload_from_contract(
                position,
                quote.get("contract") or {},
                mark_date=mark_date,
                underlying_close=clean_history_number(quote.get("spotPrice")),
                underlying_close_date=quote.get("spotDate"),
                mark_source="live-quote",
                mark_status="quoted",
            )
            upsert_tracked_option_mark(
                int(position["positionId"]),
                mark_payload,
            )
            refreshed_positions += 1
        except OptionContractNotMarkableError as error:
            if current_date not in existing_dates:
                upsert_tracked_option_mark(
                    int(position["positionId"]),
                    {
                        "markDate": current_date,
                        "markSource": "missing-quote",
                        "markStatus": "missing",
                        "reason": str(error),
                    },
                )
                missing_marks += 1
        except Exception as error:  # noqa: BLE001
            if current_date not in existing_dates:
                upsert_tracked_option_mark(
                    int(position["positionId"]),
                    {
                        "markDate": current_date,
                        "markSource": "missing-quote",
                        "markStatus": "missing",
                        "reason": str(error),
                    },
                )
                missing_marks += 1

    return {
        "openPositions": len(positions),
        "refreshedPositions": refreshed_positions,
        "settledPositions": settled_positions,
        "missingMarks": missing_marks,
        "asOfDate": current_date,
    }

def collect_options_evidence_for_universe(
    universe_id: str,
    *,
    minimum_dte: int | None = None,
    max_contracts: int | None = None,
    symbols: list[str] | None = None,
    as_of_date: str | None = None,
    collector_universes: dict | None = None,
    screener_snapshot_builder=None,
    tracked_position_sync=None,
    mark_refresher=None,
) -> dict:
    config = (collector_universes or COLLECTOR_UNIVERSES).get(str(universe_id).strip())
    if config is None:
        raise ValueError(f"Unknown collector universe: {universe_id}")
    if screener_snapshot_builder is None:
        raise RuntimeError("A screener snapshot builder is required.")
    tracked_position_sync = tracked_position_sync or sync_tracked_positions_for_run
    mark_refresher = mark_refresher or refresh_open_tracked_option_marks

    screener_payload = screener_snapshot_builder(
        {
            "universeId": config["universeId"],
            "universeLabel": config["universeLabel"],
            "minimumDte": int(minimum_dte or config["minimumDte"]),
            "maxContracts": int(max_contracts or config["maxContracts"]),
            "symbols": symbols or config["symbols"],
        },
    )
    tracking_summary = (
        tracked_position_sync(int(screener_payload["storage"]["runId"]))
        if screener_payload.get("storage")
        else {
            "runId": None,
            "eligibleRows": 0,
            "trackedPositions": 0,
            "skippedRows": [],
        }
    )
    mark_summary = mark_refresher(as_of_date=as_of_date)
    return {
        "universeId": config["universeId"],
        "universeLabel": config["universeLabel"],
        "signalVersion": OPTIONS_SIGNAL_VERSION,
        "screenerRun": screener_payload.get("storage"),
        "tracking": tracking_summary,
        "marking": mark_summary,
        "failures": screener_payload.get("failures") or [],
        "storageWarning": screener_payload.get("storageWarning"),
    }
