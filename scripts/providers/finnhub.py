from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request

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


def _load_api_key() -> str:
    load_local_env()
    api_key = str(os.environ.get("FINNHUB_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("Finnhub API key is not configured.")
    return api_key


def _normalize_text(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").strip().lower()).strip()


def _normalize_company_name(value: str | None) -> str:
    normalized = _normalize_text(value)
    if not normalized:
        return ""

    stripped = _CORPORATE_SUFFIX_PATTERN.sub(" ", normalized)
    return re.sub(r"\s+", " ", stripped).strip()


def _match_kind_and_score(
    query: str,
    *,
    symbol: str,
    display_symbol: str,
    description: str,
    instrument_type: str,
) -> tuple[str, int] | None:
    normalized_query = _normalize_text(query)
    normalized_symbol = _normalize_text(symbol)
    normalized_display_symbol = _normalize_text(display_symbol)
    normalized_description = _normalize_text(description)
    normalized_company_name = _normalize_company_name(description)
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

    if normalized_description.startswith(normalized_query):
        return ("starts-with-description", 184 + type_bonus)

    if normalized_company_name.startswith(normalized_query):
        return ("starts-with-company", 180 + type_bonus)

    if (
        normalized_symbol.startswith(normalized_query)
        or normalized_display_symbol.startswith(normalized_query)
    ):
        return ("starts-with-symbol", 172 + type_bonus)

    if normalized_query in normalized_description:
        return ("contains-description", 146 + type_bonus)

    if normalized_query in normalized_symbol or normalized_query in normalized_display_symbol:
        return ("contains-symbol", 136 + type_bonus)

    return None


def search_symbols(query: str, *, limit: int = 8) -> list[dict]:
    normalized_query = _normalize_text(query)
    if len(normalized_query) < 2:
        return []

    api_key = _load_api_key()
    request_url = (
        f"{PROVIDER_BASE_URL}/search?q={urllib.parse.quote(query)}"
        f"&token={urllib.parse.quote(api_key)}"
    )
    request = urllib.request.Request(
        request_url,
        headers={
            "User-Agent": "IndexStudyLab/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))

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
