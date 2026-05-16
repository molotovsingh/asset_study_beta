# AI Study Builder

## Status

Partially implemented as a deterministic harness.

The app now has a first settings surface at `#settings/study-builder` where backend-owned endpoints can draft `study-plan-v1` JSON from intent, convert existing study hashes back into `StudyPlan` drafts, validate plans, render confirmation previews, reuse saved backend recipes, and hand off to the existing study route. The page keeps a local deterministic fallback so the contract remains inspectable when the local backend is unavailable. The Run History settings surface now hydrates selected runs from the backend assistant brief endpoint, then renders deterministic explanation seeds and downloadable assistant handoff JSON from durable study-run records. This is still not an AI assistant. It is the guardrail layer that the future assistant must obey.

## Product Thesis

The useful future is not "AI pasted onto the side of the app." The useful future is a controlled assistant that helps users express a research intent, then hands that intent to the existing app machinery in a strict, inspectable form.

For Index Study Lab, the assistant should behave like a study planner, not like a hidden second analytics engine.

The app remains the source of truth for:

- available studies
- supported views
- asset resolution
- data-window availability
- metric maturity rules
- backend provider behavior
- exports and run history

The AI layer helps with:

- translating natural language into a study plan
- asking follow-up questions when the request is underspecified
- explaining which study fits the user's intent
- warning about unsupported assets, clipped windows, and fragile annualized metrics
- preparing a run confirmation before the real study executes
- explaining completed runs only from durable run records and metric caveats

## Core Architecture

```text
User intent
  -> AI study-builder interview
  -> strict StudyPlan JSON
  -> deterministic validator
  -> deterministic confirmation preview
  -> existing study route and runner
  -> durable study-run ledger
  -> deterministic explanation seed
  -> result explanation with caveats
```

The critical design decision is that the AI produces a proposal. The deterministic app validates and runs it.

## First Slice

The first useful version should only map user language to existing studies and route parameters.

Example request:

```text
Compare Nifty 50 risk-adjusted returns against Sensex from 2021 to 2024.
```

Example planner output:

```json
{
  "studyId": "risk-adjusted-return",
  "viewId": "relative",
  "subject": "Nifty 50",
  "benchmark": "Sensex",
  "startDate": "2021-01-01",
  "endDate": "2024-12-31",
  "warnings": [],
  "requiresConfirmation": true
}
```

The app should then validate that plan before any run:

- `studyId` must exist in `app/studies/registry.js`
- `viewId` must be a supported view for that study
- subjects must resolve through the existing catalog and backend discovery rules
- date windows must be checked against actual available data
- metric roles must come from `app/lib/metricRegistry.js`
- metric proposal failures must use registry issue codes such as `metric.status_mismatch`, `metric.export_unsafe`, and `metric.domain_mismatch`
- assistant/backend consumers may inspect `docs/metric-registry-manifest.json`, but that file is generated from the JS registry and checked in CI
- short or clipped windows must trigger the existing metric-governance warnings
- options studies must respect backend/provider availability
- the user must see a confirmation preview before execution
- the confirmation preview must come from `buildStudyPlanConfirmationPreview()`, not from AI-generated copy alone
- existing study hashes must be converted back through `buildStudyPlanFromRouteHash()`, not through assistant-side URL parsing

## Non-Goals

The first version should not:

- generate JavaScript or Python code
- invent new studies at runtime
- invent financial metrics
- bypass existing study validation
- run automatically without confirmation
- give trading advice
- hide data gaps, clipped windows, or short-window annualization caveats

## Why This Needs A Harness

Financial apps have a particular failure mode: they can be numerically wrong without looking broken. A polished table, chart, or percentage can feel authoritative even when the sample is thin or the date range was clipped.

This repo has already moved toward stricter metric governance: short windows should not casually headline CAGR, and thin evidence should not masquerade as robust signal. The AI assistant must inherit that discipline.

The harness is what keeps the assistant useful:

- the planner can suggest
- the validator can reject
- the UI can explain
- the existing runner can execute

That separation makes the feature powerful without letting it become an uncontrolled second product.

Related research note: `docs/research/assistant-evidence-boundaries-and-model-risk.md`.

## Proposed Components

Frontend:

- `app/studyBuilder/` for the deterministic planner contract, study catalog, StudyPlan validator, and assistant contract
- `app/settings/studyBuilderSettings.js` for the visible `#settings/study-builder` preview route
- route-hash conversion on the settings page for saved links, history entries, and manual study hashes
- shared route helpers from the existing study shell instead of a new routing model
- visible warning states for missing assets, clipped data, unsupported horizons, and weak metric maturity

Backend:

