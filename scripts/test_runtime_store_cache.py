#!/usr/bin/env python3

from __future__ import annotations

import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

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
            provider="yahoo_finance15",
            sync_mode="full",
            replace=True,
        )

        assert_equal(full_snapshot["symbol"], "ABC", "symbols should normalize")
        assert_equal(full_snapshot["currency"], "USD", "currency should normalize")
        assert_equal(full_snapshot["provider"], "yahoo_finance15", "provider should persist")
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
            provider="yahoo_finance15",
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


def test_option_snapshot_and_realized_metrics_persist():
    with isolated_runtime_store():
        runtime_store.write_option_monthly_snapshot(
            "aapl",
            {
                "symbol": "AAPL",
                "provider": "yfinance",
                "currency": "USD",
                "fetchedAt": "2026-04-12T08:15:00+00:00",
                "asOfDate": "2026-04-12",
                "spotDate": "2026-04-10",
                "spotPrice": 260.48,
                "minimumDte": 25,
                "maxContracts": 2,
                "realizedVolatility": {
                    "seriesType": "adj_close",
                    "observations": 252,
                    "hv20": 0.244,
                    "hv60": 0.231,
                    "hv120": 0.226,
                },
                "monthlyContracts": [
                    {
                        "expiry": "2026-05-15",
                        "daysToExpiry": 33,
                        "strike": 260,
                        "callBid": 9.3,
                        "callAsk": 9.5,
                        "callLastPrice": 9.4,
                        "callMidPrice": 9.4,
                        "callPriceSource": "mid",
                        "callOpenInterest": 9597,
                        "callVolume": 2009,
                        "callImpliedVolatility": 0.2922,
                        "putBid": 8.2,
                        "putAsk": 8.35,
                        "putLastPrice": 8.26,
                        "putMidPrice": 8.275,
                        "putPriceSource": "mid",
                        "putOpenInterest": 13230,
                        "putVolume": 1211,
                        "putImpliedVolatility": 0.2711,
                        "straddleMidPrice": 17.675,
                        "impliedMovePrice": 17.675,
                        "impliedMovePercent": 0.0679,
                        "straddleImpliedVolatility": 0.2828,
                        "chainImpliedVolatility": 0.2817,
                        "impliedVolatilityGap": 0.0011,
                        "historicalVolatility20": 0.244,
                        "historicalVolatility60": 0.231,
                        "historicalVolatility120": 0.226,
                        "ivHv20Ratio": 1.159,
                        "ivHv60Ratio": 1.224,
                        "ivHv120Ratio": 1.251,
                        "ivHv20Spread": 0.0388,
                        "ivHv60Spread": 0.0518,
                        "ivHv120Spread": 0.0568,
                        "combinedOpenInterest": 22827,
                        "combinedVolume": 3220,
                        "pricingMode": "bid-ask-mid",
                    },
                    {
                        "expiry": "2026-06-18",
                        "daysToExpiry": 67,
                        "strike": 260,
                        "callBid": 12.8,
                        "callAsk": 13.1,
                        "callLastPrice": 13.0,
                        "callMidPrice": 12.95,
                        "callPriceSource": "mid",
                        "callOpenInterest": 14500,
                        "callVolume": 1200,
                        "callImpliedVolatility": 0.273,
                        "putBid": 10.95,
                        "putAsk": 11.15,
                        "putLastPrice": 11.0,
                        "putMidPrice": 11.05,
                        "putPriceSource": "mid",
                        "putOpenInterest": 17166,
                        "putVolume": 998,
                        "putImpliedVolatility": 0.2706,
                        "straddleMidPrice": 24.0,
                        "impliedMovePrice": 24.0,
                        "impliedMovePercent": 0.0921,
                        "straddleImpliedVolatility": 0.2704,
                        "chainImpliedVolatility": 0.2718,
                        "impliedVolatilityGap": -0.0014,
                        "historicalVolatility20": 0.244,
                        "historicalVolatility60": 0.231,
                        "historicalVolatility120": 0.226,
                        "ivHv20Ratio": 1.108,
                        "ivHv60Ratio": 1.17,
                        "ivHv120Ratio": 1.196,
                        "ivHv20Spread": 0.0264,
                        "ivHv60Spread": 0.0394,
                        "ivHv120Spread": 0.0444,
                        "combinedOpenInterest": 31666,
                        "combinedVolume": 2198,
                        "pricingMode": "bid-ask-mid",
                    },
                ],
            },
        )
        runtime_store.write_option_monthly_snapshot(
            "AAPL",
            {
                "symbol": "AAPL",
                "provider": "yfinance",
                "currency": "USD",
                "fetchedAt": "2026-04-13T08:15:00+00:00",
                "asOfDate": "2026-04-13",
                "spotDate": "2026-04-11",
                "spotPrice": 261.1,
                "minimumDte": 25,
                "maxContracts": 2,
                "realizedVolatility": {
                    "seriesType": "adj_close",
                    "observations": 252,
                    "hv20": 0.241,
                    "hv60": 0.229,
                    "hv120": 0.225,
                },
                "monthlyContracts": [
                    {
                        "expiry": "2026-05-15",
                        "daysToExpiry": 32,
                        "strike": 260,
                        "callBid": 9.6,
                        "callAsk": 9.8,
                        "callLastPrice": 9.7,
                        "callMidPrice": 9.7,
                        "callPriceSource": "mid",
                        "callOpenInterest": 9700,
                        "callVolume": 1800,
                        "callImpliedVolatility": 0.296,
                        "putBid": 8.45,
                        "putAsk": 8.6,
                        "putLastPrice": 8.5,
                        "putMidPrice": 8.525,
                        "putPriceSource": "mid",
                        "putOpenInterest": 13300,
                        "putVolume": 1100,
                        "putImpliedVolatility": 0.275,
                        "straddleMidPrice": 18.225,
                        "impliedMovePrice": 18.225,
                        "impliedMovePercent": 0.0698,
                        "straddleImpliedVolatility": 0.289,
                        "chainImpliedVolatility": 0.2855,
                        "impliedVolatilityGap": 0.0035,
                        "historicalVolatility20": 0.241,
                        "historicalVolatility60": 0.229,
                        "historicalVolatility120": 0.225,
                        "ivHv20Ratio": 1.199,
                        "ivHv60Ratio": 1.262,
                        "ivHv120Ratio": 1.284,
                        "ivHv20Spread": 0.048,
                        "ivHv60Spread": 0.06,
                        "ivHv120Spread": 0.064,
                        "combinedOpenInterest": 23000,
                        "combinedVolume": 2900,
                        "pricingMode": "bid-ask-mid",
                    },
                    {
                        "expiry": "2026-06-18",
                        "daysToExpiry": 66,
                        "strike": 260,
                        "callBid": 13.0,
                        "callAsk": 13.3,
                        "callLastPrice": 13.1,
                        "callMidPrice": 13.15,
                        "callPriceSource": "mid",
                        "callOpenInterest": 14600,
                        "callVolume": 1150,
                        "callImpliedVolatility": 0.274,
                        "putBid": 11.1,
                        "putAsk": 11.3,
                        "putLastPrice": 11.2,
                        "putMidPrice": 11.2,
                        "putPriceSource": "mid",
                        "putOpenInterest": 17200,
                        "putVolume": 970,
                        "putImpliedVolatility": 0.271,
                        "straddleMidPrice": 24.35,
                        "impliedMovePrice": 24.35,
                        "impliedMovePercent": 0.0933,
                        "straddleImpliedVolatility": 0.271,
                        "chainImpliedVolatility": 0.2725,
                        "impliedVolatilityGap": -0.0015,
                        "historicalVolatility20": 0.241,
                        "historicalVolatility60": 0.229,
                        "historicalVolatility120": 0.225,
                        "ivHv20Ratio": 1.124,
                        "ivHv60Ratio": 1.183,
                        "ivHv120Ratio": 1.204,
                        "ivHv20Spread": 0.03,
                        "ivHv60Spread": 0.042,
                        "ivHv120Spread": 0.046,
                        "combinedOpenInterest": 31800,
                        "combinedVolume": 2120,
                        "pricingMode": "bid-ask-mid",
                    },
                ],
            },
        )

        contracts = runtime_store.load_option_monthly_snapshots(
            "AAPL",
            as_of_date="2026-04-12",
            provider="yfinance",
        )
        assert_equal(len(contracts), 2, "two monthly contracts should persist")
        assert_equal(contracts[0]["expiry"], "2026-05-15", "front expiry should load back")
        assert_equal(
            round(contracts[0]["ivHv20Ratio"], 3),
            1.159,
            "stored IV/HV20 ratio should round-trip",
        )

        metrics = runtime_store.load_derived_daily_metrics(
            "AAPL",
            metric_date="2026-04-12",
            provider="yfinance",
            metric_family="realized_volatility",
        )
        assert_equal(len(metrics), 3, "HV20/HV60/HV120 should persist as derived metrics")
        assert_equal(metrics[0]["metricKey"], "hv20", "derived metrics should sort by window")
        assert_equal(metrics[1]["metricKey"], "hv60", "derived metrics should include hv60")
        assert_equal(metrics[2]["metricKey"], "hv120", "derived metrics should include hv120")

        front_history = runtime_store.load_option_front_history(
            "AAPL",
            provider="yfinance",
            limit=10,
        )
        assert_equal(len(front_history), 2, "front-history query should return one row per date")
        assert_equal(front_history[0]["asOfDate"], "2026-04-12", "front-history should sort oldest to newest")
        assert_equal(front_history[1]["asOfDate"], "2026-04-13", "front-history should include the later snapshot")
        assert_equal(front_history[0]["expiry"], "2026-05-15", "front-history should pick the nearest expiry")
        assert_equal(front_history[1]["daysToExpiry"], 32, "front-history should keep front-contract DTE")


