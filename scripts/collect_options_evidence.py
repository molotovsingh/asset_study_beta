#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from runtime_store import ensure_runtime_store  # noqa: E402
from server.options_service import (  # noqa: E402
    COLLECTOR_UNIVERSES,
    collect_options_evidence_for_universe,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run configured options screener universes, create tracked front-straddle "
            "positions, and refresh exact-contract marks."
        ),
    )
    parser.add_argument(
        "--universe-id",
        action="append",
        help=(
            "Collector universe id to run. Repeat for multiple universes. "
            "Defaults to all configured collector universes."
        ),
    )
    parser.add_argument(
        "--list-universes",
        action="store_true",
        help="List configured collector universes and exit.",
    )
    parser.add_argument(
        "--minimum-dte",
        type=int,
        help="Override the configured minimum DTE for the selected universe(s).",
    )
    parser.add_argument(
        "--max-contracts",
        type=int,
        help="Override the configured contract count for the selected universe(s).",
    )
    parser.add_argument(
        "--symbols",
        nargs="+",
        help=(
            "Optional symbol override for the selected universe. "
            "Only valid when running a single universe."
        ),
    )
    parser.add_argument(
        "--as-of-date",
        help=(
            "Optional YYYY-MM-DD date to use for mark refresh bookkeeping. "
            "Defaults to today (UTC)."
        ),
    )
    parser.add_argument(
        "--indent",
        type=int,
        default=2,
        help="JSON indentation level for the printed summary. Default: 2",
    )
    return parser.parse_args()


def list_universes() -> int:
    for universe_id, config in sorted(COLLECTOR_UNIVERSES.items()):
        print(f"{universe_id}\t{config['universeLabel']}")
    return 0


def normalize_universe_ids(raw_ids: list[str] | None) -> list[str]:
    if not raw_ids:
        return sorted(COLLECTOR_UNIVERSES.keys())

    normalized_ids: list[str] = []
    for raw_id in raw_ids:
        universe_id = str(raw_id or "").strip()
        if not universe_id:
            continue
        if universe_id not in COLLECTOR_UNIVERSES:
            raise ValueError(f"Unknown collector universe: {universe_id}")
        if universe_id not in normalized_ids:
            normalized_ids.append(universe_id)

    if not normalized_ids:
        raise ValueError("At least one valid collector universe is required.")
    return normalized_ids


def main() -> int:
    args = parse_args()
    if args.list_universes:
        return list_universes()

    universe_ids = normalize_universe_ids(args.universe_id)
    if args.symbols and len(universe_ids) != 1:
        raise ValueError("--symbols may only be used when running exactly one universe.")

    ensure_runtime_store()
    results = [
        collect_options_evidence_for_universe(
            universe_id,
            minimum_dte=args.minimum_dte,
            max_contracts=args.max_contracts,
            symbols=args.symbols,
            as_of_date=args.as_of_date,
        )
        for universe_id in universe_ids
    ]
    print(
        json.dumps(
            {
                "collectorRunCount": len(results),
                "results": results,
            },
            indent=max(0, int(args.indent)),
        ),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
