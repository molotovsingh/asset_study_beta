#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

try:
    from sync_yfinance import load_yfinance, normalize_points, resolve_ticker_currency
except ModuleNotFoundError:
    from scripts.sync_yfinance import load_yfinance, normalize_points, resolve_ticker_currency

try:
    from runtime_store import (
        REPO_ROOT,
        build_symbol_source_url,
        ensure_runtime_store,
        find_remembered_entry,
        load_cached_series,
        load_remembered_catalog,
        normalize_symbol,
        parse_iso_datetime,
        remember_symbol,
        symbol_cache_key,
        write_cached_series,
    )
except ModuleNotFoundError:
    from scripts.runtime_store import (
        REPO_ROOT,
        build_symbol_source_url,
        ensure_runtime_store,
        find_remembered_entry,
        load_cached_series,
        load_remembered_catalog,
        normalize_symbol,
        parse_iso_datetime,
        remember_symbol,
        symbol_cache_key,
        write_cached_series,
    )


DEFAULT_HISTORY_PERIOD = "10y"
CACHE_TTL = timedelta(hours=24)


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


def fetch_symbol_snapshot(
    symbol: str,
    period: str = DEFAULT_HISTORY_PERIOD,
) -> tuple[list[list[str | float]], str | None]:
    yf = load_yfinance()
    ticker = yf.Ticker(symbol)
    frame = ticker.history(
        interval="1d",
        auto_adjust=False,
        actions=False,
        period=period,
    )
    if frame.empty:
        raise RuntimeError(f"yfinance returned no rows for symbol {symbol}.")

    if "Close" not in frame.columns:
        raise RuntimeError(
            f"Expected a Close column in the yfinance response for {symbol}.",
        )

    points: list[list[str | float]] = []
    for index_value, raw_value in frame["Close"].items():
        try:
            numeric_value = float(raw_value)
        except (TypeError, ValueError):
            continue

        if numeric_value != numeric_value:
            continue

        if hasattr(index_value, "date"):
            date_value = index_value.date().isoformat()
        else:
            date_value = str(index_value)[:10]

        points.append([date_value, round(numeric_value, 6)])

    if len(points) < 2:
        raise RuntimeError(
            f"yfinance returned fewer than two usable rows for symbol {symbol}.",
        )

    return normalize_points(points), resolve_ticker_currency(ticker)


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

    return write_cached_series(symbol, snapshot["points"], currency)


def cache_is_fresh(snapshot: dict, now: datetime | None = None) -> bool:
    generated_at = parse_iso_datetime(snapshot.get("generatedAt"))
    if generated_at is None:
        return False

    reference = now or datetime.now(timezone.utc)
    return (reference - generated_at) <= CACHE_TTL


def get_or_refresh_cached_series(symbol: str) -> tuple[dict, str]:
    normalized_symbol = normalize_symbol(symbol)
    cached = load_cached_series(normalized_symbol)
    if cached and cache_is_fresh(cached):
        return ensure_snapshot_currency(cached), "hit"

    points, currency = fetch_symbol_snapshot(normalized_symbol)
    refreshed = write_cached_series(normalized_symbol, points, currency)
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
    provider_name = (request.get("providerName") or "Yahoo Finance").strip() or "Yahoo Finance"
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

    return {
        "provider": "yfinance",
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

            raw_snapshot, cache_status = get_or_refresh_cached_series(symbol)
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
                    "error": "yfinance is not installed. Run ./.venv/bin/pip install -r requirements-sync.txt first.",
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
