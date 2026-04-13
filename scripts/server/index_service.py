from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone

try:
    from sync_yfinance import (
        load_yfinance,
        normalize_points,
        resolve_ticker_currency,
    )
except ModuleNotFoundError:
    from scripts.sync_yfinance import (
        load_yfinance,
        normalize_points,
        resolve_ticker_currency,
    )

try:
    from providers.router import (
        fetch_history_with_fallback,
        fetch_profile_with_fallback,
        normalize_provider_id,
        provider_display_name,
    )
except ModuleNotFoundError:
    from scripts.providers.router import (
        fetch_history_with_fallback,
        fetch_profile_with_fallback,
        normalize_provider_id,
        provider_display_name,
    )

try:
    from runtime_store import (
        build_symbol_source_url,
        ensure_runtime_store,
        find_remembered_entry,
        load_cached_series,
        load_corporate_actions,
        load_instrument_profile,
        load_price_rows,
        load_remembered_catalog,
        normalize_symbol,
        parse_iso_datetime,
        remember_symbol,
        symbol_cache_key,
        update_cached_series_currency,
        write_instrument_profile,
        write_price_history,
    )
except ModuleNotFoundError:
    from scripts.runtime_store import (
        build_symbol_source_url,
        ensure_runtime_store,
        find_remembered_entry,
        load_cached_series,
        load_corporate_actions,
        load_instrument_profile,
        load_price_rows,
        load_remembered_catalog,
        normalize_symbol,
        parse_iso_datetime,
        remember_symbol,
        symbol_cache_key,
        update_cached_series_currency,
        write_instrument_profile,
        write_price_history,
    )


DEFAULT_HISTORY_PERIOD = "10y"
FULL_HISTORY_FALLBACK_YEARS = 25
CACHE_TTL = timedelta(hours=24)
PROFILE_CACHE_TTL = timedelta(days=7)
INCREMENTAL_OVERLAP_DAYS = 90
PRICE_ABSOLUTE_TOLERANCE = 1e-6
PRICE_RELATIVE_TOLERANCE = 1e-8


def fetch_symbol_history_result(
    symbol: str,
    *,
    period: str | None = None,
    start: str | None = None,
    end: str | None = None,
    preferred_provider: str | None = None,
):
    return fetch_history_with_fallback(
        symbol,
        period=period,
        start=start,
        end=end,
        preferred_provider=preferred_provider,
    )


def fetch_symbol_history(
    symbol: str,
    *,
    period: str | None = None,
    start: str | None = None,
    end: str | None = None,
) -> tuple[list[dict], list[dict], str | None]:
    result = fetch_symbol_history_result(
        symbol,
        period=period,
        start=start,
        end=end,
    )
    return result.price_rows, result.action_rows, result.currency


def fetch_symbol_snapshot(
    symbol: str,
    period: str = DEFAULT_HISTORY_PERIOD,
) -> tuple[list[list[str | float]], str | None]:
    price_rows, _action_rows, currency = fetch_symbol_history(symbol, period=period)
    points = [[row["date"], round(float(row["close"]), 6)] for row in price_rows]
    return normalize_points(points), currency


def shift_date(date_value: str, days: int) -> str:
    parsed = datetime.fromisoformat(str(date_value)[:10])
    return (parsed + timedelta(days=days)).date().isoformat()


def years_ago_start_date(years: int, now: datetime | None = None) -> str:
    reference_date = (now or datetime.now(timezone.utc)).date()
    try:
        shifted = reference_date.replace(year=reference_date.year - years)
    except ValueError:
        shifted = reference_date.replace(year=reference_date.year - years, day=28)
    return shifted.isoformat()