- `GET /api/assistant/contract` to load the top-level assistant contract from the backend without reading repo files directly
- `GET /api/assistant/contract-bundle` to load the full deterministic assistant contract bundle, including the metric registry, study catalog, StudyPlan schema, recipe contract, handoff contract, and explanation-brief contract
- `GET /api/assistant/readiness` to run a keyless deterministic preflight across the assistant contract bridge, contract bundle, generated artifacts, and route wiring
- `POST /api/assistant/study-plan-dry-run` to take a research intent and return readiness, planner output, validated `StudyPlan`, confirmation preview, and a non-execution marker without calling an AI model
- `POST /api/assistant/study-plan-live-draft` to optionally let OpenAI draft `StudyPlan` JSON, then pass that model output through deterministic validation before any route handoff
- `POST /api/assistant/study-run-brief` to load a durable completed run by `runId` and return the backend-owned `run`, `handoff`, and `explanationBrief` payloads
- `POST /api/study-builder/plan` to turn user intent into structured `StudyPlan` JSON
- `POST /api/study-builder/validate` to validate `StudyPlan` JSON or route hashes deterministically and return the confirmation preview
- the visible Study Builder page calls those backend endpoints when available and falls back to the same local JS contract builders only for offline readability
- `GET /api/study-builder/recipes`, `POST /api/study-builder/recipes/save`, and `POST /api/study-builder/recipes/delete` to persist reusable validated StudyPlan recipes in the local SQLite store
- no provider fetches inside the AI call unless the validation layer explicitly asks existing services to resolve data

Shared contract:

- top-level entrypoint: `docs/assistant-contract.json`, generated from `app/studyBuilder/assistantContract.js`; backend consumers can fetch the same contract through `GET /api/assistant/contract`
- full backend contract bundle: `GET /api/assistant/contract-bundle`, built by `scripts/build_assistant_contract_bundle.mjs`, so in-app assistant consumers can load all deterministic contracts without scraping generated JSON files or UI text
- JS-side assistant API response versions are shared through `app/studyBuilder/assistantApiContract.js`; frontend API helpers and Node bundle builders should import those constants instead of repeating local strings
- assistant readiness: `GET /api/assistant/readiness` and `python3 scripts/check_assistant_readiness.py`, so development and CI can prove the deterministic assistant boundary is aligned before any live AI key or model call is introduced
- assistant dry run: `POST /api/assistant/study-plan-dry-run`, so a future assistant can exercise the backend planning boundary end-to-end without executing a study, writing evidence, or requiring a model key
- live planner smoke: `python3 scripts/run_assistant_live_planner_smoke.py --env-file /path/to/.env`, which uses `POST /api/assistant/study-plan-live-draft` semantics without printing the key, executing a study, or generating result prose
- a deterministic `intent-planner-v1` harness in `app/studyBuilder/intentPlanner.js` for simple natural-language-to-draft-plan templates
- the intent planner contract is generated at `docs/intent-planner-contract.json` and checked with `node scripts/export_intent_planner_contract.mjs --check`
- planner examples are part of that contract, so future AI work has concrete intent-to-study fixtures instead of relying only on prose
- planner diagnostics use stable codes such as `intent.template_defaulted`, so UI and assistant consumers do not need to parse warning prose
- planner confidence is explicit: `draft` means clean template match, `needs-review` means defaulted/warning diagnostics, and `blocked` means the intent could not produce a usable draft without correction
- Study Builder API response versions are shared through `app/studyBuilder/studyBuilderApiContract.js`; backend bridge output and frontend API helpers also validate nested `intent-planner-v1` and `study-plan-v1` packets, not only the outer response wrapper
- a versioned `StudyPlan` schema
- the current deterministic contract is generated at `docs/study-plan-contract.json` from `app/studyBuilder/studyPlan.js`
- the backend Study Builder endpoints run through `scripts/build_study_builder_payload.mjs`, so Python does not reimplement planner templates, route parsing, metric-policy validation, or confirmation-preview rules
- a generated study/view catalog at `docs/study-catalog-manifest.json` from `app/studyBuilder/studyCatalog.js`
- route parameter definitions with labels, types, ranges, enum hints, and descriptions so assistant code does not infer semantics from terse hash keys
- normalized validation issues with machine-readable codes; `errors` and `warnings` are compatibility summaries, not the primary contract
- route conversion fields are part of `docs/study-plan-contract.json`, so history, recipes, and future assistant handoffs can round-trip existing hashes through the same validator
- route conversion returns both `rawPlan` and `normalizedPlan`; failed conversions keep the parsed `rawPlan` so diagnostics can explain the actual bad route instead of showing a blank placeholder
- route conversion accepts hashes, bare route strings, slash-prefixed routes, and full copied app URLs with a hash fragment
- saved recipes are defined by `app/studyBuilder/studyPlanRecipes.js`, generated at `docs/study-plan-recipe-contract.json`, checked with `node scripts/export_study_plan_recipe_contract.mjs --check`, and persisted by backend settings endpoints when the local server is available
- saved recipes only store plans that pass `validateStudyPlan()`; they are reusable assistant inputs, not durable backend evidence and not completed run history
- durable run explanation seeds are defined by `app/studyBuilder/studyRunExplanation.js`, generated at `docs/study-run-explanation-contract.json`, and checked with `node scripts/export_study_run_explanation_contract.mjs --check`
- explanation seeds use `GET /api/study-runs` ledger payloads; failed runs, clipped windows, missing summaries, missing evidence references, and sub-1-year annualized metric signals become explicit issues/caveats
- explanation seeds can be serialized with `serializeStudyRunExplanationSeed(run)` and are visible as `Seed JSON` in Run History; assistant consumers should use that machine-readable payload, not scrape rendered prose
- the generated explanation contract includes canonical examples for a clean run, a short-window annualized caveat, and a failed run that blocks result conclusions
- Run History also derives a replay `StudyPlan` from each recorded route hash through `buildStudyPlanFromRouteHash()`; this keeps "explain this run" and "rerun this study" on the same validation rail
- combined assistant handoffs are defined by `app/studyBuilder/studyRunHandoff.js`, generated at `docs/study-run-handoff-contract.json`, and checked with `node scripts/export_study_run_handoff_contract.mjs --check`
- the handoff payload includes the explanation seed, replay StudyPlan, readiness flags, issues, and consumer instructions; Run History loads the backend-owned payload when available, renders it as `Assistant Handoff JSON`, and exposes the same payload through a `Download Handoff JSON` action
- assistant explanation briefs are defined by `app/studyBuilder/studyRunExplanationBrief.js`, generated at `docs/study-run-explanation-brief-contract.json`, and checked with `node scripts/export_study_run_explanation_brief_contract.mjs --check`
- the brief is a permission envelope for future generated prose: it says whether result conclusions are allowed, which caveats must be mentioned, which assistant actions are allowed, and which claims are prohibited; Run History renders this as `Assistant Explanation Brief`
- backend and UI consumers should use `POST /api/assistant/study-run-brief` instead of rebuilding handoff or brief objects from `/api/study-runs` on their own; Run History keeps a local JS fallback only so the settings page remains readable if the local backend is unavailable
- the top-level assistant contract records the endpoint's `400`, `404`, and `502` failure modes; the Python service also times out the Node contract bridge so a wedged builder cannot hang an assistant request indefinitely
- the assistant contract endpoint also runs through the JS contract bridge, so backend discovery stays aligned with the same JS source-of-truth modules as the generated docs
- the readiness endpoint is intentionally keyless; live AI keys are only needed later for explicit LLM smoke tests, not for contract, recipe, ledger, or route-readiness checks
- the dry-run endpoint is also intentionally keyless; it is the acceptance target before adding a real model-backed planner
- the live-draft endpoint is intentionally narrow; it lets a model draft only the StudyPlan JSON while the app still owns validation, confirmation preview, route handoff, and execution
- a confidence field that affects UI presentation, not validation truth

