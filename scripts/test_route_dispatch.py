#!/usr/bin/env python3

from __future__ import annotations

import sys
from http import HTTPStatus
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import dev_server  # noqa: E402


def assert_equal(actual, expected, message):
    if actual != expected:
        raise AssertionError(f"{message}: expected {expected!r}, got {actual!r}")


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


def test_get_route_success():
    status, payload = dev_server.dispatch_api_request("GET", "/api/yfinance/catalog")
    assert_equal(status, HTTPStatus.OK, "catalog GET should succeed")
    assert_equal(payload["provider"], "yfinance", "catalog provider")
    assert_equal(payload["datasetType"], "index", "catalog dataset type")
    assert_true(isinstance(payload.get("datasets"), list), "catalog should return dataset list")


def test_runtime_health_get_route_dispatches():
    original_builder = dev_server.server_routes.ops_service.build_runtime_health_payload

    def fake_builder(_request):
        return {"generatedAt": "2026-04-20T00:00:00+00:00", "summary": {"totalSymbols": 3}}

    dev_server.server_routes.ops_service.build_runtime_health_payload = fake_builder
    try:
        status, payload = dev_server.dispatch_api_request("GET", "/api/system/runtime-health")
    finally:
        dev_server.server_routes.ops_service.build_runtime_health_payload = original_builder

    assert_equal(status, HTTPStatus.OK, "runtime-health GET should succeed")
    assert_equal(payload["summary"]["totalSymbols"], 3, "runtime-health route should dispatch to ops service")


def test_automations_get_route_dispatches():
    original_builder = dev_server.server_routes.automation_service.build_automation_state_payload

    def fake_builder():
        return {"automations": [{"automationId": "daily-maintenance"}], "catalogs": {}, "defaults": {}}

    dev_server.server_routes.automation_service.build_automation_state_payload = fake_builder
    try:
        status, payload = dev_server.dispatch_api_request("GET", "/api/automations")
    finally:
        dev_server.server_routes.automation_service.build_automation_state_payload = original_builder

    assert_equal(status, HTTPStatus.OK, "automations GET should succeed")
    assert_equal(payload["automations"][0]["automationId"], "daily-maintenance", "automation state should dispatch")


def test_study_runs_get_route_dispatches():
    original_builder = dev_server.server_routes.study_run_service.build_study_run_history_payload
    captured: dict[str, object] = {}

    def fake_builder(request):
        captured["request"] = request
        return {"runs": [{"studyId": "options-screener", "completedAt": "2026-05-15T00:00:00+00:00"}]}

    dev_server.server_routes.study_run_service.build_study_run_history_payload = fake_builder
    try:
        status, payload = dev_server.dispatch_api_request(
            "GET",
            "/api/study-runs",
            request={"studyId": "options-screener", "limit": "40"},
        )
    finally:
        dev_server.server_routes.study_run_service.build_study_run_history_payload = original_builder

    assert_equal(status, HTTPStatus.OK, "study-runs GET should succeed")
    assert_equal(payload["runs"][0]["studyId"], "options-screener", "study-runs route should dispatch")
    assert_equal(
        captured["request"],
        {"studyId": "options-screener", "limit": "40"},
        "study-runs GET should forward query parameters",
    )


