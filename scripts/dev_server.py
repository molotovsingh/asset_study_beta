#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
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
    from providers.router import normalize_provider_id, provider_display_name
except ModuleNotFoundError:
    from scripts.providers.router import normalize_provider_id, provider_display_name

try:
    from runtime_store import (
        REPO_ROOT,
        ensure_runtime_store,
        load_cached_series,
        load_corporate_actions,
        load_price_rows,
        normalize_symbol,
        write_price_history,
    )
except ModuleNotFoundError:
    from scripts.runtime_store import (
        REPO_ROOT,
        ensure_runtime_store,
        load_cached_series,
        load_corporate_actions,
        load_price_rows,
        normalize_symbol,
        write_price_history,
    )

try:
    from server import index_service, options_service, routes as server_routes
except ModuleNotFoundError:
    from scripts.server import index_service, options_service, routes as server_routes


DEFAULT_HISTORY_PERIOD = index_service.DEFAULT_HISTORY_PERIOD
FULL_HISTORY_FALLBACK_YEARS = index_service.FULL_HISTORY_FALLBACK_YEARS
CACHE_TTL = index_service.CACHE_TTL
PROFILE_CACHE_TTL = index_service.PROFILE_CACHE_TTL
INCREMENTAL_OVERLAP_DAYS = index_service.INCREMENTAL_OVERLAP_DAYS
PRICE_ABSOLUTE_TOLERANCE = index_service.PRICE_ABSOLUTE_TOLERANCE
PRICE_RELATIVE_TOLERANCE = index_service.PRICE_RELATIVE_TOLERANCE
OPTIONS_SCREENER_MAX_SYMBOLS = options_service.OPTIONS_SCREENER_MAX_SYMBOLS
OPTIONS_SCREENER_FETCH_CONCURRENCY = options_service.OPTIONS_SCREENER_FETCH_CONCURRENCY


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
    return index_service.fetch_symbol_history_result(
        symbol,
        period=period,
        start=start,
        end=end,
        preferred_provider=preferred_provider,
    )


def fetch_full_symbol_history_result(
    symbol: str,
    *,
    preferred_provider: str | None = None,
):
    return index_service.fetch_full_symbol_history_result(
        symbol,
        preferred_provider=preferred_provider,
    )


def _cache_dependencies() -> dict[str, object]:
    return {
        "load_cached_series": load_cached_series,
        "normalize_symbol": normalize_symbol,
        "normalize_provider_id": normalize_provider_id,
        "cache_is_fresh": cache_is_fresh,
        "snapshot_requires_full_sync": snapshot_requires_full_sync,
        "ensure_snapshot_currency": ensure_snapshot_currency,
        "fetch_full_symbol_history_result": fetch_full_symbol_history_result,
        "write_price_history": write_price_history,
        "provider_display_name": provider_display_name,
        "stable_rows_hash": stable_rows_hash,
        "load_price_rows": load_price_rows,
        "load_corporate_actions": load_corporate_actions,
        "shift_date": shift_date,
        "fetch_symbol_history_result": fetch_symbol_history_result,
        "validate_price_overlap": validate_price_overlap,
        "validate_action_overlap": validate_action_overlap,
        "incremental_overlap_days": INCREMENTAL_OVERLAP_DAYS,
    }


def get_or_refresh_cached_series(
    symbol: str,
    *,
    preferred_provider: str | None = None,
) -> tuple[dict, str]:
    return index_service.get_or_refresh_cached_series_core(
        symbol,
        preferred_provider=preferred_provider,
        dependencies=_cache_dependencies(),
    )


clean_history_number = options_service.clean_history_number
fetch_symbol_history = index_service.fetch_symbol_history
fetch_symbol_snapshot = index_service.fetch_symbol_snapshot
fetch_full_symbol_history = index_service.fetch_full_symbol_history
clamp = options_service.clamp
mean = options_service.mean
median = options_service.median
score_to_bias_label = options_service.score_to_bias_label
extract_snapshot_series = options_service.extract_snapshot_series
latest_sma = options_service.latest_sma
trailing_return = options_service.trailing_return
build_trend_context = options_service.build_trend_context
build_month_end_rows = options_service.build_month_end_rows
month_distance = options_service.month_distance
build_seasonality_context = options_service.build_seasonality_context
def build_direction_context(
    symbol: str,
    *,
    as_of_date: str | None = None,
    preferred_provider: str | None = None,
) -> dict:
    return options_service.build_direction_context(
        symbol,
        as_of_date=as_of_date,
        preferred_provider=preferred_provider,
        series_loader=get_or_refresh_cached_series,
    )


