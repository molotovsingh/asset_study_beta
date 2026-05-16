#!/usr/bin/env python3

from __future__ import annotations

import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import runtime_store  # noqa: E402
from server import assistant_service  # noqa: E402


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


def record_successful_run() -> dict:
    return runtime_store.record_study_run(
        {
            "studyId": "options-screener",
            "studyTitle": "Options Screener",
            "viewId": "overview",
            "selectionLabel": "US Liquid 10",
            "subjectQuery": "us-liquid-10",
            "routeHash": "#options-screener/overview?u=us-liquid-10",
            "requestedStartDate": "2026-04-08",
            "requestedEndDate": "2026-04-10",
            "actualStartDate": "2026-04-08",
            "actualEndDate": "2026-04-10",
            "summaryItems": [
                {
                    "summaryKey": "filtered-rows",
                    "label": "Filtered Rows",
                    "valueNumber": 7,
                    "valueKind": "integer",
                }
            ],
            "links": [
                {
                    "linkType": "evidence-source",
                    "targetKind": "options_screener_run",
                    "targetId": "123",
                    "targetLabel": "US Liquid 10 run #123",
                }
            ],
            "dataSnapshotRefs": [{"kind": "cache-series", "symbol": "AAPL"}],
            "completedAt": "2026-05-15T10:00:00+00:00",
        }
    )


def test_successful_run_brief_payload():
    with isolated_runtime_store():
        recorded = record_successful_run()
        payload = assistant_service.build_study_run_brief_payload(
            {"runId": recorded["runId"]}
        )
        assert_equal(payload["run"]["runId"], recorded["runId"], "payload should return the exact run")
        assert_equal(payload["handoff"]["version"], "study-run-handoff-v1", "handoff version")
        assert_equal(
            payload["explanationBrief"]["version"],
            "study-run-explanation-brief-v1",
            "brief version",
        )
        assert_true(
            payload["explanationBrief"]["resultConclusionAllowed"],
            "successful run should allow result explanation",
        )
        assert_true(
            payload["explanationBrief"]["replay"]["canReplay"],
            "recorded route should produce a route-safe replay plan",
        )


def test_assistant_contract_payload():
    payload = assistant_service.build_assistant_contract_payload({})
    assert_equal(payload["version"], "assistant-contract-v1", "assistant contract version")
    assert_true(
        any(
            endpoint.get("path") == "/api/assistant/study-run-brief"
            for endpoint in payload["backendEndpoints"]
        ),
        "assistant contract should expose the run brief backend endpoint",
    )
    assert_true(
        any(
            endpoint.get("path") == "/api/assistant/contract"
            for endpoint in payload["backendEndpoints"]
        ),
        "assistant contract should expose its backend contract endpoint",
    )


def test_assistant_contract_bundle_payload():
    payload = assistant_service.build_assistant_contract_bundle_payload({})
    assert_equal(payload["version"], "assistant-contract-bundle-v1", "assistant contract bundle version")
    contracts = payload["contracts"]
    assert_equal(
        contracts["assistant"]["version"],
        "assistant-contract-v1",
        "bundle should include assistant contract",
    )
    assert_equal(
        contracts["studyPlan"]["version"],
        "study-plan-v1",
        "bundle should include StudyPlan contract",
    )
    assert_true(
        isinstance(contracts["metricRegistry"]["rules"], list),
        "bundle should include metric registry rules",
    )
    assert_true(
        isinstance(contracts["studyCatalog"]["studies"], list),
        "bundle should include study catalog entries",
    )


def test_assistant_readiness_payload_is_keyless_and_route_aware():
    payload = assistant_service.build_assistant_readiness_payload({"artifactChecks": "false"})
    assert_equal(payload["version"], "assistant-readiness-v1", "assistant readiness version")
    assert_equal(payload["status"], "ok", "assistant readiness should pass without generated-doc drift commands")
    assert_equal(
        payload["liveAiTesting"]["requiredForReadiness"],
        False,
        "assistant readiness should not require live AI keys",
    )
    check_by_id = {check["id"]: check for check in payload["checks"]}
    assert_true(
        check_by_id["assistant-contract-bundle-keys"]["ok"],
        "assistant readiness should verify required bundle keys",
    )
    assert_true(
        check_by_id["assistant-backend-routes"]["ok"],
        "assistant readiness should verify contract endpoints are route-wired",
    )
    assert_true(
        any(
            check["id"] == "assistant-artifact-study-plan"
            and check["ok"]
            and check["severity"] == "info"
            for check in payload["checks"]
        ),
        "assistant readiness should support skipping generated-doc drift commands",
    )


