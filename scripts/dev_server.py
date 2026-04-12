#!/usr/bin/env python3

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timedelta, timezone
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

try:
    from env_utils import load_local_env
except ModuleNotFoundError:
    from scripts.env_utils import load_local_env


load_local_env()

try:
    from sync_yfinance import load_yfinance, normalize_points, resolve_ticker_currency
except ModuleNotFoundError:
    from scripts.sync_yfinance import load_yfinance, normalize_points, resolve_ticker_currency

try:
    from providers.router import (
        fetch_history_with_fallback,
        fetch_profile_with_fallback,
        normalize_provider_id,
        provider_display_name,
    )
    from providers.yfinance_provider import fetch_monthly_straddle_snapshot
except ModuleNotFoundError:
    from scripts.providers.router import (
        fetch_history_with_fallback,
        fetch_profile_with_fallback,
        normalize_provider_id,
        provider_display_name,
    )
    from scripts.providers.yfinance_provider import fetch_monthly_straddle_snapshot

try:
    from runtime_store import (
        REPO_ROOT,
        build_symbol_source_url,
        ensure_runtime_store,
        find_remembered_entry,
        load_instrument_profile,
        load_cached_series,
        load_corporate_actions,
        load_option_front_history,
        load_price_rows,
        load_remembered_catalog,
        normalize_symbol,
        parse_iso_datetime,
        remember_symbol,
        symbol_cache_key,
        update_cached_series_currency,
        write_instrument_profile,
        write_option_monthly_snapshot,
        write_price_history,
    )
except ModuleNotFoundError:
    from scripts.runtime_store import (
        REPO_ROOT,
        build_symbol_source_url,
        ensure_runtime_store,
        find_remembered_entry,
        load_instrument_profile,
        load_cached_series,
        load_corporate_actions,
        load_option_front_history,
        load_price_rows,
        load_remembered_catalog,
        normalize_symbol,
        parse_iso_datetime,
        remember_symbol,
        symbol_cache_key,
        update_cached_series_currency,
        write_instrument_profile,
        write_option_monthly_snapshot,
        write_price_history,
    )


DEFAULT_HISTORY_PERIOD = "10y"
FULL_HISTORY_FALLBACK_YEARS = 25
CACHE_TTL = timedelta(hours=24)
PROFILE_CACHE_TTL = timedelta(days=7)
INCREMENTAL_OVERLAP_DAYS = 90
PRICE_ABSOLUTE_TOLERANCE = 1e-6
PRICE_RELATIVE_TOLERANCE = 1e-8


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Serve the static app plus a local yfinance-backed API.",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host interface to bind. Default: 127.0.0.1",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port to bind. Default: 8000",
    )
    return parser.parse_args()


def clean_history_number(value) -> float | None:
    if value is None:
        return None

    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        return None

    if numeric_value != numeric_value:
        return None

    return numeric_value


def history_index_date(index_value) -> str:
    if hasattr(index_value, "date"):
        return index_value.date().isoformat()
    return str(index_value)[:10]


def fetch_symbol_history_result(
    symbol: str,
    *,
    period: str | None = None,
    start: str | None = None,
    end: str | None = None,
    preferred_provider: str | None = None,
):
    return fetch_history_with_fallback(
        symbol,
        period=period,
        start=start,
        end=end,
        preferred_provider=preferred_provider,
    )


def fetch_symbol_history(
    symbol: str,
    *,
    period: str | None = None,
    start: str | None = None,
    end: str | None = None,
) -> tuple[list[dict], list[dict], str | None]:
    result = fetch_symbol_history_result(
        symbol,
        period=period,
        start=start,
        end=end,
    )
    return result.price_rows, result.action_rows, result.currency


def fetch_symbol_snapshot(
    symbol: str,
    period: str = DEFAULT_HISTORY_PERIOD,
) -> tuple[list[list[str | float]], str | None]:
    price_rows, _action_rows, currency = fetch_symbol_history(symbol, period=period)
    points = [
        [row["date"], round(float(row["close"]), 6)]
        for row in price_rows
    ]
    return normalize_points(points), currency


