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

        CREATE TABLE IF NOT EXISTS symbols (
            symbol_id INTEGER PRIMARY KEY,
            symbol TEXT NOT NULL UNIQUE,
            provider TEXT NOT NULL DEFAULT 'yfinance',
            currency TEXT,
            source_series_type TEXT NOT NULL DEFAULT 'Price',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS daily_prices (
            symbol_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            open_value REAL,
            high_value REAL,
            low_value REAL,
            close_value REAL NOT NULL,
            adj_close_value REAL,
            volume REAL,
            source TEXT NOT NULL DEFAULT 'yfinance',
            updated_at TEXT NOT NULL,
            PRIMARY KEY (symbol_id, date),
            FOREIGN KEY (symbol_id) REFERENCES symbols(symbol_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_daily_prices_symbol_date
            ON daily_prices (symbol_id, date);

        CREATE TABLE IF NOT EXISTS corporate_actions (
            symbol_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            action_type TEXT NOT NULL,
            value REAL NOT NULL,
            source TEXT NOT NULL DEFAULT 'yfinance',
            updated_at TEXT NOT NULL,
            PRIMARY KEY (symbol_id, date, action_type),
            FOREIGN KEY (symbol_id) REFERENCES symbols(symbol_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_corporate_actions_symbol_date
            ON corporate_actions (symbol_id, date);

        CREATE TABLE IF NOT EXISTS sync_state (
            symbol_id INTEGER PRIMARY KEY,
            price_basis TEXT NOT NULL DEFAULT 'close',
            first_full_sync_at TEXT,
            last_full_sync_at TEXT,
            last_incremental_sync_at TEXT,
            last_checked_at TEXT,
            last_price_date TEXT,
            history_start_date TEXT,
            history_end_date TEXT,
            observations INTEGER NOT NULL DEFAULT 0,
            overlap_hash TEXT,
            actions_hash TEXT,
            last_sync_mode TEXT,
            last_sync_status TEXT,
            last_sync_message TEXT,
            FOREIGN KEY (symbol_id) REFERENCES symbols(symbol_id) ON DELETE CASCADE
        );

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
            provider_name TEXT NOT NULL DEFAULT 'Yahoo Finance (yfinance)',
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

        CREATE TABLE IF NOT EXISTS option_monthly_snapshots (
            symbol_id INTEGER NOT NULL,
            provider TEXT NOT NULL DEFAULT 'yfinance',
            as_of_date TEXT NOT NULL,
            fetched_at TEXT NOT NULL,
            expiry TEXT NOT NULL,
            currency TEXT,
            spot_date TEXT,
            spot_price REAL,
            minimum_dte INTEGER NOT NULL DEFAULT 25,
            max_contracts INTEGER NOT NULL DEFAULT 4,
            days_to_expiry INTEGER NOT NULL,
            strike REAL,
            call_bid REAL,
            call_ask REAL,
            call_last_price REAL,
            call_mid_price REAL,
            call_price_source TEXT,
            call_open_interest INTEGER,
            call_volume INTEGER,
            call_implied_volatility REAL,
            put_bid REAL,
            put_ask REAL,
            put_last_price REAL,
            put_mid_price REAL,
            put_price_source TEXT,
            put_open_interest INTEGER,
            put_volume INTEGER,
            put_implied_volatility REAL,
            straddle_mid_price REAL,
            implied_move_price REAL,
            implied_move_percent REAL,
            straddle_implied_volatility REAL,
            chain_implied_volatility REAL,
            implied_volatility_gap REAL,
            historical_volatility_20 REAL,
            historical_volatility_60 REAL,
            historical_volatility_120 REAL,
            iv_hv20_ratio REAL,
            iv_hv60_ratio REAL,
            iv_hv120_ratio REAL,
            iv_hv20_spread REAL,
            iv_hv60_spread REAL,
            iv_hv120_spread REAL,
            combined_open_interest INTEGER,
            combined_volume INTEGER,
            pricing_mode TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (symbol_id, provider, as_of_date, expiry),
            FOREIGN KEY (symbol_id) REFERENCES symbols(symbol_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_option_monthly_snapshots_symbol_date
            ON option_monthly_snapshots (symbol_id, as_of_date, expiry);

        CREATE TABLE IF NOT EXISTS derived_daily_metrics (
            symbol_id INTEGER NOT NULL,
            provider TEXT NOT NULL DEFAULT 'yfinance',
            metric_date TEXT NOT NULL,
            metric_family TEXT NOT NULL,
            metric_key TEXT NOT NULL,
            window_days INTEGER NOT NULL DEFAULT 0,
            metric_value REAL,
            source TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (
                symbol_id,
                provider,
                metric_date,
                metric_family,
                metric_key,
                window_days
            ),
            FOREIGN KEY (symbol_id) REFERENCES symbols(symbol_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_derived_daily_metrics_symbol_date
            ON derived_daily_metrics (symbol_id, metric_date);
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

    existing_profile_columns = {
        row[1] for row in connection.execute("PRAGMA table_info(instrument_profiles)")
    }
    if "provider_name" not in existing_profile_columns:
        connection.execute(
            "ALTER TABLE instrument_profiles ADD COLUMN provider_name TEXT NOT NULL DEFAULT 'Yahoo Finance (yfinance)'",
        )

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
        "providerName": row["provider_name"],
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


def normalize_profile(
    symbol: str,
    info: dict | None,
    *,
    provider_name: str | None = None,
) -> dict:
    raw_info = info if isinstance(info, dict) else {}
    normalized_symbol = normalize_symbol(symbol)

    return {
        "symbol": normalized_symbol,
        "fetchedAt": to_iso(now_utc()),
        "providerName": str(provider_name or "Yahoo Finance (yfinance)").strip()
        or "Yahoo Finance (yfinance)",
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


def _normalize_price_row(raw: dict) -> dict | None:
    date_value = str(raw.get("date") or "").strip()[:10]
    close_value = _clean_number(raw.get("close"))
    if not date_value or close_value is None:
        return None

    return {
        "date": date_value,
        "open": _clean_number(raw.get("open")),
        "high": _clean_number(raw.get("high")),
        "low": _clean_number(raw.get("low")),
        "close": close_value,
        "adjClose": _clean_number(raw.get("adjClose")),
        "volume": _clean_number(raw.get("volume")),
    }


def _normalize_price_rows(price_rows: list[dict]) -> list[dict]:
    by_date: dict[str, dict] = {}
    for raw_row in price_rows:
        if not isinstance(raw_row, dict):
            continue

        row = _normalize_price_row(raw_row)
        if row is not None:
            by_date[row["date"]] = row

    return [by_date[date_value] for date_value in sorted(by_date)]


def _normalize_action_row(raw: dict) -> dict | None:
    date_value = str(raw.get("date") or "").strip()[:10]
    action_type = str(raw.get("actionType") or raw.get("action_type") or "").strip().lower()
    value = _clean_number(raw.get("value"))
    if not date_value or action_type not in {"dividend", "split"} or value is None:
        return None
    if value == 0:
        return None

    return {
        "date": date_value,
        "actionType": action_type,
        "value": value,
    }


def _normalize_action_rows(action_rows: list[dict]) -> list[dict]:
    by_key: dict[tuple[str, str], dict] = {}
    for raw_row in action_rows:
        if not isinstance(raw_row, dict):
            continue

        row = _normalize_action_row(raw_row)
        if row is not None:
            by_key[(row["date"], row["actionType"])] = row

    return [
        by_key[key]
        for key in sorted(by_key)
    ]


def _ensure_symbol_row(
    connection: sqlite3.Connection,
    symbol: str,
    currency: str | None = None,
    source_series_type: str | None = None,
    provider: str | None = None,
    timestamp: str | None = None,
) -> int:
    normalized_symbol = normalize_symbol(symbol)
    if not normalized_symbol:
        raise RuntimeError("symbol is required to cache price history.")

    updated_at = timestamp or to_iso(now_utc())
    normalized_currency = str(currency or "").strip().upper() or None
    normalized_source_type = str(source_series_type or "Price").strip() or "Price"
    normalized_provider = str(provider or "yfinance").strip().lower() or "yfinance"

    connection.execute(
        """
        INSERT INTO symbols (
            symbol,
            provider,
            currency,
            source_series_type,
            created_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET
            provider = excluded.provider,
            currency = COALESCE(excluded.currency, symbols.currency),
            source_series_type = COALESCE(excluded.source_series_type, symbols.source_series_type),
            updated_at = excluded.updated_at
        """,
        (
            normalized_symbol,
            normalized_provider,
            normalized_currency,
            normalized_source_type,
            updated_at,
            updated_at,
        ),
    )
    row = connection.execute(
        "SELECT symbol_id FROM symbols WHERE symbol = ?",
        (normalized_symbol,),
    ).fetchone()
    if row is None:
        raise RuntimeError(f"Could not create local cache row for {normalized_symbol}.")

    return int(row["symbol_id"])


def _price_points_from_rows(rows: list[sqlite3.Row]) -> list[list[str | float]]:
    return [
        [row["date"], round(float(row["close_value"]), 6)]
        for row in rows
        if row["close_value"] is not None
    ]


def _load_symbol_row(connection: sqlite3.Connection, symbol: str) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT
            symbol_id,
            symbol,
            provider,
            currency,
            source_series_type
        FROM symbols
        WHERE symbol = ?
        """,
        (normalize_symbol(symbol),),
    ).fetchone()


def _build_price_history_snapshot(
    connection: sqlite3.Connection,
    symbol: str,
    generated_at: str | None = None,
) -> dict | None:
    symbol_row = _load_symbol_row(connection, symbol)
    if symbol_row is None:
        return None

    price_rows = connection.execute(
        """
        SELECT
            date,
            close_value
        FROM daily_prices
        WHERE symbol_id = ?
        ORDER BY date
        """,
        (symbol_row["symbol_id"],),
    ).fetchall()
    points = _price_points_from_rows(price_rows)
    if len(points) < 2:
        return None

    sync_row = connection.execute(
        """
        SELECT
            price_basis,
            first_full_sync_at,
            last_full_sync_at,
            last_incremental_sync_at,
            last_checked_at,
            last_price_date,
            history_start_date,
            history_end_date,
            observations,
            overlap_hash,
            actions_hash,
            last_sync_mode,
            last_sync_status,
            last_sync_message
        FROM sync_state
        WHERE symbol_id = ?
        """,
        (symbol_row["symbol_id"],),
    ).fetchone()
    snapshot_generated_at = (
        generated_at
        or (sync_row["last_checked_at"] if sync_row is not None else None)
        or to_iso(now_utc())
    )
    cache_key = symbol_cache_key(symbol_row["symbol"])
    snapshot = {
        "provider": symbol_row["provider"] or "yfinance",
        "datasetType": "index",
        "cacheKey": cache_key,
        "symbol": symbol_row["symbol"],
        "currency": symbol_row["currency"],
        "generatedAt": snapshot_generated_at,
        "sourceSeriesType": symbol_row["source_series_type"] or "Price",
        "range": build_range(points),
        "points": points,
        "path": build_runtime_cache_path(cache_key),
    }
    if sync_row is not None:
        snapshot["syncState"] = {
            "priceBasis": sync_row["price_basis"],
            "firstFullSyncAt": sync_row["first_full_sync_at"],
            "lastFullSyncAt": sync_row["last_full_sync_at"],
            "lastIncrementalSyncAt": sync_row["last_incremental_sync_at"],
            "lastCheckedAt": sync_row["last_checked_at"],
            "lastPriceDate": sync_row["last_price_date"],
            "historyStartDate": sync_row["history_start_date"],
            "historyEndDate": sync_row["history_end_date"],
            "observations": sync_row["observations"],
            "overlapHash": sync_row["overlap_hash"],
            "actionsHash": sync_row["actions_hash"],
            "lastSyncMode": sync_row["last_sync_mode"],
            "lastSyncStatus": sync_row["last_sync_status"],
            "lastSyncMessage": sync_row["last_sync_message"],
        }

    return snapshot


def _write_price_history_to_connection(
    connection: sqlite3.Connection,
    symbol: str,
    price_rows: list[dict],
    action_rows: list[dict] | None = None,
    *,
    currency: str | None = None,
    source_series_type: str | None = None,
    provider: str | None = None,
    sync_mode: str = "full",
    sync_status: str = "ok",
    sync_message: str | None = None,
    replace: bool = False,
    action_window: tuple[str, str] | None = None,
    generated_at: str | None = None,
    overlap_hash: str | None = None,
    actions_hash: str | None = None,
) -> dict:
    normalized_symbol = normalize_symbol(symbol)
    normalized_price_rows = _normalize_price_rows(price_rows)
    normalized_action_rows = _normalize_action_rows(action_rows or [])
    if not normalized_price_rows:
        raise RuntimeError(f"No usable price rows were supplied for {normalized_symbol}.")

    timestamp = generated_at or to_iso(now_utc())
    symbol_id = _ensure_symbol_row(
        connection,
        normalized_symbol,
        currency=currency,
        source_series_type=source_series_type,
        provider=provider,
        timestamp=timestamp,
    )

    if replace:
        connection.execute("DELETE FROM corporate_actions WHERE symbol_id = ?", (symbol_id,))
        connection.execute("DELETE FROM daily_prices WHERE symbol_id = ?", (symbol_id,))
    elif action_window:
        connection.execute(
            """
            DELETE FROM corporate_actions
            WHERE symbol_id = ?
              AND date >= ?
              AND date <= ?
            """,
            (symbol_id, action_window[0], action_window[1]),
        )

    connection.executemany(
        """
        INSERT INTO daily_prices (
            symbol_id,
            date,
            open_value,
            high_value,
            low_value,
            close_value,
            adj_close_value,
            volume,
            source,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol_id, date) DO UPDATE SET
            open_value = excluded.open_value,
            high_value = excluded.high_value,
            low_value = excluded.low_value,
            close_value = excluded.close_value,
            adj_close_value = excluded.adj_close_value,
            volume = excluded.volume,
            source = excluded.source,
            updated_at = excluded.updated_at
        """,
        [
            (
                symbol_id,
                row["date"],
                row["open"],
                row["high"],
                row["low"],
                row["close"],
                row["adjClose"],
                row["volume"],
                str(provider or "yfinance").strip().lower() or "yfinance",
                timestamp,
            )
            for row in normalized_price_rows
        ],
    )

    if normalized_action_rows:
        connection.executemany(
            """
            INSERT INTO corporate_actions (
                symbol_id,
                date,
                action_type,
                value,
                source,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(symbol_id, date, action_type) DO UPDATE SET
                value = excluded.value,
                source = excluded.source,
                updated_at = excluded.updated_at
            """,
            [
                (
                    symbol_id,
                    row["date"],
                    row["actionType"],
                    row["value"],
                    str(provider or "yfinance").strip().lower() or "yfinance",
                    timestamp,
                )
                for row in normalized_action_rows
            ],
        )

    aggregate_row = connection.execute(
        """
        SELECT
            min(date) AS start_date,
            max(date) AS end_date,
            count(*) AS observations
        FROM daily_prices
        WHERE symbol_id = ?
        """,
        (symbol_id,),
    ).fetchone()
    if aggregate_row is None or not aggregate_row["observations"]:
        raise RuntimeError(f"No cached price history remained for {normalized_symbol}.")

    existing_sync = connection.execute(
        """
        SELECT
            first_full_sync_at,
            last_full_sync_at,
            last_incremental_sync_at
        FROM sync_state
        WHERE symbol_id = ?
        """,
        (symbol_id,),
    ).fetchone()
    is_full_sync = sync_mode == "full"
    first_full_sync_at = (
        timestamp
        if is_full_sync and (existing_sync is None or existing_sync["first_full_sync_at"] is None)
        else (existing_sync["first_full_sync_at"] if existing_sync is not None else None)
    )
    last_full_sync_at = (
        timestamp
        if is_full_sync
        else (existing_sync["last_full_sync_at"] if existing_sync is not None else None)
    )
    last_incremental_sync_at = (
        timestamp
        if sync_mode == "incremental"
        else (existing_sync["last_incremental_sync_at"] if existing_sync is not None else None)
    )

    connection.execute(
        """
        INSERT INTO sync_state (
            symbol_id,
            price_basis,
            first_full_sync_at,
            last_full_sync_at,
            last_incremental_sync_at,
            last_checked_at,
            last_price_date,
            history_start_date,
            history_end_date,
            observations,
            overlap_hash,
            actions_hash,
            last_sync_mode,
            last_sync_status,
            last_sync_message
        ) VALUES (?, 'close', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol_id) DO UPDATE SET
            first_full_sync_at = excluded.first_full_sync_at,
            last_full_sync_at = excluded.last_full_sync_at,
            last_incremental_sync_at = excluded.last_incremental_sync_at,
            last_checked_at = excluded.last_checked_at,
            last_price_date = excluded.last_price_date,
            history_start_date = excluded.history_start_date,
            history_end_date = excluded.history_end_date,
            observations = excluded.observations,
            overlap_hash = excluded.overlap_hash,
            actions_hash = excluded.actions_hash,
            last_sync_mode = excluded.last_sync_mode,
            last_sync_status = excluded.last_sync_status,
            last_sync_message = excluded.last_sync_message
        """,
        (
            symbol_id,
            first_full_sync_at,
            last_full_sync_at,
            last_incremental_sync_at,
            timestamp,
            aggregate_row["end_date"],
            aggregate_row["start_date"],
            aggregate_row["end_date"],
            int(aggregate_row["observations"]),
            overlap_hash,
            actions_hash,
            sync_mode,
            sync_status,
            sync_message,
        ),
    )

    snapshot = _build_price_history_snapshot(connection, normalized_symbol, timestamp)
    if snapshot is None:
        raise RuntimeError(f"Cached price history for {normalized_symbol} is incomplete.")

    upsert_cached_snapshot(connection, snapshot)
    return snapshot


def migrate_cached_series_to_price_history(connection: sqlite3.Connection) -> None:
    rows = connection.execute(
        """
        SELECT
            symbol,
            generated_at,
            currency,
            source_series_type,
            points_json
        FROM series_cache
        ORDER BY symbol
        """
    ).fetchall()

    for row in rows:
        symbol = normalize_symbol(row["symbol"])
        if not symbol:
            continue
        existing = _load_symbol_row(connection, symbol)
        if existing is not None:
            price_count = connection.execute(
                "SELECT count(*) FROM daily_prices WHERE symbol_id = ?",
                (existing["symbol_id"],),
            ).fetchone()[0]
            if price_count:
                continue

        try:
            points = points_from_json(row["points_json"])
        except json.JSONDecodeError:
            continue
        price_rows = [
            {
                "date": point[0],
                "close": point[1],
            }
            for point in points
            if isinstance(point, list) and len(point) >= 2
        ]
        if len(price_rows) < 2:
            continue

        _write_price_history_to_connection(
            connection,
            symbol,
            price_rows,
            [],
            currency=row["currency"],
            source_series_type=row["source_series_type"] or "Price",
            sync_mode="legacy",
            sync_status="migrated",
            sync_message="Migrated from the legacy JSON series cache.",
            generated_at=row["generated_at"] or to_iso(now_utc()),
        )


def load_price_rows(
    symbol: str,
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[dict]:
    normalized_symbol = normalize_symbol(symbol)
    with open_runtime_store() as connection:
        symbol_row = _load_symbol_row(connection, normalized_symbol)
        if symbol_row is None:
            return []

        clauses = ["symbol_id = ?"]
        params: list[str | int] = [int(symbol_row["symbol_id"])]
        if start_date:
            clauses.append("date >= ?")
            params.append(str(start_date))
        if end_date:
            clauses.append("date <= ?")
            params.append(str(end_date))

        rows = connection.execute(
            f"""
            SELECT
                date,
                open_value,
                high_value,
                low_value,
                close_value,
                adj_close_value,
                volume
            FROM daily_prices
            WHERE {' AND '.join(clauses)}
            ORDER BY date
            """,
            tuple(params),
        ).fetchall()

    return [
        {
            "date": row["date"],
            "open": row["open_value"],
            "high": row["high_value"],
            "low": row["low_value"],
            "close": row["close_value"],
            "adjClose": row["adj_close_value"],
            "volume": row["volume"],
        }
        for row in rows
    ]


def load_corporate_actions(
    symbol: str,
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[dict]:
    normalized_symbol = normalize_symbol(symbol)
    with open_runtime_store() as connection:
        symbol_row = _load_symbol_row(connection, normalized_symbol)
        if symbol_row is None:
            return []

        clauses = ["symbol_id = ?"]
        params: list[str | int] = [int(symbol_row["symbol_id"])]
        if start_date:
            clauses.append("date >= ?")
            params.append(str(start_date))
        if end_date:
            clauses.append("date <= ?")
            params.append(str(end_date))

        rows = connection.execute(
            f"""
            SELECT
                date,
                action_type,
                value
            FROM corporate_actions
            WHERE {' AND '.join(clauses)}
            ORDER BY date, action_type
            """,
            tuple(params),
        ).fetchall()

    return [
        {
            "date": row["date"],
            "actionType": row["action_type"],
            "value": row["value"],
        }
        for row in rows
    ]


def write_price_history(
    symbol: str,
    price_rows: list[dict],
    action_rows: list[dict] | None = None,
    *,
    currency: str | None = None,
    source_series_type: str | None = None,
    provider: str | None = None,
    sync_mode: str = "full",
    sync_status: str = "ok",
    sync_message: str | None = None,
    replace: bool = False,
    action_window: tuple[str, str] | None = None,
    overlap_hash: str | None = None,
    actions_hash: str | None = None,
) -> dict:
    with open_runtime_store() as connection:
        snapshot = _write_price_history_to_connection(
            connection,
            symbol,
            price_rows,
            action_rows,
            currency=currency,
            source_series_type=source_series_type,
            provider=provider,
            sync_mode=sync_mode,
            sync_status=sync_status,
            sync_message=sync_message,
            replace=replace,
            action_window=action_window,
            overlap_hash=overlap_hash,
            actions_hash=actions_hash,
        )
        connection.commit()

    return snapshot


def update_cached_series_currency(symbol: str, currency: str | None) -> dict | None:
    normalized_symbol = normalize_symbol(symbol)
    normalized_currency = str(currency or "").strip().upper() or None
    if not normalized_symbol or not normalized_currency:
        return load_cached_series(normalized_symbol)

    with open_runtime_store() as connection:
        connection.execute(
            """
            UPDATE symbols
            SET currency = ?, updated_at = ?
            WHERE symbol = ?
            """,
            (normalized_currency, to_iso(now_utc()), normalized_symbol),
        )
        connection.execute(
            """
            UPDATE series_cache
            SET currency = ?
            WHERE symbol = ?
            """,
            (normalized_currency, normalized_symbol),
        )
        connection.commit()

    return load_cached_series(normalized_symbol)


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
            provider_name,
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET
            fetched_at = excluded.fetched_at,
            provider_name = excluded.provider_name,
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
            str(profile.get("providerName") or "Yahoo Finance (yfinance)").strip()
            or "Yahoo Finance (yfinance)",
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
            connection.row_factory = sqlite3.Row
            initialize_runtime_store(connection)
            migrate_legacy_local_cache(connection)
            migrate_cached_series_to_price_history(connection)
            connection.commit()

        _RUNTIME_STORE_READY = True


def load_cached_series(symbol: str) -> dict | None:
    normalized_symbol = normalize_symbol(symbol)
    with open_runtime_store() as connection:
        normalized_snapshot = _build_price_history_snapshot(connection, normalized_symbol)
        if normalized_snapshot is not None:
            return normalized_snapshot

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
    price_rows = [
        {
            "date": point[0],
            "close": point[1],
        }
        for point in points
        if isinstance(point, list) and len(point) >= 2
    ]
    return write_price_history(
        normalized_symbol,
        price_rows,
        [],
        currency=currency,
        source_series_type="Price",
        sync_mode="manual",
        sync_status="ok",
        sync_message="Written through the compatibility cached-series API.",
        replace=True,
    )


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
                provider_name,
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


def write_instrument_profile(
    symbol: str,
    info: dict | None,
    *,
    provider_name: str | None = None,
) -> dict:
    profile = normalize_profile(symbol, info, provider_name=provider_name)

    with open_runtime_store() as connection:
        upsert_instrument_profile(connection, profile)
        connection.commit()

    return load_instrument_profile(profile["symbol"]) or profile


def load_option_monthly_snapshots(
    symbol: str,
    *,
    as_of_date: str | None = None,
    provider: str | None = None,
) -> list[dict]:
    normalized_symbol = normalize_symbol(symbol)
    if not normalized_symbol:
        return []

    with open_runtime_store() as connection:
        symbol_row = _load_symbol_row(connection, normalized_symbol)
        if symbol_row is None:
            return []

        clauses = ["symbol_id = ?"]
        params: list[str | int] = [int(symbol_row["symbol_id"])]
        if as_of_date:
            clauses.append("as_of_date = ?")
            params.append(str(as_of_date))
        if provider:
            clauses.append("provider = ?")
            params.append(str(provider).strip().lower())

        rows = connection.execute(
            f"""
            SELECT
                provider,
                as_of_date,
                fetched_at,
                expiry,
                currency,
                spot_date,
                spot_price,
                minimum_dte,
                max_contracts,
                days_to_expiry,
                strike,
                call_bid,
                call_ask,
                call_last_price,
                call_mid_price,
                call_price_source,
                call_open_interest,
                call_volume,
                call_implied_volatility,
                put_bid,
                put_ask,
                put_last_price,
                put_mid_price,
                put_price_source,
                put_open_interest,
                put_volume,
                put_implied_volatility,
                straddle_mid_price,
                implied_move_price,
                implied_move_percent,
                straddle_implied_volatility,
                chain_implied_volatility,
                implied_volatility_gap,
                historical_volatility_20,
                historical_volatility_60,
                historical_volatility_120,
                iv_hv20_ratio,
                iv_hv60_ratio,
                iv_hv120_ratio,
                iv_hv20_spread,
                iv_hv60_spread,
                iv_hv120_spread,
                combined_open_interest,
                combined_volume,
                pricing_mode
            FROM option_monthly_snapshots
            WHERE {' AND '.join(clauses)}
            ORDER BY as_of_date DESC, expiry ASC
            """,
            tuple(params),
        ).fetchall()

    return [
        {
            "provider": row["provider"],
            "asOfDate": row["as_of_date"],
            "fetchedAt": row["fetched_at"],
            "expiry": row["expiry"],
            "currency": row["currency"],
            "spotDate": row["spot_date"],
            "spotPrice": row["spot_price"],
            "minimumDte": row["minimum_dte"],
            "maxContracts": row["max_contracts"],
            "daysToExpiry": row["days_to_expiry"],
            "strike": row["strike"],
            "callBid": row["call_bid"],
            "callAsk": row["call_ask"],
            "callLastPrice": row["call_last_price"],
            "callMidPrice": row["call_mid_price"],
            "callPriceSource": row["call_price_source"],
            "callOpenInterest": row["call_open_interest"],
            "callVolume": row["call_volume"],
            "callImpliedVolatility": row["call_implied_volatility"],
            "putBid": row["put_bid"],
            "putAsk": row["put_ask"],
            "putLastPrice": row["put_last_price"],
            "putMidPrice": row["put_mid_price"],
            "putPriceSource": row["put_price_source"],
            "putOpenInterest": row["put_open_interest"],
            "putVolume": row["put_volume"],
            "putImpliedVolatility": row["put_implied_volatility"],
            "straddleMidPrice": row["straddle_mid_price"],
            "impliedMovePrice": row["implied_move_price"],
            "impliedMovePercent": row["implied_move_percent"],
            "straddleImpliedVolatility": row["straddle_implied_volatility"],
            "chainImpliedVolatility": row["chain_implied_volatility"],
            "impliedVolatilityGap": row["implied_volatility_gap"],
            "historicalVolatility20": row["historical_volatility_20"],
            "historicalVolatility60": row["historical_volatility_60"],
            "historicalVolatility120": row["historical_volatility_120"],
            "ivHv20Ratio": row["iv_hv20_ratio"],
            "ivHv60Ratio": row["iv_hv60_ratio"],
            "ivHv120Ratio": row["iv_hv120_ratio"],
            "ivHv20Spread": row["iv_hv20_spread"],
            "ivHv60Spread": row["iv_hv60_spread"],
            "ivHv120Spread": row["iv_hv120_spread"],
            "combinedOpenInterest": row["combined_open_interest"],
            "combinedVolume": row["combined_volume"],
            "pricingMode": row["pricing_mode"],
        }
        for row in rows
    ]


def load_option_front_history(
    symbol: str,
    *,
    provider: str | None = None,
    limit: int = 252,
) -> list[dict]:
    normalized_symbol = normalize_symbol(symbol)
    if not normalized_symbol:
        return []

    normalized_limit = max(1, int(limit or 252))
    with open_runtime_store() as connection:
        symbol_row = _load_symbol_row(connection, normalized_symbol)
        if symbol_row is None:
            return []

        clauses = ["symbol_id = ?"]
        params: list[str | int] = [int(symbol_row["symbol_id"])]
        if provider:
            clauses.append("provider = ?")
            params.append(str(provider).strip().lower())

        rows = connection.execute(
            f"""
            WITH ranked_rows AS (
                SELECT
                    provider,
                    as_of_date,
                    fetched_at,
                    expiry,
                    days_to_expiry,
                    strike,
                    spot_price,
                    implied_move_percent,
                    straddle_implied_volatility,
                    chain_implied_volatility,
                    implied_volatility_gap,
                    historical_volatility_20,
                    historical_volatility_60,
                    historical_volatility_120,
                    iv_hv20_ratio,
                    iv_hv60_ratio,
                    iv_hv120_ratio,
                    iv_hv20_spread,
                    iv_hv60_spread,
                    iv_hv120_spread,
                    combined_open_interest,
                    combined_volume,
                    ROW_NUMBER() OVER (
                        PARTITION BY symbol_id, provider, as_of_date
                        ORDER BY days_to_expiry ASC, expiry ASC
                    ) AS row_rank
                FROM option_monthly_snapshots
                WHERE {' AND '.join(clauses)}
            )
            SELECT
                provider,
                as_of_date,
                fetched_at,
                expiry,
                days_to_expiry,
                strike,
                spot_price,
                implied_move_percent,
                straddle_implied_volatility,
                chain_implied_volatility,
                implied_volatility_gap,
                historical_volatility_20,
                historical_volatility_60,
                historical_volatility_120,
                iv_hv20_ratio,
                iv_hv60_ratio,
                iv_hv120_ratio,
                iv_hv20_spread,
                iv_hv60_spread,
                iv_hv120_spread,
                combined_open_interest,
                combined_volume
            FROM ranked_rows
            WHERE row_rank = 1
            ORDER BY as_of_date DESC
            LIMIT ?
            """,
            tuple([*params, normalized_limit]),
        ).fetchall()

    return [
        {
            "provider": row["provider"],
            "asOfDate": row["as_of_date"],
            "fetchedAt": row["fetched_at"],
            "expiry": row["expiry"],
            "daysToExpiry": row["days_to_expiry"],
            "strike": row["strike"],
            "spotPrice": row["spot_price"],
            "impliedMovePercent": row["implied_move_percent"],
            "straddleImpliedVolatility": row["straddle_implied_volatility"],
            "chainImpliedVolatility": row["chain_implied_volatility"],
            "impliedVolatilityGap": row["implied_volatility_gap"],
            "historicalVolatility20": row["historical_volatility_20"],
            "historicalVolatility60": row["historical_volatility_60"],
            "historicalVolatility120": row["historical_volatility_120"],
            "ivHv20Ratio": row["iv_hv20_ratio"],
            "ivHv60Ratio": row["iv_hv60_ratio"],
            "ivHv120Ratio": row["iv_hv120_ratio"],
            "ivHv20Spread": row["iv_hv20_spread"],
            "ivHv60Spread": row["iv_hv60_spread"],
            "ivHv120Spread": row["iv_hv120_spread"],
            "combinedOpenInterest": row["combined_open_interest"],
            "combinedVolume": row["combined_volume"],
        }
        for row in reversed(rows)
    ]


def load_derived_daily_metrics(
    symbol: str,
    *,
    metric_date: str | None = None,
    provider: str | None = None,
    metric_family: str | None = None,
) -> list[dict]:
    normalized_symbol = normalize_symbol(symbol)
    if not normalized_symbol:
        return []

    with open_runtime_store() as connection:
        symbol_row = _load_symbol_row(connection, normalized_symbol)
        if symbol_row is None:
            return []

        clauses = ["symbol_id = ?"]
        params: list[str | int] = [int(symbol_row["symbol_id"])]
        if metric_date:
            clauses.append("metric_date = ?")
            params.append(str(metric_date))
        if provider:
            clauses.append("provider = ?")
            params.append(str(provider).strip().lower())
        if metric_family:
            clauses.append("metric_family = ?")
            params.append(str(metric_family).strip())

        rows = connection.execute(
            f"""
            SELECT
                provider,
                metric_date,
                metric_family,
                metric_key,
                window_days,
                metric_value,
                source,
                updated_at
            FROM derived_daily_metrics
            WHERE {' AND '.join(clauses)}
            ORDER BY metric_date DESC, metric_family ASC, window_days ASC, metric_key ASC
            """,
            tuple(params),
        ).fetchall()

    return [
        {
            "provider": row["provider"],
            "metricDate": row["metric_date"],
            "metricFamily": row["metric_family"],
            "metricKey": row["metric_key"],
            "windowDays": row["window_days"],
            "metricValue": row["metric_value"],
            "source": row["source"],
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]


def write_option_monthly_snapshot(symbol: str, snapshot: dict) -> list[dict]:
    normalized_symbol = normalize_symbol(symbol or snapshot.get("symbol"))
    if not normalized_symbol:
        raise RuntimeError("symbol is required to cache option snapshots.")

    as_of_date = str(snapshot.get("asOfDate") or "").strip()
    contracts = snapshot.get("monthlyContracts") or []
    if not as_of_date:
        raise RuntimeError("monthly straddle snapshot is missing an as-of date.")
    if not isinstance(contracts, list) or not contracts:
        raise RuntimeError("monthly straddle snapshot is missing contract rows.")

    provider = str(snapshot.get("provider") or "yfinance").strip().lower() or "yfinance"
    currency = str(snapshot.get("currency") or "").strip().upper() or None
    timestamp = str(snapshot.get("fetchedAt") or to_iso(now_utc())).strip()
    realized_volatility = snapshot.get("realizedVolatility") or {}

    with open_runtime_store() as connection:
        symbol_id = _ensure_symbol_row(
            connection,
            normalized_symbol,
            currency=currency,
            provider=provider,
            source_series_type="Price",
            timestamp=timestamp,
        )
        connection.execute(
            """
            DELETE FROM option_monthly_snapshots
            WHERE symbol_id = ?
              AND provider = ?
              AND as_of_date = ?
            """,
            (symbol_id, provider, as_of_date),
        )
        connection.executemany(
            """
            INSERT INTO option_monthly_snapshots (
                symbol_id,
                provider,
                as_of_date,
                fetched_at,
                expiry,
                currency,
                spot_date,
                spot_price,
                minimum_dte,
                max_contracts,
                days_to_expiry,
                strike,
                call_bid,
                call_ask,
                call_last_price,
                call_mid_price,
                call_price_source,
                call_open_interest,
                call_volume,
                call_implied_volatility,
                put_bid,
                put_ask,
                put_last_price,
                put_mid_price,
                put_price_source,
                put_open_interest,
                put_volume,
                put_implied_volatility,
                straddle_mid_price,
                implied_move_price,
                implied_move_percent,
                straddle_implied_volatility,
                chain_implied_volatility,
                implied_volatility_gap,
                historical_volatility_20,
                historical_volatility_60,
                historical_volatility_120,
                iv_hv20_ratio,
                iv_hv60_ratio,
                iv_hv120_ratio,
                iv_hv20_spread,
                iv_hv60_spread,
                iv_hv120_spread,
                combined_open_interest,
                combined_volume,
                pricing_mode,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    symbol_id,
                    provider,
                    as_of_date,
                    timestamp,
                    str(contract.get("expiry") or "").strip(),
                    currency,
                    snapshot.get("spotDate"),
                    snapshot.get("spotPrice"),
                    int(snapshot.get("minimumDte") or 25),
                    int(snapshot.get("maxContracts") or 4),
                    int(contract.get("daysToExpiry") or 0),
                    contract.get("strike"),
                    contract.get("callBid"),
                    contract.get("callAsk"),
                    contract.get("callLastPrice"),
                    contract.get("callMidPrice"),
                    contract.get("callPriceSource"),
                    int(contract.get("callOpenInterest") or 0),
                    int(contract.get("callVolume") or 0),
                    contract.get("callImpliedVolatility"),
                    contract.get("putBid"),
                    contract.get("putAsk"),
                    contract.get("putLastPrice"),
                    contract.get("putMidPrice"),
                    contract.get("putPriceSource"),
                    int(contract.get("putOpenInterest") or 0),
                    int(contract.get("putVolume") or 0),
                    contract.get("putImpliedVolatility"),
                    contract.get("straddleMidPrice"),
                    contract.get("impliedMovePrice"),
                    contract.get("impliedMovePercent"),
                    contract.get("straddleImpliedVolatility"),
                    contract.get("chainImpliedVolatility"),
                    contract.get("impliedVolatilityGap"),
                    contract.get("historicalVolatility20"),
                    contract.get("historicalVolatility60"),
                    contract.get("historicalVolatility120"),
                    contract.get("ivHv20Ratio"),
                    contract.get("ivHv60Ratio"),
                    contract.get("ivHv120Ratio"),
                    contract.get("ivHv20Spread"),
                    contract.get("ivHv60Spread"),
                    contract.get("ivHv120Spread"),
                    int(contract.get("combinedOpenInterest") or 0),
                    int(contract.get("combinedVolume") or 0),
                    str(contract.get("pricingMode") or "unknown"),
                    timestamp,
                )
                for contract in contracts
                if str(contract.get("expiry") or "").strip()
            ],
        )

        metrics = []
        for metric_key, window_days in (("hv20", 20), ("hv60", 60), ("hv120", 120)):
            metric_value = realized_volatility.get(metric_key)
            if metric_value is None:
                continue
            metrics.append(
                {
                    "metricFamily": "realized_volatility",
                    "metricKey": metric_key,
                    "windowDays": window_days,
                    "metricValue": metric_value,
                }
            )
        if metrics:
            connection.executemany(
                """
                INSERT INTO derived_daily_metrics (
                    symbol_id,
                    provider,
                    metric_date,
                    metric_family,
                    metric_key,
                    window_days,
                    metric_value,
                    source,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol_id, provider, metric_date, metric_family, metric_key, window_days)
                DO UPDATE SET
                    metric_value = excluded.metric_value,
                    source = excluded.source,
                    updated_at = excluded.updated_at
                """,
                [
                    (
                        symbol_id,
                        provider,
                        as_of_date,
                        metric["metricFamily"],
                        metric["metricKey"],
                        int(metric["windowDays"] or 0),
                        metric["metricValue"],
                        "monthly_straddle",
                        timestamp,
                    )
                    for metric in metrics
                ],
            )
        connection.commit()

    return load_option_monthly_snapshots(
        normalized_symbol,
        as_of_date=as_of_date,
        provider=provider,
    )
