from __future__ import annotations

import re
from datetime import datetime, timezone

try:
    import runtime_store
except ModuleNotFoundError:
    from scripts import runtime_store

from . import instrument_service, options_service


SAVED_STUDY_VERSION = "saved-study-v1"
SAVED_STUDY_DEPENDENCY_MANIFEST_VERSION = "saved-study-dependency-manifest-v1"
SAVED_STUDY_READINESS_VERSION = "saved-study-readiness-snapshot-v1"
SAVED_STUDY_LATEST_RUN_LINK_VERSION = "saved-study-latest-run-link-v1"

SUPPORTED_DEPENDENCY_STATUSES = {
    "verified",
    "unverified",
    "stale",
    "conflict",
    "unsupported",
}

INDEX_STYLE_STUDIES = {
    "risk-adjusted-return",
    "rolling-returns",
    "sip-simulator",
    "lumpsum-vs-sip",
    "drawdown-study",
    "seasonality",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_text(value) -> str:
    return str(value or "").strip()


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", _clean_text(value).lower()).strip("-")
    return (slug or "saved-study")[:48]


def _to_base36(value: int) -> str:
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    if value == 0:
        return "0"
    digits: list[str] = []
    current = int(value)
    while current:
        current, remainder = divmod(current, 36)
        digits.append(alphabet[remainder])
    return "".join(reversed(digits))


def _simple_hash(value: str) -> str:
    hash_value = 2166136261
    for char in str(value or ""):
        hash_value ^= ord(char)
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return _to_base36(hash_value)


def _normalize_name(value: str, plan: dict) -> str:
    name = re.sub(r"\s+", " ", _clean_text(value))
    if name:
        return name[:120]
    study_id = _clean_text(plan.get("studyId")) or "Study"
    view_id = _clean_text(plan.get("viewId")) or "overview"
    return f"{study_id} · {view_id}"


def _build_saved_study_id(name: str, route_hash: str, requested_id: str = "") -> str:
    requested = _clean_text(requested_id)
    if requested and len(requested) <= 160:
        return requested
    return f"{_slugify(name)}-{_simple_hash(route_hash)}"


def _clean_dependency_value(value) -> str:
    return re.sub(r"\s+", " ", _clean_text(value))


def _dependency_key(required_capability: str, param_key: str, value: str) -> str:
    return f"{required_capability}:{param_key}:{_clean_dependency_value(value).lower()}"


def _symbol_dependency(
    *,
    param_key: str,
    value: str,
    required_capability: str = "priceHistory",
    label: str | None = None,
) -> dict | None:
    query = _clean_dependency_value(value)
    if not query:
        return None
    return {
        "dependencyKey": _dependency_key(required_capability, param_key, query),
        "dependencyKind": "symbol",
        "label": label or param_key,
        "query": query,
        "symbol": query,
        "universeId": None,
        "requiredCapability": required_capability,
        "verificationStatus": "unverified",
        "issue": {},
        "metadata": {"paramKey": param_key},
    }


def _catalog_dependency(
    *,
    dependency_kind: str,
    param_key: str,
    value: str,
    required_capability: str,
    label: str,
) -> dict | None:
    query = _clean_dependency_value(value)
    if not query:
        return None
    return {
        "dependencyKey": _dependency_key(required_capability, param_key, query),
        "dependencyKind": dependency_kind,
        "label": label,
        "query": query,
        "symbol": None,
        "universeId": query,
        "requiredCapability": required_capability,
        "verificationStatus": "unverified",
        "issue": {},
        "metadata": {"paramKey": param_key},
    }


def extract_saved_study_dependencies(plan: dict) -> list[dict]:
    params = plan.get("params") if isinstance(plan.get("params"), dict) else {}
    study_id = _clean_text(plan.get("studyId"))
    dependencies: list[dict] = []

    if study_id in INDEX_STYLE_STUDIES:
        subject = _symbol_dependency(
            param_key="subject",
            value=params.get("subject"),
            label="Subject",
        )
        if subject:
            dependencies.append(subject)
        if study_id == "risk-adjusted-return":
            benchmark = _symbol_dependency(
                param_key="benchmark",
                value=params.get("benchmark"),
                label="Benchmark",
            )
            if benchmark:
                dependencies.append(benchmark)
    elif study_id == "monthly-straddle":
        subject = params.get("subject")
        for capability in ("optionsUnderlying", "priceHistory"):
            dependency = _symbol_dependency(
                param_key="subject",
                value=subject,
                required_capability=capability,
                label="Underlying",
            )
            if dependency:
                dependencies.append(dependency)
    elif study_id in {"options-screener", "options-validation"}:
        universe = _catalog_dependency(
            dependency_kind="options-universe",
            param_key="u",
            value=params.get("u"),
            required_capability="optionsUniverse",
            label="Options universe",
        )
        if universe:
            dependencies.append(universe)
    elif study_id == "sector-snapshot":
        market = _catalog_dependency(
            dependency_kind="sector-market",
            param_key="market",
            value=params.get("market"),
            required_capability="sectorMarket",
            label="Sector market",
        )
        if market:
            dependencies.append(market)
    else:
        dependencies.append(
            {
                "dependencyKey": f"unsupported:study:{study_id or 'unknown'}",
                "dependencyKind": "study",
                "label": "Unsupported study",
                "query": study_id,
                "symbol": None,
                "universeId": None,
                "requiredCapability": "unsupported",
                "verificationStatus": "unsupported",
                "issue": {
                    "code": "study.unsupported",
                    "message": "This study does not expose saved-study dependency extraction yet.",
                },
                "metadata": {},
            }
        )

    deduped: dict[str, dict] = {}
    for dependency in dependencies:
        deduped[dependency["dependencyKey"]] = dependency
    return list(deduped.values())


def _find_verified_mapping(query: str, required_capability: str) -> tuple[dict | None, dict | None]:
    instrument_service.seed_builtin_instruments()
    for result in runtime_store.search_instruments(query, limit=8):
        instrument = result.get("instrument")
        mapping = result.get("mapping")
        if not instrument or not mapping:
            continue
        capabilities = mapping.get("capabilities") or {}
        if (
            mapping.get("verificationStatus") == "verified"
            and capabilities.get(required_capability) is True
        ):
            return instrument, mapping
    return None, None


def _resolve_dependency(dependency: dict) -> dict:
    required_capability = _clean_text(dependency.get("requiredCapability"))
    resolved = {**dependency}
    if dependency.get("dependencyKind") == "options-universe":
        universe_id = _clean_text(dependency.get("universeId") or dependency.get("query"))
        if universe_id in options_service.COLLECTOR_UNIVERSES:
            return {
                **resolved,
                "verificationStatus": "verified",
                "issue": {},
                "metadata": {
                    **(resolved.get("metadata") or {}),
                    "source": "options-collector-catalog",
                },
            }
        return {
            **resolved,
            "verificationStatus": "unsupported",
            "issue": {
                "code": "options_universe.unsupported",
                "message": f"Options universe {universe_id or 'unknown'} is not configured.",
            },
        }

    if dependency.get("dependencyKind") == "sector-market":
        return {
            **resolved,
            "verificationStatus": "verified" if _clean_text(dependency.get("query")) else "unsupported",
            "issue": {},
            "metadata": {
                **(resolved.get("metadata") or {}),
                "source": "sector-market-route-param",
            },
        }

    if required_capability in {"priceHistory", "optionsUnderlying"}:
        instrument, mapping = _find_verified_mapping(
            dependency.get("query") or dependency.get("symbol") or "",
            required_capability,
        )
        if instrument and mapping:
            return {
                **resolved,
                "symbol": mapping.get("providerSymbol") or dependency.get("symbol"),
                "instrumentId": instrument.get("instrumentId"),
                "mappingId": mapping.get("mappingId"),
                "verificationStatus": "verified",
                "issue": {},
                "metadata": {
                    **(resolved.get("metadata") or {}),
                    "provider": mapping.get("provider"),
                    "providerSymbol": mapping.get("providerSymbol"),
                },
            }
        return {
            **resolved,
            "verificationStatus": "unverified",
            "issue": {
                "code": "dependency.unverified",
                "message": (
                    f"{dependency.get('label') or 'Dependency'} is not verified for "
                    f"{required_capability} yet."
                ),
            },
        }

    if dependency.get("verificationStatus") not in SUPPORTED_DEPENDENCY_STATUSES:
        return {
            **resolved,
            "verificationStatus": "unsupported",
            "issue": {
                "code": "dependency.unsupported",
                "message": f"Unsupported dependency capability: {required_capability or 'unknown'}.",
            },
        }
    return resolved


def build_dependency_manifest(plan: dict) -> dict:
    dependencies = [_resolve_dependency(dependency) for dependency in extract_saved_study_dependencies(plan)]
    return {
        "version": SAVED_STUDY_DEPENDENCY_MANIFEST_VERSION,
        "generatedAt": _now_iso(),
        "dependencies": dependencies,
    }


def build_readiness_snapshot(dependencies: list[dict]) -> dict:
    issues = [
        {
            "dependencyKey": dependency.get("dependencyKey"),
            "status": dependency.get("verificationStatus"),
            **(dependency.get("issue") or {}),
        }
        for dependency in dependencies
        if dependency.get("verificationStatus") != "verified"
    ]
    status = "ok" if not issues else "attention"
    counts: dict[str, int] = {}
    for dependency in dependencies:
        key = _clean_text(dependency.get("verificationStatus")) or "unknown"
        counts[key] = counts.get(key, 0) + 1
    return {
        "version": SAVED_STUDY_READINESS_VERSION,
        "generatedAt": _now_iso(),
        "status": status,
        "dependencyCount": len(dependencies),
        "counts": counts,
        "issues": issues,
    }


def _latest_run_link_for_route(route_hash: str) -> dict | None:
    if not _clean_text(route_hash):
        return None
    for run in runtime_store.list_study_runs(limit=200):
        if run.get("routeHash") == route_hash:
            return {
                "version": SAVED_STUDY_LATEST_RUN_LINK_VERSION,
                "runId": run.get("runId"),
                "status": run.get("status"),
                "completedAt": run.get("completedAt"),
                "studyId": run.get("studyId"),
                "routeHash": route_hash,
            }
    return None


def _persist_saved_study_artifacts(saved_study: dict, manifest: dict, readiness: dict) -> dict:
    saved_study_id = saved_study["id"]
    runtime_store.replace_saved_study_dependencies(saved_study_id, manifest["dependencies"])
    runtime_store.append_saved_study_artifact(
        saved_study_id,
        artifact_type="study-plan",
        artifact_version="study-plan-v1",
        artifact=saved_study["plan"],
    )
    runtime_store.append_saved_study_artifact(
        saved_study_id,
        artifact_type="dependency-manifest",
        artifact_version=SAVED_STUDY_DEPENDENCY_MANIFEST_VERSION,
        artifact=manifest,
    )
    runtime_store.append_saved_study_artifact(
        saved_study_id,
        artifact_type="readiness-snapshot",
        artifact_version=SAVED_STUDY_READINESS_VERSION,
        artifact=readiness,
    )
    latest_run_link = _latest_run_link_for_route(saved_study["routeHash"])
    if latest_run_link:
        runtime_store.append_saved_study_artifact(
            saved_study_id,
            artifact_type="latest-run-link",
            artifact_version=SAVED_STUDY_LATEST_RUN_LINK_VERSION,
            artifact=latest_run_link,
        )
    loaded = runtime_store.load_saved_study(saved_study_id, include_archived=True)
    if loaded is None:
        raise RuntimeError("Saved study could not be reloaded with artifacts.")
    return loaded


def save_validated_saved_study(request: dict) -> dict:
    if not isinstance(request, dict):
        raise ValueError("Saved study request must be a JSON object.")
    plan = request.get("plan")
    if not isinstance(plan, dict) or plan.get("version") != "study-plan-v1":
        raise ValueError("A validated study-plan-v1 plan is required.")
    route_hash = _clean_text(request.get("routeHash") or (request.get("preview") or {}).get("routeHash"))
    if not route_hash:
        raise ValueError("Saved study route hash is required.")

    name = _normalize_name(request.get("name"), plan)
    saved_study_id = _build_saved_study_id(name, route_hash, _clean_text(request.get("id")))
    manifest = build_dependency_manifest(plan)
    readiness = build_readiness_snapshot(manifest["dependencies"])
    saved = runtime_store.upsert_saved_study(
        {
            "id": saved_study_id,
            "version": SAVED_STUDY_VERSION,
            "name": name,
            "status": "active",
            "studyId": plan.get("studyId"),
            "viewId": plan.get("viewId"),
            "routeHash": route_hash,
            "plan": plan,
            "keepWarm": request.get("keepWarm", True),
            "notes": request.get("notes"),
        }
    )
    saved = _persist_saved_study_artifacts(saved, manifest, readiness)
    return {
        "version": SAVED_STUDY_VERSION,
        "ok": True,
        "savedStudy": saved,
        "savedStudies": runtime_store.list_saved_studies(),
    }


def build_saved_study_state_payload(request: dict | None = None) -> dict:
    if request is None:
        request = {}
    if not isinstance(request, dict):
        raise ValueError("Saved study request must be a JSON object.")
    try:
        limit = int(request.get("limit") or 50)
    except (TypeError, ValueError) as error:
        raise ValueError("Saved study limit must be an integer.") from error
    include_archived = str(request.get("includeArchived") or "").strip().lower() in {"1", "true", "yes"}
    saved_study_id = _clean_text(request.get("id") or request.get("savedStudyId"))
    if saved_study_id:
        saved_study = runtime_store.load_saved_study(
            saved_study_id,
            include_archived=include_archived,
        )
        if saved_study is None:
            return {
                "version": SAVED_STUDY_VERSION,
                "savedStudies": [],
                "savedStudy": None,
                "limit": max(1, min(limit, 200)),
            }
        return {
            "version": SAVED_STUDY_VERSION,
            "savedStudies": [saved_study],
            "savedStudy": saved_study,
            "limit": max(1, min(limit, 200)),
        }
    return {
        "version": SAVED_STUDY_VERSION,
        "savedStudies": runtime_store.list_saved_studies(
            limit=max(1, min(limit, 200)),
            include_archived=include_archived,
        ),
        "savedStudy": None,
        "limit": max(1, min(limit, 200)),
    }


def archive_saved_study(request: dict | None) -> dict:
    if not isinstance(request, dict):
        raise ValueError("Saved study request must be a JSON object.")
    saved_study_id = _clean_text(request.get("id") or request.get("savedStudyId"))
    if not saved_study_id:
        raise ValueError("Saved study id is required.")
    saved = runtime_store.archive_saved_study(saved_study_id)
    return {
        "version": SAVED_STUDY_VERSION,
        "ok": saved is not None,
        "savedStudy": saved,
        "savedStudies": runtime_store.list_saved_studies(),
    }


def refresh_saved_study_readiness(request: dict | None) -> dict:
    if not isinstance(request, dict):
        raise ValueError("Saved study request must be a JSON object.")
    saved_study_id = _clean_text(request.get("id") or request.get("savedStudyId"))
    if not saved_study_id:
        raise ValueError("Saved study id is required.")
    saved = runtime_store.load_saved_study(saved_study_id, include_archived=True)
    if saved is None:
        raise ValueError("Saved study was not found.")

    manifest = build_dependency_manifest(saved["plan"])
    readiness = build_readiness_snapshot(manifest["dependencies"])
    runtime_store.replace_saved_study_dependencies(saved_study_id, manifest["dependencies"])
    runtime_store.append_saved_study_artifact(
        saved_study_id,
        artifact_type="dependency-manifest",
        artifact_version=SAVED_STUDY_DEPENDENCY_MANIFEST_VERSION,
        artifact=manifest,
    )
    runtime_store.append_saved_study_artifact(
        saved_study_id,
        artifact_type="readiness-snapshot",
        artifact_version=SAVED_STUDY_READINESS_VERSION,
        artifact=readiness,
    )
    latest_run_link = _latest_run_link_for_route(saved["routeHash"])
    if latest_run_link:
        runtime_store.append_saved_study_artifact(
            saved_study_id,
            artifact_type="latest-run-link",
            artifact_version=SAVED_STUDY_LATEST_RUN_LINK_VERSION,
            artifact=latest_run_link,
        )
    runtime_store.record_saved_study_refresh_run(
        saved_study_id,
        status=readiness["status"],
        details=readiness,
        refreshed_count=readiness["counts"].get("verified", 0),
        skipped_count=0,
        failed_count=len(readiness["issues"]),
    )
    reloaded = runtime_store.load_saved_study(saved_study_id, include_archived=True)
    return {
        "version": SAVED_STUDY_VERSION,
        "ok": True,
        "savedStudy": reloaded,
        "savedStudies": runtime_store.list_saved_studies(),
    }


def refresh_saved_study_readiness_batch(request: dict | None = None) -> dict:
    if request is None:
        request = {}
    if not isinstance(request, dict):
        raise ValueError("Saved study request must be a JSON object.")

    try:
        limit = int(request.get("limit") or 200)
    except (TypeError, ValueError) as error:
        raise ValueError("Saved study limit must be an integer.") from error
    normalized_limit = max(1, min(limit, 200))
    include_archived = str(request.get("includeArchived") or "").strip().lower() in {"1", "true", "yes"}
    include_cold = str(request.get("includeCold") or "").strip().lower() in {"1", "true", "yes"}

    saved_studies = runtime_store.list_saved_studies(
        limit=normalized_limit,
        include_archived=include_archived,
    )
    results: list[dict] = []
    skipped: list[dict] = []
    failures: list[dict] = []

    for saved_study in saved_studies:
        saved_study_id = saved_study["id"]
        if not include_cold and not saved_study.get("keepWarm", True):
            skipped.append(
                {
                    "savedStudyId": saved_study_id,
                    "name": saved_study.get("name"),
                    "reason": "keepWarm=false",
                }
            )
            continue
        try:
            refreshed = refresh_saved_study_readiness({"id": saved_study_id})["savedStudy"]
            readiness = refreshed.get("readiness") or {}
            results.append(
                {
                    "savedStudyId": saved_study_id,
                    "name": refreshed.get("name"),
                    "readinessStatus": readiness.get("status"),
                    "dependencyCount": readiness.get("dependencyCount", 0),
                    "latestRefreshRun": refreshed.get("latestRefreshRun"),
                }
            )
        except Exception as error:  # noqa: BLE001
            failures.append(
                {
                    "savedStudyId": saved_study_id,
                    "name": saved_study.get("name"),
                    "error": str(error),
                }
            )

    return {
        "version": SAVED_STUDY_VERSION,
        "ok": not failures,
        "status": "ok" if not failures else "attention",
        "includeArchived": include_archived,
        "includeCold": include_cold,
        "requestedCount": len(saved_studies),
        "refreshedCount": len(results),
        "skippedCount": len(skipped),
        "failedCount": len(failures),
        "results": results,
        "skipped": skipped,
        "failures": failures,
        "savedStudies": runtime_store.list_saved_studies(
            limit=normalized_limit,
            include_archived=include_archived,
        ),
    }


def saved_study_to_recipe(saved_study: dict) -> dict:
    return {
        "id": saved_study["id"],
        "version": "study-plan-recipes-v1",
        "name": saved_study["name"],
        "routeHash": saved_study["routeHash"],
        "studyId": saved_study["studyId"],
        "viewId": saved_study["viewId"],
        "plan": saved_study["plan"],
        "createdAt": saved_study["createdAt"],
        "updatedAt": saved_study["updatedAt"],
        "savedStudy": saved_study,
        "readiness": saved_study.get("readiness"),
        "dependencies": saved_study.get("dependencies") or [],
    }


def link_run_to_matching_saved_studies(run: dict) -> list[dict]:
    route_hash = _clean_text(run.get("routeHash"))
    if not route_hash:
        return []
    linked: list[dict] = []
    for saved_study in runtime_store.find_saved_studies_by_route_hash(route_hash):
        runtime_store.append_saved_study_artifact(
            saved_study["id"],
            artifact_type="latest-run-link",
            artifact_version=SAVED_STUDY_LATEST_RUN_LINK_VERSION,
            artifact={
                "version": SAVED_STUDY_LATEST_RUN_LINK_VERSION,
                "runId": run.get("runId"),
                "status": run.get("status"),
                "completedAt": run.get("completedAt"),
                "studyId": run.get("studyId"),
                "routeHash": route_hash,
            },
        )
        loaded = runtime_store.load_saved_study(saved_study["id"], include_archived=True)
        if loaded:
            linked.append(loaded)
    return linked
