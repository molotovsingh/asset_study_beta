from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable

try:
    import runtime_store
    from providers import finnhub
except ModuleNotFoundError:
    from scripts import runtime_store
    from scripts.providers import finnhub

from . import index_service, options_service


INSTRUMENT_DISCOVERY_VERSION = "instrument-discovery-v1"
INSTRUMENT_VERIFICATION_VERSION = "instrument-verification-v1"
INSTRUMENT_REGISTRY_HEALTH_VERSION = "instrument-registry-health-v1"

CAPABILITY_KEYS = (
    "priceHistory",
    "profile",
    "fundamentals",
    "optionsUnderlying",
    "optionContract",
    "cryptoHistory",
)

BUILTIN_INSTRUMENTS = [
    {
        "id": "nifty-50",
        "label": "Nifty 50",
        "symbol": "^NSEI",
        "assetClass": "index",
        "exchange": "NSE",
        "mic": "XNSE",
        "currency": "INR",
        "country": "IN",
        "provider": "yfinance",
        "providerName": "Yahoo Finance (yfinance)",
        "aliases": ["nifty", "nifty fifty", "nifty50"],
    },
    {
        "id": "nifty-bank",
        "label": "Nifty Bank",
        "symbol": "^NSEBANK",
        "assetClass": "index",
        "exchange": "NSE",
        "mic": "XNSE",
        "currency": "INR",
        "country": "IN",
        "provider": "yfinance",
        "providerName": "Yahoo Finance (yfinance)",
        "aliases": ["bank nifty", "banknifty", "nifty bank"],
    },
    {
        "id": "nifty-500",
        "label": "Nifty 500",
        "symbol": "^CRSLDX",
        "assetClass": "index",
        "exchange": "NSE",
        "mic": "XNSE",
        "currency": "INR",
        "country": "IN",
        "provider": "yfinance",
        "providerName": "Yahoo Finance (yfinance)",
        "aliases": ["nifty500", "nifty broad 500"],
    },
    {
        "id": "nifty-realty",
        "label": "Nifty Realty",
        "symbol": "^CNXREALTY",
        "assetClass": "index",
        "exchange": "NSE",
        "mic": "XNSE",
        "currency": "INR",
        "country": "IN",
        "provider": "yfinance",
        "providerName": "Yahoo Finance (yfinance)",
        "aliases": ["nifty realty", "nifty real estate"],
    },
    {
        "id": "nifty-metal",
        "label": "Nifty Metal",
        "symbol": "^CNXMETAL",
        "assetClass": "index",
        "exchange": "NSE",
        "mic": "XNSE",
        "currency": "INR",
        "country": "IN",
        "provider": "yfinance",
        "providerName": "Yahoo Finance (yfinance)",
        "aliases": ["nifty metals", "nifty metal index"],
    },
    {
        "id": "nifty-energy",
        "label": "Nifty Energy",
        "symbol": "^CNXENERGY",
        "assetClass": "index",
        "exchange": "NSE",
        "mic": "XNSE",
        "currency": "INR",
        "country": "IN",
        "provider": "yfinance",
        "providerName": "Yahoo Finance (yfinance)",
        "aliases": ["nifty energy index"],
    },
    {
        "id": "nifty-it",
        "label": "Nifty IT",
        "symbol": "^CNXIT",
        "assetClass": "index",
        "exchange": "NSE",
        "mic": "XNSE",
        "currency": "INR",
        "country": "IN",
        "provider": "yfinance",
        "providerName": "Yahoo Finance (yfinance)",
        "aliases": ["nifty information technology", "nifty technology"],
    },
    {
        "id": "sensex",
        "label": "S&P BSE Sensex",
        "symbol": "^BSESN",
        "assetClass": "index",
        "exchange": "BSE",
        "mic": "XBOM",
        "currency": "INR",
        "country": "IN",
        "provider": "yfinance",
        "providerName": "Yahoo Finance (yfinance)",
        "aliases": ["sensex", "bse sensex"],
    },
    {
        "id": "sp-500",
        "label": "S&P 500",
        "symbol": "^GSPC",
        "assetClass": "index",
        "exchange": "CBOE",
        "mic": "XCBO",
        "currency": "USD",
        "country": "US",
        "provider": "yfinance",
        "providerName": "Yahoo Finance (yfinance)",
        "aliases": ["s&p500", "sp500", "s and p 500"],
    },
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_text(value) -> str:
    return str(value or "").strip()


def _normalize_capability(value: str | None) -> str:
    normalized = _clean_text(value) or "priceHistory"
    if normalized not in CAPABILITY_KEYS:
        raise ValueError(f"Unsupported symbol capability: {normalized}")
    return normalized


def _capabilities(**overrides) -> dict:
    payload = {key: False for key in CAPABILITY_KEYS}
    payload.update({key: bool(value) for key, value in overrides.items() if key in payload})
    return payload


def _infer_asset_class(symbol: str, hint: str | None = None) -> str:
    normalized_hint = _clean_text(hint).lower()
    if normalized_hint in {"equity", "etf", "fund", "index", "crypto", "option", "future"}:
        return normalized_hint
    lower_symbol = _clean_text(symbol).lower()
    if lower_symbol.endswith("-usd") or lower_symbol.endswith("usd") and len(lower_symbol) <= 8:
        return "crypto"
    if _clean_text(symbol).startswith("^"):
        return "index"
    if "etf" in normalized_hint:
        return "etf"
    if "fund" in normalized_hint:
        return "fund"
    if "index" in normalized_hint:
        return "index"
    return "equity"


def _subject_query(label: str | None, symbol: str) -> str:
    clean_label = _clean_text(label)
    clean_symbol = _clean_text(symbol)
    if clean_label and clean_label != clean_symbol:
        return f"{clean_label} | {clean_symbol}"
    return clean_symbol or clean_label


def _selection_payload(*, label: str | None, symbol: str, verified: bool, instrument: dict | None = None) -> dict:
    subject_query = _subject_query(label, symbol)
    return {
        "subjectQuery": subject_query,
        "inputValue": subject_query,
        "label": _clean_text(label) or _clean_text(symbol),
        "symbol": _clean_text(symbol),
        "verified": bool(verified),
        "instrumentId": instrument.get("instrumentId") if instrument else None,
    }


def _mapping_to_result(
    *,
    instrument: dict,
    mapping: dict | None,
    match_kind: str,
    match_score: int,
    aliases: list[str] | None = None,
) -> dict:
    capabilities = _capabilities(**(mapping.get("capabilities") if mapping else {}))
    verified = bool(mapping and mapping.get("verificationStatus") == "verified")
    symbol = mapping.get("providerSymbol") if mapping else instrument.get("symbol")
    provider = mapping.get("provider") if mapping else None
    provider_name = mapping.get("providerName") if mapping else None
    return {
        "kind": "registry",
        "instrumentId": instrument["instrumentId"],
        "label": instrument.get("label") or symbol,
        "symbol": symbol,
        "displaySymbol": symbol,
        "subjectQuery": _subject_query(instrument.get("label"), symbol),
        "provider": provider,
        "providerName": provider_name,
        "family": instrument.get("assetClass"),
        "assetClass": instrument.get("assetClass"),
        "exchange": mapping.get("exchange") if mapping else instrument.get("exchange"),
        "mic": mapping.get("mic") if mapping else instrument.get("mic"),
        "currency": mapping.get("currency") if mapping else instrument.get("currency"),
        "country": mapping.get("country") if mapping else instrument.get("country"),
        "capabilities": capabilities,
        "verified": verified,
        "verificationStatus": mapping.get("verificationStatus") if mapping else instrument.get("verificationStatus"),
        "aliases": aliases or [],
        "matchKind": match_kind,
        "matchScore": match_score,
    }


def _provider_result_to_candidate(result: dict) -> dict:
    symbol = _clean_text(result.get("symbol") or result.get("displaySymbol"))
    label = _clean_text(result.get("label") or result.get("description") or symbol)
    asset_class = _infer_asset_class(symbol, result.get("family") or result.get("type"))
    return {
        **result,
        "kind": "provider",
        "label": label or symbol,
        "symbol": symbol,
        "displaySymbol": _clean_text(result.get("displaySymbol") or symbol),
        "subjectQuery": symbol,
        "provider": result.get("provider") or "finnhub",
        "providerName": result.get("providerName") or "Finnhub",
        "assetClass": asset_class,
        "family": result.get("family") or asset_class,
        "capabilities": _capabilities(),
        "verified": False,
        "verificationStatus": "unverified",
    }


def seed_builtin_instruments() -> dict:
    added_or_updated = 0
    for entry in BUILTIN_INSTRUMENTS:
        instrument = runtime_store.upsert_instrument(
            canonical_symbol=entry["symbol"],
            label=entry["label"],
            asset_class=entry["assetClass"],
            exchange=entry.get("exchange"),
            mic=entry.get("mic"),
            currency=entry.get("currency"),
            country=entry.get("country"),
            status="active",
            verification_status="verified",
            metadata={
                "builtinId": entry["id"],
                "source": "builtin-index-catalog",
            },
        )
        runtime_store.upsert_instrument_provider_mapping(
            instrument_id=instrument["instrumentId"],
            provider=entry.get("provider") or "yfinance",
            provider_symbol=entry["symbol"],
            provider_name=entry.get("providerName"),
            asset_class=entry["assetClass"],
            exchange=entry.get("exchange"),
            mic=entry.get("mic"),
            currency=entry.get("currency"),
            country=entry.get("country"),
            capabilities=_capabilities(priceHistory=True),
            verification_status="verified",
            verified_at=_now_iso(),
            last_checked_at=_now_iso(),
            metadata={"source": "builtin-index-catalog"},
        )
        runtime_store.sync_instrument_aliases(
            instrument["instrumentId"],
            [entry["label"], entry["symbol"], *(entry.get("aliases") or [])],
            source="builtin",
        )
        added_or_updated += 1
    return {"seeded": added_or_updated}


def _has_strong_verified_local_match(results: list[dict]) -> bool:
    return any(
        result.get("verified") is True and int(result.get("matchScore") or 0) >= 220
        for result in results
    )


def build_symbol_discovery_payload(request: dict) -> dict:
    query = _clean_text((request or {}).get("query"))
    if len(query) < 2:
        raise ValueError("Enter at least two characters to search.")

    try:
        limit = int((request or {}).get("limit") or 8)
    except (TypeError, ValueError) as error:
        raise ValueError("limit must be an integer.") from error
    limit = max(1, min(limit, 12))

    seed_builtin_instruments()
    local_rows = runtime_store.search_instruments(query, limit=limit)
    local_results = [
        _mapping_to_result(
            instrument=row["instrument"],
            mapping=row.get("mapping"),
            aliases=row.get("aliases") or [],
            match_kind=row["matchKind"],
            match_score=int(row["matchScore"]),
        )
        for row in local_rows
    ]

    warning = None
    provider_results: list[dict] = []
    if len(local_results) < limit and not _has_strong_verified_local_match(local_results):
        try:
            provider_results = [
                _provider_result_to_candidate(result)
                for result in finnhub.search_symbols(query, limit=limit)
            ]
        except RuntimeError as error:
            warning = str(error)

    combined: dict[str, dict] = {}
    for result in [*local_results, *provider_results]:
        key = "|".join(
            [
                _clean_text(result.get("provider") or "registry").lower(),
                _clean_text(result.get("symbol")).lower(),
            ]
        )
        current = combined.get(key)
        if not current or int(result.get("matchScore") or 0) > int(current.get("matchScore") or 0):
            combined[key] = result

    results = sorted(
        combined.values(),
        key=lambda result: (
            -int(result.get("matchScore") or 0),
            0 if result.get("verified") else 1,
            len(_clean_text(result.get("label"))),
            _clean_text(result.get("symbol")),
        ),
    )[:limit]

    runtime_store.record_instrument_discovery_event(
        event_kind="discover",
        query=query,
        provider="registry+finnhub",
        candidates=results,
        failure_reason=warning,
    )
    return {
        "version": INSTRUMENT_DISCOVERY_VERSION,
        "query": query,
        "results": results,
        "warning": warning,
    }


def _build_verified_payload(
    *,
    request: dict,
    required_capability: str,
    symbol: str,
    label: str | None,
    provider: str,
    provider_name: str,
    asset_class: str,
    capabilities: dict,
    verification_metadata: dict,
    cache_status: str | None = None,
) -> dict:
    now = _now_iso()
    instrument = runtime_store.upsert_instrument(
        canonical_symbol=symbol,
        label=label or symbol,
        asset_class=asset_class,
        exchange=request.get("exchange"),
        mic=request.get("mic"),
        currency=request.get("currency") or verification_metadata.get("currency"),
        country=request.get("country"),
        status="active",
        verification_status="verified",
        metadata={
            "source": "verified-discovery",
            "query": request.get("query"),
            **{key: value for key, value in verification_metadata.items() if key != "rawSnapshot"},
        },
    )
    mapping = runtime_store.upsert_instrument_provider_mapping(
        instrument_id=instrument["instrumentId"],
        provider=provider,
        provider_symbol=symbol,
        provider_name=provider_name,
        asset_class=asset_class,
        exchange=request.get("exchange"),
        mic=request.get("mic"),
        currency=request.get("currency") or verification_metadata.get("currency"),
        country=request.get("country"),
        capabilities=capabilities,
        verification_status="verified",
        verified_at=now,
        last_checked_at=now,
        metadata={
            "requiredCapability": required_capability,
            "cacheStatus": cache_status,
            **{key: value for key, value in verification_metadata.items() if key != "rawSnapshot"},
        },
    )
    request_aliases = request.get("aliases") if isinstance(request.get("aliases"), list) else []
    aliases = [
        alias
        for alias in [
            label,
            symbol,
            request.get("query"),
            request.get("displaySymbol"),
            *request_aliases,
        ]
        if _clean_text(alias)
    ]
    runtime_store.sync_instrument_aliases(
        instrument["instrumentId"],
        aliases,
        source="manual" if request.get("manual") else "verified",
    )
    payload = {
        "version": INSTRUMENT_VERIFICATION_VERSION,
        "verified": True,
        "requiredCapability": required_capability,
        "capabilities": capabilities,
        "instrument": instrument,
        "mapping": mapping,
        "selection": _selection_payload(label=label, symbol=symbol, verified=True, instrument=instrument),
        "cacheStatus": cache_status,
        "verifiedAt": now,
        "failureReason": None,
    }
    runtime_store.record_instrument_discovery_event(
        event_kind="register-manual" if request.get("manual") else "verify",
        query=request.get("query") or symbol,
        provider=provider,
        selected_instrument_id=instrument["instrumentId"],
        selected_mapping_id=mapping["mappingId"],
        verification_result={
            "verified": True,
            "requiredCapability": required_capability,
            "capabilities": capabilities,
        },
    )
    return payload


def _build_unverified_payload(
    *,
    request: dict,
    required_capability: str,
    symbol: str,
    label: str | None,
    failure_reason: str,
    provider: str | None = None,
) -> dict:
    capabilities = _capabilities()
    payload = {
        "version": INSTRUMENT_VERIFICATION_VERSION,
        "verified": False,
        "requiredCapability": required_capability,
        "capabilities": capabilities,
        "instrument": None,
        "mapping": None,
        "selection": _selection_payload(label=label, symbol=symbol, verified=False),
        "cacheStatus": None,
        "verifiedAt": None,
        "failureReason": failure_reason,
    }
    runtime_store.record_instrument_discovery_event(
        event_kind="register-manual" if request.get("manual") else "verify",
        query=request.get("query") or symbol,
        provider=provider,
        verification_result={
            "verified": False,
            "requiredCapability": required_capability,
            "capabilities": capabilities,
        },
        failure_reason=failure_reason,
    )
    return payload


def _verify_price_history(symbol: str, preferred_provider: str | None) -> tuple[dict, str | None]:
    snapshot, cache_status = index_service.get_or_refresh_cached_series(
        symbol,
        preferred_provider=preferred_provider,
    )
    observations = int((snapshot.get("range") or {}).get("observations") or 0)
    if observations < 2:
        raise RuntimeError(f"No usable price history found for {symbol}.")
    return snapshot, cache_status


def _verification_runner(required_capability: str) -> Callable[[str, dict], tuple[dict, str | None, str, str]]:
    def verify_price(symbol: str, request: dict) -> tuple[dict, str | None, str, str]:
        preferred_provider = _clean_text(request.get("preferredProvider")) or "yfinance"
        snapshot, cache_status = _verify_price_history(symbol, preferred_provider)
        provider = _clean_text(snapshot.get("provider")) or preferred_provider
        provider_name = _clean_text(snapshot.get("providerName")) or "Yahoo Finance (yfinance)"
        return snapshot, cache_status, provider, provider_name

    def verify_profile(symbol: str, _request: dict) -> tuple[dict, str | None, str, str]:
        profile, cache_status = index_service.get_or_refresh_instrument_profile(symbol)
        if not profile:
            raise RuntimeError(f"No usable profile found for {symbol}.")
        return profile, cache_status, "yfinance", profile.get("providerName") or "Yahoo Finance (yfinance)"

    def verify_fundamentals(symbol: str, _request: dict) -> tuple[dict, str | None, str, str]:
        payload = finnhub.fetch_basic_financials(symbol)
        return payload, None, "finnhub", "Finnhub"

    def verify_options_underlying(symbol: str, _request: dict) -> tuple[dict, str | None, str, str]:
        payload = options_service.fetch_monthly_straddle_snapshot(
            symbol,
            minimum_dte=1,
            max_contracts=1,
        )
        return payload, None, payload.get("provider") or "yfinance", payload.get("providerName") or "Yahoo Finance (yfinance)"

    def verify_option_contract(symbol: str, request: dict) -> tuple[dict, str | None, str, str]:
        expiry = _clean_text(request.get("expiry"))
        strike = request.get("strike")
        if not expiry or strike in {None, ""}:
            raise ValueError("expiry and strike are required for optionContract verification.")
        payload = options_service.fetch_exact_contract_quote(
            symbol,
            expiry=expiry,
            strike=float(strike),
        )
        return payload, None, payload.get("provider") or "yfinance", payload.get("providerName") or "Yahoo Finance (yfinance)"

    runners = {
        "priceHistory": verify_price,
        "cryptoHistory": verify_price,
        "profile": verify_profile,
        "fundamentals": verify_fundamentals,
        "optionsUnderlying": verify_options_underlying,
        "optionContract": verify_option_contract,
    }
    return runners[required_capability]


def build_symbol_verification_payload(request: dict) -> dict:
    if not isinstance(request, dict):
        raise ValueError("Symbol verification request must be a JSON object.")

    required_capability = _normalize_capability(request.get("requiredCapability"))
    symbol = _clean_text(
        request.get("symbol")
        or request.get("providerSymbol")
        or request.get("displaySymbol")
        or request.get("query")
    )
    if not symbol:
        raise ValueError("symbol or query is required for verification.")

    label = _clean_text(request.get("label") or request.get("description")) or symbol
    asset_class = _infer_asset_class(symbol, request.get("assetClass") or request.get("family"))
    if required_capability == "cryptoHistory":
        asset_class = "crypto"

    try:
        verification_payload, cache_status, provider, provider_name = _verification_runner(required_capability)(
            symbol,
            request,
        )
    except Exception as error:  # noqa: BLE001 - response records typed provider failures
        return _build_unverified_payload(
            request=request,
            required_capability=required_capability,
            symbol=symbol,
            label=label,
            failure_reason=str(error),
            provider=_clean_text(request.get("preferredProvider")) or None,
        )

    capabilities = _capabilities(**{required_capability: True})
    if required_capability == "cryptoHistory":
        capabilities["priceHistory"] = True
    if required_capability == "priceHistory" and asset_class == "crypto":
        capabilities["cryptoHistory"] = True

    return _build_verified_payload(
        request=request,
        required_capability=required_capability,
        symbol=symbol,
        label=label,
        provider=provider,
        provider_name=provider_name,
        asset_class=asset_class,
        capabilities=capabilities,
        verification_metadata={
            "currency": verification_payload.get("currency"),
            "range": verification_payload.get("range"),
            "generatedAt": verification_payload.get("generatedAt") or verification_payload.get("fetchedAt"),
            "rawSnapshot": verification_payload,
        },
        cache_status=cache_status,
    )


def build_manual_symbol_registration_payload(request: dict) -> dict:
    if not isinstance(request, dict):
        raise ValueError("Manual symbol registration request must be a JSON object.")
    label = _clean_text(request.get("label"))
    symbol = _clean_text(request.get("symbol"))
    if not label:
        raise ValueError("Manual symbol label is required.")
    if not symbol:
        raise ValueError("Manual symbol is required.")

    verification_request = {
        **request,
        "query": request.get("query") or symbol,
        "label": label,
        "symbol": symbol,
        "manual": True,
        "requiredCapability": request.get("requiredCapability") or "priceHistory",
    }
    return build_symbol_verification_payload(verification_request)


def build_instrument_registry_health_payload(request: dict | None = None) -> dict:
    request = request or {}
    try:
        stale_after_days = int(request.get("staleAfterDays") or 30)
    except (TypeError, ValueError) as error:
        raise ValueError("staleAfterDays must be an integer.") from error
    return runtime_store.build_instrument_registry_health(
        stale_after_days=max(1, min(stale_after_days, 3650)),
    )


def refresh_instrument_registry(*, query: str | None = None, verify_symbol: str | None = None) -> dict:
    seeded = seed_builtin_instruments()
    discovery = build_symbol_discovery_payload({"query": query, "limit": 8}) if _clean_text(query) else None
    verification = (
        build_symbol_verification_payload(
            {
                "query": verify_symbol,
                "requiredCapability": "priceHistory",
            }
        )
        if _clean_text(verify_symbol)
        else None
    )
    return {
        "version": "instrument-registry-refresh-v1",
        "generatedAt": _now_iso(),
        "seeded": seeded,
        "discovery": discovery,
        "verification": verification,
        "health": build_instrument_registry_health_payload({}),
    }
