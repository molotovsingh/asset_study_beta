#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from server import options_service  # noqa: E402
from server.options import screener as options_screener  # noqa: E402


def assert_equal(actual, expected, message):
    if actual != expected:
        raise AssertionError(f"{message}: expected {expected!r}, got {actual!r}")


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


def test_history_summary_uses_full_rows_counts_but_preview_rows_for_cards():
    original_runs_loader = options_screener.load_recent_options_screener_runs
    original_rows_loader = options_screener.load_options_screener_rows
    original_ensure_runtime_store = options_screener.ensure_runtime_store

    def fake_runs_loader(*, limit=0):
        return [
            {
                "runId": 21,
                "universeId": "us-liquid-10",
                "universeLabel": "US Liquid 10",
                "createdAt": "2026-05-14T12:00:00+00:00",
                "asOfDate": "2026-05-14",
                "rowCount": 4,
                "failureCount": 0,
            }
        ]

    def fake_rows_loader(*, run_id=None, limit=0, **_kwargs):
        assert_equal(run_id, 21, "history should request rows for the current run")
        rows = [
            {
                "symbol": "AAPL",
                "pricingBucket": "cheap",
                "candidateBucket": "long-premium",
                "directionLabel": "Long Bias",
                "directionScore": 72,
                "ivHv20Ratio": 0.82,
            },
            {
                "symbol": "MSFT",
                "pricingBucket": "cheap",
                "candidateBucket": "watch",
                "directionLabel": "Neutral",
                "directionScore": 49,
                "ivHv20Ratio": 0.91,
            },
            {
                "symbol": "NVDA",
                "pricingBucket": "cheap",
                "candidateBucket": "long-premium",
                "directionLabel": "Long Bias",
                "directionScore": 78,
                "ivHv20Ratio": 0.76,
            },
            {
                "symbol": "TSLA",
                "pricingBucket": "rich",
                "candidateBucket": "short-premium",
                "directionLabel": "Short Bias",
                "directionScore": 31,
                "ivHv20Ratio": 1.46,
            },
        ]
        return rows[:limit]

    options_screener.load_recent_options_screener_runs = fake_runs_loader
    options_screener.load_options_screener_rows = fake_rows_loader
    options_screener.ensure_runtime_store = lambda: None
    try:
        payload = options_service.build_options_screener_history_payload(
            {"universeId": "us-liquid-10", "limit": 1, "rowLimit": 2}
        )
    finally:
        options_screener.load_recent_options_screener_runs = original_runs_loader
        options_screener.load_options_screener_rows = original_rows_loader
        options_screener.ensure_runtime_store = original_ensure_runtime_store

    assert_equal(len(payload["runs"]), 1, "history payload should include one run")
    run = payload["runs"][0]
    assert_equal(run["pricingCounts"]["cheap"], 3, "cheap count should use the full stored run")
    assert_equal(run["pricingCounts"]["rich"], 1, "rich count should use the full stored run")
    assert_equal(len(run["rows"]), 2, "history cards should still preview only the requested row limit")
    assert_equal(run["topCheap"]["symbol"], "NVDA", "top cheap should come from the full row set")
    assert_equal(run["topRich"]["symbol"], "TSLA", "top rich should come from the full row set")
    assert_true(
        {row["symbol"] for row in run["rows"]} == {"AAPL", "MSFT"},
        "preview rows should remain limited to the first archived card slice",
    )


def main() -> int:
    test_history_summary_uses_full_rows_counts_but_preview_rows_for_cards()
    print("ok options screener history")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
