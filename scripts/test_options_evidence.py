#!/usr/bin/env python3

from __future__ import annotations

import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import dev_server  # noqa: E402
import runtime_store  # noqa: E402
from providers.yfinance_provider import OptionContractNotMarkableError  # noqa: E402


@contextmanager
def isolated_runtime_store():
    original_cache_root = runtime_store.CACHE_ROOT
    original_cache_db_path = runtime_store.CACHE_DB_PATH
    original_manifest_path = runtime_store.LEGACY_MANIFEST_PATH
    original_ready = runtime_store._RUNTIME_STORE_READY

    with tempfile.TemporaryDirectory(dir=runtime_store.REPO_ROOT) as temp_dir:
        cache_root = Path(temp_dir) / "local-cache" / "yfinance" / "index"
        runtime_store.CACHE_ROOT = cache_root
        runtime_store.CACHE_DB_PATH = cache_root / "cache.sqlite3"
        runtime_store.LEGACY_MANIFEST_PATH = cache_root / "manifest.json"
        runtime_store._RUNTIME_STORE_READY = False
        try:
            yield
        finally:
            runtime_store.CACHE_ROOT = original_cache_root
            runtime_store.CACHE_DB_PATH = original_cache_db_path
            runtime_store.LEGACY_MANIFEST_PATH = original_manifest_path
            runtime_store._RUNTIME_STORE_READY = original_ready


def assert_equal(actual, expected, message):
    if actual != expected:
        raise AssertionError(f"{message}: expected {expected!r}, got {actual!r}")


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


def candidate_advisory_for_bucket(candidate_bucket: str) -> str:
    if candidate_bucket == "long-premium":
        return "Long Premium Candidate"
    if candidate_bucket == "short-premium":
        return "Short Premium Candidate"
    if candidate_bucket == "low-confidence":
        return "Low Confidence"
    return "No Vol Edge"


def build_screener_row(
    symbol: str,
    *,
    as_of_date: str = "2026-04-10",
    expiry: str = "2026-04-17",
    spot_price: float = 100.0,
    strike: float = 100.0,
    days_to_expiry: int = 7,
    candidate_bucket: str = "watch",
    pricing_bucket: str = "fair",
    direction_label: str = "Neutral",
    signal_version: str = "options-signal-v1",
    primary_trade_idea: str = "No Preset Match",
    trade_idea_labels: list[str] | None = None,
) -> dict:
    return {
        "symbol": symbol,
        "provider": "yfinance",
        "currency": "USD",
        "asOfDate": as_of_date,
        "expiry": expiry,
        "spotPrice": spot_price,
        "strike": strike,
        "daysToExpiry": days_to_expiry,
        "straddleMidPrice": 5.0,
        "impliedMovePercent": 0.05,
        "straddleImpliedVolatility": 0.3,
        "chainImpliedVolatility": 0.29,
        "historicalVolatility20": 0.2,
        "historicalVolatility60": 0.21,
        "ivHv20Ratio": 1.5,
        "ivHv60Ratio": 1.43,
        "ivPercentile": 0.7,
        "ivHv20Percentile": 0.66,
        "combinedOpenInterest": 1200,
        "combinedVolume": 300,
        "spreadShare": 0.03,
        "pricingLabel": (
            "Cheap"
            if pricing_bucket == "cheap"
            else "Rich"
            if pricing_bucket == "rich"
            else "Fair"
        ),
        "pricingBucket": pricing_bucket,
        "directionScore": 58.0,
        "directionLabel": direction_label,
        "trendScore": 58.0,
        "trendLabel": direction_label,
        "trendReturn63": 0.04,
        "trendReturn252": 0.11,
        "seasonalityScore": 55.0,
        "seasonalityLabel": direction_label,
        "seasonalityMonthLabel": "Apr",
        "seasonalityMeanReturn": 0.01,
        "seasonalityMedianReturn": 0.008,
        "seasonalityWinRate": 0.55,
        "seasonalityAverageAbsoluteReturn": 0.05,
        "seasonalityObservations": 12,
        "volPricingScore": 62.0,
        "executionScore": 79.0,
        "confidenceScore": 83.0,
        "candidateAdvisory": candidate_advisory_for_bucket(candidate_bucket),
        "candidateBucket": candidate_bucket,
        "signalVersion": signal_version,
        "rvPercentile": 0.4,
        "vrp": 0.03,
        "frontImpliedVolatility": 0.3,
        "backImpliedVolatility": 0.31,
        "termStructureSteepness": 0.01,
        "termStructureBucket": "flat",
        "termStructureLabel": "Flat",
        "atmImpliedVolatility": 0.29,
        "put25DeltaImpliedVolatility": 0.31,
        "call25DeltaImpliedVolatility": 0.27,
        "normalizedSkew": 0.07,
        "normalizedUpsideSkew": -0.06,
        "ivRank": 72.0,
        "rvRank": 49.0,
        "vrpRank": 68.0,
        "termStructureRank": 42.0,
        "skewRank": 63.0,
        "primaryTradeIdea": primary_trade_idea,
        "tradeIdeaLabels": trade_idea_labels or ([] if primary_trade_idea == "No Preset Match" else [primary_trade_idea]),
        "warnings": [],
    }


