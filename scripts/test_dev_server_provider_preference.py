#!/usr/bin/env python3

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import dev_server  # noqa: E402
from providers.base import HistoryResult  # noqa: E402


def assert_equal(actual, expected, message):
    if actual != expected:
        raise AssertionError(f"{message}: expected {expected!r}, got {actual!r}")


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


def test_preferred_provider_switch_rebuilds_fresh_cache():
    original_load_cached_series = dev_server.load_cached_series
    original_cache_is_fresh = dev_server.cache_is_fresh
    original_snapshot_requires_full_sync = dev_server.snapshot_requires_full_sync
    original_fetch_full_symbol_history_result = dev_server.fetch_full_symbol_history_result
    original_write_price_history = dev_server.write_price_history

    calls: list[tuple[str, object]] = []

    def fake_load_cached_series(_symbol):
        return {
            "symbol": "XLF",
            "provider": "yfinance",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "range": {"endDate": "2026-04-11"},
            "syncState": {"lastSyncMode": "full"},
            "currency": "USD",
        }

    def fake_fetch_full(symbol, *, preferred_provider=None):
        calls.append(("fetch_full", preferred_provider))
        return (
            HistoryResult(
                provider="yahoo_finance15",
                provider_name="Yahoo Finance 15 (RapidAPI)",
                price_rows=[
                    {"date": "2026-04-10", "close": 100},
                    {"date": "2026-04-11", "close": 101},
                ],
                action_rows=[],
                currency="USD",
                coverage_note="Fallback provider returned its default daily history window.",
            ),
            "period=max",
        )

    def fake_write_price_history(
        symbol,
        price_rows,
        action_rows,
        *,
        currency=None,
        source_series_type=None,
        provider=None,
        sync_mode=None,
        sync_status=None,
        sync_message=None,
        replace=None,
        overlap_hash=None,
        actions_hash=None,
        action_window=None,
    ):
        del action_rows, source_series_type, overlap_hash, actions_hash, action_window
        calls.append(("write", provider, sync_mode, replace))
        return {
            "symbol": symbol,
            "provider": provider,
            "providerName": "Yahoo Finance 15 (RapidAPI)",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "range": {
                "endDate": price_rows[-1]["date"],
            },
            "syncState": {
                "lastSyncMode": sync_mode,
                "lastSyncStatus": sync_status,
                "lastSyncMessage": sync_message,
            },
            "currency": currency,
        }

    dev_server.load_cached_series = fake_load_cached_series
    dev_server.cache_is_fresh = lambda _snapshot: True
    dev_server.snapshot_requires_full_sync = lambda _snapshot: False
    dev_server.fetch_full_symbol_history_result = fake_fetch_full
    dev_server.write_price_history = fake_write_price_history
    try:
        snapshot, cache_status = dev_server.get_or_refresh_cached_series(
            "XLF",
            preferred_provider="yahoo_finance15",
        )
    finally:
        dev_server.load_cached_series = original_load_cached_series
        dev_server.cache_is_fresh = original_cache_is_fresh
        dev_server.snapshot_requires_full_sync = original_snapshot_requires_full_sync
        dev_server.fetch_full_symbol_history_result = original_fetch_full_symbol_history_result
        dev_server.write_price_history = original_write_price_history

    assert_equal(cache_status, "provider-switch", "provider switch should report a dedicated cache status")
    assert_equal(snapshot["provider"], "yahoo_finance15", "rebuilt snapshot should use the preferred provider")
    assert_equal(calls[0], ("fetch_full", "yahoo_finance15"), "full fetch should use the preferred provider")
    assert_equal(calls[1], ("write", "yahoo_finance15", "full", True), "provider switch should fully replace cached rows")
    assert_true(
        "Preferred provider switched from Yahoo Finance (yfinance) to Yahoo Finance 15 (RapidAPI)." in snapshot["syncState"]["lastSyncMessage"],
        "sync message should explain the provider switch",
    )


def test_matching_preferred_provider_keeps_cache_hit():
    original_load_cached_series = dev_server.load_cached_series
    original_cache_is_fresh = dev_server.cache_is_fresh
    original_snapshot_requires_full_sync = dev_server.snapshot_requires_full_sync
    original_ensure_snapshot_currency = dev_server.ensure_snapshot_currency
    original_fetch_full_symbol_history_result = dev_server.fetch_full_symbol_history_result

    cached_snapshot = {
        "symbol": "XLF",
        "provider": "yahoo_finance15",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "range": {"endDate": "2026-04-11"},
        "syncState": {"lastSyncMode": "full"},
        "currency": "USD",
    }

    dev_server.load_cached_series = lambda _symbol: cached_snapshot
    dev_server.cache_is_fresh = lambda _snapshot: True
    dev_server.snapshot_requires_full_sync = lambda _snapshot: False
    dev_server.ensure_snapshot_currency = lambda snapshot: snapshot

    def unexpected_fetch(*_args, **_kwargs):
        raise AssertionError("matching preferred provider should not trigger a refresh")

    dev_server.fetch_full_symbol_history_result = unexpected_fetch
    try:
        snapshot, cache_status = dev_server.get_or_refresh_cached_series(
            "XLF",
            preferred_provider="yahoo_finance15",
        )
    finally:
        dev_server.load_cached_series = original_load_cached_series
        dev_server.cache_is_fresh = original_cache_is_fresh
        dev_server.snapshot_requires_full_sync = original_snapshot_requires_full_sync
        dev_server.ensure_snapshot_currency = original_ensure_snapshot_currency
        dev_server.fetch_full_symbol_history_result = original_fetch_full_symbol_history_result

    assert_equal(cache_status, "hit", "matching preferred provider should use the cache hit path")
    assert_equal(snapshot["provider"], "yahoo_finance15", "cached provider should be preserved")


def test_build_direction_context_uses_dev_server_cache_wrapper():
    original_get_or_refresh_cached_series = dev_server.get_or_refresh_cached_series

    points = []
    for offset in range(260):
        points.append([f"2026-{(offset // 28) + 1:02d}-{(offset % 28) + 1:02d}", 100 + offset])

    calls: list[tuple[str, str | None]] = []

    def fake_get_or_refresh(symbol, *, preferred_provider=None):
        calls.append((symbol, preferred_provider))
        return (
            {
                "symbol": symbol,
                "points": points,
            },
            "hit",
        )

    dev_server.get_or_refresh_cached_series = fake_get_or_refresh
    try:
        context = dev_server.build_direction_context(
            "XLF",
            as_of_date="2026-10-08",
            preferred_provider="yahoo_finance15",
        )
    finally:
        dev_server.get_or_refresh_cached_series = original_get_or_refresh_cached_series

    assert_equal(calls, [("XLF", "yahoo_finance15")], "direction context should use the dev_server cache wrapper")
    assert_equal(context["historyStartDate"], "2026-01-01", "direction context should read from injected cached points")
    assert_equal(context["historyEndDate"], "2026-10-08", "direction context should use the injected series range")
    assert_equal(context["directionLabel"], "Long Bias", "rising cached series should produce a long bias")


def main() -> int:
    test_preferred_provider_switch_rebuilds_fresh_cache()
    test_matching_preferred_provider_keeps_cache_hit()
    test_build_direction_context_uses_dev_server_cache_wrapper()
    print("ok dev server provider preference")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
