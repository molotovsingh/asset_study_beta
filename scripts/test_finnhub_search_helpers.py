#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from providers.finnhub import _match_kind_and_score, _normalize_candle_rows  # noqa: E402


def assert_equal(actual, expected, message):
    if actual != expected:
        raise AssertionError(f"{message}: expected {expected!r}, got {actual!r}")


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


def main() -> int:
    compact_symbol_match = _match_kind_and_score(
        "brkb",
        symbol="BRK.B",
        display_symbol="BRK.B",
        description="Berkshire Hathaway Inc",
        instrument_type="Common Stock",
    )
    assert_true(compact_symbol_match is not None, "compact symbol queries should still match punctuated symbols")
    assert_equal(
        compact_symbol_match[0],
        "exact-compact-symbol",
        "compact symbol matches should use the dedicated compact-symbol bucket",
    )

    compact_company_match = _match_kind_and_score(
        "berkshirehathaway",
        symbol="BRK.B",
        display_symbol="BRK.B",
        description="Berkshire Hathaway Inc",
        instrument_type="Common Stock",
    )
    assert_true(compact_company_match is not None, "compact company-name queries should still match")
    assert_equal(
        compact_company_match[0],
        "exact-compact-company",
        "compact company-name matches should use the dedicated compact-company bucket",
    )

    candle_rows = _normalize_candle_rows(
        {
            "s": "ok",
            "c": [101.5, 103.0],
            "h": [102.0, 104.0],
            "l": [99.5, 100.0],
            "o": [100.0, 101.0],
            "t": [1712793600, 1712880000],
            "v": [1500, 1750],
        },
    )
    assert_equal(len(candle_rows), 2, "candle normalization should keep every valid timestamp row")
    assert_equal(candle_rows[0]["date"], "2024-04-11", "timestamps should normalize to UTC market dates")
    assert_equal(candle_rows[1]["close"], 103.0, "close values should persist through normalization")

    print("ok finnhub search helpers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
