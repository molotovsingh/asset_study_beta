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
from providers.yfinance_provider import OptionContractNotMarkableError  # noqa: E402
from server import automation_service, maintenance_service, options_service, routes as server_routes  # noqa: E402


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


def test_facade_refresh_marks_respects_patched_exact_quote_fetcher():
    with isolated_runtime_store():
        position = runtime_store.upsert_tracked_option_position(
            {
                "sourceRunId": 1,
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

        original_fetcher = options_service.fetch_exact_contract_quote

        def fake_fetcher(_symbol, *, expiry, strike):
            raise OptionContractNotMarkableError(
                f"The exact AAPL {expiry} {strike:g} straddle is not markable from the current chain.",
            )

        options_service.fetch_exact_contract_quote = fake_fetcher
        try:
            summary = options_service.refresh_open_tracked_option_marks(as_of_date="2026-04-14")
        finally:
            options_service.fetch_exact_contract_quote = original_fetcher

        marks = runtime_store.load_tracked_option_marks(position_id=position["positionId"], limit=10)
        assert_equal(summary["missingMarks"], 1, "facade should route patched fetcher into mark refresh")
        assert_equal(len(marks), 1, "missing quote should persist one mark row")
        assert_equal(marks[0]["markStatus"], "missing", "missing quote should keep missing status")
        assert_true("not markable" in str(marks[0]["reason"]), "provider reason should round-trip")


def test_facade_collector_universe_patch_is_visible_to_services():
    original_universes = options_service.COLLECTOR_UNIVERSES
    patched_universes = {
        "patched": {
            "universeId": "patched",
            "universeLabel": "Patched Universe",
            "minimumDte": 7,
            "maxContracts": 1,
            "symbols": ["AAPL"],
        }
    }
    options_service.COLLECTOR_UNIVERSES = patched_universes
    try:
        assert_equal(
            maintenance_service._normalize_options_universe_ids(None),
            ["patched"],
            "maintenance service should read the facade universe registry",
        )
        with isolated_runtime_store():
            state = automation_service.build_automation_state_payload()
        assert_equal(
            state["catalogs"]["optionsUniverses"][0]["universeId"],
            "patched",
            "automation service should read the facade universe registry",
        )
    finally:
        options_service.COLLECTOR_UNIVERSES = original_universes


def test_facade_payload_builder_patch_is_visible_to_routes():
    original_builder = options_service.build_trade_validation_response

    def fake_builder(request):
        return {"validationType": "trade", "routeRequest": request, "patched": True}

    options_service.build_trade_validation_response = fake_builder
    try:
        payload = server_routes.dispatch_request(
            "POST",
            "/api/options/trade-validation",
            {"universeId": "patched", "horizon": "5D"},
        )
    finally:
        options_service.build_trade_validation_response = original_builder

    assert_equal(payload["patched"], True, "route dispatch should still go through the facade module")
    assert_equal(
        payload["routeRequest"],
        {"universeId": "patched", "horizon": "5D"},
        "patched facade builder should receive the route body",
    )


def main():
    test_facade_refresh_marks_respects_patched_exact_quote_fetcher()
    test_facade_collector_universe_patch_is_visible_to_services()
    test_facade_payload_builder_patch_is_visible_to_routes()
    print("ok options service facade")


if __name__ == "__main__":
    main()
