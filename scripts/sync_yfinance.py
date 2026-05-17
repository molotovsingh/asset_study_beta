#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from time import sleep


@dataclass(frozen=True)
class DatasetConfig:
    dataset_id: str
    label: str
    symbol: str
    target_series_type: str
    source_series_type: str
    return_basis: str | None = None
    currency: str | None = None
    note: str | None = None
    provider_name: str = "Yahoo Finance"
    family: str = "Custom"
    source_url: str | None = None
    source_policy: str | None = None
    source_name: str | None = None
    license_note: str | None = None
    retrieval_method: str | None = None
    update_cadence: str | None = None
    last_verified_date: str | None = None


RETURN_BASIS_PRICE = "price"
RETURN_BASIS_TOTAL_RETURN = "total_return"
RETURN_BASIS_PROXY = "proxy"
RETURN_BASIS_VALUES = {
    RETURN_BASIS_PRICE,
    RETURN_BASIS_TOTAL_RETURN,
    RETURN_BASIS_PROXY,
}
TOTAL_RETURN_SERIES_TYPES = {"tri", "total_return", "total return"}
SOURCE_POLICY_PRICE_ONLY = "price_only"
SOURCE_POLICY_APPROVED_TOTAL_RETURN = "approved_total_return"
SOURCE_POLICY_BLOCKED_PROXY_TRI = "blocked_proxy_tri"
SOURCE_POLICY_VALUES = {
    SOURCE_POLICY_PRICE_ONLY,
    SOURCE_POLICY_APPROVED_TOTAL_RETURN,
    SOURCE_POLICY_BLOCKED_PROXY_TRI,
}
DEFAULT_YFINANCE_SOURCE_NAME = "Yahoo Finance Close via yfinance"
DEFAULT_YFINANCE_RETRIEVAL_METHOD = (
    "yfinance daily history Close with auto_adjust=false and actions=false"
)
DEFAULT_SNAPSHOT_UPDATE_CADENCE = "Manual repository snapshot sync"
DEFAULT_SOURCE_POLICY_VERIFIED_DATE = "2026-05-17"


def derive_return_basis(target_series_type: str, source_series_type: str) -> str:
    target = str(target_series_type or "").strip().lower()
    source = str(source_series_type or "").strip().lower()

    if target and source and target != source:
        return RETURN_BASIS_PROXY
    if target in TOTAL_RETURN_SERIES_TYPES:
        return RETURN_BASIS_TOTAL_RETURN
    return RETURN_BASIS_PRICE


def normalize_return_basis(
    value: str | None,
    *,
    target_series_type: str,
    source_series_type: str,
) -> str:
    normalized = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if not normalized:
        return derive_return_basis(target_series_type, source_series_type)
    if normalized not in RETURN_BASIS_VALUES:
        allowed = ", ".join(sorted(RETURN_BASIS_VALUES))
        raise RuntimeError(f"returnBasis must be one of: {allowed}")

    derived = derive_return_basis(target_series_type, source_series_type)
    if normalized == RETURN_BASIS_PROXY:
        return normalized
    if normalized != derived:
        raise RuntimeError(
            f"returnBasis {normalized!r} is inconsistent with "
            f"targetSeriesType={target_series_type!r} and sourceSeriesType={source_series_type!r}"
        )
    return normalized


def normalize_token(value: str | None) -> str:
    return str(value or "").strip().lower().replace("-", "_").replace(" ", "_")


def is_total_return_series_type(value: str | None) -> bool:
    return str(value or "").strip().lower() in TOTAL_RETURN_SERIES_TYPES


def derive_source_policy(
    *,
    return_basis: str,
    target_series_type: str,
) -> str:
    if (
        return_basis == RETURN_BASIS_PROXY
        and is_total_return_series_type(target_series_type)
    ):
        return SOURCE_POLICY_BLOCKED_PROXY_TRI
    if (
        return_basis == RETURN_BASIS_TOTAL_RETURN
        and is_total_return_series_type(target_series_type)
    ):
        return SOURCE_POLICY_APPROVED_TOTAL_RETURN
    return SOURCE_POLICY_PRICE_ONLY


