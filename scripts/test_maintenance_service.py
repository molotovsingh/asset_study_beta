#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from server import maintenance_service  # noqa: E402


def assert_equal(actual, expected, message):
    if actual != expected:
        raise AssertionError(f"{message}: expected {expected!r}, got {actual!r}")


def test_run_data_maintenance_reports_attention_from_thresholds_and_failures():
    original_list_symbol_universes = maintenance_service.list_symbol_universes
    original_collect_market_universe = maintenance_service.market_collector.collect_market_universe
    original_collect_options_evidence = maintenance_service.options_service.collect_options_evidence_for_universe
    original_collect_fundamental_universe = maintenance_service.fundamentals_collector.collect_fundamental_universe
    original_collector_universes = dict(maintenance_service.options_service.COLLECTOR_UNIVERSES)
    original_build_runtime_health_payload = maintenance_service.ops_service.build_runtime_health_payload

    maintenance_service.list_symbol_universes = lambda: [
        {
            "universeId": "us-core",
            "label": "US Core",
            "selectionKind": "manual",
            "exchange": None,
            "mic": None,
        }
    ]
    maintenance_service.market_collector.collect_market_universe = lambda *args, **kwargs: {
        "runId": 7,
        "universeId": "us-core",
        "successCount": 2,
        "failureCount": 0,
    }
    maintenance_service.options_service.COLLECTOR_UNIVERSES = {
        **original_collector_universes,
        "broken": {
            "universeId": "broken",
            "universeLabel": "Broken Universe",
            "minimumDte": 7,
            "maxContracts": 1,
            "symbols": ["FAIL"],
        },
    }

    def fake_collect_options(universe_id, **kwargs):  # noqa: ARG001
        if universe_id == "broken":
            raise RuntimeError("options provider unavailable")
        return {"universeId": universe_id, "signalVersion": "options-signal-v1"}

    def fake_collect_fundamentals(universe_id, **kwargs):
        if universe_id == "broken-fundamentals":
            raise RuntimeError("fundamental provider unavailable")
        return {
            "universeId": universe_id,
            "periodDays": kwargs.get("period_days"),
            "successCount": 2,
        }

    maintenance_service.options_service.collect_options_evidence_for_universe = fake_collect_options
    maintenance_service.fundamentals_collector.collect_fundamental_universe = fake_collect_fundamentals
    maintenance_service.ops_service.build_runtime_health_payload = lambda request: {
        "generatedAt": "2026-04-20T00:00:00+00:00",
        "summary": {
            "attentionSymbolCount": 5,
            "syncErrorCount": 2,
        },
        "requestEcho": request,
    }

    try:
        payload = maintenance_service.run_data_maintenance(
            market_universe_ids=["us-core"],
            options_universe_ids=["us-liquid-10", "broken"],
            fundamental_universe_ids=["sp500-current", "broken-fundamentals"],
            run_fundamental_collection=True,
            fundamental_period_days=366,
            health_stale_after_days=3,
            max_attention_symbols=3,
            max_sync_errors=1,
        )
    finally:
        maintenance_service.list_symbol_universes = original_list_symbol_universes
        maintenance_service.market_collector.collect_market_universe = original_collect_market_universe
        maintenance_service.options_service.collect_options_evidence_for_universe = original_collect_options_evidence
        maintenance_service.fundamentals_collector.collect_fundamental_universe = original_collect_fundamental_universe
        maintenance_service.options_service.COLLECTOR_UNIVERSES = original_collector_universes
        maintenance_service.ops_service.build_runtime_health_payload = original_build_runtime_health_payload

    assert_equal(payload["status"], "attention", "threshold breaches should mark the run as attention")
    assert_equal(
        payload["marketCollection"]["results"][0]["universeId"],
        "us-core",
        "market collection result should round-trip",
    )
    assert_equal(
        payload["optionsEvidence"]["results"][0]["universeId"],
        "us-liquid-10",
        "successful options evidence should round-trip",
    )
    assert_equal(
        payload["optionsEvidence"]["failures"][0]["universeId"],
        "broken",
        "options failure should be captured",
    )
    assert_equal(
        payload["fundamentals"]["results"][0]["universeId"],
        "sp500-current",
        "successful fundamental collection should round-trip",
    )
    assert_equal(
        payload["fundamentals"]["failures"][0]["universeId"],
        "broken-fundamentals",
        "fundamental failure should be captured",
    )
    assert_equal(
        payload["runtimeHealth"]["requestEcho"]["staleAfterDays"],
        3,
        "health request thresholds should be forwarded",
    )
    assert_equal(
        payload["failureReasons"],
        [
            "optionsFailures=1",
            "fundamentalFailures=1",
            "attentionSymbols=5>3",
            "syncErrors=2>1",
        ],
        "failure reasons should summarize threshold breaches and collector failures",
    )


