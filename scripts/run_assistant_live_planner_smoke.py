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
        description="Run one live OpenAI assistant StudyPlan smoke without executing a study."
    )
    parser.add_argument("--intent", default=DEFAULT_INTENT, help="Research intent to draft.")
    parser.add_argument("--model", default="", help="Optional OpenAI model override.")
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


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if args.env_file:
        load_env_file(Path(args.env_file).expanduser().resolve())
    if args.api_key_var != "OPENAI_API_KEY":
        alternate_key = os.environ.get(args.api_key_var, "").strip()
        if not alternate_key:
            raise ValueError(f"{args.api_key_var} is not set.")
        os.environ["OPENAI_API_KEY"] = alternate_key

    request = {"intent": args.intent}
    if args.model:
        request["model"] = args.model
    payload = assistant_service.build_assistant_study_plan_live_draft_payload(request)

    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
        return 0

    print("assistant live planner smoke: ok")
    print(f"provider: {payload['provider']}")
    print(f"model: {payload['model']}")
    print(f"study: {payload['plan'].get('studyId')} / {payload['plan'].get('viewId')}")
    print(f"canRun: {payload['preview'].get('canRun')}")
    print(f"executed: {payload['execution'].get('executed')}")
    print(f"readiness: {payload['readiness'].get('status')}")
    print(f"responseId: {payload['modelResult'].get('responseId')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
