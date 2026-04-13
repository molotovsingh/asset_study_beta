from __future__ import annotations

try:
    from providers.finnhub import search_symbols as search_finnhub_symbols
except ModuleNotFoundError:
    from scripts.providers.finnhub import search_symbols as search_finnhub_symbols

from . import index_service, options_service


class UnknownApiRouteError(LookupError):
    pass


def get_yfinance_catalog(_request: dict) -> dict:
    return index_service.build_catalog_payload()


def post_symbols_discover(request: dict) -> dict:
    query = str(request.get("query") or "").strip()
    if len(query) < 2:
        raise ValueError("Enter at least two characters to search.")

    limit = int(request.get("limit") or 8)
    limit = max(1, min(limit, 12))
    warning = None
    try:
        results = search_finnhub_symbols(query, limit=limit)
    except RuntimeError as error:
        results = []
        warning = str(error)

    return {
        "query": query,
        "results": results,
        "warning": warning,
    }


def post_yfinance_instrument_profile(request: dict) -> dict:
    return index_service.build_instrument_profile_payload(request)


def post_yfinance_index_series(request: dict) -> dict:
    return index_service.build_index_series_payload(request)


def post_yfinance_monthly_straddle(request: dict) -> dict:
    return options_service.build_monthly_straddle_payload(request)


def post_options_screener_snapshot(request: dict) -> dict:
    return options_service.build_options_screener_snapshot_payload(request)


def post_options_screener_history(request: dict) -> dict:
    return options_service.build_options_screener_history_payload(request)


def post_options_screener_validation(request: dict) -> dict:
    return options_service.build_options_screener_validation_response(request)


GET_ROUTE_HANDLERS = {
    "/api/yfinance/catalog": get_yfinance_catalog,
}

POST_ROUTE_HANDLERS = {
    "/api/symbols/discover": post_symbols_discover,
    "/api/yfinance/instrument-profile": post_yfinance_instrument_profile,
    "/api/yfinance/index-series": post_yfinance_index_series,
    "/api/yfinance/monthly-straddle": post_yfinance_monthly_straddle,
    "/api/options/screener-snapshot": post_options_screener_snapshot,
    "/api/options/screener-history": post_options_screener_history,
    "/api/options/screener-validation": post_options_screener_validation,
}


def dispatch_request(method: str, path: str, request: dict | None = None) -> dict:
    normalized_method = str(method or "").upper()
    if normalized_method == "GET":
        handlers = GET_ROUTE_HANDLERS
    elif normalized_method == "POST":
        handlers = POST_ROUTE_HANDLERS
    else:
        raise UnknownApiRouteError("Unknown API endpoint.")

    handler = handlers.get(path)
    if handler is None:
        raise UnknownApiRouteError("Unknown API endpoint.")
    return handler(request or {})
