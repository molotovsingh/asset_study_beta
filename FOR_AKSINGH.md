# FOR_AKSINGH: Index Study Lab

This project is a small but serious market-research workbench. The important idea is not "one web page that runs one formula." The important idea is a repeatable study library: pick an asset, pick a study, load a clean time series, compute a result, export it, and keep the system open for many more studies later.

The repo is deliberately light on framework machinery. There is no React app, no Vite config, no package.json build pipeline, and no desktop wrapper. The browser loads `index.html`, which loads `app/main.js` directly as an ES module. When all you need is bundled snapshot data, a plain static server is enough. When you want raw symbols, provider search, options data, profiles, or local caching, the Python dev server becomes the app's backend.

That split is the core architecture.

## The Big Picture

Think of the app as three cooperating layers:

1. The browser workspace:
   The visible app shell, sidebar, study selector, active asset field, study views, run history, exports, and chart/result rendering.

2. The data bridge:
   `app/lib/syncedData.js` decides whether data comes from committed JSON snapshots or from the local Python API. It keeps the browser away from provider secrets and provider-specific mess.

3. The local backend and store:
   `scripts/dev_server.py`, service modules, provider adapters, and `scripts/runtime_store.py` fetch, normalize, cache, and remember market data in local SQLite.

The browser is the cockpit. The Python backend is the engine room. The committed `data/snapshots/` folder is the reliable pantry you can use even when the engine room is off.

## How The Repo Is Laid Out

`index.html` is the app entrypoint. It defines the sidebar, active asset input, study selector, recent-run area, and main workspace.

`app/main.js` is the browser orchestrator. It wires user actions to the study registry, active subject store, hash router, symbol discovery, and run history. It should stay as a coordinator, not become a dumping ground for finance logic.

`app/studies/` contains one module per study. Each study owns its UI, inputs, validation, run button behavior, status messages, and result mounting.

`app/studies/registry.js` lists the studies. Adding a study should usually mean adding a module and registering it there.

`app/studies/studyShell.js` owns hashes like `#risk-adjusted-return/overview?subject=Nifty+50`. That is why study links are shareable without a backend session.

`app/studies/shared/` holds shared study behavior: active subject state, input parsing, run history, export click handling, study pipeline helpers, and selection summaries.

`app/lib/` holds reusable calculation and export engines. This is where the pure logic belongs. Good engineering instinct: calculations should be testable without a browser and without live providers.

`app/catalog/` contains curated catalog metadata: index names, symbols, sector universes, options-screener universes, labels, aliases, and source URLs.

`data/snapshots/` contains committed market-data snapshots. These are what make the static app useful even without the Python backend.

`scripts/dev_server.py` serves the app and dispatches `/api/*` calls.

`scripts/server/` contains backend services and route handlers. `index_service.py` owns price/profile history behavior. `options_service.py` is now a compatibility facade for the options backend. The real options domains live under `scripts/server/options/`. `market_collector.py` owns bounded universe collection.

`scripts/providers/` contains provider adapters. They are the translation layer between messy external data and the app's normalized internal shapes.

`scripts/server/options/` is the newer split inside the backend:

- `constants.py` holds options-specific configuration and universe definitions.
- `metrics.py` holds pure analytics helpers like percentile logic, trend context, seasonality context, pricing labels, term structure, and cross-sectional ranks.
- `screener.py` turns live options snapshots into screener rows and screener history responses.
- `tracking.py` owns tracked straddle positions, exact-contract marks, and options evidence collection.
- `validation.py` owns both underlying validation and trade validation payloads.

This split is worth understanding because it teaches a practical refactoring lesson. Earlier, `options_service.py` had become the next gravity well after `runtime_store.py`: too many unrelated concerns in one room, but too many callers already depending on the room's door. The good move was not to delete the door. The good move was to keep `options_service.py` as the stable front desk and reorganize the actual work behind it. That preserves test monkeypatch points, route imports, and compatibility while making the real code easier to reason about.

`scripts/runtime_store.py` is the public compatibility layer for the local SQLite cache at `data/local-cache/yfinance/index/cache.sqlite3`.

`scripts/runtime_store_metadata.py` owns remembered datasets, instrument profiles, symbol universes, and market collection runs.

`scripts/runtime_store_options.py` owns options monthly snapshots, screener-run persistence, and tracked trade/evidence persistence.

`docs/workflow-map.html` and `docs/workflow-map.json` document the workflow map interactively. The HTML is just the renderer; the JSON is the source of truth.

## The Current Study Library

The registry currently includes:

- Risk-Adjusted Return
- Sector Snapshot
- Monthly Straddle
- Options Screener
- Options Validation
- Seasonality
- Rolling Returns
- SIP Simulator
- Lumpsum vs SIP
- Drawdown Study

That list tells you something important: the app is moving from "index calculator" toward a research workbench. Some studies are pure price-history studies. Some options studies need backend calls, local evidence, and validation history.

## Metric Governance

Financial metrics are not equal just because they are all numbers. A good market app has to decide which numbers deserve to be loud.

The newest policy is simple: period truth comes first when the sample is short. In the Risk-Adjusted Return study, a short window now headlines `Total Return` and shows the annualized number as `Annualized Pace`. Once the window is year-like and has enough daily observations, the same view can promote `CAGR` again. This is not a math change. CAGR is still computable. It is a product judgment about what should be trusted at a glance.