def build_monthly_snapshot(
    symbol: str,
    *,
    as_of_date: str = "2026-04-10",
    expiry: str = "2026-04-17",
    spot_price: float = 100.0,
    strike: float = 100.0,
    days_to_expiry: int = 7,
    call_bid: float = 2.4,
    call_ask: float = 2.6,
    put_bid: float = 2.3,
    put_ask: float = 2.5,
) -> dict:
    call_mid = (call_bid + call_ask) / 2
    put_mid = (put_bid + put_ask) / 2
    straddle_mid = call_mid + put_mid
    return {
        "symbol": symbol,
        "provider": "yfinance",
        "currency": "USD",
        "fetchedAt": f"{as_of_date}T08:30:00+00:00",
        "asOfDate": as_of_date,
        "spotDate": as_of_date,
        "spotPrice": spot_price,
        "minimumDte": max(days_to_expiry, 7),
        "maxContracts": 1,
        "realizedVolatility": {
            "seriesType": "close",
            "observations": 252,
            "hv20": 0.2,
            "hv60": 0.21,
            "hv120": 0.22,
        },
        "monthlyContracts": [
            {
                "expiry": expiry,
                "daysToExpiry": days_to_expiry,
                "strike": strike,
                "callBid": call_bid,
                "callAsk": call_ask,
                "callLastPrice": call_mid,
                "callMidPrice": call_mid,
                "callPriceSource": "mid",
                "callOpenInterest": 1000,
                "callVolume": 240,
                "callImpliedVolatility": 0.31,
                "putBid": put_bid,
                "putAsk": put_ask,
                "putLastPrice": put_mid,
                "putMidPrice": put_mid,
                "putPriceSource": "mid",
                "putOpenInterest": 1100,
                "putVolume": 260,
                "putImpliedVolatility": 0.29,
                "straddleMidPrice": straddle_mid,
                "impliedMovePrice": straddle_mid,
                "impliedMovePercent": straddle_mid / spot_price,
                "straddleImpliedVolatility": 0.3,
                "chainImpliedVolatility": 0.3,
                "impliedVolatilityGap": 0.0,
                "historicalVolatility20": 0.2,
                "historicalVolatility60": 0.21,
                "historicalVolatility120": 0.22,
                "ivHv20Ratio": 1.5,
                "ivHv60Ratio": 1.43,
                "ivHv120Ratio": 1.36,
                "ivHv20Spread": 0.1,
                "ivHv60Spread": 0.09,
                "ivHv120Spread": 0.08,
                "combinedOpenInterest": 2100,
                "combinedVolume": 500,
                "pricingMode": "bid-ask-mid",
            }
        ],
    }


