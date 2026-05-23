#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from server import instrument_service  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Refresh the local verified instrument registry.",
    )
    parser.add_argument(
        "--query",
        help="Optional discovery query to record after seeding built-ins.",
    )
    parser.add_argument(
        "--verify-symbol",
        help="Optional symbol to verify for priceHistory after seeding built-ins.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    payload = instrument_service.refresh_instrument_registry(
        query=args.query,
        verify_symbol=args.verify_symbol,
    )
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