The Relative view follows the same idea. It now leads with `Relative Wealth` and `Active Return`, then treats annualized spread as either `CAGR Spread` for a credible full-year overlap or `Annualized Pace Spread` for a short overlap. Correlation, beta, tracking error, Sharpe, Sortino, and information ratio also show their sample context more clearly. These are diagnostics, not verdicts.

Monthly Straddle now follows the same rule from a different angle. The raw IV percentile math still exists, but the UI stops speaking in percentile terms when there are only a few stored front-month snapshots. With thin history, the app shows `History Depth` and `Percentile Status` instead of pretending that `3 observations` is a meaningful percentile regime. That is a useful engineering habit: keep the raw computation if it may help later, but downgrade or suppress the display when the evidence is too thin for a confident read.

Drawdown needed the same maturity check, but for a different failure mode. The bug was not a flashy crash. It was quieter: microscopic slips below the prior peak could be counted as full drawdown episodes, which then inflated `time underwater`, episode counts, and the emotional tone of the study. The fix was to add a materiality threshold at the model layer. Now the app only counts a drawdown episode once the decline is meaningfully below the peak, and the UI says that threshold out loud. That is another good engineering lesson: when the semantics are wrong, fix the definition first, not just the formatting.

Seasonality now avoids another subtle trap. `Years observed` sounded impressive, but the real evidence lives in the month buckets: how many Januarys, Februarys, Marches, and so on were actually available. The view now headlines `Sample Depth` and reports the per-month sample range. Calendar years remain in the context block, but they no longer get to masquerade as bucket-level evidence.

Lumpsum vs SIP needed a wording correction more than a math change. The study's real win criterion is terminal wealth: after the same total capital and the same terminal date, which path ended with more money? Lumpsum CAGR and SIP XIRR are still useful supporting reads, but they are not a single apples-to-apples ranking metric because SIP deploys capital gradually. The app now says that directly in the result page and export summary.

SIP Simulator has a related caution. Its cohort panel is a same-terminal comparison: every cohort runs to the same latest market date, so later cohorts naturally have fewer contributions. The app now labels the best and worst reads as `Best XIRR Cohort` and `Worst XIRR Cohort`, and it says clearly that these are not fixed-horizon start-month rankings. The difference sounds small, but it prevents a common analytical mistake: reading a same-terminal cohort table as if every start month had equal time in market.

Options Validation now pushes rerun deduplication into the backend payload too. The frontend had already been collapsing same-day duplicate screener rows, but that left the API itself too easy to misuse. The backend now reports both raw and deduped counts and keeps a `duplicateCount` on collapsed observations. This is the right shape for an evidence system: raw activity is still observable, but validation statistics are computed from distinct evidence rows.

Exports need the same discipline as the visible app. A user may make decisions from an XLS file long after they have forgotten the on-screen caveats. Risk and Relative exports now follow the same annualization policy as the UI: short windows use labels like `Annualized Pace`, `Return / Max DD`, and `Annualized Pace Spread`, while the summary sheet records why period truth is primary. Raw CSV fields stay stable for machines, but the human-facing workbook sheets carry the trust context.

The same export rule applies to diagnostic ratios. Sharpe, Sortino, volatility, and similar annualized diagnostics now carry return-observation counts in their workbook notes. A ratio without its sample depth is a number without its leash.

The lesson is important: mature financial software does not merely calculate formulas. It controls how easily a user can over-read those formulas. A precise-looking annualized number from 63 daily returns is still a fragile number. The app should make that fragility visible.

## The Main User Flow

The most common flow is:

1. User sets the active asset in the sidebar.
2. `app/main.js` resolves that text through local catalog matches and optional provider discovery.
3. The current study reads the active subject from route params or shared state.
4. The study resolves the subject into a selection.
5. The data gateway loads either a bundled snapshot or a local backend snapshot.
6. The study filters the time series by form inputs.
7. A pure engine computes metrics and tables.
8. The study renders results and records a recent run.
9. Export buttons reuse the completed payload.

The discipline here is that each part has one job. UI modules orchestrate. Data modules load. Engines compute. Export modules serialize. Backend services fetch and cache.

## Bundled Data vs Local Backend Data

Bundled data lives in `data/snapshots/yfinance/index/`. It is committed to the repo and can be loaded by a static file server. This path is simple, stable, and good for repeatable studies.

Local backend data goes through `/api/yfinance/index-series`. It is needed for ad hoc symbols like `AAPL`, remembered manual labels like `Apple | AAPL`, profiles, options snapshots, and local SQLite cache behavior.

This distinction matters. If a built-in dataset has a `sync` config and a committed snapshot, the browser can load it directly. If it only has a symbol, like `Nifty 500` with `^CRSLDX`, it needs the local backend because no committed snapshot exists yet.

## The Runtime Store

The SQLite store is machine-local mutable state. It stores:

- symbols
- daily prices
- corporate actions
- sync state
- remembered datasets
- instrument profiles
- options monthly snapshots
- derived metrics
- options screener runs and evidence
- symbol universes
- market collection runs
- generic study-run ledger rows

This store is not the same thing as bundled snapshot data. Bundled snapshots are repo assets. The runtime store is local memory.

That separation is healthy. It means the app can have reliable committed demo data and still support live local experimentation.

There is a newer lesson here too. The repo used to put all of that persistence logic into one giant `runtime_store.py`. That worked when the app was mostly price history plus a few helpers. It started to break down once the app added remembered catalogs, symbol universes, market collection runs, options evidence, and tracked trade marks.

