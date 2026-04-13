#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterable


DEFAULT_OUTPUT_ROOT = "data/snapshots"
DEFAULT_MAX_MARKET_LAG_DAYS = 5
DEFAULT_MAX_SYNC_AGE_DAYS = 7
DEFAULT_MAX_GAP_DAYS = 10
DEFAULT_MAX_ABS_DAILY_RETURN = 0.12
TOP_FINDINGS_PER_KIND = 3

SEVERITY_RANK = {
    "info": 0,
    "warn": 1,
    "error": 2,
}


@dataclass(frozen=True)
class Finding:
    severity: str
    dataset_id: str
    kind: str
    message: str


@dataclass(frozen=True)
class DatasetAudit:
    dataset_id: str
    label: str
    symbol: str
    observations: int
    start_date: str
    end_date: str
    market_lag_days: int
    sync_age_days: int | None
    max_gap_days: int
    max_abs_daily_return: float
    findings: tuple[Finding, ...]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit bundled yfinance snapshot freshness and quality signals.",
    )
    parser.add_argument(
        "--output-root",
        default=DEFAULT_OUTPUT_ROOT,
        help="Directory where normalized snapshots are written. Default: data/snapshots",
    )
    parser.add_argument(
        "--as-of",
        help="Reference date for freshness checks in YYYY-MM-DD. Default: today (UTC).",
    )
    parser.add_argument(
        "--max-market-lag-days",
        type=int,
        default=DEFAULT_MAX_MARKET_LAG_DAYS,
        help=f"Warn when snapshot endDate lags the audit date by more than this many days. Default: {DEFAULT_MAX_MARKET_LAG_DAYS}",
    )
    parser.add_argument(
        "--max-sync-age-days",
        type=int,
        default=DEFAULT_MAX_SYNC_AGE_DAYS,
        help=f"Warn when generatedAt is older than this many days. Default: {DEFAULT_MAX_SYNC_AGE_DAYS}",
    )
    parser.add_argument(
        "--max-gap-days",
        type=int,
        default=DEFAULT_MAX_GAP_DAYS,
        help=f"Warn when consecutive dates are separated by more than this many days. Default: {DEFAULT_MAX_GAP_DAYS}",
    )
    parser.add_argument(
        "--max-abs-daily-return",
        type=float,
        default=DEFAULT_MAX_ABS_DAILY_RETURN,
        help=f"Warn when absolute day-over-day return exceeds this decimal threshold. Default: {DEFAULT_MAX_ABS_DAILY_RETURN}",
    )
    parser.add_argument(
        "--fail-on",
        choices=("error", "warn", "never"),
        default="error",
        help="Set the minimum severity that should return a non-zero exit code. Default: error",
    )
    return parser.parse_args()


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_iso_date(value: str) -> date:
    return date.fromisoformat(value)


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None

    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def format_percent(decimal_value: float) -> str:
    return f"{decimal_value * 100:.2f}%"


def format_optional_days(value: int | None) -> str:
    if value is None:
        return "n/a"
    return f"{value}d"


def summarize_gap_findings(
    dataset_id: str,
    gaps: list[tuple[int, str, str]],
    max_gap_days: int,
) -> list[Finding]:
    large_gaps = [gap for gap in gaps if gap[0] > max_gap_days]
    if not large_gaps:
        return []

    samples = ", ".join(
        f"{start_date}->{end_date} ({gap_days}d)"
        for gap_days, start_date, end_date in sorted(
            large_gaps,
            key=lambda item: (-item[0], item[1], item[2]),
        )[:TOP_FINDINGS_PER_KIND]
    )
    return [
        Finding(
            severity="warn",
            dataset_id=dataset_id,
            kind="gap",
            message=(
                f"Found {len(large_gaps)} consecutive-date gaps above {max_gap_days}d. "
                f"Examples: {samples}."
            ),
        ),
    ]


