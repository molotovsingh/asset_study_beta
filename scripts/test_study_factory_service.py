#!/usr/bin/env python3

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from server import study_factory_service  # noqa: E402


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


def test_study_factory_proposal_payload_existing_study():
    payload = study_factory_service.build_study_proposal_payload(
        {"idea": "Compare Nifty 50 against Sensex from 2021 to 2024"}
    )
    assert_equal(payload["version"], "study-proposal-response-v1", "proposal response version")
    assert_equal(payload["mode"], "read-only", "proposal response mode")
    assert_equal(payload["execution"]["executed"], False, "proposal should not execute")
    assert_equal(
        payload["proposal"]["studyPlanCandidate"]["plan"]["studyId"],
        "risk-adjusted-return",
        "proposal should include mapped StudyPlan candidate",
    )
    assert_equal(
        payload["proposal"]["feasibility"]["status"],
        "testable-now",
        "existing study idea should be testable now",
    )


def test_study_factory_proposal_payload_news_tool_gap():
    payload = study_factory_service.build_study_proposal_payload(
        {"idea": "Can RBI policy headlines move bank index volatility?"}
    )
    assert_equal(
        payload["proposal"]["feasibility"]["status"],
        "needs-data-contract",
        "missing news tool should block feasibility",
    )
    assert_true(
        "news" in payload["proposal"]["missingToolKinds"],
        "missing news kind should be reported",
    )


def test_study_factory_rejects_invalid_requests():
    assert_raises(
        ValueError,
        lambda: study_factory_service.build_study_proposal_payload([]),
        "proposal endpoint should reject non-object requests",
    )
    assert_raises(
        ValueError,
        lambda: study_factory_service.build_study_proposal_payload({}),
        "proposal service should reject missing idea before bridge execution",
    )


def test_study_factory_bridge_failure_and_timeout_are_bad_gateway_class_errors():
    original_bridge_path = study_factory_service.STUDY_PROPOSAL_BRIDGE_PATH
    study_factory_service.STUDY_PROPOSAL_BRIDGE_PATH = original_bridge_path.with_name(
        "missing-study-proposal-bridge.mjs"
    )
    try:
        assert_raises(
            RuntimeError,
            lambda: study_factory_service.build_study_proposal_payload({"idea": "risk"}),
            "missing bridge should raise RuntimeError for 502 mapping",
        )
    finally:
        study_factory_service.STUDY_PROPOSAL_BRIDGE_PATH = original_bridge_path

    with tempfile.TemporaryDirectory() as temp_dir:
        slow_bridge_path = Path(temp_dir) / "slow-study-proposal-bridge.mjs"
        slow_bridge_path.write_text("setTimeout(() => {}, 60000);\n", encoding="utf-8")
        original_timeout = study_factory_service.STUDY_PROPOSAL_BRIDGE_TIMEOUT_SECONDS
        study_factory_service.STUDY_PROPOSAL_BRIDGE_PATH = slow_bridge_path
        study_factory_service.STUDY_PROPOSAL_BRIDGE_TIMEOUT_SECONDS = 0.05
        try:
            assert_raises(
                RuntimeError,
                lambda: study_factory_service.build_study_proposal_payload({"idea": "risk"}),
                "slow bridge should raise RuntimeError for 502 mapping",
            )
        finally:
            study_factory_service.STUDY_PROPOSAL_BRIDGE_PATH = original_bridge_path
            study_factory_service.STUDY_PROPOSAL_BRIDGE_TIMEOUT_SECONDS = original_timeout


def main():
    test_study_factory_proposal_payload_existing_study()
    test_study_factory_proposal_payload_news_tool_gap()
    test_study_factory_rejects_invalid_requests()
    test_study_factory_bridge_failure_and_timeout_are_bad_gateway_class_errors()
    print("ok study factory service")


if __name__ == "__main__":
    main()
