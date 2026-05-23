#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from server.fundamentals_collector import (  # noqa: E402
    DEFAULT_FUNDAMENTAL_PERIOD_DAYS,
    NIFTY500_UNIVERSE_ID,
    SP500_UNIVERSE_ID,
    collect_fundamental_universe,
    list_available_fundamental_universes,
    seed_builtin_fundamental_universe,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Seed a durable fundamental universe and collect Finnhub fundamental "
            "snapshots into the local SQLite runtime store."
        ),
    )
    parser.add_argument(
        "--universe-id",
        help=f"Universe id, for example {SP500_UNIVERSE_ID} or {NIFTY500_UNIVERSE_ID}.",
    )
    parser.add_argument(
        "--universe-label",
        help="Optional human label for the universe.",
    )
    parser.add_argument(
        "--symbols",
        nargs="+",
        help="Optional explicit provider symbols to seed and collect, for example AAPL MSFT RELIANCE.NS.",
    )
    parser.add_argument(
        "--seed-built-in",
        action="store_true",
        help="Refresh the built-in constituent list before collecting. Supported: sp500-current, nifty-500-current.",
    )
    parser.add_argument(
        "--seed-only",
        action="store_true",
        help="Only refresh built-in membership; do not collect fundamentals.",
    )
    parser.add_argument(
        "--period-days",
        type=int,
        default=DEFAULT_FUNDAMENTAL_PERIOD_DAYS,
        help=f"Trailing days of annual/quarterly series metrics to persist. Default: {DEFAULT_FUNDAMENTAL_PERIOD_DAYS}.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Optional safety cap on active members to collect in this run.",
    )
    parser.add_argument(
        "--delay-seconds",
        type=float,
        default=0.0,
        help="Optional delay between provider calls to respect rate limits.",
    )
    parser.add_argument(
        "--list-universes",
        action="store_true",
        help="List built-in and stored fundamental universes and exit.",
    )
    parser.add_argument(
        "--indent",
        type=int,
        default=2,
        help="JSON indentation level for printed output. Default: 2",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    indent = max(0, int(args.indent))
    if args.list_universes:
        print(json.dumps({"universes": list_available_fundamental_universes()}, indent=indent))
        return 0

    if not args.universe_id:
        raise ValueError("--universe-id is required unless --list-universes is used.")

    if args.seed_only:
        if args.symbols:
            raise ValueError("--seed-only is only supported with --seed-built-in.")
        if not args.seed_built_in:
            raise ValueError("--seed-only requires --seed-built-in.")
        print(
            json.dumps(
                seed_builtin_fundamental_universe(
                    args.universe_id,
                    universe_label=args.universe_label,
                ),
                indent=indent,
            )
        )
        return 0

    summary = collect_fundamental_universe(
        args.universe_id,
        universe_label=args.universe_label,
        symbols=args.symbols,
        seed_builtin=bool(args.seed_built_in),
        period_days=max(1, int(args.period_days)),
        limit=args.limit,
        delay_seconds=max(0.0, float(args.delay_seconds or 0.0)),
    )
    print(json.dumps(summary, indent=indent))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
