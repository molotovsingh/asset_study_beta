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
from server import saved_study_service, study_builder_service  # noqa: E402


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


def test_saved_study_persists_plan_dependencies_artifacts_and_recipe_projection():
    with isolated_runtime_store():
        plan = {
            "version": "study-plan-v1",
            "studyId": "risk-adjusted-return",
            "viewId": "relative",
            "params": {
                "subject": "Nifty 50",
                "benchmark": "Custom Benchmark",
                "start": "2021-01-01",
                "end": "2026-04-08",
            },
            "requiresConfirmation": True,
        }
        preview = {
            "studyTitle": "Risk-Adjusted Return",
            "viewLabel": "Relative",
            "routeHash": "#risk-adjusted-return/relative?subject=Nifty+50&benchmark=Custom+Benchmark",
            "canRun": True,
        }
        payload = saved_study_service.save_validated_saved_study(
            {
                "name": "Nifty relative risk",
                "plan": plan,
                "routeHash": preview["routeHash"],
                "preview": preview,
            }
        )

        assert_equal(payload["version"], "saved-study-v1", "save payload version")
        assert_true(payload["ok"], "save should succeed")
        saved = payload["savedStudy"]
        assert_equal(saved["status"], "active", "saved study should be active")
        assert_equal(saved["keepWarm"], True, "keep warm should default true")
        assert_equal(saved["routeHash"], preview["routeHash"], "route hash should persist")
        dependency_keys = {entry["dependencyKey"] for entry in saved["dependencies"]}
        assert_equal(
            dependency_keys,
            {
                "priceHistory:subject:nifty 50",
                "priceHistory:benchmark:custom benchmark",
            },
            "relative risk should extract subject and benchmark dependencies",
        )
        assert_equal(
            saved["readiness"]["status"],
            "attention",
            "unverified custom symbols should create readiness attention",
        )
        artifact_types = {artifact["artifactType"] for artifact in saved["artifacts"]}
        assert_true("study-plan" in artifact_types, "study-plan artifact should persist")
        assert_true("dependency-manifest" in artifact_types, "dependency artifact should persist")
        assert_true("readiness-snapshot" in artifact_types, "readiness artifact should persist")

        listed = runtime_store.list_saved_studies()
        assert_equal(len(listed), 1, "saved study should list")
        assert_equal(listed[0]["id"], saved["id"], "listed saved study id")

        recipe = saved_study_service.saved_study_to_recipe(saved)
        assert_equal(recipe["id"], saved["id"], "recipe projection should use saved study id")
        assert_equal(recipe["plan"], plan, "recipe projection should preserve canonical plan")


def test_saved_study_archives_without_deleting_artifacts_and_refreshes_readiness():
    with isolated_runtime_store():
        plan = {
            "version": "study-plan-v1",
            "studyId": "monthly-straddle",
            "viewId": "overview",
            "params": {"subject": "AAPL", "dte": "20", "count": "3"},
            "requiresConfirmation": True,
        }
        saved = saved_study_service.save_validated_saved_study(
            {
                "name": "AAPL monthly straddle",
                "plan": plan,
                "routeHash": "#monthly-straddle/overview?subject=AAPL&dte=20&count=3",
            }
        )["savedStudy"]

        dependency_capabilities = {
            entry["requiredCapability"]
            for entry in saved["dependencies"]
        }
        assert_equal(
            dependency_capabilities,
            {"optionsUnderlying", "priceHistory"},
            "monthly straddle should extract options and price dependencies",
        )

        refresh_payload = saved_study_service.refresh_saved_study_readiness(
            {"id": saved["id"]}
        )
        assert_equal(refresh_payload["version"], "saved-study-v1", "refresh payload version")
        assert_equal(
            refresh_payload["savedStudy"]["latestRefreshRun"]["status"],
            "attention",
            "refresh run should record readiness attention",
        )

        archived_payload = saved_study_service.archive_saved_study({"id": saved["id"]})
        assert_true(archived_payload["ok"], "archive should succeed")
        assert_equal(
            runtime_store.list_saved_studies(),
            [],
            "archived study should be hidden from active list",
        )
        archived = runtime_store.load_saved_study(saved["id"], include_archived=True)
        assert_equal(archived["status"], "archived", "archived status should persist")
        assert_true(len(archived["artifacts"]) >= 3, "archive should preserve artifacts")


