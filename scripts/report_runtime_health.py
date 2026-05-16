#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

try:
    from server import ops_service
except ModuleNotFoundError:
    from scripts.server import ops_service


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Report local runtime-store health for symbols, universes, and options evidence.",
    )
    parser.add_argument("--stale-after-days", type=int, default=7)
    parser.add_argument("--symbol-limit", type=int, default=20)
    parser.add_argument("--universe-limit", type=int, default=20)
    parser.add_argument("--run-limit", type=int, default=10)
    parser.add_argument("--as-of-date")
    parser.add_argument("--indent", type=int, default=2)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    payload = ops_service.build_runtime_health_payload(
        {
            "staleAfterDays": args.stale_after_days,
            "symbolLimit": args.symbol_limit,
            "universeLimit": args.universe_limit,
            "runLimit": args.run_limit,
            "asOfDate": args.as_of_date,
        }
    )
    print(json.dumps(payload, indent=args.indent, sort_keys=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
