#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from sync_yfinance import build_yahoo_quote_url, normalize_dataset_id


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Register a custom yfinance dataset in data/config/yfinance-datasets.json.",
    )
    parser.add_argument("--symbol", required=True, help="yfinance symbol to sync, for example AAPL or ETH-USD")
    parser.add_argument("--label", required=True, help="Display label to show in the app")
    parser.add_argument(
        "--dataset-id",
        help="Stable dataset id. If omitted, one is generated from the label.",
    )
    parser.add_argument(
        "--target-series-type",
        default="Price",
        help="Displayed target series type. Default: Price",
    )
    parser.add_argument(
        "--source-series-type",
        help="Underlying source series type. Defaults to target series type.",
    )
    parser.add_argument(
        "--provider-name",
        default="Yahoo Finance",
        help="Provider label shown in the app. Default: Yahoo Finance",
    )
    parser.add_argument(
        "--family",
        default="Custom",
        help="Family label shown in the app. Default: Custom",
    )
    parser.add_argument(
        "--source-url",
        help="Source URL shown in the app. Defaults to the Yahoo quote page for the symbol.",
    )
    parser.add_argument("--note", help="Optional note attached to the synced dataset.")
    parser.add_argument(
        "--config-path",
        default="data/config/yfinance-datasets.json",
        help="Path to the custom yfinance dataset config. Default: data/config/yfinance-datasets.json",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Immediately refresh and validate yfinance snapshots after registering the dataset.",
    )
    parser.add_argument(
        "--period",
        default="5y",
        help="Sync period to use with --refresh when --start is not provided. Default: 5y",
    )
    parser.add_argument(
        "--start",
        help="Optional YYYY-MM-DD start date to use with --refresh. Overrides --period.",
    )
    parser.add_argument(
        "--end",
        help="Optional YYYY-MM-DD end date to use with --refresh.",
    )
    parser.add_argument(
        "--output-root",
        default="data/snapshots",
        help="Directory where refreshed snapshots are written. Default: data/snapshots",
    )
    return parser.parse_args()


def load_config(path: Path) -> dict:
    if not path.exists():
        return {"datasets": []}

    config = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(config.get("datasets"), list):
        raise RuntimeError("Custom yfinance config must contain a top-level datasets list.")
    return config


def run_refresh(args: argparse.Namespace) -> None:
    repo_root = Path(__file__).resolve().parent.parent
    sync_command = [
        sys.executable,
        "scripts/sync_yfinance.py",
        "--config-path",
        args.config_path,
        "--output-root",
        args.output_root,
    ]
    if args.start:
        sync_command.extend(["--start", args.start])
    else:
        sync_command.extend(["--period", args.period])
    if args.end:
        sync_command.extend(["--end", args.end])

    validate_command = [
        sys.executable,
        "scripts/validate_yfinance_snapshots.py",
        "--config-path",
        args.config_path,
        "--output-root",
        args.output_root,
        "--require-all-configured",
    ]

    subprocess.run(sync_command, cwd=repo_root, check=True)
    subprocess.run(validate_command, cwd=repo_root, check=True)


def main() -> int:
    args = parse_args()
    config_path = Path(args.config_path)
    config_path.parent.mkdir(parents=True, exist_ok=True)

    config = load_config(config_path)
    dataset_id = normalize_dataset_id(args.dataset_id or args.label)
    source_series_type = args.source_series_type or args.target_series_type

    for dataset in config["datasets"]:
        if dataset.get("datasetId") == dataset_id:
            raise RuntimeError(f"datasetId already exists: {dataset_id}")

    entry = {
        "datasetId": dataset_id,
        "label": args.label.strip(),
        "symbol": args.symbol.strip(),
        "targetSeriesType": args.target_series_type.strip() or "Price",
        "sourceSeriesType": source_series_type.strip() or args.target_series_type.strip() or "Price",
        "providerName": args.provider_name.strip() or "Yahoo Finance",
        "family": args.family.strip() or "Custom",
        "sourceUrl": (args.source_url or build_yahoo_quote_url(args.symbol.strip())).strip(),
        "note": args.note.strip() if args.note else None,
    }
    config["datasets"].append(entry)
    config["datasets"] = sorted(config["datasets"], key=lambda item: item["datasetId"])

    config_path.write_text(f"{json.dumps(config, indent=2)}\n", encoding="utf-8")

    print(f"Registered {dataset_id} in {config_path}")
    if args.refresh:
        run_refresh(args)
        print(f"Refreshed yfinance snapshots in {args.output_root}")
    else:
        print("Next step: ./scripts/refresh_yfinance.sh --period 5y")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
