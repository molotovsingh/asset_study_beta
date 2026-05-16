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
from server import study_builder_service  # noqa: E402


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


def assert_raises(error_type, func, message):
    try:
        func()
    except error_type:
        return
    raise AssertionError(message)


def test_study_builder_plan_payload_drafts_route_safe_plan():
    payload = study_builder_service.build_study_builder_plan_payload(
        {"intent": "Compare Nifty 50 against Sensex from 2021 to 2024"}
    )
    assert_equal(payload["version"], "study-builder-plan-response-v1", "plan response version")
    assert_equal(
        payload["plannerResult"]["version"],
        "intent-planner-v1",
        "planner result version",
    )
    assert_equal(
        payload["plan"]["studyId"],
        "risk-adjusted-return",
        "planner should draft expected study",
    )
    assert_equal(payload["preview"]["canRun"], True, "draft preview should be route-safe")


def test_study_builder_validation_payload_validates_plan_and_routes():
    plan_payload = study_builder_service.build_study_builder_validation_payload(
        {
            "plan": {
                "version": "study-plan-v1",
                "studyId": "options-screener",
                "viewId": "overview",
                "params": {"u": "us-liquid-10"},
                "requiresConfirmation": True,
            }
        }
    )
    assert_equal(plan_payload["version"], "study-builder-validation-response-v1", "validation version")
    assert_equal(plan_payload["mode"], "plan", "plan validation mode")
    assert_equal(plan_payload["validation"]["ok"], True, "valid plan should pass")
    assert_equal(
        plan_payload["preview"]["routeHash"],
        "#options-screener/overview?u=us-liquid-10",
        "preview should include the deterministic route hash",
    )

    route_payload = study_builder_service.build_study_builder_validation_payload(
        {"routeHash": "#drawdown-study/overview?subject=TSLA"}
    )
    assert_equal(route_payload["mode"], "route", "route validation mode")
    assert_equal(route_payload["route"]["ok"], True, "valid route should convert")
    assert_equal(
        route_payload["preview"]["normalizedPlan"]["studyId"],
        "drawdown-study",
        "route preview should contain the converted plan",
    )


def test_study_builder_service_rejects_non_object_requests():
    assert_raises(
        ValueError,
        lambda: study_builder_service.build_study_builder_plan_payload([]),
        "plan endpoint should reject non-object requests",
    )
    assert_raises(
        ValueError,
        lambda: study_builder_service.build_study_builder_validation_payload([]),
        "validate endpoint should reject non-object requests",
    )


def test_study_builder_rejects_wrong_nested_contract_versions():
    original_bridge = study_builder_service._run_study_builder_bridge

    def wrong_plan_bridge(mode, _request):
        if mode == "plan":
            return {
                "version": "study-builder-plan-response-v1",
                "plannerResult": {"version": "wrong-planner-v1"},
                "plan": {"version": "study-plan-v1"},
                "preview": {},
            }
        return {}

    study_builder_service._run_study_builder_bridge = wrong_plan_bridge
    try:
        assert_raises(
            RuntimeError,
            lambda: study_builder_service.build_study_builder_plan_payload({"intent": "risk"}),
            "plan payload should reject wrong nested planner version",
        )
    finally:
        study_builder_service._run_study_builder_bridge = original_bridge

    def wrong_validation_bridge(mode, _request):
        if mode == "validate":
            return {
                "version": "study-builder-validation-response-v1",
                "mode": "plan",
                "validation": {
                    "ok": True,
                    "normalizedPlan": {"version": "wrong-study-plan-v1"},
                },
                "preview": {},
            }
        return {}

    study_builder_service._run_study_builder_bridge = wrong_validation_bridge
    try:
        assert_raises(
            RuntimeError,
            lambda: study_builder_service.build_study_builder_validation_payload(
                {"plan": {"version": "study-plan-v1"}}
            ),
            "validation payload should reject wrong nested StudyPlan version",
        )
    finally:
        study_builder_service._run_study_builder_bridge = original_bridge


