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
    parser.add_argument(
        "--market-universe-id",
        action="append",
        help="Market universe to refresh. Repeat for more. Defaults to every active local market universe.",
    )
    parser.add_argument(
        "--options-universe-id",
        action="append",
        help="Options evidence universe to refresh. Repeat for more. Defaults to every configured options universe.",
    )
    parser.add_argument(
        "--fundamental-universe-id",
        action="append",
        help="Fundamental universe to refresh. Repeat for more. Defaults to built-in fundamental universes when fundamentals run.",
    )
    parser.add_argument("--skip-market", action="store_true")
    parser.add_argument("--skip-options", action="store_true")
    parser.add_argument("--run-fundamentals", action="store_true")
    parser.add_argument("--seed-fundamental-universes", action="store_true")
    parser.add_argument("--refresh-exchange-symbol-masters", action="store_true")
    parser.add_argument("--market-provider-order")
    parser.add_argument("--market-full-sync", action="store_true")
    parser.add_argument("--market-limit", type=int)
    parser.add_argument("--options-minimum-dte", type=int)
    parser.add_argument("--options-max-contracts", type=int)
    parser.add_argument("--options-as-of-date")
    parser.add_argument("--fundamental-period-days", type=int, default=366)
    parser.add_argument("--fundamental-limit", type=int)
    parser.add_argument("--fundamental-delay-seconds", type=float, default=0.0)
    parser.add_argument(
        "--refresh-saved-study-readiness",
        action="store_true",
        help="Refresh readiness artifacts for active keep-warm saved studies without running studies.",
    )
    parser.add_argument(
        "--refresh-saved-study-include-cold",
        action="store_true",
        help="When refreshing saved-study readiness, include keepWarm=false saved studies too.",
    )
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
        fundamental_universe_ids=args.fundamental_universe_id,
        run_market_collection=not bool(args.skip_market),
        run_options_collection=not bool(args.skip_options),
        run_fundamental_collection=bool(args.run_fundamentals),
        seed_fundamental_universes=bool(args.seed_fundamental_universes),
        refresh_exchange_symbol_masters=bool(args.refresh_exchange_symbol_masters),
        market_provider_order=args.market_provider_order,
        market_full_sync=bool(args.market_full_sync),
        market_limit=args.market_limit,
        options_minimum_dte=args.options_minimum_dte,
        options_max_contracts=args.options_max_contracts,
        options_as_of_date=args.options_as_of_date,
        fundamental_period_days=args.fundamental_period_days,
        fundamental_limit=args.fundamental_limit,
        fundamental_delay_seconds=args.fundamental_delay_seconds,
        refresh_saved_study_readiness=bool(args.refresh_saved_study_readiness),
        refresh_saved_study_include_cold=bool(args.refresh_saved_study_include_cold),
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