def record_run(rows: list[dict], *, created_at: str = "2026-04-10T08:30:00+00:00") -> dict:
    return runtime_store.record_options_screener_run(
        universe_id="us-liquid-10",
        universe_label="US Liquid 10",
        minimum_dte=7,
        max_contracts=1,
        requested_symbols=[row["symbol"] for row in rows],
        failures=[],
        rows=rows,
        signal_version="options-signal-v1",
        created_at=created_at,
    )


def test_sync_tracked_positions_tracks_only_straddle_candidates_and_is_idempotent():
    with isolated_runtime_store():
        runtime_store.write_option_monthly_snapshot(
            "AAPL",
            build_monthly_snapshot("AAPL"),
        )
        runtime_store.write_option_monthly_snapshot(
            "MSFT",
            build_monthly_snapshot(
                "MSFT",
                spot_price=200.0,
                strike=200.0,
                call_bid=3.4,
                call_ask=3.8,
                put_bid=3.1,
                put_ask=3.5,
            ),
        )
        run_summary = record_run(
            [
                build_screener_row(
                    "AAPL",
                    candidate_bucket="long-premium",
                    pricing_bucket="cheap",
                    direction_label="Long Bias",
                    primary_trade_idea="Buy Gamma/Vega",
                ),
                build_screener_row(
                    "MSFT",
                    spot_price=200.0,
                    strike=200.0,
                    candidate_bucket="short-premium",
                    pricing_bucket="rich",
                    direction_label="Short Bias",
                    primary_trade_idea="Sell Vega",
                ),
                build_screener_row("NVDA", candidate_bucket="watch", pricing_bucket="fair"),
                build_screener_row("AMD", candidate_bucket="low-confidence", pricing_bucket="rich"),
            ],
        )

        first_sync = dev_server.sync_tracked_positions_for_run(run_summary["runId"])
        second_sync = dev_server.sync_tracked_positions_for_run(run_summary["runId"])
        positions = runtime_store.load_tracked_option_positions(limit=10)

        assert_equal(first_sync["eligibleRows"], 2, "only long/short premium rows should be eligible")
        assert_equal(first_sync["trackedPositions"], 2, "two eligible rows should create tracked positions")
        assert_equal(second_sync["trackedPositions"], 2, "re-sync should still resolve the same tracked positions")
        assert_equal(len(positions), 2, "tracked positions should remain idempotent across repeated syncs")
        assert_equal(
            sorted(position["strategy"] for position in positions),
            ["long_front_straddle", "short_front_straddle"],
            "candidate buckets should map to the expected tracked strategies",
        )
        for position in positions:
            marks = runtime_store.load_tracked_option_marks(position_id=position["positionId"], limit=10)
            assert_equal(len(marks), 1, "each position should keep a single entry mark after repeated syncs")
            assert_equal(marks[0]["markSource"], "entry-quote", "entry marks should be written from the stored entry quote")