The fix was not a flashy rewrite. The fix was to keep `runtime_store.py` as the stable public door and move domain-specific SQL into helper modules behind it. That is why `runtime_store_metadata.py`, `runtime_store_options.py`, and `runtime_store_runs.py` exist. The rest of the repo still calls `runtime_store.*`, but the actual logic now lives in narrower rooms.

There is also a newer operations lesson: once you have local collectors and evidence archives, "does the code run?" stops being enough. You also need to ask "what is stale?", "what failed recently?", and "which tracked positions are still open with no marks?" That is why the repo now has `scripts/server/ops_service.py` and `scripts/report_runtime_health.py`. Good engineers add visibility before the system becomes mysterious.

The next step after visibility is orchestration. That is why `scripts/run_data_maintenance.py` exists. It is not a scheduler by itself. It is a stable command that an external scheduler can call. This is a subtle but important engineering choice: keep scheduling policy outside the repo, keep the repo responsible for doing one maintenance pass correctly.

There is a more subtle history lesson underneath all of this too. Not all history is equal.

- Convenience history belongs in the browser. That is what the sidebar's recent local runs are for. They help you resume work, but they are not research truth.
- Data history belongs in SQLite. That is cached market data, provider provenance, freshness, and what the app actually had available at a point in time.
- Evidence history also belongs in SQLite. That is screener rows, tracked option positions, tracked marks, and later validation outcomes.
- Operational history belongs in SQLite too, but for a different reason. It tells you whether the machinery ran, failed, went stale, or missed symbols.
- Durable run-ledger history belongs in SQLite as well. It is the bridge between convenience recents and full evidence tables. It answers: what study ran, when, on what resolved window and route, even if that study does not yet have a dedicated evidence model.

This distinction matters because teams often mix these together and then wonder why their "history" is not useful. A recent-run list is a convenience feature. It should stay lightweight and local. Evidence tables are where you prove or disprove ideas. Ops tables are where you debug trust in the pipeline. Mixing those concerns makes everything noisier and less credible.

The implementation now follows that rule more closely. The browser still keeps a lightweight recent-runs cache so the sidebar stays responsive and resilient. But completed runs also get written into a backend `study_runs` ledger in SQLite. A simple way to remember the difference: the browser cache is a sticky note; the SQLite ledger is the notebook.

That notebook now has depth too. The generic `study_runs` row is the spine. `study_run_summaries` stores a few high-signal facts like CAGR, matured rows, or front IV. `study_run_links` stores references outward, for example to an options screener archive run. This is an important pattern: do not make the main run row carry every detail forever. Keep the spine narrow, then hang richer context off it.

The ledger also keeps warning message text inside its resolved-params JSON. A
count is not enough for an assistant-safe system. "There was one warning" tells
the assistant to be cautious, but "price data is being used as a TRI proxy" tells
it what caveat must actually be repeated. That is the difference between a smoke
alarm and a fire report.

One small bug here was worth fixing at the persistence boundary, not in the UI.
Some callers could send warning text without a matching `warningCount`, which
meant the row carried the important caveat but still looked warning-free to
summary readers. The runtime store now deduplicates warning messages and derives
the count before writing the row. The lesson is simple: whenever two fields
describe the same truth, normalize them at the ledger door. Do not ask every
future reader to rediscover and repair the mismatch.

There is another product lesson hiding inside that design: once a ledger becomes durable, it deserves its own home in the app. That is why the app now has a dedicated settings route at `#settings/history`. Earlier, recent runs only lived in the sidebar, which made them feel like a convenience feature even after the backend ledger existed. Moving durable history into its own settings surface fixes the mental model. The sidebar is the sticky note. The history settings page is the filing cabinet.

## Provider Design

External providers are wrapped by adapters under `scripts/providers/`. The app does not want yfinance-shaped objects, Finnhub-shaped objects, or RapidAPI-shaped objects leaking everywhere. It wants normalized results.

The provider router currently gives the app a default history/profile order of yfinance first, then yahoo_finance15. The market collector has a different default: Finnhub first, then yfinance. That is not a contradiction. App runs and scheduled collection have different needs.

Finnhub is especially useful for symbol master and exchange-backed discovery. yfinance remains a convenient research provider. Google Finance is not treated as a backend ingestion API in this repo.

## Options Workflows

The options side is more stateful than the index-study side. Monthly straddle and options screener flows need current option-chain data, underlying price context, derived metrics, and in some cases stored evidence for later validation.

The important lesson is not "options are complicated." The important lesson is that options workflows should archive the measurement context. If you rank a candidate today, you want to know later what the app saw then: spot, expiry, IV, historical vol, pricing bucket, advisory labels, and validation outcome.

That is why options code reaches deeper into the backend than a simple price-history study. It is also why the repo now keeps the options backend split by domain. Pure analytics, screener orchestration, tracked-position lifecycle, and validation logic are related, but they are not the same job. Keeping them separate is how you stop a useful feature set from turning into one 2,000-line file that everyone is afraid to touch.

## Workflow Map

I added an interactive workflow map:

- `docs/workflow-map.json`
- `docs/workflow-map.html`

Run a local server and open:

```bash
python3 -m http.server 8000
```

Then visit:

```text
http://127.0.0.1:8000/docs/workflow-map.html
```

