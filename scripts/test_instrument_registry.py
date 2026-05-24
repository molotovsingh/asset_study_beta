#!/usr/bin/env python3

from __future__ import annotations

import sqlite3
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import runtime_store  # noqa: E402
from server import instrument_service  # noqa: E402


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


def count_rows(table_name: str) -> int:
    with runtime_store.open_runtime_store() as connection:
        row = connection.execute(f"SELECT COUNT(*) AS row_count FROM {table_name}").fetchone()
    return int(row["row_count"])


def test_registry_schema_initializes_without_touching_legacy_tables():
    with isolated_runtime_store():
        runtime_store.ensure_runtime_store()
        with runtime_store.open_runtime_store() as connection:
            tables = {
                row["name"]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'",
                )
            }

        assert_true("instruments" in tables, "registry instruments table should exist")
        assert_true(
            "instrument_provider_mappings" in tables,
            "provider mapping table should exist",
        )
        assert_true(
            "instrument_discovery_events" in tables,
            "discovery event table should exist",
        )
        assert_true("instrument_aliases" in tables, "alias table should exist")
        assert_true("remembered_datasets" in tables, "legacy remembered table should remain")
        assert_true("symbol_universes" in tables, "legacy universe table should remain")


def test_discovery_ranks_builtin_alias_and_records_event():
    with isolated_runtime_store():
        payload = instrument_service.build_symbol_discovery_payload(
            {"query": "nifty energy", "limit": 5},
        )

        assert_equal(
            payload["version"],
            "instrument-discovery-v1",
            "discovery payload version",
        )
        assert_true(payload["results"], "discovery should return candidates")
        top_result = payload["results"][0]
        assert_equal(top_result["label"], "Nifty Energy", "top label")
        assert_equal(top_result["symbol"], "^CNXENERGY", "top yfinance symbol")
        assert_equal(top_result["assetClass"], "index", "top asset class")
        assert_equal(top_result["verified"], True, "built-in mapping should be verified")
        assert_equal(
            top_result["capabilities"]["priceHistory"],
            True,
            "built-in yfinance mapping should expose price history",
        )
        assert_equal(
            count_rows("instrument_discovery_events"),
            1,
            "discovery should record one event",
        )


def test_discovery_ranks_builtin_crypto_and_exposes_crypto_history():
    with isolated_runtime_store():
        payload = instrument_service.build_symbol_discovery_payload(
            {"query": "BTC-USD", "limit": 5},
        )

        assert_true(payload["results"], "BTC-USD should produce a local crypto suggestion")
        top_result = payload["results"][0]
        assert_equal(top_result["label"], "Bitcoin USD", "top crypto label")
        assert_equal(top_result["symbol"], "BTC-USD", "top crypto yfinance symbol")
        assert_equal(top_result["assetClass"], "crypto", "top crypto asset class")
        assert_equal(top_result["verified"], True, "built-in crypto mapping should be verified")
        assert_equal(
            top_result["capabilities"]["cryptoHistory"],
            True,
            "built-in crypto mapping should expose crypto history",
        )


