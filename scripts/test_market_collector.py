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
from providers.base import HistoryResult  # noqa: E402
from server import market_collector  # noqa: E402


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


def test_collect_market_universe_uses_provider_order_and_records_run():
    with isolated_runtime_store():
        original_fetchers = dict(market_collector.AVAILABLE_HISTORY_FETCHERS)

        def fake_finnhub(symbol, *, period=None, start=None, end=None):
            del period, start, end
            if symbol == "MSFT":
                raise RuntimeError("finnhub temporary failure")
            return HistoryResult(
                provider="finnhub",
                provider_name="Finnhub",
                price_rows=[
                    {"date": "2026-04-10", "close": 100.0},
                    {"date": "2026-04-11", "close": 101.0},
                ],
                action_rows=[],
                currency="USD",
            )

        def fake_yfinance(symbol, *, period=None, start=None, end=None):
            del period, start, end
            return HistoryResult(
                provider="yfinance",
                provider_name="Yahoo Finance (yfinance)",
                price_rows=[
                    {"date": "2026-04-10", "close": 200.0},
                    {"date": "2026-04-11", "close": 202.0},
                ],
                action_rows=[],
                currency="USD",
            )

        market_collector.AVAILABLE_HISTORY_FETCHERS = {
            "finnhub": fake_finnhub,
            "yfinance": fake_yfinance,
        }
        try:
            summary = market_collector.collect_market_universe(
                "test-core",
                universe_label="Test Core",
                symbols=["AAPL", "MSFT"],
                provider_order=["finnhub", "yfinance"],
            )
        finally:
            market_collector.AVAILABLE_HISTORY_FETCHERS = original_fetchers

        assert_equal(summary["symbolCount"], 2, "symbol count should reflect active members")
        assert_equal(summary["successCount"], 2, "both symbols should collect")
        assert_equal(summary["failureCount"], 0, "no failures should be recorded")
        assert_equal(summary["collected"][0]["provider"], "finnhub", "first symbol should use Finnhub")
        assert_equal(summary["collected"][1]["provider"], "yfinance", "fallback provider should be used for MSFT")

        members = runtime_store.load_symbol_universe_members("test-core")
        assert_equal(len(members), 2, "manual universe members should persist")
        assert_equal(runtime_store.load_symbol_sync_state("AAPL")["provider"], "finnhub", "AAPL provider should persist")
        assert_equal(runtime_store.load_symbol_sync_state("MSFT")["provider"], "yfinance", "MSFT provider should persist")

        universes = runtime_store.list_symbol_universes()
        assert_equal(universes[0]["activeMembers"], 2, "universe should report active member count")

        with runtime_store.open_runtime_store() as connection:
            run_row = connection.execute(
                """
                SELECT
                    universe_id,
                    symbol_count,
                    success_count,
                    failure_count
                FROM market_collection_runs
                """
            ).fetchone()
        assert_equal(run_row["universe_id"], "test-core", "collection run should persist universe id")
        assert_equal(run_row["symbol_count"], 2, "run should persist symbol count")
        assert_equal(run_row["success_count"], 2, "run should persist success count")
        assert_equal(run_row["failure_count"], 0, "run should persist failure count")


def test_exchange_symbol_master_refresh_marks_missing_members_inactive():
    with isolated_runtime_store():
        original_fetch_exchange_symbols = market_collector.finnhub.fetch_exchange_symbols
        snapshots = [
            [
                {
                    "symbol": "AAPL",
                    "displaySymbol": "AAPL",
                    "description": "Apple Inc",
                    "type": "Common Stock",
                    "mic": "XNAS",
                    "currency": "USD",
                },
                {
                    "symbol": "MSFT",
                    "displaySymbol": "MSFT",
                    "description": "Microsoft Corp",
                    "type": "Common Stock",
                    "mic": "XNAS",
                    "currency": "USD",
                },
            ],
            [
                {
                    "symbol": "AAPL",
                    "displaySymbol": "AAPL",
                    "description": "Apple Inc",
                    "type": "Common Stock",
                    "mic": "XNAS",
                    "currency": "USD",
                },
            ],
        ]

        def fake_fetch_exchange_symbols(exchange, *, mic=None):
            del exchange, mic
            return snapshots.pop(0)

        market_collector.finnhub.fetch_exchange_symbols = fake_fetch_exchange_symbols
        try:
            first_members = market_collector.sync_exchange_symbol_universe(
                "us-all",
                "US All",
                exchange="US",
            )
            second_members = market_collector.sync_exchange_symbol_universe(
                "us-all",
                "US All",
                exchange="US",
            )
        finally:
            market_collector.finnhub.fetch_exchange_symbols = original_fetch_exchange_symbols

        assert_equal(len(first_members), 2, "first exchange refresh should persist both members")
        assert_equal(len(second_members), 2, "inactive members should remain queryable in the full sync response")

        active_members = runtime_store.load_symbol_universe_members("us-all")
        all_members = runtime_store.load_symbol_universe_members("us-all", include_inactive=True)
        assert_equal(len(active_members), 1, "only AAPL should remain active after replace refresh")
        assert_equal(active_members[0]["symbol"], "AAPL", "AAPL should remain active")
        inactive_msft = next(member for member in all_members if member["symbol"] == "MSFT")
        assert_equal(inactive_msft["isActive"], False, "missing exchange members should be marked inactive")


def main():
    test_collect_market_universe_uses_provider_order_and_records_run()
    test_exchange_symbol_master_refresh_marks_missing_members_inactive()
    print("ok market collector")


if __name__ == "__main__":
    main()