Click flows like "Run study from bundled snapshot", "Run study from raw local symbol", "Run options screener", "Refresh bundled yfinance snapshots", or "Collect bounded market universe". The page highlights components and explains what each handoff passes.

The JSON deliberately includes "Invite new user" and "todesktop build" as not-implemented example flows. They are not real features in this repo. There is no auth package, invite API, package.json, Electron entrypoint, or ToDesktop config here.

## Planned Product Tracks

Planned features live in `docs/planned-features.md`, with deeper notes under `docs/planned-features/`. That is intentional. A serious idea should have a home before it has code.

The first planned track is the AI Study Builder. The important design lesson is that AI should not become a secret second analytics engine. It should turn a user's research intent into a strict study plan, then let the existing app validate and run that plan. In this repo, that means the AI can suggest `risk-adjusted-return`, `rolling-returns`, `sip-simulator`, or another registered study, but the registry, route parser, asset resolver, date-window checks, and metric policy still decide what is actually allowed.

This is especially important for financial UX. The app has already learned that short windows, clipped data, and thin evidence can make precise-looking metrics misleading. An AI layer should make those caveats clearer, not smoother. The useful mental model is: the app is the engine, the agent is the interface to the engine.

## Bugs And Pitfalls We Have Already Learned From

Provider coverage is not the same as symbol parsing. A symbol can parse correctly and still return no usable provider rows. The fix is to separate "did we understand the symbol?" from "did the provider have data?"

Discovery ranking is sensitive. Adding a strong built-in like `Nifty 500` can change generic query ordering. Tests should assert that the intended result appears, not freeze a brittle global ranking.

Provider provenance matters. A prior bug showed Finnhub-cached series as generic "Local market data" because the display map did not know Finnhub. The fix was to add Finnhub to provider display names so the UI tells the truth.

`--limit` in the market collector must not shrink stored universe membership. It is a run cap, not a membership edit. This is a good example of naming danger: a small CLI flag can accidentally mean two things unless the code makes the distinction explicit.

Options evidence can sprawl fast. The right move is to store compact summaries and validation records first, not try to archive every possible option-chain shape before the study needs it.

One-file persistence layers feel efficient right up until they stop being readable. `runtime_store.py` was over 3,800 lines before the recent decomposition work. Splitting metadata/universe logic and options-evidence logic into dedicated helpers brought it down to about 2,000 lines without changing the external API. That is a good example of pragmatic refactoring: smaller blast radius, preserved contracts, and tests that prove behavior did not drift.

The same pattern just repeated on the options backend. `options_service.py` had grown to more than 2,200 lines and was mixing metrics, screener orchestration, tracked-position lifecycle, evidence collection, and validation responses. The fix was not a grand rewrite and not provider unification. The fix was a domain split behind a stable facade. That last part matters. A mature system often needs to preserve its old import path while improving its internal shape.

## How Good Engineers Should Think In This Repo

Keep contracts narrow. A study should know what shape it needs, not how every provider works.

Prefer pure engines. If a calculation can live in `app/lib/` without DOM or fetch calls, put it there and test it there.

Treat provider data as untrusted. Providers fail, omit rows, change history, and return partial metadata. Surface that as warnings and cache state, not silent confidence.

Separate local state from repo state. SQLite cache is local. Snapshot JSON is committed. Do not blur them.

Avoid making `app/main.js` the universe. If a new feature grows, give it a module, a service, or a data helper.

Write tests around contracts, not accidents. Route hashes, export payloads, provider fallback, cache refresh, and study calculations are contracts. Pixel-perfect current ordering of broad search results is often an accident.

Prefer compatibility layers during refactors. In this repo, callers still import `runtime_store.py` even though some of the real SQL now lives in helper modules. That is how mature refactoring usually works in active systems: keep the public door stable while you reorganize the rooms behind it.

## The Metric Registry: The App's Rulebook

The app now has a cross-study metric registry in `app/lib/metricRegistry.js`. Think of it as the rules desk in a trading firm. Analysts can build different studies, but they do not get to invent whether a number is safe as a headline, only a diagnostic, suppressed, or exportable. The registry makes that decision from context: date depth, return-observation count, history depth, materiality thresholds, and comparison semantics.

This matters because a future in-app AI assistant should not hallucinate metric authority. If it builds a study that calculates CAGR on a 60-day window, the registry says: do not headline that as CAGR; use total return as the primary read and show annualized pace only as a diagnostic. If it sees an IV percentile with three saved snapshots, the registry says: suppress the percentile and show history depth instead. If it explains SIP versus lumpsum, the registry reminds it that terminal wealth is the win criterion and CAGR/XIRR are not apples-to-apples.

The older `app/lib/metricPolicy.js` path still exists as a compatibility facade, but it now delegates to the registry. That is intentional. Good systems let callers keep using stable doors while the internal authority becomes cleaner.

The registry also exposes `getMetricRegistryManifest()`, `getMetricRegistryRule()`, and `listMetricRegistryRules()`. Those are deliberately JSON-safe because a future app-controlled AI assistant should read the manifest first, then generate or explain studies within those constraints. The assistant should not scrape UI labels or reverse-engineer export files. It should ask the registry: what roles exist, what thresholds apply, what is the export behavior, and what metric IDs are allowed for this study domain?