def summarize_outlier_findings(
    dataset_id: str,
    moves: list[tuple[float, str]],
    max_abs_daily_return: float,
) -> list[Finding]:
    outliers = [move for move in moves if move[0] > max_abs_daily_return]
    if not outliers:
        return []

    samples = ", ".join(
        f"{move_date} ({format_percent(move_value)})"
        for move_value, move_date in sorted(
            outliers,
            key=lambda item: (-item[0], item[1]),
        )[:TOP_FINDINGS_PER_KIND]
    )
    return [
        Finding(
            severity="warn",
            dataset_id=dataset_id,
            kind="outlier",
            message=(
                f"Found {len(outliers)} day-over-day moves above {format_percent(max_abs_daily_return)}. "
                f"Examples: {samples}."
            ),
        ),
    ]


def audit_snapshot(
    snapshot: dict,
    *,
    reference_date: date,
    max_market_lag_days: int,
    max_sync_age_days: int,
    max_gap_days: int,
    max_abs_daily_return: float,
) -> DatasetAudit:
    dataset_id = str(snapshot.get("datasetId") or "").strip()
    label = str(snapshot.get("label") or dataset_id).strip() or dataset_id
    symbol = str(snapshot.get("symbol") or "").strip()
    raw_points = snapshot.get("points") or []

    if len(raw_points) < 2:
        raise ValueError(f"{dataset_id}: points must contain at least two observations.")

    points: list[tuple[date, float]] = []
    findings: list[Finding] = []
    for index, point in enumerate(raw_points):
        if not isinstance(point, list) or len(point) < 2:
            raise ValueError(f"{dataset_id}: point {index} must be a 2-item list.")

        point_date = parse_iso_date(str(point[0]))
        point_value = float(point[1])
        points.append((point_date, point_value))

        if point_value <= 0:
            findings.append(
                Finding(
                    severity="error",
                    dataset_id=dataset_id,
                    kind="non-positive",
                    message=f"Encountered a non-positive close on {point_date.isoformat()}: {point_value}.",
                ),
            )

    gaps: list[tuple[int, str, str]] = []
    moves: list[tuple[float, str]] = []
    for index in range(1, len(points)):
        previous_date, previous_value = points[index - 1]
        current_date, current_value = points[index]
        gaps.append(
            (
                (current_date - previous_date).days,
                previous_date.isoformat(),
                current_date.isoformat(),
            ),
        )
        if previous_value > 0:
            moves.append((abs(current_value / previous_value - 1), current_date.isoformat()))

    start_date = points[0][0]
    end_date = points[-1][0]
    market_lag_days = max((reference_date - end_date).days, 0)

    generated_at = parse_iso_datetime(snapshot.get("generatedAt"))
    sync_age_days = None
    if generated_at is not None:
        sync_age_days = max(
            (reference_date - generated_at.astimezone(timezone.utc).date()).days,
            0,
        )

    max_observed_gap_days = max(gap_days for gap_days, _, _ in gaps)
    max_observed_abs_daily_return = max(move_value for move_value, _ in moves)

    if market_lag_days > max_market_lag_days:
        findings.append(
            Finding(
                severity="warn",
                dataset_id=dataset_id,
                kind="stale-market",
                message=(
                    f"Snapshot endDate {end_date.isoformat()} lags the audit date by "
                    f"{market_lag_days}d, above the {max_market_lag_days}d threshold."
                ),
            ),
        )

    if sync_age_days is None:
        findings.append(
            Finding(
                severity="warn",
                dataset_id=dataset_id,
                kind="sync-age",
                message="Snapshot is missing generatedAt, so sync age could not be assessed.",
            ),
        )
    elif sync_age_days > max_sync_age_days:
        findings.append(
            Finding(
                severity="warn",
                dataset_id=dataset_id,
                kind="sync-age",
                message=(
                    f"Snapshot generatedAt {generated_at.astimezone(timezone.utc).isoformat()} "
                    f"is {sync_age_days}d old, above the {max_sync_age_days}d threshold."
                ),
            ),
        )

    findings.extend(summarize_gap_findings(dataset_id, gaps, max_gap_days))
    findings.extend(summarize_outlier_findings(dataset_id, moves, max_abs_daily_return))

    note = str(snapshot.get("note") or "").strip()
    if note:
        findings.append(
            Finding(
                severity="warn",
                dataset_id=dataset_id,
                kind="note",
                message=f"Snapshot note signals a quality caveat: {note}",
            ),
        )

    return DatasetAudit(
        dataset_id=dataset_id,
        label=label,
        symbol=symbol,
        observations=len(points),
        start_date=start_date.isoformat(),
        end_date=end_date.isoformat(),
        market_lag_days=market_lag_days,
        sync_age_days=sync_age_days,
        max_gap_days=max_observed_gap_days,
        max_abs_daily_return=max_observed_abs_daily_return,
        findings=tuple(
            sorted(
                findings,
                key=lambda item: (-SEVERITY_RANK[item.severity], item.kind, item.message),
            ),
        ),
    )