def test_run_data_maintenance_defaults_to_ok_when_no_thresholds_are_breached():
    original_list_symbol_universes = maintenance_service.list_symbol_universes
    original_collect_market_universe = maintenance_service.market_collector.collect_market_universe
    original_collect_options_evidence = maintenance_service.options_service.collect_options_evidence_for_universe
    original_collector_universes = dict(maintenance_service.options_service.COLLECTOR_UNIVERSES)
    original_build_runtime_health_payload = maintenance_service.ops_service.build_runtime_health_payload

    maintenance_service.list_symbol_universes = lambda: [
        {
            "universeId": "us-core",
            "label": "US Core",
            "selectionKind": "manual",
            "exchange": None,
            "mic": None,
        }
    ]
    maintenance_service.market_collector.collect_market_universe = lambda *args, **kwargs: {"universeId": "us-core"}
    maintenance_service.options_service.collect_options_evidence_for_universe = lambda universe_id, **kwargs: {
        "universeId": universe_id
    }
    maintenance_service.ops_service.build_runtime_health_payload = lambda request: {
        "summary": {
            "attentionSymbolCount": 0,
            "syncErrorCount": 0,
        },
        "requestEcho": request,
    }

    try:
        payload = maintenance_service.run_data_maintenance(
            health_stale_after_days=5,
        )
    finally:
        maintenance_service.list_symbol_universes = original_list_symbol_universes
        maintenance_service.market_collector.collect_market_universe = original_collect_market_universe
        maintenance_service.options_service.collect_options_evidence_for_universe = original_collect_options_evidence
        maintenance_service.options_service.COLLECTOR_UNIVERSES = original_collector_universes
        maintenance_service.ops_service.build_runtime_health_payload = original_build_runtime_health_payload

    assert_equal(payload["status"], "ok", "absence of failures and threshold breaches should stay ok")
    assert_equal(payload["failureReasons"], [], "ok runs should have no failure reasons")


def test_run_data_maintenance_can_refresh_saved_study_readiness_explicitly():
    original_refresh_saved_studies = maintenance_service.saved_study_service.refresh_saved_study_readiness_batch
    original_build_runtime_health_payload = maintenance_service.ops_service.build_runtime_health_payload

    refresh_requests = []

    def fake_refresh_saved_studies(request):
        refresh_requests.append(request)
        return {
            "status": "ok",
            "refreshedCount": 2,
            "skippedCount": 1,
            "failedCount": 0,
        }

    maintenance_service.saved_study_service.refresh_saved_study_readiness_batch = fake_refresh_saved_studies
    maintenance_service.ops_service.build_runtime_health_payload = lambda request: {
        "summary": {
            "attentionSymbolCount": 0,
            "syncErrorCount": 0,
        },
    }

    try:
        payload = maintenance_service.run_data_maintenance(
            run_market_collection=False,
            run_options_collection=False,
            refresh_saved_study_readiness=True,
            refresh_saved_study_include_cold=False,
        )
    finally:
        maintenance_service.saved_study_service.refresh_saved_study_readiness_batch = original_refresh_saved_studies
        maintenance_service.ops_service.build_runtime_health_payload = original_build_runtime_health_payload

    assert_equal(refresh_requests, [{"includeCold": False}], "maintenance should pass saved-study refresh policy")
    assert_equal(
        payload["savedStudies"]["refreshedCount"],
        2,
        "maintenance payload should include saved-study readiness result",
    )
    assert_equal(payload["status"], "ok", "successful saved-study refresh should keep maintenance ok")


def main():
    test_run_data_maintenance_reports_attention_from_thresholds_and_failures()
    test_run_data_maintenance_defaults_to_ok_when_no_thresholds_are_breached()
    test_run_data_maintenance_can_refresh_saved_study_readiness_explicitly()
    print("ok maintenance service")


if __name__ == "__main__":
    main()
