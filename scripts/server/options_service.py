from __future__ import annotations

try:
    from providers.yfinance_provider import (
        OptionContractNotMarkableError,
        fetch_exact_contract_quote,
        fetch_monthly_straddle_snapshot,
    )
except ModuleNotFoundError:
    from scripts.providers.yfinance_provider import (
        OptionContractNotMarkableError,
        fetch_exact_contract_quote,
        fetch_monthly_straddle_snapshot,
    )

from .options import constants as _constants
from .options import metrics as _metrics
from .options import screener as _screener
from .options import tracking as _tracking
from .options import validation as _validation

OPTIONS_SCREENER_MAX_SYMBOLS = _constants.OPTIONS_SCREENER_MAX_SYMBOLS
OPTIONS_SCREENER_FETCH_CONCURRENCY = _constants.OPTIONS_SCREENER_FETCH_CONCURRENCY
OPTIONS_SIGNAL_VERSION = _constants.OPTIONS_SIGNAL_VERSION
TRADE_IDEA_DEFINITIONS = _constants.TRADE_IDEA_DEFINITIONS
TRADE_VALIDATION_GROUP_DEFINITIONS = _constants.TRADE_VALIDATION_GROUP_DEFINITIONS
TRADE_VALIDATION_HORIZONS = _constants.TRADE_VALIDATION_HORIZONS
TRACKED_STRATEGY_BY_CANDIDATE_BUCKET = _constants.TRACKED_STRATEGY_BY_CANDIDATE_BUCKET
COLLECTOR_UNIVERSES = _constants.COLLECTOR_UNIVERSES

clean_history_number = _metrics.clean_history_number
clamp = _metrics.clamp
mean = _metrics.mean
median = _metrics.median
score_to_bias_label = _metrics.score_to_bias_label
extract_snapshot_series = _metrics.extract_snapshot_series
latest_sma = _metrics.latest_sma
trailing_return = _metrics.trailing_return
build_trend_context = _metrics.build_trend_context
build_month_end_rows = _metrics.build_month_end_rows
month_distance = _metrics.month_distance
build_seasonality_context = _metrics.build_seasonality_context
build_direction_context = _metrics.build_direction_context
percentile_rank = _metrics.percentile_rank
options_pricing_label = _metrics.options_pricing_label
options_pricing_bucket = _metrics.options_pricing_bucket
compute_vol_pricing_score = _metrics.compute_vol_pricing_score
compute_execution_score = _metrics.compute_execution_score
compute_confidence_score = _metrics.compute_confidence_score
build_candidate_advisory = _metrics.build_candidate_advisory
get_trade_idea_definition = _metrics.get_trade_idea_definition
compute_cross_sectional_rank = _metrics.compute_cross_sectional_rank
build_term_structure_context = _metrics.build_term_structure_context
build_trade_idea_matches = _metrics.build_trade_idea_matches

build_screener_history_summary = _screener.build_screener_history_summary
build_options_screener_storage_row = _screener.build_options_screener_storage_row
decorate_options_screener_storage_rows = _screener.decorate_options_screener_storage_rows
summarize_options_screener_run = _screener.summarize_options_screener_run

direction_bucket = _validation.direction_bucket
build_forward_validation_observation = _validation.build_forward_validation_observation
build_options_screener_validation_payload = _validation.build_options_screener_validation_payload
normalize_trade_validation_group_key = _validation.normalize_trade_validation_group_key
normalize_trade_validation_horizon = _validation.normalize_trade_validation_horizon
normalize_trade_validation_bucket_label = _validation.normalize_trade_validation_bucket_label
build_trade_validation_observation = _validation.build_trade_validation_observation
build_trade_validation_payload = _validation.build_trade_validation_payload

candidate_bucket_to_strategy = _tracking.candidate_bucket_to_strategy
strikes_match = _tracking.strikes_match
compute_entry_executable_value = _tracking.compute_entry_executable_value
compute_mark_executable_value = _tracking.compute_mark_executable_value
compute_trade_edge_amount = _tracking.compute_trade_edge_amount
build_mark_payload_from_contract = _tracking.build_mark_payload_from_contract
load_or_refresh_price_rows = _tracking.load_or_refresh_price_rows
build_tracked_position_from_screener_row = _tracking.build_tracked_position_from_screener_row
build_intrinsic_settlement_mark = _tracking.build_intrinsic_settlement_mark


def _sync_runtime_overrides() -> None:
    _screener.fetch_monthly_straddle_snapshot = fetch_monthly_straddle_snapshot
    _tracking.fetch_exact_contract_quote = fetch_exact_contract_quote
    _tracking.OptionContractNotMarkableError = OptionContractNotMarkableError
    _tracking.COLLECTOR_UNIVERSES = COLLECTOR_UNIVERSES


def build_monthly_straddle_snapshot_response(symbol: str, *, minimum_dte: int, max_contracts: int) -> dict:
    _sync_runtime_overrides()
    return _screener.build_monthly_straddle_snapshot_response(
        symbol,
        minimum_dte=minimum_dte,
        max_contracts=max_contracts,
    )


def build_monthly_straddle_payload(request: dict) -> dict:
    _sync_runtime_overrides()
    return _screener.build_monthly_straddle_payload(request)


def build_options_screener_snapshot_payload(request: dict) -> dict:
    _sync_runtime_overrides()
    return _screener.build_options_screener_snapshot_payload(request)


def build_options_screener_history_payload(request: dict) -> dict:
    return _screener.build_options_screener_history_payload(request)


def sync_tracked_positions_for_run(run_id: int) -> dict:
    _sync_runtime_overrides()
    return _tracking.sync_tracked_positions_for_run(run_id)


def refresh_open_tracked_option_marks(*, as_of_date: str | None = None) -> dict:
    _sync_runtime_overrides()
    return _tracking.refresh_open_tracked_option_marks(as_of_date=as_of_date)


def collect_options_evidence_for_universe(
    universe_id: str,
    *,
    minimum_dte: int | None = None,
    max_contracts: int | None = None,
    symbols: list[str] | None = None,
    as_of_date: str | None = None,
) -> dict:
    _sync_runtime_overrides()
    return _tracking.collect_options_evidence_for_universe(
        universe_id,
        minimum_dte=minimum_dte,
        max_contracts=max_contracts,
        symbols=symbols,
        as_of_date=as_of_date,
        collector_universes=COLLECTOR_UNIVERSES,
        screener_snapshot_builder=build_options_screener_snapshot_payload,
        tracked_position_sync=sync_tracked_positions_for_run,
        mark_refresher=refresh_open_tracked_option_marks,
    )


def build_trade_validation_response(request: dict) -> dict:
    return _validation.build_trade_validation_response(request)


def build_options_screener_validation_response(request: dict) -> dict:
    return _validation.build_options_screener_validation_response(request)
