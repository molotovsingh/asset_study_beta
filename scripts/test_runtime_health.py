#!/usr/bin/env python3

from __future__ import annotations

import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import runtime_store  # noqa: E402
from server import ops_service  # noqa: E402


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


def _write_symbol(symbol: str, *, provider: str = "yfinance"):
    runtime_store.write_price_history(
        symbol,
        [
            {"date": "2026-04-10", "close": 100.0},
            {"date": "2026-04-11", "close": 101.0},
        ],
        [],
        currency="USD",
        provider=provider,
        sync_mode="full",
        replace=True,
    )


def test_runtime_health_payload_flags_attention_and_reports_operational_state():
    with isolated_runtime_store():
        _write_symbol("AAPL", provider="finnhub")
        _write_symbol("MSFT")
        _write_symbol("NVDA")
        _write_symbol("TSLA")

        with runtime_store.open_runtime_store() as connection:
            connection.execute(
                """
                UPDATE sync_state
                SET last_checked_at = ?, last_price_date = ?, last_sync_status = ?, last_sync_message = ?
                WHERE symbol_id = (SELECT symbol_id FROM symbols WHERE symbol = ?)
                """,
                ("2026-04-19T08:00:00+00:00", "2026-04-19", "ok", "fresh", "AAPL"),
            )
            connection.execute(
                """
                UPDATE sync_state
                SET last_checked_at = ?, last_price_date = ?, last_sync_status = ?, last_sync_message = ?
                WHERE symbol_id = (SELECT symbol_id FROM symbols WHERE symbol = ?)
                """,
                ("2026-04-10T08:00:00+00:00", "2026-04-10", "ok", "stale check", "MSFT"),
            )
            connection.execute(
                """
                UPDATE sync_state
                SET last_checked_at = ?, last_price_date = ?, last_sync_status = ?, last_sync_message = ?
                WHERE symbol_id = (SELECT symbol_id FROM symbols WHERE symbol = ?)
                """,
                ("2026-04-19T08:00:00+00:00", "2026-04-10", "ok", "stale price", "NVDA"),
            )
            connection.execute(
                """
                UPDATE sync_state
                SET last_checked_at = ?, last_price_date = ?, last_sync_status = ?, last_sync_message = ?
                WHERE symbol_id = (SELECT symbol_id FROM symbols WHERE symbol = ?)
                """,
                ("2026-04-19T08:00:00+00:00", "2026-04-19", "error", "upstream timeout", "TSLA"),
            )
            connection.execute(
                """
                INSERT INTO symbols (
                    symbol,
                    provider,
                    currency,
                    source_series_type,
                    created_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                ("AMZN", "yfinance", "USD", "Price", "2026-04-19T09:00:00+00:00", "2026-04-19T09:00:00+00:00"),
            )
            connection.commit()

        runtime_store.upsert_symbol_universe(
            "us-core",
            "US Core",
            selection_kind="manual",
            source_provider="manual",
        )
        runtime_store.sync_symbol_universe_members(
            "us-core",
            [
                {"symbol": "AAPL", "label": "Apple"},
                {"symbol": "MSFT", "label": "Microsoft"},
            ],
            source_provider="manual",
            replace=False,
        )
        runtime_store.record_market_collection_run(
            universe_id="us-core",
            universe_label="US Core",
            mode="collect",
            requested_provider_order=["finnhub", "yfinance"],
            symbol_count=2,
            success_count=1,
            failure_count=1,
            skipped_count=0,
            refresh_symbol_master=False,
            full_sync=False,
            as_of_date="2026-04-19",
            started_at="2026-04-19T09:00:00+00:00",
            completed_at="2026-04-19T09:05:00+00:00",
            failures=[{"symbol": "MSFT", "error": "rate limited"}],
        )

        screener_run = runtime_store.record_options_screener_run(
            universe_id="us-liquid-10",
            universe_label="US Liquid 10",
            minimum_dte=7,
            max_contracts=1,
            requested_symbols=["AAPL"],
            failures=[],
            rows=[
                {
                    "symbol": "AAPL",
                    "provider": "yfinance",
                    "currency": "USD",
                    "asOfDate": "2026-04-19",
                    "expiry": "2026-04-25",
                    "spotPrice": 101.0,
                    "strike": 100.0,
                    "daysToExpiry": 6,
                    "straddleMidPrice": 4.2,
                    "impliedMovePercent": 0.041,
                    "straddleImpliedVolatility": 0.28,
                    "chainImpliedVolatility": 0.27,
                    "historicalVolatility20": 0.2,
                    "historicalVolatility60": 0.21,
                    "ivHv20Ratio": 1.4,
                    "ivHv60Ratio": 1.3,
                    "ivPercentile": 0.7,
                    "ivHv20Percentile": 0.68,
                    "combinedOpenInterest": 1200,
                    "combinedVolume": 300,
                    "spreadShare": 0.03,
                    "pricingLabel": "Mildly Rich",
                    "pricingBucket": "rich",
                    "directionScore": 58.0,
                    "directionLabel": "Long Bias",
                    "trendScore": 58.0,
                    "trendLabel": "Long Bias",
                    "trendReturn63": 0.04,
                    "trendReturn252": 0.11,
                    "seasonalityScore": 55.0,
                    "seasonalityLabel": "Long Bias",
                    "seasonalityMonthLabel": "Apr",
                    "seasonalityMeanReturn": 0.01,
                    "seasonalityMedianReturn": 0.008,
                    "seasonalityWinRate": 0.55,
                    "seasonalityAverageAbsoluteReturn": 0.05,
                    "seasonalityObservations": 12,
                    "volPricingScore": 62.0,
                    "executionScore": 79.0,
                    "confidenceScore": 83.0,
                    "candidateAdvisory": "Short Premium Candidate",
                    "candidateBucket": "short-premium",
                    "signalVersion": "options-signal-v1",
                    "rvPercentile": 0.4,
                    "vrp": 0.03,
                    "frontImpliedVolatility": 0.28,
                    "backImpliedVolatility": 0.29,
                    "termStructureSteepness": 0.01,
                    "termStructureBucket": "flat",
                    "termStructureLabel": "Flat",
                    "atmImpliedVolatility": 0.27,
                    "put25DeltaImpliedVolatility": 0.29,
                    "call25DeltaImpliedVolatility": 0.25,
                    "normalizedSkew": 0.07,
                    "normalizedUpsideSkew": -0.06,
                    "ivRank": 72.0,
                    "rvRank": 49.0,
                    "vrpRank": 68.0,
                    "termStructureRank": 42.0,
                    "skewRank": 63.0,
                    "primaryTradeIdea": "Sell Vega",
                    "tradeIdeaLabels": ["Sell Vega"],
                    "warnings": [],
                }
            ],
            signal_version="options-signal-v1",
            created_at="2026-04-19T08:30:00+00:00",
        )

        runtime_store.upsert_tracked_option_position(
            {
                "sourceRunId": screener_run["runId"],
                "symbol": "AAPL",
                "universeId": "us-liquid-10",
                "universeLabel": "US Liquid 10",
                "provider": "yfinance",
                "strategy": "short_front_straddle",
                "signalVersion": "options-signal-v1",
                "entryAsOfDate": "2026-04-19",
                "entryBaseDate": "2026-04-19",
                "expiry": "2026-04-25",
                "strike": 100.0,
                "daysToExpiry": 6,
                "spotPrice": 101.0,
                "callEntryBid": 2.0,
                "callEntryAsk": 2.2,
                "callEntryMid": 2.1,
                "putEntryBid": 1.9,
                "putEntryAsk": 2.1,
                "putEntryMid": 2.0,
                "entryMarkSource": "snapshot",
                "entryExecutableValue": 3.9,
                "entryReferenceMid": 4.1,
                "candidateBucket": "short-premium",
                "pricingBucket": "rich",
                "directionBucket": "long-bias",
                "primaryTradeIdea": "Sell Vega",
            },
            created_at="2026-04-19T08:35:00+00:00",
        )

        payload = ops_service.build_runtime_health_payload(
            {
                "asOfDate": "2026-04-20",
                "staleAfterDays": 3,
                "symbolLimit": 10,
                "universeLimit": 10,
                "runLimit": 10,
            }
        )

        assert_equal(payload["referenceDate"], "2026-04-20", "reference date should round-trip")
        assert_equal(payload["summary"]["totalSymbols"], 5, "symbol count should include unsynced symbols")
        assert_equal(payload["summary"]["syncedSymbols"], 4, "synced symbol count should include sync_state rows")
        assert_equal(payload["summary"]["attentionSymbolCount"], 4, "four symbols should need attention")
        assert_equal(payload["summary"]["neverCheckedCount"], 1, "one symbol should be never checked")
        assert_equal(payload["summary"]["syncErrorCount"], 1, "one symbol should be in sync error")
        assert_equal(payload["summary"]["staleCheckCount"], 1, "one symbol should be stale by check time")
        assert_equal(payload["summary"]["stalePriceCount"], 1, "one symbol should be stale by price date")
        assert_equal(payload["summary"]["openTrackedPositionCount"], 1, "one tracked position should be open")

        issues_by_symbol = {
            entry["symbol"]: entry["issue"]
            for entry in payload["attentionSymbols"]
        }
        assert_equal(issues_by_symbol["AMZN"], "never-checked", "AMZN should be flagged as never checked")
        assert_equal(issues_by_symbol["TSLA"], "sync-error", "TSLA should be flagged as sync error")
        assert_equal(issues_by_symbol["MSFT"], "stale-check", "MSFT should be flagged as stale check")
        assert_equal(issues_by_symbol["NVDA"], "stale-price", "NVDA should be flagged as stale price")

        assert_equal(len(payload["universeHealth"]), 1, "one universe should be reported")
        latest_run = payload["universeHealth"][0]["latestRun"]
        assert_equal(latest_run["failureCount"], 1, "universe latest run should include failure count")
        assert_equal(latest_run["requestedProviderOrder"], ["finnhub", "yfinance"], "provider order should round-trip")

        assert_equal(len(payload["recentCollectionRuns"]), 1, "one collection run should be listed")
        assert_equal(payload["recentCollectionRuns"][0]["universeId"], "us-core", "collection run universe should round-trip")

        assert_equal(len(payload["recentScreenerRuns"]), 1, "one screener run should be listed")
        assert_equal(payload["recentScreenerRuns"][0]["signalVersion"], "options-signal-v1", "screener run signal version should round-trip")

        assert_equal(payload["positionSummary"]["openTrackedPositionCount"], 1, "position summary should reflect one open position")
        assert_equal(payload["positionSummary"]["openPositionsWithoutMarks"], 1, "open position should have no marks yet")
        assert_equal(payload["positionSummary"]["openPositionStrategies"], {"short_front_straddle": 1}, "strategy mix should be summarized")
        assert_equal(payload["openPositionHealth"][0]["symbol"], "AAPL", "open position should surface symbol")
        assert_equal(payload["openPositionHealth"][0]["markCount"], 0, "open position should show no marks yet")


def main():
    test_runtime_health_payload_flags_attention_and_reports_operational_state()
    print("ok runtime health")


if __name__ == "__main__":
    main()
