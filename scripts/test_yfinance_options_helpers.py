#!/usr/bin/env python3

from __future__ import annotations

import math
import sys
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import providers.yfinance_provider as yfinance_provider  # noqa: E402
from providers.yfinance_provider import (  # noqa: E402
    OptionContractNotMarkableError,
    approximate_annualized_implied_volatility,
    black_scholes_delta,
    compute_annualized_realized_volatility,
    fetch_exact_contract_quote,
    is_standard_monthly_expiry,
    summarize_normalized_skew,
)


class FakeFrame:
    def __init__(self, rows):
        self._rows = list(rows)

    @property
    def empty(self):
        return not self._rows

    def iterrows(self):
        for index, row in enumerate(self._rows):
            yield index, row


class FakeColumn:
    def __init__(self, values):
        self.values = list(values)

    def apply(self, callback):
        return [callback(value) for value in self.values]

    def fillna(self, replacement):
        return FakeColumn(
            [replacement if value is None else value for value in self.values],
        )

    def abs(self):
        return FakeColumn(
            [abs(value) if value is not None else None for value in self.values],
        )

    def __add__(self, other):
        if isinstance(other, FakeColumn):
            return FakeColumn(
                [
                    (left or 0) + (right or 0)
                    for left, right in zip(self.values, other.values)
                ],
            )
        return FakeColumn(
            [
                None if value is None else value + other
                for value in self.values
            ],
        )

    def __sub__(self, other):
        if isinstance(other, FakeColumn):
            return FakeColumn(
                [
                    None if left is None or right is None else left - right
                    for left, right in zip(self.values, other.values)
                ],
            )
        return FakeColumn(
            [
                None if value is None else value - other
                for value in self.values
            ],
        )


class FakeLocIndexer:
    def __init__(self, frame):
        self._frame = frame

    def __getitem__(self, mask):
        return FakeOptionFrame(
            [
                row
                for row, include in zip(self._frame._rows, list(mask))
                if include
            ],
        )


class FakeRowIloc:
    def __init__(self, frame):
        self._frame = frame

    def __getitem__(self, index):
        return self._frame._rows[index]


class FakeOptionFrame:
    def __init__(self, rows):
        self._rows = [dict(row) for row in rows]

    @property
    def empty(self):
        return not self._rows

    def copy(self):
        return FakeOptionFrame(self._rows)

    def iterrows(self):
        for index, row in enumerate(self._rows):
            yield index, row

    def rename(self, columns):
        return FakeOptionFrame(
            [
                {columns.get(key, key): value for key, value in row.items()}
                for row in self._rows
            ],
        )

    def merge(self, other, on, how="inner", suffixes=("_x", "_y")):
        del how
        other_rows_by_key = {}
        for row in other._rows:
            other_rows_by_key.setdefault(row.get(on), []).append(row)

        merged_rows = []
        for row in self._rows:
            for other_row in other_rows_by_key.get(row.get(on), []):
                combined = dict(row)
                for key, value in other_row.items():
                    if key == on:
                        continue
                    if key in combined:
                        combined[f"{key}{suffixes[1]}"] = value
                    else:
                        combined[key] = value
                merged_rows.append(combined)
        return FakeOptionFrame(merged_rows)

    def sort_values(self, columns, ascending=True):
        if isinstance(columns, str):
            columns = [columns]
        if isinstance(ascending, bool):
            ascending = [ascending] * len(columns)

        rows = list(self._rows)
        for column, is_ascending in reversed(list(zip(columns, ascending))):
            rows.sort(
                key=lambda row: (row.get(column) is None, row.get(column)),
                reverse=not is_ascending,
            )
        return FakeOptionFrame(rows)

    def __getitem__(self, column):
        return FakeColumn([row.get(column) for row in self._rows])

    def __setitem__(self, column, values):
        normalized_values = values.values if isinstance(values, FakeColumn) else list(values)
        for row, value in zip(self._rows, normalized_values):
            row[column] = value

    @property
    def loc(self):
        return FakeLocIndexer(self)

    @property
    def iloc(self):
        return FakeRowIloc(self)


class FakeValueIloc:
    def __init__(self, values):
        self._values = list(values)

    def __getitem__(self, index):
        return self._values[index]


class FakeSeries:
    def __init__(self, values, index):
        self._values = list(values)
        self.index = list(index)

    @property
    def empty(self):
        return not self._values

    def dropna(self):
        filtered_pairs = [
            (value, index)
            for value, index in zip(self._values, self.index)
            if value is not None
        ]
        return FakeSeries(
            [value for value, _index in filtered_pairs],
            [index for _value, index in filtered_pairs],
        )

    def tolist(self):
        return list(self._values)

    @property
    def iloc(self):
        return FakeValueIloc(self._values)


