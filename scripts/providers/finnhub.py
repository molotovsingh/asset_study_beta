from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

from .base import HistoryResult

try:
    from env_utils import load_local_env
except ModuleNotFoundError:
    from scripts.env_utils import load_local_env


PROVIDER_ID = "finnhub"
PROVIDER_NAME = "Finnhub"
PROVIDER_BASE_URL = "https://finnhub.io/api/v1"

_CORPORATE_SUFFIX_PATTERN = re.compile(
    r"\b(inc|incorporated|corp|corporation|co|company|limited|ltd|llc|plc|sa|nv|ag|holdings?)\b",
    re.IGNORECASE,
)

_TYPE_PRIORITY = {
    "common stock": 24,
    "adr": 20,
    "etf": 18,
    "etp": 16,
    "index": 15,
    "reit": 14,
    "preferred stock": 12,
    "closed-end fund": 10,
    "fund": 8,
}


def _request_json(path: str, **params) -> dict:
    api_key = _load_api_key()
    query_params = {key: value for key, value in params.items() if value not in {None, ""}}
    if "_from" in query_params:
        query_params["from"] = query_params.pop("_from")
    query_params["token"] = api_key
    request_url = (
        f"{PROVIDER_BASE_URL}{path}?{urllib.parse.urlencode(query_params)}"
    )
    request = urllib.request.Request(
        request_url,
        headers={
            "User-Agent": "IndexStudyLab/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("Finnhub returned an invalid JSON payload.")
    return payload


def _load_api_key() -> str:
    load_local_env()
    api_key = str(os.environ.get("FINNHUB_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("Finnhub API key is not configured.")
    return api_key


def _normalize_text(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").strip().lower()).strip()


def _compact_text(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def _normalize_company_name(value: str | None) -> str:
    normalized = _normalize_text(value)
    if not normalized:
        return ""

    stripped = _CORPORATE_SUFFIX_PATTERN.sub(" ", normalized)
    return re.sub(r"\s+", " ", stripped).strip()


def _period_start_date(period: str | None) -> str:
    normalized_period = str(period or "").strip().lower()
    if not normalized_period or normalized_period == "max":
        return "1970-01-01"

    match = re.fullmatch(r"(\d+)([dwkmy])", normalized_period)
    if not match:
        raise RuntimeError(f"Unsupported Finnhub history period: {period}")

    count = int(match.group(1))
    unit = match.group(2)
    today = datetime.now(timezone.utc).date()
    if unit == "d":
        start_date = today - timedelta(days=count)
    elif unit == "w":
        start_date = today - timedelta(weeks=count)
    elif unit == "m":
        start_date = today - timedelta(days=count * 31)
    elif unit == "y":
        start_date = today - timedelta(days=count * 366)
    else:
        raise RuntimeError(f"Unsupported Finnhub history period unit: {period}")
    return start_date.isoformat()


def _to_unix_timestamp(date_value: str, *, end_of_day: bool = False) -> int:
    parsed_date = date.fromisoformat(str(date_value)[:10])
    parsed_datetime = datetime.combine(
        parsed_date,
        datetime.max.time() if end_of_day else datetime.min.time(),
        tzinfo=timezone.utc,
    )
    return int(parsed_datetime.timestamp())


def _normalize_candle_rows(payload: dict) -> list[dict]:
    status = str(payload.get("s") or "").strip().lower()
    if status == "no_data":
        return []
    if status != "ok":
        raise RuntimeError("Finnhub returned an invalid candle payload.")

    closes = payload.get("c")
    highs = payload.get("h")
    lows = payload.get("l")
    opens = payload.get("o")
    timestamps = payload.get("t")
    volumes = payload.get("v")
    if not all(isinstance(series, list) for series in (closes, highs, lows, opens, timestamps, volumes)):
        raise RuntimeError("Finnhub candle payload is missing one or more series arrays.")

    rows: list[dict] = []
    for close_value, high_value, low_value, open_value, timestamp_value, volume_value in zip(
        closes,
        highs,
        lows,
        opens,
        timestamps,
        volumes,
    ):
        try:
            date_value = datetime.fromtimestamp(int(timestamp_value), tz=timezone.utc).date().isoformat()
        except (TypeError, ValueError, OSError):
            continue

        try:
            close_number = float(close_value)
        except (TypeError, ValueError):
            continue

        rows.append(
            {
                "date": date_value,
                "open": float(open_value) if open_value is not None else None,
                "high": float(high_value) if high_value is not None else None,
                "low": float(low_value) if low_value is not None else None,
                "close": close_number,
                "adjClose": None,
                "volume": float(volume_value) if volume_value is not None else None,
            },
        )

    return rows


def _match_kind_and_score(
    query: str,
    *,
    symbol: str,
    display_symbol: str,
    description: str,
    instrument_type: str,
) -> tuple[str, int] | None:
    normalized_query = _normalize_text(query)
    compact_query = _compact_text(query)
    normalized_symbol = _normalize_text(symbol)
    normalized_display_symbol = _normalize_text(display_symbol)
    normalized_description = _normalize_text(description)
    normalized_company_name = _normalize_company_name(description)
    compact_symbol = _compact_text(symbol)
    compact_display_symbol = _compact_text(display_symbol)
    compact_description = _compact_text(description)
    compact_company_name = _compact_text(normalized_company_name)
    type_bonus = _TYPE_PRIORITY.get(_normalize_text(instrument_type), 0)

    if not normalized_query:
        return None

    if (
        normalized_symbol == normalized_query
        or normalized_display_symbol == normalized_query
    ):
        return ("exact-symbol", 240 + type_bonus)

    if normalized_company_name and normalized_company_name == normalized_query:
        return ("exact-company", 226 + type_bonus)

    if normalized_description == normalized_query:
        return ("exact-description", 220 + type_bonus)

    if compact_query:
        if compact_symbol == compact_query or compact_display_symbol == compact_query:
            return ("exact-compact-symbol", 236 + type_bonus)

        if compact_company_name and compact_company_name == compact_query:
            return ("exact-compact-company", 222 + type_bonus)

        if compact_description and compact_description == compact_query:
            return ("exact-compact-description", 216 + type_bonus)

    if normalized_description.startswith(normalized_query):
        return ("starts-with-description", 184 + type_bonus)

    if normalized_company_name.startswith(normalized_query):
        return ("starts-with-company", 180 + type_bonus)

    if (
        normalized_symbol.startswith(normalized_query)
        or normalized_display_symbol.startswith(normalized_query)
    ):
        return ("starts-with-symbol", 172 + type_bonus)

    if compact_query:
        if compact_description.startswith(compact_query):
            return ("starts-with-compact-description", 180 + type_bonus)

        if compact_company_name.startswith(compact_query):
            return ("starts-with-compact-company", 176 + type_bonus)

        if (
            compact_symbol.startswith(compact_query)
            or compact_display_symbol.startswith(compact_query)
        ):
            return ("starts-with-compact-symbol", 168 + type_bonus)

    if normalized_query in normalized_description:
        return ("contains-description", 146 + type_bonus)

    if normalized_query in normalized_symbol or normalized_query in normalized_display_symbol:
        return ("contains-symbol", 136 + type_bonus)

    if compact_query:
        if compact_query in compact_description:
            return ("contains-compact-description", 142 + type_bonus)

        if compact_query in compact_symbol or compact_query in compact_display_symbol:
            return ("contains-compact-symbol", 132 + type_bonus)

    return None


def search_symbols(query: str, *, limit: int = 8) -> list[dict]:
    normalized_query = _normalize_text(query)
    if len(normalized_query) < 2:
        return []

    payload = _request_json("/search", q=query)
    raw_results = payload.get("result")
    if not isinstance(raw_results, list):
        raise RuntimeError("Finnhub returned an invalid search payload.")

    normalized_results: list[dict] = []
    seen_symbols: set[str] = set()
    for raw_result in raw_results:
        if not isinstance(raw_result, dict):
            continue

        symbol = str(
            raw_result.get("symbol") or raw_result.get("displaySymbol") or "",
        ).strip()
        display_symbol = str(raw_result.get("displaySymbol") or symbol).strip()
        description = str(raw_result.get("description") or display_symbol).strip()
        instrument_type = str(raw_result.get("type") or "").strip()
        normalized_symbol = _normalize_text(symbol)
        if not normalized_symbol or normalized_symbol in seen_symbols:
            continue

        scored_match = _match_kind_and_score(
            query,
            symbol=symbol,
            display_symbol=display_symbol,
            description=description,
            instrument_type=instrument_type,
        )
        if not scored_match:
            continue

        match_kind, match_score = scored_match
        seen_symbols.add(normalized_symbol)
        normalized_results.append(
            {
                "kind": "provider",
                "label": description or display_symbol or symbol,
                "symbol": symbol,
                "displaySymbol": display_symbol,
                "subjectQuery": symbol,
                "provider": PROVIDER_ID,
                "providerName": PROVIDER_NAME,
                "family": instrument_type or "Instrument",
                "description": description or display_symbol or symbol,
                "matchKind": match_kind,
                "matchScore": match_score,
            },
        )

    normalized_results.sort(
        key=lambda entry: (
            -int(entry.get("matchScore") or 0),
            len(str(entry.get("label") or "")),
            str(entry.get("symbol") or ""),
        ),
    )
    return normalized_results[: max(1, min(limit, 12))]


def fetch_exchange_symbols(
    exchange: str,
    *,
    mic: str | None = None,
) -> list[dict]:
    normalized_exchange = str(exchange or "").strip().upper()
    if not normalized_exchange:
        raise RuntimeError("Finnhub exchange code is required.")

    payload = _request_json("/stock/symbol", exchange=normalized_exchange, mic=mic)
    if not isinstance(payload, list):
        raise RuntimeError("Finnhub returned an invalid exchange-symbol payload.")

    normalized_results: list[dict] = []
    seen_symbols: set[str] = set()
    for raw_result in payload:
        if not isinstance(raw_result, dict):
            continue

        symbol = str(raw_result.get("symbol") or raw_result.get("displaySymbol") or "").strip()
        normalized_symbol = _normalize_text(symbol)
        if not normalized_symbol or normalized_symbol in seen_symbols:
            continue

        seen_symbols.add(normalized_symbol)
        normalized_results.append(
            {
                "symbol": symbol,
                "displaySymbol": str(raw_result.get("displaySymbol") or symbol).strip(),
                "description": str(raw_result.get("description") or symbol).strip(),
                "type": str(raw_result.get("type") or "").strip(),
                "mic": str(raw_result.get("mic") or "").strip() or None,
                "currency": str(raw_result.get("currency") or "").strip().upper() or None,
                "figi": str(raw_result.get("figi") or "").strip() or None,
            },
        )

    normalized_results.sort(key=lambda entry: (entry["symbol"], entry["description"]))
    return normalized_results


def fetch_history(
    symbol: str,
    *,
    period: str | None = None,
    start: str | None = None,
    end: str | None = None,
) -> HistoryResult:
    normalized_symbol = str(symbol or "").strip().upper()
    if not normalized_symbol:
        raise RuntimeError("Finnhub history fetch requires a symbol.")

    start_date = str(start or _period_start_date(period))[:10]
    end_date = str(end or datetime.now(timezone.utc).date().isoformat())[:10]
    payload = _request_json(
        "/stock/candle",
        symbol=normalized_symbol,
        resolution="D",
        _from=_to_unix_timestamp(start_date),
        to=_to_unix_timestamp(end_date, end_of_day=True),
    )
    price_rows = _normalize_candle_rows(payload)
    if not price_rows:
        raise RuntimeError(f"Finnhub returned no rows for symbol {normalized_symbol}.")

    return HistoryResult(
        provider=PROVIDER_ID,
        provider_name=PROVIDER_NAME,
        price_rows=price_rows,
        action_rows=[],
        currency=None,
        coverage_note="Finnhub daily candles do not include corporate action rows in this collector path.",
    )
