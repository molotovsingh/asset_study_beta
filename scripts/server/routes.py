from __future__ import annotations

from . import (
    assistant_service,
    automation_service,
    index_service,
    instrument_service,
    ops_service,
    options_service,
    saved_study_service,
    study_factory_service,
    study_builder_service,
    study_run_service,
)


class UnknownApiRouteError(LookupError):
    pass


class ApiResourceNotFoundError(LookupError):
    pass


def get_yfinance_catalog(_request: dict) -> dict:
    return index_service.build_catalog_payload()


def get_system_runtime_health(_request: dict) -> dict:
    return ops_service.build_runtime_health_payload({})


def get_automations(_request: dict) -> dict:
    return automation_service.build_automation_state_payload()


def get_study_runs(request: dict) -> dict:
    return study_run_service.build_study_run_history_payload(request or {})


def get_assistant_contract(request: dict) -> dict:
    return assistant_service.build_assistant_contract_payload(request or {})


def get_assistant_contract_bundle(request: dict) -> dict:
    return assistant_service.build_assistant_contract_bundle_payload(request or {})


def get_assistant_readiness(request: dict) -> dict:
    return assistant_service.build_assistant_readiness_payload(request or {})


def get_study_builder_recipes(request: dict) -> dict:
    return study_builder_service.build_study_plan_recipe_state_payload(request or {})


def get_saved_studies(request: dict) -> dict:
    return saved_study_service.build_saved_study_state_payload(request or {})


def post_symbols_discover(request: dict) -> dict:
    return instrument_service.build_symbol_discovery_payload(request)


def post_symbols_verify(request: dict) -> dict:
    return instrument_service.build_symbol_verification_payload(request)


def post_symbols_register_manual(request: dict) -> dict:
    return instrument_service.build_manual_symbol_registration_payload(request)


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


def post_options_trade_validation(request: dict) -> dict:
    return options_service.build_trade_validation_response(request)


def post_automations_save(request: dict) -> dict:
    return automation_service.save_automation_config(request)


def post_automations_delete(request: dict) -> dict:
    return automation_service.remove_automation_config(request)


def post_automations_run(request: dict) -> dict:
    return automation_service.run_automation_now(request)


def post_study_runs_record(request: dict) -> dict:
    return study_run_service.record_study_run_entry(request)


def post_study_builder_plan(request: dict) -> dict:
    return study_builder_service.build_study_builder_plan_payload(request)


def post_study_builder_validate(request: dict) -> dict:
    return study_builder_service.build_study_builder_validation_payload(request)


def post_study_builder_recipes_save(request: dict) -> dict:
    return study_builder_service.save_study_plan_recipe(request)


def post_study_builder_recipes_delete(request: dict) -> dict:
    return study_builder_service.remove_study_plan_recipe(request)


def post_saved_studies_save(request: dict) -> dict:
    return study_builder_service.save_saved_study(request)


def post_saved_studies_archive(request: dict) -> dict:
    return saved_study_service.archive_saved_study(request)


def post_saved_studies_refresh_readiness(request: dict) -> dict:
    return saved_study_service.refresh_saved_study_readiness(request)


def post_study_factory_proposal(request: dict) -> dict:
    return study_factory_service.build_study_proposal_payload(request)


def post_assistant_study_run_brief(request: dict) -> dict:
    try:
        return assistant_service.build_study_run_brief_payload(request)
    except assistant_service.StudyRunNotFoundError as error:
        raise ApiResourceNotFoundError(str(error)) from error


def post_assistant_study_plan_dry_run(request: dict) -> dict:
    return assistant_service.build_assistant_study_plan_dry_run_payload(request)


def post_assistant_study_plan_live_draft(request: dict) -> dict:
    return assistant_service.build_assistant_study_plan_live_draft_payload(request)


GET_ROUTE_HANDLERS = {
    "/api/automations": get_automations,
    "/api/assistant/contract": get_assistant_contract,
    "/api/assistant/contract-bundle": get_assistant_contract_bundle,
    "/api/assistant/readiness": get_assistant_readiness,
    "/api/saved-studies": get_saved_studies,
    "/api/study-builder/recipes": get_study_builder_recipes,
    "/api/study-runs": get_study_runs,
    "/api/system/runtime-health": get_system_runtime_health,
    "/api/yfinance/catalog": get_yfinance_catalog,
}

POST_ROUTE_HANDLERS = {
    "/api/automations/delete": post_automations_delete,
    "/api/automations/run": post_automations_run,
    "/api/automations/save": post_automations_save,
    "/api/assistant/study-plan-dry-run": post_assistant_study_plan_dry_run,
    "/api/assistant/study-plan-live-draft": post_assistant_study_plan_live_draft,
    "/api/assistant/study-run-brief": post_assistant_study_run_brief,
    "/api/saved-studies/archive": post_saved_studies_archive,
    "/api/saved-studies/refresh-readiness": post_saved_studies_refresh_readiness,
    "/api/saved-studies/save": post_saved_studies_save,
    "/api/study-builder/plan": post_study_builder_plan,
    "/api/study-factory/proposal": post_study_factory_proposal,
    "/api/study-builder/recipes/delete": post_study_builder_recipes_delete,
    "/api/study-builder/recipes/save": post_study_builder_recipes_save,
    "/api/study-builder/validate": post_study_builder_validate,
    "/api/study-runs/record": post_study_runs_record,
    "/api/symbols/discover": post_symbols_discover,
    "/api/symbols/register-manual": post_symbols_register_manual,
    "/api/symbols/verify": post_symbols_verify,
    "/api/yfinance/instrument-profile": post_yfinance_instrument_profile,
    "/api/yfinance/index-series": post_yfinance_index_series,
    "/api/yfinance/monthly-straddle": post_yfinance_monthly_straddle,
    "/api/options/screener-snapshot": post_options_screener_snapshot,
    "/api/options/screener-history": post_options_screener_history,
    "/api/options/screener-validation": post_options_screener_validation,
    "/api/options/trade-validation": post_options_trade_validation,
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
    return handler({} if request is None else request)