def load_manifest_datasets(output_root: Path) -> list[dict]:
    manifest_path = output_root / "yfinance" / "index" / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Missing manifest: {manifest_path}")

    manifest = load_json(manifest_path)
    datasets = manifest.get("datasets")
    if not isinstance(datasets, list):
        raise ValueError(f"{manifest_path}: datasets must be a list.")
    return datasets


def iter_snapshot_audits(
    output_root: Path,
    *,
    reference_date: date,
    max_market_lag_days: int,
    max_sync_age_days: int,
    max_gap_days: int,
    max_abs_daily_return: float,
) -> Iterable[DatasetAudit]:
    for dataset in load_manifest_datasets(output_root):
        relative_path = str(dataset.get("path") or "").strip()
        snapshot_path = output_root / relative_path
        snapshot = load_json(snapshot_path)
        yield audit_snapshot(
            snapshot,
            reference_date=reference_date,
            max_market_lag_days=max_market_lag_days,
            max_sync_age_days=max_sync_age_days,
            max_gap_days=max_gap_days,
            max_abs_daily_return=max_abs_daily_return,
        )


def print_audit_report(audits: list[DatasetAudit], reference_date: date, output_root: Path) -> None:
    print(
        f"Audited {len(audits)} yfinance snapshots in {output_root / 'yfinance' / 'index'} as of {reference_date.isoformat()}",
    )
    for audit in audits:
        highest_severity = max(
            (SEVERITY_RANK[finding.severity] for finding in audit.findings),
            default=SEVERITY_RANK["info"],
        )
        status = next(
            label
            for label, rank in SEVERITY_RANK.items()
            if rank == highest_severity
        ).upper()
        print(
            " ".join(
                [
                    status,
                    audit.dataset_id,
                    f"symbol={audit.symbol}",
                    f"obs={audit.observations}",
                    f"start={audit.start_date}",
                    f"end={audit.end_date}",
                    f"marketLag={audit.market_lag_days}d",
                    f"syncAge={format_optional_days(audit.sync_age_days)}",
                    f"maxGap={audit.max_gap_days}d",
                    f"maxAbsMove={format_percent(audit.max_abs_daily_return)}",
                ],
            ),
        )
        for finding in audit.findings:
            print(f"  {finding.severity.upper()} {finding.kind}: {finding.message}")

    warning_count = sum(
        1
        for audit in audits
        for finding in audit.findings
        if finding.severity == "warn"
    )
    error_count = sum(
        1
        for audit in audits
        for finding in audit.findings
        if finding.severity == "error"
    )
    print(f"Audit completed with {warning_count} warning(s) and {error_count} error(s).")


def should_fail(audits: list[DatasetAudit], fail_on: str) -> bool:
    if fail_on == "never":
        return False

    threshold = SEVERITY_RANK[fail_on]
    return any(
        SEVERITY_RANK[finding.severity] >= threshold
        for audit in audits
        for finding in audit.findings
    )


def main() -> int:
    args = parse_args()
    output_root = Path(args.output_root)
    reference_date = (
        parse_iso_date(args.as_of)
        if args.as_of
        else datetime.now(timezone.utc).date()
    )
    audits = list(
        iter_snapshot_audits(
            output_root,
            reference_date=reference_date,
            max_market_lag_days=args.max_market_lag_days,
            max_sync_age_days=args.max_sync_age_days,
            max_gap_days=args.max_gap_days,
            max_abs_daily_return=args.max_abs_daily_return,
        ),
    )
    print_audit_report(audits, reference_date, output_root)
    if should_fail(audits, args.fail_on):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
