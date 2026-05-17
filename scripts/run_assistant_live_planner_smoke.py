#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from server import assistant_service  # noqa: E402


DEFAULT_INTENT = "Compare Nifty 50 against Sensex from 2021 to 2024."
DEFAULT_MATRIX_CASES = [
    {
        "id": "relative-risk",
        "intent": "Compare Nifty 50 against Sensex from 2021 to 2024.",
        "expectedStudyId": "risk-adjusted-return",
        "expectedViewId": "relative",
        "routeIncludes": [
            "#risk-adjusted-return/relative",
            "subject=Nifty+50",
            "benchmark=Sensex",
        ],
    },
    {
        "id": "rolling-last-five-available",
        "intent": "Show rolling returns for Nifty 50 over the last five available years.",
        "expectedStudyId": "rolling-returns",
        "expectedViewId": "overview",
        "routeIncludes": ["#rolling-returns/overview", "subject=Nifty+50"],
    },
    {
        "id": "options-iv-hv20-sort",
        "intent": "Run options screener for US Liquid 10 sorted by IV/HV20.",
        "expectedStudyId": "options-screener",
        "expectedViewId": "overview",
        "routeIncludes": [
            "#options-screener/overview",
            "u=us-liquid-10",
            "sort=ivHv20Ratio",
        ],
    },
    {
        "id": "sip-nifty-500",
        "intent": "Simulate a monthly SIP of 10000 in Nifty 500 from 2021 to 2026.",
        "expectedStudyId": "sip-simulator",
        "expectedViewId": "overview",
        "routeIncludes": [
            "#sip-simulator/overview",
            "subject=Nifty+500",
            "contribution=10000",
        ],
    },
    {
        "id": "seasonality-bank",
        "intent": "What are the best and worst months for Nifty Bank seasonality?",
        "expectedStudyId": "seasonality",
        "expectedViewId": "overview",
        "routeIncludes": ["#seasonality/overview", "subject=Nifty+Bank"],
    },
]


def load_env_file(path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError(f"Env file not found: {path}")
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run live OpenAI assistant StudyPlan smokes without executing studies."
    )
    parser.add_argument("--intent", default=DEFAULT_INTENT, help="Research intent to draft.")
    parser.add_argument("--model", default="", help="Optional OpenAI model override.")
    parser.add_argument(
        "--matrix",
        action="store_true",
        help="Run the standard multi-intent live planner matrix.",
    )
    parser.add_argument(
        "--env-file",
        default="",
        help="Optional .env file to load before the smoke. Values are not printed.",
    )
    parser.add_argument(
        "--api-key-var",
        default="OPENAI_API_KEY",
        help="Environment variable to use as the OpenAI key source. Value is not printed.",
    )
    parser.add_argument("--json", action="store_true", help="Print the full non-secret payload.")
    return parser.parse_args(argv)


def configure_live_key(args: argparse.Namespace) -> None:
    if args.env_file:
        load_env_file(Path(args.env_file).expanduser().resolve())
    if args.api_key_var == "OPENAI_API_KEY":
        return
    alternate_key = os.environ.get(args.api_key_var, "").strip()
    if not alternate_key:
        raise ValueError(f"{args.api_key_var} is not set.")
    os.environ["OPENAI_API_KEY"] = alternate_key


def build_live_planner_payload(intent: str, model: str = "") -> dict:
    request = {"intent": intent}
    if model:
        request["model"] = model
    return assistant_service.build_assistant_study_plan_live_draft_payload(request)


def live_payload_errors(payload: dict, case: dict) -> list[str]:
    errors: list[str] = []
    plan = payload.get("plan") or {}
    validation = payload.get("validation") or {}
    preview = payload.get("preview") or {}
    execution = payload.get("execution") or {}
    route_hash = str(preview.get("routeHash") or "")

    if payload.get("version") != assistant_service.ASSISTANT_STUDY_PLAN_LIVE_DRAFT_VERSION:
        errors.append("unexpected live draft response version")
    if validation.get("ok") is not True:
        issue_messages = [
            str(issue.get("message") or issue.get("code") or "unknown issue")
            for issue in validation.get("issues") or []
        ]
        errors.append("validation failed: " + "; ".join(issue_messages))
    if preview.get("canRun") is not True:
        errors.append("preview is not runnable")
    if execution.get("executed") is not False:
        errors.append("live draft executed a study")

    expected_study_id = case.get("expectedStudyId")
    if expected_study_id and plan.get("studyId") != expected_study_id:
        errors.append(f"expected studyId {expected_study_id}, got {plan.get('studyId')}")

    expected_view_id = case.get("expectedViewId")
    if expected_view_id and plan.get("viewId") != expected_view_id:
        errors.append(f"expected viewId {expected_view_id}, got {plan.get('viewId')}")

    for route_fragment in case.get("routeIncludes") or []:
        if route_fragment not in route_hash:
            errors.append(f"route missing {route_fragment!r}: {route_hash}")

    return errors


def summarize_payload(case: dict, payload: dict) -> dict:
    plan = payload.get("plan") or {}
    validation = payload.get("validation") or {}
    preview = payload.get("preview") or {}
    execution = payload.get("execution") or {}
    return {
        "id": case.get("id", "single"),
        "intent": case.get("intent", ""),
        "responseId": (payload.get("modelResult") or {}).get("responseId"),
        "model": payload.get("model"),
        "studyId": plan.get("studyId"),
        "viewId": plan.get("viewId"),
        "routeHash": preview.get("routeHash"),
        "validationOk": validation.get("ok"),
        "canRun": preview.get("canRun"),
        "executed": execution.get("executed"),
        "errors": live_payload_errors(payload, case),
    }


def run_live_case(case: dict, *, model: str = "") -> dict:
    payload = build_live_planner_payload(case["intent"], model=model)
    summary = summarize_payload(case, payload)
    summary["payload"] = payload
    return summary


def print_case_summary(summary: dict) -> None:
    status = "ok" if not summary["errors"] else "failed"
    print(
        f"{status} {summary['id']}: "
        f"{summary['studyId']} / {summary['viewId']} "
        f"canRun={summary['canRun']} executed={summary['executed']}"
    )
    print(f"  route: {summary['routeHash']}")
    for error in summary["errors"]:
        print(f"  error: {error}")


def run_single(args: argparse.Namespace) -> tuple[int, dict]:
    case = next(
        (
            matrix_case
            for matrix_case in DEFAULT_MATRIX_CASES
            if matrix_case["intent"] == args.intent
        ),
        {"id": "single", "intent": args.intent},
    )
    summary = run_live_case(case, model=args.model)
    return (0 if not summary["errors"] else 1, summary)


def run_matrix(args: argparse.Namespace) -> tuple[int, dict]:
    results = [run_live_case(case, model=args.model) for case in DEFAULT_MATRIX_CASES]
    return (
        0 if all(not result["errors"] for result in results) else 1,
        {"version": "assistant-live-planner-matrix-v1", "results": results},
    )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    configure_live_key(args)
    exit_code, result = run_matrix(args) if args.matrix else run_single(args)

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
        return exit_code

    if args.matrix:
        print(
            "assistant live planner matrix: "
            + ("ok" if exit_code == 0 else "failed")
        )
        for summary in result["results"]:
            print_case_summary(summary)
        return exit_code

    print("assistant live planner smoke: " + ("ok" if exit_code == 0 else "failed"))
    print_case_summary(result)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