def test_refresh_open_tracked_option_marks_settles_expired_positions():
    with isolated_runtime_store():
        runtime_store.write_price_history(
            "AAPL",
            [
                {"date": "2026-04-10", "close": 100},
                {"date": "2026-04-13", "close": 102},
                {"date": "2026-04-15", "close": 108},
            ],
            [],
            currency="USD",
            provider="yfinance",
            sync_mode="full",
            replace=True,
        )
        run_summary = record_run(
            [build_screener_row("AAPL", expiry="2026-04-15", days_to_expiry=5)],
        )
        position = runtime_store.upsert_tracked_option_position(
            {
                "sourceRunId": run_summary["runId"],
                "symbol": "AAPL",
                "provider": "yfinance",
                "strategy": "long_front_straddle",
                "signalVersion": "options-signal-v1",
                "universeId": "us-liquid-10",
                "universeLabel": "US Liquid 10",
                "entryAsOfDate": "2026-04-10",
                "entryBaseDate": "2026-04-10",
                "expiry": "2026-04-15",
                "strike": 100.0,
                "daysToExpiry": 5,
                "spotPrice": 100.0,
                "callEntryBid": 2.4,
                "callEntryAsk": 2.6,
                "callEntryMid": 2.5,
                "putEntryBid": 2.3,
                "putEntryAsk": 2.5,
                "putEntryMid": 2.4,
                "entryMarkSource": "snapshot",
                "entryExecutableValue": 5.1,
                "entryReferenceMid": 4.9,
                "candidateBucket": "long-premium",
                "pricingBucket": "cheap",
                "directionBucket": "long",
                "primaryTradeIdea": "Buy Gamma/Vega",
                "currency": "USD",
            },
        )

        summary = dev_server.refresh_open_tracked_option_marks(as_of_date="2026-04-16")
        updated_position = runtime_store.load_tracked_option_positions(
            position_id=position["positionId"],
            limit=1,
        )[0]
        marks = runtime_store.load_tracked_option_marks(position_id=position["positionId"], limit=10)

        assert_equal(summary["settledPositions"], 1, "expired positions should settle from intrinsic value")
        assert_equal(updated_position["closedAt"], "2026-04-15", "settlement should close the position on the last trade date at or before expiry")
        assert_equal(marks[-1]["markSource"], "expiry-intrinsic", "expiry settlement should be marked from intrinsic value")
        assert_equal(marks[-1]["markStatus"], "settled", "expiry settlement should be final")
        assert_equal(marks[-1]["underlyingClose"], 108.0, "settlement should use the last underlying close")
        assert_equal(round(marks[-1]["executableReturn"], 4), round((8.0 - 5.1) / 5.1, 4), "long straddle settlement should use executable bid-side value")


def test_refresh_open_tracked_option_marks_records_missing_quotes():
    with isolated_runtime_store():
        run_summary = record_run(
            [build_screener_row("AAPL", expiry="2026-04-20", days_to_expiry=10)],
        )
        position = runtime_store.upsert_tracked_option_position(
            {
                "sourceRunId": run_summary["runId"],
                "symbol": "AAPL",
                "provider": "yfinance",
                "strategy": "short_front_straddle",
                "signalVersion": "options-signal-v1",
                "universeId": "us-liquid-10",
                "universeLabel": "US Liquid 10",
                "entryAsOfDate": "2026-04-10",
                "entryBaseDate": "2026-04-10",
                "expiry": "2026-04-20",
                "strike": 100.0,
                "daysToExpiry": 10,
                "spotPrice": 100.0,
                "callEntryBid": 2.6,
                "callEntryAsk": 2.8,
                "callEntryMid": 2.7,
                "putEntryBid": 2.4,
                "putEntryAsk": 2.6,
                "putEntryMid": 2.5,
                "entryMarkSource": "snapshot",
                "entryExecutableValue": 5.0,
                "entryReferenceMid": 5.2,
                "candidateBucket": "short-premium",
                "pricingBucket": "rich",
                "directionBucket": "short",
                "primaryTradeIdea": "Sell Vega",
                "currency": "USD",
            },
        )

        original_fetch_exact_contract_quote = dev_server.options_service.fetch_exact_contract_quote

        def fake_fetch_exact_contract_quote(_symbol, *, expiry, strike):
            raise OptionContractNotMarkableError(
                f"The exact AAPL {expiry} {strike:g} straddle is not markable from the current chain.",
            )

        dev_server.options_service.fetch_exact_contract_quote = fake_fetch_exact_contract_quote
        try:
            summary = dev_server.refresh_open_tracked_option_marks(as_of_date="2026-04-14")
        finally:
            dev_server.options_service.fetch_exact_contract_quote = original_fetch_exact_contract_quote

        marks = runtime_store.load_tracked_option_marks(position_id=position["positionId"], limit=10)
        assert_equal(summary["missingMarks"], 1, "missing quotes should be counted explicitly")
        assert_equal(len(marks), 1, "missing quotes should persist as mark rows rather than disappearing")
        assert_equal(marks[0]["markStatus"], "missing", "missing quotes should use a dedicated mark status")
        assert_true(
            "not markable" in str(marks[0]["reason"]),
            "missing quote marks should preserve the provider reason",
        )


