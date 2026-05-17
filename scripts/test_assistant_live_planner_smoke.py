#!/usr/bin/env python3

from __future__ import annotations

import io
import sys
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import run_assistant_live_planner_smoke as live_smoke  # noqa: E402


def assert_equal(actual, expected, message):
    if actual != expected:
        raise AssertionError(f"{message}: expected {expected!r}, got {actual!r}")


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


def fake_payload_for_case(case: dict) -> dict:
    return {
        "version": live_smoke.assistant_service.ASSISTANT_STUDY_PLAN_LIVE_DRAFT_VERSION,
        "provider": "openai",
        "model": "test-model",
        "modelResult": {"responseId": f"resp_{case['id']}"},
        "plan": {
            "studyId": case["expectedStudyId"],
            "viewId": case["expectedViewId"],
        },
        "validation": {"ok": True, "issues": []},
        "preview": {
            "canRun": True,
            "routeHash": "&".join(case["routeIncludes"]),
        },
        "execution": {"executed": False},
    }


def test_matrix_cases_cover_observed_live_flows():
    case_ids = {case["id"] for case in live_smoke.DEFAULT_MATRIX_CASES}
    assert_true(
        {
            "relative-risk",
            "rolling-last-five-available",
            "options-iv-hv20-sort",
            "sip-nifty-500",
            "seasonality-bank",
        }.issubset(case_ids),
        "live matrix should cover the observed live AI smoke flows",
    )
    options_case = next(
        case
        for case in live_smoke.DEFAULT_MATRIX_CASES
        if case["id"] == "options-iv-hv20-sort"
    )
    assert_true(
        "sort=ivHv20Ratio" in options_case["routeIncludes"],
        "options live matrix should require canonical IV/HV20 sort key",
    )


def test_live_payload_errors_accepts_valid_payload():
    case = live_smoke.DEFAULT_MATRIX_CASES[0]
    errors = live_smoke.live_payload_errors(fake_payload_for_case(case), case)
    assert_equal(errors, [], "valid live payload should pass matrix checks")


def test_live_payload_errors_rejects_invalid_payload():
    case = live_smoke.DEFAULT_MATRIX_CASES[2]
    payload = fake_payload_for_case(case)
    payload["preview"]["routeHash"] = "#options-screener/overview?sort=iv_hv20"
    payload["execution"]["executed"] = True
    errors = live_smoke.live_payload_errors(payload, case)
    assert_true(
        any("route missing" in error for error in errors),
        "bad route should fail matrix checks",
    )
    assert_true(
        any("executed" in error for error in errors),
        "executed live draft should fail matrix checks",
    )


def test_matrix_main_uses_all_cases_without_real_openai_call():
    responses_by_intent = {
        case["intent"]: fake_payload_for_case(case)
        for case in live_smoke.DEFAULT_MATRIX_CASES
    }

    def fake_builder(request: dict) -> dict:
        return responses_by_intent[request["intent"]]

    with patch.object(
        live_smoke.assistant_service,
        "build_assistant_study_plan_live_draft_payload",
        side_effect=fake_builder,
    ) as builder:
        with redirect_stdout(io.StringIO()):
            exit_code = live_smoke.main(["--matrix"])

    assert_equal(exit_code, 0, "valid fake matrix should exit successfully")
    assert_equal(
        builder.call_count,
        len(live_smoke.DEFAULT_MATRIX_CASES),
        "matrix should call the live planner once per case",
    )


def main():
    test_matrix_cases_cover_observed_live_flows()
    test_live_payload_errors_accepts_valid_payload()
    test_live_payload_errors_rejects_invalid_payload()
    test_matrix_main_uses_all_cases_without_real_openai_call()
    print("ok assistant live planner smoke")


if __name__ == "__main__":
    main()