def test_options_screener_runs_persist():
    with isolated_runtime_store():
        summary = runtime_store.record_options_screener_run(
            universe_id="us-liquid-10",
            universe_label="US Liquid 10",
            minimum_dte=25,
            max_contracts=1,
            requested_symbols=["AAPL", "TSLA"],
            failures=[{"symbol": "TSLA", "error": "Timeout"}],
            rows=[
                {
                    "symbol": "AAPL",
                    "provider": "yfinance",
                    "currency": "USD",
                    "asOfDate": "2026-04-12",
                    "expiry": "2026-05-15",
                    "spotPrice": 260.48,
                    "strike": 260,
                    "daysToExpiry": 33,
                    "straddleMidPrice": 17.675,
                    "impliedMovePercent": 0.0679,
                    "straddleImpliedVolatility": 0.2828,
                    "chainImpliedVolatility": 0.2817,
                    "historicalVolatility20": 0.244,
                    "historicalVolatility60": 0.231,
                    "ivHv20Ratio": 1.159,
                    "ivHv60Ratio": 1.224,
                    "ivPercentile": 0.65,
                    "ivHv20Percentile": 0.72,
                    "combinedOpenInterest": 22827,
                    "combinedVolume": 3220,
                    "spreadShare": 0.02,
                    "pricingLabel": "Mildly Rich",
                    "pricingBucket": "rich",
                    "directionScore": 66.09,
                    "directionLabel": "Long Bias",
                    "trendScore": 68.2,
                    "trendLabel": "Long Bias",
                    "trendReturn63": 0.055,
                    "trendReturn252": 0.124,
                    "seasonalityScore": 63.98,
                    "seasonalityLabel": "Long Bias",
                    "seasonalityMonthLabel": "April",
                    "seasonalityMeanReturn": 0.0356,
                    "seasonalityMedianReturn": 0.0221,
                    "seasonalityWinRate": 0.587,
                    "seasonalityAverageAbsoluteReturn": 0.061,
                    "seasonalityObservations": 23,
                    "volPricingScore": 65.2,
                    "executionScore": 91.7,
                    "confidenceScore": 94.4,
                    "candidateAdvisory": "Short Premium Candidate",
                    "candidateBucket": "short-premium",
                    "warnings": [],
                }
            ],
            created_at="2026-04-12T08:30:00+00:00",
        )

        assert_equal(summary["universeId"], "us-liquid-10", "screener run universe should persist")
        assert_equal(summary["rowCount"], 1, "screener run row count should persist")
        assert_equal(summary["failureCount"], 1, "screener run failure count should persist")

        recent_runs = runtime_store.load_recent_options_screener_runs(limit=5)
        assert_equal(len(recent_runs), 1, "recent screener runs should load")
        assert_equal(recent_runs[0]["requestedSymbols"], ["AAPL", "TSLA"], "requested symbols should round-trip")
        assert_equal(recent_runs[0]["failures"][0]["symbol"], "TSLA", "failures should round-trip")

        rows = runtime_store.load_options_screener_rows(symbol="AAPL", universe_id="us-liquid-10", limit=5)
        assert_equal(len(rows), 1, "stored screener rows should load")
        assert_equal(rows[0]["pricingBucket"], "rich", "pricing bucket should round-trip")
        assert_equal(rows[0]["directionLabel"], "Long Bias", "direction label should round-trip")
        assert_equal(rows[0]["candidateAdvisory"], "Short Premium Candidate", "candidate advisory should round-trip")
        assert_equal(
            runtime_store.load_options_screener_rows(run_id=summary["runId"], limit=5)[0]["symbol"],
            "AAPL",
            "run-id filtering should load the recorded row",
        )