def test_assistant_contract_get_route_dispatches():
    original_builder = dev_server.server_routes.assistant_service.build_assistant_contract_payload
    original_bundle_builder = dev_server.server_routes.assistant_service.build_assistant_contract_bundle_payload
    original_readiness_builder = dev_server.server_routes.assistant_service.build_assistant_readiness_payload
    captured: dict[str, object] = {}

    def fake_builder(request):
        captured["request"] = request
        return {
            "version": "assistant-contract-v1",
            "contracts": [],
            "backendEndpoints": [
                {"path": "/api/assistant/study-run-brief"},
            ],
            "hardStops": [],
        }

    def fake_bundle_builder(request):
        captured["bundleRequest"] = request
        return {
            "version": "assistant-contract-bundle-v1",
            "contracts": {"assistant": {}, "metricRegistry": {}, "studyCatalog": {}, "studyPlan": {}},
        }

    def fake_readiness_builder(request):
        captured["readinessRequest"] = request
        return {
            "version": "assistant-readiness-v1",
            "status": "ok",
            "summary": {"failed": 0},
            "checks": [],
        }

    dev_server.server_routes.assistant_service.build_assistant_contract_payload = fake_builder
    dev_server.server_routes.assistant_service.build_assistant_contract_bundle_payload = fake_bundle_builder
    dev_server.server_routes.assistant_service.build_assistant_readiness_payload = fake_readiness_builder
    try:
        status, payload = dev_server.dispatch_api_request(
            "GET",
            "/api/assistant/contract",
        )
        bundle_status, bundle_payload = dev_server.dispatch_api_request(
            "GET",
            "/api/assistant/contract-bundle",
        )
        readiness_status, readiness_payload = dev_server.dispatch_api_request(
            "GET",
            "/api/assistant/readiness",
            request={"artifactChecks": "false"},
        )
    finally:
        dev_server.server_routes.assistant_service.build_assistant_contract_payload = original_builder
        dev_server.server_routes.assistant_service.build_assistant_contract_bundle_payload = original_bundle_builder
        dev_server.server_routes.assistant_service.build_assistant_readiness_payload = original_readiness_builder

    assert_equal(status, HTTPStatus.OK, "assistant contract GET should succeed")
    assert_equal(bundle_status, HTTPStatus.OK, "assistant contract bundle GET should succeed")
    assert_equal(readiness_status, HTTPStatus.OK, "assistant readiness GET should succeed")
    assert_equal(captured["request"], {}, "assistant contract route should forward an empty request")
    assert_equal(captured["bundleRequest"], {}, "assistant contract bundle route should forward an empty request")
    assert_equal(
        captured["readinessRequest"],
        {"artifactChecks": "false"},
        "assistant readiness route should forward query parameters",
    )
    assert_equal(
        payload["version"],
        "assistant-contract-v1",
        "assistant contract route should dispatch to assistant service",
    )
    assert_equal(
        bundle_payload["version"],
        "assistant-contract-bundle-v1",
        "assistant contract bundle route should dispatch to assistant service",
    )
    assert_equal(
        readiness_payload["version"],
        "assistant-readiness-v1",
        "assistant readiness route should dispatch to assistant service",
    )


def test_post_route_success_parses_json_body():
    original_dispatch = dev_server.server_routes.dispatch_request
    captured: dict[str, object] = {}

    def fake_dispatch(method, path, request=None):
        captured["method"] = method
        captured["path"] = path
        captured["request"] = request
        return {"ok": True}

    dev_server.server_routes.dispatch_request = fake_dispatch
    try:
        status, payload = dev_server.dispatch_api_request(
            "POST",
            "/api/yfinance/index-series",
            b'{"symbol":"AAPL","remember":true}',
        )
    finally:
        dev_server.server_routes.dispatch_request = original_dispatch

    assert_equal(status, HTTPStatus.OK, "POST dispatch should succeed")
    assert_equal(payload, {"ok": True}, "POST payload should be forwarded")
    assert_equal(captured["method"], "POST", "dispatch should receive request method")
    assert_equal(captured["path"], "/api/yfinance/index-series", "dispatch should receive route path")
    assert_equal(
        captured["request"],
        {"symbol": "AAPL", "remember": True},
        "dispatch should receive decoded JSON payload",
    )


def test_trade_validation_route_dispatches():
    original_builder = dev_server.server_routes.options_service.build_trade_validation_response
    captured: dict[str, object] = {}

    def fake_builder(request):
        captured["request"] = request
        return {"validationType": "trade", "ok": True}

    dev_server.server_routes.options_service.build_trade_validation_response = fake_builder
    try:
        payload = dev_server.server_routes.dispatch_request(
            "POST",
            "/api/options/trade-validation",
            {"universeId": "us-liquid-10", "horizon": "5D"},
        )
    finally:
        dev_server.server_routes.options_service.build_trade_validation_response = original_builder

    assert_equal(payload["validationType"], "trade", "trade-validation route should dispatch to the service")
    assert_equal(payload["ok"], True, "trade-validation payload should round-trip")
    assert_equal(
        captured["request"],
        {"universeId": "us-liquid-10", "horizon": "5D"},
        "trade-validation route should forward the request body",
    )


