#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from providers.base import HistoryResult, ProfileResult  # noqa: E402
from providers import router  # noqa: E402


def assert_equal(actual, expected, message):
    if actual != expected:
        raise AssertionError(f"{message}: expected {expected!r}, got {actual!r}")


def test_history_router_uses_fallback_and_respects_preference():
    original_fetchers = dict(router.HISTORY_FETCHERS)
    calls: list[str] = []

    def fail_history(*_args, **_kwargs):
        calls.append("yfinance")
        raise RuntimeError("boom")

    def fallback_history(*_args, **_kwargs):
        calls.append("yahoo_finance15")
        return HistoryResult(
            provider="yahoo_finance15",
            provider_name="Yahoo Finance 15 (RapidAPI)",
            price_rows=[
                {"date": "2024-01-01", "close": 10},
                {"date": "2024-01-02", "close": 11},
            ],
            action_rows=[],
            currency="USD",
        )

    router.HISTORY_FETCHERS["yfinance"] = fail_history
    router.HISTORY_FETCHERS["yahoo_finance15"] = fallback_history
    try:
        result = router.fetch_history_with_fallback("AAPL")
        assert_equal(result.provider, "yahoo_finance15", "fallback provider should win")
        assert_equal(calls, ["yfinance", "yahoo_finance15"], "providers should try in default order")

        calls.clear()
        result = router.fetch_history_with_fallback(
            "AAPL",
            preferred_provider="yahoo_finance15",
        )
        assert_equal(result.provider, "yahoo_finance15", "preferred provider should be reused first")
        assert_equal(calls, ["yahoo_finance15"], "preferred provider should be tried first")
    finally:
        router.HISTORY_FETCHERS.clear()
        router.HISTORY_FETCHERS.update(original_fetchers)


def test_profile_router_uses_same_ordering_rules():
    original_fetchers = dict(router.PROFILE_FETCHERS)
    calls: list[str] = []

    def fail_profile(*_args, **_kwargs):
        calls.append("yfinance")
        raise RuntimeError("boom")

    def fallback_profile(*_args, **_kwargs):
        calls.append("yahoo_finance15")
        return ProfileResult(
            provider="yahoo_finance15",
            provider_name="Yahoo Finance 15 (RapidAPI)",
            info={"quoteType": "INDEX", "shortName": "VIX"},
        )

    router.PROFILE_FETCHERS["yfinance"] = fail_profile
    router.PROFILE_FETCHERS["yahoo_finance15"] = fallback_profile
    try:
        result = router.fetch_profile_with_fallback("^VIX")
        assert_equal(result.provider, "yahoo_finance15", "profile fallback should win")
        assert_equal(calls, ["yfinance", "yahoo_finance15"], "profile providers should try in default order")
    finally:
        router.PROFILE_FETCHERS.clear()
        router.PROFILE_FETCHERS.update(original_fetchers)


def main() -> int:
    test_history_router_uses_fallback_and_respects_preference()
    test_profile_router_uses_same_ordering_rules()
    print("ok provider router")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
