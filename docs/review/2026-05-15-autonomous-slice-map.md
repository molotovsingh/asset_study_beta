# 2026-05-15 Autonomous Slice Review Map

This note exists because the current working tree is intentionally broad. The right review model is not "read every changed file alphabetically." The right model is to review the diff as a set of product and architecture packets with clear contracts.

The stabilization and merge gate checklist for PR 2 lives in `docs/review/2026-05-16-pr-2-stabilization-plan.md`. The packet-review result lives in `docs/review/2026-05-16-pr-2-packet-review.md`.

## Packet 1 - Metric Trust And Cross-Study Semantics

Purpose:

- prevent misleading financial headlines on short or clipped windows
- make metric display/export behavior machine-readable for future assistant consumers
- move annualized metrics, percentiles, and composite scores behind explicit maturity rules

Primary files:

- `app/lib/metricRegistry.js`
- `app/lib/metricPolicy.js`
- `docs/metric-registry-manifest.json`
- study view/export files under `app/studies/` and `app/lib/*Export.js`

Review focus:

- short windows should prefer period truth over CAGR-style headlines
- suppressed metrics should not become assistant/export headlines
- exports should carry the same caveats as UI views

Key checks:

```bash
node scripts/test_metric_registry.mjs
node scripts/run_frontend_regression_checks.mjs
node scripts/export_metric_registry_manifest.mjs --check
```

## Packet 2 - Options Evidence Engine

Purpose:

- persist richer options screener rows
- add tracked straddle positions and marks
- separate underlying validation from trade validation
- refactor the options backend behind the stable `options_service.py` facade

Primary files:

- `scripts/runtime_store_options.py`
- `scripts/server/options/`
- `scripts/server/options_service.py`
- `scripts/collect_options_evidence.py`
- `app/lib/optionsScreener.js`
- `app/lib/optionsValidation.js`

Review focus:

- no destructive schema changes
- old screener rows load with safe defaults
- exact-contract tracking does not substitute strikes
- facade monkeypatch compatibility stays intact

Key checks:

```bash
python3 scripts/test_options_evidence.py
python3 scripts/test_options_service_facade.py
python3 scripts/test_options_screener_history.py
python3 scripts/test_yfinance_options_helpers.py
node scripts/test_options_screener.mjs
node scripts/test_options_validation.mjs
node scripts/test_monthly_straddle.mjs
```

## Packet 3 - Symbol Discovery, Runtime Health, And Automations

Purpose:

- improve manual symbol discovery
- add bounded market-universe collection
- expose runtime health
- move automation management into first-class settings

Primary files:

- `app/lib/symbolDiscovery.js`
- `scripts/server/market_collector.py`
- `scripts/server/automation_service.py`
- `scripts/server/ops_service.py`
- `app/settings/automationSettings.js`
- `app/appRoute.js`
- `app/main.js`

Review focus:

- settings routes must not break existing study hashes
- sidebar should remain summary-only for operations
- collector limits must not shrink stored universe membership
- provider keys should remain outside the frontend

Key checks:

```bash
python3 scripts/test_market_collector.py
python3 scripts/test_automation_service.py
python3 scripts/test_maintenance_service.py
python3 scripts/test_runtime_health.py
python3 scripts/test_provider_router.py
node scripts/test_symbol_discovery.mjs
```

## Packet 4 - Durable Run Ledger And History Settings

Purpose:

- record completed study runs in SQLite
- separate browser-local convenience recents from durable backend history
- expose run summaries, links, and assistant-safe handoff packets

Primary files:

- `scripts/runtime_store_runs.py`
- `scripts/server/study_run_service.py`
- `app/settings/studyRunHistorySettings.js`
- `app/studies/shared/runHistory.js`
- `app/studies/shared/indexRunHistory.js`

Review focus:

- backend ledger is additive
- history settings can load directly by route
- assistant handoffs are derived from run records, not screen scraping

Key checks:

```bash
python3 scripts/test_study_run_service.py
python3 scripts/test_runtime_store_cache.py
node scripts/run_frontend_regression_checks.mjs
```

