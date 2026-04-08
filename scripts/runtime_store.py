from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from urllib.parse import quote


REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_ROOT = REPO_ROOT / "data" / "local-cache" / "yfinance" / "index"
CACHE_DB_PATH = CACHE_ROOT / "cache.sqlite3"
LEGACY_MANIFEST_PATH = CACHE_ROOT / "manifest.json"

_RUNTIME_STORE_LOCK = Lock()
_RUNTIME_STORE_READY = False


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def to_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None

    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def build_symbol_source_url(symbol: str) -> str:
    return f"https://finance.yahoo.com/quote/{quote(symbol, safe='')}"


def slugify(value: str) -> str:
    stripped = value.strip().lower()
    normalized = "".join(
        char if char.isalnum() else "-"
        for char in stripped
    )
    collapsed = "-".join(filter(None, normalized.split("-")))
    return collapsed or "symbol"


def symbol_cache_key(symbol: str) -> str:
    digest = hashlib.sha1(symbol.strip().encode("utf-8")).hexdigest()[:8]
    return f"{slugify(symbol)}-{digest}"


def load_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_dataset_id(value: str | None) -> str:
    return str(value or "").strip().lower()


def normalize_symbol(value: str | None) -> str:
    return str(value or "").strip().upper()


def build_range(points: list[list[str | float]]) -> dict:
    return {
        "startDate": points[0][0],
        "endDate": points[-1][0],
        "observations": len(points),
    }


def build_runtime_cache_path(cache_key: str | None = None) -> str:
    base_path = str(CACHE_DB_PATH.relative_to(REPO_ROOT))
    if cache_key:
        return f"{base_path}#series={cache_key}"
    return base_path


def extract_cache_key_from_path(value: str | None) -> str | None:
    if not value:
        return None

    text = str(value).strip()
    if "#series=" in text:
        return text.split("#series=", 1)[1] or None

    candidate = Path(text)
    if candidate.suffix == ".json":
        return candidate.stem

    return None


def points_to_json(points: list[list[str | float]]) -> str:
    return json.dumps(points, separators=(",", ":"))


def points_from_json(payload: str) -> list[list[str | float]]:
    decoded = json.loads(payload)
    return decoded if isinstance(decoded, list) else []


