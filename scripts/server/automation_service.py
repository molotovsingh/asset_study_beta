from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock

try:
    from runtime_store import (
        delete_automation_config,
        list_automation_configs,
        load_automation_config,
        load_due_automation_configs,
        update_automation_run_state,
        upsert_automation_config,
    )
except ModuleNotFoundError:
    from scripts.runtime_store import (
        delete_automation_config,
        list_automation_configs,
        load_automation_config,
        load_due_automation_configs,
        update_automation_run_state,
        upsert_automation_config,
    )

from . import maintenance_service, options_service


_AUTOMATION_RUN_LOCK = Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_automation_template() -> dict:
    return {
        "automationId": "daily-maintenance",
        "label": "Daily Maintenance",
        "kind": "data-maintenance",
        "scheduleType": "interval",
        "intervalMinutes": 1440,
        "runMarketCollection": True,
        "marketUniverseIds": [],
        "runOptionsCollection": True,
        "optionsUniverseIds": sorted(options_service.COLLECTOR_UNIVERSES.keys()),
        "refreshExchangeSymbolMasters": False,
        "marketProviderOrder": ["finnhub", "yfinance"],
        "marketFullSync": False,
        "marketLimit": None,
        "optionsMinimumDte": None,
        "optionsMaxContracts": None,
        "healthStaleAfterDays": 7,
        "healthSymbolLimit": 20,
        "healthUniverseLimit": 20,
        "healthRunLimit": 10,
        "maxAttentionSymbols": None,
        "maxSyncErrors": None,
        "isActive": True,
    }


def _available_market_universes() -> list[dict]:
    return [
        {
            "universeId": str(universe.get("universeId") or ""),
            "label": universe.get("label"),
            "selectionKind": universe.get("selectionKind"),
            "exchange": universe.get("exchange"),
            "mic": universe.get("mic"),
            "activeMembers": universe.get("activeMembers"),
        }
        for universe in maintenance_service.list_symbol_universes()
    ]


def _available_options_universes() -> list[dict]:
    return [
        {
            "universeId": config["universeId"],
            "label": config["universeLabel"],
            "minimumDte": config["minimumDte"],
            "maxContracts": config["maxContracts"],
            "symbolCount": len(config.get("symbols") or []),
        }
        for config in options_service.COLLECTOR_UNIVERSES.values()
    ]


def _hydrate_automation_config(automation: dict | None) -> dict | None:
    if automation is None:
        return None
    hydrated = dict(automation)
    defaults = _default_automation_template()
    if not hydrated.get("marketProviderOrder"):
        hydrated["marketProviderOrder"] = list(defaults["marketProviderOrder"])
    return hydrated


def build_automation_state_payload() -> dict:
    automations = [
        _hydrate_automation_config(automation)
        for automation in list_automation_configs()
    ]
    return {
        "automations": automations,
        "defaults": _default_automation_template(),
        "catalogs": {
            "marketUniverses": _available_market_universes(),
            "optionsUniverses": _available_options_universes(),
        },
    }


def _normalize_boolean(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _normalize_string_list(value, *, lower: bool = False) -> list[str]:
    if isinstance(value, str):
        candidates = [part.strip() for part in value.split(",")]
    elif isinstance(value, list):
        candidates = [str(part or "").strip() for part in value]
    else:
        candidates = []
    normalized: list[str] = []
    for candidate in candidates:
        text = candidate.lower() if lower else candidate
        if not text or text in normalized:
            continue
        normalized.append(text)
    return normalized


def _clean_optional_int(value, *, label: str, minimum: int | None = None, maximum: int | None = None) -> int | None:
    if value in (None, ""):
        return None
    try:
        normalized = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} must be an integer.") from error
    if minimum is not None and normalized < minimum:
        raise ValueError(f"{label} must be at least {minimum}.")
    if maximum is not None and normalized > maximum:
        raise ValueError(f"{label} must be at most {maximum}.")
    return normalized