def test_discovery_prefers_verified_crypto_over_legacy_exact_symbol_duplicate():
    with isolated_runtime_store():
        runtime_store.ensure_runtime_store()
        capabilities_json = (
            '{"cryptoHistory":false,"fundamentals":false,"optionContract":false,'
            '"optionsUnderlying":false,"priceHistory":true,"profile":false}'
        )
        with runtime_store.open_runtime_store() as connection:
            cursor = connection.execute(
                """
                INSERT INTO instruments (
                    canonical_key,
                    canonical_symbol,
                    display_label,
                    asset_class,
                    currency,
                    status,
                    verification_status,
                    metadata_json,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "equity|eth-usd|||",
                    "ETH-USD",
                    "Ethereum USD",
                    "equity",
                    "USD",
                    "legacy",
                    "legacy",
                    '{"source":"legacy-runtime-symbol"}',
                    "2026-05-22T00:00:00+00:00",
                    "2026-05-22T00:00:00+00:00",
                ),
            )
            legacy_instrument_id = int(cursor.lastrowid)
            connection.execute(
                """
                INSERT INTO instrument_provider_mappings (
                    instrument_id,
                    provider,
                    provider_symbol,
                    provider_name,
                    asset_class,
                    currency,
                    capabilities_json,
                    verification_status,
                    last_checked_at,
                    metadata_json,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    legacy_instrument_id,
                    "yfinance",
                    "ETH-USD",
                    "Yahoo Finance",
                    "equity",
                    "USD",
                    capabilities_json,
                    "legacy",
                    "2026-05-22T00:00:00+00:00",
                    '{"source":"legacy-runtime-symbol"}',
                    "2026-05-22T00:00:00+00:00",
                    "2026-05-22T00:00:00+00:00",
                ),
            )
            connection.execute(
                """
                INSERT INTO instrument_aliases (
                    instrument_id,
                    alias,
                    normalized_alias,
                    source,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    legacy_instrument_id,
                    "ETH-USD",
                    "eth-usd",
                    "legacy",
                    "2026-05-22T00:00:00+00:00",
                ),
            )
            connection.commit()

        payload = instrument_service.build_symbol_discovery_payload(
            {"query": "ETH-USD", "limit": 5},
        )

        assert_true(payload["results"], "ETH-USD should produce a crypto suggestion")
        top_result = payload["results"][0]
        assert_equal(
            top_result["assetClass"],
            "crypto",
            "verified crypto mapping should outrank legacy exact-symbol duplicates",
        )
        assert_equal(top_result["verified"], True, "top ETH-USD result should be verified")
        assert_equal(
            top_result["capabilities"]["cryptoHistory"],
            True,
            "top ETH-USD result should expose crypto history",
        )


def test_legacy_price_symbols_migrate_as_legacy_registry_entries():
    with isolated_runtime_store():
        runtime_store.ensure_runtime_store()
        with runtime_store.open_runtime_store() as connection:
            connection.execute(
                """
                INSERT INTO symbols (
                    symbol,
                    provider,
                    currency,
                    source_series_type,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    "LEGACY",
                    "yfinance",
                    "USD",
                    "Price",
                    "2026-05-23T00:00:00+00:00",
                    "2026-05-23T00:00:00+00:00",
                ),
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
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    "ETH-USD",
                    "yfinance",
                    "USD",
                    "Price",
                    "2026-05-23T00:00:00+00:00",
                    "2026-05-23T00:00:00+00:00",
                ),
            )
            connection.commit()
        runtime_store._RUNTIME_STORE_READY = False
        runtime_store.ensure_runtime_store()
        with runtime_store.open_runtime_store() as connection:
            instrument_row = connection.execute(
                """
                SELECT verification_status
                FROM instruments
                WHERE canonical_symbol = ?
                """,
                ("LEGACY",),
            ).fetchone()
            mapping_row = connection.execute(
                """
                SELECT verification_status, capabilities_json
                FROM instrument_provider_mappings
                WHERE provider_symbol = ?
                """,
                ("LEGACY",),
            ).fetchone()
            crypto_instrument_row = connection.execute(
                """
                SELECT asset_class
                FROM instruments
                WHERE canonical_symbol = ?
                """,
                ("ETH-USD",),
            ).fetchone()
            crypto_mapping_row = connection.execute(
                """
                SELECT capabilities_json
                FROM instrument_provider_mappings
                WHERE provider_symbol = ?
                """,
                ("ETH-USD",),
            ).fetchone()

        assert_true(instrument_row is not None, "legacy price symbol should migrate")
        assert_equal(
            instrument_row["verification_status"],
            "legacy",
            "legacy migration should not pretend fresh verification",
        )
        assert_true(mapping_row is not None, "legacy provider mapping should migrate")
        assert_equal(
            mapping_row["verification_status"],
            "legacy",
            "legacy provider mapping should retain legacy status",
        )
        assert_true(
            '"priceHistory":true' in mapping_row["capabilities_json"],
            "legacy provider mapping should preserve known history capability",
        )
        assert_true(crypto_instrument_row is not None, "legacy crypto symbol should migrate")
        assert_equal(
            crypto_instrument_row["asset_class"],
            "crypto",
            "legacy yfinance crypto symbols should migrate as crypto",
        )
        assert_true(
            '"cryptoHistory":true' in crypto_mapping_row["capabilities_json"],
            "legacy crypto mappings should expose crypto history capability",
        )


def test_successful_price_history_write_updates_verified_registry_mapping():
    with isolated_runtime_store():
        runtime_store.write_price_history(
            "AAPL",
            [
                {"date": "2025-01-01", "close": 10},
                {"date": "2025-01-02", "close": 11},
            ],
            [],
            currency="USD",
            provider="yfinance",
            sync_mode="full",
            replace=True,
        )
        with runtime_store.open_runtime_store() as connection:
            mapping_row = connection.execute(
                """
                SELECT verification_status, capabilities_json
                FROM instrument_provider_mappings
                WHERE provider = ? AND provider_symbol = ?
                """,
                ("yfinance", "AAPL"),
            ).fetchone()

        assert_true(mapping_row is not None, "price-history write should update the registry")
        assert_equal(
            mapping_row["verification_status"],
            "verified",
            "successful provider write should be verified evidence",
        )
        assert_true(
            '"priceHistory":true' in mapping_row["capabilities_json"],
            "successful provider write should expose priceHistory capability",
        )


