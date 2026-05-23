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
from server import fundamentals_collector  # noqa: E402


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


def fake_metric_payload(symbol: str) -> dict:
    return {
        "symbol": symbol,
        "metricType": "all",
        "metric": {
            "marketCapitalization": 1234.5,
            "52WeekHighDate": "2026-05-01",
        },
        "series": {
            "annual": {
                "eps": [
                    {"period": "2025-12-31", "v": 11.1},
                    {"period": "2024-12-31", "v": 9.9},
                ],
            },
            "quarterly": {
                "revenuePerShare": [
                    {"period": "2026-03-31", "v": 25.5},
                    {"period": "2025-12-31", "v": 24.0},
                    {"period": "2024-03-31", "v": 20.0},
                ],
            },
        },
    }


def test_manual_fundamental_collection_persists_metrics_and_run():
    with isolated_runtime_store():
        original_fetch = fundamentals_collector.finnhub.fetch_basic_financials

        def fake_fetch(symbol, *, metric="all"):
            assert_equal(metric, "all", "collector should request all Finnhub metrics")
            return fake_metric_payload(symbol)

        fundamentals_collector.finnhub.fetch_basic_financials = fake_fetch
        try:
            summary = fundamentals_collector.collect_fundamental_universe(
                "test-fundamentals",
                universe_label="Test Fundamentals",
                symbols=["AAPL", "MSFT"],
                period_days=366,
            )
        finally:
            fundamentals_collector.finnhub.fetch_basic_financials = original_fetch

        assert_equal(summary["symbolCount"], 2, "run should count active symbols")
        assert_equal(summary["successCount"], 2, "both symbols should collect")
        assert_equal(summary["failureCount"], 0, "no failures expected")
        assert_equal(summary["collected"][0]["provider"], "finnhub", "provider should persist")
        assert_true(summary["collected"][0]["snapshotId"] > 0, "snapshot id should be returned")

        universes = runtime_store.list_fundamental_universes()
        assert_equal(universes[0]["universeId"], "test-fundamentals", "universe should persist")
        assert_equal(universes[0]["activeMembers"], 2, "active member count should persist")

        snapshots = runtime_store.load_fundamental_snapshots(
            universe_id="test-fundamentals",
            symbol="AAPL",
        )
        assert_equal(len(snapshots), 1, "one AAPL snapshot should be stored")
        metrics = runtime_store.load_fundamental_metrics(snapshots[0]["snapshotId"])
        metric_keys = {
            (metric["metricName"], metric["periodType"], metric["periodEndDate"])
            for metric in metrics
        }
        assert_true(("marketCapitalization", "snapshot", summary["asOfDate"]) in metric_keys, "snapshot metric should persist")
        assert_true(("eps", "annual", "2025-12-31") in metric_keys, "recent annual metric should persist")
        assert_true(("revenuePerShare", "quarterly", "2026-03-31") in metric_keys, "recent quarterly metric should persist")
        assert_true(("revenuePerShare", "quarterly", "2024-03-31") not in metric_keys, "old quarterly metric should be filtered")

        with runtime_store.open_runtime_store() as connection:
            run_row = connection.execute(
                "SELECT universe_id, success_count, failure_count FROM fundamental_collection_runs"
            ).fetchone()
        assert_equal(run_row["universe_id"], "test-fundamentals", "collection run should persist")
        assert_equal(run_row["success_count"], 2, "success count should persist")
        assert_equal(run_row["failure_count"], 0, "failure count should persist")


def test_sp500_seed_and_same_day_collection_is_idempotent():
    with isolated_runtime_store():
        original_constituents = fundamentals_collector.finnhub.fetch_index_constituents
        original_fetch = fundamentals_collector.finnhub.fetch_basic_financials

        def fake_constituents(symbol):
            assert_equal(symbol, fundamentals_collector.SP500_INDEX_SYMBOL, "S&P source symbol")
            return {
                "symbol": symbol,
                "asOfDate": "2026-05-14",
                "members": [
                    {
                        "symbol": "AAPL",
                        "providerSymbol": "AAPL",
                        "label": "Apple Inc",
                        "weight": 7.1,
                        "sourceProvider": "finnhub",
                        "metadata": {"symbol": "AAPL"},
                    },
                ],
            }

        fundamentals_collector.finnhub.fetch_index_constituents = fake_constituents
        fundamentals_collector.finnhub.fetch_basic_financials = lambda symbol, *, metric="all": fake_metric_payload(symbol)
        try:
            first = fundamentals_collector.collect_fundamental_universe(
                fundamentals_collector.SP500_UNIVERSE_ID,
                seed_builtin=True,
                limit=1,
            )
            second = fundamentals_collector.collect_fundamental_universe(
                fundamentals_collector.SP500_UNIVERSE_ID,
                seed_builtin=False,
                limit=1,
            )
        finally:
            fundamentals_collector.finnhub.fetch_index_constituents = original_constituents
            fundamentals_collector.finnhub.fetch_basic_financials = original_fetch

        assert_equal(first["seed"]["memberCount"], 1, "seed should persist one constituent")
        assert_equal(first["successCount"], 1, "first collection should succeed")
        assert_equal(second["successCount"], 1, "second collection should succeed")
        snapshots = runtime_store.load_fundamental_snapshots(
            universe_id=fundamentals_collector.SP500_UNIVERSE_ID,
            symbol="AAPL",
            limit=10,
        )
        assert_equal(len(snapshots), 1, "same-day collection should update the snapshot instead of duplicating")

        members = runtime_store.load_fundamental_universe_members(fundamentals_collector.SP500_UNIVERSE_ID)
        assert_equal(members[0]["providerSymbol"], "AAPL", "provider symbol should persist")
        assert_equal(members[0]["weight"], 7.1, "constituent weight should persist")


def test_nifty500_seed_maps_symbols_to_finnhub_ns_suffix():
    with isolated_runtime_store():
        original_download = fundamentals_collector._download_text

        def fake_download(_url):
            return (
                "Company Name,Industry,Symbol,Series,ISIN Code\n"
                "Reliance Industries Ltd.,Oil Gas & Consumable Fuels,RELIANCE,EQ,INE002A01018\n"
            )

        fundamentals_collector._download_text = fake_download
        try:
            summary = fundamentals_collector.seed_nifty500_universe()
        finally:
            fundamentals_collector._download_text = original_download

        assert_equal(summary["memberCount"], 1, "Nifty seed member count")
        members = runtime_store.load_fundamental_universe_members(fundamentals_collector.NIFTY500_UNIVERSE_ID)
        assert_equal(members[0]["symbol"], "RELIANCE.NS", "Nifty symbols should map to Finnhub .NS")
        assert_equal(members[0]["providerSymbol"], "RELIANCE.NS", "provider symbol should use .NS")
        assert_equal(members[0]["isin"], "INE002A01018", "ISIN should persist")


def main() -> int:
    test_manual_fundamental_collection_persists_metrics_and_run()
    test_sp500_seed_and_same_day_collection_is_idempotent()
    test_nifty500_seed_maps_symbols_to_finnhub_ns_suffix()
    print("ok fundamentals collector")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