def fetch_full_symbol_history_result(symbol: str, *, preferred_provider: str | None = None):
    last_error: Exception | None = None
    attempts = (
        {"period": "max", "label": "period=max"},
        {
            "start": years_ago_start_date(FULL_HISTORY_FALLBACK_YEARS),
            "label": f"start={years_ago_start_date(FULL_HISTORY_FALLBACK_YEARS)}",
        },
        {"period": DEFAULT_HISTORY_PERIOD, "label": f"period={DEFAULT_HISTORY_PERIOD}"},
    )
    for attempt in attempts:
        try:
            result = fetch_symbol_history_result(
                symbol,
                period=attempt.get("period"),
                start=attempt.get("start"),
                preferred_provider=preferred_provider,
            )
        except Exception as error:  # noqa: BLE001
            last_error = error
            continue

        return result, str(attempt["label"])

    if last_error is not None:
        raise RuntimeError(f"Could not fetch broad history for {symbol}: {last_error}") from last_error
    raise RuntimeError(f"Could not fetch history for symbol {symbol}.")


def fetch_full_symbol_history(symbol: str) -> tuple[list[dict], list[dict], str | None, str]:
    result, attempt_label = fetch_full_symbol_history_result(symbol)
    return result.price_rows, result.action_rows, result.currency, attempt_label


def shift_date(date_value: str, days: int) -> str:
    parsed = datetime.fromisoformat(str(date_value)[:10])
    return (parsed + timedelta(days=days)).date().isoformat()


def years_ago_start_date(years: int, now: datetime | None = None) -> str:
    reference_date = (now or datetime.now(timezone.utc)).date()
    try:
        shifted = reference_date.replace(year=reference_date.year - years)
    except ValueError:
        shifted = reference_date.replace(year=reference_date.year - years, day=28)
    return shifted.isoformat()


def stable_rows_hash(rows: list[dict], fields: list[str]) -> str:
    normalized_rows = [
        {
            field: (
                round(float(row[field]), 8)
                if isinstance(row.get(field), (int, float))
                else row.get(field)
            )
            for field in fields
        }
        for row in sorted(rows, key=lambda item: tuple(str(item.get(field) or "") for field in fields))
    ]
    payload = json.dumps(normalized_rows, separators=(",", ":"), sort_keys=True)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def price_values_match(left: float, right: float) -> bool:
    absolute_delta = abs(left - right)
    if absolute_delta <= PRICE_ABSOLUTE_TOLERANCE:
        return True

    denominator = max(abs(left), abs(right), 1)
    return (absolute_delta / denominator) <= PRICE_RELATIVE_TOLERANCE


def validate_price_overlap(cached_rows: list[dict], fetched_rows: list[dict]) -> tuple[bool, str]:
    cached_by_date = {
        row["date"]: row
        for row in cached_rows
        if row.get("date") and row.get("close") is not None
    }
    fetched_by_date = {
        row["date"]: row
        for row in fetched_rows
        if row.get("date") and row.get("close") is not None
    }
    overlap_dates = sorted(set(cached_by_date) & set(fetched_by_date))
    if not overlap_dates:
        return False, "No overlapping dates were available for incremental validation."

    missing_fetched_dates = sorted(set(cached_by_date) - set(fetched_by_date))
    if missing_fetched_dates:
        sample = ", ".join(missing_fetched_dates[:3])
        return False, f"Fetched overlap omitted cached dates: {sample}."

    for date_value in overlap_dates:
        cached_close = float(cached_by_date[date_value]["close"])
        fetched_close = float(fetched_by_date[date_value]["close"])
        if not price_values_match(cached_close, fetched_close):
            return (
                False,
                f"Cached close changed on {date_value}: {cached_close} vs {fetched_close}.",
            )

    return True, f"Validated {len(overlap_dates)} overlapping closes."


