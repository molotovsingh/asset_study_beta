# Index Study Lab

Minimal static scaffold for a study library.

## What it does

- Hosts studies in a registry instead of hardcoding everything into one page.
- Ships multiple studies on the same shared shell:
  risk-adjusted return, seasonality, rolling returns, SIP simulation, Lumpsum
  vs SIP comparison, and a dedicated drawdown study.
- Loads bundled snapshots for built-in datasets and optionally uses a local
  backend for raw yfinance symbols.
- Keeps index catalog metadata separate from study logic.

## Why this structure

You said this is only the first study and there may be hundreds later with
different data and different goals. The code is shaped around that:

- `app/studies/`
  One module per study. Each study mounts its own UI and owns its own
  validation, inputs, and output rendering.
- `app/catalog/`
  Shared metadata such as seeded index names and official source URLs.
- `app/lib/`
  Reusable CSV parsing, date filtering, formatting, and metrics.

This avoids a single giant "study page" that keeps growing conditionals forever.

## Current studies

- `Risk-Adjusted Return`
  Risk, drawdown, and risk-adjusted diagnostics for one filtered series, with
  overview, visuals, and relative benchmark views.
- `Seasonality`
  Month-of-year behavior with win rates, heatmaps, and confidence cues.
- `Rolling Returns`
  1Y, 3Y, 5Y, and 10Y rolling CAGR analysis with horizon tables and rolling
  path visuals.
- `SIP Simulator`
  Fixed monthly contribution cohorts with XIRR, terminal wealth, and
  chart-based cohort comparisons across historical start months.
- `Lumpsum vs SIP`
  Same-capital cohort comparison between upfront deployment and monthly
  deployment over fixed historical horizons.
- `Drawdown Study`
  Ranked peak-to-trough episodes with underwater path analysis, recovery
  durations, and dedicated overview/visual export surfaces.

Shared support across studies includes:

- built-in or bundled index datasets
- a shared active subject that follows the user across primary study inputs
- recent completed runs in local browser storage for quick study/subject return
- shareable input URLs that restore study, subject, date window, and key
  study-specific form values
- raw yfinance symbols through the optional local backend
- lightweight yfinance instrument profiles for selected symbols
- date window selection
- bundled snapshot loading from `data/snapshots/...`
- local backend fetch and machine-local SQLite cache under
  `data/local-cache/yfinance/index/cache.sqlite3`
- optional synthetic demo data mode
- study-specific inputs, visuals, and CSV/XLS exports

## Planned features

Future product tracks that are real enough to preserve live in
[`docs/planned-features.md`](docs/planned-features.md). The active AI tracks are
strictly bounded: the AI Study Builder turns natural-language research intent
into validated study plans, and the read-only Study Factory proposal endpoint
checks whether a new study idea has existing-study coverage, approved tools,
evidence requirements, and caveats. In both cases, the app's existing study
engine, metric policy, and data-window checks stay in charge.

The deterministic assistant boundary can be checked without any AI key:

```bash
python3 scripts/check_assistant_readiness.py
```

The backend also exposes a keyless assistant planning dry run at
`POST /api/assistant/study-plan-dry-run`; it drafts and validates a StudyPlan
without executing a study or calling an AI model.

New study ideas can be shaped without execution through
`POST /api/study-factory/proposal`. That endpoint returns a versioned
`study-proposal-v1` feasibility packet and an explicit `executed: false` marker.

Optional live model smoke is explicit and non-executing:

```bash
python3 scripts/run_assistant_live_planner_smoke.py --env-file /path/to/.env
```

If the key is stored under a different variable, pass `--api-key-var NAME`.
For broader live AI product testing, run the matrix smoke:

```bash
python3 scripts/run_assistant_live_planner_smoke.py --matrix --env-file /path/to/.env
```

The matrix still does not execute studies; it checks that observed live-AI
intents produce valid, runnable, non-executed StudyPlans with canonical route
fragments.

## Data sources

- NSE historical and TRI data:
  `https://www.niftyindices.com/reports/historical-data`
- BSE index archive:
  `https://www.bseindia.com/indices/IndexArchiveData.html`
- RBI data reference for the manual risk-free rate:
  `https://data.rbi.org.in`

## Running locally

1. Create a local virtual environment:

```bash
python3 -m venv .venv
```

2. Install sync and backend dependencies:

```bash
./.venv/bin/pip install -r requirements-sync.txt
```

Optional local secrets can live in `.env` at the repo root. Python backend
scripts now load that file automatically when present.

Example:

```bash
cp .env.example .env
```

Useful optional keys:

```bash
FINNHUB_API_KEY=your_finnhub_key_here
```

3. Either serve the static app for bundled datasets:

```bash
python3 -m http.server 8000
```

Or start the local app server when you want raw yfinance symbols and local
machine caching backed by SQLite:

```bash
./.venv/bin/python scripts/dev_server.py --port 8000
```

Then open `http://127.0.0.1:8000`.

The study shell can load built-in bundled datasets from committed snapshots
with either server. Raw symbols and remembered local symbols need the local
server because they go through `/api/yfinance/...`.

## Data Flow

Type a built-in name like `Nifty 50`, a bundled custom dataset label, or any
yfinance symbol like `AAPL`, `^NSEI`, or `ETH-USD` into the main input and run
the study.

What happens:

- built-in and bundled datasets load from committed snapshots under
  `data/snapshots/`
- raw symbols are sent to the local backend
- successful ad hoc symbols are remembered locally on that machine
- selected symbols can be enriched with cached yfinance profile metadata such as
  quote type, sector, industry, country, exchange, market cap, beta, and
  valuation basics when Yahoo provides them
