from __future__ import annotations

import csv
import time
import urllib.request
from datetime import datetime, timedelta, timezone

try:
    from providers import finnhub
except ModuleNotFoundError:
    from scripts.providers import finnhub

try:
    from runtime_store import (
        ensure_runtime_store,
        list_fundamental_universes,
        load_fundamental_universe,
        load_fundamental_universe_members,
        normalize_symbol,
        record_fundamental_collection_run,
        sync_fundamental_universe_members,
        to_iso,
        upsert_fundamental_snapshot,
        upsert_fundamental_universe,
    )
except ModuleNotFoundError:
    from scripts.runtime_store import (
        ensure_runtime_store,
        list_fundamental_universes,
        load_fundamental_universe,
        load_fundamental_universe_members,
        normalize_symbol,
        record_fundamental_collection_run,
        sync_fundamental_universe_members,
        to_iso,
        upsert_fundamental_snapshot,
        upsert_fundamental_universe,
    )


SP500_UNIVERSE_ID = "sp500-current"
SP500_UNIVERSE_LABEL = "S&P 500 Current Constituents"
SP500_INDEX_SYMBOL = "^GSPC"
NIFTY500_UNIVERSE_ID = "nifty-500-current"
NIFTY500_UNIVERSE_LABEL = "Nifty 500 Current Constituents"
NIFTY500_CONSTITUENTS_URL = "https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv"
NIFTY500_ARCHIVE_CONSTITUENTS_URL = "https://archives.nseindia.com/content/indices/ind_nifty500list.csv"
DEFAULT_FUNDAMENTAL_PERIOD_DAYS = 366
BUILTIN_FUNDAMENTAL_UNIVERSES = {
    SP500_UNIVERSE_ID: {
        "universeId": SP500_UNIVERSE_ID,
        "label": SP500_UNIVERSE_LABEL,
        "sourceKind": "finnhub-index",
        "sourceProvider": finnhub.PROVIDER_ID,
        "sourceSymbol": SP500_INDEX_SYMBOL,
    },
    NIFTY500_UNIVERSE_ID: {
        "universeId": NIFTY500_UNIVERSE_ID,
        "label": NIFTY500_UNIVERSE_LABEL,
        "sourceKind": "nse-csv",
        "sourceProvider": "nse-indices",
        "sourceSymbol": "NIFTY500",
    },
}


def _today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _clean_number(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_date(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)[:10]).date()
    except ValueError:
        return None