def validate_action_overlap(cached_actions: list[dict], fetched_actions: list[dict]) -> tuple[bool, str]:
    cached_hash = stable_rows_hash(cached_actions, ["date", "actionType", "value"])
    fetched_hash = stable_rows_hash(fetched_actions, ["date", "actionType", "value"])
    if cached_hash != fetched_hash:
        return False, "Corporate actions changed in the overlap window."

    return True, "Corporate actions matched in the overlap window."


def snapshot_requires_full_sync(snapshot: dict | None) -> bool:
    if snapshot is None:
        return True

    sync_mode = (snapshot.get("syncState") or {}).get("lastSyncMode")
    return sync_mode in {None, "legacy", "manual"}


def fetch_symbol_profile(symbol: str, *, preferred_provider: str | None = None) -> dict:
    result = fetch_profile_with_fallback(
        symbol,
        preferred_provider=preferred_provider,
    )
    return write_instrument_profile(
        symbol,
        result.info,
        provider_name=result.provider_name,
    )


def ensure_snapshot_currency(snapshot: dict) -> dict:
    if snapshot.get("currency"):
        return snapshot

    symbol = normalize_symbol(snapshot.get("symbol"))
    if not symbol:
        return snapshot

    try:
        yf = load_yfinance()
        ticker = yf.Ticker(symbol)
        currency = resolve_ticker_currency(ticker)
    except Exception:  # noqa: BLE001
        return snapshot

    if not currency:
        return snapshot

    return update_cached_series_currency(symbol, currency) or snapshot


def cache_is_fresh(snapshot: dict, now: datetime | None = None) -> bool:
    generated_at = parse_iso_datetime(snapshot.get("generatedAt"))
    if generated_at is None:
        return False

    reference = now or datetime.now(timezone.utc)
    return (reference - generated_at) <= CACHE_TTL


def profile_cache_is_fresh(profile: dict, now: datetime | None = None) -> bool:
    fetched_at = parse_iso_datetime(profile.get("fetchedAt"))
    if fetched_at is None:
        return False

    reference = now or datetime.now(timezone.utc)
    return (reference - fetched_at) <= PROFILE_CACHE_TTL