def open_runtime_store() -> sqlite3.Connection:
    ensure_runtime_store()
    connection = sqlite3.connect(CACHE_DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_runtime_store(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS series_cache (
            symbol TEXT PRIMARY KEY,
            cache_key TEXT NOT NULL,
            generated_at TEXT NOT NULL,
            source_series_type TEXT NOT NULL,
            range_start_date TEXT NOT NULL,
            range_end_date TEXT NOT NULL,
            observations INTEGER NOT NULL,
            points_json TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_series_cache_cache_key
            ON series_cache (cache_key);

        CREATE TABLE IF NOT EXISTS remembered_datasets (
            dataset_id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            symbol TEXT NOT NULL,
            provider_name TEXT NOT NULL,
            family TEXT NOT NULL,
            target_series_type TEXT NOT NULL,
            source_series_type TEXT NOT NULL,
            source_url TEXT NOT NULL,
            note TEXT,
            generated_at TEXT NOT NULL,
            range_start_date TEXT NOT NULL,
            range_end_date TEXT NOT NULL,
            observations INTEGER NOT NULL,
            cache_key TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_remembered_symbol
            ON remembered_datasets (symbol);
        """
    )
    connection.commit()


def row_to_cached_snapshot(row: sqlite3.Row) -> dict:
    return {
        "provider": "yfinance",
        "datasetType": "index",
        "cacheKey": row["cache_key"],
        "symbol": row["symbol"],
        "generatedAt": row["generated_at"],
        "sourceSeriesType": row["source_series_type"],
        "range": {
            "startDate": row["range_start_date"],
            "endDate": row["range_end_date"],
            "observations": row["observations"],
        },
        "points": points_from_json(row["points_json"]),
        "path": build_runtime_cache_path(row["cache_key"]),
    }


def row_to_remembered_entry(row: sqlite3.Row) -> dict:
    return {
        "datasetId": row["dataset_id"],
        "label": row["label"],
        "symbol": row["symbol"],
        "providerName": row["provider_name"],
        "family": row["family"],
        "targetSeriesType": row["target_series_type"],
        "sourceSeriesType": row["source_series_type"],
        "sourceUrl": row["source_url"],
        "note": row["note"],
        "generatedAt": row["generated_at"],
        "range": {
            "startDate": row["range_start_date"],
            "endDate": row["range_end_date"],
            "observations": row["observations"],
        },
        "path": build_runtime_cache_path(row["cache_key"]),
    }


def upsert_cached_snapshot(connection: sqlite3.Connection, snapshot: dict) -> None:
    range_data = snapshot.get("range") or build_range(snapshot["points"])
    connection.execute(
        """
        INSERT INTO series_cache (
            symbol,
            cache_key,
            generated_at,
            source_series_type,
            range_start_date,
            range_end_date,
            observations,
            points_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET
            cache_key = excluded.cache_key,
            generated_at = excluded.generated_at,
            source_series_type = excluded.source_series_type,
            range_start_date = excluded.range_start_date,
            range_end_date = excluded.range_end_date,
            observations = excluded.observations,
            points_json = excluded.points_json
        """,
        (
            normalize_symbol(snapshot.get("symbol")),
            snapshot.get("cacheKey") or symbol_cache_key(snapshot["symbol"]),
            snapshot.get("generatedAt") or to_iso(now_utc()),
            snapshot.get("sourceSeriesType") or "Price",
            range_data["startDate"],
            range_data["endDate"],
            int(range_data["observations"]),
            points_to_json(snapshot["points"]),
        ),
    )


def upsert_remembered_dataset(connection: sqlite3.Connection, entry: dict) -> None:
    range_data = entry.get("range") or {
        "startDate": "",
        "endDate": "",
        "observations": 0,
    }
    symbol = normalize_symbol(entry.get("symbol"))
    cache_key = (
        entry.get("cacheKey")
        or extract_cache_key_from_path(entry.get("path"))
        or symbol_cache_key(symbol)
    )

    connection.execute(
        """
        INSERT INTO remembered_datasets (
            dataset_id,
            label,
            symbol,
            provider_name,
            family,
            target_series_type,
            source_series_type,
            source_url,
            note,
            generated_at,
            range_start_date,
            range_end_date,
            observations,
            cache_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(dataset_id) DO UPDATE SET
            label = excluded.label,
            symbol = excluded.symbol,
            provider_name = excluded.provider_name,
            family = excluded.family,
            target_series_type = excluded.target_series_type,
            source_series_type = excluded.source_series_type,
            source_url = excluded.source_url,
            note = excluded.note,
            generated_at = excluded.generated_at,
            range_start_date = excluded.range_start_date,
            range_end_date = excluded.range_end_date,
            observations = excluded.observations,
            cache_key = excluded.cache_key
        """,
        (
            str(entry.get("datasetId") or cache_key).strip(),
            str(entry.get("label") or symbol).strip() or symbol,
            symbol,
            str(entry.get("providerName") or "Yahoo Finance").strip() or "Yahoo Finance",
            str(entry.get("family") or "Remembered").strip() or "Remembered",
            str(entry.get("targetSeriesType") or "Price").strip() or "Price",
            str(entry.get("sourceSeriesType") or "Price").strip() or "Price",
            str(entry.get("sourceUrl") or build_symbol_source_url(symbol)).strip(),
            str(entry.get("note")).strip() if entry.get("note") else None,
            str(entry.get("generatedAt") or to_iso(now_utc())).strip(),
            str(range_data.get("startDate") or ""),
            str(range_data.get("endDate") or ""),
            int(range_data.get("observations") or 0),
            cache_key,
        ),
    )


def should_import_cached_snapshot(
    connection: sqlite3.Connection,
    symbol: str,
    generated_at: str | None,
) -> bool:
    existing = connection.execute(
        "SELECT generated_at FROM series_cache WHERE symbol = ?",
        (normalize_symbol(symbol),),
    ).fetchone()
    if existing is None:
        return True

    incoming_dt = parse_iso_datetime(generated_at)
    existing_dt = parse_iso_datetime(existing[0])
    if incoming_dt is None:
        return False
    if existing_dt is None:
        return True
    return incoming_dt >= existing_dt


def should_import_remembered_dataset(
    connection: sqlite3.Connection,
    dataset_id: str | None,
    generated_at: str | None,
) -> bool:
    normalized_dataset_id = normalize_dataset_id(dataset_id)
    if not normalized_dataset_id:
        return False

    existing = connection.execute(
        "SELECT generated_at FROM remembered_datasets WHERE lower(dataset_id) = ?",
        (normalized_dataset_id,),
    ).fetchone()
    if existing is None:
        return True

    incoming_dt = parse_iso_datetime(generated_at)
    existing_dt = parse_iso_datetime(existing[0])
    if incoming_dt is None:
        return False
    if existing_dt is None:
        return True
    return incoming_dt >= existing_dt


def migrate_legacy_local_cache(connection: sqlite3.Connection) -> None:
    if CACHE_ROOT.exists():
        for snapshot_path in sorted(CACHE_ROOT.glob("*.json")):
            if snapshot_path == LEGACY_MANIFEST_PATH:
                continue

            try:
                snapshot = load_json(snapshot_path, None)
            except json.JSONDecodeError:
                continue

            if not isinstance(snapshot, dict):
                continue

            symbol = normalize_symbol(snapshot.get("symbol"))
            points = snapshot.get("points")
            if not symbol or not isinstance(points, list) or len(points) < 2:
                continue
            generated_at = snapshot.get("generatedAt") or to_iso(now_utc())
            if not should_import_cached_snapshot(connection, symbol, generated_at):
                continue

            upsert_cached_snapshot(
                connection,
                {
                    "cacheKey": snapshot.get("cacheKey") or snapshot_path.stem or symbol_cache_key(symbol),
                    "symbol": symbol,
                    "generatedAt": generated_at,
                    "sourceSeriesType": snapshot.get("sourceSeriesType") or "Price",
                    "range": snapshot.get("range") or build_range(points),
                    "points": points,
                },
            )

    try:
        manifest = load_json(
            LEGACY_MANIFEST_PATH,
            {"provider": "yfinance", "datasetType": "index", "datasets": []},
        )
    except json.JSONDecodeError:
        manifest = {"datasets": []}

    datasets = manifest.get("datasets")
    if not isinstance(datasets, list):
        connection.commit()
        return

    for entry in datasets:
        if not isinstance(entry, dict):
            continue
        if not normalize_symbol(entry.get("symbol")):
            continue
        if not should_import_remembered_dataset(
            connection,
            entry.get("datasetId"),
            entry.get("generatedAt"),
        ):
            continue
        upsert_remembered_dataset(connection, entry)

    connection.commit()


def ensure_runtime_store() -> None:
    global _RUNTIME_STORE_READY

    if _RUNTIME_STORE_READY and CACHE_DB_PATH.exists():
        return

    with _RUNTIME_STORE_LOCK:
        if _RUNTIME_STORE_READY and CACHE_DB_PATH.exists():
            return

        CACHE_ROOT.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(CACHE_DB_PATH) as connection:
            initialize_runtime_store(connection)
            migrate_legacy_local_cache(connection)

        _RUNTIME_STORE_READY = True


def load_cached_series(symbol: str) -> dict | None:
    normalized_symbol = normalize_symbol(symbol)
    with open_runtime_store() as connection:
        row = connection.execute(
            """
            SELECT
                symbol,
                cache_key,
                generated_at,
                source_series_type,
                range_start_date,
                range_end_date,
                observations,
                points_json
            FROM series_cache
            WHERE symbol = ?
            """,
            (normalized_symbol,),
        ).fetchone()

    if row is None:
        return None

    try:
        return row_to_cached_snapshot(row)
    except json.JSONDecodeError:
        return None


def write_cached_series(symbol: str, points: list[list[str | float]]) -> dict:
    normalized_symbol = normalize_symbol(symbol)
    snapshot = {
        "provider": "yfinance",
        "datasetType": "index",
        "cacheKey": symbol_cache_key(normalized_symbol),
        "symbol": normalized_symbol,
        "generatedAt": to_iso(now_utc()),
        "sourceSeriesType": "Price",
        "range": build_range(points),
        "points": points,
        "path": build_runtime_cache_path(symbol_cache_key(normalized_symbol)),
    }

    with open_runtime_store() as connection:
        upsert_cached_snapshot(connection, snapshot)
        connection.commit()

    return snapshot


def find_remembered_entry(dataset_id: str | None, symbol: str | None) -> dict | None:
    normalized_dataset_id = normalize_dataset_id(dataset_id)
    normalized_symbol = normalize_symbol(symbol)

    with open_runtime_store() as connection:
        if normalized_dataset_id:
            row = connection.execute(
                """
                SELECT
                    dataset_id,
                    label,
                    symbol,
                    provider_name,
                    family,
                    target_series_type,
                    source_series_type,
                    source_url,
                    note,
                    generated_at,
                    range_start_date,
                    range_end_date,
                    observations,
                    cache_key
                FROM remembered_datasets
                WHERE lower(dataset_id) = ?
                LIMIT 1
                """,
                (normalized_dataset_id,),
            ).fetchone()
            if row is not None:
                return row_to_remembered_entry(row)

        if normalized_symbol:
            row = connection.execute(
                """
                SELECT
                    dataset_id,
                    label,
                    symbol,
                    provider_name,
                    family,
                    target_series_type,
                    source_series_type,
                    source_url,
                    note,
                    generated_at,
                    range_start_date,
                    range_end_date,
                    observations,
                    cache_key
                FROM remembered_datasets
                WHERE symbol = ?
                ORDER BY generated_at DESC, dataset_id ASC
                LIMIT 1
                """,
                (normalized_symbol,),
            ).fetchone()
            if row is not None:
                return row_to_remembered_entry(row)

    return None


def remember_symbol(snapshot: dict) -> dict:
    entry = {
        "datasetId": snapshot["datasetId"],
        "label": snapshot["label"],
        "symbol": snapshot["symbol"],
        "providerName": snapshot["providerName"],
        "family": snapshot["family"],
        "targetSeriesType": snapshot["targetSeriesType"],
        "sourceSeriesType": snapshot["sourceSeriesType"],
        "sourceUrl": snapshot["sourceUrl"],
        "note": snapshot["note"],
        "generatedAt": snapshot["generatedAt"],
        "range": snapshot["range"],
        "cacheKey": snapshot.get("cache", {}).get("key"),
        "path": snapshot.get("cache", {}).get("path"),
    }

    with open_runtime_store() as connection:
        upsert_remembered_dataset(connection, entry)
        connection.commit()

    return find_remembered_entry(entry["datasetId"], entry["symbol"]) or entry


def load_remembered_catalog() -> list[dict]:
    with open_runtime_store() as connection:
        rows = connection.execute(
            """
            SELECT
                dataset_id,
                label,
                symbol,
                provider_name,
                family,
                target_series_type,
                source_series_type,
                source_url,
                note,
                generated_at,
                range_start_date,
                range_end_date,
                observations,
                cache_key
            FROM remembered_datasets
            ORDER BY lower(label), symbol, dataset_id
            """
        ).fetchall()

    return [row_to_remembered_entry(row) for row in rows]