def test_automation_post_routes_dispatch():
    original_save = dev_server.server_routes.automation_service.save_automation_config
    original_delete = dev_server.server_routes.automation_service.remove_automation_config
    original_run = dev_server.server_routes.automation_service.run_automation_now

    captured: dict[str, object] = {}

    dev_server.server_routes.automation_service.save_automation_config = lambda request: captured.setdefault("save", request) or {"ok": "save"}
    dev_server.server_routes.automation_service.remove_automation_config = lambda request: captured.setdefault("delete", request) or {"ok": "delete"}
    dev_server.server_routes.automation_service.run_automation_now = lambda request: captured.setdefault("run", request) or {"ok": "run"}
    try:
        save_payload = dev_server.server_routes.dispatch_request(
            "POST",
            "/api/automations/save",
            {"automationId": "daily-maintenance"},
        )
        delete_payload = dev_server.server_routes.dispatch_request(
            "POST",
            "/api/automations/delete",
            {"automationId": "daily-maintenance"},
        )
        run_payload = dev_server.server_routes.dispatch_request(
            "POST",
            "/api/automations/run",
            {"automationId": "daily-maintenance"},
        )
    finally:
        dev_server.server_routes.automation_service.save_automation_config = original_save
        dev_server.server_routes.automation_service.remove_automation_config = original_delete
        dev_server.server_routes.automation_service.run_automation_now = original_run

    assert_equal(captured["save"], {"automationId": "daily-maintenance"}, "automation save route should forward request")
    assert_equal(captured["delete"], {"automationId": "daily-maintenance"}, "automation delete route should forward request")
    assert_equal(captured["run"], {"automationId": "daily-maintenance"}, "automation run route should forward request")
    assert_equal(save_payload["automationId"], "daily-maintenance", "save route should return builder payload")
    assert_equal(delete_payload["automationId"], "daily-maintenance", "delete route should return builder payload")
    assert_equal(run_payload["automationId"], "daily-maintenance", "run route should return builder payload")


def test_study_run_record_route_dispatches():
    original_record = dev_server.server_routes.study_run_service.record_study_run_entry
    captured: dict[str, object] = {}

    def fake_record(request):
        captured["request"] = request
        return {"run": {"studyId": request["studyId"], "completedAt": request["completedAt"]}}

    dev_server.server_routes.study_run_service.record_study_run_entry = fake_record
    try:
        payload = dev_server.server_routes.dispatch_request(
            "POST",
            "/api/study-runs/record",
            {
                "studyId": "monthly-straddle",
                "studyTitle": "Monthly Straddle",
                "selectionLabel": "AAPL",
                "subjectQuery": "AAPL",
                "completedAt": "2026-05-15T00:00:00+00:00",
            },
        )
    finally:
        dev_server.server_routes.study_run_service.record_study_run_entry = original_record

    assert_equal(
        captured["request"]["studyId"],
        "monthly-straddle",
        "study-run record route should forward request",
    )
    assert_equal(payload["run"]["studyId"], "monthly-straddle", "study-run record route should return builder payload")


def test_assistant_study_run_brief_route_dispatches():
    original_builder = dev_server.server_routes.assistant_service.build_study_run_brief_payload
    captured: dict[str, object] = {}

    def fake_builder(request):
        captured["request"] = request
        return {
            "run": {"runId": request["runId"]},
            "handoff": {"version": "study-run-handoff-v1"},
            "explanationBrief": {"version": "study-run-explanation-brief-v1"},
        }

    dev_server.server_routes.assistant_service.build_study_run_brief_payload = fake_builder
    try:
        payload = dev_server.server_routes.dispatch_request(
            "POST",
            "/api/assistant/study-run-brief",
            {"runId": 12},
        )
    finally:
        dev_server.server_routes.assistant_service.build_study_run_brief_payload = original_builder

    assert_equal(
        captured["request"],
        {"runId": 12},
        "assistant run brief route should forward request body",
    )
    assert_equal(payload["run"]["runId"], 12, "assistant run brief route should return builder payload")
    assert_equal(
        payload["handoff"]["version"],
        "study-run-handoff-v1",
        "assistant run brief route should include handoff",
    )