There is a second guardrail: `validateMetricDecisionProposal()` and `validateMetricDecisionProposals()`. These are the bouncer at the door. If generated code tries to headline short-window CAGR, use relative wealth inside the wrong study, export a suppressed percentile, or invent a metric ID, the validator returns errors before the proposal becomes UI or export output. This is how you keep an AI assistant useful without letting it become a confident narrator of unsafe metrics.

Metric validation now returns structured `issues` too. Codes like `metric.status_mismatch`, `metric.export_unsafe`, and `metric.domain_mismatch` are safer than asking future UI code to parse English error text. The plain `errors` and `warnings` arrays remain for humans and compatibility.

For consumers that cannot import browser modules directly, the repo now includes `docs/metric-registry-manifest.json`. That file is generated by `node scripts/export_metric_registry_manifest.mjs --write`, and CI can check it with `node scripts/export_metric_registry_manifest.mjs --check`. The JSON file is not a second rulebook. It is a printed copy of the rulebook, and tests fail if it drifts from `app/lib/metricRegistry.js`.

The same pattern now exists for future AI study planning. `app/studyBuilder/studyPlan.js` defines `study-plan-v1`, validates study IDs, view IDs, route params, dates, numeric inputs, confirmation requirements, and optional metric proposals. `docs/study-plan-contract.json` is generated from that validator by `node scripts/export_study_plan_contract.mjs --write`, with `--check` used to catch drift. This means a future assistant can propose a route, but the app decides whether that proposal is allowed.

The plan validator also has `buildStudyPlanConfirmationPreview()`. This is the future confirmation card contract: it returns the study title, view label, route hash, params, warnings, errors, and metric safety failures. The assistant can suggest, but this preview is what the user should see before execution.

The preview also returns structured `issues` with stable codes like `param.unsupported`, `view.unsupported`, `date.range_invalid`, and `metric.policy_error`. The English `errors` and `warnings` arrays are still there for compatibility, but future UI logic should branch on issue codes, not parse prose.

The StudyPlan contract also defines route parameter semantics. Keys like `rf`, `dte`, `u`, and `h` are compact because they live in URLs, but the contract now explains their labels, types, ranges, enum hints, and descriptions. That prevents a future assistant from guessing what a terse hash key means.

There is also `app/studyBuilder/studyCatalog.js`, which turns the live study registry into `docs/study-catalog-manifest.json`. That manifest lists the real studies, views, labels, summaries, and capabilities without exposing UI mount functions. In plain terms: the assistant gets a menu, not the keys to the kitchen.

The top-level entrypoint is `docs/assistant-contract.json`, generated from `app/studyBuilder/assistantContract.js`. That file points to the study catalog, StudyPlan contract, and metric registry, plus the required flow and hard stops. The backend also exposes the same contract at `GET /api/assistant/contract`, built through the JS contract bridge rather than a Python rewrite. If another process wants the full rulebook, it can call `GET /api/assistant/contract-bundle`, which returns the assistant contract, metric registry, study catalog, StudyPlan schema, recipe contract, handoff contract, and explanation-brief contract in one deterministic payload. If it wants to know whether that rulebook is currently healthy, it can call `GET /api/assistant/readiness` or run `python3 scripts/check_assistant_readiness.py`. That readiness check is deliberately keyless: it proves contracts, generated artifacts, and route wiring before any live AI test exists. The next keyless boundary is `POST /api/assistant/study-plan-dry-run`, which takes a research intent and returns readiness, planner output, a validated StudyPlan, a confirmation preview, and an explicit `executed: false` marker. The first live model boundary is `POST /api/assistant/study-plan-live-draft`; even there, the model only drafts StudyPlan JSON and the app still validates it before any route handoff.

The JS-side assistant API response versions now live in `app/studyBuilder/assistantApiContract.js`. That module is deliberately boring: it only exports labels like `assistant-contract-bundle-v1`, `assistant-readiness-v1`, and the non-executing StudyPlan draft response versions. The point is not clever abstraction. The point is that the frontend helper and Node bundle builder should not carry separate handwritten copies of the same contract labels.

The first visible assistant harness now lives at `#settings/study-builder`. It is intentionally modest. You can type a simple research intent like "Compare Nifty 50 against Sensex from 2021 to 2024", and the app uses `app/studyBuilder/intentPlanner.js` to draft a `study-plan-v1` object. Then the same deterministic validator builds the confirmation card and the same route helper produces the final hash. No AI call is involved yet.

That same harness now has backend entrypoints: `POST /api/study-builder/plan` drafts a plan from intent, and `POST /api/study-builder/validate` validates a StudyPlan or route hash and returns the deterministic confirmation preview. The settings page calls those backend endpoints when the local server is available, then falls back to the same local JS contract builders only so the page remains readable offline. Python does not copy the planner rules. It calls `scripts/build_study_builder_payload.mjs`, which imports the same JS planner and validator used by the settings page. This is the pattern to remember: one set of rules, multiple entrypoints.

The contract version checks now go one level deeper than the wrapper. The backend and frontend do not just ask, "did I receive a `study-builder-plan-response-v1` object?" They also verify that the nested planner packet is `intent-planner-v1` and the nested plan is `study-plan-v1`. The assistant boundary applies the same discipline: the contract bundle proves every required member version it exposes, from `metric-registry-v1` through `study-run-explanation-brief-v1`, while the completed-run brief endpoint refuses bridge output unless the handoff is `study-run-handoff-v1` and the explanation brief is `study-run-explanation-brief-v1`. That sounds fussy, but it prevents a subtle future bug: a wrapper could keep the right version while the important payload inside silently changes shape. The shared response-version constants live in `app/studyBuilder/studyBuilderApiContract.js` and `app/studyBuilder/assistantApiContract.js`, so the settings fallback, synced API helper, and Node bridge all read the same labels.