def test_options_validation_payload_uses_cached_forward_prices():
    with isolated_runtime_store():
        runtime_store.write_price_history(
            "AAPL",
            [
                {"date": "2026-04-10", "close": 100},
                {"date": "2026-04-13", "close": 101},
                {"date": "2026-04-14", "close": 102},
                {"date": "2026-04-15", "close": 99},
            ],
            [],
            currency="USD",
            provider="yfinance",
            sync_mode="full",
            replace=True,
        )
        runtime_store.record_options_screener_run(
            universe_id="us-liquid-10",
            universe_label="US Liquid 10",
            minimum_dte=25,
            max_contracts=1,
            requested_symbols=["AAPL"],
            failures=[],
            rows=[
                {
                    "symbol": "AAPL",
                    "provider": "yfinance",
                    "currency": "USD",
                    "asOfDate": "2026-04-12",
                    "expiry": "2026-05-15",
                    "spotPrice": 100,
                    "strike": 100,
                    "daysToExpiry": 33,
                    "straddleMidPrice": 7.5,
                    "impliedMovePercent": 0.075,
                    "straddleImpliedVolatility": 0.24,
                    "chainImpliedVolatility": 0.23,
                    "historicalVolatility20": 0.2,
                    "historicalVolatility60": 0.19,
                    "ivHv20Ratio": 1.2,
                    "ivHv60Ratio": 1.26,
                    "ivPercentile": 0.7,
                    "ivHv20Percentile": 0.68,
                    "combinedOpenInterest": 12000,
                    "combinedVolume": 1800,
                    "spreadShare": 0.03,
                    "pricingLabel": "Mildly Rich",
                    "pricingBucket": "rich",
                    "directionScore": 60,
                    "directionLabel": "Long Bias",
                    "trendScore": 62,
                    "trendLabel": "Long Bias",
                    "trendReturn63": 0.04,
                    "trendReturn252": 0.12,
                    "seasonalityScore": 58,
                    "seasonalityLabel": "Neutral",
                    "seasonalityMonthLabel": "Apr",
                    "seasonalityMeanReturn": 0.01,
                    "seasonalityMedianReturn": 0.008,
                    "seasonalityWinRate": 0.55,
                    "seasonalityAverageAbsoluteReturn": 0.05,
                    "seasonalityObservations": 12,
                    "volPricingScore": 64,
                    "executionScore": 82,
                    "confidenceScore": 88,
                    "candidateAdvisory": "Short Premium Candidate",
                    "candidateBucket": "short-premium",
                    "warnings": [],
                }
            ],
            created_at="2026-04-12T08:30:00+00:00",
        )

        payload = dev_server.build_options_screener_validation_payload(
            universe_id="us-liquid-10",
            horizon_days=2,
            limit_runs=10,
            row_limit=10,
        )
        assert_equal(payload["runCount"], 1, "validation should see the archived run")
        assert_equal(payload["observationCount"], 1, "validation should build one observation")
        observation = payload["observations"][0]
        assert_equal(observation["matured"], True, "validation observation should be matured")
        assert_equal(observation["baseDate"], "2026-04-10", "weekend screener rows should anchor to prior close")
        assert_equal(observation["forwardDate"], "2026-04-14", "2-day horizon should land on the second trading day ahead")
        assert_equal(round(observation["forwardReturn"], 4), 0.02, "forward return should use cached close prices")
        assert_equal(round(observation["moveEdge"], 4), -0.055, "move edge should compare realized move to implied move")
        assert_equal(observation["realizedBeatImplied"], False, "realized move should not beat the archived implied move")


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
    original_full_fetch = dev_server.fetch_full_symbol_history_result
    original_incremental_fetch = dev_server.fetch_symbol_history_result

    full_payloads = [
        (
            SimpleNamespace(
                provider="yfinance",
                provider_name="Yahoo Finance (yfinance)",
                price_rows=[
                    {"date": "2020-01-01", "close": 10},
                    {"date": "2020-01-02", "close": 11},
                    {"date": "2020-01-03", "close": 12},
                ],
                action_rows=[],
                currency="USD",
                coverage_note=None,
            ),
            "max",
        ),
        (
            SimpleNamespace(
                provider="yahoo_finance15",
                provider_name="Yahoo Finance 15 (RapidAPI)",
                price_rows=[
                    {"date": "2020-01-01", "close": 10},
                    {"date": "2020-01-02", "close": 11},
                    {"date": "2020-01-03", "close": 12},
                    {"date": "2020-01-04", "close": 13},
                    {"date": "2020-01-05", "close": 14},
                ],
                action_rows=[],
                currency="USD",
                coverage_note="Fallback provider returned its default daily history window.",
            ),
            "max",
        ),
    ]
    incremental_payloads = [
        SimpleNamespace(
            provider="yfinance",
            provider_name="Yahoo Finance (yfinance)",
            price_rows=[
                {"date": "2020-01-01", "close": 10},
                {"date": "2020-01-02", "close": 11},
                {"date": "2020-01-03", "close": 12},
                {"date": "2020-01-04", "close": 13},
            ],
            action_rows=[],
            currency="USD",
            coverage_note=None,
        ),
        SimpleNamespace(
            provider="yfinance",
            provider_name="Yahoo Finance (yfinance)",
            price_rows=[
                {"date": "2020-01-02", "close": 99},
                {"date": "2020-01-03", "close": 12},
                {"date": "2020-01-04", "close": 13},
            ],
            action_rows=[],
            currency="USD",
            coverage_note=None,
        ),
    ]

    def fake_full_fetch(_symbol, **_kwargs):
        return full_payloads.pop(0)

    def fake_incremental_fetch(_symbol, **_kwargs):
        return incremental_payloads.pop(0)

    dev_server.fetch_full_symbol_history_result = fake_full_fetch
    dev_server.fetch_symbol_history_result = fake_incremental_fetch
    try:
        with isolated_runtime_store():
            snapshot, status = dev_server.get_or_refresh_cached_series("XYZ")
            assert_equal(status, "refreshed", "first run should full-refresh")
            assert_equal(snapshot["points"][0], ["2020-01-01", 10.0], "first full point")
            assert_equal(snapshot["provider"], "yfinance", "first provider should be stored")

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
            assert_equal(snapshot["provider"], "yahoo_finance15", "rebuilt provider should replace pin")
    finally:
        dev_server.fetch_full_symbol_history_result = original_full_fetch
        dev_server.fetch_symbol_history_result = original_incremental_fetch


def main() -> int:
    test_normalized_store_full_and_incremental_merge()
    test_legacy_series_cache_migrates_to_normalized_rows()
    test_overlap_validation_detects_price_and_action_changes()
    test_option_snapshot_and_realized_metrics_persist()
    test_options_screener_runs_persist()
    test_options_validation_payload_uses_cached_forward_prices()
    test_get_or_refresh_uses_full_then_incremental_then_rebuild()
    print("ok runtime store cache")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