def test_assistant_study_plan_dry_run_route_dispatches():
    original_builder = dev_server.server_routes.assistant_service.build_assistant_study_plan_dry_run_payload
    captured: dict[str, object] = {}

    def fake_builder(request):
        captured["request"] = request
        return {
            "version": "assistant-study-plan-dry-run-v1",
            "intent": request["intent"],
            "readiness": {"status": "ok"},
            "plannerResult": {"version": "intent-planner-v1"},
            "plan": {"version": "study-plan-v1"},
            "validation": {"ok": True},
            "preview": {"canRun": True},
            "execution": {"executed": False},
        }

    dev_server.server_routes.assistant_service.build_assistant_study_plan_dry_run_payload = fake_builder
    try:
        payload = dev_server.server_routes.dispatch_request(
            "POST",
            "/api/assistant/study-plan-dry-run",
            {"intent": "Compare Nifty 50 against Sensex"},
        )
    finally:
        dev_server.server_routes.assistant_service.build_assistant_study_plan_dry_run_payload = original_builder

    assert_equal(
        captured["request"],
        {"intent": "Compare Nifty 50 against Sensex"},
        "assistant dry-run route should forward request body",
    )
    assert_equal(
        payload["version"],
        "assistant-study-plan-dry-run-v1",
        "assistant dry-run route should return builder payload",
    )
    assert_equal(
        payload["execution"]["executed"],
        False,
        "assistant dry-run route should stay non-executing",
    )


def test_assistant_study_plan_live_draft_route_dispatches():
    original_builder = dev_server.server_routes.assistant_service.build_assistant_study_plan_live_draft_payload
    captured: dict[str, object] = {}

    def fake_builder(request):
        captured["request"] = request
        return {
            "version": "assistant-study-plan-live-draft-v1",
            "provider": "openai",
            "model": "gpt-test",
            "intent": request["intent"],
            "readiness": {"status": "ok"},
            "modelResult": {"responseId": "resp_test"},
            "plan": {"version": "study-plan-v1"},
            "validation": {"ok": True},
            "preview": {"canRun": True},
            "execution": {"executed": False},
        }

    dev_server.server_routes.assistant_service.build_assistant_study_plan_live_draft_payload = fake_builder
    try:
        payload = dev_server.server_routes.dispatch_request(
            "POST",
            "/api/assistant/study-plan-live-draft",
            {"intent": "Compare Nifty 50 against Sensex"},
        )
    finally:
        dev_server.server_routes.assistant_service.build_assistant_study_plan_live_draft_payload = original_builder

    assert_equal(
        captured["request"],
        {"intent": "Compare Nifty 50 against Sensex"},
        "assistant live-draft route should forward request body",
    )
    assert_equal(
        payload["version"],
        "assistant-study-plan-live-draft-v1",
        "assistant live-draft route should return builder payload",
    )
    assert_equal(payload["provider"], "openai", "assistant live-draft route should expose provider")
    assert_equal(
        payload["execution"]["executed"],
        False,
        "assistant live-draft route should stay non-executing",
    )


def test_assistant_study_run_not_found_maps_to_404():
    original_builder = dev_server.server_routes.assistant_service.build_study_run_brief_payload

    def fake_builder(_request):
        raise dev_server.server_routes.assistant_service.StudyRunNotFoundError(
            "Study run 999 was not found."
        )

    dev_server.server_routes.assistant_service.build_study_run_brief_payload = fake_builder
    try:
        status, payload = dev_server.dispatch_api_request(
            "POST",
            "/api/assistant/study-run-brief",
            b'{"runId":999}',
        )
    finally:
        dev_server.server_routes.assistant_service.build_study_run_brief_payload = original_builder

    assert_equal(status, HTTPStatus.NOT_FOUND, "unknown assistant run should return 404")
    assert_equal(
        payload,
        {"error": "Study run 999 was not found."},
        "unknown assistant run error should be specific",
    )


