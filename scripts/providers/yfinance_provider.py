from __future__ import annotations

from datetime import date, datetime, timezone
from math import log, pi, sqrt
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


def is_standard_monthly_expiry(expiry_value: str) -> bool:
    try:
        expiry_date = datetime.strptime(str(expiry_value), "%Y-%m-%d").date()
    except ValueError:
        return False
    return 15 <= expiry_date.day <= 21 and expiry_date.weekday() in (3, 4)


def approximate_annualized_implied_volatility(
    implied_move_percent: float | None,
    days_to_expiry: int | float,
) -> float | None:
    if implied_move_percent is None:
        return None
    if not isinstance(days_to_expiry, (int, float)) or days_to_expiry <= 0:
        return None
    return (
        float(implied_move_percent)
        / sqrt(2 / pi)
        / sqrt(float(days_to_expiry) / 365)
    )


def _mid_or_last_price(
    bid: float | None,
    ask: float | None,
    last_price: float | None,
) -> tuple[float | None, str]:
    if bid is not None and ask is not None and bid > 0 and ask > 0:
        return (bid + ask) / 2.0, "mid"
    if last_price is not None and last_price > 0:
        return last_price, "last"
    return None, "none"


def compute_annualized_realized_volatility(
    close_values: list[float],
    window_days: int,
) -> float | None:
    if window_days <= 1 or len(close_values) < window_days + 1:
        return None

    window_prices = close_values[-(window_days + 1) :]
    log_returns: list[float] = []
    for previous_close, current_close in zip(window_prices, window_prices[1:]):
        if previous_close <= 0 or current_close <= 0:
            return None
        log_returns.append(log(current_close / previous_close))

    if len(log_returns) < 2:
        return None

    mean_return = sum(log_returns) / len(log_returns)
    variance = sum(
        (daily_return - mean_return) ** 2 for daily_return in log_returns
    ) / (len(log_returns) - 1)
    return sqrt(variance) * sqrt(252)


def summarize_realized_volatility(history_frame) -> dict:
    series_name = "Adj Close" if "Adj Close" in history_frame.columns else "Close"
    close_series = history_frame[series_name].dropna()
    close_values = [_clean_number(value) for value in close_series.tolist()]
    normalized_closes = [value for value in close_values if value is not None and value > 0]
    return {
        "seriesType": "adj_close" if series_name == "Adj Close" else "close",
        "observations": len(normalized_closes),
        "startDate": (
            _index_date(close_series.index[0]) if not close_series.empty else None
        ),
        "endDate": (
            _index_date(close_series.index[-1]) if not close_series.empty else None
        ),
        "hv20": compute_annualized_realized_volatility(normalized_closes, 20),
        "hv60": compute_annualized_realized_volatility(normalized_closes, 60),
        "hv120": compute_annualized_realized_volatility(normalized_closes, 120),
    }


def _load_ticker(symbol: str):
    try:
        yf = load_yfinance()
    except SystemExit as error:
        raise RuntimeError(
            "yfinance is not installed. Run ./.venv/bin/pip install -r requirements-sync.txt first.",
        ) from error
    return yf.Ticker(symbol)