def test_assistant_study_plan_dry_run_is_keyless_and_non_executing():
    payload = assistant_service.build_assistant_study_plan_dry_run_payload(
        {"intent": "Compare Nifty 50 against Sensex from 2021 to 2024"}
    )
    assert_equal(
        payload["version"],
        "assistant-study-plan-dry-run-v1",
        "assistant dry-run version",
    )
    assert_equal(payload["mode"], "intent", "assistant dry-run mode")
    assert_equal(
        payload["plannerResult"]["version"],
        "intent-planner-v1",
        "assistant dry-run should include planner result",
    )
    assert_equal(
        payload["plan"]["studyId"],
        "risk-adjusted-return",
        "assistant dry-run should draft expected study",
    )
    assert_equal(payload["validation"]["ok"], True, "assistant dry-run plan should validate")
    assert_equal(payload["canRun"], True, "assistant dry-run preview should be runnable")
    assert_equal(
        payload["execution"]["executed"],
        False,
        "assistant dry-run must not execute the study",
    )
    assert_equal(
        payload["readiness"]["liveAiTesting"]["requiredForReadiness"],
        False,
        "assistant dry-run should remain keyless",
    )


def test_assistant_study_plan_dry_run_rejects_missing_intent():
    for request in [{}, {"intent": ""}, []]:
        assert_raises(
            ValueError,
            lambda request=request: assistant_service.build_assistant_study_plan_dry_run_payload(request),
            f"assistant dry-run should reject invalid request: {request!r}",
        )


def test_assistant_study_plan_live_draft_validates_model_plan():
    fake_response = {
        "id": "resp_test_123",
        "status": "completed",
        "output": [
            {
                "type": "message",
                "content": [
                    {
                        "type": "output_text",
                        "text": (
                            '{"version":"study-plan-v1","studyId":"risk-adjusted-return",'
                            '"viewId":"relative","params":{"subject":"Nifty 50",'
                            '"benchmark":"Sensex","start":"2021-01-01","end":"2024-12-31"},'
                            '"requiresConfirmation":true}'
                        ),
                    }
                ],
            }
        ],
    }
    with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key", "OPENAI_MODEL": "gpt-test"}, clear=False), patch.object(
        assistant_service,
        "_call_openai_responses_api",
        return_value=fake_response,
    ) as openai_call:
        payload = assistant_service.build_assistant_study_plan_live_draft_payload(
            {"intent": "Compare Nifty 50 against Sensex from 2021 to 2024"}
        )

    assert_equal(
        payload["version"],
        "assistant-study-plan-live-draft-v1",
        "assistant live draft version",
    )
    assert_equal(payload["provider"], "openai", "assistant live draft provider")
    assert_equal(payload["model"], "gpt-test", "assistant live draft should use configured model")
    assert_equal(payload["modelResult"]["responseId"], "resp_test_123", "response id should be preserved")
    assert_equal(payload["plan"]["viewId"], "relative", "model plan should be returned")
    assert_equal(payload["validation"]["ok"], True, "model plan should be deterministically validated")
    assert_equal(payload["preview"]["canRun"], True, "model plan should produce a runnable preview")
    assert_equal(payload["execution"]["executed"], False, "live draft must not execute a study")
    assert_true(openai_call.called, "live draft should call the OpenAI bridge")


def test_assistant_study_plan_live_draft_requires_key():
    with patch.dict("os.environ", {"OPENAI_API_KEY": ""}, clear=False):
        assert_raises(
            ValueError,
            lambda: assistant_service.build_assistant_study_plan_live_draft_payload(
                {"intent": "Compare Nifty 50 against Sensex"}
            ),
            "live draft should require OPENAI_API_KEY",
        )


def test_invalid_and_unknown_run_ids():
    with isolated_runtime_store():
        for request in [{}, {"runId": ""}, {"runId": "abc"}, {"runId": 0}, {"runId": -1}, {"runId": True}]:
            assert_raises(
                ValueError,
                lambda request=request: assistant_service.build_study_run_brief_payload(request),
                f"invalid request should fail validation: {request!r}",
            )
        assert_raises(
            assistant_service.StudyRunNotFoundError,
            lambda: assistant_service.build_study_run_brief_payload({"runId": 999}),
            "unknown run should raise not-found",
        )


def test_failed_run_blocks_result_conclusions():
    with isolated_runtime_store():
        recorded = runtime_store.record_study_run(
            {
                "studyId": "risk-adjusted-return",
                "studyTitle": "Risk-Adjusted Return",
                "selectionLabel": "Fake Symbol",
                "subjectQuery": "ZZZNOTREAL123",
                "status": "failed",
                "errorMessage": "No history found.",
                "routeHash": "#risk-adjusted-return/overview?subject=ZZZNOTREAL123",
                "completedAt": "2026-05-15T11:00:00+00:00",
            }
        )
        payload = assistant_service.build_study_run_brief_payload(
            {"runId": recorded["runId"]}
        )
        assert_equal(
            payload["explanationBrief"]["mode"],
            "failure-only",
            "failed runs should produce failure-only briefs",
        )
        assert_equal(
            payload["explanationBrief"]["resultConclusionAllowed"],
            False,
            "failed runs should block result conclusions",
        )