def test_trade_validation_clips_to_expiry_without_lookahead():
    with isolated_runtime_store():
        runtime_store.write_price_history(
            "AAPL",
            [
                {"date": "2026-04-10", "close": 100},
                {"date": "2026-04-13", "close": 102},
                {"date": "2026-04-14", "close": 101},
                {"date": "2026-04-15", "close": 108},
                {"date": "2026-04-16", "close": 111},
            ],
            [],
            currency="USD",
            provider="yfinance",
            sync_mode="full",
            replace=True,
        )
        run_summary = record_run(
            [build_screener_row("AAPL", expiry="2026-04-15", days_to_expiry=5)],
        )
        position = runtime_store.upsert_tracked_option_position(
            {
                "sourceRunId": run_summary["runId"],
                "symbol": "AAPL",
                "provider": "yfinance",
                "strategy": "long_front_straddle",
                "signalVersion": "options-signal-v1",
                "universeId": "us-liquid-10",
                "universeLabel": "US Liquid 10",
                "entryAsOfDate": "2026-04-10",
                "entryBaseDate": "2026-04-10",
                "expiry": "2026-04-15",
                "strike": 100.0,
                "daysToExpiry": 5,
                "spotPrice": 100.0,
                "callEntryBid": 2.4,
                "callEntryAsk": 2.6,
                "callEntryMid": 2.5,
                "putEntryBid": 2.3,
                "putEntryAsk": 2.5,
                "putEntryMid": 2.4,
                "entryMarkSource": "snapshot",
                "entryExecutableValue": 5.1,
                "entryReferenceMid": 4.9,
                "candidateBucket": "long-premium",
                "pricingBucket": "cheap",
                "directionBucket": "long",
                "primaryTradeIdea": "Buy Gamma/Vega",
                "currency": "USD",
            },
        )
        runtime_store.upsert_tracked_option_mark(
            position["positionId"],
            {
                "markDate": "2026-04-10",
                "underlyingClose": 100.0,
                "underlyingCloseDate": "2026-04-10",
                "callBid": 2.4,
                "callAsk": 2.6,
                "callMid": 2.5,
                "putBid": 2.3,
                "putAsk": 2.5,
                "putMid": 2.4,
                "referenceStraddleMid": 4.9,
                "executableMarkValue": 4.7,
                "edgeVsEntryPremium": -0.4,
                "executableReturn": -0.0784,
                "markSource": "entry-quote",
                "markStatus": "quoted",
            },
        )
        runtime_store.upsert_tracked_option_mark(
            position["positionId"],
            {
                "markDate": "2026-04-13",
                "underlyingClose": 102.0,
                "underlyingCloseDate": "2026-04-13",
                "callBid": 1.6,
                "callAsk": 1.8,
                "callMid": 1.7,
                "putBid": 1.5,
                "putAsk": 1.7,
                "putMid": 1.6,
                "referenceStraddleMid": 3.3,
                "executableMarkValue": 3.1,
                "edgeVsEntryPremium": -2.0,
                "executableReturn": -0.3922,
                "markSource": "live-quote",
                "markStatus": "quoted",
            },
        )
        runtime_store.upsert_tracked_option_mark(
            position["positionId"],
            {
                "markDate": "2026-04-15",
                "underlyingClose": 108.0,
                "underlyingCloseDate": "2026-04-15",
                "callBid": 8.0,
                "callAsk": 8.0,
                "callMid": 8.0,
                "putBid": 0.0,
                "putAsk": 0.0,
                "putMid": 0.0,
                "referenceStraddleMid": 8.0,
                "executableMarkValue": 8.0,
                "edgeVsEntryPremium": 2.9,
                "executableReturn": 0.5686,
                "markSource": "expiry-intrinsic",
                "markStatus": "settled",
            },
        )
        runtime_store.upsert_tracked_option_mark(
            position["positionId"],
            {
                "markDate": "2026-04-16",
                "underlyingClose": 111.0,
                "underlyingCloseDate": "2026-04-16",
                "callBid": 11.0,
                "callAsk": 11.2,
                "callMid": 11.1,
                "putBid": 0.0,
                "putAsk": 0.0,
                "putMid": 0.0,
                "referenceStraddleMid": 11.1,
                "executableMarkValue": 11.0,
                "edgeVsEntryPremium": 5.9,
                "executableReturn": 1.1569,
                "markSource": "post-expiry-noise",
                "markStatus": "quoted",
            },
        )

        payload = dev_server.build_trade_validation_payload(
            universe_id="us-liquid-10",
            horizon_key="5D",
            group_key="candidateBucket",
            limit_positions=10,
        )
        observation = payload["observations"][0]
        group = payload["groupedResults"][0]

        assert_equal(payload["validationType"], "trade", "trade validation should identify its payload type")
        assert_equal(payload["clippedCount"], 1, "trade validation should count clipped-to-expiry observations")
        assert_equal(observation["matured"], True, "trade validation should mature when the target mark exists")
        assert_equal(observation["clippedToExpiry"], True, "5D horizon should clip to expiry when expiry comes first")
        assert_equal(observation["exitMarkDate"], "2026-04-15", "trade validation should stop at expiry, not use later marks")
        assert_equal(round(observation["executableReturn"], 4), 0.5686, "trade validation should use the clipped expiry mark return")
        assert_equal(round(observation["maxAdverseReturn"], 4), -0.3922, "max adverse return should ignore post-target lookahead marks")
        assert_equal(group["label"], "Long Premium", "grouping should normalize candidate bucket labels")
        assert_equal(round(group["averageExecutableReturn"], 4), 0.5686, "group stats should aggregate executable returns")


