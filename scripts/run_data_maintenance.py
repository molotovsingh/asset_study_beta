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
    from server import maintenance_service
except ModuleNotFoundError:
    from scripts.server import maintenance_service


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run market collection, options evidence collection, and runtime health "
            "checks in one automation-friendly command."
        ),
    )
    parser.add_argument("--market-universe-id", action="append")
    parser.add_argument("--options-universe-id", action="append")
    parser.add_argument("--skip-market", action="store_true")
    parser.add_argument("--skip-options", action="store_true")
    parser.add_argument("--refresh-exchange-symbol-masters", action="store_true")
    parser.add_argument("--market-provider-order")
    parser.add_argument("--market-full-sync", action="store_true")
    parser.add_argument("--market-limit", type=int)
    parser.add_argument("--options-minimum-dte", type=int)
    parser.add_argument("--options-max-contracts", type=int)
    parser.add_argument("--options-as-of-date")
    parser.add_argument("--health-as-of-date")
    parser.add_argument("--health-stale-after-days", type=int, default=7)
    parser.add_argument("--health-symbol-limit", type=int, default=20)
    parser.add_argument("--health-universe-limit", type=int, default=20)
    parser.add_argument("--health-run-limit", type=int, default=10)
    parser.add_argument(
        "--max-attention-symbols",
        type=int,
        help="Exit non-zero when runtime health attention symbols exceed this threshold.",
    )
    parser.add_argument(
        "--max-sync-errors",
        type=int,
        help="Exit non-zero when runtime health sync errors exceed this threshold.",
    )
    parser.add_argument("--indent", type=int, default=2)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    payload = maintenance_service.run_data_maintenance(
        market_universe_ids=args.market_universe_id,
        options_universe_ids=args.options_universe_id,
        run_market_collection=not bool(args.skip_market),
        run_options_collection=not bool(args.skip_options),
        refresh_exchange_symbol_masters=bool(args.refresh_exchange_symbol_masters),
        market_provider_order=args.market_provider_order,
        market_full_sync=bool(args.market_full_sync),
        market_limit=args.market_limit,
        options_minimum_dte=args.options_minimum_dte,
        options_max_contracts=args.options_max_contracts,
        options_as_of_date=args.options_as_of_date,
        health_stale_after_days=args.health_stale_after_days,
        health_symbol_limit=args.health_symbol_limit,
        health_universe_limit=args.health_universe_limit,
        health_run_limit=args.health_run_limit,
        health_as_of_date=args.health_as_of_date,
        max_attention_symbols=args.max_attention_symbols,
        max_sync_errors=args.max_sync_errors,
    )
    print(json.dumps(payload, indent=max(0, int(args.indent))))
    return 0 if payload.get("status") == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