def test_study_builder_recipe_save_uses_saved_studies_without_breaking_recipe_api():
    with isolated_runtime_store():
        original_validate = study_builder_service.build_study_builder_validation_payload
        plan = {
            "version": "study-plan-v1",
            "studyId": "risk-adjusted-return",
            "viewId": "overview",
            "params": {"subject": "AAPL", "start": "2021-01-01", "end": "2026-04-08"},
            "requiresConfirmation": True,
        }

        def fake_validate(_request):
            return {
                "version": "study-builder-validation-response-v1",
                "mode": "plan",
                "validation": {
                    "ok": True,
                    "normalizedPlan": plan,
                    "routeHash": "#risk-adjusted-return/overview?subject=AAPL",
                },
                "normalizedPlan": plan,
                "preview": {
                    "studyTitle": "Risk-Adjusted Return",
                    "viewLabel": "Overview",
                    "routeHash": "#risk-adjusted-return/overview?subject=AAPL",
                    "canRun": True,
                },
            }

        study_builder_service.build_study_builder_validation_payload = fake_validate
        try:
            payload = study_builder_service.save_study_plan_recipe(
                {"name": "AAPL risk", "plan": plan}
            )
        finally:
            study_builder_service.build_study_builder_validation_payload = original_validate

        assert_true(payload["ok"], "recipe save should still succeed")
        assert_true(payload["savedStudy"], "recipe save should return saved study context")
        assert_equal(len(payload["recipes"]), 1, "recipe API should still list saved item")
        assert_equal(payload["recipes"][0]["id"], payload["savedStudy"]["id"], "recipe id should align")


def test_saved_study_edge_cases_and_archived_listing():
    with isolated_runtime_store():
        try:
            saved_study_service.save_validated_saved_study({"plan": {"version": "wrong"}})
            raise AssertionError("invalid plan version should be rejected")
        except ValueError as error:
            assert_true("study-plan-v1" in str(error), "invalid plan error should name contract")

        unsupported_plan = {
            "version": "study-plan-v1",
            "studyId": "future-study",
            "viewId": "overview",
            "params": {"subject": "AAPL"},
            "requiresConfirmation": True,
        }
        route_hash = "#future-study/overview?subject=AAPL"
        first = saved_study_service.save_validated_saved_study(
            {
                "id": "edge-future-study",
                "name": "Future study",
                "plan": unsupported_plan,
                "routeHash": route_hash,
                "keepWarm": False,
                "notes": "first save",
            }
        )["savedStudy"]
        assert_equal(first["keepWarm"], False, "explicit keepWarm false should persist")
        assert_equal(first["readiness"]["status"], "attention", "unsupported dependencies should need attention")
        assert_equal(
            first["dependencies"][0]["verificationStatus"],
            "unsupported",
            "unsupported study should be recorded as unsupported dependency",
        )

        second = saved_study_service.save_validated_saved_study(
            {
                "id": "edge-future-study",
                "name": "Future study updated",
                "plan": unsupported_plan,
                "routeHash": route_hash,
                "notes": "second save",
            }
        )["savedStudy"]
        assert_equal(second["name"], "Future study updated", "duplicate save should update in place")
        assert_equal(len(runtime_store.list_saved_studies()), 1, "duplicate save should not create a second row")

        linked = saved_study_service.link_run_to_matching_saved_studies(
            {
                "runId": 77,
                "status": "success",
                "completedAt": "2026-05-23T00:00:00+00:00",
                "studyId": "future-study",
                "routeHash": route_hash,
            }
        )
        assert_equal(len(linked), 1, "matching active saved study should link to run")
        assert_equal(
            linked[0]["latestRunLink"]["runId"],
            77,
            "latest-run-link artifact should point at linked run",
        )

        archived_payload = saved_study_service.archive_saved_study({"id": first["id"]})
        assert_true(archived_payload["ok"], "edge saved study should archive")
        assert_equal(runtime_store.list_saved_studies(), [], "active list should hide archived rows")
        archived_list = saved_study_service.build_saved_study_state_payload(
            {"includeArchived": "true", "limit": "10"}
        )["savedStudies"]
        assert_equal(len(archived_list), 1, "includeArchived list should include archived rows")
        assert_equal(archived_list[0]["status"], "archived", "archived list should expose archived status")

        try:
            saved_study_service.build_saved_study_state_payload([])
            raise AssertionError("non-object state request should be rejected")
        except ValueError as error:
            assert_true("JSON object" in str(error), "non-object state error should be specific")

        try:
            saved_study_service.refresh_saved_study_readiness({"id": "missing-saved-study"})
            raise AssertionError("unknown saved study refresh should be rejected")
        except ValueError as error:
            assert_true("not found" in str(error), "unknown refresh error should be specific")


def main():
    test_saved_study_persists_plan_dependencies_artifacts_and_recipe_projection()
    test_saved_study_archives_without_deleting_artifacts_and_refreshes_readiness()
    test_study_builder_recipe_save_uses_saved_studies_without_breaking_recipe_api()
    test_saved_study_edge_cases_and_archived_listing()
    print("ok saved studies")


if __name__ == "__main__":
    main()