def test_underlying_validation_collapses_same_day_reruns():
    with isolated_runtime_store():
        runtime_store.write_price_history(
            "AAPL",
            [
                {"date": "2026-04-10", "close": 100},
                {"date": "2026-04-13", "close": 103},
                {"date": "2026-04-14", "close": 104},
            ],
            [],
            currency="USD",
            provider="yfinance",
            sync_mode="full",
            replace=True,
        )
        first_run = record_run(
            [build_screener_row("AAPL", candidate_bucket="long-premium", pricing_bucket="cheap")],
            created_at="2026-04-10T08:30:00+00:00",
        )
        second_run = record_run(
            [build_screener_row("AAPL", candidate_bucket="long-premium", pricing_bucket="cheap")],
            created_at="2026-04-10T09:30:00+00:00",
        )

        payload = dev_server.build_options_screener_validation_payload(
            universe_id="us-liquid-10",
            horizon_days=1,
            limit_runs=10,
            row_limit=25,
        )
        observation = payload["observations"][0]

        assert_equal(payload["rawObservationCount"], 2, "underlying validation should expose raw row count")
        assert_equal(payload["observationCount"], 1, "same-day reruns should collapse into one evidence row")
        assert_equal(payload["rerunCountCollapsed"], 1, "collapsed rerun count should be reported")
        assert_equal(payload["maturedCount"], 1, "deduped matured count should count distinct evidence")
        assert_equal(observation["duplicateCount"], 2, "deduped observation should preserve duplicate count")
        assert_equal(observation["runId"], second_run["runId"], "latest rerun should be kept after dedupe")
        assert_true(first_run["runId"] < second_run["runId"], "test fixture should create increasing run ids")


def main() -> int:
    test_sync_tracked_positions_tracks_only_straddle_candidates_and_is_idempotent()
    test_refresh_open_tracked_option_marks_settles_expired_positions()
    test_refresh_open_tracked_option_marks_records_missing_quotes()
    test_trade_validation_clips_to_expiry_without_lookahead()
    test_underlying_validation_collapses_same_day_reruns()
    print("ok options evidence")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