def _normalize_automation_request(request: dict) -> dict:
    automation_id = str(request.get("automationId") or request.get("id") or "").strip().lower()
    if not automation_id:
        raise ValueError("Automation id is required.")

    label = str(request.get("label") or "").strip()
    if not label:
        raise ValueError("Automation label is required.")

    schedule_type = str(request.get("scheduleType") or "interval").strip()
    if schedule_type != "interval":
        raise ValueError("Only interval-based automations are supported right now.")

    interval_minutes = _clean_optional_int(
        request.get("intervalMinutes"),
        label="intervalMinutes",
        minimum=1,
        maximum=7 * 24 * 60,
    ) or 1440

    defaults = _default_automation_template()

    market_universe_ids = _normalize_string_list(request.get("marketUniverseIds"), lower=True)
    options_universe_ids = _normalize_string_list(request.get("optionsUniverseIds"))
    market_provider_order = _normalize_string_list(request.get("marketProviderOrder"), lower=True)
    if not market_provider_order:
        market_provider_order = list(defaults["marketProviderOrder"])
    invalid_options_universe_ids = [
        universe_id
        for universe_id in options_universe_ids
        if universe_id not in options_service.COLLECTOR_UNIVERSES
    ]
    if invalid_options_universe_ids:
        raise ValueError(
            f"Unknown options automation universe(s): {', '.join(invalid_options_universe_ids)}",
        )

    return {
        "automationId": automation_id,
        "label": label,
        "kind": "data-maintenance",
        "scheduleType": schedule_type,
        "intervalMinutes": interval_minutes,
        "runMarketCollection": _normalize_boolean(request.get("runMarketCollection", True)),
        "marketUniverseIds": market_universe_ids,
        "runOptionsCollection": _normalize_boolean(request.get("runOptionsCollection", True)),
        "optionsUniverseIds": options_universe_ids,
        "refreshExchangeSymbolMasters": _normalize_boolean(request.get("refreshExchangeSymbolMasters", False)),
        "marketProviderOrder": market_provider_order,
        "marketFullSync": _normalize_boolean(request.get("marketFullSync", False)),
        "marketLimit": _clean_optional_int(request.get("marketLimit"), label="marketLimit", minimum=1, maximum=5000),
        "optionsMinimumDte": _clean_optional_int(request.get("optionsMinimumDte"), label="optionsMinimumDte", minimum=1, maximum=365),
        "optionsMaxContracts": _clean_optional_int(request.get("optionsMaxContracts"), label="optionsMaxContracts", minimum=1, maximum=20),
        "healthStaleAfterDays": _clean_optional_int(request.get("healthStaleAfterDays"), label="healthStaleAfterDays", minimum=1, maximum=365) or 7,
        "healthSymbolLimit": _clean_optional_int(request.get("healthSymbolLimit"), label="healthSymbolLimit", minimum=1, maximum=200) or 20,
        "healthUniverseLimit": _clean_optional_int(request.get("healthUniverseLimit"), label="healthUniverseLimit", minimum=1, maximum=100) or 20,
        "healthRunLimit": _clean_optional_int(request.get("healthRunLimit"), label="healthRunLimit", minimum=1, maximum=100) or 10,
        "maxAttentionSymbols": _clean_optional_int(request.get("maxAttentionSymbols"), label="maxAttentionSymbols", minimum=0, maximum=10000),
        "maxSyncErrors": _clean_optional_int(request.get("maxSyncErrors"), label="maxSyncErrors", minimum=0, maximum=10000),
        "isActive": _normalize_boolean(request.get("isActive", True)),
    }


def save_automation_config(request: dict) -> dict:
    automation = _hydrate_automation_config(
        upsert_automation_config(_normalize_automation_request(request))
    )
    return {
        "automation": automation,
        "state": build_automation_state_payload(),
    }


