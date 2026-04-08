#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

from sync_yfinance import load_all_datasets


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate yfinance snapshot files and manifest consistency.",
    )
    parser.add_argument(
        "--output-root",
        default="data/snapshots",
        help="Directory where normalized snapshots are written. Default: data/snapshots",
    )
    parser.add_argument(
        "--config-path",
        default="data/config/yfinance-datasets.json",
        help="Path to the JSON file containing custom yfinance datasets. Default: data/config/yfinance-datasets.json",
    )
    parser.add_argument(
        "--require-all-configured",
        action="store_true",
        help="Fail if any configured dataset is missing from the manifest.",
    )
    return parser.parse_args()


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def expect(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def parse_iso_date(value: str) -> date:
    return date.fromisoformat(value)


def validate_points(points: list, dataset_id: str) -> tuple[str, str, int]:
    expect(isinstance(points, list), f"{dataset_id}: points must be a list")
    expect(len(points) >= 2, f"{dataset_id}: points must contain at least two observations")

    previous_date: date | None = None
    seen_dates: set[str] = set()

    for index, point in enumerate(points):
        expect(
            isinstance(point, list) and len(point) >= 2,
            f"{dataset_id}: point {index} must be a 2-item list",
        )
        raw_date, raw_value = point[0], point[1]
        expect(isinstance(raw_date, str), f"{dataset_id}: point {index} date must be a string")
        current_date = parse_iso_date(raw_date)
        expect(raw_date not in seen_dates, f"{dataset_id}: duplicate date {raw_date}")
        seen_dates.add(raw_date)
        expect(
            isinstance(raw_value, (int, float)),
            f"{dataset_id}: point {index} value must be numeric",
        )
        if previous_date is not None:
            expect(
                current_date > previous_date,
                f"{dataset_id}: dates must be strictly increasing",
            )
        previous_date = current_date

    return points[0][0], points[-1][0], len(points)


def validate_snapshot(snapshot_path: Path, config, manifest_entry: dict) -> None:
    snapshot = load_json(snapshot_path)
    dataset_id = config.dataset_id

    expect(snapshot["provider"] == "yfinance", f"{dataset_id}: snapshot provider must be yfinance")
    expect(snapshot["datasetType"] == "index", f"{dataset_id}: snapshot datasetType must be index")
    expect(snapshot["datasetId"] == dataset_id, f"{dataset_id}: snapshot datasetId mismatch")
    expect(snapshot["label"] == config.label, f"{dataset_id}: snapshot label mismatch")
    expect(snapshot["symbol"] == config.symbol, f"{dataset_id}: snapshot symbol mismatch")
    expect(
        snapshot["targetSeriesType"] == config.target_series_type,
        f"{dataset_id}: snapshot targetSeriesType mismatch",
    )
    expect(
        snapshot["sourceSeriesType"] == config.source_series_type,
        f"{dataset_id}: snapshot sourceSeriesType mismatch",
    )
    expect(snapshot.get("note") == config.note, f"{dataset_id}: snapshot note mismatch")
    expect(
        snapshot.get("providerName") == config.provider_name,
        f"{dataset_id}: snapshot providerName mismatch",
    )
    expect(snapshot.get("family") == config.family, f"{dataset_id}: snapshot family mismatch")
    expect(snapshot.get("sourceUrl") == config.source_url, f"{dataset_id}: snapshot sourceUrl mismatch")

    start_date, end_date, observation_count = validate_points(snapshot["points"], dataset_id)
    expect(
        snapshot["range"]["startDate"] == start_date,
        f"{dataset_id}: snapshot range.startDate does not match points",
    )
    expect(
        snapshot["range"]["endDate"] == end_date,
        f"{dataset_id}: snapshot range.endDate does not match points",
    )
    expect(
        snapshot["range"]["observations"] == observation_count,
        f"{dataset_id}: snapshot range.observations does not match points",
    )

    expect(
        manifest_entry["datasetId"] == dataset_id,
        f"{dataset_id}: manifest datasetId mismatch",
    )
    expect(manifest_entry["label"] == snapshot["label"], f"{dataset_id}: manifest label mismatch")
    expect(manifest_entry["symbol"] == snapshot["symbol"], f"{dataset_id}: manifest symbol mismatch")
    expect(
        manifest_entry["targetSeriesType"] == snapshot["targetSeriesType"],
        f"{dataset_id}: manifest targetSeriesType mismatch",
    )
    expect(
        manifest_entry["sourceSeriesType"] == snapshot["sourceSeriesType"],
        f"{dataset_id}: manifest sourceSeriesType mismatch",
    )
    expect(
        manifest_entry.get("providerName") == snapshot.get("providerName"),
        f"{dataset_id}: manifest providerName mismatch",
    )
    expect(
        manifest_entry.get("family") == snapshot.get("family"),
        f"{dataset_id}: manifest family mismatch",
    )
    expect(
        manifest_entry.get("sourceUrl") == snapshot.get("sourceUrl"),
        f"{dataset_id}: manifest sourceUrl mismatch",
    )
    expect(manifest_entry["note"] == snapshot.get("note"), f"{dataset_id}: manifest note mismatch")
    expect(manifest_entry["range"] == snapshot["range"], f"{dataset_id}: manifest range mismatch")
    expect(
        manifest_entry["generatedAt"] == snapshot["generatedAt"],
        f"{dataset_id}: manifest generatedAt mismatch",
    )


def validate_manifest(output_root: Path, datasets, require_all_configured: bool) -> None:
    manifest_path = output_root / "yfinance" / "index" / "manifest.json"
    expect(manifest_path.exists(), "manifest.json is missing")

    manifest = load_json(manifest_path)
    expect(manifest["provider"] == "yfinance", "manifest provider must be yfinance")
    expect(manifest["datasetType"] == "index", "manifest datasetType must be index")
    expect(isinstance(manifest.get("datasets"), list), "manifest datasets must be a list")

    expected_ids = set(datasets)
    seen_ids: set[str] = set()

    for entry in manifest["datasets"]:
        dataset_id = entry.get("datasetId")
        expect(dataset_id in datasets, f"manifest contains unexpected dataset {dataset_id}")
        expect(dataset_id not in seen_ids, f"manifest contains duplicate dataset {dataset_id}")
        seen_ids.add(dataset_id)

        relative_path = entry.get("path")
        expect(isinstance(relative_path, str), f"{dataset_id}: manifest path must be a string")
        expected_path = f"yfinance/index/{dataset_id}.json"
        expect(relative_path == expected_path, f"{dataset_id}: manifest path mismatch")

        snapshot_path = output_root / relative_path
        expect(snapshot_path.exists(), f"{dataset_id}: snapshot file is missing")
        validate_snapshot(snapshot_path, datasets[dataset_id], entry)

    if require_all_configured:
        missing_ids = sorted(expected_ids - seen_ids)
        expect(not missing_ids, f"manifest is missing datasets: {', '.join(missing_ids)}")


def main() -> int:
    args = parse_args()
    output_root = Path(args.output_root)
    datasets = load_all_datasets(Path(args.config_path))
    validate_manifest(output_root, datasets, args.require_all_configured)

    print(f"Validated yfinance snapshots in {output_root / 'yfinance' / 'index'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