def stable_rows_hash(rows: list[dict], fields: list[str]) -> str:
    normalized_rows = [
        {
            field: (
                round(float(row[field]), 8)
                if isinstance(row.get(field), (int, float))
                else row.get(field)
            )
            for field in fields
        }
        for row in sorted(
            rows,
            key=lambda item: tuple(str(item.get(field) or "") for field in fields),
        )
    ]
    payload = json.dumps(normalized_rows, separators=(",", ":"), sort_keys=True)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def price_values_match(left: float, right: float) -> bool:
    absolute_delta = abs(left - right)
    if absolute_delta <= PRICE_ABSOLUTE_TOLERANCE:
        return True

    denominator = max(abs(left), abs(right), 1)
    return (absolute_delta / denominator) <= PRICE_RELATIVE_TOLERANCE


def validate_price_overlap(
    cached_rows: list[dict],
    fetched_rows: list[dict],
) -> tuple[bool, str]:
    cached_by_date = {
        row["date"]: row
        for row in cached_rows
        if row.get("date") and row.get("close") is not None
    }
    fetched_by_date = {
        row["date"]: row
        for row in fetched_rows
        if row.get("date") and row.get("close") is not None
    }
    overlap_dates = sorted(set(cached_by_date) & set(fetched_by_date))
    if not overlap_dates:
        return False, "No overlapping dates were available for incremental validation."

    missing_fetched_dates = sorted(set(cached_by_date) - set(fetched_by_date))
    if missing_fetched_dates:
        sample = ", ".join(missing_fetched_dates[:3])
        return False, f"Fetched overlap omitted cached dates: {sample}."

    for date_value in overlap_dates:
        cached_close = float(cached_by_date[date_value]["close"])
        fetched_close = float(fetched_by_date[date_value]["close"])
        if not price_values_match(cached_close, fetched_close):
            return (
                False,
                f"Cached close changed on {date_value}: {cached_close} vs {fetched_close}.",
            )

    return True, f"Validated {len(overlap_dates)} overlapping closes."


def validate_action_overlap(
    cached_actions: list[dict],
    fetched_actions: list[dict],
) -> tuple[bool, str]:
    cached_hash = stable_rows_hash(cached_actions, ["date", "actionType", "value"])
    fetched_hash = stable_rows_hash(fetched_actions, ["date", "actionType", "value"])
    if cached_hash != fetched_hash:
        return False, "Corporate actions changed in the overlap window."

    return True, "Corporate actions matched in the overlap window."


def snapshot_requires_full_sync(snapshot: dict | None) -> bool:
    if snapshot is None:
        return True

    sync_mode = (snapshot.get("syncState") or {}).get("lastSyncMode")
    return sync_mode in {None, "legacy", "manual"}


def fetch_full_symbol_history_result(
    symbol: str,
    *,
    preferred_provider: str | None = None,
):
    last_error: Exception | None = None
    attempts = (
        {"period": "max", "label": "period=max"},
        {
            "start": years_ago_start_date(FULL_HISTORY_FALLBACK_YEARS),
            "label": f"start={years_ago_start_date(FULL_HISTORY_FALLBACK_YEARS)}",
        },
        {
            "period": DEFAULT_HISTORY_PERIOD,
            "label": f"period={DEFAULT_HISTORY_PERIOD}",
        },
    )
    for attempt in attempts:
        try:
            result = fetch_symbol_history_result(
                symbol,
                period=attempt.get("period"),
                start=attempt.get("start"),
                preferred_provider=preferred_provider,
            )
        except Exception as error:  # noqa: BLE001
            last_error = error
            continue

        return result, str(attempt["label"])

    if last_error is not None:
        raise RuntimeError(f"Could not fetch broad history for {symbol}: {last_error}") from last_error
    raise RuntimeError(f"Could not fetch history for symbol {symbol}.")


def fetch_full_symbol_history(
    symbol: str,
) -> tuple[list[dict], list[dict], str | None, str]:
    result, attempt_label = fetch_full_symbol_history_result(symbol)
    return result.price_rows, result.action_rows, result.currency, attempt_label