def remove_automation_config(request: dict) -> dict:
    automation_id = str(request.get("automationId") or "").strip().lower()
    if not automation_id:
        raise ValueError("Automation id is required.")
    deleted = delete_automation_config(automation_id)
    if not deleted:
        raise RuntimeError(f"Automation {automation_id} does not exist.")
    return {
        "deletedAutomationId": automation_id,
        "state": build_automation_state_payload(),
    }


def execute_automation(automation_id: str) -> dict:
    automation = _hydrate_automation_config(load_automation_config(automation_id))
    if automation is None:
        raise RuntimeError(f"Automation {automation_id} does not exist.")
    if automation.get("isRunning"):
        raise RuntimeError(f"Automation {automation_id} is already running.")

    started_at = _now_iso()
    with _AUTOMATION_RUN_LOCK:
        current = _hydrate_automation_config(load_automation_config(automation_id))
        if current is None:
            raise RuntimeError(f"Automation {automation_id} does not exist.")
        if current.get("isRunning"):
            raise RuntimeError(f"Automation {automation_id} is already running.")

        update_automation_run_state(
            automation_id,
            is_running=True,
            started_at=started_at,
            completed_at=None,
            status="running",
            summary={},
            error=None,
        )

        try:
            payload = maintenance_service.run_data_maintenance(
                market_universe_ids=current.get("marketUniverseIds"),
                options_universe_ids=current.get("optionsUniverseIds"),
                run_market_collection=bool(current.get("runMarketCollection")),
                run_options_collection=bool(current.get("runOptionsCollection")),
                refresh_exchange_symbol_masters=bool(current.get("refreshExchangeSymbolMasters")),
                market_provider_order=current.get("marketProviderOrder"),
                market_full_sync=bool(current.get("marketFullSync")),
                market_limit=current.get("marketLimit"),
                options_minimum_dte=current.get("optionsMinimumDte"),
                options_max_contracts=current.get("optionsMaxContracts"),
                health_stale_after_days=current.get("healthStaleAfterDays") or 7,
                health_symbol_limit=current.get("healthSymbolLimit") or 20,
                health_universe_limit=current.get("healthUniverseLimit") or 20,
                health_run_limit=current.get("healthRunLimit") or 10,
                max_attention_symbols=current.get("maxAttentionSymbols"),
                max_sync_errors=current.get("maxSyncErrors"),
            )
        except Exception as error:  # noqa: BLE001
            completed_at = _now_iso()
            automation = update_automation_run_state(
                automation_id,
                is_running=False,
                completed_at=completed_at,
                status="error",
                summary={},
                error=str(error),
            )
            if automation is None:
                raise
            return {
                "automation": automation,
                "result": {
                    "status": "error",
                    "failureReasons": [str(error)],
                },
            }

        completed_at = _now_iso()
        last_status = "ok" if payload.get("status") == "ok" else "attention"
        automation = update_automation_run_state(
            automation_id,
            is_running=False,
            completed_at=completed_at,
            status=last_status,
            summary=payload,
            error=None,
        )
        if automation is None:
            raise RuntimeError(f"Automation {automation_id} disappeared after execution.")
        return {
            "automation": automation,
            "result": payload,
        }


def run_automation_now(request: dict) -> dict:
    automation_id = str(request.get("automationId") or "").strip().lower()
    if not automation_id:
        raise ValueError("Automation id is required.")
    execution = execute_automation(automation_id)
    return {
        **execution,
        "state": build_automation_state_payload(),
    }


def run_due_automations() -> dict:
    due_automations = load_due_automation_configs()
    executions = []
    failures = []
    for automation in due_automations:
        automation_id = str(automation.get("automationId") or "").strip().lower()
        if not automation_id:
            continue
        try:
            executions.append(execute_automation(automation_id))
        except Exception as error:  # noqa: BLE001
            failures.append(
                {
                    "automationId": automation_id,
                    "error": str(error),
                }
            )
    return {
        "dueCount": len(due_automations),
        "executedCount": len(executions),
        "failureCount": len(failures),
        "executions": executions,
        "failures": failures,
    }