class FakeHistoryFrame:
    def __init__(self, rows):
        self.index = [datetime.fromisoformat(row["date"]) for row in rows]
        self._columns = {
            "Close": [row.get("Close") for row in rows],
            "Adj Close": [row.get("Adj Close") for row in rows],
        }

    @property
    def empty(self):
        return not self.index

    @property
    def columns(self):
        return list(self._columns.keys())

    def __getitem__(self, key):
        return FakeSeries(self._columns[key], self.index)


class FakeOptionChain:
    def __init__(self, calls, puts):
        self.calls = calls
        self.puts = puts


class FakeTicker:
    def __init__(self, history_rows, calls_rows, puts_rows):
        self._history_rows = history_rows
        self._calls_rows = calls_rows
        self._puts_rows = puts_rows

    def history(self, period="1y", auto_adjust=False):
        del period, auto_adjust
        return FakeHistoryFrame(self._history_rows)

    def option_chain(self, expiry):
        del expiry
        return FakeOptionChain(
            FakeOptionFrame(self._calls_rows),
            FakeOptionFrame(self._puts_rows),
        )


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


def assert_close(actual, expected, tolerance, message):
    if abs(actual - expected) > tolerance:
        raise AssertionError(
            f"{message}: expected {expected!r}, got {actual!r}",
        )


def test_fetch_exact_contract_quote_requires_an_exact_strike_match():
    history_rows = [
        {"date": "2026-04-09T00:00:00", "Close": 99.0, "Adj Close": 99.0},
        {"date": "2026-04-10T00:00:00", "Close": 100.0, "Adj Close": 100.0},
    ]
    calls_rows = [
        {
            "strike": 100.0,
            "bid": 2.4,
            "ask": 2.6,
            "lastPrice": 2.5,
            "openInterest": 1200,
            "volume": 240,
            "impliedVolatility": 0.31,
        },
        {
            "strike": 105.0,
            "bid": 0.9,
            "ask": 1.1,
            "lastPrice": 1.0,
            "openInterest": 800,
            "volume": 120,
            "impliedVolatility": 0.29,
        },
    ]
    puts_rows = [
        {
            "strike": 100.0,
            "bid": 2.3,
            "ask": 2.5,
            "lastPrice": 2.4,
            "openInterest": 1300,
            "volume": 210,
            "impliedVolatility": 0.29,
        },
        {
            "strike": 105.0,
            "bid": 5.7,
            "ask": 6.0,
            "lastPrice": 5.85,
            "openInterest": 900,
            "volume": 140,
            "impliedVolatility": 0.33,
        },
    ]
    fake_ticker = FakeTicker(history_rows, calls_rows, puts_rows)
    original_load_ticker = yfinance_provider._load_ticker
    original_resolve_currency = yfinance_provider.resolve_ticker_currency

    yfinance_provider._load_ticker = lambda _symbol: fake_ticker
    yfinance_provider.resolve_ticker_currency = lambda _ticker: "USD"
    try:
        quote = fetch_exact_contract_quote(
            "AAPL",
            expiry="2026-04-17",
            strike=100.0,
        )
        assert_true(
            quote["contract"]["strike"] == 100.0,
            "exact-quote helper should preserve the requested strike",
        )
        assert_true(
            quote["contract"]["callBid"] == 2.4 and quote["contract"]["putBid"] == 2.3,
            "exact-quote helper should return the matched contract pair",
        )
        assert_true(
            quote["contract"]["straddleMidPrice"] is not None and quote["contract"]["straddleMidPrice"] > 0,
            "exact-quote helper should build the same contract-level fields as the monthly snapshot",
        )

        try:
            fetch_exact_contract_quote(
                "AAPL",
                expiry="2026-04-17",
                strike=102.0,
            )
        except OptionContractNotMarkableError as error:
            assert_true(
                "102" in str(error),
                "exact-quote helper should fail with a typed exact-strike error instead of substituting another strike",
            )
        else:
            raise AssertionError("exact-quote helper should reject non-matching strikes")
    finally:
        yfinance_provider._load_ticker = original_load_ticker
        yfinance_provider.resolve_ticker_currency = original_resolve_currency


def test_fetch_exact_contract_quote_normalizes_under_scaled_chain_iv():
    history_rows = [
        {"date": "2026-04-09T00:00:00", "Close": 99.0, "Adj Close": 99.0},
        {"date": "2026-04-10T00:00:00", "Close": 100.0, "Adj Close": 100.0},
    ]
    calls_rows = [
        {
            "strike": 100.0,
            "bid": 2.4,
            "ask": 2.6,
            "lastPrice": 2.5,
            "openInterest": 1200,
            "volume": 240,
            "impliedVolatility": 0.0022,
        },
    ]
    puts_rows = [
        {
            "strike": 100.0,
            "bid": 2.3,
            "ask": 2.5,
            "lastPrice": 2.4,
            "openInterest": 1300,
            "volume": 210,
            "impliedVolatility": 0.0020,
        },
    ]
    fake_ticker = FakeTicker(history_rows, calls_rows, puts_rows)
    original_load_ticker = yfinance_provider._load_ticker
    original_resolve_currency = yfinance_provider.resolve_ticker_currency

    yfinance_provider._load_ticker = lambda _symbol: fake_ticker
    yfinance_provider.resolve_ticker_currency = lambda _ticker: "USD"
    try:
        quote = fetch_exact_contract_quote(
            "AAPL",
            expiry="2026-04-17",
            strike=100.0,
        )
    finally:
        yfinance_provider._load_ticker = original_load_ticker
        yfinance_provider.resolve_ticker_currency = original_resolve_currency

    assert_close(
        quote["contract"]["chainImpliedVolatility"],
        0.21,
        1e-9,
        "exact-quote helper should normalize under-scaled chain IV values",
    )


