#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
from datetime import date, timedelta

import databento as db

try:
    from env_utils import load_local_env
except ModuleNotFoundError:
    from scripts.env_utils import load_local_env


CONTROL_DATASET = "XNAS.ITCH"
CONTROL_SYMBOL = "AAPL"
CONTROL_SCHEMA = "ohlcv-1d"
TARGET_CFE_DATASET = "XCBF.PITCH"
FUTURES_CONTROL_DATASET = "GLBX.MDP3"
FUTURES_CONTROL_SYMBOL = "ESM6"

PROBE_DATASETS = [
    TARGET_CFE_DATASET,
    FUTURES_CONTROL_DATASET,
    "OPRA.PILLAR",
    CONTROL_DATASET,
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify local Databento credentials and fetch a tiny historical sample.",
    )
    parser.add_argument(
        "--dataset",
        default=CONTROL_DATASET,
        help=f"Dataset to fetch. Default: {CONTROL_DATASET}",
    )
    parser.add_argument(
        "--symbol",
        default=CONTROL_SYMBOL,
        help=f"Symbol to fetch. Default: {CONTROL_SYMBOL}",
    )
    parser.add_argument(
        "--schema",
        default=CONTROL_SCHEMA,
        help=f"Schema to fetch. Default: {CONTROL_SCHEMA}",
    )
    parser.add_argument(
        "--stype-in",
        default="raw_symbol",
        help="Databento stype_in value. Default: raw_symbol",
    )
    parser.add_argument(
        "--start",
        default=(date.today() - timedelta(days=4)).isoformat(),
        help="Inclusive start date in YYYY-MM-DD. Default: 4 days ago.",
    )
    parser.add_argument(
        "--end",
        default=(date.today() - timedelta(days=1)).isoformat(),
        help="Exclusive end date in YYYY-MM-DD. Default: yesterday.",
    )
    parser.add_argument(
        "--list-datasets",
        action="store_true",
        help="Print every historical dataset visible to this key.",
    )
    return parser.parse_args()


def print_dataset_summary(datasets: list[str]) -> None:
    print(f"Authenticated with Databento. Accessible historical datasets: {len(datasets)}")
    for dataset in PROBE_DATASETS:
        print(f"- {dataset}: {'visible' if dataset in datasets else 'not visible'}")


def print_probe_schemas(client: db.Historical, datasets: list[str]) -> None:
    print("\nProbe schema support:")
    for dataset in PROBE_DATASETS:
        if dataset not in datasets:
            print(f"- {dataset}: skipped because the key cannot see this dataset")
            continue
        try:
            schemas = client.metadata.list_schemas(dataset=dataset)
        except Exception as error:  # noqa: BLE001
            print(f"- {dataset}: schema probe failed: {type(error).__name__}: {error}")
            continue

        preview = ", ".join(schemas[:8])
        suffix = " ..." if len(schemas) > 8 else ""
        print(f"- {dataset}: {preview}{suffix}")


def fetch_sample(
    client: db.Historical,
    *,
    dataset: str,
    symbol: str,
    schema: str,
    stype_in: str,
    start: str,
    end: str,
) -> None:
    store = client.timeseries.get_range(
        dataset=dataset,
        symbols=symbol,
        stype_in=stype_in,
        schema=schema,
        start=start,
        end=end,
    )
    frame = store.to_df()
    print(
        f"- {dataset} {symbol} {schema}: ok, rows={len(frame)}",
    )
    if frame.empty:
        print("  Returned an empty frame.")
        return
    print(frame.reset_index().head(3).to_string())


def main() -> int:
    args = parse_args()
    load_local_env()
    api_key = os.environ.get("DATABENTO_API_KEY")
    if not api_key:
        raise SystemExit("DATABENTO_API_KEY is not set. Put it in .env or the shell environment first.")

    client = db.Historical(api_key)
    datasets = client.metadata.list_datasets()
    cfe_visible = TARGET_CFE_DATASET in datasets

    print_dataset_summary(datasets)
    print_probe_schemas(client, datasets)

    if args.list_datasets:
        print("\nAccessible datasets:")
        for dataset in datasets:
            print(dataset)

    print("\nControl fetches:")
    try:
        fetch_sample(
            client,
            dataset=CONTROL_DATASET,
            symbol=CONTROL_SYMBOL,
            schema=CONTROL_SCHEMA,
            stype_in="raw_symbol",
            start=args.start,
            end=args.end,
        )
    except Exception as error:  # noqa: BLE001
        print(f"- {CONTROL_DATASET} {CONTROL_SYMBOL} {CONTROL_SCHEMA}: failed: {type(error).__name__}: {error}")

    try:
        fetch_sample(
            client,
            dataset=FUTURES_CONTROL_DATASET,
            symbol=FUTURES_CONTROL_SYMBOL,
            schema=CONTROL_SCHEMA,
            stype_in="raw_symbol",
            start=args.start,
            end=args.end,
        )
    except Exception as error:  # noqa: BLE001
        print(f"- {FUTURES_CONTROL_DATASET} {FUTURES_CONTROL_SYMBOL} {CONTROL_SCHEMA}: failed: {type(error).__name__}: {error}")

    if args.dataset == CONTROL_DATASET and args.symbol == CONTROL_SYMBOL and args.schema == CONTROL_SCHEMA:
        print("\nCustom fetch skipped because it matches the built-in control fetch.")
    else:
        print("\nCustom fetch:")
        try:
            fetch_sample(
                client,
                dataset=args.dataset,
                symbol=args.symbol,
                schema=args.schema,
                stype_in=args.stype_in,
                start=args.start,
                end=args.end,
            )
        except Exception as error:  # noqa: BLE001
            print(f"- {args.dataset} {args.symbol} {args.schema}: failed: {type(error).__name__}: {error}")

    print("\nCFE verdict:")
    if cfe_visible:
        print(f"- {TARGET_CFE_DATASET} is visible. The account appears entitled for CFE historical access.")
    else:
        print(f"- {TARGET_CFE_DATASET} is not visible. This account cannot currently fetch VIX futures from Databento.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
