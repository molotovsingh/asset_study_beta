from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request

from .base import HistoryResult, ProfileResult

try:
    from env_utils import load_local_env
except ModuleNotFoundError:
    from scripts.env_utils import load_local_env


PROVIDER_ID = "yahoo_finance15"
PROVIDER_NAME = "Yahoo Finance 15 (RapidAPI)"
PROVIDER_HOST = "yahoo-finance15.p.rapidapi.com"
PROVIDER_BASE_URL = f"https://{PROVIDER_HOST}"


def _load_api_key() -> str:
    load_local_env()
    api_key = str(
        os.environ.get("YAHOO_FINANCE15_RAPIDAPI_KEY")
        or os.environ.get("RAPIDAPI_KEY")
        or "",
    ).strip()
    if not api_key:
        raise RuntimeError("RapidAPI key is not configured for yahoo-finance15.")
    return api_key


def _request_json(path: str, *, timeout: int = 60):
    request = urllib.request.Request(
        f"{PROVIDER_BASE_URL}{path}",
        headers={
            "x-rapidapi-host": PROVIDER_HOST,
            "x-rapidapi-key": _load_api_key(),
            "User-Agent": "IndexStudyLab/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _quote_body(symbol: str) -> dict:
    payload = _request_json(
        f"/api/yahoo/qu/quote/{urllib.parse.quote(symbol, safe='')}",
    )
    body = payload.get("body")
    if not isinstance(body, list) or not body or not isinstance(body[0], dict):
        raise RuntimeError(f"yahoo-finance15 returned no quote payload for {symbol}.")
    return body[0]


def _normalize_history_body(symbol: str, body) -> list[dict]:
    if not isinstance(body, dict) or not body:
        raise RuntimeError(f"yahoo-finance15 returned no history body for {symbol}.")

    rows: list[dict] = []
    for raw_row in body.values():
        if not isinstance(raw_row, dict):
            continue
        date_value = str(raw_row.get("date") or "")[:10]
        close_value = raw_row.get("close")
        if not date_value or close_value is None:
            continue
        rows.append(
            {
                "date": date_value,
                "open": raw_row.get("open"),
                "high": raw_row.get("high"),
                "low": raw_row.get("low"),
                "close": raw_row.get("close"),
                "adjClose": raw_row.get("adjclose"),
                "volume": raw_row.get("volume"),
            },
        )

    rows.sort(key=lambda row: row["date"])
    if len(rows) < 2:
        raise RuntimeError(f"yahoo-finance15 returned fewer than two usable rows for {symbol}.")
    return rows


def fetch_history(
    symbol: str,
    *,
    period: str | None = None,
    start: str | None = None,
    end: str | None = None,
) -> HistoryResult:
    del period
    payload = _request_json(
        f"/api/yahoo/hi/history/{urllib.parse.quote(symbol, safe='')}/1d",
        timeout=90,
    )
    rows = _normalize_history_body(symbol, payload.get("body"))
    if start:
        rows = [row for row in rows if row["date"] >= start]
    if end:
        rows = [row for row in rows if row["date"] <= end]
    if len(rows) < 2:
        raise RuntimeError(
            f"yahoo-finance15 did not return enough daily rows for {symbol} after date filtering.",
        )

    quote = _quote_body(symbol)
    return HistoryResult(
        provider=PROVIDER_ID,
        provider_name=PROVIDER_NAME,
        price_rows=rows,
        action_rows=[],
        currency=str(quote.get("currency") or "").strip().upper() or None,
        coverage_note="Fallback provider returned its default daily history window.",
    )


def fetch_profile(symbol: str) -> ProfileResult:
    quote = _quote_body(symbol)
    raw_info = {
        "quoteType": quote.get("quoteType") or quote.get("typeDisp"),
        "shortName": quote.get("shortName"),
        "longName": quote.get("longName") or quote.get("shortName"),
        "exchange": quote.get("exchange"),
        "fullExchangeName": quote.get("exchangeName") or quote.get("exchange"),
        "currency": quote.get("currency"),
        "marketCap": quote.get("marketCap"),
        "beta": quote.get("beta"),
        "trailingPE": quote.get("trailingPE"),
        "forwardPE": quote.get("forwardPE"),
        "priceToBook": quote.get("priceToBook"),
        "dividendYield": quote.get("dividendYield"),
        "regularMarketPrice": quote.get("regularMarketPrice"),
    }
    return ProfileResult(
        provider=PROVIDER_ID,
        provider_name=PROVIDER_NAME,
        info=raw_info,
    )