def test_assistant_invalid_run_id_maps_to_400():
    original_builder = dev_server.server_routes.assistant_service.build_study_run_brief_payload

    def fake_builder(_request):
        raise ValueError("runId must be a positive integer.")

    dev_server.server_routes.assistant_service.build_study_run_brief_payload = fake_builder
    try:
        status, payload = dev_server.dispatch_api_request(
            "POST",
            "/api/assistant/study-run-brief",
            b'{"runId":"abc"}',
        )
    finally:
        dev_server.server_routes.assistant_service.build_study_run_brief_payload = original_builder

    assert_equal(status, HTTPStatus.BAD_REQUEST, "invalid assistant run id should return 400")
    assert_equal(
        payload,
        {"error": "runId must be a positive integer."},
        "invalid assistant run id error should be specific",
    )


def test_assistant_contract_bridge_failure_maps_to_502():
    original_builder = dev_server.server_routes.assistant_service.build_study_run_brief_payload

    def fake_builder(_request):
        raise RuntimeError("Assistant contract bridge failed.")

    dev_server.server_routes.assistant_service.build_study_run_brief_payload = fake_builder
    try:
        status, payload = dev_server.dispatch_api_request(
            "POST",
            "/api/assistant/study-run-brief",
            b'{"runId":12}',
        )
    finally:
        dev_server.server_routes.assistant_service.build_study_run_brief_payload = original_builder

    assert_equal(status, HTTPStatus.BAD_GATEWAY, "assistant bridge failure should return 502")
    assert_equal(
        payload,
        {"error": "Assistant contract bridge failed."},
        "assistant bridge failure error should be specific",
    )


