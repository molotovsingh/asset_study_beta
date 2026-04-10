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


def test_normalized_store_full_and_incremental_merge():
    with isolated_runtime_store():
        full_snapshot = runtime_store.write_price_history(
            "abc",
            [
                {
                    "date": "2024-01-01",
                    "open": 99,
                    "high": 101,
                    "low": 98,
                    "close": 100,
                    "adjClose": 95,
                    "volume": 1000,
                },
                {
                    "date": "2024-01-02",
                    "open": 100,
                    "high": 103,
                    "low": 99,
                    "close": 102,
                    "adjClose": 97,
                    "volume": 1100,
                },
            ],
            [{"date": "2024-01-02", "actionType": "split", "value": 2}],
            currency="usd",
            sync_mode="full",
            replace=True,
        )

        assert_equal(full_snapshot["symbol"], "ABC", "symbols should normalize")
        assert_equal(full_snapshot["currency"], "USD", "currency should normalize")
        assert_equal(full_snapshot["range"]["observations"], 2, "full observation count")
        assert_equal(
            full_snapshot["syncState"]["lastSyncMode"],
            "full",
            "full sync mode should be recorded",
        )

        merged_snapshot = runtime_store.write_price_history(
            "ABC",
            [
                {
                    "date": "2024-01-02",
                    "open": 100,
                    "high": 104,
                    "low": 99,
                    "close": 102,
                    "adjClose": 97,
                    "volume": 1100,
                },
                {
                    "date": "2024-01-03",
                    "open": 102,
                    "high": 106,
                    "low": 101,
                    "close": 105,
                    "adjClose": 100,
                    "volume": 1200,
                },
            ],
            [{"date": "2024-01-02", "actionType": "split", "value": 2}],
            currency="USD",
            sync_mode="incremental",
            replace=False,
            action_window=("2024-01-02", "2024-01-03"),
        )

        assert_equal(merged_snapshot["range"]["observations"], 3, "merged observation count")
        assert_equal(
            merged_snapshot["points"][-1],
            ["2024-01-03", 105.0],
            "latest close should be appended",
        )
        assert_equal(
            merged_snapshot["syncState"]["lastSyncMode"],
            "incremental",
            "incremental sync mode should be recorded",
        )
        actions = runtime_store.load_corporate_actions("ABC")
        assert_equal(len(actions), 1, "split action should remain after overlap rewrite")
        assert_equal(actions[0]["actionType"], "split", "stored action type")


def test_legacy_series_cache_migrates_to_normalized_rows():
    with isolated_runtime_store():
        runtime_store.ensure_runtime_store()
        with runtime_store.open_runtime_store() as connection:
            runtime_store.upsert_cached_snapshot(
                connection,
                {
                    "cacheKey": "legacy-key",
                    "symbol": "LEG",
                    "generatedAt": "2024-01-10T00:00:00+00:00",
                    "currency": "USD",
                    "sourceSeriesType": "Price",
                    "range": {
                        "startDate": "2024-01-01",
                        "endDate": "2024-01-02",
                        "observations": 2,
                    },
                    "points": [["2024-01-01", 10], ["2024-01-02", 11]],
                },
            )
            connection.commit()

        runtime_store._RUNTIME_STORE_READY = False
        runtime_store.ensure_runtime_store()
        migrated = runtime_store.load_cached_series("LEG")

        assert migrated is not None
        assert_equal(migrated["points"], [["2024-01-01", 10.0], ["2024-01-02", 11.0]], "migrated points")
        assert_equal(
            migrated["syncState"]["lastSyncMode"],
            "legacy",
            "legacy migration should force a broad refresh later",
        )


def test_overlap_validation_detects_price_and_action_changes():
    valid, _message = dev_server.validate_price_overlap(
        [{"date": "2024-01-01", "close": 100.0}],
        [{"date": "2024-01-01", "close": 100.00000001}],
    )
    assert_equal(valid, True, "tiny price differences should pass")

    valid, _message = dev_server.validate_price_overlap(
        [{"date": "2024-01-01", "close": 100.0}],
        [{"date": "2024-01-01", "close": 101.0}],
    )
    assert_equal(valid, False, "material price differences should fail")

    valid, _message = dev_server.validate_price_overlap(
        [
            {"date": "2024-01-01", "close": 100.0},
            {"date": "2024-01-02", "close": 101.0},
        ],
        [{"date": "2024-01-01", "close": 100.0}],
    )
    assert_equal(valid, False, "missing cached dates should fail")

    valid, _message = dev_server.validate_action_overlap(
        [{"date": "2024-01-01", "actionType": "split", "value": 2}],
        [{"date": "2024-01-01", "actionType": "split", "value": 3}],
    )
    assert_equal(valid, False, "changed corporate actions should fail")