That sounds small, but it is an important product architecture move. It proves the shape of the future assistant without trusting a model with authority. The intent planner is allowed to guess a draft. The StudyPlan validator decides whether the draft is legal. The metric registry decides whether proposed metrics are safe. The user still sees the confirmation preview before route handoff. In trading terms, the planner can shout an idea across the desk; compliance still stamps the ticket before it reaches the market.

The intent planner now has its own printed contract too: `docs/intent-planner-contract.json`, generated from `app/studyBuilder/intentPlanner.js` by `node scripts/export_intent_planner_contract.mjs --write`. CI can check it with `node scripts/export_intent_planner_contract.mjs --check`. This keeps the future assistant from relying on hidden implementation details. The contract includes template rules, diagnostic codes, and example fixtures, so future work can test "intent in, expected study/view out" instead of debating prose. The assistant contract points to the planner contract; the planner contract points to deterministic templates; the StudyPlan contract validates the output. That chain is how you build a non-hallucinatory assistant surface.

The planner also separates confidence from validity. A `draft` confidence means the intent matched cleanly. `needs-review` means the route may still validate, but the planner defaulted something important like the study template, subject, or date range. `blocked` means the intent itself is not usable, for example an empty request. This is a small but mature distinction: a route-safe plan can still be a weak interpretation of the user's intent, so the UI should not pretend the planner understood more than it did.

The StudyPlan contract now works in both directions. `buildStudyPlanRouteHash()` turns a validated plan into the same hash route a user could navigate manually. `buildStudyPlanFromRouteHash()` turns an existing `#study/view?...` hash back into a validated `study-plan-v1`. That matters for future saved recipes, run-history explanations, and assistant handoffs. If the app already has a route, the assistant should not re-parse it with its own little URL rules. It should hand the hash back to the contract and let the same validator decide whether the route is legal.

The settings page exposes that reverse path too. The `Route Hash` box in `#settings/study-builder` lets you paste a saved link or history route, convert it into JSON, and see the same confirmation preview. This makes the contract visible, not just theoretical. A user can see the same thing the future assistant would have to do: translate intent or route into a plan, validate the plan, then hand off to the app route only after review.

The route converter also keeps the failed draft. That is what `rawPlan` means in the contract. If someone pastes `#settings/automations` into a study-route converter, the app should not erase the mistake and show an empty plan. It should preserve the parsed route, fail validation with `study.unknown`, and make the problem inspectable. Good validation does not just say "no"; it preserves enough context to explain why.

The converter is also tolerant about the shape of the input. It accepts a clean hash like `#risk-adjusted-return/overview?...`, a bare route like `risk-adjusted-return/overview?...`, a slash-prefixed route, or a full copied browser URL such as `http://127.0.0.1:8000/#risk-adjusted-return/overview?...`. The important point is that tolerance happens before validation, not instead of validation. The route can be convenient to paste, but it still has to become a legal StudyPlan before the app will run it.

The Study Builder settings page now has saved recipes too. These are backend settings records when the local server is available, with browser-local storage kept as an offline fallback. They let you save a validated StudyPlan, load it later, and hand it back through the same confirmation preview. The backend routes are `GET /api/study-builder/recipes`, `POST /api/study-builder/recipes/save`, and `POST /api/study-builder/recipes/delete`. The generated contract lives at `docs/study-plan-recipe-contract.json`, checked by `node scripts/export_study_plan_recipe_contract.mjs --check`.

The important maturity point is what recipes are not. They are not evidence. They are not proof that a study ran. They are not the trade ledger or the completed run ledger. They are closer to a saved order ticket template: useful for reuse, but it still has to be validated and routed before anything meaningful happens. That distinction keeps the future assistant from confusing "I can recreate this study request" with "this result is historically proven."

The next guardrail is result explanation. `app/studyBuilder/studyRunExplanation.js` turns a durable `study_runs` ledger record into a deterministic explanation seed. The seed records the run id, study, subject, route, effective date window, summary items, evidence links, snapshot references, source policy, confidence, and caveats. The generated contract lives at `docs/study-run-explanation-contract.json`, checked by `node scripts/export_study_run_explanation_contract.mjs --check`.

This is the same discipline in a new place. A future assistant should not look at a chart and improvise. It should ask: what run actually completed, what dates did the ledger record, what summary metrics were saved, what source policy was recorded, were there warnings, did the requested and actual windows differ, and were any annualized metrics shown on a short window? If the run failed, the explanation seed blocks result conclusions entirely. If the source policy says `blocked_proxy_tri`, the seed forces a caveat that the run is not approved true total-return evidence. The assistant may explain the failure or caveated result, but it cannot pretend there was stronger evidence than the ledger recorded.

Run History now renders this seed as an "Assistant-safe explanation seed" and also shows the exact `Seed JSON`. That JSON is produced by `serializeStudyRunExplanationSeed(run)`, so future assistant code has a stable payload to consume. The generated contract also includes example fixtures: a clean completed run, a clipped short-window run with an annualized-metric caveat, and a failed run that blocks conclusions. This is deliberately plain. It is not meant to be beautiful prose. It is the checklist a responsible assistant must read before saying anything. Think of it like a pilot's preflight card: boring by design, but it prevents confident nonsense.