def normalize_source_policy(
    value: str | None,
    *,
    return_basis: str | None,
    target_series_type: str,
    source_series_type: str,
) -> str:
    normalized_return_basis = normalize_return_basis(
        return_basis,
        target_series_type=target_series_type,
        source_series_type=source_series_type,
    )
    derived = derive_source_policy(
        return_basis=normalized_return_basis,
        target_series_type=target_series_type,
    )
    normalized = normalize_token(value)
    if not normalized:
        if derived == SOURCE_POLICY_APPROVED_TOTAL_RETURN:
            raise RuntimeError(
                "sourcePolicy must explicitly approve total-return datasets",
            )
        return derived
    if normalized not in SOURCE_POLICY_VALUES:
        allowed = ", ".join(sorted(SOURCE_POLICY_VALUES))
        raise RuntimeError(f"sourcePolicy must be one of: {allowed}")
    if normalized != derived:
        raise RuntimeError(
            f"sourcePolicy {normalized!r} is inconsistent with "
            f"returnBasis={normalized_return_basis!r} and "
            f"targetSeriesType={target_series_type!r}"
        )
    return normalized


DATASETS: dict[str, DatasetConfig] = {
    "nifty-50": DatasetConfig(
        dataset_id="nifty-50",
        label="Nifty 50",
        symbol="^NSEI",
        target_series_type="Price",
        source_series_type="Price",
        return_basis=RETURN_BASIS_PRICE,
        currency="INR",
        provider_name="NSE Indices",
        family="Broad Market",
        source_url="https://www.niftyindices.com/reports/historical-data",
        source_policy=SOURCE_POLICY_PRICE_ONLY,
        source_name=DEFAULT_YFINANCE_SOURCE_NAME,
        license_note="Local yfinance snapshot; price-return evidence only.",
        retrieval_method=DEFAULT_YFINANCE_RETRIEVAL_METHOD,
        update_cadence=DEFAULT_SNAPSHOT_UPDATE_CADENCE,
        last_verified_date=DEFAULT_SOURCE_POLICY_VERIFIED_DATE,
    ),
    "nifty-50-tri": DatasetConfig(
        dataset_id="nifty-50-tri",
        label="Nifty 50 TRI",
        symbol="^NSEI",
        target_series_type="TRI",
        source_series_type="Price",
        return_basis=RETURN_BASIS_PROXY,
        currency="INR",
        note="Bootstrap sync uses the Yahoo Finance price index as a temporary TRI proxy.",
        provider_name="NSE Indices",
        family="Broad Market",
        source_url="https://www.niftyindices.com/reports/historical-data",
        source_policy=SOURCE_POLICY_BLOCKED_PROXY_TRI,
        source_name=DEFAULT_YFINANCE_SOURCE_NAME,
        license_note=(
            "Local yfinance snapshot; not an approved true total-return feed."
        ),
        retrieval_method=DEFAULT_YFINANCE_RETRIEVAL_METHOD,
        update_cadence=DEFAULT_SNAPSHOT_UPDATE_CADENCE,
        last_verified_date=DEFAULT_SOURCE_POLICY_VERIFIED_DATE,
    ),
    "sensex": DatasetConfig(
        dataset_id="sensex",
        label="S&P BSE Sensex",
        symbol="^BSESN",
        target_series_type="Price",
        source_series_type="Price",
        return_basis=RETURN_BASIS_PRICE,
        currency="INR",
        provider_name="BSE",
        family="Broad Market",
        source_url="https://www.bseindia.com/indices/IndexArchiveData.html",
        source_policy=SOURCE_POLICY_PRICE_ONLY,
        source_name=DEFAULT_YFINANCE_SOURCE_NAME,
        license_note="Local yfinance snapshot; price-return evidence only.",
        retrieval_method=DEFAULT_YFINANCE_RETRIEVAL_METHOD,
        update_cadence=DEFAULT_SNAPSHOT_UPDATE_CADENCE,
        last_verified_date=DEFAULT_SOURCE_POLICY_VERIFIED_DATE,
    ),
    "sensex-tri": DatasetConfig(
        dataset_id="sensex-tri",
        label="S&P BSE Sensex TRI",
        symbol="^BSESN",
        target_series_type="TRI",
        source_series_type="Price",
        return_basis=RETURN_BASIS_PROXY,
        currency="INR",
        note="Bootstrap sync uses the Yahoo Finance price index as a temporary TRI proxy.",
        provider_name="BSE",
        family="Broad Market",
        source_url="https://www.bseindia.com/indices/IndexArchiveData.html",
        source_policy=SOURCE_POLICY_BLOCKED_PROXY_TRI,
        source_name=DEFAULT_YFINANCE_SOURCE_NAME,
        license_note=(
            "Local yfinance snapshot; not an approved true total-return feed."
        ),
        retrieval_method=DEFAULT_YFINANCE_RETRIEVAL_METHOD,
        update_cadence=DEFAULT_SNAPSHOT_UPDATE_CADENCE,
        last_verified_date=DEFAULT_SOURCE_POLICY_VERIFIED_DATE,
    ),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch index history from yfinance and write normalized JSON snapshots.",
    )
    parser.add_argument(
        "--dataset-id",
        action="append",
        help="Dataset id to sync. Repeat for multiple ids. Defaults to all configured datasets.",
    )
    parser.add_argument(
        "--period",
        default="10y",
        help="Yahoo Finance period to request when --start is not provided. Default: 10y",
    )
    parser.add_argument(
        "--start",
        help="Optional YYYY-MM-DD start date. Overrides --period.",
    )
    parser.add_argument(
        "--end",
        help="Optional YYYY-MM-DD end date.",
    )
    parser.add_argument(
        "--output-root",
        default="data/snapshots",
        help="Directory where normalized snapshots are written. Default: data/snapshots",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=2,
        help="Number of retry attempts for each symbol after the first failure. Default: 2",
    )
    parser.add_argument(
        "--retry-delay-sec",
        type=float,
        default=2.0,
        help="Delay between retries in seconds. Default: 2.0",
    )
    parser.add_argument(
        "--config-path",
        default="data/config/yfinance-datasets.json",
        help="Path to the JSON file containing custom yfinance datasets. Default: data/config/yfinance-datasets.json",
    )
    return parser.parse_args()


