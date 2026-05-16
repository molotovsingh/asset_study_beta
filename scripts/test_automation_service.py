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
from server import automation_service  # noqa: E402


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


def seed_market_universe():
    runtime_store.upsert_symbol_universe(
        "smoke-aapl",
        "Smoke AAPL",
        selection_kind="manual",
        source_provider="manual",
    )
    runtime_store.sync_symbol_universe_members(
        "smoke-aapl",
        [{"symbol": "AAPL", "label": "Apple"}],
        source_provider="manual",
        replace=False,
    )


def test_automation_config_round_trips_and_due_detection_work():
    with isolated_runtime_store():
        saved = runtime_store.upsert_automation_config(
            {
                "automationId": "daily-maintenance",
                "label": "Daily Maintenance",
                "intervalMinutes": 60,
                "runMarketCollection": True,
                "marketUniverseIds": ["smoke-aapl"],
                "runOptionsCollection": False,
                "optionsUniverseIds": [],
                "isActive": True,
            }
        )
        assert_equal(saved["automationId"], "daily-maintenance", "automation id should persist")
        hydrated = automation_service.build_automation_state_payload()["automations"][0]
        assert_equal(
            hydrated["marketProviderOrder"],
            ["finnhub", "yfinance"],
            "automation state should hydrate a default market provider order for older rows",
        )

        due_now = runtime_store.load_due_automation_configs(reference_time_iso="2026-04-20T10:00:00+00:00")
        assert_equal(len(due_now), 1, "never-run active automation should be due immediately")

        runtime_store.update_automation_run_state(
            "daily-maintenance",
            is_running=False,
            started_at="2026-04-20T09:00:00+00:00",
            completed_at="2026-04-20T09:05:00+00:00",
            status="ok",
            summary={"status": "ok"},
        )

        due_early = runtime_store.load_due_automation_configs(reference_time_iso="2026-04-20T09:30:00+00:00")
        assert_equal(len(due_early), 0, "recently-run automation should not be due yet")

        due_late = runtime_store.load_due_automation_configs(reference_time_iso="2026-04-20T10:06:00+00:00")
        assert_equal(len(due_late), 1, "automation should become due after its interval")


def test_automation_service_save_run_and_delete():
    with isolated_runtime_store():
        seed_market_universe()

        original_runner = automation_service.maintenance_service.run_data_maintenance
        original_options_universes = dict(automation_service.options_service.COLLECTOR_UNIVERSES)
        automation_service.options_service.COLLECTOR_UNIVERSES = {
            "us-liquid-10": {
                "universeId": "us-liquid-10",
                "universeLabel": "US Liquid 10",
                "minimumDte": 7,
                "maxContracts": 1,
                "symbols": ["AAPL"],
            }
        }

        def fake_runner(**kwargs):
            return {
                "status": "ok",
                "failureReasons": [],
                "marketCollection": {
                    "requestedUniverseIds": kwargs.get("market_universe_ids") or [],
                    "results": [],
                    "failures": [],
                },
                "optionsEvidence": {
                    "requestedUniverseIds": kwargs.get("options_universe_ids") or [],
                    "results": [],
                    "failures": [],
                },
                "runtimeHealth": {
                    "summary": {
                        "attentionSymbolCount": 0,
                        "syncErrorCount": 0,
                    }
                },
            }

        automation_service.maintenance_service.run_data_maintenance = fake_runner
        try:
            saved_payload = automation_service.save_automation_config(
                {
                    "automationId": "daily-maintenance",
                    "label": "Daily Maintenance",
                    "intervalMinutes": 1440,
                    "runMarketCollection": True,
                    "marketUniverseIds": ["smoke-aapl"],
                    "runOptionsCollection": True,
                    "optionsUniverseIds": ["us-liquid-10"],
                    "maxAttentionSymbols": 0,
                    "maxSyncErrors": 0,
                    "isActive": True,
                }
            )
            assert_equal(
                saved_payload["automation"]["marketUniverseIds"],
                ["smoke-aapl"],
                "market universes should round-trip through save",
            )
            assert_equal(
                saved_payload["automation"]["marketProviderOrder"],
                ["finnhub", "yfinance"],
                "save should preserve the default market provider order when the form omits it",
            )

            run_payload = automation_service.run_automation_now(
                {"automationId": "daily-maintenance"},
            )
            assert_equal(run_payload["result"]["status"], "ok", "run-now should return execution result")
            updated = next(
                entry
                for entry in run_payload["state"]["automations"]
                if entry["automationId"] == "daily-maintenance"
            )
            assert_equal(updated["lastRunStatus"], "ok", "run-now should persist last run status")
            assert_true(bool(updated["lastRunCompletedAt"]), "run-now should persist completion time")

            deleted_payload = automation_service.remove_automation_config(
                {"automationId": "daily-maintenance"},
            )
            assert_equal(
                deleted_payload["deletedAutomationId"],
                "daily-maintenance",
                "delete should report removed id",
            )
            assert_equal(
                len(deleted_payload["state"]["automations"]),
                0,
                "delete should remove the automation from state",
            )
        finally:
            automation_service.maintenance_service.run_data_maintenance = original_runner
            automation_service.options_service.COLLECTOR_UNIVERSES = original_options_universes


def main():
    test_automation_config_round_trips_and_due_detection_work()
    test_automation_service_save_run_and_delete()
    print("ok automation service")


if __name__ == "__main__":
    main()