def test_study_plan_recipe_backend_round_trip():
    plan = {
        "version": "study-plan-v1",
        "studyId": "risk-adjusted-return",
        "viewId": "relative",
        "params": {
            "subject": "Nifty 50",
            "benchmark": "Sensex",
            "start": "2021-01-01",
            "end": "2024-12-31",
        },
        "requiresConfirmation": True,
    }

    with isolated_runtime_store():
        initial_payload = study_builder_service.build_study_plan_recipe_state_payload({})
        assert_equal(initial_payload["version"], "study-plan-recipes-v1", "recipe state version")
        assert_equal(initial_payload["recipes"], [], "recipe store should start empty")

        saved = study_builder_service.save_study_plan_recipe(
            {"name": "Nifty relative risk", "plan": plan}
        )
        assert_equal(saved["ok"], True, "valid recipe should save")
        assert_equal(saved["recipe"]["name"], "Nifty relative risk", "recipe name should persist")
        assert_equal(
            saved["recipe"]["routeHash"],
            "#risk-adjusted-return/relative?benchmark=Sensex&end=2024-12-31&start=2021-01-01&subject=Nifty+50",
            "recipe route hash should be deterministic",
        )
        assert_equal(len(saved["recipes"]), 1, "save payload should include refreshed recipes")

        invalid = study_builder_service.save_study_plan_recipe(
            {"name": "Broken", "plan": {"version": "study-plan-v1"}}
        )
        assert_equal(invalid["ok"], False, "invalid recipe save should be a blocked result, not an exception")
        assert_equal(len(invalid["recipes"]), 1, "invalid recipe should not be persisted")

        deleted = study_builder_service.remove_study_plan_recipe({"id": saved["recipe"]["id"]})
        assert_equal(deleted["ok"], True, "existing recipe should delete")
        assert_equal(deleted["recipes"], [], "delete payload should return refreshed recipes")


def test_study_builder_bridge_failure_and_timeout_are_bad_gateway_class_errors():
    original_bridge_path = study_builder_service.STUDY_BUILDER_BRIDGE_PATH
    study_builder_service.STUDY_BUILDER_BRIDGE_PATH = original_bridge_path.with_name(
        "missing-study-builder-bridge.mjs"
    )
    try:
        assert_raises(
            RuntimeError,
            lambda: study_builder_service.build_study_builder_plan_payload({"intent": "risk"}),
            "missing bridge should raise RuntimeError for 502 mapping",
        )
    finally:
        study_builder_service.STUDY_BUILDER_BRIDGE_PATH = original_bridge_path

    with tempfile.TemporaryDirectory(dir=runtime_store.REPO_ROOT) as temp_dir:
        slow_bridge_path = Path(temp_dir) / "slow-study-builder-bridge.mjs"
        slow_bridge_path.write_text("setTimeout(() => {}, 60000);\n", encoding="utf-8")
        original_timeout = study_builder_service.STUDY_BUILDER_BRIDGE_TIMEOUT_SECONDS
        study_builder_service.STUDY_BUILDER_BRIDGE_PATH = slow_bridge_path
        study_builder_service.STUDY_BUILDER_BRIDGE_TIMEOUT_SECONDS = 0.05
        try:
            assert_raises(
                RuntimeError,
                lambda: study_builder_service.build_study_builder_validation_payload(
                    {"routeHash": "#risk-adjusted-return/overview?subject=Nifty+50"}
                ),
                "slow bridge should raise RuntimeError for 502 mapping",
            )
        finally:
            study_builder_service.STUDY_BUILDER_BRIDGE_PATH = original_bridge_path
            study_builder_service.STUDY_BUILDER_BRIDGE_TIMEOUT_SECONDS = original_timeout


def main():
    test_study_builder_plan_payload_drafts_route_safe_plan()
    test_study_builder_validation_payload_validates_plan_and_routes()
    test_study_builder_service_rejects_non_object_requests()
    test_study_builder_rejects_wrong_nested_contract_versions()
    test_study_plan_recipe_backend_round_trip()
    test_study_builder_bridge_failure_and_timeout_are_bad_gateway_class_errors()
    print("ok study builder service")


if __name__ == "__main__":
    main()