## Packet 5 - Study Builder And Assistant Boundaries

Purpose:

- create a deterministic, keyless assistant harness before any live model call
- expose contracts through backend endpoints
- persist reusable StudyPlan recipes as settings records
- provide readiness and dry-run endpoints for future assistant integration

Primary files:

- `app/studyBuilder/`
- `app/settings/studyBuilderSettings.js`
- `scripts/server/assistant_service.py`
- `scripts/server/study_builder_service.py`
- `scripts/server/study_factory_service.py`
- `scripts/build_assistant_contract_bundle.mjs`
- `scripts/build_study_builder_payload.mjs`
- `scripts/build_study_proposal_payload.mjs`
- `scripts/check_assistant_readiness.py`
- `docs/assistant-contract.json`
- `docs/study-plan-contract.json`
- `docs/study-plan-recipe-contract.json`
- `docs/study-proposal-contract.json`

Review focus:

- no LLM call exists yet
- no API key is required for readiness or dry-run
- dry-run must not execute studies
- live-draft must only let the model propose StudyPlan JSON; deterministic validation remains mandatory
- study-factory proposal must stay read-only: no model call, no code generation, no data fetch, no study execution
- backend routes should be the integration surface, not UI scraping
- generated contract docs should stay in sync with JS source modules

Key checks:

```bash
python3 scripts/test_assistant_service.py
python3 scripts/check_assistant_readiness.py
python3 scripts/run_assistant_live_planner_smoke.py --env-file /path/to/.env
python3 scripts/test_study_builder_service.py
python3 scripts/test_study_factory_service.py
python3 scripts/test_route_dispatch.py
node scripts/test_study_builder.mjs
node scripts/test_study_factory.mjs
node scripts/export_assistant_contract.mjs --check
node scripts/export_study_plan_contract.mjs --check
node scripts/export_study_plan_recipe_contract.mjs --check
node scripts/export_study_proposal_contract.mjs --check
```

## Packet 6 - Documentation And Research Trail

Purpose:

- keep the architecture understandable for future work
- preserve the reasoning behind options evidence and assistant model-risk boundaries
- make the broad product direction auditable

Primary files:

- `FOR_AKSINGH.md`
- `README.md`
- `docs/planned-features.md`
- `docs/planned-features/ai-study-builder.md`
- `docs/research/`
- `docs/workflow-map.*`

Review focus:

- docs should explain why the boundaries exist, not just list files
- research notes should distinguish public source facts from app-specific synthesis
- future assistant guidance should clearly separate recipes, durable runs, evidence, and operations

## Full Current Regression Set

```bash
python3 -m py_compile scripts/*.py scripts/server/*.py scripts/server/options/*.py scripts/providers/*.py
python3 scripts/test_assistant_service.py
python3 scripts/check_assistant_readiness.py
python3 scripts/test_study_builder_service.py
python3 scripts/test_study_factory_service.py
python3 scripts/test_route_dispatch.py
python3 scripts/test_study_run_service.py
python3 scripts/test_options_evidence.py
python3 scripts/test_options_service_facade.py
python3 scripts/test_options_screener_history.py
python3 scripts/test_yfinance_options_helpers.py
python3 scripts/test_maintenance_service.py
python3 scripts/test_automation_service.py
python3 scripts/test_market_collector.py
python3 scripts/test_provider_router.py
python3 scripts/test_dev_server_provider_preference.py
node scripts/test_options_validation.mjs
node scripts/test_options_screener.mjs
node scripts/test_monthly_straddle.mjs
node scripts/test_symbol_discovery.mjs
node scripts/test_study_builder.mjs
node scripts/test_study_factory.mjs
node scripts/run_frontend_regression_checks.mjs
node scripts/export_assistant_contract.mjs --check
node scripts/export_study_proposal_contract.mjs --check
node scripts/export_study_plan_recipe_contract.mjs --check
```

## Explicit Stop Line

The next slice that needs user input is broader live AI product testing beyond StudyPlan drafting. That should not start from this dirty tree until the user has configured an API key in the environment, not in chat.

Expected key name when that starts:

```bash
OPENAI_API_KEY
```