percentile_rank = options_service.percentile_rank
options_pricing_label = options_service.options_pricing_label
options_pricing_bucket = options_service.options_pricing_bucket
compute_vol_pricing_score = options_service.compute_vol_pricing_score
compute_execution_score = options_service.compute_execution_score
compute_confidence_score = options_service.compute_confidence_score
build_candidate_advisory = options_service.build_candidate_advisory
build_screener_history_summary = options_service.build_screener_history_summary
build_options_screener_storage_row = options_service.build_options_screener_storage_row
summarize_options_screener_run = options_service.summarize_options_screener_run
direction_bucket = options_service.direction_bucket
build_forward_validation_observation = options_service.build_forward_validation_observation
build_options_screener_validation_payload = options_service.build_options_screener_validation_payload
build_monthly_straddle_snapshot_response = options_service.build_monthly_straddle_snapshot_response
shift_date = index_service.shift_date
years_ago_start_date = index_service.years_ago_start_date
stable_rows_hash = index_service.stable_rows_hash
price_values_match = index_service.price_values_match
validate_price_overlap = index_service.validate_price_overlap
validate_action_overlap = index_service.validate_action_overlap
snapshot_requires_full_sync = index_service.snapshot_requires_full_sync
fetch_symbol_profile = index_service.fetch_symbol_profile
ensure_snapshot_currency = index_service.ensure_snapshot_currency
cache_is_fresh = index_service.cache_is_fresh
profile_cache_is_fresh = index_service.profile_cache_is_fresh
get_or_refresh_instrument_profile = index_service.get_or_refresh_instrument_profile
build_response_snapshot = index_service.build_response_snapshot
build_catalog_payload = index_service.build_catalog_payload
build_instrument_profile_payload = index_service.build_instrument_profile_payload
build_index_series_payload = index_service.build_index_series_payload
build_monthly_straddle_payload = options_service.build_monthly_straddle_payload
build_options_screener_snapshot_payload = options_service.build_options_screener_snapshot_payload
build_options_screener_history_payload = options_service.build_options_screener_history_payload
build_options_screener_validation_response = options_service.build_options_screener_validation_response


def parse_json_body(raw_body: bytes) -> object:
    if not raw_body:
        return {}
    return json.loads(raw_body.decode("utf-8"))


def dispatch_api_request(
    method: str,
    path: str,
    raw_body: bytes | None = None,
) -> tuple[HTTPStatus, dict]:
    try:
        request = (
            parse_json_body(raw_body or b"")
            if str(method or "").upper() == "POST"
            else {}
        )
        payload = server_routes.dispatch_request(method, path, request)
        return HTTPStatus.OK, payload
    except json.JSONDecodeError:
        return HTTPStatus.BAD_REQUEST, {"error": "Request body must be valid JSON."}
    except server_routes.UnknownApiRouteError:
        return HTTPStatus.NOT_FOUND, {"error": "Unknown API endpoint."}
    except ValueError as error:
        return HTTPStatus.BAD_REQUEST, {"error": str(error)}
    except RuntimeError as error:
        return HTTPStatus.BAD_GATEWAY, {"error": str(error)}
    except SystemExit:
        return HTTPStatus.SERVICE_UNAVAILABLE, {
            "error": "A required local market-data provider is unavailable.",
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

    def _read_raw_body(self) -> bytes:
        content_length = int(self.headers.get("Content-Length") or "0")
        if content_length <= 0:
            return b""
        return self.rfile.read(content_length)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            status, payload = dispatch_api_request("GET", parsed.path)
            self._write_json(status, payload)
            return

        self.path = parsed.path
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        status, payload = dispatch_api_request(
            "POST",
            parsed.path,
            self._read_raw_body(),
        )
        self._write_json(status, payload)


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