def mark_cached_series_stale(symbol: str) -> None:
    with runtime_store.open_runtime_store() as connection:
        symbol_row = connection.execute(
            "SELECT symbol_id FROM symbols WHERE symbol = ?",
            (runtime_store.normalize_symbol(symbol),),
        ).fetchone()
        if symbol_row is None:
            raise AssertionError(f"missing cached symbol {symbol}")

        connection.execute(
            """
            UPDATE sync_state
            SET last_checked_at = ?
            WHERE symbol_id = ?
            """,
            ("2000-01-01T00:00:00+00:00", symbol_row["symbol_id"]),
        )
        connection.execute(
            """
            UPDATE series_cache
            SET generated_at = ?
            WHERE symbol = ?
            """,
            ("2000-01-01T00:00:00+00:00", runtime_store.normalize_symbol(symbol)),
        )
        connection.commit()


def test_get_or_refresh_uses_full_then_incremental_then_rebuild():
    original_full_fetch = dev_server.fetch_full_symbol_history
    original_incremental_fetch = dev_server.fetch_symbol_history

    full_payloads = [
        (
            [
                {"date": "2020-01-01", "close": 10},
                {"date": "2020-01-02", "close": 11},
                {"date": "2020-01-03", "close": 12},
            ],
            [],
            "USD",
            "max",
        ),
        (
            [
                {"date": "2020-01-01", "close": 10},
                {"date": "2020-01-02", "close": 11},
                {"date": "2020-01-03", "close": 12},
                {"date": "2020-01-04", "close": 13},
                {"date": "2020-01-05", "close": 14},
            ],
            [],
            "USD",
            "max",
        ),
    ]
    incremental_payloads = [
        (
            [
                {"date": "2020-01-01", "close": 10},
                {"date": "2020-01-02", "close": 11},
                {"date": "2020-01-03", "close": 12},
                {"date": "2020-01-04", "close": 13},
            ],
            [],
            "USD",
        ),
        (
            [
                {"date": "2020-01-02", "close": 99},
                {"date": "2020-01-03", "close": 12},
                {"date": "2020-01-04", "close": 13},
            ],
            [],
            "USD",
        ),
    ]

    def fake_full_fetch(_symbol):
        return full_payloads.pop(0)

    def fake_incremental_fetch(_symbol, **_kwargs):
        return incremental_payloads.pop(0)

    dev_server.fetch_full_symbol_history = fake_full_fetch
    dev_server.fetch_symbol_history = fake_incremental_fetch
    try:
        with isolated_runtime_store():
            snapshot, status = dev_server.get_or_refresh_cached_series("XYZ")
            assert_equal(status, "refreshed", "first run should full-refresh")
            assert_equal(snapshot["points"][0], ["2020-01-01", 10.0], "first full point")

            snapshot, status = dev_server.get_or_refresh_cached_series("XYZ")
            assert_equal(status, "hit", "fresh broad cache should be reused")
            assert_equal(snapshot["range"]["observations"], 3, "fresh hit range")

            mark_cached_series_stale("XYZ")
            snapshot, status = dev_server.get_or_refresh_cached_series("XYZ")
            assert_equal(status, "incremental", "clean stale cache should increment")
            assert_equal(snapshot["range"]["observations"], 4, "incremental range")

            mark_cached_series_stale("XYZ")
            snapshot, status = dev_server.get_or_refresh_cached_series("XYZ")
            assert_equal(status, "rebuilt", "overlap mismatch should rebuild")
            assert_equal(snapshot["range"]["observations"], 5, "rebuilt range")
    finally:
        dev_server.fetch_full_symbol_history = original_full_fetch
        dev_server.fetch_symbol_history = original_incremental_fetch


def main() -> int:
    test_normalized_store_full_and_incremental_merge()
    test_legacy_series_cache_migrates_to_normalized_rows()
    test_overlap_validation_detects_price_and_action_changes()
    test_get_or_refresh_uses_full_then_incremental_then_rebuild()
    print("ok runtime store cache")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
