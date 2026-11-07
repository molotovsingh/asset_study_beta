#!/usr/bin/env python3
"""Offline tests for vol_charts SVI / parity / expiry-selection helpers.

Run: .venv/bin/python -m pytest scripts/test_vol_charts.py -q
(or: .venv/bin/python scripts/test_vol_charts.py)
"""
import importlib.util
import math
import sys
from datetime import date
from pathlib import Path

spec = importlib.util.spec_from_file_location("vol_charts", Path(__file__).with_name("vol_charts.py"))
vc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vc)


def test_svi_recovers_synthetic_smile():
    T = 30 / 365.0
    true = {"a": 0.002, "b": 0.08, "rho": -0.5, "m": 0.0, "sigma": 0.08}
    ks = [i * 0.02 - 0.24 for i in range(25)]
    ivs = [math.sqrt(max(float(vc.svi_w(k, true)), 1e-8) / T) for k in ks]
    fit = vc.fit_svi(ks, ivs, T)
    assert fit is not None, "SVI fit failed on a clean synthetic smile"
    assert fit["rmse"] < 0.005, f"SVI RMSE too large: {fit['rmse']}"
    assert fit["butterfly_ok"]
    p = fit["params"]
    assert p["b"] > 0 and p["sigma"] > 0 and -1 < p["rho"] < 1


def test_svi_rejects_too_few_points():
    assert vc.fit_svi([0.0, 0.1], [0.2, 0.2], 0.1) is None


def test_forward_from_parity_recovers_forward():
    spot, F, D = 100.0, 104.0, 0.99
    group = []
    for K in range(92, 109, 2):
        put_mid = 6.0
        call_mid = put_mid + D * (F - K)
        if call_mid <= 0:
            continue
        group.append({"type": "call", "strike": float(K), "bid": call_mid - 0.05, "ask": call_mid + 0.05})
        group.append({"type": "put", "strike": float(K), "bid": put_mid - 0.05, "ask": put_mid + 0.05})
    got = vc.forward_from_parity(group, spot)
    assert abs(got - F) < 0.5, f"parity forward {got} != {F}"


def test_forward_from_parity_falls_back_to_spot():
    assert vc.forward_from_parity([], 100.0) == 100.0
    one = [{"type": "call", "strike": 100.0, "bid": 1.0, "ask": 1.2}]
    assert vc.forward_from_parity(one, 100.0) == 100.0


def test_is_monthly_third_friday():
    assert vc.is_monthly(date(2026, 11, 20))       # third Friday
    assert not vc.is_monthly(date(2026, 11, 13))   # second Friday
    assert not vc.is_monthly(date(2026, 11, 21))   # Saturday


class _Args:
    min_dte = 0
    max_dte = 60
    expiry_mode = "monthly"
    expiry_count = 6


def test_select_expiries_monthly_window():
    asof = date(2026, 11, 4)
    expiries = ["2026-11-06", "2026-11-20", "2026-12-18", "2027-01-15", "2027-02-20"]
    got = vc.select_expiries(expiries, asof, _Args)
    assert got == ["2026-11-20", "2026-12-18"], got


def test_historical_vol_constant_growth_is_zero():
    closes = [100 * (1.01 ** i) for i in range(40)]  # identical log returns
    hv = vc.historical_vol(closes, 30)
    assert hv is not None and hv < 1e-9, hv


def test_historical_vol_needs_history():
    assert vc.historical_vol([100, 101, 102], 30) is None
    assert vc.historical_vol([], 30) is None


def test_quote_is_tradable_rejects_unquoted_and_wide():
    assert not vc.quote_is_tradable({"bid": 0.0, "ask": 2.26})
    assert not vc.quote_is_tradable({"bid": 0.19, "ask": 2.58})
    assert not vc.quote_is_tradable({"bid": None, "ask": 1.0})
    assert vc.quote_is_tradable({"bid": 0.90, "ask": 1.10})
    assert vc.quote_is_tradable({"bid": 0.19, "ask": 2.58}, max_spread_frac=2.0)


def test_iv_at_delta_ignores_single_junk_quote():
    group = [{"delta": 0.09, "iv": 0.80}, {"delta": 0.10, "iv": 0.79},
             {"delta": 0.105, "iv": 0.81}, {"delta": 0.11, "iv": 0.78},
             {"delta": 0.095, "iv": 1.04}]  # one junk print in the same bucket
    got = vc.iv_at_delta(group, 0.10, 0.02, 0.98)
    assert got is not None and got < 0.90, f"junk quote leaked into bucket IV: {got}"


def test_interp_endpoints():
    pts = [(0, 0.10), (10, 0.20)]
    assert vc.interp(pts, 0) == 0.10
    assert abs(vc.interp(pts, 5) - 0.15) < 1e-12
    assert vc.interp(pts, 11) is None


if __name__ == "__main__":
    fns = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_")]
    failed = 0
    for name, fn in fns:
        try:
            fn()
            print(f"PASS {name}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {name}: {e}")
    sys.exit(1 if failed else 0)