def get_or_refresh_cached_series(
    symbol: str,
    *,
    preferred_provider: str | None = None,
) -> tuple[dict, str]:
    normalized_symbol = normalize_symbol(symbol)
    cached = load_cached_series(normalized_symbol)
    explicit_provider = normalize_provider_id(preferred_provider)
    cached_provider = normalize_provider_id(cached.get("provider")) if cached else None
    provider_preference_changed = (
        explicit_provider is not None and explicit_provider != cached_provider
    )
    effective_provider = explicit_provider or cached_provider

    if cached and not provider_preference_changed and cache_is_fresh(cached) and not snapshot_requires_full_sync(cached):
        return ensure_snapshot_currency(cached), "hit"

    if provider_preference_changed:
        history_result, period = fetch_full_symbol_history_result(
            normalized_symbol,
            preferred_provider=effective_provider,
        )
        sync_message = (
            f"Preferred provider switched from {provider_display_name(cached_provider)} "
            f"to {history_result.provider_name}. Full sync using {period}."
        )
        if history_result.coverage_note:
            sync_message = f"{sync_message} {history_result.coverage_note}"
        refreshed = write_price_history(
            normalized_symbol,
            history_result.price_rows,
            history_result.action_rows,
            currency=history_result.currency,
            source_series_type="Price",
            provider=history_result.provider,
            sync_mode="full",
            sync_status="ok",
            sync_message=sync_message,
            replace=True,
            overlap_hash=stable_rows_hash(
                history_result.price_rows[-INCREMENTAL_OVERLAP_DAYS:],
                ["date", "close"],
            ),
            actions_hash=stable_rows_hash(
                history_result.action_rows,
                ["date", "actionType", "value"],
            ),
        )
        return refreshed, "provider-switch"

    if snapshot_requires_full_sync(cached):
        history_result, period = fetch_full_symbol_history_result(
            normalized_symbol,
            preferred_provider=effective_provider,
        )
        sync_message = f"Full {history_result.provider_name} sync using {period}."
        if history_result.coverage_note:
            sync_message = f"{sync_message} {history_result.coverage_note}"
        refreshed = write_price_history(
            normalized_symbol,
            history_result.price_rows,
            history_result.action_rows,
            currency=history_result.currency,
            source_series_type="Price",
            provider=history_result.provider,
            sync_mode="full",
            sync_status="ok",
            sync_message=sync_message,
            replace=True,
            overlap_hash=stable_rows_hash(
                history_result.price_rows[-INCREMENTAL_OVERLAP_DAYS:],
                ["date", "close"],
            ),
            actions_hash=stable_rows_hash(
                history_result.action_rows,
                ["date", "actionType", "value"],
            ),
        )
        return refreshed, "refreshed"

    last_price_date = (cached.get("syncState") or {}).get("lastPriceDate") or cached["range"]["endDate"]
    overlap_start = shift_date(last_price_date, -INCREMENTAL_OVERLAP_DAYS)
    history_result = fetch_symbol_history_result(
        normalized_symbol,
        start=overlap_start,
        preferred_provider=effective_provider,
    )
    fetched_rows = history_result.price_rows
    fetched_actions = history_result.action_rows
    fetched_end = fetched_rows[-1]["date"]
    cached_overlap = load_price_rows(normalized_symbol, overlap_start, fetched_end)
    cached_actions = load_corporate_actions(normalized_symbol, overlap_start, fetched_end)

    prices_valid, price_message = validate_price_overlap(cached_overlap, fetched_rows)
    actions_valid, action_message = validate_action_overlap(cached_actions, fetched_actions)
    if not prices_valid or not actions_valid:
        full_result, period = fetch_full_symbol_history_result(
            normalized_symbol,
            preferred_provider=effective_provider,
        )
        rebuild_message = f"{price_message} {action_message} Rebuilt using {full_result.provider_name} {period}."
        if full_result.coverage_note:
            rebuild_message = f"{rebuild_message} {full_result.coverage_note}"
        refreshed = write_price_history(
            normalized_symbol,
            full_result.price_rows,
            full_result.action_rows,
            currency=full_result.currency or history_result.currency,
            source_series_type="Price",
            provider=full_result.provider,
            sync_mode="full",
            sync_status="rebuilt",
            sync_message=rebuild_message,
            replace=True,
            overlap_hash=stable_rows_hash(
                full_result.price_rows[-INCREMENTAL_OVERLAP_DAYS:],
                ["date", "close"],
            ),
            actions_hash=stable_rows_hash(
                full_result.action_rows,
                ["date", "actionType", "value"],
            ),
        )
        return refreshed, "rebuilt"

    incremental_message = f"{price_message} {action_message}"
    if history_result.coverage_note:
        incremental_message = f"{incremental_message} {history_result.coverage_note}"
    refreshed = write_price_history(
        normalized_symbol,
        fetched_rows,
        fetched_actions,
        currency=history_result.currency or cached.get("currency"),
        source_series_type="Price",
        provider=history_result.provider,
        sync_mode="incremental",
        sync_status="ok",
        sync_message=incremental_message,
        replace=False,
        action_window=(overlap_start, fetched_end),
        overlap_hash=stable_rows_hash(fetched_rows, ["date", "close"]),
        actions_hash=stable_rows_hash(fetched_actions, ["date", "actionType", "value"]),
    )
    return refreshed, "incremental"


def get_or_refresh_instrument_profile(symbol: str) -> tuple[dict, str]:
    normalized_symbol = normalize_symbol(symbol)
    cached = load_instrument_profile(normalized_symbol)
    if cached and profile_cache_is_fresh(cached):
        return cached, "hit"

    cached_snapshot = load_cached_series(normalized_symbol)
    preferred_provider = cached_snapshot.get("provider") if cached_snapshot else None
    refreshed = fetch_symbol_profile(
        normalized_symbol,
        preferred_provider=preferred_provider,
    )
    return refreshed, "refreshed"


