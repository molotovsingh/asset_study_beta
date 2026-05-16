#!/usr/bin/env python3

from __future__ import annotations

import tempfile
from pathlib import Path

from sync_yfinance import (
    DatasetConfig,
    build_snapshot,
    collect_manifest_entries,
    write_manifest,
    write_snapshot,
)


def assert_equal(actual, expected, message):
    if actual != expected:
        raise AssertionError(f"{message}: expected {expected!r}, got {actual!r}")


def test_repeated_snapshot_writes_preserve_existing_generated_at():
    config = DatasetConfig(
        dataset_id="demo-index",
        label="Demo Index",
        symbol="^DEMO",
        target_series_type="Price",
        source_series_type="Price",
        currency="USD",
    )
    points = [
        ["2026-05-14", 100.0],
        ["2026-05-15", 101.0],
    ]

    with tempfile.TemporaryDirectory() as temp_dir:
        output_root = Path(temp_dir)

        first_snapshot = build_snapshot(config, points, "USD")
        first_snapshot["generatedAt"] = "2026-05-16T00:00:00Z"
        snapshot_path = write_snapshot(output_root, config, first_snapshot)
        manifest_path = write_manifest(
            output_root,
            collect_manifest_entries(output_root, {config.dataset_id: config}),
        )
        first_snapshot_text = snapshot_path.read_text(encoding="utf-8")
        first_manifest_text = manifest_path.read_text(encoding="utf-8")

        second_snapshot = build_snapshot(config, points, "USD")
        second_snapshot["generatedAt"] = "2099-01-01T00:00:00Z"
        write_snapshot(output_root, config, second_snapshot)
        write_manifest(
            output_root,
            collect_manifest_entries(output_root, {config.dataset_id: config}),
        )

        assert_equal(
            snapshot_path.read_text(encoding="utf-8"),
            first_snapshot_text,
            "unchanged snapshots should not churn generatedAt",
        )
        assert_equal(
            manifest_path.read_text(encoding="utf-8"),
            first_manifest_text,
            "unchanged manifests should not churn generatedAt",
        )


def test_snapshot_and_manifest_include_return_basis():
    config = DatasetConfig(
        dataset_id="demo-tri",
        label="Demo TRI",
        symbol="^DEMO",
        target_series_type="TRI",
        source_series_type="Price",
        currency="USD",
    )
    points = [
        ["2026-05-14", 100.0],
        ["2026-05-15", 101.0],
    ]

    with tempfile.TemporaryDirectory() as temp_dir:
        output_root = Path(temp_dir)
        snapshot = build_snapshot(config, points, "USD")
        snapshot_path = write_snapshot(output_root, config, snapshot)
        manifest_path = write_manifest(
            output_root,
            collect_manifest_entries(output_root, {config.dataset_id: config}),
        )

        written_snapshot = snapshot_path.read_text(encoding="utf-8")
        written_manifest = manifest_path.read_text(encoding="utf-8")
        assert_equal(
            '"returnBasis": "proxy"' in written_snapshot,
            True,
            "TRI backed by price data should be marked as a proxy in the snapshot",
        )
        assert_equal(
            '"returnBasis": "proxy"' in written_manifest,
            True,
            "TRI backed by price data should be marked as a proxy in the manifest",
        )


def main():
    test_repeated_snapshot_writes_preserve_existing_generated_at()
    test_snapshot_and_manifest_include_return_basis()
    print("ok yfinance sync idempotence")


if __name__ == "__main__":
    main()