def load_yfinance():
    try:
        import yfinance as yf
    except ModuleNotFoundError:
        print(
            "yfinance is not installed. Create a local venv and run "
            "`./.venv/bin/pip install -r requirements-sync.txt` first.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    return yf


def normalize_points(points: list[list[str | float]]) -> list[list[str | float]]:
    deduped: dict[str, float] = {}

    for raw_date, raw_value in points:
        date_value = str(raw_date)
        numeric_value = float(raw_value)
        deduped[date_value] = numeric_value

    ordered_points = sorted(deduped.items())
    if len(ordered_points) < 2:
        raise RuntimeError("normalized snapshot contained fewer than two unique observations.")

    return [[date_value, value] for date_value, value in ordered_points]


def normalize_dataset_id(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    if not normalized:
        raise RuntimeError("datasetId must contain at least one letter or number.")
    return normalized


def build_yahoo_quote_url(symbol: str) -> str:
    return f"https://finance.yahoo.com/quote/{symbol}"


def dataset_from_dict(raw: dict) -> DatasetConfig:
    dataset_id = normalize_dataset_id(str(raw["datasetId"]))
    label = str(raw["label"]).strip()
    symbol = str(raw["symbol"]).strip()

    if not label:
      raise RuntimeError(f"{dataset_id}: label is required")
    if not symbol:
      raise RuntimeError(f"{dataset_id}: symbol is required")

    target_series_type = str(raw.get("targetSeriesType") or "Price").strip() or "Price"
    source_series_type = str(raw.get("sourceSeriesType") or target_series_type).strip() or target_series_type
    return_basis = normalize_return_basis(
        raw.get("returnBasis"),
        target_series_type=target_series_type,
        source_series_type=source_series_type,
    )
    source_policy = normalize_source_policy(
        raw.get("sourcePolicy"),
        return_basis=return_basis,
        target_series_type=target_series_type,
        source_series_type=source_series_type,
    )
    currency = str(raw.get("currency") or "").strip().upper() or None
    provider_name = str(raw.get("providerName") or "Yahoo Finance").strip() or "Yahoo Finance"
    family = str(raw.get("family") or "Custom").strip() or "Custom"
    source_url = str(raw.get("sourceUrl") or build_yahoo_quote_url(symbol)).strip()
    source_name = str(raw.get("sourceName") or DEFAULT_YFINANCE_SOURCE_NAME).strip()
    license_note = str(raw.get("licenseNote") or "").strip() or None
    retrieval_method = str(
        raw.get("retrievalMethod") or DEFAULT_YFINANCE_RETRIEVAL_METHOD,
    ).strip()
    update_cadence = str(
        raw.get("updateCadence") or DEFAULT_SNAPSHOT_UPDATE_CADENCE,
    ).strip()
    last_verified_date = str(raw.get("lastVerifiedDate") or "").strip() or None
    note = raw.get("note")
    if note is not None:
      note = str(note).strip() or None

    return DatasetConfig(
        dataset_id=dataset_id,
        label=label,
        symbol=symbol,
        target_series_type=target_series_type,
        source_series_type=source_series_type,
        return_basis=return_basis,
        currency=currency,
        note=note,
        provider_name=provider_name,
        family=family,
        source_url=source_url,
        source_policy=source_policy,
        source_name=source_name,
        license_note=license_note,
        retrieval_method=retrieval_method,
        update_cadence=update_cadence,
        last_verified_date=last_verified_date,
    )


def load_custom_datasets(config_path: Path) -> dict[str, DatasetConfig]:
    if not config_path.exists():
        return {}

    raw = json.loads(config_path.read_text(encoding="utf-8"))
    datasets = raw.get("datasets", [])
    if not isinstance(datasets, list):
        raise RuntimeError("Custom yfinance config must contain a top-level datasets list.")

    custom_datasets: dict[str, DatasetConfig] = {}
    for item in datasets:
        if not isinstance(item, dict):
            raise RuntimeError("Each custom dataset entry must be an object.")

        config = dataset_from_dict(item)
        if config.dataset_id in DATASETS or config.dataset_id in custom_datasets:
            raise RuntimeError(f"Duplicate datasetId in custom config: {config.dataset_id}")

        custom_datasets[config.dataset_id] = config

    return custom_datasets


def load_all_datasets(config_path: Path) -> dict[str, DatasetConfig]:
    datasets = dict(DATASETS)
    datasets.update(load_custom_datasets(config_path))
    return datasets


def fetch_points_once(
    ticker,
    config: DatasetConfig,
    start: str | None,
    end: str | None,
    period: str,
) -> list[list[str | float]]:
    history_kwargs = {
        "interval": "1d",
        "auto_adjust": False,
        "actions": False,
    }

    if start:
        history_kwargs["start"] = start
        if end:
            history_kwargs["end"] = end
    else:
        history_kwargs["period"] = period
        if end:
            history_kwargs["end"] = end

    frame = ticker.history(**history_kwargs)
    if frame.empty:
        raise RuntimeError(f"{config.dataset_id}: yfinance returned no rows for symbol {config.symbol}.")

    if "Close" not in frame.columns:
        raise RuntimeError(f"{config.dataset_id}: expected a Close column in the yfinance response.")

    points: list[list[str | float]] = []
    for index_value, raw_value in frame["Close"].items():
        try:
            numeric_value = float(raw_value)
        except (TypeError, ValueError):
            continue

        if not numeric_value == numeric_value:
            continue

        if hasattr(index_value, "date"):
            date_value = index_value.date().isoformat()
        else:
            date_value = str(index_value)[:10]

        points.append([date_value, round(numeric_value, 6)])

    normalized_points = normalize_points(points)
    if len(normalized_points) < 2:
        raise RuntimeError(f"{config.dataset_id}: normalized snapshot contained fewer than two observations.")

    return normalized_points


def resolve_ticker_currency(ticker, fallback: str | None = None) -> str | None:
    if fallback:
        return fallback.strip().upper() or None

    try:
        metadata = ticker.get_history_metadata() or {}
        currency = metadata.get("currency")
        if currency:
            return str(currency).strip().upper() or None
    except Exception:  # noqa: BLE001
        pass

    try:
        fast_info = getattr(ticker, "fast_info", None)
        if isinstance(fast_info, dict):
            currency = fast_info.get("currency")
        else:
            currency = getattr(fast_info, "currency", None)
        if currency:
            return str(currency).strip().upper() or None
    except Exception:  # noqa: BLE001
        pass

    return None


def fetch_points(
    yf,
    config: DatasetConfig,
    start: str | None,
    end: str | None,
    period: str,
    retries: int,
    retry_delay_sec: float,
) -> tuple[list[list[str | float]], str | None]:
    last_error: Exception | None = None

    for attempt in range(retries + 1):
        try:
            ticker = yf.Ticker(config.symbol)
            return (
                fetch_points_once(ticker, config, start, end, period),
                resolve_ticker_currency(ticker, config.currency),
            )
        except Exception as error:  # noqa: BLE001
            last_error = error
            if attempt >= retries:
                break

            print(
                f"{config.dataset_id}: attempt {attempt + 1} failed ({error}). Retrying...",
                file=sys.stderr,
            )
            sleep(retry_delay_sec)

    assert last_error is not None
    raise last_error


def build_snapshot(
    config: DatasetConfig,
    points: list[list[str | float]],
    currency: str | None,
) -> dict:
    return {
        "provider": "yfinance",
        "datasetType": "index",
        "datasetId": config.dataset_id,
        "label": config.label,
        "symbol": config.symbol,
        "currency": currency or config.currency,
        "targetSeriesType": config.target_series_type,
        "sourceSeriesType": config.source_series_type,
        "returnBasis": normalize_return_basis(
            config.return_basis,
            target_series_type=config.target_series_type,
            source_series_type=config.source_series_type,
        ),
        "sourcePolicy": normalize_source_policy(
            config.source_policy,
            return_basis=config.return_basis,
            target_series_type=config.target_series_type,
            source_series_type=config.source_series_type,
        ),
        "sourceName": config.source_name or DEFAULT_YFINANCE_SOURCE_NAME,
        "licenseNote": config.license_note,
        "retrievalMethod": config.retrieval_method or DEFAULT_YFINANCE_RETRIEVAL_METHOD,
        "updateCadence": config.update_cadence or DEFAULT_SNAPSHOT_UPDATE_CADENCE,
        "lastVerifiedDate": config.last_verified_date,
        "providerName": config.provider_name,
        "family": config.family,
        "sourceUrl": config.source_url or build_yahoo_quote_url(config.symbol),
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "range": {
            "startDate": points[0][0],
            "endDate": points[-1][0],
            "observations": len(points),
        },
        "note": config.note,
        "points": points,
    }


def strip_generated_at(value):
    if isinstance(value, dict):
        return {
            key: strip_generated_at(item)
            for key, item in value.items()
            if key != "generatedAt"
        }

    if isinstance(value, list):
        return [strip_generated_at(item) for item in value]

    return value


def load_json_if_exists(path: Path) -> dict | None:
    if not path.exists():
        return None

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def preserve_generated_at_when_unchanged(path: Path, payload: dict) -> dict:
    existing = load_json_if_exists(path)
    if not existing:
        return payload

    if strip_generated_at(existing) != strip_generated_at(payload):
        return payload

    existing_generated_at = existing.get("generatedAt")
    if existing_generated_at:
        return {**payload, "generatedAt": existing_generated_at}

    return payload


def write_snapshot(output_root: Path, config: DatasetConfig, snapshot: dict) -> Path:
    output_path = output_root / "yfinance" / "index" / f"{config.dataset_id}.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    snapshot = preserve_generated_at_when_unchanged(output_path, snapshot)
    output_path.write_text(f"{json.dumps(snapshot, indent=2)}\n", encoding="utf-8")
    return output_path


def build_manifest_entry(snapshot: dict, output_path: Path, output_root: Path) -> dict:
    return {
        "datasetId": snapshot["datasetId"],
        "label": snapshot["label"],
        "symbol": snapshot["symbol"],
        "currency": snapshot.get("currency"),
        "targetSeriesType": snapshot["targetSeriesType"],
        "sourceSeriesType": snapshot["sourceSeriesType"],
        "returnBasis": snapshot["returnBasis"],
        "sourcePolicy": snapshot.get("sourcePolicy"),
        "sourceName": snapshot.get("sourceName"),
        "licenseNote": snapshot.get("licenseNote"),
        "retrievalMethod": snapshot.get("retrievalMethod"),
        "updateCadence": snapshot.get("updateCadence"),
        "lastVerifiedDate": snapshot.get("lastVerifiedDate"),
        "providerName": snapshot.get("providerName"),
        "family": snapshot.get("family"),
        "sourceUrl": snapshot.get("sourceUrl"),
        "generatedAt": snapshot["generatedAt"],
        "range": snapshot["range"],
        "note": snapshot["note"],
        "path": output_path.relative_to(output_root).as_posix(),
    }


def write_manifest(output_root: Path, entries: list[dict]) -> Path:
    manifest_path = output_root / "yfinance" / "index" / "manifest.json"
    manifest = {
        "provider": "yfinance",
        "datasetType": "index",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "datasets": sorted(entries, key=lambda entry: entry["datasetId"]),
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest = preserve_generated_at_when_unchanged(manifest_path, manifest)
    manifest_path.write_text(f"{json.dumps(manifest, indent=2)}\n", encoding="utf-8")
    return manifest_path


def build_snapshot_path(output_root: Path, dataset_id: str) -> Path:
    return output_root / "yfinance" / "index" / f"{dataset_id}.json"


def collect_manifest_entries(output_root: Path, datasets: dict[str, DatasetConfig]) -> list[dict]:
    entries: list[dict] = []

    for dataset_id in sorted(datasets):
        snapshot_path = build_snapshot_path(output_root, dataset_id)
        if not snapshot_path.exists():
            continue

        snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
        entries.append(build_manifest_entry(snapshot, snapshot_path, output_root))

    return entries


def main() -> int:
    args = parse_args()
    yf = load_yfinance()
    config_path = Path(args.config_path)
    datasets = load_all_datasets(config_path)

    selected_ids = args.dataset_id or list(datasets)
    unknown_ids = [dataset_id for dataset_id in selected_ids if dataset_id not in datasets]
    if unknown_ids:
        print(
            f"Unknown dataset ids: {', '.join(unknown_ids)}. Add them to {config_path} first.",
            file=sys.stderr,
        )
        return 1

    output_root = Path(args.output_root)

    failures = 0
    for dataset_id in selected_ids:
        config = datasets[dataset_id]
        try:
            points, currency = fetch_points(
                yf,
                config,
                start=args.start,
                end=args.end,
                period=args.period,
                retries=max(args.retries, 0),
                retry_delay_sec=max(args.retry_delay_sec, 0),
            )
            snapshot = build_snapshot(config, points, currency)
            output_path = write_snapshot(output_root, config, snapshot)
            print(f"Wrote {output_path} ({len(points)} observations)")
        except Exception as error:  # noqa: BLE001
            failures += 1
            print(f"{dataset_id}: {error}", file=sys.stderr)

    manifest_entries = collect_manifest_entries(output_root, datasets)
    if manifest_entries:
        manifest_path = write_manifest(output_root, manifest_entries)
        print(f"Wrote {manifest_path} ({len(manifest_entries)} datasets)")

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
