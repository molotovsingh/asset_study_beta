from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime
from typing import Callable


def _clean_text(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


def _normalize_alias(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _compact_text(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def _json_dumps(payload: object) -> str:
    return json.dumps(payload if payload is not None else {}, separators=(",", ":"), sort_keys=True)


def _json_loads(payload: str | None, default):
    if not payload:
        return default
    try:
        decoded = json.loads(payload)
    except json.JSONDecodeError:
        return default
    return decoded if isinstance(decoded, type(default)) else default


def build_canonical_key(
    *,
    canonical_symbol: str,
    asset_class: str | None = None,
    exchange: str | None = None,
    mic: str | None = None,
    country: str | None = None,
) -> str:
    parts = [
        asset_class or "unknown",
        canonical_symbol,
        exchange or "",
        mic or "",
        country or "",
    ]
    return "|".join(_normalize_alias(part) for part in parts)


def _row_to_instrument(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return {
        "instrumentId": int(row["instrument_id"]),
        "canonicalKey": row["canonical_key"],
        "canonicalSymbol": row["canonical_symbol"],
        "symbol": row["canonical_symbol"],
        "label": row["display_label"],
        "assetClass": row["asset_class"],
        "exchange": row["exchange"],
        "mic": row["mic"],
        "currency": row["currency"],
        "country": row["country"],
        "status": row["status"],
        "verificationStatus": row["verification_status"],
        "metadata": _json_loads(row["metadata_json"], {}),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _row_to_mapping(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return {
        "mappingId": int(row["mapping_id"]),
        "instrumentId": int(row["instrument_id"]),
        "provider": row["provider"],
        "providerSymbol": row["provider_symbol"],
        "symbol": row["provider_symbol"],
        "providerName": row["provider_name"],
        "assetClass": row["asset_class"],
        "exchange": row["exchange"],
        "mic": row["mic"],
        "currency": row["currency"],
        "country": row["country"],
        "capabilities": _json_loads(row["capabilities_json"], {}),
        "verificationStatus": row["verification_status"],
        "verifiedAt": row["verified_at"],
        "lastCheckedAt": row["last_checked_at"],
        "failureReason": row["failure_reason"],
        "metadata": _json_loads(row["metadata_json"], {}),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def load_instrument_by_id(
    instrument_id: int,
    *,
    open_runtime_store: Callable[[], sqlite3.Connection],
) -> dict | None:
    with open_runtime_store() as connection:
        row = connection.execute(
            """
            SELECT *
            FROM instruments
            WHERE instrument_id = ?
            """,
            (instrument_id,),
        ).fetchone()
    return _row_to_instrument(row)


def load_instrument_by_canonical_key(
    canonical_key: str,
    *,
    open_runtime_store: Callable[[], sqlite3.Connection],
) -> dict | None:
    with open_runtime_store() as connection:
        row = connection.execute(
            """
            SELECT *
            FROM instruments
            WHERE canonical_key = ?
            """,
            (canonical_key,),
        ).fetchone()
    return _row_to_instrument(row)


def load_provider_mappings(
    instrument_id: int,
    *,
    open_runtime_store: Callable[[], sqlite3.Connection],
) -> list[dict]:
    with open_runtime_store() as connection:
        rows = connection.execute(
            """
            SELECT *
            FROM instrument_provider_mappings
            WHERE instrument_id = ?
            ORDER BY
                CASE verification_status WHEN 'verified' THEN 0 ELSE 1 END,
                provider,
                provider_symbol
            """,
            (instrument_id,),
        ).fetchall()
    return [mapping for mapping in (_row_to_mapping(row) for row in rows) if mapping is not None]


def upsert_instrument(
    *,
    canonical_symbol: str,
    label: str | None = None,
    asset_class: str | None = None,
    exchange: str | None = None,
    mic: str | None = None,
    currency: str | None = None,
    country: str | None = None,
    status: str | None = None,
    verification_status: str | None = None,
    metadata: dict | None = None,
    open_runtime_store: Callable[[], sqlite3.Connection],
    now_iso: Callable[[], str],
) -> dict:
    normalized_symbol = _clean_text(canonical_symbol)
    if not normalized_symbol:
        raise ValueError("Instrument symbol is required.")
    normalized_asset_class = _normalize_alias(asset_class or "equity") or "equity"
    canonical_key = build_canonical_key(
        canonical_symbol=normalized_symbol,
        asset_class=normalized_asset_class,
        exchange=_clean_text(exchange),
        mic=_clean_text(mic),
        country=_clean_text(country),
    )
    now = now_iso()
    with open_runtime_store() as connection:
        connection.execute(
            """
            INSERT INTO instruments (
                canonical_key,
                canonical_symbol,
                display_label,
                asset_class,
                exchange,
                mic,
                currency,
                country,
                status,
                verification_status,
                metadata_json,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(canonical_key) DO UPDATE SET
                canonical_symbol = excluded.canonical_symbol,
                display_label = excluded.display_label,
                asset_class = excluded.asset_class,
                exchange = excluded.exchange,
                mic = excluded.mic,
                currency = COALESCE(excluded.currency, instruments.currency),
                country = COALESCE(excluded.country, instruments.country),
                status = excluded.status,
                verification_status = excluded.verification_status,
                metadata_json = excluded.metadata_json,
                updated_at = excluded.updated_at
            """,
            (
                canonical_key,
                normalized_symbol,
                _clean_text(label) or normalized_symbol,
                normalized_asset_class,
                _clean_text(exchange),
                _clean_text(mic),
                _clean_text(currency),
                _clean_text(country),
                _normalize_alias(status or "active") or "active",
                _normalize_alias(verification_status or "unverified") or "unverified",
                _json_dumps(metadata or {}),
                now,
                now,
            ),
        )
        row = connection.execute(
            "SELECT * FROM instruments WHERE canonical_key = ?",
            (canonical_key,),
        ).fetchone()
        connection.commit()

    instrument = _row_to_instrument(row)
    if instrument is None:
        raise RuntimeError("Failed to persist instrument.")
    return instrument


def upsert_instrument_provider_mapping(
    *,
    instrument_id: int,
    provider: str,
    provider_symbol: str,
    provider_name: str | None = None,
    asset_class: str | None = None,
    exchange: str | None = None,
    mic: str | None = None,
    currency: str | None = None,
    country: str | None = None,
    capabilities: dict | None = None,
    verification_status: str | None = None,
    verified_at: str | None = None,
    last_checked_at: str | None = None,
    failure_reason: str | None = None,
    metadata: dict | None = None,
    open_runtime_store: Callable[[], sqlite3.Connection],
    now_iso: Callable[[], str],
) -> dict:
    normalized_provider = _normalize_alias(provider)
    normalized_provider_symbol = _clean_text(provider_symbol)
    if not normalized_provider:
        raise ValueError("Provider is required.")
    if not normalized_provider_symbol:
        raise ValueError("Provider symbol is required.")

    now = now_iso()
    normalized_status = _normalize_alias(verification_status or "unverified") or "unverified"
    with open_runtime_store() as connection:
        connection.execute(
            """
            INSERT INTO instrument_provider_mappings (
                instrument_id,
                provider,
                provider_symbol,
                provider_name,
                asset_class,
                exchange,
                mic,
                currency,
                country,
                capabilities_json,
                verification_status,
                verified_at,
                last_checked_at,
                failure_reason,
                metadata_json,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(instrument_id, provider, provider_symbol) DO UPDATE SET
                provider_name = excluded.provider_name,
                asset_class = excluded.asset_class,
                exchange = COALESCE(excluded.exchange, instrument_provider_mappings.exchange),
                mic = COALESCE(excluded.mic, instrument_provider_mappings.mic),
                currency = COALESCE(excluded.currency, instrument_provider_mappings.currency),
                country = COALESCE(excluded.country, instrument_provider_mappings.country),
                capabilities_json = excluded.capabilities_json,
                verification_status = excluded.verification_status,
                verified_at = COALESCE(excluded.verified_at, instrument_provider_mappings.verified_at),
                last_checked_at = excluded.last_checked_at,
                failure_reason = excluded.failure_reason,
                metadata_json = excluded.metadata_json,
                updated_at = excluded.updated_at
            """,
            (
                int(instrument_id),
                normalized_provider,
                normalized_provider_symbol,
                _clean_text(provider_name) or normalized_provider,
                _normalize_alias(asset_class or "equity") or "equity",
                _clean_text(exchange),
                _clean_text(mic),
                _clean_text(currency),
                _clean_text(country),
                _json_dumps(capabilities or {}),
                normalized_status,
                verified_at,
                last_checked_at or now,
                _clean_text(failure_reason),
                _json_dumps(metadata or {}),
                now,
                now,
            ),
        )
        row = connection.execute(
            """
            SELECT *
            FROM instrument_provider_mappings
            WHERE instrument_id = ? AND provider = ? AND provider_symbol = ?
            """,
            (int(instrument_id), normalized_provider, normalized_provider_symbol),
        ).fetchone()
        connection.commit()

    mapping = _row_to_mapping(row)
    if mapping is None:
        raise RuntimeError("Failed to persist instrument provider mapping.")
    return mapping


def sync_instrument_aliases(
    instrument_id: int,
    aliases: list[str],
    *,
    source: str = "system",
    open_runtime_store: Callable[[], sqlite3.Connection],
    now_iso: Callable[[], str],
) -> list[dict]:
    normalized_source = _normalize_alias(source) or "system"
    rows: list[dict] = []
    now = now_iso()
    with open_runtime_store() as connection:
        for alias_value in aliases:
            alias = _normalize_alias(alias_value)
            if not alias:
                continue
            connection.execute(
                """
                INSERT INTO instrument_aliases (
                    instrument_id,
                    alias,
                    normalized_alias,
                    source,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(instrument_id, normalized_alias, source) DO NOTHING
                """,
                (int(instrument_id), alias, alias, normalized_source, now),
            )
        rows = [
            {
                "instrumentId": int(row["instrument_id"]),
                "alias": row["alias"],
                "normalizedAlias": row["normalized_alias"],
                "source": row["source"],
                "createdAt": row["created_at"],
            }
            for row in connection.execute(
                """
                SELECT *
                FROM instrument_aliases
                WHERE instrument_id = ?
                ORDER BY alias
                """,
                (int(instrument_id),),
            ).fetchall()
        ]
        connection.commit()
    return rows


def record_instrument_discovery_event(
    *,
    event_kind: str,
    query: str | None = None,
    provider: str | None = None,
    selected_instrument_id: int | None = None,
    selected_mapping_id: int | None = None,
    candidates: list[dict] | None = None,
    verification_result: dict | None = None,
    failure_reason: str | None = None,
    open_runtime_store: Callable[[], sqlite3.Connection],
    now_iso: Callable[[], str],
) -> dict:
    normalized_kind = _normalize_alias(event_kind) or "unknown"
    now = now_iso()
    with open_runtime_store() as connection:
        cursor = connection.execute(
            """
            INSERT INTO instrument_discovery_events (
                event_kind,
                query,
                provider,
                selected_instrument_id,
                selected_mapping_id,
                candidates_json,
                verification_result_json,
                failure_reason,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                normalized_kind,
                _clean_text(query),
                _normalize_alias(provider) or None,
                selected_instrument_id,
                selected_mapping_id,
                _json_dumps(candidates or []),
                _json_dumps(verification_result or {}),
                _clean_text(failure_reason),
                now,
            ),
        )
        event_id = int(cursor.lastrowid)
        connection.commit()
    return {
        "eventId": event_id,
        "eventKind": normalized_kind,
        "query": _clean_text(query),
        "createdAt": now,
    }


def _score_instrument(row: dict, query: str) -> tuple[int, str] | None:
    normalized_query = _normalize_alias(query)
    compact_query = _compact_text(query)
    normalized_label = _normalize_alias(row.get("display_label"))
    normalized_symbol = _normalize_alias(row.get("canonical_symbol"))
    compact_label = _compact_text(row.get("display_label"))
    compact_symbol = _compact_text(row.get("canonical_symbol"))
    aliases = row.get("aliases") or []
    normalized_aliases = [_normalize_alias(alias) for alias in aliases]
    compact_aliases = [_compact_text(alias) for alias in aliases]
    if not normalized_query:
        return None
    if normalized_label == normalized_query:
        return (240, "exact-label")
    if normalized_symbol == normalized_query:
        return (236, "exact-symbol")
    if normalized_query in normalized_aliases:
        return (232, "exact-alias")
    if compact_query and compact_label == compact_query:
        return (228, "exact-compact-label")
    if compact_query and compact_symbol == compact_query:
        return (224, "exact-compact-symbol")
    if compact_query and compact_query in compact_aliases:
        return (220, "exact-compact-alias")
    if normalized_label.startswith(normalized_query):
        return (184, "starts-with-label")
    if any(alias.startswith(normalized_query) for alias in normalized_aliases):
        return (180, "starts-with-alias")
    if normalized_symbol.startswith(normalized_query):
        return (176, "starts-with-symbol")
    if compact_query and compact_label.startswith(compact_query):
        return (172, "starts-with-compact-label")
    if compact_query and any(alias.startswith(compact_query) for alias in compact_aliases):
        return (168, "starts-with-compact-alias")
    if normalized_query in normalized_label:
        return (150, "contains-label")
    if any(normalized_query in alias for alias in normalized_aliases):
        return (146, "contains-alias")
    if normalized_query in normalized_symbol:
        return (140, "contains-symbol")
    if compact_query and compact_query in compact_label:
        return (138, "contains-compact-label")
    if compact_query and any(compact_query in alias for alias in compact_aliases):
        return (136, "contains-compact-alias")
    return None


def search_instruments(
    query: str,
    *,
    limit: int = 8,
    open_runtime_store: Callable[[], sqlite3.Connection],
) -> list[dict]:
    normalized_query = _normalize_alias(query)
    if not normalized_query:
        return []

    with open_runtime_store() as connection:
        rows = connection.execute(
            """
            SELECT
                instruments.*,
                COALESCE(
                    json_group_array(instrument_aliases.alias) FILTER (
                        WHERE instrument_aliases.alias IS NOT NULL
                    ),
                    '[]'
                ) AS aliases_json
            FROM instruments
            LEFT JOIN instrument_aliases
              ON instrument_aliases.instrument_id = instruments.instrument_id
            GROUP BY instruments.instrument_id
            ORDER BY instruments.display_label
            """
        ).fetchall()

    scored_rows: list[dict] = []
    for row in rows:
        instrument = _row_to_instrument(row)
        if instrument is None:
            continue
        aliases = _json_loads(row["aliases_json"], [])
        scored = _score_instrument(
            {
                "display_label": row["display_label"],
                "canonical_symbol": row["canonical_symbol"],
                "aliases": aliases,
            },
            query,
        )
        if scored is None:
            continue
        match_score, match_kind = scored
        mappings = load_provider_mappings(
            instrument["instrumentId"],
            open_runtime_store=open_runtime_store,
        )
        primary_mapping = mappings[0] if mappings else None
        scored_rows.append(
            {
                "instrument": instrument,
                "mapping": primary_mapping,
                "aliases": aliases,
                "matchScore": match_score,
                "matchKind": match_kind,
            }
        )

    scored_rows.sort(
        key=lambda row: (
            -int(row["matchScore"]),
            0 if row.get("mapping") and row["mapping"].get("verificationStatus") == "verified" else 1,
            0 if row["instrument"].get("verificationStatus") == "verified" else 1,
            0 if row["instrument"].get("status") == "active" else 1,
            len(str(row["instrument"].get("label") or "")),
            str(row["instrument"].get("canonicalSymbol") or ""),
        )
    )
    return scored_rows[: max(1, min(int(limit), 50))]


def build_registry_health(
    *,
    stale_after_days: int = 30,
    open_runtime_store: Callable[[], sqlite3.Connection],
) -> dict:
    now = datetime.utcnow()
    with open_runtime_store() as connection:
        summary = connection.execute(
            """
            SELECT
                (SELECT COUNT(*) FROM instruments) AS total_instruments,
                (SELECT COUNT(*) FROM instruments WHERE verification_status != 'verified') AS unverified_instruments,
                (SELECT COUNT(*) FROM instrument_provider_mappings) AS total_mappings,
                (SELECT COUNT(*) FROM instrument_provider_mappings WHERE verification_status = 'verified') AS verified_mappings,
                (SELECT COUNT(*) FROM instrument_aliases) AS total_aliases,
                (SELECT COUNT(*) FROM instrument_discovery_events) AS total_discovery_events
            """
        ).fetchone()
        by_asset = connection.execute(
            """
            SELECT asset_class, COUNT(*) AS count_value
            FROM instruments
            GROUP BY asset_class
            ORDER BY count_value DESC, asset_class
            """
        ).fetchall()
        by_provider = connection.execute(
            """
            SELECT provider, COUNT(*) AS count_value
            FROM instrument_provider_mappings
            GROUP BY provider
            ORDER BY count_value DESC, provider
            """
        ).fetchall()
        recent_failures = connection.execute(
            """
            SELECT event_kind, query, failure_reason, created_at
            FROM instrument_discovery_events
            WHERE failure_reason IS NOT NULL
            ORDER BY created_at DESC, event_id DESC
            LIMIT 10
            """
        ).fetchall()

    return {
        "version": "instrument-registry-health-v1",
        "generatedAt": now.isoformat() + "Z",
        "thresholds": {
            "staleAfterDays": int(stale_after_days),
        },
        "summary": {
            "totalInstruments": int(summary["total_instruments"] or 0),
            "unverifiedInstruments": int(summary["unverified_instruments"] or 0),
            "totalMappings": int(summary["total_mappings"] or 0),
            "verifiedMappings": int(summary["verified_mappings"] or 0),
            "totalAliases": int(summary["total_aliases"] or 0),
            "totalDiscoveryEvents": int(summary["total_discovery_events"] or 0),
        },
        "byAssetClass": {
            row["asset_class"]: int(row["count_value"] or 0)
            for row in by_asset
        },
        "byProvider": {
            row["provider"]: int(row["count_value"] or 0)
            for row in by_provider
        },
        "recentFailures": [
            {
                "eventKind": row["event_kind"],
                "query": row["query"],
                "failureReason": row["failure_reason"],
                "createdAt": row["created_at"],
            }
            for row in recent_failures
        ],
    }