def _download_text(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "IndexStudyLab/1.0",
            "Accept": "text/csv,*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def _nifty_provider_symbol(raw_symbol: str) -> str:
    symbol = str(raw_symbol or "").strip().upper()
    if not symbol:
        return ""
    if "." in symbol:
        return symbol
    return f"{symbol}.NS"


def _members_from_manual_symbols(symbols: list[str]) -> list[dict]:
    members: list[dict] = []
    seen: set[str] = set()
    for symbol in symbols:
        normalized_symbol = normalize_symbol(symbol)
        if not normalized_symbol or normalized_symbol in seen:
            continue
        seen.add(normalized_symbol)
        members.append(
            {
                "symbol": normalized_symbol,
                "providerSymbol": normalized_symbol,
                "label": normalized_symbol,
                "sourceProvider": "manual",
                "metadata": {"kind": "manual"},
            },
        )
    return members


def fetch_nifty500_members(*, source_url: str = NIFTY500_CONSTITUENTS_URL) -> dict:
    last_error: Exception | None = None
    for url in [source_url, NIFTY500_ARCHIVE_CONSTITUENTS_URL]:
        try:
            text = _download_text(url)
        except Exception as error:  # noqa: BLE001
            last_error = error
            continue

        rows = list(csv.DictReader(text.splitlines()))
        members: list[dict] = []
        for row in rows:
            local_symbol = str(row.get("Symbol") or "").strip().upper()
            provider_symbol = _nifty_provider_symbol(local_symbol)
            if not provider_symbol:
                continue
            members.append(
                {
                    "symbol": provider_symbol,
                    "providerSymbol": provider_symbol,
                    "label": str(row.get("Company Name") or local_symbol).strip() or provider_symbol,
                    "exchange": "NSE",
                    "industry": str(row.get("Industry") or "").strip() or None,
                    "isin": str(row.get("ISIN Code") or "").strip() or None,
                    "sourceProvider": "nse-indices",
                    "metadata": {
                        "localSymbol": local_symbol,
                        "series": str(row.get("Series") or "").strip() or None,
                        "sourceUrl": url,
                    },
                },
            )
        if members:
            return {
                "sourceUrl": url,
                "asOfDate": _today_iso(),
                "members": members,
            }

    if last_error is not None:
        raise RuntimeError(f"Could not download Nifty 500 constituents: {last_error}") from last_error
    raise RuntimeError("Could not download Nifty 500 constituents.")


def seed_sp500_universe(
    *,
    universe_id: str = SP500_UNIVERSE_ID,
    universe_label: str = SP500_UNIVERSE_LABEL,
) -> dict:
    constituents = finnhub.fetch_index_constituents(SP500_INDEX_SYMBOL)
    members = constituents["members"]
    upsert_fundamental_universe(
        universe_id=universe_id,
        label=universe_label,
        source_provider=finnhub.PROVIDER_ID,
        source_kind="finnhub-index",
        source_symbol=SP500_INDEX_SYMBOL,
        source_url="https://finnhub.io/docs/api/indices-constituents",
        as_of_date=constituents.get("asOfDate"),
        member_count=len(members),
        note="Current S&P 500 constituents from Finnhub index constituents.",
    )
    synced_members = sync_fundamental_universe_members(
        universe_id,
        members,
        source_provider=finnhub.PROVIDER_ID,
        replace=True,
    )
    return {
        "universeId": universe_id,
        "universeLabel": universe_label,
        "sourceKind": "finnhub-index",
        "sourceProvider": finnhub.PROVIDER_ID,
        "asOfDate": constituents.get("asOfDate"),
        "memberCount": len([member for member in synced_members if member.get("isActive")]),
    }


def seed_nifty500_universe(
    *,
    universe_id: str = NIFTY500_UNIVERSE_ID,
    universe_label: str = NIFTY500_UNIVERSE_LABEL,
    source_url: str = NIFTY500_CONSTITUENTS_URL,
) -> dict:
    constituents = fetch_nifty500_members(source_url=source_url)
    members = constituents["members"]
    upsert_fundamental_universe(
        universe_id=universe_id,
        label=universe_label,
        source_provider="nse-indices",
        source_kind="nse-csv",
        source_symbol="NIFTY500",
        source_url=constituents.get("sourceUrl"),
        as_of_date=constituents.get("asOfDate"),
        member_count=len(members),
        note="Current Nifty 500 constituents from NSE/Nifty Indices CSV.",
    )
    synced_members = sync_fundamental_universe_members(
        universe_id,
        members,
        source_provider="nse-indices",
        replace=True,
    )
    return {
        "universeId": universe_id,
        "universeLabel": universe_label,
        "sourceKind": "nse-csv",
        "sourceProvider": "nse-indices",
        "asOfDate": constituents.get("asOfDate"),
        "memberCount": len([member for member in synced_members if member.get("isActive")]),
        "sourceUrl": constituents.get("sourceUrl"),
    }


def seed_manual_fundamental_universe(
    universe_id: str,
    universe_label: str,
    symbols: list[str],
) -> dict:
    members = _members_from_manual_symbols(symbols)
    upsert_fundamental_universe(
        universe_id=universe_id,
        label=universe_label,
        source_provider="manual",
        source_kind="manual",
        source_symbol=None,
        source_url=None,
        as_of_date=_today_iso(),
        member_count=len(members),
        note="Manual bounded universe for fundamental collection.",
    )
    synced_members = sync_fundamental_universe_members(
        universe_id,
        members,
        source_provider="manual",
        replace=False,
    )
    return {
        "universeId": universe_id,
        "universeLabel": universe_label,
        "sourceKind": "manual",
        "sourceProvider": "manual",
        "asOfDate": _today_iso(),
        "memberCount": len([member for member in synced_members if member.get("isActive")]),
    }


def seed_builtin_fundamental_universe(universe_id: str, *, universe_label: str | None = None) -> dict:
    normalized_id = str(universe_id or "").strip().lower()
    if normalized_id == SP500_UNIVERSE_ID:
        return seed_sp500_universe(
            universe_id=SP500_UNIVERSE_ID,
            universe_label=universe_label or SP500_UNIVERSE_LABEL,
        )
    if normalized_id == NIFTY500_UNIVERSE_ID:
        return seed_nifty500_universe(
            universe_id=NIFTY500_UNIVERSE_ID,
            universe_label=universe_label or NIFTY500_UNIVERSE_LABEL,
        )
    raise ValueError(f"Unknown built-in fundamental universe: {universe_id}")


def _extract_fundamental_metrics(payload: dict, *, as_of_date: str, period_days: int) -> list[dict]:
    cutoff = datetime.fromisoformat(as_of_date[:10]).date() - timedelta(days=max(1, int(period_days or DEFAULT_FUNDAMENTAL_PERIOD_DAYS)))
    metrics: list[dict] = []

    metric_values = payload.get("metric") if isinstance(payload.get("metric"), dict) else {}
    for metric_name, value in metric_values.items():
        value_number = _clean_number(value)
        metrics.append(
            {
                "metricName": str(metric_name),
                "periodType": "snapshot",
                "periodEndDate": as_of_date,
                "valueNumber": value_number,
                "valueText": None if value_number is not None else str(value),
                "sourceField": f"metric.{metric_name}",
            },
        )

    series_values = payload.get("series") if isinstance(payload.get("series"), dict) else {}
    for period_type, series_by_metric in series_values.items():
        if not isinstance(series_by_metric, dict):
            continue
        for metric_name, rows in series_by_metric.items():
            if not isinstance(rows, list):
                continue
            for row in rows:
                if not isinstance(row, dict):
                    continue
                period_date = _parse_date(row.get("period"))
                if period_date is None or period_date < cutoff:
                    continue
                value_number = _clean_number(row.get("v"))
                metrics.append(
                    {
                        "metricName": str(metric_name),
                        "periodType": str(period_type).lower() or "series",
                        "periodEndDate": period_date.isoformat(),
                        "valueNumber": value_number,
                        "valueText": None if value_number is not None else str(row.get("v")),
                        "sourceField": f"series.{period_type}.{metric_name}",
                    },
                )

    return metrics


def collect_fundamental_universe(
    universe_id: str,
    *,
    universe_label: str | None = None,
    symbols: list[str] | None = None,
    seed_builtin: bool = False,
    provider: str = finnhub.PROVIDER_ID,
    period_days: int = DEFAULT_FUNDAMENTAL_PERIOD_DAYS,
    limit: int | None = None,
    delay_seconds: float = 0.0,
) -> dict:
    ensure_runtime_store()
    normalized_id = str(universe_id or "").strip().lower()
    if not normalized_id:
        raise ValueError("Fundamental universe id is required.")
    if provider != finnhub.PROVIDER_ID:
        raise ValueError("Only Finnhub fundamentals are supported in this slice.")

    seed_summary = None
    if symbols:
        seed_summary = seed_manual_fundamental_universe(
            normalized_id,
            universe_label or normalized_id,
            symbols,
        )
    elif seed_builtin:
        seed_summary = seed_builtin_fundamental_universe(
            normalized_id,
            universe_label=universe_label,
        )

    universe = load_fundamental_universe(normalized_id)
    members = load_fundamental_universe_members(normalized_id)
    if limit is not None:
        members = members[: max(0, int(limit))]
    if not universe or not members:
        raise RuntimeError("No active fundamental universe members are available. Seed the universe first.")

    as_of_date = _today_iso()
    started_at = to_iso(datetime.now(timezone.utc))
    collected: list[dict] = []
    failures: list[dict] = []
    skipped_count = 0
    for index, member in enumerate(members):
        provider_symbol = normalize_symbol(member.get("providerSymbol") or member.get("symbol"))
        symbol = normalize_symbol(member.get("symbol") or provider_symbol)
        if not provider_symbol:
            skipped_count += 1
            continue
        if index and delay_seconds > 0:
            time.sleep(delay_seconds)
        try:
            payload = finnhub.fetch_basic_financials(provider_symbol, metric="all")
            metrics = _extract_fundamental_metrics(
                payload,
                as_of_date=as_of_date,
                period_days=period_days,
            )
            series_metric_count = len([metric for metric in metrics if metric["periodType"] != "snapshot"])
            snapshot = upsert_fundamental_snapshot(
                {
                    "universeId": normalized_id,
                    "symbol": symbol,
                    "providerSymbol": provider_symbol,
                    "provider": provider,
                    "asOfDate": as_of_date,
                    "periodStartDate": (
                        datetime.fromisoformat(as_of_date).date()
                        - timedelta(days=max(1, int(period_days or DEFAULT_FUNDAMENTAL_PERIOD_DAYS)))
                    ).isoformat(),
                    "periodEndDate": as_of_date,
                    "metricType": "all",
                    "sourceUrl": "https://finnhub.io/docs/api/company-basic-financials",
                    "fetchedAt": to_iso(datetime.now(timezone.utc)),
                    "rawPayload": payload,
                    "metricCount": len(payload.get("metric") or {}),
                    "seriesMetricCount": series_metric_count,
                },
                metrics,
            )
            collected.append(
                {
                    "symbol": symbol,
                    "providerSymbol": provider_symbol,
                    "label": member.get("label") or symbol,
                    "provider": provider,
                    "snapshotId": snapshot["snapshotId"],
                    "metricCount": snapshot["metricCount"],
                    "seriesMetricCount": snapshot["seriesMetricCount"],
                    "storedMetricRows": len(metrics),
                },
            )
        except Exception as error:  # noqa: BLE001
            failures.append(
                {
                    "symbol": symbol,
                    "providerSymbol": provider_symbol,
                    "label": member.get("label") or symbol,
                    "error": str(error),
                },
            )

    completed_at = to_iso(datetime.now(timezone.utc))
    run_record = record_fundamental_collection_run(
        universe_id=normalized_id,
        universe_label=universe_label or universe["label"],
        provider=provider,
        source_kind=universe.get("sourceKind") or "manual",
        period_days=period_days,
        symbol_count=len(members),
        success_count=len(collected),
        failure_count=len(failures),
        skipped_count=skipped_count,
        as_of_date=as_of_date,
        started_at=started_at,
        completed_at=completed_at,
        failures=failures,
    )
    return {
        **run_record,
        "seed": seed_summary,
        "universe": universe,
        "collected": collected,
    }


def list_configured_fundamental_universes() -> list[dict]:
    ensure_runtime_store()
    return list_fundamental_universes()


def list_available_fundamental_universes() -> list[dict]:
    ensure_runtime_store()
    stored_by_id = {
        str(universe.get("universeId") or "").strip().lower(): universe
        for universe in list_fundamental_universes()
    }
    available: list[dict] = []
    for universe_id, builtin in BUILTIN_FUNDAMENTAL_UNIVERSES.items():
        stored = stored_by_id.get(universe_id)
        available.append(
            {
                **builtin,
                "memberCount": stored.get("memberCount") if stored else None,
                "activeMembers": stored.get("activeMembers") if stored else None,
                "asOfDate": stored.get("asOfDate") if stored else None,
                "isStored": bool(stored),
                "isBuiltIn": True,
            }
        )
    for universe_id, stored in stored_by_id.items():
        if universe_id in BUILTIN_FUNDAMENTAL_UNIVERSES:
            continue
        available.append(
            {
                **stored,
                "isStored": True,
                "isBuiltIn": False,
            }
        )
    return available