def test_warning_and_clipped_run_requires_caveats():
    with isolated_runtime_store():
        recorded = runtime_store.record_study_run(
            {
                "studyId": "risk-adjusted-return",
                "studyTitle": "Risk-Adjusted Return",
                "selectionLabel": "Nifty 50",
                "subjectQuery": "Nifty 50",
                "routeHash": "#risk-adjusted-return/overview?subject=Nifty+50&start=2026-01-01&end=2026-04-08",
                "requestedStartDate": "2026-01-01",
                "requestedEndDate": "2026-04-08",
                "actualStartDate": "2026-01-03",
                "actualEndDate": "2026-04-08",
                "warningCount": 1,
                "summaryItems": [
                    {
                        "summaryKey": "cagr",
                        "label": "CAGR",
                        "valueText": "42.0%",
                        "valueKind": "percent",
                    }
                ],
                "completedAt": "2026-05-15T11:30:00+00:00",
            }
        )
        payload = assistant_service.build_study_run_brief_payload(
            {"runId": recorded["runId"]}
        )
        caveat_codes = {
            item["code"] for item in payload["explanationBrief"]["requiredCaveats"]
        }
        assert_true("window.clipped" in caveat_codes, "clipped windows should be mandatory caveats")
        assert_true(
            "run.warnings_recorded" in caveat_codes,
            "recorded warnings should be mandatory caveats",
        )
        assert_true(
            "metric.short_window_annualized" in caveat_codes,
            "short-window annualized metrics should be mandatory caveats",
        )


def test_contract_bridge_failure_is_bad_gateway_class_error():
    with isolated_runtime_store():
        recorded = record_successful_run()
        original_bridge_path = assistant_service.CONTRACT_BRIDGE_PATH
        assistant_service.CONTRACT_BRIDGE_PATH = original_bridge_path.with_name(
            "missing-assistant-bridge.mjs"
        )
        try:
            assert_raises(
                RuntimeError,
                lambda: assistant_service.build_study_run_brief_payload(
                    {"runId": recorded["runId"]}
                ),
                "missing bridge should raise RuntimeError for 502 mapping",
            )
        finally:
            assistant_service.CONTRACT_BRIDGE_PATH = original_bridge_path


def test_contract_bridge_timeout_is_bad_gateway_class_error():
    with isolated_runtime_store(), tempfile.TemporaryDirectory(dir=runtime_store.REPO_ROOT) as temp_dir:
        recorded = record_successful_run()
        slow_bridge_path = Path(temp_dir) / "slow-assistant-bridge.mjs"
        slow_bridge_path.write_text("setTimeout(() => {}, 60000);\n", encoding="utf-8")
        original_bridge_path = assistant_service.CONTRACT_BRIDGE_PATH
        original_timeout = assistant_service.CONTRACT_BRIDGE_TIMEOUT_SECONDS
        assistant_service.CONTRACT_BRIDGE_PATH = slow_bridge_path
        assistant_service.CONTRACT_BRIDGE_TIMEOUT_SECONDS = 0.05
        try:
            assert_raises(
                RuntimeError,
                lambda: assistant_service.build_study_run_brief_payload(
                    {"runId": recorded["runId"]}
                ),
                "slow bridge should raise RuntimeError for 502 mapping",
            )
        finally:
            assistant_service.CONTRACT_BRIDGE_PATH = original_bridge_path
            assistant_service.CONTRACT_BRIDGE_TIMEOUT_SECONDS = original_timeout


def test_assistant_contract_manifest_bridge_failure_is_bad_gateway_class_error():
    original_bridge_path = assistant_service.ASSISTANT_CONTRACT_BRIDGE_PATH
    assistant_service.ASSISTANT_CONTRACT_BRIDGE_PATH = original_bridge_path.with_name(
        "missing-assistant-contract-bridge.mjs"
    )
    try:
        assert_raises(
            RuntimeError,
            lambda: assistant_service.build_assistant_contract_payload({}),
            "missing manifest bridge should raise RuntimeError for 502 mapping",
        )
    finally:
        assistant_service.ASSISTANT_CONTRACT_BRIDGE_PATH = original_bridge_path


def main():
    test_successful_run_brief_payload()
    test_assistant_contract_payload()
    test_assistant_contract_bundle_payload()
    test_assistant_readiness_payload_is_keyless_and_route_aware()
    test_assistant_study_plan_dry_run_is_keyless_and_non_executing()
    test_assistant_study_plan_dry_run_rejects_missing_intent()
    test_assistant_study_plan_live_draft_validates_model_plan()
    test_assistant_study_plan_live_draft_requires_key()
    test_invalid_and_unknown_run_ids()
    test_failed_run_blocks_result_conclusions()
    test_warning_and_clipped_run_requires_caveats()
    test_contract_bridge_failure_is_bad_gateway_class_error()
    test_contract_bridge_timeout_is_bad_gateway_class_error()
    test_assistant_contract_manifest_bridge_failure_is_bad_gateway_class_error()
    print("ok assistant service")


if __name__ == "__main__":
    main()