def build_response_snapshot(raw_snapshot: dict, request: dict, cache_status: str) -> dict:
    symbol = raw_snapshot["symbol"]
    label = (request.get("label") or "").strip() or symbol
    target_series_type = (request.get("targetSeriesType") or "Price").strip() or "Price"
    source_series_type = (
        request.get("sourceSeriesType")
        or raw_snapshot.get("sourceSeriesType")
        or target_series_type
    ).strip() or target_series_type
    provider_name = provider_display_name(raw_snapshot.get("provider"))
    family = (request.get("family") or "Ad hoc").strip() or "Ad hoc"
    source_url = (request.get("sourceUrl") or build_symbol_source_url(symbol)).strip()
    note = request.get("note")
    note = str(note).strip() if note else None
    dataset_id = (
        request.get("datasetId")
        or raw_snapshot.get("cacheKey")
        or symbol_cache_key(symbol)
    ).strip()
    cache_key = raw_snapshot.get("cacheKey") or symbol_cache_key(symbol)
    sync_state = raw_snapshot.get("syncState") or {}

    return {
        "provider": raw_snapshot.get("provider") or "yfinance",
        "datasetType": "index",
        "datasetId": dataset_id,
        "label": label,
        "symbol": symbol,
        "currency": raw_snapshot.get("currency"),
        "targetSeriesType": target_series_type,
        "sourceSeriesType": source_series_type,
        "providerName": provider_name,
        "family": family,
        "sourceUrl": source_url,
        "note": note,
        "generatedAt": raw_snapshot["generatedAt"],
        "range": raw_snapshot["range"],
        "points": raw_snapshot["points"],
        "cache": {
            "status": cache_status,
            "path": raw_snapshot.get("path"),
            "key": cache_key,
            "syncMode": sync_state.get("lastSyncMode"),
            "syncStatus": sync_state.get("lastSyncStatus"),
            "lastCheckedAt": sync_state.get("lastCheckedAt"),
        },
    }