def test_study_builder_routes_dispatch_and_map_errors():
    original_plan = dev_server.server_routes.study_builder_service.build_study_builder_plan_payload
    original_validate = dev_server.server_routes.study_builder_service.build_study_builder_validation_payload
    original_recipes = dev_server.server_routes.study_builder_service.build_study_plan_recipe_state_payload
    original_save_recipe = dev_server.server_routes.study_builder_service.save_study_plan_recipe
    original_delete_recipe = dev_server.server_routes.study_builder_service.remove_study_plan_recipe
    captured: dict[str, object] = {}

    def fake_plan(request):
        captured["plan"] = request
        return {"version": "study-builder-plan-response-v1", "plan": {}, "preview": {}, "plannerResult": {}}

    def fake_validate(request):
        captured["validate"] = request
        return {
            "version": "study-builder-validation-response-v1",
            "mode": "plan",
            "validation": {"ok": True},
            "preview": {"canRun": True},
        }

    def fake_recipes(request):
        captured["recipes"] = request
        return {"version": "study-plan-recipes-v1", "limit": 50, "recipes": []}

    def fake_save_recipe(request):
        captured["saveRecipe"] = request
        return {"ok": True, "recipe": {"id": "risk"}, "recipes": [], "validation": {}, "preview": {}}

    def fake_delete_recipe(request):
        captured["deleteRecipe"] = request
        return {"ok": True, "recipes": []}

    dev_server.server_routes.study_builder_service.build_study_builder_plan_payload = fake_plan
    dev_server.server_routes.study_builder_service.build_study_builder_validation_payload = fake_validate
    dev_server.server_routes.study_builder_service.build_study_plan_recipe_state_payload = fake_recipes
    dev_server.server_routes.study_builder_service.save_study_plan_recipe = fake_save_recipe
    dev_server.server_routes.study_builder_service.remove_study_plan_recipe = fake_delete_recipe
    try:
        recipes_payload = dev_server.server_routes.dispatch_request(
            "GET",
            "/api/study-builder/recipes",
            {"limit": "20"},
        )
        plan_payload = dev_server.server_routes.dispatch_request(
            "POST",
            "/api/study-builder/plan",
            {"intent": "Compare Nifty 50 against Sensex"},
        )
        validation_payload = dev_server.server_routes.dispatch_request(
            "POST",
            "/api/study-builder/validate",
            {"routeHash": "#drawdown-study/overview?subject=TSLA"},
        )
        save_recipe_payload = dev_server.server_routes.dispatch_request(
            "POST",
            "/api/study-builder/recipes/save",
            {"name": "Risk", "plan": {"version": "study-plan-v1"}},
        )
        delete_recipe_payload = dev_server.server_routes.dispatch_request(
            "POST",
            "/api/study-builder/recipes/delete",
            {"id": "risk"},
        )
    finally:
        dev_server.server_routes.study_builder_service.build_study_builder_plan_payload = original_plan
        dev_server.server_routes.study_builder_service.build_study_builder_validation_payload = original_validate
        dev_server.server_routes.study_builder_service.build_study_plan_recipe_state_payload = original_recipes
        dev_server.server_routes.study_builder_service.save_study_plan_recipe = original_save_recipe
        dev_server.server_routes.study_builder_service.remove_study_plan_recipe = original_delete_recipe

    assert_equal(captured["recipes"], {"limit": "20"}, "study-builder recipes route should forward query params")
    assert_equal(
        captured["plan"],
        {"intent": "Compare Nifty 50 against Sensex"},
        "study-builder plan route should forward request body",
    )
    assert_equal(
        captured["validate"],
        {"routeHash": "#drawdown-study/overview?subject=TSLA"},
        "study-builder validate route should forward request body",
    )
    assert_equal(plan_payload["version"], "study-builder-plan-response-v1", "plan route should return builder payload")
    assert_equal(validation_payload["mode"], "plan", "validate route should return builder payload")
    assert_equal(recipes_payload["version"], "study-plan-recipes-v1", "recipes route should return builder payload")
    assert_equal(save_recipe_payload["ok"], True, "recipe save route should return builder payload")
    assert_equal(delete_recipe_payload["ok"], True, "recipe delete route should return builder payload")
    assert_equal(captured["saveRecipe"]["name"], "Risk", "recipe save route should forward request body")
    assert_equal(captured["deleteRecipe"], {"id": "risk"}, "recipe delete route should forward request body")

    def invalid_plan(_request):
        raise ValueError("Study builder request must be a JSON object.")

    dev_server.server_routes.study_builder_service.build_study_builder_plan_payload = invalid_plan
    try:
        status, payload = dev_server.dispatch_api_request(
            "POST",
            "/api/study-builder/plan",
            b"[]",
        )
    finally:
        dev_server.server_routes.study_builder_service.build_study_builder_plan_payload = original_plan

    assert_equal(status, HTTPStatus.BAD_REQUEST, "invalid study-builder request should return 400")
    assert_equal(
        payload,
        {"error": "Study builder request must be a JSON object."},
        "invalid study-builder request error should be specific",
    )


def test_study_factory_proposal_route_dispatches():
    original_builder = dev_server.server_routes.study_factory_service.build_study_proposal_payload
    captured: dict[str, object] = {}

    def fake_builder(request):
        captured["request"] = request
        return {
            "version": "study-proposal-response-v1",
            "mode": "read-only",
            "proposal": {"version": "study-proposal-v1", "idea": request["idea"]},
            "execution": {"executed": False, "generatedCode": False},
        }

    dev_server.server_routes.study_factory_service.build_study_proposal_payload = fake_builder
    try:
        payload = dev_server.server_routes.dispatch_request(
            "POST",
            "/api/study-factory/proposal",
            {"idea": "Can RBI policy headlines move bank index volatility?"},
        )
    finally:
        dev_server.server_routes.study_factory_service.build_study_proposal_payload = original_builder

    assert_equal(
        captured["request"],
        {"idea": "Can RBI policy headlines move bank index volatility?"},
        "study-factory proposal route should forward request body",
    )
    assert_equal(
        payload["version"],
        "study-proposal-response-v1",
        "study-factory proposal route should return builder payload",
    )
    assert_equal(
        payload["execution"]["executed"],
        False,
        "study-factory proposal should stay read-only",
    )


