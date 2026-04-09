# Index Study Lab

Minimal static scaffold for a study library.

## What it does

- Hosts studies in a registry instead of hardcoding everything into one page.
- Ships multiple studies on the same shared shell:
  risk-adjusted return, seasonality, rolling returns, and SIP simulation.
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

Shared support across studies includes:

- built-in or bundled index datasets
- raw yfinance symbols through the optional local backend
- date window selection
- bundled snapshot loading from `data/snapshots/...`
- local backend fetch and machine-local SQLite cache under
  `data/local-cache/yfinance/index/cache.sqlite3`
- optional synthetic demo data mode
- manual annual risk-free rate input
- output for CAGR, annualized volatility, Sharpe ratio, Sortino ratio, total
  return, and max drawdown

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
- backend-fetched series and remembered symbols are stored in
  `data/local-cache/yfinance/index/cache.sqlite3`

The browser never talks to Yahoo directly. Bundled snapshots come from this
repo, and ad hoc backend fetches are mediated through Python.

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

Run the frontend-side calculator and export regressions with:

```bash
node scripts/run_frontend_regression_checks.mjs
```

### Add a custom yfinance symbol

Register a symbol once:

```bash
./.venv/bin/python scripts/add_yfinance_symbol.py --symbol AAPL --label "Apple Inc" --refresh --period 5y
``` 

If this repo is hosted on GitHub, `.github/workflows/sync-yfinance.yml` can
refresh and commit snapshots automatically on weekdays or by manual dispatch.

The sync script now retries transient symbol failures and also writes
`data/snapshots/yfinance/index/manifest.json` so the repo has a compact index of
what was pulled, when it was generated, and which snapshot path each dataset
uses.

Ad hoc backend-fetched symbols are local-only convenience data. Use the snapshot
tooling when you want a dataset to become part of the bundled repo catalog.

If you already have older `data/local-cache/.../*.json` files from the previous
runtime format, the local server imports them into SQLite on startup.

### Current limits

- The local backend currently uses `yfinance` directly.
- Built-in names only cover a small curated set of mapped symbols.
- `Nifty 50 TRI` and `S&P BSE Sensex TRI` currently use price index proxies from
  Yahoo Finance, not true TRI series.
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
