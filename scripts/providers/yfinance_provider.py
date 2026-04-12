from __future__ import annotations

from math import isnan

from .base import HistoryResult, ProfileResult

try:
    from sync_yfinance import load_yfinance, resolve_ticker_currency
except ModuleNotFoundError:
    from scripts.sync_yfinance import load_yfinance, resolve_ticker_currency


PROVIDER_ID = "yfinance"
PROVIDER_NAME = "Yahoo Finance (yfinance)"


def _clean_number(value) -> float | None:
    if value is None:
        return None

    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        return None

    if isnan(numeric_value):
        return None

    return numeric_value


def _index_date(index_value) -> str:
    if hasattr(index_value, "date"):
        return index_value.date().isoformat()
    return str(index_value)[:10]


def fetch_history(
    symbol: str,
    *,
    period: str | None = None,
    start: str | None = None,
    end: str | None = None,
) -> HistoryResult:
    try:
        yf = load_yfinance()
    except SystemExit as error:
        raise RuntimeError(
            "yfinance is not installed. Run ./.venv/bin/pip install -r requirements-sync.txt first.",
        ) from error

    ticker = yf.Ticker(symbol)
    history_kwargs = {
        "interval": "1d",
        "auto_adjust": False,
        "actions": True,
    }
    if start:
        history_kwargs["start"] = start
        if end:
            history_kwargs["end"] = end
    else:
        history_kwargs["period"] = period or "10y"
        if end:
            history_kwargs["end"] = end

    frame = ticker.history(**history_kwargs)
    if frame.empty:
        raise RuntimeError(f"yfinance returned no rows for symbol {symbol}.")

    if "Close" not in frame.columns:
        raise RuntimeError(
            f"Expected a Close column in the yfinance response for {symbol}.",
        )

    price_rows: list[dict] = []
    action_rows: list[dict] = []
    for index_value, row in frame.iterrows():
        close_value = _clean_number(row.get("Close"))
        if close_value is None:
            continue

        date_value = _index_date(index_value)
        price_rows.append(
            {
                "date": date_value,
                "open": _clean_number(row.get("Open")),
                "high": _clean_number(row.get("High")),
                "low": _clean_number(row.get("Low")),
                "close": close_value,
                "adjClose": _clean_number(row.get("Adj Close")),
                "volume": _clean_number(row.get("Volume")),
            },
        )

        dividend_value = _clean_number(row.get("Dividends"))
        if dividend_value:
            action_rows.append(
                {
                    "date": date_value,
                    "actionType": "dividend",
                    "value": dividend_value,
                },
            )

        split_value = _clean_number(row.get("Stock Splits"))
        if split_value:
            action_rows.append(
                {
                    "date": date_value,
                    "actionType": "split",
                    "value": split_value,
                },
            )

    if len(price_rows) < 2:
        raise RuntimeError(
            f"yfinance returned fewer than two usable rows for symbol {symbol}.",
        )

    return HistoryResult(
        provider=PROVIDER_ID,
        provider_name=PROVIDER_NAME,
        price_rows=price_rows,
        action_rows=action_rows,
        currency=resolve_ticker_currency(ticker),
    )


def fetch_profile(symbol: str) -> ProfileResult:
    try:
        yf = load_yfinance()
    except SystemExit as error:
        raise RuntimeError(
            "yfinance is not installed. Run ./.venv/bin/pip install -r requirements-sync.txt first.",
        ) from error

    ticker = yf.Ticker(symbol)
    try:
        try:
            info = ticker.get_info()
        except AttributeError:
            info = ticker.info
    except Exception as error:  # noqa: BLE001
        raise RuntimeError(
            f"Could not load yfinance profile for symbol {symbol}: {error}",
        ) from error

    if not isinstance(info, dict) or not info:
        raise RuntimeError(f"yfinance returned no profile data for symbol {symbol}.")

    return ProfileResult(
        provider=PROVIDER_ID,
        provider_name=PROVIDER_NAME,
        info=info,
    )