class DevServerHandler(SimpleHTTPRequestHandler):
    server_version = "IndexStudyLabDevServer/1.0"

    def end_headers(self) -> None:
        # This is a local dev server; disable browser caching for HTML/CSS/JS
        # so reloads always reflect the current worktree.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _write_json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> dict:
        content_length = int(self.headers.get("Content-Length") or "0")
        raw_body = self.rfile.read(content_length)
        if not raw_body:
            return {}
        return json.loads(raw_body.decode("utf-8"))

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/yfinance/catalog":
            ensure_runtime_store()
            self._write_json(
                HTTPStatus.OK,
                {
                    "provider": "yfinance",
                    "datasetType": "index",
                    "datasets": load_remembered_catalog(),
                },
            )
            return

        self.path = parsed.path
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/yfinance/instrument-profile":
            try:
                ensure_runtime_store()
                request = self._read_json_body()
                symbol = normalize_symbol(request.get("symbol"))
                if not symbol:
                    raise ValueError("A symbol is required.")

                profile, cache_status = get_or_refresh_instrument_profile(symbol)
                self._write_json(
                    HTTPStatus.OK,
                    {
                        "profile": profile,
                        "cache": {
                            "status": cache_status,
                        },
                    },
                )
            except json.JSONDecodeError:
                self._write_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": "Request body must be valid JSON."},
                )
            except ValueError as error:
                self._write_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": str(error)},
                )
            except RuntimeError as error:
                self._write_json(
                    HTTPStatus.BAD_GATEWAY,
                    {"error": str(error)},
                )
            except SystemExit:
                self._write_json(
                    HTTPStatus.SERVICE_UNAVAILABLE,
                    {
                        "error": "A required local market-data provider is unavailable.",
                    },
                )
            return

        if parsed.path == "/api/yfinance/monthly-straddle":
            try:
                request = self._read_json_body()
                symbol = normalize_symbol(request.get("symbol"))
                if not symbol:
                    raise ValueError("A symbol is required.")

                minimum_dte = int(request.get("minimumDte") or 25)
                max_contracts = int(request.get("maxContracts") or 4)
                if minimum_dte < 7 or minimum_dte > 365:
                    raise ValueError("Minimum DTE must be between 7 and 365 days.")
                if max_contracts < 1 or max_contracts > 8:
                    raise ValueError("Contract count must be between 1 and 8.")

                snapshot = fetch_monthly_straddle_snapshot(
                    symbol,
                    minimum_dte=minimum_dte,
                    max_contracts=max_contracts,
                )
                try:
                    write_option_monthly_snapshot(symbol, snapshot)
                    snapshot["history"] = {
                        "frontContracts": load_option_front_history(
                            symbol,
                            provider=snapshot.get("provider"),
                            limit=252,
                        ),
                    }
                except Exception as storage_error:  # noqa: BLE001
                    snapshot["storageWarning"] = (
                        f"Local snapshot persistence failed: {storage_error}"
                    )
                self._write_json(
                    HTTPStatus.OK,
                    {
                        "snapshot": snapshot,
                    },
                )
            except json.JSONDecodeError:
                self._write_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": "Request body must be valid JSON."},
                )
            except ValueError as error:
                self._write_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": str(error)},
                )
            except RuntimeError as error:
                self._write_json(
                    HTTPStatus.BAD_GATEWAY,
                    {"error": str(error)},
                )
            except SystemExit:
                self._write_json(
                    HTTPStatus.SERVICE_UNAVAILABLE,
                    {
                        "error": "A required local market-data provider is unavailable.",
                    },
                )
            return

        if parsed.path != "/api/yfinance/index-series":
            self._write_json(
                HTTPStatus.NOT_FOUND,
                {"error": "Unknown API endpoint."},
            )
            return

        try:
            ensure_runtime_store()
            request = self._read_json_body()
            symbol = normalize_symbol(request.get("symbol"))
            if not symbol:
                raise ValueError("A symbol is required.")

            request["symbol"] = symbol
            remember = bool(request.get("remember"))
            remembered_entry = find_remembered_entry(
                request.get("datasetId"),
                symbol,
            )

            if not request.get("label") and remembered_entry:
                request["label"] = remembered_entry.get("label") or symbol
            if not request.get("sourceUrl") and remembered_entry:
                request["sourceUrl"] = (
                    remembered_entry.get("sourceUrl")
                    or build_symbol_source_url(symbol)
                )
            if not request.get("providerName") and remembered_entry:
                request["providerName"] = (
                    remembered_entry.get("providerName") or "Yahoo Finance"
                )
            if not request.get("family") and remembered_entry:
                request["family"] = remembered_entry.get("family") or "Remembered"

            raw_snapshot, cache_status = get_or_refresh_cached_series(
                symbol,
                preferred_provider=request.get("preferredProvider"),
            )
            snapshot = build_response_snapshot(raw_snapshot, request, cache_status)

            remembered = remember_symbol(snapshot) if remember else None
            self._write_json(
                HTTPStatus.OK,
                {
                    "snapshot": snapshot,
                    "rememberedEntry": remembered,
                },
            )
        except json.JSONDecodeError:
            self._write_json(
                HTTPStatus.BAD_REQUEST,
                {"error": "Request body must be valid JSON."},
            )
        except ValueError as error:
            self._write_json(
                HTTPStatus.BAD_REQUEST,
                {"error": str(error)},
            )
        except RuntimeError as error:
            self._write_json(
                HTTPStatus.BAD_GATEWAY,
                {"error": str(error)},
            )
        except SystemExit:
            self._write_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {
                    "error": "A required local market-data provider is unavailable.",
                },
            )


def main() -> int:
    args = parse_args()
    ensure_runtime_store()
    handler = partial(DevServerHandler, directory=str(REPO_ROOT))
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Serving Index Study Lab on http://{args.host}:{args.port}")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
