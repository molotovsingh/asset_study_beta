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
            currency TEXT,
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
            currency TEXT,
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

        CREATE TABLE IF NOT EXISTS instrument_profiles (
            symbol TEXT PRIMARY KEY,
            fetched_at TEXT NOT NULL,
            quote_type TEXT,
            short_name TEXT,
            long_name TEXT,
            sector TEXT,
            industry TEXT,
            country TEXT,
            exchange TEXT,
            exchange_name TEXT,
            currency TEXT,
            market_cap REAL,
            beta REAL,
            trailing_pe REAL,
            forward_pe REAL,
            price_to_book REAL,
            dividend_yield REAL,
            full_time_employees INTEGER,
            website TEXT,
            raw_info_json TEXT NOT NULL
        );
        """
    )
    existing_series_columns = {
        row[1] for row in connection.execute("PRAGMA table_info(series_cache)")
    }
    if "currency" not in existing_series_columns:
        connection.execute("ALTER TABLE series_cache ADD COLUMN currency TEXT")

    existing_remembered_columns = {
        row[1] for row in connection.execute("PRAGMA table_info(remembered_datasets)")
    }
    if "currency" not in existing_remembered_columns:
        connection.execute("ALTER TABLE remembered_datasets ADD COLUMN currency TEXT")

    connection.commit()


def row_to_cached_snapshot(row: sqlite3.Row) -> dict:
    return {
        "provider": "yfinance",
        "datasetType": "index",
        "cacheKey": row["cache_key"],
        "symbol": row["symbol"],
        "currency": row["currency"],
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
        "currency": row["currency"],
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


def row_to_profile(row: sqlite3.Row) -> dict:
    raw_info = _raw_info_from_row(row)
    return {
        "symbol": row["symbol"],
        "fetchedAt": row["fetched_at"],
        "quoteType": row["quote_type"],
        "shortName": row["short_name"],
        "longName": row["long_name"],
        "sector": row["sector"],
        "industry": row["industry"],
        "country": row["country"],
        "exchange": row["exchange"],
        "exchangeName": row["exchange_name"],
        "currency": row["currency"],
        "marketCap": row["market_cap"],
        "beta": row["beta"],
        "trailingPE": row["trailing_pe"],
        "forwardPE": row["forward_pe"],
        "priceToBook": row["price_to_book"],
        "dividendYield": (
            _clean_dividend_yield(raw_info)
            if raw_info
            else _normalize_yield_ratio(row["dividend_yield"])
        ),
        "fullTimeEmployees": row["full_time_employees"],
        "website": row["website"],
        "sourceUrl": build_symbol_source_url(row["symbol"]),
    }


def _clean_text(value) -> str | None:
    text = str(value or "").strip()
    return text or None


def _clean_number(value) -> float | None:
    if value is None:
        return None

    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        return None

    if numeric_value != numeric_value:
        return None

    return numeric_value


def _clean_int(value) -> int | None:
    numeric_value = _clean_number(value)
    if numeric_value is None:
        return None

    return int(numeric_value)


def _normalize_yield_ratio(value) -> float | None:
    numeric_value = _clean_number(value)
    if numeric_value is None or numeric_value < 0:
        return None

    # Yahoo's info payload can expose dividendYield as percent units
    # (for example 0.4 for a 0.40% yield). The UI expects a ratio.
    if numeric_value > 0.2:
        return numeric_value / 100

    return numeric_value


def _raw_info_from_row(row: sqlite3.Row) -> dict:
    try:
        payload = row["raw_info_json"]
    except (IndexError, KeyError):
        return {}

    try:
        raw_info = json.loads(payload or "{}")
    except (TypeError, json.JSONDecodeError):
        return {}

    return raw_info if isinstance(raw_info, dict) else {}


def _clean_dividend_yield(raw_info: dict) -> float | None:
    trailing_yield = _normalize_yield_ratio(
        raw_info.get("trailingAnnualDividendYield"),
    )
    if trailing_yield is not None:
        return trailing_yield

    dividend_rate = _clean_number(
        raw_info.get("dividendRate")
        or raw_info.get("trailingAnnualDividendRate"),
    )
    current_price = _clean_number(
        raw_info.get("currentPrice")
        or raw_info.get("regularMarketPrice")
        or raw_info.get("previousClose"),
    )
    if dividend_rate is not None and current_price and current_price > 0:
        computed_yield = dividend_rate / current_price
        if 0 <= computed_yield <= 1:
            return computed_yield

    return _normalize_yield_ratio(raw_info.get("dividendYield"))


def normalize_profile(symbol: str, info: dict | None) -> dict:
    raw_info = info if isinstance(info, dict) else {}
    normalized_symbol = normalize_symbol(symbol)

    return {
        "symbol": normalized_symbol,
        "fetchedAt": to_iso(now_utc()),
        "quoteType": _clean_text(raw_info.get("quoteType")),
        "shortName": _clean_text(raw_info.get("shortName")),
        "longName": _clean_text(raw_info.get("longName")),
        "sector": _clean_text(raw_info.get("sector")),
        "industry": _clean_text(raw_info.get("industry")),
        "country": _clean_text(raw_info.get("country")),
        "exchange": _clean_text(raw_info.get("exchange")),
        "exchangeName": _clean_text(raw_info.get("fullExchangeName")),
        "currency": _clean_text(raw_info.get("currency")),
        "marketCap": _clean_number(raw_info.get("marketCap")),
        "beta": _clean_number(raw_info.get("beta")),
        "trailingPE": _clean_number(raw_info.get("trailingPE")),
        "forwardPE": _clean_number(raw_info.get("forwardPE")),
        "priceToBook": _clean_number(raw_info.get("priceToBook")),
        "dividendYield": _clean_dividend_yield(raw_info),
        "fullTimeEmployees": _clean_int(raw_info.get("fullTimeEmployees")),
        "website": _clean_text(raw_info.get("website")),
        "sourceUrl": build_symbol_source_url(normalized_symbol),
        "rawInfo": raw_info,
    }


def upsert_cached_snapshot(connection: sqlite3.Connection, snapshot: dict) -> None:
    range_data = snapshot.get("range") or build_range(snapshot["points"])
    connection.execute(
        """
        INSERT INTO series_cache (
            symbol,
            cache_key,
            generated_at,
            currency,
            source_series_type,
            range_start_date,
            range_end_date,
            observations,
            points_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET
            cache_key = excluded.cache_key,
            generated_at = excluded.generated_at,
            currency = excluded.currency,
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
            str(snapshot.get("currency") or "").strip().upper() or None,
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
            currency,
            target_series_type,
            source_series_type,
            source_url,
            note,
            generated_at,
            range_start_date,
            range_end_date,
            observations,
            cache_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(dataset_id) DO UPDATE SET
            label = excluded.label,
            symbol = excluded.symbol,
            provider_name = excluded.provider_name,
            family = excluded.family,
            currency = excluded.currency,
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
            str(entry.get("currency") or "").strip().upper() or None,
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


def upsert_instrument_profile(connection: sqlite3.Connection, profile: dict) -> None:
    connection.execute(
        """
        INSERT INTO instrument_profiles (
            symbol,
            fetched_at,
            quote_type,
            short_name,
            long_name,
            sector,
            industry,
            country,
            exchange,
            exchange_name,
            currency,
            market_cap,
            beta,
            trailing_pe,
            forward_pe,
            price_to_book,
            dividend_yield,
            full_time_employees,
            website,
            raw_info_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET
            fetched_at = excluded.fetched_at,
            quote_type = excluded.quote_type,
            short_name = excluded.short_name,
            long_name = excluded.long_name,
            sector = excluded.sector,
            industry = excluded.industry,
            country = excluded.country,
            exchange = excluded.exchange,
            exchange_name = excluded.exchange_name,
            currency = excluded.currency,
            market_cap = excluded.market_cap,
            beta = excluded.beta,
            trailing_pe = excluded.trailing_pe,
            forward_pe = excluded.forward_pe,
            price_to_book = excluded.price_to_book,
            dividend_yield = excluded.dividend_yield,
            full_time_employees = excluded.full_time_employees,
            website = excluded.website,
            raw_info_json = excluded.raw_info_json
        """,
        (
            normalize_symbol(profile.get("symbol")),
            profile.get("fetchedAt") or to_iso(now_utc()),
            profile.get("quoteType"),
            profile.get("shortName"),
            profile.get("longName"),
            profile.get("sector"),
            profile.get("industry"),
            profile.get("country"),
            profile.get("exchange"),
            profile.get("exchangeName"),
            str(profile.get("currency") or "").strip().upper() or None,
            profile.get("marketCap"),
            profile.get("beta"),
            profile.get("trailingPE"),
            profile.get("forwardPE"),
            profile.get("priceToBook"),
            profile.get("dividendYield"),
            profile.get("fullTimeEmployees"),
            profile.get("website"),
            json.dumps(
                profile.get("rawInfo") or {},
                separators=(",", ":"),
                default=str,
            ),
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
                    "currency": snapshot.get("currency"),
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
                currency,
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


def write_cached_series(
    symbol: str,
    points: list[list[str | float]],
    currency: str | None = None,
) -> dict:
    normalized_symbol = normalize_symbol(symbol)
    snapshot = {
        "provider": "yfinance",
        "datasetType": "index",
        "cacheKey": symbol_cache_key(normalized_symbol),
        "symbol": normalized_symbol,
        "generatedAt": to_iso(now_utc()),
        "currency": str(currency or "").strip().upper() or None,
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
                    currency,
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
                    currency,
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
        "currency": snapshot.get("currency"),
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
                currency,
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


def load_instrument_profile(symbol: str) -> dict | None:
    normalized_symbol = normalize_symbol(symbol)
    if not normalized_symbol:
        return None

    with open_runtime_store() as connection:
        row = connection.execute(
            """
            SELECT
                symbol,
                fetched_at,
                quote_type,
                short_name,
                long_name,
                sector,
                industry,
                country,
                exchange,
                exchange_name,
                currency,
                market_cap,
                beta,
                trailing_pe,
                forward_pe,
                price_to_book,
                dividend_yield,
                full_time_employees,
                website,
                raw_info_json
            FROM instrument_profiles
            WHERE symbol = ?
            """,
            (normalized_symbol,),
        ).fetchone()

    if row is None:
        return None

    return row_to_profile(row)


def write_instrument_profile(symbol: str, info: dict | None) -> dict:
    profile = normalize_profile(symbol, info)

    with open_runtime_store() as connection:
        upsert_instrument_profile(connection, profile)
        connection.commit()

    return load_instrument_profile(profile["symbol"]) or profile
