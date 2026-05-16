#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from server import assistant_service  # noqa: E402


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run keyless deterministic assistant readiness checks."
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the full readiness payload as JSON.",
    )
    parser.add_argument(
        "--skip-artifact-checks",
        action="store_true",
        help="Only verify generated contract files exist; skip drift check commands.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    payload = assistant_service.build_assistant_readiness_payload(
        {"artifactChecks": not args.skip_artifact_checks}
    )
    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        summary = payload["summary"]
        print(
            "assistant readiness: "
            f"{payload['status']} "
            f"({summary['passed']}/{summary['total']} passed, "
            f"{summary['failed']} failed)"
        )
        for check in payload["checks"]:
            marker = "ok" if check["ok"] else "fail"
            print(f"{marker} {check['id']}: {check['detail']}")
        print(
            "live AI key: "
            f"{payload['liveAiTesting']['status']} "
            f"({payload['liveAiTesting']['requiredOnlyWhen']})"
        )
    return 0 if payload["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
