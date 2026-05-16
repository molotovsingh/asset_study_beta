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
from server import study_run_service  # noqa: E402


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


def test_study_run_round_trip_and_defaults():
    with isolated_runtime_store():
        recorded = runtime_store.record_study_run(
            {
                "studyId": "options-screener",
                "studyTitle": "Options Screener",
                "selectionLabel": "US Liquid 10",
                "subjectQuery": "us-liquid-10",
                "detailLabel": "10 rows · IV/HV20 · 25D minimum",
                "routeHash": "#options-screener/overview?u=us-liquid-10",
                "summaryItems": [
                    {
                        "summaryKey": "filtered-rows",
                        "label": "Filtered Rows",
                        "valueNumber": 10,
                        "valueKind": "integer",
                    }
                ],
                "links": [
                    {
                        "linkType": "evidence-source",
                        "targetKind": "options_screener_run",
                        "targetId": "42",
                        "targetLabel": "US Liquid 10 run #42",
                        "metadata": {"signalVersion": "options-screener-v2"},
                    }
                ],
                "completedAt": "2026-05-15T10:00:00+00:00",
            }
        )
        assert_equal(recorded["studyId"], "options-screener", "study id should persist")
        assert_equal(recorded["status"], "success", "status should default to success")
        assert_equal(recorded["runKind"], "analysis", "run kind should default to analysis")
        assert_equal(recorded["routeHash"], "#options-screener/overview?u=us-liquid-10", "route hash should persist")
        assert_equal(recorded["summaryItems"][0]["label"], "Filtered Rows", "summary items should round-trip")
        assert_equal(recorded["links"][0]["targetId"], "42", "links should round-trip")

        runs = runtime_store.list_study_runs(limit=5)
        assert_equal(len(runs), 1, "study run should be queryable")
        assert_equal(runs[0]["detailLabel"], "10 rows · IV/HV20 · 25D minimum", "detail label should round-trip")
        assert_equal(runs[0]["summaryItems"][0]["valueNumber"], 10, "stored summary item value should persist")
        assert_equal(
            runs[0]["links"][0]["metadata"]["signalVersion"],
            "options-screener-v2",
            "stored link metadata should persist",
        )
        loaded = runtime_store.load_study_run_by_id(recorded["runId"])
        assert_equal(loaded["runId"], recorded["runId"], "study run should load by id")
        assert_equal(
            loaded["summaryItems"][0]["label"],
            "Filtered Rows",
            "study run loaded by id should include summaries",
        )


def test_study_run_service_payloads():
    with isolated_runtime_store():
        saved = study_run_service.record_study_run_entry(
            {
                "studyId": "monthly-straddle",
                "studyTitle": "Monthly Straddle",
                "selectionLabel": "AAPL",
                "subjectQuery": "AAPL",
                "symbol": "AAPL",
                "actualEndDate": "2026-05-15",
                "detailLabel": "25D minimum · 4 contract(s)",
                "routeHash": "#monthly-straddle/overview?subject=AAPL",
                "completedAt": "2026-05-15T11:00:00+00:00",
            }
        )
        assert_equal(saved["run"]["symbol"], "AAPL", "service should record symbol")

        payload = study_run_service.build_study_run_history_payload({"limit": 12})
        assert_equal(len(payload["runs"]), 1, "history payload should return saved runs")
        assert_equal(payload["runs"][0]["studyTitle"], "Monthly Straddle", "history payload should preserve study title")


def test_warning_messages_derive_count_and_round_trip():
    with isolated_runtime_store():
        recorded = runtime_store.record_study_run(
            {
                "studyId": "risk-adjusted-return",
                "studyTitle": "Risk-Adjusted Return",
                "selectionLabel": "Nifty 50",
                "subjectQuery": "Nifty 50",
                "resolvedParams": {
                    "warningMessages": [
                        "Loaded data is marked as a Price proxy for TRI.",
                        "Loaded data is marked as a Price proxy for TRI.",
                        "",
                    ]
                },
                "completedAt": "2026-05-15T12:00:00+00:00",
            }
        )
        assert_equal(
            recorded["warningCount"],
            1,
            "warning count should derive from unique warning messages when omitted",
        )
        assert_equal(
            recorded["resolvedParams"]["warningMessages"],
            ["Loaded data is marked as a Price proxy for TRI."],
            "warning messages should be deduped and stored in resolved params",
        )
        loaded = runtime_store.load_study_run_by_id(recorded["runId"])
        assert_equal(
            loaded["warningCount"],
            1,
            "loaded run should preserve derived warning count",
        )
        assert_equal(
            loaded["resolvedParams"]["warningMessages"],
            ["Loaded data is marked as a Price proxy for TRI."],
            "loaded run should preserve normalized warning messages",
        )

        saved = study_run_service.record_study_run_entry(
            {
                "studyId": "rolling-returns",
                "studyTitle": "Rolling Returns",
                "selectionLabel": "Nifty 50",
                "subjectQuery": "Nifty 50",
                "warnings": ["Actual data window was clipped."],
                "warningCount": 0,
                "completedAt": "2026-05-15T12:30:00+00:00",
            }
        )
        assert_equal(
            saved["run"]["warningCount"],
            1,
            "service should not undercount top-level warning messages",
        )
        assert_equal(
            saved["run"]["resolvedParams"]["warningMessages"],
            ["Actual data window was clipped."],
            "service should persist top-level warning messages into resolved params",
        )
        history = study_run_service.build_study_run_history_payload({"limit": 5})
        assert_equal(
            history["runs"][0]["warningCount"],
            1,
            "history should expose normalized warning count",
        )
        assert_equal(
            history["runs"][0]["resolvedParams"]["warningMessages"],
            ["Actual data window was clipped."],
            "history should expose normalized warning messages",
        )


def main():
    test_study_run_round_trip_and_defaults()
    test_study_run_service_payloads()
    test_warning_messages_derive_count_and_round_trip()
    print("ok study run service")


if __name__ == "__main__":
    main()
