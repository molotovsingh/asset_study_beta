from __future__ import annotations

from .base import HistoryResult, ProfileResult
from .yahoo_finance15 import (
    PROVIDER_ID as YAHOO_FINANCE15_PROVIDER_ID,
    PROVIDER_NAME as YAHOO_FINANCE15_PROVIDER_NAME,
    fetch_history as fetch_yahoo_finance15_history,
    fetch_profile as fetch_yahoo_finance15_profile,
)
from .finnhub import (
    PROVIDER_ID as FINNHUB_PROVIDER_ID,
    PROVIDER_NAME as FINNHUB_PROVIDER_NAME,
)
from .yfinance_provider import (
    PROVIDER_ID as YFINANCE_PROVIDER_ID,
    PROVIDER_NAME as YFINANCE_PROVIDER_NAME,
    fetch_history as fetch_yfinance_history,
    fetch_profile as fetch_yfinance_profile,
)


PROVIDER_DISPLAY_NAMES = {
    FINNHUB_PROVIDER_ID: FINNHUB_PROVIDER_NAME,
    YFINANCE_PROVIDER_ID: YFINANCE_PROVIDER_NAME,
    YAHOO_FINANCE15_PROVIDER_ID: YAHOO_FINANCE15_PROVIDER_NAME,
}

HISTORY_FETCHERS = {
    YFINANCE_PROVIDER_ID: fetch_yfinance_history,
    YAHOO_FINANCE15_PROVIDER_ID: fetch_yahoo_finance15_history,
}

PROFILE_FETCHERS = {
    YFINANCE_PROVIDER_ID: fetch_yfinance_profile,
    YAHOO_FINANCE15_PROVIDER_ID: fetch_yahoo_finance15_profile,
}

DEFAULT_PROVIDER_ORDER = [
    YFINANCE_PROVIDER_ID,
    YAHOO_FINANCE15_PROVIDER_ID,
]


def normalize_provider_id(value: str | None) -> str | None:
    normalized = str(value or "").strip().lower()
    return normalized or None


def provider_display_name(value: str | None) -> str:
    provider_id = normalize_provider_id(value)
    return PROVIDER_DISPLAY_NAMES.get(provider_id, "Local market data")


def _ordered_provider_ids(preferred_provider: str | None) -> list[str]:
    preferred = normalize_provider_id(preferred_provider)
    ordered = []
    if preferred in DEFAULT_PROVIDER_ORDER:
        ordered.append(preferred)
    ordered.extend(
        provider_id
        for provider_id in DEFAULT_PROVIDER_ORDER
        if provider_id not in ordered
    )
    return ordered


def fetch_history_with_fallback(
    symbol: str,
    *,
    period: str | None = None,
    start: str | None = None,
    end: str | None = None,
    preferred_provider: str | None = None,
) -> HistoryResult:
    errors: list[str] = []
    for provider_id in _ordered_provider_ids(preferred_provider):
        fetcher = HISTORY_FETCHERS[provider_id]
        try:
            return fetcher(symbol, period=period, start=start, end=end)
        except Exception as error:  # noqa: BLE001
            errors.append(f"{provider_display_name(provider_id)}: {error}")

    details = " ".join(errors) if errors else "No providers were configured."
    raise RuntimeError(f"Could not load history for {symbol}. {details}")


def fetch_profile_with_fallback(
    symbol: str,
    *,
    preferred_provider: str | None = None,
) -> ProfileResult:
    errors: list[str] = []
    for provider_id in _ordered_provider_ids(preferred_provider):
        fetcher = PROFILE_FETCHERS[provider_id]
        try:
            return fetcher(symbol)
        except Exception as error:  # noqa: BLE001
            errors.append(f"{provider_display_name(provider_id)}: {error}")

    details = " ".join(errors) if errors else "No providers were configured."
    raise RuntimeError(f"Could not load profile for {symbol}. {details}")