## Suggested Milestones

1. Planning-only assistant:
   Current deterministic slice accepts text, returns a validated draft study plan, and shows a confirmation card. It does not execute the study automatically.

2. Route handoff:
   Current deterministic slice converts a confirmed plan into the same hash route the user could have built manually.

3. Saved recipes:
   Current deterministic slice lets users save validated plans as backend reusable recipes, with browser-local fallback for offline review, separate from completed run history and backend evidence.

4. Result explanation:
   Current deterministic slice turns completed durable run records into serialized explanation seeds, replay StudyPlans, downloadable combined assistant handoffs, explanation briefs, and fixture examples. It does not generate prose yet. The future assistant must cite the handoff's run id, effective dates, summaries, and caveats instead of inventing narrative from screen text, and it must obey the explanation brief before writing result prose.

5. Guarded expansion:
   Only after the above works should the assistant propose multi-step workflows or new study templates.

## Test Strategy

The first implementation should be tested at the contract level:

- prompt-to-plan fixtures for common user intents
- validator rejection tests for unknown studies and invalid views
- date-window tests for clipped or unavailable data
- short-window tests that preserve metric-policy warnings
- route-handoff tests that prove the assistant uses the same app route model as manual study runs
- no-AI unit tests for validation logic

The planner can be probabilistic. The validator must not be.

## Open Questions

- Should the first UI live in the sidebar, a command panel, or a dedicated route?
- Should backend StudyPlan recipes eventually get sharing/export/import controls, or stay local-first settings records?
- Which study should be the first acceptance target: Risk-Adjusted Return, Rolling Returns, or Lumpsum vs SIP?
- How much result explanation should be allowed before the app has stronger provenance around every displayed metric?

## Implementation Principle

The agent should not become the engine. The app is the engine. The agent is a controlled interface to the engine.