def test_study_factory_proposal_errors_map():
    original_builder = dev_server.server_routes.study_factory_service.build_study_proposal_payload

    def invalid_builder(_request):
        raise ValueError("idea is required.")

    dev_server.server_routes.study_factory_service.build_study_proposal_payload = invalid_builder
    try:
        status, payload = dev_server.dispatch_api_request(
            "POST",
            "/api/study-factory/proposal",
            b"{}",
        )
    finally:
        dev_server.server_routes.study_factory_service.build_study_proposal_payload = original_builder

    assert_equal(status, HTTPStatus.BAD_REQUEST, "missing study-factory idea should return 400")
    assert_equal(payload, {"error": "idea is required."}, "missing idea error should be specific")

    def failed_builder(_request):
        raise RuntimeError("Study proposal bridge failed.")

    dev_server.server_routes.study_factory_service.build_study_proposal_payload = failed_builder
    try:
        status, payload = dev_server.dispatch_api_request(
            "POST",
            "/api/study-factory/proposal",
            b'{"idea":"risk"}',
        )
    finally:
        dev_server.server_routes.study_factory_service.build_study_proposal_payload = original_builder

    assert_equal(status, HTTPStatus.BAD_GATEWAY, "study-factory bridge failure should return 502")
    assert_equal(
        payload,
        {"error": "Study proposal bridge failed."},
        "study-factory bridge error should be specific",
    )


def test_malformed_json_maps_to_bad_request():
    status, payload = dev_server.dispatch_api_request(
        "POST",
        "/api/yfinance/index-series",
        b"{bad-json",
    )
    assert_equal(status, HTTPStatus.BAD_REQUEST, "malformed JSON should return 400")
    assert_equal(
        payload,
        {"error": "Request body must be valid JSON."},
        "malformed JSON error message",
    )


def test_unknown_route_maps_to_not_found():
    status, payload = dev_server.dispatch_api_request(
        "POST",
        "/api/unknown",
        b"{}",
    )
    assert_equal(status, HTTPStatus.NOT_FOUND, "unknown routes should return 404")
    assert_equal(payload, {"error": "Unknown API endpoint."}, "unknown route error message")


def test_exception_mapping():
    original_dispatch = dev_server.server_routes.dispatch_request

    scenarios = [
        (ValueError("bad input"), HTTPStatus.BAD_REQUEST, {"error": "bad input"}),
        (RuntimeError("upstream failed"), HTTPStatus.BAD_GATEWAY, {"error": "upstream failed"}),
        (
            SystemExit(),
            HTTPStatus.SERVICE_UNAVAILABLE,
            {"error": "A required local market-data provider is unavailable."},
        ),
    ]

    try:
        for error, expected_status, expected_payload in scenarios:
            def fake_dispatch(_method, _path, _request=None, error=error):
                raise error

            dev_server.server_routes.dispatch_request = fake_dispatch
            status, payload = dev_server.dispatch_api_request(
                "POST",
                "/api/yfinance/index-series",
                b'{"symbol":"AAPL"}',
            )
            assert_equal(status, expected_status, f"{type(error).__name__} should map to the expected status")
            assert_equal(payload, expected_payload, f"{type(error).__name__} payload")
    finally:
        dev_server.server_routes.dispatch_request = original_dispatch


def main() -> int:
    test_get_route_success()
    test_runtime_health_get_route_dispatches()
    test_automations_get_route_dispatches()
    test_study_runs_get_route_dispatches()
    test_assistant_contract_get_route_dispatches()
    test_post_route_success_parses_json_body()
    test_trade_validation_route_dispatches()
    test_automation_post_routes_dispatch()
    test_study_run_record_route_dispatches()
    test_assistant_study_run_brief_route_dispatches()
    test_assistant_study_plan_dry_run_route_dispatches()
    test_assistant_study_plan_live_draft_route_dispatches()
    test_assistant_invalid_run_id_maps_to_400()
    test_assistant_study_run_not_found_maps_to_404()
    test_assistant_contract_bridge_failure_maps_to_502()
    test_study_builder_routes_dispatch_and_map_errors()
    test_study_factory_proposal_route_dispatches()
    test_study_factory_proposal_errors_map()
    test_malformed_json_maps_to_bad_request()
    test_unknown_route_maps_to_not_found()
    test_exception_mapping()
    print("ok route dispatch")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
