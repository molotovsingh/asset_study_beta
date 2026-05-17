#!/usr/bin/env python3

from __future__ import annotations

import tempfile
from pathlib import Path

from sync_yfinance import (
    DatasetConfig,
    build_snapshot,
    collect_manifest_entries,
    normalize_return_basis,
    normalize_source_policy,
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
            '"sourcePolicy": "blocked_proxy_tri"' in written_snapshot,
            True,
            "TRI proxy snapshots should expose their blocked source policy",
        )
        assert_equal(
            '"returnBasis": "proxy"' in written_manifest,
            True,
            "TRI backed by price data should be marked as a proxy in the manifest",
        )
        assert_equal(
            '"sourcePolicy": "blocked_proxy_tri"' in written_manifest,
            True,
            "TRI proxy manifests should expose their blocked source policy",
        )


def test_return_basis_rejects_inconsistent_total_return_claims():
    try:
        normalize_return_basis(
            "total_return",
            target_series_type="TRI",
            source_series_type="Price",
        )
    except RuntimeError as error:
        assert_equal(
            "inconsistent" in str(error),
            True,
            "inconsistent return-basis error should explain the mismatch",
        )
    else:
        raise AssertionError("TRI backed by price data must not claim total_return basis")

    assert_equal(
        normalize_return_basis(
            None,
            target_series_type="TRI",
            source_series_type="Price",
        ),
        "proxy",
        "missing returnBasis should derive proxy from mismatched target/source series",
    )

    assert_equal(
        normalize_return_basis(
            "proxy",
            target_series_type="TRI",
            source_series_type="Price",
        ),
        "proxy",
        "explicit proxy returnBasis should remain valid",
    )


def test_source_policy_tracks_return_basis_claims():
    assert_equal(
        normalize_source_policy(
            None,
            return_basis="price",
            target_series_type="Price",
            source_series_type="Price",
        ),
        "price_only",
        "price datasets should derive price_only source policy",
    )
    assert_equal(
        normalize_source_policy(
            None,
            return_basis="proxy",
            target_series_type="TRI",
            source_series_type="Price",
        ),
        "blocked_proxy_tri",
        "TRI proxy datasets should derive blocked_proxy_tri source policy",
    )
    assert_equal(
        normalize_source_policy(
            "approved_total_return",
            return_basis="total_return",
            target_series_type="TRI",
            source_series_type="TRI",
        ),
        "approved_total_return",
        "approved total-return datasets should require an explicit source policy",
    )

    try:
        normalize_source_policy(
            None,
            return_basis="total_return",
            target_series_type="TRI",
            source_series_type="TRI",
        )
    except RuntimeError as error:
        assert_equal(
            "explicitly approve" in str(error),
            True,
            "missing source-policy errors should not invent total-return approval",
        )
    else:
        raise AssertionError("true total-return data must explicitly set sourcePolicy")

    try:
        normalize_source_policy(
            "approved_total_return",
            return_basis="proxy",
            target_series_type="TRI",
            source_series_type="Price",
        )
    except RuntimeError as error:
        assert_equal(
            "inconsistent" in str(error),
            True,
            "source-policy errors should explain inconsistent return-basis claims",
        )
    else:
        raise AssertionError("proxy TRI data must not claim approved_total_return policy")


def main():
    test_repeated_snapshot_writes_preserve_existing_generated_at()
    test_snapshot_and_manifest_include_return_basis()
    test_return_basis_rejects_inconsistent_total_return_claims()
    test_source_policy_tracks_return_basis_claims()
    print("ok yfinance sync idempotence")


if __name__ == "__main__":
    main()
