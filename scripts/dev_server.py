#!/usr/bin/env python3

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timedelta, timezone
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlparse

from sync_yfinance import load_yfinance, normalize_points


REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_ROOT = REPO_ROOT / "data" / "local-cache" / "yfinance" / "index"
MANIFEST_PATH = CACHE_ROOT / "manifest.json"
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


def ensure_cache_dirs() -> None:
    CACHE_ROOT.mkdir(parents=True, exist_ok=True)


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


def build_cache_path(symbol: str) -> Path:
    return CACHE_ROOT / f"{symbol_cache_key(symbol)}.json"


def relative_cache_path(path: Path) -> str:
    return str(path.relative_to(REPO_ROOT))


def load_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")


def load_manifest() -> dict:
    manifest = load_json(MANIFEST_PATH, {"provider": "yfinance", "datasetType": "index", "datasets": []})
    datasets = manifest.get("datasets")
    if not isinstance(datasets, list):
        manifest["datasets"] = []
    return manifest


def save_manifest(manifest: dict) -> None:
    manifest["provider"] = "yfinance"
    manifest["datasetType"] = "index"
    manifest["datasets"] = sorted(
        manifest.get("datasets", []),
        key=lambda item: ((item.get("label") or item.get("symbol") or "").lower(), item.get("symbol") or ""),
    )
    write_json(MANIFEST_PATH, manifest)


def find_manifest_entry_by_symbol(manifest: dict, symbol: str) -> dict | None:
    normalized_symbol = symbol.strip().upper()
    for entry in manifest.get("datasets", []):
        if str(entry.get("symbol", "")).strip().upper() == normalized_symbol:
            return entry
    return None


def build_range(points: list[list[str | float]]) -> dict:
    return {
        "startDate": points[0][0],
        "endDate": points[-1][0],
        "observations": len(points),
    }


def fetch_symbol_points(symbol: str, period: str = DEFAULT_HISTORY_PERIOD) -> list[list[str | float]]:
    yf = load_yfinance()
    frame = yf.Ticker(symbol).history(
        interval="1d",
        auto_adjust=False,
        actions=False,
        period=period,
    )
    if frame.empty:
        raise RuntimeError(f"yfinance returned no rows for symbol {symbol}.")

    if "Close" not in frame.columns:
        raise RuntimeError(f"Expected a Close column in the yfinance response for {symbol}.")

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
        raise RuntimeError(f"yfinance returned fewer than two usable rows for symbol {symbol}.")

    return normalize_points(points)


def cache_is_fresh(snapshot: dict, now: datetime | None = None) -> bool:
    generated_at = parse_iso_datetime(snapshot.get("generatedAt"))
    if generated_at is None:
        return False

    reference = now or now_utc()
    return (reference - generated_at) <= CACHE_TTL


def load_cached_series(symbol: str) -> dict | None:
    cache_path = build_cache_path(symbol)
    snapshot = load_json(cache_path, None)
    if not isinstance(snapshot, dict):
        return None
    return snapshot


def write_cached_series(symbol: str, points: list[list[str | float]]) -> dict:
    cache_path = build_cache_path(symbol)
    snapshot = {
        "provider": "yfinance",
        "datasetType": "index",
        "cacheKey": symbol_cache_key(symbol),
        "symbol": symbol,
        "generatedAt": to_iso(now_utc()),
        "sourceSeriesType": "Price",
        "range": build_range(points),
        "points": points,
        "path": relative_cache_path(cache_path),
    }
    write_json(cache_path, snapshot)
    return snapshot


def get_or_refresh_cached_series(symbol: str) -> tuple[dict, str]:
    cached = load_cached_series(symbol)
    if cached and cache_is_fresh(cached):
        return cached, "hit"

    points = fetch_symbol_points(symbol)
    refreshed = write_cached_series(symbol, points)
    return refreshed, "refreshed"


def build_response_snapshot(raw_snapshot: dict, request: dict, cache_status: str) -> dict:
    symbol = raw_snapshot["symbol"]
    label = (request.get("label") or "").strip() or symbol
    target_series_type = (request.get("targetSeriesType") or "Price").strip() or "Price"
    source_series_type = (request.get("sourceSeriesType") or raw_snapshot.get("sourceSeriesType") or target_series_type).strip() or target_series_type
    provider_name = (request.get("providerName") or "Yahoo Finance").strip() or "Yahoo Finance"
    family = (request.get("family") or "Ad hoc").strip() or "Ad hoc"
    source_url = (request.get("sourceUrl") or build_symbol_source_url(symbol)).strip()
    note = request.get("note")
    note = str(note).strip() if note else None
    dataset_id = (request.get("datasetId") or raw_snapshot.get("cacheKey") or symbol_cache_key(symbol)).strip()

    return {
        "provider": "yfinance",
        "datasetType": "index",
        "datasetId": dataset_id,
        "label": label,
        "symbol": symbol,
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
        },
    }


def remember_symbol(snapshot: dict) -> dict:
    manifest = load_manifest()
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
        "path": snapshot["cache"]["path"],
    }

    datasets = manifest.get("datasets", [])
    replaced = False
    for index, existing in enumerate(datasets):
        if str(existing.get("symbol", "")).strip().upper() == snapshot["symbol"].strip().upper():
            datasets[index] = entry
            replaced = True
            break

    if not replaced:
        datasets.append(entry)

    manifest["datasets"] = datasets
    save_manifest(manifest)
    return entry


def load_remembered_catalog() -> list[dict]:
    manifest = load_manifest()
    return manifest.get("datasets", [])


class DevServerHandler(SimpleHTTPRequestHandler):
    server_version = "IndexStudyLabDevServer/1.0"

    def _write_json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
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
            ensure_cache_dirs()
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
            ensure_cache_dirs()
            request = self._read_json_body()
            symbol = str(request.get("symbol") or "").strip()
            if not symbol:
                raise ValueError("A symbol is required.")

            remember = bool(request.get("remember"))
            manifest = load_manifest()
            remembered_entry = find_manifest_entry_by_symbol(manifest, symbol)

            if not request.get("label") and remembered_entry:
                request["label"] = remembered_entry.get("label") or symbol
            if not request.get("sourceUrl") and remembered_entry:
                request["sourceUrl"] = remembered_entry.get("sourceUrl") or build_symbol_source_url(symbol)
            if not request.get("providerName") and remembered_entry:
                request["providerName"] = remembered_entry.get("providerName") or "Yahoo Finance"
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
    ensure_cache_dirs()
    handler = partial(DevServerHandler, directory=str(REPO_ROOT))
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Serving Index Study Lab on http://{args.host}:{args.port}")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