def main() -> int:
    assert_true(
        is_standard_monthly_expiry("2026-04-17"),
        "third-Friday monthly should be accepted",
    )
    assert_true(
        is_standard_monthly_expiry("2026-06-18"),
        "holiday-adjusted Thursday monthly should be accepted",
    )
    assert_true(
        not is_standard_monthly_expiry("2026-05-22"),
        "non-standard weekly expiry should be rejected",
    )
    iv = approximate_annualized_implied_volatility(0.0679, 33)
    assert_true(iv is not None, "IV approximation should return a number for valid inputs")
    assert_close(iv, 0.2828, 0.001, "IV approximation should match the reference snapshot")
    constant_growth_prices = [100 * (1.01 ** index) for index in range(61)]
    hv20 = compute_annualized_realized_volatility(constant_growth_prices, 20)
    hv60 = compute_annualized_realized_volatility(constant_growth_prices, 60)
    assert_true(hv20 is not None, "HV20 should resolve with 21 prices")
    assert_true(hv60 is not None, "HV60 should resolve with 61 prices")
    assert_close(hv20, 0.0, 1e-12, "constant log-return series should have zero HV20")
    assert_close(hv60, 0.0, 1e-12, "constant log-return series should have zero HV60")
    assert_true(
        compute_annualized_realized_volatility(constant_growth_prices[:10], 20) is None,
        "insufficient history should suppress realized-vol output",
    )
    atm_call_delta = black_scholes_delta(
        spot_price=100,
        strike=100,
        time_to_expiry_years=30 / 365,
        implied_volatility=0.22,
        option_type="call",
    )
    atm_put_delta = black_scholes_delta(
        spot_price=100,
        strike=100,
        time_to_expiry_years=30 / 365,
        implied_volatility=0.22,
        option_type="put",
    )
    assert_true(
        atm_call_delta is not None and 0.45 < atm_call_delta < 0.6,
        "ATM call delta should land near 0.5",
    )
    assert_true(
        atm_put_delta is not None and -0.6 < atm_put_delta < -0.4,
        "ATM put delta should land near -0.5",
    )
    calls = FakeFrame(
        [
            {"strike": 90, "impliedVolatility": 0.24, "openInterest": 800, "volume": 120},
            {"strike": 95, "impliedVolatility": 0.23, "openInterest": 1200, "volume": 180},
            {"strike": 100, "impliedVolatility": 0.22, "openInterest": 2400, "volume": 320},
            {"strike": 105, "impliedVolatility": 0.215, "openInterest": 1100, "volume": 140},
            {"strike": 110, "impliedVolatility": 0.21, "openInterest": 700, "volume": 90},
        ]
    )
    puts = FakeFrame(
        [
            {"strike": 90, "impliedVolatility": 0.27, "openInterest": 700, "volume": 110},
            {"strike": 95, "impliedVolatility": 0.255, "openInterest": 1300, "volume": 170},
            {"strike": 100, "impliedVolatility": 0.23, "openInterest": 2500, "volume": 340},
            {"strike": 105, "impliedVolatility": 0.225, "openInterest": 1000, "volume": 130},
            {"strike": 110, "impliedVolatility": 0.22, "openInterest": 650, "volume": 85},
        ]
    )
    skew_summary = summarize_normalized_skew(
        calls,
        puts,
        spot_price=100,
        days_to_expiry=30,
        chain_implied_volatility=0.225,
    )
    assert_true(
        skew_summary["atmImpliedVolatility"] is not None,
        "ATM IV reference should resolve from the option chain",
    )
    assert_true(
        skew_summary["put25DeltaImpliedVolatility"] is not None,
        "25-delta put IV should resolve from the option chain",
    )
    assert_true(
        skew_summary["normalizedSkew"] is not None and skew_summary["normalizedSkew"] > 0,
        "downside skew should be positive when puts are richer than ATM",
    )
    assert_true(
        skew_summary["normalizedUpsideSkew"] is not None
        and skew_summary["normalizedUpsideSkew"] < 0,
        "upside skew should be negative when calls are cheaper than ATM",
    )
    test_fetch_exact_contract_quote_requires_an_exact_strike_match()
    test_fetch_exact_contract_quote_normalizes_under_scaled_chain_iv()
    print("ok yfinance options helpers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