def test_price_history_verification_persists_mapping_and_blocks_fake_symbol():
    original_loader = instrument_service.index_service.get_or_refresh_cached_series

    def fake_loader(symbol, *, preferred_provider=None):
        normalized = str(symbol or "").strip().upper()
        if normalized != "AAPL":
            raise RuntimeError("No usable price history found.")
        return (
            {
                "symbol": "AAPL",
                "provider": preferred_provider or "yfinance",
                "providerName": "Yahoo Finance (yfinance)",
                "currency": "USD",
                "generatedAt": "2026-05-23T00:00:00+00:00",
                "range": {
                    "startDate": "2025-01-01",
                    "endDate": "2025-01-02",
                    "observations": 2,
                },
                "cacheKey": "aapl-test",
            },
            "refreshed",
        )

    instrument_service.index_service.get_or_refresh_cached_series = fake_loader
    try:
        with isolated_runtime_store():
            payload = instrument_service.build_symbol_verification_payload(
                {
                    "query": "AAPL",
                    "label": "Apple Inc",
                    "requiredCapability": "priceHistory",
                },
            )
            fake_payload = instrument_service.build_symbol_verification_payload(
                {
                    "query": "ZZZNOTREAL123",
                    "requiredCapability": "priceHistory",
                },
            )

            assert_equal(payload["version"], "instrument-verification-v1", "verification version")
            assert_equal(payload["verified"], True, "AAPL should verify")
            assert_equal(payload["instrument"]["label"], "Apple Inc", "verified label")
            assert_equal(payload["capabilities"]["priceHistory"], True, "price history capability")
            assert_equal(payload["mapping"]["provider"], "yfinance", "mapping provider")

            with runtime_store.open_runtime_store() as connection:
                mapping_row = connection.execute(
                    """
                    SELECT capabilities_json
                    FROM instrument_provider_mappings
                    WHERE provider = ? AND provider_symbol = ?
                    """,
                    ("yfinance", "AAPL"),
                ).fetchone()

            assert_true(mapping_row is not None, "verified provider mapping should persist")
            assert_equal(fake_payload["verified"], False, "fake symbol should not verify")
            assert_equal(
                fake_payload["capabilities"]["priceHistory"],
                False,
                "fake symbol should not claim price history",
            )
            assert_true(
                "No usable price history found." in fake_payload["failureReason"],
                "fake failure should explain missing capability",
            )
            assert_equal(
                count_rows("instrument_discovery_events"),
                2,
                "verification attempts should be evented",
            )
    finally:
        instrument_service.index_service.get_or_refresh_cached_series = original_loader


def test_manual_registration_requires_successful_verification():
    original_loader = instrument_service.index_service.get_or_refresh_cached_series

    def fake_loader(symbol, *, preferred_provider=None):
        normalized = str(symbol or "").strip().upper()
        if normalized != "^CNXOILGAS":
            raise RuntimeError("No usable price history found.")
        return (
            {
                "symbol": "^CNXOILGAS",
                "provider": preferred_provider or "yfinance",
                "providerName": "Yahoo Finance (yfinance)",
                "currency": "INR",
                "generatedAt": "2026-05-23T00:00:00+00:00",
                "range": {
                    "startDate": "2025-01-01",
                    "endDate": "2025-01-02",
                    "observations": 2,
                },
                "cacheKey": "cnxoilgas-test",
            },
            "cached",
        )

    instrument_service.index_service.get_or_refresh_cached_series = fake_loader
    try:
        with isolated_runtime_store():
            payload = instrument_service.build_manual_symbol_registration_payload(
                {
                    "label": "Nifty Oil & Gas",
                    "symbol": "^CNXOILGAS",
                    "requiredCapability": "priceHistory",
                },
            )

            assert_equal(payload["verified"], True, "manual symbol should verify before saving")
            assert_equal(
                payload["selection"]["subjectQuery"],
                "Nifty Oil & Gas | ^CNXOILGAS",
                "manual selection should preserve label and symbol",
            )
            with runtime_store.open_runtime_store() as connection:
                alias_row = connection.execute(
                    """
                    SELECT alias
                    FROM instrument_aliases
                    WHERE alias = ? AND source = ?
                    """,
                    ("nifty oil & gas", "manual"),
                ).fetchone()

            assert_true(alias_row is not None, "manual label should persist as an alias")
    finally:
        instrument_service.index_service.get_or_refresh_cached_series = original_loader


def main() -> int:
    test_registry_schema_initializes_without_touching_legacy_tables()
    test_discovery_ranks_builtin_alias_and_records_event()
    test_discovery_ranks_builtin_crypto_and_exposes_crypto_history()
    test_discovery_prefers_verified_crypto_over_legacy_exact_symbol_duplicate()
    test_legacy_price_symbols_migrate_as_legacy_registry_entries()
    test_successful_price_history_write_updates_verified_registry_mapping()
    test_price_history_verification_persists_mapping_and_blocks_fake_symbol()
    test_manual_registration_requires_successful_verification()
    print("ok instrument registry")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
