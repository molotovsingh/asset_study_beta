#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from runtime_store import list_symbol_universes  # noqa: E402
from server.market_collector import (  # noqa: E402
    DEFAULT_COLLECTOR_PROVIDER_ORDER,
    collect_market_universe,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Collect daily market history for a bounded symbol universe, with optional "
            "Finnhub exchange symbol-master refresh."
        ),
    )
    parser.add_argument(
        "--universe-id",
        help="Stable local universe id, for example us-core or india-sectors.",
    )
    parser.add_argument(
        "--universe-label",
        help="Optional human label for the universe. Defaults to the universe id.",
    )
    parser.add_argument(
        "--symbols",
        nargs="+",
        help="Optional explicit symbol list to add to the universe and collect immediately.",
    )
    parser.add_argument(
        "--exchange",
        help="Optional Finnhub exchange code, for example US.",
    )
    parser.add_argument(
        "--mic",
        help="Optional Finnhub MIC filter when refreshing the exchange symbol master.",
    )
    parser.add_argument(
        "--refresh-symbol-master",
        action="store_true",
        help="Refresh the universe members from Finnhub exchange symbols before collection.",
    )
    parser.add_argument(
        "--provider-order",
        default=",".join(DEFAULT_COLLECTOR_PROVIDER_ORDER),
        help=(
            "Comma-separated provider priority for collection. "
            f"Default: {','.join(DEFAULT_COLLECTOR_PROVIDER_ORDER)}"
        ),
    )
    parser.add_argument(
        "--full-sync",
        action="store_true",
        help="Force a broad sync for each symbol instead of the normal incremental path.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Optional safety cap on the number of active universe members to collect.",
    )
    parser.add_argument(
        "--list-universes",
        action="store_true",
        help="List stored local universes and exit.",
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
    if args.list_universes:
        print(json.dumps({"universes": list_symbol_universes()}, indent=max(0, int(args.indent))))
        return 0

    if not args.universe_id:
        raise ValueError("--universe-id is required unless --list-universes is used.")

    summary = collect_market_universe(
        args.universe_id,
        universe_label=args.universe_label,
        provider_order=args.provider_order,
        refresh_symbol_master=bool(args.refresh_symbol_master),
        exchange=args.exchange,
        mic=args.mic,
        symbols=args.symbols,
        full_sync=bool(args.full_sync),
        limit=args.limit,
    )
    print(json.dumps(summary, indent=max(0, int(args.indent))))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