def fetch_monthly_straddle_snapshot(
    symbol: str,
    *,
    minimum_dte: int = 25,
    max_contracts: int = 4,
) -> dict:
    ticker = _load_ticker(symbol)
    history_frame = ticker.history(period="1y", auto_adjust=False)
    if history_frame.empty or "Close" not in history_frame.columns:
        raise RuntimeError(f"yfinance returned no recent price data for symbol {symbol}.")

    latest_close = _clean_number(history_frame["Close"].dropna().iloc[-1])
    if latest_close is None or latest_close <= 0:
        raise RuntimeError(f"Could not determine a spot price for {symbol}.")

    spot_date = _index_date(history_frame.index[-1])
    realized_volatility = summarize_realized_volatility(history_frame)
    as_of_date = datetime.now(timezone.utc).date()
    expiry_values = list(ticker.options or [])
    monthly_expiries = []
    for expiry_value in expiry_values:
        if not is_standard_monthly_expiry(expiry_value):
            continue
        expiry_date = datetime.strptime(str(expiry_value), "%Y-%m-%d").date()
        days_to_expiry = (expiry_date - as_of_date).days
        if days_to_expiry < minimum_dte:
            continue
        monthly_expiries.append((expiry_value, expiry_date, days_to_expiry))

    if not monthly_expiries:
        raise RuntimeError(
            f"No standard monthly expiries with at least {minimum_dte} days to expiry were available for {symbol}.",
        )

    contracts = []
    for expiry_text, expiry_date, days_to_expiry in monthly_expiries[: max(1, max_contracts)]:
        chain = ticker.option_chain(expiry_text)
        calls = chain.calls.copy()
        puts = chain.puts.copy()
        if calls.empty or puts.empty:
            continue

        calls = calls.rename(
            columns={
                "bid": "callBid",
                "ask": "callAsk",
                "lastPrice": "callLastPrice",
                "openInterest": "callOpenInterest",
                "volume": "callVolume",
                "impliedVolatility": "callImpliedVolatility",
            },
        )
        puts = puts.rename(
            columns={
                "bid": "putBid",
                "ask": "putAsk",
                "lastPrice": "putLastPrice",
                "openInterest": "putOpenInterest",
                "volume": "putVolume",
                "impliedVolatility": "putImpliedVolatility",
            },
        )
        merged = calls.merge(
            puts,
            on="strike",
            how="inner",
            suffixes=("_call", "_put"),
        )
        if merged.empty:
            continue

        merged["distance"] = (merged["strike"] - latest_close).abs()
        merged["combinedOpenInterest"] = (
            merged["callOpenInterest"].fillna(0) + merged["putOpenInterest"].fillna(0)
        )
        merged["combinedVolume"] = (
            merged["callVolume"].fillna(0) + merged["putVolume"].fillna(0)
        )
        merged = merged.sort_values(
            ["distance", "combinedOpenInterest", "combinedVolume"],
            ascending=[True, False, False],
        )

        selected_row = None
        selected_call_mid = None
        selected_put_mid = None
        selected_call_source = "none"
        selected_put_source = "none"
        for _, row in merged.iterrows():
            call_mid, call_source = _mid_or_last_price(
                _clean_number(row.get("callBid")),
                _clean_number(row.get("callAsk")),
                _clean_number(row.get("callLastPrice")),
            )
            put_mid, put_source = _mid_or_last_price(
                _clean_number(row.get("putBid")),
                _clean_number(row.get("putAsk")),
                _clean_number(row.get("putLastPrice")),
            )
            if call_mid is None or put_mid is None:
                continue
            selected_row = row
            selected_call_mid = call_mid
            selected_put_mid = put_mid
            selected_call_source = call_source
            selected_put_source = put_source
            break

        if selected_row is None:
            continue

        strike = _clean_number(selected_row.get("strike"))
        call_bid = _clean_number(selected_row.get("callBid"))
        call_ask = _clean_number(selected_row.get("callAsk"))
        put_bid = _clean_number(selected_row.get("putBid"))
        put_ask = _clean_number(selected_row.get("putAsk"))
        straddle_mid = selected_call_mid + selected_put_mid
        implied_move_percent = straddle_mid / latest_close if latest_close > 0 else None
        straddle_implied_vol = approximate_annualized_implied_volatility(
            implied_move_percent,
            days_to_expiry,
        )
        call_iv = _clean_number(selected_row.get("callImpliedVolatility"))
        put_iv = _clean_number(selected_row.get("putImpliedVolatility"))
        chain_iv = None
        if call_iv is not None and put_iv is not None:
            chain_iv = (call_iv + put_iv) / 2.0
        hv20 = realized_volatility["hv20"]
        hv60 = realized_volatility["hv60"]
        hv120 = realized_volatility["hv120"]

        contracts.append(
            {
                "expiry": expiry_text,
                "daysToExpiry": int(days_to_expiry),
                "strike": strike,
                "callBid": call_bid,
                "callAsk": call_ask,
                "callLastPrice": _clean_number(selected_row.get("callLastPrice")),
                "callMidPrice": selected_call_mid,
                "callPriceSource": selected_call_source,
                "callOpenInterest": int(_clean_number(selected_row.get("callOpenInterest")) or 0),
                "callVolume": int(_clean_number(selected_row.get("callVolume")) or 0),
                "callImpliedVolatility": call_iv,
                "callSpread": (call_ask - call_bid)
                if call_bid is not None and call_ask is not None
                else None,
                "putBid": put_bid,
                "putAsk": put_ask,
                "putLastPrice": _clean_number(selected_row.get("putLastPrice")),
                "putMidPrice": selected_put_mid,
                "putPriceSource": selected_put_source,
                "putOpenInterest": int(_clean_number(selected_row.get("putOpenInterest")) or 0),
                "putVolume": int(_clean_number(selected_row.get("putVolume")) or 0),
                "putImpliedVolatility": put_iv,
                "putSpread": (put_ask - put_bid)
                if put_bid is not None and put_ask is not None
                else None,
                "straddleMidPrice": straddle_mid,
                "impliedMovePrice": straddle_mid,
                "impliedMovePercent": implied_move_percent,
                "straddleImpliedVolatility": straddle_implied_vol,
                "chainImpliedVolatility": chain_iv,
                "impliedVolatilityGap": (
                    straddle_implied_vol - chain_iv
                    if straddle_implied_vol is not None and chain_iv is not None
                    else None
                ),
                "historicalVolatility20": hv20,
                "historicalVolatility60": hv60,
                "historicalVolatility120": hv120,
                "ivHv20Ratio": (
                    straddle_implied_vol / hv20
                    if straddle_implied_vol is not None and hv20 not in (None, 0)
                    else None
                ),
                "ivHv60Ratio": (
                    straddle_implied_vol / hv60
                    if straddle_implied_vol is not None and hv60 not in (None, 0)
                    else None
                ),
                "ivHv120Ratio": (
                    straddle_implied_vol / hv120
                    if straddle_implied_vol is not None and hv120 not in (None, 0)
                    else None
                ),
                "ivHv20Spread": (
                    straddle_implied_vol - hv20
                    if straddle_implied_vol is not None and hv20 is not None
                    else None
                ),
                "ivHv60Spread": (
                    straddle_implied_vol - hv60
                    if straddle_implied_vol is not None and hv60 is not None
                    else None
                ),
                "ivHv120Spread": (
                    straddle_implied_vol - hv120
                    if straddle_implied_vol is not None and hv120 is not None
                    else None
                ),
                "combinedOpenInterest": int(_clean_number(selected_row.get("combinedOpenInterest")) or 0),
                "combinedVolume": int(_clean_number(selected_row.get("combinedVolume")) or 0),
                "pricingMode": (
                    "bid-ask-mid"
                    if selected_call_source == "mid" and selected_put_source == "mid"
                    else "mixed"
                ),
            },
        )

    if not contracts:
        raise RuntimeError(
            f"Could not build any liquid monthly straddle rows for {symbol}.",
        )

    return {
        "symbol": symbol,
        "provider": PROVIDER_ID,
        "providerName": PROVIDER_NAME,
        "currency": resolve_ticker_currency(ticker),
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "asOfDate": as_of_date.isoformat(),
        "spotDate": spot_date,
        "spotPrice": latest_close,
        "minimumDte": int(minimum_dte),
        "maxContracts": int(max_contracts),
        "realizedVolatility": realized_volatility,
        "monthlyContracts": contracts,
        "note": (
            "Live options snapshot using current monthly contracts only. "
            "This is suitable for current term-structure reads, not historical backtests."
        ),
    }


def fetch_history(
    symbol: str,
    *,
    period: str | None = None,
    start: str | None = None,
    end: str | None = None,
) -> HistoryResult:
    ticker = _load_ticker(symbol)
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
    ticker = _load_ticker(symbol)
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