def fetch_symbol_profile(symbol: str, *, preferred_provider: str | None = None) -> dict:
    result = fetch_profile_with_fallback(
        symbol,
        preferred_provider=preferred_provider,
    )
    return write_instrument_profile(
        symbol,
        result.info,
        provider_name=result.provider_name,
    )


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

    return update_cached_series_currency(symbol, currency) or snapshot


def cache_is_fresh(snapshot: dict, now: datetime | None = None) -> bool:
    generated_at = parse_iso_datetime(snapshot.get("generatedAt"))
    if generated_at is None:
        return False

    reference = now or datetime.now(timezone.utc)
    return (reference - generated_at) <= CACHE_TTL


def profile_cache_is_fresh(profile: dict, now: datetime | None = None) -> bool:
    fetched_at = parse_iso_datetime(profile.get("fetchedAt"))
    if fetched_at is None:
        return False

    reference = now or datetime.now(timezone.utc)
    return (reference - fetched_at) <= PROFILE_CACHE_TTL


def _default_cache_dependencies() -> dict:
    return {
        "load_cached_series": load_cached_series,
        "normalize_symbol": normalize_symbol,
        "normalize_provider_id": normalize_provider_id,
        "cache_is_fresh": cache_is_fresh,
        "snapshot_requires_full_sync": snapshot_requires_full_sync,
        "ensure_snapshot_currency": ensure_snapshot_currency,
        "fetch_full_symbol_history_result": fetch_full_symbol_history_result,
        "write_price_history": write_price_history,
        "provider_display_name": provider_display_name,
        "stable_rows_hash": stable_rows_hash,
        "load_price_rows": load_price_rows,
        "load_corporate_actions": load_corporate_actions,
        "shift_date": shift_date,
        "fetch_symbol_history_result": fetch_symbol_history_result,
        "validate_price_overlap": validate_price_overlap,
        "validate_action_overlap": validate_action_overlap,
        "incremental_overlap_days": INCREMENTAL_OVERLAP_DAYS,
    }


