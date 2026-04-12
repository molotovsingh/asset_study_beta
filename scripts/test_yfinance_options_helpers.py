#!/usr/bin/env python3

from __future__ import annotations

import math
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from providers.yfinance_provider import (  # noqa: E402
    approximate_annualized_implied_volatility,
    compute_annualized_realized_volatility,
    is_standard_monthly_expiry,
)


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


def assert_close(actual, expected, tolerance, message):
    if abs(actual - expected) > tolerance:
        raise AssertionError(
            f"{message}: expected {expected!r}, got {actual!r}",
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
    print("ok yfinance options helpers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
