from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from urllib.parse import quote

import runtime_store_metadata as metadata_store
import runtime_store_automation as automation_store
import runtime_store_options as options_store
import runtime_store_runs as runs_store
import runtime_store_study_builder as study_builder_store


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

        CREATE TABLE IF NOT EXISTS options_screener_runs (
            run_id INTEGER PRIMARY KEY AUTOINCREMENT,
            universe_id TEXT NOT NULL,
            universe_label TEXT NOT NULL,
            minimum_dte INTEGER NOT NULL,
            max_contracts INTEGER NOT NULL,
            signal_version TEXT NOT NULL DEFAULT 'legacy-v0',
            requested_symbols_json TEXT NOT NULL,
            failure_json TEXT NOT NULL DEFAULT '[]',
            row_count INTEGER NOT NULL DEFAULT 0,
            failure_count INTEGER NOT NULL DEFAULT 0,
            as_of_date TEXT,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_options_screener_runs_created_at
            ON options_screener_runs (created_at DESC);

        CREATE TABLE IF NOT EXISTS options_screener_rows (
            run_id INTEGER NOT NULL,
            symbol_id INTEGER NOT NULL,
            provider TEXT NOT NULL DEFAULT 'yfinance',
            as_of_date TEXT NOT NULL,
            expiry TEXT,
            spot_price REAL,
            strike REAL,
            days_to_expiry INTEGER,
            straddle_mid_price REAL,
            implied_move_percent REAL,
            straddle_implied_volatility REAL,
            chain_implied_volatility REAL,
            historical_volatility_20 REAL,
            historical_volatility_60 REAL,
            iv_hv20_ratio REAL,
            iv_hv60_ratio REAL,
            iv_percentile REAL,
            iv_hv20_percentile REAL,
            combined_open_interest INTEGER,
            combined_volume INTEGER,
            spread_share REAL,
            pricing_label TEXT,
            pricing_bucket TEXT,
            direction_score REAL,
            direction_label TEXT,
            trend_score REAL,
            trend_label TEXT,
            trend_return_63 REAL,
            trend_return_252 REAL,
            seasonality_score REAL,
            seasonality_label TEXT,
            seasonality_month_label TEXT,
            seasonality_mean_return REAL,
            seasonality_median_return REAL,
            seasonality_win_rate REAL,
            seasonality_average_absolute_return REAL,
            seasonality_observations INTEGER,
            vol_pricing_score REAL,
            execution_score REAL,
            confidence_score REAL,
            candidate_advisory TEXT,
            candidate_bucket TEXT,
            signal_version TEXT NOT NULL DEFAULT 'legacy-v0',
            rv_percentile REAL,
            vrp REAL,
            front_implied_volatility REAL,
            back_implied_volatility REAL,
            term_structure_steepness REAL,
            term_structure_bucket TEXT,
            term_structure_label TEXT,
            atm_implied_volatility REAL,
            put_25_delta_implied_volatility REAL,
            call_25_delta_implied_volatility REAL,
            normalized_skew REAL,
            normalized_upside_skew REAL,
            iv_rank REAL,
            rv_rank REAL,
            vrp_rank REAL,
            term_structure_rank REAL,
            skew_rank REAL,
            primary_trade_idea TEXT,
            trade_idea_labels_json TEXT NOT NULL DEFAULT '[]',
            warnings_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            PRIMARY KEY (run_id, symbol_id),
            FOREIGN KEY (run_id) REFERENCES options_screener_runs(run_id) ON DELETE CASCADE,
            FOREIGN KEY (symbol_id) REFERENCES symbols(symbol_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_options_screener_rows_symbol_date
            ON options_screener_rows (symbol_id, as_of_date);

        CREATE TABLE IF NOT EXISTS tracked_option_positions (
            position_id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_run_id INTEGER NOT NULL,
            symbol_id INTEGER NOT NULL,
            universe_id TEXT NOT NULL,
            universe_label TEXT NOT NULL,
            provider TEXT NOT NULL DEFAULT 'yfinance',
            strategy TEXT NOT NULL,
            signal_version TEXT NOT NULL,
            entry_as_of_date TEXT NOT NULL,
            entry_base_date TEXT,
            expiry TEXT NOT NULL,
            strike REAL NOT NULL,
            days_to_expiry INTEGER,
            spot_price REAL,
            call_entry_bid REAL,
            call_entry_ask REAL,
            call_entry_mid REAL,
            put_entry_bid REAL,
            put_entry_ask REAL,
            put_entry_mid REAL,
            entry_mark_source TEXT NOT NULL,
            entry_executable_value REAL,
            entry_reference_mid REAL,
            candidate_bucket TEXT,
            pricing_bucket TEXT,
            direction_bucket TEXT,
            primary_trade_idea TEXT,
            created_at TEXT NOT NULL,
            closed_at TEXT,
            close_reason TEXT,
            UNIQUE (
                symbol_id,
                provider,
                entry_as_of_date,
                expiry,
                strike,
                strategy,
                signal_version
            ),
            FOREIGN KEY (source_run_id) REFERENCES options_screener_runs(run_id) ON DELETE CASCADE,
            FOREIGN KEY (symbol_id) REFERENCES symbols(symbol_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tracked_option_positions_open
            ON tracked_option_positions (closed_at, expiry, entry_as_of_date);

        CREATE TABLE IF NOT EXISTS tracked_option_marks (
            position_id INTEGER NOT NULL,
            mark_date TEXT NOT NULL,
            recorded_at TEXT NOT NULL,
            underlying_close REAL,
            underlying_close_date TEXT,
            call_bid REAL,
            call_ask REAL,
            call_mid REAL,
            put_bid REAL,
            put_ask REAL,
            put_mid REAL,
            reference_straddle_mid REAL,
            executable_mark_value REAL,
            edge_vs_entry_premium REAL,
            executable_return REAL,
            mark_source TEXT NOT NULL,
            mark_status TEXT NOT NULL,
            reason TEXT,
            PRIMARY KEY (position_id, mark_date),
            FOREIGN KEY (position_id) REFERENCES tracked_option_positions(position_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tracked_option_marks_position_date
            ON tracked_option_marks (position_id, mark_date);

        CREATE TABLE IF NOT EXISTS symbol_universes (
            universe_id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            selection_kind TEXT NOT NULL DEFAULT 'manual',
            source_provider TEXT,
            exchange TEXT,
            mic TEXT,
            note TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS symbol_universe_members (
            universe_id TEXT NOT NULL,
            symbol TEXT NOT NULL,
            label TEXT,
            exchange TEXT,
            mic TEXT,
            instrument_type TEXT,
            currency TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            source_provider TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (universe_id, symbol),
            FOREIGN KEY (universe_id) REFERENCES symbol_universes(universe_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_symbol_universe_members_active
            ON symbol_universe_members (universe_id, is_active, symbol);

        CREATE TABLE IF NOT EXISTS market_collection_runs (
            run_id INTEGER PRIMARY KEY AUTOINCREMENT,
            universe_id TEXT NOT NULL,
            universe_label TEXT NOT NULL,
            mode TEXT NOT NULL,
            requested_provider_order_json TEXT NOT NULL,
            symbol_count INTEGER NOT NULL DEFAULT 0,
            success_count INTEGER NOT NULL DEFAULT 0,
            failure_count INTEGER NOT NULL DEFAULT 0,
            skipped_count INTEGER NOT NULL DEFAULT 0,
            refresh_symbol_master INTEGER NOT NULL DEFAULT 0,
            full_sync INTEGER NOT NULL DEFAULT 0,
            as_of_date TEXT,
            started_at TEXT NOT NULL,
            completed_at TEXT NOT NULL,
            failure_json TEXT NOT NULL DEFAULT '[]',
            FOREIGN KEY (universe_id) REFERENCES symbol_universes(universe_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_market_collection_runs_completed_at
            ON market_collection_runs (completed_at DESC);

        CREATE TABLE IF NOT EXISTS automation_configs (
            automation_id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'data-maintenance',
            schedule_type TEXT NOT NULL DEFAULT 'interval',
            interval_minutes INTEGER NOT NULL DEFAULT 1440,
            run_market_collection INTEGER NOT NULL DEFAULT 1,
            market_universe_ids_json TEXT NOT NULL DEFAULT '[]',
            run_options_collection INTEGER NOT NULL DEFAULT 1,
            options_universe_ids_json TEXT NOT NULL DEFAULT '[]',
            refresh_exchange_symbol_masters INTEGER NOT NULL DEFAULT 0,
            market_provider_order_json TEXT NOT NULL DEFAULT '[]',
            market_full_sync INTEGER NOT NULL DEFAULT 0,
            market_limit INTEGER,
            options_minimum_dte INTEGER,
            options_max_contracts INTEGER,
            health_stale_after_days INTEGER NOT NULL DEFAULT 7,
            health_symbol_limit INTEGER NOT NULL DEFAULT 20,
            health_universe_limit INTEGER NOT NULL DEFAULT 20,
            health_run_limit INTEGER NOT NULL DEFAULT 10,
            max_attention_symbols INTEGER,
            max_sync_errors INTEGER,
            is_active INTEGER NOT NULL DEFAULT 1,
            is_running INTEGER NOT NULL DEFAULT 0,
            last_run_started_at TEXT,
            last_run_completed_at TEXT,
            last_run_status TEXT,
            last_run_summary_json TEXT NOT NULL DEFAULT '{}',
            last_run_error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_automation_configs_active
            ON automation_configs (is_active, is_running, updated_at DESC);

        CREATE TABLE IF NOT EXISTS study_runs (
            run_id INTEGER PRIMARY KEY AUTOINCREMENT,
            study_id TEXT NOT NULL,
            study_title TEXT NOT NULL,
            view_id TEXT,
            selection_label TEXT NOT NULL,
            subject_query TEXT NOT NULL,
            symbol TEXT,
            status TEXT NOT NULL DEFAULT 'success',
            route_hash TEXT,
            requested_start_date TEXT,
            requested_end_date TEXT,
            actual_start_date TEXT,
            actual_end_date TEXT,
            detail_label TEXT,
            requested_params_json TEXT NOT NULL DEFAULT '{}',
            resolved_params_json TEXT NOT NULL DEFAULT '{}',
            provider_summary_json TEXT NOT NULL DEFAULT '{}',
            data_snapshot_refs_json TEXT NOT NULL DEFAULT '[]',
            warning_count INTEGER NOT NULL DEFAULT 0,
            error_message TEXT,
            run_kind TEXT NOT NULL DEFAULT 'analysis',
            started_at TEXT,
            completed_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_study_runs_completed_at
            ON study_runs (completed_at DESC, run_id DESC);

        CREATE INDEX IF NOT EXISTS idx_study_runs_study_id
            ON study_runs (study_id, completed_at DESC);

        CREATE TABLE IF NOT EXISTS study_run_summaries (
            summary_id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER NOT NULL,
            summary_key TEXT NOT NULL,
            label TEXT NOT NULL,
            value_text TEXT,
            value_number REAL,
            value_kind TEXT NOT NULL DEFAULT 'text',
            sort_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (run_id) REFERENCES study_runs(run_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_study_run_summaries_run_id
            ON study_run_summaries (run_id, sort_order, summary_id);

        CREATE TABLE IF NOT EXISTS study_run_links (
            link_id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER NOT NULL,
            link_type TEXT NOT NULL,
            target_kind TEXT NOT NULL,
            target_id TEXT NOT NULL,
            target_label TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            sort_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (run_id) REFERENCES study_runs(run_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_study_run_links_run_id
            ON study_run_links (run_id, sort_order, link_id);

        CREATE TABLE IF NOT EXISTS study_plan_recipes (
            recipe_id TEXT PRIMARY KEY,
            version TEXT NOT NULL DEFAULT 'study-plan-recipes-v1',
            name TEXT NOT NULL,
            route_hash TEXT NOT NULL,
            study_id TEXT NOT NULL,
            view_id TEXT NOT NULL,
            plan_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_study_plan_recipes_updated_at
            ON study_plan_recipes (updated_at DESC, recipe_id ASC);
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

    existing_screener_run_columns = {
        row[1] for row in connection.execute("PRAGMA table_info(options_screener_runs)")
    }
    for column_name, column_sql in [
        ("signal_version", "TEXT NOT NULL DEFAULT 'legacy-v0'"),
    ]:
        if column_name not in existing_screener_run_columns:
            connection.execute(
                f"ALTER TABLE options_screener_runs ADD COLUMN {column_name} {column_sql}",
            )

    existing_screener_row_columns = {
        row[1] for row in connection.execute("PRAGMA table_info(options_screener_rows)")
    }
    for column_name, column_sql in [
        ("signal_version", "TEXT NOT NULL DEFAULT 'legacy-v0'"),
        ("rv_percentile", "REAL"),
        ("vrp", "REAL"),
        ("front_implied_volatility", "REAL"),
        ("back_implied_volatility", "REAL"),
        ("term_structure_steepness", "REAL"),
        ("term_structure_bucket", "TEXT"),
        ("term_structure_label", "TEXT"),
        ("atm_implied_volatility", "REAL"),
        ("put_25_delta_implied_volatility", "REAL"),
        ("call_25_delta_implied_volatility", "REAL"),
        ("normalized_skew", "REAL"),
        ("normalized_upside_skew", "REAL"),
        ("iv_rank", "REAL"),
        ("rv_rank", "REAL"),
        ("vrp_rank", "REAL"),
        ("term_structure_rank", "REAL"),
        ("skew_rank", "REAL"),
        ("primary_trade_idea", "TEXT"),
        ("trade_idea_labels_json", "TEXT NOT NULL DEFAULT '[]'"),
    ]:
        if column_name not in existing_screener_row_columns:
            connection.execute(
                f"ALTER TABLE options_screener_rows ADD COLUMN {column_name} {column_sql}",
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
    return metadata_store.row_to_profile(
        row,
        raw_info_from_row=_raw_info_from_row,
        clean_dividend_yield=_clean_dividend_yield,
        normalize_yield_ratio=_normalize_yield_ratio,
        build_symbol_source_url=build_symbol_source_url,
    )


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
    return metadata_store.normalize_profile(
        symbol,
        info,
        provider_name=provider_name,
        normalize_symbol=normalize_symbol,
        clean_text=_clean_text,
        clean_number=_clean_number,
        clean_int=_clean_int,
        clean_dividend_yield=_clean_dividend_yield,
        build_symbol_source_url=build_symbol_source_url,
        now_iso=lambda: to_iso(now_utc()),
    )


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
    metadata_store.upsert_remembered_dataset(
        connection,
        entry,
        normalize_symbol=normalize_symbol,
        extract_cache_key_from_path=extract_cache_key_from_path,
        symbol_cache_key=symbol_cache_key,
        build_symbol_source_url=build_symbol_source_url,
        to_iso=to_iso,
        now_utc=now_utc,
    )


def upsert_instrument_profile(connection: sqlite3.Connection, profile: dict) -> None:
    metadata_store.upsert_instrument_profile(
        connection,
        profile,
        normalize_symbol=normalize_symbol,
        to_iso=to_iso,
        now_utc=now_utc,
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
    return metadata_store.should_import_remembered_dataset(
        connection,
        dataset_id,
        generated_at,
        normalize_dataset_id=normalize_dataset_id,
        parse_iso_datetime=parse_iso_datetime,
    )


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
    return metadata_store.find_remembered_entry(
        dataset_id,
        symbol,
        open_runtime_store=open_runtime_store,
        normalize_dataset_id=normalize_dataset_id,
        normalize_symbol=normalize_symbol,
    )


def remember_symbol(snapshot: dict) -> dict:
    return metadata_store.remember_symbol(
        snapshot,
        open_runtime_store=open_runtime_store,
        normalize_symbol=normalize_symbol,
        extract_cache_key_from_path=extract_cache_key_from_path,
        symbol_cache_key=symbol_cache_key,
        build_symbol_source_url=build_symbol_source_url,
        to_iso=to_iso,
        now_utc=now_utc,
        find_remembered_entry_fn=find_remembered_entry,
    )


def load_remembered_catalog() -> list[dict]:
    return metadata_store.load_remembered_catalog(
        open_runtime_store=open_runtime_store,
    )


def upsert_symbol_universe(
    universe_id: str,
    label: str,
    *,
    selection_kind: str = "manual",
    source_provider: str | None = None,
    exchange: str | None = None,
    mic: str | None = None,
    note: str | None = None,
) -> dict:
    return metadata_store.upsert_symbol_universe(
        universe_id,
        label,
        selection_kind=selection_kind,
        source_provider=source_provider,
        exchange=exchange,
        mic=mic,
        note=note,
        normalize_dataset_id=normalize_dataset_id,
        to_iso=to_iso,
        now_utc=now_utc,
        open_runtime_store=open_runtime_store,
    )


def sync_symbol_universe_members(
    universe_id: str,
    entries: list[dict],
    *,
    source_provider: str | None = None,
    replace: bool = False,
) -> list[dict]:
    return metadata_store.sync_symbol_universe_members(
        universe_id,
        entries,
        source_provider=source_provider,
        replace=replace,
        normalize_dataset_id=normalize_dataset_id,
        normalize_symbol=normalize_symbol,
        to_iso=to_iso,
        now_utc=now_utc,
        open_runtime_store=open_runtime_store,
    )


def load_symbol_universe_members(
    universe_id: str,
    *,
    include_inactive: bool = False,
) -> list[dict]:
    return metadata_store.load_symbol_universe_members(
        universe_id,
        include_inactive=include_inactive,
        normalize_dataset_id=normalize_dataset_id,
        open_runtime_store=open_runtime_store,
    )


def list_symbol_universes() -> list[dict]:
    return metadata_store.list_symbol_universes(
        open_runtime_store=open_runtime_store,
    )


def load_symbol_sync_state(symbol: str) -> dict | None:
    return metadata_store.load_symbol_sync_state(
        symbol,
        normalize_symbol=normalize_symbol,
        open_runtime_store=open_runtime_store,
    )


def record_market_collection_run(
    *,
    universe_id: str,
    universe_label: str,
    mode: str,
    requested_provider_order: list[str],
    symbol_count: int,
    success_count: int,
    failure_count: int,
    skipped_count: int,
    refresh_symbol_master: bool,
    full_sync: bool,
    as_of_date: str | None,
    started_at: str,
    completed_at: str,
    failures: list[dict],
) -> dict:
    return metadata_store.record_market_collection_run(
        universe_id=universe_id,
        universe_label=universe_label,
        mode=mode,
        requested_provider_order=requested_provider_order,
        symbol_count=symbol_count,
        success_count=success_count,
        failure_count=failure_count,
        skipped_count=skipped_count,
        refresh_symbol_master=refresh_symbol_master,
        full_sync=full_sync,
        as_of_date=as_of_date,
        started_at=started_at,
        completed_at=completed_at,
        failures=failures,
        normalize_dataset_id=normalize_dataset_id,
        open_runtime_store=open_runtime_store,
    )


def list_automation_configs() -> list[dict]:
    return automation_store.list_automation_configs(
        open_runtime_store=open_runtime_store,
    )


def load_automation_config(automation_id: str) -> dict | None:
    return automation_store.load_automation_config(
        automation_id,
        open_runtime_store=open_runtime_store,
        normalize_dataset_id=normalize_dataset_id,
    )


def upsert_automation_config(automation: dict) -> dict:
    return automation_store.upsert_automation_config(
        automation,
        open_runtime_store=open_runtime_store,
        normalize_dataset_id=normalize_dataset_id,
        now_iso=lambda: to_iso(now_utc()),
    )


def delete_automation_config(automation_id: str) -> bool:
    return automation_store.delete_automation_config(
        automation_id,
        open_runtime_store=open_runtime_store,
        normalize_dataset_id=normalize_dataset_id,
    )


def update_automation_run_state(
    automation_id: str,
    *,
    is_running: bool,
    started_at: str | None = None,
    completed_at: str | None = None,
    status: str | None = None,
    summary: dict | None = None,
    error: str | None = None,
) -> dict | None:
    return automation_store.update_automation_run_state(
        automation_id,
        is_running=is_running,
        started_at=started_at,
        completed_at=completed_at,
        status=status,
        summary=summary,
        error=error,
        open_runtime_store=open_runtime_store,
        normalize_dataset_id=normalize_dataset_id,
        now_iso=lambda: to_iso(now_utc()),
    )


def load_due_automation_configs(*, reference_time_iso: str | None = None) -> list[dict]:
    return automation_store.load_due_automation_configs(
        open_runtime_store=open_runtime_store,
        reference_time_iso=reference_time_iso,
    )


def list_study_runs(
    *,
    limit: int = 25,
    study_id: str | None = None,
    status: str | None = None,
) -> list[dict]:
    return runs_store.list_study_runs(
        limit=limit,
        study_id=study_id,
        status=status,
        open_runtime_store=open_runtime_store,
        normalize_dataset_id=normalize_dataset_id,
    )


def load_study_run_by_id(run_id: int) -> dict | None:
    return runs_store.load_study_run_by_id(
        run_id,
        open_runtime_store=open_runtime_store,
    )


def record_study_run(study_run: dict) -> dict:
    return runs_store.record_study_run(
        study_run,
        open_runtime_store=open_runtime_store,
        normalize_dataset_id=normalize_dataset_id,
        normalize_symbol=normalize_symbol,
        now_iso=lambda: to_iso(now_utc()),
    )


def list_study_plan_recipes(*, limit: int = 50) -> list[dict]:
    return study_builder_store.list_study_plan_recipes(
        limit=limit,
        open_runtime_store=open_runtime_store,
    )


def load_study_plan_recipe(recipe_id: str) -> dict | None:
    return study_builder_store.load_study_plan_recipe(
        recipe_id,
        open_runtime_store=open_runtime_store,
    )


def upsert_study_plan_recipe(recipe: dict) -> dict:
    return study_builder_store.upsert_study_plan_recipe(
        recipe,
        open_runtime_store=open_runtime_store,
        now_iso=lambda: to_iso(now_utc()),
    )


def delete_study_plan_recipe(recipe_id: str) -> bool:
    return study_builder_store.delete_study_plan_recipe(
        recipe_id,
        open_runtime_store=open_runtime_store,
    )


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
    return options_store.load_option_monthly_snapshots(
        symbol,
        as_of_date=as_of_date,
        provider=provider,
        normalize_symbol=normalize_symbol,
        open_runtime_store=open_runtime_store,
        load_symbol_row=_load_symbol_row,
    )


def load_option_front_history(
    symbol: str,
    *,
    provider: str | None = None,
    limit: int = 252,
) -> list[dict]:
    return options_store.load_option_front_history(
        symbol,
        provider=provider,
        limit=limit,
        normalize_symbol=normalize_symbol,
        open_runtime_store=open_runtime_store,
        load_symbol_row=_load_symbol_row,
    )


def load_derived_daily_metrics(
    symbol: str,
    *,
    metric_date: str | None = None,
    provider: str | None = None,
    metric_family: str | None = None,
) -> list[dict]:
    return options_store.load_derived_daily_metrics(
        symbol,
        metric_date=metric_date,
        provider=provider,
        metric_family=metric_family,
        normalize_symbol=normalize_symbol,
        open_runtime_store=open_runtime_store,
        load_symbol_row=_load_symbol_row,
    )


def load_recent_options_screener_runs(limit: int = 20) -> list[dict]:
    return options_store.load_recent_options_screener_runs(
        limit,
        open_runtime_store=open_runtime_store,
    )


def load_options_screener_rows(
    *,
    symbol: str | None = None,
    universe_id: str | None = None,
    run_id: int | None = None,
    limit: int = 100,
) -> list[dict]:
    return options_store.load_options_screener_rows(
        symbol=symbol,
        universe_id=universe_id,
        run_id=run_id,
        limit=limit,
        open_runtime_store=open_runtime_store,
        load_symbol_row=_load_symbol_row,
    )


def record_options_screener_run(
    *,
    universe_id: str,
    universe_label: str,
    minimum_dte: int,
    max_contracts: int,
    requested_symbols: list[str],
    failures: list[dict],
    rows: list[dict],
    signal_version: str | None = None,
    created_at: str | None = None,
) -> dict:
    return options_store.record_options_screener_run(
        universe_id=universe_id,
        universe_label=universe_label,
        minimum_dte=minimum_dte,
        max_contracts=max_contracts,
        requested_symbols=requested_symbols,
        failures=failures,
        rows=rows,
        signal_version=signal_version,
        created_at=created_at,
        normalize_symbol=normalize_symbol,
        open_runtime_store=open_runtime_store,
        ensure_symbol_row=_ensure_symbol_row,
        clean_text=_clean_text,
        clean_number=_clean_number,
        clean_int=_clean_int,
        to_iso=to_iso,
        now_utc=now_utc,
    )


def write_option_monthly_snapshot(symbol: str, snapshot: dict) -> list[dict]:
    return options_store.write_option_monthly_snapshot(
        symbol,
        snapshot,
        normalize_symbol=normalize_symbol,
        open_runtime_store=open_runtime_store,
        load_symbol_row=_load_symbol_row,
        ensure_symbol_row=_ensure_symbol_row,
        to_iso=to_iso,
        now_utc=now_utc,
    )


def _tracked_position_from_row(row: sqlite3.Row) -> dict:
    return options_store._tracked_position_from_row(row)


def load_tracked_option_positions(
    *,
    position_id: int | None = None,
    universe_id: str | None = None,
    strategy: str | None = None,
    signal_version: str | None = None,
    open_only: bool = False,
    limit: int = 500,
) -> list[dict]:
    return options_store.load_tracked_option_positions(
        position_id=position_id,
        universe_id=universe_id,
        strategy=strategy,
        signal_version=signal_version,
        open_only=open_only,
        limit=limit,
        open_runtime_store=open_runtime_store,
    )


def load_tracked_option_marks(
    *,
    position_id: int,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 1000,
) -> list[dict]:
    return options_store.load_tracked_option_marks(
        position_id=position_id,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        open_runtime_store=open_runtime_store,
    )


def upsert_tracked_option_position(position: dict, *, created_at: str | None = None) -> dict:
    return options_store.upsert_tracked_option_position(
        position,
        created_at=created_at,
        normalize_symbol=normalize_symbol,
        open_runtime_store=open_runtime_store,
        ensure_symbol_row=_ensure_symbol_row,
        clean_text=_clean_text,
        clean_number=_clean_number,
        clean_int=_clean_int,
        to_iso=to_iso,
        now_utc=now_utc,
    )


def upsert_tracked_option_mark(
    position_id: int,
    mark: dict,
    *,
    recorded_at: str | None = None,
) -> dict:
    return options_store.upsert_tracked_option_mark(
        position_id,
        mark,
        recorded_at=recorded_at,
        open_runtime_store=open_runtime_store,
        clean_text=_clean_text,
        clean_number=_clean_number,
        to_iso=to_iso,
        now_utc=now_utc,
    )