def get_or_refresh_cached_series_core(
    symbol: str,
    *,
    preferred_provider: str | None = None,
    dependencies: dict | None = None,
) -> tuple[dict, str]:
    deps = dependencies or _default_cache_dependencies()

    normalized_symbol = deps["normalize_symbol"](symbol)
    cached = deps["load_cached_series"](normalized_symbol)
    explicit_provider = deps["normalize_provider_id"](preferred_provider)
    cached_provider = (
        deps["normalize_provider_id"](cached.get("provider"))
        if cached
        else None
    )
    provider_preference_changed = (
        explicit_provider is not None and explicit_provider != cached_provider
    )
    effective_provider = explicit_provider or cached_provider
    overlap_days = deps["incremental_overlap_days"]

    if (
        cached
        and not provider_preference_changed
        and deps["cache_is_fresh"](cached)
        and not deps["snapshot_requires_full_sync"](cached)
    ):
        return deps["ensure_snapshot_currency"](cached), "hit"

    if provider_preference_changed:
        history_result, period = deps["fetch_full_symbol_history_result"](
            normalized_symbol,
            preferred_provider=effective_provider,
        )
        sync_message = (
            f"Preferred provider switched from {deps['provider_display_name'](cached_provider)} "
            f"to {history_result.provider_name}. Full sync using {period}."
        )
        coverage_note = getattr(history_result, "coverage_note", None)
        if coverage_note:
            sync_message = f"{sync_message} {coverage_note}"
        refreshed = deps["write_price_history"](
            normalized_symbol,
            history_result.price_rows,
            history_result.action_rows,
            currency=history_result.currency,
            source_series_type="Price",
            provider=history_result.provider,
            sync_mode="full",
            sync_status="ok",
            sync_message=sync_message,
            replace=True,
            overlap_hash=deps["stable_rows_hash"](
                history_result.price_rows[-overlap_days:],
                ["date", "close"],
            ),
            actions_hash=deps["stable_rows_hash"](
                history_result.action_rows,
                ["date", "actionType", "value"],
            ),
        )
        return refreshed, "provider-switch"

    if deps["snapshot_requires_full_sync"](cached):
        history_result, period = deps["fetch_full_symbol_history_result"](
            normalized_symbol,
            preferred_provider=effective_provider,
        )
        sync_message = f"Full {history_result.provider_name} sync using {period}."
        coverage_note = getattr(history_result, "coverage_note", None)
        if coverage_note:
            sync_message = f"{sync_message} {coverage_note}"
        refreshed = deps["write_price_history"](
            normalized_symbol,
            history_result.price_rows,
            history_result.action_rows,
            currency=history_result.currency,
            source_series_type="Price",
            provider=history_result.provider,
            sync_mode="full",
            sync_status="ok",
            sync_message=sync_message,
            replace=True,
            overlap_hash=deps["stable_rows_hash"](
                history_result.price_rows[-overlap_days:],
                ["date", "close"],
            ),
            actions_hash=deps["stable_rows_hash"](
                history_result.action_rows,
                ["date", "actionType", "value"],
            ),
        )
        return refreshed, "refreshed"

    last_price_date = (
        (cached.get("syncState") or {}).get("lastPriceDate")
        or cached["range"]["endDate"]
    )
    overlap_start = deps["shift_date"](last_price_date, -overlap_days)
    history_result = deps["fetch_symbol_history_result"](
        normalized_symbol,
        start=overlap_start,
        preferred_provider=effective_provider,
    )
    fetched_rows = history_result.price_rows
    fetched_actions = history_result.action_rows
    fetched_end = fetched_rows[-1]["date"]
    cached_overlap = deps["load_price_rows"](normalized_symbol, overlap_start, fetched_end)
    cached_actions = deps["load_corporate_actions"](
        normalized_symbol,
        overlap_start,
        fetched_end,
    )

    prices_valid, price_message = deps["validate_price_overlap"](
        cached_overlap,
        fetched_rows,
    )
    actions_valid, action_message = deps["validate_action_overlap"](
        cached_actions,
        fetched_actions,
    )
    if not prices_valid or not actions_valid:
        full_result, period = deps["fetch_full_symbol_history_result"](
            normalized_symbol,
            preferred_provider=effective_provider,
        )
        rebuild_message = (
            f"{price_message} {action_message} Rebuilt using {full_result.provider_name} {period}."
        )
        coverage_note = getattr(full_result, "coverage_note", None)
        if coverage_note:
            rebuild_message = f"{rebuild_message} {coverage_note}"
        refreshed = deps["write_price_history"](
            normalized_symbol,
            full_result.price_rows,
            full_result.action_rows,
            currency=full_result.currency or history_result.currency,
            source_series_type="Price",
            provider=full_result.provider,
            sync_mode="full",
            sync_status="rebuilt",
            sync_message=rebuild_message,
            replace=True,
            overlap_hash=deps["stable_rows_hash"](
                full_result.price_rows[-overlap_days:],
                ["date", "close"],
            ),
            actions_hash=deps["stable_rows_hash"](
                full_result.action_rows,
                ["date", "actionType", "value"],
            ),
        )
        return refreshed, "rebuilt"

    incremental_message = f"{price_message} {action_message}"
    coverage_note = getattr(history_result, "coverage_note", None)
    if coverage_note:
        incremental_message = f"{incremental_message} {coverage_note}"
    refreshed = deps["write_price_history"](
        normalized_symbol,
        fetched_rows,
        fetched_actions,
        currency=history_result.currency or cached.get("currency"),
        source_series_type="Price",
        provider=history_result.provider,
        sync_mode="incremental",
        sync_status="ok",
        sync_message=incremental_message,
        replace=False,
        action_window=(overlap_start, fetched_end),
        overlap_hash=deps["stable_rows_hash"](fetched_rows, ["date", "close"]),
        actions_hash=deps["stable_rows_hash"](
            fetched_actions,
            ["date", "actionType", "value"],
        ),
    )
    return refreshed, "incremental"