- backend-fetched series and remembered symbols are stored in
  `data/local-cache/yfinance/index/cache.sqlite3`

The browser never talks to Yahoo directly. Bundled snapshots come from this
repo, and ad hoc backend fetches are mediated through Python.

To smoke-test a Databento key from the same environment:

```bash
./.venv/bin/python scripts/test_databento_connection.py
```

That script verifies the key, prints whether `XCBF.PITCH` is visible to the
current Databento account, and fetches a tiny historical control sample by
default.

## Snapshot Tooling

The snapshot scripts are the source of truth for bundled datasets in the repo.
They write normalized JSON snapshots into `data/snapshots/`.

Current bootstrap provider:

- `yfinance` for selected index histories

This keeps the study UI independent from Yahoo so the source can be replaced
later with official feeds or a paid provider.

Refresh snapshots and validate them with:

```bash
./scripts/refresh_yfinance.sh --period 5y
```

The refresh wrapper prefers `./.venv/bin/python` when it exists, then falls back
to `python3`/`python` on `PATH`. Set `ASSET_STUDY_PYTHON_BIN=/path/to/python`
when CI or another automation should use a specific interpreter.

Audit bundled snapshot freshness, gap structure, and large day-over-day moves with:

```bash
python3 scripts/audit_yfinance_quality.py
```

Run the frontend-side calculator and export regressions with:

```bash
node scripts/run_frontend_regression_checks.mjs
```

Run the local server smoke when route/API wiring changed:

```bash
python3 scripts/test_live_app_smoke.py
```

Inspect the local runtime-store health for stale symbols, recent collection runs,
and open options evidence:

```bash
python3 scripts/report_runtime_health.py
```

Run one automation-friendly maintenance pass that collects market universes,
refreshes options evidence, and then evaluates runtime health:

```bash
python3 scripts/run_data_maintenance.py --max-attention-symbols 0 --max-sync-errors 0
```

### Add a custom yfinance symbol

Register a symbol once:

```bash
./.venv/bin/python scripts/add_yfinance_symbol.py --symbol AAPL --label "Apple Inc" --refresh --period 5y
``` 

Custom entries default to `sourcePolicy: "price_only"`. If you register a true
total-return dataset later, pass `--source-policy approved_total_return` plus the
source/provenance fields; the sync validator will not infer approval from a TRI
label alone.

If this repo is hosted on GitHub, `.github/workflows/sync-yfinance.yml` can
refresh and commit snapshots automatically on weekdays or by manual dispatch.

The sync script now retries transient symbol failures and also writes
`data/snapshots/yfinance/index/manifest.json` so the repo has a compact index of
what was pulled, when it was generated, and which snapshot path each dataset
uses. Snapshot metadata also carries a `returnBasis` field:

- `price`: price-index or tradable price history.
- `total_return`: true total-return history.
- `proxy`: a requested total-return series is currently backed by price data.

Ad hoc backend-fetched symbols are local-only convenience data. Use the snapshot
tooling when you want a dataset to become part of the bundled repo catalog.

If you already have older `data/local-cache/.../*.json` files from the previous
runtime format, the local server imports them into SQLite on startup.

### Collect a bounded market universe

Seed or refresh a local universe and collect daily bars into the SQLite cache:

```bash
./.venv/bin/python scripts/collect_market_universe.py \
  --universe-id us-core \
  --symbols AAPL MSFT NVDA \
  --provider-order finnhub,yfinance
```

Or refresh a Finnhub exchange-backed symbol master first, then collect a bounded
subset for a smoke run:

```bash
./.venv/bin/python scripts/collect_market_universe.py \
  --universe-id us-all \
  --universe-label "US All Symbols" \
  --exchange US \
  --refresh-symbol-master \
  --provider-order finnhub,yfinance \
  --limit 100
```

The collector keeps the symbol universe, member metadata, and run summaries in
the local SQLite runtime store. `--limit` only caps the current collection run;
it does not shrink the stored universe.

### Current limits

- The local backend currently uses `yfinance` directly.
- yfinance profile metadata is opportunistic. It is useful for orientation, but
  it should not be treated as audited fundamentals.
- The active-asset sidebar now supports remembered symbols, derived India sector
  indexes, and manual `Label | SYMBOL` entries, but it is still not a full
  market-security master.
- There is currently no approved true-TRI source configured in this repo.
  `Nifty 50 TRI` and `S&P BSE Sensex TRI` currently use price index proxies from
  Yahoo Finance, not true TRI series. They are marked `returnBasis: "proxy"` so
  TRI-labeled study runs are blocked until approved true total-return data is
  available. Bundled datasets also carry `sourcePolicy` metadata such as
  `price_only` or `blocked_proxy_tri` so exports, run history, and future
  assistant flows do not have to infer source claims from labels. The unresolved
  source/licensing/universe implementation policy is tracked in
  [`docs/planned-features/true-total-return-sourcing.md`](docs/planned-features/true-total-return-sourcing.md).
- Risk-free rate is entered manually for now, typically using an RBI reference.

## Adding another study

1. Create a new module under `app/studies/`.
2. Export an object with `id`, `title`, `description`, `inputSummary`, and
   either a legacy `mount(root)` entrypoint or a `views` map for study-first
   routing.
3. Add that object to `app/studies/registry.js`.

Optional study capabilities can declare whether the shell should expose
`visuals`, `relative`, and `exports` affordances for that study.

If a future study needs a different file shape or a different dataset, put that
adapter in `app/lib/` or a dedicated data folder, not inside another study's
UI logic.