Run History also shows a replay StudyPlan when the ledger record has a route hash. That replay plan is not guessed from the UI. It comes from `buildStudyPlanFromRouteHash()`, the same route-to-plan validator used by the Study Builder. This is the right mental model for assistant features: one contract explains what happened; another contract reconstructs how to ask the app to do it again. Do not let a model invent either side.

Those two pieces now come together in `app/studyBuilder/studyRunHandoff.js`. It builds a single assistant handoff payload containing the explanation seed, replay StudyPlan, readiness flags, issues, and consumer instructions. Run History renders this as `Assistant Handoff JSON`, lets you download the exact JSON packet, and the generated contract lives at `docs/study-run-handoff-contract.json`. This is the object a future assistant should ingest when the user says, "explain this run" or "rerun this study." It is the handoff packet, not a chat transcript and not a screenshot.

That download button is intentionally not fancy. It is a practical engineering checkpoint. If a future assistant can only work by scraping the screen, the contract is weak. If a user or integration can download a versioned JSON packet from the durable ledger, inspect it, replay it in tests, and hand it to another process, the assistant boundary is becoming real.

The next layer is `app/studyBuilder/studyRunExplanationBrief.js`, visible in Run History as `Assistant Explanation Brief`. Think of it as the editor standing between the evidence packet and the assistant's prose. The handoff says what happened. The brief says what the assistant is allowed to do with that handoff: explain results with caveats, explain a failure only, offer replay confirmation, or stop. It also carries prohibited claims like "do not add unsupported causes, predictions, or trading advice" and "do not upgrade blocked proxy TRI or missing source policy into approved total-return evidence." That distinction matters because the dangerous part of AI is not reading JSON; it is turning JSON into confident-sounding language that goes beyond the evidence.

The backend now exposes that same boundary at `POST /api/assistant/study-run-brief`. You give it a durable `runId`; it loads the exact ledger row, sends that row through the JS contract builders, and returns `run`, `handoff`, and `explanationBrief`. Run History now uses that endpoint for the selected run and only falls back to local JS reconstruction when the backend packet cannot be loaded. This is a small but important maturity step. A future assistant should not scrape the Run History screen or rebuild route parameters in its own private logic. It should ask the backend for the packet and stay inside the packet's permissions.

The boring part matters here: that endpoint has explicit `400`, `404`, and `502` behavior, and the Python service puts a timeout around the Node contract bridge. Without that timeout, a stuck bridge could freeze the local assistant request forever. Good backend boundaries are not just about successful payloads; they are also about controlled failure. A mature system knows how to say, "bad request," "that run does not exist," or "my contract builder failed," without pretending those are the same problem.

The same controlled pattern now exists for the parked Agentic Study Factory vision. `POST /api/study-factory/proposal` accepts a rough study idea and returns a deterministic `study-proposal-v1` packet: existing-study coverage, required tools, missing tool kinds, required data, proposed metric IDs, caveats, non-goals, and next steps. It is intentionally read-only. It does not call an LLM, fetch news, generate code, run a study, or write artifacts. That boundary matters because a study proposal is like a research desk memo: useful for deciding what evidence to collect next, but not itself evidence. The generated contract lives at `docs/study-proposal-contract.json`, and Python reaches it through `scripts/build_study_proposal_payload.mjs` so the JS contract remains the source of truth.

The GitHub Actions workflow now checks the same contract spine: assistant service tests, study builder tests, generated contract drift checks, options regressions, and frontend regressions. This is not just CI busywork. If `docs/assistant-contract.json` says one thing and `app/studyBuilder/assistantContract.js` says another, CI should catch it before the future assistant learns the wrong rule. Good engineers do not rely on discipline alone when a machine can enforce the contract every time.

The practical lesson is simple: metrics are not just formulas. They are product contracts. A formula answers "what number did we compute?" The registry answers "what is this number allowed to mean in this context?"

## Adding A New Study

The usual path is:

1. Add a calculation engine under `app/lib/`.
2. Add a view/module under `app/studies/`.
3. Reuse shared selection and study-pipeline helpers where possible.
4. Register metric presentation rules in `app/lib/metricRegistry.js` before promoting any metric to a headline.
5. Add exports only after the result payload and metric roles are stable.
6. Register the study in `app/studies/registry.js`.
7. Add regression coverage in `scripts/run_frontend_regression_checks.mjs` or a targeted test.

If the study needs backend data, add a route and service function. Do not make the browser talk to providers directly.

## How To Run The App

For bundled snapshots only:

```bash
python3 -m http.server 8000
```

For raw symbols, profiles, options, and local cache:

```bash
./.venv/bin/python scripts/dev_server.py --port 8000
```

Then open:

```text
http://127.0.0.1:8000
```

## Useful Validation Commands

Run frontend-side regression checks:

```bash
node scripts/run_frontend_regression_checks.mjs
```

Validate bundled snapshots:

```bash
python3 scripts/validate_yfinance_snapshots.py --require-all-configured
```

Audit yfinance snapshot quality:

```bash
python3 scripts/audit_yfinance_quality.py
```

Refresh committed yfinance snapshots:

```bash
./scripts/refresh_yfinance.sh --period 5y
```