def get_or_refresh_cached_series(
    symbol: str,
    *,
    preferred_provider: str | None = None,
) -> tuple[dict, str]:
    return get_or_refresh_cached_series_core(
        symbol,
        preferred_provider=preferred_provider,
    )


def get_or_refresh_instrument_profile(symbol: str) -> tuple[dict, str]:
    normalized_symbol = normalize_symbol(symbol)
    cached = load_instrument_profile(normalized_symbol)
    if cached and profile_cache_is_fresh(cached):
        return cached, "hit"

    cached_snapshot = load_cached_series(normalized_symbol)
    preferred_provider = cached_snapshot.get("provider") if cached_snapshot else None
    refreshed = fetch_symbol_profile(
        normalized_symbol,
        preferred_provider=preferred_provider,
    )
    return refreshed, "refreshed"


def build_response_snapshot(raw_snapshot: dict, request: dict, cache_status: str) -> dict:
    symbol = raw_snapshot["symbol"]
    label = (request.get("label") or "").strip() or symbol
    target_series_type = (
        (request.get("targetSeriesType") or "Price").strip() or "Price"
    )
    source_series_type = (
        request.get("sourceSeriesType")
        or raw_snapshot.get("sourceSeriesType")
        or target_series_type
    ).strip() or target_series_type
    provider_name = provider_display_name(raw_snapshot.get("provider"))
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
    sync_state = raw_snapshot.get("syncState") or {}

    return {
        "provider": raw_snapshot.get("provider") or "yfinance",
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
            "syncMode": sync_state.get("lastSyncMode"),
            "syncStatus": sync_state.get("lastSyncStatus"),
            "lastCheckedAt": sync_state.get("lastCheckedAt"),
        },
    }


def build_catalog_payload() -> dict:
    ensure_runtime_store()
    return {
        "provider": "yfinance",
        "datasetType": "index",
        "datasets": load_remembered_catalog(),
    }


def build_instrument_profile_payload(request: dict) -> dict:
    ensure_runtime_store()
    symbol = normalize_symbol(request.get("symbol"))
    if not symbol:
        raise ValueError("A symbol is required.")

    profile, cache_status = get_or_refresh_instrument_profile(symbol)
    return {
        "profile": profile,
        "cache": {
            "status": cache_status,
        },
    }


def build_index_series_payload(request: dict) -> dict:
    ensure_runtime_store()
    symbol = normalize_symbol(request.get("symbol"))
    if not symbol:
        raise ValueError("A symbol is required.")

    request_payload = dict(request)
    request_payload["symbol"] = symbol
    remember = bool(request_payload.get("remember"))
    remembered_entry = find_remembered_entry(
        request_payload.get("datasetId"),
        symbol,
    )

    if not request_payload.get("label") and remembered_entry:
        request_payload["label"] = remembered_entry.get("label") or symbol
    if not request_payload.get("sourceUrl") and remembered_entry:
        request_payload["sourceUrl"] = (
            remembered_entry.get("sourceUrl") or build_symbol_source_url(symbol)
        )
    if not request_payload.get("providerName") and remembered_entry:
        request_payload["providerName"] = (
            remembered_entry.get("providerName") or "Yahoo Finance"
        )
    if not request_payload.get("family") and remembered_entry:
        request_payload["family"] = remembered_entry.get("family") or "Remembered"

    raw_snapshot, cache_status = get_or_refresh_cached_series(
        symbol,
        preferred_provider=request_payload.get("preferredProvider"),
    )
    snapshot = build_response_snapshot(raw_snapshot, request_payload, cache_status)

    return {
        "snapshot": snapshot,
        "rememberedEntry": remember_symbol(snapshot) if remember else None,
    }