That wrapper now prefers the project `.venv`, but falls back to the Python on
`PATH` so GitHub Actions can use the interpreter prepared by `actions/setup-python`.

Run the focused persistence and evidence checks after store-layer changes:

```bash
python3 scripts/test_runtime_store_cache.py
python3 scripts/test_options_evidence.py
python3 scripts/test_market_collector.py
```

Run a bounded collector smoke:

```bash
./.venv/bin/python scripts/collect_market_universe.py --universe-id smoke-aapl --symbols AAPL --provider-order finnhub,yfinance --indent 2
```

Inspect operational health of the local SQLite runtime store:

```bash
python3 scripts/report_runtime_health.py
```

Run one combined maintenance pass suitable for cron or another external scheduler:

```bash
python3 scripts/run_data_maintenance.py --max-attention-symbols 0 --max-sync-errors 0
```

## A Fresh Automation Lesson

Fixing the GitHub Action was only half the job. After the workflow finally ran,
the snapshots moved from stale April data to May data, and that exposed two
useful truths:

- Seasonality had a no-lookahead bug: a study ending inside a month could be
  influenced by observations after the requested end date.
- A few frontend regression checks had hard-coded monthly counts that only
  matched the old snapshot window.
- The snapshot sync itself needed idempotence: if market data did not change,
  rerunning automation should not create a timestamp-only commit.
- The sync workflow now runs frontend regressions before committing refreshed
  snapshots because bot-pushed data commits do not reliably get a second
  push-triggered validation pass.
- The sync workflow is serialized with GitHub Actions concurrency so two
  scheduled/manual refreshes do not race each other while rewriting and pushing
  the same snapshot files.

The engineering lesson is simple: when automation refreshes real data, rerun
the product tests against the refreshed data, not just against the code change,
and make sure only one writer is allowed to push that refreshed data at a time.
Fresh data is often the best reviewer, but concurrent fresh-data writers are
how automation becomes flaky.

The newest data-quality seam is `returnBasis`. `targetSeriesType` says what the
dataset is trying to represent, such as TRI. `sourceSeriesType` says what was
actually loaded. `returnBasis` turns that into a simple contract the app and a
future assistant can reason about: `price`, `total_return`, or `proxy`. That is
the difference between a bottle label and the lab test. The current Nifty/Sensex
TRI bootstrap files are explicitly `proxy`, so long-term wealth studies can warn
users instead of quietly treating price-only data as dividend-inclusive evidence.

The product decision is now strict: TRI-labeled runs block unless the loaded
data is true total-return data. There is no approved true-TRI source configured
today, so "TRI unavailable" is the correct product state. `docs/planned-features/true-total-return-sourcing.md`
keeps the remaining sourcing work explicit: source approval, licensing posture,
universe scope, stale-data tolerance, and whether blocked proxy datasets should
remain discoverable. That document exists so a later code slice can wire a real
source if one becomes available, without smuggling data policy into the provider
layer.

The follow-up hardening is `sourcePolicy`. `returnBasis` says what kind of
returns the numbers actually support; `sourcePolicy` says what claim the product
allows that source to make. A price snapshot is `price_only`. A TRI label backed
by price closes is `blocked_proxy_tri`. A future real TRI feed must earn
`approved_total_return`. That extra field sounds bureaucratic, but it is exactly
the kind of boring metadata that prevents a future AI assistant from hallucinating
source approval because a label contains the letters "TRI". The assistant brief
now carries this field directly, so source approval is not a treasure hunt through
provider metadata.

## A Live-AI Testing Lesson

The first real OpenAI smoke did exactly what good test environments are supposed
to do: it found boring contract gaps before the feature became user-facing. The
model sometimes drafted plausible but invalid plans: a `demo` flag on the wrong
view, a future year-end date, a snake-case options sort key, and malformed metric
proposals. None of those should become a study run.

The fix was not to "trust the prompt harder." The fix was two-layered:

- the StudyPlan validator now rejects explicit future dates and non-canonical
  options-screener enum values such as a bad sort key
- the live planner prompt now sends the model a clearer rulebook: today's date,
  allowed route parameters only, `ivHv20Ratio` for IV/HV20 sorting, and no
  `metricProposals` unless the user explicitly asks for metric-presentation
  changes

Think of the model as a junior analyst filling out an order ticket. The prompt
is the instruction sheet, but the validator is the trade desk control. A better
instruction sheet reduces mistakes; the control is what prevents bad tickets
from reaching execution.

The repeatable command for this lesson is now
`python3 scripts/run_assistant_live_planner_smoke.py --matrix --env-file /path/to/.env`.
It reruns the observed live-AI intent set and fails if the model draft is
invalid, unrunnable, accidentally executed, or missing expected canonical route
fragments such as `sort=ivHv20Ratio`.

## The Most Important Architectural Lesson

This repo is good because it resists becoming one giant page. It has seams that match real responsibilities:

- browser shell
- study registry
- study modules
- pure engines
- data gateway
- backend routes
- backend services
- provider adapters
- runtime store
- snapshot tooling
- tests

When a project is young, it is tempting to move fast by putting everything in the nearest file. That works for a week and then punishes you for months. This repo is trying to do the opposite: keep each new capability close to the place where it naturally belongs.

As the app grows, the sharper version of that lesson is this:

- keep the browser orchestration thin
- keep provider mess behind adapters
- keep persistence grouped by domain
- keep public contracts stable while internals evolve

That is the habit worth learning here.
